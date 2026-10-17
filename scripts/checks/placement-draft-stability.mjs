import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../../public/js/reference-theme.js");
await import("../../public/js/portfolio-model.js");
await import("../../public/js/package-codec.js");
await import("../../public/js/master-model.js");
await import("../../public/js/master-client.js");

const model = globalThis.PortfolioMasterModel, clone = value => JSON.parse(JSON.stringify(value));
const appSource = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const catalogSource = await readFile(new URL("../../public/js/catalog-data.js", import.meta.url), "utf8");
const extract = name => {
  const definition = appSource.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"))?.[0];
  assert.ok(definition, `Placement stability requires the actual ${name} function.`); return definition;
};
const functions = [
  "id", "standardColorByKey", "inferStandardColor", "variantGroup", "displayColorVariant", "normalizeColorVariant", "normalizeLayoutVariant", "normalizeVariantGroup",
  "productVariantGroups", "productVariantItems", "productVariantCount", "productColorVariants", "colorVariantById", "colorVariantWithImage", "makeRoadmap", "monthStringFromDate", "monthIndex", "monthString", "addMonths", "normalizeMonth", "categoryDefinition", "normalizeRoadmapStatus", "inferFamily", "defaultRoadmapForProduct", "normalizeProductInfoDate", "normalizeAscmRecord", "normalizeAscmProductMetadata", "normalizePartSku", "ensureBoardSchema", "normalizeCardStatusType", "standardizedStatus", "parseHexColor", "normalizeHexColor",
  "activeCategoryRecord", "updateBoard", "captureProductCardLayout", "restoreProductCardReorder", "startProductReorder", "finishProductReorder", "normalizeLaneOrders", "normalizeOrdersForBoard", "reorderProduct", "applySort", "saveCategorySettings", "localizeSharedProduct",
];
const resetBinding = appSource.match(/^\$\("#resetLayout"\)\.onclick = \(\) => \{[^]*?^\};/m)?.[0];
assert.ok(resetBinding, "Execute the actual Reset layout action.");
const adapterStart = appSource.indexOf("globalThis.PortfolioMasterAdapter = Object.freeze({");
const adapterEnd = appSource.indexOf("\n});", adapterStart) + "\n});".length;
assert.ok(adapterStart > 0 && adapterEnd > adapterStart);

