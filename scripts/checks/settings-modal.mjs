import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const appSource = (await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const workspaceSource = await readFile(new URL("../../public/js/workspace-ui.js", import.meta.url), "utf8");
const messageSource = await readFile(new URL("../../public/js/app-dialogs.js", import.meta.url), "utf8");
const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
const appFunction = (name) => {
  const value = appSource.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"))?.[0];
  assert.ok(value, `actual ${name} integration exists`);
  return value;
};

// A DOM/event boundary exercises the complete shipped controllers together.
// The fixture implements browser event phases, inert ancestry, visibility,
// focus events and mutation delivery; it never implements modal behavior.
function fixture() {
  const nodes = new Map(), observers = new Set(), microtasks = [], frames = [];
  let document, window;
  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, handler, options = {}) {
      const capture = options === true || Boolean(options.capture);
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({ handler, capture });
    }
    dispatchEvent(event) {
      event.target ||= this;
      event.preventDefault ||= () => { event.defaultPrevented = true; };
      event.stopPropagation ||= () => { event.stopped = true; };
      event.stopImmediatePropagation ||= () => { event.stopped = true; event.immediate = true; };
      const path = [this];
      for (let parent = this.parent; parent; parent = parent.parent) path.push(parent);
      if (this !== window && !path.includes(document)) path.push(document);
      if (this !== window) path.push(window);
      const deliver = (target, capture) => {
        for (const listener of target.listeners.get(event.type) || []) {
          if (listener.capture !== capture) continue;
          listener.handler.call(target, event);
          if (event.immediate) break;
        }
      };
      for (const target of [...path].reverse()) { deliver(target, true); if (event.stopped) return !event.defaultPrevented; }
      for (const target of path) {
        deliver(target, false);
        if (!event.immediate && typeof target[`on${event.type}`] === "function") target[`on${event.type}`](event);
        if (event.stopped) break;
      }
      return !event.defaultPrevented;
    }
  }
  class Element extends Events {
    constructor(tag = "div", id = "") {
      super(); this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.parent = null;
      this.attributes = new Map(); this.dataset = {}; this.style = {}; this.value = ""; this.disabled = false;
      this.hidden = false; this.visibility = "visible"; this.textContent = ""; this.validityMessage = "";
      this.tabIndex = ["button", "input", "select", "textarea", "summary"].includes(tag) ? 0 : -1;
      const classes = new Set();
      this.classList = { add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)),
        contains: value => classes.has(value), toggle(value, enabled = !classes.has(value)) { if (enabled) classes.add(value); else classes.delete(value); } };
      if (id) nodes.set(id, this);
    }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; if (document.activeElement === this) document.activeElement = document.body; }
    get isConnected() { return this === document.body || Boolean(this.parent?.isConnected); }
    get inert() { return this.attributes.has("inert"); }
    set inert(value) { if (value) this.attributes.set("inert", ""); else this.attributes.delete("inert"); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "tabindex") this.tabIndex = Number(value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    matches(selector) {
      return selector.split(",").some(raw => {
        const part = raw.trim();
        if (part === ":disabled") return this.disabled || Boolean(this.closest("[disabled]"));
        if (part.startsWith(".")) return this.classList.contains(part.slice(1));
        if (part.startsWith("#")) return this.id === part.slice(1);
        const attribute = part.match(/^\[([^\]]+)\]$/)?.[1];
        if (attribute) return attribute === "hidden" ? this.hidden || this.attributes.has(attribute) : attribute.startsWith("data-") ? attribute.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) in this.dataset : this.attributes.has(attribute);
        if (part === "a[href]") return this.tagName === "A" && this.attributes.has("href");
        if (part === "dialog[open]") return this.tagName === "DIALOG" && this.open;
        return this.tagName.toLowerCase() === part;
      });
    }
    closest(selector) { for (let node = this; node; node = node.parent) if (node.matches(selector)) return node; return null; }
    contains(other) { return other === this || this.children.some(child => child.contains(other)); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getClientRects() { return this.isConnected && !this.closest(".hidden, [hidden]") ? [{}] : []; }
    focus() {
      if (!this.isConnected || this.disabled || this.closest("[inert], .hidden, [hidden]")) return;
      document.activeElement = this;
      this.dispatchEvent({ type: "focusin" });
    }
    click() { this.dispatchEvent({ type: "click" }); }
    setCustomValidity(value) { this.validityMessage = value; }
    reportValidity() { this.validationReported = true; return !this.validityMessage; }
  }
  document = new Events(); window = new Events(); document.body = new Element("body"); document.activeElement = document.body;
  document.getElementById = id => nodes.get(id) || null;
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.querySelector = selector => document.body.querySelector(selector);
  const add = (id, tag = "div", parent = document.body, className = "") => {
    const element = new Element(tag, id); parent.append(element); if (className) element.classList.add(...className.split(" ")); return element;
  };
  const app = add("app", "div", document.body, "app-shell");
  add("header", "header", app, "topbar"); add("controls", "div", app, "workspace-controls");
  const trigger = add("workspaceSettingsButton", "button", app);
  const workspace = add("workspaceSettingsDialog", "div", document.body, "modal-backdrop hidden");
  const category = add("categorySettingsDialog", "div", document.body, "modal-backdrop hidden");
  const message = add("appMessageDialog", "div", document.body, "modal-backdrop hidden");
  const empty = add("workspaceEmpty", "div", document.body, "hidden");
  const categoryForm = add("categorySettingsForm", "form", category);
  const tabs = ["display", "timeline", "data"].map(name => {
    const tab = add(`tab-${name}`, "button", workspace); tab.dataset.settingsTab = name;
    const panel = add(`panel-${name}`, "section", workspace); panel.dataset.settingsPanel = name; return tab;
  });
  add("categorySettings", "button", nodes.get("panel-display"));
  add("workspaceSettingsClose", "button", workspace); add("workspaceSettingsDone", "button", workspace);
  for (const id of ["closeCategorySettings", "addLaneSetting", "cancelCategorySettings", "saveCategorySettings"]) add(id, "button", categoryForm);
  for (const id of ["settingsCategoryName", "settingsBoardTitle", "settingsRoadmapLabel"]) add(id, "input", categoryForm);
  add("laneSettingsList", "div", categoryForm);
  for (const id of ["appMessageTitle", "appMessageText"]) add(id, "p", message);
  for (const id of ["appMessageCancel", "appMessageAccept"]) add(id, "button", message);
  nodes.get("appMessageText").setAttribute("tabindex", "0");
  const shellIds = ["categoryContext", "settingsActiveCategory", "statusbar", "workspaceSummary", "workspaceSelection", "workspaceEmptyTitle", "timelineRangeSummary", "roadmapStart", "roadmapEnd"];
  for (const id of shellIds) add(id, "div", app);
  for (const id of ["quickTimelineSettings", "quickEditSelected", "editSelected", "dataMenuButton", "productMenuButton", "roadmapMenuButton", "importPackage", "pullLatestData"]) add(id, "button", app);
  for (const id of ["emptyImportPackage", "emptyPullLatestData"]) add(id, "button", empty);
  nodes.get("roadmapStart").value = "2026-01"; nodes.get("roadmapEnd").value = "2028-01";
  const board = { title: "Audio", lanes: [{ id: "one", label: "Wired", order: 4 }, { id: "two", label: "Wireless", order: 9 }],
    products: [{ id: "a", name: "Fixture A", laneId: "one", order: 4 }, { id: "b", name: "Fixture B", laneId: "two", order: 9 }], settings: { roadmap: { categoryLabel: "Headsets" } } };
  const categoryData = { id: "audio", name: "Headsets", board };
  const calls = { save: 0, render: 0, globalEscape: 0, popupClose: 0 };
  const context = vm.createContext({ window, document, HTMLElement: Element, console, board, categorySettingsDialog: category,
    categorySettingsForm: categoryForm, categorySettingsDraftLanes: [],
    $: selector => nodes.get(selector.slice(1)), activeCategoryRecord: () => categoryData, sortedLanes: () => board.lanes,
    renderLaneSettingsEditor() {}, id: () => "fixture", normalizeLaneOrders() { throw new Error("Unchanged lanes must preserve placement"); },
    scheduleSave: () => { calls.save++; }, syncControls() {}, renderInspector: () => { calls.render++; }, renderActiveView: () => { calls.render++; }, fitProductLanesVertically() {},
    closePopupMenus: () => { calls.popupClose++; window.dispatchEvent({ type: "close-workspace-settings" }); },
    closeVariantPopover() {}, closeAscmImportDialog() {}, closePptxExportDialog() {}, handleProductReorderKeydown() { calls.globalEscape++; return false; },
    roadmapInteractionMode: "pan", roadmapDragState: null, roadmapPanState: null, inspectorOpen: false, selectedId: "a", clearSelection() { throw new Error("Modal Escape must not clear a product selection"); },
    getComputedStyle: element => ({ visibility: element.visibility }),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.target = null; observers.add(this); }
      observe(target) { this.target = target; } disconnect() { this.target = null; }
    },
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    queueMicrotask: callback => microtasks.push(callback), requestAnimationFrame: callback => frames.push(callback),
  });
  vm.runInContext(messageSource, context, { filename: "app-dialogs.js" });
  context.PortfolioDialogs = window.PortfolioDialogs;
  vm.runInContext(workspaceSource, context, { filename: "workspace-ui.js" });
  context.PortfolioWorkspaceUI = window.PortfolioWorkspaceUI;
  vm.runInContext(["openCategorySettings", "closeCategorySettings", "saveCategorySettings"].map(appFunction).join("\n"), context);
  const bindings = appSource.slice(appSource.indexOf('$("#categorySettings").onclick'), appSource.indexOf('$("#addLaneSetting").onclick'));
  vm.runInContext(bindings, context);
  const globalEscape = appSource.match(/^window\.addEventListener\("keydown", \(event\) => \{\n  if \(event\.key !== "Escape"[^]*?^\}\);/m)?.[0];
  assert.ok(globalEscape); vm.runInContext(globalEscape, context);
  const key = (value, shiftKey = false) => { const event = { type: "keydown", key: value, shiftKey }; document.activeElement.dispatchEvent(event); return event; };
  const flush = () => { for (const observer of observers) if (observer.target) observer.callback([]); while (microtasks.length) microtasks.shift()(); while (frames.length) frames.shift()(); };
  trigger.focus();
  return { nodes, context, window, document, app, workspace, category, message, empty, trigger, categoryForm, tabs, board, categoryData, calls, add, key, flush };
}

