import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/sellout-dashboard.js", import.meta.url), "utf8");
const definition = name => {
  const found = source.match(new RegExp(`^  (?:async )?function ${name}\\([^]*?^  \\}`, "m"))?.[0];
  assert.ok(found, `Missing actual dashboard import function ${name}`); return found;
};
const controllerStart = source.indexOf("  const chooseFile ="), controllerEnd = source.indexOf('  $("openSource").onclick', controllerStart);
assert.ok(controllerStart >= 0 && controllerEnd > controllerStart, "Missing actual native import controller block.");
const runDefinition = source.match(/^  let importRun = 0;/m)?.[0];
assert.ok(runDefinition, "Missing actual last-request import counter.");

// Real EventTarget dispatch gives the actual callbacks a native event.target;
// the fake elements implement only the file/dialog properties they use.
class Element extends EventTarget {
  constructor(id) {
    super(); this.id = id; this.type = id.endsWith("File") ? "file" : ""; this.files = []; this.rawValue = "";
    this.open = false; this.hidden = false; this.disabled = false; this.textContent = ""; this.innerHTML = "";
    this.attributes = new Map(); this.clicks = 0; this.shown = 0;
    for (const type of ["click", "change", "input", "submit", "close", "cancel"]) this.addEventListener(type, event => {
      this[`on${type}`]?.call(this, event);
    });
  }
  set value(value) { this.rawValue = value; if (!value && this.type === "file") this.files = []; }
  get value() { return this.rawValue; }
  set href(value) { this.attributes.set("href", String(value)); }
  get href() { return this.attributes.get("href") || ""; }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  showModal() { this.open = true; this.shown++; }
  close() { this.open = false; this.dispatchEvent(new Event("close")); }
  click() { this.clicks++; this.dispatchEvent(new Event("click", { cancelable: true })); }
  event(type) { const event = new Event(type, { cancelable: true }); this.dispatchEvent(event); return event; }
  select(file) { this.files = file ? [file] : []; this.rawValue = file ? `fixture/${file.name}` : ""; this.event("change"); }
}
const elements = new Map(), $ = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
const fixture = (sheet = "Active", current = 7) => ({
  schemaVersion: 1, title: "UI fixture workbook", sheet, periods: [{ date: "2026-01-04", quarter: "FY26Q2" }],
  rows: [{ store: "Fixture retailer", sku: "FIXTURE-SKU", product: "Fixture product", category: "Audio", lifetime: current, values: [current] }], warnings: [],
});
const active = fixture(), prices = { "FIXTURE-SKU": { msrp: 0, source: "Active price fixture" } };
const state = { snapshot: active, prices, shortlist: [], ppcProjection: null, pricingSource: null, stores: ["Fixture retailer"], products: [], storesNone: false, productsNone: false, hiddenSeries: new Set(), pending: null, sheets: [] };
const messages = [], workbookReads = [], privateCalls = [], persistence = [];
const forbidden = () => { throw new Error("UI fixture attempted network/auth/storage/codec access."); };
const escaped = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const sandbox = {
  state, $, URL, TextEncoder, TextDecoder, structuredClone,
  console: { log: forbidden, warn: forbidden, error: forbidden }, fetch: forbidden, XMLHttpRequest: forbidden,
  PortfolioPackage: { MAX_PACKAGE_BYTES: 64 * 1024 * 1024, encrypt: forbidden, decrypt: forbidden, createZip: forbidden, readZip: forbidden },
  PPCSelloutMotion: { reset() {} },
  workbookMatrices: async file => { workbookReads.push(file.name); return await file.workbook(); },
  message: (text, error = false) => messages.push({ text, error }),
  esc: escaped, day: value => value, fmt: value => String(value),
  resolvePpc() {}, stopTimeline() {}, controls() {}, update() {}, refreshPpc: forbidden,
  persist: async () => { persistence.push(state.snapshot); return true; },
  openPrivate: mode => privateCalls.push(mode), privateFile: null, ppcBridge: null,
};
Object.defineProperties(sandbox, { localStorage: { get: forbidden }, sessionStorage: { get: forbidden }, navigator: { get: forbidden } });
const context = vm.createContext(sandbox);
for (const filename of ["sellout-model.js", "sellout-ppc.js", "sellout-private.js", "sellout-sharepoint.js"]) {
  vm.runInContext(await readFile(new URL(`../../public/js/${filename}`, import.meta.url), "utf8"), context, { filename });
}
vm.runInContext(`const root = globalThis; const M = PPCSelloutModel;\n${["importSummary", "readImport", "applySnapshot", "sanitizePrices"].map(definition).join("\n")}\n${runDefinition}\n${source.slice(controllerStart, controllerEnd)}`, context, { filename: "actual-dashboard-import-controller.js" });
const locals = () => vm.runInContext("({sharepointLink, selectedSharepointLink, importRun})", context);
const captureActive = () => JSON.stringify({ snapshot: state.snapshot, prices: state.prices, shortlist: state.shortlist, ppcProjection: state.ppcProjection, pricingSource: state.pricingSource, stores: state.stores, products: state.products });
const initialActive = captureActive();
const assertUnchanged = () => { assert.equal(state.snapshot, active); assert.equal(captureActive(), initialActive, "Reading/reviewing imports cannot mutate the active workspace before Apply."); assert.equal(persistence.length, 0); };
const flush = () => new Promise(resolve => setImmediate(resolve));
const link = "https://northwind.sharepoint.com/:x:/g/EXAMPLEopaqueToken_123-ABC?e=fixture&CID=fixture-id";
const selectAction = action => {
  $("importButton").value = action; $("importButton").event("change");
  assert.equal($("importButton").value, "", "A completed action restores the Load data prompt for repeated use.");
};
const beginLink = () => {
  selectAction("sharepoint"); $("sharepointLink").value = link;
  const submit = $("sharepointLinkForm").event("submit"); assert.equal(submit.defaultPrevented, true);
  assert.equal($("sharepointOpen").href, link); assert.equal($("sharepointLinkReady").hidden, false);
};
const handoff = () => {
  beginLink(); const clicks = $("sharepointWorkbookFile").clicks; $("sharepointChooseFile").click();
  assert.equal($("sharepointWorkbookFile").clicks, clicks + 1); assert.equal(locals().selectedSharepointLink, link);
  assert.equal($("sharepointLink").value, ""); assert.equal($("sharepointOpen").getAttribute("href"), null);
  assert.equal($("sharepointDialog").open, false);
};
const workbook = (name, sheets) => ({ name, size: 100, workbook: async () => sheets });
const textFile = (name, text) => ({ name, size: 100, text: async () => text });
const csvFile = (name = "ordinary.csv", units = 0) => textFile(name, `store,sku,product,category,date,units\nFixture retailer,FIXTURE-SKU,Fixture product,Audio,2026-01-04,${units}\n`);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

