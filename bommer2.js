"use strict";
// bommer2.js — BOM parser for guitar pedal build docs → Tayda quick order
const fs = require("fs");
const path = require("path");
const pdf2table = require("pdf2table");

const DEBUG = process.argv.includes("--debug") || process.argv.includes("--d");

// ─── Location code → component type ─────────────────────────────────────────

function typeFromLocation(loc) {
  loc = loc.trim().toUpperCase();
  if (/^R\d+$/.test(loc))              return "resistor";
  if (/^C\d+$/.test(loc))              return "capacitor";   // sub-typed from value
  if (/^Q\d+$/.test(loc))              return "transistor";
  if (/^D\d+$/.test(loc))              return "diode";
  if (/^LED\d*$/.test(loc))            return "led";
  if (/^IC\d+$/.test(loc))             return "ic";
  if (/^SW\d*$/.test(loc))             return "switch";
  if (/^(POT|16MM)\d*$/.test(loc))     return "potentiometer";
  if (/^(VR|TPOT|TRIM)\d*$/.test(loc)) return "trimpot";
  if (/^LDR\d*$/.test(loc))            return "ldr";         // light-dependent resistor — skip
  if (/^XFM\d*$/.test(loc))            return "transformer"; // transformer assembly — skip
  return null;
}

// When the location code is non-standard (e.g. "VOLUME", "BASS"), infer type from the value
function typeFromValue(value) {
  const v = value.trim().toUpperCase();
  if (/^[ABCW]\d{1,4}[MK]/.test(v))        return "potentiometer"; // taper-first: B100K
  if (/^\d+\.?\d*[KM][ABCW]$/.test(v))     return "potentiometer"; // resistance-first: 100kB (Aion FX)
  if (/^(SPDT|DPDT|SPST|DPST)\b/.test(v))  return "switch";
  if (/^\d+P\d+T\b/.test(v))               return "switch";        // rotary: 3P4T
  if (/^\d+\.?\d*[KM]\s*TRIM$/.test(v))    return "trimpot";
  return null;
}

// ─── Value normalizers ───────────────────────────────────────────────────────

function normalizeResistor(raw) {
  let v = raw.toUpperCase()
    .replace(/OHM(S)?/, "R").replace("Ω", "R").replace("KΩ", "K").replace("MΩ", "M");
  if (/^\d+$/.test(v)) v += "R";
  // compact notation: 4K7 → 4.7K
  v = v.replace(/^(\d+)([KMR])(\d+)$/, "$1.$3$2");
  return v;
}

// Returns { capType, value } where capType is ceramic | film | electrolytic
function normalizeCapacitor(raw, context) {
  const s = raw.toLowerCase().replace(/\s/g, "");
  const ctx = context.toLowerCase();

  // Determine sub-type
  let capType;
  if (/p(f?)$/.test(s) || /\d+p/.test(s) || /ceramic|disk|mlcc/i.test(ctx)) capType = "ceramic";
  else if (/n(f?)$/.test(s) || /\d+n/.test(s) || /film|mylar/i.test(ctx))   capType = "film";
  else if (/u(f?)$/.test(s) || /\d+u/.test(s) || /electro|alum|tantalum|µ|μ/i.test(ctx)) capType = "electrolytic";
  else if (/ceramic|disk/i.test(ctx))    capType = "ceramic";
  else if (/film|mylar/i.test(ctx))      capType = "film";
  else if (/electro|alum/i.test(ctx))    capType = "electrolytic";
  else                                    capType = "film"; // reasonable default

  // Normalise suffix
  let value = s
    .replace(/µ|μ/g, "u").replace("uf", "u").replace("mf", "u")
    .replace("pf", "p").replace("nf", "n");

  // bare number → add unit
  const unitDefaults = { ceramic: "p", film: "n", electrolytic: "u" };
  if (/^\d+(\.\d+)?$/.test(value)) value += unitDefaults[capType];

  // compact: 4n7 → 4.7n etc.
  value = value.replace(/^(\d+)([pnu])(\d+)$/, "$1.$3$2");

  return { capType, value };
}

