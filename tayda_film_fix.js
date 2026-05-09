"use strict";
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());

const searches = [
  { label: "1.5n film 100V or less 5%", query: "1.5nf film polyester capacitor 100v" },
  { label: "2.2uF film 5% 100V",        query: "2.2uf polyester film capacitor 5% 100v through hole" },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();

  for (const { label, query } of searches) {
    const url = `https://www.taydaelectronics.com/catalogsearch/result/?q=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1200);
    const text = (await page.innerText("body")).replace(/\s+/g, " ");
    // Extract first 1200 chars of results
    const start = text.indexOf("Sort By");
    const snippet = start >= 0 ? text.slice(start, start + 1200) : text.slice(0, 1200);
    console.log(`\n=== ${label} ===`);
    console.log(snippet);
  }

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
