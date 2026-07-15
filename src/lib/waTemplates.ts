// Definitions for our proactive WhatsApp templates (Twilio Content API → Meta approval).
// Each delivers OUTSIDE the 24h window. Variable VALUES must be single-line (WhatsApp rejects
// newlines/tabs inside a variable), so multi-line layout lives in the fixed body text and each
// {{n}} carries one packed single-line value. Bodies start+end with fixed text and keep plenty
// of fixed wording so Meta's "too many variables for its length" rule passes.
import { twilioAuthHeader } from './whatsapp';
import { getConfig, setConfig } from './settings';

const CONTENT_API = 'https://content.twilio.com/v1/Content';

export type WaTemplate = { key: string; body: string; sample: Record<string, string>; buttons?: string[] };

export const TEMPLATES: WaTemplate[] = [
  {
    // Generic tappable quick-reply confirmations (DHL-style buttons) — body + button labels are
    // all variables so ONE content resource covers every confirmation. Tapping a button sends
    // its exact label back as the message body: deterministic, no "yes" interpretation.
    key: 'tpp_buttons_2',
    body: '{{1}}',
    buttons: ['{{2}}', '{{3}}'],
    sample: { '1': 'WRO 975246 created ✅ Want me to draft the reply to Sharon with the labels attached?', '2': 'Draft Sharon reply', '3': 'Not now' },
  },
  {
    key: 'tpp_buttons_3',
    body: '{{1}}',
    buttons: ['{{2}}', '{{3}}', '{{4}}'],
    sample: { '1': 'Draft ready. To: Amanda (VISY). Send the PANLARGE order email?', '2': 'Send it', '3': 'Edit first', '4': 'Cancel' },
  },
  {
    key: 'tpp_sales_review',
    body: 'TPP sales review 🥞 — {{1}}\n\nOnline & orders: {{2}}\nWholesale & total: {{3}}\nMeta (ROAS/CPA/NC): {{4}}\nNet profit: {{5}}\n\nFull breakdown in the dashboard.',
    sample: { '1': 'Daily · Mon 9 Jun', '2': '$21,537 · 251 orders · AOV $85.80', '3': '$1,889 wholesale · $23,426 total', '4': 'ROAS 3.06× · CPA $28.11 · NC ROAS 1.80× · NC CPA $44.92', '5': '$286' },
  },
  {
    // Utility-worded twin of tpp_sales_review: Meta re-categorised the original as MARKETING
    // (revenue wording trips its classifier) and its per-user marketing cap silently dropped
    // sends (63049). This one is phrased as a scheduled operational account report.
    key: 'tpp_daily_report',
    body: 'TPP account report — {{1}}\n\nOrders processed: {{2}}\nAccount totals: {{3}}\nAd account performance: {{4}}\nNet position: {{5}}\n\nThis is your scheduled account report. Reply to query any line.',
    sample: { '1': 'Daily · Mon 9 Jun', '2': '$21,537 · 251 orders · AOV $85.80', '3': '$1,889 wholesale · $23,426 total', '4': 'ROAS 3.06× · CPA $28.11 · NC ROAS 1.80× · NC CPA $44.92', '5': '$286' },
  },
  {
    key: 'tpp_logistics_brief',
    body: '🥞 *Logistics overview* — {{1}}\n\n🇦🇺 *AU stock*\n{{2}}\n\n🇬🇧 *UK stock*\n{{3}}\n\n🚢 *UK transfer*\n{{4}}\n\n📦 *Outstanding inbound*\n{{5}}\n\n💸 *Fulfilment watch*\n{{6}}\n\n_Reply to action anything._',
    sample: { '1': 'Tuesday, 9 June', '2': 'Buttermilk OOS (+1T in) · Maple 53d · GF Buttermilk 58d · Cinnamon 117d', '3': 'Maple 40d · Buttermilk 22d (+inbound) · Cinnamon 60d', '4': 'INTERNAL2 — awaiting customs clearance, ETA this week', '5': 'April Maple+Cinnamon · May Buttermilk 1T · GF Buttermilk May 1T', '6': 'New $99 fulfilment charge yesterday — worth a check' },
  },
  {
    key: 'tpp_stock_received',
    body: '📦 Stock received at {{1}}\n\nShipment: {{2}}\nStatus: {{3}}\n\nReply if anything looks off.',
    sample: { '1': 'Altona (AU)', '2': 'PO 1042 — Buttermilk 1T (BMM), GF Buttermilk (GFBM)', '3': "Received into ShipBob — I've marked the PO as received ✓" },
  },
  {
    key: 'tpp_followup',
    body: '⏰ *Follow-up* — {{1}}\n\n{{2}}\n\nReply "done", "snooze a day", or tell me what to do next and I\'ll handle it.',
    sample: { '1': 'Friday, 13 June', '2': 'Chase mycustomsuk (Izabela) — no customs update on INTERNAL2 since Tuesday.' },
  },
  {
    key: 'tpp_system_alert',
    body: '🚨 *TPP system check* — {{1}}\n\nWhat needs attention: {{2}}\n\nDetails: {{3}}\n\nReply here and I\'ll dig into it, or check the dashboard logs.',
    sample: { '1': 'Wednesday, 10 June', '2': 'The 7am sales review did not run', '3': 'Last successful run was 26 hours ago — the cron or the route may be failing.' },
  },
  {
    key: 'tpp_wholesale_brief',
    body: '🛒 *Wholesale brief* — {{1}}\nMorning Kate! ☀️\n\n💵 *Sales*\n{{2}}\n\n📞 *Expect / chase a PO from*\n{{3}}\n\n🥞 *320g stock — Altona*\n{{4}}\n\n🤝 *Marketing*\n{{5}}\n\nForward me a PO, an influencer\'s details or a collab chat and I\'ll handle it. 💪',
    sample: { '1': 'Tuesday, 9 June', '2': 'Yesterday $0 (0 orders) · Last week (1–7 Jun) $1,889 · Month $1,889', '3': 'WholeLife Barr St (125d overdue) · LaManna South Yarra (66d) · Nutrition Warehouse Bendigo (42d)', '4': 'Buttermilk 0 (0d 🔴) · Maple 77 (53d) · GF Buttermilk 75 (58d) · Cinnamon 218 (117d)', '5': 'Next collab: none upcoming · Likely to post: —' },
  },
  {
    key: 'tpp_wholesale_reply',
    body: '↩️ *{{1}} replied* about their out-of-stock order\n\n"{{2}}"\n\nNext step: {{3}}\nReply to action.',
    sample: { '1': 'Highland Evolution', '2': 'Yes please swap the buttermilk for maple and send the rest now', '3': "Confirm the swap, then reply 'process Highland' and I'll update the order." },
  },
  {
    key: 'tpp_transfer_update',
    body: '🚢 Transfer update — {{1}}\n\n{{2}}\n\nNext step: {{3}}\nReply to action.',
    sample: { '1': 'INTERNAL2', '2': 'Maersk has cleared the pallet through customs; delivery ETA this week and they\'re requesting a booking slot.', '3': "Confirm the delivery slot, then I'll watch for the ShipBob receiving." },
  },
];

