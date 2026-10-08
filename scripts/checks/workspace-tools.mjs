import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const workspaceSource = await readFile(new URL("../../public/js/workspace-ui.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const setupSource = workspaceSource.match(/^  function setupToolbarMenus\([^]*?^  \}/m)?.[0];
const popupSource = appSource.match(/^function closePopupMenus\([^]*?^\}/m)?.[0];
assert.ok(setupSource, "Exercise the actual compact toolbar interaction function.");
assert.ok(popupSource, "Exercise the application's shared popup-closing hook.");

function harness() {
  const focusEvents = [];
  const document = { activeElement: null };
  function node(tagName, className = "") {
    const listeners = new Map();
    const value = {
      tagName: tagName.toUpperCase(), className, children: [], parentNode: null,
      open: false, disabled: false, inert: false, attributes: new Map(),
      append(...children) { for (const child of children) { this.children.push(child); child.parentNode = this; } },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      querySelector(selector) {
        for (const child of this.children) {
          if (selector === "summary" && child.tagName === "SUMMARY") return child;
          const nested = child.querySelector(selector);
          if (nested) return nested;
        }
        return null;
      },
      closest(selector) {
        for (let current = this; current; current = current.parentNode) {
          if (selector.startsWith(".") && !selector.includes(" ") && current.classList?.contains(selector.slice(1))) return current;
          if (selector === ".workspace-tool-menu-panel button" && current.tagName === "BUTTON" && current.parentNode?.closest(".workspace-tool-menu-panel")) return current;
          if (selector === "#workspaceSettingsDialog" && current.id === "workspaceSettingsDialog") return current;
        }
        return null;
      },
      contains(target) { for (let current = target; current; current = current.parentNode) if (current === this) return true; return false; },
      setAttribute(name, content) { this.attributes.set(name, String(content)); },
      getClientRects() {
        for (let current = this; current; current = current.parentNode) {
          if (current.classList?.contains("hidden")) return [];
          if (current.tagName === "DETAILS" && !current.open && this !== current && !current.querySelector("summary")?.contains(this)) return [];
        }
        return this.isConnected ? [{}] : [];
      },
      focus(options) { document.activeElement = this; focusEvents.push({ node: this, options: options ? JSON.parse(JSON.stringify(options)) : null }); },
      fire(type, options = {}) {
        const event = {
          type, target: this, defaultPrevented: false, propagationStopped: false,
          preventDefault() { this.defaultPrevented = true; },
          stopPropagation() { this.propagationStopped = true; },
          ...options,
        };
        for (let current = this; current; current = current.parentNode) {
          for (const listener of current.listeners.get(type) || []) listener(event);
          if (event.propagationStopped || type === "toggle") break;
        }
        return event;
      },
      listeners,
    };
    value.classList = {
      contains: (name) => value.className.split(/\s+/).includes(name),
      add(name) { if (!this.contains(name)) value.className = `${value.className} ${name}`.trim(); },
      remove(name) { value.className = value.className.split(/\s+/).filter((item) => item !== name).join(" "); },
    };
    Object.defineProperty(value, "isConnected", { get() { return document.contains(value); } });
    return value;
  }
  Object.assign(document, node("document"));
  document.body = node("body");
  document.append(document.body);
  const app = node("main", "app-shell"), outside = node("input"), modalFocus = node("button");
  document.body.append(app, modalFocus);
  app.append(outside);
  const menus = Array.from({ length: 3 }, (_, index) => {
    const menu = node("details", "workspace-tool-menu"), summary = node("summary"), panel = node("div", "workspace-tool-menu-panel");
    const button = node("button"), buttonCopy = node("span"), select = node("select"), input = node("input");
    menu.id = `tools-${index}`; button.append(buttonCopy); panel.append(button, select, input); menu.append(summary, panel); app.append(menu);
    return { menu, summary, panel, button, buttonCopy, select, input };
  });
  document.querySelectorAll = (selector) => selector === ".workspace-tool-menu" ? menus.map(({ menu }) => menu) : [];
  document.activeElement = outside;
  const context = { document, app, selection: "selected-product", mode: "dates" };
  vm.createContext(context);
  new vm.Script(`${setupSource}\nthis.close = setupToolbarMenus();`).runInContext(context);
  // This models the existing application Escape fall-through: a disclosure
  // must consume dismissal before it can cancel date editing or selection.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { context.selection = null; context.mode = "pan"; }
  });
  const open = (index = 0) => { menus[index].menu.open = true; menus[index].menu.fire("toggle"); };
  return { context, document, app, outside, modalFocus, menus, focusEvents, open, node };
}

{
  const h = harness(); h.open(0); h.open(1);
  assert.equal(h.menus[0].menu.open, false, "Opening another disclosure closes the first.");
  assert.equal(h.menus[1].menu.open, true);
  assert.equal(h.menus[2].menu.open, false);
  h.menus[0].menu.fire("toggle");
  assert.equal(h.menus[1].menu.open, true, "A deferred closed-toggle event does not close the newly opened disclosure.");
}

{
  const h = harness(); h.open();
  const { menu, select, input, summary } = h.menus[0];
  for (const target of [select, input, summary]) {
    target.focus(); target.fire("pointerdown");
    assert.equal(menu.open, true, "Controls and the summary do not trigger the outside-pointer closer.");
  }
  select.fire("focusout", { relatedTarget: input });
  assert.equal(menu.open, true, "Tabbing between controls inside the disclosure leaves it open.");
  input.fire("focusout", { relatedTarget: null });
  assert.equal(menu.open, true, "A native selector or window blur without a new target does not prematurely close tools.");
  input.fire("focusout", { relatedTarget: h.outside });
  assert.equal(menu.open, false, "Leaving for a real outside focus target closes the disclosure.");
}

