import React from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Award, Target, Users } from "lucide-react";
import type { FactoryTop25Farmer } from "../../utils/factoryOwnerDashboard";
import type { ScopeMetrics } from "../../utils/ownerOverview";
import { fmt, Gauge, Panel, SectionTitle } from "./ui";

const Legend3: React.FC<{ min: number | null; mean: number | null; max: number | null; unit: string }> = ({ min, mean, max, unit }) => (
  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] font-semibold mt-1">
    <span className="text-rose-500">● min {fmt(min, 1)} {unit}</span>
    <span className="text-violet-500">● mean {fmt(mean, 1)} {unit}</span>
    <span className="text-emerald-600">● max {fmt(max, 1)} {unit}</span>
  </div>
);

export const PerformancePanels: React.FC<{
  m: ScopeMetrics;
  recovery: { regional: number | null; top25: number | null; topFarmers: FactoryTop25Farmer[] };
  scopeLabel: string;
}> = ({ m, recovery, scopeLabel }) => {
  const bars = [
    { name: "This scope", value: m.recovery.avg, fill: "#8b5cf6" },
    { name: "Regional", value: recovery.regional, fill: "#3b82f6" },
    { name: "Top 25", value: recovery.top25, fill: "#22c55e" },
  ].filter((b): b is { name: string; value: number; fill: string } => b.value != null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Panel delay={0.05}>
        <SectionTitle icon={Target} title="Sugarcane Yield Projection" subtitle={scopeLabel} />
        <Gauge value={m.yield.avg} min={0} max={Math.max(120, Math.ceil((m.yield.max ?? 0) / 20) * 20)} unit="T/acre" />
        <div className="text-center text-[11px] text-gray-500 -mt-1">Sugarcane Yield Forecast</div>
        <Legend3 min={m.yield.min} mean={m.yield.avg} max={m.yield.max} unit="T/acre" />
      </Panel>

      <Panel delay={0.1}>
        <SectionTitle icon={Activity} title="Biomass Performance" subtitle={scopeLabel} />
        <Gauge value={m.biomass.avg} min={0} max={Math.max(120, Math.ceil((m.biomass.max ?? 0) / 20) * 20)} unit="T/acre" color="#eab308" />
        <div className="text-center text-[11px] text-gray-500 -mt-1">Biomass Forecast</div>
        <Legend3 min={m.biomass.min} mean={m.biomass.avg} max={m.biomass.max} unit="T/acre" />
        <div className="mt-3 bg-gray-50 rounded-xl p-2 text-[11px] text-gray-600">
          Biomass vs yield ratio:{" "}
          <b className="text-gray-800">{m.biomass.avg && m.yield.avg ? fmt(m.yield.avg / m.biomass.avg, 2) : "—"}</b>
          <span className="text-gray-400"> · higher means more cane per unit growth</span>
        </div>
      </Panel>

      <Panel delay={0.15}>
        <SectionTitle icon={Users} title="Recovery Rate Comparison" subtitle="Scope vs factory region vs top 25 farmers" />
        {bars.length ? (
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 36, left: 8, bottom: 0 }}>
                <XAxis type="number" hide domain={[0, (dataMax: number) => Math.ceil(dataMax + 1)]} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={72} />
                <Tooltip formatter={(v: any) => [`${fmt(Number(v), 2)}%`, "Recovery"]} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} isAnimationActive={false} barSize={18}>
                  {bars.map((b) => (
                    <Cell key={b.name} fill={b.fill} />
                  ))}
                  <LabelList dataKey="value" position="right" formatter={(v: number) => `${fmt(v, 2)}%`} style={{ fontSize: 11, fontWeight: 700, fill: "#334155" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-36 flex items-center justify-center text-sm text-gray-400 text-center px-4">No recovery data available for this factory yet</div>
        )}
        {recovery.topFarmers.length > 0 && (
          <div className="mt-2">
            <div className="flex items-center gap-1 text-[11px] font-bold text-gray-700 mb-1">
              <Award className="w-3.5 h-3.5 text-amber-500" /> Top farmers by recovery
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
              {recovery.topFarmers.slice(0, 5).map((f, i) => (
                <div key={f.farmer_id} className="flex items-center gap-2 text-[11px]">
                  <span className="w-4 text-gray-400 font-bold">{i + 1}</span>
                  <span className="flex-1 truncate text-gray-700">{f.farmer_name}</span>
                  <span className="text-gray-400">{f.plot_count} plots</span>
                  <span className="font-bold text-emerald-700 tabular-nums">{fmt(f.recovery_avg_pct, 2)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
};

export default PerformancePanels;
