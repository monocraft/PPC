import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

await import("../../public/js/pptx-pagination.js");
await import("../../public/js/pptx-editable.js");

const {
  MAX_PRODUCTS_PER_SLIDE,
  selectExportCategories,
  paginateRoadmapGroups,
} = globalThis.PPTXPagination;

assert.equal(MAX_PRODUCTS_PER_SLIDE, 22);

const expectedPageSizes = new Map([
  [0, [0]],
  [1, [1]],
  [22, [22]],
  [23, [22, 1]],
  [44, [22, 22]],
  [45, [22, 22, 1]],
]);

for (const [productCount, expected] of expectedPageSizes) {
  const products = Array.from({ length: productCount }, (_, index) => ({ id: `p-${index + 1}` }));
  const pages = paginateRoadmapGroups([{ family: "Boundary", products }]);
  const pageSizes = pages.map((page) => page.reduce((sum, group) => sum + group.products.length, 0));
  assert.deepEqual(pageSizes, expected, `Unexpected page sizes for ${productCount} products.`);
  assert.deepEqual(
    pages.flatMap((page) => page.flatMap((group) => group.products.map((product) => product.id))),
    products.map((product) => product.id),
  );
  assert.ok(pageSizes.every((size) => size <= MAX_PRODUCTS_PER_SLIDE));
}

const longFamilyProducts = Array.from({ length: 30 }, (_, index) => ({ id: `long-${index + 1}` }));
const secondFamilyProducts = Array.from({ length: 15 }, (_, index) => ({ id: `second-${index + 1}` }));
const sourceGroups = [
  { family: "Long Family", products: longFamilyProducts },
  { family: "Second Family", products: secondFamilyProducts },
];
const roadmapPages = paginateRoadmapGroups(sourceGroups);

assert.deepEqual(
  roadmapPages.map((page) => page.reduce((sum, group) => sum + group.products.length, 0)),
  [22, 8, 15],
);
assert.deepEqual(
  roadmapPages.map((page) => page.map((group) => `${group.family}:${group.continued}:${group.products.length}`)),
  [
    ["Long Family:false:22"],
    ["Long Family:true:8"],
    ["Second Family:false:15"],
  ],
);
assert.deepEqual(
  roadmapPages.flatMap((page) => page.flatMap((group) => group.products.map((product) => product.id))),
  [...longFamilyProducts, ...secondFamilyProducts].map((product) => product.id),
);
assert.equal(sourceGroups[0].continued, undefined);
assert.equal(sourceGroups[0].products.length, 30);
assert.deepEqual(paginateRoadmapGroups([]), [[]]);

const intactFamilies = paginateRoadmapGroups([
  { family: "First", products: Array.from({ length: 18 }, (_, index) => ({ id: `first-${index}` })) },
  { family: "Second", products: Array.from({ length: 10 }, (_, index) => ({ id: `second-${index}` })) },
]);
assert.deepEqual(
  intactFamilies.map((page) => page.map((group) => `${group.family}:${group.continued}:${group.products.length}`)),
  [["First:false:18"], ["Second:false:10"]],
);

const exportCategories = [
  { id: "alpha", name: "Audio 2", board: { lanes: [{ id: "main", label: "Main", order: 0 }], products: [...longFamilyProducts.map((product, order) => ({ ...product, laneId: "main", order, family: "Long Family", roadmap: { family: "Long Family" } })), ...secondFamilyProducts.map((product, index) => ({ ...product, laneId: "main", order: longFamilyProducts.length + index, family: "Second Family", roadmap: { family: "Second Family" } }))] } },
  { id: "beta", name: "Console <limited>", board: { lanes: [{ id: "main", label: "Main", order: 0 }], products: [{ id: "console-1", laneId: "main", order: 0, family: "Cloud", roadmap: { family: "Cloud" } }, { id: "console-2", laneId: "main", order: 1, family: "Cloud", roadmap: { family: "Cloud" } }] } },
  { id: "empty", name: "Empty", board: { lanes: [{ id: "main", label: "Main", order: 0 }], products: [] } },
  { id: "unavailable", name: "No board" },
];
const sourceCategoriesBefore = JSON.stringify(exportCategories);
assert.deepEqual(selectExportCategories(exportCategories).map((category) => category.id), ["alpha", "beta", "empty"], "the default includes all categories with a board");
assert.deepEqual(selectExportCategories(exportCategories, ["beta", "alpha", "stale", "alpha"]).map((category) => category.id), ["alpha", "beta"], "selection retains portfolio order without duplicate or stale categories");
assert.deepEqual(selectExportCategories(exportCategories, []), [], "clearing every checkbox selects no categories");
assert.deepEqual(selectExportCategories(exportCategories, ["unavailable"]), [], "a category without a board cannot be exported");
assert.deepEqual(selectExportCategories(undefined), []);
assert.equal(selectExportCategories(exportCategories, ["alpha"])[0], exportCategories[0], "selection does not replace category records");
assert.equal(JSON.stringify(exportCategories), sourceCategoriesBefore);

// Use the real application selection, summary, planning, and slide composer.
// The adapters replace DOM and file/image delivery, not export decisions.
const appSource = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");

