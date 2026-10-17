import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../../public/css/styles.css", import.meta.url), "utf8");
const functions = [...source.matchAll(/^function \w+\([^]*?^\}\r?$/gm)].map(match => match[0]).join("\n");
const bindings = source.slice(source.indexOf('// Observe additional fingers'), source.indexOf('canvas.addEventListener("dblclick"'));
assert.ok(bindings.includes('window.addEventListener("pointerdown"'), "Exercise the actual canvas and window touch listeners.");
const wheelBinding = source.match(/^canvasScroll\.addEventListener\("wheel",[^]*?^\}, \{ passive: false \}\);/m)?.[0];
assert.ok(wheelBinding);
assert.match(css, /#boardCanvas\s*\{\s*touch-action:\s*pan-y pinch-zoom;/, "Viewer touch action is configured before gestures start.");
assert.match(css, /#boardCanvas\.is-layout-editing\s*\{\s*touch-action:\s*none;/, "Only explicit reorder takes ownership of both axes.");
assert.match(css, /#roadmapCanvas, #splitRoadmapCanvas\s*\{\s*touch-action:\s*none;/, "Roadmap behavior stays outside this change.");
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ editing = false } = {}) {
  const handlers = new Map(), windowHandlers = new Map(), scrollHandlers = new Map(), captures = new Set(), classes = new Set();
  const counts = { writes: 0, saves: 0, reads: [], pins: [], popovers: 0, paints: 0 };
  const board = {
    products: [
      { id: "a", name: "Cloud III Wireless", laneId: "first", order: 2, price: 149, specs: [{ label: "Connection", value: "Wireless" }] },
      { id: "b", name: "Cloud Alpha", laneId: "first", order: 9, price: 99, specs: [{ label: "Connection", value: "Wired" }] },
      { id: "c", name: "Pulsefire Haste", laneId: "second", order: 4, price: 59, specs: [{ label: "Connection", value: "Wireless" }] },
    ], lanes: [{ id: "first", order: 0 }, { id: "second", order: 1 }], settings: {},
  };
  const portfolio = { categories: [{ id: "audio", board }, { id: "other", board: { products: [], lanes: [{ id: "empty", order: 0 }], settings: {} } }] };
  const node = () => ({ disabled: false, style: {}, value: "", classList: { add: name => classes.add(name), remove: name => classes.delete(name), toggle(name, force) { force ? classes.add(name) : classes.delete(name); } }, setAttribute() {}, querySelector: () => node(), closest: () => node(), focus() {} });
  const scroll = Object.assign(node(), { scrollLeft: 200, scrollTop: 80, clientWidth: 400, scrollWidth: 1200, addEventListener: (type, handler) => scrollHandlers.set(type, handler) });
  const canvas = Object.assign(node(), {
    getBoundingClientRect: () => ({ left: -scroll.scrollLeft, top: -scroll.scrollTop }),
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id),
    addEventListener: (type, handler) => handlers.set(type, handler),
  });
  const rows = board.lanes.map((lane, index) => ({ lane, top: 34 + index * 500, contentHeight: 400 }));
  const dimensions = { width: 1200, height: 1100, laneRows: rows };
  const context = {
    board, portfolio, activeCategoryId: "audio", activeView: "products", selectedId: "a", zoom: 1, searchQuery: "",
    panState: null, dragState: null, productCardMotion: null, productCardMotionFrame: null, productTouchPointers: new Set(),
    productLayoutEditing: editing, productReorderSession: editing ? { board, portfolio, categoryId: "audio", operations: [] } : null,
    canvas, canvasScroll: scroll, renderedCards: [], renderedInfoButtons: [], renderedHeroVariantRegions: [], renderedVariantOverflow: [],
    variantPopoverPinned: false, variantPopoverKey: "", hoveredHeroVariant: null, hoveredInfoButtonProductId: "", viewerInfoProductId: null, viewerInfoProgress: 0,
    GUTTER: 18, CARD_WIDTH: 246, CARD_GAP: 10, LANE_TOP: 34,
    window: { addEventListener(type, handler) { if (!windowHandlers.has(type)) windowHandlers.set(type, []); windowHandlers.get(type).push(handler); } },
    document: { querySelectorAll: () => [] }, cancelAnimationFrame() {}, requestAnimationFrame() {},
    productLayoutEditButton: node(), productControls: node(), roadmapControls: node(), productView: node(), roadmapView: node(), splitView: node(),
    roadmapLaneHovers: [], roadmapPanState: null, roadmapDetailsOpen: false, roadmapInteractionMode: "pan", ROADMAP_DEFAULT_MONTH_WIDTH: 82, initialVerticalFitPending: false,
    viewerInfoOutline: null, viewerInfoOpen: false, roadmapMonthWidth: 82,
    $: () => node(), scheduleSave() { counts.saves++; }, showWorkspaceNotice() {}, closePopupMenus() {}, closeViewerInfo() {},
    renderInspector() {}, updateDataEditIndicator() {}, syncControls() {}, syncBoardNavigator() {}, stopRoadmapSlotEditing() {},
    updateLinkedViewButton() {}, updateRoadmapEditControls() {}, syncRoadmapDetailsVisibility() {}, closeInspector() {},
    scheduleVariantPopoverOpen() {}, scheduleVariantPopoverClose() {}, setHoveredHeroVariant() {},
    PortfolioModel: { syncTimelineSettings() {} }, categoryDefinition: () => ({}), ensureBoardSchema: value => value,
  };
  vm.createContext(context); vm.runInContext(functions, context);
  Object.assign(context, {
    categoryDefinition: () => ({}), ensureBoardSchema: value => value, scheduleSave() { counts.saves++; },
    renderInspector() {}, syncControls() {}, syncBoardNavigator() {}, stopRoadmapSlotEditing() {}, updateProductLayoutEditControls() {},
    closePopupMenus() {}, closeViewerInfo() {}, closeInspector() {}, updateLinkedViewButton() {}, updateRoadmapEditControls() {}, syncRoadmapDetailsVisibility() {},
    scheduleVariantPopoverOpen() {}, scheduleVariantPopoverClose() {}, setHoveredHeroVariant() {},
    selectedProduct: () => context.board.products.find(product => product.id === context.selectedId),
    sortedLanes: () => context.board.lanes, visibleProducts: () => context.board.products, productLaneGeometry: () => ({ rows }),
    getCanvasDimensions: () => dimensions, queueProductCardMotion() {},
    updateBoard(mutator) { counts.writes++; mutator(context.board); counts.saves++; context.renderBoard(); },
    renderBoard() {
      counts.paints++;
      context.renderedCards = [...context.productCardPreviewPositions(context.board.products, rows)].map(([productId, position]) => ({ productId, ...position, width: 246, height: 400 }));
      if (context.productCardMotion) context.productCardMotion.dimensions = dimensions;
    },
    renderActiveView() { context.renderBoard(); },
    openViewerInfo(id) { counts.reads.push(id); }, togglePinnedHeroVariant(id, variant) { counts.pins.push([id, variant]); },
    closeVariantPopover() {}, openVariantPopover() { counts.popovers++; }, clearSelection() { context.selectedId = null; },
  });
  vm.runInContext(bindings + wheelBinding, context); context.renderBoard();
  function event(type, options = {}) {
    return { type, pointerType: "touch", pointerId: 1, isPrimary: true, button: 0, clientX: 40, clientY: 60,
      prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...options };
  }
  const windowEvent = (type, options = {}) => { const e = event(type, options); for (const callback of windowHandlers.get(type) || []) callback(e); return e; };
  const send = (type, options = {}) => { const e = windowEvent(type, options); handlers.get(type)?.(e); return e; };
  const snapshot = () => plain(context.board.products);
  const point = (x, y) => ({ clientX: x - scroll.scrollLeft, clientY: y - scroll.scrollTop });
  return { context, counts, board, scroll, captures, classes, send, windowEvent, event, snapshot, point, wheel: options => { const e = event("wheel", { deltaX: 20, deltaY: 0, ...options }); scrollHandlers.get("wheel")(e); return e; } };
}

