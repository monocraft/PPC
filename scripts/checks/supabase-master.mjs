import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMasterGateway, sha256, canonicalJson } from '../../supabase/functions/ppc-master/gateway.mjs';
import { buildSupabaseMaster } from '../build-supabase-master.mjs';

await buildSupabaseMaster({ check: true });
const codec = globalThis.PortfolioPackage, model = globalThis.PortfolioMasterModel;
const clone = (value) => JSON.parse(JSON.stringify(value));
const key = codec.generateKey();
const publisherSecret = 'test-private-publisher-' + 'x'.repeat(40);
const sourceSha = 'a'.repeat(40);
const env = { PPC_PACKAGE_KEY_HASH: await sha256(key), PPC_PUBLISHER_SECRET: publisherSecret,
  PPC_ALLOWED_ORIGINS: 'http://127.0.0.1:4190' };
const seed = {
  version: 4, activeCategoryId: 'pc-audio', packageInfo: { version: 1, updatedAt: '2026-10-08T00:00:00.000Z', comments: 'Preserve comment' },
  customLayout: { columns: 7, exportNote: 'Preserve original layout' }, imageAssets: [{ id: 'image-1', sourceType: 'local', packagePath: 'images/image-1.png' }],
  categories: [{ id: 'pc-audio', name: 'PC Gaming Audio', board: { lanes: [{ id: 'wired', title: 'Wired' }], products: [
    { id: 'product-one', laneId: 'wired', name: 'Headset', codename: 'First', imageAssetId: 'image-1',
      customOptions: { ownerNote: 'Preserve original extra fields' },
      generalAvailabilityDate: '2027-01-01', ffsDate: '2026-12-01', endManufacturingDate: '2028-01-01',
      specs: [{ id: 'spec-one', label: 'Driver', value: '50 mm' }], partSkus: [{ id: 'part-one', code: 'HP-ONE', variantId: '', colorCode: '' }], variantGroups: [] },
    { id: 'product-two', laneId: 'wired', name: 'Microphone', codename: 'Second', specs: [], partSkus: [], variantGroups: [] },
  ] } }],
};

function inMemoryRpc() {
  let state = null;
  const receipts = new Map(), roster = new Map(), rates = new Map();
  let clock = Date.now(), raceReads = false, readWaiters = [], committed = 0;
  const publication = () => ({ requestedRevision: state.storageRevision, publishedRevision: state.publishedRevision,
    status: state.publishedRevision >= state.storageRevision ? 'current' : state.error ? 'error' : 'pending',
    error: state.error || '', githubSha: state.githubSha, publishedAt: state.publishedAt || null });
  const document = () => state ? { manifest: clone(state.manifest), storageRevision: state.storageRevision, revision: state.storageRevision, sourceSha: state.sourceSha, publication: publication() } : { status: 'uninitialized' };
  const receiptKey = (payload) => `${payload.sessionId}:${payload.requestId}`;
  return {
    inspect: document,
    receipts, roster,
    get committed() { return committed; },
    advance(ms) { clock += ms; },
    raceNextReads() { raceReads = true; },
    async call(operation, payload) {
      if (operation === 'rate') {
        const window = Math.floor(clock / (payload.windowSeconds * 1000));
        const previous = rates.get(payload.bucket), count = previous?.window === window ? previous.count + 1 : 1;
        rates.set(payload.bucket, { count, window });
        return { allowed: count <= payload.maximum, retryAfter: payload.windowSeconds };
      }
      if (operation === 'bootstrap') {
        if (!state) {
          state = { manifest: clone(payload.manifest), storageRevision: 1, sourceSha: payload.sourceSha, fingerprint: payload.fingerprint,
            publishedRevision: 0, githubSha: payload.sourceSha, error: '' };
          return { ...document(), status: 'initialized' };
        }
        return state.fingerprint === payload.fingerprint ? { ...document(), status: 'already_seeded' } : { status: 'already_initialized' };
      }
      if (operation === 'read') {
        const result = document();
        const receipt = receipts.get(receiptKey(payload));
        if (receipt) result.receipt = clone(receipt);
        if (raceReads && payload.requestId) {
          await new Promise((release) => { readWaiters.push(release); if (readWaiters.length === 2) { raceReads = false; const ready = readWaiters; readWaiters = []; ready.forEach((resolveRead) => resolveRead()); } });
        }
        return result;
      }
      if (operation === 'commit') {
        const previous = receipts.get(receiptKey(payload));
        if (previous) return previous.fingerprint !== payload.fingerprint ? { status: 'request_mismatch' } : { ...document(), status: 'already_saved', ...clone(previous) };
        if (payload.expectedRevision !== state.storageRevision) return { ...document(), status: 'raced' };
        if (payload.changed) { state.manifest = clone(payload.manifest); state.storageRevision += 1; state.error = ''; committed += 1; }
        const receipt = { fingerprint: payload.fingerprint, storageRevision: state.storageRevision, savedFields: payload.savedFields, savedProducts: payload.savedProducts };
        receipts.set(receiptKey(payload), receipt);
        return { ...document(), status: 'saved', savedFields: payload.savedFields, savedProducts: payload.savedProducts };
      }
      if (operation === 'presence') {
        for (const [id, row] of roster) if (row.clock <= clock - 65000) roster.delete(id);
        if (payload.leave) roster.delete(payload.sessionId);
        else roster.set(payload.sessionId, { ...clone(payload), clock, lastSeenAt: new Date(clock).toISOString() });
        const sessions = [...roster.values()].map(({ clock: _clock, leave: _leave, ...row }) => row);
        return { sessions, users: sessions, onlineCount: sessions.length, ttlSeconds: 65 };
      }
      if (operation === 'ack') {
        if (payload.storageRevision > state.storageRevision) return { status: 'invalid_revision' };
        if (payload.storageRevision < state.publishedRevision) return { status: 'stale_revision' };
        state.publishedRevision = payload.storageRevision; state.githubSha = payload.githubSha; state.error = '';
        state.publishedAt = new Date(clock).toISOString();
        return { ...document(), status: 'acknowledged' };
      }
      if (operation === 'failure') {
        if (payload.storageRevision > state.publishedRevision && payload.storageRevision <= state.storageRevision) state.error = 'The GitHub package update is waiting to retry.';
        return { ...document(), status: 'recorded' };
      }
      throw new Error(`Unknown RPC ${operation}`);
    },
  };
}

