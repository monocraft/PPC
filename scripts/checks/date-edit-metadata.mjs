import assert from 'node:assert/strict';
import '../../public/js/master-model.js';
import '../../public/js/product-merge.js';
import '../../public/js/package-codec.js';

const model = globalThis.PortfolioMasterModel, merge = globalThis.PortfolioProductMerge, codec = globalThis.PortfolioPackage;
const copy = (value) => structuredClone(value), plain = (value) => JSON.parse(JSON.stringify(value));
const dates = (manifest, id = 'one') => plain(model.dateEditsForProduct(manifest, id));
const product = (manifest, id = 'one') => manifest.categories[0].board.products.find((item) => item.id === id);
const seed = { version: 4, categories: [{ id: 'audio', board: { lanes: [{ id: 'wired' }], products: [
  { id: 'one', laneId: 'wired', name: 'Headset', generalAvailabilityDate: '2027-01-20', endManufacturingDate: '2030-09-30', roadmap: { startMonth: '2027-01', endMonth: '2030-09' }, specs: [], partSkus: [], variantGroups: [] },
  { id: 'other', laneId: 'wired', name: 'Other headset', ffsDate: '2026-12-01', specs: [], partSkus: [], variantGroups: [] },
] } }] };
function change(manifest, patch, id = 'one') {
  const base = model.snapshot(manifest).products.find((item) => item.productId === id);
  return { productId: id, base: base.values, baseRevisions: base.revisions, patch };
}
function save(manifest, patch, at, actor = 'Planner', id = 'one') {
  return model.mergeChanges(manifest, [change(manifest, patch, id)], { now: at, actor });
}
const firstAt = '2026-10-08T01:00:00.000Z', secondAt = '2026-10-09T01:00:00.000Z';
assert.deepEqual(dates(seed), {}, 'Original/import dates do not invent an edit timestamp.');
const original = copy(seed);
const first = save(seed, { ffsDate: '2026-12-04', generalAvailabilityDate: '2027-01-21' }, firstAt);
assert.equal(first.conflicts.length, 0); assert.deepEqual(seed, original);
assert.deepEqual(dates(first.manifest), {
  generalAvailabilityDate: { at: firstAt, actor: 'Planner', value: '2027-01-21' },
  ffsDate: { at: firstAt, actor: 'Planner', value: '2026-12-04' },
});
assert.deepEqual(first.manifest.masterSync.products.one.dateEdits, model.dateEditsForProduct(first.manifest, 'one'));
assert.deepEqual(dates(first.manifest, 'other'), {});

const independent = model.mergeChanges(first.manifest, [change(seed, { endManufacturingDate: '2030-10-01' })], { now: secondAt, actor: 'Operations' });
assert.equal(independent.conflicts.length, 0, 'Concurrent edits to different date fields merge normally.');
assert.deepEqual(dates(independent.manifest).ffsDate, dates(first.manifest).ffsDate);
assert.deepEqual(dates(independent.manifest).generalAvailabilityDate, dates(first.manifest).generalAvailabilityDate);
assert.deepEqual(dates(independent.manifest).endManufacturingDate, { at: secondAt, actor: 'Operations', value: '2030-10-01' });
const conflict = model.mergeChanges(independent.manifest, [change(seed, { generalAvailabilityDate: '2027-03-01' })], { now: '2026-10-10T01:00:00.000Z', actor: 'Rejected editor' });
assert(conflict.conflicts.length > 0); assert.equal(conflict.manifest, independent.manifest);
assert.deepEqual(dates(conflict.manifest), dates(independent.manifest), 'A conflict never starts any date clock.');
const noop = save(independent.manifest, { ffsDate: '2026-12-04' }, '2026-10-10T02:00:00.000Z', 'No-op editor');
assert.equal(noop.savedFields, 0); assert.equal(noop.manifest, independent.manifest);
assert.deepEqual(dates(noop.manifest), dates(independent.manifest));
const nonDate = save(independent.manifest, { codename: 'Changed only name' }, '2026-10-10T03:00:00.000Z');
assert.deepEqual(dates(nonDate.manifest), dates(independent.manifest), 'Other facts preserve all date clocks.');
const cleared = save(nonDate.manifest, { ffsDate: 'TBD' }, '2026-10-10T04:00:00.000Z', 'Date owner');
assert.deepEqual(dates(cleared.manifest).ffsDate, { at: '2026-10-10T04:00:00.000Z', actor: 'Date owner', value: '' }, 'Clearing a set date to TBD is a genuine edit.');

