import assert from "node:assert/strict";
await import("../../public/js/master-model.js");
const model = globalThis.PortfolioMasterModel;
const copy = (value) => structuredClone(value);

const product = {
  id: "p1", name: "Cloud Team", codename: "Together", price: 99.99, priceLabel: "$99.99", tier: "Premium", statusType: "new", statusLabel: "New product", variantLabel: "PC",
  generalAvailabilityDate: "2026-03-20", ffsDate: "2026-02-18", endManufacturingDate: "2028-12-10", globalAnnouncementDate: "2026-03-01", webReadinessDate: "2026-03-10", finalAssetsDate: "2026-02-20",
  roadmap: { startMonth: "2026-03", launchMonth: "2026-03", endMonth: "2028-12", family: "Cloud", status: "in-development", confidence: "high", notes: "Keep local notes" },
  imageAssetId: "local-main", featuredVariantId: "black", laneId: "lane-local", manualMetadata: "Keep product extras",
  specs: [{ id: "connection", label: "Connection", value: "USB", manualNote: "Keep spec extras" }, { id: "driver", label: "Driver", value: "53 mm" }],
  partSkus: [{ id: "sku1", code: "HP001", variantId: "black", manualNote: "Keep part extras" }],
  variantGroups: [{ id: "colors", type: "color", label: "COLOR SKU", customSetting: true, items: [{ id: "black", code: "BK", colorKey: "black", colorName: "Black", colorHex: "#111111", imageAssetId: "local-black" }] }],
};
const manifest = { version: 2, packageInfo: { id: "package-one" }, categories: [{ id: "audio", board: { products: [product], lanes: [{ id: "lane-local" }] } }], imageAssets: [{ id: "local-main" }, { id: "local-black" }] };
const before = copy(manifest);
const base = model.values(product);
const change = (patch, values = base, revisions = {}) => ({ productId: "p1", base: values, baseRevisions: revisions, patch });
const save = (current, patch, values = base, revisions = {}) => model.mergeChanges(current, [change(patch, values, revisions)], { actor: "Alex", team: "Operations", reason: "Factory update", now: "2026-10-07T17:00:00Z", requestId: "request-one" });
const savedProduct = (result) => result.manifest.categories[0].board.products[0];

assert.equal(base.imageAssetId, undefined);
assert.equal(base.variantGroups[0].items[0].imageAssetId, undefined);
assert.equal(base.specs[0].manualNote, undefined);
assert.equal(base.startMonth, "2026-03");
assert.equal(base.roadmapFamily, "Cloud");
assert.equal(model.snapshot(manifest).products[0].productName, "Cloud Team");

const launch = save(manifest, { generalAvailabilityDate: "2026-07-31" });
assert.equal(launch.savedFields, 1, "launch date/month must save as one logical unit");
assert.equal(savedProduct(launch).generalAvailabilityDate, "2026-07-31");
assert.equal(savedProduct(launch).roadmap.startMonth, "2026-07");
assert.equal(savedProduct(launch).roadmap.launchMonth, "2026-07");
assert.equal(launch.history[0].path, "@launch");
assert.equal(launch.history[0].requestId, "request-one");
assert.deepEqual(manifest, before, "merging must never mutate the original master");

const tbd = save(manifest, { generalAvailabilityDate: "TBD", startMonth: "2026-09" });
assert.equal(savedProduct(tbd).generalAvailabilityDate, "");
assert.equal(savedProduct(tbd).roadmap.startMonth, "2026-03", "clearing the exact day must retain the prior planning month");
const moveMonth = save(manifest, { startMonth: "2026-06" });
assert.equal(savedProduct(moveMonth).generalAvailabilityDate, "2026-06-20");
assert.equal(savedProduct(moveMonth).roadmap.startMonth, "2026-06");
const january = model.patchValues(base, { generalAvailabilityDate: "2027-01-31" });
assert.equal(model.patchValues(january, { startMonth: "2027-02" }).generalAvailabilityDate, "2027-02-28", "month-only edits must preserve/clamp the known day");
assert.equal(model.patchValues(base, { endManufacturingDate: "" }).endMonth, "2028-12");

for (const field of model.DATE_FIELDS) {
  assert.throws(() => save(manifest, { [field]: "2026-02-30" }), /real calendar date/);
  assert.throws(() => save(manifest, { [field]: "10/07/2026" }), /YYYY-MM-DD/);
}
assert.throws(() => save(manifest, { startMonth: "2026-13" }), /YYYY-MM/);
assert.throws(() => save(manifest, { generalAvailabilityDate: "2029-01-01" }), /on or after launch/);
assert.throws(() => save(manifest, { price: -1 }), /non-negative/);
assert.throws(() => save(manifest, { imageAssetId: "remote-image" }), /Unsupported shared field/);

