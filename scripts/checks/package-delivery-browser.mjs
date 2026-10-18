import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../../public/js/package-codec.js';
import '../../public/js/package-client.js';

const client = globalThis.PortfolioPackageClient;
const codec = globalThis.PortfolioPackage;
const key = codec.generateKey();
const bytes = await codec.encrypt(codec.createZip([{ name: 'portfolio.json', data: new TextEncoder().encode('{"version":4}') }]), key);
const digest = createHash('sha256').update(bytes).digest('hex');
const endpoint = 'https://project.supabase.co/functions/v1/ppc-package/api/package/latest';
const candidateId = '12345678-1234-4234-8234-123456789abc';
const headers = { 'Content-Length': String(bytes.length), 'X-PPC-Package-SHA256': digest, 'X-PPC-Package-Generation': '2', 'X-PPC-Package-Candidate-Id': candidateId, 'X-PPC-Package-Revision': '5' };
const identity = { provider: 'sharepoint', generation: 2, candidateId, sha256: digest, bytes: bytes.length, storageRevision: 5 };
let requests = 0, seen = null;
const fetchImpl = async (url, options) => { requests++; assert.equal(url, endpoint); assert.equal(options.method, 'POST'); assert.deepEqual(JSON.parse(options.body), { key }); return new Response(bytes, { headers }); };
assert.equal(await client.sha256(bytes), digest, 'service_binary_digest: browser hashes actual ciphertext');
assert.deepEqual(await client.downloadLatest({ endpoint, key, fetchImpl, onIdentity: value => { seen = value; } }), bytes);
assert.deepEqual(seen, identity, 'service_binary_digest: verified identity is delivered after bytes match');
assert.equal(requests, 1, 'no_added_requests: one binary POST');
for (const removed of Object.keys(headers)) {
  let called = false;
  await assert.rejects(client.downloadLatest({ endpoint, key, fetchImpl: async () => new Response(bytes, { headers: Object.fromEntries(Object.entries(headers).filter(([name]) => name !== removed)) }), onIdentity: () => { called = true; } }), /identity|incomplete|length|digest/i, `stale_or_missing_identity: ${removed}`);
  assert.equal(called, false);
}
let rejectedStreamCancelled = false, rejectedIdentityDelivered = false;
const rejectedStream = new ReadableStream({ cancel() { rejectedStreamCancelled = true; } });
await assert.rejects(client.downloadLatest({ endpoint, key,
  fetchImpl: async () => new Response(rejectedStream, { headers: { 'Content-Length': String(bytes.length) } }),
  onIdentity: () => { rejectedIdentityDelivered = true; },
}), /identity is incomplete/);
assert.equal(rejectedStreamCancelled, true, 'stale_or_missing_identity: early rejection stops ciphertext transfer');
assert.equal(rejectedIdentityDelivered, false, 'stale_or_missing_identity: rejected headers never activate import identity');
await assert.rejects(client.downloadLatest({ endpoint, key,
  fetchImpl: async () => new Response(new ReadableStream({ cancel() { throw new Error('private cancellation detail'); } }), { headers: { 'Content-Length': String(bytes.length) } }),
}), error => /identity is incomplete/.test(error.message) && !/private cancellation detail/.test(error.message), 'cancellation failure must not mask the original identity error');
for (const overrides of [{ 'X-PPC-Package-SHA256': '0'.repeat(64) }, { 'X-PPC-Package-Generation': '0' }, { 'X-PPC-Package-Revision': '-1' }, { 'X-PPC-Package-Candidate-Id': 'bad' }, { 'Content-Length': String(bytes.length + 1) }]) {
  let called = false;
  await assert.rejects(client.downloadLatest({ endpoint, key, fetchImpl: async () => new Response(bytes, { headers: { ...headers, ...overrides } }), onIdentity: () => { called = true; } }), /identity|incomplete|length|digest/i);
  assert.equal(called, false, 'stale_or_missing_identity: rejected bytes never activate a verified identity');
}
await assert.rejects(client.sha256(bytes, { crypto: null }), /integrity checking is unavailable/);
let genericIdentity = false;
assert.deepEqual(await client.downloadLatest({ endpoint: 'https://legacy.example/api/package/latest', key, fetchImpl: async () => new Response(bytes), onIdentity: () => { genericIdentity = true; } }), bytes);
assert.equal(genericIdentity, false, 'legacy_import_compatible: generic relay stays byte-only');
console.log('Package delivery browser checks passed: service_binary_digest, stale_or_missing_identity, legacy_import_compatible, no_added_requests.');
