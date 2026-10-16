import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const runtimeSource = await fs.readFile(new URL("../../public/js/view-runtime.js", import.meta.url), "utf8");
const appSource = await fs.readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const extract = name => { const match = appSource.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m")); assert.ok(match, name); return match[0]; };
const plain = value => JSON.parse(JSON.stringify(value));
let nextFrame = 0;
const frames = new Map();
const request = callback => { frames.set(++nextFrame, callback); return nextFrame; };
const cancel = id => frames.delete(id);
const flush = () => { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback()); };
const events = new Map();
function node() {
  const listeners = new Map(), classes = new Set();
  return { children: [], attributes: new Map(), style: {}, dataset: {}, width: 0, height: 0, offsetHeight: 20,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); } },
    append(child) { this.children.push(child); }, setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    fire(name, event = {}) { listeners.get(name)?.(event); },
  };
}
const root = { requestAnimationFrame: request, cancelAnimationFrame: cancel,
  addEventListener(name, callback) { events.set(name, callback); }, document: { createElement: node } };
vm.createContext(root); vm.runInContext(runtimeSource, root);
const runtime = root.PortfolioViewRuntime;
// Frozen chrome must copy the visible backing layer after large boards switch
// the logical event canvas to one backing pixel; ordinary canvases still work.
{
  const copies = [], make = root.document.createElement;
  root.devicePixelRatio = 2;
  root.document.createElement = () => ({ ...node(), getContext: () => ({ clearRect() {}, drawImage: (...args) => copies.push(args) }) });
  const source = { width: 1200, height: 900 }, logical = { _ppcViewportLayer: source };
  const scroll = { parentElement: node(), clientWidth: 600, offsetLeft: 10, offsetTop: 20, scrollLeft: 4000, scrollTop: 2500 };
  runtime.stickyHeader(logical, scroll, 88).sync();
  assert.equal(copies[0][0], source); assert.deepEqual(copies[0].slice(1), [0, 0, 1200, 176, 0, 0, 1200, 176]);
  const full = { width: 20000, height: 12000 }; runtime.stickyHeader(full, scroll, 88).sync();
  assert.equal(copies[1][0], full); assert.equal(copies[1][1], 8000); assert.equal(copies[1][2], 5000);
  root.document.createElement = make; delete root.devicePixelRatio;
}

// Event bursts must produce one paint of the latest state, and no idle render loop.
let renders = 0, current = 0, painted = 0;
const task = runtime.frameTask(() => { renders++; painted = current; });
for (let i = 1; i <= 100; i++) { current = i; task(); }
assert.equal(frames.size, 1); flush(); assert.equal(renders, 1); assert.equal(painted, 100); assert.equal(frames.size, 0);
task(); task.cancel(); flush(); assert.equal(renders, 1);

// View settings are small and separate from portfolio/auth data, survive reload,
// and remain usable when local preferences are blocked, damaged or too large.
const storage = new Map(); let writes = 0;
const store = { getItem: key => storage.get(key), setItem(key, value) { writes++; storage.set(key, value); } };
const prefs = runtime.preferences({ key: "test-view", storage: () => store });
assert.equal(prefs.get("audio"), null);
assert.equal(prefs.set("audio", { productZoom: .9, roadmapZoom: .6, secret: "ignored" }), true);
prefs.set("mics", { productZoom: 1.2, roadmapZoom: 1.5 });
const restarted = runtime.preferences({ key: "test-view", storage: () => store });
assert.deepEqual(plain(restarted.get("audio")), { productZoom: .9, roadmapZoom: .6 });
assert.deepEqual(plain(restarted.get("mics")), { productZoom: 1.2, roadmapZoom: 1.5 });
assert.equal(restarted.set("audio", { productZoom: 100, roadmapZoom: .6 }), false);
assert.ok(!storage.get("test-view").includes("secret"));
assert.ok(storage.get("test-view").length < 1024);
for (const raw of ["{", "x".repeat(32769), '{"version":1,"categories":[{"bad":true}]}']) {
  assert.equal(runtime.preferences({ key: "bad", storage: () => ({ getItem: () => raw }) }).get("audio"), null);
}
const blocked = runtime.preferences({ key: "blocked", storage() { throw new Error("quota"); } });
assert.equal(blocked.set("audio", { productZoom: .8, roadmapZoom: .5 }), true);
assert.equal(blocked.get("audio").productZoom, .8);

