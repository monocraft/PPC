import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderVersionedIndex } from "../configure-site-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicRoot = path.join(root, "public");
const read = file => readFile(path.join(root, file), "utf8");
const html = await read("public/analytics.html");
const index = await read("public/index.html");
const hubSource = await read("public/js/analytics-workspace.js");
const blueprintHtml = await read("public/blueprint/index.html");
const workflow = await read(".github/workflows/deploy.yml");
const versionSource = await read("scripts/configure-site-version.mjs");

function attributes(tag) {
  return new Map([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/g)]
    .map(match => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]));
}
const tagById = (source, id) => [...source.matchAll(/<[a-z][^>]*>/gi)]
  .map(match => ({ tag: match[0], attrs: attributes(match[0]) })).find(item => item.attrs.get("id") === id);

// There is one destination in PPC. Module choices belong to the analysis workspace.
const analyticsLinks = [...index.matchAll(/<a\b[^>]*>/gi)].map(match => attributes(match[0]))
  .filter(attrs => attrs.get("href") === "analytics.html");
assert.ok(analyticsLinks.length > 0, "PPC retains its Analytics destination.");
for (const link of analyticsLinks) {
  assert.equal(link.get("target"), "_blank", "Opening analysis preserves the user's current editor.");
  assert.ok(link.get("rel")?.split(/\s+/).includes("noopener"));
}
const mainHeader = index.match(/<header\b[\s\S]*?<\/header>/i)?.[0] || "";
assert.ok(!/\b(?:href|data-view)\s*=\s*["'][^"']*blueprint/i.test(mainHeader), "Blueprint adds no independent main-toolbar destination.");

for (const [id, module, panel] of [["analysis-retail-tab", "retail", "selloutApp"], ["analysis-blueprint-tab", "blueprint", "blueprintPane"]]) {
  const tab = tagById(html, id)?.attrs;
  assert.ok(tab, `Missing module tab ${id}.`);
  assert.equal(tab.get("role"), "tab");
  assert.equal(tab.get("data-analysis-module"), module);
  assert.equal(tab.get("aria-controls"), panel);
  assert.equal(tagById(html, panel)?.attrs.get("role"), "tabpanel");
}
const frame = tagById(html, "blueprintFrame")?.attrs;
assert.ok(frame, "Portfolio plan has one retained frame.");
assert.equal(frame.get("data-src"), "blueprint/index.html?embedded=1");
assert.ok(!frame.has("src") || ["", "about:blank"].includes(frame.get("src")), "Blueprint loads only when requested.");
assert.ok(frame.get("title"), "The embedded analysis has an accessible title.");
assert.ok(tagById(html, "blueprintViews"), "Blueprint views remain contextual within Analytics.");

// Retail remains the same independent workspace, with its current encryption controls.
for (const id of ["workbookFile", "importDialog", "applyImport", "sourceDialog", "privateDialog", "privateKey", "timelineTrack", "timelinePlay", "categoryFilter", "detailTable"]) {
  assert.ok(tagById(html, id), `Retail retains ${id}.`);
}
const retailSource = await read("public/js/sellout-dashboard.js");
assert.ok(retailSource.includes('"ppc-retail-analytics-v1"'), "Existing saved Retail work retains its database identity.");
const publisherSource = await read("public/js/sellout-ppc.js");
assert.ok(publisherSource.includes('new URL("analytics.html"'), "PPC pricing links continue to target the existing Analytics route.");

// Follow every local script and stylesheet through both entry pages; reject data payloads.
const closure = new Set(["analytics.html", "blueprint/index.html"]);
function localReference(reference, owner) {
  const value = reference.replace(/&amp;/g, "&").split(/[?#]/, 1)[0];
  if (value.startsWith("data:")) return null;
  assert.ok(value && !/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(value), `Analysis assets must be local: ${reference}`);
  const absolute = path.resolve(publicRoot, path.dirname(owner), decodeURIComponent(value));
  assert.ok(absolute.startsWith(publicRoot + path.sep), `Asset escapes the published tree: ${reference}`);
  assert.ok(!/\.(?:xlsx?|xlsm|csv|tsv|jsonl?|data|pkg)$/i.test(absolute), `Private source cannot be an analysis asset: ${reference}`);
  return path.relative(publicRoot, absolute).split(path.sep).join("/");
}
function addReferences(source, owner) {
  if (owner.endsWith(".html")) {
    for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      const attrs = attributes(match[0].slice(0, match[0].indexOf(">") + 1));
      assert.ok(!match[1].trim(), "Public analysis pages do not embed executable or private source payloads.");
      if (attrs.has("src")) closure.add(localReference(attrs.get("src"), owner));
    }
    for (const match of source.matchAll(/<link\b[^>]*>/gi)) {
      const attrs = attributes(match[0]);
      if (attrs.has("href")) closure.add(localReference(attrs.get("href"), owner));
    }
  } else if (owner.endsWith(".css")) {
    for (const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) closure.add(localReference(match[1] ?? match[2] ?? match[3], owner));
  }
  closure.delete(null);
}
for (const file of closure) {
  const absolute = path.join(publicRoot, file);
  assert.ok((await stat(absolute)).isFile(), `Missing analysis asset: ${file}`);
  if (/\.(?:html|css)$/.test(file)) addReferences(await readFile(absolute, "utf8"), file);
}
for (const asset of ["css/analytics-workspace.css", "js/analytics-workspace.js"]) assert.ok(closure.has(asset), `Shared workspace loads ${asset}.`);
assert.ok(![...closure].some(file => /(?:^|\/)data\.js$/i.test(file)), "The populated HX snapshot is excluded from published assets.");

const staged = new Set();
for (const line of workflow.split(/\r?\n/).map(value => value.trim()).filter(value => value.startsWith("cp "))) {
  const tokens = line.match(/"[^"]*"|'[^']*'|\S+/g).map(token => token.replace(/^['"]|['"]$/g, ""));
  if (!tokens.at(-1).startsWith("_site")) continue;
  for (const token of tokens.slice(1, -1).filter(value => !value.startsWith("-"))) staged.add(token.replace(/\/$/, ""));
}
for (const file of closure) assert.ok([...staged].some(entry => `public/${file}` === entry || `public/${file}`.startsWith(entry + "/")), `Deployment omits ${file}.`);
assert.ok(versionSource.includes('"blueprint/index.html"'), "The nested Blueprint page participates in deployment versioning.");
for (const [source, owner] of [[html, "analytics.html"], [blueprintHtml, "blueprint/index.html"]]) {
  const versioned = renderVersionedIndex(source, "workspace-check");
  assert.equal(renderVersionedIndex(versioned, "workspace-check"), versioned, `${owner} versioning remains idempotent.`);
  for (const match of versioned.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const ref = attrs.get("src") ?? (attrs.get("rel")?.split(/\s+/).includes("stylesheet") ? attrs.get("href") : null);
    if (ref) assert.equal(new URL(ref.replace(/&amp;/g, "&"), "https://example.test/").searchParams.get("v"), "workspace-check");
  }
}

const blueprintFiles = [];
async function scanBlueprint(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await scanBlueprint(full);
    else blueprintFiles.push(full);
  }
}
await scanBlueprint(path.join(publicRoot, "blueprint"));
for (const file of blueprintFiles) {
  assert.ok(!/\.(?:xlsx?|xlsm|csv|tsv|jsonl?|data|pkg)$/i.test(file), `Raw Blueprint source remains private: ${path.basename(file)}`);
  assert.notEqual(path.basename(file).toLowerCase(), "data.js");
  if (!/\.(?:html|js|css)$/.test(file)) continue;
  const source = await readFile(file, "utf8");
  assert.ok(!/\bHX_DATA\s*=\s*\{\s*["'](?:source|sheets|products)["']/.test(source), `${path.basename(file)} must not bundle a populated source.`);
  assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\bsendBeacon\s*\(/.test(source), `${path.basename(file)} must not send private workbook data over the network.`);
  assert.ok(!/product-portfolio-canvas-v\d|product-portfolio-image-assets-v\d|ppc-retail-analytics-v1/.test(source), `${path.basename(file)} must not open another module's saved database.`);
}
for (const file of [path.join(publicRoot, "js/analytics-workspace.js"), ...blueprintFiles.filter(file => file.endsWith(".js"))]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || `Invalid JavaScript: ${file}`);
}

// The actual workspace controller's isolated behavior fixtures follow below.
function workspaceFixture(url = "https://example.test/PPC/analytics.html") {
  function element(dataset = {}) {
    const attrs = new Map(), listeners = new Map();
    return {
      dataset, attrs, listeners, hidden: false, style: {}, textContent: "", title: "", tabIndex: 0,
      setAttribute(name, value) { attrs.set(name, String(value)); },
      removeAttribute(name) { attrs.delete(name); },
      getAttribute(name) { return attrs.get(name) ?? null; },
      addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
      emit(name, event = {}) { for (const callback of listeners.get(name) || []) callback(event); },
      focus() { this.focused = true; },
    };
  }
  const retail = element(), blueprint = element(), frame = element({ src: "blueprint/index.html?embedded=1" });
  const loading = element(), source = element(), importButton = element();
  const tabs = [element({ analysisModule: "retail" }), element({ analysisModule: "blueprint" })];
  const views = ["overview", "performance", "products", "investment", "scenarios", "source"].map(view => element({ blueprintView: view }));
  const posts = [], lifecycle = [], history = [], listeners = new Map();
  let loads = 0;
  frame.contentWindow = { postMessage(message, origin) { posts.push({ message: structuredClone(message), origin }); } };
  Object.defineProperty(frame, "src", { get() { return frame.attrs.get("src") || ""; }, set(value) { loads++; frame.attrs.set("src", String(value)); } });
  const nodes = new Map([["selloutApp", retail], ["blueprintPane", blueprint], ["blueprintFrame", frame], ["blueprintLoading", loading], ["blueprintSource", source], ["blueprintImport", importButton]]);
  const document = {
    getElementById: id => nodes.get(id), currentScript: { src: "https://example.test/PPC/js/analytics-workspace.js?v=fixture-release" },
    querySelectorAll: selector => selector === "[data-analysis-module]" ? tabs : selector === "[data-blueprint-view]" ? views : [],
  };
  const window = {
    location: new URL(url),
    PPCSelloutDashboard: { setActive(active) { lifecycle.push(active); } },
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
    history: {
      pushState(_state, _title, target) { window.location = new URL(target, window.location); history.push({ mode: "push", url: window.location.href }); },
      replaceState(_state, _title, target) { window.location = new URL(target, window.location); history.push({ mode: "replace", url: window.location.href }); },
    },
  };
  vm.runInNewContext(hubSource, { document, globalThis: window, URL, URLSearchParams, console }, { filename: "analytics-workspace.js" });
  return { window, retail, blueprint, frame, loading, source, importButton, tabs, views, posts, lifecycle, history, get loads() { return loads; },
    emit(name, event) { for (const callback of listeners.get(name) || []) callback(event); },
    message(data, { origin = window.location.origin, sender = frame.contentWindow } = {}) { this.emit("message", { origin, source: sender, data }); },
  };
}
const workspace = workspaceFixture();
assert.equal(workspace.window.PPCAnalyticsWorkspace.currentModule, "retail");
assert.equal(workspace.loads, 0, "Starting Retail does not instantiate another source workspace.");
assert.equal(workspace.retail.hidden, false); assert.equal(workspace.blueprint.hidden, true);
assert.deepEqual(workspace.lifecycle, [true]);
workspace.tabs[1].emit("click");
assert.equal(workspace.window.PPCAnalyticsWorkspace.currentModule, "blueprint");
assert.equal(workspace.retail.hidden, true); assert.equal(workspace.blueprint.hidden, false);
assert.equal(workspace.tabs[1].getAttribute("aria-selected"), "true");
assert.equal(workspace.tabs[0].tabIndex, -1);
assert.equal(workspace.lifecycle.at(-1), false, "Deactivation reaches Retail's lifecycle hook so playback can stop.");
assert.equal(workspace.loads, 1);
const retainedFrameSource = workspace.frame.src;
assert.equal(new URL(retainedFrameSource).origin, workspace.window.location.origin);
assert.equal(new URL(retainedFrameSource).searchParams.get("v"), "fixture-release", "The lazy page follows the shell release version.");
workspace.frame.emit("load");
workspace.views.find(view => view.dataset.blueprintView === "scenarios").emit("click");
assert.equal(workspace.window.location.hash, "#blueprint/scenarios");
assert.equal(workspace.posts.at(-1).message.view, "scenarios");
assert.equal(workspace.views.find(view => view.dataset.blueprintView === "scenarios").getAttribute("aria-current"), "page");
workspace.message({ type: "ppc:blueprint:state", state: { view: "scenarios", year: 2023, category: "Headsets", revenue: -1.5, margin: 0, spend: 0, rows: [{ secret: "EXCLUDED SOURCE FIXTURE" }], privateKey: "EXCLUDED KEY FIXTURE" }, sourceLabel: "Synthetic source" });
assert.equal(workspace.window.location.searchParams.get("year"), "2023");
assert.equal(workspace.window.location.searchParams.get("category"), "Headsets");
assert.equal(workspace.window.location.searchParams.get("revenue"), "-1.5");
assert.equal(workspace.window.location.searchParams.get("margin"), "0");
assert.equal(workspace.source.textContent, "Synthetic source");
assert.ok(!workspace.window.location.href.includes("EXCLUDED"), "Routes exclude source rows and credentials even if a message includes them.");
workspace.tabs[0].emit("click");
assert.equal(workspace.posts.at(-1).message.type, "ppc:blueprint:suspend", "Hiding Portfolio plan stops its playback through the suspend command.");
workspace.tabs[1].emit("click");
assert.equal(workspace.loads, 1, "Switching modules retains the same imported frame.");
assert.equal(workspace.frame.src, retainedFrameSource);
assert.equal(workspace.posts.at(-1).message.view, "scenarios");
assert.equal(workspace.window.location.searchParams.get("revenue"), "-1.5", "Module changes preserve scenario assumptions.");
workspace.importButton.emit("click");
assert.equal(workspace.posts.at(-1).message.type, "ppc:blueprint:import");
assert.ok(workspace.posts.every(post => post.origin === workspace.window.location.origin), "Commands always name the expected origin; wildcard delivery is forbidden.");
assert.ok(workspace.posts.every(post => Object.keys(post.message).every(key => ["type", "view"].includes(key))), "Parent commands contain no source payload or pricing capability.");

const validMaliciousState = { type: "ppc:blueprint:state", state: { view: "investment", year: 2029, category: "Other", revenue: 30, margin: 10, spend: 30 }, sourceLabel: "Spoofed source" };
const trustedState = { url: workspace.window.location.href, source: workspace.source.textContent, height: workspace.frame.style.height };
for (const identity of [{ origin: "https://other.test" }, { sender: {} }]) {
  workspace.message(validMaliciousState, identity);
  workspace.message({ type: "ppc:blueprint:height", height: 12345 }, identity);
}
for (const data of [null, "unrelated", { type: "unknown", ...validMaliciousState, state: { view: "unknown" } }, { type: "ppc:blueprint:state", state: { view: "javascript:malicious" }, sourceLabel: "Spoofed source" }]) workspace.message(data);
assert.deepEqual({ url: workspace.window.location.href, source: workspace.source.textContent, height: workspace.frame.style.height }, trustedState, "Wrong windows, foreign origins and unsupported views cannot change analysis state.");
workspace.message({ type: "ppc:blueprint:state", state: { view: "scenarios", year: "invalid", category: "x".repeat(81), revenue: Infinity, margin: 11, spend: -31 } });
assert.equal(workspace.window.location.searchParams.get("year"), "2023");
assert.equal(workspace.window.location.searchParams.get("category"), "Headsets");
assert.equal(workspace.window.location.searchParams.get("revenue"), "-1.5");
assert.equal(workspace.window.location.searchParams.get("margin"), "0");
for (const height of [NaN, Infinity, -1, 0, 99, 50001, "400"]) workspace.message({ type: "ppc:blueprint:height", height });
assert.equal(workspace.frame.style.height, trustedState.height, "Invalid frame sizes are rejected.");
workspace.message({ type: "ppc:blueprint:height", height: 1000.3 });
assert.equal(workspace.frame.style.height, "1001px");
const historyBeforeInvalid = workspace.history.length, postsBeforeInvalid = workspace.posts.length;
workspace.window.PPCAnalyticsWorkspace.switchModule("unknown"); workspace.window.PPCAnalyticsWorkspace.showBlueprintView("unknown");
assert.equal(workspace.history.length, historyBeforeInvalid); assert.equal(workspace.posts.length, postsBeforeInvalid);
let prevented = false;
workspace.tabs[1].emit("keydown", { key: "ArrowRight", preventDefault() { prevented = true; } });
assert.ok(prevented && workspace.tabs[0].focused, "Native tab keyboard navigation transfers focus.");
assert.equal(workspace.window.PPCAnalyticsWorkspace.currentModule, "retail");

const deepLink = workspaceFixture("https://example.test/PPC/analytics.html?analysis=blueprint&year=2028&category=Mice&revenue=99&margin=-99&spend=12#blueprint/performance");
assert.equal(deepLink.window.PPCAnalyticsWorkspace.currentModule, "blueprint");
const deepSource = new URL(deepLink.frame.src);
assert.equal(deepSource.hash, "#performance"); assert.equal(deepSource.searchParams.get("year"), "2028");
assert.equal(deepSource.searchParams.get("revenue"), "30"); assert.equal(deepSource.searchParams.get("margin"), "-10");
assert.equal(deepSource.searchParams.get("spend"), "12");
deepLink.window.location = new URL("https://example.test/PPC/analytics.html?analysis=retail"); deepLink.emit("popstate");
assert.equal(deepLink.window.PPCAnalyticsWorkspace.currentModule, "retail", "Browser history activates the intended module without rebuilding its frame.");
assert.equal(deepLink.loads, 1);
const capability = "a".repeat(64), pricingLink = workspaceFixture(`https://example.test/PPC/analytics.html#ppc-link=${capability}`);
assert.equal(pricingLink.window.location.hash, `#ppc-link=${capability}`, "The existing pricing bridge consumes its own temporary capability.");
pricingLink.tabs[1].emit("click");
assert.ok(!pricingLink.frame.src.includes(capability), "Portfolio plan never receives the Retail pricing capability.");

// Exercise the actual source store against an isolated IndexedDB fixture. These
// records are synthetic and never enter a live browser or the published tree.
const storedRecords = new Map(), openedDatabases = [];
let sourceWrites = 0;
const fakeDatabase = {
  createObjectStore() {}, close() {},
  transaction(store, mode) {
    assert.equal(store, "source");
    const transaction = {
      objectStore() {
        return {
          get(key) {
            const request = {};
            queueMicrotask(() => { request.result = structuredClone(storedRecords.get(key)); transaction.oncomplete?.(); });
            return request;
          },
          put(value, key) {
            assert.equal(mode, "readwrite"); sourceWrites++;
            const request = {};
            queueMicrotask(() => { storedRecords.set(key, structuredClone(value)); request.result = key; transaction.oncomplete?.(); });
            return request;
          },
        };
      },
    };
    return transaction;
  },
};
const sourceWindow = {
  indexedDB: {
    open(name, version) {
      openedDatabases.push({ name, version });
      const request = {};
      queueMicrotask(() => { request.result = fakeDatabase; request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
  },
};
vm.runInNewContext(await read("public/blueprint/source-store.js"), { window: sourceWindow, console }, { filename: "blueprint/source-store.js" });
assert.equal((await sourceWindow.HX_SOURCE_READY).snapshot, null, "An empty source database starts without invented data.");
const syntheticSource = {
  source: { name: "Synthetic Blueprint fixture.xlsm" }, sheets: [], categories: ["Audio"], periods: [2026], investments: [],
  products: [{ name: "Synthetic item", category: "Audio", revenueByYear: { 2026: 0 }, gmByYear: { 2026: null }, unitsByYear: { 2026: -2 } }],
};
const syntheticBefore = JSON.stringify(syntheticSource);
await sourceWindow.HX_SOURCE_STORE.save(syntheticSource);
assert.equal(JSON.stringify(await sourceWindow.HX_SOURCE_STORE.restore()), syntheticBefore, "Stored source preserves zero, missing and signed figures.");
assert.equal(JSON.stringify(syntheticSource), syntheticBefore, "Saving leaves source facts unchanged.");
for (const bad of [null, {}, { ...syntheticSource, products: [] }, { ...syntheticSource, periods: [9999] }, { ...syntheticSource, products: [{ revenueByYear: {} }] }]) {
  await assert.rejects(sourceWindow.HX_SOURCE_STORE.save(bad), /supported|incomplete/);
}
assert.equal(sourceWrites, 1, "Rejected imports never replace an existing source.");
assert.equal(JSON.stringify(await sourceWindow.HX_SOURCE_STORE.restore()), syntheticBefore);
assert.deepEqual(openedDatabases, [{ name: "ppc-blueprint-analytics-v1", version: 1 }], "Blueprint opens only its own independent source database.");

console.log(`Analytics workspace checks passed: ${closure.size} local assets, single PPC destination, retained module routing, trusted messages, scenario preservation, playback lifecycle and isolated source storage.`);
