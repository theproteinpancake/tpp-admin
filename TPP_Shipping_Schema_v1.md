# The Protein Pancake — Shipping & Box-Tagging Schema

**Version:** 1.0  **Last updated:** 7 June 2026
**Purpose:** Single source of truth for how every Shopify order should be tagged with a custom ShipBob box code. Upload this file to any AI model when you need help with box logic, a new product, or a broken flow.

**Why this exists:** ShipBob's auto-packing chooses a larger box than necessary. We tag each Shopify order with a box code; ShipBob reads the tag and uses that exact custom box. If the tag is missing or wrong, ShipBob over-boxes and our shipping cost rises. The golden rule below is therefore: **tag every order with the single smallest box that genuinely fits.**

---

## 1. Boxes (smallest → largest)

| Code | Internal L×W×D (mm) | Designed for | Hard capacity rules |
|---|---|---|---|
| **PANSMALL** | 220 × 158 × 78 | 520g (Medium) bags | 1–2 Medium bags **OR** 1 Medium + 1 syrup **OR** up to ~4 syrup bottles alone. **No accessories. No 1kg bags.** |
| **PAN#2MEDIUM** | 260 × 180 × 100 | 1kg (Large) bags | 1–2 Large bags **OR** 1 Large + up to 2 syrup. The "PANSMALL for 1kg bags." **No accessories.** |
| **PANMEDIUM** | 310 × 220 × 100 | 520g bags + accessories | 3–4 Medium bags; fits Scraper and/or Flipper even with 4 bags; fits 1 syrup **only if ≤3 bags**. Also holds 1 Large + up to 2 Medium, with a Scraper/Flipper allowed (diagonal) but **no syrup** (syrup → PANLARGE). **No Pancake Pan.** |
| **PANLARGE** | 360 × 260 × 100 | 1kg bags + dynamic mixes | 3–4 Large bags; **OR** 3 Large + 1 syrup; fits 1 Pancake Pan alone or with 1–3 bags; fits Scraper + Flipper. The go-to "mixed cart" box. |
| **PANXLARGE/520G** | 320 × 220 × 230 | 520g bulk | Up to 12 Medium bags. Used for the 6-Stack (520g) and any medium-heavy order. (This is also the carton 520g bags arrive in.) |
| **PANXXLARGE/1KG** | 360 × 260 × 200 | 1kg bulk + Waffle Maker | 6–8 Large bags + room for Scraper/Flipper. Holds the Mega Stack (6×1kg). **Any order containing the Waffle Maker goes here.** (Carton 1kg bags arrive in.) |
| **PANOUTERSMALL** | — | Wholesale | 1–4 wholesale cartons (320g retail SRP-of-4). |
| **PANOUTER** | 420 × 300 × 396 | Wholesale (huge) | 4–8 wholesale cartons. **Our biggest/most expensive box — only when nothing else fits. Never let ShipBob default to this.** |

> **Capacity note:** Our pancake bags are soft powder pouches that compress, so these capacities are slightly generous vs. rigid dimensions. The rules below were validated against 6,279 real orders.

---

## 2. Products → packing categories

Every line item maps to one of these categories. **Bundles are detected by the product title**, then expanded into their component bags.

### Single products (by SKU)

| Category | What it is | SKUs / pattern |
|---|---|---|
| **Medium bag (520g)** | 1× 520g pancake mix | `*M` — BMM, CHM, SCM, CCM, MAM, CIM, GFBM, GFCIM (variant title contains `520g`/`500g`) |
| **Large bag (1kg)** | 1× 1kg pancake mix | `*L` — BML, CHL, SCL, CCL, MAL, CIL, GFBL, GFCIL (variant title contains `1kg`) |
| **Syrup** | 1 bottle Sugar Free Maple Syrup | `MSS` (1 bottle), `MSS3`/`MSS2` (multipack → 3 / 2 bottles) |
| **Syrup carton** | Wholesale 8-pack | `MSS8` → treat as a wholesale carton |
| **Scraper** | The Scraper (flat) | `ACCS` |
| **Flipper** | The Flipper (flat, 337mm long) | `ACCF` |
| **Pancake Pan** | The Pancake Pan (rigid, bulky) | `ACCP` |
| **Waffle Maker** | The Waffle Maker (large, 308×242×107) | `TWM` |
| **Wholesale carton** | 320g retail bag, SRP of 4 | `CCS, CHS, MAS, CIS, GFBS, BMS, SCS` (title contains `Wholesale`/`Carton`) |
| **Sample** | 80g sample (tiny filler) | `*80` — BM80, CH80, etc. |
| **Soft / non-shipping** | Tote, gift card, gift wrap | `ACCT, GC1, GIFTY` (ignore for box sizing) |

### Bundles (detected by product title → expand to components)

