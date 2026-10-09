import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../public/js/portfolio-model.js';
import '../../public/js/master-model.js';
import '../../public/js/master-client.js';
import '../../public/js/plc-import.js';

// Invented records and an in-memory master exercise the real workspace commit
// functions without loading private files or contacting any shared service.
const source = await readFile(new URL('../../public/js/app.js', import.meta.url), 'utf8');
const importer = globalThis.PLCImporter, model = globalThis.PortfolioMasterModel;
const clone = (value) => JSON.parse(JSON.stringify(value));
const firstAt = '2026-10-09T16:00:00.000Z';
const seed = {
  version: 4, activeCategoryId: 'pc-gaming-audio', categories: [{ id: 'pc-gaming-audio', board: { lanes: [{ id: 'wired' }], products: [{
    id: 'synthetic-product', laneId: 'wired', name: 'Synthetic headset', codename: 'Synthetic project',
    ffsDate: '2026-10-01', generalAvailabilityDate: '2026-12-01', finalAssetsDate: '2026-10-15',
    roadmap: { startMonth: '2026-12', endMonth: '2029-12' },
    specs: [{ id: 'battery', label: 'Battery', value: '40 hours' }], partSkus: [], variantGroups: [],
  }] } }],
};
const currentProduct = (workspace) => workspace.categories[0].board.products[0];
function dataset({ fingerprint = 'synthetic-biweekly-source', reportDate = '2026-10-08', ffsDate = '2026-11-05' } = {}) {
  return { metadata: { fileName: 'Synthetic PLC.xlsx', fingerprint, reportDate, reportDateBasis: 'Explicit workbook report date' }, rows: [{
    key: 'synthetic-row', productId: 'synthetic-product', name: 'Synthetic headset', codename: 'Synthetic project', categoryId: 'pc-gaming-audio',
    reportDate, stage: 'Development', status: 'On schedule', dates: {
      ffsDate: { ...importer.parseDate(ffsDate), source: { sheet: 'Synthetic PLC', cell: 'F4' } },
      generalAvailabilityDate: { ...importer.parseDate('Q1 2027'), source: { sheet: 'Synthetic PLC', cell: 'I4' } },
    }, sources: [{ sheet: 'Synthetic PLC', row: 4 }], milestones: {}, data: {},
  }], diagnostics: [] };
}

