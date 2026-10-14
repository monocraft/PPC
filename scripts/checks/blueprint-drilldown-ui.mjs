import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [dashboard, analytics, timeline] = await Promise.all([
  readFile(new URL('../../public/blueprint/dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../../public/blueprint/analytics.js', import.meta.url), 'utf8'),
  readFile(new URL('../../public/blueprint/timeline.js', import.meta.url), 'utf8'),
]);
const sourceRef = (cell, value) => ({ sheet: 'Synthetic drill source', cell, value });
const group = (id, name, category, value) => ({ id, name, category, revenueByYear: { 2025: value, 2026: value, 2027: value }, gmByYear: { 2025: value / 5, 2026: value / 5, 2027: value / 5 }, unitsByYear: { 2025: 10, 2026: 10, 2027: 10 }, sourceByYear: { 2026: { revenue: [sourceRef(`${id}-annual`, value)] } } });
const row = (id, skuId, period, revenue) => ({ id, projectId: 'PROJECT A', skuId, name: `SKU ${skuId}`, category: 'Headsets', groupName: 'Group Alpha', period, quarter: 1, revenue, grossProfit: revenue === null ? null : revenue / 5, units: revenue, basis: 'Unclassified tracker source', sourceByMetric: { revenue: [sourceRef(id, revenue)] } });
const fixture = {
  schemaVersion: 2, sourceGrainVersion: 2, source: { name: 'Synthetic drill fixture.xlsm' }, sheets: [],
  periods: [2025, 2026, 2027], categories: ['Headsets', 'Mice'],
  products: [group('group-a', 'Group Alpha', 'Headsets', 10000), group('group-b', 'Group Beta', 'Mice', 50000)],
  projects: [{ id: 'PROJECT A', name: 'Group Alpha', category: 'Headsets', codeName: 'A', launchYear: 2026 }],
  npiSkuRecords: [row('sku-a-zero', 'SKU/001', 2026, 0), row('sku-a-signed', 'SKU/001', 2027, -5), row('sku-b-positive', 'SKU/002', 2026, 10), row('sku-b-missing', 'SKU/002', 2027, null)],
  investments: [{ productId: 'PROJECT A', category: 'Headsets', period: 2026, amount: 50, source: [sourceRef('project-spend', 50)] }],
  prelaunchCases: [], published: [], npi: [], npiValues: [], tam: [], metrics: {},
};
function region(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Actual implementation region exists: ${start}`);
  return source.slice(first, last);
}
const helperSource = region(dashboard, '  function escape(value)', '  function comparisonChart(');
const chartSource = region(dashboard, '  function comparisonChart(', '  function barsChart(');
const evidenceSource = region(dashboard, '  function evidence(', '  function openDialog(');
const detailSource = region(dashboard, '  function metricDetail(', '  function productCases(');
const filtersSource = region(dashboard, '  function loadFilters(', '  function selectPeriod(');
const explorerSource = region(dashboard, '  function syncExplorerControls(', '  async function importFile(');
const scopeIdSource = dashboard.match(/^  const scopeId = .+$/m)?.[0];
const scopeFragmentSource = dashboard.match(/^  function scopeFragment\(.+$/m)?.[0];
const colorsSource = dashboard.match(/^  const colors = .+$/m)?.[0];
assert.ok(scopeIdSource && colorsSource);
function create(data = structuredClone(fixture), search = '?year=2026&category=Headsets') {
  const state = { view: 'overview', period: 2026, category: ['Headsets'], groupId: null, projectId: null, skuId: null, drillQuery: '', comparisonScale: 'trend', metric: 'revenue', revenueGrowth: 0, marginChange: 0, budgetChange: 0 };
  const nodes = new Map(), dialogs = [], rendered = { count: 0 }, controls = {};
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', hidden: false, title: '', scrollIntoView() {} }); return nodes.get(selector); };
  const window = { HX_DATA: data, innerWidth: 1000, HX_TIMELINE: { mount(_node, config) { controls.timeline = config; return { update(config) { controls.timeline = config; }, stop() {} }; } }, HX_CATEGORY_STRIP: { mount(_node, config) { controls.categories = config; return { update(config) { controls.categories = config; } }; } } };
  const context = { window, testState: state, URLSearchParams, location: { hash: '' }, console, nodes, controls, rendered,
    initialPreferences: new URLSearchParams(search), $: node, openDialog: (title, content) => dialogs.push({ title, content }) };
  vm.createContext(context); vm.runInContext(analytics, context, { filename: 'blueprint/analytics.js' });
  vm.runInContext(`const state = testState; ${colorsSource} ${scopeIdSource} ${scopeFragmentSource}
    let activeDrill = null, timelineControl = null, categoryControl = null;
    const hasSource = () => Boolean(window.HX_DATA?.products?.length && window.HX_DATA?.periods?.length);
    function icon() { return ''; }
    function draw() { refreshDrillScope(true); rendered.count++; }
    function selectPeriod(period) { state.period = period; }
    ${helperSource}\n${chartSource}\n${evidenceSource}\n${detailSource}\n${filtersSource}\n${explorerSource}
    globalThis.check = { scopeId, opts, resetDrill, refreshDrillScope, selectDrillScope, renderDrillExplorer, drillEconomics, scopeAttributes, pointBasis, sourceKind, isProjection, allSeries, summary, lineChart, metricDetail, loadFilters, syncExplorerControls, getDrill: () => activeDrill };`, context, { filename: 'blueprint/drilldown-ui-functions.js' });
  context.check.refreshDrillScope(true);
  return { state, data, nodes, dialogs, controls, rendered, api: context.check, engine: window.HX_ANALYTICS };
}
const { state, data, api, controls, nodes, dialogs, rendered } = create();
const before = JSON.stringify(data);
assert.equal(api.scopeId('SKU/001 & "Blue"'), 'SKU/001 & "Blue"', 'Exact source punctuation survives scope validation');
for (const invalid of [null, 2, {}, 'x'.repeat(241), 'SKU\u0000A', 'SKU\nA']) assert.equal(api.scopeId(invalid), null);
api.selectDrillScope({ category: 'Headsets', groupId: 'group-a' });
assert.equal(state.view, 'performance', 'Drill choices change scope in the existing analytical view');
assert.equal(state.groupId, 'group-a'); assert.equal(state.projectId, null); assert.equal(state.skuId, null);
assert.equal(api.summary().revenue, 10000, 'The group retains its own annual source grain');
api.selectDrillScope({ category: 'Headsets', groupId: 'group-a', projectId: 'PROJECT A' });
assert.equal(api.summary().revenue, 10, 'Project drill uses tracker rows rather than allocating group revenue');
api.selectDrillScope({ category: 'Headsets', groupId: 'group-a', projectId: 'PROJECT A', skuId: 'SKU/001' });
assert.equal(api.summary().revenue, 0, 'A recorded SKU zero is preserved');
assert.equal(api.summary().budget, null, 'Project investment is not allocated to its SKU');
assert.equal(api.getDrill().economics.sourceInvestment, null);
assert.equal(api.getDrill().economics.parentProjectInvestment, 50);
assert.match(api.drillEconomics(), /Unavailable at SKU level · no cost allocation/);
assert.match(api.drillEconomics(), /Project context only · not a SKU cost/);
assert.ok(rendered.count >= 3, 'Drill changes redraw the existing view');
assert.deepEqual(Array.from(api.allSeries('revenue'), point => point.value), [null, 0, -5], 'The graph keeps missing, zero, and signed scoped records distinct');
const chart = api.lineChart('revenue');
assert.match(chart, /data-chart-group="group-a"/);
assert.match(chart, /data-chart-project="PROJECT A"/);
assert.match(chart, /data-chart-sku="SKU\/001"/);
assert.doesNotMatch(chart, /NaN|Infinity/);
api.metricDetail('revenue', 2026, null, { groupId: 'group-a', projectId: 'PROJECT A', skuId: 'SKU/001' });
assert.match(dialogs.at(-1).content, /sku-a-zero/, 'Source detail follows the chart point’s exact SKU scope');
assert.doesNotMatch(dialogs.at(-1).content, /sku-b-positive|group-a-annual/, 'Source detail excludes sibling and group finance');
assert.match(dialogs.at(-1).content, /Source value · precise<\/label><strong>\$0<\/strong>/);
assert.equal(api.isProjection(2026), false, 'An unclassified tracker record does not become a projection because its basis mentions actual/plan');
assert.match(api.sourceKind(2026), /unclassified/i);

api.syncExplorerControls();
assert.equal(controls.timeline.labels[2026].kind, 'unclassified', 'Timeline receives explicit scoped record kind instead of a year-only display label');
controls.categories.onChange(['Mice']);
assert.equal(state.groupId, null); assert.equal(state.projectId, null); assert.equal(state.skuId, null);
assert.deepEqual(Array.from(state.category), ['Mice'], 'Changing category clears every descendant');
assert.equal(api.summary().revenue, 50000);

const malicious = create(undefined, '?year=2026&category=Headsets&groupId=missing&projectId=PROJECT%20A&skuId=not-a-sku');
malicious.state.groupId = 'missing'; malicious.state.projectId = 'PROJECT A'; malicious.state.skuId = 'not-a-sku';
malicious.api.loadFilters(false);
malicious.api.refreshDrillScope(true);
assert.ok(!malicious.api.getDrill()?.coverage?.invalidScope || !['missing', 'not-a-sku'].some(value => Object.values(malicious.state).includes(value)), 'Invalid restored drill paths are cleared rather than retained as a valid selection');
const legacy = structuredClone(fixture); delete legacy.sourceGrainVersion; delete legacy.projects; delete legacy.npiSkuRecords; delete legacy.prelaunchCases;
const saved = create(legacy);
saved.api.renderDrillExplorer();
assert.equal(saved.api.getDrill().coverage.needsReimport, true);
assert.match(saved.nodes.get('#scope-explorer').innerHTML, /predates project and SKU detail/);
assert.match(saved.nodes.get('#scope-explorer').innerHTML, /data-import-workbook/);
assert.equal(saved.api.summary().revenue, 10000, 'Older browser sources keep their annual values while detail requires reimport');
assert.equal(JSON.stringify(data), before, 'Drilling, rendering and source inspection preserve the imported dataset');

const kindSource = region(timeline, '    function kindFor(', '    const position');
const kindContext = { config: { labels: { 2026: 'FY26' } } };
vm.createContext(kindContext); vm.runInContext(`${kindSource}\nglobalThis.kindFor = kindFor;`, kindContext);
const classified = kindContext.kindFor(2026, 0, { kind: 'unclassified', basis: 'Tracker reported · actual/plan unclassified' });
assert.equal(classified.unclassified, true, 'Display year labels cannot mask the source record’s explicit unclassified kind');
assert.equal(classified.plan, false);

const preferencesSource = region(dashboard, '  function locationPreferences(', '  const fragmentView');
const notifySource = region(dashboard, '  function notifyParent(', '  function requestImport(');
const routeLocation = new URL('https://example.test/PPC/blueprint/index.html?embedded=1&groupId=old-query&projectId=old-project&skuId=old-sku#performance?groupId=group-a&projectId=PROJECT+A&skuId=SKU%2F001');
const posts = [], routeState = { ...state, view: 'performance', groupId: 'group-a', projectId: 'PROJECT A', skuId: 'SKU/001', rows: [{ secret: 'PRIVATE ROW' }], key: 'PRIVATE KEY' };
const routeContext = { location: routeLocation, URLSearchParams, state: routeState, embedded: true,
  history: { replaceState(_state, _title, value) { routeLocation.href = new URL(value, routeLocation).href; } },
  window: { HX_DATA: fixture, parent: { postMessage(message, origin) { posts.push({ message, origin }); } } } };
vm.createContext(routeContext);
vm.runInContext(`${scopeFragmentSource}\n${preferencesSource}\n${notifySource}\nglobalThis.route = { locationPreferences, notifyParent };`, routeContext);
const parsed = routeContext.route.locationPreferences();
assert.equal(parsed.get('groupId'), 'group-a'); assert.equal(parsed.get('projectId'), 'PROJECT A'); assert.equal(parsed.get('skuId'), 'SKU/001');
routeContext.route.notifyParent();
for (const key of ['groupId', 'projectId', 'skuId']) assert.equal(routeLocation.searchParams.has(key), false, 'Legacy query identifiers are removed from the request-visible route');
const routedScope = new URLSearchParams(routeLocation.hash.split('?')[1]);
assert.equal(routedScope.get('groupId'), 'group-a'); assert.equal(routedScope.get('projectId'), 'PROJECT A'); assert.equal(routedScope.get('skuId'), 'SKU/001');
assert.equal(posts.at(-1).origin, routeLocation.origin, 'Scoped state is delivered to the same-origin host only');
assert.ok(!JSON.stringify(posts).includes('PRIVATE'), 'The host bridge emits filter identifiers and bounded selections, never source rows or credentials');
assert.equal(routeLocation.searchParams.get('embedded'), '1');
assert.equal(routeLocation.searchParams.get('revenue'), '0', 'Ordinary scenario preferences survive moving private scope identifiers to the fragment');

console.log('Blueprint drilldown UI checks passed: actual scoped chart/helpers, product→project→SKU source grain, exact point provenance, safe identifiers, category reset, legacy reimport, unclassified timeline basis, and unavailable SKU investment.');