// Source metadata belongs to every worksheet and follows the reviewed choice.
const sourceSheets = [fixture("First", 0), fixture("Second", -3)], untouchedSheets = JSON.stringify(sourceSheets);
handoff(); $("sharepointWorkbookFile").select(workbook("linked.xlsx", sourceSheets)); await flush();
assert.equal(locals().selectedSharepointLink, null); assert.equal($("sharepointWorkbookFile").value, "");
assert.equal(state.sheets.length, 2); assert.ok(state.sheets.every(sheet => sheet.sourceUrl === link));
assert.equal(JSON.stringify(sourceSheets), untouchedSheets, "Attaching metadata must not rewrite decoded worksheet fixtures.");
assert.equal($("sheetChoiceLabel").hidden, false); assert.equal($("importDialog").open, true);
assert.match($("importReview").innerHTML, /provided source link/); assertUnchanged();
$("sheetChoice").value = "1"; $("sheetChoice").event("change");
assert.equal(state.pending.snapshot.sheet, "Second"); assert.equal(state.pending.snapshot.sourceUrl, link); assert.equal(state.pending.snapshot.rows[0].values[0], -3); assertUnchanged();

// Editing invalidates the prepared hyperlink; close clears private raw text.
beginLink(); $("sharepointLink").value = "Edited fixture text"; $("sharepointLink").event("input");
assert.equal(locals().sharepointLink, null); assert.equal($("sharepointOpen").getAttribute("href"), null); assert.equal($("sharepointLinkReady").hidden, true);
assert.equal($("sharepointHost").textContent, ""); assert.equal($("sharepointLink").value, "Edited fixture text");
$("sharepointLinkForm").event("submit"); assert.ok($("sharepointError").textContent); assert.equal($("sharepointOpen").getAttribute("href"), null);
$("sharepointDialog").close(); assert.equal($("sharepointLink").value, ""); assert.equal($("sharepointError").textContent, ""); assertUnchanged();

// Cancel and empty change consume the dedicated handoff, including late events.
const reviewBeforeCancel = state.pending, readsBeforeCancel = workbookReads.length;
handoff(); $("sharepointWorkbookFile").event("cancel"); assert.equal(locals().selectedSharepointLink, null);
$("sharepointWorkbookFile").select(workbook("late-after-cancel.xlsx", [fixture()])); await flush();
assert.equal(workbookReads.length, readsBeforeCancel); assert.equal(state.pending, reviewBeforeCancel);
handoff(); const runBeforeEmpty = locals().importRun; $("sharepointWorkbookFile").select(null); await flush();
assert.equal(locals().selectedSharepointLink, null); assert.equal(locals().importRun, runBeforeEmpty); assertUnchanged();
const ownSource = "https://northwind.sharepoint.com/sites/Planning/Original.xlsx";
$("workbookFile").select(textFile("own-source.json", JSON.stringify({ snapshot: { ...fixture("Own JSON"), sourceUrl: ownSource } }))); await flush();
assert.equal(state.pending.snapshot.sourceUrl, ownSource, "Cancelled SharePoint selection must not replace a JSON backup's own source."); assertUnchanged();

