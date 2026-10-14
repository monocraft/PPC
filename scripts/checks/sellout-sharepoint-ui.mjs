import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const source = await readFile(new URL("../../public/js/sellout-dashboard.js", import.meta.url), "utf8");
const definition = name => {
  const found = source.match(new RegExp(`^  (?:async )?function ${name}\\([^]*?^  \\}`, "m"))?.[0];
  assert.ok(found, `Missing actual dashboard import function ${name}`); return found;
};
const controllerStart = source.indexOf("  const chooseFile ="), controllerEnd = source.indexOf('  $("openSource").onclick', controllerStart);
assert.ok(controllerStart >= 0 && controllerEnd > controllerStart, "Missing actual native import controller block.");
const runDefinition = source.match(/^  let importRun = 0;/m)?.[0];
assert.ok(runDefinition, "Missing actual last-request import counter.");
const scripts = await Promise.all(["package-codec.js", "ascm-import.js", "sellout-model.js", "sellout-ppc.js", "sellout-private.js", "sellout-sharepoint.js"].map(async filename => [filename, await readFile(new URL(`../../public/js/${filename}`, import.meta.url), "utf8")]));
const importedFunctions = ["workbookMatrices", "importSummary", "readImport", "applySnapshot", "sanitizePrices"].map(definition).join("\n");
const controller = `const root = globalThis; const M = PPCSelloutModel;\n${importedFunctions}\n${runDefinition}\n${source.slice(controllerStart, controllerEnd)}`;

// Native EventTarget supplies actual event.target/default prevention. The
// element adapter supplies only browser properties used by this controller.
class Element extends EventTarget {
  constructor(id) {
    super(); this.id = id; this.type = id.endsWith("File") ? "file" : ""; this.files = []; this.rawValue = "";
    this.open = false; this.hidden = false; this.disabled = false; this.readOnly = false;
    this.textContent = ""; this.innerHTML = ""; this.clicks = 0; this.shown = 0; this.lastPromise = null;
    for (const type of ["click", "change", "input", "submit", "close", "cancel"]) this.addEventListener(type, event => {
      const result = this[`on${type}`]?.call(this, event);
      this.lastPromise = result?.then ? result : null;
    });
  }
  set value(value) { this.rawValue = value; if (!value && this.type === "file") this.files = []; }
  get value() { return this.rawValue; }
  showModal() { this.open = true; this.shown++; }
  close() { this.open = false; this.dispatchEvent(new Event("close")); }
  click() { this.clicks++; return this.event("click"); }
  event(type) { const event = new Event(type, { cancelable: true }); this.dispatchEvent(event); return event; }
  select(file) { this.files = file ? [file] : []; this.rawValue = file ? `fixture/${file.name}` : ""; this.event("change"); return this.lastPromise; }
}

