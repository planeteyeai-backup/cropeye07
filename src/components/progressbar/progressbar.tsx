import React, { useState, useMemo, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import type { DistrictId } from './districts';
import { DISTRICT_PROGRESS } from './progressData';
import {
  DEFAULT_MONTH_SECTION,
  MONTH_SECTIONS,
  TOTAL_WEEKS,
  WEEKS_PER_SECTION,
  getLocalWeekNumber,
  getMonthRangeForWeek,
  type MonthSectionLabel,
} from './progressConstants';

export type { MonthSectionLabel };
export type CallStatus = 'completed' | 'pending';
export type ActionTaken = 'yes' | 'no';

export interface TimelineNode {
  id: string;
  day: number;
  date: string;
  monthRange: string;
  yield: string;
  callStatus: CallStatus;
  note: string;
}

export interface FarmerTimeline {
  farmerId: string;
  farmerName: string;
  nodes: TimelineNode[];
  /** Last completed call index (0-based). Green line ends here. */
  currentDayIndex: number;
  missedCallWeeks?: number[];
  weeksDonePerSection?: [number, number, number, number];
}

interface ProgressBarProps {
  districtId?: DistrictId;
  farmers?: FarmerTimeline[];
  searchQuery?: string;
  initialMonthSection?: MonthSectionLabel;
  highlightFarmerId?: string;
}

const formatDisplayDate = (date: Date): string =>
  date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

const isPastWeek = (node: TimelineNode): boolean => {
  const nodeDate = new Date(node.date);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  nodeDate.setHours(0, 0, 0, 0);
  return nodeDate <= today;
};

const buildInitialActions = (
  farmerId: string,
  weeksDonePerSection: [number, number, number, number],
  missedCallWeeks: number[] = [],
): Record<string, ActionTaken> => {
  const actions: Record<string, ActionTaken> = {};
  for (let section = 0; section < 4; section++) {
    const sectionStart = section * WEEKS_PER_SECTION;
    const done = weeksDonePerSection[section] ?? 0;
    for (let local = 0; local < done; local++) {
      const globalIdx = sectionStart + local;
      const key = `${farmerId}-${farmerId}-w${globalIdx + 1}`;
      actions[key] = missedCallWeeks.includes(globalIdx) ? 'no' : 'yes';
    }
  }
  return actions;
};

const buildWeeklyNodes = (
  farmerId: string,
  baseYield: number,
  plantationStart = '2025-01-15',
): TimelineNode[] => {
  const start = new Date(plantationStart);

  return Array.from({ length: TOTAL_WEEKS }, (_, i) => {
    const milestoneDate = new Date(start);
    milestoneDate.setDate(start.getDate() + i * 7);
    const localWeek = getLocalWeekNumber(i);
    return {
      id: `${farmerId}-w${i + 1}`,
      day: localWeek,
      date: formatDisplayDate(milestoneDate),
      monthRange: getMonthRangeForWeek(i),
      yield: `${(baseYield + i * 0.08).toFixed(1)} T/acre`,
      callStatus: 'pending',
      note: '',
    };
  });
};

const buildFarmer = (config: (typeof DISTRICT_PROGRESS)[DistrictId][number]): FarmerTimeline => ({
  farmerId: config.farmerId,
  farmerName: config.farmerName,
  currentDayIndex: Math.max(...config.weeksDonePerSection.map((n, i) =>
    n > 0 ? i * WEEKS_PER_SECTION + n - 1 : -1,
  )),
  nodes: buildWeeklyNodes(config.farmerId, config.baseYield),
  weeksDonePerSection: config.weeksDonePerSection,
  missedCallWeeks: config.missedCallWeeks ?? [],
});

const DISTRICT_FARMERS: Record<DistrictId, FarmerTimeline[]> = Object.fromEntries(
  Object.entries(DISTRICT_PROGRESS).map(([districtId, configs]) => [
    districtId,
    configs.map((cfg) => buildFarmer(cfg)),
  ]),
) as Record<DistrictId, FarmerTimeline[]>;

const getNodePosition = (index: number, total: number) =>
  total <= 1 ? 0 : (index / (total - 1)) * 100;

const MonthSectionHeader: React.FC<{
  selectedSection: MonthSectionLabel;
  onSelect: (label: MonthSectionLabel) => void;
}> = ({ selectedSection, onSelect }) => (
  <div className="mb-4 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
    {MONTH_SECTIONS.map((section) => {
      const isActive = selectedSection === section.label;
      return (
        <button
          key={section.label}
          type="button"
          onClick={() => onSelect(section.label)}
          className={[
            'flex min-w-[7.5rem] cursor-pointer items-center justify-center rounded-full px-4 py-2 text-xs font-semibold transition-all sm:min-w-[8.5rem] sm:px-5 sm:py-2.5 sm:text-sm',
            isActive
              ? 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-500'
              : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100 hover:bg-emerald-100',
          ].join(' ')}
        >
          {section.label}
        </button>
      );
    })}
  </div>
);

const getPopupAlignClass = (dotIndex: number, total: number): string => {
  if (dotIndex === 0) return 'left-0 translate-x-0';
  if (dotIndex === total - 1) return 'right-0 left-auto translate-x-0';
  return 'left-1/2 -translate-x-1/2';
};

const ActionEditPanel: React.FC<{
  node: TimelineNode;
  noteValue: string;
  actionTaken: ActionTaken | null;
  onSave: (value: string, action: ActionTaken) => void;
  onClose: () => void;
}> = ({ node, noteValue, actionTaken, onSave, onClose }) => {
  const [draft, setDraft] = useState(noteValue);
  const [draftAction, setDraftAction] = useState<ActionTaken | null>(actionTaken);

  useEffect(() => {
    setDraft(noteValue);
    setDraftAction(actionTaken);
  }, [noteValue, actionTaken, node.id]);

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-700">
          Week {node.day} · {node.date} · {node.yield}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mb-1.5 text-[10px] font-medium text-slate-500">Action taken?</p>
      <div className="mb-2 flex gap-1.5">
        <button
          type="button"
          onClick={() => setDraftAction('yes')}
          className={[
            'flex flex-1 items-center justify-center gap-1 rounded-md border py-1 text-[11px] font-semibold',
            draftAction === 'yes'
              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50',
          ].join(' ')}
        >
          <Check className="h-3 w-3" /> Yes
        </button>
        <button
          type="button"
          onClick={() => setDraftAction('no')}
          className={[
            'flex flex-1 items-center justify-center gap-1 rounded-md border py-1 text-[11px] font-semibold',
            draftAction === 'no'
              ? 'border-amber-500 bg-amber-50 text-amber-700'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50',
          ].join(' ')}
        >
          <X className="h-3 w-3" /> No
        </button>
      </div>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Note (optional)..."
        className="mb-2 w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:border-emerald-500 focus:outline-none"
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            if (!draftAction) return;
            onSave(draft.trim(), draftAction);
          }}
          disabled={!draftAction}
          className="flex-1 rounded-md bg-emerald-600 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

