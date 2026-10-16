import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../../public/js/date-precision.js");
await import("../../public/js/portfolio-model.js");

const model = globalThis.PortfolioModel;
const today = new Date(2026, 9, 15, 0, 0, 0);
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const quarter = (field, year, q, evidence = {}) => {
  const period = globalThis.PortfolioDatePrecision.parseQuarter(`Q${q} ${year}`);
  return { [field]: period.start, plc: { fields: { [field]: { value: period.start, period, ...evidence } } } };
};
const gaQuarter = (year, q, evidence) => quarter("generalAvailabilityDate", year, q, evidence);
const eomQuarter = (year, q, evidence) => quarter("endManufacturingDate", year, q, evidence);
const stage = value => ({ roadmap: { status: value } });
let checks = 0;
const cases = [
  [null, today, "unknown", "no product"],
  [{}, today, "unknown", "no stage or date"],
  [stage("launched"), today, "launched", "explicit launched"],
  [stage("in-planning"), today, "unreleased", "explicit planning"],
  [stage("in-development"), today, "unreleased", "explicit development"],
  [stage("embargo"), today, "unreleased", "roadmap embargo"],
  [stage("end-of-life"), today, "eol", "explicit EOL without a date"],
  [{ statusType: "discontinued" }, today, "eol", "explicit product Discontinued without a date"],
  [{ statusType: "discontinued", ...stage("embargo"), endManufacturingDate: "9999-12-31" }, today, "eol", "Discontinued precedes stale Embargo and future EOM"],
  [{ statusType: "discontinued" }, new Date(NaN), "eol", "explicit Discontinued needs no clock"],
  [{ statusType: "in-development", ...stage("launched") }, today, "unreleased", "development flag takes precedence"],
  [{ statusType: "embargo", ...stage("launched") }, today, "unreleased", "embargo flag takes precedence"],
  [{ statusType: "new" }, today, "unknown", "New is not launch evidence"],
  [{ statusType: "sunsetting" }, today, "unknown", "Sunsetting is not EOL evidence"],
  [{ statusType: "new", ...stage("in-planning") }, today, "unreleased", "New does not replace planning"],
  [{ statusType: "sunsetting", ...stage("launched") }, today, "launched", "Sunsetting does not replace launched"],
  [{ statusType: "embargo", ...stage("end-of-life") }, today, "eol", "explicit EOL precedes embargo"],
  [{ ...stage("in-development"), endManufacturingDate: "2026-10-14" }, today, "eol", "past EOM precedes development"],
  [{ ...stage("in-planning"), endManufacturingDate: "2026-10-15" }, today, "eol", "EOM today is inclusive"],
  [{ ...stage("launched"), endManufacturingDate: "2026-10-16" }, today, "launched", "future EOM remains launched"],
  [{ ...stage("launched"), generalAvailabilityDate: "2099-01-01" }, today, "launched", "explicit stage precedes date fallback"],
  [{ ...stage("in-planning"), generalAvailabilityDate: "2000-01-01" }, today, "unreleased", "planning precedes date fallback"],
  [{ generalAvailabilityDate: "2026-10-14" }, today, "launched", "past exact GA"],
  [{ generalAvailabilityDate: "2026-10-15" }, today, "launched", "GA today is inclusive"],
  [{ generalAvailabilityDate: "2026-10-16" }, today, "unreleased", "future exact GA"],
  [{ generalAvailabilityDate: "2024-02-29" }, today, "launched", "valid leap day"],
  ...["", "TBD", "2026-02-30", "2025-02-29", "2026-10", "Q4 2026", "10/14/2026", "2026-10-14junk"].map(value => [{ generalAvailabilityDate: value }, today, "unknown", `invalid GA ${value}`]),
  ...["", "unknown", "constructor", "toString", "__proto__", "LAUNCHED", "planned", "concept"].map(value => [stage(value), today, "unknown", `no implicit stage default ${value}`]),
  [{ ...stage("unknown"), generalAvailabilityDate: "2026-10-15" }, today, "launched", "unknown stage permits factual date fallback"],
  [gaQuarter(2026, 3), new Date(2026, 8, 30), "unknown", "GA quarter last day remains uncertain"],
  [gaQuarter(2026, 3), new Date(2026, 9, 1), "launched", "GA quarter becomes launched after it ends"],
  [gaQuarter(2026, 4), new Date(2026, 8, 30), "unreleased", "GA quarter wholly in future"],
  [gaQuarter(2026, 4), new Date(2026, 9, 1), "unknown", "GA quarter first day is uncertain"],
  [gaQuarter(2026, 4), today, "unknown", "GA quarter anchor is not exact GA"],
  [gaQuarter(2026, 4), new Date(2026, 11, 31), "unknown", "Q4 last day is still inside GA window"],
  [gaQuarter(2026, 4), new Date(2027, 0, 1), "launched", "Q4 next year boundary"],
  ...[null, false, [], {}, { precision: "quarter", basis: "fiscal", year: 2026, quarter: 4 }, { precision: "quarter", basis: "calendar", year: 2026, quarter: 4, end: "2026-10-01" }].map(period => [gaQuarter(2026, 4, { period }), today, "unknown", "malformed active GA precision cannot become exact anchor"]),
  [gaQuarter(2026, 4, { supersededAt: "2026-10-14T00:00:00Z" }), today, "launched", "superseded precision leaves saved exact day authoritative"],
  [gaQuarter(2026, 4, { value: "2026-07-01" }), today, "launched", "stale precision cannot override current exact day"],
  [eomQuarter(2026, 3), new Date(2026, 8, 29), "unknown", "EOM quarter not ended"],
  [eomQuarter(2026, 3), new Date(2026, 8, 30), "eol", "EOM quarter final day is inclusive"],
  [{ ...stage("launched"), ...eomQuarter(2026, 4) }, today, "launched", "future EOM quarter does not hide launched card"],
  [{ ...stage("launched"), ...eomQuarter(2026, 4, { period: {} }) }, today, "launched", "invalid EOM precision does not prove EOL"],
  [{ variantGroups: [{ items: [{ generalAvailabilityDate: "2000-01-01", endManufacturingDate: "2000-02-01" }] }] }, today, "unknown", "variant dates do not classify the whole product"],
  [{ generalAvailabilityDate: "2000-01-01" }, new Date(NaN), "unknown", "invalid clock cannot establish date fallback"],
  [stage("launched"), new Date(NaN), "launched", "explicit stage needs no working clock"],
];
for (const [product, now, expected, label] of cases) {
  freeze(product);
  const before = JSON.stringify(product);
  assert.equal(model.catalogLifecycle(product, now), expected, label);
  assert.equal(JSON.stringify(product), before, `${label}: immutable source`);
  checks++;
}
class LocalBoundaryDate extends Date { getFullYear() { return 2026; } getMonth() { return 9; } getDate() { return 14; } }
class AheadBoundaryDate extends Date { getFullYear() { return 2026; } getMonth() { return 9; } getDate() { return 16; } }
assert.equal(model.catalogLifecycle({ generalAvailabilityDate: "2026-10-15" }, new LocalBoundaryDate("2026-10-15T06:59:59Z")), "unreleased");
assert.equal(model.catalogLifecycle({ generalAvailabilityDate: "2026-10-16" }, new AheadBoundaryDate("2026-10-15T10:00:00Z")), "launched");
checks += 2;

const products = freeze([
  { id: "launched", ...stage("launched"), imageAssetId: "main", featuredVariantId: "black", variantGroups: [{ id: "colors", items: [{ id: "black", imageAssetId: "variant" }] }], specs: [{ id: "spec", value: "Technical (condition)" }], revisions: { plc: 12 } },
  { id: "unreleased", ...stage("in-planning"), generalAvailabilityDate: "2000-01-01" },
  { id: "dated-eol", ...stage("launched"), endManufacturingDate: "2000-01-01" },
  { id: "stage-eol", ...stage("end-of-life") },
  { id: "unknown", statusType: "new", unknownEvidence: { retained: [null, false, ""] } },
].map(product => ({ ...product, laneId: "main", name: product.id })));
const productBytes = JSON.stringify(products);
assert.deepEqual(model.CATALOG_GROUPS, ["all", "launched", "unreleased", "eol"]);
assert.ok(Object.isFrozen(model.CATALOG_GROUPS));
assert.equal(model.catalogProducts(products, {}, today), products);
assert.equal(model.catalogProducts(products, { catalogGroup: "all", hideDiscontinued: true }, today), products, "explicit All overrides stale checkbox");
for (const [group, expected] of [["launched", ["launched"]], ["unreleased", ["unreleased"]], ["eol", ["dated-eol", "stage-eol"]]]) {
  for (const legacy of [false, true]) assert.deepEqual(model.catalogProducts(products, { catalogGroup: group, hideDiscontinued: legacy }, today).map(p => p.id), expected);
}
assert.deepEqual(model.catalogProducts(products, { hideDiscontinued: true }, today).map(p => p.id), ["launched", "unreleased", "unknown"], "legacy checkbox follows the same explicit EOL and date evidence as the cards");
assert.equal(model.catalogProducts(products, { hideDiscontinued: "true" }, today), products);
for (const value of [null, false, "unknown", "ALL", "constructor", {}, []]) {
  assert.equal(model.catalogProducts(products, { catalogGroup: value }, today), products, "invalid model preference fails safely without dropping cards");
  assert.equal(model.catalogProducts(products, { catalogGroup: value, hideDiscontinued: true }, today).length, 3, "invalid mode cannot bypass an old explicit hide");
}
assert.deepEqual(model.catalogLifecycleCounts(products, today), { all: 5, launched: 1, unreleased: 1, eol: 2, unknown: 1 });
assert.deepEqual(model.catalogLifecycleCounts(null, today), { all: 0, launched: 0, unreleased: 0, eol: 0, unknown: 0 });
assert.deepEqual(model.catalogProducts(null, { catalogGroup: "eol" }, today), []);
assert.equal(model.catalogProducts(products, { catalogGroup: "eol" }, today)[0], products[2], "filtered cards retain original object identities");
assert.equal(JSON.stringify(products), productBytes, "filter/count operations preserve every field, array, source value, clock, default and image");
checks += 25;

