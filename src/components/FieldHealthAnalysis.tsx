import React, { useState, useEffect } from "react";

interface FieldHealthAnalysisProps {
  fieldAnalysisData: {
    plotName: string;
    overallHealth: number;
    healthStatus: string;
    statistics: {
      mean: number;
    };
  } | null;
  /** Use a tighter layout for sidebar stacks (FarmerHomeGrid right panel). */
  compact?: boolean;
}

// ✅ Updated: Removed arcOpacity, keeping only arc color
function getHealthColors(score: number) {
  if (score >= 75) {
    return {
      arc: "#16a34a",        // Green
      box: "bg-green-100 text-green-800 border border-green-300",
      range: "75-100"
    };
  }
  if (score >= 65) {
    return {
      arc: "#22c55e",        // Light Green
      box: "bg-green-50 text-green-700 border border-green-200",
      range: "65-74"
    };
  }
  if (score >= 55) {
    return {
      arc: "#eab308",        // Yellow
      box: "bg-yellow-100 text-yellow-800 border border-yellow-300",
      range: "55-64"
    };
  }
  if (score >= 45) {
    return {
      arc: "#f97316",        // Orange
      box: "bg-orange-100 text-orange-800 border border-orange-300",
      range: "45-54"
    };
  }
  return {
    arc: "#ef4444",          // Red
    box: "bg-red-100 text-red-800 border border-red-300",
    range: "0-44"
  };
}

export const FieldHealthAnalysis: React.FC<FieldHealthAnalysisProps> = ({
  fieldAnalysisData,
  compact = false,
}) => {
  const [animatedPercent, setAnimatedPercent] = useState(0);
  const targetPercent = fieldAnalysisData?.overallHealth ?? 0;

  useEffect(() => {
    const animationTimeout = setTimeout(() => {
      setAnimatedPercent(targetPercent);
    }, 100);
    return () => clearTimeout(animationTimeout);
  }, [targetPercent]);

  const colors = getHealthColors(targetPercent);
  
  // ✅ Fixed orange color for remaining arc
  const remainingArcColor = "#f59e0b"; // Orange color

  return (
    <div
      className={`card h-full flex flex-col relative ${compact ? "p-3" : "p-4"} ${compact ? "min-h-[220px]" : "min-h-[320px]"}`}
    >
      <div className="flex justify-between items-start">
        <h2 className="card-title text-lg font-semibold text-gray-800">
          Field Score
        </h2>
        {fieldAnalysisData && (
          <div className="text-right text-sm text-gray-700">
            <div className="font-medium">
              PlotID : {fieldAnalysisData.plotName}
            </div>
          </div>
        )}
      </div>

      <div className={`card-body ${compact ? "mt-2 p-0" : "mt-4"}`}>
        {fieldAnalysisData ? (
          <>
            <div className={`flex justify-center ${compact ? "mb-2" : "mb-6"}`}>
              <div className={`${compact ? "w-40 h-40" : "w-60 h-60"} relative`}>
                <svg viewBox="0 0 36 36" className="w-full h-full">
                  {/* Background circle */}
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831
                       a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#E5E7EB"
                    strokeWidth="3.8"
                  />
                  
                  {/* Active health arc - Dynamic color based on score */}
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831
                       a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke={colors.arc}
                    strokeWidth="3.8"
                    strokeDasharray={`${animatedPercent}, 100`}
                    strokeLinecap="round"
                    style={{ transition: "stroke-dasharray 1.5s ease-in-out" }}
                  />
                  
                  {/* Remaining arc - Always ORANGE */}
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831
                       a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke={remainingArcColor}
                    strokeWidth="3.8"
                    strokeDasharray={`${100 - animatedPercent}, 100`}
                    strokeDashoffset={`-${animatedPercent}`}
                    strokeLinecap="round"
                    style={{
                      transition: "all 1.5s ease-in-out",
                      strokeOpacity: 0.3,
                    }}
                  />
                  
                  {/* Center text */}
                  <text
                    x="18"
                    y="20.5"
                    textAnchor="middle"
                    className="fill-gray-800 text-[0.45rem] font-bold"
                  >
                    {targetPercent.toFixed(1)}%
                  </text>
                </svg>
              </div>
            </div>

            {/* Status box with consistent colors */}
            {/* <div className="mt-6 flex justify-center">
              <div className={`px-6 py-3 rounded-lg shadow text-center w-full max-w-xs ${colors.box}`}>
                <div className="font-bold text-xl mb-1">
                  Status: {computedStatus}
                </div>
                <div className="text-sm">
                  Optimal range: 60-80
                </div>
              </div>
            </div> */}
          </>
        ) : (
          <div className="text-gray-500 text-center py-10">
            No data available for the selected plot.
          </div>
        )}
      </div>
    </div>
  );
};