import React, { useEffect, useState } from "react";
import { Download, Info, Satellite } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { useFarmerProfile } from "../hooks/useFarmerProfile";
import { RefreshCw } from "lucide-react";

interface NutrientData {
  name: string;
  symbol: string;
  value: number | string | null;
  unit: string;
  optimalRange: string;
  level: "very-low" | "low" | "medium" | "optimal" | "very-high" | "unknown";
  percentage: number;
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

const SoilAnalysis: React.FC<SoilAnalysisProps> = ({
  plotName,
  phValue,
  phStatistics,
  compact = false,
}) => {
  const { appState, setAppState, setCached, selectedPlotName } = useAppContext();
  const { profile, loading: profileLoading } = useFarmerProfile();
  const soilData = appState.soilData || null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

    // Check cache
    const cacheKey = `soilData_${currentPlotName}`;
    // Comment out these lines to disable cache for testing
    // if (cached) {
    //   setAppState((prev: any) => ({
    //     ...prev,
    //     soilData: cached,
    //   }));
    //   setLoading(false);
    //   return;
    // }

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

      try {
        const currentDate = new Date().toISOString().split("T")[0];

        // First, fetch the NEW API with soil NPK data (with timeout protection)
        const soilNPKUrl = `https://main-cropeye.up.railway.app/required-n/${encodeURIComponent(
          currentPlotName
        )}?end_date=${currentDate}`;

        let soilNPKData = null;
        try {
          const npkController = new AbortController();
          const npkTimeoutId = setTimeout(() => npkController.abort(), 15000); // 15s timeout

          const soilNPKResponse = await fetch(soilNPKUrl, {
            method: "POST",
            headers: {
              Accept: "application/json",
            },
            signal: npkController.signal,
          });

          clearTimeout(npkTimeoutId);

          if (soilNPKResponse.ok) {
            soilNPKData = await soilNPKResponse.json();
          }
        } catch (soilNPKError: any) {
          // Ignore NPK timeout/network errors and proceed with main analysis API
        }

        // Then fetch the original NPK analysis API
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const apiUrl = `https://main-cropeye.up.railway.app/analyze-npk/${encodeURIComponent(
          currentPlotName
        )}?end_date=${currentDate}&days_back=7`;

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          mode: "cors",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

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
          const estimatedUptake = npkAnalysis.estimated_npk_uptake_perAcre;
          const recommendedDose = npkAnalysis.recommended_dose_perAcre;
          const fertilizerRequire = npkAnalysis.fertilizer_require_perAcre;
          const finalDisplayedDose = npkAnalysis.final_displayed_dose;

          soilDataToSet = {
            nitrogen: estimatedUptake?.N || 0,
            phosphorus: estimatedUptake?.P || 0,
            potassium: estimatedUptake?.K || 0,
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
            nitrogen: data?.nitrogen || 0,
            phosphorus: data?.phosphorus || 0,
            potassium: data?.potassium || 0,
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

        // 🔥 CRITICAL: Override nitrogen, phosphorus, potassium with soilN, soilP, soilK
        if (soilNPKData) {
          soilDataToSet = {
            ...soilDataToSet,
            // REPLACE old values with soilN, soilP, soilK from required-n endpoint
            nitrogen: soilNPKData.soilN || 0,
            phosphorus: soilNPKData.soilP || 0,
            potassium: soilNPKData.soilK || 0,
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

        const fallbackData: ApiSoilData = {
          plot_name: currentPlotName,
          nitrogen: undefined,
          phosphorus: undefined,
          potassium: undefined,
          pH: undefined,
          cec: undefined,
          organic_carbon: undefined,
          soil_density: undefined,
          ocd: undefined,
          soc: undefined,
          bulk_density: undefined,
          soil_organic_carbon: undefined,
          total_nitrogen: undefined,
          cation_exchange_capacity: undefined,
          fe: undefined,
          organic_carbon_stock: undefined,
          phh2o: undefined,
          bdod_0_5cm_mean: undefined,
          soc_0_5cm_mean: undefined,
          nitrogen_0_5cm_mean: undefined,
          cec_0_5cm_mean: undefined,
          ocd_0_5cm_mean: undefined,
          ocs_0_30cm_mean: undefined,
          phh2o_0_5cm_mean: undefined,
        };

        setAppState((prev: any) => ({
          ...prev,
          soilData: fallbackData,
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
    value: number
  ): "very-low" | "low" | "medium" | "optimal" | "very-high" {
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

  const metrics: NutrientData[] = [
    {
      name: "Nitrogen",
      symbol: "N",
      // PRIORITY: Use soilN from new API
      value:
        soilData?.soilN ??
        soilData?.nitrogen ??
        soilData?.total_nitrogen ??
        null,
      unit: "Kg/acre",
      optimalRange: "50 - 150",
      level: getNitrogenLevel(
        soilData?.soilN ?? soilData?.nitrogen ?? soilData?.total_nitrogen ?? 0
      ),
      percentage: calculatePercentage(
        soilData?.soilN ?? soilData?.nitrogen ?? soilData?.total_nitrogen,
        50,
        150,
        10,
        200
      ),
    },
    {
      name: "Phosphorus",
      symbol: "P",
      // PRIORITY: Use soilP from new API
      value: soilData?.soilP ?? soilData?.phosphorus ?? null,
      unit: "Kg/acre",
      optimalRange: "25 - 75",
      level: getPhosphorusLevel(soilData?.soilP ?? soilData?.phosphorus),
      percentage: calculatePercentage(
        soilData?.soilP ?? soilData?.phosphorus,
        25,
        75,
        5,
        100
      ),
    },
    {
      name: "Potassium",
      symbol: "K",
      // PRIORITY: Use soilK from new API
      value: soilData?.soilK ?? soilData?.potassium ?? null,
      unit: "Kg/acre",
      optimalRange: "20 - 100",
      level: getPotassiumLevel(soilData?.soilK ?? soilData?.potassium),
      percentage: calculatePercentage(
        soilData?.soilK ?? soilData?.potassium,
        20,
        100,
        5,
        150
      ),
    },
    {
      name: "Soil pH",
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
      name: "CEC",
      symbol: "CEC",
      value: getSoilValue(soilData?.cec, soilData?.cation_exchange_capacity),
      unit: "C mol/Kg",
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
      name: "Organic Carbon",
      symbol: "OC",
      value: getSoilValue(
        soilData?.organic_carbon_stock,
        soilData?.ocs_0_30cm_mean
      ),
      unit: " T/acre",
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
      name: "Bulk Density",
      symbol: "BD",
      value: getSoilValue(soilData?.bulk_density, soilData?.bdod_0_5cm_mean),
      unit: "Kg/m\u00B3",
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
      name: "Fe",
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
      name: "Soil Organic Carbon",
      symbol: "SOC",
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
        4.0
      ),
    },
  ];

  const getLevelColor = (level: string): string => {
    switch (level) {
      case "very-low":
        return "bg-red-500";
      case "low":
        return "bg-orange-400";
      case "medium":
        return "bg-yellow-400";
      case "optimal":
        return "bg-green-500";
      case "very-high":
        return "bg-green-700";
      default:
        return "bg-gray-400";
    }
  };

  const getLevelBorderColor = (level: string): string => {
    switch (level) {
      case "very-low":
        return "border-red-200";
      case "low":
        return "border-orange-200";
      case "medium":
        return "border-yellow-200";
      case "optimal":
        return "border-green-200";
      case "very-high":
        return "border-green-300";
      default:
        return "border-gray-200";
    }
  };

  const hasLoadedReport =
    Boolean(currentPlotName) && !loading && !error && !profileLoading;

  return (
    <div className="w-full max-w-full min-w-0">
      <div className="rounded-2xl border border-gray-200/80 bg-white shadow-sm overflow-hidden">
        {/* Header — full width, aligned like reference */}
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-white ${compact ? "px-3 py-2" : "px-4 py-3 sm:px-5 sm:py-4"}`}>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
            <h2 className={`${compact ? "text-2xl" : "text-base sm:text-2xl"} font-bold text-gray-900 tracking-tight`}>
              Soil Analysis Report
            </h2>
            {plotDisplayName && (
              <span className="shrink-0 text-xs font-semibold bg-blue-100 text-blue-800 px-2.5 py-1 rounded-md border border-blue-200/60">
                Plot: {plotDisplayName}
              </span>
            )}
          </div>
          <button
            type="button"
            title="Download report"
            className={`shrink-0 inline-flex items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${compact ? "p-1.5" : "p-2"}`}
          >
            <Download className="w-4 h-4" aria-hidden />
          </button>
        </div>

        <div className={`${compact ? "px-3 py-3" : "px-4 py-4 sm:px-5 sm:py-5"}`}>
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-600">
              <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />
              Loading soil data...
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700">
              {error}
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

          {currentPlotName && loading && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600">
              <Satellite className="w-10 h-10 mb-3 text-blue-500 animate-spin" />
              <p className="text-sm font-medium">Loading soil analysis…</p>
              <p className="mt-2 max-w-sm text-center text-xs text-gray-400">
                This may take up to 30 seconds.
              </p>
            </div>
          )}

          {hasLoadedReport && (
            <div className={`${compact ? "space-y-3" : "space-y-6 sm:space-y-8"}`}>
              {/* Summary: 9 equal columns — vertical bars + symbol labels */}
              <div className="w-full overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                <div className={`mx-auto ${compact ? "min-w-[520px]" : "min-w-[600px]"} sm:min-w-0 max-w-[90rem]`}>
                  <div className={`grid grid-cols-9 ${compact ? "gap-1.5" : "gap-1.5 sm:gap-3"}`}>
                    {metrics.map((metric, idx) => {
                      const pct = Math.max(8, Math.min(100, metric.percentage));
                      return (
                      <div
                        key={idx}
                        className={`flex min-h-0 flex-col items-stretch rounded-lg border bg-gray-50/80 ${getLevelBorderColor(
                          metric.level
                        )} overflow-hidden`}
                      >
                        <div className={`relative mx-auto w-full ${compact ? "max-w-[28px] pt-1" : "max-w-[24px] px-0.5 pt-2 sm:max-w-[50px] sm:px-1"}`}>
                          <div
                            className={`relative ${compact ? "h-[64px]" : "h-[100px] sm:h-[120px]"} w-full overflow-hidden rounded-t bg-gray-200/90`}
                            aria-hidden
                          >
                            <div
                              className={`absolute bottom-0 left-0 right-0 rounded-t ${getLevelColor(
                                metric.level
                              )} transition-all duration-300`}
                              style={{ height: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <div className={`border-t border-gray-100 bg-white px-0.5 text-center ${compact ? "py-1" : "py-1.5"}`}>
                          <span className={`${compact ? "text-[9px]" : "text-[10px] sm:text-xs"} font-bold text-gray-800`}>
                            {metric.symbol}
                          </span>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Legend — matches reference (high → low) */}
              <div className={`flex flex-wrap items-center justify-center ${compact ? "gap-x-3 gap-y-1" : "gap-x-4 gap-y-2 sm:gap-x-6"}`}>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 shrink-0 rounded-sm bg-green-700" />
                  <span className={`${compact ? "text-[10px]" : "text-xs"} text-gray-600`}>Very High</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 shrink-0 rounded-sm bg-green-500" />
                  <span className={`${compact ? "text-[10px]" : "text-xs"} text-gray-600`}>Optimal</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 shrink-0 rounded-sm bg-yellow-400" />
                  <span className={`${compact ? "text-[10px]" : "text-xs"} text-gray-600`}>Medium</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 shrink-0 rounded-sm bg-orange-400" />
                  <span className={`${compact ? "text-[10px]" : "text-xs"} text-gray-600`}>Low</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 shrink-0 rounded-sm bg-red-500" />
                  <span className={`${compact ? "text-[10px]" : "text-xs"} text-gray-600`}>Very Low</span>
                </div>
              </div>

              {/* Detail cards — 3×3 grid, centered content */}
              <div className={`grid grid-cols-1 ${compact ? "gap-2" : "gap-3 sm:gap-4"} sm:grid-cols-2 lg:grid-cols-3`}>
                {metrics.map((metric, index) => (
                  <div
                    key={index}
                    className={`flex flex-col rounded-xl border bg-white text-center shadow-sm ${getLevelBorderColor(
                      metric.level
                    )} overflow-hidden ${compact ? "" : "transition-shadow hover:shadow-md"}`}
                  >
                    <div className="h-1.5 w-full shrink-0 bg-gray-200">
                      <div
                        className={`h-full ${getLevelColor(metric.level)}`}
                        style={{
                          width: `${Math.max(4, Math.min(100, metric.percentage))}%`,
                        }}
                      />
                    </div>
                    <div
                      className={`flex flex-1 flex-col items-center justify-between ${
                        compact ? "gap-1 px-2 py-1.5" : "gap-2 px-3 py-3 sm:px-4 sm:py-4"
                      }`}
                    >
                      <div>
                        <h3 className={`${compact ? "text-[16px]" : "text-sm"} font-semibold text-gray-900`}>
                          {metric.name}
                        </h3>
                        <p className={`${compact ? "text-[14px]" : "text-xs"} text-gray-500`}>({metric.symbol})</p>
                      </div>
                      <div className="w-full">
                        {metric.value === null ? (
                          <p className={`${compact ? "text-[20px]" : "text-xl"} font-bold text-gray-400`}>N/A</p>
                        ) : (
                          <>
                            <p
                              className={`${
                                compact ? "text-[18px]" : "text-xl sm:text-2xl"
                              } font-bold tabular-nums text-gray-900 leading-tight`}
                            >
                              {typeof metric.value === "number"
                                ? metric.value.toFixed(2)
                                : metric.value}
                            </p>
                            {metric.unit ? (
                              <p className={`${compact ? "mt-0 text-[14px]" : "mt-0.5 text-xs"} font-medium text-gray-500`}>
                                {metric.unit.trim()}
                              </p>
                            ) : null}
                          </>
                        )}
                      </div>
                      <p
                        className={`w-full rounded-md bg-gray-100 px-2 ${
                          compact ? "py-0.5 text-[13px]" : "py-1.5 text-[11px]"
                        } font-medium text-gray-600 leading-tight`}
                      >
                        Range: {metric.optimalRange}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SoilAnalysis;