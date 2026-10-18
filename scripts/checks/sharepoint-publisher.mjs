import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPackageDeliveryClient } from '../package-delivery-client.mjs';
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

function fixture({ owner = null, ownerCandidate = null, revision = 1, seed = false, sameRevision = false, corruptArchive = false, loseUploadReply = false, loseReserveReply = false, acceptedFfsDate = null } = {}) {
  let current = seed ? null : { candidateId: id, kind: 'seed', generation: 1, expectedGeneration: 0, storageRevision: sameRevision ? revision : 1,
    sourceSha, manifestSha256: manifestSha, ownerImagesCommit: null, sha256: sha256(seedBytes), bytes: seedBytes.length,
    objectKey: `packages/${id}.pkg`, createdAt: date, expiresAt: '2026-10-19T00:00:00.000Z', status: 'published' };
  let queued = null, seedInput = null, store = seedBytes.slice(), next = current?.generation ?? 0, uploaded = null, finalizeFails = false, publication = { publishedRevision: current?.storageRevision ?? 0, kind: current?.kind ?? null };
  const calls = [], exports = [];
  const delivery = {
    async readCurrent() { calls.push('current'); return { phase: seed ? 'seeding' : 'sharepoint', current: clone(current), queued: clone(queued), downloadUrl: current ? `https://fixture.supabase.co/storage/v1/object/sign/ppc-package-delivery/${current.objectKey}?token=read` : undefined }; },
    async reserve(meta, kind = 'reserve') { calls.push(kind); assert.equal(meta.ownerImagesCommit, owner); assert.equal(meta.sourceSha, sourceSha); assert.equal(meta.manifestSha256, kind === 'seed' ? null : manifestSha); assert.equal(meta.expectedGeneration, current?.generation ?? 0); if (kind === 'seed') seedInput = clone(meta); const { trustedGithubSha, ...candidateMeta } = meta; queued = { ...candidateMeta, kind: kind === 'seed' ? 'seed' : 'publication', generation: ++next, objectKey: `packages/${meta.candidateId}.pkg`, createdAt: date, expiresAt: '2026-10-19T00:00:00.000Z', status: 'reserved' }; if (loseReserveReply) throw new Error('Synthetic lost reserve reply'); return { status: 'reserved', candidate: clone(queued) }; },
    async upload(candidate, bytes) { calls.push('upload'); assert.equal(candidate.candidateId, queued.candidateId); uploaded = bytes.slice(); if (loseUploadReply) throw new Error('Synthetic lost upload reply'); },
    async finalize(candidate) { calls.push('finalize'); assert.equal(candidate.candidateId, queued.candidateId); if (finalizeFails) throw new Error('Synthetic uncertain object'); queued.status = 'ready'; return { status: 'ready', candidate: clone(queued) }; },
    async seed(meta) { return this.reserve(meta, 'seed'); },
  };
  const fetchImpl = async (url, options) => {
    if (url === `${endpoint}/export`) {
      calls.push('export'); const manifest = clone(seedManifest);
      if (acceptedFfsDate) manifest.categories[0].board.products[0].ffsDate = acceptedFfsDate;
      const result = { manifest, sourceSha, storageRevision: revision, acceptedManifestSha256: manifestSha,
        publication: { ...publication, status: 'pending' } }; exports.push(result); return Response.json(result);
    }
    if (url === `https://fixture.supabase.co/storage/v1/object/sign/ppc-package-delivery/${current?.objectKey}?token=read`) {
      calls.push('archive'); assert.equal(options.credentials, 'omit'); assert.equal(options.headers['X-PPC-Publisher-Secret'], undefined);
      assert.equal(options.headers.Authorization, undefined); const bytes = store.slice(); if (corruptArchive) bytes[40] ^= 1; return new Response(bytes);
    }
    if (url === PINNED_SHAREPOINT_SEED.url) { calls.push('seed-read'); assert.equal(options.headers['X-PPC-Publisher-Secret'], undefined); return new Response(seedBytes.slice()); }
    if (ownerCandidate && url === `https://api.github.com/repos/monocraft/PPC/contents/public/data/master_ppc.pkg?ref=${owner}`)
      return Response.json({ type: 'file', sha: blob(ownerCandidate), size: ownerCandidate.length });
    if (ownerCandidate && url === `https://api.github.com/repos/monocraft/PPC/git/blobs/${blob(ownerCandidate)}`)
      return new Response(ownerCandidate.slice());
    throw new Error(`Unexpected request: ${url}`);
  };
  const publisher = createSupabasePublisher({ endpoint, publisherSecret: secret, packageKey, githubToken: 'github_fixture_private_secret_123456789', publicationMode: 'sharepoint',
    deliveryClient: delivery, fetchImpl, imagesCommit: owner || '', readCachedPackage: () => { throw new Error('Git cache accessed'); },
    writePackage: () => { throw new Error('Git write accessed'); } });
  return { publisher, delivery, calls, exports, get queued() { return queued; }, get seedInput() { return seedInput; }, get bytes() { return uploaded; }, get current() { return current; },
    setQueued(value) { queued = value; }, failFinalize(value = true) { finalizeFails = value; }, setCurrent(value, bytes = seedBytes) { current = value; store = bytes; }, setPublication(value) { publication = value; },
    async pendingOutput() { return unpacked(uploaded); } };
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
  assert.deepEqual(selected('schedule', undefined, undefined), [normal]);
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
}
{
  const h = fixture({ corruptArchive: true });
  await assert.rejects(h.publisher.publish(), error => error.code === 'DELIVERY_CURRENT_INVALID');
  assert.equal(h.calls.filter(v => v === 'archive').length, 1);
  assert.equal(h.calls.filter(v => v === 'reserve').length, 0, 'corrupt cache does not fall back to Git');
}
{
  const a = 'c'.repeat(40), b = 'd'.repeat(40), h = fixture({ owner: a, sameRevision: true });
  h.setQueued({ ...h.current, candidateId: '22222222-2222-4222-8222-222222222222', kind: 'publication', generation: 2,
    expectedGeneration: 1, storageRevision: 1, manifestSha256: manifestSha, ownerImagesCommit: a, status: 'ready' });
  const result = await h.publisher.publish(); assert.equal(result.status, 'pending'); assert.equal(h.queued.ownerImagesCommit, a);
  h.setQueued({ ...h.queued, ownerImagesCommit: b, status: 'ready' });
  await assert.rejects(h.publisher.publish(), error => error.code === 'PACKAGE_QUEUED_OTHER_INPUT');
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
