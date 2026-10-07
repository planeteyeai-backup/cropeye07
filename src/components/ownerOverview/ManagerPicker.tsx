import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronRight,
  Cloud,
  MapPinned,
  Phone,
  Search,
  User,
  Users,
  Wheat,
} from "lucide-react";
import { STAGE_COLORS, type CropStage, type OverviewManager } from "../../utils/ownerOverview";
import {
  resolveManagerDistrictForEventsApi,
  type DistrictTotalPlotAreaResponse,
} from "../../api";
import type { FactoryDashboardFactory } from "../../utils/factoryOwnerDashboard";
import { fmt, SectionTitle } from "./ui";

const GRADS = [
  "from-emerald-500 to-green-600",
  "from-teal-500 to-cyan-600",
  "from-lime-500 to-emerald-600",
  "from-sky-500 to-blue-600",
  "from-amber-500 to-orange-600",
  "from-violet-500 to-purple-600",
];

const QUICK = [
  { title: "Farm Crop Status", icon: BarChart3, cls: "text-blue-600 bg-blue-50" },
  { title: "Harvesting Planning", icon: Wheat, cls: "text-amber-600 bg-amber-50" },
  { title: "Agroclimatic", icon: Cloud, cls: "text-cyan-600 bg-cyan-50" },
  { title: "Team Connect", icon: Users, cls: "text-pink-600 bg-pink-50" },
  { title: "Contactuser", icon: User, cls: "text-emerald-600 bg-emerald-50", label: "Contact User" },
  { title: "CalendarView", icon: CalendarDays, cls: "text-teal-600 bg-teal-50", label: "Calendar" },
];

const STAGES: CropStage[] = ["Tillering", "Grand Growth", "Harvest Maturity", "Other"];

