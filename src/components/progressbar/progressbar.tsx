import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  createFarmerNote,
  getFarmerNotes,
  type FarmerNote,
} from '../../api';
import { isPlanetEyeDemoUser } from '../../utils/auth';
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
  buildLiveTimelineNode,
} from './buildSectionTimelineNodes';

export type ProgressViewMode = 'live' | 'history';

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

/** Center of dot in equal-column grid (for panel alignment under the dot). */
const getGridDotCenterPercent = (index: number, total: number): number => {
  if (total <= 0) return 0;
  if (total === 1) return 0;
  return ((index + 0.5) / total) * 100;
};

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

const formatNoteTimestamp = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const ActionEditPanel: React.FC<{
  node: TimelineNode;
  noteValue: string;
  actionTaken: ActionTaken | null;
  savedNotes: FarmerNote[];
  notesLoading: boolean;
  saving: boolean;
  saveError: string | null;
  onSave: (value: string, action: ActionTaken) => void | Promise<void>;
  onClose: () => void;
}> = ({
  node,
  noteValue,
  actionTaken,
  savedNotes,
  notesLoading,
  saving,
  saveError,
  onSave,
  onClose,
}) => {
  const [draft, setDraft] = useState(noteValue);
  const [draftAction, setDraftAction] = useState<ActionTaken | null>(actionTaken);

  useEffect(() => {
    setDraft('');
    setDraftAction(actionTaken);
  }, [noteValue, actionTaken, node.id]);

  return (
    <div
      className="w-[220px] max-w-[min(220px,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-2.5 shadow-xl ring-1 ring-black/5"
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

      <div className="mb-1.5">
        <p className="mb-0.5 text-[9px] font-medium text-slate-500">Previous notes</p>
        {notesLoading ? (
          <p className="text-[9px] text-slate-400">Loading notes…</p>
        ) : savedNotes.length === 0 ? (
          <p className="text-[9px] text-slate-400">No notes yet</p>
        ) : (
          <ul className="max-h-20 space-y-1 overflow-y-auto pr-0.5">
            {savedNotes.map((note) => (
              <li
                key={note.id}
                className="rounded border border-slate-100 bg-slate-50 px-1.5 py-1 text-[9px] leading-snug text-slate-700"
              >
                <p className="font-medium text-slate-800">{note.content}</p>
                <p className="mt-0.5 text-[8px] text-slate-400">
                  {formatNoteTimestamp(note.created_at)}
                  {note.created_by_name ? ` · ${note.created_by_name}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add a new note..."
        className="mb-1.5 w-full rounded border border-slate-200 px-1.5 py-0.5 text-[10px] focus:outline-none"
        style={{ color: T.text }}
        disabled={saving}
      />
      {saveError && (
        <p className="mb-1 text-[9px] font-medium text-red-600">{saveError}</p>
      )}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => {
            if (!draftAction || saving) return;
            void onSave(draft.trim(), draftAction);
          }}
          disabled={!draftAction || saving}
          className="flex-1 rounded py-0.5 text-[10px] font-semibold text-white disabled:bg-slate-300"
          style={{ backgroundColor: T.active }}
        >
          {saving ? 'Saving…' : 'Save'}
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
  alignStart?: boolean;
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
  alignStart = false,
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
      className={[
        'relative flex',
        alignStart ? 'justify-start' : 'justify-center',
      ].join(' ')}
      onMouseEnter={() => onActivate(nodeKey)}
      onMouseLeave={() => {
        if (!isSelected) onActivate(null);
      }}
    >
      <button
        type="button"
        className={[
          'relative z-10 flex h-10 items-center focus:outline-none',
          alignStart ? 'w-auto justify-start' : 'w-full justify-center',
        ].join(' ')}
        onClick={(e) => {
          e.stopPropagation();
          if (isPast) {
            onSelect();
            e.currentTarget.blur();
          }
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
  savedNotes: FarmerNote[];
  notesLoading: boolean;
  savingNote: boolean;
  noteSaveError: string | null;
  onNodeChange: (key: string | null) => void;
  onNoteOpen: (key: string | null, farmerId: string | null) => void;
  onNoteSave: (
    key: string,
    value: string,
    action: ActionTaken,
    farmerId: string,
  ) => void | Promise<void>;
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
  savedNotes,
  notesLoading,
  savingNote,
  noteSaveError,
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

  /** Green line only grows for consecutive "yes" from week 1 — skipping ahead does not fill the track. */
  let lastConsecutiveYesIndex = -1;
  for (let i = 0; i < visibleNodes.length; i++) {
    const nodeKey = `${farmer.farmerId}-${visibleNodes[i].id}`;
    if (getActionForNode(nodeKey) === 'yes') {
      lastConsecutiveYesIndex = i;
    } else {
      break;
    }
  }

  const openDotIndex =
    noteOpenKey?.startsWith(`${farmer.farmerId}-`)
      ? visibleNodes.findIndex(
          (node) => `${farmer.farmerId}-${node.id}` === noteOpenKey,
        )
      : -1;

  const openNode = openDotIndex >= 0 ? visibleNodes[openDotIndex] : null;
  const openNodeKey = openNode ? `${farmer.farmerId}-${openNode.id}` : null;
  const hasOpenPanel = openNodeKey != null;
  const isSingleDot = visibleNodes.length === 1;
  const latestSavedNote = savedNotes[0]?.content ?? '';

  const panelStyle: React.CSSProperties = isSingleDot
    ? { left: 0, transform: 'none' }
    : openDotIndex <= 0
      ? { left: 0, transform: 'none' }
      : openDotIndex >= visibleNodes.length - 1
        ? { right: 0, left: 'auto', transform: 'none' }
        : {
            left: `${getGridDotCenterPercent(openDotIndex, columnCount)}%`,
            transform: 'translateX(-50%)',
          };

  const progressPercent =
    lastConsecutiveYesIndex >= 0
      ? isSingleDot
        ? 4
        : getGridDotCenterPercent(lastConsecutiveYesIndex, columnCount)
      : 0;

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
          className={[
            'relative h-10 items-center overflow-visible',
            isSingleDot ? 'flex' : 'grid',
          ].join(' ')}
          style={
            isSingleDot
              ? undefined
              : { gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }
          }
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
            const noteValue =
              notes[nodeKey] ?? latestSavedNote ?? node.note;
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
                alignStart={isSingleDot}
                onActivate={onNodeChange}
                onSelect={() => {
                  const nextKey = noteOpenKey === nodeKey ? null : nodeKey;
                  onNoteOpen(nextKey, nextKey ? farmer.farmerId : null);
                }}
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
                  noteValue={notes[openNodeKey] ?? latestSavedNote ?? openNode.note}
                  actionTaken={getActionForNode(openNodeKey)}
                  savedNotes={savedNotes}
                  notesLoading={notesLoading}
                  saving={savingNote}
                  saveError={noteSaveError}
                  onSave={async (value, action) => {
                    await onNoteSave(openNodeKey, value, action, farmer.farmerId);
                  }}
                  onClose={() => onNoteOpen(null, null)}
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
  const [noteOpenFarmerId, setNoteOpenFarmerId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [farmerNotes, setFarmerNotes] = useState<Record<string, FarmerNote[]>>({});
  const [notesLoading, setNotesLoading] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaveError, setNoteSaveError] = useState<string | null>(null);
  const [actions, setActions] = useState<Record<string, ActionTaken>>(() =>
    buildInitialActionsForConfigs(farmerConfigs),
  );
  const [farmerSections, setFarmerSections] = useState<
    Record<string, MonthSectionLabel>
  >({});
  const [viewMode, setViewMode] = useState<ProgressViewMode>('live');

  const applyLatestSections = () => {
    setFarmerSections(() => {
      const next: Record<string, MonthSectionLabel> = {};
      for (const cfg of farmerConfigs) {
        next[cfg.farmerId] = resolveLatestMonthSectionFromConfigs([cfg]);
      }
      return next;
    });
    setActiveNode(null);
    setNoteOpenKey(null);
    setNoteOpenFarmerId(null);
  };

  const applyHistorySections = () => {
    setFarmerSections(() => {
      const next: Record<string, MonthSectionLabel> = {};
      for (const cfg of farmerConfigs) {
        next[cfg.farmerId] = DEFAULT_MONTH_SECTION;
      }
      return next;
    });
    setActiveNode(null);
    setNoteOpenKey(null);
    setNoteOpenFarmerId(null);
  };

  const handleViewModeChange = (mode: ProgressViewMode) => {
    setViewMode(mode);
    if (mode === 'live') {
      applyLatestSections();
    } else {
      applyHistorySections();
    }
  };

  useEffect(() => {
    if (farmerConfigs.length === 0) {
      setFarmerSections({});
      return;
    }

    setFarmerSections((prev) => {
      const next: Record<string, MonthSectionLabel> = {};
      for (const cfg of farmerConfigs) {
        if (prev[cfg.farmerId]) {
          next[cfg.farmerId] = prev[cfg.farmerId];
        } else {
          next[cfg.farmerId] = DEFAULT_MONTH_SECTION;
        }
      }
      return next;
    });
  }, [farmerConfigs]);

  useEffect(() => {
    setActions(buildInitialActionsForConfigs(farmerConfigs));
    setNotes({});
    setFarmerNotes({});
    setActiveNode(null);
    setNoteOpenKey(null);
    setNoteOpenFarmerId(null);
    setNoteSaveError(null);
  }, [farmerConfigs]);

  const loadFarmerNotes = useCallback(async (farmerId: string) => {
    if (isPlanetEyeDemoUser()) {
      setFarmerNotes((prev) => ({ ...prev, [farmerId]: [] }));
      return;
    }

    setNotesLoading(true);
    setNoteSaveError(null);
    try {
      const { data } = await getFarmerNotes(farmerId);
      setFarmerNotes((prev) => ({
        ...prev,
        [farmerId]: Array.isArray(data.results) ? data.results : [],
      }));
    } catch {
      setNoteSaveError('Could not load notes for this farmer.');
      setFarmerNotes((prev) => ({ ...prev, [farmerId]: [] }));
    } finally {
      setNotesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!noteOpenFarmerId) return;
    void loadFarmerNotes(noteOpenFarmerId);
  }, [noteOpenFarmerId, loadFarmerNotes]);

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

  const handleNoteOpen = (key: string | null, farmerId: string | null) => {
    setNoteOpenKey(key);
    setNoteOpenFarmerId(farmerId);
    setNoteSaveError(null);
  };

  const setFarmerSection = (farmerId: string, label: MonthSectionLabel) => {
    setFarmerSections((prev) => ({ ...prev, [farmerId]: label }));
    setActiveNode(null);
    handleNoteOpen(null, null);
  };

  const handleNoteSave = async (
    key: string,
    value: string,
    action: ActionTaken,
    farmerId: string,
  ) => {
    setActions((prev) => ({ ...prev, [key]: action }));
    setSavingNote(true);
    setNoteSaveError(null);

    try {
      if (value.trim()) {
        if (isPlanetEyeDemoUser()) {
          setNotes((prev) => ({ ...prev, [key]: value.trim() }));
        } else {
          await createFarmerNote(farmerId, value.trim());
          await loadFarmerNotes(farmerId);
          setNotes((prev) => ({ ...prev, [key]: value.trim() }));
        }
      }
      handleNoteOpen(null, null);
    } catch {
      setNoteSaveError('Could not save note. Please try again.');
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-800"></p>
          <p className="text-xs text-slate-500">
            {viewMode === 'live'
              ? 'Showing latest yield only — updates when new data arrives'
              : ' '}
          </p>
        </div>
        <div
          className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
          role="group"
          aria-label="Timeline view mode"
        >
          <button
            type="button"
            onClick={() => handleViewModeChange('live')}
            className={[
              'rounded-md px-4 py-1.5 text-sm font-semibold transition',
              viewMode === 'live'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-white hover:text-slate-800',
            ].join(' ')}
            aria-pressed={viewMode === 'live'}
          >
            Live
          </button>
          <button
            type="button"
            onClick={() => handleViewModeChange('history')}
            className={[
              'rounded-md px-4 py-1.5 text-sm font-semibold transition',
              viewMode === 'history'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-white hover:text-slate-800',
            ].join(' ')}
            aria-pressed={viewMode === 'history'}
          >
            History
          </button>
        </div>
      </div>

      <div className="overflow-visible rounded-xl border border-slate-100 bg-slate-50/60 p-3 sm:p-4">
        {displayFarmers.length > VISIBLE_FARMER_ROWS && (
          <p className="mb-2 text-center text-xs font-medium text-slate-500">
            {/* Showing {VISIBLE_FARMER_ROWS} of {displayFarmers.length} farmers — scroll down for */}
            {/* more */}
          </p>
        )}

        <div
          className="space-y-3 overflow-x-hidden overflow-y-auto pr-1"
          style={{
            maxHeight: noteOpenKey
              ? `calc(${FARMER_LIST_MAX_HEIGHT} + 11rem)`
              : FARMER_LIST_MAX_HEIGHT,
          }}
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
              const visibleNodes =
                viewMode === 'live'
                  ? buildLiveTimelineNode(farmer.farmerId, {
                      plantationDate: cfg?.plantationDate,
                      yieldReadings: cfg?.yieldReadings,
                    })
                  : buildSectionTimelineNodes(
                      farmer.farmerId,
                      section.start,
                      section.count,
                      {
                        plantationDate: cfg?.plantationDate,
                        yieldReadings: cfg?.yieldReadings,
                        baseYield: cfg?.baseYield,
                      },
                    );

              return (
              <FarmerRow
                key={farmer.farmerId}
                farmer={farmer}
                visibleNodes={visibleNodes}
                columnCount={
                  viewMode === 'history'
                    ? WEEKS_PER_SECTION
                    : Math.max(visibleNodes.length, 1)
                }
                activeNode={activeNode}
                noteOpenKey={noteOpenKey}
                notes={notes}
                actions={actions}
                savedNotes={farmerNotes[farmer.farmerId] ?? []}
                notesLoading={notesLoading && noteOpenFarmerId === farmer.farmerId}
                savingNote={savingNote && noteOpenFarmerId === farmer.farmerId}
                noteSaveError={
                  noteOpenFarmerId === farmer.farmerId ? noteSaveError : null
                }
                onNodeChange={setActiveNode}
                onNoteOpen={handleNoteOpen}
                onNoteSave={handleNoteSave}
                rowIndex={index}
                highlightFarmerId={highlightFarmerId}
                canGoPrevSection={
                  viewMode === 'history' && farmerSectionIndex > 0
                }
                canGoNextSection={
                  viewMode === 'history' &&
                  farmerSectionIndex < MONTH_SECTIONS.length - 1
                }
                onPrevSection={() => {
                  if (viewMode !== 'history' || farmerSectionIndex <= 0) return;
                  setFarmerSection(
                    farmer.farmerId,
                    MONTH_SECTIONS[farmerSectionIndex - 1].label,
                  );
                }}
                onNextSection={() => {
                  if (
                    viewMode !== 'history' ||
                    farmerSectionIndex >= MONTH_SECTIONS.length - 1
                  ) {
                    return;
                  }
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
