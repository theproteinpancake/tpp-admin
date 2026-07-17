# TPP Box Assignment — Agent Spec

**Version:** 1.1 · 8 June 2026 · **Status:** live in Shopify Flow ("★ MASTER Box Tagging (consolidated)")
**Audience:** an automated logistics agent. This file is self-contained and normative — implement exactly as written.

---

## 1. Contract

**Goal:** given a Shopify order, output **exactly one** box code. The box code is written to the order as a tag; ShipBob reads that tag and packs in that custom box.

**Why it matters:** if the tag is missing or wrong, ShipBob's own auto-packer picks a box that is almost always too large, and we pay the difference in shipping. **Always assign the smallest box that genuinely fits.**

```
INPUT:  order.lineItems[] → { sku, quantity, productTitle, variantTitle }
OUTPUT: exactly one box code from:
        PANSMALL | PAN#2MEDIUM | PANMEDIUM | PANLARGE |
        PANXLARGE | PANXXLARGE | PANOUTERSMALL | PANOUTER
```

The function is **total** — every possible order returns a box. Never return null/empty.

**Process:** (1) expand every line item into eight counters, (2) run the cascade in §4, first match wins, (3) emit one code.

---

## 2. Box catalog

Internal dimensions in mm. Soft powder bags compress, so capacities are empirical, not pure geometry — trust the stated capacity over a volume calculation.

| Code | L×W×D | Capacity |
|---|---|---|
| `PANSMALL` | 220×158×78 | 1–2 Medium (520g) bags, OR 1 Medium + 1 syrup, OR ≤4 syrup alone. **No accessories, no 1kg bags.** |
| `PAN#2MEDIUM` | 260×180×100 | 1–2 Large (1kg) bags, OR 1 Large + ≤2 syrup. The "PANSMALL for 1kg". **No accessories.** |
| `PANMEDIUM` | 310×220×100 | 3–4 Medium bags + Scraper/Flipper; 1 syrup only if ≤3 bags. Also 1 Large + ≤2 Medium (+Scraper/Flipper, **no syrup**). **No Pancake Pan.** |
| `PANLARGE` | 360×260×100 | 3–4 Large bags; 3 Large + 1 syrup + Scraper + Flipper; 1 Pancake Pan alone or with ≤3 bags. The dynamic mixed-cart box. |
| `PANXLARGE` | 320×220×230 | Up to 12 Medium bags. The 520g bulk/outer carton. |
| `PANXXLARGE` | 360×260×200 | 6–8 Large bags + Scraper/Flipper. **Any order containing a Waffle Maker.** The 1kg bulk/outer carton. |
| `PANOUTERSMALL` | — | 1–4 wholesale cartons (320g retail SRP-of-4). |
| `PANOUTER` | 420×300×396 | 5–8 wholesale cartons. **Biggest + most expensive box — last resort only.** |

---

## 3. Line item → counters

Expand each line item into these eight integer counters. **Multiply every contribution by `quantity`.**

| Counter | Meaning |
|---|---|
| `MED` | 520g pancake-mix bags |
| `LRG` | 1kg pancake-mix bags |
| `SYR` | syrup bottles (370ml) |
| `ACC` | flat accessories (Scraper + Flipper) |
| `PAN` | Pancake Pans (rigid, bulky) |
| `WAF` | Waffle Makers |
| `WS` | wholesale cartons (4×320g SRP) |
| `SMP` | 80g sample sachets |

### Matching rules — evaluate in this exact order, first match wins

Normalise: `sku = sku.upper()`, `text = (productTitle + " " + variantTitle).lower()`.

| # | Condition | Contribution (× quantity) |
|---|---|---|
| 1 | `text` contains `"mega stack"` | `LRG += 6` |
| 2 | `text` contains `"6 stack"` AND `"1kg"` | `LRG += 6` |
| 3 | `text` contains `"6 stack"` | `MED += 6` |
| 4 | `text` contains `"big stack"` | `LRG += 3` |
| 5 | `text` contains `"the stack"` | `MED += 3` |
| 6 | `text` contains `"flipper stack"` AND `"1kg"` | `LRG += 1`, `ACC += 1` |
| 7 | `text` contains `"flipper stack"` | `MED += 3`, `ACC += 1` |
| 8 | `text` contains `"sample stack"` | `SMP += 5` |
| 9 | `text` contains `"gift stack"` | `MED += 2` |
| 10 | `text` contains `"accessories bundle"` | `ACC += 2` |
| 11 | `sku == "MSS"` | `SYR += 1` |
| 12 | `sku` in `{"MSS2","MSS3"}` | `SYR += 3` |
| 13 | `sku == "MSS8"` | `WS += 1` |
| 14 | `sku == "TWM"` | `WAF += 1` |
| 15 | `sku == "ACCP"` | `PAN += 1` |
| 16 | `sku` in `{"ACCF","ACCS"}` | `ACC += 1` |
| 17 | `sku` in `{"ACCT","GC1","GIFTY"}` | *(nothing — tote / gift card / gift wrap are not sized)* |
| 18 | `text` contains `"wholesale"` or `"carton"` | `WS += 1` |
| 19 | `text` contains `"sample"` | `SMP += 1` |
| 20 | `text` contains `"1kg"` | `LRG += 1` |
| 21 | *(fallback)* | `MED += 1` |

