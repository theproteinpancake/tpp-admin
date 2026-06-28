/* eslint-disable jsx-a11y/alt-text */
// react-pdf document generators for internal-transfer shipping paperwork.
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import type { Transfer } from './transfers';
import { TPP_LOGO } from './logo';
import { TPP_SIGNATURE } from './signature';
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

// Auto-signed + auto-dated signature block (Luke's signature image + today's date), so an
// approved doc can send straight to Maersk with no manual signing step.
function SignBlock({ label, detail }: { label: string; detail: string }) {
  const today = fmtDate(new Date().toISOString().slice(0, 10));
  return (
    <View style={{ marginTop: 18 }}>
      <Image src={TPP_SIGNATURE} style={{ width: 52, height: 54, marginLeft: 4 }} />
      <View style={{ borderTopWidth: 1, borderColor: INK, width: 240, marginTop: 1, paddingTop: 3 }}>
        <Text style={{ fontSize: 8 }}>{label}</Text>
        <Text style={{ fontSize: 8, marginTop: 2 }}>{detail}   Date: {today}</Text>
      </View>
    </View>
  );
}

function Head({ title }: { title: string }) {
  return (
    <>
      <View style={s.rowBetween}>
        <View>
          <Image src={TPP_LOGO} style={{ width: 150, height: 13, marginBottom: 5 }} />
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
    ['Route', `${t.origin_code || 'AU'} to ${t.destination_code || 'UK'}`],
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

        <SignBlock label="Signature (Exporter)" detail="Name: Luke Rolls" />
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

// ─────────────────────────── shared helpers for the rest of the doc set ───────────────────────────
const ls = StyleSheet.create({
  intro: { fontSize: 8, color: MUTE, fontStyle: 'italic', marginBottom: 10 },
  h2: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 12, marginBottom: 5 },
  p: { fontSize: 8.5, color: INK, lineHeight: 1.45, marginBottom: 5 },
  li: { fontSize: 8.5, color: INK, lineHeight: 1.45, marginBottom: 3 },
  emailBox: { borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 9, marginTop: 6, marginBottom: 6 },
  emailHdr: { fontSize: 8, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  emailBody: { fontSize: 8, color: INK, lineHeight: 1.45, marginTop: 4 },
  ctRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: LINE },
  ctc: { fontSize: 7.8, padding: 4 },
});

function shipMeta(t: Transfer) {
  const units = t.lines.reduce((a, l) => a + l.qty, 0);
  return { units, cartons: t.cartons ?? '—', gross: t.gross_kg ? `${t.gross_kg} kg` : '—' };
}

const MAERSK_CONTACTS: [string, string, string][] = [
  ['Jordan Burnes', 'Booking & quotes (AU Sales) — START', 'jordan.burnes@maersk.com'],
  ['Maersk OCE LCL Export', 'Booking confirmation, BL, vessel ETA', 'OCE.LCLEXPORT@lns.maersk.com'],
  ['Maersk AU Logistics', 'SLI & document collection, pickup', 'au.logistics@lns.maersk.com'],
  ['Maersk AR (M. Kumbhar)', 'Tax invoice / accounts — FINANCE', 'kumbhar.madhuri@maersk.com'],
  ['Maersk UK LCL (S. Dook)', 'UK arrival notice & delivery', 'uk.logistics@lns.maersk.com'],
  ['Maersk UK Customs', 'Import customs clearance', 'mycustomsuk@lns.maersk.com'],
  ['ShipBob Global Freight', 'Origin pickup / freight liaison', 'GlobalFreight@shipbob.com'],
  ['ShipBob Inbound (S. May)', 'Heywood inbound slot / OpenDock', 'smay@shipbob.com'],
];

function CoverNoteDoc({ t }: { t: Transfer }) {
  const { units, cartons, gross } = shipMeta(t);
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Head title="SHIPMENT COVER NOTE" />
        <Text style={ls.intro}>One email per stage — front-load everything so each Maersk team has what they need and no back-and-forth is required.</Text>
        <Text style={ls.h2}>Who&apos;s involved &amp; when</Text>
        <View style={s.th}>
          <Text style={[s.thc, { width: '28%' }]}>Team / person</Text>
          <Text style={[s.thc, { width: '42%' }]}>Role — when</Text>
          <Text style={[s.thc, { width: '30%' }]}>Contact</Text>
        </View>
        {MAERSK_CONTACTS.map((c, i) => (
          <View key={i} style={ls.ctRow}>
            <Text style={[ls.ctc, { width: '28%', fontFamily: 'Helvetica-Bold' }]}>{c[0]}</Text>
            <Text style={[ls.ctc, { width: '42%' }]}>{c[1]}</Text>
            <Text style={[ls.ctc, { width: '30%' }]}>{c[2]}</Text>
          </View>
        ))}
        <Text style={ls.h2}>Standing instructions (paste into both emails)</Text>
        {[
          'DDP, door-to-door stock transfer. On customs clearance, PROCEED IMMEDIATELY with delivery to ShipBob Manchester (Heywood) — do not await further instruction.',
          `Clear under GB EORI ${IMPORTER.eori} (Rolls Trading Trust t/a The Protein Pancake). Full 10-digit HS codes, DDP incoterms (UK inland = zero), weights on the attached invoice & packing list.`,
          'Claim AU–UK FTA preference (origin criterion PSR) per attached Certificate of Origin — duty 0%. Import VAT via Postponed VAT Accounting (PVA). Indirect-representation authority attached.',
          'Inbound delivery booked via OpenDock at Heywood for a specific DAY + HOUR — deliver to that slot; date/time + ref confirmed in the arrival email.',
          'Copy Luke on every milestone: booking confirmation, BL, vessel ETA, arrival notice, customs clearance, delivery booking.',
        ].map((n, i) => <Text key={i} style={ls.li}>{i + 1}. {n}</Text>)}

        <Text style={ls.h2}>Email A — at booking</Text>
        <View style={ls.emailBox}>
          <Text style={ls.emailHdr}>To: jordan.burnes@maersk.com; OCE.LCLEXPORT@lns.maersk.com; au.logistics@lns.maersk.com</Text>
          <Text style={ls.emailHdr}>Cc: GlobalFreight@shipbob.com</Text>
          <Text style={ls.emailHdr}>Subject: New LCL booking — The Protein Pancake [{t.reference}] — full docs attached</Text>
          <Text style={ls.emailBody}>Hi team,{'\n'}Please book our next LCL sea shipment, AU to UK, ShipBob Altona (VIC) to ShipBob Heywood (OL10 2TT). All documents are attached upfront: commercial invoice, packing list, certificate of origin, SLI, indirect-representation letter and product specification.{'\n'}Standing instructions (DDP, door-to-door): clear under EORI {IMPORTER.eori}; claim AU–UK FTA preference (PSR); import VAT via PVA; on clearance proceed immediately with delivery to Heywood. This load: {cartons} cartons · {units.toLocaleString()} units · {gross} gross.{'\n'}Please confirm booking, collection date and the BL once issued, and copy me on all milestones. Thanks! — Luke Rolls</Text>
        </View>
        <Text style={ls.h2}>Email B — when the arrival notice lands</Text>
        <View style={ls.emailBox}>
          <Text style={ls.emailHdr}>To: uk.logistics@lns.maersk.com; mycustomsuk@lns.maersk.com</Text>
          <Text style={ls.emailHdr}>Cc: au.logistics@lns.maersk.com; GlobalFreight@shipbob.com</Text>
          <Text style={ls.emailHdr}>Subject: Clear &amp; deliver — BL {t.bl_ref || '[______]'} — The Protein Pancake — docs attached</Text>
          <Text style={ls.emailBody}>Hi both,{'\n'}Please proceed with import customs clearance and door-to-door delivery for BL {t.bl_ref || '[______]'} (DDP). All clearance docs attached. Clear under EORI {IMPORTER.eori}; claim AU–UK FTA preference (PSR, duty 0%); account import VAT via PVA. Inland = zero.{'\n'}Inbound slot booked via OpenDock at Heywood for: [DAY, DATE @ TIME] — ref [______]. Deliver to that slot and confirm. Proceed immediately on clearance. Delivery: ShipBob, Unit P6 Parklands, Heywood Distribution Park, OL10 2TT. I&apos;m on +61 412 474 330. — Luke Rolls</Text>
        </View>
      </Page>
    </Document>
  );
}

