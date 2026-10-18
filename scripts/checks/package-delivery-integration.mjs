import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createPackageDelivery } from '../../supabase/functions/ppc-package/core.mjs';
import { createAscmMcpApplication } from '../../supabase/functions/ppc-ascm-mcp/bootstrap.mjs';
import { createAscmFlowApplication } from '../../supabase/functions/ppc-ascm-flow/bootstrap.mjs';
import { createMasterGateway, sha256 } from '../../supabase/functions/ppc-master/gateway.mjs';
import { harness, portfolioFixture, packageBytes } from './package-workspace.mjs';

// Compose real SQL, API, signed OAuth/SDK tools and browser import. Only object
// persistence and the allowlisted artifact transport are synthetic. Unrecognized
// URLs fail locally; this check never connects to an external service.
if (process.env.PPC_REQUIRE_SQL_TESTS === '1' && !process.env.PPC_TEST_PGLITE_MODULE) throw Error('Required SQL integration needs PPC_TEST_PGLITE_MODULE.');
const { PGlite } = await import(process.env.PPC_TEST_PGLITE_MODULE ? pathToFileURL(resolve(process.env.PPC_TEST_PGLITE_MODULE)).href : '@electric-sql/pglite');
const db = new PGlite();
const base = 'https://abcdefghijklmnopqrst.supabase.co';
const resource = `${base}/functions/v1/ppc-ascm-mcp/mcp`;
const endpoint = `${base}/functions/v1/ppc-package/api/package/latest`;
const owner = '11111111-1111-4111-8111-111111111111';
const client = '22222222-2222-4222-8222-222222222222';
const sourceSha = 'a'.repeat(40);
const codec = globalThis.PortfolioPackage;
const reader = globalThis.PortfolioPackageClient;
const key = codec.generateKey();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fixed = new Date();
const clock = Math.floor(fixed.getTime() / 1000);
const now = () => fixed.toISOString();
const objects = new Map(), artifacts = new Map(), confirmedInputs = new Map();
let storageReads = 0, storageWrites = 0, artifactReads = 0;
let afterUpload = null;
const chunked = bytes => new ReadableStream({
  start(controller) { for (let offset = 0; offset < bytes.length; offset += 4096) controller.enqueue(bytes.slice(offset, offset + 4096)); controller.close(); },
});
const env = { SUPABASE_URL: base, PPC_ASCM_MCP_ENABLED: 'true', PPC_ASCM_MCP_RESOURCE: resource,
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-credential-never-transmitted',
  PPC_ASCM_MCP_OWNER_ID: owner, PPC_ASCM_MCP_CLIENT_ID: client,
  PPC_ASCM_MCP_DOWNLOAD_ORIGIN: 'https://sdmntprcentralusdr.oaiusercontent.com', PPC_ASCM_START_AFTER: '2026-09-01T00:00:00Z',
  PPC_ASCM_IMPORT_SECRET: 'synthetic-import-'.padEnd(48, 'i'), PPC_PUBLISHER_SECRET: 'synthetic-publisher-'.padEnd(48, 'p'),
  PPC_PACKAGE_DELIVERY_ENABLED: 'true', PPC_PACKAGE_SP_DRIVE_ID: 'fixture-drive', PPC_PACKAGE_SP_FOLDER_ID: 'fixture-folder',
  PPC_PACKAGE_KEY_HASH: await sha256(key), PPC_ALLOWED_ORIGINS: 'http://127.0.0.1:4190' };

