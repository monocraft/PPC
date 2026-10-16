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

// Use the actual search adapters and event bindings. Compact appearance must be
// independent of the suggestions' aria-expanded state and never erase a query.
function searchHarness() {
  const document = { activeElement: null, events: new Map(), addEventListener(name, callback) { this.events.set(name, callback); } };
  class SearchNode {
    constructor(tag = "div") { this.tagName = tag; this.children = []; this.parentNode = null; this.value = ""; this.hidden = false; this.attributes = new Map(); this.events = new Map(); this.classes = new Set(); }
    get classList() { return { contains: value => this.classes.has(value), toggle: (value, force) => { if (force) this.classes.add(value); else this.classes.delete(value); } }; }
    append(...children) { children.forEach(child => { child.parentNode = this; this.children.push(child); }); }
    replaceChildren() { this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(name, handler) { const handlers = this.events.get(name) || []; handlers.push(handler); this.events.set(name, handlers); }
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
    querySelector(tag) { return this.querySelectorAll(tag)[0] || null; }
    fire(name, payload = {}) {
      const event = { target: this, defaultPrevented: false, propagationStopped: false, bubbles: true, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...payload };
      for (let target = this; target && !event.propagationStopped; target = event.bubbles ? target.parentNode : null) for (const handler of target.events.get(name) || []) handler(event);
      return event;
    }
    focus() {
      if (document.activeElement === this) return;
      const previous = document.activeElement; document.activeElement = this;
      previous?.fire("focusout", { relatedTarget: this });
      this.fire("focus", { bubbles: false }); this.fire("focusin");
    }
    blur() { if (document.activeElement === this) { document.activeElement = null; this.fire("focusout", { relatedTarget: null }); } }
    click() { this.fire("click"); }
  }
  const searchShell = new SearchNode(), search = new SearchNode("input"), results = new SearchNode(), outside = new SearchNode("button"), focused = [];
  searchShell.append(search, results); results.hidden = true; search.setAttribute("aria-expanded", "false"); document.activeElement = outside;
  const entries = [{ key: "test-product", product: { name: "Cloud test", color: "#123456", imageAssetId: "retained-image", specs: [{ label: "Connection", value: "Wireless" }] } }];
  const before = JSON.stringify(entries);
  const searchContext = vm.createContext({ document, searchShell, search, results, entries, searchSignature: "", suppressSearchFocus: false,
    node: (tag, _className, text) => Object.assign(new SearchNode(tag), { textContent: text || "" }),
    listen: (target, name, callback) => target.addEventListener(name, callback),
    searchText: entry => entry.product.name.toLowerCase(), focusProduct: key => focused.push(key),
    productButton(entry, action) { const button = new SearchNode("button"); button.addEventListener("click", () => action(entry)); return button; },
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  });
  const outsideClickBinding = source.match(/    listen\(document, "click", dismissSearchOutside\);/)?.[0];
  assert.ok(outsideClickBinding, "non-pointer outside activation uses the same dismissal adapter");
  vm.runInContext(["syncSearchEngagement", "closeSearch", "dismissSearchOutside", "updateSearch"].map(definition).join("\n") +
    source.slice(source.indexOf('    listen(search, "input"'), source.indexOf('    listen(document, "pointerdown"')) + outsideClickBinding, searchContext);
  return { document, searchShell, search, results, outside, focused, context: searchContext, assertUnchanged() { assert.equal(JSON.stringify(entries), before, "search engagement cannot mutate product facts, artwork or metadata"); } };
}
const lookup = searchHarness();
const engaged = () => lookup.searchShell.classList.contains("is-engaged");
lookup.context.syncSearchEngagement(); assert.equal(engaged(), false, "unused empty Hashout search starts compact");
lookup.search.focus(); assert.equal(engaged(), true); assert.equal(lookup.results.hidden, true, "empty focus expands input without inventing suggestions");
assert.equal(lookup.search.getAttribute("aria-expanded"), "false", "input expansion never misreports list visibility");
lookup.outside.focus(); assert.equal(engaged(), false, "empty focus leaving the shell restores compact search");
for (const activation of ["pointerdown", "click"]) {
  lookup.search.focus();
  assert.equal(engaged(), true);
  if (activation === "click") lookup.document.events.get("click")({ target: lookup.outside });
  else lookup.context.dismissSearchOutside({ target: lookup.outside });
  assert.equal(lookup.document.activeElement, null, `outside ${activation} releases empty search focus even on a blank nonfocusable surface`);
  assert.equal(engaged(), false, `outside ${activation} restores the compact empty search`);
}
lookup.search.focus(); lookup.search.value = "Cloud"; lookup.search.fire("input");
assert.equal(engaged(), true); assert.equal(lookup.results.hidden, false); assert.equal(lookup.search.getAttribute("aria-expanded"), "true");
lookup.outside.focus(); assert.equal(lookup.results.hidden, true); assert.equal(engaged(), true, "active query remains fully readable after blur");
assert.equal(lookup.search.value, "Cloud");
lookup.search.focus(); assert.equal(lookup.results.hidden, false, "refocusing the retained query reopens its results");
let searchEvent = lookup.search.fire("keydown", { key: "Escape" });
assert.equal(searchEvent.defaultPrevented, true); assert.equal(searchEvent.propagationStopped, true);
assert.equal(lookup.results.hidden, true); assert.equal(lookup.document.activeElement, lookup.search); assert.equal(engaged(), true); assert.equal(lookup.search.value, "Cloud");
lookup.context.updateSearch(); assert.equal(lookup.results.hidden, true, "ordinary redraws cannot reopen dismissed search results");
lookup.search.fire("keydown", { key: "ArrowDown" });
assert.equal(lookup.document.activeElement, lookup.results.querySelector("button")); assert.equal(lookup.results.hidden, false); assert.equal(engaged(), true, "keyboard focus in results keeps the full input visible");
const composingResult = lookup.document.activeElement;
composingResult.fire("keydown", { key: "Escape", isComposing: true });
assert.equal(lookup.document.activeElement, composingResult); assert.equal(lookup.results.hidden, false, "IME composition in results does not close or refocus the search");
lookup.document.activeElement.fire("keydown", { key: "Escape" });
assert.equal(lookup.document.activeElement, lookup.search); assert.equal(lookup.results.hidden, true, "Escape from results refocuses the input without immediately reopening them");
assert.equal(lookup.search.getAttribute("aria-expanded"), "false");
lookup.document.events.get("click")({ target: lookup.outside });
assert.equal(lookup.document.activeElement, null); assert.equal(engaged(), true); assert.equal(lookup.search.value, "Cloud", "outside activation leaves an active query fully visible");
lookup.search.focus(); lookup.search.fire("keydown", { key: "Escape" });
lookup.search.fire("keydown", { key: "Enter" }); assert.equal(lookup.focused.length, 0, "a closed result list cannot activate hidden products");
lookup.search.fire("keydown", { key: "ArrowDown", isComposing: true }); assert.equal(lookup.results.hidden, true, "IME composition does not move focus away from the input");
lookup.search.fire("keydown", { key: "ArrowDown" }); lookup.document.activeElement.click();
assert.deepEqual(lookup.focused, ["test-product"]); assert.equal(lookup.results.hidden, true); assert.equal(lookup.document.activeElement, lookup.search, "selecting a result leaves focus on a visible control");
lookup.search.value = ""; lookup.search.fire("search");
assert.equal(lookup.results.hidden, true); assert.equal(engaged(), true, "native clear keeps an actively focused input expanded");
lookup.outside.focus(); assert.equal(engaged(), false);
lookup.search.value = "Cloud"; lookup.context.searchSignature = ""; lookup.context.updateSearch();
assert.equal(engaged(), true); assert.equal(lookup.results.hidden, true, "restoring a saved query expands its text without opening unfocused suggestions");
lookup.search.value = ""; lookup.context.updateSearch(); assert.equal(engaged(), false, "a programmatic query clear resets the idle width");
lookup.assertUnchanged();

const css = await readFile(new URL("../../public/css/hashout-roadmap.css", import.meta.url), "utf8");
assert.match(css, /\.hashout-search-shell\s*\{[^}]*flex:\s*0 0 36px[^}]*width:\s*36px/, "idle desktop Hashout search reserves only its magnifier footprint");
assert.match(css, /\.hashout-search-shell\.is-engaged,\s*\.hashout-search-shell:focus-within\s*\{[^}]*flex:\s*0 1 360px/, "engaged desktop search fully expands with an immediate native focus fallback");
assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*?flex-basis:\s*44px[\s\S]*?\.hashout-search\s*\{[^}]*min-height:\s*44px/, "compact touch search retains a usable 44px target");
assert.match(css, /@media \(max-width: 700px\)\s*\{\s*\.hashout-search-shell\.is-engaged,\s*\.hashout-search-shell:focus-within\s*\{[^}]*flex:\s*1 0 100%/, "only engaged mobile search takes a complete toolbar row");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.hashout-search-shell\s*\{\s*transition:\s*none/, "reduced motion removes expansion transitions");
assert.match(source, /listen\(document, "pointerdown",[\s\S]*?dismissSearchOutside\(event\);/, "outside pointer dismissal uses the same safe close and engagement state");
console.log("Hashout navigator checks passed: complete-horizon silhouettes, pan, anchored resizing, bounds, cleanup, compact and engaged search, retained queries, keyboard/IME input, Escape refocus, focusout dismissal, programmatic restoration, and immutable products.");
