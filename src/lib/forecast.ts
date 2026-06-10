// Forecasting — sales projection + ABC ordering forecast.
//
// SALES MODEL (deliberately simple + explainable): project each remaining week of the year as
//   last year's same week × blended growth
// where blended growth averages REVENUE growth (last 12 completed weeks vs the same 12 weeks
// last year) and CUSTOMER-BASE growth (distinct buyers, trailing 365d vs prior 365d). Last
// year's curve carries the seasonality/peaks (BFCM etc.); the growth factor lifts the level.
// Growth is clamped to [0.8, 2.0] so one weird week can't produce a silly forecast.
//
// ORDERING MODEL (ABC): per-flavour monthly demand = live 90-day SKU velocity × days in month
// × that month's seasonal index (from last year's monthly curve) × blended growth, converted
// to kg (bag weight × units) and rounded to ABC's 500kg multiples with CARRY-FORWARD rounding
// (the un-ordered remainder rolls into the next month, so the 6-month total stays honest).
import { supabaseLogistics } from './supabase-logistics';
import { melbDate, addDays, dowMon0 } from './tz';

const r0 = (n: number) => Math.round(n);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface WeekPoint { week: string; label: string; actual: number | null; lastYear: number | null; forecast: number | null }
export interface SalesForecast {
  series: WeekPoint[];
  growth_revenue: number; growth_customers: number; growth_blended: number;
  run_rate_weekly: number; cur_customers: number; prev_customers: number;
  ytd_actual: number; year_projected: number; last_year_total: number;
}

export async function getSalesForecast(): Promise<SalesForecast> {
  const [{ data: weeks }, { data: cust }] = await Promise.all([
    supabaseLogistics.rpc('forecast_weekly_sales', { p_weeks: 120 }),
    supabaseLogistics.rpc('forecast_customer_growth'),
  ]);
  const byWeek = new Map(((weeks ?? []) as any[]).map((w) => [w.week_start as string, Number(w.revenue) || 0]));
  const today = melbDate(0);
  const thisMon = addDays(today, -dowMon0(today)); // current (incomplete) week
  const year = Number(today.slice(0, 4));

  // growth: last 12 COMPLETED weeks vs same 12 weeks last year (364d back keeps Mondays aligned)
  let cur12 = 0, prev12 = 0;
  for (let i = 1; i <= 12; i++) {
    const wk = addDays(thisMon, -7 * i);
    cur12 += byWeek.get(wk) || 0;
    prev12 += byWeek.get(addDays(wk, -364)) || 0;
  }
  const growth_revenue = prev12 > 0 ? cur12 / prev12 : 1;
  const c = ((cust ?? []) as any[])[0] || {};
  const cur_customers = Number(c.cur_customers) || 0, prev_customers = Number(c.prev_customers) || 0;
  const growth_customers = prev_customers > 0 ? cur_customers / prev_customers : 1;
  const growth_blended = clamp((growth_revenue + growth_customers) / 2, 0.8, 2.0);

  // series: every Monday of the current calendar year
  const jan1 = `${year}-01-01`;
  const firstMon = addDays(jan1, (8 - new Date(jan1 + 'T00:00:00Z').getUTCDay()) % 7);
  const series: WeekPoint[] = [];
  let ytd = 0, projected = 0, lastYearTotal = 0;
  for (let d = firstMon; d.slice(0, 4) === String(year); d = addDays(d, 7)) {
    const ly = byWeek.get(addDays(d, -364)) ?? null;
    if (ly != null) lastYearTotal += ly;
    const done = d < thisMon; // fully completed week
    const actual = done ? (byWeek.get(d) ?? 0) : null;
    const forecast = !done && ly != null ? r0(ly * growth_blended) : null;
    if (actual != null) { ytd += actual; projected += actual; }
    if (forecast != null) projected += forecast;
    const label = new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    series.push({ week: d, label, actual: actual != null ? r0(actual) : null, lastYear: ly != null ? r0(ly) : null, forecast });
  }
  return {
    series,
    growth_revenue, growth_customers, growth_blended,
    run_rate_weekly: r0(cur12 / 12), cur_customers, prev_customers,
    ytd_actual: r0(ytd), year_projected: r0(projected), last_year_total: r0(lastYearTotal),
  };
}

