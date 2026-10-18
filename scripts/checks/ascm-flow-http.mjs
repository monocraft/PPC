import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createHash } from 'node:crypto';
import { createPackageDelivery } from '../../supabase/functions/ppc-package/core.mjs';
let module;
try { module = await import('../../supabase/functions/ppc-ascm-flow/http.mjs'); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
assert.equal(typeof module?.createAscmFlowHttpHandler, 'function', 'Native flow must reject disabled/auth/route requests before business access');
const { createAscmFlowHttpHandler } = module;
const base = 'https://syntheticproject.supabase.co/functions/v1/ppc-ascm-flow';
const env = { SUPABASE_URL: 'https://syntheticproject.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-private',
  PPC_ASCM_FLOW_ENABLED: 'true', PPC_ASCM_FLOW_SECRET: 'w'.repeat(48), PPC_ASCM_IMPORT_SECRET: 'i'.repeat(48),
  PPC_PUBLISHER_SECRET: 'p'.repeat(48), PPC_PACKAGE_KEY_HASH: 'a'.repeat(64), PPC_ASCM_START_AFTER: '2026-09-30T00:00:00Z',
  PPC_PACKAGE_DELIVERY_ENABLED: 'true', PPC_PACKAGE_SP_DRIVE_ID: 'drive', PPC_PACKAGE_SP_FOLDER_ID: 'folder', PPC_ASCM_STATUS_ENABLED: 'true' };
const now = () => '2026-10-17T01:00:00Z';
const digest = b => createHash('sha256').update(b).digest('hex');
const workbook = Buffer.from('PK fixture workbook');
const report = { sender: 'linny.chen@hp.com', subject: 'ASCM Report Accessories HyperX Release Notification October 2026',
  receivedAt: '2026-09-30T09:01:09Z', messageId: 'exact-mail', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx', workbookBase64: workbook.toString('base64') };
const id = '11111111-2222-4333-8444-555555555555';
const bytes = Buffer.concat([Buffer.from('PPCPKG01'), Buffer.alloc(100, 7)]);
const candidate = { candidateId: id, kind: 'publication', generation: 2, expectedGeneration: 1, storageRevision: 7, sourceSha: 'a'.repeat(40),
  manifestSha256: 'b'.repeat(64), ownerImagesCommit: null, sha256: digest(bytes), bytes: bytes.length, objectKey: `packages/${id}.pkg`,
  createdAt: '2026-10-17T00:00:00Z', expiresAt: '2026-10-17T03:00:00Z', status: 'ready' };
const publicCandidate = { candidateId: id, generation: 2, storageRevision: 7, sha256: digest(bytes), bytes: bytes.length,
  expiresAt: candidate.expiresAt, fileName: `master-r7-g2-${id}.pkg`, provider: 'sharepoint', driveId: 'drive', folderId: 'folder' };
const receipt = { requestId: 'ascm-' + digest(workbook), storageRevision: 7, alreadySaved: true, archiveAllowed: true,
  status: 'published', summary: { savedFields: 2, savedProducts: 1, private: 'secret' }, private: 'secret' };
const req = (path, body = {}, options = {}) => new Request(base + path, { method: 'POST', headers: {
  'Content-Type': 'application/json', 'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET, ...options.headers },
  body: JSON.stringify(body), ...Object.fromEntries(Object.entries(options).filter(([k]) => k !== 'headers')) });
function harness(options = {}) {
  const calls = [];
  const delivery = { getQueuedPublicationMetadata: async () => { calls.push('metadata'); return { phase: 'sharepoint', candidate: publicCandidate, ...options.metadata }; },
    publicState: async () => { calls.push('public'); return { ...candidate, provider: 'sharepoint', publishedAt: candidate.createdAt, ...options.publication }; },
    openQueuedPublication: async input => { calls.push(['open', input]); return new Response(bytes); },
    confirmPublication: async input => { calls.push(['confirm', input]); return { status: 'already_published', publication: { provider: 'sharepoint', kind: 'publication', ...publicCandidate, ...input.verified, publishedAt: candidate.createdAt }, private: 'secret' }; } };
  const handler = createAscmFlowHttpHandler({ env: { ...env, ...options.env }, now,
    invokeAscm: async request => { calls.push('import'); assert.equal(request.headers.get('X-PPC-ASCM-Secret'), env.PPC_ASCM_IMPORT_SECRET);
      assert.equal(request.headers.has('X-PPC-ASCM-Flow-Secret'), false); assert.deepEqual(await request.json(), report);
      return Response.json(options.receipt || receipt, { status: options.status || 200 }); },
    getPackageDelivery: () => { calls.push('delivery'); return delivery; }, invokeConnection: async p => { calls.push(p); return { reported: true, private: 'secret' }; } });
  return { handler, calls };
}
test('disabled configuration, authorization, origin, namespace, query and methods read no body or dependencies', async () => {
  for (const config of [{ PPC_ASCM_FLOW_ENABLED: '' }, { PPC_ASCM_FLOW_SECRET: env.PPC_ASCM_IMPORT_SECRET }, { PPC_ASCM_FLOW_SECRET: env.PPC_PUBLISHER_SECRET },
    { PPC_ASCM_FLOW_SECRET: 'short' }, { PPC_ASCM_START_AFTER: '' }, { PPC_PACKAGE_DELIVERY_ENABLED: '' }, { SUPABASE_SERVICE_ROLE_KEY: '' }]) {
    const h = harness({ env: config }); assert.equal((await h.handler(req('/api/ascm/import'))).status, 404); assert.deepEqual(h.calls, []);
  }
  for (const [path, options, expected] of [['/api/ascm/import', { headers: { 'X-PPC-ASCM-Flow-Secret': 'bad' } }, 401],
    ['/api/ascm/import', { headers: { Origin: 'null' } }, 403], ['/other/api/ascm/import', {}, 404], ['/api/ascm/import?x=1', {}, 400],
    ['/api/master/ascm', {}, 404], ['/api/ascm/publication/queued', { method: 'PUT' }, 405]]) {
    const h = harness(); const request = req(path, {}, options); Object.defineProperty(request, 'body', { get() { throw Error('Body read on rejected route'); } });
    const r = await h.handler(request); assert.equal(r.status, expected); assert.equal((await r.json()).archiveAllowed, false); assert.deepEqual(h.calls, []);
    assert.equal(r.headers.has('Access-Control-Allow-Origin'), false);
  }
});
test('mail cutoff/envelope, extra fields, JSON and workbook limits fail before delivery/gateway', async () => {
  for (const value of [{ ...report, receivedAt: env.PPC_ASCM_START_AFTER }, { ...report, sender: 'attacker@hp.com' },
    { ...report, subject: 'ASCM Review Notification October 2026' }, { ...report, extra: true }, { ...report, workbookBase64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }]) {
    const h = harness(); const r = await h.handler(req('/api/ascm/import', value)); assert(r.status >= 400); assert.equal((await r.json()).archiveAllowed, false); assert.deepEqual(h.calls, []);
  }
  const h = harness(); const r = await h.handler(req('/api/ascm/import', {}, { headers: { 'Content-Length': String(3 * 1024 * 1024 + 1) } })); assert.equal(r.status, 413); assert.deepEqual(h.calls, []);
});
test('native receipt is whitelisted and Archive binds digest/message plus independent normal publication', async () => {
  const h = harness(); const r = await h.handler(req('/api/ascm/import', report)); const value = await r.json();
  const { private: ignored, ...expected } = receipt;
  assert.equal(r.status, 200); assert.deepEqual(value, { ...expected, summary: { savedFields: 2, savedProducts: 1 }, sourceMessageId: report.messageId });
});
test('legacy preflight, seed/old/foreign public state and forged receipts never grant Archive', async () => {
  const legacy = harness({ metadata: { phase: 'legacy' } }); assert.equal((await legacy.handler(req('/api/ascm/import', report))).status, 409); assert(!legacy.calls.includes('import'));
  for (const publication of [{ kind: 'seed' }, { storageRevision: 6 }, { provider: 'github' }]) {
    const h = harness({ publication }); const r = await h.handler(req('/api/ascm/import', report)); assert.equal(r.status, 202); assert.equal((await r.json()).archiveAllowed, false);
  }
  for (const value of [{ ...receipt, requestId: 'ascm-' + 'f'.repeat(64) }, { ...receipt, summary: { savedFields: -1, savedProducts: 1 } }, { ...receipt, archiveAllowed: 'true' }]) {
    const h = harness({ receipt: value }); const r = await h.handler(req('/api/ascm/import', report)); assert(r.status >= 400); assert.equal((await r.json()).archiveAllowed, false);
  }
  for (const [status, value] of [[202, { ...receipt, archiveAllowed: false, status: 'publication_pending' }], [409, { code: 'ASCM_REVIEW_REQUIRED', private: 'secret' }], [503, { code: 'secret' }]]) {
    const h = harness({ status, receipt: value }); const r = await h.handler(req('/api/ascm/import', report)); const body = await r.json(); assert.equal(body.archiveAllowed, false); assert(!JSON.stringify(body).includes('secret'));
  }
});
test('queued exposes only fixed metadata and relative raw path; strict connection enum cannot reach gateway', async () => {
  const h = harness(); const r = await h.handler(req('/api/ascm/publication/queued')); const value = await r.json();
  assert.deepEqual(value, { candidate: publicCandidate, binaryPath: `/api/ascm/publication/${id}/bytes`, archiveAllowed: false });
  assert.equal((await h.handler(req('/api/ascm/publication/queued', { key: 'no' }))).status, 400);
  const c = await h.handler(req('/api/ascm/connection', { service: 'outlook', state: 'available' })); assert.deepEqual(await c.json(), { reported: true, archiveAllowed: false });
  assert.equal((await h.handler(req('/api/ascm/connection', { service: 'outlook', state: 'unknown' }))).status, 400); assert(!h.calls.includes('import'));
});
const binaryHeaders = { 'Content-Type': 'application/octet-stream', 'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET,
  'X-PPC-Package-Generation': '2', 'X-PPC-SP-Drive-Id': 'drive', 'X-PPC-SP-Folder-Id': 'folder', 'X-PPC-SP-Item-Id': 'item',
  'X-PPC-SP-Version-Id': '1.0', 'X-PPC-SP-File-Name': publicCandidate.fileName };
const chunked = (length, { truncate = 0, corrupt = false, cancel } = {}) => { let offset = 0; return new ReadableStream({
  pull(c) { if (offset >= length - truncate) return c.close(); const size = Math.min(64 * 1024, length - truncate - offset); const chunk = new Uint8Array(size).fill(7);
    if (!offset && !corrupt) chunk.set(Buffer.from('PPCPKG01')); offset += size; c.enqueue(chunk); }, cancel }); };
function raw(length, stream = chunked(length), extra = {}) { return new Request(`${base}/api/ascm/publication/${id}/confirm`, {
  method: 'POST', headers: { ...binaryHeaders, 'Content-Length': String(length), ...extra }, body: stream, duplex: 'half' }); }
test('raw confirmation incrementally accepts actual generated 45 MiB and full 64 MiB, historical retries need no queued lookup', async () => {
  for (const size of [45 * 1024 * 1024, 64 * 1024 * 1024]) {
    const h = harness(); const verifier = createHash('sha256'); const reader = chunked(size).getReader(); for (;;) { const p = await reader.read(); if (p.done) break; verifier.update(p.value); }
    const r = await h.handler(raw(size)); assert.equal(r.status, 200); const result = await r.json(); assert.equal(result.archiveAllowed, false); assert.equal(result.private, undefined);
    assert(!h.calls.includes('metadata')); const input = h.calls.find(v => Array.isArray(v) && v[0] === 'confirm')[1]; assert.deepEqual(input.verified, { bytes: size, sha256: verifier.digest('hex') });
  }
});
test('raw invalid declared/actual/envelope, overlimit, stalled and aborted streams never confirm', async () => {
  for (const request of [raw(100, chunked(100, { truncate: 1 })), raw(100, chunked(101)), raw(100, chunked(100, { corrupt: true })),
    raw(64 * 1024 * 1024 + 1), raw(100, chunked(100), { 'Content-Length': '00100' }), raw(100, chunked(100), { 'X-PPC-Package-Generation': '02' }),
    raw(100, chunked(100), { 'X-PPC-SP-Item-Id': 'item\tbad' }), raw(100, chunked(100), { 'X-PPC-Package-SHA256': 'f'.repeat(64) })]) {
    const h = harness(); const r = await h.handler(request); assert(r.status >= 400); assert.equal((await r.json()).archiveAllowed, false); assert(!h.calls.some(v => Array.isArray(v) && v[0] === 'confirm'));
  }
  let cancelled = false; const h = harness(); const controller = new AbortController();
  const request = new Request(raw(100, new ReadableStream({ cancel() { cancelled = true; } })), { signal: controller.signal, duplex: 'half' });
  const pending = h.handler(request); controller.abort(); assert((await pending).status >= 400); assert(cancelled);
  mock.timers.enable({ apis: ['setTimeout'] });
  try { let stalledCancelled = false; const stalled = harness(); const pending = stalled.handler(raw(100, new ReadableStream({ cancel() { stalledCancelled = true; } })));
    await Promise.resolve(); await Promise.resolve(); mock.timers.tick(120_001); const r = await pending; assert(r.status >= 400); assert(stalledCancelled);
  } finally { mock.timers.reset(); }
});
test('core metadata never signs or opens, exact queued bytes deny current/history/expired and verify hash/length/cancellation', async () => {
  const state = { phase: 'sharepoint', queued: candidate, current: { ...candidate, generation: 1, status: 'published' }, policy: { provider: 'sharepoint', host: 'hp.sharepoint.com', driveId: 'drive', folderId: 'folder' } };
  let signs = 0, opens = 0, content = bytes;
  const core = createPackageDelivery({ env, now, database: async op => { assert.equal(op, 'current'); return state; },
    storage: { signDownload() { signs++; throw Error('Never sign'); }, openObject: async (c, { signal }) => { opens++; assert(signal); return new Response(content); } } });
  assert.equal(typeof core.getQueuedPublicationMetadata, 'function'); assert.equal(typeof core.openQueuedPublication, 'function');
  assert.deepEqual(await core.getQueuedPublicationMetadata(), { phase: 'sharepoint', candidate: publicCandidate }); assert.equal(signs, 0); assert.equal(opens, 0);
  for (const input of [{ candidateId: id, generation: 1 }, { candidateId: '22222222-2222-4333-8444-555555555555', generation: 2 }]) await assert.rejects(() => core.openQueuedPublication(input)); assert.equal(opens, 0);
  const input = { candidateId: id, generation: 2 }; assert.deepEqual(Buffer.from(await (await core.openQueuedPublication(input)).arrayBuffer()), bytes);
  for (const b of [bytes.subarray(0, -1), Buffer.concat([bytes, Buffer.from([8])]), Buffer.alloc(bytes.length)]) { content = b; await assert.rejects(async () => (await core.openQueuedPublication(input)).arrayBuffer()); }
  content = bytes; const abort = new AbortController(); const response = await core.openQueuedPublication(input, { signal: abort.signal }); abort.abort(); await assert.rejects(() => response.arrayBuffer());
  state.queued = { ...candidate, expiresAt: '2026-10-17T00:30:00Z' }; assert.equal((await core.getQueuedPublicationMetadata()).candidate, null); await assert.rejects(() => core.openQueuedPublication(input));
});
