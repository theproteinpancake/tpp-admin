// Canonical business + customs constants for TPP internal-transfer shipping documents.
// Extracted from the INTERNAL2 document set (commercial invoice, packing list, COO).

export const EXPORTER = {
  name: 'THE PROTEIN PANCAKE',
  legal: 'Rolls Trading Trust',
  addr: ['18 Terama Ct, Greenwith SA 5125, Australia'],
  fcAddr: ['C/O ShipBob, Inc', '21-27 Marshall Court', 'Altona, VIC, 3018 AU'],
  abn: '28 300 400 250',
  acn: '660 254 713',
  phone: '+61 466 430 910',
  email: 'hello@theproteinpancake.co',
};

export const IMPORTER = {
  name: 'THE PROTEIN PANCAKE (Rolls Trading Trust)',
  addr: ['C/O ShipBob, Inc, Unit P6', 'Parklands Heywood Distribution Park', 'Heywood OL10 2TT UK'],
  eori: 'GB493661850000',
  vat: '493661850',
};

export const SHIPMENT_DEFAULTS = {
  countryOfExport: 'Australia',
  reasonForExport: 'Stock transfer',
  incoterms: 'DDP Heywood OL10 2TT',
  currency: 'AUD',
  carrier: 'Maersk (LCL sea)',
};

// HS codes by product category
export const HS = {
  mix: '1901200000',
  flipper: '4419900000',
  syrup: '2106909285',
} as const;

// Per-unit declared values (AUD) — keyed by SKU. Falls back to a category default.
export const UNIT_VALUE: Record<string, number> = {
  BMM: 7.51, BML: 11.14, SCM: 7.51, CHM: 7.51, CHL: 13.73, CCL: 13.83, CCM: 7.51,
  MAM: 8.65, MAL: 13.73, CIM: 7.51, CIL: 13.73, GFCIM: 10.03, GFCIL: 16.65,
  GFBM: 10.03, GFBL: 16.65, SCL: 13.73, BMS: 5.5, CIS: 5.5, MAS: 5.5, GFBS: 7.5,
  ACCF: 3.12, MSS: 3.0, MSS8: 24.0,
};

export const declaredValue = (sku: string, fallback?: number) => UNIT_VALUE[sku] ?? fallback ?? 0;

// AUD → GBP for the commercial-invoice GBP column. Indicative (HMRC's published customs rate for
// the period is the one that legally applies); matches the rate used on INTERNAL2.
export const AUD_TO_GBP = 0.527;

// UK import VAT rate by SKU: only The Flipper (wooden tool, HS 4419.90) is standard-rated 20%;
// all food (mix/syrup) is zero-rated (VATZ).
export const vatRateFor = (sku: string) => (sku === 'ACCF' ? 0.20 : 0);

// Country of origin: most products AU; The Flipper (wooden tool) is CN.
export const originFor = (sku: string) => (sku === 'ACCF' ? 'CN' : 'AU');
export const hsFor = (category: string, sku: string) =>
  sku === 'ACCF' ? HS.flipper : category === 'syrup' ? HS.syrup : HS.mix;

export const CUSTOMS_NOTES = [
  'Declaration of Origin — UK–Australia FTA (A-UKFTA): Protein Pancake Mix (HS 1901.20) and Sugar Free Maple Flavoured Syrup (HS 2106.90) are of Australian preferential origin (PSR — product-specific rule). The Flipper (HS 4419.90) is of Chinese origin and is NOT claimed under AU-UK FTA preference.',
  'Y930 — Exempt from veterinary controls under Decision 2007/275/EC (composite shelf-stable product, <50% dairy). No health certificate or IPAFFS notification required.',
  'Import VAT: account via Postponed VAT Accounting (PVA) under EORI GB493661850000 where available. For smooth customs clearance, please use our CDS Cash Account: 10099858329 (or immediate payment to HMRC via CDSI). Avoid using a third-party deferment account.',
  'Importer / IOR: Rolls Trading Trust t/a The Protein Pancake — GB EORI GB493661850000 | VAT 493661850. Maersk acts as indirect representative (authorisation on file).',
  'Incoterms DDP; inland (UK) transport costs declared as zero. GST: NIL (export sale, zero-rated).',
];

// UK transfer pallet logistics (520g roll-out). 520g carton = 23×23×33cm, 12 units.
// Standard 1200×1000mm pallet, ~150cm max height: 15 cartons/layer × 5 layers =
// 75 cartons = 900 units (~468kg product, ~530kg gross) at ~134cm. A 6th layer
// (~1,080 units, ~157cm) only if the carrier allows — confirm weight with Maersk.
export const UK_PALLET = {
  unitSizeG: 520,
  cartonDimsCm: [23, 23, 33] as const,
  unitsPerCarton: 12,
  cartonsPerLayer: 15,
  layers: 5,
  cartonsPerPallet: 75,
  unitsPerPallet: 900,
  productKgPerPallet: 468,
};

// Maersk freight contact to START a transfer (quote & booking).
// Viviana replaced Jordan Burnes, who moved on (Jun 2026). For stage-by-stage contacts
// (export, BL, finance, UK arrival, customs, delivery) see the maersk_contact_map config /
// get_uk_pallet_contacts.
export const MAERSK = {
  name: 'Viviana Diaz',
  email: 'viviana.diaz@maersk.com',
};

export const sizeLabel = (g: number | null | undefined) =>
  g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`;
