import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const [html, app, ui] = await Promise.all([
  readFile(new URL("public/index.html", root), "utf8"),
  readFile(new URL("public/js/app.js", root), "utf8"),
  readFile(new URL("public/js/workspace-ui.js", root), "utf8"),
]);
const criticalStyles = [...html.matchAll(/<style\b[^>]*>([^]*?)<\/style>/gi)].map(([, source]) => source).join("\n");
const criticalRules = [...criticalStyles.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map(([, selector, declarations]) => ({ selector: selector.trim(), declarations: Object.fromEntries(declarations.split(";").filter(value => value.trim()).map(value => value.trim().split(/\s*:\s*/, 2))) }));
const clone = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const fixture = (products = []) => ({ version: 4, activeCategoryId: "synthetic", settings: { roadmapBasis: "lifecycle" }, imageAssets: [], categories: [{ id: "synthetic", name: "Synthetic", board: { title: "Synthetic portfolio", lanes: [{ id: "fixture-lane", label: "Products" }], products } }] });

// These checks run the real startup and workspace UI sources. The small DOM
// boundary implements attributes, classes, ancestry and events from the shipped
// HTML; it does not reimplement startup, empty-state or recovery decisions.
function documentFixture() {
  const elements = [], stack = [];
  const eventTarget = object => {
    const listeners = new Map();
    object.addEventListener = (name, listener, options = {}) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push({ listener, once: Boolean(options?.once) }); };
    object.dispatchEvent = event => { for (const entry of [...listeners.get(event.type) || []]) { if (entry.once) listeners.set(event.type, listeners.get(event.type).filter(value => value !== entry)); entry.listener(event); } return true; };
    return object;
  };
  function matches(element, selector) {
    if (selector.includes(",")) return selector.split(",").some(part => matches(element, part.trim()));
    const attributes = [...selector.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
    for (const [, name, value] of attributes) if (!element.hasAttribute(name) || value !== undefined && element.getAttribute(name) !== value) return false;
    const simple = selector.replace(/\[[^\]]+\]/g, "");
    const tag = simple.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && tag !== element.tagName) return false;
    const id = simple.match(/#([\w-]+)/)?.[1];
    if (id && id !== element.id) return false;
    return [...simple.matchAll(/\.([\w-]+)/g)].every(([, name]) => element.classList.contains(name));
  }
  for (const token of html.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>/gi)) {
    const tag = token[1].toLowerCase();
    if (token[0].startsWith("</")) {
      const index = stack.findLastIndex(element => element.tagName === tag);
      if (index >= 0) stack.length = index;
      continue;
    }
    const attributes = new Map([...token[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(([, name, quoted, single, bare]) => [name, quoted ?? single ?? bare ?? ""]));
    const element = eventTarget({ tagName: tag, parentElement: stack.at(-1) || null, children: [], textContent: "", value: attributes.get("value") || "", disabled: attributes.has("disabled"), checked: attributes.has("checked"), isConnected: true, tabIndex: 0 });
    element.getAttribute = name => attributes.has(name) ? attributes.get(name) : null;
    element.hasAttribute = name => attributes.has(name);
    element.setAttribute = (name, value) => attributes.set(name, String(value));
    element.removeAttribute = name => attributes.delete(name);
    Object.defineProperties(element, {
      id: { get: () => attributes.get("id") || "" },
      hidden: { get: () => attributes.has("hidden"), set: value => value ? attributes.set("hidden", "") : attributes.delete("hidden") },
      inert: { get: () => attributes.has("inert"), set: value => value ? attributes.set("inert", "") : attributes.delete("inert") },
    });
    const classes = () => new Set((attributes.get("class") || "").split(/\s+/).filter(Boolean));
    element.classList = {
      contains: name => classes().has(name),
      add(...names) { const values = classes(); names.forEach(name => values.add(name)); attributes.set("class", [...values].join(" ")); },
      remove(...names) { const values = classes(); names.forEach(name => values.delete(name)); attributes.set("class", [...values].join(" ")); },
      toggle(name, force) { const include = force ?? !this.contains(name); include ? this.add(name) : this.remove(name); return include; },
    };
    element.dataset = Object.fromEntries([...attributes].filter(([name]) => name.startsWith("data-")).map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
    element.matches = selector => matches(element, selector);
    element.closest = selector => { for (let current = element; current; current = current.parentElement) if (matches(current, selector)) return current; return null; };
    element.contains = candidate => { for (let current = candidate; current; current = current.parentElement) if (current === element) return true; return false; };
    element.querySelectorAll = selector => elements.filter(candidate => candidate !== element && element.contains(candidate) && matches(candidate, selector));
    element.querySelector = selector => element.querySelectorAll(selector)[0] || null;
    element.getClientRects = () => visible(element) ? [{}] : [];
    element.focus = () => { document.activeElement = element; };
    element.parentElement?.children.push(element);
    elements.push(element);
    if (!["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(tag)) stack.push(element);
  }
  const document = eventTarget({
    getElementById: id => elements.find(element => element.id === id) || null,
    querySelectorAll: selector => elements.filter(element => matches(element, selector)),
    querySelector: selector => elements.find(element => matches(element, selector)) || null,
  });
  document.body = document.querySelector("body");
  document.activeElement = document.body;
  // Evaluate the shipped critical inline rules on the parsed elements. Inert
  // deliberately does not count as visual concealment, and opacity retains the
  // layout box used by the production canvas fitting code.
  function visible(element) {
    if (element.closest("[hidden], .hidden")) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = Object.assign({}, ...criticalRules.filter(rule => matches(current, rule.selector)).map(rule => rule.declarations));
      if (style.opacity === "0" || style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  }
  return { document, visible, window: eventTarget({}) };
}

function actualFunction(name) {
  const match = app.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, `the application defines ${name}`);
  return match[0];
}
const uiReadyBinding = app.match(/^window\.addEventListener\("portfolio:ui-ready",[^]*?^\}\);/m);
assert.ok(uiReadyBinding, "the app handles the workspace UI registration event");
const actualStartup = ["loadPortfolio", "initializeWorkspace", "startWorkspace", "showWorkspaceRecovery", "publishWorkspaceState"].map(actualFunction).join("\n") + "\n" + uiReadyBinding[0];

function harness({ saved = null, recoveryFails = false, activationFails = false } = {}) {
  const dom = documentFixture(), fonts = deferred(), storage = deferred(), writes = [], events = [];
  const context = {
    ...dom, console, JSON, Object, Array, String, Set, Map, Error, queueMicrotask,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } },
    MutationObserver: class { observe() {} disconnect() {} },
    workspaceOpening: true, workspaceRecovery: null, workspaceRecoveryPlan: null, workspaceRecoveryExportText: null,
    pendingLegacyImageBlobs: [], UI_FONT_FACE: "", portfolio: null, board: null, activeCategoryId: null, activeView: "products", roadmapDetailsOpen: false,
    STORAGE_KEY: "synthetic", PREVIOUS_STORAGE_KEY: "synthetic-previous", LEGACY_STORAGE_KEY: "synthetic-legacy",
    localStorage: { getItem: () => null },
    workspaceStorage: {
      read: () => storage.promise,
      save: async serialized => writes.push(serialized),
      readRecovery: async () => { if (recoveryFails) throw new Error("Synthetic recovery storage failure"); return { record: { id: "synthetic", serialized: saved }, rawText: saved }; },
    },
    PortfolioTheme: { fontsReady: () => fonts.promise, fontFace: "Synthetic font" },
    PortfolioNotifications: { resolve() {}, publish() {} },
    createDefaultPortfolio: () => fixture(), ensurePortfolioSchema: clone,
    resetHashoutView() {}, syncControls() {}, renderInspector() {},
    initializeWorkspaceFeatures() { if (activationFails) throw new Error("Synthetic feature activation failure"); },
    activateCategory(categoryId) { context.activeCategoryId = categoryId; context.board = context.portfolio.categories.find(category => category.id === categoryId).board; },
    setView(view) { context.activeView = view; context.publishWorkspaceState(); },
    hasDedicatedHashoutView: () => false, selectedProduct: () => null,
    visibleProducts: () => context.board.products, visibleRoadmapProducts: () => context.board.products,
    productPriceText: () => "", productPartSkus: () => [],
  };
  Object.assign(context, dom.window);
  context.window = context;
  context.window.addEventListener("portfolio:workspace-ready", () => events.push("ready"));
  vm.createContext(context);
  vm.runInContext(actualStartup, context, { filename: "app-startup.js" });
  // Match the shipped script order: app begins waiting before workspace-ui loads.
  const start = () => context.startWorkspace();
  const mountUI = () => vm.runInContext(ui, context, { filename: "workspace-ui.js" });
  return { ...dom, context, fonts, storage, writes, events, start, mountUI, saved,
    shell: dom.document.querySelector(".app-shell"), status: dom.document.getElementById("workspaceOpeningStatus") };
}

function concealed(subject, phase) {
  assert.equal(subject.visible(subject.shell), false, `${phase}: internal workspace is visually concealed`);
  assert.equal(subject.shell.inert, true, `${phase}: internal workspace cannot receive input`);
  assert.equal(subject.shell.getAttribute("aria-busy"), "true", `${phase}: workspace announces its pending state`);
  assert.equal(subject.visible(subject.status), true, `${phase}: opening or recovery status remains available`);
}

// Removing the initial HTML gate or releasing it before asynchronous startup
// finishes must fail, even when the application has not executed a single line.
concealed(harness(), "initial HTML before JavaScript");
const criticalPosition = html.search(/<style\b[^>]*id="workspaceBootStyles"/);
const firstExternalAsset = html.search(/<(?:link|script)\b/);
assert.ok(criticalPosition >= 0 && criticalPosition < firstExternalAsset, "the initial concealment CSS arrives before font, stylesheet or script requests");

for (let reload = 1; reload <= 3; reload++) {
  const subject = harness();
  concealed(subject, `empty reload ${reload} initial markup`);
  const ready = subject.start(); subject.mountUI();
  await tick(); concealed(subject, `empty reload ${reload} pending fonts`);
  subject.fonts.resolve(); await tick(); concealed(subject, `empty reload ${reload} unresolved storage`);
  subject.storage.resolve(null); await ready;
  assert.equal(subject.context.workspaceOpening, false);
  assert.equal(subject.visible(subject.shell), true, "empty startup releases its prepared welcome screen");
  assert.equal(subject.shell.inert, false);
  assert.equal(subject.shell.hasAttribute("aria-busy"), false);
  assert.equal(subject.visible(subject.status), false);
  assert.equal(subject.visible(subject.document.getElementById("workspaceEmpty")), true);
  assert.equal(subject.document.getElementById("workspaceEmptyTitle").textContent, "Start your portfolio");
  for (const selector of [".topbar", ".workspace-controls", "#statusbar"]) assert.equal(subject.visible(subject.document.querySelector(selector)), false, `empty welcome conceals ${selector}`);
  assert.deepEqual(subject.events, ["ready"]);
  assert.equal(subject.writes.length, 1, "first empty startup persists only its local fixture");
}

{
  const saved = JSON.stringify(fixture([{ id: "invented-product", name: "Invented headset", laneId: "fixture-lane", order: 0 }]));
  const subject = harness({ saved });
  const ready = subject.start(); subject.mountUI();
  subject.fonts.resolve(); await tick(); concealed(subject, "saved workspace unresolved storage");
  subject.storage.resolve(saved); await ready;
  assert.equal(subject.visible(subject.shell), true);
  assert.equal(subject.shell.inert, false);
  assert.equal(subject.visible(subject.document.querySelector(".topbar")), true, "populated workspace reveals its navigation");
  assert.equal(subject.visible(subject.document.getElementById("workspaceEmpty")), false);
  assert.equal(subject.context.portfolio.categories[0].board.products[0].name, "Invented headset");
  assert.equal(subject.writes.length, 0, "opening a normalized saved fixture does not rewrite it");
  assert.deepEqual(subject.events, ["ready"]);
}

// Storage may finish before a slow workspace-ui script registers. The same
// startup promise must stay gated until the real registration event refreshes
// empty/populated presentation, for either persisted data shape.
for (const products of [[], [{ id: "synthetic-late-ui", name: "Invented mouse", laneId: "fixture-lane", order: 0 }]]) {
  const saved = JSON.stringify(fixture(products));
  const subject = harness({ saved });
  let settled = false;
  const ready = subject.start().then(value => { settled = true; return value; });
  subject.fonts.resolve(); subject.storage.resolve(saved); await tick();
  concealed(subject, `storage ready before UI (${products.length} products)`);
  assert.equal(settled, false, "startup cannot settle before workspace UI prepares the terminal presentation");
  assert.deepEqual(subject.events, []);
  subject.mountUI(); await ready;
  assert.equal(subject.visible(subject.shell), true);
  assert.equal(subject.visible(subject.document.getElementById("workspaceEmpty")), products.length === 0);
  assert.equal(subject.visible(subject.document.querySelector(".topbar")), products.length > 0);
  assert.equal(subject.writes.length, 0);
  assert.deepEqual(subject.events, ["ready"]);
}

for (const scenario of [
  { label: "damaged saved data", saved: "{ synthetic damaged data", recoveryFails: false },
  { label: "failed recovery storage", saved: "{ synthetic damaged data", recoveryFails: true },
  { label: "failed workspace activation", saved: JSON.stringify(fixture()), activationFails: true },
]) {
  const subject = harness(scenario);
  const ready = subject.start(); subject.mountUI();
  subject.fonts.resolve(); subject.storage.resolve(scenario.saved);
  await assert.rejects(ready, /JSON|Synthetic|Expected property|Unexpected token/);
  concealed(subject, scenario.label);
  assert.equal(subject.visible(subject.document.getElementById("workspaceOpeningRetry")), true, "failed startup leaves retry available outside the workspace");
  assert.equal(subject.visible(subject.document.getElementById("workspaceRecoveryControls")), !scenario.recoveryFails);
  assert.equal(subject.context.workspaceOpening, true);
  assert.equal(subject.writes.length, 0, "failed startup never replaces saved data");
  assert.deepEqual(subject.events, []);
}

console.log("Workspace startup checks passed: concealed initial HTML, pending fonts/storage, repeated empty welcome reloads, populated local restore, damaged data, unavailable recovery storage and activation failures; no browser or backend access.");
