import assert from 'node:assert/strict';
import { createMasterGateway, sha256, validateManifest, publicSnapshot } from '../../supabase/functions/ppc-master/gateway.mjs';
import '../../public/js/master-client.js';
const codec = globalThis.PortfolioPackage, model = globalThis.PortfolioMasterModel, client = globalThis.PortfolioMasterClient;
const key = codec.generateKey(), publisherSecret = 'synthetic-review-capacity-' + 'x'.repeat(32);
const env = { PPC_PACKAGE_KEY_HASH: await sha256(key), PPC_PUBLISHER_SECRET: publisherSecret };
const manifest = { version: 4, packageInfo: { version: 1, updatedAt: '2026-10-13T00:00:00.000Z', comments: '' },
  categories: [{ id: 'c'.repeat(180), board: { lanes: [{ id: 'lane' }], products: Array.from({ length: 30000 }, (_, index) => ({ id: `p${index}`, name: `N${index}`, laneId: 'lane' })) } }] };
manifest.categories[0].board.products[0].privateExtra = 'x'.repeat(2 * 1024 * 1024);
validateManifest(manifest);
const state = { manifest, storageRevision: 1, sourceSha: 'a'.repeat(40), publication: { requestedRevision: 1, publishedRevision: 0, status: 'pending' } };
const snapshotBytes = Buffer.byteLength(JSON.stringify({ snapshot: publicSnapshot(state, 'compact-v1') }));
assert(snapshotBytes < 12 * 1024 * 1024 - 64 * 1024);
const gateway = createMasterGateway({ env, rpc: async operation => operation === 'rate' ? { allowed: true } : state });
const endpoint = 'https://review-capacity.example/api/master';
const request = { endpoint, operation: 'review', key, productId: 'p0', sourceProductId: 'p1' };
let envelopeBytes;
const result = await client.request({ ...request, fetchImpl: async (url, options) => {
  const response = await gateway(new Request(url, options));
  // Count a fresh response rather than leaving an unconsumed tee branch that
  // would stall cancellation in an oversized-reader negative fixture.
  const payload = await response.text(); envelopeBytes = Buffer.byteLength(payload);
  return new Response(payload, { status: response.status, headers: response.headers });
} });
assert(envelopeBytes > 12 * 1024 * 1024); assert(envelopeBytes < 20 * 1024 * 1024);
assert.equal(result.snapshot.products.length, 30000);
assert.equal(result.products[0].product.privateExtra, manifest.categories[0].board.products[0].privateExtra);
assert.equal(result.products[0].product.id, 'p0'); assert.equal(result.products[1].product.id, 'p1');
assert.deepEqual(result.snapshot.products[0].values, model.snapshot(manifest).products[0].values);

const oversizedText = ' '.repeat(20 * 1024 * 1024 + 1);
await assert.rejects(() => client.request({ ...request, fetchImpl: async () => new Response(oversizedText,
  { headers: { 'Content-Length': String(oversizedText.length) } }) }), error => error.code === 'INVALID_RESPONSE');
const invalidLegacy = structuredClone(manifest);
invalidLegacy.masterSync = { ownerPadding: 'x'.repeat(9 * 1024 * 1024) };
const oversizedGateway = createMasterGateway({ env, rpc: async operation => operation === 'rate' ? { allowed: true } : { ...state, manifest: invalidLegacy } });
const refused = await oversizedGateway(new Request(`${endpoint}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key, productId: 'p0', sourceProductId: 'p1', snapshotFormat: 'compact-v1' }) }));
assert.equal(refused.status, 413); assert.equal((await refused.json()).code, 'REVIEW_TOO_LARGE');
console.log(JSON.stringify({ manifestBytes: Buffer.byteLength(JSON.stringify(manifest)), snapshotBytes, envelopeBytes,
  readerLimitBytes: 20 * 1024 * 1024, productCount: result.snapshot.products.length, completePrivateBytes: result.products[0].product.privateExtra.length,
  oversizedReaderRejected: true, oversizedServerRejected: true }));
