import React, { useEffect, useState } from "react";
import { Download, Info, Satellite, FlaskConical, Leaf, Beaker } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { useFarmerProfile } from "../hooks/useFarmerProfile";
import { RefreshCw } from "lucide-react";
import {
  fetchMittisenseRecommendation,
  fetchMittisenseSoilAnalysis,
  mittisenseNutrientNumeric,
  type MittisenseRecommendation,
  type MittisenseSoilAnalysis,
} from "../utils/mittisenseNpkApi";

interface NutrientData {
  name: string;
  symbol: string;
  value: number | string | null;
  unit: string;
  optimalRange: string;
  level: "very-low" | "low" | "medium" | "optimal" | "very-high" | "unknown";
  percentage: number;
  /** Optional apply-line shown inside this card (e.g. K + MOP headline). */
  applyHeadline?: string;
}

interface SoilAnalysisProps {
  plotName: string | null;
  phValue: number | null;
  phStatistics?: {
    phh2o_0_5cm_mean_mean: number;
  };
  /** Render a denser layout (about half height) for dashboard panels. */
  compact?: boolean;
}

interface ApiSoilData {
  nitrogen?: number;
  phosphorus?: number;
  potassium?: number;
  recommended_nitrogen?: number;
  recommended_phosphorus?: number;
  recommended_potassium?: number;
  fertilizer_nitrogen?: number;
  fertilizer_phosphorus?: number;
  fertilizer_potassium?: number;
  final_nitrogen?: number;
  final_phosphorus?: number;
  final_potassium?: number;
  area_acres?: number;
  ph?: number;
  pH?: number;
  cec?: number;
  cation_exchange_capacity?: number;
  organic_carbon?: number;
  soil_organic_carbon?: number;
  soil_density?: number;
  bulk_density?: number;
  ocd?: number;
  soc?: number;
  total_nitrogen?: number;
  organic_carbon_stock?: number;
  plot_name?: string;
  fe?: number;
  fe_ppm_estimated?: number;
  fe_index_primary?: number;
  fe_index_difference?: number;
  fe_index_normalized?: number;
  fe_image_date?: string;
  fe_polarizations?: number[];
  vv_backscatter_db?: number;
  vh_backscatter_db?: number;
  bdod_0_5cm_mean?: number;
  soc_0_5cm_mean?: number;
  nitrogen_0_5cm_mean?: number;
  cec_0_5cm_mean?: number;
  ocd_0_5cm_mean?: number;
  ocs_0_30cm_mean?: number;
  phh2o?: number;
  phh2o_0_5cm_mean?: number;
  // New fields for soil NPK
  soilN?: number;
  soilP?: number;
  soilK?: number;
}

/** Fixed pH used under Recommendation (Humic Acid / Lime stage). */
const RECOMMENDATION_PH = 6.8;

const SOIL_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Shared per-URL promises so two mounted SoilAnalysis panels (dashboard grid +
 * detail page) reuse one request instead of hitting main-cropeye twice.
 */
const soilRequestsInFlight = new Map<string, Promise<Response>>();

function dedupedSoilFetch(url: string, init: RequestInit): Promise<Response> {
  const existing = soilRequestsInFlight.get(url);
  if (existing) return existing.then((response) => response.clone());

  const pending = fetch(url, init).finally(() => {
    soilRequestsInFlight.delete(url);
  });

  soilRequestsInFlight.set(url, pending);
  return pending.then((response) => response.clone());
}

