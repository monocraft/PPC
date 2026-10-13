import assert from 'node:assert/strict';
import { createMasterGateway, sha256, validateManifest, publicSnapshot } from '../../supabase/functions/ppc-master/gateway.mjs';
import '../../public/js/master-client.js';
const codec = globalThis.PortfolioPackage, model = globalThis.PortfolioMasterModel, client = globalThis.PortfolioMasterClient;
const key = codec.generateKey(), publisherSecret = 'synthetic-conflict-capacity-' + 'x'.repeat(32);
const env = { PPC_PACKAGE_KEY_HASH: await sha256(key), PPC_PUBLISHER_SECRET: publisherSecret };
const clone = value => JSON.parse(JSON.stringify(value));
const seed = { version: 4, packageInfo: { version: 1, updatedAt: '2026-10-13T00:00:00.000Z', comments: '' },
  categories: [{ id: 'category', board: { lanes: [{ id: 'lane' }], products: [{ id: 'p', name: 'Product', laneId: 'lane' }, { id: 'source', name: 'Source', laneId: 'lane' }] } }] };
const state = manifest => ({ manifest, storageRevision: 1, sourceSha: 'a'.repeat(40), publication: { requestedRevision: 1, publishedRevision: 0, status: 'pending' } });
const change = (base, patch) => ({ productId: base.productId, base: clone(base.values), baseRevisions: clone(base.revisions), patch });

function verifyPlan(manifest, changes) {
  const expected = model.mergeChanges(manifest, changes, { requestId: 'test-conflict-plan' }).conflicts;
  assert(expected.length);
  const plan = model.conflictPlan(expected), latest = client.normalizeSnapshot(model.snapshot(manifest));
  assert.deepEqual(model.restoreConflictPlan(plan, latest, changes), expected);
  assert.throws(() => model.restoreConflictPlan({ ...plan, digest: '0'.repeat(64) }, latest, changes));
  assert.throws(() => model.restoreConflictPlan({ ...plan, groups: [...plan.groups, plan.groups[0]] }, latest, changes));
  return plan;
}
const base = model.snapshot(seed).products[0];
const remote = clone(seed); remote.categories[0].board.products[0].codename = 'Remote';
verifyPlan(remote, [change(base, { codename: 'Mine' })]);
verifyPlan(remote, [{ productId: 'p', kind: 'create', categoryId: 'category', laneId: 'lane', mine: base.values }]);
verifyPlan(remote, [{ ...change(base, {}), kind: 'delete', baseProductVersion: base.productVersion }]);
const removed = clone(seed); removed.categories[0].board.products.shift();
verifyPlan(removed, [change(base, { codename: 'Mine' })]);
const sourceBase = model.snapshot(seed).products[1];
verifyPlan(remote, [{ productId: 'p', sourceProductId: 'source', kind: 'merge', categoryId: 'category', laneId: 'lane', sourceCategoryId: 'category', sourceLaneId: 'lane',
  base: base, sourceBase, baseProductVersion: base.productVersion, sourceBaseProductVersion: sourceBase.productVersion, mine: base.values, choices: {} }]);
const privateSeed = clone(seed); privateSeed.categories[0].board.products[0].privateOwner = 'Complete keeper original';
privateSeed.categories[0].board.products[1].privateOwner = 'Complete source original';
const privateBase = model.snapshot(privateSeed).products;
const privateMerge = { productId: 'p', sourceProductId: 'source', kind: 'merge', categoryId: 'category', laneId: 'lane', sourceCategoryId: 'category', sourceLaneId: 'lane',
  base: privateBase[0], sourceBase: privateBase[1], baseProductVersion: privateBase[0].productVersion, sourceBaseProductVersion: privateBase[1].productVersion, mine: privateBase[0].values, choices: {} };
assert.equal(verifyPlan(privateSeed, [privateMerge]).groups[0].reason, 'additional-details-need-review');
const privateChanged = clone(privateSeed); privateChanged.categories[0].board.products[1].privateOwner = 'Different complete source original';
assert.equal(verifyPlan(privateChanged, [privateMerge]).groups[0].reason, 'products-changed-before-merge');
const deleted = model.mergeChanges(privateSeed, [{ productId: 'p', kind: 'delete', base: privateBase[0].values, baseRevisions: privateBase[0].revisions,
  baseProductVersion: privateBase[0].productVersion }], { requestId: 'delete-tombstone', now: '2026-10-13T01:00:00.000Z' }).manifest;