// Exercise the real date geometry and roadmap renderer with only canvas
// delivery adapted. The background must omit product bars before native
// PowerPoint shapes are added, and exporting must restore the active workspace.
const monthStart = appSource.indexOf("function monthIndex(");
const monthEnd = appSource.indexOf("function monthString(", monthStart);
const rectStart = appSource.indexOf("function roadmapProductBarRect(");
const drawEnd = appSource.indexOf("function renderRoadmapFor(", rectStart);
const rendererStart = appSource.indexOf("async function renderCategoryRoadmapImageForPptx(");
const rendererEnd = appSource.indexOf("function addPptxPortfolioSlide(", rendererStart);
assert.ok(monthStart >= 0 && monthEnd > monthStart && rectStart >= 0 && drawEnd > rectStart && rendererStart >= 0 && rendererEnd > rendererStart);
const paintedLabels = [];
const paintedBars = [];
const backgroundRenderCalls = [];
let failCanvasEncoding = false;
const recordingContext = new Proxy({
  measureText: (text) => ({ width: String(text).length * 6 }),
  fillText: (text) => paintedLabels.push(text),
}, { get: (target, property) => property in target ? target[property] : () => {} });
const activeBoard = { id: "active", settings: { roadmap: { categoryLabel: "Active category" } } };
const rendererSandbox = {
  console, Date, Math,
  ROADMAP_LEFT_WIDTH: 190, ROADMAP_HEADER_HEIGHT: 88, ROADMAP_GROUP_HEADER_HEIGHT: 28,
  ROADMAP_ROW_HEIGHT: 38, ROADMAP_MIN_MONTH_WIDTH: 8, roadmapMonthWidth: 20,
  activeCategoryId: "active", board: activeBoard, selectedId: "selected",
  searchQuery: "portfolio search", roadmapSearchQuery: "roadmap search", inspectorOpen: true,
  viewerInfoOpen: true, viewerInfoProductId: "viewer product", viewerInfoProgress: .7,
  portfolio: { settings: { showRoadmapMsrp: false } },
  UI_PALETTE: { charcoal800: "#171717", inkBlack: "#000000", silver: "#CCCCCC", starDust: "#AAAAAA", foggy: "#777777", whiteSmoke: "#FFFFFF", greyOlive: "#888888", midGrey: "#999999", gunmetal: "#345678", amaranth: "#E85270" },
  roadmapHitRegions: new Map(),
  effectiveRoadmap: (product) => product.roadmap,
  roadmapStatusColor: (product) => product.statusType === "embargo" ? "#AF3954" : "#96C6BA",
  contrastTextColor: () => "#171717",
  roadmapProductBarLabel: (product) => product.name.toUpperCase(),
  categoryDefinition: (id) => ({ id }),
  ensureBoardSchema: (targetBoard) => { targetBoard.normalized = true; return targetBoard; },
  drawFixedVerticalRoadmapLabel() {},
  truncate: (text) => text, roadmapSpanLabel: (count) => `${count} months`,
  monthStringFromDate: () => "2040-01",
  roundRect: (...args) => paintedBars.push(args),
  document: {
    createElement: () => ({
      getContext: () => recordingContext,
      toDataURL: () => { if (failCanvasEncoding) throw new Error("Canvas encoding failed"); return "roadmap-background"; },
    }),
  },
};
vm.createContext(rendererSandbox);
vm.runInContext(appSource.slice(monthStart, monthEnd) + appSource.slice(rectStart, drawEnd) + appSource.slice(rendererStart, rendererEnd), rendererSandbox);
rendererSandbox.roadmapRange = () => {
  const settings = rendererSandbox.board.settings.roadmap;
  const start = rendererSandbox.monthIndex(settings.startMonth);
  const end = rendererSandbox.monthIndex(settings.endMonth);
  return { start, end, count: end - start + 1 };
};
rendererSandbox.roadmapDimensions = (groups) => {
  const range = rendererSandbox.roadmapRange();
  const rowsHeight = groups.reduce((total, group) => total + 28 + group.products.length * 38, 0);
  return { width: 190 + range.count * rendererSandbox.roadmapMonthWidth + 24, height: 88 + Math.max(156, rowsHeight + 24), range, groups };
};
const oneYear = { start: rendererSandbox.monthIndex("2026-01"), end: rendererSandbox.monthIndex("2026-12"), count: 12 };
const barProduct = (startMonth, endMonth) => ({ roadmap: { startMonth, endMonth } });
const geometryCases = [
  ["normal lifecycle", barProduct("2026-01", "2026-03"), { x: 192, y: 93, width: 56, height: 28 }],
  ["left clipped lifecycle", barProduct("2025-12", "2026-02"), { x: 191, y: 93, width: 37, height: 28 }],
  ["right clipped lifecycle", barProduct("2026-11", "2027-02"), { x: 392, y: 93, width: 37, height: 28 }],
  ["whole timeline lifecycle", barProduct("2025-01", "2027-12"), { x: 191, y: 93, width: 238, height: 28 }],
  ["single month lifecycle", barProduct("2026-12", "2026-12"), { x: 412, y: 93, width: 16, height: 28 }],
];
for (const [description, product, expected] of geometryCases) {
  assert.deepEqual(structuredClone(rendererSandbox.roadmapProductBarRect(product, oneYear, 88)), expected, description);
}
for (const [start, end] of [["2025-01", "2025-12"], ["2027-01", "2027-12"], ["2026-05", "2026-04"], ["", "2026-04"], ["2026-05", "invalid"]]) {
  assert.equal(rendererSandbox.roadmapProductBarRect(barProduct(start, end), oneYear, 88), null, "missing, invalid, inverted, and fully out-of-range products emit no misleading timeline shape");
}
rendererSandbox.roadmapMonthWidth = 8;
const customRange = { start: rendererSandbox.monthIndex("2026-05"), end: rendererSandbox.monthIndex("2026-06"), count: 2 };
assert.deepEqual(structuredClone(rendererSandbox.roadmapProductBarRect(barProduct("2026-06", "2026-06"), customRange, 200)), { x: 200, y: 205, width: 4, height: 28 }, "short products in a custom narrow range retain the minimum visible bar");
rendererSandbox.roadmapMonthWidth = 20;
const renderProducts = [
  { id: "normal", name: "Released Product", roadmap: { startMonth: "2026-01", endMonth: "2026-03", status: "released" } },
  { id: "concept", name: "Concept Product", roadmap: { startMonth: "2025-12", endMonth: "2026-02", status: "concept" } },
  { id: "outside", name: "Outside Product", roadmap: { startMonth: "2025-01", endMonth: "2025-12", status: "released" } },
  { id: "embargo", name: "Embargo Product", statusType: "embargo", roadmap: { startMonth: "2026-11", endMonth: "2027-02", status: "embargo" } },
];
const renderCategory = { id: "render-category", board: { products: renderProducts, settings: { roadmap: { startMonth: "2026-01", endMonth: "2026-12", categoryLabel: "Test category" } } } };
const renderGroups = [{ family: "Test family", products: renderProducts }];
const categoryBeforeRender = JSON.stringify(renderCategory);
const originalDraw = rendererSandbox.drawRoadmapTo;
rendererSandbox.drawRoadmapTo = (...args) => {
  backgroundRenderCalls.push({ includeSelection: args[4], exportMode: args[5], includeProducts: args[6] });
  return originalDraw(...args);
};
const stateProperties = ["activeCategoryId", "board", "selectedId", "searchQuery", "roadmapSearchQuery", "inspectorOpen", "viewerInfoOpen", "viewerInfoProductId", "viewerInfoProgress", "roadmapMonthWidth"];
const stateBeforeRender = new Map(stateProperties.map((property) => [property, rendererSandbox[property]]));
const renderedRoadmap = await rendererSandbox.renderCategoryRoadmapImageForPptx(renderCategory, renderGroups);
assert.deepEqual(backgroundRenderCalls, [{ includeSelection: false, exportMode: true, includeProducts: false }], "roadmap background export explicitly excludes product bars and selection");
assert.equal(paintedBars.length, 0, "the real canvas background contains no baked-in product rectangles");
assert.ok(renderProducts.every((product) => !paintedLabels.includes(product.name.toUpperCase())), "product names are omitted from the real canvas background");
assert.deepEqual(Array.from(renderedRoadmap.products, (product) => product.id), ["normal", "concept", "embargo"], "the renderer creates one overlay per visible product and omits dates outside the export range");
assert.deepEqual(Array.from(renderedRoadmap.products, (product) => product.label), ["RELEASED PRODUCT", "CONCEPT PRODUCT", "EMBARGO PRODUCT"]);
assert.equal(renderedRoadmap.products[1].concept, true);
assert.equal(renderedRoadmap.products[1].lineColor, "#999999");
assert.equal(renderedRoadmap.products[2].lineColor, "#E85270", "embargo outline colors remain distinct");
assert.equal(renderedRoadmap.products[0].y, 121);
assert.equal(renderedRoadmap.products[2].y, 235, "out-of-range rows retain their place in the background layout");
assert.equal(JSON.stringify(renderCategory), categoryBeforeRender, "export normalization leaves the saved category untouched");
for (const property of stateProperties) assert.equal(rendererSandbox[property], stateBeforeRender.get(property), `successful export restores ${property}`);
failCanvasEncoding = true;
await assert.rejects(rendererSandbox.renderCategoryRoadmapImageForPptx(renderCategory, renderGroups), /Canvas encoding failed/);
for (const property of stateProperties) assert.equal(rendererSandbox[property], stateBeforeRender.get(property), `failed export restores ${property}`);
assert.equal(JSON.stringify(renderCategory), categoryBeforeRender, "failed rendering does not mutate saved category data");

