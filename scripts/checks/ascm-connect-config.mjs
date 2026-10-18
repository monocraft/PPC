import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderAscmConnectConfig } from '../configure-ascm-connect.mjs';

const parse = source => { const scope = {}; vm.runInNewContext(source, scope); return JSON.parse(JSON.stringify(scope.PPC_ASCM_CONNECT_CONFIG)); };
const env = { PPC_ASCM_CONNECT_ENABLED: 'true', PPC_ASCM_AUTH_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  PPC_ASCM_PUBLISHABLE_KEY: 'sb_publishable_synthetic_public_key', PPC_ASCM_MCP_CLIENT_ID: '11111111-1111-4111-8111-111111111111',
  PPC_ASCM_REDIRECT_URI: 'https://chatgpt.com/connector/oauth/synthetic', PPC_ASCM_IMPORT_SECRET: 'private-import-secret', PPC_PUBLISHER_SECRET: 'private-publisher-secret' };
assert.deepEqual(parse(renderAscmConnectConfig()), { version: 1, enabled: false, supabaseUrl: '', publishableKey: '', clientId: '', redirectUris: [] });
const output = renderAscmConnectConfig(env);
const config = parse(output);
assert.equal(config.enabled, true); assert.equal(config.supabaseUrl, env.PPC_ASCM_AUTH_URL);
assert.deepEqual(config.redirectUris, [env.PPC_ASCM_REDIRECT_URI]);
assert(!output.includes(env.PPC_ASCM_IMPORT_SECRET) && !output.includes(env.PPC_PUBLISHER_SECRET));
for (const patch of [{ PPC_ASCM_PUBLISHABLE_KEY: 'sb_secret_never_publish' }, { PPC_ASCM_AUTH_URL: 'https://evil.example' },
  { PPC_ASCM_MCP_CLIENT_ID: '' }, { PPC_ASCM_REDIRECT_URI: 'https://chatgpt.com.evil.example/connector/oauth/synthetic' },
  { PPC_ASCM_REDIRECT_URI: 'https://chatgpt.com/connector/oauth/synthetic?state=private' }]) {
  assert.throws(() => renderAscmConnectConfig({ ...env, ...patch }));
}
assert.equal(parse(renderAscmConnectConfig({ ...env, PPC_ASCM_CONNECT_ENABLED: 'false' })).publishableKey, '');
console.log('ASCM public consent configuration passed: disabled defaults, exact public identifiers and no secret serialization.');
