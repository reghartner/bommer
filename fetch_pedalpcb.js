"use strict";
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
chromium.use(StealthPlugin());

const DEST = path.join(__dirname, "pdfs");
const WANT = 10;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", e => { try { fs.unlinkSync(dest); } catch(_) {} reject(e); });
  });
}

async function getProductLinks(page) {
  const links = new Set();
  // Browse shop pages — stop once we have enough candidates
  for (let pg = 1; pg <= 10; pg++) {
    const url = pg === 1
      ? "https://www.pedalpcb.com/shop/"
      : `https://www.pedalpcb.com/shop/page/${pg}/`;
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
      await page.waitForTimeout(800);
      const found = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a"))
          .map(a => a.href)
          .filter(h => h && h.includes("pedalpcb.com/product/"))
      );
      const unique = [...new Set(found)];
      unique.forEach(l => links.add(l));
      console.log(`  shop page ${pg}: ${unique.length} product links (total ${links.size})`);
      if (links.size >= 80) break;
    } catch(e) {
      console.log(`  shop page ${pg} error: ${e.message}`);
      break;
    }
  }
  return [...links];
}

async function getPdfFromProductPage(page, productUrl) {
  try {
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(400);
    const pdfLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a"))
        .map(a => a.href)
        .filter(h => h && h.toLowerCase().includes(".pdf"))
    );
    return pdfLinks[0] || null;
  } catch(e) {
    return null;
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();

  console.log("Collecting product page links from shop...");
  const productLinks = await getProductLinks(page);
  console.log(`\nFound ${productLinks.length} product pages total`);

  // Shuffle for variety
  for (let i = productLinks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [productLinks[i], productLinks[j]] = [productLinks[j], productLinks[i]];
  }

  const existing = new Set(fs.readdirSync(DEST).map(f => f.toLowerCase()));
  const pdfQueue = [];

  console.log("\nScanning product pages for build doc PDFs...");
  for (const prodUrl of productLinks) {
    if (pdfQueue.length >= WANT * 3) break;
    const pdfUrl = await getPdfFromProductPage(page, prodUrl);
    if (!pdfUrl) continue;
    const name = path.basename(new URL(pdfUrl).pathname);
    if (existing.has(name.toLowerCase())) {
      console.log(`  skip (already have): ${name}`);
      continue;
    }
    console.log(`  found: ${name}  [${prodUrl.split("/product/")[1]?.replace(/\/$/, "")}]`);
    pdfQueue.push({ pdfUrl, name });
  }

  await browser.close();

  console.log(`\nDownloading up to ${WANT} PDFs...`);
  let downloaded = 0;
  for (const { pdfUrl, name } of pdfQueue) {
    if (downloaded >= WANT) break;
    const dest = path.join(DEST, name);
    process.stdout.write(`  ${name} ...`);
    try {
      await download(pdfUrl, dest);
      const size = fs.statSync(dest).size;
      if (size < 5000) {
        fs.unlinkSync(dest);
        console.log(" skipped (not a real PDF)");
      } else {
        console.log(` ✓ (${Math.round(size/1024)}KB)`);
        downloaded++;
      }
    } catch(e) {
      console.log(` failed: ${e.message}`);
    }
  }

  console.log(`\nDownloaded ${downloaded} new PDFs.`);
}

main().catch(e => { console.error(e); process.exit(1); });
