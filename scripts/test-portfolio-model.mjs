import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../portfolio-model.js");
const model = globalThis.PortfolioModel;

const portfolio = {
  activeCategoryId: "b", settings: {},
  categories: [
    { id: "a", board: { settings: { roadmap: { startMonth: "2024-01", endMonth: "2026-12", categoryLabel: "Audio", familyOrder: ["Cloud"] } }, products: [{ id: "keep", roadmap: { startMonth: "2025-07", endMonth: "2029-10" } }] } },
    { id: "b", board: { settings: { roadmap: { startMonth: "2026-01", endMonth: "2030-12", categoryLabel: "Mice", snap: "quarter" } }, products: [] } },
  ],
};
const productBefore = structuredClone(portfolio.categories[0].board.products);
model.syncTimelineSettings(portfolio);
assert.equal(portfolio.settings.timeline.startMonth, "2026-01", "legacy range migrates from the active category");
assert.equal(portfolio.categories[0].board.settings.roadmap.endMonth, "2030-12");
assert.equal(portfolio.categories[0].board.settings.roadmap.categoryLabel, "Audio");
assert.deepEqual(portfolio.categories[0].board.settings.roadmap.familyOrder, ["Cloud"]);
for (const years of [3, 5, 10]) {
  model.syncTimelineSettings(portfolio, { startMonth: "2027-01", endMonth: `${2027 + years - 1}-12`, snap: "half", statusColors: { launched: "#515151" } });
  for (const category of portfolio.categories) {
    assert.equal(category.board.settings.roadmap.endMonth, `${2027 + years - 1}-12`);
    assert.equal(category.board.settings.roadmap.snap, "half");
    assert.equal(category.board.settings.roadmap.statusColors.launched, "#515151");
  }
  const reopened = JSON.parse(JSON.stringify(portfolio));
  reopened.activeCategoryId = "a";
  model.syncTimelineSettings(reopened);
  assert.deepEqual(reopened.settings.timeline, portfolio.settings.timeline, "switching category/reloading preserves global settings");
}
assert.deepEqual(portfolio.categories[0].board.products, productBefore, "view settings never change product lifecycle dates");
assert.equal(model.normalizeTimelineSettings({ startMonth: "2026-13", endMonth: "garbage" }).startMonth, "2026-01");
assert.equal(model.normalizeTimelineSettings({ startMonth: "2027-01", endMonth: "2026-12" }).endMonth, "2027-12");
const curated = [{ id: "s1", label: "Driver", value: "53 mm", custom: "keep" }];
assert.deepEqual(model.normalizeSpecifications(curated), curated);
assert.equal(model.normalizeSpecifications({ Driver: "53 mm" }, () => "s2")[0].value, "53 mm");
assert.equal(model.normalizeSpecifications([["Weight", "300 g"]], () => "s3")[0].label, "Weight");
assert.equal(model.normalizeSpecifications('[["Weight", "300 g"]]', () => "s4")[0].value, "300 g");
assert.equal(model.normalizeSpecifications("Custom specs", () => "s5")[0].value, "Custom specs");

const product = {
  variantGroups: [{ type: "color", items: [
    { id: "black", code: "BK", colorName: "Black", colorHex: "#111111" },
    { id: "whitepink", code: "WHT-PNK", colorName: "White", colorName2: "Pink", colorHex: "#eeeeee", colorHex2: "#ff5599" },
  ] }],
  ascm: { records: [{ basePartNumber: "A1", colorCode: "BLK" }, { basePartNumber: "A2", colorCode: "WHT/PNK" }] },
};
assert.equal(model.resolveSkuColors({ code: "A1" }, product)[0].label, "Black");
assert.equal(model.resolveSkuColors({ code: "a2" }, product)[0].label, "White / Pink");
assert.equal(model.resolveSkuColors({ code: "manual", variantId: "black" }, product)[0].colorHex, "#111111");
assert.deepEqual(model.resolveSkuColors({ code: "unknown" }, product), [], "unknown numbers never guess a color");
assert.equal(model.resolveSkuColors({ code: "manual", colorCode: "CUSTOM" }, product)[0].label, "CUSTOM");
const namedVariant = { variantGroups: [{ type: "color", items: [{ id: "curated-black", code: "BLACK", colorName: "Midnight Black", colorHex: "#121218" }] }], ascm: { records: [{ basePartNumber: "A3", colorCode: "BK" }] } };
assert.equal(model.resolveSkuColors({ code: "A3" }, namedVariant)[0].label, "Midnight Black");
assert.equal(model.resolveSkuColors({ code: "A3" }, namedVariant)[0].colorHex, "#121218");
assert.equal(model.canonicalColorCode("White-Pink"), "WHT/PNK");

