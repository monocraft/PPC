import assert from "node:assert/strict";
await import("../../public/js/reference-theme.js");
const originalGlobals = { performance: globalThis.performance, request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
let time = 0, frameId = 0, cancellations = 0;
const frames = new Map(); globalThis.performance = { now: () => time }; globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; }; globalThis.cancelAnimationFrame = id => { cancellations++; frames.delete(id); };
function advance(next) { time = next; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); }
await import("../../public/js/sellout-flow.js");
const flow = globalThis.PPCSelloutFlow;
const cells = [
  { store: "North", category: "A", current: 30 }, { store: "North", category: "B", current: 20 },
  { store: "South", category: "A", current: 10 }, { store: "South", category: "B", current: 5 },
  { store: "Missing", category: "A", current: null }, { store: "Zero", category: "B", current: 0 },
  { store: "North", category: "Negative", current: -4 },
];
const meta = { stores: ["South", "North", "Missing", "Zero"].map(key => ({ key, name: key })), categories: ["A", "B", "Negative"].map(key => ({ key, name: key })) };
const before = structuredClone(cells), result = flow.layout({ ...meta, cells, width: 320 });
assert.equal(result.positiveTotal, 65); assert.equal(result.negativeTotal, -4); assert.equal(result.netTotal, 61);
assert.equal(result.missingPairs, 1); assert.equal(result.zeroPairs, 1); assert.equal(result.negativePairs, 1); assert.equal(result.observedPairs, 6);
assert.equal(result.ribbons.length, 4);
assert.equal(result.stores.reduce((sum, node) => sum + node.total, 0), 65);
assert.equal(result.categories.reduce((sum, node) => sum + node.total, 0), 65);
assert.equal(result.ribbons.reduce((sum, link) => sum + link.current, 0), 65, "Retailer/category totals balance the sum of positive net pair ribbons.");
assert.equal(result.stores.find(node => node.key === "Missing").observed, false);
assert.equal(result.stores.find(node => node.key === "Zero").observed, true);
assert.equal(result.stores.find(node => node.key === "Missing").net, null);
assert.equal(result.stores.find(node => node.key === "Zero").net, 0);
assert.deepEqual(result.stores.map(node => node.key), ["Missing", "North", "South", "Zero"]);
for (const ribbon of result.ribbons) {
  assert.ok(Math.abs((ribbon.geometry.sy1 - ribbon.geometry.sy0) / ribbon.current - result.scale) < 1e-12);
  assert.ok(Math.abs((ribbon.geometry.ty1 - ribbon.geometry.ty0) - (ribbon.geometry.sy1 - ribbon.geometry.sy0)) < 1e-10, "Ribbon volume cannot change between retailer and category.");
  assert.match(flow.ribbonPath(ribbon.geometry), /^M.*C.*L.*C.*Z$/);
  assert.equal(/NaN|Infinity/.test(flow.ribbonPath(ribbon.geometry)), false);
}
for (const nodes of [result.stores, result.categories]) for (let index = 1; index < nodes.length; index++) assert.ok(nodes[index].labelY - nodes[index - 1].labelY >= 26, "Minimum node spacing prevents labels overlapping at small viewport widths.");
assert.deepEqual(cells, before);
const scope = flow.layout({ cells, stores: [{ key: "North" }], categories: [{ key: "A" }], width: 300 });
assert.equal(scope.positiveTotal, 30); assert.equal(scope.ribbons.length, 1); assert.equal(scope.stores.length, 1);
const absent = flow.layout({ cells: [{ store: "North", category: "A", current: null }] });
assert.equal(absent.netTotal, null); assert.equal(absent.positiveTotal, 0); assert.equal(absent.ribbons.length, 0);
const netted = flow.layout({ cells: [{ store: "North", category: "A", current: 10 }, { store: "North", category: "A", current: -3 }] });
assert.equal(netted.positiveTotal, 7); assert.equal(netted.negativeTotal, 0, "Raw duplicate adjustments net before applying the positive pair definition.");
const many = Array.from({ length: 10 }, (_, index) => ({ store: "North", category: index === 0 ? "other" : `Category ${index}`, current: 10 - index }));
assert.equal(flow.layout({ cells: many }).categories.length, 8); assert.equal(flow.layout({ cells: many }).ribbons.length, 8);
assert.equal(flow.layout({ cells: many, expanded: true }).categories.length, 10);
assert.equal(new Set(flow.layout({ cells: many }).categories.map(node => node.id)).size, 8, "An actual 'other' category cannot collide with the aggregate Other node.");
assert.equal(flow.layout({ cells: many }).ribbons.reduce((sum, link) => sum + link.current, 0), 55);
assert.equal(flow.layout({ cells: many, expanded: true }).ribbons.reduce((sum, link) => sum + link.current, 0), 55);
const dense = Array.from({ length: 4 }, (_, retailer) => Array.from({ length: 18 }, (_, category) => ({ store: `Retailer ${retailer}`, category: `Category ${String(category).padStart(2, "0")}`, current: (4 - retailer) * (18 - category) * 100 }))).flat();
for (const width of [240, 320, 739, 1200]) for (const expanded of [false, true]) {
  const chart = flow.layout({ cells: dense, width, expanded });
  assert.ok(chart.scale > 0, "Dense category label slots must fit with remaining positive ribbon area.");
  assert.equal(chart.categories.length, expanded ? 18 : 8);
  assert.ok(chart.ribbons.every(link => link.geometry.sy1 > link.geometry.sy0 && link.geometry.ty1 > link.geometry.ty0), "Every positive net pair must have a nondegenerate ribbon on both sides, including the eight-category default.");
  for (const nodes of [chart.stores, chart.categories]) assert.ok(nodes.every(node => Number.isFinite(node.y0) && node.y0 >= 28 - 1e-8 && node.y1 <= chart.height - 52 + 1e-8), "Dense geometry remains inside actual top/footer margins.");
  assert.equal(chart.ribbons.reduce((sum, link) => sum + link.current, 0), dense.reduce((sum, cell) => sum + cell.current, 0));
}