const KNOWN_TRANSISTORS = [
  "2N3904","2N3906","2N5088","2N5089","2N5087","2N2222A","2N2222","2N2907A",
  "2N5457","2N5458","2N5484","2N5550","2N7000","2N5551","2N5401","2N4401","2N4403",
  "J201","J113","J111","J112","J175","J176","J109",
  "BC549C","BC549","BC550C","BC550","BC560C","BC560","BC547","BC548","BC546",
  "BC557","BC558","BC559","BC109","BC107","BC108",
  "BS170","MPF102","MPSA18","MPSA42","MPSA92","PN2222A","PN2907A",
  "2SC1815","2SK117","2SK170","PF5102","MP38A",
  "AC127","AC128","AC176","OC44","OC71","OC75","NKT275",
];

function normalizeTransistor(raw, context) {
  // Try raw value first — don't let notes columns (e.g. "can sub 2N5088") override
  const rawUC = raw.toUpperCase().replace(/[^A-Z0-9]/g, " ");
  for (const t of KNOWN_TRANSISTORS) {
    if (new RegExp(`\\b${t}\\b`).test(rawUC)) return t;
  }
  const combined = (raw + " " + context).toUpperCase().replace(/[^A-Z0-9]/g, " ");
  for (const t of KNOWN_TRANSISTORS) {
    if (new RegExp(`\\b${t}\\b`).test(combined)) return t;
  }
  // Generic extraction: part-number-shaped token
  const m = combined.match(/\b(2[NS][A-Z]?\d{3,4}[A-Z]?|J\d{3}|BC\d{3}[A-Z]?|BS\d{3}|MPF\d{3}|MPSA\d{2}|BF\d{3}[A-Z]?)\b/);
  if (m) return m[1];
  return raw.trim().toUpperCase();
}

const KNOWN_DIODES = [
  "1N4148","1N4001","1N4002","1N4003","1N4004","1N4005","1N4006","1N4007",
  "1N5817","1N5818","1N5819","1N5822","1N914","1N916","1N60P","1N60","1N34A","1N270",
  "1N4728","1N4729","1N4730","1N4731","1N4732","1N4733","1N4734","1N4735",
  "1N4736","1N4737","1N4738","1N4739A","1N4740A","1N4741A","1N4742A",
  "1N4743A","1N4744A","1N4745A","1N4746A","1N4747A","1N4748A",
  "BAT41","BAT42","BAT43","BAT46","BAT48",
];

const LED_COLORS = ["RED","GREEN","BLUE","YELLOW","WHITE","ORANGE","RGB","UV","IR"];

function isLedContext(raw, context) {
  const s = (raw + " " + context).toUpperCase();
  return /\b(3MM|5MM|T1|T1\.75)\b/.test(s) || LED_COLORS.some(c => new RegExp(`\\b${c}\\b`).test(s));
}

function normalizeDiode(raw, context) {
  if (isLedContext(raw, context)) return normalizeLed(raw, context);
  const combined = (raw + " " + context).toUpperCase();
  for (const d of KNOWN_DIODES) {
    if (new RegExp(`\\b${d}\\b`).test(combined)) return { diodeType: "diode", value: d };
  }
  return { diodeType: "diode", value: raw.trim().toUpperCase() };
}

function normalizeLed(raw, context) {
  const combined = (raw + " " + context).toUpperCase();
  const color = LED_COLORS.find(c => new RegExp(`\\b${c}\\b`).test(combined)) ?? "any";
  return color.charAt(0) + color.slice(1).toLowerCase();
}

function normalizeSwitch(raw, context) {
  const combined = (raw + " " + context).toUpperCase();
  // Rotary: 3P4T, 2P6T, etc.
  const rotary = combined.match(/\b(\d+P\d+T)\b/)?.[1];
  if (rotary) return rotary + " ROTARY";
  const kind   = combined.match(/\b(SPDT|DPDT|SPST|DPST)\b/)?.[1] ?? "";
  const action = combined.match(/\b(ON\/OFF\/ON|ON\/ON\/ON|ON\/ON)\b/)?.[1] ?? "";
  return [kind, action].filter(Boolean).join(" ") || raw.trim().toUpperCase();
}