// Node lacks DOMParser. This narrow XML tree adapter handles generated fixture
// parts; the actual dashboard still reads ZIP bytes, cells and worksheets and
// normalizes them through the production ASCM reader and sell-out model.
const xmlEscape = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
const xmlDecode = value => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]);
class XmlNode {
  constructor(name, attributes = {}) { this.name = name; this.attributes = attributes; this.children = []; this.text = ""; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getAttributeNS(_namespace, name) { const key = Object.keys(this.attributes).find(key => key === name || key.endsWith(`:${name}`)); return key ? this.attributes[key] : null; }
  getElementsByTagNameNS(_namespace, name) {
    return this.children.flatMap(child => [...(child.name.split(":").at(-1) === name ? [child] : []), ...child.getElementsByTagNameNS("*", name)]);
  }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  querySelector(name) { return this.getElementsByTagNameNS("*", name)[0] || null; }
}
class FixtureDOMParser {
  parseFromString(text) {
    const document = new XmlNode("#document"), stack = [document];
    for (const token of text.match(/<[^>]*>|[^<]+/g) || []) {
      if (/^<\?/.test(token)) continue;
      if (token.startsWith("</")) { assert.equal(stack.pop().name, token.slice(2, -1), "Generated fixture XML must be balanced."); continue; }
      if (token.startsWith("<")) {
        const name = token.match(/^<([^\s/>]+)/)?.[1]; assert.ok(name, "Generated fixture tag must be valid.");
        const attributes = Object.fromEntries([...token.matchAll(/([^\s=<>]+)="([^"]*)"/g)].map(match => [match[1], xmlDecode(match[2])]));
        const node = new XmlNode(name, attributes); stack.at(-1).children.push(node); if (!token.endsWith("/>")) stack.push(node);
      } else stack.at(-1).text += xmlDecode(token);
    }
    assert.equal(stack.length, 1, "Generated fixture XML must close all elements."); return document;
  }
}

const fixture = (sheet = "Active", current = 7) => ({
  schemaVersion: 1, title: "UI fixture workbook", sheet, periods: [{ date: "2026-01-04", quarter: "FY26Q2" }],
  rows: [{ store: "Fixture retailer", sku: "FIXTURE-SKU", product: "Fixture product", category: "Audio", lifetime: current, values: [current] }], warnings: [],
});
const textFile = (name, text) => ({ name, size: new TextEncoder().encode(text).byteLength, text: async () => text });
const csvFile = (name = "download.csv", units = 0) => textFile(name, `store,sku,product,category,date,units\nFixture retailer,FIXTURE-SKU,Fixture product,Audio,2026-01-04,${units}\n`);
const link = "https://northwind.sharepoint.com/:x:/g/EXAMPLEopaqueToken_123-ABC?e=fixture&CID=fixture-id";
const ownSource = "https://northwind.sharepoint.com/sites/Planning/Original.xlsx";
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const forbidden = () => { throw new Error("UI fixture attempted real network/auth/storage access."); };

async function harness({ ready = true, initialization = null, load = async () => csvFile() } = {}) {
  const elements = new Map(), $ = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const active = fixture(), prices = { "FIXTURE-SKU": { msrp: 0, source: "Active price fixture" } };
  const state = { snapshot: active, prices, shortlist: [], ppcProjection: null, pricingSource: null, stores: ["Fixture retailer"], products: [], storesNone: false, productsNone: false, hiddenSeries: new Set(), pending: null, sheets: [] };
  const messages = [], persistence = [], privateCalls = [], loadCalls = [], createCalls = [], timers = new Map();
  let timerId = 0, initializeCalls = 0;
  const client = {
    ready, initialized: false,
    initialize: async () => { initializeCalls++; if (initialization) await initialization.promise; client.initialized = true; },
    load: (url, options) => { const call = { url, ...options }; loadCalls.push(call); return load(call); },
  };
  const config = ready ? { clientId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222", sharepointHosts: ["northwind.sharepoint.com"] } : null;
  const sandbox = {
    state, $, URL, TextEncoder, TextDecoder, structuredClone, Blob, DecompressionStream, AbortController, crypto: webcrypto, DOMParser: FixtureDOMParser,
    console: { log: forbidden, warn: forbidden, error: forbidden }, fetch: forbidden, XMLHttpRequest: forbidden, msal: Object.freeze({ fixtureBoundary: true }),
    location: { href: "https://fixture.example/PPC/analytics.html", origin: "https://fixture.example" }, PPCSelloutSharePointConfig: config,
    PPCSelloutSharePointClient: { create: options => { createCalls.push(options); return client; } },
    PPCSelloutMotion: { reset() {} }, message: (text, error = false) => messages.push({ text, error }),
    esc: xmlEscape, day: value => value, fmt: value => String(value),
    resolvePpc() {}, stopTimeline() {}, controls() {}, update() {}, refreshPpc: forbidden,
    persist: async () => { persistence.push(structuredClone(state.snapshot)); return true; },
    openPrivate: mode => privateCalls.push(mode), privateFile: null, ppcBridge: null,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
  };
  Object.defineProperties(sandbox, { localStorage: { get: forbidden }, sessionStorage: { get: forbidden }, navigator: { get: forbidden } });
  const context = vm.createContext(sandbox);
  for (const [filename, text] of scripts) vm.runInContext(text, context, { filename });
  vm.runInContext(controller, context, { filename: "actual-dashboard-import-controller.js" });
  await flush();
  const capture = () => JSON.stringify({ snapshot: state.snapshot, prices: state.prices, shortlist: state.shortlist, ppcProjection: state.ppcProjection, pricingSource: state.pricingSource, stores: state.stores, products: state.products });
  const initial = capture();
  const unchanged = () => { assert.equal(state.snapshot, active); assert.equal(capture(), initial, "A failed, cancelled or reviewed import must preserve the current report."); assert.equal(persistence.length, 0); };
  const loadWorkbook = () => $("importButton").click();
  // Exercise the retained SharePoint controller internally; its entry is hidden in the published UI.
  const openLink = () => { $("emptyLinkImport").click(); $("sharepointLink").value = link; };
  const submit = () => { const event = $("sharepointLinkForm").event("submit"); assert.equal(event.defaultPrevented, true); return $("sharepointLinkForm").lastPromise; };
  const workbook = (name, sheets) => {
    const contents = {
      "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
      "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`,
    };
    sheets.forEach((sheet, index) => {
      const rows = sheet.rows || [["store", "sku", "product", "category", "date", "units"], ["Fixture retailer", "FIXTURE-SKU", "Fixture product", "Audio", "2026-01-04", sheet.units ?? 0]];
      contents[`xl/worksheets/sheet${index + 1}.xml`] = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, ri) => `<row r="${ri + 1}">${row.map((value, ci) => `<c r="${String.fromCharCode(65 + ci)}${ri + 1}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
    });
    const bytes = context.PortfolioPackage.createZip(Object.entries(contents).map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })));
    return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  assert.equal(createCalls.length, 1); assert.equal(createCalls[0].config, config);
  return { $, state, active, client, messages, persistence, privateCalls, loadCalls, timers, unchanged, openLink, submit, loadWorkbook, workbook, initializeCalls: () => initializeCalls };
}

