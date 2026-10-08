import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "../../public/js/workspace-notifications.js";

const notifications = globalThis.PortfolioNotifications;
let clock = 1000;
const store = notifications.createStore({ now: () => clock, limit: 3 });
const events = [];
store.subscribe((event) => events.push(event));
const warning = { id: "duplicates", severity: "warning", title: "Products to review", message: "Two products share SKU ONE.", actions: [{ label: "Review products", onClick() {} }], toast: false };
store.publish(warning);
store.publish(warning);
assert.equal(events.length, 1, "an identical source update must not repeat its live announcement or unread count");
assert.equal(store.getState().count, 1);
store.markRead();
assert.equal(store.getState().count, 1, "reading does not hide an unresolved warning badge");
assert.equal(store.dismiss("duplicates"), true);
store.publish(warning);
assert.equal(store.getState().count, 0, "an unchanged dismissed warning does not return on every render");
store.publish({ ...warning, message: "Three products share SKU ONE." });
assert.equal(store.getState().count, 1, "a changed issue becomes discoverable again");
store.resolve("duplicates");
store.publish(warning);
assert.equal(store.getState().count, 1, "an issue that was resolved can be reported again later");
store.publish({ id: "pending", severity: "info", title: "Changes ready", message: "Local changes", dismissible: false, toast: false });
assert.equal(store.dismiss("pending"), false);
store.publish({ id: "done", severity: "success", title: "Saved to master", ttl: 1000 });
assert.equal(events.at(-1).toast, true);
store.publish({ id: "other", severity: "info", title: "Another update" });
assert.equal(store.getState().items.length, 3, "older informational history is bounded");
assert.equal(store.getState().items[0].id, "duplicates", "warnings sort above recent successful updates");
clock += 20 * 60 * 1000; store.expire();
assert.deepEqual(store.getState().items.map((item) => item.id).sort(), ["duplicates", "pending"], "warnings and current pending work survive informational history expiry");
store.publish({ id: "markup", title: "Literal input", message: "<img src=x onerror=alert(1)>\nNever interpreted as HTML", actions: [{ label: "Missing callback" }, { label: "", onClick() {} }] });
assert.equal(store.getState().items.find((item) => item.id === "markup").actions.length, 0);

const source = await readFile(new URL("../../public/js/workspace-notifications.js", import.meta.url), "utf8");
function createUi({ withPull = true } = {}) {
  let nextTimer = 0;
  const timers = new Map(), intervals = new Map(), nodes = [];
  const document = { activeElement: null, visibilityState: "visible" };
  function node(tag) {
    const listeners = new Map(), attributes = new Map();
    const current = { tagName: tag.toUpperCase(), children: [], parentNode: null, dataset: {}, textContent: "", className: "", open: false, disabled: false, hidden: false,
      append(...values) { for (const value of values) { this.children.push(value); value.parentNode = this; } },
      replaceChildren(...values) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...values); },
      insertAdjacentElement(position, value) { assert.equal(position, "beforebegin"); const index = this.parentNode.children.indexOf(this); this.parentNode.children.splice(index, 0, value); value.parentNode = this.parentNode; },
      remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; },
      addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(listener); },
      dispatch(name, options = {}) { const event = { target: this, preventDefault() {}, stopPropagation() {}, ...options }; for (const listener of listeners.get(name) || []) listener(event); },
      setAttribute(name, value) { attributes.set(name, String(value)); }, getAttribute: (name) => attributes.get(name),
      focus() { document.activeElement = this; },
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelectorAll(selector) { const all = []; const visit = (root) => { for (const child of root.children) { if (selector === "button" && child.tagName === "BUTTON") all.push(child); visit(child); } }; visit(this); return all; },
      closest(selector) { for (let check = this; check; check = check.parentNode) { if (selector.includes("[inert]") && check.inert || selector.includes(".hidden") && check.classList.contains("hidden") || selector.includes("[hidden]") && check.hidden) return check; } return null; },
      getBoundingClientRect() { return { left: 100, right: 560, top: 68, bottom: 500 }; },
      scrollIntoView() { this.scrolled = true; },
    };
    current.classList = { contains: (name) => current.className.split(/\s+/).includes(name), toggle(name, force) { const all = new Set(current.className.split(/\s+/).filter(Boolean)); const add = force ?? !all.has(name); if (add) all.add(name); else all.delete(name); current.className = [...all].join(" "); return add; } };
    Object.defineProperty(current, "isConnected", { get() { let ancestor = current; while (ancestor.parentNode) ancestor = ancestor.parentNode; return ancestor === document.body; } });
    Object.defineProperty(current, "innerHTML", { set() { throw new Error("Messages must never interpret HTML."); } });
    nodes.push(current); return current;
  }
  document.createElement = node;
  document.createElementNS = (_namespace, tag) => node(tag);
  document.body = node("body");
  document.activeElement = document.body;
  const toolbar = node("div"), pull = withPull ? node("button") : null, settings = node("button"); settings.id = "workspaceSettingsButton";
  if (pull) { pull.id = "pullLatestData"; toolbar.append(pull); }
  toolbar.append(settings); document.body.append(toolbar);
  document.getElementById = (id) => nodes.find((entry) => entry.id === id && entry.isConnected) || null;
  document.querySelector = () => nodes.find((entry) => entry.isConnected && (entry.tagName === "DIALOG" && entry.open || entry.classList.contains("modal-backdrop") && !entry.classList.contains("hidden") && !entry.hidden)) || null;
  const sandbox = { document, setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); }, setInterval(callback) { const id = ++nextTimer; intervals.set(id, callback); return id; }, clearInterval(id) { intervals.delete(id); } };
  vm.createContext(sandbox); new vm.Script(source).runInContext(sandbox);
  return { notifications: sandbox.PortfolioNotifications, document, nodes, timers, intervals, settings, pull, panel: document.getElementById("workspaceMessagesPanel"), button: document.getElementById("workspaceMessagesButton"), find: (className) => nodes.filter((entry) => entry.isConnected && entry.classList.contains(className)), tick() { for (const callback of [...timers.values()]) callback(); timers.clear(); }, settle: () => new Promise((resolve) => setImmediate(resolve)) };
}