const legacy = copy(independent.manifest); delete legacy.masterSync.products.one.dateEdits;
assert.deepEqual(dates(legacy), dates(independent.manifest), 'Older accepted date history recovers the same clocks.');
legacy.masterSync.revision += 1;
legacy.masterSync.history.push({ productId: 'one', path: '@launch', revision: legacy.masterSync.revision, at: '2026-10-11T00:00:00.000Z', before: { generalAvailabilityDate: '2027-01-21', startMonth: '2027-01' }, after: { generalAvailabilityDate: '2027-01-21', startMonth: '2027-02' }, beforeExists: true, afterExists: true, actor: 'Only month' });
assert.deepEqual(dates(legacy).generalAvailabilityDate, dates(first.manifest).generalAvailabilityDate, 'A changed planned month without an exact-date change does not age the exact date.');
const legacyBefore = copy(legacy);
dates(legacy); assert.deepEqual(legacy, legacyBefore, 'Metadata reads remain immutable.');
const backfilled = save(legacy, { codename: 'Backfill old dates' }, '2026-10-12T00:00:00.000Z').manifest;
backfilled.masterSync.history = [];
assert.deepEqual(dates(backfilled), dates(independent.manifest), 'A normal later save preserves recovered clocks independently of bounded history.');
const importedChanged = copy(backfilled); product(importedChanged).ffsDate = '2026-12-20';
assert.equal(dates(importedChanged).ffsDate, undefined, 'A mismatched imported value cannot inherit a stale clock.');

const future = { productId: 'one', path: 'ffsDate', revision: legacy.masterSync.revision + 1, at: '2026-10-13T00:00:00.000Z', before: '', after: '2026-12-04', beforeExists: true, afterExists: true, actor: 'Bad actor' };
const badHistory = copy(legacy);
badHistory.masterSync.history.push(...[
  future, { ...future, revision: 1, at: '2026-02-30T00:00:00.000Z' },
  { ...future, revision: 1, at: 'invalid' }, { ...future, revision: 1, valueTruncated: true },
  { ...future, revision: 1, accepted: false }, { ...future, revision: 1, status: 'rejected' },
  { ...future, revision: 1, kind: 'noop' }, { ...future, revision: 1, after: '2026-02-30' },
  { ...future, revision: 1, before: '2026-12-04' }, { ...future, revision: 1, productId: '__proto__' },
]);
assert.deepEqual(dates(badHistory), dates(independent.manifest), 'Invalid, future-revision, truncated, rejected and no-op audit records are ignored.');
const unknowableLatest = copy(legacy);
unknowableLatest.masterSync.history.push({ ...future, revision: ++unknowableLatest.masterSync.revision, valueTruncated: true, before: 'Truncated earlier facts', after: 'Truncated changed facts' });
assert.equal(dates(unknowableLatest).ffsDate, undefined, 'A newer truncated date operation cannot falsely attribute an earlier retained edit to the current date.');
const malformed = copy(backfilled);
malformed.masterSync.products.one.dateEdits = { ffsDate: { at: 'bad', actor: {}, value: '2026-12-04' }, constructor: { at: firstAt, actor: 'Bad', value: '2026-12-04' }, otherDate: { at: firstAt, actor: 'Bad', value: '2026-12-04' } };
assert.deepEqual(dates(malformed), {}); assert.deepEqual(dates(malformed, '__proto__'), {}); assert.deepEqual(dates(malformed, 'missing'), {});
const minimal = { categories: [{ board: { products: [{ id: 'one', ...model.snapshot(independent.manifest).products[0].values, specs: 'not needed by this read' }] } }], masterSync: independent.manifest.masterSync };
assert.deepEqual(dates(minimal), dates(independent.manifest), 'Tooltip lookup needs only accepted date fields, not full roadmap/spec normalization.');

