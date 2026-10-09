import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
await import("../../public/js/date-history.js");
const historyUI = globalThis.PortfolioDateHistory;
const instant = Date.parse("2026-10-08T18:00:00Z");

assert.equal(historyUI.formatAge("2026-10-08T17:59:45Z", instant), "Just now");
assert.equal(historyUI.formatAge("2026-10-08T17:59:00Z", instant), "1 minute ago");
assert.equal(historyUI.formatAge("2026-10-08T17:53:00Z", instant), "7 minutes ago");
assert.equal(historyUI.formatAge("2026-10-08T16:45:00Z", instant), "1 hour, 15 minutes ago");
assert.equal(historyUI.formatAge("2026-10-08T16:00:00Z", instant), "2 hours ago");
assert.equal(historyUI.formatAge("2026-10-07T18:00:00Z", instant), "1 day ago");
assert.equal(historyUI.formatAge("2026-10-01T17:00:00Z", instant), "7 days ago");
assert.equal(historyUI.formatAge("2026-08-05T18:00:00Z", instant), "2 months, 3 days ago");
assert.equal(historyUI.formatAge("2024-08-05T18:00:00Z", instant), "2 years, 2 months, 3 days ago");
assert.equal(historyUI.formatAge("2026-01-31T18:00:00Z", Date.parse("2026-02-28T18:00:00Z")), "1 month ago");
assert.equal(historyUI.formatAge("2024-02-29T18:00:00Z", Date.parse("2025-02-28T18:00:00Z")), "1 year ago");
for (const invalid of [null, undefined, "", "invalid", "2026-10-09T18:00:00Z", NaN, {}]) {
  assert.equal(historyUI.formatAge(invalid, instant), null, "Unknown or future history must never fabricate an age.");
  assert.equal(historyUI.details({ at: invalid }, true, { now: instant }).known, false);
}
const metadata = historyUI.details({ at: "2026-10-08T16:45:00Z", actor: "  Team <name>  " }, true, { now: instant, locale: "en-US" });
assert.equal(metadata.at, "2026-10-08T16:45:00.000Z");
assert.equal(metadata.actor, "Team <name>"); assert.equal(metadata.pending, true);
assert.equal(metadata.age, "1 hour, 15 minutes ago"); assert.match(metadata.updated, /2026/);
const label = historyUI.labelHtml('GA <test> "label"', 'ga" onclick="bad');
assert.match(label, /role="button"/); assert.match(label, /tabindex="0"/);
assert.match(label, /GA &lt;test&gt; &quot;label&quot;/); assert.doesNotMatch(label, / onclick="/);
assert.match(label, /aria-label="GA &lt;test&gt; &quot;label&quot; update history"/);
assert.match(historyUI.labelHtml("GA", "ga", { tag: "script" }), /^<span /);

function documentFixture() {
  const document = { activeElement: null }, timers = new Map(), observers = new Set();
  let sequence = 0;
  class Node {
    constructor(tag) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.attributes = new Map(); this.events = new Map(); this.parentNode = null; this.className = ""; this.style = {}; this._text = ""; }
    [Symbol.for("nodejs.util.inspect.custom")]() { return `<${this.tagName}${this.className ? ` class="${this.className}"` : ""}>`; }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    get isConnected() { return this === document.body || Boolean(this.parentNode?.isConnected); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this); this.parentNode = null; }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    matches(selector) {
      return selector.split(",").some((choice) => {
        const match = choice.trim(), tag = match.match(/^[a-z][\w-]*/i)?.[0];
        if (tag && tag.toLowerCase() !== this.tagName.toLowerCase()) return false;
        for (const [, className] of match.matchAll(/\.([\w-]+)/g)) if (!this.className.split(/\s+/).includes(className)) return false;
        for (const [, name, value] of match.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
          if (!this.attributes.has(name) || (value !== undefined && this.getAttribute(name) !== value)) return false;
        }
        return Boolean(tag || match.startsWith("[") || match.startsWith("."));
      });
    }
    closest(selector) { for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node; return null; }
    addEventListener(type, callback, options = false) { const listeners = this.events.get(type) || []; listeners.push({ callback, capture: options === true || Boolean(options?.capture) }); this.events.set(type, listeners); }
    removeEventListener(type, callback, options = false) { const capture = options === true || Boolean(options?.capture); this.events.set(type, (this.events.get(type) || []).filter((listener) => listener.callback !== callback || listener.capture !== capture)); }
    fire(type, payload = {}) {
      const event = { target: this, relatedTarget: null, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...payload };
      const path = [];
      for (let node = event.target instanceof Node ? event.target : this; node; node = node.parentNode) path.push(node);
      const invoke = (node, capture) => { for (const listener of [...(node.events.get(type) || [])]) if (listener.capture === capture) listener.callback(event); };
      for (const node of [...path].reverse()) { invoke(node, true); if (event.stopped) return event; }
      for (const node of path) { invoke(node, false); if (event.stopped || ["pointerenter", "pointerleave"].includes(type)) break; }
      return event;
    }
    getBoundingClientRect() {
      if (this.rect) return this.rect;
      if (this.className === "date-history-popup") {
        const left = Number.parseFloat(this.style.left) || 0, top = Number.parseFloat(this.style.top) || 0;
        return { width: 272, height: 140, left, top, bottom: top + 140, right: left + 272 };
      }
      return { left: 20, top: 250, right: 120, bottom: 265, width: 100, height: 15 };
    }
    showPopover() { if (document.popoverThrows) throw new Error("Unsupported top layer"); this.popoverShown = true; }
    hidePopover() { this.popoverShown = false; }
  }
  const emitter = new Node("document"), windowEmitter = new Node("window");
  document.createElement = (tag) => new Node(tag); document.body = new Node("body"); document.body.parentNode = emitter;
  document.addEventListener = emitter.addEventListener.bind(emitter); document.removeEventListener = emitter.removeEventListener.bind(emitter);
  document.fire = emitter.fire.bind(emitter); document.events = emitter.events;
  const window = { innerWidth: 800, innerHeight: 600, addEventListener: windowEmitter.addEventListener.bind(windowEmitter), removeEventListener: windowEmitter.removeEventListener.bind(windowEmitter), fire: windowEmitter.fire.bind(windowEmitter), events: windowEmitter.events,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe() { observers.add(this); } disconnect() { observers.delete(this); } },
  };
  document.defaultView = window; document.activeElement = document.body;
  const container = new Node("section"), ga = new Node("span"), end = new Node("span"), editorInput = new Node("input"), outside = new Node("input");
  ga.textContent = "General availability"; ga.setAttribute("data-date-history-field", "ga");
  end.textContent = "End of manufacturing"; end.setAttribute("data-date-history-field", "end");
  ga.setAttribute("aria-describedby", "existing-description");
  editorInput.setAttribute("type", "date"); editorInput.rect = { left: 20, right: 120, top: 268, bottom: 292, width: 100, height: 24 };
  const select = new Node("select"), textarea = new Node("textarea"), editable = new Node("div"), tbd = new Node("button"), dateControl = new Node("div"), dateButton = new Node("button"), buttonIcon = new Node("svg");
  editable.setAttribute("contenteditable", "true"); tbd.className = "date-tbd-button"; dateControl.className = "portfolio-date-control";
  dateButton.append(buttonIcon); dateControl.append(dateButton);
  const editingControls = [select, textarea, editable, tbd, buttonIcon];
  container.append(ga, editorInput, end, select, textarea, editable, tbd, dateControl); document.body.append(container, outside);
  let now = instant, pending = false;
  const histories = { ga: { at: "2026-10-08T16:45:00Z", actor: "<team>" }, end: null };
  const options = { getHistory: (field) => histories[field], isPending: () => pending, now: () => now, locale: "en-US" };
  const controller = historyUI.bind(container, options);
  const popup = () => document.body.children.find((node) => node.className === "date-history-popup") || null;
  const flush = (delay) => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } };
  const notify = () => { for (const observer of [...observers]) observer.callback(); };
  return { document, window, container, ga, end, editorInput, editingControls, outside, options, controller, histories, timers, observers, popup, flush, notify, setNow(value) { now = value; }, setPending(value) { pending = value; } };
}
const ui = documentFixture();
assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0);
assert.equal(historyUI.bind(ui.container, ui.options), ui.controller, "Repeated render binding returns one controller.");
assert.equal(ui.container.events.get("pointerover").length, 1);
ui.ga.fire("pointerover", { pointerType: "mouse" });
assert.equal(ui.popup(), null, "Moving across a date label does not immediately cover the editor.");
assert.equal(ui.timers.size, 1, "Only the intentional hover timer starts before history opens.");
ui.ga.fire("pointerout", { relatedTarget: ui.editorInput });
assert.equal(ui.timers.size, 0, "Crossing directly to a date input cancels the pending hover.");
ui.flush(450); assert.equal(ui.popup(), null);
ui.ga.fire("pointerover", { pointerType: "mouse" });
ui.ga.fire("pointerout", { relatedTarget: ui.outside });
ui.flush(450); assert.equal(ui.popup(), null, "Leaving any label before the delay does not open stale history.");
ui.ga.fire("pointerover", { pointerType: "mouse" });
ui.document.activeElement = ui.editorInput; ui.editorInput.fire("focusin");
ui.flush(450); assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0, "Focusing the editing field cancels pending history without a residual timer.");
ui.document.activeElement = ui.document.body;
ui.ga.fire("pointerover", { pointerType: "mouse" });
ui.document.activeElement = ui.outside; ui.outside.fire("focusin");
ui.flush(450); assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0, "Focus outside the bound date pane cancels a pending hover before it can open.");
ui.document.activeElement = ui.document.body;
ui.ga.fire("pointerover", { pointerType: "mouse" }); ui.outside.fire("pointerover", { pointerType: "mouse" });
ui.flush(450); assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0, "Entering an editing control outside the date pane also cancels pending history.");
ui.ga.fire("pointerover", { pointerType: "mouse" });
const pendingEscape = ui.ga.fire("keydown", { key: "Escape" });
assert.equal(pendingEscape.defaultPrevented, false, "Escape during a pending hover remains available to the editor.");
ui.flush(450); assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0);
ui.ga.fire("pointerover", { pointerType: "mouse" }); ui.flush(450);
const firstPopup = ui.popup();
assert.ok(firstPopup, "A deliberate pause opens history."); assert.equal(firstPopup.parentNode, ui.document.body, "The popup is outside the date pane to avoid clipping.");
assert.equal(firstPopup.getAttribute("role"), "tooltip"); assert.equal(firstPopup.popoverShown, true);
assert.match(firstPopup.textContent, /General availability.*Last updated.*2026.*Age.*1 hour, 15 minutes ago.*Updated by.*<team>/);
assert.match(ui.ga.getAttribute("aria-describedby"), new RegExp(`existing-description ${firstPopup.id}`));
assert.equal(ui.ga.getAttribute("aria-expanded"), "true"); assert.equal(ui.timers.size, 1);
assert.ok(firstPopup.getBoundingClientRect().bottom < ui.ga.getBoundingClientRect().top, "History prefers the space above the label, away from the input below.");
ui.ga.fire("pointerout"); assert.equal(ui.timers.size, 2);
const firstBounds = firstPopup.getBoundingClientRect();
ui.document.fire("pointermove", { target: ui.document.body, clientX: firstBounds.left + 25, clientY: firstBounds.top + 25 });
assert.equal(ui.timers.size, 1, "A transparent popup stays visible while the pointer is geometrically inside it.");
ui.setNow(instant + 60000); ui.flush(60000);
assert.match(ui.popup().textContent, /1 hour, 16 minutes ago/); assert.equal(ui.timers.size, 1, "Only one live age timer runs while open.");
ui.setPending(true); ui.controller.refresh();
assert.match(ui.popup().textContent, /Unsaved change.*Last updated.*Age.*1 hour, 16 minutes ago/, "A draft does not reset the accepted edit age.");
ui.document.fire("pointermove", { target: ui.document.body, clientX: 700, clientY: 500 }); ui.flush(150);
assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0); assert.equal(ui.observers.size, 0);
assert.equal(ui.ga.getAttribute("aria-describedby"), "existing-description"); assert.equal(ui.ga.getAttribute("aria-expanded"), null);
assert.equal(ui.document.events.get("pointerdown").length, 0, "Closing releases global event handlers.");