const masterNames = new Set(['read', 'rate', 'commit', 'bootstrap', 'ack', 'failure']);
const packageNames = new Set(['reserve', 'upload_claim', 'upload_result', 'finalize', 'confirm', 'current', 'cleanup', 'phase']);
const sqlCall = async (prefix, names, operation, payload = {}) => {
  assert(names.has(operation), 'Only known fixture RPCs may execute');
  return (await db.query(`select public.${prefix}_${operation}($1::jsonb) as result`, [JSON.stringify(payload)])).rows[0].result;
};
const master = (op, payload) => sqlCall('ppc_master', masterNames, op, payload);
const database = (op, payload) => op === 'rate' ? master(op, payload) : sqlCall('ppc_package', packageNames, op, payload);
const storage = {
  async uploadObject(candidate, stream, { signal } = {}) {
    assert(!objects.has(candidate.objectKey), 'Object creation must not overwrite');
    const body = stream.getReader(), chunks = []; let bytes = 0;
    try { for (;;) { assert(!signal?.aborted); const part = await body.read(); if (part.done) break; chunks.push(part.value); bytes += part.value.length; } }
    finally { body.releaseLock(); }
    const result = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    objects.set(candidate.objectKey, result); storageWrites++; await afterUpload?.(); return { stored: true };
  },
  async openObject(candidate) {
    storageReads++;
    const bytes = objects.get(candidate.objectKey);
    return bytes ? new Response(chunked(bytes), { headers: { 'Content-Length': String(bytes.length) } }) : new Response(null, { status: 404 });
  },
  async signDownload(candidate) { return `${base}/storage/v1/object/sign/ppc-package-delivery/${candidate.objectKey}?token=fixture-read`; },
  async removeObject(candidate) { objects.delete(candidate.objectKey); return { absent: true }; },
};
const delivery = createPackageDelivery({ env, database, storage, now });
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'delivery-integration', alg: 'ES256', use: 'sig' };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function token(overrides = {}) {
  const input = b64({ alg: 'ES256', kid: jwk.kid, typ: 'JWT' }) + '.' + b64({ iss: base + '/auth/v1', aud: resource,
    sub: owner, client_id: client, role: 'authenticated', is_anonymous: false, iat: clock - 1, exp: clock + 3600, ...overrides });
  return input + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(input))).toString('base64url');
}
const bearer = await token();
const transport = async (url, options) => {
  const headers = new Headers(options.headers);
  for (const name of ['authorization', 'apikey', 'x-ppc-publisher-secret', 'x-ppc-ascm-secret']) assert.equal(headers.has(name), false, 'No PPC credentials enter artifact/JWKS requests');
  for (const secret of [key, env.SUPABASE_SERVICE_ROLE_KEY, env.PPC_PUBLISHER_SECRET, env.PPC_ASCM_IMPORT_SECRET]) assert.equal(JSON.stringify([...headers]).includes(secret), false);
  assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
  if (url === base + '/auth/v1/.well-known/jwks.json') return Response.json({ keys: [jwk] });
  assert(artifacts.has(url), 'Outbound fixture transport is allowlisted'); artifactReads++;
  const bytes = artifacts.get(url);
  return new Response(chunked(bytes), { headers: { 'Content-Length': String(bytes.length), 'Content-Type': 'application/octet-stream' } });
};
const app = createAscmMcpApplication({ createMcpHandler, McpServer, z, env, now, fetchImpl: transport,
  gatewayFactory: options => createMasterGateway({ ...options, rpc: master }), packageDeliveryFactory: () => delivery });
const flowEnv = { ...env, PPC_ASCM_FLOW_ENABLED: 'true', PPC_ASCM_FLOW_SECRET: 'native-flow-'.padEnd(48, 'w') };
const flow = createAscmFlowApplication({ env: flowEnv, now, fetchImpl: async () => { throw Error('Native worker must not fetch external artifact/JWKS URLs'); },
  gatewayFactory: options => createMasterGateway({ ...options, rpc: master }), packageDeliveryFactory: () => delivery });