const allMilestones = save(manifest, { ffsDate: "2026-02-19", globalAnnouncementDate: "2026-03-02", webReadinessDate: "2026-03-11", finalAssetsDate: "2026-02-21" });
assert.equal(allMilestones.savedFields, 4);
assert.equal(savedProduct(allMilestones).imageAssetId, product.imageAssetId);
assert.equal(savedProduct(allMilestones).roadmap.notes, product.roadmap.notes);
assert.equal(savedProduct(allMilestones).laneId, product.laneId);
assert.deepEqual(allMilestones.manifest.imageAssets, manifest.imageAssets);

const masterSpec = save(manifest, { specs: base.specs.map((row) => row.id === "connection" ? { ...row, value: "USB-C" } : row) });
const localSpec = base.specs.map((row) => row.id === "driver" ? { ...row, value: "55 mm" } : row);
const combinedSpecs = save(masterSpec.manifest, { specs: localSpec });
assert.equal(combinedSpecs.conflicts.length, 0);
assert.equal(savedProduct(combinedSpecs).specs[0].value, "USB-C");
assert.equal(savedProduct(combinedSpecs).specs[1].value, "55 mm");
assert.equal(savedProduct(combinedSpecs).specs[0].manualNote, "Keep spec extras");
const renameSpec = save(masterSpec.manifest, { specs: base.specs.map((row) => row.id === "connection" ? { ...row, label: "Connector" } : row) });
assert.equal(renameSpec.conflicts.length, 0, "label and value changes on the same spec must combine");
assert.equal(savedProduct(renameSpec).specs[0].label, "Connector");
assert.equal(savedProduct(renameSpec).specs[0].value, "USB-C");
const conflictingSpec = save(masterSpec.manifest, { specs: base.specs.map((row) => row.id === "connection" ? { ...row, value: "Bluetooth" } : row) });
assert.equal(conflictingSpec.savedFields, 0);
assert.equal(conflictingSpec.manifest, masterSpec.manifest);
assert.equal(conflictingSpec.conflicts[0].path, "specs/connection/value");
assert.equal(conflictingSpec.conflicts[0].mine, "Bluetooth");
assert.equal(conflictingSpec.conflicts[0].master, "USB-C");

const masterSku = save(manifest, { partSkus: [...base.partSkus, { id: "sku2", code: "HP002" }] });
const combinedSku = save(masterSku.manifest, { partSkus: [...base.partSkus, { id: "sku3", code: "HP003" }] });
assert.equal(combinedSku.conflicts.length, 0);
assert.deepEqual(savedProduct(combinedSku).partSkus.map((row) => row.code), ["HP001", "HP002", "HP003"]);
const assignSku = save(manifest, { partSkus: base.partSkus.map((row) => ({ ...row, variantId: "white" })) });
const skuCodeAndColor = save(assignSku.manifest, { partSkus: base.partSkus.map((row) => ({ ...row, code: "HP001-REV" })) });
assert.equal(skuCodeAndColor.conflicts.length, 0);
assert.equal(savedProduct(skuCodeAndColor).partSkus[0].variantId, "white");
assert.equal(savedProduct(skuCodeAndColor).partSkus[0].manualNote, "Keep part extras");
const skuSameProperty = save(masterSku.manifest, { partSkus: base.partSkus.map((row) => ({ ...row, code: "HP001-REV" })) });
const skuSameAgain = save(skuSameProperty.manifest, { partSkus: base.partSkus.map((row) => ({ ...row, code: "HP001-FINAL" })) });
assert.equal(skuSameAgain.conflicts[0].path, "partSkus/sku1/code");

