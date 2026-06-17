// VISY order tracker: scans the inbox for emails from VISY (Amanda Eastley) and advances each
// open visy_orders row — confirmed → dispatched → delivered — plus flags invoices/queries.
// Proactively pings Luke on meaningful changes. Runs from the hourly gmail scour cron.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { gmailSearch } from './google';
import { sendWhatsApp, allowedNumbers, senderRole } from './whatsapp';
import { recordProactiveContext } from './stockAgent';

const MODEL = 'claude-sonnet-4-6';
const VISY_QUERY = 'from:(visy.com OR visy.com.au) newer_than:30d';
// fulfilment stages — status only ever moves forward
const RANK: Record<string, number> = { drafted: 0, ordered: 1, confirmed: 2, dispatched: 3, delivered: 4 };

function parseJson(out: string): any {
  try { return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { return { updates: [] }; }
}

export async function runVisyScour(): Promise<{ scanned: number; updated: number; notified: number; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { scanned: 0, updated: 0, notified: 0, error: 'no api key' };

  let hits: Awaited<ReturnType<typeof gmailSearch>>;
  try { hits = await gmailSearch(VISY_QUERY, 15); } catch { return { scanned: 0, updated: 0, notified: 0 }; }
  if (!hits.length) return { scanned: 0, updated: 0, notified: 0 };

  const { data: seenRows } = await supabaseLogistics.from('visy_email_seen').select('message_id');
  const seen = new Set((seenRows ?? []).map((r: any) => r.message_id));
  const fresh = hits.filter((h) => !seen.has(h.id));
  if (!fresh.length) return { scanned: hits.length, updated: 0, notified: 0 };

  const { data: orderData } = await supabaseLogistics.from('visy_orders')
    .select('*').not('status', 'in', '("delivered","cancelled")').order('ordered_at', { ascending: false });
  const openOrders = (orderData ?? []) as any[];
  const orderList = openOrders.length
    ? openOrders.map((o, i) => `${i + 1}. code=${o.visy_code} item="${o.item}" qty=${o.qty} dest=${o.destination} status=${o.status} subject="${o.subject}"`).join('\n')
    : '(no open orders on file)';

  const client = new Anthropic({ apiKey });
  const emailList = fresh.map((e, i) => `${i + 1}. ${e.date} — ${e.from}\n   Subject: ${e.subject}\n   ${e.snippet}`).join('\n');
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 1200,
    system: `You track VISY packaging orders for The Protein Pancake. VISY (Amanda Eastley) supplies our cartons (SRP shelf-ready cartons + shipping cartons). We email orders titled "NEW ORDER - <code>"; VISY replies with order confirmations, dispatch/collection notices, delivery confirmations and invoices.
OPEN ORDERS (match emails to these):
${orderList}
For EACH email below decide if it's an update on one of our orders and the new status.
Match by: the VISY product code (e.g. VP54448, PANSMALL), the order subject ("NEW ORDER - X" / "Re: NEW ORDER - X"), or the item/flavour. status: "confirmed" (acknowledged / in production), "dispatched" (shipped / collected / on the way / tracking given), "delivered" (arrived / delivered), "invoiced" (an invoice is attached/announced), "query" (VISY needs something from us), "other" (not an order update — ignore).
Ignore auto-replies, out-of-office and marketing. notify=true ONLY for dispatched, delivered, invoiced or query (things Luke should know now).
Return ONLY JSON: {"updates":[{"email_index":<n>,"order_index":<matching open-order number or null>,"visy_code":"<code or null>","status":"confirmed|dispatched|delivered|invoiced|query|other","eta":"YYYY-MM-DD or null","summary":"<=120 char","notify":true|false}]}`,
    messages: [{ role: 'user', content: emailList }],
  });
  const out = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  const updates: any[] = parseJson(out).updates ?? [];

  const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
  let updated = 0, notified = 0;

  for (const u of updates) {
    const status = String(u.status || 'other');
    if (status === 'other') continue;
    // resolve the order: explicit index, else by visy_code among open orders
    let order = u.order_index ? openOrders[Number(u.order_index) - 1] : null;
    if (!order && u.visy_code) order = openOrders.find((o) => (o.visy_code || '').toLowerCase() === String(u.visy_code).toLowerCase());

    if (order) {
      const patch: Record<string, unknown> = { last_update: String(u.summary || '').slice(0, 200), last_email_at: new Date().toISOString() };
      if (u.eta) patch.eta = u.eta;
      // advance fulfilment stage forward only; invoiced/query don't regress the stage
      if (RANK[status] != null && RANK[status] > (RANK[order.status] ?? 0)) patch.status = status;
      await supabaseLogistics.from('visy_orders').update(patch).eq('id', order.id).then(() => {}, () => {});
      updated++;
    }

    if (u.notify) {
      const tag = order ? `${order.item}${order.visy_code ? ` (${order.visy_code})` : ''}` : (u.visy_code || 'VISY order');
      const emoji = status === 'delivered' ? '📦✅' : status === 'dispatched' ? '🚚' : status === 'invoiced' ? '🧾' : status === 'query' ? '❓' : '📦';
      const dest = order?.destination === 'ALTONA' ? ' → ShipBob Altona' : order?.destination === 'ABC' ? ' → ABC' : '';
      const msg = `${emoji} *VISY update* — ${tag}${dest}\n${u.summary || ''}${u.eta ? `\nETA: ${u.eta}` : ''}${status === 'dispatched' && order?.destination === 'ALTONA' ? `\n(ShipBob will receive it against WRO ${order.wro_id || '—'}.)` : ''}`;
      for (const to of owners) {
        if (await sendWhatsApp(to, msg).catch(() => false)) {
          notified++;
          await recordProactiveContext(to, `VISY order update I just flagged: ${tag} is now ${status}. ${u.summary || ''}`).catch(() => {});
        }
      }
    }
  }

  // mark every fresh email processed (so we don't re-handle next run)
  await supabaseLogistics.from('visy_email_seen').upsert(fresh.map((h) => ({ message_id: h.id })), { onConflict: 'message_id' }).then(() => {}, () => {});
  return { scanned: hits.length, updated, notified };
}