const sectionStart = appSource.indexOf("function addPptxPortfolioSlide(");
const sectionEnd = appSource.indexOf("function exportPng(", sectionStart);
assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
const productPagesStart = appSource.indexOf("function productPagesForPptx(");
const productPagesEnd = appSource.indexOf("async function renderCategoryImageForPptx(", productPagesStart);
assert.ok(productPagesStart >= 0 && productPagesEnd > productPagesStart);
let selectedScope = "both";
const categoryInputs = exportCategories.filter((category) => category.board).map((category) => ({ value: category.id, checked: true }));
const exportControls = new Map(["pptxExportCategories", "pptxExportCategoryCount", "pptxExportSlideCount", "pptxSelectAllCategories", "pptxExportSelectionHint"].map((id) => [`#${id}`, { textContent: "", innerHTML: "" }]));
const hintClasses = new Set();
exportControls.get("#pptxExportSelectionHint").classList = { toggle(name, enabled) { if (enabled) hintClasses.add(name); else hintClasses.delete(name); } };
const decks = [];
const renderCalls = [];
class RecordingPptx {
  constructor() {
    this.slides = [];
    this._slides = this.slides;
    this.ShapeType = { line: "line", rect: "rect", roundRect: "roundRect" };
    decks.push(this);
  }
  addSlide() {
    const slide = { texts: [], shapes: [], images: [],
      addText(text, options) { this.texts.push({ text, options }); },
      addShape(type, options) { this.shapes.push({ type, options }); },
      addImage(options) { this.images.push(options); },
    };
    this.slides.push(slide);
    return slide;
  }
  async writeFile({ fileName }) { this.fileName = fileName; }
}
function recordImage(kind, category, page = null) {
  const pageProducts = kind === "products" ? page.rows.flatMap((row) => row.products) : page.flatMap((group) => group.products);
  const productIds = Array.from(pageProducts, (product) => product.id);
  const image = kind === "products" ? { data: `${kind}:${category.id}`, width: page.width, height: page.height } : { data: `${kind}:${category.id}`, width: 800, height: 1600 };
  image.products = productIds.map((id, index) => kind === "products" ? {
    kind: "card", id, name: `Product ${id}`,
    x: 20 + index % 10 * 115, y: 15 + Math.floor(index / 10) * 115, width: 100, height: 100,
    elements: [
      { kind: "shape", shape: "roundRect", x: 0, y: 0, width: 100, height: 100, fill: "#FFFFFF", lineColor: "#345678", lineWidth: 1 },
      { kind: "text", text: `Product ${id}`, x: 8, y: 5, width: 84, height: 12, fontSize: 10, color: "#171717", bold: true, align: "left" },
      { kind: "image", data: `artwork:${id}`, x: 8, y: 20, width: 30, height: 30 },
      { kind: "text", text: "$149.99", x: 42, y: 20, width: 50, height: 12, fontSize: 8, color: "#171717", align: "left" },
      { kind: "text", text: "USB-C · 20 hours", x: 8, y: 54, width: 84, height: 12, fontSize: 7, color: "#171717", align: "left" },
      { kind: "text", text: `SKU-${id}`, x: 8, y: 76, width: 84, height: 10, fontSize: 6, color: "#777777", align: "left" },
    ],
  } : {
    kind: "roadmap", id, name: `Product ${id}`, label: `PRODUCT ${id}`,
    x: 80, y: 120 + index * 52, width: 640, height: 38,
    fill: "#96C6BA", textColor: "#171717", lineColor: "#345678", concept: index % 2 === 1, fontSize: 12,
  });
  renderCalls.push({ kind, categoryId: category.id, productIds, image, page });
  return image;
}
const sandbox = {
  PPTXPagination: globalThis.PPTXPagination, paginateRoadmapGroupsForPptx: paginateRoadmapGroups,
  CARD_WIDTH: 246, CARD_GAP: 10, GUTTER: 18, SIDE_PADDING: 40, LANE_TOP: 34,
  portfolio: { categories: exportCategories }, pptxSelectedCategoryIds: null, pptxExportInProgress: false,
  pptxExportDialog: { classList: { add() {}, remove() {} } }, confirmPptxExportButton: { disabled: false },
  pptxExportForm: {
    querySelector: () => ({ value: selectedScope }),
    querySelectorAll: (selector) => selector.includes(":checked") ? categoryInputs.filter((input) => input.checked) : categoryInputs,
  },
  $: (selector) => exportControls.get(selector),
  escapeHtml: (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]),
  categoryDefinition: (id) => ({ id }), ensureBoardSchema: (board) => board,
  productCardLayout: (targetBoard) => {
    const cardHeight = targetBoard?.exportCardHeight || 552;
    return { cardHeight, laneHeight: cardHeight + 70, detailed: false };
  },
  inferFamily: (name) => name || "Other",
  roadmapGroupsForProducts: (products) => [...new Set(products.map((product) => product.family))].map((family) => ({ family, products: products.filter((product) => product.family === family) })),
  closePopupMenus() {}, renderActiveView() {}, PptxGenJS: RecordingPptx,
  PPTXEditable: { ...globalThis.PPTXEditable, writeFile: (pptx, options) => pptx.writeFile(options) },
  downloadBlob() {},
  renderCategoryImageForPptx: async (category, page) => recordImage("products", category, page),
  renderCategoryRoadmapImageForPptx: async (category, groups) => recordImage("roadmap", category, groups),
};
vm.createContext(sandbox);
vm.runInContext(appSource.slice(productPagesStart, productPagesEnd) + appSource.slice(sectionStart, sectionEnd), sandbox);
const productBoundaryCategory = (productCount, laneCount = 1) => ({
  id: `boundary-${productCount}-${laneCount}`, name: "Pagination boundary",
  board: {
    lanes: Array.from({ length: laneCount }, (_, index) => ({ id: `lane-${index}`, label: `Lane ${index + 1}`, order: index })),
    products: Array.from({ length: productCount }, (_, index) => ({ id: `boundary-product-${index}`, name: "Boundary family", laneId: `lane-${index % laneCount}`, order: index })),
  },
});
for (const [productCount, expectedRows] of [[13, [13]], [14, [13, 1]]]) {
  const category = productBoundaryCategory(productCount);
  const before = JSON.stringify(category);
  const planned = sandbox.buildPptxExportPlan("products", [category]);
  assert.deepEqual(Array.from(planned, (slide) => Array.from(slide.page.rows, (row) => row.products.length)), [expectedRows], "the real application limits horizontal product rows without unnecessarily adding a slide");
  assert.equal(sandbox.pptxSlideCountForScope("products", [category]), planned.length, "product boundary previews use the actual page plan");
  assert.ok(planned.every((slide) => slide.page.layout.cardHeight === 552), "each product page carries the category's real card layout to its renderer");
  assert.equal(JSON.stringify(category), before, "boundary planning leaves the saved category unchanged");
}
const manyLaneCategory = productBoundaryCategory(5, 5);
const manyLanePlan = sandbox.buildPptxExportPlan("products", [manyLaneCategory]);
assert.equal(manyLanePlan.length, 3, "multiple short lanes share rows on a slide before continuing vertically");
assert.equal(sandbox.pptxSlideCountForScope("products", [manyLaneCategory]), manyLanePlan.length, "height pagination is included in the preview");
assert.deepEqual(Array.from(manyLanePlan, (slide) => slide.pageIndex), [0, 1, 2]);
assert.ok(manyLanePlan.every((slide) => slide.pageCount === 3));
assert.deepEqual(Array.from(manyLanePlan, (slide) => slide.page.rows.length), [2, 2, 1]);
assert.equal(new Set(manyLanePlan.map((slide) => `${slide.page.width}:${slide.page.height}`)).size, 1, "continuation pages retain a consistent product scale");

