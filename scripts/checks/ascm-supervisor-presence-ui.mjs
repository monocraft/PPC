import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import '../../public/js/master-presence.js';

const presence = globalThis.PortfolioMasterPresence;
const start = Date.parse('2026-10-17T12:00:00.000Z');
const active = (patch = {}) => ({ enabled: true, working: true, productCount: 12, expiresAt: new Date(start + 120000).toISOString(), reconnectRequired: [], ...patch });
const plain = value => JSON.parse(JSON.stringify(value));
function setup() {
  let time = start, hasKey = true, version = 1, mode = 'service', reply = { sessions: [{ sessionId: 'owner-tab-1234', displayName: 'Alex' }], ascmSupervisor: active() };
  const calls = [];
  const session = { getState: () => ({ configured: true, hasKey, accessVersion: version, pending: [], mode, snapshot: {} }), presence: async body => { calls.push(body); return typeof reply === 'function' ? reply(body) : reply; } };
  const controller = presence.createController({ sessionProvider: () => session, sessionId: 'owner-tab-1234', now: () => time });
  return { controller, calls, session, advance: ms => { time += ms; }, set reply(value) { reply = value; }, set hasKey(value) { hasKey = value; }, set version(value) { version = value; }, set mode(value) { mode = value; } };
}

test('supervisor status piggybacks presence without adding humans or requests', async () => {
  const f = setup();
  assert.equal(f.controller.getState().ascmSupervisor, null);
  await f.controller.heartbeat();
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.getState().onlineCount, 1);
  assert.deepEqual(f.controller.getState().users.map(user => user.label), ['Alex']);
  assert.deepEqual(plain(f.controller.getState().ascmSupervisor), active());
  f.advance(120000);
  assert.deepEqual(plain(f.controller.getState().ascmSupervisor), { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired: [] });
  assert.equal(f.calls.length, 1, 'local expiry never requests another status');
});

test('unsupported disabled malformed and expired payloads cannot fabricate an active supervisor', async () => {
  for (const status of [undefined, null, {}, { enabled: false }, { enabled: 'true', working: true }]) {
    const f = setup(); f.reply = { sessions: [], ascmSupervisor: status }; await f.controller.heartbeat();
    assert.equal(f.controller.getState().ascmSupervisor, null);
  }
  for (const patch of [{ working: false }, { working: 'true' }, { expiresAt: null }, { expiresAt: 'tomorrow' }, { expiresAt: '2026-02-30T12:00:00.000Z' }, { expiresAt: new Date(start).toISOString() }, { expiresAt: new Date(start + 125001).toISOString() }]) {
    const f = setup(); f.reply = { sessions: [], ascmSupervisor: active(patch) }; await f.controller.heartbeat();
    assert.deepEqual(plain(f.controller.getState().ascmSupervisor), { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired: [] });
  }
});

test('only actual integer product counts within the report cap are shown', async () => {
  for (const productCount of [undefined, null, -1, 501, 1.2, '12', NaN, Infinity]) {
    const f = setup(); f.reply = { sessions: [], ascmSupervisor: active({ productCount }) }; await f.controller.heartbeat();
    assert.equal(f.controller.getState().ascmSupervisor.productCount, null);
  }
  for (const productCount of [0, 1, 500]) {
    const f = setup(); f.reply = { sessions: [], ascmSupervisor: active({ productCount }) }; await f.controller.heartbeat();
    assert.equal(f.controller.getState().ascmSupervisor.productCount, productCount);
  }
});

test('connection failure departure unsupported response and GitHub mode clear supervisor state', async () => {
  for (const kind of ['failure', 'leave', 'access', 'github', 'legacy', 'empty']) {
    const f = setup(); await f.controller.heartbeat();
    if (kind === 'failure') f.reply = async () => { throw new Error('offline'); };
    if (kind === 'access') { f.hasKey = false; f.version = 2; }
    if (kind === 'github') f.mode = 'github';
    if (kind === 'legacy') f.reply = { sessions: [] };
    if (kind === 'empty') f.reply = null;
    if (kind === 'leave') await f.controller.leave(); else await f.controller.heartbeat();
    assert.equal(f.controller.getState().ascmSupervisor, null, kind);
  }
});

