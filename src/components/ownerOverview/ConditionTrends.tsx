import React, { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { History, LineChart as LineIcon } from "lucide-react";
import {
  aggregateIndexSeries,
  compareWindows,
  INDEX_META,
  type IndexKey,
  type IndexPoint,
  type Period,
} from "../../utils/ownerOverview";
import { Delta, fmt, Panel, SectionTitle, Spinner } from "./ui";

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
];

const READING: Record<IndexKey, (d: number | null) => string> = {
  growth: (d) => (d == null ? "" : d <= -8 ? "Canopy vigour falling" : d >= 5 ? "Canopy vigour improving" : "Vigour stable"),
  stress: (d) => (d == null ? "" : d <= -10 ? "Leaf moisture dropping — stress rising" : d >= 5 ? "Stress easing" : "Stress stable"),
  water: (d) => (d == null ? "" : d <= -12 ? "Water content falling — check irrigation" : d >= 5 ? "Water status improving" : "Water status stable"),
  moisture: (d) => (d == null ? "" : d <= -10 ? "Chlorophyll / N stress building" : d >= 5 ? "Chlorophyll improving" : "Chlorophyll stable"),
};

export const ConditionTrends: React.FC<{
  series: IndexPoint[][];
  monitored: number;
  total: number;
  loading: boolean;
  progress: { done: number; total: number };
  scopeLabel: string;
}> = ({ series, monitored, total, loading, progress, scopeLabel }) => {
  const [period, setPeriod] = useState<Period>("monthly");
  const [visible, setVisible] = useState<Record<IndexKey, boolean>>({ growth: true, stress: true, water: true, moisture: true });
  const rows = useMemo(
    () => aggregateIndexSeries(series, period).map((r) => ({ ...r, growthBand: r.growthBand ?? undefined })),
    [series, period],
  );
  const cmp = useMemo(() => compareWindows(series), [series]);
  const empty = !rows.length;

  return (
    <Panel id="ov-trends">
      <SectionTitle
        icon={History}
        title="Condition History — past vs current"
        subtitle={
          <>
            {scopeLabel} · cumulative across {monitored} of {total} plots
            {monitored < total ? " (sampled across field officers)" : ""}
            {cmp.latest ? ` · latest image ${new Date(cmp.latest).toLocaleDateString("en-IN")}` : ""}
          </>
        }
        right={
          <div className="flex items-center gap-2">
            {loading && (
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <Spinner /> {progress.done}/{progress.total}
                <div className="w-20 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                </div>
              </div>
            )}
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition ${period === p.id ? "bg-white text-emerald-700 shadow" : "text-gray-500"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {/* Averages and deltas are calculated from returned satellite-index observations. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {(Object.keys(INDEX_META) as IndexKey[]).map((k) => {
          const c = cmp.rows.find((r) => r.key === k);
          const meta = INDEX_META[k];
          return (
            <div key={k} className="rounded-xl border border-gray-100 p-3 bg-gradient-to-br from-white to-gray-50/70">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-600">
                <span className="w-2 h-2 rounded-full" style={{ background: meta.color }} /> {meta.label}
                <span className="text-[9px] font-medium text-gray-400">({meta.source})</span>
              </div>
              <div className="flex items-end justify-between mt-1">
                <div>
                  <div className="text-[9px] uppercase text-gray-400 font-semibold">Now (30 d)</div>
                  <div className="text-xl font-extrabold text-gray-800 tabular-nums">{fmt(c?.now ?? null, 3)}</div>
                </div>
                <div className="text-right space-y-0.5">
                  <div className="text-[10px] text-gray-500 flex items-center gap-1 justify-end">
                    last month <Delta pct={c?.dPrevPct ?? null} />
                  </div>
                  <div className="text-[10px] text-gray-500 flex items-center gap-1 justify-end">
                    last season <Delta pct={c?.dSeasonPct ?? null} />
                  </div>
                </div>
              </div>
              <div className="mt-1.5 text-[10px] text-gray-500 flex justify-between">
                <span>Prev {fmt(c?.prev ?? null, 3)}</span>
                <span title={c?.dSeasonPct == null && c?.lastSeason != null ? "Prior-year index is available, but a percentage cannot be calculated when the prior-year mean is zero or the current mean is missing." : undefined}>
                  Prior yr {fmt(c?.lastSeason ?? null, 3)}
                </span>
              </div>
              <div className="mt-1 text-[11px] font-semibold text-gray-700">{READING[k](c?.dPrevPct ?? null)}</div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
          <LineIcon className="w-3.5 h-3.5 text-emerald-600" /> Field Indices — average of all monitored plots
        </div>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(INDEX_META) as IndexKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setVisible((v) => ({ ...v, [k]: !v[k] }))}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition ${visible[k] ? "text-white border-transparent" : "bg-white text-gray-400 border-gray-200"}`}
              style={visible[k] ? { background: INDEX_META[k].color } : undefined}
            >
              {INDEX_META[k].label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-72">
        {empty ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">{loading ? "Loading plot history…" : "No index history available"}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="gBand" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={18} />
              <YAxis tick={{ fontSize: 10 }} domain={[-0.1, 1]} />
              <Tooltip
                formatter={(v: any, name: string) => (Array.isArray(v) ? [`${fmt(v[0], 2)} – ${fmt(v[1], 2)}`, "Growth spread (p10–p90)"] : [fmt(Number(v), 3), name])}
                labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.plots ?? 0} plots`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {visible.growth && <Area type="monotone" dataKey="growthBand" name="Growth spread (p10–p90)" stroke="none" fill="url(#gBand)" isAnimationActive={false} connectNulls />}
              {(Object.keys(INDEX_META) as IndexKey[]).map((k) =>
                visible[k] ? (
                  <Line key={k} type="monotone" dataKey={k} name={INDEX_META[k].label} stroke={INDEX_META[k].color} strokeWidth={k === "growth" ? 2.6 : 1.8} dot={false} connectNulls isAnimationActive={false} />
                ) : null,
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
};

export default ConditionTrends;