// Detail groups are exclusive so independent chips compose by union, without
// counting an In development product twice under an Unreleased parent chip.
const detailProducts = freeze([
  { id: "released", ...stage("launched") },
  { id: "development", ...stage("in-development") },
  { id: "planning", ...stage("in-planning") },
  { id: "embargo", statusType: "embargo", ...stage("launched") },
  { id: "upcoming", generalAvailabilityDate: "2099-01-01" },
  { id: "eol", ...stage("in-development"), endManufacturingDate: "2000-01-01" },
  { id: "unconfirmed", statusType: "new" },
].map(product => ({ ...product, name: product.id, laneId: "main" })));
const detailBytes = JSON.stringify(detailProducts);
const detailGroups = ["all", "launched", "in-development", "in-planning", "embargo", "unreleased", "eol"];
assert.deepEqual(model.CATALOG_VISIBILITY_GROUPS, detailGroups);
assert.ok(Object.isFrozen(model.CATALOG_VISIBILITY_GROUPS));
assert.deepEqual(detailProducts.map(product => model.catalogVisibilityGroup(product, today)), [...detailGroups.slice(1), "unknown"]);
assert.deepEqual(model.catalogVisibilityCounts(detailProducts, today), { all: 7, launched: 1, "in-development": 1, "in-planning": 1, embargo: 1, unreleased: 1, eol: 1, unknown: 1 });
assert.deepEqual(model.catalogVisibilityCounts(null, today), { all: 0, launched: 0, "in-development": 0, "in-planning": 0, embargo: 0, unreleased: 0, eol: 0, unknown: 0 });
for (const [product, expected] of [
  [{ statusType: "in-development", ...stage("in-planning") }, "in-development"],
  [{ statusType: "in-development", ...stage("embargo") }, "embargo"],
  [{ statusType: "embargo", ...stage("in-development") }, "embargo"],
  [{ statusType: "embargo", ...stage("end-of-life") }, "eol"],
  [{ statusType: "discontinued", ...stage("embargo") }, "eol"],
  [{ ...stage("in-development"), endManufacturingDate: "2000-01-01" }, "eol"],
  [gaQuarter(2026, 4), "unknown"],
  [gaQuarter(2099, 1), "unreleased"],
]) {
  assert.equal(model.catalogVisibilityGroup(freeze(product), today), expected, "exclusive detail group follows factual EOL, embargo and explicit development precedence without manufacturing precision");
  checks++;
}
assert.deepEqual(model.catalogVisibilitySelection({ catalogGroups: [] }), []);
assert.deepEqual(model.catalogVisibilitySelection({ catalogGroups: ["all"], catalogGroup: "eol", hideDiscontinued: true }), ["all"]);
assert.deepEqual(model.catalogVisibilitySelection({ catalogGroup: "unreleased" }), ["in-development", "in-planning", "embargo", "unreleased"], "older Unreleased choice retains the whole upcoming parent group");
assert.equal(model.catalogVisibilitySelection({ hideDiscontinued: true }), null, "legacy hide remains compatible while following current discontinuation evidence");
assert.equal(model.catalogProducts(detailProducts, { catalogGroups: ["all"] }, today), detailProducts, "All retains unknown lifecycle products and object identities");
assert.deepEqual(model.catalogProducts(detailProducts, { catalogGroups: [] }, today), [], "explicit empty imported selection displays no products");
for (let mask = 0; mask < 64; mask++) {
  const selection = detailGroups.slice(1).filter((_group, index) => mask & (1 << index));
  const expected = detailProducts.filter(product => selection.includes(model.catalogVisibilityGroup(product, today)));
  const actual = model.catalogProducts(detailProducts, { catalogGroups: selection, catalogGroup: "all", hideDiscontinued: true }, today);
  assert.deepEqual(actual, expected, `independent selection ${selection.join(" + ") || "none"} uses an exact union in source order`);
  assert.ok(actual.every(product => detailProducts.includes(product)), "filtering never clones or replaces product facts");
  checks++;
}
const unorderedSelection = ["in-development", "launched", "in-development"];
assert.deepEqual(model.normalizeCatalogGroups(unorderedSelection), ["launched", "in-development"]);
assert.deepEqual(unorderedSelection, ["in-development", "launched", "in-development"], "normalization never edits the caller's selection");
for (const invalid of [null, false, {}, "launched", ["all", "launched"], ["unknown"], ["constructor"], [null]]) {
  assert.equal(model.normalizeCatalogGroups(invalid), null);
  assert.deepEqual(model.catalogProducts(detailProducts, { catalogGroups: invalid, catalogGroup: "launched" }, today), [detailProducts[0]], "invalid new selection falls back to the saved valid legacy group");
  checks++;
}
assert.equal(JSON.stringify(detailProducts), detailBytes, "all multi-select combinations preserve every saved product byte");
checks += 14;
for (let mask = 0; mask < 64; mask++) {
  const excluded = detailGroups.slice(1).filter((_group, index) => mask & (1 << index));
  const settings = freeze({ catalogGroups: ["all"], catalogExcludedGroups: excluded, hideDiscontinued: true });
  const actual = model.catalogProducts(detailProducts, settings, today);
  assert.deepEqual(actual, detailProducts.filter(product => !excluded.includes(model.catalogVisibilityGroup(product, today))), "inverse selections subtract full lifecycle groups without losing unknown evidence");
  assert.ok(actual.includes(detailProducts.at(-1)), "every All-minus combination retains unconfirmed lifecycle products");
  assert.deepEqual(model.catalogVisibilityExclusions(settings), excluded);
  checks++;
}
assert.deepEqual(model.catalogProducts(products, { catalogGroups: ["all"], catalogExcludedGroups: ["eol"] }, today).map(product => product.id), ["launched", "unreleased", "unknown"], "All minus EOL excludes date-confirmed and stage-only EOL equally");
assert.deepEqual(model.catalogProducts(products, { catalogGroups: ["eol"], catalogExcludedGroups: ["eol"] }, today).map(product => product.id), ["dated-eol", "stage-eol"], "exclusions are inactive outside an All base");
assert.deepEqual(model.normalizeCatalogExcludedGroups(["eol", "launched", "eol"]), ["launched", "eol"]);
for (const invalid of [null, false, "eol", {}, ["all"], ["unknown"], [false], Array(33).fill("eol"), Array(1)]) {
  assert.equal(model.normalizeCatalogExcludedGroups(invalid), null);
  assert.equal(model.catalogProducts(detailProducts, { catalogGroups: ["all"], catalogExcludedGroups: invalid }, today), detailProducts, "invalid exclusion evidence cannot silently hide a product");
  checks++;
}
assert.deepEqual(model.catalogVisibilityExclusions({ hideDiscontinued: true, catalogExcludedGroups: ["eol"] }), [], "legacy date-only hide remains authoritative until an explicit All base is selected");
assert.equal(JSON.stringify(detailProducts), detailBytes); checks += 4;