// Top-level navigation is synchronous so refreshing before the portfolio save
// debounce preserves Hashout/Lifecycle/Products without storing working data.
const navKey = "test-navigation", nav = runtime.navigation({ key: navKey, storage: () => store });
assert.equal(nav.get(), null, "A fresh browser retains the app's normal initial view.");
for (const choice of [
  { view: "roadmap", basis: "ffs", detailsOpen: false },
  { view: "roadmap", basis: "lifecycle", detailsOpen: true },
  { view: "products", basis: "ffs", detailsOpen: false },
]) {
  assert.equal(nav.set({ ...choice, products: [{ name: "Private working product" }], selectedId: "private-id" }), true);
  assert.deepEqual(plain(JSON.parse(storage.get(navKey))), { version: 1, ...choice }, "A view switch writes only small validated navigation fields immediately.");
  assert.deepEqual(plain(runtime.navigation({ key: navKey, storage: () => store }).get()), choice, "Reload restores the exact selected view and roadmap basis.");
}
assert.ok(storage.get(navKey).length < 128);
const navSnapshot = nav.get(); navSnapshot.view = "roadmap";
assert.equal(nav.get().view, "products", "Consumers cannot mutate the stored preference through get().");
const savedNav = storage.get(navKey);
for (const invalid of [null, [], {}, { view: "split", basis: "ffs", detailsOpen: false }, { view: "roadmap", basis: "unknown", detailsOpen: false },
  { view: "roadmap", basis: "ffs", detailsOpen: "false" }, { view: "roadmap", basis: "ffs" }]) {
  assert.equal(nav.set(invalid), false); assert.equal(storage.get(navKey), savedNav, "Invalid navigation cannot overwrite the last valid preference.");
}
for (const raw of ["{", "x".repeat(4097), JSON.stringify({ version: 2, view: "roadmap", basis: "ffs", detailsOpen: false }),
  JSON.stringify({ version: 1, view: "roadmap", basis: "bad", detailsOpen: false }),
  JSON.stringify({ version: 1, view: "roadmap", basis: "ffs", detailsOpen: "true" }),
  JSON.stringify({ version: 1, view: "roadmap", basis: "ffs", detailsOpen: false, extra: "é".repeat(2100) })]) {
  assert.equal(runtime.navigation({ key: "bad-nav", storage: () => ({ getItem: () => raw }) }).get(), null, "Corrupt, oversized, and unsupported navigation is ignored.");
}
const blockedNav = runtime.navigation({ key: "blocked-nav", storage() { throw new Error("storage denied"); } });
assert.equal(blockedNav.get(), null);
assert.equal(blockedNav.set({ view: "roadmap", basis: "ffs", detailsOpen: false }), true);
assert.deepEqual(plain(blockedNav.get()), { view: "roadmap", basis: "ffs", detailsOpen: false }, "Blocked browser storage does not interrupt ordinary view navigation.");
const failingNav = runtime.navigation({ key: "failing-nav", storage: { getItem() { throw new Error("read denied"); }, setItem() { throw new Error("quota"); } } });
assert.equal(failingNav.get(), null); assert.equal(failingNav.set({ view: "products", basis: "lifecycle", detailsOpen: true }), true);
assert.equal(runtime.navigation().get(), null); assert.equal(runtime.navigation().set({ view: "products", basis: "lifecycle", detailsOpen: true }), false);
// Existing navigation is migrated as a read-only fallback. Each tab thereafter
// keeps its own choice through Analytics round trips and reloads.
const oldNavigation={version:1,view:'roadmap',basis:'ffs',detailsOpen:false},sharedNavigation=new Map([['tab-nav',JSON.stringify(oldNavigation)]]);
const mapStore=map=>({getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)}),tabA=new Map(),tabB=new Map();
const tabNavigation=map=>runtime.navigation({key:'tab-nav',storage:mapStore(map),fallbackStorage:mapStore(sharedNavigation)});
assert.deepEqual(plain(tabNavigation(tabA).get()),{view:'roadmap',basis:'ffs',detailsOpen:false});
tabNavigation(tabA).set({view:'roadmap',basis:'lifecycle',detailsOpen:false});
tabNavigation(tabB).set({view:'products',basis:'ffs',detailsOpen:true});
assert.equal(tabNavigation(tabA).get().basis,'lifecycle','Another tab cannot force Hashout after a reload or Analytics round trip.');
assert.equal(tabNavigation(tabB).get().view,'products');
assert.deepEqual(JSON.parse(sharedNavigation.get('tab-nav')),oldNavigation,'Legacy device preference is read but never overwritten by tab navigation.');

// Real app activation restores each independent category scale before deciding Fit.
const categories = ["audio", "mics", "new"].map(id => ({ id, board: { products: [{ id: `${id}-one` }], lanes: [] } }));
const categoryData = { categories, activeCategoryId: "audio", metadata: { preserve: true } };
const controls = new Map();
const categoryContext = { portfolio: categoryData, categoryZoomPreferences: restarted, zoom: 1, roadmapMonthWidth: 82,
  ROADMAP_DEFAULT_MONTH_WIDTH: 82, roadmapLaneHovers: new Map(), viewerInfoOutline: null, productCardHover: null,
  finishProductReorder() {}, closeViewerInfo() {}, categoryDefinition: id => ({ id }), ensureBoardSchema: value => value,
  PortfolioModel: { syncTimelineSettings() {} }, closeInspector() {}, updateProductLayoutEditControls() {},
  closeVariantPopover() {}, stopRoadmapSlotEditing() {}, scheduleSave() {}, syncControls() {}, renderInspector() {}, renderActiveView() {}, fitProductLanesVertically() {},
  $: id => { if (!controls.has(id)) controls.set(id, {}); return controls.get(id); }, activeView: "roadmap" };
