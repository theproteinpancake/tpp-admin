// Billing data: automated monthly ShipBob spend (from per-shipment invoice_amount)
// + manually-logged billing-tab invoices (storage/receiving fees the API doesn't expose).
import { supabaseLogistics } from './supabase-logistics';

export const SITE_CCY: Record<string, string> = { ALTONA: 'AUD', MANCHESTER: 'GBP' };
export const SITE_LABEL: Record<string, string> = { ALTONA: 'Altona (AU)', MANCHESTER: 'Manchester (UK)' };

export interface MonthlySpend {
  site: string; currency: string; month: string; shipments: number; total: number; avg: number;
}
export interface Invoice {
  id: string; site: string | null; invoice_number: string | null; invoice_date: string | null;
  period_start: string | null; period_end: string | null; currency: string | null;
  fulfillment_amount: number | null; storage_amount: number | null; other_amount: number | null;
  total_amount: number | null; status: string; pdf_url: string | null; notes: string | null;
}
export interface BillingHighlight {
  site: string; currency: string;
  thisMonth: number; lastMonth: number; momPct: number | null;
  outlierExposure: number; outlierCount: number;
  unpaidTotal: number; unpaidCount: number;
}

const monthKey = (offset = 0) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7); // YYYY-MM
};

export async function getBillingData() {
  const since = monthKey(-7);
  const [{ data: monthly }, { data: invoices }, { data: outliers }] = await Promise.all([
    supabaseLogistics.from('v_billing_monthly').select('*').gte('month', since).order('month'),
    supabaseLogistics.from('billing_invoices').select('*').order('invoice_date', { ascending: false, nullsFirst: false }).limit(30),
    supabaseLogistics.from('v_shipping_outliers').select('site,cost,currency,median,ship_date').limit(200),
  ]);
  return {
    monthly: (monthly ?? []) as MonthlySpend[],
    invoices: (invoices ?? []) as Invoice[],
    outliers: (outliers ?? []) as Array<{ site: string; cost: number; currency: string; median: number; ship_date: string | null }>,
  };
}

export function buildHighlights(
  monthly: MonthlySpend[],
  invoices: Invoice[],
  outliers: Array<{ site: string; cost: number; median: number; ship_date: string | null }>,
): BillingHighlight[] {
  const thisM = monthKey(0);
  const lastM = monthKey(-1);
  const sites = ['ALTONA', 'MANCHESTER'];
  return sites.map((site) => {
    const ccy = SITE_CCY[site];
    const thisMonth = monthly.find((m) => m.site === site && m.month === thisM)?.total ?? 0;
    const lastMonth = monthly.find((m) => m.site === site && m.month === lastM)?.total ?? 0;
    const momPct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;
    // outlier exposure this month = how much over the typical (median) cost we paid on flagged orders
    const monthOutliers = outliers.filter((o) => o.site === site && (o.ship_date ?? '').slice(0, 7) === thisM);
    const outlierExposure = Math.round(monthOutliers.reduce((s, o) => s + Math.max(0, o.cost - o.median), 0) * 100) / 100;
    const unpaid = invoices.filter((i) => i.site === site && i.status !== 'paid');
    const unpaidTotal = Math.round(unpaid.reduce((s, i) => s + (i.total_amount ?? 0), 0) * 100) / 100;
    return {
      site, currency: ccy, thisMonth, lastMonth, momPct,
      outlierExposure, outlierCount: monthOutliers.length,
      unpaidTotal, unpaidCount: unpaid.length,
    };
  });
}

// Compact highlights for the Stock Overview dashboard panel (no extra query joins).
export async function getBillingHighlights(): Promise<BillingHighlight[]> {
  const { monthly, invoices, outliers } = await getBillingData();
  return buildHighlights(monthly, invoices, outliers);
}
