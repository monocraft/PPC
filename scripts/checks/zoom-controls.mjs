import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = (await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
function appFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(start >= 0 && end > start, `The real ${name} function is available.`);
  return source.slice(start, end + 3);
}
function clickBinding(id) {
  const start = source.indexOf(`$("#${id}").onclick = `);
  assert.ok(start >= 0, `The real ${id} button is bound.`);
  return source.slice(start).split("\n", 1)[0];
}
const elements = new Map();
const element = (selector) => {
  if (!elements.has(selector)) elements.set(selector, { textContent: "", disabled: false });
  return elements.get(selector);
};
let contentWidth = 50000;
let contentHeight = 9000;
let months = 120;
const products = [{ id: "one", order: 4, manualPosition: { x: 400, y: 90 }, launchDate: "2026-09-01" }];
const unchangedProducts = JSON.stringify(products);
const sandbox = {
  $: element, zoom: 1, roadmapMonthWidth: 82, activeView: "products", board: { products },
  PRODUCT_MIN_ZOOM: .2, PRODUCT_MAX_ZOOM: 1.5,
  ROADMAP_LEFT_WIDTH: 190, ROADMAP_DEFAULT_MONTH_WIDTH: 82, ROADMAP_MIN_MONTH_WIDTH: 8, ROADMAP_MAX_MONTH_WIDTH: 112,
  selectedProduct: () => products[0], getCanvasDimensions: () => ({ width: contentWidth, height: contentHeight }),
  productView: { clientHeight: 648 },
  roadmapRange: () => ({ count: months }),
  canvasScroll: { clientWidth: 900, clientHeight: 600, scrollLeft: 600, scrollTop: 500 },
  roadmapScroll: { clientWidth: 900, scrollLeft: 800, scrollTop: 400 },
  splitRoadmapScroll: { clientWidth: 700, scrollLeft: 500, scrollTop: 250 },
  requestAnimationFrame: (callback) => callback(), syncBoardNavigator() {}, syncLaneRail() {}, closePopupMenus() {},
  renderBoard() { sandbox.syncViewZoomControls(); }, renderRoadmaps() { sandbox.syncViewZoomControls(); },
};
vm.createContext(sandbox);
vm.runInContext(
  ["clampViewZoom", "snappedViewZoom", "steppedViewZoom", "syncViewZoomControls", "setProductZoom", "setRoadmapZoom", "fitProductBoard", "fitProductLanesVertically", "fitRoadmapTimeline"]
    .map(appFunction).join("\n") + "\n" +
  ["zoomOut", "zoomReset", "zoomIn", "fitProducts", "roadmapZoomOut", "roadmapZoomReset", "roadmapZoomIn", "roadmapFit"]
    .map(clickBinding).join("\n"), sandbox,
);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: expected${expected}, received${actual}`);
const productCenter = () => ({
  x: (sandbox.canvasScroll.scrollLeft + sandbox.canvasScroll.clientWidth / 2) / sandbox.zoom,
  y: (sandbox.canvasScroll.scrollTop + sandbox.canvasScroll.clientHeight / 2) / sandbox.zoom,
});
const timelineCenter = (scroll) => (scroll.scrollLeft + (scroll.clientWidth - 190) / 2) / sandbox.roadmapMonthWidth;

// Every scale, including either lower bound, advances by ten percentage points.
sandbox.zoom = .2;
sandbox.syncViewZoomControls();
element("#zoomIn").onclick();
assert.equal(sandbox.zoom, .3);
assert.equal(element("#zoomReset").textContent, "30%");
element("#zoomOut").onclick();
assert.equal(sandbox.zoom, .2);
assert.equal(element("#zoomOut").disabled, true);
sandbox.roadmapMonthWidth = 8;
element("#roadmapZoomIn").onclick();
near(sandbox.roadmapMonthWidth, 16.4, "A minimum-scale roadmap advances to 20%.");
assert.equal(element("#roadmapZoomReset").textContent, "20%");
element("#roadmapZoomOut").onclick();
near(sandbox.roadmapMonthWidth, 8.2, "Timeline minus returns to its clean 10% lower bound.");
assert.equal(element("#roadmapZoomOut").disabled, true);

// Every button press makes visible progress, and either bound is reachable.
for (const [view, minimum, maximum, percentSelector, plus, minus] of [
  ["products", .2, 1.5, "#zoomReset", "#zoomIn", "#zoomOut"],
  ["roadmap", .1, 1.3, "#roadmapZoomReset", "#roadmapZoomIn", "#roadmapZoomOut"],
]) {
  sandbox.activeView = view;
  if (view === "products") sandbox.zoom = minimum; else sandbox.roadmapMonthWidth = minimum * 82;
  sandbox.syncViewZoomControls();
  const scale = () => view === "products" ? sandbox.zoom : sandbox.roadmapMonthWidth / 82;
  let previous = scale(), previousLabel = parseInt(element(percentSelector).textContent, 10), count = 0;
  while (!element(plus).disabled && count++ < 30) {
    element(plus).onclick();
    assert.ok(scale() > previous, "Plus always increases the real scale.");
    const nextLabel = parseInt(element(percentSelector).textContent, 10);
    assert.equal(nextLabel - previousLabel, 10, "Plus advances exactly ten percentage points at every supported scale.");
    assert.equal(nextLabel % 10, 0, "Plus never displays a fractional ten-point stop.");
    previous = scale(); previousLabel = nextLabel;
  }
  assert.ok(count < 30, "The maximum does not require excessive clicks.");
  near(scale(), maximum, "Plus reaches the view's upper bound.");
  count = 0;
  while (!element(minus).disabled && count++ < 30) {
    element(minus).onclick();
    assert.ok(scale() < previous, "Minus always decreases the real scale.");
    const nextLabel = parseInt(element(percentSelector).textContent, 10);
    assert.equal(previousLabel - nextLabel, 10, "Minus reduces the scale by exactly ten percentage points.");
    assert.equal(nextLabel % 10, 0);
    previous = scale(); previousLabel = nextLabel;
  }
  near(scale(), minimum, "Minus reaches the view's lower bound.");
}

// Product zoom preserves both axes of the visible area instead of jumping away.
sandbox.activeView = "products";
sandbox.zoom = .8;
sandbox.canvasScroll.scrollLeft = 700; sandbox.canvasScroll.scrollTop = 600;
let productFocus = productCenter();
const retainedTimelineScale = sandbox.roadmapMonthWidth;
element("#zoomIn").onclick();
assert.equal(sandbox.zoom, .9);
near(productCenter().x, productFocus.x, "Product plus keeps the horizontal focal point.");
near(productCenter().y, productFocus.y, "Product plus keeps the vertical focal point.");
element("#zoomOut").onclick();
near(productCenter().x, productFocus.x, "Inverse product zoom keeps the horizontal focal point.");
near(productCenter().y, productFocus.y, "Inverse product zoom keeps the vertical focal point.");
assert.equal(sandbox.roadmapMonthWidth, retainedTimelineScale, "Products zoom cannot change the roadmap scale.");

// Fit retains readable cards even with hundreds of products in a long lane.
element("#fitProducts").onclick();
assert.equal(sandbox.zoom, .7);
assert.equal(element("#zoomReset").textContent, "70%");
assert.equal(element("#zoomOut").disabled, false, "Manual overview zoom remains available below Fit.");
near(productCenter().x, productFocus.x, "Fit products keeps the horizontal focal point.");
near(productCenter().y, productFocus.y, "Fit products keeps the vertical focal point.");
element("#zoomIn").onclick();
assert.equal(sandbox.zoom, .8, "A readable Fit can be increased in one predictable click.");
element("#zoomReset").onclick();
assert.equal(sandbox.zoom, 1);
assert.equal(element("#zoomReset").textContent, "100%");
contentWidth = 100;
element("#fitProducts").onclick();
assert.equal(sandbox.zoom, 1, "Fitting a short product lane does not enlarge cards beyond normal size.");

// Both Fit entry points round down by tens, including category auto-fit.
for (const [ratio, expected] of [[.88, .8], [.85, .8], [.79, .7], [.63, .7], [1.24, 1]]) {
  contentWidth = (sandbox.canvasScroll.clientWidth - 18) / ratio;
  element("#fitProducts").onclick();
  assert.equal(sandbox.zoom, expected, `Horizontal Fit for ${ratio * 100}% uses a clean, readable stop.`);
  contentHeight = (sandbox.productView.clientHeight - 48) / ratio;
  sandbox.fitProductLanesVertically();
  assert.equal(sandbox.zoom, expected, `Category auto-fit for ${ratio * 100}% follows the same clean stops.`);
  assert.equal(sandbox.canvasScroll.scrollTop, 0, "Category auto-fit keeps the established first-lane starting position.");
  assert.equal(parseInt(element("#zoomReset").textContent, 10) % 10, 0);
}

// Roadmap Fit uses the active viewport and never crushes a long span to10%.
for (const view of ["roadmap", "split"]) {
  sandbox.activeView = view;
  const scroll = view === "split" ? sandbox.splitRoadmapScroll : sandbox.roadmapScroll;
  const other = view === "split" ? sandbox.roadmapScroll : sandbox.splitRoadmapScroll;
  const otherLeft = other.scrollLeft;
  sandbox.roadmapMonthWidth = 82;
  scroll.scrollLeft = 800;
  const focus = timelineCenter(scroll), top = scroll.scrollTop;
  months = 1000;
  element("#roadmapFit").onclick();
  near(sandbox.roadmapMonthWidth, 32.8, "Long timelines Fit at a readable40% floor.");
  assert.equal(element("#roadmapZoomReset").textContent, "40%");
  near(timelineCenter(scroll), focus, "Roadmap Fit keeps the visible calendar center.");
  assert.equal(scroll.scrollTop, top, "Roadmap Fit preserves vertical position.");
  assert.equal(other.scrollLeft, otherLeft, "Fit cannot move the other roadmap viewport.");
  element("#roadmapZoomIn").onclick();
  assert.equal(element("#roadmapZoomReset").textContent, "50%");
  element("#roadmapZoomReset").onclick();
  assert.equal(sandbox.roadmapMonthWidth, 82);
  months = 12;
  element("#roadmapFit").onclick();
const available = scroll.clientWidth - 190 - 24;
assert.equal(parseInt(element("#roadmapZoomReset").textContent, 10) % 10, 0, "Roadmap Fit displays a clean ten-point percentage.");
assert.ok(sandbox.roadmapMonthWidth * 12 <= available, "Roadmap Fit rounds downward so the range fits when above the readable floor.");
assert.ok((sandbox.roadmapMonthWidth + 8.2) * 12 > available, "Roadmap Fit chooses the largest clean stop that fits.");
}

// Off-grid Fit values and legacy tiny/invalid scales remain recoverable.
for (const restored of [.88, .85, .63, .652, 1.25, 9]) {
  sandbox.zoom = restored;
  sandbox.roadmapMonthWidth = restored * 82;
  sandbox.syncViewZoomControls();
  assert.equal(parseInt(element("#zoomReset").textContent, 10) % 10, 0, "Restored product zoom never retains irregular percentages.");
  assert.equal(parseInt(element("#roadmapZoomReset").textContent, 10) % 10, 0, "Restored timeline zoom never retains irregular percentages.");
  assert.ok(sandbox.zoom >= .2 && sandbox.zoom <= 1.5);
  assert.ok(sandbox.roadmapMonthWidth >= 8 && sandbox.roadmapMonthWidth <= 112, "Clean timeline stops remain within existing safe pixel limits.");
}
sandbox.canvasScroll.scrollLeft = 800; sandbox.canvasScroll.scrollTop = 600;
sandbox.zoom = .85;
const legacyFocus = productCenter();
sandbox.setProductZoom(.88);
assert.equal(sandbox.zoom, .9, "Direct irregular zoom requests normalize to a ten-point percentage.");
near(productCenter().x, legacyFocus.x, "Normalizing legacy zoom preserves the actual horizontal focal point.");
near(productCenter().y, legacyFocus.y, "Normalizing legacy zoom preserves the actual vertical focal point.");
sandbox.activeView = "roadmap";
sandbox.roadmapMonthWidth = .85 * 82;
sandbox.roadmapScroll.scrollLeft = 800;
const legacyMonth = timelineCenter(sandbox.roadmapScroll);
sandbox.setRoadmapZoom(.88 * 82);
assert.equal(element("#roadmapZoomReset").textContent, "90%");
near(timelineCenter(sandbox.roadmapScroll), legacyMonth, "Normalizing a legacy timeline preserves its visible month center.");

sandbox.zoom = .71;
element("#zoomIn").onclick(); assert.equal(sandbox.zoom, .8);
sandbox.zoom = .71;
element("#zoomOut").onclick(); assert.equal(sandbox.zoom, .6);
sandbox.zoom = .652;
element("#zoomOut").onclick(); assert.equal(sandbox.zoom, .6, "An off-grid scale normalizes before a predictable minus step.");
sandbox.zoom = .798;
element("#zoomIn").onclick(); assert.equal(sandbox.zoom, .9, "An off-grid scale normalizes before a predictable plus step.");
sandbox.zoom = .01; sandbox.roadmapMonthWidth = .82;
sandbox.syncViewZoomControls();
assert.equal(sandbox.zoom, .2); near(sandbox.roadmapMonthWidth, 8.2, "A tiny legacy timeline scale restores to a clean minimum.");
assert.equal(element("#zoomReset").textContent, "20%");
assert.equal(element("#roadmapZoomReset").textContent, "10%");
element("#zoomIn").onclick(); assert.equal(sandbox.zoom, .3);
element("#roadmapZoomReset").onclick(); assert.equal(sandbox.roadmapMonthWidth, 82);
sandbox.setProductZoom(NaN); assert.equal(sandbox.zoom, .3, "Invalid input retains the current product scale.");
sandbox.setRoadmapZoom(NaN); assert.equal(sandbox.roadmapMonthWidth, 82, "Invalid input retains the current roadmap scale.");
sandbox.canvasScroll.scrollLeft = 0; sandbox.canvasScroll.scrollTop = 0;
sandbox.setProductZoom(.2);
assert.ok(sandbox.canvasScroll.scrollLeft >= 0 && sandbox.canvasScroll.scrollTop >= 0, "Product zoom never scrolls outside the origin.");
assert.equal(JSON.stringify(products), unchangedProducts, "View zoom/Fit/reset cannot alter product dates, order, or saved layout.");

console.log("Zoom controls checks passed: clean ten-point steps at every scale, rounded readable Fit, focal anchors, independent views, safe recovery, and unchanged product data.");
