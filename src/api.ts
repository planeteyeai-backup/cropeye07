import axios from "axios";
import {
  getAuthToken,
  setAuthToken as setAuthTokenUtil,
  isValidToken,
  getRefreshToken,
  setRefreshToken,
  clearAllLocalStorage,
  getUserRole,
  getFastApiToken,
  setFastApiToken,
} from "./utils/auth";
import { checkAndRefreshToken, isTokenExpired } from "./utils/tokenManager";
import {
  parseTeamConnectHierarchy,
  personDisplayName,
} from "./utils/teamConnectHarvest";
import { getCache, setCache, removeCache } from "./utils/cache";

// Set base URL for backend (use .env VITE_API_BASE_URL or new Render backend)
const DEFAULT_API_BASE_URL = "https://cropeye-backendd.up.railway.app/api";

/** Shared TTL for field-officer / manager agroStats (login + harvest + agro dash). */
const AGRO_STATS_CACHE_TTL_MS = 10 * 60 * 1000;
const MY_FIELD_OFFICERS_TTL_MS = 5 * 60 * 1000;
const FARMS_ALL_TTL_MS = 10 * 60 * 1000;

/** In-flight dedupe so the same FO agroStats URL is never requested twice at once. */
const fieldOfficerAgroStatsInFlight = new Map<string, Promise<any>>();
const managerAgroStatsInFlight = new Map<string, Promise<Record<string, unknown>>>();
const ownerAgroStatsInFlight = new Map<string, Promise<Record<string, unknown>>>();

/** Short-lived cache + in-flight dedupe for /users/me/ and team-connect
 *  so the owner dashboard + agroStats helper share one network request each. */
const USER_TEAM_CACHE_TTL_MS = 5 * 60 * 1000;
let currentUserInFlight: Promise<any> | null = null;
let currentUserCache: { res: any; ts: number } | null = null;
const teamConnectInFlight = new Map<string, Promise<any>>();
const teamConnectCache = new Map<string, { res: any; ts: number }>();

/** /users/my-field-officers/ — one network call shared by Harvest, Farm Dash, agroStats. */
let myFieldOfficersInFlight: Promise<any> | null = null;
let myFieldOfficersCache: { res: any; ts: number } | null = null;

/** Full /farms/?include_farmer=true pagination — one pass shared by Harvest + prefetch. */
let farmsAllInFlight: Promise<any[]> | null = null;

export const MANAGER_FIELD_OFFICERS_CACHE_KEY = "managerFieldOfficers_v1";
export const FARMS_ALL_CACHE_KEY = "farmsWithFarmerDetails_all_v2";

export function ownerAgroStatsCacheKey(endDate?: string): string {
  const date = endDate || "latest";
  return `ownerAgroStats_${date}`;
}

export function fieldOfficerAgroStatsCacheKey(
  fieldOfficerId: string | number,
  endDate?: string,
): string {
  const date = endDate || "latest";
  return `foAgroStats_${fieldOfficerId}_${date}`;
}

export function managerAgroStatsCacheKey(endDate?: string): string {
  const date = endDate || "latest";
  // v2: empty {} is no longer treated as a valid cache hit
  return `managerAgroStats_v2_${date}`;
}

function resolveApiBaseUrl(): string {
  const fromEnv = String(import.meta.env.VITE_API_BASE_URL ?? "").trim();
  if (/^https?:\/\//i.test(fromEnv)) {
    const normalized = fromEnv.replace(/\/$/, "");
    // Vercel has no Django proxy — cropeye.ai/api would return SPA HTML.
    if (/cropeye\.ai|vercel\.app/i.test(normalized)) {
      return DEFAULT_API_BASE_URL;
    }
    if (typeof window !== "undefined") {
      try {
        if (new URL(normalized).origin === window.location.origin) {
          return DEFAULT_API_BASE_URL;
        }
      } catch {
        return DEFAULT_API_BASE_URL;
      }
    }
    return normalized;
  }
  return DEFAULT_API_BASE_URL;
}

const API_BASE_URL = resolveApiBaseUrl();

// KML/GeoJSON API URL
const KML_API_URL = "http://192.168.41.51";

// FastAPI auth base URL (farmer plot login)
const FASTAPI_AUTH_BASE_URL =
  import.meta.env.VITE_FASTAPI_AUTH_BASE_URL ||
  import.meta.env.VITE_DEV_EVENTS_API_URL ||
  "https://events-cropeye.up.railway.app";

// SEF field service — industrial yield by owner (public, no auth)
const SEF_PRODUCTION_URL = "https://sef-cropeye.up.railway.app";

function resolveSefFieldApiBaseUrl(): string {
  const fromEnv = String(import.meta.env.VITE_SEF_API_BASE_URL ?? "").trim();
  if (/^https?:\/\//i.test(fromEnv)) {
    return fromEnv.replace(/\/$/, "");
  }
  // Always hosted SEF — never Vite `/api/sef` localhost proxy.
  return SEF_PRODUCTION_URL;
}

const SEF_FIELD_API_BASE_URL = resolveSefFieldApiBaseUrl();

/** Large industrial yield payload — allow up to 2 minutes on slow networks. */
const SEF_INDUSTRIAL_YIELD_TIMEOUT_MS = 120_000;

