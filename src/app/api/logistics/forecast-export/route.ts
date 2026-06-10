import { NextResponse } from 'next/server';
import { getOrderingForecast } from '@/lib/forecast';
import { melbDate } from '@/lib/tz';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// CSV export of the ABC ordering forecast (500kg multiples per flavour per month) —
// ready to attach to an email to ABC. Auth via the dashboard cookie (middleware).
export async function GET() {
  const f = await getOrderingForecast(6);
  const monthLabel = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const lines: string[] = [];
  lines.push(`The Protein Pancake — estimated ordering forecast (kg of finished mix; orders placed in 500kg multiples)`);
  lines.push(`Generated ${melbDate(0)} from live sales velocity, seasonality and ${f.growth.toFixed(2)}x growth. Estimates only — actual POs confirmed as placed.`);
  lines.push('');
  lines.push(['Flavour', ...f.months.map(monthLabel), '6-month total'].join(','));
  for (const fl of f.flavours) {
    lines.push([`"${fl.flavour}"`, ...fl.months.map((v) => v || 0), fl.total].join(','));
  }
  lines.push(['Total', ...f.totals.map((v) => v || 0), f.grand_total].join(','));
  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="TPP-ABC-ordering-forecast-${melbDate(0)}.csv"`,
    },
  });
}
