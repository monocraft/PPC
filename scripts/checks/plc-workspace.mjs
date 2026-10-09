import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../public/js/portfolio-model.js';
import '../../public/js/master-model.js';
import '../../public/js/master-client.js';
import '../../public/js/ascm-import.js';
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

function harness({ initial = seed, remoteInitial = seed, failStorage = false, normalizeDraft = clone } = {}) {
  let remote = clone(remoteInitial), stored = JSON.stringify(initial), storageBlocked = failStorage, session;
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
    ensurePortfolioSchema: normalizeDraft, activateCategory() { calls.renders += 1; }, renderInspector() {}, renderActiveView() {},
    setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
    localStorage: { setItem(key, text) { assert.equal(key, 'synthetic-workspace'); if (storageBlocked) throw new Error('Synthetic browser quota exceeded'); stored = text; calls.writes.push(JSON.parse(text)); }, removeItem() {} },
    PortfolioMasterUI: {
      getSession: () => session, updateStatus() {},
      async saveScoped(options) { calls.scoped += 1; return session.saveScoped(options); },
    },
  };
  sandbox.portfolio.masterLocalBaseline ||= model.snapshot(remoteInitial).products;
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

{
  const h = harness(); await h.connect();
  currentProduct(h.workspace).name = 'Unrelated existing local name';
  const data = dataset({ fingerprint: 'synthetic-create-source' });
  Object.assign(data.rows[0], { key: 'create-source', productId: '', name: 'Synthetic Codeword', codename: 'Synthetic Codeword' });
  delete data.rows[0].dates.generalAvailabilityDate;
  const result = await h.commit(h.plan(data), { createProducts: { 'create-source': { name: 'Synthetic Codeword', codename: 'Synthetic Codeword', categoryId: 'pc-gaming-audio' } } });
  assert.equal(result.summary.created, 1); assert.equal(result.sharing.status, 'saved');
  const created = h.workspace.categories[0].board.products.find(product => product.id !== 'synthetic-product');
  assert.ok(created); assert.equal(created.ffsDate, '2026-11-05'); assert.equal(created.generalAvailabilityDate, '');
  const sharedCreated = h.remote.categories[0].board.products.find(product => product.id === created.id);
  assert.ok(sharedCreated, 'Explicit PLC product creation is sent through the real master create protocol.');
  assert.equal(sharedCreated.codename, 'Synthetic Codeword'); assert.equal(sharedCreated.plc.fields.ffsDate.changedAt, firstAt);
  assert.equal(h.calls.saves[0].changes.length, 1); assert.equal(h.calls.saves[0].changes[0].kind, 'create');
  assert.equal(currentProduct(h.remote).name, 'Synthetic headset', 'Creating a PLC product cannot publish unrelated existing drafts.');
  assert.equal(currentProduct(h.workspace).name, 'Unrelated existing local name');
  assert.equal(h.workspace.plcSharePending, undefined);
  assert.equal(h.session.track().length, 1);
}

{
  const h = harness();
  const data = dataset({ fingerprint: 'synthetic-create-retry' });
  Object.assign(data.rows[0], { key: 'create-retry-source', productId: '', name: 'Synthetic Retryword', codename: 'Synthetic Retryword' });
  delete data.rows[0].dates.generalAvailabilityDate;
  await h.commit(h.plan(data), { createProducts: { 'create-retry-source': { name: 'Synthetic Retryword', codename: 'Synthetic Retryword', categoryId: 'pc-gaming-audio' } } });
  const created = h.workspace.categories[0].board.products.find(product => product.id !== 'synthetic-product');
  assert.equal(h.workspace.plcSharePending.patches[0].kind, 'create');
  created.name = 'Changed after review';
  await h.connect();
  const blocked = await h.retry();
  assert.equal(blocked.status, 'pending'); assert.equal(blocked.code, 'SCOPED_UPDATE_CHANGED'); assert.equal(h.calls.saves.length, 0);
  assert.ok(h.workspace.plcSharePending, 'Changed creation drafts remain durable for explicit review.');
  created.name = 'Synthetic Retryword';
  assert.equal((await h.retry()).status, 'saved'); assert.equal(h.calls.saves[0].changes[0].kind, 'create');
}