function CertificateOfOriginDoc({ t }: { t: Transfer }) {
  const mix = t.lines.filter((l) => l.category === 'mix');
  const flavours = new Set(mix.map((l) => l.flavour).filter(Boolean)).size;
  const syrup = t.lines.filter((l) => l.category === 'syrup');
  const flipper = t.lines.filter((l) => l.sku === 'ACCF');
  const goods: [string, string, string, string][] = [];
  if (mix.length) goods.push([`Protein Pancake Mix — ${flavours} flavour${flavours === 1 ? '' : 's'} (520g & 1kg)`, '1901.20', 'Australia', 'PSR — product-specific rule']);
  if (syrup.length) goods.push([`Sugar Free Maple Flavoured Syrup (${syrup.reduce((a, l) => a + l.qty, 0)} units)`, '2106.90', 'Australia', 'PSR — product-specific rule']);
  if (flipper.length) goods.push([`The Flipper — wooden pancake tool (${flipper.reduce((a, l) => a + l.qty, 0)} units)`, '4419.90', 'China', 'Non-originating — not claimed']);
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Head title="CERTIFICATE OF ORIGIN" />
        <Text style={ls.p}>Australia–United Kingdom Free Trade Agreement (A-UKFTA) — Declaration of Origin by the Exporter. Completed under Article 4.18 and the data requirements of Annex 4A.</Text>
        <Text style={ls.h2}>1. Exporter (signatory)</Text>
        <Text style={ls.p}>Capacity: Exporter. Rolls Trading Trust trading as The Protein Pancake — ABN {EXPORTER.abn}{'\n'}{EXPORTER.addr[0]} · +61 412 474 330 · luke@theproteinpancake.co</Text>
        <Text style={ls.h2}>2. Producer</Text>
        <Text style={ls.p}>Available upon request by the importing authorities. Goods produced in Australia by the exporter&apos;s contract manufacturer (co-packer).</Text>
        <Text style={ls.h2}>3. Importer</Text>
        <Text style={ls.p}>{IMPORTER.name} · GB EORI {IMPORTER.eori} | VAT {IMPORTER.vat}{'\n'}{IMPORTER.addr.join(', ')}</Text>
        <Text style={ls.h2}>4. Invoice reference</Text>
        <Text style={ls.p}>Commercial Invoice: {t.reference} | Date: {fmtDate(new Date().toISOString().slice(0, 10))}</Text>
        <Text style={ls.h2}>5. Goods covered</Text>
        <View style={s.th}>
          <Text style={[s.thc, { width: '46%' }]}>Product description</Text>
          <Text style={[s.thc, { width: '16%' }]}>HS code</Text>
          <Text style={[s.thc, { width: '18%' }]}>Origin</Text>
          <Text style={[s.thc, { width: '20%' }]}>Criterion</Text>
        </View>
        {goods.map((g, i) => (
          <View key={i} style={s.tr}>
            <Text style={[s.td, { width: '46%' }]}>{g[0]}</Text>
            <Text style={[s.td, { width: '16%' }]}>{g[1]}</Text>
            <Text style={[s.td, { width: '18%' }]}>{g[2]}</Text>
            <Text style={[s.td, { width: '20%' }]}>{g[3]}</Text>
          </View>
        ))}
        <Text style={ls.h2}>6. Origin criterion</Text>
        <Text style={ls.p}>PSR (product-specific rule, Annex 4B): non-originating materials undergo the required change in tariff classification in Australia. The Flipper is of Chinese origin and is not claimed under AU-UK FTA preference (UK MFN rate 0% for HS 4419.90).</Text>
        <Text style={ls.h2}>7. Declaration</Text>
        <Text style={ls.p}>I (the exporter) declare that the goods qualify as originating and the information is true and accurate. I assume responsibility for proving such representations and agree to maintain and present supporting documentation upon request or during a verification visit.</Text>
        <SignBlock label="Signature" detail="Name: Luke Rolls   Position: Director" />
      </Page>
    </Document>
  );
}

