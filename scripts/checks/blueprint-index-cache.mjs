import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const code = await readFile(new URL('../../public/blueprint/analytics.js', import.meta.url), 'utf8');
let categoryReads = 0;
const source = cell => ({ sheet: 'Synthetic cache fixture', cell, value: 0 });
const product = (id, name) => ({ id, name, category: 'Headsets', revenueByYear: { 2025: 100, 2026: 200 }, gmByYear: { 2025: 20, 2026: 60 }, unitsByYear: { 2025: 10, 2026: 20 }, sourceByYear: { 2025: {}, 2026: {} } });
function record(id, skuId, revenue) {
  const row = { id, projectId: 'Project-Key', skuId, groupName: 'Alpha family', period: 2026, quarter: 1, revenue, grossProfit: typeof revenue === 'number' ? revenue / 2 : null, units: revenue, source: [source(id)], sourceByMetric: { revenue: [source(id)] } };
  Object.defineProperty(row, 'category', { enumerable: true, get() { categoryReads++; return 'Headsets'; } });
  return row;
}
const data = { schemaVersion: 2, sourceGrainVersion: 2, periods: [2025, 2026], categories: ['Headsets'],
  products: [product('alpha', 'Alpha family'), product('beta', 'Beta family')],
  projects: [{ id: 'Project-Key', name: 'Alpha family', category: 'Headsets', codeName: 'Synthetic', launchYear: 2025 }],
  npiSkuRecords: [record('zero', 'SKU-A', 0), record('signed', 'SKU-B', -4), record('missing', 'SKU-C', null)],
  investments: [{ id: 'spend-one', productId: 'Project-Key', period: 2026, amount: 0, source: [source('spend-one')] }],
  prelaunchCases: [], npiValues: [], published: [], npi: [], tam: [] };
const window = { HX_DATA: data }; vm.runInNewContext(code, { window });
const api = window.HX_ANALYTICS, scope = { category: 'Headsets', groupId: 'alpha', projectId: 'Project-Key', period: 2026 };
const cold = api.drilldown(scope), coldReads = categoryReads;
assert.ok(coldReads >= data.npiSkuRecords.length, 'The cold call validates source-row metadata');
assert.equal(cold.summary.revenue, -4); assert.equal(cold.summary.budget, 0); assert.equal(cold.coverage.skuCount, 3);
for (let index = 0; index < 20; index++) assert.equal(JSON.stringify(api.drilldown(scope)), JSON.stringify(cold), 'Warm results retain values, gaps, hierarchy, basis and source evidence exactly');
assert.equal(categoryReads, coldReads, 'Repeated scopes reuse the validated index instead of rereading every source row');
assert.equal(api.drilldown({ ...scope, skuId: 'SKU-A' }).summary.revenue, 0);
assert.equal(api.drilldown({ ...scope, skuId: 'SKU-B' }).summary.revenue, -4);
assert.equal(api.drilldown({ ...scope, skuId: 'SKU-C' }).summary.revenue, null);
assert.equal(api.drilldown({ ...scope, skuId: 'SKU-A' }).summary.budget, null, 'Caching never allocates project PD to SKU');

data.npiSkuRecords.push(record('new-row', 'SKU-D', 9));
assert.equal(api.drilldown(scope).summary.revenue, 5); assert.ok(categoryReads > coldReads, 'Array-length changes invalidate source membership');
let lastReads = categoryReads;
data.npiSkuRecords = [record('replacement', 'SKU-E', 7), ...data.npiSkuRecords.slice(1)];
assert.equal(api.drilldown(scope).summary.revenue, 12); assert.ok(categoryReads > lastReads, 'Same-length array replacement invalidates the index');

data.investments = [{ id: 'replacement-spend', productId: 'Project-Key', period: 2026, amount: -3, source: [source('replacement-spend')] }];
assert.equal(api.drilldown(scope).summary.budget, -3, 'Investment-array replacement preserves signed values and evidence');
assert.equal(api.drilldown(scope).summary.source.budget[0].cell, 'replacement-spend');
data.prelaunchCases.push({ id: 'Project-Key', projectId: 'Project-Key', name: 'Alpha family', category: 'Headsets', launchYear: 2026, launchYearRevenue: 40, revenue: 120, sourceByMetric: { revenue: [source('annual-plan')] } });
assert.equal(api.drilldown(scope).estimateSeries.find(point => point.period === 2026).value, 40, 'Plan-array growth invalidates independently of tracker rows');
data.npiValues.push({ id: 'Project-Key', roi: 2.5, source: [source('source-case')] });
assert.equal(api.drilldown(scope).economics.sourceReturnMultiple, 2.5, 'Cached source cases refresh with their source array');

data.products.push(product('duplicate-group', 'Alpha family'));
assert.equal(api.drilldown(scope).coverage.invalidScope, true, 'New ambiguous group mappings never reuse a formerly valid join');
assert.equal(api.drilldown(scope).economics.sourceInvestment, null, 'An invalid scope cannot retain stale investment');
data.products = data.products.filter(row => row.id !== 'duplicate-group');
assert.equal(api.drilldown(scope).coverage.invalidScope, false);
data.projects = [{ ...data.projects[0], name: 'Beta family' }];
assert.equal(api.drilldown(scope).coverage.invalidScope, true, 'Changed project metadata triggers a fresh conflict check');
data.projects = [{ ...data.projects[0], name: 'Alpha family' }];
assert.equal(api.drilldown(scope).coverage.invalidScope, false);

// Snapshot replacement must reset membership even when every array is reused.
lastReads = categoryReads; window.HX_DATA = { ...data };
assert.equal(api.drilldown(scope).summary.revenue, 12); assert.ok(categoryReads > lastReads);
// In-place metadata edits are an intentional escape hatch for immutable imports.
window.HX_DATA.projects[0].name = 'Beta family'; api.invalidateCache();
assert.equal(api.drilldown(scope).coverage.invalidScope, true, 'Explicit invalidation revalidates in-place metadata changes');
window.HX_DATA.projects[0].name = 'Alpha family'; api.invalidateCache(window.HX_DATA);
assert.equal(api.drilldown(scope).summary.revenue, 12);

console.log('Blueprint index cache: warm validation reuse, exact result parity, signed/zero/missing facts, array and snapshot invalidation, ambiguous joins, independent source plans/cases and explicit invalidation passed.');
