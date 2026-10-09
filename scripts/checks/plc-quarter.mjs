import assert from 'node:assert/strict';
import '../../public/js/date-precision.js';
import '../../public/js/portfolio-model.js';
import '../../public/js/master-model.js';
import '../../public/js/package-codec.js';
import '../../public/js/plc-import.js';

const importer = globalThis.PLCImporter, precision = globalThis.PortfolioDatePrecision, master = globalThis.PortfolioMasterModel;
const clone = value => structuredClone(value);
const firstAt = '2026-10-09T16:00:00.000Z', secondAt = '2026-10-23T16:00:00.000Z';
const seed = { version: 4, categories: [{ id: 'mice', board: { lanes: [{ id: 'wired' }], products: [{ id: 'quarter-fixture', name: 'Synthetic quarter mouse', laneId: 'wired', ffsDate: '', generalAvailabilityDate: '2028-08-18', roadmap: { startMonth: '2028-08', endMonth: '2029-12' }, specs: [], partSkus: [], variantGroups: [] }] } }] };
const product = portfolio => portfolio.categories[0].board.products[0];
function dataset(raw = 'Q2 2028', { field = 'ffsDate', reportDate = '2026-10-08', fingerprint = 'quarter-synthetic-one' } = {}) {
  return { metadata: { fingerprint, fileName: 'Synthetic quarter.xlsx', reportDate, reportDateBasis: 'Explicit workbook report date' }, rows: [{ key: 'quarter-source', productId: 'quarter-fixture', name: 'Synthetic quarter mouse', categoryId: 'mice', reportDate, dates: { [field]: { ...importer.parseDate(raw, { quarterBasis: 'calendar' }), source: { sheet: 'Synthetic current', cell: 'F4', authoritativeCurrentFfs: field === 'ffsDate' } } }, sources: [], milestones: {}, data: {} }], diagnostics: [] };
}
const plan = (portfolio, data = dataset()) => importer.buildPlan(data, portfolio, { reportDate: '2026-10-09', reportDateBasis: 'Import date' });

for (const [raw, anchor, label] of [['Q1 2028', '2028-01-01', 'Q1 2028'], ['calendar Q2 2028', '2028-04-01', 'Q2 2028'], ["Q2/'28", '2028-04-01', 'Q2 2028'], ['2028 Q3', '2028-07-01', 'Q3 2028'], ["PM adjusted\r\nFFS to Q4/'27", '2027-10-01', 'Q4 2027']]) {
  const parsed = importer.parseDate(raw, { quarterBasis: 'calendar' });
  assert.equal(parsed.kind, 'quarter'); assert.equal(parsed.value, anchor); assert.equal(importer.dateLabel(parsed.value, parsed.period), label);
  assert.deepEqual(parsed.period, precision.parseQuarter(raw), 'Importer and display helper agree on quarter boundaries and labels.');
}
for (const raw of ['FY Q2 2028', 'Q2 FY2028', 'Q4 2027 to Q3 2028?', 'Q2 2028 or Q3 2028', 'Risk adjusted to Q2 2028', 'Q5 2028', 'Q2', 'Q2 2028?']) assert.equal(importer.parseDate(raw, { quarterBasis: 'calendar' }).value, '', `${raw} cannot invent a quarter anchor.`);
assert.equal(importer.parseDate('Q2 2028').value, '', 'A generic unspecified quarter still requires an explicit calendar basis.');

const preview = plan(seed);
assert.equal(preview.items[0].fields[0].status, 'update'); assert.equal(preview.summary.fields.ffsDate.quarter, 1);
const applied = importer.applyPlan(seed, preview, { now: firstAt });
assert.equal(product(applied.portfolio).ffsDate, '2028-04-01'); assert.equal(precision.displayDate(product(applied.portfolio), 'ffsDate'), 'Q2 2028');
assert.equal(product(applied.portfolio).generalAvailabilityDate, '2028-08-18'); assert.equal(product(applied.portfolio).roadmap.startMonth, '2028-08', 'FFS quarter never moves the GA roadmap start.');
const evidence = product(applied.portfolio).plc.fields.ffsDate;
assert.equal(evidence.changedAt, firstAt); assert.equal(evidence.observedAt, firstAt); assert.equal(evidence.period.end, '2028-06-30');
const age = importer.getFieldAge(product(applied.portfolio), 'ffsDate', '2026-10-23');
assert.equal(age.displayValue, 'Q2 2028'); assert.equal(age.changeAgeDays, 14); assert.equal(age.observedAgeDays, 14);
const duplicate = importer.applyPlan(applied.portfolio, plan(applied.portfolio), { now: secondAt });
assert.equal(duplicate.summary.duplicate, true); assert.equal(JSON.stringify(duplicate.portfolio), JSON.stringify(applied.portfolio), 'A re-drop cannot refresh quarter aging or mutate persisted evidence.');

