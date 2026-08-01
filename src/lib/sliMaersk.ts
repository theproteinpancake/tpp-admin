// Fills MAERSK'S OWN Shipper's Letter of Instruction for an internal transfer.
//
// We already render our own SLI (transferPdf renderSli), but Maersk's AU logistics desk want
// their form — au.logistics@lns.maersk.com won't book a pickup off a look-alike. It's a proper
// AcroForm, so this fills the real fields rather than redrawing the page.
//
// The field names below are the template's own (spelling and spacing included, e.g.
// "CONSIGNEE  BUYER" with two spaces) — they're matched loosely so a template revision that
// re-spaces a label doesn't silently drop a value.
import { PDFDocument } from 'pdf-lib';
import type { Transfer } from './transfers';
import { SLI_MAERSK_BLANK_B64 } from './sliTemplate';
import { EXPORTER, IMPORTER, cartonUnits } from './transferConstants';

export const MAERSK_SLI_EMAIL = process.env.MAERSK_SLI_EMAIL || 'au.logistics@lns.maersk.com';

// Pallet footprint used for the volume estimate (matches what went on INTERNAL4).
const PALLET_CBM = 1.8;
const PALLET_DIMS = '120 × 100 × 150 cm';
// Gross = product + packaging. Built from the pallet spec in transferBuilder (75 cartons =
// 900 × 520g = 468 kg product, ~530 kg gross), i.e. ~0.5 kg per carton plus a 25 kg pallet —
// which reproduces that 530 exactly. A flat percentage uplift does not.
const CARTON_TARE_KG = 0.5;
const PALLET_TARE_KG = 25;
// Trading name exactly as it appeared on the INTERNAL4 SLI Maersk accepted.
const TRADING_NAME = 'Rolls Trading Trust t/a The Protein Pancake';

const ddmmyyyy = (iso?: string | null) => {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/**
 * Checkbox state copied verbatim from the INTERNAL4 SLI that Maersk accepted and shipped on.
 * The template's checkbox labels are a single run-on string in the PDF (see the SPECIAL
 * INSTRUCTIONS field name), so there is no reliable way to derive which box means what from the
 * file itself — reusing a known-good set beats guessing at semantics on a customs document.
 * If Maersk ever query a tick, change it HERE and note why.
 */
const CHECKED_ON_INTERNAL4 = ['Check Box5', 'Check Box6', 'Check Box7', 'Check Box8',
  'Check Box15', 'Check Box16', 'Check Box17', 'Check Box20'];

export function sliValues(t: Transfer): Record<string, string> {
  const units = t.lines.reduce((s, l) => s + (l.qty || 0), 0);
  const cartons = t.cartons ?? t.lines.reduce((s, l) => s + Math.ceil((l.qty || 0) / cartonUnits(l.unit_size_g)), 0);
  const pallets = Math.max(1, Math.ceil(cartons / 75));
  // Product weight from the actual manifest; gross adds carton + pallet tare (see above).
  const netKg = t.lines.reduce((s, l) => s + (l.qty || 0) * ((l.unit_size_g ?? 520) / 1000), 0);
  const grossKg = t.gross_kg ?? Math.round(netKg + cartons * CARTON_TARE_KG + pallets * PALLET_TARE_KG);
  const shipDate = ddmmyyyy(t.ship_date);

  return {
    EXPORTER: [
      TRADING_NAME,
      `ABN: ${EXPORTER.abn}`,
      EXPORTER.addr[0],
      `Luke Rolls  ·  +61 412 474 330  ·  luke@theproteinpancake.co`,
    ].join('\n'),
    'SHIPPERS LETTER OF INSTRUCTION NO': t.reference,
    'PAGE NO': '1 of 1',
    'OWNER S REFERENCE': t.reference,
    'ORDER NUMBERS': t.reference,
    'HOUSE BILL': t.bl_ref || '',
    'CONSIGNEE  BUYER': [TRADING_NAME, ...IMPORTER.addr].join('\n'),
    'NOTIFY PARTY': [
      'Same as consignee',
      `Notify EORI: ${IMPORTER.eori}`,
      'luke@theproteinpancake.co  ·  +61 412 474 330',
    ].join('\n'),
    'PORT OF LOADING': 'Melbourne',
    'PORT OF DISCHARGE': 'Felixstowe, UK (per Maersk routing)',
    'FINAL DESTINATION': 'Heywood, Manchester, OL10 2TT, UK',
    'MARKS  NUMBERS': `The Protein Pancake — ${t.reference}`,
    'NUMBER AND TYPE OF PACKAGES': `${pallets} pallet${pallets > 1 ? 's' : ''} (${cartons} cartons palletised, ${units} units)`,
    'CONTAINER  SEAL NUMBER': t.container_ref || '',
    'DESCRIPTION OF GOODS GENERAL':
      'Protein pancake mix food products, fit for human consumption. Australian origin. Non-hazardous / non-DG. Per attached commercial invoice.',
    'TOTAL WEIGHT': `approx. ${grossKg} kg gross (${Math.round(netKg)} kg net product)`,
    'TOTAL VOLUME': `approx. ${(PALLET_CBM * pallets).toFixed(1)} CBM (${PALLET_DIMS}${pallets > 1 ? ` × ${pallets}` : ''})`,
    'HANDLING INSTRUCTIONS':
      'Food products — keep dry, protect from moisture. Non-hazardous, non-DG. No temperature control required.',
    'SIGNATORYS COMPANY': TRADING_NAME,
    'NAME OF SIGNATORY': 'Luke Rolls',
    Dropdown3: 'DDP - Delivered Duty Paid',
    Dropdown4: 'Seafreight',
    Date1_af_date: shipDate,
    Date2_af_date: shipDate,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function renderMaerskSli(t: Transfer): Promise<Buffer> {
  const pdf = await PDFDocument.load(Buffer.from(SLI_MAERSK_BLANK_B64, 'base64'));
  const form = pdf.getForm();
  const byNorm = new Map(form.getFields().map((f) => [norm(f.getName()), f.getName()]));

  const missing: string[] = [];
  for (const [name, value] of Object.entries(sliValues(t))) {
    if (!value) continue;
    const real = byNorm.get(norm(name));
    if (!real) { missing.push(name); continue; }
    try {
      if (name.startsWith('Dropdown')) {
        const dd = form.getDropdown(real);
        // Only select an option the template actually offers, else fall back to typing it.
        if (dd.getOptions().includes(value)) dd.select(value);
        else dd.setOptions([...dd.getOptions(), value]), dd.select(value);
      } else {
        form.getTextField(real).setText(value);
      }
    } catch { missing.push(name); }
  }
  for (const box of CHECKED_ON_INTERNAL4) {
    const real = byNorm.get(norm(box));
    if (real) { try { form.getCheckBox(real).check(); } catch { /* not a checkbox on this revision */ } }
  }
  if (missing.length) console.warn(`[SLI ${t.reference}] fields not filled: ${missing.join(', ')}`);

  // Flatten so the carrier can't edit the declaration and it renders identically everywhere.
  form.flatten();
  return Buffer.from(await pdf.save());
}
