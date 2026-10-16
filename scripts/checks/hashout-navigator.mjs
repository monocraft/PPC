import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "../../public/js/date-precision.js";
import "../../public/js/ffs-roadmap.js";
import "../../public/js/hashout-layout.js";

const source = await readFile(new URL("../../public/js/hashout-view.js", import.meta.url), "utf8");
const definition = (name) => {
  const match = source.match(new RegExp(`^    function ${name}\\([^]*?^    \\}`, "m"));
  assert.ok(match, `The actual Hashout ${name} adapter is available.`);
  return match[0];
};
const horizon = { start: 2026 * 12, end: 2035 * 12 + 11, count: 120 };
const quarter = globalThis.PortfolioDatePrecision.parseQuarter("Q2 2027");
const products = [
  { id: "past-viewport", name: "Earlier", ffsDate: "2026-02-10" },
  { id: "quarter", name: "Quarter", ffsDate: quarter.start, plc: { fields: { ffsDate: { value: quarter.start, period: quarter } } } },
  { id: "future-viewport", name: "Later", ffsDate: "2034-08-15" },
  { id: "missing", name: "Undated" },
  { id: "outside", name: "Outside", ffsDate: "2040-01-15" },
];
const portfolio = { categories: [{ id: "a", name: "A", board: { products } }] };
const baseline = JSON.stringify(portfolio);
const entries = globalThis.PortfolioHashoutLayout.project(portfolio);
const viewport = { start: horizon.start + 24, end: horizon.start + 54 };
const layout = globalThis.PortfolioHashoutLayout.layout(entries, horizon, { width: 1200, height: 580, leftWidth: 166, headerHeight: 78, viewportStart: viewport.start, viewportEnd: viewport.end });
const context = vm.createContext({
  root: { PortfolioFfsRoadmap: globalThis.PortfolioFfsRoadmap }, horizon, viewport, layout, entries,
  width: 1200, leftWidth: 166, height: 580, selectedKey: entries[1].key,
  navigatorProjection: [], navigatorProjectionEntries: null, navigatorProjectionSignature: "",
  headerHeight: () => 78, closeCard() {}, closeRing() {},
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
});
vm.runInContext(["boundViewport", "navigatorState", "panNavigator", "resizeNavigator"].map(definition).join("\n") + "\nfunction setViewport(value) { viewport = boundViewport(value); }", context);
const run = (code) => vm.runInContext(code, context);
const same = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} vs ${expected}`);
let state = run("navigatorState()");
same(state.scale, 4, "Hashout scale follows its continuous month viewport");
same(state.visible / state.total, .25, "The blue window occupies the visible fraction of the complete horizon");
same(state.left / state.total, .2, "The blue window starts at the current month offset");
assert.equal(state.items.length, 3, "Overview includes offscreen dated products, excluding undated and outside-horizon products");
assert.equal(state.items.filter((item) => item.selected).length, 1);
const fixedGeometry = state.items.map((item) => ({ x: item.x / state.total, width: item.width / state.total }));
same(fixedGeometry[1].width, 3 / 120, "Quarter silhouette shows its actual three-month timing window");

run("panNavigator((width - leftWidth) * .8)");
same(context.viewport.start, horizon.start + 24, "Panning through pixels translates back to logical months");
run("panNavigator((width - leftWidth) * 1.6)");
same(context.viewport.start, horizon.start + 48, "The range and step buttons can pan the timeline");
run("panNavigator(1e9)");
same(context.viewport.end, horizon.end + 1, "Pan clamps at the horizon end");

context.viewport = { ...viewport };
state = run("navigatorState()");
context.resizeRequest = { scale: 8, edge: "right", anchor: state.left / state.scale };
run("resizeNavigator(resizeRequest)");
same(context.viewport.start, viewport.start, "Resizing the right handle keeps the left month fixed");
same(context.viewport.end - context.viewport.start, 15, "Right-handle zoom changes the visible month span");
state = run("navigatorState()");
state.items.forEach((item, index) => {
  same(item.x / state.total, fixedGeometry[index].x, "Overview positions remain fixed while zooming");
  same(item.width / state.total, fixedGeometry[index].width, "Overview widths remain fixed while zooming");
});

context.viewport = { ...viewport };
state = run("navigatorState()");
context.resizeRequest = { scale: 8, edge: "left", anchor: (state.left + state.visible) / state.scale };
run("resizeNavigator(resizeRequest)");
same(context.viewport.end, viewport.end, "Resizing the left handle keeps the right month fixed");
same(context.viewport.start, viewport.end - 15, "Left-handle zoom preserves the opposite logical edge");
context.resizeRequest.scale = 1e9;
run("resizeNavigator(resizeRequest)");
same(context.viewport.end - context.viewport.start, 6, "Resize preserves Hashout's existing minimum span");

context.horizon = { start: horizon.start, end: horizon.start + 1, count: 2 };
context.viewport = { start: horizon.start, end: horizon.start + 2 };
state = run("navigatorState()");
same(state.maxScale, 1, "Short horizons have a finite, safe scale bound");
context.entries = []; context.layout = { lanes: [] }; context.horizon = null; context.viewport = null;
state = run("navigatorState()");
assert.equal(state.items.length, 0);
assert.ok(Number.isFinite(state.total) && Number.isFinite(state.left), "An empty roadmap has a safe navigator state");
assert.equal(JSON.stringify(portfolio), baseline, "Navigation never mutates products or timing evidence");
assert.match(source, /overview\?\.destroy\(\)/, "Destroy releases the shared navigator's listeners and pointer capture");
console.log("Hashout navigator checks passed: complete-horizon silhouettes, pan, both anchored resize handles, bounds, empty data, and cleanup.");
