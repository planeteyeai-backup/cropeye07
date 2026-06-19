import React, { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { DISTRICT_OPTIONS, type DistrictId } from './districts';
import {
  DEFAULT_MONTH_SECTION,
  getSectionIndex,
} from './progressConstants';
import { DISTRICT_PROGRESS, getProgressShare } from './progressData';
import { requestProgressDashboardNav } from './progressNavigation';

const COLORS = {
  grid: '#E8ECF0',
  axis: '#6B7280',
};

const BUBBLE_FILLS = ['#4472C4', '#ED7D31', '#A5A5A5'];
const YIELD_TICKS = [75, 85, 100];

interface FarmerBubbleRow {
  farmerId: string;
  districtId: DistrictId;
  districtLabel: string;
  name: string;
  tons: number;
  xPos: number;
  share: number;
}

interface BubbleTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: FarmerBubbleRow }>;
}

const BubbleTooltip: React.FC<BubbleTooltipProps> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-slate-800">{row.name}</p>
      <p className="text-slate-600">{row.districtLabel}</p>
      <p className="text-slate-600">Yield: {row.tons} ton</p>
      <p className="text-slate-600">Progress: {row.share}%</p>
      <p className="mt-1 text-[10px] text-emerald-600">Click to open weekly timeline</p>
    </div>
  );
};

interface ProgressGridChartProps {
  districtId?: DistrictId;
}

const ProgressGridChart: React.FC<ProgressGridChartProps> = ({
  districtId = 'kalburagi',
}) => {
  const sectionIndex = getSectionIndex(DEFAULT_MONTH_SECTION);
  const districtMeta = DISTRICT_OPTIONS.find((d) => d.id === districtId)!;

  const bubbleData = useMemo(() => {
    const configs = DISTRICT_PROGRESS[districtId] ?? DISTRICT_PROGRESS.kalburagi;
    return configs.map((cfg, index) => ({
      farmerId: cfg.farmerId,
      districtId,
      districtLabel: districtMeta?.shortLabel ?? '',
      name: cfg.farmerName,
      tons: cfg.tons,
      xPos: index,
      share: getProgressShare(cfg, sectionIndex),
      fill: BUBBLE_FILLS[index % BUBBLE_FILLS.length],
    }));
  }, [districtId, districtMeta, sectionIndex]);

  const handleBubbleClick = (row: FarmerBubbleRow) => {
    requestProgressDashboardNav({
      districtId: row.districtId,
      monthSection: DEFAULT_MONTH_SECTION,
      farmerId: row.farmerId,
      searchQuery: row.name,
    });
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
          District
        </p>
        <p className="mt-0.5 text-sm font-bold text-slate-800 sm:text-base">
          {districtMeta?.label}
        </p>
      </div>

      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-800 sm:text-base">
          Farmer progress bubble chart
        </h2>
        <p className="text-xs text-slate-500">
          Y: yield (ton) · Size: progress % · Click bubble → weekly timeline
        </p>
      </div>

      <div className="h-72 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
            <defs>
              {BUBBLE_FILLS.map((color, i) => (
                <radialGradient key={color} id={`bubbleGrad${i}`} cx="35%" cy="30%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity={0.55} />
                  <stop offset="45%" stopColor={color} stopOpacity={1} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.85} />
                </radialGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
            <XAxis
              type="number"
              dataKey="xPos"
              name="Farmer"
              domain={[-0.5, 2.5]}
              ticks={[0, 1, 2]}
              tickFormatter={(value) => `Farmer ${value + 1}`}
              tick={{ fontSize: 12, fill: COLORS.axis, fontWeight: 600 }}
              axisLine={{ stroke: '#CBD5E1' }}
              tickLine={{ stroke: '#CBD5E1' }}
            />
            <YAxis
              type="number"
              dataKey="tons"
              name="Tons"
              domain={[72, 108]}
              ticks={YIELD_TICKS}
              tick={{ fontSize: 12, fill: COLORS.axis }}
              axisLine={{ stroke: '#CBD5E1' }}
              tickLine={{ stroke: '#CBD5E1' }}
              label={{
                value: 'Yield (ton)',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 11, fill: COLORS.axis },
              }}
            />
            <ZAxis type="number" dataKey="share" range={[180, 520]} name="Progress %" />
            <Tooltip content={<BubbleTooltip />} cursor={{ strokeDasharray: '3 3' }} />
            <Legend
              verticalAlign="top"
              height={28}
              formatter={(value) => (
                <span className="text-xs text-slate-700">{value}</span>
              )}
            />
            {bubbleData.map((row, index) => (
              <Scatter
                key={row.farmerId}
                name={row.name}
                data={[row]}
                fill={`url(#bubbleGrad${index})`}
                cursor="pointer"
                onClick={(data: FarmerBubbleRow & { payload?: FarmerBubbleRow }) => {
                  const point = data?.payload ?? data;
                  if (point?.farmerId) handleBubbleClick(point);
                }}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ProgressGridChart;
