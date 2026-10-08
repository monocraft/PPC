import assert from 'node:assert/strict';
import { createMasterGateway, sha256 } from '../../supabase/functions/ppc-master/gateway.mjs';
import '../../public/js/master-client.js';
const codec = globalThis.PortfolioPackage, model = globalThis.PortfolioMasterModel, merge = globalThis.PortfolioProductMerge, client = globalThis.PortfolioMasterClient;
const copy = (value) => structuredClone(value);
const key = codec.generateKey(), publisherSecret = `review-publisher-${'p'.repeat(48)}`, sourceSha = 'a'.repeat(40);
const product = (id, fields = {}) => ({ id, name: 'Complete headset', laneId: 'wired', specs: [], partSkus: [], variantGroups: [], roadmap: {}, ...fields });
const keep = product('keeper', { specs: [{ id: 'weight', label: 'Weight', value: '300 g', ownerNote: 'Keeper source detail' }], imageAssetId: 'keeper-image', custom: { approvals: ['Design'] } });
const donor = product('donor', { specs: [{ id: 'battery', label: 'Battery', value: '80 h', supplierNote: 'Donor source detail' }], partSkus: [{ id: 'hp', code: 'HP001', variantId: 'red' }],
  variantGroups: [{ id: 'colors', type: 'color', label: 'Color', items: [{ id: 'red', code: 'RD', colorKey: 'red', colorName: 'Red', colorHex: '#ff0000', imageAssetId: 'red-image', vendorMetadata: 'Image and row context' }] }],
  custom: { factory: 'Factory source context' }, ascm: { records: [{ basePartNumber: 'HP001', supplier: 'Original report data' }] } });
const unrelated = product('unrelated', { privateSourceContext: 'Unrelated full record must not leak' });
const manifest = { version: 4, imageAssets: ['keeper-image', 'red-image'].map((id) => ({ id, sourceType: 'local', packagePath: `images/${id}.png` })),
  categories: [{ id: 'pc', board: { lanes: [{ id: 'wired' }], products: [copy(keep), copy(donor), copy(unrelated)] } }, { id: 'console', board: { lanes: [{ id: 'wired' }], products: [product('console-copy')] } }],
  masterSync: { version: 1, revision: 0, products: { archived: { deleted: true, categoryId: 'pc', laneId: 'wired', productName: 'Old record', revisions: {}, archivedProduct: { id: 'archived', privateArchive: 'Archived original must not leak' }, archivedKeeperProduct: { id: 'keeper-before', privateKeeperArchive: 'Archived keeper must not leak' } } }, history: [] },
};
let readCount = 0;
const state = { manifest: copy(manifest), storageRevision: 1, sourceSha, publication: { requestedRevision: 1, publishedRevision: 0, status: 'pending' } };
const gateway = createMasterGateway({ env: { PPC_PACKAGE_KEY_HASH: await sha256(key), PPC_PUBLISHER_SECRET: publisherSecret, PPC_ALLOWED_ORIGINS: 'http://127.0.0.1:4190' }, rpc: async (operation) => {
  if (operation === 'rate') return { allowed: true, retryAfter: 60 };
  if (operation === 'read') { readCount++; return copy(state); }
  throw new Error(`Unexpected review write ${operation}`);
} });
async function review(body, origin = 'https://monocraft.github.io') {
  const response = await gateway(new Request('https://project.supabase.co/functions/v1/ppc-master/api/master/review', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) }));
  return { status: response.status, data: await response.json(), headers: response.headers };
}
const chosen = { productId: 'keeper', sourceProductId: 'donor', sessionId: 'review-session' };
assert.equal((await review(chosen)).status, 401); assert.equal((await review({ ...chosen, key: codec.generateKey() })).status, 401);
assert.equal(readCount, 0, 'Unauthenticated callers cannot read any selected full records or archives.');
assert.equal((await review({ ...chosen, key }, 'https://untrusted.example')).status, 403); assert.equal(readCount, 0);
const allowed = await review({ ...chosen, key });
assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('Cache-Control'), 'no-store');
assert.equal(allowed.data.products.length, 2); assert.deepEqual(allowed.data.products.find((entry) => entry.product.id === 'donor').product.ascm, donor.ascm);
const publicText = JSON.stringify(allowed.data);
for (const secret of [publisherSecret, key, 'Archived original must not leak', 'Archived keeper must not leak', 'Unrelated full record must not leak']) assert.ok(!publicText.includes(secret), 'Review only returns explicitly selected current full records and sanitized snapshot.');
assert.ok(!('manifest' in allowed.data)); assert.ok(!('imageAssets' in allowed.data));
assert.equal((await review({ ...chosen, key, sourceProductId: 'console-copy' })).status, 409, 'A review cannot combine listings from separate portfolios.');
assert.equal((await review({ ...chosen, key, sourceProductId: 'keeper' })).status, 400);
assert.equal((await review({ ...chosen, key, productId: '__proto__' })).status, 400, 'Reserved product identities never enter record lookup.');
const oneNew = await review({ ...chosen, key, sourceProductId: 'new-import' }); assert.equal(oneNew.status, 200); assert.equal(oneNew.data.products.length, 1, 'An existing record can be reviewed alongside a genuinely local new import.');
const archived = await review({ ...chosen, key, sourceProductId: 'archived' }); assert.equal(archived.status, 200); assert.equal(archived.data.products.length, 1); assert.ok(!JSON.stringify(archived.data).includes('privateArchive'));
assert.equal((await review({ ...chosen, key, productId: 'missing-one', sourceProductId: 'missing-two' })).status, 409);