const duplicateAdd = save(masterSku.manifest, { partSkus: [...base.partSkus, { id: "different-id", code: "hp002" }] });
assert.equal(duplicateAdd.conflicts.length, 1);
assert.equal(duplicateAdd.conflicts[0].reason, "duplicate-sku");
const duplicateMine = model.patchValues(base, { partSkus: [...base.partSkus, { id: "different-id", code: "hp002" }] });
const duplicatePlan = model.planMerge(base, duplicateMine, model.values(savedProduct(masterSku)));
const keepMySku = model.resolveConflicts(duplicatePlan, { [duplicatePlan.conflicts[0].path]: "mine" });
const keepMasterSku = model.resolveConflicts(duplicatePlan, { [duplicatePlan.conflicts[0].path]: "master" });
assert.deepEqual(keepMySku.partSkus.map((row) => row.id), ["sku1", "different-id"]);
assert.deepEqual(keepMasterSku.partSkus.map((row) => row.id), ["sku1", "sku2"]);
assert.throws(() => save(manifest, { partSkus: [...base.partSkus, { id: "dup", code: "hp001" }] }), /same SKU code/);
const duplicateBaseline = model.draftBaseline(base, duplicateMine, model.values(savedProduct(masterSku)));
assert.equal(duplicateBaseline.partSkus.some((row) => row.id === "sku2"), false);
const duplicateStillNeedsChoice = save(masterSku.manifest, model.diffValues(duplicateBaseline, keepMySku), duplicateBaseline);
assert.equal(duplicateStillNeedsChoice.conflicts[0].reason, "duplicate-sku", "refresh must never implicitly approve replacing another team's colliding SKU");

const variantsMine = copy(base.variantGroups);
variantsMine[0].items[0].colorName = "Midnight";
const variantColorMaster = copy(base.variantGroups);
variantColorMaster[0].items[0].colorHex = "#222222";
const variantMaster = save(manifest, { variantGroups: variantColorMaster });
const variantCombined = save(variantMaster.manifest, { variantGroups: variantsMine });
assert.equal(variantCombined.conflicts.length, 0);
assert.equal(savedProduct(variantCombined).variantGroups[0].items[0].colorName, "Midnight");
assert.equal(savedProduct(variantCombined).variantGroups[0].items[0].colorHex, "#222222");
assert.equal(savedProduct(variantCombined).variantGroups[0].items[0].imageAssetId, "local-black");
assert.equal(savedProduct(variantCombined).variantGroups[0].customSetting, true);
const variantConflicting = copy(base.variantGroups);
variantConflicting[0].items[0].colorHex = "#333333";
assert.equal(save(variantMaster.manifest, { variantGroups: variantConflicting }).conflicts[0].path, "variantGroups/colors/items/black/colorHex");

const addVariantMaster = copy(base.variantGroups);
addVariantMaster[0].items.push({ id: "white", code: "WHT", colorName: "White" });
const addVariantMine = copy(base.variantGroups);
addVariantMine[0].items.push({ id: "blue", code: "BLU", colorName: "Blue" });
const differentVariantAdds = save(save(manifest, { variantGroups: addVariantMaster }).manifest, { variantGroups: addVariantMine });
assert.deepEqual(savedProduct(differentVariantAdds).variantGroups[0].items.map((row) => row.id), ["black", "white", "blue"]);
const collisionVariant = copy(base.variantGroups);
collisionVariant[0].items.push({ id: "white-other", code: "wht", colorName: "Cloud White" });
assert.equal(save(save(manifest, { variantGroups: addVariantMaster }).manifest, { variantGroups: collisionVariant }).conflicts[0].reason, "duplicate-sku");

const removalAgainstEdit = save(masterSpec.manifest, { specs: base.specs.filter((row) => row.id !== "connection") });
assert.equal(removalAgainstEdit.conflicts[0].path, "specs/connection");
assert.equal(removalAgainstEdit.conflicts[0].mineExists, false);
const removedSpec = save(manifest, { specs: base.specs.filter((row) => row.id !== "connection") });
const editAgainstRemoval = save(removedSpec.manifest, { specs: base.specs.map((row) => row.id === "connection" ? { ...row, value: "Wireless" } : row) });
assert.equal(editAgainstRemoval.conflicts[0].path, "specs/connection");
assert.equal(editAgainstRemoval.conflicts[0].masterExists, false);
const restoredPlan = model.planMerge(base, model.patchValues(base, { specs: base.specs.map((row) => row.id === "connection" ? { ...row, value: "Wireless" } : row) }), model.values(savedProduct(removedSpec)));
assert.equal(model.resolveConflicts(restoredPlan, { "specs/connection": "mine" }).specs[1].value, "Wireless", "keeping a changed row must restore the full record");
assert.equal(model.resolveConflicts(restoredPlan, { "specs/connection": "master" }).specs.some((row) => row.id === "connection"), false);
const removeGroupMaster = save(manifest, { variantGroups: [] });
assert.equal(save(removeGroupMaster.manifest, { variantGroups: variantsMine }).conflicts[0].path, "variantGroups/colors");