// Run the real application year-span action with a minimal view adapter.
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const action = appSource.slice(appSource.indexOf("function setRoadmapYearSpan("), appSource.indexOf("function fitProductLanesVertically("));
const sandbox = { board: portfolio.categories[0].board, activeView: "roadmap", monthIndex: (value) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1,
  monthStringFromDate: () => "2026-10", updateTimelineSettings: (patch) => model.syncTimelineSettings(portfolio, patch),
  requestAnimationFrame: (callback) => callback(), fitRoadmapTimeline: () => {}, roadmapScroll: { scrollTo: () => {} } };
vm.createContext(sandbox);
vm.runInContext(action, sandbox);
for (const years of [3, 5, 10]) {
  sandbox.setRoadmapYearSpan(years);
  assert.ok(portfolio.categories.every((category) => category.board.settings.roadmap.endMonth === `${2027 + years - 1}-12`));
}

// Exercise the real canvas geometry: compact empty cards, stable category heights,
// bounded overflow, and fully expanded detailed specifications.
const layoutSandbox = {
  board: { products: [], settings: { showSkus: true, fullSingleLaneSpecs: false } },
  sortedLanes: () => [{ id: "lane" }], categoryDefinition: () => ({}),
  variantFooterLayout: (item) => ({ height: item.footerHeight || 0 }),
  visibleProducts: () => { throw new Error("Search results must not control category geometry"); },
};
vm.createContext(layoutSandbox);
vm.runInContext(
  appSource.slice(appSource.indexOf("const CARD_WIDTH"), appSource.indexOf("const PLACEHOLDER_IMAGE")) +
  appSource.slice(appSource.indexOf("const FULL_SPEC_MIN_CARD_HEIGHT"), appSource.indexOf("// Canvas colors")) +
  appSource.slice(appSource.indexOf("function normalizedSpecLabel("), appSource.indexOf("function viewerInfoVisualWidth(")),
  layoutSandbox,
);
layoutSandbox.board.products = [{ specs: [], footerHeight: 50 }];
assert.equal(layoutSandbox.productCardLayout().cardHeight, 300, "empty spec space collapses");
layoutSandbox.board.products.push({ specs: Array.from({ length: 4 }, () => ({ label: "Connection", value: "USB" })), footerHeight: 50 });
assert.equal(layoutSandbox.productCardLayout().cardHeight, 415, "all products determine aligned category height");
layoutSandbox.board.products.push({ specs: Array.from({ length: 20 }, () => ({ label: "Connection", value: "USB" })), footerHeight: 104 });
assert.equal(layoutSandbox.productCardLayout().cardHeight, 552, "compact overflow remains bounded");
assert.equal(layoutSandbox.productCardLayout().laneHeight, 622);
layoutSandbox.board.settings.fullSingleLaneSpecs = true;
assert.ok(layoutSandbox.productCardLayout().cardHeight > 552, "full specifications expand without clipping");
layoutSandbox.board.products = [{ specs: [], footerHeight: 50 }];
assert.equal(layoutSandbox.productCardLayout().detailed, false, "empty full-spec categories use compact geometry");

const presentationSandbox = { PortfolioModel: model, UI_PALETTE: { charcoal600: "#2c2c2c" },
  normalizeRoadmapStatus: (stage) => stage || "in-planning", standardizedStatus: (type) => ({ label: { new: "NEW PRODUCT", embargo: "UPCOMING UNDER EMBARGO" }[type] || "", color: "#ff0000" }) };
