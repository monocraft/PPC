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
  const state = { version: 1, stores: new Map([['images', new Map()]]), keys: new Map([['images', 'id']]), connections: [], transactions: [], openCalls: 0, strictAttempts: 0, clears: 0, holdRead: false, holdWrite: false, nextOpenFailure: '', nextWriteFailure: '', nextPutFailure: false, strictUnsupported: false, blockedRequest: null };
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
            clear() { state.clears++; throw new Error('Store clearing is forbidden in these durability cases'); },
          }; },
          abort() { if (tx.finished) return; tx.aborted = true; queueMicrotask(() => tx.complete()); },
          complete() {
            if (tx.finished) return;
            tx.finished = true;
            if (tx.mode === 'readwrite' && state.nextWriteFailure) { tx.error = failure(state.nextWriteFailure); state.nextWriteFailure = ''; tx.aborted = true; }
            if (tx.aborted) { tx.onabort?.(); return; }
            for (const { name, record } of tx.operations) state.stores.get(name).set(record[state.keys.get(name)], record);
            tx.oncomplete?.();
          },
        };
        state.transactions.push(tx);
        queueMicrotask(() => {
          for (const { request, name, key } of tx.requests) { request.result = state.stores.get(name).get(key); request.onsuccess?.(); }
          tx.requestEventsDone = true;
          if (!(mode === 'readonly' ? state.holdRead : state.holdWrite)) queueMicrotask(() => tx.complete());
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
console.log('Workspace store checks passed: ' + cases.length + ' bounded durability, quota, migration, atomic image, ordering and retry cases.');