let database = inMemoryRpc();
const gateway = createMasterGateway({ env, rpc: (operation, payload) => database.call(operation, payload), now: () => '2026-10-08T01:02:03.000Z' });
async function call(operation, payload = {}, options = {}) {
  const request = new Request(`https://example.supabase.co/functions/v1/ppc-master/api/master/${operation}`, {
    method: options.method || 'POST', headers: { 'Content-Type': 'application/json', ...(options.origin === null ? {} : { Origin: options.origin || 'https://monocraft.github.io' }),
      'x-forwarded-for': options.peer || '192.0.2.1', ...(options.publisher ? { 'X-PPC-Publisher-Secret': publisherSecret } : {}), ...options.headers },
    ...(options.method === 'OPTIONS' || options.method === 'GET' ? {} : { body: JSON.stringify(payload) }),
  });
  const response = await gateway(request);
  const text = await response.text();
  return { status: response.status, headers: response.headers, data: text ? JSON.parse(text) : null };
}
const values = (manifest = database.inspect().manifest, id = 'product-one') => model.snapshot(manifest).products.find((item) => item.productId === id);
function change(base, patch) { return { productId: base.productId, base: clone(base.values), baseRevisions: clone(base.revisions), patch }; }
const save = (requestId, changes, sessionId = 'session-one', extras = {}) => call('save', { key, sessionId, displayName: 'Owner', requestId, changes, ...extras });

assert.equal((await call('latest', { key })).status, 503, 'uninitialized database cannot claim connection');
assert.equal((await call('bootstrap', { manifest: seed, sourceSha })).status, 401, 'bootstrap requires private publisher credential');
const initialized = await call('bootstrap', { manifest: seed, sourceSha }, { publisher: true, origin: null });
assert.equal(initialized.status, 200); assert.equal(initialized.data.storageRevision, 1);
assert.deepEqual(initialized.data.manifest, seed, 'seed preserves original asset and layout metadata');
assert.equal((await call('bootstrap', { manifest: seed, sourceSha }, { publisher: true })).data.status, 'already_seeded');
assert.equal((await call('bootstrap', { manifest: { ...seed, activeCategoryId: 'changed' }, sourceSha }, { publisher: true })).status, 409, 'different seed cannot replace accepted master');
assert.equal((await call('latest', { key: codec.generateKey() })).status, 401);
assert.equal((await call('latest', { key }, { origin: 'https://other.example' })).status, 403);
assert.equal((await call('latest', { key }, { method: 'GET' })).status, 405);
const preflight = await call('save', {}, { method: 'OPTIONS', origin: 'http://127.0.0.1:4190' });
assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:4190');
const latest = await call('latest', { key });
assert.equal(latest.data.snapshot.canWrite, true); assert.equal(latest.data.snapshot.requiresGitHubToken, false);
assert.equal(latest.data.snapshot.publication.status, 'pending');
assert(!JSON.stringify(latest.data).includes(publisherSecret)); assert(!JSON.stringify(latest.data).includes(key));
assert(!('manifest' in latest.data), 'full export requires private publisher credential');

