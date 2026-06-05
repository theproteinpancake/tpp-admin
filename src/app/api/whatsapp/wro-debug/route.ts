import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

// TEMP: probe each ShipBob label endpoint for a WRO and report size + page count,
// so we can see which returns the full box-label PDF (with the QR page).
// GET /api/whatsapp/wro-debug?secret=...&id=955021&site=ALTONA
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = searchParams.get('id');
  const site = (searchParams.get('site') || 'ALTONA').toUpperCase();
  const token = site === 'MANCHESTER' ? process.env.SHIPBOB_API_TOKEN_UK : process.env.SHIPBOB_API_TOKEN;
  const urls = [
    `https://api.shipbob.com/2026-01/receiving/${id}/box-labels`,
    `https://api.shipbob.com/2025-07/receiving/${id}/box-labels`,
    `https://api.shipbob.com/2024-07/receiving/${id}/box-labels`,
    `https://api.shipbob.com/2.0/receiving/${id}/labels`,
    `https://api.shipbob.com/1.0/receiving/${id}/labels`,
  ];
  const out: any[] = [];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } });
      const row: any = { url: url.replace('https://api.shipbob.com', ''), status: r.status, ct: r.headers.get('content-type') };
      if (r.ok) {
        const s = Buffer.from(await r.arrayBuffer()).toString('latin1');
        row.bytes = s.length;
        row.isPdf = s.slice(0, 4) === '%PDF';
        row.pages = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
        const cnt = s.match(/\/Count\s+(\d+)/);
        if (cnt) row.countField = Number(cnt[1]);
        if (!row.isPdf) row.snippet = s.slice(0, 140);
      } else {
        row.snippet = (await r.text()).slice(0, 140);
      }
      out.push(row);
    } catch (e) { out.push({ url, error: String(e).slice(0, 120) }); }
  }
  return NextResponse.json({ id, site, out });
}