vm.createContext(presentationSandbox);
vm.runInContext(
  appSource.slice(appSource.indexOf("function productPresentation("), appSource.indexOf("function productPriceText(")) +
  appSource.slice(appSource.indexOf("function roadmapStatusColor("), appSource.indexOf("function roadmapLabel(")),
  presentationSandbox,
);
for (const stage of ["launched", "in-development", "in-planning", "embargo", "end-of-life"]) {
  const item = { statusType: "none", variantLabel: "Custom label", variantColor: "#ff0000", roadmap: { status: stage } };
  const presentation = presentationSandbox.productPresentation(item);
  assert.equal(presentation.primaryColor, presentationSandbox.roadmapStatusColor(item), "cards and timeline share the selected manual stage tone");
  assert.equal(presentation.primaryColor, model.lifecycleTone(stage));
  assert.equal(item.variantColor, "#ff0000", "old custom fields remain stored without affecting the shared palette");
}
for (const [statusType, expected] of [["new", "#5fd6c1"], ["embargo", "#ef5b5b"]]) {
  const item = { statusType, roadmap: { status: "in-development" } };
  assert.equal(presentationSandbox.productPresentation(item).primaryColor, expected);
  assert.equal(presentationSandbox.roadmapStatusColor(item), expected, "theme accents must match between product cards and roadmap");
}
assert.equal(model.productTone({ statusType: "new", roadmap: { status: "embargo" } }), "#ef5b5b", "embargo remains visible when a new product is under embargo");

// Console platform labels are secondary to the same lifecycle banner used by
// every category, in both the canvas card and roadmap details.
const consoleText = [];
const consoleShapes = [];
let consoleProduct;
Object.assign(presentationSandbox, {
  board: { settings: { showPrices: false, showSkus: false } }, portfolio: { settings: {} },
  UI_PALETTE: { charcoal600: "#2c2c2c", charcoal700: "#222222", charcoal500: "#333333", silver: "#cccccc" },
  CARD_WIDTH: 246, STATUS_BANNER_HEIGHT: 24, INFO_BUTTON_WIDTH: 54,
  roundRect: (...args) => { consoleShapes.push(args); }, loadImage: () => ({ ready: false }),
  productImageSource: () => "", wrapText: (_context, text) => { consoleText.push(text); },
  drawProductInfoButton: () => {}, drawDetailedSpecs: () => {},
  splitProduct: { innerHTML: "" }, selectedProduct: () => consoleProduct,
  escapeHtml: (text) => String(text || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
  contrastTextColor: () => "#111111", productDetailsModel: () => ({}),
  PortfolioDetails: { render: () => "Details", bind() {} }, copyTextToClipboard() {},
});
vm.runInContext(
  appSource.slice(appSource.indexOf("function drawCard("), appSource.indexOf("function roadmapRange(")) +
  appSource.slice(appSource.indexOf("function renderSplitProduct("), appSource.indexOf("function updateLinkedViewButton(")),
  presentationSandbox,
);
const consoleContext = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  measureText: (text) => ({ width: text.length * 5 }), fillText: (text) => { consoleText.push(text); } };
const consoleLayout = { cardHeight: 300, imageSlotTop: 34, imageSlotHeight: 110, titleBlockTop: 150, detailsTopOffset: 65 };
for (const [statusType, label, color] of [["new", "NEW PRODUCT", "#5fd6c1"], ["embargo", "UPCOMING UNDER EMBARGO", "#ef5b5b"]]) {
  for (const variantLabel of ["", "PLAYSTATION", "XBOX", label]) {
    consoleProduct = { name: "Console headset", statusType, variantLabel, specs: [], roadmap: { status: "in-development" } };
    const before = JSON.stringify(consoleProduct);
    const presentation = presentationSandbox.productPresentation(consoleProduct);
    assert.equal(presentation.primaryLabel, label, "platforms cannot replace the shared status banner");
    assert.equal(presentation.primaryColor, color);
    assert.equal(presentation.secondaryLabel, variantLabel && variantLabel !== label ? variantLabel : "", "identical status/variant labels are never duplicated");
    for (const detailed of [false, true]) {
      consoleText.length = 0;
      consoleShapes.length = 0;
      presentationSandbox.drawCard(consoleContext, consoleProduct, 0, 0, false, { ...consoleLayout, detailed }, false);
      assert.equal(consoleText[0], label, "both compact and detailed cards start with the shared status label");
      assert.equal(consoleShapes[1][6], color, "the main banner uses the theme accent");
      if (presentation.secondaryLabel) {
        assert.equal(consoleText[1], variantLabel);
        assert.equal(consoleShapes[2][6], "#222222", "the platform badge uses charcoal, rather than a second status accent");
        assert.ok(consoleShapes[2][1] + consoleShapes[2][3] < 246 - 54 - 8, "the platform badge leaves room for Details");
      }
    }
    presentationSandbox.renderSplitProduct();
    assert.ok(presentationSandbox.splitProduct.innerHTML.includes(`>${label}</div>`), "roadmap details retain the same primary status");
    assert.equal(presentationSandbox.splitProduct.innerHTML.includes('class="split-platform-label"'), Boolean(presentation.secondaryLabel));
    assert.equal(JSON.stringify(consoleProduct), before, "presentation never changes the saved manual status or platform label");
  }
}
assert.equal(presentationSandbox.productPresentation({ statusType: "none", variantLabel: "PLAYSTATION" }).primaryLabel, "PLAYSTATION", "a manual platform banner remains available when no product status is set");
consoleProduct = { name: "Console headset", statusType: "new", variantLabel: "PLAYSTATION", specs: [], roadmap: { status: "in-development" } };
presentationSandbox.loadImage = () => ({ ready: true, image: {} });
presentationSandbox.drawContainedImage = () => { consoleText.push("paint product image"); };
consoleText.length = 0;
presentationSandbox.drawCard(consoleContext, consoleProduct, 0, 0, false, consoleLayout, false);
assert.ok(consoleText.indexOf("PLAYSTATION") > consoleText.indexOf("paint product image"), "loaded headset images cannot paint over the secondary platform label");

