import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';

let module;
try { module = await import('../../supabase/functions/ppc-ascm-mcp/core.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof module?.createAscmMcpCore, 'function', 'MCP core must expose the narrow authenticated importer');
const { createAscmMcpCore } = module;
const clock = 1792238400;
const owner = '11111111-2222-4333-8444-555555555555';
const client = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const base = 'https://syntheticproject.supabase.co';
const resource = base + '/functions/v1/ppc-ascm-mcp/mcp';
const issuer = base + '/auth/v1';
const origin = 'https://sdmntprcentralusdr.oaiusercontent.com';
const fileId = '12345678-1234-4234-8234-123456789abc';
const url = origin + '/files/' + fileId + '/raw?se=2026-10-17T13%3A00%3A00Z&sig=synthetic-signature';
const secret = 'isolated-server-only-import-secret-'.padEnd(48, 'x');
const env = { PPC_ASCM_MCP_ENABLED: 'true', SUPABASE_URL: base,
  PPC_ASCM_MCP_RESOURCE: resource,
  PPC_ASCM_MCP_OWNER_ID: owner, PPC_ASCM_MCP_CLIENT_ID: client,
  PPC_ASCM_MCP_DOWNLOAD_ORIGIN: origin, PPC_ASCM_START_AFTER: '2026-10-01T00:00:00Z',
  PPC_ASCM_IMPORT_SECRET: secret };
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const keys = {};
for (const algorithm of ['ES256', 'RS256']) {
  const parameters = algorithm === 'ES256' ? { name: 'ECDSA', namedCurve: 'P-256' }
    : { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const pair = await crypto.subtle.generateKey(parameters, true, ['sign', 'verify']);
  keys[algorithm] = { ...pair, jwk: { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: algorithm.toLowerCase(), alg: algorithm, use: 'sig' } };
}
const claims = { iss: issuer, aud: resource, sub: owner, client_id: client,
  role: 'authenticated', is_anonymous: false, iat: clock - 60, exp: clock + 3540 };
async function token(patch = {}, headerPatch = {}, signWith) {
  const header = { alg: 'ES256', kid: 'es256', typ: 'JWT', ...headerPatch };
  const signing = keys[signWith || header.alg] || keys.ES256;
  const input = b64(header) + '.' + b64({ ...claims, ...patch });
  const algorithm = (signWith || header.alg) === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
  return input + '.' + Buffer.from(await crypto.subtle.sign(algorithm, signing.privateKey, new TextEncoder().encode(input))).toString('base64url');
}
const bytes = Buffer.from('synthetic workbook transport bytes');
const requestId = 'ascm-' + createHash('sha256').update(bytes).digest('hex');
const input = { sender: 'linny.chen@hp.com', subject: 'ASCM Report Accessories HyperX Release Notification October 2026',
  receivedAt: '2026-10-10T12:00:00Z', messageId: 'synthetic-message', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx',
  workbook: { download_url: url, file_id: fileId, file_name: 'ASCM Report_HyperX_2026-09-30.xlsx',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } };
const receipt = { requestId, storageRevision: 7, alreadySaved: false, archiveAllowed: false,
  status: 'publication_pending', summary: { savedFields: 4, savedProducts: 1 } };
function harness({ configuration = {}, jwks, download, importResponse } = {}) {
  const calls = [], imports = [];
  const core = createAscmMcpCore({ env: { ...env, ...configuration }, now: () => new Date(clock * 1000),
    fetchImpl: async (target, options) => {
      calls.push({ target, options });
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      assert(options.signal instanceof AbortSignal);
      assert.equal(options.headers?.Authorization, undefined, 'OAuth token cannot reach a download or JWKS endpoint');
      if (target === issuer + '/.well-known/jwks.json') return typeof jwks === 'function' ? jwks(options) : jwks || Response.json({ keys: [keys.ES256.jwk, keys.RS256.jwk] });
      assert.equal(target, url, 'only the exact approved attachment URL can be fetched');
      return typeof download === 'function' ? download(options) : download || new Response(bytes);
    },
    invokeAscm: async request => {
      imports.push(request);
      assert.equal(request.headers.get('X-PPC-ASCM-Secret'), secret);
      assert.equal(request.headers.get('Authorization'), null);
      return importResponse || Response.json(receipt, { status: 202 });
    } });
  return { core, calls, imports };
}
async function rejected(action, status = 401) {
  await assert.rejects(action, error => error.status === status && typeof error.code === 'string'
    && !JSON.stringify(error).includes(secret) && !error.message.includes('synthetic-signature'));
}

test('connection reporting requires the signed owner and carries only a bounded service/state pair', async () => {
  const reports = [];
  const core = createAscmMcpCore({ env, now: () => new Date(clock * 1000),
    fetchImpl: async target => { assert.equal(target, issuer + '/.well-known/jwks.json'); return Response.json({ keys: [keys.ES256.jwk] }); },
    invokeConnection: async input => { reports.push(input); return { reported: true, private: 'must-not-leak' }; },
    invokeAscm: () => { throw Error('Connection reporting cannot import a report.'); } });
  assert.equal(typeof core.reportConnection, 'function');
  const access = await token();
  assert.deepEqual(await core.reportConnection(access, { service: 'outlook', state: 'reconnect_required' }), { reported: true });
  assert.deepEqual(reports, [{ service: 'outlook', state: 'reconnect_required' }]);
  for (const input of [{ service: 'teams', state: 'available' }, { service: 'outlook', state: 'error' },
    { service: 'sharepoint', state: 'available', error: 'raw provider error' }, null]) {
    await rejected(() => core.reportConnection(access, input), 400);
  }
  assert.equal(reports.length, 1);
  await rejected(async () => core.reportConnection(await token({ sub: client }), { service: 'outlook', state: 'available' }));
  assert.equal(reports.length, 1);
});

test('owner access requires a real ES256 signature and returns only the narrow profile', async () => {
  const h = harness();
  assert.deepEqual(await h.core.getProfile(await token(), {}), { id: owner });
  assert.equal(h.calls.length, 1); assert.equal(h.imports.length, 0);
});

test('RS256 and freshly issued refresh-flow access tokens use the same exact resource binding', async () => {
  const h = harness();
  assert.deepEqual(await h.core.getProfile(await token({}, { alg: 'RS256', kid: 'rs256' }), {}), { id: owner });
  assert.deepEqual(await h.core.getProfile(await token({ iat: clock - 1, exp: clock + 3599 }), {}), { id: owner });
  assert.equal(h.calls.length, 1, 'verified public keys are cached without polling');
});

test('disabled or incomplete configuration performs no HTTP or import work', async () => {
  for (const key of Object.keys(env)) {
    const h = harness({ configuration: { [key]: '' } });
    await rejected(() => h.core.getProfile('invalid', {}), 503);
    assert.equal(h.calls.length, 0); assert.equal(h.imports.length, 0);
  }
  for (const configuration of [
    { PPC_ASCM_MCP_RESOURCE: 'authenticated' }, { PPC_ASCM_MCP_RESOURCE: base + '/functions/v1/other/mcp' },
    { PPC_ASCM_MCP_OWNER_ID: owner + ',' + client }, { PPC_ASCM_MCP_DOWNLOAD_ORIGIN: 'https://evil.test' },
  ]) {
    const h = harness({ configuration }); await rejected(() => h.core.getProfile('invalid', {}), 503);
    assert.equal(h.calls.length, 0);
  }
});

test('wrong resource issuer client owner or role is denied before attachment/import work', async () => {
  for (const patch of [{ aud: 'authenticated' }, { aud: [resource, 'authenticated'] }, { aud: client },
    { iss: issuer + '/' }, { client_id: owner }, { client_id: undefined }, { sub: client },
    { role: 'service_role' }, { is_anonymous: true }]) {
    const h = harness(); const value = await token(patch);
    await rejected(() => h.core.importReport(value, input));
    assert.equal(h.calls.length, 0); assert.equal(h.imports.length, 0);
  }
});

test('expired missing malformed or impossible token timestamps fail closed', async () => {
  for (const patch of [{ exp: clock }, { exp: clock - 1 }, { exp: '1792238500' }, { exp: undefined },
    { iat: undefined }, { iat: clock + 120 }, { iat: clock + 1, exp: clock - 1 },
    { nbf: clock + 120 }, { nbf: 'now' }, { nbf: clock + 3600 }]) {
    const h = harness(); const value = await token(patch);
    await rejected(() => h.core.getProfile(value, {}));
    assert.equal(h.imports.length, 0);
  }
});

test('bad signatures unsupported algorithms and caller key URLs cannot authenticate', async () => {
  const valid = await token(); const pieces = valid.split('.');
  const forged = pieces[0] + '.' + b64({ ...claims, exp: clock + 10000 }) + '.' + pieces[2];
  for (const value of [forged, valid.slice(0, -8) + 'AAAAAAAA', 'not-a-token', valid + '.extra',
    await token({}, { alg: 'HS256' }), await token({}, { alg: 'none' }),
    await token({}, { jku: 'https://evil.test/jwks' }), await token({}, { x5u: 'https://evil.test/cert' }),
    await token({}, { crit: ['unrecognized'] }), await token({}, { kid: 'unknown' })]) {
    const h = harness(); await rejected(() => h.core.importReport(value, input));
    assert(h.calls.every(call => call.target === issuer + '/.well-known/jwks.json'));
    assert.equal(h.imports.length, 0);
  }
});

test('ambiguous mismatched or oversized JWKS never grants access', async () => {
  for (const jwks of [Response.json({ keys: [] }), Response.json({ keys: [keys.ES256.jwk, keys.ES256.jwk] }),
    Response.json({ keys: [{ ...keys.ES256.jwk, alg: 'RS256' }] }),
    Response.json({ keys: [{ ...keys.ES256.jwk, use: 'enc' }] }),
    new Response('{}', { status: 302, headers: { Location: 'https://evil.test' } }),
    new Response('{}', { headers: { 'Content-Length': '1000000' } })]) {
    const h = harness({ jwks }); const value = await token();
    await rejected(() => h.core.getProfile(value, {}));
    assert.equal(h.imports.length, 0);
  }
});

test('unknown kid requests cannot cause repeated JWKS polling within the cache window', async () => {
  const h = harness(); const value = await token({}, { kid: 'unknown' });
  await rejected(() => h.core.getProfile(value, {}));
  await rejected(() => h.core.getProfile(value, {}));
  assert.equal(h.calls.length, 1);
});

test('an authorized attachment reaches the existing importer in process and exposes only a source-bound pending receipt', async () => {
  const h = harness({ importResponse: Response.json({ ...receipt, manifest: { privateData: 'must not escape' }, token: secret }, { status: 202 }) });
  const result = await h.core.importReport(await token(), input);
  assert.deepEqual(result, { ...receipt, sourceMessageId: 'synthetic-message' });
  assert.equal(h.calls.length, 2); assert.equal(h.imports.length, 1);
  const submitted = await h.imports[0].json();
  assert.deepEqual(submitted, { sender: 'linny.chen@hp.com', subject: 'ASCM Report Accessories HyperX Release Notification October 2026',
    receivedAt: '2026-10-10T12:00:00Z', messageId: 'synthetic-message', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx', workbookBase64: bytes.toString('base64') });
  assert.equal(JSON.stringify(result).includes('must not escape'), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('only a matching published native receipt may authorize archiving the exact source message', async () => {
  const published = { ...receipt, alreadySaved: true, archiveAllowed: true, status: 'published' };
  const h = harness({ importResponse: Response.json(published) });
  assert.deepEqual(await h.core.importReport(await token(), input), { ...published, sourceMessageId: 'synthetic-message' });
  for (const patch of [{ requestId: 'ascm-' + '0'.repeat(64) }, { archiveAllowed: 'true' }, { storageRevision: '7' },
    { status: 'publication_pending', archiveAllowed: true }, { summary: { savedFields: -1, savedProducts: 1 } }]) {
    const bad = harness({ importResponse: Response.json({ ...published, ...patch }) });
    const value = await token(); await rejected(() => bad.core.importReport(value, input), 503);
  }
});

test('backend review holds return an exact source binding without exposing backend errors or authorizing archive', async () => {
  const h = harness({ importResponse: Response.json({ code: 'ASCM_REVIEW_REQUIRED', error: secret,
    archiveAllowed: true, manifest: { privateData: true } }, { status: 409 }) });
  assert.deepEqual(await h.core.importReport(await token(), input), {
    sourceMessageId: 'synthetic-message', archiveAllowed: false, status: 'held', code: 'ASCM_REVIEW_REQUIRED' });
});

test('mail cutoff and monthly envelope validation happen before any attachment or import call', async () => {
  for (const patch of [{ sender: 'other@example.test' }, { subject: 'Weekly ASCM Review' },
    { receivedAt: '2026-10-01T00:00:00Z' }, { receivedAt: '2026-10-18T00:00:00Z' },
    { fileName: 'ASCM Report_HyperX_2026-09-31.xlsx' }, { messageId: 'bad\nidentity' },
    { workbookBase64: 'caller bytes' }, { archiveAllowed: true }, { arbitraryPatch: {} }]) {
    const h = harness(); const value = await token();
    await rejected(() => h.core.importReport(value, { ...input, ...patch }), 400);
    assert.equal(h.calls.length, 1); assert.equal(h.imports.length, 0);
  }
});

test('signed download URL validation rejects SSRF encoded paths credentials fragments and mismatched file identity', async () => {
  const rejectedUrls = [
    url.replace(origin, 'http://sdmntprcentralusdr.oaiusercontent.com'), url.replace(origin, 'https://evil.test'),
    url.replace(origin, origin + '.evil.test'), url.replace(origin, origin + ':444'),
    url.replace('https://', 'https://owner:password@'), url + '#fragment',
    origin + '/files/%31' + fileId.slice(1) + '/raw?sig=s&se=e',
    origin + '/files/' + fileId + '/raw/../raw?sig=s&se=e',
    origin + '/files/' + fileId + '/raw?se=e', origin + '/files/' + fileId + '/raw?sig=s',
    url + '&sig=ambiguous', origin + '/files/' + fileId + '/other?sig=s&se=e',
  ];
  for (const download_url of rejectedUrls) {
    const h = harness(); const value = await token();
    await rejected(() => h.core.importReport(value, { ...input, workbook: { ...input.workbook, download_url } }), 400);
    assert.equal(h.calls.length, 1); assert.equal(h.imports.length, 0);
  }
  for (const workbook of [{ ...input.workbook, file_id: '' }, { ...input.workbook, file_name: 'other.xlsx' },
    { ...input.workbook, download_url: url + '&padding=' + 'x'.repeat(17000) },
    { ...input.workbook, mime_type: 'application/pdf' }, { ...input.workbook, arbitraryUrl: url }]) {
    const h = harness(); const value = await token(); await rejected(() => h.core.importReport(value, { ...input, workbook }), 400);
    assert.equal(h.calls.length, 1); assert.equal(h.imports.length, 0);
  }
});

test('redirects declared oversize and streamed oversize attachments never invoke the importer', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  for (const download of [new Response('', { status: 302, headers: { Location: 'https://evil.test' } }),
    new Response(bytes, { headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) } }), new Response(stream)]) {
    const h = harness({ download }); const value = await token();
    await rejected(() => h.core.importReport(value, input), 503);
    assert.equal(h.imports.length, 0);
  }
  assert.equal(cancelled, true);
});

test('download abort failures and oversized or malformed importer replies expose no signed URL or payload', async () => {
  for (const options of [
    { download() { throw new DOMException('signed URL and sensitive bytes', 'AbortError'); } },
    { importResponse: new Response('{malformed') },
    { importResponse: new Response('x'.repeat(70000)) },
    { importResponse: Response.json({ ...receipt, summary: null }, { status: 202 }) },
  ]) {
    const h = harness(options); const value = await token();
    await rejected(() => h.core.importReport(value, input), 503);
    assert.equal(h.calls.length, 2);
    assert.equal(h.imports.length, options.download ? 0 : 1);
  }
});

test('profile and import argument shapes stay narrow and authentication always precedes file work', async () => {
  const h = harness(); const value = await token();
  await rejected(() => h.core.getProfile(value, { exportMaster: true }), 400);
  await rejected(() => h.core.importReport('invalid', input));
  await rejected(() => h.core.importReport(value, null), 400);
  assert.equal(h.calls.length, 1); assert.equal(h.imports.length, 0);
});

test('OpenAI opaque file IDs and optional metadata do not replace byte identity or require an extra issuer setting', async () => {
  const h = harness();
  const result = await h.core.importReport(await token(), { ...input, workbook: { download_url: url, file_id: 'file_opaque-provenance-id' } });
  assert.deepEqual(result, { ...receipt, sourceMessageId: 'synthetic-message' });
  assert.equal(h.imports.length, 1);
});