const baseline = values(); database.raceNextReads();
const independent = await Promise.all([
  save('save-date-001', [change(baseline, { generalAvailabilityDate: '2027-02-01' })], 'session-one', { reason: 'Launch date updated.' }),
  save('save-spec-001', [change(baseline, { specs: [{ id: 'spec-one', label: 'Driver', value: '53 mm' }] })], 'session-two', { reason: 'Driver specification checked.' }),
]);
assert(independent.every((result) => result.status === 200), 'independent concurrent changes both save after storage CAS retry');
assert.equal(values().values.generalAvailabilityDate, '2027-02-01'); assert.equal(values().values.specs[0].value, '53 mm');
assert.equal(database.committed, 2); assert.equal(database.inspect().storageRevision, 3);
assert.deepEqual(database.inspect().manifest.customLayout, seed.customLayout); assert.deepEqual(database.inspect().manifest.imageAssets, seed.imageAssets);
assert.equal(database.inspect().manifest.categories[0].board.products[0].imageAssetId, 'image-1');
assert.equal(database.inspect().manifest.packageInfo.comments, database.inspect().manifest.masterSync.history.at(-1).reason, 'the last accepted concurrent save supplies the footer note');
assert.equal(database.inspect().manifest.packageInfo.updatedAt, database.inspect().manifest.masterSync.history.at(-1).at);
assert.deepEqual((await call('latest', { key })).data.snapshot.packageInfo, database.inspect().manifest.packageInfo, 'a peer refresh receives the latest accepted metadata');

const sameBase = values(); database.raceNextReads();
const collision = await Promise.all([
  save('save-name-001', [change(sameBase, { name: 'Name A' })]),
  save('save-name-002', [change(sameBase, { name: 'Name B' })], 'session-two'),
]);
assert.deepEqual(collision.map((result) => result.status).sort(), [200, 409]);
const conflict = collision.find((result) => result.status === 409);
assert.equal(conflict.data.code, 'MASTER_CONFLICT'); assert(conflict.data.conflicts.some((item) => item.path === 'name'));
assert.deepEqual(conflict.data.snapshot.packageInfo, database.inspect().manifest.packageInfo, 'a rejected concurrent save reports the winner\'s accepted metadata');
const winner = values().values.name; assert(['Name A', 'Name B'].includes(winner));
const acceptedCount = database.committed;
const winnerIndex = collision.findIndex((result) => result.status === 200);
const replay = await save(winnerIndex === 0 ? 'save-name-001' : 'save-name-002', [change(sameBase, { name: winner })], winnerIndex === 0 ? 'session-one' : 'session-two');
assert.equal(replay.status, 200); assert.equal(replay.data.alreadySaved, true); assert.equal(database.committed, acceptedCount);
assert.deepEqual(replay.data.snapshot.packageInfo, database.inspect().manifest.packageInfo, 'a receipt replay does not advance update information');
const beforeNoOp = clone(database.inspect().manifest.packageInfo);
const noOp = await save('save-noop-metadata', [change(values(), { name: winner })], 'session-three', { reason: 'No business change.' });
assert.equal(noOp.status, 200); assert.equal(noOp.data.savedFields, 0);
assert.deepEqual(database.inspect().manifest.packageInfo, beforeNoOp, 'an accepted no-op receipt leaves the last real update information unchanged');
const renamedReplay = await save(winnerIndex === 0 ? 'save-name-001' : 'save-name-002', [change(sameBase, { name: winner })], winnerIndex === 0 ? 'session-one' : 'session-two', { displayName: 'Updated optional name' });
assert.equal(renamedReplay.status, 200); assert.equal(renamedReplay.data.alreadySaved, true, 'changing optional display name cannot invalidate an accepted retry');
const mismatch = await save(winnerIndex === 0 ? 'save-name-001' : 'save-name-002', [change(sameBase, { name: 'Changed request' })], winnerIndex === 0 ? 'session-one' : 'session-two');
assert.equal(mismatch.status, 409); assert.equal(mismatch.data.code, 'REQUEST_ID_MISMATCH');