// The deployed empty configuration must tell the truth and never invoke auth,
// including programmatic form submits that bypass the disabled native button.
{
  const h = await harness({ ready: false }); h.openLink();
  assert.equal(h.initializeCalls(), 0); assert.equal(h.$("sharepointLoad").disabled, true); assert.equal(h.$("sharepointSetup").hidden, false);
  await h.submit(); assert.equal(h.loadCalls.length, 0); assert.match(h.$("sharepointError").textContent, /connection setup is required/); h.unchanged();
  const clicks = h.$("workbookFile").clicks; h.$("sharepointLocalFile").click();
  assert.equal(h.$("sharepointDialog").open, false); assert.equal(h.$("workbookFile").clicks, clicks + 1);
}
{
  const initialization = deferred(), h = await harness({ initialization }); h.openLink();
  assert.equal(h.initializeCalls(), 1); assert.equal(h.$("sharepointLoad").disabled, true);
  await h.submit(); assert.equal(h.loadCalls.length, 0); assert.match(h.$("sharepointError").textContent, /not ready/); h.unchanged();
  initialization.resolve(); await flush(); assert.equal(h.$("sharepointLoad").disabled, false);
}
{
  const initialization = deferred(), h = await harness({ initialization }); initialization.reject(new Error("Internal fixture initialization detail")); await flush();
  h.openLink(); await h.submit(); assert.equal(h.loadCalls.length, 0); assert.equal(h.$("sharepointLoad").disabled, true);
  assert.match(h.$("sharepointError").textContent, /not ready/); assert.doesNotMatch(h.$("sharepointError").textContent, /Internal fixture/); h.unchanged();
}

// Valid authenticated CSV automatically commits, preserves zero MSRP and units,
// closes the link dialog and skips the ordinary local-file Review/Apply step.
{
  const gate = deferred(), h = await harness({ load: async call => { call.onProgress({ phase: "metadata" }); return gate.promise; } }); h.openLink();
  const run = h.submit(); assert.equal(h.$("sharepointLoad").disabled, true); assert.equal(h.$("sharepointLink").readOnly, true);
  assert.equal(h.$("sharepointProgress").hidden, false); assert.match(h.$("sharepointProgressText").textContent, /Finding your workbook/);
  await h.submit(); assert.equal(h.loadCalls.length, 1, "Busy form submissions cannot create another authentication transaction."); h.unchanged();
  gate.resolve(csvFile()); await run;
  assert.equal(h.state.snapshot.sourceUrl, link); assert.equal(h.state.snapshot.rows[0].values[0], 0); assert.equal(h.state.prices["FIXTURE-SKU"].msrp, 0);
  assert.equal(h.persistence.length, 1); assert.equal(h.persistence[0].sourceUrl, link);
  assert.equal(h.$("sharepointDialog").open, false); assert.equal(h.$("importDialog").shown, 0); assert.equal(h.$("sharepointLink").value, "");
  assert.equal(h.$("sharepointLoad").disabled, false); assert.equal(h.$("sharepointLink").readOnly, false); assert.equal(h.timers.size, 0);
}

