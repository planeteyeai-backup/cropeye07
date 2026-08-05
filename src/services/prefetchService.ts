import {
  getFarmerMyProfile,
  getCurrentUser,
  getFarmsWithFarmerDetails,
  getAllFarmsWithFarmerDetails,
  getTasks,
  getFieldOfficerAgroStats,
  getManagerFieldOfficersAgroStats,
  getMyFieldOfficers,
  managerAgroStatsCacheKey,
  fieldOfficerAgroStatsCacheKey,
  MANAGER_FIELD_OFFICERS_CACHE_KEY,
} from '../api';
import { getFastApiToken } from '../utils/auth';
import { setCache } from '../utils/cache';
import { getCache as getContextCache } from '../components/utils/cache';
import {
  fetchAnalysisTimeline,
} from "./analysisTimeline";
import { persistPlotImageEndDatesFromTimeline } from "../utils/plotImageEndDates";
import {
  buildAdminEndDateCandidates,
  fetchAdminLayerWithDateFallback,
} from "../utils/adminLayerApi";

// Base URLs for external APIs
const EVENTS_BASE_URL = 'https://events-cropeye.up.railway.app';
const WEATHER_BASE_URL = 'https://weather-cropeye.up.railway.app';

interface PrefetchResult {
  success: boolean;
  errors?: string[];
  fetchedEndpoints: string[];
}

type UserRole = 'farmer' | 'manager' | 'admin' | 'fieldofficer' | 'owner' | 'planeteye';

/** Roles that should not prefetch authenticated /farms/ (owner uses public progress APIs). */
const SKIP_FARMS_PREFETCH_ROLES = new Set<UserRole>(['owner', 'planeteye']);

export { MANAGER_FIELD_OFFICERS_CACHE_KEY };

/** Manager Farm Crop Status — field officers + nested farmers (localStorage cache). */
export const prefetchManagerFieldOfficers = async (): Promise<boolean> => {
  try {
    await getMyFieldOfficers(); // single-flight + cache inside api.ts
    return true;
  } catch {
    return false;
  }
};

/**
 * Pre-fetch farmer profile only - fast, blocks navigation until done.
 * Use before navigate so dashboard loads with profile in cache.
 */
export const prefetchFarmerProfile = async (
  setCached: (key: string, data: any) => void
): Promise<boolean> => {
  try {
    const response: any = await getFarmerMyProfile();
    setCached('farmerProfile', response?.data);
    return true;
  } catch {
    return false;
  }
};

/**
 * Pre-fetch field officer agroStats (all plots under that officer).
 * Use on field officer login so "View Field Plot" shows data instantly.
 */
export const prefetchFieldOfficerAgroStats = async (
  setCached: (key: string, data: any) => void,
  fieldOfficerId: string | number
): Promise<boolean> => {
  try {
    // Match FarmCropStatus "today" calculation (timezone-safe)
    const tzOffsetMs = new Date().getTimezoneOffset() * 60000;
    const endDate = new Date(Date.now() - tzOffsetMs).toISOString().slice(0, 10);
    const data = await getFieldOfficerAgroStats(fieldOfficerId, endDate);
    // Cache by end_date so harvested plots (different yieldDataDate) remain correct
    setCached(`fieldOfficerAgroStats_${endDate}`, data);
    setCache(fieldOfficerAgroStatsCacheKey(fieldOfficerId, endDate), data);
    return true;
  } catch (err) {
    console.warn('⚠️ Field officer agroStats prefetch failed:', err);
    return false;
  }
};

/**
 * Pre-fetches all commonly used endpoints on login/app load to improve performance
 * Loads complete data at login and stores in cache for fast representation
 * Runs for ALL roles - farmer gets plot/map data, others get dashboard data
 */