function SliDoc({ t, carrierForm }: { t: Transfer; carrierForm?: boolean }) {
  const { units, cartons, gross } = shipMeta(t);
  let value = 0; for (const l of t.lines) value += (l.unit_value ?? declaredValue(l.sku)) * l.qty;
  const cells: [string, string][] = [
    ['SLI No.', t.reference], ['Date', fmtDate(new Date().toISOString().slice(0, 10))],
    ['House Bill', t.bl_ref || '—'], ["Owner's Ref", t.shipment_ref || '—'],
    ['Method', 'Sea — LCL'], ['Order Number', t.shipment_ref || '—'],
    ['Invoice Value', `${t.currency || 'AUD'} ${money(value)}`], ['Declared Value', `${t.currency || 'AUD'} ${money(value)}`],
    ['Terms', 'DDP — Delivered Duty Paid'], ['Port of Loading', 'Melbourne'],
    ['Port of Discharge', 'London (per BL)'], ['Final Destination', 'Heywood, UK'],
  ];
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Head title={carrierForm ? "SLI — CARRIER FORM" : "SHIPPER'S LETTER OF INSTRUCTION"} />
        <Text style={ls.intro}>To Maersk — please prepare and sign the Waybill / Bill of Lading and all necessary documents on our behalf, and dispatch per Maersk Standard Trading Terms &amp; Conditions.</Text>
        <Parties />
        <View style={s.metaGrid}>
          {cells.map(([l, v], i) => (
            <View key={i} style={s.metaCell}><Text style={s.metaLabel}>{l}</Text><Text style={s.metaVal}>{v}</Text></View>
          ))}
        </View>
        <Text style={ls.h2}>Marks &amp; Numbers / Description of Goods</Text>
        <View style={[s.box, { marginBottom: 8 }]}>
          <Text style={s.boxLine}>Packages: 1 pallet · {cartons} cartons · {units.toLocaleString()} units   ·   Weight: {gross} gross   ·   Pallet ID / volume per BL</Text>
        </View>
        <Text style={ls.li}>• Protein Pancake Mix (various flavours), 520g &amp; 1kg — HS 1901200000 — COO: Australia</Text>
        <Text style={ls.li}>• Sugar Free Maple Flavoured Syrup — HS 2106909285 — COO: Australia</Text>
        <Text style={ls.li}>• The Flipper (wooden pancake tool) — HS 4419900000 — COO: China</Text>
        <Text style={[ls.p, { fontStyle: 'italic', marginTop: 4 }]}>All food products fit for human consumption. Y930 exempt (composite, shelf-stable, &lt;50% dairy). VATZ zero-rated. Non-hazardous / non-DG.</Text>
        <Text style={ls.h2}>Charges &amp; Standing Instructions</Text>
        <Text style={ls.p}>Freight charges: PREPAID. Attached: Commercial Invoice · Certificate of Origin · Packing List. Pickup from 21-27 Marshall Court, Altona VIC 3018. Keep dry; non-DG; no temperature control.</Text>
        <Text style={ls.p}>DDP, door-to-door. On clearance PROCEED IMMEDIATELY with delivery — do NOT await further instruction. Clear under GB EORI {IMPORTER.eori}; claim AU–UK FTA preference (PSR — duty 0%); import VAT via PVA. Maersk authorised as indirect representative (letter attached). UK inland = zero. Deliver to: The Protein Pancake C/O ShipBob, Unit P6 Parklands, Heywood Distribution Park, OL10 2TT.</Text>
        <SignBlock label="Signature" detail="Name: Luke Rolls   Company: Rolls Trading Trust t/a The Protein Pancake" />
      </Page>
    </Document>
  );
}