const consistentCategories = [productBoundaryCategory(1), productBoundaryCategory(13), productBoundaryCategory(27), manyLaneCategory];
const consistentPlan = sandbox.buildPptxExportPlan("products", consistentCategories);
assert.ok(consistentPlan.every((slide) => slide.page.width === 3386 && slide.page.height === 3386 * 6.33 / 12.55), "the actual export plan uses the same 13-column canvas across sparse, full, continued, and multi-lane categories");
const sharedPlanBefore = JSON.stringify(consistentCategories);
const tallCategory = productBoundaryCategory(1);
tallCategory.id = "tall-card-category";
tallCategory.board.exportCardHeight = 3000;
const mixedHeightPlan = sandbox.buildPptxExportPlan("products", [...consistentCategories, tallCategory]);
const commonWidth = mixedHeightPlan.find((slide) => slide.category.id === tallCategory.id).page.width;
assert.ok(commonWidth > 3386, "an unusually tall card can require a larger content canvas");
assert.ok(mixedHeightPlan.every((slide) => slide.page.width === commonWidth && slide.page.height === commonWidth * 6.33 / 12.55), "all selected categories adopt the same width when one tall card needs more height");
assert.equal(JSON.stringify(consistentCategories), sharedPlanBefore, "sharing category scale leaves all saved boards unchanged");
assert.equal(sandbox.buildPptxExportPlan("products", consistentCategories)[0].page.width, 3386, "an unselected tall category never changes another export's scale");

const unequalCategory = productBoundaryCategory(0, 2);
unequalCategory.board.products = [
  ...Array.from({ length: 14 }, (_, index) => ({ id: `wired-${index}`, laneId: "lane-0", order: index, name: "Headset" })),
  ...Array.from({ length: 27 }, (_, index) => ({ id: `wireless-${index}`, laneId: "lane-1", order: index, name: "Headset" })),
];
const unequalPlan = sandbox.buildPptxExportPlan("products", [unequalCategory]);
assert.deepEqual(Array.from(unequalPlan, (slide) => Array.from(slide.page.rows, (row) => [row.lane.id, row.slot, row.products.length])), [
  [["lane-0", 0, 13], ["lane-1", 1, 13]],
  [["lane-0", 0, 1], ["lane-1", 1, 13]],
  [["lane-1", 1, 1]],
], "the actual plan keeps wired and wireless lanes together and preserves their slots through unequal overflow");
for (const laneId of ["lane-0", "lane-1"]) {
  assert.deepEqual(Array.from(unequalPlan).flatMap((slide) => Array.from(slide.page.rows).filter((row) => row.lane.id === laneId).flatMap((row) => Array.from(row.products, (product) => product.id))), unequalCategory.board.products.filter((product) => product.laneId === laneId).map((product) => product.id), "parallel lane continuation retains all products in each lane's saved order");
}
sandbox.renderPptxExportCategories();
assert.ok(exportControls.get("#pptxExportCategories").innerHTML.includes("Console &lt;limited&gt;"), "category picker safely displays saved names");
assert.ok(!exportControls.get("#pptxExportCategories").innerHTML.includes('value="unavailable"'));
for (const [scope, expectedSlides] of [["products", 3], ["roadmap", 4], ["both", 7]]) {
  selectedScope = scope;
  sandbox.setPptxCategorySelection(["beta", "alpha", "stale"]);
  assert.equal(exportControls.get("#pptxExportCategoryCount").textContent, "2");
  assert.equal(exportControls.get("#pptxExportSlideCount").textContent, String(expectedSlides), "preview counts use selected categories and paginated scope");
  assert.equal(exportControls.get("#pptxExportSelectionHint").textContent, "2 of 3 categories selected");
  assert.equal(sandbox.confirmPptxExportButton.disabled, false);
  assert.deepEqual(Array.from(sandbox.pptxExportCategories(), (category) => category.id), ["alpha", "beta"]);
}
sandbox.renderPptxExportCategories();
assert.ok(exportControls.get("#pptxExportCategories").innerHTML.includes('value="alpha" checked'));
assert.ok(!exportControls.get("#pptxExportCategories").innerHTML.includes('value="empty" checked'), "reopening retains a partial category selection");
sandbox.setPptxCategorySelection(["alpha", "beta", "empty"]);
assert.equal(sandbox.pptxSelectedCategoryIds, null, "selecting every available category retains the default all selection");
assert.equal(exportControls.get("#pptxSelectAllCategories").textContent, "Clear selection");
sandbox.setPptxCategorySelection([]);
assert.equal(exportControls.get("#pptxExportCategoryCount").textContent, "0");
assert.equal(exportControls.get("#pptxExportSlideCount").textContent, "0");
assert.equal(sandbox.confirmPptxExportButton.disabled, true, "empty selection cannot be submitted");
assert.equal(exportControls.get("#pptxExportSelectionHint").textContent, "Select at least one category to export.");
assert.ok(hintClasses.has("is-empty"));
// An empty selection disables Export, while Cancel still closes the modal,
// releases its background, and returns keyboard focus to the invoking control.
const modalClasses = new Set(["hidden"]);
const appShell = { inert: false };
const emptyWorkspace = { inert: false };
let returnedFocus = 0;
let scopeFocus = 0;
const originalControl = { isConnected: true, focus: () => { returnedFocus += 1; } };
exportControls.set("#workspaceEmpty", emptyWorkspace);
sandbox.pptxExportDialog.classList = { add: (name) => modalClasses.add(name), remove: (name) => modalClasses.delete(name), contains: (name) => modalClasses.has(name) };
sandbox.document = { activeElement: originalControl, querySelector: (selector) => selector === ".app-shell" ? appShell : null };
sandbox.requestAnimationFrame = (callback) => callback();
sandbox.pptxReturnFocus = null;
sandbox.pptxExportForm.querySelector = () => ({ value: selectedScope, focus: () => { scopeFocus += 1; } });
sandbox.openPptxExportDialog();
assert.equal(sandbox.confirmPptxExportButton.disabled, true);
assert.equal(modalClasses.has("hidden"), false);
assert.equal(appShell.inert, true);
assert.equal(emptyWorkspace.inert, true);
assert.equal(scopeFocus, 1);
sandbox.closePptxExportDialog();
assert.equal(modalClasses.has("hidden"), true, "Cancel works even when no categories are selected");
assert.equal(appShell.inert, false);
assert.equal(emptyWorkspace.inert, false);
assert.equal(returnedFocus, 1);
sandbox.closePptxExportDialog();
assert.equal(returnedFocus, 1, "closing an already closed chooser does not steal focus again");
sandbox.openPptxExportDialog();
sandbox.pptxExportInProgress = true;
sandbox.closePptxExportDialog();
assert.equal(modalClasses.has("hidden"), false, "an active file export keeps its chooser open");
assert.equal(appShell.inert, true);
sandbox.pptxExportInProgress = false;
sandbox.closePptxExportDialog();
assert.equal(returnedFocus, 2);
assert.equal(appShell.inert, false);
sandbox.setPptxCategorySelection(["beta"]);
sandbox.pptxExportInProgress = true;
sandbox.syncPptxExportSummary();
assert.equal(sandbox.confirmPptxExportButton.disabled, true, "changing scope cannot reenable an export in progress");
assert.ok(!hintClasses.has("is-empty"), "export progress does not mark a valid category selection as empty");
sandbox.pptxExportInProgress = false;

