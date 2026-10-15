import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { once } from "node:events";
import vm from "node:vm";
import { createMasterServer } from "../../server/master-service.mjs";
import "../../public/js/master-client.js";

const model = globalThis.PortfolioMasterModel, codec = globalThis.PortfolioPackage;
const app = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const masterUi = await readFile(new URL("../../public/js/master-ui.js", import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const workspaces = new Set();
const extract = name => {
  const match = app.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert(match, `Exercise the actual ${name} application function`); return match[0];
};
const appFunctions = ["updateBoard", "scheduleSave", "flushWorkspaceSave", "normalizeLaneOrders", "moveProductToLane", "captureProductCardLayout", "reorderProduct", "localizeSharedProduct"];
const adapterStart = app.indexOf("globalThis.PortfolioMasterAdapter = Object.freeze({");
const adapterEnd = app.indexOf("\n});", adapterStart) + "\n});".length;
assert(adapterStart > 0 && adapterEnd > adapterStart);
assert.match(app, /bindValue\("#fieldLane", "change", \(value\) => moveProductToLane\(product\.id, value\)\)/);
assert.match(extract("finishDrag"), /reorderProduct\(current\.productId, current\.dropTarget\.laneId, current\.dropTarget\.index\)/);

const mice = [
  ["mmo", "MMO Wireless Premium Mice", "wired", 0],
  ["mid-tier", "Fiingertip Mid-Tier Wireless Mice", "wired", 1],
  ["hydra-pro", "Hydra Pro 9B Wireless Mice", "wired", 2],
  ["hydra", "Hydra 9B Wireless Mice", "wired", 3],
  ["wired-tail", "Hydra 9B Wired Mice", "wired", 4],
  ...Array.from({ length: 11 }, (_, order) => [`wireless-${order}`, `Existing wireless mouse ${order + 1}`, "wireless", order]),
].map(([id, name, laneId, order]) => ({ id, name, laneId, order, price: 49, imageAssetId: "fixture-image", imageNote: "Original artwork metadata",
  specs: [{ id: `connection-${id}`, label: "Connection", value: "Wireless", sourceRecord: { source: "Synthetic source", measurementCondition: "1 mW" } }], partSkus: [{ id: `sku-${id}`, code: `FIXTURE-${id}` }], variantGroups: [],
  roadmap: { family: "Fixture", startMonth: "2026-01", endMonth: "2028-12", status: "in-development" } }))
  .map(product => model.applyProductValues({ ...product, order: product.order * 2 + 1 }, model.productValues({ ...product, order: product.order * 2 + 1 })));
const initial = { version: 4, activeCategoryId: "mice", categories: [{ id: "mice", name: "Mice", board: {
  lanes: [{ id: "wired", label: "Wired", order: 0 }, { id: "wireless", label: "Wireless", order: 1 }], products: mice, settings: {} } }],
  imageAssets: [{ id: "fixture-image", sourceType: "local", packagePath: "images/fixture-image.png", mimeType: "image/png" }],
  packageInfo: codec.createPackageInfo({ comments: "Synthetic placement regression" }) };

function appWorkspace(supplied = initial, { legacyBaseline = false } = {}) {
  const portfolio = plain(supplied);
  portfolio.masterLocalBaseline ||= plain(model.snapshot(portfolio).products);
  if (legacyBaseline) for (const product of portfolio.masterLocalBaseline) delete product.values.cardPlacement;
  let stored = "";
  const context = { portfolio, board: portfolio.categories[0].board, activeCategoryId: "mice", selectedId: "hydra", productReorderSession: null,
    packageOperationInProgress: false, workspaceOpening: false, workspaceSaveRevision: 0, workspaceSaveAttempt: 0, workspaceSaveFlight: null, workspaceSavePending: false, saveTimer: null, localDateBaseline: null,
    setTimeout, clearTimeout, workspaceStorage: { async save(value) { stored = value; } },
    PortfolioMasterModel: model, PortfolioProductMerge: globalThis.PortfolioProductMerge, PortfolioPackage: codec, PortfolioNotifications: { resolve() {} },
    PLCImporter: { fieldLabels: { ffsDate: "FFS" }, snapshotDateValues: () => null },
    syncControls() {}, renderInspector() {}, renderActiveView() {}, finishProductReorder() {}, discardProductDrafts() {}, undoDiscardedDraft() {},
    showLocalSaveFailure(error) { throw error; }, getCurrentPackageInfo: () => context.portfolio.packageInfo, packageCodec: () => codec,
    document: { querySelector: () => null, activeElement: null }, roadmapDragState: null, dragState: null, productCardMotion: null };
  vm.createContext(context);
  workspaces.add(context);
  vm.runInContext(appFunctions.map(extract).join("\n") + "\n" + app.slice(adapterStart, adapterEnd), context);
  const adapter = context.PortfolioMasterAdapter;
  return { context, adapter, get portfolio() { return context.portfolio; }, get board() { return context.board; }, get stored() { return stored; },
    product: id => context.board.products.find(product => product.id === id),
    order: laneId => context.board.products.filter(product => product.laneId === laneId).sort((a, b) => a.order - b.order).map(product => product.id) };
}

function pullClick(session, { configured = true } = {}) {
  const handler = masterUi.match(/^    button\.addEventListener\("click", \(event\) => \{[^\n]*showUpdates\(\);[^\n]*\}, true\);/m);
  assert(handler, "Exercise the actual capture-phase Updates handler");
  let click, updates = 0, prevented = false, stopped = false;
  const context = { session, configured, button: { addEventListener(type, callback, capture) { assert.equal(type, "click"); assert.equal(capture, true); click = callback; } },
    showUpdates() { updates++; } };
  vm.createContext(context); vm.runInContext(handler[0], context);
  click({ preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
  return { updates, prevented, stopped, packagePullAllowed: !stopped };
}

const directory = await mkdtemp(join(tmpdir(), "ppc-card-placement-app-")), filename = join(directory, "master_ppc.pkg");
const key = codec.generateKey(), editorToken = "synthetic-placement-editor-token", origin = "https://monocraft.github.io";
const imageBytes = new Uint8Array([1, 2, 3, 4, 5]);
let server;
try {
  await writeFile(filename, await codec.encrypt(codec.createZip([{ name: "portfolio.json", data: new TextEncoder().encode(JSON.stringify(initial)) }, { name: "images/fixture-image.png", data: imageBytes }]), key));
  server = createMasterServer({ packageFile: filename, editorToken, allowedOrigins: [origin], rateLimit: 1000 });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const endpoint = `http://127.0.0.1:${server.address().port}/api/master`;
  const sessionFor = workspace => globalThis.PortfolioMasterClient.createSession({ endpoint, adapter: workspace.adapter,
    fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: origin } }) });

  const originalPlacement = initial.categories[0].board.products.map(({ id, laneId, order }) => ({ id, laneId, order }));
  const snapshotBefore = JSON.stringify(initial); model.snapshot(initial);
  assert.equal(JSON.stringify(initial), snapshotBefore, "reading a gapped legacy portfolio does not normalize or mutate its stored order");
  const a = appWorkspace(), session = sessionFor(a); await session.connect({ key, editorToken });
  assert.deepEqual(a.board.products.map(({ id, laneId, order }) => ({ id, laneId, order })), originalPlacement);
  assert.equal(session.track().length, 0, "gapped saved orders produce no mass placement draft on connect");
  a.product("wireless-0").name = "Existing wireless mouse 1 updated";
  assert.deepEqual(session.track().map(change => Object.keys(change.patch)), [["name"]]);
  await session.save({ reason: "Name-only fixture update" }); await session.refresh();
  assert.deepEqual(a.board.products.map(({ id, laneId, order }) => ({ id, laneId, order })), originalPlacement, "Name-only Save and Pull preserve every gapped saved lane/order");
  const facts = a.board.products.map(({ laneId, order, ...product }) => plain(product));
  a.context.moveProductToLane("mmo", "wireless");
  a.context.reorderProduct("mid-tier", "wireless", a.order("wireless").length);
  a.context.moveProductToLane("hydra-pro", "wireless");
  a.context.reorderProduct("hydra", "wireless", a.order("wireless").length);
  assert.deepEqual(a.order("wireless"), [...Array.from({ length: 11 }, (_, order) => `wireless-${order}`), "mmo", "mid-tier", "hydra-pro", "hydra"]);
  assert.equal(a.product("hydra").order, 14, "four moves are validated against final batch membership rather than the original eleven-product target lane");
  assert.deepEqual(a.order("wired"), ["wired-tail"]);
  assert.deepEqual(a.board.products.map(({ laneId, order, ...product }) => plain(product)), facts, "both actual editing routes change only placement");
  const pending = session.track();
  assert(pending.length >= 4, "lane/reorder changes appear in the shared Save review");
  assert(pending.every(change => Object.keys(change.patch).every(field => field === "cardPlacement")), "the narrow shared update contains only atomic card placement");
  assert.deepEqual(pullClick(session), { updates: 1, prevented: true, stopped: true, packagePullAllowed: false }, "unsaved moves cannot turn Updates into an implicit package replacement");
  assert.equal(await a.context.flushWorkspaceSave(), true);
  const deviceReload = appWorkspace(JSON.parse(a.stored));
  assert.deepEqual(deviceReload.order("wireless"), a.order("wireless"), "completed device save and JSON reopen retain the lane/order draft");
  assert.equal(a.context.selectedId, "hydra");

  await session.save({ reason: "Correct mouse lanes and order" }); await session.refresh();
  assert.equal(session.track().length, 0);
  assert.deepEqual(pullClick(session), { updates: 1, prevented: true, stopped: true, packagePullAllowed: false }, "a clean workspace opens explicit update controls before choosing a refresh or package load");
  assert.deepEqual(pullClick({ track: () => [], getState: () => ({ hasKey: false }) }), { updates: 1, prevented: true, stopped: true, packagePullAllowed: false }, "disconnected Updates still explains the separate explicit package unlock action");
  const expectedOrder = a.order("wireless");
  const b = appWorkspace(), second = sessionFor(b); await second.connect({ key, editorToken });
  assert.deepEqual(b.order("wireless"), expectedOrder, "a second workspace receives accepted lane and exact order through the actual app adapter");
  assert.deepEqual(b.order("wired"), ["wired-tail"]);
  assert.equal(second.track().length, 0, "accepted remote placement is not republished as a local edit");
  assert.equal(b.context.selectedId, "hydra", "the accepted placement update preserves the selected product");
  const entries = codec.readZip(await codec.decrypt(new Uint8Array(await readFile(filename)), key));
  assert.deepEqual(entries.get("images/fixture-image.png"), imageBytes);
  const published = JSON.parse(new TextDecoder().decode(entries.get("portfolio.json"))), packageReload = appWorkspace(published);
  assert.deepEqual(packageReload.order("wireless"), expectedOrder, "the full saved package now reopens the accepted lane/order instead of restoring Wired");
  assert(published.categories[0].board.products.every(product => product.imageAssetId === "fixture-image"));
  assert.deepEqual(published.categories[0].board.products.map(({ laneId, order, ...product }) => plain(product)), facts, "shared placement preserves every other rich product field");
  assert.deepEqual(published.imageAssets, initial.imageAssets, "sharing placement does not rewrite the image registry");
  const reopenedSession = sessionFor(deviceReload); await reopenedSession.connect({ key, editorToken });
  assert.deepEqual(deviceReload.order("wireless"), expectedOrder); assert.equal(reopenedSession.track().length, 0, "reopening an accepted placement clears the prior pending draft");

  const cleanLegacy = appWorkspace(published, { legacyBaseline: true }), cleanUpgrade = sessionFor(cleanLegacy);
  await cleanUpgrade.connect({ key, editorToken }); assert.equal(cleanUpgrade.track().length, 0, "legacy clean baselines upgrade without creating false placement edits");
  const legacyDraft = appWorkspace(published, { legacyBaseline: true }); legacyDraft.context.moveProductToLane("hydra", "wired");
  const legacyUpgrade = sessionFor(legacyDraft); await legacyUpgrade.connect({ key, editorToken });
  assert.equal(legacyDraft.product("hydra").laneId, "wired", "legacy baseline upgrade preserves a real local move as a draft");
  assert(legacyUpgrade.track().some(change => change.productId === "hydra" && change.patch.cardPlacement?.laneId === "wired"));

  const beforeInvalid = JSON.stringify(b.portfolio);
  assert.throws(() => b.adapter.applyPatches([{ productId: "mmo", values: { cardPlacement: { laneId: "missing-lane", order: 0 } } }]), /lane/i);
  assert.equal(JSON.stringify(b.portfolio), beforeInvalid, "an invalid incoming placement cannot partially replace the local board");
  b.portfolio.dateLocalEdits = { mmo: { ffsDate: "Local date draft marker" } };
  const invalidCreatedProduct = { ...plain(b.product("mmo")), id: "invalid-create" };
  const mergePlan = globalThis.PortfolioProductMerge.plan(b.product("hydra"), b.product("wired-tail"));
  const invalidOperations = [
    { kind: "create", productId: "invalid-create", categoryId: "mice", laneId: "wireless", fullProduct: invalidCreatedProduct,
      values: { name: "Invalid created product", cardPlacement: { laneId: "missing-lane", order: 0 } } },
    { kind: "merge", productId: "hydra", sourceProductId: "wired-tail", choices: Object.fromEntries(mergePlan.conflicts.map(conflict => [conflict.key, "keeper"])),
      values: { cardPlacement: { laneId: "missing-lane", order: 0 } } },
  ];
  for (const invalid of invalidOperations) {
    const beforeBatch = JSON.stringify(b.portfolio), selectedBefore = b.context.selectedId, revisionBefore = b.context.workspaceSaveRevision;
    assert.throws(() => b.adapter.applyPatches([
      { productId: "mmo", values: { name: "Valid staged update", ffsDate: "2027-01-03" } },
      invalid,
    ]), /lane/i);
    assert.equal(JSON.stringify(b.portfolio), beforeBatch, `a later invalid ${invalid.kind} leaves the complete workspace, date markers and images unchanged`);
    assert.equal(b.context.selectedId, selectedBefore);
    assert.equal(b.context.workspaceSaveRevision, revisionBefore, "a rejected staged batch does not schedule a device save");
  }
  const hydrated = plain(b.product("hydra")); hydrated.laneId = "wired"; hydrated.order = 100;
  b.adapter.applyPatches([{ productId: "hydra", fullProduct: hydrated, values: { cardPlacement: { laneId: "wireless", order: 14 } } }]);
  assert.equal(b.product("hydra").laneId, "wireless"); assert.equal(b.product("hydra").order, 14, "accepted placement overrides stale full-record hydration layout atomically");
  assert.equal(b.product("hydra").imageAssetId, "fixture-image"); assert.equal(b.product("hydra").specs[0].value, "Wireless");
  console.log("Card placement app roundtrip passed: actual Edit Lane and Reorder routes, narrow atomic placement Review, device/package reopen, connected Pull guard, real shared server save/refresh, second workspace, gapped-order and legacy draft preservation, invalid update/create/merge atomic refusal including date markers, retained images/facts and selection.");
} finally {
  for (const workspace of workspaces) clearTimeout(workspace.saveTimer);
  if (server) await new Promise(done => { server.closeAllConnections(); server.close(done); });
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir())); assert(basename(target).startsWith("ppc-card-placement-app-"));
  await rm(target, { recursive: true, force: true });
}
