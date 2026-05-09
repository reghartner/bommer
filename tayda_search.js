"use strict";
// Search Tayda for a potentiometer value and return 6.35mm round shaft PCB options
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());

const searches = [
  { value: "B200K", query: "200k linear potentiometer 6.35mm PCB" },
  { value: "B2.2K", query: "2.2k linear potentiometer 6.35mm PCB" },
  { value: "B20K",  query: "20k linear potentiometer 6.35mm PCB" },
  { value: "B2M",   query: "2m linear potentiometer 6.35mm PCB" },
  { value: "A20K",  query: "20k audio logarithmic potentiometer 6.35mm PCB" },
  { value: "A10K DUAL", query: "10k logarithmic dual potentiometer 6.35mm PCB mount" },
  { value: "A200K", query: "200k audio logarithmic potentiometer 6.35mm PCB" },
];

async function searchTayda(page, query) {
  const url = `https://www.taydaelectronics.com/catalogsearch/result/?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(1000);

  const items = await page.$$eval(".product-item-info", els => els.slice(0, 6).map(el => ({
    name: el.querySelector(".product-item-name")?.innerText?.trim() ?? "",
    sku:  el.querySelector(".product-item-sku, [data-product-sku]")?.innerText?.trim()
       ?? el.innerHTML.match(/A-\d+/)?.[0] ?? "",
    url:  el.querySelector("a.product-item-link")?.href ?? "",
  })));

  return items;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  for (const { value, query } of searches) {
    process.stderr.write(`Searching: ${value}\n`);
    try {
      const results = await searchTayda(page, query);
      console.log(`\n=== ${value} ===`);
      if (results.length === 0) {
        // Try scraping the page text for SKUs and names
        const text = await page.innerText(".search.results, .column.main, body");
        const skuMatches = [...text.matchAll(/A-\d{3,4}/g)].map(m => m[0]);
        console.log("  (no structured results, page SKUs found:", [...new Set(skuMatches)].slice(0, 6).join(", ") || "none", ")");
        // Print first 800 chars of relevant text
        const relevant = text.replace(/\s+/g, " ").slice(0, 800);
        console.log("  Text:", relevant);
      } else {
        for (const r of results) console.log(`  ${r.sku} — ${r.name}`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