const ProgressDot: React.FC<{
  node: TimelineNode;
  farmerName: string;
  isActive: boolean;
  isSelected: boolean;
  noteValue: string;
  actionTaken: ActionTaken | null;
  isPast: boolean;
  dotIndex: number;
  totalDots: number;
  onActivate: (key: string | null) => void;
  onSelect: () => void;
  nodeKey: string;
}> = ({
  node,
  farmerName,
  isActive,
  isSelected,
  noteValue,
  actionTaken,
  isPast,
  dotIndex,
  totalDots,
  onActivate,
  onSelect,
  nodeKey,
}) => {
  const isActionYes = actionTaken === 'yes';
  const isActionNo = actionTaken === 'no';
  const alignClass = getPopupAlignClass(dotIndex, totalDots);

  const dotRingClass = isSelected
    ? 'ring-blue-500 shadow-blue-200/50 scale-125'
    : isActionYes
      ? 'ring-emerald-500 shadow-emerald-200/50'
      : isActionNo
        ? 'ring-amber-500 shadow-amber-200/50'
        : isPast
          ? 'ring-red-500 shadow-red-200/50'
          : 'ring-slate-300 shadow-slate-200/50';

  const dotInnerClass = isActionYes
    ? 'bg-gradient-to-br from-emerald-400 to-green-600'
    : isActionNo
      ? 'bg-amber-500'
      : isPast
        ? 'bg-red-500'
        : 'bg-slate-400';

  return (
    <div className="flex justify-center">
      <button
        type="button"
        className="relative flex h-10 w-full items-center justify-center focus:outline-none"
        onMouseEnter={() => onActivate(nodeKey)}
        onMouseLeave={() => onActivate(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (isPast) onSelect();
        }}
        aria-label={`${farmerName} ${node.date} — ${node.yield}`}
        aria-pressed={isSelected}
      >
        <span
          className={[
            'relative flex items-center justify-center rounded-full bg-white transition-all duration-300 ring-[3px]',
            'h-3.5 w-3.5 sm:h-4 sm:w-4 shadow-md',
            dotRingClass,
            isActive && !isSelected ? 'scale-110' : '',
          ].join(' ')}
        >
          {isActionYes ? (
            <Check className="h-2 w-2 text-emerald-600 sm:h-2.5 sm:w-2.5" strokeWidth={3} />
          ) : isActionNo ? (
            <X className="h-2 w-2 text-amber-600 sm:h-2.5 sm:w-2.5" strokeWidth={3} />
          ) : (
            <span className={['block h-1.5 w-1.5 rounded-full sm:h-2 sm:w-2', dotInnerClass].join(' ')} />
          )}
        </span>

        {isActive && !isSelected && (
          <div
            className={`absolute top-full z-30 mt-2 whitespace-nowrap ${alignClass}`}
          >
            <div className="min-w-[160px] rounded-xl border border-slate-100 bg-white px-3 py-2.5 text-center shadow-xl ring-1 ring-black/5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {node.date}
              </p>
              <p className="mt-1 text-sm font-bold text-emerald-600">{node.yield}</p>
              {isPast ? (
                <>
                  <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-[10px] font-semibold text-slate-600">
                    Action taken?
                  </p>
                  {isActionYes ? (
                    <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-bold text-emerald-600">
                      <Check className="h-3 w-3" /> Yes
                    </p>
                  ) : isActionNo ? (
                    <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-bold text-amber-600">
                      <X className="h-3 w-3" /> No
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[10px] font-medium text-red-500">
                      Not recorded
                    </p>
                  )}
                  {noteValue && (
                    <p className="mt-1 max-w-[180px] truncate text-[10px] text-slate-600">
                      Note: {noteValue}
                    </p>
                  )}
                  <p className="mt-1 text-[9px] text-slate-400">Click to edit</p>
                </>
              ) : (
                <p className="mt-1.5 text-[9px] font-medium text-slate-400">Upcoming week</p>
              )}
            </div>
          </div>
        )}
      </button>
    </div>
  );
};

