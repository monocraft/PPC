import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createMasterGateway, publicSnapshot } from '../../supabase/functions/ppc-master/gateway.mjs';
let coreModule, httpModule;
try { coreModule = await import('../../supabase/functions/ppc-package/core.mjs'); httpModule = await import('../../supabase/functions/ppc-package/http.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof coreModule?.createPackageDelivery, 'function', 'unauthorized_no_storage: separate package function is required');
assert.equal(typeof httpModule?.createPackageDeliveryHttpHandler, 'function');
const { createPackageDelivery } = coreModule, { createPackageDeliveryHttpHandler } = httpModule;
const bytes = Buffer.concat([Buffer.from('PPCPKG01'), Buffer.alloc(100, 7)]);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const key = 'PPC-' + Buffer.alloc(32, 1).toString('base64url');
const env = { PPC_PACKAGE_DELIVERY_ENABLED: 'true', PPC_PUBLISHER_SECRET: 'p'.repeat(48), PPC_PACKAGE_KEY_HASH: createHash('sha256').update(key).digest('hex'), PPC_PACKAGE_SP_DRIVE_ID: 'drive', PPC_PACKAGE_SP_FOLDER_ID: 'folder' };
const candidate = { candidateId: '11111111-2222-4333-8444-555555555555', kind: 'publication', generation: 2, expectedGeneration: 1, storageRevision: 7, sourceSha: 'a'.repeat(40), manifestSha256: 'b'.repeat(64), ownerImagesCommit: null, sha256, bytes: bytes.length, objectKey: 'packages/11111111-2222-4333-8444-555555555555.pkg', createdAt: '2026-10-17T00:00:00.000Z', expiresAt: '2026-10-17T03:00:00.000Z', status: 'ready' };
const publication = { provider: 'sharepoint', kind: candidate.kind, generation: 2, candidateId: candidate.candidateId, sha256, bytes: bytes.length, storageRevision: 7, publishedAt: candidate.createdAt };
const stream = value => new ReadableStream({ start(c) { for (let i = 0; i < value.length; i += 13) c.enqueue(value.subarray(i, i + 13)); c.close(); } });
function harness({ config = {}, current = null, cleanup = null, uploadState = 'stored', data = bytes, dbHook } = {}) {
  const calls = [], objects = [];
  const state = { phase: 'sharepoint', current, queued: candidate, cleanup, publication: current ? publication : null,
    upload: { candidateId: candidate.candidateId, generation: 2, attemptId: 'attempt', state: uploadState }, cleanupUpload: cleanup ? { state: uploadState } : null,
    policy: { provider: 'sharepoint', host: 'hp.sharepoint.com', driveId: 'drive', folderId: 'folder' } };
  const database = async (op, payload) => {
    calls.push([op, payload]); const custom = await dbHook?.(op, payload); if (custom) return custom;
    if (op === 'current') return state; if (op === 'rate') return { allowed: true };
    if (op === 'upload_claim') return { status: 'claimed', candidate: { ...candidate, status: 'reserved' }, attemptId: 'attempt' };
    if (op === 'upload_result') return { status: payload.outcome };
    if (op === 'finalize') return { status: 'ready', candidate };
    if (op === 'confirm') return { status: 'already_published', publication };
    if (op === 'cleanup') return { status: 'cleaned' };
    throw Error('Unexpected operation ' + op);
  };
  const storage = { async openObject(c, options) { objects.push(['read', c]); return new Response(stream(data)); },
    async uploadObject(c, body) { objects.push(['write', c]); await new Response(body).arrayBuffer(); return { stored: true }; },
    async signDownload(c) { objects.push(['sign', c]); return 'https://syntheticproject.supabase.co/storage/v1/object/sign/ppc-package-delivery/' + c.objectKey + '?token=read'; },
    async removeObject(c) { objects.push(['remove', c]); return { absent: true }; } };
  const core = createPackageDelivery({ env: { ...env, ...config }, database, storage, now: () => '2026-10-17T01:00:00.000Z' });
  const handler = createPackageDeliveryHttpHandler({ env: { ...env, ...config }, core });
  return { core, handler, calls, objects, state, storage };
}
const control = (op, body = {}, secret = env.PPC_PUBLISHER_SECRET, origin) => new Request('https://service.invalid/api/package/' + op, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PPC-Publisher-Secret': secret, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
for (const mount of ['', '/ppc-package', '/functions/v1/ppc-package']) {
  test(`package routes accept the exact ${mount || 'direct'} mount without changing auth, methods or binary content`, async () => {
    const url = path => 'https://service.invalid' + mount + '/api/package/' + path;
    const headers = { 'Content-Type': 'application/json', 'X-PPC-Publisher-Secret': env.PPC_PUBLISHER_SECRET };
    const current = harness();
    const response = await current.handler(new Request(url('current'), { method: 'POST', headers, body: '{}' }));
    assert.equal(response.status, 200); assert.equal((await response.json()).phase, 'sharepoint');
    assert.deepEqual(current.calls, [['current', {}]]); assert.deepEqual(current.objects, []);
    for (const [method, secret, status] of [['GET', env.PPC_PUBLISHER_SECRET, 405], ['POST', 'bad', 401]]) {
      const rejected = harness();
      const request = new Request(url('current'), { method, headers: { ...headers, 'X-PPC-Publisher-Secret': secret }, ...(method === 'POST' ? { body: '{}' } : {}) });
      assert.equal((await rejected.handler(request)).status, status); assert.deepEqual(rejected.calls, []); assert.deepEqual(rejected.objects, []);
    }
    const upload = harness();
    const uploaded = await upload.handler(new Request(url(`candidates/${candidate.candidateId}/bytes`), { method: 'PUT', headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'X-PPC-Candidate-Generation': '2', 'X-PPC-Publisher-Secret': env.PPC_PUBLISHER_SECRET }, body: bytes }));
    assert.equal(uploaded.status, 200); assert.equal(upload.objects.filter(value => value[0] === 'write').length, 1);
    const read = harness({ current: { ...candidate, status: 'published' } });
    const reader = origin => new Request(url('latest'), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ key }) });
    assert.equal((await read.handler(reader('https://attacker.invalid'))).status, 403); assert.deepEqual(read.objects, []);
    const opened = await read.handler(reader('https://monocraft.github.io'));
    assert.equal(opened.status, 200); assert.equal(opened.headers.get('Access-Control-Allow-Origin'), 'https://monocraft.github.io');
    assert.deepEqual(Buffer.from(await opened.arrayBuffer()), bytes);
  });
}

