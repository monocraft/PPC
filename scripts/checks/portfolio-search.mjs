import assert from "node:assert/strict";
await import("../../public/js/portfolio-search.js");
const searchModel = globalThis.PortfolioSearch;

function freezeTree(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

const sku = "4P5D4AA#ABA";
const pcProduct = {
  id: "cloud-pc", name: "HyperX Cloud II", laneId: "wireless", codename: "Caf\u00e9 Aurora", tier: "Premium",
  partSkus: [{ id: "private-sku-id", code: sku }],
  variantGroups: [{ id: "private-group-id", label: "Color", type: "color", items: [{ id: "private-variant-id", code: "BK", colorName: "Black", imageAssetId: "private-variant-image" }] }],
  specs: [{ id: "private-spec-id", label: "Connection", value: "Wireless 2.4 GHz" }, { label: "Microphone", value: "Detachable" }],
  roadmap: { family: "Cloud", status: "in-development", notes: "Lightweight headset", predecessorId: "private-predecessor" },
  imageAssetId: "private-product-image", master: { revision: "private-master-revision" }, masterProductId: "private-master-product", privateMetadata: "private-secret",
  ascm: { sourceFile: "private-source-file", key: "private-ascm-key", basePartNumbers: ["9Z123AA"], records: [{ basePartNumber: "7A777AA", sourceRow: "private-row" }] },
};
const consoleProduct = { ...structuredClone(pcProduct), id: "cloud-console", name: "HyperX Cloud II for Console" };
const prefixProduct = { id: "prefix", name: "SKU prefix", laneId: "wired", partSkus: ["4P5D4AA#ABAX"] };
const substringProduct = { id: "substring", name: "SKU substring", laneId: "wired", partSkus: [{ sku: "X4P5D4AA#ABA" }] };
const incidentalProduct = { id: "incidental", name: "Reference headset", laneId: "wired", specs: [{ label: "Compatibility", value: `Example ${sku}` }] };
const nameProduct = { id: "named", name: sku, laneId: "wired" };
const portfolio = freezeTree({
  activeCategoryId: "pc",
  categories: [
    { id: "pc", name: "PC Gaming Audio", board: { lanes: [{ id: "wireless", label: "WIRELESS" }, { id: "wired", label: "WIRED" }], products: [incidentalProduct, prefixProduct, substringProduct, nameProduct, pcProduct] } },
    { id: "console", name: "Console Gaming Audio", board: { lanes: [{ id: "wireless", label: "WIRELESS" }], products: [consoleProduct] } },
  ],
  master: { token: "private-portfolio-master" }, imageAssets: [{ id: "private-library-image", name: "private-image-name" }],
});
const original = structuredClone(portfolio);

assert.deepEqual(Object.keys(searchModel).sort(), ["matchProduct", "normalize", "search"]);
assert.ok(Object.isFrozen(searchModel));
assert.equal(searchModel.normalize("  C\u00c1F\u00c9  \u0110\u00e9tachable / WIRELESS  "), "cafe detachable wireless");
assert.equal(searchModel.normalize("\uff14\uff30\uff15\uff24\uff14\uff21\uff21#ABA"), "4p5d4aa aba", "Unicode compatibility characters should normalize consistently");

const exact = searchModel.search(portfolio, "  4p5d4aa aba  ", { activeCategoryId: "console", limit: 20 });
assert.equal(exact.total, 6);
assert.deepEqual(exact.results.map((result) => result.productId), ["cloud-console", "cloud-pc", "prefix", "substring", "named", "incidental"], "exact HP SKU, prefix and substring should outrank names and incidental specifications");
assert.equal(exact.results[0].matchedSku, sku);
assert.equal(exact.results[0].matchType, "sku-exact");
assert.equal(exact.results[0].matchedVariant, "");
assert.equal(exact.results[0].score, 1000);
assert.equal(exact.results[0].categoryName, "Console Gaming Audio");
assert.equal(exact.results[0].laneName, "WIRELESS");
assert.equal(exact.results[2].matchType, "sku-prefix");
assert.equal(exact.results[3].matchType, "sku-substring");
assert.equal(exact.results[4].matchType, "name-exact");
assert.equal(exact.results[5].matchType, "text");
assert.equal(searchModel.search(portfolio, "4P5D4AA-ABA", { activeCategoryId: "pc" }).results[0].productId, "cloud-pc", "spacing and punctuation must not prevent exact SKU matching");

const demoPortfolio = { categories: [{ id: "demo", board: { products: [
  { id: "headset", name: "Demo Headset", partSkus: ["DEMO-1-001"], generalAvailabilityDate: "2026-03-01" },
  { id: "mouse", name: "Demo Mouse", partSkus: ["DEMO-2-001"], endManufacturingDate: "2033-12-01", specs: [{ label: "Buttons", value: "3" }] },
  { id: "keyboard", name: "Demo Keyboard", partSkus: ["DEMO-3-001"] },
  { id: "reference", name: "Reference manual", partSkus: ["DEMO-2-001"], specs: [{ label: "Supported keyboard", value: "Use DEMO-3-001" }] },
] } }] };
for (const query of ["DEMO-3-001", "demo / 3 / 001"]) {
  const atomic = searchModel.search(demoPortfolio, query);
  assert.deepEqual(atomic.results.map((result) => result.productId), ["keyboard", "reference"], "a complete identifier cannot assemble fragments from another SKU plus a date or specification digit");
  assert.equal(atomic.results[0].matchType, "sku-exact");
  assert.equal(atomic.results[1].matchType, "text", "an entire identifier phrase in one specification field remains a valid text match and cannot borrow the product's different SKU");
}
assert.equal(searchModel.matchProduct(demoPortfolio.categories[0].board.products[1], "DEMO-3-001"), null);
assert.equal(searchModel.matchProduct(demoPortfolio.categories[0].board.products[2], "DEMO-3").matchType, "sku-prefix");
assert.equal(searchModel.matchProduct(demoPortfolio.categories[0].board.products[2], "3-001").matchType, "sku-substring");
assert.ok(searchModel.matchProduct(demoPortfolio.categories[0].board.products[2], "Keyboard DEMO-3-001"), "a mixed product-name and SKU query must retain AND matching across fields");
assert.ok(searchModel.matchProduct(pcProduct, "Cloud wireless 2"), "ordinary multi-word queries with a number must retain AND matching");
assert.equal(searchModel.matchProduct({ name: "Another", partSkus: ["HP#other"], specs: [{ label: "Note", value: "suffix" }] }, "HP#suffix"), null);
assert.equal(searchModel.matchProduct({ name: "Matching", partSkus: ["HP#suffix"] }, "HP#suffix").matchType, "sku-exact");
assert.equal(searchModel.matchProduct({ name: "Other locale", partSkus: ["4P5D4AA#ABC"], specs: [{ label: "Market", value: "ABA" }] }, "4p5d4aa aba"), null, "a spaced HP SKU suffix must stay with one code rather than borrowing a different locale from specifications");

const partial = searchModel.search(portfolio, "4p5d4", { activeCategoryId: "pc" });
assert.equal(partial.results[0].matchType, "sku-prefix");
assert.equal(partial.results[0].matchedSku, "4P5D4AA#ABAX", "equal-scoring prefix matches should retain portfolio order");
assert.equal(searchModel.search(portfolio, "p5d4aa").results[0].matchType, "sku-substring");
assert.ok(searchModel.matchProduct(pcProduct, "wireless cafe cloud black detachable"), "all query words may match across different public fields in any order");
assert.ok(searchModel.matchProduct(pcProduct, "CLOUD AURORA 2.4"));
assert.equal(searchModel.matchProduct(pcProduct, "cloud missing"), null, "a missing token must reject the whole match");
assert.equal(searchModel.matchProduct(pcProduct, "cloud 4p5d4aa aba").matchType, "sku-prefix", "a SKU token mixed with a product term still identifies the matching HP SKU");
assert.equal(searchModel.search(portfolio, "HyperX Cloud II", { activeCategoryId: "console" }).results[0].productId, "cloud-pc", "current category cannot outrank a stronger name match");
assert.equal(searchModel.matchProduct(pcProduct, "HyperX Cloud II").matchType, "name-exact");
assert.equal(searchModel.matchProduct(pcProduct, "HyperX Cloud").matchType, "name-prefix");
assert.equal(searchModel.matchProduct({ name: "Cloud Alpha 2", partSkus: ["4P5D2AA"] }, "Cloud Alpha 2").matchType, "name-exact", "a short model number inside a name must not become an incidental HP SKU match");
assert.equal(searchModel.matchProduct({ name: "Cloud Alpha 2 Wireless", partSkus: ["4P5D2AA"] }, "Cloud Alpha 2").matchType, "name-prefix");
assert.equal(searchModel.matchProduct(pcProduct, "BK").matchType, "variant-exact");
assert.equal(searchModel.matchProduct(pcProduct, "BK").matchedVariant, "BK");
assert.equal(searchModel.matchProduct(pcProduct, "BK").matchedSku, "");
assert.equal(searchModel.matchProduct({ name: "Market keyboard", variantGroups: [{ items: [{ code: "US/INTL" }] }] }, "us intl").matchType, "variant-exact");
assert.equal(searchModel.matchProduct({ name: "Market keyboard", variantGroups: [{ items: [{ code: "US/INTL" }] }] }, "int").matchType, "variant-substring");

for (const code of ["9z123aa", "7a777aa"]) {
  const imported = searchModel.matchProduct(pcProduct, code);
  assert.equal(imported.matchType, "sku-exact", "imported unmapped ASCM base part numbers should remain searchable");
  assert.equal(imported.matchedSku, code.toUpperCase());
}
for (const alias of ["basePN", "basePn"]) {
  assert.equal(searchModel.matchProduct({ name: "Imported", ascm: { records: [{ [alias]: "BS1T9AA" }] } }, "bs1t9aa").matchType, "sku-exact");
}
for (const hidden of ["private-product-image", "private-variant-image", "private-master-revision", "private-master-product", "private-secret", "private-source-file", "private-ascm-key", "private-row", "private-predecessor", "private-spec-id", "private-sku-id", "private-library-image", "private-image-name", "private-portfolio-master"]) {
  assert.equal(searchModel.search(portfolio, hidden).total, 0, `${hidden} must not enter the search index`);
}

assert.deepEqual(searchModel.search(portfolio, "4p5d4aa aba", { activeCategoryId: "console", offset: 2, limit: 2 }).results, exact.results.slice(2, 4));
assert.equal(searchModel.search(portfolio, "4p5d4aa aba", { offset: 2, limit: 2 }).total, 6, "total must describe all matches, independent of the page");
assert.deepEqual(searchModel.search(portfolio, "4p5d4aa aba", { offset: 99, limit: 2 }), { results: [], total: 6 });
assert.deepEqual(searchModel.search(portfolio, "4p5d4aa aba", { limit: 0 }), { results: [], total: 6 });
assert.equal(searchModel.search(portfolio, "4p5d4aa aba", { offset: -5, limit: "2" }).results.length, 2);
assert.equal(searchModel.search(portfolio, "4p5d4aa aba", { offset: Infinity, limit: NaN }).results.length, 6);
const many = { categories: [{ id: "many", board: { products: Array.from({ length: 520 }, (_, index) => ({ id: `p-${index}`, name: "Common product" })) } }] };
assert.equal(searchModel.search(many, "common").results.length, 8, "the default page should be bounded");
assert.equal(searchModel.search(many, "common", { limit: 500 }).results.length, 500, "larger caller pages should support stale-result verification");
assert.equal(searchModel.search(many, "common", { offset: 510, limit: 50 }).results.length, 10, "products beyond the per-field item bound must still be scanned");
assert.equal(searchModel.search(many, "common", { limit: 100000 }).total, 520);

const sameIdAcrossCategories = { categories: portfolio.categories.map((category) => ({ ...category, board: { ...category.board, products: [{ ...pcProduct, id: "same-id" }] } })) };
assert.equal(searchModel.search(sameIdAcrossCategories, sku).total, 2, "category/product identity must retain distinct PC and Console listings even if IDs coincide in malformed input");

for (const empty of ["", "   ", "# /", null, undefined]) {
  assert.deepEqual(searchModel.search(portfolio, empty), { results: [], total: 0 });
  assert.equal(searchModel.matchProduct(pcProduct, empty).matchType, "all", "empty category filters should show all products");
}
for (const invalid of [{}, [], Symbol("query"), Infinity, "a".repeat(513), Array.from({ length: 33 }, (_, index) => `term${index}`).join(" ")]) {
  assert.deepEqual(searchModel.search(portfolio, invalid), { results: [], total: 0 });
  assert.equal(searchModel.matchProduct(pcProduct, invalid), null);
}
for (const malformed of [null, {}, { categories: {} }, { categories: [null, { id: "bad", board: { products: [null, undefined, {}, []] } }] }]) {
  assert.deepEqual(searchModel.search(malformed, "headset"), { results: [], total: 0 });
}
assert.equal(searchModel.matchProduct(null, ""), null);
assert.equal(searchModel.normalize({ toString() { throw new Error("Do not stringify objects"); } }), "");
let getterCalls = 0;
const getterProduct = { id: "getter", get name() { getterCalls++; throw new Error("Do not call getters"); } };
assert.equal(searchModel.matchProduct(getterProduct, "anything"), null);
assert.equal(getterCalls, 0);

const hostileName = '<img src=x onerror="globalThis.searchInjected=true">';
const hostileSku = '<script>alert("sku")</script>';
const hostilePortfolio = { categories: [{ id: "hostile", name: '<svg onload="alert(1)">', board: { lanes: [{ id: "lane", label: "<b>Lane</b>" }], products: [{ id: "hostile-product", name: hostileName, laneId: "lane", partSkus: [hostileSku], specs: [{ label: "Regex", value: "a+b [literal]" }] }] } }] };
const hostileHit = searchModel.search(hostilePortfolio, "img onerror").results[0];
assert.equal(hostileHit.productName, hostileName, "labels must remain plain strings for textContent rendering");
assert.equal(hostileHit.categoryName, '<svg onload="alert(1)">');
assert.equal(hostileHit.laneName, "<b>Lane</b>");
assert.equal(globalThis.searchInjected, undefined, "search must not execute markup or source text");
assert.equal(searchModel.search(hostilePortfolio, "script alert sku").results[0].matchedSku, hostileSku);
assert.ok(searchModel.matchProduct(hostilePortfolio.categories[0].board.products[0], "a+b [literal]"), "user input must be literal text, never a regular expression");
assert.equal(searchModel.normalize("x".repeat(100000)).length, 4096, "normalization must bound string work");
const farAwayText = { name: `Headset${" ".repeat(4096)}beyond-bound` };
assert.equal(searchModel.matchProduct(farAwayText, "beyond-bound"), null);

assert.deepEqual(portfolio, original, "search must not mutate product, category, SKU, variant, specification, or master data");
const options = freezeTree({ activeCategoryId: "console", offset: 1, limit: 3 });
searchModel.search(portfolio, sku, options);
assert.deepEqual(options, { activeCategoryId: "console", offset: 1, limit: 3 });
const mutableResult = searchModel.search(portfolio, sku).results[0];
mutableResult.productName = "Changed result only";
assert.equal(searchModel.search(portfolio, sku).results[0].productName, "HyperX Cloud II", "result mutations must not alter records or future searches");

console.log("Portfolio search checks passed.");