// Both views read the same saved MSRP. Unknown values have no display text,
// while intentional text prices and a real zero remain available in either view.
for (const [price, expected] of [[129.99, "$129.99"], ["129.99", "$129.99"], [0, "$0.00"], ["0", "$0.00"], [" 19.5 ", "$19.50"]]) {
  assert.equal(model.msrpText({ price, priceLabel: "Contact sales" }), expected, "saved numeric MSRP takes precedence over display text");
}
for (const price of [undefined, null, "", " ", "NaN", "12oops", NaN, Infinity, -Infinity, -1, "-9.99", false, true, {}, []]) {
  assert.equal(model.msrpText({ price }), "", "blank or invalid saved amounts never become a fake MSRP");
  assert.equal(model.msrpText({ price, priceLabel: " Contact sales " }), "Contact sales", "invalid amounts still allow a meaningful display label");
}
for (const priceLabel of ["", " ", "Price TBD", "tbd", "Price hidden", "Not set", "Price not available", "NA", "N/A", "—", "--"]) {
  assert.equal(model.msrpText({ price: null, priceLabel }), "", "unknown-price placeholders do not appear on cards or timeline");
}
assert.equal(model.msrpText({ priceLabel: "$ Varies" }), "$ Varies");
assert.equal(model.msrpText(null), "");

