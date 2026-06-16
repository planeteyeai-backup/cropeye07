import React, { useRef, useEffect, useState, useMemo } from "react";

import {
  Plus,
  Minus,
  Calendar,
  MapPin,
  ChevronDown,
  TrendingUp,
  BarChart3,
  PieChart,
  Activity,
  Maximize2,
  Loader2,
} from "lucide-react";
import GaugeChart from "./components/GaugeChart";
import WeatherChart from "./components/WeatherChart";
import RainfallChart from "./components/RainfallChart";
import DistributionChart from "./components/DistributionChart";
import FieldDistributionChart from "./components/FieldDistributionChart";
import DropdownFilter from "./components/DropdownFilter";

import {
  MapContainer,
  TileLayer,
  Polygon,
  CircleMarker,
  Popup,
  Tooltip,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useMap } from "react-leaflet";
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { getUserRole } from "../../utils/auth";
import { getCache, setCache } from "../utils/cache";
import { getManagerFieldOfficersAgroStats } from "../../api";

// Type definitions
interface BiomassRange {
  range: string;
  color: string;
}

// API Response Types
interface ApiPlotData {
  geometry: {
    type: string;
    coordinates: number[][][];
  };
  soil: {
    organic_carbon_stock: number | null;
    phh2o: number | null;
    area_acres: number;
  };
  brix_sugar: {
    brix: { mean: number; min: number; max: number };
    sugar_yield: { mean: number; min: number; max: number };
  };
  biomass: {
    mean: number;
    min: number;
    max: number;
  };
  area_acres?: number;
  Sugarcane_Status?: string;
}

interface PlotPoint {
  id: number;
  plotNo: string;
  status: string;
  area: string;
  position: [number, number];
  soilData: SoilData;
  coordinates: [number, number][];
  biomass: number;
  ph: number;
  organicCarbon: number;
  brix: number;
  yieldForecast: number;
}

interface SoilData {
  plot_name: string;
  date: string;
  statistics: {
    bulk_density: number;
    soil_organic_carbon: number;
    total_nitrogen: number;
    cation_exchange_capacity: number;
    organic_carbon_density: number;
    organic_carbon_stock: number;
    phh2o: number;
    potassium: number;
    phosphorus: number;
  };
  area_hectares: number;
  geometry: {
    type: string;
    coordinates: number[][][];
  };
}

interface Filters {
  soilPH: string;
  brixRange: string;
  yieldForecast: string;
  organicCarbon: string;
}

interface StatusData {
  name: string;
  value: number;
  color: string;
}

interface MapAutoCenterProps {
  center: [number, number];
}

