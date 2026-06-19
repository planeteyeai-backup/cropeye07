import React from "react";
import { Loader2 } from "lucide-react";

interface MapCropStatusOverlayProps {
  growthStage: string | null;
  plantationDate: string | null;
  plantationType: string | null;
  loading?: boolean;
}

const MapCropStatusOverlay: React.FC<MapCropStatusOverlayProps> = ({
  growthStage,
  plantationDate,
  plantationType,
  loading = false,
}) => {
  const statusLabel =
    loading && !growthStage ? "Loading..." : growthStage ?? "Loading...";

  return (
    <div className="absolute top-10 left-1/2 -translate-x-1/2 z-10 pointer-events-none w-[calc(100%-2rem)] max-w-xl">
      <div className="bg-black/20 backdrop-blur-sm rounded-2xl px-3 sm:px-5 py-3 border border-white/30 shadow-2xl">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex-1 min-w-0 text-center">
            <p className="text-[10px] sm:text-xs text-white/75 font-medium uppercase tracking-wide truncate">
              Plantation Date
            </p>
            <div className="text-white font-semibold text-xs sm:text-sm drop-shadow-lg truncate">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : (
                plantationDate || "-"
              )}
            </div>
          </div>

          <div className="w-px h-10 bg-white/30 shrink-0" />

          <div className="flex items-center gap-2 shrink-0 px-1">
            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
            <div className="text-white font-bold text-sm sm:text-lg drop-shadow-lg whitespace-nowrap">
              {statusLabel}
            </div>
          </div>

          <div className="w-px h-10 bg-white/30 shrink-0" />

          <div className="flex-1 min-w-0 text-center">
            <p className="text-[10px] sm:text-xs text-white/75 font-medium uppercase tracking-wide truncate">
              Plantation Type
            </p>
            <div className="text-white font-semibold text-xs sm:text-sm drop-shadow-lg truncate">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : (
                plantationType || "-"
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapCropStatusOverlay;
