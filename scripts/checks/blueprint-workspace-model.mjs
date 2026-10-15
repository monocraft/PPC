import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const files = ['analytics.js', 'product-connectivity.js', 'workspace-model.js'];
const sources = await Promise.all(files.map(file => readFile(new URL(`../../public/blueprint/${file}`, import.meta.url), 'utf8')));
const years = [2024, 2025, 2026, 2027, 2028, 2029];
const ref = (cell, value) => ({ sheet: 'Synthetic unified workspace fixture', cell, value });
function product(id, name, category, connectivity, revenue, grossProfit) {
  return { id, name, category, connectivity, connectivitySource: [ref(id + '-connection', connectivity)],
    revenueByYear: Object.fromEntries(years.map((year, i) => [year, revenue[i]])),
    gmByYear: Object.fromEntries(years.map((year, i) => [year, grossProfit[i]])),
    unitsByYear: Object.fromEntries(years.map((year, i) => [year, typeof revenue[i] === 'number' ? revenue[i] / 10 : null])),
    sourceByYear: Object.fromEntries(years.map((year, i) => [year, { revenue: [ref(`${id}-${year}-R`, revenue[i])], grossProfit: [ref(`${id}-${year}-G`, grossProfit[i])], units: [ref(`${id}-${year}-U`, typeof revenue[i] === 'number' ? revenue[i] / 10 : null)] }])) };
}
const record = (id, projectId, skuId, period, revenue, grossProfit, units, groupName = 'Alpha family') => ({ id, projectId, skuId, period, revenue, grossProfit, units, name: skuId + ' synthetic item', groupName, category: 'Headsets', quarter: 1, sourceByMetric: { revenue: [ref(id + '-R', revenue)], grossProfit: [ref(id + '-G', grossProfit)], units: [ref(id + '-U', units)] }, source: [ref(id + '-R', revenue)] });
const data = { schemaVersion: 2, sourceGrainVersion: 2, source: { name: 'Synthetic unified workspace source' }, periods: years, categories: ['Headsets', 'Mice'],
  products: [product('alpha', 'Alpha family', 'Headsets', 'Wired', [100, 200, 300, 0, -40, null], [20, 40, 90, 0, -10, null]), product('beta', 'Beta family', 'Headsets', 'Wired', [null, 50, null, 20, -10, null], [null, 10, 20, null, -2, null]), product('gamma', 'Gamma family', 'Mice', 'Wireless', [5, 10, 20, null, null, null], [1, 3, 5, null, null, null]), product('unknown', 'Unspecified family', 'Headsets', 'NA', [1, 2, 8, 0, null, null], [0, 1, 2, 0, null, null])],
  projects: [{ id: 'P-Alpha', name: 'Alpha family', category: 'Headsets', codeName: 'One', launchYear: 2024 }, { id: 'P-Alpha-Future', name: 'Alpha family', category: 'Headsets', codeName: 'Future', launchYear: 2031 }, { id: 'P-Beta', name: 'Beta family', category: 'Headsets', codeName: 'Two', launchYear: 2025 }, { id: 'P-Gamma', name: 'Gamma family', category: 'Mice', codeName: 'Three', launchYear: 2025 }],
  investments: [{ productId: 'P-Alpha', name: 'Alpha family', category: 'Headsets', period: 2024, amount: 50, connectivity: 'Wired', source: [ref('P-Alpha-PD24', 50)] }, { productId: 'P-Alpha', name: 'Alpha family', category: 'Headsets', period: 2025, amount: 0, connectivity: 'Wired', source: [ref('P-Alpha-PD25', 0)] }, { productId: 'P-Alpha', name: 'Alpha family', category: 'Headsets', period: 2026, amount: 100, connectivity: 'Wired', source: [ref('P-Alpha-PD26', 100)] }, { productId: 'P-Beta', name: 'Beta family', category: 'Headsets', period: 2026, amount: null, connectivity: 'Wired', source: [ref('P-Beta-PD26', null)] }],
  npiSkuRecords: [record('alpha-A24', 'P-Alpha', 'SKU-A#ABA', 2024, 7, 2, 1), record('alpha-A25', 'P-Alpha', 'SKU-A#ABA', 2025, 10, 3, 1), record('alpha-A26', 'P-Alpha', 'SKU-A#ABA', 2026, 11, 4, 1), record('alpha-B26', 'P-Alpha', 'SKU-B#ABA', 2026, 0, 0, 0), record('alpha-A27', 'P-Alpha', 'SKU-A#ABA', 2027, null, null, null), record('alpha-B27', 'P-Alpha', 'SKU-B#ABA', 2027, -2, -1, -1), record('beta-A26', 'P-Beta', 'SKU-A#ABA', 2026, 7000, 5000, 700, 'Beta family'), record('orphan26', 'Unmapped-key', 'ORPHAN#ABA', 2026, 900000, 800000, 90000, 'Unmatched family')],
  prelaunchCases: [{ id: 'P-Alpha-Future', projectId: 'P-Alpha-Future', name: 'Alpha family', category: 'Headsets', launchYear: 2031, revenue: 1200, grossProfit: 400, units: 120, launchYearRevenue: 250, source: [ref('future-12M-plan', 1200)], sourceByMetric: { revenue: [ref('future-explicit-launch-year-plan', 250)] } }], npi: [], npiValues: [], published: [{ period: 2026, category: 'All', revenue: 99999, grossMargin: .99, source: { revenue: [ref('published-adjusted-revenue', 99999)], grossMargin: [ref('published-adjusted-margin', .99)] } }], tam: []
};
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const before = JSON.stringify(data); freeze(data);
const window = { HX_DATA: data }; sources.forEach((source, i) => vm.runInNewContext(source, { window }, { filename: files[i] }));
const engine = window.HX_ANALYTICS, api = window.HX_WORKSPACE_MODEL;
const expectedCategoryColors = { Controllers: '#895EF6', Headsets: '#6984ED', Keyboards: '#4DA1F7', Mice: '#20CBDD', Others: '#7AE3A9', 'Standalone Mics': '#FFC63B' };
assert.equal(typeof api.categoryColor, 'function');
assert.equal(new Set(Object.keys(expectedCategoryColors).map(api.categoryColor)).size, 6, 'All six portfolio categories have distinct stable hues');
for (const [category, color] of Object.entries(expectedCategoryColors)) assert.equal(api.categoryColor(category), color);
assert.equal(api.categoryColor(' standalone MICROPHONES '), expectedCategoryColors['Standalone Mics']); assert.equal(api.categoryColor('mic'), expectedCategoryColors['Standalone Mics']);
const dashboardSource = await readFile(new URL('../../public/blueprint/dashboard.js', import.meta.url), 'utf8');
const categoryColorDeclaration = dashboardSource.match(/^  const categoryColor = .+$/m)?.[0]; assert.ok(categoryColorDeclaration);
for (const colorWindow of [window, {}]) {
  const colorContext = { window: colorWindow, colors: Object.values(expectedCategoryColors) };
  vm.runInNewContext(`${categoryColorDeclaration}\nglobalThis.colorFor = categoryColor;`, colorContext);
  for (const [category, color] of Object.entries(expectedCategoryColors)) assert.equal(colorContext.colorFor(category), color, 'Category selection and legacy chart colors use the same named palette as the main graph');
}
const defaults = { category: ['all'], groupId: null, projectId: null, skuId: null, compareIds: [], connectivity: ['all'], period: 2026, metrics: ['revenue'], revenueGrowth: 10, marginChange: 5, budgetChange: -20, scenarioStart: 2026 };
function build(extra = {}) { const state = { ...defaults, ...extra }; const scope = { ...state, category: state.category.includes('all') ? 'All' : state.category }; return { state, model: api.build(data, engine, state, engine.drilldown(scope)) }; }
const point = (trace, year) => trace.points.find(point => point.period === year);
const trace = (model, metric, entityId = 'scope') => model.allSeries.find(trace => trace.metric === metric && trace.entityId === entityId);
const plain = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, note) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-10, `${note}: ${actual} !== ${expected}`);