assert.equal(verifyPlan(deleted, [{ productId: 'p', kind: 'create', categoryId: 'category', laneId: 'lane', mine: privateBase[0].values, baseRevisions: {} }]).groups[0].reason, 'product-removed');
const away = model.mergeChanges(seed, [change(base, { codename: 'Temporary' })], { requestId: 'aba-away', now: '2026-10-13T01:00:00.000Z' }).manifest;
const awayBase = model.snapshot(away).products[0];
const back = model.mergeChanges(away, [change(awayBase, { codename: base.values.codename })], { requestId: 'aba-back', now: '2026-10-13T01:01:00.000Z' }).manifest;
verifyPlan(back, [change(base, { codename: 'Mine after ABA' })]);

// A move by another card changes a whole-lane fence without changing this
// card's own values. Its conflict must survive compact transport and choices.
const placementSeed = { ...clone(seed), categories: [{ id: 'mice', board: {
  lanes: [{ id: 'wired' }, { id: 'wireless' }, { id: 'aux' }],
  products: [['a', 'wired', 0], ['b', 'wired', 1], ['c', 'wired', 2], ['t', 'wireless', 0], ['u', 'wireless', 1], ['d', 'aux', 0]]
    .map(([id, laneId, order]) => ({ id, name: id, laneId, order, privateOwner: `Complete ${id} original` })),
} }] };
const placementChange = (manifest, productId, placement) => {
  const snapshot = model.snapshot(manifest), product = snapshot.products.find(entry => entry.productId === productId);
  return { ...change(product, { cardPlacement: placement }), categoryId: product.categoryId, laneId: product.laneId,
    placementLaneVersions: [...new Set([product.values.cardPlacement.laneId, placement.laneId])]
      .map(laneId => ({ laneId, version: model.laneVersion(snapshot.products, product.categoryId, laneId) })) };
};
let placementChoiceCount = 0, placementPlanCount = 0;
for (const choice of ['mine', 'master', 'cancel']) {
  let remotePlacement = clone(placementSeed), placementRevision = 1, placementCommits = 0, placementMutations = 0;
  let localPlacement = clone(placementSeed.categories[0].board.products).map(product => ({ ...product, categoryId: 'mice' }));
  const placementReceipts = new Map(), endpoint = `https://placement-${choice}.example/api/master`;
  const placementGateway = createMasterGateway({ env, rpc: async (operation, payload) => {
    const document = () => ({ ...state(clone(remotePlacement)), storageRevision: placementRevision });
    if (operation === 'rate') return { allowed: true };
    if (operation === 'read') {
      const value = document(), receipt = placementReceipts.get(payload.requestId);
      if (receipt) value.receipt = receipt;
      return value;
    }
    if (operation === 'commit') {
      if (payload.expectedRevision !== placementRevision) return { ...document(), status: 'raced' };
      if (payload.changed) { remotePlacement = clone(payload.manifest); placementRevision += 1; placementCommits += 1; }
      placementReceipts.set(payload.requestId, { fingerprint: payload.fingerprint, savedFields: payload.savedFields, savedProducts: payload.savedProducts });
      return { ...document(), status: 'saved', savedFields: payload.savedFields, savedProducts: payload.savedProducts };
    }
    throw new Error('Unexpected placement RPC.');
  } });
  const placementSession = client.createSession({ endpoint, source: { team: true }, adapter: {
    getProducts: () => localPlacement,
    applyProductValues: updates => {
      placementMutations += 1;
      localPlacement = localPlacement.map(product => {
        const update = updates.find(entry => entry.productId === product.id);
        return update ? model.applyProductValues(product, update.values) : product;
      });
    },
  }, fetchImpl: async (url, options) => {
    const response = await placementGateway(new Request(url, options));
    if (response.status === 409) {
      const data = await response.clone().json(), submitted = JSON.parse(options.body).changes;
      assert(data.conflictPlan, 'The real gateway uses the negotiated bounded conflict plan.');
      assert.deepEqual(model.restoreConflictPlan(data.conflictPlan, client.normalizeSnapshot(data.snapshot), submitted), model.mergeChanges(remotePlacement, submitted).conflicts);
      placementPlanCount += 1;
    }
    return response;
  } });
  await placementSession.connect(key);
  const localDraft = localPlacement.find(product => product.id === 'd'); localDraft.laneId = 'wireless'; localDraft.order = 2;
  remotePlacement = model.mergeChanges(remotePlacement, [placementChange(remotePlacement, 'a', { laneId: 'wireless', order: 2 })], { requestId: `remote-placement-${choice}` }).manifest;
  placementRevision += 1;
  const beforeChoice = placementMutations;
  const outcome = await placementSession.save({ resolveConflicts: conflicts => {
    placementChoiceCount += 1;
    assert.equal(conflicts.length, 1); assert.equal(conflicts[0].reason, 'lane-order-changed');
    assert.deepEqual(conflicts[0].base, { laneId: 'aux', order: 0 });
    assert.deepEqual(conflicts[0].mine, { laneId: 'wireless', order: 2 });
    assert.deepEqual(conflicts[0].master, { laneId: 'aux', order: 0 });
    return choice === 'cancel' ? null : Object.fromEntries(conflicts.map(conflict => [conflict.key, choice]));
  } });
  const stored = id => remotePlacement.categories[0].board.products.find(product => product.id === id);
  if (choice === 'cancel') {
    assert(outcome.cancelled); assert.equal(placementMutations, beforeChoice); assert.equal(placementCommits, 0);
    assert.equal(localDraft.laneId, 'wireless'); assert(placementSession.track().length);
  } else {
    assert(outcome.saved); assert.equal(placementSession.track().length, 0);
    assert.equal(placementCommits, choice === 'mine' ? 1 : 0);
    assert.equal(stored('d').laneId, choice === 'mine' ? 'wireless' : 'aux');
    assert.equal(stored('a').order, choice === 'mine' ? 3 : 2);
    assert.equal(localPlacement.find(product => product.id === 'd').laneId, stored('d').laneId);
  }
  for (const product of remotePlacement.categories[0].board.products) assert.equal(product.privateOwner, `Complete ${product.id} original`);
}
assert.equal(placementChoiceCount, 3); assert.equal(placementPlanCount, 3);

