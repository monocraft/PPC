import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const [dashboard, analytics, styleParts, html, workspaceModel, unifiedWorkspace, connectivity] = await Promise.all([
  readFile(new URL('../../public/blueprint/dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../../public/blueprint/analytics.js', import.meta.url), 'utf8'),
  Promise.all(['embed.css', 'explorer-pane.css', 'dashboard.css', 'analysis-workspace.css'].map(file => readFile(new URL('../../public/blueprint/' + file, import.meta.url), 'utf8'))),
  readFile(new URL('../../public/blueprint/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../../public/blueprint/workspace-model.js', import.meta.url), 'utf8'),
  readFile(new URL('../../public/blueprint/unified-workspace.js', import.meta.url), 'utf8'),
  readFile(new URL('../../public/blueprint/product-connectivity.js', import.meta.url), 'utf8'),
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
const declarations = [line(/^  const colors = .+$/m), line(/^  const scopeId = .+$/m), line(/^  function parseCompare\(.+$/m), line(/^  const workspacePreference=.+$/m), line(/^  function scopeFragment\(.+$/m), line(/^  let timelineControl,.+$/m)].join('\n');
const state = { view: 'performance', period: 2026, category: ['Headsets'], groupId: null, projectId: null, skuId: null, compareIds: [], drillQuery: '', comparisonScale: 'trend', metric: 'revenue', metrics: ['revenue', 'units', 'grossProfit', 'budget'], connectivity: ['all'], productSort: 'revenue', sortDirection: 'desc', overlay: null, scenarioEnabled: false, scenarioStart: null, revenueGrowth: 0, marginChange: 0, budgetChange: 0 };
const nodes = new Map(), dialogs = [], controls = {}, window = { HX_DATA: structuredClone(fixture), innerWidth: 1000 };
const element = () => {
  const node = { innerHTML: '', textContent: '', title: '', hidden: false, children: [], attrs: {}, listeners: new Map(), className: '', appendChild(child) { this.children.push(child); }, setAttribute(key, value) { this.attrs[key] = String(value); }, removeAttribute(key) { delete this.attrs[key]; }, addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }, removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }, emit(type, event = {}) { for (const callback of this.listeners.get(type) || []) callback(event); }, focus() {}, scrollIntoView() {} };
  node.classList = {
    contains(name) { return node.className.split(/\s+/).includes(name); },
    add(...names) { node.className = [...new Set([...node.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
    remove(...names) { node.className = node.className.split(/\s+/).filter(name => name && !names.includes(name)).join(' '); },
    toggle(name, force) { const active = force === undefined ? !this.contains(name) : Boolean(force); this[active ? 'add' : 'remove'](name); return active; }
  };
  const styles = new Map();
  node.style = { setProperty(name, value) { styles.set(name, String(value)); }, getPropertyValue(name) { return styles.get(name) || ''; }, removeProperty(name) { const value = styles.get(name) || ''; styles.delete(name); return value; } };
  return node;
};
const node = (id, owner) => { if (owner && id === '.drill-toolbar' && !owner.innerHTML.includes('class="drill-toolbar"')) return null; if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
window.HX_TIMELINE = { mount(_node, config) { controls.timeline = config; return { update(config) { controls.timeline = config; }, stop() {} }; } };
window.HX_CATEGORY_STRIP = { mount(_node, config) { controls.categories = config; return { update(config) { controls.categories = config; } }; } };
const context = { window, document: { createElement: element }, testState: state, URLSearchParams, location: { hash: '' }, console, $: node, openDialog: (title, content) => dialogs.push({ title, content }) };
vm.createContext(context); vm.runInContext(analytics, context);
vm.runInContext(`const state = testState; ${declarations}
  const hasSource = () => Boolean(window.HX_DATA?.products?.length); function icon() { return ''; } function toast() {}
  function draw() { refreshDrillScope(true); } function selectPeriod(period) { state.period = period; }
  ${helpers}\n${charts}\n${evidence}\n${detail}\n${explorer}
  globalThis.check = {parseCompare,productComparison,comparisonColors,toggleCompare,clearComparison,refreshDrillScope,selectDrillScope,renderDrillExplorer,summary,allSeries,sourceRefs,metricDetail,lineChart,syncExplorerControls,scopeFragment,fmt,evidence,scopeLabel,drillEconomics,getDrill:()=>activeDrill,setWorkspace:value=>workspaceControl=value};`, context);
const ui = context.check; ui.refreshDrillScope(true);
assert.equal(ui.fmt(.5, 'currency'), '$0.5'); assert.equal(ui.fmt(-.0001, 'currency'), '−$0.0001', 'Small signed currency values cannot visually round to zero');
assert.equal(ui.fmt(.5, 'units'), '0.5'); assert.equal(ui.fmt(-.0001, 'units'), '-0.0001', 'Small nonzero quantities stay distinct from recorded zero');
assert.match(ui.fmt(1e-8, 'currency'), /\$[1-9][\d.]*E[-−]\d+/, 'Very small nonzero source values retain a visible magnitude');
assert.equal(ui.fmt(-.0001, 'currency', true), '−$0.0001', 'Precise inline evidence cannot display a tiny signed amount as zero');
assert.equal(ui.fmt(.0001, 'units', true), '0.0001'); assert.equal(ui.fmt(-.0001, 'units', true), '-0.0001', 'Precise quantity evidence retains fractional values and their sign');
assert.match(ui.fmt(1e-8, 'currency', true), /\$[1-9][\d.]*E[-−]\d+/, 'Precise evidence retains the magnitude of very small nonzero source values');
assert.equal(ui.fmt(0, 'currency'), '$0'); assert.equal(ui.fmt(0, 'units'), '0'); assert.equal(ui.fmt(null, 'currency'), '—');
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
const cardMetrics = markup => new Map([...markup.matchAll(/<li class="drill-card\b[\s\S]*?<\/li>/g)].map(([card]) => [card.match(/data-drill-compare="(\d+)"/)[1], new Map([...card.matchAll(/<span\b[^>]*data-product-metric="([^"]+)"[^>]*>/g)].map(([tag, metric]) => [metric, tag.match(/data-product-value="([^"]*)"/)?.[1]]))]));
for (const values of cardMetrics(cards).values()) assert.deepEqual([...values.keys()], ['revenue', 'units', 'grossProfit', 'budget'], 'Every fixed card exposes all four measures');
assert.match(cards, /data-drill-compare="0"[^>]*aria-pressed="true"/);
for (const [card] of cards.matchAll(/<li class="drill-card\b[\s\S]*?<\/li>/g)) assert.equal((card.match(/<button\b/g) || []).length, 1, 'Each product card has one clear comparison action');
assert.equal((cards.match(/class="drill-card\b/g) || []).length, 2);
assert.doesNotMatch(cards, /drill-compare-check|<svg\b/, 'Product selection uses clear text and state without decorative selection icons');
assert.doesNotMatch(cards, /class="drill-choice-identity"/, 'Unique product names do not repeat category or source IDs beneath their heading');
assert.doesNotMatch(cards, /data-drill-child|drill-explore-action|>Details<\/button>/, 'Product cards do not repeat a separate Details action');
state.drillQuery = 'Beta'; ui.renderDrillExplorer();
assert.match(nodes.get('#drill-results').innerHTML, /data-drill-compare="1"/, 'Search keeps the original child index for the correct comparison action');
assert.doesNotMatch(nodes.get('#drill-results').innerHTML, /data-drill-child|drill-explore-action/, 'Filtering products retains the same single card action');
state.drillQuery = '';

// Exercise the actual single-canvas adapter and source callbacks, not only the
// retained legacy chart helpers used above for provenance regressions.
const documentEvents = new Map();
Object.assign(context.document, {
  querySelector: node,
  querySelectorAll: () => [],
  addEventListener(type, callback) { if (!documentEvents.has(type)) documentEvents.set(type, new Set()); documentEvents.get(type).add(callback); },
  removeEventListener(type, callback) { documentEvents.get(type)?.delete(callback); }
});
const storedCases = new Map(), sourceDigests = [];
Object.assign(context, { crypto: { subtle: { digest(...args) { const promise = webcrypto.subtle.digest(...args); sourceDigests.push(promise); return promise; } } }, TextEncoder, localStorage: { getItem(key) { return storedCases.get(key) || null; }, setItem(key, value) { storedCases.set(key, String(value)); } } });
const identityReady = async () => { await Promise.all(sourceDigests); await Promise.resolve(); };
let graphCreates = 0, graphDestroys = 0;
window.HX_ANALYSIS_CANVAS = { create(_node, callbacks) { graphCreates++; controls.mainCallbacks = callbacks; return { update(config) { controls.main = config; }, destroy() { graphDestroys++; } }; } };
vm.runInContext(connectivity, context); vm.runInContext(workspaceModel, context); vm.runInContext(unifiedWorkspace, context);
const { comparisonBaseline, comparisonPercent } = window.HX_WORKSPACE_MODEL;
assert.equal(typeof comparisonBaseline, 'function'); assert.equal(typeof comparisonPercent, 'function');
const baselineCatalog = [{ id: 'B', name: 'Duplicate', revenue: 10, units: 5 }, { id: 'A', name: 'Duplicate', revenue: 10, units: 0 }, { id: 'loss', revenue: -5 }, { id: 'zero', revenue: 0 }, { id: 'missing', revenue: null }], baselineBefore = JSON.stringify(baselineCatalog);
assert.equal(comparisonBaseline(baselineCatalog, ['B', 'A']), baselineCatalog[1]); assert.equal(comparisonBaseline([...baselineCatalog].reverse(), ['A', 'B']), baselineCatalog[1], 'A revenue tie uses stable exact IDs, independent of selection or card order');
assert.equal(comparisonBaseline(baselineCatalog, ['loss', 'zero']).id, 'zero', 'A recorded zero remains eligible as the highest-revenue selection');
for (const ids of [['A'], ['A', 'A'], ['A', 'absent'], ['missing', 'missing']]) assert.equal(comparisonBaseline(baselineCatalog, ids), null, 'A baseline requires at least two valid unique source selections');
assert.equal(comparisonBaseline([...baselineCatalog, { id: 'A', revenue: 100 }], ['A', 'B']), null, 'Ambiguous source identities cannot choose a comparison baseline');
assert.equal(comparisonPercent(40, 200), -80); assert.equal(comparisonPercent(0, 200), -100); assert.equal(comparisonPercent(10, -5), 300); assert.equal(comparisonPercent(-10, -5), -100, 'Signed comparisons divide by the absolute source baseline');
for (const [value, baseline] of [[1, 0], [null, 10], [1, null], [Number.MAX_VALUE, -Number.MAX_VALUE]]) assert.equal(comparisonPercent(value, baseline), null, 'Zero, missing or non-finite denominators/results never produce fabricated percentages');
near(comparisonPercent(199.9, 200), -.05, 'Small source differences retain their raw precision'); assert.equal(JSON.stringify(baselineCatalog), baselineBefore);
ui.setWorkspace({});
let unified;
const workspaceHooks = {
  state, data: () => window.HX_DATA, engine: () => window.HX_ANALYTICS, drill: ui.getDrill, format: ui.fmt, scopeLabel: ui.scopeLabel,
  renderProducts: ui.renderDrillExplorer, renderCategories: ui.syncExplorerControls,
  selectPeriod(period) { state.period = period; ui.refreshDrillScope(true); unified.update(); },
  selectScope: ui.selectDrillScope, redraw() { ui.refreshDrillScope(true); unified.update(); }, notify() {},
  openDialog: (title, content) => dialogs.push({ title, content }), evidence: ui.evidence,
  sourceContent: () => '<p>Synthetic source quality utility</p>', economics: ui.drillEconomics, toast() {}, dialogState() {}
};
unified = window.HX_UNIFIED_WORKSPACE.create(workspaceHooks);
ui.setWorkspace(unified);
const clickWorkspace = dataset => {
  const target = { dataset, closest() { return this; }, hasAttribute(name) { const key = name.replace(/^data-/, '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()); return Object.prototype.hasOwnProperty.call(this.dataset, key); } };
  for (const callback of documentEvents.get('click') || []) callback({ target });
};
const inputAssumption = (key, value, min, max) => {
  const target = { dataset: { analysisExact: key }, value: String(value), min: String(min), max: String(max), setCustomValidity(message) { assert.equal(message, ''); } };
  for (const callback of documentEvents.get('input') || []) callback({ target });
};
unified.update();
const financialCards = cardMetrics(nodes.get('#drill-results').innerHTML);
assert.equal(financialCards.get('0').get('revenue'), '200'); assert.equal(financialCards.get('0').get('units'), '20'); assert.equal(financialCards.get('0').get('grossProfit'), '40'); assert.equal(financialCards.get('0').get('budget'), '150');
assert.doesNotMatch(node('#drill-results').innerHTML, /drill-metric-difference|data-product-difference|drill-comparison-baseline/, 'Product cards keep source values while percentage comparisons belong to the Inspect readout');
for (const sort of ['units', 'revenue', 'grossProfit', 'grossMargin', 'budget', 'name', 'connectivity']) {
  state.productSort = sort; ui.renderDrillExplorer();
  assert.deepEqual(cardMetrics(nodes.get('#drill-results').innerHTML), financialCards, `Sorting by ${sort} preserves every displayed card measure and source amount`);
  assert.doesNotMatch(nodes.get('#drill-results').innerHTML, /data-product-difference/, `Sorting by ${sort} does not reintroduce percentages on the product cards`);
}
state.productSort = 'revenue';
assert.equal(graphCreates, 1, 'The workspace creates one financial canvas');
assert.equal(controls.mainCallbacks.viewControlsContainer, node('#analysis-chart-controls'), 'The retained financial chart mounts time-view controls beside the below-chart analysis tools');
assert.equal(controls.mainCallbacks.onLayout, undefined, 'Bottom tools do not depend on chart plot offsets or a side-panel height callback');
assert.equal(controls.main.series.length, 8, 'Two selected products overlay all four selected measures on that graph');
assert.deepEqual(Array.from(controls.main.comparison.entities, entity => entity.id), ['g1', 'g2']);
assert.equal(controls.main.comparison.entities.find(entity => entity.id === 'g1').revenuePoints.find(point => point.period === 2026).value, 200, 'Inspect comparisons receive raw source-revenue points instead of normalized chart values');
clickWorkspace({ analysisMetric: 'revenue' }); assert.ok(!controls.main.series.some(trace => trace.metric === 'revenue')); assert.equal(controls.main.comparison.entities.find(entity => entity.id === 'g1').revenuePoints.find(point => point.period === 2026).value, 200, 'The highest-revenue source baseline remains available when Revenue is hidden');
clickWorkspace({ analysisMetric: 'revenue' }); state.metrics = ['revenue', 'units', 'grossProfit', 'budget']; unified.update();
assert.deepEqual([...new Set(controls.main.series.map(trace => trace.metric))].sort(), ['budget', 'grossProfit', 'revenue', 'units']);
assert.ok(controls.main.series.every(trace => trace.points.every(point => point.kind)), 'Every financial trace retains its explicit source status');
assert.equal(unified.model.summary.revenue.value, 240); assert.equal(unified.model.summary.grossProfit.value, 60);
assert.equal(nodes.get('#analysis-connection-note').classList.contains('is-issue'), false, 'Complete selected data does not receive a coverage warning state');
const mainRevenue = controls.main.series.find(trace => trace.entityId === 'g1' && trace.metric === 'revenue');
const mainPoint = mainRevenue.points.find(point => point.period === 2026);
const dialogCountBeforeCanvas = dialogs.length, inlineContent = () => nodes.get('#analysis-overlay-body').innerHTML;
controls.mainCallbacks.onPoint({ series: mainRevenue, point: mainPoint, rawValue: mainPoint.value });
assert.equal(dialogs.length, dialogCountBeforeCanvas, 'Point inspection updates inline values without opening a modal');
assert.match(inlineContent(), /data-inline-point-value[^>]*>\$200/); assert.match(inlineContent(), /g1-2026-R/); assert.doesNotMatch(inlineContent(), /g2-2026-R/, 'The inline canvas source callback resolves only its own entity');
assert.equal(nodes.get('#analysis-overlay').hidden, false); assert.equal(nodes.get('#analysis-graph-shell').classList.contains('has-analysis-dock'), true);
clickWorkspace({ analysisSummary: 'revenue' });
assert.match(inlineContent(), /data-inline-point-value[^>]*>\$240/); assert.match(inlineContent(), /g1-2026-R/); assert.match(inlineContent(), /g2-2026-R/, 'The summary callback opens complete selected evidence inside the chart dock');
clickWorkspace({ analysisMetric: 'units' });
assert.equal(controls.main.series.length, 6); assert.ok(!controls.main.series.some(trace => trace.metric === 'units'));
clickWorkspace({ analysisMetric: 'units' }); assert.equal(controls.main.series.length, 8); assert.equal(graphCreates, 1, 'Measure toggles reuse the existing graph');
clickWorkspace({ analysisTool: 'insights' });
assert.equal(state.overlay, 'insights'); assert.equal(nodes.get('#analysis-overlay').hidden, false); assert.equal(graphCreates, 1);
for (const className of ['analysis-insights-decisions', 'analysis-insight-column', 'analysis-contributors-column', 'analysis-economics-column']) assert.ok(inlineContent().includes(`class="${className}"`), `${className} remains part of the read-only insights tool`);
const sectionBody = (markup, opening) => {
  const start = opening.index + opening[0].length; let depth = 1;
  for (const match of markup.slice(start).matchAll(/<section\b[^>]*>|<\/section>/g)) { depth += match[0].startsWith('</') ? -1 : 1; if (!depth) return markup.slice(start, start + match.index); }
  assert.fail('Every Insights section has a matching closing tag');
};
const insightSections = () => new Map([...inlineContent().matchAll(/<section class="analysis-(insight|contributors|economics)-column">/g)].map(match => [match[1], sectionBody(inlineContent(), match)]));
const contributorEntries = () => [...(insightSections().get('contributors') || '').matchAll(/<button\b([^>]*)><span>([^<]+)<\/span><strong>([^<]+)<\/strong><\/button>/g)].map(([, attributes, name, value]) => ({ id: /data-analysis-explore="([^"]+)"/.exec(attributes)?.[1], title: /title="([^"]+)"/.exec(attributes)?.[1], ink: /--contributor-ink:(#[\da-f]{6})/i.exec(attributes)?.[1], name, value }));
const contributorRows = () => contributorEntries().map(({ ink, ...row }) => row);
const movementItems = () => new Map([...inlineContent().matchAll(/<section class="analysis-movement-item"[^>]*data-analysis-movement="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)].map(([, metric, content]) => [metric, content]));
const movementFigures = metric => { const item = movementItems().get(metric) || ''; return { values: [...item.matchAll(/class="analysis-movement-value">([^<]+)</g)].map(([, value]) => value), change: /class="analysis-movement-change\b[^>]*><span>Change<\/span><strong>([^<]+)</.exec(item)?.[1] }; };
const assertMovementDirection = (metric, direction, announcement) => { const content = movementItems().get(metric) || ''; assert.ok(content.includes(`class="analysis-movement-change is-${direction}"`)); assert.ok(content.includes(`data-change-direction="${direction}"`)); assert.ok(content.includes(`aria-label="${announcement}"`), 'Movement direction is available through words and sign as well as color'); };
const visibleText = markup => markup.replace(/<(span|small)\b[^>]*class="[^"]*hac-sr-only[^"]*"[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, ' ');
assert.deepEqual([...insightSections().keys()], ['contributors', 'insight', 'economics'], 'The Insights reading order is contributors, period movement, then economics');
assert.doesNotMatch(insightSections().get('insight'), /Revenue contributors|analysis-contributor-list|<table\b/, 'Period movement is a flat metric group layout separate from contributor ranking');
assert.deepEqual([...movementItems().keys()], ['revenue', 'units', 'grossProfit', 'budget'], 'Each core measure has one flat movement group');
const movementHeader = /class="analysis-movement-header" aria-hidden="true">([\s\S]*?)<\/div>/.exec(insightSections().get('insight'))?.[1];
assert.deepEqual([...movementHeader.matchAll(/<span>([^<]*)<\/span>/g)].map(([, value]) => value), ['', 'FY25', 'FY26', 'Change'], 'The compact ledger shares one prior/current year and change header across its four measures');
assert.equal((insightSections().get('insight').match(/class="analysis-movement-header"/g) || []).length, 1);
assert.deepEqual(movementFigures('revenue'), { values: ['$120', '$240'], change: '+$120' });
assert.deepEqual(movementFigures('units'), { values: ['20', '40'], change: '+20' });
assert.deepEqual(movementFigures('grossProfit'), { values: ['$30', '$60'], change: '+$30' });
assert.deepEqual(movementFigures('budget'), { values: ['—', '$350'], change: '—' }, 'Unavailable prior investment has a compact missing marker and cannot become a zero change');
assertMovementDirection('revenue', 'positive', 'Increase: +$120'); assertMovementDirection('budget', 'unavailable', 'Unavailable: Unavailable');
for (const [metric, content] of movementItems()) { assert.match(content, /aria-label="[^"]*FY25/); assert.match(content, /aria-label="[^"]*FY26/); assert.doesNotMatch(content, /class="analysis-movement-year"/, 'Compact rows do not repeat the shared visible year headings'); assert.ok(content.includes(`data-analysis-summary="${metric}"`), 'Each current-period value retains its own source-evidence action'); }
assert.match(movementItems().get('budget'), /aria-label="PD investment, FY25, Unavailable"/, 'The visible missing marker retains its explicit accessible meaning');
clickWorkspace({ analysisSummary: 'grossProfit' });
assert.match(inlineContent(), /data-inline-point-value[^>]*>\$60/); assert.match(inlineContent(), /g1-2026-G/); assert.match(inlineContent(), /g2-2026-G/, 'A current-period movement action opens exact combined gross-profit source evidence');
assert.equal(dialogs.length, dialogCountBeforeCanvas); unified.open('insights');
assert.deepEqual(contributorRows(), [{ id: 'g1', title: 'Alpha · g1', name: 'Alpha', value: '$200' }, { id: 'g2', title: 'Beta · g2', name: 'Beta', value: '$40' }], 'Contributor ranking preserves descending source revenue and exact product identities');
assert.ok(Number.parseInt(contributorEntries()[0].ink?.slice(1), 16) > Number.parseInt(contributorEntries()[1].ink?.slice(1), 16), 'Higher source revenue uses a brighter contributor value shade');
assert.match(inlineContent(), /Period movement/); assert.match(inlineContent(), /Revenue contributors/);
assert.match(inlineContent(), /Raw gross margin<\/span><strong>25\.0%/, 'The combined pane retains correctly weighted selected-period economics');
assert.doesNotMatch(inlineContent(), /analysis-overlay-tabs/, 'The tools pane does not duplicate the top tool navigation');
const priorDraft = { question: 'Existing private question', owner: 'Existing owner', notes: 'Existing rationale must not be cleared by removing controls.' };
Object.assign(state, { decisionQuestion: priorDraft.question, decisionOwner: priorDraft.owner, decisionNotes: priorDraft.notes });
const assertReadOnlyInsights = () => {
  assert.equal(state.decisionQuestion, priorDraft.question); assert.equal(state.decisionOwner, priorDraft.owner); assert.equal(state.decisionNotes, priorDraft.notes, 'Removing decision controls leaves previously held user state untouched');
  assert.equal(node('#analysis-overlay-title').textContent, 'Insights');
  assert.doesNotMatch(inlineContent(), /<(?:input|textarea|select)\b|analysis-decision-|data-analysis-export-brief|Decision brief|Existing private question/i, 'Insights contains no fill-in decision form, export action or hidden draft disclosure');
  assert.match(inlineContent(), /Period movement/); assert.match(inlineContent(), /Raw gross margin/); assert.match(inlineContent(), /data-analysis-summary="revenue"/, 'Read-only insights preserves exact source-evidence actions');
  assert.doesNotMatch(visibleText(inlineContent()), /Known subtotal|\d+\s*\/\s*\d+\s+reported|Reporting basis/, 'Normal Insights does not repeat visible coverage or reporting-basis captions');
};
unified.close(); unified.open('decisions'); assert.equal(state.overlay, 'insights', 'Legacy decision links open canonical Insights'); assertReadOnlyInsights();
state.overlay = 'decisions'; unified.update(); assert.equal(state.overlay, 'insights', 'Restored legacy decision preferences normalize to insights'); assertReadOnlyInsights();
unified.close(); clickWorkspace({ analysisTool: 'decisions' }); assert.equal(state.overlay, 'insights', 'Legacy decision button events retain route compatibility'); assertReadOnlyInsights();
clickWorkspace({ analysisTool: 'insights' }); assert.equal(state.overlay, null, 'The canonical tool toggles closed after a legacy alias opened it');
unified.open('insights'); controls.mainCallbacks.onPeriod(2025); assertReadOnlyInsights(); controls.mainCallbacks.onPeriod(2026); assertReadOnlyInsights();
assert.equal(graphCreates, 1, 'Read-only insights retains the same chart instance');
state.compareIds = ['g2']; ui.refreshDrillScope(true); unified.update();
assert.deepEqual(contributorRows(), [{ id: 'g2', title: 'Beta · g2', name: 'Beta', value: '$40' }], 'Contributor ranking is restricted to the selected products instead of reintroducing parent-scope products');
clickWorkspace({ analysisExplore: 'g2' }); unified.update();
assert.equal(state.groupId, 'g2'); assert.equal(state.projectId, null); assert.equal(state.skuId, null); assert.deepEqual(Array.from(state.compareIds), []);
assert.equal(state.period, 2026); assert.equal(state.comparisonScale, 'trend', 'Contributor drill actions preserve the selected year and scale');
assert.equal(unified.model.scope.groupId, 'g2'); assert.equal(unified.model.summary.revenue.value, 40, 'A contributor opens that product’s exact financial scope in the same chart');
const contributorPoint = unified.model.summary.revenue;
assert.ok(contributorPoint.source.some(reference => reference.cell === 'g2-2026-R')); assert.ok(!contributorPoint.source.some(reference => reference.cell === 'g1-2026-R'), 'Contributor drill source evidence excludes the other product');
ui.selectDrillScope({ category: 'Headsets' }); state.compareIds = ['g1', 'g2']; ui.refreshDrillScope(true); unified.update();
assert.equal(unified.model.summary.revenue.value, 240); assert.equal(graphCreates, 1, 'Returning from contributor detail restores the selected comparison without replacing the chart');
assert.equal(typeof controls.mainCallbacks.onEntity, 'function', 'The chart name replaces the removed card Details action');
assert.ok(controls.main.series.every(trace => trace.entityDetailLevel === 'group'), 'Selected group traces advertise their exact available detail level');
assert.equal(controls.mainCallbacks.onEntity({ id: 'Beta', name: 'g2' }), false, 'A display label cannot substitute for an exact source identity');
assert.equal(controls.mainCallbacks.onEntity({ id: 'connection-wired' }), false, 'Aggregate connectivity names cannot impersonate a source child');
assert.equal(controls.mainCallbacks.onEntity({ id: 'g1', name: 'Beta' }), true); unified.update();
assert.equal(state.groupId, 'g1'); assert.equal(unified.model.summary.revenue.value, 200, 'Chart-name detail navigation uses the exact group ID instead of its display name');
state.compareIds = ['PROJECT A', 'PROJECT B']; ui.refreshDrillScope(true); unified.update();
assert.ok(controls.main.series.every(trace => trace.entityDetailLevel === 'project'));
assert.equal(controls.mainCallbacks.onEntity({ id: 'PROJECT A', name: 'Alpha' }), true); unified.update();
assert.equal(state.projectId, 'PROJECT A'); assert.equal(state.groupId, 'g1');
state.compareIds = ['SKU/001']; ui.refreshDrillScope(true); unified.update();
assert.ok(controls.main.series.every(trace => trace.entityDetailLevel === 'sku'));
assert.equal(controls.mainCallbacks.onEntity({ id: 'SKU/001', name: 'Another project uses the same part number' }), true); unified.update();
assert.equal(state.skuId, 'SKU/001'); assert.equal(state.projectId, 'PROJECT A'); assert.equal(state.groupId, 'g1');
assert.equal(state.period, 2026); assert.equal(state.comparisonScale, 'trend'); assert.deepEqual(Array.from(state.compareIds), []);
assert.equal(unified.model.summary.revenue.value, 0); assert.equal(unified.model.summary.budget.value, null, 'Chart-name SKU drill preserves zero revenue and does not allocate parent investment');
assert.ok(unified.model.summary.revenue.source.some(reference => reference.cell === 'a3-R')); assert.ok(!unified.model.summary.revenue.source.some(reference => reference.cell === 'c1-R'), 'Repeated part numbers in another project never enter chart-name drill evidence');
assert.equal(dialogs.length, dialogCountBeforeCanvas); assert.equal(graphCreates, 1, 'All drill levels reuse the main graph without opening a modal');
ui.selectDrillScope({ category: 'Headsets' }); state.compareIds = ['g1', 'g2']; ui.refreshDrillScope(true); unified.update();
const insightSource = window.HX_DATA, variedInsightSource = structuredClone(insightSource);
variedInsightSource.products.push(group('g3', 'Gamma', [10, 40, null], [1, 4, null]), group('g4', 'Delta', [15, -5, null], [3, -1, null]), group('g5', 'Epsilon', [25, 25, null], [5, 5, null]), group('g6', 'Missing', [null, null, null], [null, null, null]));
window.HX_DATA = variedInsightSource; state.compareIds = []; ui.refreshDrillScope(true); unified.update();
const variedContributors = contributorEntries();
assert.deepEqual(variedContributors.map(row => row.id), ['g1', 'g2', 'g3', 'g5', 'g4'], 'Contributor ranking retains signed source revenue and omits missing values without fabricating zero');
assert.deepEqual(variedContributors.map(row => row.value), ['$200', '$40', '$40', '$25', '−$5']);
const inkValues = variedContributors.map(row => Number.parseInt(row.ink?.slice(1), 16));
assert.ok(inkValues[0] > inkValues[1] && inkValues[1] === inkValues[2] && inkValues[2] > inkValues[3] && inkValues[3] > inkValues[4], 'Contributor shades follow actual revenue magnitude, with identical shades for ties and a quiet negative-value tail');
state.compareIds = ['g2', 'g3']; ui.refreshDrillScope(true); unified.update();
assert.equal(new Set(contributorEntries().map(row => row.ink)).size, 1, 'An all-tied selection uses one shade instead of an arbitrary rank gradient');
state.compareIds = ['g4']; ui.refreshDrillScope(true); unified.update();
assert.deepEqual(movementFigures('revenue'), { values: ['$15', '−$5'], change: '−$20' }, 'Flat period movement preserves a negative current value and its signed absolute change');
assertMovementDirection('revenue', 'negative', 'Decrease: −$20');
state.compareIds = ['g5']; ui.refreshDrillScope(true); unified.update();
assert.deepEqual(movementFigures('revenue'), { values: ['$25', '$25'], change: '$0' }, 'A genuine zero movement stays zero rather than becoming missing or gaining a false positive sign');
assertMovementDirection('revenue', 'neutral', 'No change: $0');
state.compareIds = ['g6']; ui.refreshDrillScope(true); unified.update();
assert.deepEqual(movementFigures('revenue'), { values: ['—', '—'], change: '—' }, 'Missing source values use compact missing markers rather than fabricated zero movement');
assert.match(movementItems().get('revenue'), /aria-label="Revenue, FY25, Unavailable"/); assert.match(movementItems().get('revenue'), /aria-label="Revenue, FY26, Unavailable,/);
assertMovementDirection('revenue', 'unavailable', 'Unavailable: Unavailable');
unified.open('evidence');
assert.match(visibleText(inlineContent()), /Unavailable/); assert.doesNotMatch(visibleText(inlineContent()), /Known subtotal|\d+\s*\/\s*\d+\s+reported|Reporting basis/, 'Selected evidence shows values without repeated visible coverage or basis captions');
const missingCoverage = unified.model.summary.revenue.coverage;
assert.ok(missingCoverage && !missingCoverage.complete); assert.ok(inlineContent().includes(`${missingCoverage.availableCount}/${missingCoverage.selectedCount} reported`), 'Evidence retains exact missing-source coverage in its title and accessible metadata');
assert.doesNotMatch(visibleText(node('#analysis-summary').innerHTML), /Known subtotal|\d+\s*\/\s*\d+\s+reported|\b(?:History|Actual|Plan|Unclassified)\b/, 'Normal headline figures retain Unavailable without visible coverage or classification captions');
assert.ok(node('#analysis-summary').innerHTML.includes(`${missingCoverage.availableCount}/${missingCoverage.selectedCount} reported`), 'Headline metadata still records the precise missing-source coverage');
clickWorkspace({ analysisSummary: 'revenue' });
assert.match(inlineContent(), /data-inline-point-value[^>]*>Unavailable/); assert.doesNotMatch(visibleText(inlineContent()), /Reporting basis|\bScope\b|\d+\s*\/\s*\d+\s+reported/, 'Point evidence keeps the entity and value without restoring removed visible field labels');
assert.match(inlineContent(), /analysis-point-metadata hac-sr-only/, 'Point reporting metadata remains accessible when its visible label is removed');
window.HX_DATA = insightSource; state.compareIds = ['g1', 'g2']; ui.refreshDrillScope(true); unified.update(); unified.open('insights');
assert.equal(unified.model.summary.revenue.value, 240, 'Synthetic display regressions do not change the original selected financial baseline');
assert.equal(node('#analysis-graph-shell').style.getPropertyValue('--analysis-plot-top'), '');
assert.equal(node('#analysis-graph-shell').style.getPropertyValue('--analysis-plot-height'), '', 'Bottom tools never write obsolete plot-height constraints');
clickWorkspace({ analysisTool: 'scenarios' });
assert.equal(state.overlay, 'scenarios'); assert.equal(nodes.get('#analysis-overlay').hidden, false);
assert.ok(nodes.get('#analysis-overlay-body').innerHTML.includes('data-analysis-driver="revenueGrowth"'));
assert.equal(controls.main.series.length, 8); assert.ok(!controls.main.series.some(trace => trace.scenario), 'Zero assumptions retain the eight source lines without duplicating unchanged scenarios');
inputAssumption('revenueGrowth', 12.5, -30, 30);
assert.equal(controls.main.series.length, 12, 'A revenue assumption overlays only changed revenue and gross-profit traces on the same graph');
assert.deepEqual([...new Set(controls.main.series.filter(trace => trace.scenario).map(trace => trace.metric))].sort(), ['grossProfit', 'revenue']);
assert.ok(!controls.main.series.some(trace => trace.scenario && trace.metric === 'budget'), 'Unchanged PD investment is not duplicated by a revenue assumption');
assert.equal(controls.main.series.find(trace => !trace.scenario && trace.entityId === 'g1' && trace.metric === 'revenue').points.find(point => point.period === 2026).value, 200, 'Assumption inputs preserve the reported source trace');
assert.ok(controls.main.series.filter(trace => trace.scenario).every(trace => trace.metric !== 'units'), 'Scenario controls leave source units unchanged');
assert.equal(controls.main.comparison.entities.find(entity => entity.id === 'g1').revenuePoints.find(point => point.period === 2026).value, 200, 'Scenario sensitivity does not replace the source comparison baseline with modeled revenue');
await identityReady();
node('#analysis-case-name').value = 'Exact two-product sensitivity';
inputAssumption('marginChange', .5, -10, 10); inputAssumption('budgetChange', -10, -30, 30);
clickWorkspace({ analysisTool: 'evidence' }); unified.open('insights'); assertReadOnlyInsights();
unified.open('scenarios');
clickWorkspace({ analysisSave: '' });
const firstSaved = JSON.parse(storedCases.get('ppc-blueprint-local-cases-v1'))[0];
assert.deepEqual(firstSaved.scope.compareIds, ['g1', 'g2'], 'Saved cases preserve exact selected sibling identities');
assert.deepEqual(firstSaved.scope.connectivity, ['all']); assert.deepEqual(firstSaved.scope.category, ['Headsets']);
assert.deepEqual(firstSaved.metrics, Array.from(state.metrics)); assert.equal(firstSaved.assumptions.revenueGrowth, 12.5);
assert.match(firstSaved.fingerprint, /^[a-f\d]{64}$/, 'Saved scenarios identify their numerical source snapshot');
const savedRevenue = firstSaved.baseline.series.find(trace => trace.entityId === 'g1' && trace.metric === 'revenue');
assert.equal(savedRevenue.points.find(point => point.period === 2026).value, 200);
assert.ok(savedRevenue.points.find(point => point.period === 2026).source.some(ref => ref.cell === 'g1-2026-R'));
assert.equal(firstSaved.outcomes.find(trace => trace.entityId === 'g1' && trace.metric === 'revenue').points.find(point => point.period === 2026).value, 225);
const frozenBaseline = JSON.stringify(firstSaved.baseline), sourceSnapshot = window.HX_DATA;
state.compareIds = ['g2']; ui.refreshDrillScope(true); unified.update();
assert.equal(controls.main.comparison, null, 'A single selected product clears Inspect comparison metadata');
clickWorkspace({ analysisCase: '0' });
assert.match(inlineContent(), /2 selected products/); assert.match(inlineContent(), /Alpha/); assert.match(inlineContent(), /\$225/);
assert.match(inlineContent(), /Current source snapshot/, 'Changing only selection does not alter source identity or rebase a saved comparison');
assert.ok(inlineContent().includes(firstSaved.fingerprint), 'The compact saved-case view still exposes its exact source identity');
assert.match(inlineContent(), /data-analysis-detail-back/); assert.equal(dialogs.length, dialogCountBeforeCanvas, 'Saved cases also stay inside the inline chart tools');
window.HX_DATA = { ...sourceSnapshot, prelaunchCases: [{ id: 'revised-plan', projectId: 'PROJECT A', name: 'Alpha', launchYear: 2027, launchYearRevenue: 350, revenue12M: 400, source: [ref('revised-plan', 350)] }] };
ui.refreshDrillScope(true); unified.update(); await identityReady();
node('#analysis-case-name').value = 'Revised source plan'; clickWorkspace({ analysisSave: '' });
const secondSaved = JSON.parse(storedCases.get('ppc-blueprint-local-cases-v1'))[1];
assert.notEqual(secondSaved.fingerprint, firstSaved.fingerprint, 'A source-plan revision changes the fingerprint even when reported revenue is unchanged');
assert.equal(JSON.stringify(JSON.parse(storedCases.get('ppc-blueprint-local-cases-v1'))[0].baseline), frozenBaseline, 'Saving against a revised source preserves earlier baseline values and evidence');
unified.destroy(); unified = window.HX_UNIFIED_WORKSPACE.create(workspaceHooks); ui.setWorkspace(unified); unified.update(); await identityReady();
clickWorkspace({ analysisCase: '0' });
assert.match(inlineContent(), /Earlier \/ different source snapshot · frozen case/); assert.match(inlineContent(), /\$225/, 'A newly created workspace restores frozen numerical cases without applying the new source to them');
assert.match(inlineContent(), /2 selected products/);
window.HX_DATA = sourceSnapshot; state.compareIds = ['g1', 'g2']; state.revenueGrowth = 0; state.marginChange = 0; state.budgetChange = 0; ui.refreshDrillScope(true); unified.update(); await identityReady();
clickWorkspace({ analysisTool: 'source' });
assert.equal(state.overlay, 'source'); assert.match(nodes.get('#analysis-overlay-body').innerHTML, /Synthetic source quality utility/); assert.equal(graphCreates, 2, 'Source quality retains the graph in the restored workspace');
state.overlay = null; state.scenarioEnabled = false;
controls.mainCallbacks.onPoint({ series: mainRevenue, point: mainPoint, rawValue: mainPoint.value });
controls.mainCallbacks.onPeriod(2027);
assert.doesNotMatch(inlineContent(), /data-inline-point-value/, 'Changing year removes the previous point readout rather than leaving stale source values');
assert.equal(unified.model.summary.revenue.value, null, 'An incomplete selected total also remains unavailable through the new workspace model');
clickWorkspace({ analysisSummary: 'revenue' }); assert.match(inlineContent(), /data-inline-point-value[^>]*>Unavailable<\/strong>/);
assert.equal(dialogs.length, dialogCountBeforeCanvas, 'Unavailable selected values remain inline too');
controls.mainCallbacks.onPeriod(2026);
unified.close(); assert.equal(nodes.get('#analysis-overlay').hidden, true); assert.equal(nodes.get('#analysis-graph-shell').classList.contains('has-analysis-dock'), false);
unified.destroy(); ui.setWorkspace(null); assert.equal(graphDestroys, 2);

state.period = 2027; ui.refreshDrillScope(true);
assert.equal(ui.summary().revenue, null);
ui.metricDetail('revenue', 2027);
assert.match(dialogs.at(-1).content, /Source value · precise<\/label><strong>—<\/strong>/, 'Incomplete selected totals stay unavailable in the source dialog too');
state.comparisonScale = 'values';
ui.selectDrillScope({ groupId: 'g1', category: 'Headsets' });
assert.deepEqual(Array.from(state.compareIds), []); assert.equal(state.period, 2027); assert.equal(state.comparisonScale, 'values', 'Explore changes parent and clears comparison while retaining time and scale');
state.period = 2026;
ui.toggleCompare('PROJECT A'); ui.toggleCompare('PROJECT B');
const siblingProjects = window.HX_WORKSPACE_MODEL.build(window.HX_DATA, window.HX_ANALYTICS, state, ui.getDrill());
const projectRevenue = siblingProjects.series.filter(trace => trace.metric === 'revenue' && !trace.estimate);
assert.deepEqual(Array.from(projectRevenue, trace => trace.entityId).sort(), ['PROJECT A', 'PROJECT B'], 'Same-name sibling project selections retain distinct entity IDs for grouped readouts');
assert.equal(new Set(projectRevenue.map(trace => trace.name)).size, 1, 'The source fixture exercises identical displayed project names');
assert.equal(projectRevenue.find(trace => trace.entityId === 'PROJECT A').points.find(point => point.period === 2026).value, 20);
assert.equal(projectRevenue.find(trace => trace.entityId === 'PROJECT B').points.find(point => point.period === 2026).value, 100);
for (const scenario of window.HX_WORKSPACE_MODEL.scenarioSeries(siblingProjects, { ...state, revenueGrowth: 10 })) assert.ok(['PROJECT A', 'PROJECT B'].includes(scenario.entityId), 'Scenario variants preserve the same exact entity ID for grouping, without combining same-name projects');
ui.renderDrillExplorer();
assert.match(nodes.get('#drill-results').innerHTML, /class="drill-choice-identity">PROJECT A<\/small>/);
assert.match(nodes.get('#drill-results').innerHTML, /class="drill-choice-identity">PROJECT B<\/small>/, 'Only duplicate names receive visible exact IDs so users can distinguish them');
ui.selectDrillScope({ groupId: 'g1', projectId: 'PROJECT A', category: 'Headsets' });
ui.toggleCompare('SKU/001'); ui.toggleCompare('SKU/002');
assert.equal(ui.summary().revenue, 20); assert.equal(ui.summary().budget, null);
const skuWorkspace = window.HX_WORKSPACE_MODEL.build(window.HX_DATA, window.HX_ANALYTICS, state, ui.getDrill());
assert.equal(skuWorkspace.summary.revenue.value, 20); assert.equal(skuWorkspace.summary.revenue.kind, 'unclassified');
assert.equal(skuWorkspace.summary.budget.value, null, 'The new canvas summary never allocates project investment to selected SKUs');
assert.ok(skuWorkspace.series.filter(trace => trace.metric === 'budget').every(trace => trace.points.every(point => point.value === null)), 'SKU investment gaps are also retained in the plotted traces');
const zeroSku = skuWorkspace.series.find(trace => trace.entityId === 'SKU/001' && trace.metric === 'revenue').points.find(point => point.period === 2026);
assert.equal(zeroSku.value, 0); assert.equal(zeroSku.kind, 'unclassified');
assert.ok(zeroSku.source.some(ref => ref.cell === 'a3-R')); assert.ok(!zeroSku.source.some(ref => ref.cell === 'c1-R'), 'A repeated part number in a different project cannot enter the same-canvas evidence');
ui.renderDrillExplorer();
const skuCards = cardMetrics(nodes.get('#drill-results').innerHTML);
assert.equal(skuCards.get('0').get('revenue'), '0'); assert.equal(skuCards.get('0').get('units'), '0'); assert.equal(skuCards.get('0').get('grossProfit'), '0'); assert.equal(skuCards.get('0').get('budget'), '');
assert.match(nodes.get('#drill-results').innerHTML, /PD investment<\/small><strong class="drill-metric-value[^\"]*">Unavailable<\/strong>/, 'Every SKU card explicitly displays unavailable PD instead of inheriting parent cost');
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
vm.createContext(routeContext); vm.runInContext(`${line(/^  const workspacePreference=.+$/m)}\n${line(/^  function scopeFragment\(.+$/m)}\n${routeSource}\nnotifyParent();`, routeContext);
assert.equal(routeLocation.searchParams.has('compare'), false, 'Comparison IDs are stripped from the server-visible query');
assert.deepEqual(JSON.parse(new URLSearchParams(routeLocation.hash.split('?')[1]).get('compare')), ['SKU/001', 'A&"B']);
assert.equal(posts.at(-1).origin, routeLocation.origin);
assert.ok(!JSON.stringify(posts).includes('npiSkuRecords'), 'The host bridge carries only comparison selections, never financial rows');

assert.ok(html.includes('id="scope-breadcrumb"'), 'The shared explorer has its own breadcrumb location');
assert.ok(html.indexOf('id="scope-breadcrumb"') < html.indexOf('id="analysis-chart"'), 'Breadcrumbs appear above the single main graph');
assert.ok(html.indexOf('id="analysis-chart"') < html.indexOf('id="scope-explorer"'), 'Product choices sit below the main graph in the shared pane');
assert.match(stylesheet, /\.drill-(?:card|results)[^{]*\{[^}]*?(?:width|grid-auto-columns|grid-template-columns)[^;}]*240px/s, 'Product cards use the requested fixed 240px size instead of stretching to fill a row');
assert.match(stylesheet, /\.drill-results[^{]*\{[^}]*max-height\s*:/s, 'The product chooser has a bounded height');
assert.match(stylesheet, /\.drill-results[^{]*\{[^}]*overflow[^:]*:\s*(?:auto|scroll)/s, 'Overflow remains accessible without growing the shared pane indefinitely');
assert.match(stylesheet, /\.unified-analysis #scope-explorer \.drill-card\s*\{[^}]*height:\s*136px;[^}]*max-width:\s*240px/s, 'Four-measure cards retain a bounded 240px width and denser 136px height');
assert.match(styleParts[3], /\.drill-choice\s*\{[^}]*height:\s*136px;/, 'The single comparison button fills the card rather than reserving space for removed Details');
assert.doesNotMatch(styleParts[3], /has-product-comparison|drill-metric-difference/, 'Product comparison figures do not grow or decorate the selector cards');
const nameTypography = /\.unified-analysis #scope-explorer \.drill-choice-name\s*\{([^}]+)\}/.exec(styleParts[3])?.[1] || '';
const valueTypography = /\.unified-analysis \.drill-metric-value\s*\{([^}]+)\}/.exec(styleParts[3])?.[1] || '';
const labelTypography = /\.unified-analysis \.drill-metric-label\s*\{([^}]+)\}/.exec(styleParts[3])?.[1] || '';
const secondaryValueSize = Number(/--analysis-value-size:\s*([\d.]+)px/.exec(styleParts[3])?.[1]);
const fontProperty = (body, property) => { const value = new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`).exec(body)?.[1]; return value?.trim() === 'var(--analysis-value-size)' ? secondaryValueSize : Number.parseFloat(value); };
assert.equal(secondaryValueSize, 15); assert.equal(fontProperty(valueTypography, 'font-size'), secondaryValueSize, 'Chooser figures share the uniform secondary value size');
assert.match(styleParts[3], /\.drill-metric-value\.is-unavailable\s*\{[^}]*font-size:\s*var\(--analysis-value-size\)/, 'Unavailable chooser values retain the same size as numeric values');
assert.ok(fontProperty(nameTypography, 'font-size') >= fontProperty(valueTypography, 'font-size'), 'Product identities are at least as large as their financial figures');
assert.ok(fontProperty(nameTypography, 'font-weight') > fontProperty(valueTypography, 'font-weight'), 'Product names lead the chooser hierarchy with a stronger font weight');
assert.ok(fontProperty(labelTypography, 'font-size') < fontProperty(valueTypography, 'font-size'), 'Metric labels stay smaller than their financial values');
const luminance = body => {
  const color = /(?:^|;)\s*color:\s*#([\da-f]{6})(?:;|$)/i.exec(body)?.[1]; assert.ok(color, 'Chooser hierarchy uses an explicit readable text color');
  const channels = [0, 2, 4].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
};
assert.ok(luminance(nameTypography) > luminance(valueTypography) && luminance(valueTypography) > luminance(labelTypography), 'Product names lead the chooser, financial values remain clear, and metric labels use a quieter tone');
assert.match(styleParts[3], /\.drill-card\.is-selected\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/, 'The outer selected card does not add a second selection box');
assert.match(styleParts[3], /\.drill-choice\s*\{[^}]*width:\s*100%;/, 'The primary product selection area spans the card width');
assert.match(styleParts[3], /\.drill-card\.is-selected \.drill-choice\s*\{[^}]*box-shadow:\s*inset\s+0\s+-1px\s+color-mix\(/, 'One full-width inset underline identifies the selected product');
assert.match(styleParts[3], /\.drill-card\.is-selected \.drill-choice\s*\{[^}]*var\(--product-color,[^)]+\)\s+25%,transparent/, 'The selected card underline stays subtle rather than restoring the strong saturated rule');
assert.match(styleParts[3], /\.drill-card\.is-selected \.drill-choice-name\s*\{\s*text-decoration:\s*none;/, 'The selected name does not add a shorter duplicate underline');
assert.match(styleParts[3], /\.drill-card\.is-selected \.drill-choice-name\s*\{[^}]*font-style:\s*normal;[^}]*color:\s*#7bd8d0/, 'Selected product names use the requested teal without tilting the text');
assert.doesNotMatch(styleParts[3], /\.drill-card\.is-selected \.drill-choice-name\s*\{[^}]*font-style:\s*italic/, 'The voice correction to teal does not leave an italic selection rule');
assert.match(styleParts[3], /\.drill-card\s*\+\s*\.drill-card::before\s*\{[^}]*width:\s*1px;[^}]*background:\s*#ffffff[01][\da-f];[^}]*pointer-events:\s*none/i, 'Adjacent product cards have subtle vertical dividers that never intercept selection');
assert.match(styleParts[3], /@media\(max-width:480px\)[\s\S]*\.drill-card\s*\+\s*\.drill-card::before\s*\{[^}]*width:\s*auto;[^}]*height:\s*1px;/, 'At small widths the divider follows stacked cards without forcing a vertical outer border');
assert.ok(html.indexOf('id="analysis-summary"') < html.indexOf('id="analysis-chart"'), 'Selected-year values remain above the graph');
assert.doesNotMatch(region(unifiedWorkspace, '    function showPoint(', '    async function identifySource('), /hooks\.openDialog|\.showModal\(/, 'The actual point handler cannot create a modal');

console.log('Blueprint product comparison UI checks passed: one retained canvas with four metric overlays and contextual tools, per-trace and aggregate provenance, complete weighted totals, missing/zero SKU facts without cost allocation, parent reset, fragment privacy, accessible compare and chart-name drill actions, and fixed bounded cards below the graph.');