{
  const h = harness(); h.open(); const { select, summary, menu } = h.menus[0];
  select.focus(); const event = select.fire("keydown", { key: "Escape" });
  assert.equal(event.defaultPrevented, true); assert.equal(event.propagationStopped, true);
  assert.equal(menu.open, false); assert.equal(h.document.activeElement, summary);
  assert.deepEqual(h.focusEvents.at(-1).options, { preventScroll: true });
  assert.equal(h.context.selection, "selected-product", "Dismissal never clears the selected product.");
  assert.equal(h.context.mode, "dates", "Dismissal never turns off Edit Mode.");
}

{
  const h = harness(); h.open(); h.outside.focus();
  const focusCount = h.focusEvents.length; h.outside.fire("pointerdown");
  assert.equal(h.menus[0].menu.open, false); assert.equal(h.document.activeElement, h.outside);
  assert.equal(h.focusEvents.length, focusCount, "Outside-pointer dismissal does not steal focus.");
  assert.equal(h.context.selection, "selected-product"); assert.equal(h.context.mode, "dates");
}

{
  const h = harness(); h.open(); const { button, buttonCopy, summary, menu } = h.menus[0];
  let actions = 0;
  button.addEventListener("click", () => { actions++; assert.equal(menu.open, true, "The target action runs before its menu closes."); });
  button.focus(); buttonCopy.fire("click");
  assert.equal(actions, 1); assert.equal(menu.open, false); assert.equal(h.document.activeElement, summary);
  assert.deepEqual(h.focusEvents.at(-1).options, { preventScroll: true });
}

{
  const h = harness(); h.open(); const { button, menu } = h.menus[0];
  button.disabled = true; h.outside.focus(); button.fire("click");
  assert.equal(menu.open, true, "A disabled tool action is ignored.");
  assert.equal(h.document.activeElement, h.outside);
  button.disabled = false;
  button.addEventListener("click", () => h.outside.focus()); button.focus(); button.fire("click");
  assert.equal(menu.open, false); assert.equal(h.document.activeElement, h.outside, "A tool that intentionally moves focus keeps its destination.");
}

{
  const h = harness(); h.open(); const { button, menu } = h.menus[0];
  button.addEventListener("click", () => { h.app.inert = true; h.modalFocus.focus(); });
  button.focus(); button.fire("click");
  assert.equal(menu.open, false); assert.equal(h.document.activeElement, h.modalFocus, "Opening Settings retains modal focus while the tools menu closes.");
  h.app.inert = true; h.open(); button.focus();
  const count = h.focusEvents.length; h.document.fire("click", { target: button });
  assert.equal(h.focusEvents.length, count, "An inert app cannot refocus its toolbar even if the original action remains active.");
}

{
  const h = harness(); h.open(); const old = h.menus[0]; old.select.focus();
  old.menu.classList.add("hidden"); const count = h.focusEvents.length;
  assert.equal(h.context.close(), true); assert.equal(old.menu.open, false);
  assert.equal(h.focusEvents.length, count, "View-switch closure never focuses the old hidden view summary.");
  assert.equal(h.context.close(), false, "Repeated closure is harmless.");
  h.open(); assert.equal(h.context.close({ focus: true }), true);
  assert.equal(h.focusEvents.length, count, "Even explicit focus restoration skips a hidden summary.");
}

{
  const h = harness(); h.open(); const focusCount = h.focusEvents.length;
  const popup = h.node("div"), popupButton = h.node("button"), settings = h.node("div"), embedded = h.node("div");
  settings.id = "workspaceSettingsDialog"; settings.append(embedded); h.app.append(popup, popupButton, settings);
  const dispatched = [];
  class CustomEvent { constructor(type) { this.type = type; } }
  Object.assign(h.context, {
    PortfolioWorkspaceUI: { closeToolMenus: h.context.close }, dataMenu: popup, roadmapMenu: embedded, productMenu: null,
    dataMenuButton: popupButton, roadmapMenuButton: null, productMenuButton: null,
    window: { dispatchEvent(event) { dispatched.push(event.type); } }, CustomEvent,
  });
  new vm.Script(popupSource).runInContext(h.context);
  h.context.closePopupMenus();
  assert.equal(h.menus[0].menu.open, false, "The real application view/action closure includes toolbar disclosures.");
  assert.equal(h.focusEvents.length, focusCount);
  assert.equal(popup.classList.contains("hidden"), true); assert.equal(embedded.classList.contains("hidden"), false);
  assert.equal(popupButton.attributes.get("aria-expanded"), "false"); assert.deepEqual(dispatched, ["close-workspace-settings"]);
  h.open(); h.context.closePopupMenus(popup);
  assert.equal(h.menus[0].menu.open, false, "The legacy popup except argument does not leave compact tools open.");
  assert.equal(dispatched.length, 1);
  delete h.context.PortfolioWorkspaceUI;
  h.context.closePopupMenus();
  assert.equal(dispatched.length, 2, "The application closure remains safe before Workspace UI is loaded.");
}

console.log("Workspace tool checks passed: disclosure exclusivity, native control interaction, Escape preservation, outside/focus departure, action and modal focus, and real view/action closure.");