const FarmerRow: React.FC<{
  farmer: FarmerTimeline;
  visibleNodes: TimelineNode[];
  columnCount: number;
  activeNode: string | null;
  noteOpenKey: string | null;
  notes: Record<string, string>;
  actions: Record<string, ActionTaken>;
  onNodeChange: (key: string | null) => void;
  onNoteOpen: (key: string | null) => void;
  onNoteSave: (key: string, value: string, action: ActionTaken) => void;
  rowIndex: number;
  highlightFarmerId?: string;
}> = ({
  farmer,
  visibleNodes,
  columnCount,
  activeNode,
  noteOpenKey,
  notes,
  actions,
  onNodeChange,
  onNoteOpen,
  onNoteSave,
  rowIndex,
  highlightFarmerId,
}) => {
  const getActionForNode = (nodeKey: string) => actions[nodeKey] ?? null;

  let lastYesIndex = -1;
  for (let i = 0; i < visibleNodes.length; i++) {
    const nodeKey = `${farmer.farmerId}-${visibleNodes[i].id}`;
    if (getActionForNode(nodeKey) === 'yes') {
      lastYesIndex = i;
    } else if (isPastWeek(visibleNodes[i]) && getActionForNode(nodeKey) !== null) {
      break;
    } else if (isPastWeek(visibleNodes[i])) {
      break;
    }
  }

  const completedInView = visibleNodes.filter((node) => {
    const nodeKey = `${farmer.farmerId}-${node.id}`;
    return getActionForNode(nodeKey) === 'yes';
  }).length;

  const progressPercent =
    lastYesIndex >= 0 ? getNodePosition(lastYesIndex, columnCount) : 0;

  const openNodeKey = noteOpenKey?.startsWith(`${farmer.farmerId}-`)
    ? noteOpenKey
    : null;
  const openNode = openNodeKey
    ? visibleNodes.find((n) => `${farmer.farmerId}-${n.id}` === openNodeKey)
    : null;

  return (
    <div
      className={[
        'overflow-visible rounded-2xl border bg-white p-3 shadow-sm sm:p-4',
        highlightFarmerId === farmer.farmerId
          ? 'border-emerald-400 ring-2 ring-emerald-200'
          : 'border-slate-200/80',
      ].join(' ')}
    >
      <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-green-600 text-xs font-bold text-white">
            {rowIndex + 1}
          </div>
          <p className="truncate text-sm font-semibold text-slate-800">{farmer.farmerName}</p>
        </div>
        <span className="shrink-0 text-xs font-medium text-slate-500">
          {completedInView} / {columnCount} weeks
        </span>
      </div>

      <div
        className="relative grid items-center overflow-visible pb-1"
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-red-100" />
        <div
          className="pointer-events-none absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-gradient-to-r from-emerald-400 via-green-500 to-teal-500 transition-all duration-700"
          style={{ width: `${progressPercent}%` }}
        />

        {visibleNodes.map((node, dotIndex) => {
          const nodeKey = `${farmer.farmerId}-${node.id}`;
          const noteValue = notes[nodeKey] ?? node.note;
          const actionTaken = getActionForNode(nodeKey);
          const past = isPastWeek(node);

          return (
            <ProgressDot
              key={nodeKey}
              node={node}
              farmerName={farmer.farmerName}
              isActive={activeNode === nodeKey}
              isSelected={noteOpenKey === nodeKey}
              noteValue={noteValue}
              actionTaken={actionTaken}
              isPast={past}
              dotIndex={dotIndex}
              totalDots={visibleNodes.length}
              onActivate={onNodeChange}
              onSelect={() =>
                onNoteOpen(noteOpenKey === nodeKey ? null : nodeKey)
              }
              nodeKey={nodeKey}
            />
          );
        })}
      </div>

      {openNode && openNodeKey && (
        <ActionEditPanel
          node={openNode}
          noteValue={notes[openNodeKey] ?? openNode.note}
          actionTaken={getActionForNode(openNodeKey)}
          onSave={(value, action) => {
            onNoteSave(openNodeKey, value, action);
            onNoteOpen(null);
          }}
          onClose={() => onNoteOpen(null)}
        />
      )}
    </div>
  );
};

