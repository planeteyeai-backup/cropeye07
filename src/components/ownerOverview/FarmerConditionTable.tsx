import React, { useMemo, useState } from "react";
import { ArrowDownWideNarrow, Search, Sprout } from "lucide-react";
import type { FarmerRow } from "../../utils/ownerOverview";
import { fmt, Panel, SectionTitle, Sparkline } from "./ui";

const COND: Record<FarmerRow["condition"], string> = {
  Healthy: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Watch: "bg-amber-50 text-amber-700 border-amber-200",
  Critical: "bg-rose-50 text-rose-700 border-rose-200",
};

type Filter = "all" | "attention" | "harvest" | "lowyield";
type SortKey = "risk" | "yield" | "area" | "name" | "harvest";

export const FarmerConditionTable: React.FC<{
  rows: FarmerRow[];
  selectedFarmerId: string;
  onSelect: (row: FarmerRow) => void;
  title: string;
}> = ({ rows, selectedFarmerId, onSelect, title }) => {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("risk");
  const [q, setQ] = useState("");

  const counts = useMemo(
    () => ({
      all: rows.length,
      attention: rows.filter((r) => r.condition !== "Healthy").length,
      harvest: rows.filter((r) => r.daysToHarvest != null && r.daysToHarvest <= 45).length,
      lowyield: rows.filter((r) => r.yieldAvg != null && r.yieldAvg < 50).length,
    }),
    [rows],
  );

  const shown = useMemo(() => {
    let r = rows;
    if (filter === "attention") r = r.filter((x) => x.condition !== "Healthy");
    if (filter === "harvest") r = r.filter((x) => x.daysToHarvest != null && x.daysToHarvest <= 45);
    if (filter === "lowyield") r = r.filter((x) => x.yieldAvg != null && x.yieldAvg < 50);
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => `${x.farmer.name} ${x.farmer.fieldOfficerName} ${x.farmer.village}`.toLowerCase().includes(needle));
    const by: Record<SortKey, (a: FarmerRow, b: FarmerRow) => number> = {
      risk: (a, b) => b.risk - a.risk,
      yield: (a, b) => (a.yieldAvg ?? 999) - (b.yieldAvg ?? 999),
      area: (a, b) => b.area - a.area,
      name: (a, b) => a.farmer.name.localeCompare(b.farmer.name),
      harvest: (a, b) => (a.daysToHarvest ?? 9999) - (b.daysToHarvest ?? 9999),
    };
    return [...r].sort(by[sort]);
  }, [rows, filter, sort, q]);

  const dist = {
    Healthy: rows.filter((r) => r.condition === "Healthy").length,
    Watch: rows.filter((r) => r.condition === "Watch").length,
    Critical: rows.filter((r) => r.condition === "Critical").length,
  };

  return (
    <Panel id="ov-farmers">
      <SectionTitle
        icon={Sprout}
        title={title}
        subtitle="Current condition, 30-day growth trend and why each farmer is flagged"
        right={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search farmer, FO, village"
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 focus:ring-2 focus:ring-emerald-500 w-48"
              />
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <ArrowDownWideNarrow className="w-3.5 h-3.5" />
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5">
                <option value="risk">Highest risk</option>
                <option value="yield">Lowest yield</option>
                <option value="harvest">Harvest soonest</option>
                <option value="area">Largest area</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {([
          ["all", "All farmers"],
          ["attention", "Needs attention"],
          ["harvest", "Harvest ≤ 45 d"],
          ["lowyield", "Yield < 50"],
        ] as Array<[Filter, string]>).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${
              filter === k ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-600 border-gray-200 hover:border-emerald-400"
            }`}
          >
            {l} <span className="opacity-70">{counts[k]}</span>
          </button>
        ))}
        <div className="ml-auto flex h-2 w-48 rounded-full overflow-hidden bg-gray-100" title="Healthy / Watch / Critical">
          <div className="bg-emerald-500" style={{ width: `${(dist.Healthy / Math.max(1, rows.length)) * 100}%` }} />
          <div className="bg-amber-400" style={{ width: `${(dist.Watch / Math.max(1, rows.length)) * 100}%` }} />
          <div className="bg-rose-500" style={{ width: `${(dist.Critical / Math.max(1, rows.length)) * 100}%` }} />
        </div>
        <span className="text-[10px] text-gray-500">
          {dist.Healthy} healthy · {dist.Watch} watch · {dist.Critical} critical
        </span>
      </div>

      <div className="overflow-x-auto max-h-[460px] overflow-y-auto rounded-xl border border-gray-100">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wide sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-2">Farmer</th>
              <th className="text-left px-2 py-2">Condition</th>
              <th className="text-right px-2 py-2">Plots</th>
              <th className="text-right px-2 py-2">Area (ac)</th>
              <th className="text-left px-2 py-2">Stage</th>
              <th className="text-right px-2 py-2">Harvest in</th>
              <th className="text-right px-2 py-2">Yield T/ac</th>
              <th className="text-right px-2 py-2">Brix / Rec.</th>
              <th className="text-right px-2 py-2">Field score</th>
              <th className="text-left px-2 py-2">Growth trend</th>
              <th className="text-left px-2 py-2">Why flagged</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const active = r.farmer.id === selectedFarmerId;
              return (
                <tr
                  key={`${r.farmer.fieldOfficerId}-${r.farmer.id}`}
                  onClick={() => onSelect(r)}
                  className={`border-t border-gray-100 cursor-pointer transition ${active ? "bg-emerald-50" : "hover:bg-gray-50"}`}
                >
                  <td className="px-3 py-2">
                    <div className="font-semibold text-gray-800">{r.farmer.name}</div>
                    <div className="text-[10px] text-gray-400">FO {r.farmer.fieldOfficerName}{r.farmer.village ? ` · ${r.farmer.village}` : ""}</div>
                  </td>
                  <td className="px-2 py-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${COND[r.condition]}`}>{r.condition}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.farmer.plots.length}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(r.area, 2)}</td>
                  <td className="px-2 py-2 text-gray-600">{r.stage}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.daysToHarvest != null ? `${r.daysToHarvest} d` : "—"}</td>
                  <td className={`px-2 py-2 text-right tabular-nums font-semibold ${r.yieldAvg != null && r.yieldAvg < 50 ? "text-rose-600" : "text-gray-800"}`}>{fmt(r.yieldAvg, 1)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">
                    {r.brixAvg != null ? `${fmt(r.brixAvg, 1)}°` : "—"} / {r.recoveryAvg != null ? `${fmt(r.recoveryAvg, 1)}%` : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.fieldScore != null ? `${fmt(r.fieldScore, 0)}%` : "—"}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <Sparkline values={r.spark} />
                      {r.growthDelta != null && (
                        <span className={`text-[10px] font-bold ${r.growthDelta < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {r.growthDelta >= 0 ? "+" : ""}
                          {fmt(r.growthDelta, 2)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-[10px] text-gray-500 max-w-[220px]">{r.reasons.length ? r.reasons.join(" · ") : <span className="text-emerald-600">On track</span>}</td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={11} className="text-center text-gray-400 py-8">
                  No farmers match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
};

export default FarmerConditionTable;
