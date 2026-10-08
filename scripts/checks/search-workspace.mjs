import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../../public/js/portfolio-search.js");
await import("../../public/js/portfolio-model.js");

const appSource = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const detailsSource = await readFile(new URL("../../public/js/product-details.js", import.meta.url), "utf8");
const functionNames = [
  "openPortfolioSearchResult", "activateCategory", "setView", "syncRoadmapDetailsVisibility", "stopRoadmapSlotEditing",
  "openViewerInfo", "closeViewerInfo", "visibleProducts", "visibleRoadmapProducts", "productDetailsModel",
  "normalizeAscmProductMetadata", "normalizeAscmRecord", "normalizeProductInfoDate", "formatProductInfoDate",
  "normalizePartSku", "productPartSkus", "productVariantGroups", "productTier", "monthIndex", "roadmapLabel", "splitRoadmapStatusLabel",
];
const functions = functionNames.map((name) => {
  const definition = appSource.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(definition, `workspace integration must exercise the actual ${name} function`);
  return definition[0];
}).join("\n");
const plain = (value) => JSON.parse(JSON.stringify(value));
const freezeTree = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
};
const targetSku = "4P5D4AA#ABA";
const sourceSku = "7Z777AA#ABA";
const targetProduct = {
  id: "console-cloud", name: "Cloud Aurora Console", laneId: "wireless", codename: "Aurora", tier: "Core",
  price: 129.99, imageAssetId: "console-image", order: 7,
  generalAvailabilityDate: "2026-05-11", endManufacturingDate: "2029-09-12", ffsDate: "2026-01-10",
  globalAnnouncementDate: "2026-04-03", webReadinessDate: "2026-04-07", finalAssetsDate: "2026-03-02",
  specs: [{ id: "connection", label: "Connection", value: "Wireless 2.4 GHz" }],
  roadmap: { family: "Cloud", status: "launched", confidence: "high", startMonth: "2026-05", endMonth: "2029-09", notes: "Saved planning notes" },
  partSkus: Array.from({ length: 17 }, (_, index) => ({ id: `hp-${index}`, code: index === 13 ? targetSku : `HP${String(index).padStart(3, "0")}AA`, variantId: index === 13 ? "bronze" : "" })),
  variantGroups: [
    { id: "colors", label: "Color", type: "color", items: [{ id: "bronze", code: "BRONZE", colorName: "Bronze", colorHex: "#b68d60", imageAssetId: "bronze-image" }] },
    { id: "layouts", label: "Layouts", type: "layout", items: Array.from({ length: 11 }, (_, index) => ({ id: `layout-${index}`, code: `L${String(index).padStart(2, "0")}`, label: `Layout ${index}` })) },
  ],
  ascm: {
    sourceCategory: "Console", sourceFile: "Saved-ASCM.xlsx", importedAt: "2026-09-01T12:00:00Z",
    basePartNumbers: [sourceSku],
    records: Array.from({ length: 7 }, (_, index) => ({ basePartNumber: index === 5 ? sourceSku : `SOURCE${index}AA`, fullProductName: `Imported console model ${index}`, generalAvailabilityDate: "2026-05-11", endManufacturingDate: "2029-09-12" })),
  },
  custom: { supplierApproval: "Keep unchanged", localDraftNote: "Unsaved curated note" },
};
const fixture = {
  version: 4, activeCategoryId: "pc", settings: { timeline: { startMonth: "2026-01", endMonth: "2030-12" } },
  categories: [
    { id: "pc", name: "PC Gaming Audio", board: { version: 1, lanes: [{ id: "wired", label: "WIRED" }], products: [{ ...structuredClone(targetProduct), id: "pc-cloud", name: "Cloud Aurora PC", laneId: "wired" }], settings: { showPrices: true } } },
    { id: "console", name: "Console Gaming Audio", board: { version: 1, lanes: [{ id: "wireless", label: "WIRELESS" }], products: [{ ...structuredClone(targetProduct), id: "console-first", name: "First console product", partSkus: [], variantGroups: [], ascm: null }, structuredClone(targetProduct)], settings: { showPrices: false } } },
  ],
  imageAssets: [{ id: "console-image", name: "Saved image" }, { id: "bronze-image", name: "Saved bronze image" }],
  masterSync: { revision: 16, products: { "console-cloud": { revision: 9, archivedProduct: { name: "Archived data" } } }, history: [{ revision: 16, comments: "Accepted draft" }] },
  masterLocalBaseline: [{ productId: "console-cloud", values: { name: "Original name", custom: { baselineNote: "Keep draft baseline" } } }],
  masterMergeIntents: [{ productId: "console-cloud", sourceProductId: "previous-cloud", choices: { name: "mine" } }],
  masterLocalAssetIds: { "console-image": "local-image" },
};

