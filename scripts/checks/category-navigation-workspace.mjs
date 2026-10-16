import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../../public/js/date-precision.js");
await import("../../public/js/portfolio-model.js");
await import("../../public/js/portfolio-search.js");
await import("../../public/js/ffs-roadmap.js");
await import("../../public/js/hashout-layout.js");

const appSource = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const hashoutSource = await readFile(new URL("../../public/js/hashout-view.js", import.meta.url), "utf8");
const appFunction = name => {
  const definition = appSource.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"))?.[0];
  assert.ok(definition, `exercise the actual application ${name} function`);
  return definition;
};
const chooseScope = hashoutSource.match(/^    function chooseScope\([^]*?^    \}/m)?.[0];
assert.ok(chooseScope, "exercise the actual Hashout scope mutation path");
assert.match(hashoutSource, /setScope:\s*chooseScope/, "the controller exposes its existing scope implementation");
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const product = (id, status) => ({ id, name: id, laneId: "main", order: 0, roadmap: { status, family: "Saved family" },
  imageAssetId: `${id}-image`, specs: [{ id: "technical", label: "Technical", value: "Saved (condition)" }],
  plc: { history: [{ exact: "Preserve source evidence" }] }, revisions: { specs: 14 }, custom: { retained: [null, false, ""] } });
const fixture = () => ({
  activeCategoryId: "pc-gaming-audio", settings: { roadmapBasis: "lifecycle", hashoutCategoryIds: ["pc-gaming-audio", "mice"], timeline: { startMonth: "2026-01", endMonth: "2030-12" } },
  categories: [
    { id: "pc-gaming-audio", name: "PC Gaming Audio", groups: ["launched", "in-development"], products: [product("headset", "launched"), product("dev-headset", "in-development"), product("planned-headset", "in-planning")] },
    { id: "mice", name: "Mice", groups: ["eol"], products: [product("mouse", "launched"), product("eol-mouse", "end-of-life")] },
    { id: "keyboards", name: "Keyboards", groups: ["all"], products: [] },
  ].map(({ groups, ...category }) => ({ id: category.id, name: category.name, board: { title: `${category.name} Portfolio`, lanes: [{ id: "main", label: "Main", order: 0 }], products: category.products,
    settings: { catalogGroups: groups, hideDiscontinued: false, showPrices: true, showSkus: true, roadmap: { startMonth: "2026-01", endMonth: "2030-12", snap: "month" } } } })),
  imageAssets: [{ id: "headset-image", packagePath: "images/headset.png" }],
  masterLocalBaseline: [{ productId: "headset", revisions: { name: 8 }, values: { name: "Accepted source" } }],
  masterLocalMerges: [{ sourceProduct: { id: "archived", exact: "Preserve recovery evidence" } }],
  custom: { untouched: [false, null, ""] },
});
const node = () => ({ textContent: "", value: "", disabled: false, style: {}, attributes: {},
  classList: { add() {}, remove() {}, toggle() {} }, setAttribute(key, value) { this.attributes[key] = value; } });

