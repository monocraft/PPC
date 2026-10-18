import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createPackageDeliveryClient, PackageDeliveryClientError } from '../package-delivery-client.mjs';
import { createSupabasePublisher, PINNED_SHAREPOINT_SEED, stageVerifiedSeedArchive } from '../publish-supabase-master.mjs';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { harness, original, unpacked, packageKey } from './supabase-publisher.mjs';
import { digest, imageBinding, scopedImageDigest } from '../owner-image-layer.mjs';

const endpoint = 'https://fixture.supabase.co/functions/v1/ppc-master/api/master';
const secret = 'fixture_publisher_secret_123456789000';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');
const clone = structuredClone;
const enriched = clone(original);
enriched.categories[0].board.products[0].msrp = { amount: 199.99, currency: 'USD' };
enriched.acceptedConflict = { field: 'launch', resolution: 'owner accepted' };
enriched.masterSync = { historicalReceipt: { type: 'owner-retirement', count: 2 } };
const baseline = await harness({ initialManifest: enriched }); await baseline.publisher.publish();
const seedBytes = baseline.bytes;
const sourceSha = baseline.sourceSha;
const seedManifest = (await unpacked(seedBytes)).manifest;
delete seedManifest.masterSync.supabasePublication;
const manifestSha = 'a'.repeat(64);
const id = '11111111-1111-4111-8111-111111111111';
const date = '2026-10-18T00:00:00.000Z';

