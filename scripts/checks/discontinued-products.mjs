import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../../public/js/date-precision.js");
await import("../../public/js/portfolio-model.js");
await import("../../public/js/portfolio-search.js");
await import("../../public/js/pptx-pagination.js");
await import("../../public/js/saved-views.js");

const model = globalThis.PortfolioModel;
const plain = value => JSON.parse(JSON.stringify(value));
const today = new Date(2026, 9, 15, 0, 0, 0);
const eom = value => ({ endManufacturingDate: value });
const quarter = (year, q, patch = {}) => {
  const period = globalThis.PortfolioDatePrecision.parseQuarter(`Q${q} ${year}`);
  return { endManufacturingDate: period.start, plc: { fields: { endManufacturingDate: { value: period.start, period, ...patch } } } };
};
const cases = [
  [eom("2026-10-14"), today, true, "past"],
  [eom("2026-10-15"), today, true, "today is inclusive"],
  [eom("2026-10-16"), today, false, "future"],
  ...["", "TBD", "2026-10", "2026-02-30", "2025-02-29", "10/14/2026", "FY26 Q3", "Q3 2026", "2026-10-14junk"].map(value => [eom(value), today, false, `unknown/invalid ${value}`]),
  [eom("2024-02-29"), today, true, "valid leap day"],
  [quarter(2026, 3), new Date(2026, 8, 29, 23, 59), false, "quarter not finished"],
  [quarter(2026, 3), new Date(2026, 8, 30), true, "quarter last day inclusive"],
  [quarter(2026, 4), today, false, "quarter placement day does not end quarter"],
  [quarter(2026, 4), new Date(2026, 11, 31), true, "Q4 last day"],
  [quarter(2026, 4, { period: { precision: "quarter", basis: "fiscal", year: 2026, quarter: 4 } }), today, false, "fiscal precision unknown"],
  [quarter(2026, 4, { period: { precision: "quarter", basis: "calendar", year: 2026, quarter: 4, end: "2026-10-01" } }), today, false, "malformed matching precision not treated as exact anchor"],
  [quarter(2026, 4, { supersededAt: "2026-10-12T00:00:00Z" }), today, true, "superseded quarter leaves saved exact date authoritative"],
  [quarter(2026, 4, { value: "2025-10-01" }), today, true, "stale quarter cannot override exact date"],
  [{ roadmap: { endMonth: "2025-01" }, statusType: "sunsetting" }, today, false, "roadmap and manual status are not EOM"],
  [{ variantGroups: [{ items: [eom("2025-01-01")] }] }, today, false, "a color variant EOM cannot discontinue whole family"],
  [eom("2026-10-14"), new Date(NaN), false, "invalid clock safe"],
];
for (const [product, date, expected, label] of cases) {
  const before = JSON.stringify(product);
  assert.equal(model.isDiscontinued(product, date), expected, label);
  assert.equal(JSON.stringify(product), before, `${label} preserves every field`);
}

// A client-local calendar must win in either direction at a UTC date boundary.
const realDate = Date;
class LocalBoundaryDate extends realDate {
  getFullYear() { return 2026; }
  getMonth() { return 9; }
  getDate() { return 14; }
}
assert.equal(model.isDiscontinued(eom("2026-10-15"), new LocalBoundaryDate("2026-10-15T06:59:59Z")), false);
class AheadBoundaryDate extends realDate { getFullYear() { return 2026; } getMonth() { return 9; } getDate() { return 16; } }
assert.equal(model.isDiscontinued(eom("2026-10-16"), new AheadBoundaryDate("2026-10-15T10:00:00Z")), true);

const products = [
  { id: "ended", name: "Cloud old", statusType: "new", statusLabel: "User label", endManufacturingDate: "2000-01-01", imageAssetId: "saved-main", featuredVariantId: "black", roadmap: { family: "Cloud", endMonth: "2000-01", status: "launched" } },
  { id: "live", name: "Cloud future", endManufacturingDate: "9999-12-31", roadmap: { family: "Cloud", status: "launched" } },
  { id: "unknown", name: "Cloud unknown", endManufacturingDate: "", roadmap: { family: "Cloud", status: "launched" } },
];
products.forEach(product => { product.laneId = "main"; });
products.forEach(Object.freeze); Object.freeze(products);
assert.equal(model.catalogProducts(products, {}, today), products, "older board defaults show all without a write");
assert.equal(model.catalogProducts(products, { hideDiscontinued: "true" }, today), products, "only boolean true hides");
assert.deepEqual(model.catalogProducts(products, { hideDiscontinued: true }, today).map(p => p.id), ["live", "unknown"]);