const abaBase = values();
assert.equal((await save('save-aba-out', [change(abaBase, { codename: 'Temporary' })])).status, 200);
assert.equal((await save('save-aba-back', [change(values(), { codename: abaBase.values.codename })])).status, 200);
const aba = await save('save-aba-stale', [change(abaBase, { codename: 'Stale edit' })], 'session-three');
assert.equal(aba.status, 409, 'field revision fence detects value changed away then back');

const beforeAtomic = clone(database.inspect());
const staleProduct = values(beforeAtomic.manifest);
const atomic = await save('save-atomic-001', [change(abaBase, { codename: 'Still stale' }), change(values(beforeAtomic.manifest, 'product-two'), { codename: 'Must not save partially' })]);
assert.equal(atomic.status, 409); assert.deepEqual(database.inspect(), beforeAtomic, 'whole request conflict applies no partial edits');

const presence = await call('presence', { key, sessionId: 'presence-one', displayName: 'Test name', categoryId: 'incorrect-supplied-category', productId: 'product-one', editing: true });
assert.equal(presence.data.sessions[0].productName, winner); assert.equal(presence.data.sessions[0].displayName, 'Test name');
assert.equal(presence.data.sessions[0].categoryId, 'pc-audio'); assert.equal(presence.data.sessions[0].categoryName, 'PC Gaming Audio', 'selected product category overrides supplied category and names come from master');
const unsavedPresence = await call('presence', { key, sessionId: 'presence-two', categoryId: 'pc-audio', productId: 'new-unsaved-product', editing: true });
assert.equal(unsavedPresence.status, 200); assert.equal(unsavedPresence.data.sessions.find((entry) => entry.sessionId === 'presence-two').productId, '');
assert.equal(unsavedPresence.data.sessions.find((entry) => entry.sessionId === 'presence-two').categoryName, 'PC Gaming Audio');
const categoryViewer = await call('presence', { key, sessionId: 'category-viewer', categoryId: 'pc-audio' });
assert.equal(categoryViewer.data.sessions.find((entry) => entry.sessionId === 'category-viewer').categoryName, 'PC Gaming Audio');
assert.equal(categoryViewer.data.sessions.find((entry) => entry.sessionId === 'category-viewer').productId, '');
assert.equal((await call('presence', { key, sessionId: 'presence-invalid', productId: 'x'.repeat(181) })).status, 400);
database.advance(65001);
const expired = await call('presence', { key, sessionId: 'presence-two' });
assert.equal(expired.data.onlineCount, 1); assert.equal(expired.data.sessions[0].sessionId, 'presence-two');
assert.equal((await call('presence', { key, sessionId: 'presence-two', leave: true })).data.onlineCount, 0);
for (let count = 0; count < 30; count += 1) await call('presence', { key, sessionId: 'rate-presence' });
assert.equal((await call('presence', { key, sessionId: 'rate-presence' })).status, 429);

const exported = await call('export', {}, { publisher: true, origin: null });
assert.deepEqual(exported.data.manifest, database.inspect().manifest); assert.equal(exported.data.storageRevision, database.inspect().storageRevision);
assert.equal((await call('export', {})).status, 401);
assert.equal((await call('latest', { key, unsupported: true })).status, 400);
assert.equal((await call('ack', { storageRevision: exported.data.storageRevision, githubSha: 'invalid' }, { publisher: true })).status, 400);
const failed = await call('failure', { storageRevision: exported.data.storageRevision, message: 'PRIVATE TOKEN SHOULD NOT LEAK' }, { publisher: true });
assert.equal(failed.data.publication.status, 'error'); assert(!JSON.stringify(failed.data).includes('PRIVATE TOKEN'));
assert.equal((await call('ack', { storageRevision: exported.data.storageRevision + 1, githubSha: 'b'.repeat(40) }, { publisher: true })).status, 409);
const acked = await call('ack', { storageRevision: exported.data.storageRevision, githubSha: 'b'.repeat(40) }, { publisher: true });
assert.equal(acked.data.publication.status, 'current');
assert.equal((await call('ack', { storageRevision: exported.data.storageRevision - 1, githubSha: 'c'.repeat(40) }, { publisher: true })).status, 409);
assert.equal((await call('ack', { storageRevision: exported.data.storageRevision, githubSha: 'c'.repeat(40) }, { publisher: true })).data.publication.githubSha, 'c'.repeat(40));
for (let attempt = 0; attempt < 30; attempt += 1) {
  assert.equal((await call('latest', { key: 'incorrect' }, { peer: '192.0.2.200' })).status, 401);
}
assert.equal((await call('latest', { key: 'incorrect' }, { peer: '192.0.2.200' })).status, 429, 'invalid unlock attempts have a stricter bounded rate');

