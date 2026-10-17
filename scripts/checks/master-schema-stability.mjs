import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../../public/js/reference-theme.js");
await import("../../public/js/portfolio-model.js");
await import("../../public/js/package-codec.js");
await import("../../public/js/master-model.js");
await import("../../public/js/master-client.js");

const clone = value => JSON.parse(JSON.stringify(value));
const model = globalThis.PortfolioMasterModel;
const source = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
function appFunctionSource(name) {
  const definition = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(definition, `Schema regression requires the actual ${name} function`);
  return definition[0];
}

// Keep the production schema and category activation intact. Only browser
// rendering and local persistence are inert; no backend or private data is used.
const sandbox = {
  window: {}, crypto: globalThis.crypto, PortfolioModel: globalThis.PortfolioModel, canvasScroll: { scrollLeft: 0, scrollTop: 0 },
  PortfolioPackage: globalThis.PortfolioPackage, PortfolioTheme: globalThis.PortfolioTheme,
  UI_FONT_FACE: globalThis.PortfolioTheme.fontFace,
  PPTXPagination: { paginateRoadmapGroups() { return []; } },
};
vm.createContext(sandbox);
new vm.Script(await readFile(new URL("../../public/js/catalog-data.js", import.meta.url), "utf8")).runInContext(sandbox);
const testedFunctions = [
  "id", "ensureImageAssetRegistry", "migrateLegacyProductImages", "standardColorByKey", "inferStandardColor",
  "variantGroup", "displayColorVariant", "normalizeColorVariant", "normalizeLayoutVariant", "normalizeVariantGroup", "productVariantGroups",
  "productColorVariants", "colorVariantById", "colorVariantWithImage", "makeRoadmap", "monthStringFromDate",
  "monthIndex", "monthString", "addMonths", "normalizeMonth", "categoryDefinition", "normalizeRoadmapStatus",
  "inferFamily", "defaultRoadmapForProduct", "normalizeProductInfoDate", "normalizeAscmRecord",
  "normalizeAscmProductMetadata", "normalizeAscmSnapshot", "normalizePartSku", "ensureBoardSchema",
  "normalizeCardStatusType", "standardizedStatus", "catalogImageAssetId", "catalogImageAssets", "packageCodec",
  "ensurePortfolioSchema", "parseHexColor", "normalizeHexColor", "activateCategory",
];
new vm.Script(`${source.slice(0, source.indexOf("const $ ="))}
  let portfolio, board, selectedId, activeCategoryId = "pc-gaming-audio";
  let viewerInfoProgress = 0, viewerInfoProductId = null, viewerInfoOpen = false;
  let productLayoutEditing = false, hoveredHeroVariant = null, zoom = 1, roadmapMonthWidth = 82;
  let initialVerticalFitPending = false, searchQuery = "", roadmapSearchQuery = "";
  const activeView = "products", roadmapDetailsOpen = false, viewerInfoOutline = null;
  const roadmapLaneHovers = new Map(), SAMPLE_ROADMAP = {}, pendingLegacyImageBlobs = [];
  const inputs = new Map();
  function $(selector) { if (!inputs.has(selector)) inputs.set(selector, { value: "" }); return inputs.get(selector); }
  function finishProductReorder() {} function stopProductCardDrag() {} function closeViewerInfo() {} function closeInspector() {}
  function updateProductLayoutEditControls() {} function closeVariantPopover() {} function stopRoadmapSlotEditing() {}
  function scheduleSave() {} function syncControls() {} function renderInspector() {} function renderActiveView() {}
  function fitProductLanesVertically() {}
  ${testedFunctions.map(appFunctionSource).join("\n")}
  globalThis.integration = {
    load(value) { portfolio = ensurePortfolioSchema(value); activateCategory(portfolio.activeCategoryId, { fitVertical: false }); },
    activate: (categoryId) => activateCategory(categoryId, { fitVertical: false }),
    state: () => JSON.parse(JSON.stringify(portfolio)),
    products: () => portfolio.categories.flatMap(category => category.board.products.map(product => ({ ...product, categoryId: category.id }))),
    edit(productId, edit) { for (const category of portfolio.categories) { const product = category.board.products.find(item => item.id === productId); if (product) { edit(product); return; } } },
    normalizeColor: normalizeColorVariant,
    displayColor: displayColorVariant,
    displayGroups: (product) => productVariantGroups(product, { display: true }),
  };
`, { filename: "actual-app-schema-and-category.js" }).runInContext(sandbox);
const app = sandbox.integration;
const categories = clone(sandbox.window.PORTFOLIO_CATALOG.categories);
assert.ok(categories.length >= 2, "The category-switch regression requires two actual catalog definitions.");
const acceptedRows = index => [
  { id: `${index}-black`, code: "BK", colorKey: "black", colorName: "Black", colorHex: "", colorKey2: "", colorName2: "", colorHex2: "" },
  { id: `${index}-white`, code: "WHT", colorKey: "white", colorName: "White", colorHex: "", colorKey2: "", colorName2: "", colorHex2: "" },
  { id: `${index}-pink`, code: "BK/PNK", colorKey: "black", colorName: "Black", colorHex: "", colorKey2: "pink", colorName2: "Pink", colorHex2: "" },
  { id: `${index}-gunmetal`, code: "BK/GM", colorKey: "black", colorName: "Black", colorHex: "", colorKey2: "gunmetal", colorName2: "Gunmetal", colorHex2: "" },
  { id: `${index}-custom`, code: "CUSTOM", colorKey: "custom", colorName: "Black", colorHex: "#334455", colorKey2: "", colorName2: "", colorHex2: "" },
];
const seed = {
  version: 4, activeCategoryId: categories[0].id, settings: {}, imageAssets: [],
  categories: categories.map(category => ({ id: category.id, name: category.name, board: { lanes: clone(category.lanes), settings: {}, products: [] } })),
};
for (let index = 0; index < 101; index++) {
  const category = seed.categories[index % 2];
  const emptyDates = index >= 15 && index < 27;
  category.board.products.push({
    id: `accepted-${index}`, name: `Synthetic accepted product ${index}`, laneId: category.board.lanes[0].id,
    // Accepted positions can have both a missing slot and duplicate numbers;
    // repeated schema loads/category switches must preserve these facts too.
    order: index === 30 || index === 31 ? 15 : Math.floor(index / 2) + (index >= 14 ? 1 : 0), price: 99, statusType: "none", statusLabel: "", specs: [], partSkus: [],
    generalAvailabilityDate: "", endManufacturingDate: emptyDates ? "2024-12-31" : "",
    roadmap: { family: "Other", status: "in-planning", confidence: "medium", startMonth: emptyDates ? "" : "2026-01", launchMonth: emptyDates ? "" : "2026-01", endMonth: emptyDates ? "2024-12" : index === 27 ? "" : "2030-12", predecessorId: "", successorId: "" },
    variantGroups: [{ id: `colors-${index}`, type: "color", label: index % 2 ? "" : "Color", items: acceptedRows(index) }],
  });
}
const baseline = model.snapshot(seed).products;
const originalSharedValues = new Map(baseline.map(product => [product.productId, clone(product.values)]));
const session = globalThis.PortfolioMasterClient.createSession({
  adapter: { getProducts: () => app.products(), getBaselineProducts: () => clone(baseline), applyPatches() { throw new Error("This local schema check must not apply remote changes."); } },
  fetchImpl() { throw new Error("This local schema check must not contact a backend."); },
});
function assertClean(label) {
  const pending = session.track();
  assert.equal(pending.length, 0, `${label}: accepted records must not turn into unsaved changes (${pending.length} phantom products).`);
  for (const product of app.products()) assert.deepEqual(model.productValues(product), originalSharedValues.get(product.id), `${label}: shared facts for ${product.id} are preserved.`);
}

