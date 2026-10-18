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
const approvedSource = '5382371536c4a64c5550c4447fe21e363454068b27022064fdcaf333175e5ffb';
const approval = { sourceSha256: approvedSource, expiresAt: '2026-10-18T01:00:00Z' };
const historicalEnv = { PPC_ASCM_START_AFTER: '2026-10-01T00:00:00Z', PPC_ASCM_APPROVED_REPORT: JSON.stringify(approval) };
const invalidPolicies = [undefined, '', '{', 'null', '[]', '{}', JSON.stringify({ sourceSha256: approvedSource }),
  JSON.stringify({ expiresAt: approval.expiresAt }), JSON.stringify({ ...approval, extra: true }),
  JSON.stringify({ ...approval, sourceSha256: 1 }), JSON.stringify({ ...approval, sourceSha256: 'bad' }),
  JSON.stringify({ ...approval, sourceSha256: approvedSource.toUpperCase() }), JSON.stringify({ ...approval, expiresAt: 1 }),
  JSON.stringify({ ...approval, expiresAt: '2026-10-18' }), JSON.stringify({ ...approval, expiresAt: '2026-02-30T01:00:00Z' }),
  JSON.stringify({ ...approval, expiresAt: '2026-10-16T01:00:00Z' }), JSON.stringify(approval).padEnd(513, ' ')];
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
  const handler = createAscmFlowHttpHandler({ env: { ...env, ...options.env }, now: options.now || now,
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
test('only an exact unexpired approved source crosses the historical cutoff with the original payload and receipt identity', async () => {
  for (const policy of [JSON.stringify(approval), JSON.stringify(approval).padEnd(512, ' ')]) {
    const h = harness({ env: { ...historicalEnv, PPC_ASCM_APPROVED_REPORT: policy } });
    const response = await h.handler(req('/api/ascm/import', report));
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.requestId, 'ascm-' + digest(workbook)); assert.equal(body.sourceMessageId, 'exact-mail');
    assert.equal(body.archiveAllowed, true); assert.deepEqual(h.calls, ['delivery', 'metadata', 'import', 'public']);
  }
});
test('approved historical source binds all five exact strings even when case or timestamp variants remain envelope-valid', async () => {
  for (const change of [{ messageId: 'other-mail' }, { sender: 'Linny.Chen@hp.com' },
    { subject: 'ASCM Report Accessories HyperX Release Notification OCTOBER 2026' },
    { receivedAt: '2026-09-30T09:01:10Z' }, { fileName: 'ASCM Report_HyperX_2026-09-29.xlsx' }]) {
    const h = harness({ env: historicalEnv }); const response = await h.handler(req('/api/ascm/import', { ...report, ...change }));
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { code: 'ASCM_SOURCE_REJECTED', archiveAllowed: false });
    assert.deepEqual(h.calls, []);
  }
});
test('invalid or absent optional policy refuses historical mail without disclosure and preserves ordinary mail', async () => {
  for (const policy of invalidPolicies) {
    const historical = harness({ env: { ...historicalEnv, PPC_ASCM_APPROVED_REPORT: policy } });
    const response = await historical.handler(req('/api/ascm/import', report));
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { code: 'ASCM_SOURCE_REJECTED', archiveAllowed: false });
    assert.deepEqual(historical.calls, []);
    const ordinary = harness({ env: { PPC_ASCM_APPROVED_REPORT: policy } });
    const accepted = await ordinary.handler(req('/api/ascm/import', report));
    assert.equal(accepted.status, 200); assert.equal((await accepted.json()).archiveAllowed, true);
  }
});
test('a warm handler rechecks expiry for fresh imports and receipt replays including the exact expiry instant', async () => {
  let clock = '2026-10-18T00:59:59.999Z';
  const h = harness({ env: historicalEnv, now: () => clock });
  assert.equal((await h.handler(req('/api/ascm/import', report))).status, 200);
  const completedCalls = h.calls.slice();
  for (const time of [approval.expiresAt, '2026-10-18T01:00:00.001Z']) {
    clock = time; const response = await h.handler(req('/api/ascm/import', report));
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { code: 'ASCM_SOURCE_REJECTED', archiveAllowed: false });
    assert.deepEqual(h.calls, completedCalls);
  }
});
test('historical approval does not bypass future time, envelope, workbook, auth or origin refusals', async () => {
  const future = { ...report, receivedAt: '2026-10-18T00:00:00Z' };
  const invalidEnvelope = { ...report, sender: 'attacker@hp.com' };
  const fingerprint = value => digest(JSON.stringify([value.messageId, value.sender, value.subject, value.receivedAt, value.fileName]));
  for (const [value, extraEnv, clock, status, code] of [
    [future, { PPC_ASCM_START_AFTER: '2026-10-19T00:00:00Z', PPC_ASCM_APPROVED_REPORT: JSON.stringify({ ...approval, sourceSha256: fingerprint(future) }) }, now, 400, 'ASCM_SOURCE_REJECTED'],
    [invalidEnvelope, { PPC_ASCM_APPROVED_REPORT: JSON.stringify({ ...approval, sourceSha256: fingerprint(invalidEnvelope) }) }, now, 400, 'ASCM_SOURCE_REJECTED'],
    [report, {}, () => 'invalid-clock', 400, 'ASCM_SOURCE_REJECTED'],
    [{ ...report, extra: true }, {}, now, 400, 'INVALID_REQUEST'],
    [{ ...report, workbookBase64: 'AB==' }, {}, now, 400, 'ASCM_INVALID_WORKBOOK'],
    [{ ...report, workbookBase64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }, {}, now, 413, 'REQUEST_TOO_LARGE'],
  ]) {
    const h = harness({ env: { ...historicalEnv, ...extraEnv }, now: clock }); const response = await h.handler(req('/api/ascm/import', value));
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { code, archiveAllowed: false }); assert.deepEqual(h.calls, []);
  }
  for (const [headers, status] of [[{ 'X-PPC-ASCM-Flow-Secret': 'bad' }, 401], [{ Origin: 'null' }, 403]]) {
    const h = harness({ env: historicalEnv }); const request = req('/api/ascm/import', report, { headers });
    Object.defineProperty(request, 'body', { get() { throw Error('Rejected request must not read the body'); } });
    const response = await h.handler(request); assert.equal(response.status, status); assert.equal((await response.json()).archiveAllowed, false); assert.deepEqual(h.calls, []);
  }
});
test('historical approval grants no new receipt, review or independent normal publication authority', async () => {
  for (const options of [{ publication: { kind: 'seed' } }, { publication: { storageRevision: 6 } }, { publication: { provider: 'github' } },
    { status: 202, receipt: { ...receipt, archiveAllowed: false, status: 'publication_pending' } },
    { status: 409, receipt: { code: 'ASCM_REVIEW_REQUIRED' } }, { receipt: { ...receipt, requestId: 'ascm-' + 'f'.repeat(64) } }]) {
    const h = harness({ ...options, env: historicalEnv }); const response = await h.handler(req('/api/ascm/import', report));
    const body = await response.json(); assert.equal(body.archiveAllowed, false); assert(h.calls.includes('import'));
    if (options.status === 409) { assert.equal(response.status, 409); assert.equal(body.code, 'ASCM_REVIEW_REQUIRED'); }
    else if (options.receipt?.requestId && options.receipt.requestId !== receipt.requestId) { assert.equal(response.status, 503); assert.equal(body.code, 'ASCM_FLOW_UNAVAILABLE'); }
    else { assert.equal(response.status, 202); assert.equal(body.status, 'publication_pending'); }
  }
});
test('native receipt is whitelisted and Archive binds digest/message plus independent normal publication', async () => {
  const h = harness(); const r = await h.handler(req('/api/ascm/import', report)); const value = await r.json();
  const { private: ignored, ...expected } = receipt;
  assert.equal(r.status, 200); assert.deepEqual(value, { ...expected, summary: { savedFields: 2, savedProducts: 1 }, sourceMessageId: report.messageId });
});
test('only exact upstream review holds expose the twelve safe reasons without private fields or Archive authority', async () => {
  const reasons = ['AMBIGUOUS_MATCH', 'CATEGORY_RELOCATION', 'DATE_POLICY_REQUIRED', 'DUPLICATE_MATCH',
    'INCOMPATIBLE_MAPPING', 'INCOMPLETE_NEW_PRODUCT', 'MALFORMED_REPORT', 'MASTER_CONFLICT', 'PRODUCT_ID_COLLISION',
    'PROTECTED_DATE', 'STALE_REPORT', 'TOO_MANY_GROUPS'];
  for (const reviewReason of reasons) {
    const h = harness({ status: 409, receipt: { code: 'ASCM_REVIEW_REQUIRED', reviewReason, private: 'review-private-sentinel',
      error: 'review-private-sentinel', details: { productId: 'review-private-sentinel' }, archiveAllowed: true } });
    const response = await h.handler(req('/api/ascm/import', report));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { sourceMessageId: report.messageId, requestId: 'ascm-' + digest(workbook),
      status: 'held', archiveAllowed: false, code: 'ASCM_REVIEW_REQUIRED', reviewReason });
    assert.deepEqual(h.calls, ['delivery', 'metadata', 'import']);
  }
});
test('absent malformed or unrelated upstream reasons retain the generic held response', async () => {
  const invalidReasons = [undefined, null, 42, {}, [], '', 'UNKNOWN_REVIEW_REASON', 'DATE_POLICY_REQUIRED '];
  const cases = [
    ...invalidReasons.map(reviewReason => ({ status: 409, code: 'ASCM_REVIEW_REQUIRED', reviewReason, expectedStatus: 409, expectedCode: 'ASCM_REVIEW_REQUIRED' })),
    { status: 409, code: 'ASCM_RETRY_REQUIRED', reviewReason: 'DATE_POLICY_REQUIRED', expectedStatus: 409, expectedCode: 'ASCM_RETRY_REQUIRED' },
    { status: 409, code: 'UNAPPROVED_CODE', reviewReason: 'DATE_POLICY_REQUIRED', expectedStatus: 409, expectedCode: 'ASCM_IMPORT_NOT_CONFIRMED' },
    ...[400, 401, 413, 418, 429, 502, 503].map(status => ({ status, code: 'ASCM_REVIEW_REQUIRED', reviewReason: 'DATE_POLICY_REQUIRED',
      expectedStatus: [400, 413, 429, 503].includes(status) ? status : 503, expectedCode: 'ASCM_REVIEW_REQUIRED' })),
  ];
  for (const { status, code, reviewReason, expectedStatus, expectedCode } of cases) {
    const h = harness({ status, receipt: { code, reviewReason, private: 'review-private-sentinel', archiveAllowed: true } });
    const response = await h.handler(req('/api/ascm/import', report));
    assert.equal(response.status, expectedStatus);
    assert.deepEqual(await response.json(), { sourceMessageId: report.messageId, requestId: 'ascm-' + digest(workbook),
      status: 'held', archiveAllowed: false, code: expectedCode });
    assert.deepEqual(h.calls, ['delivery', 'metadata', 'import']);
  }
});
test('published and pending native receipts never copy an unrelated review reason', async () => {
  for (const status of [200, 202]) {
    const pending = status === 202;
    const native = { ...receipt, archiveAllowed: !pending, status: pending ? 'publication_pending' : 'published', reviewReason: 'DATE_POLICY_REQUIRED' };
    const h = harness({ status, receipt: native });
    const response = await h.handler(req('/api/ascm/import', report));
    const { private: ignored, reviewReason: ignoredReason, ...expected } = native;
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { ...expected, summary: { savedFields: 2, savedProducts: 1 }, sourceMessageId: report.messageId });
  }
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
test('invalid historical policy leaves queue, raw read and confirmation operations unchanged', async () => {
  for (const policy of ['{', JSON.stringify({ ...approval, expiresAt: '2026-10-16T01:00:00Z' }), JSON.stringify(approval).padEnd(513, ' ')]) {
    const h = harness({ env: { PPC_ASCM_APPROVED_REPORT: policy } });
    const queued = await h.handler(req('/api/ascm/publication/queued')); assert.equal(queued.status, 200);
    assert.deepEqual(await queued.json(), { candidate: publicCandidate, binaryPath: `/api/ascm/publication/${id}/bytes`, archiveAllowed: false });
    const opened = await h.handler(new Request(`${base}/api/ascm/publication/${id}/bytes`, { headers: {
      'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET, 'X-PPC-Package-Generation': '2' } }));
    assert.equal(opened.status, 200); assert.deepEqual(Buffer.from(await opened.arrayBuffer()), bytes);
    const confirmed = await h.handler(raw(100)); assert.equal(confirmed.status, 200); assert.equal((await confirmed.json()).archiveAllowed, false);
    assert(!h.calls.includes('import'));
  }
});
for (const mount of ['', '/ppc-ascm-flow', '/functions/v1/ppc-ascm-flow']) {
  test(`native worker accepts the exact ${mount || 'direct'} mount with fixed metadata and raw routes`, async () => {
    const root = 'https://syntheticproject.supabase.co' + mount;
    const h = harness();
    const queued = await h.handler(new Request(root + '/api/ascm/publication/queued', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET }, body: '{}' }));
    assert.equal(queued.status, 200); assert.deepEqual(await queued.json(), { candidate: publicCandidate, binaryPath: `/api/ascm/publication/${id}/bytes`, archiveAllowed: false });
    const opened = await h.handler(new Request(root + `/api/ascm/publication/${id}/bytes`, { headers: {
      'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET, 'X-PPC-Package-Generation': '2' } }));
    assert.equal(opened.status, 200); assert.deepEqual(Buffer.from(await opened.arrayBuffer()), bytes);
    const confirmed = await h.handler(new Request(root + `/api/ascm/publication/${id}/confirm`, { method: 'POST',
      headers: { ...binaryHeaders, 'Content-Length': '100' }, body: chunked(100), duplex: 'half' }));
    assert.equal(confirmed.status, 200); assert.equal((await confirmed.json()).archiveAllowed, false);
    for (const [method, extra, status] of [['PUT', {}, 405], ['POST', { 'X-PPC-ASCM-Flow-Secret': 'bad' }, 401], ['POST', { Origin: 'null' }, 403]]) {
      const held = harness(); const request = new Request(root + '/api/ascm/publication/queued', { method, headers: {
        'Content-Type': 'application/json', 'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET, ...extra }, ...(method === 'POST' ? { body: '{}' } : {}) });
      Object.defineProperty(request, 'body', { get() { throw Error('Rejected request must not read the body'); } });
      assert.equal((await held.handler(request)).status, status); assert.deepEqual(held.calls, []);
    }
  });
}

test('native worker namespace lookalikes, sibling mounts and doubled prefixes read no body or dependencies', async () => {
  for (const path of ['/other/api/ascm/publication/queued', '/ppc-ascm-flow-extra/api/ascm/publication/queued',
    '/functions/v1/ppc-ascm-flow-extra/api/ascm/publication/queued', '/ppc-package/api/ascm/publication/queued',
    '/functions/v1/ppc-package/api/ascm/publication/queued', '/ppc-ascm-flow/ppc-ascm-flow/api/ascm/publication/queued',
    '/functions/v1/ppc-ascm-flow/ppc-ascm-flow/api/ascm/publication/queued', '/ppc-ascm-flow/functions/v1/ppc-ascm-flow/api/ascm/publication/queued',
    '/%70pc-ascm-flow/api/ascm/publication/queued', '/ppc-ascm-flow%2fapi/ascm/publication/queued']) {
    const h = harness(); const request = new Request('https://syntheticproject.supabase.co' + path, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET }, body: '{}' });
    Object.defineProperty(request, 'body', { get() { throw Error('Rejected namespace must not read the body'); } });
    assert.equal((await h.handler(request)).status, 404, path); assert.deepEqual(h.calls, []);
  }
});

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

const spSource = { provider: 'sharepoint', hostname: 'hp.sharepoint.com', sitePath: '/teams/IPSG_SCM_and_Product_Requirements_Info',
  driveId: 'b!Dxcy8q8LE0GivbyM3D6Dq5C5iXHjfxBMsvQrwTpLknS0JFIuvvhlQoilkLMqZkl9', listId: '2e5224b4-f8be-4265-88a5-90b32a66497d',
  listItemId: 908, itemUniqueId: 'e5cb1d81-7071-40b6-93cb-86ef0b577f52', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx',
  relativePath: '(09) September 2026/ASCM Report_HyperX_2026-09-30.xlsx', versionLabel: '2.0', eTag: '"fixture-v2"',
  createdAt: '2026-09-30T09:00:46Z', lastModifiedAt: '2026-10-07T07:44:51Z', bytes: workbook.length };
const spProof = Object.fromEntries(['listItemId', 'itemUniqueId', 'versionLabel', 'eTag', 'bytes'].map(k => [k, spSource[k]]));
const spInput = { schemaVersion: 1, source: spSource, before: spProof, after: spProof, workbookBase64: workbook.toString('base64') };
const spId = 'ascm-sp-' + digest(JSON.stringify(['ppc-ascm-sharepoint-v1', spSource.hostname, spSource.sitePath, spSource.driveId,
  spSource.listId, spSource.listItemId, spSource.itemUniqueId, spSource.versionLabel]));
const spReceipt = { sourceProvider: 'sharepoint', requestId: spId, acceptedRequestId: spId,
  source: { ...Object.fromEntries(['driveId', 'listId', 'listItemId', 'itemUniqueId', 'versionLabel'].map(k => [k, spSource[k]])), rawSha256: digest(workbook) },
  storageRevision: 7, alreadySaved: true, outcome: 'accepted', status: 'published', archiveAllowed: false, summary: { savedFields: 2, savedProducts: 1 } };
function sourceHarness(options = {}) {
  const calls = [];
  const handler = createAscmFlowHttpHandler({ env: { ...env, PPC_ASCM_START_AFTER: '', PPC_ASCM_APPROVED_REPORT: '{' }, now,
    invokeAscm: () => assert.fail('SharePoint must not invoke legacy mail route'),
    invokeSharePoint: async request => { calls.push('source'); assert.equal(new URL(request.url).pathname, '/functions/v1/ppc-master/api/master/ascmsharepoint');
      assert.equal(request.headers.get('X-PPC-ASCM-Secret'), env.PPC_ASCM_IMPORT_SECRET); assert.equal(request.headers.has('X-PPC-ASCM-Flow-Secret'), false);
      assert.deepEqual(await request.json(), spInput); return Response.json(options.receipt || spReceipt, { status: options.status || 200 }); },
    getPackageDelivery: () => ({ publicState: async () => { calls.push('public'); return { ...candidate, provider: 'sharepoint', publishedAt: candidate.createdAt, ...options.publication }; } }) });
  return { handler, calls };
}
test('SharePoint uses separate exact source receipt and fresh normal publication without mail policy or Archive', async () => {
  for (const outcome of ['accepted', 'equivalent']) {
    const expected = { ...spReceipt, outcome, ...(outcome === 'equivalent' ? { summary: { savedFields: 0, savedProducts: 0 } } : {}) };
    const h = sourceHarness({ receipt: { ...expected, private: 'never copy', summary: { ...expected.summary, private: 'never copy' } } });
    const response = await h.handler(req('/api/ascm/sharepoint/import', spInput));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), expected); assert.deepEqual(h.calls, ['source', 'public']);
  }
  for (const publication of [{ kind: 'seed' }, { kind: 'legacy_github' }, { storageRevision: 6 }, { provider: 'github' }, { publishedAt: 'invalid' }]) {
    const h = sourceHarness({ publication }); const response = await h.handler(req('/api/ascm/sharepoint/import', spInput));
    assert.equal(response.status, 202); assert.deepEqual(await response.json(), { ...spReceipt, status: 'publication_pending' });
  }
});
test('SharePoint input auth, schema, authority, stability and size refusals never construct source gateway', async () => {
  for (const input of [{ ...spInput, patch: [] }, { ...spInput, source: { ...spSource, hostname: 'other.sharepoint.com' } },
    { ...spInput, after: { ...spProof, eTag: 'changed' } }, { ...spInput, source: { ...spSource, listItemId: '908' } },
    { ...spInput, workbookBase64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }]) {
    const h = sourceHarness(); const response = await h.handler(req('/api/ascm/sharepoint/import', input));
    assert(response.status >= 400); assert.equal((await response.json()).archiveAllowed, false); assert.deepEqual(h.calls, []);
  }
  for (const options of [{ headers: { Origin: 'null' } }, { headers: { 'X-PPC-ASCM-Flow-Secret': 'wrong' } },
    { headers: { 'Content-Length': String(3 * 1024 * 1024 + 1) } }, { method: 'PUT' }, { headers: { 'X-PPC-Publisher-Secret': 'wrong' } }]) {
    const h = sourceHarness(); assert((await h.handler(req('/api/ascm/sharepoint/import', spInput, options))).status >= 400); assert.deepEqual(h.calls, []);
  }
});
test('SharePoint pending and safe holds never fabricate mail fields or grant completion', async () => {
  const pending = { ...spReceipt, status: 'publication_pending' };
  const h = sourceHarness({ receipt: pending, status: 202 }); const response = await h.handler(req('/api/ascm/sharepoint/import', spInput));
  assert.equal(response.status, 202); assert.deepEqual(await response.json(), pending); assert.deepEqual(h.calls, ['source']);
  const held = sourceHarness({ status: 409, receipt: { code: 'ASCM_REVIEW_REQUIRED', reviewReason: 'DATE_POLICY_REQUIRED', private: 'secret' } });
  const refused = await held.handler(req('/api/ascm/sharepoint/import', spInput)); assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { sourceProvider: 'sharepoint', requestId: spId, status: 'held', archiveAllowed: false,
    code: 'ASCM_REVIEW_REQUIRED', reviewReason: 'DATE_POLICY_REQUIRED' });
});
test('SharePoint rejects foreign or malformed native receipts before publication read', async () => {
  for (const change of [{ requestId: 'ascm-' + digest(workbook) }, { archiveAllowed: true }, { acceptedRequestId: '' },
    { acceptedRequestId: 'ascm-sp-' + 'd'.repeat(64) },
    { source: { ...spReceipt.source, rawSha256: 'd'.repeat(64) } }, { outcome: 'equivalent', summary: { savedFields: 1, savedProducts: 0 } },
    { alreadySaved: 'true' }, { status: 'unknown' }]) {
    const h = sourceHarness({ receipt: { ...spReceipt, ...change } }); const response = await h.handler(req('/api/ascm/sharepoint/import', spInput));
    assert.equal(response.status, 503); assert.equal((await response.json()).archiveAllowed, false); assert.deepEqual(h.calls, ['source']);
  }
});