const cfgKey = (k: string) => `template:${k}`;

export async function getTemplateSid(key: string): Promise<string | null> {
  return getConfig(cfgKey(key));
}

// Create a Content template + submit it for WhatsApp approval; store the ContentSid.
export async function createTemplate(t: WaTemplate): Promise<{ key: string; content_sid?: string; submitted?: boolean; error?: string; approval?: any }> {
  const auth = twilioAuthHeader();
  if (!auth) return { key: t.key, error: 'twilio creds missing' };
  const name = `${t.key}_${Date.now().toString(36)}`; // WhatsApp names must be unique in the WABA
  const types: Record<string, unknown> = t.buttons?.length
    ? {
        // quick-reply renders tappable buttons on WhatsApp; text fallback for other channels
        'twilio/quick-reply': { body: t.body, actions: t.buttons.map((b, i) => ({ title: b, id: `b${i + 1}` })) },
        'twilio/text': { body: t.body },
      }
    : { 'twilio/text': { body: t.body } };
  const createRes = await fetch(CONTENT_API, {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ friendly_name: name, language: 'en', variables: t.sample, types }),
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !(created as any)?.sid) return { key: t.key, error: `create failed ${createRes.status}: ${JSON.stringify(created).slice(0, 160)}` };
  const contentSid = (created as any).sid as string;
  const approvalRes = await fetch(`${CONTENT_API}/${contentSid}/ApprovalRequests/whatsapp`, {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, category: 'UTILITY' }),
  });
  const approval = await approvalRes.json().catch(() => ({}));
  await setConfig(cfgKey(t.key), contentSid);
  return { key: t.key, content_sid: contentSid, submitted: approvalRes.ok, approval };
}

export async function templateStatus(key: string): Promise<any> {
  const auth = twilioAuthHeader();
  const sid = await getTemplateSid(key);
  if (!auth || !sid) return { key, configured: !!sid };
  const res = await fetch(`${CONTENT_API}/${sid}/ApprovalRequests`, { headers: { Authorization: auth } });
  const j = await res.json().catch(() => ({}));
  return { key, content_sid: sid, status: (j as any)?.whatsapp?.status ?? null, rejection: (j as any)?.whatsapp?.rejection_reason || undefined };
}
