import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// All SQL runs in this process. No live database or Auth service is contacted.
const pgliteModule = process.env.PPC_TEST_PGLITE_MODULE
  ? pathToFileURL(resolve(process.env.PPC_TEST_PGLITE_MODULE)).href : '@electric-sql/pglite';
const { PGlite } = await import(pgliteModule);
const sql = await readFile(resolve('supabase/migrations/202610170002_ascm_oauth_binding.sql'), 'utf8');
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const client = '22222222-2222-4222-8222-222222222222';
const stranger = '33333333-3333-4333-8333-333333333333';
const resource = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/ppc-ascm-mcp/mcp';
const claims = { iss: 'https://abcdefghijklmnopqrst.supabase.co/auth/v1', sub: owner,
  aud: 'authenticated', client_id: client, role: 'authenticated', is_anonymous: false,
  iat: 1792278000, exp: 1792281600, email: 'owner@example.invalid',
  session_id: '44444444-4444-4444-8444-444444444444', aal: 'aal1', phone: '',
  custom: { preserve: true }, amr: [{ method: 'password', timestamp: 1792278000 }] };
const event = (extra = {}) => ({ user_id: owner, authentication_method: 'oauth_provider/authorization_code', claims: structuredClone(claims), ...extra });
const call = async value => (await db.query('select public.ppc_ascm_access_token_hook($1::jsonb) as result', [JSON.stringify(value)])).rows[0].result;
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin; create schema ppc_private; revoke all on schema ppc_private from public; create table ppc_private.master_sentinel(secret text); insert into ppc_private.master_sentinel values (\'untouched\');');
  await db.exec(sql);
  await db.exec(sql); // Repeat deployment does not reset an existing policy.
  const initial = await db.query('select enabled, owner_id, client_id, resource from ppc_private.ascm_oauth_policy');
  assert.deepEqual(initial.rows, [{ enabled: false, owner_id: null, client_id: null, resource: null }]);
  assert.deepEqual(await call(event()), { claims }, 'disabled configuration leaves issuance unchanged');
  await assert.rejects(() => db.exec('update ppc_private.ascm_oauth_policy set enabled=true'), /check constraint/);
  await db.query('update ppc_private.ascm_oauth_policy set enabled=true, owner_id=$1, client_id=$2, resource=$3', [owner, client, resource]);
  await db.exec(sql);
  const expected = { claims: { ...claims, aud: resource } };
  assert.deepEqual(await call(event()), expected, 'only the approved OAuth capability receives the MCP audience');
  assert.deepEqual(await call(event({ authentication_method: 'token_refresh', claims: { ...claims, aud: resource } })), expected, 'refresh retains owner/client binding');
  const direct = { ...claims }; delete direct.client_id;
  assert.deepEqual(await call(event({ authentication_method: 'password', claims: direct })), { claims: direct }, 'normal owner login stays unchanged');
  const other = { ...claims, client_id: stranger };
  assert.deepEqual(await call(event({ claims: other })), { claims: other }, 'other clients stay unchanged');
  for (const value of [
    event({ user_id: stranger }), event({ claims: { ...claims, sub: stranger } }),
    event({ claims: { ...claims, role: 'service_role' } }),
    event({ claims: { ...claims, is_anonymous: true } }),
    event({ user_id: null }), event({ client_id: stranger }),
  ]) await assert.rejects(() => call(value), /ASCM connection is not authorized/);
  await assert.rejects(() => db.query('update ppc_private.ascm_oauth_policy set resource=$1', ['https://attacker.invalid/mcp']), /check constraint/);
  await db.exec('set role supabase_auth_admin');
  assert.deepEqual(await call(event()), expected, 'managed Auth role can invoke its hook');
  await assert.rejects(() => db.exec('update ppc_private.ascm_oauth_policy set enabled=false'), /permission denied/);
  await assert.rejects(() => db.exec('select * from ppc_private.master_sentinel'), /permission denied/);
  await db.exec('reset role');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const permissions = await db.query("select has_table_privilege($1, 'ppc_private.ascm_oauth_policy', 'select') as read, has_function_privilege($1, 'public.ppc_ascm_access_token_hook(jsonb)', 'execute') as execute", [role]);
    assert.deepEqual(permissions.rows[0], { read: false, execute: false });
    await db.exec(`set role ${role}`);
    await assert.rejects(() => call(event()), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('update ppc_private.ascm_oauth_policy set enabled=false');
  assert.deepEqual(await call(event()), { claims }, 'disabled binding stops issuing new MCP audiences');
  assert.deepEqual((await db.query('select secret from ppc_private.master_sentinel')).rows, [{ secret: 'untouched' }]);
  console.log('ASCM OAuth hook SQL passed: exact owner/client audience, refresh, disabled policy, unchanged normal logins, isolated role permissions and preserved master data.');
} finally { await db.close(); }
