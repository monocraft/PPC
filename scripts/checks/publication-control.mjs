import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPackageDelivery, validatePublicationPreparation } from '../../supabase/functions/ppc-package/core.mjs';
import { createPackageDeliveryRpc } from '../../supabase/functions/ppc-package/rpc.mjs';
import { createAscmFlowHttpHandler } from '../../supabase/functions/ppc-ascm-flow/http.mjs';

let dispatcherModule;
try { dispatcherModule = await import('../../supabase/functions/ppc-master/publication-dispatch.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof dispatcherModule?.createPublicationDispatcher, 'function', 'fixed publication dispatch must be implemented');
const { createPublicationDispatcher } = dispatcherModule;
globalThis.fetch = () => { throw Error('Outbound network forbidden'); };
const key = 'a'.repeat(64), attemptId = 'abcdefab-1234-4567-89ab-123456789abc';
const now = () => '2026-10-18T12:00:00.000Z';
const retryAt = '2026-10-18T12:15:00.000Z';
const env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private-fixture',
  PPC_PACKAGE_DELIVERY_ENABLED: 'true', PPC_ASCM_FLOW_ENABLED: 'true', PPC_ASCM_FLOW_SECRET: 'w'.repeat(48),
  PPC_ASCM_IMPORT_SECRET: 'i'.repeat(48), PPC_PUBLISHER_SECRET: 'p'.repeat(48), PPC_PACKAGE_KEY_HASH: 'b'.repeat(64),
  PPC_PACKAGE_SP_DRIVE_ID: 'drive', PPC_PACKAGE_SP_FOLDER_ID: 'folder', PPC_GITHUB_DISPATCH_TOKEN: 'fixture-token' };
const control = (patch = {}) => ({ version: 1, action: 'prepare', requestedRevision: 8, publishedRevision: 7, generation: 2,
  prepareKey: key, retryAt: null, intent: { kind: 'ordinary', ownerImagesCommit: null }, candidate: null, binaryPath: null, holdCode: null, archiveAllowed: false, ...patch });
const safeCandidate = { candidateId: attemptId, generation: 3, storageRevision: 7, sha256: 'c'.repeat(64), bytes: 108,
  expiresAt: '2026-10-18T13:00:00.000Z', fileName: `master-r7-g3-${attemptId}.pkg`, provider: 'sharepoint', driveId: 'drive', folderId: 'folder' };
const ready = () => control({ action: 'deliver', prepareKey: null, candidate: safeCandidate, binaryPath: `/api/ascm/publication/${attemptId}/bytes` });
function fixture({ projection = control(), result = 'accepted', configured = true, claimStatus = 'claimed', claimPatch = {}, resultPatch = {} } = {}) {
  const calls = [];
  const delivery = createPackageDelivery({ env, now, storage: new Proxy({}, { get() { throw Error('No storage access'); } }),
    database: async (op, payload) => { calls.push([op, payload]);
      if (op === 'control') return structuredClone(projection);
      if (op === 'prepare_claim') return { status: claimStatus, control: structuredClone(projection),
        attemptId: claimStatus === 'claimed' ? payload.attemptId : null, leaseUntil: claimStatus === 'claimed' ? '2026-10-18T12:01:00.000Z' : null,
        retryAt: ['claimed', 'busy', 'backoff'].includes(claimStatus) ? retryAt : null, ...claimPatch };
      if (op === 'prepare_result') return { status: payload.outcome, retryAt, ...resultPatch };
      throw Error('Unexpected database operation: ' + op);
    }, publicationDispatcher: { canDispatch: () => configured, dispatch: async input => { calls.push(['dispatch', input]); return result; } } });
  return { delivery, calls };
}
test('dispatcher retains legacy boolean adapter payload and fixes preparation route and inputs', async () => {
  const calls = [];
  const dispatcher = createPublicationDispatcher({ env, fetchImpl: async (url, options) => { calls.push([url, options]); return new Response(null, { status: 204 }); } });
  assert.equal(await dispatcher.dispatch(), 'accepted');
  assert.deepEqual(JSON.parse(calls[0][1].body), { ref: 'main' });
  assert.equal(await dispatcher.dispatch({ fixed: true, imagesCommit: 'd'.repeat(40) }), 'accepted');
  assert.equal(calls[1][0], 'https://api.github.com/repos/monocraft/PPC/actions/workflows/publish-master.yml/dispatches');
  assert.deepEqual(JSON.parse(calls[1][1].body), { ref: 'main', inputs: { bootstrap: false, images_commit: 'd'.repeat(40), seed_delivery_cache: false } });
  assert.equal(calls[1][1].redirect, 'error'); assert(calls[1][1].signal instanceof AbortSignal);
  for (const change of [{ PPC_GITHUB_DISPATCH_TOKEN: '' }, { PPC_GITHUB_OWNER: 'other' }, { PPC_GITHUB_REPO: 'other' }, { PPC_GITHUB_PUBLISH_WORKFLOW: 'other.yml' }]) {
    const d = createPublicationDispatcher({ env: { ...env, ...change }, fetchImpl: () => assert.fail('held dispatch reached network') });
    assert.equal(d.canDispatch({ fixed: true }), false); assert.equal(await d.dispatch({ fixed: true }), 'failed');
  }
  for (const [response, expected] of [[new Response(null, { status: 403 }), 'failed'], [new Response(null, { status: 503 }), 'uncertain']]) {
    assert.equal(await createPublicationDispatcher({ env, fetchImpl: async () => response }).dispatch({ fixed: true }), expected);
  }
  assert.equal(await createPublicationDispatcher({ env, fetchImpl: async () => { throw Error('private transport'); } }).dispatch({ fixed: true }), 'uncertain');
  for (const imagesCommit of ['INVALID', ['d'.repeat(40)], null, {}]) {
    assert.equal(await dispatcher.dispatch({ fixed: true, imagesCommit }), 'failed');
  }
  assert.equal(calls.length, 2, 'non-string commit authority cannot reach dispatch');
});
test('pure control uses one metadata RPC and ready delivery beats missing token', async () => {
  for (const projection of [control(), ready(), control({ action: 'idle', requestedRevision: 7, prepareKey: null, intent: null }),
    control({ action: 'held', prepareKey: null, intent: null, holdCode: 'OWNER_INTENT_UNKNOWN' }),
    control({ action: 'backoff', retryAt, holdCode: 'PREPARE_ATTEMPTS_EXHAUSTED' })]) {
    const { delivery, calls } = fixture({ projection, configured: projection.action === 'prepare' });
    assert.deepEqual(await delivery.getPublicationControl(), projection); assert.deepEqual(calls, [['control', {}]]);
  }
  const h = fixture({ configured: false });
  assert.deepEqual(await h.delivery.getPublicationControl(), control({ action: 'held', prepareKey: null, intent: null, holdCode: 'PUBLISHER_NOT_CONFIGURED' }));
  assert.deepEqual(await h.delivery.preparePublication({ prepareKey: key }), { version: 1, status: 'held', prepareKey: null, retryAt: null, holdCode: 'PUBLISHER_NOT_CONFIGURED', archiveAllowed: false });
  assert.deepEqual(h.calls, [['control', {}]], 'missing publisher is checked before even claiming');
});
test('control rejects malformed and unsafe DTOs instead of inventing idle', async () => {
  for (const projection of [null, {}, control({ extra: true }), control({ requestedRevision: null }), control({ requestedRevision: 0 }),
    control({ prepareKey: 'A'.repeat(64) }), control({ prepareKey: [key] }),
    control({ intent: { kind: 'owner_images', ownerImagesCommit: ['d'.repeat(40)] } }),
    control({ intent: { kind: 'ordinary', ownerImagesCommit: 'd'.repeat(40) } }),
    control({ candidate: safeCandidate }), readyWith({ fileName: 'master_ppc.pkg' }), readyWith({ driveId: 'foreign' }),
    readyWith({ expiresAt: now() }), readyWith({ candidateId: [attemptId] }), readyWith({ sha256: ['c'.repeat(64)] }),
    { ...ready(), binaryPath: 'https://evil.invalid/bytes' }, control({ archiveAllowed: true }),
    control({ action: 'backoff', retryAt: null }), control({ action: 'idle' }), control({ action: 'idle', prepareKey: null, intent: null }), control({ holdCode: 'PRIVATE_ERROR' })]) {
    await assert.rejects(fixture({ projection }).delivery.getPublicationControl(), { status: 503 });
  }
  function readyWith(patch) { return { ...ready(), candidate: { ...safeCandidate, ...patch } }; }
});
test('attempt exhaustion is timed backoff and cannot be represented as held or dispatched', () => {
  assert.throws(() => validatePublicationPreparation({ version: 1, status: 'dispatch_requested', prepareKey: [key], retryAt, holdCode: null, archiveAllowed: false }), { status: 503 });
  for (const status of ['held', 'busy', 'dispatch_requested', 'dispatch_rejected', 'dispatch_uncertain']) {
    assert.throws(() => validatePublicationPreparation({ version: 1, status, prepareKey: status === 'held' ? null : key,
      retryAt: status === 'held' ? null : retryAt, holdCode: 'PREPARE_ATTEMPTS_EXHAUSTED', archiveAllowed: false }), { status: 503 });
  }
});
test('prepare validates exact key, claims before fixed dispatch and records all typed outcomes', async () => {
  for (const [outcome, status] of [['accepted', 'dispatch_requested'], ['failed', 'dispatch_rejected'], ['uncertain', 'dispatch_uncertain']]) {
    const h = fixture({ result: outcome, projection: control({ intent: { kind: 'owner_images', ownerImagesCommit: 'd'.repeat(40) } }) });
    assert.deepEqual(await h.delivery.preparePublication({ prepareKey: key }), { version: 1, status, prepareKey: key, retryAt, holdCode: null, archiveAllowed: false });
    const [[operation, claim], dispatch, recorded] = h.calls;
    assert.equal(operation, 'prepare_claim'); assert.match(claim.attemptId, /^[a-f0-9-]{36}$/); assert.equal(claim.prepareKey, key);
    assert.deepEqual(dispatch, ['dispatch', { fixed: true, imagesCommit: 'd'.repeat(40) }]);
    assert.deepEqual(recorded, ['prepare_result', { ...claim, outcome }]);
  }
  for (const invalid of [{}, { prepareKey: key, ref: 'main' }, { prepareKey: key.toUpperCase() }, { prepareKey: null }, { prepareKey: [key] }]) {
    const h = fixture(); await assert.rejects(h.delivery.preparePublication(invalid), { status: 400 }); assert.deepEqual(h.calls, []);
  }
  for (const status of ['stale', 'busy', 'backoff', 'not_needed', 'held']) {
    const projection = status === 'held' ? control({ action: 'held', prepareKey: null, intent: null, holdCode: 'OWNER_INTENT_UNKNOWN' })
      : status === 'not_needed' ? ready() : status === 'backoff' ? control({ action: 'backoff', retryAt }) : control();
    const h = fixture({ claimStatus: status, projection });
    if (status === 'stale') await assert.rejects(h.delivery.preparePublication({ prepareKey: key }), { status: 409, code: 'PREPARE_STALE' });
    else assert.equal((await h.delivery.preparePublication({ prepareKey: key })).status, status);
    assert.equal(h.calls.length, 1, 'nonclaimed status never dispatches or records result');
  }
});
test('malformed claim authority cannot dispatch and late or malformed results never become success', async () => {
  for (const options of [{ claimStatus: 'not_needed' }, { claimStatus: 'claimed', claimPatch: { attemptId: attemptId } },
    { claimStatus: 'claimed', claimPatch: { leaseUntil: now() } }, { claimStatus: 'claimed', claimPatch: { retryAt: null } },
    { claimStatus: 'claimed', claimPatch: { extra: true } }, { claimStatus: 'backoff' }]) {
    const h = fixture(options); await assert.rejects(h.delivery.preparePublication({ prepareKey: key }), { status: 503 });
    assert.equal(h.calls.some(([operation]) => operation === 'dispatch'), false);
  }
  for (const patch of [{ status: 'stale', retryAt: null }, { status: 'accepted', retryAt: null }, { status: 'failed' }, { extra: true }]) {
    const h = fixture({ resultPatch: patch }); await assert.rejects(h.delivery.preparePublication({ prepareKey: key }), { status: patch.status === 'stale' ? 409 : 503 });
    assert.equal(h.calls.filter(([operation]) => operation === 'dispatch').length, 1);
  }
});
test('native RPC adapter forwards only closed control operations', async () => {
  const calls = []; const rpc = createPackageDeliveryRpc({ env, fetchImpl: async (url, options) => { calls.push([url, JSON.parse(options.body)]); return Response.json({}); } });
  for (const op of ['control', 'prepare_claim', 'prepare_result']) await rpc(op, op === 'control' ? {} : { prepareKey: key });
  assert.deepEqual(calls.map(([url]) => url), ['control', 'prepare_claim', 'prepare_result'].map(op => env.SUPABASE_URL + '/rest/v1/rpc/ppc_package_' + op));
  await assert.rejects(rpc('arbitrary'), /Unknown/); assert.equal(calls.length, 3);
});
const request = (path, options = {}) => new Request('https://fixture.supabase.co/functions/v1/ppc-ascm-flow' + path, { headers: { 'X-PPC-ASCM-Flow-Secret': env.PPC_ASCM_FLOW_SECRET, ...options.headers }, ...Object.fromEntries(Object.entries(options).filter(([k]) => k !== 'headers')) });
test('HTTP control is GET with no body and prepare is exact JSON; mail policy cannot disable control', async () => {
  const h = fixture(); const handler = createAscmFlowHttpHandler({ env, now, getPackageDelivery: () => h.delivery });
  assert.deepEqual(await (await handler(request('/api/ascm/publication/queued'))).json(), control());
  const prepared = await handler(request('/api/ascm/publication/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prepareKey: key }) }));
  assert.equal(prepared.status, 200); assert.equal((await prepared.json()).status, 'dispatch_requested');
  for (const [path, options, status] of [
    ['/api/ascm/publication/queued?x=1', {}, 400], ['/api/ascm/publication/queued', { headers: { Origin: 'null' } }, 403],
    ['/api/ascm/publication/queued', { headers: { 'X-PPC-ASCM-Flow-Secret': 'wrong' } }, 401],
    ['/api/ascm/publication/queued', { headers: { 'X-PPC-Other': 'wrong' } }, 400],
    ['/api/ascm/publication/queued', { headers: { 'Content-Length': '1' } }, 400],
    ['/api/ascm/publication/prepare', {}, 405], ['/api/ascm/publication/prepare', { method: 'POST', body: '{}' }, 415],
    ['/api/ascm/publication/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '4097' }, body: '{}' }, 413],
    ['/api/ascm/publication/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prepareKey: key, ref: 'main' }) }, 400],
    ['/api/ascm/publication/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prepareKey: [key] }) }, 400]]) {
    const before = h.calls.length; const response = await handler(request(path, options)); assert.equal(response.status, status); assert.equal((await response.json()).archiveAllowed, false); assert.equal(h.calls.length, before);
  }
  const stale = fixture({ claimStatus: 'stale' });
  const staleResponse = await createAscmFlowHttpHandler({ env, now, getPackageDelivery: () => stale.delivery })(request('/api/ascm/publication/prepare', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prepareKey: key }) }));
  assert.equal(staleResponse.status, 409); assert.deepEqual(await staleResponse.json(), { code: 'PREPARE_STALE', archiveAllowed: false });
  const readyWithoutPublisher = fixture({ projection: ready(), configured: false });
  const readyResponse = await createAscmFlowHttpHandler({ env, now, getPackageDelivery: () => readyWithoutPublisher.delivery })(request('/api/ascm/publication/queued'));
  assert.equal(readyResponse.status, 200); assert.deepEqual(await readyResponse.json(), ready());
});