function normalizePot(raw, context) {
  const combined = (raw + " " + context).toUpperCase();
  const dual = /\b(DUAL|DUAL.GANG|DUAL.GANG)\b/i.test(combined) ? " DUAL" : "";

  // Taper-first: B100K, A100K, W100K
  const m1 = combined.match(/\b([ABCW]\d{1,4}[MK])\b/);
  if (m1) return m1[1] + dual;

  // Resistance-first: 100kB → B100K — search combined so it works from extractCompactValue too
  const m2 = combined.match(/(?:^|\s)(\d+\.?\d*)([KM])([ABCW])(?:\s|$)/);
  if (m2) {
    const ohms = parseFloat(m2[1]);
    const unit = m2[2];
    const taper = m2[3];
    const valStr = Number.isInteger(ohms) ? `${ohms}${unit}` : `${ohms}${unit}`;
    return taper + valStr + dual;
  }

  return raw.trim().toUpperCase();
}

function normalizeTrimpot(raw) {
  const m = raw.trim().toUpperCase().match(/(\d+\.?\d*[KM])/);
  return m ? m[1] : raw.trim().toUpperCase();
}

const KNOWN_ICS = [
  "TL071","TL072","TL074","TL082","TL084","NE5532","NE5534","LM741","LM1458",
  "LM324","LM308","LM386","OP275","OP07","NJM4558","RC4558","LM13700","PT2399",
  "TL022","TL062","TL064","CA3130","LM358","LM833",
  "CD4053","CD4069","CD4066","CD4013","CD4040","CD4049","CD4093",
].sort((a, b) => b.length - a.length); // longest first to avoid prefix collision

function normalizeIc(raw) {
  const uc = raw.trim().toUpperCase();
  for (const ic of KNOWN_ICS) {
    const idx = uc.indexOf(ic);
    if (idx === -1) continue;
    // Ensure it's not in the middle of a larger alphanumeric token
    const before = uc[idx - 1];
    if (before && /[A-Z0-9]/.test(before)) continue;
    return ic;
  }
  return uc;
}

// ─── Row → part ──────────────────────────────────────────────────────────────

// Given a location code and raw value string + full row context, return a {type, value} part or null.
function parsePart(location, rawValue, rowContext) {
  if (/^omit$/i.test(rawValue.trim())) return null;
  const baseType = typeFromLocation(location) ?? typeFromValue(rawValue);
  if (!baseType) return null;

  const ctx = rowContext;

  if (baseType === "resistor") {
    return { type: "resistor", value: normalizeResistor(rawValue) };
  }

  if (baseType === "capacitor") {
    const { capType, value } = normalizeCapacitor(rawValue, ctx);
    return { type: capType, value };
  }

  if (baseType === "transistor") {
    return { type: "transistor", value: normalizeTransistor(rawValue, ctx) };
  }

  if (baseType === "diode") {
    const { diodeType, value } = normalizeDiode(rawValue, ctx);
    if (diodeType === "led") return { type: "led", value };
    return { type: "diode", value };
  }

  if (baseType === "led") {
    return { type: "led", value: normalizeLed(rawValue, ctx) };
  }

  if (baseType === "ic") {
    return { type: "ic", value: normalizeIc(rawValue) };
  }

  if (baseType === "switch") {
    return { type: "switch", value: normalizeSwitch(rawValue, ctx) };
  }

  if (baseType === "potentiometer") {
    return { type: "potentiometer", value: normalizePot(rawValue, ctx) };
  }

  if (baseType === "trimpot") {
    return { type: "trimpot", value: normalizeTrimpot(rawValue) };
  }

  if (baseType === "transformer" || baseType === "ldr") {
    return { type: baseType, value: rawValue.trim().toUpperCase() };
  }

  return null;
}

// ─── BOM format detection & extraction ──────────────────────────────────────

// Noise rows to skip regardless of format
const NOISE = [
  /COPYRIGHT|©|PEDALPCB/i,
  /RESISTORS|CAPACITORS|TRANSISTORS|INTEGRATED CIRCUITS/i,
  /PAGE \d+|CONTINUED|NEXT PAGE/i,
  /^(LOCATION|VALUE|TYPE|NOTES|DIAGRAM|SCHEMATIC)$/i,
  /WIRING DIAGRAM|SCHEMATIC DIAGRAM/i,
];
function isNoise(row) {
  const flat = row.join(" ");
  return NOISE.some(r => r.test(flat));
}

