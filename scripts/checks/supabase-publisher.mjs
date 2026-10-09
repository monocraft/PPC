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
  imageAssets: [{ id: 'hero', sourceType: 'local', packagePath: 'images/hero.webp' }],
  categories: [{ id: 'pc', board: { lanes: [{ id: 'wired', name: 'Wired' }], savedBoard: { spacing: 18 },
    products: [{ id: 'headset', name: 'Shared headset', laneId: 'wired', imageAssetId: 'hero', privateExtra: { owner: 'Team' },
      generalAvailabilityDate: '2027-01-20', endManufacturingDate: '2029-01-20', ffsDate: '2026-12-05',
      roadmap: { startMonth: '2027-01', launchMonth: '2027-01', endMonth: '2029-01', notes: 'Keep roadmap notes' },
      specs: [{ id: 'battery', label: 'Battery', value: '30 h', customNote: 'Keep row detail' }],
      partSkus: [{ id: 'hp', code: 'HP001', customNote: 'Keep SKU detail' }], variantGroups: [] }] } }],
};

async function packed(manifest) {
  return codec.encrypt(codec.createZip([{ name: 'portfolio.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    { name: 'images/hero.webp', data: image }, { name: 'attachments/extra.bin', data: attachment }]), packageKey);
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

async function harness({ seeded = true, revision = 1 } = {}) {
  const initial = await packed(original), blobs = new Map([[sha(initial), initial]]);
  let current = sha(initial), manifest = revision ? targetFor() : clone(original), storageRevision = revision;
  let sourceSha = current, seedDigest = null;
  let publication = { requestedRevision: revision, publishedRevision: 0, githubSha: current, status: revision ? 'pending' : 'current' };
  let ackFails = 0, deployFails = 0, losePut = false, putHook = null, writeDenied = false, exportHook = null, secretError = false;
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
    if (url.includes('/git/blobs/')) {
      const bytes = blobs.get(url.split('/').at(-1)); return new Response(bytes?.slice(), { status: bytes ? 200 : 404 });
    }
    if (url.includes('/actions/workflows/deploy.yml/dispatches')) {
      calls.push({ operation: 'deploy' });
      if (deployFails) { deployFails -= 1; return json({}, 403); }
      return new Response(null, { status: 204 });
    }
    assert.match(url, /\/contents\/public\/data\/master_ppc\.pkg(?:\?ref=main)?$/);
    if (options.method === 'GET') return json({ type: 'file', sha: current, size: blobs.get(current).length, download_url: 'https://untrusted.invalid/never-fetch' });
    const body = JSON.parse(options.body); calls.push({ operation: 'put', body: { sha: body.sha, branch: body.branch } });
    if (writeDenied) return json({ error: 'Protected branch' }, 422);
    if (putHook) { const hook = putHook; putHook = null; await hook(); }
    if (body.sha !== current) return json({}, 409);
    const bytes = new Uint8Array(Buffer.from(body.content, 'base64')); current = sha(bytes); blobs.set(current, bytes);
    if (losePut) { losePut = false; throw new Error(`${githubToken} private network detail`); }
    return json({ content: { sha: current } });
  };
  const publisher = createSupabasePublisher({ endpoint, packageKey, githubToken, publisherSecret, fetchImpl });
  return { publisher, calls, acknowledgements, failures, get current() { return current; }, get bytes() { return blobs.get(current).slice(); },
    get publication() { return clone(publication); },
    failAck(count = 1) { ackFails = count; }, failDeploy(count = 1) { deployFails = count; }, loseWriteReply() { losePut = true; },
    beforePut(hook) { putHook = hook; }, afterExport(hook) { exportHook = hook; }, denyWrites() { writeDenied = true; },
    secretTransportError() { secretError = true; },
    async replace(value) { const bytes = await packed(value); current = sha(bytes); blobs.set(current, bytes); },
    replaceRaw(bytes) { current = sha(bytes); blobs.set(current, bytes.slice()); },
    advance(patch) { manifest = targetFor(manifest, patch); storageRevision += 1; publication.requestedRevision = storageRevision; publication.status = 'pending'; },
    staleExport(value, revisionValue) { manifest = clone(value); storageRevision = revisionValue; publication.publishedRevision = Math.min(publication.publishedRevision, revisionValue); },
  };
}

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
  await assert.rejects(h.publisher.publish(), error => error.code === 'GITHUB_WRITE_REJECTED');
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
