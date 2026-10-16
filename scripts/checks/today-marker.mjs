import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../public/js/today-marker.js';

const marker = globalThis.PortfolioTodayMarker;
const friday = new Date(2026, 9, 16, 13, 4, 9);
assert.equal(marker.dateParts(friday).date, '10/16/2026');
assert.equal(marker.dateParts(friday).weekday, 'FRI');
assert.equal(marker.dateParts(friday).time, '13:04:09');
assert.equal(marker.dateParts(friday).isoDate, '2026-10-16');
assert.equal(marker.dateParts(new Date(2027, 0, 1, 0, 0, 0)).time, '00:00:00', 'Midnight uses a 24-hour local clock.');
assert.equal(marker.currentMonthPosition(new Date(2028, 1, 29)), 2028 * 12 + 1 + 28 / 29, 'A leap month uses its actual day count.');
assert.equal(marker.currentMonthPosition(new Date(2026, 11, 31)), 2026 * 12 + 11 + 30 / 31);

const appSource = await readFile(new URL('../../public/js/app.js', import.meta.url), 'utf8');
const todayNavigation = appSource.match(/^function scrollRoadmapToday\([^]*?^\}/m)?.[0];
assert.ok(todayNavigation, 'Exercise the actual Today navigation.');
const navigation = vm.createContext({
  PortfolioTodayMarker: marker, hasDedicatedHashoutView: () => false,
  roadmapRange: () => ({ start: 2026 * 12 }), ROADMAP_LEFT_WIDTH: 190, roadmapMonthWidth: 82,
  Math, Date: class extends Date { constructor(...args) { super(...(args.length ? args : [friday])); } },
});
vm.runInContext(todayNavigation, navigation);
for (const width of [320, 390, 900, 1280]) {
  let left;
  navigation.scrollRoadmapToday({ clientWidth: width, scrollTo(options) { left = options.left; } });
  const visibleX = 190 + (marker.currentMonthPosition(friday) - 2026 * 12) * 82 - left;
  assert.equal(visibleX, 190 + (width - 190) / 2, 'Today is centered in the visible plot, clear of the frozen category rail.');
  assert.ok(visibleX >= 190 && visibleX < width, 'The Today button keeps its marker visible even at 320px.');
}

const initial = { x: 480.3, left: 200, right: 900, yearTop: 40, bodyTop: 128, width: 900, height: 500, offsetLeft: 12, offsetTop: 24 };
let layout = marker.geometry(initial, 270);
assert.equal(layout.x, 480);
assert.equal(layout.lineTop, 48, 'The dashed line starts below the 8px donut.');
assert.equal(layout.readoutTop + 30, layout.yearTop - 3, 'The readout ends precisely 3px above the year axis.');
assert.equal(layout.readoutLeft, 345);
assert.equal(layout.segmentHeight, 48);
assert.equal(layout.offsetLeft, 12);
assert.equal(marker.geometry({ ...initial, x: 210 }, 270).readoutLeft, 208, 'The readout stays inside the plot when it fits.');
layout = marker.geometry({ ...initial, x: 205, left: 200, right: 310, width: 320 }, 270);
assert.equal(layout.readoutLeft, 42, 'A narrow plot can use the full visible layer while remaining inside it.');
assert.equal(marker.geometry({ ...initial, x: 199 }).visible, false, 'An offscreen date never crosses the frozen label rail.');
assert.equal(marker.geometry({ ...initial, x: 901 }).visible, false);
assert.equal(marker.geometry({ ...initial, visible: false }).visible, false);
assert.equal(marker.geometry({ ...initial, height: 150, bodyTop: 128 }).segmentHeight, 22, 'Short plots keep the whole follower in bounds.');