async function flowCall(path, body = {}, { raw = false, headers = {}, status = 200, method = 'POST' } = {}) {
  const response = await flow(new Request(base + '/functions/v1/ppc-ascm-flow' + path, { method,
    headers: { 'X-PPC-ASCM-Flow-Secret': flowEnv.PPC_ASCM_FLOW_SECRET, 'Content-Type': raw ? 'application/octet-stream' : 'application/json', ...headers },
    ...(method === 'GET' ? {} : { body: raw ? chunked(body) : JSON.stringify(body), ...(raw ? { duplex: 'half' } : {}) }) }));
  assert.equal(response.status, status); return response;
}
const flowImport = async (report, status = 200) => (await flowCall('/api/ascm/import', report, { status })).json();
async function nativePublish(candidate, bytes) {
  const queued = await (await flowCall('/api/ascm/publication/queued')).json();
  assert.equal(queued.candidate.candidateId, candidate.candidateId); assert.equal(queued.archiveAllowed, false);
  assert(!JSON.stringify(queued).includes('storage/')); assert.equal(queued.downloadUrl, undefined);
  const download = await flowCall(queued.binaryPath, null, { method: 'GET', headers: { 'X-PPC-Package-Generation': String(candidate.generation) } });
  const transferred = new Uint8Array(await download.arrayBuffer()); assert.equal(digest(transferred), digest(bytes));
  // This map is the isolated native SharePoint fixture; readback is a separate
  // actual item-content read rather than a direct candidate-download token.
  const sharepoint = new Map([[queued.candidate.fileName, transferred.slice()]]);
  const readback = sharepoint.get(queued.candidate.fileName).slice();
  const headers = { 'Content-Length': String(bytes.length), 'X-PPC-Package-Generation': String(candidate.generation),
    'X-PPC-SP-Drive-Id': 'fixture-drive', 'X-PPC-SP-Folder-Id': 'fixture-folder', 'X-PPC-SP-Item-Id': `native-${candidate.candidateId}`,
    'X-PPC-SP-Version-Id': '1.0', 'X-PPC-SP-File-Name': queued.candidate.fileName };
  const corrupt = readback.slice(); corrupt[corrupt.length - 1] ^= 1;
  assert.equal((await (await flowCall(`/api/ascm/publication/${candidate.candidateId}/confirm`, corrupt, { raw: true, headers, status: 409 })).json()).archiveAllowed, false);
  assert.notEqual((await database('current', {})).current.candidateId, candidate.candidateId, 'Changed readback cannot create a publication receipt');
  const confirmed = await (await flowCall(`/api/ascm/publication/${candidate.candidateId}/confirm`, readback, { raw: true, headers })).json();
  assert.equal(confirmed.status, 'published'); assert.equal(confirmed.archiveAllowed, false);
  return { headers, readback };
}
async function callTool(name, args = {}, { credential = bearer, error = false, status = 200 } = {}) {
  const response = await app(new Request(resource, { method: 'POST', headers: { Authorization: `Bearer ${credential}`,
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }));
  assert.equal(response.status, status);
  if (status !== 200) return response;
  const text = await response.text();
  const result = response.headers.get('Content-Type')?.includes('application/json') ? JSON.parse(text) : JSON.parse(text.split('\n').find(line => line.startsWith('data: ')).slice(6));
  assert(!result.error && result.result && Boolean(result.result.isError) === error, text);
  return result.result.structuredContent;
}
const rawUrl = () => `https://sdmntprcentralusdr.oaiusercontent.com/files/${randomUUID()}/raw?se=${encodeURIComponent(new Date((clock + 3600) * 1000).toISOString())}&sig=fixture`;
async function reserve(bytes, { seed = false, ownerImagesCommit = null } = {}) {
  const current = await database('current', {}), state = await master('read', {});
  const metadata = { candidateId: randomUUID(), expectedGeneration: current.current?.generation || 0,
    storageRevision: state.storageRevision, sourceSha, manifestSha256: seed ? null : state.acceptedManifestSha256,
    ownerImagesCommit, sha256: digest(bytes), bytes: bytes.length, ...(seed ? { trustedGithubSha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') } : {}) };
  const reserved = await delivery.publisher(seed ? 'seed' : 'reserve', metadata);
  assert.equal(reserved.status, 'reserved'); return reserved.candidate;
}
async function stage(bytes, options) {
  const candidate = await reserve(bytes, options);
  const request = new Request(`${base}/functions/v1/ppc-package/api/package/candidates/${candidate.candidateId}/bytes`, { method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'X-PPC-Candidate-Generation': String(candidate.generation) }, body: chunked(bytes), duplex: 'half' });
  await delivery.upload(request, candidate.candidateId);
  const finalized = await delivery.publisher('finalize', { candidateId: candidate.candidateId, generation: candidate.generation });
  assert.equal(finalized.status, 'ready'); return finalized.candidate;
}
async function publish(candidate, bytes) {
  const queued = await callTool('get_queued_publication');
  assert.equal(queued.candidate.candidateId, candidate.candidateId);
  assert.equal(queued.candidate.sha256, digest(bytes));
  const url = rawUrl(); artifacts.set(url, bytes);
  const args = { candidateId: candidate.candidateId, generation: candidate.generation,
    item: { driveId: 'fixture-drive', folderId: 'fixture-folder', itemId: `connector-${candidate.candidateId}`, versionId: candidate.kind === 'seed' ? '4.0' : '1.0',
      fileName: candidate.kind === 'seed' ? 'master_ppc.pkg' : `master-r${candidate.storageRevision}-g${candidate.generation}-${candidate.candidateId}.pkg` },
    readback: { download_url: url, file_id: `file-${candidate.candidateId}`, mime_type: 'application/octet-stream', file_name: candidate.kind === 'seed' ? 'master_ppc.pkg' : `master-r${candidate.storageRevision}-g${candidate.generation}-${candidate.candidateId}.pkg` } };
  const result = await callTool('confirm_sharepoint_publication', args);
  confirmedInputs.set(candidate.candidateId, args);
  assert.equal(result.status, 'published');
  assert.equal((await callTool('confirm_sharepoint_publication', args)).status, 'already_published', 'Lost confirmation reply reuses the exact immutable receipt');
  return result;
}

try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key,bucket_id text); alter table storage.objects enable row level security;');
  for (const name of (await readdir(resolve('supabase/migrations'))).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(resolve('supabase/migrations', name), 'utf8'));
  const manifest = portfolioFixture('Cloud III', ['shared-image', 'variant-image']);
  const product = manifest.categories[0].board.products[0];
  product.ascm = { basePartNumbers: ['A1AAA'] }; product.price = 99;
  product.generalAvailabilityDate = '2026-01-15'; product.endManufacturingDate = '2029-12-31';
  for (const asset of manifest.imageAssets) asset.packagePath = `images/${asset.id}.png`;
  const seedBytes = await codec.encrypt(packageBytes(manifest), key);
  const blobSha = createHash('sha1').update(`blob ${seedBytes.length}\0`).update(seedBytes).digest('hex');
  await master('bootstrap', { manifest, sourceSha, fingerprint: digest(seedBytes) });
  await master('ack', { storageRevision: 1, githubSha: blobSha });
  await database('phase', { phase: 'seeding', driveId: 'fixture-drive', folderId: 'fixture-folder', seed: { storageRevision: 1, sourceSha, githubSha: blobSha, sha256: digest(seedBytes), bytes: seedBytes.length } });

  for (const claims of [{ sub: randomUUID() }, { client_id: randomUUID() }, { aud: base }, { exp: clock - 1 }]) {
    await callTool('get_queued_publication', {}, { credential: await token(claims), status: 401 });
  }
  assert.equal(storageReads, 0); assert.equal(storageWrites, 0); assert.equal(artifactReads, 0);
  const seedCandidate = await stage(seedBytes, { seed: true });
  await publish(seedCandidate, seedBytes);
  await database('phase', { phase: 'sharepoint' });

  const columns = [['Category', 'Base PN', 'GPG 40 char AMO Description', 'GA - General Availability', 'EM - End of Manufacturing'],
    ['Headset', 'A1AAA', 'HyperX Cloud III BLK GAM HS', '2026-01-15', '2029-12-31']];
  const rows = columns.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`).join('');
  const workbook = codec.createZip(Object.entries({
    '[Content_Types].xml': '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ASCM" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  }).map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })));
  const reportUrl = rawUrl(); artifacts.set(reportUrl, workbook);
  const report = { sender: 'linny.chen@hp.com', subject: 'ASCM Report Accessories HyperX Release Notification October 2026',
    receivedAt: '2026-09-30T09:01:09Z', messageId: 'integration-exact-message', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx',
    workbook: { download_url: reportUrl, file_id: 'file-workbook' } };
  const { workbook: artifact, ...mailEnvelope } = report;
  const nativeReport = { ...mailEnvelope, workbookBase64: Buffer.from(workbook).toString('base64') };
  const accepted = await flowImport(nativeReport, 202);
  assert.equal(accepted.archiveAllowed, false); assert.equal(accepted.status, 'publication_pending');
  assert.equal(accepted.sourceMessageId, report.messageId);
  const state = await master('read', {});
  assert.equal(state.manifest.categories[0].board.products[0].price, 99);
  assert.equal((await master('ack', { storageRevision: state.storageRevision, githubSha: 'f'.repeat(40) })).status, 'delivery_managed');
  assert.equal((await callTool('import_ascm_report', report)).archiveAllowed, false, 'Old Git ack cannot unlock Archive');
  assert.equal((await flowImport(nativeReport, 202)).archiveAllowed, false, 'Seed/Git publication cannot grant native Archive');
  const bytes = await codec.encrypt(packageBytes(state.manifest), key);
  const candidate = await stage(bytes);
  const nativeConfirmed = await nativePublish(candidate, bytes);
  const replay = await flowImport(nativeReport);
  assert.equal(replay.archiveAllowed, true); assert.equal(replay.alreadySaved, true);
  assert.equal(replay.requestId, accepted.requestId); assert.equal(replay.sourceMessageId, report.messageId);
  assert.equal(replay.requestId, 'ascm-' + digest(workbook));
  assert.equal((await callTool('import_ascm_report', report)).archiveAllowed, true, 'Existing OAuth MCP import remains compatible');

  let identity;
  const downloaded = await reader.downloadLatest({ endpoint, key, onIdentity: value => { identity = value; }, fetchImpl: async (url, options) => {
    assert.equal(url, endpoint); return delivery.reader(new Request(url, options));
  } });
  assert.equal(digest(downloaded), digest(bytes)); assert.equal(identity.generation, candidate.generation);
  const subject = harness();
  await subject.sandbox.importProjectPackage(new Blob([downloaded]), { key, requireEncrypted: true, fromSharedDownload: true, deliveryIdentity: identity });
  assert.equal(subject.sandbox.portfolio.loadedPackageInfo.version, 2);
  assert.equal(subject.sandbox.portfolio.loadedPackageInfo.sha256, digest(bytes));
  const imported = subject.sandbox.portfolio.categories[0].board.products[0];
  assert.equal(imported.price, 99); assert.equal(imported.specs[0].value, 'Long values remain intact');
  assert.equal(await subject.images.get(imported.imageAssetId).text(), 'bytes:shared-image');
  assert.equal(await subject.images.get(imported.variantGroups[0].items[0].imageAssetId).text(), 'bytes:variant-image');

  // An image-only publication has a new generation without inventing a save.
  const imageBytes = await codec.encrypt(packageBytes(state.manifest), key);
  const imageCandidate = await stage(imageBytes, { ownerImagesCommit: 'c'.repeat(40) });
  assert.equal(imageCandidate.storageRevision, candidate.storageRevision);
  assert.equal(imageCandidate.generation, candidate.generation + 1);
  await publish(imageCandidate, imageBytes);
  const oldReplay = await (await flowCall(`/api/ascm/publication/${candidate.candidateId}/confirm`, nativeConfirmed.readback, { raw: true, headers: nativeConfirmed.headers })).json();
  assert.equal(oldReplay.status, 'already_published', 'A historical exact confirmation remains retryable after current advances');
  assert.equal(oldReplay.publication.candidateId, candidate.candidateId);
  const seedReplay = await callTool('confirm_sharepoint_publication', confirmedInputs.get(seedCandidate.candidateId));
  assert.equal(seedReplay.status, 'already_published'); assert.equal(seedReplay.publication.kind, 'seed');
  assert.equal((await database('current', {})).current.candidateId, imageCandidate.candidateId, 'Historical retry cannot replace newer current');

  // Let an owned write finish after its candidate expires. No operation may
  // delete its object or open another extra slot while that write is unsettled.
  let started, release;
  const began = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  afterUpload = () => { started(); return blocked; };
  const lateBytes = await codec.encrypt(packageBytes(state.manifest), key);
  const late = await reserve(lateBytes);
  const lateRequest = new Request(`${base}/functions/v1/ppc-package/api/package/candidates/${late.candidateId}/bytes`, { method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(lateBytes.length), 'X-PPC-Candidate-Generation': String(late.generation) }, body: chunked(lateBytes), duplex: 'half' });
  const uploading = delivery.upload(lateRequest, late.candidateId);
  try {
    await Promise.race([began, uploading.then(() => { throw Error('The fixture upload completed before its barrier'); })]);
    await db.query("update ppc_private.package_delivery_candidates set created_at=now()-interval '3 hours 1 second',expires_at=now()-interval '1 second' where candidate_id=$1::uuid", [late.candidateId]);
    await delivery.publisher('current', {});
    assert(objects.has(late.objectKey), 'Expiry must not delete an unsettled write');
    const held = await database('current', {});
    assert.equal(held.cleanup.candidateId, late.candidateId); assert.equal(held.cleanupUpload.state, 'uploading');
    const refused = await database('reserve', { candidateId: randomUUID(), expectedGeneration: imageCandidate.generation,
      storageRevision: state.storageRevision, sourceSha, manifestSha256: state.acceptedManifestSha256, ownerImagesCommit: null, sha256: digest(lateBytes), bytes: lateBytes.length });
    assert.equal(refused.status, 'cleanup_required'); assert(objects.size <= 2);
  } finally { release(); await uploading; afterUpload = null; }
  await delivery.publisher('current', {});
  assert(!objects.has(late.objectKey));
  assert.equal((await database('current', {})).current.candidateId, imageCandidate.candidateId);
  assert(objects.size <= 2, 'Current plus at most one extra object');
  console.log('Package delivery integration passed: native worker + signed OAuth → real XLSX/SQL receipt → exact queued encrypted stream → native SharePoint byte readback/CAS and immutable historical retry → browser integrity/transaction/images → exact-message digest-bound Archive gate; no external services.');
} finally { await db.close(); }
