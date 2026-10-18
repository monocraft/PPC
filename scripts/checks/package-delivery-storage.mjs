import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
let storageModule, hashModule;
try { storageModule = await import('../../supabase/functions/ppc-package/storage.mjs'); hashModule = await import('../../supabase/functions/ppc-package/hash.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof storageModule?.createPackageDeliveryStorage, 'function', 'binary_upload_fixed_key: private create-only Storage adapter is required');
assert.equal(typeof hashModule?.createCiphertextVerifier, 'function', 'finalize_actual_stream: native incremental ciphertext verifier is required');
const { createPackageDeliveryStorage } = storageModule, { createCiphertextVerifier } = hashModule;
const id = '11111111-2222-4333-8444-555555555555';
const bytes = Buffer.concat([Buffer.from('PPCPKG01'), Buffer.alloc(100, 7)]);
const candidate = { candidateId: id, objectKey: `packages/${id}.pkg`, bytes: bytes.length };
const env = { SUPABASE_URL: 'https://syntheticproject.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private-synthetic-service-key' };
const stream = value => new ReadableStream({ start(controller) { for (let i = 0; i < value.length; i += 7) controller.enqueue(value.subarray(i, i + 7)); controller.close(); } });
test('binary_upload_fixed_key uses POST raw stream, exact key, length and no upsert/write capability', async () => {
  let calls = 0;
  const storage = createPackageDeliveryStorage({ env, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, `${env.SUPABASE_URL}/storage/v1/object/ppc-package-delivery/packages/${id}.pkg`);
    assert.equal(options.method, 'POST'); assert.equal(options.headers['x-upsert'], 'false');
    assert.equal(options.headers['content-type'], 'application/octet-stream'); assert.equal(options.headers['content-length'], String(bytes.length));
    assert.equal(options.redirect, 'error'); assert(options.signal instanceof AbortSignal); assert(options.body instanceof ReadableStream);
    assert.deepEqual(Buffer.from(await new Response(options.body).arrayBuffer()), bytes);
    return Response.json({ Key: 'ignored', signedUrl: 'must-not-escape' });
  } });
  assert.deepEqual(await storage.uploadObject(candidate, stream(bytes)), { stored: true }); assert.equal(calls, 1);
  await assert.rejects(() => storage.uploadObject({ ...candidate, objectKey: 'arbitrary/path' }, stream(bytes))); assert.equal(calls, 1);
});
test('actual HTTP binary stream preserves create-only REST bytes and duplicate cannot replace stored object', async () => {
  let stored = null, writes = 0;
  const server = createServer(async (request, response) => {
    assert.equal(request.url, `/storage/v1/object/ppc-package-delivery/${candidate.objectKey}`);
    assert.equal(request.method, 'POST'); assert.equal(request.headers['x-upsert'], 'false');
    assert.equal(request.headers['content-length'], String(bytes.length)); assert.equal(request.headers['content-type'], 'application/octet-stream');
    const received = []; for await (const chunk of request) received.push(chunk);
    if (stored) { response.writeHead(409, { 'Content-Type': 'application/json' }); response.end('{"code":"KeyAlreadyExists"}'); return; }
    stored = Buffer.concat(received); writes++; response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"Key":"private-key"}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const storage = createPackageDeliveryStorage({ env, fetchImpl: (target, options) => {
      const parsed = new URL(target); assert.equal(parsed.origin, env.SUPABASE_URL);
      return fetch(`http://127.0.0.1:${server.address().port}${parsed.pathname}`, options);
    } });
    await storage.uploadObject(candidate, stream(bytes)); assert.deepEqual(stored, bytes);
    await assert.rejects(() => storage.uploadObject(candidate, stream(Buffer.alloc(bytes.length, 2)))); assert.deepEqual(stored, bytes); assert.equal(writes, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('new Supabase secret key uses apikey only; service role JWT retains bearer authentication', async () => {
  const secret = 'sb_secret_synthetic';
  const storage = createPackageDeliveryStorage({ env: { ...env, SUPABASE_SECRET_KEYS: JSON.stringify({ default: secret }) }, fetchImpl: async (url, options) => {
    assert.equal(options.headers.apikey, secret); assert.equal(options.headers.Authorization, undefined, 'non-JWT secret cannot be sent as a bearer JWT');
    await new Response(options.body).arrayBuffer(); return Response.json({ Key: 'ignored' });
  } });
  await storage.uploadObject(candidate, stream(bytes));
});
test('finalize_actual_stream incrementally hashes supported envelope including 64MiB without package buffering', () => {
  const verifier = createCiphertextVerifier(); const expected = createHash('sha256');
  const first = Buffer.alloc(65536, 3); first.write('PPCPKG01'); verifier.update(first); expected.update(first);
  const chunk = Buffer.alloc(65536, 4);
  for (let i = 1; i < 1024; i++) { verifier.update(chunk); expected.update(chunk); }
  assert.deepEqual(verifier.finish(), { sha256: expected.digest('hex'), bytes: 67108864, envelope: 'PPCPKG01' });
  assert.throws(() => verifier.update(chunk));
  const large = createCiphertextVerifier(); large.update(first); for (let i = 1; i < 1024; i++) large.update(chunk); assert.throws(() => large.update(Uint8Array.of(0)));
  for (const value of [Buffer.alloc(36), Buffer.from('PPCPKG01tiny')]) { const v = createCiphertextVerifier(); v.update(value); assert.throws(() => v.finish()); }
});
test('Storage rejects redirect, oversized/truncated reads and malicious signed READ URLs', async () => {
  for (const response of [new Response(bytes, { status: 302, headers: { Location: 'https://attacker.invalid' } }),
    new Response(bytes, { headers: { 'content-length': '67108865' } }), new Response(bytes.subarray(0, -1), { headers: { 'content-length': String(bytes.length) } })]) {
    const storage = createPackageDeliveryStorage({ env, fetchImpl: async () => response });
    await assert.rejects(async () => { const opened = await storage.openObject(candidate); await new Response(opened.body).arrayBuffer(); });
  }
  for (const signedURL of ['https://attacker.invalid/x', '/object/upload/sign/ppc-package-delivery/x?token=bad']) {
    const storage = createPackageDeliveryStorage({ env, fetchImpl: async () => Response.json({ signedURL }) });
    await assert.rejects(() => storage.signDownload(candidate));
  }
});
test('signed READ expires in five minutes and delete absence is checked only for requested fixed object', async () => {
  const calls = []; const target = `/object/sign/ppc-package-delivery/packages/${id}.pkg?token=read-only`;
  const storage = createPackageDeliveryStorage({ env, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/object/sign/')) { assert.deepEqual(JSON.parse(options.body), { expiresIn: 300 }); return Response.json({ signedURL: target }); }
    return new Response(null, { status: options.method === 'DELETE' ? 200 : 404 });
  } });
  assert.equal(await storage.signDownload(candidate), env.SUPABASE_URL + '/storage/v1' + target);
  assert.deepEqual(await storage.removeObject(candidate), { absent: true });
  assert.deepEqual(calls.slice(1).map(c => c.options.method), ['DELETE', 'GET']);
});
test('package deployment stages a deterministic independent module closure with disabled defaults', async () => {
  let staging; try { staging = await import('../prepare-package-delivery-deployment.mjs'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  assert.equal(typeof staging?.preparePackageDeliveryDeployment, 'function', 'standalone package deployment preparation is required');
  const parent = resolve(tmpdir()), directory = await mkdtemp(resolve(parent, 'ppc-package-deploy-'));
  try {
    const result = await staging.preparePackageDeliveryDeployment({ outputDirectory: directory }); assert.equal(result.files, 9);
    const manifest = JSON.parse(await readFile(resolve(directory, 'source-manifest.json'), 'utf8'));
    const { createPackageDelivery } = await import(pathToFileURL(resolve(directory, 'core.mjs')).href);
    await assert.rejects(() => createPackageDelivery().publisher('current', {}), error => error.status === 404);
    await staging.preparePackageDeliveryDeployment({ outputDirectory: directory });
    assert.deepEqual(JSON.parse(await readFile(resolve(directory, 'source-manifest.json'), 'utf8')), manifest);
    for (const file of manifest.files) assert.equal(createHash('sha256').update(await readFile(resolve(directory, file.path))).digest('hex'), file.sha256);
  } finally {
    const child = relative(parent, directory); assert(child.startsWith('ppc-package-deploy-') && !child.includes(sep) && !child.includes('..')); await rm(directory, { recursive: true, force: true });
  }
});