test('late old-access responses and failures cannot restore or replace current supervisor state', async () => {
  const f = setup(), pending = [];
  f.reply = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const old = f.controller.heartbeat(); f.version = 2;
  const current = f.controller.heartbeat();
  pending[1].resolve({ sessions: [], ascmSupervisor: { enabled: true, working: false, productCount: null, expiresAt: null } }); await current;
  pending[0].resolve({ sessions: [], ascmSupervisor: active({ reconnectRequired: ['outlook'] }) }); await old;
  assert.equal(f.controller.getState().ascmSupervisor.working, false);
  assert.deepEqual(f.controller.getState().ascmSupervisor.reconnectRequired, []);
  const older = f.controller.heartbeat(); f.version = 3; const latest = f.controller.heartbeat();
  pending[3].resolve({ sessions: [], ascmSupervisor: active({ productCount: 1 }) }); await latest;
  pending[2].reject(new Error('old failure')); await older;
  assert.equal(f.controller.getState().ascmSupervisor.productCount, 1);
  const departing = f.controller.heartbeat(); f.hasKey = false; f.version = 4; await f.controller.heartbeat();
  pending[4].resolve({ sessions: [], ascmSupervisor: active() }); await departing;
  assert.equal(f.controller.getState().ascmSupervisor, null);
});

class Element {
  constructor(tag = 'div', ownerDocument) { this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.className = ''; this.hidden = false; this.textContent = ''; this.title = ''; this.parentNode = null; this.classList = { toggle: (name, on) => { const values = new Set(this.className.split(/\s+/).filter(Boolean)); if (on) values.add(name); else values.delete(name); this.className = [...values].join(' '); }, contains: name => this.className.split(/\s+/).includes(name) }; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  querySelector(selector) { for (const child of this.children) { if (child.className.split(/\s+/).includes(selector.slice(1))) return child; const nested = child.querySelector(selector); if (nested) return nested; } return null; }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  click() { for (const listener of this.listeners.get('click') || []) listener({ target: this }); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  set innerHTML(_) { assert.fail('Status rendering must use inert DOM nodes'); }
}
function viewFixture() {
  let time = start, sequence = 0;
  const timers = new Map(), indicator = new Element('span'), rosterContainer = new Element();
  const documentObject = { visibilityState: 'visible', activeElement: null, createElement: tag => new Element(tag, documentObject), createElementNS: (namespace, tag) => { const node = new Element(tag, documentObject); node.namespaceURI = namespace; return node; } };
  const focusFallback = new Element('button', documentObject);
  const view = presence.createAscmSupervisorView({ documentObject, indicator, rosterContainer, focusFallback, now: () => time,
    setTimeoutImpl: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id; }, clearTimeoutImpl: id => timers.delete(id) });
  return { view, indicator, rosterContainer, focusFallback, documentObject, timers, advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } } };
}