// Expand "D2-D5" → ["D2","D3","D4","D5"], "Q1-Q5" → 5 items, etc.
function expandLocations(loc) {
  const m = loc.match(/^([A-Z]+)(\d+)-[A-Z]*(\d+)$/i);
  if (!m) return [loc];
  const prefix = m[1], from = parseInt(m[2]), to = parseInt(m[3]);
  if (to <= from || to - from > 30) return [loc];
  return Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
}

// PedalPCB / Aion "Parts List": columns are [location, value, type?, notes?]
function extractPartsList(rows) {
  const parts = [];
  for (const row of rows) {
    if (isNoise(row) || row.length < 2) continue;
    if (row.length > 8) continue; // schematic/diagram rows have 15+ cells
    const [location, value] = row;
    const ctx = row.join(" ");

    // Expand range location codes: "D2-D5" → 4 individual locations
    const locs = expandLocations(location);

    for (const loc of locs) {
      let part = parsePart(loc, value, ctx);

      // Fallback: infer type from the type-description columns (row[2+])
      // Skip if the location maps to a non-standard type we don't order (LDR, transformer, etc.)
      const locType = typeFromLocation(loc);
      if (!part && row.length >= 3 && locType === null) {
        const typeDesc = row.slice(2).join(" ");
        const inferredType = inferShoppingType(typeDesc);
        if (inferredType) {
          const compact = value.replace(/\s+/g, "");
          const v = extractCompactValue(inferredType, compact, ctx);
          if (v) part = { type: inferredType, value: v };
        }
      }

      if (part) {
        if (DEBUG) console.debug(`  ✓ ${loc} → ${part.type} ${part.value}`);
        parts.push(part);
      } else {
        if (DEBUG) console.debug(`  ? skipped: ${row.join(" | ")}`);
      }
    }
  }
  return parts;
}

// Shopping list rows can be heavily fragmented by PDF extraction.
// Strategy: join all non-qty cells into a compact string, infer type from keywords,
// then extract value using type-appropriate patterns on the compact string.

// Order matters: check trimpot before pot, specific before general
const SHOPPING_TYPE_RULES = [
  [/trim\s*pot|trimmer|trim\b/i,                          "trimpot"],
  [/potentiometer|16\s*mm|right\s*angle/i,                "potentiometer"],
  [/¼|1\/4|quarter|metal.?film|carbon.?film|watt|resistor/i, "resistor"],
  [/ceramic|disk/i,                                        "ceramic"],
  [/electro|alum/i,                                        "electrolytic"],
  [/film|mylar/i,                                          "film"],
  [/jfet|bjt|mosfet|transistor/i,                          "transistor"],
  [/schottky|schotky|rectifier|zener|diode/i,              "diode"],
  [/3\s*mm|5\s*mm|led/i,                                   "led"],
  [/op.?amp|opamp/i,                                       "ic"],
  [/switch|toggle|spdt|dpdt|spst|dpst/i,                   "switch"],
];

function inferShoppingType(text) {
  for (const [re, type] of SHOPPING_TYPE_RULES) {
    if (re.test(text)) return type;
  }
  return null;
}