// Failed linked selections consume the handoff and cannot tag ordinary imports.
const beforeFailure = state.pending; let disallowedJsonReads = 0;
handoff(); $("sharepointWorkbookFile").select({ name: "wrong-kind.json", size: 100, text: async () => { disallowedJsonReads++; return JSON.stringify(fixture()); } }); await flush();
assert.equal(disallowedJsonReads, 0); assert.equal(state.pending, beforeFailure); assert.equal(locals().selectedSharepointLink, null);
assert.match(messages.at(-1).text, /downloaded XLSX or CSV/); assert.equal(messages.at(-1).error, true);
$("workbookFile").select(textFile("plain.json", JSON.stringify(fixture("Plain JSON")))); await flush();
assert.equal(state.pending.snapshot.sourceUrl, undefined, "A failed linked JSON selection cannot contaminate a later ordinary JSON import."); assertUnchanged();
handoff(); $("sharepointWorkbookFile").select({ name: "bad.xlsx", size: 100, workbook: async () => { throw new Error("Fixture workbook decode failure"); } }); await flush();
assert.match(messages.at(-1).text, /Fixture workbook decode failure/); assert.equal(locals().selectedSharepointLink, null);
const fileClicks = $("workbookFile").clicks;
selectAction("file"); assert.equal($("workbookFile").clicks, fileClicks + 1);
$("workbookFile").select(csvFile()); await flush();
assert.equal(state.pending.snapshot.sourceUrl || null, null); assert.equal(state.pending.snapshot.rows[0].values[0], 0); assertUnchanged();
$("workbookFile").select(workbook("ordinary.xlsx", [fixture("Ordinary workbook")])); await flush();
assert.equal(state.pending.snapshot.sourceUrl, undefined); assertUnchanged();

// Two async native selections: the latest request owns review and cleanup.
const oldGate = deferred(), newGate = deferred(), pendingBeforeRace = state.pending;
handoff(); $("sharepointWorkbookFile").select({ name: "old-linked.xlsx", size: 100, workbook: () => oldGate.promise });
$("workbookFile").select({ name: "new-ordinary.csv", size: 100, text: () => newGate.promise });
assert.equal(state.pending, pendingBeforeRace); assertUnchanged();
newGate.resolve(await csvFile("unused.csv", 9).text()); await flush();
assert.equal(state.pending.snapshot.title, "new-ordinary.csv"); assert.equal(state.pending.snapshot.sourceUrl || null, null); assert.equal(state.pending.snapshot.rows[0].values[0], 9);
const winningPending = state.pending, winningSheets = state.sheets, winningReview = $("importReview").innerHTML, winningShows = $("importDialog").shown, winningMessages = messages.length;
$("workbookFile").rawValue = "fixture/later-selection.csv";
oldGate.resolve([fixture("Old linked worksheet", 99)]); await flush();
assert.equal(state.pending, winningPending); assert.equal(state.sheets, winningSheets); assert.equal($("importReview").innerHTML, winningReview);
assert.equal($("importDialog").shown, winningShows); assert.equal(messages.length, winningMessages);
assert.equal($("workbookFile").value, "fixture/later-selection.csv", "A stale read cannot clear a newer native selection."); assertUnchanged();

// A newer failed request still invalidates an older success; stale errors also
// cannot replace a newer successful review or its status message.
const olderSuccess = deferred(); $("workbookFile").select({ name: "older-success.xlsx", size: 100, workbook: () => olderSuccess.promise });
handoff(); $("sharepointWorkbookFile").select(textFile("latest-invalid.json", JSON.stringify(fixture()))); await flush();
const latestError = messages.at(-1), beforeStaleSuccess = state.pending;
olderSuccess.resolve([fixture("Stale success")]); await flush();
assert.equal(state.pending, beforeStaleSuccess); assert.equal(messages.at(-1), latestError); assertUnchanged();
const olderFailure = deferred(); $("workbookFile").select({ name: "older-failure.xlsx", size: 100, workbook: () => olderFailure.promise });
$("workbookFile").select(csvFile("final.csv", -2)); await flush();
const finalPending = state.pending, beforeStaleError = messages.length;
olderFailure.reject(new Error("Stale fixture error")); await flush();
assert.equal(state.pending, finalPending); assert.equal(messages.length, beforeStaleError); assert.equal(state.pending.snapshot.rows[0].values[0], -2); assertUnchanged();

// Only the real Apply callback commits the reviewed worksheet and source link.
handoff(); $("sharepointWorkbookFile").select(workbook("final-linked.xlsx", [fixture("Selected first"), fixture("Selected second", -3)])); await flush();
$("sheetChoice").value = "1"; $("sheetChoice").event("change"); assertUnchanged();
const reviewed = state.pending.snapshot; $("applyImport").click(); await flush();
assert.equal(state.snapshot, reviewed); assert.equal(state.snapshot.sheet, "Selected second"); assert.equal(state.snapshot.sourceUrl, link);
assert.equal(state.snapshot.rows[0].values[0], -3); assert.equal(persistence.length, 1); assert.equal(state.pending, null); assert.equal($("importDialog").open, false);
assert.equal(privateCalls.length, 0);
console.log("SharePoint UI boundary: actual native controller/import functions passed multi-sheet metadata, editing/close/cancel cleanup, failed selection isolation, ordinary/JSON source preservation, last-request async success/error ownership, and review-before-Apply fixtures without backend/private files.");