function IndirectRepDoc({ t }: { t: Transfer }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Head title="AUTHORISATION LETTER" />
        <Text style={ls.h2}>Indirect Representation — UK Import Customs Clearance</Text>
        <Text style={ls.p}>Date: {fmtDate(new Date().toISOString().slice(0, 10))}</Text>
        <Text style={ls.p}>To: Maersk Logistics and Services UK Ltd (Customs Services), as agent of Maersk A/S{'\n'}Unit 5, Wilders Way, East Midlands Gateway, Derby, DE74 2BB, United Kingdom</Text>
        <Text style={ls.p}>Dear Customs Team,</Text>
        <Text style={ls.p}>We, Rolls Trading Trust trading as The Protein Pancake (GB EORI {IMPORTER.eori}, VAT {IMPORTER.vat}), hereby authorise Maersk Logistics and Services UK Ltd, acting as agent of Maersk A/S, to act as our INDIRECT REPRESENTATIVE for the purpose of making import customs declarations on our behalf into the United Kingdom.</Text>
        <Text style={ls.h2}>This authorisation covers:</Text>
        {[
          `Submission of import declarations via the Customs Declaration Service (CDS) using our EORI ${IMPORTER.eori};`,
          'Claims for preferential tariff treatment under the UK–Australia Free Trade Agreement, where applicable;',
          'Accounting for import VAT via Postponed VAT Accounting (PVA) under our EORI;',
          `Shipment BL / HBL ${t.bl_ref || '(this and subsequent shipments)'} and subsequent shipments, until this authority is withdrawn by us in writing.`,
        ].map((n, i) => <Text key={i} style={ls.li}>• {n}</Text>)}
        <Text style={ls.p}>We confirm that the information provided to support these declarations is true, accurate and complete, and we accept liability for any customs debt arising. We understand that, under indirect representation, the representative is jointly and severally liable with us for such customs debt.</Text>
        <Text style={ls.p}>Yours faithfully,</Text>
        <SignBlock label="Signature" detail="Name: Luke Rolls   Position: Director" />
        <Text style={[ls.p, { marginTop: 6 }]}>For and on behalf of Rolls Trading Trust t/a The Protein Pancake</Text>
      </Page>
    </Document>
  );
}