export const ManagerPicker: React.FC<{
  managers: OverviewManager[];
  rollups: Record<string, FactoryDashboardFactory | null>;
  districtAreas: Record<string, DistrictTotalPlotAreaResponse | null>;
  loading: boolean;
  industryName: string;
  totalFarmers: number;
  onPick: (id: string) => void;
  onMenuClick?: (menu: string) => void;
}> = ({ managers, rollups, districtAreas, loading, industryName, totalFarmers, onPick, onMenuClick }) => {
  const [q, setQ] = useState("");
  const filtered = managers.filter((m) => {
    const n = q.trim().toLowerCase();
    return !n || [m.name, m.username, m.region, m.phone, m.industryName].some((v) => v.toLowerCase().includes(n));
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SectionTitle icon={Building2} title="Select a Manager" subtitle={`${managers.length} managers under ${industryName} · click a card for the bird's-eye view`} />
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search manager, region, factory…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white shadow-sm text-sm focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 rounded-2xl bg-white/70 animate-pulse border border-gray-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-500 border border-gray-100">No managers found.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {filtered.map((m, i) => {
            const grad = GRADS[i % GRADS.length];
            const share = totalFarmers ? (m.farmersCount / totalFarmers) * 100 : 0;
            const rollup = rollups[m.id];
            const districtArea = districtAreas[m.id];
            const resolvedDistrict = resolveManagerDistrictForEventsApi(
              null,
              m.fieldOfficers.map((officer) => ({ district: officer.region })),
              { ...m.raw, name: m.name, region: m.region },
              { ...m.raw?.industry, name: m.industryName },
            );
            const districtLabel = districtArea?.district
              ? districtArea.district.charAt(0).toUpperCase() + districtArea.district.slice(1)
              : resolvedDistrict
                ? resolvedDistrict.charAt(0).toUpperCase() + resolvedDistrict.slice(1)
                : m.region || "District not available";
            const plots = m.fieldOfficers.flatMap((fo) => fo.farmers.flatMap((f) => f.plots));
            const stageCounts = STAGES.map((s) => ({ s, n: plots.filter((p) => p.stage === s).length }));
            const stageTotal = stageCounts.reduce((sum, stage) => sum + stage.n, 0);
            return (
              <motion.button
                key={m.id}
                layout
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                whileHover={{ y: -5 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onPick(m.id)}
                className="group h-full text-left bg-white rounded-2xl shadow-sm hover:shadow-xl border border-gray-100 overflow-hidden transition-shadow"
              >
                <div className={`h-11 bg-gradient-to-r ${grad} relative`}>
                  <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_20%_20%,white,transparent_45%)]" />
                  {m.industryName && (
                    <span className="absolute right-3 top-3 text-[10px] font-semibold text-white/90 bg-black/15 rounded-full px-2 py-0.5 max-w-[60%] truncate">
                      {m.industryName}
                    </span>
                  )}
                </div>
                <div className="px-3 pb-3 -mt-5 relative">
                  <div className="flex items-end justify-between gap-3">
                    <div
                      className={`w-12 h-12 rounded-xl bg-gradient-to-br ${grad} text-white flex items-center justify-center ring-4 ring-white shadow-md`}
                      title={`District: ${districtLabel}`}
                      aria-label={`District icon${districtLabel !== "District not available" ? ` for ${districtLabel}` : ""}`}
                    >
                      <MapPinned className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <span className="mb-1 text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full">
                      {m.fieldOfficers.length} FOs · {m.farmersCount} farmers
                    </span>
                  </div>
                  <div className="mt-2 min-w-0">
                    <h4 className="font-bold text-gray-800 truncate text-base">{m.name}</h4>
                    <p className="text-[11px] text-gray-500">Manager</p>
                    <div className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-800">
                      <MapPinned className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{districtLabel}</span>
                    </div>
                  </div>
                  {m.phone && (
                    <p className="mt-0.5 text-[11px] text-gray-500 flex items-center gap-1">
                      <Phone className="w-3 h-3 shrink-0" /> {m.phone}
                    </p>
                  )}
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {[
                      { l: "FOs", v: m.fieldOfficers.length },
                      { l: "Farmers", v: m.farmersCount },
                      { l: "Plots", v: m.plotsCount },
                      { l: "Acre", v: districtArea?.total_area_acres != null ? fmt(districtArea.total_area_acres, 1) : rollup?.total_field_area_acres != null ? fmt(rollup.total_field_area_acres, 1) : m.id in districtAreas ? "—" : "…" },
                    ].map((s) => (
                      <div key={s.l} className="bg-gray-50 rounded-lg py-1.5 text-center">
                        <div className="text-xs font-extrabold text-gray-800 tabular-nums">{s.v}</div>
                        <div className="text-[9px] uppercase tracking-wide text-gray-500">{s.l}</div>
                      </div>
                    ))}
                  </div>
                  {stageTotal > 0 && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                        <span>Crop stage mix</span>
                        <span className="font-semibold text-gray-700">{stageTotal} plots</span>
                      </div>
                      <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
                        {stageCounts.map(({ s, n }) => (
                          <div key={s} title={`${s}: ${n}`} style={{ width: `${(n / stageTotal) * 100}%`, background: STAGE_COLORS[s] }} />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-2">
                    <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                      <span>Share of farmers</span>
                      <span className="font-semibold text-gray-700">{share.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full bg-gradient-to-r ${grad}`} style={{ width: `${Math.max(4, share)}%` }} />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm font-semibold text-emerald-700">
                    <span>Open bird's-eye view</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

      {onMenuClick && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {QUICK.map((qa) => (
            <button
              key={qa.title}
              onClick={() => onMenuClick(qa.title)}
              className="flex min-h-[60px] items-center gap-2.5 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition px-3 py-2.5 text-left"
            >
              <span className={`rounded-lg p-1.5 ${qa.cls}`}>
                <qa.icon className="w-4 h-4" />
              </span>
              <span className="text-[11px] sm:text-xs font-semibold text-gray-700 leading-tight">{qa.label ?? qa.title}</span>
            </button>
          ))}
        </div>
      )}

    </div>
  );
};

export default ManagerPicker;
