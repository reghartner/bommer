# bommer — guitar pedal BOM parser

CLI that reads PCB build doc PDFs, consolidates a BOM, and emits a Tayda Electronics quick-order. Entry point: `bommer2.js`. Run with `node bommer2.js <pdf-or-dir>` (defaults to `./pdfs`). `--debug` logs every extraction decision.

## PDF formats

Three real-world formats. Detection lives in `extractFileParts` and dispatches to one of three parsers:

1. **Parts List** (PedalPCB / Aion) — header `LOCATION VALUE TYPE NOTES`, one component per row. Parsed by `extractPartsList`.
2. **Shopping List** (MadBean / Effects Layouts / some PedalPCB) — `Value | Qty | Type | Rating` rows. Parsed by `extractShoppingList`.
3. **Generic** (older PedalPCB multi-column, e.g. Arachnid, Abider) — three side-by-side mini-tables on the page. Parsed by `extractGenericBom`, which scans every cell for location codes.

`pdf2table` does the extraction. Its cell-splitting is unstable — the same logical row may have 8 cells in one PDF and 9 in another depending on tiny whitespace differences. Any filter keyed on `row.length` or noise keywords is fragile; prefer location-code presence as the discriminator. The bugs fixed in PR #4 were all variations of this.

## Domain rules that the code encodes

- **Generic ICs are interchangeable.** `JRC4558`, `NJM4558`, `RC4558`, `MC4558` → `4558`. `LM741`, `UA741` → `741`. Same for `1458`. Handled by `GENERIC_IC_CORES` with digit-boundary regex (not an alias map). Do NOT add manufacturer-specific entries to `tayda_skus.json` for these cores.
- **IC name matching needs both boundaries.** `LM308` is a substring of `LM3080`, but they're different chips (op-amp vs OTA). `normalizeIc` rejects matches where the trailing character is a digit.
- **Transistor gain-group suffixes don't have separate Tayda SKUs.** `BC550C` and `BC550` order the same part. `findSku` strips a single trailing letter on a `[A-Z]{2}\d{3}` pattern as a fallback.
- **`CLR` is a real component.** It's the LED current limiting resistor in PedalPCB BOMs. Recognized as a resistor location code.
- **Quantity rounding for cheap parts.** Resistors and ceramic caps round up to the nearest 10 (Tayda's pricing breakpoint). See `ROUND_UP_10` in `printTaydaOrder`.
- **Voltage fallback for electrolytics.** SKU lookup tries `value_<voltage>` keys in `ELEC_VOLTAGES` order (25V/35V/16V/...) before giving up.

## Tests

`npm test` runs `node --test test/bom.test.js` — snapshot-based regression against twelve fixtures in `pdfs/`. Each fixture asserts: raw part count, unique BOM count, deep-equal BOM, and stable SKU-miss set.

When parser logic changes legitimately, regenerate snapshots with a one-off node script (see PR #4 for the pattern) — do not hand-edit `test/snapshots.json`.

When adding a new SKU to `tayda_skus.json`, the "SKU matches are stable" assertion will surface the change as a previously-manual part disappearing from `manualParts` — that's the intended signal, regenerate to accept.

## Verifying SKUs against Tayda

Tayda's site sits behind Cloudflare and blocks plain `curl`. The repo has `playwright-extra` + `puppeteer-extra-plugin-stealth` set up for this — use it (or the existing `tayda_verify.js` if present) to confirm SKU numbers before adding to `tayda_skus.json`. Never guess SKU numbers; a wrong SKU silently orders the wrong part.

## Things to never do

- Don't reintroduce a `row.length > N` filter without exempting rows whose first cell is a location code — verbose data rows (transistor spec notes, slide-pot descriptions with Tayda part numbers) routinely exceed any reasonable cap.
- Don't filter rows as "noise" based on substring match alone — multi-column PDFs splice section headers onto data rows. Check for a location code first.
- Don't hardcode IC aliases. If a new jellybean op-amp shows up with multiple manufacturer prefixes, add its core to `GENERIC_IC_CORES`.