export const prefetchAllData = async (
  setCached: (key: string, data: any) => void,
  selectedPlotName?: string | null,
  role?: UserRole | null
): Promise<PrefetchResult> => {
  const errors: string[] = [];
  const fetchedEndpoints: string[] = [];
  const isFarmer = role === 'farmer' || !role;

  try {
    // 1. Fetch current user (used by all roles)
    const userPromise = getCurrentUser()
      .then((response) => {
        setCached('currentUser', response.data);
        fetchedEndpoints.push('currentUser');
        return response.data;
      })
      .catch((err) => {
        errors.push(`CurrentUser: ${err.message}`);
        return null;
      });

    // 2. For non-farmer roles: prefetch farms and tasks (skip /farms/ for owner/planeteye)
    if (!isFarmer) {
      const commonPromises: Promise<any>[] = [userPromise];

      if (!SKIP_FARMS_PREFETCH_ROLES.has(role as UserRole)) {
        // Manager Harvest needs full pagination — one shared fetch (not first page only).
        const farmsPromise =
          role === 'manager'
            ? getAllFarmsWithFarmerDetails().then((data) => {
                setCached('farmsWithFarmerDetails', data);
                fetchedEndpoints.push('farmsWithFarmerDetails');
                return data;
              })
            : getFarmsWithFarmerDetails().then((response) => {
                const data = response.data?.results || response.data || [];
                setCached('farmsWithFarmerDetails', data);
                fetchedEndpoints.push('farmsWithFarmerDetails');
                return data;
              });
        commonPromises.push(
          farmsPromise.catch((err) => {
            errors.push(`Farms: ${err.message}`);
            return null;
          }),
        );
      }

      commonPromises.push(
        getTasks()
          .then((response) => {
            const data = response.data?.results || response.data || response.data?.data || [];
            setCached('tasks', Array.isArray(data) ? data : []);
            fetchedEndpoints.push('tasks');
            return data;
          })
          .catch((err) => {
            errors.push(`Tasks: ${err.message}`);
            return null;
          }),
      );

      // 2b. For field officer: prefetch agroStats (all plots) so View Field Plot loads instantly
      if (role === 'fieldofficer') {
        const agroPromise = userPromise.then((userData) => {
          const foId = userData?.id;
          if (foId) {
            return prefetchFieldOfficerAgroStats(setCached, foId)
              .then((ok) => {
                if (ok) fetchedEndpoints.push('fieldOfficerAgroStats');
                return ok;
              })
              .catch((err) => {
                errors.push(`FieldOfficerAgroStats: ${err.message}`);
                return false;
              });
          }
          return null;
        });
        commonPromises.push(agroPromise);
      }

      // 2c. For manager: prefetch latest agroStats (no end_date) — same key Harvest Planning uses.
      // Prefetching ?end_date=today often has empty sugar_yield and does not warm Harvest KPIs.
      if (role === 'manager') {
        const managerAgroPromise = getManagerFieldOfficersAgroStats()
          .then((data) => {
            const key = managerAgroStatsCacheKey();
            if (data && Object.keys(data).length > 0) {
              setCached(key, data);
              setCache(key, data);
            }
            fetchedEndpoints.push('managerAgroStats');
            return data;
          })
          .catch((err) => {
            errors.push(`ManagerAgroStats: ${err.message}`);
            return null;
          });
        commonPromises.push(managerAgroPromise);
      }

      await Promise.allSettled(commonPromises);
      return {
        success: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
        fetchedEndpoints,
      };
    }

    // 3. Farmer-specific: use cached profile if available (avoids duplicate fetch after prefetchFarmerProfile)
    let profile = getContextCache('farmerProfile', 10 * 60 * 1000);
    if (!profile) {
      const profilePromise = getFarmerMyProfile()
        .then((response: any) => {
          setCached('farmerProfile', response?.data);
          fetchedEndpoints.push('farmerProfile');
          return response?.data;
        })
        .catch((err) => {
          errors.push(`Profile: ${err.message}`);
          return null;
        });
      profile = await profilePromise;
    }
    
    // Determine plot name from profile if not provided
    let plotName = selectedPlotName;
    if (!plotName && profile?.plots?.length > 0) {
      const firstPlot = profile.plots[0];
      plotName = firstPlot.fastapi_plot_id || 
                 `${firstPlot.gat_number}_${firstPlot.plot_number}` ||
                 firstPlot.plot_name;
    }

    if (!plotName) {
      // Still cache current user if we got it
      await userPromise;
      console.warn('⚠️ No plot name available for pre-fetching');
      return {
        success: errors.length === 0,
        errors,
        fetchedEndpoints,
      };
    }

    // 4. Fetch map layers — try newest timeline date, then older on Admin 404
    let timeline = null as Awaited<ReturnType<typeof fetchAnalysisTimeline>>;
    try {
      timeline = await fetchAnalysisTimeline(plotName);
      if (timeline?.timeline?.length) {
        persistPlotImageEndDatesFromTimeline(plotName, timeline.timeline);
      }
    } catch {
      timeline = null;
    }

    const prefetchLayer = (
      layer: "Growth" | "Water Uptake" | "Soil Moisture" | "PEST",
      cacheLabel: string,
    ) => {
      const candidateDates = buildAdminEndDateCandidates(
        plotName,
        layer,
        timeline?.timeline,
      );
      if (!candidateDates.length) return null;
      return fetchAdminLayerWithDateFallback({
        plotName,
        apiPlotName: plotName,
        layer,
        candidateDates,
      })
        .then(({ data }) => {
          setCached(`${cacheLabel}_${plotName}`, data);
          fetchedEndpoints.push(cacheLabel);
          return data;
        })
        .catch((err) => {
          errors.push(`${layer}: ${err.message}`);
          return null;
        });
    };

    const mapDataPromises: Promise<any>[] = [
      prefetchLayer("Growth", "growthData"),
      prefetchLayer("Water Uptake", "waterUptakeData"),
      prefetchLayer("Soil Moisture", "soilMoistureData"),
      prefetchLayer("PEST", "pestData"),
    ].filter(Boolean) as Promise<any>[];

    // 5. Fetch weather data if plot has coordinates
    let weatherPromise: Promise<any> | null = null;
    if (profile?.plots?.[0]?.coordinates?.location) {
      const plot = profile.plots[0];
      const lat = plot.coordinates.location.latitude;
      const lon = plot.coordinates.location.longitude;
      
      weatherPromise = fetch(`${WEATHER_BASE_URL}/current-weather?lat=${lat}&lon=${lon}`)
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setCached(`weatherData_${plotName}`, data);
            fetchedEndpoints.push('weatherData');
            return data;
          }
          throw new Error(`Weather API: ${res.status}`);
        })
        .catch((err) => {
          errors.push(`Weather: ${err.message}`);
          return null;
        });
    }

    // 6. Fetch plot indices (for FarmerDashboard) - use fastapi_plot_id, Events Service expects this format not numeric plot.id
    const plotId =
      profile?.plots?.[0]?.fastapi_plot_id ||
      (profile?.plots?.[0]
        ? `${profile.plots[0].gat_number}_${profile.plots[0].plot_number}`
        : null) ||
      profile?.plots?.[0]?.id;
    let indicesPromise: Promise<any> | null = null;
    if (plotId) {
      const fastToken = getFastApiToken();
      indicesPromise = fetch(`${EVENTS_BASE_URL}/plots/${plotId}/indices`, {
        headers: fastToken ? { Authorization: `Bearer ${fastToken}` } : undefined,
      })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            const formattedData = data.map((item: any) => ({
              date: new Date(item.date).toISOString().split('T')[0],
              growth: item.NDVI,
              stress: item.NDMI,
              water: item.NDWI,
              moisture: item.NDRE,
            }));
            setCached(`indices_${plotId}`, formattedData);
            fetchedEndpoints.push('indices');
            return formattedData;
          }
          throw new Error(`Indices API: ${res.status}`);
        })
        .catch((err) => {
          errors.push(`Indices: ${err.message}`);
          return null;
        });
    }

    // Execute all promises in parallel (including user for farmer)
    const allPromises = [
      userPromise,
      ...mapDataPromises,
      weatherPromise,
      indicesPromise,
    ].filter(Boolean) as Promise<any>[];

    await Promise.allSettled(allPromises);

    console.log('✅ Pre-fetch completed:', {
      fetched: fetchedEndpoints.length,
      endpoints: fetchedEndpoints,
      errors: errors.length > 0 ? errors : undefined,
    });

    return {
      success: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      fetchedEndpoints,
    };
  } catch (error: any) {
    console.error('❌ Pre-fetch error:', error);
    return {
      success: false,
      errors: [error.message || 'Unknown error'],
      fetchedEndpoints,
    };
  }
};