function harness({ view = "products", basis = "lifecycle", scope = ["pc-gaming-audio", "mice"] } = {}) {
  const portfolio = fixture(); portfolio.settings.roadmapBasis = basis; portfolio.settings.hashoutCategoryIds = scope;
  for (const category of portfolio.categories) { freeze(category.board.products); freeze(category.board.lanes); freeze(category.board.settings); }
  for (const key of ["imageAssets", "masterLocalBaseline", "masterLocalMerges", "custom"]) freeze(portfolio[key]);
  const business = () => JSON.stringify({ categories: portfolio.categories, imageAssets: portfolio.imageAssets, masterLocalBaseline: portfolio.masterLocalBaseline, masterLocalMerges: portfolio.masterLocalMerges, custom: portfolio.custom, timeline: portfolio.settings.timeline });
  const initialBusiness = business();
  const controls = new Map(), get = id => { if (!controls.has(id)) controls.set(id, node()); return controls.get(id); };
  const events = { saves: 0, scans: 0, create: 0, updates: [], scope: [], cardsClosed: 0, ringsClosed: 0, laneCleared: 0, hashoutPaints: 0, lifecycleControls: 0, status: 0, fits: 0, renders: 0, reorderFinished: 0 };
  let callbacks;
  const context = {
    Date, portfolio, board: portfolio.categories[0].board, activeCategoryId: "pc-gaming-audio", activeView: view,
    selectedId: "headset", viewerInfoProductId: "headset", viewerInfoProgress: 1, viewerInfoOpen: true, viewerInfoOutline: node(), inspectorOpen: true,
    searchQuery: "Keep until navigation", roadmapSearchQuery: "Keep roadmap until navigation", hoveredHeroVariant: { productId: "headset" },
    workspaceOpening: false, workspaceSaveRevision: 0, productLayoutEditing: false, packageOperationInProgress: false, pptxExportInProgress: false, roadmapDraft: null,
    roadmapLaneHovers: [], roadmapPanState: null, roadmapDragState: null, hashoutView: {}, hashoutViewController: null,
    hashoutSelectedKey: null, hashoutViewportState: null, categoryNavigationController: null,
    zoom: 1, roadmapMonthWidth: 82, ROADMAP_DEFAULT_MONTH_WIDTH: 82, initialVerticalFitPending: false,
    categoryZoomPreferences: new Map([["mice", { productZoom: .75, roadmapZoom: .5 }]]),
    editSelectedButton: node(),
    document: { getElementById: get, querySelector: () => null, querySelectorAll: () => [] },
    $: selector => get(selector.slice(1)),
    PortfolioModel: { ...globalThis.PortfolioModel,
      catalogProducts(...args) { events.scans++; return globalThis.PortfolioModel.catalogProducts(...args); },
      syncTimelineSettings(value) { assert.equal(value, portfolio); } },
    PortfolioSearch: globalThis.PortfolioSearch, PortfolioHashoutLayout: globalThis.PortfolioHashoutLayout,
    PortfolioCategoryNavigation: { create(host, options) { assert.equal(host, get("categoryNavigation")); events.create++; callbacks = options;
      return { update(value) { events.updates.push(clone(value)); } }; } },
    PortfolioHashoutView: { create(_host, options) { context.options = options; context.scope = options.getScope(); context.allCategories = options.getPortfolio().categories;
      return { setScope(ids) { events.scope.push(clone(ids)); context.chooseScope(ids); }, closeOverlay() { events.cardsClosed++; } }; } },
    scheduleSave() { events.saves++; },
    updateBoard() { throw new Error("Category navigation must never write product records."); },
    categoryDefinition: id => ({ id }), ensureBoardSchema: value => value,
    closeViewerInfo() { context.viewerInfoProductId = null; context.viewerInfoOpen = false; },
    closeInspector() { context.inspectorOpen = false; }, finishProductReorder() { events.reorderFinished++; },
    updateProductLayoutEditControls() {}, closeVariantPopover() {}, stopRoadmapSlotEditing() { context.roadmapDraft = null; },
    renderInspector() {}, renderViewerInfo() {}, updateLinkedViewButton() {}, updateRoadmapEditControls() {}, syncFfsRoadmapControls() {},
    productPriceText: () => "", roadmapRange: () => ({ count: 60 }),
    renderActiveView() { events.renders++; context.clearHiddenCatalogSelection(); context.syncCategoryNavigation(); },
    fitProductLanesVertically() { events.fits++; },
    syncCatalogFilterControls() { events.lifecycleControls++; context.syncCategoryNavigation(); },
    renderStatus() { events.status++; },
    closeCard() { events.cardsClosed++; }, closeRing() { events.ringsClosed++; }, clearLaneHover() { events.laneCleared++; },
    refreshData() {}, requestRender() { events.hashoutPaints++; },
  };
  vm.createContext(context);
  vm.runInContext(["categoryNavigationLocked", "chooseCategoryNavigation", "chooseAllCategoryNavigation", "syncCategoryNavigation", "isFfsRoadmap", "hasDedicatedHashoutView", "hashoutCategoryScope", "hashoutSelectionEntry", "ensureHashoutView", "portfolioForSearch", "clearHiddenCatalogSelection", "activateCategory", "syncControls", "selectedProduct"].map(appFunction).join("\n") + "\n" + chooseScope, context);
  context.$("#searchInput").value = context.searchQuery; context.$("#roadmapSearch").value = context.roadmapSearchQuery;
  return { context, portfolio, controls, events, get callbacks() { return callbacks; }, latest: () => events.updates.at(-1),
    assertUnchanged() { assert.equal(business(), initialBusiness, "Category choice preserves every product, image, source record, recovery record, lifecycle preference and date range."); } };
}