test('enabled supervisor has its own noninteractive portrait and a blank name while actual work stays in the toolbar', () => {
  const f = viewFixture();
  const state = { connected: true, unavailable: false, mode: 'service', ascmSupervisor: active() };
  f.view.render(state);
  assert.equal(f.indicator.hidden, false);
  assert.equal(f.indicator.querySelector('.ascm-supervisor-label').textContent, 'Updating ASCM · 12 products');
  assert.equal(f.indicator.classList.contains('is-working'), true);
  const row = f.rosterContainer.children[0], portrait = row.querySelector('.ascm-supervisor-portrait'), person = row.querySelector('.ascm-supervisor-person');
  assert.equal(row.hidden, false);
  assert(portrait, 'enabled supervisor has a dedicated face outside the human roster');
  assert.equal(row.children[0], portrait, 'portrait occupies the left column before the name position');
  assert.equal(row.children[1], person);
  assert.equal(portrait.tagName, 'SPAN');
  assert.equal(portrait.getAttribute('role'), 'img');
  assert.equal(portrait.getAttribute('aria-label'), 'ASCM supervisor');
  assert.equal(portrait.listeners.size, 0, 'supervisor portrait is not a poke or a human action');
  assert.equal(portrait.children[0].tagName, 'SVG');
  assert.equal(portrait.children[0].namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(portrait.className.includes('master-presence-avatar'), false);
  assert.equal(person.querySelector('.ascm-supervisor-reconnect').hidden, true);
  for (const reconnectRequired of [undefined, [], ['unsupported'], 'outlook', false]) {
    f.view.render({ ...state, ascmSupervisor: active({ reconnectRequired }) });
    assert.equal(row.hidden, false, 'enabled supervisor retains its identity without fabricating a connection warning');
    assert.equal(row.querySelector('.ascm-supervisor-portrait'), portrait);
    assert.equal(person.querySelector('.ascm-supervisor-reconnect').hidden, true);
  }
  f.view.render({ ...state, ascmSupervisor: active({ productCount: 1 }) });
  assert.equal(f.indicator.title, 'Updating ASCM · 1 product');
  f.view.render({ ...state, ascmSupervisor: active({ productCount: null }) });
  assert.equal(f.indicator.title, 'Updating ASCM');
  f.advance(120000);
  assert.equal(f.indicator.classList.contains('is-working'), false);
  assert.equal(f.indicator.title, 'ASCM supervisor');
  assert.equal(f.indicator.querySelector('.ascm-supervisor-label').hidden, true);
  assert.equal(row.hidden, false);
  assert.equal(f.timers.size, 0);
  assert(!f.rosterContainer.children[0].className.includes('avatar'));
  for (const statePatch of [{ ascmSupervisor: null }, { ascmSupervisor: { enabled: false } }, { connected: false }, { unavailable: true }, { mode: 'github' }]) {
    f.view.render({ ...state, ...statePatch });
    assert.equal(row.hidden, true, 'unsupported or unavailable state hides the complete supervisor identity');
  }
});

test('DOM animation stops on disconnect visibility pause or disposal and never leaks a timer', () => {
  const f = viewFixture(), state = { connected: true, mode: 'service', ascmSupervisor: active() };
  f.view.render(state); f.view.render(state); assert.equal(f.timers.size, 1);
  f.documentObject.visibilityState = 'hidden'; f.view.render(state);
  assert.equal(f.indicator.classList.contains('is-paused'), true);
  f.view.render({ ...state, connected: false });
  assert.equal(f.indicator.hidden, true); assert.equal(f.rosterContainer.children[0].hidden, true); assert.equal(f.timers.size, 0);
  f.documentObject.visibilityState = 'visible'; f.view.render(state); f.view.destroy(); f.advance(120000);
  assert.equal(f.indicator.hidden, true); assert.equal(f.rosterContainer.children.length, 0); assert.equal(f.timers.size, 0);
});

test('only reported supported reconnect flags survive snapshots and lease expiry until a real response clears them', async () => {
  const f = setup();
  f.reply = { sessions: [], ascmSupervisor: active({ reconnectRequired: ['outlook', 'outlook', '<img onerror=alert(1)>', 'sharepoint', 'Outlook', null] }) };
  await f.controller.heartbeat();
  assert.deepEqual(f.controller.getState().ascmSupervisor.reconnectRequired, ['outlook', 'sharepoint']);
  f.controller.getState().ascmSupervisor.reconnectRequired.length = 0;
  assert.deepEqual(f.controller.getState().ascmSupervisor.reconnectRequired, ['outlook', 'sharepoint']);
  f.advance(120000);
  assert.deepEqual(f.controller.getState().ascmSupervisor.reconnectRequired, ['outlook', 'sharepoint']);
  assert.equal(f.calls.length, 1);
  f.reply = { sessions: [], ascmSupervisor: { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired: [] } };
  await f.controller.heartbeat();
  assert.deepEqual(f.controller.getState().ascmSupervisor.reconnectRequired, []);
});

test('only reported connection loss exposes a nontext key action and honest handoff without requests or flag clearing', async () => {
  const controllerFixture = setup(), f = viewFixture();
  controllerFixture.reply = { sessions: [], ascmSupervisor: { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired: ['outlook'] } };
  await controllerFixture.controller.heartbeat();
  f.view.render(controllerFixture.controller.getState());
  const action = f.rosterContainer.querySelector('.ascm-supervisor-reconnect');
  assert(action, 'reported connection loss offers recovery');
  const hint = f.rosterContainer.querySelector('.ascm-reconnect-handoff');
  const portrait = f.rosterContainer.querySelector('.ascm-supervisor-portrait');
  assert.equal(f.rosterContainer.children[0].hidden, false);
  const visibleText = node => node.hidden ? '' : node.textContent + node.children.map(visibleText).join('');
  assert.equal(visibleText(f.rosterContainer), '', 'collapsed recovery displays no supervisor, work status or action text');
  assert.equal(action.getAttribute('aria-label'), 'Reconnect Microsoft');
  assert.equal(action.children[0].tagName, 'SVG');
  assert.equal(action.children[0].namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(action.children[0].getAttribute('aria-hidden'), 'true');
  assert.equal(action.getAttribute('aria-expanded'), 'false');
  assert.equal(hint.hidden, true);
  action.click();
  assert.equal(hint.hidden, false);
  assert.equal(action.getAttribute('aria-expanded'), 'true');
  assert.equal(action.getAttribute('aria-controls'), hint.id);
  assert.match(hint.children[0].textContent, /Open ChatGPT → Settings → Plugins → Outlook or SharePoint → Reconnect/);
  assert.equal(hint.children[1].textContent, 'Complete Microsoft sign-in, then return here.');
  assert.equal(hint.children[2].textContent, 'Status updates after the next successful supervisor check.');
  const link = hint.querySelector('.ascm-reconnect-link');
  assert.equal(link.textContent, 'Open ChatGPT');
  assert.equal(link.href, 'https://chatgpt.com/');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  link.click();
  assert.deepEqual(controllerFixture.controller.getState().ascmSupervisor.reconnectRequired, ['outlook']);
  assert.equal(controllerFixture.calls.length, 1);
  assert.equal(f.indicator.title, 'ASCM supervisor');
  controllerFixture.reply = { sessions: [], ascmSupervisor: { enabled: true, working: false, productCount: null, expiresAt: null } };
  await controllerFixture.controller.heartbeat(); f.view.render(controllerFixture.controller.getState());
  assert.equal(action, f.rosterContainer.querySelector('.ascm-supervisor-reconnect'));
  assert.equal(action.hidden, true, 'a real healthy response removes the recovery action');
  assert.equal(f.rosterContainer.children[0].hidden, false, 'recovery keeps the configured supervisor face visible');
  assert.equal(f.rosterContainer.querySelector('.ascm-supervisor-portrait'), portrait);
  assert.equal(f.rosterContainer.querySelector('.ascm-supervisor-person').children[0], action, 'key remains in the name position beside the portrait');
  assert.equal(hint.hidden, true);
  action.click();
  assert.equal(hint.hidden, true, 'a stale key activation cannot reopen recovery after the warning cleared');
});

test('reconnect focus survives lost-state updates and closes safely on Escape, recovery, unavailable status and disposal', () => {
  const f = viewFixture(), state = { connected: true, mode: 'service', ascmSupervisor: active({ reconnectRequired: ['outlook'] }) };
  f.view.render(state);
  const action = f.rosterContainer.querySelector('.ascm-supervisor-reconnect'), hint = f.rosterContainer.querySelector('.ascm-reconnect-handoff');
  assert(action, 'reconnect action exists');
  action.click(); hint.querySelector('.ascm-reconnect-link').focus();
  f.view.render({ ...state, ascmSupervisor: active({ productCount: 1, reconnectRequired: ['outlook'] }) });
  assert.equal(hint.hidden, false);
  assert.equal(f.documentObject.activeElement, hint.querySelector('.ascm-reconnect-link'));
  assert.equal(f.indicator.title, 'Updating ASCM · 1 product');
  assert.equal(f.view.closeReconnect(), true);
  assert.equal(hint.hidden, true);
  assert.equal(f.documentObject.activeElement, action);
  assert.equal(f.view.closeReconnect(), false, 'outer Users Escape can proceed after the hint closes');
  action.click(); hint.querySelector('.ascm-reconnect-link').focus();
  f.view.render({ ...state, ascmSupervisor: active() });
  assert.equal(hint.hidden, true);
  assert.equal(f.rosterContainer.children[0].hidden, false);
  assert.equal(action.hidden, true);
  assert.equal(f.documentObject.activeElement, f.focusFallback);
  f.view.render(state); action.click(); hint.querySelector('.ascm-reconnect-link').focus();
  f.view.render({ ...state, connected: false });
  assert.equal(hint.hidden, true);
  assert.equal(f.documentObject.activeElement, f.focusFallback);
  f.view.render(state); action.click(); f.view.destroy(); action.click();
  assert.equal(hint.hidden, true);
  assert.equal(f.rosterContainer.children.length, 0);
});

if (process.argv.includes('--preview')) {
  const index = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
  const toolbar = index.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0];
  assert(toolbar);
  const routes = new Set(['/css/styles.css', '/css/fonts.css', '/css/presence-expressions.css', '/js/master-presence.js', '/js/presence-expressions.js', '/assets/fonts/Jost-Variable.ttf']);
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'");
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      const mode = ['idle', 'disabled', 'expired', 'unknown', 'reconnect'].includes(url.searchParams.get('state')) ? url.searchParams.get('state') : 'active';
      const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ASCM reconnect · local preview</title><link rel="stylesheet" href="css/fonts.css"><link rel="stylesheet" href="css/styles.css"><link rel="stylesheet" href="css/presence-expressions.css"><script>
const fixtureMode=${JSON.stringify(mode)};
const fixtureSession={getState:()=>({configured:true,hasKey:true,accessVersion:1,pending:[]}),presence:async body=>({sessions:[{sessionId:body.sessionId,displayName:'Alex',categoryName:'PC Gaming Audio'},{sessionId:'fixture-sam-1234',displayName:'Sam',categoryName:'Mice'}],...(fixtureMode==='disabled'?{}:{ascmSupervisor:{enabled:true,working:!['idle','reconnect'].includes(fixtureMode),productCount:['idle','reconnect','unknown'].includes(fixtureMode)?null:12,expiresAt:['idle','reconnect'].includes(fixtureMode)?null:new Date(Date.now()+(fixtureMode==='expired'?-1000:120000)).toISOString(),reconnectRequired:fixtureMode==='reconnect'?['outlook']:[]}})})};
globalThis.PortfolioMasterUI={getSession:()=>fixtureSession};
</script><script defer src="js/presence-expressions.js"></script><script defer src="js/master-presence.js"></script></head><body><main class="app-shell"><div class="workspace-main">${toolbar.replace('<div id="categoryNavigation" class="category-navigation-host" aria-label="Product categories"></div>', '<div id="categoryNavigation" class="category-navigation-host" aria-label="Product categories"><button type="button">PC Gaming Audio</button></div>')}<div id="fixtureNotice" role="status" style="padding:12px 16px;color:#BBBCC0;font-size:12px;border-top:1px solid #333538">Preview · synthetic Microsoft connection status. No portfolio changes or automatic external requests.</div><section style="margin:24px;border:1px solid #333538;padding:24px;color:#BBBCC0">Open Users to see the supervisor's own face. A lost connection adds the key alert beside it; healthy status keeps the face without a name or key. Open ChatGPT opens the real website in a new tab; no sign-in is required to try this preview.</section></div></main></body></html>`;
      response.setHeader('Content-Type', 'text/html'); response.end(body); return;
    }
    if (!routes.has(url.pathname)) { response.writeHead(404); response.end(); return; }
    try { const bytes = await readFile(new URL(`../../public${url.pathname}`, import.meta.url)); response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'font/ttf'); response.end(bytes); }
    catch { response.writeHead(404); response.end(); }
  });
  server.listen(4199, '127.0.0.1', () => console.log(`Local ASCM reconnect preview: http://127.0.0.1:4199/?state=reconnect (PID ${process.pid})`));
}