let checks = 0;
{
  const h = fixture(), { nodes, context, document, app, empty, trigger, workspace, category } = h;
  const productsBefore = JSON.stringify(h.board.products);
  // Preserve a pre-existing inert attribute exactly, including its value.
  empty.setAttribute("inert", "retained-owner");
  trigger.click();
  assert.equal(document.activeElement, h.tabs[0]); assert.equal(app.inert, true);
  nodes.get("categorySettings").focus();
  let parentFocusReturns = 0;
  trigger.addEventListener("focusin", () => { parentFocusReturns++; });
  nodes.get("categorySettings").click();
  assert.equal(workspace.classList.contains("hidden"), true); assert.equal(category.classList.contains("hidden"), false);
  assert.equal(document.activeElement, nodes.get("settingsBoardTitle"));
  assert.equal(parentFocusReturns, 0, "parent handoff never steals focus back to the toolbar");
  assert.equal(app.inert, true); assert.equal(empty.getAttribute("inert"), "retained-owner");
  nodes.get("settingsRoadmapLabel").focus();
  const hidden = h.add("hidden-action", "button", category); hidden.hidden = true;
  const disabled = h.add("disabled-action", "button", category); disabled.disabled = true;
  const negative = h.add("negative-action", "button", category); negative.tabIndex = -1;
  const invisible = h.add("invisible-action", "button", category); invisible.visibility = "hidden";
  const event = h.key("Tab");
  assert.equal(event.defaultPrevented, true); assert.equal(document.activeElement, nodes.get("closeCategorySettings"), "Tab wraps around hidden, disabled and non-tabbable controls");
  h.key("Tab", true); assert.equal(document.activeElement, nodes.get("settingsRoadmapLabel"), "Shift+Tab wraps to the final available control");
  document.activeElement = document.body; document.body.dispatchEvent({ type: "focusin" });
  assert.equal(document.activeElement, nodes.get("settingsRoadmapLabel"), "stray focus is recovered inside the active modal");
  nodes.get("settingsRoadmapLabel").disabled = true; h.flush();
  assert.equal(document.activeElement, nodes.get("settingsBoardTitle"), "a newly disabled focused control recovers to the initial field");
  nodes.get("settingsBoardTitle").remove(); h.flush();
  assert.equal(document.activeElement, nodes.get("closeCategorySettings"), "removing a focused field recovers focus without requiring a keystroke");
  nodes.get("cancelCategorySettings").click();
  assert.equal(category.classList.contains("hidden"), true); assert.equal(document.activeElement, trigger);
  assert.equal(app.inert, false); assert.equal(empty.getAttribute("inert"), "retained-owner");
  assert.equal(h.calls.save, 0); assert.equal(JSON.stringify(h.board.products), productsBefore, "opening, keyboard traversal and Cancel produce zero product edits");
  checks += 18;
}