// Exercise the actual pure reconciliation implementation without exposing a new
// production API or touching a browser database. Existing workspace-store tests
// separately cover its transaction-completion and stale-save integration.
const source = await readFile(new URL("../../public/js/workspace-store.js", import.meta.url), "utf8");
const start = source.indexOf("  const own = "), end = source.indexOf("  function create(");
assert.ok(start >= 0 && end > start);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end) + "\nthis.reconcile = reconcileViewSnapshots;", sandbox);
const fixture = () => ({
  version: 4, categories: ["one", "two"].map(id => ({ id, board: {
    settings: { showPrices: true, unknownSettings: { exact: true } }, lanes: [{ id: "lane", order: 0 }],
    products: [{ id: `${id}-product`, name: `${id} product`, laneId: "lane", order: 0, imageAssetId: "image", featuredVariantId: "black", specs: [{ id: "spec", value: "Exact technical condition" }], plc: { version: 1, fields: { ffsDate: { value: "2028-04-01" } }, history: [{ raw: "Retained" }] }, revisions: { plc: 5 } }],
  } })), imageAssets: [{ id: "image", packagePath: "images/exact.png" }],
  masterLocalMerges: [{ sourceProduct: { id: "old", original: "Exact archived data" } }],
  masterLocalTombstones: [{ productId: "old", revisions: { "@product": 9 } }],
  dateLocalEdits: { "one-product": { ffsDate: { value: "2028-04-01" } } },
  receipts: [{ exact: "Retained" }], unknownOperational: { retained: [false, null, 0, ""] },
});
const reconcile = (base, mine, latest) => {
  const bytes = [base, mine, latest].map(JSON.stringify);
  const result = sandbox.reconcile(...bytes);
  assert.deepEqual([base, mine, latest].map(JSON.stringify), bytes, "reconciliation never mutates any snapshot input");
  return result === null ? null : JSON.parse(result);
};
for (const group of model.CATALOG_GROUPS) {
  const base = fixture(), mine = clone(base), latest = clone(base);
  base.categories[0].board.settings.hideDiscontinued = mine.categories[0].board.settings.hideDiscontinued = latest.categories[0].board.settings.hideDiscontinued = true;
  mine.categories[0].board.settings.catalogGroup = group;
  latest.categories[0].board.products[0].name = "Concurrent accepted product";
  latest.receipts.push({ exact: "Concurrent receipt" });
  const expected = clone(latest); expected.categories[0].board.settings.catalogGroup = group;
  assert.deepEqual(reconcile(base, mine, latest), expected, `${group} reconciles with accepted facts`);

  const localFacts = clone(base), otherView = clone(base);
  localFacts.categories[0].board.products[0].plc.history.push({ raw: "Accepted local history" });
  otherView.categories[0].board.settings.catalogGroup = group;
  const inverse = clone(localFacts); inverse.categories[0].board.settings.catalogGroup = group;
  assert.deepEqual(reconcile(base, localFacts, otherView), inverse, `${group} reconciles in the opposite direction`);
  checks += 2;
}
{
  const base = fixture(), mine = clone(base), latest = clone(base);
  base.categories[0].board.settings.catalogGroup = mine.categories[0].board.settings.catalogGroup = latest.categories[0].board.settings.catalogGroup = "all";
  mine.categories[0].board.settings.catalogGroup = "eol";
  latest.categories[1].board.settings.catalogGroup = "unreleased";
  const expected = clone(latest); expected.categories[0].board.settings.catalogGroup = "eol";
  assert.deepEqual(reconcile(base, mine, latest), expected, "category-local choices merge independently");
  delete mine.categories[0].board.settings.catalogGroup;
  latest.categories[0].board.settings.catalogGroup = "launched";
  const absent = clone(latest); delete absent.categories[0].board.settings.catalogGroup;
  assert.deepEqual(reconcile(base, mine, latest), absent, "intentional preference removal is a valid view leaf");
  checks += 2;
}
for (const invalid of [null, false, true, 0, "", "ALL", "unknown", "constructor", "__proto__", [], {}, ["all"]]) {
  for (const position of [0, 1, 2]) {
    const snapshots = [fixture(), fixture(), fixture()];
    snapshots[position].categories[0].board.settings.catalogGroup = invalid;
    assert.equal(reconcile(...snapshots), null, "invalid enum in any snapshot cannot bypass full-fact guards");
    checks++;
  }
}
{
  const base = fixture(), mine = clone(base), latest = clone(base);
  latest.categories[0].board.products[0].name = "Concurrent fact";
  mine.categories[0].board.settings.unknownCatalogRule = "not a view leaf";
  assert.equal(reconcile(base, mine, latest), null, "unknown settings remain protected facts");
  delete mine.categories[0].board.settings.unknownCatalogRule;
  mine.categories[0].board.settings.catalogGroup = "eol";
  mine.categories[0].board.products[0].specs[0].value = "Different local fact";
  assert.equal(reconcile(base, mine, latest), null, "valid group does not bypass conflicting product facts");
  const removed = clone(base), secondCategoryChoice = clone(base);
  removed.categories.splice(1, 1); secondCategoryChoice.categories[1].board.settings.catalogGroup = "eol";
  assert.deepEqual(reconcile(base, secondCategoryChoice, removed), removed, "view changes never resurrect removed categories");
  checks += 3;
}
for (const selection of [["all"], [], ["launched", "in-development"], ["in-planning", "embargo"], ["eol"]]) {
  const base = fixture(), mine = clone(base), latest = clone(base);
  mine.categories[0].board.settings.catalogGroups = selection;
  latest.categories[0].board.products[0].name = "Concurrent accepted product";
  latest.receipts.push({ exact: "Retained concurrent receipt" });
  const expected = clone(latest); expected.categories[0].board.settings.catalogGroups = selection;
  assert.deepEqual(reconcile(base, mine, latest), expected, `selection ${selection} reconciles only its presentation leaf with accepted concurrent facts`);
  const localFacts = clone(base), otherView = clone(base);
  localFacts.categories[0].board.products[0].plc.history.push({ exact: "New local source evidence" });
  otherView.categories[0].board.settings.catalogGroups = selection;
  const inverse = clone(localFacts); inverse.categories[0].board.settings.catalogGroups = selection;
  assert.deepEqual(reconcile(base, localFacts, otherView), inverse, "concurrent multi-select choice cannot erase local product evidence");
  checks += 2;
}
for (const invalid of [null, false, true, "launched", {}, ["all", "launched"], ["unknown"], ["constructor"], [null], [false]]) {
  for (const position of [0, 1, 2]) {
    const snapshots = [fixture(), fixture(), fixture()];
    snapshots[position].categories[0].board.settings.catalogGroups = invalid;
    assert.equal(reconcile(...snapshots), null, "malformed multi-select leaf cannot bypass protected-fact conflict checks");
    checks++;
  }
}
{
  const base = fixture(), mine = clone(base), latest = clone(base);
  mine.categories[0].board.settings.catalogGroups = ["launched", "in-development"];
  mine.categories[0].board.products[0].name = "Local edited fact";
  latest.categories[0].board.products[0].name = "Concurrent edited fact";
  assert.equal(reconcile(base, mine, latest), null, "multi-select view leaves do not permit conflicting product facts to merge");
  checks++;
}
await import("../../public/js/portfolio-search.js");
await import("../../public/js/pptx-pagination.js");
await import("../../public/js/saved-views.js");
await import("../../public/js/ffs-roadmap.js");
await import("../../public/js/hashout-layout.js");
const appSource = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const appFunction = name => {
  const match = appSource.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, `execute actual application function ${name}`);
  return match[0];
};
const legacyGroup = (target, group) => { delete target.settings.catalogGroups; target.settings.catalogGroup = group; };
const appBoard = { lanes: [{ id: "main", label: "Main", order: 0 }], settings: { hideDiscontinued: true, roadmap: { startMonth: "2026-01", endMonth: "2030-12" } }, products };
const otherBoard = { ...appBoard, settings: { catalogGroup: "all", hideDiscontinued: false, roadmap: { startMonth: "2026-01", endMonth: "2030-12" } } };
const otherSettings = JSON.stringify(otherBoard.settings);
const calls = { drag: 0, hover: 0, save: 0, controls: 0, render: 0, viewerClose: 0 };
const inspector = { className: "inspector is-open", childElementCount: 1, innerHTML: "Existing editor", attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
  replaceChildren() { this.childElementCount = 0; this.innerHTML = ""; } };
const app = {
  PortfolioModel: model, PortfolioSearch: globalThis.PortfolioSearch, PPCSavedViews: globalThis.PPCSavedViews,
  board: appBoard, portfolio: { settings: {}, categories: [{ id: "one", board: appBoard }, { id: "two", board: otherBoard }] },
  activeView: "products", activeCategoryId: "one", selectedId: "dated-eol", viewerInfoProductId: "dated-eol", inspectorOpen: true,
  inspector, editSelectedButton: {}, searchQuery: "Exact technical condition", roadmapSearchQuery: "", roadmapDetailsOpen: false,
  productLayoutEditing: false, packageOperationInProgress: false, pptxExportInProgress: false, workspaceOpening: false, roadmapDraft: null,
  canvasScroll: { scrollLeft: 123, scrollTop: 45 }, productCardHover: { clear() { calls.hover++; } },
  stopProductCardDrag() { calls.drag++; }, scheduleSave() { calls.save++; }, syncControls() { calls.controls++; }, renderActiveView() { calls.render++; },
  closeViewerInfo(options) { assert.equal(options.render, false); calls.viewerClose++; app.viewerInfoProductId = null; },
};
vm.createContext(app);
vm.runInContext(["selectedProduct", "applyInspectorState", "renderInspector", "clearHiddenCatalogSelection", "catalogFilterCategories", "applyCatalogGroups", "setCatalogGroups", "setCatalogGroup", "setCatalogHideDiscontinued", "updateBoard", "visibleProducts", "visibleRoadmapProducts", "portfolioForSearch", "openPortfolioSearchResult"].map(appFunction).join("\n"), app);
assert.equal(app.setCatalogGroups(["launched"]), true);
assert.deepEqual(Array.from(appBoard.settings.catalogGroups), ["launched"]); assert.equal(appBoard.settings.hideDiscontinued, false);
assert.equal(app.selectedId, null, "hidden selection clears the toolbar");
assert.equal(app.viewerInfoProductId, null, "hidden expanded detail is closed");
assert.equal(app.inspectorOpen, false, "hidden selected product closes its real inspector state");
assert.equal(inspector.attributes["aria-hidden"], "true"); assert.equal(inspector.childElementCount, 0, "real inspector render removes the old editor");
assert.equal(app.searchQuery, "Exact technical condition", "group changes preserve the search query");
assert.deepEqual(app.canvasScroll, { scrollLeft: 0, scrollTop: 0 });
assert.deepEqual(calls, { drag: 1, hover: 1, save: 1, controls: 1, render: 1, viewerClose: 1 });
assert.equal(JSON.stringify(otherBoard.settings), otherSettings, "group selection changes only the current category");
assert.equal(JSON.stringify(products), productBytes);
checks++;

const actionBefore = JSON.stringify({ portfolio: app.portfolio, calls, scroll: app.canvasScroll, query: app.searchQuery });
assert.equal(app.setCatalogGroups(["launched"]), false, "same exact selection is a no-op");
for (const invalid of ["", "ALL", "unknown", null, false, {}, ["all"]]) assert.equal(app.setCatalogGroup(invalid), false, "invalid mode rejected by actual handler");
assert.equal(JSON.stringify({ portfolio: app.portfolio, calls, scroll: app.canvasScroll, query: app.searchQuery }), actionBefore);
for (const guard of ["productLayoutEditing", "packageOperationInProgress", "pptxExportInProgress", "roadmapDraft"]) {
  app[guard] = true;
  assert.equal(app.setCatalogGroup("eol"), false, `${guard} locks the actual handler`);
  assert.equal(app.setCatalogGroup("eol", { inverse: true }), false, `${guard} also locks inverse selection`);
  assert.equal(app.setCatalogGroups(["launched", "in-development"]), false, `${guard} also locks exact multi-select changes`);
  app[guard] = false;
  assert.equal(JSON.stringify({ portfolio: app.portfolio, calls, scroll: app.canvasScroll, query: app.searchQuery }), actionBefore);
  checks++;
}
appBoard.settings.hideDiscontinued = true;
assert.equal(app.setCatalogGroups(["launched"]), true, "same selection with stale legacy true is not a no-op");
assert.equal(appBoard.settings.hideDiscontinued, false);
app.selectedId = "launched"; app.viewerInfoProductId = "dated-eol";
legacyGroup(appBoard, "all");
assert.equal(app.setCatalogGroups(["launched"]), true);
assert.equal(app.selectedId, "launched", "still-visible selection remains");
assert.equal(app.viewerInfoProductId, null, "hidden viewer closes independently of a visible selection");
app.activeView = "roadmap"; app.selectedId = app.viewerInfoProductId = "dated-eol"; app.inspectorOpen = true;
app.clearHiddenCatalogSelection();
assert.equal(app.selectedId, null); assert.equal(app.viewerInfoProductId, null); assert.equal(app.inspectorOpen, false, "Roadmap closes a selection hidden by shared visibility");
app.activeView = "products"; app.selectedId = app.viewerInfoProductId = null;
checks += 3;