const source = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const fn = name => {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, `test actual application ${name}`); return match[0];
};
const board = { lanes: [{ id: "main", label: "Main" }], products, settings: { hideDiscontinued: true, showSkus: true } };
const dataBefore = JSON.stringify(board);
const sandbox = {
  PortfolioModel: model, PortfolioSearch: globalThis.PortfolioSearch, board, searchQuery: "", roadmapSearchQuery: "",
  standardizedStatus: type => ({ label: type === "new" ? "New Product" : "" }), UI_PALETTE: { charcoal600: "#333538" },
  PPTXPagination: globalThis.PPTXPagination, PPTXEditable: { FONT_FACE: "Existing font" }, UI_FONT_FACE: "Existing font",
  isFfsRoadmap: () => false,
  activeView: "products", portfolio: { categories: [{ id: "audio", board }] },
  categoryDefinition: id => ({ id }), ensureBoardSchema: target => { target.settings ||= {}; return target; },
  productCardLayout: () => ({ cardHeight: 552, laneHeight: 622 }),
  CARD_WIDTH: 246, CARD_GAP: 10, GUTTER: 18, SIDE_PADDING: 40, LANE_TOP: 34,
  inferFamily: () => "Cloud",
  roadmapGroupsForProducts: rows => [{ family: "Cloud", products: rows }],
  paginateRoadmapGroupsForPptx: globalThis.PPTXPagination.paginateRoadmapGroups,
};
vm.createContext(sandbox);
vm.runInContext(["visibleProducts", "visibleRoadmapProducts", "portfolioForSearch", "productPresentation", "productPagesForPptx", "buildPptxExportPlan"].map(fn).join("\n"), sandbox);
assert.deepEqual(Array.from(sandbox.visibleProducts(), p => p.id), ["live", "unknown"]);
sandbox.searchQuery = "old";
assert.equal(sandbox.visibleProducts().length, 0, "Products search cannot reintroduce hidden cards");
sandbox.roadmapSearchQuery = "old";
assert.deepEqual(Array.from(sandbox.visibleRoadmapProducts(), p => p.id), [], "Roadmap search respects the same discontinued filter");
sandbox.searchQuery = ""; sandbox.roadmapSearchQuery = "";
assert.equal(sandbox.visibleRoadmapProducts().length, 2);
assert.equal(globalThis.PortfolioSearch.search(sandbox.portfolioForSearch(), "old").total, 0, "all-category catalog lookup also omits hidden products");
sandbox.activeView = "roadmap";
assert.notEqual(sandbox.portfolioForSearch(), sandbox.portfolio, "Roadmap search uses an immutable filtered projection");
assert.equal(globalThis.PortfolioSearch.search(sandbox.portfolioForSearch(), "old").total, 0);
sandbox.activeView = "products";
assert.equal(sandbox.productPresentation(products[0]).primaryLabel, "Discontinued", "derived top banner overrides New without replacing it in data");
assert.equal(products[0].statusType, "new"); assert.equal(products[0].statusLabel, "User label");
const category = { id: "audio", board };
const productPlan = sandbox.buildPptxExportPlan("products", [category]);
assert.deepEqual(Array.from(productPlan).flatMap(p => Array.from(p.page.rows).flatMap(row => Array.from(row.products, p => p.id))), ["live", "unknown"]);
const combined = sandbox.buildPptxExportPlan("both", [category]);
assert.deepEqual(Array.from(combined.filter(p => p.kind === "roadmap")).flatMap(p => Array.from(p.groups).flatMap(g => Array.from(g.products, p => p.id))), ["live", "unknown"]);
const allHidden = { id: "hidden", board: { ...board, products: [products[0]] } };
assert.equal(sandbox.buildPptxExportPlan("products", [allHidden]).length, 0, "all-hidden Products produces no phantom product slide or [0] crash");
assert.equal(sandbox.buildPptxExportPlan("both", [allHidden]).length, 0, "all-hidden category contributes no phantom product or Roadmap slides");
assert.equal(sandbox.buildPptxExportPlan("roadmap", [allHidden]).length, 0);
assert.equal(JSON.stringify(board), dataBefore, "rendering, searching, planning and banner derivation change no business facts, image IDs, defaults, clocks or settings");
let emptyDecks = 0;
Object.assign(sandbox, {
  PortfolioTheme: { fontsReady: async () => true },
  PPTXEditable: { FONT_FACE: "Existing font", fontsReady: async () => true },
  stopProductCardDrag() {}, closePopupMenus() {}, renderActiveView() {},
  PptxGenJS: class { constructor() { emptyDecks++; } },
});
const searchPortfolio = sandbox.portfolio;
sandbox.portfolio = { categories: [allHidden] };
vm.runInContext(fn("exportPptx"), sandbox);
await assert.rejects(sandbox.exportPptx("products", [allHidden.id]), /No visible products to export/);
assert.equal(emptyDecks, 0, "an all-hidden product export stops before creating or downloading an empty deck");
sandbox.portfolio = searchPortfolio;

