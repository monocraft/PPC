import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// An event-driven IndexedDB double separates request success from transaction
// completion and never reads a real browser, workspace or credential.
const source = await readFile(new URL('../../public/js/workspace-store.js', import.meta.url), 'utf8');
const sandbox = { TextEncoder, Date, TypeError, Error };
vm.createContext(sandbox); vm.runInContext(source, sandbox);
const api = sandbox.PortfolioWorkspaceStore;
assert.equal(api.MAX_WORKSPACE_BYTES, undefined, 'local storage uses actual browser quota, without an artificial package-sized workspace cap');
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const failure = (name, message = name) => Object.assign(new Error(message), { name });
function driver() {
  const state = { version: 1, stores: new Map([['images', new Map()]]), keys: new Map([['images', 'id']]), connections: [], transactions: [], openCalls: 0, strictAttempts: 0, clears: 0, holdRead: false, holdWrite: false, holdRequests: false, requestJobs: [], nextOpenFailure: '', nextWriteFailure: '', nextPutFailure: false, strictUnsupported: false, blockedRequest: null };
  function connection() {
    const db = { closed: false, objectStoreNames: { contains: name => state.stores.has(name) },
      createObjectStore(name, options) { assert(!state.stores.has(name)); state.stores.set(name, new Map()); state.keys.set(name, options.keyPath); },
      close() { db.closed = true; },
      transaction(names, mode, options) {
        assert(!db.closed, 'a closed database is never reused');
        if (options?.durability === 'strict') { state.strictAttempts++; if (state.strictUnsupported) throw new TypeError('Synthetic unsupported durability option'); }
        for (const name of names) assert(state.stores.has(name), 'transaction store exists');
        const tx = { names, mode, operations: [], requests: [], aborted: false, finished: false, requestEventsDone: false, error: null,
          objectStore(name) { assert(names.includes(name)); return {
            get(key) { const request = {}; tx.requests.push({ request, name, key }); return request; },
            put(record) { if (state.nextPutFailure) { state.nextPutFailure = false; throw failure('DataError', 'Synthetic synchronous put failure'); } tx.operations.push({ name, record: { ...record } }); return {}; },
            delete(key) { tx.operations.push({ name, deletedKey: key }); return {}; },
            clear() { state.clears++; throw new Error('Store clearing is forbidden in these durability cases'); },
          }; },
          abort() { if (tx.finished) return; tx.aborted = true; queueMicrotask(() => tx.complete()); },
          complete() {
            if (tx.finished) return;
            tx.finished = true;
            if (tx.mode === 'readwrite' && state.nextWriteFailure) { tx.error = failure(state.nextWriteFailure); state.nextWriteFailure = ''; tx.aborted = true; }
            if (tx.aborted) { tx.onabort?.(); return; }
            for (const { name, record, deletedKey } of tx.operations) { if (deletedKey !== undefined) state.stores.get(name).delete(deletedKey); else state.stores.get(name).set(record[state.keys.get(name)], record); }
            tx.oncomplete?.();
          },
        };
        state.transactions.push(tx);
        queueMicrotask(() => {
          const completeRequests = () => {
            for (const { request, name, key } of tx.requests) { request.result = state.stores.get(name).get(key); request.onsuccess?.(); }
            tx.requestEventsDone = true;
            if (!(mode === 'readonly' ? state.holdRead : state.holdWrite)) queueMicrotask(() => tx.complete());
          };
          if (state.holdRequests) state.requestJobs.push(completeRequests); else completeRequests();
        });
        return tx;
      },
    };
    state.connections.push(db); return db;
  }
  const indexedDB = { open(_name, version) {
    state.openCalls++;
    const request = {}, fail = state.nextOpenFailure; state.nextOpenFailure = '';
    if (fail === 'throw') throw failure('SecurityError');
    queueMicrotask(() => {
      if (fail === 'blocked') { state.blockedRequest = request; request.onblocked?.(); return; }
      if (fail === 'error') { request.error = failure('SecurityError'); request.onerror?.(); return; }
      request.result = connection();
      if (version > state.version) { request.onupgradeneeded?.(); state.version = version; }
      request.onsuccess?.();
    });
    return request;
  } };
  return { state, indexedDB, lateBlockedSuccess() { state.blockedRequest.result = connection(); state.blockedRequest.onsuccess?.(); return state.blockedRequest.result; } };
}
const create = (d, key = 'production') => api.create({ databaseName: 'synthetic-images-v1', workspaceKey: key, indexedDB: d.indexedDB });
const cases = [];
const mark = label => cases.push(label);
{
  const d = driver(), oldImage = { id: 'existing', blob: new Blob(['old bytes']) }; d.state.stores.get('images').set(oldImage.id, oldImage);
  const store = create(d); assert.equal(await store.read(), null); assert.equal(d.state.version, 2); assert.equal(d.state.stores.get('images').get(oldImage.id).blob, oldImage.blob); mark('upgrade retains existing images');
  const full = { version: 4, categories: [{ id: 'synthetic', board: { lanes: [{ id: 'lane' }], products: [{ id: 'stable', name: 'Synthetic', laneId: 'lane', specs: [{ id: 'spec-id', label: 'Conditional specification', value: '48 kHz (24-bit)' }], partSkus: [{ id: 'sku', code: 'SYNTHETIC', variantId: 'variant' }], variantGroups: [{ id: 'group', items: [{ id: 'variant', imageAssetId: 'existing', customSource: { exact: true } }] }], roadmap: { startMonth: '2026-10', predecessorId: 'other', notes: 'Retained' }, plc: { sourceRows: [{ exact: 'Preserved' }] }, privateProduct: { retained: true } }] } }], masterLocalBaseline: [{ productId: 'stable', values: { retained: true } }], masterLocalMerges: [{ sourceProduct: { id: 'old', specs: [{ id: 'old-spec', rawNote: 'Retained' }] }, choices: { name: 'keeper' } }], masterLocalRemovedProducts: { old: { source: 'Preserved original' } }, masterLocalTombstones: [{ productId: 'old' }], plcReview: { entries: [{ raw: 'Unresolved' }] }, plcSharePending: { patches: [{ id: 'narrow-pending' }] }, imageAssets: [{ id: 'existing', sourceType: 'local' }], unknownMetadata: 'x'.repeat(5 * 1024 * 1024) };
  const raw = JSON.stringify(full); assert(new TextEncoder().encode(raw).length > 4 * 1024 * 1024); await store.save(raw); assert.equal(await store.read(), raw); assert.deepEqual(JSON.parse(await store.read()), full); assert.equal(d.state.clears, 0); mark('large exact full-workspace round trip without pruning');
  const db = await store.open(); db.onversionchange(); assert(db.closed); await store.read(); assert.equal(d.state.openCalls, 2); mark('version-change connection closes and reopens');
}
{
  const d = driver(), store = create(d); await store.save('old'); d.state.holdWrite = true;
  let completed = false; const saving = store.save('new').then(() => { completed = true; }); await tick();
  const tx = d.state.transactions.at(-1); assert(tx.requestEventsDone); assert(!completed); assert.equal(d.state.stores.get('workspaces').get('production').serialized, 'old');
  tx.complete(); await saving; assert(completed); assert.equal(d.state.stores.get('workspaces').get('production').serialized, 'new'); mark('save resolves only on transaction completion');
  d.state.holdRead = true; let readDone = false; const reading = store.read().then(value => { readDone = true; return value; }); await tick(); const readTx = d.state.transactions.at(-1); assert(readTx.requestEventsDone); assert(!readDone); readTx.complete(); assert.equal(await reading, 'new'); mark('read also waits for transaction completion');
}
{
  const d = driver(), store = create(d); await store.save('original'); d.state.holdWrite = true;
  const first = store.save('first'), second = store.save('second'), flush = store.flush(); await tick();
  const firstTx = d.state.transactions.at(-1); assert.equal(d.state.transactions.filter(tx => tx.mode === 'readwrite').length, 2); firstTx.complete(); await first; await tick();
  const secondTx = d.state.transactions.at(-1); assert.notEqual(secondTx, firstTx); assert.equal(secondTx.operations.at(-1).record.serialized, 'second'); secondTx.complete(); await second; await flush;
  assert.equal(d.state.stores.get('workspaces').get('production').serialized, 'second'); mark('queued saves and flush preserve latest ordering');
}
for (const errorName of ['QuotaExceededError', 'AbortError']) {
  const d = driver(), store = create(d), oldBlob = new Blob(['existing']), newBlob = new Blob(['incoming']); d.state.stores.get('images').set('existing', { id: 'existing', blob: oldBlob }); await store.save('original');
  d.state.nextWriteFailure = errorName;
  await assert.rejects(store.save('incoming', { images: [{ id: 'new-image', blob: newBlob }] }), error => error.code === (errorName === 'QuotaExceededError' ? 'WORKSPACE_QUOTA' : 'WORKSPACE_STORAGE'));
  await assert.rejects(store.flush()); assert.equal(await store.read(), 'original'); assert.equal(d.state.stores.get('images').get('existing').blob, oldBlob); assert(!d.state.stores.get('images').has('new-image'));
  await store.save('retry', { images: [{ id: 'new-image', blob: newBlob }] }); assert.equal(await store.read(), 'retry'); assert.equal(d.state.stores.get('images').get('new-image').blob, newBlob); mark(errorName + ' retains complete previous workspace/images and retry succeeds');
}
{
  const d = driver(), store = create(d); await store.save('original'); d.state.nextPutFailure = true;
  await assert.rejects(store.save('incoming', { images: [{ id: 'new', blob: new Blob(['new']) }] }), { code: 'WORKSPACE_STORAGE' }); assert.equal(await store.read(), 'original'); assert(!d.state.stores.get('images').has('new')); mark('synchronous put error aborts the whole batch');
  const txBefore = d.state.transactions.length; await assert.rejects(store.save('stale', { isCurrent: () => false }), { code: 'WORKSPACE_CHANGED' }); assert.equal(d.state.transactions.length, txBefore); assert.equal(await store.read(), 'original'); mark('stale prepared workspace is rejected before write');
  d.state.strictUnsupported = true; await store.save('compatible'); assert.equal(await store.read(), 'compatible'); assert(d.state.strictAttempts); mark('older IndexedDB durability-option compatibility');
}
for (const kind of ['blocked', 'error', 'throw']) {
  const d = driver(), store = create(d); d.state.nextOpenFailure = kind;
  await assert.rejects(store.open(), error => error.code === (kind === 'blocked' ? 'WORKSPACE_BLOCKED' : 'WORKSPACE_STORAGE'));
  if (kind === 'blocked') assert(d.lateBlockedSuccess().closed, 'a late success after blocked rejection closes its leaked connection');
  await store.save('after retry'); assert.equal(await store.read(), 'after retry'); mark('failed ' + kind + ' open can be retried safely');
}
{
  const d = driver(), production = create(d), demo = create(d, 'demo'); await production.save('production exact data'); await demo.save('demo exact data'); assert.equal(await production.read(), 'production exact data'); assert.equal(await demo.read(), 'demo exact data'); mark('workspace keys isolate demo and production');
  d.state.stores.get('workspaces').set('production', { id: 'production', version: 999, serialized: 'retain corrupted record' }); await assert.rejects(production.read(), { code: 'WORKSPACE_INVALID' }); assert.equal(d.state.stores.get('workspaces').get('production').serialized, 'retain corrupted record'); mark('invalid existing record is not erased or rewritten');
  await assert.rejects(api.create({ databaseName: 'unavailable', workspaceKey: 'key', indexedDB: null }).read(), { code: 'WORKSPACE_UNAVAILABLE' }); mark('unavailable storage fails without an automatic fallback write');
}
{
  const d = driver(), store = create(d); await store.save('original');
  const blob = new Blob(['captured']), images = [{ id: 'captured-image', blob }], saving = store.save('captured manifest', { images });
  images[0].id = 'mutated-image'; images[0].blob = new Blob(['mutated']); images.push({ id: 'later-image', blob });
  await saving; assert.equal(d.state.stores.get('images').get('captured-image').blob, blob); assert(!d.state.stores.get('images').has('mutated-image')); assert(!d.state.stores.get('images').has('later-image')); mark('image batch inputs are captured before queue execution');
  const beyondFormerCap = JSON.stringify({ version: 4, categories: [{ id: 'synthetic', board: { lanes: [], products: [] } }], completeEvidence: 'x'.repeat(65 * 1024 * 1024) });
  await store.save(beyondFormerCap); assert.equal(await store.read(), beyondFormerCap); mark('full local record above former64MiB application cap remains exact');
}
{
  const d = driver(), first = create(d), second = create(d);
  await first.save('original'); assert.equal(await second.read(), 'original');
  await first.save('accepted first-tab change');
  await assert.rejects(second.save('stale second-tab draft', { images: [{ id: 'unaccepted-image', blob: new Blob(['keep out']) }] }), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(d.state.stores.get('workspaces').get('production').serialized, 'accepted first-tab change');
  assert(!d.state.stores.get('images').has('unaccepted-image'), 'a conflict cannot stage pixels without its metadata');
  assert.equal(await second.read(), 'accepted first-tab change');
  await second.save('explicitly rebased second-tab update');
  assert.equal(await second.read(), 'explicitly rebased second-tab update');
  mark('two observed clients reject stale metadata and images atomically and permit explicit rebase');
}
{
  const d = driver(), store = create(d); await store.save('original');
  let current = true; d.state.holdRequests = true;
  const pending = store.save('stale prepared image change', { images: [{ id: 'stale-image', blob: new Blob(['stale']) }], isCurrent: () => current });
  const rejected = assert.rejects(pending, { code: 'WORKSPACE_CHANGED' });
  await tick(); assert.equal(d.state.requestJobs.length, 1); assert.equal(d.state.transactions.at(-1).operations.length, 0);
  current = false; d.state.requestJobs.shift()(); await rejected; d.state.holdRequests = false;
  assert.equal(await store.read(), 'original'); assert(!d.state.stores.get('images').has('stale-image'));
  mark('current-owner check repeats inside the transaction before any metadata or image put');
}
{
  const d = driver(), store = create(d); await store.open();
  const original = { id: 'production', version: 999, serialized: '\r\n{ damaged saved text\u0000', savedAt: 123, unknownMetadata: { kept: ['all', 'facts'] } };
  d.state.stores.get('workspaces').set('production', original);
  await assert.rejects(store.read(), { code: 'WORKSPACE_INVALID' });
  const recovery = await store.readRecovery(); assert.equal(recovery.rawText, original.serialized);
  recovery.record.unknownMetadata.kept[0] = 'untrusted mutation';
  await assert.rejects(store.save('ordinary write'), { code: 'WORKSPACE_INVALID' });
  const oldBlob = new Blob(['old pixels']); d.state.stores.get('images').set('old', { id: 'old', blob: oldBlob });
  const receipt = await store.recover('validated new data', { recovery, images: [{ id: 'new', blob: new Blob(['new pixels']) }] });
  assert.equal(await store.read(), 'validated new data');
  assert.deepEqual(JSON.parse(JSON.stringify(d.state.stores.get('workspaces').get(receipt.archiveKey).record)), original);
  assert.equal(d.state.stores.get('workspaces').get(receipt.archiveKey).rawText, original.serialized);
  assert.equal(d.state.stores.get('images').get('old').blob, oldBlob);
  await store.rollbackRecovery(receipt);
  assert.deepEqual(JSON.parse(JSON.stringify(d.state.stores.get('workspaces').get('production'))), original);
  assert(!d.state.stores.get('workspaces').has(receipt.archiveKey)); assert(!d.state.stores.get('images').has('new'));
  assert.equal(d.state.stores.get('images').get('old').blob, oldBlob);
  await assert.rejects(store.rollbackRecovery(receipt), { code: 'WORKSPACE_RECOVERY_INVALID' });
  mark('raw corrupt recovery archive and atomic rollback preserve exact original record and preexisting pixels');
}
{
  const d = driver(), store = create(d); await store.open();
  const original = { id: 'production', version: 0, serialized: 'original raw' }; d.state.stores.get('workspaces').set('production', original);
  let recovery = await store.readRecovery(); d.state.nextWriteFailure = 'QuotaExceededError';
  await assert.rejects(store.recover('replacement', { recovery, images: [{ id: 'new', blob: new Blob(['incoming']) }] }), { code: 'WORKSPACE_QUOTA' });
  assert.deepEqual(d.state.stores.get('workspaces').get('production'), original); assert(!d.state.stores.get('images').has('new')); assert.equal(d.state.stores.get('workspaces').size, 1);
  const receipt = await store.recover('replacement', { recovery, images: [{ id: 'new', blob: new Blob(['incoming']) }] });
  d.state.nextWriteFailure = 'QuotaExceededError'; await assert.rejects(store.rollbackRecovery(receipt), { code: 'WORKSPACE_QUOTA' });
  assert.equal(d.state.stores.get('workspaces').get('production').serialized, 'replacement'); assert(d.state.stores.get('images').has('new'));
  assert.deepEqual(JSON.parse(JSON.stringify(d.state.stores.get('workspaces').get(receipt.archiveKey).record)), original);
  await store.rollbackRecovery(receipt); assert.deepEqual(d.state.stores.get('workspaces').get('production'), original);
  mark('recovery and rollback quota failures are atomic and original archive remains retryable');
}
{
  const d = driver(), first = create(d), second = create(d); await first.save('original raw');
  const recovery = await first.readRecovery(); await second.read(); await second.save('accepted other-tab record');
  await assert.rejects(first.recover('stale recovery', { recovery, images: [{ id: 'unaccepted', blob: new Blob(['not saved']) }] }), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(await second.read(), 'accepted other-tab record'); assert(!d.state.stores.get('images').has('unaccepted')); assert.equal(d.state.stores.get('workspaces').size, 1);
  await assert.rejects(second.recover('foreign token', { recovery }), { code: 'WORKSPACE_RECOVERY_INVALID' });
  mark('fresh raw recovery CAS rejects another-tab change and foreign token before staging');
}
{
  const d = driver(), first = create(d), second = create(d); await first.save('original raw');
  const receipt = await first.recover('recovered', { recovery: await first.readRecovery(), images: [{ id: 'new', blob: new Blob(['saved']) }] });
  await second.read(); await second.save('newer accepted changes');
  await assert.rejects(first.rollbackRecovery(receipt), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(await second.read(), 'newer accepted changes'); assert(d.state.stores.get('images').has('new')); assert(d.state.stores.get('workspaces').has(receipt.archiveKey));
  mark('recovery rollback never overwrites a newer saved record or removes its pixels');
}
{
  const d = driver(), store = create(d); await store.save('original');
  let current = true; const recovery = await store.readRecovery(); d.state.holdRequests = true;
  const pending = store.recover('stale replacement', { recovery, isCurrent: () => current, images: [{ id: 'stale', blob: new Blob(['stale']) }] });
  const rejected = assert.rejects(pending, { code: 'WORKSPACE_CHANGED' }); await tick(); current = false; d.state.requestJobs.shift()(); await rejected; d.state.holdRequests = false;
  assert.equal(await store.read(), 'original'); assert(!d.state.stores.get('images').has('stale')); assert.equal(d.state.stores.get('workspaces').size, 1);
  mark('recovery owner fence repeats under transaction lock before any writes');
}
{
  const d = driver(), store = create(d); await store.save('original');
  const originalBlob = new Blob(['original image']); d.state.stores.get('images').set('already-existing', { id: 'already-existing', blob: originalBlob });
  const recovery = await store.readRecovery();
  await assert.rejects(store.recover('replacement', { recovery, images: [{ id: 'already-existing', blob: new Blob(['replacement']) }] }), { code: 'WORKSPACE_RECOVERY_IMAGES' });
  assert.equal(await store.read(), 'original'); assert.equal(d.state.stores.get('images').get('already-existing').blob, originalBlob);
  const receipt = await store.recover('replacement', { recovery, images: [{ id: 'new', blob: new Blob(['new']) }] });
  const newerBlob = new Blob(['changed independently']); d.state.stores.get('images').set('new', { id: 'new', blob: newerBlob });
  await assert.rejects(store.rollbackRecovery(receipt), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(d.state.stores.get('images').get('new').blob, newerBlob); assert.equal(await store.read(), 'replacement'); assert(d.state.stores.get('workspaces').has(receipt.archiveKey));
  mark('recovery rejects existing image IDs and rollback preserves independently replaced pixels');
}
{
  const d = driver(), store = create(d); assert.equal(await store.read(), null);
  const recovery = await store.readRecovery(); assert.equal(recovery.rawText, null); assert.equal(recovery.record, undefined);
  const receipt = await store.recover('legacy replacement', { recovery }); assert.equal(await store.read(), 'legacy replacement');
  await store.rollbackRecovery(receipt); assert.equal(await store.read(), null); assert.equal(d.state.stores.get('workspaces').size, 0);
  mark('legacy recovery with originally missing DB key can restore exact absence');
}
{
  const d = driver(), store = create(d); await store.open();
  const original = { id: 'production', version: 0, serialized: 'raw', metadata: { slots: new Array(3), number: -0, absent: undefined } };
  d.state.stores.get('workspaces').set('production', original);
  const recovery = await store.readRecovery();
  d.state.stores.get('workspaces').set('production', { ...original, metadata: { ...original.metadata, slots: new Array(4) } });
  await assert.rejects(store.recover('stale sparse-array record', { recovery }), { code: 'WORKSPACE_CONFLICT' });
  d.state.stores.get('workspaces').set('production', { ...original, metadata: { ...original.metadata, number: 0 } });
  await assert.rejects(store.recover('stale signed-zero record', { recovery }), { code: 'WORKSPACE_CONFLICT' });
  d.state.stores.get('workspaces').set('production', original);
  const receipt = await store.recover('replacement', { recovery }); await store.rollbackRecovery(receipt);
  const restored = d.state.stores.get('workspaces').get('production'); assert.equal(restored.metadata.slots.length, 3); assert.equal(Object.keys(restored.metadata.slots).length, 0); assert(Object.is(restored.metadata.number, -0)); assert(Object.hasOwn(restored.metadata, 'absent'));
  mark('raw recovery signatures and rollback retain sparse-array length, signed zero and undefined own fields');
}
{
  const d = driver(), first = create(d), second = create(d);
  await first.save('original'); await second.read(); await first.save('same latest bytes');
  await second.save('same latest bytes');
  assert.equal(d.state.transactions.at(-1).operations.length, 0, 'an already saved exact snapshot completes without overwriting metadata or timestamps');
  await second.save('next explicit second-tab change');
  assert.equal(d.state.stores.get('workspaces').get('production').serialized, 'next explicit second-tab change', 'successful identical-byte confirmation advances only that client observation');
  mark('identical no-image snapshots are confirmed without a false conflict or write');
}
{
  const d = driver(), first = create(d), second = create(d);
  await first.save('original'); await second.read(); await first.save('same latest bytes');
  const savedAt = d.state.stores.get('workspaces').get('production').savedAt;
  await assert.rejects(second.save('same latest bytes', { images: [{ id: 'unaccepted-pixels', blob: new Blob(['different pixels']) }] }), { code: 'WORKSPACE_CONFLICT' });
  assert(!d.state.stores.get('images').has('unaccepted-pixels'));
  assert.equal(d.state.stores.get('workspaces').get('production').savedAt, savedAt);
  await assert.rejects(second.save('different local draft'), error => error.code === 'WORKSPACE_CONFLICT' && /in this browser.*different local copy/.test(error.message));
  assert.equal(d.state.stores.get('workspaces').get('production').serialized, 'same latest bytes');
  mark('identical metadata never bypasses stale-image staging or differing-draft protection');
}
console.log('Workspace store checks passed: ' + cases.length + ' bounded durability, quota, migration, atomic image, ordering, recovery CAS/rollback and retry cases.');