const wide = clone(seed); wide.categories[0].id = 'c'.repeat(180);
wide.categories[0].board.products = Array.from({ length: 30000 }, (_, index) => ({ id: `p${index}`, name: `N${index}`, laneId: 'lane' }));
wide.categories[0].board.products[0].plc = { version: 1, note: 'R'.repeat(32768) };
wide.masterSync = { ownerPadding: '' };
const initialSize = Buffer.byteLength(JSON.stringify({ snapshot: publicSnapshot(state(wide), 'compact-v1') }));
wide.masterSync.ownerPadding = 'x'.repeat(12 * 1024 * 1024 - 64 * 1024 - 8192 - initialSize);
validateManifest(wide);
const wideBase = model.snapshot(wide).products[0]; wideBase.values.plc.note = 'B'.repeat(32768);
const requestChanges = [change(wideBase, { plc: { version: 1, note: 'M'.repeat(32768) } })];
let commits = 0;
const gateway = createMasterGateway({ env, rpc: async operation => {
  if (operation === 'commit') commits += 1;
  return operation === 'rate' ? { allowed: true } : state(wide);
} });
const endpoint = 'https://conflict-capacity.example/api/master';
const fields = { key, sessionId: 'conflict-session', requestId: 'conflict-capacity-save', changes: requestChanges };
const legacyResponse = await gateway(new Request(`${endpoint}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, snapshotFormat: 'compact-v1' }) }));
assert.equal(legacyResponse.status, 409);
const legacyBytes = Buffer.byteLength(await legacyResponse.text()); assert(legacyBytes > 12 * 1024 * 1024);
let planBytes;
const result = await client.request({ endpoint, operation: 'save', ...fields, fetchImpl: async (url, options) => {
  const response = await gateway(new Request(url, options)), payload = await response.text(); planBytes = Buffer.byteLength(payload);
  return new Response(payload, { status: response.status, headers: response.headers });
} });
assert(result.conflictPlan); assert.equal(result.snapshot.products.length, 30000);
assert.equal(result.conflicts[0].base.note, 'B'.repeat(32768)); assert.equal(result.conflicts[0].mine.note, 'M'.repeat(32768)); assert.equal(result.conflicts[0].master.note, 'R'.repeat(32768));
assert.deepEqual(result.conflicts, model.mergeChanges(wide, requestChanges).conflicts);
assert(planBytes < 16 * 1024 * 1024); assert.equal(commits, 0);

const fiveHundred = clone(seed);
fiveHundred.categories[0].board.products = Array.from({ length: 500 }, (_, index) => ({ id: `${index}-` + 'p'.repeat(175), name: 'Name', laneId: 'lane', codename: 'Remote' }));
const many = model.snapshot(fiveHundred).products.map(product => change({ ...product, values: { ...product.values, codename: 'Base' } }, { codename: 'Mine' }));
const manyPlan = verifyPlan(fiveHundred, many);
assert.equal(manyPlan.groups.length, 500);
const descriptorBytes = Buffer.byteLength(JSON.stringify(manyPlan)); assert(descriptorBytes < 256 * 1024);
const escapedIds = Array.from({ length: 500 }, (_, index) => ({ productId: String(index) + '\u0001'.repeat(175), path: 'codename' }));
const worstDescriptorBytes = Buffer.byteLength(JSON.stringify(model.conflictPlan(escapedIds)));
assert(worstDescriptorBytes < 1024 * 1024, 'Even maximum escaped IDs stay below the enforced 1 MiB descriptor bound.');
assert.throws(() => model.conflictPlan(Array.from({ length: 501 }, (_, index) => ({ productId: `p${index}`, path: 'codename' }))));

let legacyCalls = 0;
const olderFetch = async (_url, options) => {
  legacyCalls += 1;
  return JSON.parse(options.body).snapshotFormat === 'compact-conflict-v1'
    ? new Response(JSON.stringify({ code: 'INVALID_REQUEST', error: 'Unsupported format.' }), { status: 400 })
    : new Response(JSON.stringify({ code: 'MASTER_CONFLICT', snapshot: model.snapshot(remote), conflicts: model.mergeChanges(remote, [change(base, { codename: 'Mine' })]).conflicts }), { status: 409 });
};
const oldOptions = { endpoint: 'https://older-conflict.example/api/master', operation: 'save', key, requestId: 'older-conflict-save', changes: [change(base, { codename: 'Mine' })], fetchImpl: olderFetch };
assert((await client.request(oldOptions)).conflicts.length); assert.equal(legacyCalls, 2);
assert((await client.request(oldOptions)).conflicts.length); assert.equal(legacyCalls, 3);
const multibyteText = JSON.stringify({ padding: '界'.repeat(6 * 1024 * 1024) });
await assert.rejects(() => client.request({ ...oldOptions, endpoint: 'https://byte-bound.example/api/master',
  fetchImpl: async () => ({ status: 409, ok: false, headers: new Headers(), text: async () => multibyteText }) }), error => error.code === 'INVALID_RESPONSE');
await assert.rejects(() => client.request({ ...oldOptions, endpoint: 'https://stream-bound.example/api/master',
  fetchImpl: async () => new Response(multibyteText, { status: 409, headers: { 'Content-Length': String(Buffer.byteLength(multibyteText)) } }) }), error => error.code === 'INVALID_RESPONSE');

// Digest failures must not present incomplete choices or mutate local drafts.
let products = clone(seed.categories[0].board.products), manifest = clone(seed), mutationCount = 0, choiceCalls = 0, tamper = false, acceptedRequest;
const receipts = new Map(); let revision = 1, saveCommits = 0;
const transactionalGateway = createMasterGateway({ env, rpc: async (operation, payload) => {
  const document = () => ({ ...state(clone(manifest)), storageRevision: revision });
  if (operation === 'rate') return { allowed: true };
  if (operation === 'read') { const result = document(), receipt = receipts.get(payload.requestId); if (receipt) result.receipt = receipt; return result; }
  if (operation === 'commit') {
    if (payload.expectedRevision !== revision) return { ...document(), status: 'raced' };
    if (payload.changed) { manifest = clone(payload.manifest); revision += 1; saveCommits += 1; }
    receipts.set(payload.requestId, { fingerprint: payload.fingerprint, savedFields: payload.savedFields, savedProducts: payload.savedProducts });
    return { ...document(), status: 'saved', savedFields: payload.savedFields, savedProducts: payload.savedProducts };
  }
  throw new Error('Unexpected RPC.');
} });
const session = client.createSession({ endpoint: 'https://transactional-conflict.example/api/master', source: { team: true },
  adapter: { getProducts: () => products, applyPatches: changes => { mutationCount += 1; products = products.map(product => {
    const entry = changes.find(change => change.productId === product.id); return entry ? model.applyProductValues(product, entry.values) : product;
  }); } }, fetchImpl: async (url, options) => {
    const response = await transactionalGateway(new Request(url, options));
    if (url.endsWith('/save') && response.status === 200) acceptedRequest = JSON.parse(options.body);
    if (!tamper || response.status !== 409) return response;
    const data = await response.json(); data.conflictPlan.digest = '0'.repeat(64); return new Response(JSON.stringify(data), { status: 409 });
  } });
await session.connect(key);
products[0].codename = 'Mine'; manifest.categories[0].board.products[0].codename = 'Remote';
const beforeCancel = mutationCount;
const cancelled = await session.save({ resolveConflicts: conflicts => { choiceCalls += 1; assert.equal(conflicts[0].mine, 'Mine'); return null; } });
assert(cancelled.cancelled); assert.equal(products[0].codename, 'Mine'); assert.equal(mutationCount, beforeCancel); assert.equal(saveCommits, 0);
tamper = true;
await assert.rejects(() => session.save({ resolveConflicts: () => { choiceCalls += 1; return {}; } }), error => error.code === 'INVALID_RESPONSE');
assert.equal(choiceCalls, 1); assert.equal(products[0].codename, 'Mine'); assert.equal(saveCommits, 0);
tamper = false;
const accepted = await session.save({ requestId: 'resolved-conflict-save', resolveConflicts: conflicts => Object.fromEntries(conflicts.map(conflict => [conflict.key, 'mine'])) });
assert(accepted.saved); assert.equal(saveCommits, 1); assert.equal(products[0].codename, 'Mine');
assert.equal(session.getState().pending.length, 0);
const replay = await client.request({ endpoint: 'https://transactional-conflict.example/api/master', operation: 'save', ...acceptedRequest,
  snapshotFormat: 'compact-v1', fetchImpl: (url, options) => transactionalGateway(new Request(url, options)) });
assert.equal(replay.alreadySaved, true); assert.equal(saveCommits, 1, 'Changing wire negotiation does not invalidate or duplicate a durable receipt.');
products[0].codename = 'Mine after choice'; manifest.categories[0].board.products[0].codename = 'Remote after choice';
let abaChoices = 0;
const abaAccepted = await session.save({ resolveConflicts: conflicts => {
  abaChoices += 1;
  if (abaChoices === 1) {
    const current = model.snapshot(manifest).products[0];
    manifest = model.mergeChanges(manifest, [change(current, { codename: 'Temporary after review' })], { requestId: 'after-review-away', now: '2026-10-13T02:00:00.000Z' }).manifest;
    const changed = model.snapshot(manifest).products[0];
    manifest = model.mergeChanges(manifest, [change(changed, { codename: 'Remote after choice' })], { requestId: 'after-review-back', now: '2026-10-13T02:01:00.000Z' }).manifest;
    revision += 2;
  }
  return Object.fromEntries(conflicts.map(conflict => [conflict.key, 'mine']));
} });
assert(abaAccepted.saved); assert.equal(abaChoices, 2, 'Changed-away-and-back values after review require a second verified choice.');
assert.equal(products[0].codename, 'Mine after choice'); assert.equal(saveCommits, 2);
const invalidLegacy = clone(wide); invalidLegacy.masterSync.ownerPadding += 'x'.repeat(5 * 1024 * 1024);
const oversizedGateway = createMasterGateway({ env, rpc: async operation => operation === 'rate' ? { allowed: true } : state(invalidLegacy) });
const oversizedResponse = await oversizedGateway(new Request(`${endpoint}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...fields, snapshotFormat: 'compact-conflict-v1' }) }));
assert.equal(oversizedResponse.status, 413); assert.equal((await oversizedResponse.json()).code, 'CONFLICT_TOO_LARGE');
console.log(JSON.stringify({ manifestBytes: Buffer.byteLength(JSON.stringify(wide)), legacyBytes, planBytes, fullDecisionBytes: 32768 * 3,
  maxDescriptors: manyPlan.groups.length, descriptorBytes, worstDescriptorBytes, legacyCalls, noStreamUtf8Rejected: true, cancelledWithoutMutation: true,
  badDigestRejectedBeforeChoices: true, resolvedCommits: saveCommits, idempotentWireFormatReplay: true, abaChoices,
  privateMergeReviewed: true, tombstoneAndAbaPreserved: true, oversizedServerRejected: true,
  realGatewayLaneRacePlans: placementPlanCount, placementChoices: ['mine', 'master', 'cancel'], placementPrivateRecordsPreserved: true }));