function fixture({ requestHook = null, owner = null, ownerCandidate = null, revision = 1, seed = false, sameRevision = false, corruptArchive = false, loseUploadReply = false, loseReserveReply = false, acceptedFfsDate = null, archiveResponse = null } = {}) {
  let current = seed ? null : { candidateId: id, kind: 'seed', generation: 1, expectedGeneration: 0, storageRevision: sameRevision ? revision : 1,
    sourceSha, manifestSha256: manifestSha, ownerImagesCommit: null, sha256: sha256(seedBytes), bytes: seedBytes.length,
    objectKey: `packages/${id}.pkg`, createdAt: date, expiresAt: '2026-10-19T00:00:00.000Z', status: 'published' };
  let queued = null, queuedUploadState = null, seedInput = null, store = seedBytes.slice(), uploaded = null, finalizeFails = false, publication = { publishedRevision: current?.storageRevision ?? 0, kind: current?.kind ?? null };
  const calls = [], exports = [], waits = [];
  const delivery = {
    async readCurrent() { calls.push('current'); return { phase: seed ? 'seeding' : 'sharepoint', current: clone(current), queued: clone(queued), queuedUploadState, downloadUrl: current ? `https://fixture.supabase.co/storage/v1/object/sign/ppc-package-delivery/${current.objectKey}?token=read` : undefined }; },
    async reserve(meta, kind = 'reserve') { calls.push(kind); assert.equal(meta.ownerImagesCommit, owner); assert.equal(meta.sourceSha, sourceSha); assert.equal(meta.manifestSha256, kind === 'seed' ? null : manifestSha); assert.equal(meta.expectedGeneration, current?.generation ?? 0); if (kind === 'seed') seedInput = clone(meta); const { trustedGithubSha, ...candidateMeta } = meta; queued = { ...candidateMeta, kind: kind === 'seed' ? 'seed' : 'publication', generation: (current?.generation ?? 0) + 1, objectKey: `packages/${meta.candidateId}.pkg`, createdAt: date, expiresAt: '2026-10-19T00:00:00.000Z', status: 'reserved' }; queuedUploadState = 'none'; if (loseReserveReply) throw new Error('Synthetic lost reserve reply'); return { status: 'reserved', candidate: clone(queued) }; },
    async upload(candidate, bytes) { calls.push('upload'); assert.equal(candidate.candidateId, queued.candidateId); uploaded = bytes.slice(); queuedUploadState = 'stored'; if (loseUploadReply) throw new Error('Synthetic lost upload reply'); },
    async finalize(candidate) { calls.push('finalize'); assert.equal(candidate.candidateId, queued.candidateId); if (finalizeFails || ['none', 'absent'].includes(queuedUploadState)) throw new Error('Synthetic uncertain object'); queued.status = 'ready'; return { status: 'ready', candidate: clone(queued) }; },
    async seed(meta) { return this.reserve(meta, 'seed'); },
  };
  const fetchImpl = async (url, options) => {
    const intercepted = await requestHook?.(url, options); if (intercepted) return intercepted;
    if (url === `${endpoint}/export`) {
      calls.push('export'); const manifest = clone(seedManifest);
      if (acceptedFfsDate) manifest.categories[0].board.products[0].ffsDate = acceptedFfsDate;
      const result = { manifest, sourceSha, storageRevision: revision, acceptedManifestSha256: manifestSha,
        publication: { ...publication, status: 'pending' } }; exports.push(result); return Response.json(result);
    }
    if (url === `https://fixture.supabase.co/storage/v1/object/sign/ppc-package-delivery/${current?.objectKey}?token=read`) {
      calls.push('archive'); assert.equal(options.credentials, 'omit'); assert.equal(options.headers['X-PPC-Publisher-Secret'], undefined);
      assert.equal(options.headers.Authorization, undefined); const bytes = store.slice(); if (corruptArchive) bytes[40] ^= 1; return archiveResponse ? archiveResponse(options) : new Response(bytes);
    }
    if (url === PINNED_SHAREPOINT_SEED.url) { calls.push('seed-read'); assert.equal(options.headers['X-PPC-Publisher-Secret'], undefined); return new Response(seedBytes.slice()); }
    if (ownerCandidate && url === `https://api.github.com/repos/monocraft/PPC/contents/public/data/master_ppc.pkg?ref=${owner}`)
      return Response.json({ type: 'file', sha: blob(ownerCandidate), size: ownerCandidate.length });
    if (ownerCandidate && url === `https://api.github.com/repos/monocraft/PPC/git/blobs/${blob(ownerCandidate)}`)
      return new Response(ownerCandidate.slice());
    throw new Error(`Unexpected request: ${url}`);
  };
  const publisher = createSupabasePublisher({ endpoint, publisherSecret: secret, packageKey, githubToken: 'github_fixture_private_secret_123456789', publicationMode: 'sharepoint',
    deliveryClient: delivery, fetchImpl, wait: async ms => { waits.push(ms); }, now: () => Date.parse(date), imagesCommit: owner || '', readCachedPackage: () => { throw new Error('Git cache accessed'); },
    writePackage: () => { throw new Error('Git write accessed'); } });
  return { publisher, delivery, calls, exports, waits, get queued() { return queued; }, get seedInput() { return seedInput; }, get bytes() { return uploaded; }, get current() { return current; },
    setQueued(value, state = 'uncertain') { queued = value; queuedUploadState = value ? state : null; }, advanceRevision(value) { revision = value; }, failFinalize(value = true) { finalizeFails = value; }, setCurrent(value, bytes = seedBytes) { current = value; store = bytes; }, setPublication(value) { publication = value; },
    async pendingOutput() { return unpacked(uploaded); } };
}
// Retry only bounded active reads. No additional scheduler or background task.
for (const stage of ['export', 'archive']) {
  const requests = [];
  const h = fixture({ requestHook: (url, options) => {
    if (!(stage === 'export' ? url.endsWith('/export') : url.includes('/object/sign/'))) return;
    requests.push({ url, body: options.body });
    if (requests.length === 1) return new Response('temporary', { status: 503, headers: { 'Retry-After': '999999' } });
  } });
  assert.equal((await h.publisher.publish()).status, 'pending');
  assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]); assert.deepEqual(h.waits, [30000]);
}
for (const stage of ['export', 'archive']) {
  let attempts = 0;
  const h = fixture({ requestHook: url => {
    if (!(stage === 'export' ? url.endsWith('/export') : url.includes('/object/sign/'))) return;
    attempts++; throw new Error('private transport fixture details');
  } });
  await assert.rejects(h.publisher.publish(), error => error.code === 'CONNECTION_FAILED' && error.stage === stage);
  assert.equal(attempts, 3); assert.deepEqual(h.waits, [250, 500]); assert(!h.calls.includes('reserve'));
}
for (const [status, code] of [[401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [409, 'PROTECTED_DATA_CONFLICT'], [503, 'POLICY_DENIED']]) {
  let attempts = 0;
  const h = fixture({ requestHook: url => { if (url.endsWith('/export')) { attempts++; return Response.json({ code }, { status }); } } });
  await assert.rejects(h.publisher.publish(), error => error.code === 'BRIDGE_UNAVAILABLE');
  assert.equal(attempts, 1); assert.deepEqual(h.waits, []); assert(!h.calls.includes('reserve'));
}

for (const stage of ['export', 'archive']) for (const status of [200, 503]) {
  let attempts = 0;
  const h = fixture({ requestHook: url => {
    if (!(stage === 'export' ? url.endsWith('/export') : url.includes('/object/sign/'))) return;
    if (++attempts === 1) return new Response(new ReadableStream({
      start(controller) { controller.error(new Error('synthetic response stream interrupted')); }
    }), { status });
  } });
  assert.equal((await h.publisher.publish()).status, 'pending', `interrupted HTTP ${status} ${stage} response remains recoverable`);
  assert.equal(attempts, 2); assert.deepEqual(h.waits, [250]);
}
for (const stage of ['export', 'archive']) for (const status of [401, 403, 409]) {
  let attempts = 0;
  const privateDetails = 'private interrupted-response details';
  const h = fixture({ requestHook: url => {
    if (!(stage === 'export' ? url.endsWith('/export') : url.includes('/object/sign/'))) return;
    attempts++;
    return new Response(new ReadableStream({ start(controller) { controller.error(new Error(privateDetails)); } }), { status });
  } });
  await assert.rejects(h.publisher.publish(), error => {
    assert.equal(error.code, stage === 'export' ? 'BRIDGE_UNAVAILABLE' : 'DELIVERY_CURRENT_INVALID');
    assert.equal(error.stage, stage);
    assert(!`${error.message} ${error.stack} ${JSON.stringify(error)}`.includes(privateDetails));
    return true;
  }, `known HTTP ${status} remains a hold when its ${stage} error body is interrupted`);
  assert.equal(attempts, 1, 'known auth/policy/conflict response cannot become a retryable transport loss');
  assert.deepEqual(h.waits, []); assert(!h.calls.includes('reserve')); assert(!h.calls.includes('upload'));
}

{
  const h = fixture();
  h.delivery.readCurrent = async () => { throw new PackageDeliveryClientError('PACKAGE_UNAVAILABLE', 'current', 503); };
  await assert.rejects(h.publisher.publish(), error => error.code === 'PACKAGE_UNAVAILABLE' && error.stage === 'current', 'typed delivery stage survives publisher diagnostics');
}
{
  let attempts = 0;
  const h = fixture({ requestHook: url => {
    if (url.endsWith('/export')) { attempts++; return Response.json({ code: 'MASTER_UNAVAILABLE' }, { status: 503 }); }
  } });
  await assert.rejects(h.publisher.publish(), error => error.code === 'BRIDGE_UNAVAILABLE' && error.stage === 'export');
  assert.equal(attempts, 3); assert.deepEqual(h.waits, [250, 500]);
}

// A ready generation belongs to its persisted accepted input, even if a newer
// report or owner dispatch has since advanced the export.
{
  const h = fixture(); await h.publisher.publish(); const ready = clone(h.queued);
  h.advanceRevision(2); h.calls.length = 0;
  const result = await h.publisher.publish();
  assert.deepEqual(result, { status: 'pending', revision: 1, candidateId: ready.candidateId }, 'ready R must drain while accepted R+1 stays pending');
  assert.deepEqual(h.calls, ['export', 'current'], 'ready recovery creates no second ciphertext or candidate');
}
for (const state of ['none', 'absent']) {
  const h = fixture(); await h.publisher.publish();
  const old = clone(h.queued), oldBytes = h.bytes.slice();
  h.setQueued({ ...old, status: 'reserved' }, state); h.advanceRevision(2); h.calls.length = 0;
  const result = await h.publisher.publish();
  assert.equal(result.revision, 2);
  assert.notEqual(result.candidateId, old.candidateId, 'restart uses a fresh candidate identity');
  assert.notEqual(h.queued.sha256, old.sha256, 'fresh randomized ciphertext never changes metadata under the old ID');
  assert.notDeepEqual(h.bytes, oldBytes);
  assert.equal(h.queued.storageRevision, 2); assert.equal(h.queued.expectedGeneration, 1);
  assert.deepEqual(h.calls, ['export', 'current', 'archive', 'reserve', 'upload', 'finalize']);
}
for (const state of ['none', 'absent']) {
  const h = fixture(); await h.publisher.publish();
  const queued = { ...h.queued, ownerImagesCommit: 'd'.repeat(40), status: 'reserved' };
  h.setQueued(clone(queued), state); h.advanceRevision(2); h.calls.length = 0;
  await assert.rejects(h.publisher.publish(), error => error.code === 'PACKAGE_QUEUED_OTHER_INPUT',
    'an ordinary dispatcher cannot replace the durable queued owner-image input with null');
  assert.deepEqual(h.queued, queued); assert.deepEqual(h.calls, ['export', 'current']);
}
for (const state of ['uploading', 'uncertain', 'stored', null, 'invalid']) {
  const h = fixture(); await h.publisher.publish();
  const old = clone(h.queued); h.setQueued({ ...old, status: 'reserved' }, state);
  h.advanceRevision(2); h.failFinalize(); h.calls.length = 0;
  await assert.rejects(h.publisher.publish(), error => error.code === 'PACKAGE_UPLOAD_UNSETTLED', 'claimed or unknown state cannot build another candidate');
  assert(!h.calls.includes('reserve')); assert(!h.calls.includes('upload')); assert(!h.calls.includes('archive'));
  assert.equal(h.queued.candidateId, old.candidateId);
}
{
  const h = fixture(); await h.publisher.publish(); const old = clone(h.queued);
  h.setQueued({ ...old, ownerImagesCommit: 'd'.repeat(40), status: 'reserved' }, 'uncertain'); h.advanceRevision(2); h.calls.length = 0;
  assert.deepEqual(await h.publisher.publish(), { status: 'pending', revision: 1, candidateId: old.candidateId }, 'positive finalize drains the exact older candidate');
  assert.deepEqual(h.calls, ['export', 'current', 'finalize']);
}
for (const invalid of [{ generation: 12 }, { candidateId: 'not-an-id' }, { sha256: 'wrong' }, { storageRevision: 3 }]) {
  const h = fixture(); await h.publisher.publish(); h.setQueued({ ...h.queued, ...invalid }); h.calls.length = 0;
  await assert.rejects(h.publisher.publish(), error => error.code === 'PACKAGE_QUEUED_OTHER_INPUT', 'malformed or impossible ready metadata cannot drain');
  assert(!h.calls.includes('reserve')); assert(!h.calls.includes('upload'));
}

async function withGzipArchive(bytes, verify) {
  const compressed = gzipSync(bytes), requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, publisher: request.headers['x-ppc-publisher-secret'], authorization: request.headers.authorization });
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Content-Length': String(compressed.length) });
    response.end(compressed);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/archive`;
    await verify(options => fetch(url, options), compressed.length);
    assert.deepEqual(requests, [{ method: 'GET', publisher: undefined, authorization: undefined }]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

// Fetch decodes gzip but retains its compressed Content-Length. An encrypted
// archive can expand on the wire while its decoded bytes exactly match the pin.
await withGzipArchive(seedBytes, async (archiveResponse, wireBytes) => {
  assert(wireBytes > seedBytes.length, 'incompressible encrypted fixture has gzip overhead');
  const h = fixture({ archiveResponse });
  await assert.doesNotReject(async () => {
    const result = await h.publisher.publish(); assert.equal(result.status, 'pending');
    const output = await h.pendingOutput();
    assert.equal(output.manifest.categories[0].board.products[0].ffsDate, '2026-12-10');
    assert.deepEqual(output.entries.get('attachments/extra.bin'), Uint8Array.of(17, 19, 21, 23, 0, 25));
    assert.equal(h.queued.kind, 'publication'); assert.equal(h.queued.status, 'ready');
  }, 'gzip wire overhead must not reject an exact valid decoded archive');
});

await withGzipArchive(Buffer.alloc(seedBytes.length + 1, 37), async (archiveResponse, wireBytes) => {
  assert(wireBytes < seedBytes.length, 'compressed fixture hides a decoded response above the bound');
  const h = fixture({ archiveResponse });
  await assert.rejects(h.publisher.publish(), error => error.code === 'RESPONSE_TOO_LARGE', 'decoded bytes must remain bounded independently of compressed Content-Length');
  assert(!h.calls.includes('reserve')); assert(!h.calls.includes('upload'));
});

for (const [encoding, declared] of [[undefined, String(seedBytes.length + 1)], ['identity', String(seedBytes.length + 1)], ['gzip', 'not-a-number'], ['br', '-1']]) {
  const h = fixture({ archiveResponse: () => new Response(seedBytes.slice(), { headers: {
    'Content-Length': declared, ...(encoding ? { 'Content-Encoding': encoding } : {}) } }) });
  await assert.rejects(h.publisher.publish(), error => error.code === 'RESPONSE_TOO_LARGE', 'identity length ceilings and numeric declarations remain enforced');
  assert(!h.calls.includes('reserve')); assert(!h.calls.includes('upload'));
}

{
  const workflow = await readFile(new URL('../../.github/workflows/publish-master.yml', import.meta.url), 'utf8');
  const steps = [...workflow.matchAll(/^ {6}- name: ([^\r\n]+)\r?\n {8}if: \$\{\{ ([^\r\n]+) \}\}\r?\n {8}run: (node scripts\/publish-supabase-master\.mjs(?: --[a-z-]+)?)$/gm)]
    .map(([, name, condition, command]) => ({ name, condition, command }));
  assert.equal(steps.length, 3, 'all publisher mutation steps must have explicit conditions');
  const selected = (eventName, bootstrap, seedDeliveryCache) => steps.filter(step => Boolean(runInNewContext(step.condition,
    { github: { event_name: eventName }, inputs: { bootstrap, seed_delivery_cache: seedDeliveryCache } }, { timeout: 1000 })))
    .map(step => step.command);
  const normal = 'node scripts/publish-supabase-master.mjs';
  assert.deepEqual(selected('workflow_dispatch', true, true), [], 'combined bootstrap and seed selects no mutating step');
  assert.deepEqual(selected('workflow_dispatch', true, false), [`${normal} --bootstrap`, normal]);
  assert.deepEqual(selected('workflow_dispatch', false, true), [`${normal} --seed-delivery-cache`]);
  assert.deepEqual(selected('workflow_dispatch', false, false), [normal]);
  assert.deepEqual(selected('schedule', undefined, undefined), [], 'no idle publisher operation can execute');
}

// Client transport: same origin, secret only on control and binary PUT; signed read has no credentials.
{
  assert.equal(PINNED_SHAREPOINT_SEED.url, 'https://monocraft.github.io/PPC/data/master_ppc.pkg');
  assert.equal(PINNED_SHAREPOINT_SEED.bytes, 45_439_227);
  assert.equal(PINNED_SHAREPOINT_SEED.sha256, 'd1af8e0e7fd1782a2b52433a38b62db227cc42a999179fb3ddd7d7d2bee1b7e2');
  assert.match(PINNED_SHAREPOINT_SEED.sha256, /^[a-f0-9]{64}$/);
}
{
  const requests = [];
  const fetchImpl = async (url, options) => { requests.push({ url, options });
    if (url.endsWith('/current')) return Response.json({ phase: 'sharepoint', current: null, queued: null });
    if (url.endsWith('/reserve')) return Response.json({ status: 'reserved', candidate: { candidateId: id, generation: 2 } });
    if (url.endsWith('/bytes')) return Response.json({ status: 'stored' });
    return Response.json({ status: 'ready', candidate: { candidateId: id, generation: 2 } });
  };
  const client = createPackageDeliveryClient({ endpoint: 'https://fixture.supabase.co/functions/v1/ppc-package/api/package', publisherSecret: secret, fetchImpl });
  await client.readCurrent(); const reserved = await client.reserve({candidateId:id}); await client.upload(reserved.candidate, seedBytes); await client.finalize(reserved.candidate);
  assert.deepEqual(requests.map(r => new URL(r.url).pathname.split('/').at(-1)), ['current','reserve','bytes','finalize']);
  assert.equal(requests[2].options.headers['Content-Length'], String(seedBytes.length));
  assert.equal(requests[2].options.headers['X-PPC-Candidate-Generation'], '2');
  assert.equal(requests[2].options.headers['Content-Type'], 'application/octet-stream');
  assert.deepEqual(new Uint8Array(requests[2].options.body), seedBytes);
  assert.ok(requests.every(r => r.options.headers['X-PPC-Publisher-Secret'] === secret));
}
{
  const h = fixture({ loseReserveReply: true });
  assert.equal((await h.publisher.publish()).status, 'pending');
  assert.equal(h.calls.filter(v => v === 'reserve').length, 1);
  assert.equal(h.calls.filter(v => v === 'upload').length, 1, 'same invocation retains exact encrypted bytes after lost reserve reply');
}
{
  const h = fixture({ loseUploadReply: true });
  assert.equal((await h.publisher.publish()).status, 'pending', 'lost binary-upload reply finalizes the verified stored object');
  assert.equal(h.calls.filter(v => v === 'upload').length, 1);
  assert.equal(h.queued.status, 'ready');
}
{
  const h = fixture(); const result = await h.publisher.publish();
  assert.equal(result.status, 'pending'); assert.ok(h.calls.includes('archive')); assert.ok(!h.calls.includes('deploy'));
  const output = await h.pendingOutput(); assert.equal(output.manifest.categories[0].board.products[0].ffsDate, '2026-12-10');
  assert.deepEqual(output.entries.get('images/hero.webp'), Uint8Array.of(0,255,34,0,9));
  assert.deepEqual(output.entries.get('attachments/extra.bin'), Uint8Array.of(17,19,21,23,0,25));
  assert.deepEqual(output.manifest.categories[0].board.products[0].msrp, { amount: 199.99, currency: 'USD' });
  assert.deepEqual(output.manifest.acceptedConflict, { field: 'launch', resolution: 'owner accepted' });
  assert.deepEqual(output.manifest.masterSync.historicalReceipt, { type: 'owner-retirement', count: 2 });
  assert.equal(h.queued.manifestSha256, manifestSha); assert.equal(h.queued.sourceSha, sourceSha);
  assert.equal(h.current.storageRevision, 1, 'ready candidate is not published');
}
{
  const commit = 'c'.repeat(40), codec = globalThis.PortfolioPackage, candidateManifest = clone(seedManifest);
  const entries = (await unpacked(seedBytes)).entries, newImage = Uint8Array.of(137,80,78,71,1,2,3,4);
  candidateManifest.categories[0].board.products[0].imageAssetId = 'owner-hero';
  candidateManifest.imageAssets.push({ id: 'owner-hero', sourceType: 'local', name: 'owner-hero.png', mimeType: 'image/png',
    size: newImage.length, url: '', updatedAt: '2026-10-17T00:00:00Z', packagePath: 'images/owner-hero.png' });
  entries.set('images/owner-hero.png', newImage);
  const assignment = { categoryId: 'pc', productId: 'headset', variantId: null, imageAssetId: 'owner-hero', sha256: digest(newImage),
    bytes: newImage.length, sourceSku: 'HP001', familyDefault: false, featuredVariantId: '' };
  assignment.binding = imageBinding(candidateManifest, assignment);
  const descriptor = { version: 1, scope: 'offline-owner-fixture', sourceSha,
    baseImageDigest: scopedImageDigest(seedManifest, (await unpacked(seedBytes)).entries, [assignment]), assignments: [assignment] };
  entries.set('portfolio.json', new TextEncoder().encode(JSON.stringify(candidateManifest)));
  entries.set('owner-image-input.json', new TextEncoder().encode(JSON.stringify(descriptor)));
  const ownerCandidate = await codec.encrypt(codec.createZip([...entries].map(([name, data]) => ({name,data}))), packageKey);
  const h = fixture({ owner: commit, ownerCandidate, sameRevision: true });
  assert.equal((await h.publisher.publish()).status, 'pending');
  assert.equal(h.queued.storageRevision, h.current.storageRevision, 'owner image change may publish at same business revision');
  assert.equal(h.queued.ownerImagesCommit, commit);
  const output = await h.pendingOutput();
  assert.equal(output.manifest.categories[0].board.products[0].imageAssetId, 'owner-hero');
  assert.deepEqual(output.entries.get(output.manifest.imageAssets.find(asset => asset.id === 'owner-hero').packagePath), newImage);
  assert.deepEqual(output.entries.get('attachments/extra.bin'), Uint8Array.of(17,19,21,23,0,25));
  for (const state of ['none', 'absent']) {
    const old = clone(h.queued); h.setQueued({ ...old, status: 'reserved' }, state); h.calls.length = 0;
    const restarted = await h.publisher.publish();
    assert.equal(restarted.status, 'pending'); assert.notEqual(restarted.candidateId, old.candidateId);
    assert.notEqual(h.queued.sha256, old.sha256); assert.equal(h.queued.ownerImagesCommit, commit);
    assert.deepEqual(h.calls, ['export', 'current', 'archive', 'reserve', 'upload', 'finalize'], 'matching explicit owner input safely rebuilds unclaimed work');
  }

}
{
  const h = fixture({ corruptArchive: true });
  await assert.rejects(h.publisher.publish(), error => error.code === 'DELIVERY_CURRENT_INVALID');
  assert.equal(h.calls.filter(v => v === 'archive').length, 1);
  assert.equal(h.calls.filter(v => v === 'reserve').length, 0, 'corrupt cache does not fall back to Git');
}
for (const [requestedOwner, queuedOwner, queuedStatus = 'ready'] of [
  ['d'.repeat(40), 'c'.repeat(40)], ['d'.repeat(40), null], ['d'.repeat(40), 'd'.repeat(40)], ['', 'c'.repeat(40)],
  ['d'.repeat(40), 'c'.repeat(40), 'reserved'], ['d'.repeat(40), null, 'reserved']
]) {
  const h = fixture({ owner: requestedOwner || null, revision: 2 });
  const queued = { ...h.current, candidateId: '22222222-2222-4222-8222-222222222222',
    objectKey: 'packages/22222222-2222-4222-8222-222222222222.pkg', kind: 'publication', generation: 2,
    expectedGeneration: 1, storageRevision: 1, manifestSha256: manifestSha, ownerImagesCommit: queuedOwner, status: queuedStatus };
  h.setQueued(clone(queued));
  if (!requestedOwner || queuedOwner === requestedOwner) {
    assert.deepEqual(await h.publisher.publish(), { status: 'pending', revision: 1, candidateId: queued.candidateId }, 'normal ASCM or the exact explicit owner-image input can drain an older ready generation');
  } else {
    await assert.rejects(h.publisher.publish(), error => error.code === 'PACKAGE_QUEUED_OTHER_INPUT',
      'an explicit owner-image dispatch must hold when queued ready work belongs to another or no owner input');
  }
  assert.deepEqual(h.queued, queued, 'the existing queued identity, bytes metadata and accepted revision remain unchanged');
  assert.deepEqual(h.calls, ['export', 'current'], 'explicit owner handling never acknowledges, builds, reserves, uploads, or finalizes different queued work');
}

{
  const h = fixture(); await h.publisher.publish(); const queued = { ...h.queued, status: 'reserved' }; h.setQueued(queued);
  assert.equal((await h.publisher.publish()).status, 'pending', 'restart finalizes exact stored object');
  const held = fixture(); await held.publisher.publish(); held.setQueued({ ...held.queued, status: 'reserved' }); held.failFinalize();
  await assert.rejects(held.publisher.publish(), error => error.code === 'PACKAGE_UPLOAD_UNSETTLED');
  assert.equal(held.calls.filter(v => v === 'reserve').length, 1);
  assert.equal(h.calls.filter(v => v === 'reserve').length, 1);
}
{
  const h = fixture({ seed: true, revision: 2 });
  await assert.rejects(h.publisher.publish(), error => error.code === 'SEED_REQUIRED');
  await assert.rejects(h.publisher.seedDeliveryCache(), error => error.code === 'SEED_BYTES_MISMATCH');
  assert.equal(h.calls.filter(v => v === 'seed-read').length, 1);
  assert.equal(h.calls.filter(v => v === 'seed').length, 0);
}
{
  const h = fixture({ seed: true, revision: 2, acceptedFfsDate: '2027-02-03' });
  h.setPublication({ publishedRevision: 1, status: 'pending' });
  await assert.rejects(h.publisher.publish(), error => error.code === 'SEED_REQUIRED');
  const target = h.exports.at(-1);
  const result = await stageVerifiedSeedArchive({ target, source: { bytes: seedBytes.slice(), sha: blob(seedBytes) },
    delivery: h.delivery, packageKey, endpoint });
  assert.equal(result.status, 'pending'); assert.equal(result.revision, 1, 'seed uses the published baseline, not newer accepted revision');
  assert.equal(h.queued.kind, 'seed'); assert.equal(h.queued.storageRevision, 1);
  assert.equal(h.queued.manifestSha256, null); assert.equal(h.queued.ownerImagesCommit, null);
  assert.equal(h.seedInput.trustedGithubSha, blob(seedBytes));
  assert.equal(h.calls.filter(v => v === 'seed').length, 1);
  assert.equal(h.calls.filter(v => v === 'upload').length, 1);
  h.setCurrent({ ...h.queued, status: 'published' }, seedBytes); h.setQueued(null);
  h.setPublication({ publishedRevision: 1, kind: 'seed', status: 'pending' });
  const ordinary = await h.publisher.publish(); assert.equal(ordinary.status, 'pending');
  assert.equal(h.queued.kind, 'publication'); assert.equal(h.queued.storageRevision, 2);
  assert.equal((await h.pendingOutput()).manifest.categories[0].board.products[0].ffsDate, '2027-02-03');
}
{
  const h = fixture({ seed: true, revision: 2 }); h.setPublication({ publishedRevision: 2, status: 'pending' });
  await assert.rejects(h.publisher.publish(), error => error.code === 'SEED_REQUIRED');
  await assert.rejects(stageVerifiedSeedArchive({ target: h.exports.at(-1), source: { bytes: seedBytes.slice(), sha: blob(seedBytes) },
    delivery: h.delivery, packageKey, endpoint }), error => error.code === 'SEED_IDENTITY_MISMATCH',
    'published revision must match the decrypted native package marker, even if accepted facts are newer');
  assert.equal(h.calls.filter(v => v === 'seed').length, 0);
  const trusted = structuredClone(h.exports.at(-1)); trusted.publication.publishedRevision = 1; trusted.publication.githubSha = 'f'.repeat(40);
  await assert.rejects(stageVerifiedSeedArchive({ target: trusted, source: { bytes: seedBytes.slice(), sha: blob(seedBytes) },
    delivery: h.delivery, packageKey, endpoint }), error => error.code === 'SEED_IDENTITY_MISMATCH',
    'seed native blob must match any trusted GitHub publication identity supplied in export');
  assert.equal(h.calls.filter(v => v === 'seed').length, 0);
}
{
  const h = fixture({ seed: true, revision: 2 });
  h.setQueued({ candidateId: id, kind: 'seed', generation: 1, expectedGeneration: 0, storageRevision: 1,
    sourceSha, manifestSha256: null, ownerImagesCommit: null, sha256: PINNED_SHAREPOINT_SEED.sha256,
    bytes: PINNED_SHAREPOINT_SEED.bytes, status: 'ready' });
  await assert.rejects(h.publisher.seedDeliveryCache(), error => error.code === 'SEED_RESERVATION_MISMATCH',
    'an older seed is held when the trusted published revision no longer matches');
  assert.equal(h.calls.filter(v => v === 'seed-read').length, 0);
}
console.log('SharePoint publisher checks passed.');
