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
console.log('ASCM flow application passed: disabled/configuration/auth/origin/route/historical refusals and disabled connection reporting construct no master, package or reporter and perform no network access.');
