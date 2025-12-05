// parse-boms.js
const { debug } = require("console");
const fs = require("fs");
const { type } = require("os");
const path = require("path");
const pdf2table = require("pdf2table");

const DEBUG = process.argv.includes("--d") || process.argv.includes("--debug");
const VERBOSE = process.argv.includes("--v") || process.argv.includes("--verbose");

/**
 * Convert resistor values to strict notation.
 * @param {*} value 
 * @returns {string}
 */
function strictNotation(value) {
  const rcValueRegex = /^(\d{1,3})([RKMUNP])(\d{1,2})$/i;
  if (rcValueRegex.test(value)) {
    value = value.replace(rcValueRegex, (_, intPart, unit, fracPart) => {
      return `${intPart}.${fracPart}${unit}`;
    });
  }
  return value;
}

/**
 * @param {string} component
 * @returns {parsedComponent: string}
 */
const defaultParser = ({type, component}) => ({parsedType: type, parsedComponent: component.trim().toUpperCase()});

const diodes = ["1N4148", "1N4001", "1N4002", "1N4003", "1N4004", "1N4005", "1N4006", "1N4007", "1N5817", "1N5819", "1N5240B",
  "1N5817", "1N34A", "1N60", "1N914", "1N916", "1N270", "1N34A", "1N60P", "1N60", "1N34", "1N34A", "GE", "1N4748A"
];

const transistors = [
  "J201", "2N3904", "2N3906", "2N5088", "2N5089", "2N5087",
  "BC549C", "BC550C", "BC560C", "2N2222A", "PN2222A", "PN2907A", "2N2907A",
  "2N5457", "2N5484", "J113", "MPF102", "BS170", "2N7000", "2N5550",
  "MPSA18", "MP38A", "PF5102", "2SC1815", "2N2222", "J202",
];

const ics = [
  "4558", "TL071", "TL072", "TL074", "LM741", "LM1458", "LM308", "LM324", "NE5532", "OP275", "OP07", "1044SCPA", "1458", "BC108", "BC109",
];

/**
 * @typedef {Object} PartProcessor
 * @property {string} type
 * @property {(args: {type: string, component: string, row: string[]}) => {parsedType: string, parsedComponent: string}} parser
 * @property {string[]} typeStrings
 * @property {RegExp[]} locations
 * @property {(args: {component: string, row: string[]}) => {parsedType: string, parsedComponent: string} | undefined} fallbackTransform
 */

/**
 * @type {PartProcessor[]}
 */
