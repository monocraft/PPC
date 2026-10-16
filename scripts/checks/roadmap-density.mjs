import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [source, appSource] = await Promise.all([
  readFile(new URL("../../public/js/roadmap-density.js", import.meta.url), "utf8"),
  readFile(new URL("../../public/js/app.js", import.meta.url), "utf8"),
]);
const plain = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} versus ${expected}`);

function node(tag = "div") {
  const events = new Map(), captures = new Set();
  const element = {
    tagName: tag.toUpperCase(), children: [], parentElement: null, attributes: {}, style: {}, dataset: {}, className: "", focusCalls: [],
    matches(selector) { return selector.startsWith(".") && this.className.split(/\s+/).includes(selector.slice(1)); },
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; },
    contains(target) { return this === target || this.children.some(child => child.contains(target)); },
    querySelector(selector) { for (const child of this.children) { if (child.matches(selector)) return child; const result = child.querySelector(selector); if (result) return result; } return null; },
    append(...children) { for (const child of children) { if (child.tagName === "#FRAGMENT") { this.append(...[...child.children]); continue; } child.remove(); child.parentElement = this; this.children.push(child); } },
    remove() { if (!this.parentElement) return; this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; },
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    focus(options) { this.focusCalls.push(options); },
    getBoundingClientRect() { return this.rect || { top: 100, height: 500, right: 300, bottom: 130 }; },
    setPointerCapture(id) { captures.add(id); }, hasPointerCapture(id) { return captures.has(id); }, releasePointerCapture(id) { captures.delete(id); },
    addEventListener(name, callback, options = {}) {
      if (options.signal?.aborted) return;
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(callback);
      options.signal?.addEventListener("abort", () => events.get(name)?.delete(callback), { once: true });
    },
    fire(name, extras = {}) {
      const event = { target: this, button: 0, isPrimary: true, pointerId: 1, clientY: 100, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extras };
      for (const callback of [...(events.get(name) || [])]) callback(event);
      return event;
    },
    listenerCount() { return [...events.values()].reduce((sum, entries) => sum + entries.size, 0); },
  };
  element.classList = {
    contains(name) { return element.className.split(/\s+/).includes(name); },
    add(...names) { element.className = [...new Set([...element.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
    remove(...names) { element.className = element.className.split(/\s+/).filter(name => name && !names.includes(name)).join(" "); },
    toggle(name, force) { const active = force ?? !this.contains(name); if (active) this.add(name); else this.remove(name); return active; },
  };
  return element;
}
function environment(stored = null) {
  const root = node(), storage = new Map();
  if (stored !== null) storage.set("portfolio.roadmap.row-height.v1", stored);
  root.document = Object.assign(node(), { createElement: node, createDocumentFragment: () => node("#fragment") });
  root.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  root.AbortController = AbortController; root.innerWidth = 1000; root.innerHeight = 800;
  vm.createContext(root); vm.runInContext(source, root);
  return { root, api: root.PortfolioRoadmapDensity, storage };
}
function harness() {
  const environmentValue = environment(), { api, root } = environmentValue, host = node();
  const items = Object.freeze([Object.freeze({ y: 100, height: 40, selected: true }), Object.freeze({ y: 600, height: 40 })]);
  let current = { total: 1000, visible: 400, offset: 200, height: 40, rowCount: 20, overhead: 200, items };
  const pans = [], resizes = [];
  const controller = api.createNavigator(host, { getState: () => current,
    onPan(offset) { pans.push(offset); current = { ...current, offset }; },
    onResize(value) { resizes.push(plain(value)); },
  });
  const rail = host.querySelector(".roadmap-vertical-navigator"), window = host.querySelector(".roadmap-vertical-window");
  const top = host.querySelector(".roadmap-vertical-top"), bottom = host.querySelector(".roadmap-vertical-bottom"), pan = host.querySelector(".roadmap-vertical-pan");
  return { ...environmentValue, host, controller, rail, window, top, bottom, pan, pans, resizes,
    state: () => current, set(value) { current = { ...current, ...value }; controller.update(); },
    pointer(name, clientY, target = pan, extras = {}) { return rail.fire(name, { clientY, target, ...extras }); },
  };
}

{
  const { api, storage } = environment();
  assert.equal(api.getHeight(), 38);
  const calls = [], unsubscribe = api.subscribe((height, metadata) => calls.push([height, plain(metadata)]));
  api.setHeight(27, { source: "test" });
  assert.deepEqual(calls[0], [28, { source: "test", previousHeight: 38 }], "view consumers update synchronously with their previous geometry");
  api.setHeight(-10); assert.equal(api.getHeight(), 24);
  api.setHeight(100); assert.equal(api.getHeight(), 48);
  api.setHeight(48); assert.equal(calls.length, 3, "unchanged density does not cause a render");
  assert.equal(storage.get("portfolio.roadmap.row-height.v1"), "48");
  unsubscribe(); api.setHeight(38); assert.equal(calls.length, 3);
  assert.equal(environment("28").api.getHeight(), 28, "a later view restores the local preference");
  assert.equal(environment("invalid").api.getHeight(), 38, "bad local preferences retain a readable default");
}
{
  const h = environment(), host = node(); let fits = 0;
  const control = h.api.attachControl(host, { fit() { fits++; } });
  const presets = host.querySelector(".roadmap-density-presets").children;
  assert.deepEqual(Array.from(presets, preset => preset.textContent), ["Default", "Compact"]);
  presets[1].fire("click"); assert.equal(h.api.getHeight(), 28);
  assert.equal(presets[1].attributes["aria-pressed"], "true");
  presets[0].fire("click"); assert.equal(h.api.getHeight(), 38);
  const range = host.querySelector(".roadmap-density-range"); range.value = "24"; range.fire("input");
  assert.equal(h.api.getHeight(), 24); assert.ok(Array.from(presets).every(preset => preset.attributes["aria-pressed"] === "false"));
  range.value = "28"; range.fire("input"); assert.equal(presets[1].attributes["aria-pressed"], "true");
  range.value = "38"; range.fire("input"); assert.equal(presets[0].attributes["aria-pressed"], "true");
  const details = host.querySelector(".roadmap-density-control"); details.open = true;
  assert.equal(host.querySelector(".roadmap-density-fit"), null);
  details.fire("keydown", {key:"Escape"}); assert.equal(fits, 0); assert.equal(details.open, false);
  details.open = true; h.root.document.fire("pointerdown", { target: node() }); assert.equal(details.open, false);
  control.destroy(); assert.equal(host.children.length, 0); assert.equal(h.root.document.listenerCount(), 0);
}
{
  const h = harness();
  assert.equal(h.window.style.top, "20%"); assert.equal(h.window.style.height, "40%");
  assert.equal(h.pan.attributes["aria-orientation"], "vertical");
  assert.equal(h.bottom.attributes["aria-valuenow"], "40");
  h.pointer("pointerdown", 550, h.rail); assert.equal(h.state().offset, 600, "a track click centers and clamps the viewport");
  h.pointer("pointerup", 550); h.set({ offset: 200 });
  h.pointer("pointerdown", 250); h.pointer("pointermove", 300); assert.equal(h.state().offset, 300, "pan retains the original grab point");
  h.pointer("pointermove", -1000); assert.equal(h.state().offset, 0);
  h.pointer("pointermove", 2000); assert.equal(h.state().offset, 600);
  h.pointer("pointerup", 2000); assert.equal(h.resizes.length, 0);
  h.controller.destroy();
}
for (const edge of ["top", "bottom"]) {
  const h = harness(), handle = h[edge], start = edge === "top" ? 200 : 400;
  h.pointer("pointerdown", start, handle);
  h.pointer("pointermove", edge === "top" ? 150 : 450, handle);
  assert.deepEqual(h.resizes.at(-1), { height: 30, edge, anchor: edge === "top" ? 600 : 200, initialHeight: 40 });
  h.set({ total: 800, height: 30, offset: 100 });
  h.pointer("pointermove", edge === "top" ? 150 : 450, handle);
  assert.deepEqual(h.resizes.at(-1), h.resizes[0], "repeated moves retain the original gesture geometry after reflow");
  h.pointer("pointermove", start, handle); assert.equal(h.resizes.at(-1).height, 40, "returning to the starting edge restores the initial density");
  h.pointer("pointerup", start, handle); assert.equal(h.pans.length, 0);
  h.controller.destroy();
}
{
  const h = harness();
  h.rail.fire("keydown", { target: h.pan, key: "ArrowDown" }); assert.equal(h.state().offset, 240);
  h.rail.fire("keydown", { target: h.pan, key: "PageDown" }); assert.equal(h.state().offset, 600);
  h.rail.fire("keydown", { target: h.pan, key: "Home" }); assert.equal(h.state().offset, 0);
  h.rail.fire("keydown", { target: h.top, key: "ArrowUp" }); assert.equal(h.resizes.at(-1).height, 38);
  h.rail.fire("keydown", { target: h.bottom, key: "ArrowDown", shiftKey: true }); assert.equal(h.resizes.at(-1).height, 34);
  h.rail.fire("keydown", { target: h.bottom, key: "Home" }); assert.equal(h.resizes.at(-1).height, 24);
  h.rail.fire("keydown", { target: h.top, key: "End" }); assert.equal(h.resizes.at(-1).height, 48);
  assert.equal(h.rail.fire("keydown", { target: h.pan, key: "Tab" }).defaultPrevented, false);
  h.controller.destroy();
}
for (const termination of ["pointerup", "pointercancel", "lostpointercapture", "Escape", "blur", "destroy"]) {
  const h = harness(); h.pointer("pointerdown", 250); h.pointer("pointermove", 300);
  assert.equal(h.rail.hasPointerCapture(1), true);
  if (termination === "Escape") h.rail.fire("keydown", { target: h.pan, key: "Escape" });
  else if (termination === "blur") h.root.fire("blur");
  else if (termination === "destroy") h.controller.destroy();
  else h.pointer(termination, 300);
  const count = h.pans.length; h.pointer("pointermove", 400);
  assert.equal(h.pans.length, count, `${termination} prevents stale drag updates`);
  assert.equal(h.rail.hasPointerCapture(1), false); assert.equal(h.rail.classList.contains("is-dragging"), false);
  if (termination !== "destroy") h.controller.destroy();
  assert.equal(h.rail.listenerCount(), 0); assert.equal(h.root.listenerCount(), 0); assert.equal(h.root.document.listenerCount(), 0);
}

// Sparse lifecycle roadmaps retain a minimum body height. Exercise the shipped
// dimensions + navigator adapter so this filler cannot become fictitious rows
// or cause a density jump before the pointer has moved.
const extractApplication = name => {
  const value = appSource.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"))?.[0];
  assert.ok(value, `application ${name} is available`); return value;
};
for (const count of [0, 1, 2, 20]) {
  const h = environment(), host = node(), canvas = {};
  const groups = count ? [{ products: Array.from({ length: count }, (_, index) => ({ id: `p${index}` })) }] : [];
  const scroll = { id: "sparse", clientHeight: 600, scrollTop: 0, parentElement: host, querySelector: () => canvas };
  const updates = [], controllers = [];
  const context = { ROADMAP_HEADER_HEIGHT: 128, ROADMAP_GROUP_HEADER_HEIGHT: 28, ROADMAP_ROW_HEIGHT: 38,
    ROADMAP_BOTTOM_PADDING: 24, ROADMAP_MIN_BODY_HEIGHT: 156, ROADMAP_LEFT_WIDTH: 190, roadmapMonthWidth: 82,
    roadmapRange: () => ({ count: 12 }), roadmapGroups: () => groups, selectedId: null,
    roadmapRowRegions: new Map(), verticalRoadmapNavigators: new Map(),
    PortfolioRoadmapDensity: {
      createNavigator(target, adapter) { const controller = h.api.createNavigator(target, adapter); controllers.push(controller); return controller; },
      setHeight(height) { updates.push(height); },
    },
  };
  vm.createContext(context);
  vm.runInContext(["roadmapDimensions", "syncVerticalRoadmapOverview"].map(extractApplication).join("\n"), context);
  context.syncVerticalRoadmapOverview(scroll);
  const rail = host.querySelector(".roadmap-vertical-navigator"), bottom = host.querySelector(".roadmap-vertical-bottom");
  assert.equal(rail.hidden, count === 0, "an empty lifecycle roadmap has no vertical navigator");
  const edgeY = 100 + 500 * parseFloat(host.querySelector(".roadmap-vertical-window").style.height) / 100;
  rail.fire("pointerdown", { target: bottom, clientY: edgeY });
  rail.fire("pointermove", { target: bottom, clientY: edgeY });
  if (count) assert.deepEqual(updates, [38], `${count} products retain their density at an unmoved handle, including minimum-height filler`);
  else assert.deepEqual(updates, [], "an empty roadmap cannot invent rows through a resize");
  controllers[0].destroy();
}

// Exercise the real application adapter against changing row geometry. The
// fixture only draws rows; the application chooses the anchor and restores it.
const applicationFunction = appSource.match(/^function changeRoadmapDensity\([^]*?^\}/m)?.[0];
assert.ok(applicationFunction, "application density handler is available");
function appHarness(selectedId = "p10") {
  const groups = [{ products: Array.from({ length: 20 }, (_, index) => ({ id: `p${index}` })) }, { products: Array.from({ length: 20 }, (_, index) => ({ id: `q${index}` })) }];
  const canvas = {}, splitCanvas = {}, roadmapScroll = { id: "roadmap", clientHeight: 360, scrollTop: 200, scrollLeft: 615, querySelector: () => canvas };
  const splitRoadmapScroll = { id: "split", clientHeight: 360, scrollTop: 300, scrollLeft: 420, querySelector: () => splitCanvas };
  const context = { ROADMAP_HEADER_HEIGHT: 80, ROADMAP_GROUP_HEADER_HEIGHT: 24, ROADMAP_ROW_HEIGHT: 38,
    roadmapScroll, splitRoadmapScroll, selectedId, roadmapRowRegions: new Map(), workspaceOpening: false, activeView: "roadmap",
    hasDedicatedHashoutView: () => false, roadmapGroups: () => groups, syncVerticalRoadmapOverview() {},
  };
  context.renderRoadmaps = () => {
    let y = 80; const rows = [];
    for (const group of groups) { y += 24; for (const product of group.products) { rows.push({ productId: product.id, y, height: context.ROADMAP_ROW_HEIGHT }); y += context.ROADMAP_ROW_HEIGHT; } }
    context.roadmapRowRegions.set(canvas, rows); context.roadmapRowRegions.set(splitCanvas, rows);
  };
  context.renderRoadmaps(); vm.createContext(context); vm.runInContext(applicationFunction, context);
  const row = (id, scroll = roadmapScroll) => context.roadmapRowRegions.get(scroll.querySelector("canvas")).find(item => item.productId === id);
  return { context, row, scrolls: [roadmapScroll, splitRoadmapScroll] };
}
{
  const h = appHarness();
  const screenPositions = h.scrolls.map(scroll => h.row("p10", scroll).y - scroll.scrollTop);
  h.context.changeRoadmapDensity(24);
  h.scrolls.forEach((scroll, index) => near(h.row("p10", scroll).y - scroll.scrollTop, screenPositions[index], "a selected visible product keeps its screen position"));
  assert.deepEqual(h.scrolls.map(scroll => scroll.scrollLeft), [615, 420], "vertical density leaves horizontal date positions alone");
}
{
  const h = appHarness("missing"), topRow = h.context.roadmapRowRegions.get(h.scrolls[0].querySelector("canvas")).find(row => row.y + row.height > 280);
  const screenY = topRow.y - h.scrolls[0].scrollTop;
  h.context.changeRoadmapDensity(24);
  near(h.row(topRow.productId).y - h.scrolls[0].scrollTop, screenY, "without a visible selection the top product stays anchored");
}
for (const edge of ["top", "bottom"]) {
  const h = appHarness(), scroll = h.scrolls[0], anchor = edge === "top" ? 480 : 200;
  // These are the products intersecting the fixed edge in the original 38px view.
  const id = edge === "top" ? "p12" : "p4", fraction = edge === "top" ? 0 : 24 / 38;
  const screenY = edge === "top" ? 360 : 80;
  for (const height of [28, 24, 32]) {
    h.context.changeRoadmapDensity(height, { scrollId: scroll.id, edge, anchor, initialHeight: 38 });
    const row = h.row(id);
    near(row.y + fraction * row.height - scroll.scrollTop, screenY, `${edge} edge remains fixed through consecutive resize updates`);
    assert.equal(scroll.scrollLeft, 615);
  }
}

console.log("Roadmap density checks passed: local preferences, controls, keyboard/pointer navigation, fixed-edge resize, cleanup, selected/top anchors and independent horizontal position.");
