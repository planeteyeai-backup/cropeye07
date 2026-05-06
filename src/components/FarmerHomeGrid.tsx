import { useState, useEffect } from 'react';
import './App.css';
import { Header } from './HeaderFarm';
import  SoilAnalysis  from './SoilAnalysis';
import { FieldHealthAnalysis } from './FieldHealthAnalysis';
import CropHealthAnalysis from './CropHealthAnalysis';
import FertilizerTable from './FertilizerTable';
import IrrigationSchedule from './IrrigationSchedule';
import WeatherForecast from './WeatherForecast';
import Map from './Map';
import SoilMoistureCard from './Irrigation/cards/SoilMoistureCard';

function FarmerHomeGrid() {
  const [soilData, setSoilData] = useState<{
    plotName: string;
    phValue: number | null;
    phStatistics?: {
      phh2o_0_5cm_mean_mean: number;
    };
    total_nitrogen?: number;
    nitrogen_0_5cm_mean?: number;
  } | null>(null);

  // New state for field analysis data
  const [fieldAnalysisData, setFieldAnalysisData] = useState<{
    plotName: string;
    overallHealth: number;
    healthStatus: string;
    statistics: {
      mean: number;
    };
  } | null>(null);

  // State to track selected plot name
  const [selectedPlotName, setSelectedPlotName] = useState<string | null>(null);

  const handleMoistGroundChange = (_value: number | null) => {
    // Reserved for future UI (e.g., showing moisture summary card)
  };

  const [splitScreen, setSplitScreen] = useState(false);

  useEffect(() => {
    if (splitScreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [splitScreen]);

  const handleHealthDataChange = (_data: {
    goodHealthPercent: number;
    needsAttentionPercent: number;
    totalArea: number;
    plotName: string;
  }) => {
    // Parent dashboard currently doesn't render these values, but Map expects the callback.
    // Keeping it to avoid prop churn.
  };

  const handleSoilDataChange = (data: {
    plotName: string;
    phValue: number | null;
    phStatistics?: {
      phh2o_0_5cm_mean_mean: number;
    };
    total_nitrogen?: number;
    nitrogen_0_5cm_mean?: number;
  }) => {
    setSoilData(data);
    setSelectedPlotName(data.plotName || null);
  };

  // New handler for field analysis data
  const handleFieldAnalysisChange = (data: {
    plotName: string;
    overallHealth: number;
    healthStatus: string;
    statistics: {
      mean: number;
    };
  }) => {
    setFieldAnalysisData(data);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-slate-100">
      <Header />
      <main className="mx-auto w-full max-w-[1500px] px-3 sm:px-5 py-3 sm:py-5">
        <div className="space-y-4">
          {/* Map + Irrigation / Soil Moisture / Field Score (side column) */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:items-stretch">
            <div className="lg:col-span-9 lg:h-[140vh] rounded-2xl bg-white/90 backdrop-blur-sm shadow-lg ring-1 ring-black/5 overflow-hidden">
              <Map
                onHealthDataChange={handleHealthDataChange}
                onSoilDataChange={handleSoilDataChange}
                onFieldAnalysisChange={handleFieldAnalysisChange}
                onMoistGroundChange={handleMoistGroundChange}
                onSplitScreen={() => setSplitScreen(true)}
              />
            </div>

            <div className="lg:col-span-3 lg:h-[140vh] min-h-0 flex flex-col gap-4">
              {/* Top half (50%): Field Score + Soil Moisture (each 25%) */}
              <div className="min-h-0 flex flex-col gap-4 flex-1">
                <div className="flex-1 min-h-0 rounded-2xl bg-white/90 backdrop-blur-sm shadow-lg ring-1 ring-black/5 overflow-hidden">
                  <FieldHealthAnalysis fieldAnalysisData={fieldAnalysisData} compact />
                </div>
                <div className="flex-1 min-h-0 rounded-2xl bg-white/90 backdrop-blur-sm shadow-lg ring-1 ring-black/5 overflow-hidden">
                  <SoilMoistureCard optimalRange={[40, 60]} compact />
                </div>
              </div>

              {/* Bottom half (50%): Irrigation schedule */}
              <div className="flex-1 min-h-0 rounded-2xl bg-white/90 backdrop-blur-sm shadow-lg ring-1 ring-black/5 overflow-hidden">
                <div className="h-full overflow-auto">
                  <IrrigationSchedule />
                </div>
              </div>
            </div>
          </section>

          {/* Crop Health + Soil Analysis (side-by-side); Fertilizer below full width */}
          <section className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
              <div className="min-h-[60vh] max-h-[88vh] overflow-y-auto scroll-hide lg:col-span-5 rounded-2xl bg-white/90 backdrop-blur-sm shadow-lg ring-1 ring-black/5 overflow-hidden">
                <CropHealthAnalysis />
              </div>

              <div className="min-h-0 lg:col-span-7">
                <SoilAnalysis
                  plotName={selectedPlotName}
                  phValue={soilData?.phValue || null}
                  phStatistics={soilData?.phStatistics}
                  compact
                />
              </div>
            </div>

            <div className="rounded-2xl bg-white/90 backdrop-blur-sm shadow-lg ring-1 ring-black/5 overflow-hidden">
              <div className="p-3 sm:p-4">
                <FertilizerTable />
              </div>
            </div>
          </section>

          {/* Fifth row: Weather */}
          <section className="rounded-2xl bg-white/90 backdrop-blur-sm shadow-lg ring-1 ring-black/5 overflow-hidden">
            <WeatherForecast />
          </section>
        </div>
      </main>

      {/* ── Split Screen Overlay ── */}
      {splitScreen && (
        <div className="splitscreen-overlay">
          {/* Header bar */}
          <div className="splitscreen-header">
            <span className="splitscreen-header-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="12" y1="3" x2="12" y2="21" />
              </svg>
              Split Screen View
            </span>
            <button
              className="splitscreen-close-btn"
              onClick={() => setSplitScreen(false)}
            >
              ✕ Exit Split Screen
            </button>
          </div>

          {/* Two map panels */}
          <div className="splitscreen-panels">
            <div className="splitscreen-panel">
              <span className="splitscreen-panel-label">Panel 1</span>
              <Map
                onHealthDataChange={() => {}}
                onSoilDataChange={() => {}}
                onFieldAnalysisChange={() => {}}
                onMoistGroundChange={() => {}}
              />
            </div>
            <div className="splitscreen-divider" />
            <div className="splitscreen-panel">
              <span className="splitscreen-panel-label">Panel 2</span>
              <Map
                onHealthDataChange={() => {}}
                onSoilDataChange={() => {}}
                onFieldAnalysisChange={() => {}}
                onMoistGroundChange={() => {}}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FarmerHomeGrid;