// A manual precision edit can keep the same scalar placement anchor. Its
// metadata is still a draft and must not ride along with an automatic FFS save.
for (const [kind, scalar, period] of [
  ['same-anchor quarter', '2028-04-01', { precision: 'quarter', basis: 'calendar', year: 2028, quarter: 2, start: '2028-04-01', end: '2028-06-30', label: 'Q2 2028' }],
  ['different-anchor quarter', '2028-07-01', { precision: 'quarter', basis: 'calendar', year: 2028, quarter: 3, start: '2028-07-01', end: '2028-09-30', label: 'Q3 2028' }],
  ['manual exact day', '2028-04-05', null],
]) {
  const h = harness();
  currentProduct(h.workspace).finalAssetsDate = '2028-04-01';
  currentProduct(h.remote).finalAssetsDate = '2028-04-01';
  await h.connect();
  const manual = currentProduct(h.workspace);
  manual.finalAssetsDate = scalar;
  manual.plc = { fields: { finalAssetsDate: { value: scalar, sourceType: 'local', changedAt: firstAt, observedAt: firstAt, raw: period?.label || scalar, source: { kind: 'manual' }, ...(period ? { period: clone(period) } : {}) } } };
  h.sandbox.scheduleSave();
  const evidenceBefore = clone(manual.plc.fields.finalAssetsDate);
  const result = await h.commit(h.plan());
  assert.equal(result.sharing.status, 'saved', `FFS remains shareable while an unrelated ${kind} is a local draft.`);
  assert.equal(currentProduct(h.remote).ffsDate, '2026-11-05');
  assert.equal(currentProduct(h.remote).finalAssetsDate, '2028-04-01');
  assert.equal(currentProduct(h.remote).plc.fields.finalAssetsDate, undefined, `An automatic FFS import cannot publish an unrelated ${kind} clock or precision.`);
  assert.equal(currentProduct(h.workspace).finalAssetsDate, scalar);
  assert.deepEqual(currentProduct(h.workspace).plc.fields.finalAssetsDate, evidenceBefore, `The unrelated ${kind} remains intact locally after the FFS snapshot arrives.`);
  assert.ok(h.session.track().some((entry) => entry.productId === 'synthetic-product'), `The ${kind} remains an explicit unsaved product draft.`);
  assert.equal((await h.session.save({ reason: 'Explicit synthetic manual milestone save' })).saved, true);
  assert.equal(currentProduct(h.remote).finalAssetsDate, scalar);
  assert.deepEqual(currentProduct(h.remote).plc.fields.finalAssetsDate, evidenceBefore, `An explicit save can publish the reviewed ${kind} after the independent FFS update.`);
  assert.equal(h.session.track().length, 0);
}

// Persisted queues from the preceding release have no milestone metadata scope.
// A subsequent import must carry forward their imported date evidence together
// with the already queued scalar, while continuing to exclude manual evidence.
{
  const h = harness();
  const older = dataset({ fingerprint: 'legacy-pending-assets', ffsDate: '2026-10-01' });
  delete older.rows[0].dates.generalAvailabilityDate;
  older.rows[0].dates.finalAssetsDate = { ...importer.parseDate('2026-10-30'), source: { sheet: 'Synthetic PLC', cell: 'J4' } };
  await h.commit(h.plan(older));
  for (const queued of h.workspace.plcSharePending.patches) delete queued.plcFields;
  const originalEvidence = clone(currentProduct(h.workspace).plc.fields.finalAssetsDate);
  h.clock.value = '2026-10-23T16:00:00.000Z';
  const newer = dataset({ fingerprint: 'newer-pending-ffs', reportDate: '2026-10-22', ffsDate: '2026-11-06' });
  delete newer.rows[0].dates.generalAvailabilityDate;
  await h.commit(h.plan(newer, { reportDate: '2026-10-23' }));
  await h.connect();
  assert.equal((await h.retry()).status, 'saved');
  assert.equal(currentProduct(h.remote).finalAssetsDate, '2026-10-30');
  assert.deepEqual(currentProduct(h.remote).plc.fields.finalAssetsDate, originalEvidence, 'A migrated pending date keeps its source and aging clocks when a newer FFS import joins the sharing queue.');
  assert.equal(h.session.track().length, 0);
}

