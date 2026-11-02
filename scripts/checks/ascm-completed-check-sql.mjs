import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const migration = '202611020001_ascm_completed_checks.sql';
const pgliteModule = process.env.PPC_TEST_PGLITE_MODULE
  ? pathToFileURL(resolve(process.env.PPC_TEST_PGLITE_MODULE)).href : '@electric-sql/pglite';
const { PGlite } = await import(pgliteModule);
const first = { checkId: '11111111-1111-4111-8111-111111111111', completedAt: '2026-10-17T01:00:00.000Z', outcome: 'unchanged' };
const second = { checkId: '22222222-2222-4222-8222-222222222222', completedAt: '2026-10-18T01:00:00.000Z', outcome: 'staged' };

test('completed-check private SQL contract', async t => {
  const db = new PGlite();
  const connection = async payload => (await db.query('select public.ppc_master_ascm_connection($1::jsonb) as result', [JSON.stringify(payload)])).rows[0].result;
  const report = check => connection({ service: 'sharepoint', check });
  const presence = async () => (await db.query('select public.ppc_master_presence($1::jsonb) as result',
    [JSON.stringify({ sessionId: 'check-human-session', displayName: 'Real editor', includeAscmSupervisor: true })])).rows[0].result;
  const config = async () => (await db.query('select to_jsonb(c) as value from ppc_private.ascm_supervisor_status_config c')).rows[0].value;
  const writes = async () => (await db.query('select count(*)::integer as n from completed_check_writes')).rows[0].n;
  const business = async () => (await db.query(`select jsonb_build_object(
    'master',(select to_jsonb(m) from ppc_private.master_state m),
    'delivery',(select to_jsonb(d) from ppc_private.package_delivery_state d),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from ppc_private.master_receipts r),
    'candidates',(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from ppc_private.package_delivery_candidates c),
    'publicationReceipts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from ppc_private.package_delivery_receipts r),
    'sourceReceipts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from ppc_private.ascm_sharepoint_receipts r)) as value`)).rows[0].value;
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;');
    for (const name of (await readdir(resolve('supabase/migrations'))).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(await readFile(resolve('supabase/migrations', name), 'utf8'));
    }
    await db.exec(`create table completed_check_writes (changed boolean);
      create function count_completed_check_write() returns trigger language plpgsql as $$
      begin insert into public.completed_check_writes values (true); return new; end; $$;
      create trigger count_completed_check_write after update on ppc_private.ascm_supervisor_status_config
      for each row execute function count_completed_check_write();`);
    await db.query(`insert into ppc_private.master_state(singleton,manifest,storage_revision,source_sha,bootstrap_fingerprint,requested_revision)
      values(true,$1::jsonb,7,$2,'completed-check-fixture',7)`,
    [JSON.stringify({ version: 4, categories: [], ascmSnapshot: { importedAt: '2026-10-16T10:00:00.000Z', accepted: 'business-fact' } }), 'a'.repeat(40)]);
    const accepted = await business();

    await t.test('default-off ignores a valid check without a singleton write or public status', async () => {
      assert.deepEqual(await report(first), { reported: false }); assert.equal(await writes(), 0);
      assert.equal((await presence()).ascmSupervisor, undefined);
      const value = await config();
      assert.equal(value.enabled, false); assert.equal(value.last_check_id, null);
      assert.equal(value.last_checked_at, null); assert.equal(value.check_outcome, null);
    });

    await t.test('first completion persists a private triplet and exposes only paired time and outcome', async () => {
      await db.exec('update ppc_private.ascm_supervisor_status_config set enabled=true');
      const before = await writes();
      assert.deepEqual(await report(first), { reported: true }); assert.equal(await writes(), before + 1);
      const value = await config();
      assert.equal(value.last_check_id, first.checkId); assert.equal(value.check_outcome, 'unchanged');
      assert.equal(new Date(value.last_checked_at).toISOString(), first.completedAt);
      assert.deepEqual((await presence()).ascmSupervisor, { enabled: true, working: false, productCount: null, expiresAt: null,
        reconnectRequired: [], lastCheckedAt: first.completedAt, checkOutcome: 'unchanged' });
    });

    await t.test('exact replay and older distinct receipts acknowledge without writing or regressing', async () => {
      const before = await config(), count = await writes();
      assert.deepEqual(await report(first), { reported: true });
      assert.deepEqual(await report({ ...second, completedAt: '2026-10-16T01:00:00.000Z' }), { reported: true });
      assert.deepEqual(await config(), before); assert.equal(await writes(), count);
    });

    await t.test('conflicting current identity or equal-time different receipt reject without writing', async () => {
      const before = await config(), count = await writes();
      for (const check of [{ ...first, outcome: 'staged' }, { ...first, completedAt: second.completedAt },
        { ...first, completedAt: '2026-10-16T01:00:00.000Z' }, { ...second, completedAt: first.completedAt }]) {
        await assert.rejects(() => report(check), /Invalid ASCM connection/);
      }
      assert.deepEqual(await config(), before); assert.equal(await writes(), count);
    });

    await t.test('SQL rejects malformed or mixed shape, noncanonical or future time and unsafe outcome', async () => {
      const count = await writes();
      for (const payload of [null, [], {}, { service: 'outlook', check: second }, { service: 'sharepoint', check: second, state: 'available' },
        { service: 'sharepoint', check: null }, { service: 'sharepoint', check: [] },
        ...[{ checkId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }, { checkId: 'invalid' }, { checkId: 1 },
          { completedAt: '2026-10-18T01:00:00Z' }, { completedAt: '2026-10-18T01:00:00.000+00:00' },
          { completedAt: '2026-02-30T01:00:00.000Z' }, { completedAt: '9999-10-18T01:00:00.000Z' },
          { completedAt: 1 }, { outcome: 'accepted' }, { outcome: null }, { private: 'not allowed' }]
          .map(change => ({ service: 'sharepoint', check: { ...second, ...change } })),
        { service: 'sharepoint', check: { checkId: second.checkId, outcome: 'staged' } }]) {
        await assert.rejects(() => connection(payload), /Invalid ASCM connection/);
      }
      assert.equal(await writes(), count);
      await assert.rejects(() => db.exec("update ppc_private.ascm_supervisor_status_config set last_checked_at=null"), /check constraint/);
      await assert.rejects(() => db.exec("update ppc_private.ascm_supervisor_status_config set check_outcome='accepted'"), /check constraint/);
    });

    await t.test('newer completion advances without changing accepted facts or publication/source receipts', async () => {
      const count = await writes();
      assert.deepEqual(await report(second), { reported: true }); assert.equal(await writes(), count + 1);
      const value = await config(); assert.equal(value.last_check_id, second.checkId); assert.equal(value.check_outcome, 'staged');
      assert.equal((await presence()).ascmSupervisor.lastCheckedAt, second.completedAt);
      assert.deepEqual(await business(), accepted);
    });

    await t.test('checks preserve both reconnect flags, active lease, human roster and accepted time', async () => {
      await connection({ service: 'outlook', state: 'reconnect_required' });
      await connection({ service: 'sharepoint', state: 'reconnect_required' });
      const lease = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      await db.query('select public.ppc_master_ascm_status($1::jsonb)', [JSON.stringify({ phase: 'begin', leaseId: lease })]);
      await db.query('select public.ppc_master_ascm_status($1::jsonb)', [JSON.stringify({ phase: 'plan', leaseId: lease, productCount: 5 })]);
      const before = await presence(), leases = (await db.query('select to_jsonb(r) as value from ppc_private.ascm_supervisor_runs r')).rows;
      const next = { ...first, checkId: '33333333-3333-4333-8333-333333333333', completedAt: '2026-10-19T01:00:00.000Z' };
      assert.deepEqual(await report(next), { reported: true });
      const after = await presence();
      assert.deepEqual(after.ascmSupervisor, { ...before.ascmSupervisor, lastCheckedAt: next.completedAt, checkOutcome: 'unchanged' });
      assert.equal(after.onlineCount, before.onlineCount); assert.equal(after.sessions.length, 1);
      assert.deepEqual(after.sessions.map(({ lastSeenAt, ...value }) => value), before.sessions.map(({ lastSeenAt, ...value }) => value));
      assert.deepEqual(after.capabilities, before.capabilities); assert.deepEqual(after.pokes, before.pokes);
      assert.deepEqual((await db.query('select to_jsonb(r) as value from ppc_private.ascm_supervisor_runs r')).rows, leases);
      assert.deepEqual(await business(), accepted);
      await connection({ service: 'sharepoint', state: 'available' });
      assert.deepEqual((await presence()).ascmSupervisor.reconnectRequired, ['outlook']);
      assert.equal((await presence()).ascmSupervisor.lastCheckedAt, next.completedAt);
    });

    await t.test('service-only grants keep direct private records and snapshots inaccessible', async () => {
      for (const role of ['anon', 'authenticated', 'supabase_auth_admin', 'service_role']) {
        await db.exec(`set role ${role}`);
        try {
          await assert.rejects(() => db.exec('select * from ppc_private.ascm_supervisor_status_config'), /permission denied/);
          await assert.rejects(() => db.exec('select ppc_private.ascm_supervisor_snapshot()'), /permission denied/);
          if (role === 'service_role') assert.deepEqual(await report(second), { reported: true });
          else await assert.rejects(() => report(second), /permission denied/);
        } finally { await db.exec('reset role'); }
      }
    });

    await t.test('reapplying the migration preserves receipts, reconnect flags, enablement and all grants', async () => {
      const before = await config(), count = await writes();
      const sql = await readFile(resolve('supabase/migrations', migration), 'utf8');
      await db.exec(sql); await db.exec(sql);
      assert.deepEqual(await config(), before); assert.equal(await writes(), count);
      await db.exec('set role authenticated');
      await assert.rejects(() => report(second), /permission denied/); await db.exec('reset role');
    });

    await t.test('disabled reporting retains latest receipt and reconnect state without writing', async () => {
      await db.exec('update ppc_private.ascm_supervisor_status_config set enabled=false');
      const before = await config(), count = await writes();
      assert.deepEqual(await report({ ...second, checkId: '44444444-4444-4444-8444-444444444444', completedAt: '2026-10-20T01:00:00.000Z' }), { reported: false });
      assert.deepEqual(await config(), before); assert.equal(await writes(), count);
      assert.equal((await presence()).ascmSupervisor, undefined); assert.deepEqual(await business(), accepted);
    });
  } finally { await db.close(); }
});