function hasIndustrialYieldFactories(payload: unknown): boolean {
  const data = payload as { factories?: unknown[] };
  return Array.isArray(data?.factories) && data.factories.length > 0;
}

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Create axios instance for public endpoints (no auth required)
const publicApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Axios instance for Events/FastAPI microservice (optional Bearer from storage)
export const eventsApi = axios.create({
  baseURL: FASTAPI_AUTH_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

eventsApi.interceptors.request.use((config) => {
  const t = getFastApiToken();
  if (t) {
    config.headers.Authorization = `Bearer ${t}`;
  }
  return config;
});

export const sefApi = axios.create({
  baseURL: SEF_FIELD_API_BASE_URL,
  timeout: SEF_INDUSTRIAL_YIELD_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// Add auth token if available and refresh if needed
api.interceptors.request.use(
  async (config) => {
    const token = getAuthToken();
    if (!token) {
      return config;
    }

    if (isTokenExpired(token, 300)) {
      await checkAndRefreshToken(300);
    }

    const currentToken = getAuthToken();
    if (currentToken) {
      config.headers.Authorization = `Bearer ${currentToken}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Token refresh flag to prevent infinite loops
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: any) => void;
  reject: (reason?: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  failedQueue = [];
};

// Add response interceptor to handle authentication errors and token refresh
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Suppress console errors for silent errors
    if (error.isSilent) {
      return Promise.reject(error);
    }

    // Handle token refresh for 401 errors (expired/missing access token).
    // Retry whenever a refresh token exists — not only when detail mentions "token"
    // (Django often returns "Authentication credentials were not provided.").
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = getRefreshToken();

      if (refreshToken) {
        try {
          const response = await axios.post(`${API_BASE_URL}/token/refresh/`, {
            refresh: refreshToken,
          });

          const { access, refresh: newRefreshToken } = response.data;

          if (access) {
            setAuthTokenUtil(access);

            if (newRefreshToken) {
              setRefreshToken(newRefreshToken);
            }

            originalRequest.headers.Authorization = `Bearer ${access}`;

            processQueue(null, access);
            isRefreshing = false;

            return api(originalRequest);
          }
        } catch (refreshError: any) {
          processQueue(refreshError, null);
          isRefreshing = false;
          clearAllLocalStorage();

          if (window.location.pathname !== "/login") {
            window.location.href = "/login";
          }

          return Promise.reject(refreshError);
        }
      }

      // No refresh token — clear session and redirect
      processQueue(error, null);
      isRefreshing = false;
      clearAllLocalStorage();

      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }

    // Only log non-silent errors
    if (error.response?.status === 401 || error.response?.status === 403) {
      // Authentication errors are expected in some cases, don't log them as errors
      // They're handled by the calling code
      return Promise.reject(error);
    }

    return Promise.reject(error);
  },
);

// ==================== AUTHENTICATION API ====================
// Note: Using password-based authentication instead of OTP

// OTP-based authentication (commented out - using password-based auth instead)
//export const sendOtp = (email: string) => {
// return api.post('/otp/', { email });
//};

//export const verifyOtp = (email: string, otp: string) => {
//return api.post('/verify-otp/', { email, otp });
//};

//Login function - backend expects phone_number field
// Uses publicApi since login doesn't require authentication
export const login = (phone_number: string, password: string) => {
  return publicApi.post("/users/login/", { phone_number, password });
};

// Token refresh function
export const refreshToken = (refresh: string) => {
  return axios.post(`${API_BASE_URL}/token/refresh/`, { refresh });
};

export const addUser = (data: {
  username?: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  email: string;
  password?: string;
  role_id: number; // Changed from 'role: string' to 'role_id: number' - backend expects integer (1=farmer, 2=fieldofficer, 3=manager, 4=owner)
}) => {
  return api.post("/users/", data);
};

export const addTask = (data: {
  title: string;
  description: string;
  status: string;
  priority: string;
  assigned_to_id: number;
  due_date: string;
}) => {
  return api.post("/tasks/", data);
};

export const getTasks = () => {
  return api.get("/tasks/");
};

export const getTaskById = (id: number) => {
  return api.get(`/tasks/${id}/`);
};

export const updateTask = (id: number, data: any) => {
  return api.put(`/tasks/${id}/`, data);
};

export const getTasksForUser = (userId: number) => {
  return api.get(`/tasks/?assigned_to_id=${userId}`);
};

export const getFarmersByFieldOfficer = (fieldOfficerId: string | number) => {
  return api.get("/users/farmers-by-field-officer/", {
    params: { field_officer_id: fieldOfficerId },
  });
};

export const parseFarmersByFieldOfficerResponse = (data: any): any[] => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.farmers)) return data.farmers;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

export const updateTaskStatus = (taskId: number, status: string) => {
  return api.patch(`/tasks/${taskId}/`, { status });
};

export const addVendor = (data: {
  vendor_name: string;
  email: string;
  phone?: string;
  mobile?: string;
  contact_person?: string;
  gstin?: string;
  gstin_number?: string;
  state?: string;
  city?: string;
  address: string;
  rating?: number;
}) => {
  return api.post("/vendors/", data);
};

export const getVendors = () => {
  return api.get("/vendors/");
};

// Update vendor using PATCH method (partial update)
export const patchVendor = (id: string | number, data: any) => {
  return api.patch(`/vendors/${id}/`, data);
};

// Delete vendor
export const deleteVendor = (id: string | number) => {
  return api.delete(`/vendors/${id}/`);
};

export const addOrder = (data: {
  vendor: number; // Vendor ID
  invoice_date: string;
  invoice_number: string;
  state: string;
  items: {
    item_name: string;
    year_of_make: string;
    estimate_cost: string;
    remark: string;
  }[];
}) => {
  return api.post("/orders/", data);
};

export const getorders = () => {
  return api.get("/orders/");
};

// Update order using PATCH method (partial update)
export const patchOrder = (id: string | number, data: any) => {
  console.log("patchOrder API call:", {
    endpoint: `/orders/${id}/`,
    baseURL: API_BASE_URL,
    fullURL: `${API_BASE_URL}/orders/${id}/`,
    method: "PATCH",
    data: data,
  });
  return api.patch(`/orders/${id}/`, data);
};

// Update order using PUT method (full update)
export const putOrder = (id: string | number, data: any) => {
  return api.put(`/orders/${id}/`, data);
};

// Delete order
export const deleteOrder = (id: string | number) => {
  return api.delete(`/orders/${id}/`);
};
/**
 * POST Create Stock
 * POST /api/stock/
 * @param data - Stock item data
 * @example
 * {
 *   item_name: "Tractor",
 *   item_type: "equipment", // Valid: "logistic", "transport", "equipment", "office_purpose", "storage", "processing"
 *   make: "John Deere",
 *   year_of_make: "2020",
 *   estimate_cost: "500000",
 *   status: "working", // Valid: "working", "not_working", "under_repair"
 *   remark: "In good condition"
 * }
 */
export const addStock = (data: {
  item_name: string;
  item_type: string; // Backend expects: "logistic", "transport", "equipment", "office_purpose", "storage", "processing"
  make: string;
  year_of_make: string;
  estimate_cost: string;
  status: string; // Backend expects: "working", "not_working", "under_repair"
  remark: string;
}) => {
  return api.post("/stock/", data);
};
export const getstock = () => {
  return api.get("/stock/");
};

// Update stock using PATCH method (partial update)
export const patchStock = (id: string | number, data: any) => {
  return api.patch(`/stock/${id}/`, data);
};

// Delete stock
export const deleteStock = (id: string | number) => {
  return api.delete(`/stock/${id}/`);
};
export const addBooking = (data: {
  item_name: string;
  user_role: string;
  start_date: string;
  end_date: string;
  status: string;
}) => {
  console.log("addBooking API call:", {
    endpoint: "/bookings/",
    baseURL: API_BASE_URL,
    fullURL: `${API_BASE_URL}/bookings/`,
    data: data,
  });
  return api.post("/bookings/", data);
};
export const getbookings = () => {
  return api.get("/bookings/");
};
export const patchBooking = (id: string | number, data: any) => {
  return api.patch(`/bookings/${id}/`, data);
};

// Delete booking
export const deleteBooking = (id: string | number) => {
  return api.delete(`/bookings/${id}/`);
};

// ==================== FARM MANAGEMENT API ====================

// Farm Management
export const getFarms = () => {
  return api.get("/farms/");
};

// Get farms with farmer details
export const getFarmsWithFarmerDetails = () => {
  return api.get("/farms/?include_farmer=true");
};

/** Paginate farms with nested farmer; capped to avoid hanging the UI. */
export const getFarmsWithFarmerDetailsPaginated = async (
  maxPages = 15,
  pageSize = 100,
): Promise<any[]> => {
  const all: any[] = [];
  const size = Math.min(Math.max(pageSize, 1), 200);
  let nextPath: string | null = `/farms/?include_farmer=true&page_size=${size}`;
  let pageCount = 0;

  while (nextPath && pageCount < maxPages) {
    pageCount += 1;
    const res: { data?: any } = await api.get(nextPath);
    const data: any = res?.data;
    const page: any[] = Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
        ? data
        : [];
    all.push(...page);

    const nextUrl: unknown = data?.next;
    if (!nextUrl || typeof nextUrl !== "string") {
      break;
    }
    try {
      const parsed: URL = new URL(nextUrl);
      nextPath = `${parsed.pathname}${parsed.search}`.replace(/^\/api/, "");
    } catch {
      nextPath = nextUrl.startsWith("/") ? nextUrl : null;
    }
  }

  return all;
};

/** Owner/manager-safe: paginate through all farms with nested farmer (recent-farmers is FO-only).
 *  Cached + single-flight so Harvest / prefetch / re-renders do not re-paginate. */
export const getAllFarmsWithFarmerDetails = async (
  options?: { force?: boolean },
): Promise<any[]> => {
  if (options?.force) {
    removeCache(FARMS_ALL_CACHE_KEY);
  } else {
    const cached = getCache(FARMS_ALL_CACHE_KEY, FARMS_ALL_TTL_MS);
    if (Array.isArray(cached) && cached.length > 0) {
      return cached;
    }
    if (farmsAllInFlight) return farmsAllInFlight;
  }

  // Larger page_size → fewer round-trips (main manager Harvest delay).
  farmsAllInFlight = getFarmsWithFarmerDetailsPaginated(30, 100)
    .then((all) => {
      if (Array.isArray(all) && all.length > 0) {
        setCache(FARMS_ALL_CACHE_KEY, all);
      }
      return all;
    })
    .finally(() => {
      farmsAllInFlight = null;
    });

  return farmsAllInFlight;
};

// Get recent farmers (field officer only — returns 403 for owner/manager)
export const getRecentFarmers = () => {
  return api.get("/farms/recent-farmers/");
};

export const getFarmById = (id: string) => {
  return api.get(`/farms/${id}/`);
};

// Get farms by farmer ID (include_farmer helps return plot gat/plot numbers)
export const getFarmsByFarmerId = (farmerId: string) => {
  return api.get(`/farms/?farmer_id=${farmerId}&include_farmer=true`);
};

export const createFarm = async (data: {
  first_name: string;
  last_name: string;
  username: string;
  password: string;
  confirm_password: string;
  email: string;
  phone_number: string;
  address: string;
  village: string;
  taluka: string;
  state: string;
  pin_code: string;
  district: string;
  gat_No: string;
  area: string;
  crop_type: string;
  plantation_Type: string;
  plantation_Date: string;
  irrigation_Type: string;
  // plants_Per_Acre: string;
  spacing_A: string;
  spacing_B: string;
  flow_Rate: string;
  emitters: string;
  motor_Horsepower: string;
  pipe_Width: string;
  distance_From_Motor: string;
  geometry: string;
  location: { lat: string; lng: string };
  documents: FileList | null;
}) => {
  // Create FormData for file upload
  const formData = new FormData();

  // Add all text fields
  Object.keys(data).forEach((key) => {
    if (key !== "documents") {
      formData.append(key, data[key as keyof typeof data] as string);
    }
  });

  // Add files if they exist
  if (data.documents) {
    for (let i = 0; i < data.documents.length; i++) {
      formData.append("documents", data.documents[i]);
    }
  }

  // Use multipart/form-data for file upload
  return api.post("/farms/", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
};

export const updateFarm = (id: string, data: any) => {
  return api.put(`/farms/${id}/`, data);
};

// Update farm using PATCH method (partial update)
export const patchFarm = (id: string, data: any) => {
  return api.patch(`/farms/${id}/`, data);
};

// Update plot using PATCH method (partial update)
export const patchPlot = (id: string, data: any) => {
  return api.patch(`/plots/${id}/`, data);
};

// Update irrigation using PATCH method (partial update)
export const patchIrrigation = (id: string, data: any) => {
  return api.patch(`/irrigations/${id}/`, data);
};

// Update farm registration
export const updateFarmRegistration = (
  id: string,
  data: {
    farmer_id?: string;
    plots?: Array<any>;
    totalArea?: {
      sqm: number;
      ha: number;
      acres: number;
    };
    location?: {
      lat: string;
      lng: string;
    };
    documents?: FileList | null;
  },
) => {
  return api.put(`/farms/${id}/`, data);
};

export const deleteFarm = (id: string) => {
  return api.delete(`/farms/${id}/`);
};

export const getFarmsGeoJSON = () => {
  return api.get("/farms/geojson/");
};

// Farm Plots Management
export const getFarmPlots = () => {
  return api.get("/farm-plots/");
};

export const createFarmPlot = (data: {
  farm_id: string;
  boundary: string; // GeoJSON geometry
  area: number;
  plot_name: string;
}) => {
  return api.post("/farm-plots/", data);
};

export const getFarmPlotsGeoJSON = () => {
  return api.get("/farm-plots/geojson/");
};

// Soil and Crop Types
export const getSoilTypes = () => {
  return api.get("/soil-types/");
};

export const getCropTypes = () => {
  return api.get("/crop-types/");
};

// Get crop types with Bearer token
export const getCropTypesWithAuth = (token: string) => {
  return axios.get(`${API_BASE_URL}/crop-types/`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
};

export const registerUser = (data: {
  username: string;
  password: string;
  password2: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  phone_number: string;
  address: string;
}) => {
  return api.post("/users/", data);
};

// OTP-based authentication (commented out - using password-based auth instead)
// export const getTokenWithOtp = (email: string, otp: string) => {
//   return api.post('/token/', { email, otp });
// };

export const getCurrentUser = () => {
  const now = Date.now();
  if (currentUserCache && now - currentUserCache.ts < USER_TEAM_CACHE_TTL_MS) {
    return Promise.resolve(currentUserCache.res);
  }
  if (currentUserInFlight) return currentUserInFlight;

  currentUserInFlight = api
    .get("/users/me/")
    .then((res) => {
      currentUserCache = { res, ts: Date.now() };
      return res;
    })
    .finally(() => {
      currentUserInFlight = null;
    });
  return currentUserInFlight;
};

export const getUserById = (id: string | number) => {
  return api.get(`/users/${id}/`);
};

export const getUsers = () => {
  return api.get("/users/");
};

/** Fetch all user pages (list endpoint is paginated). */
export const getAllUsersPaginated = async (maxPages = 20): Promise<any[]> => {
  const all: any[] = [];
  let nextPath: string | null = "/users/";
  let pageCount = 0;

  while (nextPath && pageCount < maxPages) {
    pageCount += 1;
    const res: { data?: any } = await api.get(nextPath);
    const data: any = res?.data;
    const page: any[] = Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
        ? data
        : [];
    all.push(...page);

    const nextUrl: unknown = data?.next;
    if (!nextUrl || typeof nextUrl !== "string") {
      break;
    }
    try {
      const parsed: URL = new URL(nextUrl);
      nextPath = `${parsed.pathname}${parsed.search}`.replace(/^\/api/, "");
    } catch {
      nextPath = nextUrl.startsWith("/") ? nextUrl : null;
    }
  }

  return all;
};

/** GET /users/{id}/ for each farmer — returns village, taluka, district, email. */
export const getFarmerUserProfiles = async (
  userIds: Array<number | string>,
): Promise<any[]> => {
  const unique = [
    ...new Set(
      userIds
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id) && id > 0),
    ),
  ];
  const profiles: any[] = [];
  const batchSize = 6;

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((id) => getUserById(id)),
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value?.data) {
        profiles.push(result.value.data);
      }
    }
  }

  return profiles;
};

/** Farmers assigned to field officers (rich profiles with plots/farms). */
export const getFarmersForFieldOfficers = async (
  fieldOfficerIds: Array<number | string>,
): Promise<any[]> => {
  const uniqueIds = [
    ...new Set(
      fieldOfficerIds
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id) && id > 0),
    ),
  ];
  const farmers: any[] = [];
  const seen = new Set<string>();
  const batchSize = 4;

  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const batch = uniqueIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((id) => getFarmersByFieldOfficer(id)),
    );
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const farmer of parseFarmersByFieldOfficerResponse(result.value.data)) {
        const key = String(farmer?.id ?? farmer?.user_id ?? farmer?.username ?? "");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        farmers.push(farmer);
      }
    }
  }

  return farmers;
};

// Update user using PATCH method (partial update)
export const updateUser = (id: string, data: any) => {
  return api.patch(`/users/${id}/`, data);
};

export const getContactDetails = () => {
  return api.get("/users/contact-details/");
};

// Get total counts for dashboard
export const getTotalCounts = () => {
  return api.get("/users/total-count/");
};

// Get team connect data (owners, field officers, farmers)
// Cached + deduped: dashboard and agroStats helper share one network hit per industry.
export const getTeamConnect = (industryId?: number | string) => {
  const key = industryId != null ? String(industryId) : "__none__";
  const cached = teamConnectCache.get(key);
  if (cached && Date.now() - cached.ts < USER_TEAM_CACHE_TTL_MS) {
    return Promise.resolve(cached.res);
  }
  const existing = teamConnectInFlight.get(key);
  if (existing) return existing;

  const url = industryId
    ? `/users/team-connect/?industry_id=${industryId}`
    : `/users/team-connect/`;
  const pending = api
    .get(url)
    .then((res) => {
      teamConnectCache.set(key, { res, ts: Date.now() });
      return res;
    })
    .finally(() => {
      teamConnectInFlight.delete(key);
    });
  teamConnectInFlight.set(key, pending);
  return pending;
};

// Messaging API functions
export const sendMessage = (data: {
  recipient_id: number[];
  content: string;
}) => {
  return api.post("/messages/", data);
};

export const getConversationWithUser = (userId: number) => {
  return api.get(`/conversations/with-user/${userId}/`);
};

export const getConversations = () => {
  return api.get("/conversations/");
};

export const getMessages = (conversationId: number) => {
  return api.get(`/conversations/${conversationId}/messages/`);
};

// Farmer Registration API (role_id = 1 for Farmer) - No authentication required
export const registerFarmer = (data: {
  username: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role_id: number; // Always 1 for Farmer
  phone_number: string;
  address: string;
  village: string;
  taluka: string;
  district: string;
  state: string;
}) => {
  // Create axios instance without auth token for registration
  return axios.post(`${API_BASE_URL}/users/`, data, {
    headers: {
      "Content-Type": "application/json",
    },
  });
};


// Set authentication token for API calls
export const setAuthToken = (token: string) => {
  // Set the token in the axios instance
  api.defaults.headers.Authorization = `Bearer ${token}`;
  // Also store it in localStorage using the utility
  setAuthTokenUtil(token);
};

// Set FastAPI token for events microservice calls
export const setFastApiAuthToken = (token: string) => {
  eventsApi.defaults.headers.Authorization = `Bearer ${token}`;
  setFastApiToken(token);
};

// Plot Creation API - Requires Bearer token
export const createPlot = (
  data: {
    gat_number: string;
    plot_number: string;
    village: string;
    taluka: string;
    district: string;
    state: string;
    country: string;
    pin_code: string;
    location: {
      type: "Point";
      coordinates: [number, number]; // longitude, latitude
    };
    boundary: {
      type: "Polygon";
      coordinates: [[[number, number]]]; // GeoJSON Polygon
    };
  },
  token?: string,
) => {
  const headers: any = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return axios.post(`${API_BASE_URL}/plots/`, data, { headers });
};

// Farm Creation API - Requires Bearer token
export const createFarmWithPlot = (
  data: {
    plot_id: number;
    address: string;
    area_size: number;
    soil_type_id: string;
    crop_type_id: string;
    farm_document: File | null;
  },
  token?: string,
) => {
  const formData = new FormData();
  formData.append("plot_id", data.plot_id.toString());
  formData.append("address", data.address);
  formData.append("area_size", data.area_size.toString());
  formData.append("soil_type_id", data.soil_type_id);
  formData.append("crop_type_id", data.crop_type_id);

  if (data.farm_document) {
    formData.append("farm_document", data.farm_document);
  }

  const headers: any = {
    "Content-Type": "multipart/form-data",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return axios.post(`${API_BASE_URL}/farms/`, formData, { headers });
};

// Farm Registration API - Main endpoint
export const createFarmRegistration = (data: {
  farmer_id: string;
  plots: Array<{
    id: string;
    geometry: any;
    area: {
      sqm: number;
      ha: number;
      acres: number;
    };
    GroupGatNo: string;
    GatNoId: string;
    village: string;
    pin_code: string;
    crop_type: string;
    plantation_Type: string;
    plantation_Method: string;
    plantation_Date: string;
    irrigation_Type: string;
    plants_Per_Acre: string;
    spacing_A: string;
    spacing_B: string;
    flow_Rate: string;
    emitters: string;
    motor_Horsepower: string;
    pipe_Width: string;
    distance_From_Motor: string;
  }>;
  totalArea: {
    sqm: number;
    ha: number;
    acres: number;
  };
  location: {
    lat: string;
    lng: string;
  };
  irrigation: {
    irrigation_type_name: string;
    status: boolean;
    location: {
      type: "Point";
      coordinates: [number, number];
    };
    // Optional fields based on irrigation type
    // plants_per_acre?: number;
    flow_rate_lph?: number;
    emitters_count?: number;
    motor_horsepower?: number;
    pipe_width_inches?: number;
    distance_motor_to_plot_m?: number;
  };
  documents?: FileList | null;
}) => {
  return api.post("/farms/", data);
};

// Utility function to calculate area from GeoJSON polygon coordinates (in hectares)
export const calculatePolygonArea = (
  coordinates: [number, number][],
): number => {
  if (coordinates.length < 3) return 0;

  // Use a simple planar approximation for small agricultural plots
  // This is more suitable for small areas and avoids the large number issue
  let area = 0;

  for (let i = 0; i < coordinates.length; i++) {
    const j = (i + 1) % coordinates.length;
    const [lng1, lat1] = coordinates[i];
    const [lng2, lat2] = coordinates[j];

    // Use the shoelace formula with a simple planar approximation
    // For small agricultural plots, this is sufficiently accurate
    area += ((lng2 - lng1) * (lat2 + lat1)) / 2;
  }

  // Convert to square meters using a simplified conversion
  // For small areas, we can use a local approximation
  const lat = coordinates[0][1]; // Use first coordinate's latitude
  const latRad = (lat * Math.PI) / 180;
  const metersPerDegreeLat = 111320; // meters per degree latitude
  const metersPerDegreeLng = 111320 * Math.cos(latRad); // meters per degree longitude

  const areaSqm = Math.abs(area) * metersPerDegreeLat * metersPerDegreeLng;

  // Convert from square meters to hectares
  const areaHectares = areaSqm / 10000;

  // Round to exactly 2 decimal places as required by the API
  return Math.round(areaHectares * 100) / 100;
};

// Get farmer profile using the dedicated my-profile endpoint
let farmerMyProfileInFlight: ReturnType<typeof api.get> | null = null;

export const getFarmerMyProfile = () => {
  // Check if token exists and is valid before making the call
  const token = getAuthToken();
  if (!token || !isValidToken(token)) {
    // Create a silent error that won't be logged to console
    const error = new Error("No valid authentication token found");
    (error as any).response = {
      status: 403,
      data: { detail: "Authentication credentials were not provided." },
    };
    (error as any).isSilent = true; // Mark as silent to prevent console logging
    return Promise.reject(error);
  }
  if (farmerMyProfileInFlight) {
    return farmerMyProfileInFlight;
  }
  farmerMyProfileInFlight = api.get("/farms/my-profile/").finally(() => {
    farmerMyProfileInFlight = null;
  });
  return farmerMyProfileInFlight;
};

// Farmer profile API function - uses existing endpoints
export const getFarmerProfile = async () => {
  try {
    // First, get the current user data
    const userResponse = await api.get("/users/me/");
    const userData = userResponse.data;

    // Then, get farms for this user using the new API structure
    let farmsData = [];
    let plotsData = [];
    let agriculturalSummary = {
      total_plots: 0,
      total_farms: 0,
      total_irrigations: 0,
      crop_types: [] as string[],
      plantation_types: [] as string[],
      irrigation_types: [] as string[],
      total_farm_area: 0,
    };

    try {
      // Try to get farms by farmer ID using the new API
      const farmsResponse = await api.get("/farms/?include_farmer=true");
      const allFarms = farmsResponse.data.results || farmsResponse.data || [];

      // Filter farms for the current user
      farmsData = allFarms.filter((farm: any) => {
        // Check different possible field names for farmer ID
        const farmFarmerId =
          farm.farmer_id || farm.farmer?.id || farm.user_id || farm.user?.id;
        const matches = farmFarmerId == userData.id;
        return matches;
      });

      // Calculate agricultural summary
      agriculturalSummary.total_farms = farmsData.length;
      agriculturalSummary.total_plots = farmsData.length; // Each farm has one plot

      // Extract unique crop types, plantation types, and irrigation types
      const cropTypes = new Set();
      const plantationTypes = new Set();
      const irrigationTypes = new Set();
      let totalArea = 0;

      farmsData.forEach((farm: any) => {
        if (farm.crop_type_name) cropTypes.add(farm.crop_type_name);
        if (farm.plantation_type) plantationTypes.add(farm.plantation_type);
        if (farm.irrigation_type_name)
          irrigationTypes.add(farm.irrigation_type_name);
        if (farm.area_size_numeric) totalArea += farm.area_size_numeric;
      });

      agriculturalSummary.crop_types = Array.from(cropTypes) as string[];
      agriculturalSummary.plantation_types = Array.from(
        plantationTypes,
      ) as string[];
      agriculturalSummary.irrigation_types = Array.from(
        irrigationTypes,
      ) as string[];
      agriculturalSummary.total_farm_area = totalArea;

      // Transform farms data to plots format
      plotsData = farmsData.map((farm: any, index: number) => ({
        id: farm.id || index + 1,
        fastapi_plot_id: farm.farm_uid || `plot_${index + 1}`,
        gat_number: farm.gat_number || "",
        plot_number: farm.plot_number || "",
        address: {
          village: farm.village || userData.village || "",
          taluka: farm.taluka || userData.taluka || "",
          district: farm.district || userData.district || "",
          state: farm.state || userData.state || "",
          country: farm.country || "India",
          pin_code: farm.pin_code || userData.pin_code || "",
          full_address: `${farm.village || userData.village || ""}, ${
            farm.taluka || userData.taluka || ""
          }, ${farm.district || userData.district || ""}, ${
            farm.state || userData.state || ""
          }`
            .replace(/,\s*,/g, ",")
            .replace(/^,\s*|,\s*$/g, ""),
        },
        coordinates: {
          location: {
            type: "Point",
            coordinates: farm.location?.coordinates || [0, 0],
            latitude: farm.location?.coordinates?.[1] || 0,
            longitude: farm.location?.coordinates?.[0] || 0,
          },
          boundary: {
            type: "Polygon",
            coordinates: farm.boundary?.coordinates || [],
            has_boundary: !!(
              farm.boundary?.coordinates && farm.boundary.coordinates.length > 0
            ),
          },
        },
        farms: [
          {
            id: farm.id,
            farm_uid: farm.farm_uid,
            area_size: farm.area_size,
            area_size_numeric: farm.area_size_numeric,
            soil_type: {
              id: farm.soil_type?.id || 1,
              name: farm.soil_type?.name || "Loamy",
            },
            crop_type: {
              id: farm.crop_type?.id || 1,
              crop_type: farm.crop_type_name || "Sugarcane",
              crop_variety:
                farm.crop_type?.crop_variety || farm.crop_variety || "",
              plantation_type: farm.plantation_type || "adsali",
              plantation_type_display: farm.plantation_type || "Adsali",
              planting_method: farm.planting_method || "3_bud",
              planting_method_display: farm.planting_method || "3 Bud",
            },
          },
        ],
      }));
    } catch (farmsError: any) {
      // Continue with empty farms data
    }

    // Transform the data to match the expected farmer profile structure
    const transformedData = {
      success: true,
      farmer_profile: {
        id: userData.id,
        username: userData.username,
        email: userData.email,
        personal_info: {
          first_name: userData.first_name || "",
          last_name: userData.last_name || "",
          full_name: `${userData.first_name || ""} ${
            userData.last_name || ""
          }`.trim(),
          phone_number: userData.phone_number || "",
          profile_picture: null,
        },
        address_info: {
          address: userData.address || "",
          village: userData.village || "",
          district: userData.district || "",
          state: userData.state || "",
          taluka: userData.taluka || "",
          full_address: `${userData.address || ""}, ${
            userData.village || ""
          }, ${userData.taluka || ""}, ${userData.district || ""}, ${
            userData.state || ""
          }`
            .replace(/,\s*,/g, ",")
            .replace(/^,\s*|,\s*$/g, ""),
        },
        role: {
          id: userData.role_id || userData.role || 1,
          name: userData.role || "farmer",
          display_name: userData.role || "Farmer",
        },
      },
      agricultural_summary: agriculturalSummary,
      plots: plotsData,
    };

    return transformedData;
  } catch (error: any) {
    if (error.response?.status === 401) {
      throw new Error("Authentication failed. Please login again.");
    } else if (error.response?.status === 403) {
      throw new Error(
        "Access denied. You may not have permission to access farmer profile.",
      );
    } else if (error.response?.status >= 500) {
      throw new Error("Server error. Please try again later.");
    } else {
      throw new Error(
        `Failed to fetch farmer profile: ${
          error.response?.data?.detail || error.message
        }`,
      );
    }
  }
};

/** POST /farms/register-farmer/ as multipart/form-data (field names match Django). */
const postRegisterFarmerMultipart = (formData: FormData) =>
  api.post("/farms/register-farmer/", formData, {
    transformRequest: [
      (data, headers) => {
        if (data instanceof FormData && headers) {
          const h = headers as { delete?: (k: string) => void };
          h.delete?.("Content-Type");
        }
        return data;
      },
    ],
  });

/**
 * Single plot registration: JSON parts as strings + optional file `farm_document`.
 * Backend: farmer, plot, farm, irrigation as JSON strings; FILES["farm_document"] optional.
 */
export const registerFarmerAllInOne = async (
  structured: {
    farmer: any;
    plot: any;
    farm: any;
    irrigation: any;
  },
  options?: { farmDocument?: File | null },
) => {
  try {
    const token = getAuthToken();
    const userRole = getUserRole();

    if (!token || !isValidToken(token)) {
      const errorMsg =
        "Authentication required. Please login as a Field Officer or Admin to register farmers.";
      const error = new Error(errorMsg);
      (error as any).response = {
        status: 401,
        data: { detail: errorMsg },
      };
      (error as any).requiresAuth = true;
      throw error;
    }

    const allowedRoles = ["fieldofficer", "manager", "admin", "owner"];
    if (!userRole || !allowedRoles.includes(userRole.toLowerCase())) {
      const errorMsg = `Access denied. Only Field Officers, Managers, and Admins can register farmers. Your current role: ${userRole || "unknown"}. Please login with an authorized account.`;
      const error = new Error(errorMsg);
      (error as any).response = {
        status: 403,
        data: {
          detail: errorMsg,
          message: errorMsg,
        },
      };
      (error as any).requiresAuth = true;
      throw error;
    }

    const fd = new FormData();
    fd.append("farmer", JSON.stringify(structured.farmer));
    fd.append("plot", JSON.stringify(structured.plot));
    fd.append("farm", JSON.stringify(structured.farm));
    fd.append("irrigation", JSON.stringify(structured.irrigation));
    const file = options?.farmDocument;
    if (file) {
      fd.append("farm_document", file);
    }

    const response = await postRegisterFarmerMultipart(fd);
    return response;
  } catch (error: any) {
    // Provide better error messages
    if (
      error.response?.status === 401 ||
      error.response?.status === 403 ||
      error.requiresAuth
    ) {
      // If error already has a detailed message, use it; otherwise enhance it
      const errorMsg =
        error.response?.data?.detail ||
        error.response?.data?.message ||
        error.message ||
        (error.response?.status === 403
          ? "Access denied. Only Field Officers, Managers, and Admins can register farmers."
          : "Authentication credentials were not provided. Please login as a Field Officer or Admin to register farmers.");
      
      const authError = new Error(errorMsg);
      (authError as any).response = error.response || {
        status: error.response?.status || 401,
        data: { detail: errorMsg, message: errorMsg },
      };
      (authError as any).requiresAuth = true;
      throw authError;
    }
    throw error;
  }
};

/**
 * Multipart registration per plot (matches POST /api/farms/register-farmer/).
 * Optional `formData.documents`: first file is sent as `farm_document` on the first plot only
 * (backend expects a single file field name `farm_document`).
 */
export const registerFarmerAllInOneOnly = async (
  formData: any,
  plots: any[],
) => {
  try {
    const token = getAuthToken();
    const userRole = getUserRole();

    if (!token || !isValidToken(token)) {
      const errorMsg =
        "Authentication required. Please login as a Field Officer or Admin to register farmers.";
      const error = new Error(errorMsg);
      (error as any).response = {
        status: 401,
        data: { detail: errorMsg },
      };
      (error as any).requiresAuth = true;
      throw error;
    }

    const allowedRoles = ["fieldofficer", "manager", "admin", "owner"];
    if (!userRole || !allowedRoles.includes(userRole.toLowerCase())) {
      const errorMsg = `Access denied. Only Field Officers, Managers, and Admins can register farmers. Your current role: ${userRole || "unknown"}. Please login with an authorized account.`;
      const error = new Error(errorMsg);
      (error as any).response = {
        status: 403,
        data: {
          detail: errorMsg,
          message: errorMsg,
        },
      };
      (error as any).requiresAuth = true;
      throw error;
    }

    const docList = formData?.documents as FileList | null | undefined;
    const farmDocument =
      docList && docList.length > 0 ? docList[0] : null;

    const allInOneDataArray = convertToAllInOneFormat(formData, plots);
    const results = [];
    for (let i = 0; i < allInOneDataArray.length; i++) {
      const plotPayload = allInOneDataArray[i];
      const result = await registerFarmerAllInOne(plotPayload, {
        farmDocument: i === 0 ? farmDocument : null,
      });
      results.push(result);
      if (i < allInOneDataArray.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    return results.length === 1 ? results[0] : results;
  } catch (error: any) {
    // Enhance error messages for 403 and 401 errors
    if (error.response?.status === 403 || error.response?.status === 401 || error.requiresAuth) {
      // If error doesn't have a detailed message, enhance it
      if (!error.response?.data?.detail && !error.response?.data?.message) {
        const status = error.response?.status || 403;
        const defaultMsg = status === 403
          ? "Access denied. Only Field Officers, Managers, and Admins can register farmers."
          : "Authentication required. Please login to register farmers.";
        
        (error as any).response = {
          status: status,
          data: { 
            detail: defaultMsg,
            message: defaultMsg,
          },
        };
        (error as any).requiresAuth = true;
      }
    }
    
    // Only log non-authentication errors to console
    if (
      !error.requiresAuth &&
      error.response?.status !== 401 &&
      error.response?.status !== 403
    ) {
      console.error("Error in registerFarmerAllInOneOnly:", error);
    }
    throw error;
  }
};

// Normalize form display values to backend API format (avoids "other" when backend expects e.g. 3_bud)
const toApiPlantationType = (display: string | undefined): string => {
  if (!display || typeof display !== "string") return "adsali";
  const v = display.trim().toLowerCase();
  if (["adsali", "suru", "ratoon"].includes(v)) return v;
  if (v === "pre-seasonal" || v === "preseasonal") return "pre-seasonal";
  return v.replace(/\s+/g, "_");
};

const toApiPlantingMethod = (display: string | undefined): string => {
  if (!display || typeof display !== "string") return "3_bud";
  const v = display.trim().toLowerCase();
  if (v === "3 bud" || v === "3_bud" || v === "3-bud") return "3_bud";
  if (v === "2 bud" || v === "2_bud" || v === "2-bud") return "2_bud";
  if (v === "1 bud (stip method)" || v.includes("stip")) return "1_bud_stip";
  if (v === "1 bud" || v === "1_bud" || v === "1-bud") return "1_bud";
  // Fallback: replace spaces with underscore for any other display value
  return v.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
};

// Helper function to convert a single plot to all-in-one API format
const convertSinglePlotToAllInOneFormat = (formData: any, plot: any) => {
  // Calculate center coordinates for location
  const coordinates = plot.geometry?.coordinates?.[0];

  if (!coordinates || coordinates.length === 0) {
    throw new Error(
      "Plot is missing boundary coordinates. Please redraw the plot.",
    );
  }

  const centerLng =
    coordinates.reduce((sum: number, coord: number[]) => sum + coord[0], 0) /
    coordinates.length;
  const centerLat =
    coordinates.reduce((sum: number, coord: number[]) => sum + coord[1], 0) /
    coordinates.length;

  const payload = {
    farmer: {
      username: formData.username,
      email: formData.email,
      password: formData.password,
      first_name: formData.first_name,
      last_name: formData.last_name,
      phone_number: formData.phone_number,
      address: formData.address,
      village: plot.village || formData.district,
      taluka: formData.taluka,
      district: formData.district,
      state: formData.state,
      role_id: 1,
      industry_id: null,
      aadhaar_number: formData.aadhar_card || null,
      sugarcane_type: formData.sugarcane_type || "old",
      last_year_yield:
        formData.sugarcane_type === "new"
          ? null
          : formData.last_year_yield || null,
    },
    plot: {
      gat_number: plot.Group_Gat_No || plot.GroupGatNo || "",
      plot_number: plot.Gat_No_Id || plot.GatNoId || "",
      village: plot.village || formData.district,
      taluka: formData.taluka,
      district: formData.district,
      state: formData.state,
      country: "India",
      pin_code: plot.pin_code || "422605",
      location: {
        type: "Point" as const,
        coordinates: [centerLng, centerLat] as [number, number],
      },
      boundary: {
        type: "Polygon" as const,
        coordinates: [
          coordinates.map((coord: number[]) => [coord[0], coord[1]]),
        ] as [[[number, number]]],
      },
    },
    farm: {
      address: `${plot.village || formData.district}, ${formData.taluka}, ${
        formData.district
      }`,
      area_size: plot.area.ha.toString(),
      plantation_date: plot.plantation_Date || "2024-01-15",
      spacing_a: plot.spacing_A || "3.0",
      spacing_b: plot.spacing_B || "1.5",
      soil_type_name: "Loamy",
      ...(plot.crop_type_id != null
        ? { crop_type_id: plot.crop_type_id }
        : {
            crop_type_name: "Sugarcane",
            plantation_type: toApiPlantationType(plot.plantation_Type),
          }),
      ...(plot.crop_variety && plot.crop_variety.trim()
        ? { crop_variety: plot.crop_variety.trim() }
        : {}),
      planting_method: toApiPlantingMethod(plot.plantation_Method),
    },
    irrigation: {
      irrigation_type_name: plot.irrigation_Type || "drip",
      status: true,
      location: {
        type: "Point" as const,
        coordinates: [centerLng, centerLat] as [number, number],
      },
      // Conditional irrigation details based on type
      ...(plot.irrigation_Type === "drip"
        ? {
            plants_per_acre:
              parseFloat(plot.spacing_A) && parseFloat(plot.spacing_B)
                ? Math.floor(
                    43560 /
                      (parseFloat(plot.spacing_A) * parseFloat(plot.spacing_B)),
                  )
                : 2000,
            flow_rate_lph: parseFloat(plot.flow_Rate) || 2.5,
            emitters_count: parseInt(plot.emitters) || 150,
          }
        : plot.irrigation_Type === "flood"
          ? {
              motor_horsepower: parseFloat(plot.motor_Horsepower) || 7.5,
              pipe_width_inches: parseFloat(plot.pipe_Width) || 6.0,
              distance_motor_to_plot_m:
                parseFloat(plot.distance_From_Motor) || 75.0,
            }
          : {}),
    },
  };

  // Validate that GAT and plot numbers are provided
  if (!payload.plot.gat_number || payload.plot.gat_number.trim() === "") {
    throw new Error(
      "GAT Number is required. Please fill in the GAT Number field in the form.",
    );
  }
  if (!payload.plot.plot_number || payload.plot.plot_number.trim() === "") {
    throw new Error(
      "Plot Number is required. Please fill in the Plot Number field in the form.",
    );
  }

  // Validate the payload before returning
  validateAllInOnePayload(payload);

  return payload;
};

// Helper function to convert form data to all-in-one API format for ALL plots
const convertToAllInOneFormat = (formData: any, plots: any[]) => {
  if (!plots || plots.length === 0) {
    throw new Error("At least one plot is required for registration");
  }

  // Return array of payloads - one for each plot
  return plots.map((plot) => convertSinglePlotToAllInOneFormat(formData, plot));
};

// ==================== SYSTEM/UTILITY API ====================

/**
 * Refreshes various microservice endpoints after a new farm/plot registration
 * or plot boundary edit so Growth/Water/Soil/Pest can pick up the new geometry.
 */
export const refreshApiEndpoints = async (opts?: {
  plotName?: string;
  plotId?: string | number;
}) => {
  const refreshEndpoints = [
    "https://admin-cropeye.up.railway.app/refresh-from-django",
    "https://main-cropeye.up.railway.app/refresh-from-django",
    "https://events-cropeye.up.railway.app/refresh-from-django",
    "https://sef-cropeye.up.railway.app/refresh-from-django",
    "https://cropeye-database-production.up.railway.app/refresh-from-django",
    "https://incredible-magic-production-bd49.up.railway.app/trigger-new-plot",
  ];

  const body: Record<string, string> = {};
  if (opts?.plotName?.trim()) body.plot_name = opts.plotName.trim();
  if (opts?.plotId != null && `${opts.plotId}`.trim()) {
    body.plot_id = String(opts.plotId).trim();
  }

  const refreshPromises = refreshEndpoints.map(async (endpoint) => {
    try {
      // Use plain fetch (not Django `api`) — these hosts are separate services.
      const response = await fetch(endpoint, {
        method: "POST",
        mode: "cors",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          endpoint,
          status: "failed",
          ok: false,
          error: errorText || `HTTP ${response.status}`,
        };
      }
      return { endpoint, status: "success", ok: true, response };
    } catch (error: any) {
      return {
        endpoint,
        status: "failed",
        ok: false,
        error: error?.message || String(error),
      };
    }
  });

  const results = await Promise.allSettled(refreshPromises);
  if (import.meta.env.DEV) {
    console.log(
      "[refresh-from-django]",
      results.map((r) =>
        r.status === "fulfilled" ? r.value : { status: "rejected", error: r.reason },
      ),
    );
  }
  return results;
};

// ==================== EVENTS SERVICE (AGRO STATS) HELPERS ====================

/** Normalized plot name: spaces → `+` (e.g. `188_1 2A` → `188_1+2A`). */
export function formatPlotIdForEventsApi(plotId: string | number): string {
  return String(plotId).trim().replace(/ /g, "+");
}

/** URL encoding for Events API (`188_1+2A` → `188_1%2B2A` per Swagger). */
export function encodePlotIdForEventsUrl(plotId: string | number): string {
  return encodeURIComponent(formatPlotIdForEventsApi(plotId));
}

/** Shown when analyzeSinglePlot returns HTTP 400 (plantation date missing on backend). */
export const PLANTATION_DATE_NOT_PROVIDED_MSG =
  "Plantation date not Provided";

export function isAnalyzeSinglePlotPlantationDateError(err: unknown): boolean {
  return (
    (err as { response?: { status?: number } })?.response?.status === 400
  );
}

// Single-plot agro stats (Manager/Owner/Farmer dashboards)
export const getSinglePlotAgroStats = async (
  plotId: string | number,
  config?: { signal?: AbortSignal; timeout?: number },
) => {
  const url = `https://events-cropeye.up.railway.app/plots/analyzeSinglePlot?plot_id=${encodePlotIdForEventsUrl(plotId)}`;
  const response = await eventsApi.get(url, config);
  return response.data;
};

// New agro stats endpoint for field officer dashboard (all plots under officer)
export const getFieldOfficerAgroStats = async (
  fieldOfficerId: string | number,
  endDate?: string,
  options?: { force?: boolean },
) => {
  const cacheKey = fieldOfficerAgroStatsCacheKey(fieldOfficerId, endDate);
  if (options?.force) {
    removeCache(cacheKey);
    fieldOfficerAgroStatsInFlight.delete(cacheKey);
  } else {
    const cached = getCache(cacheKey, AGRO_STATS_CACHE_TTL_MS);
    if (cached != null) return cached;

    const existing = fieldOfficerAgroStatsInFlight.get(cacheKey);
    if (existing) return existing;
  }

  const dateParam = endDate ? `?end_date=${endDate}` : "";
  const url = `https://events-cropeye.up.railway.app/field-officers/${fieldOfficerId}/agroStats${dateParam}`;

  const pending = (async () => {
    try {
      const response = await eventsApi.get(url);
      const data = response.data;
      if (data != null) setCache(cacheKey, data);
      return data;
    } finally {
      fieldOfficerAgroStatsInFlight.delete(cacheKey);
    }
  })();

  fieldOfficerAgroStatsInFlight.set(cacheKey, pending);
  return pending;
};

/** Field officers assigned to the current manager (or owner).
 *  Cached + single-flight — Harvest + getManagerFieldOfficersAgroStats share one HTTP call. */
export const getMyFieldOfficers = () => {
  const now = Date.now();
  if (
    myFieldOfficersCache &&
    now - myFieldOfficersCache.ts < MY_FIELD_OFFICERS_TTL_MS
  ) {
    return Promise.resolve(myFieldOfficersCache.res);
  }
  if (myFieldOfficersInFlight) return myFieldOfficersInFlight;

  myFieldOfficersInFlight = api
    .get("/users/my-field-officers/")
    .then((res) => {
      myFieldOfficersCache = { res, ts: Date.now() };
      const field_officers = Array.isArray(res?.data?.field_officers)
        ? res.data.field_officers
        : Array.isArray(res?.data)
          ? res.data
          : [];
      setCache(MANAGER_FIELD_OFFICERS_CACHE_KEY, { field_officers });
      return res;
    })
    .finally(() => {
      myFieldOfficersInFlight = null;
    });

  return myFieldOfficersInFlight;
};

/** Merge plot dictionaries from multiple field-officer agroStats responses. */
export function mergeAgroStatsPlotData(
  ...sources: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    Object.assign(merged, source);
  }
  return merged;
}

/**
 * Manager dashboard: fetch agroStats for every field officer under this manager in parallel.
 * Cached + deduped so login prefetch and Harvest/Agro dashboards share one network call per FO.
 * Pass `{ force: true }` to bypass cache and hit Events agroStats again (auto-refresh).
 */
export const getManagerFieldOfficersAgroStats = async (
  endDate?: string,
  options?: { force?: boolean },
): Promise<Record<string, unknown>> => {
  const mergedKey = managerAgroStatsCacheKey(endDate);
  const force = Boolean(options?.force);

  if (force) {
    removeCache(mergedKey);
    managerAgroStatsInFlight.delete(mergedKey);
  } else {
    // Match owner: never treat empty {} as a cache hit — that blocked Expected Yield
    // for 10 minutes after a failed/empty FO list or all-agroStats failure.
    const cachedMerged = getCache(mergedKey, AGRO_STATS_CACHE_TTL_MS) as
      | Record<string, unknown>
      | null;
    if (cachedMerged && Object.keys(cachedMerged).length > 0) {
      return cachedMerged;
    }

    const existingMerged = managerAgroStatsInFlight.get(mergedKey);
    if (existingMerged) return existingMerged;
  }

  const pending = (async (): Promise<Record<string, unknown>> => {
    try {
      const response = await getMyFieldOfficers();
      const data = response?.data;
      const officers: any[] = Array.isArray(data?.field_officers)
        ? data.field_officers
        : Array.isArray(data)
          ? data
          : [];
      const manager = data?.manager ?? null;
      const managers = manager ? [manager] : [];

      if (officers.length === 0) {
        // Do not cache empty — allow retry on next open of Harvest Planning.
        return {};
      }

      const results = await Promise.all(
        officers.map(async (officer) => {
          try {
            const stats = await getFieldOfficerAgroStats(officer.id, endDate, {
              force,
            });
            if (stats) {
              const createdByRaw = officer?.created_by;
              const createdByUsername =
                typeof createdByRaw === "string"
                  ? createdByRaw.trim().match(/^(\S+)/)?.[1]?.toLowerCase()
                  : null;
              const resolvedManager =
                managers.find(
                  (m) =>
                    m?.id === officer?.created_by ||
                    m?.id === officer?.manager_id ||
                    String(m?.id) === String(officer?.manager_id) ||
                    (createdByUsername &&
                      `${m?.username ?? ""}`.trim().toLowerCase() ===
                        createdByUsername),
                ) ?? manager;

              const managerName = resolvedManager
                ? personDisplayName(resolvedManager)
                : "";

              Object.values(stats).forEach((plot: any) => {
                if (typeof plot === "object" && plot !== null) {
                  const foName = personDisplayName(officer);
                  const foRegion =
                    officer.taluka || officer.region || officer.district || "";

                  if (
                    !plot.manager_name &&
                    managerName &&
                    managerName !== "Unknown"
                  ) {
                    plot.manager_name = managerName;
                  }
                  if (
                    !plot.field_officer_name &&
                    foName &&
                    foName !== "Unknown"
                  ) {
                    plot.field_officer_name = foName;
                  }
                  if (officer?.id != null || officer?.user_id != null) {
                    plot.field_officer_id = officer.id ?? officer.user_id;
                  }
                  if (
                    resolvedManager?.id != null ||
                    resolvedManager?.user_id != null
                  ) {
                    plot.manager_id =
                      resolvedManager.id ?? resolvedManager.user_id;
                  }
                  if (!plot.taluka && foRegion) {
                    plot.taluka = foRegion;
                  }
                  if (!plot.region && foRegion) {
                    plot.region = foRegion;
                  }
                  if (
                    !plot.plantation_type &&
                    (officer?.variety_type || officer?.plantation_type)
                  ) {
                    plot.plantation_type =
                      officer.variety_type || officer.plantation_type;
                  }
                  if (
                    !plot.plantation_type_display &&
                    officer?.plantation_type_display
                  ) {
                    plot.plantation_type_display =
                      officer.plantation_type_display;
                  }
                }
              });
            }
            return stats;
          } catch (err) {
            console.error(
              `Error fetching agroStats for field officer ${officer.id}:`,
              err,
            );
            return null;
          }
        }),
      );

      const merged = mergeAgroStatsPlotData(...results);
      if (Object.keys(merged).length > 0) {
        setCache(mergedKey, merged);
      }
      return merged;
    } finally {
      managerAgroStatsInFlight.delete(mergedKey);
    }
  })();

  managerAgroStatsInFlight.set(mergedKey, pending);
  return pending;
};

/**
 * Owner dashboard: fetch agroStats for every field officer under this owner in parallel.
 * Pass `hierarchy` from Harvest to skip duplicate getCurrentUser + getTeamConnect.
 */
export const getOwnerFieldOfficersAgroStats = async (
  endDate?: string,
  options?: {
    hierarchy?: {
      fieldOfficers?: any[];
      managers?: any[];
    };
  },
): Promise<Record<string, unknown>> => {
  const mergedKey = ownerAgroStatsCacheKey(endDate);

  const cached = getCache(mergedKey, AGRO_STATS_CACHE_TTL_MS) as
    | Record<string, unknown>
    | null;
  if (cached && Object.keys(cached).length > 0) {
    return cached;
  }

  const inFlight = ownerAgroStatsInFlight.get(mergedKey);
  if (inFlight) return inFlight;

  const pending = fetchOwnerFieldOfficersAgroStats(endDate, options)
    .then((merged) => {
      if (merged && Object.keys(merged).length > 0) {
        setCache(mergedKey, merged);
      }
      return merged;
    })
    .finally(() => {
      ownerAgroStatsInFlight.delete(mergedKey);
    });

  ownerAgroStatsInFlight.set(mergedKey, pending);
  return pending;
};

const fetchOwnerFieldOfficersAgroStats = async (
  endDate?: string,
  options?: {
    hierarchy?: {
      fieldOfficers?: any[];
      managers?: any[];
    };
  },
): Promise<Record<string, unknown>> => {
  let officers = Array.isArray(options?.hierarchy?.fieldOfficers)
    ? options!.hierarchy!.fieldOfficers!
    : [];
  let managers = Array.isArray(options?.hierarchy?.managers)
    ? options!.hierarchy!.managers!
    : [];

  // Fallback only when Harvest/Agro did not already load hierarchy.
  if (officers.length === 0) {
    const meRes = await getCurrentUser();
    const me = meRes?.data;
    const industryId =
      me?.industry_id ??
      me?.industry?.id ??
      me?.industry?.industry_id ??
      me?.industryId;

    const response = await getTeamConnect(industryId);
    const hierarchy = parseTeamConnectHierarchy(response.data);
    officers = hierarchy.fieldOfficers;
    managers = hierarchy.managers;
  }

  if (officers.length === 0) {
    return {};
  }

  const results = await Promise.all(
    officers.map(async (officer) => {
      try {
        const stats = await getFieldOfficerAgroStats(officer.id, endDate);
        if (stats) {
          const createdByRaw = officer?.created_by;
          const createdByUsername =
            typeof createdByRaw === "string"
              ? createdByRaw.trim().match(/^(\S+)/)?.[1]?.toLowerCase()
              : null;
          const manager =
            managers.find(
              (m) =>
                m?.id === officer?.created_by ||
                m?.id === officer?.manager_id ||
                String(m?.id) === String(officer?.manager_id) ||
                (createdByUsername &&
                  `${m?.username ?? ""}`.trim().toLowerCase() ===
                    createdByUsername),
            ) ?? null;
          const managerName = manager ? personDisplayName(manager) : "";

          // Inject FO metadata into every plot (never write "Unknown" — leave blank for farms API fill)
          Object.values(stats).forEach((plot: any) => {
            if (typeof plot === "object" && plot !== null) {
              const foName = personDisplayName(officer);
              const foRegion =
                officer.taluka || officer.region || officer.district || "";

              if (!plot.manager_name && managerName && managerName !== "Unknown") {
                plot.manager_name = managerName;
              }
              if (
                !plot.field_officer_name &&
                foName &&
                foName !== "Unknown"
              ) {
                plot.field_officer_name = foName;
              }
              if (officer?.id != null || officer?.user_id != null) {
                plot.field_officer_id = officer.id ?? officer.user_id;
              }
              if (manager?.id != null || manager?.user_id != null) {
                plot.manager_id = manager.id ?? manager.user_id;
              }
              if (!plot.taluka && foRegion) {
                plot.taluka = foRegion;
              }
              if (!plot.region && foRegion) {
                plot.region = foRegion;
              }
              if (
                !plot.plantation_type &&
                (officer?.variety_type || officer?.plantation_type)
              ) {
                plot.plantation_type =
                  officer.variety_type || officer.plantation_type;
              }
              if (
                !plot.plantation_type_display &&
                officer?.plantation_type_display
              ) {
                plot.plantation_type_display = officer.plantation_type_display;
              }
            }
          });
        }
        return stats;
      } catch (err) {
        console.error(`Error fetching agroStats for field officer ${officer.id}:`, err);
        return null;
      }
    })
  );

  return mergeAgroStatsPlotData(...results);
};

// Debug function to validate data format before sending
export const validateAllInOnePayload = (payload: any) => {
  const errors: string[] = [];

  // Validate farmer object
  if (!payload.farmer) {
    errors.push("Missing 'farmer' object");
  } else {
    const requiredFarmerFields = [
      "username",
      "email",
      "password",
      "first_name",
      "last_name",
      "phone_number",
    ];
    requiredFarmerFields.forEach((field) => {
      if (!payload.farmer[field]) {
        errors.push(`Missing farmer.${field}`);
      }
    });
  }

  // Validate plot object
  if (!payload.plot) {
    errors.push("Missing 'plot' object");
  } else {
    const requiredPlotFields = [
      "gat_number",
      "plot_number",
      "village",
      "location",
      "boundary",
    ];
    requiredPlotFields.forEach((field) => {
      if (!payload.plot[field]) {
        errors.push(`Missing plot.${field}`);
      }
    });

    // Validate location format
    if (payload.plot.location) {
      if (payload.plot.location.type !== "Point") {
        errors.push("plot.location.type must be 'Point'");
      }
      if (
        !Array.isArray(payload.plot.location.coordinates) ||
        payload.plot.location.coordinates.length !== 2
      ) {
        errors.push("plot.location.coordinates must be [longitude, latitude]");
      }
    }

    // Validate boundary format
    if (payload.plot.boundary) {
      if (payload.plot.boundary.type !== "Polygon") {
        errors.push("plot.boundary.type must be 'Polygon'");
      }
      if (!Array.isArray(payload.plot.boundary.coordinates)) {
        errors.push("plot.boundary.coordinates must be an array");
      }
    }
  }

  // Validate farm object
  if (!payload.farm) {
    errors.push("Missing 'farm' object");
  } else {
    const requiredFarmFields = ["address", "area_size"];
    requiredFarmFields.forEach((field) => {
      if (!payload.farm[field]) {
        errors.push(`Missing farm.${field}`);
      }
    });
  }

  // Validate irrigation object
  if (!payload.irrigation) {
    errors.push("Missing 'irrigation' object");
  }

  if (errors.length > 0) {
    return false;
  }

  return true;
};

// KML/GeoJSON API functions
export const getKMLData = async () => {
  try {
    const response = await axios.get(KML_API_URL);
    return response.data;
  } catch (error: any) {
    throw new Error(
      `Failed to fetch KML data: ${
        error.response?.data?.detail || error.message
      }`,
    );
  }
};

// Get KML data with authentication (if needed)
export const getKMLDataWithAuth = async (token?: string) => {
  const headers: any = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await axios.get(KML_API_URL, { headers });
    return response.data;
  } catch (error: any) {
    throw new Error(
      `Failed to fetch KML data: ${
        error.response?.data?.detail || error.message
      }`,
    );
  }
};

// ==================== PROFILE UPDATE API ====================

/**
 * PATCH /api/users/my-profile/
 * Update logged-in user's personal information.
 */
export const patchUserMyProfile = (data: {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
  address?: string;
  village?: string;
  district?: string;
  state?: string;
  taluka?: string;
  aadhaar_number?: string;
}) => {
  return api.put("/users/my-profile/", data);
};

/**
 * PATCH /api/farms/my-profile/
 * Update logged-in farmer's farm/plot data (partial update).
 */
export const patchFarmMyProfile = (data: {
  farm_id?: number | string;
  plot_id?: number | string;
  gat_number?: string;
  plot_number?: string;
  address?: string;
  area_size?: string;
  plantation_date?: string;
  crop_variety?: string;
  variety_type?: string;
  variety_subtype?: string;
  plantation_type?: string;
  planting_method?: string;
  spacing_a?: string;
  spacing_b?: string;
  row_spacing?: string;
  plant_spacing?: string;
  irrigation_type?: string;
  irrigation_type_name?: string;
  flow_rate_liter_per_hour?: string;
  emitters_per_plant?: number;
  motor_horsepower?: number;
  pipe_width_inches?: number;
  distance_motor_to_plot_m?: number;
  sugarcane_type?: string;
  sugarcane_yield?: string | null;
  plants_in_field?: number;
  boundary?: { type: "Polygon"; coordinates: number[][][] } | null;
  location?: { type: "Point"; coordinates: [number, number] } | null;
  plot?: {
    boundary?: { type: "Polygon"; coordinates: number[][][] } | null;
    location?: { type: "Point"; coordinates: [number, number] } | null;
  };
}) => {
  return api.patch("/farms/my-profile/", data);
};

/**
 * PATCH /api/farms/my-profile/ — plot boundary for logged-in farmer.
 * Farmers get 403 on PATCH /plots/{id}/; use this endpoint instead.
 * Never send null boundary/location — backend rejects clearing existing values.
 */
export const patchFarmerPlotBoundary = (data: {
  boundary: { type: "Polygon"; coordinates: number[][][] };
  location: { type: "Point"; coordinates: [number, number] };
}) => {
  // Backend my-profile PATCH expects plot geometry nested under `plot`
  // (same shape as the farm response: farm.plot.boundary / farm.plot.location).
  return patchFarmMyProfile({
    plot: {
      boundary: data.boundary,
      location: data.location,
    },
  });
};

/** Route plot boundary updates: farmers → my-profile, staff → /plots/{id}/. */
export const updatePlotBoundary = async (
  plotId: string | number,
  data: {
    boundary: { type: "Polygon"; coordinates: number[][][] };
    location: { type: "Point"; coordinates: [number, number] };
  },
) => {
  const role = getUserRole()?.toLowerCase()?.replace(/\s+/g, "");
  if (role === "farmer") {
    return patchFarmerPlotBoundary(data);
  }

  try {
    return await patchPlot(String(plotId), data);
  } catch (error: any) {
    const status = error?.response?.status;
    // Farmers sometimes have a missing/wrong role in localStorage; my-profile still works.
    if (status === 403 || status === 404) {
      return patchFarmerPlotBoundary(data);
    }
    throw error;
  }
};

// ==================== FACTORY PROGRESS API ====================

export type FactoryApiResult =
  | { ok: true; data: unknown }
  | { ok: false; data: unknown };

const PUBLIC_FACTORY_FARMERS_TIMEOUT_MS = 120_000;

function isHtmlDocumentBody(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

function createFetchAbortSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

/** Direct GET with JSON parse — rejects Vercel SPA HTML mistaken for API data. */
async function fetchJsonGet(
  url: string,
  timeoutMs: number,
): Promise<FactoryApiResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: createFetchAbortSignal(timeoutMs),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const errBody = JSON.parse(raw) as { error?: string; detail?: string };
        message = errBody.error ?? errBody.detail ?? message;
      } catch {
        // keep status message
      }
      return { ok: false, data: { error: message } };
    }

    if (contentType.includes("text/html") || isHtmlDocumentBody(raw)) {
      return {
        ok: false,
        data: {
          error: "Yield data could not be loaded. Please try again later.",
        },
      };
    }

    return { ok: true, data: JSON.parse(raw) as unknown };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Request failed";
    return { ok: false, data: { error: message } };
  }
}

function resolveSefIndustrialYieldUrl(ownerId: number): string {
  const query = new URLSearchParams({
    owner_id: String(ownerId),
    source: "auto",
  }).toString();
  // SEF docs: GET /industrial-yield-by-owner?owner_id=2476
  return `${SEF_PRODUCTION_URL}/industrial-yield-by-owner?${query}`;
}

function resolveSefIndustrialYieldUrls(ownerId: number): string[] {
  // Always hosted SEF — never Vite `/api/sef` localhost proxy.
  return [resolveSefIndustrialYieldUrl(ownerId)];
}

function resolvePublicFactoryFarmersUrl(
  ownerId: number,
  factoryName?: string,
): string {
  const params: Record<string, string> = { owner_id: String(ownerId) };
  if (factoryName?.trim()) {
    params.name = factoryName.trim();
  }
  const query = new URLSearchParams(params).toString();
  return `${API_BASE_URL}/users/public-factory-farmers/?${query}`;
}

/** Public: farmers for sugar factories under an owner. */
export async function fetchPublicFactoryFarmers(
  ownerId: number,
  factoryName?: string,
): Promise<FactoryApiResult> {
  return fetchJsonGet(
    resolvePublicFactoryFarmersUrl(ownerId, factoryName),
    PUBLIC_FACTORY_FARMERS_TIMEOUT_MS,
  );
}

/** Industrial yield only — SEF GET `/industrial-yield-by-owner` (public-factory-farmers unchanged). */
export async function fetchIndustrialYieldByOwner(
  ownerId: number,
): Promise<FactoryApiResult> {
  const urls = resolveSefIndustrialYieldUrls(ownerId);
  let lastError = "Failed to load industrial yield data";

  for (const url of urls) {
    const result = await fetchJsonGet(url, SEF_INDUSTRIAL_YIELD_TIMEOUT_MS);
    if (!result.ok) {
      const err = (result.data as { error?: string })?.error;
      if (err) lastError = err;
      continue;
    }
    if (!hasIndustrialYieldFactories(result.data)) {
      lastError = "Industrial yield returned no factories";
      continue;
    }
    return result;
  }

  return { ok: false, data: { error: lastError } };
}

/** Authenticated: industries accessible to the logged-in user. */
export const getIndustries = () => {
  return api.get("/users/industries/");
};

export { fetchPlotBoundaryCoordinates } from "./utils/plotBoundary";

export interface FarmerNote {
  id: number;
  farmer: number;
  farmer_name: string;
  content: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface FarmerNotesListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: FarmerNote[];
}

/** GET /api/notes/?farmer={id} — notes for a farmer (newest first from API). */
export const getFarmerNotes = (farmerId: number | string) =>
  api.get<FarmerNotesListResponse>("/notes/", {
    params: { farmer: farmerId },
  });

/** POST /api/notes/ — add a visit note for a farmer. */
export const createFarmerNote = (farmerId: number | string, content: string) => {
  const farmer = Number(farmerId);
  if (!Number.isFinite(farmer) || farmer <= 0) {
    return Promise.reject(
      new Error(`Invalid farmer id for notes: ${farmerId}`),
    );
  }
  const text = content.trim();
  if (!text) {
    return Promise.reject(new Error("Note content is required."));
  }
  return api.post<FarmerNote>("/notes/", {
    farmer,
    content: text,
  });
};

export default api;