"use strict";
// Fetches Tayda product pages via headless Chromium and extracts specs.
// Usage: node tayda_verify.js [category]
// Categories: pots | ceramic | film | electrolytic | all

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());
const fs = require("fs");

const skus = JSON.parse(fs.readFileSync("tayda_skus.json"));

// Build the list of SKUs to check by category
function buildTasks(category) {
  const tasks = [];
  const add = (type, value, sku) => tasks.push({ type, value, sku });

  if (category === "pots" || category === "all") {
    for (const [v, sku] of Object.entries(skus.potentiometer)) add("potentiometer", v, sku);
  }
  if (category === "ceramic" || category === "all") {
    for (const [v, sku] of Object.entries(skus.ceramic)) add("ceramic", v, sku);
  }
  if (category === "film" || category === "all") {
    for (const [v, sku] of Object.entries(skus.film)) add("film", v, sku);
  }
  if (category === "electrolytic" || category === "all") {
    for (const [v, sku] of Object.entries(skus.electrolytic)) add("electrolytic", v, sku);
  }
  return tasks;
}

// Extract the specs we care about from a Tayda product page
async function fetchSpecs(page, sku) {
  const url = `https://www.taydaelectronics.com/catalogsearch/result/?q=${sku}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(800);

  // Try to get to the product page directly if search returns one result
  const productLink = await page.$("a.product-item-link");
  if (productLink) {
    await productLink.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(600);
  }

  const text = (await page.innerText("body")).replace(/\s+/g, " ").toLowerCase();

  return {
    title: await page.title(),
    url: page.url(),
    rawText: text.slice(0, 3000),
  };
}

// Parse the raw text for each category's key specs
function parseSpecs(type, value, { title, url, rawText: t }) {
  const issues = [];
  const info = {};

  if (type === "potentiometer") {
    info.shaft = t.includes("6.35") ? "6.35mm" : t.includes("6mm") || t.includes("6 mm") ? "6mm" : "unknown";
    info.shaftType = t.includes("round") ? "round" : t.includes("spline") || t.includes("knurled") ? "spline" : "unknown";
    info.mount = t.includes("right angle") || t.includes("right-angle") ? "right-angle PCB"
               : t.includes("solder lug") ? "solder lug"
               : t.includes("pcb") ? "PCB"
               : "unknown";
    info.smd = t.includes("smd") || t.includes("surface mount");
    if (info.shaft !== "6.35mm") issues.push(`shaft is ${info.shaft} not 6.35mm`);
    if (info.shaftType !== "round") issues.push(`shaft type is ${info.shaftType} not round`);
    if (!info.mount.includes("PCB")) issues.push(`mount is '${info.mount}' not PCB`);
    if (info.smd) issues.push("SMD!");
  }

  if (type === "ceramic") {
    info.mlcc = t.includes("mlcc") || t.includes("multi-layer") || t.includes("multilayer");
    info.disc = t.includes("disc") || t.includes("disk");
    info.smd = t.includes("smd") || t.includes("surface mount") || t.includes("0402") || t.includes("0603") || t.includes("0805");
    info.type = info.mlcc ? "MLCC" : info.disc ? "disc" : "unknown";
    if (!info.mlcc) issues.push(`not MLCC (${info.type})`);
    if (info.smd) issues.push("SMD!");
  }

  if (type === "film") {
    const voltMatch = t.match(/(\d+)\s*v\b/g);
    const volts = voltMatch ? voltMatch.map(v => parseInt(v)).filter(v => v >= 10 && v <= 1000) : [];
    info.voltage = volts.length ? Math.min(...volts) + "V" : "unknown";
    info.tolerance = t.includes("5%") ? "5%" : t.includes("10%") ? "10%" : t.includes("1%") ? "1%" : "unknown";
    info.smd = t.includes("smd") || t.includes("surface mount") || t.includes("0402") || t.includes("0603");
    info.throughHole = t.includes("through") || t.includes("radial") || t.includes("axial") || t.includes("dip");
    const vNum = parseInt(info.voltage);
    if (!isNaN(vNum) && vNum > 100) issues.push(`voltage ${info.voltage} > 100V (may not be cheapest)`);
    if (info.tolerance === "10%") issues.push("tolerance is 10% not 5%");
    if (info.smd) issues.push("SMD!");
  }

  if (type === "electrolytic") {
    const voltMatch = t.match(/(\d+)\s*v\b/g);
    const volts = voltMatch ? voltMatch.map(v => parseInt(v)).filter(v => v >= 6 && v <= 500) : [];
    info.voltage = volts.length ? Math.min(...volts) + "V" : "unknown";
    info.smd = t.includes("smd") || t.includes("surface mount");
    info.throughHole = t.includes("through") || t.includes("radial") || t.includes("aluminum");
    const vNum = parseInt(info.voltage);
    if (!isNaN(vNum) && vNum < 25) issues.push(`voltage ${info.voltage} < 25V minimum`);
    if (info.smd) issues.push("SMD!");
  }

  return { info, issues, title: title.slice(0, 80), url };
}

async function main() {
  const category = process.argv[2] ?? "all";
  const tasks = buildTasks(category);
  console.log(`Checking ${tasks.length} SKUs for category: ${category}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  const CONCURRENCY = 4;
  const results = [];
  const queue = [...tasks];

  async function worker() {
    const page = await context.newPage();
    while (queue.length) {
      const task = queue.shift();
      process.stderr.write(`  [${tasks.length - queue.length}/${tasks.length}] ${task.sku} ${task.value}\n`);
      try {
        const raw = await fetchSpecs(page, task.sku);
        const parsed = parseSpecs(task.type, task.value, raw);
        results.push({ ...task, ...parsed });
      } catch (e) {
        results.push({ ...task, info: {}, issues: [`fetch error: ${e.message}`], title: "error", url: "" });
      }
    }
    await page.close();
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await browser.close();

  // Summary
  const problems = results.filter(r => r.issues.length > 0);
  const clean    = results.filter(r => r.issues.length === 0);
  console.log(`\n✅ ${clean.length} OK   ⚠️  ${problems.length} need attention\n`);

  if (problems.length) {
    console.log("=== ISSUES ===");
    for (const r of problems) {
      console.log(`[${r.type}] ${r.value} (${r.sku}): ${r.issues.join(", ")}`);
      console.log(`  → ${r.title}`);
    }
  }

  fs.writeFileSync("tayda_verify_results.json", JSON.stringify(results, null, 2));
  console.log("\nFull results saved to tayda_verify_results.json");
}

main().catch(e => { console.error(e); process.exit(1); });
