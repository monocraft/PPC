import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
const masterUi = await readFile(new URL("../../public/js/master-ui.js", import.meta.url), "utf8");
const names = ["captureProductCardLayout", "restoreProductCardReorder", "productCardDropTarget", "productCardLayoutFingerprint", "productCardMotionValid", "stopProductCardDrag", "startProductReorder", "finishProductReorder", "handleProductReorderKeydown", "reorderProduct", "normalizeLaneOrders", "updateProductLayoutEditControls", "activateCategory", "setView", "finishDrag"];
const functions = names.map((name) => {
  const match = source.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, `Exercise the actual ${name} function`);
  return match[0];
}).join("\n");
const plain = (value) => JSON.parse(JSON.stringify(value));
function harness() {
  const focus = [], counts = { saves: 0, writes: 0, paints: 0 }, notices = [];
  const nodes = new Map();
  function node(id = "") {
    const classes = new Set(), attributes = {};
    return { id, style: {}, attributes, value: "", disabled: false,
      classList: { contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name), toggle(name, force) { const active = force ?? !classes.has(name); if (active) classes.add(name); else classes.delete(name); return active; } },
      setAttribute(name, value) { attributes[name] = value; }, focus(options) { focus.push({ id, options: plain(options) }); },
      querySelector: () => get("sort-menu"), closest: () => get("controls"),
    };
  }
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); };
  const products = "abcde".split("").map((id, index) => ({ id, name: id.toUpperCase(), laneId: index < 3 ? "first" : "second", order: index < 3 ? index : index - 3, price: 100 + index, specs: [{ label: "Mic", value: "Yes" }], ffsDate: "2026-10-08", manualPosition: { x: index * 100, y: 34 } }));
  const board = { products, lanes: ["first", "second", "third"].map((id, order) => ({ id, order })), settings: {} };
  const portfolio = { categories: [{ id: "audio", board }, { id: "keyboard", board: { products: [], lanes: [{ id: "keys", order: 0 }], settings: {} } }] };
  const captures = new Set();
  const canvas = get("canvas"); Object.assign(canvas, { hasPointerCapture: (id) => captures.has(id), releasePointerCapture: (id) => captures.delete(id), setPointerCapture: (id) => captures.add(id) });
  const context = {
    board, portfolio, activeCategoryId: "audio", activeView: "products", selectedId: "a", productLayoutEditing: false, productReorderSession: null, dragState: null, panState: null, productCardMotion: null, productCardMotionFrame: null, zoom: 1, searchQuery: "",
    productLayoutEditButton: get("productLayoutEditToggle"), productControls: get("productControls"), roadmapControls: get("roadmapControls"), canvas,
    $: (selector) => get(selector.slice(1)), scheduleSave: () => counts.saves++, syncControls() {}, renderInspector() {}, renderActiveView() { counts.paints++; }, renderBoard() { counts.paints++; }, updateDataEditIndicator() {},
    closePopupMenus() {}, showWorkspaceNotice: (message, options) => notices.push({ message, options }), selectedProduct: () => context.board.products.find((product) => product.id === context.selectedId), sortedLanes: () => context.board.lanes,
    updateBoard(mutator) { counts.writes++; mutator(context.board); context.scheduleSave(); context.updateProductLayoutEditControls(); },
    closeViewerInfo() {}, viewerInfoOutline: get("outline"), viewerInfoProgress: 0, viewerInfoProductId: null, viewerInfoOpen: false,
    ensureBoardSchema: (value) => value, categoryDefinition: () => ({}), PortfolioModel: { syncTimelineSettings() {} }, closeInspector() {}, closeVariantPopover() {}, hoveredHeroVariant: null, stopRoadmapSlotEditing() {}, initialVerticalFitPending: false, fitProductLanesVertically() {},
    roadmapPanState: null, roadmapInteractionMode: "pan", roadmapDetailsOpen: false, productView: get("productView"), roadmapView: get("roadmapView"), splitView: get("splitView"), syncRoadmapDetailsVisibility() {}, updateLinkedViewButton() {}, updateRoadmapEditControls() {},
    document: { querySelectorAll: () => [] }, requestAnimationFrame: (callback) => callback(), cancelAnimationFrame() {}, scrollSelectedIntoView() {}, scrollRoadmapSelected() {}, roadmapScroll: {}, splitRoadmapScroll: {}, startProductCardSettling() {}, updateProductCardDrag() {},
    productLaneGeometry: () => ({ rows: [{ lane: { id: "first" }, top: 34 }, { lane: { id: "second" }, top: 650 }] }), GUTTER: 18, CARD_WIDTH: 246, CARD_GAP: 10, syncBoardNavigator() {}, canvasScroll: { classList: get("scroll").classList },
  };
  vm.createContext(context); new vm.Script(functions).runInContext(context);
  const handlers = source.match(/^productLayoutEditButton\.onclick =[^]*?^\};/m)?.[0]
    + "\n" + source.match(/^\$\("#productReorderDone"\)\.onclick[^\n]*/m)?.[0]
    + "\n" + source.match(/^\$\("#productReorderCancel"\)\.onclick[^\n]*/m)?.[0];
  new vm.Script(handlers).runInContext(context);
  const layouts = () => plain(context.board.products.map(({ id, laneId, order, manualPosition }) => ({ id, laneId, order, manualPosition })));
  const order = (laneId) => context.board.products.filter((product) => product.laneId === laneId).sort((a, b) => a.order - b.order).map((product) => product.id);
  const event = (key, options = {}) => ({ key, target: canvas, altKey: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...options });
  const gesture = (options = {}) => {
    const position = options.position || { x: 274, y: 650 };
    return { pointerId: 1, productId: "a", moved: true, position, source: { x: 18, y: 34, laneId: "first" }, board: context.board, categoryId: context.activeCategoryId, zoom: context.zoom, searchQuery: context.searchQuery, version: context.productCardLayoutFingerprint(), dropTarget: context.productCardDropTarget(context.board.products, context.board.products, context.productLaneGeometry().rows, options.productId || "a", position), ...options };
  };
  return { context, board, portfolio, nodes, get, focus, counts, notices, captures, layouts, order, event, gesture };
}