{
  const h = fixture(), { context, document, category, nodes, app } = h;
  const productsBefore = JSON.stringify(h.board.products);
  h.trigger.click(); nodes.get("categorySettings").click();
  const confirmation = context.PortfolioDialogs.confirm("Keep the category draft?", { title: "Fixture confirmation" });
  assert.equal(document.activeElement, nodes.get("appMessageCancel")); assert.equal(category.inert, true);
  assert.equal(context.PortfolioWorkspaceUI.closeCategorySettings(), null, "an underlying dialog cannot close and corrupt message inert snapshots");
  h.key("Escape"); assert.equal(await confirmation, false);
  assert.equal(category.classList.contains("hidden"), false); assert.equal(category.inert, false);
  assert.equal(document.activeElement, nodes.get("settingsBoardTitle")); assert.equal(app.inert, true);
  assert.equal(h.calls.globalEscape, 0, "Escape dismisses the topmost message only");
  const notice = context.PortfolioDialogs.alert("Fixture notice");
  h.key("Tab"); assert.equal(document.activeElement, nodes.get("appMessageText"), "notice controls keep their own focus cycle");
  nodes.get("appMessageAccept").click(); await notice; h.flush();
  assert.equal(document.activeElement, nodes.get("settingsBoardTitle")); assert.equal(category.inert, false);
  h.key("Escape");
  assert.equal(category.classList.contains("hidden"), true); assert.equal(app.inert, false);
  assert.equal(document.activeElement, h.trigger); assert.equal(h.calls.globalEscape, 0);
  assert.equal(JSON.stringify(h.board.products), productsBefore); assert.equal(h.calls.save, 0);
  checks += 17;
}

