import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
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
import { downloadYieldRangeFarmersExcel } from './exportUnderTargetExcel';
import { requestProgressDashboardNav } from './progressNavigation';
import { DEFAULT_MONTH_SECTION } from './progressConstants';
import type { FactoryId } from './factoryProgressTypes';
import {
  CHART_Y_DOMAIN,
  YIELD_GRID_LINES,
  YIELD_ZONE_BANDS,
  YIELD_ZONE_BOUNDARIES,
  groupFarmersByYieldRange,
} from './chartYieldScale';

import { CHART_THEME as C, PROGRESS_THEME as T } from './progressTheme';

const UNDER_TARGET_FILL = C.underTarget;
const ABOVE_TARGET_FILL = C.aboveTarget;

const GRID_TICKS = YIELD_GRID_LINES.map((line) => line.chartY);
const CHART_HEIGHT = 460;
const FARMER_LIST_MAX_HEIGHT = '14rem';

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
}

const ChartTooltip: React.FC<ChartTooltipProps> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  if (row.kind !== 'range') return null;

  return (
    <div className="max-w-[200px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-slate-800">{row.label} ton</p>
      <p className="text-slate-600">{row.count} farmer{row.count === 1 ? '' : 's'}</p>
      <p className="text-slate-500">Avg yield: {row.avgTons.toFixed(1)} ton</p>
      <p className="mt-1 text-[10px]" style={{ color: T.active }}>Click dot — farmer list opens below</p>
    </div>
  );
};

interface RangeFarmerRow {
  farmerId: string;
  name: string;
  phone: string;
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
): string {
  if (farmerCount === 0) {
    if (hasIndustrialYield) {
      return farmersWithoutYield > 0
        ? 'No farmers with industrial AI yield readings for this factory'
        : 'No farmers to chart for this factory';
    }
    return industrialLoadError
      ? 'Industrial yield API unavailable — chart needs SEF weekly readings'
      : 'Waiting for industrial yield data…';
  }

  const rangeLabel = `${rangeCount} industrial yield range${rangeCount === 1 ? '' : 's'}`;
  const excluded =
    farmersWithoutYield > 0
      ? ` · ${farmersWithoutYield} excluded (no SEF readings)`
      : '';
  return `${rangeLabel} · ${farmerCount} farmers with SEF readings${excluded} · Click a dot for the list below`;
}