{
  const h = harness(), baseline = h.layouts(); h.context.productLayoutEditButton.onclick();
  assert.equal(h.context.productLayoutEditing, true); assert.equal(h.get("productLayoutEditToggle").classList.contains("hidden"), true);
  assert.equal(h.get("productLayoutEditToggle").attributes["aria-expanded"], "true");
  assert.equal(h.get("productReorderActions").classList.contains("hidden"), false);
  assert.equal(h.get("sort-menu").classList.contains("hidden"), true);
  assert.equal(h.focus.at(-1).id, "productReorderDone");
  h.context.reorderProduct("a", "second", 1); h.context.reorderProduct("e", "first", 0);
  const session = h.context.productReorderSession; h.context.startProductReorder(); assert.equal(h.context.productReorderSession, session, "Repeated start never replaces the undo session");
  const a = h.board.products.find((product) => product.id === "a"); a.name = "Edited name"; a.price = 25; a.specs[0].value = "No"; a.ffsDate = "2027-02-01";
  h.get("productReorderCancel").onclick();
  assert.deepEqual(h.layouts(), baseline, "Cancel restores card order, lane assignment, and previous manual positions");
  assert.equal(a.name, "Edited name"); assert.equal(a.price, 25); assert.equal(a.specs[0].value, "No"); assert.equal(a.ffsDate, "2027-02-01", "Unrelated drafts survive cancellation");
  assert.equal(h.context.productLayoutEditing, false); assert.equal(h.context.productReorderSession, null);
  assert.equal(h.get("productReorderActions").classList.contains("hidden"), true); assert.equal(h.get("sort-menu").classList.contains("hidden"), false);
  assert.equal(h.focus.at(-1).id, "productLayoutEditToggle", "Finishing returns keyboard focus to the visible entry button");
}
{
  const h = harness(); h.context.startProductReorder(); h.context.reorderProduct("a", "first", 2); const accepted = h.layouts();
  h.get("productReorderDone").onclick(); assert.deepEqual(h.layouts(), accepted);
  assert.equal(h.context.handleProductReorderKeydown(h.event("Escape")), false, "Done ends the cancellation session");
  h.context.startProductReorder(); h.context.reorderProduct("a", "second", 0); h.context.finishProductReorder({ cancel: true });
  assert.deepEqual(h.layouts(), accepted, "A later session only undoes its own moves");
}
{
  const h = harness(); h.context.startProductReorder(); h.context.reorderProduct("a", "second", 1);
  h.board.products = h.board.products.filter((product) => product.id !== "c");
  h.board.products.push({ id: "new", name: "New product", laneId: "first", order: -1, specs: [{ label: "Keys", value: "Optical" }] });
  h.context.finishProductReorder({ cancel: true });
  assert.deepEqual(h.order("first"), ["new", "a", "b"]); assert.deepEqual(h.order("second"), ["d", "e"]);
  assert.ok(!h.board.products.some((product) => product.id === "c"), "Cancel does not resurrect deleted products");
  assert.equal(h.board.products.find((product) => product.id === "new").specs[0].value, "Optical", "New records and their facts remain intact");
}
{
  const h = harness(); h.context.startProductReorder(); h.context.reorderProduct("a", "first", 2);
  const a = h.board.products.find((product) => product.id === "a"), b = h.board.products.find((product) => product.id === "b"), c = h.board.products.find((product) => product.id === "c");
  a.order = 0; c.order = 1; b.order = 2; const latest = h.layouts();
  h.context.finishProductReorder({ cancel: true }); assert.deepEqual(h.layouts(), latest, "Cancel never overwrites a later external reorder");
  assert.equal(h.notices.length, 1); assert.equal(h.notices[0].options.severity, "warning");
}
{
  const h = harness(); h.context.startProductReorder(); h.context.reorderProduct("a", "first", 2); h.context.reorderProduct("d", "second", 1);
  h.board.products.find((product) => product.id === "b").manualPosition = { x: 1234, y: 89 };
  h.context.finishProductReorder({ cancel: true });
  assert.deepEqual(h.order("first"), ["b", "c", "a"], "A conflicting lane is kept as a complete layout");
  assert.deepEqual(h.order("second"), ["d", "e"], "An independent, unaffected lane still cancels");
  assert.equal(h.board.products.find((product) => product.id === "b").manualPosition.x, 1234);
}
{
  const h = harness(); h.context.startProductReorder(); h.context.reorderProduct("a", "second", 1); h.context.reorderProduct("d", "third", 0);
  h.board.products.find((product) => product.id === "a").manualPosition = { x: 901, y: 77 }; const current = h.layouts();
  h.context.finishProductReorder({ cancel: true });
  assert.deepEqual(h.layouts(), current, "Conflict protection propagates through connected moves instead of undoing older shared positions");
}
{
  const h = harness(); h.context.startProductReorder(); h.context.reorderProduct("a", "first", 2); const latest = h.layouts();
  h.context.portfolio = { categories: [] }; h.context.finishProductReorder({ cancel: true });
  assert.deepEqual(h.layouts(), latest, "A replacement portfolio never receives a stale session rollback");
}
{
  const h = harness(); h.context.startProductReorder(); h.context.reorderProduct("a", "second", 0); const latest = h.layouts();
  h.board.lanes = h.board.lanes.filter((lane) => lane.id !== "first"); h.context.finishProductReorder({ cancel: true });
  assert.deepEqual(h.layouts(), latest, "Cancel cannot move cards back into a removed lane");
}
{
  const h = harness(), baseline = h.layouts(); h.context.startProductReorder(); h.context.reorderProduct("a", "first", 2);
  h.context.dragState = h.gesture({ pointerId: 13, productId: "b" }); h.captures.add(13);
  const event = h.event("Escape"); assert.equal(h.context.handleProductReorderKeydown(event), true);
  assert.ok(event.prevented && event.stopped); assert.equal(h.context.selectedId, "a"); assert.deepEqual(h.layouts(), baseline);
  assert.equal(h.context.dragState, null); assert.equal(h.captures.has(13), false, "Cancellation releases an in-progress pointer capture");
  h.context.finishDrag({ pointerId: 13, type: "pointerup" }); assert.deepEqual(h.layouts(), baseline, "A later pointerup cannot recommit a canceled drag");
}
{
  const h = harness(); h.context.startProductReorder(); const baseline = h.layouts();
  for (const eventType of ["pointercancel", "pointerup"]) {
    h.context.dragState = h.gesture({ moved: eventType === "pointercancel" });
    h.context.finishDrag({ pointerId: 1, type: eventType }); assert.deepEqual(h.layouts(), baseline, "Canceled pointers and a simple selection click never reorder a card");
  }
  h.context.dragState = h.gesture();
  h.context.finishDrag({ pointerId: 1, type: "pointerup" }); assert.deepEqual(h.order("second"), ["d", "a", "e"], "An intentional completed drag records a move");
}
{
  const h = harness(); h.context.startProductReorder();
  assert.equal(h.context.handleProductReorderKeydown(h.event("ArrowRight")), false, "Ordinary arrows retain viewer navigation");
  const event = h.event("ArrowRight", { altKey: true }); assert.equal(h.context.handleProductReorderKeydown(event), true); assert.ok(event.prevented && event.stopped);
  assert.deepEqual(h.order("first"), ["b", "a", "c"]);
  h.context.handleProductReorderKeydown(h.event("ArrowDown", { altKey: true })); assert.deepEqual(h.order("second"), ["d", "a", "e"]);
  assert.equal(h.context.handleProductReorderKeydown(h.event("ArrowRight", { altKey: true, target: h.get("some-input") })), false, "Typing in another control never rearranges a product");
}
{
  const h = harness(); h.context.startProductReorder(); h.context.reorderProduct("a", "first", 2); const latest = h.layouts();
  h.context.setView("roadmap"); assert.equal(h.context.productLayoutEditing, false); assert.equal(h.context.activeView, "roadmap"); assert.deepEqual(h.layouts(), latest, "Switching views finishes the session with its current draft");
}
{
  const h = harness(); h.context.startProductReorder(); h.context.reorderProduct("a", "first", 2); const latest = h.layouts();
  h.context.activateCategory("keyboard", { fitVertical: false }); assert.equal(h.context.productLayoutEditing, false); assert.equal(h.context.activeCategoryId, "keyboard");
  assert.deepEqual(plain(h.portfolio.categories[0].board.products.map(({ id, laneId, order, manualPosition }) => ({ id, laneId, order, manualPosition }))), latest, "Changing categories settles the old session before changing boards");
}
{
  const h = harness(); h.context.startProductReorder(); h.context.reorderProduct("a", "first", 2); const latest = h.layouts();
  const hook = source.match(/^  beforeSave: ([^\n]+),$/m)?.[1]; assert.ok(hook, "All save paths share an explicit reorder terminal action");
  new vm.Script(`(${hook})()`).runInContext(h.context); assert.equal(h.context.productLayoutEditing, false); assert.deepEqual(h.layouts(), latest);
  h.context.finishProductReorder({ cancel: true }); assert.deepEqual(h.layouts(), latest, "Cancel cannot undo a move after it entered save review");
}
{
  const h = harness(); h.context.startProductReorder(); h.context.reorderProduct("a", "first", 2); const latest = h.layouts();
  const saveFlow = masterUi.match(/^    async function saveFlow\([^]*?^    \}/m)?.[0]; assert.ok(saveFlow, "Exercise the actual save entry point");
  let reviews = 0;
  Object.assign(h.context, { running: false, discarding: false, session: { getState: () => ({ busy: false }) }, adapter: { beforeSave: () => h.context.finishProductReorder() }, review: async () => { reviews++; assert.equal(h.context.productLayoutEditing, false, "Reordering finishes before save review starts"); return null; }, updateStatus() {} });
  await new vm.Script(`${saveFlow}\n saveFlow();`).runInContext(h.context);
  assert.equal(reviews, 1); assert.deepEqual(h.layouts(), latest);
  h.context.startProductReorder(); h.context.running = true;
  await new vm.Script("saveFlow();").runInContext(h.context);
  assert.equal(h.context.productLayoutEditing, true, "A busy save ignores the action without prematurely ending another session");
}

assert.equal((html.match(/id="productLayoutEditToggle"/g) || []).length, 1);
const productControls = html.match(/<section id="productControls"[^]*?<\/section>/)?.[0];
assert.ok(productControls?.includes('id="productLayoutEditToggle"') && productControls.includes('id="productReorderDone"') && productControls.includes('id="productReorderCancel"'), "Start, Done, and Cancel are directly accessible in Products controls");
assert.ok(!html.match(/<section id="settingsCategoryPanel"[^]*?<\/section>/)?.[0].includes('id="productLayoutEditToggle"'), "No settings round trip is needed to finish reordering");
assert.ok(source.includes('if (handleProductReorderKeydown(event)) return;'), "Real canvas and window keyboard handlers use the protected reorder workflow");
console.log("Card reordering workflow passed: direct toolbar controls, Done/Cancel, isolated undo, new/deleted products, external layout protection, keyboard and pointer cancellation, view/category/save lifecycle.");