const baselines = model.snapshot(manifest).products;
const planned = merge.plan(keep, donor), choices = Object.fromEntries(planned.conflicts.map((item) => [item.key, 'keeper']));
const operation = { kind: 'merge', productId: 'keeper', sourceProductId: 'donor', categoryId: 'pc', laneId: 'wired', sourceCategoryId: 'pc', sourceLaneId: 'wired', choices,
  base: baselines.find((item) => item.productId === 'keeper'), sourceBase: baselines.find((item) => item.productId === 'donor'), baseProductVersion: baselines.find((item) => item.productId === 'keeper').productVersion,
  sourceBaseProductVersion: baselines.find((item) => item.productId === 'donor').productVersion, mine: model.values(merge.resolve(planned, choices)) };
const accepted = model.mergeChanges(manifest, [operation], { requestId: 'review-merge' }).manifest;
assert.deepEqual(accepted.masterSync.products.donor.archivedKeeperProduct, keep, 'The complete original keeper is archived before any selected donor values replace it.');
assert.deepEqual(accepted.masterSync.products.donor.archivedProduct, donor, 'The complete original donor is archived before it is removed.');
const cross = copy(operation), crossBase = baselines.find((item) => item.productId === 'console-copy');
Object.assign(cross, { sourceProductId: 'console-copy', sourceBase: crossBase, sourceBaseProductVersion: crossBase.productVersion, sourceCategoryId: 'console' });
assert.throws(() => model.mergeChanges(manifest, [cross]), /same category/, 'Direct authenticated save requests enforce the same portfolio boundary as the UI.');

