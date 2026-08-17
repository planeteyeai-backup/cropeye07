import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, History } from 'lucide-react';
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FarmerProgressConfig } from './progressData';
import { YIELD_TARGET_TON } from './progressData';
import { daysSincePlantation, resolveGrowthStage } from './growthStage';
import { downloadYieldRangeFarmersExcel } from './exportUnderTargetExcel';
import { requestProgressDashboardNav } from './progressNavigation';
import { DEFAULT_MONTH_SECTION } from './progressConstants';
import type { FactoryId } from './factoryProgressTypes';
import {
  CHART_TOP_RANGES,
  CHART_Y_DOMAIN,
  YIELD_GRID_LINES,
  YIELD_ZONE_BANDS,
  YIELD_ZONE_BOUNDARIES,
  collectYieldSnapshotDates,
  formatYieldSnapshotLabel,
  groupFarmersByChartTopRanges,
  yieldAsOfDate,
} from './chartYieldScale';
import { getUserData, PROGRESS_LOCAL_STORAGE_PREFIX } from '../../utils/auth';

import { CHART_THEME as C, PROGRESS_THEME as T } from './progressTheme';

const UNDER_TARGET_FILL = C.underTarget;
const ABOVE_TARGET_FILL = C.aboveTarget;
const PAST_BUBBLE_FILL = '#64748B';

const GRID_TICKS = YIELD_GRID_LINES.map((line) => line.chartY);
const CHART_HEIGHT = 460;
const FARMER_LIST_MAX_HEIGHT = '14rem';

type ChartTimeMode = 'current' | 'past';

function chartViewStorageKey(factoryId: string): string {
  const user = getUserData();
  const uid = user?.id ?? user?.user_id ?? 'anon';
  return `${PROGRESS_LOCAL_STORAGE_PREFIX}chart_view_v1__${uid}__${factoryId || 'none'}`;
}

function loadChartViewPref(factoryId: string): {
  mode: ChartTimeMode;
  asOfDate: string | null;
} {
  try {
    const raw = localStorage.getItem(chartViewStorageKey(factoryId));
    if (!raw) return { mode: 'current', asOfDate: null };
    const parsed = JSON.parse(raw) as { mode?: string; asOfDate?: string | null };
    return {
      mode: parsed.mode === 'past' ? 'past' : 'current',
      asOfDate: parsed.asOfDate ?? null,
    };
  } catch {
    return { mode: 'current', asOfDate: null };
  }
}

