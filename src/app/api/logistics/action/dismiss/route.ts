import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';

// Dismiss an Action Center card by its key. Inbox (mail:) items are cleared permanently;
// aggregate logistics cards are suppressed for 7 days (they re-surface if still relevant).
export async function POST(req: NextRequest) {
  const { key } = await req.json().catch(() => ({}));
  if (!key || typeof key !== 'string') return NextResponse.json({ error: 'key required' }, { status: 400 });
  const isMail = key.startsWith('mail:');
  const expires = isMail ? null : new Date(Date.now() + 7 * 86400_000).toISOString();
  try {
    await supabaseLogistics.from('agent_dismissals').upsert(
      { key, note: 'dismissed from dashboard', created_at: new Date().toISOString(), expires_at: expires },
      { onConflict: 'key' });
    if (isMail) await supabaseLogistics.from('gmail_insights').update({ dismissed: true }).eq('source_key', key.slice(5));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 160) }, { status: 500 });
  }
}
