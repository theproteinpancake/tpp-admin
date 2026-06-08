// Wholesale dashboard + orders data (reads the synced Xero sales data).
import { supabaseLogistics } from './supabase-logistics';

const DAY = 86400_000;
const ABC_LEAD_DAYS = 30; // 320g wholesale bags are made by ABC (~30-day lead)

export interface DueCustomer {
  id: string; name: string; last_order: string | null; avg_interval_days: number | null;
  order_count: number; days_since: number; overdue_days: number; expected_next: string | null; total_value: number;
}
export interface WholesaleStockLine {
  sku: string; flavour: string | null; available: number; inbound: number;
  daily: number; days_cover: number | null; reorder_by: string | null;
}

function startOfWeek(d: Date) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }

export async function getWholesaleDashboard() {
  const [{ data: customers }, { data: orders }, { data: stock }] = await Promise.all([
    supabaseLogistics.from('wholesale_customers').select('*'),
    supabaseLogistics.from('wholesale_orders').select('order_date,total,customer_id,currency'),
    supabaseLogistics.from('v_stock_current')
      .select('sku,flavour,unit_size_g,category,available,inbound,avg_daily_units_30d,avg_daily_units_90d,days_of_cover')
      .eq('location_code', 'ALTONA').eq('active', true),
  ]);

  const whCust = (customers ?? []).filter((c: any) => c.is_wholesale);
  const whIds = new Set(whCust.map((c: any) => c.id));
  const whOrders = (orders ?? []).filter((o: any) => whIds.has(o.customer_id) && o.order_date);

  const now = new Date();
  const sum = (from: Date, to?: Date) => whOrders
    .filter((o: any) => { const d = new Date(o.order_date + 'T00:00:00'); return d >= from && (!to || d < to); })
    .reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);

  const weekStart = startOfWeek(now);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * DAY);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const prevYearStart = new Date(now.getFullYear() - 1, 0, 1);

  const totals = {
    week: sum(weekStart), prev_week: sum(prevWeekStart, weekStart),
    month: sum(monthStart), prev_month: sum(prevMonthStart, monthStart),
    year: sum(yearStart), prev_year: sum(prevYearStart, yearStart),
  };

  // 12-month trend series
  const months: { label: string; total: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    months.push({ label: s.toLocaleDateString('en-AU', { month: 'short' }), total: Math.round(sum(s, e)) });
  }

  // top customers by total value
  const topCustomers = [...whCust]
    .sort((a: any, b: any) => (b.total_value || 0) - (a.total_value || 0))
    .slice(0, 10)
    .map((c: any) => ({ name: c.name, order_count: c.order_count, total_value: c.total_value, last_order: c.last_order_date, avg_interval_days: c.avg_interval_days }));

  // who's due to order (>=2 orders, has a cadence), excluding snoozed/dismissed
  const todayIso = now.toISOString().slice(0, 10);
  const due: DueCustomer[] = whCust
    .filter((c: any) => c.order_count >= 2 && c.avg_interval_days && c.last_order_date)
    .filter((c: any) => !(c.reorder_dismissed_until && c.reorder_dismissed_until >= todayIso))
    .map((c: any) => {
      const last = new Date(c.last_order_date + 'T00:00:00');
      const daysSince = Math.round((now.getTime() - last.getTime()) / DAY);
      const expected = new Date(last.getTime() + c.avg_interval_days * DAY);
      return {
        id: c.id, name: c.name, last_order: c.last_order_date, avg_interval_days: Math.round(c.avg_interval_days),
        order_count: c.order_count, days_since: daysSince, overdue_days: Math.round(daysSince - c.avg_interval_days),
        expected_next: expected.toISOString().slice(0, 10), total_value: c.total_value,
      };
    })
    // ACTIVE + due: due now or within ~7 days, but not so far past their cadence that
    // they've clearly churned (within 2.5× their normal interval). Churned/lapsed
    // customers are a separate re-engagement list, not "due to reorder".
    .filter((c) => c.overdue_days >= -7 && !!c.avg_interval_days && c.days_since <= c.avg_interval_days * 2.5)
    .sort((a, b) => b.overdue_days - a.overdue_days);

  // lapsed = had a steady cadence but are now well past it (likely stopped ordering)
  const lapsed = whCust
    .filter((c: any) => c.order_count >= 3 && c.avg_interval_days && c.last_order_date)
    .map((c: any) => {
      const last = new Date(c.last_order_date + 'T00:00:00');
      const daysSince = Math.round((now.getTime() - last.getTime()) / DAY);
      return { name: c.name, last_order: c.last_order_date, days_since: daysSince, avg_interval_days: Math.round(c.avg_interval_days), total_value: c.total_value };
    })
    .filter((c) => c.days_since > c.avg_interval_days * 3 && c.days_since <= 365)
    .sort((a, b) => b.total_value - a.total_value)
    .slice(0, 8);

  // 320g wholesale stock summary + when to reorder from ABC
  const stockLines: WholesaleStockLine[] = (stock ?? [])
    .filter((r: any) => r.unit_size_g === 320 && r.category === 'mix')
    .map((r: any) => {
      const daily = Number(r.avg_daily_units_30d) || Number(r.avg_daily_units_90d) || 0;
      const cover = r.days_of_cover != null ? Number(r.days_of_cover) : (daily > 0 ? (r.available || 0) / daily : null);
      const reorderInDays = cover != null ? Math.max(0, Math.round(cover - ABC_LEAD_DAYS)) : null;
      const reorderBy = reorderInDays != null ? new Date(now.getTime() + reorderInDays * DAY).toISOString().slice(0, 10) : null;
      return {
        sku: r.sku, flavour: r.flavour, available: r.available || 0, inbound: r.inbound || 0,
        daily: Math.round(daily * 10) / 10, days_cover: cover != null ? Math.round(cover) : null, reorder_by: reorderBy,
      };
    })
    .sort((a, b) => (a.days_cover ?? 9999) - (b.days_cover ?? 9999));

  return { totals, months, topCustomers, due, lapsed, stock: stockLines, customer_count: whCust.length };
}