function harness({ dirty = false, absent = false, duringReview = null, badReview = null } = {}) {
  let products = absent ? [] : [copy(keep)], baseline = absent ? [] : baselines.filter((item) => item.productId === 'keeper'), calls = [], patches = [], next = copy(accepted);
  if (dirty) products[0].codename = 'Local draft';
  const adapter = { getProducts: () => copy(products), getBaselineProducts: () => copy(baseline), setBaselineProducts: (value) => { baseline = copy(value); }, getMergeIntents: () => [],
    applyPatches(updates) { patches.push(...copy(updates)); for (const change of updates) {
      const index = products.findIndex((item) => item.id === change.productId);
      if (change.kind === 'delete') { if (index >= 0) products.splice(index, 1); continue; }
      const base = change.fullProduct || products[index] || { id: change.productId, laneId: change.laneId };
      const updated = model.applyProductValues(base, change.values); if (index >= 0) products[index] = updated; else products.push(updated);
    } },
  };
  const session = client.createSession({ source: { mode: 'service', team: true }, endpoint: 'https://project.supabase.co/functions/v1/ppc-master/api/master', adapter, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    if (url.endsWith('/latest')) return Response.json({ snapshot: model.snapshot(next) });
    if (url.endsWith('/review')) {
      await duringReview?.(products);
      const snapshot = model.snapshot(next), selected = model.entriesFromManifest(next).filter((entry) => [body.productId, body.sourceProductId].includes(entry.productId)).map((entry) => ({ product: copy(entry.product), categoryId: entry.categoryId }));
      return Response.json(badReview ? badReview({ snapshot, products: selected }) : { snapshot, products: selected });
    }
    throw new Error('Unexpected save in hydration fixture');
  } });
  return { session, get products() { return products; }, get calls() { return calls; }, get patches() { return patches; }, clean() { const saved = baseline.find((item) => item.productId === 'keeper'); products[0] = model.applyProductValues(products[0], saved.values); }, mutate(fn) { fn(products); }, setRemote(value) { next = copy(value); } };
}
const hydrated = harness(); await hydrated.session.connect(key);
assert.ok(hydrated.patches.some((change) => change.productId === 'keeper' && change.fullProduct), 'A remotely merged record is hydrated even if its donor was never loaded in this tab.');
assert.equal(hydrated.products.find((item) => item.id === 'keeper').variantGroups[0].items[0].imageAssetId, 'red-image');
assert.equal(hydrated.products.find((item) => item.id === 'keeper').variantGroups[0].items[0].vendorMetadata, 'Image and row context');
assert.equal(hydrated.products.find((item) => item.id === 'keeper').custom.factory, 'Factory source context');
const callsAfterHydration = hydrated.calls.filter((call) => call.url.endsWith('/review')).length;
await hydrated.session.refresh(); assert.equal(hydrated.calls.filter((call) => call.url.endsWith('/review')).length, callsAfterHydration, 'An unchanged merge is hydrated only once.');
const newlyCreated = harness({ absent: true }); await newlyCreated.session.connect(key); assert.ok(newlyCreated.patches.some((change) => change.kind === 'create' && change.productId === 'keeper' && change.fullProduct));
assert.equal(newlyCreated.products.find((item) => item.id === 'keeper').ascm.records[0].supplier, 'Original report data');
const waiting = harness({ dirty: true }); await waiting.session.connect(key);
assert.equal(waiting.calls.filter((call) => call.url.endsWith('/review')).length, 0); assert.equal(waiting.products[0].codename, 'Local draft', 'Refreshing never overwrites a dirty keeper with a hydrated full record.');
waiting.clean(); await waiting.session.refresh(); assert.ok(waiting.patches.some((change) => change.fullProduct), 'Deferred metadata is retried when the keeper is clean, even though its tombstone was already received.');
const during = harness({ duringReview(products) { products[0].custom.local = 'Typed during review'; } }); await during.session.connect(key);
assert.equal(during.products[0].custom.local, 'Typed during review'); assert.ok(!during.patches.some((change) => change.fullProduct), 'A full-record fingerprint protects metadata typed during the hydration request.');
const malformed = harness({ badReview(result) { result.products[0].product.custom.changed = 'Inconsistent response'; return result; } }); await malformed.session.connect(key);
assert.ok(!malformed.patches.some((change) => change.fullProduct), 'Hydration rejects a full record whose fingerprint disagrees with the authenticated snapshot.');
const duplicate = harness({ badReview(result) { result.products = [result.products[0], result.products[0]]; return result; } }); await duplicate.session.connect(key);
await assert.rejects(duplicate.session.reviewMerge('keeper', 'donor'), { code: 'INVALID_RESPONSE' });
const reviewed = await hydrated.session.reviewMerge('keeper', 'new-import'); assert.equal(reviewed.products.length, 1);
const accessBeforeRebase = hydrated.session.getState().hasKey; hydrated.session.rebaseMergeReview(reviewed); assert.equal(hydrated.session.getState().hasKey, accessBeforeRebase, 'Rereviewing accepted originals preserves the existing unlock.');
console.log('Authenticated merge review and hydration checked: package-key access, selected-only current records, archive and secret exclusion, portfolio boundary, new imports, complete image/custom metadata on peers, dirty/in-flight guards, deferred retries, duplicate-response rejection and unlock-preserving rereview.');