**Order matters.** `"the big stack"` does not contain `"the stack"` as a substring, but bundles must still be checked before singles, and `MSS8` before the generic `"carton"` rule.

### SKU reference

- Medium bags (`MED`): `BMM, CHM, SCM, CCM, MAM, CIM, GFBM, GFCIM` — variant title contains `520g`/`500g`
- Large bags (`LRG`): `BML, CHL, SCL, CCL, MAL, CIL, GFBL, GFCIL` — variant title contains `1kg`
- Wholesale cartons (`WS`): `BMS, CHS, SCS, CCS, MAS, CIS, GFBS`
- Samples (`SMP`): `BM80, CH80, SC80, CC80, MA80, CI80`
- Bundles: `TS*`/`TSS`/`TSC*` = The Stack (3×520g) · `TBS*` = Big Stack (3×1kg) · `T6S` = 6-Stack 520g · `T6S1`/`TMS*` = 6-Stack/Mega Stack (6×1kg) · `FTFV*` = Flipper Stack · `FTGFFV*` = GF Flipper Stack · `ACCG*` = Gift Stack · `ACCB` = Accessories Bundle · `SAMPLES5` = Sample Stack

> **Known simplification (safe):** the real GF Flipper Stack (`FTGFFV1`) is *2×520g + 1 syrup + 1 flipper*, but rule 7 models it as *3×520g + flipper*. Both resolve to `PANMEDIUM`, so the output is correct. Only revisit if bundle contents change.

---

## 4. The cascade — NORMATIVE

Evaluate top to bottom. **First match wins. Return immediately.**

```
 1. WS  > 0        → WS ≤ 4 ? PANOUTERSMALL : PANOUTER
 2. WAF > 0        → (MED + 2·LRG) > 8 ? PANOUTER : PANXXLARGE
 3. MED=0 & LRG=0 & SYR=0 & ACC=0 & PAN=0
                   → SMP ≤ 12 ? PANSMALL : PANXLARGE      (samples / soft goods only)
 4. MED=0 & LRG=0 & ACC=0 & PAN=0 & SYR>0                  (pure syrup — bottles lie flat)
                   → SYR ≤ 4 ? PANSMALL : SYR ≤ 16 ? PANMEDIUM : PANXLARGE
 5. LRG=0 & PAN=0 & ACC=0 & MED ≤ 2 & SYR ≤ 2 & (MED+SYR) ≤ 2
                   → PANSMALL
 6. MED=0 & PAN=0 & ACC=0 & [ (SYR=0 & 1 ≤ LRG ≤ 2) OR (LRG=1 & SYR ≤ 2) ]
                   → PAN#2MEDIUM
 7. PAN=0 & [
      (a) LRG=0 & 1 ≤ MED ≤ 4 & ACC ≤ 2 & (SYR=0 OR (SYR ≤ 1 & MED ≤ 3))   OR
      (b) LRG=1 & MED ≤ 2 & ACC ≤ 2 & SYR=0
    ]                → PANMEDIUM
 8. LRG=0 & PAN=0 & ACC=0 & MED ≥ 5
                   → MED ≤ 12 ? PANXLARGE : PANOUTER       (520g bulk)
 9. PANLARGE if:
      PAN=0 : (MED·1 + LRG·1.5 + ACC·0.5 + SYR·0.5) ≤ 6
      PAN=1 : (MED+LRG) ≤ 3  AND  ((MED+LRG) + ACC + [1 if SYR>0]) ≤ 5
10. Overflow:
      LRG=0 & PAN=0 → MED ≤ 12 ? PANXLARGE : PANOUTER
      (MED + 2·LRG) ≤ 16 → PANXXLARGE
      else → PANOUTER
```

### Why the non-obvious rules exist