// Execute the real click toggle against a complete set of exclusive groups.
// Removing the final UI chip returns to All; imported [] remains representable.
appBoard.products = detailProducts; app.searchQuery = "";
assert.equal(app.setCatalogGroups(["all"]), true);
assert.equal(app.setCatalogGroup("launched"), true);
assert.deepEqual(Array.from(appBoard.settings.catalogGroups), ["launched"]);
assert.deepEqual(Array.from(app.visibleProducts(), product => product.id), ["released"], "first click from All selects only the requested group");
assert.equal(app.setCatalogGroup("in-development"), true);
assert.deepEqual(Array.from(appBoard.settings.catalogGroups), ["launched", "in-development"]);
assert.deepEqual(Array.from(app.visibleProducts(), product => product.id), ["released", "development"], "Released plus In development is a union, not an intersection");
app.selectedId = app.viewerInfoProductId = "development";
assert.equal(app.setCatalogGroup("launched"), true);
assert.deepEqual(Array.from(app.visibleRoadmapProducts(), product => product.id), ["development"], "deselecting one chip preserves the other group in Roadmap too");
assert.equal(app.selectedId, "development"); assert.equal(app.viewerInfoProductId, "development", "still-included independent group keeps its selected product and details");
assert.equal(app.setCatalogGroup("in-development"), true);
assert.deepEqual(Array.from(appBoard.settings.catalogGroups), ["all"], "last chip removal restores All instead of unexpectedly emptying the workspace");
assert.equal(app.setCatalogGroups([]), true);
assert.equal(app.visibleProducts().length, 0, "exact empty imported preference remains a valid recovery state");
assert.equal(app.selectedId, null); assert.equal(app.viewerInfoProductId, null, "excluding every selected group clears its hidden editor and details");
assert.equal(app.setCatalogGroup("all"), true);
assert.equal(app.visibleProducts().length, detailProducts.length, "All recovers every product including unknown lifecycle evidence");
for (const invalid of [["all", "launched"], ["unknown"], [false], null, false, {}, "launched"]) {
  const before = JSON.stringify({ portfolio: app.portfolio, calls });
  assert.equal(app.setCatalogGroups(invalid), false);
  assert.equal(JSON.stringify({ portfolio: app.portfolio, calls }), before, "invalid selection cannot save, render or change preferences");
  checks++;
}
appBoard.products = products;
checks += 9;

const visibilityClick = appSource.match(/^\$\("#catalogVisibility"\)\.onclick = (event => \{[^]*?^\});/m)?.[1];
assert.ok(visibilityClick, "execute actual Ctrl/Command pointer routing");
vm.runInContext(`var handleVisibilityClick = ${visibilityClick};`, app);
const clickGroup = (group, modifiers = {}, disabled = false) => app.handleVisibilityClick({ ...modifiers, target: { closest() { return { dataset: { catalogGroup: group }, disabled }; } } });
for (const view of ["products", "roadmap"]) {
  app.activeView = view; app.searchQuery = app.roadmapSearchQuery = "";
  app.setCatalogGroups(["all"]); app.selectedId = app.viewerInfoProductId = "dated-eol";
  const saves = calls.save;
  clickGroup("eol", { ctrlKey: true });
  assert.deepEqual(Array.from(appBoard.settings.catalogGroups), ["all"]); assert.deepEqual(Array.from(appBoard.settings.catalogExcludedGroups), ["eol"]);
  assert.deepEqual(Array.from(view === "products" ? app.visibleProducts() : app.visibleRoadmapProducts(), product => product.id), ["launched", "unreleased", "unknown"], "actual Ctrl-click applies literal All minus full EOL in both views");
  assert.equal(app.selectedId, null); assert.equal(app.viewerInfoProductId, null); assert.equal(calls.save, saves + 1);
  clickGroup("eol", { metaKey: true });
  assert.equal(appBoard.settings.catalogExcludedGroups, undefined); assert.equal(app.visibleProducts().length, products.length, "Command-click restores an already excluded group");
  checks += 4;
}
app.activeView = "products"; appBoard.products = detailProducts;
app.setCatalogGroups(["launched", "in-development"]);
clickGroup("eol", { metaKey: true });
assert.equal(app.visibleProducts().length, 6, "modifier from a positive partial union starts All minus the clicked group");
clickGroup("in-planning", { ctrlKey: true });
assert.deepEqual(Array.from(appBoard.settings.catalogExcludedGroups), ["in-planning", "eol"], "inverse clicks accumulate independent exclusions");
assert.deepEqual(Array.from(app.visibleProducts(), product => product.id), ["released", "development", "embargo", "upcoming", "unconfirmed"]);
clickGroup("in-planning", { ctrlKey: true });
assert.deepEqual(Array.from(appBoard.settings.catalogExcludedGroups), ["eol"]);
clickGroup("in-development");
assert.deepEqual(Array.from(appBoard.settings.catalogGroups), ["in-development"]); assert.equal(appBoard.settings.catalogExcludedGroups, undefined, "ordinary click exits inverse mode using the original All-to-single behavior");
clickGroup("eol", { ctrlKey: true }); clickGroup("all", { ctrlKey: true });
assert.deepEqual(Array.from(appBoard.settings.catalogGroups), ["all"]); assert.equal(appBoard.settings.catalogExcludedGroups, undefined, "All clears exclusions with or without a modifier");
const disabledBefore = JSON.stringify({ portfolio: app.portfolio, calls }); clickGroup("eol", { ctrlKey: true }, true);
assert.equal(JSON.stringify({ portfolio: app.portfolio, calls }), disabledBefore, "disabled inverse buttons never mutate or save");
app.setCatalogGroup("eol", { inverse: true }); app.setCatalogHideDiscontinued(true);
assert.equal(appBoard.settings.catalogExcludedGroups, undefined, "legacy shortcut explicitly exits inverse mode");
appBoard.products = products; checks += 8;

const idsOf = rows => Array.from(rows, row => row.id);
legacyGroup(appBoard, "unreleased"); app.searchQuery = "";
assert.deepEqual(idsOf(app.visibleProducts()), ["unreleased"]);
app.searchQuery = "Technical";
assert.equal(app.visibleProducts().length, 0, "search cannot reintroduce a product excluded by lifecycle");
legacyGroup(appBoard, "launched");
assert.deepEqual(idsOf(app.visibleProducts()), ["launched"], "visible lifecycle and source-spec query compose");
legacyGroup(otherBoard, "unreleased");
assert.deepEqual(idsOf(app.portfolioForSearch().categories[0].board.products), ["launched"]);
assert.deepEqual(idsOf(app.portfolioForSearch().categories[1].board.products), ["unreleased"], "all-category lookup respects each category's group");
assert.equal(app.openPortfolioSearchResult({ categoryId: "one", productId: "dated-eol" }), false, "stale search result cannot reopen a filtered product");
app.activeView = "roadmap";
assert.notEqual(app.portfolioForSearch(), app.portfolio, "Roadmap also uses an immutable filtered projection");
assert.deepEqual(idsOf(app.portfolioForSearch().categories[0].board.products), ["launched"]);
app.roadmapSearchQuery = ""; assert.deepEqual(idsOf(app.visibleRoadmapProducts()), ["launched"]);
app.roadmapSearchQuery = "unreleased"; assert.equal(app.visibleRoadmapProducts().length, 0, "Roadmap text search cannot reintroduce hidden lifecycle groups");
app.roadmapSearchQuery = "";
app.activeView = "products"; app.searchQuery = "";
checks += 7;

