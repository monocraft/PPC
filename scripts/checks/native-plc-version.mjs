import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../../public/js/master-model.js';
import '../../public/js/date-precision.js';

const model = globalThis.PortfolioMasterModel, precision = globalThis.PortfolioDatePrecision;
const plain = value => JSON.parse(JSON.stringify(value));
const oldAt = '2026-10-14T16:00:00.000Z', editAt = '2026-10-15T01:00:00.000Z';
const manual = (value = '2028-03-01') => ({ value, sourceType: 'local', changedAt: oldAt, observedAt: oldAt, raw: value, source: { kind: 'manual' } });
const legacy = { fields: Object.fromEntries(model.DATE_FIELDS.map(field => [field, manual()])) };
legacy.fields.endManufacturingDate = manual('2030-03-01');
const seed = plc => ({ id: 'native-date-fixture', name: 'Synthetic headset', generalAvailabilityDate: '2028-03-01', endManufacturingDate: '2030-03-01', specs: [], partSkus: [], variantGroups: [], ...(plc === undefined ? {} : { plc }) });
const app = fs.readFileSync(new URL('../../public/js/app.js', import.meta.url), 'utf8');
const start = app.indexOf('function updateProductMilestone('), end = app.indexOf('\nfunction renderSplitProduct()', start);
assert(start >= 0 && end > start, 'Exercise the actual native milestone writer.');

function editor(input = seed()) {
  const product = structuredClone(input), portfolio = {}, writes = [];
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [editAt])); } }
  const context = vm.createContext({
    Date: FixedDate, PortfolioMasterModel: model, PortfolioDatePrecision: precision, portfolio,
    selectedProduct: () => product,
    updateProduct(id, patch, render) { assert.equal(id, product.id); assert.equal(render, false); writes.push(plain(patch)); Object.assign(product, plain(patch)); },
  });
  vm.runInContext(app.slice(start, end), context);
  return { product, portfolio, writes, edit: (field, value, period) => context.updateProductMilestone(product.id, field, value, period) };
}

for (const field of model.DATE_FIELDS) {
  const ui = editor();
  assert.equal(ui.edit(field, '2028-04-01'), true);
  assert.equal(ui.product.plc.version, 1, `First ${field} edit creates versioned evidence.`);
  assert.equal(model.productValues(ui.product).plc.version, 1, 'The real writer output passes the shared model.');
  assert.deepEqual(ui.product.plc.fields[field], { ...manual('2028-04-01'), changedAt: editAt, observedAt: editAt });
  assert.deepEqual(plain(ui.portfolio.dateLocalEdits[ui.product.id][field]), { at: editAt, value: '2028-04-01', source: 'local' });
  const before = JSON.stringify([ui.product, ui.portfolio]);
  assert.equal(ui.edit(field, '2028-04-01'), false);
  assert.equal(JSON.stringify([ui.product, ui.portfolio]), before, 'Repeated exact dates preserve evidence and edit clocks.');
  assert.equal(ui.writes.length, 1);
}

const quarter = precision.parseQuarter('Q2 2028'), quarterUi = editor(seed(null));
assert.equal(quarterUi.edit('ffsDate', quarter.start, quarter), true);
assert.equal(quarterUi.product.plc.version, 1, 'A first quarter edit also initializes the container.');
assert.deepEqual(quarterUi.product.plc.fields.ffsDate.period, quarter);
assert.equal(quarterUi.product.plc.fields.ffsDate.raw, 'Q2 2028');
assert.equal(precision.displayDate(quarterUi.product, 'ffsDate'), 'Q2 2028');
assert.deepEqual(model.productValues(quarterUi.product).plc, quarterUi.product.plc);
const quarterBefore = JSON.stringify([quarterUi.product, quarterUi.portfolio]);
assert.equal(quarterUi.edit('ffsDate', quarter.start, quarter), false);
assert.equal(JSON.stringify([quarterUi.product, quarterUi.portfolio]), quarterBefore, 'Repeated quarter confirmation preserves its clocks.');
assert.equal(quarterUi.edit('ffsDate', quarter.start), true, 'A verified exact date can replace quarter precision at the same anchor.');
assert.equal(quarterUi.product.plc.fields.ffsDate.period, undefined);
assert.equal(quarterUi.product.plc.fields.ffsDate.raw, quarter.start);