function harness({ initial = seed, failStorage = false } = {}) {
  let remote = clone(seed), stored = JSON.stringify(initial), storageBlocked = failStorage, session;
  const calls = { saves: [], writes: [], applies: 0, renders: 0, scoped: 0 }, timers = new Map(), clock = { value: firstAt };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.value])); }
    static now() { return Date.parse(clock.value); }
  }
  const sandbox = {
    Date: ClockDate, TextEncoder, MAX_PACKAGE_MANIFEST_BYTES: 16 * 1024 * 1024, STORAGE_KEY: 'synthetic-workspace', PREVIOUS_STORAGE_KEY: 'synthetic-previous',
    portfolio: clone(initial), localDateBaseline: importer.snapshotDateValues(initial), packageOperationInProgress: false, saveTimer: 0,
    activeCategoryId: 'pc-gaming-audio', PortfolioModel: globalThis.PortfolioModel, PortfolioMasterModel: model,
    PLCImporter: { ...importer, applyPlan(...args) { calls.applies += 1; return importer.applyPlan(...args); }, recordDateChanges(before, portfolio, options = {}) { return importer.recordDateChanges(before, portfolio, { now: clock.value, ...options }); } },
    ensurePortfolioSchema: (draft) => clone(draft), activateCategory() { calls.renders += 1; }, renderInspector() {}, renderActiveView() {},
    setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
    localStorage: { setItem(key, text) { assert.equal(key, 'synthetic-workspace'); if (storageBlocked) throw new Error('Synthetic browser quota exceeded'); stored = text; calls.writes.push(JSON.parse(text)); }, removeItem() {} },
    PortfolioMasterUI: {
      getSession: () => session, updateStatus() {},
      async saveScoped(options) { calls.scoped += 1; return session.saveScoped(options); },
    },
  };
  sandbox.portfolio.masterLocalBaseline ||= model.snapshot(seed).products;
  const adapter = {
    getProducts: () => sandbox.portfolio.categories.flatMap((category) => category.board.products.map((product) => ({ ...product, categoryId: category.id }))),
    getBaselineProducts: () => sandbox.portfolio.masterLocalBaseline,
    setBaselineProducts: (products) => { sandbox.portfolio.masterLocalBaseline = clone(products); },
    getMasterTombstones: () => [],
    setMasterSnapshot: (snapshot) => { if (snapshot.masterSync) sandbox.portfolio.masterSync = clone(snapshot.masterSync); },
    applyProductValues(changes) {
      for (const category of sandbox.portfolio.categories) category.board.products = category.board.products.map((product) => {
        const change = changes.find((item) => item.productId === product.id);
        return change ? model.applyProductValues(product, change.values) : product;
      });
      sandbox.localDateBaseline = importer.snapshotDateValues(sandbox.portfolio);
    },
  };
  session = globalThis.PortfolioMasterClient.createSession({ endpoint: 'https://synthetic.example/api/master', source: { mode: 'service', team: true }, adapter,
    fetchImpl: async (url, options) => {
      if (url.endsWith('/latest')) return Response.json({ snapshot: { ...model.snapshot(remote), masterSync: remote.masterSync || null, canWrite: true } });
      const body = JSON.parse(options.body); calls.saves.push(clone(body));
      const merged = model.mergeChanges(remote, body.changes, { now: clock.value, requestId: body.requestId, actor: 'Synthetic importer', reason: body.reason });
      if (merged.conflicts.length) return Response.json({ code: 'MASTER_CONFLICT', conflicts: merged.conflicts, snapshot: { ...model.snapshot(remote), masterSync: remote.masterSync || null, canWrite: true } }, { status: 409 });
      remote = merged.manifest;
      return Response.json({ snapshot: { ...model.snapshot(remote), masterSync: remote.masterSync || null, canWrite: true }, savedFields: merged.savedFields, savedProducts: merged.savedProducts });
    },
  });
  vm.createContext(sandbox);
  for (const name of ['scheduleSave', 'productDateHistoryOptions', 'persistPlcDraft', 'retryPlcSharing', 'commitPlcPlan']) {
    const definition = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm'));
    assert.ok(definition, `Workspace must expose its ${name} integration function.`);
    vm.runInContext(definition[0], sandbox);
  }
  return { sandbox, calls, clock, session, get workspace() { return sandbox.portfolio; }, get stored() { return JSON.parse(stored); }, get remote() { return remote; },
    connect: () => session.connect({ key: 'synthetic-unlock' }), blockStorage: (value) => { storageBlocked = value; },
    plan: (data = dataset(), options = {}) => importer.buildPlan(data, sandbox.portfolio, { reportDate: '2026-10-09', reportDateBasis: 'Import date', ...options }),
    commit: (plan, options = {}) => sandbox.commitPlcPlan(plan, { now: clock.value, ...options }), retry: () => sandbox.retryPlcSharing(),
  };
}

{
  const previousQueue = clone(seed);
  previousQueue.plcReview = { version: 1, entries: [{ key: 'previous-exception', row: { key: 'previous-exception', name: 'Other unknown product', dates: {} }, metadata: { fingerprint: 'previous-source', fileName: 'Previous synthetic.xlsx', reportDate: '2026-09-24' }, reportDate: '2026-09-24', fields: [], matchNeeded: true, createdAt: firstAt, observedAt: firstAt }] };
  const h = harness({ initial: previousQueue, failStorage: true }), original = h.workspace, before = clone(h.workspace), storedBefore = h.stored;
  await assert.rejects(h.commit(h.plan()), /quota/i);
  assert.equal(h.workspace, original); assert.deepEqual(clone(h.workspace), before, 'A failed durable write must preserve the workspace, field clocks, prior queue, and pending shared changes together.');
  assert.deepEqual(h.stored, storedBefore); assert.equal(h.calls.scoped, 0); assert.equal(h.calls.saves.length, 0); assert.equal(h.calls.renders, 0);
}