function saveChartViewPref(
  factoryId: string,
  mode: ChartTimeMode,
  asOfDate: string | null,
): void {
  try {
    localStorage.setItem(
      chartViewStorageKey(factoryId),
      JSON.stringify({ mode, asOfDate }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

function formatYTick(chartY: number): string {
  const match = YIELD_GRID_LINES.find(
    (line) => Math.abs(line.chartY - chartY) < 0.008,
  );
  return match ? String(match.tons) : '';
}

interface RangeBubbleRow {
  kind: 'range';
  rangeIndex: number;
  label: string;
  count: number;
  avgTons: number;
  chartY: number;
  xPos: number;
  fill: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: RangeBubbleRow }>;
  timeLabel?: string;
}

const ChartTooltip: React.FC<ChartTooltipProps> = ({
  active,
  payload,
  timeLabel,
}) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  if (row.kind !== 'range') return null;

  return (
    <div className="max-w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-slate-800">{row.label} ton</p>
      {timeLabel && (
        <p className="text-[10px] font-medium text-slate-500">{timeLabel}</p>
      )}
      <p className="text-slate-600">
        {row.count} farmer{row.count === 1 ? '' : 's'}
      </p>
      <p className="text-slate-500">Avg yield: {row.avgTons.toFixed(1)} ton</p>
      <p className="mt-1 text-[10px]" style={{ color: T.active }}>
        Click dot — farmer list opens below
      </p>
    </div>
  );
};

interface RangeFarmerRow {
  farmerId: string;
  name: string;
  phone: string;
  stage: string;
  variety: string;
  bud: string;
  /** Days from plantation date to today. */
  plantationDays: string;
  tons: number;
  yieldDate: string;
  hasYieldData: boolean;
}

interface ProgressGridChartProps {
  factoryId?: FactoryId;
  factoryLabel?: string;
  farmerConfigs?: FarmerProgressConfig[];
  underTargetCount?: number;
  farmersWithoutYield?: number;
  hasIndustrialYield?: boolean;
  industrialLoadError?: string | null;
}

function chartSubtitle(
  farmerCount: number,
  rangeCount: number,
  farmersWithoutYield: number,
  hasIndustrialYield: boolean,
  industrialLoadError: string | null,
  timeLabel: string,
): string {
  if (farmerCount === 0) {
    if (hasIndustrialYield) {
      return farmersWithoutYield > 0
        ? 'No farmers with industrial AI yield readings for this factory'
        : 'No farmers to chart for this factory';
    }
    return industrialLoadError
      ? 'Yield data unavailable — chart will update when data is available'
      : 'Waiting for yield data…';
  }

  const rangeLabel = `${rangeCount} yield range${rangeCount === 1 ? '' : 's'}`;
  const excluded =
    farmersWithoutYield > 0
      ? ` · ${farmersWithoutYield} excluded (no yield data)`
      : '';
  return `${timeLabel} · ${rangeLabel} · ${farmerCount} farmers with yield data${excluded} · Click a range for farmer names`;
}

function chartEmptyDetail(
  hasIndustrialYield: boolean,
  farmersWithoutYield: number,
  industrialLoadError: string | null,
): string {
  if (!hasIndustrialYield) {
    return (
      industrialLoadError ??
      'Chart will appear when yield data is available.'
    );
  }

  const prefix =
    farmersWithoutYield > 0
      ? String(farmersWithoutYield) + ' farmers have no weekly yield data. '
      : '';
  return (
    prefix +
    'Select a factory with yield data to see the chart.'
  );
}

const ProgressGridChart: React.FC<ProgressGridChartProps> = ({
  factoryId = '',
  factoryLabel = '',
  farmerConfigs = [],
  underTargetCount = 0,
  farmersWithoutYield = 0,
  hasIndustrialYield = false,
  industrialLoadError = null,
}) => {
  const [selectedRangeIndex, setSelectedRangeIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [timeMode, setTimeMode] = useState<ChartTimeMode>('current');
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [prefReady, setPrefReady] = useState(false);
  const farmerTableRef = useRef<HTMLDivElement>(null);

  const snapshotDates = useMemo(
    () => collectYieldSnapshotDates(farmerConfigs),
    [farmerConfigs],
  );

  // Restore Current/Past preference (survives logout via cropeye_progress_ prefix).
  useEffect(() => {
    const pref = loadChartViewPref(String(factoryId));
    setTimeMode(pref.mode);
    if (pref.asOfDate && snapshotDates.includes(pref.asOfDate)) {
      setAsOfDate(pref.asOfDate);
    } else {
      setAsOfDate(snapshotDates[1] ?? snapshotDates[0] ?? null);
    }
    setSelectedRangeIndex(null);
    setPrefReady(true);
  }, [factoryId, snapshotDates]);

  useEffect(() => {
    if (timeMode === 'past' && asOfDate && !snapshotDates.includes(asOfDate)) {
      setAsOfDate(snapshotDates[1] ?? snapshotDates[0] ?? null);
    }
  }, [snapshotDates, timeMode, asOfDate]);

  useEffect(() => {
    if (!prefReady) return;
    saveChartViewPref(String(factoryId), timeMode, asOfDate);
  }, [factoryId, timeMode, asOfDate, prefReady]);

  useEffect(() => {
    if (selectedRangeIndex == null || !farmerTableRef.current) return;
    farmerTableRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [selectedRangeIndex]);

  const handleRangeClick = (rangeIndex: number) => {
    setSelectedRangeIndex((prev) => (prev === rangeIndex ? null : rangeIndex));
  };

  /** Farmers + tons for Current (latest) or Past (as-of date). */
  const farmerInputs = useMemo(() => {
    return farmerConfigs.map((cfg) => {
      if (timeMode === 'past' && asOfDate) {
        const past = yieldAsOfDate(cfg.yieldReadings, asOfDate);
        return {
          farmerId: cfg.farmerId,
          farmerName: cfg.farmerName,
          tons: past?.yield ?? 0,
          hasYieldData: past != null,
          yieldDate: past?.date ?? null,
          cfg,
        };
      }
      return {
        farmerId: cfg.farmerId,
        farmerName: cfg.farmerName,
        tons: cfg.tons,
        hasYieldData: cfg.hasYieldData !== false,
        yieldDate: cfg.yieldDate ?? null,
        cfg,
      };
    });
  }, [farmerConfigs, timeMode, asOfDate]);

  /** Previous snapshot counts while viewing Current — for visual comparison. */
  const previousRangeGroups = useMemo(() => {
    const prevDate = snapshotDates[1] ?? null;
    if (!prevDate || timeMode !== 'current') return null;
    const inputs = farmerConfigs.map((cfg) => {
      const past = yieldAsOfDate(cfg.yieldReadings, prevDate);
      return {
        farmerId: cfg.farmerId,
        farmerName: cfg.farmerName,
        tons: past?.yield ?? 0,
        hasYieldData: past != null,
      };
    });
    return groupFarmersByChartTopRanges(inputs);
  }, [farmerConfigs, snapshotDates, timeMode]);

  const rangeGroups = useMemo(() => {
    return groupFarmersByChartTopRanges(
      farmerInputs.map(({ farmerId, farmerName, tons, hasYieldData }) => ({
        farmerId,
        farmerName,
        tons,
        hasYieldData,
      })),
    );
  }, [farmerInputs]);

  const maxRangeIndex = CHART_TOP_RANGES.length - 1;

  const rangeDots = useMemo((): RangeBubbleRow[] => {
    return rangeGroups
      .filter((group) => group.count > 0)
      .map((group) => {
        const underTarget = group.avgTons < YIELD_TARGET_TON;
        return {
          kind: 'range' as const,
          rangeIndex: group.rangeIndex,
          label: group.label,
          count: group.count,
          avgTons: group.avgTons,
          chartY: group.chartY,
          xPos: group.xPos,
          fill:
            timeMode === 'past'
              ? PAST_BUBBLE_FILL
              : underTarget
                ? UNDER_TARGET_FILL
                : ABOVE_TARGET_FILL,
        };
      });
  }, [rangeGroups, timeMode]);

  /** Ghost bubbles = previous week counts when viewing Current. */
  const previousRangeDots = useMemo((): RangeBubbleRow[] => {
    if (!previousRangeGroups) return [];
    return previousRangeGroups
      .filter((group) => group.count > 0)
      .map((group) => ({
        kind: 'range' as const,
        rangeIndex: group.rangeIndex,
        label: group.label,
        count: group.count,
        avgTons: group.avgTons,
        chartY: group.chartY,
        xPos: group.xPos - 0.18,
        fill: PAST_BUBBLE_FILL,
      }));
  }, [previousRangeGroups]);

  const selectedFarmers = useMemo((): RangeFarmerRow[] => {
    if (selectedRangeIndex == null) return [];
    const group = rangeGroups[selectedRangeIndex];
    if (!group || group.count === 0) return [];

    return [...group.farmers]
      .sort((a, b) => a.tons - b.tons || a.farmerName.localeCompare(b.farmerName))
      .map((farmer) => {
        const input = farmerInputs.find((item) => item.farmerId === farmer.farmerId);
        const cfg = input?.cfg;
        const rawDate = input?.yieldDate ?? undefined;
        let yieldDate = '-';
        if (rawDate) {
          const parsed = new Date(rawDate);
          yieldDate = Number.isNaN(parsed.getTime())
            ? rawDate
            : parsed.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              });
        }

        const days = daysSincePlantation(cfg?.plantationDate);

        return {
          farmerId: farmer.farmerId,
          name: farmer.farmerName,
          phone: cfg?.phoneNumber?.trim() || '-',
          stage: resolveGrowthStage(cfg?.plantationDate, cfg?.budMethod),
          variety: cfg?.variety?.trim() || '-',
          bud: cfg?.budMethod?.trim() || '-',
          plantationDays: days != null ? String(days) : '-',
          tons: farmer.tons,
          yieldDate,
          hasYieldData: farmer.hasYieldData,
        };
      });
  }, [selectedRangeIndex, rangeGroups, farmerInputs]);

  const selectedRangeLabel =
    selectedRangeIndex != null ? rangeGroups[selectedRangeIndex]?.label : null;

  const chartFarmersWithYield = farmerInputs.filter((f) => f.hasYieldData).length;
  const chartFarmersWithoutYield = farmerInputs.length - chartFarmersWithYield;

  const timeLabel =
    timeMode === 'past' && asOfDate
      ? `Past · ${formatYieldSnapshotLabel(asOfDate)}`
      : 'Current (latest yield)';

  const handleFarmerClick = (farmerId: string, name: string) => {
    if (!factoryId) return;
    requestProgressDashboardNav({
      factoryId,
      monthSection: DEFAULT_MONTH_SECTION,
      farmerId,
      searchQuery: name,
    });
  };

  const handleRangeExcelDownload = async () => {
    if (!selectedRangeLabel || selectedFarmers.length === 0) return;
    setExporting(true);
    try {
      await downloadYieldRangeFarmersExcel(
        factoryLabel || 'factory',
        `${selectedRangeLabel}${timeMode === 'past' && asOfDate ? `_${asOfDate}` : ''}`,
        selectedFarmers,
      );
    } finally {
      setExporting(false);
    }
  };

  const rangesWithData = rangeGroups.filter((group) => group.count > 0).length;
  const prevDateLabel =
    snapshotDates[1] != null
      ? formatYieldSnapshotLabel(snapshotDates[1])
      : null;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold sm:text-base" style={{ color: C.text }}>
            Farmer progress bubble chart
          </h2>
          <p className="mt-1 text-xs" style={{ color: C.textMuted }}>
            {chartSubtitle(
              chartFarmersWithYield,
              rangesWithData,
              chartFarmersWithoutYield,
              hasIndustrialYield,
              industrialLoadError,
              timeLabel,
            )}
          </p>
          <p className="mt-1 text-xs font-medium" style={{ color: C.zone75 }}>
            {timeMode === 'current'
              ? `${underTargetCount} farmer${underTargetCount === 1 ? '' : 's'} under ${YIELD_TARGET_TON} ton (industrial AI yield)`
              : `Showing who was in each ton range on ${asOfDate ? formatYieldSnapshotLabel(asOfDate) : 'past date'}`}
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
            role="group"
            aria-label="Chart time mode"
          >
            <button
              type="button"
              onClick={() => {
                setTimeMode('current');
                setSelectedRangeIndex(null);
              }}
              className={[
                'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                timeMode === 'current'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white',
              ].join(' ')}
            >
              Current
            </button>
            <button
              type="button"
              onClick={() => {
                setTimeMode('past');
                if (!asOfDate) {
                  setAsOfDate(snapshotDates[1] ?? snapshotDates[0] ?? null);
                }
                setSelectedRangeIndex(null);
              }}
              disabled={snapshotDates.length === 0}
              className={[
                'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40',
                timeMode === 'past'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white',
              ].join(' ')}
              title={
                snapshotDates.length === 0
                  ? 'No historical yield readings yet'
                  : 'Show farmer counts from a past yield date'
              }
            >
              <History className="h-3.5 w-3.5" />
              Past
            </button>
          </div>

          {timeMode === 'past' && snapshotDates.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <span className="font-medium whitespace-nowrap">As of</span>
              <select
                value={asOfDate ?? ''}
                onChange={(e) => {
                  setAsOfDate(e.target.value || null);
                  setSelectedRangeIndex(null);
                }}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                {snapshotDates.map((dateKey) => (
                  <option key={dateKey} value={dateKey}>
                    {formatYieldSnapshotLabel(dateKey)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {timeMode === 'current' && prevDateLabel && (
            <p className="text-[10px] text-slate-500">
              Grey ghost dots = previous ({prevDateLabel})
            </p>
          )}
        </div>
      </div>

      {farmerConfigs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-16 text-center">
          <p className="text-sm font-medium text-slate-600">
            {hasIndustrialYield
              ? 'No industrial AI yield readings for farmers in this factory'
              : 'Industrial yield data is not loaded yet'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {chartEmptyDetail(
              hasIndustrialYield,
              farmersWithoutYield,
              industrialLoadError,
            )}
          </p>
        </div>
      ) : chartFarmersWithYield === 0 && timeMode === 'past' ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-16 text-center">
          <p className="text-sm font-medium text-slate-600">
            No farmers had yield readings on this past date
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Pick another date, or switch to Current.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div
            className="grid border-b border-slate-200 bg-slate-50/80"
            style={{
              gridTemplateColumns: `repeat(${CHART_TOP_RANGES.length}, minmax(0, 1fr))`,
            }}
          >
            {rangeGroups.map((group) => {
              const isSelected = selectedRangeIndex === group.rangeIndex;
              const prevCount =
                previousRangeGroups?.[group.rangeIndex]?.count ?? null;
              return (
                <button
                  key={group.label}
                  type="button"
                  onClick={() => handleRangeClick(group.rangeIndex)}
                  className="border-r border-slate-200 px-2 py-2.5 text-center text-[11px] font-semibold transition last:border-r-0 hover:bg-white sm:text-xs"
                  style={{
                    color: isSelected ? T.active : C.text,
                    backgroundColor: isSelected ? T.activeLight : undefined,
                    boxShadow: isSelected ? `inset 0 -2px 0 ${T.active}` : undefined,
                  }}
                  title={
                    group.count > 0
                      ? `${group.count} farmers — click to list names`
                      : 'No farmers in this range'
                  }
                >
                  <span>{group.label}</span>
                  {group.count > 0 && (
                    <span
                      className="mt-0.5 block text-[10px] font-medium"
                      style={{ color: C.textMuted }}
                    >
                      ({group.count})
                      {timeMode === 'current' &&
                        prevCount != null &&
                        prevCount !== group.count && (
                          <span className="ml-1 text-slate-400">
                            · was {prevCount}
                          </span>
                        )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ScatterChart margin={{ top: 20, right: 24, left: 48, bottom: 16 }}>
              {YIELD_ZONE_BANDS.map((zone) => (
                <ReferenceArea
                  key={zone.label}
                  y1={zone.y1}
                  y2={zone.y2}
                  fill={zone.fill}
                  fillOpacity={0.35}
                  strokeOpacity={0}
                />
              ))}

              <CartesianGrid
                strokeDasharray="3 3"
                stroke={C.grid}
                strokeOpacity={0.9}
                vertical={false}
                horizontal
              />

              {YIELD_GRID_LINES.map((line) => {
                const isZone = YIELD_ZONE_BOUNDARIES.has(line.tons);
                return (
                  <ReferenceLine
                    key={`grid-${line.tons}`}
                    y={line.chartY}
                    stroke={
                      line.tons === 75
                        ? C.zone75
                        : line.tons === 85
                          ? C.zone85
                          : line.tons === 100
                            ? C.zone100
                            : C.gridMinor
                    }
                    strokeDasharray={isZone ? '6 4' : '3 3'}
                    strokeWidth={isZone ? 2.5 : 1.25}
                    strokeOpacity={isZone ? 1 : 0.95}
                  />
                );
              })}

              <XAxis
                type="number"
                dataKey="xPos"
                domain={[-0.5, maxRangeIndex + 0.5]}
                hide
              />

              <YAxis
                type="number"
                dataKey="chartY"
                domain={CHART_Y_DOMAIN}
                ticks={GRID_TICKS}
                allowDataOverflow
                tickFormatter={formatYTick}
                tick={{ fontSize: 11, fill: C.axis, fontWeight: 600 }}
                axisLine={{ stroke: C.grid, strokeWidth: 1.5 }}
                tickLine={{ stroke: C.gridMinor, strokeWidth: 1.25 }}
                width={42}
                label={{
                  value: 'Yield (ton)',
                  angle: -90,
                  position: 'insideLeft',
                  offset: 4,
                  style: {
                    fontSize: 12,
                    fill: C.axis,
                    fontWeight: 700,
                    textAnchor: 'middle',
                  },
                }}
              />

              <Tooltip
                content={<ChartTooltip timeLabel={timeLabel} />}
                cursor={false}
                trigger="click"
              />

              {previousRangeDots.length > 0 && (
                <Scatter
                  name="Previous week"
                  data={previousRangeDots}
                  fill={PAST_BUBBLE_FILL}
                  isAnimationActive={false}
                  shape={(props: {
                    cx?: number;
                    cy?: number;
                    payload?: RangeBubbleRow;
                  }) => {
                    const { cx, cy, payload } = props;
                    if (cx == null || cy == null || !payload) return <g />;
                    const radius = Math.min(28, 12 + Math.sqrt(payload.count) * 2.2);
                    return (
                      <g opacity={0.45} pointerEvents="none">
                        <circle
                          cx={cx}
                          cy={cy}
                          r={radius}
                          fill="none"
                          stroke={PAST_BUBBLE_FILL}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                        />
                        <text
                          x={cx}
                          y={cy}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill={PAST_BUBBLE_FILL}
                          fontSize={payload.count > 99 ? 10 : 12}
                          fontWeight={700}
                          pointerEvents="none"
                        >
                          {payload.count}
                        </text>
                      </g>
                    );
                  }}
                />
              )}

              <Scatter
                name="Yield ranges"
                data={rangeDots}
                fill={UNDER_TARGET_FILL}
                isAnimationActive={false}
                cursor="pointer"
                shape={(props: {
                  cx?: number;
                  cy?: number;
                  payload?: RangeBubbleRow;
                }) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null || !payload) return <g />;
                  const isSelected = selectedRangeIndex === payload.rangeIndex;
                  const radius = Math.min(32, 14 + Math.sqrt(payload.count) * 2.5);
                  const countFontSize =
                    payload.count > 99 ? 12 : payload.count > 9 ? 14 : 15;

                  return (
                    <g
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRangeClick(payload.rangeIndex);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <circle
                        cx={cx}
                        cy={cy}
                        r={radius}
                        fill={payload.fill}
                        stroke={isSelected ? C.text : C.axis}
                        strokeWidth={isSelected ? 3 : 2}
                        opacity={isSelected ? 1 : 0.92}
                      />
                      <text
                        x={cx}
                        y={cy}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#ffffff"
                        fontSize={countFontSize}
                        fontWeight={800}
                        stroke="#0f172a"
                        strokeWidth={0.35}
                        paintOrder="stroke fill"
                        pointerEvents="none"
                      >
                        {payload.count}
                      </text>
                    </g>
                  );
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>

          {selectedRangeIndex != null && (
            <div ref={farmerTableRef} className="border-t border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
                <p className="text-xs font-semibold" style={{ color: C.text }}>
                  {selectedRangeLabel} ton — {selectedFarmers.length} farmer
                  {selectedFarmers.length === 1 ? '' : 's'}
                  {timeMode === 'past' && asOfDate
                    ? ` · as of ${formatYieldSnapshotLabel(asOfDate)}`
                    : ' · current'}
                </p>
                <div className="flex items-center gap-3">
                  {selectedFarmers.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleRangeExcelDownload()}
                      disabled={exporting}
                      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                      style={{
                        borderColor: `${T.active}55`,
                        backgroundColor: T.activeLight,
                        color: T.active,
                      }}
                    >
                      <Download className="h-3 w-3" />
                      {exporting ? 'Preparing…' : 'Download Excel'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedRangeIndex(null)}
                    className="text-[10px] font-medium hover:opacity-80"
                    style={{ color: C.textMuted }}
                  >
                    Close
                  </button>
                </div>
              </div>
              {selectedFarmers.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs" style={{ color: C.textMuted }}>
                  No farmers in this yield range
                  {timeMode === 'past' ? ' on this past date' : ''}.
                </p>
              ) : (
                <>
                  <table className="w-full table-fixed text-left text-xs">
                    <colgroup>
                      <col className="w-10 sm:w-12" />
                      <col />
                      <col className="w-24 sm:w-28" />
                      <col className="w-24 sm:w-28" />
                      <col className="w-20 sm:w-24" />
                      <col className="w-16 sm:w-20" />
                      <col className="w-16 sm:w-20" />
                      <col className="w-24 sm:w-28" />
                      <col className="w-16 sm:w-20" />
                    </colgroup>
                    <thead>
                      <tr
                        className="border-b border-slate-300 bg-slate-100 text-[10px] font-semibold uppercase tracking-wide"
                        style={{ color: C.text }}
                      >
                        <th className="px-2 py-2">No</th>
                        <th className="px-2 py-2">Name</th>
                        <th className="px-2 py-2">Phone</th>
                        <th className="px-2 py-2">Stage</th>
                        <th className="px-2 py-2">Variety</th>
                        <th className="px-2 py-2">Bud</th>
                        <th
                          className="px-2 py-2"
                          title="Days from plantation date to today"
                        >
                          Days
                        </th>
                        <th className="px-2 py-2">Yield date</th>
                        <th className="px-2 py-2 text-right">Yield (ton)</th>
                      </tr>
                    </thead>
                  </table>
                  <div
                    className="overflow-y-auto overflow-x-hidden"
                    style={{ maxHeight: FARMER_LIST_MAX_HEIGHT }}
                  >
                    <table className="w-full table-fixed text-left text-xs">
                      <colgroup>
                        <col className="w-10 sm:w-12" />
                        <col />
                        <col className="w-24 sm:w-28" />
                        <col className="w-24 sm:w-28" />
                        <col className="w-20 sm:w-24" />
                        <col className="w-16 sm:w-20" />
                        <col className="w-16 sm:w-20" />
                        <col className="w-24 sm:w-28" />
                        <col className="w-16 sm:w-20" />
                      </colgroup>
                      <tbody>
                        {selectedFarmers.map((farmer, index) => (
                          <tr
                            key={farmer.farmerId}
                            className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#F0FDF4]"
                            onClick={() =>
                              handleFarmerClick(farmer.farmerId, farmer.name)
                            }
                            title="Open this farmer in Crop Growth Progress"
                          >
                            <td
                              className="w-10 px-2 py-1.5"
                              style={{ color: C.textMuted }}
                            >
                              {index + 1}
                            </td>
                            <td
                              className="max-w-[140px] truncate px-2 py-1.5 font-medium"
                              style={{ color: C.text }}
                            >
                              {farmer.name}
                            </td>
                            <td
                              className="whitespace-nowrap px-2 py-1.5"
                              style={{ color: C.textMuted }}
                            >
                              {farmer.phone}
                            </td>
                            <td
                              className="truncate px-2 py-1.5"
                              style={{ color: C.text }}
                            >
                              {farmer.stage}
                            </td>
                            <td
                              className="truncate px-2 py-1.5"
                              style={{ color: C.textMuted }}
                            >
                              {farmer.variety}
                            </td>
                            <td
                              className="truncate px-2 py-1.5"
                              style={{ color: C.textMuted }}
                            >
                              {farmer.bud}
                            </td>
                            <td
                              className="whitespace-nowrap px-2 py-1.5 font-medium"
                              style={{ color: C.text }}
                            >
                              {farmer.plantationDays}
                            </td>
                            <td
                              className="whitespace-nowrap px-2 py-1.5"
                              style={{ color: C.textMuted }}
                            >
                              {farmer.yieldDate}
                            </td>
                            <td
                              className="px-2 py-1.5 text-right font-semibold"
                              style={{ color: T.taskDone }}
                            >
                              {farmer.hasYieldData ? farmer.tons.toFixed(1) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProgressGridChart;
