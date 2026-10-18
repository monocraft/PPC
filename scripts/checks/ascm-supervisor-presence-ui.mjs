import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import vm from 'node:vm';
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
  removeAttribute(name) { this.attributes.delete(name); if (name === 'title') this.title = ''; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  querySelector(selector) { for (const child of this.children) { if (child.className.split(/\s+/).includes(selector.slice(1))) return child; const nested = child.querySelector(selector); if (nested) return nested; } return null; }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type, details = {}) { const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...details }; for (const listener of this.listeners.get(type) || []) listener(event); return event; }
  click() { this.dispatch('click'); }
  focus() { if (this.ownerDocument) { this.ownerDocument.activeElement?.blur?.(); this.ownerDocument.activeElement = this; } this.dispatch('focus'); }
  blur() { if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = null; this.dispatch('blur'); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  set innerHTML(_) { assert.fail('Status rendering must use inert DOM nodes'); }
}
class HeaderElement extends Element {
  constructor(tag, ownerDocument) { super(tag, ownerDocument); this.dataset = {}; this.style = {}; this.classList.add = name => this.classList.toggle(name, true); }
  setAttribute(name, value) { super.setAttribute(name, value); if (name === 'class') this.className = String(value); }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  insertBefore(node, before) { node.remove(); const index = before ? this.children.indexOf(before) : this.children.length; assert(index >= 0); this.children.splice(index, 0, node); node.parentNode = this; }
  replaceWith(node) { this.parentNode.insertBefore(node, this); this.remove(); }
  matches(selector) { return selector === 'button' ? this.tagName === 'BUTTON' : selector === ':focus-visible' ? this.keyboardFocus === true : selector === '[data-opens-roster]' ? Boolean(this.dataset.opensRoster) : selector.startsWith('.') && this.classList.contains(selector.slice(1)); }
  querySelectorAll(selector) { return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(child => selector === '*' || child.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
async function headerFixture() {
  const source = await readFile(new URL('../../public/js/master-presence.js', import.meta.url), 'utf8');
  const documentEvents = new Element();
  const documentObject = { visibilityState: 'visible', activeElement: null, addEventListener: (...args) => documentEvents.addEventListener(...args), removeEventListener: (...args) => documentEvents.removeEventListener(...args), dispatch: (...args) => documentEvents.dispatch(...args), createElement: tag => new HeaderElement(tag, documentObject), createElementNS: (_, tag) => new HeaderElement(tag, documentObject) };
  const brand = documentObject.createElement('div'), indicator = documentObject.createElement('span'); brand.className = 'brand-block';
  documentObject.querySelector = selector => selector === '.brand-block' ? brand : null;
  documentObject.getElementById = id => id === 'ascmSupervisorIndicator' ? indicator : null;
  let reply = { sessions: [{ sessionId: 'owner-tab-1234', displayName: 'Alex' }, { sessionId: 'teammate-tab-5678', displayName: 'Sam' }], pokeSupported: true, ascmSupervisor: active() }, mode = 'service', calls = 0;
  const pokes = [], session = { getState: () => ({ configured: true, hasKey: true, accessVersion: 1, mode, pending: [], snapshot: {}, editorProfile: { sessionId: 'owner-tab-1234' } }), presence: async () => { calls += 1; if (reply instanceof Error) throw reply; return reply; } };
  const sandbox = { document: documentObject, AbortController, Date: class extends Date { static now() { return start; } }, addEventListener() {}, matchMedia: () => ({ matches: false }), setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const app = sandbox.PortfolioMasterPresence.initialize({ sessionProvider: () => session, onPoke: async user => { pokes.push(user.sessionId); return { status: 'queued' }; } });
  await app.refresh();
  return { app, brand, indicator, documentObject, pokes, get calls() { return calls; }, set reply(value) { reply = value; }, set mode(value) { mode = value; } };
}

test('enabled supervisor is visible beside header people before opening the dialog without becoming a human or poke target', async () => {
  const f = await headerFixture();
  try {
    const shell = f.brand.querySelector('.master-presence'), stack = shell.querySelector('.master-presence-avatars'), popover = shell.querySelector('.master-presence-popover');
    const bot = shell.querySelector('.ascm-supervisor-header');
    assert(bot, 'the main header exposes the supervisor face without opening the people dialog');
    assert.equal(bot.hidden, false);
    assert.equal(popover.hidden, true);
    assert.equal(bot.parentNode, shell);
    assert.equal(stack.nextSibling, bot, 'bot sits immediately beside visible people');
    assert(bot.querySelector('.ascm-supervisor-face'));
    assert.equal(bot.tagName, 'BUTTON');
    assert.equal(bot.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(bot.getAttribute('aria-controls'), popover.id);
    assert.equal(bot.getAttribute('aria-expanded'), 'false');
    assert.equal(bot.getAttribute('aria-label'), 'ASCM supervisor. View connection status');
    assert.equal(bot.dataset.sessionId, undefined);
    assert.equal(bot.matches('.presence-header-person'), false, 'bot is excluded from human neighbor registration');
    assert.equal(bot.querySelector('.master-presence-avatar'), null);
    assert.equal(stack.children.length, 2);
    assert.equal(f.app.controller.getState().onlineCount, 2);
    assert.equal(shell.querySelector('.master-presence-trigger').title, '2 connected sessions');
    assert.equal(f.calls, 1, 'rendering the header face adds no request');
    const teammate = stack.children.find(node => node.dataset.sessionId === 'teammate-tab-5678');
    teammate.click(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(f.pokes, ['teammate-tab-5678'], 'human poke remains available');
    bot.keyboardFocus = true; bot.focus(); bot.click(); await f.app.refresh();
    assert.equal(popover.hidden, false);
    assert.equal(bot.getAttribute('aria-expanded'), 'true');
    assert.equal(f.documentObject.activeElement, shell.querySelector('.master-presence-close'));
    assert.deepEqual(f.pokes, ['teammate-tab-5678'], 'supervisor activation opens status instead of sending a poke');
    shell.querySelector('.master-presence-close').click();
    assert.equal(popover.hidden, true);
    assert.equal(bot.getAttribute('aria-expanded'), 'false');
    assert.equal(f.documentObject.activeElement, bot, 'keyboard close returns to the supervisor control');
    for (const status of [{ enabled: true, working: false }, active({ expiresAt: new Date(start - 1000).toISOString() }), active({ reconnectRequired: ['outlook'] })]) {
      f.reply = { sessions: [{ sessionId: 'owner-tab-1234', displayName: 'Alex' }], ascmSupervisor: status }; await f.app.refresh();
      assert.equal(bot.hidden, false, 'enabled idle expired and reconnect states retain the face');
      assert.equal(f.app.controller.getState().onlineCount, 1);
    }
    for (const reply of [{ sessions: [], ascmSupervisor: { enabled: false } }, { sessions: [] }, new Error('offline')]) {
      f.reply = reply; await f.app.refresh(); assert.equal(bot.hidden, true, 'disabled unsupported and disconnected states hide the face');
    }
    f.reply = { sessions: [], ascmSupervisor: active() }; await f.app.refresh(); assert.equal(bot.hidden, false);
    f.mode = 'github'; await f.app.refresh(); assert.equal(bot.hidden, true, 'recent editors never expose service supervisor status');
  } finally { f.app.destroy(); }
});

function viewFixture(initialTime = start, random = Math.random) {
  let time = initialTime, sequence = 0;
  const timers = new Map(), indicator = new Element('span'), rosterContainer = new Element();
  const documentEvents = new Element();
  const documentObject = { visibilityState: 'visible', activeElement: null, addEventListener: (...args) => documentEvents.addEventListener(...args), removeEventListener: (...args) => documentEvents.removeEventListener(...args), dispatch: (...args) => documentEvents.dispatch(...args), createElement: tag => new Element(tag, documentObject), createElementNS: (namespace, tag) => { const node = new Element(tag, documentObject); node.namespaceURI = namespace; return node; } };
  indicator.ownerDocument = documentObject;
  const focusFallback = new Element('button', documentObject), headerControl = new Element('button', documentObject);
  headerControl.title = 'ASCM supervisor'; headerControl.setAttribute('aria-label', 'ASCM supervisor. View connection status');
  const view = presence.createAscmSupervisorView({ documentObject, indicator, rosterContainer, headerControl, focusFallback, now: () => time, random,
    setTimeoutImpl: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id; }, clearTimeoutImpl: id => timers.delete(id) });
  return { view, indicator, rosterContainer, headerControl, focusFallback, documentObject, timers, advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } } };
}

test('clock age is fresh for 0–29 local days and warns at 30 with a noncolor description', () => {
  const previousZone = process.env.TZ; process.env.TZ = 'America/Los_Angeles';
  try {
    for (const [at, age, freshness] of [
      ['2026-10-17T08:00:00.000Z', 'Today', 'fresh'],
      ['2026-09-18T12:00:00.000Z', '29 days ago', 'fresh'],
      ['2026-09-17T12:00:00.000Z', '30 days ago', 'alert'],
      ['2026-09-16T12:00:00.000Z', '31 days ago', 'alert'],
    ]) {
      const f = viewFixture();
      f.view.render({ connected: true, mode: 'service', ascmSupervisor: { enabled: true, working: false, lastUpdatedAt: at } });
      f.indicator.focus();
      const elapsed = f.indicator.querySelector('.ascm-update-elapsed'), tooltip = f.indicator.querySelector('.ascm-update-tooltip');
      assert.equal(elapsed.textContent, age);
      assert.equal(elapsed.classList.contains('is-fresh'), freshness === 'fresh', age);
      assert.equal(elapsed.classList.contains('is-alert'), freshness === 'alert', age);
      assert.match(tooltip.getAttribute('aria-label'), freshness === 'fresh' ? /Under 30 days old/ : /30 or more days old/);
      f.view.destroy();
    }
    for (const lastUpdatedAt of [undefined, '', 'invalid', '2026-02-30T12:00:00.000Z', '2026-10-18T12:00:00.000Z']) {
      const f = viewFixture();
      f.view.render({ connected: true, mode: 'service', ascmSupervisor: { enabled: true, lastUpdatedAt } });
      const elapsed = f.indicator.querySelector('.ascm-update-elapsed');
      assert.equal(elapsed.hidden, true);
      assert.equal(elapsed.classList.contains('is-fresh'), false);
      assert.equal(elapsed.classList.contains('is-alert'), false);
      assert.equal(f.indicator.querySelector('.ascm-update-tooltip').getAttribute('aria-label'), 'No ASCM update recorded.');
      f.view.destroy();
    }
  } finally { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; }
});

test('face offers 100 distinct reachable short replies and age templates only with a valid accepted date', () => {
  const replies = new Set(), unknownReplies = new Set();
  const collect = (count, lastUpdatedAt, target) => {
    for (let index = 0; index < count; index += 1) {
      const f = viewFixture(start, () => (index + 0.1) / count);
      f.view.render({ connected: true, mode: 'service', ascmSupervisor: { enabled: true, lastUpdatedAt } });
      f.headerControl.dispatch('pointerenter');
      const bubble = f.headerControl.querySelector('.ascm-face-tooltip');
      assert(bubble, 'face has an accessible custom speech tooltip');
      const reply = bubble.querySelector('.ascm-face-reply').textContent;
      assert(reply.length > 0 && reply.length <= 90, reply);
      assert(!reply.includes('{age}'));
      target.add(reply); f.view.destroy();
    }
  };
  collect(100, '2026-10-15T12:00:00.000Z', replies);
  assert.equal(replies.size, 100, 'all 100 authored replies are reachable without duplicates');
  assert(replies.has('Hi.')); assert(replies.has('I gotchu.'));
  assert([...replies].some(reply => /What do you want\?/.test(reply)));
  assert(replies.has('I last updated ASCM 2 days ago.'));
  assert(replies.has('ASCM updated 2 days ago.'));
  for (const invalid of [undefined, 'invalid', '2026-10-18T12:00:00.000Z']) {
    unknownReplies.clear(); collect(96, invalid, unknownReplies);
    assert.equal(unknownReplies.size, 96);
    assert([...unknownReplies].every(reply => replies.has(reply)), 'unknown ages use only the timeless personality pool');
    assert(![...unknownReplies].some(reply => /(?:updated|last update|days? ago)/i.test(reply)), 'unknown never becomes a fabricated successful update');
  }
  for (const [at, expected] of [['2026-10-17T00:00:00.000Z', 'I last updated ASCM today.'], ['2026-10-16T00:00:00.000Z', 'I last updated ASCM 1 day ago.']]) {
    const f = viewFixture(start, () => 0.001);
    // UTC keeps these grammar checks independent of the machine's local zone.
    const previousZone = process.env.TZ; process.env.TZ = 'UTC';
    try {
      f.view.render({ connected: true, mode: 'service', ascmSupervisor: { enabled: true, lastUpdatedAt: at } });
      f.headerControl.focus();
      assert.equal(f.headerControl.querySelector('.ascm-face-reply').textContent, expected);
    } finally { f.view.destroy(); if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; }
  }
});

test('face speech stays stable across pointer bridge rerenders and expiry and avoids immediate repeats', () => {
  let selections = 0;
  const f = viewFixture(start, () => { selections += 1; return 0; }), state = { connected: true, mode: 'service', ascmSupervisor: active({ lastUpdatedAt: '2026-10-15T12:00:00.000Z' }) };
  f.view.render(state);
  const bubble = f.headerControl.querySelector('.ascm-face-tooltip');
  assert(bubble); assert.equal(bubble.hidden, true); assert.equal(bubble.getAttribute('role'), 'tooltip');
  assert.equal(f.headerControl.getAttribute('aria-describedby'), bubble.id);
  assert.equal(f.headerControl.title, '', 'custom tooltip replaces native title');
  assert.equal(f.headerControl.getAttribute('aria-label'), 'ASCM supervisor. View connection status');
  f.headerControl.dispatch('pointerenter'); const first = bubble.querySelector('.ascm-face-reply').textContent;
  assert.equal(bubble.hidden, false); assert.equal(selections, 1);
  f.headerControl.dispatch('pointerleave', { relatedTarget: bubble }); bubble.dispatch('pointerenter');
  assert.equal(bubble.hidden, false, 'crossing the bridge keeps the bubble open');
  f.headerControl.focus(); f.view.render(state); f.advance(120000);
  assert.equal(bubble.querySelector('.ascm-face-reply').textContent, first);
  assert.equal(selections, 1, 'refresh and expiry do not draw another reply');
  assert.equal(f.timers.size, 0, 'speech adds no timer beyond the existing work lease');
  bubble.dispatch('pointerleave'); assert.equal(bubble.hidden, false, 'focus keeps speech open');
  f.headerControl.blur(); assert.equal(bubble.hidden, true);
  f.headerControl.dispatch('pointerenter');
  assert.notEqual(bubble.querySelector('.ascm-face-reply').textContent, first, 'even repeated random input avoids an immediate repeated reply');
  assert.equal(selections, 2); f.view.destroy();
});

test('face speech supports focus Escape blur visibility disconnect and destruction without extra timers', () => {
  const f = viewFixture(), state = { connected: true, mode: 'service', ascmSupervisor: { enabled: true, working: false } };
  f.view.render(state);
  const bubble = f.headerControl.querySelector('.ascm-face-tooltip'); assert(bubble);
  f.headerControl.focus(); assert.equal(bubble.hidden, false);
  const escape = f.documentObject.dispatch('keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true); assert.equal(bubble.hidden, true);
  f.view.render(state); assert.equal(bubble.hidden, true);
  assert.equal(f.documentObject.activeElement, f.headerControl);
  f.headerControl.blur(); f.headerControl.focus(); assert.equal(bubble.hidden, false);
  f.headerControl.blur(); assert.equal(bubble.hidden, true);
  f.headerControl.dispatch('pointerenter');
  f.documentObject.visibilityState = 'hidden'; f.documentObject.dispatch('visibilitychange'); assert.equal(bubble.hidden, true);
  f.documentObject.visibilityState = 'visible'; f.view.render(state); assert.equal(bubble.hidden, true, 'visibility return waits for another opening');
  for (const patch of [{ connected: false }, { unavailable: true }, { mode: 'github' }, { ascmSupervisor: { enabled: false } }]) {
    f.view.render(state); f.headerControl.dispatch('pointerenter'); assert.equal(bubble.hidden, false);
    f.view.render({ ...state, ...patch }); assert.equal(bubble.hidden, true);
    f.view.render(state); assert.equal(bubble.hidden, true, 'reconnection alone cannot reopen speech');
  }
  f.headerControl.disabled = true; f.headerControl.dispatch('pointerenter'); assert.equal(bubble.hidden, true);
  f.headerControl.disabled = false;
  f.headerControl.dispatch('pointerenter'); f.view.destroy();
  assert.equal(bubble.hidden, true); assert.equal(bubble.parentNode, null);
  assert.equal(f.headerControl.getAttribute('aria-describedby'), null);
  f.headerControl.dispatch('pointerenter'); f.headerControl.focus(); f.documentObject.dispatch('visibilitychange');
  assert.equal(bubble.hidden, true); assert.equal(f.timers.size, 0);
  assert([...f.headerControl.listeners.values()].every(listeners => listeners.size === 0), 'destroy removes every face listener');
});

test('actual header face keeps speech local and Escape dismisses it before the open roster', async () => {
  const f = await headerFixture();
  try {
    const bot = f.brand.querySelector('.ascm-supervisor-header'), bubble = bot.querySelector('.ascm-face-tooltip');
    const popover = f.brand.querySelector('.master-presence-popover');
    assert(bubble); assert.equal(bot.title, '');
    const before = f.calls;
    bot.dispatch('pointerenter'); assert.equal(bubble.hidden, false);
    bot.focus(); assert.equal(f.calls, before, 'opening personality never calls presence');
    bot.click(); assert.equal(bubble.hidden, true, 'face activation dismisses speech before opening connection details');
    assert.equal(popover.hidden, false);
    bot.blur(); bot.focus(); assert.equal(bubble.hidden, false);
    const event = f.documentObject.dispatch('keydown', { key: 'Escape' });
    assert.equal(event.defaultPrevented, true); assert.equal(bubble.hidden, true);
    assert.equal(popover.hidden, false, 'the same Escape event cannot also close the roster');
    assert.equal(f.documentObject.activeElement, bot);
    f.documentObject.dispatch('keydown', { key: 'Escape' }); assert.equal(popover.hidden, true);
    assert.equal(f.app.controller.getState().onlineCount, 2);
    assert.deepEqual(f.pokes, []);
  } finally { f.app.destroy(); }
});

test('accepted ASCM timestamp survives controller normalization and lease expiry without another request', async () => {
  const f = setup(), lastUpdatedAt = '2026-10-15T12:00:00.000Z';
  f.reply = { sessions: [{ sessionId: 'owner-tab-1234', displayName: 'Alex' }], ascmSupervisor: active({ lastUpdatedAt }) };
  await f.controller.heartbeat();
  assert.equal(f.controller.getState().ascmSupervisor.lastUpdatedAt, lastUpdatedAt, 'normalization preserves accepted update time');
  f.advance(120000);
  assert.deepEqual(plain(f.controller.getState().ascmSupervisor), { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired: [], lastUpdatedAt });
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.getState().onlineCount, 1);
  for (const value of [undefined, null, false, 42, {}, [], '', 'tomorrow', '2026-02-30T12:00:00.000Z', '2026-10-15T12:00:00+00:00', '2026-10-15T12:00:00.1Z', new Date(start + 120001).toISOString()]) {
    const status = presence.normalizeAscmSupervisor(active({ lastUpdatedAt: value }), start);
    assert.equal(Object.hasOwn(status, 'lastUpdatedAt'), false, String(value));
    assert.equal(status.working, true, 'invalid age does not suppress genuine work');
  }
  const idle = presence.normalizeAscmSupervisor({ enabled: true, working: false, lastUpdatedAt: '2026-10-15T12:00:00Z' }, start);
  assert.equal(idle.lastUpdatedAt, lastUpdatedAt);
});

test('clock offers a persistent styled hover and focus description without native title or new timer', () => {
  const f = viewFixture(), state = { connected: true, mode: 'service', ascmSupervisor: active({ working: false, lastUpdatedAt: '2026-10-15T12:00:00.000Z' }) };
  f.view.render(state);
  const tooltip = f.indicator.querySelector('.ascm-update-tooltip');
  assert(tooltip, 'clock has a dedicated styled readout');
  assert.equal(tooltip.hidden, true);
  assert.equal(tooltip.getAttribute('role'), 'tooltip');
  assert.equal(tooltip.getAttribute('aria-live'), 'off');
  assert.equal(f.indicator.getAttribute('tabindex'), '0');
  assert.equal(f.indicator.getAttribute('aria-describedby'), tooltip.id);
  assert.equal(f.indicator.title, '');
  const priorFocus = new Element('button', f.documentObject); priorFocus.focus();
  f.indicator.dispatch('pointerenter');
  assert.equal(tooltip.hidden, false);
  assert.equal(f.documentObject.activeElement, priorFocus);
  assert.equal(f.timers.size, 0);
  tooltip.dispatch('pointerenter');
  assert.equal(tooltip.hidden, false, 'moving into its descendant card keeps the hover open');
  f.indicator.focus(); f.indicator.dispatch('pointerleave');
  assert.equal(tooltip.hidden, false, 'keyboard focus keeps the description open after pointer leaves');
  f.indicator.blur(); assert.equal(tooltip.hidden, true);
  f.indicator.focus(); assert.equal(tooltip.hidden, false);
  assert.equal(f.view.closeUpdateTooltip(), true);
  assert.equal(tooltip.hidden, true);
  assert.equal(f.documentObject.activeElement, f.indicator);
  f.view.render(state); assert.equal(tooltip.hidden, true, 'normal refresh cannot undo Escape dismissal');
  f.indicator.blur(); f.indicator.focus(); assert.equal(tooltip.hidden, false);
  f.view.render({ ...state, ascmSupervisor: { enabled: true, working: false } });
  assert.equal(tooltip.hidden, false, 'open card refreshes in place');
  assert.equal(f.indicator.querySelector('.ascm-update-heading').textContent, 'No ASCM update recorded.');
  assert.equal(f.indicator.querySelector('.ascm-update-elapsed').hidden, true);
  assert.equal(f.indicator.querySelector('.ascm-update-date').hidden, true);
  f.view.render({ ...state, connected: false }); assert.equal(tooltip.hidden, true);
  f.view.render(state); f.indicator.dispatch('pointerenter'); assert.equal(tooltip.hidden, false);
  f.view.destroy(); assert.equal(tooltip.hidden, true);
  f.indicator.dispatch('pointerenter'); assert.equal(tooltip.hidden, true);
  assert.equal(f.timers.size, 0);
});

test('readout counts local calendar days across midnight year boundary and daylight saving', () => {
  const previousZone = process.env.TZ; process.env.TZ = 'America/Los_Angeles';
  try {
    for (const [current, at, age, date] of [
      ['2026-10-17T12:00:00.000Z', '2026-10-17T08:00:00.000Z', 'Today', 'Oct 17, 2026'],
      ['2026-10-18T07:10:00.000Z', '2026-10-18T06:50:00.000Z', '1 day ago', 'Oct 17, 2026'],
      ['2026-10-18T12:00:00.000Z', '2026-10-16T12:00:00.000Z', '2 days ago', 'Oct 16, 2026'],
      ['2027-01-01T08:10:00.000Z', '2027-01-01T07:50:00.000Z', '1 day ago', 'Dec 31, 2026'],
      ['2026-03-09T07:30:00.000Z', '2026-03-08T08:30:00.000Z', '1 day ago', 'Mar 8, 2026'],
      ['2026-11-02T08:30:00.000Z', '2026-11-01T07:30:00.000Z', '1 day ago', 'Nov 1, 2026'],
    ]) {
      const f = viewFixture(Date.parse(current));
      f.view.render({ connected: true, mode: 'service', ascmSupervisor: { enabled: true, working: false, lastUpdatedAt: at } });
      const elapsed = f.indicator.querySelector('.ascm-update-elapsed');
      assert(elapsed, 'styled readout exposes the accepted update age');
      f.indicator.focus();
      assert.equal(elapsed.textContent, age, current);
      assert.equal(f.indicator.querySelector('.ascm-update-date').textContent, date);
      assert.equal(f.indicator.querySelector('.ascm-update-date').dateTime, at);
      assert.equal(f.indicator.querySelector('.ascm-update-heading').textContent, 'Last ASCM update');
      f.view.destroy();
    }
  } finally { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; }
});

test('Escape dismisses the clock readout before roster and hidden focused clock returns to connection control', async () => {
  const f = await headerFixture();
  try {
    const bot = f.brand.querySelector('.ascm-supervisor-header'), popover = f.brand.querySelector('.master-presence-popover');
    const tooltip = f.indicator.querySelector('.ascm-update-tooltip');
    assert(tooltip, 'actual initializer mounts the clock readout');
    bot.focus(); bot.click(); await f.app.refresh();
    assert.equal(popover.hidden, false);
    const before = f.calls;
    f.indicator.focus(); assert.equal(tooltip.hidden, false);
    const event = f.documentObject.dispatch('keydown', { key: 'Escape' });
    assert.equal(event.defaultPrevented, true);
    assert.equal(tooltip.hidden, true);
    assert.equal(popover.hidden, false, 'tooltip Escape does not close the separate people dialog');
    assert.equal(f.documentObject.activeElement, f.indicator);
    assert.equal(f.calls, before);
    f.documentObject.dispatch('keydown', { key: 'Escape' }); assert.equal(popover.hidden, true);
    f.indicator.focus();
    f.reply = { sessions: [], ascmSupervisor: { enabled: false } }; await f.app.refresh();
    assert.equal(f.documentObject.activeElement, f.brand.querySelector('.master-presence-trigger'));
    assert.equal(tooltip.hidden, true);
  } finally { f.app.destroy(); }
});

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
  assert.equal(f.indicator.getAttribute('aria-label'), 'Updating ASCM · 1 product');
  f.view.render({ ...state, ascmSupervisor: active({ productCount: null }) });
  assert.equal(f.indicator.getAttribute('aria-label'), 'Updating ASCM');
  f.advance(120000);
  assert.equal(f.indicator.classList.contains('is-working'), false);
  assert.equal(f.indicator.getAttribute('aria-label'), 'ASCM supervisor');
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
  assert.equal(hint.children[0].textContent, 'The flow owner must reconnect Office 365 Outlook or SharePoint in Copilot Studio → Manage connection references.');
  assert.equal(hint.children[1].textContent, 'Complete Microsoft sign-in, then return here.');
  assert.equal(hint.children[2].textContent, 'Status updates after the next successful supervisor check.');
  const link = hint.querySelector('.ascm-reconnect-link');
  assert.equal(link.textContent, 'Open Copilot Studio');
  assert.equal(link.href, 'https://copilotstudio.microsoft.com/environments/Default-ca7981a2-785a-463d-b82a-3db87dfc3ce6/flows/5bb99050-adca-f111-a05c-000d3a3191e3/overview');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  link.click();
  assert.deepEqual(controllerFixture.controller.getState().ascmSupervisor.reconnectRequired, ['outlook']);
  assert.equal(controllerFixture.calls.length, 1);
  assert.equal(f.indicator.getAttribute('aria-label'), 'ASCM supervisor');
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
  assert.equal(f.indicator.getAttribute('aria-label'), 'Updating ASCM · 1 product');
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
  const previewPort = Number(process.env.PPC_PREVIEW_PORT || 4199);
  assert(Number.isSafeInteger(previewPort) && previewPort >= 1024 && previewPort <= 65535, 'PPC_PREVIEW_PORT must be an unprivileged TCP port');
  const index = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
  const toolbar = index.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0];
  assert(toolbar);
  const routes = new Set(['/css/styles.css', '/css/fonts.css', '/css/presence-expressions.css', '/js/master-presence.js', '/js/presence-expressions.js', '/assets/fonts/Jost-Variable.ttf']);
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'");
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      const mode = ['idle', 'disabled', 'expired', 'unknown', 'reconnect', 'missing-update', 'invalid-update'].includes(url.searchParams.get('state')) ? url.searchParams.get('state') : 'active';
      const requestedAge = url.searchParams.get('age'), previewAge = /^(?:0|[1-9]\d{0,2})$/.test(requestedAge || '') ? Number(requestedAge) : 2;
      const requestedReply = url.searchParams.get('reply'), previewReply = /^(?:0|[1-9]\d?)$/.test(requestedReply || '') ? Number(requestedReply) : null;
      const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ASCM header face · local preview</title><link rel="stylesheet" href="css/fonts.css"><link rel="stylesheet" href="css/styles.css"><link rel="stylesheet" href="css/presence-expressions.css"><script>
const fixtureMode=${JSON.stringify(mode)};
const fixtureLastUpdate=new Date();fixtureLastUpdate.setDate(fixtureLastUpdate.getDate()-${previewAge});
${previewReply === null ? '' : `Math.random=()=>${(previewReply + 0.1) / 100};`}
const fixtureIdle=['idle','reconnect','missing-update','invalid-update'].includes(fixtureMode);
const fixtureSession={getState:()=>({configured:true,hasKey:true,accessVersion:1,pending:[]}),presence:async body=>({sessions:[{sessionId:body.sessionId,displayName:'Alex',categoryName:'PC Gaming Audio'},{sessionId:'fixture-sam-1234',displayName:'Sam',categoryName:'Mice'}],...(fixtureMode==='disabled'?{}:{ascmSupervisor:{enabled:true,working:!fixtureIdle,productCount:fixtureIdle||fixtureMode==='unknown'?null:12,expiresAt:fixtureIdle?null:new Date(Date.now()+(fixtureMode==='expired'?-1000:120000)).toISOString(),reconnectRequired:fixtureMode==='reconnect'?['outlook']:[],...(fixtureMode==='missing-update'?{}:{lastUpdatedAt:fixtureMode==='invalid-update'?'not-a-recorded-date':fixtureLastUpdate.toISOString()})}})})};
globalThis.PortfolioMasterUI={getSession:()=>fixtureSession};
</script><script defer src="js/presence-expressions.js"></script><script defer src="js/master-presence.js"></script></head><body><main class="app-shell"><div class="workspace-main">${toolbar.replace('<div id="categoryNavigation" class="category-navigation-host" aria-label="Product categories"></div>', '<div id="categoryNavigation" class="category-navigation-host" aria-label="Product categories"><button type="button">PC Gaming Audio</button></div>')}<div id="fixtureNotice" role="status" style="padding:12px 16px;color:#BBBCC0;font-size:12px;border-top:1px solid #333538">Preview · synthetic Microsoft connection status and ASCM update date. No portfolio changes or automatic external requests.</div><section style="margin:24px;border:1px solid #333538;padding:24px;color:#BBBCC0">Hover or focus the right-side clock for the synthetic last-update readout. The supervisor's face is visible beside the people in the main header. Select it to open the existing connection details. A lost connection adds the key alert in those details; healthy status keeps the face without a name or key. Open Copilot Studio opens the owner's actual flow in a new tab; flow access requires the owner's Microsoft account.</section></div></main></body></html>`;
      response.setHeader('Content-Type', 'text/html'); response.end(body); return;
    }
    if (!routes.has(url.pathname)) { response.writeHead(404); response.end(); return; }
    try { const bytes = await readFile(new URL(`../../public${url.pathname}`, import.meta.url)); response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'font/ttf'); response.end(bytes); }
    catch { response.writeHead(404); response.end(); }
  });
  server.listen(previewPort, '127.0.0.1', () => console.log(`Local ASCM header preview: http://127.0.0.1:${previewPort}/?state=idle (PID ${process.pid})`));
}
