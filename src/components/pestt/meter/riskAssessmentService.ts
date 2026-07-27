import { pestsData } from './pestsData';
import { diseasesData } from './diseasesData';
import { getFarmerMyProfile } from '../../../api';
import { getCache, setCache } from '../../../components/utils/cache';
import {
  fetchAnalysisTimeline,
  latestRebinDateForLayer,
} from '../../../services/analysisTimeline';
import { resolveApiPlotName } from '../../../utils/plotName';

/** Get farmer profile - uses cache first (from login prefetch) to avoid duplicate my-profile/ requests */
async function getProfileData(): Promise<any> {
  const cached = getCache('farmerProfile', 10 * 60 * 1000); // 10 min TTL
  if (cached) return cached;
  const response = await getFarmerMyProfile();
  return response.data;
}

export interface WeatherData {
  temperature: number;
  humidity: number;
  month: string;
}

export interface PestDetectionData {
  fungi_affected_pixel_percentage: number;
  chewing_affected_pixel_percentage: number;
  sucking_affected_pixel_percentage: number;
  SoilBorn_affected_pixel_percentage: number;
}

export interface RiskAssessmentResult {
  stage: string;
  current_conditions: {
    month: string;
    temperature: string;
    humidity: string;
  };
  pests: {
    High: string[];
    Moderate: string[];
    Low: string[];
  };
  diseases: {
    High: string[];
    Moderate: string[];
    Low: string[];
  };
}

export interface SugarcaneStage {
  name: string;
  minDays: number;
  maxDays: number;
}

export const SUGARCANE_STAGES: SugarcaneStage[] = [
  {
    name: "Germination & Early Growth",
    minDays: 0,
    maxDays: 45
  },
  {
    name: "Tillering & Early Stem Elongation",
    minDays: 46,
    maxDays: 120
  },
  {
    name: "Grand Growth Phase",
    minDays: 121,
    maxDays: 210
  },
  {
    name: "Ripening & Maturity",
    minDays: 211,
    maxDays: 365
  }
];

/**
 * Calculate sugarcane stage based on plantation date
 */
export function calculateSugarcaneStage(plantationDate: string): string {
  const today = new Date();
  const plantation = new Date(plantationDate);
  
  const daysSincePlantation = Math.floor((today.getTime() - plantation.getTime()) / (1000 * 60 * 60 * 24));
  
  for (const stage of SUGARCANE_STAGES) {
    if (daysSincePlantation >= stage.minDays && daysSincePlantation <= stage.maxDays) {
      return stage.name;
    }
  }
  
  // If beyond 365 days, return the last stage
  return "Ripening & Maturity";
}

/**
 * Check if temperature and humidity fall within pest/disease ranges
 */
function checkTemperatureHumidityMatch(
  pestTemp: string,
  pestHumidity: string,
  currentTemp: number,
  currentHumidity: number
): { tempMatch: boolean; humidityMatch: boolean } {
  // Parse temperature range (e.g., "28-32" -> min: 28, max: 32)
  const tempRange = pestTemp.split('-').map(t => parseFloat(t.trim()));
  const tempMin = tempRange[0];
  const tempMax = tempRange[1];
  
  // Parse humidity range (e.g., "70-80" -> min: 70, max: 80)
  const humidityRange = pestHumidity.split('-').map(h => parseFloat(h.trim()));
  const humidityMin = humidityRange[0];
  const humidityMax = humidityRange[1];
  
  const tempMatch = currentTemp >= tempMin && currentTemp <= tempMax;
  const humidityMatch = currentHumidity >= humidityMin && currentHumidity <= humidityMax;
  
  return { tempMatch, humidityMatch };
}

/**
 * Calculate days since plantation
 */
