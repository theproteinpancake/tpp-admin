/* eslint-disable jsx-a11y/alt-text */
// react-pdf document generators for internal-transfer shipping paperwork.
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import type { Transfer } from './transfers';
import {
  EXPORTER, IMPORTER, SHIPMENT_DEFAULTS, CUSTOMS_NOTES, declaredValue, originFor, hsFor, sizeLabel,
} from './transferConstants';

const CARAMEL = '#C4814A';
const INK = '#1f2937';
const MUTE = '#6b7280';
const LINE = '#e5e7eb';

const money = (n: number) => n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, color: INK, fontFamily: 'Helvetica' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brand: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: INK },
  sub: { fontSize: 8, color: MUTE, marginTop: 2 },
  docTitle: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: CARAMEL, textAlign: 'right' },
  docType: { fontSize: 9, color: MUTE, textAlign: 'right' },
  hr: { borderBottomWidth: 1, borderBottomColor: CARAMEL, marginVertical: 10 },
  boxes: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  box: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8 },
  boxLabel: { fontSize: 7, color: CARAMEL, fontFamily: 'Helvetica-Bold', marginBottom: 3, textTransform: 'uppercase' },
  boxLine: { fontSize: 8.5, lineHeight: 1.4 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: LINE, borderRadius: 4, marginBottom: 12 },
  metaCell: { width: '25%', padding: 6, borderRightWidth: 1, borderBottomWidth: 1, borderColor: LINE },
  metaLabel: { fontSize: 6.5, color: MUTE, textTransform: 'uppercase' },
  metaVal: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  th: { flexDirection: 'row', backgroundColor: '#faf6f0', borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE },
  thc: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: MUTE, padding: 5, textTransform: 'uppercase' },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: LINE },
  td: { fontSize: 8.5, padding: 5 },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  totalLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginRight: 12 },
  totalVal: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: CARAMEL },
  notesTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4 },
  note: { fontSize: 7.5, color: MUTE, lineHeight: 1.4, marginBottom: 3 },
  sign: { marginTop: 18, flexDirection: 'row', justifyContent: 'space-between' },
  signLine: { borderTopWidth: 1, borderColor: INK, width: 180, marginTop: 24, paddingTop: 3, fontSize: 8 },
});

function Head({ title }: { title: string }) {
  return (
    <>
      <View style={s.rowBetween}>
        <View>
          <Text style={s.brand}>The Protein Pancake.</Text>
          <Text style={s.sub}>{EXPORTER.addr[0]}</Text>
          <Text style={s.sub}>{EXPORTER.phone} · {EXPORTER.email}</Text>
          <Text style={s.sub}>ABN: {EXPORTER.abn} · ACN: {EXPORTER.acn}</Text>
        </View>
        <View>
          <Text style={s.docTitle}>{title}</Text>
        </View>
      </View>
      <View style={s.hr} />
    </>
  );
}

function Parties() {
  return (
    <View style={s.boxes}>
      <View style={s.box}>
        <Text style={s.boxLabel}>Shipper / Exporter</Text>
        <Text style={s.boxLine}>{EXPORTER.name}</Text>
        {EXPORTER.fcAddr.map((l, i) => <Text key={i} style={s.boxLine}>{l}</Text>)}
        <Text style={s.boxLine}>ABN: {EXPORTER.abn}</Text>
      </View>
      <View style={s.box}>
        <Text style={s.boxLabel}>Consignee / Importer</Text>
        <Text style={s.boxLine}>{IMPORTER.name}</Text>
        {IMPORTER.addr.map((l, i) => <Text key={i} style={s.boxLine}>{l}</Text>)}
        <Text style={s.boxLine}>GB EORI: {IMPORTER.eori} | VAT: {IMPORTER.vat}</Text>
      </View>
    </View>
  );
}