// Infer type from a bare part-number value when no type keyword is present
function typeFromPartNumber(value) {
  const uc = value.trim().toUpperCase().replace(/\s+/g, "");
  // Diodes — check known list and common patterns
  for (const d of KNOWN_DIODES) { if (uc === d || uc.replace(/^1N/, "") === d.replace(/^1N/, "")) { /* handled below */ } }
  if (/^1N\d{2,4}[A-Z]?$/.test(uc) || /^BAT\d{2}[A-Z]?$/.test(uc) || /^BAV\d{2}$/.test(uc)) return "diode";
  // Shorthand: "4148" → 1N4148, "914" → 1N914
  if (/^(4148|914|4001|4007|5817|5819)$/.test(uc)) return "diode";
  // Transistors — check known list
  const ucSpaced = uc.replace(/[^A-Z0-9]/g, " ");
  for (const t of KNOWN_TRANSISTORS) {
    if (new RegExp(`\\b${t}\\b`).test(ucSpaced)) return "transistor";
  }
  // Generic transistor patterns not in known list
  if (/^(2[NS][A-Z]?\d{3,4}[A-Z]?|J\d{3}|BC\d{3}[A-Z]?|BS\d{3}|BF\d{3}[A-Z]?|AC\d{3}[A-Z]?|OC\d{2}[A-Z]?|NKT\d{3})$/.test(uc)) return "transistor";
  // ICs
  for (const ic of KNOWN_ICS) { if (uc.startsWith(ic)) return "ic"; }
  // Potentiometer (resistance-first: 10kB, 100kA)
  if (/^\d+\.?\d*[KM][ABCW]$/.test(uc)) return "potentiometer";
  return null;
}

// Extract value from compact body (all non-qty cells joined, no spaces) + full body
function extractCompactValue(type, compact, full) {
  switch (type) {
    case "resistor": {
      // Handles: "100Ω", "4K7", "1M", "10k", "47"
      const m = compact.match(/^(\d+\.?\d*)(Ω|ohm|R|K|M|k|m)(\d+)?/i);
      if (!m) return null;
      let raw = m[1] + m[2].toUpperCase() + (m[3] ?? "");
      return normalizeResistor(raw);
    }
    case "ceramic":
    case "film":
    case "electrolytic": {
      // Capture optional trailing digits for compact notation: 3n3→3.3n, 4n7→4.7n
      const m = compact.match(/^(\d+\.?\d*)(pF|nF|uF|µF|µ|p|n|u)(\d+)?/i);
      if (!m) return null;
      const { capType, value } = normalizeCapacitor(m[1] + m[2] + (m[3] ?? ""), full);
      return value;
    }
    case "transistor": {
      // startsWith handles fragmented part numbers: "2N5"+"457"+"JFET" → compact "2N5457JFET"
      const compactUC = compact.toUpperCase();
      for (const t of KNOWN_TRANSISTORS) {
        if (compactUC.startsWith(t)) return t;
      }
      return normalizeTransistor("", compact + " " + full);
    }
    case "diode": {
      if (isLedContext("", full)) return null;
      const uc = compact.toUpperCase();
      // Known diodes (handles fragmented "1N"+"5817" and prevents suffix garbage)
      for (const d of KNOWN_DIODES) { if (uc.includes(d)) return d; }
      // Shorthand: "4148" → 1N4148, "914" → 1N914
      const shorthand = { "4148":"1N4148","1N4148":"1N4148","914":"1N914","1N914":"1N914" };
      const sh = Object.keys(shorthand).find(k => uc.startsWith(k));
      if (sh) return shorthand[sh];
      // Zener: value like "9.1V" or "5.6V" when context says zener
      if (/zener/i.test(full)) {
        const zm = compact.match(/^(\d+\.?\d*)[Vv]/);
        if (zm) return zm[1] + "V ZENER";
      }
      // Generic regex fallback
      const m = uc.match(/(1N\d{3,4}[AB]?|BAT\d{2}[A-Z]?|BAV\d{2})/);
      return m ? m[1] : null;
    }
    case "led":
      return normalizeLed("", full + " " + compact);
    case "ic":
      return normalizeIc(compact);
    case "switch": {
      // startsWith handles fragmented: "SP"+"DT"+"T"+"oggle" → compact "SPDTToggle"
      const compactUCsw = compact.toUpperCase();
      const rotaryM = compactUCsw.match(/^(\d+P\d+T)/);
      if (rotaryM) return rotaryM[1] + " ROTARY";
      const kindMatch = ["SPDT","DPDT","SPST","DPST"].find(k => compactUCsw.startsWith(k));
      if (kindMatch) return normalizeSwitch(kindMatch, full);
      return normalizeSwitch("", compact + " " + full);
    }
    case "potentiometer":
      return normalizePot("", compact + " " + full);
    case "trimpot": {
      const m = (compact + " " + full).toUpperCase().match(/(\d+\.?\d*[KM])\s*TRIM/);
      return m ? m[1] : normalizeTrimpot(compact);
    }
    default: return null;
  }
}

