import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const app = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const modelSource = await readFile(new URL("../../public/js/master-model.js", import.meta.url), "utf8");
const mergeSource = await readFile(new URL("../../public/js/product-merge.js", import.meta.url), "utf8");
const functionNames = ["clonePortfolioData", "findPortfolioProductLocation", "localizeSharedProduct", "mergeProductEntries", "canMergeProducts", "updateDraftViews", "applyProductMergeDraft", "restoreMergeDraft", "undoProductMergeDraft", "discardProductDrafts", "undoDiscardedDraft"];
const actual = functionNames.map((name) => {
  const found = app.match(new RegExp(`^function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(found, `app.js must define ${name}`); return found[0];
}).join("\n");
const adapterSource = app.match(/^globalThis\.PortfolioMasterAdapter = Object\.freeze\(\{[^]*?^\}\);/m)?.[0];
assert.ok(adapterSource, "the actual shared update adapter must be exercised");
const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const keeper = { id: "keeper", name: "Cloud Alpha", laneId: "wired", order: 0, price: 149, imageAssetId: "", featuredVariantId: "keeper-black", specs: [{ id: "spec-weight", label: "Weight", value: "200 g" }], partSkus: [{ id: "part-keeper", code: "HP-A", variantId: "keeper-black" }], variantGroups: [{ id: "group-keeper", type: "color", label: "Color", items: [{ id: "keeper-black", code: "BK", colorKey: "black", colorName: "Black", colorHex: "#111111", imageAssetId: "image-black" }] }], roadmap: { startMonth: "2027-03", launchMonth: "2027-03", endMonth: "2029-01", family: "Cloud", predecessorId: "source" }, custom: { keeperDetail: "Kept" }, ascm: { basePartNumbers: ["HP-A"], records: [{ basePartNumber: "HP-A", supplier: "Factory A" }] } };
  const source = { id: "source", name: "Cloud Alpha", laneId: "wired", order: 1, imageAssetId: "image-main", specs: [{ id: "spec-battery", label: "Battery", value: "100 hours", rawNote: "Source metadata" }], partSkus: [{ id: "part-source", code: "HP-B", variantId: "source-color", rawCode: "Imported part" }], variantGroups: [{ id: "group-source", type: "color", label: "Color", items: [{ id: "source-color", code: "BK", colorKey: "black", colorName: "Black", colorHex: "#111111", colorKey2: "red", colorName2: "Red", colorHex2: "#ff0000", imageAssetId: "image-two-tone", custom: "Variant metadata" }] }], generalAvailabilityDate: "2027-03-01", ffsDate: "2027-02-20", roadmap: { startMonth: "2027-03", launchMonth: "2027-03", endMonth: "2029-01", successorId: "keeper" }, custom: { sourceDetail: "Filled" }, ascm: { basePartNumbers: ["HP-B"], records: [{ basePartNumber: "HP-B", supplier: "Factory B" }] } };
  return { activeCategoryId: "pc", imageAssets: [{ id: "image-main" }, { id: "image-black" }, { id: "image-two-tone" }], categories: [
    { id: "pc", name: "PC Gaming Audio", board: { lanes: [{ id: "wired", label: "Wired" }], products: [keeper, source, { id: "related", name: "Related headset", laneId: "wired", order: 2, specs: [], partSkus: [], variantGroups: [], roadmap: { predecessorId: "source", successorId: "source", notes: "Original note" } }] } },
    { id: "console", name: "Console Gaming Audio", board: { lanes: [{ id: "console-lane", label: "Headsets" }], products: [{ id: "other-category", name: "Cloud Alpha", laneId: "console-lane", order: 0, specs: [], partSkus: [], variantGroups: [], roadmap: { predecessorId: "source" }, custom: { unrelated: "Keep" } }] } },
  ] };
}

function harness(initial = fixture()) {
  const calls = { saves: 0, renders: 0, notices: [], reviewRequests: [], conflictReviews: [], rebases: [], mergeDialogs: [], workspaceNotices: [] };
  let nextId = 0;
  const session = { getState: () => ({ busy: sandbox.busy === true }),
    async reviewMerge(productId, sourceProductId) { calls.reviewRequests.push({ productId, sourceProductId }); if (sandbox.reviewFailure) throw new Error("Private review failure"); return sandbox.latestMergeReview; },
    rebaseMergeReview(review) { calls.rebases.push({ review: clone(review), portfolio: clone(sandbox.portfolio) }); },
  };
  const sandbox = { TextEncoder, packageOperationInProgress: false, roadmapDragState: null, activeCategoryId: initial.activeCategoryId, selectedId: "keeper", document: { querySelector: () => null },
    id: () => `draft-${++nextId}`, scheduleSave: () => { calls.saves += 1; }, syncControls() {}, renderInspector() {}, renderActiveView: () => { calls.renders += 1; },
    packageCodec: () => ({ normalizePackageInfo: (value) => value }), getCurrentPackageInfo: () => null,
    makeProduct: (id, name, price, laneId, order) => ({ id, name, price, laneId, order, specs: [], partSkus: [], variantGroups: [], roadmap: {} }),
    PortfolioMasterUI: { getSession: () => session, async reviewConflicts(conflicts) { calls.conflictReviews.push(clone(conflicts)); return sandbox.conflictChoice === "cancel" ? null : Object.fromEntries(conflicts.map((conflict) => [conflict.key, sandbox.conflictChoice || "mine"])); } },
    PortfolioNotifications: { publish: (notice) => { calls.notices.push(notice); }, resolve() {} },
    PortfolioProductMergeUI: { open: (options) => { calls.mergeDialogs.push({ options: clone(options), portfolio: clone(sandbox.portfolio) }); } },
    showWorkspaceNotice: async (message) => { calls.workspaceNotices.push(message); },
    activateCategory(categoryId) { sandbox.activeCategoryId = categoryId; sandbox.portfolio.activeCategoryId = categoryId; sandbox.board = sandbox.portfolio.categories.find((category) => category.id === categoryId).board; },
  };
  vm.createContext(sandbox);
  new vm.Script(modelSource).runInContext(sandbox); new vm.Script(mergeSource).runInContext(sandbox);
  new vm.Script(`var portfolio = JSON.parse(${JSON.stringify(JSON.stringify(initial))}); var board = portfolio.categories.find((category) => category.id === activeCategoryId).board; const discardedDrafts = new Map(); ${actual}\n${adapterSource}`).runInContext(sandbox);
  new vm.Script("portfolio.masterLocalBaseline = PortfolioMasterModel.snapshot(portfolio).products;").runInContext(sandbox);
  const run = (code) => new vm.Script(code).runInContext(sandbox);
  return { sandbox, calls, run, get portfolio() { return clone(sandbox.portfolio); }, get adapter() { return sandbox.PortfolioMasterAdapter; }, product: (id) => clone(run(`findPortfolioProductLocation(portfolio, ${JSON.stringify(id)})?.product || null`)), setReview(manifest, revisions = {}) {
    run(`var latestManifest = JSON.parse(${JSON.stringify(JSON.stringify(manifest))}); var latestSnapshot = PortfolioMasterModel.snapshot(latestManifest); var changedRevisions = JSON.parse(${JSON.stringify(JSON.stringify(revisions))}); for (const item of latestSnapshot.products) if (changedRevisions[item.productId]) item.revisions = changedRevisions[item.productId]; var latestMergeReview = { snapshot: latestSnapshot, products: latestManifest.categories.flatMap((category) => category.board.products.filter((product) => ["keeper", "source"].includes(product.id)).map((product) => ({ product, categoryId: category.id, laneId: product.laneId }))) };`);
  }, async rereview() {
    sandbox.PortfolioMasterAdapter.onMergeReviewRequired({ code: "MERGE_REVIEW_REQUIRED", conflicts: [{ kind: "merge", productId: "keeper" }] });
    await calls.notices.at(-1).actions[0].onClick();
  }, merge() {
    return run(`(() => { const keeper = findPortfolioProductLocation(portfolio, "keeper").product, source = findPortfolioProductLocation(portfolio, "source").product, plan = PortfolioProductMerge.plan(keeper, source); return applyProductMergeDraft({ productId: "keeper", sourceProductId: "source", keeperOriginal: JSON.parse(JSON.stringify(keeper)), sourceOriginal: JSON.parse(JSON.stringify(source)), choices: Object.fromEntries(plan.conflicts.map((conflict) => [conflict.key, "keeper"])) }); })()`);
  } };
}

const untouched = harness();
const untouchedBefore = untouched.portfolio;
assert.equal(untouched.run('canMergeProducts("keeper", "keeper").allowed'), false);
assert.equal(untouched.run('canMergeProducts("keeper", "other-category").allowed'), false, "the same product in PC and Console is a legitimate separate listing");
assert.equal(untouched.run('canMergeProducts("keeper", "source").allowed'), true);
assert.deepEqual(untouched.portfolio, untouchedBefore, "opening/checking a merge has no draft effect");
untouched.sandbox.busy = true; assert.equal(untouched.run('canMergeProducts("keeper", "source").allowed'), false);
untouched.sandbox.busy = false; untouched.sandbox.packageOperationInProgress = true; assert.equal(untouched.run('canMergeProducts("keeper", "source").allowed'), false);

const stale = harness();
stale.run('var originalKeeper = JSON.parse(JSON.stringify(findPortfolioProductLocation(portfolio, "keeper").product)); findPortfolioProductLocation(portfolio, "keeper").product.codename = "New edit";');
const staleBefore = stale.portfolio;
assert.throws(() => stale.run('applyProductMergeDraft({ productId: "keeper", sourceProductId: "source", keeperOriginal: originalKeeper, choices: {} })'), /changed while you were reviewing/);
assert.deepEqual(stale.portfolio, staleBefore, "a stale merge preview never mutates products or images");
assert.throws(() => stale.run('applyProductMergeDraft({ productId: "keeper", sourceProductId: "other-category", choices: {} })'), /same portfolio/);
assert.deepEqual(stale.portfolio, staleBefore);

const merged = harness(); const beforeMerge = merged.portfolio; const mergeResult = merged.merge(); const complete = merged.product("keeper");
assert.equal(merged.product("source"), null);
assert.equal(complete.id, "keeper"); assert.equal(complete.order, 0); assert.equal(complete.laneId, "wired");
assert.equal(complete.imageAssetId, "image-main");
assert.equal(complete.variantGroups.flatMap((group) => group.items).length, 2, "BK and BK/RD remain distinct colorways");
assert.equal(complete.variantGroups.flatMap((group) => group.items).find((row) => row.id === "source-color").imageAssetId, "image-two-tone");
assert.equal(complete.specs.find((row) => row.label === "Battery").rawNote, "Source metadata");
assert.equal(complete.partSkus.find((row) => row.code === "HP-B").rawCode, "Imported part");
assert.deepEqual(complete.custom, { keeperDetail: "Kept", sourceDetail: "Filled" });
assert.equal(complete.ascm.records.length, 2); assert.equal(complete.generalAvailabilityDate, "2027-03-01");
assert.equal(complete.roadmap.predecessorId || "", ""); assert.equal(complete.roadmap.successorId || "", "", "the completed product never references itself or its removed donor");
assert.equal(merged.product("related").roadmap.predecessorId, "keeper");
assert.equal(merged.product("other-category").roadmap.predecessorId, "keeper", "relationships are redirected across the complete portfolio");
assert.equal(merged.portfolio.masterLocalMerges.length, 1);
assert.equal(merged.portfolio.masterLocalRemovedProducts.source.imageAssetId, "image-main");
assert.equal(merged.run('canMergeProducts("keeper", "related").allowed'), false, "a product in an unsaved merge cannot enter a second merge");
assert.equal(merged.run(`undoProductMergeDraft(${JSON.stringify(mergeResult.undoId)})`), true);
assert.deepEqual(merged.product("keeper"), beforeMerge.categories[0].board.products[0]);
assert.deepEqual(merged.product("source"), beforeMerge.categories[0].board.products[1]);
assert.equal(merged.product("related").roadmap.predecessorId, "source");

const editedMerge = harness(); const editedResult = editedMerge.merge(); editedMerge.run('findPortfolioProductLocation(portfolio, "keeper").product.codename = "Later edit";');
const editedBeforeUndo = editedMerge.portfolio;
assert.equal(editedMerge.run(`undoProductMergeDraft(${JSON.stringify(editedResult.undoId)})`), false, "Undo cannot silently erase edits made after a merge");
assert.deepEqual(editedMerge.portfolio, editedBeforeUndo);

const relatedEdit = harness(); const relatedResult = relatedEdit.merge();
relatedEdit.run('findPortfolioProductLocation(portfolio, "related").product.roadmap.notes = "A later unrelated note"; findPortfolioProductLocation(portfolio, "other-category").product.roadmap.predecessorId = "someone-else";');
assert.equal(relatedEdit.run(`undoProductMergeDraft(${JSON.stringify(relatedResult.undoId)})`), true);
assert.equal(relatedEdit.product("related").roadmap.notes, "A later unrelated note", "Undo preserves unrelated roadmap edits");
assert.equal(relatedEdit.product("related").roadmap.predecessorId, "source", "Undo restores a redirected field independently of unrelated notes");
assert.equal(relatedEdit.product("other-category").roadmap.predecessorId, "someone-else", "Undo preserves an explicitly edited relationship");

const single = harness(); single.run('findPortfolioProductLocation(portfolio, "keeper").product.codename = "Accidental"; findPortfolioProductLocation(portfolio, "related").product.codename = "Keep this edit";');
const singleResult = single.run('discardProductDrafts(["keeper"])');
assert.equal(single.product("keeper").codename || "", ""); assert.equal(single.product("related").codename, "Keep this edit");
assert.equal(single.product("keeper").variantGroups[0].items[0].imageAssetId, "image-black", "discarding fields preserves existing images");
assert.equal(single.run(`undoDiscardedDraft(${JSON.stringify(singleResult.undoId)})`), true);
assert.equal(single.product("keeper").codename, "Accidental");

const mixed = harness(); mixed.run('portfolio.masterLocalRemovedProducts = { source: JSON.parse(JSON.stringify(findPortfolioProductLocation(portfolio, "source").product)) }; portfolio.categories[0].board.products = portfolio.categories[0].board.products.filter((product) => product.id !== "source"); findPortfolioProductLocation(portfolio, "keeper").product.codename = "Accidental"; portfolio.categories[0].board.products.push({id: "new", name: "New local product", laneId: "wired", order: 3, specs: [], partSkus: [], variantGroups: [], roadmap: {}});');
const mixedBefore = mixed.portfolio; const mixedResult = mixed.run('discardProductDrafts(["keeper", "source", "new"])');
assert.equal(mixedResult.discarded, 3); assert.equal(mixed.product("new"), null); assert.equal(mixed.product("keeper").codename || "", "");
assert.equal(mixed.product("source").imageAssetId, "image-main", "discarding deletion restores the complete original product");
assert.equal(mixed.run(`undoDiscardedDraft(${JSON.stringify(mixedResult.undoId)})`), true);
assert.deepEqual(mixed.portfolio, mixedBefore, "Undo restores the entire mixed create/update/delete draft");

const mergedDiscard = harness(); mergedDiscard.merge(); mergedDiscard.run('findPortfolioProductLocation(portfolio, "related").product.codename = "Keep unrelated edit";');
const mergeDiscardResult = mergedDiscard.run('discardProductDrafts(["keeper"])');
assert.equal(mergedDiscard.portfolio.masterLocalMerges.length, 0); assert.ok(mergedDiscard.product("source"));
assert.equal(mergedDiscard.product("related").codename, "Keep unrelated edit");
assert.equal(mergedDiscard.product("related").roadmap.predecessorId, "source");
assert.equal(mergedDiscard.product("keeper").specs.length, 1, "discarding either side reverts the entire atomic merge");
mergedDiscard.run('findPortfolioProductLocation(portfolio, "related").product.codename = "A newer edit";');
assert.equal(mergedDiscard.run(`undoDiscardedDraft(${JSON.stringify(mergeDiscardResult.undoId)})`), false, "an older discard cannot overwrite new edits");

const failedDiscard = harness(); failedDiscard.run('portfolio.categories[0].board.products = portfolio.categories[0].board.products.filter((product) => product.id !== "source"); findPortfolioProductLocation(portfolio, "keeper").product.codename = "Keep accidental edit for now";');
const failedBefore = failedDiscard.portfolio;
assert.throws(() => failedDiscard.run('discardProductDrafts(["keeper", "source"])'), /original product is unavailable/);
assert.deepEqual(failedDiscard.portfolio, failedBefore, "an incomplete restore aborts the whole discard batch");

const remote = harness();
remote.run('var mergePlan = PortfolioProductMerge.plan(findPortfolioProductLocation(portfolio, "keeper").product, findPortfolioProductLocation(portfolio, "source").product); var mergeChoices = Object.fromEntries(mergePlan.conflicts.map((conflict) => [conflict.key, "keeper"])); var mergedValues = PortfolioMasterModel.values(PortfolioProductMerge.resolve(mergePlan, mergeChoices)); PortfolioMasterAdapter.applyPatches([{kind: "merge", productId: "keeper", sourceProductId: "source", choices: mergeChoices, values: mergedValues}]);');
assert.equal(remote.product("source"), null); assert.equal(remote.product("keeper").imageAssetId, "image-main");
assert.equal(remote.product("keeper").specs.find((row) => row.label === "Battery").rawNote, "Source metadata", "remote accepted merges preserve local complete metadata and assets");
const remoteAtomic = harness(); const remoteBefore = remoteAtomic.portfolio;
assert.throws(() => remoteAtomic.run('var mergePlan = PortfolioProductMerge.plan(findPortfolioProductLocation(portfolio, "keeper").product, findPortfolioProductLocation(portfolio, "source").product); var mergeChoices = Object.fromEntries(mergePlan.conflicts.map((conflict) => [conflict.key, "keeper"])); var mergedValues = PortfolioMasterModel.values(PortfolioProductMerge.resolve(mergePlan, mergeChoices)); PortfolioMasterAdapter.applyPatches([{kind: "merge", productId: "keeper", sourceProductId: "source", choices: mergeChoices, values: mergedValues}, {kind: "create", productId: "invalid", categoryId: "missing", laneId: "wired", values: mergedValues}]);'), /portfolio or lane has changed/);
assert.deepEqual(remoteAtomic.portfolio, remoteBefore, "a later invalid patch cannot leave a partially applied merge");

const hydrated = harness();
hydrated.run('portfolio.masterLocalAssetIds = { "image-main": "local-main", "image-black": "local-black", "image-two-tone": "local-two-tone" }; var completeShared = PortfolioProductMerge.resolve(PortfolioProductMerge.plan(findPortfolioProductLocation(portfolio, "keeper").product, findPortfolioProductLocation(portfolio, "source").product), {}); completeShared.categoryId = "pc"; completeShared.imageAssetId = "image-main"; completeShared.order = 99; completeShared.laneId = "different-shared-lane"; var sharedBefore = JSON.stringify(completeShared); var localCopy = localizeSharedProduct(completeShared);');
assert.equal(hydrated.run('localCopy.imageAssetId'), "local-main");
assert.equal(hydrated.run('localCopy.variantGroups.flatMap((group) => group.items).find((row) => row.id === "source-color").imageAssetId'), "local-two-tone");
assert.equal(hydrated.run('Object.hasOwn(localCopy, "categoryId")'), false);
assert.equal(hydrated.run('JSON.stringify(completeShared) === sharedBefore'), true, "hydrating complete metadata never mutates the incoming shared record");
hydrated.run('PortfolioMasterAdapter.applyPatches([{productId: "keeper", values: PortfolioMasterModel.values(completeShared), fullProduct: completeShared}]);');
assert.equal(hydrated.product("keeper").imageAssetId, "local-main");
assert.equal(hydrated.product("keeper").variantGroups.flatMap((group) => group.items).find((row) => row.id === "source-color").imageAssetId, "local-two-tone");
assert.equal(hydrated.product("keeper").custom.sourceDetail, "Filled");
assert.equal(hydrated.product("keeper").ascm.records.length, 2);
assert.equal(hydrated.product("keeper").order, 0); assert.equal(hydrated.product("keeper").laneId, "wired", "receiving complete metadata preserves local placement");
const serialized = clone(hydrated.adapter.serializeNewProduct(hydrated.product("keeper")));
assert.equal(serialized.imageAssetId, "image-main");
assert.equal(serialized.variantGroups.flatMap((group) => group.items).find((row) => row.id === "source-color").imageAssetId, "image-two-tone", "new local records serialize asset aliases back to accepted IDs");
hydrated.run('completeShared.id = "hydrated-new"; PortfolioMasterAdapter.applyPatches([{kind: "create", productId: "hydrated-new", categoryId: "pc", laneId: "wired", values: PortfolioMasterModel.values(completeShared), fullProduct: completeShared}]);');
assert.equal(hydrated.product("hydrated-new").imageAssetId, "local-main");
assert.equal(hydrated.product("hydrated-new").specs.find((row) => row.label === "Battery").rawNote, "Source metadata", "creation from a full record retains fields outside shared facts");

const reviewNotice = harness(); reviewNotice.merge();
reviewNotice.adapter.onMergeReviewRequired({ code: "MERGE_REVIEW_REQUIRED", message: "GitHub archivedProduct publisherSecret private-file-location", conflicts: [{ kind: "merge", productId: "keeper" }] });
assert.equal(reviewNotice.calls.notices.length, 1);
assert.doesNotMatch(`${reviewNotice.calls.notices[0].title} ${reviewNotice.calls.notices[0].message}`, /GitHub|archivedProduct|publisherSecret|private-file-location|master/i, "a stale merge notification does not expose archive or service details");
assert.match(reviewNotice.calls.notices[0].message, /Your draft is safe/);

const supplementingReview = harness();
supplementingReview.run('findPortfolioProductLocation(portfolio, "keeper").product.specs.push({ id: "local-extra", label: "Microphone", value: "Cardioid", rawSource: "Local report" }); findPortfolioProductLocation(portfolio, "source").product.specs.push({ id: "local-source-extra", label: "Latency", value: "20 ms", rawSource: "Other local report" });');
supplementingReview.merge();
const acceptedAdditions = fixture();
acceptedAdditions.categories[0].board.products[0].specs.push({ id: "peer-extra", label: "Connector", value: "USB", rawSource: "Peer report" });
acceptedAdditions.categories[0].board.products[1].specs.push({ id: "peer-source-extra", label: "Cable", value: "2 m", rawSource: "Other peer report" });
supplementingReview.setReview(acceptedAdditions, { keeper: { "specs/peer-extra": 2 }, source: { "specs/peer-source-extra": 3 } });
await supplementingReview.rereview();
assert.equal(supplementingReview.calls.conflictReviews.length, 0, "different spec additions are combined automatically during rereview");
assert.equal(supplementingReview.product("keeper").specs.find((row) => row.id === "local-extra").rawSource, "Local report");
assert.equal(supplementingReview.product("keeper").specs.find((row) => row.id === "peer-extra").rawSource, "Peer report");
assert.equal(supplementingReview.product("source").specs.find((row) => row.id === "local-source-extra").rawSource, "Other local report");
assert.equal(supplementingReview.product("source").specs.find((row) => row.id === "peer-source-extra").rawSource, "Other peer report");
assert.equal(supplementingReview.calls.rebases.length, 1); assert.equal(supplementingReview.calls.mergeDialogs.length, 1);
assert.deepEqual(supplementingReview.calls.mergeDialogs[0].options, { productId: "keeper", sourceProductId: "source" });
const refreshedKeeperBaseline = supplementingReview.portfolio.masterLocalBaseline.find((entry) => entry.productId === "keeper");
assert.ok(refreshedKeeperBaseline.values.specs.some((row) => row.id === "peer-extra"));
assert.ok(!refreshedKeeperBaseline.values.specs.some((row) => row.id === "local-extra"), "rebasing keeps unsaved local additions as draft edits against the accepted baseline");
assert.equal(supplementingReview.portfolio.masterLocalMerges.length, 0, "the old merge is undone before opening a fresh review");

const cancelRereview = harness();
cancelRereview.run('findPortfolioProductLocation(portfolio, "keeper").product.specs.find((row) => row.id === "spec-weight").value = "220 g";');
cancelRereview.merge();
const peerWeight = fixture(); peerWeight.categories[0].board.products[0].specs[0].value = "230 g";
cancelRereview.setReview(peerWeight, { keeper: { "specs/spec-weight/value": 7 } }); cancelRereview.sandbox.conflictChoice = "cancel";
const mergedDraftBeforeCancel = cancelRereview.portfolio;
await cancelRereview.rereview();
assert.equal(cancelRereview.calls.conflictReviews.length, 1);
assert.equal(cancelRereview.calls.conflictReviews[0].length, 1);
assert.equal(cancelRereview.calls.conflictReviews[0][0].mine, "220 g"); assert.equal(cancelRereview.calls.conflictReviews[0][0].master, "230 g");
assert.deepEqual(cancelRereview.portfolio, mergedDraftBeforeCancel, "cancelling concurrent field review preserves the exact pending merged draft and both original records");
assert.equal(cancelRereview.calls.rebases.length, 0); assert.equal(cancelRereview.calls.mergeDialogs.length, 0);

for (const [choice, expectedWeight] of [["mine", "220 g"], ["master", "230 g"]]) {
  const chosenReview = harness();
  chosenReview.run('findPortfolioProductLocation(portfolio, "keeper").product.specs.find((row) => row.id === "spec-weight").value = "220 g"; findPortfolioProductLocation(portfolio, "keeper").product.specs.push({ id: "local-other", label: "Microphone", value: "Cardioid" });');
  chosenReview.merge(); chosenReview.setReview(peerWeight, { keeper: { "specs/spec-weight/value": 7 } }); chosenReview.sandbox.conflictChoice = choice;
  await chosenReview.rereview();
  assert.equal(chosenReview.product("keeper").specs.find((row) => row.id === "spec-weight").value, expectedWeight, `explicit ${choice} choice is honored`);
  assert.equal(chosenReview.product("keeper").specs.find((row) => row.id === "local-other").value, "Cardioid", "an unrelated local addition survives either final-value choice");
  assert.equal(chosenReview.calls.rebases[0].portfolio.categories[0].board.products.find((product) => product.id === "keeper").specs.find((row) => row.id === "spec-weight").value, expectedWeight, "the chosen value is applied before rebasing the session");
  assert.equal(chosenReview.calls.mergeDialogs[0].portfolio.categories[0].board.products.find((product) => product.id === "keeper").specs.find((row) => row.id === "spec-weight").value, expectedWeight, "the fresh merge opens with the explicitly chosen value");
  assert.equal(chosenReview.portfolio.masterLocalBaseline.find((entry) => entry.productId === "keeper").revisions["specs/spec-weight/value"], 7);
}

const metadataCancelled = harness();
metadataCancelled.run('findPortfolioProductLocation(portfolio, "keeper").product.custom.keeperDetail = "Local metadata edit"; findPortfolioProductLocation(portfolio, "keeper").product.imageAssetId = "image-black";');
metadataCancelled.merge();
const acceptedMetadata = fixture(); acceptedMetadata.categories[0].board.products[0].custom.keeperDetail = "Accepted metadata edit"; acceptedMetadata.categories[0].board.products[0].imageAssetId = "image-two-tone";
metadataCancelled.setReview(acceptedMetadata); metadataCancelled.sandbox.conflictChoice = "cancel";
const metadataDraftBeforeCancel = metadataCancelled.portfolio; await metadataCancelled.rereview();
assert.equal(metadataCancelled.calls.conflictReviews.length, 1, "competing metadata and images receive the same explicit value review as shared facts");
assert.ok(metadataCancelled.calls.conflictReviews[0].some((conflict) => conflict.mineImageId === "image-black" && conflict.masterImageId === "image-two-tone"));
assert.ok(metadataCancelled.calls.conflictReviews[0].some((conflict) => conflict.mine === "Local metadata edit" && conflict.master === "Accepted metadata edit"));
assert.deepEqual(metadataCancelled.portfolio, metadataDraftBeforeCancel, "cancelling image/metadata conflicts preserves the exact pending merged draft");
assert.equal(metadataCancelled.calls.rebases.length, 0); assert.equal(metadataCancelled.calls.mergeDialogs.length, 0);

for (const [choice, expectedImage, expectedMetadata] of [["mine", "image-black", "Local metadata edit"], ["master", "image-two-tone", "Accepted metadata edit"]]) {
  const metadataChosen = harness();
  metadataChosen.run('findPortfolioProductLocation(portfolio, "keeper").product.custom.keeperDetail = "Local metadata edit"; findPortfolioProductLocation(portfolio, "keeper").product.imageAssetId = "image-black";');
  metadataChosen.merge(); metadataChosen.setReview(acceptedMetadata); metadataChosen.sandbox.conflictChoice = choice;
  await metadataChosen.rereview();
  assert.equal(metadataChosen.product("keeper").imageAssetId, expectedImage);
  assert.equal(metadataChosen.product("keeper").custom.keeperDetail, expectedMetadata);
  assert.equal(metadataChosen.calls.rebases[0].portfolio.categories[0].board.products.find((product) => product.id === "keeper").imageAssetId, expectedImage, "the explicitly selected image is applied before session rebase");
  assert.equal(metadataChosen.calls.mergeDialogs[0].portfolio.categories[0].board.products.find((product) => product.id === "keeper").custom.keeperDetail, expectedMetadata, "the fresh merge review receives the chosen metadata");
  assert.equal(Object.hasOwn(metadataChosen.product("keeper"), "categoryId"), false, "temporary restore placement metadata does not enter a product record");
}

const unavailableReview = harness(); unavailableReview.merge(); unavailableReview.sandbox.reviewFailure = true;
const unavailableDraft = unavailableReview.portfolio; await unavailableReview.rereview();
assert.deepEqual(unavailableReview.portfolio, unavailableDraft); assert.equal(unavailableReview.calls.mergeDialogs.length, 0);
assert.doesNotMatch(unavailableReview.calls.workspaceNotices[0], /Private review failure/);

const removedReview = harness(); removedReview.merge(); const sourceRemoved = fixture(); sourceRemoved.categories[0].board.products = sourceRemoved.categories[0].board.products.filter((product) => product.id !== "source");
removedReview.setReview(sourceRemoved); const beforeRemovedReview = removedReview.portfolio; await removedReview.rereview();
assert.deepEqual(removedReview.portfolio, beforeRemovedReview, "an accepted deletion keeps the existing merge draft until the user explicitly discards it");
assert.match(removedReview.calls.workspaceNotices[0], /One of these products was removed/);
assert.equal(removedReview.calls.rebases.length, 0); assert.equal(removedReview.calls.mergeDialogs.length, 0);
console.log("Product merge workspace checks passed: guards, complete metadata/assets, safe merge/discard Undo, atomic updates, alias hydration, private notices, rereview supplemental additions, explicit shared/image/metadata choices, exact cancellation preservation and unavailable/removed-product safety.");