let dispatches = 0;
const dispatchGateway = createMasterGateway({ env: { ...env, PPC_GITHUB_DISPATCH_TOKEN: 'test-secret-token', PPC_GITHUB_PUBLISH_WORKFLOW: 'publish-master.yml' },
  rpc: (operation, payload) => database.call(operation, payload), fetchImpl: async () => { dispatches += 1; throw new Error('Network down'); } });
const acceptedOffline = await dispatchGateway(new Request('https://example.supabase.co/functions/v1/ppc-master/api/master/save', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://monocraft.github.io' },
  body: JSON.stringify({ key, sessionId: 'dispatch-session', requestId: 'dispatch-save-one', changes: [change(values(), { codename: 'Accepted despite publisher outage' })] }),
}));
assert.equal(acceptedOffline.status, 200); assert.equal(dispatches, 1);
assert.equal(values().values.codename, 'Accepted despite publisher outage'); assert.equal(database.inspect().publication.status, 'pending');

const newProductId = 'new-team-product';
const newValues = model.productValues({ name: 'New team product', codename: 'New', specs: [],
  partSkus: [{ id: 'new-part', code: 'HP-NEW', colorCode: '', variantId: '' }], variantGroups: [] });
const createChange = { kind: 'create', productId: newProductId, categoryId: 'pc-audio', laneId: 'wired', mine: newValues };
const created = await save('create-product-one', [createChange]);
assert.equal(created.status, 200); assert(created.data.snapshot.products.some((entry) => entry.productId === newProductId));
const collidingCreate = await save('create-product-other', [{ ...createChange, mine: { ...newValues, name: 'Other team product' } }], 'other-creator');
assert.equal(collidingCreate.status, 409); assert.equal(collidingCreate.data.conflicts[0].path, '@product');
const creationBaseline = values(database.inspect().manifest, newProductId);
const deletion = (baseline) => ({ kind: 'delete', productId: baseline.productId, categoryId: baseline.categoryId, laneId: baseline.laneId,
  base: clone(baseline.values), baseRevisions: clone(baseline.revisions), baseProductVersion: baseline.productVersion });
assert.equal((await save('edit-created-product', [change(creationBaseline, { codename: 'Another team edited' })], 'other-editor')).status, 200);
const staleDelete = await save('delete-created-stale', [deletion(creationBaseline)]);
assert.equal(staleDelete.status, 409, 'deleting a product changed by another team requires a choice');
const deleteBase = values(database.inspect().manifest, newProductId);
const deleted = await save('delete-created-fresh', [deletion(deleteBase)]);
assert.equal(deleted.status, 200); assert(!deleted.data.snapshot.products.some((entry) => entry.productId === newProductId));
assert(deleted.data.snapshot.tombstones.some((entry) => entry.productId === newProductId));
assert.equal((await save('edit-deleted-stale', [change(deleteBase, { name: 'Stale update after deletion' })], 'other-editor')).status, 409);
const tombstone = deleted.data.snapshot.tombstones.find((entry) => entry.productId === newProductId);
const restored = await save('restore-created-product', [{ ...createChange, mine: { ...deleteBase.values, name: 'Restored team product' }, baseRevisions: tombstone.revisions }]);
assert.equal(restored.status, 200); assert(restored.data.snapshot.products.some((entry) => entry.productId === newProductId && entry.productName === 'Restored team product'));
assert.equal((await save('old-delete-restored', [deletion(deleteBase)])).status, 409, 'deletion fence detects product removal and restoration');