// API data processing function
const processApiData = (apiData: Record<string, ApiPlotData>): PlotPoint[] => {
  const plots: PlotPoint[] = [];

  Object.entries(apiData).forEach(([plotName, plotData], index) => {
    // Extract coordinates from the polygon geometry
    const coordinates = plotData.geometry.coordinates[0].map((coord) => [
      coord[1],
      coord[0],
    ]) as [number, number][];

    // Calculate center position from coordinates
    const centerLat =
      coordinates.reduce((sum, coord) => sum + coord[0], 0) /
      coordinates.length;
    const centerLng =
      coordinates.reduce((sum, coord) => sum + coord[1], 0) /
      coordinates.length;

    // Use real data from API
    const ph = plotData.soil.phh2o || 7.0; // Default to 7.0 if null
    const organicCarbon = plotData.soil.organic_carbon_stock || 1.0; // Use organic_carbon_stock
    const brix = plotData.brix_sugar.brix.min; // Use min value
    const yieldForecast = plotData.brix_sugar.sugar_yield.min / 10; // Use min value and convert
    const area = plotData.area_acres ?? plotData.soil.area_acres ?? 0;
    const biomass = plotData.biomass.min; // Use min value
    const status = plotData.Sugarcane_Status || "Growing";

    plots.push({
      id: index,
      plotNo: plotName.replace(/"/g, ""), // Remove quotes from plot name key
      status,
      area: `${area.toFixed(2)} acres`,
      position: [centerLat, centerLng] as [number, number],
      coordinates,
      biomass,
      ph,
      organicCarbon,
      brix,
      yieldForecast,
      soilData: {
        plot_name: plotName,
        date: "2025-07-28",
        statistics: {
          bulk_density: 1.2, // Default value since not in API
          organic_carbon_stock: organicCarbon,
          total_nitrogen: 100, // Default value since not in API
          cation_exchange_capacity: 20, // Default value since not in API
          organic_carbon_density: organicCarbon,
          phh2o: ph,
          potassium: 150, // Default value since not in API
          phosphorus: 15, // Default value since not in API
        },
        area_hectares: area / 2.471, // Convert acres to hectares for consistency if needed
        geometry: {
          type: "Polygon",
          coordinates: [coordinates.map((coord) => [coord[1], coord[0]])], // Convert to [lng, lat] format
        },
      },
    });
  });

  return plots;
};

const SkeletonBlock: React.FC<{ className?: string }> = ({ className }) => (
  <div
    className={`animate-pulse rounded-xl bg-gray-200/80 ${className || ""}`}
    aria-hidden
  />
);

const SectionLoader: React.FC<{ label?: string }> = ({ label = "Loading…" }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-6">
    <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
    <span className="text-xs text-gray-500">{label}</span>
  </div>
);

const AgroDashboard: React.FC = () => {
  const biomassRanges: BiomassRange[] = [
    { range: "Very Low", color: "bg-red-400" },
    { range: "Low", color: "bg-yellow-400" },
    { range: "Medium", color: "bg-green-400" },
    { range: "High", color: "bg-blue-400" },
    { range: "Very High", color: "bg-purple-400" },
  ];

  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const [weatherTab, setWeatherTab] = useState<"weather" | "rainfall">(
    "weather"
  );
  const [timePeriod, setTimePeriod] = useState<
    "daily" | "weekly" | "monthly" | "yearly"
  >("weekly");
  const gaugeRef = useRef<HTMLDivElement>(null);
  const [mapHeight, setMapHeight] = useState<number>(500);

  // State for filters and data
  const [filters, setFilters] = useState<Filters>({
    soilPH: "All",
    brixRange: "All",
    yieldForecast: "All",
    organicCarbon: "All",
  });

  // State for plot selection
  const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);

  // State for biomass filtering
  const [selectedBiomassRange, setSelectedBiomassRange] = useState<
    string | null
  >(null);

  // State for API data
  const [apiData, setApiData] = useState<Record<string, ApiPlotData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch API data
  useEffect(() => {
    const fetchData = async () => {
      const tzOffsetMs = new Date().getTimezoneOffset() * 60000;
      const today = new Date(Date.now() - tzOffsetMs)
        .toISOString()
        .slice(0, 10);
      const role = getUserRole();

      const cacheKey =
        role === "manager" ? `managerAgroStats_${today}` : `agroStats_${today}`;
      const cached = getCache(cacheKey) as
        | Record<string, ApiPlotData>
        | null
        | undefined;

      if (!cached) {
        setLoading(true);
      }

      try {
        let data: Record<string, ApiPlotData>;

        if (role === "manager") {
          if (cached) {
            data = cached;
          } else {
            data = (await getManagerFieldOfficersAgroStats(
              today,
            )) as Record<string, ApiPlotData>;
            setCache(cacheKey, data);
          }
        } else {
          if (cached) {
            data = cached;
          } else {
            const url = `https://events-cropeye.up.railway.app/plots/agroStats?end_date=${today}`;
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            data = await response.json();
            setCache(cacheKey, data);
          }
        }

        setApiData(data ?? {});
        setError(null);
      } catch (err) {
        console.error("Error fetching data:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch data");
        setApiData({});
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Process API data into plots
  const allPlots = useMemo(() => {
    if (Object.keys(apiData).length === 0) {
      return [];
    }
    return processApiData(apiData);
  }, [apiData]);

  // Filter logic
  const filteredPlots = useMemo(() => {
    let plots = allPlots.filter((plot) => {
      // Soil PH filter
      if (filters.soilPH !== "All") {
        const [min, max] = filters.soilPH.split("-").map(Number);
        if (plot.ph < min || plot.ph > max) return false;
      }

      // Brix Range filter
      if (filters.brixRange !== "All") {
        const [min, max] = filters.brixRange.split("-").map(Number);
        if (plot.brix < min || plot.brix > max) return false;
      }

      // Yield Forecast filter
      if (filters.yieldForecast !== "All") {
        const [min, max] = filters.yieldForecast.split("-").map(Number);
        if (plot.yieldForecast < min || plot.yieldForecast > max) return false;
      }

      // Organic Carbon filter
      if (filters.organicCarbon !== "All") {
        const [min, max] = filters.organicCarbon.split("-").map(Number);
        if (plot.organicCarbon < min || plot.organicCarbon > max) return false;
      }

      return true;
    });

    // Apply plot selection filter
    if (selectedPlotId) {
      plots = plots.filter((plot) => plot.plotNo === selectedPlotId);
    }

    // Apply biomass range filter
    if (selectedBiomassRange) {
      plots = plots.filter((plot) => {
        const biomass = plot.biomass;
        switch (selectedBiomassRange) {
          case "Very Low":
            return biomass <= 20;
          case "Low":
            return biomass > 20 && biomass <= 30;
          case "Medium":
            return biomass > 30 && biomass <= 40;
          case "High":
            return biomass > 40 && biomass <= 50;
          case "Very High":
            return biomass > 50;
          default:
            return true;
        }
      });
    }

    return plots;
  }, [allPlots, filters, selectedPlotId, selectedBiomassRange]);

  // Handle plot selection from field distribution chart
  const handlePlotClick = (plotId: string) => {
    if (plotId === "") {
      setSelectedPlotId(null);
    } else {
      setSelectedPlotId(plotId);
    }
  };

  // Handle biomass range selection
  const handleBiomassClick = (range: string) => {
    if (selectedBiomassRange === range) {
      setSelectedBiomassRange(null); // Deselect if already selected
    } else {
      setSelectedBiomassRange(range);
    }
  };

  // Calculate metrics from filtered data
  const totalArea = useMemo(() => {
    return filteredPlots.reduce((sum, plot) => sum + parseFloat(plot.area), 0);
  }, [filteredPlots]);

  const totalPlots = useMemo(() => {
    return filteredPlots.length;
  }, [filteredPlots]);

  // Calculate total area of all plots (unfiltered) for gauge reference
  const allPlotsTotalArea = useMemo(() => {
    return allPlots.reduce((sum, plot) => sum + parseFloat(plot.area), 0);
  }, [allPlots]);

  // Calculate gauge max value for area based on filter state
  const areaGaugeMaxValue = useMemo(() => {
    // Check if any filters are applied (excluding "All" values)
    const hasActiveFilters = Object.values(filters).some(
      (filter) => filter !== "All"
    );

    if (hasActiveFilters) {
      // If filters are applied, use the total area of all plots as max value
      // This shows filtered area relative to total possible area
      return allPlotsTotalArea;
    } else {
      // If no filters, use the actual total area as max value
      return totalArea;
    }
  }, [filters, totalArea, allPlotsTotalArea]);

  const averagePH = useMemo(() => {
    if (filteredPlots.length === 0) return 0;
    return (
      filteredPlots.reduce((sum, plot) => sum + plot.ph, 0) /
      filteredPlots.length
    );
  }, [filteredPlots]);

  const averageOrganicCarbon = useMemo(() => {
    if (filteredPlots.length === 0) return 0;
    return (
      filteredPlots.reduce((sum, plot) => sum + plot.organicCarbon, 0) /
      filteredPlots.length
    );
  }, [filteredPlots]);

  // Calculate map center from filtered plots
  const mapCenter = useMemo(() => {
    if (filteredPlots.length === 0) {
      return [19.765, 74.475] as [number, number];
    }

    const avgLat =
      filteredPlots.reduce((sum, plot) => sum + plot.position[0], 0) /
      filteredPlots.length;
    const avgLng =
      filteredPlots.reduce((sum, plot) => sum + plot.position[1], 0) /
      filteredPlots.length;

    return [avgLat, avgLng] as [number, number];
  }, [filteredPlots]);

  useEffect(() => {
    if (gaugeRef.current) {
      setMapHeight(gaugeRef.current.offsetHeight);
    }
  }, []);

  function getStatusColor(status: string): string {
    switch (status) {
      case "Ready":
        return "#4ade80"; // green-400
      case "Harvested":
        return "#facc15"; // yellow-400
      case "Growing":
        return "#60a5fa"; // blue-400
      default:
        return "#d1d5db"; // gray-300
    }
  }

  const handleFilterChange = (filterType: keyof Filters, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [filterType]: value,
    }));
  };

  const dataReady = !loading && allPlots.length > 0;

  // MapAutoCenter component
  function MapAutoCenter({ center }: MapAutoCenterProps) {
    const map = useMap();
    useEffect(() => {
      if (center && Array.isArray(center) && !center.some(isNaN)) {
        map.setView(center, map.getZoom());
      }
    }, [center, map]);
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-2 sm:p-4">
      {/* Dropdown Filters - Full width to match sidebar + main content */}
      <div className="max-w-7xl mx-auto mb-6">
        {loading && (
          <div className="mb-3 flex items-center justify-end gap-2 text-sm text-gray-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading dashboard data…
          </div>
        )}
        <div className="">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
            <div className="flex flex-col bg-white p-2 rounded-lg border border-gray-200 shadow-md">
              <DropdownFilter
                label="Soil PH"
                options={["All", "6.0-6.5", "6.5-7.0", "7.0-7.5", "7.5-8.0"]}
                value={filters.soilPH}
                onChange={(value) => handleFilterChange("soilPH", value)}
              />
            </div>
            <div className="flex flex-col bg-white p-2 rounded-lg border border-gray-200  shadow-md">
              <DropdownFilter
                label="Brix Range"
                options={["All", "10-15", "15-20", "20-25", "25-30"]}
                value={filters.brixRange}
                onChange={(value) => handleFilterChange("brixRange", value)}
                style={{ border: "none" }}
              />
            </div>
            <div className="flex flex-col p-2 bg-white rounded-lg border border-gray-200 shadow-md">
              <DropdownFilter
                label="Yield Forecast (T/Ha)"
                options={["All", "20-30", "30-40", "40-50", "50+"]}
                value={filters.yieldForecast}
                onChange={(value) => handleFilterChange("yieldForecast", value)}
              />
            </div>
            <div className="flex flex-col p-2 bg-white rounded-lg border border-gray-200 shadow-md">
              <DropdownFilter
                label="Organic Carbon (%)"
                options={["All", "0.5-1.0", "1.0-1.5", "1.5-2.0", "2.0+"]}
                value={filters.organicCarbon}
                onChange={(value) => handleFilterChange("organicCarbon", value)}
              />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="max-w-7xl mx-auto mb-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-red-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">
                  Error loading data
                </h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
                <div className="mt-4">
                  <button
                    onClick={() => window.location.reload()}
                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && allPlots.length === 0 && (
        <div className="max-w-7xl mx-auto mb-6">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-yellow-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">
                  No data available
                </h3>
                <div className="mt-2 text-sm text-yellow-700">
                  <p>
                    No plot data is currently available. Please try again later.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!error && (
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-4 sm:gap-6">
          {/* Left Sidebar */}
          <div className="w-full lg:w-1/3 flex flex-col gap-3">
            {/* Gauge Charts */}
            <div className="space-y-4">
              <div ref={gaugeRef}>
                {loading ? (
                  <>
                    <div className="flex flex-col items-center p-3 bg-white rounded-lg shadow-sm mb-2 border border-gray-100">
                      <SkeletonBlock className="h-4 w-24 mb-4" />
                      <SkeletonBlock className="h-32 w-44 rounded-full mb-2" />
                      <SkeletonBlock className="h-4 w-32" />
                    </div>
                    <div className="flex flex-col items-center p-3 bg-white rounded-lg shadow-sm mb-2 border border-gray-100">
                      <SkeletonBlock className="h-4 w-28 mb-4" />
                      <SkeletonBlock className="h-32 w-44 rounded-full mb-2" />
                      <SkeletonBlock className="h-4 w-32" />
                    </div>
                  </>
                ) : dataReady ? (
                  <>
                    <GaugeChart
                      value={totalPlots}
                      maxValue={allPlots.length}
                      label="Total Field"
                      color="#3b82f6"
                    />
                    <div className="relative">
                      <GaugeChart
                        value={totalArea}
                        maxValue={areaGaugeMaxValue.toFixed(2)}
                        label="Total Area (acre)"
                        color="#10b981"
                      />
                      {Object.values(filters).some((filter) => filter !== "All")}
                    </div>
                  </>
                ) : (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
                    <SectionLoader label="No field data" />
                  </div>
                )}
              </div>
            </div>

            {/* Field Distribution Chart */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 min-h-[200px]">
              {loading ? (
                <div className="p-4">
                  <SkeletonBlock className="h-5 w-40 mb-4" />
                  <SkeletonBlock className="h-[180px] w-full" />
                </div>
              ) : dataReady ? (
                <FieldDistributionChart
                  plots={filteredPlots.map((plot) => ({
                    id: plot.id,
                    plotNo: plot.plotNo,
                    area: plot.area,
                    status: plot.status,
                  }))}
                  allPlots={allPlots.map((plot) => ({
                    id: plot.id,
                    plotNo: plot.plotNo,
                    area: plot.area,
                    status: plot.status,
                  }))}
                  onPlotClick={handlePlotClick}
                  selectedPlotId={selectedPlotId}
                />
              ) : (
                <SectionLoader label="No distribution data" />
              )}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="w-full flex flex-col gap-4 sm:gap-6">
            {/* Map */}
            <div className="relative bg-green-100 rounded-lg overflow-hidden shadow-sm h-full">
              <div
                ref={mapWrapperRef}
                className="relative w-full h-auto sm:h-[400px] md:h-[500px] lg:h-full min-h-[320px] rounded-lg overflow-hidden"
              >
                {/* Fullscreen Toggle */}
                <div
                  className="absolute top-2 sm:top-4 right-2 sm:right-4 z-20 bg-white text-gray-700 border border-gray-200 shadow-md px-2 py-1 rounded cursor-pointer hover:bg-gray-100 transition"
                  onClick={() => {
                    if (!document.fullscreenElement) {
                      mapWrapperRef.current?.requestFullscreen();
                    } else {
                      document.exitFullscreen();
                    }
                  }}
                >
                  <Maximize2 className="w-3 h-3 sm:w-4 sm:h-4" />
                </div>

                {loading ? (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-100">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-2" />
                    <span className="text-sm text-gray-600">Loading map data…</span>
                  </div>
                ) : dataReady ? (
                  <>
                    {/* Biomass Legend */}
                    <div className="absolute bottom-2 sm:bottom-4 left-2 sm:left-4 backdrop-brightness-50 rounded-lg p-2 sm:p-3 shadow-lg z-20">
                      <h4 className="text-xs sm:text-sm font-medium text-gray-200 mb-1 sm:mb-2">
                        Biomass Range
                      </h4>
                      <div className="flex flex-wrap gap-1 sm:gap-2">
                        {biomassRanges.map((range, index) => (
                          <div
                            key={index}
                            className={`flex items-center text-xs cursor-pointer hover:bg-white/20 rounded px-1 py-1 transition-colors ${
                              selectedBiomassRange === range.range
                                ? "bg-white/30 ring-1 ring-white/50"
                                : ""
                            }`}
                            onClick={() => handleBiomassClick(range.range)}
                            title={`Click to filter by ${range.range} biomass`}
                          >
                            <div
                              className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full mr-1 ${range.color}`}
                            />
                            <span className="text-gray-300 text-xs">
                              {range.range}
                            </span>
                          </div>
                        ))}
                      </div>
                      {selectedBiomassRange && (
                        <button
                          onClick={() => setSelectedBiomassRange(null)}
                          className="mt-2 text-xs text-gray-300 hover:text-white underline cursor-pointer"
                        ></button>
                      )}
                    </div>

                    {/* Map */}
                    <MapContainer
                      center={mapCenter}
                      zoom={15}
                      className="absolute inset-0 z-0"
                      style={{ height: "100%", width: "100%" }}
                    >
                      <MapAutoCenter center={mapCenter} />
                      <TileLayer url="http://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}" />

                      {filteredPlots.map((plot) => (
                        <React.Fragment key={plot.id}>
                          <Polygon
                            positions={plot.coordinates}
                            pathOptions={{
                              color: getStatusColor(plot.status),
                              fillOpacity: 0.2,
                              weight: 2,
                            }}
                          />
                          <CircleMarker
                            center={plot.position}
                            pathOptions={{
                              color: getStatusColor(plot.status),
                              fillColor: getStatusColor(plot.status),
                              fillOpacity: 0.8,
                              weight: 2,
                            }}
                          >
                            <Popup>
                              <div className="text-xs sm:text-sm">
                                <div className="font-semibold text-gray-900 mb-1">
                                  Plot {plot.plotNo}
                                </div>
                                <div className="text-gray-600 mb-1">
                                  Status:{" "}
                                  <span className="font-medium">{plot.status}</span>
                                </div>
                                <div className="text-gray-600 mb-1">
                                  Area:{" "}
                                  <span className="font-medium">{plot.area}</span>
                                </div>
                                <div className="text-gray-600 mb-1">
                                  pH:{" "}
                                  <span className="font-medium">
                                    {plot.ph.toFixed(2)}
                                  </span>
                                </div>
                                <div className="text-gray-600 mb-1">
                                  Organic Carbon:{" "}
                                  <span className="font-medium">
                                    {plot.organicCarbon.toFixed(2)}%
                                  </span>
                                </div>
                                <div className="text-gray-600 mb-1">
                                  Brix:{" "}
                                  <span className="font-medium">
                                    {plot.brix.toFixed(1)}°
                                  </span>
                                </div>
                                <div className="text-gray-600">
                                  Yield Forecast:{" "}
                                  <span className="font-medium">
                                    {plot.yieldForecast.toFixed(1)} T/acre
                                  </span>
                                </div>
                              </div>
                            </Popup>
                            <Tooltip>
                              <span className="text-xs font-medium">
                                {plot.plotNo} - {plot.status}
                              </span>
                            </Tooltip>
                          </CircleMarker>
                        </React.Fragment>
                      ))}
                    </MapContainer>
                  </>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-100 text-sm text-gray-500">
                    Map will appear when plot data is available
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Weather/Rainfall Chart Toggle */}
      {!error && (
        <div className="bg-white p-3 sm:p-4 rounded-lg shadow-sm flex-1 flex flex-col max-w-7xl mx-auto mb-6 mt-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
            <div className="flex gap-6 sm:gap-12 w-full sm:w-auto">
              <button
                className={`px-4 sm:px-7 py-2 rounded-md text-xs sm:text-sm font-medium transition-all duration-200 flex-1 sm:flex-none ${
                  weatherTab === "weather"
                    ? "bg-blue-500 text-white shadow-sm"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
                onClick={() => setWeatherTab("weather")}
                disabled={loading}
              >
                Weather
              </button>
              <button
                className={`px-4 sm:px-6 py-2 sm:py-3 rounded-md text-xs sm:text-sm font-medium transition-all duration-200 flex-1 sm:flex-none ${
                  weatherTab === "rainfall"
                    ? "bg-blue-500 text-white shadow-sm"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
                onClick={() => setWeatherTab("rainfall")}
                disabled={loading}
              >
                Rainfall
              </button>
            </div>
            <div className="flex gap-1 sm:gap-3 w-full sm:w-auto">
              {(["daily", "weekly", "monthly", "yearly"] as const).map((period) => (
                <button
                  key={period}
                  className={`px-2 sm:px-4 py-2 rounded-md text-xs font-medium transition-all duration-200 flex-1 sm:flex-none capitalize ${
                    timePeriod === period
                      ? "bg-blue-500 text-white shadow-md transform scale-105"
                      : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
                  }`}
                  onClick={() => setTimePeriod(period)}
                  disabled={loading}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-h-[280px]">
            {loading ? (
              <div className="h-full flex flex-col gap-3">
                <SkeletonBlock className="h-8 w-48" />
                <SkeletonBlock className="h-[240px] w-full" />
              </div>
            ) : weatherTab === "weather" ? (
              <WeatherChart timePeriod={timePeriod} />
            ) : (
              <RainfallChart timePeriod={timePeriod} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AgroDashboard;