const sameAddedIdMaster = save(manifest, { specs: [...base.specs, { id: "same-new-id", label: "Battery", value: "20 h" }] });
const sameAddedIdConflict = save(sameAddedIdMaster.manifest, { specs: [...base.specs, { id: "same-new-id", label: "Battery", value: "30 h" }] });
assert.equal(sameAddedIdConflict.conflicts[0].path, "specs/same-new-id");
assert.equal(save(sameAddedIdMaster.manifest, { specs: [...base.specs, { id: "same-new-id", label: "Battery", value: "20 h" }] }).savedFields, 0, "converged additions are no-ops");

const remoteLaunch = model.snapshot(launch.manifest).products[0];
const launchAgain = save(launch.manifest, { generalAvailabilityDate: "2026-08-15" });
assert.equal(launchAgain.conflicts[0].path, "@launch");
assert.equal(save(launch.manifest, { generalAvailabilityDate: "2026-07-31" }).savedFields, 0, "same final value must converge even with old revisions");
const rebasePlan = model.planMerge(base, model.patchValues(base, { generalAvailabilityDate: "2026-08-15" }), remoteLaunch.values, {}, remoteLaunch.revisions);
const explicitFinal = model.resolveConflicts(rebasePlan, { "@launch": "mine" });
const explicitSaved = save(launch.manifest, model.diffValues(remoteLaunch.values, explicitFinal), remoteLaunch.values, remoteLaunch.revisions);
assert.equal(explicitSaved.conflicts.length, 0);
assert.equal(savedProduct(explicitSaved).generalAvailabilityDate, "2026-08-15");

const launchBack = save(launch.manifest, { generalAvailabilityDate: base.generalAvailabilityDate }, remoteLaunch.values, remoteLaunch.revisions);
const aba = save(launchBack.manifest, { generalAvailabilityDate: "2026-09-01" });
assert.equal(aba.conflicts[0].path, "@launch", "changing away and back must retain a revision conflict");
const removedSnapshot = model.snapshot(removedSpec.manifest).products[0];
const readdedSpec = save(removedSpec.manifest, { specs: base.specs }, removedSnapshot.values, removedSnapshot.revisions);
assert.equal(save(readdedSpec.manifest, { specs: base.specs.map((row) => row.id === "connection" ? { ...row, value: "USB4" } : row) }).conflicts[0].path, "specs/connection/value", "remove/re-add ABA must block an old property edit");

const shortEndMaster = save(manifest, { endManufacturingDate: "2026-06-01" });
const incompatibleLaunch = model.patchValues(base, { generalAvailabilityDate: "2026-07-01" });
const orderPlan = model.planMerge(base, incompatibleLaunch, model.values(savedProduct(shortEndMaster)));
assert.equal(orderPlan.conflicts[0].path, "@lifecycle");
assert.equal(model.resolveConflicts(orderPlan, { "@lifecycle": "mine" }).endManufacturingDate, base.endManufacturingDate);
assert.equal(model.resolveConflicts(orderPlan, { "@lifecycle": "master" }).generalAvailabilityDate, base.generalAvailabilityDate);
const orderBaseline = model.draftBaseline(base, incompatibleLaunch, model.values(savedProduct(shortEndMaster)));
assert.equal(orderBaseline.endManufacturingDate, base.endManufacturingDate, "local lifecycle preview must preserve original origins for a future conflict decision");
const bothDateMaster = save(manifest, { generalAvailabilityDate: "2026-04-01", endManufacturingDate: "2026-06-01" });
assert.equal(model.planMerge(base, incompatibleLaunch, model.values(savedProduct(bothDateMaster))).conflicts[0].path, "@lifecycle", "unsafe possible field choices must be presented as one valid lifecycle pair");

const draftMine = model.patchValues(base, { specs: localSpec });
const draftRemote = model.values(savedProduct(masterSpec));
const draftBase = model.draftBaseline(base, draftMine, draftRemote);
assert.equal(draftBase.specs[0].value, "USB-C", "unrelated accepted spec updates become the new baseline");
assert.equal(draftBase.specs[1].value, "53 mm", "unsaved spec edits retain their original baseline");
assert.deepEqual(model.diffValues(draftBase, model.resolveConflicts(model.planMerge(base, draftMine, draftRemote))), { specs: [{ ...base.specs[0], value: "USB-C" }, localSpec[1]] });
assert.deepEqual(model.diffValues(model.draftBaseline(base, draftRemote, draftRemote), draftRemote), {}, "remote convergence must clear the unsaved marker");
const draftRevs = model.draftRevisions(base, draftMine, {}, { "specs/connection/value": 2, "specs/driver/value": 3 });
assert.equal(draftRevs["specs/connection/value"], 2);
assert.equal(draftRevs["specs/driver/value"], 0);
assert.equal(model.describeChanges(base, draftMine)[0].label, "Specification: Driver — Value");
assert.equal(model.describeChanges(base, draftMine)[0].mineText, "55 mm");

