import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import vm from 'node:vm';
import { createAscmConsent, createAscmBrowserClient, renderAscmConsent } from '../../public/js/ascm-connect.js';

const owner = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const authorizationId = '33333333-3333-4333-8333-333333333333';
const callback = 'https://chatgpt.com/connector/oauth/fixture-connection';
const project = 'https://abcdefghijklmnopqrst.supabase.co';
const config = { version: 1, enabled: true, supabaseUrl: project, publishableKey: 'sb_publishable_synthetic_public_test_key', clientId, redirectUris: [callback] };
const now = () => 1792238400000;
const user = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z', is_anonymous: false };
const details = { authorization_id: authorizationId, redirect_uri: callback, client: { id: clientId, name: 'PPC ASCM cloud', uri: 'https://chatgpt.com', logo_uri: '' }, user: { id: owner, email: user.email }, scope: 'email' };
const ok = data => ({ data, error: null });
function fixture(patch = {}) {
  const calls = [], navigations = [], states = [];
  const authClient = {
    signInWithPassword: async credentials => { calls.push(['sign-in', credentials.email]); return ok({ session: { access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', expires_at: now() / 1000 + 3600, expires_in: 3600, token_type: 'bearer', user }, user }); },
    getUser: async token => { assert.equal(token, 'fixture-access-token'); return ok({ user }); },
    getClaims: async token => { assert.equal(token, 'fixture-access-token'); return ok({ claims: { sub: owner, iss: `${project}/auth/v1`, aud: 'authenticated', role: 'authenticated', exp: now() / 1000 + 3600, iat: now() / 1000, is_anonymous: false }, header: { alg: 'ES256', kid: 'fixture-key' }, signature: new Uint8Array() }); },
    oauth: {
      getAuthorizationDetails: async id => { calls.push(['details', id]); return ok(structuredClone(details)); },
      approveAuthorization: async (id, options) => { calls.push(['approve', id, options]); return ok({ redirect_url: `${callback}?code=fixture-code&state=fixture-state` }); },
      denyAuthorization: async (id, options) => { calls.push(['deny', id, options]); return ok({ redirect_url: `${callback}?error=access_denied&state=fixture-state` }); },
    },
    ...patch,
  };
  const controller = createAscmConsent({ authClient, config, location: { href: `https://portfolio.example.test/ascm-connect.html?authorization_id=${authorizationId}` }, navigate: value => navigations.push(value), onState: value => states.push(value), now });
  return { controller, authClient, calls, navigations, states };
}
const login = async current => { await current.controller.start(); await current.controller.signIn({ email: user.email, password: 'browser-only-password' }); };

test('valid login shows verified request details without approving until explicit Connect', async () => {
  const current = fixture(); await login(current);
  assert.equal(current.states.at(-1).phase, 'review');
  assert.equal(current.states.at(-1).details.clientName, 'PPC ASCM cloud');
  assert.equal(current.states.at(-1).details.redirectUri, callback);
  assert.deepEqual(current.states.at(-1).details.scopes, ['email']);
  assert.equal(current.calls.filter(call => call[0] === 'approve').length, 0);
  assert.deepEqual(current.navigations, []);
  await current.controller.connect();
  assert.deepEqual(current.navigations, [`${callback}?code=fixture-code&state=fixture-state`]);
  assert.deepEqual(current.calls.find(call => call[0] === 'approve'), ['approve', authorizationId, { skipBrowserRedirect: true }]);
  assert(!JSON.stringify(current.states).includes('browser-only-password'));
  assert(!JSON.stringify(current.states).includes('fixture-access-token'));
});

test('Deny returns only the validated provider error callback and never approves', async () => {
  const current = fixture(); await login(current); await current.controller.deny();
  assert.deepEqual(current.navigations, [`${callback}?error=access_denied&state=fixture-state`]);
  assert.equal(current.calls.filter(call => call[0] === 'approve').length, 0);
  assert.deepEqual(current.calls.find(call => call[0] === 'deny'), ['deny', authorizationId, { skipBrowserRedirect: true }]);
});

test('wrong OAuth client, user, authorization ID, callback and unsupported scopes cannot grant consent', async () => {
  for (const change of [{ client: { ...details.client, id: owner } }, { user: { id: clientId, email: user.email } }, { authorization_id: owner }, { redirect_uri: 'https://chatgpt.com.evil.test/callback' }, { redirect_uri: `${callback}/other` }, { scope: 'email phone' }]) {
    const current = fixture(); current.authClient.oauth.getAuthorizationDetails = async () => ok({ ...structuredClone(details), ...change });
    await login(current); await current.controller.connect();
    assert.equal(current.states.at(-1).phase, 'blocked');
    assert.deepEqual(current.navigations, []);
    assert.equal(current.calls.filter(call => call[0] === 'approve').length, 0);
  }
});

test('identity requires matching server user and verified same-project claims', async () => {
  for (const claimPatch of [{ sub: clientId }, { iss: 'https://other.supabase.co/auth/v1' }, { exp: now() / 1000 - 1 }, { role: 'service_role' }, { is_anonymous: true }]) {
    const current = fixture(), original = current.authClient.getClaims;
    current.authClient.getClaims = async token => { const value = await original(token); Object.assign(value.data.claims, claimPatch); return value; };
    await login(current); assert.equal(current.states.at(-1).phase, 'blocked'); assert(!current.calls.some(call => call[0] === 'details'));
  }
  const current = fixture({ getUser: async () => ({ data: { user: null }, error: { message: 'provider error' } }) });
  await login(current); assert.equal(current.states.at(-1).phase, 'blocked');
});

test('default disabled and malformed public configurations cause no sign-in or OAuth requests', async () => {
  for (const patch of [{ enabled: false }, { supabaseUrl: 'https://evil.test' }, { publishableKey: 'sb_secret_do-not-use' }, { clientId: '' }, { redirectUris: ['javascript:alert(1)'] }, { redirectUris: ['https://evil.test/callback'] }, { unexpectedSecret: 'not-allowed' }]) {
    const current = fixture();
    const blocked = createAscmConsent({ authClient: current.authClient, config: { ...config, ...patch }, location: { href: `https://portfolio.example.test/?authorization_id=${authorizationId}` }, navigate: value => current.navigations.push(value), onState: value => current.states.push(value), now });
    await blocked.start(); await blocked.signIn({ email: user.email, password: 'password' });
    assert(['disabled', 'blocked'].includes(current.states.at(-1).phase)); assert.equal(current.calls.length, 0);
  }
});

test('missing or duplicated authorization identity cannot start authentication', async () => {
  for (const search of ['', '?authorization_id=bad/id', `?authorization_id=${authorizationId}&authorization_id=${owner}`]) {
    const current = fixture();
    const blocked = createAscmConsent({ authClient: current.authClient, config, location: { href: `https://portfolio.example.test/ascm-connect.html${search}` }, navigate: () => assert.fail('no redirect'), onState: value => current.states.push(value), now });
    await blocked.start(); await blocked.signIn({ email: user.email, password: 'password' });
    assert.equal(current.states.at(-1).phase, 'blocked'); assert.equal(current.calls.length, 0);
  }
});

test('prior-consent redirect-only shape cannot bypass explicit verified client review', async () => {
  const current = fixture(); current.authClient.oauth.getAuthorizationDetails = async () => ok({ redirect_url: `${callback}?code=prior&state=prior` });
  await login(current); await current.controller.connect();
  assert.equal(current.states.at(-1).phase, 'blocked'); assert.equal(current.navigations.length, 0);
});

test('provider errors never expose credentials or raw server metadata', async () => {
  const current = fixture({ signInWithPassword: async () => ({ data: { session: null, user: null }, error: { message: 'browser-only-password access_token=private' } }) });
  await login(current);
  assert.equal(current.states.at(-1).phase, 'login');
  assert(!JSON.stringify(current.states).includes('browser-only-password'));
  assert(!JSON.stringify(current.states).includes('access_token=private'));
});

test('changed authorization details or unsafe decision callback hold instead of navigating', async () => {
  const changed = fixture(); await login(changed);
  changed.authClient.oauth.getAuthorizationDetails = async () => ok({ ...structuredClone(details), client: { ...details.client, id: owner } });
  await changed.controller.connect(); assert.equal(changed.navigations.length, 0); assert(!changed.calls.some(call => call[0] === 'approve'));
  for (const redirect_url of [`https://evil.test/?code=bad&state=fixture`, `${callback}/other?code=bad&state=fixture`, `${callback}?code=ok&code=bad&state=fixture`, `${callback}?code=ok`, `${callback}?error=access_denied&state=fixture`]) {
    const current = fixture(); await login(current);
    current.authClient.oauth.approveAuthorization = async () => ok({ redirect_url });
    await current.controller.connect(); assert.equal(current.navigations.length, 0); assert.equal(current.states.at(-1).phase, 'blocked');
  }
});

test('untrusted client metadata is rendered only as inert text', () => {
  const elements = new Map();
  const element = () => ({ hidden: false, disabled: false, textContent: '', children: [], replaceChildren(...children) { this.children = children; }, append(child) { this.children.push(child); }, setAttribute() {}, set innerHTML(_) { assert.fail('HTML injection sink used'); } });
  const document = { getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: () => element() };
  renderAscmConsent(document, { phase: 'review', message: 'Review this connection.', email: user.email, details: { clientName: '<img src=x onerror=alert(1)>', clientId, redirectUri: callback, scopes: ['email'] } });
  assert.equal(elements.get('clientName').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(elements.get('connectButton').disabled, false);
});

test('the real pinned browser SDK keeps a successful session in memory and a fresh client starts signed out', async () => {
  const source = await readFile(new URL('../../public/vendor/supabase-js-2.118.0.js', import.meta.url), 'utf8');
  let network = 0;
  const context = vm.createContext({ URL, URLSearchParams, Headers, Request, Response, TextEncoder, TextDecoder, AbortController, WebSocket: globalThis.WebSocket, setTimeout, clearTimeout, setInterval, clearInterval, crypto: globalThis.crypto, console: { log() {}, warn() {}, error() {} }, fetch: async url => {
    network++; assert.equal(new URL(url).pathname, '/auth/v1/token');
    return Response.json({ access_token: 'in-memory-access', refresh_token: 'in-memory-refresh', expires_in: 3600, token_type: 'bearer', user });
  } });
  Object.defineProperty(context, 'localStorage', { get() { assert.fail('persistent storage read'); } });
  Object.defineProperty(context, 'sessionStorage', { get() { assert.fail('persistent storage read'); } });
  vm.runInContext(source, context);
  assert.equal(typeof context.supabase.createClient, 'function');
  const first = createAscmBrowserClient(config, context.supabase.createClient);
  await first.auth.signInWithPassword({ email: user.email, password: 'synthetic-password' });
  assert.equal((await first.auth.getSession()).data.session.access_token, 'in-memory-access');
  const second = createAscmBrowserClient(config, context.supabase.createClient);
  assert.equal((await second.auth.getSession()).data.session, null);
  assert.equal(network, 1);
});

// Explicit local-only visual fixture; never shipped by the static Pages build.
if (process.argv.includes('--preview')) {
  const routes = new Map([
    ['/ascm-connect.html', ['ascm-connect.html', 'text/html']],
    ['/js/ascm-connect.js', ['js/ascm-connect.js', 'text/javascript']],
    ['/css/ascm-connect.css', ['css/ascm-connect.css', 'text/css']],
    ['/css/fonts.css', ['css/fonts.css', 'text/css']],
    ['/assets/fonts/Jost-Variable.ttf', ['assets/fonts/Jost-Variable.ttf', 'font/ttf']],
  ]);
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (path === '/js/ascm-connect-config.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(`globalThis.PPC_ASCM_CONNECT_CONFIG=${JSON.stringify(config)};`); return; }
    if (path === '/vendor/supabase-js-2.118.0.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(`const person=${JSON.stringify(user)},details=${JSON.stringify(details)};globalThis.supabase={createClient:()=>({auth:{signInWithPassword:async()=>({data:{session:{access_token:'fixture-access-token'}}}),getUser:async()=>({data:{user:person}}),getClaims:async()=>({data:{claims:{sub:person.id,iss:'${project}/auth/v1',aud:'authenticated',role:'authenticated',is_anonymous:false,exp:Date.now()/1000+3600,iat:Date.now()/1000},header:{alg:'ES256'}}}),oauth:{getAuthorizationDetails:async()=>({data:details}),approveAuthorization:async()=>({error:{message:'Preview only'}}),denyAuthorization:async()=>({error:{message:'Preview only'}})}}})};`);
      return;
    }
    if (!routes.has(path)) { response.writeHead(404); response.end(); return; }
    const [file, type] = routes.get(path);
    try {
      let body = await readFile(new URL(`../../public/${file}`, import.meta.url));
      if (type === 'text/html') body = Buffer.from(body.toString().replace('<body>', '<body><div style="padding:8px 16px;background:#333538;text-align:center;font:13px Arial,sans-serif">Local synthetic fixture · no external authentication or approval</div>'));
      response.setHeader('Content-Type', type); response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  server.listen(4198, '127.0.0.1', () => console.log(`Local consent fixture: http://127.0.0.1:4198/ascm-connect.html?authorization_id=${authorizationId}`));
}