const SPEC_ROWS: [string, string, string, string][] = [
  ['Protein Pancake Mix (all flavours)', '1901.20', 'Australia', 'Wheat Flour (Gluten), Whey Protein Isolate (Milk), Pea Protein Isolate, Inulin, Baking Powder (Sodium Bicarbonate, Sodium Acid Pyrophosphate), Maca Powder, Natural Flavouring (Contains Milk), Salt, Thaumatin. Flavour-specific flavours/cocoa per variant. Allergens: Gluten (Wheat), Milk.'],
  ['Pancake Mix — Gluten Free variants', '1901.20', 'Australia', 'As above but Wheat Flour replaced with a gluten-free flour blend. Full GF recipe on request. Allergens: Milk (gluten-free).'],
  ['Sugar Free Maple Flavoured Syrup', '2106.90', 'Australia', 'Water, Sorbitol, Cultured Dextrose, Natural Maple Flavour, Natural Flavour, Apple Extract, Salt. Allergens: none declared.'],
  ['The Flipper (wooden pancake tool)', '4419.90', 'China', 'Non-food item — wooden kitchen utensil. Not for human consumption.'],
];

function ProductSpecDoc() {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Head title="PRODUCT SPECIFICATION" />
        <Text style={ls.intro}>Ingredients, allergens, classification &amp; sanitary status — supports carrier foodstuff acceptance and UK import clearance.</Text>
        <View style={s.th}>
          <Text style={[s.thc, { width: '26%' }]}>Product</Text>
          <Text style={[s.thc, { width: '12%' }]}>HS code</Text>
          <Text style={[s.thc, { width: '14%' }]}>Origin</Text>
          <Text style={[s.thc, { width: '48%' }]}>Ingredients &amp; allergens</Text>
        </View>
        {SPEC_ROWS.map((r, i) => (
          <View key={i} style={s.tr}>
            <Text style={[s.td, { width: '26%', fontFamily: 'Helvetica-Bold' }]}>{r[0]}</Text>
            <Text style={[s.td, { width: '12%' }]}>{r[1]}</Text>
            <Text style={[s.td, { width: '14%' }]}>{r[2]}</Text>
            <Text style={[s.td, { width: '48%' }]}>{r[3]}</Text>
          </View>
        ))}
        <Text style={ls.h2}>Sanitary / Import Status (UK)</Text>
        {[
          'Composite, shelf-stable products containing <50% processed dairy (whey protein isolate, AU origin), no meat. Exempt from veterinary / SPS controls under Commission Decision 2007/275/EC and Regulation (EU) 2019/2007 (assimilated UK law).',
          'Exemption code Y930. No Export Health Certificate and no IPAFFS pre-notification required.',
          `UK VAT: food products zero-rated (VATZ). The Flipper is standard-rated; import VAT via PVA under EORI ${IMPORTER.eori}.`,
          'Storage: ambient. Keep dry, protect from moisture. Non-hazardous, non-dangerous goods.',
        ].map((n, i) => <Text key={i} style={ls.li}>• {n}</Text>)}
        <Text style={[ls.p, { fontStyle: 'italic', marginTop: 8 }]}>Issued by The Protein Pancake (Rolls Trading Trust). Information true and correct to the best of our knowledge.</Text>
      </Page>
    </Document>
  );
}

