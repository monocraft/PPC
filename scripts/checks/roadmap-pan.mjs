import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../public/js/roadmap-interaction.js';
const source = await readFile(new URL('../../public/js/app.js', import.meta.url), 'utf8');
const names = ['roadmapPoint', 'hitRoadmapBar', 'hitRoadmapRow', 'roadmapSnapIncrement', 'syncRoadmapInteractionMode', 'setRoadmapInteractionMode', 'bindRoadmapCanvas'];
const functions = names.map((name) => { const match = source.match(new RegExp(`^function ${name}\\([^]*?^\\}`, 'm')); assert(match, name); return match[0]; }).join('\n');
const classes = () => ({ values: new Set(), add(value) { this.values.add(value); }, remove(value) { this.values.delete(value); }, toggle(value, active) { if (active) this.add(value); else this.remove(value); } });
const element = () => ({ classList: classes(), attributes: {}, style: {}, setAttribute(name, value) { this.attributes[name] = value; }, textContent: '', offsetWidth: 100, offsetHeight: 28 });
function harness() {
  const events = new Map(), scrollEvents = new Map(), controls = new Map(), frames = new Map(); let nextFrame = 0;
  const scroll = { scrollLeft: 200, scrollTop: 140, clientWidth: 1000, clientHeight: 600, scrollWidth: 2000, classList: classes(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 600 }), addEventListener(name, fn) { scrollEvents.set(name, fn); } };
  const captures = new Set(), canvas = { parentElement: scroll, style: {}, classList: classes(), title: '',
    addEventListener(name, fn) { events.set(name, fn); }, getBoundingClientRect: () => ({ left: -scroll.scrollLeft, top: -scroll.scrollTop }), getContext: () => ({}),
    setPointerCapture(id) { captures.add(id); }, hasPointerCapture(id) { return captures.has(id); }, releasePointerCapture(id) { captures.delete(id); }, focus() {} };
  const product = { id: 'p1', name: 'Headset full name', generalAvailabilityDate: '2027-01-10', endManufacturingDate: '2029-01-10', roadmap: { family: 'Headsets', startMonth: '2027-01', endMonth: '2029-01' } };
  const board = { products: [product], settings: { roadmap: { snap: 'month' } } };
  const hint = element(), editControls = element(), counts = { writes: 0, details: 0, paints: 0 };
  const monthIndex = (text) => { const [year, month] = text.split('-').map(Number); return year * 12 + month - 1; };
  const context = {
    Map, Set, Math, Object, String, document: { createElement: element, body: { append() {} } },
    roadmapCanvas: canvas, splitRoadmapCanvas: { classList: classes() }, roadmapControls: { querySelector: (selector) => selector.includes('interaction-hint') ? hint : editControls },
    $: (selector) => { if (!controls.has(selector)) controls.set(selector, element()); return controls.get(selector); },
    roadmapInteractionMode: 'pan', roadmapDragState: null, roadmapPanState: null, roadmapDraft: null, roadmapHoveredProductId: null, selectedId: null,
    board, ROADMAP_LEFT_WIDTH: 190, ROADMAP_HEADER_HEIGHT: 100, ROADMAP_GROUP_HEADER_HEIGHT: 20, ROADMAP_ROW_HEIGHT: 40, roadmapMonthWidth: 100,
    roadmapHitRegions: new Map([[canvas, [{ productId: 'p1', x: 600, y: 260, width: 500, height: 30, leftHandle: { x: 600, width: 14 }, rightHandle: { x: 1086, width: 14 } }]]]),
    roadmapRowRegions: new Map([[canvas, [{ productId: 'p1', y: 260, height: 40 }]]]),
    RoadmapInteraction: globalThis.RoadmapInteraction,
    PortfolioModel: { mergeProductUpdate: (value, patch) => ({ ...value, roadmap: { ...value.roadmap, ...patch.roadmap } }) },
    requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame: (id) => frames.delete(id),
    roadmapDimensions: () => ({}), drawRoadmapTo: () => { counts.paints++; }, syncRoadmapNavigator() {}, renderRoadmapFor() {}, renderRoadmaps() {},
    renderInspector() {}, renderSplitProduct() {}, renderStatus() {}, updateRoadmapEditControls() {}, announceRoadmapEdit() {},
    stopRoadmapSlotEditing() {}, clearSelection: () => { context.selectedId = null; }, selectedProduct: () => board.products.find((value) => value.id === context.selectedId),
    roadmapGroups: () => [{ family: 'Headsets', products: board.products }], roadmapGroupsForProducts: (products) => [{ family: 'Headsets', products }],
    updateBoard: (mutator) => { counts.writes++; mutator(board); }, monthIndex, monthString: (value) => `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, '0')}`,
    formatProductInfoDate: (value) => value, roadmapLabel: (value) => value,
    moveSelectedRoadmapRow: () => { throw new Error('Unexpected reorder from navigation'); },
    setView: (value) => { if (value === 'split') counts.details++; },
  };
  vm.createContext(context); new vm.Script(functions).runInContext(context);
  context.bindRoadmapCanvas(canvas, scroll, () => ({}));
  const event = (name, x = 500, y = 130, extras = {}) => events.get(name)?.({ isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {}, ...extras });
  return { context, board, canvas, scroll, controls, counts, event };
}
for (const [x, y, label] of [[500, 130, 'product bar'], [65, 130, 'product name'], [850, 230, 'empty timeline'], [500, 20, 'calendar header']]) {
  const h = harness(), before = structuredClone(h.board.products);
  h.event('pointerdown', x, y); h.event('pointermove', x - 150, y - 70); h.event('pointerup', x - 150, y - 70);
  assert.equal(h.scroll.scrollLeft, 350, `${label} pans horizontally in the default mode`);
  assert.equal(h.scroll.scrollTop, 210, `${label} pans vertically in the default mode`);
  assert.equal(h.counts.writes, 0); assert.deepEqual(h.board.products, before, 'moving the view never changes product dates, order, or facts');
}
{
  const h = harness(); h.event('pointerdown'); h.event('pointermove', 502, 131); h.event('pointerup', 502, 131);
  assert.equal(h.context.selectedId, 'p1', 'a simple click selects the product without navigating');
  assert.equal(h.scroll.scrollLeft, 200); assert.equal(h.scroll.scrollTop, 140); assert.equal(h.counts.writes, 0);
  h.event('dblclick'); assert.equal(h.counts.details, 1, 'double-click still opens product details');
  h.event('pointermove', 400, 130); assert.equal(h.canvas.style.cursor, 'grab', 'an edge is still a navigation cursor in Move view');
}
{
  const h = harness(); h.context.setRoadmapInteractionMode('dates');
  assert.equal(h.controls.get('#roadmapModeDates').attributes['aria-pressed'], 'true');
  h.event('pointerdown'); h.event('pointermove', 610, 130); h.event('pointerup', 610, 130);
  assert.equal(h.counts.writes, 1); assert.equal(h.board.products[0].roadmap.startMonth, '2027-02', 'an intentional Adjust dates drag edits the timeline');
  const accepted = structuredClone(h.board.products);
  h.event('pointerdown'); h.event('pointermove', 740, 130); h.event('keydown', 0, 0, { key: 'Escape' }); h.event('pointerup', 740, 130);
  assert.equal(h.context.roadmapInteractionMode, 'pan'); assert.equal(h.context.roadmapDragState, null); assert.equal(h.context.roadmapDraft, null);
  assert.deepEqual(h.board.products, accepted, 'Escape cancels an in-progress edit and returns to navigation');
}
const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
assert(!/id="(?:linkedView|roadmapSelectedStart|roadmapSelectedEnd)"/.test(html), 'ambiguous toolbar dates and reciprocal navigation buttons stay removed');
console.log('Roadmap pan checks passed: safe default two-axis navigation over bars, names, empty space and header; click/details preserved; date editing explicit and Escape cancellation verified.');