for (const [scope, expectedKinds, expectedFilename] of [
  ["products", ["products:alpha", "products:alpha", "products:beta"], "product-portfolio.pptx"],
  ["roadmap", ["roadmap:alpha", "roadmap:alpha", "roadmap:alpha", "roadmap:beta"], "product-roadmaps.pptx"],
  ["both", ["products:alpha", "products:alpha", "roadmap:alpha", "roadmap:alpha", "roadmap:alpha", "products:beta", "roadmap:beta"], "product-portfolio-and-roadmaps.pptx"],
]) {
  renderCalls.length = 0;
  await sandbox.exportPptx(scope, ["beta", "alpha", "stale", "alpha"]);
  const deck = decks.at(-1);
  assert.deepEqual(renderCalls.map((call) => `${call.kind}:${call.categoryId}`), expectedKinds, "the actual export renders only chosen categories in portfolio order");
  assert.equal(deck.slides.length, expectedKinds.length);
  assert.equal(sandbox.pptxSlideCountForScope(scope, PPTXPagination.selectExportCategories(exportCategories, ["alpha", "beta"])), deck.slides.length, "the dialog preview and actual paginated export agree");
  assert.equal(deck.fileName, expectedFilename);
  for (const category of exportCategories.slice(0, 2)) {
    for (const kind of ["products", "roadmap"].filter((kind) => scope === "both" || scope === kind)) {
      assert.deepEqual(renderCalls.filter((call) => call.categoryId === category.id && call.kind === kind).flatMap((call) => call.productIds), category.board.products.map((product) => product.id), "pagination/export preserves every selected product exactly once per view");
    }
  }
  deck.slides.forEach((slide, index) => {
    const call = renderCalls[index];
    const category = exportCategories.find((item) => item.id === call.categoryId);
    const previousSameView = renderCalls.slice(0, index).some((earlier) => earlier.kind === call.kind && earlier.categoryId === call.categoryId);
    const expectedProducts = call.image.products;
    const nativeProductTexts = slide.texts.slice(1);
    assert.equal(slide.texts.length, 1 + expectedProducts.length * (call.kind === "roadmap" ? 1 : 4), "product labels, prices, specifications, and SKUs remain native editable text beside the slide title");
    assert.equal(slide.texts[0].text, `${category.name} — ${call.kind === "products" ? "Product Portfolio" : "Roadmap"}${previousSameView ? " (continued)" : ""}`, "both portfolio and roadmap continuation titles retain user content without numeric pagination");
    assert.equal(slide.background.color, "171717");
    assert.equal(slide.shapes.length, 1 + (call.kind === "products" ? expectedProducts.length : 0), "each portfolio card retains its own editable rounded rectangle");
    assert.deepEqual(structuredClone(slide.shapes[0].options.line), { color: "2B2E2B", width: .4, transparency: 25 }, "slide divider remains faint");
    assert.equal(slide.images.length, 1 + (call.kind === "products" ? expectedProducts.length : 0), "only artwork is a picture within each editable portfolio card");
    const image = slide.images[0];
    assert.equal(image.data, `${call.kind}:${call.categoryId}`);
    assert.ok(image.x >= .38 && image.y >= .74 && image.x + image.w <= 12.93 + 1e-8 && image.y + image.h <= 7.07 + 1e-8, "wide/tall exported images fit within the slide content area");
    assert.ok(Math.abs(image.w / image.h - call.image.width / call.image.height) < 1e-8, "slide composition preserves image proportions");
    const scale = image.w / call.image.width;
    if (call.kind === "products") {
      assert.ok(call.page.rows.every((row) => row.products.length <= 13), "the renderer receives no portfolio row wider than 13 products");
      assert.ok(call.page.rows.length <= call.page.rowsPerSlide, "the renderer receives only rows that fit the page height");
      const partsByName = new Map([
        ...slide.texts.map((part) => [part.options.objectName, { ...part.options, text: part.text, kind: "text" }]),
        ...slide.shapes.map((part) => [part.options.objectName, { ...part.options, type: part.type, kind: "shape" }]),
        ...slide.images.map((part) => [part.objectName, { ...part, kind: "image" }]),
      ].filter(([name]) => name));
      expectedProducts.forEach((product, productIndex) => {
        product.elements.forEach((element, elementIndex) => {
          const part = partsByName.get(`ppc-card-${productIndex}-part-${elementIndex}`);
          assert.ok(part, "every product part has a unique grouping identity");
          assert.equal(part.kind, element.kind);
          for (const [property, expected] of Object.entries({
            x: image.x + (product.x + element.x) * scale,
            y: image.y + (product.y + element.y) * scale,
            w: element.width * scale,
            h: element.height * scale,
          })) assert.ok(Math.abs(part[property] - expected) < 1e-8, `native portfolio ${property} aligns with the board and its product group`);
          if (element.kind === "text") assert.equal(part.text, element.text, "card text remains editable at the exact exported value");
          if (element.kind === "image") assert.equal(part.data, element.data, "the artwork remains a separate picture inside the card");
          if (element.kind === "shape") assert.equal(part.type, element.shape);
        });
      });
      return;
    }
    nativeProductTexts.forEach((nativeProduct, productIndex) => {
      const expectedProduct = expectedProducts[productIndex];
      const options = nativeProduct.options;
      assert.equal(options.objectName, `Product: ${expectedProduct.id} — ${expectedProduct.name}`, "PowerPoint selection names identify independent products");
      for (const [property, expected] of Object.entries({
        x: image.x + expectedProduct.x * scale,
        y: image.y + expectedProduct.y * scale,
        w: expectedProduct.width * scale,
        h: expectedProduct.height * scale,
      })) assert.ok(Math.abs(options[property] - expected) < 1e-8, `product ${property} uses the background's exact scale and origin`);
      assert.ok(options.x >= image.x && options.y >= image.y && options.x + options.w <= image.x + image.w + 1e-8 && options.y + options.h <= image.y + image.h + 1e-8, "independent products remain inside the exported board");
      assert.equal(nativeProduct.text, expectedProduct.label, "the product name is editable text");
      assert.equal(options.shape, "roundRect");
      assert.equal(options.fill.color, expectedProduct.fill.slice(1));
      assert.equal(options.color, expectedProduct.textColor.slice(1));
      assert.equal(options.line.color, expectedProduct.lineColor.slice(1));
      assert.equal(options.line.dashType || "solid", expectedProduct.concept ? "dash" : "solid", "concept products retain their dashed border");
    });
  });
  const productSlides = deck.slides.filter((_, index) => renderCalls[index].kind === "products");
  assert.equal(new Set(productSlides.map((slide) => Number(slide.shapes[1].options.w.toFixed(9)))).size, productSlides.length ? 1 : 0, "native product card widths remain identical across different categories and continuation slides");
}
const deckCountBeforeEmpty = decks.length;
renderCalls.length = 0;
await assert.rejects(sandbox.exportPptx("both", []), /Select at least one category/);
await assert.rejects(sandbox.exportPptx("products", ["stale"]), /Select at least one category/);
assert.equal(decks.length, deckCountBeforeEmpty, "empty or stale selections never create a PowerPoint file");
assert.deepEqual(renderCalls, []);
await sandbox.exportPptx("products");
assert.deepEqual(renderCalls.map((call) => call.categoryId), ["alpha", "alpha", "beta", "empty"], "the API's default still exports all available categories with the required continuation pages");
assert.equal(JSON.stringify(exportCategories), sourceCategoriesBefore, "selection/planning never deletes or reorders saved category data");

