// CDS clearance workflow (playbook: cds-clearance): when Maersk confirms a UK transfer has
// cleared customs, the CDS form must reach ShipBob Manchester's receiving team DIRECTLY via
// appointments@shipbob.com quoting the WRO number — the merchant-care relay loses it and the
// pallet sits undelivered (INTERNAL2 delay). Scour detects the clearance email, pulls the CDS
// PDF off it, drafts the email, and WhatsApps the owner for approval (send_email_draft).
import { supabaseLogistics } from './supabase-logistics';
import { gmailSearch, gmailGetBody, gmailGetAllAttachments, gmailCreateDraft } from './google';
import { sendWhatsApp, sendWhatsAppButtons, allowedNumbers, senderRole } from './whatsapp';
import { recordProactiveContext } from './stockAgent';

const SHIPBOB_APPOINTMENTS = 'appointments@shipbob.com';
const CLEARED_RE = /customs\s+(clear|releas)|clear(ed)?\s+(uk\s+)?customs|released?\s+by\s+customs|customs\s+status[:\s]+released/i;
const CDS_FILE_RE = /cds|customs|declaration|clearance|entry|import/i;

export async function runCdsScour(): Promise<{ checked: number; drafted: string[]; notes: string[] }> {
  const notes: string[] = [];
  const drafted: string[] = [];
  const hits = await gmailSearch('from:maersk.com newer_than:3d', 10).catch(() => []);
  for (const h of hits) {
    try {
      const subject = h.subject || '';
      const body = await gmailGetBody(h.id).catch(() => '');
      const text = `${subject}\n${body}`;
      const atts = await gmailGetAllAttachments(h.id).catch(() => []);
      const pdfs = atts.filter((a) => /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.filename));
      const cdsNamed = pdfs.filter((a) => CDS_FILE_RE.test(a.filename));
      const cleared = CLEARED_RE.test(text) || cdsNamed.length > 0;
      if (!cleared) continue;

      // Which transfer? Reference in the email, else BL match against open transfers.
      const refMatch = text.match(/INTERNAL\s*-?\s*(\d+)/i);
      const reference = refMatch ? `INTERNAL${refMatch[1]}` : null;
      let q = supabaseLogistics.from('internal_transfers')
        .select('id, reference, bl_ref, shipbob_wro_id, cds_draft_id, cds_emailed_at, status')
        .not('status', 'in', '("received","cancelled")');
      const { data: open } = await q;
      const transfers = (open ?? []) as any[];
      const t = reference
        ? transfers.find((x) => (x.reference || '').toUpperCase() === reference)
        : transfers.find((x) => x.bl_ref && text.toUpperCase().includes(String(x.bl_ref).toUpperCase()));
      if (!t) { notes.push(`Maersk clearance-looking email "${subject.slice(0, 60)}" matched no open transfer`); continue; }
      if (t.cds_draft_id || t.cds_emailed_at) continue; // already handled — never double-send

      const attachments = (cdsNamed.length ? cdsNamed : pdfs).slice(0, 3)
        .map((a) => ({ filename: a.filename || 'CDS.pdf', base64: a.base64 }));
      const wro = t.shipbob_wro_id ? `WRO ${t.shipbob_wro_id}` : null;
      const subjectLine = `CDS form — ${[wro, t.reference, t.bl_ref ? `BL ${t.bl_ref}` : null].filter(Boolean).join(' — ')}`;
      const emailBody = [
        'Hi team,',
        '',
        `Please find attached the customs clearance (CDS) paperwork for our inbound pallet${wro ? ` on ${wro}` : ''} (${t.reference}${t.bl_ref ? `, BL ${t.bl_ref}` : ''}).`,
        'Customs has cleared — could you please schedule receiving for this delivery.',
        '',
        'Thanks!',
        'Luke Rolls | The Protein Pancake',
      ].join('\n');

      const draftId = await gmailCreateDraft(SHIPBOB_APPOINTMENTS, subjectLine, emailBody, attachments.length ? attachments : undefined);
      await supabaseLogistics.from('internal_transfers').update({ cds_draft_id: draftId }).eq('id', t.id);
      drafted.push(t.reference);

      // Tell the owner + park the approve-to-send context for the agent.
      const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
      const summary = `🛃 ${t.reference} cleared UK customs (Maersk email: "${subject.slice(0, 70)}"). I've drafted the CDS email to ShipBob's receiving team (${SHIPBOB_APPOINTMENTS})${wro ? `, quoting ${wro}` : ' — ⚠️ no WRO on record, add it before sending'}${attachments.length ? `, with ${attachments.length} PDF${attachments.length > 1 ? 's' : ''} attached` : ' — ⚠️ no CDS PDF found on the email, attach manually'}. Tap *Send CDS email* to fire.`;
      for (const to of owners) {
        const ok = !!(await sendWhatsApp(to, summary));
        if (ok) await sendWhatsAppButtons(to, 'Tap an option 👇', ['Send CDS email', 'Hold off']).catch(() => false);
        if (ok) await recordProactiveContext(to, `PENDING CDS EMAIL — ${t.reference} cleared customs and the CDS email to ${SHIPBOB_APPOINTMENTS} is drafted (draft_id="${draftId}"). If the user approves (a "Send CDS email" tap, or send / send it / yes / go), call send_email_draft with draft_id="${draftId}" IMMEDIATELY ("Hold off" = leave the draft parked) — do NOT re-draft. After a confirmed send, also call update_transfer_status only if they separately ask; the CDS send itself needs no status change.`).catch(() => {});
      }
    } catch (e) { notes.push(`CDS scour error on "${(h.subject || '').slice(0, 50)}": ${String(e).slice(0, 100)}`); }
  }
  return { checked: hits.length, drafted, notes };
}

// Flip drafted → emailed when the CDS draft is actually sent (called from send_email_draft).
export async function markCdsSent(draftId: string): Promise<boolean> {
  if (!draftId) return false;
  const { data } = await supabaseLogistics.from('internal_transfers')
    .update({ cds_emailed_at: new Date().toISOString() })
    .eq('cds_draft_id', draftId).is('cds_emailed_at', null).select('reference');
  return !!(data && data.length);
}