| Bundle title contains… | SKU prefix | Expands to |
|---|---|---|
| **"The Stack"** (1.5kg) | `TS*`, `TSS`, `TSC` | 3 × Medium bag |
| **"The Big Stack"** (3kg) | `TBS*` | 3 × Large bag |
| **"The 6 Stack … 520g"** (3kg) | `T6S` | 6 × Medium bag |
| **"The 6 Stack … 1kg"** (6kg) | `T6S1` | 6 × Large bag |
| **"The Mega Stack"** (6kg) | `TMS*` | 6 × Large bag |
| **"First Time Flipper Stack"** (520g, regular) | `FTFV*` | N × Medium bag + 1 Flipper (N = number of flavours) |
| **"First Time Gluten Free Flipper Stack" (520g)** | `FTGFFV1` | 2 × Medium bag + 1 Syrup + 1 Flipper → **PANMEDIUM** |
| **"First Time … Flipper Stack … 1kg / 2×1kg"** | `FTGFFV2/3` | 1–2 × Large bag + 1 Flipper |

> The live flow currently counts every 520g flipper stack as "3 medium + flipper" for simplicity. For the GF stack (2 medium + syrup + flipper) this still resolves to **PANMEDIUM**, so the box is correct — no flow change required. Only revisit if the bundle's contents change.
| **"The Sample Stack"** | `SAMPLES5` | 5 × Sample |
| **"The Pancake Gift Stack"** | `ACCG*` | N × Medium bag (N = flavours, default 2) |
| **"Accessories Bundle"** | `ACCB` | Scraper + Flipper |

> **Multiply by line-item quantity.** A line of "2 × The Big Stack" = 6 Large bags.

---

## 3. Master box-selection logic (the algorithm)

Compute totals across the whole order, then apply rules **top to bottom — first match wins**:

```
INPUTS (totals across all line items, bundles expanded):
  MED   = number of 520g bags
  LRG   = number of 1kg bags
  SYR   = number of syrup bottles
  ACC   = number of flat accessories (Scraper + Flipper)
  PAN   = number of Pancake Pans
  WAF   = number of Waffle Makers
  WS    = number of wholesale cartons (incl. MSS8)
  SMP   = number of 80g samples
  (Tote / gift card / gift wrap are ignored for sizing.)

RULES (first match wins):

 1. WS > 0:              WS ≤ 4 → PANOUTERSMALL ;  else → PANOUTER
 2. WAF > 0:             (MED + 2·LRG) > 8 → PANOUTER ;  else → PANXXLARGE
 3. Only samples/soft:   SMP ≤ 12 → PANSMALL ;  else → PANXLARGE
 4. Pure syrup (no bags/acc/pan):
                         SYR ≤ 4 → PANSMALL ;  SYR ≤ 16 → PANMEDIUM ;  else → PANXLARGE
 5. PANSMALL:    LRG=0, PAN=0, ACC=0  AND  MED ≤ 2, SYR ≤ 2, (MED+SYR) ≤ 2
 6. PAN#2MEDIUM: MED=0, PAN=0, ACC=0  AND  ( (SYR=0 and 1≤LRG≤2) or (LRG=1 and SYR≤2) )
 7. PANMEDIUM:   PAN=0  AND either
                   (a) LRG=0, 1≤MED≤4, ACC≤2, and (SYR=0 OR (SYR≤1 and MED≤3)) ; or
                   (b) LRG=1, MED≤2, ACC≤2, SYR=0    ← "1 large + up to 2 medium (+ scraper/flipper diagonally), no syrup"
 8. Pure medium bulk:    LRG=0, PAN=0, ACC=0, MED ≥ 5  →  MED ≤ 12 ? PANXLARGE : PANOUTER
 9. PANLARGE:
     • if PAN=0:  (MED + 1.5·LRG + 0.5·ACC + 0.5·SYR) ≤ 6  →  PANLARGE
     • if PAN=1:  (MED+LRG) ≤ 3  AND  (MED+LRG + ACC + [1 if SYR>0]) ≤ 5  →  PANLARGE
       (a Pancake Pan with 4+ bags, or with a full stack + accessories + syrup, falls through → PANXXLARGE)
10. Overflow:    LRG=0 and PAN=0 → PANXLARGE (≤12 med) ;
                 else (MED + 2·LRG) ≤ 16 → PANXXLARGE ;  else → PANOUTER
```

**One order → one path → exactly one box tag.** This structure makes the double-tagging problem impossible.

---

## 4. Validated lookup table (most common real combinations)

Notation: `med`=520g bags, `lrg`=1kg bags, `syr`=syrup, `acc`=scraper/flipper, `pan`=pancake pan, `waf`=waffle, `ws`=wholesale carton, `smp`=sample.