function classes() {
  const values = new Set();
  return { add: (...names) => names.forEach((name) => values.add(name)), remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name), toggle(name, enabled) { if (enabled ?? !values.has(name)) values.add(name); else values.delete(name); } };
}
function element() {
  return { classList: classes(), attributes: {}, dataset: {}, style: {}, textContent: "", value: "", disabled: false,
    setAttribute(name, value) { this.attributes[name] = String(value); }, getAttribute(name) { return this.attributes[name] ?? null; } };
}
const decode = (value) => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function harness({ view = "products", transform } = {}) {
  const portfolio = structuredClone(fixture);
  transform?.(portfolio);
  // Navigation may persist activeCategoryId, but saved products, source data,
  // image assignments, master baselines, merge intents and draft facts cannot
  // be edited by any of the real navigation/adapter functions under test.
  for (const category of portfolio.categories) {
    freezeTree(category.board.products);
    freezeTree(category.board.lanes);
    freezeTree(category.board.settings);
  }
  for (const key of ["settings", "imageAssets", "masterSync", "masterLocalBaseline", "masterMergeIntents", "masterLocalAssetIds"]) freezeTree(portfolio[key]);
  const controls = new Map();
  const counts = { navigationSaves: 0, boardWrites: 0, renders: 0, viewerReveals: 0, productScrolls: 0, roadmapScrolls: 0, fits: 0 };
  const frames = new Map();
  const focusEvents = [];
  let nextFrame = 0;
  const makeSurface = (name) => {
    const surface = { ...element(), html: "", buttons: [] };
    surface.show = (html) => {
      surface.html = html;
      surface.buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => {
        const tag = match[0];
        const copy = tag.match(/data-detail-copy="([^"]*)"/);
        return { dataset: copy ? { detailCopy: decode(copy[1]) } : {}, tag,
          focus(options) { focusEvents.push({ surface: name, copy: copy ? decode(copy[1]) : "", tab: tag.match(/data-detail-tab="([^"]*)"/)?.[1] || tag.match(/data-detail-more="([^"]*)"/)?.[1] || "", options: plain(options) }); } };
      });
    };
    surface.querySelectorAll = (selector) => selector === "[data-detail-copy]" ? surface.buttons.filter((button) => Object.hasOwn(button.dataset, "detailCopy")) : [];
    surface.querySelector = (selector) => selector === '[role="tab"][aria-selected="true"]' ? surface.buttons.find((button) => /role="tab"/.test(button.tag) && /aria-selected="true"/.test(button.tag)) : null;
    return surface;
  };
  const viewer = makeSurface("viewer");
  const split = makeSurface("split");
  const tabs = [Object.assign(element(), { dataset: { view: "products" } }), Object.assign(element(), { dataset: { view: "roadmap" } })];
  const context = {
    portfolio, board: portfolio.categories[0].board, activeCategoryId: "pc", activeView: view, selectedId: "pc-cloud", packageOperationInProgress: false,
    searchQuery: "filter that hides every product", roadmapSearchQuery: "another hidden selection", productLayoutEditing: true, hoveredHeroVariant: { productId: "pc-cloud" },
    viewerInfo: viewer, splitProduct: split, viewerInfoOutline: element(), viewerInfoProgress: 1, viewerInfoProductId: "pc-cloud", viewerInfoOpen: true, viewerInfoAnimationFrame: null,
    roadmapDetailsOpen: view === "split", roadmapDragState: null, roadmapDraft: null, roadmapPanState: null, roadmapInteractionMode: "dates", initialVerticalFitPending: false,
    productView: element(), roadmapView: element(), splitView: element(), productControls: element(), roadmapControls: element(), splitRoadmapScroll: { name: "split" }, roadmapScroll: { name: "roadmap" },
    categorySettingsDraftLanes: freezeTree([{ id: "draft-lane", label: "Unsaved category lane label" }]),
    discardedDrafts: new Map([["console-cloud", freezeTree({ name: "Discarded local draft", custom: { source: "unsaved" } })]]),
    PortfolioSearch: globalThis.PortfolioSearch,
    PortfolioModel: { ...globalThis.PortfolioModel, syncTimelineSettings(value) { assert.equal(value, portfolio); } },
    PRODUCT_TIER_OPTIONS: ["", "Core", "Core+", "Hero", "Star", "Star+"],
    document: { querySelectorAll: (selector) => selector === ".view-tab" ? tabs : [] },
    $: (selector) => { if (!controls.has(selector)) controls.set(selector, element()); return controls.get(selector); },
    categoryDefinition: (id = context.activeCategoryId) => ({ id, name: portfolio.categories.find((category) => category.id === id)?.name || "Category" }),
    activeCategoryRecord: () => portfolio.categories.find((category) => category.id === context.activeCategoryId),
    selectedProduct: () => context.board.products.find((product) => product.id === context.selectedId),
    ensureBoardSchema: (value) => value,
    scheduleSave() { counts.navigationSaves++; },
    updateBoard() { counts.boardWrites++; throw new Error("Search navigation cannot write product facts"); },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame(id) { frames.delete(id); },
    closeInspector() {}, updateProductLayoutEditControls() {}, finishProductReorder() {}, closeVariantPopover() {}, syncControls() {}, renderInspector() {}, closePopupMenus() {}, updateLinkedViewButton() {}, updateRoadmapEditControls() {},
    renderBoard() {}, positionViewerInfo() {},
    animateViewerInfo(progress, onComplete) { context.viewerInfoProgress = progress; onComplete?.(); },
    revealViewerInfoBesideProduct() { counts.viewerReveals++; },
    fitProductLanesVertically() { counts.fits++; }, scrollSelectedIntoView() { counts.productScrolls++; }, scrollRoadmapSelected(target) { counts.roadmapScrolls++; assert.ok([context.splitRoadmapScroll, context.roadmapScroll].includes(target)); },
    renderViewerInfo() {
      const product = context.board.products.find((item) => item.id === context.viewerInfoProductId);
      viewer.show(product && context.viewerInfoOpen ? context.PortfolioDetails.render(context.productDetailsModel(product), { surface: "viewer" }) : "");
    },
    renderActiveView() {
      counts.renders++;
      context.renderViewerInfo();
      const product = context.selectedProduct();
      split.show(product ? context.PortfolioDetails.render(context.productDetailsModel(product), { surface: "split" }) : "");
    },
  };
  vm.createContext(context);
  new vm.Script(detailsSource).runInContext(context);
  new vm.Script(functions).runInContext(context);
  context.$("#searchInput").value = context.searchQuery;
  context.$("#roadmapSearch").value = context.roadmapSearchQuery;
  const snapshotBusiness = () => plain({ categories: portfolio.categories, settings: portfolio.settings, imageAssets: portfolio.imageAssets, masterSync: portfolio.masterSync,
    masterLocalBaseline: portfolio.masterLocalBaseline, masterMergeIntents: portfolio.masterMergeIntents, masterLocalAssetIds: portfolio.masterLocalAssetIds,
    categorySettingsDraftLanes: context.categorySettingsDraftLanes, discardedDrafts: [...context.discardedDrafts] });
  const initialBusiness = snapshotBusiness();
  const flushFrames = () => {
    let iterations = 0;
    while (frames.size) {
      assert.ok(iterations++ < 100, "navigation callbacks must settle");
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback();
    }
  };
  const resultFor = (query, categoryId = "console", productId = "console-cloud") => {
    const result = context.PortfolioSearch.search(portfolio, query, { activeCategoryId: context.activeCategoryId, limit: 500 }).results.find((entry) => entry.categoryId === categoryId && entry.productId === productId);
    assert.ok(result, `fixture must contain a real search result for ${query}`);
    return result;
  };
  return { context, portfolio, viewer, split, controls, counts, focusEvents, frames, flushFrames, resultFor, snapshotBusiness,
    assertUnchanged() { assert.deepEqual(snapshotBusiness(), initialBusiness, "search and detail navigation must retain product facts, source metadata, images and every saved or unsaved master draft"); assert.equal(counts.boardWrites, 0); } };
}