function chartEmptyDetail(
  hasIndustrialYield: boolean,
  farmersWithoutYield: number,
  industrialLoadError: string | null,
): string {
  if (!hasIndustrialYield) {
    return (
      industrialLoadError ??
      'Chart dots appear after SEF industrial yield snapshot loads for this owner.'
    );
  }

  const prefix =
    farmersWithoutYield > 0
      ? String(farmersWithoutYield) + ' farmers have no weekly SEF readings. '
      : '';
  return (
    prefix +
    'The chart uses SEF industrial_yield_by_owner_snapshot only (not public-factory-farmers single yield).'
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
  const farmerTableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedRangeIndex(null);
  }, [farmerConfigs]);

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

  const farmerInputs = useMemo(
    () =>
      farmerConfigs.map((cfg) => ({
        farmerId: cfg.farmerId,
        farmerName: cfg.farmerName,
        tons: cfg.tons,
        hasYieldData: cfg.hasYieldData !== false,
        cfg,
      })),
    [farmerConfigs],
  );

  const rangeGroups = useMemo(() => {
    const groups = groupFarmersByYieldRange(
      farmerInputs.map(({ farmerId, farmerName, tons, hasYieldData }) => ({
        farmerId,
        farmerName,
        tons,
        hasYieldData,
      })),
    ).filter((group) => group.count > 0);

    return groups.map((group, index) => ({
      ...group,
      rangeIndex: index,
      xPos: index,
    }));
  }, [farmerInputs]);

  const maxRangeIndex = Math.max(0, rangeGroups.length - 1);

  const rangeDots = useMemo((): RangeBubbleRow[] => {
    return rangeGroups.map((group) => {
        const underTarget = group.avgTons < YIELD_TARGET_TON;
        return {
          kind: 'range' as const,
          rangeIndex: group.rangeIndex,
          label: group.label,
          count: group.count,
          avgTons: group.avgTons,
          chartY: group.chartY,
          xPos: group.xPos,
          fill: underTarget ? UNDER_TARGET_FILL : ABOVE_TARGET_FILL,
        };
      });
  }, [rangeGroups]);

  const selectedFarmers = useMemo((): RangeFarmerRow[] => {
    if (selectedRangeIndex == null) return [];
    const group = rangeGroups[selectedRangeIndex];
    if (!group || group.count === 0) return [];

    return [...group.farmers]
      .sort((a, b) => a.tons - b.tons || a.farmerName.localeCompare(b.farmerName))
      .map((farmer) => {
        const cfg = farmerInputs.find((item) => item.farmerId === farmer.farmerId)?.cfg;
        const rawDate = cfg?.yieldDate ?? cfg?.yieldReadings?.at(-1)?.date;
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

        return {
          farmerId: farmer.farmerId,
          name: farmer.farmerName,
          phone: cfg?.phoneNumber?.trim() || '-',
          tons: farmer.tons,
          yieldDate,
          hasYieldData: farmer.hasYieldData,
        };
      });
  }, [selectedRangeIndex, rangeGroups, farmerInputs]);

  const selectedRangeLabel =
    selectedRangeIndex != null ? rangeGroups[selectedRangeIndex]?.label : null;

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
        selectedRangeLabel,
        selectedFarmers,
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-3">
        <h2 className="text-sm font-semibold sm:text-base" style={{ color: C.text }}>
          Farmer progress bubble chart
        </h2>
        <p className="mt-1 text-xs" style={{ color: C.textMuted }}>
          {chartSubtitle(
            farmerConfigs.length,
            rangeGroups.length,
            farmersWithoutYield,
            hasIndustrialYield,
            industrialLoadError,
          )}
        </p>
        <p className="mt-1 text-xs font-medium" style={{ color: C.zone75 }}>
          {underTargetCount} farmer{underTargetCount === 1 ? '' : 's'} under{' '}
          {YIELD_TARGET_TON} ton (industrial AI yield)
        </p>
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
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ScatterChart margin={{ top: 20, right: 24, left: 48, bottom: 48 }}>
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

              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} strokeOpacity={0.9} vertical horizontal />

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
                ticks={rangeDots.map((dot) => dot.xPos)}
                tick={{ fontSize: 10, fill: C.axis, fontWeight: 600 }}
                axisLine={{ stroke: C.grid, strokeWidth: 1.5 }}
                tickLine={{ stroke: C.gridMinor, strokeWidth: 1.25 }}
                tickFormatter={(value) => {
                  const dot = rangeDots.find((item) => item.xPos === Number(value));
                  return dot ? dot.label : '';
                }}
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

              <Tooltip content={<ChartTooltip />} cursor={false} trigger="click" />

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

          {selectedRangeIndex != null && selectedFarmers.length > 0 && (
            <div ref={farmerTableRef} className="border-t border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
                <p className="text-xs font-semibold" style={{ color: C.text }}>
                  {selectedRangeLabel} ton — {selectedFarmers.length} farmers
                </p>
                <div className="flex items-center gap-3">
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
                  {/* <p className="text-[10px]" style={{ color: C.textMuted }}>Scroll to see all</p> */}
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
              {/* Fixed header — outside scroll, no overlap */}
              <table className="w-full table-fixed text-left text-xs">
                <colgroup>
                  <col className="w-10 sm:w-12" />
                  <col />
                  <col className="w-24 sm:w-28" />
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
                    <col className="w-16 sm:w-20" />
                  </colgroup>
                  <tbody>
                    {selectedFarmers.map((farmer, index) => (
                      <tr
                        key={farmer.farmerId}
                        className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#F0FDF4]"
                        onClick={() => handleFarmerClick(farmer.farmerId, farmer.name)}
                        title="Open this farmer in Crop Growth Progress"
                      >
                        <td className="w-10 px-2 py-1.5" style={{ color: C.textMuted }}>
                          {index + 1}
                        </td>
                        <td
                          className="max-w-[140px] truncate px-2 py-1.5 font-medium"
                          style={{ color: C.text }}
                        >
                          {farmer.name}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5" style={{ color: C.textMuted }}>
                          {farmer.phone}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5" style={{ color: C.textMuted }}>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProgressGridChart;