// Execute the real PNG draw path with canvas delivery replaced, capturing the
// cards selected by its real board renderer rather than inspecting a regex.
const drawSource = fn("drawBoardTo");
const painted = [];
Object.assign(sandbox, {
  sortedLanes: () => board.lanes, roundRect() {}, drawProductBoardExportBackground() {},
  drawCard: (_context, product) => painted.push(product.id),
  cardXForDisplayIndex: (_rows, index) => index * 256,
  renderedCards: [], renderedVariantOverflow: [], renderedHeroVariantRegions: [], renderedInfoButtons: [],
  UI_FONT_FACE: "Existing font", productLayoutEditing: false,
});
vm.runInContext(drawSource, sandbox);
const context = { clearRect() {} };
const dimensions = { width: 1000, height: 650, includeViewer: false, layout: { cardHeight: 552, laneHeight: 622 }, laneRows: [{ lane: board.lanes[0], top: 34, contentHeight: 552 }] };
sandbox.drawBoardTo(context, dimensions, false, true);
assert.deepEqual(painted, ["live", "unknown"], "actual PNG board renderer paints only visible cards");
sandbox.board = allHidden.board; painted.length = 0;
sandbox.drawBoardTo(context, dimensions, false, true);
assert.equal(painted.length, 0, "all-hidden PNG paints no product cards");
sandbox.board = board;
assert.match(fn("exportPng"), /if \(isProducts\) drawBoardTo\(/);
assert.match(fn("visibleRoadmapProducts"), /catalogProducts/);

const saved = globalThis.PPCSavedViews.sanitizePreferences("portfolio", { view: "products", activeCategoryId: "audio", display: { hideDiscontinued: true, privateKey: "never" } });
assert.deepEqual(saved, { view: "products", activeCategoryId: "audio", display: { hideDiscontinued: true } });
assert.equal(globalThis.PPCSavedViews.sanitizePreferences("portfolio", { display: { hideDiscontinued: "true" } }).display.hideDiscontinued, undefined);
assert.equal(globalThis.PPCSavedViews.sanitizePreferences("portfolio", { display: {} }).display.hideDiscontinued, undefined, "older saved views remain compatible");
const capture = source.match(/^  captureView\(\) \{[^]*?^  \},/m)?.[0];
const apply = source.match(/^  applyView\(value\) \{[^]*?^  \},/m)?.[0];
assert.ok(capture && apply);
const savedBoard = { ...board, settings: { ...board.settings, roadmap: { startMonth: "2026-01", endMonth: "2030-12" } } };
const viewSandbox = {
  PortfolioModel: model, PPCSavedViews: globalThis.PPCSavedViews,
  portfolio: { settings: {}, categories: [{ id: "audio", board: savedBoard }, { id: "other", board: { settings: { hideDiscontinued: false } } }] },
  board: savedBoard, activeCategoryId: "audio", activeView: "products", searchQuery: "", roadmapSearchQuery: "", roadmapDetailsOpen: false,
  zoom: 1, roadmapMonthWidth: 20, ROADMAP_DEFAULT_MONTH_WIDTH: 20,
  workspaceOpening: false, packageOperationInProgress: false, pptxExportInProgress: false, productLayoutEditing: false,
  hashoutCategoryScope: () => null, hasDedicatedHashoutView: () => false,
  activateCategory() {}, resetHashoutView() {}, setView() {}, clearHiddenCatalogSelection() {}, scheduleSave() {}, syncControls() {}, renderActiveView() {},
  setProductZoom() {}, setRoadmapZoom() {}, document: { querySelector: () => null }, $: () => null,
};
vm.createContext(viewSandbox);
vm.runInContext(fn("catalogFilterCategories") + `\nvar adapter = { ${capture} ${apply} };`, viewSandbox);
const captured = plain(viewSandbox.adapter.captureView());
assert.equal(captured.display.hideDiscontinued, true);
viewSandbox.adapter.applyView({ view: "products", activeCategoryId: "audio", display: { hideDiscontinued: false } });
assert.equal(savedBoard.settings.hideDiscontinued, false);
viewSandbox.adapter.applyView({ view: "products", activeCategoryId: "audio", display: { hideDiscontinued: true } });
assert.equal(savedBoard.settings.hideDiscontinued, true);
viewSandbox.adapter.applyView({ view: "products", activeCategoryId: "audio", display: {} });
assert.equal(savedBoard.settings.hideDiscontinued, true, "opening an older saved view does not change the current choice");
assert.equal(viewSandbox.portfolio.categories[1].board.settings.hideDiscontinued, false, "saved view applies to its active category only");
assert.equal(JSON.stringify(products), JSON.stringify(JSON.parse(dataBefore).products));
const controls = new Map([["#hideDiscontinued", {}]]);
const updateBoard = update => update(board);
const selectionSandbox = { $: id => controls.get(id), updateBoard, board, PortfolioModel: model, activeView: "products", selectedId: "ended", viewerInfoProductId: "ended", productLayoutEditing: false, packageOperationInProgress: false, pptxExportInProgress: false,
  stopProductCardDrag() {}, renderInspector() {}, closeViewerInfo() { selectionSandbox.viewerInfoProductId = null; } };
vm.createContext(selectionSandbox);
vm.runInContext(fn("clearHiddenCatalogSelection") + fn("setCatalogHideDiscontinued") + source.match(/^\$\("#hideDiscontinued"\)\.onchange = [^\n]+/m)[0], selectionSandbox);
const otherCategory = { settings: { hideDiscontinued: false } };
controls.get("#hideDiscontinued").onchange({ target: { checked: true } });
assert.equal(selectionSandbox.selectedId, null, "hiding a selected discontinued card clears its selection toolbar");
assert.equal(selectionSandbox.viewerInfoProductId, null, "hiding a discontinued card closes its expanded details");
selectionSandbox.selectedId = "live";
controls.get("#hideDiscontinued").onchange({ target: { checked: true } });
assert.equal(selectionSandbox.selectedId, "live", "still-visible selection remains");
selectionSandbox.activeView = "roadmap"; selectionSandbox.selectedId = "ended";
controls.get("#hideDiscontinued").onchange({ target: { checked: true } });
assert.equal(selectionSandbox.selectedId, null, "Roadmap selection clears when the shared filter excludes it");
controls.get("#hideDiscontinued").onchange({ target: { checked: false } });
assert.equal(board.settings.hideDiscontinued, false); assert.equal(otherCategory.settings.hideDiscontinued, false);
assert.equal(JSON.stringify(products), JSON.stringify(JSON.parse(dataBefore).products), "toggle updates presentation preference only");
assert.match(source, /display\.hideDiscontinued === "boolean"\) board\.settings\.hideDiscontinued = display\.hideDiscontinued/);
assert.match(source, /hideDiscontinued: board\.settings\.hideDiscontinued/);
assert.match(source, /hideDiscontinued: false, \.\.\.target\.settings/);
assert.match(source, /confirmPptxExportButton\.disabled = [^\n]+!plan\.length/);
assert.match(source, /if \(!exportPlan\.length\) throw new Error\("No visible products/);
const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
assert.match(html, /id="hideDiscontinued" type="checkbox"/);
assert.match(html, /filter Products, both Roadmap views, and their exports/);
console.log(`Discontinued Products checks passed: ${cases.length} date cases, local-day boundaries, immutable banner/catalog/search, shared Roadmap filtering and exports, all-hidden PPTX, category setting and saved views.`);
