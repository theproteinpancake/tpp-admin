import { ImageResponse } from 'next/og';
import { getPouchTracking, getShipperTracking, PACK_STATUS_META, type PackStatus } from '@/lib/packaging';
import { stockImageToken, FLAVOUR_IMG } from '@/lib/stockImage';

export const runtime = 'nodejs';

// Weekly packaging card for WhatsApp (Luke, Sep 2026: "a little picture representation like
// the other stock updates — 4 columns: 320g, 520g, 1kg and cartons"). Top block: empty pouches
// at ABC, one row per flavour, a cell per size; the 320g cell also carries the SRP carton count
// because 320g only ever ships as 4-packs (whichever of pouches/cartons runs out first is the
// real limit). Bottom block: ShipBob-held shipping cartons + insert cards, live. Cells are
// coloured by the same order-now / order-soon / healthy statuses as the Packaging page.
const SIZES = ['320g', '520g', '1kg'] as const;
const COLOR: Record<PackStatus, string> = {
  unset: '#9ca3af', ok: '#059669', order_soon: '#d97706', order_now: '#dc2626',
};
const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-AU'));

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('k') !== stockImageToken()) return new Response('not found', { status: 404 });
  const origin = process.env.PUBLIC_APP_URL || `${url.protocol}//${url.host}`;

  const [pouches, shippers] = await Promise.all([getPouchTracking(), getShipperTracking()]);
  if (!pouches.length) return new Response('no packaging data', { status: 404 });

  // flavour → size → row (only rows with a baseline; unset sizes render as a dash)
  const byFlavour = new Map<string, Partial<Record<(typeof SIZES)[number], (typeof pouches)[number]>>>();
  for (const r of pouches) {
    if (!r.flavour || !(SIZES as readonly string[]).includes(r.size)) continue;
    if (!byFlavour.has(r.flavour)) byFlavour.set(r.flavour, {});
    byFlavour.get(r.flavour)![r.size as (typeof SIZES)[number]] = r;
  }
  const flavours = [...byFlavour.keys()].sort((a, b) => a.localeCompare(b));

  // ShipBob cartons + inserts, worst status first (that's how getShipperTracking sorts).
  const boxes = shippers.filter((s) => s.fulfillable != null).slice(0, 16);

  const dateStr = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', timeZone: 'Australia/Melbourne' });
  const rowH = 78;
  const boxRowH = 50;
  const short = (n: string) => n.replace(/\s*\((Manchester)\)/i, '').replace(/ Custom Boxes| Carton Box| Shipper Carton/g, '').replace(/^THANK YOU Order (\d) .*A6 card$/, 'Thank You $1 A6 card').slice(0, 30);
  const height = 230 + flavours.length * rowH + 40 + (boxes.length ? 70 + Math.ceil(boxes.length / 2) * boxRowH : 0) + 70;

  const cell = (r: (typeof pouches)[number] | undefined, size: string) => {
    if (!r || r.baseline_qty == null) {
      return <span style={{ fontSize: 22, color: '#d1d5db' }}>—</span>;
    }
    const col = COLOR[r.status];
    const cover = r.days_cover != null ? (r.days_cover > 999 ? '999+d' : `${r.days_cover}d`) : '';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <span style={{ fontSize: 25, fontWeight: 700, color: col }}>{fmt(r.remaining)}</span>
        {size === '320g' && r.srp && (
          <span style={{ fontSize: 14, color: r.srp.binding ? '#dc2626' : '#6b7280' }}>
            {fmt(r.srp.boxes_remaining)} SRP ctns{r.srp.binding ? ' (limit)' : ''}
          </span>
        )}
        {cover && <span style={{ fontSize: 13, color: '#9ca3af' }}>{cover} cover{r.inbound ? ` · +${fmt(r.inbound)} in` : ''}</span>}
      </div>
    );
  };

  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#FFF8E7', padding: 44, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 38, fontWeight: 800, color: '#8B4513' }}>Packaging — weekly check</span>
            <span style={{ fontSize: 22, color: '#6b7280', marginTop: 4 }}>empty pouches at ABC · cartons at ShipBob (live) · {dateStr}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 14, background: '#C4814A', fontSize: 36 }}>📦</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 26, background: 'white', borderRadius: 16, padding: 6 }}>
          <div style={{ display: 'flex', padding: '10px 18px', fontSize: 17, color: '#9ca3af', alignItems: 'center' }}>
            <span style={{ flex: 1 }}>Empty pouches at ABC</span>
            {SIZES.map((s) => <span key={s} style={{ width: 190, textAlign: 'right' }}>{s === '320g' ? '320g (+ SRP ctns)' : s}</span>)}
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
                {SIZES.map((s) => (
                  <div key={s} style={{ display: 'flex', justifyContent: 'flex-end', width: 190 }}>{cell(sz[s], s)}</div>
                ))}
              </div>
            );
          })}
        </div>

        {boxes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 16, background: 'white', borderRadius: 16, padding: '10px 6px' }}>
            <span style={{ fontSize: 17, color: '#9ca3af', padding: '0 18px 6px' }}>Cartons &amp; cards at ShipBob (live · reorder point in grey)</span>
            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
              {boxes.map((b) => (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', width: '50%', padding: '4px 18px', height: boxRowH }}>
                  <div style={{ display: 'flex', width: 10, height: 10, borderRadius: 5, background: COLOR[b.status], marginRight: 10 }} />
                  <span style={{ flex: 1, fontSize: 18, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden' }}>{short(b.name)}{b.site === 'MANCHESTER' ? ' 🇬🇧' : ''}</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: COLOR[b.status] }}>{fmt(b.fulfillable)}</span>
                  <span style={{ fontSize: 13, color: '#9ca3af', marginLeft: 8, width: 60 }}>/ {fmt(b.reorder_point)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', marginTop: 18, fontSize: 17, color: '#9ca3af', gap: 24, alignItems: 'center' }}>
          {(['ok', 'order_soon', 'order_now'] as PackStatus[]).map((s) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ display: 'flex', width: 12, height: 12, borderRadius: 6, background: COLOR[s] }} />
              <span>{PACK_STATUS_META[s].label.toLowerCase()}</span>
            </div>
          ))}
          <span>pouch cover = days of ABC PO volume · 60d China lead</span>
        </div>
      </div>
    ),
    { width: 1080, height },
  );
}
