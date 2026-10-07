import React from "react";
import { motion } from "framer-motion";
import {
  Activity,
  BarChart3,
  CalendarClock,
  Droplets,
  Gauge as GaugeIcon,
  Leaf,
  MapPin,
  Sprout,
  Target,
  TestTube2,
} from "lucide-react";
import { STAGE_COLORS, type CropStage, type OverviewPlot, type ScopeMetrics } from "../../utils/ownerOverview";
import { CountUp, fmt, SourceBadge, Spinner, TONES, type Tone } from "./ui";

export type FocusFn = (label: string, test: (p: OverviewPlot) => boolean) => void;

type Health = "good" | "warn" | "bad" | "none";
const HEALTH_RING: Record<Health, string> = {
  good: "ring-emerald-200",
  warn: "ring-amber-200",
  bad: "ring-rose-200",
  none: "ring-gray-100",
};
const HEALTH_DOT: Record<Health, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
  none: "bg-gray-300",
};

const Card: React.FC<{
  title: string;
  icon: React.ElementType;
  tone: Tone;
  health?: Health;
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  i: number;
  children: React.ReactNode;
}> = ({ title, icon: Icon, tone, health = "none", badge, footer, i, children }) => {
  const t = TONES[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, delay: 0.03 * i }}
      className={`relative overflow-hidden bg-white rounded-2xl border border-gray-100 ring-1 ${HEALTH_RING[health]} shadow-sm hover:shadow-lg transition-shadow p-3.5 flex flex-col gap-2 min-h-[150px]`}
    >
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${t.bar}`} />
      <div className="flex items-center gap-2">
        <span className={`${t.soft} ${t.text} rounded-lg p-1.5`}>
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-[12px] font-bold text-gray-700 leading-tight flex-1">{title}</span>
        {health !== "none" && <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[health]}`} title="Health signal" />}
        {badge}
      </div>
      <div className="flex-1">{children}</div>
      {footer && <div className="text-[10px] text-gray-400 leading-tight">{footer}</div>}
    </motion.div>
  );
};

const Bucket: React.FC<{
  label: string;
  value: number;
  total: number;
  color: string;
  onClick?: () => void;
  suffix?: string;
}> = ({ label, value, total, color, onClick, suffix = "plots" }) => {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick || value === 0}
      className="group w-full text-left disabled:cursor-default"
      title={onClick && value ? "Show these plots on the map" : undefined}
    >
      <div className="flex items-center justify-between text-[11px] leading-4">
        <span className="text-gray-600 group-enabled:group-hover:text-gray-900">{label}</span>
        <span className="font-bold tabular-nums" style={{ color }}>
          {value} <span className="font-medium text-gray-400">{suffix === "plots" && value === 1 ? "plot" : suffix}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mt-0.5">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(value ? 3 : 0, pct)}%` }}
          transition={{ duration: 0.6 }}
        />
      </div>
    </button>
  );
};

const Big: React.FC<{ value: number | null; digits?: number; unit?: string; tone: Tone }> = ({ value, digits = 1, unit, tone }) => (
  <div className="flex items-baseline gap-1">
    <span className="text-[26px] font-extrabold text-gray-800 tabular-nums leading-none">
      <CountUp value={value} digits={digits} />
    </span>
    {unit && <span className={`text-sm font-semibold ${TONES[tone].text}`}>{unit}</span>}
  </div>
);

const MinMax: React.FC<{ min: number | null; max: number | null; digits?: number }> = ({ min, max, digits = 1 }) => (
  <div className="flex gap-2 mt-2">
    <div className="flex-1 bg-rose-50 rounded-lg px-2 py-1">
      <div className="text-[9px] uppercase text-rose-500 font-semibold">Max</div>
      <div className="text-xs font-bold text-gray-800 tabular-nums">{fmt(max, digits)}</div>
    </div>
    <div className="flex-1 bg-emerald-50 rounded-lg px-2 py-1">
      <div className="text-[9px] uppercase text-emerald-600 font-semibold">Min</div>
      <div className="text-xs font-bold text-gray-800 tabular-nums">{fmt(min, digits)}</div>
    </div>
  </div>
);