function extractShoppingList(rows) {
  const parts = [];
  for (const row of rows) {
    if (isNoise(row) || row.length < 2) continue;

    // Qty detection: prefer last cell (standard format), fall back to index 1 (Mad Bean format)
    let qty, body;
    const lastCell  = row[row.length - 1].trim();
    const indexCell = row[1]?.trim() ?? "";
    if (/^\d+$/.test(lastCell)) {
      qty  = parseInt(lastCell, 10);
      body = row.slice(0, -1);
    } else if (/^\d+$/.test(indexCell)) {
      qty  = parseInt(indexCell, 10);
      body = [row[0], ...row.slice(2)].filter(c => c.trim());
    }
    if (!Number.isFinite(qty) || qty < 1) continue;

    const full    = body.join(" ");
    const compact = body.join("").replace(/\s+/g, "");

    // Detect type from the combined text, then fall back to part-number recognition
    let type = inferShoppingType(full);
    if (!type) type = inferShoppingType(compact); // handles fragmented words e.g. "Electr"+"oly"+"tic"
    if (!type && row[0].trim().toUpperCase() === "LED") type = "led";
    if (!type) type = typeFromPartNumber(body[0]);
    if (!type) {
      if (DEBUG) console.debug(`  ? no type for: ${row.join(" | ")}`);
      continue;
    }

    // Reclassify "diode" rows that are actually LEDs
    if (type === "diode" && isLedContext("", full)) type = "led";

    const value = extractCompactValue(type, compact, full);
    if (!value) {
      if (DEBUG) console.debug(`  ? no value for ${type}: ${row.join(" | ")}`);
      continue;
    }

    if (DEBUG) console.debug(`  ✓ ${qty}x ${type} ${value}`);
    for (let i = 0; i < qty; i++) parts.push({ type, value });
  }
  return parts;
}

// Some PDFs (e.g. Abyss) pack "R1   1M" into one cell; others use separate cells.
// Try both: look for a combined "LOC  VALUE" cell, or two adjacent cells.
function splitCombinedCell(cell) {
  const m = cell.trim().match(/^([A-Z]+\d+)\s{2,}(.+?)\s*$/i);
  if (m && typeFromLocation(m[1])) return { loc: m[1].trim(), value: m[2].trim() };
  return null;
}

// Generic fallback: scan each row for location codes
function extractGenericBom(rows) {
  const parts = [];
  for (const row of rows) {
    if (isNoise(row) || row.length < 2) continue;
    const ctx = row.join(" ");

    for (let i = 0; i < row.length; i++) {
      const cell = row[i]?.trim() ?? "";

      // Case 1: cell contains "R1   1M" combined
      const combined = splitCombinedCell(cell);
      if (combined) {
        const part = parsePart(combined.loc, combined.value, ctx);
        if (part) {
          if (DEBUG) console.debug(`  ✓ ${combined.loc} → ${part.type} ${part.value}`);
          parts.push(part);
        }
        continue;
      }

      // Case 2: cell is a bare location code, next cell is the value
      if (typeFromLocation(cell) && i + 1 < row.length) {
        const value = row[i + 1]?.trim() ?? "";
        const part = parsePart(cell, value, ctx);
        if (part) {
          if (DEBUG) console.debug(`  ✓ ${cell} → ${part.type} ${part.value}`);
          parts.push(part);
          i++; // consume the value cell
        }
        continue;
      }

      // Case 3: cell is itself a value (e.g. "B25K" pot, "SPDT" switch in Abyss-style layout)
      if (typeFromValue(cell)) {
        const part = parsePart("_value", cell, ctx);
        if (part) {
          if (DEBUG) console.debug(`  ✓ value-cell ${cell} → ${part.type} ${part.value}`);
          parts.push(part);
        }
      }
    }
  }
  return parts;
}

// ─── PDF → parts list ────────────────────────────────────────────────────────