ui.document.activeElement = ui.ga; ui.ga.fire("focusin");
assert.ok(ui.popup());
ui.editorInput.fire("pointerover", { pointerType: "mouse" });
assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0, "Entering the input closes history immediately even while its label retains focus.");
ui.ga.fire("focusin"); assert.ok(ui.popup());
ui.document.fire("pointermove", { target: ui.editorInput, clientX: 35, clientY: 280 });
assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0, "Actual editing controls take priority over geometric hover preservation.");
for (const control of ui.editingControls) {
  ui.ga.fire("focusin"); assert.ok(ui.popup()); control.fire("pointerover", { pointerType: "mouse" });
  assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0, `Editing via ${control.className || control.tagName} clears history immediately.`);
}
ui.ga.fire("focusin"); assert.ok(ui.popup());
ui.document.activeElement = ui.editorInput;
ui.ga.fire("focusout", { relatedTarget: ui.editorInput }); ui.editorInput.fire("focusin", { relatedTarget: ui.ga });
assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0, "Tabbing from a history label to its input dismisses history synchronously.");
ui.document.activeElement = ui.document.body;

ui.ga.fire("pointerover", { pointerType: "touch" }); assert.equal(ui.popup(), null, "Touch uses intentional tap rather than hover.");
const tap = ui.ga.fire("click"); assert.equal(tap.defaultPrevented, true); assert.ok(ui.popup());
ui.ga.fire("pointerout"); ui.flush(150); assert.ok(ui.popup(), "Tap pins the popup.");
ui.ga.fire("click"); assert.equal(ui.popup(), null, "A second tap closes it.");
ui.document.activeElement = ui.ga; ui.ga.fire("focusin"); assert.ok(ui.popup(), "Keyboard focus exposes history.");
const space = ui.ga.fire("keydown", { key: " " }); assert.equal(space.defaultPrevented, true);
ui.ga.fire("keydown", { key: "Enter" }); assert.equal(ui.popup(), null);
ui.ga.fire("focusin");
const escape = ui.document.fire("keydown", { key: "Escape", target: ui.ga }); assert.equal(escape.defaultPrevented, true); assert.equal(ui.popup(), null);
ui.ga.fire("click"); assert.ok(ui.popup());
ui.editorInput.fire("pointerdown");
assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0, "A pinned history never delays editing the underlying date field.");
ui.ga.fire("click"); assert.ok(ui.popup());
ui.document.activeElement = ui.outside; ui.outside.fire("focusin");
assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0, "Keyboard focus outside the date label closes even a pinned popup.");
ui.document.activeElement = ui.document.body;