function assertTab(html, surface, tab) {
  assert.match(html, new RegExp(`id="product-detail-${surface}-${tab}-tab"[^>]*aria-selected="true"`), `matched detail tab should be visible on ${surface}`);
}
function assertPage(html, name, index) {
  assert.match(html, new RegExp(`<div class="product-detail-page " data-detail-page-name="${name}" data-detail-page-index="${index}"`), `the matching ${name} page must be visible`);
}

// Real global matches include both legitimate listings. Opening the Console
// result must select it rather than a PC match or the first Console product.
for (const view of ["products", "roadmap", "split"]) {
  const h = harness({ view });
  const all = h.context.PortfolioSearch.search(h.portfolio, "4p5d4aa aba", { activeCategoryId: "pc" });
  assert.deepEqual(all.results.map((entry) => entry.categoryId), ["pc", "console"]);
  const result = h.resultFor("4p5d4aa aba");
  assert.equal(h.context.visibleProducts().length, 0);
  assert.equal(h.context.visibleRoadmapProducts().length, 0);
  assert.equal(h.context.openPortfolioSearchResult(result), true);
  assert.equal(h.context.activeCategoryId, "console");
  assert.equal(h.portfolio.activeCategoryId, "console", "only navigation metadata may persist the active category");
  assert.equal(h.context.board, h.portfolio.categories[1].board);
  assert.equal(h.context.selectedId, "console-cloud");
  assert.equal(h.context.searchQuery, "");
  assert.equal(h.context.roadmapSearchQuery, "");
  assert.equal(h.controls.get("#searchInput").value, "");
  assert.equal(h.controls.get("#roadmapSearch").value, "");
  assert.ok(h.context.visibleProducts().some((product) => product.id === "console-cloud"));
  assert.ok(h.context.visibleRoadmapProducts().some((product) => product.id === "console-cloud"));
  assert.equal(h.context.productLayoutEditing, false);
  assert.equal(h.context.roadmapInteractionMode, "pan", "opening a result must leave the roadmap in its safe navigation mode");
  const surface = view === "products" ? "viewer" : "split";
  const target = surface === "viewer" ? h.viewer : h.split;
  assert.equal(h.context.activeView, view === "products" ? "products" : "split", "Product Cards retains its surface; Roadmap opens selected details beside the timeline");
  assertTab(target.html, surface, "skus");
  assertPage(target.html, "SKUs", 2);
  assert.equal(h.focusEvents.length, 0, "focus must wait for rendered/animated detail content");
  h.flushFrames();
  assert.deepEqual(h.focusEvents, [{ surface, copy: targetSku, tab: "", options: { preventScroll: true } }]);
  assert.equal(h.counts.navigationSaves, 1);
  if (view === "products") {
    assert.equal(h.context.viewerInfoOpen, true);
    assert.equal(h.context.viewerInfoProductId, "console-cloud");
    assert.equal(h.counts.viewerReveals, 1);
    assert.equal(h.counts.productScrolls, 1);
  } else {
    assert.equal(h.context.roadmapDetailsOpen, true);
    assert.equal(h.controls.get("#toggleRoadmapDetails").attributes["aria-expanded"], "true");
    assert.equal(h.counts.roadmapScrolls, 1);
  }
  h.assertUnchanged();
}