for (const target of ["blank", "card", "info", "hero", "overflow"]) {
  const h = harness(), before = h.snapshot();
  const point = target === "blank" ? { clientX: 800, clientY: 600 } : h.point(70, 70);
  const region = { productId: "b", variantId: "black", key: "variant", x: 50, y: 50, width: 60, height: 60 };
  if (target === "info") h.context.renderedInfoButtons = [region];
  if (target === "hero") h.context.renderedHeroVariantRegions = [region];
  if (target === "overflow") h.context.renderedVariantOverflow = [region];
  const down = h.send("pointerdown", point);
  assert.equal(down.prevented, false, `${target}: starting a touch does not prevent native scrolling.`);
  assert.equal(h.captures.size, 0, `${target}: no explicit capture before intent.`);
  const move = h.send("pointermove", { ...point, clientY: point.clientY + 30 });
  assert.equal(move.prevented, false); assert.equal(h.context.panState, null);
  h.send("pointerup", { ...point, clientY: point.clientY + 30 });
  assert.equal(h.context.selectedId, "a"); assert.deepEqual(h.counts.reads, []); assert.deepEqual(h.counts.pins, []); assert.equal(h.counts.popovers, 0);
  assert.equal(h.scroll.scrollLeft, 200); assert.equal(h.scroll.scrollTop, 80, "Native scrolling, rather than synthetic vertical positioning, owns the vertical axis.");
  assert.deepEqual(h.snapshot(), before); assert.equal(h.counts.writes, 0);
}

