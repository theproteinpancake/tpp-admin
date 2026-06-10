'use client';
// Sales forecast chart: solid caramel = this year actuals, dashed gray = last year,
// dotted emerald = projection (last year's curve × blended growth).
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { WeekPoint } from '@/lib/forecast';

const fmtK = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);

export default function ForecastChart({ series }: { series: WeekPoint[] }) {
  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke="#f0e7d8" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={3} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
          <YAxis tickFormatter={fmtK} tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            formatter={(v: any, name: any) => [v != null ? `$${Number(v).toLocaleString('en-AU')}` : '—', name]}
            labelFormatter={(l) => `Week of ${l}`}
            contentStyle={{ borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="lastYear" name="Last year" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls />
          <Line type="monotone" dataKey="actual" name="This year" stroke="#bd6930" strokeWidth={2.5} dot={false} connectNulls />
          <Line type="monotone" dataKey="forecast" name="Projected" stroke="#059669" strokeWidth={2} strokeDasharray="2 4" dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
