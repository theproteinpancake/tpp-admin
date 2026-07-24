import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { getTemplateSid } from '@/lib/waTemplates';
import { sendWhatsApp, sendWhatsAppTemplate } from '@/lib/whatsapp';
import { recordProactiveContext } from '@/lib/stockAgent';
import { melbLongDate } from '@/lib/tz';
import { repairReviewDelivery } from '@/lib/analyticsBrief';

export const maxDuration = 60;

// Fires due agent follow-ups (every 15 min via cron). Each ping is recorded into the agent's
// memory so a reply like "done" or "snooze a day" is actionable.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: due } = await supabaseLogistics.from('agent_followups')
    .select('*').eq('status', 'pending').lte('due_at', new Date().toISOString()).limit(10);
  const sid = await getTemplateSid('tpp_followup');
  let sent = 0;
  for (const f of (due ?? []) as any[]) {
    let ok = false;
    if (sid) ok = await sendWhatsAppTemplate(f.phone, sid, { '1': melbLongDate(), '2': String(f.message).replace(/\s+/g, ' ').slice(0, 550) });
    if (!ok) ok = !!(await sendWhatsApp(f.phone, `⏰ *Follow-up*\n\n${f.message}\n\nReply "done", "snooze a day", or tell me what to do next.`));
    if (ok) {
      sent++;
      await supabaseLogistics.from('agent_followups').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', f.id);
      await recordProactiveContext(f.phone, `I just sent the user this FOLLOW-UP reminder (id ${f.id}): "${f.message}".${f.context ? ` Context: ${f.context}` : ''} If they reply "done" it's handled (nothing to cancel — it already fired); "snooze a day" → schedule_followup again for tomorrow with the same message; otherwise act on their instruction.`).catch(() => {});
    }
  }
  // Safety net: if today's sales review died in WhatsApp (all copies undelivered), email it.
  const reviewRepair = await repairReviewDelivery().catch((e) => ({ repaired: false, reason: String(e).slice(0, 100) }));
  return NextResponse.json({ ok: true, due: (due ?? []).length, sent, review_repair: reviewRepair });
}

export const GET = handle;
export const POST = handle;
