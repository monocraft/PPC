import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../public/js/date-precision.js';
import '../../public/js/ffs-roadmap.js';
import '../../public/js/hashout-layout.js';

const model = globalThis.PortfolioHashoutLayout;
const horizon = { start: 2026 * 12, end: 2028 * 12 - 1, count: 24 };
const product = (id, ffsDate) => ({ id, name: `Launch ${id}`, ffsDate });
const fixture = { categories: [
  { id: 'busy', name: 'Busy', board: { products: Array.from({ length: 48 }, (_, index) => product(`same-${index}`, '2026-06-15')) } },
  { id: 'quiet', name: 'Quiet', board: { products: [product('early', '2026-01-01'), product('late', '2027-12-31')] } },
] };
const entries = model.project(fixture), before = JSON.stringify(fixture);
const options = { adaptiveRows: true, rowHeight: 38, width: 1200, height: 600, leftWidth: 166, headerHeight: 78 };
const comfortable = model.layout(entries, horizon, options);
assert.equal(comfortable.counts.groups, 0, 'Coincident launches remain individually selectable.');
assert.equal(comfortable.glyphs.length, 50);
assert.equal(comfortable.lanes[0].trackCount, 48);
assert.equal(comfortable.lanes[1].trackCount, 1, 'Nonoverlapping launches reuse their category track.');
assert.ok(comfortable.contentHeight > options.height, 'Crowding creates vertical overflow instead of hidden products.');
assert.equal(new Set(comfortable.lanes[0].glyphs.map(glyph => glyph.centerY)).size, 48);
assert.equal(new Set(comfortable.lanes[0].glyphs.map(glyph => glyph.centerX)).size, 1, 'Coincident products retain exactly the same launch date.');

const compact = model.layout(entries, horizon, { ...options, rowHeight: 24 });
assert.ok(compact.contentHeight < comfortable.contentHeight);
for (const glyph of compact.glyphs) {
  const source = comfortable.glyphs.find(item => item.memberKeys[0] === glyph.memberKeys[0]);
  assert.equal(glyph.track, source.track); assert.equal(glyph.centerX, source.centerX);
}
const full = model.layout(entries, horizon, { ...options, viewportStart: horizon.start, viewportEnd: horizon.start + 12 });
const pan = model.layout(entries, horizon, { ...options, viewportStart: horizon.start + 2, viewportEnd: horizon.start + 14 });
assert.deepEqual(pan.lanes.map(lane => lane.trackCount), full.lanes.map(lane => lane.trackCount));
assert.deepEqual(pan.lanes.map(lane => lane.height), full.lanes.map(lane => lane.height));
for (const glyph of pan.glyphs) assert.equal(glyph.track, full.glyphs.find(item => item.memberKeys[0] === glyph.memberKeys[0])?.track);

const small = model.layout(model.project({ categories: [{ id: 'small', name: 'Small', board: {
  products: [product('a', '2026-06-01'), product('b', '2026-06-01'), product('c', '2026-12-01')],
} }] }), horizon, options);
assert.equal(small.lanes[0].trackCount, 2);
const candidates = small.glyphs.map((glyph, index) => ({ key: glyph.memberKeys[0], categoryId: 'small', entry: glyph.entries[0], glyph,
  anchorX: glyph.centerX, anchorY: glyph.centerY, width: index === 1 ? 2000 : 90, height: 14, priority: index === 0 ? 3 : 0 }));
const labels = model.labels(small, candidates, { mode: 'default', gap: 4 });
assert.equal(labels.labels.length, 3, 'An oversized name is truncated within its track instead of hiding the category.');
assert.ok(labels.labels.some(label => label.truncated), 'Names use bounded space when a full name cannot fit.');
assert.ok(labels.labels.some(label => label.key === candidates[0].key), 'Selected label takes priority.');
const quarterPeriod = globalThis.PortfolioDatePrecision.parseQuarter('Q3 2026');
const quarterEntries = model.project({ categories: [{ id: 'quarter', name: 'Quarter', board: { products: Array.from({ length: 6 }, (_, index) => ({
  ...product(`Aster ${index + 9}`, quarterPeriod.start), plc: { fields: { ffsDate: { value: quarterPeriod.start, period: quarterPeriod } } },
})) } }] });
const quarterMap = model.layout(quarterEntries, horizon, { ...options, rowHeight: 24 });
const quarterLabels = model.labels(quarterMap, quarterMap.glyphs.map(glyph => ({ key: glyph.memberKeys[0], categoryId: 'quarter',
  compact: true, entry: glyph.entries[0], glyph, anchorX: glyph.centerX, anchorY: glyph.centerY, width: 60, height: 14, markerRadius: glyph.radius,
})), { mode: 'default', gap: 6, padding: 4, markerGap: 5 });
assert.equal(quarterLabels.labels.length, 6, 'Six coincident quarter windows retain their compact product names.');
assert.ok(quarterLabels.labels.every(label => label.placement === 'inside'), 'A compact name uses its own window when the full name fits.');
assert.equal(new Set(quarterLabels.labels.map(label => label.x)).size, 1, 'Neighboring launches share a single left-aligned column.');
for (const label of quarterLabels.labels) assert.equal(label.y + label.height / 2, label.glyph.centerY, 'Names never jump above or below their own track.');

