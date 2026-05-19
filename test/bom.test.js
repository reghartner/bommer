"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { extractFileParts, buildBom, findSku } = require("../bommer2");
const fs = require("fs");

const skus = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tayda_skus.json"), "utf8"));
const snapshots = JSON.parse(fs.readFileSync(path.join(__dirname, "snapshots.json"), "utf8"));

function findSkuForPart(type, value) {
  return findSku(skus, type, value);
}

for (const [pdf, expected] of Object.entries(snapshots)) {
  describe(pdf, () => {
    let parts, bom;

    it("parses without error", async () => {
      const filePath = path.join(__dirname, "..", "pdfs", pdf);
      parts = await extractFileParts(filePath);
      assert.ok(parts.length > 0, "should extract at least one part");
    });

    it(`extracts ${expected.totalParts} total parts`, () => {
      assert.equal(parts.length, expected.totalParts);
    });

    it(`produces ${expected.uniqueParts} unique BOM entries`, () => {
      bom = buildBom(parts);
      assert.equal(bom.length, expected.uniqueParts);
    });

    it("BOM matches snapshot", () => {
      bom = bom ?? buildBom(parts);
      assert.deepEqual(bom, expected.bom);
    });

    it("SKU matches are stable", () => {
      bom = bom ?? buildBom(parts);
      const manual = [];
      for (const item of bom) {
        if (!findSkuForPart(item.type, item.value)) {
          manual.push({ type: item.type, value: item.value });
        }
      }
      assert.deepEqual(manual, expected.manualParts,
        "unmatched parts should match snapshot — if a new SKU was added, regenerate snapshots");
    });
  });
}