const partProcessors = [
  {
    type: "resistor",
    parser: resistorParser,
    typeStrings: ["resistor", "¼"],
    locations: [/^R\d{1,3}$/i],
  },
  {
    type: "ceramic",
    parser: capacitorParser,
    typeStrings: ["ceramic", "eramic"],
    locations: [/^C\d{1,3}$/i],
  },
  {
    type: "film",
    parser: capacitorParser,
    typeStrings: ["film"],
    locations: [/^C\d{1,3}$/i],
  },
  {
    type: "electrolytic",
    parser: capacitorParser,
    typeStrings: ["electro", "alu", "aluminum"],
    locations: [/^C\d{1,3}$/i],
  },
  {
    type: "inductor",
    parser: capacitorParser,
    typeStrings: ["inductor"],
    locations: [/^I\d{1,3}$/i],
  },
  {
    type: "diode",
    parser: ({component, row}) => {
      component = component.toUpperCase().trim();
      if (component.length > 4) return { parsedType: "diode", parsedComponent: component };
      const combinedRow = row.join("").toUpperCase();
      for (const d of diodes) {
        const regex = new RegExp(d, "i");
        if (regex.test(combinedRow)) {
          return { parsedType: "diode", parsedComponent: d };
        }
      }
      return { parsedType: "diode", parsedComponent: combinedRow };
    },
    typeStrings: ["diode", "zener"],
    locations: [/^D\d{1,3}$/i],
    fallbackTransform: ({row}) => { 
      if (row.some(cell => /DIODE/i.test(cell.toUpperCase()))) {
        return {parsedType: "diode", parsedComponent: row.join(" ").toUpperCase().trim() };
      }
    },
  },
  {
    type: "transistor",
    parser: transistorParser,
    typeStrings: ["transistor", "bjt", "fet", "pnp", "npn"],
    locations: [/^Q\d{1,3}$/i],
  },
  {
    type: "ic",
    parser: icParser,
    typeStrings: ["ic", "op amp", "op-amp", "opamp"],
    locations: [/^IC\d{1,3}$/i],
  },
  {
    type: "led",
    parser: ({ component, row }) => {
      component = component.toUpperCase().trim();
      const combinedRow = row.join("").toUpperCase();
      let result = "any";
      const colors = ["RED", "GREEN", "BLUE", "YELLOW", "WHITE", "ORANGE", "RGB", "UV", "IR"];
      for (const color of colors) {
        const regex = new RegExp(color, "i");
        if (regex.test(combinedRow) || regex.test(component)) {
          result = color.charAt(0) + color.slice(1).toLowerCase();
        }
      }
      verboseLog("Normalized LED value:", { component, row, result });
      return { parsedType: "led", parsedComponent: result };
    },
    typeStrings: ["led", "3mm", "5mm", "diffused"],
    locations: [/^LED\d{0,3}$/i],
  },
  {
    type: "switch",
    parser: ({component, row}) => {
      if (!component && row.length === 1) return {};
      component = component.toUpperCase().trim();
      let parsedComponent = component;
      const typeRegex = /SPDT|DPDT|SPST|DPST|DIP/i;
      const subtypeRegex = /(ON\/ON|ON\/OFF\/ON|ON\/ON\/ON)/i;
      let type = component.match(typeRegex)?.[0];
      let subtype = component.match(subtypeRegex)?.[0];

      if (type && subtype) {
        parsedComponent = [type, subtype].join(" ");
      }

      const combinedRow = row.join("").toUpperCase();
      
      if (!type || !subtype) {
        type = type ? type : combinedRow.match(typeRegex)?.[0];
        subtype = subtype ? subtype : combinedRow.match(subtypeRegex)?.[0];
        if (type || subtype) parsedComponent = [type, subtype].filter(Boolean).join(" ");
      }

      verboseLog("Normalized switch value:", { component, row, parsedComponent });
      return { parsedType: "switch", parsedComponent };
    },
    typeStrings: ["switch", "toggle", "dip"],
    locations: [/SW\d{0,3}$/i, /SPDT|DPDT|SPST|DPST|DIP/i],
    fallbackTransform: ({component, row}) => {
      component = component.toUpperCase().trim();
      if (/\bSPDT|DPDT|SPST|DPST|DIP\b/i.test(component)) {
        return { parsedType: "switch", parsedComponent: component };
      }
      const combinedRow = row.join("").toUpperCase();
      if (/\bSPDT|DPDT|SPST|DPST|DIP\b/i.test(combinedRow)) {
        const match = combinedRow.match(/\bSPDT|DPDT|SPST|DPST|DIP\b/i);
        if (match) {
          return { parsedType: "switch", parsedComponent: match[0] };
        }
      }
    },
  },
  {
    type: "trimpot",
    parser: ({component}) => ({parsedType: "trimpot", parsedComponent: component.trim().toUpperCase().match(/\d{1,3}K/)?.[0] || component.trim().toUpperCase()}),
    typeStrings: ["trim", "trimmer"],
    locations: [/^VR\d{0,3}$|^TPOT\d{0,3}$|^TRIM\d{0,3}$/i],
  },
  {
    type: "potentiometer",
    parser: ({component, row}) => {
      verboseLog("Parsing potentiometer", { component, row: row.join(" | ") });
      component = component.toUpperCase().trim();
      let parsedComponent = component;
      if (/\b[ABCW]\d{1,3}[MK]\b/i.test(component)) {
        parsedComponent = component.match(/\b[ABCW]\d{1,3}[MK]\b/i)[0];
      } else if (row.some(v => /\b[ABCW]\d{1,3}[MK]\b/i.test(v))) {
        parsedComponent = row.find(v => /\b[ABCW]\d{1,3}[MK]\b/i.test(v)).match(/\b[ABCW]\d{1,3}[MK]\b/i)[0].toUpperCase();
      }
      return { parsedType: "potentiometer", parsedComponent };
    },
    typeStrings: ["potentiometer", "pot", "16mm", "16 mm"],
    locations: [/^POT\d{0,3}$|^16MM\d{0,3}$/i, /\b[ABCW]\d{1,3}[MK]\b/i],
    fallbackTransform: ({component, row}) => {
      if (/\b[ABCW]\d{1,3}[MK]\b/i.test(component)) {
        return { parsedType: "potentiometer", parsedComponent: component.match(/\b[ABCW]\d{1,3}[MK]\b/i)[0] };
      } else if (row.some(v => /\b[ABCW]\d{1,3}[MK]\b/i.test(v))) {
        const match = row.find(v => /\b[ABCW]\d{1,3}[MK]\b/i.test(v)).match(/\b[ABCW]\d{1,3}[MK]\b/i);
        if (match) {
          return { parsedType: "potentiometer", parsedComponent: match[0] };
        }
      }
    },
  },
  {
    type: "jack",
    parser: defaultParser,
    typeStrings: ["jack"],
    locations: [/^J\d{0,3}$/i],
  },
  {
    type: "connector",
    parser: defaultParser,
    typeStrings: ["connector"],
    locations: [/^J\d{0,3}$/i],
  },
  {
    type: "regulator",
    parser: defaultParser,
    typeStrings: ["regulator"],
    locations: [/^REG\d{0,3}$/i],
  },
];

