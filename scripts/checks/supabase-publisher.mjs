import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSupabasePublisher, normalizePublisherEndpoint } from '../publish-supabase-master.mjs';

const codec = globalThis.PortfolioPackage;
const model = globalThis.PortfolioMasterModel;
const endpoint = 'https://fixture.supabase.co/functions/v1/ppc-master/api/master';
const packageKey = codec.generateKey();
const publisherSecret = 'bridge_fixture_private_secret_123456789';
const githubToken = 'github_fixture_private_secret_123456789';
const clone = value => JSON.parse(JSON.stringify(value));
const sha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const json = (value, status = 200) => Response.json(value, { status });
const image = Uint8Array.of(0, 255, 34, 0, 9);
const attachment = Uint8Array.of(17, 19, 21, 23, 0, 25);
const original = {
  version: 4, activeCategoryId: 'pc', privateSource: { preserve: 'metadata' },
  packageInfo: { version: 1, updatedAt: '2026-01-01T00:00:00.000Z', comments: 'Keep owner comments' },
  imageAssets: [{ id: 'hero', sourceType: 'local', name: 'hero.webp', mimeType: 'image/webp', size: image.length, url: '', updatedAt: '2026-01-01T00:00:00Z', packagePath: 'images/hero.webp' }],
  categories: [{ id: 'pc', board: { lanes: [{ id: 'wired', name: 'Wired' }], savedBoard: { spacing: 18 },
    products: [{ id: 'headset', name: 'Shared headset', laneId: 'wired', imageAssetId: 'hero', privateExtra: { owner: 'Team' },
      generalAvailabilityDate: '2027-01-20', endManufacturingDate: '2029-01-20', ffsDate: '2026-12-05',
      roadmap: { startMonth: '2027-01', launchMonth: '2027-01', endMonth: '2029-01', notes: 'Keep roadmap notes' },
      specs: [{ id: 'battery', label: 'Battery', value: '30 h', customNote: 'Keep row detail' }],
      partSkus: [{ id: 'hp', code: 'HP001', customNote: 'Keep SKU detail' }], variantGroups: [] }] } }],
};