const validColorways = [{ id: 'color-group', type: 'color', label: 'Colorways', items: [
  { id: 'black-single', code: 'BK', colorHex: '#000000', colorHex2: '' },
  { id: 'black-red', code: 'BK', colorHex: '#000000', colorHex2: '#ff0000' },
  { id: 'red-black', code: 'BK', colorHex: '#ff0000', colorHex2: '#000000' },
] }];
assert.equal((await save('color-combination-save', [change(values(), { variantGroups: validColorways })])).status, 200, 'primary and secondary color combinations distinguish valid repeated SKU labels');
const invalidColorways = clone(validColorways); invalidColorways[0].items.push({ ...invalidColorways[0].items[0], id: 'black-duplicate' });
const beforeDuplicate = clone(database.inspect());
assert.equal((await save('color-exact-duplicate', [change(values(), { variantGroups: invalidColorways })])).status, 400, 'identical code and color combination still fails');
assert.deepEqual(database.inspect(), beforeDuplicate);

const archivedBaseline = values();
const archivedDelete = await save('delete-archived-image', [deletion(archivedBaseline)]);
assert.equal(archivedDelete.status, 200);
const privateArchive = database.inspect().manifest.masterSync.products['product-one'].archivedProduct;
assert.equal(privateArchive.imageAssetId, 'image-1'); assert.deepEqual(privateArchive.customOptions, seed.categories[0].board.products[0].customOptions);
assert(!('archivedProduct' in archivedDelete.data.snapshot.masterSync.products['product-one']), 'public masterSync cannot leak private full archived record');
const archivedTombstone = archivedDelete.data.snapshot.tombstones.find((entry) => entry.productId === 'product-one');
const archivedRestore = await save('restore-archived-image', [{ kind: 'create', productId: 'product-one', categoryId: 'pc-audio', laneId: 'wired',
  mine: archivedBaseline.values, baseRevisions: archivedTombstone.revisions }]);
assert.equal(archivedRestore.status, 200);
const restoredOriginal = database.inspect().manifest.categories[0].board.products.find((entry) => entry.id === 'product-one');
assert.equal(restoredOriginal.imageAssetId, 'image-1'); assert.deepEqual(restoredOriginal.customOptions, privateArchive.customOptions, 'explicit restore preserves image references and custom fields');

// A combined product and its removed source share one SQL compare-and-swap.
// Concurrent source edits must win safely or force the merge to be reviewed.
database = inMemoryRpc();
const mergeSeed = clone(seed);
Object.assign(mergeSeed.categories[0].board.products[1], { specs: [{ id: 'source-spec', label: 'Battery', value: '80 hours', sourceNote: 'Preserve donor row metadata' }],
  customFactory: { inherited: true }, ascm: { records: [{ basePartNumber: 'HP-TWO', privateProcurement: 'Original full source' }] } });
await call('bootstrap', { manifest: mergeSeed, sourceSha }, { publisher: true });
function mergeOperation() {
  const manifest = database.inspect().manifest, [keeper, source] = manifest.categories[0].board.products;
  const baseline = model.snapshot(manifest), planned = globalThis.PortfolioProductMerge.plan(keeper, source);
  const choices = Object.fromEntries(planned.conflicts.map((item) => [item.key, 'keeper']));
  const base = baseline.products.find((item) => item.productId === keeper.id), sourceBase = baseline.products.find((item) => item.productId === source.id);
  return { kind: 'merge', productId: keeper.id, sourceProductId: source.id, categoryId: base.categoryId, laneId: base.laneId, sourceCategoryId: sourceBase.categoryId, sourceLaneId: sourceBase.laneId,
    base, sourceBase, baseProductVersion: base.productVersion, sourceBaseProductVersion: sourceBase.productVersion, choices,
    mine: model.productValues(globalThis.PortfolioProductMerge.resolve(planned, choices)) };
}
const mergeRaceRequest = mergeOperation(), donorRaceBase = values(undefined, 'product-two');
database.raceNextReads();
const mergeRace = await Promise.all([
  save('save-merge-race', [mergeRaceRequest], 'merge-session'),
  save('save-source-race', [change(donorRaceBase, { codename: 'Concurrent source update' })], 'source-session'),
]);
assert.deepEqual(mergeRace.map((result) => result.status).sort(), [200, 409], 'a concurrent full merge/source edit never partially deletes or overwrites a changed source');
let mergedGateway = mergeRace[0];
if (mergedGateway.status === 409) {
  assert(mergedGateway.data.conflicts.some((item) => item.kind === 'merge' && item.requiresMergeReview));
  mergedGateway = await save('save-merge-reviewed', [mergeOperation()], 'merge-session');
}
assert.equal(mergedGateway.status, 200);
assert.equal(database.inspect().manifest.categories[0].board.products.length, 1);
const mergedGatewayProduct = database.inspect().manifest.categories[0].board.products[0];
assert.equal(mergedGatewayProduct.specs.find((row) => row.id === 'source-spec').sourceNote, 'Preserve donor row metadata');
assert.equal(mergedGatewayProduct.ascm.records[0].privateProcurement, 'Original full source');
assert(!JSON.stringify(mergedGateway.data).includes('privateProcurement'), 'merge responses expose only safe source descriptors, not archived original metadata');
assert(!('archivedProduct' in mergedGateway.data.snapshot.masterSync.products['product-two']));
assert.equal(mergedGateway.data.snapshot.tombstones[0].mergedIntoProductId, 'product-one');