// Real focusMatch distinguishes primary HP SKU pages, imported source pages,
// assigned color variants and additional option pages without changing facts.
for (const [query, expectedTab, pageName, pageIndex] of [[sourceSku, "more", "source records", 2], ["BRONZE", "skus", "SKUs", 2], ["L09", "skus", "options", 1], ["Cloud Aurora Console", "overview", "", 0]]) {
  const h = harness({ view: "split" });
  assert.equal(h.context.openPortfolioSearchResult(h.resultFor(query)), true);
  assertTab(h.split.html, "split", expectedTab);
  if (pageName) assertPage(h.split.html, pageName, pageIndex);
  if (query === sourceSku) assert.match(h.split.html, /id="product-detail-split-source-tab"[^>]*aria-selected="true"/);
  h.flushFrames();
  assert.equal(h.focusEvents[0].tab, expectedTab);
  assert.equal(h.focusEvents[0].copy, "");
  h.assertUnchanged();
}
{
  const h = harness();
  const model = h.context.productDetailsModel(h.portfolio.categories[1].board.products[1]);
  const before = plain(model);
  h.context.PortfolioDetails.focusMatch(model, { surface: "viewer", sku: "4p5d4aa aba" });
  const viewerHtml = h.context.PortfolioDetails.render(model, { surface: "viewer" });
  assertTab(viewerHtml, "viewer", "skus");
  assertPage(viewerHtml, "SKUs", 2);
  h.context.PortfolioDetails.focusMatch(model, { surface: "split", sku: "unknown-code" });
  const splitHtml = h.context.PortfolioDetails.render(model, { surface: "split" });
  assertTab(splitHtml, "split", "overview");
  assertPage(h.context.PortfolioDetails.render(model, { surface: "viewer" }), "SKUs", 2);
  assert.deepEqual(plain(model), before, "real focusMatch keeps product detail models immutable and surface state independent");
  h.assertUnchanged();
}