const ui = createUi();
assert.equal(ui.button.parentNode.children.indexOf(ui.button) + 1, ui.button.parentNode.children.indexOf(ui.pull), "the compact Messages control immediately precedes Pull latest data");
const fallbackUi = createUi({ withPull: false });
assert.equal(fallbackUi.button.parentNode.children.indexOf(fallbackUi.button) + 1, fallbackUi.button.parentNode.children.indexOf(fallbackUi.settings), "a workspace without the pull action still mounts Messages beside Settings");
assert.equal(ui.panel.tagName, "DIALOG");
assert.equal(ui.button.getAttribute("aria-controls"), ui.panel.id);
assert.equal(ui.panel.getAttribute("aria-labelledby"), "workspaceMessagesTitle");
assert.equal(ui.panel.getAttribute("aria-describedby"), "workspaceMessagesDescription");
ui.notifications.show();
assert.equal(ui.panel.open, true);
assert.equal(ui.find("workspace-messages-empty").length, 1);
assert.equal(ui.button.getAttribute("aria-expanded"), "true");
ui.panel.dispatch("keydown", { key: "Escape" });
assert.equal(ui.panel.open, false); assert.equal(ui.document.activeElement, ui.document.body, "Escape restores the previous focus");
ui.button.focus();
ui.button.dispatch("click");
ui.panel.dispatch("click", { clientX: 2, clientY: 2 });
assert.equal(ui.panel.open, false); assert.equal(ui.document.activeElement, ui.button, "clicking outside closes the panel and restores its trigger");

ui.notifications.publish({ id: "saved", severity: "success", title: "Saved to master", message: "All changes accepted", toast: true });
assert.equal(ui.find("workspace-toast").length, 1);
assert.equal(ui.find("workspace-toast-copy")[0].textContent, "Saved to master", "the transient toast keeps only a short title");
ui.tick();
assert.equal(ui.find("workspace-toast").length, 0, "success toast disappears automatically while its full message remains available");
assert.equal(ui.notifications.getState().items.length, 1);

const editor = ui.document.createElement("dialog"); ui.document.body.append(editor); editor.showModal();
ui.notifications.publish({ id: "suppressed", severity: "success", title: "Background update", message: "Available in Messages" });
assert.equal(ui.find("workspace-toast").length, 0, "a toast cannot cover a modal editor or conflict choice");
ui.notifications.show(); assert.equal(ui.panel.open, false, "the messages panel cannot stack over an active editor");
editor.close();
ui.notifications.publish({ id: "literal", severity: "warning", title: "Duplicate <script>", message: "<img onerror=alert(1)>\nLong detail stays readable.", toast: false });
ui.notifications.show("literal");
assert.equal(ui.find("workspace-message-copy").find((entry) => entry.textContent.includes("<img")).textContent, "<img onerror=alert(1)>\nLong detail stays readable.");
assert.equal(ui.find("workspace-message-warning")[0].scrolled, true);
assert.match(ui.button.getAttribute("aria-label"), /1 item to review/, "read informational messages clear their badge but unresolved warnings remain");
assert.equal(ui.nodes.find((entry) => entry.getAttribute("role") === "alert").textContent, "Duplicate <script>. <img onerror=alert(1)>\nLong detail stays readable.");

let runs = 0, finishAction;
ui.notifications.publish({ id: "actionable", severity: "warning", title: "Find duplicates", message: "Review the listed products", actions: [{ label: "Review products", onClick: () => { runs += 1; return new Promise((resolve) => { finishAction = resolve; }); } }] });
ui.notifications.show("actionable");
const action = ui.find("workspace-message-actions").flatMap((row) => row.children).find((entry) => entry.textContent === "Review products");
action.dispatch("click"); action.dispatch("click");
assert.equal(runs, 1, "double clicks cannot execute an asynchronous message action twice");
assert.equal(ui.panel.open, false, "the panel closes before navigation or another dialog opens");
finishAction(); await ui.settle();
ui.notifications.publish({ id: "failed-action", severity: "warning", title: "Retry import", actions: [{ label: "Retry", onClick() { throw new Error("The source is unavailable."); } }] });
ui.notifications.show();
ui.find("workspace-message-actions").flatMap((row) => row.children).find((entry) => entry.textContent === "Retry").dispatch("click");
await ui.settle();
assert.equal(ui.notifications.getState().items.find((entry) => entry.id === "failed-action:action-error").message, "The source is unavailable.", "an action failure is retained as a readable error");

ui.notifications.show();
ui.find("workspace-messages-footer")[0].children[1].dispatch("click");
assert.equal(ui.notifications.getState().items.some((entry) => entry.severity === "success"), false);
assert.equal(ui.notifications.getState().items.some((entry) => entry.id === "literal"), true, "clearing updates preserves warnings and errors");
ui.panel.dispatch("cancel"); assert.equal(ui.panel.open, false);

console.log("Workspace message checks passed: source deduplication and resolution, dismissal stability, persistent attention items, bounded informational history, safe text, modal focus and Escape, toast expiry and modal suppression, async action guards, and retained action errors.");
