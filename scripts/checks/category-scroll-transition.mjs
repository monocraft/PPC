import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../../public/js/portfolio-model.js");
await import("../../public/js/master-model.js");
await import("../../public/js/master-client.js");

const [runtimeSource, appSource] = await Promise.all([
  readFile(new URL("../../public/js/view-runtime.js", import.meta.url), "utf8"),
  readFile(new URL("../../public/js/app.js", import.meta.url), "utf8"),
]);
const plain = value => JSON.parse(JSON.stringify(value));
const extract = name => {
  const definition = appSource.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"))?.[0];
  assert.ok(definition, `Exercise the actual ${name} application function.`); return definition;
};
function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, callback, options) { const entries = listeners.get(name) || []; entries.push({ callback, options }); listeners.set(name, entries); },
    removeEventListener(name, callback) { listeners.set(name, (listeners.get(name) || []).filter(entry => entry.callback !== callback)); },
    fire(name, values = {}) { const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values }; for (const entry of [...(listeners.get(name) || [])]) entry.callback(event); return event; },
    listenerCount() { return [...listeners.values()].reduce((total, entries) => total + entries.length, 0); },
  };
}
function runtimeHarness({ reduced = false, support = "normal" } = {}) {
  const media = Object.assign(eventTarget(), { matches: reduced });
  const document = { activeElement: { id: "retained-focus" } }, root = Object.assign(eventTarget(), {
    document, matchMedia(query) { assert.equal(query, "(prefers-reduced-motion: reduce)"); return media; },
    requestAnimationFrame() { throw new Error("Category transitions must not start a frame loop."); },
    setTimeout() { throw new Error("Category transitions must not schedule delayed layout or scrolling."); },
  });
  document.defaultView = root;
  const animations = [], element = Object.assign(eventTarget(), { ownerDocument: document, style: { opacity: "", transform: "" } });
  if (support !== "missing") element.animate = (keyframes, options) => {
    if (support === "throw") throw new Error("Animation is unavailable.");
    const animation = { keyframes: plain(keyframes), options: plain(options), cancellations: 0, onfinish: null, oncancel: null,
      cancel() { this.cancellations++; this.oncancel?.(); }, finish() { this.onfinish?.(); } };
    animations.push(animation); return animation;
  };
  vm.createContext(root); vm.runInContext(runtimeSource, root);
  const controller = root.PortfolioViewRuntime.categoryTransition(element);
  const clean = () => assert.equal(element.listenerCount() + root.listenerCount() + media.listenerCount(), 0, "No transient animation listeners remain.");
  return { root, document, media, element, animations, controller, clean };
}

{
  const h = runtimeHarness(), focus = h.document.activeElement, styles = plain(h.element.style);
  h.clean(); assert.equal(Object.isFrozen(h.controller), true);
  assert.equal(h.controller.reveal(), true);
  const animation = h.animations[0];
  assert.deepEqual(animation.keyframes, [{ opacity: .45 }, { opacity: 1 }], "The category reveal changes opacity without moving or scaling content.");
  assert.equal(animation.options.duration, 180); assert.equal(animation.options.fill, undefined, "Completion leaves no persistent animation effect.");
  assert.equal(h.element.listenerCount(), 3); assert.equal(h.root.listenerCount(), 1); assert.equal(h.media.listenerCount(), 1);
  animation.finish(); h.clean(); h.controller.cancel();
  assert.equal(animation.cancellations, 0, "Finishing and a later cancel do not restart or disturb completed motion.");
  assert.deepEqual(h.element.style, styles); assert.equal(h.document.activeElement, focus, "Reveal never steals focus.");
}
{
  const h = runtimeHarness(); h.controller.reveal();
  const old = h.animations[0], lateFinish = old.onfinish;
  for (let index = 0; index < 12; index++) h.controller.reveal();
  const current = h.animations.at(-1);
  assert.ok(h.animations.slice(0, -1).every(animation => animation.cancellations === 1));
  assert.equal(h.element.listenerCount(), 3, "Rapid switches retain one bounded interruption listener set.");
  lateFinish(); assert.equal(h.element.listenerCount(), 3, "A stale completion cannot clean up the latest category's motion.");
  assert.equal(current.cancellations, 0);
  h.controller.cancel(); h.controller.cancel(); h.clean();
  assert.equal(current.cancellations, 1, "Cancellation is idempotent.");
}
for (const interruption of ["wheel", "pointerdown", "keydown", "blur", "reduced-motion"]) {
  const h = runtimeHarness(); h.controller.reveal();
  let event;
  if (interruption === "blur") event = h.root.fire("blur");
  else if (interruption === "reduced-motion") {
    h.media.fire("change", { matches: false }); assert.equal(h.animations[0].cancellations, 0);
    h.media.matches = true; event = h.media.fire("change", { matches: true });
  } else event = h.element.fire(interruption);
  assert.equal(event.defaultPrevented, false, `${interruption} retains native interaction.`);
  assert.equal(h.animations[0].cancellations, 1); h.clean();
  assert.deepEqual(h.element.style, { opacity: "", transform: "" });
}
for (const options of [{ reduced: true }, { support: "missing" }, { support: "throw" }]) {
  const h = runtimeHarness(options);
  assert.equal(h.controller.reveal(), false); assert.equal(h.animations.length, 0); h.controller.cancel(); h.clean();
  assert.deepEqual(h.element.style, { opacity: "", transform: "" }, "Reduced motion and missing animation APIs retain the complete static view.");
}