vm.createContext(categoryContext); vm.runInContext(extract("activateCategory"), categoryContext);
categoryContext.activateCategory("audio"); assert.equal(categoryContext.zoom, .9); assert.equal(categoryContext.roadmapMonthWidth, .6 * 82); assert.equal(categoryContext.initialVerticalFitPending, false);
categoryContext.activateCategory("mics"); assert.equal(categoryContext.zoom, 1.2); assert.equal(categoryContext.roadmapMonthWidth, 1.5 * 82);
categoryContext.activateCategory("audio"); assert.equal(categoryContext.zoom, .9);
categoryContext.activateCategory("new"); assert.equal(categoryContext.zoom, 1); assert.equal(categoryContext.initialVerticalFitPending, true);
assert.deepEqual(categoryData.metadata, { preserve: true });

// Actual layout work is reused across animation frames but recomputed after edits.
let specMeasurements = 0;
const board = { settings: { showSkus: true }, lanes: [{ id: "one", order: 0 }], products: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, laneId: "one", specs: [{ label: "Driver", value: "40 mm" }] })) };
const boardBefore = JSON.stringify(board);
const layoutContext = { PortfolioViewRuntime: runtime, board, activeView: "products", activeCategoryId: "audio", zoom: .9, pptxExportInProgress: false,
  workspaceSaveRevision: 1, categoryDefinition: () => ({ id: "audio" }), sortedLanes: () => board.lanes,
  detailedSpecsHeight() { specMeasurements++; return 170; }, variantFooterLayout: () => ({ height: 50 }),
  FULL_SPEC_TITLE_TOP: 252, FULL_SPEC_DETAILS_TOP_OFFSET: 66, FULL_SPEC_MIN_CARD_HEIGHT: 400, FULL_SPEC_IMAGE_HEIGHT: 210,
  STATUS_BANNER_HEIGHT: 24, IMAGE_SLOT_TOP: 34, IMAGE_SLOT_HEIGHT: 112, TITLE_BLOCK_TOP: 152, PRICE_BASELINE_OFFSET: 53, DETAILS_TOP_OFFSET: 66,
};
vm.createContext(layoutContext); vm.runInContext(extract("productCardLayout"), layoutContext);
const screen = layoutContext.productCardLayout();
for (let i = 0; i < 30; i++) assert.equal(layoutContext.productCardLayout(), screen);
assert.equal(specMeasurements, 40, "thirty animation frames measure each product only once");
const exported = layoutContext.productCardLayout(board, { id: "audio" }, { includeControls: false });
assert.ok(Math.abs((screen.cardHeight - exported.cardHeight) * .9 - 36) < 1e-8);
assert.equal(exported.actionHeight, 0, "exports omit the native action row");
layoutContext.workspaceSaveRevision++; layoutContext.productCardLayout(); assert.equal(specMeasurements, 120, "data revision invalidates the cached layout");
assert.equal(JSON.stringify(board), boardBefore);

// Icon baselines come from the shared front-facts area, not each variant footer
// or the selected card's temporary stretched height. Toggle SKUs without moving
// either icon, across empty, one-row and two-row footers at every supported zoom.
const mixedBoard = { settings: { showSkus: true }, lanes: [{ id: "a", order: 0 }, { id: "b", order: 1 }],
  products: [0, 34, 52].map((footer, index) => ({ id: `mixed-${index}`, laneId: "a", order: index, footer, specs: [{ label: "Connection", value: "USB" }] })) };
const mixedProductsBefore = JSON.stringify(mixedBoard.products);
let fullCards = false;
const placementContext = { ...layoutContext, board: mixedBoard, zoom: 1, categoryDefinition: () => ({ id: "mixed", fullSpecCards: fullCards }),
  sortedLanes: () => mixedBoard.lanes, cardSpecifications: product => product.specs,
  variantFooterLayout: product => ({ height: product.footer }), detailedSpecsHeight: () => 34 };