function assertRejected(h, result, reason) {
  const before = { business: h.snapshotBusiness(), activeCategoryId: h.context.activeCategoryId, activeView: h.context.activeView, selectedId: h.context.selectedId,
    search: h.context.searchQuery, roadmapSearch: h.context.roadmapSearchQuery, navigationSaves: h.counts.navigationSaves };
  assert.equal(h.context.openPortfolioSearchResult(result), false, reason);
  assert.equal(h.context.activeCategoryId, before.activeCategoryId);
  assert.equal(h.context.activeView, before.activeView);
  assert.equal(h.context.selectedId, before.selectedId);
  assert.equal(h.context.searchQuery, before.search);
  assert.equal(h.context.roadmapSearchQuery, before.roadmapSearch);
  assert.equal(h.counts.navigationSaves, before.navigationSaves);
  assert.equal(h.frames.size, 0);
  assert.equal(h.focusEvents.length, 0);
  assert.deepEqual(h.snapshotBusiness(), before.business, "rejected results must leave every business record and draft untouched");
}
{
  const h = harness();
  h.context.packageOperationInProgress = true;
  assertRejected(h, h.resultFor(targetSku), "package/import work in progress must block result navigation");
}
for (const result of [null, undefined, {}, [], { productId: 7, categoryId: "console" }, { productId: "console-cloud", categoryId: {} }, { productId: "", categoryId: "console" }, { productId: "console-cloud", categoryId: "" }, { productId: "console-cloud", categoryId: "missing-category" }]) {
  assertRejected(harness(), result, "malformed or unknown identities cannot navigate");
}
assertRejected(harness({ transform(portfolio) { portfolio.categories[1].board.products = portfolio.categories[1].board.products.filter((product) => product.id !== "console-cloud"); } }),
  { productId: "console-cloud", categoryId: "console", matchedSku: targetSku }, "a deleted result must be rejected");
