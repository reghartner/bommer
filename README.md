# bommer

Combine guitar pedal build-doc PDFs and generate a [Tayda Electronics](https://www.taydaelectronics.com) quick-order list.

Drop in one PDF or a whole folder of them. Bommer parses the BOM, consolidates quantities across all builds, matches parts to Tayda SKUs, and prints a ready-to-paste order list plus a table of anything it couldn't match.

---

## Setup

```
npm install
```

---

## Usage

```
node bommer2.js [FILE.pdf | DIRECTORY]
```

**Flags**

| Flag | Description |
|------|-------------|
| `--debug` or `--d` | Show per-row parsing decisions — useful for diagnosing a new PDF format |

**Examples**

```bash
# Single build
node bommer2.js pdfs/BlueBreaker-PedalPCB.pdf

# Whole pedal folder — consolidated shopping list for everything
node bommer2.js pdfs/
```

---

## Supported PDF Formats

Bommer auto-detects the BOM format inside each PDF:

| Format | Examples | Structure |
|--------|----------|-----------|
| **Parts List** | PedalPCB, Aion FX | `location, value, type, notes` — one part per row |
| **Shopping List** | Effects Layouts, Long-Tom, Mad Bean | `value, ..., qty` or `value, qty, type, rating` |
| **Generic** | Abyss | Scans all columns for location codes (R1, C3, Q2…) |

Tested build docs:

- **PedalPCB** — BlueBreaker, Bellum MkII, Referee
- **Aion FX** — Neurotron (including transformers, LDRs, rotary switches, resistance-first pot notation)
- **Mad Bean Pedals** — Cosmopolitan Fuzz, Aquababy Delay, Blue Steel Overdrive, Pork Barrel Chorus
- **Effects Layouts** — Distortion Supreme, Tonsorium
- **Long-Tom** — heavily fragmented shopping list rows

---

## SKU Database (`tayda_skus.json`)

Bommer matches each parsed part against `tayda_skus.json`. Component specs are curated for guitar pedal use:

| Category | Spec |
|----------|------|
| **Resistors** | 1/4W metal film |
| **Ceramic caps** | Through-hole MLCC (AEC/Tayda/Multicomp, 50V) where available; disc ceramic for values not stocked as MLCC |
| **Film caps** | Through-hole polyester, ≤100V, 5% tolerance (cheapest in-stock option) |
| **Electrolytic caps** | Through-hole aluminium, ≥25V — no sub-25V fallbacks |
| **Potentiometers** | Alpha/Tayda 16mm, **6.35mm round shaft**, PCB mount |
| **Trimpots** | Tokyo Denshi RM-065 top-adjust, through-hole |
| **LEDs** | 3mm diffused (colour-matched to BOM spec) |
| **Switches** | Dailywell 1M series toggle (SPDT/DPDT); SPST E-TEN |

**Ordering rules**

- Resistors and ceramic caps are rounded up to the nearest 10.
- Electrolytics look up voltage in priority order: 25V → 35V → 50V → 63V → 100V.
- Anything without a matching SKU lands in the "order manually" table at the end.

**Parts never on Tayda** (always manual):

- Rotary switches (3P4T etc.)
- Vactrols / LDR assemblies (NSL-19M51)
- Transformers (LT44)
- Vintage/discontinued transistors (2SK170, AC127, germanium types)

---

## Sample Output

```
BlueBreaker-PedalPCB.pdf — Parts List, 31 parts, 19 unique

=== Consolidated BOM ===
┌─────────┬─────────────────┬──────────┬──────────┐
│ (index) │ type            │ value    │ quantity │
├─────────┼─────────────────┼──────────┼──────────┤
│ 0       │ 'ceramic'       │ '47p'    │ 1        │
│ 1       │ 'diode'         │ '1N5817' │ 1        │
│ 2       │ 'diode'         │ '1N914'  │ 4        │
│ 3       │ 'electrolytic'  │ '100u'   │ 2        │
│ 4       │ 'film'          │ '100n'   │ 2        │
│ 5       │ 'film'          │ '10n'    │ 5        │
│ 6       │ 'ic'            │ 'TL072'  │ 1        │
│ 7       │ 'potentiometer' │ 'A100K'  │ 1        │
│ 8       │ 'potentiometer' │ 'B100K'  │ 1        │
│ 9       │ 'potentiometer' │ 'B25K'   │ 1        │
│ 10      │ 'resistor'      │ '10K'    │ 1        │
│ ...     │ ...             │ ...      │ ...      │
└─────────┴─────────────────┴──────────┴──────────┘

=== Tayda Quick Order ===
A-1352,10    47p ceramic (need 1)
A-159,1      1N5817 diode
A-615,4      1N914 diode
A-6478,2     100u electrolytic
A-4110,2     100n film
A-1078,5     10n film
A-1136,1     TL072 ic
A-5521,1     A100K potentiometer
A-5519,1     B100K potentiometer
A-5598,1     B25K potentiometer
A-7636,10    10K resistor (need 1)
...

✅ All parts matched to SKUs
```

Paste the Tayda Quick Order lines directly into [Tayda's Quick Order page](https://www.taydaelectronics.com/quick-order/).

---

## Adding SKUs

`tayda_skus.json` is a plain JSON file organised by component type. To add a missing part:

```json
{
  "diode": {
    "9.1V ZENER": "A-XXXX"
  }
}
```

Electrolytic caps include the voltage in the key: `"47u_25V": "A-6062"`. The lookup tries 25V first, then 35V, 50V, 63V, 100V — so add the voltage that matches what Tayda stocks.
