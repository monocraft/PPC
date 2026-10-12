import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../public/js/launch-records.js';
import '../../public/js/master-model.js';

const api = globalThis.PortfolioLaunchRecords;
const id = (productId, row, key) => 'launch-' + createHash('sha256').update(`${productId}|WW:${row}:${key}`).digest('hex').slice(0, 24);
const observedAt = '2026-10-12T16:35:14.691Z';
const organizedAt = '2026-10-12T20:00:00.000Z';
const values = [99.99, 0, 'Wireless headset, Black', 'Sugar Glider', 'PC Audio', 'BS1T8AA', 'Star', '2026-04-14T00:00:00', '2026-04-28T00:00:00', 'Q2 2026', 'TBC', '2026-04-28T00:00:00', 'Phase 2 September', '', null, '2026-05-11T00:00:00', 'N/A', 'CN 5/20; others July', 'Channel-specific source note', null, '', 0];
const fixture = (productId = 'cloud-stinger-3-wireless') => ({
  id: productId, name: 'Cloud Stinger 3 Wireless', generalAvailabilityDate: '2026-05-19', ffsDate: '2026-04-12', price: 99.99,
  partSkus: [{ id: 'part-stable-id', code: 'BS1T8AA' }],
  roadmap: { startMonth: '2026-05', endMonth: '2030-03', status: 'in-development', confidence: 'medium' },
  specs: [
    { id: 'feature-wireless', label: 'Wireless', value: '2.4GHz / Bluetooth' },
    { id: 'launch-deadbeefdeadbeefdeadbeef', label: 'Battery', value: '80 hours' },
    { id: id(productId, 95, 'A'), label: 'BS1T8AA · MSRP USD', value: '99.99' },
    { id: id(productId, 95, 'B'), label: 'BS1T8AA · MSRP EUR', value: '0.00' },
    { id: id(productId, 95, 'H'), label: 'BS1T8AA · FFS Date', value: '2026-04-14' },
    { id: id(productId, 95, 'source'), label: 'BS1T8AA · Tracker source', value: 'tracker.xlsx · WW!A95:V95' },
    { id: id(productId, 95, 'updated'), label: 'BS1T8AA · Tracker dates checked', value: '2026-10-12' },
  ],
  plc: {
    version: 1, fields: { ffsDate: { value: '2026-04-12', reviewed: true, changedAt: '2026-10-01T17:00:00Z', observedAt: '2026-10-01T17:00:00Z' } },
    history: [{ field: 'ffsDate', before: '2026-04-10', after: '2026-04-12', at: '2026-10-01T17:00:00Z' }],
    variantProjects: { 'variant-stable-id': { fields: { ffsDate: { value: '2026-04-16' } } } },
    launchAvailability: { sourceFile: 'tracker.xlsx', sourceSheet: 'WW', fingerprint: 'source-fingerprint', updatedAt: observedAt, updateDate: '2026-10-12', canonicalRow: 95, rows: [{ row: 95, skus: ['BS1T8AA'], values: [...values] }, { row: 96, skus: ['BS1T9AA'], values: ['USD 89 / 99', 'TBC', 'White variant', 'Other project', 'Console', 'BS1T9AA', '', 'July', null, '', null, 'TBD', 'N/A', null, null, null, null, null, null, null, null, null] }] },
  },
});

const original = fixture(), before = structuredClone(original);
const rows = api.records(original);
assert.equal(rows.length, 2);
assert.equal(rows[0].canonical, true);
assert.equal(rows[1].canonical, false);
assert.deepEqual(rows[0].identity, { productName: values[2], codename: values[3], sourceCategory: values[4], skuText: values[5], tier: values[6] });
assert.deepEqual(rows[0].pricing, { usd: 99.99, eur: 0 }, 'Zero price remains a source observation.');
assert.deepEqual(rows[1].pricing, { usd: 'USD 89 / 99', eur: 'TBC' }, 'Text prices retain original meaning.');
assert.equal(rows[0].milestones[0].value, '2026-04-14');
assert.equal(rows[0].milestones[0].raw, '2026-04-14T00:00:00');
assert.equal(rows[0].milestones[2].value, 'Q2 2026', 'Quarter and month text are never invented exact dates.');
assert.equal(rows[0].regions[1].value, 'Phase 2 September');
assert.equal(rows[0].regions[2].value, '', 'Blank source cells stay distinguishable from null.');
assert.equal(rows[0].regions[3].value, null);
assert.equal(rows[0].regions[5].value, 'N/A');
assert.equal(rows[0].regions[6].value, 'CN 5/20; others July');
assert.equal(rows[0].regions[4].label, 'GA (source region code)', 'Source GA is not the saved worldwide launch date.');
assert.deepEqual(rows[0].notes.map(note => note.value), [values[18], null, '', 0]);
assert.deepEqual(rows[0].source, { file: 'tracker.xlsx', sheet: 'WW', range: 'A95:V95', checkedDate: '2026-10-12', observedAt });
rows[0].identity.codename = 'Mutated caller copy';
assert.deepEqual(original, before, 'Read-only adapters do not mutate saved source rows.');

