import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
// Keep dependencies between application helpers real. UI, persistence, and
// canvas painting are adapted below; no gesture or motion rule is recreated.
const functions = [...source.matchAll(/^function \w+\([^]*?^\}/gm)].map((match) => match[0]).join("\n");
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, received ${actual}`);

function harness({ reduced = false, zoom = 1 } = {}) {
  let clock = 1000, nextFrame = 0;
  const frames = new Map(), cards = [], marks = [], paintOrder = [], captures = new Set(), canvasHandlers = new Map();
  const counts = { writes: 0, saves: 0, paints: 0, setups: 0, canvasSizes: 0, status: 0 };
  const products = "abcde".split("").map((id, index) => ({
    id, name: `Product ${id}`, laneId: index < 3 ? "first" : "second", order: index < 3 ? index : index - 3,
    price: 100 + index, specs: [{ label: "Connection", value: "Wireless" }],
    generalAvailabilityDate: "2026-10-08", endManufacturingDate: "2029-10-08", ffsDate: "2026-06-12",
  }));
  const board = { products, lanes: ["first", "second", "third"].map((id, order) => ({ id, order, label: id })), settings: {} };
  const portfolio = { categories: [{ id: "audio", board }] };
  const layout = { cardHeight: 400, laneHeight: 466, detailed: false };
  const laneRows = board.lanes.map((lane, index) => ({ lane, top: 34 + index * layout.laneHeight, contentHeight: layout.cardHeight }));
  let visibleIds = null;
  const scroll = {
    clientWidth: 900, clientHeight: 680, scrollWidth: 3000, scrollHeight: 1800, scrollLeft: 0, scrollTop: 0,
    classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 20, top: 120, right: 920, bottom: 800 }),
  };
  const canvas = {
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
    getBoundingClientRect: () => ({ left: 20 - scroll.scrollLeft, top: 120 - scroll.scrollTop }),
    setPointerCapture: (id) => captures.add(id), hasPointerCapture: (id) => captures.has(id), releasePointerCapture: (id) => captures.delete(id),
    addEventListener(name, callback) { canvasHandlers.set(name, callback); },
  };
  for (const [name, initial] of [["width", 3000], ["height", 1800]]) {
    let value = initial;
    Object.defineProperty(canvas, name, { get: () => value, set(next) { counts.canvasSizes++; value = next; } });
  }
  const paintStack = [];
  const paints = {
    globalAlpha: 1, save() { paintStack.push({ globalAlpha: this.globalAlpha }); }, restore() { Object.assign(this, paintStack.pop()); }, clearRect() { cards.length = 0; marks.length = 0; paintOrder.length = 0; }, setTransform() {}, translate() {},
    fillRect(x, y, width, height) { marks.push({ type: "fillRect", x, y, width, height, fill: this.fillStyle }); },
    strokeRect(x, y, width, height) { marks.push({ type: "strokeRect", x, y, width, height, stroke: this.strokeStyle }); },
    beginPath() {}, rect(x, y, width, height) { marks.push({ type: "rect", x, y, width, height }); },
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {}, stroke() {},
    setLineDash(value) { marks.push({ type: "dash", value: [...value] }); },
    fillText(text, x, y) { marks.push({ type: "text", text: String(text), x, y }); },
    measureText: (text) => ({ width: String(text).length * 6 }),
  };
  canvas.getContext = () => paints;
  const context = {
    board, portfolio, activeCategoryId: "audio", activeView: "products", zoom, searchQuery: "", selectedId: "a",
    productLayoutEditing: true, productReorderSession: { board, portfolio, categoryId: "audio", operations: [] },
    dragState: null, panState: null, productCardMotion: null, productCardMotionFrame: null, pptxExportInProgress: false,
    canvas, canvasScroll: scroll, renderedCards: [], renderedVariantOverflow: [], renderedHeroVariantRegions: [], renderedInfoButtons: [],
    GUTTER: 18, CARD_WIDTH: 246, CARD_GAP: 10, LANE_TOP: 34, SIDE_PADDING: 40,
    PRODUCT_MIN_ZOOM: .2, PRODUCT_MAX_ZOOM: 2,
    viewerInfoProductId: null, viewerInfoProgress: 0, viewerInfoOpen: false, inspectorOpen: false,
    UI_PALETTE: { charcoal800: "#1b1b1b", silver: "#c3c8c5", steelTeal: "#80958f", steelTealLight: "#a7b7b1", whiteSmoke: "#eeeeec", greyOlive: "#929593" },
    performance: { now: () => clock }, devicePixelRatio: 1, matchMedia: () => ({ matches: reduced }), window: { matchMedia: () => ({ matches: reduced }) },
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
  };
  vm.createContext(context); new vm.Script(functions).runInContext(context);
  const realRenderBoard = context.renderBoard;
  const dimensions = { width: 3000, height: 1800, layout, laneRows };
  Object.assign(context, {
    sortedLanes: () => board.lanes,
    visibleProducts: () => board.products.filter((product) => !visibleIds || visibleIds.has(product.id)),
    productCardLayout: () => layout, productLaneGeometry: () => ({ rows: laneRows }), getCanvasDimensions: () => dimensions,
    setupCanvas() { counts.setups++; return { context: paints, dimensions }; },
    roundRect(_paint, x, y, width, height, radius, fill, stroke) { const mark = { type: "roundRect", x, y, width, height, radius, fill, stroke }; marks.push(mark); paintOrder.push(mark); },
    drawCard(_paint, product, x, y, selected, _layout, interactive) { const card = { id: product.id, x, y, selected, interactive, alpha: _paint.globalAlpha }; cards.push(card); paintOrder.push({ type: "card", ...card }); },
    syncBoardNavigator() {}, syncLaneRail() {}, renderStatus() { counts.status++; }, renderLaneRail() {}, syncViewZoomControls() {}, renderInspector() {}, positionViewerInfo() {}, updateProductLayoutEditControls() {}, syncControls() {},
    selectedProduct: () => board.products.find((product) => product.id === context.selectedId),
    scheduleSave() { counts.saves++; },
    updateBoard(mutator) { counts.writes++; mutator(board); counts.saves++; context.renderBoard(); },
    renderBoard() { counts.paints++; realRenderBoard(); },
  });
  const paint = () => context.renderBoard();
  const frame = (milliseconds = 16) => {
    clock += milliseconds;
    const queued = [...frames.entries()]; frames.clear();
    for (const [, callback] of queued) callback(clock);
  };
  const settle = () => { for (let index = 0; frames.size && index < 80; index++) frame(32); assert.equal(frames.size, 0, "Motion settles without leaving an endless animation loop."); };
  const order = (laneId) => board.products.filter((product) => product.laneId === laneId).sort((a, b) => a.order - b.order).map((product) => product.id);
  const snapshot = () => plain(board.products);
  const point = (logicalX, logicalY) => ({ x: logicalX * context.zoom - scroll.scrollLeft + 20, y: logicalY * context.zoom - scroll.scrollTop + 120 });
  const begin = (id = "a") => {
    paint(); const card = context.renderedCards.find((value) => value.productId === id); assert.ok(card);
    const pointer = point(card.x + 20, card.y + 20);
    context.selectedId = id;
    context.dragState = {
      productId: id, pointerId: 7, board, categoryId: "audio", zoom: context.zoom, searchQuery: context.searchQuery,
      version: context.productCardLayoutFingerprint(board), source: { ...card }, moved: false,
      startX: pointer.x, startY: pointer.y, offsetX: 20, offsetY: 20, position: { x: card.x, y: card.y },
    };
    captures.add(7); return { card, pointer };
  };
  return { context, board, portfolio, cards, marks, paintOrder, counts, captures, frames, canvasHandlers, scroll, dimensions, laneRows, layout, paint, frame, settle, order, snapshot, point, begin,
    filter(ids) { visibleIds = ids ? new Set(ids) : null; }, export() { cards.length = 0; marks.length = 0; context.drawBoardTo(paints, { ...dimensions, includeViewer: false }, false, true); return plain(cards); } };
}

assert.equal(typeof harness().context.productCardDropTarget, "function", "Fluid reorder helpers must be present in the application.");

{
  const h = harness(), before = h.snapshot();
  const target = h.context.productCardDropTarget(h.board.products, h.board.products, h.laneRows, "a", { x: 530, y: 500 });
  assert.equal(target.laneId, "second"); assert.equal(target.index, 2); assert.equal(target.displayIndex, 2);
  assert.equal(target.x, 530); assert.equal(target.y, 500);
  const positions = h.context.productCardPreviewPositions(h.board.products, h.laneRows, "a", target);
  assert.deepEqual(plain(positions.get("b")), { x: 18, y: 34, laneId: "first" }, "Preview closes the vacated source slot.");
  assert.deepEqual(plain(positions.get("c")), { x: 274, y: 34, laneId: "first" });
  assert.deepEqual(plain(positions.get("a")), { x: 530, y: 500, laneId: "second" });
  assert.deepEqual(h.snapshot(), before, "Preview positions never update saved lane/order or product facts.");
  const empty = h.context.productCardDropTarget(h.board.products, h.board.products, h.laneRows, "a", { x: 18, y: 966 });
  assert.equal(empty.laneId, "third"); assert.equal(empty.index, 0, "Empty lanes accept a visible first slot.");
  assert.equal(h.context.productCardDropTarget(h.board.products, h.board.products, [], "a", { x: 18, y: 34 }), null);
  assert.equal(h.context.productCardDropTarget(h.board.products, h.board.products, h.laneRows, "missing", { x: 18, y: 34 }), null);
}

for (const hiddenIds of [["h", "a", "b", "c"], ["a", "h", "b", "c"], ["h", "a", "j", "b", "c"]]) {
  const h = harness();
  const template = h.board.products[0];
  h.board.products = hiddenIds.map((id, order) => ({ ...plain(template), id, name: `Product ${id}`, order }));
  h.filter(["a", "b", "c"]); const before = h.snapshot();
  const target = h.context.productCardDropTarget(h.board.products, h.context.visibleProducts(), h.laneRows, "a", { x: 33, y: 34 });
  assert.equal(target.displayIndex, 0);
  const originalIndex = hiddenIds.indexOf("a");
  assert.equal(target.index, originalIndex, "Remaining in the original visible slot preserves hidden products immediately before and after the source.");
  h.begin();
  const pointerBinding = source.match(/^canvas\.addEventListener\("pointermove", \(event\) => \{[^]*?^\}\);/m)?.[0];
  assert.ok(pointerBinding, "Exercise the real pointer intent threshold and preview update.");
  new vm.Script(pointerBinding).runInContext(h.context);
  const drag = h.context.dragState, cursor = h.point(drag.source.x + drag.offsetX + 15, drag.source.y + drag.offsetY);
  h.canvasHandlers.get("pointermove")({ pointerId: 7, clientX: cursor.x, clientY: cursor.y, preventDefault() {}, stopPropagation() {} });
  assert.equal(h.context.dragState?.moved, true, "The no-op test includes intentional movement beyond the pointer threshold.");
  h.context.finishDrag({ pointerId: 7, type: "pointerup" }); h.settle();
  assert.deepEqual(h.snapshot(), before, "A drag within the original visible slot preserves exact full saved order and all hidden records.");
}

function move(h, x = 274, y = 500) {
  h.context.dragState.moved = true;
  const cursor = h.point(x + h.context.dragState.offsetX, y + h.context.dragState.offsetY);
  assert.equal(h.context.updateProductCardDrag(cursor.x, cursor.y), true);
}
function assertLiftedLast(h, id = "a") {
  assert.equal(h.cards.at(-1)?.id, id, "The moving product paints after products in every lane.");
  const liftedIndex = h.paintOrder.findLastIndex((record) => record.type === "card" && record.id === id);
  const lastLaneBackground = h.paintOrder.findLastIndex((record) => record.type === "roundRect" && record.width === h.dimensions.width);
  assert.ok(liftedIndex > lastLaneBackground, "The moving product paints after all lane backgrounds, including lower lanes.");
  assert.equal(h.context.renderedCards.at(-1)?.productId, id, "Hit-testing follows the same topmost product.");
}
const facts = (products) => products.map(({ laneId, order, manualPosition, ...product }) => product);

{
  const h = harness(), before = h.snapshot(); const { card } = h.begin(); move(h);
  const performanceBaseline = { ...h.counts };
  h.frame(); assertLiftedLast(h);
  const ghosts = h.cards.filter((value) => value.id === "a" && value.alpha < .5);
  assert.equal(ghosts.length, 1, "A muted source ghost shows where the product came from.");
  near(ghosts[0].x, card.x, "The ghost remains at the saved source x"); near(ghosts[0].y, card.y, "The ghost remains at the saved source lane");
  assert.equal(ghosts[0].interactive, false, "The source ghost has no live card controls.");
  assert.ok(h.marks.some((value) => value.type === "roundRect" && value.x === 274 && value.y === 500 && value.width === 246 && value.height === 400 && value.stroke), "A distinct destination slot previews the intended insertion.");
  const firstX = h.cards.find((value) => value.id === "e").x;
  assert.ok(firstX > 274 && firstX < 530, "Neighbours animate partway toward the destination instead of jumping.");
  h.frame(32);
  const secondX = h.cards.find((value) => value.id === "e").x;
  assert.ok(secondX > firstX && secondX < 530, "Successive frames progress smoothly toward the slot.");
  assert.equal(h.counts.setups, performanceBaseline.setups, "Transient motion frames never reinitialize the unchanged canvas.");
  assert.equal(h.counts.canvasSizes, performanceBaseline.canvasSizes, "Transient motion frames never rewrite canvas dimensions.");
  assert.equal(h.counts.status, performanceBaseline.status, "Transient motion frames never rebuild the status or header DOM.");
  assert.equal(h.counts.writes, 0); assert.equal(h.counts.saves, 0); assert.deepEqual(h.snapshot(), before);
  h.settle(); assertLiftedLast(h);
  near(h.cards.find((value) => value.id === "e").x, 530, "Neighbours settle exactly at the destination slot");
  assert.deepEqual(h.snapshot(), before, "A fully settled drag preview still leaves saved products untouched.");
}

{
  const h = harness(), before = h.snapshot(); h.begin(); move(h); h.frame();
  h.context.finishDrag({ pointerId: 7, type: "pointerup" });
  assert.equal(h.counts.writes, 1, "Only the completed drop changes saved product order.");
  assert.deepEqual(h.order("first"), ["b", "c"]); assert.deepEqual(h.order("second"), ["d", "a", "e"]);
  assert.deepEqual(facts(h.snapshot()), facts(before), "Dropping changes layout without replacing dates, prices, specifications, or identity.");
  assert.equal(h.captures.has(7), false); assertLiftedLast(h);
  const settling = h.context.productCardMotion;
  h.context.finishDrag({ pointerId: 7, type: "lostpointercapture" });
  assert.equal(h.context.productCardMotion, settling, "Normal pointer release cannot cancel the ensuing drop animation.");
  h.frame(); if (h.context.productCardMotion) assertLiftedLast(h);
  h.settle(); assert.equal(h.context.productCardMotion, null); assert.equal(h.context.productCardMotionFrame, null);
  near(h.cards.find((value) => value.id === "a").x, 274, "The dropped product finishes in its saved slot");
  assert.equal(h.counts.writes, 1, "Settling performs no additional persistence writes.");
}

for (const type of ["pointercancel", "lostpointercapture"]) {
  const h = harness(), before = h.snapshot(); h.begin(); move(h); h.frame();
  const lastShownPosition = plain(h.context.dragState.position);
  h.context.finishDrag({ pointerId: 7, type, clientX: 0, clientY: 0 }); assertLiftedLast(h);
  assert.equal(h.counts.writes, 0); assert.equal(h.captures.has(7), false);
  const start = h.cards.at(-1);
  near(start.x, lastShownPosition.x, "Coordinate-less cancellation starts from the last shown product position");
  near(start.y, lastShownPosition.y, "A synthetic zero-coordinate cancellation cannot jump the product to the origin");
  h.frame();
  if (h.context.productCardMotion) {
    assertLiftedLast(h); const intermediate = h.cards.at(-1);
    assert.ok(intermediate.x < start.x && intermediate.x > 18, "A canceled product glides back toward its original slot.");
    assert.ok(intermediate.y < start.y && intermediate.y > 34);
  }
  h.settle(); near(h.cards.find((value) => value.id === "a").x, 18, "Cancellation restores the source x");
  near(h.cards.find((value) => value.id === "a").y, 34, "Cancellation restores the source lane");
  assert.deepEqual(h.snapshot(), before, "Canceled pointers never modify saved order or product facts.");
}

{
  const h = harness({ reduced: true }), before = h.snapshot(); h.begin(); move(h); h.frame();
  near(h.cards.find((value) => value.id === "e").x, 530, "Reduced motion snaps the neighbouring slots immediately");
  assertLiftedLast(h); assert.deepEqual(h.snapshot(), before);
  h.context.finishDrag({ pointerId: 7, type: "pointercancel" }); h.settle();
  near(h.cards.find((value) => value.id === "a").x, 18, "Reduced motion cancels without lingering interpolation");
}

for (const invalidation of ["zoom", "filter", "external order", "external lane", "category", "board"]) {
  const h = harness(); h.begin(); move(h); h.frame();
  if (invalidation === "zoom") h.context.zoom = .7;
  if (invalidation === "filter") { h.context.searchQuery = "new search"; h.filter(["a", "c"]); }
  if (invalidation === "external order") h.board.products.find((value) => value.id === "b").order = 9;
  if (invalidation === "external lane") h.board.products.find((value) => value.id === "a").laneId = "second";
  if (invalidation === "category") h.context.activeCategoryId = "another-category";
  if (invalidation === "board") h.context.board = { ...h.board, products: [...h.board.products] };
  const latest = h.snapshot(), paints = h.counts.paints;
  h.frame(); assert.equal(h.context.dragState, null); assert.equal(h.context.productCardMotion, null);
  assert.equal(h.context.productCardMotionFrame, null); assert.equal(h.captures.has(7), false);
  assert.equal(h.counts.writes, 0); assert.deepEqual(h.snapshot(), latest, `${invalidation}: a stale gesture never overwrites the newer view or saved layout.`);
  if (["category", "board"].includes(invalidation)) assert.equal(h.counts.paints, paints, "A stale animation cannot repaint a different board or category on the live canvas.");
}

{
  const h = harness(); h.begin(); move(h); h.frame();
  const product = h.board.products.find((value) => value.id === "a"); product.name = "Latest team name"; product.specs[0].value = "Latest team specs"; product.ffsDate = "2027-01-12";
  h.context.finishDrag({ pointerId: 7, type: "pointerup" }); h.settle();
  assert.equal(h.counts.writes, 1, "An unrelated facts update does not reject an otherwise valid layout move.");
  assert.equal(product.name, "Latest team name"); assert.equal(product.specs[0].value, "Latest team specs"); assert.equal(product.ffsDate, "2027-01-12");
}

for (const zoom of [.7, 1.5, 2]) {
  const h = harness({ zoom }); h.begin();
  // At 200% the user scrolls to the destination while the pointer is captured.
  // Keep that destination in the viewport so this check isolates scale mapping
  // from the separately tested edge-scrolling behavior.
  if (zoom === 2) { h.scroll.scrollLeft = 200; h.scroll.scrollTop = 500; }
  move(h, 274, 350); h.frame();
  near(h.cards.at(-1).x, 274, "Dragged positions retain logical horizontal geometry at different scales");
  near(h.cards.at(-1).y, 350, "Dragged positions retain logical lane geometry at different scales");
  h.context.stopProductCardDrag(); assert.equal(h.frames.size, 0);
}

{
  const h = harness({ zoom: 2 }), before = h.snapshot(); h.begin();
  h.scroll.scrollLeft = 200; h.scroll.scrollTop = 500;
  move(h, 274, 500); h.frame(); assertLiftedLast(h);
  const ghost = h.cards.find((value) => value.id === "a" && value.alpha < .5);
  near(ghost.x, 18, "The 200% source ghost retains its saved horizontal slot.");
  near(ghost.y, 34, "The 200% source ghost retains its saved lane.");
  h.context.finishDrag({ pointerId: 7, type: "pointerup" }); h.settle();
  assert.deepEqual(h.order("first"), ["b", "c"]);
  assert.deepEqual(h.order("second"), ["d", "a", "e"], "A scrolled 200% drop targets the intended destination slot.");
  near(h.cards.find((value) => value.id === "a").x, 274, "The 200% drop settles at the intended horizontal slot.");
  near(h.cards.find((value) => value.id === "a").y, 500, "The 200% drop settles at the intended lane position.");
  assert.equal(h.counts.writes, 1, "A 200% drop saves the reorder once.");
  assert.deepEqual(facts(h.snapshot()), facts(before), "A 200% drop preserves all product facts and dates.");
}

{
  const h = harness(); h.begin(); h.context.dragState.moved = true;
  h.context.updateProductCardDrag(916, 795); const before = h.snapshot();
  h.frame(16);
  assert.ok(h.scroll.scrollLeft > 0 && h.scroll.scrollTop > 0, "The stationary pointer continuously scrolls both axes at viewport edges.");
  const first = { left: h.scroll.scrollLeft, top: h.scroll.scrollTop };
  h.frame(32);
  assert.ok(h.scroll.scrollLeft > first.left && h.scroll.scrollTop > first.top, "Edge scrolling keeps progressing without a new pointer event.");
  assert.deepEqual(h.snapshot(), before); assert.equal(h.counts.writes, 0);
  h.context.stopProductCardDrag(); assert.equal(h.frames.size, 0, "Stopping the gesture stops continuous edge scrolling.");
}

{
  const h = harness(); h.begin(); move(h); h.frame(); const motion = h.context.productCardMotion;
  const positions = plain([...motion.positions]); const frameCount = h.frames.size;
  const exported = h.export();
  assert.equal(exported.filter((value) => value.id === "a").length, 1, "Exports contain one saved product, with no source ghost.");
  assert.deepEqual(exported.find((value) => value.id === "a"), { id: "a", x: 18, y: 34, selected: false, interactive: false, alpha: 1 }, "Exports use the saved slot instead of the floating preview position.");
  assert.equal(h.marks.some((value) => value.type === "text" && value.text === "Move here"), false, "Exports omit destination hints.");
  assert.equal(h.context.productCardMotion, motion); assert.deepEqual(plain([...motion.positions]), positions);
  assert.equal(h.frames.size, frameCount, "Export drawing does not queue, advance, or cancel live motion.");
  h.frame(); assertLiftedLast(h);
  h.context.pptxExportInProgress = true;
  h.context.board = { products: [{ id: "foreign", name: "Other export category", laneId: "first", order: 0 }], lanes: h.board.lanes, settings: {} };
  h.context.activeCategoryId = "foreign-export-category";
  const paints = h.counts.paints, hits = plain(h.context.renderedCards);
  h.frame();
  assert.equal(h.counts.paints, paints, "A queued animation during an asynchronous export cannot paint the temporary export board.");
  assert.deepEqual(plain(h.context.renderedCards), hits, "The temporary export board never replaces live hit regions through animation.");
  assert.equal(h.context.productCardMotion, null); assert.equal(h.counts.writes, 0);
}

console.log("Product reorder motion checks passed: real pointer intent, filtered no-op order, empty lanes, source/destination feedback, topmost lifted cards, smooth and reduced motion, safe drop/cancel, efficient frames, geometry and stale-change guards, continuous edge scrolling, and clean exports.");
