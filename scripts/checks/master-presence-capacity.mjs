import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createMasterServer } from '../../server/master-service.mjs';
const codec = globalThis.PortfolioPackage;
const directory = await mkdtemp(join(tmpdir(), 'ppc-presence-capacity-'));
const packageFile = join(directory, 'synthetic.pkg');
const key = codec.generateKey(), wrongKey = codec.generateKey(), rotatedKey = codec.generateKey();
const manifest = { version: 4, categories: [{ id: 'category', board: { lanes: [{ id: 'lane' }], products: [{ id: 'p', name: 'Product', laneId: 'lane' }] } }],
  packageInfo: { version: 1, updatedAt: '2026-10-13T00:00:00.000Z', comments: '' } };
const zip = codec.createZip([{ name: 'portfolio.json', data: new TextEncoder().encode(JSON.stringify(manifest)) }]);
await writeFile(packageFile, await codec.encrypt(zip, key));
const server = createMasterServer({ packageFile, allowedOrigins: ['https://monocraft.github.io'] });
const originalDecrypt = globalThis.crypto.subtle.decrypt;
let active = 0, peak = 0, decryptCalls = 0, release;
const gate = new Promise(resolveGate => { release = resolveGate; });
Object.defineProperty(globalThis.crypto.subtle, 'decrypt', { configurable: true, writable: true,
  value: async function (...args) { decryptCalls += 1; active += 1; peak = Math.max(peak, active);
    try { await gate; return await originalDecrypt.apply(this, args); } finally { active -= 1; } } });
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}/api/master/presence`;
  const call = (body, signal) => fetch(endpoint, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Origin: 'https://monocraft.github.io' }, body: JSON.stringify(body) });
  const controllers = Array.from({ length: 40 }, () => new AbortController());
  const requests = controllers.map((controller, index) => call({ key: wrongKey, sessionId: `capacity-presence-${index}` }, controller.signal)
    .then(response => response.status, error => { if (error.name === 'AbortError') return 'aborted'; throw error; }));
  await new Promise(resolveWait => setTimeout(resolveWait, 200));
  controllers[5].abort(); controllers[6].abort();
  await new Promise(resolveWait => setTimeout(resolveWait, 200));
  release();
  const statuses = await Promise.all(requests);
  assert.equal(peak, 1, 'A wrong key cannot start a concurrent full-file presence decryption.');
  assert(statuses.every(status => [401, 503, 'aborted'].includes(status)));
  assert(statuses.includes(503), 'The shared queue refuses requests beyond its 32-operation cap.');
  assert(statuses.includes('aborted'), 'Cancellation cannot defeat the bounded queue or crash the handler.');
  const before = decryptCalls;
  assert.equal((await call({ key, sessionId: 'capacity-good', categoryId: 'category', productId: 'p', editing: true })).status, 200);
  assert.equal((await call({ key, sessionId: 'capacity-good', categoryId: 'category', productId: 'p', editing: true })).status, 200);
  assert.equal(decryptCalls - before, 1, 'Repeated known-source heartbeats retain the authenticated cache path.');
  await writeFile(packageFile, await codec.encrypt(zip, rotatedKey));
  assert.equal((await call({ key, sessionId: 'capacity-good', categoryId: 'category', productId: 'p', editing: true })).status, 401);
  assert.equal((await call({ key: rotatedKey, sessionId: 'capacity-good', categoryId: 'category', productId: 'p', editing: true })).status, 200);
  assert.equal(peak, 1, 'Source/key rotation still uses serialized fresh authentication.');
  console.log(JSON.stringify({ requests: requests.length, peakUnauthorizedDecryptions: peak, overloadResponses: statuses.filter(status => status === 503).length,
    cancelledRequests: statuses.filter(status => status === 'aborted').length, cachedRepeatDecryptions: 1, keyRotationRejectedOldKey: true }));
} finally {
  release();
  Object.defineProperty(globalThis.crypto.subtle, 'decrypt', { configurable: true, writable: true, value: originalDecrypt });
  await new Promise(done => { server.closeAllConnections(); server.close(done); });
  assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert(basename(directory).startsWith('ppc-presence-capacity-'));
  await rm(directory, { recursive: true, force: true });
}
