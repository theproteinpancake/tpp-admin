import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { weekMetrics, dayMetrics, marketBreakdown } from '@/lib/analyticsBrief';
import { listWeeks, getMer, getMasterYear } from '@/lib/analytics';
import { getDashboard } from '@/lib/analyticsDashboard';
import { getPackagingSummary, getPouchTracking } from '@/lib/packaging';
import { logPackagingDelivery, setPouchBaseline } from '@/lib/packagingActions';
import { melbDate, dowMon0, addDays } from '@/lib/tz';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// OPS API — read-only sales data for external agents (the Grok bot; see
// docs/grok-ops-bot.md). Bearer-token authed, self-authenticating, so it is
// exempted from the dashboard cookie gate in middleware.ts.
//
// DESIGN RULE: this layer serves COMPUTED METRICS, never raw table rows for the
// headline numbers. Every figure here has a settled definition that took real
// debugging to get right — wholesale excludes A2X accounting invoices, Amazon is
// AU + UK×fx, net profit has ONE formula, 320g is cartons of 4. An agent handed
// raw rows re-derives those and gets them confidently wrong. So each tool wraps
// the same function the dashboard and the WhatsApp review already use, and the
// numbers can never disagree between surfaces.
//
// Read-only by design. Mutating ops tools (orders, WROs, transfer docs) are a
// separate build with idempotency keys and two-step confirmation — see the spec.
// ---------------------------------------------------------------------------

type ToolFn = (args: Record<string, any>) => Promise<unknown>;

const num = (v: any, dflt: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : dflt;
};
const isDate = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Monday of the last COMPLETED Mon–Sun week (what "last week" means everywhere here). */
const lastCompletedWeek = () => {
  const today = melbDate(0);
  return addDays(today, -dowMon0(today) - 7);
};

// A packaging line the user named in words ("Buttermilk 520g pouches", "BMM", "PANSMALL").
// Resolves to ONE packaging row or returns the candidates — never guesses, because the wrong
// row silently corrupts a pouch count that drives ABC ordering.
async function resolvePackagingRow(item: string): Promise<
  { id: string; label: string; kind: string; remaining: number | null } | { ambiguous: string[] } | { none: true }> {
  const q = String(item || '').toLowerCase().trim();
  if (!q) return { none: true };

  // 1) pouch rows, addressed by SKU or "flavour size"
  const pouches = await getPouchTracking();
  const tracked = pouches.filter((p) => p.pack_id);
  const bySku = tracked.find((p) => p.sku.toLowerCase() === q);
  if (bySku) return { id: bySku.pack_id!, label: `${bySku.flavour} ${bySku.size} pouches`, kind: 'pouch', remaining: bySku.remaining };
  const words = q.replace(/pouch(es)?|bags?/g, '').split(/\s+/).filter(Boolean);
  const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ');
  const pouchHits = tracked.filter((p) => {
    const hay = norm(`${p.flavour} ${p.size} ${p.sku}`);
    return words.length > 0 && words.every((w) => hay.includes(w.toLowerCase()));
  });
  if (pouchHits.length === 1) {
    const h = pouchHits[0];
    return { id: h.pack_id!, label: `${h.flavour} ${h.size} pouches`, kind: 'pouch', remaining: h.remaining };
  }

  // 2) everything else (SRP cartons, shipping cartons, insert cards) by name/sku/visy code
  const { data: rows } = await supabaseLogistics.from('packaging')
    .select('id, name, sku, kind, visy_code, site').eq('active', true).neq('kind', 'pouch');
  const others = ((rows ?? []) as any[]).filter((r) => {
    const hay = norm(`${r.name ?? ''} ${r.sku ?? ''} ${r.visy_code ?? ''} ${r.site ?? ''}`);
    return hay.includes(q) || words.every((w) => hay.includes(w.toLowerCase()));
  });
  if (others.length === 1) return { id: others[0].id, label: others[0].name, kind: others[0].kind, remaining: null };

  const names = [
    ...pouchHits.map((p) => `${p.flavour} ${p.size} pouches (${p.sku})`),
    ...others.map((o: any) => o.name),
  ];
  return names.length ? { ambiguous: names.slice(0, 12) } : { none: true };
}

