import assert from 'node:assert/strict';
import { createAscmFlowApplication } from '../../supabase/functions/ppc-ascm-flow/bootstrap.mjs';

const base = 'https://syntheticproject.supabase.co';
const url = base + '/functions/v1/ppc-ascm-flow/api/ascm/import';
let network = 0, gateways = 0, packages = 0, reporters = 0;
const fail = () => { throw Error('Boundary must not construct business dependencies'); };
const dependencies = { fetchImpl: async () => { network++; return fail(); }, gatewayFactory: () => { gateways++; return fail(); },
  packageDeliveryFactory: () => { packages++; return fail(); }, connectionReporterFactory: () => { reporters++; return fail(); } };
const env = { SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'fixture-private', PPC_ASCM_FLOW_ENABLED: 'true',
  PPC_ASCM_FLOW_SECRET: 'w'.repeat(48), PPC_ASCM_IMPORT_SECRET: 'i'.repeat(48), PPC_PUBLISHER_SECRET: 'p'.repeat(48),
  PPC_PACKAGE_KEY_HASH: 'a'.repeat(64), PPC_ASCM_START_AFTER: '2026-09-30T00:00:00Z', PPC_PACKAGE_DELIVERY_ENABLED: 'true',
  PPC_PACKAGE_SP_DRIVE_ID: 'drive', PPC_PACKAGE_SP_FOLDER_ID: 'folder' };