| Order contents | Correct box |
|---|---|
| 1 medium | PANSMALL |
| 2 medium | PANSMALL |
| 1 medium + 1 syrup | **PANSMALL** *(was over-boxed to PANMEDIUM)* |
| 1–4 syrup only | PANSMALL |
| Sample Stack (5 samples) | PANSMALL |
| 3 medium (The Stack) | PANMEDIUM |
| 4 medium | PANMEDIUM |
| 3 medium + 1 flipper (First-Time Flipper Stack) | **PANMEDIUM** *(was untagged / PANSMALL)* |
| 3 medium + scraper + flipper | PANMEDIUM |
| 3 medium + 1 syrup | PANMEDIUM |
| 2 medium + 1 syrup | PANMEDIUM |
| 1 medium + 1 large | PANMEDIUM |
| 2 medium + 1 large | PANMEDIUM |
| 1–2 medium + 1 large + scraper/flipper (no syrup) | PANMEDIUM |
| 1–2 medium + 1 large + syrup | PANLARGE |
| 2 large + a 520g (or any 2+ large) | PANLARGE |
| 5–12 medium (6-Stack 520g) | **PANXLARGE** *(was untagged)* |
| 1 large | PAN#2MEDIUM |
| 2 large | PAN#2MEDIUM |
| 1 large + 1 syrup | **PAN#2MEDIUM** *(was untagged)* |
| 1 large + 1–2 syrup | PAN#2MEDIUM |
| 3 large (Big Stack) | PANLARGE |
| 4 large | PANLARGE |
| 3 large + 1 syrup | PANLARGE |
| 3 large + 1 syrup + scraper + flipper | PANLARGE |
| 3 large + 3 syrups + scraper + flipper | PANXXLARGE *(3 bottles exceed PANLARGE)* |
| 2 large + 1 syrup | PANLARGE |
| 1 large + scraper/flipper (no syrup) | PANMEDIUM |
| 2 large + accessory | PANLARGE |
| Pancake Pan (alone or + 1–3 bags) | PANLARGE |
| Pancake Pan + 2 medium + scraper + flipper + syrup | PANLARGE |
| 6 large (Mega Stack / 6-Stack 1kg) | **PANXXLARGE** *(was wrongly PANXLARGE)* |
| 5 large | PANXXLARGE |
| Anything + Waffle Maker | PANXXLARGE |
| Waffle Maker + Mega Stack | PANOUTER |
| 1–4 wholesale cartons | PANOUTERSMALL |
| 5–8 wholesale cartons | PANOUTER |

---

## 5. Judgment calls to confirm

These are the few spots where geometry, your prose, and order history disagreed. Current logic uses the choice in **bold**; flag if you want a different default.

1. **Flipper in PANMEDIUM** → **CONFIRMED ALLOWED** (diagonal fit, base diagonal ≈ 380mm > 337mm). So 3 medium + flipper = PANMEDIUM. This is the cheaper choice and is what's now live in the logic. If a flipper ever creases a PANMEDIUM box in practice, the one-line reversal is: any order containing a Flipper → PANLARGE.

2. **4 medium + syrup** → currently **PANLARGE** (the syrup gap only exists at ≤3 bags). History squeezed it into PANMEDIUM. PANLARGE is the safe call.

3. **6×520g (6-Stack) → PANXLARGE** and **6×1kg (Mega Stack) → PANXXLARGE**: chosen for symmetry with the outer cartons and safety. A 5–6 × 520g order *might* fit PANLARGE more cheaply if you want to test it.

4. **Pancake-Pan-heavy combos** → **CONFIRMED to bump up**. A Pancake Pan stays in PANLARGE only with ≤3 bags and light extras (per Rule 9); a pan with 4+ bags, or with a full stack + accessories + syrup, goes to **PANXXLARGE**. This matches your "that would be too much" description.

---

## 6. What was broken before (validation summary)

Running this logic over your last 6,279 orders vs. what was actually tagged:

- **950 orders had NO box tag** and would have been auto-boxed (over-sized) by ShipBob. Most are syrup combos, First-Time Flipper Stacks, 6-Stacks, and wholesale orders. All now tagged.
- **232 orders had conflicting double tags** (e.g. `PANLARGE, PANMEDIUM`) from multiple flows firing at once. All now resolve to one box.
- **698 orders were under-tagged (box too small to physically fit)** — chiefly First-Time Flipper Stacks tagged PANSMALL, 3-bag orders tagged PANSMALL, the Mega Stack in the 520g box, and 3×1kg in the 2-bag box. All corrected upward.
- **133 orders were over-boxed** and now drop to a smaller, cheaper box — led by `1 medium + 1 syrup` (98 orders) moving PANMEDIUM → PANSMALL.

New box distribution across all orders: PANSMALL 1,876 · PANMEDIUM 1,845 · PAN#2MEDIUM 1,094 · PANLARGE 859 · PANXXLARGE 287 · PANOUTERSMALL 178 · PANXLARGE 136 · PANOUTER 4.

---

## 7. Adding a new product later

1. Decide its category: Medium bag, Large bag, syrup-like filler, flat accessory, bulky accessory, or wholesale carton.
2. Add its SKU / title pattern to Section 2.
3. If it's a bundle, define how it expands into component bags.
4. Re-check Sections 3–4; usually no rule change is needed — the new product just feeds the totals.
