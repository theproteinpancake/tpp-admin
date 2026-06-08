import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';

// Dismiss an Action Center card by its key — PERMANENTLY. It won't return to the Action
// Center or the daily WhatsApp briefing (both read agent_dismissals). The job is still
// actionable by asking the agent directly. expires_at = null means it never expires.
export async function POST(req: NextRequest) {
  const { key } = await req.json().catch(() => ({}));
  if (!key || typeof key !== 'string') return NextResponse.json({ error: 'key required' }, { status: 400 });
  try {
    await supabaseLogistics.from('agent_dismissals').upsert(
      { key, note: 'dismissed from dashboard', created_at: new Date().toISOString(), expires_at: null },
      { onConflict: 'key' });
    if (key.startsWith('mail:')) await supabaseLogistics.from('gmail_insights').update({ dismissed: true }).eq('source_key', key.slice(5));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 160) }, { status: 500 });
  }
}