const exactSeed = clone(seed); product(exactSeed).ffsDate = '2028-05-14';
const downgrade = plan(exactSeed);
assert.equal(downgrade.items[0].fields[0].status, 'review', 'A quarter cannot silently replace a known exact day.');
const deferred = importer.applyPlan(exactSeed, downgrade, { now: firstAt, deferredFields: { 'quarter-source': ['ffsDate'] } });
assert.equal(product(deferred.portfolio).ffsDate, '2028-05-14'); assert.equal(deferred.portfolio.plcReview.entries[0].fields[0], 'ffsDate');
const selected = importer.applyPlan(exactSeed, downgrade, { now: firstAt, resolutions: { 'quarter-source': { ffsDate: { value: '2028-04-01', period: precision.parseQuarter('Q2 2028') } } } });
assert.equal(precision.displayDate(product(selected.portfolio), 'ffsDate'), 'Q2 2028');
assert.equal(selected.portfolio.plcReview.entries.length, 0);
assert.throws(() => importer.applyPlan(exactSeed, downgrade, { now: firstAt, resolutions: { 'quarter-source': { ffsDate: { value: '2028-04-02', period: precision.parseQuarter('Q2 2028') } } } }), /validated calendar quarter/);

const exactData = dataset('2028-04-01', { reportDate: '2026-10-22', fingerprint: 'quarter-upgrade-exact' });
const upgraded = importer.applyPlan(applied.portfolio, plan(applied.portfolio, exactData), { now: secondAt });
assert.equal(product(upgraded.portfolio).ffsDate, '2028-04-01'); assert.equal(precision.currentPeriod(product(upgraded.portfolio), 'ffsDate'), null);
assert.equal(upgraded.summary.datesUpdated, 1, 'Resolving quarter precision to an exact day is a semantic milestone change even at the same placement.');
assert.equal(product(upgraded.portfolio).plc.fields.ffsDate.changedAt, secondAt); assert.equal(upgraded.history[0].beforePeriod.label, 'Q2 2028'); assert.equal(upgraded.history[0].afterPeriod, null);

const gaSeed = clone(seed); product(gaSeed).generalAvailabilityDate = '';
const gaApplied = importer.applyPlan(gaSeed, plan(gaSeed, dataset('Q2 2028', { field: 'generalAvailabilityDate' })), { now: firstAt });
assert.equal(product(gaApplied.portfolio).roadmap.startMonth, '2028-04'); assert.equal(precision.displayDate(product(gaApplied.portfolio), 'generalAvailabilityDate'), 'Q2 2028');
const snapshots = master.snapshot(gaApplied.portfolio);
assert.equal(snapshots.products[0].values.plc.fields.generalAvailabilityDate.period.label, 'Q2 2028', 'Existing shared-master schema retains precision and source clocks.');
const codec = globalThis.PortfolioPackage, key = codec.generateKey();
const zip = codec.createZip([{ name: 'portfolio.json', data: new TextEncoder().encode(JSON.stringify(gaApplied.portfolio)) }]);
const roundtrip = JSON.parse(new TextDecoder().decode(codec.readZip(await codec.decrypt(await codec.encrypt(zip, key), key)).get('portfolio.json')));
assert.deepEqual(roundtrip, gaApplied.portfolio, 'Encrypted package round trips retain quarter precision, date aging, and independent milestone anchors.');

const local = clone(applied.portfolio), before = importer.snapshotDateValues(local);
delete product(local).plc.fields.ffsDate.period;
Object.assign(product(local).plc.fields.ffsDate, { sourceType: 'local', changedAt: secondAt, observedAt: secondAt });
importer.recordDateChanges(before, local, { now: secondAt });
assert.equal(local.dateLocalEdits['quarter-fixture'].ffsDate.at, secondAt); assert.equal(product(local).plc.fields.ffsDate.supersededAt, undefined);
assert.equal(precision.displayDate(product(local), 'ffsDate'), '2028-04-01');
console.log('PLC quarter checks passed: calendar boundaries, uncertainty guards, precise display with placement anchors, independent GA/FFS, deferred review, semantic precision timestamps, duplicate aging, shared model and encrypted package round trips.');