vm.createContext(placementContext); vm.runInContext(extract("productCardLayout") + extract("productCardActionPlacement"), placementContext);
for (const detailed of [false, true]) {
  fullCards = detailed;
  for (const scale of [.2, .7, 1, 2]) {
    placementContext.zoom = scale; mixedBoard.settings.showSkus = true;
    const withSkus = placementContext.productCardLayout();
    assert.equal(withSkus.reservedFooterHeight, 52);
    const cards = mixedBoard.products.map((product, index) => ({ productId: product.id, x: 18 + index * 256, y: 50, width: 246, height: withSkus.cardHeight }));
    const positions = cards.map(card => placementContext.productCardActionPlacement(card, withSkus));
    assert.ok(positions.every(position => position.y === positions[0].y), "different footer row counts share one icon baseline");
    const expanded = placementContext.productCardActionPlacement({ ...cards[0], height: cards[0].height + 150 / scale }, withSkus);
    assert.equal(expanded.y, positions[0].y, "reading extension stretching cannot move the icon baseline");
    mixedBoard.settings.showSkus = false;
    const withoutSkus = placementContext.productCardLayout();
    assert.equal(withoutSkus.reservedFooterHeight, 0);
    assert.equal(placementContext.productCardActionPlacement(cards[0], withoutSkus).y, positions[0].y, "SKU visibility does not move icons");
    assert.ok(positions[0].width <= cards[0].width * scale, "condensed icons stay inside the physical card at minimum zoom");
    assert.equal(placementContext.productCardLayout(mixedBoard, placementContext.categoryDefinition(), { includeControls: false }).actionHeight, 0);
  }
}
assert.equal(JSON.stringify(mixedBoard.products), mixedProductsBefore);
// The recess stays within its physical card and reserved action band. On touch,
// narrow zoomed cards stack the independent 44px targets above the SKU footer.
placementContext.CARD_WIDTH = 246;
for (const coarse of [false, true]) {
  placementContext.matchMedia = () => ({ matches: coarse });
  for (const scale of [.2, .3, .34, .44, .45, .7, 1, 2]) {
    placementContext.zoom = scale;
    const layout = placementContext.productCardLayout();
    const card = { x: 18, y: 50, width: 246, height: layout.cardHeight };
    const placement = placementContext.productCardActionPlacement(card, layout);
    const condensed = card.width * scale < (coarse ? 110 : 82);
    const groupWidth = coarse ? (condensed ? 48 : 94) : (condensed ? 48 : 66);
    const groupHeight = coarse ? (condensed ? 92 : 48) : 34;
    const right = placement.x + placement.width;
    assert.ok(right - groupWidth >= card.x * scale - 1e-8, "the complete recess fits the physical card at every zoom");
    assert.ok(right <= (card.x + card.width) * scale + 1e-8, "the recess cannot reach the neighboring card");
    assert.ok(placement.y + groupHeight <= (card.y + layout.actionTop + layout.actionHeight) * scale + 1e-8,
      "the complete hit area remains above the reserved SKU footer");
    assert.equal(placementContext.productCardLayout(mixedBoard, placementContext.categoryDefinition(), { includeControls: false }).actionHeight, 0,
      "desktop and touch exports both omit the interactive recess");
  }
}
delete placementContext.matchMedia;
const iconActions = extract("syncProductCardActions");
assert.equal((iconActions.match(/<svg viewBox=/g) || []).length, 2);
assert.ok(!iconActions.includes("product-card-action-label"), "both native controls stay icon-only at every zoom");
assert.match(iconActions, /const label = `\$\{actionLabel\} for \$\{product\.name\}`/);
assert.match(iconActions, /button\.setAttribute\("aria-label", label\)/);
assert.match(iconActions, /button\.title !== actionLabel\) button\.title = actionLabel/, "concise native titles retain the separate full accessible product label");

// The selected expanded card has one navigation surface. A focused opener is
// retained until the requested shared tab owns focus, then hidden; closing from
// the reading area restores that opener without stealing search/other focus.
const focusFrames = new Map(); let focusFrameId = 0;
const focusDocument = { activeElement: null, body: { id: "body" } }, focusLog = [];
const sourceRow = { hidden: false };
let iconOnScreen = true;
const icon = { id: "date-icon", isConnected: true, closest: () => sourceRow.hidden ? sourceRow : null,
  getBoundingClientRect: () => ({ left: 20, right: 48, top: iconOnScreen ? 100 : 700, bottom: iconOnScreen ? 128 : 728 }),
  scrollIntoView() { iconOnScreen = true; focusContext.renderBoard(); },
  focus() { focusDocument.activeElement = this; focusLog.push(this.id); } };