const categoryData = structuredClone(data);
categoryData.categories = ['Standalone Mics', 'Mice', 'Controllers', 'Others', 'Keyboards', 'Headsets'];
categoryData.products.push(product('controller-family', 'Controller family', 'Controllers', 'Wired', [1, 2, 3, 4, 5, 6], [1, 1, 1, 1, 1, 1]), product('mic-family', 'Microphone family', 'Standalone Mics', 'Wired', [6, 5, 4, 3, 2, 1], [1, 1, 1, 1, 1, 1]));
categoryData.projects.push({ id: 'category-Mice', name: 'Alpha family', category: 'Headsets', launchYear: 2026 });
categoryData.npiSkuRecords.push(record('category-project26', 'category-Mice', 'Source SKU', 2026, 123, 45, 12), record('category-sku26', 'P-Alpha', 'category-Mice', 2026, 7, 3, 2));
const categoryDataBefore = JSON.stringify(categoryData);
function buildCategoryPalette(source, extra = {}) {
  window.HX_DATA = source;
  const state = { ...defaults, category: source.categories, metrics: ['revenue', 'units', 'grossProfit', 'budget'], ...extra };
  return api.build(source, engine, state, engine.drilldown({ ...state, category: state.category }));
}
try {
  const fullPalette = buildCategoryPalette(categoryData);
  for (const category of Object.keys(expectedCategoryColors)) {
    const traces = fullPalette.allSeries.filter(trace => trace.entityId === 'category-' + category);
    assert.equal(traces.length, 4); assert.ok(traces.every(trace => trace.color === expectedCategoryColors[category] && trace.entityColor === expectedCategoryColors[category]), 'Category comparisons use category identity for their hue, with metric markers and patterns retained');
  }
  const reorderedCategoryData = structuredClone(categoryData); reorderedCategoryData.categories.reverse(); reorderedCategoryData.products.reverse();
  const narrowed = buildCategoryPalette(reorderedCategoryData, { category: ['Controllers', 'Standalone Mics', 'Mice'], metrics: ['units'], period: 2025, productSort: 'revenue', sortDirection: 'asc' });
  for (const trace of narrowed.allSeries) assert.equal(trace.color, expectedCategoryColors[trace.entityId.slice(9)], 'Category hue is independent of source ordering, selected subset, ranking, fiscal year and visible measure');
  const oneCategory = buildCategoryPalette(categoryData, { category: ['Mice'], metrics: ['grossProfit'] }); assert.equal(oneCategory.series[0].color, expectedCategoryColors.Mice, 'A category keeps its comparison hue when selected alone');
  for (const trace of api.scenarioSeries(fullPalette, defaults)) assert.equal(trace.color, fullPalette.allSeries.find(source => source.id + ':scenario' === trace.id).color, 'Scenario overlays retain the matching category hue');
  for (const scope of [{ groupId: 'alpha', projectId: 'category-Mice', skuId: null }, { groupId: 'alpha', projectId: 'P-Alpha', skuId: 'category-Mice' }]) {
    const descendant = buildCategoryPalette(categoryData, { category: ['Headsets'], ...scope });
    assert.equal(new Set(descendant.allSeries.map(trace => trace.color)).size, 4, 'A project or SKU whose exact source ID starts with category- retains its per-measure colors');
    assert.ok(descendant.allSeries.find(trace => trace.metric === 'revenue').points.some(point => point.value === (scope.skuId ? 7 : 123)), 'The prefix collision fixture retains its actual descendant source grain');
  }
  assert.equal(JSON.stringify(categoryData), categoryDataBefore, 'Category palette assignment does not change source data or category order');
} finally { window.HX_DATA = data; }