/**
 * @param {string} component 
 * @returns {string}
 */
function resistorParser({component}) {
  normalized = component.replace("Ω", "R").toUpperCase().replace("OHM", "R").replace("OHMS", "R").replace("KΩ", "K").replace("M", "M").replace("MΩ", "M");
  if (/^\d+$/.test(normalized)) {
    normalized += "R";
  }
  verboseLog("Normalized resistor value:", { component, result: strictNotation(normalized) });
  return { parsedType: "resistor", parsedComponent: strictNotation(normalized) };
}

/**
 * @param {string} component 
 * @param {string} type
 * @returns {parsedComponent: string, parsedType: string}
 */
function capacitorParser({type, component}) {
  let parsedType = type;
  const lowerValue = component.toLowerCase();
  if (/[0-9]+p/.test(lowerValue) || /(?:ceramic|disk)/i.test(lowerValue)) parsedType = "ceramic";
  else if (/[0-9]+n/.test(lowerValue) || /(?:film|mylar)/i.test(lowerValue)) parsedType = "film";
  else if (/[0-9]+u/.test(lowerValue) || /(?:electrolytic|alu|aluminum|tantalum|µ|μ)/i.test(lowerValue)) parsedType = "electrolytic";

  normalized = lowerValue.replace("pf", "p").replace("nf", "n").replace("µ", "u").replace("μ", "u").replace("uf", "u").replace("mf", "u");
  const defaults = {
    "ceramic": "p",
    "film": "n",
    "electrolytic": "u",
  };
  if (defaults[parsedType] && /^\d+$/.test(normalized)) normalized += defaults[parsedType];
  parsedComponent = strictNotation(normalized).split(" ")[0];
  verboseLog("Normalized capacitor value:", { parsedType, component, parsedComponent });
  return { parsedType, parsedComponent };
}

/**
 * @param {string} type
 * @param {string[]} row
 * @returns {parsedComponent: string, parsedType: string}
 */