// ---- ABC ordering forecast: 500kg multiples per flavour per month ----
export interface FlavourForecast { flavour: string; months: number[]; total: number; demand_kg: number[] }
export interface OrderingForecast { months: string[]; flavours: FlavourForecast[]; totals: number[]; grand_total: number; growth: number }

export async function getOrderingForecast(monthsAhead = 6): Promise<OrderingForecast> {
  const [{ data: stock }, { data: monthly }, sales] = await Promise.all([
    supabaseLogistics.from('v_stock_current')
      .select('sku, flavour, unit_size_g, category, avg_daily_units_90d, avg_daily_units_30d')
      .eq('location_code', 'ALTONA').eq('active', true).eq('category', 'mix'),
    supabaseLogistics.rpc('forecast_monthly_sales', { p_months: 26 }),
    getSalesForecast(),
  ]);
  const growth = sales.growth_blended;

  // seasonal index per calendar month from LAST YEAR's monthly revenue curve
  const today = melbDate(0);
  const year = Number(today.slice(0, 4));
  const byMonth = new Map(((monthly ?? []) as any[]).map((m) => [String(m.month_start).slice(0, 7), Number(m.revenue) || 0]));
  const lyMonths = Array.from({ length: 12 }, (_, i) => byMonth.get(`${year - 1}-${String(i + 1).padStart(2, '0')}`) || 0);
  const lyAvg = lyMonths.filter(Boolean).length ? lyMonths.reduce((s, v) => s + v, 0) / lyMonths.filter(Boolean).length : 1;
  const seasonal = (monthIdx0: number) => (lyMonths[monthIdx0] > 0 && lyAvg > 0 ? clamp(lyMonths[monthIdx0] / lyAvg, 0.6, 1.8) : 1);

  // target months (start from NEXT month — this month's orders are already placed)
  const months: string[] = [];
  const startM = Number(today.slice(5, 7)); // 1-12 (current month)
  for (let i = 1; i <= monthsAhead; i++) {
    const m = startM + i;
    const y = year + Math.floor((m - 1) / 12);
    months.push(`${y}-${String(((m - 1) % 12) + 1).padStart(2, '0')}`);
  }
  const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

  // per-flavour monthly demand in kg, then 500kg carry-forward rounding
  const byFlavour = new Map<string, { kgPerDay: number }>();
  for (const r of (stock ?? []) as any[]) {
    if (!r.flavour || !r.unit_size_g) continue;
    const kgPerUnit = Number(r.unit_size_g) / 1000;
    const daily = Number(r.avg_daily_units_90d) || Number(r.avg_daily_units_30d) || 0;
    const cur = byFlavour.get(r.flavour) || { kgPerDay: 0 };
    cur.kgPerDay += daily * kgPerUnit;
    byFlavour.set(r.flavour, cur);
  }

  const flavours: FlavourForecast[] = [];
  for (const [flavour, { kgPerDay }] of byFlavour) {
    if (kgPerDay <= 0.05) continue; // dormant SKUs
    const demand_kg: number[] = months.map((ym) => kgPerDay * daysIn(ym) * seasonal(Number(ym.slice(5, 7)) - 1) * growth);
    // carry-forward rounding to 500s: order so cumulative ordered tracks cumulative demand
    const orders: number[] = [];
    let cumDemand = 0, cumOrdered = 0;
    for (const d of demand_kg) {
      cumDemand += d;
      const order = Math.max(0, Math.round((cumDemand - cumOrdered) / 500) * 500);
      orders.push(order);
      cumOrdered += order;
    }
    flavours.push({ flavour, months: orders, total: orders.reduce((s, v) => s + v, 0), demand_kg: demand_kg.map(r0) });
  }
  flavours.sort((a, b) => b.total - a.total);
  const totals = months.map((_, i) => flavours.reduce((s, f) => s + f.months[i], 0));
  return { months, flavours, totals, grand_total: totals.reduce((s, v) => s + v, 0), growth };
}
