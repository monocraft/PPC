import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/presence-neighbors.js", import.meta.url), "utf8");

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) { const handlers = this.listeners.get(type) || []; handlers.push(callback); this.listeners.set(type, handlers); }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter((handler) => handler !== callback)); }
  dispatch(type, event = {}) { for (const handler of [...(this.listeners.get(type) || [])]) handler({ type, ...event }); }
}

class Element extends Events {
  constructor(className = "", bounds = { left: 20, top: 20, width: 29, height: 29 }) {
    super(); this.className = className; this.children = []; this.attributes = new Map(); this.bounds = bounds; this.dataset = {}; this.parentNode = null; this.hovered = false;
    const values = new Map();
    this.style = { setProperty: (name, value) => values.set(name, String(value)), getPropertyValue: (name) => values.get(name) || "", removeProperty: (name) => values.delete(name) };
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
      toggle: (name, force) => { const add = force ?? !this.classList.contains(name); this.classList[add ? "add" : "remove"](name); return add; },
    };
  }
  get parentElement() { return this.parentNode; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  get isConnected() { return this.isRoot === true || this.parentNode?.isConnected === true; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "class") this.className = String(value); if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value); }
  getAttribute(name) { if (name.startsWith("data-")) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] ?? null; return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  removeAttribute(name) { this.attributes.delete(name); if (name.startsWith("data-")) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  insertBefore(node, before) { node.remove(); const index = before ? this.children.indexOf(before) : this.children.length; assert.ok(index >= 0); this.children.splice(index, 0, node); node.parentNode = this; return node; }
  replaceChild(next, old) { this.insertBefore(next, old); old.remove(); return old; }
  replaceWith(next) { this.parentNode?.replaceChild(next, this); }
  removeChild(node) { node.remove(); return node; }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    return selector.split(",").some((option) => {
      let simple = option.trim();
      if (simple === ":hover") return this.hovered;
      if (simple === ":focus-within") return this.contains(this.ownerDocument?.activeElement);
      if (simple === "button") return this.tagName === "BUTTON";
      if (simple.includes(":")) {
        if (simple.includes(":hover") && !this.hovered) return false;
        if (simple.includes(":focus-within") && !this.contains(this.ownerDocument?.activeElement)) return false;
        simple = simple.replace(/:hover|:focus-within/g, "");
      }
      const names = [...simple.matchAll(/\.([-\w]+)/g)].map((match) => match[1]);
      if (names.some((name) => !this.classList.contains(name))) return false;
      for (const [, name, , value] of simple.matchAll(/\[([^=\]]+)(?:=(["']?)([^\]"']*)\2)?\]/g)) {
        const actual = this.getAttribute(name); if (actual === null || value !== undefined && actual !== value) return false;
      }
      return names.length > 0 || simple.startsWith("[") || simple === "*";
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelectorAll(selector) {
    if (selector.startsWith(":scope > ")) return this.children.filter((child) => child.matches(selector.slice(9)));
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
    return descendants.filter((child) => child.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { ...this.bounds, right: this.bounds.left + this.bounds.width, bottom: this.bounds.top + this.bounds.height }; }
}

function setup({ count = 3, random = () => .25 } = {}) {
  let sequence = 0, time = 0, available = true, focused = true;
  const timers = new Map(), mutations = [], intersections = [];
  const document = new Events(), view = new Events(), media = new Events();
  document.defaultView = view; document.hidden = false; document.visibilityState = "visible"; document.hasFocus = () => focused;
  document.documentElement = new Element(); document.documentElement.isRoot = true; document.body = new Element(); document.documentElement.append(document.body);
  document.activeElement = document.body; document.createElement = (tag) => { const node = new Element(); node.tagName = tag.toUpperCase(); node.ownerDocument = document; return node; };
  media.matches = false; view.matchMedia = () => media; view.innerWidth = 800; view.innerHeight = 600;
  view.setTimeout = (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay, at: time + delay }); return id; }; view.clearTimeout = (id) => timers.delete(id);
  view.MutationObserver = class { constructor(callback) { this.callback = callback; mutations.push(this); } observe() { this.observing = true; } disconnect() { this.observing = false; } };
  view.IntersectionObserver = class { constructor(callback) { this.callback = callback; intersections.push(this); } observe(node) { this.node = node; this.observing = true; } disconnect() { this.observing = false; } };
  view.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  const make = (className) => { const node = document.createElement("span"); node.className = className; return node; };
  const shell = make("master-presence"), strip = make("master-presence-avatars"), people = [];
  shell.bounds = { left: 20, top: 20, width: 120, height: 29 }; strip.bounds = { ...shell.bounds }; shell.append(strip); document.body.append(shell);
  for (let index = 0; index < count; index += 1) {
    const button = make("presence-header-person"), character = make("master-presence-avatar presence-character is-in-view"), face = make("presence-face");
    button.tagName = "BUTTON"; button.dataset.sessionId = `session-person-${index}`; character.dataset.mood = "browsing";
    button.bounds = character.bounds = face.bounds = { left: 20 + index * 26, top: 20, width: 29, height: 29 };
    face.append(make("presence-features")); character.append(face); button.append(character); strip.append(button); people.push({ button, character, face });
  }
  const sandbox = { document, Date: { now: () => time }, Math, setTimeout: view.setTimeout, clearTimeout: view.clearTimeout };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const neighbors = sandbox.PortfolioPresenceNeighbors.create({ shell, documentObject: document, isAvailable: () => available, random });
  return {
    neighbors, shell, strip, people, document, view, media, timers, mutations, intersections,
    setAvailable(value) { available = value; }, setFocused(value) { focused = value; },
    advance(milliseconds) { const until = time + milliseconds; let guard = 0; while (true) { const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; assert.ok(++guard < 100, "Timers remain bounded."); time = next[1].at; timers.delete(next[0]); next[1].callback(); } time = until; },
    flushMutations() { for (const observer of mutations) if (observer.observing) observer.callback([]); },
    setIntersecting(value) { for (const observer of intersections) if (observer.observing) observer.callback([{ target: observer.node, isIntersecting: value, intersectionRatio: Number(value) }]); },
    puppets: () => shell.querySelectorAll(".presence-neighbor-puppet"), active: () => people.filter(({ character }) => character.classList.contains("presence-neighbor-active")),
  };
}

for (const kind of ["chat", "giggle", "bonk"]) {
  const f = setup({ count: 2 });
  const original = f.people.map(({ button, character, face }) => ({ button, character, face }));
  f.people[0].character.style.setProperty("--presence-look-x", "1.2px");
  f.neighbors.update({ enabled: true });
  assert.equal(f.neighbors.play(kind), true, `${kind} can animate two eligible neighbors.`);
  assert.equal(f.puppets().length, 2); assert.equal(f.active().length, 2);
  for (const { button, character, face } of original) {
    assert.equal(button.parentNode, f.strip, "The original interactive button stays in place.");
    assert.equal(character.parentNode, button); assert.equal(face.parentNode.classList.contains("presence-neighbor-puppet"), true);
  }
  assert.equal(f.document.activeElement, f.document.body, "Decorative scenes do not move focus.");
  const wrappers = f.puppets(), deadlines = [...f.timers.values()].map(({ at }) => at);
  assert.equal(f.neighbors.play(kind), false, "A second scene does not stack.");
  f.neighbors.refresh(); f.flushMutations();
  assert.deepEqual(f.puppets(), wrappers, "A normal presence redraw preserves the current scene.");
  assert.deepEqual([...f.timers.values()].map(({ at }) => at), deadlines, "Refreshing unchanged people does not restart animation clocks.");
  f.advance(3300);
  assert.equal(f.active().length, 2, `${kind} remains legible for at least 3.3 seconds.`);
  assert.equal(f.puppets().length, 2);
  f.advance(600);
  assert.equal(f.puppets().length, 0); assert.equal(f.active().length, 0);
  for (const { face, character } of original) {
    assert.equal(face.parentNode, character, "Completion unwraps the same face node.");
    assert.equal(character.hasAttribute("data-neighbor-scene"), false);
    assert.equal(character.hasAttribute("data-neighbor-role"), false);
    assert.equal(character.hasAttribute("data-neighbor-direction"), false);
  }
  assert.equal(f.people[0].character.style.getPropertyValue("--presence-look-x"), "1.2px", "Pointer gaze survives the scene.");
  const next = [...f.timers.values()]; assert.equal(next.length, 1, "Only one idle wakeup remains.");
  assert.ok(next[0].delay >= 8000 && next[0].delay <= 16000, "Each scene leaves a substantial random quiet interval.");
  f.neighbors.destroy(); assert.equal(f.timers.size, 0);
}

for (const blocked of ["recent", "offline", "pending", "aria-disabled", "reaction", "focus", "hover", "unavailable", "hidden", "blur", "offscreen", "reduced", "preference", "disabled"]) {
  const f = setup({ count: 2 }), { button, character } = f.people[0];
  if (["recent", "offline"].includes(blocked)) character.dataset.mood = blocked;
  if (blocked === "pending") button.classList.add("is-poke-pending");
  if (blocked === "aria-disabled") button.setAttribute("aria-disabled", "true");
  if (blocked === "reaction") character.dataset.reaction = "received";
  if (blocked === "focus") f.document.activeElement = button;
  if (blocked === "hover") button.hovered = true;
  if (blocked === "unavailable") f.setAvailable(false);
  if (blocked === "hidden") { f.document.hidden = true; f.document.visibilityState = "hidden"; }
  if (blocked === "blur") { f.setFocused(false); f.view.dispatch("blur"); }
  if (blocked === "offscreen") for (const person of f.people) person.button.bounds = person.character.bounds = { left: -100, top: 20, width: 29, height: 29 };
  if (blocked === "reduced") f.media.matches = true;
  if (blocked === "preference") f.document.documentElement.classList.add("preview-reduced-motion");
  f.neighbors.update({ enabled: blocked !== "disabled" });
  assert.equal(f.neighbors.play("chat"), false, `${blocked} keeps the strip still.`);
  assert.equal(f.puppets().length, 0);
  f.neighbors.destroy(); assert.equal(f.timers.size, 0);
}

{
  const f = setup(); f.people[1].character.dataset.reaction = "sent";
  f.neighbors.update({ enabled: true });
  assert.equal(f.neighbors.play("bonk"), false, "An unavailable middle person never lets the outer characters jump over them.");
  f.neighbors.destroy();
}
{
  const f = setup({ count: 1 }); f.neighbors.update({ enabled: true });
  assert.equal(f.neighbors.play("chat"), false, "One connected person has no fabricated neighbor.");
  f.neighbors.destroy();
}
{
  const f = setup();
  assert.equal(f.neighbors.play(), true);
  const firstPair = f.active().map(({ button }) => button.dataset.sessionId).join("|");
  const firstScene = f.active()[0].character.getAttribute("data-neighbor-scene");
  f.advance(4000); assert.equal(f.neighbors.play(), true);
  const secondPair = f.active().map(({ button }) => button.dataset.sessionId).join("|");
  const secondScene = f.active()[0].character.getAttribute("data-neighbor-scene");
  assert.notEqual(secondPair, firstPair, "Automatic choices use a different neighboring pair when an alternative exists.");
  assert.notEqual(secondScene, firstScene, "Automatic choices vary the scene rather than repeat the same gag.");
  f.neighbors.destroy();
}

for (const cause of ["disabled", "unavailable", "departure", "reorder", "resize", "scroll", "hidden", "blur", "offscreen", "reduced", "preference", "focus", "hover", "paused", "pending", "reaction", "cancel", "destroy"]) {
  const f = setup(); f.neighbors.update({ enabled: true }); assert.equal(f.neighbors.play("bonk"), true);
  if (cause === "disabled") f.neighbors.update({ enabled: false });
  else if (cause === "unavailable") { f.setAvailable(false); f.neighbors.refresh(); }
  else if (cause === "departure") { f.active()[0].button.remove(); f.neighbors.refresh(); }
  else if (cause === "reorder") { f.strip.insertBefore(f.people[2].button, f.people[1].button); f.neighbors.refresh(); }
  else if (cause === "resize") f.view.dispatch("resize");
  else if (cause === "scroll") f.document.dispatch("scroll");
  else if (cause === "hidden") { f.document.hidden = true; f.document.visibilityState = "hidden"; f.document.dispatch("visibilitychange"); }
  else if (cause === "blur") { f.setFocused(false); f.view.dispatch("blur"); }
  else if (cause === "offscreen") f.setIntersecting(false);
  else if (cause === "reduced") { f.media.matches = true; f.media.dispatch("change"); }
  else if (cause === "preference") { f.document.documentElement.classList.add("preview-reduced-motion"); f.flushMutations(); }
  else if (cause === "focus") { f.document.activeElement = f.active()[0].button; f.shell.dispatch("focusin", { target: f.document.activeElement }); }
  else if (cause === "hover") { f.active()[0].button.hovered = true; f.shell.dispatch("pointerover"); }
  else if (cause === "paused") { f.shell.classList.add("is-paused"); f.flushMutations(); }
  else if (cause === "pending") { f.active()[0].button.classList.add("is-poke-pending"); f.flushMutations(); }
  else if (cause === "reaction") { f.active()[0].character.dataset.reaction = "received"; f.flushMutations(); }
  else f.neighbors[cause]();
  assert.equal(f.puppets().length, 0, `${cause} removes all temporary wrappers.`);
  assert.equal(f.active().length, 0, `${cause} restores resting character states.`);
  for (const { face, character } of f.people) assert.equal(face.parentNode, character, `${cause} preserves the original face.`);
  f.neighbors.destroy(); assert.equal(f.timers.size, 0, `${cause} leaves no timer after disposal.`);
}

for (const pause of ["hidden", "blur", "offscreen"]) {
  const f = setup({ count: 2 }); assert.equal(f.neighbors.play("chat"), true);
  if (pause === "hidden") { f.document.hidden = true; f.document.visibilityState = "hidden"; f.document.dispatch("visibilitychange"); }
  if (pause === "blur") { f.setFocused(false); f.view.dispatch("blur"); }
  if (pause === "offscreen") f.setIntersecting(false);
  assert.equal(f.timers.size, 0, `${pause} spends no timer cycles while unavailable.`);
  f.advance(120000);
  if (pause === "hidden") { f.document.hidden = false; f.document.visibilityState = "visible"; f.document.dispatch("visibilitychange"); }
  if (pause === "blur") { f.setFocused(true); f.view.dispatch("focus"); }
  if (pause === "offscreen") f.setIntersecting(true);
  assert.equal(f.active().length, 0, `${pause} does not replay missed animation on return.`);
  assert.equal(f.timers.size, 1);
  assert.ok([...f.timers.values()][0].delay >= 8000, `${pause} starts a fresh quiet interval on return.`);
  f.advance(7999); assert.equal(f.active().length, 0);
  f.neighbors.destroy();
}

{
  const f = setup({ count: 2 }); f.neighbors.update({ enabled: true });
  const timer = [...f.timers.values()][0];
  assert.ok(timer.delay >= 8000 && timer.delay <= 16000, "The initial scene also waits quietly.");
  f.advance(timer.delay); assert.equal(f.active().length, 2, "The scheduler starts an actual scene at its wakeup.");
  f.advance(4000); assert.equal(f.active().length, 0);
  f.neighbors.destroy(); f.neighbors.update({ enabled: true });
  assert.equal(f.neighbors.play("chat"), false, "A disposed coordinator never restarts.");
  assert.equal(f.timers.size, 0);
  assert.equal([...f.document.listeners.values(), ...f.view.listeners.values(), ...f.media.listeners.values(), ...f.shell.listeners.values()].every((handlers) => handlers.length === 0), true, "Disposal removes lifecycle and preference listeners.");
  assert.ok(f.mutations.every((observer) => !observer.observing)); assert.ok(f.intersections.every((observer) => !observer.observing));
}

for (const [random, expected] of [[() => 0, 8000], [() => 1, 16000]]) {
  const f = setup({ count: 2, random });
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, expected, "Random endpoint values exercise the full intended rest window.");
  f.advance(expected - 1); assert.equal(f.active().length, 0);
  f.advance(1); assert.equal(f.active().length, 2, "The endpoint wake starts a scene at exactly the selected rest time.");
  f.neighbors.destroy(); assert.equal(f.timers.size, 0);
}

console.log("Presence neighbor checks passed: three bounded scenes, adjacent live people only, preserved controls and gaze, quiet scheduling, redraw stability, poke/focus/preference exclusions, lifecycle cancellation and full cleanup.");