export async function getWholesaleOrders(limit = 60) {
  const { data } = await supabaseLogistics.from('wholesale_orders')
    .select('xero_invoice_id, invoice_number, reference, contact_name, status, order_date, total, currency, items:wholesale_order_items(item_code, qty)')
    .order('order_date', { ascending: false }).limit(limit);
  const orders = (data ?? []) as any[];

  // Map Xero invoice → ShipBob order id (only agent-created orders have this).
  const xeroIds = orders.map((o) => o.xero_invoice_id).filter(Boolean);
  const shipbobByXero = new Map<string, string>();
  if (xeroIds.length) {
    const { data: logs } = await supabaseLogistics.from('wholesale_po_log')
      .select('xero_invoice_id, shipbob_order_id').in('xero_invoice_id', xeroIds).not('shipbob_order_id', 'is', null);
    for (const l of (logs ?? []) as any[]) if (l.xero_invoice_id && l.shipbob_order_id) shipbobByXero.set(l.xero_invoice_id, String(l.shipbob_order_id));
  }

  return orders.map((o: any) => {
    const shipbobId = shipbobByXero.get(o.xero_invoice_id) || null;
    return {
      invoice_number: o.invoice_number, customer: o.contact_name, status: o.status,
      order_date: o.order_date, total: o.total, currency: o.currency, reference: o.reference || null,
      cartons: (o.items ?? []).reduce((s: number, i: any) => s + (Number(i.qty) || 0), 0),
      items: (o.items ?? []).map((i: any) => `${i.item_code}×${i.qty}`).join(', '),
      xero_url: o.xero_invoice_id ? `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${o.xero_invoice_id}` : null,
      shipbob_url: shipbobId ? `https://web.shipbob.com/app/merchant/#/orders/${shipbobId}` : null,
    };
  });
}
