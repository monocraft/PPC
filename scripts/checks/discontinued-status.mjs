import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../../public/js/date-precision.js");
await import("../../public/js/reference-theme.js");
await import("../../public/js/portfolio-model.js");
await import("../../public/js/package-codec.js");
await import("../../public/js/master-model.js");
await import("../../public/js/master-client.js");

const clone = value => JSON.parse(JSON.stringify(value));
const model = globalThis.PortfolioMasterModel;
const source = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
function appFunction(name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, `The status regression must exercise the actual ${name} function.`);
  return match[0];
}
const sandbox = {
  window: {}, crypto: globalThis.crypto, PortfolioModel: globalThis.PortfolioModel,
  PortfolioPackage: globalThis.PortfolioPackage, PortfolioTheme: globalThis.PortfolioTheme,
  UI_FONT_FACE: globalThis.PortfolioTheme.fontFace,
  PPTXPagination: { paginateRoadmapGroups() { return []; } },
};
vm.createContext(sandbox);
new vm.Script(await readFile(new URL("../../public/js/catalog-data.js", import.meta.url), "utf8")).runInContext(sandbox);
const dependencies = [
  "id", "ensureImageAssetRegistry", "migrateLegacyProductImages", "standardColorByKey", "inferStandardColor",
  "variantGroup", "displayColorVariant", "normalizeColorVariant", "normalizeLayoutVariant", "normalizeVariantGroup", "productVariantGroups",
  "productColorVariants", "colorVariantById", "colorVariantWithImage", "makeRoadmap", "monthStringFromDate",
  "monthIndex", "monthString", "addMonths", "normalizeMonth", "categoryDefinition", "normalizeRoadmapStatus",
  "inferFamily", "defaultRoadmapForProduct", "normalizeProductInfoDate", "normalizeAscmRecord",
  "normalizeAscmProductMetadata", "normalizeAscmSnapshot", "normalizePartSku", "ensureBoardSchema",
  "normalizeCardStatusType", "standardizedStatus", "catalogImageAssetId", "catalogImageAssets", "packageCodec",
  "ensurePortfolioSchema", "parseHexColor", "normalizeHexColor", "productPresentation",
  "productStatusPatch", "roadmapStatusPatch", "effectiveCardStatus", "effectiveRoadmapStatus",
];
new vm.Script(`${source.slice(0, source.indexOf("const $ ="))}
  let portfolio, activeCategoryId = "pc-gaming-audio";
  const SAMPLE_ROADMAP = {}, pendingLegacyImageBlobs = [];
  ${dependencies.map(appFunction).join("\n")}
  globalThis.statusTest = {
    load(value) { portfolio = ensurePortfolioSchema(value); return portfolio; },
    productPatch: productStatusPatch, roadmapPatch: roadmapStatusPatch,
    cardStatus: effectiveCardStatus, roadmapStatus: effectiveRoadmapStatus,
    presentation: productPresentation, status: standardizedStatus,
  };
`, { filename: "actual-app-discontinued-status.js" }).runInContext(sandbox);
const app = sandbox.statusTest;
const presetLabel = app.status("discontinued").label;
assert.equal(presetLabel.toLowerCase(), "discontinued", "Discontinued is a registered persistent Product status.");
assert.match(source, /<option value="discontinued"[^>]*>Discontinued<\/option>/, "The Product editor exposes the Discontinued option.");
assert.match(source, /bindValue\("#fieldStatus",\s*"change",[^\n]*productStatusPatch\(/, "The actual Product status handler uses the paired transition.");
assert.match(source, /bindValue\("#fieldRoadmapStatus",\s*"change",[^\n]*roadmapStatusPatch\(/, "The actual Roadmap status handler uses the paired transition.");

const definitions = clone(sandbox.window.PORTFOLIO_CATALOG.categories);
function fixture(id, statusType = "new", stage = "launched", end = "9999-12-31") {
  return {
    id, name: `Synthetic status ${id}`, laneId: definitions[0].lanes[0].id, order: 0, price: 99,
    statusType, statusLabel: app.status(statusType).label,
    imageAssetId: "fixture-main", featuredVariantId: "fixture-color", codename: "Fixture", tier: "Core",
    generalAvailabilityDate: end === "2000-01-01" ? "1999-01-15" : "2026-01-15", ffsDate: "2025-12-20", endManufacturingDate: end,
    globalAnnouncementDate: "2026-01-01", webReadinessDate: "2026-01-02", finalAssetsDate: "2026-01-03",
    roadmap: { family: "Fixture", status: stage, confidence: "medium", startMonth: "2026-01", launchMonth: "2026-01", endMonth: "", predecessorId: "fixture-before", successorId: "fixture-after" },
    specs: [{ id: "fixture-spec", label: "Connection", value: "Wireless" }],
    partSkus: [{ id: "fixture-sku", code: "SYNTHETIC-001", variantId: "fixture-color" }],
    variantGroups: [{ id: "fixture-colors", type: "color", label: "", items: [{ id: "fixture-color", code: "CUSTOM", colorKey: "custom", colorName: "Black", colorHex: "#334455", colorKey2: "gunmetal", colorName2: "Gunmetal", colorHex2: "", imageAssetId: "fixture-variant", generalAvailabilityDate: "2026-02-01", endManufacturingDate: "2028-12-31" }] }],
    plc: { version: 1, fields: { endManufacturingDate: { value: end, source: "synthetic-proof", evidence: { retained: true } } } },
    dateEdits: { endManufacturingDate: [{ id: "fixture-edit", value: end, reason: "Synthetic accepted history" }] },
    unrelatedMetadata: { unchanged: [1, 2, 3] },
  };
}
const seed = {
  version: 4, activeCategoryId: definitions[0].id, settings: {}, imageAssets: [],
  categories: definitions.map(category => ({ id: category.id, name: category.name, board: { lanes: clone(category.lanes), settings: {}, products: [] } })),
};
seed.categories[0].board.products = [
  fixture("active"), fixture("manual", "discontinued"), fixture("existing-eol", "new", "end-of-life"),
  fixture("elapsed-eom", "new", "launched", "2000-01-01"), fixture("eol-none", "none", "end-of-life"),
  { ...fixture("manual-blank", "discontinued"), statusLabel: "" },
  { ...fixture("manual-titlecase", "discontinued"), statusLabel: "Discontinued" },
];
const baseline = clone(model.snapshot(seed).products);
let state = app.load(clone(seed));
const products = () => state.categories.flatMap(category => category.board.products.map(product => ({ ...product, categoryId: category.id })));
const actual = id => state.categories.flatMap(category => category.board.products).find(product => product.id === id);
function assertFactsUnchanged(before, after, label) {
  const expected = clone(before), result = clone(after);
  delete expected.statusType; delete expected.statusLabel; delete result.statusType; delete result.statusLabel;
  if (expected.roadmap) delete expected.roadmap.status;
  if (result.roadmap) delete result.roadmap.status;
  assert.deepEqual(result, expected, `${label}: dates, planned months, specifications, images and metadata are preserved.`);
}
function apply(product, patch, label) {
  const before = clone(product);
  Object.assign(product, globalThis.PortfolioModel.mergeProductUpdate(product, clone(patch)));
  assertFactsUnchanged(before, product, label);
  return product;
}
function assertPair(product, card, roadmap, label) {
  assert.equal(product.statusType, card, `${label}: saved Product status`);
  assert.equal(product.roadmap.status, roadmap, `${label}: saved Roadmap status`);
}

// Existing accepted EOL and elapsed-EOM products project into both dropdowns.
// Merely reading or loading those values must never create a migration draft.
const beforeProjection = clone(state);
for (const id of ["manual", "existing-eol", "elapsed-eom", "eol-none", "manual-blank", "manual-titlecase"]) {
  assert.equal(app.cardStatus(actual(id)), "discontinued", `${id}: Product editor reflects effective discontinuation.`);
  assert.equal(app.roadmapStatus(actual(id)), "end-of-life", `${id}: Roadmap editor reflects the same effective state.`);
  assert.equal(app.presentation(actual(id)).primaryLabel.toLowerCase(), "discontinued");
}
assert.equal(actual("existing-eol").statusType, "new", "A preexisting EOL record retains its accepted raw Product flag.");
assert.equal(actual("elapsed-eom").roadmap.status, "launched", "An elapsed date does not rewrite the accepted Roadmap stage.");
assert.deepEqual(clone(state), beforeProjection, "All effective status projections are read-only.");

let acceptedBaseline = clone(baseline), remote = { products: clone(baseline), revision: "status-initial", canWrite: true }, sequence = 0;
let requestCount = 0;
const adapter = {
  getProducts: products, getBaselineProducts: () => clone(acceptedBaseline),
  setBaselineProducts(value) { acceptedBaseline = clone(value); },
  applyPatches(changes) {
    for (const category of state.categories) category.board.products = category.board.products.map(product => {
      const change = changes.find(item => item.productId === product.id);
      return change ? model.applyProductValues(product, change.values) : product;
    });
    state = app.load(clone(state));
  },
};
const session = globalThis.PortfolioMasterClient.createSession({
  endpoint: "https://synthetic-status.example/api/master", adapter,
  async fetchImpl(url, options) {
    requestCount++;
    const body = JSON.parse(options.body);
    if (url.endsWith("/latest")) return Response.json({ snapshot: remote });
    assert.ok(url.endsWith("/save"), "Only the explicit local mock save is permitted.");
    for (const change of body.changes) {
      assert.ok(Object.keys(change.patch).every(key => ["statusType", "statusLabel", "roadmapStatus"].includes(key)), "A status change publishes only the two linked statuses and their label.");
      const target = remote.products.find(item => item.productId === change.productId);
      const next = { ...target.values, ...clone(change.patch) };
      for (const operation of model.diffOperations(target.values, next)) target.revisions[operation.path] = ++sequence;
      target.values = next;
    }
    remote.revision = `status-${++sequence}`;
    return Response.json({ snapshot: remote, savedFields: body.changes.length });
  },
});
assert.equal(session.track().length, 0, "Loading accepted explicit/legacy discontinuations creates zero pending changes.");
for (let pass = 0; pass < 2; pass++) {
  state = app.load(clone(state));
  assert.equal(session.track().length, 0, "Reloading keeps the accepted baseline clean.");
}
assert.deepEqual(acceptedBaseline, baseline, "Projection and schema loads do not adopt or alter accepted baseline values.");
assert.equal(requestCount, 0, "Load and editor projection do not contact any backend or mock service.");

// Explicit user changes pair the two controls, preserving all unrelated data.
for (const status of ["none", "new", "in-development", "embargo", "sunsetting"]) {
  const product = fixture(`product-${status}`);
  const beforePatch = clone(product);
  const patch = app.productPatch(product, "discontinued");
  assert.deepEqual(product, beforePatch, "Constructing a Product patch does not mutate its input.");
  apply(product, patch, "Product to Discontinued");
  assertPair(product, "discontinued", "end-of-life", "Product to Discontinued");
  apply(product, app.productPatch(product, status), `Product leaving Discontinued for ${status}`);
  assertPair(product, status, ["in-development", "embargo"].includes(status) ? status : "launched", `Product leaving Discontinued for ${status}`);
}
for (const stage of ["launched", "in-planning", "in-development", "embargo"]) {
  const product = fixture(`roadmap-${stage}`);
  const beforePatch = clone(product);
  const patch = app.roadmapPatch(product, "end-of-life");
  assert.deepEqual(product, beforePatch, "Constructing a Roadmap patch does not mutate its input.");
  apply(product, patch, "Roadmap to End of life");
  assertPair(product, "discontinued", "end-of-life", "Roadmap to End of life");
  apply(product, app.roadmapPatch(product, stage), `Roadmap leaving End of life for ${stage}`);
  assertPair(product, ["in-development", "embargo"].includes(stage) ? stage : "none", stage, `Roadmap leaving End of life for ${stage}`);
}
for (const flag of ["new", "sunsetting", "none"]) {
  const product = fixture(`retained-${flag}`, flag, "end-of-life");
  apply(product, app.roadmapPatch(product, "launched"), "Leaving existing EOL preserves unrelated saved flags");
  assertPair(product, flag, "launched", "Leaving existing EOL preserves unrelated saved flags");
}
for (const end of ["", "2000-01-01", "9999-12-31"]) {
  const product = fixture(`date-${end || "blank"}`, "none", "launched", end);
  apply(product, app.productPatch(product, "discontinued"), "Explicit discontinuation with preserved end date");
  apply(product, app.productPatch(product, "new"), "Reopening with preserved end date");
  assert.equal(product.endManufacturingDate, end, "A status change never invents, clears or moves the actual end date.");
  assert.equal(app.cardStatus(product), end === "2000-01-01" ? "discontinued" : "new", "Elapsed EOM remains effective evidence after a user changes the saved flag.");
}

await session.connect({ key: globalThis.PortfolioPackage.generateKey() });
const originalActive = clone(actual("active"));
apply(actual("active"), app.productPatch(actual("active"), "discontinued"), "Interactive Product status change");
assert.equal(session.track().length, 1, "The explicit change appears as one genuine pending product.");
assert.deepEqual(Object.keys(session.track()[0].patch).sort(), ["roadmapStatus", "statusLabel", "statusType"].sort());
state = app.load(clone(state));
assert.equal(session.track().length, 1, "Reload preserves the genuine paired draft.");
await session.save();
assert.equal(session.track().length, 0, "The accepted paired status clears pending changes.");
state = app.load(clone(state));
assert.equal(session.track().length, 0, "Accepted paired statuses remain clean after reload.");
assertPair(actual("active"), "discontinued", "end-of-life", "Saved status round trip");
assertFactsUnchanged(originalActive, actual("active"), "Saved status round trip");
apply(actual("active"), app.roadmapPatch(actual("active"), "embargo"), "Interactive Roadmap status change");
await session.save();
state = app.load(clone(state));
assert.equal(session.track().length, 0);
assertPair(actual("active"), "embargo", "embargo", "Leaving EOL save round trip");
assertFactsUnchanged(originalActive, actual("active"), "Leaving EOL save round trip");

console.log("Discontinued status checks passed: real Product/Roadmap controls pair explicit transitions, existing EOL and elapsed dates project without migration, accepted baselines stay clean, narrow mock saves survive reload, and dates/specifications/images/history remain unchanged.");