{
  const h = fixture();
  const { context, document, nodes, category } = h;
  const productsBefore = JSON.stringify(h.board.products);
  const lanesBefore = JSON.stringify(h.board.lanes);
  h.trigger.click(); nodes.get("categorySettings").click();
  nodes.get("settingsCategoryName").value = "   "; nodes.get("saveCategorySettings").focus();
  h.categoryForm.dispatchEvent({ type: "submit" });
  assert.equal(document.activeElement, nodes.get("settingsCategoryName"));
  assert.equal(nodes.get("settingsCategoryName").validationReported, true);
  assert.equal(category.classList.contains("hidden"), false); assert.equal(h.calls.save, 0);
  nodes.get("cancelCategorySettings").click(); context.openCategorySettings();
  assert.equal(nodes.get("settingsCategoryName").validityMessage, "", "reopening a cancelled invalid draft clears stale custom validity");
  nodes.get("settingsCategoryName").value = "Headsets updated";
  nodes.get("settingsCategoryName").dispatchEvent({ type: "input" });
  assert.equal(nodes.get("settingsCategoryName").validityMessage, "");
  h.categoryForm.dispatchEvent({ type: "submit" });
  assert.equal(h.categoryData.name, "Headsets updated"); assert.equal(h.calls.save, 1);
  assert.equal(document.activeElement, h.trigger); assert.equal(category.classList.contains("hidden"), true);
  assert.equal(JSON.stringify(h.board.products), productsBefore, "a title-only Save preserves exact product lane and order values");
  assert.notEqual(JSON.stringify(h.board.lanes), lanesBefore, "the actual existing Save normalizes lane display order");
  context.openCategorySettings();
  nodes.get("closeCategorySettings").click(); assert.equal(document.activeElement, h.trigger);
  h.trigger.click(); h.key("Escape"); assert.equal(h.workspace.classList.contains("hidden"), true); assert.equal(h.trigger.getAttribute("aria-expanded"), "false");
  checks += 13;
}

{
  const h = fixture();
  h.trigger.click();
  // A hidden or disabled original trigger falls back to a visible owner.
  h.context.PortfolioWorkspaceUI.closeSettings();
  const alternate = h.add("alternate-trigger", "button", h.app); alternate.focus();
  h.context.openCategorySettings(); alternate.hidden = true;
  h.context.closeCategorySettings(); assert.equal(h.document.activeElement, h.trigger);
  h.document.activeElement = h.document.body;
  h.context.openCategorySettings(); h.context.closeCategorySettings();
  assert.equal(h.document.activeElement, h.trigger, "programmatic opens restore to a usable control rather than the body");
  h.app.inert = true;
  h.context.PortfolioWorkspaceUI.openCategorySettings({ initialFocus: h.nodes.get("settingsBoardTitle") });
  h.context.closeCategorySettings(); assert.equal(h.app.inert, true, "closing preserves a prior inert owner rather than blindly clearing it");
  checks += 3;
}

assert.ok(html.indexOf('src="js/app-dialogs.js"') < html.indexOf('src="js/workspace-ui.js"'), "message ownership registers before settings capture listeners");
console.log(`Settings modal checks passed: ${checks} actual controller and app-integration assertions covering handoff, focus traps/recovery, disabled/hidden/removed controls, nested confirmation/notice, Escape ownership, validation, Save/Cancel/Close, exact inert restoration and unchanged product placements.`);