function Meta({ t, invoiceDate }: { t: Transfer; invoiceDate: string }) {
  const cells: [string, string][] = [
    ['Country of Export', SHIPMENT_DEFAULTS.countryOfExport],
    ['Reason for Export', SHIPMENT_DEFAULTS.reasonForExport],
    ['Incoterms', SHIPMENT_DEFAULTS.incoterms],
    ['Currency', t.currency || SHIPMENT_DEFAULTS.currency],
    ['Carrier', t.carrier || SHIPMENT_DEFAULTS.carrier],
    ['Invoice Number', t.reference],
    ['Invoice Date', invoiceDate],
    ['BL / HBL', t.bl_ref || '—'],
    ['Shipment #', t.shipment_ref || '—'],
    ['Container', t.container_ref || '—'],
    ['ETA', fmtDate(t.eta)],
    ['Route', `${t.origin_code || 'AU'} → ${t.destination_code || 'UK'}`],
  ];
  return (
    <View style={s.metaGrid}>
      {cells.map(([l, v], i) => (
        <View key={i} style={s.metaCell}>
          <Text style={s.metaLabel}>{l}</Text>
          <Text style={s.metaVal}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function CommercialInvoiceDoc({ t }: { t: Transfer }) {
  const today = fmtDate(new Date().toISOString().slice(0, 10));
  let units = 0, total = 0;
  const rows = t.lines.map((l) => {
    const uv = l.unit_value ?? declaredValue(l.sku);
    const lineTotal = uv * l.qty;
    units += l.qty; total += lineTotal;
    return { ...l, uv, lineTotal };
  });
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Head title="COMMERCIAL INVOICE" />
        <Parties />
        <Meta t={t} invoiceDate={today} />

        <View style={s.th}>
          <Text style={[s.thc, { width: '8%' }]}>Qty</Text>
          <Text style={[s.thc, { width: '8%' }]}>COO</Text>
          <Text style={[s.thc, { width: '20%' }]}>HS Code</Text>
          <Text style={[s.thc, { width: '40%' }]}>Product</Text>
          <Text style={[s.thc, { width: '12%', textAlign: 'right' }]}>Unit</Text>
          <Text style={[s.thc, { width: '12%', textAlign: 'right' }]}>Total</Text>
        </View>
        {rows.map((r, i) => (
          <View key={i} style={s.tr}>
            <Text style={[s.td, { width: '8%' }]}>{r.qty}</Text>
            <Text style={[s.td, { width: '8%' }]}>{r.coo || originFor(r.sku)}</Text>
            <Text style={[s.td, { width: '20%' }]}>{r.hs_code || hsFor(r.category, r.sku)}</Text>
            <Text style={[s.td, { width: '40%' }]}>{sizeLabel(r.unit_size_g)} {r.flavour || r.name}</Text>
            <Text style={[s.td, { width: '12%', textAlign: 'right' }]}>{money(r.uv)}</Text>
            <Text style={[s.td, { width: '12%', textAlign: 'right' }]}>{money(r.lineTotal)}</Text>
          </View>
        ))}
        <View style={s.totalRow}>
          <Text style={s.totalLabel}>TOTAL {units.toLocaleString()} units</Text>
          <Text style={s.totalVal}>{t.currency || 'AUD'} {money(total)}</Text>
        </View>

        <Text style={s.notesTitle}>Customs &amp; Import Notes</Text>
        {CUSTOMS_NOTES.map((n, i) => <Text key={i} style={s.note}>• {n}</Text>)}

        <View style={s.sign}>
          <Text style={s.signLine}>Signature (Exporter)</Text>
          <Text style={s.signLine}>Name: Luke Rolls    Date: ____/____/____</Text>
        </View>
      </Page>
    </Document>
  );
}

function PackingListDoc({ t }: { t: Transfer }) {
  const today = fmtDate(new Date().toISOString().slice(0, 10));
  const units = t.lines.reduce((a, l) => a + l.qty, 0);
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Head title="PACKING LIST" />
        <Parties />
        <Meta t={t} invoiceDate={today} />

        <View style={s.th}>
          <Text style={[s.thc, { width: '10%' }]}>Qty</Text>
          <Text style={[s.thc, { width: '15%' }]}>SKU</Text>
          <Text style={[s.thc, { width: '20%' }]}>HS Code</Text>
          <Text style={[s.thc, { width: '55%' }]}>Product</Text>
        </View>
        {t.lines.map((l, i) => (
          <View key={i} style={s.tr}>
            <Text style={[s.td, { width: '10%' }]}>{l.qty}</Text>
            <Text style={[s.td, { width: '15%' }]}>{l.sku}</Text>
            <Text style={[s.td, { width: '20%' }]}>{l.hs_code || hsFor(l.category, l.sku)}</Text>
            <Text style={[s.td, { width: '55%' }]}>{sizeLabel(l.unit_size_g)} {l.flavour || l.name}</Text>
          </View>
        ))}
        <View style={s.totalRow}>
          <Text style={s.totalLabel}>TOTAL</Text>
          <Text style={s.totalVal}>{units.toLocaleString()} units</Text>
        </View>

        <View style={[s.box, { marginTop: 14 }]}>
          <Text style={s.boxLabel}>Shipment Summary</Text>
          <Text style={s.boxLine}>Cartons: {t.cartons ?? '—'}   ·   Units: {units.toLocaleString()}   ·   Gross weight: {t.gross_kg ? `${t.gross_kg} kg` : '—'}</Text>
          <Text style={s.boxLine}>Carrier: {t.carrier || SHIPMENT_DEFAULTS.carrier}   ·   BL/HBL: {t.bl_ref || '—'}   ·   Container: {t.container_ref || '—'}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderCommercialInvoice(t: Transfer): Promise<Buffer> {
  return await renderToBuffer(<CommercialInvoiceDoc t={t} />);
}
export async function renderPackingList(t: Transfer): Promise<Buffer> {
  return await renderToBuffer(<PackingListDoc t={t} />);
}

export const TRANSFER_DOCS = {
  'commercial-invoice': { label: 'Commercial Invoice', render: renderCommercialInvoice },
  'packing-list': { label: 'Packing List', render: renderPackingList },
} as const;
export type TransferDocKey = keyof typeof TRANSFER_DOCS;
