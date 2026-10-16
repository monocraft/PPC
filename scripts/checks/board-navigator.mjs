import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [source, appSource] = await Promise.all([
  readFile(new URL("../../public/js/board-navigator.js", import.meta.url), "utf8"),
  readFile(new URL("../../public/js/app.js", import.meta.url), "utf8"),
]);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: expected ${expected}, received ${actual}`);
const plain = value => JSON.parse(JSON.stringify(value));

// A small DOM with native-like moves, descendant lookup, capture and abortable
// listeners. Gestures execute the shipped module rather than copied formulas.
function node(tag = "div") {
  const listeners = new Map(), captures = new Set();
  const result = {
    tagName: tag.toUpperCase(), children: [], parentElement: null, attributes: {}, dataset: {}, style: {}, className: "", id: "",
    captureReleases: 0, childReplacements: 0, focusCalls: [],
    matches(selector) { return selector.startsWith(".") && this.className.split(/\s+/).includes(selector.slice(1)); },
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; },
    querySelector(selector) { for (const child of this.children) { if (child.matches(selector)) return child; const found = child.querySelector(selector); if (found) return found; } return null; },
    append(...children) {
      for (const child of children) {
        if (child.tagName === "#FRAGMENT") { this.append(...[...child.children]); continue; }
        child.remove(); child.parentElement = this; this.children.push(child);
      }
    },
    before(child) {
      const parent = this.parentElement;
      assert.ok(parent, "before requires a connected node");
      child.remove(); child.parentElement = parent;
      parent.children.splice(parent.children.indexOf(this), 0, child);
    },
    remove() { if (!this.parentElement) return; const parent = this.parentElement; parent.children.splice(parent.children.indexOf(this), 1); this.parentElement = null; },
    replaceChildren(...children) { this.childReplacements++; for (const child of [...this.children]) child.remove(); this.append(...children); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    focus(options) { this.focusCalls.push(options); },
    getBoundingClientRect() { return this.rect || { left: 100, width: 1000 }; },
    setPointerCapture(id) { captures.add(id); },
    hasPointerCapture(id) { return captures.has(id); },
    releasePointerCapture(id) { if (captures.delete(id)) this.captureReleases++; },
    addEventListener(name, callback, options = {}) {
      if (options.signal?.aborted) return;
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
      options.signal?.addEventListener("abort", () => listeners.get(name)?.delete(callback), { once: true });
    },
    fire(name, extras = {}) {
      const event = { target: this, isPrimary: true, button: 0, pointerId: 1, clientX: 100, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...extras };
      for (const callback of [...(listeners.get(name) || [])]) callback(event);
      return event;
    },
    listenerCount() { return [...listeners.values()].reduce((count, callbacks) => count + callbacks.size, 0); },
  };
  result.classList = {
    contains(name) { return result.className.split(/\s+/).includes(name); },
    add(...names) { result.className = [...new Set([...result.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
    remove(...names) { result.className = result.className.split(/\s+/).filter(name => name && !names.includes(name)).join(" "); },
    toggle(name, force) { const active = force ?? !this.contains(name); if (active) this.add(name); else this.remove(name); return active; },
  };
  return result;
}

function harness(overrides = {}) {
  const root = node(), host = node("nav"), range = node("input"), position = node("span");
  host.id = "testNavigator"; range.className = "nav-range"; position.className = "nav-position"; host.append(range, position);
  root.document = { createElement: node, createDocumentFragment: () => node("#fragment") };
  root.AbortController = AbortController;
  vm.createContext(root); vm.runInContext(source, root);
  const items = Object.freeze([
    Object.freeze({ x: 100, y: 50, width: 240, height: 300, selected: true }),
    Object.freeze({ x: 1700, y: 500, width: 240, height: 300, selected: false }),
  ]);
  let current = { total: 2000, visible: 500, left: 500, scale: 1, minScale: .2, maxScale: 2, height: 1000, items, ...overrides };
  const snapshot = JSON.stringify(items), pans = [], resizes = [];
  const controller = root.PortfolioNavigator.create(host, {
    getState: () => current,
    onPan(left) { pans.push(left); current = { ...current, left }; },
    onResize(value) { resizes.push(plain(value)); },
  });
  controller.update();
  const overview = host.querySelector(".nav-overview"), window = host.querySelector(".nav-window"), shapes = host.querySelector(".nav-silhouettes");
  const left = host.querySelector(".nav-window-left"), right = host.querySelector(".nav-window-right");
  const fire = (name, x, target = window, extras = {}) => overview.fire(name, { clientX: x, target, ...extras });
  return { root, host, range, position, controller, overview, window, shapes, left, right, pans, resizes, fire,
    state: () => current, set(value) { current = { ...current, ...value }; controller.update(); },
    verifyData() { assert.equal(JSON.stringify(items), snapshot, "navigation leaves source card geometry and selection unchanged"); },
  };
}

{
  const h = harness();
  assert.ok(Object.isFrozen(h.root.PortfolioNavigator) && Object.isFrozen(h.controller));
  assert.equal(h.range.parentElement, h.overview, "the existing keyboard range is retained");
  assert.equal(h.window.style.left, "25%"); assert.equal(h.window.style.width, "25%");
  assert.equal(h.range.attributes["aria-valuetext"], "Viewing 25% to 50%");
  assert.equal(h.range.attributes["aria-describedby"], "testNavigator-hint");
  assert.equal(h.left.attributes.role, "slider"); assert.equal(h.right.attributes["aria-valuenow"], "50");
  assert.equal(h.left.attributes["aria-orientation"], "horizontal");
  assert.equal(h.shapes.attributes["aria-hidden"], "true");
  assert.equal(h.shapes.children.length, 2);
  assert.equal(h.shapes.children[0].style.left, "5%");
  assert.equal(h.shapes.children[0].style.height, "30%");
  assert.ok(h.shapes.children[0].classList.contains("is-selected"));
  const replacementCount = h.shapes.childReplacements, firstShape = h.shapes.children[0];
  h.set({ left: 1000 });
  assert.equal(h.window.style.left, "50%");
  assert.equal(h.shapes.childReplacements, replacementCount, "scrolling updates the window without rebuilding card silhouettes");
  assert.equal(h.shapes.children[0], firstShape);
  assert.equal(h.pans.length, 0); assert.equal(h.resizes.length, 0, "painting cannot move or zoom the view");
  h.verifyData(); h.controller.destroy();
}

// An outside click centers the current view. An inside drag keeps the exact
// grab point and clamps at either end without starting a product interaction.
{
  const h = harness();
  assert.equal(h.fire("pointerdown", 950, h.overview).defaultPrevented, true);
  near(h.state().left, 1450, "track click centers the visible interval");
  assert.equal(h.range.focusCalls[0].preventScroll, true);
  h.fire("pointerup", 950);
  h.set({ left: 500 }); h.pans.length = 0;
  h.fire("pointerdown", 475); h.fire("pointermove", 650);
  near(h.state().left, 850, "drag retains the original point within the window");
  h.fire("pointermove", 2500); near(h.state().left, 1500, "drag clamps at the right edge");
  h.fire("pointermove", -500); near(h.state().left, 0, "drag clamps at the left edge");
  h.fire("pointerup", -500);
  assert.equal(h.overview.hasPointerCapture(1), false);
  assert.equal(h.overview.classList.contains("is-dragging"), false);
  assert.equal(h.resizes.length, 0, "pan gestures never request a zoom");
  h.verifyData(); h.controller.destroy();
}

// Resize uses a fixed logical opposite edge and the pointerdown geometry, even
// after the consumer applies a zoom and changes the resulting scroll width.
for (const edge of ["left", "right"]) {
  const h = harness(), handle = h[edge], start = edge === "left" ? 350 : 600;
  h.fire("pointerdown", start, handle);
  assert.equal(handle.focusCalls[0].preventScroll, true);
  h.fire("pointermove", edge === "left" ? 475 : 850, handle);
  const first = h.resizes.at(-1);
  near(first.scale, edge === "left" ? 2 : .5, `${edge} resizing requests the scale represented by its interval`);
  assert.equal(first.anchor, edge === "left" ? 1000 : 500);
  assert.equal(first.edge, edge);
  h.set({ total: 4000, scale: 2, left: 1500 });
  h.fire("pointermove", edge === "left" ? 350 : 600, handle);
  near(h.resizes.at(-1).scale, 1, "continuous resize retains its gesture origin after a consumer render");
  assert.equal(h.resizes.at(-1).anchor, first.anchor);
  h.fire("pointerup", 600, handle);
  assert.equal(h.pans.length, 0, "resize never sends a separate pan request");
  h.verifyData(); h.controller.destroy();
}
{
  const h = harness({ left: 0, minScale: .4 });
  h.fire("pointerdown", 350, h.right); h.fire("pointermove", 1100, h.right);
  assert.equal(h.resizes.at(-1).scale, .4, "a wide resize respects the minimum supported scale");
  h.fire("pointermove", 100, h.right);
  assert.equal(h.resizes.at(-1).scale, 2, "crossing the opposite edge clamps at the maximum scale");
  h.fire("pointerup", 100, h.right); h.controller.destroy();
}

{
  const h = harness();
  let event = h.overview.fire("keydown", { target: h.left, key: "ArrowLeft" });
  assert.ok(event.defaultPrevented); near(h.resizes.at(-1).scale, .9, "left arrow expands the left edge by one scale step");
  h.overview.fire("keydown", { target: h.right, key: "ArrowRight", shiftKey: true });
  near(h.resizes.at(-1).scale, .5, "Shift plus arrow makes a larger resize");
  h.overview.fire("keydown", { target: h.left, key: "Home" });
  assert.equal(h.resizes.at(-1).scale, .5); assert.equal(h.resizes.at(-1).anchor, 1000);
  h.overview.fire("keydown", { target: h.right, key: "End" });
  near(h.resizes.at(-1).scale, 1 / 3, "End expands the right edge to the horizon");
  const count = h.resizes.length;
  event = h.overview.fire("keydown", { target: h.range, key: "ArrowRight" });
  assert.equal(event.defaultPrevented, false, "ordinary range keyboard operation remains native");
  h.overview.fire("keydown", { target: h.left, key: "Tab" }); assert.equal(h.resizes.length, count);
  h.controller.destroy();
}

for (const termination of ["pointerup", "pointercancel", "lostpointercapture", "Escape", "blur", "destroy"]) {
  const h = harness();
  h.fire("pointerdown", 475); h.fire("pointermove", 650);
  assert.ok(h.overview.hasPointerCapture(1));
  if (termination === "Escape") h.overview.fire("keydown", { target: h.range, key: "Escape", pointerId: undefined });
  else if (termination === "blur") h.root.fire("blur", { pointerId: undefined });
  else if (termination === "destroy") h.controller.destroy();
  else h.fire(termination, 650);
  const count = h.pans.length;
  h.fire("pointermove", 900);
  assert.equal(h.pans.length, count, `${termination} stops further view changes`);
  assert.equal(h.overview.hasPointerCapture(1), false, `${termination} releases capture`);
  assert.equal(h.overview.classList.contains("is-dragging"), false);
  h.verifyData(); if (termination !== "destroy") h.controller.destroy();
  assert.equal(h.overview.listenerCount(), 0, "destroy removes all overview listeners");
  assert.equal(h.root.listenerCount(), 0, "destroy removes the root blur listener");
  assert.equal(h.range.parentElement, h.host, "destroy restores the original input");
  assert.equal(h.host.querySelector(".nav-overview"), null);
  assert.equal(h.host.classList.contains("has-overview"), false);
  assert.equal(h.range.attributes["aria-describedby"], undefined);
  h.controller.update();
}
{
  const h = harness();
  h.fire("pointerdown", 475, h.window, { button: 2 });
  h.fire("pointerdown", 475, h.window, { isPrimary: false });
  h.overview.rect = { left: 100, width: 0 }; h.fire("pointerdown", 475);
  assert.equal(h.overview.hasPointerCapture(1), false);
  h.overview.rect.width = 1000; h.fire("pointerdown", 475);
  h.fire("pointermove", 900, h.window, { pointerId: 2 }); h.fire("pointerup", 900, h.window, { pointerId: 2 });
  assert.equal(h.pans.length, 0, "a different pointer cannot move or end the captured gesture");
  assert.ok(h.overview.hasPointerCapture(1)); h.controller.destroy();
}
{
  const h = harness({ total: 500, visible: 500, left: 900 });
  assert.equal(h.range.disabled, true); assert.ok(h.overview.classList.contains("is-fit"));
  assert.equal(h.window.style.left, "0%"); assert.equal(h.window.style.width, "100%");
  assert.equal(h.host.classList.contains("hidden"), false, "fitted cards retain an overview that can be resized to zoom");
  h.set({ items: [] }); assert.equal(h.host.classList.contains("hidden"), true, "an empty fitted board hides the overview");
  h.set({ total: NaN, visible: Infinity, left: NaN, scale: NaN });
  assert.equal(h.window.style.left, "0%"); assert.equal(h.window.style.width, "100%", "invalid transient extents cannot produce NaN CSS");
  h.controller.destroy();
}

// Exercise the real application adapter and real snapped scale setters. Their
// post-zoom anchor restoration must use the applied ten-percent stop, and the
// roadmap's sticky labels must not consume miniature timeline width.
const extract = name => {
  const match = appSource.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, `Application function ${name} exists`); return match[0];
};
{
  const controllers = [], products = [{ id: "one", roadmap: { startMonth: "2026-01", endMonth: "2028-01" }, specs: [{ label: "Driver", value: "40 mm" }] }];
  const unchanged = JSON.stringify(products);
  const context = {
    horizontalNavigators: new Map(), PortfolioNavigator: { create(element, options) { const result = { element, options, updates: 0, update() { this.updates++; } }; controllers.push(result); return result; } },
    zoom: 1, roadmapMonthWidth: 82, ROADMAP_DEFAULT_MONTH_WIDTH: 82, ROADMAP_LEFT_WIDTH: 190,
    PRODUCT_MIN_ZOOM: .2, PRODUCT_MAX_ZOOM: 2, ROADMAP_MIN_MONTH_WIDTH: 8.2, ROADMAP_MAX_MONTH_WIDTH: 164,
    activeView: "roadmap", selectedId: "one", board: { products }, renderedCards: [{ productId: "one", x: 100, y: 50, width: 240, height: 300 }],
    roadmapHitRegions: new Map(), requestAnimationFrame: callback => callback(), syncBoardNavigator() {}, renderBoard() {}, renderRoadmaps() {},
  };
  const makeScroll = (roadmap = false) => ({ clientWidth: roadmap ? 1000 : 500, clientHeight: 400, scrollHeight: 1000, scrollTop: 80, scrollLeft: roadmap ? 600 : 500,
    get scrollWidth() { return 2000 * (roadmap ? context.roadmapMonthWidth / 82 : context.zoom) + (roadmap ? 190 : 0); }, querySelector: selector => selector === "canvas[id]" ? "roadmapCanvas" : "viewportPaintLayer" });
  context.canvasScroll = makeScroll(); context.roadmapScroll = makeScroll(true); context.splitRoadmapScroll = makeScroll(true);
  context.roadmapHitRegions.set("roadmapCanvas", [{ productId: "one", x: 1190, y: 200, width: 400, height: 30 }]);
  vm.createContext(context);
  vm.runInContext(["clampViewZoom", "snappedViewZoom", "setProductZoom", "setRoadmapZoom", "syncHorizontalOverview"].map(extract).join("\n"), context);
  const element = {};
  context.syncHorizontalOverview(context.canvasScroll, element);
  context.syncHorizontalOverview(context.canvasScroll, element);
  assert.equal(controllers.length, 1, "repeated renders reuse their navigator controller");
  assert.equal(controllers[0].updates, 2);
  assert.deepEqual(plain(controllers[0].options.getState().items[0]), { x: 100, y: 50, width: 240, height: 300, selected: true });
  controllers[0].options.onPan(750); assert.equal(context.canvasScroll.scrollLeft, 750);
  controllers[0].options.onResize({ scale: 1.34, edge: "left", anchor: 1000 });
  assert.equal(context.zoom, 1.3); near(context.canvasScroll.scrollLeft, 800, "product left resize preserves the logical right edge at the applied stop");
  near(context.canvasScroll.scrollTop, 164, "the existing product setter retains its vertical focal point");
  controllers[0].options.onResize({ scale: .84, edge: "right", anchor: 500 });
  assert.equal(context.zoom, .8); near(context.canvasScroll.scrollLeft, 400, "product right resize preserves the logical left edge");
  context.syncHorizontalOverview(context.roadmapScroll, {}, true);
  const calendar = controllers[1].options, state = calendar.getState();
  assert.equal(state.total, 2000); assert.equal(state.visible, 810); assert.equal(state.left, 600);
  assert.deepEqual(plain(state.items[0]), { x: 1000, y: 200, width: 400, height: 30, selected: true });
  calendar.onResize({ scale: .84, edge: "left", anchor: 1410 });
  near(context.roadmapMonthWidth / 82, .8, "roadmap resize uses the existing clean zoom stop");
  near(context.roadmapScroll.scrollLeft, 318, "roadmap left resize preserves the right date after excluding sticky labels");
  assert.equal(context.roadmapScroll.scrollTop, 80);
  calendar.onResize({ scale: 2, edge: "right", anchor: 99999 });
  near(context.roadmapScroll.scrollLeft, context.roadmapScroll.scrollWidth - context.roadmapScroll.clientWidth, "adapter clamps restored anchors at the native right bound");
  calendar.onResize({ scale: .4, edge: "left", anchor: 0 }); assert.equal(context.roadmapScroll.scrollLeft, 0);
  assert.equal(JSON.stringify(products), unchanged, "adapter pan and zoom cannot change dates, specifications or saved product data");
}

console.log("Board navigator checks passed: scaled card silhouettes, visible interval, track click, bounded pan and opposite-edge zoom, keyboard operation, pointer cancellation, listener cleanup, snapped app anchors, sticky roadmap labels and preserved product data.");
