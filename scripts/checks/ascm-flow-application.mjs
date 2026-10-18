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
assert.deepEqual({ network, gateways, packages, reporters }, { network: 0, gateways: 0, packages: 0, reporters: 0 });
console.log('ASCM flow application passed: disabled/configuration/auth/origin/route refusals and disabled connection reporting construct no master, package or reporter and perform no network access.');
