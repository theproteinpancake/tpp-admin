// Forecasting — sales projection + ABC ordering forecast.
//
// SALES MODEL (simple + explainable): project each remaining week of the year as
//   last year's same week × growth
// where growth blends REVENUE growth (last 12 completed weeks vs same 12 LY) and CUSTOMER-BASE
// growth (distinct buyers trailing 365d vs prior 365d). PEAK weeks (LY revenue >130% of LY
// average — BFCM etc.) instead use PEAK growth: the best recent week-vs-LY ratio ("momentum"),
// because sell-out-capped averages understate what a big sale can do. Clamped for sanity.
//
// ORDERING MODEL (ABC): per-flavour monthly demand =
//   B2C: live SKU velocity (max of 30d/90d — softens OOS suppression) × days × month seasonality
//   + WHOLESALE buffer: trailing-90d wholesale kg/day (steady reorder cycles, no seasonality)
// all × growth (peak months use peak growth), converted to kg and rounded to each flavour's
// ABC multiple (Buttermilk 1T, everything else 500kg) with CARRY-FORWARD rounding so the
// un-ordered remainder rolls into the next month and totals stay honest.
import { supabaseLogistics } from './supabase-logistics';
import { melbDate, addDays, dowMon0 } from './tz';

const r0 = (n: number) => Math.round(n);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ABC order multiples per flavour (kg). Default 500; fast movers order in bigger blocks.
const ABC_MULTIPLE: Record<string, number> = { Buttermilk: 1000 };

export interface WeekPoint { week: string; label: string; actual: number | null; lastYear: number | null; forecast: number | null }
export interface SalesForecast {
  series: WeekPoint[];
  growth_revenue: number; growth_customers: number; growth_blended: number; growth_peak: number;
  run_rate_weekly: number; cur_customers: number; prev_customers: number;
  ytd_actual: number; year_projected: number; last_year_total: number;
  peak_weeks: string[];
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

  // momentum: the BEST recent week-vs-LY ratio in the last 8 completed weeks — captures
  // unconstrained demand (e.g. $5k/day before a sell-out) that 12-week averages smooth away.
  // Used for PEAK weeks only.
  let momentum = growth_blended;
  for (let i = 1; i <= 8; i++) {
    const wk = addDays(thisMon, -7 * i);
    const cur = byWeek.get(wk) || 0, ly = byWeek.get(addDays(wk, -364)) || 0;
    if (ly > 1000 && cur / ly > momentum) momentum = cur / ly;
  }
  const growth_peak = clamp(momentum, growth_blended, 2.5);

  // LY mean weekly revenue → peak detection (LY week >130% of LY mean)
  const lyVals: number[] = [];
  const jan1 = `${year}-01-01`;
  const firstMon = addDays(jan1, (8 - new Date(jan1 + 'T00:00:00Z').getUTCDay()) % 7);
  for (let d = firstMon; d.slice(0, 4) === String(year); d = addDays(d, 7)) {
    const v = byWeek.get(addDays(d, -364));
    if (v != null && v > 0) lyVals.push(v);
  }
  const lyMean = lyVals.length ? lyVals.reduce((s, v) => s + v, 0) / lyVals.length : 0;

  const series: WeekPoint[] = [];
  const peak_weeks: string[] = [];
  let ytd = 0, projected = 0, lastYearTotal = 0;
  for (let d = firstMon; d.slice(0, 4) === String(year); d = addDays(d, 7)) {
    const ly = byWeek.get(addDays(d, -364)) ?? null;
    if (ly != null) lastYearTotal += ly;
    const isPeak = ly != null && lyMean > 0 && ly > 1.3 * lyMean;
    const done = d < thisMon;
    const actual = done ? (byWeek.get(d) ?? 0) : null;
    const g = isPeak ? growth_peak : growth_blended;
    const forecast = !done && ly != null ? r0(ly * g) : null;
    if (!done && isPeak) peak_weeks.push(d);
    if (actual != null) { ytd += actual; projected += actual; }
    if (forecast != null) projected += forecast;
    const label = new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    series.push({ week: d, label, actual: actual != null ? r0(actual) : null, lastYear: ly != null ? r0(ly) : null, forecast });
  }
  return {
    series,
    growth_revenue, growth_customers, growth_blended, growth_peak,
    run_rate_weekly: r0(cur12 / 12), cur_customers, prev_customers,
    ytd_actual: r0(ytd), year_projected: r0(projected), last_year_total: r0(lastYearTotal),
    peak_weeks,
  };
}

