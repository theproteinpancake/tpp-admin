import { NextRequest, NextResponse } from 'next/server';
import { setConfig } from '@/lib/settings';

const ALLOWED = new Set(['admin_email']);

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.key || !ALLOWED.has(b.key)) return NextResponse.json({ error: 'bad key' }, { status: 400 });
  await setConfig(b.key, String(b.value ?? '').trim());
  return NextResponse.json({ ok: true });
}