const otherInput = { id: "search" };
const sharedTabs = Object.fromEntries(["overview", "dates"].map(tab => [tab, { id: `shared-${tab}`, focus() { focusDocument.activeElement = this; focusLog.push(this.id); } }]));
const closeControl = { id: "close" };
const readingNodes = new Set([...Object.values(sharedTabs), closeControl]);
const readingPane = { contains: element => readingNodes.has(element), querySelector: selector => sharedTabs[selector.match(/data-detail-tab="([^"]+)"/)?.[1]] };
const focusProducts = [{ id: "selected", name: "Microphone", specs: [{ label: "Connection", value: "USB" }] }, { id: "other", name: "Other", specs: [] }];
const focusDataBefore = JSON.stringify(focusProducts), availability = [];
const focusContext = { viewerInfoIconOrigin: null, viewerInfoPendingIconFocus: null, viewerInfoOpen: false, viewerInfoProductId: null, viewerInfoProgress: 0, viewerInfoAnimationFrame: null,
  activeView: "products", selectedId: "selected", viewerInfo: readingPane, viewerInfoOutline: null, document: focusDocument,
  canvasScroll: { getBoundingClientRect: () => ({ left: 0, right: 800, top: 0, bottom: 600 }) },
  infoProduct: () => focusProducts[0], productDetailsModel: product => ({ id: product.id, specs: product.specs }),
  PortfolioDetails: { openTab() {}, focusMatch() {} }, renderInspector() {},
  renderViewerInfo() { if (!focusContext.viewerInfoOpen && focusContext.viewerInfoProgress === 0 && readingPane.contains(focusDocument.activeElement)) focusDocument.activeElement = focusDocument.body; },
  syncProductCardActions() { sourceRow.hidden = !focusContext.productCardActionAvailable("selected"); availability.push([!sourceRow.hidden, focusContext.productCardActionAvailable("other")]); focusContext.restoreViewerInfoIconFocus?.(); },
  renderBoard() { focusContext.syncProductCardActions(); }, revealViewerInfoBesideProduct() {}, scrollSelectedIntoView() {},
  requestAnimationFrame(callback) { focusFrames.set(++focusFrameId, callback); return focusFrameId; }, cancelAnimationFrame(id) { focusFrames.delete(id); },
  animateViewerInfo(value, complete) { focusContext.viewerInfoProgress = value; focusContext.renderBoard(); complete?.(); },
};
vm.createContext(focusContext); vm.runInContext(["openViewerInfo", "closeViewerInfo", "productCardActionAvailable", "restoreViewerInfoIconFocus"].map(extract).join("\n"), focusContext);
const focusFlush = () => { const batch = [...focusFrames.values()]; focusFrames.clear(); batch.forEach(callback => callback()); };
focusDocument.activeElement = icon;
focusContext.openViewerInfo("selected", { tab: "dates", originButton: icon });
assert.equal(sourceRow.hidden, false, "a keyboard-focused opener cannot be hidden before transfer");
focusFlush(); assert.equal(focusDocument.activeElement, icon); assert.equal(sourceRow.hidden, false);
focusFlush(); assert.equal(focusDocument.activeElement, sharedTabs.dates); assert.equal(sourceRow.hidden, true);
assert.deepEqual(availability.at(-1), [false, true], "only the expanded selected card loses its duplicate pair");
focusContext.closeViewerInfo(); assert.equal(sourceRow.hidden, false); assert.equal(focusDocument.activeElement, icon);
focusFlush();
focusDocument.activeElement = otherInput;
focusContext.openViewerInfo("selected", { preserveDetailTab: true }); focusFlush(); focusFlush();
assert.equal(focusDocument.activeElement, otherInput, "a search route cannot inherit an old icon opener");
assert.equal(sourceRow.hidden, true); focusDocument.activeElement = closeControl;
focusContext.closeViewerInfo(); assert.notEqual(focusDocument.activeElement, icon, "closing a non-icon route does not steal focus for an old opener"); focusFlush();
focusDocument.activeElement = icon;
focusContext.openViewerInfo("selected", { tab: "overview", originButton: icon });
focusDocument.activeElement = otherInput; focusFlush(); focusFlush();
assert.equal(focusDocument.activeElement, otherInput, "later input focus wins over delayed opening completion");
assert.equal(sourceRow.hidden, true); assert.equal(JSON.stringify(focusProducts), focusDataBefore);
focusContext.viewerInfoOpen = false; focusContext.viewerInfoProgress = .5; focusContext.viewerInfoIconOrigin = null;
assert.equal(focusContext.productCardActionAvailable("selected"), false, "duplicate icons remain hidden while the reading area visibly collapses");
focusContext.viewerInfoProgress = 0; assert.equal(focusContext.productCardActionAvailable("selected"), true);
focusDocument.activeElement = icon;
focusContext.openViewerInfo("selected", { tab: "dates", originButton: icon });
focusContext.closeViewerInfo(); focusFlush(); focusFlush();
assert.equal(focusDocument.activeElement, icon); assert.equal(sourceRow.hidden, false);
assert.equal(focusContext.viewerInfoProgress, 0, "cancelled opening cannot be restarted by its pending first frame");
focusDocument.activeElement = icon;
focusContext.openViewerInfo("selected", { tab: "dates", originButton: icon }); focusFlush(); focusFlush();
let finishClose;
focusContext.animateViewerInfo = (value, complete) => { focusContext.viewerInfoProgress = value; focusContext.renderBoard(); finishClose = complete; };
focusDocument.activeElement = closeControl; focusContext.closeViewerInfo();
focusDocument.activeElement = otherInput; finishClose(); focusFlush();
assert.equal(focusDocument.activeElement, otherInput, "new input focus during collapse is not overwritten by restoration");
focusContext.animateViewerInfo = (value, complete) => { focusContext.viewerInfoProgress = value; focusContext.renderBoard(); complete?.(); };
focusDocument.activeElement = icon; iconOnScreen = true;
focusContext.openViewerInfo("selected", { tab: "dates", originButton: icon }); focusFlush(); focusFlush();
focusDocument.activeElement = closeControl; iconOnScreen = false;
focusContext.closeViewerInfo(); assert.notEqual(focusDocument.activeElement, icon, "an offscreen opener is not focused before it is revealed");
focusFlush(); assert.equal(focusDocument.activeElement, icon, "narrow/offscreen source controls are revealed before focus restoration");

// Actual canvas sizing reserves the final extent once through opening frames.
Object.assign(layoutContext, { CARD_WIDTH: 246, CARD_GAP: 10, GUTTER: 18, SIDE_PADDING: 40, LANE_TOP: 34, PRODUCT_MIN_ZOOM: .2,
  visibleProducts: () => board.products, productCardMotionValid: () => false, productCardMotion: null, dragState: null,
  inspectorOpen: false, canvasScroll: { clientWidth: 1000, clientHeight: 600, scrollLeft: 0, scrollTop: 0 },
  viewerInfoOpen: true, viewerInfoProductId: "p0", viewerInfoProgress: 0,
  viewerInfoStacked: () => false, viewerInfoVisualWidth: () => 500, viewerInfoVisualHeight: () => 600,
  window: { devicePixelRatio: 1 },
});
layoutContext.viewerInfoReserveLogical = () => 500 / .9 * layoutContext.viewerInfoProgress;
layoutContext.productLaneGeometry = layout => {
  const extra = (600 / .9 - layout.cardHeight) * layoutContext.viewerInfoProgress;
  return { height: layout.laneHeight + extra, rows: [{ lane: board.lanes[0], top: 50, contentHeight: layout.cardHeight + extra }] };
};
vm.runInContext(extract("getCanvasDimensions") + extract("viewportCanvasContext") + extract("setupCanvas"), layoutContext);
const sizes = [];
for (const progress of [0, .01, .1, .3, .6, .8, 1]) {
  layoutContext.viewerInfoProgress = progress;
  const result = layoutContext.getCanvasDimensions(); sizes.push(result);
}
for (const size of sizes) {
  assert.ok(Math.abs(size.allocationWidth - sizes[0].allocationWidth) < 1e-8);
  assert.ok(Math.abs(size.allocationHeight - sizes[0].allocationHeight) < 1e-8);
}
let canvasResizes = 0, pixelsWide = 0, pixelsHigh = 0;
const testCanvas = { style: {}, getContext: () => ({ setTransform() {} }) };
Object.defineProperties(testCanvas, { width: { get: () => pixelsWide, set(value) { pixelsWide = value; canvasResizes++; } }, height: { get: () => pixelsHigh, set(value) { pixelsHigh = value; canvasResizes++; } } });
let viewportResizes = 0, viewportWidth = 0, viewportHeight = 0;
const viewportCanvas = { style: {}, setAttribute() {}, getContext: () => ({ setTransform() {} }) };
Object.defineProperties(viewportCanvas, { width: { get: () => viewportWidth, set(value) { viewportWidth = value; viewportResizes++; } }, height: { get: () => viewportHeight, set(value) { viewportHeight = value; viewportResizes++; } } });
testCanvas.parentElement = { insertBefore() {} };
layoutContext.document = { createElement: () => viewportCanvas };
for (const progress of [0, .01, .1, .3, .6, .8, 1]) { layoutContext.viewerInfoProgress = progress; layoutContext.setupCanvas(testCanvas); }
assert.equal(canvasResizes, 2, "opening allocates each canvas dimension once rather than reallocating every animation frame");
assert.equal(viewportResizes, 2, "viewport pixels are allocated once across the same opening frames");
assert.equal(viewportWidth, 1000); assert.equal(viewportHeight, 600);
assert.equal(pixelsWide, 1); assert.equal(pixelsHigh, 1);
assert.ok(Math.abs(parseFloat(testCanvas.style.width) - sizes[0].allocationWidth * layoutContext.zoom) < 1e-8, "the full main reading-area allocation remains the logical scroll extent");

// Actual board drawing culls only the interactive viewport; export keeps all IDs.
const draws = [], clears = [];
const paint = { clearRect: (...args) => clears.push(args), save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} };
Object.assign(layoutContext, { UI_PALETTE: { charcoal800: "#1A1B1C" }, viewerInfoOpen: false, viewerInfoProgress: 0,
  productLayoutEditing: false, selectedId: null, cardXForDisplayIndex: (_products, index) => 18 + index * 256,
  drawCard: (_context, product) => draws.push(product.id), roundRect() {}, drawDetailedFamilyHeaders() {} });