function fixture({ duplicate = false } = {}) {
  const wired = duplicate ? [0, 1, 1, 3, 5, 8] : [...Array.from({ length: 7 }, (_, index) => index), ...Array.from({ length: 10 }, (_, index) => index + 8)];
  const make = (laneId, order, index) => model.applyProductValues({ id: `${laneId}-${index}`, name: `${laneId} ${index}`, laneId, order, price: order + 1, statusType: "none", statusLabel: "", imageAssetId: "retained-hero", specs: [{ id: `spec-${laneId}-${index}`, label: "Synthetic fact", value: "Keep exact (source)", sourceRecord: { preserved: true } }], partSkus: [], variantGroups: [], roadmap: { startMonth: "2026-01", launchMonth: "2026-01", endMonth: "2030-12", status: "launched", family: "Synthetic", confidence: "medium" }, privateFixtureNote: { preserved: [false, null, ""] } }, {});
  return { version: 4, activeCategoryId: "mice", categories: [{ id: "mice", name: "Mice", board: {
    title: "Original title", lanes: ["wired", "wireless", "retired"].map((id, order) => ({ id, label: id, subtitle: "", order })),
    products: [...wired.map((order, index) => make("wired", order, index)), ...[2, 6, 6, 12].map((order, index) => make("wireless", order, index)), ...[0, 4, 4].map((order, index) => make("retired", order, index))],
    settings: { showPrices: true, showSkus: true, roadmap: { categoryLabel: "Synthetic" } },
  } }, { id: "pc-gaming-audio", name: "Background category", board: {
    title: "Unrelated board", lanes: [{ id: "wired", label: "Wired", order: 0 }],
    products: [2, 8].map((order, index) => ({ ...make("wired", order, index), id: `background-${index}`, name: `Unrelated product ${index}` })), settings: {},
  } }], imageAssets: [{ id: "retained-hero", sourceType: "local", packagePath: "images/retained.png" }], masterLocalMerges: [] };
}
function harness(options = {}) {
  const controls = new Map(), notices = [], calls = [], sandbox = {
    window: {}, crypto: globalThis.crypto, PortfolioModel: globalThis.PortfolioModel, PortfolioMasterModel: model,
    PortfolioPackage: globalThis.PortfolioPackage, PortfolioTheme: globalThis.PortfolioTheme,
    UI_FONT_FACE: globalThis.PortfolioTheme.fontFace, PPTXPagination: { paginateRoadmapGroups() { return []; } },
    PLCImporter: { fieldLabels: {}, snapshotDateValues: () => null },
    controls, notices, calls, document: { querySelector: () => null, activeElement: null },
    requestAnimationFrame() { return 1; },
  };
  vm.createContext(sandbox); vm.runInContext(catalogSource, sandbox);
  vm.runInContext(`${appSource.slice(0, appSource.indexOf("const $ ="))}
    let portfolio, board, selectedId, activeCategoryId = "mice", activeView = "products", zoom = 1;
    let productLayoutEditing = false, productReorderSession = null, categorySettingsDraftLanes = [];
    let packageOperationInProgress = false, workspaceOpening = false, roadmapDragState = null, dragState = null, productCardMotion = null, localDateBaseline = null;
    const SAMPLE_ROADMAP = {}, pinnedHeroVariantByProduct = new Map(), productLayoutEditButton = { disabled: false, focus() {} };
    function $(id) { if (!controls.has(id)) controls.set(id, { value: "", focus() {} }); return controls.get(id); }
    function scheduleSave() { calls.push("local-save"); } function syncControls() {} function renderInspector() {} function renderActiveView() {} function renderBoard() {}
    function updateProductLayoutEditControls() {} function stopProductCardDrag() {} function closePopupMenus() {} function closeViewerInfo() {}
    function closeCategorySettings() {} function fitProductLanesVertically() {} function discardProductDrafts() {} function undoDiscardedDraft() {}
    function getCurrentPackageInfo() { return null; } function packageCodec() { return PortfolioPackage; }
    function showWorkspaceNotice(message) { notices.push(message); }
    ${functions.map(extract).join("\n")}
    ${appSource.slice(adapterStart, adapterEnd)}
    ${resetBinding}
    globalThis.integration = {
      load(value) { portfolio = value; board = portfolio.categories[0].board; board = ensureBoardSchema(board, categoryDefinition(activeCategoryId)); },
      state: () => portfolio,
      board: () => board,
      settings(patch = {}, lanes = board.lanes) {
        $("#settingsCategoryName").value = patch.categoryName || portfolio.categories[0].name;
        $("#settingsBoardTitle").value = patch.title || board.title;
        $("#settingsRoadmapLabel").value = patch.roadmapLabel || board.settings.roadmap.categoryLabel;
        categorySettingsDraftLanes = JSON.parse(JSON.stringify(lanes)); saveCategorySettings();
      },
      reset: () => $("#resetLayout").onclick(),
      start: startProductReorder,
      reorder: reorderProduct,
      finish: finishProductReorder,
      sort(mode) { $("#sortMode").value = mode; applySort(); },
    };
  `, sandbox);
  const seed = fixture(options);
  if (options.shuffledTie) for (const category of seed.categories) {
    for (const product of category.board.products) { product.price = 99; product.name = "Equal accepted sort key"; }
    category.board.products.reverse();
  }
  const accepted = clone(model.snapshot(seed).products);
  seed.masterLocalBaseline = clone(accepted); sandbox.integration.load(clone(seed));
  const app = sandbox.integration, adapter = sandbox.PortfolioMasterAdapter;
  let remote = clone(seed), latestCalls = 0, saveCalls = 0;
  const snapshot = () => { const value = model.snapshot(remote); if (options.legacyCapability) delete value.cardPlacementVersion; return value; };
  const session = globalThis.PortfolioMasterClient.createSession({ endpoint: "https://fixture.example/api/master", adapter,
    fetchImpl: async (url, request) => {
      if (url.endsWith("/latest")) { latestCalls++; return Response.json({ snapshot: snapshot() }); }
      assert.ok(url.endsWith("/save")); saveCalls++;
      const body = JSON.parse(request.body), result = model.mergeChanges(remote, body.changes, { requestId: body.requestId, actor: "Synthetic regression", reason: body.reason, now: "2026-10-16T12:00:00.000Z" });
      if (result.conflicts.length) return Response.json({ code: "MASTER_CONFLICT", conflicts: result.conflicts, snapshot: snapshot() }, { status: 409 });
      remote = result.manifest; return Response.json({ snapshot: snapshot(), savedFields: result.savedFields });
    },
  });
  const placements = () => clone(app.board().products.map(({ id, laneId, order }) => ({ id, laneId, order })));
  const facts = () => clone(app.board().products.map(({ laneId, order, manualPosition, ...product }) => product));
  const originalPlacements = placements(), originalFacts = facts(), images = clone(app.state().imageAssets);
  return { app, session, adapter, sandbox, notices, calls, placements, facts, originalPlacements, originalFacts,
    product: id => app.board().products.find(product => product.id === id),
    assertClean(label) { assert.deepEqual(placements(), originalPlacements, `${label}: accepted raw lane/order values are unchanged.`); assert.equal(session.track().length, 0, `${label}: presentation actions create no pending product drafts.`); assert.deepEqual(facts(), originalFacts); assert.deepEqual(clone(app.state().imageAssets), images); },
    connect: () => session.connect({ key: globalThis.PortfolioPackage.generateKey() }),
    counts: () => ({ latestCalls, saveCalls }),
    remote: () => clone(remote),
  };
}

