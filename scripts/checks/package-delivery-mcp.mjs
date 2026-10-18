import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createAscmMcpCore } from '../../supabase/functions/ppc-ascm-mcp/core.mjs';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createAscmMcpApplication } from '../../supabase/functions/ppc-ascm-mcp/bootstrap.mjs';
assert.equal(typeof createAscmMcpCore().confirmSharePointPublication, 'function', 'readback_auth_and_provenance: queue/readback tools must reuse exact owner OAuth');
const base = 'https://syntheticproject.supabase.co', resource = base + '/functions/v1/ppc-ascm-mcp/mcp';
const owner = '11111111-2222-4333-8444-555555555555', client = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const clock = Date.parse('2026-10-17T01:00:00.000Z');
const env = { SUPABASE_URL: base, PPC_ASCM_MCP_ENABLED: 'true', PPC_ASCM_MCP_RESOURCE: resource,
  PPC_ASCM_MCP_OWNER_ID: owner, PPC_ASCM_MCP_CLIENT_ID: client, PPC_ASCM_START_AFTER: '2026-10-01T00:00:00.000Z',
  PPC_ASCM_MCP_DOWNLOAD_ORIGIN: 'https://sdmntprcentralusdr.oaiusercontent.com', PPC_ASCM_IMPORT_SECRET: 'i'.repeat(48), PPC_PACKAGE_DELIVERY_ENABLED: 'true' };
