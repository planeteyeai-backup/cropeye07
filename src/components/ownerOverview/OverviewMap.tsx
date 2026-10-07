import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polygon, CircleMarker, Tooltip as LeafletTooltip, useMap } from "react-leaflet";
import { LatLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Maximize2, Minimize2, X } from "lucide-react";
import {
  normKey,
  plotGrowthTrend,
  STAGE_COLORS,
  type OverviewPlot,
  type PlotExtra,
  type ScopeMetrics,
} from "../../utils/ownerOverview";
import { fmt } from "./ui";

export type ColorMode = "stage" | "harvest" | "yield" | "score" | "trend";

const MODES: Array<{ id: ColorMode; label: string }> = [
  { id: "stage", label: "Crop Stage" },
  { id: "harvest", label: "Days to Harvest" },
  { id: "yield", label: "Expected Yield" },
  { id: "score", label: "Field Score" },
  { id: "trend", label: "Growth Trend" },
];

const GREY = "#94a3b8";

function colorFor(mode: ColorMode, p: OverviewPlot, extra?: PlotExtra): string {
  switch (mode) {
    case "stage":
      return STAGE_COLORS[p.stage];
    case "harvest": {
      const d = p.daysToHarvest;
      if (d == null) return GREY;
      if (d <= 15) return "#dc2626";
      if (d <= 45) return "#f97316";
      if (d <= 90) return "#facc15";
      if (d <= 120) return "#84cc16";
      return "#16a34a";
    }
    case "yield": {
      const y = p.expectedYield;
      if (y == null) return GREY;
      if (y > 100) return "#047857";
      if (y >= 75) return "#22c55e";
      if (y >= 50) return "#f59e0b";
      return "#ef4444";
    }
    case "score": {
      const s = p.fieldScore ?? extra?.fieldScore ?? null;
      if (s == null) return GREY;
      if (s > 80) return "#10b981";
      if (s >= 60) return "#84cc16";
      if (s >= 40) return "#f59e0b";
      return "#ef4444";
    }
    case "trend": {
      const t = plotGrowthTrend(extra?.indices);
      if (t.delta == null) return GREY;
      if (t.delta <= -0.05) return "#ef4444";
      if (t.delta < 0) return "#f59e0b";
      return "#10b981";
    }
  }
}

const LEGENDS: Record<ColorMode, Array<[string, string]>> = {
  stage: [["Harvest Maturity", STAGE_COLORS["Harvest Maturity"]], ["Grand Growth", STAGE_COLORS["Grand Growth"]], ["Tillering", STAGE_COLORS.Tillering], ["Other", GREY]],
  harvest: [["≤15 d", "#dc2626"], ["≤45 d", "#f97316"], ["≤90 d", "#facc15"], ["≤120 d", "#84cc16"], [">120 d", "#16a34a"]],
  yield: [[">100", "#047857"], ["75–100", "#22c55e"], ["50–75", "#f59e0b"], ["<50 T/acre", "#ef4444"]],
  score: [[">80%", "#10b981"], ["60–80", "#84cc16"], ["40–60", "#f59e0b"], ["<40%", "#ef4444"], ["not scored", GREY]],
  trend: [["Improving", "#10b981"], ["Slight dip", "#f59e0b"], ["Declining", "#ef4444"], ["No history", GREY]],
};

const Fit: React.FC<{ plots: OverviewPlot[]; fitKey: string; expanded: boolean }> = ({ plots, fitKey, expanded }) => {
  const map = useMap();
  useEffect(() => {
    const t = window.setTimeout(() => {
      map.invalidateSize();
      const pts: [number, number][] = [];
      for (const p of plots) {
        if (p.positions.length >= 3) pts.push(...p.positions);
        else if (p.point) pts.push(p.point);
      }
      if (!pts.length) return;
      try {
        const b = new LatLngBounds(pts);
        if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: plots.length === 1 ? 17 : 15 });
      } catch {
        /* ignore */
      }
    }, 380);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey, expanded]);
  return null;
};