const ProgressBar: React.FC<ProgressBarProps> = ({
  districtId = 'kalburagi',
  farmers,
  searchQuery = '',
  initialMonthSection = DEFAULT_MONTH_SECTION,
  highlightFarmerId,
}) => {
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [noteOpenKey, setNoteOpenKey] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<Record<string, ActionTaken>>(() => {
    const initial: Record<string, ActionTaken> = {};
    const list = DISTRICT_FARMERS[districtId] ?? DISTRICT_FARMERS.kalburagi;
    for (const farmer of list) {
      const cfg = DISTRICT_PROGRESS[districtId]?.find((c) => c.farmerId === farmer.farmerId);
      if (cfg) {
        Object.assign(
          initial,
          buildInitialActions(
            farmer.farmerId,
            cfg.weeksDonePerSection,
            cfg.missedCallWeeks ?? [],
          ),
        );
      }
    }
    return initial;
  });
  const [selectedSection, setSelectedSection] = useState<MonthSectionLabel>(initialMonthSection);

  useEffect(() => {
    setSelectedSection(initialMonthSection);
  }, [initialMonthSection]);

  useEffect(() => {
    const list = DISTRICT_FARMERS[districtId] ?? DISTRICT_FARMERS.kalburagi;
    const initial: Record<string, ActionTaken> = {};
    for (const farmer of list) {
      const cfg = DISTRICT_PROGRESS[districtId]?.find((c) => c.farmerId === farmer.farmerId);
      if (cfg) {
        Object.assign(
          initial,
          buildInitialActions(
            farmer.farmerId,
            cfg.weeksDonePerSection,
            cfg.missedCallWeeks ?? [],
          ),
        );
      }
    }
    setActions(initial);
    setNotes({});
    setActiveNode(null);
    setNoteOpenKey(null);
  }, [districtId]);

  const displayFarmers = useMemo(() => {
    const list = farmers ?? DISTRICT_FARMERS[districtId] ?? DISTRICT_FARMERS.kalburagi;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (farmer) =>
        farmer.farmerName.toLowerCase().includes(query) ||
        farmer.farmerId.toLowerCase().includes(query),
    );
  }, [farmers, districtId, searchQuery]);

  const activeRange = useMemo(() => {
    const section = MONTH_SECTIONS.find((s) => s.label === selectedSection)!;
    return { start: section.start, end: section.end, count: section.count };
  }, [selectedSection]);

  const getVisibleNodes = (farmer: FarmerTimeline) =>
    farmer.nodes.slice(activeRange.start, activeRange.end + 1);

  const handleNoteSave = (key: string, value: string, action: ActionTaken) => {
    setActions((prev) => ({ ...prev, [key]: action }));
    if (value.trim()) {
      setNotes((prev) => ({ ...prev, [key]: value.trim() }));
    }
  };

  const handleSectionSelect = (label: MonthSectionLabel) => {
    setSelectedSection(label);
    setActiveNode(null);
    setNoteOpenKey(null);
  };

  return (
    <div className="space-y-4">
      <div className="overflow-visible rounded-xl border border-slate-100 bg-slate-50/60 p-3 sm:p-4">
        <MonthSectionHeader
          selectedSection={selectedSection}
          onSelect={handleSectionSelect}
        />

        <p className="mb-3 text-center text-xs font-medium text-emerald-700">
          {/* {selectedSection} — {WEEKS_PER_SECTION} weekly check-ins (Farmer 1, 2, 3) */}
        </p>

        <div className="space-y-3 overflow-visible pb-2">
          {displayFarmers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
              <p className="text-sm font-medium text-slate-600">No farmers found</p>
              <p className="mt-1 text-xs text-slate-400">
                Try a different search name or clear the search box
              </p>
            </div>
          ) : (
            displayFarmers.map((farmer, index) => (
              <FarmerRow
                key={farmer.farmerId}
                farmer={farmer}
                visibleNodes={getVisibleNodes(farmer)}
                columnCount={activeRange.count}
                activeNode={activeNode}
                noteOpenKey={noteOpenKey}
                notes={notes}
                actions={actions}
                onNodeChange={setActiveNode}
                onNoteOpen={setNoteOpenKey}
                onNoteSave={handleNoteSave}
                rowIndex={index}
                highlightFarmerId={highlightFarmerId}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-100 bg-white px-4 py-3 text-xs text-slate-500">
        <span className="flex items-center gap-2">
          <span className="relative flex h-3 w-3 items-center justify-center rounded-full bg-white ring-2 ring-emerald-500">
            <Check className="h-2 w-2 text-emerald-600" strokeWidth={3} />
          </span>
          Action taken — Yes
        </span>
        <span className="flex items-center gap-2">
          <span className="relative flex h-3 w-3 items-center justify-center rounded-full bg-white ring-2 ring-amber-500">
            <X className="h-2 w-2 text-amber-600" strokeWidth={3} />
          </span>
          Action taken — No
        </span>
        <span className="flex items-center gap-2">
          <span className="relative flex h-3 w-3 items-center justify-center rounded-full bg-white ring-2 ring-red-500">
            <span className="block h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
          Past week — not recorded
        </span>
        <span className="text-slate-400">
          Select a month → 10 weekly dots · click dot for Yes/No action
        </span>
      </div>
    </div>
  );
};

export default ProgressBar;