function transistorParser({component, row}) {
  let result = component.toUpperCase().trim();
  for (const t of transistors) {
    const regex = new RegExp(t, "i");
    if (regex.test(component)) {
      return { parsedType: "transistor", parsedComponent: t };
    }
  }
  const combinedRow = row.join("").toUpperCase();
  if (/^(?=.*GERMANIUM)(?=.*NPN).*$/i.test(combinedRow)) result = "NPN Germanium";
  else if (/^(?=.*GERMANIUM)(?=.*PNP).*$/i.test(combinedRow)) result = "PNP Germanium";
  else if (/^(?=.*SILICON)(?=.*NPN).*$/i.test(combinedRow)) result = "NPN Silicon";
  else if (/^(?=.*SILICON)(?=.*PNP).*$/i.test(combinedRow)) result = "PNP Silicon";
  // Try to extract transistor part numbers from garbled rows
  else if (!/^[A-Z]{2,3}\d{2,4}$/i.test(component)) {
    const m = combinedRow.match(/(?<!\w)(2N\d+[A-C]?)/i);
    verboseLog("Attempting to extract transistor from garbled row", { row, combinedRow, match: m });

    if (m) {
      result = m[0];
    } else {
      verboseLog("Could not extract transistor value from row", { row, combinedRow });
      result = combinedRow.toUpperCase();
    }
  }
  verboseLog("Normalized transistor value:", { component, row, result });
  return { parsedType: "transistor", parsedComponent: result };
}

/**
 *
 * @param {string} component
 * @returns {parsedComponent: string}
 */
function icParser({component}) {
  component = component.toUpperCase().trim();
  for (const ic of ics) {
    const regex = new RegExp(ic, "i");
    if (regex.test(component)) {
      return { parsedType: "ic", parsedComponent: ic };
    }
  }
  return { parsedType: "ic", parsedComponent: component };
}

function debugLog(...args) {
  if (DEBUG || VERBOSE) {
    console.debug(...args);
  }
}

function verboseLog(...args) {
  if (VERBOSE) {
    console.debug(...args);
  }
}

function parsePartsList(rows) {
  const parts = [];
  let i = 0;  
  for (const row of rows) {
    debugLog(`Processing row ${i++} of ${rows.length}: ${row.join(" | ")}`);

    if (!Array.isArray(row) || row.length < 2) continue;
    // Skip noise
    if (isNoiseRow(row)) {
      verboseLog('Skipping noise row', { row });
      continue;
    }

    const [_, component] = row;

    const { parser, type } = getProcessorForRow(row) || {};
    if (!parser) {
      debugLog("Could not determine type, skipping row", { row });
      continue;
    }
    let { parsedType, parsedComponent } = parser({ type, component, row });
    if (!parsedType) {
      debugLog("⚠️ Could not classify part", { component, row: row.join(" | ") });
      continue;
    }


    debugLog("\x1b[1m\x1b[32m%s\x1b[0m", `Extracted 1x ${parsedComponent} ${parsedType}`);
    parts.push({ parsedType, parsedComponent });
  }

  return parts;
}

function parseShoppingList(rows) {
  const parts = [];
  let i = 0;
  for (const row of rows) {
    debugLog(`Processing row ${i++} of ${rows.length}: ${row.join(" | ")}`);

    if (!Array.isArray(row) || row.length < 1) continue;
    if (row[0] === "LED") {
      verboseLog("Skipping indicator LED row", { row });
      continue;
    }

    const quantity = row[row.length - 1];
    const { parser, type } = getProcessorForRow(row) || {};
    if (!parser) {
      debugLog("Could not determine processor, skipping row", { row });
      continue;
    }
    let { parsedComponent, parsedType } = parser({ type, component: row[0], row });
    if (!parsedType) {
      debugLog("⚠️ Could not classify part", { type, component: row[0], fullRow: row.join(" | ") });
      continue;
    }

    if (parsedType === "LED" || (row.length > 5 && ["Diode", "IC", "Transistor"].includes(parsedType))) {
      debugLog("Preserving LED or overly complex row", { row });
      parsedComponent = row.slice(0, -1).join("").trim();
    }


    debugLog("\x1b[1m\x1b[32m%s\x1b[0m", `Extracted ${quantity}x ${parsedComponent} ${parsedType}`);
    for (let i = 0; i < quantity; i++) {
      parts.push({ parsedType, parsedComponent });
    }
  }
  return parts;
}