/** Current remaining for one packaging row, so a write can report before → after. */
async function remainingFor(packagingId: string): Promise<number | null> {
  const pouches = await getPouchTracking();
  const hit = pouches.find((p) => p.pack_id === packagingId);
  return hit ? hit.remaining : null;
}

// A voice note misheard as an extra zero would quietly wreck the ABC ordering maths, so
// anything above this needs an explicit force:true from the user.
const SANITY_MAX = 50_000;

const TOOLS: Record<string, { desc: string; args: Record<string, string>; mutates?: boolean; run: ToolFn }> = {
  get_week: {
    desc: 'Verified weekly sales figures — the exact numbers in the Monday WhatsApp review: online sales, orders, AOV, CR, wholesale, Amazon, total, ROAS/CPA, NC ROAS/CPA, net profit, plus the AU/NZ vs UK market split. Defaults to the last COMPLETED Mon–Sun week.',
    args: { week_start: 'YYYY-MM-DD Monday (optional, default last completed week)' },
    run: async (a) => {
      const weekStart = isDate(a.week_start) ? a.week_start : lastCompletedWeek();
      const m = await weekMetrics(weekStart);
      if (!m) return { week_start: weekStart, note: 'No master row for that week yet — it autofills nightly.' };
      return {
        week_start: weekStart, ...m,
        note: 'These are the verified figures. Net profit = online gross + wholesale margin − ad spend − ShipBob − payment fees − wages. Wholesale counts real stockist invoices only (A2X accounting invoices are excluded).',
      };
    },
  },

  get_day: {
    desc: 'Sales for a single day, computed fresh from the same sources as the weekly figures (Shopify, Meta, Google, ShipBob, wholesale). Defaults to yesterday. Note a day is a small sample — on low-order days Meta often attributes no purchases, which is normal, not a tracking fault.',
    args: { date: 'YYYY-MM-DD Melbourne date (optional, default yesterday)' },
    run: async (a) => {
      const date = isDate(a.date) ? a.date : melbDate(-1);
      const m = await dayMetrics(date);
      return {
        date, ...m,
        note: 'Daily CR is not available (no daily sessions source). If ad spend is present but ROAS/CPA are null, Meta attributed no purchases that day — say that plainly rather than reporting a failure.',
      };
    },
  },

  get_weeks: {
    desc: 'Trailing weekly master rows for trend questions ("how have the last 8 weeks gone"). Each row carries the raw stored fields PLUS a `derived` block with the settled formulas.',
    args: { limit: 'number of weeks, 1–26 (default 12)' },
    run: async (a) => {
      const res = await listWeeks(num(a.limit, 12, 1, 26));
      return {
        ...res,
        note: 'ALWAYS quote the `derived` block for headline numbers (net_profit, sales_total, amazon_sales, blended_roas, mer, gpm). The raw row keeps editable/source fields and its own amazon_sales column is NOT authoritative.',
      };
    },
  },

  get_mer: {
    desc: 'Blended marketing efficiency week by week. Returns BOTH conventions because both are in use: mer_x (revenue ÷ spend, higher is better — how Luke says it out loud) and mer_percent (spend ÷ revenue, LOWER is better — what the MER tile on the Analytics page shows), plus dtc_mer_x excluding wholesale.',
    args: { weeks: 'number of weeks, 1–26 (default 6)' },
    run: async (a) => getMer(num(a.weeks, 6, 1, 26)),
  },

  get_dashboard: {
    desc: 'Analytics dashboard for any date range, with the previous equal-length period for comparison and channel attribution (new-customer ROAS/CPA). Use for "how did August go" or any custom window.',
    args: { from: 'YYYY-MM-DD inclusive', to: 'YYYY-MM-DD exclusive', model: 'attribution model: last (default) or first' },
    run: async (a) => {
      const to = isDate(a.to) ? a.to : melbDate(0);
      const from = isDate(a.from) ? a.from : addDays(to, -30);
      if (from >= to) return { error: 'from must be before to' };
      const model = a.model === 'first' ? 'first' : 'last';
      return { ...(await getDashboard(from, to, model)), model };
    },
  },

  get_year: {
    desc: 'Every week of a calendar year from the Sales & Data master, for year-on-year and seasonality questions. Missing/future weeks come back blank.',
    args: { year: 'e.g. 2026 (default current year)' },
    run: async (a) => getMasterYear(num(a.year, new Date().getFullYear(), 2023, 2100)),
  },

  get_wholesale: {
    desc: 'Real stockist (wholesale) invoices by customer for a date range. A2X payout-reconciliation invoices and payment/marketplace aggregators are already excluded — this reads the v_wholesale_orders view, never the raw invoice table.',
    args: { from: 'YYYY-MM-DD (default 90 days ago)', to: 'YYYY-MM-DD exclusive (default today)' },
    run: async (a) => {
      const to = isDate(a.to) ? a.to : melbDate(1);
      const from = isDate(a.from) ? a.from : addDays(to, -90);
      const { data, error } = await supabaseLogistics
        .from('v_wholesale_orders')
        .select('contact_name, invoice_number, reference, order_date, total, currency, status')
        .gte('order_date', from).lt('order_date', to)
        .order('order_date', { ascending: false });
      if (error) return { error: error.message };
      const rows = (data ?? []) as any[];
      const byCustomer = new Map<string, { customer: string; invoices: number; total: number }>();
      for (const r of rows) {
        const k = r.contact_name || 'Unknown';
        const cur = byCustomer.get(k) ?? { customer: k, invoices: 0, total: 0 };
        cur.invoices++; cur.total += Number(r.total) || 0;
        byCustomer.set(k, cur);
      }
      const by_customer = [...byCustomer.values()]
        .map((c) => ({ ...c, total: Math.round(c.total * 100) / 100 }))
        .sort((x, y) => y.total - x.total);
      return {
        range: { from, to },
        total: Math.round(rows.reduce((s, r) => s + (Number(r.total) || 0), 0) * 100) / 100,
        invoice_count: rows.length,
        by_customer,
        invoices: rows.slice(0, 100),
        note: 'Accounting-only invoices (A2X Shopify payout reconciliation) are already excluded. Orca Marketing Pte Ltd is a genuine Singapore export stockist despite the name.',
      };
    },
  },

  get_market_split: {
    desc: 'AU/NZ vs UK split for one week — sales, orders, AOV, CR, ROAS and CPA per market, plus the ad spend on campaigns spanning both markets that cannot be assigned to either.',
    args: { week_start: 'YYYY-MM-DD Monday (optional, default last completed week)' },
    run: async (a) => {
      const weekStart = isDate(a.week_start) ? a.week_start : lastCompletedWeek();
      const res = await marketBreakdown(weekStart);
      return {
        week_start: weekStart, ...res,
        note: 'unsplit_spend is real spend on AU+UK campaigns. Disclose it when quoting per-market ROAS, or the split looks better than reality.',
      };
    },
  },

  // ---- Packaging ---------------------------------------------------------

  get_packaging: {
    desc: 'Packaging position in one call: empty pouches held at ABC Blending per flavour/size (with the SRP carton constraint on 320g lines), discontinued SRP cartons, and LIVE ShipBob shipping cartons + insert cards at both sites — plus what needs ordering now and suggested quantities.',
    args: {},
    run: async () => {
      const s = await getPackagingSummary();
      return {
        ...s,
        note: 'Pouches are consumed when a PO is PLACED with ABC (that is when they get filled), not when finished goods come back. Pouches come from China Packaging on a ~60-day lead; AU cartons/boxes from VISY (~21 days); UK boxes from CBS. 320g lines pack as 4-packs, so whichever runs out first — pouches or SRP cartons — is the real limit.',
      };
    },
  },

  record_packaging_delivery: {
    desc: 'Record a packaging DELIVERY — "we just received 10,000 Buttermilk 520g pouches", "VISY dropped 2,000 PANSMALL". This ADDS to the remaining count from the delivery date. A FUTURE delivered_on records an order placed but not yet landed (e.g. a China pouch order), which shows as inbound rather than stock. This is the right tool for goods arriving; it is NOT a stocktake — use set_packaging_baseline to correct a count.',
    args: {
      item: 'REQUIRED — SKU ("BMM"), "flavour size" ("Buttermilk 520g"), or a carton/card name ("PANSMALL")',
      qty: 'REQUIRED — units received, positive',
      delivered_on: 'YYYY-MM-DD (default today; a future date = inbound, not yet arrived)',
      note: 'optional free text, e.g. "China order, 3 pallets"',
      idempotency_key: 'REQUIRED — a unique id for this write; a repeat returns the stored result instead of double-counting',
      force: 'true to allow a quantity above the 50,000 sanity ceiling',
    },
    mutates: true,
    run: async (a) => {
      const qty = Number(a.qty);
      if (!Number.isFinite(qty) || qty <= 0) return { error: 'qty must be a positive number of units.' };
      if (qty > SANITY_MAX && a.force !== true && a.force !== 'true') {
        return { error: `${qty.toLocaleString()} is above the ${SANITY_MAX.toLocaleString()} sanity ceiling. Read the quantity back to the user and call again with force:true if it is genuinely right.` };
      }
      const hit = await resolvePackagingRow(String(a.item ?? ''));
      if ('none' in hit) return { error: `No packaging line matches "${a.item}". Ask which item they mean.` };
      if ('ambiguous' in hit) return { error: `"${a.item}" matches several packaging lines: ${hit.ambiguous.join(', ')}. Ask which one.` };

      const delivered_on = isDate(a.delivered_on) ? a.delivered_on : melbDate(0);
      const before = await remainingFor(hit.id);

      const fd = new FormData();
      fd.set('packaging_id', hit.id);
      fd.set('qty', String(Math.round(qty)));
      fd.set('delivered_on', delivered_on);
      if (a.note) fd.set('note', String(a.note).slice(0, 300));
      const res = await logPackagingDelivery(fd);
      if (!res.ok) return { error: res.error || 'Delivery not saved.' };

      const after = await remainingFor(hit.id);
      const future = delivered_on > melbDate(0);
      return {
        ok: true, item: hit.label, kind: hit.kind, qty: Math.round(qty), delivered_on,
        remaining_before: before, remaining_after: after,
        counts_as: future ? 'INBOUND — dated in the future, so it is on order, not yet in stock' : 'in stock from that date',
        note: `Report the real change: ${hit.label} ${before ?? '?'} → ${after ?? '?'}. If that jump does not match what the user said they received, say so — a mistyped or misheard quantity is easiest to catch right now.`,
      };
    },
  },

  set_packaging_baseline: {
    desc: 'Set a STOCKTAKE baseline for a packaging line — "ABC counted 7,940 Buttermilk 320g pouches today". This RESETS the reference point: the count becomes the truth as at baseline_date, and POs placed on or after that date deduct from it. Use only for a genuine count. For goods arriving, use record_packaging_delivery instead.',
    args: {
      item: 'REQUIRED — SKU or "flavour size"; pouch lines only',
      baseline_qty: 'REQUIRED — the counted number of pouches',
      baseline_date: 'YYYY-MM-DD the count was taken (default today)',
      idempotency_key: 'REQUIRED — unique id for this write',
      force: 'true to allow a count above the 50,000 sanity ceiling',
    },
    mutates: true,
    run: async (a) => {
      const qty = Number(a.baseline_qty);
      if (!Number.isFinite(qty) || qty < 0) return { error: 'baseline_qty must be zero or a positive number of pouches.' };
      if (qty > SANITY_MAX && a.force !== true && a.force !== 'true') {
        return { error: `${qty.toLocaleString()} is above the ${SANITY_MAX.toLocaleString()} sanity ceiling. Confirm the count with the user and call again with force:true.` };
      }
      const hit = await resolvePackagingRow(String(a.item ?? ''));
      if ('none' in hit) return { error: `No packaging line matches "${a.item}".` };
      if ('ambiguous' in hit) return { error: `"${a.item}" matches several lines: ${hit.ambiguous.join(', ')}. Ask which one.` };
      if (hit.kind !== 'pouch') return { error: `${hit.label} is a ${hit.kind} line, not an ABC pouch line — baselines apply to pouches. Shipping cartons and cards read live from ShipBob.` };

      const pouches = await getPouchTracking();
      const row = pouches.find((p) => p.pack_id === hit.id);
      if (!row) return { error: `Could not load the pouch row for ${hit.label}.` };
      const before = row.remaining;
      const baseline_date = isDate(a.baseline_date) ? a.baseline_date : melbDate(0);

      const fd = new FormData();
      fd.set('product_id', row.product_id);
      fd.set('baseline_qty', String(Math.round(qty)));
      fd.set('baseline_date', baseline_date);
      fd.set('lead_days', String(row.lead_days ?? 60));
      const res = await setPouchBaseline(fd);
      if (!res.ok) return { error: res.error || 'Baseline not saved.' };

      const after = await remainingFor(hit.id);
      return {
        ok: true, item: hit.label, baseline_qty: Math.round(qty), baseline_date,
        remaining_before: before, remaining_after: after,
        note: `Stocktake applied: ${hit.label} now reads ${after ?? '?'} (was ${before ?? '?'}). Any ABC PO placed on or after ${baseline_date} deducts from this count.`,
      };
    },
  },
};