// Real stored XLSX ZIPs exercise all worksheet parsing. Unrelated worksheets
// are excluded; one valid table auto-applies, multiple valid tables need choice.
{
  let file; const h = await harness({ load: async () => file });
  file = h.workbook("single.xlsx", [{ name: "Read me", rows: [["Notes"], ["Fixture only"]] }, { name: "Valid & selected", units: -2 }]);
  h.openLink(); await h.submit();
  assert.equal(h.persistence.length, 1); assert.equal(h.state.snapshot.sheet, "Valid & selected"); assert.equal(h.state.snapshot.rows[0].values[0], -2);
  assert.equal(h.$("importDialog").shown, 0); assert.equal(h.state.snapshot.sourceUrl, link);
}
{
  let file; const h = await harness({ load: async () => file });
  file = h.workbook("multiple.xlsx", [{ name: "First", units: 0 }, { name: "Second", units: -3 }]); h.openLink(); await h.submit();
  h.unchanged(); assert.equal(h.state.sheets.length, 2); assert.ok(h.state.sheets.every(sheet => sheet.sourceUrl === link));
  assert.equal(h.$("sharepointDialog").open, false); assert.equal(h.$("importDialog").open, true); assert.equal(h.$("sheetChoiceLabel").hidden, false);
  assert.match(h.$("importReview").innerHTML, /provided source link/);
  h.$("sheetChoice").value = "1"; h.$("sheetChoice").event("change"); h.unchanged();
  assert.equal(h.state.pending.snapshot.sheet, "Second"); assert.equal(h.state.pending.snapshot.sourceUrl, link);
  h.$("applyImport").click(); await h.$("applyImport").lastPromise;
  assert.equal(h.state.snapshot.sheet, "Second"); assert.equal(h.state.snapshot.rows[0].values[0], -3); assert.equal(h.persistence.length, 1);
  assert.equal(h.state.pending, null); assert.equal(h.$("importDialog").open, false);
}

// Download and parser failures preserve the current report and keep the link
// for retry. Detailed workbook errors are replaced with a user-facing message.
{
  let attempt = 0; const h = await harness({ load: async () => { if (++attempt === 1) throw new Error("Microsoft sign-in was cancelled. Try again."); return csvFile("retry.csv", 4); } }); h.openLink(); await h.submit();
  h.unchanged(); assert.equal(h.$("sharepointLink").value, link); assert.equal(h.$("sharepointDialog").open, true);
  assert.equal(h.$("sharepointLoad").disabled, false); assert.equal(h.$("sharepointLink").readOnly, false); assert.match(h.$("sharepointError").textContent, /cancelled/);
  await h.submit(); assert.equal(h.loadCalls.length, 2); assert.equal(h.persistence.length, 1); assert.equal(h.state.snapshot.rows[0].values[0], 4);
}
for (const file of [textFile("invalid.csv", "not,a,sellout,table\n1,2,3,4"), textFile("invalid.csv", "store,sku,product,category,date,units\nFixture retailer,FIXTURE-SKU,Fixture product,Audio,not-a-date,3"), textFile("unexpected.json", JSON.stringify(fixture()))]) {
  const h = await harness({ load: async () => file }); h.openLink(); await h.submit(); h.unchanged();
  assert.match(h.$("sharepointError").textContent, /could not be read as a sell-out report/); assert.equal(h.$("sharepointLink").value, link);
  assert.equal(h.$("sharepointLoad").disabled, false); assert.equal(h.$("importDialog").shown, 0); assert.equal(h.timers.size, 0);
}
{
  const h = await harness(); h.openLink(); h.$("sharepointLink").value = "https://evil.example/Workbook.xlsx"; await h.submit();
  h.unchanged(); assert.equal(h.loadCalls.length, 0); assert.ok(h.$("sharepointError").textContent); assert.equal(h.$("sharepointLoad").disabled, false);
  h.$("sharepointLink").value = link; h.$("sharepointLink").event("input"); assert.equal(h.$("sharepointError").textContent, "");
}