const candidatesFor = map => map.glyphs.map(glyph => ({ key: glyph.memberKeys[0], categoryId: glyph.categoryId,
  compact: true, entry: glyph.entries[0], glyph, anchorX: glyph.centerX, anchorY: glyph.centerY, width: 80, height: 14, markerRadius: glyph.radius }));
const partialQuarter = model.layout(quarterEntries, horizon, { ...options, rowHeight: 24,
  viewportStart: horizon.start + 8.9, viewportEnd: horizon.start + 20.9 });
assert.ok(partialQuarter.glyphs[0].centerX < options.leftWidth, 'The full quarter center is offscreen while its ending remains visible.');
const partialLabels = model.labels(partialQuarter, candidatesFor(partialQuarter), { mode: 'default', previousCohorts: quarterLabels.cohorts });
assert.equal(partialLabels.labels.length, 6, 'A partially visible window keeps each product name in view.');
assert.equal(new Set(partialLabels.labels.map(label => label.x)).size, 1);
assert.ok(partialLabels.labels.every(label => label.x >= options.leftWidth + 4 && label.x + label.width <= options.width - 4));
const pastQuarter = model.layout(quarterEntries, horizon, { ...options, viewportStart: horizon.start + 9, viewportEnd: horizon.start + 21 });
assert.equal(model.labels(pastQuarter, candidatesFor(pastQuarter)).labels.length, 0, 'A fully offscreen product does not leave a detached name.');

const closeEntries = model.project({ categories: [{ id: 'close', name: 'Close', board: {
  products: [product('first', '2026-06-01'), product('second', '2026-06-21')],
} }] });
const datesOnly = model.layout(closeEntries, horizon, options);
assert.equal(datesOnly.lanes[0].trackCount, 1);
const named = model.layout(closeEntries, horizon, { ...options, labelWidths: new Map(closeEntries.map(entry => [entry.key, 90])) });
assert.equal(named.lanes[0].trackCount, 2, 'Nearby names reserve readable occupancy instead of pushing text onto another baseline.');
for (const glyph of named.glyphs) assert.equal(glyph.centerX, datesOnly.glyphs.find(source => source.memberKeys[0] === glyph.memberKeys[0]).centerX);

const pointEntries = model.project({ categories: [{ id: 'points', name: 'Points', board: {
  products: Array.from({ length: 4 }, (_, index) => product(`point-${index}`, '2026-06-15')),
} }] });
let previousCohorts = {}, lastSide = null;
for (const panStart of [-6.35, -6.34, -6.36, -6.33, -6.35]) {
  const map = model.layout(pointEntries, horizon, { ...options, rowHeight: 24, viewportStart: horizon.start + panStart, viewportEnd: horizon.start + panStart + 12 });
  const placed = model.labels(map, candidatesFor(map), { mode: 'default', previousCohorts });
  assert.equal(placed.labels.length, 4); assert.equal(new Set(placed.labels.map(label => label.x)).size, 1);
  assert.ok(placed.labels.every(label => label.placement === 'left' || label.placement === 'right'));
  const side = placed.labels[0].placement; if (lastSide) assert.equal(side, lastSide, 'Small pan reversals cannot flip the column side.');
  previousCohorts = placed.cohorts; lastSide = side;
}
const edgeRange = { start: 2027 * 12, end: 2028 * 12 - 1, count: 12 };
const edgeEntries = model.project({ categories: [{ id: 'edge', name: 'Edge', board: {
  products: [product('short', '2027-03-15'), product('long', '2027-12-15')],
} }] });
const edgeMap = model.layout(edgeEntries, edgeRange, { adaptiveRows: true, rowHeight: 38, width: 400, leftWidth: 100, height: 300, headerHeight: 40,
  labelWidths: new Map([[edgeEntries[0].key, 42], [edgeEntries[1].key, 246]]) });
