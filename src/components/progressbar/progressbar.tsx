import React, { useState, useMemo, useEffect } from 'react';
import { Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { FactoryId } from './factoryProgressTypes';
import type { FarmerProgressConfig } from './progressData';
import {
  DEFAULT_MONTH_SECTION,
  MONTH_SECTIONS,
  TOTAL_WEEKS,
  WEEKS_PER_SECTION,
  getLocalWeekNumber,
  getMonthRangeForWeek,
  getSectionIndex,
  resolveLatestMonthSectionFromConfigs,
  type MonthSectionLabel,
} from './progressConstants';
import { PROGRESS_THEME as T } from './progressTheme';
import {
  buildSectionTimelineNodes,
} from './buildSectionTimelineNodes';

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
  /** True when dot value comes from industrial / public yield API. */
  isFromApi?: boolean;
  /** True for the farmer's latest API yield reading. */
  isLatest?: boolean;
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
  factoryId?: FactoryId;
  farmerConfigs?: FarmerProgressConfig[];
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
  _farmerId: string,
  _weeksDonePerSection: [number, number, number, number],
  _missedCallWeeks: number[] = [],
): Record<string, ActionTaken> => {
  // Actions start empty — green bar fills only after you save "Action taken".
  return {};
};

const buildWeeklyNodes = (
  farmerId: string,
  baseYield: number,
  plantationStart = '2025-01-15',
  yieldReadings: { yield: number; date: string }[] = [],
): TimelineNode[] => {
  const start = new Date(plantationStart);
  const sortedYields = [...yieldReadings].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const useApiYields = sortedYields.length > 0;

  return Array.from({ length: TOTAL_WEEKS }, (_, i) => {
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + i * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    let milestoneDate: Date;
    let yieldValue: number;

    if (useApiYields) {
      const reading = sortedYields[i];
      if (reading) {
        milestoneDate = new Date(reading.date);
        yieldValue = reading.yield;
      } else {
        const readingInWeek = sortedYields.find((item) => {
          const readingDate = new Date(item.date);
          return readingDate >= weekStart && readingDate <= weekEnd;
        });
        const readingsBeforeWeekEnd = sortedYields.filter(
          (item) => new Date(item.date) <= weekEnd,
        );
        const closestReading =
          readingInWeek ?? readingsBeforeWeekEnd[readingsBeforeWeekEnd.length - 1];
        milestoneDate = closestReading
          ? new Date(closestReading.date)
          : new Date(weekStart);
        yieldValue = closestReading?.yield ?? baseYield + i * 0.08;
      }
    } else {
      milestoneDate = new Date(weekStart);
      yieldValue = baseYield + i * 0.08;
    }

    const localWeek = getLocalWeekNumber(i);

    return {
      id: `${farmerId}-w${i + 1}`,
      day: localWeek,
      date: formatDisplayDate(milestoneDate),
      monthRange: getMonthRangeForWeek(i),
      yield: `${Number(yieldValue).toFixed(1)} T/acre`,
      callStatus: 'pending',
      note: '',
    };
  });
};

const buildFarmer = (config: FarmerProgressConfig): FarmerTimeline => ({
  farmerId: config.farmerId,
  farmerName: config.farmerName,
  currentDayIndex: Math.max(
    ...config.weeksDonePerSection.map((n, i) =>
      n > 0 ? i * WEEKS_PER_SECTION + n - 1 : -1,
    ),
  ),
  nodes: buildWeeklyNodes(
    config.farmerId,
    config.baseYield,
    config.plantationDate ?? undefined,
    config.yieldReadings ?? [],
  ),
  weeksDonePerSection: config.weeksDonePerSection,
  missedCallWeeks: config.missedCallWeeks ?? [],
});

const buildTimelinesFromConfigs = (
  configs: FarmerProgressConfig[],
): FarmerTimeline[] => configs.map(buildFarmer);

const buildInitialActionsForConfigs = (
  configs: FarmerProgressConfig[],
): Record<string, ActionTaken> => {
  const actions: Record<string, ActionTaken> = {};
  for (const cfg of configs) {
    Object.assign(
      actions,
      buildInitialActions(
        cfg.farmerId,
        cfg.weeksDonePerSection,
        cfg.missedCallWeeks ?? [],
      ),
    );
  }
  return actions;
};

const VISIBLE_FARMER_ROWS = 3;
const FARMER_LIST_MAX_HEIGHT = '23.5rem';

