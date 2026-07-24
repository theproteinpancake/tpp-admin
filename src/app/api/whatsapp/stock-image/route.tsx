import { ImageResponse } from 'next/og';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { getInventoryLevels } from '@/lib/shipbob';
import { stockImageToken, FLAVOUR_IMG, SKU_IMG } from '@/lib/stockImage';

export const runtime = 'nodejs';

// Dashboard-styled stock card for WhatsApp (the "PO draft screenshot" treatment for stock
// updates): one row per flavour with its pouch shot, live availability per size. 320g is
// shown in CARTONS of 4 — including inbound (po_items store pouches; ÷4 here) — because
// that's the unit Kate and ShipBob think in. Guarded by a static token derived from
// CRON_SECRET (same public-by-obscurity model as the PO image, which Twilio must fetch).
// Syrup + accessories ("Other products" section, full card only) — photo + short label by SKU.
const OTHER_PRODUCTS: { sku: string; label: string; img: string }[] = [
  { sku: 'MSS', label: 'Maple Syrup (single)', img: SKU_IMG.MSS },
  { sku: 'MSS8', label: 'Maple Syrup (ctn of 8)', img: SKU_IMG.MSS8 },
  { sku: 'ACCP', label: 'The Pancake Pan', img: SKU_IMG.ACCP },
  { sku: 'ACCF', label: 'The Flipper', img: SKU_IMG.ACCF },
  { sku: 'ACCS', label: 'The Scraper', img: SKU_IMG.ACCS },
  { sku: 'TWM', label: 'The Waffle Maker', img: SKU_IMG.TWM },
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('k') !== stockImageToken()) return new Response('not found', { status: 404 });
  const site = (url.searchParams.get('site') || 'ALTONA').toUpperCase();
  // ?sizes=320 scopes the card ("320g stock update" → just the wholesale column)
  const sizeParam = (url.searchParams.get('sizes') || '').split(',').map(Number).filter((g) => [320, 520, 1000].includes(g));
  const SIZES = sizeParam.length ? sizeParam : [320, 520, 1000];
  const origin = process.env.PUBLIC_APP_URL || `${url.protocol}//${url.host}`;

  const { data } = await supabaseLogistics.from('v_stock_current')
    .select('product_id,sku,flavour,unit_size_g,available,inbound,days_of_cover,category')
    .eq('active', true).eq('location_code', site).in('category', ['mix', 'syrup', 'accessory']);
  const all = (data ?? []) as any[];
  const rows = all.filter((r) => r.category === 'mix');
  if (!rows.length) return new Response('no stock data', { status: 404 });
  // syrup + accessories: only on the full (unscoped) card
  const others = sizeParam.length ? [] : OTHER_PRODUCTS
    .map((o) => ({ ...o, r: all.find((r) => r.sku === o.sku) }))
    .filter((o) => o.r);

  // LIVE ShipBob overlay (one batched call) so the card never shows the stale 5am snapshot.
  try {
    const { data: pls } = await supabaseLogistics.from('products')
      .select('sku, product_locations(shipbob_inventory_id, active, location:location_id(code))')
      .in('sku', all.map((r) => r.sku));
    const invBySku = new Map<string, number>();
    for (const p of (pls ?? []) as any[]) {
      for (const pl of (p.product_locations ?? []) as any[]) {
        if (pl.active && pl.shipbob_inventory_id && (pl.location?.code || '').toUpperCase() === site) invBySku.set(p.sku, Number(pl.shipbob_inventory_id));
      }
    }
    const levels = await getInventoryLevels(site, [...invBySku.values()]);
    for (const r of all) {
      const lvl = invBySku.has(r.sku) ? levels.get(invBySku.get(r.sku)!) : undefined;
      if (lvl) r.available = lvl.fulfillable;
    }
  } catch { /* snapshot values stand */ }

  // group by flavour; per-size cells. 320g: available + inbound in CARTONS (inbound is pouches ÷ 4).
  const byFlavour = new Map<string, Record<number, { avail: number; inbound: number; cover: number | null }>>();
  for (const r of rows) {
    if (!r.flavour || !SIZES.includes(r.unit_size_g)) continue;
    if (!byFlavour.has(r.flavour)) byFlavour.set(r.flavour, {});
    const inbound = r.unit_size_g === 320 ? Math.round((r.inbound || 0) / 4) : (r.inbound || 0);
    byFlavour.get(r.flavour)![r.unit_size_g] = { avail: r.available || 0, inbound, cover: r.days_of_cover != null ? Number(r.days_of_cover) : null };
  }
  const flavours = [...byFlavour.keys()].sort((a, b) => a.localeCompare(b));

  const cellColor = (c?: { avail: number; cover: number | null }) =>
    !c ? '#d1d5db' : c.avail <= 0 ? '#dc2626' : c.cover != null && c.cover < 45 ? '#d97706' : '#059669';
  const dateStr = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', timeZone: 'Australia/Melbourne' });
  const rowH = 78;
  const height = 210 + flavours.length * rowH + 60 + (others.length ? 60 + Math.ceil(others.length / 2) * 64 : 0);

  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#FFF8E7', padding: 44, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 38, fontWeight: 800, color: '#8B4513' }}>Stock Update — {site === 'ALTONA' ? 'Altona (AU)' : 'Manchester (UK)'}</span>
            <span style={{ fontSize: 22, color: '#6b7280', marginTop: 4 }}>live ShipBob availability · {dateStr}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 14, background: '#C4814A', fontSize: 36 }}>🥞</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 26, background: 'white', borderRadius: 16, padding: 6 }}>
          <div style={{ display: 'flex', padding: '10px 18px', fontSize: 17, color: '#9ca3af', alignItems: 'center' }}>
            <span style={{ flex: 1 }}>Flavour</span>
            {SIZES.includes(320) && <span style={{ width: 190, textAlign: 'right' }}>320g wholesale (ctns)</span>}
            {SIZES.includes(520) && <span style={{ width: 130, textAlign: 'right' }}>520g</span>}
            {SIZES.includes(1000) && <span style={{ width: 130, textAlign: 'right' }}>1kg</span>}
          </div>
          {flavours.map((f) => {
            const sz = byFlavour.get(f)!;
            const img = FLAVOUR_IMG[f];
            return (
              <div key={f} style={{ display: 'flex', padding: '8px 18px', borderTop: '1px solid #f3f4f6', alignItems: 'center', height: rowH }}>
                {img
                  ? <img src={`${origin}/products/${img}`} width={52} height={52} style={{ borderRadius: 10, objectFit: 'contain' }} />
                  : <div style={{ display: 'flex', width: 52, height: 52, borderRadius: 10, background: '#f3f4f6' }} />}
                <span style={{ flex: 1, fontSize: 23, fontWeight: 600, color: '#111827', marginLeft: 16 }}>{f}</span>
                {SIZES.map((g) => {
                  const c = sz[g];
                  return (
                    <div key={g} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: g === 320 ? 190 : 130 }}>
                      <span style={{ fontSize: 25, fontWeight: 700, color: cellColor(c) }}>{c ? c.avail.toLocaleString('en-AU') : '—'}</span>
                      {c && c.inbound > 0 && <span style={{ fontSize: 15, color: '#6b7280' }}>+{c.inbound.toLocaleString('en-AU')}{g === 320 ? ' ctn' : ''} inbound</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {others.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 16, background: 'white', borderRadius: 16, padding: '10px 6px' }}>
            <span style={{ fontSize: 17, color: '#9ca3af', padding: '0 18px 6px' }}>Other products</span>
            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
              {others.map((o) => {
                const c = { avail: o.r.available || 0, cover: o.r.days_of_cover != null ? Number(o.r.days_of_cover) : null };
                return (
                  <div key={o.sku} style={{ display: 'flex', alignItems: 'center', width: '50%', padding: '6px 18px', height: 64 }}>
                    <img src={`${origin}/products/${o.img}`} width={44} height={44} style={{ borderRadius: 9, objectFit: 'contain' }} />
                    <span style={{ flex: 1, fontSize: 20, fontWeight: 600, color: '#111827', marginLeft: 14 }}>{o.label}</span>
                    <span style={{ fontSize: 23, fontWeight: 700, color: cellColor(c) }}>{c.avail.toLocaleString('en-AU')}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', marginTop: 18, fontSize: 17, color: '#9ca3af', gap: 24, alignItems: 'center' }}>
          {[['#059669', 'healthy'], ['#d97706', 'under 45 days cover'], ['#dc2626', 'out of stock']].map(([col, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ display: 'flex', width: 12, height: 12, borderRadius: 6, background: col }} />
              <span>{label}</span>
            </div>
          ))}
          {SIZES.includes(320) && <span>320g figures are cartons of 4</span>}
        </div>
      </div>
    ),
    { width: 1080, height },
  );
}
