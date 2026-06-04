'use client';

import { LineChart, Line, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

export interface Point { date: string; value: number }

export default function TrendSparkline({
  data,
  color = '#C4814A',
}: {
  data: Point[];
  color?: string;
}) {
  if (!data || data.length === 0) {
    return <span className="text-xs text-gray-300">—</span>;
  }
  if (data.length === 1) {
    // Single day so far — trends accrue daily. Show a dot, not an empty chart.
    return (
      <div className="flex h-8 items-center gap-1.5 text-[11px] text-gray-400">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        day 1
      </div>
    );
  }
  return (
    <div className="h-8 w-28">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, bottom: 4, left: 0, right: 0 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            contentStyle={{ fontSize: 11, padding: '2px 8px', borderRadius: 8 }}
            labelFormatter={(d) => String(d)}
            formatter={(v) => [v as number, 'on hand']}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
