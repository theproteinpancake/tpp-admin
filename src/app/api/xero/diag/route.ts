import { NextRequest, NextResponse } from 'next/server';
import { xeroGet, xeroPost, getConnection } from '@/lib/xero';

export const maxDuration = 60;

// TEMP diagnostic: inspect how existing Xero POs are structured + capture the exact
// error when pushing a test PO. CRON_SECRET guarded. Read-mostly: any test PO it
// creates is immediately deleted.
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

  // 2. item codes Xero knows about (so we can see if "BML" etc are valid)
  try {
    const r = await xeroGet('/Items');
    out.items = (r.Items ?? []).map((i: any) => ({ code: i.Code, name: i.Name, purchaseAccount: i.PurchaseDetails?.AccountCode }));
  } catch (e) { out.items_error = String(e).slice(0, 300); }

  // 3. attempt the exact push our code does, capture the raw error
  const testBody = {
    PurchaseOrders: [{
      Contact: { Name: 'ABC Blending' },
      Date: new Date().toISOString().slice(0, 10),
      Reference: 'TPP DIAG TEST',
      Status: 'DRAFT',
      LineItems: [{ ItemCode: 'BML', Quantity: 1, UnitAmount: 9.52, AccountCode: '310' }],
    }],
  };
  try {
    const r = await xeroPost('/PurchaseOrders', testBody);
    const id = r.PurchaseOrders?.[0]?.PurchaseOrderID;
    out.test_push = { ok: true, id };
    // clean up: delete the test PO
    if (id) {
      try { await xeroPost('/PurchaseOrders', { PurchaseOrders: [{ PurchaseOrderID: id, Status: 'DELETED' }] }); out.test_push.deleted = true; }
      catch { out.test_push.deleted = false; }
    }
  } catch (e) { out.test_push = { ok: false, error: String(e) }; }

  return NextResponse.json(out);
}

export const POST = handle;
export const GET = handle;