assert.throws(() => save(manifest, { specs: [{ id: "__proto__", label: "Danger", value: "x" }] }), /stable ID/);
assert.throws(() => model.snapshot({ categories: [{ board: { products: [{ id: "p" }, { id: "p" }] } }] }), /duplicate product IDs/);
assert.throws(() => model.mergeChanges(manifest, [change({ name: "One" }), change({ name: "Two" })]), /only once/);
assert.throws(() => model.mergeChanges(manifest, [{ ...change({ name: "One" }), productId: "not-in-master" }]), /no longer in the master/);
assert.throws(() => model.mergeChanges(manifest, Array.from({ length: 501 }, () => change({ name: "One" }))), /at most 500/);
const suspiciousRevisions = JSON.parse('{"__proto__": 3,"constructor": 4,"name": 0}');
assert.equal(save(manifest, { name: "Safe" }, base, suspiciousRevisions).conflicts.length, 0);
assert.equal({}.polluted, undefined);

const escapedProduct = copy(product);
escapedProduct.specs[0].id = "connection/a b";
const escapedManifest = copy(manifest);
escapedManifest.categories[0].board.products[0] = escapedProduct;
const escapedBase = model.values(escapedProduct);
const escapedResult = save(escapedManifest, { specs: escapedBase.specs.map((row) => row.id === "connection/a b" ? { ...row, value: "USB5" } : row) }, escapedBase);
assert.equal(escapedResult.history[0].path, "specs/connection%2Fa%20b/value");

const scalarMaster = save(manifest, { name: "New product name", codename: "New codename", price: 109.99, priceLabel: "Suggested price", tier: "Core", statusType: "embargo", statusLabel: "Upcoming under embargo", variantLabel: "PLAYSTATION", roadmapFamily: "Flight", roadmapStatus: "in-planning", roadmapConfidence: "medium", roadmapPredecessorId: "older-product", roadmapSuccessorId: "newer-product" });
assert.equal(scalarMaster.savedFields, 13);
assert.equal(savedProduct(scalarMaster).name, "New product name");
assert.equal(savedProduct(scalarMaster).roadmap.family, "Flight");
assert.equal(savedProduct(scalarMaster).roadmap.predecessorId, "older-product");
assert.equal(savedProduct(scalarMaster).imageAssetId, "local-main");
assert.equal(save(scalarMaster.manifest, { name: "Another name" }).conflicts[0].path, "name");
const independentScalar = save(save(manifest, { name: "Name accepted" }).manifest, { price: 129.99 });
assert.equal(independentScalar.conflicts.length, 0);
assert.equal(savedProduct(independentScalar).name, "Name accepted");
assert.equal(savedProduct(independentScalar).price, 129.99);

const multiProduct = copy(launch.manifest);
multiProduct.categories[0].board.products.push({ ...copy(product), id: "p2", name: "Second product" });
const atomicResult = model.mergeChanges(multiProduct, [change({ generalAvailabilityDate: "2026-08-01" }), { productId: "p2", base: model.values(multiProduct.categories[0].board.products[1]), patch: { name: "Should wait" } }]);
assert.equal(atomicResult.manifest, multiProduct);
assert.equal(atomicResult.savedProducts, 0);
assert.equal(atomicResult.manifest.categories[0].board.products[1].name, "Second product", "a conflict must hold every product in that save until final choices are made");

const metadataWithOnlyPaths = copy(manifest);
metadataWithOnlyPaths.masterSync = { products: { p1: { revisions: { ffsDate: 100 } } } };
const continuedCounter = save(metadataWithOnlyPaths, { name: "Next revision" });
assert.equal(continuedCounter.history[0].revision, 101, "snapshot metadata exported without its global clock must not reuse old revision numbers");

const manyHistory = copy(manifest);
manyHistory.masterSync = { history: Array.from({ length: 1000 }, (_, index) => ({ path: "specs/large/value", before: "x".repeat(16000), after: "y".repeat(16000), index })) };
const historyResult = save(manyHistory, { name: "History cap" });
assert.ok(historyResult.manifest.masterSync.history.length < 1000);
assert.ok(JSON.stringify(historyResult.manifest.masterSync.history).length * 2 < 530000);
assert.equal(historyResult.manifest.masterSync.history.at(-1).after, "History cap");

console.log("Shared master model checks passed: granular product/spec/SKU/date merges, atomic lifecycle groups, explicit conflict choices, ABA revisions, local image preservation, safe draft baselines and bounded history.");
