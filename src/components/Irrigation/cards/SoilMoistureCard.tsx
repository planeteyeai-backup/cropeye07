import React, { useEffect, useState } from "react";
import { Droplets } from "lucide-react";
import "../Irrigation.css";
import { useAppContext } from "../../../context/AppContext";
import { useFarmerProfile } from "../../../hooks/useFarmerProfile";

interface SoilMoistureCardProps {
  optimalRange: [number, number]; // [min%, max%]
  moistGroundPercent?: number | null;
  targetDate?: string; // Optional date input (format: YYYY-MM-DD)
  /** Tighter layout for sidebar stacks. */
  compact?: boolean;
}

// New 9006 endpoint types
interface SoilMoistureStackItem {
  day: string;
  soil_moisture: number;
}

interface SoilMoistureStackResponse {
  plot_name: string;
  latitude: number;
  longitude: number;
  soil_moisture_stack: SoilMoistureStackItem[];
}

const SoilMoistureCard: React.FC<SoilMoistureCardProps> = ({
  optimalRange,
  targetDate,
  compact = false,
}) => {
  // Use current date if no target date provided
  const currentDate = targetDate || new Date().toISOString().split('T')[0];
  const { appState, setAppState, getCached, setCached, selectedPlotName } = useAppContext();
  const { profile, loading: profileLoading } = useFarmerProfile();
  const moisturePercent = appState.moisturePercent ?? 0;
  const currentSoilMoisture = appState.currentSoilMoisture ?? moisturePercent; // may be set by trend card
  const status = appState.moistureStatus ?? "Loading...";
  
  // Prioritize shared value from SoilMoistureTrendCard
  const [yesterdayMoisture, setYesterdayMoisture] = useState<number | null>(null);
  const [yesterdayDate, setYesterdayDate] = useState<string | null>(null);
  const displayMoisture =
    (yesterdayMoisture ?? 0) > 0
      ? (yesterdayMoisture as number)
      : currentSoilMoisture > 0
      ? currentSoilMoisture
      : moisturePercent;
  
  // Debug: Log the values being used
  console.log('SoilMoistureCard Debug:', {
    currentSoilMoisture: currentSoilMoisture,
    moisturePercent: moisturePercent,
    displayMoisture: displayMoisture,
    appState: appState,
    selectedPlotName: selectedPlotName
  });
  
  const [loading, setLoading] = useState<boolean>(!displayMoisture);
  const [error, setError] = useState<string | null>(null);
  const [plotName, setPlotName] = useState<string>("");

  // Set plot name from global selectedPlotName or fallback to first plot
  useEffect(() => {
    if (profile && !profileLoading) {
      let plotToUse = "";
      
      // Use global selectedPlotName if available
      if (selectedPlotName) {
        // Find the plot by fastapi_plot_id or constructed ID
        const foundPlot = profile.plots?.find((plot: any) => 
          plot.fastapi_plot_id === selectedPlotName ||
          `${plot.gat_number}_${plot.plot_number}` === selectedPlotName
        );
        
        if (foundPlot && foundPlot.fastapi_plot_id) {
          plotToUse = foundPlot.fastapi_plot_id;
        } else {
          plotToUse = selectedPlotName || ""; // Use as-is if not found (might be a different format)
        }
      } else {
        // Fallback to first plot
        const plotNames = profile.plots?.map((plot: any) => plot.fastapi_plot_id) || [];
        plotToUse = plotNames.length > 0 ? plotNames[0] : "";
      }
      
      if (plotToUse && plotToUse !== plotName) {
        setPlotName(plotToUse);
        console.log('SoilMoistureCard: Setting plot name to:', plotToUse);
      }
    }
  }, [profile, profileLoading, selectedPlotName]);

  // Monitor when value changes
  useEffect(() => {
    if (displayMoisture > 0) setLoading(false);
  }, [displayMoisture]);

  // Fetch yesterday moisture from 9006 endpoint
  useEffect(() => {
    if (!plotName) return;
    fetchYesterdayFromStack();
  }, [plotName]);

  const fetchSoilMoistureStack = async (plot: string): Promise<SoilMoistureStackResponse> => {
    const base = 'https://sef-cropeye.up.railway.app';
    const attempts: Array<{ url: string; init?: RequestInit; note: string }> = [
      { url: `${base}/soil-moisture/${encodeURIComponent(plot)}`, note: 'GET path param' },
      { url: `${base}/soil-moisture/${encodeURIComponent(plot)}/`, note: 'GET path param trailing slash' },
      { url: `${base}/soil-moisture?plot_name=${encodeURIComponent(plot)}`, note: 'GET query param' },
      { url: `${base}/soil-moisture/${encodeURIComponent(plot)}`, init: { method: 'POST', headers: { 'Content-Type': 'application/json' } }, note: 'POST path param' },
      { url: `${base}/soil-moisture`, init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plot_name: plot }) }, note: 'POST body JSON' },
    ];
    let lastErr: any = null;
    for (const attempt of attempts) {
      try {
        console.log('SoilMoistureCard fetch attempt:', attempt.note, attempt.url);
        const resp = await fetch(attempt.url, attempt.init);
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          lastErr = new Error(`HTTP ${resp.status}: ${body || resp.statusText}`);
          continue;
        }
        return await resp.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Soil moisture API failed');
  };

  const fetchYesterdayFromStack = async () => {
    try {
      setLoading(true);
      setError(null);
      const stack = await fetchSoilMoistureStack(plotName);
      const arr = Array.isArray(stack.soil_moisture_stack) ? stack.soil_moisture_stack : [];
      if (!arr.length) throw new Error('Empty soil_moisture_stack');
      // take the last entry as yesterday (API returns daily ascending)
      const last = [...arr].sort((a,b)=>a.day.localeCompare(b.day)).slice(-1)[0];
      setYesterdayMoisture(parseFloat((last.soil_moisture || 0).toFixed(2)));
      setYesterdayDate(last.day);
      // set status based on optimalRange
      const finalPercentage = parseFloat((last.soil_moisture || 0).toFixed(2));
      let st = "Loading...";
      if (finalPercentage >= optimalRange[0] && finalPercentage <= optimalRange[1]) st = "Moderated";
      else if (finalPercentage < optimalRange[0]) st = "Low"; else st = "High";
      setAppState((prev:any)=>({ ...prev, moisturePercent: finalPercentage, moistureStatus: st }));
    } catch (err:any) {
      // Fallback: use trend data from context if available
      const trend = Array.isArray(appState.soilMoistureTrendData) ? appState.soilMoistureTrendData : [];
      if (trend.length) {
        const last = [...trend].sort((a:any,b:any)=> (a.date||a.day).localeCompare((b.date||b.day))).slice(-1)[0];
        const val = typeof last?.value === 'number' ? last.value : (last?.soil_moisture || 0);
        const dt = last?.date || last?.day || null;
        setYesterdayMoisture(parseFloat((val || 0).toFixed(2)));
        if (dt) setYesterdayDate(dt);
        let st = "Loading...";
        if (val >= optimalRange[0] && val <= optimalRange[1]) st = "Moderated"; else if (val < optimalRange[0]) st = "Low"; else st = "High";
        setAppState((prev:any)=>({ ...prev, moisturePercent: val, moistureStatus: st }));
        setError(null);
      } else {
        setError(`Failed to fetch soil moisture data: ${err.message || err}`);
      }
    } finally {
      setLoading(false);
    }
  };



  const statusColor =
    status === "Moderated"
      ? "text-green-500"
      : status === "Low"
      ? "text-yellow-500"
      : status === "High"
      ? "text-red-500"
      : "text-gray-500";

  return (
    <div className={`irrigation-card ${compact ? "irrigation-card--compact" : ""}`}>
      <div className="card-header">
        <Droplets className="card-icon" size={24} />
        <h3 className="font-semibold">Soil Moisture</h3>
      </div>
      <div className="card-content soil-moisture flex flex-row justify-evenly ">
        <div className="moisture-container">
          <div
            className="moisture-level"
            style={{
              height:
                displayMoisture > 0
                  ? `${Math.max(displayMoisture, 10)}%`
                  : "10%",
              minHeight: "30px",
              backgroundColor: displayMoisture > 0 ? "#3b82f6" : "#ef4444",
            }}
          >
            <span
              className="moisture-percentage"
              style={{
                color: "white",
                fontWeight: "bold",
              }}
            >
              {loading ? "..." : `${displayMoisture.toFixed(2)}%`}
            </span>
          </div>
        </div>
        
        <div className="moisture-info-container">
          <div
            className="moisture-info"
            style={{ textAlign: "center", marginTop: "15px" }}
          >
            <div
              className="moisture-percentage-display"
              style={{ fontSize: "24px", fontWeight: "bold", color: "#333" }}
            >
            {/* {loading ? "..." : `${displayMoisture.toFixed(2)}%`} */}
            
            </div>
            <small className="text-gray-600">Soil Moisture Level</small>
          </div>

          <div className="moisture-status">
            {error ? (
              <span className="text-red-500">{error}</span>
            ) : (
              <span className={statusColor}>{status}</span>
            )}
          </div>

          <div className="moisture-range">
            Range: {optimalRange[0]}–{optimalRange[1]}%
          </div>
        </div>
      </div>
    </div>
  );
};

export default SoilMoistureCard;
