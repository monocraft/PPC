import assert from 'node:assert/strict';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createAscmMcpApplication } from '../../supabase/functions/ppc-ascm-mcp/bootstrap.mjs';
import { createMasterGateway } from '../../supabase/functions/ppc-master/gateway.mjs';

let network = 0, gateways = 0;
const dependencies = { createMcpHandler, McpServer, z, fetchImpl: async () => { network++; throw Error('No outbound fixture access.'); },
  gatewayFactory: () => { gateways++; throw Error('No business-data fixture access.'); } };
const base = 'https://abcdefghijklmnopqrst.supabase.co';
const resource = `${base}/functions/v1/ppc-ascm-mcp/mcp`;
const disabled = createAscmMcpApplication({ ...dependencies });
assert.equal((await disabled(new Request(resource))).status, 404);
const configured = createAscmMcpApplication({ ...dependencies, env: {
  SUPABASE_URL: base, PPC_ASCM_MCP_ENABLED: 'true', PPC_ASCM_MCP_RESOURCE: resource,
  PPC_ASCM_MCP_OWNER_ID: '11111111-1111-4111-8111-111111111111', PPC_ASCM_MCP_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
  PPC_ASCM_MCP_DOWNLOAD_ORIGIN: 'https://sdmntprcentralusdr.oaiusercontent.com', PPC_ASCM_START_AFTER: '2026-09-30T00:00:00Z',
  PPC_ASCM_IMPORT_SECRET: 'synthetic-import-credential-'.padEnd(48, 'x'),
}, now: () => '2026-10-17T23:00:00Z' });
assert.equal((await configured(new Request(`${resource}/oauth-protected-resource`))).status, 200);
const refused = await configured(new Request(resource, { method: 'POST', body: '{}' }));
assert.equal(refused.status, 401); assert.equal((await refused.json()).archiveAllowed, false);
assert.equal(network, 0); assert.equal(gateways, 0, 'discovery/refusals do not initialize or call the master gateway');
console.log('ASCM MCP application wiring passed: disabled defaults, configured discovery and auth refusal without network or master initialization.');

// Exercise the complete boundary with a real signed token, generated XLSX,
// strict parser and gateway/receipt implementation. Only persistence is fake.
const clock = Date.parse('2026-10-17T23:00:00Z') / 1000;
const owner = '11111111-1111-4111-8111-111111111111', client = '22222222-2222-4222-8222-222222222222';
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'integration', alg: 'ES256', use: 'sig' };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const signingInput = b64({ alg: 'ES256', kid: 'integration', typ: 'JWT' }) + '.' + b64({ iss: base + '/auth/v1', aud: resource,
  sub: owner, client_id: client, role: 'authenticated', is_anonymous: false, iat: clock - 1, exp: clock + 3600 });