ui.end.fire("click"); assert.match(ui.popup().textContent, /End of manufacturing.*Unsaved change.*No edit history yet.*Tracking begins with the next date update\./);
assert.doesNotMatch(ui.popup().textContent, /Last updated|Age|ago/);
ui.document.fire("pointerdown", { target: ui.outside }); assert.equal(ui.popup(), null);
ui.document.popoverThrows = true; ui.ga.fire("click"); assert.equal(ui.popup().getAttribute("popover"), null, "An unavailable top layer falls back to a visible body portal.");
ui.ga.rect = { left: 20, right: 120, top: 35, bottom: 50, width: 100, height: 15 };
ui.window.fire("resize");
assert.ok(ui.popup().getBoundingClientRect().left > ui.ga.rect.right, "A label near the top uses free space beside it before placing history over its input.");
assert.ok(ui.popup().getBoundingClientRect().top >= 10);
ui.ga.rect = { left: 770, right: 799, top: 560, bottom: 580, width: 29, height: 20 };
ui.window.fire("resize");
assert.equal(ui.popup().style.left, "518px"); assert.equal(ui.popup().style.top, "413px", "The popup stays inside both viewport edges.");
ui.ga.rect = { left: 520, right: 570, top: 35, bottom: 50, width: 50, height: 15 };
ui.window.fire("resize");
assert.ok(ui.popup().getBoundingClientRect().right < ui.ga.rect.left, "The left side is used when there is not enough room to the right.");
ui.ga.rect = { left: 100, right: 700, top: 35, bottom: 50, width: 600, height: 15 };
ui.window.fire("resize");
assert.equal(ui.popup().style.top, "57px", "History uses below only when neither above nor either side fits.");
ui.ga.rect = { left: 10, right: 30, top: -30, bottom: -10, width: 20, height: 20 };
ui.document.fire("scroll"); assert.equal(ui.popup(), null, "A scrolled-away date label cannot leave a floating popup behind.");
ui.ga.rect = null;
ui.ga.fire("click"); ui.ga.remove(); ui.notify();
assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0); assert.equal(ui.observers.size, 0, "A rerender removes the popup and its timers immediately.");
ui.container.append(ui.ga); ui.ga.fire("click");
ui.container.remove(); ui.notify(); assert.equal(ui.popup(), null); assert.equal(ui.timers.size, 0);
ui.controller.destroy(); ui.controller.destroy();
for (const listeners of ui.container.events.values()) assert.equal(listeners.length, 0);
for (const listeners of ui.document.events.values()) assert.equal(listeners.length, 0, "Destroying the binding releases document-level pending-hover handlers.");
ui.document.body.append(ui.container); assert.notEqual(historyUI.bind(ui.container, ui.options), ui.controller);
historyUI.bind(ui.container, ui.options).destroy();
const pendingDestroy = documentFixture(); pendingDestroy.ga.fire("pointerover", { pointerType: "mouse" });
assert.equal(pendingDestroy.timers.size, 1); pendingDestroy.controller.destroy(); pendingDestroy.flush(450);
assert.equal(pendingDestroy.popup(), null); assert.equal(pendingDestroy.timers.size, 0, "Destroying a pending hover cannot leave a delayed orphan popup.");
for (const listeners of pendingDestroy.document.events.values()) assert.equal(listeners.length, 0);

const css = await readFile(new URL("../../public/css/date-history.css", import.meta.url), "utf8");
assert.match(css, /\.date-history-popup\s*\{[^}]*position:\s*fixed;/);
assert.match(css, /\.date-history-popup\s*\{[^}]*pointer-events:\s*none;/, "History remains pointer-transparent in hover, keyboard, and pinned modes.");
assert.match(css, /\.date-history-label:focus-visible/);
assert.doesNotMatch(css, /\.date-history-label\s*\{[^}]*(?:height|min-height|padding):/, "Date labels gain no permanent height.");
console.log("Date history UI checks passed.");