// A reviewed White colorway is an option on the existing hardware, with its
// own precision and clocks. Other color and HP SKU drafts must stay local.
{
  const initial = clone(seed), original = currentProduct(initial);
  original.name = 'Synthetic QuadCast';
  original.variantGroups = [{ id: 'colors', type: 'color', label: 'Colors', items: [{ id: 'black', code: 'BK', colorName: 'Black', colorHex: '#111111' }] }];
  original.partSkus = [{ id: 'black-part', code: 'SYN-BLACK-001', variantId: 'black' }];
  const h = harness({ initial, remoteInitial: initial, normalizeDraft(draft) {
    const normalized = clone(draft);
    for (const variant of currentProduct(normalized).variantGroups.flatMap(group => group.items)) if (variant.code === 'WHT') Object.assign(variant, { colorKey: 'white', colorName: 'White', colorHex: '#f2f2f2' });
    return normalized;
  } }); await h.connect();
  currentProduct(h.workspace).variantGroups[0].items[0].colorName = 'Unrelated Black draft';
  currentProduct(h.workspace).partSkus[0].code = 'UNRELATED-LOCAL-SKU';
  const data = dataset({ fingerprint: 'synthetic-white', ffsDate: 'Q2 2028' });
  Object.assign(data.rows[0], { key: 'white-source', name: 'Synthetic QuadCast White', codename: 'Synthetic White', section: 'Colorway' });
  delete data.rows[0].dates.generalAvailabilityDate;
  const result = await h.commit(h.plan(data), { variantAssignments: { 'white-source': {
    productId: 'synthetic-product', create: true, colorName: 'White', colorCode: 'WHT', colorHex: '#ffffff',
  } } });
  assert.equal(result.sharing.status, 'saved', JSON.stringify(result.sharing));
  assert.equal(result.variantChanges.length, 1);
  const whiteId = result.variantChanges[0].variantId, shared = currentProduct(h.remote), local = currentProduct(h.workspace);
  assert.equal(h.remote.categories[0].board.products.length, 1, 'A colorway must not create a second product.');
  assert.equal(shared.variantGroups[0].items.length, 2);
  assert.equal(shared.variantGroups[0].items.find(variant => variant.id === whiteId).colorHex, '#f2f2f2', 'Reviewed additions share the canonical color row after workspace normalization.');
  assert.equal(shared.variantGroups[0].items[0].colorName, 'Black', 'Unrelated Black edits cannot ride along with White PLC updates.');
  assert.equal(shared.partSkus[0].code, 'SYN-BLACK-001', 'Existing HP SKU links and codes must be preserved.');
  assert.equal(local.variantGroups[0].items[0].colorName, 'Unrelated Black draft');
  assert.equal(local.partSkus[0].code, 'UNRELATED-LOCAL-SKU');
  assert.equal(shared.ffsDate, '2026-10-01', 'Parent FFS must not be overwritten by a later colorway FFS.');
  assert.equal(shared.generalAvailabilityDate, '2026-12-01');
  const clock = shared.plc.variantProjects[whiteId].fields.ffsDate;
  assert.equal(clock.value, '2028-04-01'); assert.equal(clock.period.label, 'Q2 2028'); assert.equal(clock.changedAt, firstAt);
  assert.equal(h.workspace.plcSharePending, undefined);
  const writes = h.calls.saves.length;
  await h.commit(h.plan(data));
  assert.equal(h.calls.saves.length, writes, 'An identical source cannot submit another color option or advance its clocks.');
  h.clock.value = '2026-10-23T16:00:00.000Z';
  const next = clone(data); next.metadata.fingerprint = 'synthetic-white-next'; next.metadata.reportDate = '2026-10-23'; next.rows[0].reportDate = '2026-10-23'; next.rows[0].dates.ffsDate = { ...importer.parseDate('Q3 2028', { quarterBasis: 'calendar' }), source: { sheet: 'Synthetic PLC', cell: 'F4' } };
  const nextResult = await h.commit(h.plan(next, { reportDate: '2026-10-23' }));
  assert.equal(nextResult.sharing.status, 'saved', JSON.stringify(nextResult.sharing));
  assert.equal(currentProduct(h.workspace).plc.variantProjects[whiteId].fields.ffsDate.period.label, 'Q3 2028', JSON.stringify(h.plan(next, { reportDate: '2026-10-23' }).items));
  const updated = currentProduct(h.remote);
  assert.equal(updated.variantGroups[0].items.length, 2, 'Remembered colorway matching must reuse the same color option.');
  assert.equal(updated.plc.variantProjects[whiteId].fields.ffsDate.period.label, 'Q3 2028');
  assert.equal(updated.plc.variantProjects[whiteId].fields.ffsDate.changedAt, h.clock.value);
  assert.equal(updated.ffsDate, '2026-10-01');
}