const originalLegacy = structuredClone(legacy), normalized = model.plcMetadata(legacy);
assert.deepEqual(legacy, originalLegacy, 'Reading old native evidence never mutates input.');
assert.deepEqual(normalized, { version: 1, ...legacy }, 'Legacy normalization adds only version1.');
assert.deepEqual(model.plcMetadata(normalized), normalized, 'Normalization is idempotent.');
normalized.fields.ffsDate.raw = 'changed detached result';
assert.deepEqual(legacy, originalLegacy, 'Normalized evidence is detached from the caller.');
assert.deepEqual(model.plcMetadata({ fields: { ffsDate: manual('') } }), { version: 1, fields: { ffsDate: manual('') } }, 'Legacy native clearing is supported.');

const existingUi = editor(seed(legacy));
assert.equal(existingUi.edit('ffsDate', quarter.start, quarter), true);
assert.equal(existingUi.product.plc.version, 1, 'An old exact-date container is normalized before adding quarter evidence.');
assert.deepEqual(existingUi.product.plc.fields.globalAnnouncementDate, legacy.fields.globalAnnouncementDate, 'Other field evidence and old clocks are preserved.');
assert.deepEqual(existingUi.product.plc.fields.ffsDate.period, quarter);
assert.equal(model.productValues(existingUi.product).plc.version, 1);
assert.deepEqual(legacy, originalLegacy);

const oldQuarter = { fields: { ffsDate: { ...manual(quarter.start), raw: quarter.label, period: quarter } } };
const oldQuarterBefore = structuredClone(oldQuarter);
assert.deepEqual(model.plcMetadata(oldQuarter), { version: 1, ...oldQuarter }, 'A canonical old native quarter is recognized without rewriting its evidence.');
const oldQuarterUi = editor({ ...seed(oldQuarter), ffsDate: quarter.start });
assert.equal(oldQuarterUi.edit('globalAnnouncementDate', '2028-05-01'), true);
assert.equal(oldQuarterUi.product.plc.version, 1);
assert.deepEqual(oldQuarterUi.product.plc.fields.ffsDate, oldQuarter.fields.ffsDate, 'Editing another date preserves the old quarter interval, label and clocks.');
assert.deepEqual(oldQuarter, oldQuarterBefore);

const imported = { version: 1, fields: { ffsDate: { value: '2028-04-01', period: quarter, scope: { catalogue: 'WW EN' }, sourceType: 'import', source: { kind: 'plc', sheet: 'Synthetic' } } }, history: [{ field: 'ffsDate', at: oldAt }] };
const importBefore = structuredClone(imported), importedUi = editor(seed(imported));
assert.equal(importedUi.edit('ffsDate', '2028-04-09'), true);
assert.deepEqual(importedUi.product.plc.fields.ffsDate.scope, imported.fields.ffsDate.scope, 'Existing source scope survives a native override.');
assert.deepEqual(importedUi.product.plc.history, imported.history);
assert.equal(importedUi.product.plc.fields.ffsDate.period, undefined);
assert.deepEqual(imported, importBefore, 'A versioned import remains untouched outside the draft.');
assert.deepEqual(model.plcMetadata(imported), imported, 'Existing version1 quarter/import evidence is not rewritten.');