async function packed(manifest, extra = attachment) {
  return codec.encrypt(codec.createZip([{ name: 'portfolio.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    { name: 'images/hero.webp', data: image }, { name: 'attachments/extra.bin', data: extra }]), packageKey);
}
async function unpacked(bytes) {
  const entries = codec.readZip(await codec.decrypt(bytes, packageKey));
  return { entries, manifest: JSON.parse(new TextDecoder().decode(entries.get('portfolio.json'))) };
}
function targetFor(manifest = original, patch = { ffsDate: '2026-12-10' }) {
  const product = model.snapshot(manifest).products[0];
  return model.mergeChanges(manifest, [{ productId: product.productId, base: product.values, baseRevisions: product.revisions, patch }],
    { requestId: 'fixture-request-one', now: '2026-10-08T00:00:00.000Z', actor: 'Optional name' }).manifest;
}

export async function harness({ seeded = true, revision = 1, cacheMode = 'match', extraAssetBytes = 0 } = {}) {
  const extra = extraAssetBytes ? new Uint8Array(extraAssetBytes).fill(37) : attachment;
  const initial = await packed(original, extra), blobs = new Map([[sha(initial), initial]]);
  const candidateRefs = new Map();
  let current = sha(initial), manifest = revision ? targetFor() : clone(original), storageRevision = revision;
  const commits = new Map(), trees = new Map(); let sequence = 0, head, codeVersion = 0;
  const objectId = kind => createHash('sha1').update(`${kind}:${++sequence}`).digest('hex');
  function moveHead(blob = current) { const tree = objectId('tree'), commit = objectId('commit'); trees.set(tree, { blob, codeVersion }); commits.set(commit, { tree, parent: head }); head = commit; current = blob; }
  moveHead();
  let sourceSha = current, seedDigest = null;
  let publication = { requestedRevision: revision, publishedRevision: 0, githubSha: current, status: revision ? 'pending' : 'current' };
  let ackFails = 0, deployFails = 0, losePut = false, malformedPut = false, putHook = null, writeDenied = false, exportHook = null, secretError = false, headHook = null, rejectObject = null, corruptObject = false;
  const calls = [], acknowledgements = [], failures = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    const operation = url.startsWith(endpoint) ? url.slice(endpoint.length + 1) : '';
    if (operation) {
      assert.equal(options.headers['X-PPC-Publisher-Secret'], publisherSecret);
      assert.equal(options.headers.Authorization, undefined);
      const body = JSON.parse(options.body);
      assert.ok(!options.body.includes(packageKey)); assert.ok(!options.body.includes(githubToken));
      calls.push({ operation, body });
      if (secretError) throw new Error(`${packageKey} ${githubToken} ${publisherSecret}`);
      if (operation === 'bootstrap') {
        const digest = JSON.stringify(body);
        if (seeded && seedDigest !== digest) return json({ error: 'Already initialized' }, 409);
        if (!seeded) { manifest = clone(body.manifest); sourceSha = body.sourceSha; storageRevision = 1; publication = { requestedRevision: 1, publishedRevision: 0, githubSha: sourceSha, status: 'pending' }; seeded = true; seedDigest = digest; }
        return json({ status: 'initialized', storageRevision });
      }
      if (operation === 'export') {
        if (!seeded) return json({ error: 'Uninitialized' }, 503);
        const result = { manifest: clone(manifest), sourceSha, storageRevision, revision: storageRevision, publication: clone(publication) };
        if (exportHook) { const hook = exportHook; exportHook = null; await hook(); }
        return json(result);
      }
      if (operation === 'ack') {
        acknowledgements.push(body);
        if (ackFails) { ackFails -= 1; return json({ error: 'Retry receipt' }, 503); }
        assert.ok(body.storageRevision >= publication.publishedRevision);
        assert.ok(body.storageRevision <= storageRevision);
        publication = { ...publication, publishedRevision: body.storageRevision, githubSha: body.githubSha,
          status: body.storageRevision < storageRevision ? 'pending' : 'current' };
        return json({ publication });
      }
      if (operation === 'failure') {
        failures.push(body); publication.status = 'error'; return json({ publication });
      }
      assert.fail(`Unexpected bridge operation ${operation}`);
    }
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal(options.headers.Authorization, `Bearer ${githubToken}`);
    assert.equal(options.headers['X-PPC-Publisher-Secret'], undefined);
    assert.ok(!String(options.body || '').includes(packageKey)); assert.ok(!String(options.body || '').includes(publisherSecret));
    const stage = url.endsWith('/git/blobs') ? 'BLOB' : url.endsWith('/git/trees') ? 'TREE' : url.endsWith('/git/commits') ? 'COMMIT' : url.endsWith('/git/refs/heads/main') ? 'REF' : '';
    if (rejectObject?.stage === stage && ['POST', 'PATCH'].includes(options.method)) return json({ message: `${packageKey} ${publisherSecret} ${githubToken} private upstream response` }, rejectObject.status);
    if (url.includes('/git/blobs/')) {
      const bytes = blobs.get(url.split('/').at(-1)); calls.push({ operation: 'blob', size: bytes?.length || 0 }); return new Response(bytes?.slice(), { status: bytes ? 200 : 404 });
    }
    if (url.endsWith('/git/ref/heads/main')) {
      if (headHook) { const hook = headHook; headHook = null; await hook(); }
      calls.push({ operation: 'head' }); return json({ ref: 'refs/heads/main', object: { type: 'commit', sha: head } });
    }
    if (/\/git\/commits\/[a-f0-9]{40}$/.test(url)) { const id = url.split('/').at(-1), value = commits.get(id); assert.ok(value); return json({ sha: id, tree: { sha: value.tree }, parents: value.parent ? [{ sha: value.parent }] : [] }); }
    if (url.endsWith('/git/blobs')) { const body = JSON.parse(options.body); assert.equal(options.method, 'POST'); assert.equal(body.encoding, 'base64'); const bytes = new Uint8Array(Buffer.from(body.content, 'base64')), id = sha(bytes); calls.push({ operation: 'create-blob', size: bytes.length }); blobs.set(id, bytes); return json({ sha: corruptObject ? '0'.repeat(40) : id }, 201); }
    if (url.endsWith('/git/trees')) { const body = JSON.parse(options.body), base = trees.get(body.base_tree); assert.ok(base); assert.deepEqual(Object.keys(body).sort(), ['base_tree', 'tree']); assert.equal(body.tree.length, 1); assert.deepEqual(body.tree[0], { path: 'public/data/master_ppc.pkg', mode: '100644', type: 'blob', sha: body.tree[0].sha }); assert.ok(blobs.has(body.tree[0].sha)); const id = objectId('tree'); trees.set(id, { ...base, blob: body.tree[0].sha }); calls.push({ operation: 'create-tree' }); return json({ sha: id }, 201); }
    if (url.endsWith('/git/commits')) { const body = JSON.parse(options.body); assert.ok(trees.has(body.tree)); assert.equal(body.parents.length, 1); assert.ok(commits.has(body.parents[0])); const id = objectId('commit'); commits.set(id, { tree: body.tree, parent: body.parents[0] }); calls.push({ operation: 'create-commit' }); return json({ sha: id, tree: { sha: body.tree }, parents: [{ sha: body.parents[0] }] }, 201); }
    if (url.endsWith('/git/refs/heads/main')) {
      assert.equal(options.method, 'PATCH'); const body = JSON.parse(options.body); assert.deepEqual(Object.keys(body).sort(), ['force', 'sha']); assert.equal(body.force, false);
      calls.push({ operation: 'put', body: { sha: current, branch: 'main' } });
      if (writeDenied) return json({ error: 'Protected branch' }, 422);
      if (putHook) { const hook = putHook; putHook = null; await hook(); }
      const commit = commits.get(body.sha); assert.ok(commit);
      if (commit.parent !== head) return json({ message: 'Update is not a fast forward' }, 422);
      head = body.sha; const tree = trees.get(commit.tree); current = tree.blob; codeVersion = tree.codeVersion;
      if (losePut) { losePut = false; throw new Error(`${githubToken} private network detail`); }
      if (malformedPut) { malformedPut = false; return new Response('Malformed synthetic final ref response', { status: 200 }); }
      return json({ ref: 'refs/heads/main', object: { type: 'commit', sha: head } });
    }
    if (url.includes('/actions/workflows/deploy.yml/dispatches')) {
      calls.push({ operation: 'deploy' });
      if (deployFails) { deployFails -= 1; return json({}, 403); }
      return new Response(null, { status: 204 });
    }
    assert.match(url, /\/contents\/public\/data\/master_ppc\.pkg(?:\?ref=(?:main|[a-f0-9]{40}))?$/);
    assert.equal(options.method, 'GET', 'package Contents endpoint is read-only; large package writes use Git Database');
    const ref=new URL(url).searchParams.get('ref'),chosen=ref&&ref!=='main'?(candidateRefs.get(ref)||trees.get(commits.get(ref)?.tree)?.blob):current;return chosen?json({ type: 'file', sha: chosen, size: blobs.get(chosen).length, download_url: 'https://untrusted.invalid/never-fetch' }):json({},404);
  };
  const makePublisher=imagesCommit=>createSupabasePublisher({ endpoint, packageKey, githubToken, publisherSecret, fetchImpl, imagesCommit, readCachedPackage: async () => {
    if (cacheMode === 'missing') return null;
    if (cacheMode === 'unavailable') throw new Error('Synthetic unavailable cache');
    const cached = blobs.get(current).slice();
    if (cacheMode === 'corrupt') cached[30] ^= 1;
    return cacheMode === 'short' ? cached.subarray(1) : cached;
  } });
  const publisher=makePublisher();
  return { publisher, calls, acknowledgements, failures, get current() { return current; }, get bytes() { return blobs.get(current).slice(); },
    get publication() { return clone(publication); },
    failAck(count = 1) { ackFails = count; }, failDeploy(count = 1) { deployFails = count; }, loseWriteReply() { losePut = true; }, malformedWriteReply() { malformedPut = true; },
    beforePut(hook) { putHook = hook; }, afterExport(hook) { exportHook = hook; }, denyWrites() { writeDenied = true; },
    beforeHead(hook) { headHook = hook; }, advanceCode() { codeVersion += 1; moveHead(); }, get codeVersion() { return codeVersion; },
    rejectGitObject(stage = 'BLOB', status = 403) { rejectObject = { stage, status }; }, corruptGitObject() { corruptObject = true; },
    secretTransportError() { secretError = true; },
    async replace(value) { const bytes = await packed(value, extra); const id = sha(bytes); blobs.set(id, bytes); moveHead(id); },
    replaceRaw(bytes) { const id = sha(bytes); blobs.set(id, bytes.slice()); moveHead(id); },
    advance(patch) { manifest = targetFor(manifest, patch); storageRevision += 1; publication.requestedRevision = storageRevision; publication.status = 'pending'; },
    staleExport(value, revisionValue) { manifest = clone(value); storageRevision = revisionValue; publication.publishedRevision = Math.min(publication.publishedRevision, revisionValue); },
    candidate(commit,bytes) { const digest=sha(bytes);blobs.set(digest,bytes);candidateRefs.set(commit,digest);return makePublisher(commit); },
    get sourceSha() { return sourceSha; },
  };
}
export {original,packed,unpacked,packageKey};

assert.equal(normalizePublisherEndpoint(endpoint), endpoint);
for (const value of ['http://fixture.supabase.co/functions/v1/ppc-master/api/master', `${endpoint}?key=private`, 'https://name:password@fixture.supabase.co/functions/v1/ppc-master/api/master']) assert.throws(() => normalizePublisherEndpoint(value), error => error.code === 'INVALID_CONFIGURATION');

{
  const h = await harness();
  const result = await h.publisher.publish(); assert.equal(result.status, 'published'); assert.equal(result.revision, 1);
  const { entries, manifest } = await unpacked(h.bytes);
  assert.deepEqual(entries.get('images/hero.webp'), image); assert.deepEqual(entries.get('attachments/extra.bin'), attachment);
  assert.equal(manifest.categories[0].board.products[0].ffsDate, '2026-12-10');
  assert.equal(manifest.categories[0].board.products[0].specs[0].customNote, 'Keep row detail');
  assert.deepEqual(manifest.categories[0].board.savedBoard, original.categories[0].board.savedBoard);
  assert.deepEqual(manifest.categories[0].board.products[0].privateExtra, original.categories[0].board.products[0].privateExtra);
  assert.deepEqual(manifest.imageAssets, original.imageAssets); assert.deepEqual(manifest.privateSource, original.privateSource);
  assert.equal(manifest.packageInfo.comments, '1 product updated:\n- Shared headset'); assert.equal(manifest.packageInfo.updatedAt, '2026-10-08T00:00:00.000Z'); assert.equal(manifest.masterSync.supabaseRevision, 1);
  assert.equal(h.calls.findIndex(call => call.operation === 'deploy') < h.calls.findIndex(call => call.operation === 'ack'), true, 'deployment dispatch precedes publication acknowledgement');
  const before = h.calls.filter(call => call.operation === 'put').length;
  assert.equal((await h.publisher.publish()).status, 'unchanged');
  assert.equal(h.calls.filter(call => call.operation === 'put').length, before, 'unchanged export creates no package commit');
}

{
  const h = await harness(); h.loseWriteReply();
  assert.equal((await h.publisher.publish()).status, 'published');
  assert.equal(h.calls.filter(call => call.operation === 'put').length, 1, 'a lost accepted push response is confirmed by immutable blob SHA');
}

for (const mode of ['ack', 'deploy']) {
  const h = await harness(); mode === 'ack' ? h.failAck() : h.failDeploy();
  await assert.rejects(h.publisher.publish(), error => error.code === (mode === 'ack' ? 'ACK_FAILED' : 'DEPLOY_DISPATCH_FAILED'));
  assert.equal(h.calls.filter(call => call.operation === 'put').length, 1);
  assert.equal(h.failures.length, 1);
  assert.equal((await h.publisher.publish()).status, 'recovered');
  assert.equal(h.calls.filter(call => call.operation === 'put').length, 1, 'receipt/deploy recovery never makes a duplicate package commit');
  assert.equal(h.publication.status, 'current');
}

{
  const h = await harness();
  h.beforePut(async () => h.advance({ specs: [{ id: 'battery', label: 'Battery', value: '40 h' }] }));
  await h.publisher.publish(); assert.equal(h.publication.publishedRevision, 1); assert.equal(h.publication.status, 'pending');
  await h.publisher.publish(); assert.equal(h.publication.publishedRevision, 2);
  assert.equal((await unpacked(h.bytes)).manifest.categories[0].board.products[0].specs[0].value, '40 h', 'accepted save during publication is preserved by a following revision');
}

{
  const h = await harness(); await h.publisher.publish(); const accepted = h.bytes;
  h.staleExport(targetFor(), 0);
  await assert.rejects(h.publisher.publish(), error => error.code === 'PACKAGE_CHANGED_RETRY');
  assert.deepEqual(h.bytes, accepted, 'an old consistent export never regresses a newer GitHub package');
}

{
  const h = await harness();
  const changed = clone(original); changed.categories[0].board.products[0].name = 'Unexpected external package';
  h.beforePut(() => h.replace(changed));
  await assert.rejects(h.publisher.publish(), error => error.code === 'EXTERNAL_PACKAGE_CHANGE');
  assert.equal((await unpacked(h.bytes)).manifest.categories[0].board.products[0].name, 'Unexpected external package', 'a racing manual package replacement is not overwritten');
}

for (const kind of ['manifest', 'asset']) {
  const h = await harness(); await h.publisher.publish(); const { entries, manifest } = await unpacked(h.bytes);
  if (kind === 'manifest') manifest.categories[0].board.products[0].name = 'External edit';
  const bytes = await codec.encrypt(codec.createZip([...entries].map(([name, data]) => ({ name,
    data: name === 'portfolio.json' ? new TextEncoder().encode(JSON.stringify(manifest)) : kind === 'asset' && name === 'images/hero.webp' ? Uint8Array.of(7, 8) : data }))), packageKey);
  h.replaceRaw(bytes); h.advance({ ffsDate: '2026-12-11' });
  await assert.rejects(h.publisher.publish(), error => error.code === 'EXTERNAL_PACKAGE_CHANGE');
  assert.deepEqual(h.bytes, bytes, `a modified ${kind} invalidates the encrypted publisher marker`);
}

{
  const h = await harness({ seeded: false, revision: 0 });
  await h.publisher.bootstrap(); await h.publisher.bootstrap();
  assert.equal((await h.publisher.publish()).status, 'published');
  assert.equal(h.calls.filter(call => call.operation === 'put').length, 1, 'first seed publishes one verified source marker');
  assert.equal((await unpacked(h.bytes)).manifest.categories[0].board.products[0].name, original.categories[0].board.products[0].name);
  const edited = clone(original); edited.categories[0].board.products[0].name = 'Other source'; await h.replace(edited);
  await assert.rejects(h.publisher.bootstrap(), error => error.code === 'BOOTSTRAP_REJECTED', 'an existing database is never overwritten by bootstrap');
}

{
  const h = await harness(); h.denyWrites();
  await assert.rejects(h.publisher.publish(), error => error.code === 'GITHUB_REF_HTTP_422');
  assert.equal(h.calls.filter(call => call.operation === 'put').length, 1, 'unchanged SHA with a validation rejection is not uploaded repeatedly');
  assert.equal(h.acknowledgements.length, 0); assert.equal(h.failures.length, 1);
}

{
  const h = await harness(); h.secretTransportError();
  await assert.rejects(h.publisher.publish(), error => {
    for (const secret of [packageKey, publisherSecret, githubToken]) assert.ok(!`${error.message} ${error.stack}`.includes(secret));
    return error.code === 'CONNECTION_FAILED';
  });
  const run = promisify(execFile);
  try { await run(process.execPath, ['scripts/publish-supabase-master.mjs'], { env: { ...process.env, PPC_MASTER_ENDPOINT: endpoint,
    PPC_PUBLISHER_SECRET: publisherSecret, PPC_PACKAGE_KEY: 'bad-private-fixture', GITHUB_TOKEN: githubToken } }); assert.fail(); }
  catch (error) { for (const secret of [publisherSecret, githubToken, 'bad-private-fixture']) assert.ok(!`${error.stdout} ${error.stderr}`.includes(secret)); }
}

const workflow = await readFile(new URL('../../.github/workflows/publish-master.yml', import.meta.url), 'utf8');
assert.match(workflow, /cancel-in-progress: false/); assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/);
assert.match(workflow, /contents: write/); assert.match(workflow, /actions: write/);
assert.match(workflow, /persist-credentials: false/); assert.ok(!workflow.includes('service_role'));
console.log('Supabase publisher checks passed: exact archive preservation, safe bootstrap, expected-SHA races, monotonic publication, lost responses, receipt and deployment recovery, and secret-safe errors.');

{
  const h = await harness(); await h.publisher.publish();
  const packageBytes = h.bytes.length; h.calls.length = 0;
  assert.equal((await h.publisher.publish()).status, 'unchanged');
  const reads = h.calls.filter(call => call.operation === 'blob');
  console.log(JSON.stringify({ unchangedBlobReads: reads.length, unchangedBlobBytes: reads.reduce((total, call) => total + call.size, 0), packageBytes }));
  assert.equal(reads.length, 0, 'A matching immutable checkout blob must not be downloaded again.');
  const changed = clone(original); changed.categories[0].board.products[0].name = 'Changed externally';
  await h.replace(changed);
  await assert.rejects(h.publisher.publish(), error => error.code === 'EXTERNAL_PACKAGE_CHANGE');
  assert.equal(h.calls.filter(call => call.operation === 'blob').length, 0, 'A matching checkout blob still receives full authentication and source checks.');
}
for (const cacheMode of ['missing', 'unavailable', 'corrupt', 'short']) {
  const h = await harness({ cacheMode });
  assert.equal((await h.publisher.publish()).status, 'published');
  assert.equal(h.calls.filter(call => call.operation === 'blob').length, 1, 'A missing or mismatched cache must use the authenticated remote blob.');
}

{
  const h = await harness(); h.beforePut(() => h.advanceCode());
  await h.publisher.publish();
  assert.equal(h.codeVersion, 1, 'a nonforce retry preserves the unrelated racing code commit');
  assert.equal(h.calls.filter(call => call.operation === 'put').length, 2);
  assert.equal(h.calls.filter(call => call.operation === 'export').length, 2, 'a changed head obtains a fresh consistent export');
  assert.equal((await unpacked(h.bytes)).manifest.categories[0].board.products[0].ffsDate, '2026-12-10');
}
{
  const h = await harness(); h.beforeHead(() => h.advanceCode()); await h.publisher.publish();
  assert.equal(h.codeVersion, 1, 'code that advances before the observed head is retained in the base tree');
  assert.equal(h.calls.filter(call => call.operation === 'put').length, 1);
}
{
  const h = await harness(); h.malformedWriteReply(); await h.publisher.publish();
  assert.equal(h.calls.filter(call => call.operation === 'put').length, 1, 'malformed accepted ref reply creates no second accepted package commit');
  const confirm = h.calls.findIndex((call, index) => call.operation === 'head' && index > h.calls.findIndex(c => c.operation === 'put'));
  assert.equal(confirm, -1, 'successful blob confirmation does not create another git object chain');
  assert.equal(h.acknowledgements.length, 1); assert.equal(h.publication.githubSha, h.current);
  assert.equal(h.calls.findIndex(call => call.operation === 'deploy') < h.calls.findIndex(call => call.operation === 'ack'), true);
}
{
  const h = await harness(), changed = clone(original); changed.categories[0].board.products[0].name = 'Racing package before head read';
  h.beforeHead(() => h.replace(changed));
  await assert.rejects(h.publisher.publish(), error => error.code === 'EXTERNAL_PACKAGE_CHANGE');
  assert.equal(h.calls.filter(call => call.operation === 'create-blob').length, 0, 'the immutable observed-head package must match before creating objects');
  assert.equal(h.calls.filter(call => call.operation === 'put').length, 0);
  assert.equal(h.acknowledgements.length, 0);
}
for (const fault of ['rejectGitObject', 'corruptGitObject']) {
  const h = await harness(), originalBytes = h.bytes; h[fault]();
  await assert.rejects(h.publisher.publish(), error => error.code === (fault === 'rejectGitObject' ? 'GITHUB_BLOB_HTTP_403' : 'PACKAGE_CHANGED_RETRY'));
  assert.deepEqual(h.bytes, originalBytes);
  assert.equal(h.calls.filter(call => call.operation === 'put').length, 0, 'ref is never changed after a rejected or wrong blob');
  assert.equal(h.acknowledgements.length, 0);
}
for (const stage of ['BLOB', 'TREE', 'COMMIT', 'REF']) {
  const h = await harness(), before = h.bytes; h.rejectGitObject(stage, 403);
  await assert.rejects(h.publisher.publish(), error => {
    assert.equal(error.code, `GITHUB_${stage}_HTTP_403`);
    for (const secret of [packageKey, githubToken, publisherSecret]) assert.ok(!`${error.message} ${error.stack}`.includes(secret));
    return true;
  });
  assert.deepEqual(h.bytes, before); assert.equal(h.acknowledgements.length, 0);
  assert.equal(h.failures[0].code, `GITHUB_${stage}_HTTP_403`, 'safe stage/status is retained without raw upstream text');
  assert.equal(h.calls.filter(call => call.operation === 'export').length, 1, 'definitive stage rejection is not probed by another production-style attempt');
}
{
  const h = await harness({ extraAssetBytes: 45 * 1024 * 1024 });
  const result = await h.publisher.publish();
  assert.equal(result.status, 'published');
  const upload = h.calls.find(call => call.operation === 'create-blob');
  assert.ok(upload.size > 45 * 1024 * 1024 && upload.size < codec.MAX_PACKAGE_BYTES, 'large encrypted packages use the documented Git blob range');
  const out = await unpacked(h.bytes);
  assert.equal(out.entries.get('attachments/extra.bin').length, 45 * 1024 * 1024);
  assert.ok(out.entries.get('attachments/extra.bin').every(byte => byte === 37), 'all large archive bytes survive');
  assert.equal(h.calls.filter(call => call.operation === 'put').length, 1);
}
console.log('Git Database publication checks passed: 45 MiB archive, immutable-head package guard, one-path base tree, nonforce code/package races, wrong-object refusal and existing ambiguous-write recovery.');