for (const duplicate of [false, true]) {
  for (const action of ["title", "label", "lane-order", "reset", "already-sorted"]) {
    const h = harness({ duplicate }); h.assertClean("Initial actual schema load");
    if (action === "title") h.app.settings({ title: "Only the board title changed" });
    else if (action === "label") h.app.settings({}, h.app.board().lanes.map(lane => ({ ...lane, label: `${lane.label} renamed`, subtitle: "New lane subtitle" })));
    else if (action === "lane-order") h.app.settings({}, [...h.app.board().lanes].reverse());
    else if (action === "already-sorted") h.app.sort("price-asc");
    else h.app.reset();
    h.assertClean(`${duplicate ? "Duplicate" : "Gapped"} accepted positions after ${action}`);
    h.app.load(clone(h.app.state())); h.assertClean(`Reload following ${action}`);
  }
}
for (const duplicate of [false, true]) {
  const h = harness({ duplicate }), sameSlot = duplicate ? 2 : 7;
  h.app.start(); h.app.reorder(`wired-${sameSlot}`, "wired", sameSlot); h.app.finish();
  h.assertClean("An explicit same-slot reorder followed by Done");
}
for (const mode of ["price-asc", "price-desc", "name-asc", "status", "sku-count"]) {
  const h = harness({ duplicate: true, shuffledTie: true });
  const rawIds = h.app.board().products.filter(product => product.laneId === "wired").map(product => product.id);
  const displayedIds = h.app.board().products.filter(product => product.laneId === "wired").sort((left, right) => left.order - right.order).map(product => product.id);
  assert.notDeepEqual(clone(rawIds), clone(displayedIds), "This fixture's raw record array differs from its accepted displayed sequence.");
  h.app.sort(mode);
  h.assertClean(`Equal-key ${mode} sort over shuffled raw records`);
}
for (const duplicate of [false, true]) {
  const h = harness({ duplicate });
  for (const [index, product] of h.app.board().products.entries()) product.manualPosition = { x: index * 23, y: index * 17 };
  const before = clone(h.app.board().products);
  h.app.start(); h.app.reorder("wired-0", "wired", 999); h.app.reorder("wired-1", "wireless", 1);
  assert.ok(h.session.track().length > 0, "An explicit reorder remains a real draft before cancellation.");
  h.app.finish({ cancel: true });
  assert.deepEqual(clone(h.app.board().products), before, "Cancel restores exact raw before-orders, gaps, duplicates and local positions across multiple moves.");
  assert.equal(h.session.track().length, 0);
}
{
  const h = harness(); h.app.start(); h.app.reorder("wired-0", "wired", 999);
  h.product("wired-2").name = "Genuine product edit during reorder";
  h.app.finish({ cancel: true });
  assert.deepEqual(h.placements(), h.originalPlacements);
  assert.deepEqual(h.session.track().map(change => [change.productId, Object.keys(change.patch)]), [["wired-2", ["name"]]], "Canceling placement does not discard a genuine product edit.");
}
{
  const h = harness(); h.app.start(); h.app.reorder("wired-0", "wired", 999);
  for (const product of h.app.board().products.filter(product => product.laneId === "wired")) product.order += 100;
  const concurrent = h.placements(); h.app.finish({ cancel: true });
  assert.deepEqual(h.placements(), concurrent, "Cancel cannot overwrite external numeric placement changes merely because their relative sequence stayed the same.");
  assert.equal(h.notices.length, 1, "A blocked lane rollback surfaces the retained concurrent placement.");
}
{
  const h = harness(), moved = h.app.board().products.filter(product => product.laneId === "retired").map(product => product.id);
  const stationary = h.originalPlacements.filter(product => product.laneId === "wireless");
  const wiredBefore = h.originalPlacements.filter(product => product.laneId === "wired").sort((left, right) => left.order - right.order).map(product => product.id);
  h.app.settings({}, h.app.board().lanes.filter(lane => lane.id !== "retired"));
  assert.deepEqual(h.placements().filter(product => product.laneId === "wireless"), stationary, "Removing a lane leaves unrelated lanes' exact accepted positions intact.");
  const appended = h.placements().filter(product => moved.includes(product.id));
  assert.ok(appended.every(product => product.laneId === "wired"));
  assert.equal(new Set(appended.map(product => product.order)).size, moved.length, "Relocated products receive distinct append orders even when their previous orders duplicated.");
  const wiredAfter = h.placements().filter(product => product.laneId === "wired").sort((left, right) => left.order - right.order);
  assert.deepEqual(wiredAfter.map(product => product.id), [...wiredBefore, ...moved], "Removed-lane products append after the retained destination sequence.");
  assert.deepEqual(wiredAfter.map(product => product.order), Array.from({ length: wiredAfter.length }, (_, index) => index), "The explicitly changed destination lane has valid distinct placement indices for sharing.");
  assert.ok(h.session.track().every(change => h.product(change.productId).laneId === "wired" && Object.keys(change.patch).join() === "cardPlacement"), "Only the explicitly changed destination lane becomes a placement draft.");
  assert.deepEqual(h.facts(), h.originalFacts);
}
{
  const h = harness(); await h.connect(); h.assertClean("Capable shared snapshot");
  h.app.start(); h.app.reorder("wired-0", "wired", 999); h.app.finish();
  assert.ok(h.session.track().length > 0); assert.ok(h.session.track().every(change => Object.keys(change.patch).join() === "cardPlacement"));
  await h.session.save({ reason: "Explicit synthetic reorder" }); await h.session.refresh();
  assert.equal(h.session.track().length, 0, "A genuine explicit reorder saves and refreshes through the actual capable shared model.");
  assert.deepEqual(h.facts(), h.originalFacts); assert.equal(h.counts().saveCalls, 1);
  h.app.load(clone(h.app.state())); assert.equal(h.session.track().length, 0, "Accepted reordered positions stay clean after actual schema reload.");
}
{
  const h = harness(); await h.connect();
  const expected = new Map(h.app.board().lanes.map(lane => [lane.id, h.app.board().products.filter(product => product.laneId === lane.id).sort((left, right) => right.price - left.price).map(product => product.id)]));
  h.app.sort("price-desc");
  const sequence = laneId => h.app.board().products.filter(product => product.laneId === laneId).sort((left, right) => left.order - right.order).map(product => product.id);
  for (const [laneId, ids] of expected) assert.deepEqual(clone(sequence(laneId)), ids, "A changed sort still applies the requested sequence within each lane.");
  assert.ok(h.session.track().length > 0); assert.ok(h.session.track().every(change => Object.keys(change.patch).join() === "cardPlacement"));
  await h.session.save({ reason: "Explicit changed sort" }); await h.session.refresh();
  assert.equal(h.session.track().length, 0);
  for (const [laneId, ids] of expected) assert.deepEqual(clone(sequence(laneId)), ids, "The real shared model preserves the accepted sorted sequence.");
  assert.deepEqual(h.facts(), h.originalFacts);
}
{
  const h = harness({ legacyCapability: true }); await h.connect(); h.assertClean("Older capability snapshot");
  h.app.start(); h.app.reorder("wired-0", "wired", 999); h.app.finish();
  const genuine = h.placements(), pending = clone(h.session.track());
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(h.session.save(), error => error.code === "PLACEMENT_UNAVAILABLE");
  assert.deepEqual(h.placements(), genuine); assert.deepEqual(clone(h.session.track()), pending, "An older service's refusal preserves genuine placement drafts for later sharing.");
  assert.equal(h.counts().saveCalls, 0, "Unsupported placement is rejected locally before sending a save.");
  h.app.load(clone(h.app.state())); assert.deepEqual(h.placements(), genuine); assert.equal(h.session.track().length, pending.length);
}

console.log("Placement draft stability checks passed: actual gapped/duplicate schema loads, title and lane metadata saves, Reset layout, same-slot/already-sorted no-ops, exact reorder cancellation, concurrent-placement protection, narrow lane removal, capable shared reorder/sort roundtrips and preserved drafts on unavailable capability, with zero backend requests.");
