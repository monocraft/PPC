import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = (await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const plain = value => JSON.parse(JSON.stringify(value));
function appFunction(name) {
  const definition = source.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"))?.[0];
  assert.ok(definition, `Exercise the actual ${name} application function.`);
  return definition;
}
function appConstant(name) {
  const match = source.match(new RegExp(`^const ${name} = ([\\d.]+);`, "m"));
  assert.ok(match, `Read the application's actual ${name} bound.`);
  return Number(match[1]);
}
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: expected ${expected}, received ${actual}`);
const definitions = ["syncVerticalProductOverview", "syncBoardNavigator", "horizontalScrollMax", "clampViewZoom", "snappedViewZoom", "setProductZoom"].map(appFunction).join("\n");

function harness() {
  const cards = [
    Object.freeze({ productId: "one", x: 120, y: 100, width: 300, height: 420 }),
    Object.freeze({ productId: "two", x: 960, y: 900, width: 280, height: 460 }),
  ];
  const products = Object.freeze(cards.map(card => Object.freeze({ id: card.productId, order: 8, manualPosition: Object.freeze({ x: card.x, y: card.y }), unknownEvidence: "retain" })));
  const savedProducts = JSON.stringify(products), frames = [], creations = [], updates = [], preferences = [];
  let baseWidth = 5000, baseHeight = 3200, left = 600, top = 400, context;
  const host = {}, productView = { clientHeight: 600, classList: { contains: () => false } };
  const scroll = {
    parentElement: host, clientWidth: 900, clientHeight: 600,
    get scrollWidth() { return Math.max(this.clientWidth, baseWidth * context.zoom); },
    get scrollHeight() { return Math.max(this.clientHeight, baseHeight * context.zoom); },
    get scrollLeft() { return left; }, set scrollLeft(value) { left = Math.max(0, Math.min(value, this.scrollWidth - this.clientWidth)); },
    get scrollTop() { return top; }, set scrollTop(value) { top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
  };
  const navClasses = new Set();
  const sandbox = {
    zoom: .8, activeView: "products", activeCategoryId: "large", selectedId: "two", renderedCards: cards,
    board: { products }, productView, canvasScroll: scroll, verticalProductNavigator: null,
    PRODUCT_MIN_ZOOM: appConstant("PRODUCT_MIN_ZOOM"), PRODUCT_MAX_ZOOM: appConstant("PRODUCT_MAX_ZOOM"),
    roadmapMonthWidth: 82, ROADMAP_DEFAULT_MONTH_WIDTH: 82,
    categoryZoomPreferences: { set(id, value) { preferences.push([id, plain(value)]); } },
    boardNavigator: { classList: { toggle(name, active) { if (active) navClasses.add(name); else navClasses.delete(name); } } },
    navRange: {}, navLeft: {}, navRight: {}, syncHorizontalOverview() {}, syncLaneRail() {},
    requestAnimationFrame(callback) { frames.push(callback); },
    renderBoard() { scroll.scrollTop = top; scroll.scrollLeft = left; },
    PortfolioRoadmapDensity: {
      createNavigator(target, adapter) {
        const controller = { update() { updates.push(plain(adapter.getState())); } };
        creations.push({ target, adapter, controller });
        return controller;
      },
    },
  };
  context = vm.createContext(sandbox); vm.runInContext(definitions, context);
  function flush() { let budget = 20; while (frames.length && budget-- > 0) frames.shift()(); assert.ok(budget > 0, "View refreshes remain bounded."); }
  return { context, scroll, host, productView, creations, updates, preferences, navClasses,
    sync() { context.syncBoardNavigator(); }, flush,
    adapter() { assert.equal(creations.length, 1, "The Products overview owns one retained controller."); return creations[0].adapter; },
    setGeometry(width, height) { baseWidth = width; baseHeight = height; scroll.scrollLeft = left; scroll.scrollTop = top; },
    unchanged() { assert.equal(JSON.stringify(products), savedProducts, "Navigation and zoom preserve product fields, placement and unknown evidence."); },
  };
}

{
  const h = harness(); h.sync();
  const value = plain(h.adapter().getState());
  assert.equal(h.creations[0].target, h.host, "The vertical rail belongs to the product board shell outside the native scroller.");
  assert.equal(value.total, 2560); assert.equal(value.visible, 600); assert.equal(value.offset, 400);
  assert.equal(value.scale, .8); assert.equal(value.minScale, .2); assert.equal(value.maxScale, 2);
  assert.equal(value.crossTotal, 4000, "Card columns use the actual horizontal scroll extent.");
  assert.deepEqual(value.items, [
    { x: 96, y: 80, width: 240, height: 336, selected: false },
    { x: 768, y: 720, width: 224, height: 368, selected: true },
  ], "The miniature uses actual visible card rectangles on both axes at the current zoom.");
  const previousZoom = h.context.zoom, previousLeft = h.scroll.scrollLeft;
  h.adapter().onPan(1200); assert.equal(h.scroll.scrollTop, 1200);
  assert.equal(h.scroll.scrollLeft, previousLeft); assert.equal(h.context.zoom, previousZoom);
  h.sync(); h.sync(); assert.equal(h.creations.length, 1, "Scroll synchronization updates the existing rail.");
  h.unchanged();
}

// Products zoom uses the existing ten-point stops. The opposite edge remains
// anchored after that snapping, and horizontal focus follows ordinary zoom.
for (const [edge, requested, expected] of [["top", 1.26, 1.3], ["bottom", 1.26, 1.3], ["top", .73, .7], ["bottom", .73, .7]]) {
  const h = harness(); h.sync(); const adapter = h.adapter();
  const anchor = (h.scroll.scrollTop + (edge === "top" ? h.scroll.clientHeight : 0)) / h.context.zoom;
  const horizontalCenter = (h.scroll.scrollLeft + h.scroll.clientWidth / 2) / h.context.zoom;
  adapter.onResize({ scale: requested, edge, anchor }); h.flush();
  assert.equal(h.context.zoom, expected, `${edge} handle uses the normal snapped Products zoom.`);
  near((h.scroll.scrollTop + (edge === "top" ? h.scroll.clientHeight : 0)) / h.context.zoom, anchor, `${edge} handle retains its opposite content edge`);
  near((h.scroll.scrollLeft + h.scroll.clientWidth / 2) / h.context.zoom, horizontalCenter, `${edge} resize retains horizontal focus`);
  const after = adapter.getState(); near(after.items[1].y, 900 * expected, "Silhouettes refresh using the applied zoom");
  assert.equal(h.preferences.at(-1)[0], "large"); assert.equal(h.preferences.at(-1)[1].productZoom, expected);
  h.unchanged();
}

for (const [edge, requested, expected, anchor] of [["top", 5, 2, 100000], ["bottom", .001, .2, 0]]) {
  const h = harness(); h.sync(); h.adapter().onResize({ scale: requested, edge, anchor }); h.flush();
  assert.equal(h.context.zoom, expected, "Both handle directions respect the established 20–200% zoom bounds.");
  assert.ok(h.scroll.scrollTop >= 0 && h.scroll.scrollTop <= h.scroll.scrollHeight - h.scroll.clientHeight, "An edge anchor is clamped after zoom changes the scroll extent.");
  h.unchanged();
}

{
  const h = harness(); h.sync(); const adapter = h.adapter();
  h.context.activeCategoryId = "small"; h.context.renderedCards = [Object.freeze({ productId: "other", x: 80, y: 240, width: 200, height: 300 })];
  h.context.selectedId = "two"; h.setGeometry(700, 2200); h.scroll.scrollTop = 0; h.sync();
  assert.ok(h.navClasses.has("hidden"), "The horizontal control can be hidden without hiding a taller board's vertical rail.");
  const next = plain(adapter.getState()); assert.equal(next.items.length, 1); assert.equal(next.items[0].selected, false);
  assert.equal(next.items[0].y, 192); assert.equal(next.total, 1760); assert.equal(next.offset, 0);
  h.context.renderedCards = []; h.context.selectedId = null; h.setGeometry(700, 400); h.sync();
  assert.equal(adapter.getState().items.length, 0, "Filtering to no cards removes every previous category silhouette.");
  assert.equal(h.creations.length, 1, "Category and filter changes refresh one overview instead of adding rails.");
  h.context.renderedCards = [Object.freeze({ productId: "restored", x: 60, y: 30, width: 240, height: 400 })]; h.sync();
  assert.equal(adapter.getState().items.length, 1, "Clearing a filter restores the current card overview.");
  h.unchanged();
}

console.log("Product vertical navigator checks passed: real app adapter, card silhouettes on both axes, pan, snapped anchored zoom, bounds, horizontal focus, category/filter refresh, one controller and unchanged product data.");
