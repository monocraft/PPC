import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/presence-bump.js", import.meta.url), "utf8");
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) { const items = this.listeners.get(type) || []; items.push(callback); this.listeners.set(type, items); }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== callback)); }
  dispatch(type) { for (const callback of this.listeners.get(type) || []) callback(); }
}
function style() {
  const priorities = new Map();
  return { getPropertyValue(name) { return this[name] || ""; }, getPropertyPriority(name) { return priorities.get(name) || ""; },
    setProperty(name, value, priority = "") { this[name] = value; priorities.set(name, priority); }, removeProperty(name) { delete this[name]; priorities.delete(name); } };
}
class Element extends Events {
  constructor(className = "", bounds = { left: 20, top: 20, width: 29, height: 29 }) {
    super(); this.className = className; this.children = []; this.attributes = new Map(); this.style = style(); this.bounds = bounds; this.isConnected = true;
    this.classList = { contains: (name) => this.className.split(" ").includes(name), add: (...names) => { this.className = [...new Set([...this.className.split(" ").filter(Boolean), ...names])].join(" "); }, remove: (...names) => { this.className = this.className.split(" ").filter((name) => !names.includes(name)).join(" "); } };
  }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parent = this; node.isConnected = true; } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); this.parent = null; this.isConnected = false; }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  matches(selector) { return selector[0] === "." && this.classList.contains(selector.slice(1)); }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  querySelector(selector) { for (const child of this.children) { if (child.matches(selector)) return child; const found = child.querySelector(selector); if (found) return found; } return null; }
  querySelectorAll() { return this.children.flatMap((child) => [...(child.attributes.has("id") || child.attributes.has("tabindex") ? [child] : []), ...child.querySelectorAll()]); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  getBoundingClientRect() { return { ...this.bounds, right: this.bounds.left + this.bounds.width, bottom: this.bounds.top + this.bounds.height }; }
  cloneNode(deep) { const copy = new Element(this.className, this.bounds); copy.attributes = new Map(this.attributes); if (deep) for (const child of this.children) copy.append(child.cloneNode(true)); return copy; }
}
function setup() {
  let sequence = 0, time = 0;
  const timers = new Map(), animations = [], media = new Events(), view = new Events(), document = new Events();
  media.matches = false; view.innerWidth = 800; view.innerHeight = 600; view.matchMedia = () => media;
  view.setTimeout = (fn, delay) => { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id; }; view.clearTimeout = (id) => timers.delete(id);
  document.hidden = false; document.documentElement = new Element(); document.body = new Element(); document.defaultView = view;
  document.createElement = () => {
    const actor = new Element(); actor.animate = (frames, options) => {
      let complete, reject; const finished = new Promise((resolve, rejectPromise) => { complete = resolve; reject = rejectPromise; });
      const animation = { frames, options, complete, finished, cancelled: false, cancel() { this.cancelled = true; reject(new Error("Cancelled")); } };
      animations.push(animation); return animation;
    }; return actor;
  };
  const shell = new Element("master-presence"), strip = new Element("master-presence-avatars"), from = new Element("master-presence-avatar presence-character"), target = new Element("master-presence-avatar presence-character", { left: 150, top: 20, width: 29, height: 29 });
  shell.append(strip); strip.append(from, target); document.body.append(shell);
  const sandbox = { document }; vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const bump = sandbox.PortfolioPresenceBump.create({ shell, documentObject: document });
  return { bump, shell, strip, from, target, document, view, media, timers, animations,
    actor: () => document.body.children.find((node) => node.className === "presence-bump-actor"),
    advance(milliseconds) { const until = time + milliseconds; for (const [id, entry] of [...timers]) if (entry.at <= until) { time = entry.at; timers.delete(id); entry.fn(); } time = until; },
  };
}
{
  const f = setup(); f.from.style.setProperty("opacity", ".7", "important");
  const complete = f.bump.play({ from: f.from, target: f.target });
  assert.equal(f.actor().style.width, "29px"); assert.equal(f.actor().style.height, "29px"); assert.equal(f.from.style.opacity, "0");
  assert.equal(f.actor().attributes.get("aria-hidden"), "true"); assert.equal(f.animations[0].options.duration, 1100); assert.equal(f.animations[0].options.fill, "both");
  assert.equal(await f.bump.play({ from: f.from, target: f.target }), false, "Rapid input does not stack walking overlays.");
  f.advance(484); assert.equal(f.target.classList.contains("presence-is-bumped"), true);
  f.animations[0].complete(); assert.equal(await complete, true);
  assert.equal(f.actor(), undefined); assert.equal(f.from.style.opacity, ".7"); assert.equal(f.from.style.getPropertyPriority("opacity"), "important");
  assert.equal(f.target.classList.contains("presence-is-bumped"), false); assert.equal(f.timers.size, 0); f.bump.destroy();
}
for (const cause of ["resize", "scroll", "hidden", "reduced", "cancel", "destroy"]) {
  const f = setup(), completed = f.bump.play({ from: f.from, target: f.target });
  if (cause === "resize") f.view.dispatch("resize");
  else if (cause === "scroll") f.document.dispatch("scroll");
  else if (cause === "hidden") { f.document.hidden = true; f.document.dispatch("visibilitychange"); }
  else if (cause === "reduced") { f.media.matches = true; f.media.dispatch("change"); }
  else f.bump[cause]();
  assert.equal(await completed, false, `${cause} cancels the journey.`); assert.equal(f.actor(), undefined); assert.equal(f.from.style.getPropertyValue("opacity"), ""); assert.equal(f.timers.size, 0);
  f.bump.destroy(); assert.equal([...f.document.listeners.values(), ...f.view.listeners.values(), ...f.media.listeners.values()].every((handlers) => handlers.length === 0), true);
}
for (const unavailable of ["hidden", "reduced", "preference", "distance", "roster", "invisible", "same"]) {
  const f = setup(); let target = f.target;
  if (unavailable === "hidden") f.document.hidden = true;
  if (unavailable === "reduced") f.media.matches = true;
  if (unavailable === "preference") f.document.documentElement.classList.add("preview-reduced-motion");
  if (unavailable === "distance") f.target.bounds.left = 500;
  if (unavailable === "roster") { f.target.remove(); f.shell.append(f.target); }
  if (unavailable === "invisible") f.target.bounds.width = 0;
  if (unavailable === "same") target = f.from;
  assert.equal(await f.bump.play({ from: f.from, target }), false, `${unavailable} retains static feedback.`); assert.equal(f.actor(), undefined); assert.equal(f.timers.size, 0); f.bump.destroy();
}
{
  const f = setup(); const completed = f.bump.play({ from: f.from, target: f.target });
  f.advance(1250); assert.equal(await completed, true, "A bounded safety timeout restores the source if WAAPI completion is delayed."); assert.equal(f.from.style.opacity, undefined); f.bump.destroy();
  assert.equal(await f.bump.play({ from: f.from, target: f.target }), false);
}
console.log("Presence bump checks passed: actual-size cloning, bounded single journey, collision timing, opacity restoration, reduced-motion/static fallbacks, cancellation and cleanup.");
