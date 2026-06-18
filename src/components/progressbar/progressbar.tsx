import React, { useState, useMemo, useEffect } from 'react';
import type { DistrictId } from './districts';

export type CallStatus = 'completed' | 'pending';

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
}

interface ProgressBarProps {
  districtId?: DistrictId;
  farmers?: FarmerTimeline[];
  searchQuery?: string;
}

const TOTAL_DOTS = 13;

const MONTH_SECTIONS = [
  { label: '1–3 months', count: 3, start: 0, end: 2 },
  { label: '4–6 months', count: 3, start: 3, end: 5 },
  { label: '7–9 months', count: 3, start: 6, end: 8 },
  { label: '10–12 months', count: 4, start: 9, end: 12 },
] as const;

export type MonthSectionLabel = (typeof MONTH_SECTIONS)[number]['label'];

const getMonthRange = (dayIndex: number): string => {
  if (dayIndex < 3) return '1–3 months';
  if (dayIndex < 6) return '4–6 months';
  if (dayIndex < 9) return '7–9 months';
  return '10–12 months';
};

const formatDisplayDate = (date: Date): string =>
  date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

const build13Nodes = (
  farmerId: string,
  baseYield: number,
  plantationStart = '2025-01-15',
): TimelineNode[] => {
  const start = new Date(plantationStart);

  return Array.from({ length: TOTAL_DOTS }, (_, i) => {
    const milestoneDate = new Date(start);
    milestoneDate.setDate(start.getDate() + i * 7);
    return {
      id: `${farmerId}-d${i + 1}`,
      day: i + 1,
      date: formatDisplayDate(milestoneDate),
      monthRange: getMonthRange(i),
      yield: `${(baseYield + i * 0.15).toFixed(1)} T/acre`,
      callStatus: 'pending',
      note: '',
    };
  });
};

const buildFarmer = (
  farmerId: string,
  farmerName: string,
  completedUpTo: number,
  baseYield: number,
): FarmerTimeline => ({
  farmerId,
  farmerName,
  currentDayIndex: completedUpTo,
  nodes: build13Nodes(farmerId, baseYield),
});

const DISTRICT_FARMERS: Record<DistrictId, FarmerTimeline[]> = {
  kalburagi: [
    buildFarmer('k1', 'Farmer 1', 12, 2.5),
    buildFarmer('k2', 'Farmer 2', 5, 2.2),
    buildFarmer('k3', 'Farmer 3', 8, 2.4),
  ],
  vijayapura: [
    buildFarmer('v1', 'Farmer 1', 10, 2.3),
    buildFarmer('v2', 'Farmer 2', 7, 2.6),
    buildFarmer('v3', 'Farmer 3', 4, 2.1),
  ],
  bagalkot: [
    buildFarmer('b1', 'Farmer 1', 11, 2.7),
    buildFarmer('b2', 'Farmer 2', 6, 2.4),
    buildFarmer('b3', 'Farmer 3', 9, 2.5),
  ],
  mandya: [
    buildFarmer('m1', 'Farmer 1', 9, 2.8),
    buildFarmer('m2', 'Farmer 2', 3, 2.0),
    buildFarmer('m3', 'Farmer 3', 12, 2.9),
  ],
};

const getNodePosition = (index: number, total: number) =>
  total <= 1 ? 0 : (index / (total - 1)) * 100;

