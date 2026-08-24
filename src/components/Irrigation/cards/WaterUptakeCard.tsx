
import React, { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import "../Irrigation.css";
import { useAppContext } from "../../../context/AppContext";
import { useFarmerProfile } from "../../../hooks/useFarmerProfile";

const WaterUptakeCard: React.FC = () => {
  const { appState, getCached, setCached } = useAppContext();

  const irrigationSchedule = appState.irrigationScheduleData || [];
  const todayData =
    irrigationSchedule.find((day: any) => day.isToday) ||
    irrigationSchedule[irrigationSchedule.length - 1];
  // Prefer today's ETo loss (water needed); fall back to |remain| / volume
  const waterReqLiters = Math.abs(
    Number(
      todayData?.etoLossLiters ??
        todayData?.waterRequired ??
        todayData?.waterRemainLiters ??
        0,
    ) || 0,
  );
  const { profile, loading: profileLoading } = useFarmerProfile();
  const storedPlot = typeof window !== 'undefined' ? localStorage.getItem('selectedPlot') : null;
  const plotName = (appState.plotName && appState.plotName.trim())
    || (storedPlot && storedPlot.trim())
    || (profile?.plots?.[0]?.fastapi_plot_id || "");

  // Get plants_in_field from current plot
  const currentPlot = profile?.plots?.find(plot => plot.fastapi_plot_id === plotName);
  const plantsInField = currentPlot?.farms?.[0]?.plants_in_field ?? 0;
  
  // Calculate water per plant per hour: (waterRequired / plants_in_field) / 24
  const waterPerPlantPerHour = plantsInField > 0 ? (waterReqLiters / plantsInField) / 24 : 0;

  const [efficiency, setEfficiency] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEfficiency = async () => {
      if (!plotName) {
        setLoading(false);
        return;
      }

      try {
        // Check cache first (prefetch + Map store waterUptakeData_${plotName})
        const cacheKey = `waterUptakeData_${plotName}`;
        const cached = getCached(cacheKey, 10 * 60 * 1000); // 10 min TTL
        if (cached?.pixel_summary) {
          const adequate = cached.pixel_summary?.adequat_pixel_percentage ?? 0;
          const excellent = cached.pixel_summary?.excellent_pixel_percentage ?? 0;
          setEfficiency(Math.round(adequate + excellent));
          setLoading(false);
          return;
        }

        setLoading(true);
        setError(null);
        
        let endDate = "";
        try {
          const { fetchAnalysisTimeline, latestRebinDateForLayer } =
            await import("../../../services/analysisTimeline");
          const timeline = await fetchAnalysisTimeline(plotName);
          endDate = latestRebinDateForLayer(timeline?.timeline, "Water Uptake");
        } catch {
          /* no timeline */
        }
        if (!endDate) {
          setEfficiency(null);
          setLoading(false);
          return;
        }
        const baseUrl = 'https://admin-cropeye.up.railway.app';
        const url = `${baseUrl}/wateruptake?plot_name=${plotName}&end_date=${endDate}&days_back=15`;
        
        const response = await fetch(url, {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          credentials: "omit",
          headers: { "Accept": "application/json" },
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(`API ${response.status}${errorText ? `: ${errorText}` : ''}`);
        }

        const data = await response.json();
        setCached(cacheKey, data); // Cache for Map and future visits

        const pixelSummary = data.pixel_summary;

        if (!pixelSummary) {
          console.warn('WaterUptakeCard: No pixel_summary in API response', data);
          setEfficiency(0);
          setLoading(false);
          return;
        }

        // Use the correct field names: adequat_pixel_percentage and excellent_pixel_percentage
        const adequate = pixelSummary?.adequat_pixel_percentage ?? 0;
        const excellent = pixelSummary?.excellent_pixel_percentage ?? 0;

        // Calculate total efficiency by adding adequate and excellent percentages
        const totalEfficiency = Math.round(adequate + excellent);

        console.log('WaterUptakeCard: Efficiency calculation', {
          adequate,
          excellent,
          totalEfficiency,
          pixelSummary
        });

        setEfficiency(totalEfficiency);
        setError(null);
        setLoading(false);
      } catch (err: any) {
        console.error('WaterUptakeCard: Error fetching efficiency data', {
          error: err,
          message: err?.message,
          plotName
        });
        setError("Failed to fetch efficiency data");
        setEfficiency(null);
        setLoading(false);
      }
    };

    fetchEfficiency();
  }, [plotName]);

  // Circle visuals
  const minRadius = 70;
  const maxRadius = 100;
  const maxValue = 100; // Efficiency percentage scale (0-100%)
  const efficiencyValue = efficiency ?? 0;
  const radius = Math.min(
    maxRadius,
    minRadius + (efficiencyValue / maxValue) * (maxRadius - minRadius)
  );
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - efficiencyValue / maxValue);

  // If still no plot name and profile is loading, show loading
  if (!plotName && profileLoading) {
    return (
      <div className="irrigation-card">
        <div className="card-header">
          <Activity className="card-icon" size={28} />
          <h3 className="font-semibold">Plant Water Uptake</h3>
        </div>
        <div className="card-content card-content-water">
          <div className="text-gray-600 font-semibold">Loading farmer plots...</div>
        </div>
      </div>
    );
  }

  // If no plot name even after profile loaded, then show message
  if (!plotName) {
    return (
      <div className="irrigation-card">
        <div className="card-header">
          <Activity className="card-icon" size={28} />
          <h3 className="font-semibold">Plant Water Uptake</h3>
        </div>
        <div className="card-content card-content-water">
          <div className="text-red-600 font-semibold">WaterUptakeCard: No plot name available</div>
        </div>
      </div>
    );
  }

  return (
    <div className="irrigation-card">
      <div className="card-header">
        <Activity className="card-icon" size={28} />
        <h3 className="font-semibold">Plant Water Uptake</h3>
      </div>

      <div className="card-content card-content-water">
        <div className="ring-wrapper">
          <svg
            className="progress-ring"
            width={radius * 2 + 20}
            height={radius * 2 + 20}
          >
            <circle
              className="progress-ring-circle-bg"
              stroke="#e2e8f0"
              strokeWidth="17"
              fill="transparent"
              r={radius}
              cx={(radius * 2 + 20) / 2}
              cy={(radius * 2 + 20) / 2}
            />
            <circle
              className="progress-ring-circle"
              stroke="#3b82f6"
              strokeWidth="17"
              strokeLinecap="round"
              fill="transparent"
              r={radius}
              cx={(radius * 2 + 20) / 2}
              cy={(radius * 2 + 20) / 2}
              style={{
                strokeDasharray: `${circumference} ${circumference}`,
                strokeDashoffset,
                transform: "rotate(-90deg)",
                transformOrigin: "center",
              }}
            />
            <text
              x="50%"
              y="47%"
              textAnchor="middle"
              className="progress-text value"
            >
              {loading ? "..." : waterPerPlantPerHour.toFixed(2)}
            </text>
            <text
              x="50%"
              y="60%"
              textAnchor="middle"
              className="progress-text unit"
            >
              L/h
            </text>
          </svg>
        </div>

        {/* Efficiency Section */}
        <div className="uptake-efficiency" style={{ color: "#16a34a", paddingBottom: "10px" }}>
          Efficiency: {loading ? "..." : efficiency !== null ? `${efficiency}%` : "--"}
        </div>

        <div className="uptake-average">
          {/* Average: {average} L/Day */}
        </div>

        {error && <div className="text-red-500 mt-1">{error}</div>}
      </div>
    </div>
  );
};

export default WaterUptakeCard;