- **Rule 2 (waffle first):** the Waffle Maker (308×242×107) dominates any order it's in → always PANXXLARGE, unless the rest is huge too (Mega Stack + waffle → PANOUTER).
- **Rule 6 vs 7b:** 1kg bags only fit PAN#2MEDIUM / PANLARGE / PANXXLARGE. A single 1kg *may* ride in PANMEDIUM with ≤2 Medium bags, but **2+ 1kg bags always force PANLARGE or bigger**.
- **Syrup is the tie-breaker:** syrup only fits in the gap left when a box isn't full. It's allowed in PANMEDIUM at ≤3 bags, and blocked in rule 7b entirely. `MED=4+SYR=1` → PANLARGE; `MED=2,LRG=1,SYR=1` → PANLARGE.
- **Rule 9 pan clause:** the Pancake Pan is rigid and fills the base, so it can't be scored volumetrically. A pan with ≤3 bags and light extras stays PANLARGE; a pan with 4+ bags, or a full stack + accessories + syrup, overflows to PANXXLARGE.
- **The Flipper is 337mm vs PANMEDIUM's 310mm side** — it fits **diagonally** (base diagonal ≈ 380mm). This is confirmed and intentional; it's why `ACC ≤ 2` is permitted in PANMEDIUM.

---

## 5. Reference implementation

```python
def select_box(MED, LRG, SYR, ACC, PAN, WAF, WS, SMP):
    """Return the single ShipBob box code for an order. First match wins."""
    if WS > 0:
        return 'PANOUTERSMALL' if WS <= 4 else 'PANOUTER'
    if WAF > 0:
        return 'PANOUTER' if (MED + 2 * LRG) > 8 else 'PANXXLARGE'
    if MED == 0 and LRG == 0 and SYR == 0 and ACC == 0 and PAN == 0:
        if SMP > 0:
            return 'PANSMALL' if SMP <= 12 else 'PANXLARGE'
        return 'PANSMALL'
    if MED == 0 and LRG == 0 and ACC == 0 and PAN == 0 and SYR > 0:
        if SYR <= 4:  return 'PANSMALL'
        if SYR <= 16: return 'PANMEDIUM'
        return 'PANXLARGE'
    if LRG == 0 and PAN == 0 and ACC == 0 and MED <= 2 and SYR <= 2 and (MED + SYR) <= 2:
        return 'PANSMALL'
    if MED == 0 and PAN == 0 and ACC == 0:
        if (SYR == 0 and 1 <= LRG <= 2) or (LRG == 1 and SYR <= 2):
            return 'PAN#2MEDIUM'
    if PAN == 0:
        if LRG == 0 and 1 <= MED <= 4 and ACC <= 2 and (SYR == 0 or (SYR <= 1 and MED <= 3)):
            return 'PANMEDIUM'
        if LRG == 1 and MED <= 2 and ACC <= 2 and SYR == 0:
            return 'PANMEDIUM'
    if LRG == 0 and PAN == 0 and ACC == 0 and MED >= 5:
        return 'PANXLARGE' if MED <= 12 else 'PANOUTER'
    if PAN == 0:
        if (MED * 1) + (LRG * 1.5) + (ACC * 0.5) + (SYR * 0.5) <= 6:
            return 'PANLARGE'
    elif PAN == 1:
        bags = MED + LRG
        if bags <= 3 and (bags + ACC + (1 if SYR > 0 else 0)) <= 5:
            return 'PANLARGE'
    if LRG == 0 and PAN == 0:
        return 'PANXLARGE' if MED <= 12 else 'PANOUTER'
    if (MED + 2 * LRG) <= 16:
        return 'PANXXLARGE'
    return 'PANOUTER'
```

---

## 6. Test vectors

All verified against the live Shopify Flow. Use as a regression suite — order is `(MED, LRG, SYR, ACC, PAN, WAF, WS, SMP)`.