function isLocationIdentifier(location) {
  return partProcessors.some(p => p.locations.some(locRegex => locRegex.test(location)));
}

/**
 * 
 * @param {string} location 
 * @param {string} component 
 * @param {Array<string>} row 
 * @returns {parsedType: string, parsedComponent: string}
 */
function parseGenericRow(location, component, row) {
  location = location.trim();
  component = component ? component.trim() : "";

  for (const { type, parser, locations } of partProcessors) {
    if (locations.some(locRegex => locRegex.test(location))) {
      return parser({ type, component, row });
    }
  }
  // Fallback using fallbackIdentifier if defined
  for (const { fallbackTransform } of partProcessors) {
    const fallback = fallbackTransform({ component, row });
    debugLog("Checking fallback for processor", { fallback, location, component, row });
    if (fallback && fallback.parsedType && fallback.parsedComponent) {
      return fallback;
    }
  }
  return {};
}

/**
 * 
 * @param {Array<string[]>} rows 
 * @returns {parsedType: string, parsedComponent: string}[]
 */
function parseGenericBom(rows) {
  const parts = [];
  let i = 0;
  for (const row of rows) {
    debugLog(`Processing row ${i++} of ${rows.length}: ${row.join(" | ")}`);

    if (!Array.isArray(row) || row.length === 0) continue;
    const isGarbled = row.every(cell => typeof cell === "string" && cell.trim().length <= 2);
    const isHeader = row.every(cell => typeof cell === "string" && /^[A-Za-z\s]+$/.test(cell) && cell.trim().length > 2);
    const isNoise = isNoiseRow(row);
    if (isGarbled || isHeader || isNoise) continue;

    for (let i = 0; i < row.length; i++) {
      const location = row[i]?.trim();
      if (!isLocationIdentifier(location)) {
        continue;
      }
      i += 1;
      const component = row[i]?.trim();
      const { parsedType, parsedComponent } = parseGenericRow(location, component, row);
      if (!parsedType) {
        debugLog("⚠️ Could not classify part", { location, component, fullRow: row.join(" | ") });
        continue;
      }
      debugLog("\x1b[1m\x1b[32m%s\x1b[0m", `Extracted 1x ${parsedComponent} ${parsedType}`);
      parts.push({ parsedType, parsedComponent });
    }
  }
  return parts;
}

function isNoiseRow(row) {
  if (!row) return true;
  if (Array.isArray(row) && row.length === 4 && 
    row.every((cell, i) => cell === ['LOCATION', 'VALUE', 'TYPE', 'NOTES'][i])) return true;
  
  const stringsToCheck = Array.isArray(row) ? row : [row];
  const noisePatterns = [
    /COPYRIGHT/i, /©/, /PEDALPCB\.COM/i,
    /RESISTORS|CAPACITORS|TRANSISTORS|INTEGRATED CIRCUITS/i,
    /CONTINUED/i, /PAGE \d+/i,
    /^•$/, /^\d+$/, /NEXT PAGE(\.\.\.|…)/i, /TYPE NOTE/i, /DIAGRAM/i, /SCHEMATIC/i,
  ];
  return stringsToCheck.some(str => noisePatterns.some(regex => regex.test(str)));
}

/** ---------- Extract BOM ---------- **/
function extractBOM(partsList) {
  const bomMap = {};
  for (const { parsedType, parsedComponent } of partsList) {
    verboseLog("Processing part", { parsedType, parsedComponent });
    const key = `${parsedType}|${parsedComponent}`;
    if (!bomMap[key]) bomMap[key] = { type: parsedType, value: parsedComponent, quantity: 0 };
    bomMap[key].quantity++;
  }
  const sortedKeys = Object.keys(bomMap).sort((a, b) => {
    const [typeA, valueA] = a.split("|");
    const [typeB, valueB] = b.split("|");
    const typeCompare = typeA.localeCompare(typeB);
    if (typeCompare !== 0) return typeCompare;
    return valueA.localeCompare(valueB);
  });
  return sortedKeys.map(k => bomMap[k]);
}