let checks = 0;
for (const view of ["products", "roadmap"]) {
  const h = harness({ view });
  h.context.syncCategoryNavigation();
  assert.equal(h.events.create, 1); assert.equal(h.events.saves, 0, "rendering navigation never saves or switches categories");
  assert.equal(h.latest().mode, "single"); assert.deepEqual(h.latest().selectedIds, ["pc-gaming-audio"]); assert.equal(h.latest().allSelected, false);
  assert.deepEqual(h.latest().categories.map(category => [category.id, category.count]), [["pc-gaming-audio", 2], ["mice", 1], ["keyboards", 0]], "counts compose with each category's lifecycle selection; empty categories stay navigable");
  assert.equal(h.controls.get("categoryContext").textContent, "PC Gaming Audio");
  const before = JSON.stringify(h.events);
  assert.equal(h.callbacks.onChoose("pc-gaming-audio"), false);
  assert.equal(h.callbacks.onChoose("missing"), false);
  assert.equal(h.callbacks.onAll(), false, "single category views have no All board");
  assert.equal(JSON.stringify(h.events), before, "no-op and invalid category choices never save or render");
  assert.equal(h.callbacks.onChoose("mice"), true);
  assert.equal(h.context.activeCategoryId, "mice"); assert.equal(h.portfolio.activeCategoryId, "mice");
  assert.equal(h.context.board, h.portfolio.categories[1].board);
  assert.equal(h.context.searchQuery, ""); assert.equal(h.context.roadmapSearchQuery, "");
  assert.equal(h.context.$("#searchInput").value, ""); assert.equal(h.context.$("#roadmapSearch").value, "");
  assert.equal(h.context.viewerInfoProductId, null); assert.equal(h.context.inspectorOpen, false);
  assert.equal(h.context.zoom, .75); assert.equal(h.context.roadmapMonthWidth, 41, "single category choice restores that category's remembered zoom");
  assert.deepEqual(h.latest().selectedIds, ["mice"]); assert.equal(h.controls.get("categoryContext").textContent, "Mice");
  assert.equal(h.events.saves, 1); assert.equal(h.events.reorderFinished, 1); assert.equal(h.events.scope.length, 0, "single category selection does not change Hashout scope");
  h.context.activateCategory("keyboards", { fitVertical: false });
  assert.deepEqual(h.latest().selectedIds, ["keyboards"], "programmatic and search-style category activation also updates the dock");
  assert.equal(h.context.selectedId, null, "an empty category does not retain another category's selection");
  assert.equal(h.events.create, 1, "programmatic updates reuse the same navigation component");
  h.assertUnchanged(); checks += 13;
}

for (const view of ["products", "roadmap"]) {
  for (const guard of ["workspaceOpening", "productLayoutEditing", "packageOperationInProgress", "pptxExportInProgress", "roadmapDraft"]) {
    const h = harness({ view, basis: "ffs" }); h.context[guard] = guard === "roadmapDraft" ? { pending: true } : true;
    h.context.syncCategoryNavigation(); assert.equal(h.latest().disabled, true);
    const before = JSON.stringify({ portfolio: h.portfolio, events: h.events, category: h.context.activeCategoryId, search: h.context.searchQuery });
    assert.equal(h.callbacks.onChoose("mice"), false); assert.equal(h.callbacks.onAll(), false);
    assert.equal(JSON.stringify({ portfolio: h.portfolio, events: h.events, category: h.context.activeCategoryId, search: h.context.searchQuery }), before, "edits and loading/export operations block both category interaction paths");
    h.assertUnchanged(); checks++;
  }
}