export const OverviewMap: React.FC<{
  plots: OverviewPlot[];
  extras: Record<string, PlotExtra>;
  metrics: ScopeMetrics;
  focus: { label: string; keys: Set<string> } | null;
  onClearFocus: () => void;
  selectedPlotKey: string;
  selectedFarmerId: string;
  onPick: (p: OverviewPlot) => void;
  mode: ColorMode;
  onMode: (m: ColorMode) => void;
  fitKey: string;
  loadingNote?: string;
}> = ({ plots, extras, metrics, focus, onClearFocus, selectedPlotKey, selectedFarmerId, onPick, mode, onMode, fitKey, loadingNote }) => {
  const [expanded, setExpanded] = useState(false);
  const mappable = useMemo(() => plots.filter((p) => p.positions.length >= 3 || p.point), [plots]);
  const focused = useMemo(
    () => (focus ? mappable.filter((p) => focus.keys.has(normKey(p.key))) : mappable),
    [focus, mappable],
  );

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const overlay = `Harvest Maturity: ${metrics.stage.harvest_maturity} · Grand Growth: ${metrics.stage.grand_growth} · Tillering: ${metrics.stage.tillering}`;

  return (
    <div className={expanded ? "fixed inset-0 z-[1200] bg-black/60 p-4 flex" : "relative"}>
      <div className={`relative rounded-xl overflow-hidden ring-1 ring-gray-200 bg-gray-100 ${expanded ? "flex-1" : "h-[460px]"}`}>
        <MapContainer center={[16.1, 75.2]} zoom={9} className="w-full h-full" scrollWheelZoom>
          <TileLayer url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}" attribution="© Google" maxZoom={20} />
          <Fit plots={focus && focused.length ? focused : mappable} fitKey={`${fitKey}|${focus?.label ?? ""}`} expanded={expanded} />
          {mappable.map((p) => {
            const extra = extras[normKey(p.key)];
            const dim = focus ? !focus.keys.has(normKey(p.key)) : false;
            const color = dim ? "#cbd5e1" : colorFor(mode, p, extra);
            const active = selectedPlotKey === p.key || (!!selectedFarmerId && selectedFarmerId === p.farmerId);
            const trend = plotGrowthTrend(extra?.indices);
            const tip = (
              <div className="text-xs leading-5 min-w-[190px]">
                <div className="font-bold text-sm text-gray-900">Plot {p.label}</div>
                <div><span className="text-gray-500">Farmer:</span> {p.farmerName}</div>
                <div><span className="text-gray-500">Field Officer:</span> {p.fieldOfficerName}</div>
                <div><span className="text-gray-500">Area:</span> {fmt(p.areaAcres, 2)} acre · {p.stage}</div>
                {p.daysToHarvest != null && <div><span className="text-gray-500">Days to harvest:</span> {p.daysToHarvest}</div>}
                {p.expectedYield != null && <div><span className="text-gray-500">Expected yield:</span> {fmt(p.expectedYield, 1)} T/acre</div>}
                {p.brix != null && <div><span className="text-gray-500">Brix / Recovery:</span> {fmt(p.brix, 1)}° / {fmt(p.recovery, 2)}%</div>}
                {(p.fieldScore ?? extra?.fieldScore) != null && <div><span className="text-gray-500">Field score:</span> {fmt(p.fieldScore ?? extra?.fieldScore ?? null, 0)}%</div>}
                {trend.now != null && (
                  <div>
                    <span className="text-gray-500">Growth (NDVI):</span> {fmt(trend.now, 2)}
                    {trend.delta != null && <span className={trend.delta < 0 ? "text-rose-600" : "text-emerald-600"}> ({trend.delta >= 0 ? "+" : ""}{fmt(trend.delta, 2)} / 30 d)</span>}
                  </div>
                )}
              </div>
            );
            const handlers = { click: () => onPick(p) };
            return p.positions.length >= 3 ? (
              <Polygon
                key={`poly-${p.fieldOfficerId}-${p.key}`}
                positions={p.positions}
                pathOptions={{ color: active ? "#ffffff" : color, weight: active ? 3 : 1.5, fillColor: color, fillOpacity: dim ? 0.15 : 0.6 }}
                eventHandlers={handlers}
              >
                <LeafletTooltip sticky>{tip}</LeafletTooltip>
              </Polygon>
            ) : (
              <CircleMarker
                key={`pt-${p.fieldOfficerId}-${p.key}`}
                center={p.point as [number, number]}
                radius={active ? 8 : 6}
                pathOptions={{ color: "#ffffff", weight: 1.5, fillColor: color, fillOpacity: dim ? 0.25 : 0.95 }}
                eventHandlers={handlers}
              >
                <LeafletTooltip>{tip}</LeafletTooltip>
              </CircleMarker>
            );
          })}
          {/* Halo so focused plots stand out even at command-area zoom */}
          {focus &&
            focused.map((p) =>
              p.point ? (
                <CircleMarker
                  key={`halo-${p.fieldOfficerId}-${p.key}`}
                  center={p.point}
                  radius={11}
                  className="ov-halo"
                  pathOptions={{ color: "#facc15", weight: 3, fillColor: "#facc15", fillOpacity: 0.18 }}
                  eventHandlers={{ click: () => onPick(p) }}
                />
              ) : null,
            )}
        </MapContainer>
        <style>{`.ov-halo{animation:ovPulse 1.6s ease-in-out infinite;transform-origin:center;transform-box:fill-box}@keyframes ovPulse{0%,100%{stroke-opacity:1}50%{stroke-opacity:.35}}`}</style>

        {/* Stage overlay (same summary as Farm Crop Status map) */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] pointer-events-none max-w-[calc(100%-6rem)]">
          <div className="bg-black/35 backdrop-blur-md text-white text-[11px] sm:text-xs font-semibold px-3 py-2 rounded-xl border border-white/25 shadow-xl flex items-center gap-2 whitespace-nowrap overflow-hidden">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" /> <span className="truncate">{overlay}</span>
          </div>
        </div>

        {/* Mode switcher */}
        <div className="absolute top-14 right-3 z-[500] flex flex-col items-end gap-1">
          <span className="text-[9px] uppercase tracking-wider font-bold text-white/90 drop-shadow px-1">Colour by</span>
          {MODES.map((md) => (
            <button
              key={md.id}
              onClick={() => onMode(md.id)}
              className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-lg shadow transition text-right ${
                mode === md.id ? "bg-emerald-600 text-white" : "bg-white/90 text-gray-700 hover:bg-white"
              }`}
            >
              {md.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="absolute top-3 right-3 z-[500] bg-white/90 hover:bg-white rounded-lg p-2 shadow"
          title={expanded ? "Exit full screen" : "Full screen"}
        >
          {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 z-[500] bg-white/90 backdrop-blur rounded-xl shadow px-3 py-2 flex flex-wrap gap-x-3 gap-y-1 max-w-[calc(100%-1.5rem)]">
          {LEGENDS[mode].map(([l, c]) => (
            <span key={l} className="flex items-center gap-1 text-[10px] text-gray-700">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} /> {l}
            </span>
          ))}
        </div>

        {focus && (
          <div className="absolute bottom-3 right-3 z-[500] bg-gray-900/85 text-white rounded-xl shadow px-3 py-2 text-xs flex items-center gap-2">
            <Crosshair className="w-3.5 h-3.5 text-amber-300" />
            <span>
              Focus: <b>{focus.label}</b> · {focused.length} plot{focused.length === 1 ? "" : "s"}
            </span>
            <button onClick={onClearFocus} className="ml-1 hover:text-amber-300" title="Clear focus">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {mappable.length === 0 && (
          <div className="absolute inset-x-0 top-1/2 z-[500] flex justify-center pointer-events-none">
            <div className="bg-white/90 rounded-xl px-4 py-2 text-sm text-gray-600 shadow">
              {loadingNote ?? "No plot boundaries available for this selection"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OverviewMap;
