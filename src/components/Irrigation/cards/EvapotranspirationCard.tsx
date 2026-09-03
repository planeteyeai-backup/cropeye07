import React, { useEffect, useState } from "react";
import { Waves } from "lucide-react";
import "../Irrigation.css";
import { useAppContext } from "../../../context/AppContext";
import { useFarmerProfile } from "../../../hooks/useFarmerProfile";
import { fetchComputeEtJson } from "../../../services/computeEtFetch";

interface HourlyETRecord {
  time: string;
  et0_fao_evapotranspiration: number;
}

interface ETResponse {
  plot_name: string;
  start_date: string;
  end_date: string;
  area_hectares: number;
  ET_mean_mm_per_day: number;
  hourly_records_et?: HourlyETRecord[];
}

const EvapotranspirationCard: React.FC = () => {
  const { appState, setAppState, getCached, setCached, selectedPlotName } = useAppContext();
  const { profile, loading: profileLoading } = useFarmerProfile();
  
  const [plotName, setPlotName] = useState<string>("");
  const etValue = appState?.etValue ?? 0;
  const trendData = Array.isArray(appState?.etTrendData) ? appState.etTrendData : [];
  const [hourlyData, setHourlyData] = useState<Array<{time: string, value: number}>>([]);
  const [loading, setLoading] = useState<boolean>(!etValue);
  const [error, setError] = useState<string | null>(null);
  const [average] = useState<number>(2.5);

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
        console.log('EvapotranspirationCard: Setting plot name to:', plotToUse);
      }
    }
  }, [profile, profileLoading, selectedPlotName]);

  // Fetch ET data when plot name is available
  useEffect(() => {
    if (!plotName) return;

    const cacheKey = `etData_${plotName}`;
    const cached = getCached(cacheKey);

    if (cached && cached.etValue && cached.trendData) {
      setAppState((prev: any) => ({
        ...prev,
        etValue: cached.etValue,
        etTrendData: cached.trendData,
      }));
      // Restore hourly data with time if available
      if (cached.hourlyData && Array.isArray(cached.hourlyData)) {
        setHourlyData(cached.hourlyData);
      }
      setLoading(false);
      return;
    }

    fetchETData();
  }, [plotName]);

  const fetchETData = async () => {
    if (!plotName) {
      setError("No plot selected");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Use POST request with empty body as per API specification
      const data = (await fetchComputeEtJson(plotName, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        credentials: "omit",
        headers: {
          "accept": "application/json",
        },
      })) as ETResponse;

      // Extract ET value from ET_mean_mm_per_day (primary field from API response)
      const etValueExtracted = data.ET_mean_mm_per_day ?? 2.5;

      // Extract hourly trend data from hourly_records_et array
      let trendDataExtracted: number[] = [];
      let hourlyDataWithTime: Array<{time: string, value: number}> = [];
      
      if (data.hourly_records_et && Array.isArray(data.hourly_records_et) && data.hourly_records_et.length > 0) {
        // Use real hourly data from API
        // Extract both time and et0_fao_evapotranspiration values
        hourlyDataWithTime = data.hourly_records_et.map((record: HourlyETRecord) => ({
          time: record.time || '',
          value: Number(record.et0_fao_evapotranspiration) || 0
        }));
        
        // Map the et0_fao_evapotranspiration values for trendDataExtracted
        trendDataExtracted = hourlyDataWithTime.map(item => item.value);
        
        // Ensure we have exactly 24 hours of data
        // If we have fewer than 24 records, pad with zeros and generate time
        while (hourlyDataWithTime.length < 24) {
          const currentDate = data.start_date || new Date().toISOString().split('T')[0];
          const hour = hourlyDataWithTime.length.toString().padStart(2, '0');
          hourlyDataWithTime.push({
            time: `${currentDate}T${hour}:00`,
            value: 0
          });
          trendDataExtracted.push(0);
        }
        
        // If we have more than 24 records, take only the first 24
        if (hourlyDataWithTime.length > 24) {
          hourlyDataWithTime = hourlyDataWithTime.slice(0, 24);
          trendDataExtracted = trendDataExtracted.slice(0, 24);
        }
      } else {
        // Fallback: Generate trend data if hourly_records_et is not available
        const base = etValueExtracted;
        const currentDate = data.start_date || new Date().toISOString().split('T')[0];
        trendDataExtracted = Array.from({ length: 24 }, (_, i) => {
          const fluctuation = (Math.sin(i / 3) + 1) * 0.1 * base;
          return Math.round((base + fluctuation) * 10) / 10;
        });
        
        hourlyDataWithTime = trendDataExtracted.map((value, i) => {
          const hour = i.toString().padStart(2, '0');
          return {
            time: `${currentDate}T${hour}:00`,
            value: value
          };
        });
      }
      
      // Store hourly data with time for tooltips
      setHourlyData(hourlyDataWithTime);


      // Update AppContext
      setAppState((prev: any) => ({
        ...prev,
        etValue: etValueExtracted,
        etTrendData: trendDataExtracted,
      }));

      // Cache the data
      const cacheKey = `etData_${plotName}`;
      setCached(cacheKey, {
        etValue: etValueExtracted,
        trendData: trendDataExtracted,
        hourlyData: hourlyDataWithTime, // Store hourly data with time
      });

    } catch (err: any) {
      const errorMessage = err.message || 'Unknown error';
      setError(`Failed to fetch ET data: ${errorMessage}`);
      
      // Log detailed error for debugging
      console.error('ET API fetch error:', {
        error: err,
        message: err?.message,
        name: err?.name,
        url: `https://sef-cropeye.up.railway.app/plots/${plotName}/compute-et/`,
        plotName: plotName
      });
      
      setAppState((prev: any) => ({
        ...prev,
        etValue: 0,
        etTrendData: [],
      }));
    } finally {
      setLoading(false);
    }
  };

  const comparison =
    etValue > average
      ? { status: "Above average", className: "text-orange-500" }
      : { status: "Below average", className: "text-green-500" };

  const getETScore = (value: number): "Low" | "Medium" | "High" => {
    if (value <= 3.0) return "Low";
    if (value <= 5.5) return "Medium";
    return "High";
  };
  const etScore = getETScore(Number(etValue) || 0);

  const maxTrendValue =
    Array.isArray(trendData) && trendData.length > 0
      ? Math.max(...trendData.map((v: any) => Number(v) || 0))
      : 1;

  return (
    <div className="irrigation-card">
      <div className="card-header">
        <Waves className="card-icon" size={20} />
        <h3>Evapotranspiration</h3>
      </div>

      <div className="card-content evapotranspiration">
        <div className="evap-icon">
          <Waves size={40} color="#4287f5" />
        </div>

        <div className="metric-value">
          {loading ? (
            <div className="loading-spinner-small"></div>
          ) : (
            <>
              <span className="value">{etValue.toFixed(2)}</span>
              <span className="unit">mm</span>
            </>
          )}
        </div>

        {!loading && (
          <div
            className={`evap-comparison ${
              etScore === "Low"
                ? "text-green-600"
                : etScore === "Medium"
                  ? "text-orange-600"
                  : "text-red-600"
            }`}
            style={{ marginTop: 4 }}
          >
            ET score: {etScore}
          </div>
        )}

        {error && <div className="error-message-small">{error}</div>}

        <div className={`evap-comparison ${comparison.className}`}>
          {comparison.status} ({average.toFixed(1)}mm)
        </div>

        <div className="evap-trend">
          <div className="trend-label">24h Trend</div>
          <div className="trend-chart">
            {Array.isArray(trendData) && trendData.length > 0 ? (
              trendData.map((val: number, i: number) => {
                const numVal = Number(val) || 0;
                // Get time from hourlyData if available, otherwise use index
                const timeData = hourlyData[i] || null;
                const displayTime = timeData?.time 
                  ? new Date(timeData.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
                  : `${i.toString().padStart(2, '0')}:00`;
                
                return (
                  <div
                    key={i}
                    className="trend-bar"
                    title={`${displayTime} - ${numVal.toFixed(2)} mm`}
                    style={{
                      height: `${(numVal / maxTrendValue) * 100}%`,
                      minHeight: "2px",
                    }}
                  />
                );
              })
            ) : (
              <div style={{ width: "100%", textAlign: "center", color: "#999" }}>
                No trend data available
              </div>
            )}
          </div>
        </div>

        <div style={{ fontSize: "12px", color: "#999", marginTop: "8px" }}>
        </div>
      </div>
    </div>
  );
};

export default EvapotranspirationCard;