class Node {
  constructor(doc, name, namespaceURI = null) { this.ownerDocument = doc; this.name = name; this.namespaceURI = namespaceURI; this.children = []; this.parentNode = null; this.isConnected = true; this.style = {}; this.attributes = new Map(); this.listeners = new Map(); this.textContent = ""; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); } getAttribute(key) { return this.attributes.get(key) ?? null; }
  append(...children) { for (const child of children) { child.remove(); child.parentNode = this; child.isConnected = true; this.children.push(child); } }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; this.isConnected = false; }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
  emit(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn({ ...event, target: this, preventDefault() { event.prevented = true; } }); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 320 }; } focus() { this.emit("focus"); }
}
const doc = { createElement: name => new Node(doc, name), createElementNS: (ns, name) => new Node(doc, name, ns) };
const container = new Node(doc, "div"); let selected = null, tip = "", hidden = 0;
const options = { ...meta, cells, onSelect: value => { selected = value; }, showTip: html => { tip = html; }, hideTip: () => { hidden++; }, reducedMotion: false };
const control = flow.render(container, options), svg = container.children[0], ribbons = svg.children[1], firstPath = ribbons.children[0];
assert.equal(frames.size, 0, "Initial layout is static and does not loop.");
assert.match(svg.getAttribute("aria-label"), /65 positive aggregated net/); assert.match(svg.getAttribute("aria-label"), /-4 negative pair units excluded/); assert.match(svg.getAttribute("aria-label"), /1 missing pairs/);
assert.equal(firstPath.getAttribute("fill"), globalThis.PortfolioTheme.colors.label); assert.equal(firstPath.getAttribute("stroke"), "none"); assert.equal(firstPath.getAttribute("stroke-width"), "0");
const denseContainer = new Node(doc, "div"); const denseControl = flow.render(denseContainer, { cells: dense });
const denseRendered = denseContainer.children[0].children[1].children;
assert.equal(denseRendered.length, 32); assert.equal(frames.size, 0);
for (const path of denseRendered) {
  const numbers = path.getAttribute("d").match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
  assert.ok(numbers[9] > numbers[7] && numbers[15] > numbers[1], "First-render paths must have visible source and target thickness before any animation frame.");
  assert.equal(Number(path.style.opacity), .2);
}
denseControl.destroy();
const initialPath = firstPath.getAttribute("d");
firstPath.emit("pointerenter", { clientX: 20, clientY: 30 }); assert.match(tip, /30 net pair units/); assert.ok(Number(firstPath.style.opacity) > Number(ribbons.children[1].style.opacity));
firstPath.emit("pointerleave"); assert.equal(Number(firstPath.style.opacity), .2); assert.ok(hidden > 0);
firstPath.emit("focus"); assert.equal(firstPath.getAttribute("stroke-width"), "2");
firstPath.emit("keydown", { key: "Enter" }); assert.deepEqual(selected, { store: "North", category: "A" });
firstPath.emit("blur"); assert.equal(firstPath.getAttribute("stroke-width"), "0");
const altered = cells.map(cell => ({ ...cell, current: cell.current === null ? null : cell.current * (cell.category === "A" ? 2 : 1) }));
flow.render(container, { ...options, cells: altered }); assert.equal(ribbons.children[0], firstPath); assert.equal(firstPath.getAttribute("d"), initialPath, "A redraw keeps the displayed ribbon instead of flashing target geometry.");
advance(250); const mid = firstPath.getAttribute("d"); assert.notEqual(mid, initialPath);
flow.render(container, { ...options, cells }); assert.ok(cancellations > 0); assert.equal(firstPath.getAttribute("d"), mid, "Interrupted transitions resume cached pixel geometry.");
advance(800); assert.equal(frames.size, 0); assert.equal(firstPath.getAttribute("d"), initialPath);
flow.render(container, { ...options, cells: [{ store: "South", category: "B", current: 5 }] }); assert.equal(firstPath.getAttribute("tabindex"), "-1");
advance(1400); assert.equal(ribbons.children.includes(firstPath), false);
flow.render(container, { cells: many, reducedMotion: true, onSelect: options.onSelect, showTip: options.showTip, hideTip: options.hideTip }); assert.equal(frames.size, 0); assert.equal(ribbons.children.length, 8);
const other = ribbons.children.find(path => /Expand Other/.test(path.getAttribute("aria-label"))); selected = null; other.emit("keydown", { key: " " });
assert.equal(selected, null, "Aggregate Other expands instead of filtering an invented category."); assert.equal(ribbons.children.length, 10); assert.equal(container.children.at(-1).textContent, "Show less");
container.children.at(-1).emit("click"); assert.equal(ribbons.children.length, 8);
flow.render(container, { cells: [{ store: "<store>", category: "<script>bad</script>", current: 1 }], reducedMotion: true, showTip: options.showTip }); ribbons.children[0].emit("pointerenter");
assert.equal(tip.includes("<script>"), false); assert.match(tip, /&lt;script&gt;/);
flow.render(container, { cells: [{ store: "Empty", category: "A", current: null }], reducedMotion: true });
assert.equal(ribbons.children.length, 0); assert.match(svg.getAttribute("aria-label"), /Reported net total: missing/);
const labels = svg.children[2]; assert.equal(labels.children[0].children[3].textContent, "—", "A wholly missing retailer is never labeled with invented zero units.");
control.destroy(); assert.equal(container.children.length, 0); assert.equal(frames.size, 0);
globalThis.performance = originalGlobals.performance; globalThis.requestAnimationFrame = originalGlobals.request; globalThis.cancelAnimationFrame = originalGlobals.cancel;
console.log("Retailer-category flow: balanced positive net pair widths, negative/missing/zero distinctions, scope, Other expansion, small-view labels, true Beziers, keyboard filtering, hover isolation, interrupted finite animation, escaping, and cleanup passed.");