const migrated = api.migrate(original, { now: organizedAt });
assert.deepEqual(original, before, 'Migration does not mutate its input.');
assert.deepEqual(migrated.specs, before.specs.slice(0, 2), 'Only proved source IDs are moved; a launch-prefixed genuine feature survives.');
assert.deepEqual(api.specifications(before), before.specs.slice(0, 2), 'Old cached records receive the same safe specification view.');
assert.equal(migrated.plc.launchAvailability.organization.movedCount, 5);
assert.equal(migrated.plc.launchAvailability.organization.relocatedMetadata.length, 5);
assert.deepEqual(migrated.plc.launchAvailability.organization.overrides, []);
assert.deepEqual(migrated.plc.launchAvailability.rows, before.plc.launchAvailability.rows, 'The complete legacy row archive remains unchanged.');
assert.equal(migrated.plc.launchAvailability.updatedAt, observedAt);
assert.equal(migrated.plc.launchAvailability.updateDate, '2026-10-12');
assert.equal(migrated.plc.launchAvailability.organization.organizedAt, organizedAt);
assert.equal(migrated.plc.launchAvailability.formatVersion, 1);
for (const field of ['id', 'name', 'ffsDate', 'generalAvailabilityDate', 'price', 'roadmap', 'partSkus']) assert.deepEqual(migrated[field], before[field], `${field} is unrelated to metadata organization.`);
for (const field of ['fields', 'history', 'variantProjects']) assert.deepEqual(migrated.plc[field], before.plc[field], `${field} preserves user dates and stable variant evidence.`);
assert.deepEqual(api.migrate(migrated, { now: '2027-01-01T00:00:00Z' }), migrated, 'A repeated migration neither duplicates metadata nor changes organization time.');
assert.deepEqual(api.records(migrated), api.records(before), 'Persisted typed records and legacy records present identical data.');
assert.deepEqual(api.details(migrated), { records: api.records(migrated), sourceFile: 'tracker.xlsx', sourceSheet: 'WW', checkedDate: '2026-10-12', observedAt, canonicalRow: 95, organizedAt, overrides: [] });
globalThis.PortfolioMasterModel.validateValues(migrated);

const edited = fixture();
edited.specs[2].label = 'Human-reviewed regional MSRP';
edited.specs[2].value = '99.99–109.99';
const editMigration = api.migrate(edited, { now: organizedAt });
assert.deepEqual(editMigration.specs, edited.specs.slice(0, 2));
assert.deepEqual(editMigration.plc.launchAvailability.organization.relocatedMetadata[0], { id: edited.specs[2].id, label: 'Human-reviewed regional MSRP', value: '99.99–109.99' });
assert.deepEqual(editMigration.plc.launchAvailability.organization.overrides[0], { id: edited.specs[2].id, label: 'Human-reviewed regional MSRP', value: '99.99–109.99', row: 95, cell: 'A95', original: { label: 'BS1T8AA · MSRP USD', value: '99.99' } }, 'Edits to an imported entry remain accessible with source comparison.');
assert.deepEqual(api.details(editMigration).overrides, editMigration.plc.launchAvailability.organization.overrides);

for (const productId of ['simple', 'a'.repeat(180), 'unicode-đồ-音-🎧', 'surrogate-\ud800']) {
  const product = fixture(productId);
  assert.equal(api.migrate(product, { now: organizedAt }).plc.launchAvailability.organization.movedCount, 5, 'Synchronous browser IDs match Node SHA-256 for UTF-8 and multi-block inputs.');
}
const noSource = { id: 'plain', specs: [{ id: id('plain', 95, 'A'), label: 'Feature', value: 'Useful' }] };
assert.deepEqual(api.specifications(noSource), noSource.specs, 'A resembling hash without source proof cannot authorize removal.');
assert.deepEqual(api.migrate(noSource), noSource);
assert.deepEqual(api.records(noSource), []);
assert.deepEqual(api.records({ plc: { launchAvailability: { rows: [null, { row: -1, values }, { row: 1, values: 'invalid' }] } } }), []);
const otherSheet = fixture(); otherSheet.plc.launchAvailability.sourceSheet = 'Other sheet';
assert.deepEqual(api.specifications(otherSheet), otherSheet.specs, 'The original WW import namespace is required for proof.');

const browser = { Date, console };
vm.createContext(browser);
vm.runInContext(await readFile(new URL('../../public/js/launch-records.js', import.meta.url), 'utf8'), browser);
assert.deepEqual(JSON.parse(JSON.stringify(browser.PortfolioLaunchRecords.migrate(fixture(), { now: organizedAt }))), migrated, 'The browser API needs no Node APIs, WebCrypto, or TextEncoder.');
console.log('Launch records: lossless organization, exact imported-ID proof, edited metadata, prices/statuses, date preservation, browser parity and idempotence passed.');