```python
CASES = [
    # --- 520g track ---
    ((1,0,0,0,0,0,0,0), 'PANSMALL'),
    ((2,0,0,0,0,0,0,0), 'PANSMALL'),
    ((1,0,1,0,0,0,0,0), 'PANSMALL'),      # 1 medium + 1 syrup
    ((3,0,0,0,0,0,0,0), 'PANMEDIUM'),     # The Stack
    ((4,0,0,0,0,0,0,0), 'PANMEDIUM'),
    ((3,0,0,1,0,0,0,0), 'PANMEDIUM'),     # Flipper Stack
    ((3,0,0,2,0,0,0,0), 'PANMEDIUM'),
    ((3,0,1,0,0,0,0,0), 'PANMEDIUM'),
    ((2,0,1,0,0,0,0,0), 'PANMEDIUM'),
    ((2,0,1,1,0,0,0,0), 'PANMEDIUM'),     # GF Flipper Stack (real contents)
    ((4,0,1,0,0,0,0,0), 'PANLARGE'),      # 4 bags leave no syrup gap
    ((5,0,0,0,0,0,0,0), 'PANXLARGE'),
    ((6,0,0,0,0,0,0,0), 'PANXLARGE'),     # 6-Stack 520g
    ((6,0,0,2,0,0,0,0), 'PANXLARGE'),
    # --- 1kg track ---
    ((0,1,0,0,0,0,0,0), 'PAN#2MEDIUM'),
    ((0,2,0,0,0,0,0,0), 'PAN#2MEDIUM'),
    ((0,1,1,0,0,0,0,0), 'PAN#2MEDIUM'),
    ((0,1,2,0,0,0,0,0), 'PAN#2MEDIUM'),
    ((0,2,1,0,0,0,0,0), 'PANLARGE'),      # 2 large + syrup needs the bigger box
    ((0,3,0,0,0,0,0,0), 'PANLARGE'),      # Big Stack
    ((0,4,0,0,0,0,0,0), 'PANLARGE'),
    ((0,3,1,2,0,0,0,0), 'PANLARGE'),      # Big Stack + syrup + scraper + flipper
    ((0,3,3,2,0,0,0,0), 'PANXXLARGE'),    # 3 syrups tip it over
    ((0,5,0,0,0,0,0,0), 'PANXXLARGE'),
    ((0,6,0,0,0,0,0,0), 'PANXXLARGE'),    # Mega Stack
    # --- mixed ---
    ((1,1,0,0,0,0,0,0), 'PANMEDIUM'),
    ((2,1,0,0,0,0,0,0), 'PANMEDIUM'),
    ((2,1,0,2,0,0,0,0), 'PANMEDIUM'),     # 1 large + 2 medium + both accessories
    ((2,1,1,0,0,0,0,0), 'PANLARGE'),      # ...but a syrup bumps it
    ((1,2,0,0,0,0,0,0), 'PANLARGE'),      # 2 large always PANLARGE+
    ((0,1,0,1,0,0,0,0), 'PANMEDIUM'),
    ((0,2,0,1,0,0,0,0), 'PANLARGE'),
    ((3,1,0,0,0,0,0,0), 'PANLARGE'),
    # --- pancake pan ---
    ((0,0,0,0,1,0,0,0), 'PANLARGE'),      # pan alone
    ((0,3,0,0,1,0,0,0), 'PANLARGE'),      # pan + 3 bags
    ((2,0,1,2,1,0,0,0), 'PANLARGE'),      # pan + 2 bags + acc + syrup
    ((3,0,1,2,1,0,0,0), 'PANXXLARGE'),    # pan + full stack + acc + syrup = too much
    ((4,0,0,0,1,0,0,0), 'PANXXLARGE'),    # pan + 4 bags
    # --- waffle / wholesale / misc ---
    ((0,0,0,0,0,1,0,0), 'PANXXLARGE'),
    ((3,0,0,0,0,1,0,0), 'PANXXLARGE'),
    ((0,3,0,0,0,1,0,0), 'PANXXLARGE'),
    ((0,6,0,0,0,1,0,0), 'PANOUTER'),      # Mega Stack + waffle
    ((0,0,0,0,0,0,1,0), 'PANOUTERSMALL'),
    ((0,0,0,0,0,0,4,0), 'PANOUTERSMALL'),
    ((0,0,0,0,0,0,5,0), 'PANOUTER'),
    ((0,0,0,2,0,0,0,0), 'PANLARGE'),      # accessories only
    ((0,0,1,0,0,0,0,0), 'PANSMALL'),      # single syrup
    ((0,0,3,0,0,0,0,0), 'PANSMALL'),      # syrup 3-pack
    ((0,0,0,0,0,0,0,5), 'PANSMALL'),      # Sample Stack
]

for args, expected in CASES:
    assert select_box(*args) == expected, (args, select_box(*args), expected)
```

---

## 7. Guarantees & safety net

- **Exactly one box per order.** The cascade is exhaustive; there is no path that returns nothing. This is what eliminates both untagged orders and conflicting multi-box tags.
- **Unknown products:** rule 21 silently treats an unrecognised line item as a Medium bag. The live flow therefore also emits a second tag, `BOX-REVIEW`, whenever a line item matches none of the known SKUs/keywords, so a human can check it. **An agent implementing this should do the same:** flag rather than silently guess.
- **Bias:** always smallest viable box. When adding rules, prefer the smaller box unless a stated capacity is exceeded.
- **PANOUTER is the expensive last resort.** If output is PANOUTER for anything other than 5–8 wholesale cartons or a Mega-Stack-plus-waffle, treat it as suspicious and flag.

## 8. Adding a new product

1. Classify it: Medium bag, Large bag, syrup-like filler, flat accessory, bulky accessory (pan-like), waffle-like, or wholesale carton.
2. Add its SKU / title pattern to §3 **above** the fallback (rule 21).
3. If it's a bundle, define its expansion into component counters.
4. Add test vectors to §6. The cascade in §4 usually needs no change — new products just feed the counters.
