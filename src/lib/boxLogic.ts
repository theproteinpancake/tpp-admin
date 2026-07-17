// TPP box assignment — code implementation of TPP_Box_Logic_AGENT_SPEC.md (v1.1, live in
// Shopify Flow). Given an order's contents, pick the SMALLEST box that genuinely fits; a
// missing/oversized box means ShipBob's auto-packer picks something too big and we pay the
// difference. Keep this in lockstep with the spec — its §6 test vectors run in
// scripts via runSpecTestVectors() below.

export interface BoxCounters {
  MED: number;  // 520g bags
  LRG: number;  // 1kg bags
  SYR: number;  // syrup bottles
  ACC: number;  // flat accessories (Scraper/Flipper)
  PAN: number;  // Pancake Pans
  WAF: number;  // Waffle Makers
  WS: number;   // wholesale cartons (4×320g SRP)
  SMP: number;  // 80g sample sachets
}
export const zeroCounters = (): BoxCounters => ({ MED: 0, LRG: 0, SYR: 0, ACC: 0, PAN: 0, WAF: 0, WS: 0, SMP: 0 });

// §3 SKU reference — how each SKU feeds the counters (× quantity).
const MED_SKUS = new Set(['BMM', 'CHM', 'SCM', 'CCM', 'MAM', 'CIM', 'GFBM', 'GFCIM']);
const LRG_SKUS = new Set(['BML', 'CHL', 'SCL', 'CCL', 'MAL', 'CIL', 'GFBL', 'GFCIL']);
const WS_SKUS = new Set(['BMS', 'CHS', 'SCS', 'CCS', 'MAS', 'CIS', 'GFBS', 'GFCIS']);
const SMP_SKUS = new Set(['BM80', 'CH80', 'SC80', 'CC80', 'MA80', 'CI80']);
const IGNORE_SKUS = new Set(['ACCT', 'GC1', 'GIFTY']); // tote / gift card / gift wrap — not sized

// Expand SKU lines into counters. `size_g` is the fallback when the SKU isn't recognised
// (520→MED, 1kg→LRG, 320→WS carton, 80→SMP). Unknown lines count as MED (spec rule 21) and
// are returned in `unknown` so the caller can flag for review rather than silently guess.
export function countersForSkuLines(lines: { sku: string; size_g?: number; qty: number }[]): { counters: BoxCounters; unknown: string[] } {
  const c = zeroCounters();
  const unknown: string[] = [];
  for (const l of lines) {
    const sku = (l.sku || '').toUpperCase().trim();
    const q = Math.max(0, Math.round(l.qty));
    if (!q) continue;
    if (IGNORE_SKUS.has(sku)) continue;
    else if (sku === 'MSS') c.SYR += q;
    else if (sku === 'MSS2' || sku === 'MSS3') c.SYR += 3 * q;
    else if (sku === 'MSS8') c.WS += q;
    else if (sku === 'TWM') c.WAF += q;
    else if (sku === 'ACCP') c.PAN += q;
    else if (sku === 'ACCF' || sku === 'ACCS') c.ACC += q;
    else if (MED_SKUS.has(sku)) c.MED += q;
    else if (LRG_SKUS.has(sku)) c.LRG += q;
    else if (WS_SKUS.has(sku)) c.WS += q;
    else if (SMP_SKUS.has(sku)) c.SMP += q;
    else if (l.size_g === 520 || l.size_g === 500) c.MED += q;
    else if (l.size_g === 1000) c.LRG += q;
    else if (l.size_g === 320) c.WS += q;
    else if (l.size_g === 80) c.SMP += q;
    else { c.MED += q; unknown.push(sku || `${l.size_g}g`); } // spec rule 21 + BOX-REVIEW flag
  }
  return { counters: c, unknown };
}