vm.runInContext(extract("drawBoardTo"), layoutContext);
const drawingDimensions = layoutContext.getCanvasDimensions();
layoutContext.drawBoardTo(paint, drawingDimensions, true);
assert.ok(draws.length > 0 && draws.length <= 5, "only visible cards need screen image/text work");
assert.equal(clears[0][2], 1000 / .9, "screen clearing is clipped to the physical viewport");
draws.length = 0; layoutContext.drawBoardTo(paint, { ...drawingDimensions, includeViewer: false }, false);
assert.equal(draws.length, 40); assert.equal(clears.at(-1)[2], drawingDimensions.width);
assert.equal(JSON.stringify(board), boardBefore);

// A read-only view cannot regenerate thousands of hidden editor controls.
let editorClears = 0;
const editor = { childElementCount: 1, replaceChildren() { editorClears++; this.childElementCount = 0; } };
const editorContext = { inspectorOpen: false, selectedProduct: () => board.products[0], inspector: editor,
  editSelectedButton: {}, applyInspectorState() {}, imageAssetSummaryHtml() { throw new Error("A closed editor must not build fields."); } };
vm.createContext(editorContext); vm.runInContext(extract("renderInspector"), editorContext);
for (let i = 0; i < 100; i++) editorContext.renderInspector();
assert.equal(editorClears, 1); assert.equal(editorContext.editSelectedButton.disabled, false);

