import assert from 'node:assert/strict';
import { createMasterGateway, sha256, validateManifest, publicSnapshot } from '../../supabase/functions/ppc-master/gateway.mjs';
import '../../public/js/master-client.js';

const codec = globalThis.PortfolioPackage, model = globalThis.PortfolioMasterModel, client = globalThis.PortfolioMasterClient;
const key = codec.generateKey(), publisherSecret = 'synthetic-wire-size-publisher-' + 'x'.repeat(32);
const env = { PPC_PACKAGE_KEY_HASH: await sha256(key), PPC_PUBLISHER_SECRET: publisherSecret };
const seed = { version: 4, packageInfo: { version: 1, updatedAt: '2026-10-13T00:00:00.000Z', comments: '' },
  categories: [{ id: 'category', board: { lanes: [{ id: 'lane' }], products: [{ id: 'p', name: 'Product', laneId: 'lane' }] } }] };
const wide = structuredClone(seed);
wide.categories[0].board.products = Array.from({ length: 30000 }, (_, index) => ({ id: `p${index}`, name: `N${index}`, laneId: 'lane' }));
validateManifest(wide);
const state = manifest => ({ manifest, storageRevision: 1, sourceSha: 'a'.repeat(40),
  publication: { requestedRevision: 1, publishedRevision: 0, status: 'pending' } });
const gateway = createMasterGateway({ env, rpc: async operation => operation === 'rate' ? { allowed: true } : state(wide) });
const endpoint = 'https://wire.example/api/master';
const originalResponse = await gateway(new Request(`${endpoint}/latest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }));
const legacyBytes = Buffer.byteLength(await originalResponse.text());
assert(legacyBytes > 12 * 1024 * 1024);
const compact = await client.request({ endpoint, operation: 'latest', key, fetchImpl: (url, options) => gateway(new Request(url, options)) });
assert.equal(compact.snapshot.products.length, 30000);
assert.deepEqual(compact.snapshot.products[0].values, model.snapshot(wide).products[0].values);
const compactBytes = Buffer.byteLength(JSON.stringify({ snapshot: publicSnapshot(state(wide), 'compact-v1') }));
assert(compactBytes < 12 * 1024 * 1024);

const sparse = structuredClone(seed);
sparse.categories[0].board.products = [{ id: 'sparse', name: '', laneId: 'lane', price: 0,
  specs: [{ id: 'spec' }], partSkus: [{ id: 'sku' }],
  variantGroups: [{ id: 'colors', type: 'color', items: [{ id: 'color' }] }],
  plc: { version: 1, note: '', nested: { empty: '' } } }];
const complete = model.snapshot(sparse);
assert.deepEqual(client.normalizeSnapshot(model.compactSnapshot(complete)).products, JSON.parse(JSON.stringify(complete.products)));

let legacyCalls = 0;
const oldEndpoint = 'https://old-wire.example/api/master';
const legacyFetch = async (_url, options) => {
  legacyCalls += 1;
  return JSON.parse(options.body).snapshotFormat
    ? new Response(JSON.stringify({ code: 'INVALID_REQUEST', error: 'Unsupported field.' }), { status: 400 })
    : new Response(JSON.stringify({ snapshot: { ...model.snapshot(seed), revision: 'old' } }));
};
await client.request({ endpoint: oldEndpoint, operation: 'latest', key, fetchImpl: legacyFetch });
assert.equal(legacyCalls, 2);
await client.request({ endpoint: oldEndpoint, operation: 'latest', key, fetchImpl: legacyFetch });
assert.equal(legacyCalls, 3, 'Legacy capability is remembered after one safe pre-write validation retry.');

const unreadable = structuredClone(wide);
unreadable.categories[0].id = 'c'.repeat(180);
unreadable.categories[0].board.products.forEach(product => { product.name = ''; });
unreadable.masterSync = { customOwnerPadding: 'x'.repeat(4 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(unreadable)) - 200) };
validateManifest(unreadable);
let acceptedBootstrap = false;
const bootstrapGateway = createMasterGateway({ env, rpc: async operation => {
  if (operation === 'bootstrap') acceptedBootstrap = true;
  return operation === 'rate' ? { allowed: true } : { ...state(unreadable), status: 'initialized' };
} });
const boot = await bootstrapGateway(new Request(`${endpoint}/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PPC-Publisher-Secret': publisherSecret },
  body: JSON.stringify({ manifest: unreadable, sourceSha: 'a'.repeat(40) }) }));
assert.equal(boot.status, 413); assert.equal(acceptedBootstrap, false);

const readable = structuredClone(unreadable);
const reserve = 12 * 1024 * 1024 - 64 * 1024 - 8192;
const excess = Buffer.byteLength(JSON.stringify({ snapshot: publicSnapshot(state(readable), 'compact-v1') })) - reserve;
readable.masterSync.customOwnerPadding = readable.masterSync.customOwnerPadding.slice(0, -excess);
let acceptedCommit = false;
const saveGateway = createMasterGateway({ env, rpc: async operation => {
  if (operation === 'commit') acceptedCommit = true;
  return operation === 'rate' ? { allowed: true } : state(readable);
} });
const base = model.snapshot(readable).products[0];
const growth = await saveGateway(new Request(`${endpoint}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key, sessionId: 'wire-session', requestId: 'wire-growth-save', snapshotFormat: 'compact-v1',
    changes: [{ productId: base.productId, base: base.values, baseRevisions: base.revisions, patch: { plc: { version: 1, note: 'x'.repeat(32768) } } }] }) }));
assert.equal(growth.status, 413); assert.equal(acceptedCommit, false, 'Unreadable growth cannot commit or obtain an acceptance receipt.');
console.log(JSON.stringify({ legacyBytes, compactBytes, products: compact.snapshot.products.length, legacyCalls, rejectedBootstrapBeforeWrite: !acceptedBootstrap, rejectedGrowthBeforeWrite: !acceptedCommit }));