const baseline = build().model;
assert.equal(baseline.summary.revenue.value, 328, 'Portfolio finance uses raw annual product-group observations');
assert.equal(baseline.summary.grossProfit.value, 117, 'Published adjusted margin never replaces source GP dollars');
assert.equal(baseline.summary.units.value, 32.8);
assert.equal(baseline.summary.revenue.coverage.missingCount, 1, 'Default portfolio totals disclose missing group observations');
assert.equal(baseline.summary.grossProfit.coverage.revenueAligned, false, 'Default GP and revenue cannot form a ratio across different known contributors');
assert.ok(!baseline.summary.revenue.source.some(source => source.cell === 'orphan26-R'), 'Orphan tracker finance is never rolled into the portfolio');
assert.ok(baseline.catalog.some(child => child.id === 'source-unmapped'), 'Orphan source projects remain discoverable');
assert.equal(baseline.series.length, 1); assert.equal(baseline.allSeries.length, 4);
const mixed = build({ metrics: ['revenue', 'grossProfit', 'units', 'budget'] }).model;
assert.deepEqual(Array.from(mixed.series, trace => trace.metric), ['revenue', 'units', 'grossProfit', 'budget']);
assert.deepEqual(plain(mixed.summary), plain(baseline.summary), 'Metric toggles change visibility only, not financial values or source evidence');
assert.deepEqual(plain(mixed.allSeries), plain(baseline.allSeries));
assert.equal(trace(mixed, 'units').unit, 'units'); assert.equal(trace(mixed, 'grossProfit').unit, 'currency');
assert.equal(new Set(mixed.allSeries.map(trace => trace.color)).size, 4, 'Four overlaid measures use distinct line colors for one entity');
assert.equal(new Set(mixed.allSeries.map(trace => trace.entityColor)).size, 1, 'Entity identity remains a separate consistent selection/card color');
assert.ok(mixed.allSeries.every(trace => /^#[\da-f]{6}$/i.test(trace.color) && /^#[\da-f]{6}$/i.test(trace.entityColor)));
assert.equal(api.selectionColor(mixed, { entityId: 'scope' }), '#969eac', 'An entity with several visible measure colors uses a neutral selection');
assert.equal(api.selectionColor(baseline, { entityId: 'scope' }), baseline.series[0].color, 'A single visible finite baseline uses its actual line color');
assert.equal(api.selectionColor(mixed, { entityId: 'scope', metric: 'grossProfit' }), trace(mixed, 'grossProfit').color, 'Both filters resolve the exact visible entity/measure line');
assert.equal(api.selectionColor(mixed, { entityId: 'not-visible' }), '#969eac');
assert.equal(api.selectionColor(null), '#969eac');
assert.equal(point(trace(mixed, 'grossProfit'), 2026).source[0].cell, 'alpha-2026-G', 'GP evidence remains its own dollars cell');
assert.equal(point(trace(mixed, 'units'), 2026).source[0].cell, 'alpha-2026-U');

const gpOnly = build({ metrics: ['grossProfit'], groupId: 'alpha', category: ['Headsets'] });
assert.equal(gpOnly.model.series.length, 1); assert.equal(gpOnly.model.series[0].metric, 'grossProfit');
const gpScenario = api.scenarioSeries(gpOnly.model, gpOnly.state)[0];
near(point(gpScenario, 2026).value, 300 * 1.1 * (.3 + .05), 'GP scenario obtains its revenue denominator even when Revenue is hidden');
assert.equal(point(gpScenario, 2026).baselineValue, 90);
assert.equal(point(gpScenario, 2026).source[0].cell, 'alpha-2026-G');
assert.deepEqual(Array.from(point(gpScenario, 2026).source, source => source.cell), ['alpha-2026-G', 'alpha-2026-R'], 'A GP scenario exposes both numerator and revenue-denominator source cells');
assert.equal(point(gpScenario, 2025).value, null); assert.equal(point(gpScenario, 2024).value, null, 'Actual and history are protected');
const early = { ...gpOnly.state, scenarioStart: 2024 };
assert.equal(point(api.scenarioSeries(gpOnly.model, early)[0], 2025).value, null, 'Moving the scenario start backward cannot alter verified actuals');
assert.equal(point(api.scenarioSeries(gpOnly.model, early)[0], 2024).value, null);
assert.equal(point(gpScenario, 2027).value, null, 'A zero revenue denominator cannot support a margin-point adjustment');
const noMargin = api.scenarioSeries(gpOnly.model, { ...gpOnly.state, marginChange: 0 })[0];
assert.equal(point(noMargin, 2027).value, 0, 'A genuine zero GP remains zero when only a growth sensitivity applies');
near(point(noMargin, 2028).value, -11, 'Signed source GP is not clipped');
assert.equal(point(noMargin, 2029).value, null, 'A missing source GP remains a gap');
const futureStart = api.scenarioSeries(gpOnly.model, { ...gpOnly.state, scenarioStart: 2028 })[0];
assert.equal(point(futureStart, 2026).value, null, 'Eligible plans before the chosen start stay unchanged in the source line');
assert.deepEqual(plain(gpOnly.model), plain(build({ metrics: ['grossProfit'], groupId: 'alpha', category: ['Headsets'] }).model), 'Computing scenarios never mutates its baseline model');
assert.equal(api.scenarioSeries(mixed, defaults).some(trace => trace.metric === 'units'), false, 'Units stay at source values rather than acquiring a fabricated scenario forecast');

const wired = build({ connectivity: ['wired'], metrics: ['revenue', 'grossProfit', 'units', 'budget'] });
assert.deepEqual(Array.from(wired.model.visibleCatalog, child => child.id), ['alpha', 'beta']);
assert.equal(wired.model.summary.revenue.value, 300); assert.equal(wired.model.summary.revenue.coverage.complete, false);
assert.equal(wired.model.summary.revenue.coverage.availableCount, 1); assert.equal(wired.model.summary.revenue.coverage.missingCount, 1);
assert.deepEqual(Array.from(wired.model.summary.revenue.coverage.availableIds), ['alpha']); assert.deepEqual(Array.from(wired.model.summary.revenue.coverage.missingIds), ['beta']);
assert.match(wired.model.summary.revenue.basis, /known source subtotal/);
assert.equal(wired.model.summary.grossProfit.value, 110); assert.equal(wired.model.summary.grossProfit.coverage.revenueAligned, false, 'Different revenue/GP coverage cannot form a comparable raw margin');
assert.equal(point(api.scenarioSeries(wired.model, wired.state).find(trace => trace.metric === 'grossProfit'), 2026).value, null, 'A cohort GP sensitivity requires the same revenue and GP contributors');
assert.equal(wired.model.summary.budget.value, 100); assert.equal(wired.model.summary.budget.coverage.complete, false, 'PD is a known subtotal when a sibling investment is missing');
assert.equal(wired.model.summary.budget.kind, 'source-investment');
const wiredAligned = build({ connectivity: ['wired'], metrics: ['grossProfit'], period: 2025, scenarioStart: 2024 });
assert.equal(wiredAligned.model.summary.grossProfit.coverage.revenueAligned, true);
assert.equal(wiredAligned.model.summary.revenue.value, 250); assert.equal(wiredAligned.model.summary.grossProfit.value, 50);
assert.equal(point(api.scenarioSeries(wiredAligned.model, wiredAligned.state)[0], 2025).value, null, 'Combining actual groups retains protection');
assert.equal(point(trace(wired.model, 'revenue', 'connection-wired'), 2028).value, -50, 'Cohort totals preserve signed additive values');
assert.equal(point(trace(wired.model, 'revenue', 'connection-wired'), 2029).value, null, 'An all-missing cohort is not zero');

const strict = build({ compareIds: ['alpha', 'beta'], metrics: ['revenue', 'grossProfit', 'budget'] }).model;
assert.equal(strict.summary.revenue.value, null, 'An explicit selected total requires an observation from every selected sibling');
assert.equal(strict.summary.revenue.coverage.selectedCount, 2); assert.equal(strict.summary.revenue.coverage.missingCount, 1);
assert.equal(strict.summary.grossProfit.value, 110); assert.equal(strict.summary.budget.value, null, 'Completeness is checked independently per metric');
assert.equal(strict.summary.grossProfit.coverage.revenueAligned, false);
assert.equal(build({ compareIds: ['alpha', 'alpha'], period: 2025 }).model.summary.revenue.value, 200, 'Duplicate selections cannot duplicate finance');
const strictComplete = build({ compareIds: ['alpha', 'beta'], period: 2025 }).model;
near(strictComplete.summary.grossProfit.value / strictComplete.summary.revenue.value, 50 / 250, 'Any displayed complete aggregate margin uses additive dollars');

const unknown = build({ connectivity: ['unclassified'] }).model;
assert.ok(unknown.visibleCatalog.some(child => child.id === 'source-unmapped'), 'Filtering keeps orphan discovery available');
assert.equal(unknown.summary.revenue.value, 8, 'Unclassified annual group finance excludes the separate orphan tracker population');
assert.equal(unknown.coverage.excludedCount, 1); assert.deepEqual(Array.from(unknown.coverage.excludedIds), ['source-unmapped']);
assert.match(unknown.coverage.excludedBasis, /separate population/);
assert.equal(point(trace(unknown, 'revenue', 'connection-unclassified'), 2026).value, 8);
const bothConnections = build({ connectivity: ['wired', 'wireless'], metrics: ['revenue', 'units'] }).model;
assert.equal(bothConnections.series.length, 4); assert.equal(bothConnections.summary.revenue.value, 320);
assert.equal(new Set(bothConnections.allSeries.map(trace => trace.color)).size, 8, 'Wired/Wireless with four measures yields eight distinct line colors');
assert.equal(api.selectionColor(bothConnections, { metric: 'revenue' }), '#969eac', 'A measure shown for two differently colored entities has no single highlight color');
const wiredRevenueOnly = build({ connectivity: ['wired', 'wireless'], metrics: ['revenue'] }).model;
assert.equal(api.selectionColor(wiredRevenueOnly, { entityId: 'connection-wired' }), trace(wiredRevenueOnly, 'revenue', 'connection-wired').color);
const invisible = { series: [{ entityId: 'item', metric: 'revenue', color: '#123456', points: [{ value: null }, { value: undefined }] }] };
assert.equal(api.selectionColor(invisible, { entityId: 'item' }), '#969eac', 'An all-missing source trace is not a visible line match');
assert.equal(api.selectionColor({ series: invisible.series.map(trace => ({ ...trace, points: [{ value: 0 }] })) }, { entityId: 'item' }), '#123456', 'A genuine source zero still identifies a visible line');
assert.equal(api.selectionColor({ series: invisible.series.map(trace => ({ ...trace, points: [{ value: -1 }] })) }, { entityId: 'item' }), '#123456', 'Signed source observations identify their visible line');
for (const flag of ['scenario', 'estimate']) assert.equal(api.selectionColor({ series: [{ ...invisible.series[0], [flag]: true, points: [{ value: 7 }] }] }, { entityId: 'item' }), '#969eac', 'An overlay cannot manufacture a baseline selection match');
const sourceAndOverlay = { series: [{ ...invisible.series[0], points: [{ value: 7 }] }, { ...invisible.series[0], color: '#abcdef', scenario: true, points: [{ value: 8 }] }] };
assert.equal(api.selectionColor(sourceAndOverlay, { entityId: 'item' }), '#123456', 'Overlay colors do not dilute an exact baseline match');
assert.equal(new Set(bothConnections.allSeries.filter(trace => trace.entityId === 'connection-wired').map(trace => trace.entityColor)).size, 1);
assert.equal(new Set(bothConnections.allSeries.filter(trace => trace.entityId === 'connection-wireless').map(trace => trace.entityColor)).size, 1);
const wireRevenueColor = trace(bothConnections, 'revenue', 'connection-wired').color;
const differentVisibility = build({ connectivity: ['wireless', 'wired'], metrics: ['budget', 'grossProfit'], productSort: 'budget', sortDirection: 'asc' }).model;
assert.equal(trace(differentVisibility, 'revenue', 'connection-wired').color, wireRevenueColor, 'Metric visibility, connection selection order and product sorting cannot reassign trace colors');
for (const baselineTrace of bothConnections.allSeries) assert.equal(differentVisibility.allSeries.find(trace => trace.id === baselineTrace.id).color, baselineTrace.color);
const alphaColor = trace(build({ compareIds: ['alpha'], metrics: ['units'] }).model, 'revenue', 'alpha').color;
assert.equal(trace(build({ compareIds: ['gamma', 'alpha'], metrics: ['grossProfit'] }).model, 'revenue', 'alpha').color, alphaColor, 'An entity keeps its colors when other products or measures are selected');
assert.equal(build({ compareIds: ['alpha'] }).model.catalog.find(child => child.id === 'alpha').entityColor, trace(build({ compareIds: ['alpha'] }).model, 'revenue', 'alpha').entityColor, 'Card identity color matches the corresponding entity selection color');
const none = build({ connectivity: ['both'] }).model;
assert.equal(none.empty, true); assert.equal(none.summary.revenue.value, null); assert.equal(none.summary.revenue.coverage.complete, false);

for (const compareIds of [['alpha', 'missing'], ['missing'], ['source-unmapped'], ['alpha', 'source-unmapped'], 'alpha', [null], ['alpha\n'], ['x'.repeat(241)], Array(51).fill('alpha')]) {
  const invalid = build({ compareIds }).model;
  assert.equal(invalid.invalidSelection, true); assert.ok(invalid.invalidSelectionReason); assert.equal(invalid.empty, true);
  assert.equal(invalid.series.length, 0); assert.equal(invalid.allSeries.length, 0); assert.equal(invalid.selected.length, 0);
  for (const metric of Object.keys(api.metrics)) { assert.equal(invalid.summary[metric].value, null); assert.equal(invalid.summary[metric].coverage.invalidSelection, true); }
  for (const field of ['periods', 'catalog', 'visibleCatalog', 'selected', 'series', 'allSeries', 'estimates', 'metrics']) assert.ok(Array.isArray(invalid[field]), `Invalid models retain ${field}`);
}
assert.equal(build({ connectivity: ['wired'], compareIds: ['gamma'] }).model.invalidSelection, true, 'An out-of-filter selected ID cannot fall back to cohort totals');
assert.equal(build({ groupId: 'alpha', category: ['Headsets'], compareIds: ['beta'] }).model.invalidSelection, true, 'Selected siblings cannot cross the parent scope');

const project = build({ groupId: 'alpha', category: ['Headsets'], compareIds: ['P-Alpha'], metrics: ['revenue', 'budget'] });
assert.equal(project.model.summary.revenue.value, 11, 'Project source results remain tracker finance, rather than inherited 300 group revenue');
assert.equal(project.model.summary.revenue.kind, 'unclassified'); assert.equal(project.model.summary.budget.value, 100);
assert.equal(point(api.scenarioSeries(project.model, project.state).find(trace => trace.metric === 'revenue'), 2026).source[0].cell, 'alpha-A26-R');
const skus = build({ groupId: 'alpha', projectId: 'P-Alpha', category: ['Headsets'], compareIds: ['SKU-A#ABA', 'SKU-B#ABA'], metrics: ['revenue', 'grossProfit', 'budget'] });
assert.equal(skus.model.summary.revenue.value, 11, 'A real zero SKU remains additive and the same SKU under another project is excluded');
assert.equal(skus.model.summary.grossProfit.value, 4); assert.equal(skus.model.summary.budget.value, null);
assert.equal(skus.model.summary.budget.coverage.missingCount, 2, 'Project PD is not copied onto each SKU');
assert.ok(skus.model.catalog.every(child => child.budget === null));
assert.ok(api.scenarioSeries(skus.model, skus.state).find(trace => trace.metric === 'budget').points.every(point => point.value === null));
assert.equal(build({ groupId: 'alpha', projectId: 'P-Alpha', category: ['Headsets'], compareIds: ['SKU-A#ABA', 'SKU-B#ABA'], period: 2027 }).model.summary.revenue.value, null, 'A missing SKU plus signed sibling stays incomplete');

const future = build({ groupId: 'alpha', projectId: 'P-Alpha-Future', category: ['Headsets'], period: 2031, metrics: ['revenue', 'grossProfit'] });
assert.equal(future.model.summary.revenue.value, null, 'A source plan never fills missing reported tracker revenue');
assert.equal(future.model.estimates.length, 1); assert.equal(future.model.series.length, 3);
assert.equal(future.model.estimates[0].estimate, true); assert.equal(future.model.estimates[0].entityId, 'P-Alpha-Future:launch-plan');
assert.equal(future.model.estimates[0].displayEntityId, 'P-Alpha-Future');
assert.equal(future.model.estimates[0].displayName, future.model.allSeries[0].name, 'An individual annual plan explicitly identifies its display group without changing its source identity');
assert.equal(future.model.estimates[0].color, trace(future.model, 'revenue', 'P-Alpha-Future').color, 'An annual source plan retains its corresponding revenue color and is distinguished by plan styling');
assert.equal(future.model.estimates[0].entityColor, trace(future.model, 'revenue', 'P-Alpha-Future').entityColor);
assert.equal(point(future.model.estimates[0], 2031).value, 250, 'The explicit launch-year source amount is preserved without annualizing the 12M case');
assert.equal(point(future.model.estimates[0], 2031).source[0].cell, 'future-explicit-launch-year-plan');
assert.ok(future.model.estimates[0].points.filter(point => point.period !== 2031).every(point => point.value === null));
assert.ok(future.model.allSeries.every(trace => !trace.estimate), 'Source annual plan lines stay outside raw reported financial sums');
assert.equal(api.scenarioSeries(future.model, future.state).some(trace => trace.estimate), false, 'Reported-baseline scenario controls do not silently create a separate plan scenario');
assert.equal(build({ groupId: 'alpha', projectId: 'P-Alpha-Future', category: ['Headsets'], metrics: ['grossProfit'] }).model.series.some(trace => trace.estimate), false, 'The Revenue toggle also controls distinct revenue-plan visibility');
const selectedPlans = build({ groupId: 'alpha', category: ['Headsets'], compareIds: ['P-Alpha', 'P-Alpha-Future'], period: 2031 }).model;
assert.ok(selectedPlans.periods.includes(2031), 'Source-only launch years survive the parent timeline');
assert.equal(selectedPlans.estimates.length, 1); assert.equal(selectedPlans.summary.revenue.value, null);
assert.equal(selectedPlans.estimates[0].entityId, 'P-Alpha-Future:launch-plan');
assert.equal(selectedPlans.estimates[0].displayEntityId, 'P-Alpha-Future');
const cohortPlan = build({ groupId: 'alpha', category: ['Headsets'], connectivity: ['unclassified'], metrics: ['revenue'] }).model.estimates[0];
assert.equal(cohortPlan.displayEntityId, 'connection-unclassified'); assert.equal(cohortPlan.displayName, 'Unclassified', 'An individual source plan identifies its connectivity display cohort explicitly');
assert.equal(cohortPlan.entityId, 'P-Alpha-Future:launch-plan'); assert.equal(cohortPlan.reportedEntityId, 'P-Alpha-Future', 'Display grouping never replaces project source or matching-baseline identity');
assert.equal(point(cohortPlan, 2031).value, 250); assert.equal(point(cohortPlan, 2031).source[0].cell, 'future-explicit-launch-year-plan', 'Grouping metadata never aggregates or changes the exact annual plan');
assert.equal(skus.model.estimates.length, 0, 'Project annual plans are never allocated to SKU lines');
for (const scenarioTrace of api.scenarioSeries(mixed, defaults)) {
  const baselineTrace = mixed.allSeries.find(trace => trace.id + ':scenario' === scenarioTrace.id);
  assert.equal(scenarioTrace.color, baselineTrace.color, 'Scenario styling keeps each measure’s baseline color');
  assert.equal(scenarioTrace.entityColor, baselineTrace.entityColor);
}

const explanation = api.explain(point(gpScenario, 2026), gpScenario);
assert.equal(explanation.baselineValue, 90); assert.ok(explanation.formula); assert.equal(explanation.source[0].cell, 'alpha-2026-G');
assert.equal(JSON.stringify(data), before, 'All metric toggles, cohorts, selected totals and scenarios leave the immutable source unchanged');
console.log('Blueprint workspace model: metric visibility, mixed units, hidden-revenue GP sensitivity, protected actual/history, exact coverage, strict selected totals, source populations, signed/zero/missing values and SKU investment boundaries passed.');