{
  const h = harness({ view: "products", basis: "ffs", scope: [] }); h.context.syncCategoryNavigation();
  assert.equal(h.latest().mode, "single", "Products remains single-category even when the remembered Roadmap basis is FFS");
  assert.equal(h.callbacks.onChoose("mice"), true); assert.deepEqual(h.portfolio.settings.hashoutCategoryIds, []);
  h.assertUnchanged(); checks++;
}

for (const controller of [null, {}]) {
  const h = harness({ view: "roadmap", basis: "ffs", scope: ["mice"] }); h.context.syncCategoryNavigation();
  h.context.ensureHashoutView = () => controller;
  const before = JSON.stringify({ portfolio: h.portfolio, events: h.events, category: h.context.activeCategoryId, search: h.context.searchQuery });
  assert.equal(h.callbacks.onChoose("pc-gaming-audio"), false, "a missing Hashout controller or scope API reports no category change");
  assert.equal(h.callbacks.onAll(), false, "All also reports no change when its scope API is unavailable");
  assert.equal(JSON.stringify({ portfolio: h.portfolio, events: h.events, category: h.context.activeCategoryId, search: h.context.searchQuery }), before, "an unavailable scope API does not change preferences, save or render");
  h.assertUnchanged(); checks++;
}

{
  const h = harness({ view: "roadmap", basis: "ffs", scope: null }); h.context.syncCategoryNavigation();
  assert.equal(h.latest().mode, "multiple"); assert.equal(h.latest().allSelected, true);
  assert.deepEqual(h.latest().selectedIds, ["pc-gaming-audio", "mice", "keyboards"]);
  assert.equal(h.controls.get("categoryContext").textContent, "Hashout roadmap");
  h.context.hashoutSelectedKey = h.portfolio.settings.hashoutSelectedKey = JSON.stringify(["mice", "eol-mouse"]);
  assert.equal(h.callbacks.onChoose("mice"), true);
  assert.deepEqual(Array.from(h.portfolio.settings.hashoutCategoryIds), ["pc-gaming-audio", "keyboards"], "removing one category from All preserves the other scoped categories in source order");
  assert.equal(h.context.hashoutSelectedKey, null); assert.equal(h.portfolio.settings.hashoutSelectedKey, null, "excluding a category clears its hidden Hashout selection");
  assert.equal(h.context.activeCategoryId, "pc-gaming-audio"); assert.equal(h.context.board, h.portfolio.categories[0].board);
  assert.equal(h.context.searchQuery, "Keep until navigation"); assert.equal(h.context.roadmapSearchQuery, "Keep roadmap until navigation", "multi-scope changes do not activate a board or reset searches");
  assert.equal(h.events.saves, 1); assert.equal(h.events.lifecycleControls, 1); assert.equal(h.events.status, 1); assert.equal(h.events.hashoutPaints, 1);
  assert.ok(h.events.cardsClosed > 0 && h.events.ringsClosed > 0 && h.events.laneCleared > 0, "scope changes close stale overlays and hover state through the existing Hashout path");
  assert.equal(h.latest().allSelected, false); assert.deepEqual(h.latest().selectedIds, ["pc-gaming-audio", "keyboards"]);
  assert.equal(h.callbacks.onChoose("mice"), true); assert.equal(h.portfolio.settings.hashoutCategoryIds, null, "adding the final missing category canonicalizes All to null");
  assert.equal(h.latest().allSelected, true);
  assert.equal(h.callbacks.onAll(), true); assert.deepEqual(Array.from(h.portfolio.settings.hashoutCategoryIds), [], "All toggles to an explicit empty scope rather than an active-category fallback");
  assert.deepEqual(h.latest().selectedIds, []); assert.equal(h.latest().allSelected, false);
  assert.equal(h.callbacks.onChoose("keyboards"), true); assert.deepEqual(Array.from(h.portfolio.settings.hashoutCategoryIds), ["keyboards"], "a zero-product category can be selected for recovery");
  assert.equal(h.callbacks.onChoose("keyboards"), true); assert.deepEqual(Array.from(h.portfolio.settings.hashoutCategoryIds), [], "removing the final FFS category preserves explicit none");
  assert.equal(h.callbacks.onAll(), true); assert.equal(h.portfolio.settings.hashoutCategoryIds, null);
  const savedBefore = h.events.saves; h.context.syncCategoryNavigation();
  assert.equal(h.events.saves, savedBefore); assert.equal(h.events.create, 1, "multi-scope sync preserves the controller and never saves by itself");
  assert.equal(h.events.reorderFinished, 0, "FFS scope toggles never enter the single-category activation path");
  h.assertUnchanged(); checks += 17;
}