// §4 cascade — NORMATIVE, first match wins. Direct port of the spec's reference implementation.
export function selectBox(c: BoxCounters): string {
  const { MED, LRG, SYR, ACC, PAN, WAF, WS, SMP } = c;
  if (WS > 0) {
    // Luke's refinement (Jul 2026): exactly 2 SRP cartons and nothing else ride in a
    // PANXLARGE — the ONLY case that skips the PANOUTER family for wholesale cartons.
    if (WS === 2 && MED + LRG + SYR + ACC + PAN + WAF + SMP === 0) return 'PANXLARGE';
    return WS <= 4 ? 'PANOUTERSMALL' : 'PANOUTER';
  }
  if (WAF > 0) return MED + 2 * LRG > 8 ? 'PANOUTER' : 'PANXXLARGE';
  if (MED === 0 && LRG === 0 && SYR === 0 && ACC === 0 && PAN === 0) {
    if (SMP > 0) return SMP <= 12 ? 'PANSMALL' : 'PANXLARGE';
    return 'PANSMALL';
  }
  if (MED === 0 && LRG === 0 && ACC === 0 && PAN === 0 && SYR > 0) {
    if (SYR <= 4) return 'PANSMALL';
    if (SYR <= 16) return 'PANMEDIUM';
    return 'PANXLARGE';
  }
  if (LRG === 0 && PAN === 0 && ACC === 0 && MED <= 2 && SYR <= 2 && MED + SYR <= 2) return 'PANSMALL';
  if (MED === 0 && PAN === 0 && ACC === 0) {
    if ((SYR === 0 && LRG >= 1 && LRG <= 2) || (LRG === 1 && SYR <= 2)) return 'PAN#2MEDIUM';
  }
  if (PAN === 0) {
    if (LRG === 0 && MED >= 1 && MED <= 4 && ACC <= 2 && (SYR === 0 || (SYR <= 1 && MED <= 3))) return 'PANMEDIUM';
    if (LRG === 1 && MED <= 2 && ACC <= 2 && SYR === 0) return 'PANMEDIUM';
  }
  if (LRG === 0 && PAN === 0 && ACC === 0 && MED >= 5) return MED <= 12 ? 'PANXLARGE' : 'PANOUTER';
  if (PAN === 0) {
    if (MED * 1 + LRG * 1.5 + ACC * 0.5 + SYR * 0.5 <= 6) return 'PANLARGE';
  } else if (PAN === 1) {
    const bags = MED + LRG;
    if (bags <= 3 && bags + ACC + (SYR > 0 ? 1 : 0) <= 5) return 'PANLARGE';
  }
  if (LRG === 0 && PAN === 0) return MED <= 12 ? 'PANXLARGE' : 'PANOUTER';
  if (MED + 2 * LRG <= 16) return 'PANXXLARGE';
  return 'PANOUTER';
}

// Multi-box plan for a WHOLESALE order of N 320g cartons (the spec's single-box contract
// covers ≤8; wholesale routinely exceeds it). Fill PANOUTERs (8 cartons each), then the
// smallest box that fits the remainder — 2 cartons ride cheaper in a PANXLARGE.
// e.g. 10 → PANOUTER + PANOUTERSMALL · 16 → 2× PANOUTER · 8 → 1× PANOUTER · 4 → PANOUTERSMALL.
export function planWholesaleBoxes(totalCartons: number): string[] {
  if (totalCartons <= 0) return [];
  const boxes: string[] = [];
  let rem = totalCartons;
  while (rem > 8) { boxes.push('PANOUTER'); rem -= 8; }
  if (rem === 2 && boxes.length === 0) boxes.push('PANXLARGE');
  else if (rem <= 4) boxes.push('PANOUTERSMALL');
  else boxes.push('PANOUTER');
  return boxes;
}

// Aggregate a box list into ShipBob order lines (['PANOUTER','PANOUTER','PANOUTERSMALL'] →
// PANOUTER×2 + PANOUTERSMALL×1) so multi-box orders commit EVERY box, with real quantities.
export function boxLines(boxes: string[]): { reference_id: string; quantity: number }[] {
  const counts = new Map<string, number>();
  for (const b of boxes) counts.set(b, (counts.get(b) || 0) + 1);
  return [...counts.entries()].map(([reference_id, quantity]) => ({ reference_id, quantity }));
}