assert.equal((await createAscmFlowApplication(dependencies)(new Request(url))).status, 404);
const app = createAscmFlowApplication({ ...dependencies, env, now: () => '2026-10-17T00:00:00Z' });
for (const request of [new Request(url), new Request(url, { method: 'POST', body: '{}' }), new Request(url + '?x=1', { method: 'POST', body: '{}' }),
  new Request(url, { method: 'POST', headers: { Origin: 'null', 'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET }, body: '{}' })]) {
  const response = await app(request); assert(response.status >= 400); assert.equal((await response.json()).archiveAllowed, false);
}
const connection = await app(new Request(base + '/functions/v1/ppc-ascm-flow/api/ascm/connection', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET }, body: JSON.stringify({ service: 'outlook', state: 'available' }) }));
assert.deepEqual(await connection.json(), { reported: false, archiveAllowed: false });
const report = { sender: 'linny.chen@hp.com', subject: 'ASCM Report Accessories HyperX Release Notification October 2026',
  receivedAt: '2026-09-30T09:01:09Z', messageId: 'exact-mail', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx', workbookBase64: Buffer.from('PK fixture workbook').toString('base64') };
const approval = { sourceSha256: '5382371536c4a64c5550c4447fe21e363454068b27022064fdcaf333175e5ffb', expiresAt: '2026-10-18T01:00:00Z' };
for (const [policy, value] of [[undefined, report], ['{', report], [JSON.stringify({ ...approval, expiresAt: '2026-10-16T01:00:00Z' }), report],
  [JSON.stringify(approval).padEnd(513, ' '), report], [JSON.stringify(approval), { ...report, messageId: 'other-mail' }]]) {
  const historical = createAscmFlowApplication({ ...dependencies, env: { ...env, PPC_ASCM_START_AFTER: '2026-10-01T00:00:00Z', PPC_ASCM_APPROVED_REPORT: policy },
    now: () => '2026-10-17T00:00:00Z' });
  const response = await historical(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
    'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET }, body: JSON.stringify(value) }));
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { code: 'ASCM_SOURCE_REJECTED', archiveAllowed: false });
  assert.deepEqual({ network, gateways, packages, reporters }, { network: 0, gateways: 0, packages: 0, reporters: 0 });
}
assert.deepEqual({ network, gateways, packages, reporters }, { network: 0, gateways: 0, packages: 0, reporters: 0 });
for (const [path, body, extra] of [
  ['/api/ascm/sharepoint/import', {}, {}],
  ['/api/ascm/sharepoint/import', { schemaVersion: 1, source: {}, before: {}, after: {}, workbookBase64: 'UEs=' }, {}],
  ['/api/ascm/sharepoint/import?next=other', {}, {}],
  ['/api/ascm/publication/prepare', { prepareKey: 'a'.repeat(64), ref: 'main' }, {}],
  ['/api/ascm/publication/prepare', { prepareKey: 'A'.repeat(64) }, {}],
  ['/api/ascm/sharepoint/import', {}, { 'X-PPC-Publisher-Secret': 'forbidden' }],
]) {
  const sourceApp = createAscmFlowApplication({ ...dependencies, env: { ...env, PPC_ASCM_START_AFTER: '', PPC_ASCM_APPROVED_REPORT: '{' } });
  const response = await sourceApp(new Request(base + '/functions/v1/ppc-ascm-flow' + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET, ...extra }, body: JSON.stringify(body) }));
  assert(response.status >= 400); assert.equal((await response.json()).archiveAllowed, false);
  assert.deepEqual({ network, gateways, packages, reporters }, { network: 0, gateways: 0, packages: 0, reporters: 0 });
}
const projection = { version: 1, action: 'prepare', requestedRevision: 8, publishedRevision: 7, generation: 2, prepareKey: 'a'.repeat(64),
  retryAt: null, intent: { kind: 'ordinary', ownerImagesCommit: null }, candidate: null, binaryPath: null, holdCode: null, archiveAllowed: false };
const controlCalls = [];
const controlApp = createAscmFlowApplication({ env: { ...env, PPC_ASCM_START_AFTER: '' }, gatewayFactory: fail, connectionReporterFactory: fail,
  fetchImpl: async (url, options) => { controlCalls.push([url, JSON.parse(options.body)]); return Response.json(projection); } });
const controlResponse = await controlApp(new Request(base + '/functions/v1/ppc-ascm-flow/api/ascm/publication/queued', {
  headers: { 'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET } }));
assert.equal(controlResponse.status, 200);
assert.deepEqual(await controlResponse.json(), { ...projection, action: 'held', prepareKey: null, intent: null, holdCode: 'PUBLISHER_NOT_CONFIGURED' });
assert.deepEqual(controlCalls, [[base + '/rest/v1/rpc/ppc_package_control', { payload: {} }]], 'actual lazy package/RPC wiring makes exactly one metadata call');
const table = [['Exported', '2026-09-30T03:53:45'], ['Category', 'Base PN', 'GPG 40 char AMO Description', 'GA - General Availability', 'EM - End of Manufacturing'],
  ['Headset', 'A1AAA', 'HyperX Cloud III BLK GAM HS', '2026-01-15', '2029-12-31']];
const rows = table.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`).join('');
const entries = {
  '[Content_Types].xml': '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
  'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ASCM" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
};
const sourceBytes = await globalThis.PortfolioPackage.createZip(Object.entries(entries).map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })));
const source = { provider: 'sharepoint', hostname: 'hp.sharepoint.com', sitePath: '/teams/IPSG_SCM_and_Product_Requirements_Info',
  driveId: 'b!Dxcy8q8LE0GivbyM3D6Dq5C5iXHjfxBMsvQrwTpLknS0JFIuvvhlQoilkLMqZkl9', listId: '2e5224b4-f8be-4265-88a5-90b32a66497d', listItemId: 908,
  itemUniqueId: 'e5cb1d81-7071-40b6-93cb-86ef0b577f52', versionLabel: '2.0', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx',
  relativePath: '(09) September 2026/ASCM Report_HyperX_2026-09-30.xlsx', eTag: '"fixture-2"', createdAt: '2026-09-30T09:00:46Z', lastModifiedAt: '2026-10-07T07:44:51Z', bytes: sourceBytes.length };
const proof = Object.fromEntries(['listItemId', 'itemUniqueId', 'versionLabel', 'eTag', 'bytes'].map(k => [k, source[k]]));
const sourceCalls = [];
const sourceApp = createAscmFlowApplication({ env: { ...env, PPC_ASCM_START_AFTER: '' }, fetchImpl: async (url, options) => {
  sourceCalls.push([url, JSON.parse(options.body)]);
  if (url === base + '/rest/v1/rpc/ppc_master_rate') return Response.json({ allowed: true });
  if (url === base + '/rest/v1/rpc/ppc_master_ascm_sharepoint_read') return Response.json({ manifest: null });
  assert.fail('unrecognized source transport ' + url);
} });
const sourceResponse = await sourceApp(new Request(base + '/functions/v1/ppc-ascm-flow/api/ascm/sharepoint/import', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET },
  body: JSON.stringify({ schemaVersion: 1, source, before: proof, after: proof, workbookBase64: Buffer.from(sourceBytes).toString('base64') }) }));
assert.equal(sourceResponse.status, 503, 'uninitialized source state is safely unavailable through the actual application/gateway/API/RPC chain');
const sourceHeld = await sourceResponse.json(); assert.equal(sourceHeld.sourceProvider, 'sharepoint'); assert.equal(sourceHeld.archiveAllowed, false);
assert.deepEqual(sourceCalls.map(([url]) => url), ['ppc_master_rate', 'ppc_master_ascm_sharepoint_read'].map(name => base + '/rest/v1/rpc/' + name));
assert.deepEqual(Object.keys(sourceCalls[1][1].payload), ['requestId']); assert.match(sourceCalls[1][1].payload.requestId, /^ascm-sp-[a-f0-9]{64}$/);
console.log('ASCM flow application passed: refusals initialize no business dependencies; actual package/RPC control makes one metadata call; actual application/gateway/SharePoint API/RPC chain reaches only fixed source operations using local fake transport.');
