// Sync wholesale sales from Xero (ACCREC invoices) → wholesale_customers / _orders /
// _order_items, and recompute per-customer cadence (order count, first/last, avg interval).
import { supabaseLogistics } from './supabase-logistics';
import { xeroGet } from './xero';

// Retail/marketplace aggregators that are NOT wholesale customers (excluded from cadence).
const NON_WHOLESALE = /shopify|amazon|paypal|stripe|afterpay|\bzip\b|square|gift ?card|online sales|cash sale|opening balance|sumup|till|eftpos/i;

interface XInv { InvoiceID: string; InvoiceNumber?: string; Reference?: string; Contact?: any; Status?: string; Total?: number; CurrencyCode?: string; DateString?: string; Date?: string; DueDateString?: string; LineItems?: any[]; }

const isoDate = (s?: string) => (s ? String(s).slice(0, 10) : null);

export async function syncWholesale(sinceYear = 2025): Promise<{ ok: true; invoices: number; customers: number; orders: number } | { error: string }> {
  try {
    const { data: products } = await supabaseLogistics.from('products').select('id, sku');
    const pidBySku = new Map((products ?? []).map((p: any) => [p.sku, p.id]));
    // preserve manual "not stocked anymore" flags across re-syncs
    const { data: existingCusts } = await supabaseLogistics.from('wholesale_customers').select('xero_contact_id, manually_excluded');
    const excluded = new Set((existingCusts ?? []).filter((c: any) => c.manually_excluded).map((c: any) => c.xero_contact_id));

    // pull all ACCREC (authorised + paid) invoices since `sinceYear`, paginated
    const where = encodeURIComponent(`Type=="ACCREC"&&(Status=="AUTHORISED"||Status=="PAID")&&Date>=DateTime(${sinceYear},01,01)`);
    const invoices: XInv[] = [];
    for (let page = 1; page <= 40; page++) {
      const r = await xeroGet(`/Invoices?where=${where}&order=Date&page=${page}`);
      const batch: XInv[] = r.Invoices ?? [];
      invoices.push(...batch);
      if (batch.length < 100) break;
    }
    if (!invoices.length) return { ok: true, invoices: 0, customers: 0, orders: 0 };

    // group by contact → cadence
    interface Cust { id: string; name: string; email: string | null; dates: string[]; total: number; }
    const custs = new Map<string, Cust>();
    for (const inv of invoices) {
      const c = inv.Contact || {};
      if (!c.ContactID) continue;
      const cur: Cust = custs.get(c.ContactID) || { id: c.ContactID, name: c.Name || '(unknown)', email: c.EmailAddress || null, dates: [], total: 0 };
      const d = isoDate(inv.DateString || inv.Date);
      if (d) cur.dates.push(d);
      cur.total += Number(inv.Total) || 0;
      custs.set(c.ContactID, cur);
    }

    // upsert customers with recomputed cadence
    const custRows = [...custs.values()].map((c) => {
      const sorted = c.dates.sort();
      const first = sorted[0] ?? null;
      const last = sorted[sorted.length - 1] ?? null;
      let avg: number | null = null;
      if (sorted.length > 1 && first && last) {
        const span = (new Date(last).getTime() - new Date(first).getTime()) / 86400_000;
        avg = Math.round((span / (sorted.length - 1)) * 10) / 10;
      }
      return {
        xero_contact_id: c.id, name: c.name, email: c.email,
        is_wholesale: !excluded.has(c.id) && !NON_WHOLESALE.test(c.name),
        first_order_date: first, last_order_date: last,
        order_count: sorted.length, total_value: Math.round(c.total * 100) / 100,
        avg_interval_days: avg, updated_at: new Date().toISOString(),
      };
    });
    await supabaseLogistics.from('wholesale_customers').upsert(custRows, { onConflict: 'xero_contact_id' });

    // id map for FK
    const { data: savedCusts } = await supabaseLogistics.from('wholesale_customers').select('id, xero_contact_id');
    const custIdByXero = new Map((savedCusts ?? []).map((c: any) => [c.xero_contact_id, c.id]));

    // upsert orders
    const orderRows = invoices.map((inv) => ({
      xero_invoice_id: inv.InvoiceID, invoice_number: inv.InvoiceNumber || null,
      reference: inv.Reference || null,
      customer_id: custIdByXero.get(inv.Contact?.ContactID) || null,
      contact_name: inv.Contact?.Name || null, status: inv.Status || null,
      order_date: isoDate(inv.DateString || inv.Date), due_date: isoDate(inv.DueDateString),
      total: Number(inv.Total) || 0, currency: inv.CurrencyCode || 'AUD',
      updated_at: new Date().toISOString(),
    }));
    await supabaseLogistics.from('wholesale_orders').upsert(orderRows, { onConflict: 'xero_invoice_id' });

    const { data: savedOrders } = await supabaseLogistics.from('wholesale_orders')
      .select('id, xero_invoice_id').in('xero_invoice_id', invoices.map((i) => i.InvoiceID));
    const orderIdByXero = new Map((savedOrders ?? []).map((o: any) => [o.xero_invoice_id, o.id]));

    // rebuild line items (skip Freight/discount lines without a product code)
    const orderIds = [...orderIdByXero.values()];
    if (orderIds.length) await supabaseLogistics.from('wholesale_order_items').delete().in('order_id', orderIds);
    const itemRows: any[] = [];
    for (const inv of invoices) {
      const oid = orderIdByXero.get(inv.InvoiceID);
      if (!oid) continue;
      for (const l of inv.LineItems ?? []) {
        if (!l.ItemCode && !/freight|shipping|postage/i.test(l.Description || '')) {
          // keep non-coded product lines only if they look like product; otherwise skip
        }
        if (!l.ItemCode) continue; // only SKU-coded product lines
        itemRows.push({
          order_id: oid, product_id: pidBySku.get(l.ItemCode) || null, item_code: l.ItemCode,
          description: (l.Description || '').slice(0, 200), qty: Number(l.Quantity) || 0, amount: Number(l.LineAmount) || 0,
        });
      }
    }
    for (let i = 0; i < itemRows.length; i += 500) {
      await supabaseLogistics.from('wholesale_order_items').insert(itemRows.slice(i, i + 500));
    }

    return { ok: true, invoices: invoices.length, customers: custRows.length, orders: orderRows.length };
  } catch (e) {
    return { error: String(e).slice(0, 300) };
  }
}