app.load(clone(seed));
assertClean("Initial package/schema load");
for (const category of seed.categories) { app.activate(category.id); assertClean(`Category activation ${category.id}`); }
for (let pass = 0; pass < 3; pass++) {
  app.load(clone(app.state()));
  assertClean(`Reload ${pass + 1}`);
}
const accepted = app.products().find(product => product.id === "accepted-15");
assert.equal(accepted.roadmap.startMonth, ""); assert.equal(accepted.roadmap.launchMonth, "");
assert.equal(accepted.roadmap.endMonth, "2024-12"); assert.equal(accepted.endManufacturingDate, "2024-12-31");
assert.equal(app.products().find(product => product.id === "accepted-27").roadmap.endMonth, "", "An explicitly blank planned end month remains unset.");
assert.equal(accepted.variantGroups[0].label, "", "An accepted blank group label remains unset.");
assert.equal(accepted.variantGroups[0].items[3].colorKey2, "gunmetal");
assert.equal(accepted.variantGroups[0].items[3].colorHex2, "");
assert.equal(accepted.variantGroups[0].items[4].colorName, "Black");
assert.equal(accepted.variantGroups[0].items[4].colorHex, "#334455");

app.edit("accepted-0", product => { product.variantGroups[0].items[4].colorHex = "#556677"; });
app.edit("accepted-1", product => { product.roadmap.startMonth = "2026-04"; product.roadmap.launchMonth = "2026-04"; });
let pending = session.track();
assert.deepEqual(pending.map(product => product.productId).sort(), ["accepted-0", "accepted-1"], "Real custom color and planned date edits remain reviewable.");
assert.deepEqual(Object.keys(pending.find(product => product.productId === "accepted-0").patch), ["variantGroups"]);
assert.deepEqual(Object.keys(pending.find(product => product.productId === "accepted-1").patch), ["startMonth"]);
app.load(clone(app.state()));
for (const category of seed.categories) app.activate(category.id);
pending = session.track();
assert.deepEqual(pending.map(product => product.productId).sort(), ["accepted-0", "accepted-1"], "Reloading and switching preserve genuine drafts without adding phantom changes.");
assert.equal(app.products().find(product => product.id === "accepted-0").variantGroups[0].items[4].colorHex, "#556677");
assert.equal(app.products().find(product => product.id === "accepted-1").roadmap.startMonth, "2026-04");