// Exercise the actual card drawing, timeline label, and visibility handlers.
// The adapters replace unrelated canvas/DOM effects, not the price decisions.
const pricedProduct = { id: "shared-price", name: "Cloud Test", price: 129.99, priceLabel: "Contact sales", specs: [] };
const priceBoard = { settings: { showPrices: true, showSkus: false }, products: [pricedProduct] };
const pricePortfolio = { settings: { showRoadmapMsrp: false }, categories: [{ id: "headsets", board: priceBoard }] };
const controls = new Map([["#showPrices", {}], ["#roadmapShowMsrp", {}]]);
let savedPriceChanges = 0;
const priceSandbox = {
  PortfolioModel: model, board: priceBoard, portfolio: pricePortfolio,
  $: (selector) => controls.get(selector), scheduleSave: () => { savedPriceChanges += 1; },
  syncControls: () => {}, renderActiveView: () => {}, renderRoadmaps: () => {},
  UI_PALETTE: {}, CARD_WIDTH: 264, STATUS_BANNER_HEIGHT: 24,
  productPresentation: () => ({ primaryLabel: "", hasStatus: false, outlineColor: "#333333" }),
  roundRect: () => {}, loadImage: () => ({ ready: false }), productImageSource: () => "",
  wrapText: () => {}, drawProductInfoButton: () => {}, viewerInfoProductId: null, viewerInfoProgress: 0,
};
vm.createContext(priceSandbox);
vm.runInContext(
  appSource.slice(appSource.indexOf("function productPriceText("), appSource.indexOf("function parseHexColor(")) +
  appSource.slice(appSource.indexOf("function roadmapProductBarLabel("), appSource.indexOf("function drawRoadmapTo(")) +
  appSource.slice(appSource.indexOf("function drawCard("), appSource.indexOf("function roadmapRange(")) +
  appSource.slice(appSource.indexOf("function updateBoard("), appSource.indexOf("function updateTimelineSettings(")) +
  appSource.slice(appSource.indexOf('$("#showPrices").onchange'), appSource.indexOf('$("#showSkus").onchange')) +
  appSource.slice(appSource.indexOf('$("#roadmapShowMsrp").onchange'), appSource.indexOf('document.querySelectorAll("[data-roadmap-years]")', appSource.indexOf('$("#roadmapShowMsrp").onchange'))),
  priceSandbox,
);
const cardLayout = { cardHeight: 300, imageSlotTop: 24, imageSlotHeight: 110, titleBlockTop: 150, priceBaselineOffset: 48, detailsTopOffset: 65, detailed: false };
function cardText(item) {
  const output = [];
  const context = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText(text) { output.push(text); } };
  priceSandbox.drawCard(context, item, 0, 0, false, cardLayout);
  return output;
}
const storedBefore = JSON.stringify(pricePortfolio.categories);
for (const showCards of [false, true]) {
  for (const showTimeline of [false, true]) {
    controls.get("#showPrices").onchange({ target: { checked: showCards } });
    controls.get("#roadmapShowMsrp").onchange({ target: { checked: showTimeline } });
    assert.equal(priceBoard.settings.showPrices, showCards);
    assert.equal(pricePortfolio.settings.showRoadmapMsrp, showTimeline);
    assert.equal(cardText(pricedProduct).includes("$129.99"), showCards, "card visibility controls only card pricing");
    assert.equal(priceSandbox.roadmapProductBarLabel(pricedProduct), showTimeline ? "CLOUD TEST  ·  $129.99" : "CLOUD TEST", "timeline MSRP is independent of the card visibility toggle");
    for (const item of [{ ...pricedProduct, price: null, priceLabel: "Price TBD" }, { ...pricedProduct, price: "bad", priceLabel: "" }]) {
      assert.equal(priceSandbox.roadmapProductBarLabel(item), "CLOUD TEST", "unknown MSRP leaves no placeholder or empty delimiter");
      assert.ok(!cardText(item).some((text) => /TBD|NaN|Infinity/.test(text)), "unknown prices remain blank on cards");
    }
  }
}
assert.equal(savedPriceChanges, 8, "both real visibility handlers save their view settings");
assert.equal(JSON.stringify(pricePortfolio.categories[0].board.products), JSON.stringify(JSON.parse(storedBefore)[0].board.products), "visibility changes preserve stored MSRP and display labels");
assert.equal(JSON.parse(JSON.stringify(pricePortfolio)).categories[0].board.products[0].price, 129.99, "saving/reopening retains the shared amount");
pricedProduct.price = 199.5;
assert.equal(priceSandbox.productPriceText(pricedProduct), "$199.50");
assert.ok(cardText(pricedProduct).includes("$199.50"));
assert.equal(priceSandbox.roadmapProductBarLabel(pricedProduct), "CLOUD TEST  ·  $199.50", "changing the saved MSRP updates both surfaces");

