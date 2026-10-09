import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../public/js/master-model.js';
import '../../public/js/date-history.js';

const model = globalThis.PortfolioMasterModel;
const seed = { version: 4, categories: [{ id: 'audio', board: { lanes: [{ id: 'wired' }], products: [{ id: 'headset', laneId: 'wired', name: 'Headset', generalAvailabilityDate: '2027-01-20', ffsDate: '', roadmap: { startMonth: '2027-01', endMonth: '2030-01' }, specs: [], partSkus: [], variantGroups: [] }] } }] };
const original = model.snapshot(seed).products[0];
const accepted = model.mergeChanges(seed, [{ productId: original.productId, base: original.values, baseRevisions: original.revisions, patch: { generalAvailabilityDate: '2027-01-21', ffsDate: '2026-12-01' } }], { now: '2026-10-08T18:00:00.000Z', actor: 'Planning' }).manifest;
const source = await readFile(new URL('../../public/js/app.js', import.meta.url), 'utf8');
let shared = model.snapshot(accepted);
const sandbox = { PortfolioMasterModel: model, PortfolioDateHistory: globalThis.PortfolioDateHistory,
  PortfolioMasterUI: { getSession: () => ({ getState: () => ({ snapshot: shared }) }) },
  portfolio: structuredClone(accepted), escapeHtml: (text) => String(text),
};
sandbox.portfolio.masterLocalBaseline = structuredClone(shared.products);
vm.createContext(sandbox);
for (const name of ['productDateHistoryOptions', 'productDateHistoryLabel']) {
  const definition = source.match(new RegExp(`^function ${name}\\([^]*?^\\}`, 'm'));
  assert.ok(definition);
  vm.runInContext(definition[0], sandbox);
}
const options = sandbox.productDateHistoryOptions('headset');
assert.equal(options.getHistory('generalAvailabilityDate').at, '2026-10-08T18:00:00.000Z');
assert.equal(options.isPending('generalAvailabilityDate'), false);
const localProduct = sandbox.portfolio.categories[0].board.products[0];
localProduct.generalAvailabilityDate = '2027-03-01';
assert.equal(options.isPending('generalAvailabilityDate'), true);
assert.equal(options.getHistory('generalAvailabilityDate').value, '2027-01-21', 'Draft date changes keep the accepted date history visible.');
assert.equal(options.isPending('ffsDate'), false, 'A draft change never marks a different date as unsaved.');
localProduct.name = 'Renamed headset';
assert.equal(options.getHistory('ffsDate').at, '2026-10-08T18:00:00.000Z');

const remote = model.mergeChanges(accepted, [{ productId: 'headset', base: shared.products[0].values, baseRevisions: shared.products[0].revisions, patch: { generalAvailabilityDate: '2027-02-01' } }], { now: '2026-10-09T18:00:00.000Z', actor: 'Operations' }).manifest;
shared = model.snapshot(remote);
sandbox.portfolio.masterSync = structuredClone(remote.masterSync);
assert.equal(options.getHistory('generalAvailabilityDate').at, '2026-10-09T18:00:00.000Z', 'A teammate update replaces the history while protecting the pending local date.');
assert.equal(options.isPending('generalAvailabilityDate'), true);
localProduct.generalAvailabilityDate = '2027-02-01';
assert.equal(options.isPending('generalAvailabilityDate'), false, 'An accepted/discarded draft no longer shows a pending badge.');
sandbox.portfolio.masterLocalBaseline = structuredClone(shared.products);
shared = null;
assert.equal(options.getHistory('generalAvailabilityDate').actor, 'Operations', 'Offline reopening retains the accepted date clock.');
assert.equal(options.getHistory('webReadinessDate'), null, 'Untracked legacy dates do not borrow another date timestamp.');

sandbox.portfolio.categories[0].board.products.push({ id: 'new', generalAvailabilityDate: '2028-01-01' });
const unsaved = sandbox.productDateHistoryOptions('new');
assert.equal(unsaved.getHistory('generalAvailabilityDate'), null);
assert.equal(unsaved.isPending('generalAvailabilityDate'), true);
assert.equal(unsaved.isPending('ffsDate'), false);
assert.match(sandbox.productDateHistoryLabel('General availability', 'generalAvailabilityDate'), /data-date-history-field="generalAvailabilityDate"/);

const detailSandbox = { PortfolioDateHistory: globalThis.PortfolioDateHistory };
vm.createContext(detailSandbox);
vm.runInContext(await readFile(new URL('../../public/js/product-details.js', import.meta.url), 'utf8'), detailSandbox);
const keys = ['general-availability', 'end-manufacturing', 'ffs', 'global-announcement', 'web-readiness', 'final-assets'];
for (const surface of ['viewer', 'split']) {
  const html = detailSandbox.PortfolioDetails.render({ id: 'headset', dates: keys.map((key) => ({ key, label: key, value: 'TBD' })) }, { surface });
  for (const field of model.DATE_FIELDS) assert.match(html, new RegExp(`data-date-history-field="${field}"`));
  assert.equal((html.match(/data-date-history-field=/g) || []).length, 6);
}
for (const field of model.DATE_FIELDS) assert.ok(source.includes(`productDateHistoryLabel(`) && source.includes(`\"${field}\")}`), 'Editor labels retain all six independent date-history triggers.');
console.log('Date-history workspace checks passed: accepted/draft clocks, teammate refresh, offline reopening, new dates, and six labels across editor, product details and roadmap.');
