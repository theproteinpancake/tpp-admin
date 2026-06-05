import { NextRequest, NextResponse } from 'next/server';
import { xeroGet, getConnection } from '@/lib/xero';

export const maxDuration = 60;

// TEMP diagnostic (READ-ONLY): inspect how existing Xero POs + items are structured
// so we can see why a push is rejected (e.g. invalid AccountCode/ItemCode).
// CRON_SECRET guarded. Makes no writes.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const out: any = {};
  out.connected = !!(await getConnection());

  // 1. a sample existing PO's line format (AccountCode / ItemCode / Description)
  try {
    const r = await xeroGet('/PurchaseOrders?Status=AUTHORISED&page=1');
    const po = (r.PurchaseOrders ?? [])[0];
    out.sample_po = po ? {
      contact: po.Contact?.Name,
      status: po.Status,
      line: (po.LineItems ?? [])[0],
    } : 'none';
  } catch (e) { out.sample_po_error = String(e).slice(0, 300); }

  // 2. all line formats across recent POs (AccountCode + ItemCode actually used)
  try {
    const r = await xeroGet('/PurchaseOrders?Status=AUTHORISED');
    const pos = r.PurchaseOrders ?? [];
    const lines = pos.flatMap((p: any) => (p.LineItems ?? []).map((l: any) => ({ code: l.ItemCode, account: l.AccountCode })));
    out.line_codes = [...new Map(lines.map((l: any) => [`${l.code}|${l.account}`, l])).values()];
  } catch (e) { out.line_codes_error = String(e).slice(0, 300); }

  // 3. item codes Xero knows about (so we can see if "BML" etc are valid)
  try {
    const r = await xeroGet('/Items');
    out.items = (r.Items ?? []).map((i: any) => ({ code: i.Code, name: i.Name, purchaseAccount: i.PurchaseDetails?.AccountCode }));
  } catch (e) { out.items_error = String(e).slice(0, 300); }

  // 4. purchase-type accounts in the chart (valid AccountCodes for PO lines)
  try {
    const r = await xeroGet('/Accounts?where=Class=="EXPENSE"||Class=="DIRECTCOSTS"');
    out.accounts = (r.Accounts ?? []).map((a: any) => ({ code: a.Code, name: a.Name, class: a.Class }));
  } catch (e) { out.accounts_error = String(e).slice(0, 300); }

  return NextResponse.json(out);
}

export const POST = handle;
export const GET = handle;