// A close, including late progress/success, cannot resurrect UI or commit data.
// Repeat at the parser stage to cover cancellation after download has finished.
{
  const gate = deferred(), h = await harness({ load: () => gate.promise }); h.openLink(); const run = h.submit(), call = h.loadCalls[0];
  h.$("sharepointDialog").close(); assert.equal(call.signal.aborted, true); assert.equal(h.$("sharepointLink").value, "");
  const progress = h.$("sharepointProgressText").textContent; call.onProgress({ phase: "download" }); assert.equal(h.$("sharepointProgressText").textContent, progress);
  gate.resolve(csvFile("late.csv", 98)); await run; h.unchanged(); assert.equal(h.$("importDialog").shown, 0); assert.equal(h.$("sharepointError").textContent, ""); assert.equal(h.timers.size, 0);
}
{
  const gate = deferred(), h = await harness({ load: async () => ({ name: "late-parser.csv", size: 100, text: () => gate.promise }) }); h.openLink(); const run = h.submit(); await flush();
  h.$("sharepointDialog").close(); assert.equal(h.loadCalls[0].signal.aborted, true);
  gate.resolve(await csvFile("unused.csv", 98).text()); await run; h.unchanged(); assert.equal(h.state.pending, null); assert.equal(h.$("importDialog").shown, 0);
}
{
  const gate = deferred(), h = await harness({ load: () => gate.promise }); h.openLink(); const run = h.submit();
  const timeout = [...h.timers.values()].find(timer => timer.delay === 120000); assert.ok(timeout); timeout.callback();
  assert.equal(h.loadCalls[0].signal.aborted, true); gate.reject(new Error("Fixture aborted transaction")); await run; h.unchanged();
  assert.match(h.$("sharepointError").textContent, /timed out/); assert.equal(h.$("sharepointLoad").disabled, false); assert.equal(h.timers.size, 0);
}

// Starting a SharePoint connection also invalidates an older local XLSX parse.
// The obsolete parse cannot open Review over sign-in or own a pending report.
{
  const localBytes = deferred(), download = deferred(), h = await harness({ load: () => download.promise });
  const oldWorkbook = h.workbook("old-local.xlsx", [{ name: "Obsolete table", units: 99 }]);
  const oldRead = h.$("workbookFile").select({ name: oldWorkbook.name, size: oldWorkbook.size, arrayBuffer: () => localBytes.promise });
  h.openLink(); const loadRun = h.submit();
  const pending = h.state.pending, sheets = h.state.sheets, reviews = h.$("importDialog").shown, messages = h.messages.length;
  h.$("workbookFile").rawValue = "fixture/new-native-selection.xlsx";
  localBytes.resolve(await oldWorkbook.arrayBuffer()); await oldRead;
  h.unchanged(); assert.equal(h.state.pending, pending); assert.equal(h.state.sheets, sheets); assert.equal(h.$("importDialog").shown, reviews);
  assert.equal(h.messages.length, messages); assert.equal(h.$("sharepointDialog").open, true); assert.equal(h.$("sharepointLoad").disabled, true);
  assert.equal(h.$("workbookFile").value, "fixture/new-native-selection.xlsx", "Opening a newer connection prevents stale local-file cleanup.");
  download.resolve(csvFile("new-linked.csv", 12)); await loadRun;
  assert.equal(h.persistence.length, 1); assert.equal(h.state.snapshot.title, "new-linked.csv"); assert.equal(h.state.snapshot.sourceUrl, link);
  assert.equal(h.state.snapshot.rows[0].values[0], 12); assert.equal(h.$("importDialog").shown, reviews); assert.equal(h.$("sharepointDialog").open, false);
}
{
  const localBytes = deferred(), h = await harness(), oldWorkbook = h.workbook("old-before-open.xlsx", [{ name: "Old local table", units: 99 }]);
  const oldRead = h.$("workbookFile").select({ name: oldWorkbook.name, size: oldWorkbook.size, arrayBuffer: () => localBytes.promise });
  h.openLink(); const messages = h.messages.length;
  localBytes.resolve(await oldWorkbook.arrayBuffer()); await oldRead;
  h.unchanged(); assert.equal(h.loadCalls.length, 0); assert.equal(h.state.pending, null); assert.equal(h.state.sheets.length, 0);
  assert.equal(h.$("importDialog").shown, 0); assert.equal(h.$("sharepointDialog").open, true); assert.equal(h.messages.length, messages);
  h.$("sharepointDialog").close();
}