const SoilAnalysis: React.FC<SoilAnalysisProps> = ({
  plotName,
  phValue,
  phStatistics,
  compact = false,
}) => {
  const { appState, setAppState, getCached, setCached, selectedPlotName } =
    useAppContext();
  const { profile, loading: profileLoading } = useFarmerProfile();
  const soilData = appState.soilData || null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [npkUnavailable, setNpkUnavailable] = useState(false);
  const [reportTab, setReportTab] = useState<"recommendation" | "analysis" | "chemical">("recommendation");
  const [showDetailCards, setShowDetailCards] = useState(true);
  const [mittiRec, setMittiRec] = useState<MittisenseRecommendation | null>(null);
  const [mittiSoil, setMittiSoil] = useState<MittisenseSoilAnalysis | null>(null);
  const [mittiLoading, setMittiLoading] = useState(false);
  const [mittiError, setMittiError] = useState<string | null>(null);
  // Use global selectedPlotName if available, otherwise fall back to prop
  const activePlotName = selectedPlotName || plotName;
  const [currentPlotName, setCurrentPlotName] = useState<string | null>(
    activePlotName
  );

  const getPlotDisplayName = (plotId: string | null) => {
    if (!plotId || !profile?.plots) return plotId;
    const plot = profile.plots.find((p) => p.fastapi_plot_id === plotId);
    if (plot) {
      return plot.gat_number || plot.plot_number || plot.fastapi_plot_id;
    }
    return plotId;
  };

  useEffect(() => {
    // Priority: global selectedPlotName > prop plotName > first plot from profile
    if (selectedPlotName) {
      setCurrentPlotName(selectedPlotName);
    } else if (plotName) {
      setCurrentPlotName(plotName);
    } else if (profile?.plots && profile.plots.length > 0) {
      const firstPlot = profile.plots[0];
      const firstPlotName =
        firstPlot.fastapi_plot_id ||
        `${firstPlot.gat_number}_${firstPlot.plot_number}`;
      setCurrentPlotName(firstPlotName);
    }
  }, [selectedPlotName, plotName, profile, profileLoading]);

  const plotDisplayName = getPlotDisplayName(currentPlotName);

  useEffect(() => {
    // Don't fetch if there's no plot name
    if (!currentPlotName || currentPlotName.trim() === "") {
      setAppState((prev: any) => ({
        ...prev,
        soilData: null,
      }));
      setLoading(false);
      return;
    }

    const cacheKey = `soilData_${currentPlotName}`;
    const cached = getCached(cacheKey, SOIL_CACHE_TTL_MS);
    if (cached) {
      setAppState((prev: any) => ({
        ...prev,
        soilData: cached,
      }));
      setLoading(false);
      return;
    }

    const fetchSoilData = async (retryCount = 0) => {
      if (!currentPlotName || currentPlotName.trim() === "") {
        setError("Plot name is required for soil analysis");
        setLoading(false);
        return;
      }

      if (retryCount > 3) {
        setError(
          "Failed to fetch soil data after multiple attempts. Please check your connection and try again later."
        );
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setNpkUnavailable(false);

      try {
        // analyze-npk: pH / CEC / other soil stats (N/P/K come from mittisense soil-analysis)
        const tzOffsetMs = new Date().getTimezoneOffset() * 60000;
        const currentDate = new Date(Date.now() - tzOffsetMs)
          .toISOString()
          .slice(0, 10);

        const apiUrl = `https://main-cropeye.up.railway.app/analyze-npk/${encodeURIComponent(
          currentPlotName
        )}?end_date=${currentDate}&days_back=7`;

        const analyzeController = new AbortController();
        const analyzeTimeoutId = setTimeout(() => analyzeController.abort(), 30000);

        const response = await dedupedSoilFetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          mode: "cors",
          signal: analyzeController.signal,
        });

        clearTimeout(analyzeTimeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `HTTP error! status: ${response.status} - ${errorText}`
          );
        }

        const data = await response.json();

        let soilDataToSet: ApiSoilData | null = null;

        if (data && data.npk_analysis) {
          const npkAnalysis = data.npk_analysis;
          const recommendedDose = npkAnalysis.recommended_dose_perAcre;
          const fertilizerRequire = npkAnalysis.fertilizer_require_perAcre;
          const finalDisplayedDose = npkAnalysis.final_displayed_dose;

          // Soil N/P/K for cards come from mittisense soil-analysis (not required-n / uptake).
          soilDataToSet = {
            recommended_nitrogen: recommendedDose?.N || 0,
            recommended_phosphorus: recommendedDose?.P || 0,
            recommended_potassium: recommendedDose?.K || 0,
            fertilizer_nitrogen: fertilizerRequire?.N || 0,
            fertilizer_phosphorus: fertilizerRequire?.P || 0,
            fertilizer_potassium: fertilizerRequire?.K || 0,
            final_nitrogen: finalDisplayedDose?.N || 0,
            final_phosphorus: finalDisplayedDose?.P || 0,
            final_potassium: finalDisplayedDose?.K || 0,
            area_acres: npkAnalysis.area_acres || 0,
            ph: data.ph || data.pH || 0,
            cec: data.cec || data.cation_exchange_capacity || 0,
            organic_carbon: data.organic_carbon || data.soil_organic_carbon || 0,
            soil_density: data.soil_density || data.bulk_density || 0,
            total_nitrogen: data.total_nitrogen || 0,
            organic_carbon_stock: data.organic_carbon_stock || 0,
            plot_name: currentPlotName,
            fe: data.fe || data.fe_ppm_estimated || 0,
            fe_index_primary: data.fe_index_primary || 0,
            fe_index_difference: data.fe_index_difference || 0,
            fe_index_normalized: data.fe_index_normalized || 0,
            fe_image_date: data.fe_image_date || "",
            fe_polarizations: data.fe_polarizations || [],
            vv_backscatter_db: data.vv_backscatter_db || 0,
            vh_backscatter_db: data.vh_backscatter_db || 0,
          };
        }

        if (data && data.soil_statistics) {
          const soilStats = data.soil_statistics;
          const soilStatsData = {
            ph: soilStats.phh2o || 0,
            cec: soilStats.cation_exchange_capacity || 0,
            organic_carbon_stock: soilStats.organic_carbon_stock || 0,
            bulk_density: soilStats.bulk_density || 0,
            fe_ppm_estimated: soilStats.fe_ppm_estimated || 0,
            soil_organic_carbon: soilStats.soil_organic_carbon || 0,
            total_nitrogen: soilStats.total_nitrogen || 0,
            fe_index_primary: soilStats.fe_index_primary || 0,
            fe_index_difference: soilStats.fe_index_difference || 0,
            fe_index_normalized: soilStats.fe_index_normalized || 0,
            plot_name: currentPlotName,
          };

          soilDataToSet = {
            ...soilDataToSet,
            ...soilStatsData,
          };
        }

        if (!soilDataToSet) {
          soilDataToSet = {
            ph: data?.ph || data?.pH || 0,
            cec: data?.cec || data?.cation_exchange_capacity || 0,
            organic_carbon:
              data?.organic_carbon || data?.soil_organic_carbon || 0,
            soil_density: data?.soil_density || data?.bulk_density || 0,
            total_nitrogen: data?.total_nitrogen || 0,
            organic_carbon_stock: data?.organic_carbon_stock || 0,
            plot_name: currentPlotName,
            fe: data?.fe || data?.fe_ppm_estimated || 0,
            fe_index_primary: data?.fe_index_primary || 0,
            fe_index_difference: data?.fe_index_difference || 0,
            fe_index_normalized: data?.fe_index_normalized || 0,
            fe_image_date: data?.fe_image_date || "",
            fe_polarizations: data?.fe_polarizations || [],
            vv_backscatter_db: data?.vv_backscatter_db || 0,
            vh_backscatter_db: data?.vh_backscatter_db || 0,
          };
        }

        if (soilDataToSet) {
          setAppState((prev: any) => ({
            ...prev,
            soilData: soilDataToSet,
          }));
          setCached(cacheKey, soilDataToSet);
        } else {
          throw new Error(
            "Unexpected API response structure. Could not find soil statistics."
          );
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          if (retryCount < 3) {
            setTimeout(() => fetchSoilData(retryCount + 1), 2000);
            return;
          } else {
            setError(
              "Request timed out after multiple attempts. The soil analysis service may be slow or unavailable."
            );
          }
        } else if (err.message.includes("Failed to fetch")) {
          if (retryCount < 3) {
            setTimeout(() => fetchSoilData(retryCount + 1), 2000);
            return;
          } else {
            setError(
              "Network error: Unable to connect to soil analysis service. Please check your internet connection."
            );
          }
        } else if (err.message.includes("HTTP error")) {
          setError(`Server error: ${err.message}`);
        } else {
          setError(`Failed to fetch soil data: ${err.message}`);
        }

        // No fake/empty fallback soil NPK — clear so UI shows nothing for N/P/K.
        setAppState((prev: any) => ({
          ...prev,
          soilData: null,
        }));

        if (err.message.includes("Failed to fetch") && retryCount < 2) {
          setTimeout(() => {
            fetchSoilData(retryCount + 1);
          }, 2000);
          return;
        }
      } finally {
        setLoading(false);
      }
    };

    fetchSoilData();
  }, [currentPlotName]);

  // Mittisense: recommendation (Recommendation + In-chemical) + soil-analysis (Soil Analysis tab)
  useEffect(() => {
    if (!currentPlotName || currentPlotName.trim() === "") {
      setMittiRec(null);
      setMittiSoil(null);
      setMittiError(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setMittiLoading(true);
      setMittiError(null);
      try {
        const [rec, soil] = await Promise.all([
          fetchMittisenseRecommendation(currentPlotName, profile?.plots ?? null),
          fetchMittisenseSoilAnalysis(currentPlotName, profile?.plots ?? null),
        ]);
        if (cancelled) return;
        setMittiRec(rec);
        setMittiSoil(soil);
        // Soil Analysis N/P/K come from mittisense soil-analysis only
        setNpkUnavailable(!soil || (soil.N == null && soil.P == null && soil.K == null));
        if (!rec && !soil) {
          setMittiError("Mittisense data is not available for this plot.");
        }
      } catch (err: any) {
        if (cancelled) return;
        setMittiRec(null);
        setMittiSoil(null);
        setNpkUnavailable(true);
        setMittiError(err?.message || "Failed to load mittisense data.");
      } finally {
        if (!cancelled) setMittiLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [currentPlotName, profile?.plots]);

  function getPHLevel(
    pHValue: number | null
  ): "very-low" | "low" | "medium" | "optimal" | "very-high" | "unknown" {
    if (pHValue === null) return "unknown";
    if (pHValue < 5.0) return "very-low";
    if (pHValue < 6.0) return "low";
    if (pHValue < 6.2) return "medium";
    if (pHValue <= 7.5) return "optimal";
    return "very-high";
  }

  function calculatePHPercentage(pHValue: number | null): number {
    if (pHValue === null) return 0;
    const minPH = 4.0;
    const maxPH = 8.0;
    const optimalMin = 6.2;
    const optimalMax = 7.5;

    if (pHValue <= optimalMin) {
      return Math.max(0, ((pHValue - minPH) / (optimalMin - minPH)) * 50);
    } else if (pHValue >= optimalMax) {
      return Math.min(
        100,
        50 + ((pHValue - optimalMax) / (maxPH - optimalMax)) * 50
      );
    } else {
      return 50 + ((pHValue - optimalMin) / (optimalMax - optimalMin)) * 50;
    }
  }

  function getNitrogenLevel(
    value: number | null
  ): "very-low" | "low" | "medium" | "optimal" | "very-high" | "unknown" {
    if (value === null || value === undefined) return "unknown";
    if (value < 30) return "very-low";
    if (value < 50) return "low";
    if (value < 80) return "medium";
    if (value <= 150) return "optimal";
    return "very-high";
  }

  function getPhosphorusLevel(
    value: number | null
  ): "very-low" | "low" | "medium" | "optimal" | "very-high" | "unknown" {
    if (value === null) return "unknown";
    if (value < 15) return "very-low";
    if (value < 25) return "low";
    if (value < 40) return "medium";
    if (value <= 75) return "optimal";
    return "very-high";
  }

  function getPotassiumLevel(
    value: number | null
  ): "very-low" | "low" | "medium" | "optimal" | "very-high" | "unknown" {
    if (value === null) return "unknown";
    if (value < 10) return "very-low";
    if (value < 20) return "low";
    if (value < 50) return "medium";
    if (value <= 100) return "optimal";
    return "very-high";
  }

  function getCECLevel(
    value: number | null
  ): "very-low" | "low" | "medium" | "optimal" | "very-high" | "unknown" {
    if (value === null) return "unknown";
    if (value < 8) return "very-low";
    if (value < 15) return "low";
    if (value < 25) return "medium";
    if (value <= 40) return "optimal";
    return "very-high";
  }

  function getFeLevel(
    value: number | null
  ): "very-low" | "low" | "medium" | "optimal" | "very-high" | "unknown" {
    if (value === null) return "unknown";
    if (value < 2.0) return "very-low";
    if (value < 4.5) return "low";
    if (value < 6.0) return "medium";
    if (value <= 10.0) return "optimal";
    return "very-high";
  }

  function getOCLevel(
    value: number | null
  ): "very-low" | "low" | "medium" | "optimal" | "very-high" | "unknown" {
    if (value === null) return "unknown";
    if (value < 0.5) return "very-low";
    if (value < 1.0) return "low";
    if (value < 1.5) return "medium";
    if (value <= 3.5) return "optimal";
    return "very-high";
  }

  function getBulkDensityLevel(
    value: number | null
  ): "very-low" | "low" | "medium" | "optimal" | "very-high" | "unknown" {
    if (value === null) return "unknown";
    if (value < 0.2) return "very-low";
    if (value < 0.4) return "low";
    if (value < 0.5) return "medium";
    if (value <= 1.6) return "optimal";
    return "very-high";
  }

  function getOrganicCarbonStockLevel(
    value: number | null
  ): "very-low" | "low" | "medium" | "optimal" | "very-high" | "unknown" {
    if (value === null) return "unknown";
    if (value < 1) return "very-low";
    if (value < 2) return "low";
    if (value < 5) return "medium";
    if (value <= 15) return "optimal";
    return "very-high";
  }

  function calculatePercentage(
    value: number | null,
    minOptimal: number,
    maxOptimal: number,
    minRange: number,
    maxRange: number
  ): number {
    if (value === null) return 0;

    if (value <= minOptimal) {
      return Math.max(0, ((value - minRange) / (minOptimal - minRange)) * 50);
    } else if (value >= maxOptimal) {
      return Math.min(
        100,
        50 + ((value - maxOptimal) / (maxRange - maxOptimal)) * 50
      );
    } else {
      return 50 + ((value - minOptimal) / (maxOptimal - minOptimal)) * 50;
    }
  }

  const getSoilValue = (
    primary: number | undefined,
    fallback: number | undefined
  ): number | null => {
    if (primary !== undefined && primary !== null) return primary;
    if (fallback !== undefined && fallback !== null) return fallback;
    return null;
  };

  const currentPhValue =
    phValue !== null
      ? phValue
      : phStatistics?.phh2o_0_5cm_mean_mean
      ? phStatistics.phh2o_0_5cm_mean_mean
      : null;

  // Soil Analysis tab N/P/K: mittisense soil-analysis only (required-n removed)
  const analysisNDisplay = mittiSoil?.N ?? null;
  const analysisPDisplay = mittiSoil?.P ?? null;
  const analysisKDisplay = mittiSoil?.K ?? null;
  const analysisNNum = mittisenseNutrientNumeric(mittiSoil?.N);
  const analysisPNum = mittisenseNutrientNumeric(mittiSoil?.P);
  const analysisKNum = mittisenseNutrientNumeric(mittiSoil?.K);

  const metrics: NutrientData[] = [
    {
      name: "Nitrogen",
      symbol: "N",
      value: analysisNDisplay,
      unit: "kg/acre",
      optimalRange: "50 - 150",
      level: getNitrogenLevel(analysisNNum),
      percentage: calculatePercentage(analysisNNum, 50, 150, 10, 200),
    },
    {
      name: "Phosphorus",
      symbol: "P",
      value: analysisPDisplay,
      unit: "kg/acre",
      optimalRange: "25 - 75",
      level: getPhosphorusLevel(analysisPNum),
      percentage: calculatePercentage(analysisPNum, 25, 75, 5, 100),
    },
    {
      name: "Potassium",
      symbol: "K",
      value: analysisKDisplay,
      unit: "kg/acre",
      optimalRange: "20 - 100",
      level: getPotassiumLevel(analysisKNum),
      percentage: calculatePercentage(analysisKNum, 20, 100, 5, 150),
    },
    {
      // Round badge only: pH
      name: "",
      symbol: "pH",
      value: getSoilValue(soilData?.ph, soilData?.phh2o) ?? currentPhValue,
      unit: "",
      optimalRange: "6.2 - 7.5",
      level: getPHLevel(
        getSoilValue(soilData?.ph, soilData?.phh2o) ?? currentPhValue
      ),
      percentage: calculatePHPercentage(
        getSoilValue(soilData?.ph, soilData?.phh2o) ?? currentPhValue
      ),
    },
    {
      // Round badge only: CEC
      name: "",
      symbol: "CEC",
      value: getSoilValue(soilData?.cec, soilData?.cation_exchange_capacity),
      unit: "c mol/kg",
      optimalRange: "15 - 40",
      level: getCECLevel(
        getSoilValue(soilData?.cec, soilData?.cation_exchange_capacity)
      ),
      percentage: calculatePercentage(
        getSoilValue(soilData?.cec, soilData?.cation_exchange_capacity),
        15,
        40,
        5,
        50
      ),
    },
    {
      // Round badge: Organic Carbon (not OC)
      name: "",
      symbol: "Organic Carbon",
      value: getSoilValue(
        soilData?.organic_carbon_stock,
        soilData?.ocs_0_30cm_mean
      ),
      unit: "t/acre",
      optimalRange: "2 - 15",
      level: getOrganicCarbonStockLevel(
        getSoilValue(soilData?.organic_carbon_stock, soilData?.ocs_0_30cm_mean)
      ),
      percentage: calculatePercentage(
        getSoilValue(soilData?.organic_carbon_stock, soilData?.ocs_0_30cm_mean),
        2,
        15,
        0.5,
        20
      ),
    },
    {
      // Round badge: Bulk Density (not BD)
      name: "",
      symbol: "Bulk Density",
      value: getSoilValue(soilData?.bulk_density, soilData?.bdod_0_5cm_mean),
      unit: "kg/m\u00B3",
      optimalRange: "0.50 - 1.60",
      level: getBulkDensityLevel(
        getSoilValue(soilData?.bulk_density, soilData?.bdod_0_5cm_mean)
      ),
      percentage: calculatePercentage(
        getSoilValue(soilData?.bulk_density, soilData?.bdod_0_5cm_mean),
        0.5,
        1.6,
        0.0,
        2.0
      ),
    },
    {
      // Round badge only: Fe
      name: "",
      symbol: "Fe",
      value: getSoilValue(soilData?.fe_ppm_estimated, soilData?.fe),
      unit: "ppm",
      optimalRange: "4.5 - 10",
      level: getFeLevel(
        getSoilValue(soilData?.fe_ppm_estimated, soilData?.fe)
      ),
      percentage: calculatePercentage(
        getSoilValue(soilData?.fe_ppm_estimated, soilData?.fe),
        4.5,
        10,
        2.0,
        15.0
      ),
    },
    {
      // Round badge: Soil Organic Carbon (full form)
      name: "",
      symbol: "Soil Organic Carbon",
      value: getSoilValue(
        soilData?.soil_organic_carbon,
        soilData?.soc_0_5cm_mean
      ),
      unit: "%",
      optimalRange: "1.5 - 3.5",
      level: getOCLevel(
        getSoilValue(soilData?.soil_organic_carbon, soilData?.soc_0_5cm_mean)
      ),
      percentage: calculatePercentage(
        getSoilValue(soilData?.soil_organic_carbon, soilData?.soc_0_5cm_mean),
        1.5,
        3.5,
        0.5,
        4.0,
      ),
    },
  ];

  // ── Recommendation (N / P / K cards) ─────────────────────────────────────
  // Parse products from API headline. Map each product onto N/P/K cards:
  //   DAP → N + P | MOP → K | SSP → P | FYM → N only | 19:19:19 → N
  //   35:00:52 (N+K) → K | Urea → N
  // Card value = product qty from headline (NOT API N/P/K nutrient totals).
  // If inchemical_N/P/K is 0 → that Recommendation card stays empty.
  const mittiHeadlineText =
    (mittiRec?.headline && String(mittiRec.headline).trim()) ||
    (mittiRec?.note && String(mittiRec.note).trim()) ||
    "";

  type RecProduct = { product: string; kg: number };

  const parseHeadlineProducts = (text: string): RecProduct[] => {
    if (!text) return [];
    const out: RecProduct[] = [];
    const re = /(\d+(?:\.\d+)?)\s*kg\s+([A-Za-z0-9:]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const kg = Number(m[1]);
      const product = String(m[2]).trim();
      if (!product || !Number.isFinite(kg) || kg <= 0) continue;
      out.push({ product, kg });
    }
    return out;
  };

  const recommendationProducts: RecProduct[] = (() => {
    const fromHeadline = parseHeadlineProducts(mittiHeadlineText);
    if (fromHeadline.length) return fromHeadline;

    const doses = mittiRec?.product_doses ?? [];
    const fromDoses = doses
      .filter((d) => d.kg > 0 && String(d.product ?? "").trim())
      .map((d) => ({
        product: String(d.product).trim(),
        kg: d.kg,
      }));
    if (fromDoses.length) return fromDoses;

    const fields: Array<[string, number | undefined]> = [
      ["Urea", mittiRec?.urea_kg],
      ["DAP", mittiRec?.dap_kg],
      ["FYM", mittiRec?.fym_kg],
      ["SSP", mittiRec?.ssp_kg],
      ["MOP", mittiRec?.mop_kg],
      ["19:19:19", mittiRec?.fert_191919_kg],
      ["35:00:52", undefined],
      ["13:00:45", mittiRec?.fert_130045_kg],
    ];
    return fields
      .filter(([, kg]) => kg != null && kg > 0)
      .map(([product, kg]) => ({ product, kg: kg as number }));
  })();

  /** Which Recommendation N/P/K cards a headline product belongs on. */
  const cardsForHeadlineProduct = (product: string): Array<"N" | "P" | "K"> => {
    const p = product.trim().toLowerCase();
    if (/urea/.test(p)) return ["N"];
    if (/dap/.test(p)) return ["N", "P"];
    if (/ssp|super\s*phos/.test(p)) return ["P"];
    if (/mop|potash/.test(p)) return ["K"];
    if (/fym/.test(p)) return ["N"];
    if (/19\s*:\s*19\s*:\s*19/.test(p)) return ["N"];
    // N+K complex → K card only (e.g. 35:00:52, 13:00:45)
    if (/35\s*:\s*00\s*:\s*52|13\s*:\s*00\s*:\s*45/.test(p)) return ["K"];
    return [];
  };

  const formatHeadlineApply = (row: RecProduct): string => {
    if (/fym/i.test(row.product)) {
      const tons = Number((row.kg / 1000).toFixed(2));
      return `Apply ${tons} tons/acre FYM`;
    }
    return `Apply ${row.kg} kg ${row.product}`;
  };

  type RecSlot = {
    /** Headline product qty for the card (not NPK nutrient). */
    value: number | null;
    unit: string;
    applyLines: string[];
    /** Product labels for card title (e.g. Urea) — not Nitrogen/P/K when product exists. */
    productNames: string[];
  };

  const recommendationSlots: Record<"N" | "P" | "K", RecSlot> = {
    N: { value: null, unit: "kg", applyLines: [], productNames: [] },
    P: { value: null, unit: "kg", applyLines: [], productNames: [] },
    K: { value: null, unit: "kg", applyLines: [], productNames: [] },
  };

  for (const row of recommendationProducts) {
    const targets = cardsForHeadlineProduct(row.product);
    if (!targets.length) continue;
    const apply = formatHeadlineApply(row);
    const isFym = /fym/i.test(row.product);
    const displayValue = isFym ? Number((row.kg / 1000).toFixed(2)) : row.kg;
    const displayUnit = isFym ? "tons/acre" : "kg";
    const productLabel = String(row.product).trim();
    for (const symbol of targets) {
      const slot = recommendationSlots[symbol];
      // First headline product that lands on this card sets the shown qty + title
      if (slot.value == null) {
        slot.value = displayValue;
        slot.unit = displayUnit;
      }
      if (productLabel && !slot.productNames.includes(productLabel)) {
        slot.productNames.push(productLabel);
      }
      if (!slot.applyLines.includes(apply)) slot.applyLines.push(apply);
    }
  }

  const inChemicalN = mittiRec?.inchemical_N ?? 0;
  const inChemicalP = mittiRec?.inchemical_P ?? 0;
  const inChemicalK = mittiRec?.inchemical_K ?? 0;

  const nutrientFallbackName = (symbol: "N" | "P" | "K") =>
    symbol === "N" ? "Nitrogen" : symbol === "P" ? "Phosphorus" : "Potassium";

  /** Card title = product (Urea/MOP/…) when present; else Nitrogen/P/K. */
  const recommendationCardName = (
    symbol: "N" | "P" | "K",
    products: string[],
  ): string => {
    if (products.length) return products.join(" · ");
    return nutrientFallbackName(symbol);
  };

  const recommendationMetrics: NutrientData[] = (["N", "P", "K"] as const).map(
    (symbol) => {
      const inChem =
        symbol === "N" ? inChemicalN : symbol === "P" ? inChemicalP : inChemicalK;
      const slot = recommendationSlots[symbol];
      const name = recommendationCardName(symbol, slot.productNames);

      // Gate: if In-chemical nutrient is 0 → nothing on Recommendation card
      if (!(inChem > 0)) {
        return {
          name: nutrientFallbackName(symbol),
          symbol,
          value: null,
          unit: "",
          optimalRange: "",
          level: "unknown" as const,
          percentage: 0,
          applyHeadline: undefined,
        };
      }

      if (slot.value == null || !slot.applyLines.length) {
        return {
          name: nutrientFallbackName(symbol),
          symbol,
          value: null,
          unit: "",
          optimalRange: "",
          level: "unknown" as const,
          percentage: 0,
          applyHeadline: undefined,
        };
      }

      return {
        name,
        symbol,
        value: slot.value,
        unit: slot.unit,
        optimalRange: "",
        level: "optimal" as const,
        percentage: 0,
        applyHeadline: slot.applyLines.join(" | "),
      };
    },
  );

  // Soil Analysis tab: reuse Recommendation apply lines (first product per nutrient)
  const applyHeadlineBySymbol = (
    symbol: "N" | "P" | "K",
  ): string | undefined => {
    const card = recommendationMetrics.find((m) => m.symbol === symbol);
    return card?.applyHeadline;
  };

  // In-chemical: N / P / K names + inchemical_* values only.
  // Product names (Urea/MOP/SSP/FYM) and Apply lines stay on Recommendation only.
  // Fill remaining slots with soil metrics to keep a full 9-card grid.
  const chemicalMetrics: NutrientData[] = (["N", "P", "K"] as const).map(
    (symbol) => {
      const value =
        symbol === "N"
          ? mittiRec?.inchemical_N ?? 0
          : symbol === "P"
            ? mittiRec?.inchemical_P ?? 0
            : mittiRec?.inchemical_K ?? 0;
      const levelFn =
        symbol === "N"
          ? getNitrogenLevel
          : symbol === "P"
            ? getPhosphorusLevel
            : getPotassiumLevel;
      return {
        name: nutrientFallbackName(symbol),
        symbol,
        value,
        unit: "kg/acre",
        optimalRange: "",
        level: levelFn(typeof value === "number" ? value : null),
        percentage: 0,
        applyHeadline: undefined,
      };
    },
  );

  const soilMetricsWithoutNpk = metrics.filter(
    (metric) => metric.symbol !== "N" && metric.symbol !== "P" && metric.symbol !== "K",
  );
  const recommendationSoilMetrics = soilMetricsWithoutNpk.map((metric) => {
    const base =
      metric.symbol !== "pH"
        ? metric
        : {
            ...metric,
            value: RECOMMENDATION_PH,
            level: getPHLevel(RECOMMENDATION_PH),
            percentage: calculatePHPercentage(RECOMMENDATION_PH),
          };
    return {
      ...base,
      optimalRange: "",
      percentage: 0,
    };
  });

  // Soil Analysis N/P/K: keep soil values, put apply headline under matching cards (like Recommendation)
  const analysisMetrics: NutrientData[] = metrics.map((metric) => {
    if (metric.symbol === "N" || metric.symbol === "P" || metric.symbol === "K") {
      return {
        ...metric,
        applyHeadline: applyHeadlineBySymbol(metric.symbol),
      };
    }
    return metric;
  });

  // NPK first; pad with soil metrics up to 9 cards
  const chemicalCardMetrics = (() => {
    const chem = chemicalMetrics;
    if (chem.length >= 9) return chem.slice(0, 9);
    return [...chem, ...soilMetricsWithoutNpk].slice(0, 9);
  })();
  const detailCardMetrics =
    reportTab === "recommendation"
      ? [...recommendationMetrics, ...recommendationSoilMetrics].slice(0, 9)
      : reportTab === "chemical"
        ? chemicalCardMetrics
        : analysisMetrics;

  const presentMonthLabel = new Date().toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
  });

  const reportTabs = [
    { id: "recommendation" as const, label: "Recommendation", icon: Leaf },
    { id: "analysis" as const, label: "Soil Analysis", icon: Beaker },
    { id: "chemical" as const, label: "In-chemical", icon: FlaskConical },
  ];

  const getLevelLabel = (level: string): string => {
    switch (level) {
      case "very-low":
        return "Very Low";
      case "low":
        return "Low";
      case "medium":
        return "Medium";
      case "optimal":
        return "Optimal";
      case "very-high":
        return "Very High";
      default:
        return "—";
    }
  };

  const formatMetricValue = (metric: NutrientData): string => {
    if (metric.value === null) return "—";
    if (typeof metric.value === "number") {
      if (
        (reportTab === "recommendation" || reportTab === "chemical") &&
        Number.isInteger(metric.value)
      ) {
        return String(metric.value);
      }
      // FYM tons / fractional kg — keep up to 2 decimals, trim trailing zeros
      const fixed = metric.value.toFixed(2).replace(/\.?0+$/, "");
      return fixed || "0";
    }
    return String(metric.value);
  };

  /** Units: lowercase inside curly braces, e.g. {kg/acre} */
  const formatMetricUnit = (unit: string | undefined): string => {
    const raw = String(unit ?? "").trim();
    if (!raw) return "";
    const lower = raw
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/^\{|\}$/g, "")
      .trim();
    return lower ? `{${lower}}` : "";
  };

  const getMetricTooltip = (metric: NutrientData): string => {
    const valueText = formatMetricValue(metric);
    const unit = formatMetricUnit(metric.unit);
    const unitText = unit ? ` ${unit}` : "";
    const title = metric.name?.trim() || metric.symbol;
    if (reportTab === "recommendation" || !metric.optimalRange) {
      return `${title}: ${valueText}${unitText} · ${getLevelLabel(metric.level)}`;
    }
    return `${title}: ${valueText}${unitText} · ${getLevelLabel(metric.level)} · Optimal: ${metric.optimalRange}`;
  };

  const hasLoadedReport =
    Boolean(currentPlotName) && !loading && !error && !profileLoading;

  return (
    <div className="w-full max-w-full min-w-0">
      <div className="overflow-hidden rounded-3xl border border-emerald-900/10 bg-[linear-gradient(180deg,#f7fbf7_0%,#ffffff_42%,#ffffff_100%)] shadow-[0_12px_40px_-24px_rgba(6,78,59,0.35)]">
        {/* Header */}
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-emerald-900/5 bg-white/70 backdrop-blur ${compact ? "px-3 py-2.5" : "px-4 py-4 sm:px-6 sm:py-5"}`}>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
            <h2 className={`${compact ? "text-xl" : "text-lg sm:text-2xl"} font-bold tracking-tight text-emerald-950`}>
              Soil Analysis Report
            </h2>
            {plotDisplayName && (
              <span className="shrink-0 rounded-full bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white">
                Plot {plotDisplayName}
              </span>
            )}
            <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
              {presentMonthLabel}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={showDetailCards}
              aria-label="Show detail cards"
              onClick={() => setShowDetailCards((v) => !v)}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1"
            >
              <span
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                  showDetailCards ? "bg-emerald-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    showDetailCards ? "left-4" : "left-0.5"
                  }`}
                />
              </span>
              <span className="leading-none">Detail cards</span>
            </button>
            <button
              type="button"
              title="Download report"
              className={`shrink-0 inline-flex items-center justify-center rounded-full bg-emerald-700 text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${compact ? "p-1.5" : "p-2"}`}
            >
              <Download className="w-4 h-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className={`${compact ? "px-3 py-3" : "px-4 py-4 sm:px-6 sm:py-5"}`}>
          <div className={`${compact ? "mb-3" : "mb-5"}`}>
            <div
              className="grid grid-cols-3 gap-1 rounded-2xl bg-emerald-950/[0.04] p-1"
              role="tablist"
              aria-label="Soil report view"
            >
              {reportTabs.map((tab) => {
                const Icon = tab.icon;
                const active = reportTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setReportTab(tab.id)}
                    className={`flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-center text-[11px] sm:text-sm font-semibold transition ${
                      active
                        ? "bg-white text-emerald-800 shadow-sm ring-1 ring-emerald-900/10"
                        : "bg-transparent text-slate-700 hover:bg-white/70 hover:text-emerald-800"
                    }`}
                  >
                    <Icon className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} shrink-0`} />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600">
              <Satellite className="w-10 h-10 mb-3 text-blue-500 animate-spin" />
              <p className="text-sm font-medium">Loading soil analysis…</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700">
              {error}
            </div>
          )}

          {npkUnavailable &&
            !error &&
            reportTab === "analysis" && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
              Soil NPK (N/P/K) is not available for this plot from mittisense.
              Other soil metrics below may still be available.
            </div>
          )}

          {profileLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600">
              <RefreshCw className="h-8 w-8 animate-spin text-blue-600 mb-2" />
              <p className="text-sm">Loading farmer profile...</p>
            </div>
          )}

          {!profileLoading && !currentPlotName && !loading && !error && (
            <div className="flex flex-col items-center justify-center py-12 text-center text-gray-500">
              <Info className="w-10 h-10 mb-2 text-gray-400" />
              <p className="text-sm font-medium">No plot selected</p>
              <p className="mt-1 max-w-md text-xs text-gray-400">
                Select a plot on the map to view soil analysis.
              </p>
            </div>
          )}

          {hasLoadedReport && (
            <div className={`${compact ? "space-y-3" : "space-y-6 sm:space-y-8"}`}>
              {(reportTab === "chemical" || reportTab === "analysis") &&
                mittiError &&
                !mittiLoading && (
                <p className="mb-2 text-center text-xs text-amber-700">{mittiError}</p>
              )}

              {reportTab === "recommendation" && mittiError && !mittiLoading && (
                <p className="text-center text-xs text-amber-700">{mittiError}</p>
              )}

              {showDetailCards && (
              <div className={`grid grid-cols-1 ${compact ? "gap-3" : "gap-4"} sm:grid-cols-2 lg:grid-cols-3`}>
                {detailCardMetrics.map((metric, index) => {
                  const isNpkOrCec =
                    metric.symbol === "N" ||
                    metric.symbol === "P" ||
                    metric.symbol === "K" ||
                    metric.symbol === "CEC";
                  const hasApply = Boolean(metric.applyHeadline);
                  return (
                  <div
                    key={`${metric.symbol}-${metric.name}-${index}`}
                    className={`group relative flex min-h-[148px] flex-col rounded-2xl border border-slate-200/90 bg-white p-4 text-center shadow-[0_8px_24px_-18px_rgba(15,23,42,0.35)] sm:min-h-[168px] sm:p-5 ${
                      hasApply ? "ring-1 ring-emerald-600/15" : ""
                    } ${
                      isNpkOrCec ? "overflow-visible" : "overflow-hidden"
                    } ${compact ? "" : "transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-20px_rgba(15,23,42,0.4)]"}`}
                  >
                    {isNpkOrCec && (
                      <div className="absolute right-3 top-3 z-20">
                        <button
                          type="button"
                          className="peer inline-flex rounded-full p-1 text-slate-300 hover:bg-slate-50 hover:text-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                          aria-label={getMetricTooltip(metric)}
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                        <div
                          role="tooltip"
                          className="pointer-events-none absolute right-0 top-full z-50 mt-1.5 w-max max-w-[220px] rounded-xl bg-slate-900 px-3 py-2 text-left text-xs text-white opacity-0 shadow-xl transition-opacity peer-hover:opacity-100 peer-focus:opacity-100"
                        >
                          <p className="font-semibold">{metric.name}</p>
                          <p className="mt-1 text-slate-300">{getMetricTooltip(metric)}</p>
                        </div>
                      </div>
                    )}

                    <div className="mb-3 flex items-center justify-center">
                      <span
                        className={`inline-flex min-h-8 min-w-8 items-center justify-center rounded-full bg-emerald-50 px-2.5 font-bold text-emerald-800 ring-1 ring-emerald-700/10 ${
                          metric.symbol.length > 4
                            ? "max-w-[9.5rem] px-3 py-1.5 text-center text-[10px] leading-tight tracking-normal"
                            : "text-xs tracking-wide"
                        }`}
                      >
                        {metric.symbol}
                      </span>
                    </div>

                    {metric.name?.trim() ? (
                      <p className={`${compact ? "text-[13px]" : "text-sm"} font-medium text-slate-500`}>
                        {metric.name}
                      </p>
                    ) : null}

                    <div className="mt-2 flex flex-1 flex-col items-center justify-center">
                      <p
                        className={`${
                          compact ? "text-[28px]" : "text-[32px] sm:text-[36px]"
                        } font-bold leading-none tracking-tight text-emerald-950 tabular-nums`}
                      >
                        {formatMetricValue(metric)}
                      </p>
                      {formatMetricUnit(metric.unit) ? (
                        <p className="mt-1.5 text-[13px] font-medium lowercase tracking-normal text-slate-400 sm:text-sm">
                          {formatMetricUnit(metric.unit)}
                        </p>
                      ) : null}
                    </div>

                    {hasApply ? (
                      <div className="mt-4 w-full cursor-default rounded-xl bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm">
                        {metric.applyHeadline}
                      </div>
                    ) : (
                      <div className="mt-4 h-8" aria-hidden />
                    )}
                  </div>
                  );
                })}
              </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SoilAnalysis;