import React, { useState, useEffect, useRef } from "react";
import { useFarmerProfile } from "../hooks/useFarmerProfile";
import { useAppContext } from "../context/AppContext";
import budData from "./bud.json";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

interface FertilizerEntry {
  date: string;
  stage: string;
  days: string;
  N_kg_acre: string;
  P_kg_acre: string;
  K_kg_acre: string;
  fertilizers?: {
    Urea_N_kg_per_acre: number;
    SuperPhosphate_P_kg_per_acre: number;
    Potash_K_kg_per_acre: number;
  };
  organic_inputs?: string[];
}

// Plantation type to months mapping
const PLANTATION_TYPE_MONTHS: Record<string, number> = {
  Suru: 10,
  Adsali: 14,
  Preseasonal: 12,
  Ratoon: 9,
};

const FertilizerTable: React.FC = () => {
  const [data, setData] = useState<FertilizerEntry[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [plantationType, setPlantationType] = useState<string | null>(null);
  const [monthsCompleted, setMonthsCompleted] = useState<number | null>(null);
  const [noFertilizerRequired, setNoFertilizerRequired] =
    useState<boolean>(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const {
    profile,
    loading: profileLoading,
    error: profileError,
  } = useFarmerProfile();
  const { selectedPlotName, setAppState } = useAppContext();

  // Helper function to calculate months since plantation
  const calculateMonthsSincePlantation = (plantationDate: string): number => {
    let plantation: Date;

    plantation = new Date(plantationDate);

    if (isNaN(plantation.getTime())) {
      const parts = plantationDate.split("-");
      if (parts.length === 3) {
        plantation = new Date(
          parseInt(parts[0]),
          parseInt(parts[1]) - 1,
          parseInt(parts[2])
        );
      } else {
        const parts2 = plantationDate.split("/");
        if (parts2.length === 3) {
          plantation = new Date(
            parseInt(parts2[2]),
            parseInt(parts2[1]) - 1,
            parseInt(parts2[0])
          );
        }
      }
    }

    if (isNaN(plantation.getTime())) {
      console.error("Invalid plantation date:", plantationDate);
      return 0;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    plantation.setHours(0, 0, 0, 0);

    const yearsDiff = today.getFullYear() - plantation.getFullYear();
    const monthsDiff = today.getMonth() - plantation.getMonth();
    const daysDiff = today.getDate() - plantation.getDate();

    let totalMonths = yearsDiff * 12 + monthsDiff;

    if (daysDiff < 0) {
      totalMonths = totalMonths - 1;
    }

    return Math.max(0, totalMonths);
  };

  // Helper function to calculate days since plantation
  const calculateDaysSincePlantation = (plantationDate: string): number => {
    // Try different date parsing methods
    let plantation: Date;

    // Method 1: Direct parsing
    plantation = new Date(plantationDate);

    // Method 2: Handle different date formats
    if (isNaN(plantation.getTime())) {
      // Try parsing as YYYY-MM-DD format
      const parts = plantationDate.split("-");
      if (parts.length === 3) {
        plantation = new Date(
          parseInt(parts[0]),
          parseInt(parts[1]) - 1,
          parseInt(parts[2])
        );
      } else {
        // Try parsing as DD/MM/YYYY format
        const parts2 = plantationDate.split("/");
        if (parts2.length === 3) {
          plantation = new Date(
            parseInt(parts2[2]),
            parseInt(parts2[1]) - 1,
            parseInt(parts2[0])
          );
        }
      }
    }

    const today = new Date();
    const diffTime = today.getTime() - plantation.getTime();
    const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    return days;
  };

  // Helper function to get current stage based on days
  const getCurrentStage = (days: number, stages: any[]): any => {
    for (const stage of stages) {
      // Handle both en-dash (–) and regular hyphen (-) in the days range
      const daysRange = stage.days.replace(/[–-]/g, "-"); // Normalize to regular hyphen
      const [minDays, maxDays] = daysRange
        .split("-")
        .map((d: string) => parseInt(d.trim()));

      if (days >= minDays && days <= maxDays) {
        return stage;
      }
    }

    // Return the last stage if no match found
    return stages[stages.length - 1];
  };

  // Helper function to generate 7 days of data
  const generateSevenDaysData = (
    plantationDate: string,
    plantingMethod: string
  ): FertilizerEntry[] => {
    // Normalize the planting method to match bud.json format
    // Handle various formats: "2-bud", "2_bud", "2 bud", "2bud", "3-bud", etc.
    const normalizedMethod = plantingMethod
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-") // Replace spaces with hyphens
      .replace(/_/g, "-") // Replace underscores with hyphens
      .replace(/[^a-z0-9-]/g, "") // Remove special characters
      .replace(/-+/g, "-") // Replace multiple hyphens with single
      .replace(/^-|-$/g, ""); // Remove leading/trailing hyphens

    console.log("FertilizerTable: Normalizing planting method", {
      original: plantingMethod,
      normalized: normalizedMethod,
      availableMethods: budData.fertilizer_schedule.map((s) => s.method),
    });

    // Find the fertilizer schedule for this planting method
    const fertilizerSchedule = budData.fertilizer_schedule.find((schedule) => {
      const scheduleMethod = schedule.method
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/_/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      return scheduleMethod === normalizedMethod;
    });

    if (!fertilizerSchedule) {
      console.error("FertilizerTable: No matching schedule found", {
        normalizedMethod,
        originalMethod: plantingMethod,
        availableMethods: budData.fertilizer_schedule.map((s) => s.method),
      });

      // Throw error instead of using fallback schedule
      throw new Error(
        `No fertilizer schedule found for planting method "${plantingMethod}" (normalized: "${normalizedMethod}"). Available methods: ${budData.fertilizer_schedule
          .map((s) => s.method)
          .join(", ")}`
      );
    }

    console.log(
      "FertilizerTable: Found matching schedule",
      fertilizerSchedule.method
    );
    return generateSevenDaysDataWithSchedule(
      plantationDate,
      fertilizerSchedule
    );
  };

  // Helper function to generate data with a specific schedule
  const generateSevenDaysDataWithSchedule = (
    plantationDate: string,
    fertilizerSchedule: any
  ): FertilizerEntry[] => {
    const daysSincePlantation = calculateDaysSincePlantation(plantationDate);

    const sevenDaysData: FertilizerEntry[] = [];
    const currentDate = new Date();

    for (let i = 0; i < 7; i++) {
      const targetDate = new Date(currentDate);
      targetDate.setDate(currentDate.getDate() + i);

      // Calculate days from plantation for this specific day
      const targetDays = daysSincePlantation + i;

      const currentStage = getCurrentStage(
        targetDays,
        fertilizerSchedule.stages
      );

      sevenDaysData.push({
        date: targetDate.toLocaleDateString("en-GB"),
        stage: currentStage.stage,
        days: `${targetDays}`,
        N_kg_acre: currentStage.N_kg_acre,
        P_kg_acre: currentStage.P_kg_acre,
        K_kg_acre: currentStage.K_kg_acre,
        fertilizers: currentStage.fertilizers,
        organic_inputs: currentStage.organic_inputs,
      });
    }

    return sevenDaysData;
  };

  useEffect(() => {
    // Wait for profile to load
    if (profileLoading) {
      return;
    }

    // Determine which plot to use: selectedPlotName > first plot from profile
    let plotToUse = selectedPlotName;
    
    // Fallback to first plot if no selection
    if (!plotToUse && profile?.plots && profile.plots.length > 0) {
      const firstPlot = profile.plots[0];
      plotToUse = firstPlot.fastapi_plot_id || 
                  `${firstPlot.gat_number}_${firstPlot.plot_number}`;
      console.log('FertilizerTable: No plot selected, using first plot:', plotToUse);
    }

    // Wait for plot selection (either from context or fallback)
    if (!plotToUse) {
      setData([]);
      setLocalError(null);
      setPlantationType(null);
      setMonthsCompleted(null);
      setNoFertilizerRequired(false);
      return;
    }

    try {
      setLocalError(null);

      // Check if profile exists and has plots
      if (!profile || !profile.plots || profile.plots.length === 0) {
        throw new Error("No plots found in farmer profile");
      }

      // Get the selected plot by fastapi_plot_id (primary matching method)
      // API response structure: plots[].fastapi_plot_id (e.g., "258_25")
      let selectedPlot = profile.plots.find(
        (p) => p.fastapi_plot_id === plotToUse
      );

      // If not found by fastapi_plot_id, try matching by constructed plot ID
      if (!selectedPlot) {
        selectedPlot = profile.plots.find((p) => {
          const plotId =
            p.fastapi_plot_id || `${p.gat_number}_${p.plot_number}`;
          return plotId === plotToUse;
        });
      }

      // If still not found, try matching by gat_number and plot_number
      if (!selectedPlot) {
        const [gatNum, plotNum] = plotToUse.split("_");
        selectedPlot = profile.plots.find(
          (p) => p.gat_number === gatNum && p.plot_number === plotNum
        );
      }

      if (!selectedPlot) {
        console.error("FertilizerTable: Selected plot not found", {
          plotToUse,
          availablePlots: profile.plots.map((p) => ({
            fastapi_plot_id: p.fastapi_plot_id,
            gat_number: p.gat_number,
            plot_number: p.plot_number,
          })),
        });
        throw new Error(
          `Selected plot "${plotToUse}" not found in farmer profile`
        );
      }

      console.log("FertilizerTable: Found plot by fastapi_plot_id", {
        plotToUse,
        foundPlot: {
          fastapi_plot_id: selectedPlot.fastapi_plot_id,
          gat_number: selectedPlot.gat_number,
          plot_number: selectedPlot.plot_number,
          farms_count: selectedPlot.farms?.length || 0,
        },
      });

      // Check if plot has farms
      if (
        !selectedPlot.farms ||
        !Array.isArray(selectedPlot.farms) ||
        selectedPlot.farms.length === 0
      ) {
        throw new Error("No farms found for the current plot");
      }

      // Get the first farm from the selected plot
      const firstFarm = selectedPlot.farms?.[0];

      if (!firstFarm) {
        throw new Error("No farm data found for the selected plot");
      }

      // Extract data from API response structure:
      // API path: plots[].farms[].plantation_date (e.g., "2025-12-01")
      // API path: plots[].farms[].crop_type.plantation_type (e.g., "ratoon")
      // API path: plots[].farms[].crop_type.planting_method (e.g., "2_bud")

      // Extract plantation_date - primary location from API response
      // No fallback - must have actual plantation_date from API
      const plantationDate = firstFarm.plantation_date; // Primary: farms[].plantation_date

      // Extract plantation_type from crop_type - primary location from API response
      const plantationTypeValue =
        firstFarm.crop_type?.plantation_type || // Primary: farms[].crop_type.plantation_type (e.g., "ratoon")
        firstFarm.crop_type?.plantation_type_display; // Alternative: farms[].crop_type.plantation_type_display (e.g., "Ratoon")

      console.log("FertilizerTable: Extracted farm data from API response", {
        fastapi_plot_id: selectedPlot.fastapi_plot_id,
        plantation_date: firstFarm.plantation_date,
        plantationDate: plantationDate,
        plantation_type: firstFarm.crop_type?.plantation_type,
        plantation_type_display: firstFarm.crop_type?.plantation_type_display,
        plantationTypeValue: plantationTypeValue,
        planting_method: firstFarm.crop_type?.planting_method,
        planting_method_display: firstFarm.crop_type?.planting_method_display,
        crop_type_object: firstFarm.crop_type,
        fullFarmData: firstFarm,
      });

      setPlantationType(plantationTypeValue || null);

      if (!plantationDate) {
        console.error("FertilizerTable: Plantation date not found", {
          farmData: firstFarm,
          availableFields: Object.keys(firstFarm),
        });
        throw new Error(
          "Plantation date not found in farm data. Please ensure plantation date is set for this farm."
        );
      }

      // Calculate months since plantation
      const monthsSincePlantation =
        calculateMonthsSincePlantation(plantationDate);
      setMonthsCompleted(monthsSincePlantation);

      console.log("FertilizerTable: Checking plantation type and months", {
        plantationTypeValue: plantationTypeValue,
        monthsSincePlantation: monthsSincePlantation,
        plantationDate: plantationDate,
      });

      // Check plantation type and months BEFORE requiring planting method
      // This allows us to show "No fertilizer required" even if planting method is missing
      if (plantationTypeValue) {
        // Normalize plantation type for matching (case-insensitive, remove hyphens/spaces)
        const normalizedPlantationType = plantationTypeValue
          .trim()
          .toLowerCase()
          .replace(/-/g, "") // Remove hyphens (pre-seasonal -> preseasonal)
          .replace(/\s+/g, ""); // Remove spaces

        console.log("FertilizerTable: Normalized plantation type", {
          original: plantationTypeValue,
          normalized: normalizedPlantationType,
          availableKeys: Object.keys(PLANTATION_TYPE_MONTHS),
        });

        // Try to find matching plantation type (case-insensitive, ignore hyphens/spaces)
        const matchingKey = Object.keys(PLANTATION_TYPE_MONTHS).find(
          (key) =>
            key.toLowerCase().replace(/-/g, "").replace(/\s+/g, "") ===
            normalizedPlantationType
        );

        const requiredMonths = matchingKey
          ? PLANTATION_TYPE_MONTHS[matchingKey]
          : null;

        console.log("FertilizerTable: Matching result", {
          matchingKey: matchingKey,
          requiredMonths: requiredMonths,
          monthsSincePlantation: monthsSincePlantation,
          shouldHide:
            requiredMonths !== null && monthsSincePlantation >= requiredMonths,
        });

        if (
          requiredMonths !== null &&
          monthsSincePlantation >= requiredMonths
        ) {
          setNoFertilizerRequired(true);
          setAppState((prev: any) => ({ ...prev, noFertilizerRequired: true }));
          setData([]);
          setLocalError(null); // Clear any previous errors
          console.log(
            "✅ FertilizerTable: No fertilizer required - HIDING TABLE",
            {
              plantationType: plantationTypeValue,
              matchingKey: matchingKey,
              monthsCompleted: monthsSincePlantation,
              requiredMonths: requiredMonths,
              plantationDate: plantationDate,
            }
          );
          return; // Exit early - don't check planting method or generate fertilizer data
        } else {
          setNoFertilizerRequired(false);
          setAppState((prev: any) => ({ ...prev, noFertilizerRequired: false }));
          console.log("❌ FertilizerTable: Fertilizer still required", {
            monthsSincePlantation: monthsSincePlantation,
            requiredMonths: requiredMonths,
            matchingKey: matchingKey,
          });
        }
      } else {
        setNoFertilizerRequired(false);
        setAppState((prev: any) => ({ ...prev, noFertilizerRequired: false }));
        console.log("⚠️ FertilizerTable: No plantation type found");
      }

      // Extract planting_method from crop_type (only needed if fertilizer is still required)
      // API path: plots[].farms[].crop_type.planting_method (e.g., "2_bud")
      const plantingMethod =
        firstFarm.crop_type?.planting_method || // Primary: farms[].crop_type.planting_method (e.g., "2_bud")
        firstFarm.crop_type?.planting_method_display; // Alternative: farms[].crop_type.planting_method_display (e.g., "2 Bud Method")

      if (!plantingMethod) {
        console.error(
          "FertilizerTable: Planting method not found in API response",
          {
            fastapi_plot_id: selectedPlot.fastapi_plot_id,
            farm_id: firstFarm.id,
            farm_uid: firstFarm.farm_uid,
            crop_type: firstFarm.crop_type,
            availableFields: Object.keys(firstFarm),
          }
        );
        throw new Error(
          `Planting method not found in farm data for plot "${plotToUse}". Please ensure planting method is set for this farm in the backend.`
        );
      }

      console.log("FertilizerTable: Extracted planting method", {
        planting_method: firstFarm.crop_type?.planting_method,
        planting_method_display: firstFarm.crop_type?.planting_method_display,
        extractedMethod: plantingMethod,
      });

      console.log("FertilizerTable: Generating fertilizer schedule", {
        fastapi_plot_id: selectedPlot.fastapi_plot_id,
        plotToUse,
        plantationDate,
        plantingMethod,
        plantationType: plantationTypeValue,
        monthsCompleted: monthsSincePlantation,
        farmData: {
          farm_id: firstFarm.id,
          farm_uid: firstFarm.farm_uid,
          plantation_date: firstFarm.plantation_date,
          crop_type: firstFarm.crop_type,
        },
      });

      // Generate fertilizer data using plantation_date and planting_method with bud.json
      try {
        const fertilizerData = generateSevenDaysData(
          plantationDate,
          plantingMethod
        );
        setData(fertilizerData);
        console.log(
          "FertilizerTable: Generated fertilizer data",
          fertilizerData.length,
          "entries"
        );
      } catch (genError: any) {
        console.error(
          "FertilizerTable: Error generating fertilizer data",
          genError
        );
        throw new Error(
          `Failed to generate fertilizer schedule: ${
            genError.message || "Unknown error"
          }. Please check if planting method "${plantingMethod}" is supported.`
        );
      }
    } catch (error: any) {
      // Failed to fetch data - show error only if fertilizer is still required
      console.error(
        "FertilizerTable: Error loading fertilizer data:",
        error?.message || error
      );

      // Only set error if we haven't determined that no fertilizer is required
      // This prevents showing errors when plantation type check succeeded
      if (!noFertilizerRequired) {
        setLocalError(
          `Failed to fetch data: ${error?.message || "Unknown error occurred"}`
        );
      }

      setData([]);
      // Don't reset plantation type and months if we already determined no fertilizer is needed
      if (!noFertilizerRequired) {
        setPlantationType(null);
        setMonthsCompleted(null);
        setNoFertilizerRequired(false);
      }
    }
  }, [profile, profileLoading, profileError, selectedPlotName]);

  const handleDownloadPDF = async () => {
    if (tableRef.current) {
      const canvas = await html2canvas(tableRef.current);
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("l", "mm", "a4"); // landscape
      const width = pdf.internal.pageSize.getWidth();
      const height = (canvas.height * width) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 10, width, height);
      pdf.save("fertilizer_table.pdf");
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 min-h-[250px] flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-gray-800">
          Fertilizer Schedule
        </h2>
        <button
          onClick={handleDownloadPDF}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </button>
      </div>

      {/* {farmData && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Farm Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="font-medium text-gray-600">Farm ID:</span>
              <span className="ml-2 text-gray-800">{farmData.farm_uid}</span>
            </div>
            <div>
              <span className="font-medium text-gray-600">Plantation Date:</span>
              <span className="ml-2 text-gray-800">{new Date(farmData.created_at).toLocaleDateString()}</span>
            </div>
            <div>
              <span className="font-medium text-gray-600">Planting Method:</span>
              <span className="ml-2 text-gray-800">{farmData.planting_method}</span>
            </div>
            <div>
              <span className="font-medium text-gray-600">Plantation Type:</span>
              <span className="ml-2 text-gray-800">{farmData.plantation_type}</span>
            </div>
            <div>
              <span className="font-medium text-gray-600">Crop Type:</span>
              <span className="ml-2 text-gray-800">{farmData.crop_type_name}</span>
            </div>
            <div>
              <span className="font-medium text-gray-600">Area Size:</span>
              <span className="ml-2 text-gray-800">{farmData.area_size} acres</span>
            </div>
          </div>
        </div>
      )} */}

      {/* No Fertilizer Required Message */}
      {(() => {
        // Re-check the conditions in render to ensure message shows
        if (!plantationType || monthsCompleted === null) {
          return null;
        }

        const normalizedPlantationType = plantationType
          .trim()
          .toLowerCase()
          .replace(/-/g, "")
          .replace(/\s+/g, "");

        const matchingKey = Object.keys(PLANTATION_TYPE_MONTHS).find(
          (key) =>
            key.toLowerCase().replace(/-/g, "").replace(/\s+/g, "") ===
            normalizedPlantationType
        );
        const requiredMonths = matchingKey
          ? PLANTATION_TYPE_MONTHS[matchingKey]
          : null;

        // Check if months completed >= required months (direct check in render)
        const shouldShowMessage =
          noFertilizerRequired ||
          (requiredMonths !== null && monthsCompleted >= requiredMonths);

        if (shouldShowMessage) {
          return (
            <div className="mb-4 p-6 bg-green-50 border border-green-200 rounded-lg text-center max-h-[100px] flex flex-col items-center justify-center">
              <svg
                className="w-12 h-auto text-green-600 mx-auto mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-lg font-bold text-green-800 mb-2">
                Fertilizer schedule completed
              </p>
              <p className="text-lg font-bold text-green-800 mb-2">
                No Fertilizer required
              </p>
              <p className="text-sm text-green-700">
                {/* The <strong>{plantationType}</strong> plantation has completed <strong>{monthsCompleted}</strong> months  */}
                {/* {requiredMonths !== null && ` (required: ${requiredMonths} months)`}.  */}
                {/* No fertilizer application is needed at this time. */}
              </p>
            </div>
          );
        }

        return null;
      })()}

      {(localError || profileError) && !noFertilizerRequired && (
        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start">
            <svg
              className="w-5 h-5 text-yellow-600 mt-0.5 mr-2"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-yellow-800">
                {localError || profileError}
              </p>
            </div>
          </div>
        </div>
      )}

      {profileLoading ? (
        <div className="flex items-center justify-center py-8">
          {/* <Satellite className="w-8 h-8 animate-spin text-blue-500" /> */}
          <span className="ml-2 text-gray-600">Loading fertilizer data...</span>
        </div>
      ) : (
        (() => {
          // Re-check if fertilizer should be hidden (safety check in render)
          if (plantationType && monthsCompleted !== null) {
            const normalizedPlantationType = plantationType
              .trim()
              .toLowerCase()
              .replace(/-/g, "")
              .replace(/\s+/g, "");

            const matchingKey = Object.keys(PLANTATION_TYPE_MONTHS).find(
              (key) =>
                key.toLowerCase().replace(/-/g, "").replace(/\s+/g, "") ===
                normalizedPlantationType
            );
            const requiredMonths = matchingKey
              ? PLANTATION_TYPE_MONTHS[matchingKey]
              : null;

            if (requiredMonths !== null && monthsCompleted >= requiredMonths) {
              // No fertilizer required - message already shown above, table is completely hidden
              return null;
            }
          }

          // Show error or table only if fertilizer is still required
          if (noFertilizerRequired) {
            return null;
          }

          // Show loading state if profile is still loading
          if (profileLoading) {
            return (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                  <p className="text-sm text-gray-600">
                    Loading fertilizer data...
                  </p>
                </div>
              </div>
            );
          }

          // Show error or empty state
          if (localError || profileError || data.length === 0) {
            // Provide more helpful error messages
            let errorMessage =
              localError || profileError || "No fertilizer data available";

            // Add helpful suggestions based on the error
            if (errorMessage.includes("Planting method")) {
              errorMessage +=
                ". Please check if the planting method is set correctly in farm data.";
            } else if (errorMessage.includes("Plantation date")) {
              errorMessage +=
                ". Please ensure the plantation date is set for this farm.";
            } else if (errorMessage.includes("not found")) {
              errorMessage += ". Please select a valid plot from the dropdown.";
            } else if (!selectedPlotName && (!profile?.plots || profile.plots.length === 0)) {
              errorMessage =
                "Please select a plot to view fertilizer schedule.";
            }

            return (
              <div className="flex items-center justify-center py-12">
                <div className="text-center max-w-md">
                  <svg
                    className="w-16 h-16 text-yellow-500 mx-auto mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <p className="text-lg font-semibold text-gray-800 mb-2">
                    Unable to Load Fertilizer Schedule
                  </p>
                  <p className="text-sm text-gray-600 mb-4">{errorMessage}</p>
                  {!selectedPlotName && (!profile?.plots || profile.plots.length === 0) && (
                    <p className="text-xs text-gray-500 mt-2">
                      Tip: Make sure you have selected a plot from the dropdown
                      above.
                    </p>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div ref={tableRef} className="overflow-x-auto flex-1 min-h-[350px] flex flex-col">
              <div className="mb-3 flex-shrink-0">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">
                  Next 7 Days Fertilizer Schedule
                </h3>
                {/* <p className="text-sm text-gray-600">Showing first and last day (same values for all 7 days)</p> */}
              </div>
              <div className="flex-1 flex flex-col">
                <table className="fertilizer-schedule-table min-w-full h-full bg-green-400 border border-gray-200 border-collapse table-fixed">
                <thead className="bg-green-200">
                  <tr>
                    <th className="px-4 py-4 text-left text-lg font-semibold text-gray-800 border-b border-gray-300">
                      Date
                    </th>
                    <th className="px-4 py-4 text-left text-lg font-semibold text-gray-800 border-b border-gray-300">
                      Stage
                    </th>
                    <th className="px-4 py-4 text-left text-lg font-semibold text-gray-800 border-b border-gray-300">
                      Nutrients(kg/acre)
                    </th>
                    <th className="px-4 py-4 text-left text-lg font-semibold text-gray-800 border-b border-gray-300">
                      Chemical Inputs(kg/acre)
                    </th>
                    <th className="px-4 py-4 text-left text-lg font-semibold text-gray-800 border-b border-gray-300">
                      Organic Inputs(kg/acre)
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {/* First row - show actual data */}
                  {data.length > 0 && (
                    <tr className="bg-white">
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        {data[0].date}
                      </td>
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        {/* {data[0].stage} */}
                      </td>
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        N : {data[0].N_kg_acre}
                      </td>
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        {data[0].fertilizers && (
                          <div className="text-lg font-normal">
                            <div>
                              Urea: {data[0].fertilizers?.Urea_N_kg_per_acre} kg
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        {data[0].organic_inputs && (
                          <div className="text-lg font-normal">
                            {data[0].organic_inputs?.map((input, index) => (
                              <div key={index}>{index === 0 ? input : ""}</div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}

                  {/* Middle rows - show dots if there are more than 2 days */}
                  {data.length > 2 && (
                    <tr className="bg-gray-50">
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        To
                      </td>
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        {data[0].stage}
                      </td>
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        P : {data[0].P_kg_acre}
                      </td>
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        <div className="text-lg font-normal">
                          SuperPhosphate:{" "}
                          {data[0].fertilizers?.SuperPhosphate_P_kg_per_acre} kg
                        </div>
                      </td>
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        {data[0].organic_inputs && (
                          <div className="text-lg font-normal">
                            {data[0].organic_inputs?.map((input, index) => (
                              <div key={index}>{index === 1 ? input : ""}</div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}

                  {/* Last row - show actual data if there are more than 1 day */}
                  {data.length > 1 && (
                    <tr className="bg-white">
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        {data[data.length - 1].date}
                      </td>
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        {/* {data[data.length - 1].stage} */}
                      </td>
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        K : {data[0].K_kg_acre}
                      </td>
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        {data[data.length - 1].fertilizers && (
                          <div className="text-lg font-normal">
                            <div>
                              Muriate of Potash:{" "}
                              {
                                data[data.length - 1].fertilizers
                                  ?.Potash_K_kg_per_acre
                              }{" "}
                              kg
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-6 whitespace-nowrap text-lg font-normal text-gray-900 border-b align-top">
                        {data[0].organic_inputs && (
                          <div className="text-lg font-normal">
                            {data[0].organic_inputs?.map((input, index) => (
                              <div key={index}>{index === 2 ? input : ""}</div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
};

export default FertilizerTable;