// ---------------------------------------------------------------------------

function authorised(req: NextRequest): boolean {
  const expected = process.env.OPS_API_TOKEN || '';
  if (!expected) return false; // fail CLOSED — an unset token must never mean open access
  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    || (req.headers.get('x-ops-token') || '').trim();
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: NextRequest, ctx: { params: Promise<{ tool: string }> }) {
  const started = Date.now();
  const { tool } = await ctx.params;

  if (!authorised(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Tool discovery, so a bridge can load the schemas instead of hard-coding them.
  if (tool === '_schema') {
    return NextResponse.json({
      ok: true,
      base_url: `${req.nextUrl.origin}/api/ops`,
      auth: 'Authorization: Bearer <OPS_API_TOKEN>',
      call: 'POST /api/ops/{tool} with a JSON body of args (GET with query params also works)',
      tools: Object.entries(TOOLS).map(([name, t]) => ({
        name, description: t.desc, args: t.args, mutates: !!t.mutates,
      })),
      note: 'Tools with mutates:true change real data and require an idempotency_key. Confirm with the user before calling one.',
    });
  }

  const spec = TOOLS[tool];
  if (!spec) {
    return NextResponse.json(
      { ok: false, error: `unknown tool "${tool}"`, available: Object.keys(TOOLS) },
      { status: 404 },
    );
  }

  // args: JSON body wins, query params fill in (handy for curl and for GET callers)
  let args: Record<string, any> = {};
  try { args = (await req.json()) ?? {}; } catch { /* GET or empty body */ }
  for (const [k, v] of req.nextUrl.searchParams) if (args[k] === undefined) args[k] = v;

  // Mutating tools replay instead of re-executing: a retried tool call must never record the
  // same delivery twice.
  let idemKey = '';
  if (spec.mutates) {
    idemKey = String(args.idempotency_key ?? '').trim().slice(0, 200);
    if (!idemKey) {
      return NextResponse.json(
        { ok: false, tool, error: 'idempotency_key is required for this tool — generate a unique id per intended write.' },
        { status: 400 },
      );
    }
    const { data: prior } = await supabaseLogistics.from('ops_idempotency')
      .select('response').eq('key', idemKey).maybeSingle();
    if ((prior as any)?.response) {
      return NextResponse.json({ ...(prior as any).response, replayed: true });
    }
  }

  try {
    const data = await spec.run(args);
    // Audit into the same trail as the WhatsApp agent, tagged by caller.
    const client = (req.headers.get('x-ops-client') || 'grok').slice(0, 40);
    supabaseLogistics.from('agent_actions').insert({
      phone: `ops:${client}`,
      tool: `ops.${tool}`,
      summary: JSON.stringify(args).slice(0, 400),
    }).then(() => {}, () => {});
    const payload = { ok: true, tool, ms: Date.now() - started, data };
    if (idemKey) {
      await supabaseLogistics.from('ops_idempotency').insert({
        key: idemKey, tool, request_hash: JSON.stringify(args).slice(0, 500), response: payload,
      }).then(() => {}, () => {});
    }
    return NextResponse.json(payload);
  } catch (e) {
    // Relay the real error — an agent must never have to guess why a call failed.
    return NextResponse.json(
      { ok: false, tool, error: String((e as any)?.message || e).slice(0, 300) },
      { status: 500 },
    );
  }
}

export const POST = handle;
export const GET = handle;
