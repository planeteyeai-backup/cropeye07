import {
  getFarmerMyProfile,
  getCurrentUser,
  getFarmsWithFarmerDetails,
  getTasks,
  getFieldOfficerAgroStats,
} from '../api';
import { getFastApiToken } from '../utils/auth';
import { getCache } from '../components/utils/cache';
import { getOrFetchJson } from "../utils/requestCache";

// Base URLs for external APIs
const BASE_URL = 'https://admin-cropeye.up.railway.app';
const EVENTS_BASE_URL = 'https://events-cropeye.up.railway.app';
const WEATHER_BASE_URL = 'https://weather-cropeye.up.railway.app';

interface PrefetchResult {
  success: boolean;
  errors?: string[];
  fetchedEndpoints: string[];
}

type UserRole = 'farmer' | 'manager' | 'admin' | 'fieldofficer' | 'owner';

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
  const today = new Date().toISOString().split('T')[0];
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

    // 2. For non-farmer roles: prefetch farms and tasks
    if (!isFarmer) {
      const commonPromises: Promise<any>[] = [
        userPromise,
        getFarmsWithFarmerDetails()
          .then((response) => {
            const data = response.data?.results || response.data || [];
            setCached('farmsWithFarmerDetails', data);
            fetchedEndpoints.push('farmsWithFarmerDetails');
            return data;
          })
          .catch((err) => {
            errors.push(`Farms: ${err.message}`);
            return null;
          }),
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
      ];

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

      await Promise.allSettled(commonPromises);
      return {
        success: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
        fetchedEndpoints,
      };
    }

    // 3. Farmer-specific: use cached profile if available (avoids duplicate fetch after prefetchFarmerProfile)
    let profile = getCache('farmerProfile', 10 * 60 * 1000);
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

    // 4. Fetch all map layer data in parallel (Growth, Water Uptake, Soil Moisture, Pest)
    const mapDataPromises = [
      // Growth data
      getOrFetchJson({
        key: `layer:growth:${plotName}:${today}`,
        url: `${BASE_URL}/analyze_Growth?plot_name=${plotName}&end_date=${today}&days_back=7`,
        ttlMs: 10 * 60 * 1000,
        fetchInit: {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          credentials: "omit",
          headers: { Accept: "application/json" },
        },
      })
        .then((data) => {
          setCached(`growthData_${plotName}`, data);
          fetchedEndpoints.push("growthData");
          return data;
        })
        .catch((err) => {
          errors.push(`Growth: ${err.message}`);
          return null;
        }),

      // Water Uptake data
      getOrFetchJson({
        key: `layer:water:${plotName}:${today}`,
        url: `${BASE_URL}/wateruptake?plot_name=${plotName}&end_date=${today}&days_back=7`,
        ttlMs: 10 * 60 * 1000,
        fetchInit: {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          credentials: "omit",
          headers: { Accept: "application/json" },
        },
      })
        .then((data) => {
          setCached(`waterUptakeData_${plotName}`, data);
          fetchedEndpoints.push("waterUptakeData");
          return data;
        })
        .catch((err) => {
          errors.push(`Water Uptake: ${err.message}`);
          return null;
        }),

      // Soil Moisture data
      getOrFetchJson({
        key: `layer:soil:${plotName}:${today}`,
        url: `${BASE_URL}/SoilMoisture?plot_name=${plotName}&end_date=${today}&days_back=7`,
        ttlMs: 10 * 60 * 1000,
        fetchInit: {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          credentials: "omit",
          headers: { Accept: "application/json" },
        },
      })
        .then((data) => {
          setCached(`soilMoistureData_${plotName}`, data);
          fetchedEndpoints.push("soilMoistureData");
          return data;
        })
        .catch((err) => {
          errors.push(`Soil Moisture: ${err.message}`);
          return null;
        }),

      // Pest detection data
      getOrFetchJson({
        key: `layer:pest:${plotName}:${today}`,
        url: `${BASE_URL}/pest-detection?plot_name=${plotName}&end_date=${today}&days_back=7`,
        ttlMs: 10 * 60 * 1000,
        fetchInit: {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          credentials: "omit",
          headers: { Accept: "application/json" },
        },
      })
        .then((data) => {
          setCached(`pestData_${plotName}`, data);
          fetchedEndpoints.push("pestData");
          return data;
        })
        .catch((err) => {
          errors.push(`Pest: ${err.message}`);
          return null;
        }),
    ];

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
