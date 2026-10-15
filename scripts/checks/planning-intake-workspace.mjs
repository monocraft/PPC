import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../public/js/ascm-import.js';
import '../../public/js/master-model.js';
import '../../public/js/master-client.js';
import '../../public/js/date-precision.js';
import '../../public/js/plc-import.js';
import '../../public/js/planning-intake.js';
const model = globalThis.PortfolioPlanningIntake, master = globalThis.PortfolioMasterModel, importer = globalThis.PLCImporter, clone = value => JSON.parse(JSON.stringify(value));
const csv = new TextEncoder().encode('Extract ID,Product,Category,FFS\nP-1,Synthetic existing,Mice,Q2 2028\nP-2,Synthetic new,Mice,Q3 2028');
const data = await model.parseFile({ name: 'Synthetic planning.csv', size: csv.length, arrayBuffer: async () => csv });
const seed = { version: 4, settings: { retained: true }, imageAssets: [{ id: 'kept-image', sourceType: 'local' }], categories: [{ id: 'mice', name: 'Mice', board: { lanes: [{ id: 'lane', label: 'Lane' }], products: [{ id: 'existing', laneId: 'lane', order: 0, name: 'Accepted name', ffsDate: '2028-01-03', imageAssetId: 'kept-image', codename: '', specs: [], partSkus: [], variantGroups: [], roadmap: { status: 'in-development' } }] } }] };
const decisions = [{ key: data.rows[0].key, action: 'match', productId: 'existing', fields: ['ffsDate'] }, { key: data.rows[1].key, action: 'create', categoryId: 'mice', laneId: 'lane', fields: ['ffsDate'] }];
const result = model.applyReview(model.buildReview(data, seed), decisions, seed, { now: '2026-10-15T06:00:00.000Z' });
const app = await readFile(new URL('../../public/js/app.js', import.meta.url), 'utf8');
const start = app.indexOf('  async applyPlanning(result) {'), end = app.indexOf('\n  },', start);
assert(start >= 0 && end > start, 'Exercise the actual portfolio planning bridge.');
const bridge = `({${app.slice(start, end)}\n  }}).applyPlanning`;
function harness() {
  let durable = clone(seed), activationFailure = false, beforeWrite = null;
  const context = vm.createContext({ JSON, Date, Set, Error, portfolio: clone(seed), workspaceOpening: false, packageOperationInProgress: false, workspaceSavePending: false, saveTimer: null, activeCategoryId: 'mice', localDateBaseline: null,
    PortfolioPlanningIntake: model, PortfolioWorkflowModel: { fields: Object.keys(model.dateFields) }, PortfolioMasterModel: master, PLCImporter: importer,
    PortfolioMasterUI: { getSummary: () => ({ busy: false }), updateStatus() {} }, PortfolioFieldProtection: { check: () => ({ protected: false, unavailable: false }) },
    ensurePortfolioSchema: value => { for (const category of value.categories) for (const product of category.board.products) { product.specs ||= []; product.partSkus ||= []; product.variantGroups ||= []; product.roadmap ||= { status: 'in-planning' }; product.order ??= category.board.products.indexOf(product); } return value; },
    clearTimeout() {}, flushWorkspaceSave: async () => true, async persistPlcDraft(value, options) { await beforeWrite?.(); if (options?.isCurrent && !options.isCurrent()) throw new Error('Current workspace changed before the write.'); durable = clone(value); },
    resetHashoutView() {}, activateCategory() { if (activationFailure) { activationFailure = false; throw new Error('Synthetic activation failure.'); } }, renderInspector() {}, renderActiveView() {},
  });
  const apply = vm.runInContext(bridge, context);
  return { context, apply, get durable() { return durable; }, failActivation() { activationFailure = true; }, beforeWrite(fn) { beforeWrite = fn; } };
}
const h = harness(); await h.apply(clone(result));
for (const portfolio of [h.context.portfolio, h.durable, JSON.parse(JSON.stringify(h.durable))]) {
  const existing = portfolio.categories[0].board.products.find(product => product.id === 'existing');
  const created = portfolio.categories[0].board.products.find(product => product.id !== 'existing');
  assert.equal(globalThis.PortfolioDatePrecision.currentPeriod(existing, 'ffsDate')?.label, 'Q2 2028', 'Native planning application retains current quarter evidence.');
  assert.equal(globalThis.PortfolioDatePrecision.currentPeriod(created, 'ffsDate')?.label, 'Q3 2028', 'Created-product quarter evidence survives durable JSON reload.');
  assert.equal(existing.plc.fields.ffsDate.supersededAt, undefined); assert.equal(existing.imageAssetId, 'kept-image'); assert.equal(existing.name, 'Accepted name'); assert.deepEqual(clone(portfolio.settings), seed.settings);
}
const session = globalThis.PortfolioMasterClient.createSession({ endpoint: 'https://synthetic.invalid/api/master', adapter: { getProducts: () => h.context.portfolio.categories.flatMap(category => category.board.products.map(product => ({ ...product, categoryId: category.id }))), getBaselineProducts: () => master.snapshot(seed).products, applyPatches() {} }, fetchImpl: async () => { throw new Error('This check must never contact a network.'); } });
const pending = session.track(), createdPending = pending.find(item => item.productId === result.operations.find(item => item.kind === 'create').productId);
assert.equal(createdPending.kind, 'create', 'Ordinary Save changes recognizes planning-created products without a PLC auto-share marker.'); assert.equal(createdPending.mine.plc.fields.ffsDate.period.label, 'Q3 2028'); assert.equal(pending.find(item => item.productId === 'existing').patch.ffsDate, '2028-04-01');
const failed = harness(); failed.failActivation(); await assert.rejects(failed.apply(clone(result)), /activation/); assert.deepEqual(clone(failed.context.portfolio), seed); assert.deepEqual(failed.durable, seed);
const stale = harness(); stale.beforeWrite(() => { stale.context.portfolio.settings.newerEdit = true; }); await assert.rejects(stale.apply(clone(result)), /changed/); assert.equal(stale.context.portfolio.settings.newerEdit, true); assert.deepEqual(stale.durable, seed);
const protectedDuringWrite = harness(); protectedDuringWrite.beforeWrite(() => { protectedDuringWrite.context.PortfolioFieldProtection.check = () => ({ protected: true, unavailable: false }); }); await assert.rejects(protectedDuringWrite.apply(clone(result)), /protect|changed/i); assert.deepEqual(protectedDuringWrite.durable, seed, 'A protection added during async save must hold the date write.');
console.log('Planning workspace checks passed: real app bridge and date clocks retain exact quarter evidence through save/reload, ordinary master-client tracks creates, unrelated facts stay intact, activation rollback and stale asynchronous writes preserve prior data; no network.');
