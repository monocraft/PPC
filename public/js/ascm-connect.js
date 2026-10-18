const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFIG_FIELDS = new Set(['version', 'enabled', 'supabaseUrl', 'publishableKey', 'clientId', 'redirectUris']);
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
class ConsentProblem extends Error {
  constructor(message, phase = 'blocked') { super(message); this.phase = phase; }
}
const stop = message => { throw new ConsentProblem(message); };

function publicConfig(config) {
  if (!object(config) || config.enabled !== true) throw new ConsentProblem('This connection is not enabled yet. Return to ChatGPT after setup is complete.', 'disabled');
  if (config.version !== 1 || Object.keys(config).some(key => !CONFIG_FIELDS.has(key))
    || typeof config.supabaseUrl !== 'string' || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.supabaseUrl)
    || typeof config.publishableKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{16,240}$/.test(config.publishableKey)
    || !UUID.test(config.clientId || '') || !Array.isArray(config.redirectUris) || !config.redirectUris.length || config.redirectUris.length > 5) stop('Connection settings need review. Return to ChatGPT and try again after setup is complete.');
  for (const value of config.redirectUris) {
    let url;
    try { url = new URL(value); } catch { stop('The configured return address needs review.'); }
    if (url.origin !== 'https://chatgpt.com' || url.username || url.password || url.hash || url.search
      || value !== `${url.origin}${url.pathname}` || !/^\/(?:connector\/oauth\/[A-Za-z0-9_-]+|connector_platform_oauth_redirect)$/.test(url.pathname)) stop('The configured return address needs review.');
  }
  return { ...config, redirectUris: [...config.redirectUris] };
}

export function createAscmBrowserClient(config, createClient) {
  const settings = publicConfig(config);
  if (typeof createClient !== 'function') stop('The connection library could not load. Refresh this connection page and try again.');
  return createClient(settings.supabaseUrl, settings.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'ppc-ascm-consent-memory' } });
}

function authorizationFromLocation(location) {
  let url;
  try { url = new URL(location.href); } catch { stop('Open this connection page from ChatGPT to continue.'); }
  const ids = url.searchParams.getAll('authorization_id');
  if (ids.length !== 1 || !UUID.test(ids[0]) || url.hash || [...url.searchParams.keys()].some(key => key !== 'authorization_id')) stop('This connection request is missing or invalid. Return to ChatGPT and reconnect.');
  return ids[0];
}

function checkedDetails(value, settings, authorizationId, userId) {
  if (object(value) && Object.hasOwn(value, 'redirect_url')) stop('This request was already approved and cannot be reviewed here. Return to ChatGPT and restart the connection.');
  if (!object(value) || value.authorization_id !== authorizationId || value.client?.id !== settings.clientId
    || value.user?.id !== userId || !settings.redirectUris.includes(value.redirect_uri)) stop('The requesting account, client or return address does not match this connection. Return to ChatGPT and reconnect.');
  const scopes = typeof value.scope === 'string' && value.scope.length <= 256 ? value.scope.trim().split(/\s+/).filter(Boolean) : [];
  if (!scopes.length || scopes.some(scope => scope !== 'email') || new Set(scopes).size !== scopes.length) stop('This request asks for permissions outside the ASCM connection. Review its settings before reconnecting.');
  if (typeof value.client.name !== 'string' || !value.client.name.trim() || value.client.name.length > 160) stop('The requesting client details are incomplete. Return to ChatGPT and reconnect.');
  return { clientId: value.client.id, clientName: value.client.name, redirectUri: value.redirect_uri, scopes };
}

function checkedDecision(value, settings, reviewed, decision) {
  let url;
  try { url = new URL(value?.redirect_url); } catch { stop('The connection could not confirm a safe return address. Return to ChatGPT and reconnect.'); }
  if (url.username || url.password || url.hash || `${url.origin}${url.pathname}` !== reviewed.redirectUri
    || !settings.redirectUris.includes(`${url.origin}${url.pathname}`)) stop('The connection returned an unexpected address. Return to ChatGPT and reconnect.');
  const allowed = new Set(['code', 'state', 'error', 'error_description', 'iss']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) stop('The connection returned invalid authorization details. Return to ChatGPT and reconnect.');
  if (!url.searchParams.get('state') || url.searchParams.get('state').length > 4096
    || url.searchParams.has('iss') && url.searchParams.get('iss') !== `${settings.supabaseUrl}/auth/v1`
    || decision === 'approve' && (!url.searchParams.get('code') || url.searchParams.get('code').length > 4096 || url.searchParams.has('error'))
    || decision === 'deny' && (url.searchParams.get('error') !== 'access_denied' || url.searchParams.has('code'))) stop('The connection returned invalid authorization details. Return to ChatGPT and reconnect.');
  return url.href;
}

