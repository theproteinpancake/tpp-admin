'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { WeeklyCost } from '@/lib/shipping';

export default function ShippingTrendChart({ weekly }: { weekly: WeeklyCost[] }) {
  // pivot to { week, ALTONA, MANCHESTER }
  const byWeek = new Map<string, any>();
  for (const w of weekly) {
    const k = w.week;
    const row = byWeek.get(k) || { week: k.slice(5) };
    row[w.site] = w.avg_cost;
    byWeek.set(k, row);
  }
  const data = [...byWeek.values()];
  if (data.length === 0) return <p className="text-sm text-gray-500">No shipping data yet.</p>;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0eadf" />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9ca3af' }} />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} width={40} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => Number(v).toFixed(2)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="ALTONA" name="Altona (AUD)" stroke="#C4814A" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="MANCHESTER" name="Manchester (GBP)" stroke="#4A90A4" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