// A color can be added while every milestone remains unresolved; sharing the
// reviewed identity must not invent dates or consume manual variant drafts.
{
  const h = harness(); await h.connect();
  const data = dataset({ fingerprint: 'blank-color-source' });
  Object.assign(data.rows[0], { key: 'blank-color', name: 'Synthetic headset White', section: 'Colorway', dates: {} });
  const result = await h.commit(h.plan(data), { variantAssignments: { 'blank-color': { productId: 'synthetic-product', create: true, colorName: 'White', colorCode: 'WHT', colorHex: '#ffffff' } } });
  assert.equal(result.sharing.status, 'saved', JSON.stringify(result.sharing));
  const shared = currentProduct(h.remote), variantId = result.variantChanges[0].variantId;
  assert.equal(shared.variantGroups[0].items.length, 1);
  assert.deepEqual(shared.plc.variantProjects[variantId].fields, {});
  assert.equal(shared.ffsDate, '2026-10-01');
}

// Offline review values must remain the values queued for sharing, even when
// another import joins the same product after a manual colorway edit.
{
  const h = harness();
  const data = dataset({ fingerprint: 'queued-white' });
  Object.assign(data.rows[0], { key: 'queued-white-source', name: 'Synthetic headset White', section: 'Colorway' });
  delete data.rows[0].dates.generalAvailabilityDate;
  const collected = await h.commit(h.plan(data), { variantAssignments: { 'queued-white-source': { productId: 'synthetic-product', create: true, colorName: 'White', colorCode: 'WHT', colorHex: '#ffffff' } } });
  const variantId = collected.variantChanges[0].variantId;
  const reviewed = clone(currentProduct(h.workspace).plc.variantProjects[variantId].fields.ffsDate);
  const local = currentProduct(h.workspace).plc.variantProjects[variantId].fields.ffsDate;
  Object.assign(local, { value: '2029-01-01', raw: 'Manual draft', sourceType: 'local', changedAt: '2026-10-10T16:00:00Z' });
  const other = dataset({ fingerprint: 'queued-unrelated-assets' });
  delete other.rows[0].dates.ffsDate; delete other.rows[0].dates.generalAvailabilityDate;
  other.rows[0].dates.finalAssetsDate = { ...importer.parseDate('2026-10-30'), source: { sheet: 'Synthetic PLC', cell: 'J4' } };
  await h.commit(h.plan(other));
  const queued = h.workspace.plcSharePending.patches[0];
  assert.deepEqual(clone(queued.patch.plc.variantProjects[variantId].fields.ffsDate), reviewed, 'Joining another import must preserve the queued reviewed White date.');
  await h.connect();
  assert.equal((await h.retry()).code, 'SCOPED_UPDATE_CHANGED', 'A manually changed queued colorway remains pending for explicit review.');
  assert.equal(h.calls.saves.length, 0);
  assert.equal(currentProduct(h.remote).plc, undefined);
  assert.equal(currentProduct(h.workspace).plc.variantProjects[variantId].fields.ffsDate.value, '2029-01-01');
  assert.ok(h.workspace.plcSharePending);
  currentProduct(h.workspace).plc.variantProjects[variantId].fields.ffsDate = reviewed;
  assert.equal((await h.retry()).status, 'saved', 'Restoring the reviewed value makes the durable queue shareable again.');
  assert.equal(currentProduct(h.remote).plc.variantProjects[variantId].fields.ffsDate.value, reviewed.value);
}

console.log('PLC workspace checks passed: atomic durable collection, real scoped master sharing, independent dates/clocks, reviewed codename creation, parent/colorway separation with quarter precision, remembered colorway updates, blank-date colorway creation and unrelated color/HP SKU draft isolation.');