export async function renderCommercialInvoice(t: Transfer): Promise<Buffer> { return await renderToBuffer(<CommercialInvoiceDoc t={t} />); }
export async function renderPackingList(t: Transfer): Promise<Buffer> { return await renderToBuffer(<PackingListDoc t={t} />); }
export async function renderCoverNote(t: Transfer): Promise<Buffer> { return await renderToBuffer(<CoverNoteDoc t={t} />); }
export async function renderCertificateOfOrigin(t: Transfer): Promise<Buffer> { return await renderToBuffer(<CertificateOfOriginDoc t={t} />); }
export async function renderSli(t: Transfer): Promise<Buffer> { return await renderToBuffer(<SliDoc t={t} />); }
export async function renderSliCarrier(t: Transfer): Promise<Buffer> { return await renderToBuffer(<SliDoc t={t} carrierForm />); }
export async function renderIndirectRep(t: Transfer): Promise<Buffer> { return await renderToBuffer(<IndirectRepDoc t={t} />); }
export async function renderProductSpec(_t: Transfer): Promise<Buffer> { return await renderToBuffer(<ProductSpecDoc />); }

// Ordered 0–6 to match the master logistics document set.
export const TRANSFER_DOCS = {
  'cover-note': { label: '0 · Cover Note', render: renderCoverNote },
  'commercial-invoice': { label: '1 · Commercial Invoice', render: renderCommercialInvoice },
  'packing-list': { label: '2 · Packing List', render: renderPackingList },
  'certificate-of-origin': { label: '3 · Certificate of Origin', render: renderCertificateOfOrigin },
  'sli': { label: '4 · SLI (Maersk)', render: renderSli },
  'sli-carrier': { label: '4b · SLI (Carrier form)', render: renderSliCarrier },
  'indirect-representation': { label: '5 · Indirect-Rep Letter', render: renderIndirectRep },
  'product-specification': { label: '6 · Product Specification', render: renderProductSpec },
} as const;
export type TransferDocKey = keyof typeof TRANSFER_DOCS;
