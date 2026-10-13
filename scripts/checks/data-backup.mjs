import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
const definition = (name) => {
  const found = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"))?.[0];
  assert.ok(found, `Exercise the actual ${name} implementation.`); return found;
};
const bindings = source.match(/^\$\("#exportJson"\)\.onclick[^]*?^\$\("#copyJson"\)\.onclick[^\n]*/m)?.[0];
assert.ok(bindings, "Copy and download share the normal Export-data payload.");
const dataPanel = html.match(/<section id="settingsDataPanel"[^]*?<\/section>\s*<\/div>\s*<\/div>/)?.[0];
assert.ok(dataPanel?.includes('id="copyJson"'), "The fallback belongs only to Settings → Data & export.");
assert.equal((html.match(/id="copyJson"/g) || []).length, 1);
assert.match(html, /id="copyJson"[^>]*type="button"[^>]*aria-describedby="dataCopyStatus"/);
assert.match(html, /id="dataCopyStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
assert.match(html, /<textarea id="dataBackupText" rows="7" readonly spellcheck="false" aria-label="Data backup JSON"/);

const sample = () => ({
  version: 4, activeCategoryId: "headsets", packageInfo: { updatedAt: "2026-10-13T01:00:00Z", comments: "Retain this" },
  categories: [{ id: "headsets", board: { lanes: [{ id: "wireless", label: "Wireless", order: 0 }], settings: { showPrices: false }, products: [{ id: "headset", name: "USB headset", laneId: "wireless", price: 0, imageAssetId: "hero", specs: [{ id: "test-condition", label: "Sensitivity", value: "100 dB (1 mW)\nUSB mode only" }], variantGroups: [{ items: [{ id: "black", imageAssetId: "variant-image" }] }], ffsDate: "2026-02-03", dateHistory: [{ source: "PLC", oldValue: "2026-01-01", newValue: "2026-02-03" }] }] } }],
  imageAssets: [{ id: "hero", sourceType: "local", fileName: "headset.png" }, { id: "variant-image", sourceType: "url", url: "https://example.invalid/image.png" }],
  masterLocalBaseline: [{ productId: "headset", name: "Old master name" }], plcSharePending: { patches: [{ field: "ffsDate", oldValue: "2026-01-01", value: "2026-02-03" }] },
});

function fixture({ nativeFailure = false, nativeAvailable = true, fallbackResult = true, pendingWrite } = {}) {
  const classes = new Set(["hidden"]), attrs = new Map();
  const button = { disabled: false, setAttribute: (key, value) => attrs.set(key, value), removeAttribute: (key) => attrs.delete(key), focus(options) { events.push(["restore-focus", options.preventScroll]); } };
  const status = { textContent: "", classList: { remove: (name) => classes.delete(name) } };
  const fallbackClasses = new Set(["hidden"]), textField = { value: "" }, fallback = { classList: { remove: (name) => fallbackClasses.delete(name) } };
  const exportButton = {}, writes = [], areas = [], downloads = [], events = [], timers = new Map();
  let nextTimer = 0;
  const document = {
    activeElement: button,
    createElement(tag) {
      assert.equal(tag, "textarea");
      const area = { style: {}, value: "", setAttribute() {}, focus(options) { events.push(["temporary-focus", options.preventScroll]); }, select() { events.push(["select"]); }, remove() { area.removed = true; } };
      areas.push(area); return area;
    },
    body: { appendChild() {} }, execCommand(command) { assert.equal(command, "copy"); events.push(["fallback-copy"]); return fallbackResult; },
  };
  const sandbox = { Blob, document, portfolio: sample(), workspaceOpening: false, packageOperationInProgress: false,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    // Access/session state is deliberately outside the portfolio record.
    teamSession: { key: "SESSION-KEY-MUST-NOT-BE-COPIED", token: "AUTH-TOKEN-MUST-NOT-BE-COPIED" },
    navigator: { clipboard: nativeAvailable ? { writeText(text) { writes.push(text); if (pendingWrite) return pendingWrite; return nativeFailure ? Promise.reject(new Error("Clipboard denied")) : Promise.resolve(); } } : undefined },
    $(selector) { return { "#copyJson": button, "#dataCopyStatus": status, "#exportJson": exportButton, "#dataCopyFallback": fallback, "#dataBackupText": textField }[selector] || assert.fail(`Do not read credentials or unrelated DOM: ${selector}`); },
    closePopupMenus() { events.push(["close-menus"]); }, downloadBlob(blob, filename) { downloads.push({ blob, filename }); },
  };
  vm.createContext(sandbox);
  vm.runInContext(["copyTextToClipboard", "portfolioDataBackupText", "copyPortfolioDataBackup", "parsePortfolioImportText"].map(definition).join("\n") + "\n" + bindings, sandbox);
  return { sandbox, button, status, exportButton, attrs, classes, writes, areas, downloads, events, timers, fallbackClasses, textField };
}

const complete = fixture(), before = JSON.stringify(complete.sandbox.portfolio);
complete.exportButton.onclick();
assert.equal(complete.downloads[0].filename, "product-portfolio-data.data");
const normalExport = await complete.downloads[0].blob.text();
complete.events.length = 0;
assert.equal(await complete.button.onclick(), true);
assert.equal(complete.writes[0], normalExport, "Clipboard and file download contain byte-for-byte identical JSON.");
assert.equal(complete.textField.value, normalExport, "The visible readonly backup is exactly the normal Export-data payload.");
assert.equal(complete.fallbackClasses.has("hidden"), false);
assert.deepEqual(JSON.parse(complete.writes[0]), JSON.parse(before), "All specs, image references, variants, date history, pending metadata and comparison baseline survive copying.");
assert.equal(JSON.stringify(complete.sandbox.parsePortfolioImportText(complete.writes[0])), before, "Copied text is accepted by the actual normal data-file parser without losing values.");
assert.ok(!complete.writes[0].includes("SESSION-KEY-MUST-NOT-BE-COPIED") && !complete.writes[0].includes("AUTH-TOKEN-MUST-NOT-BE-COPIED"));
assert.equal(JSON.stringify(complete.sandbox.portfolio), before, "Copying cannot mutate the current workspace.");
assert.equal(complete.classes.has("hidden"), false);
assert.match(complete.status.textContent, /Data backup copied/);
assert.match(complete.status.textContent, /Image files are not included/);
assert.ok(!complete.events.some(([event]) => event === "close-menus"), "Keep feedback visible in Data & export.");
assert.equal(complete.button.disabled, false); assert.equal(complete.attrs.has("aria-busy"), false);

for (const options of [{ nativeFailure: true, fallbackResult: true }, { nativeAvailable: false, fallbackResult: true }, { nativeFailure: true, fallbackResult: false }]) {
  const trial = fixture(options);
  assert.equal(await trial.button.onclick(), options.fallbackResult);
  assert.equal(trial.areas.length, 1); assert.equal(trial.areas[0].value, JSON.stringify(trial.sandbox.portfolio, null, 2));
  assert.equal(trial.areas[0].removed, true, "Temporary selection text is removed after success or failure.");
  assert.equal(trial.button.disabled, false); assert.equal(trial.attrs.has("aria-busy"), false);
  assert.ok(trial.events.some(([event, preventScroll]) => event === "restore-focus" && preventScroll === true));
  if (!options.fallbackResult) {
    assert.match(trial.status.textContent, /could not copy/); assert.ok(!trial.status.textContent.includes("Data backup copied"));
    assert.equal(await trial.button.onclick(), false, "A fresh user click is available after failure; no background retry is required.");
  }
}

let finishWrite;
const pending = fixture({ pendingWrite: new Promise((resolve) => { finishWrite = resolve; }) });
const firstCopy = pending.button.onclick();
assert.equal(pending.button.disabled, true); assert.equal(pending.attrs.get("aria-busy"), "true");
assert.equal(await pending.button.onclick(), false, "An in-flight copy cannot start a second clipboard operation.");
assert.equal(pending.writes.length, 1);
assert.equal(pending.textField.value, JSON.stringify(pending.sandbox.portfolio, null, 2), "Normal UI-visible backup text remains available even if the native clipboard request never completes.");
pending.sandbox.portfolio.categories[0].board.products[0].name = "Newer product name";
finishWrite();
assert.equal(await firstCopy, false);
assert.match(pending.status.textContent, /changed while copying/);
assert.equal(pending.button.disabled, false);
assert.equal(await pending.button.onclick(), true, "A fresh click copies the newer complete snapshot.");
assert.ok(pending.writes[1].includes("Newer product name"));

for (const fallbackResult of [false, true]) {
  let settleLate;
  const timed = fixture({ pendingWrite: new Promise((resolve) => { settleLate = resolve; }), fallbackResult });
  const copying = timed.button.onclick();
  const timer = [...timed.timers.values()][0];
  assert.equal(timer.delay, 2000, "Backup copying bounds a native clipboard request that never settles.");
  timer.callback();
  assert.equal(await copying, fallbackResult, "Timeout uses the existing legacy fallback and reports its actual result.");
  assert.equal(timed.button.disabled, false); assert.equal(timed.attrs.has("aria-busy"), false);
  assert.equal(timed.timers.size, 0);
  if (!fallbackResult) { assert.match(timed.status.textContent, /manual copying/); assert.equal(timed.textField.value, JSON.stringify(timed.sandbox.portfolio, null, 2)); }
  timed.sandbox.portfolio.categories[0].board.products[0].name = "Changed after timeout";
  settleLate(); await new Promise(setImmediate);
  assert.match(timed.status.textContent, /earlier copy completed late/, "A late native completion cannot silently claim its obsolete snapshot is current.");
}
const permanentPending = fixture({ pendingWrite: new Promise(() => {}), fallbackResult: false });
const timedFirst = permanentPending.button.onclick(); [...permanentPending.timers.values()][0].callback();
assert.equal(await timedFirst, false);
const timedRetry = permanentPending.button.onclick(); [...permanentPending.timers.values()][0].callback();
assert.equal(await timedRetry, false, "Even a permanently pending native API leaves manual retry usable and bounded.");
assert.equal(permanentPending.writes.length, 2);

for (const state of ["workspaceOpening", "packageOperationInProgress"]) {
  const busy = fixture(); busy.sandbox[state] = true;
  assert.equal(await busy.button.onclick(), false); assert.equal(busy.writes.length, 0);
  assert.match(busy.status.textContent, /Finish loading/);
}
const failedSerialization = fixture(); failedSerialization.sandbox.portfolio.self = failedSerialization.sandbox.portfolio;
assert.equal(await failedSerialization.button.onclick(), false);
assert.equal(failedSerialization.writes.length, 0); assert.equal(failedSerialization.button.disabled, false);
assert.match(failedSerialization.status.textContent, /could not be copied/);

const large = fixture(); large.sandbox.portfolio.largeSourceNotes = "Technical condition (USB mode)\n".repeat(40000);
const largeBefore = JSON.stringify(large.sandbox.portfolio);
assert.equal(await large.button.onclick(), true);
assert.ok(large.writes[0].length > 1000000);
assert.equal(JSON.stringify(JSON.parse(large.writes[0])), largeBefore, "Large backup payloads remain complete rather than truncated for clipboard delivery.");
assert.equal(large.textField.value, large.writes[0], "The visible manual backup also retains the entire large payload.");
console.log("Data backup checks passed: exact file/clipboard payload parity, complete metadata and parser round-trip, separate credentials, native/fallback copying, honest failure and manual retry, in-flight and stale-snapshot guards, visible accessible status and complete large backups.");
