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
const clone = value => JSON.parse(JSON.stringify(value));
const viewFixture = () => ({ version: 4, activeCategoryId: 'first', settings: { roadmapBasis: 'ffs', hashoutCategoryIds: null, hashoutViewport: { start: 24312, end: 24432, zoom: 1 }, hashoutLabelMode: 'default', timeline: { startMonth: '2026-01', endMonth: '2035-12', snap: 'month', statusColors: { 'in-planning': '#343434' }, unknownTimeline: { retain: true } }, unknownSettings: { retain: [null, false, 0, ''] } }, categories: ['first', 'second'].map((id, index) => ({ id, name: id, board: { title: `${id} exact title`, lanes: [{ id: 'lane', order: 0 }], settings: { roadmap: { startMonth: '2026-01', endMonth: '2035-12', familyOrder: ['Keep family'], sourceLabel: { exact: true } }, unknownBoardSettings: { retain: true } }, products: [{ id: `${id}-product`, name: `${id} product`, laneId: 'lane', order: 0, imageAssetId: 'existing-image', ffsDate: '2028-04-01', plc: { version: 1, sourceFile: 'Original.xlsx', fields: { ffsDate: { value: '2028-04-01', period: { precision: 'quarter', basis: 'calendar', year: 2028, quarter: 2, start: '2028-04-01', end: '2028-06-30', label: 'Q2 2028' }, reviewed: true } }, history: [{ exact: 'Evidence' }] }, privateProduct: { retain: ['all', 'facts'] } }] } })), masterLocalBaseline: [{ productId: 'first-product', values: { accepted: true } }], masterLocalMerges: [{ sourceProduct: { exact: 'Undo metadata' }, base: { revisions: { plc: 5 } } }], masterLocalRemovedProducts: { deleted: { id: 'deleted', imageAssetId: 'old-image' } }, masterLocalTombstones: [{ productId: 'deleted', revisions: { '@product': 4 } }], plcReview: { entries: [{ key: 'retain', raw: 'All unresolved source text' }] }, plcSharePending: { patches: [{ productId: 'first-product', patch: { plc: { exact: 'Queued accepted provenance' } } }] }, dateLocalEdits: { 'first-product': { ffsDate: { value: '2028-04-01', source: 'planning' } } }, imageAssets: [{ id: 'existing-image', sourceType: 'local' }, { id: 'old-image', sourceType: 'local' }], loadedPackageInfo: { gitBlobSha: 'a'.repeat(40) }, receipts: [{ signed: 'retain' }], unknownOperational: { exact: { nested: [null, 0, false] } } });
async function diverged(base, current) { const d = driver(), first = create(d), second = create(d); await first.save(JSON.stringify(base)); await second.read(); await first.save(JSON.stringify(current)); return { d, first, second }; }
for (const hidden of [true, false]) {
  const base = viewFixture(); base.categories[0].board.settings.hideDiscontinued = !hidden;
  const latest = clone(base), mine = clone(base);
  latest.categories[0].board.products[0].name = 'Concurrent accepted product'; latest.receipts.push({ exact: 'Latest accepted receipt' });
  mine.categories[0].board.settings.hideDiscontinued = hidden;
  const h = await diverged(base, latest), receipt = await h.second.save(JSON.stringify(mine), { reconcileViews: true });
  const expected = clone(latest); expected.categories[0].board.settings.hideDiscontinued = hidden;
  assert.equal(receipt.reconciled, true); assert.deepEqual(JSON.parse(receipt.serialized), expected);
  assert.equal(await h.second.read(), receipt.serialized);
  const other = clone(base), localFacts = clone(base); other.categories[0].board.settings.hideDiscontinued = hidden;
  localFacts.categories[0].board.products[0].plc.history.push({ exact: 'Local accepted evidence' });
  const inverse = await diverged(base, other), merged = await inverse.second.save(JSON.stringify(localFacts), { reconcileViews: true });
  const inverseExpected = clone(localFacts); inverseExpected.categories[0].board.settings.hideDiscontinued = hidden;
  assert.deepEqual(JSON.parse(merged.serialized), inverseExpected);
}
mark('hideDiscontinued true and false reconcile in both directions while preserving full facts, receipts, images, dates and other-category preferences');
{
  const base = viewFixture(), latest = clone(base), mine = clone(base);
  latest.categories[0].board.products[0].name = 'Accepted fact after legacy workspace';
  mine.categories[0].board.settings.hideDiscontinued = false;
  const h = await diverged(base, latest), merged = await h.second.save(JSON.stringify(mine), { reconcileViews: true });
  const expected = clone(latest); expected.categories[0].board.settings.hideDiscontinued = false;
  assert.deepEqual(JSON.parse(merged.serialized), expected);
  mark('legacy absent discontinued preference safely reconciles the default-show schema leaf');
}
for (const value of ['true', 1, null, [], { hidden: true }]) {
  const base = viewFixture(), latest = clone(base), mine = clone(base);
  latest.categories[0].board.products[0].name = 'Protected latest fact'; mine.categories[0].board.settings.hideDiscontinued = value;
  const h = await diverged(base, latest);
  await assert.rejects(h.second.save(JSON.stringify(mine), { reconcileViews: true }), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(await h.first.read(), JSON.stringify(latest));
}
{
  const base = viewFixture(), latest = clone(base), mine = clone(base);
  latest.categories[0].board.products[0].name = 'Protected latest fact'; mine.categories[0].board.settings.hideUnapproved = true;
  const h = await diverged(base, latest);
  await assert.rejects(h.second.save(JSON.stringify(mine), { reconcileViews: true }), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(await h.first.read(), JSON.stringify(latest));
  mark('nonboolean discontinued shapes and unknown hide settings cannot bypass full-fact CAS');
}
{
  const base = viewFixture(), latest = clone(base), mine = clone(base);
  latest.settings.hashoutLabelMode = 'off'; latest.settings.hashoutWindowsVisible = false; mine.settings.hashoutViewport = { start: 24324, end: 24372, zoom: 2.5 }; mine.settings.hashoutSelectedKey = '["first","first-product"]';
  const h = await diverged(base, latest), receipt = await h.second.save(JSON.stringify(mine), { reconcileViews: true });
  const expected = clone(latest); expected.settings.hashoutViewport = mine.settings.hashoutViewport; expected.settings.hashoutSelectedKey = mine.settings.hashoutSelectedKey;
  assert.equal(receipt.reconciled, true); assert.deepEqual(JSON.parse(receipt.serialized), expected); assert.equal(await h.second.read(), receipt.serialized);
  const next = JSON.parse(receipt.serialized); next.settings.hashoutLabelMode = 'on'; await h.second.save(JSON.stringify(next), { reconcileViews: true }); assert.equal(JSON.parse(await h.second.read()).settings.hashoutLabelMode, 'on');
  mark('two Hashout-only saves reconcile full metadata and advance the committing client observation');
}
{
  const base = viewFixture(), latest = clone(base), mine = clone(base); latest.settings.hashoutWindowsVisible = false; mine.categories[0].board.products[0].name = 'Reviewed local product correction'; mine.plcReview.entries.push({ raw: 'New local review' }); mine.masterLocalMerges[0].sourceProduct.extra = 'New undo metadata';
  const h = await diverged(base, latest), receipt = await h.second.save(JSON.stringify(mine), { reconcileViews: true }), expected = clone(mine); expected.settings.hashoutWindowsVisible = false;
  assert.deepEqual(JSON.parse(receipt.serialized), expected); mark('proposed business edits retained exactly when latest changes are view-only');
}
{
  const base = viewFixture(), latest = clone(base), mine = clone(base); latest.categories[0].board.products[0].plc.history.push({ accepted: 'New master evidence' }); latest.receipts.push({ exact: 'Accepted new receipt' }); latest.imageAssets.push({ id: 'new-master-image', sourceType: 'local' }); latest.masterLocalBaseline[0].newFact = 'Retain'; mine.settings.hashoutLabelMode = 'on';
  const h = await diverged(base, latest), receipt = await h.second.save(JSON.stringify(mine), { reconcileViews: true }), expected = clone(latest); expected.settings.hashoutLabelMode = 'on';
  assert.deepEqual(JSON.parse(receipt.serialized), expected); mark('latest entire business/source/master/image/receipt state retained when proposed changes are view-only');
}
for (const mutate of [value => { value.unknownOperational.newFact = 'protected'; }, value => { value.settings.unknownSettings = null; }, value => { value.settings.timeline.snap = 'quarter'; }, value => { value.categories[0].board.settings.unknownBoardSettings = { protected: true }; }, value => { value.categories[0].board.products[0].plc.fields.ffsDate.reviewed = false; }]) {
  const base = viewFixture(), latest = clone(base), mine = clone(base); latest.categories[0].board.products[0].name = 'Concurrent accepted fact'; mutate(mine);
  const h = await diverged(base, latest); await assert.rejects(h.second.save(JSON.stringify(mine), { reconcileViews: true }), { code: 'WORKSPACE_CONFLICT' }); assert.equal(h.d.state.stores.get('workspaces').get('production').serialized, JSON.stringify(latest));
}
mark('unknown operational fields, settings siblings, timeline snap, board settings and PLC evidence never bypass two-fact CAS');
{
  const base = viewFixture(), latest = clone(base), mine = clone(base); delete base.settings.hashoutWindowsVisible; delete latest.settings.hashoutWindowsVisible; delete mine.settings.hashoutWindowsVisible;
  latest.settings.hashoutWindowsVisible = null; latest.settings.hashoutCategoryIds = ['first']; delete mine.settings.hashoutCategoryIds; mine.settings.hashoutViewport = null;
  const h = await diverged(base, latest), receipt = await h.second.save(JSON.stringify(mine), { reconcileViews: true }), output = JSON.parse(receipt.serialized);
  assert.equal(output.settings.hashoutWindowsVisible, null); assert.equal(output.settings.hashoutViewport, null); assert.equal(Object.hasOwn(output.settings, 'hashoutCategoryIds'), false); assert.deepEqual(output.settings.unknownSettings, base.settings.unknownSettings);
  mark('view three-way merge preserves deliberate absence versus null and unknown nested facts');
}
{
  const base = viewFixture(), latest = clone(base), mine = clone(base); latest.settings = null; mine.settings.hashoutLabelMode = 'on';
  const h = await diverged(base, latest), receipt = await h.second.save(JSON.stringify(mine), { reconcileViews: true }); assert.equal(JSON.parse(receipt.serialized).settings, null);
  mark('a view field cannot replace a concurrently accepted null/scalar settings container');
}
{
  const base = viewFixture(), latest = clone(base), mine = clone(base);
  latest.categories.reverse(); latest.categories.push({ id: 'new-category', board: { products: [{ id: 'new-product', source: 'retained' }], lanes: [] } }); latest.categories[1].board.products.push({ id: 'new-fact', raw: 'Accepted latest product' });
  mine.categories[0].board.settings.roadmap.startMonth = '2027-01'; mine.settings.timeline.startMonth = '2027-01';
  const h = await diverged(base, latest), receipt = await h.second.save(JSON.stringify(mine), { reconcileViews: true }), output = JSON.parse(receipt.serialized);
  assert.deepEqual(output.categories.map(category => category.id), ['second', 'first', 'new-category']); assert.equal(output.categories[1].board.settings.roadmap.startMonth, '2027-01'); assert.equal(output.categories[0].board.settings.roadmap.startMonth, '2026-01'); assert.equal(output.categories[1].board.products.at(-1).id, 'new-fact'); assert.equal(output.categories[2].board.products[0].source, 'retained');
  const removed = clone(base); removed.categories.shift(); const r = await diverged(base, removed); const reduced = JSON.parse((await r.second.save(JSON.stringify(mine), { reconcileViews: true })).serialized); assert.deepEqual(reduced.categories.map(category => category.id), ['second']);
  mark('category identity controls range overlays without losing reordered/new categories or resurrecting deleted categories');
}
{
  const base = viewFixture(), latest = clone(base), mine = clone(base); latest.settings.hashoutLabelMode = 'off'; mine.settings.hashoutWindowsVisible = false;
  const h = await diverged(base, latest); await assert.rejects(h.second.save(JSON.stringify(mine)), { code: 'WORKSPACE_CONFLICT' }); await assert.rejects(h.second.save(JSON.stringify(mine), { reconcileViews: true, images: [{ id: 'unaccepted-image', blob: new Blob(['no']) }] }), { code: 'WORKSPACE_CONFLICT' }); assert(!h.d.state.stores.get('images').has('unaccepted-image'));
  const ownerDriver = driver(), owner = create(ownerDriver); await owner.save(JSON.stringify(base)); const image = new Blob(['valid same-manifest pixels']); await owner.save(JSON.stringify(base), { images: [{ id: 'same-manifest', blob: image }], reconcileViews: true }); assert.equal(ownerDriver.state.stores.get('images').get('same-manifest').blob, image);
  mark('opt-in is required and image batches always retain strict CAS and normal same-manifest image writes');
}
{
  const base = viewFixture(); delete base.settings.timeline; delete base.categories[0].board.settings; const latest = clone(base), mine = clone(base);
  latest.settings.timeline = { startMonth: '2025-01', endMonth: '2034-12' }; latest.categories[0].board.settings = { showSkus: false };
  mine.categories[0].board.settings = { showPrices: true }; mine.settings.hashoutLabelMode = 'on';
  const h = await diverged(base, latest), output = JSON.parse((await h.second.save(JSON.stringify(mine), { reconcileViews: true })).serialized);
  assert.equal(output.categories[0].board.settings.showSkus, false); assert.equal(output.categories[0].board.settings.showPrices, true); assert.deepEqual(output.settings.timeline, latest.settings.timeline); assert.equal(output.settings.hashoutLabelMode, 'on');
  const unknown = clone(latest); unknown.settings.timeline.unknownSource = { accepted: true }; const changed = clone(mine); changed.categories[0].board.products[0].name = 'Local fact'; const blocked = await diverged(base, unknown); await assert.rejects(blocked.second.save(JSON.stringify(changed), { reconcileViews: true }), { code: 'WORKSPACE_CONFLICT' });
  mark('legacy absent view containers reconcile without stripping unknown timeline or board children');
}
{
  const base = viewFixture(), latest = clone(base), mine = clone(base); latest.settings.hashoutViewport.unknownSource = { accepted: ['never', 'drop'] }; mine.settings.hashoutViewport = { start: 24330, end: 24378, zoom: 2.5 };
  const h = await diverged(base, latest), output = JSON.parse((await h.second.save(JSON.stringify(mine), { reconcileViews: true })).serialized);
  assert.deepEqual(output.settings.hashoutViewport, { ...mine.settings.hashoutViewport, unknownSource: latest.settings.hashoutViewport.unknownSource });
  const cleared = clone(base); cleared.settings.hashoutViewport = null; const clear = await diverged(base, latest); const preserved = JSON.parse((await clear.second.save(JSON.stringify(cleared), { reconcileViews: true })).serialized); assert.deepEqual(preserved.settings.hashoutViewport, { unknownSource: latest.settings.hashoutViewport.unknownSource });
  const changedFacts = clone(base); changedFacts.categories[0].board.products[0].name = 'Local accepted fact'; const blocked = await diverged(base, latest); await assert.rejects(blocked.second.save(JSON.stringify(changedFacts), { reconcileViews: true }), { code: 'WORKSPACE_CONFLICT' });
  mark('viewport known coordinates remain coherent while unknown nested facts survive view updates and clears');
}
{
  const base = viewFixture(), latest = clone(base), mine = clone(base); latest.categories[0].board.products[0].name = mine.categories[0].board.products[0].name = 'Same concurrent fact'; latest.settings.hashoutLabelMode = 'off'; mine.settings.hashoutWindowsVisible = false;
  const h = await diverged(base, latest); await assert.rejects(h.second.save(JSON.stringify(mine), { reconcileViews: true }), { code: 'WORKSPACE_CONFLICT' });
  mark('two independently changed business snapshots retain strict CAS even when their changed facts happen to match');
}
for (const prefer of ['open', 'saved']) {
  const d = driver(), store = create(d), savedText = ' \r\n' + JSON.stringify(viewFixture(), null, 2) + '\n', open = viewFixture(); open.categories[0].board.products[0].name = 'Open exact edits'; const openText = '\n' + JSON.stringify(open, null, 1) + ' \n';
  await store.save(savedText); const original = d.state.stores.get('workspaces').get('production'); original.unknownStructuredMetadata = { exact: [null, 'retain outside JSON'] };
  const oldBlob = new Blob(['unchanged image']); d.state.stores.get('images').set('existing-image', { id: 'existing-image', blob: oldBlob });
  const recovery = await store.readRecovery(), result = await store.resolveLocalConflict(openText, { recovery, prefer, isCurrent: () => true });
  assert.equal(result.serialized, prefer === 'open' ? openText : savedText); assert.equal(result.copies.length, 2); assert.equal(await store.read(), result.serialized); assert.equal(d.state.stores.get('images').get('existing-image').blob, oldBlob);
  const reloaded = create(d), copies = await reloaded.listLocalCopies(); assert.equal(copies.length, 2); assert.equal(copies.find(copy => copy.kind === 'open').serialized, openText); assert.equal(copies.find(copy => copy.kind === 'saved').serialized, savedText); assert.equal(d.state.transactions.at(-1).mode, 'readonly'); assert.equal(d.state.transactions.at(-1).operations.length, 0);
  const savedArchive = d.state.stores.get('workspaces').get(result.copies.find(copy => copy.kind === 'saved').id); assert.deepEqual(clone(savedArchive.record), clone(original));
  if (prefer === 'saved') assert.deepEqual(clone(d.state.stores.get('workspaces').get('production')), clone(original));
  await assert.rejects(store.resolveLocalConflict(openText, { recovery, prefer }), { code: 'WORKSPACE_RECOVERY_INVALID' });
  mark(`explicit ${prefer} choice archives both exact copies/full saved record atomically and survives reload without image changes`);
}
{
  const d = driver(), store = create(d), other = create(d); await store.save('saved raw'); const token = await store.readRecovery(); await other.read(); await other.save('accepted newer raw');
  const before = d.state.stores.get('workspaces').size; await assert.rejects(store.resolveLocalConflict('open raw', { recovery: token, prefer: 'open' }), { code: 'WORKSPACE_CONFLICT' }); assert.equal(d.state.stores.get('workspaces').size, before); assert.equal(d.state.stores.get('workspaces').get('production').serialized, 'accepted newer raw');
  await assert.rejects(other.resolveLocalConflict('open raw', { recovery: token, prefer: 'saved' }), { code: 'WORKSPACE_RECOVERY_INVALID' });
  const fresh = await store.readRecovery(); let current = true; d.state.holdRequests = true; const saving = store.resolveLocalConflict('open raw', { recovery: fresh, prefer: 'open', isCurrent: () => current }), rejected = assert.rejects(saving, { code: 'WORKSPACE_CHANGED' }); await tick(); current = false; d.state.requestJobs.shift()(); await rejected; d.state.holdRequests = false; assert.equal(d.state.stores.get('workspaces').size, before);
  mark('stale/foreign recovery tokens and late open-copy owner changes produce zero archive or active-record writes');
}
{
  const d = driver(), store = create(d); await store.save('saved exact'); const token = await store.readRecovery(); d.state.nextWriteFailure = 'QuotaExceededError';
  await assert.rejects(store.resolveLocalConflict('open exact', { recovery: token, prefer: 'open' }), { code: 'WORKSPACE_QUOTA' }); assert.equal(d.state.stores.get('workspaces').size, 1); assert.equal(await store.read(), 'saved exact'); assert.equal((await store.listLocalCopies()).length, 0);
  await store.resolveLocalConflict('open exact', { recovery: token, prefer: 'open' }); assert.equal((await store.listLocalCopies()).length, 2);
  mark('local-copy resolution quota abort preserves active record and permits retry with the same reviewed token');
}
{
  const d = driver(), store = create(d); await store.save('saved exact'); const token = await store.readRecovery(); d.state.nextPutFailure = true;
  await assert.rejects(store.resolveLocalConflict('open exact', { recovery: token, prefer: 'open' }), { code: 'WORKSPACE_STORAGE' }); assert.equal(d.state.stores.get('workspaces').size, 1); assert.equal(await store.read(), 'saved exact');
  const result = await store.resolveLocalConflict('open exact', { recovery: token, prefer: 'open' }); const copy = d.state.stores.get('workspaces').get(result.copies[0].id); copy.version = 999;
  await assert.rejects(store.listLocalCopies(), { code: 'WORKSPACE_LOCAL_COPIES_INVALID' }); assert.equal(await store.read(), 'open exact'); assert.equal(copy.version, 999);
  mark('synchronous archive errors abort atomically and corrupt archive inspection never overwrites retained records');
}
{
  const d = driver(), store = create(d); await store.save('saved exact');
  for (let index = 0; index < 10; index++) await store.resolveLocalConflict(`open exact ${index}`, { recovery: await store.readRecovery(), prefer: index % 2 ? 'saved' : 'open' });
  const before = [...d.state.stores.get('workspaces')].filter(([key]) => key.includes(':local-conflict:')).map(([key, value]) => [key, clone(value)]); assert.equal((await store.listLocalCopies()).length, 20);
  await store.resolveLocalConflict('eleventh exact', { recovery: await store.readRecovery(), prefer: 'open' });
  for (const [key, value] of before) assert.deepEqual(clone(d.state.stores.get('workspaces').get(key)), value);
  assert.equal(await store.read(), 'eleventh exact'); assert.equal((await store.listLocalCopies()).length, 22);
  mark('local-copy manifest admits more than10sets under actual quota and never deletes preserved user copies');
}
{
  const base = viewFixture(), latest = clone(base); latest.settings.hashoutLabelMode = 'off'; const h = await diverged(base, latest);
  await h.second.listLocalCopies(); await assert.rejects(h.second.save(JSON.stringify({ ...base, unknownOperational: { changed: true } })), { code: 'WORKSPACE_CONFLICT' });
  mark('listing local copies never rebases a stale writer or changes its observation fence');
}
{
  const d = driver(), store = create(d), active = viewFixture(); active.imageAssets = [{ id: 'registry-only', sourceType: 'local' }]; active.categories[0].board.products[0].imageAssetId = 'product-only'; active.masterLocalRemovedProducts = { removed: { nested: { imageAssetId: 'undo-only' } } }; const activeRaw = JSON.stringify(active); await store.save(activeRaw);
  const archived = clone(active); archived.imageAssets.push({ id: 'archive-registry', sourceType: 'local' }); archived.privateArchive = { arbitrary: [{ imageAssetId: 'archive-recursive' }] }; await store.resolveLocalConflict(JSON.stringify(archived), { recovery: await store.readRecovery(), prefer: 'saved' });
  const protectedIds = ['registry-only', 'product-only', 'undo-only', 'archive-registry', 'archive-recursive']; for (const id of [...protectedIds, 'unused']) d.state.stores.get('images').set(id, { id, blob: new Blob([id]) });
  const beforeWorkspaces = [...d.state.stores.get('workspaces')].map(([id, record]) => [id, clone(record)]);
  const receipt = await store.deleteUnusedImages([...protectedIds, 'unused', 'unused']);
  assert.deepEqual(Array.from(receipt.deleted), ['unused']); assert.deepEqual(new Set(receipt.retained), new Set(protectedIds)); for (const id of protectedIds) assert(d.state.stores.get('images').has(id)); assert(!d.state.stores.get('images').has('unused'));
  assert.deepEqual([...d.state.stores.get('workspaces')].map(([id, record]) => [id, clone(record)]), beforeWorkspaces); assert.deepEqual(Array.from(d.state.transactions.at(-1).names).sort(), ['images', 'workspaces']); assert(d.state.transactions.at(-1).operations.every(operation => operation.name === 'images' && operation.deletedKey));
  mark('same-transaction image cleanup protects complete active/archived registries, products, nested undo/source references without semantic data writes');
}
{
  const d = driver(), deleting = create(d), resolving = create(d), activeRaw = JSON.stringify({ version: 4, categories: [], imageAssets: [] }); await deleting.save(activeRaw); const token = await resolving.readRecovery(); assert.equal((await deleting.listLocalCopies()).length, 0);
  const blob = new Blob(['archive pixels']); d.state.stores.get('images').set('racing-archive-image', { id: 'racing-archive-image', blob }); d.state.stores.get('images').set('racing-unused-image', { id: 'racing-unused-image', blob: new Blob(['unused']) });
  d.state.holdRequests = true; const cleanup = deleting.deleteUnusedImages(['racing-archive-image', 'racing-unused-image']); await tick(); const resolvingCopy = resolving.resolveLocalConflict(JSON.stringify({ version: 4, categories: [], sourceEvidence: { imageAssetId: 'racing-archive-image' } }), { recovery: token, prefer: 'saved' }); await tick(); assert.equal(d.state.requestJobs.length, 2);
  // Let archive creation complete before the held GC transaction reads its
  // manifest. Native IndexedDB serializes these scopes; this double forces the
  // relevant ordering while verifying the manifest is not cached beforehand.
  d.state.requestJobs.splice(1, 1)[0](); await resolvingCopy; d.state.requestJobs.shift()(); await cleanup; d.state.holdRequests = false;
  assert.equal(d.state.stores.get('images').get('racing-archive-image').blob, blob); assert(!d.state.stores.get('images').has('racing-unused-image')); assert.equal((await deleting.listLocalCopies()).length, 2);
  mark('archive created before GC transaction reads is inspected afresh under the shared workspace/image lock');
}
{
  const d = driver(), store = create(d); await store.save(JSON.stringify({ version: 4, categories: [], imageAssets: [] })); const result = await store.resolveLocalConflict('{ invalid archived source', { recovery: await store.readRecovery(), prefer: 'saved' }); const blob = new Blob(['must stay']); d.state.stores.get('images').set('keep-on-parse-error', { id: 'keep-on-parse-error', blob });
  await assert.rejects(store.deleteUnusedImages(['keep-on-parse-error']), { code: 'WORKSPACE_LOCAL_COPIES_INVALID' }); assert.equal(d.state.stores.get('images').get('keep-on-parse-error').blob, blob); assert(d.state.stores.get('workspaces').has(result.copies[0].id));
  mark('unreadable archived JSON holds the entire image deletion batch and retains all source copies');
}
{
  const base = viewFixture(), latest = clone(base); latest.settings.hashoutLabelMode = 'off'; const h = await diverged(base, latest); await h.second.deleteUnusedImages(['unused']);
  await assert.rejects(h.second.save(JSON.stringify(base)), { code: 'WORKSPACE_CONFLICT' });
  mark('image cleanup never rebases a stale workspace observation');
}
{
  const base = viewFixture(), latest = clone(base), proposed = clone(base); latest.unknownOperational.acceptedSource = { exact: 'Other tab source canary' }; proposed.settings.hashoutLabelMode = 'on';
  const h = await diverged(base, latest); let owner = clone(proposed); h.d.state.holdWrite = true;
  const pending = h.second.save(JSON.stringify(owner), { reconcileViews: true, isCurrent: () => JSON.stringify(owner) === JSON.stringify(proposed) }); await tick(); const transaction = h.d.state.transactions.at(-1); assert(transaction.requestEventsDone);
  transaction.complete(); owner.categories[0].board.products[0].name = 'New local edit after IDB COMPLETE, before receipt adoption'; const receipt = await pending; h.d.state.holdWrite = false;
  assert.equal(receipt.reconciled, true); assert.equal(JSON.parse(receipt.serialized).unknownOperational.acceptedSource.exact, 'Other tab source canary');
  await assert.rejects(h.second.save(JSON.stringify(owner), { reconcileViews: true }), { code: 'WORKSPACE_CONFLICT' }); assert.equal(JSON.parse(h.d.state.stores.get('workspaces').get('production').serialized).unknownOperational.acceptedSource.exact, 'Other tab source canary'); assert.equal(owner.categories[0].board.products[0].name, 'New local edit after IDB COMPLETE, before receipt adoption');
  mark('IDB COMPLETE before host adoption cannot advance its known facts or let a later edit erase a concurrent unknown source');
}
{
  const base = viewFixture(), latest = clone(base), proposed = clone(base); latest.unknownOperational.acceptedSource = { exact: 'Keep after acknowledged adoption' }; proposed.settings.hashoutLabelMode = 'on';
  const h = await diverged(base, latest), receipt = await h.second.save(JSON.stringify(proposed), { reconcileViews: true }); const adopted = JSON.parse(receipt.serialized);
  assert.equal(h.second.acknowledgeReconciled(receipt), true); adopted.categories[0].board.products[0].name = 'New edit after full receipt adoption'; await h.second.save(JSON.stringify(adopted), { reconcileViews: true }); assert.equal(JSON.parse(h.d.state.stores.get('workspaces').get('production').serialized).unknownOperational.acceptedSource.exact, 'Keep after acknowledged adoption');
  assert.throws(() => h.second.acknowledgeReconciled(receipt), { code: 'WORKSPACE_RECONCILE_INVALID' });
  mark('explicit authentic receipt acknowledgment permits later edits only after adopting all retained facts');
}
{
  const base = viewFixture(), latest = clone(base), proposed = clone(base); latest.unknownOperational.acceptedSource = 'Retained'; proposed.settings.hashoutLabelMode = 'on';
  const h = await diverged(base, latest), firstReceipt = await h.second.save(JSON.stringify(proposed), { reconcileViews: true }); proposed.settings.hashoutWindowsVisible = false; const secondReceipt = await h.second.save(JSON.stringify(proposed), { reconcileViews: true });
  assert.throws(() => h.second.acknowledgeReconciled(firstReceipt), { code: 'WORKSPACE_RECONCILE_STALE' }); assert.throws(() => h.second.acknowledgeReconciled({ ...secondReceipt }), { code: 'WORKSPACE_RECONCILE_INVALID' }); assert.throws(() => h.first.acknowledgeReconciled(secondReceipt), { code: 'WORKSPACE_RECONCILE_INVALID' }); assert.equal(h.second.acknowledgeReconciled(secondReceipt), true);
  const viewOnly = JSON.parse(secondReceipt.serialized); viewOnly.settings.hashoutLabelMode = 'off'; await h.first.read(); await h.first.save(JSON.stringify(viewOnly)); proposed.settings.hashoutLabelMode = 'default'; const supersededByRead = await h.second.save(JSON.stringify(proposed), { reconcileViews: true }); await h.second.read(); assert.throws(() => h.second.acknowledgeReconciled(supersededByRead), { code: 'WORKSPACE_RECONCILE_STALE' });
  mark('stale, forged, foreign and read-superseded reconciliation receipts cannot rebase a writer');
}
for (const operation of ['choose-saved', 'restore-archive']) {
  const baseline = viewFixture(), chosen = clone(baseline); chosen.unknownOperational.acceptedSource = { exact: `${operation} chosen source must survive` };
  const baselineText = JSON.stringify(baseline), chosenText = '\n' + JSON.stringify(chosen, null, 2) + ' \n';
  const d = driver(), store = create(d); await store.save(operation === 'choose-saved' ? chosenText : baselineText);
  const recovery = await store.readRecovery(), sourceText = operation === 'choose-saved' ? baselineText : chosenText;
  let owner = clone(baseline); d.state.holdWrite = true;
  const pending = store.resolveLocalConflict(sourceText, { recovery, prefer: operation === 'choose-saved' ? 'saved' : 'open', requireAdoption: true, adoptionBaseline: baselineText, isCurrent: () => JSON.stringify(owner) === baselineText });
  await tick(); const transaction = d.state.transactions.at(-1); assert(transaction.requestEventsDone);
  transaction.complete(); owner.categories[0].board.products[0].name = `${operation} newer owner edit after COMPLETE`; const receipt = await pending; d.state.holdWrite = false;
  assert.equal(receipt.requiresAcknowledgement, true); assert.equal(receipt.serialized, chosenText);
  const copies = await store.listLocalCopies(); assert.equal(copies.length, 2); assert.equal(copies.find(copy => copy.kind === 'open').serialized, sourceText); assert.equal(copies.find(copy => copy.kind === 'saved').serialized, operation === 'choose-saved' ? chosenText : baselineText);
  await assert.rejects(store.save(JSON.stringify(owner), { reconcileViews: true }), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(d.state.stores.get('workspaces').get('production').serialized, chosenText, 'a newer owner edit cannot erase a recovered or restored source before host adoption');
  assert.equal(owner.categories[0].board.products[0].name, `${operation} newer owner edit after COMPLETE`);
  assert.throws(() => store.acknowledgeReconciled({ ...receipt }), { code: 'WORKSPACE_RECONCILE_INVALID' });
  const adopted = JSON.parse(receipt.serialized); assert.equal(store.acknowledgeReconciled(receipt), true);
  adopted.categories[0].board.products[0].name = `${operation} edit after authentic host adoption`; await store.save(JSON.stringify(adopted), { reconcileViews: true });
  assert.deepEqual(JSON.parse(d.state.stores.get('workspaces').get('production').serialized).unknownOperational.acceptedSource, chosen.unknownOperational.acceptedSource);
  assert.throws(() => store.acknowledgeReconciled(receipt), { code: 'WORKSPACE_RECONCILE_INVALID' });
  mark(`${operation} COMPLETE race keeps actual owner baseline until authentic acknowledgment, preserves both originals and then safely continues`);
}
{
  const d = driver(), store = create(d), text = JSON.stringify(viewFixture()); await store.save(text); const recovery = await store.readRecovery(), transactionCount = d.state.transactions.length;
  for (const adoptionBaseline of [undefined, null, {}, '{broken']) await assert.rejects(store.resolveLocalConflict(text, { recovery, prefer: 'open', requireAdoption: true, adoptionBaseline }), { code: 'WORKSPACE_RECOVERY_INVALID' });
  assert.equal(d.state.transactions.length, transactionCount); assert.equal(d.state.stores.get('workspaces').size, 1);
  const first = await store.resolveLocalConflict(text, { recovery, prefer: 'open', requireAdoption: true, adoptionBaseline: text });
  const second = await store.resolveLocalConflict(text, { recovery: await store.readRecovery(), prefer: 'saved', requireAdoption: true, adoptionBaseline: text });
  assert.throws(() => store.acknowledgeReconciled(first), { code: 'WORKSPACE_RECONCILE_STALE' }); assert.equal(store.acknowledgeReconciled(second), true);
  mark('adoption recovery requires valid JSON baseline before any transaction and shares normal receipt sequencing');
}
for (const selection of [[], ['all'], ['launched', 'in-development'], ['embargo', 'in-planning', 'embargo']]) {
  for (const factSide of ['current', 'proposed']) {
    const base = viewFixture(), latest = clone(base), mine = clone(base);
    const views = factSide === 'current' ? mine : latest, facts = factSide === 'current' ? latest : mine;
    views.categories[0].board.settings.catalogGroups = selection;
    facts.categories[0].board.products[0].name = 'Accepted concurrent fact';
    const h = await diverged(base, latest), receipt = await h.second.save(JSON.stringify(mine), { reconcileViews: true });
    const expected = clone(facts); expected.categories[0].board.settings.catalogGroups = selection;
    assert.deepEqual(JSON.parse(receipt.serialized), expected, 'bounded multi-selection is a view leaf, while every concurrent fact survives exactly');
    assert.equal(await h.second.read(), receipt.serialized);
  }
  mark('multi-select ' + JSON.stringify(selection) + ' reconciles with business edits in either direction');
}
for (const malformed of [null, false, 'launched', {}, ['unknown'], ['all', 'launched'], [null], Array(33).fill('launched')]) {
  for (const target of ['baseline', 'proposed', 'current']) {
    const base = viewFixture(), latest = clone(base), mine = clone(base);
    ({ baseline: base, proposed: mine, current: latest })[target].categories[0].board.settings.catalogGroups = malformed;
    latest.categories[0].board.products[0].name = 'Concurrent accepted fact';
    mine.settings.hashoutLabelMode = 'on';
    const h = await diverged(base, latest);
    await assert.rejects(h.second.save(JSON.stringify(mine), { reconcileViews: true }), { code: 'WORKSPACE_CONFLICT' });
    assert.equal(h.d.state.stores.get('workspaces').get('production').serialized, JSON.stringify(latest), 'invalid selections cannot bypass the complete-fact CAS guard');
  }
  mark('invalid multi-select ' + JSON.stringify(malformed) + ' refuses reconciliation from every snapshot side');
}
{
  const base = viewFixture(); base.categories[0].board.settings.catalogGroups = ['launched', 'in-development'];
  const latest = clone(base), mine = clone(base); latest.categories[0].board.products[0].name = 'Accepted source';
  delete mine.categories[0].board.settings.catalogGroups;
  const h = await diverged(base, latest), output = JSON.parse((await h.second.save(JSON.stringify(mine), { reconcileViews: true })).serialized);
  const expected = clone(latest); delete expected.categories[0].board.settings.catalogGroups;
  assert.deepEqual(output, expected, 'deliberately removing a new selection restores legacy absence without altering facts');
  mark('multi-select absence remains distinct from explicit none during concurrent saves');
}
console.log('Workspace store checks passed: ' + cases.length + ' bounded durability, quota, atomic images, opt-in view reconciliation/adoption, full-fact CAS, both-copy local recovery/adoption, recovery rollback, archive-aware transactional image cleanup and retry cases.');