{
  const h = harness(), before = h.snapshot(), start = h.point(70, 70);
  h.send("pointerdown", start);
  h.send("pointermove", { ...start, clientX: start.clientX - 4, clientY: start.clientY + 1 });
  assert.equal(h.scroll.scrollLeft, 200); assert.equal(h.captures.size, 0);
  const move = h.send("pointermove", { ...start, clientX: start.clientX - 35, clientY: start.clientY + 3 });
  assert.equal(move.prevented, true); assert.equal(h.scroll.scrollLeft, 235); assert.ok(h.captures.has(1)); assert.ok(h.classes.has("is-panning"));
  h.send("pointerup", { ...start, clientX: start.clientX - 35 });
  assert.equal(h.captures.size, 0); assert.equal(h.classes.has("is-panning"), false); assert.deepEqual(h.snapshot(), before);
  assert.equal(h.counts.writes, 0); assert.equal(h.counts.saves, 0);
}

{
  const h = harness(), before = h.snapshot(), start = h.point(70, 70);
  h.send("pointerdown", start); h.send("pointermove", { ...start, clientX: start.clientX - 40 });
  assert.ok(h.captures.has(1));
  h.windowEvent("pointerdown", { pointerId: 2, isPrimary: false });
  assert.equal(h.context.panState, null); assert.equal(h.captures.size, 0); assert.equal(h.classes.has("is-panning"), false);
  h.send("pointerup", start); h.windowEvent("pointerup", { pointerId: 2, isPrimary: false });
  assert.deepEqual(h.snapshot(), before); assert.equal(h.counts.writes, 0); assert.equal(h.context.productTouchPointers.size, 0);
}

{
  const h = harness(), start = h.point(70, 70);
  h.context.renderedInfoButtons = [{ productId: "b", x: 50, y: 50, width: 60, height: 60 }];
  h.send("pointerdown", start); h.send("pointerup", { ...start, clientX: start.clientX + 12 });
  assert.deepEqual(h.counts.reads, [], "A distant pointerup without a final move is never mistaken for a tap.");
}

for (const target of ["card", "info", "hero", "overflow", "blank"]) {
  const h = harness(), before = h.snapshot(), start = target === "blank" ? { clientX: 900, clientY: 700 } : h.point(70, 70);
  const region = { productId: "b", variantId: "black", key: "variant", x: 50, y: 50, width: 60, height: 60 };
  if (target === "info") h.context.renderedInfoButtons = [region];
  if (target === "hero") h.context.renderedHeroVariantRegions = [region];
  if (target === "overflow") h.context.renderedVariantOverflow = [region];
  if (target === "card") h.context.selectedId = "c";
  h.send("pointerdown", start); assert.equal(h.counts.reads.length + h.counts.pins.length + h.counts.popovers, 0);
  h.send("pointerup", start);
  if (target === "info") assert.deepEqual(h.counts.reads, ["b"]);
  if (target === "hero") assert.deepEqual(h.counts.pins, [["b", "black"]]);
  if (target === "overflow") assert.equal(h.counts.popovers, 1);
  if (target === "blank") assert.equal(h.context.selectedId, null);
  if (target === "card") assert.equal(h.context.selectedId, "a");
  assert.deepEqual(h.snapshot(), before); assert.equal(h.counts.writes, 0);
}