function getProcessorForRow(row) {
  const combinedRow = row.join("").toLowerCase();
  for (const p of partProcessors) {
    if (p.typeStrings.some(str => combinedRow.includes(str))) {
      return p;
    }
  }
}

/** ---------- Main: parse PDFs ---------- **/
async function extractFileBOM(filePath) {
  const buffer = fs.readFileSync(filePath);

  const parsers = [
    {
      name: "Shopping List", header: "SHOPPING", parser: parseShoppingList
    },
    {
      name: "Parts List", header: "LOCATIONVALUE", parser: parsePartsList
    }
  ];

  return new Promise((resolve) => {
    pdf2table.parse(buffer, function (err, rows) {
      if (err) {
        console.error(`❌ Error parsing ${filePath}: ${err}`);
        return resolve([]);
      }

      let headerIndex = -1;
      let bomType = "Generic";
      let parser = parseGenericBom;
      for (const p of parsers) {
        headerIndex = rows.findIndex(row => row.join("").toUpperCase().includes(p.header));
        if (headerIndex !== -1) {
          parser = p.parser;
          bomType = p.name;
          break;
        }
      }
      
      debugLog(`Using parser for ${bomType} for ${filePath}`);
      const startIndex = headerIndex !== -1 ? headerIndex + 1 : 0;
      const parts = parser(rows.slice(startIndex));
      const bom = extractBOM(parts);
      console.log("\x1b[1m\x1b[34m%s\x1b[0m", `Processed file ${path.basename(filePath)} - Detected BOM Type: ${bomType}, Parts Found: ${parts.length}, Unique Items: ${bom.length}`);      
      if (DEBUG === true) console.table(bom);
      resolve(parts);
    });
  });
}

async function extractFolderBOM(folder) {
  const files = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith(".pdf"));
  let accumulatedParts = [];
  for (const file of files) {
    const filePath = path.join(folder, file);
    const parts = await extractFileBOM(filePath);
    accumulatedParts.push(...parts);
  }
  return accumulatedParts;
}

function logTaydaOrders(parts) {
  const skusFile = path.join(__dirname, "skus.json");
  const skus = fs.existsSync(skusFile) ? JSON.parse(fs.readFileSync(skusFile, "utf-8")) : {};
  const stillToOrder = [];

  for (const part of parts) {
    let thisSku;
    const multiplesOfTen = ["resistor", "ceramic"];
    const originalQuantity = part.quantity;
    if (multiplesOfTen.includes(part.type)) part.quantity = Math.ceil(part.quantity / 10) * 10;
    if (skus[part.type] && (thisSku = skus[part.type][part.value])) {
      console.log(`${thisSku},${part.quantity}\t\t ${part.value} ${part.type}, originalQty: ${originalQuantity}`);
    } else {
      stillToOrder.push(part);
    }
  }

  if (stillToOrder.length === 0) {
    console.log("\n✅ All parts found in SKU list");
    return;
  }

  console.log("\n=== Parts still to order manually ===");
  console.table(stillToOrder);

}

/** ---------- CLI Entry Point ---------- **/
async function main() {
  const inputPath = process.argv[2] || "./pdfs";
  let accumulatedParts = [];

  if (fs.existsSync(inputPath)) {
    const stats = fs.statSync(inputPath);
    if (stats.isFile()) {
      accumulatedParts = await extractFileBOM(inputPath);
    } else if (stats.isDirectory()) {
      accumulatedParts = await extractFolderBOM(inputPath);
    } else {
      console.error("❌ Input path must be a file or folder");
      process.exit(1);
    }
  } else {
    console.error("❌ Input path not found:", inputPath);
    process.exit(1);
  }

  console.log(`\n=== Final Consolidated BOM ===`);
  const bom = extractBOM(accumulatedParts);
  console.table(bom);

  console.log(`\n=== Tayda Quick Order ===`);
  logTaydaOrders(bom);
}

main().catch(err => console.error(err));

module.exports = { extractFileBOM, extractFolderBOM };
