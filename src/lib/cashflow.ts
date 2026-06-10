// Owner-only cash view: actual bank balances (via Xero bank feeds), money coming in (AR),
// money going out (AP bills + committed POs + inbox-detected bills not yet in Xero + known
// recurring), and a simple 4/8-week runway picture. Bills the agent spots in the inbox are
// included even when nobody entered them in Xero — that's the "I don't track bills" fix.
import { supabaseLogistics } from './supabase-logistics';
import { xeroGet } from './xero';
import { getAssumptions } from './analytics';
import { melbDate, addDays } from './tz';

const r0 = (n: number) => Math.round(n);

export interface CashItem { who: string; ref: string; amount: number; due: string | null; overdue: boolean; source: 'xero' | 'po' | 'inbox' | 'recurring' }
export interface CashView {
  bank_balance: number | null; bank_accounts: { name: string; balance: number }[];
  ar_total: number; ar_overdue: number; ar_items: CashItem[];
  ap_total: number; ap_items: CashItem[];
  committed_pos: number; detected_bills: number;
  net_30d: number; wages_30d: number;
  notes: string[];
}

// Xero report cells are nested arrays; walk rows for (title, value) pairs.
function bankAccountsFrom(report: any): { name: string; balance: number }[] {
  const out: { name: string; balance: number }[] = [];
  try {
    const rows = report?.Reports?.[0]?.Rows ?? [];
    for (const section of rows) {
      for (const row of section?.Rows ?? []) {
        const cells = row?.Cells ?? [];
        const name = cells[0]?.Value;
        const closing = Number(cells[cells.length - 1]?.Value);
        if (name && Number.isFinite(closing)) out.push({ name, balance: r0(closing) });
      }
    }
  } catch { /* report shape is best-effort */ }
  return out;
}

export async function getCashView(): Promise<CashView> {
  const notes: string[] = [];
  const today = melbDate(0);
  const in30 = addDays(today, 30);

  const [ar, ap, bank, pos, det, a] = await Promise.all([
    xeroGet(`/Invoices?where=Type=="ACCREC" AND Status=="AUTHORISED"&order=DueDate&page=1`).catch(() => null),
    xeroGet(`/Invoices?where=Type=="ACCPAY" AND Status=="AUTHORISED"&order=DueDate&page=1`).catch(() => null),
    xeroGet(`/Reports/BankSummary`).catch(() => null),
    supabaseLogistics.from('purchase_orders').select('po_number, reference, total_cost, expected_date, status, xero_status')
      .not('status', 'in', '("received","cancelled","draft")'),
    supabaseLogistics.from('detected_bills').select('*').or('status.eq.detected,and(status.eq.in_xero,xero_status.eq.DRAFT)'),
    getAssumptions(),
  ]);

  // AR — invoices customers owe us
  const arItems: CashItem[] = ((ar?.Invoices ?? []) as any[]).map((i) => ({
    who: i.Contact?.Name || '?', ref: i.InvoiceNumber || i.Reference || '',
    amount: r0(Number(i.AmountDue) || 0),
    due: i.DueDateString ? String(i.DueDateString).slice(0, 10) : null,
    overdue: !!i.DueDateString && String(i.DueDateString).slice(0, 10) < today,
    source: 'xero' as const,
  })).filter((i) => i.amount > 0);
  if (!ar) notes.push('Xero AR unavailable right now.');

  // AP — bills we owe (entered in Xero)
  const apItems: CashItem[] = ((ap?.Invoices ?? []) as any[]).map((i) => ({
    who: i.Contact?.Name || '?', ref: i.InvoiceNumber || '',
    amount: r0(Number(i.AmountDue) || 0),
    due: i.DueDateString ? String(i.DueDateString).slice(0, 10) : null,
    overdue: !!i.DueDateString && String(i.DueDateString).slice(0, 10) < today,
    source: 'xero' as const,
  })).filter((i) => i.amount > 0);

  // Committed POs not yet billed (the ABC orders en route — cash that WILL leave)
  const xeroBillNumbers = new Set(apItems.map((i) => i.ref.toUpperCase()));
  let committed = 0;
  for (const p of (pos.data ?? []) as any[]) {
    if ((p.xero_status || '') === 'BILLED') continue;
    const cost = Number(p.total_cost) || 0;
    if (cost > 0) { committed += cost; apItems.push({ who: 'ABC (PO placed)', ref: p.po_number || p.reference || '', amount: r0(cost), due: p.expected_date || null, overdue: false, source: 'po' }); }
  }

  // Inbox-detected supplier bills not yet in Xero (skip any whose number already matches a Xero bill)
  let detectedTotal = 0;
  for (const b of (det.data ?? []) as any[]) {
    if (b.invoice_number && xeroBillNumbers.has(String(b.invoice_number).toUpperCase())) continue;
    const amt = Number(b.amount) || 0;
    if (amt > 0) { detectedTotal += amt; apItems.push({ who: `${b.supplier || 'Supplier'} (${b.status === 'in_xero' ? 'draft in Xero' : 'inbox — not in Xero'})`, ref: b.invoice_number || '', amount: r0(amt), due: b.due_date || null, overdue: !!b.due_date && b.due_date < today, source: 'inbox' }); }
  }

  // Known recurring (wages) over the next 30 days
  const wages30 = r0((a.wages_per_day || 0) * 30);
  apItems.push({ who: 'Wages (next 30d)', ref: '', amount: wages30, due: in30, overdue: false, source: 'recurring' });

  apItems.sort((x, y) => (x.due || '9999').localeCompare(y.due || '9999'));
  arItems.sort((x, y) => (x.due || '9999').localeCompare(y.due || '9999'));

  const banks = bank ? bankAccountsFrom(bank) : [];
  const bank_balance = banks.length ? banks.reduce((s, b) => s + b.balance, 0) : null;
  if (!banks.length) notes.push('Bank balance needs Xero bank feeds + reports access — connect/reauthorise the Xero custom connection with accounting.reports.read if this stays empty.');

  const ar_total = arItems.reduce((s, i) => s + i.amount, 0);
  const ap_total = apItems.reduce((s, i) => s + i.amount, 0);
  return {
    bank_balance, bank_accounts: banks,
    ar_total, ar_overdue: arItems.filter((i) => i.overdue).reduce((s, i) => s + i.amount, 0), ar_items: arItems,
    ap_total, ap_items: apItems,
    committed_pos: r0(committed), detected_bills: r0(detectedTotal),
    net_30d: r0(ar_total - ap_total), wages_30d: wages30,
    notes,
  };
}

// One-line cash summary for the owner's weekly review.
export async function cashBriefLine(): Promise<string | null> {
  try {
    const c = await getCashView();
    const bank = c.bank_balance != null ? `Bank $${c.bank_balance.toLocaleString('en-AU')} · ` : '';
    return `${bank}In $${c.ar_total.toLocaleString('en-AU')}${c.ar_overdue ? ` (${'$' + c.ar_overdue.toLocaleString('en-AU')} overdue)` : ''} · Out $${c.ap_total.toLocaleString('en-AU')} · Net $${c.net_30d.toLocaleString('en-AU')}`;
  } catch { return null; }
}