const legacyDatabase = inMemoryRpc(), legacy = clone(seed);
const legacyAccepted = model.mergeChanges(legacy, [change(model.snapshot(legacy).products[0], { codename: 'Accepted before this update' })],
  { reason: 'Factory dates checked.', now: '2026-10-08T01:02:03.000Z', requestId: 'legacy-save-one' }).manifest;
legacyAccepted.packageInfo = { ...seed.packageInfo, updatedAt: '2026-10-08T01:02:03.001Z' };
await legacyDatabase.call('bootstrap', { manifest: legacyAccepted, sourceSha, fingerprint: 'legacy-fixture' });
const legacyGateway = createMasterGateway({ env, rpc: (operation, payload) => legacyDatabase.call(operation, payload) });
const legacyResponse = await legacyGateway(new Request('https://example.supabase.co/functions/v1/ppc-master/api/master/latest', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://monocraft.github.io' }, body: JSON.stringify({ key }),
}));
assert.equal(legacyResponse.status, 200);
const legacySnapshot = (await legacyResponse.json()).snapshot;
assert.deepEqual(legacySnapshot.packageInfo, { version: 1, updatedAt: '2026-10-08T01:02:03.000Z', comments: 'Factory dates checked.' }, 'existing hosted business data shows the last accepted note immediately');
assert.equal(legacyDatabase.inspect().manifest.packageInfo.comments, seed.packageInfo.comments, 'correcting the read-only footer needs neither a database rewrite nor an artificial business save');
assert.equal(legacyDatabase.committed, 0);

const sql = await readFile(resolve('supabase/migrations/202610080001_private_master.sql'), 'utf8');
for (const operation of ['read', 'bootstrap', 'commit', 'rate', 'presence', 'ack', 'failure']) {
  assert(sql.includes(`revoke all on function public.ppc_master_${operation}(jsonb) from public, anon, authenticated`));
  assert(sql.includes(`grant execute on function public.ppc_master_${operation}(jsonb) to service_role`));
}
assert(sql.includes('where singleton for update'), 'CAS and publisher acknowledgments lock the single writable state');
assert(sql.includes('primary key (session_id, request_id)'), 'request receipt identities are unique and durable');
assert(sql.includes("security definer set search_path = ''"));
assert(!sql.includes('create policy'), 'no browser policy exposes private manifest or receipts');