async function extractFileParts(filePath) {
  const buffer = fs.readFileSync(filePath);
  return new Promise((resolve) => {
    pdf2table.parse(buffer, (err, rows) => {
      if (err) { console.error(`❌ ${path.basename(filePath)}: ${err}`); return resolve([]); }

      const flat = rows.map(r => r.join("").toUpperCase());
      const shoppingIdx = flat.findIndex(s => s.includes("SHOPPING"));
      const partsIdx    = flat.findIndex(s => s.includes("LOCATIONVALUE") || s.includes("LOCATION") || s.includes("PARTVALUE"));

      let bomType, parser, startIdx;
      if (shoppingIdx !== -1) {
        bomType = "Shopping List"; parser = extractShoppingList; startIdx = shoppingIdx + 1;
      } else if (partsIdx !== -1) {
        bomType = "Parts List";    parser = extractPartsList;    startIdx = partsIdx + 1;
      } else {
        bomType = "Generic";       parser = extractGenericBom;   startIdx = 0;
      }

      const parts = parser(rows.slice(startIdx));
      const uniq = countUnique(parts);
      console.log(`\x1b[34m${path.basename(filePath)} — ${bomType}, ${parts.length} parts, ${uniq} unique\x1b[0m`);
      resolve(parts);
    });
  });
}

async function extractFolderParts(folder) {
  const pdfs = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith(".pdf"));
  const all = [];
  for (const f of pdfs) all.push(...await extractFileParts(path.join(folder, f)));
  return all;
}

// ─── BOM aggregation ─────────────────────────────────────────────────────────

function countUnique(parts) {
  return new Set(parts.map(p => `${p.type}|${p.value}`)).size;
}

function buildBom(parts) {
  const map = {};
  for (const { type, value } of parts) {
    const key = `${type}|${value}`;
    map[key] = map[key] ?? { type, value, quantity: 0 };
    map[key].quantity++;
  }
  return Object.values(map)
    .filter(p => p.type && p.value)
    .sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
}

// ─── Tayda SKU lookup ─────────────────────────────────────────────────────────

// Preferred voltages for electrolytic caps (pedals rarely exceed 18V supply)
const ELEC_VOLTAGES = ["25V","35V","16V","50V","63V","100V","10V","6.3V"];

function findSku(skus, type, value) {
  const map = skus[type];
  if (!map) return null;
  if (map[value]) return map[value];
  // Electrolytic fallback: try value_<voltage>
  if (type === "electrolytic") {
    for (const v of ELEC_VOLTAGES) {
      if (map[`${value}_${v}`]) return map[`${value}_${v}`];
    }
    // last resort: any key starting with value_
    const k = Object.keys(map).find(k => k.startsWith(value + "_"));
    if (k) return map[k];
  }
  return null;
}

function printTaydaOrder(bom) {
  const skus = JSON.parse(fs.readFileSync(path.join(__dirname, "tayda_skus.json"), "utf8"));
  const ROUND_UP_10 = new Set(["resistor","ceramic"]);
  const missing = [];

  for (const { type, value, quantity } of bom) {
    const orderQty = ROUND_UP_10.has(type) ? Math.ceil(quantity / 10) * 10 : quantity;
    const sku = findSku(skus, type, value);
    if (sku) {
      const note = orderQty !== quantity ? ` (need ${quantity})` : "";
      console.log(`${sku},${orderQty}\t\t${value} ${type}${note}`);
    } else {
      missing.push({ type, value, quantity: orderQty });
    }
  }

  if (missing.length) {
    console.log("\n=== No SKU found — order manually ===");
    console.table(missing);
  } else {
    console.log("\n✅ All parts matched to SKUs");
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const input = process.argv[2] ?? "./pdfs";
  if (!fs.existsSync(input)) { console.error("❌ Not found:", input); process.exit(1); }

  const stat = fs.statSync(input);
  const parts = stat.isFile()      ? await extractFileParts(input)
              : stat.isDirectory() ? await extractFolderParts(input)
              : (console.error("❌ Must be a file or directory"), process.exit(1));

  const bom = buildBom(parts);
  console.log("\n=== Consolidated BOM ===");
  console.table(bom);

  console.log("\n=== Tayda Quick Order ===");
  printTaydaOrder(bom);
}

main().catch(console.error);
module.exports = { extractFileParts, extractFolderParts };
