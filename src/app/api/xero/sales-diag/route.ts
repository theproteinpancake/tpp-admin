import { NextRequest, NextResponse } from 'next/server';
import { xeroGet, getConnection } from '@/lib/xero';

export const maxDuration = 60;

// TEMP read-only diagnostic: inspect ACCREC (sales) invoices so we can model the
// wholesale dashboard against real data. CRON_SECRET guarded. No writes.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const out: any = { connected: !!(await getConnection()) };
  try {
    // recent sales invoices (authorised/paid), newest first
    const r = await xeroGet('/Invoices?where=Type=="ACCREC"&order=Date DESC&page=1');
    const invs = (r.Invoices ?? []) as any[];
    out.invoice_count_page1 = invs.length;

    // per-contact rollup: how many invoices, date span, total
    const byContact = new Map<string, { name: string; count: number; first: string; last: string; total: number }>();
    for (const i of invs) {
      const name = i.Contact?.Name || '(none)';
      const d = String(i.DateString || i.Date || '').slice(0, 10);
      const c = byContact.get(name) || { name, count: 0, first: d, last: d, total: 0 };
      c.count++; c.total += Number(i.Total) || 0;
      if (d && d < c.first) c.first = d; if (d && d > c.last) c.last = d;
      byContact.set(name, c);
    }
    out.contacts = [...byContact.values()].sort((a, b) => b.count - a.count).slice(0, 40);

    // sample line items off the 3 most recent invoices (do their lines carry SKU ItemCode?)
    out.sample_invoices = invs.slice(0, 3).map((i) => ({
      number: i.InvoiceNumber, contact: i.Contact?.Name, date: String(i.DateString || '').slice(0, 10),
      status: i.Status, total: i.Total, currency: i.CurrencyCode,
      lines: (i.LineItems ?? []).map((l: any) => ({ code: l.ItemCode, desc: (l.Description || '').slice(0, 50), qty: l.Quantity, amount: l.LineAmount })),
    }));
  } catch (e) { out.error = String(e).slice(0, 400); }

  return NextResponse.json(out);
}

export const POST = handle;
export const GET = handle;
