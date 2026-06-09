import { NextRequest, NextResponse } from 'next/server';
import { TEMPLATES, createTemplate, templateStatus, getTemplateSid } from '@/lib/waTemplates';

export const maxDuration = 60;

// Manage proactive WhatsApp templates. GET → approval status of all. POST → create + submit any
// not yet created (or all with ?force=1). Optional ?key=<name> to target one. Cron-secret guarded.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const only = url.searchParams.get('key');
  const force = !!url.searchParams.get('force');
  const list = only ? TEMPLATES.filter((t) => t.key === only) : TEMPLATES;

  if (req.method === 'GET') {
    const statuses = await Promise.all(list.map((t) => templateStatus(t.key)));
    return NextResponse.json({ ok: true, templates: statuses });
  }

  const results: any[] = [];
  for (const t of list) {
    const existing = await getTemplateSid(t.key);
    if (existing && !force) { results.push({ key: t.key, already: true, content_sid: existing }); continue; }
    results.push(await createTemplate(t));
  }
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