const bearer = signingInput + '.' + Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(signingInput))).toString('base64url');
const columns = [
  ['Category', 'Base PN', 'GPG 40 char AMO Description', 'GA - General Availability', 'EM - End of Manufacturing'],
  ['Headset', 'A1AAA', 'HyperX Cloud III BLK GAM HS', '2026-01-15', '2029-12-31'],
];
const rows = columns.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`).join('');
const entries = {
  '[Content_Types].xml': '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
  'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ASCM" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
};
const workbook = await globalThis.PortfolioPackage.createZip(Object.entries(entries).map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })));
let manifest = { version: 4, imageAssets: [], custom: { keep: true }, categories: [{ id: 'pc-gaming-audio', name: 'PC gaming audio', board: {
  lanes: [{ id: 'wired', title: 'Wired' }], products: [{ id: 'cloud-iii', name: 'Cloud III', laneId: 'wired', order: 8,
    generalAvailabilityDate: '2026-01-15', endManufacturingDate: '2029-12-31', ascm: { basePartNumbers: ['A1AAA'] },
    specs: [{ id: 'spec-1', label: 'Driver', value: '53 mm' }], partSkus: [], variantGroups: [], price: 99 }] } }] };
let revision = 1, published = 1, commits = 0, reads = 0, gatewayConstructions = 0;
const receipts = new Map();
const rpc = async (operation, payload) => {
  if (operation === 'rate') return { allowed: true };
  if (operation === 'read') {
    reads++;
    return { manifest: structuredClone(manifest), storageRevision: revision, publication: { publishedRevision: published },
      ...(receipts.has(payload.requestId) ? { receipt: receipts.get(payload.requestId) } : {}) };
  }
  assert.equal(operation, 'commit'); assert.equal(payload.expectedRevision, revision);
  commits++; manifest = structuredClone(payload.manifest); if (payload.changed) revision++;
  receipts.set(payload.requestId, { fingerprint: payload.fingerprint, storageRevision: revision, savedFields: payload.savedFields, savedProducts: payload.savedProducts });
  return { status: 'saved' };
};
const downloadUrl = 'https://sdmntprcentralusdr.oaiusercontent.com/files/12345678-1234-4234-8234-123456789abc/raw?se=2026-10-18T00%3A00%3A00Z&sig=fixture';
const environment = { SUPABASE_URL: base, PPC_ASCM_MCP_ENABLED: 'true', PPC_ASCM_MCP_RESOURCE: resource,
  PPC_ASCM_MCP_OWNER_ID: owner, PPC_ASCM_MCP_CLIENT_ID: client, PPC_ASCM_MCP_DOWNLOAD_ORIGIN: 'https://sdmntprcentralusdr.oaiusercontent.com',
  PPC_ASCM_START_AFTER: '2026-09-30T00:00:00Z', PPC_ASCM_IMPORT_SECRET: 'synthetic-import-secret-'.padEnd(48, 'x'),
  PPC_PACKAGE_KEY_HASH: 'a'.repeat(64), PPC_PUBLISHER_SECRET: 'p'.repeat(48) };
const complete = createAscmMcpApplication({ createMcpHandler, McpServer, z, env: environment, now: () => new Date(clock * 1000).toISOString(),
  fetchImpl: async (url, options) => {
    assert.equal(options.headers?.Authorization, undefined);
    if (url === base + '/auth/v1/.well-known/jwks.json') return Response.json({ keys: [jwk] });
    assert.equal(url, downloadUrl); return new Response(workbook);
  }, gatewayFactory: options => { gatewayConstructions++; return createMasterGateway({ ...options, rpc }); } });
const report = { sender: 'linny.chen@hp.com', subject: 'ASCM Report Accessories HyperX Release Notification October 2026', receivedAt: '2026-09-30T09:01:09Z',
  messageId: 'integration-exact-mail', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx', workbook: { download_url: downloadUrl, file_id: 'opaque-fixture-file' } };
async function submit(argumentsValue = report, expectError = false, toolName = 'import_ascm_report') {
  const response = await complete(new Request(resource, { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: argumentsValue } }) }));
  assert.equal(response.status, 200);
  const text = await response.text();
  const body = response.headers.get('Content-Type')?.includes('application/json') ? JSON.parse(text) : JSON.parse(text.split('\n').find(line => line.startsWith('data: ')).slice(6));
  assert(!body.error && body.result && Boolean(body.result.isError) === expectError, text);
  return body.result.structuredContent;
}
assert.deepEqual(await submit({ service: 'outlook', state: 'reconnect_required' }, false, 'report_connection_state'), { reported: false });
assert.equal(gatewayConstructions, 0, 'disabled connection reporting does not initialize the business gateway');
assert.equal(reads, 0);
const initial = await submit();
assert.equal(initial.status, 'publication_pending'); assert.equal(initial.archiveAllowed, false);
assert.equal(initial.sourceMessageId, report.messageId); assert.equal(initial.summary.savedProducts, 1);
assert.equal(commits, 1); assert.equal(gatewayConstructions, 1); assert(reads >= 2);
assert.equal(manifest.categories[0].board.products[0].price, 99); assert.equal(manifest.categories[0].board.products[0].order, 8);
assert.deepEqual(manifest.custom, { keep: true });
published = revision;
const replay = await submit();
assert.equal(replay.status, 'published'); assert.equal(replay.archiveAllowed, true); assert.equal(replay.alreadySaved, true);
assert.equal(replay.requestId, initial.requestId); assert.equal(replay.storageRevision, initial.storageRevision);
assert.equal(commits, 1, 'an accepted exact workbook is not committed again');
assert.equal(gatewayConstructions, 1, 'the in-process gateway is reused only after authenticated import');
const held = await submit({ ...report, subject: 'ASCM Review Notification October 2026' }, true);
assert.equal(held.archiveAllowed, false); assert.equal(commits, 1);
console.log('ASCM MCP application integration passed: signed OAuth token → attachment → real XLSX import → immutable receipt → publication-gated replay, with no outbound services.');
