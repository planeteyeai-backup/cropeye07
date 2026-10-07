import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

export const fmt = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmtInt = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-IN");

/* ───────── Tones ───────── */
export type Tone = "emerald" | "teal" | "sky" | "amber" | "violet" | "rose" | "lime" | "orange" | "indigo" | "slate";
export const TONES: Record<Tone, { soft: string; text: string; bar: string; hex: string; border: string }> = {
  emerald: { soft: "bg-emerald-50", text: "text-emerald-600", bar: "from-emerald-400 to-green-500", hex: "#10b981", border: "border-emerald-100" },
  teal: { soft: "bg-teal-50", text: "text-teal-600", bar: "from-teal-400 to-cyan-500", hex: "#14b8a6", border: "border-teal-100" },
  sky: { soft: "bg-sky-50", text: "text-sky-600", bar: "from-sky-400 to-blue-500", hex: "#0ea5e9", border: "border-sky-100" },
  amber: { soft: "bg-amber-50", text: "text-amber-600", bar: "from-amber-400 to-orange-500", hex: "#f59e0b", border: "border-amber-100" },
  violet: { soft: "bg-violet-50", text: "text-violet-600", bar: "from-violet-400 to-purple-500", hex: "#8b5cf6", border: "border-violet-100" },
  rose: { soft: "bg-rose-50", text: "text-rose-600", bar: "from-rose-400 to-pink-500", hex: "#f43f5e", border: "border-rose-100" },
  lime: { soft: "bg-lime-50", text: "text-lime-700", bar: "from-lime-400 to-green-500", hex: "#84cc16", border: "border-lime-100" },
  orange: { soft: "bg-orange-50", text: "text-orange-600", bar: "from-orange-400 to-red-500", hex: "#f97316", border: "border-orange-100" },
  indigo: { soft: "bg-indigo-50", text: "text-indigo-600", bar: "from-indigo-400 to-blue-500", hex: "#6366f1", border: "border-indigo-100" },
  slate: { soft: "bg-slate-50", text: "text-slate-600", bar: "from-slate-300 to-slate-400", hex: "#64748b", border: "border-slate-100" },
};

