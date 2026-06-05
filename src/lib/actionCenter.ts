// The "hive mind" brain: one place that decides what needs the founder's attention,
// across both sites. Powers the dashboard Action Center AND the WhatsApp morning brief.
import { suggestRestock } from './transferBuilder';
import { getReorderRecommendations } from './reorder';
import { getPouchTracking, getCustomPackaging } from './packaging';
import { getShortestDated, expiryStatus } from './lots';
import { getBillingData, buildHighlights, SITE_CCY } from './billing';
import { getGmailInsights } from './gmailScour';
import { supabaseLogistics } from './supabase-logistics';

// keys the founder has marked done from the brief (and not yet expired)
async function activeDismissals(): Promise<Set<string>> {
  const nowIso = new Date().toISOString();
  const { data } = await supabaseLogistics.from('agent_dismissals')
    .select('key, expires_at').or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  return new Set((data ?? []).map((d: any) => d.key));
}

export type Severity = 'critical' | 'warning' | 'info';
export interface Action {
  key: string;
  severity: Severity;
  title: string;        // short headline
  detail: string;       // one-line specifics
  command: string;      // what to say to the WhatsApp agent to action it
  href: string;         // dashboard deep link
  count: number;        // items behind this action
}

const money = (n: number, ccy: string) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || 'AUD', maximumFractionDigits: 0 }).format(n);

// Mark brief items done by their numbers (from the last morning brief), with an
// optional note/decision to remember. Suppresses them from the brief for ~14 days.
export async function dismissBriefItems(numbers: number[], note?: string):
  Promise<{ cleared: string[]; not_found: number[] }> {
  const { data: cfg } = await supabaseLogistics.from('app_config').select('value').eq('key', 'last_brief_items').maybeSingle();
  let map: { n: number; key: string; title: string }[] = [];
  try { map = JSON.parse((cfg?.value as string) || '[]'); } catch { /* ignore */ }
  const expires = new Date(Date.now() + 14 * 86400_000).toISOString();
  const cleared: string[] = []; const notFound: number[] = [];
  for (const n of numbers) {
    const item = map.find((m) => m.n === n);
    if (!item) { notFound.push(n); continue; }
    await supabaseLogistics.from('agent_dismissals').upsert(
      { key: item.key, note: note || null, created_at: new Date().toISOString(), expires_at: expires },
      { onConflict: 'key' });
    if (item.key.startsWith('mail:')) {
      await supabaseLogistics.from('gmail_insights').update({ dismissed: true }).eq('source_key', item.key.slice(5));
    }
    cleared.push(item.title);
  }
  return { cleared, not_found: notFound };
}