const legacy = clone(app.normalizeColor({ code: "BK", colorName: "Black" }));
assert.ok(legacy.id, "Legacy rows without identities still receive stable usable identities.");
assert.equal(legacy.colorKey, "black"); assert.equal(legacy.colorHex, "#111111");
const legacyDual = clone(app.normalizeColor({ code: "BK/PNK", colorName: "Black / Pink", colorHex2: "#c34d78" }));
assert.equal(legacyDual.colorKey, "black"); assert.equal(legacyDual.colorKey2, "pink");
assert.equal(legacyDual.colorHex2, "#c34d78");

const sparseDisplayProduct = clone(accepted);
const beforeDisplay = clone(sparseDisplayProduct);
const displayGroups = app.displayGroups(sparseDisplayProduct);
assert.deepEqual(sparseDisplayProduct, beforeDisplay, "Projecting display defaults never writes inferred colors back to shared rows.");
assert.notEqual(displayGroups, sparseDisplayProduct.variantGroups);
assert.notEqual(displayGroups[0], sparseDisplayProduct.variantGroups[0]);
assert.notEqual(displayGroups[0].items[0], sparseDisplayProduct.variantGroups[0].items[0]);
assert.equal(displayGroups[0].items[0].colorHex, "#111111", "An accepted blank Black hex still has a usable swatch.");
assert.equal(displayGroups[0].items[1].colorHex, "#f2f2f2");
assert.equal(displayGroups[0].items[2].colorHex2, "#c34d78");
assert.equal(displayGroups[0].items[4].colorHex, "#334455", "A custom color named Black retains its chosen swatch.");
assert.equal(displayGroups[0].items[4].colorKey, "custom");
const explicitHex = { id: "explicit-custom-hex", code: "BK", colorKey: "black", colorName: "Black", colorHex: "#334455", colorKey2: "gunmetal", colorName2: "Gunmetal", colorHex2: "#445566" };
const explicitBefore = clone(explicitHex), explicitProjection = app.displayColor(explicitHex);
assert.equal(explicitProjection.colorHex, "#334455", "An explicit non-preset primary hex wins over a known name/key.");
assert.equal(explicitProjection.colorHex2, "#445566", "An explicit unknown secondary hex remains usable.");
assert.deepEqual(explicitHex, explicitBefore);
app.load(clone(seed));
for (const product of app.products()) app.displayGroups(product);
assertClean("Color display projection");

const legacySeed = clone(seed);
for (const category of legacySeed.categories) category.board.products = [];
legacySeed.categories[0].board.products.push({ id: "legacy-product", name: "Legacy import", laneId: legacySeed.categories[0].board.lanes[0].id, order: 0, price: 49, skus: [{ code: "BK", colorName: "Black" }] });
app.load(legacySeed);
const migrated = app.products().find(product => product.id === "legacy-product");
assert.equal(migrated.skus, undefined, "The actual schema still migrates legacy SKU collections.");
assert.equal(migrated.variantGroups[0].type, "color");
assert.equal(migrated.variantGroups[0].items[0].colorKey, "black");
assert.equal(migrated.variantGroups[0].items[0].colorHex, "#111111");
assert.match(migrated.roadmap.startMonth, /^\d{4}-\d{2}$/);
assert.match(migrated.roadmap.endMonth, /^\d{4}-\d{2}$/);
assert.ok(migrated.roadmap.endMonth >= migrated.roadmap.startMonth, "Missing legacy roadmap properties still receive an ordered default range.");
const migratedValues = clone(model.productValues(migrated));
app.load(clone(app.state()));
assert.deepEqual(clone(model.productValues(app.products().find(product => product.id === "legacy-product"))), migratedValues, "Legacy migration is stable on the following reload.");

console.log("Master schema stability checks passed: 101 accepted synthetic products and 12 explicit blank/retired date ranges remain clean through real schema loads, reloads and category activation; declared colors and genuine edits are preserved, display swatches are nonmutating, and legacy color import is retained.");
