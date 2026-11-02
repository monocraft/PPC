import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../../public/js/package-codec.js';
import * as gatewayModule from '../../supabase/functions/ppc-master/gateway.mjs';

assert.equal(typeof gatewayModule.createAscmConnectionReporter, 'function', 'gateway needs a narrow private connection reporter');
const { createAscmConnectionReporter, createMasterGateway, sha256 } = gatewayModule;
const databaseOrigin = 'https://abcdefghijklmnopqrst.supabase.co';
const credential = 'sb_secret_isolated_private_database_credential';
const env = { PPC_ASCM_STATUS_ENABLED: 'true', SUPABASE_URL: databaseOrigin, SUPABASE_SECRET_KEYS: JSON.stringify({ default: credential }) };
const report = { service: 'outlook', state: 'reconnect_required' };
const now = () => '2026-10-17T12:00:00.000Z';
const seed = { version: 4, categories: [{ id: 'mice', board: { lanes: [{ id: 'wired' }], products: [] } }] };

test('reporter is default-off and invalid input or missing private configuration performs no HTTP', async () => {
  for (const configuration of [{}, { ...env, PPC_ASCM_STATUS_ENABLED: '' }, { ...env, SUPABASE_URL: 'https://attacker.invalid' },
    { ...env, SUPABASE_SECRET_KEYS: '{}' }, { ...env, SUPABASE_SECRET_KEYS: '{bad' }]) {
    let calls = 0;
    const reporter = createAscmConnectionReporter({ env: configuration, fetchImpl() { calls++; throw new Error('No outbound fixture access.'); } });
    assert.deepEqual(await reporter(report), { reported: false }); assert.equal(calls, 0);
  }
  for (const payload of [null, [], {}, { ...report, error: 'raw private data' }, { ...report, url: 'https://graph.microsoft.com' },
    { ...report, service: 'teams' }, { ...report, state: 'fixed' }, { ...report, service: {} }]) {
    let calls = 0;
    const reporter = createAscmConnectionReporter({ env, fetchImpl() { calls++; throw new Error('No outbound fixture access.'); } });
    assert.deepEqual(await reporter(payload), { reported: false }); assert.equal(calls, 0);
  }
});

test('reporter performs exactly one pinned private RPC and returns no provider payload or credentials', async () => {
  const calls = [];
  const reporter = createAscmConnectionReporter({ env, fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(url, databaseOrigin + '/rest/v1/rpc/ppc_master_ascm_connection');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert(options.signal instanceof AbortSignal);
    assert.equal(options.headers.apikey, credential); assert.equal(options.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(options.body), { payload: report });
    return Response.json({ reported: true, privateData: credential });
  } });
  assert.deepEqual(await reporter(report), { reported: true }); assert.equal(calls.length, 1);
});

test('database disabled failures redirects and malformed reporting responses remain safe false results', async () => {
  for (const response of [Response.json({ reported: false }), Response.json({ reported: 'true' }),
    Response.json({ error: credential }, { status: 500 }), new Response('{}', { status: 302 }),
    new Response('{malformed'), new Response('{}', { headers: { 'content-length': '999999999' } })]) {
    const reporter = createAscmConnectionReporter({ env, fetchImpl: async () => response });
    assert.deepEqual(await reporter(report), { reported: false });
  }
  const reporter = createAscmConnectionReporter({ env, fetchImpl: async () => { throw new Error(credential); } });
  assert.deepEqual(await reporter(report), { reported: false });
});

test('presence exposes only unique fixed-order reconnect services and preserves activity and humans', async () => {
  const key = globalThis.PortfolioPackage.generateKey(), publisher = 'isolated-connection-publisher-'.padEnd(48, 'x');
  const base = { enabled: true, working: false, productCount: null, expiresAt: null };
  for (const [required, expected] of [[undefined, []], [[], []], [['sharepoint'], ['sharepoint']],
    [['sharepoint', 'outlook'], ['outlook', 'sharepoint']], [['outlook', 'outlook'], []],
    [['outlook', 'evil'], []], ['outlook', []]]) {
    const calls = [];
    const gateway = createMasterGateway({ env: { PPC_PACKAGE_KEY_HASH: await sha256(key), PPC_PUBLISHER_SECRET: publisher, PPC_ASCM_STATUS_ENABLED: 'true' }, now,
      rpc: async (operation, payload) => {
        calls.push(operation);
        if (operation === 'rate') return { allowed: true };
        if (operation === 'read') return { manifest: seed, storageRevision: 1 };
        assert.equal(operation, 'presence'); assert.equal(payload.includeAscmSupervisor, true);
        return { sessions: [{ sessionId: 'real-human-session', displayName: 'Real person' }], onlineCount: 1, ascmSupervisor: { ...base, reconnectRequired: required } };
      } });
    const response = await gateway(new Request('https://fixture.invalid/api/master/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, sessionId: 'real-human-session' }) }));
    assert.equal(response.status, 200); const result = await response.json();
    assert.deepEqual(result.ascmSupervisor, { ...base, reconnectRequired: expected });
    assert.equal(result.onlineCount, 1); assert.equal(result.sessions.length, 1);
    assert.deepEqual(calls, ['rate', 'rate', 'read', 'presence']);
  }
});

const completedCheck = { service: 'sharepoint', check: {
  checkId: '11111111-1111-4111-8111-111111111111', completedAt: '2026-10-17T11:00:00.000Z', outcome: 'unchanged' } };

test('completed check reporter sends only the exact receipt through the existing private RPC', async () => {
  for (const outcome of ['unchanged', 'staged']) {
    const payload = { ...completedCheck, check: { ...completedCheck.check, outcome } };
    let calls = 0;
    const reporter = createAscmConnectionReporter({ env, now, fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, databaseOrigin + '/rest/v1/rpc/ppc_master_ascm_connection');
      assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
      assert.deepEqual(JSON.parse(options.body), { payload });
      return Response.json({ reported: true, private: credential });
    } });
    assert.deepEqual(await reporter(payload), { reported: true }); assert.equal(calls, 1);
  }
});

