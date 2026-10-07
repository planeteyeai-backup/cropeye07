import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, MapPinned, Stethoscope, Wrench } from "lucide-react";
import type { Issue, IssueSeverity } from "../../utils/ownerOverview";
import { nudgeGoogleTranslate } from "../../utils/protectInteractiveFromTranslate";
import { Panel, SectionTitle } from "./ui";

const SEV: Record<IssueSeverity, { icon: React.ElementType; chip: string; ring: string; label: string; bar: string }> = {
  critical: { icon: AlertOctagon, chip: "bg-rose-100 text-rose-700", ring: "border-rose-200 bg-rose-50/40", label: "Critical", bar: "bg-rose-500" },
  warning: { icon: AlertTriangle, chip: "bg-amber-100 text-amber-700", ring: "border-amber-200 bg-amber-50/40", label: "Warning", bar: "bg-amber-500" },
  info: { icon: Info, chip: "bg-sky-100 text-sky-700", ring: "border-sky-100 bg-sky-50/30", label: "Info", bar: "bg-sky-500" },
  good: { icon: CheckCircle2, chip: "bg-emerald-100 text-emerald-700", ring: "border-emerald-100 bg-emerald-50/30", label: "Good", bar: "bg-emerald-500" },
};

export const IssueDiagnosis: React.FC<{
  issues: Issue[];
  loadingHistory: boolean;
  onShow: (issue: Issue) => void;
  activeId: string | null;
}> = ({ issues, loadingHistory, onShow, activeId }) => {
  const [filter, setFilter] = useState<"all" | IssueSeverity>("all");
  const counts = useMemo(() => {
    const c: Record<IssueSeverity, number> = { critical: 0, warning: 0, info: 0, good: 0 };
    issues.forEach((i) => (c[i.severity] += 1));
    return c;
  }, [issues]);
  const shown = filter === "all" ? issues : issues.filter((i) => i.severity === filter);

  useEffect(() => {
    const timeout = window.setTimeout(nudgeGoogleTranslate, 300);
    return () => window.clearTimeout(timeout);
  }, [issues, filter]);

  return (
    <Panel id="ov-issues">
      <SectionTitle
        icon={Stethoscope}
        title="Data-based alerts"
        subtitle={loadingHistory ? "Loading endpoint measurements and plot history…" : "Thresholds and comparisons calculated from historical data"}
        right={
          <div className="flex flex-wrap gap-1.5">
            {(["all", "critical", "warning", "info", "good"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${
                  filter === k ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                }`}
              >
                {k === "all" ? `All ${issues.length}` : `${SEV[k].label} ${counts[k]}`}
              </button>
            ))}
          </div>
        }
      />
      {shown.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-xl p-4">
          <CheckCircle2 className="w-5 h-5" /> No issues detected for this selection.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <AnimatePresence initial={false}>
            {shown.map((issue, i) => {
              const s = SEV[issue.severity];
              const Icon = s.icon;
              const active = activeId === issue.id;
              return (
                <motion.div
                  key={issue.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={`relative rounded-xl border p-3 pl-4 overflow-hidden ${s.ring} ${active ? "ring-2 ring-emerald-400" : ""}`}
                >
                  <span className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar}`} />
                  <div className="flex items-start gap-2">
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${s.chip.split(" ")[1]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-sm text-gray-800">{issue.title}</span>
                        <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${s.chip}`}>{s.label}</span>
                        <span className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{issue.category}</span>
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">{issue.metric}</div>
                      {issue.cause && (
                        <div className="mt-1 text-xs text-gray-700 leading-relaxed">
                          <span className="font-semibold text-gray-800">Likely cause: </span>
                          {issue.cause}
                        </div>
                      )}
                      {issue.action && (
                        <div className="mt-1 text-xs text-gray-700 flex gap-1">
                          <Wrench className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                          <span>{issue.action}</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => onShow(issue)}
                      className={`shrink-0 flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2 py-1.5 transition ${
                        active ? "bg-emerald-600 text-white" : "bg-white border border-gray-200 text-emerald-700 hover:bg-emerald-50"
                      }`}
                      title={issue.plotKeys.length > 0 ? "Highlight affected plots on the map" : "Open the plots map"}
                      aria-label={issue.plotKeys.length > 0 ? `Show ${issue.plotKeys.length} affected plots on the map` : "Open the plots map"}
                    >
                      <MapPinned className="w-3.5 h-3.5" />
                      {issue.plotKeys.length > 0 ? issue.plotKeys.length : "Map"}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </Panel>
  );
};

export default IssueDiagnosis;
