import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const code = await readFile(new URL('../../public/blueprint/product-connectivity.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(code, { window }, { filename: 'blueprint/product-connectivity.js' });
const api = window.HX_CONNECTIVITY;
const ref = (cell, value) => ({ sheet: 'Synthetic connectivity fixture', cell, value });
const group = (id, name, connectivity, revenue, grossProfit) => ({ id, name, category: 'Headsets', connectivity, connectivitySource: [ref(id, connectivity)], revenueByYear: { 2025: revenue }, gmByYear: { 2025: grossProfit }, unitsByYear: { 2025: revenue === null ? null : revenue / 10 } });
const definition = (id, extra = {}) => ({ id, name: 'Synthetic group', category: 'Headsets', codeName: id, launchYear: 2025, ...extra });
const investment = (productId, connectivity, suffix = 'a', extra = {}) => ({ productId, name: 'Synthetic group', category: 'Headsets', connectivity, connectivitySource: [ref(`${productId}-${suffix}`, connectivity)], amount: 500, period: 2025, ...extra });
const data = {
  products: [group('g-wired', 'Wireless word in the name', 'Wired', 1000, 100), group('g-wireless', 'Wired word in the name', 'WL', 10, 5), group('g-both', 'Hybrid item', 'Both', 0, 0), group('g-na', 'Wireless 2', 'NA', null, null)],
  projects: ['p-wired', 'p-wireless', 'p-both', 'p-conflict', 'p-partial', 'p-na', 'p-legacy'].map(id => definition(id)),
  investments: [investment('p-wired', 'Wired', 'a'), investment('p-wired', 'Wired', 'b'), investment('p-wireless', 'WL'), investment('p-both', 'Wired / Wireless'), investment('p-conflict', 'Wired'), investment('p-conflict', 'WL', 'b'), investment('p-partial', 'Wired'), investment('p-partial', null, 'b'), investment('p-na', 'NA'), { productId: 'p-legacy', name: 'Synthetic group', category: 'Headsets', period: 2025, amount: 0 }],
  npiSkuRecords: [{ projectId: 'p-wired', skuId: 'SAME#ABA', category: 'Headsets', revenue: 1 }, { projectId: 'p-wireless', skuId: 'SAME#ABA', category: 'Headsets', connectivity: 'Wireless', connectivitySource: [ref('sku-other-project', 'Wireless')] }]
};
const children = data.products.map(product => ({ id: product.id, groupId: product.id, level: 'group', name: product.name, category: product.category, revenue: product.revenueByYear[2025], grossProfit: product.gmByYear[2025], units: product.unitsByYear[2025] }));
const project = id => ({ id, projectId: id, groupId: 'g-wired', level: 'project', category: 'Headsets' });
const sku = (projectId, skuId = 'SAME#ABA') => ({ id: skuId, skuId, projectId, groupId: 'g-wired', level: 'sku', category: 'Headsets' });
const ids = items => Array.from(items, item => item.id);
const plain = value => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const before = JSON.stringify(data); freeze(data); freeze(children);

assert.equal(api.profile(data, children[0]).value, 'wired', 'Names never override explicit source metadata');
assert.equal(api.profile(data, children[1]).value, 'wireless', 'The verified WL source label is wireless');
assert.equal(api.profile(data, children[2]).value, 'both', 'Explicit hybrid metadata has its own bucket');
assert.equal(api.profile(data, children[3]).value, 'unclassified', 'NA remains visible as unclassified');
assert.equal(api.profile(data, children[0]).source[0].cell, 'g-wired', 'Source connectivity evidence is retained separately from financial evidence');
assert.equal(api.profile(data, { id: 'not-a-source-id', name: 'Wireless', level: 'group' }).value, 'unclassified');
assert.equal(api.profile(data, { ...children[0], category: 'Mice' }).status, 'ambiguous', 'A mismatched source category cannot choose the same group ID');
assert.equal(api.profile(data, { id: 'source-unmapped', level: 'group' }).value, 'unclassified');

assert.equal(api.profile(data, project('p-wired')).value, 'wired');
assert.equal(api.profile(data, project('p-wired')).coverage.recordCount, 2, 'Repeated spend schedule rows give evidence, not duplicate projects');
assert.equal(api.profile(data, project('p-wireless')).value, 'wireless');
assert.equal(api.profile(data, project('p-both')).value, 'both');
const conflict = api.profile(data, project('p-conflict'));
assert.equal(conflict.value, 'unclassified'); assert.equal(conflict.status, 'conflict'); assert.equal(conflict.coverage.conflict, true);
assert.match(conflict.reason, /not evidence of a hybrid/, 'Mixed source classifications must never be relabelled Both');
const incomplete = api.profile(data, project('p-partial'));
assert.equal(incomplete.value, 'unclassified'); assert.equal(incomplete.status, 'incomplete'); assert.equal(incomplete.coverage.classifiedRecordCount, 1); assert.equal(incomplete.coverage.unclassifiedRecordCount, 1);
assert.equal(api.profile(data, project('p-na')).value, 'unclassified');
assert.equal(api.profile(data, project('p-legacy')).coverage.needsReimport, true, 'Legacy saved investment records disclose dropped connectivity metadata');
assert.equal(api.profile(data, project('missing')).value, 'unclassified', 'No group connectivity is inherited by an unmatched project');
const sourceMismatch = structuredClone(data); sourceMismatch.investments[0].category = 'Mice';
assert.equal(api.profile(sourceMismatch, project('p-wired')).status, 'ambiguous');
const ambiguous = structuredClone(data); ambiguous.projects.push(definition(' P-WIRED ', { category: 'Mice' }));
assert.equal(api.profile(ambiguous, project('p-wired')).status, 'ambiguous', 'A normalized project-key collision rejects ambiguous source metadata');
const alias = structuredClone(data); alias.projects.push({ ...alias.projects[0], id: ' P-WIRED ' });
assert.equal(api.profile(alias, project('p-wired')).value, 'wired', 'Identical case/spacing source aliases retain one consistent identity');

const sourceSku = api.profile(data, sku('p-wired'));
assert.equal(sourceSku.value, 'unclassified'); assert.equal(sourceSku.status, 'unavailable'); assert.equal(sourceSku.coverage.needsReimport, false, 'Reimport is not presented as a fix for connectivity missing from the source SKU grain');
assert.match(sourceSku.reason, /not allocated to SKUs/);
assert.equal(api.profile(data, sku('p-wireless')).value, 'wireless', 'An explicit future SKU metadata field is scoped to its own project');
assert.equal(api.profile(data, sku('p-wireless', 'same#aba')).value, 'unclassified', 'SKU matching remains exact, including suffix/case');
const skuMixed = structuredClone(data); skuMixed.npiSkuRecords.push({ ...skuMixed.npiSkuRecords[1], connectivity: 'Wired' });
assert.equal(api.profile(skuMixed, sku('p-wireless')).status, 'conflict');
const duplicateGroup = structuredClone(data); duplicateGroup.products.push({ ...duplicateGroup.products[0], connectivity: 'Wireless' });
assert.equal(api.profile(duplicateGroup, children[0]).status, 'ambiguous', 'An exact duplicate group ID never picks the first row');

assert.deepEqual(ids(api.filter(children, 'wired', data)), ['g-wired']);
assert.deepEqual(ids(api.filter(children, ['wired', 'wireless'], data)), ['g-wired', 'g-wireless'], 'Selecting two connectivity filters is an OR selection; the explicit Both cohort stays distinct');
assert.deepEqual(ids(api.filter(children, 'both', data)), ['g-both']);
assert.deepEqual(ids(api.filter(children, 'unclassified', data)), ['g-na']);
for (const selection of [null, [], 'all', ['wireless', 'all']]) assert.deepEqual(ids(api.filter(children, selection, data)), ids(children), 'All resets without dropping unknown classifications');
assert.deepEqual(ids(api.filter(children, ['invalid'], data)), [], 'An invalid filter must not silently expand to All');
assert.notEqual(api.filter(children, 'all', data), children, 'Filtering returns a new array');
assert.deepEqual(plain(api.options(data, children)), [{ value: 'all', label: 'All connections', count: 4 }, { value: 'wired', label: 'Wired', count: 1 }, { value: 'wireless', label: 'Wireless', count: 1 }, { value: 'both', label: 'Both', count: 1 }, { value: 'unclassified', label: 'Unclassified', count: 1 }]);
assert.equal(api.options(data, [children[0]]).length, 5, 'Zero-count hybrid and unknown cohorts remain discoverable');
assert.equal(api.options(data).find(option => option.value === 'all').count, 4, 'Default options describe source product groups');
assert.deepEqual(Array.from(api.cohorts(children, data), bucket => bucket.count), [1, 1, 1, 1]);
assert.equal(api.cohorts(children, data).reduce((total, bucket) => total + bucket.children.length, 0), children.length, 'Cohorts conserve every visible item exactly once');

assert.deepEqual(ids(api.sorting(children, { metric: 'revenue', direction: 'desc', period: 2025 }, data)), ['g-wired', 'g-wireless', 'g-both', 'g-na']);
assert.deepEqual(ids(api.sorting(children, { metric: 'revenue', direction: 'asc' }, data)), ['g-both', 'g-wireless', 'g-wired', 'g-na'], 'Missing figures remain last in both directions');
assert.deepEqual(ids(api.sorting(data.products, { metric: 'revenue', direction: 'desc', period: 2025 }, data)), ['g-wired', 'g-wireless', 'g-both', 'g-na'], 'Raw product annual maps support the explicit period');
assert.deepEqual(ids(api.sorting(children, { metric: 'grossMargin', direction: 'desc' }, data)), ['g-wireless', 'g-wired', 'g-both', 'g-na'], 'Margin uses GP/revenue; zero revenue is undefined');
const signed = [{ id: 'missing', revenue: null }, { id: 'negative', revenue: -4 }, { id: 'zero', revenue: 0 }, { id: 'numeric-string', revenue: '20' }, { id: 'zero-second', revenue: 0 }, { id: 'infinity', revenue: Infinity }];
assert.deepEqual(ids(api.sorting(signed, { metric: 'revenue', direction: 'asc' }, data)), ['negative', 'zero', 'zero-second', 'missing', 'numeric-string', 'infinity']);
assert.deepEqual(ids(api.sorting(signed, { metric: 'revenue', direction: 'desc' }, data)), ['zero', 'zero-second', 'negative', 'missing', 'numeric-string', 'infinity'], 'Signed values and stable ties retain exact source meaning');
assert.deepEqual(ids(api.sorting([{ ...children[0], revenue: null }, children[1]], { metric: 'revenue', direction: 'desc', period: 2025 }, data)), ['g-wireless', 'g-wired'], 'An explicit missing child value cannot fall through to parent/group finance');
assert.deepEqual(ids(api.sorting([sku('p-wired'), sku('p-wireless')], { metric: 'budget', direction: 'desc' }, data)), ['SAME#ABA', 'SAME#ABA'], 'Missing SKU investment remains stable instead of inheriting project cost');
assert.deepEqual(ids(api.sorting([{ id: 'ten', name: 'Item 10' }, { id: 'two', name: 'Item 2' }], { metric: 'name' }, data)), ['two', 'ten']);
assert.deepEqual(ids(api.sorting(children, { metric: 'connectivity', direction: 'desc' }, data)), ['g-both', 'g-wireless', 'g-wired', 'g-na']);
assert.deepEqual(ids(api.sorting(children, { metric: 'not-an-approved-metric' }, data)), ids(children));
assert.equal(api.sort, api.sorting);
assert.equal(JSON.stringify(data), before, 'Classification/filter/group/sort never mutate saved source data');

// Verify the import boundary with a small synthetic workbook. These are source
// metadata cells, not labels inferred from financial or product-name fields.
const analyticsCode = await readFile(new URL('../../public/blueprint/analytics.js', import.meta.url), 'utf8');
const analyticsWindow = {}; vm.runInNewContext(analyticsCode, { window: analyticsWindow });
const cells = values => Object.fromEntries(Object.entries(values).map(([cell, value]) => [cell, { value }]));
const imported = analyticsWindow.HX_ANALYTICS.normalizeWorkbook({ source: { name: 'Synthetic connectivity import' }, sheets: {
  Cat_View: cells({ A1: 'Category', D1: 'GroupName', G1: 'Connectivity', M1: '2025 Rev', A2: 'Headsets', D2: 'Synthetic group', G2: 'Wired', M2: 100 }),
  Combined_Products: cells({ A1: 'Budget_Key', B1: 'Category', D1: 'GroupName', E1: 'CodeName', A2: 'Synthetic-project', B2: 'Headsets', D2: 'Synthetic group', E2: 'Synthetic' }),
  Budget_UnPivot: cells({ A1: 'Budget_Key', B1: 'Category', D1: 'GroupName', I1: 'Connectivity', J1: 'FY', K1: 'Spend$', A2: 'Synthetic-project', B2: 'Headsets', D2: 'Synthetic group', I2: 'WL', J2: 2025, K2: 50 })
} });
assert.equal(api.profile(imported, { id: 'product-2', level: 'group' }).value, 'wired');
assert.equal(api.profile(imported, { id: 'product-2', level: 'group' }).source[0]?.cell, 'G2', 'Import preserves the exact Cat_View connectivity source cell');
assert.equal(api.profile(imported, { id: 'Synthetic-project', projectId: 'Synthetic-project', level: 'project', category: 'Headsets' }).value, 'wireless');
assert.equal(api.profile(imported, { id: 'Synthetic-project', projectId: 'Synthetic-project', level: 'project', category: 'Headsets' }).source[0]?.cell, 'I2', 'Import preserves the exact Budget_UnPivot connectivity source cell');

console.log('Blueprint connectivity: source metadata, unknown/ambiguous coverage, exact SKU scope, filtering/cohort conservation, stable financial sorting, import evidence, and immutability passed.');