// Selecting an ordinary file during authentication cancels the old transaction.
// It still goes to review, never picks up the pasted URL, and wins late success.
{
  const gate = deferred(), h = await harness({ load: () => gate.promise }); h.openLink(); const run = h.submit();
  h.loadWorkbook(); assert.equal(h.loadCalls[0].signal.aborted, true);
  await h.$("workbookFile").select(csvFile("ordinary.csv", 9)); h.unchanged();
  const pending = h.state.pending, review = h.$("importReview").innerHTML, messages = h.messages.length;
  assert.equal(pending.snapshot.title, "ordinary.csv"); assert.equal(pending.snapshot.sourceUrl || null, null); assert.equal(h.$("importDialog").open, true);
  assert.equal(h.$("sharepointDialog").open, false, "An ordinary file review closes the superseded sign-in dialog.");
  gate.resolve(csvFile("stale.csv", 99)); await run; h.unchanged();
  assert.equal(h.state.pending, pending); assert.equal(h.$("importReview").innerHTML, review); assert.equal(h.messages.length, messages);
  h.loadWorkbook(); assert.equal(h.$("workbookFile").clicks, 2, "The workbook button can be clicked repeatedly after cancellation.");
}
{
  const gate = deferred(), h = await harness({ load: async () => ({ name: "old-parser.csv", size: 100, text: () => gate.promise }) }); h.openLink(); const run = h.submit(); await flush();
  await h.$("workbookFile").select(csvFile("newer.csv", -4)); const pending = h.state.pending;
  gate.resolve(await csvFile("old.csv", 99).text()); await run; h.unchanged();
  assert.equal(h.state.pending, pending); assert.equal(pending.snapshot.title, "newer.csv"); assert.equal(pending.snapshot.rows[0].values[0], -4);
}

// Regular imports keep Review/Apply behavior and their own JSON provenance.
// Last-request ownership excludes older successes, older failures and cleanup.
{
  const h = await harness();
  await h.$("workbookFile").select(csvFile("ordinary.csv", 0)); h.unchanged(); assert.equal(h.$("importDialog").shown, 1); assert.equal(h.state.pending.snapshot.sourceUrl || null, null);
  await h.$("workbookFile").select(textFile("own-source.json", JSON.stringify({ snapshot: { ...fixture("Own JSON"), sourceUrl: ownSource } }))); h.unchanged();
  assert.equal(h.state.pending.snapshot.sourceUrl, ownSource); assert.equal(h.$("workbookFile").value, "");
  const first = deferred(), second = deferred();
  const oldRead = h.$("workbookFile").select({ name: "old.csv", size: 100, text: () => first.promise });
  const newRead = h.$("workbookFile").select({ name: "new.csv", size: 100, text: () => second.promise });
  second.resolve(await csvFile("new.csv", 9).text()); await newRead; const winning = h.state.pending, messageCount = h.messages.length;
  h.$("workbookFile").rawValue = "fixture/later-selection.csv"; first.resolve(await csvFile("old.csv", 99).text()); await oldRead;
  assert.equal(h.state.pending, winning); assert.equal(h.messages.length, messageCount); assert.equal(h.$("workbookFile").value, "fixture/later-selection.csv"); h.unchanged();
  const olderFailure = deferred(), failureRead = h.$("workbookFile").select({ name: "older-error.csv", size: 100, text: () => olderFailure.promise });
  await h.$("workbookFile").select(csvFile("final.csv", -2)); const finalPending = h.state.pending, finalMessages = h.messages.length;
  olderFailure.reject(new Error("Stale internal fixture error")); await failureRead; h.unchanged(); assert.equal(h.state.pending, finalPending); assert.equal(h.messages.length, finalMessages);
  const olderSuccess = deferred(), successRead = h.$("workbookFile").select({ name: "older-success.csv", size: 100, text: () => olderSuccess.promise });
  await h.$("workbookFile").select(textFile("newer-invalid.csv", "invalid")); const latestError = h.messages.at(-1);
  olderSuccess.resolve(await csvFile("older-success.csv", 44).text()); await successRead;
  h.unchanged(); assert.equal(h.state.pending, finalPending); assert.equal(h.messages.at(-1), latestError); assert.equal(h.privateCalls.length, 0);
}

console.log("Authenticated SharePoint UI: actual ZIP/CSV/JSON import controller passed setup/init boundaries, automatic single-table persistence, multi-table review, failures/retry, close/timeout/parser cancellation, stale-request ownership and ordinary-file provenance without real network/auth/private files.");