if (process.env.PPC_TEST_PGLITE_MODULE) {
  const { PGlite } = await import(pathToFileURL(resolve(process.env.PPC_TEST_PGLITE_MODULE)).href);
  const postgres = new PGlite();
  try {
    await postgres.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await postgres.exec(sql);
    const rpc = async (operation, payload) => (await postgres.query(`select public.ppc_master_${operation}($1::jsonb) as result`, [JSON.stringify(payload)])).rows[0].result;
    const hash = await sha256(canonicalJson({ manifest: seed, sourceSha }));
    assert.equal((await rpc('bootstrap', { manifest: seed, sourceSha, fingerprint: hash })).status, 'initialized');
    assert.deepEqual((await rpc('read', {})).manifest, seed);
    const row = (await rpc('read', {}));
    const product = model.snapshot(seed).products[0];
    const merged = model.mergeChanges(seed, [change(product, { codename: 'SQL proof' })], { requestId: 'sql-save-one' });
    const commitPayload = { expectedRevision: row.storageRevision, manifest: merged.manifest, sessionId: 'sql-session', requestId: 'sql-save-one', fingerprint: 'e'.repeat(64), changed: true, savedFields: merged.savedFields, savedProducts: merged.savedProducts };
    const committed = await rpc('commit', commitPayload);
    assert.equal(committed.status, 'saved'); assert.equal(committed.storageRevision, 2);
    assert.equal((await rpc('commit', commitPayload)).status, 'already_saved');
    assert.equal((await rpc('commit', { ...commitPayload, fingerprint: 'f'.repeat(64) })).status, 'request_mismatch');
    assert.equal((await rpc('commit', { ...commitPayload, requestId: 'sql-raced-one' })).status, 'raced');
    assert.equal((await rpc('read', { sessionId: 'sql-session', requestId: 'sql-save-one' })).receipt.storageRevision, 2);
    const rate = { bucket: 'a'.repeat(64), windowSeconds: 60, maximum: 1 };
    assert.equal((await rpc('rate', rate)).allowed, true); assert.equal((await rpc('rate', rate)).allowed, false);
    assert.equal((await rpc('presence', { sessionId: 'sql-presence', displayName: 'SQL name' })).onlineCount, 1);
    await postgres.query("update ppc_private.master_presence set touched_at=clock_timestamp()-interval '66 seconds'");
    assert.equal((await rpc('presence', { sessionId: 'sql-present-two' })).onlineCount, 1);
    assert.equal((await rpc('ack', { storageRevision: 2, githubSha: 'b'.repeat(40) })).publication.status, 'current');
    assert.equal((await rpc('ack', { storageRevision: 1, githubSha: 'c'.repeat(40) })).status, 'stale_revision');
    const permissions = await postgres.query("select has_function_privilege('anon','public.ppc_master_read(jsonb)','execute') as anon, has_function_privilege('authenticated','public.ppc_master_commit(jsonb)','execute') as authenticated, has_function_privilege('service_role','public.ppc_master_commit(jsonb)','execute') as service");
    assert.deepEqual(permissions.rows[0], { anon: false, authenticated: false, service: true });
    await postgres.exec('set role anon');
    await assert.rejects(() => postgres.query('select public.ppc_master_read($1::jsonb)', ['{}']), /permission denied/);
    await assert.rejects(() => postgres.query('select manifest from ppc_private.master_state'), /permission denied/);
    await postgres.exec('reset role');

    let waitingReads = [], raceSqlReads = true;
    const racingRpc = async (operation, payload) => {
      const result = await rpc(operation, payload);
      if (raceSqlReads && operation === 'read' && payload.requestId) {
        await new Promise((release) => { waitingReads.push(release); if (waitingReads.length === 2) { raceSqlReads = false; const ready = waitingReads; waitingReads = []; ready.forEach((resume) => resume()); } });
      }
      return result;
    };
    const sqlGateway = createMasterGateway({ env, rpc: racingRpc });
    const sqlBase = model.snapshot((await rpc('read', {})).manifest).products[0];
    const sqlSave = async (requestId, patch) => {
      const response = await sqlGateway(new Request('https://example.supabase.co/functions/v1/ppc-master/api/master/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://monocraft.github.io' },
        body: JSON.stringify({ key, sessionId: requestId, requestId, changes: [change(sqlBase, patch)] }),
      }));
      return { status: response.status, body: await response.json() };
    };
    const actualRace = await Promise.all([
      sqlSave('sql-date-race', { generalAvailabilityDate: '2027-03-01' }),
      sqlSave('sql-spec-race', { specs: [{ id: 'spec-one', label: 'Driver', value: '57 mm' }] }),
    ]);
    assert(actualRace.every((entry) => entry.status === 200), 'real PostgreSQL CAS reruns preserve both independent concurrent gateway requests');
    const actualMaster = await rpc('read', {});
    assert.equal(actualMaster.storageRevision, 4);
    const actualValues = model.snapshot(actualMaster.manifest).products[0].values;
    assert.equal(actualValues.generalAvailabilityDate, '2027-03-01'); assert.equal(actualValues.specs[0].value, '57 mm');
    console.log('Supabase migration executed in PostgreSQL; actual RPC CAS, durable receipts, roster expiry, rate limits, publication monotonicity and role permissions verified.');
  } finally { await postgres.close(); }
}

console.log('Supabase gateway checked: auth, CORS, concurrent independent/conflicting edits, ABA, atomic failure, request receipts, presence, rate limits, full manifest preservation, private publication and outage recovery.');