// §6 test vectors — returns failures (empty = all pass). Run via a tsx script after edits.
export function runSpecTestVectors(): string[] {
  const CASES: [number[], string][] = [
    [[1, 0, 0, 0, 0, 0, 0, 0], 'PANSMALL'], [[2, 0, 0, 0, 0, 0, 0, 0], 'PANSMALL'],
    [[1, 0, 1, 0, 0, 0, 0, 0], 'PANSMALL'], [[3, 0, 0, 0, 0, 0, 0, 0], 'PANMEDIUM'],
    [[4, 0, 0, 0, 0, 0, 0, 0], 'PANMEDIUM'], [[3, 0, 0, 1, 0, 0, 0, 0], 'PANMEDIUM'],
    [[3, 0, 0, 2, 0, 0, 0, 0], 'PANMEDIUM'], [[3, 0, 1, 0, 0, 0, 0, 0], 'PANMEDIUM'],
    [[2, 0, 1, 0, 0, 0, 0, 0], 'PANMEDIUM'], [[2, 0, 1, 1, 0, 0, 0, 0], 'PANMEDIUM'],
    [[4, 0, 1, 0, 0, 0, 0, 0], 'PANLARGE'], [[5, 0, 0, 0, 0, 0, 0, 0], 'PANXLARGE'],
    [[6, 0, 0, 0, 0, 0, 0, 0], 'PANXLARGE'], [[6, 0, 0, 2, 0, 0, 0, 0], 'PANXLARGE'],
    [[0, 1, 0, 0, 0, 0, 0, 0], 'PAN#2MEDIUM'], [[0, 2, 0, 0, 0, 0, 0, 0], 'PAN#2MEDIUM'],
    [[0, 1, 1, 0, 0, 0, 0, 0], 'PAN#2MEDIUM'], [[0, 1, 2, 0, 0, 0, 0, 0], 'PAN#2MEDIUM'],
    [[0, 2, 1, 0, 0, 0, 0, 0], 'PANLARGE'], [[0, 3, 0, 0, 0, 0, 0, 0], 'PANLARGE'],
    [[0, 4, 0, 0, 0, 0, 0, 0], 'PANLARGE'], [[0, 3, 1, 2, 0, 0, 0, 0], 'PANLARGE'],
    [[0, 3, 3, 2, 0, 0, 0, 0], 'PANXXLARGE'], [[0, 5, 0, 0, 0, 0, 0, 0], 'PANXXLARGE'],
    [[0, 6, 0, 0, 0, 0, 0, 0], 'PANXXLARGE'],
    [[1, 1, 0, 0, 0, 0, 0, 0], 'PANMEDIUM'], [[2, 1, 0, 0, 0, 0, 0, 0], 'PANMEDIUM'],
    [[2, 1, 0, 2, 0, 0, 0, 0], 'PANMEDIUM'], [[2, 1, 1, 0, 0, 0, 0, 0], 'PANLARGE'],
    [[1, 2, 0, 0, 0, 0, 0, 0], 'PANLARGE'], [[0, 1, 0, 1, 0, 0, 0, 0], 'PANMEDIUM'],
    [[0, 2, 0, 1, 0, 0, 0, 0], 'PANLARGE'], [[3, 1, 0, 0, 0, 0, 0, 0], 'PANLARGE'],
    [[0, 0, 0, 0, 1, 0, 0, 0], 'PANLARGE'], [[0, 3, 0, 0, 1, 0, 0, 0], 'PANLARGE'],
    [[2, 0, 1, 2, 1, 0, 0, 0], 'PANLARGE'], [[3, 0, 1, 2, 1, 0, 0, 0], 'PANXXLARGE'],
    [[4, 0, 0, 0, 1, 0, 0, 0], 'PANXXLARGE'],
    [[0, 0, 0, 0, 0, 1, 0, 0], 'PANXXLARGE'], [[3, 0, 0, 0, 0, 1, 0, 0], 'PANXXLARGE'],
    [[0, 3, 0, 0, 0, 1, 0, 0], 'PANXXLARGE'], [[0, 6, 0, 0, 0, 1, 0, 0], 'PANOUTER'],
    [[0, 0, 0, 0, 0, 0, 1, 0], 'PANOUTERSMALL'], [[0, 0, 0, 0, 0, 0, 2, 0], 'PANXLARGE'],
    [[0, 0, 0, 0, 0, 0, 4, 0], 'PANOUTERSMALL'],
    [[0, 0, 0, 0, 0, 0, 5, 0], 'PANOUTER'], [[0, 0, 0, 2, 0, 0, 0, 0], 'PANLARGE'],
    [[0, 0, 1, 0, 0, 0, 0, 0], 'PANSMALL'], [[0, 0, 3, 0, 0, 0, 0, 0], 'PANSMALL'],
    [[0, 0, 0, 0, 0, 0, 0, 5], 'PANSMALL'],
  ];
  const fails: string[] = [];
  for (const [a, expected] of CASES) {
    const got = selectBox({ MED: a[0], LRG: a[1], SYR: a[2], ACC: a[3], PAN: a[4], WAF: a[5], WS: a[6], SMP: a[7] });
    if (got !== expected) fails.push(`(${a.join(',')}) → ${got}, expected ${expected}`);
  }
  return fails;
}
