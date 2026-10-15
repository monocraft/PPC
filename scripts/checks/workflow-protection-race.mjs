// Actual PLC commit and storage predicate, synthetic records and zero backend calls.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../public/js/portfolio-model.js';
import '../../public/js/master-model.js';
import '../../public/js/ascm-import.js';
import '../../public/js/date-precision.js';
import '../../public/js/plc-import.js';
const app = await readFile(new URL('../../public/js/app.js', import.meta.url), 'utf8');
const importer = globalThis.PLCImporter, master = globalThis.PortfolioMasterModel, clone = value => JSON.parse(JSON.stringify(value));
const seed = { version: 4, activeCategoryId: 'pc-gaming-audio', settings: { retained: true }, imageAssets: [{ id: 'kept-image', sourceType: 'local' }], categories: [{ id: 'pc-gaming-audio', board: { lanes: [{ id: 'lane' }], products: [{ id: 'synthetic-product', laneId: 'lane', name: 'Synthetic headset', codename: 'Synthetic project', ffsDate: '2027-01-01', imageAssetId: 'kept-image', specs: [], partSkus: [], variantGroups: [], roadmap: { status: 'in-development', startMonth: '2027-01', endMonth: '2030-01' }, plc: { version: 1, fingerprint: 'prior', reportDate: '2026-09-01', fields: { ffsDate: { value: '2027-01-01', raw: '2027-01-01', reportDate: '2026-09-01' } } } }] } }] };
const dataset = { metadata: { fileName: 'Synthetic PLC.xlsx', fingerprint: 'new-synthetic-source', reportDate: '2026-10-15', reportDateBasis: 'Explicit source date' }, rows: [{ key: 'synthetic-source-row', productId: 'synthetic-product', name: 'Synthetic headset', codename: 'Synthetic project', categoryId: 'pc-gaming-audio', reportDate: '2026-10-15', dates: { ffsDate: { kind: 'exact', value: '2027-02-01', raw: '2027-02-01', source: { sheet: 'Synthetic PLC', cell: 'F4' } } }, sources: [{ sheet: 'Synthetic PLC', row: 4 }], milestones: {}, data: {} }], diagnostics: [] };
function harness({ initial = seed, data = dataset, initiallyProtected = false, unavailable = false, lockVariantId, onDurable = () => {}, choices = {} } = {}) {
  const policy = { protected: initiallyProtected, unavailable }, calls = { writes: 0, sharing: 0, backend: 0, predicates: 0, policyChecks: [] }; let stored = clone(initial);
  const protection = { check(value) { calls.policyChecks.push(clone(value)); const locked = policy.protected && (lockVariantId === undefined || (value.variantId || '') === lockVariantId); return { protected: locked || policy.unavailable, unavailable: policy.unavailable, reason: policy.unavailable ? 'Synthetic policy unavailable' : 'Synthetic protected date' }; } };
  globalThis.PortfolioFieldProtection = protection;
  const context = vm.createContext({ Date, JSON, Map, Set, Object, Array, String, Error, TextEncoder, portfolio: clone(initial), packageOperationInProgress: false, activeCategoryId: initial.activeCategoryId, saveTimer: null, localDateBaseline: importer.snapshotDateValues(initial),
    PLCImporter: importer, PortfolioMasterModel: master, PortfolioFieldProtection: protection, ensurePortfolioSchema: clone, clearTimeout() {}, activateCategory() {}, renderInspector() {}, renderActiveView() {},
    async retryPlcSharing() { calls.sharing++; return { status: 'local', saved: false, message: 'Synthetic local fixture; backend blocked.' }; },
    workspaceStorage: { async save(text, { isCurrent } = {}) { await Promise.resolve(); onDurable(policy); calls.predicates++; if (isCurrent && !isCurrent()) throw Object.assign(new Error('The workspace or field protection changed before the durable write.'), { code: 'WORKSPACE_CHANGED' }); stored = JSON.parse(text); calls.writes++; } },
    fetch() { calls.backend++; throw new Error('No backend is allowed in this check.'); },
  });
  for (const name of ['persistPortfolioStorage', 'persistPlcDraft', 'commitPlcPlan']) { const definition = app.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm')); assert(definition, name); vm.runInContext(definition[0], context); }
  const plan = importer.buildPlan(data, context.portfolio, { now: '2026-10-15T12:00:00.000Z' });
  return { context, policy, calls, plan, get stored() { return stored; }, async commit() { return context.commitPlcPlan(plan, { now: '2026-10-15T12:00:00.000Z', ...choices }); } };
}
const failures = [], outcomes = [];
async function heldScenario(label, args) {
  const h = harness(args), original = JSON.stringify(h.context.portfolio); let rejected = false, error = '';
  try { await h.commit(); } catch (value) { rejected = true; error = value.message; }
  const pass = rejected && h.calls.writes === 0 && h.calls.sharing === 0 && h.calls.backend === 0 && JSON.stringify(h.context.portfolio) === original && JSON.stringify(h.stored) === JSON.stringify(args?.initial || seed);
  outcomes.push({ label, pass, rejected, writes: h.calls.writes, sharing: h.calls.sharing, backend: h.calls.backend, error });
  if (!pass) failures.push(label);
}
await heldScenario('Automatic update protected by another tab during durable preparation', { onDurable(policy) { policy.protected = true; } });
await heldScenario('Explicit reviewed resolution blocked when protection storage becomes unavailable', { choices: { resolutions: { 'synthetic-source-row': { ffsDate: '2027-02-01' } } }, onDurable(policy) { policy.unavailable = true; } });
await heldScenario('Explicit resolution cannot bypass already-unavailable protection', { unavailable: true, choices: { resolutions: { 'synthetic-source-row': { ffsDate: '2027-02-01' } } } });
const variantSeed = clone(seed), variantData = clone(dataset), parent = variantSeed.categories[0].board.products[0];
parent.variantGroups = [{ id: 'colors', type: 'color', label: 'Color', items: [{ id: 'white', code: 'WHT', colorKey: 'white', colorName: 'White', colorHex: '#ffffff' }] }];
parent.plc.identities = [{ key: 'synthetic-source-row', name: 'Synthetic headset White', codename: 'Synthetic White', variantId: 'white', confirmed: true }];
parent.plc.variantProjects = { white: { version: 1, reportDate: '2026-09-01', colorway: { code: 'WHT', colorKey: 'white', colorName: 'White', colorHex: '#ffffff', colorKey2: '', colorName2: '', colorHex2: '' }, fields: { ffsDate: { value: '2027-01-01', raw: '2027-01-01', reportDate: '2026-09-01' } } } };
Object.assign(variantData.rows[0], { name: 'Synthetic headset White', codename: 'Synthetic White', section: 'Colorway' });
await heldScenario('Colorway-specific automatic date protected during durable preparation', { initial: variantSeed, data: variantData, lockVariantId: 'white', onDurable(policy) { policy.protected = true; } });
{
  const h = harness({ initial: variantSeed, data: variantData, initiallyProtected: true, lockVariantId: 'white', choices: { resolutions: { 'synthetic-source-row': { ffsDate: '2027-02-01' } } } });
  assert.equal(h.plan.items[0].matchedVariantId, 'white'); await h.commit();
  assert.equal(h.stored.categories[0].board.products[0].plc.variantProjects.white.fields.ffsDate.value, '2027-02-01');
  assert.equal(h.stored.categories[0].board.products[0].ffsDate, '2027-01-01', 'Colorway review cannot move the parent milestone.');
  assert(h.calls.policyChecks.some(value => value.productId === 'synthetic-product' && value.variantId === 'white' && value.field === 'ffsDate'));
  assert.equal(h.calls.backend, 0); outcomes.push({ label: 'Available reviewed colorway override preserves parent date', pass: true });
}
{
  const h = harness({ initiallyProtected: true, choices: { resolutions: { 'synthetic-source-row': { ffsDate: '2027-02-01' } } } });
  await h.commit(); assert.equal(h.stored.categories[0].board.products[0].ffsDate, '2027-02-01', 'An explicit reviewed resolution can override available protection.'); assert.equal(h.calls.backend, 0); assert.equal(h.calls.writes, 1); outcomes.push({ label: 'Explicit reviewed resolution permits available protected override', pass: true });
}
{
  const h = harness(); await h.commit(); assert.equal(h.stored.categories[0].board.products[0].ffsDate, '2027-02-01'); assert.equal(h.calls.writes, 1); assert.equal(h.calls.backend, 0); outcomes.push({ label: 'Unprotected reliable automatic PLC update remains unchanged', pass: true });
}
console.log(JSON.stringify({ protectionRaceScenarios: outcomes }));
assert.deepEqual(failures, [], 'PLC protection changes must be checked at the actual durable storage predicate.');
delete globalThis.PortfolioFieldProtection;
console.log('PLC protection race checks passed: automatic dates held on newly protected fields, unavailable policy blocks even explicit resolutions, available explicit overrides and reliable unprotected updates retained; actual commit/storage path, no backend.');