// ---- ABC ordering forecast: per-flavour monthly kg in ABC multiples ----
export interface FlavourForecast {
  flavour: string; multiple: number; months: number[]; total: number;
  demand_kg: number[]; ws_kg: number[];
}
export interface OrderingForecast {
  months: string[]; flavours: FlavourForecast[]; totals: number[]; grand_total: number;
  growth: number; growth_peak: number; wholesale_kg_day: number;
}

export async function getOrderingForecast(monthsAhead = 6, opts: { peak?: boolean } = {}): Promise<OrderingForecast> {
  // Peak months use momentum growth (2.28×) by default — Luke's BFCM bet. peak:false uses
  // blended growth everywhere, for the conservative version of the same table.
  const usePeak = opts.peak !== false;
  const [{ data: stock }, { data: monthly }, { data: ws }, sales] = await Promise.all([
    supabaseLogistics.from('v_stock_current')
      .select('sku, flavour, unit_size_g, category, avg_daily_units_90d, avg_daily_units_30d')
      .eq('location_code', 'ALTONA').eq('active', true).eq('category', 'mix'),
    supabaseLogistics.rpc('forecast_monthly_sales', { p_months: 26 }),
    supabaseLogistics.rpc('forecast_wholesale_velocity'),
    getSalesForecast(),
  ]);
  const growth = sales.growth_blended;
  const growthPeak = sales.growth_peak;

  // seasonal index per calendar month from LAST YEAR's monthly revenue curve
  const today = melbDate(0);
  const year = Number(today.slice(0, 4));
  const byMonth = new Map(((monthly ?? []) as any[]).map((m) => [String(m.month_start).slice(0, 7), Number(m.revenue) || 0]));
  // Seasonal shape from the TRAILING 12 COMPLETED months — i.e. each calendar month's most
  // recent occurrence. The old version indexed against calendar-year-(year-1), so a January
  // 2027 column used January 2025 (two years stale, from when the store was half this size):
  // Jan's index read 0.69 when the most recent January actually ran 1.05× the base. A recent
  // window also carries less growth-trend pollution than a fixed old year.
  const startM0 = Number(today.slice(5, 7)) - 1; // current (incomplete) month, 0-based
  const recentMonths: number[] = Array.from({ length: 12 }, (_, m0) => {
    const y = m0 < startM0 ? year : year - 1; // completed this year already? else last year's
    return byMonth.get(`${y}-${String(m0 + 1).padStart(2, '0')}`) || 0;
  });
  const base = recentMonths.filter(Boolean).length ? recentMonths.reduce((s, v) => s + v, 0) / recentMonths.filter(Boolean).length : 1;
  const seasonalIdx = (m0: number) => (recentMonths[m0] > 0 && base > 0 ? clamp(recentMonths[m0] / base, 0.6, 1.8) : 1);
  const isPeakMonth = (m0: number) => seasonalIdx(m0) > 1.25; // e.g. November

  // One extra month is computed beyond the display window: with carry-forward rounding the
  // final month only orders if the leftover remainder clears half a block, so the last column
  // showed "—" across the board (real Feb demand was ~1.5T). The extra month's demand pulls
  // those orders into view; it is then truncated from the output.
  const calcMonths = monthsAhead + 1;
  const months: string[] = [];
  const startM = Number(today.slice(5, 7));
  for (let i = 1; i <= calcMonths; i++) {
    const m = startM + i;
    const y = year + Math.floor((m - 1) / 12);
    months.push(`${y}-${String(((m - 1) % 12) + 1).padStart(2, '0')}`);
  }
  const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

  // B2C kg/day per flavour — max(30d, 90d) velocity softens OOS suppression (an OOS SKU's 90d
  // average decays; whichever window caught it selling is the better demand signal).
  const b2c = new Map<string, number>();
  for (const r of (stock ?? []) as any[]) {
    if (!r.flavour || !r.unit_size_g) continue;
    // 80g sample packs are OPT-IN ONLY in all ordering logic (Luke's standing rule — poBuilder
    // and poForecast already exclude them). They were leaking in here, and worse: sample RUNS
    // are one-off bursts that max(30d,90d) locks in as the new daily rate — BM80 read 27/day
    // off one gifting run, ~400kg of phantom Buttermilk across the horizon.
    if (Number(r.unit_size_g) < 300) continue;
    const daily = Math.max(Number(r.avg_daily_units_90d) || 0, Number(r.avg_daily_units_30d) || 0);
    // ShipBob's 320g unit is the 4-pouch SRP CARTON (1.28kg), not a single pouch.
    const kgPerUnit = Number(r.unit_size_g) === 320 ? 1.28 : Number(r.unit_size_g) / 1000;
    b2c.set(r.flavour, (b2c.get(r.flavour) || 0) + daily * kgPerUnit);
  }
  // wholesale buffer kg/day per flavour (steady reorder cycles — growth applied, no seasonality)
  const wsKg = new Map<string, number>(((ws ?? []) as any[]).map((w) => [w.flavour as string, Number(w.kg_day) || 0]));
  let wholesale_kg_day = 0;
  for (const v of wsKg.values()) wholesale_kg_day += v;
  // De-dup: the velocity above counts EVERY ShipBob outbound — including the wholesale orders,
  // since Kate's flow ships them as ShipBob orders. Wholesale is modelled separately (steady,
  // no seasonality), so its share is REMOVED from the seasonal B2C part rather than counted in
  // both. Floor at zero: a flavour whose outbound is entirely wholesale has no B2C demand.
  for (const [flavour, w] of wsKg) b2c.set(flavour, Math.max(0, (b2c.get(flavour) || 0) - w));
  const allFlavours = new Set([...b2c.keys(), ...wsKg.keys()]);

  const flavours: FlavourForecast[] = [];
  for (const flavour of allFlavours) {
    const b2cKgDay = b2c.get(flavour) || 0;
    const wsKgDay = wsKg.get(flavour) || 0;
    if (b2cKgDay + wsKgDay <= 0.05) continue;
    const multiple = ABC_MULTIPLE[flavour] ?? 500;
    const demand_kg: number[] = [];
    const ws_kg: number[] = [];
    for (const ym of months) {
      const m0 = Number(ym.slice(5, 7)) - 1;
      const g = usePeak && isPeakMonth(m0) ? growthPeak : growth;
      const d = daysIn(ym);
      const wsPart = wsKgDay * d * g;
      demand_kg.push(b2cKgDay * d * seasonalIdx(m0) * g + wsPart);
      ws_kg.push(wsPart);
    }
    // carry-forward rounding to the flavour's ABC multiple
    const orders: number[] = [];
    let cumDemand = 0, cumOrdered = 0;
    for (const d of demand_kg) {
      cumDemand += d;
      const order = Math.max(0, Math.round((cumDemand - cumOrdered) / multiple) * multiple);
      orders.push(order);
      cumOrdered += order;
    }
    const shown = orders.slice(0, monthsAhead);
    flavours.push({ flavour, multiple, months: shown, total: shown.reduce((s, v) => s + v, 0), demand_kg: demand_kg.slice(0, monthsAhead).map(r0), ws_kg: ws_kg.slice(0, monthsAhead).map(r0) });
  }
  flavours.sort((a, b) => b.total - a.total);
  const shownMonths = months.slice(0, monthsAhead);
  const totals = shownMonths.map((_, i) => flavours.reduce((s, f) => s + f.months[i], 0));
  return { months: shownMonths, flavours, totals, grand_total: totals.reduce((s, v) => s + v, 0), growth, growth_peak: growthPeak, wholesale_kg_day: Math.round(wholesale_kg_day * 10) / 10 };
}