test('completed check reporter refuses nonexact, noncanonical and future receipts before any HTTP', async () => {
  const malformed = [
    { ...completedCheck, state: 'available' }, { ...completedCheck, service: 'outlook' },
    { ...completedCheck, check: null }, { ...completedCheck, check: [] },
    ...[{ checkId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }, { checkId: 'not-a-uuid' }, { checkId: 1 },
      { completedAt: '2026-10-17T11:00:00Z' }, { completedAt: '2026-10-17T11:00:00.000+00:00' },
      { completedAt: '2026-02-30T11:00:00.000Z' }, { completedAt: '2026-10-17T12:00:00.001Z' },
      { completedAt: 1 }, { outcome: 'accepted' }, { outcome: null }, { private: 'never forward' }]
      .map(change => ({ ...completedCheck, check: { ...completedCheck.check, ...change } })),
    { service: 'sharepoint', check: { completedAt: completedCheck.check.completedAt, outcome: 'unchanged' } },
  ];
  for (const payload of malformed) {
    let calls = 0;
    const reporter = createAscmConnectionReporter({ env, now, fetchImpl() { calls++; throw Error('No outbound fixture access'); } });
    assert.deepEqual(await reporter(payload), { reported: false }); assert.equal(calls, 0);
  }
  for (const configuration of [{}, { ...env, PPC_ASCM_STATUS_ENABLED: '' }]) {
    let calls = 0;
    const reporter = createAscmConnectionReporter({ env: configuration, now, fetchImpl() { calls++; throw Error('Disabled report attempted HTTP'); } });
    assert.deepEqual(await reporter(completedCheck), { reported: false }); assert.equal(calls, 0);
  }
});

test('presence exposes completed-check pairs only, separately from the manifest accepted date and private receipt identity', async () => {
  const key = globalThis.PortfolioPackage.generateKey(), publisher = 'isolated-check-publisher-'.padEnd(48, 'x');
  const base = { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired: ['sharepoint'] };
  const checked = { lastCheckedAt: completedCheck.check.completedAt, checkOutcome: 'unchanged' };
  const variants = [
    [checked, checked], [{ ...checked, checkOutcome: 'staged' }, { ...checked, checkOutcome: 'staged' }],
    [{ lastCheckedAt: checked.lastCheckedAt }, {}], [{ checkOutcome: 'unchanged' }, {}],
    [{ ...checked, checkOutcome: 'accepted' }, {}], [{ ...checked, checkOutcome: [] }, {}],
    [{ ...checked, lastCheckedAt: '2026-10-17T12:00:00.001Z' }, {}],
    [{ ...checked, lastCheckedAt: '2026-02-30T11:00:00.000Z' }, {}],
    [{ ...checked, lastCheckedAt: '2026-10-17T11:00:00Z' }, {}],
    [{ ...checked, lastCheckedAt: '2026-10-17T11:00:00.000+00:00' }, {}],
  ];
  for (const [extra, expected] of variants) {
    const gateway = createMasterGateway({ env: { PPC_PACKAGE_KEY_HASH: await sha256(key), PPC_PUBLISHER_SECRET: publisher, PPC_ASCM_STATUS_ENABLED: 'true' }, now,
      rpc: async operation => {
        if (operation === 'rate') return { allowed: true };
        if (operation === 'read') return { manifest: { ...seed, ascmSnapshot: { importedAt: '2026-10-16T10:00:00.000Z' } }, storageRevision: 1 };
        assert.equal(operation, 'presence');
        return { sessions: [{ sessionId: 'real-human-session' }], onlineCount: 1,
          ascmSupervisor: { ...base, ...extra, lastUpdatedAt: now(), lastCheckId: completedCheck.check.checkId, private: credential } };
      } });
    const response = await gateway(new Request('https://fixture.invalid/api/master/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, sessionId: 'real-human-session' }) }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.ascmSupervisor, { ...base, ...expected, lastUpdatedAt: '2026-10-16T10:00:00.000Z' });
    assert.equal(result.onlineCount, 1); assert.equal(result.sessions.length, 1);
  }
});