const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function appHarness({ remembered = true, view = "products", opening = false, reduced = false } = {}) {
  const h = runtimeHarness({ reduced }), events = [], frames = new Map(), controls = new Map(); let nextFrame = 0, context;
  const geometries = { large: { width: 9000, height: 7000 }, small: { width: 1500, height: 900 }, other: { width: 8000, height: 5500 }, empty: { width: 700, height: 400 } };
  const categories = Object.keys(geometries).map(id => ({ id, name: id, board: {
    products: Array.from({ length: id === "empty" ? 0 : id === "small" ? 3 : 14 }, (_, index) => ({
      id: `${id}-${index}`, name: `Synthetic ${id} ${index}`, laneId: "main", order: index, price: 99,
      specs: [], partSkus: [], variantGroups: [], roadmap: { startMonth: "2026-01", launchMonth: "2026-01", endMonth: "2030-12", status: "launched", family: "Synthetic" },
      unknownEvidence: { preserve: [null, false, ""] },
    })), lanes: [{ id: "main", order: 0 }], settings: { catalogGroups: ["all"] },
  } }));
  for (const category of categories) freeze(category.board);
  const portfolio = { activeCategoryId: "large", settings: { roadmapBasis: "lifecycle" }, categories, masterLocalMerges: [{ evidence: "retained" }], imageAssets: [{ id: "synthetic-image" }] };
  const baseline = globalThis.PortfolioMasterModel.snapshot(portfolio).products;
  portfolio.masterLocalBaseline = freeze(plain(baseline)); freeze(portfolio.masterLocalMerges); freeze(portfolio.imageAssets);
  const business = () => JSON.stringify({ categories: portfolio.categories, settings: portfolio.settings, baseline: portfolio.masterLocalBaseline, merges: portfolio.masterLocalMerges, images: portfolio.imageAssets });
  const businessBefore = business();
  let width = geometries.large.width, height = geometries.large.height, left = 2600, top = 2900;
  const scroll = {
    clientWidth: 900, clientHeight: 600,
    get scrollWidth() { return width; }, get scrollHeight() { return height; },
    get scrollLeft() { return left; }, set scrollLeft(value) { events.push({ type: "left", value, category: context?.activeCategoryId }); left = Math.max(0, Math.min(value, Math.max(0, width - this.clientWidth))); },
    get scrollTop() { return top; }, set scrollTop(value) { events.push({ type: "top", value, category: context?.activeCategoryId }); top = Math.max(0, Math.min(value, Math.max(0, height - this.clientHeight))); },
    resize(nextWidth, nextHeight) { width = nextWidth; height = nextHeight; left = Math.min(left, Math.max(0, width - this.clientWidth)); top = Math.min(top, Math.max(0, height - this.clientHeight)); },
    scrollTo(options) { events.push({ type: "scrollTo", ...options }); if (options.left !== undefined) this.scrollLeft = options.left; if (options.top !== undefined) this.scrollTop = options.top; },
  };
  const makeNode = () => ({ value: "", dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, focus() { h.document.activeElement = this; } });
  const get = id => { if (!controls.has(id)) controls.set(id, makeNode()); return controls.get(id); };
  const tab = makeNode(), viewer = { querySelectorAll: () => [], querySelector: () => tab };
  const productView = Object.assign(h.element, { clientHeight: 640, classList: { toggle() {} } });
  const preferences = new Map(remembered ? categories.map(category => [category.id, { productZoom: .8, roadmapZoom: .6 }]) : []);
  context = Object.assign(h.root, {
    portfolio, board: categories[0].board, activeCategoryId: "large", activeView: view, workspaceOpening: opening,
    selectedId: "large-0", viewerInfoProgress: 1, viewerInfoProductId: "large-0", viewerInfoOpen: true, viewerInfoOutline: null,
    searchQuery: "outgoing search", roadmapSearchQuery: "outgoing roadmap search", productLayoutEditing: false, hoveredHeroVariant: null,
    productView, roadmapView: makeNode(), splitView: makeNode(), productControls: makeNode(), roadmapControls: makeNode(), viewerInfo: viewer, splitProduct: viewer,
    canvas: { style: {}, hasPointerCapture: () => false }, canvasScroll: Object.assign(scroll, { classList: { remove() {} } }), zoom: 1, roadmapMonthWidth: 82, ROADMAP_DEFAULT_MONTH_WIDTH: 82,
    PRODUCT_MIN_ZOOM: .2, PRODUCT_MAX_ZOOM: 2, initialVerticalFitPending: false, categoryZoomPreferences: preferences,
    roadmapLaneHovers: [], roadmapPanState: null, roadmapDraft: null, roadmapDetailsOpen: false, roadmapInteractionMode: "pan",
    packageOperationInProgress: false, pptxExportInProgress: false, hashoutViewController: null, productCardHover: null,
    dragState: null, panState: null, productCardMotion: null, productCardMotionFrame: null, renderedCards: [],
    $: get, document: Object.assign(h.document, { querySelectorAll: () => [] }),
    PortfolioModel: { ...globalThis.PortfolioModel, syncTimelineSettings() {} },
    PortfolioDetails: { focusMatch() { events.push({ type: "match" }); } },
    categoryDefinition: id => ({ id }),
    ensureBoardSchema(value) { events.push({ type: "schema", left, top }); assert.equal(left, 0); assert.equal(top, 0); return value; },
    snappedViewZoom: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    getCanvasDimensions: () => geometries[context.activeCategoryId],
    setupCanvas(_canvas, zoom) { const dimensions = geometries[context.activeCategoryId]; scroll.resize(dimensions.width * zoom, dimensions.height * zoom); return { context: {}, dimensions }; },
    drawBoardTo() {
      events.push({ type: "paint", category: context.activeCategoryId, left, top });
      context.renderedCards = context.board.products.map((product, index) => ({ productId: product.id, x: index % 4 * 1100, y: Math.floor(index / 4) * 1400, width: 246, height: 400 }));
    },
    renderLaneRail() {}, syncLaneRail() {}, syncBoardNavigator() {}, syncViewZoomControls() {}, renderStatus() {}, positionViewerInfo() {},
    finishProductReorder() {}, closeViewerInfo() { context.viewerInfoProductId = null; }, closeInspector() {},
    updateProductLayoutEditControls() {}, closeVariantPopover() {}, stopRoadmapSlotEditing() {}, syncControls() {}, renderInspector() {},
    renderViewerInfo() {}, updateLinkedViewButton() {}, updateRoadmapEditControls() {}, closePopupMenus() {}, syncRoadmapDetailsVisibility() {},
    renderRoadmaps() { events.push({ type: "roadmap" }); }, productDetailsModel: product => ({ id: product.id }),
    scheduleSave() { events.push({ type: "save" }); }, updateBoard() { throw new Error("Category transition cannot change products."); },
    openViewerInfo(_id, options) { context.ready = options.onReady; },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame(id) { frames.delete(id); },
  });
  const initialization = appSource.match(/^const categoryViewTransition = [^\n]+/m)?.[0];
  assert.ok(initialization, "The actual app initializes the category transition against its Products view.");
  vm.runInContext(initialization + ["stopProductCardDrag", "activateCategory", "categoryNavigationLocked", "chooseCategoryNavigation", "isFfsRoadmap", "renderBoard", "renderActiveView", "fitProductLanesVertically", "setView", "scrollSelectedIntoView", "openPortfolioSearchResult"].map(extract).join("\n"), context);
  const session = globalThis.PortfolioMasterClient.createSession({ adapter: {
    getProducts: () => portfolio.categories.flatMap(category => category.board.products.map(product => ({ ...product, categoryId: category.id }))),
    getBaselineProducts: () => portfolio.masterLocalBaseline,
    applyPatches() { throw new Error("No remote operation is expected."); },
  }, fetchImpl() { throw new Error("This synthetic check cannot contact a backend."); } });
  const flush = () => { for (let pass = 0; frames.size && pass < 10; pass++) { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback()); } assert.equal(frames.size, 0, "Navigation leaves no animation frame loop."); };
  return { ...h, context, scroll, portfolio, events, frames, preferences, tab, flush,
    assertUnchanged() { assert.equal(business(), businessBefore); assert.equal(session.track().length, 0, "Category navigation creates no phantom pending product drafts."); } };
}