export async function getActionCenter(): Promise<Action[]> {
  const [restock, recsAU, pouches, custom, lots, billing, gmail] = await Promise.all([
    suggestRestock('MANCHESTER').catch(() => null),
    getReorderRecommendations('ALTONA').catch(() => []),
    getPouchTracking().catch(() => []),
    getCustomPackaging().catch(() => []),
    getShortestDated(60).catch(() => []),
    getBillingData().catch(() => ({ monthly: [], invoices: [], outliers: [] } as any)),
    getGmailInsights().catch(() => []),
  ]);

  const actions: Action[] = [];

  // 0. Inbox-driven jobs needing action (from the daily Gmail scour)
  for (const g of gmail.filter((x) => x.needs_action)) {
    actions.push({
      key: `mail:${g.source_key}`,
      severity: 'warning',
      title: g.category === 'abc' ? 'ABC update' : g.category === 'maersk' ? 'Maersk update' : g.category === 'shipbob' ? 'ShipBob update' : 'Inbox',
      detail: g.summary,
      command: g.action || 'open the relevant thread',
      href: '/logistics/stock',
      count: 1,
    });
  }

  // 1. UK transfers due (90-day trigger, Altona-capped)
  if (restock && restock.lines.length) {
    actions.push({
      key: 'transfer',
      severity: 'critical',
      title: 'UK transfer due',
      detail: `${restock.lines.length} SKU${restock.lines.length === 1 ? '' : 's'} under ${restock.trigger_days}d cover at Manchester — ~${restock.total_units.toLocaleString()} units Altona can send`,
      command: 'build a transfer for everything Manchester is low on',
      href: '/logistics/transfers',
      count: restock.lines.length,
    });
  }

  // 2. Altona POs to place
  if (recsAU.length) {
    const units = recsAU.reduce((s, r) => s + r.recommend_units, 0);
    actions.push({
      key: 'po',
      severity: recsAU.some((r) => (r.days_of_cover ?? 99) <= 0) ? 'critical' : 'warning',
      title: 'ABC purchase order due',
      detail: `${recsAU.length} SKU${recsAU.length === 1 ? '' : 's'} need reordering at Altona — ~${units.toLocaleString()} units`,
      command: 'what should I order from ABC, and draft the PO',
      href: '/logistics/purchase-orders#suggested',
      count: recsAU.length,
    });
  }

  // 3. Packaging reorders (pouches + custom)
  const pouchAlerts = pouches.filter((p) => p.status === 'order_now' || p.status === 'order_soon');
  const customAlerts = custom.filter((c) => c.status === 'order_now' || c.status === 'order_soon');
  const packCount = pouchAlerts.length + customAlerts.length;
  if (packCount) {
    actions.push({
      key: 'packaging',
      severity: pouchAlerts.some((p) => p.status === 'order_now') || customAlerts.some((c) => c.status === 'order_now') ? 'critical' : 'warning',
      title: 'Packaging to reorder',
      detail: [pouchAlerts.length && `${pouchAlerts.length} pouch SKU${pouchAlerts.length === 1 ? '' : 's'}`, customAlerts.length && `${customAlerts.length} custom item${customAlerts.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
      command: 'what packaging do I need to reorder',
      href: '/logistics/packaging',
      count: packCount,
    });
  }

  // 4. Expiring stock (<90 days, on hand)
  const expiring = lots.filter((l) => l.on_hand > 0 && l.days_left != null && expiryStatus(l.days_left) !== 'ok');
  if (expiring.length) {
    const soonest = expiring[0];
    actions.push({
      key: 'expiry',
      severity: expiring.some((l) => (l.days_left ?? 99) < 30) ? 'critical' : 'warning',
      title: 'Stock nearing best-before',
      detail: `${expiring.length} batch${expiring.length === 1 ? '' : 'es'} < 3 months — soonest ${soonest.flavour ?? soonest.sku} (${soonest.days_left}d)`,
      command: 'what stock is expiring soonest',
      href: '/logistics/batches',
      count: expiring.length,
    });
  }

  // 5. Billing flags (over-median exposure + unpaid invoices)
  const highlights = buildHighlights(billing.monthly, billing.invoices, billing.outliers);
  const overSites = highlights.filter((h) => h.outlierExposure > 0);
  const unpaid = highlights.reduce((s, h) => s + h.unpaidCount, 0);
  if (overSites.length || unpaid) {
    const bits: string[] = [];
    for (const h of overSites) bits.push(`${money(h.outlierExposure, SITE_CCY[h.site])} over-median (${h.site})`);
    if (unpaid) bits.push(`${unpaid} unpaid invoice${unpaid === 1 ? '' : 's'}`);
    actions.push({
      key: 'billing',
      severity: 'info',
      title: 'Billing to review',
      detail: bits.join(' · '),
      command: 'show me the shipping cost outliers and any unpaid invoices',
      href: '/logistics/shipping',
      count: overSites.reduce((s, h) => s + h.outlierCount, 0) + unpaid,
    });
  }

  // drop anything the founder has already marked done from the brief
  const dismissed = await activeDismissals().catch(() => new Set<string>());
  const live = actions.filter((a) => !dismissed.has(a.key));

  const order: Severity[] = ['critical', 'warning', 'info'];
  return live.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}
