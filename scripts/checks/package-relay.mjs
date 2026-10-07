import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, truncate, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { createRelayServer, relayConfigFromEnv } from '../../server/package-relay.mjs';

const codec = globalThis.PortfolioPackage;
const directory = await mkdtemp(join(tmpdir(), 'ppc-relay-'));
const source = join(directory, 'master_ppc.pkg');
const origin = 'https://monocraft.github.io';
const key = codec.generateKey();
const wrongKey = codec.generateKey();
const payload = new TextEncoder().encode('Private fixture portfolio and roadmap payload.');
const sealed = await codec.encrypt(payload, key);
const servers = [];

async function start(config = {}) {
  const server = createRelayServer({ packageFile: source, allowedOrigins: [origin], rateLimit: 1000, ...config });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(base, options = {}) {
  const { path = '/api/package/latest', body = JSON.stringify({ key }), method = 'POST', headers = {} } = options;
  return fetch(`${base}${path}`, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    ...(method === 'GET' || method === 'OPTIONS' ? {} : { body })
  });
}

async function error(response, status) {
  assert.equal(response.status, status);
  const text = await response.text();
  const parsed = JSON.parse(text);
  assert.equal(typeof parsed.error, 'string');
  for (const secret of [source, directory, key, wrongKey, payload.toString()]) assert.ok(!text.includes(secret));
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

try {
  await writeFile(source, sealed);
  const base = await start();
  const accepted = await request(base);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('access-control-allow-origin'), origin);
  assert.equal(accepted.headers.get('cache-control'), 'no-store');
  assert.equal(accepted.headers.get('content-type'), 'application/octet-stream');
  assert.equal(accepted.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(accepted.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(accepted.headers.get('content-length'), String(sealed.length));
  assert.deepEqual(new Uint8Array(await accepted.arrayBuffer()), sealed, 'the relay returns only the original encrypted bytes');
  await error(await request(base, { body: JSON.stringify({ key: wrongKey }) }), 401);
  await error(await request(base, { body: JSON.stringify({ key: 'guess' }) }), 401);
  await error(await request(base, { body: JSON.stringify({ key, path: '../other.pkg' }) }), 400);
  await error(await request(base, { body: JSON.stringify({ key, url: 'https://example.invalid/private.pkg' }) }), 400);
  await error(await request(base, { body: JSON.stringify({ key: null }) }), 400);
  await error(await request(base, { body: '{' }), 400);
  await error(await request(base, { headers: { 'Content-Type': 'text/plain' } }), 415);
  await error(await request(base, { body: ' '.repeat(2049) }), 413);
  await error(await request(base, { headers: { Origin: 'https://untrusted.invalid' } }), 403);
  await error(await request(base, { headers: { Origin: `${origin}/PPC` } }), 403);
  await error(await request(base, { headers: { Origin: 'null' } }), 403);
  const rejectedOrigin = await request(base, { headers: { Origin: 'https://untrusted.invalid' } });
  assert.equal(rejectedOrigin.headers.get('access-control-allow-origin'), null);
  await rejectedOrigin.text();
  await error(await request(base, { method: 'GET' }), 405);
  await error(await request(base, { path: '/api/package/latest?path=../../secret' }), 404);
  await error(await request(base, { path: '/private.pkg' }), 404);
  const preflight = await request(base, {
    method: 'OPTIONS',
    headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST');
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type');
  await error(await request(base, {
    method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-path' }
  }), 403);
  const health = await request(base, { path: '/health', method: 'GET' });
  assert.deepEqual(await health.json(), { status: 'ok' });
  const noBrowserOrigin = await fetch(`${base}/api/package/latest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key })
  });
  assert.equal(noBrowserOrigin.status, 200, 'CORS is separate from key authorization');
  await noBrowserOrigin.arrayBuffer();

  const info = await stat(source);
  const latest = await codec.encrypt(new TextEncoder().encode('Latest fixture portfolio and roadmap payload. '), key);
  assert.equal(latest.length, sealed.length);
  await writeFile(source, latest);
  await utimes(source, info.atime, new Date(info.mtimeMs + 10000));
  const changed = await request(base);
  assert.equal(changed.status, 200);
  assert.deepEqual(new Uint8Array(await changed.arrayBuffer()), latest, 'same-size changed packages are available without restarting');
  const rotated = await codec.encrypt(payload, wrongKey);
  await writeFile(source, rotated);
  await error(await request(base), 401);
  const rotatedResponse = await request(base, { body: JSON.stringify({ key: wrongKey }) });
  assert.equal(rotatedResponse.status, 200, 'key rotation follows the current source file');
  assert.deepEqual(new Uint8Array(await rotatedResponse.arrayBuffer()), rotated);
  await writeFile(source, codec.createZip([{ name: 'portfolio.json', data: payload }]));
  await error(await request(base), 503);
  await writeFile(source, Buffer.from('PPCPKG02'.padEnd(50, 'x')));
  await error(await request(base), 503);
  await writeFile(source, Buffer.from('PPCPKG01'));
  await error(await request(base), 503);
  await truncate(source, 64 * 1024 * 1024 + 1);
  await error(await request(base), 503);
  await rm(source);
  await error(await request(base), 503);
  await writeFile(source, sealed);
  const limited = await start({ rateLimit: 2, rateWindowMs: 60000 });
  await error(await request(limited, { body: JSON.stringify({ key: wrongKey }), headers: { 'X-Forwarded-For': '192.0.2.1' } }), 401);
  await error(await request(limited, { body: JSON.stringify({ key: wrongKey }), headers: { 'X-Forwarded-For': '192.0.2.2' } }), 401);
  const rateResponse = await request(limited, { headers: { 'X-Forwarded-For': '192.0.2.3' } });
  assert.equal(rateResponse.headers.get('retry-after'), '60');
  await error(rateResponse, 429);
  const trusted = await start({ rateLimit: 1, trustedProxyIPs: ['127.0.0.1'] });
  const proxyResponse = await request(trusted, { headers: { 'X-Forwarded-For': '192.0.2.1' } });
  assert.equal(proxyResponse.status, 200);
  await proxyResponse.arrayBuffer();
  await error(await request(trusted, { headers: { 'X-Forwarded-For': '192.0.2.1' } }), 429);
  const separateIP = await request(trusted, { headers: { 'X-Forwarded-For': '192.0.2.2' } });
  assert.equal(separateIP.status, 200);
  await separateIP.arrayBuffer();
  assert.throws(() => createRelayServer({ packageFile: source, allowedOrigins: ['*'] }));
  assert.throws(() => createRelayServer({ packageFile: source, allowedOrigins: [`${origin}/PPC`] }));
  assert.throws(() => createRelayServer({ packageFile: source, allowedOrigins: ['http://remote.invalid'] }));
  assert.throws(() => createRelayServer({ packageFile: source, maxFileBytes: 64 * 1024 * 1024 + 1 }));
  assert.throws(() => createRelayServer({ packageFile: source, trustedProxyIPs: ['anywhere'] }));
  const config = relayConfigFromEnv({ PPC_PACKAGE_FILE: source, PPC_ALLOWED_ORIGINS: origin, PPC_TRUSTED_PROXY_IPS: '127.0.0.1, ::1' });
  assert.equal(config.packageFile, source);
  assert.deepEqual(config.trustedProxyIPs, ['127.0.0.1', '::1']);
  const implementation = await readFile(new URL('../../server/package-relay.mjs', import.meta.url), 'utf8');
  assert.match(implementation, /plaintext\?\.fill\(0\)/, 'temporary decrypted bytes are cleared');
  assert.ok(!implementation.includes('console.'), 'requests, source paths, and keys are not logged');
  console.log('Package relay checks passed: encrypted key authorization, fixed source, limits, CORS, rate control, freshness, and safe errors.');
} finally {
  await Promise.all(servers.map(server => new Promise(resolveClosed => {
    server.closeAllConnections();
    server.close(resolveClosed);
  })));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()), 'cleanup stays in the temporary fixture directory');
  assert.ok(basename(directory).startsWith('ppc-relay-'));
  await rm(directory, { recursive: true, force: true });
}
