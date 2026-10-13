import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "../../public/js/master-model.js";
import "../../public/js/master-client.js";

const source = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
const model = globalThis.PortfolioMasterModel, clone = (value) => JSON.parse(JSON.stringify(value));
const definition = (name) => {
  const found = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"))?.[0];
  assert.ok(found, `Exercise actual ${name}.`); return found;
};
const functions = ["planPortfolioNameUpdates", "applyPortfolioNameUpdates", "importPortfolioNameUpdates", "parsePortfolioImportText"].map(definition).join("\n");
const bindings = source.match(/^\$\("#importNameUpdates"\)\.onclick[^]*?^\$\("#importNameUpdatesFile"\)\.onchange[^\n]*/m)?.[0];
assert.ok(bindings);
assert.equal((html.match(/id="importNameUpdates"/g) || []).length, 1);
assert.match(html, /id="importNameUpdates"[^>]*aria-describedby="nameUpdateStatus"/);
assert.match(html, /id="nameUpdateStatus"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(html, /id="importNameUpdatesFile"[^>]*type="file"[^>]*accept="\.data,\.json,application\/json"/);
assert.ok(!/disconnect|markImported|normalizeImportedPortfolio|commitPackageDraft|getSession|PPC_MASTER_SOURCE|sessionStorage|localStorage/.test(functions), "Name updates cannot restore data, alter access, inspect session secrets or normalize unrelated values.");
assert.ok(definition("importJson").includes(".disconnect()") && definition("importJson").includes(".markImported("), "Ordinary restore keeps its existing access boundary.");

function sample() {
  const result = { version: 4, activeCategoryId: "audio", settings: { view: "products", showPrices: false }, packageInfo: { comments: "Retain comments", updatedAt: "2026-10-13T04:00:00Z" },
    imageAssets: [{ id: "hero", sourceType: "local", fileName: "hero.png" }], masterLocalMerges: [],
    plcSharePending: { patches: [] }, masterSync: { revision: 5, products: {}, history: [{ productId: "p0", path: "specs/s1/value", before: "48kHz", after: "96kHz", at: "2026-10-12T10:00:00Z" }] },
    categories: ["audio", "keyboards"].map((id, categoryIndex) => ({ id, name: id, board: { title: id, lanes: [{ id: "wired", order: 0 }, { id: "wireless", order: 1 }], settings: { showPrices: true }, products: [0, 1].map((index) => ({
      id: `p${categoryIndex * 2 + index}`, name: `Original product ${categoryIndex * 2 + index}`, laneId: index ? "wireless" : "wired", order: index, price: 99,
      specs: [{ id: "s1", label: "Sensitivity", value: "100 dB (1 mW)\nUSB mode only" }], partSkus: [{ id: "sku", code: `HP${categoryIndex}${index}` }],
      variantGroups: [{ id: "color", type: "color", label: "Color", items: [{ id: "black", code: "BK", colorHex: "#000000", imageAssetId: "hero" }] }],
      imageAssetId: "hero", ffsDate: "2026-04-03", roadmap: { family: "Core", startMonth: "2026-04", endMonth: "2029-04", status: "launched" },
      dateHistory: [{ before: "2026-03-01", after: "2026-04-03" }], ascm: { fullProductName: "Imported description" },
    })) } })),
  };
  result.masterLocalBaseline = clone(model.snapshot(result).products);
  result.categories[0].board.products[0].name = "Existing pending name";
  return result;
}
function renamed(value) { const result = clone(value); result.categories[0].board.products[1].name = "PCB exact family name"; result.categories[1].board.products[0].name = "PCB exact keyboard configuration"; return result; }

function fixture({ beforeWrite, afterWrite, duringRender, storageFailure, renderFailure, rollbackFailure } = {}) {
  const events = [], writes = [], attrs = new Map(), status = { textContent: "", classList: { remove: () => events.push(["show-status"]) } };
  const button = { disabled: false, setAttribute: (key, value) => attrs.set(key, value), removeAttribute: (key) => attrs.delete(key) }, fileInput = { value: "", click: () => events.push(["picker"]) };
  let stored, attempts = 0;
  const sandbox = { PortfolioMasterModel: model, portfolio: sample(), workspaceOpening: false, packageOperationInProgress: false, workspaceSaveRevision: 0, workspaceSavePending: true, saveTimer: 123,
    clearTimeout: () => events.push(["clear-timer"]), syncControls: () => events.push(["controls"]), renderInspector: () => events.push(["inspector"]),
    renderActiveView() { events.push(["render"]); duringRender?.(sandbox); if (renderFailure) throw new Error("Render unavailable"); },
    scheduleSave: () => events.push(["schedule-existing-save"]), showLocalSaveFailure: () => events.push(["save-recovery"]),
    PortfolioMasterUI: { updateStatus: () => events.push(["master-status"]), getSession() { assert.fail("Do not inspect or replace access."); }, disconnect() { assert.fail("Do not disconnect sharing."); }, markImported() { assert.fail("Do not rebase the comparison."); } },
    PortfolioNotifications: { resolve: (id) => events.push(["resolve", id]) },
    workspaceStorage: { async save(serialized, options) {
      attempts += 1; assert.equal(sandbox.packageOperationInProgress, true, "Refresh remains blocked throughout durable update and rollback.");
      await beforeWrite?.({ attempts, sandbox, serialized });
      if (!options.isCurrent()) throw new Error("Workspace changed before durable commit");
      if (storageFailure || rollbackFailure && attempts > 1) throw new Error("Storage unavailable");
      writes.push(serialized); stored = serialized; await afterWrite?.({ attempts, sandbox, serialized });
    } },
    $(selector) { return { "#importNameUpdates": button, "#nameUpdateStatus": status, "#importNameUpdatesFile": fileInput }[selector] || assert.fail(`Unexpected UI/credential access: ${selector}`); },
    FileReader: class { readAsText(file) { assert.equal(sandbox.packageOperationInProgress, true, "The guarded operation begins before reading the file."); Promise.resolve().then(() => { if (file.fail) this.onerror(); else { this.result = file.text; this.onload(); } }); } },
  };
  vm.createContext(sandbox); vm.runInContext(functions + "\n" + bindings, sandbox);
  return { sandbox, events, writes, button, status, attrs, fileInput, get stored() { return stored; } };
}

const valid = fixture(), original = JSON.stringify(valid.sandbox.portfolio), input = renamed(valid.sandbox.portfolio);
const plan = valid.sandbox.planPortfolioNameUpdates(input, valid.sandbox.portfolio);
assert.equal(plan.changes.length, 2); assert.equal(JSON.stringify(valid.sandbox.portfolio), original);
assert.equal(JSON.stringify(plan.draft), JSON.stringify(input), "Only requested names change; all metadata and the original comparison baseline remain exact.");
const identities = valid.sandbox.portfolio.categories.flatMap((category) => category.board.products), baselineIdentity = valid.sandbox.portfolio.masterLocalBaseline;
assert.equal(await valid.sandbox.applyPortfolioNameUpdates(input), 2);
assert.equal(valid.sandbox.portfolio.masterLocalBaseline, baselineIdentity, "The live baseline is not replaced or rebased.");
assert.ok(valid.sandbox.portfolio.categories.flatMap((category) => category.board.products).every((product, index) => product === identities[index]), "Existing product and editor references survive; this is not a workspace replacement.");
assert.equal(JSON.stringify(valid.sandbox.portfolio), JSON.stringify(input)); assert.equal(valid.stored, JSON.stringify(input));
assert.equal(valid.sandbox.workspaceSavePending, false); assert.equal(valid.sandbox.packageOperationInProgress, false);

const forbidden = [
  ["spec value", (v) => v.categories[0].board.products[0].specs[0].value = "Changed"],
  ["spec row identity", (v) => v.categories[0].board.products[0].specs[0].id = "other-spec"],
  ["SKU", (v) => v.categories[0].board.products[0].partSkus[0].code = "CHANGED"],
  ["image metadata", (v) => v.imageAssets[0].fileName = "other.png"],
  ["image assignment", (v) => v.categories[0].board.products[0].imageAssetId = "other"],
  ["variant", (v) => v.categories[0].board.products[0].variantGroups[0].items[0].colorHex = "#FFFFFF"],
  ["date/history", (v) => v.categories[0].board.products[0].dateHistory[0].after = "2026-05-01"],
  ["baseline", (v) => v.masterLocalBaseline[0].values.name = "Rebased name"],
  ["master history", (v) => v.masterSync.history[0].after = "192kHz"],
  ["active category", (v) => v.activeCategoryId = "keyboards"],
  ["settings", (v) => v.settings.showPrices = true],
  ["PLC metadata", (v) => v.plcSharePending.patches.push({ field: "ffsDate" })],
  ["category name", (v) => v.categories[0].name = "Renamed category"],
  ["category order", (v) => v.categories.reverse()],
  ["lane order", (v) => v.categories[0].board.lanes.reverse()],
  ["product order", (v) => v.categories[0].board.products.reverse()],
  ["product identity", (v) => v.categories[0].board.products[1].id = "other-product"],
  ["duplicate product", (v) => v.categories[0].board.products[1].id = "p0"],
  ["duplicate category", (v) => v.categories[1].id = "audio"],
  ["duplicate lane", (v) => v.categories[0].board.lanes[1].id = "wired"],
  ["added product", (v) => v.categories[0].board.products.push({ id: "new", name: "New", laneId: "wired" })],
  ["removed product", (v) => v.categories[0].board.products.pop()],
  ["config injection", (v) => v.masterEndpoint = "https://other.invalid/"],
  ["access injection", (v) => v.accessKey = "UNACCEPTED-ACCESS"],
  ["empty name", (v) => v.categories[0].board.products[1].name = "  "],
  ["invalid name", (v) => v.categories[0].board.products[1].name = { text: "Wrong" }],
  ["excessive name", (v) => v.categories[0].board.products[1].name = "a".repeat(2049)],
];
for (const [label, change] of forbidden) {
  const trial = fixture(), before = JSON.stringify(trial.sandbox.portfolio), proposed = renamed(trial.sandbox.portfolio); change(proposed);
  await assert.rejects(trial.sandbox.applyPortfolioNameUpdates(proposed), undefined, label);
  assert.equal(trial.writes.length, 0, `${label} is rejected before any storage write.`);
  assert.equal(JSON.stringify(trial.sandbox.portfolio), before, `${label} cannot mutate the current record.`);
}
for (const alterCurrent of [
  (v) => delete v.masterLocalBaseline,
  (v) => v.masterLocalBaseline.pop(),
  (v) => v.masterLocalMerges.push({ productId: "p0", sourceProductId: "p1" }),
  (v) => v.categories[0].board.products[0].price = 100,
  (v) => v.categories[0].board.products[0].specs[0].value = "Unsaved non-name change",
]) {
  const trial = fixture(); alterCurrent(trial.sandbox.portfolio);
  await assert.rejects(trial.sandbox.applyPortfolioNameUpdates(renamed(trial.sandbox.portfolio)));
  assert.equal(trial.writes.length, 0, "Existing non-name pending operations cannot be mixed into a name-only review.");
}
const noChanges = fixture(); await assert.rejects(noChanges.sandbox.applyPortfolioNameUpdates(clone(noChanges.sandbox.portfolio)), /no product name changes/);
const failedSave = fixture({ storageFailure: true }), failedBefore = JSON.stringify(failedSave.sandbox.portfolio);
await assert.rejects(failedSave.sandbox.applyPortfolioNameUpdates(renamed(failedSave.sandbox.portfolio)), /Storage unavailable/);
assert.equal(JSON.stringify(failedSave.sandbox.portfolio), failedBefore, "A failed durable write cannot apply any names.");

for (const stage of ["read", "before-write", "after-write"]) {
  let trial;
  const mutate = () => trial.sandbox.portfolio.categories[0].board.products[0].ascm.newObservation = "Newer data";
  trial = fixture({ beforeWrite: stage === "before-write" ? ({ attempts }) => { if (attempts === 1) mutate(); } : undefined,
    afterWrite: stage === "after-write" ? ({ attempts }) => { if (attempts === 1) mutate(); } : undefined });
  const proposed = renamed(trial.sandbox.portfolio);
  await assert.rejects(trial.sandbox.applyPortfolioNameUpdates(stage === "read" ? async () => { assert.equal(trial.sandbox.packageOperationInProgress, true); mutate(); return proposed; } : proposed), /changed/);
  assert.equal(trial.sandbox.portfolio.categories[0].board.products[0].ascm.newObservation, "Newer data", "Freshness failures keep newer current metadata.");
  assert.equal(trial.sandbox.portfolio.categories[0].board.products[1].name, "Original product 1", "No imported name applies after a freshness failure.");
  if (stage === "after-write") assert.equal(trial.stored, JSON.stringify(trial.sandbox.portfolio), "A stale durable result is restored from the newer current model rather than an old backup.");
}
const failedRender = fixture({ renderFailure: true }), renderBefore = JSON.stringify(failedRender.sandbox.portfolio);
await assert.rejects(failedRender.sandbox.applyPortfolioNameUpdates(renamed(failedRender.sandbox.portfolio)), /Render unavailable/);
assert.equal(JSON.stringify(failedRender.sandbox.portfolio), renderBefore); assert.equal(failedRender.stored, renderBefore);
const failedRollback = fixture({ renderFailure: true, rollbackFailure: true });
await assert.rejects(failedRollback.sandbox.applyPortfolioNameUpdates(renamed(failedRollback.sandbox.portfolio)), /saved copy could not be restored/);
assert.equal(failedRollback.sandbox.workspaceSavePending, true); assert.ok(failedRollback.events.some(([event]) => event === "save-recovery"));
const normalizedRender = fixture({ duringRender: (sandbox) => { sandbox.portfolio.categories[0].board.products[0].ascm.normalizedDuringRender = true; } });
await assert.rejects(normalizedRender.sandbox.applyPortfolioNameUpdates(renamed(normalizedRender.sandbox.portfolio)), /changed while applying/);
assert.equal(normalizedRender.sandbox.portfolio.categories[0].board.products[0].ascm.normalizedDuringRender, true);
assert.equal(normalizedRender.sandbox.portfolio.categories[0].board.products[1].name, "Original product 1");
assert.equal(normalizedRender.stored, JSON.stringify(normalizedRender.sandbox.portfolio), "Unexpected render normalization is kept while imported names roll back durably.");
const newerNameDuringRender = fixture({ duringRender: (sandbox) => { sandbox.portfolio.categories[0].board.products[1].name = "Newer live name"; } });
await assert.rejects(newerNameDuringRender.sandbox.applyPortfolioNameUpdates(renamed(newerNameDuringRender.sandbox.portfolio)), /changed while applying/);
assert.equal(newerNameDuringRender.sandbox.portfolio.categories[0].board.products[1].name, "Newer live name", "Rollback cannot overwrite a newer name edit.");
assert.equal(newerNameDuringRender.sandbox.portfolio.categories[1].board.products[0].name, "Original product 2");
const staleRollback = fixture({ renderFailure: true, beforeWrite: ({ attempts, sandbox }) => { if (attempts === 2) sandbox.portfolio.categories[0].board.products[0].ascm.newerDuringRollback = true; } });
await assert.rejects(staleRollback.sandbox.applyPortfolioNameUpdates(renamed(staleRollback.sandbox.portfolio)), /saved copy could not be restored/);
assert.equal(staleRollback.sandbox.portfolio.categories[0].board.products[0].ascm.newerDuringRollback, true);
assert.equal(staleRollback.writes.length, 1, "A stale rollback write is rejected rather than overwriting a newer current model.");
assert.equal(staleRollback.sandbox.workspaceSavePending, true);

const ui = fixture(); ui.button.onclick(); assert.deepEqual(ui.events.at(-1), ["picker"]);
ui.fileInput.onchange({ target: { files: [{ text: JSON.stringify(renamed(ui.sandbox.portfolio)) }], value: "names.data" } });
await new Promise(setImmediate);
assert.match(ui.status.textContent, /2 product names updated on this device/); assert.match(ui.status.textContent, /Review and save/);
assert.equal(ui.button.disabled, false); assert.equal(ui.attrs.has("aria-busy"), false);
const unreadable = fixture(); await unreadable.sandbox.importPortfolioNameUpdates({ fail: true });
assert.match(unreadable.status.textContent, /could not be read/); assert.equal(unreadable.button.disabled, false);

// A connected normal master client continues tracking the same objects and
// retains access. No network save or auth re-entry occurs during name import.
const connected = fixture(), remote = { ...model.snapshot(connected.sandbox.portfolio), products: clone(connected.sandbox.portfolio.masterLocalBaseline), revision: "original", canWrite: true };
const network = [];
let connecting = true;
const session = globalThis.PortfolioMasterClient.createSession({ endpoint: "https://master.example.invalid/api/master", adapter: {
  getProducts: () => model.productsFromManifest(connected.sandbox.portfolio), getBaselineProducts: () => connected.sandbox.portfolio.masterLocalBaseline,
  setBaselineProducts: (baseline) => { connected.sandbox.portfolio.masterLocalBaseline = clone(baseline); }, applyProductValues() { assert.equal(connecting, true, "Only the ordinary initial connect may apply remote fields."); },
}, fetchImpl: async (url) => { network.push(url); return Response.json({ snapshot: remote }); } });
await session.connect({ key: "PRIVATE-SESSION-ACCESS" });
connecting = false;
const stateBefore = session.getState(), proposed = renamed(connected.sandbox.portfolio), baselineBefore = JSON.stringify(connected.sandbox.portfolio.masterLocalBaseline);
assert.equal(await connected.sandbox.applyPortfolioNameUpdates(proposed), 2);
const stateAfter = session.getState();
assert.equal(stateAfter.connected, true); assert.equal(stateAfter.hasKey, true); assert.equal(stateAfter.accessVersion, stateBefore.accessVersion);
assert.equal(network.length, 1, "The only network operation is the initial normal connect; import never publishes or unlocks.");
assert.equal(JSON.stringify(connected.sandbox.portfolio.masterLocalBaseline), baselineBefore);
assert.equal(stateAfter.pending.length, 3, "Two imported names join the existing pending name without dropping it.");
assert.ok(stateAfter.pending.every((change) => Object.keys(change.patch).length === 1 && Object.hasOwn(change.patch, "name")));
console.log("Name update checks passed: complete non-name equality, exact identities/order, names-only pending guard, unchanged metadata/objects/baseline/access, atomic durable apply, stale-write and rollback recovery, normal file controls and master tracking without automatic sharing.");