for (const interruption of ["pointercancel", "lostpointercapture", "blur", "second-finger", "view", "category", "search", "zoom"]) {
  const h = harness(), before = h.snapshot(), start = h.point(70, 70);
  h.context.renderedInfoButtons = [{ productId: "b", x: 50, y: 50, width: 60, height: 60 }];
  h.send("pointerdown", start);
  if (["pointercancel", "lostpointercapture"].includes(interruption)) h.send(interruption, start);
  if (interruption === "blur") h.windowEvent("blur");
  if (interruption === "second-finger") h.windowEvent("pointerdown", { pointerId: 2, isPrimary: false });
  if (interruption === "view") h.context.setView("roadmap");
  if (interruption === "category") h.context.activateCategory("other", { render: false, fitVertical: false });
  if (interruption === "search") h.context.searchQuery = "hidden";
  if (interruption === "zoom") h.context.zoom = .8;
  h.send("pointerup", start);
  assert.equal(h.context.panState, null, interruption); assert.equal(h.captures.size, 0, interruption);
  assert.deepEqual(h.counts.reads, [], `${interruption}: stale pointerup cannot activate a reading panel.`);
  assert.deepEqual(plain(h.board.products), before, `${interruption}: all product facts and placement survive.`);
  assert.equal(h.counts.writes, 0);
}

for (const pointerType of ["mouse", "pen"]) {
  const h = harness(), before = h.snapshot(), start = h.point(70, 70);
  h.send("pointerdown", { ...start, pointerType }); assert.ok(h.captures.has(1));
  h.send("pointermove", { ...start, pointerType, clientX: start.clientX - 30 });
  assert.equal(h.scroll.scrollLeft, 230);
  h.send("pointerup", { ...start, pointerType, clientX: start.clientX - 30 });
  assert.equal(h.context.panState, null); assert.deepEqual(h.snapshot(), before);
}

for (const interruption of ["pointercancel", "lostpointercapture", "blur", "second-finger", "stale-layout", "done", "cancel", "commit"]) {
  const h = harness({ editing: true }), before = h.snapshot(), start = h.point(38, 54), destination = h.point(38, 554);
  h.send("pointerdown", start); assert.ok(h.context.dragState); assert.ok(h.captures.has(1));
  h.send("pointermove", destination); assert.equal(h.context.dragState.moved, true); assert.equal(h.context.dragState.dropTarget.laneId, "second");
  assert.deepEqual(h.snapshot(), before, "Actual drag preview never mutates saved product placement.");
  if (["pointercancel", "lostpointercapture"].includes(interruption)) h.send(interruption, destination);
  if (interruption === "blur") h.windowEvent("blur");
  if (interruption === "second-finger") h.windowEvent("pointerdown", { pointerId: 2, isPrimary: false });
  if (interruption === "stale-layout") h.board.products[1].order = 23;
  if (interruption === "done" || interruption === "cancel") h.context.finishProductReorder({ cancel: interruption === "cancel" });
  h.send("pointerup", destination);
  assert.equal(h.context.dragState, null, interruption); assert.equal(h.captures.size, 0, interruption);
  if (interruption === "commit") {
    assert.equal(h.board.products[0].laneId, "second"); assert.equal(h.counts.writes, 1);
    h.board.products[0].name = "Unrelated new name";
    h.context.finishProductReorder({ cancel: true });
    const expected = plain(before); expected[0].name = "Unrelated new name";
    assert.deepEqual(h.snapshot(), expected, "Guarded Cancel restores exact sparse placements while preserving unrelated edits.");
  } else {
    const expected = plain(before); if (interruption === "stale-layout") expected[1].order = 23;
    assert.deepEqual(h.snapshot(), expected); assert.equal(h.counts.writes, 0, `${interruption}: no stale touch drop commits.`);
  }
}

{
  const h = harness();
  assert.equal(h.wheel({ ctrlKey: true }).prevented, false); assert.equal(h.scroll.scrollLeft, 200, "Trackpad pinch preserves browser zoom.");
  assert.equal(h.wheel({ metaKey: true }).prevented, false);
  assert.equal(h.wheel({ deltaX: 0, deltaY: 40 }).prevented, false, "Vertical wheel remains native.");
  assert.equal(h.wheel({ deltaX: 0, deltaY: 40, shiftKey: true }).prevented, true); assert.equal(h.scroll.scrollLeft, 240);
}

console.log("Products touch checks passed: native vertical/pinch contract, delayed taps, directional horizontal capture, mouse/pen navigation, multi-touch/cancel/blur/view/category cleanup, guarded reorder/drop/Cancel, exact product invariants, and browser zoom wheel ownership.");