Object.assign(app, {
  PPTXPagination: globalThis.PPTXPagination,
  PPTXEditable: { FONT_FACE: "Existing font", fontsReady: async () => true }, UI_FONT_FACE: "Existing font",
  PortfolioTheme: { fontsReady: async () => true }, isFfsRoadmap: () => false,
  categoryDefinition: id => ({ id }), ensureBoardSchema: target => target,
  productCardLayout: () => ({ cardHeight: 552, laneHeight: 622 }),
  CARD_WIDTH: 246, CARD_GAP: 10, GUTTER: 18, SIDE_PADDING: 40, LANE_TOP: 34,
  inferFamily: () => "Synthetic family",
  roadmapGroupsForProducts: rows => [{ family: "Synthetic family", products: rows }],
  paginateRoadmapGroupsForPptx: globalThis.PPTXPagination.paginateRoadmapGroups,
  closePopupMenus() {},
});
vm.runInContext(["productPagesForPptx", "buildPptxExportPlan", "exportPptx"].map(appFunction).join("\n"), app);
const category = app.portfolio.categories[0];
for (const [group, expected] of [["all", products.map(p => p.id)], ["launched", ["launched"]], ["unreleased", ["unreleased"]], ["eol", ["dated-eol", "stage-eol"]]]) {
  legacyGroup(appBoard, group);
  const plan = app.buildPptxExportPlan("products", [category]);
  assert.deepEqual(Array.from(plan).flatMap(page => Array.from(page.page.rows).flatMap(row => idsOf(row.products))), expected, "actual Products export planner uses lifecycle group");
  checks++;
}
const allHidden = { id: "hidden", board: { ...appBoard, products: [products[0]], settings: { catalogGroup: "eol" } } };
const unionCategory = { id: "union", board: { ...appBoard, products: detailProducts, settings: { ...appBoard.settings, catalogGroups: ["launched", "in-development"] } } };
for (const scope of ["products", "roadmap", "both"]) {
  const pages = Array.from(app.buildPptxExportPlan(scope, [unionCategory]));
  const cardIds = pages.filter(page => page.kind === "products").flatMap(page => Array.from(page.page.rows).flatMap(row => idsOf(row.products)));
  const roadmapIds = pages.filter(page => page.kind === "roadmap").flatMap(page => Array.from(page.groups).flatMap(group => idsOf(group.products)));
  assert.deepEqual(cardIds, scope === "roadmap" ? [] : ["released", "development"], "Products export contains the exact Released plus In development union");
  assert.deepEqual(roadmapIds, scope === "products" ? [] : ["released", "development"], "Roadmap export contains the same union without hidden stages");
  checks++;
}
const inverseCategory = { ...unionCategory, board: { ...unionCategory.board, settings: { catalogGroups: ["all"], catalogExcludedGroups: ["eol"] } } };
const inverseIds = ["released", "development", "planning", "embargo", "upcoming", "unconfirmed"];
for (const scope of ["products", "roadmap", "both"]) {
  const pages = Array.from(app.buildPptxExportPlan(scope, [inverseCategory]));
  const cardIds = pages.filter(page => page.kind === "products").flatMap(page => Array.from(page.page.rows).flatMap(row => idsOf(row.products)));
  const roadmapIds = pages.filter(page => page.kind === "roadmap").flatMap(page => Array.from(page.groups).flatMap(group => idsOf(group.products)));
  assert.deepEqual(cardIds, scope === "roadmap" ? [] : inverseIds);
  assert.deepEqual(roadmapIds, scope === "products" ? [] : inverseIds, "literal All-minus filtering and unknown evidence survive both PPTX paths");
  checks++;
}
const noSelectionCategory = { ...unionCategory, board: { ...unionCategory.board, settings: { catalogGroups: [] } } };
assert.equal(app.buildPptxExportPlan("both", [noSelectionCategory]).length, 0, "explicit empty imported selection creates no Product or Roadmap phantom pages");
checks++;
const trulyEmpty = { id: "empty", board: { ...appBoard, products: [], settings: {} } };
assert.equal(app.buildPptxExportPlan("products", [trulyEmpty]).length, 1, "a genuinely empty category retains its existing placeholder slide");
checks++;
assert.equal(app.buildPptxExportPlan("products", [allHidden]).length, 0, "all-hidden lifecycle category creates no phantom slide");
assert.equal(app.buildPptxExportPlan("both", [allHidden]).length, 0, "shared visibility omits all-hidden product and legacy Roadmap pages");
assert.equal(app.buildPptxExportPlan("roadmap", [allHidden]).length, 0, "Roadmap-only export also follows shared visibility");
let emptyDecks = 0;
app.PptxGenJS = class { constructor() { emptyDecks++; } };
const exportPortfolio = app.portfolio; app.portfolio = { categories: [allHidden] };
await assert.rejects(app.exportPptx("products", [allHidden.id]), /No visible products to export/);
assert.equal(emptyDecks, 0, "actual export aborts before creating an empty deck");
app.portfolio = exportPortfolio;
checks += 3;

