import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [dashboard, analytics, styleParts, html] = await Promise.all([
  readFile(new URL('../../public/blueprint/dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../../public/blueprint/analytics.js', import.meta.url), 'utf8'),
  Promise.all(['embed.css', 'explorer-pane.css', 'dashboard.css'].map(file => readFile(new URL('../../public/blueprint/' + file, import.meta.url), 'utf8'))),
  readFile(new URL('../../public/blueprint/index.html', import.meta.url), 'utf8'),
]);
const stylesheet = styleParts.join('\n');
const periods = [2025, 2026, 2027], ref = (cell, value) => ({ sheet: 'Synthetic sibling source', cell, value });
function group(id, name, revenues, profits) {
  return { id, name, category: 'Headsets', revenueByYear: Object.fromEntries(periods.map((year, index) => [year, revenues[index]])), gmByYear: Object.fromEntries(periods.map((year, index) => [year, profits[index]])), unitsByYear: { 2025: 10, 2026: 20, 2027: null }, sourceByYear: Object.fromEntries(periods.map((year, index) => [year, { revenue: [ref(`${id}-${year}-R`, revenues[index])], grossProfit: [ref(`${id}-${year}-G`, profits[index])] }])) };
}
const sku = (id, projectId, skuId, period, revenue, grossProfit, groupName = 'Alpha') => ({ id, projectId, skuId, name: skuId, groupName, category: 'Headsets', period, quarter: 1, revenue, grossProfit, units: revenue, sourceByMetric: { revenue: [ref(id + '-R', revenue)], grossProfit: [ref(id + '-G', grossProfit)] } });
const fixture = {
  schemaVersion: 2, sourceGrainVersion: 2, source: { name: 'Synthetic product comparison.xlsm' }, sheets: [], periods, categories: ['Headsets'],
  products: [group('g1', 'Alpha', [100, 200, null], [20, 40, null]), group('g2', 'Beta', [20, 40, 80], [10, 20, 40])],
  projects: [{ id: 'PROJECT A', name: 'Alpha', category: 'Headsets', codeName: 'A', launchYear: 2025 }, { id: 'PROJECT B', name: 'Alpha', category: 'Headsets', codeName: 'B', launchYear: 2025 }, { id: 'PROJECT C', name: 'Beta', category: 'Headsets', codeName: 'C', launchYear: 2025 }],
  npiSkuRecords: [sku('a1', 'PROJECT A', 'SKU/001', 2025, 10, 2), sku('a2', 'PROJECT A', 'SKU/002', 2025, 10, 2), sku('a3', 'PROJECT A', 'SKU/001', 2026, 0, 0), sku('a4', 'PROJECT A', 'SKU/002', 2026, 20, 4), sku('b1', 'PROJECT B', 'SKU/003', 2026, 100, 50), sku('c1', 'PROJECT C', 'SKU/001', 2026, 900, 90, 'Beta')],
  investments: [{ productId: 'PROJECT A', category: 'Headsets', period: 2026, amount: 50, source: [ref('PA-cost', 50)] }, { productId: 'PROJECT B', category: 'Headsets', period: 2026, amount: 100, source: [ref('PB-cost', 100)] }, { productId: 'PROJECT C', category: 'Headsets', period: 2026, amount: 200, source: [ref('PC-cost', 200)] }],
  published: [], npi: [], tam: [], npiValues: [], prelaunchCases: [], metrics: {},
};
function region(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Actual implementation exists: ${start}`);
  return source.slice(first, last);
}
function engine(data = structuredClone(fixture)) {
  const window = { HX_DATA: data }; vm.runInNewContext(analytics, { window });
  return { api: window.HX_ANALYTICS, data };
}
const near = (actual, expected, message) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-10, message);
const { api: model, data } = engine(), before = JSON.stringify(data);
assert.equal(typeof model.compareDrillSeries, 'function');
const comparison = model.compareDrillSeries('revenue', { category: 'Headsets', compareIds: ['g1', 'g2'], period: 2026, mode: 'trend' });
assert.equal(comparison.active, true); assert.equal(comparison.indexed, true); assert.equal(comparison.basePeriod, 2025);
assert.equal(comparison.traces.length, 2);
for (const trace of comparison.traces) {
  assert.equal(trace.scope.groupId, trace.id, 'Each product trace carries its own source scope');
  assert.equal(trace.series.find(point => point.period === 2026).value, 200, 'Equal growth overlaps despite product size');
}
assert.equal(comparison.selectionSummary.revenue, 240, 'The headline combines selected products, separately from each plotted line');
near(comparison.selectionSummary.grossMargin, .25, 'Selected margin uses combined profit dollars / revenue rather than a mean of percentages');
assert.equal(comparison.selectionSeries.find(point => point.period === 2027).value, null, 'An incomplete selected total remains unavailable rather than becoming a partial sum');
const skuComparison = model.compareDrillSeries('revenue', { category: 'Headsets', groupId: 'g1', projectId: 'PROJECT A', compareIds: ['SKU/001', 'SKU/002'], period: 2026, mode: 'values' });
assert.equal(skuComparison.active, true); assert.equal(skuComparison.selectionSummary.revenue, 20);
assert.equal(skuComparison.selectionSummary.budget, null, 'Combining SKUs never allocates or duplicates their parent project budget');
near(skuComparison.selectionSummary.grossMargin, .2, 'A genuine zero contributes to the selected ratio');
assert.ok(skuComparison.traces.every(trace => trace.scope.projectId === 'PROJECT A'), 'A repeated SKU in another project never enters this comparison');
assert.ok(skuComparison.traces.every(trace => trace.series.every(point => point.value !== 900)));
const invalid = model.compareDrillSeries('revenue', { category: 'Headsets', groupId: 'g1', compareIds: ['g2'], period: 2026 });
assert.equal(invalid.active, false); assert.equal(invalid.invalid, true, 'Comparison IDs must belong to the current parent’s siblings');
assert.equal(JSON.stringify(data), before, 'Comparisons leave source records unchanged');

// UI helper and route assertions follow the implementation, using synthetic
// sources and no live browser, backend, or published financial data.
const helpers = region(dashboard, '  function escape(value)', '  function comparisonChart(');
const charts = region(dashboard, '  function comparisonChart(', '  function barsChart(');
const evidence = region(dashboard, '  function evidence(', '  function openDialog(');
const detail = region(dashboard, '  function metricDetail(', '  function productCases(');
const explorer = region(dashboard, '  function syncExplorerControls(', '  async function importFile(');
const line = expression => { const result = dashboard.match(expression)?.[0]; assert.ok(result, expression.toString()); return result; };
const declarations = [line(/^  const colors = .+$/m), line(/^  const scopeId = .+$/m), line(/^  function parseCompare\(.+$/m), line(/^  function scopeFragment\(.+$/m), line(/^  let timelineControl,.+$/m)].join('\n');
const state = { view: 'performance', period: 2026, category: ['Headsets'], groupId: null, projectId: null, skuId: null, compareIds: [], drillQuery: '', comparisonScale: 'trend', metric: 'revenue', revenueGrowth: 0, marginChange: 0, budgetChange: 0 };
const nodes = new Map(), dialogs = [], controls = {}, window = { HX_DATA: structuredClone(fixture), innerWidth: 1000 };
const node = id => { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', title: '', hidden: false, focus() {}, scrollIntoView() {} }); return nodes.get(id); };
window.HX_TIMELINE = { mount(_node, config) { controls.timeline = config; return { update(config) { controls.timeline = config; }, stop() {} }; } };
window.HX_CATEGORY_STRIP = { mount(_node, config) { controls.categories = config; return { update(config) { controls.categories = config; } }; } };
const context = { window, testState: state, URLSearchParams, location: { hash: '' }, console, $: node, openDialog: (title, content) => dialogs.push({ title, content }) };
vm.createContext(context); vm.runInContext(analytics, context);
vm.runInContext(`const state = testState; ${declarations}
  const hasSource = () => Boolean(window.HX_DATA?.products?.length); function icon() { return ''; } function toast() {}
  function draw() { refreshDrillScope(true); } function selectPeriod(period) { state.period = period; }
  ${helpers}\n${charts}\n${evidence}\n${detail}\n${explorer}
  globalThis.check = {parseCompare,productComparison,comparisonColors,toggleCompare,clearComparison,refreshDrillScope,selectDrillScope,renderDrillExplorer,summary,allSeries,sourceRefs,metricDetail,lineChart,syncExplorerControls,scopeFragment};`, context);
const ui = context.check; ui.refreshDrillScope(true);
ui.toggleCompare('g1');
assert.equal(ui.summary().revenue, 200, 'The first selected card scopes the existing graph without entering its detail level');
ui.toggleCompare('g2');
assert.deepEqual(Array.from(state.compareIds), ['g1', 'g2']);
assert.equal(state.groupId, null, 'A comparison toggle does not navigate into a product');
assert.equal(state.period, 2026); assert.equal(state.comparisonScale, 'trend');
assert.equal(ui.summary().revenue, 240);
ui.metricDetail('revenue', 2026);
assert.match(dialogs.at(-1).content, /Source value · precise<\/label><strong>\$240<\/strong>/, 'Combined selected values have matching default source details');
assert.match(dialogs.at(-1).content, /g1-2026-R/); assert.match(dialogs.at(-1).content, /g2-2026-R/);
ui.metricDetail('revenue', 2025);
assert.match(dialogs.at(-1).content, /Source value · precise<\/label><strong>\$120<\/strong>/, 'A year-row source click uses that year rather than the current selection year');
assert.match(dialogs.at(-1).content, /g1-2025-R/); assert.match(dialogs.at(-1).content, /g2-2025-R/);
assert.equal(state.period, 2026, 'Inspecting another year does not move the selected timeline year');
ui.metricDetail('revenue', 2026, null, { groupId: 'g1', projectId: null, skuId: null });
assert.match(dialogs.at(-1).content, /Source value · precise<\/label><strong>\$200<\/strong>/);
assert.match(dialogs.at(-1).content, /g1-2026-R/); assert.doesNotMatch(dialogs.at(-1).content, /g2-2026-R/, 'A trace point bypasses aggregate evidence and opens only that product');
const chart = ui.lineChart('revenue');
const points = [...chart.matchAll(/<circle\b([^>]*)>/g)].map(match => Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])));
assert.deepEqual([...new Set(points.filter(point => point['data-chart-metric'] === 'revenue').map(point => point['data-chart-group']))].sort(), ['g1', 'g2'], 'Each large-chart trace supplies its own exact group scope');
assert.ok(points.every(point => point['data-chart-project'] === '' && point['data-chart-sku'] === ''), 'Group trace points explicitly clear deeper source scope');
ui.syncExplorerControls();
assert.equal(controls.timeline.comparisonSeries.length, 2, 'The timeline receives the same selected product traces as the large chart');
assert.ok(controls.timeline.comparisonSeries.some(trace => trace.label === 'Alpha'));
ui.renderDrillExplorer();
const cards = nodes.get('#drill-results').innerHTML;
assert.match(cards, /data-drill-compare="0"[^>]*aria-pressed="true"/);
assert.match(cards, /data-drill-child="0"/, 'A separate Explore action remains available alongside comparison toggles');
assert.equal((cards.match(/class="drill-card\b/g) || []).length, 2);
state.drillQuery = 'Beta'; ui.renderDrillExplorer();
assert.match(nodes.get('#drill-results').innerHTML, /data-drill-compare="1"/, 'Search keeps the original child index for the correct comparison action');
assert.match(nodes.get('#drill-results').innerHTML, /data-drill-child="1"/, 'Search keeps the same correct child for Explore');
state.drillQuery = '';
state.period = 2027; ui.refreshDrillScope(true);
assert.equal(ui.summary().revenue, null);
ui.metricDetail('revenue', 2027);
assert.match(dialogs.at(-1).content, /Source value · precise<\/label><strong>—<\/strong>/, 'Incomplete selected totals stay unavailable in the source dialog too');
state.comparisonScale = 'values';
ui.selectDrillScope({ groupId: 'g1', category: 'Headsets' });
assert.deepEqual(Array.from(state.compareIds), []); assert.equal(state.period, 2027); assert.equal(state.comparisonScale, 'values', 'Explore changes parent and clears comparison while retaining time and scale');
state.period = 2026;
ui.selectDrillScope({ groupId: 'g1', projectId: 'PROJECT A', category: 'Headsets' });
ui.toggleCompare('SKU/001'); ui.toggleCompare('SKU/002');
assert.equal(ui.summary().revenue, 20); assert.equal(ui.summary().budget, null);
ui.metricDetail('budget', 2026);
assert.match(dialogs.at(-1).content, /Source value · precise<\/label><strong>—<\/strong>/);
assert.doesNotMatch(dialogs.at(-1).content, /PA-cost/, 'Unallocated SKU aggregate investment cannot inherit parent project cost evidence');
ui.syncExplorerControls(); controls.categories.onChange(['all']);
assert.deepEqual(Array.from(state.compareIds), []); assert.equal(state.projectId, null); assert.equal(state.skuId, null);
assert.equal(state.period, 2026); assert.equal(state.comparisonScale, 'values');

const parsed = ui.parseCompare(JSON.stringify(['SKU/001', 'A&"B', 'SKU/001']));
assert.deepEqual(Array.from(parsed), ['SKU/001', 'A&"B']);
for (const invalid of ['not-json', '{}', '[null]', JSON.stringify(['bad\u0000id']), JSON.stringify(Array.from({ length: 51 }, (_, index) => String(index)))]) assert.equal(ui.parseCompare(invalid).length, 0);
state.compareIds = ['SKU/001', 'A&"B'];
const fragment = new URLSearchParams(ui.scopeFragment('performance').split('?')[1]);
assert.deepEqual(JSON.parse(fragment.get('compare')), ['SKU/001', 'A&"B'], 'Comparison identifiers round-trip as JSON in the fragment');
const routeSource = region(dashboard, '  function notifyParent(', '  function requestImport(');
const routeLocation = new URL('https://example.test/PPC/blueprint/index.html?embedded=1&compare=old-query');
const posts = [], routeContext = { state, URLSearchParams, location: routeLocation, embedded: true, window: { HX_DATA: fixture, parent: { postMessage(message, origin) { posts.push({ message, origin }); } } }, history: { replaceState(_state, _title, value) { routeLocation.href = new URL(value, routeLocation).href; } } };
vm.createContext(routeContext); vm.runInContext(`${line(/^  function scopeFragment\(.+$/m)}\n${routeSource}\nnotifyParent();`, routeContext);
assert.equal(routeLocation.searchParams.has('compare'), false, 'Comparison IDs are stripped from the server-visible query');
assert.deepEqual(JSON.parse(new URLSearchParams(routeLocation.hash.split('?')[1]).get('compare')), ['SKU/001', 'A&"B']);
assert.equal(posts.at(-1).origin, routeLocation.origin);
assert.ok(!JSON.stringify(posts).includes('npiSkuRecords'), 'The host bridge carries only comparison selections, never financial rows');

assert.ok(html.includes('id="scope-breadcrumb"'), 'The shared explorer has its own breadcrumb location');
assert.ok(html.indexOf('id="scope-breadcrumb"') < html.indexOf('id="planning-timeline"'), 'Breadcrumbs appear above the timeline');
assert.ok(html.indexOf('id="planning-timeline"') < html.indexOf('id="scope-explorer"'), 'Product choices sit below the timeline in the shared pane');
assert.match(stylesheet, /\.drill-(?:card|results)[^{]*\{[^}]*?(?:width|grid-auto-columns|grid-template-columns)[^;}]*240px/s, 'Product cards use the requested fixed 240px size instead of stretching to fill a row');
assert.match(stylesheet, /\.drill-results[^{]*\{[^}]*max-height\s*:/s, 'The product chooser has a bounded height');
assert.match(stylesheet, /\.drill-results[^{]*\{[^}]*overflow[^:]*:\s*(?:auto|scroll)/s, 'Overflow remains accessible without growing the shared pane indefinitely');

console.log('Blueprint product comparison UI checks passed: selected sibling overlays in both charts, per-trace and aggregate provenance, complete weighted totals, missing/zero SKU facts without cost allocation, parent reset, fragment privacy, accessible compare/Explore actions, and fixed bounded cards below the timeline.');
