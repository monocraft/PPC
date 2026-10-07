import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const appSource = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const appSection = (start, end) => {
  const from = appSource.indexOf(start);
  const to = appSource.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing application section: ${start}`);
  return appSource.slice(from, to);
};
const originalBoard = { products: [{ id: "current" }] };
const originalRegions = {
  renderedCards: [{ productId: "current" }],
  renderedVariantOverflow: [{ key: "overflow" }],
  renderedHeroVariantRegions: [{ key: "hero" }],
  renderedInfoButtons: [{ productId: "current" }],
};
const category = {
  id: "export-category",
  board: {
    lanes: [{ id: "first" }, { id: "second" }],
    products: [
      { id: "later", name: "Later Product", laneId: "first", order: 2 },
      { id: "other", name: "Other Lane", laneId: "second", order: 0 },
      { id: "earlier", name: "Earlier Product", laneId: "first", order: 1 },
    ],
  },
};
const savedCategory = JSON.stringify(category);
const exportPage = {
  width: 4000, height: 1100,
  layout: { detailed: true, cardHeight: 450, laneHeight: 550 },
  rows: [
    { lane: category.board.lanes[0], products: [category.board.products[2], category.board.products[0]], continued: false },
    { lane: category.board.lanes[1], products: [category.board.products[1]], continued: false },
  ],
};
const canvases = [];
const headers = [];
let rejectImage = false;
const sandbox = {
  activeCategoryId: "current-category", board: originalBoard, selectedId: "current",
  searchQuery: "current search", roadmapSearchQuery: "roadmap search", inspectorOpen: true,
  viewerInfoOpen: true, viewerInfoProductId: "current", dragState: { productId: "earlier", position: { x: 9000, y: 9000 } },
  hoveredHeroVariant: { productId: "earlier", variantId: "hover" },
  ...originalRegions,
  CARD_WIDTH: 240,
  GUTTER: 24, SIDE_PADDING: 40, LANE_TOP: 34,
  UI_PALETTE: { charcoal800: "#222222", silver: "#BBBBBB" },
  categoryDefinition: (id) => ({ id }),
  ensureBoardSchema(board) { board.normalizedForExport = true; return board; },
  async preloadCategoryImagesForPptx(products) {
    assert.notEqual(products, category.board.products, "normalization and image preloading use a copied board");
  },
  getCanvasDimensions() { throw new Error("PowerPoint page dimensions must not depend on the workspace viewport or zoom."); },
  sortedLanes: () => sandbox.board.lanes,
  visibleProducts: () => sandbox.board.products,
  productCardLayout: () => ({ detailed: true, cardHeight: 450 }),
  productLaneGeometry: () => { throw new Error("The provided lane geometry must be reused."); },
  cardXForDisplayIndex(products, index, includeViewer) {
    assert.equal(includeViewer, false);
    return 24 + index * 264;
  },
  roundRect(context, ...args) { context.operations.push({ type: "lane", args }); },
  drawDetailedFamilyHeaders(context, products, y) {
    headers.push({ canvas: context.canvas, products: products.map((product) => product.id), y });
  },
  drawCard(context, product, x, y, selected, layout, interactive) {
    assert.equal(selected, false);
    assert.equal(interactive, false);
    assert.equal(x, 0);
    assert.equal(y, 0);
    assert.equal(layout.cardHeight, 450);
    context.operations.push({ type: "product", productId: product.id });
    context.fillStyle = "#252525";
    context.strokeStyle = "#626662";
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(0, 0, 240, 450, 4);
    context.fill();
    context.stroke();
    context.fillStyle = "#F0F2F0";
    context.font = "700 16px Arial";
    context.textAlign = "center";
    context.fillText(product.name, 120, 185);
    context.font = "16px Arial";
    context.fillText("$149.99", 120, 215);
    context.font = "11.5px Arial";
    context.textAlign = "left";
    context.fillText("USB-C · 20 hours", 43, 260);
    context.font = "9px Arial";
    context.fillText(`SKU-${product.id}`, 24, 430);
    context.beginPath();
    context.moveTo(0, 238);
    context.lineTo(240, 238);
    context.stroke();
    context.drawImage({ width: 192, height: 120 }, 24, 36, 192, 120);
    // Footer hotspots exist even for a static rendering, so verify restoration.
    sandbox.renderedVariantOverflow.push({ key: product.id });
    sandbox.renderedHeroVariantRegions.push({ key: product.id });
  },
  document: {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const canvas = { width: 0, height: 0 };
      const context = {
        canvas, operations: [], globalAlpha: 1, lineWidth: 1,
        fillStyle: "#000000", strokeStyle: "#000000", font: "10px Arial", textAlign: "left", textBaseline: "alphabetic",
        transform: [1, 0, 0, 1, 0, 0],
        setTransform(...args) { this.transform = args; },
        getTransform() { return Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((name, index) => [name, this.transform[index]])); },
        beginPath() {}, roundRect() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {}, fillText() {},
        measureText(text) { return { width: String(text).length * 6 }; },
        drawImage(...args) { this.operations.push({ type: "artwork", args }); },
        clearRect(...args) { this.operations.push({ type: "clear", args }); },
        fillRect(...args) { this.operations.push({ type: "background", args }); },
      };
      canvas.getContext = () => context;
      canvas.toDataURL = (type) => {
        if (rejectImage) throw new Error("image delivery failed");
        return `data:${type};base64,canvas-${canvases.indexOf(canvas)}`;
      };
      canvas.context = context;
      canvases.push(canvas);
      return canvas;
    },
  },
};
vm.createContext(sandbox);
vm.runInContext(
  appSection("function drawProductBoardExportBackground(", "function specIconKind(") +
  appSection("function recordCardElementsForPptx(", "async function renderCategoryRoadmapImageForPptx("),
  sandbox,
);

const originalState = Object.fromEntries([
  "activeCategoryId", "board", "selectedId", "searchQuery", "roadmapSearchQuery", "inspectorOpen",
  "viewerInfoOpen", "viewerInfoProductId", "dragState", "hoveredHeroVariant", ...Object.keys(originalRegions),
].map((key) => [key, sandbox[key]]));
function assertRestored() {
  for (const [key, value] of Object.entries(originalState)) assert.equal(sandbox[key], value, `${key} must be restored`);
  assert.equal(JSON.stringify(category), savedCategory, "export must not modify the saved category");
  for (const [key, value] of Object.entries(originalRegions)) assert.equal(value.length, 1, `${key} must not gain export hotspots`);
}

const result = await sandbox.renderCategoryImageForPptx(category, exportPage);
assertRestored();
assert.equal(result.width, 2800);
assert.equal(result.height, 770);
assert.equal(result.data, "data:image/jpeg;base64,canvas-0");
assert.deepEqual(Array.from(result.products, (product) => product.id), ["earlier", "later", "other"], "every product is exported once in lane and display order");
assert.equal(canvases.length, 7, "the background, each recorded card, and each isolated artwork use separate canvases");
assert.equal(canvases[0].context.operations.filter((operation) => operation.type === "product").length, 0, "products must not remain embedded in the background");
assert.equal(headers.length, 2, "detailed family headers remain in the background");
assert.ok(headers.every((header) => header.canvas === canvases[0]));
const scale = .7;
const assertNear = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, message || `${actual} differs from ${expected}`);
for (const [index, product] of result.products.entries()) {
  const canvas = canvases[1 + index * 2];
  assert.equal(product.kind, "card");
  assert.equal(product.name, category.board.products.find((item) => item.id === product.id).name);
  assert.equal(product.data, undefined, "no complete product card is rasterized as a picture");
  const nativeTexts = product.elements.filter((element) => element.kind === "text");
  assert.deepEqual(Array.from(nativeTexts, (element) => element.text), [product.name, "$149.99", "USB-C · 20 hours", `SKU-${product.id}`], "name, price, spec, and SKU are recorded as separately editable text");
  assert.equal(nativeTexts[0].bold, true);
  assert.equal(nativeTexts[0].fontSize, 16 * scale);
  assert.equal(nativeTexts[0].align, "center");
  assert.equal(nativeTexts[2].fontSize, 11.5 * scale);
  assert.equal(nativeTexts[2].align, "left");
  const nativeShapes = product.elements.filter((element) => element.kind === "shape");
  assert.deepEqual(Array.from(nativeShapes, (element) => element.shape), ["roundRect", "line"], "the frame and separators are native shapes");
  assert.equal(nativeShapes[0].fill, "#252525");
  assert.equal(nativeShapes[0].lineColor, "#626662");
  assert.equal(nativeShapes[0].lineWidth, scale);
  assert.equal(nativeShapes[0].radius, 4 * scale);
  assert.equal(nativeShapes[0].x, 8 * scale);
  assert.equal(nativeShapes[0].y, 8 * scale);
  assertNear(nativeShapes[0].width, 240 * scale);
  assertNear(nativeShapes[0].height, 450 * scale);
  const pictures = product.elements.filter((element) => element.kind === "image");
  assert.equal(pictures.length, 1, "only product artwork becomes a picture within the card");
  assert.ok(pictures[0].data.startsWith("data:image/png;"), "isolated artwork preserves transparency");
  assert.equal(pictures[0].x, (24 + 8) * scale);
  assert.equal(pictures[0].y, (36 + 8) * scale);
  assertNear(pictures[0].width, 192 * scale);
  assertNear(pictures[0].height, 120 * scale);
  assert.equal(product.width, Math.ceil((240 + 16) * scale));
  assert.equal(product.height, Math.ceil((450 + 16) * scale));
  assert.equal(product.width, canvas.width);
  assert.equal(product.height, canvas.height);
  assert.deepEqual(canvas.context.transform, [scale, 0, 0, scale, 8 * scale, 8 * scale], "individual pictures retain shadow padding");
  assert.equal(canvas.context.operations.filter((operation) => operation.type === "background").length, 0, "the card canvas must remain transparent outside the card");
  assert.deepEqual(canvas.context.operations.filter((operation) => operation.type === "product").map((operation) => operation.productId), [product.id]);
  const logicalX = product.id === "later" ? 288 : 24;
  const logicalY = product.id === "other" ? 602 : 52;
  assert.equal(product.x, (logicalX - 8) * scale);
  assert.equal(product.y, (logicalY - 8) * scale);
}

rejectImage = true;
await assert.rejects(sandbox.renderCategoryImageForPptx(category, exportPage), /image delivery failed/);
assertRestored();
rejectImage = false;
const continuationPage = { ...exportPage, rows: [{ ...exportPage.rows[0], products: [category.board.products[0]], continued: true }] };
const continuation = await sandbox.renderCategoryImageForPptx(category, continuationPage);
assertRestored();
assert.deepEqual(Array.from(continuation.products, (product) => product.id), ["later"], "each rendered page includes only its assigned products, even when its lane has products on other pages");
assert.equal(continuation.width, result.width, "continuation backgrounds retain the category scale");
assert.equal(continuation.height, result.height);
assert.equal(continuation.products[0].width, result.products[1].width, "a partial final page keeps the same native product size");
console.log("PowerPoint cards preserve layout, record editable name/price/spec/SKU and native shapes, isolate artwork, omit product content from the background, and restore workspace state.");