class Events {
  listeners = new Map();
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(listener); }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  dispatch(name, event = {}) { for (const listener of this.listeners.get(name) || []) listener(event); }
  get count() { return [...this.listeners.values()].reduce((total, set) => total + set.size, 0); }
}
class Element extends Events {
  constructor(ownerDocument) {
    super(); this.ownerDocument = ownerDocument; this.children = []; this.style = {}; this.attributes = new Map(); this.isConnected = true; this.className = ''; this.textContent = ''; this.hidden = false;
    const names = new Set(); this.classList = { toggle(name, on) { if (on) names.add(name); else names.delete(name); }, contains(name) { return names.has(name); } };
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  get offsetWidth() { return this.className === 'portfolio-today-readout' ? 270 : 900; }
  getBoundingClientRect() { return { left: 12, top: 24, width: 900, height: 500 }; }
  remove() { this.isConnected = false; this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
}
const doc = new Events(); doc.hidden = false; doc.createElement = () => new Element(doc);
const host = new Element(doc), eventTarget = new Element(doc), windowEvents = new Events();
const timeouts = new Map(), frames = new Map(), media = new Map(), observers = [];
let sequence = 0, dateNow = new Date(2026, 9, 16, 23, 59, 59, 500), geometryNow = null, viewActive = true;
class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [dateNow.getTime()])); } }
class Observer {
  constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
}
const sandbox = {
  Date: ClockDate, Intl, console,
  addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
  setTimeout(callback, delay) { const id = ++sequence; timeouts.set(id, { callback, delay }); return id; }, clearTimeout(id) { timeouts.delete(id); },
  requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
  matchMedia(query) { const value = new Events(); value.matches = false; media.set(query, value); return value; },
  ResizeObserver: Observer, IntersectionObserver: Observer, MutationObserver: Observer,
};
vm.createContext(sandbox);
vm.runInContext(await readFile(new URL('../../public/js/today-marker.js', import.meta.url), 'utf8'), sandbox);
const controller = sandbox.PortfolioTodayMarker.create({ host, eventTarget, getGeometry(now) { geometryNow = now; return initial; }, isActive: () => viewActive });
const find = (suffix) => {
  const all = (node) => [node, ...node.children.flatMap(all)];
  return all(controller.element).find((node) => node.className === `portfolio-today-${suffix}`);
};
assert.equal(controller.element.hidden, false);
assert.equal(find('date').textContent, '10/16/2026');
assert.equal(find('clock').dateTime, dateNow.toISOString());
assert.equal(find('readout').style.top, '7px');
assert.equal(find('line').style.left, '480px');
assert.equal(timeouts.size, 1, 'One visible marker owns one aligned clock timer.');
assert.equal([...timeouts.values()][0].delay, 505);

function tick() { const [id, scheduled] = timeouts.entries().next().value; timeouts.delete(id); scheduled.callback(); }
dateNow = new Date(2026, 9, 17, 0, 0, 0, 5); tick();
assert.equal(find('date').textContent, '10/17/2026');
assert.equal(find('day').textContent, 'SAT');
assert.equal(geometryNow.getDate(), 17, 'A midnight rollover recalculates the date position without a canvas redraw.');
assert.equal(timeouts.size, 1);

eventTarget.dispatch('pointermove', { clientX: 650, clientY: 260, pointerType: 'mouse', buttons: 0 });
assert.equal(find('follower').style.opacity, '1');
assert.equal(find('follower').style.left, '480px', 'Pointer x never moves the today rail.');
eventTarget.dispatch('pointermove', { clientX: 750, clientY: 360, pointerType: 'mouse', buttons: 0 });
const [frameId, animate] = frames.entries().next().value; frames.delete(frameId); animate(16);
assert.ok(Number(find('follower').style.transform.match(/[\d.]+/)[0]) > 212, 'The bounded animation advances toward the new vertical pointer position.');
eventTarget.dispatch('pointerdown');
assert.equal(find('follower').style.opacity, '0'); assert.equal(frames.size, 0, 'Panning cancels the decorative follower.');
windowEvents.dispatch('pointerup');
eventTarget.dispatch('pointermove', { clientX: 650, clientY: 260, pointerType: 'touch', buttons: 0 });
assert.equal(find('follower').style.opacity, '0');
media.get('(prefers-reduced-motion: reduce)').matches = true;
media.get('(prefers-reduced-motion: reduce)').dispatch('change');
eventTarget.dispatch('pointermove', { clientX: 650, clientY: 260, pointerType: 'mouse', buttons: 0 });
assert.equal(find('follower').style.opacity, '0'); assert.equal(frames.size, 0);
media.get('(prefers-reduced-motion: reduce)').matches = false;