// Geometry-only frames must not dispatch full downstream workspace refreshes;
// a real spec/date mutation still invalidates status even with the same selection.
let workspaceEvents = 0, workspaceDetail = null;
const statusContext = { portfolio: { categories: [{ id: "audio", name: "Audio", board }], settings: { timeline: { startMonth: "2026-01" } } }, board,
  activeCategoryId: "audio", activeView: "products", roadmapDetailsOpen: true, workspaceSaveRevision: 1, lastWorkspaceRenderSignature: "",
  hasDedicatedHashoutView: () => false,
  selectedProduct: () => board.products[0], visibleProducts: () => board.products,
  window: { dispatchEvent(event) { workspaceEvents++; workspaceDetail = event.detail; } }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
vm.createContext(statusContext); vm.runInContext(extract("publishWorkspaceState"), statusContext);
for (let i = 0; i < 40; i++) statusContext.publishWorkspaceState();
assert.equal(workspaceEvents, 1); statusContext.workspaceSaveRevision++; statusContext.publishWorkspaceState(); assert.equal(workspaceEvents, 2);

// Clearing a Hashout category selection must not claim that source products
// disappeared and activate the global empty-workspace overlay.
let scopedHashoutEntries = [];
Object.assign(statusContext, {
  hasDedicatedHashoutView: () => true, activeView: "roadmap",
  PortfolioHashoutLayout: { project: () => scopedHashoutEntries },
  portfolioForSearch: () => statusContext.portfolio,
  hashoutCategoryScope: () => [], hashoutSelectionEntry: () => null,
});
statusContext.publishWorkspaceState();
assert.equal(workspaceDetail.productCount, board.products.length);
assert.equal(workspaceDetail.visibleCount, 0);
assert.equal(workspaceDetail.title, "Hashout roadmap");
scopedHashoutEntries = [{ key: "one-product" }];
statusContext.publishWorkspaceState();
assert.equal(workspaceDetail.productCount, board.products.length);
assert.equal(workspaceDetail.visibleCount, 1);

// Repeated redraws retain real Details DOM, focus and scroll; changed fields or
// direct tab requests refresh it instead of silently retaining stale facts.
let htmlWrites = 0, bindCount = 0;
const panel = node(); panel.childElementCount = 0;
Object.defineProperty(panel, "innerHTML", { get: () => panel.html || "", set(value) { panel.html = value; panel.childElementCount = value ? 1 : 0; htmlWrites++; } });
let product = { id: "p", name: "Microphone", specs: [{ label: "Pattern", value: "Cardioid" }] };
const panelContext = { PortfolioViewRuntime: runtime, viewerInfo: panel, viewerInfoOutline: null, viewerInfoOpen: true, viewerInfoProgress: 1,
  infoProduct: () => product, productDetailsModel: p => ({ id: p.id, specs: p.specs }), escapeHtml: value => value,
  PortfolioDetails: { render: model => JSON.stringify(model), bind() { bindCount++; } },
  viewerInfoVisualWidth: () => 500, viewerInfoVisualHeight: () => 600, setViewerInfoSize() {}, copyTextToClipboard() {}, closeViewerInfo() {}, productDateHistoryOptions: () => ({}) };
vm.createContext(panelContext); vm.runInContext(extract("renderViewerInfo"), panelContext);
for (let i = 0; i < 100; i++) panelContext.renderViewerInfo();
assert.equal(htmlWrites, 1); assert.equal(bindCount, 1);
product.specs = [{ label: "Pattern", value: "Omnidirectional" }]; panelContext.renderViewerInfo(); assert.equal(htmlWrites, 2);
panelContext.renderViewerInfo({ force: true }); assert.equal(htmlWrites, 3);
panelContext.viewerInfoOpen = false; panelContext.viewerInfoProgress = 0; panelContext.renderViewerInfo();
panelContext.viewerInfoOpen = true; panelContext.viewerInfoProgress = 1; panelContext.renderViewerInfo(); assert.equal(htmlWrites, 5);

// Repainting a scrolling timeline never writes its unchanged native offsets.
let left = 418.25, top = 88.5, offsetWrites = 0;
const scroll = {};
Object.defineProperties(scroll, { scrollLeft: { get: () => left, set(value) { offsetWrites++; left = value; } }, scrollTop: { get: () => top, set(value) { offsetWrites++; top = value; } } });
const timeline = { closest: () => null };
const timelineContext = { roadmapFilterScrollResetPending: false, roadmapDimensions: () => ({}), setupRoadmapCanvas: () => ({}), drawRoadmapTo() {}, requestAnimationFrame: request, syncRoadmapNavigator() {} };
vm.createContext(timelineContext); vm.runInContext(extract("renderRoadmapFor"), timelineContext);
for (let i = 0; i < 40; i++) timelineContext.renderRoadmapFor(timeline, scroll, {});
assert.equal(offsetWrites, 0); timelineContext.roadmapFilterScrollResetPending = true; timelineContext.renderRoadmapFor(timeline, scroll, {});
assert.equal(offsetWrites, 1); assert.equal(top, 0);
flush();

// The hover guide follows logical cards smoothly using only one DOM overlay.
const parent = node(), cardCanvas = node(), cardScroll = node();
Object.assign(cardScroll, { parentElement: parent, offsetLeft: 40, offsetTop: 0, clientLeft: 0, clientTop: 0, clientWidth: 700, clientHeight: 500,
  scrollLeft: 0, scrollTop: 0, getBoundingClientRect: () => ({ left: 100, top: 100 }) });
const cards = [{ productId: "first", name: "One", x: 10, y: 10, width: 200, height: 300 }, { productId: "second", name: "Two", x: 220, y: 10, width: 200, height: 300 }];
const unchangedCards = JSON.stringify(cards); let owner = "audio", suspended = false;
runtime.cardHover(cardCanvas, cardScroll, { getCards: () => cards, getOwner: () => owner, getZoom: () => 1, isSuspended: () => suspended });
const hover = parent.children[0].children[0];
cardScroll.fire("pointermove", { clientX: 140, clientY: 150, pointerType: "mouse" }); flush(); assert.equal(hover.dataset.productId, "first"); flush();
cardScroll.fire("pointermove", { clientX: 350, clientY: 150, pointerType: "mouse" }); flush(); assert.equal(hover.dataset.productId, "second"); assert.equal(hover.classList.contains("is-immediate"), false);
assert.equal(cardCanvas.title, "Two"); assert.equal(frames.size, 0);
suspended = true; cardScroll.fire("pointermove", { clientX: 350, clientY: 150 }); flush(); assert.equal(hover.style.opacity, "0");
suspended = false; owner = "new"; cardScroll.fire("pointermove", { clientX: 140, clientY: 150 }); flush(); assert.equal(hover.style.opacity, "0");
assert.equal(JSON.stringify(cards), unchangedCards);

// A discontinued card dissolves once on entry, not on pointer jitter or redraw.
cards[0].discontinued = true;
cardScroll.fire("pointermove", { clientX: 140, clientY: 150, pointerType: "mouse" }); flush(); flush();
assert.equal(hover.style.opacity, ".4");
assert.equal(hover.children.length, 16, "one reused particle pool serves every card");
assert.equal(hover.classList.contains("is-disintegrating"), true);
let restarts = 0;
const addHoverClass = hover.classList.add;
hover.classList.add = name => { if (name === "is-disintegrating") restarts++; addHoverClass(name); };
for (let i = 0; i < 10; i++) { cardScroll.fire("pointermove", { clientX: 145 + i, clientY: 150, pointerType: "mouse" }); flush(); }
assert.equal(restarts, 0, "moving within the same card never restarts the burst");
cardScroll.fire("pointermove", { clientX: 350, clientY: 150, pointerType: "mouse" }); flush();
assert.equal(hover.classList.contains("is-disintegrating"), false); assert.equal(hover.style.opacity, "1");
cardScroll.fire("pointermove", { clientX: 140, clientY: 150, pointerType: "mouse" }); flush();
assert.equal(restarts, 1);
cardScroll.fire("pointerleave"); assert.equal(hover.classList.contains("is-disintegrating"), false);
cardScroll.fire("pointermove", { clientX: 140, clientY: 150, pointerType: "mouse" }); flush();
assert.equal(restarts, 2, "leaving and returning starts one new burst");
cardScroll.fire("pointermove", { clientX: 140, clientY: 150, pointerType: "touch" }); flush();
assert.equal(hover.style.opacity, "0"); assert.equal(hover.classList.contains("is-disintegrating"), false);

assert.ok(appSource.includes("allocationWidth"), "opening Details reserves canvas allocation once");
assert.ok(appSource.includes("const viewportPaint = includeSelection"), "native screen paints are clipped while exports remain complete");
assert.ok(appSource.includes("queueScrollPaint();"), "scroll bursts use the coalesced frame task");
assert.match(appSource, /if \(nextView === "split"\) globalThis\.PortfolioViewRuntime\?\.panelCache\.clear\(splitProduct\)/, "an explicit same-product SKU search cannot retain the previous cached Details tab");
console.log(`View runtime checks passed: 100-event burst→1 paint; 30 layout frames→40 product measurements; opening→2 canvas dimension allocations; only5/40 cards painted in the viewport and40/40 exported; 100 closed-editor renders→0 field builds; 100 Details renders→1 DOM mount; 40 timeline redraws→0 equal scroll writes; independent reload-safe zoom, native actions without export geometry, quiet hover and unchanged product data. Preference writes: ${writes}.`);