/* ───────── Animated number ───────── */
export const CountUp: React.FC<{ value: number | null | undefined; digits?: number; duration?: number }> = ({
  value,
  digits = 0,
  duration = 700,
}) => {
  const [shown, setShown] = useState<number | null>(value ?? null);
  const fromRef = useRef<number>(0);
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) {
      setShown(null);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(from + (value - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{shown == null ? "—" : digits ? fmt(shown, digits) : fmtInt(shown)}</>;
};

/* ───────── Card shell ───────── */
export const Panel: React.FC<{ className?: string; children: React.ReactNode; id?: string; delay?: number }> = ({
  className = "",
  children,
  id,
  delay = 0,
}) => (
  <motion.section
    id={id}
    initial={{ opacity: 0, y: 14 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35, delay }}
    className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-4 scroll-mt-20 ${className}`}
  >
    {children}
  </motion.section>
);

export const SectionTitle: React.FC<{
  icon: React.ElementType;
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}> = ({ icon: Icon, title, subtitle, right }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
    <div className="flex items-center gap-2 min-w-0">
      <span className="bg-gradient-to-br from-emerald-500 to-green-600 text-white rounded-lg p-1.5 shadow-sm shrink-0">
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm sm:text-base font-bold text-gray-800 leading-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-gray-500">{subtitle}</p>}
      </div>
    </div>
    {right}
  </div>
);

export const SourceBadge: React.FC<{ rollup: boolean; district?: boolean; n?: number }> = ({ rollup, district = false, n }) => (
  <span
    title={district ? "District total-plot-area endpoint" : rollup ? "Factory rollup (same as Farm Crop Status)" : "Aggregated from plots in the current selection"}
    className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
      district ? "bg-amber-50 text-amber-700" : rollup ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
    }`}
  >
    {district ? "District" : rollup ? "Factory" : `${n ?? 0} plot${n === 1 ? "" : "s"}`}
  </span>
);

export const Spinner: React.FC<{ className?: string }> = ({ className = "" }) => (
  <Loader2 className={`w-4 h-4 animate-spin text-gray-400 ${className}`} />
);

/* ───────── Semi-circle gauge ───────── */
export const Gauge: React.FC<{
  value: number | null;
  min: number;
  max: number;
  unit?: string;
  color?: string;
  size?: number;
}> = ({ value, min, max, unit = "", color, size = 180 }) => {
  const w = size;
  const r = w * 0.38;
  const cx = w / 2;
  const cy = r + 14;
  const h = cy + 10;
  const pct = value == null ? 0 : Math.max(0, Math.min(1, (value - min) / Math.max(1e-6, max - min)));
  const arc = (p: number) => {
    const a = Math.PI - Math.PI * p;
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const [ex, ey] = arc(pct);
  const tone = color ?? (pct < 0.3 ? "#ef4444" : pct < 0.6 ? "#f97316" : pct < 0.8 ? "#eab308" : "#10b981");
  const [nx, ny] = arc(pct).map((v, i) => (i === 0 ? cx + (v - cx) * 0.82 : cy + (v - cy) * 0.82));
  return (
    <div className="flex flex-col items-center">
      <div className="text-xl font-extrabold text-gray-800 tabular-nums leading-none">
        {value == null ? "—" : fmt(value, 1)}
        <span className="text-xs font-semibold text-gray-500 ml-1">{unit}</span>
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#eef2f7" strokeWidth={12} strokeLinecap="round" />
        {value != null && (
          <motion.path
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex} ${ey}`}
            fill="none"
            stroke={tone}
            strokeWidth={12}
            strokeLinecap="round"
          />
        )}
        {value != null && <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#334155" strokeWidth={3} strokeLinecap="round" />}
        <circle cx={cx} cy={cy} r={5} fill="#334155" />
        <text x={cx - r} y={cy + 10} fontSize="9" textAnchor="middle" fill="#94a3b8">{min}</text>
        <text x={cx + r} y={cy + 10} fontSize="9" textAnchor="middle" fill="#94a3b8">{max}</text>
      </svg>
    </div>
  );
};

/* ───────── Ring score ───────── */
export const RingScore: React.FC<{ value: number | null; size?: number; color: string; label?: string }> = ({
  value,
  size = 92,
  color,
  label,
}) => {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const p = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.25)" strokeWidth={8} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - p) }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-extrabold tabular-nums">{value == null ? "—" : <CountUp value={value} />}</span>
        {label && <span className="text-[9px] uppercase tracking-wider opacity-80">{label}</span>}
      </div>
    </div>
  );
};

/* ───────── Sparkline ───────── */
export const Sparkline: React.FC<{ values: number[]; width?: number; height?: number; color?: string }> = ({
  values,
  width = 84,
  height = 24,
  color,
}) => {
  if (values.length < 2) return <span className="text-[10px] text-gray-300">Loading…</span>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - lo) / span) * (height - 4) - 2}`);
  const up = values[values.length - 1] >= values[0];
  const stroke = color ?? (up ? "#10b981" : "#ef4444");
  return (
    <svg width={width} height={height} aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={Number(pts[pts.length - 1].split(",")[1])} r={2.4} fill={stroke} />
    </svg>
  );
};

/* ───────── Dropdown ───────── */
export const SelectBox: React.FC<{
  label: string;
  icon: React.ElementType;
  count: number;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  step: number;
}> = ({ label, icon: Icon, count, value, onChange, disabled, placeholder, options, step }) => (
  <div className="flex min-w-0 flex-col w-full">
    <label className="text-xs font-semibold text-gray-600 mb-1.5 flex min-w-0 items-center gap-2">
      <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] flex items-center justify-center font-bold">{step}</span>
      <Icon className="w-3.5 h-3.5 text-emerald-600" />
      {label}
      <span className="ml-auto shrink-0 text-[10px] font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{count}</span>
    </label>
    <select
      className="block w-full min-w-0 px-3 py-2.5 rounded-xl border border-gray-200 bg-white shadow-sm text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-50 disabled:text-gray-400 transition"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

/* ───────── Delta chip ───────── */
export const Delta: React.FC<{ pct: number | null; invert?: boolean; suffix?: string }> = ({ pct, invert, suffix = "%" }) => {
  if (pct == null || !Number.isFinite(pct)) return <span className="text-[11px] text-gray-300">—</span>;
  const good = invert ? pct < 0 : pct >= 0;
  const flat = Math.abs(pct) < 1;
  const cls = flat ? "bg-gray-100 text-gray-600" : good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${cls}`}>
      {flat ? "→" : pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}
      {suffix}
    </span>
  );
};