{
  const h = harness(); await h.connect();
  const product = currentProduct(h.workspace);
  product.name = 'Manual name draft'; product.specs[0].value = '55 hours'; product.finalAssetsDate = '2026-10-20';
  h.sandbox.scheduleSave();
  const draft = h.sandbox.productDateHistoryOptions('synthetic-product').getDraft('finalAssetsDate');
  assert.equal(draft.at, firstAt); assert.equal(draft.value, '2026-10-20'); assert.equal(draft.source, 'local');
  const result = await h.commit(h.plan());
  assert.equal(result.sharing.status, 'saved'); assert.equal(currentProduct(h.workspace).ffsDate, '2026-11-05');
  assert.equal(currentProduct(h.workspace).generalAvailabilityDate, '2026-12-01'); assert.equal(h.workspace.plcReview.entries.length, 1);
  const evidence = currentProduct(h.workspace).plc.fields.ffsDate;
  assert.equal(evidence.changedAt, firstAt); assert.equal(evidence.observedAt, firstAt); assert.equal(evidence.reportDate, '2026-10-08');
  assert.equal(h.workspace.plcImports[0].reportDate, '2026-10-09', 'The collection date remains distinct from the workbook evidence date.');
  assert.equal(h.calls.writes[0].categories[0].board.products[0].plc.fields.ffsDate.observedAt, firstAt);
  assert.equal(h.calls.writes[0].plcReview.entries.length, 1, 'Exact date clocks and ambiguous-field review are persisted in the same transaction.');
  assert.ok(h.calls.writes[0].plcSharePending.patches.length, 'The durable local collection includes the pending narrow sharing payload.');
  assert.deepEqual(Object.keys(h.calls.saves[0].changes[0].patch).sort(), ['ffsDate', 'plc']);
  const shared = currentProduct(h.remote);
  assert.equal(shared.name, 'Synthetic headset'); assert.equal(shared.specs[0].value, '40 hours'); assert.equal(shared.finalAssetsDate, '2026-10-15');
  assert.equal(currentProduct(h.workspace).name, 'Manual name draft'); assert.equal(currentProduct(h.workspace).specs[0].value, '55 hours'); assert.equal(currentProduct(h.workspace).finalAssetsDate, '2026-10-20');
  assert.equal(h.session.track().length, 1); assert.equal(h.session.track()[0].patch.finalAssetsDate, '2026-10-20');
  assert.equal(h.sandbox.productDateHistoryOptions('synthetic-product').getDraft('ffsDate'), null, 'A shared FFS no longer presents its collection clock as an unsaved draft.');
  assert.equal(h.sandbox.productDateHistoryOptions('synthetic-product').getHistory('ffsDate').at, firstAt);
  assert.equal(h.sandbox.productDateHistoryOptions('synthetic-product').getDraft('finalAssetsDate').at, firstAt);
  assert.equal(h.stored.plcSharePending, undefined);
  const clocksBefore = clone(currentProduct(h.workspace).plc), queueBefore = clone(h.workspace.plcReview), writesBefore = h.calls.saves.length;
  h.clock.value = '2026-10-23T16:00:00.000Z';
  const duplicate = await h.commit(h.plan(dataset(), { reportDate: '2026-10-23' }));
  assert.equal(duplicate.summary.duplicate, true); assert.deepEqual(currentProduct(h.workspace).plc, clocksBefore); assert.deepEqual(h.workspace.plcReview, queueBefore);
  assert.equal(h.calls.saves.length, writesBefore, 'A duplicate file cannot submit unrelated pending manual drafts.');
  const older = h.plan(dataset({ reportDate: '2026-09-24', fingerprint: 'older-uploaded-later', ffsDate: '2026-11-03' }), { reportDate: '2026-10-23' });
  assert.equal(older.items[0].fields.find((field) => field.field === 'ffsDate').status, 'stale', 'Using today as collection date must not let an older workbook roll back current FFS.');
  await h.commit(older); assert.equal(currentProduct(h.workspace).ffsDate, '2026-11-05'); assert.equal(currentProduct(h.workspace).plc.fields.ffsDate.observedAt, firstAt);
}

{
  const h = harness();
  const collected = await h.commit(h.plan());
  assert.equal(collected.sharing.status, 'local'); assert.ok(h.workspace.plcSharePending); assert.equal(h.calls.saves.length, 0);
  assert.deepEqual(h.stored.plcSharePending, clone(h.workspace.plcSharePending));
  const applications = h.calls.applies, importCount = h.workspace.plcImports.length, clocks = clone(currentProduct(h.workspace).plc.fields.ffsDate), queue = clone(h.workspace.plcReview);
  h.clock.value = '2026-10-10T16:00:00.000Z'; await h.connect();
  assert.equal((await h.retry()).status, 'saved');
  assert.equal(h.calls.applies, applications, 'Retrying a saved sharing payload never reparses or reapplies the workbook.');
  assert.equal(h.workspace.plcImports.length, importCount); assert.deepEqual(currentProduct(h.workspace).plc.fields.ffsDate, clocks); assert.deepEqual(h.workspace.plcReview, queue);
  assert.equal(h.workspace.plcSharePending, undefined); assert.equal(h.stored.plcSharePending, undefined); assert.equal(h.stored.plcLastSharing.status, 'saved');
  assert.equal(h.calls.saves.length, 1); await h.retry(); assert.equal(h.calls.saves.length, 1, 'A cleared sharing queue cannot issue a second save.');
}

console.log('PLC workspace checks passed: atomic durable collection and quota rollback, real scoped master sharing without manual drafts, independent date/history adapters, duplicate clocks, original source ordering despite later collection, and persisted retry receipts without reimport.');