const bytes = Buffer.concat([Buffer.from('PPCPKG01'), Buffer.alloc(65536, 7)]), sha256 = createHash('sha256').update(bytes).digest('hex');
const fileId = '12345678-1234-4234-8234-123456789abc';
const url = `${env.PPC_ASCM_MCP_DOWNLOAD_ORIGIN}/files/${fileId}/raw?se=2026-10-17T02%3A00%3A00Z&sig=fixture`;
const input = { candidateId: owner, generation: 2, item: { driveId: 'drive', folderId: 'folder', itemId: 'item', versionId: '1.0', fileName: `master-r7-g2-${owner}.pkg` },
  readback: { file_id: 'real-sandbox-artifact', download_url: url, mime_type: 'application/octet-stream', file_name: `master-r7-g2-${owner}.pkg` } };
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'fixture', alg: 'ES256', use: 'sig' };
async function token(patch = {}) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = b64({ alg: 'ES256', kid: 'fixture' }) + '.' + b64({ iss: base + '/auth/v1', aud: resource, sub: owner, client_id: client, role: 'authenticated', is_anonymous: false, iat: clock / 1000 - 60, exp: clock / 1000 + 3600, ...patch });
  return message + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(message))).toString('base64url');
}
function harness({ download, configuration = {} } = {}) {
  const calls = [], confirms = []; let queues = 0;
  const packageDelivery = { async getQueuedPublication() { queues++; return { candidate: null }; }, async confirmPublication(value) { confirms.push(value); return { status: 'published', publication: { provider: 'sharepoint', kind: 'publication', candidateId: owner, generation: 2, sha256, bytes: bytes.length, storageRevision: 7, publishedAt: '2026-10-17T01:00:00.000Z' } }; } };
  const fetchImpl = async (target, options) => {
    calls.push(target); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers?.Authorization, undefined); assert.equal(options.headers?.['X-PPC-Publisher-Secret'], undefined);
    if (target === base + '/auth/v1/.well-known/jwks.json') return Response.json({ keys: [jwk] });
    assert.equal(target, url);
    return download ? download(options) : new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 4096) c.enqueue(bytes.subarray(i, i + 4096)); c.close(); } }), { headers: { 'Content-Length': String(bytes.length) } });
  };
  const core = createAscmMcpCore({ env: { ...env, ...configuration }, fetchImpl, now: () => new Date(clock), getPackageDelivery: () => packageDelivery });
  return { core, confirms, calls, packageDelivery, fetchImpl, get queues() { return queues; } };
}
test('readback_auth_and_provenance requires signed owner/client/resource before raw file fetch and compares actual bytes', async () => {
  const h = harness(); const access = await token();
  assert.deepEqual(await h.core.getQueuedPublication(access, {}), { candidate: null });
  assert.equal((await h.core.confirmSharePointPublication(access, input)).status, 'published');
  assert.deepEqual(h.confirms[0], { candidateId: owner, generation: 2, item: input.item, verified: { sha256, bytes: bytes.length } });
  for (const patch of [{ sub: client }, { client_id: owner }, { aud: base }, { role: 'service_role' }, { exp: clock / 1000 }]) {
    const prior = h.calls.length; await assert.rejects(() => token(patch).then(value => h.core.confirmSharePointPublication(value, input))); assert.equal(h.calls.length, prior);
  }
});
test('readback rejects URL-as-file, expanded origins/paths, redirects, truncated and oversized streams before CAS', async () => {
  const access = await token(); const h = harness();
  for (const patch of [{ file_id: url }, { download_url: 'https://attacker.invalid/file' }, { download_url: url.replace('/raw?', '/other?') }, { file_name: 'another.pkg' }, { mime_type: 'text/plain' }]) {
    await assert.rejects(() => h.core.confirmSharePointPublication(access, { ...input, readback: { ...input.readback, ...patch } }));
  }
  for (const download of [() => new Response(bytes, { status: 302, headers: { Location: 'https://attacker.invalid' } }),
    () => new Response(bytes, { headers: { 'Content-Length': '67108865' } }),
    () => new Response(bytes.subarray(0, -1), { headers: { 'Content-Length': String(bytes.length) } }),
    () => new Response(new ReadableStream({ start(c) { const chunk = Buffer.alloc(65536); chunk.write('PPCPKG01'); for (let i = 0; i < 1025; i++) c.enqueue(chunk); c.close(); } }))]) {
    const bad = harness({ download }); await assert.rejects(() => bad.core.confirmSharePointPublication(access, input)); assert.equal(bad.confirms.length, 0);
  }
  assert.equal(h.confirms.length, 0);
});
test('default-off package tools cannot retrieve queue or confirm even with correct OAuth', async () => {
  const h = harness({ configuration: { PPC_PACKAGE_DELIVERY_ENABLED: '' } }); const access = await token();
  await assert.rejects(() => h.core.getQueuedPublication(access, {})); await assert.rejects(() => h.core.confirmSharePointPublication(access, input)); assert.equal(h.queues, 0); assert.equal(h.confirms.length, 0);
});
test('stalled raw readback uses the fixed 120-second deadline, aborts fetch and cannot confirm', async () => {
  const access = await token(); const original = globalThis.setTimeout;
  let requested = false, signal;
  const h = harness({ download: options => { signal = options.signal; return new Promise(() => {}); } });
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 120_000) { requested = true; return original(callback, 5, ...args); }
    return original(callback, delay, ...args);
  };
  try { await assert.rejects(() => h.core.confirmSharePointPublication(access, input)); }
  finally { globalThis.setTimeout = original; }
  assert(requested); assert.equal(signal.aborted, true); assert.equal(h.confirms.length, 0);
});
test('real pinned MCP SDK exposes strict readback fileParams and preserves OAuth descriptor', async () => {
  const h = harness();
  const app = createAscmMcpApplication({ env, fetchImpl: h.fetchImpl, now: () => new Date(clock).toISOString(), createMcpHandler, McpServer, z, packageDeliveryFactory: () => h.packageDelivery });
  const access = await token();
  async function rpc(method, params = {}) {
    const response = await app(new Request(resource, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${access}`, 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }));
    const text = await response.text(); return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : JSON.parse(text.split('\n').find(line => line.startsWith('data: ')).slice(6));
  }
  const tools = (await rpc('tools/list')).result.tools;
  const confirm = tools.find(t => t.name === 'confirm_sharepoint_publication'); assert(confirm);
  assert.deepEqual(confirm._meta['openai/fileParams'], ['readback']); assert.deepEqual(confirm.securitySchemes, [{ type: 'oauth2', scopes: ['email'] }]);
  assert.equal(confirm.inputSchema.additionalProperties, false); assert.equal(confirm.inputSchema.properties.item.additionalProperties, false);
  const result = await rpc('tools/call', { name: 'confirm_sharepoint_publication', arguments: input });
  assert.equal(result.result.structuredContent.status, 'published'); assert.equal(h.confirms.length, 1);
  await rpc('tools/call', { name: 'confirm_sharepoint_publication', arguments: { ...input, destination: 'attacker' } }); assert.equal(h.confirms.length, 1);
});