test('package namespace lookalikes, sibling mounts and doubled prefixes never reach persistence or Storage', async () => {
  for (const path of ['/other/api/package/current', '/ppc-package-extra/api/package/current', '/functions/v1/ppc-package-extra/api/package/current',
    '/ppc-ascm-flow/api/package/current', '/functions/v1/ppc-ascm-flow/api/package/current', '/ppc-package/ppc-package/api/package/current',
    '/functions/v1/ppc-package/ppc-package/api/package/current', '/ppc-package/functions/v1/ppc-package/api/package/current',
    '/%70pc-package/api/package/current', '/ppc-package%2fapi/package/current']) {
    const h = harness(); const request = new Request('https://service.invalid' + path, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-PPC-Publisher-Secret': env.PPC_PUBLISHER_SECRET }, body: '{}' });
    Object.defineProperty(request, 'body', { get() { throw Error('Rejected namespace must not read the body'); } });
    assert.equal((await h.handler(request)).status, 404, path); assert.deepEqual(h.calls, []); assert.deepEqual(h.objects, []);
  }
});

test('unauthorized_no_storage and default-off refuse before persistence or object access', async () => {
  for (const config of [{}, { PPC_PACKAGE_DELIVERY_ENABLED: '' }]) {
    const h = harness({ config }); const response = await h.handler(control('current', {}, 'bad'));
    assert([401, 404].includes(response.status)); assert.equal(h.calls.length, 0); assert.equal(h.objects.length, 0);
  }
});
test('binary_upload_fixed_key claims before body and stale ownership cannot write or release', async () => {
  const request = () => new Request(`https://service.invalid/api/package/candidates/${candidate.candidateId}/bytes`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'X-PPC-Candidate-Generation': '2', 'X-PPC-Publisher-Secret': env.PPC_PUBLISHER_SECRET }, body: stream(bytes), duplex: 'half' });
  const h = harness(); assert.equal((await h.handler(request())).status, 200);
  assert.equal(h.calls[0][0], 'upload_claim'); assert.equal(h.calls.at(-1)[0], 'upload_result'); assert.equal(h.objects[0][0], 'write');
  const stale = harness({ dbHook: op => op === 'upload_claim' ? { status: 'stale' } : null });
  assert.equal((await stale.handler(request())).status, 409); assert.equal(stale.objects.length, 0); assert.equal(stale.calls.length, 1);
});
test('invalid or truncated upload holds an uncertain attempt and never deletes or releases its slot', async () => {
  for (const data of [bytes.subarray(0, -1), Buffer.concat([bytes, Buffer.from([1])]), Buffer.alloc(bytes.length)]) {
    const h = harness();
    const response = await h.handler(new Request(`https://service.invalid/api/package/candidates/${candidate.candidateId}/bytes`, { method: 'PUT', headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'X-PPC-Candidate-Generation': '2', 'X-PPC-Publisher-Secret': env.PPC_PUBLISHER_SECRET,
    }, body: stream(data), duplex: 'half' }));
    assert.equal(response.status, 503); assert.equal(h.calls.at(-1)[1].outcome, 'uncertain');
    assert(!h.calls.some(c => c[0] === 'cleanup')); assert(!h.objects.some(c => c[0] === 'remove'));
  }
});
test('finalize_actual_stream verifies stored ciphertext and recovers original uncertain attempt only after exact readback', async () => {
  const h = harness({ uploadState: 'uncertain' }); await h.core.publisher('finalize', { candidateId: candidate.candidateId, generation: 2 });
  assert.equal(h.objects[0][0], 'read');
  assert.deepEqual(h.calls.find(c => c[0] === 'upload_result')[1], { candidateId: candidate.candidateId, generation: 2, attemptId: 'attempt', outcome: 'stored' });
  assert.deepEqual(h.calls.find(c => c[0] === 'finalize')[1], { candidateId: candidate.candidateId, generation: 2, sha256, bytes: bytes.length, envelopeValid: true });
  const bad = harness({ data: Buffer.concat([bytes.subarray(0, -1), Buffer.from([8])]) });
  await assert.rejects(() => bad.core.publisher('finalize', { candidateId: candidate.candidateId, generation: 2 }));
  assert(!bad.calls.some(c => c[0] === 'finalize'));
});
test('reader_key_cors_abort requires key before Storage and streams identity with abort propagation', async () => {
  const h = harness({ current: { ...candidate, status: 'published' } });
  const reader = (body, origin = 'https://monocraft.github.io', signal) => new Request('https://service.invalid/api/package/latest', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body), signal });
  assert.equal((await h.handler(reader({ key: 'bad' }))).status, 401); assert.equal(h.objects.length, 0);
  assert.equal((await h.handler(reader({ key }, 'https://attacker.invalid'))).status, 403); assert.equal(h.objects.length, 0);
  const response = await h.handler(reader({ key })); assert.equal(response.status, 200); assert.equal(response.headers.get('X-PPC-Package-SHA256'), sha256);
  assert.match(response.headers.get('Access-Control-Expose-Headers'), /X-PPC-Package-Candidate-Id/i);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const controller = new AbortController(); const aborted = await h.handler(reader({ key }, undefined, controller.signal)); controller.abort();
  await assert.rejects(() => aborted.arrayBuffer());
});
test('lost_confirm_retry reaches CAS even with no queued candidate; conflicting readback is rejected', async () => {
  const h = harness({ current: { ...candidate, status: 'published' } }); h.state.queued = null;
  const input = { candidateId: candidate.candidateId, generation: 2, item: { driveId: 'drive', folderId: 'folder', itemId: 'item', versionId: '1.0', fileName: `master-r7-g2-${candidate.candidateId}.pkg` } };
  assert.equal((await h.core.confirmPublication({ ...input, verified: { sha256, bytes: bytes.length } })).status, 'already_published');
  await assert.rejects(() => h.core.confirmPublication({ ...input, verified: { sha256: '0'.repeat(64), bytes: bytes.length } }));
});
test('historical seed and normal lost-confirm retries still reach immutable receipt CAS after current advances', async () => {
  for (const seed of [false, true]) {
    const h = harness({ current: { ...candidate, candidateId: '22222222-2222-4333-8444-555555555555', generation: 3, expectedGeneration: 2, status: 'published' }, dbHook: (operation, payload) => {
      if (operation !== 'confirm') return null;
      assert(!Object.hasOwn(payload.receipt, 'kind')); assert(!Object.hasOwn(payload.receipt, 'storageRevision'));
      assert.equal(payload.receipt.sha256, sha256); assert.equal(payload.receipt.bytes, bytes.length);
      return { status: 'already_published', publication: { ...publication, ...(seed ? { kind: 'seed', generation: 1, storageRevision: 6 } : {}) } };
    } });
    h.state.queued = null;
    const item = { driveId: 'drive', folderId: 'folder', itemId: 'immutable-item', versionId: seed ? '4.0' : '1.0', fileName: seed ? 'master_ppc.pkg' : `master-r7-g2-${candidate.candidateId}.pkg` };
    const result = await h.core.confirmPublication({ candidateId: candidate.candidateId, generation: seed ? 1 : 2, item, verified: { sha256, bytes: bytes.length } });
    assert.equal(result.status, 'already_published'); assert.equal(result.publication.kind, seed ? 'seed' : 'publication');
  }
  const held = harness({ dbHook: operation => operation === 'confirm' ? { status: 'stale', publication: null } : null }); held.state.queued = null;
  await assert.rejects(() => held.core.confirmPublication({ candidateId: candidate.candidateId, generation: 2,
    item: { driveId: 'drive', folderId: 'folder', itemId: 'never-published', versionId: '1.0', fileName: `master-r7-g2-${candidate.candidateId}.pkg` }, verified: { sha256, bytes: bytes.length } }), error => error.code === 'PACKAGE_STALE');
  assert.equal(held.calls.filter(c => c[0] === 'confirm').length, 1, 'SQL alone owns immutable historical receipt existence; no history lookup is exposed');
});
test('bounded_cleanup never deletes unsettled writes or releases slot after failure; public state is sanitized', async () => {
  const cleanup = { ...candidate, status: 'cleanup' };
  const held = harness({ cleanup, uploadState: 'uncertain' }); await held.core.publisher('current', {}); assert(!held.objects.some(c => c[0] === 'remove')); assert(!held.calls.some(c => c[0] === 'cleanup'));
  const settled = harness({ cleanup }); await settled.core.publisher('current', {}); assert.equal(settled.objects.filter(c => c[0] === 'remove').length, 1); assert.equal(settled.calls.filter(c => c[0] === 'cleanup').length, 1);
  const failed = harness({ cleanup }); failed.storage.removeObject = async () => { throw Error('isolated delete failure'); };
  await failed.core.publisher('current', {}); assert(!failed.calls.some(c => c[0] === 'cleanup'), 'failed delete cannot release the recorded slot');
  const h = harness({ current: { ...candidate, status: 'published' } }); assert.deepEqual(await h.core.publicState(), publication);
  assert(!JSON.stringify(await h.core.publicState()).includes('objectKey'));
});
test('private export retains backend accepted-manifest digest while public snapshot discloses only sanitized identity', async () => {
  const acceptedManifestSha256 = 'b'.repeat(64);
  const state = { manifest: { version: 4, categories: [], imageAssets: [] }, storageRevision: 7, sourceSha: 'a'.repeat(40), acceptedManifestSha256,
    publication: { ...publication, deliveryPhase: 'sharepoint', requestedRevision: 7, publishedRevision: 7, driveId: 'private-drive', objectKey: candidate.objectKey, downloadUrl: 'private-capability', manifestSha256: acceptedManifestSha256 } };
  const snapshot = publicSnapshot(state);
  assert.equal(snapshot.publication.provider, 'sharepoint'); assert.equal(snapshot.publication.status, 'current');
  assert.deepEqual(Object.keys(snapshot.publication).sort(), ['bytes', 'candidateId', 'deliveryPhase', 'error', 'generation', 'kind', 'provider', 'publishedAt', 'publishedRevision', 'requestedRevision', 'sha256', 'status', 'storageRevision'].sort());
  assert(!JSON.stringify(snapshot).includes('private-')); assert(!JSON.stringify(snapshot).includes('acceptedManifestSha256'));
  const handle = createMasterGateway({ env, rpc: async operation => operation === 'rate' ? { allowed: true } : state });
  const response = await handle(new Request('https://service.invalid/api/master/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PPC-Publisher-Secret': env.PPC_PUBLISHER_SECRET }, body: '{}' }));
  assert.equal(response.status, 200); const exported = await response.json(); assert.equal(exported.acceptedManifestSha256, acceptedManifestSha256);
  assert.deepEqual(exported.manifest, state.manifest); assert(!Object.hasOwn(exported.publication, 'manifestSha256'));
});