assert.equal(edgeMap.lanes[0].trackCount, 1);
const edgeLabels = model.labels(edgeMap, edgeMap.glyphs.map((glyph, index) => ({ key: glyph.memberKeys[0], categoryId: 'edge',
  glyph, entry: glyph.entries[0], anchorX: glyph.centerX, anchorY: glyph.centerY, width: index ? 270 : 42, height: 28, priority: index ? 3 : 0,
})), { mode: 'default' });
assert.equal(edgeLabels.labels.length, 2, 'A selected edge name cannot hide an earlier product name on the same track.');
const earlyLabel = edgeLabels.labels.find(label => label.key === edgeEntries[0].key);
const lateLabel = edgeLabels.labels.find(label => label.key === edgeEntries[1].key);
assert.ok(lateLabel.x >= earlyLabel.x + earlyLabel.width + 6, 'The selected left-facing name truncates after its neighboring name.');
assert.ok(lateLabel.x > edgeMap.glyphs[0].centerX + edgeMap.glyphs[0].radius, 'The edge label cannot cover another product marker.');
assert.ok(lateLabel.truncated);
for (const label of edgeLabels.labels) assert.equal(label.y + label.height / 2, label.glyph.centerY);
const viewSource = await readFile(new URL('../../public/js/hashout-view.js', import.meta.url), 'utf8');
const labelDefinitions = ['fitLabelText', 'updateLabels'].map(name => {
  const definition = viewSource.match(new RegExp(`^    function ${name}\\([^]*?^    \\}`, 'm'))?.[0];
  assert.ok(definition, `Exercise the actual Hashout ${name} view adapter.`); return definition;
}).join('\n');
const densityEntries = model.project({ categories: [{ id: 'density', name: 'Density', board: {
  products: Array.from({ length: 8 }, (_, index) => product(`Headset ${index + 1}`, '2027-06-15')),
} }] });
for (const rowHeight of [24, 26, 28, 30, 32, 34, 38]) for (const mode of ['default', 'on']) {
  const densityMap = model.layout(densityEntries, edgeRange, { ...options, height: 600, rowHeight });
  let measured = [];
  const context = vm.createContext({ labelMode: mode, selectedKey: null, search: { value: '' }, densityHeight: () => rowHeight,
    width: options.width, height: 600, leftWidth: options.leftWidth, viewport: { start: edgeRange.start, end: edgeRange.end + 1 },
    font: () => 'Jost', layout: densityMap, entries: densityEntries, labelSignature: '', labelLayout: { labels: [], cohorts: {} },
    painter: { measureText: text => ({ width: text.length * 6 }) }, clamp: (value, low, high) => Math.max(low, Math.min(high, value)),
    root: { PortfolioHashoutLayout: { labels(map, candidates, settings) { measured = candidates; return model.labels(map, candidates, settings); } } } });
  const placed = vm.runInContext(`${labelDefinitions}\nupdateLabels(painter); labelLayout;`, context);
  assert.equal(measured.length, 8, `All same-day names reach the view label policy at ${rowHeight}px (${mode}).`);
  assert.ok(measured.every(candidate => candidate.compact === (rowHeight < 34)), 'Name-only labels continue until the full capsule plus spacing fits.');
  assert.equal(placed.labels.length, 8, `Every same-day product name remains visible at ${rowHeight}px (${mode}).`);
  for (const label of placed.labels) assert.equal(label.y + label.height / 2, label.glyph.centerY);
}
const exportDefinition = viewSource.match(/^    async function exportPng\([^]*?^    \}/m)?.[0];
assert.ok(exportDefinition, 'Exercise the actual Hashout PNG adapter.');
for (const laneY of [118, -1200]) {
  const painted = [], clips = [];
  const painter = { drawImage() {}, scale() {}, fillRect() {}, save() {}, restore() {}, beginPath() {}, clip() {},
    rect(x, y, width, height) { clips.push({ x, y, width, height }); }, measureText: text => ({ width: text.length * 6 }),
    fillText(text, x, y) { painted.push({ text, x, y }); } };
  const bitmap = { getContext: () => painter, toBlob: callback => callback({ type: 'image/png' }) };
  const context = vm.createContext({ draw() {}, canvas: { width: 800, height: 600 }, width: 800, height: 600, leftWidth: 166,
    headerHeight: () => 118, document: { createElement: () => bitmap }, font: () => 'Jost',
    theme: () => ({ surface: '#222', text: '#eee', label: '#aaa' }),
    layout: { lanes: [{ name: 'Busy', y: laneY, height: 2000, count: 48 },
      { name: 'Before', y: -100, height: 50, count: 1 }, { name: 'After', y: 2400, height: 50, count: 1 }] } });
  vm.runInContext(exportDefinition, context); await vm.runInContext('exportPng()', context);
  assert.deepEqual(painted.map(item => item.text), ['Busy', '48'], 'Only visible category names and counts enter the viewport PNG.');
  assert.ok(painted.every(item => item.y === 359), 'A tall or scrolled category stays centered in its visible body.');
  assert.deepEqual(clips, [{ x: 8, y: 118, width: 150, height: 482 }]);
}
const verticalDefinition = viewSource.match(/^    const verticalNavigator =[^]*?^    \}\);/m)?.[0];
assert.ok(verticalDefinition, 'Exercise the actual Hashout vertical adapter.');
const sparse = vm.createContext({ root: { PortfolioRoadmapDensity: { createNavigator(_host, adapter) { return adapter.getState(); } } },
  verticalHost: {}, stage: { scrollTop: 0 }, layout: { contentHeight: 600, lanes: [{ trackCount: 1 }], glyphs: [] },
  height: 600, headerHeight: () => 118, densityHeight: () => 38, selectedKey: null });
const sparseState = vm.runInContext(`${verticalDefinition}\nverticalNavigator;`, sparse);
assert.equal(sparseState.overhead + sparseState.rowCount * sparseState.height, sparseState.total,
  'Navigator overhead includes viewport filler so a sparse stationary resize keeps its density.');
assert.equal(JSON.stringify(fixture), before, 'Adaptive geometry never modifies source products.');
console.log('Hashout adaptive density checks passed (48 coincident launches, stable neighbor columns, partial-window names, baseline/edge stability, readable name occupancy).');