export const BirdEyeCards: React.FC<{
  m: ScopeMetrics;
  plots: OverviewPlot[];
  areaPlotCount?: number;
  top25Recovery: number | null;
  loading: boolean;
  stressLoading: boolean;
  onFocus: FocusFn;
}> = ({ m, plots, areaPlotCount: endpointPlotCount, top25Recovery, loading, stressLoading, onFocus }) => {
  const R = (k: string) => m.fromRollup.has(k);
  const areaFromDistrict = m.fromDistrict.has("area");
  const stages: CropStage[] = ["Harvest Maturity", "Grand Growth", "Tillering", "Other"];
  const areaByStage = stages.map((s) => ({
    s,
    a: plots.filter((p) => p.stage === s).reduce((t, p) => t + (p.areaAcres ?? 0), 0),
  }));
  const areaTotal = areaByStage.reduce((t, x) => t + x.a, 0);
  const areaBreakdownMatches = m.area != null && Math.abs(areaTotal - m.area) <= Math.max(0.01, m.area * 0.01);
  const areaAveragePlotCount = endpointPlotCount ?? plots.filter((p) => p.areaAcres != null).length;
  const brixPlots = plots.filter((p) => p.brix != null);
  const sweet = brixPlots.filter((p) => (p.brix as number) >= 20).length;
  const fsWeak = m.fieldScore.total ? (m.fieldScore.below_40 + m.fieldScore.b40_60) / m.fieldScore.total : 0;
  const ylow = m.yieldDist.total ? m.yieldDist.below_50 / m.yieldDist.total : 0;

  const cards: React.ReactNode[] = [
    <Card key="area" i={0} title="Field Area" icon={MapPin} tone="emerald" badge={<SourceBadge rollup={R("area")} district={areaFromDistrict} n={m.plots} />} footer={`${m.plots} plots in selection`}>
      {loading ? <Spinner /> : <Big value={m.area} digits={2} unit="acre" tone="emerald" />}
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <div className="bg-gray-50 rounded-lg px-2 py-1">
          <div className="text-[9px] uppercase text-gray-400 font-semibold">{areaFromDistrict ? "Avg / real plot" : "Avg / plot"}</div>
          <div className="text-xs font-bold text-gray-700">{m.area != null && areaAveragePlotCount ? `${fmt(m.area / areaAveragePlotCount, 2)} ac` : "—"}</div>
        </div>
        <div className="bg-gray-50 rounded-lg px-2 py-1">
          <div className="text-[9px] uppercase text-gray-400 font-semibold">Plots</div>
          <div className="text-xs font-bold text-gray-700">{m.plots}</div>
        </div>
      </div>
      {areaTotal > 0 && areaBreakdownMatches && (
        <div className="mt-3">
          <div className="text-[9px] uppercase text-gray-400 font-semibold mb-1">Area by crop stage</div>
          <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
            {areaByStage.map(({ s, a }) => (
              <div key={s} style={{ width: `${(a / areaTotal) * 100}%`, background: STAGE_COLORS[s] }} title={`${s}: ${fmt(a, 1)} ac`} />
            ))}
          </div>
          <div className="mt-1.5 space-y-0.5">
            {areaByStage.filter((x) => x.a > 0).map(({ s, a }) => (
              <button key={s} type="button" onClick={() => onFocus(s, (p) => p.stage === s)} className="w-full flex items-center gap-1.5 text-[10px] text-gray-600 hover:text-gray-900">
                <span className="w-2 h-2 rounded-sm" style={{ background: STAGE_COLORS[s] }} />
                <span className="flex-1 text-left">{s}</span>
                <span className="font-semibold tabular-nums">{fmt(a, 1)} ac</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {areaTotal > 0 && !areaBreakdownMatches && (
        <div className="mt-3 text-[10px] text-gray-400">Crop-stage area breakdown does not match this total.</div>
      )}
    </Card>,

    <Card key="stage" i={1} title="Crop Status" icon={Leaf} tone="lime" badge={<SourceBadge rollup={R("stage")} n={m.stage.total} />} footer={`${m.stage.total} plots${R("stage") ? " · factory summary" : " · click a stage to map it"}`}>
      {loading ? <Spinner /> : (
        <div className="space-y-1.5">
          <Bucket label="Harvest Maturity" value={m.stage.harvest_maturity} total={m.stage.total} color="#f59e0b" onClick={R("stage") ? undefined : () => onFocus("Harvest Maturity", (p) => p.stage === "Harvest Maturity")} />
          <Bucket label="Grand Growth" value={m.stage.grand_growth} total={m.stage.total} color="#16a34a" onClick={R("stage") ? undefined : () => onFocus("Grand Growth", (p) => p.stage === "Grand Growth")} />
          <Bucket label="Tillering" value={m.stage.tillering} total={m.stage.total} color="#65a30d" onClick={R("stage") ? undefined : () => onFocus("Tillering", (p) => p.stage === "Tillering")} />
          <Bucket label="Other" value={m.stage.other} total={m.stage.total} color="#94a3b8" onClick={R("stage") ? undefined : () => onFocus("Other stage", (p) => p.stage === "Other")} />
        </div>
      )}
    </Card>,

    <Card key="dth" i={2} title="Days to Harvest" icon={CalendarClock} tone="orange" badge={<SourceBadge rollup={R("dth")} n={m.dth.total} />} footer={`${m.dth.total} plots with a harvest estimate${R("dth") ? " · factory summary" : ""}`}>
      {loading ? <Spinner /> : (
        <div className="space-y-1">
          {([
            ["≤ 15 days", m.dth.d15, 0, 15],
            ["≤ 1 month", m.dth.d30, 0, 30],
            ["≤ 45 days", m.dth.d45, 0, 45],
            ["≤ 90 days", m.dth.d90, 0, 90],
            ["≤ 120 days", m.dth.d120, 0, 120],
            ["> 120 days", m.dth.above, 121, 99999],
          ] as Array<[string, number, number, number]>).map(([label, v, lo, hi]) => (
            <Bucket key={label} label={label} value={v} total={m.dth.total} color="#ea580c" onClick={R("dth") ? undefined : () => onFocus(`Harvest ${label}`, (p) => p.daysToHarvest != null && p.daysToHarvest >= lo && p.daysToHarvest <= hi)} />
          ))}
        </div>
      )}
    </Card>,

    <Card key="brix" i={3} title="Sugar Content" icon={TestTube2} tone="sky" badge={<SourceBadge rollup={R("brix")} n={m.brix.n} />} health={m.brix.avg == null ? "none" : m.brix.avg >= 20 ? "good" : m.brix.avg >= 18 ? "warn" : "bad"} footer="Brix (°) — mature cane reads 20°+">
      {loading ? <Spinner /> : <Big value={m.brix.avg} digits={1} unit="° Brix avg" tone="sky" />}
      <MinMax min={m.brix.min} max={m.brix.max} />
      {brixPlots.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <Bucket label="≥ 20° (harvest-ready sugar)" value={sweet} total={brixPlots.length} color="#0284c7" onClick={() => onFocus("Brix ≥ 20°", (p) => (p.brix ?? 0) >= 20)} />
          <Bucket label="< 18° (immature)" value={brixPlots.filter((p) => (p.brix as number) < 18).length} total={brixPlots.length} color="#f97316" onClick={() => onFocus("Brix < 18°", (p) => p.brix != null && p.brix < 18)} />
        </div>
      )}
    </Card>,

    <Card key="rec" i={4} title="Recovery Rate" icon={Droplets} tone="violet" badge={<SourceBadge rollup={R("recovery")} n={m.recovery.n} />} footer={m.recovery.avg == null ? "Available near maturity" : `${m.recovery.n} plots with recovery`}>
      {loading ? <Spinner /> : <Big value={m.recovery.avg} digits={2} unit="%" tone="violet" />}
      {top25Recovery != null && (
        <div className="mt-3 grid grid-cols-1 gap-1.5">
          <div className="bg-emerald-50 rounded-lg px-2 py-1">
            <div className="text-[9px] uppercase text-emerald-600 font-semibold">Top 25 avg</div>
            <div className="text-xs font-bold text-gray-800">{fmt(top25Recovery, 2)}%</div>
          </div>
        </div>
      )}
      {plots.some((p) => p.recovery != null) && (
        <div className="mt-2">
          <Bucket label="Plots below 10%" value={plots.filter((p) => p.recovery != null && p.recovery < 10).length} total={plots.filter((p) => p.recovery != null).length} color="#a855f7" onClick={() => onFocus("Recovery < 10%", (p) => p.recovery != null && p.recovery < 10)} />
        </div>
      )}
    </Card>,

    <Card key="fs" i={5} title="Field Score" icon={GaugeIcon} tone="teal" badge={<SourceBadge rollup={R("fieldScore")} n={m.fieldScore.total} />} health={m.fieldScore.total ? (fsWeak > 0.35 ? "bad" : fsWeak > 0.2 ? "warn" : "good") : "none"} footer={`${m.fieldScore.total} plots scored${m.fieldScore.avg != null ? ` · avg ${fmt(m.fieldScore.avg, 0)}%` : ""}`}>
      {loading ? <Spinner /> : (
        <div className="space-y-1.5">
          <Bucket label="> 80%" value={m.fieldScore.above_80} total={m.fieldScore.total} color="#10b981" onClick={R("fieldScore") ? undefined : () => onFocus("Field score > 80%", (p) => (p.fieldScore ?? -1) > 80)} />
          <Bucket label="60 – 80%" value={m.fieldScore.b60_80} total={m.fieldScore.total} color="#84cc16" onClick={R("fieldScore") ? undefined : () => onFocus("Field score 60–80%", (p) => p.fieldScore != null && p.fieldScore >= 60 && p.fieldScore <= 80)} />
          <Bucket label="40 – 60%" value={m.fieldScore.b40_60} total={m.fieldScore.total} color="#f59e0b" onClick={R("fieldScore") ? undefined : () => onFocus("Field score 40–60%", (p) => p.fieldScore != null && p.fieldScore >= 40 && p.fieldScore < 60)} />
          <Bucket label="< 40%" value={m.fieldScore.below_40} total={m.fieldScore.total} color="#ef4444" onClick={R("fieldScore") ? undefined : () => onFocus("Field score < 40%", (p) => p.fieldScore != null && p.fieldScore < 40)} />
        </div>
      )}
    </Card>,

    <Card key="yd" i={6} title="Expected Yield" icon={BarChart3} tone="amber" badge={<SourceBadge rollup={R("yieldDist")} n={m.yieldDist.total} />} health={m.yieldDist.total ? (ylow > 0.4 ? "bad" : ylow > 0.2 ? "warn" : "good") : "none"} footer={`T/acre · avg ${fmt(m.yield.avg, 1)}`}>
      {loading ? <Spinner /> : (
        <div className="space-y-1.5">
          <Bucket label="> 100" value={m.yieldDist.above_100} total={m.yieldDist.total} color="#10b981" onClick={R("yieldDist") ? undefined : () => onFocus("Yield > 100 T/acre", (p) => (p.expectedYield ?? -1) > 100)} />
          <Bucket label="75 – 100" value={m.yieldDist.b75_100} total={m.yieldDist.total} color="#84cc16" onClick={R("yieldDist") ? undefined : () => onFocus("Yield 75–100 T/acre", (p) => p.expectedYield != null && p.expectedYield >= 75 && p.expectedYield <= 100)} />
          <Bucket label="50 – 75" value={m.yieldDist.b50_75} total={m.yieldDist.total} color="#f59e0b" onClick={R("yieldDist") ? undefined : () => onFocus("Yield 50–75 T/acre", (p) => p.expectedYield != null && p.expectedYield >= 50 && p.expectedYield < 75)} />
          <Bucket label="< 50" value={m.yieldDist.below_50} total={m.yieldDist.total} color="#ef4444" onClick={R("yieldDist") ? undefined : () => onFocus("Yield < 50 T/acre", (p) => p.expectedYield != null && p.expectedYield < 50)} />
        </div>
      )}
    </Card>,

    <Card key="cci" i={7} title="Crop Condition Index" icon={Sprout} tone="emerald" badge={<SourceBadge rollup={R("cci")} n={m.cci.n} />} health={m.cci.avg == null ? "none" : m.cci.avg >= 65 ? "good" : m.cci.avg >= 45 ? "warn" : "bad"} footer="0 – 100 · healthy above 65">
      {loading ? <Spinner /> : <Big value={m.cci.avg} digits={1} unit="CCI avg" tone="emerald" />}
      {m.cci.avg != null && (
        <div className="mt-3 relative h-2 rounded-full bg-gradient-to-r from-rose-400 via-amber-300 to-emerald-500">
          <motion.div className="absolute -top-1 w-1.5 h-4 rounded bg-gray-800" initial={{ left: 0 }} animate={{ left: `calc(${Math.min(100, Math.max(0, m.cci.avg))}% - 3px)` }} />
        </div>
      )}
    </Card>,

    <Card key="stress" i={8} title="Stress Events" icon={Activity} tone="rose" health={m.stress.events == null ? "none" : m.stress.events === 0 ? "good" : m.stress.events / Math.max(1, m.stress.plots) < 1 ? "warn" : "bad"} footer={m.stress.plots ? `NDRE < 0.15 · ${m.stress.plots} monitored plots` : "Loads with plot history"}>
      {stressLoading && m.stress.events == null ? <Spinner /> : <Big value={m.stress.events} digits={0} unit="events" tone="rose" />}
      <div className="text-[11px] text-rose-500 font-semibold mt-1">{m.stress.days != null ? `${m.stress.days} total stress days` : ""}</div>
      {(m.stress.events ?? 0) > 0 && (
        <div className="mt-3 rounded-lg bg-sky-50 px-2 py-1.5 text-xs font-semibold text-sky-700">
          Low NDRE stress detected — verify water conditions in the field.
        </div>
      )}
    </Card>,

    <Card key="bio" i={9} title="Avg Biomass" icon={Target} tone="indigo" badge={<SourceBadge rollup={R("biomass")} n={m.biomass.n} />} footer="T/acre (above-ground)">
      {loading ? <Spinner /> : <Big value={m.biomass.avg} digits={1} unit="T/acre" tone="indigo" />}
      <MinMax min={m.biomass.min} max={m.biomass.max} />
    </Card>,
  ];

  return <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">{cards}</div>;
};

export default BirdEyeCards;