doc.hidden = true; doc.dispatch('visibilitychange');
assert.equal(timeouts.size, 0, 'Hidden documents stop the live clock.');
assert.equal(controller.element.hidden, true);
doc.hidden = false; doc.dispatch('visibilitychange'); assert.equal(timeouts.size, 1);
viewActive = false; controller.sync(); assert.equal(timeouts.size, 0); assert.equal(controller.element.hidden, true);
viewActive = true; controller.sync(); assert.equal(timeouts.size, 1);
controller.clear(); assert.equal(timeouts.size, 0); assert.equal(controller.element.hidden, true);
observers[0].callback([]); assert.equal(timeouts.size, 0, 'Observers cannot revive a deliberately cleared marker.');
controller.sync(); assert.equal(timeouts.size, 1);
for (let restore = 0; restore < 2; restore++) {
  eventTarget.dispatch('pointermove', { clientX: 650, clientY: 260, pointerType: 'mouse', buttons: 0 });
  assert.equal(find('follower').style.opacity, '1');
  windowEvents.dispatch('pagehide', { persisted: true });
  assert.equal(controller.element.hidden, true);
  assert.equal(timeouts.size, 0, 'A bfcache entry pauses its clock without destroying the controller.');
  assert.equal(frames.size, 0); assert.equal(find('follower').style.opacity, '0');
  assert.equal(host.children.length, 1);
  observers[0].callback([]); controller.sync();
  assert.equal(timeouts.size, 0, 'Layout callbacks and sync cannot restart a frozen bfcache page.');
  dateNow = new Date(2026, 9, 18 + restore, 12, 30, 0);
  windowEvents.dispatch('pageshow', { persisted: true });
  assert.equal(controller.element.hidden, false);
  assert.equal(timeouts.size, 1, 'Each bfcache restoration resumes a single live clock.');
  assert.equal(find('date').textContent, `10/${18 + restore}/2026`, 'Restoring from bfcache refreshes the current date.');
  assert.equal(geometryNow.getDate(), 18 + restore);
}
windowEvents.dispatch('pagehide', { persisted: false });
controller.destroy(); controller.destroy();
assert.equal(host.children.length, 0); assert.equal(timeouts.size, 0); assert.equal(frames.size, 0);
assert.equal(eventTarget.count + windowEvents.count + doc.count + [...media.values()].reduce((total, item) => total + item.count, 0), 0, 'Destroy removes every listener.');
assert.ok(observers.every((observer) => observer.disconnected));

const operations = [];
const context = new Proxy({ measureText: (text) => ({ width: text.length * 6 }), save() {}, restore() {} }, { get(target, key) { return key in target ? target[key] : (...args) => operations.push([key, ...args]); } });
assert.equal(marker.drawStatic(context, initial, friday), true);
assert.ok(operations.some(([name, values]) => name === 'setLineDash' && values.join(',') === '3,5'));
assert.ok(operations.some(([name, text]) => name === 'fillText' && text === '10/16/2026'));
assert.ok(operations.some(([name, text]) => name === 'fillText' && text === 'FRI'));
assert.ok(operations.some(([name, text]) => name === 'fillText' && text === '13:04'));
assert.equal(marker.drawStatic(context, { ...initial, visible: false }, friday), false);
console.log('Today marker checks passed: local clock/date, leap-month scale, 3px geometry, responsive clamping, Y-only motion, motion preferences, midnight rollover, visibility/view pause, repeated bfcache restoration, static exports, and complete cleanup.');
