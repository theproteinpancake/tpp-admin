import { ImageResponse } from 'next/og';
import { stockImageToken, FLAVOUR_IMG, SKU_IMG } from '@/lib/stockImage';
import { getLots, expiryStatus, EXPIRY_META } from '@/lib/lots';

export const runtime = 'nodejs';

// Expiry / best-before card for WhatsApp — same dashboard styling as the stock card:
// soonest-dated lots first, product shot, lot number, best-before, units on hand
// (320g in cartons of 4) and a colour-coded days-left pill. Token-guarded like its sibling.
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('k') !== stockImageToken()) return new Response('not found', { status: 404 });
  const site = (url.searchParams.get('site') || 'ALTONA').toUpperCase();
  const origin = process.env.PUBLIC_APP_URL || `${url.protocol}//${url.host}`;

  const all = await getLots();
  const lots = all
    .filter((l) => l.site === site && l.expiry_date && l.on_hand > 0)
    .slice(0, 12);
  if (!lots.length) return new Response('no lot data', { status: 404 });

  const sizeLabel = (g: number | null) => (g == null ? '' : g >= 1000 ? ` ${g / 1000}kg` : ` ${g}g`);
  const fmtDate = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' });
  const qtyStr = (l: any) => (l.unit_size_g === 320 ? `${Math.round(l.on_hand / 4).toLocaleString('en-AU')} ctn` : `${Number(l.on_hand).toLocaleString('en-AU')} u`);
  const imgFor = (l: any) => (l.flavour && FLAVOUR_IMG[l.flavour]) || SKU_IMG[l.sku] || null;
  const dateStr = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', timeZone: 'Australia/Melbourne' });
  const rowH = 74;
  const height = 210 + lots.length * rowH + 60;

  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#FFF8E7', padding: 44, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 38, fontWeight: 800, color: '#8B4513' }}>Best-Before — {site === 'ALTONA' ? 'Altona (AU)' : 'Manchester (UK)'}</span>
            <span style={{ fontSize: 22, color: '#6b7280', marginTop: 4 }}>lots in stock, soonest expiry first · {dateStr}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 14, background: '#C4814A', fontSize: 36 }}>🥞</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 26, background: 'white', borderRadius: 16, padding: 6 }}>
          <div style={{ display: 'flex', padding: '10px 18px', fontSize: 17, color: '#9ca3af' }}>
            <span style={{ flex: 1 }}>Product</span>
            <span style={{ width: 170, textAlign: 'right' }}>Lot</span>
            <span style={{ width: 150, textAlign: 'right' }}>Best before</span>
            <span style={{ width: 120, textAlign: 'right' }}>On hand</span>
            <span style={{ width: 150, textAlign: 'right' }}>Days left</span>
          </div>
          {lots.map((l, i) => {
            const st = expiryStatus(l.days_left);
            const img = imgFor(l);
            return (
              <div key={i} style={{ display: 'flex', padding: '8px 18px', borderTop: '1px solid #f3f4f6', alignItems: 'center', height: rowH }}>
                {img
                  ? <img src={`${origin}/products/${img}`} width={48} height={48} style={{ borderRadius: 9, objectFit: 'contain' }} />
                  : <div style={{ display: 'flex', width: 48, height: 48, borderRadius: 9, background: '#f3f4f6' }} />}
                <span style={{ flex: 1, fontSize: 22, fontWeight: 600, color: '#111827', marginLeft: 14 }}>{l.flavour || l.sku}{sizeLabel(l.unit_size_g)}</span>
                <span style={{ width: 170, textAlign: 'right', fontSize: 19, color: '#6b7280' }}>{l.lot_number}</span>
                <span style={{ width: 150, textAlign: 'right', fontSize: 21, color: '#111827' }}>{fmtDate(l.expiry_date!)}</span>
                <span style={{ width: 120, textAlign: 'right', fontSize: 21, color: '#111827' }}>{qtyStr(l)}</span>
                <div style={{ display: 'flex', width: 150, justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'white', background: EXPIRY_META[st].bg, borderRadius: 999, padding: '4px 14px' }}>
                    {l.days_left != null ? `${l.days_left}d` : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', marginTop: 18, fontSize: 17, color: '#9ca3af', gap: 24, alignItems: 'center' }}>
          {(['critical', 'warning', 'ok'] as const).map((k) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ display: 'flex', width: 12, height: 12, borderRadius: 6, background: EXPIRY_META[k].bg }} />
              <span>{EXPIRY_META[k].label}</span>
            </div>
          ))}
          <span>320g on-hand is cartons of 4</span>
        </div>
      </div>
    ),
    { width: 1080, height },
  );
}