/** Standalone consent state. Credentials and session tokens never leave this closure. */
export function createAscmConsent({ authClient, location, navigate, config, onState = () => {}, now = () => Date.now() } = {}) {
  let settings, authorizationId, accessToken = '', verifiedUser, reviewed;
  let state = { phase: 'initial', message: 'Preparing this connection…' };
  const emit = (phase, values = {}) => { state = { phase, ...values }; onState(structuredClone(state)); };
  const blocked = error => { accessToken = ''; verifiedUser = undefined; reviewed = undefined; emit(error instanceof ConsentProblem ? error.phase : 'blocked', { message: error instanceof ConsentProblem ? error.message : 'This connection could not be verified. Return to ChatGPT and reconnect.' }); };
  async function identity() {
    const remote = await authClient.getUser(accessToken);
    const verified = await authClient.getClaims(accessToken);
    const user = remote?.data?.user, claims = verified?.data?.claims, header = verified?.data?.header;
    const seconds = now() / 1000;
    if (remote?.error || verified?.error || !UUID.test(user?.id || '') || claims?.sub !== user.id || claims.iss !== `${settings.supabaseUrl}/auth/v1`
      || claims.aud !== 'authenticated' || claims.role !== 'authenticated' || claims.is_anonymous !== false || user.is_anonymous === true
      || !['ES256', 'RS256'].includes(header?.alg) || !Number.isFinite(claims.exp) || claims.exp <= seconds
      || !Number.isFinite(claims.iat) || claims.iat > seconds + 60 || claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > seconds + 60)) stop('Your signed-in identity could not be verified. Return to ChatGPT and reconnect.');
    return user;
  }
  async function loadDetails() {
    const result = await authClient.oauth.getAuthorizationDetails(authorizationId);
    if (result?.error) stop('This authorization request could not be loaded or has expired. Return to ChatGPT and reconnect.');
    return checkedDetails(result?.data, settings, authorizationId, verifiedUser.id);
  }
  async function decide(decision) {
    if (state.phase !== 'review' || !reviewed) return;
    const expected = JSON.stringify(reviewed);
    emit('working', { message: decision === 'approve' ? 'Connecting this account…' : 'Declining this connection…', details: reviewed, email: verifiedUser.email || '' });
    try {
      const current = await identity();
      if (current.id !== verifiedUser.id) stop('The signed-in account changed. Return to ChatGPT and reconnect.');
      const currentDetails = await loadDetails();
      if (JSON.stringify(currentDetails) !== expected) stop('The requested connection changed. Return to ChatGPT to review a fresh request.');
      const method = decision === 'approve' ? 'approveAuthorization' : 'denyAuthorization';
      // The pinned SDK redirects by default. Validate its returned URL ourselves.
      const result = await authClient.oauth[method](authorizationId, { skipBrowserRedirect: true });
      if (result?.error) stop('The connection decision could not be confirmed. Return to ChatGPT and try again.');
      const target = checkedDecision(result?.data, settings, reviewed, decision);
      accessToken = ''; reviewed = undefined;
      emit('redirecting', { message: 'Returning to ChatGPT…' });
      navigate(target);
    } catch (error) { blocked(error); }
  }
  return Object.freeze({
    async start() {
      if (state.phase !== 'initial') return;
      try { settings = publicConfig(config); authorizationId = authorizationFromLocation(location); emit('login', { message: 'Sign in to review the ASCM connection.' }); }
      catch (error) { blocked(error); }
    },
    async signIn({ email, password } = {}) {
      if (state.phase !== 'login') return;
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 320 || typeof password !== 'string' || !password || password.length > 4096) { emit('login', { message: 'Enter your account email and password.', error: true }); return; }
      emit('signing_in', { message: 'Verifying your account…' });
      try {
        const result = await authClient.signInWithPassword({ email: email.trim(), password });
        if (result?.error || typeof result?.data?.session?.access_token !== 'string' || !result.data.session.access_token) { emit('login', { message: 'Sign-in failed. Check your account details and try again.', error: true }); return; }
        accessToken = result.data.session.access_token;
        verifiedUser = await identity();
        reviewed = await loadDetails();
        emit('review', { message: 'Review the connection before continuing.', details: reviewed, email: verifiedUser.email || '' });
      } catch (error) { blocked(error); }
    },
    connect: () => decide('approve'),
    deny: () => decide('deny'),
  });
}

export function renderAscmConsent(document, state) {
  const node = id => document.getElementById(id);
  const busy = ['signing_in', 'working', 'redirecting'].includes(state.phase);
  node('connectionStatus').textContent = state.message || '';
  node('connectionStatus').setAttribute('data-tone', state.phase === 'blocked' || state.error ? 'error' : 'neutral');
  node('connectionPanel').setAttribute('aria-busy', String(busy));
  node('loginForm').hidden = !['login', 'signing_in'].includes(state.phase);
  node('reviewPanel').hidden = !['review', 'working'].includes(state.phase);
  node('signInButton').disabled = state.phase !== 'login';
  node('connectButton').disabled = state.phase !== 'review';
  node('denyButton').disabled = state.phase !== 'review';
  node('accountEmail').textContent = state.email || '';
  node('clientName').textContent = state.details?.clientName || '';
  node('clientId').textContent = state.details?.clientId || '';
  node('redirectUri').textContent = state.details?.redirectUri || '';
  const scopes = (state.details?.scopes || []).map(scope => { const item = document.createElement('li'); item.textContent = scope === 'email' ? 'email — Share the signed-in account’s email address' : scope; return item; });
  node('scopeList').replaceChildren(...scopes);
}

export async function bootAscmConsent({ document, location, config, createClient, navigate } = {}) {
  let client;
  try { client = createAscmBrowserClient(config, createClient); }
  catch (error) { renderAscmConsent(document, { phase: error instanceof ConsentProblem ? error.phase : 'blocked', message: error instanceof ConsentProblem ? error.message : 'The connection library could not load. Refresh this page and try again.' }); return; }
  const controller = createAscmConsent({ authClient: client.auth, config, location, navigate, onState: state => renderAscmConsent(document, state) });
  document.getElementById('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.getElementById('accountPassword');
    const pending = controller.signIn({ email: document.getElementById('accountEmailInput').value, password: password.value });
    password.value = '';
    await pending;
  });
  document.getElementById('connectButton').addEventListener('click', () => controller.connect());
  document.getElementById('denyButton').addEventListener('click', () => controller.deny());
  await controller.start();
}

if (typeof document !== 'undefined') {
  const start = () => bootAscmConsent({ document, location: window.location, config: globalThis.PPC_ASCM_CONNECT_CONFIG, createClient: globalThis.supabase?.createClient, navigate: target => window.location.assign(target) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