export function calculateDaysSincePlantation(plantationDate: string): number {
  const today = new Date();
  const plantation = new Date(plantationDate);
  
  if (isNaN(plantation.getTime())) {
    // Try parsing different date formats
    const parts = plantationDate.split("-");
    if (parts.length === 3) {
      plantation.setFullYear(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
  }
  
  const daysSincePlantation = Math.floor((today.getTime() - plantation.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, daysSincePlantation);
}

/**
 * Assess pest risk based on API percentage, stage (days), and month
 * High: API percentage > 0 (legend circle) AND stage matches AND month matches
 * Moderate: Stage matches AND month matches
 * Low: Month matches only
 */
function assessPestRisk(
  pest: any,
  daysSincePlantation: number,
  currentMonth: string,
  currentTemp: number,
  currentHumidity: number,
  pestDetectionData?: PestDetectionData
): 'High' | 'Moderate' | 'Low' | null {
  // Check if API detected this pest category (legend circle shows percentage)
  let apiPercentage = 0;
  if (pestDetectionData) {
    if (pest.category === 'chewing') {
      apiPercentage = pestDetectionData.chewing_affected_pixel_percentage || 0;
    } else if (pest.category === 'sucking') {
      apiPercentage = pestDetectionData.sucking_affected_pixel_percentage || 0;
    } else if (pest.category === 'soil_borne') {
      apiPercentage = pestDetectionData.SoilBorn_affected_pixel_percentage || 0;
    }
  }
  
  // Check if stage matches (days since plantation)
  let stageMatch = true; // Default to true if no stage info
  if (pest.stage) {
    stageMatch = daysSincePlantation >= pest.stage.minDays && daysSincePlantation <= pest.stage.maxDays;
  }
  
  // Check if month matches (case-insensitive comparison)
  const currentMonthNormalized = currentMonth?.trim().toLowerCase() || '';
  const pestMonths = Array.isArray(pest.months) ? pest.months : [];
  const pestMonthsNormalized = pestMonths.map((m: string) => String(m).trim().toLowerCase());
  const monthMatch = pestMonthsNormalized.includes(currentMonthNormalized);
  
  // High: API percentage > 0 (legend circle) AND stage matches AND month matches
  if (apiPercentage > 0 && stageMatch && monthMatch) {
    console.log(`🔍 Pest Assessment: ${pest.name} -> HIGH (API: ${apiPercentage}%, Stage: ✓, Month: ✓)`);
    return 'High';
  }
  
  // Moderate: Stage matches AND month matches
  if (stageMatch && monthMatch) {
    console.log(`🔍 Pest Assessment: ${pest.name} -> MODERATE (Stage: ✓, Month: ✓)`);
    return 'Moderate';
  }
  
  // Low: Month matches only
  if (monthMatch) {
    console.log(`🔍 Pest Assessment: ${pest.name} -> LOW (Month: ✓)`);
    return 'Low';
  }
  
  // Don't display if month doesn't match
  return null;
}

/**
 * Assess disease risk based on API percentage (fungi), stage (days), and month
 * High: API fungi percentage > 0 (legend circle) AND stage matches AND month matches (for fungal diseases only)
 * Moderate: Stage matches AND month matches
 * Low: Month matches only
 */
function assessDiseaseRisk(
  disease: any,
  daysSincePlantation: number,
  currentMonth: string,
  currentTemp: number,
  currentHumidity: number,
  pestDetectionData?: PestDetectionData
): 'High' | 'Moderate' | 'Low' | null {
  // Check if API detected fungi (legend circle shows fungi percentage)
  const fungiPercentage = pestDetectionData?.fungi_affected_pixel_percentage || 0;
  
  // Check if stage matches (days since plantation)
  let stageMatch = true; // Default to true if no stage info
  if (disease.stage) {
    stageMatch = daysSincePlantation >= disease.stage.minDays && daysSincePlantation <= disease.stage.maxDays;
  }
  
  // Check if month matches (case-insensitive comparison)
  const currentMonthNormalized = currentMonth?.trim().toLowerCase() || '';
  const diseaseMonths = Array.isArray(disease.months) ? disease.months : [];
  const diseaseMonthsNormalized = diseaseMonths.map((m: string) => String(m).trim().toLowerCase());
  const monthMatch = diseaseMonthsNormalized.includes(currentMonthNormalized);
  
  // For fungal diseases (Red Rot, Rust, Smut, Wilt, Downy Mildew), check API percentage
  const isFungalDisease = ['Red Rot', 'Rust', 'Smut', 'Wilt', 'Downy Mildew'].includes(disease.name);
  
  // High: API fungi percentage > 0 (legend circle) AND stage matches AND month matches (for fungal diseases only)
  if (isFungalDisease && fungiPercentage > 0 && stageMatch && monthMatch) {
    console.log(`🔍 Disease Assessment: ${disease.name} -> HIGH (Fungi: ${fungiPercentage}%, Stage: ✓, Month: ✓)`);
    return 'High';
  }
  
  // Moderate: Stage matches AND month matches
  if (stageMatch && monthMatch) {
    console.log(`🔍 Disease Assessment: ${disease.name} -> MODERATE (Stage: ✓, Month: ✓)`);
    return 'Moderate';
  }
  
  // Low: Month matches only
  if (monthMatch) {
    console.log(`🔍 Disease Assessment: ${disease.name} -> LOW (Month: ✓)`);
    return 'Low';
  }
  
  // Don't display if month doesn't match
  return null;
}

/**
 * Fetch pest detection data from API
 */
export async function fetchPestDetectionData(plotId?: string): Promise<PestDetectionData> {
  try {
    // Check if token exists before making API call
    const token = localStorage.getItem('token');
    if (!token) {
      console.warn('No authentication token found for pest detection');
      return {
        fungi_affected_pixel_percentage: 0,
        chewing_affected_pixel_percentage: 0,
        sucking_affected_pixel_percentage: 0,
        SoilBorn_affected_pixel_percentage: 0,
      };
    }

    const profileData = await getProfileData();
    
    if (!profileData.plots || profileData.plots.length === 0) {
      console.warn('No plots found in user profile for pest detection');
      return {
        fungi_affected_pixel_percentage: 0,
        chewing_affected_pixel_percentage: 0,
        sucking_affected_pixel_percentage: 0,
        SoilBorn_affected_pixel_percentage: 0,
      };
    }

    // Find selected plot or use first plot
    let selectedPlot = null;
    if (plotId) {
      selectedPlot = profileData.plots.find((p: any) => 
        p.fastapi_plot_id === plotId ||
        `${p.gat_number}_${p.plot_number}` === plotId ||
        p.plot_name === plotId
      );
    }
    
    if (!selectedPlot) {
      selectedPlot = profileData.plots[0];
    }

    const plotName =
      resolveApiPlotName(
        plotId ||
          selectedPlot.fastapi_plot_id ||
          selectedPlot.plot_name ||
          `${selectedPlot.gat_number}_${selectedPlot.plot_number}`,
        profileData.plots,
      ) ||
      selectedPlot.fastapi_plot_id ||
      selectedPlot.plot_name ||
      `${selectedPlot.gat_number}_${selectedPlot.plot_number}`;

    // Cache-first: prefetch + Map store pestData_${plotName}
    const cacheKey = `pestData_${plotName}`;
    const cached = getCache(cacheKey, 10 * 60 * 1000); // 10 min TTL
    if (cached?.pixel_summary) {
      const ps = cached.pixel_summary;
      return {
        fungi_affected_pixel_percentage: ps.fungi_affected_pixel_percentage || 0,
        chewing_affected_pixel_percentage: ps.chewing_affected_pixel_percentage || 0,
        sucking_affected_pixel_percentage: ps.sucking_affected_pixel_percentage || 0,
        SoilBorn_affected_pixel_percentage: ps.SoilBorn_affected_pixel_percentage || 0,
      };
    }

    // Always use latest pest image date — today has no Sentinel imagery (404).
    let endDate = "";
    try {
      const timeline = await fetchAnalysisTimeline(plotName);
      endDate = latestRebinDateForLayer(timeline?.timeline, "PEST");
    } catch {
      endDate = "";
    }
    if (!endDate) {
      console.warn(
        `No pest image dates in timeline for plot ${plotName}; skipping pest-detection API`,
      );
      return {
        fungi_affected_pixel_percentage: 0,
        chewing_affected_pixel_percentage: 0,
        sucking_affected_pixel_percentage: 0,
        SoilBorn_affected_pixel_percentage: 0,
      };
    }
    
    // Use proxy in development to avoid CORS issues, direct URL in production
    const baseUrl = import.meta.env.DEV 
      ? '/api/dev-plot' 
      : 'https://admin-cropeye.up.railway.app';
    const url = `${baseUrl}/pest-detection?plot_name=${encodeURIComponent(plotName)}&end_date=${endDate}&days_back=15`;
    
    // Add timeout to prevent hanging on 503 errors
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
      // Try fetch with explicit CORS mode and proper headers matching curl command
      const postResponse = await fetch(url, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        credentials: "omit",
        headers: { 
          "Accept": "application/json"
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (postResponse.ok) {
        const pestData = await postResponse.json();
        setCache(cacheKey, pestData); // Cache for Map and future calls
        const pixelSummary = pestData.pixel_summary || {};
        return {
          fungi_affected_pixel_percentage: pixelSummary.fungi_affected_pixel_percentage || 0,
          chewing_affected_pixel_percentage: pixelSummary.chewing_affected_pixel_percentage || 0,
          sucking_affected_pixel_percentage: pixelSummary.sucking_affected_pixel_percentage || 0,
          SoilBorn_affected_pixel_percentage: pixelSummary.SoilBorn_affected_pixel_percentage || 0,
        };
      }
      
      // Handle 503 Service Unavailable and other errors gracefully
      if (postResponse.status === 503) {
        console.warn(`⚠️ Pest detection API is temporarily unavailable (503). Using default values.`);
      } else {
        console.warn(`⚠️ Pest detection API error: ${postResponse.status}`);
      }
      
      // Return default values on any error
      return {
        fungi_affected_pixel_percentage: 0,
        chewing_affected_pixel_percentage: 0,
        sucking_affected_pixel_percentage: 0,
        SoilBorn_affected_pixel_percentage: 0,
      };
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      // Handle timeout or network errors
      if (fetchError.name === 'AbortError') {
        console.warn('⚠️ Pest detection API request timed out. Using default values.');
      } else {
        console.warn('⚠️ Error fetching pest detection data:', fetchError?.message || fetchError);
      }
      
      return {
        fungi_affected_pixel_percentage: 0,
        chewing_affected_pixel_percentage: 0,
        sucking_affected_pixel_percentage: 0,
        SoilBorn_affected_pixel_percentage: 0,
      };
    }
    
  } catch (error: any) {
    console.warn('Error fetching pest detection data:', error?.message || error);
    return {
      fungi_affected_pixel_percentage: 0,
      chewing_affected_pixel_percentage: 0,
      sucking_affected_pixel_percentage: 0,
      SoilBorn_affected_pixel_percentage: 0,
    };
  }
}

/**
 * Main function to generate pest and disease risk assessment
 */
export async function generateRiskAssessment(
  plantationDate: string,
  weatherData: WeatherData,
  plotId?: string,
  pestDetectionDataOverride?: PestDetectionData
): Promise<RiskAssessmentResult> {
  try {
    // Calculate days since plantation
    const daysSincePlantation = calculateDaysSincePlantation(plantationDate);
    
    // Calculate current sugarcane stage
    const currentStage = calculateSugarcaneStage(plantationDate);
    
    // Extract current conditions
    const currentMonth = weatherData.month;
    const currentTemp = weatherData.temperature;
    const currentHumidity = weatherData.humidity;
    
    console.log('🌱 Risk Assessment Input Data:', {
      'Plantation Date': plantationDate,
      'Days Since Plantation': daysSincePlantation,
      'Current Stage': currentStage,
      'Current Month': currentMonth,
      'Temperature': currentTemp,
      'Humidity': currentHumidity,
      'Plot ID': plotId
    });
    
    // Use provided pest detection data or fetch it if not provided
    let pestDetectionData: PestDetectionData | undefined;
    if (pestDetectionDataOverride) {
      pestDetectionData = pestDetectionDataOverride;
      console.log('📊 Using provided pest detection API data:', pestDetectionData);
    } else {
      try {
        pestDetectionData = await fetchPestDetectionData(plotId);
        console.log('📊 Pest detection API data:', pestDetectionData);
      } catch (error) {
        console.warn('⚠️ Error fetching pest detection data:', error);
        pestDetectionData = {
          fungi_affected_pixel_percentage: 0,
          chewing_affected_pixel_percentage: 0,
          sucking_affected_pixel_percentage: 0,
          SoilBorn_affected_pixel_percentage: 0,
        };
      }
    }
    
    // Initialize result
    const result: RiskAssessmentResult = {
      stage: currentStage,
      current_conditions: {
        month: currentMonth,
        temperature: `${currentTemp}°C`,
        humidity: `${currentHumidity}%`
      },
      pests: {
        High: [],
        Moderate: [],
        Low: []
      },
      diseases: {
        High: [],
        Moderate: [],
        Low: []
      }
    };
    
    // Determine which pest categories have percentage > 0 (legend circle shows percentage)
    const activeCategories: string[] = [];
    if (pestDetectionData) {
      if (pestDetectionData.chewing_affected_pixel_percentage > 0) {
        activeCategories.push('chewing');
      }
      if (pestDetectionData.sucking_affected_pixel_percentage > 0) {
        activeCategories.push('sucking');
      }
      if (pestDetectionData.SoilBorn_affected_pixel_percentage > 0) {
        activeCategories.push('soil_borne');
      }
    }
    
    console.log('📋 Active Pest Categories (with percentage > 0):', activeCategories.length > 0 ? activeCategories.join(', ') : 'NONE');
    
    // Assess pest risks: Process ALL pests to determine High, Moderate, or Low risk
    // High: API percentage > 0 (legend circle) AND stage matches AND month matches
    // Moderate: Stage matches AND month matches
    // Low: Month matches only
    for (const pest of pestsData) {
      try {
        const riskLevel = assessPestRisk(
          pest,
          daysSincePlantation,
          currentMonth,
          currentTemp,
          currentHumidity,
          pestDetectionData
        );
        
        // Add to appropriate risk level array
        if (riskLevel === 'High') {
          result.pests.High.push(pest.name);
        } else if (riskLevel === 'Moderate') {
          result.pests.Moderate.push(pest.name);
        } else if (riskLevel === 'Low') {
          result.pests.Low.push(pest.name);
        }
      } catch (error) {
        console.warn(`⚠️ Error assessing risk for pest "${pest?.name || 'unknown'}":`, error);
        // Continue processing other pests
      }
    }
    
    // Check if fungi percentage > 0 (legend circle shows fungi percentage)
    const hasFungi = pestDetectionData?.fungi_affected_pixel_percentage > 0;
    console.log('🍄 Fungal Diseases Active:', hasFungi ? `YES (${pestDetectionData?.fungi_affected_pixel_percentage}%)` : 'NO');
    
    // Assess disease risks: Process ALL diseases to determine High, Moderate, or Low risk
    // High: API fungi percentage > 0 (legend circle) AND stage matches AND month matches (for fungal diseases only)
    // Moderate: Stage matches AND month matches
    // Low: Month matches only
    for (const disease of diseasesData) {
      try {
        const riskLevel = assessDiseaseRisk(
          disease,
          daysSincePlantation,
          currentMonth,
          currentTemp,
          currentHumidity,
          pestDetectionData
        );
        
        // Add to appropriate risk level array
        if (riskLevel === 'High') {
          result.diseases.High.push(disease.name);
        } else if (riskLevel === 'Moderate') {
          result.diseases.Moderate.push(disease.name);
        } else if (riskLevel === 'Low') {
          result.diseases.Low.push(disease.name);
        }
      } catch (error) {
        console.warn(`⚠️ Error assessing risk for disease "${disease?.name || 'unknown'}":`, error);
        // Continue processing other diseases
      }
    }
    
    console.log('📊 Risk assessment result:', {
      daysSincePlantation,
      currentStage,
      currentMonth,
      pestDetectionData,
      pestsCount: {
        high: result.pests.High.length,
        moderate: result.pests.Moderate.length,
        low: result.pests.Low.length
      },
      pestsHigh: result.pests.High, // Show which pests are in High
      diseasesCount: {
        high: result.diseases.High.length,
        moderate: result.diseases.Moderate.length,
        low: result.diseases.Low.length
      },
      diseasesHigh: result.diseases.High // Show which diseases are in High
    });
    
    // Log summary of API detection and results
    if (pestDetectionData) {
      const hasChewing = pestDetectionData.chewing_affected_pixel_percentage > 0;
      const hasSucking = pestDetectionData.sucking_affected_pixel_percentage > 0;
      const hasSoilBorn = pestDetectionData.SoilBorn_affected_pixel_percentage > 0;
      const hasFungi = pestDetectionData.fungi_affected_pixel_percentage > 0;
      
      console.log('📊 Final API Detection Summary:', {
        'Chewing percentage': pestDetectionData.chewing_affected_pixel_percentage,
        'Sucking percentage': pestDetectionData.sucking_affected_pixel_percentage,
        'Soil Born percentage': pestDetectionData.SoilBorn_affected_pixel_percentage,
        'Fungi percentage': pestDetectionData.fungi_affected_pixel_percentage,
        'Active Categories': activeCategories.length > 0 ? activeCategories.join(', ') : 'NONE',
        'Pests': {
          'High': result.pests.High.length,
          'Moderate': result.pests.Moderate.length,
          'Low': result.pests.Low.length
        },
        'Diseases': {
          'High': result.diseases.High.length,
          'Moderate': result.diseases.Moderate.length,
          'Low': result.diseases.Low.length
        },
        'High Risk Pests': result.pests.High,
        'Moderate Risk Pests': result.pests.Moderate,
        'Low Risk Pests': result.pests.Low,
        'High Risk Diseases': result.diseases.High,
        'Moderate Risk Diseases': result.diseases.Moderate,
        'Low Risk Diseases': result.diseases.Low
      });
      
      // Log summary of risk distribution
      const totalPests = result.pests.High.length + result.pests.Moderate.length + result.pests.Low.length;
      const totalDiseases = result.diseases.High.length + result.diseases.Moderate.length + result.diseases.Low.length;
      console.log('📊 Risk Distribution Summary:', {
        'Total Pests': totalPests,
        'Total Diseases': totalDiseases,
        'Note': 'High = API detected (legend circle) + stage + month match, Moderate = stage + month match, Low = month match only'
      });
    }
    
    return result;
    
  } catch (error) {
    console.error('Error generating risk assessment:', error);
    throw new Error('Failed to generate risk assessment');
  }
}

/**
 * Fetch plantation date from farmer profile API
 */
export async function fetchPlantationDate(plotId?: string): Promise<string> {
  try {
    // Check if token exists before making API call
    const token = localStorage.getItem('token');
    if (!token) {
      console.warn('⚠️ No authentication token found, using fallback date');
      return new Date().toISOString().split('T')[0];
    }

    console.log('📅 Fetching plantation date for plot:', plotId);
    const profileData = await getProfileData();
    
    if (!profileData.plots || profileData.plots.length === 0) {
      console.warn('⚠️ No plots found in profile, using fallback date');
      return new Date().toISOString().split('T')[0];
    }

    // Find selected plot or use first plot
    let selectedPlot = null;
    if (plotId) {
      selectedPlot = profileData.plots.find((p: any) => 
        p.fastapi_plot_id === plotId ||
        `${p.gat_number}_${p.plot_number}` === plotId
      );
      console.log('🔍 Looking for plot:', plotId, 'Found:', selectedPlot ? 'Yes' : 'No');
    }
    
    if (!selectedPlot) {
      selectedPlot = profileData.plots[0];
      console.log('📋 Using first plot from profile:', selectedPlot.fastapi_plot_id || `${selectedPlot.gat_number}_${selectedPlot.plot_number}`);
    }

    // Get plantation date from plot's farms
    if (selectedPlot.farms && selectedPlot.farms.length > 0) {
      const firstFarm = selectedPlot.farms[0];
      if (firstFarm.plantation_date) {
        console.log('✅ Plantation date found:', firstFarm.plantation_date);
        return firstFarm.plantation_date;
      } else {
        console.warn('⚠️ No plantation_date in farm data, using fallback');
      }
    } else {
      console.warn('⚠️ No farms found in selected plot, using fallback date');
    }
    
    // Fallback to current date if no plantation date found
    const fallbackDate = new Date().toISOString().split('T')[0];
    console.warn('⚠️ Using fallback plantation date:', fallbackDate);
    return fallbackDate;
    
  } catch (error: any) {
    console.warn('⚠️ Error fetching plantation date, using fallback:', error?.message || error);
    // Return today's date as fallback - don't throw error, just use fallback
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Fetch current weather data using user's location from farmer profile
 */
export async function fetchCurrentWeather(plotId?: string): Promise<WeatherData> {
  try {
    // Check if token exists before making API call
    const token = localStorage.getItem('token');
    if (!token) {
      console.warn('No authentication token found, using default weather data');
      // Return default weather data instead of throwing error
      const currentDate = new Date();
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      const currentMonth = monthNames[currentDate.getMonth()];
      
      return {
        temperature: 25, // Default temperature
        humidity: 60, // Default humidity
        month: currentMonth
      };
    }

    const profileData = await getProfileData();
    
    if (!profileData.plots || profileData.plots.length === 0) {
      throw new Error('No plots found in user profile');
    }

    // Find selected plot or use first plot
    let selectedPlot = null;
    if (plotId) {
      selectedPlot = profileData.plots.find((p: any) => 
        p.fastapi_plot_id === plotId ||
        `${p.gat_number}_${p.plot_number}` === plotId
      );
    }
    
    if (!selectedPlot) {
      selectedPlot = profileData.plots[0];
    }

    if (!selectedPlot.coordinates?.location?.latitude || !selectedPlot.coordinates?.location?.longitude) {
      throw new Error('No coordinates found in user plot data');
    }

    const lat = selectedPlot.coordinates.location.latitude;
    const lon = selectedPlot.coordinates.location.longitude;

    const weatherResponse = await fetch(`https://weather-cropeye.up.railway.app/current-weather?lat=${lat}&lon=${lon}`);
    
    if (!weatherResponse.ok) {
      throw new Error(`Weather API error: ${weatherResponse.status}`);
    }
    
    const weatherData = await weatherResponse.json();
    
    const currentDate = new Date();
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const currentMonth = monthNames[currentDate.getMonth()];
    
    return {
      temperature: weatherData.temperature || 25,
      humidity: weatherData.humidity || 60,
      month: currentMonth
    };
  } catch (error: any) {
    console.warn('Error fetching weather data, using defaults:', error?.message || error);
    // Return default weather data instead of throwing error
    const currentDate = new Date();
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const currentMonth = monthNames[currentDate.getMonth()];
    
    return {
      temperature: 25, // Default temperature
      humidity: 60, // Default humidity
      month: currentMonth
    };
  }
}