// A taller details pane belongs to its own lane; all following lanes move by
// the extra height, preserving the normal gap and every preceding position.
const geometryLanes = Object.freeze(["first", "middle", "last"].map((id) => Object.freeze({ id, label: id.toUpperCase(), order: ["first", "middle", "last"].indexOf(id) })));
const geometryLayout = Object.freeze({ cardHeight: 300, laneHeight: 370, detailed: false });
const geometryInputs = JSON.stringify({ lanes: geometryLanes, layout: geometryLayout });
const baseGeometry = model.layoutProductLanes(geometryLanes, geometryLayout);
const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} versus ${expected}`);
assert.deepEqual(baseGeometry.rows.map((row) => row.top), [34, 404, 774]);
assert.equal(baseGeometry.height, 1110);
for (const drawZoom of [.65, 1, 1.5]) {
  const detailHeight = 520 / drawZoom;
  const extra = Math.max(0, detailHeight - geometryLayout.cardHeight);
  for (const [expandedIndex, expandedLane] of geometryLanes.entries()) {
    const result = model.layoutProductLanes(geometryLanes, geometryLayout, Object.freeze({ expandedLaneId: expandedLane.id, detailHeight }));
    closeTo(result.height, baseGeometry.height + extra, "total height contains exactly one expanded lane");
    result.rows.forEach((row, index) => {
      assert.equal(row.lane, geometryLanes[index]);
      assert.equal(row.index, index);
      closeTo(row.top, baseGeometry.rows[index].top + (index > expandedIndex ? extra : 0), "only following lanes move down");
      closeTo(row.contentHeight, index === expandedIndex ? detailHeight : 300, "only the selected lane expands");
      closeTo(row.height - row.contentHeight, 70, "the original row gap remains exact");
      if (index > 0) closeTo(row.top - result.rows[index - 1].top - result.rows[index - 1].contentHeight, 70, "the next lane never overlaps cards or the details pane");
    });
  }
}
for (const options of [{ expandedLaneId: "missing", detailHeight: 1000 }, { expandedLaneId: "middle", detailHeight: 0 }, { expandedLaneId: "middle", detailHeight: 200 }]) {
  assert.deepEqual(model.layoutProductLanes(geometryLanes, geometryLayout, options), baseGeometry, "closing/stale/short details restore the original geometry");
}
assert.equal(model.layoutProductLanes(geometryLanes, geometryLayout, { top: 80 }).rows[0].top, 80);
assert.equal(model.layoutProductLanes(geometryLanes, geometryLayout, { top: 80 }).height, 1110, "total row height excludes initial padding");
assert.deepEqual(model.layoutProductLanes([], geometryLayout), { rows: [], height: 0 });
assert.equal(JSON.stringify({ lanes: geometryLanes, layout: geometryLayout }), geometryInputs, "geometry never changes saved lanes or card layout");

// Inline details use horizontal room only. Dimensions, drawing, lane labels,
// hit testing, and dragging keep every lane at its original position.
const laneProducts = geometryLanes.map((lane) => ({ id: `p-${lane.id}`, laneId: lane.id, order: 0 }));
laneProducts.push({ id: "p-following", laneId: "first", order: 1 });
let visibleLaneProducts = laneProducts;
const drawnLaneCards = [];
const laneBackgrounds = [];
const reorderedProducts = [];
const laneSandbox = {
  PortfolioModel: model, board: { products: laneProducts }, activeView: "products", zoom: 1,
  viewerInfoProductId: "p-middle", viewerInfoProgress: 1,
  sortedLanes: () => geometryLanes, visibleProducts: () => visibleLaneProducts, productCardLayout: () => geometryLayout,
  viewerInfoVisualWidth: () => 620,
  PRODUCT_MIN_ZOOM: .2, LANE_TOP: 34, GUTTER: 18, CARD_WIDTH: 246, CARD_GAP: 10, SIDE_PADDING: 40,
  inspectorOpen: false, inspector: { offsetWidth: 0 }, canvasScroll: { clientWidth: 800, scrollTop: 0 },
  laneRailInner: { style: {}, innerHTML: "" }, UI_PALETTE: { charcoal800: "#171717" },
  roundRect: (...args) => { laneBackgrounds.push(args.slice(1, 5)); },
  drawCard: (_context, item, x, y) => { drawnLaneCards.push({ id: item.id, x, y }); },
  escapeHtml: (value) => String(value || ""), selectedId: null, renderedCards: [], dragState: null, panState: null,
  canvas: { style: {}, hasPointerCapture: () => false },
  reorderProduct: (productId, laneId, targetIndex) => { reorderedProducts.push({ productId, laneId, targetIndex }); },
};
function appSection(start, end) {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `application section is present: ${start}`);
  return appSource.slice(startIndex, endIndex);
}
vm.createContext(laneSandbox);
vm.runInContext(
  appSection("function viewerInfoReserveLogical(", "function setupCanvas(") +
  appSection("function drawBoardTo(", "function specIconKind(") +
  appSection("function renderLaneRail(", "function horizontalScrollMax(") +
  appSection("function hitCard(", "function hitVariantOverflow(") +
  appSection("function finishDrag(", 'canvas.addEventListener("pointerup", finishDrag)'),
  laneSandbox,
);
const laneContext = { clearRect() {} };
for (const drawZoom of [.2, .65, 1, 1.5]) {
  laneSandbox.zoom = drawZoom;
  for (const lane of geometryLanes) {
    laneSandbox.viewerInfoProductId = `p-${lane.id}`;
    const dimensions = laneSandbox.getCanvasDimensions();
    closeTo(dimensions.height, 34 + 1110 + 20, "opening details preserves the original canvas height");
    drawnLaneCards.length = 0;
    laneBackgrounds.length = 0;
    laneSandbox.drawBoardTo(laneContext, dimensions);
    laneSandbox.renderLaneRail(dimensions);
    const railRows = [...laneSandbox.laneRailInner.innerHTML.matchAll(/style="top:([\d.]+)px;height:([\d.]+)px"/g)];
    assert.equal(railRows.length, geometryLanes.length);
    dimensions.laneRows.forEach((row, index) => {
      closeTo(row.top, baseGeometry.rows[index].top, "opening details never moves a lane");
      const item = drawnLaneCards.find((card) => card.id === `p-${row.lane.id}`);
      closeTo(item.y, row.top, "drawn card uses centralized lane position");
      closeTo(laneBackgrounds[index][1], row.top - 4, "lane background follows row top");
      closeTo(laneBackgrounds[index][3], row.contentHeight + 8, "lane background retains the original card height");
      closeTo(Number(railRows[index][1]), (row.top - 4) * drawZoom, "lane rail follows the same scaled position");
      closeTo(Number(railRows[index][2]), (row.contentHeight + 8) * drawZoom, "lane rail retains the original row height");
      assert.equal(laneSandbox.hitCard({ x: item.x + 120, y: item.y + 150 }).productId, item.id, "hit testing follows the unchanged lane positions");
    });
  }
}
laneSandbox.zoom = .65;
laneSandbox.viewerInfoProductId = "p-first";
const openDimensions = laneSandbox.getCanvasDimensions();
laneSandbox.viewerInfoProgress = .01;
assert.equal(laneSandbox.getCanvasDimensions().height, openDimensions.height, "opening animation never reserves vertical space");
laneSandbox.viewerInfoProgress = 1;
laneSandbox.dragState = { productId: "p-last", position: { x: 18 + 256, y: openDimensions.laneRows[1].top + 5 } };
laneSandbox.finishDrag({ pointerId: 1 });
assert.deepEqual(reorderedProducts, [{ productId: "p-last", laneId: "middle", targetIndex: 1 }], "dropping on a lane uses its unchanged position");
for (const activeView of ["roadmap", "split"]) {
  laneSandbox.activeView = activeView;
  assert.equal(laneSandbox.getCanvasDimensions().height, 34 + 1110 + 20, "other views do not reserve inline viewer space");
}
laneSandbox.activeView = "products";
for (const viewerInfoProductId of [null, "missing"]) {
  laneSandbox.viewerInfoProductId = viewerInfoProductId;
  assert.equal(laneSandbox.getCanvasDimensions().height, 34 + 1110 + 20, "closed/stale viewer IDs preserve lane height");
}
laneSandbox.viewerInfoProductId = "p-first";
laneSandbox.viewerInfoProgress = 0;
assert.equal(laneSandbox.getCanvasDimensions().height, 34 + 1110 + 20);
laneSandbox.viewerInfoProgress = 1;
visibleLaneProducts = laneProducts.filter((item) => item.id !== "p-first");
assert.equal(laneSandbox.getCanvasDimensions().height, 34 + 1110 + 20, "filtering out the viewed product preserves lane height");
visibleLaneProducts = laneProducts;
drawnLaneCards.length = 0;
laneSandbox.drawBoardTo(laneContext, laneSandbox.getCanvasDimensions());
const liveFollowingX = drawnLaneCards.find((item) => item.id === "p-following").x;
const exportDimensions = laneSandbox.getCanvasDimensions({ includeViewer: false });
assert.equal(exportDimensions.height, 34 + 1110 + 20, "exports preserve the same vertical geometry as the live board");
drawnLaneCards.length = 0;
laneSandbox.drawBoardTo(laneContext, exportDimensions, false);
assert.equal(drawnLaneCards.find((item) => item.id === "p-following").x, 18 + 256, "exports contain no temporary horizontal details gap");
assert.ok(liveFollowingX > 18 + 256, "the live board still makes horizontal room beside the viewed product");
console.log("Portfolio model tests passed: global timeline actions, preserved specs/SKU colors, shared prices/stage tones, and non-overlapping inline details across lane consumers.");