for (const destination of ["small", "other", "empty"]) {
  for (const remembered of [true, false]) {
    const h = appHarness({ remembered });
    assert.equal(h.context.chooseCategoryNavigation(destination), true);
    const firstPaint = h.events.find(event => event.type === "paint");
    assert.deepEqual(firstPaint, { type: "paint", category: destination, left: 0, top: 0 }, "The incoming board's first paint starts at its origin, regardless of outgoing size or remembered zoom.");
    assert.deepEqual(h.events.slice(0, 2), [{ type: "left", value: 0, category: "large" }, { type: "top", value: 0, category: "large" }], "Both offsets reset before the board owner changes or geometry is rebuilt.");
    assert.equal(h.context.searchQuery, ""); assert.equal(h.context.roadmapSearchQuery, "");
    assert.equal(h.context.selectedId, destination === "empty" ? null : `${destination}-0`);
    assert.equal(h.animations.length, 1); h.flush();
    assert.equal(h.scroll.scrollLeft, 0); assert.equal(h.scroll.scrollTop, 0);
    if (remembered) { assert.equal(h.context.zoom, .8); assert.equal(h.context.roadmapMonthWidth, .6 * 82); }
    h.assertUnchanged();
  }
}
{
  const h = appHarness(), before = plain(h.events), focus = h.document.activeElement;
  assert.equal(h.context.chooseCategoryNavigation("large"), false); assert.equal(h.context.chooseCategoryNavigation("missing"), false);
  assert.deepEqual(h.events, before); assert.equal(h.scroll.scrollLeft, 2600); assert.equal(h.scroll.scrollTop, 2900);
  assert.equal(h.animations.length, 0); assert.equal(h.document.activeElement, focus); h.assertUnchanged();
}
{
  const h = appHarness(); h.context.chooseCategoryNavigation("other");
  const staleFinish = h.animations[0].onfinish;
  h.scroll.scrollLeft = 1700; h.scroll.scrollTop = 1800;
  h.context.chooseCategoryNavigation("small"); staleFinish();
  assert.equal(h.animations[0].cancellations, 1); assert.equal(h.animations[1].cancellations, 0);
  assert.equal(h.context.activeCategoryId, "small"); assert.equal(h.scroll.scrollLeft, 0); assert.equal(h.scroll.scrollTop, 0);
  h.context.setView("roadmap"); assert.equal(h.animations[1].cancellations, 1); h.flush(); h.clean(); h.assertUnchanged();
}
for (const options of [{ reduced: true }, { opening: true }, { view: "roadmap" }]) {
  const h = appHarness(options); h.context.activateCategory("other"); h.flush();
  assert.equal(h.animations.length, 0, "Reduced motion, workspace opening and a hidden Products view do not animate category entry.");
  assert.equal(h.scroll.scrollLeft, 0); assert.equal(h.scroll.scrollTop, 0); h.assertUnchanged();
}
{
  const h = appHarness(), result = { categoryId: "other", productId: "other-11", matchedSku: "", matchedVariant: "" };
  assert.equal(h.context.openPortfolioSearchResult(result), true);
  assert.equal(h.animations.length, 0, "A render:false search activation leaves reveal and focus to the existing selection path.");
  h.flush(); h.context.ready();
  assert.equal(h.context.selectedId, result.productId);
  assert.ok(h.scroll.scrollLeft > 0 && h.scroll.scrollTop > 0, "The subsequent search-result reveal can scroll to the selected destination product.");
  assert.equal(h.document.activeElement, h.tab, "Search still focuses its destination detail tab.");
  const selectedOffset = { left: h.scroll.scrollLeft, top: h.scroll.scrollTop };
  h.flush(); assert.deepEqual({ left: h.scroll.scrollLeft, top: h.scroll.scrollTop }, selectedOffset, "No late category transition overrides the search reveal.");
  h.assertUnchanged();
}

console.log("Category scroll transition checks passed: real category activation and board paints reset both axes before new geometry, large/small/empty and remembered-fit navigation, same-category no-ops, bounded rapid/reduced/interrupted motion, search reveal/focus preservation and zero phantom product drafts.");