const created = model.mergeChanges(seed, [{ kind: 'create', productId: 'new', categoryId: 'audio', laneId: 'wired', mine: model.productValues({ name: 'Imported new product', generalAvailabilityDate: '2027-04-01', finalAssetsDate: '2027-03-15' }) }], { now: firstAt, actor: 'Importer', requestId: 'imported-new' });
assert.equal(created.conflicts.length, 0);
assert.deepEqual(dates(created.manifest, 'new'), {
  generalAvailabilityDate: { at: firstAt, actor: 'Importer', value: '2027-04-01' },
  finalAssetsDate: { at: firstAt, actor: 'Importer', value: '2027-03-15' },
});
assert.equal(dates(created.manifest, 'new').ffsDate, undefined, 'Blank dates on new records have no edit clock.');
const legacyCreated = copy(created.manifest); delete legacyCreated.masterSync.products.new.dateEdits;
assert.deepEqual(dates(legacyCreated, 'new'), dates(created.manifest, 'new'), 'Legacy @product creation recovers nonempty initial dates only.');

const mergeManifest = copy(first.manifest), kept = product(mergeManifest), donor = product(mergeManifest, 'other');
donor.finalAssetsDate = '2026-12-10';
const baseline = model.snapshot(mergeManifest).products, planned = merge.plan(kept, donor), choices = Object.fromEntries(planned.conflicts.map((item) => [item.key, 'keeper']));
const keeperBase = baseline.find((item) => item.productId === 'one'), sourceBase = baseline.find((item) => item.productId === 'other');
const consolidated = model.mergeChanges(mergeManifest, [{ kind: 'merge', productId: 'one', sourceProductId: 'other', categoryId: 'audio', laneId: 'wired', sourceCategoryId: 'audio', sourceLaneId: 'wired', choices,
  base: keeperBase, sourceBase, baseProductVersion: keeperBase.productVersion, sourceBaseProductVersion: sourceBase.productVersion, mine: model.productValues(merge.resolve(planned, choices)) }], { now: secondAt, actor: 'Consolidator', requestId: 'merge-dates' });
assert.equal(consolidated.conflicts.length, 0);
assert.deepEqual(dates(consolidated.manifest).ffsDate, dates(first.manifest).ffsDate);
assert.deepEqual(dates(consolidated.manifest).generalAvailabilityDate, dates(first.manifest).generalAvailabilityDate);
assert.deepEqual(dates(consolidated.manifest).finalAssetsDate, { at: secondAt, actor: 'Consolidator', value: '2026-12-10' }, 'Filling a keeper date during accepted consolidation starts only that clock.');
const legacyConsolidated = copy(consolidated.manifest); delete legacyConsolidated.masterSync.products.one.dateEdits;
assert.deepEqual(dates(legacyConsolidated), dates(consolidated.manifest), 'Legacy @product consolidation changes and exact diffs recover the same clocks.');

const pruned = copy(independent.manifest);
for (let index = 0; index < 1100; index++) pruned.masterSync.history.push({ productId: 'other', path: 'codename', before: 'a', after: 'b', beforeExists: true, afterExists: true, revision: ++pruned.masterSync.revision, at: secondAt, actor: 'Other editor' });
const afterPruning = save(pruned, { name: 'Name after pruning' }, '2026-10-15T00:00:00.000Z').manifest;
assert(afterPruning.masterSync.history.length <= 1000);
assert(!afterPruning.masterSync.history.some((entry) => entry.path === 'ffsDate'));
assert.deepEqual(dates(afterPruning), dates(independent.manifest), 'History pruning never expires durable date clocks.');
const key = codec.generateKey(), encoder = new TextEncoder(), decoder = new TextDecoder();
const packageBytes = await codec.encrypt(codec.createZip([{ name: 'portfolio.json', data: encoder.encode(JSON.stringify(afterPruning)) }]), key);
assert(!Buffer.from(packageBytes).includes(Buffer.from('Planner')));
const unpacked = JSON.parse(decoder.decode(codec.readZip(await codec.decrypt(packageBytes, key)).get('portfolio.json')));
assert.deepEqual(dates(unpacked), dates(independent.manifest), 'Date clocks survive an encrypted package round trip.');
const detached = model.dateEditsForProduct(unpacked, 'one'); detached.ffsDate.actor = 'Mutated returned data';
assert.equal(dates(unpacked).ffsDate.actor, 'Planner');
console.log('Date edit metadata checks passed: independent clocks, genuine exact-date changes, accepted saves, no-op/conflict stability, TBD clears, legacy recovery, imported creation, consolidation, bounded history, malformed data, immutable reads and encrypted package round trips.');