const getNodePosition = (index: number, total: number) =>
  total <= 1 ? 0 : (index / (total - 1)) * 100;

const SlotNavButton: React.FC<{
  direction: 'prev' | 'next';
  disabled: boolean;
  onClick: () => void;
}> = ({ direction, disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={direction === 'prev' ? 'Previous slot' : 'Next slot'}
    className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md border transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-30 sm:h-9 sm:w-8"
    style={{
      borderColor: `${T.active}55`,
      color: T.active,
      backgroundColor: T.activeLight,
    }}
  >
    {direction === 'prev' ? (
      <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
    ) : (
      <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
    )}
  </button>
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
    <div
      className="w-[200px] max-w-[min(200px,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-2.5 shadow-xl ring-1 ring-black/5"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 flex items-start justify-between gap-1">
        <p className="text-[10px] font-semibold leading-tight" style={{ color: T.text }}>
          Wk {node.day} · {node.date}
          <span className="mt-0.5 block font-semibold" style={{ color: T.taskDone }}>
            {node.yield}
          </span>
        </p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600"
          aria-label="Close"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <p className="mb-1 text-[9px] font-medium text-slate-500">Action taken?</p>
      <div className="mb-1.5 flex gap-1">
        <button
          type="button"
          onClick={() => setDraftAction('yes')}
          className={[
            'flex flex-1 items-center justify-center gap-0.5 rounded border py-0.5 text-[10px] font-semibold',
            draftAction === 'yes'
              ? 'border-[#22C55E] bg-[#F0FDF4] text-[#166534]'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50',
          ].join(' ')}
        >
          <Check className="h-2.5 w-2.5" /> Yes
        </button>
        <button
          type="button"
          onClick={() => setDraftAction('no')}
          className={[
            'flex flex-1 items-center justify-center gap-0.5 rounded border py-0.5 text-[10px] font-semibold',
            draftAction === 'no'
              ? 'border-[#D97706] bg-[#FFFBEB] text-[#B45309]'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50',
          ].join(' ')}
        >
          <X className="h-2.5 w-2.5" /> No
        </button>
      </div>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Note (optional)..."
        className="mb-1.5 w-full rounded border border-slate-200 px-1.5 py-0.5 text-[10px] focus:outline-none"
        style={{ color: T.text }}
      />
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => {
            if (!draftAction) return;
            onSave(draft.trim(), draftAction);
          }}
          disabled={!draftAction}
          className="flex-1 rounded py-0.5 text-[10px] font-semibold text-white disabled:bg-slate-300"
          style={{ backgroundColor: T.active }}
        >
          Save
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
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
  isLatest?: boolean;
  isFromApi?: boolean;
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
  isLatest,
  isFromApi,
  dotIndex,
  totalDots,
  onActivate,
  onSelect,
  nodeKey,
}) => {
  const isActionYes = actionTaken === 'yes';
  const isActionNo = actionTaken === 'no';
  const alignClass = getPopupAlignClass(dotIndex, totalDots);

  const dotRingColor = isSelected
    ? '#2563EB'
    : isLatest
      ? '#15803D'
      : isActionYes
      ? T.taskDoneRing
      : isActionNo
        ? T.taskNotDoneRing
        : isPast
          ? T.pastNotRecordedRing
          : '#CBD5E1';

  const dotInnerClass = isActionYes || isActionNo || isPast ? '' : 'bg-slate-400';

  const dotInnerStyle = isActionYes
    ? { backgroundColor: T.taskDone }
    : isActionNo
      ? { backgroundColor: T.taskNotDone }
      : isPast
        ? { backgroundColor: T.pastNotRecorded }
        : undefined;

  return (
    <div
      className="relative flex justify-center"
      onMouseEnter={() => onActivate(nodeKey)}
      onMouseLeave={() => {
        if (!isSelected) onActivate(null);
      }}
    >
      <button
        type="button"
        className="relative z-10 flex h-10 w-full items-center justify-center focus:outline-none"
        onClick={(e) => {
          e.stopPropagation();
          if (isPast) onSelect();
        }}
        aria-label={`${farmerName} ${node.date} — ${node.yield}`}
        aria-pressed={isSelected}
      >
        <span
          className={[
            'relative flex items-center justify-center rounded-full bg-white transition-all duration-300',
            'h-3.5 w-3.5 sm:h-4 sm:w-4 shadow-md',
            isSelected ? 'scale-125' : '',
            isActive && !isSelected ? 'scale-110' : '',
          ].join(' ')}
          style={{ boxShadow: `0 0 0 3px ${dotRingColor}, 0 1px 3px rgba(0,0,0,0.12)` }}
        >
          {isActionYes ? (
            <Check className="h-2 w-2 sm:h-2.5 sm:w-2.5" strokeWidth={3} style={{ color: T.taskDone }} />
          ) : isActionNo ? (
            <X className="h-2 w-2 sm:h-2.5 sm:w-2.5" strokeWidth={3} style={{ color: T.taskNotDone }} />
          ) : (
            <span
              className={['block h-1.5 w-1.5 rounded-full sm:h-2 sm:w-2', dotInnerClass].join(' ')}
              style={dotInnerStyle}
            />
          )}
        </span>

        {isActive && !isSelected && (
          <div
            className={`pointer-events-none absolute top-full z-30 mt-2 whitespace-nowrap ${alignClass}`}
          >
            <div className="min-w-[140px] rounded-lg border border-slate-100 bg-white px-2.5 py-2 text-center shadow-lg ring-1 ring-black/5">
              {isLatest && (
                <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                  Latest yield
                </p>
              )}
              {isFromApi && !isLatest && (
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-sky-600">
                  {/* API reading */}
                </p>
              )}
              <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                {node.date}
              </p>
              <p className="mt-0.5 text-xs font-bold" style={{ color: T.taskDone }}>
                {node.yield}
              </p>
              {isPast ? (
                <>
                  <p className="mt-1 border-t border-slate-100 pt-1 text-[9px] font-semibold text-slate-600">
                    Action taken?
                  </p>
                  {isActionYes ? (
                    <p className="mt-0.5 flex items-center justify-center gap-1 text-[10px] font-bold" style={{ color: T.taskDone }}>
                      <Check className="h-2.5 w-2.5" /> Yes
                    </p>
                  ) : isActionNo ? (
                    <p className="mt-0.5 flex items-center justify-center gap-1 text-[10px] font-bold" style={{ color: T.taskNotDone }}>
                      <X className="h-2.5 w-2.5" /> No
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[9px] font-medium" style={{ color: T.pastNotRecorded }}>
                      Not recorded
                    </p>
                  )}
                  {noteValue && (
                    <p className="mt-0.5 max-w-[160px] truncate text-[9px] text-slate-600">
                      Note: {noteValue}
                    </p>
                  )}
                  <p className="mt-0.5 text-[8px] text-slate-400">Click to edit</p>
                </>
              ) : (
                <p className="mt-1 text-[8px] font-medium text-slate-400">Upcoming week</p>
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
  canGoPrevSection: boolean;
  canGoNextSection: boolean;
  onPrevSection: () => void;
  onNextSection: () => void;
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
  canGoPrevSection,
  canGoNextSection,
  onPrevSection,
  onNextSection,
}) => {
  const getActionForNode = (nodeKey: string) => actions[nodeKey] ?? null;

  let lastYesIndex = -1;
  for (let i = 0; i < visibleNodes.length; i++) {
    const nodeKey = `${farmer.farmerId}-${visibleNodes[i].id}`;
    if (getActionForNode(nodeKey) === 'yes') {
      lastYesIndex = i;
    }
  }

  const progressPercent =
    lastYesIndex >= 0 ? getNodePosition(lastYesIndex, columnCount) : 0;

  const openDotIndex =
    noteOpenKey?.startsWith(`${farmer.farmerId}-`)
      ? visibleNodes.findIndex(
          (node) => `${farmer.farmerId}-${node.id}` === noteOpenKey,
        )
      : -1;

  const openNode = openDotIndex >= 0 ? visibleNodes[openDotIndex] : null;
  const openNodeKey = openNode ? `${farmer.farmerId}-${openNode.id}` : null;
  const hasOpenPanel = openNodeKey != null;

  const panelStyle: React.CSSProperties =
    openDotIndex === 0
      ? { left: 0 }
      : openDotIndex === columnCount - 1
        ? { right: 0 }
        : {
            left: `${getNodePosition(openDotIndex, columnCount)}%`,
            transform: 'translateX(-50%)',
          };

  return (
    <div
      className={[
        'overflow-visible rounded-2xl border bg-white p-3 shadow-sm sm:p-4',
        hasOpenPanel ? 'relative z-30 pb-40' : '',
        highlightFarmerId === farmer.farmerId
          ? 'border-[#22C55E] ring-2 ring-[#22C55E]/30'
          : 'border-slate-200/80',
      ].join(' ')}
    >
      <div className="mb-3 flex items-center gap-2 sm:mb-4">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: T.active }}
        >
          {rowIndex + 1}
        </div>
        <p className="min-w-0 truncate text-sm font-semibold" style={{ color: T.text }}>
          {farmer.farmerName}
        </p>
      </div>

      <div className="flex items-center gap-1 sm:gap-1.5">
        <SlotNavButton
          direction="prev"
          disabled={!canGoPrevSection}
          onClick={onPrevSection}
        />

        <div className="relative min-w-0 flex-1 overflow-visible">
        {visibleNodes.length === 0 ? (
          <div className="h-10" aria-hidden />
        ) : (
        <div
          className="relative grid h-10 items-center overflow-visible"
          style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-1.5 -translate-y-1/2 rounded-full"
            style={{ backgroundColor: T.trackBg }}
          />
          <div
            className="pointer-events-none absolute left-0 top-1/2 z-0 h-1.5 -translate-y-1/2 rounded-full transition-all duration-700"
            style={{
              width: `${progressPercent}%`,
              background: `linear-gradient(to right, ${T.trackFillFrom}, ${T.trackFillTo})`,
            }}
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
                isLatest={node.isLatest}
                isFromApi={node.isFromApi}
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

          {openNode && openNodeKey && openDotIndex >= 0 && (
            <div
              className="pointer-events-none absolute top-full z-50 mt-2"
              style={panelStyle}
            >
              <div className="pointer-events-auto">
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
              </div>
            </div>
          )}
        </div>
        )}
        </div>

        <SlotNavButton
          direction="next"
          disabled={!canGoNextSection}
          onClick={onNextSection}
        />
      </div>
    </div>
  );
};

const ProgressBar: React.FC<ProgressBarProps> = ({
  farmerConfigs = [],
  farmers,
  searchQuery = '',
  initialMonthSection: _initialMonthSection = DEFAULT_MONTH_SECTION,
  highlightFarmerId,
}) => {
  const configTimelines = useMemo(
    () => buildTimelinesFromConfigs(farmerConfigs),
    [farmerConfigs],
  );

  const sourceFarmers = farmers ?? configTimelines;

  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [noteOpenKey, setNoteOpenKey] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<Record<string, ActionTaken>>(() =>
    buildInitialActionsForConfigs(farmerConfigs),
  );
  const [farmerSections, setFarmerSections] = useState<
    Record<string, MonthSectionLabel>
  >({});

  useEffect(() => {
    if (farmerConfigs.length === 0) {
      setFarmerSections({});
      return;
    }

    setFarmerSections((prev) => {
      const next: Record<string, MonthSectionLabel> = {};
      for (const cfg of farmerConfigs) {
        if (highlightFarmerId && cfg.farmerId === highlightFarmerId) {
          next[cfg.farmerId] = resolveLatestMonthSectionFromConfigs([cfg]);
        } else if (prev[cfg.farmerId]) {
          next[cfg.farmerId] = prev[cfg.farmerId];
        } else {
          next[cfg.farmerId] = resolveLatestMonthSectionFromConfigs([cfg]);
        }
      }
      return next;
    });
  }, [farmerConfigs, highlightFarmerId]);

  useEffect(() => {
    setActions(buildInitialActionsForConfigs(farmerConfigs));
    setNotes({});
    setActiveNode(null);
    setNoteOpenKey(null);
  }, [farmerConfigs]);

  const displayFarmers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sourceFarmers;
    return sourceFarmers.filter(
      (farmer) =>
        farmer.farmerName.toLowerCase().includes(query) ||
        farmer.farmerId.toLowerCase().includes(query),
    );
  }, [sourceFarmers, searchQuery]);

  const configByFarmerId = useMemo(
    () => new Map(farmerConfigs.map((cfg) => [cfg.farmerId, cfg])),
    [farmerConfigs],
  );

  const setFarmerSection = (farmerId: string, label: MonthSectionLabel) => {
    setFarmerSections((prev) => ({ ...prev, [farmerId]: label }));
    setActiveNode(null);
    setNoteOpenKey(null);
  };

  const handleNoteSave = (key: string, value: string, action: ActionTaken) => {
    setActions((prev) => ({ ...prev, [key]: action }));
    if (value.trim()) {
      setNotes((prev) => ({ ...prev, [key]: value.trim() }));
    }
  };

  return (
    <div className="space-y-4">
      <div className="overflow-visible rounded-xl border border-slate-100 bg-slate-50/60 p-3 sm:p-4">
        {displayFarmers.length > VISIBLE_FARMER_ROWS && (
          <p className="mb-2 text-center text-xs font-medium text-slate-500">
            {/* Showing {VISIBLE_FARMER_ROWS} of {displayFarmers.length} farmers — scroll down for */}
            {/* more */}
          </p>
        )}

        <div
          className={[
            'space-y-3 pr-1',
            noteOpenKey ? 'overflow-visible' : 'overflow-x-hidden overflow-y-auto',
          ].join(' ')}
          style={{ maxHeight: FARMER_LIST_MAX_HEIGHT }}
        >
          {displayFarmers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
              <p className="text-sm font-medium text-slate-600">No farmers found</p>
              <p className="mt-1 text-xs text-slate-400">
                Try a different search name or clear the search box
              </p>
            </div>
          ) : (
            displayFarmers.map((farmer, index) => {
              const cfg = configByFarmerId.get(farmer.farmerId);
              const farmerSection =
                farmerSections[farmer.farmerId] ?? DEFAULT_MONTH_SECTION;
              const section =
                MONTH_SECTIONS.find((s) => s.label === farmerSection) ??
                MONTH_SECTIONS[0];
              const farmerSectionIndex = getSectionIndex(farmerSection);
              const visibleNodes = buildSectionTimelineNodes(
                farmer.farmerId,
                section.start,
                section.count,
                {
                  plantationDate: cfg?.plantationDate,
                  yieldReadings: cfg?.yieldReadings,
                },
              );

              return (
              <FarmerRow
                key={farmer.farmerId}
                farmer={farmer}
                visibleNodes={visibleNodes}
                columnCount={Math.max(visibleNodes.length, 1)}
                activeNode={activeNode}
                noteOpenKey={noteOpenKey}
                notes={notes}
                actions={actions}
                onNodeChange={setActiveNode}
                onNoteOpen={setNoteOpenKey}
                onNoteSave={handleNoteSave}
                rowIndex={index}
                highlightFarmerId={highlightFarmerId}
                canGoPrevSection={farmerSectionIndex > 0}
                canGoNextSection={
                  farmerSectionIndex < MONTH_SECTIONS.length - 1
                }
                onPrevSection={() => {
                  if (farmerSectionIndex <= 0) return;
                  setFarmerSection(
                    farmer.farmerId,
                    MONTH_SECTIONS[farmerSectionIndex - 1].label,
                  );
                }}
                onNextSection={() => {
                  if (farmerSectionIndex >= MONTH_SECTIONS.length - 1) return;
                  setFarmerSection(
                    farmer.farmerId,
                    MONTH_SECTIONS[farmerSectionIndex + 1].label,
                  );
                }}
              />
              );
            })
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-100 bg-white px-4 py-3 text-xs text-slate-500">
        <span className="flex items-center gap-2">
          <span
            className="relative flex h-3 w-3 items-center justify-center rounded-full bg-white"
            style={{ boxShadow: `0 0 0 2px ${T.taskDoneRing}` }}
          >
            <Check className="h-2 w-2" strokeWidth={3} style={{ color: T.taskDone }} />
          </span>
          Action taken — Yes
        </span>
        <span className="flex items-center gap-2">
          <span
            className="relative flex h-3 w-3 items-center justify-center rounded-full bg-white"
            style={{ boxShadow: `0 0 0 2px ${T.taskNotDoneRing}` }}
          >
            <X className="h-2 w-2" strokeWidth={3} style={{ color: T.taskNotDone }} />
          </span>
          Action taken — No
        </span>
        <span className="flex items-center gap-2">
          <span
            className="relative flex h-3 w-3 items-center justify-center rounded-full bg-white"
            style={{ boxShadow: '0 0 0 2px #15803D' }}
          >
            <span className="block h-1.5 w-1.5 rounded-full bg-emerald-600" />
          </span>
          Latest API yield
        </span>
        <span className="flex items-center gap-2">
          <span
            className="relative flex h-3 w-3 items-center justify-center rounded-full bg-white"
            style={{ boxShadow: `0 0 0 2px ${T.pastNotRecordedRing}` }}
          >
            <span
              className="block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: T.pastNotRecorded }}
            />
          </span>
          Past week — not recorded
        </span>
        <span className="text-slate-400">
          {/* Select a month → 10 weekly dots · click dot for Yes/No action */}
        </span>
      </div>
    </div>
  );
};

export default ProgressBar;