// Serialize a real slide through the shipped library, then inspect its actual
// OOXML and image payload with the same bundle's ZIP reader.
const librarySandbox = { console, setTimeout, clearTimeout, setImmediate, clearImmediate, Buffer, Blob, URL, TextEncoder, TextDecoder };
vm.createContext(librarySandbox);
vm.runInContext(await readFile(new URL("../../public/vendor/pptxgen.bundle.js", import.meta.url), "utf8"), librarySandbox, { timeout: 5000 });
assert.equal(typeof librarySandbox.PptxGenJS, "function");
assert.equal(typeof librarySandbox.JSZip.loadAsync, "function");
const realPptx = new librarySandbox.PptxGenJS();
realPptx.layout = "LAYOUT_WIDE";
// A valid 1x1 PNG, including correct checksums for every PNG chunk.
const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const realTitle = "Audio 2 — Roadmap";
const realProducts = [
  { kind: "roadmap", id: "release", name: "Released Product", label: "RELEASED PRODUCT", x: 80, y: 120, width: 640, height: 38, fill: "#96C6BA", textColor: "#171717", lineColor: "#345678", concept: false, fontSize: 12 },
  { kind: "roadmap", id: "concept", name: "Concept Prototype", label: "CONCEPT & PROTOTYPE", x: 160, y: 172, width: 240, height: 38, fill: "#A6A6A6", textColor: "#FFFFFF", lineColor: "#898989", concept: true, fontSize: 11 },
  { kind: "roadmap", id: "embargo", name: "Embargo Product", label: "EMBARGO PRODUCT", x: 280, y: 224, width: 120, height: 38, fill: "#AF3954", textColor: "#FFFFFF", lineColor: "#E85270", concept: false, fontSize: 12 },
];
const realImage = { data: `image/png;base64,${tinyPng}`, width: 800, height: 1600, products: realProducts };
sandbox.addPptxPortfolioSlide(realPptx, realTitle, realImage);
const serializedPptx = await realPptx.write({ outputType: "arraybuffer" });
assert.ok(serializedPptx.byteLength > 10000, "the shipped library emits a complete PowerPoint archive");
const realArchive = await librarySandbox.JSZip.loadAsync(serializedPptx, { checkCRC32: true });
const slideXml = await realArchive.file("ppt/slides/slide1.xml").async("string");
const slideRelationships = await realArchive.file("ppt/slides/_rels/slide1.xml.rels").async("string");
const savedTexts = [...slideXml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]);
assert.deepEqual(savedTexts, [realTitle, ...realProducts.map((product) => product.label.replaceAll("&", "&amp;"))], "the saved slide contains editable labels for every product and no numeric footer");
assert.ok(!/<p:ph\b[^>]*\btype="(?:sldNum|ftr|dt)"/i.test(slideXml), "the saved slide has no number/footer/date placeholders");
const dividerXml = slideXml.match(/<a:ln\b[^>]*\bw="5080"[^>]*>([\s\S]*?)<\/a:ln>/);
assert.ok(dividerXml, "the saved divider is exactly 0.4pt (5080 EMU)");
assert.match(dividerXml[1], /<a:srgbClr\b[^>]*\bval="2B2E2B"/);
assert.match(dividerXml[1], /<a:alpha\b[^>]*\bval="75000"/, "the saved divider retains 25% transparency");
const pictureXml = [...slideXml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)];
assert.equal(pictureXml.length, 1, "the saved slide contains one roadmap background image");
const nativeShapeXml = [...slideXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((match) => match[0]);
const productShapeXml = nativeShapeXml.filter((xml) => /<p:cNvPr\b[^>]*\bname="Product: /.test(xml));
assert.equal(nativeShapeXml.length, realProducts.length + 2, "the saved deck contains the title, divider, and a distinct native shape for every product");
assert.equal(productShapeXml.length, realProducts.length, "every product is a named, independently selectable PowerPoint object");
const realPlacement = sandbox.containRect(realImage.width, realImage.height, .38, .74, 12.55, 6.33, "left");
const realScale = realPlacement.w / realImage.width;
productShapeXml.forEach((xml, index) => {
  const product = realProducts[index];
  const xmlName = `Product: ${product.id} — ${product.name}`.replaceAll("&", "&amp;");
  assert.ok(xml.includes(`name="${xmlName}"`), "saved selection names retain product identity");
  assert.match(xml, /<a:prstGeom\b[^>]*\bprst="roundRect"/, "the product label and bar are one native rounded shape");
  assert.ok(xml.includes(`<a:t>${product.label.replaceAll("&", "&amp;")}</a:t>`), "the saved product label is editable text rather than raster content");
  assert.ok(xml.includes(`<a:srgbClr val="${product.fill.slice(1)}"`), "saved product fills retain lifecycle colors");
  assert.ok(xml.includes(`<a:srgbClr val="${product.lineColor.slice(1)}"`), "saved product outlines retain their original status color");
  if (product.concept) assert.ok(xml.includes('<a:prstDash val="dash"'), "saved concept borders remain dashed");
  else assert.ok(!/<a:prstDash\b[^>]*\bval="(?!solid")[^"]+"/.test(xml), "saved regular borders retain the default solid stroke");
  const transform = xml.match(/<a:xfrm[^>]*>\s*<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  assert.ok(transform, "saved products have native placement and dimensions");
  const expectedTransform = [
    realPlacement.x + product.x * realScale,
    realPlacement.y + product.y * realScale,
    product.width * realScale,
    product.height * realScale,
  ].map((inches) => Math.round(inches * 914400));
  transform.slice(1).forEach((value, coordinate) => assert.ok(Math.abs(Number(value) - expectedTransform[coordinate]) <= 1, "saved native product geometry aligns with the roadmap background"));
});
const imageRelationId = pictureXml[0][0].match(/<a:blip\b[^>]*\br:embed="([^"]+)"/)?.[1];
assert.ok(imageRelationId, "the slide picture refers to an embedded image relationship");
const imageRelation = [...slideRelationships.matchAll(/<Relationship\b[^>]*\/>/g)].map((match) => match[0]).find((relationship) => relationship.includes(`Id="${imageRelationId}"`));
assert.ok(imageRelation);
assert.match(imageRelation, /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image"/);
const imageTarget = imageRelation.match(/Target="([^"]+)"/)?.[1];
assert.match(imageTarget, /^\.\.\/media\/.+\.png$/);
const imagePayload = await realArchive.file(`ppt/${imageTarget.slice(3)}`).async("uint8array");
assert.deepEqual(Buffer.from(imagePayload), Buffer.from(tinyPng, "base64"), "the image relationship resolves to the intact real PNG payload");
assert.match(await realArchive.file("[Content_Types].xml").async("string"), /Extension="png"\s+ContentType="image\/png"/);

// Verify the final delivered file, including real PowerPoint groups. Moving a
// portfolio product must move its text, frame, and artwork together, while
// ungrouping exposes editable text and native shapes instead of a card bitmap.
vm.runInContext(await readFile(new URL("../../public/js/pptx-editable.js", import.meta.url), "utf8"), librarySandbox);
sandbox.PPTXEditable = librarySandbox.PPTXEditable;
const portfolioDeck = new librarySandbox.PptxGenJS();
portfolioDeck.layout = "LAYOUT_WIDE";
const portfolioCards = [
  {
    kind: "card", id: "headset", name: 'Headset & "Limited"', x: 20, y: 30, width: 240, height: 450,
    elements: [
      { kind: "shape", shape: "roundRect", x: 8, y: 8, width: 224, height: 434, fill: "#252525", lineColor: "#626662", lineWidth: 1, radius: 4, cornerRadii: [4] },
      { kind: "shape", shape: "roundRect", x: 8, y: 8, width: 224, height: 22, fill: "#96C6BA", radius: 4, cornerRadii: [4, 4, 0, 0] },
      { kind: "text", text: 'HEADSET & "LIMITED"', x: 20, y: 170, width: 200, height: 22, fontSize: 16, color: "#F0F2F0", bold: true, align: "center" },
      { kind: "image", data: `image/png;base64,${tinyPng}`, x: 24, y: 36, width: 192, height: 120 },
      { kind: "text", text: "$199.99", x: 20, y: 198, width: 200, height: 22, fontSize: 16, color: "#A6A6A6", align: "center" },
      { kind: "text", text: "USB-C & wireless · 20 hours", x: 48, y: 250, width: 164, height: 20, fontSize: 11.5, color: "#CCCCCC", align: "left" },
      { kind: "text", text: "SKU-001 <US>", x: 24, y: 408, width: 192, height: 18, fontSize: 9, color: "#CCCCCC", align: "left" },
    ],
  },
  {
    kind: "card", id: "no-art", name: "No Artwork Product", x: 290, y: 30, width: 240, height: 450,
    elements: [
      { kind: "shape", shape: "rect", x: 8, y: 8, width: 224, height: 434, fill: "#252525" },
      { kind: "text", text: "NO ARTWORK PRODUCT", x: 20, y: 170, width: 200, height: 22, fontSize: 16, color: "#F0F2F0", bold: true, align: "center" },
      { kind: "text", text: "$49.99", x: 20, y: 198, width: 200, height: 22, fontSize: 16, color: "#A6A6A6", align: "center" },
      { kind: "text", text: "Bluetooth 5.3", x: 48, y: 250, width: 164, height: 20, fontSize: 11.5, color: "#CCCCCC", align: "left" },
      { kind: "text", text: "SKU-002", x: 24, y: 408, width: 192, height: 18, fontSize: 9, color: "#CCCCCC", align: "left" },
    ],
  },
];
const portfolioImage = { data: `image/png;base64,${tinyPng}`, width: 800, height: 600, products: portfolioCards };
sandbox.addPptxPortfolioSlide(portfolioDeck, "Audio — Product Portfolio", portfolioImage);
sandbox.addPptxPortfolioSlide(portfolioDeck, realTitle, realImage);
const beforeGroupingArchive = await librarySandbox.JSZip.loadAsync(await portfolioDeck.write({ outputType: "arraybuffer" }));
const beforeGroupingRoadmapXml = await beforeGroupingArchive.file("ppt/slides/slide2.xml").async("string");
const beforeGroupingPortfolioXml = await beforeGroupingArchive.file("ppt/slides/slide1.xml").async("string");
const groupedBytes = await librarySandbox.PPTXEditable.serialize(portfolioDeck);
const groupedArchive = await librarySandbox.JSZip.loadAsync(groupedBytes, { checkCRC32: true });
const portfolioXml = await groupedArchive.file("ppt/slides/slide1.xml").async("string");
const portfolioRelationships = await groupedArchive.file("ppt/slides/_rels/slide1.xml.rels").async("string");
const cardGroupsXml = [...portfolioXml.matchAll(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g)].map((match) => match[0]);
assert.equal(cardGroupsXml.length, portfolioCards.length, "the delivered portfolio slide has one independently selectable native group per product");
const xmlEscape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const portfolioPlacement = sandbox.containRect(portfolioImage.width, portfolioImage.height, .38, .74, 12.55, 6.33, "left");
const portfolioScale = portfolioPlacement.w / portfolioImage.width;
cardGroupsXml.forEach((groupXml, index) => {
  const card = portfolioCards[index];
  assert.ok(groupXml.includes(`name="${xmlEscape(`Product: ${card.id} — ${card.name}`)}"`), "the product group selection name retains product identity and escaped user content");
  const texts = [...groupXml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]);
  assert.deepEqual(texts, card.elements.filter((element) => element.kind === "text").map((element) => xmlEscape(element.text)), "name, price, specification, and SKU survive as editable native text within their own product group");
  assert.equal([...groupXml.matchAll(/<p:sp>/g)].length, card.elements.filter((element) => element.kind !== "image").length, "each card frame and text field is a native shape");
  assert.equal([...groupXml.matchAll(/<p:pic>/g)].length, card.elements.filter((element) => element.kind === "image").length, "only actual product artwork remains a picture within a product group");
  const groupTransform = groupXml.match(/<p:grpSpPr>[\s\S]*?<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  assert.ok(groupTransform, "each product group has a native placement and size");
  const expectedGroupTransform = [portfolioPlacement.x + card.x * portfolioScale, portfolioPlacement.y + card.y * portfolioScale, card.width * portfolioScale, card.height * portfolioScale].map((value) => Math.round(value * 914400));
  groupTransform.slice(1).forEach((value, coordinate) => assert.ok(Math.abs(Number(value) - expectedGroupTransform[coordinate]) <= 1, "group placement keeps cards aligned with the exported board"));
});
const ungroupedPortfolioXml = portfolioXml.replace(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g, "");
assert.equal([...ungroupedPortfolioXml.matchAll(/<p:pic>/g)].length, 1, "the sole ungrouped picture is the product-free board background");
assert.deepEqual([...ungroupedPortfolioXml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]), ["Audio — Product Portfolio"], "every product text field belongs to its own product group");
const shapeIds = [...portfolioXml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map((match) => match[1]);
assert.equal(new Set(shapeIds).size, shapeIds.length, "generated PowerPoint group and child IDs are unique on the slide");
const savedCardShapes = [...cardGroupsXml[0].matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((match) => match[0]);
const savedBanner = savedCardShapes.find((shape) => shape.includes('name="ppc-card-0-part-1"'));
assert.ok(savedBanner, "the status banner remains its own native shape within the product");
const banner = portfolioCards[0].elements[1];
const [bannerWidth, bannerHeight, bannerRadius] = [banner.width, banner.height, banner.radius].map((value) => Math.round(value * portfolioScale * 914400));
assert.ok(savedBanner.includes(`<a:path w="${bannerWidth}" h="${bannerHeight}">`), "native banner geometry retains its exact dimensions");
assert.ok(savedBanner.includes(`<a:moveTo><a:pt x="${bannerRadius}" y="0"/></a:moveTo>`), "native banner retains its rounded upper corners");
assert.ok(savedBanner.includes(`<a:quadBezTo><a:pt x="${bannerWidth}" y="${bannerHeight}"/><a:pt x="${bannerWidth}" y="${bannerHeight}"/></a:quadBezTo>`), "native banner retains its square lower corners rather than inheriting PowerPoint defaults");
assert.equal([...cardGroupsXml[0].matchAll(/<a:custGeom>/g)].length, 2, "the card frame and banner preserve their canvas corner radii as editable native geometry");
const firstGroupMetadata = { prefix: "ppc-card-0-part-", name: "First product", x: 0, y: 0, width: 1, height: 1, partCount: portfolioCards[0].elements.length };
const firstChild = [...beforeGroupingPortfolioXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((match) => match[0]).find((shape) => shape.includes('name="ppc-card-0-part-0"'));
assert.ok(firstChild);
assert.throws(() => librarySandbox.PPTXEditable.groupSlideXml(beforeGroupingPortfolioXml.replace(firstChild, ""), [firstGroupMetadata]), /could not group all parts/, "an incomplete product fails export instead of silently losing content");
const unrelatedShape = [...beforeGroupingPortfolioXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)][0][0];
assert.throws(() => librarySandbox.PPTXEditable.groupSlideXml(beforeGroupingPortfolioXml.replace(firstChild, firstChild + unrelatedShape), [firstGroupMetadata]), /not in their expected order/, "grouping rejects interleaved unrelated shapes so a product cannot capture other slide content");
const artworkRelationshipId = cardGroupsXml[0].match(/<a:blip\b[^>]*\br:embed="([^"]+)"/)?.[1];
assert.ok(artworkRelationshipId, "grouped artwork retains its embedded image reference");
const artworkRelationship = [...portfolioRelationships.matchAll(/<Relationship\b[^>]*\/>/g)].map((match) => match[0]).find((relationship) => relationship.includes(`Id="${artworkRelationshipId}"`));
assert.ok(artworkRelationship, "grouping keeps the artwork relationship valid");
const artworkTarget = artworkRelationship.match(/Target="([^"]+)"/)?.[1];
assert.deepEqual(Buffer.from(await groupedArchive.file(`ppt/${artworkTarget.slice(3)}`).async("uint8array")), Buffer.from(tinyPng, "base64"), "grouped artwork still resolves to the intact original PNG");
assert.equal(await groupedArchive.file("ppt/slides/slide2.xml").async("string"), beforeGroupingRoadmapXml, "grouping portfolio cards leaves roadmap native product shapes unchanged");
let downloadedFile;
await librarySandbox.PPTXEditable.writeFile(portfolioDeck, { fileName: "editable-products.pptx" }, (blob, fileName) => { downloadedFile = { blob, fileName }; });
assert.equal(downloadedFile.fileName, "editable-products.pptx", "the export delivery path downloads the requested filename");
assert.ok(downloadedFile.blob instanceof Blob);
const deliveredArchive = await librarySandbox.JSZip.loadAsync(Buffer.from(await downloadedFile.blob.arrayBuffer()), { checkCRC32: true });
assert.equal(await deliveredArchive.file("ppt/slides/slide1.xml").async("string"), portfolioXml, "the actual downloaded file contains grouped editable products");

// A very dense category used to emit 0.53pt text, which PowerPoint asks to
// repair. Exercise both card creation and the final no-card delivery path.
const denseDeck = new librarySandbox.PptxGenJS();
denseDeck.layout = "LAYOUT_WIDE";
const denseSlide = denseDeck.addSlide();
const denseGroup = librarySandbox.PPTXEditable.addCard(denseDeck, denseSlide, {
  id: "dense", name: "Dense category product", x: 0, y: 0, width: 240, height: 450,
  elements: [{ kind: "text", text: "DIMENSION", x: 20, y: 30, width: 100, height: 12, fontSize: 9, color: "FFFFFF" }],
}, { x: 0, y: 0, scale: .0008 }, 0);
librarySandbox.PPTXEditable.registerSlide(denseDeck, [denseGroup]);
const denseArchive = await librarySandbox.JSZip.loadAsync(await librarySandbox.PPTXEditable.serialize(denseDeck));
const denseXml = await denseArchive.file("ppt/slides/slide1.xml").async("string");
assert.match(denseXml, /<p:grpSp>/, "dense products retain their independently editable group");
assert.deepEqual([...denseXml.matchAll(/\bsz="(\d+)"/g)].map((match) => Number(match[1])), [100, 100], "scaled card text stays at PowerPoint's valid 1pt minimum");
const densePresentation = await denseArchive.file("ppt/presentation.xml").async("string");
assert.ok(densePresentation.indexOf("<p:notesMasterIdLst>") < densePresentation.indexOf("<p:sldIdLst>"), "notes master IDs precede slide IDs as required by the presentation schema");

const noCardsDeck = new librarySandbox.PptxGenJS();
noCardsDeck.layout = "LAYOUT_WIDE";
noCardsDeck.addSlide().addText("Small roadmap label", { x: 0, y: 0, w: 1, h: .2, fontSize: .53 });
librarySandbox.PPTXEditable.registerSlide(noCardsDeck, []);
let noCardsDownload;
await librarySandbox.PPTXEditable.writeFile(noCardsDeck, { fileName: "roadmap.pptx" }, (blob, fileName) => { noCardsDownload = { blob, fileName }; });
assert.equal(noCardsDownload.fileName, "roadmap.pptx", "roadmap-only downloads also use the compatibility pass");
const noCardsArchive = await librarySandbox.JSZip.loadAsync(Buffer.from(await noCardsDownload.blob.arrayBuffer()));
assert.deepEqual([...(await noCardsArchive.file("ppt/slides/slide1.xml").async("string")).matchAll(/\bsz="(\d+)"/g)].map((match) => Number(match[1])), [100, 100], "the final serializer validates all native text, even without product groups");
const noCardsPresentation = await noCardsArchive.file("ppt/presentation.xml").async("string");
assert.ok(noCardsPresentation.indexOf("<p:notesMasterIdLst>") < noCardsPresentation.indexOf("<p:sldIdLst>"), "the notes master order is corrected for roadmap-only exports too");
for (const archive of [denseArchive, noCardsArchive]) {
  const notesRelationships = await archive.file("ppt/notesMasters/_rels/notesMaster1.xml.rels").async("string");
  const slideRelationships = await archive.file("ppt/slideMasters/_rels/slideMaster1.xml.rels").async("string");
  const themeTarget = (xml) => [...xml.matchAll(/<Relationship\b[^>]*\/>/g)].map((match) => match[0])
    .find((relationship) => relationship.includes('/relationships/theme"'))?.match(/\bTarget="([^"]+)"/)?.[1];
  const notesTheme = themeTarget(notesRelationships);
  const slideTheme = themeTarget(slideRelationships);
  assert.notEqual(notesTheme, slideTheme, "the notes master owns a separate theme, as required by desktop PowerPoint");
  assert.deepEqual(Buffer.from(await archive.file(`ppt/${notesTheme.slice(3)}`).async("uint8array")), Buffer.from(await archive.file(`ppt/${slideTheme.slice(3)}`).async("uint8array")), "the separate notes theme preserves the original design");
  assert.ok((await archive.file("[Content_Types].xml").async("string")).includes(`PartName="/ppt/${notesTheme.slice(3)}" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"`), "the separate theme has a declared package content type");
}

const tinyCornerXml = librarySandbox.PPTXEditable.groupSlideXml('<p:sp><p:nvSpPr><p:cNvPr id="2" name="tiny-part-0"/></p:nvSpPr><p:spPr><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></p:spPr></p:sp>', [{
  prefix: "tiny-part-", name: "Tiny product", x: 0, y: 0, width: .1, height: .1, partCount: 1,
  roundedCorners: { "tiny-part-0": { width: 3, height: 3, radii: [2] } },
}]);
assert.ok([...tinyCornerXml.matchAll(/<a:pt x="([^"]+)" y="([^"]+)"/g)].every((match) => match.slice(1).every((coordinate) => /^\d+$/.test(coordinate))), "clamped corner coordinates remain schema-valid integers for odd dimensions");
console.log(`PPTX checks passed: pagination, category selection, grouped native portfolio cards with editable name/price/spec/SKU and preserved artwork, editable roadmap shapes, clipped date geometry, product-free backgrounds, restored export state, numberless slide chrome, and real delivered-file OOXML (${groupedBytes.byteLength} bytes).`);