const unsupported = [
  ['explicit version2', { version: 2, ...legacy }],
  ['explicit null version', { ...legacy, version: null }],
  ['string version', { ...legacy, version: '1' }],
  ['own undefined version', { ...legacy, version: undefined }],
  ['empty fields', { fields: {} }],
  ['array fields', { fields: [] }],
  ['unknown container key', { ...legacy, history: [] }],
  ['unknown date field', { fields: { unrelatedDate: manual() } }],
  ['imported field', { fields: { ffsDate: { ...manual(), sourceType: 'import' } } }],
  ['nonmanual source', { fields: { ffsDate: { ...manual(), source: { kind: 'plc' } } } }],
  ['extra source key', { fields: { ffsDate: { ...manual(), source: { kind: 'manual', file: 'unknown' } } } }],
  ['extra evidence key', { fields: { ffsDate: { ...manual(), unrecognized: true } } }],
  ['unknown quarter key', { fields: { ffsDate: { ...manual(quarter.start), raw: quarter.label, period: { ...quarter, unknown: true } } } }],
  ['fiscal quarter', { fields: { ffsDate: { ...manual(quarter.start), raw: quarter.label, period: { ...quarter, basis: 'fiscal' } } } }],
  ['wrong quarter anchor', { fields: { ffsDate: { ...manual('2028-04-02'), raw: quarter.label, period: quarter } } }],
  ['wrong quarter end', { fields: { ffsDate: { ...manual(quarter.start), raw: quarter.label, period: { ...quarter, end: '2028-06-29' } } } }],
  ['wrong quarter label', { fields: { ffsDate: { ...manual(quarter.start), raw: quarter.label, period: { ...quarter, label: 'Q3 2028' } } } }],
  ['quarter raw mismatch', { fields: { ffsDate: { ...manual(quarter.start), period: quarter } } }],
  ['string quarter number', { fields: { ffsDate: { ...manual(quarter.start), raw: quarter.label, period: { ...quarter, quarter: '2' } } } }],
  ['invalid calendar date', { fields: { ffsDate: manual('2028-02-30') } }],
  ['unnormalized TBD', { fields: { ffsDate: manual('TBD') } }],
  ['raw mismatch', { fields: { ffsDate: { ...manual(), raw: 'different' } } }],
  ['different observation clock', { fields: { ffsDate: { ...manual(), observedAt: editAt } } }],
  ['invalid calendar clock', { fields: { ffsDate: { ...manual(), changedAt: '2026-02-30T00:00:00.000Z', observedAt: '2026-02-30T00:00:00.000Z' } } }],
  ['noncanonical clock', { fields: { ffsDate: { ...manual(), changedAt: '2026-10-14T16:00:00Z', observedAt: '2026-10-14T16:00:00Z' } } }],
];
for (const [label, value] of unsupported) {
  assert.throws(() => model.plcMetadata(value), /Unsupported PLC evidence version/, `Do not guess a version for ${label}.`);
  const ui = editor(seed(value)), before = JSON.stringify(ui.product);
  assert.throws(() => ui.edit('ffsDate', '2029-04-01'), /Unsupported PLC evidence version/, `The writer also rejects ${label}.`);
  assert.equal(JSON.stringify(ui.product), before, 'Rejected evidence cannot partially mutate the date.');
  assert.equal(ui.writes.length, 0);
  assert.deepEqual(ui.portfolio, {});
}
for (const key of ['__proto__', 'constructor', 'prototype']) {
  assert.throws(() => model.plcMetadata(JSON.parse(`{"version":1,"${key}":{"unsafe":true}}`)), /Invalid PLC evidence key/);
}

const manifest = { version: 4, categories: [{ id: 'synthetic', board: { lanes: [{ id: 'wired' }], products: [{ ...seed(legacy), laneId: 'wired' }] } }] };
const originalManifest = structuredClone(manifest), base = model.snapshot(manifest).products[0];
const saved = model.mergeChanges(manifest, [{ productId: base.productId, base: base.values, baseRevisions: base.revisions, patch: { ffsDate: existingUi.product.ffsDate, plc: existingUi.product.plc } }], { now: editAt, actor: 'Synthetic regression' });
assert.equal(saved.conflicts.length, 0, 'A native quarter edit of a legacy product can complete the shared merge.');
const roundtrip = model.snapshot(saved.manifest).products[0].values;
assert.equal(roundtrip.plc.version, 1);
assert.deepEqual(roundtrip.plc.fields.ffsDate.period, quarter);
assert.deepEqual(roundtrip.plc.fields.globalAnnouncementDate, legacy.fields.globalAnnouncementDate);
assert.deepEqual(manifest, originalManifest, 'Shared normalization does not mutate the loaded legacy manifest.');

console.log('Native PLC version checks passed: all six first exact edits, first quarter edit, legacy-to-quarter shared roundtrip, no-op clocks, evidence preservation and strict malformed/nonmanual/version guards.');