const MonthSectionHeader: React.FC<{
  selectedSection: MonthSectionLabel | null;
  onSelect: (label: MonthSectionLabel | null) => void;
}> = ({ selectedSection, onSelect }) => (
  <div className="mb-4 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
    {MONTH_SECTIONS.map((section) => {
      const isActive = selectedSection === section.label;
      return (
        <button
          key={section.label}
          type="button"
          onClick={() => onSelect(isActive ? null : section.label)}
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

const ProgressDot: React.FC<{
  node: TimelineNode;
  farmerName: string;
  isActive: boolean;
  isNoteOpen: boolean;
  noteValue: string;
  onActivate: (key: string | null) => void;
  onNoteToggle: () => void;
  onNoteSave: (value: string) => void;
  nodeKey: string;
}> = ({
  node,
  farmerName,
  isActive,
  isNoteOpen,
  noteValue,
  onActivate,
  onNoteSave,
  onNoteToggle,
  nodeKey,
}) => {
  const [draft, setDraft] = useState(noteValue);

  useEffect(() => {
    if (isNoteOpen) {
      setDraft(noteValue);
    }
  }, [isNoteOpen, noteValue]);

  const hasNote = noteValue.trim().length > 0;
  const isCompleted = hasNote;

  const handleSave = () => {
    const saved = draft.trim();
    onNoteSave(saved);
    onNoteToggle();
  };

  return (
    <div className="flex justify-center">
      <button
        type="button"
        className="relative flex h-10 w-full items-center justify-center focus:outline-none"
        onMouseEnter={() => onActivate(nodeKey)}
        onMouseLeave={() => onActivate(null)}
        onClick={(e) => {
          e.stopPropagation();
          onNoteToggle();
        }}
        aria-label={`${farmerName} ${node.date} — ${node.yield}`}
      >
        <span
          className={[
            'relative flex items-center justify-center rounded-full transition-all duration-300',
            isCompleted
              ? 'h-3.5 w-3.5 bg-white ring-[3px] ring-emerald-500 shadow-md shadow-emerald-200/50 sm:h-4 sm:w-4'
              : 'h-3.5 w-3.5 bg-white ring-[3px] ring-red-500 shadow-md shadow-red-200/50 sm:h-4 sm:w-4',
            isActive || isNoteOpen ? 'scale-125' : '',
          ].join(' ')}
        >
          <span
            className={[
              'block h-1.5 w-1.5 rounded-full sm:h-2 sm:w-2',
              isCompleted ? 'bg-gradient-to-br from-emerald-400 to-green-600' : 'bg-red-500',
            ].join(' ')}
          />
        </span>

        {isActive && !isNoteOpen && (
          <div className="absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap">
            <div className="min-w-[130px] rounded-xl border border-slate-100 bg-white px-3 py-2.5 text-center shadow-xl ring-1 ring-black/5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {node.date}
              </p>
              <p className="mt-1 text-sm font-bold text-emerald-600">{node.yield}</p>
              {hasNote ? (
                <>
                  <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-[10px] font-semibold text-emerald-600">
                    Completed
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-600">Note: {noteValue}</p>
                </>
              ) : (
                <p className="mt-1.5 text-[9px] font-medium text-red-500">Pending — add note</p>
              )}
              <p className="mt-1 text-[9px] text-slate-400">Click dot to add note</p>
            </div>
            <div className="mx-auto h-0 w-0 border-x-[6px] border-t-[6px] border-x-transparent border-t-white" />
          </div>
        )}

        {isNoteOpen && (
          <div
            className="absolute bottom-full left-1/2 z-40 mb-2 w-44 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-[10px] font-semibold text-slate-500">Add note</p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Call note..."
              rows={2}
              className="w-full resize-none rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={!draft.trim()}
              className="mt-1 w-full rounded-lg bg-emerald-600 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Save note & mark complete
            </button>
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
  onNodeChange: (key: string | null) => void;
  onNoteOpen: (key: string | null) => void;
  onNoteSave: (key: string, value: string) => void;
  rowIndex: number;
}> = ({
  farmer,
  visibleNodes,
  columnCount,
  activeNode,
  noteOpenKey,
  notes,
  onNodeChange,
  onNoteOpen,
  onNoteSave,
  rowIndex,
}) => {
  const getNoteForNode = (node: TimelineNode) => {
    const nodeKey = `${farmer.farmerId}-${node.id}`;
    return (notes[nodeKey] ?? node.note).trim();
  };

  let lastCompletedIndex = -1;
  for (let i = 0; i < visibleNodes.length; i++) {
    if (getNoteForNode(visibleNodes[i])) {
      lastCompletedIndex = i;
    } else {
      break;
    }
  }

  const completedInView = lastCompletedIndex + 1;
  const progressPercent =
    lastCompletedIndex >= 0 ? getNodePosition(lastCompletedIndex, columnCount) : 0;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-green-600 text-xs font-bold text-white">
            {rowIndex + 1}
          </div>
          <p className="truncate text-sm font-semibold text-slate-800">{farmer.farmerName}</p>
        </div>
        <span className="shrink-0 text-xs font-medium text-slate-500">
          {completedInView} / {columnCount} completed
        </span>
      </div>

      <div
        className="relative grid items-center"
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-red-100" />
        <div
          className="pointer-events-none absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-gradient-to-r from-emerald-400 via-green-500 to-teal-500 transition-all duration-700"
          style={{ width: `${progressPercent}%` }}
        />

        {visibleNodes.map((node) => {
          const nodeKey = `${farmer.farmerId}-${node.id}`;
          const noteValue = notes[nodeKey] ?? node.note;

          return (
            <ProgressDot
              key={nodeKey}
              node={node}
              farmerName={farmer.farmerName}
              isActive={activeNode === nodeKey}
              isNoteOpen={noteOpenKey === nodeKey}
              noteValue={noteValue}
              onActivate={onNodeChange}
              onNoteSave={(value) => onNoteSave(nodeKey, value)}
              onNoteToggle={() =>
                onNoteOpen(noteOpenKey === nodeKey ? null : nodeKey)
              }
              nodeKey={nodeKey}
            />
          );
        })}
      </div>
    </div>
  );
};

const ProgressBar: React.FC<ProgressBarProps> = ({
  districtId = 'kalburagi',
  farmers,
  searchQuery = '',
}) => {
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [noteOpenKey, setNoteOpenKey] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [selectedSection, setSelectedSection] = useState<MonthSectionLabel | null>(null);

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
    if (!selectedSection) {
      return { start: 0, end: TOTAL_DOTS - 1, count: TOTAL_DOTS };
    }
    const section = MONTH_SECTIONS.find((s) => s.label === selectedSection)!;
    return { start: section.start, end: section.end, count: section.count };
  }, [selectedSection]);

  const getVisibleNodes = (farmer: FarmerTimeline) =>
    farmer.nodes.slice(activeRange.start, activeRange.end + 1);

  const handleNoteSave = (key: string, value: string) => {
    setNotes((prev) => ({ ...prev, [key]: value.trim() }));
  };

  const handleSectionSelect = (label: MonthSectionLabel | null) => {
    setSelectedSection(label);
    setActiveNode(null);
    setNoteOpenKey(null);
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-slate-100 bg-slate-50/60 p-3 sm:p-4">
        <MonthSectionHeader
          selectedSection={selectedSection}
          onSelect={handleSectionSelect}
        />

        {selectedSection && (
          <p className="mb-3 text-center text-xs font-medium text-emerald-700">
            {/* Showing {selectedSection} */}
          </p>
        )}

        <div className="space-y-3">
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
                onNodeChange={setActiveNode}
                onNoteOpen={setNoteOpenKey}
                onNoteSave={handleNoteSave}
                rowIndex={index}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-100 bg-white px-4 py-3 text-xs text-slate-500">
        <span className="flex items-center gap-2">
          <span className="relative flex h-3 w-3 items-center justify-center rounded-full bg-white ring-2 ring-emerald-500">
            <span className="block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Call completed (note added)
        </span>
        <span className="flex items-center gap-2">
          <span className="relative flex h-3 w-3 items-center justify-center rounded-full bg-white ring-2 ring-red-500">
            <span className="block h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
          Pending (no note)
        </span>
        <span className="text-slate-400">
          Click dot → save note to mark complete 
        </span>
      </div>
    </div>
  );
};

export default ProgressBar;