{
  const h = harness({ view: "roadmap", basis: "ffs", scope: ["mice"] }); h.context.syncCategoryNavigation();
  assert.equal(h.callbacks.onChoose("pc-gaming-audio"), true);
  assert.deepEqual(Array.from(h.portfolio.settings.hashoutCategoryIds), ["pc-gaming-audio", "mice"]);
  h.context.activeView = "products"; h.context.syncCategoryNavigation();
  assert.equal(h.latest().mode, "single"); assert.deepEqual(h.latest().selectedIds, ["pc-gaming-audio"]);
  h.context.activeView = "roadmap"; h.context.syncCategoryNavigation();
  assert.equal(h.latest().mode, "multiple"); assert.deepEqual(h.latest().selectedIds, ["pc-gaming-audio", "mice"], "view switches restore the same saved multi-category scope");
  h.context.portfolio.settings.hashoutCategoryIds = ["keyboards"];
  const savedBefore = h.events.saves; h.context.syncCategoryNavigation();
  assert.deepEqual(h.latest().selectedIds, ["keyboards"], "saved-view/programmatic scope application updates the actual dock from settings");
  assert.equal(h.events.saves, savedBefore); h.assertUnchanged(); checks += 4;
}

// Canvas paints may synchronize controls repeatedly. Count work and DOM updates
// must stay bounded while each independent invalidation still refreshes evidence.
{
  const h = harness();
  let calendarDay = 15;
  class ClockDate extends Date {
    constructor() { super(Date.UTC(2026, 9, calendarDay)); }
    getFullYear() { return 2026; }
    getMonth() { return 9; }
    getDate() { return calendarDay; }
  }
  h.context.Date = ClockDate;
  h.context.syncCategoryNavigation();
  const categoryCount = h.portfolio.categories.length, initialScans = h.events.scans, initialUpdates = h.events.updates.length;
  assert.equal(initialScans, categoryCount, "first synchronization counts each category once");
  for (let index = 0; index < 100; index++) h.context.syncCategoryNavigation();
  assert.equal(h.events.scans, initialScans, "100 unchanged canvas synchronizations do not rescan products");
  assert.equal(h.events.updates.length, initialUpdates, "100 unchanged canvas synchronizations do not update the component");
  const presentationOnly = (change, verify) => {
    const scans = h.events.scans, updates = h.events.updates.length;
    change(); h.context.syncCategoryNavigation(); verify(h.latest());
    assert.equal(h.events.scans, scans, "category, scope, mode and lock presentation changes reuse the same counts");
    assert.equal(h.events.updates.length, updates + 1, "a changed presentation updates the existing component once");
    checks++;
  };
  presentationOnly(() => { h.context.activeCategoryId = "mice"; h.context.board = h.portfolio.categories[1].board; }, value => assert.deepEqual(value.selectedIds, ["mice"]));
  presentationOnly(() => { h.context.activeView = "roadmap"; h.portfolio.settings.roadmapBasis = "ffs"; h.portfolio.settings.hashoutCategoryIds = null; }, value => { assert.equal(value.mode, "multiple"); assert.equal(value.allSelected, true); });
  presentationOnly(() => { h.portfolio.settings.hashoutCategoryIds = ["mice"]; }, value => assert.deepEqual(value.selectedIds, ["mice"]));
  presentationOnly(() => { h.context.pptxExportInProgress = true; }, value => assert.equal(value.disabled, true));
  presentationOnly(() => { h.context.pptxExportInProgress = false; }, value => assert.equal(value.disabled, false));
  const invalidate = (change, verify) => {
    const scans = h.events.scans;
    change(); h.context.syncCategoryNavigation();
    assert.equal(h.events.scans, scans + categoryCount, "each evidence invalidation recomputes the bounded category counts");
    verify?.(h.latest()); checks++;
  };
  const unchangedUpdates = h.events.updates.length;
  invalidate(() => { h.context.workspaceSaveRevision++; });
  assert.equal(h.events.updates.length, unchangedUpdates, "a revision with unchanged visible counts does not cause redundant component work");
  const originalCategories = [...h.portfolio.categories], pcBoard = originalCategories[0].board, mouseBoard = originalCategories[1].board, keyboardBoard = originalCategories[2].board;
  const originalPcProducts = pcBoard.products, originalKeyboardProducts = keyboardBoard.products, originalPcSettings = pcBoard.settings, originalMouseSettings = mouseBoard.settings;
  invalidate(() => { keyboardBoard.products = [...keyboardBoard.products, freeze(product("new-keyboard", "launched"))]; }, value => assert.equal(value.categories.find(category => category.id === "keyboards").count, 1, "a new product-array reference updates its count without a revision bump"));
  invalidate(() => { pcBoard.settings = { ...pcBoard.settings, catalogGroups: ["eol"] }; }, value => assert.equal(value.categories.find(category => category.id === "pc-gaming-audio").count, 0, "visibility changes invalidate counts even without a save revision"));
  const sameCountsUpdates = h.events.updates.length;
  invalidate(() => { h.portfolio.categories[0] = { ...h.portfolio.categories[0] }; });
  assert.equal(h.events.updates.length, sameCountsUpdates, "replaced category identity with equal presentation does not redraw the component");
  invalidate(() => { h.context.portfolio = { ...h.portfolio, categories: [...h.portfolio.categories] }; });
  assert.equal(h.events.updates.length, sameCountsUpdates, "a replaced portfolio invalidates evidence but skips an identical component payload");
  invalidate(() => { pcBoard.products = [...pcBoard.products, freeze({ ...product("boundary-headset", "launched"), endManufacturingDate: "2026-10-16" })]; }, value => assert.equal(value.categories.find(category => category.id === "pc-gaming-audio").count, 0));
  invalidate(() => { calendarDay = 16; }, value => assert.equal(value.categories.find(category => category.id === "pc-gaming-audio").count, 1, "local-day rollover includes newly discontinued products without a save revision"));
  invalidate(() => { mouseBoard.settings = { ...mouseBoard.settings, catalogGroups: ["all"] }; }, value => assert.equal(value.categories.find(category => category.id === "mice").count, 2));
  invalidate(() => { mouseBoard.settings = { ...mouseBoard.settings, catalogExcludedGroups: ["eol"] }; }, value => assert.equal(value.categories.find(category => category.id === "mice").count, 1, "exclusion-only preference changes invalidate counts without a save revision or positive-group change"));
  const stableScans = h.events.scans, stableUpdates = h.events.updates.length;
  for (let index = 0; index < 100; index++) h.context.syncCategoryNavigation();
  assert.equal(h.events.scans, stableScans); assert.equal(h.events.updates.length, stableUpdates, "the refreshed cache also remains stable across repeated paints");
  assert.equal(h.events.create, 1, "invalidation never recreates the component");
  pcBoard.products = originalPcProducts; keyboardBoard.products = originalKeyboardProducts; pcBoard.settings = originalPcSettings; mouseBoard.settings = originalMouseSettings;
  h.portfolio.categories = originalCategories; h.context.portfolio = h.portfolio;
  h.assertUnchanged(); checks += 5;
}