const painted = [];
Object.assign(app, {
  UI_PALETTE: { charcoal800: "#1A1B1C" },
  sortedLanes: () => app.board.lanes, roundRect() {}, drawProductBoardExportBackground() {},
  drawCard: (_context, product) => painted.push(product.id), cardXForDisplayIndex: (_rows, index) => index * 256,
  renderedCards: [], renderedVariantOverflow: [], renderedHeroVariantRegions: [], renderedInfoButtons: [],
});
vm.runInContext(appFunction("drawBoardTo"), app);
const dimensions = { width: 1000, height: 650, includeViewer: false, layout: { cardHeight: 552, laneHeight: 622 }, laneRows: [{ lane: appBoard.lanes[0], top: 34, contentHeight: 552 }] };
for (const [group, expected] of [["launched", ["launched"]], ["unreleased", ["unreleased"]], ["eol", ["dated-eol", "stage-eol"]]]) {
  legacyGroup(appBoard, group); painted.length = 0;
  app.drawBoardTo({ clearRect() {} }, dimensions, false, true);
  assert.deepEqual(painted, expected, "actual PNG board rendering uses the lifecycle group");
  checks++;
}
app.board = allHidden.board; painted.length = 0;
app.drawBoardTo({ clearRect() {} }, dimensions, false, true);
assert.equal(painted.length, 0, "all-hidden PNG paints no product cards");
app.board = appBoard;
app.board = unionCategory.board; painted.length = 0;
app.drawBoardTo({ clearRect() {} }, dimensions, false, true);
assert.deepEqual(painted, ["released", "development"], "actual PNG uses the same Released plus In development union");
app.board = noSelectionCategory.board; painted.length = 0;
app.drawBoardTo({ clearRect() {} }, dimensions, false, true);
assert.deepEqual(painted, [], "explicit empty imported selection paints no product cards");
app.board = inverseCategory.board; painted.length = 0;
app.drawBoardTo({ clearRect() {} }, dimensions, false, true);
assert.deepEqual(painted, inverseIds, "PNG retains unknown products while excluding a full lifecycle group");
app.board = appBoard;
assert.match(appFunction("exportPng"), /if \(isProducts\) drawBoardTo\(/);
checks += 3;

const savedViews = globalThis.PPCSavedViews;
for (const group of model.CATALOG_GROUPS) {
  assert.equal(savedViews.sanitizePreferences("portfolio", { display: { catalogGroup: group, privateKey: "never" } }).display.catalogGroup, group);
  assert.equal(savedViews.sanitizePreferences("portfolio", { display: { catalogGroup: group, privateKey: "never" } }).display.privateKey, undefined);
  checks++;
}
for (const invalid of [null, false, "ALL", "unknown", {}, ["all"]]) assert.equal(savedViews.sanitizePreferences("portfolio", { display: { catalogGroup: invalid } }).display.catalogGroup, undefined);
const capture = appSource.match(/^  captureView\(\) \{[^]*?^  \},/m)?.[0];
const apply = appSource.match(/^  applyView\(value\) \{[^]*?^  \},/m)?.[0];
assert.ok(capture && apply);
Object.assign(app, {
  zoom: 1, roadmapMonthWidth: 20, ROADMAP_DEFAULT_MONTH_WIDTH: 20,
  hashoutCategoryScope: () => null, hasDedicatedHashoutView: () => false,
  activateCategory(id) { app.activeCategoryId = id; app.board = app.portfolio.categories.find(category => category.id === id).board; app.selectedId = app.viewerInfoProductId = null; app.inspectorOpen = false; },
  resetHashoutView() {}, setView(view) { app.activeView = view; }, setProductZoom() {}, setRoadmapZoom() {},
  document: { querySelector: () => null }, $: () => null,
});
vm.runInContext(`var adapter = { ${capture} ${apply} };`, app);
legacyGroup(appBoard, "unreleased"); appBoard.settings.hideDiscontinued = false; app.searchQuery = "Saved query";
const captured = clone(app.adapter.captureView());
assert.equal(captured.display.catalogGroup, "unreleased"); assert.equal(captured.search, "Saved query");
const unchangedOther = JSON.stringify(otherBoard.settings);
for (const group of model.CATALOG_GROUPS) {
  app.adapter.applyView({ view: "products", activeCategoryId: "one", search: "Restored query", display: { catalogGroup: group, hideDiscontinued: true } });
  assert.equal(appBoard.settings.catalogGroup, group); assert.equal(appBoard.settings.hideDiscontinued, false, "new saved group is authoritative over stale legacy true");
  assert.equal(app.searchQuery, "Restored query"); assert.equal(JSON.stringify(otherBoard.settings), unchangedOther, "saved view group is category-scoped");
  checks++;
}
app.adapter.applyView({ view: "products", activeCategoryId: "one", display: {} });
assert.equal(appBoard.settings.catalogGroup, "eol", "older view without visibility fields preserves current choice");
app.adapter.applyView({ view: "products", activeCategoryId: "one", display: { catalogGroup: "bad" } });
assert.equal(appBoard.settings.catalogGroup, "eol", "invalid saved group cannot replace current preference");
app.adapter.applyView({ view: "products", activeCategoryId: "one", display: { hideDiscontinued: true } });
assert.equal(appBoard.settings.catalogGroup, undefined); assert.equal(appBoard.settings.hideDiscontinued, true, "legacy saved checkbox restores its old semantics");
app.adapter.applyView({ view: "products", activeCategoryId: "two", display: { catalogGroup: "launched" } });
assert.equal(otherBoard.settings.catalogGroup, "launched"); assert.equal(appBoard.settings.catalogGroup, undefined);
for (const guard of ["workspaceOpening", "packageOperationInProgress", "pptxExportInProgress", "productLayoutEditing", "roadmapDraft"]) {
  app[guard] = true; const before = JSON.stringify(app.portfolio);
  assert.throws(() => app.adapter.applyView({ display: { catalogGroup: "eol" } }), /Finish the current edit or export/);
  assert.equal(JSON.stringify(app.portfolio), before);
  app[guard] = false;
  checks++;
}
const beforeNewSavedViews = app.portfolio.categories.map(category => clone(category.board.settings));
for (const selection of [["launched", "in-development"], ["in-planning", "embargo"], [], ["all"]]) {
  const submitted = freeze({ view: "products", activeCategoryId: "one", search: "Keep saved search", display: { catalogGroups: selection, catalogGroup: "eol", hideDiscontinued: true } });
  app.adapter.applyView(submitted);
  assert.deepEqual(Array.from(appBoard.settings.catalogGroups), selection, "actual saved-view adapter restores an exact independent selection, including none");
  assert.equal(appBoard.settings.catalogGroup, undefined); assert.equal(appBoard.settings.hideDiscontinued, false, "new array wins over contradictory old saved fields");
  const capturedSelection = savedViews.sanitizePreferences("portfolio", app.adapter.captureView());
  assert.deepEqual(capturedSelection.display.catalogGroups, selection);
  assert.deepEqual(capturedSelection.categoryVisibility, [{ categoryId: "one", catalogGroups: selection }], "real capture and sanitizer retain the per-category multi-selection");
  assert.equal(app.searchQuery, "Keep saved search");
  assert.deepEqual(otherBoard.settings, beforeNewSavedViews[1], "exact saved-view selection never changes another category");
  checks++;
}
app.portfolio.categories.forEach((category, index) => { category.board.settings = beforeNewSavedViews[index]; });
assert.equal(JSON.stringify(products), productBytes, "all real application filter, saved-view, search and export paths preserve product facts, arrays, images, defaults and clocks");
checks += 5;

// Exercise the same setter over actual FFS scope resolution, including mixed
// categories and the distinction between an explicit empty scope and all.
const scopePortfolio = { settings: { roadmapBasis: "ffs", hashoutCategoryIds: ["one", "two"] }, categories: ["one", "two", "excluded"].map(id => ({ id, name: id, board: {
  lanes: [{ id: "main", order: 0 }], settings: { catalogGroup: id === "one" ? "all" : id === "two" ? "eol" : "unreleased", hideDiscontinued: false, roadmap: { startMonth: "2026-01", endMonth: "2030-12" } }, products,
} })).concat({ id: "without-board" }) };
const scopeCalls = { save: 0, drag: 0, overlay: 0, pan: 0, lane: 0 };
const attributeNode = () => { const attributes = new Map(); return { textContent: "", classList: { toggle() {} }, setAttribute(key, value) { attributes.set(key, String(value)); }, getAttribute(key) { return attributes.get(key) ?? null; } }; };
const scopeButtons = model.CATALOG_VISIBILITY_GROUPS.map(group => { const button = attributeNode(), counter = attributeNode(), tooltip = attributeNode(); return { ...button, dataset: { catalogGroup: group }, disabled: false, focus() { scoped.document.activeElement = this; }, querySelector: selector => selector === ".catalog-group-count" ? counter : tooltip }; });
const scopeHost = {}, scopeControls = { ...attributeNode(), parentElement: scopeHost, querySelectorAll: () => scopeButtons };
const recoveryButtons = ["catalogClearSearch", "catalogShowAll"].map(id => ({ ...attributeNode(), id, disabled: true }));
const scopeEmpty = { ...attributeNode(), querySelectorAll(selector) { assert.equal(selector, "button"); return recoveryButtons; } };
const scopeNodes = new Map([["catalogVisibility", scopeControls], ["roadmapContextTools", scopeHost], ["productControls", scopeHost], ["hideDiscontinued", {}], ["catalogFilterEmpty", scopeEmpty], ["catalogFilterEmptyText", attributeNode()], ...recoveryButtons.map(button => [button.id, button])]);
let hashoutOptions;
const scoped = {
  Date,
  portfolio: scopePortfolio, board: scopePortfolio.categories[0].board, activeCategoryId: "one", activeView: "roadmap",
  selectedId: null, viewerInfoProductId: null, inspectorOpen: false, searchQuery: "Keep product search", roadmapSearchQuery: "Keep roadmap search",
  productLayoutEditing: false, packageOperationInProgress: false, pptxExportInProgress: false, roadmapDraft: null,
  hashoutSelectedKey: null, hashoutViewController: null, hashoutView: {}, roadmapFilterScrollResetPending: false,
  PortfolioModel: model, PortfolioSearch: globalThis.PortfolioSearch, PortfolioHashoutLayout: globalThis.PortfolioHashoutLayout,
  PortfolioHashoutView: { create(_host, options) { hashoutOptions = options; return { closeOverlay() { scopeCalls.overlay++; } }; } },
  document: { getElementById: id => scopeNodes.get(id), querySelector: () => null, activeElement: null },
  canvasScroll: { scrollLeft: 100, scrollTop: 50 }, roadmapLaneHovers: [{ clear(options) { assert.equal(options.immediate, true); scopeCalls.lane++; } }],
  roadmapPanState: { cancel() { scopeCalls.pan++; } }, hasDedicatedHashoutView: () => true,
  stopProductCardDrag() { scopeCalls.drag++; }, scheduleSave() { scopeCalls.save++; }, syncControls() {}, renderActiveView() {}, renderInspector() {}, renderStatus() {},
  closeViewerInfo() { scoped.viewerInfoProductId = null; },
};
vm.createContext(scoped);
vm.runInContext(["isFfsRoadmap", "hashoutCategoryScope", "hashoutSelectionEntry", "catalogFilterCategories", "applyCatalogGroups", "setCatalogGroups", "setCatalogGroup", "setCatalogHideDiscontinued", "clearHiddenCatalogSelection", "portfolioForSearch", "visibleProducts", "visibleRoadmapProducts", "updateBoard", "syncCatalogFilterControls", "ensureHashoutView"].map(appFunction).join("\n"), scoped);
assert.deepEqual(Array.from(scoped.catalogFilterCategories(), category => category.id), ["one", "two"]);
scoped.syncCatalogFilterControls();
assert.ok(recoveryButtons.every(button => !button.disabled), "both empty-state recovery actions are enabled outside edits and exports");
assert.match(scopeControls.getAttribute("aria-label"), /Mixed category selections.*2 selected categories/);
assert.equal(scopeButtons[0].getAttribute("aria-pressed"), "mixed"); assert.equal(scopeButtons[6].getAttribute("aria-pressed"), "mixed");
assert.equal(scopeButtons[0].querySelector(".catalog-group-count").textContent, "10", "mixed FFS counts aggregate the exact selected categories");
const excludedBefore = JSON.stringify(scopePortfolio.categories[2]);
const factsBefore = JSON.stringify(scopePortfolio.categories.filter(category => category.board).map(category => category.board.products));
assert.equal(scoped.setCatalogGroups(["launched"]), true);
assert.deepEqual(Array.from(scopePortfolio.categories[0].board.settings.catalogGroups), ["launched"]); assert.deepEqual(Array.from(scopePortfolio.categories[1].board.settings.catalogGroups), ["launched"]);
assert.equal(JSON.stringify(scopePortfolio.categories[2]), excludedBefore, "bulk FFS choice preserves excluded category preferences and facts");
assert.equal(scopeCalls.save, 1, "one bulk preference action schedules one save");
assert.equal(scoped.roadmapFilterScrollResetPending, true); assert.equal(scopeCalls.pan, 1); assert.equal(scopeCalls.lane, 1);
assert.equal(scoped.searchQuery, "Keep product search"); assert.equal(scoped.roadmapSearchQuery, "Keep roadmap search");
const afterBulk = JSON.stringify({ portfolio: scopePortfolio, calls: scopeCalls });
assert.equal(scoped.setCatalogGroups(["launched"]), false, "an already uniform exact selection is a no-op");
assert.equal(JSON.stringify({ portfolio: scopePortfolio, calls: scopeCalls }), afterBulk);
scopePortfolio.settings.hashoutCategoryIds = [];
const beforeEmpty = JSON.stringify({ portfolio: scopePortfolio, calls: scopeCalls });
assert.equal(scoped.setCatalogGroup("eol"), false, "empty FFS scope must not fall back to active or all categories");
assert.equal(JSON.stringify({ portfolio: scopePortfolio, calls: scopeCalls }), beforeEmpty);
scoped.syncCatalogFilterControls(); assert.ok(scopeButtons.every(button => button.disabled), "empty scope disables every group control");
assert.ok(scopeButtons.every(button => button.getAttribute("aria-pressed") === "false"), "empty scope has no pressed visibility choice");
assert.ok(scopeButtons.every(button => button.querySelector(".catalog-group-tooltip").textContent.includes("Choose categories to enable visibility filters")), "empty scope explains how to enable the filter");
scopePortfolio.settings.hashoutCategoryIds = ["removed"];
assert.equal(scoped.setCatalogGroup("eol"), false, "removed scope identities do not expand scope");
scopePortfolio.settings.hashoutCategoryIds = null;
assert.deepEqual(Array.from(scoped.catalogFilterCategories(), category => category.id), ["one", "two", "excluded"]);
assert.equal(scoped.setCatalogGroup("all"), true, "null scope means all existing board categories");
assert.ok(scopePortfolio.categories.filter(category => category.board).every(category => JSON.stringify(category.board.settings.catalogGroups) === '["all"]'));
scopePortfolio.settings.hashoutCategoryIds = ["one", "two"];
scoped.activeView = "products";
assert.equal(scoped.setCatalogGroups(["unreleased"]), true); assert.deepEqual(Array.from(scopePortfolio.categories[1].board.settings.catalogGroups), ["all"], "Products applies to its active category even with an FFS multiselection");
scoped.activeView = "roadmap"; scopePortfolio.settings.roadmapBasis = "lifecycle";
assert.equal(scoped.setCatalogGroups(["eol"]), true); assert.deepEqual(Array.from(scopePortfolio.categories[1].board.settings.catalogGroups), ["all"], "lifecycle Roadmap remains active-category scoped");
scopePortfolio.settings.roadmapBasis = "ffs";
for (const guard of ["roadmapDraft", "productLayoutEditing", "packageOperationInProgress", "pptxExportInProgress"]) {
  scoped[guard] = guard === "roadmapDraft" ? { activeEdit: true } : true;
  const before = JSON.stringify({ portfolio: scopePortfolio, calls: scopeCalls });
  assert.equal(scoped.setCatalogGroup("unreleased"), false); assert.equal(scoped.setCatalogHideDiscontinued(true), false);
  assert.equal(scoped.setCatalogGroup("eol", { inverse: true }), false);
  assert.equal(scoped.setCatalogGroups(["launched", "in-development"]), false);
  assert.equal(JSON.stringify({ portfolio: scopePortfolio, calls: scopeCalls }), before, "locked Roadmap preserves every scoped preference");
  scoped.syncCatalogFilterControls();
  assert.ok(scopeButtons.every(button => button.disabled), `${guard} disables every visibility choice`);
  assert.ok(recoveryButtons.every(button => button.disabled), `${guard} disables both empty-state recovery actions`);
  scoped[guard] = guard === "roadmapDraft" ? null : false;
  scoped.syncCatalogFilterControls();
  assert.ok(scopeButtons.every(button => !button.disabled), `ending ${guard} restores the visibility choices`);
  assert.ok(recoveryButtons.every(button => !button.disabled), `ending ${guard} restores both empty-state recovery actions`);
}
const scopedSettingsBefore = scopePortfolio.categories.filter(category => category.board).map(category => clone(category.board.settings));
const scopedBoards = scopePortfolio.categories.filter(category => category.board).map(category => category.board);
scopedBoards[0].products = scopedBoards[1].products = detailProducts;
scopedBoards[0].settings.catalogGroups = ["launched", "in-development"];
scopedBoards[1].settings.catalogGroups = ["launched", "eol"];
scoped.syncCatalogFilterControls();
assert.equal(scopeButtons[1].getAttribute("aria-pressed"), "true", "a chip selected in every FFS category is checked");
assert.equal(scopeButtons[2].getAttribute("aria-pressed"), "mixed", "a chip selected in only part of the scope is indeterminate");
assert.equal(scopeButtons[0].getAttribute("aria-pressed"), "false", "a mixed union does not pretend All is selected");
for (const button of scopeButtons) assert.equal(button.querySelector(".catalog-group-count").textContent, button.dataset.catalogGroup === "all" ? "14" : "2", `${button.dataset.catalogGroup}: seven chip counts use exclusive source groups across the exact scope`);
assert.equal(scoped.setCatalogGroup("in-development"), true, "clicking an indeterminate chip adds it across the selected scope");
assert.deepEqual(Array.from(scopedBoards[0].settings.catalogGroups), ["launched", "in-development"]);
assert.deepEqual(Array.from(scopedBoards[1].settings.catalogGroups), ["launched", "in-development", "eol"], "adding across scope preserves each category's other groups");
scoped.syncCatalogFilterControls(); assert.equal(scopeButtons[2].getAttribute("aria-pressed"), "true");
assert.equal(scoped.setCatalogGroup("in-development"), true, "clicking a fully checked chip removes it across the selected scope");
assert.deepEqual(Array.from(scopedBoards[0].settings.catalogGroups), ["launched"]);
assert.deepEqual(Array.from(scopedBoards[1].settings.catalogGroups), ["launched", "eol"], "removing across scope preserves other independent chips");
scopedBoards[0].settings.catalogGroups = ["in-development"];
scopedBoards[1].settings.catalogGroups = ["in-development", "eol"];
assert.equal(scoped.setCatalogGroup("in-development"), true);
assert.deepEqual(Array.from(scopedBoards[0].settings.catalogGroups), ["all"], "last-removal recovery applies per category, without emptying it");
assert.deepEqual(Array.from(scopedBoards[1].settings.catalogGroups), ["eol"], "a category with another selected chip retains it rather than resetting All");
assert.equal(scoped.setCatalogGroup("all"), true);
assert.ok(scopedBoards.slice(0, 2).every(target => JSON.stringify(target.settings.catalogGroups) === '["all"]'), "All explicitly resets all selected categories");
const excludedScopeBefore = JSON.stringify(scopedBoards[2].settings);
assert.equal(scoped.setCatalogGroup("eol", { inverse: true }), true);
scoped.syncCatalogFilterControls();
assert.match(scopeControls.getAttribute("aria-label"), /All except EOL/);
assert.equal(scopeButtons[0].getAttribute("aria-pressed"), "mixed"); assert.equal(scopeButtons[0].getAttribute("data-inverse"), "true");
assert.equal(scopeButtons[6].getAttribute("data-excluded"), "true"); assert.equal(scopeButtons[6].getAttribute("aria-pressed"), "false");
assert.match(scopeButtons[6].getAttribute("aria-label"), /Excluded from All.*Command-click to restore/);
assert.equal(scopeButtons[2].getAttribute("aria-pressed"), "true", "included nonexcluded groups remain checked in inverse mode");
for (const target of scopedBoards.slice(0, 2)) assert.ok(model.catalogProducts(target.products, target.settings).includes(detailProducts.at(-1)), "FFS inverse projection retains unknown lifecycle rows");
scopedBoards[1].settings.catalogExcludedGroups = ["in-planning"];
scoped.syncCatalogFilterControls();
assert.equal(scopeButtons[6].getAttribute("data-excluded"), "mixed"); assert.equal(scopeButtons[3].getAttribute("data-excluded"), "mixed");
assert.match(scopeControls.getAttribute("aria-label"), /Mixed category selections/);
assert.equal(scoped.setCatalogGroup("eol", { inverse: true }), true);
assert.deepEqual(Array.from(scopedBoards[0].settings.catalogExcludedGroups), ["eol"]);
assert.deepEqual(Array.from(scopedBoards[1].settings.catalogExcludedGroups), ["in-planning", "eol"], "modifier on a mixed exclusion applies it throughout scope while preserving other exclusions");
assert.equal(scoped.setCatalogGroup("eol", { inverse: true }), true);
assert.equal(scopedBoards[0].settings.catalogExcludedGroups, undefined);
assert.deepEqual(Array.from(scopedBoards[1].settings.catalogExcludedGroups), ["in-planning"], "repeat modifier restores the group but retains independent exclusions");
scoped.syncCatalogFilterControls(); assert.equal(scopeButtons[0].getAttribute("data-inverse"), "mixed");
assert.equal(scoped.setCatalogGroup("launched"), true);
assert.ok(scopedBoards.slice(0, 2).every(target => !target.settings.catalogExcludedGroups && JSON.stringify(target.settings.catalogGroups) === '["launched"]'), "ordinary selection exits scoped inverse mode predictably");
assert.equal(JSON.stringify(scopedBoards[2].settings), excludedScopeBefore, "inverse actions never change an excluded category's preferences");
assert.equal(scoped.setCatalogGroup("all"), true);
checks += 12;
const visibilityKeydown = appSource.match(/^\$\("#catalogVisibility"\)\.onkeydown = (event => \{[^]*?^\});/m)?.[1];
assert.ok(visibilityKeydown, "execute the actual visibility keyboard navigation");
vm.runInContext(`var handleVisibilityKeydown = ${visibilityKeydown};`, scoped);
const navigationBefore = JSON.stringify({ portfolio: scopePortfolio, calls: scopeCalls });
for (const [key, from, to] of [["ArrowRight", 1, 2], ["ArrowLeft", 0, 6], ["Home", 4, 0], ["End", 2, 6]]) {
  let prevented = false;
  scoped.handleVisibilityKeydown({ key, target: scopeButtons[from], currentTarget: scopeControls, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(scoped.document.activeElement, scopeButtons[to]);
  assert.equal(JSON.stringify({ portfolio: scopePortfolio, calls: scopeCalls }), navigationBefore, "Arrow/Home/End only move focus; selection changes require deliberate activation");
  checks++;
}
scopedBoards.forEach((target, index) => { target.settings = scopedSettingsBefore[index]; if (index < 2) target.products = products; });
assert.equal(JSON.stringify(scopePortfolio.categories.filter(category => category.board).map(category => category.board.products)), factsBefore);
checks += 47;

// A basis switch can keep activeView === "roadmap". Its renderer must not be
// relied on to publish the new footer scope through an incidental view change.
const basisPortfolio = { settings: { roadmapBasis: "lifecycle", hashoutCategoryIds: ["one", "two"] }, categories: [
  { id: "one", name: "one", board: { ...scopePortfolio.categories[0].board, settings: { catalogGroup: "eol", hideDiscontinued: false }, products } },
  { id: "two", name: "two", board: { ...scopePortfolio.categories[1].board, settings: { catalogGroup: "all", hideDiscontinued: false }, products: [products[0], products[2]] } },
] };
const basisPublications = [], basisOrder = [], basisPreferences = JSON.stringify(basisPortfolio.categories.map(category => category.board.settings));
const basisFacts = JSON.stringify(basisPortfolio.categories.map(category => category.board.products));
const basisOverrides = {
  portfolio: basisPortfolio, board: basisPortfolio.categories[0].board, searchQuery: "", roadmapSearchQuery: "",
  hasDedicatedHashoutView: undefined, selectedProduct: undefined,
  roadmapDragState: null, roadmapDetailsOpen: false, roadmapInteractionMode: "pan",
  renderRoadmaps() { basisOrder.push("roadmaps"); assert.equal(scoped.activeView, "roadmap", "basis rendering keeps the existing Roadmap view"); },
  renderStatus() { basisOrder.push("status"); scoped.publishWorkspaceState(); },
  announceRoadmapEdit() {}, scheduleSave() {},
  window: { dispatchEvent(event) { basisPublications.push(event.detail); } },
  CustomEvent: class { constructor(type, options) { assert.equal(type, "portfolio:render"); this.detail = options.detail; } },
};
const basisOriginals = Object.fromEntries(Object.keys(basisOverrides).map(key => [key, scoped[key]]));
Object.assign(scoped, basisOverrides);
vm.runInContext(["hasDedicatedHashoutView", "selectedProduct", "publishWorkspaceState", "setRoadmapBasis"].map(appFunction).join("\n"), scoped);
for (const [basis, visibleCount, productCount] of [["ffs", 4, 7], ["lifecycle", 2, 5]]) {
  basisOrder.length = 0;
  const publicationCount = basisPublications.length;
  scoped.setRoadmapBasis(basis);
  assert.deepEqual(basisOrder, ["roadmaps", "status"], "basis switch explicitly refreshes status after its renderer");
  assert.equal(basisPublications.length, publicationCount + 1, "each direction publishes the new scope once");
  assert.equal(basisPublications.at(-1).visibleCount, visibleCount, `${basis} footer counts the current filtered scope`);
  assert.equal(basisPublications.at(-1).productCount, productCount, `${basis} footer uses the corresponding full scope`);
  assert.equal(scoped.activeView, "roadmap", "footer refresh does not depend on changing the active view");
  assert.equal(JSON.stringify(basisPortfolio.categories.map(category => category.board.settings)), basisPreferences, "basis switch preserves every category visibility preference");
  assert.equal(JSON.stringify(basisPortfolio.categories.map(category => category.board.products)), basisFacts, "basis switch preserves all product facts and ordering");
  checks += 7;
}
Object.assign(scoped, basisOriginals);

// Capture the real Hashout adapter callbacks; no fake visibility implementation
// is substituted for getPortfolio, scope, selection or scope-change behavior.
scoped.ensureHashoutView();
const projectionBefore = JSON.stringify(scopePortfolio), projected = hashoutOptions.getPortfolio();
assert.notEqual(projected, scopePortfolio); assert.notEqual(projected.categories[0].board, scopePortfolio.categories[0].board);
assert.deepEqual(idsOf(projected.categories[0].board.products), ["dated-eol", "stage-eol"]);
assert.equal(projected.categories[0].board.products[0], products[2], "projection preserves exact surviving product identity");
assert.equal(JSON.stringify(scopePortfolio), projectionBefore, "Hashout getPortfolio projection is immutable");
scoped.hashoutSelectedKey = scopePortfolio.settings.hashoutSelectedKey = JSON.stringify(["one", "launched"]);
assert.equal(hashoutOptions.getSelectedKey(), null, "Hashout cannot expose a hidden explicit key");
scoped.clearHiddenCatalogSelection();
assert.equal(scoped.hashoutSelectedKey, null); assert.equal(scopePortfolio.settings.hashoutSelectedKey, null);
scoped.hashoutSelectedKey = scopePortfolio.settings.hashoutSelectedKey = JSON.stringify(["two", "launched"]);
assert.equal(hashoutOptions.getSelectedKey(), JSON.stringify(["two", "launched"]));
hashoutOptions.onScopeChange(["one"]);
assert.equal(scoped.hashoutSelectedKey, null); assert.equal(scopePortfolio.settings.hashoutSelectedKey, null, "scope exclusion clears the actual Hashout selection preference");
assert.equal(hashoutOptions.getSelectedKey(), null);
assert.equal(JSON.stringify(scopePortfolio.categories.filter(category => category.board).map(category => category.board.products)), factsBefore);
checks += 5;

// The planner receives the same filtered identities as the legacy export path,
// for both lifecycle and FFS exports. Its page layout has separate checks.
let plannerSections;
Object.assign(app, {
  PortfolioFfsRoadmap: globalThis.PortfolioFfsRoadmap,
  effectiveRoadmap: product => product.roadmap || {}, roadmapStatusColor: () => "#555555", standardizedStatus: () => ({ label: "" }),
  contrastTextColor: () => "#ffffff", splitRoadmapStatusLabel: value => value || "", productPriceText: () => "",
  PPTXExportPlanner: { planRoadmap(sections) { plannerSections = sections; return { slides: [] }; } },
});
vm.runInContext(appFunction("ffsRoadmapStageLabel"), app);
for (const ffs of [false, true]) {
  app.isFfsRoadmap = () => ffs;
  for (const [group, expected] of [["launched", ["launched"]], ["eol", ["dated-eol", "stage-eol"]]]) {
    appBoard.settings.catalogGroup = group;
    app.buildPptxExportPlan("roadmap", [category, allHidden], { mode: "categories", startMonth: "2026-01", endMonth: "2030-12" });
    assert.deepEqual(Array.from(plannerSections, section => Array.from(section.products, product => product.id)), [expected], "planner excludes all-hidden categories and hidden records in either timeline basis");
    checks++;
  }
}
app.isFfsRoadmap = () => false; delete app.PPTXExportPlanner;

// Restore the actual per-category preference map, preserving categories absent
// from the captured scope and refusing to resurrect removed category identities.
const excludedViewBoard = { ...appBoard, settings: { catalogGroup: "unreleased", hideDiscontinued: false, roadmap: { startMonth: "2026-01", endMonth: "2030-12" } } };
app.portfolio.categories.push({ id: "excluded", board: excludedViewBoard });
app.isFfsRoadmap = () => app.portfolio.settings.roadmapBasis === "ffs";
vm.runInContext(appFunction("hashoutCategoryScope"), app);
app.activeView = "roadmap"; app.portfolio.settings.roadmapBasis = "ffs"; app.portfolio.settings.hashoutCategoryIds = ["one", "two"];
app.activeCategoryId = "one"; app.board = appBoard; appBoard.settings.catalogGroup = "launched"; otherBoard.settings.catalogGroup = "eol";
const scopeCapture = savedViews.sanitizePreferences("portfolio", app.adapter.captureView());
assert.deepEqual(clone(scopeCapture.categoryVisibility), [{ categoryId: "one", catalogGroup: "launched" }, { categoryId: "two", catalogGroup: "eol" }]);
const excludedViewBefore = JSON.stringify(excludedViewBoard.settings);
app.adapter.applyView({ view: "roadmap", basis: "ffs", activeCategoryId: "one", categoryIds: ["one", "two", "removed"], categoryVisibility: [
  { categoryId: "one", catalogGroup: "all", hideDiscontinued: true }, { categoryId: "two", hideDiscontinued: true }, { categoryId: "removed", catalogGroup: "eol" },
], display: { catalogGroup: "eol" } });
assert.equal(appBoard.settings.catalogGroup, "all"); assert.equal(appBoard.settings.hideDiscontinued, false);
assert.equal(otherBoard.settings.catalogGroup, undefined); assert.equal(otherBoard.settings.hideDiscontinued, true, "legacy entries remain restorable in the preference map");
assert.deepEqual(Array.from(app.portfolio.settings.hashoutCategoryIds), ["one", "two"]); assert.equal(app.portfolio.categories.length, 3);
assert.equal(JSON.stringify(excludedViewBoard.settings), excludedViewBefore, "excluded preference not in the saved map remains unchanged");
app.adapter.applyView({ view: "roadmap", activeCategoryId: "one", categoryVisibility: [], display: { catalogGroup: "eol" } });
assert.equal(appBoard.settings.catalogGroup, "all", "explicit empty preference map does not fall through to the old display override");
const beforeAbsent = JSON.stringify(app.portfolio.categories.map(category => category.board.settings));
app.adapter.applyView({ view: "roadmap", activeCategoryId: "one", display: {} });
assert.equal(JSON.stringify(app.portfolio.categories.map(category => category.board.settings)), beforeAbsent, "old view without any visibility field preserves each current category preference");
assert.equal(JSON.stringify(products), productBytes);
checks += 6;
app.adapter.applyView({ view: "roadmap", basis: "ffs", activeCategoryId: "one", categoryIds: ["one", "two"], categoryVisibility: [
  { categoryId: "one", catalogGroups: ["in-development", "launched"], catalogGroup: "eol", hideDiscontinued: true },
  { categoryId: "two", catalogGroups: [] }, { categoryId: "removed", catalogGroups: ["all"] },
], display: { catalogGroups: ["eol"] } });
assert.deepEqual(Array.from(appBoard.settings.catalogGroups), ["launched", "in-development"], "category map restores the canonical Released plus In development union over stale legacy/display fields");
assert.deepEqual(Array.from(otherBoard.settings.catalogGroups), [], "category map restores an intentional imported none preference exactly");
assert.equal(appBoard.settings.catalogGroup, undefined); assert.equal(appBoard.settings.hideDiscontinued, false);
assert.equal(otherBoard.settings.catalogGroup, undefined); assert.equal(otherBoard.settings.hideDiscontinued, false);
assert.deepEqual(savedViews.sanitizePreferences("portfolio", app.adapter.captureView()).categoryVisibility, [
  { categoryId: "one", catalogGroups: ["launched", "in-development"] }, { categoryId: "two", catalogGroups: [] },
], "capture and replay retain distinct scoped multi-select choices without inventing missing categories");
assert.equal(JSON.stringify(excludedViewBoard.settings), excludedViewBefore);
assert.equal(JSON.stringify(products), productBytes); assert.equal(JSON.stringify(detailProducts), detailBytes);
checks += 6;
app.adapter.applyView({ view: "roadmap", basis: "ffs", activeCategoryId: "one", categoryIds: ["one", "two"], categoryVisibility: [
  { categoryId: "one", catalogGroups: ["all"], catalogExcludedGroups: ["eol"] },
  { categoryId: "two", catalogGroups: ["all"], catalogExcludedGroups: ["embargo", "in-planning"] },
] });
assert.deepEqual(Array.from(appBoard.settings.catalogExcludedGroups), ["eol"]);
assert.deepEqual(Array.from(otherBoard.settings.catalogExcludedGroups), ["in-planning", "embargo"]);
assert.deepEqual(savedViews.sanitizePreferences("portfolio", app.adapter.captureView()).categoryVisibility, [
  { categoryId: "one", catalogGroups: ["all"], catalogExcludedGroups: ["eol"] },
  { categoryId: "two", catalogGroups: ["all"], catalogExcludedGroups: ["in-planning", "embargo"] },
], "actual per-category capture and restore preserve different inverse preferences");
app.adapter.applyView({ view: "products", activeCategoryId: "one", display: {} });
assert.deepEqual(Array.from(appBoard.settings.catalogExcludedGroups), ["eol"], "older saved view without visibility fields retains an active inverse preference");
app.adapter.applyView({ view: "products", activeCategoryId: "one", display: { catalogGroups: ["all"], catalogExcludedGroups: ["in-development"] } });
assert.deepEqual(Array.from(appBoard.settings.catalogExcludedGroups), ["in-development"]);
assert.deepEqual(savedViews.sanitizePreferences("portfolio", app.adapter.captureView()).display.catalogExcludedGroups, ["in-development"], "display preference capture also retains literal exclusions");
app.adapter.applyView({ view: "products", activeCategoryId: "one", display: { catalogGroups: ["all"] } });
assert.equal(appBoard.settings.catalogExcludedGroups, undefined, "opening a plain All saved view clears prior inverse exclusions");
assert.equal(JSON.stringify(products), productBytes); assert.equal(JSON.stringify(detailProducts), detailBytes);
checks += 6;
console.log(`Catalog visibility checks passed: ${checks} model/concurrent-view and actual shared-visibility application cases, local exact/quarter boundaries, scoped FFS and saved-view compatibility, action guards, hidden selection/editor cleanup, immutable Products/Roadmap search and PNG/PPTX filtering.`);
