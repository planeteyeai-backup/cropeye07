import React, { useMemo } from 'react';
import {
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { DistrictId } from './districts';

const TOTAL_WEEKS = 13;

const COLORS = {
  grid: '#E8ECF0',
  axis: '#6B7280',
};

/** Excel-style bubble palette (blue, orange, grey) */
const BUBBLE_FILLS = ['#4472C4', '#ED7D31', '#A5A5A5'];

interface FarmerBubbleRow {
  name: string;
  shortName: string;
  tons: number;
  progress: number;
  share: number;
}

const buildRow = (
  name: string,
  tons: number,
  completedUpTo: number,
): FarmerBubbleRow => {
  const progressWeeks = completedUpTo + 1;
  return {
    name,
    shortName: name.replace('Farmer ', ''),
    tons,
    progress: progressWeeks,
    share: Math.round((progressWeeks / TOTAL_WEEKS) * 100),
  };
};

const DISTRICT_CHART_DATA: Record<DistrictId, FarmerBubbleRow[]> = {
  kalburagi: [
    buildRow('Farmer 1', 100, 12),
    buildRow('Farmer 2', 85, 5),
    buildRow('Farmer 3', 75, 8),
  ],
  vijayapura: [
    buildRow('Farmer 1', 95, 10),
    buildRow('Farmer 2', 80, 7),
    buildRow('Farmer 3', 70, 4),
  ],
  bagalkot: [
    buildRow('Farmer 1', 105, 11),
    buildRow('Farmer 2', 88, 6),
    buildRow('Farmer 3', 78, 9),
  ],
  mandya: [
    buildRow('Farmer 1', 98, 9),
    buildRow('Farmer 2', 72, 3),
    buildRow('Farmer 3', 82, 12),
  ],
};

const WEEK_TICKS = Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1);

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
      <p className="text-slate-600">Weeks completed: {row.progress}</p>
      <p className="text-slate-600">Yield: {row.tons} ton</p>
      <p className="text-slate-600">Progress share: {row.share}%</p>
    </div>
  );
};

interface ProgressGridChartProps {
  districtId?: DistrictId;
}

const ProgressGridChart: React.FC<ProgressGridChartProps> = ({
  districtId = 'kalburagi',
}) => {
  const chartData = useMemo(
    () => DISTRICT_CHART_DATA[districtId] ?? DISTRICT_CHART_DATA.kalburagi,
    [districtId],
  );

  const bubbleData = useMemo(
    () =>
      chartData.map((row, index) => ({
        ...row,
        fill: BUBBLE_FILLS[index % BUBBLE_FILLS.length],
      })),
    [chartData],
  );

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800 sm:text-base">
            Farmer progress bubble chart
          </h2>
          <p className="text-xs text-slate-500">
            X: weeks completed · Y: yield (ton) · Bubble size: progress %
          </p>
        </div>
      </div>
      <div className="h-72 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
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
              dataKey="progress"
              name="Weeks"
              domain={[0, TOTAL_WEEKS]}
              ticks={WEEK_TICKS}
              tick={{ fontSize: 11, fill: COLORS.axis }}
              axisLine={{ stroke: '#CBD5E1' }}
              tickLine={{ stroke: '#CBD5E1' }}
              label={{
                value: 'Weeks completed',
                position: 'insideBottom',
                offset: -4,
                style: { fontSize: 11, fill: COLORS.axis },
              }}
            />
            <YAxis
              type="number"
              dataKey="tons"
              name="Tons"
              tick={{ fontSize: 11, fill: COLORS.axis }}
              axisLine={{ stroke: '#CBD5E1' }}
              tickLine={{ stroke: '#CBD5E1' }}
              label={{
                value: 'Yield (ton)',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 11, fill: COLORS.axis },
              }}
            />
            <ZAxis type="number" dataKey="share" range={[120, 520]} name="Progress %" />
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
                key={row.name}
                name={row.name}
                data={[row]}
                fill={`url(#bubbleGrad${index})`}
              >
                <Cell fill={`url(#bubbleGrad${index})`} />
                <LabelList
                  dataKey="shortName"
                  position="right"
                  offset={8}
                  style={{ fontSize: 12, fontWeight: 600, fill: '#374151' }}
                />
              </Scatter>
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ProgressGridChart;