// Run the entire shell module, rather than extracting just its menus. The
// category dropdown no longer exists, so initialization, settings and readiness
// must all use the actual published workspace snapshot.
{
  const workspaceSource = await readFile(new URL("../../public/js/workspace-ui.js", import.meta.url), "utf8");
  const readyBinding = appSource.match(/^window\.addEventListener\("portfolio:ui-ready", \(\) => \{[^]*?^\}\);/m)?.[0]
    || appSource.match(/^window\.addEventListener\("portfolio:ui-ready",[^\n]*\);/m)?.[0];
  assert.ok(readyBinding, "execute the application's actual UI-readiness listener");
  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
    dispatchEvent(event) { event.target ||= this; for (const handler of this.listeners.get(event.type) || []) handler.call(this, event); return true; }
  }
  let document;
  class Element extends Events {
    constructor(id = "") {
      super(); this.id = id; this.dataset = {}; this.attributes = {}; this.style = {}; this.value = ""; this.textContent = ""; this.disabled = false; this.inert = false; this.isConnected = true;
      const classes = new Set();
      this.classList = { add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)), contains: value => classes.has(value),
        toggle(value, enabled = !classes.has(value)) { if (enabled) classes.add(value); else classes.delete(value); } };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    closest(selector) { return selector === "[data-settings-tab]" && this.dataset.settingsTab || selector === ".hidden" && this.classList.contains("hidden") ? this : null; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    contains(other) { return other === this; }
    getClientRects() { return [{}]; }
    focus() { document.activeElement = this; }
    click() { this.dispatchEvent({ type: "click", target: this }); }
  }
  const elements = new Map(), get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const tabs = ["display", "timeline", "data"].map(name => Object.assign(get(`tab-${name}`), { dataset: { settingsTab: name } }));
  const panels = ["display", "timeline", "data"].map(name => Object.assign(get(`panel-${name}`), { dataset: { settingsPanel: name } }));
  const app = get("app-shell"), header = get("topbar"), controls = get("workspace-controls"), observed = [], publications = [];
  const window = new Events();
  document = new Events();
  Object.assign(document, { activeElement: get("workspaceSettingsButton"),
    getElementById: id => id === "categorySelect" ? null : get(id),
    querySelector: selector => ({ ".app-shell": app, ".topbar": header, ".workspace-controls": controls })[selector] || null,
    querySelectorAll: selector => selector === "[data-settings-tab]" ? tabs : selector === "[data-settings-panel]" ? panels : [],
  });
  const portfolio = fixture(); portfolio.settings.roadmapBasis = "ffs";
  get("workspaceSettingsDialog").classList.add("hidden");
  get("categoryContext").textContent = "Hashout roadmap";
  get("roadmapStart").value = "2026-01"; get("roadmapEnd").value = "2030-12";
  const context = {
    window, document, portfolio, board: portfolio.categories[0].board, activeCategoryId: "pc-gaming-audio", activeView: "roadmap", roadmapDetailsOpen: false,
    selectedId: "headset", hashoutSelectedKey: null, hashoutView: {}, PortfolioHashoutView: {},
    workspaceSaveRevision: 9, lastWorkspaceRenderSignature: "", searchQuery: "", roadmapSearchQuery: "",
    PortfolioModel: globalThis.PortfolioModel, PortfolioSearch: globalThis.PortfolioSearch, PortfolioHashoutLayout: globalThis.PortfolioHashoutLayout,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe(target, options) { assert.ok(target instanceof Element, "MutationObserver must never observe a removed/null category dropdown"); observed.push({ target, options, callback: this.callback }); } },
  };
  vm.createContext(context);
  vm.runInContext(["publishWorkspaceState", "isFfsRoadmap", "hasDedicatedHashoutView", "hashoutCategoryScope", "hashoutSelectionEntry", "portfolioForSearch", "selectedProduct", "visibleProducts", "visibleRoadmapProducts"].map(appFunction).join("\n"), context);
  window.addEventListener("portfolio:render", event => publications.push(clone(event.detail)));
  context.publishWorkspaceState();
  assert.equal(publications.length, 1, "the app may render before the shell listener initializes");
  vm.runInContext(readyBinding, context);
  vm.runInContext(workspaceSource, context, { filename: "workspace-ui.js" });
  assert.ok(window.PortfolioWorkspaceUI, "the complete dropdown-free workspace shell initializes");
  assert.deepEqual(observed.map(observer => observer.target.id), ["editSelected"], "the shell observes only its real edit control");
  assert.equal(publications.length, 2, "UI readiness republishes an unchanged preexisting snapshot to its new listener");
  assert.equal(get("settingsActiveCategory").textContent, "PC Gaming Audio", "FFS settings use the actual active board, not the Hashout header label");
  assert.equal(get("workspaceSummary").textContent, "3 of 5 products");
  assert.equal(get("timelineRangeSummary").textContent, "2026–2030");
  get("workspaceSettingsButton").click();
  assert.equal(app.inert, true); assert.equal(get("workspaceSettingsDialog").classList.contains("hidden"), false);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(get("settingsActiveCategory").textContent, "PC Gaming Audio", "opening a tab retains snapshot-backed category identity");
  tabs[1].click();
  assert.equal(tabs[1].getAttribute("aria-selected"), "true"); assert.equal(panels[0].classList.contains("hidden"), true);
  assert.equal(get("settingsActiveCategory").textContent, "PC Gaming Audio");
  context.activeCategoryId = "mice"; context.board = portfolio.categories[1].board; context.selectedId = "eol-mouse";
  context.publishWorkspaceState();
  assert.equal(get("settingsActiveCategory").textContent, "Mice", "a category-switch render refreshes the open settings scope");
  tabs[2].click(); assert.equal(get("settingsActiveCategory").textContent, "Mice", "activating another settings tab does not replace the real board with the FFS header label");
  window.PortfolioWorkspaceUI.refresh(); assert.equal(get("settingsActiveCategory").textContent, "Mice", "manual refresh reuses the latest snapshot");
  get("settingsActiveCategory").textContent = "Stale label";
  const readyBefore = publications.length;
  window.dispatchEvent(new context.CustomEvent("portfolio:ui-ready"));
  assert.equal(publications.length, readyBefore + 1); assert.equal(get("settingsActiveCategory").textContent, "Mice", "readiness always refreshes the shell even when the app state signature is unchanged");
  get("editSelected").disabled = true; observed[0].callback(); assert.equal(get("quickEditSelected").disabled, true);
  context.activeView = "products"; context.publishWorkspaceState();
  assert.equal(get("workspaceSummary").textContent, "1 of 2 products", "shell counts remain category-local in Products");
  window.PortfolioWorkspaceUI.closeSettings(); assert.equal(app.inert, false);
  assert.equal(get("workspaceSettingsDialog").classList.contains("hidden"), true);
  context.activeCategoryId = "keyboards"; context.board = portfolio.categories[2].board; context.selectedId = null; context.publishWorkspaceState();
  assert.equal(get("workspaceEmptyTitle").textContent, "This category is empty");
  assert.equal(header.classList.contains("hidden"), false); assert.equal(controls.classList.contains("hidden"), false, "an empty category keeps navigation available for recovery");
  checks += 16;
}

console.log(`Category navigation workspace checks passed: ${checks} actual single-category and FFS scope cases, filtered counts, guards, same-component sync, empty/All persistence, selection cleanup, complete dropdown-free shell initialization and unchanged product evidence.`);