assertRejected(harness({ transform(portfolio) { const moved = portfolio.categories[1].board.products.pop(); portfolio.categories[0].board.products.push({ ...moved, laneId: "wired" }); } }),
  { productId: "console-cloud", categoryId: "console", matchedSku: targetSku }, "a result moved to another category must be rejected until refreshed");
for (const sameCategory of [false, true]) {
  const h = harness({ transform(portfolio) { const duplicate = structuredClone(portfolio.categories[1].board.products[1]); portfolio.categories[sameCategory ? 1 : 0].board.products.push(duplicate); } });
  assertRejected(h, { productId: "console-cloud", categoryId: "console", matchedSku: targetSku }, "repeated internal product IDs are ambiguous even when the result supplies a category");
}

// Deferred focus must not jump to an old result after the user navigates away
// while viewer animation or the next split rendering frame is pending.
for (const view of ["products", "roadmap", "split"]) {
  for (const changed of ["category", "selection", "surface"]) {
    const h = harness({ view });
    h.context.openPortfolioSearchResult(h.resultFor(targetSku));
    if (changed === "category") h.context.activeCategoryId = "pc";
    else if (changed === "selection") h.context.selectedId = "console-first";
    else h.context.activeView = view === "products" ? "split" : "products";
    h.flushFrames();
    assert.equal(h.focusEvents.length, 0, `a stale ${view} focus callback must check current ${changed}`);
    h.assertUnchanged();
  }
}

// The actual visibility helper closes an empty or filtered detail pane but
// retains the user's preference, so a visible selection reopens it later.
{
  const h = harness({ view: "split" });
  h.context.openPortfolioSearchResult(h.resultFor(targetSku));
  h.flushFrames();
  h.context.selectedId = null;
  h.context.syncRoadmapDetailsVisibility();
  assert.equal(h.context.activeView, "roadmap");
  assert.equal(h.context.splitView.classList.contains("hidden"), true);
  assert.equal(h.context.roadmapView.classList.contains("hidden"), false);
  assert.equal(h.context.roadmapDetailsOpen, true, "closing an empty pane must retain the chosen detail preference");
  assert.equal(h.controls.get("#toggleRoadmapDetails").disabled, true);
  assert.equal(h.controls.get("#toggleRoadmapDetails").attributes["aria-expanded"], "false");
  h.context.selectedId = "console-cloud";
  h.context.syncRoadmapDetailsVisibility();
  assert.equal(h.context.activeView, "split");
  assert.equal(h.controls.get("#toggleRoadmapDetails").disabled, false);
  h.context.roadmapSearchQuery = "nothing matches this selection";
  h.context.syncRoadmapDetailsVisibility();
  assert.equal(h.context.activeView, "roadmap", "a selected but filtered-out product must not leave an empty split pane");
  h.context.roadmapSearchQuery = "4p5d4aa aba";
  h.context.syncRoadmapDetailsVisibility();
  assert.equal(h.context.activeView, "split", "the same shared SKU matching rules must reopen details when the selection is visible");
  h.context.roadmapDetailsOpen = false;
  h.context.syncRoadmapDetailsVisibility();
  assert.equal(h.context.activeView, "roadmap", "an explicit hidden detail preference must remain hidden even with a valid selection");
  h.context.activeView = "products";
  h.context.roadmapDetailsOpen = true;
  h.context.syncRoadmapDetailsVisibility();
  assert.equal(h.context.activeView, "products");
  assert.equal(h.controls.get("#toggleRoadmapDetails").classList.contains("hidden"), true);
  h.assertUnchanged();
}

console.log("Search workspace checks passed: real category navigation, matching detail pages, view preservation, stale identity rejection, deferred focus guards, pane visibility and unchanged business/draft data.");
