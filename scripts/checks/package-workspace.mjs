import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

await import("../../public/js/package-codec.js");
await import("../../public/js/package-client.js");
await import("../../public/js/workspace-store.js");
await import("../../public/js/master-model.js");
const codec = globalThis.PortfolioPackage;
const appSource = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const catalogSandbox = { window: {} };
vm.createContext(catalogSandbox);
new vm.Script(await readFile(new URL("../../public/js/catalog-data.js", import.meta.url), "utf8")).runInContext(catalogSandbox);
const definitions = JSON.parse(JSON.stringify(catalogSandbox.window.PORTFOLIO_CATALOG.categories));
const storageKey = "product-portfolio-canvas-v4";
const recoveryKey = `${storageKey}-package-recovery`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const clone = (value) => JSON.parse(JSON.stringify(value));
const imageBlob = (label = "image") => new Blob([label], { type: "image/png" });

function portfolioFixture(name = "Original", imageIds = ["shared-image"]) {
  return {
    version: 4,
    activeCategoryId: definitions[0].id,
    settings: { timeline: { startMonth: "2026-01", endMonth: "2030-12", snap: "month" } },
    imageAssets: imageIds.map((assetId) => ({ id: assetId, sourceType: "local", name: "Product image", mimeType: "image/png", size: 5 })),
    categories: definitions.map((definition, index) => ({
      id: definition.id, name: definition.name,
      board: {
        version: 1, title: definition.boardTitle,
        lanes: [{ id: `${definition.id}-lane`, label: "Products", order: 0 }],
        settings: { roadmap: { startMonth: "2026-01", endMonth: "2030-12", snap: "month" } },
        products: index ? [] : [{
          id: "product-1", name, laneId: `${definition.id}-lane`, order: 0,
          imageAssetId: imageIds[0] || "", specs: [{ id: "spec-1", label: "Description", value: "Long values remain intact" }],
          generalAvailabilityDate: "2026-06-19", endManufacturingDate: "2029-04-30",
          roadmap: { family: "Family", launchMonth: "2026-06", startMonth: "2026-06", endMonth: "2029-04", status: "in-development" },
          variantGroups: [{ id: "group-1", type: "color", label: "Color", items: [{ id: "variant-1", code: "BK", imageAssetId: imageIds.at(-1) || "" }] }],
          partSkus: [{ id: "sku-1", code: "EXAMPLE-SKU" }],
        }],
      },
    })),
  };
}

function packageBytes(manifest, { omitImages = false } = {}) {
  const entries = [{ name: "portfolio.json", data: encoder.encode(JSON.stringify(manifest)) }];
  if (!omitImages) {
    for (const asset of manifest.imageAssets || []) {
      if (asset.sourceType === "url") continue;
      entries.push({ name: asset.packagePath || `images/${asset.id}.png`, data: encoder.encode(`bytes:${asset.id}`) });
    }
  }
  return codec.createZip(entries);
}

const functionNames = [
  "imageStorePut", "imageStoreGet", "imageStoreDelete", "imageStoreClear", "imageStoreWriteBatch", "imageStoreDeleteBatch",
  "dataUriToBlob", "extensionForImageAsset", "createImageAssetMetadata", "ensureImageAssetRegistry", "migrateLegacyProductImages",
  "loadLocalImageAsset", "normalizeAscmSnapshot", "createDefaultPortfolio", "ensurePortfolioSchema", "emptyBoardFromCatalogCategory", "portfolioFromCatalogImport", "normalizeImportedPortfolio",
  "persistPortfolioStorage", "reportWorkspaceSaveFailure", "scheduleSave", "showLocalSaveFailure", "flushWorkspaceSave", "clonePortfolioData", "packageCodec", "getCurrentPackageInfo", "validatePackageManifest", "validatePackageImageReferences",
  "localPackageImageIds", "clearPackageImageCaches", "resetHashoutView", "commitPackageDraft",
  "buildProjectPackageBytes", "exportProjectPackage", "importProjectPackage", "parsePortfolioImportText", "normalizeIsolatedPortfolioImport", "remapImportedLocalImages", "importJson",
  "findPortfolioProductLocation", "restoreMergeDraft", "undoProductMergeDraft",
];
const actualFunctions = functionNames.map((name) => {
  const match = appSource.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(match, `the application must define ${name}`);
  return match[0];
}).join("\n");
assert.doesNotMatch(appSource, /^(?:async )?function (?:readPackageRecovery|hasPreviousPackage|restorePreviousPackage)\(/m, "the removed previous-workspace feature must not leave callable recovery actions");

function harness(initial = portfolioFixture()) {
  const images = new Map(initial.imageAssets.filter((asset) => asset.sourceType === "local").map((asset) => [asset.id, imageBlob(`original:${asset.id}`)]));
  const stored = new Map([[storageKey, JSON.stringify(initial)]]);
  const faults = { transaction: false, deleteTransaction: false, synchronousPut: 0, storageKey: "", removeKey: "", activation: false, rollbackStorage: false };
  const calls = { writes: 0, workspaceWrites: 0, clears: 0, deletes: [], revokes: [], creates: 0, downloads: [], activations: [], notices: [], hashoutResets: 0 };
  const timers = new Map();
  let timerId = 0;
  let nextId = 0;
  const database = {
    close() {},
    objectStoreNames: { contains: () => true },
    transaction(_name, mode) {
      const operations = [];
      let aborted = false;
      let puts = 0;
      const transaction = {
        error: null,
        abort() { aborted = true; },
        objectStore(storeName) {
          return {
            put(record) {
              puts += 1;
              if (faults.synchronousPut === puts) { faults.synchronousPut = 0; throw new Error("Image write failed"); }
              if (storeName === "workspaces" && faults.storageKey === record.id) { faults.storageKey = ""; throw Object.assign(new Error("Browser storage is full"), { name: "QuotaExceededError" }); }
              operations.push(["put", record, storeName]);
            },
            delete(assetId) { operations.push(["delete", assetId]); },
            clear() { calls.clears += 1; operations.push(["clear"]); },
            get(assetId) {
              const request = {};
              queueMicrotask(() => { request.result = storeName === "workspaces" ? stored.has(assetId) ? { id: assetId, version: 1, serialized: stored.get(assetId) } : undefined : images.has(assetId) ? { id: assetId, blob: images.get(assetId) } : undefined; request.onsuccess?.(); });
              return request;
            },
          };
        },
      };
      queueMicrotask(() => queueMicrotask(() => {
        const writeFailure = faults.transaction && operations.some(([kind]) => kind === "put");
        const deleteFailure = faults.deleteTransaction && operations.some(([kind]) => kind === "delete");
        if (aborted || (mode === "readwrite" && (writeFailure || deleteFailure))) {
          faults.transaction = false;
          faults.deleteTransaction = false;
          transaction.error = new Error("Image transaction aborted");
          transaction.onabort?.();
          return;
        }
        for (const [kind, record, storeName] of operations) {
          if (kind === "put" && storeName === "workspaces") { calls.workspaceWrites++; stored.set(record.id, record.serialized); }
          if (kind === "put" && storeName !== "workspaces") { calls.writes += 1; images.set(record.id, record.blob); }
          if (kind === "delete") { calls.deletes.push(record); images.delete(record); }
          if (kind === "clear") images.clear();
        }
        transaction.oncomplete?.();
      }));
      return transaction;
    },
  };
  const sandbox = {
    Blob, Uint8Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, Map, Set, Date, atob,
    PortfolioPackage: codec, PortfolioPackageClient: globalThis.PortfolioPackageClient, PortfolioModel: { syncTimelineSettings() {} },
    STORAGE_KEY: storageKey, PREVIOUS_STORAGE_KEY: "previous", PACKAGE_RECOVERY_KEY: recoveryKey,
    MAX_PACKAGE_MANIFEST_BYTES: 64 * 1024 * 1024, IMAGE_STORE_NAME: "images",
    CATEGORY_DEFINITIONS: clone(definitions), pendingLegacyImageBlobs: [],
    imageCache: new Map(), imageAssetUrlCache: new Map(), imageAssetLoadPromises: new Map(), missingImageAssetIds: new Set(),
    imageAssetGeneration: 0, packageOperationInProgress: false, workspaceOpening: false,
    workspaceSavePending: false, workspaceSaveRevision: 0, workspaceSaveAttempt: 0, workspaceSaveFlight: null, saveTimer: null,
    portfolio: clone(initial), activeCategoryId: initial.activeCategoryId,
    hashoutViewController: { destroy() { calls.hashoutResets++; } }, hashoutSelectedKey: "previous-product", hashoutViewportState: { start: 1, end: 2 },
    id: () => `fresh-${++nextId}`,
    openImageDatabase: async () => database,
    categoryDefinition: (categoryId) => definitions.find((definition) => definition.id === categoryId) || definitions[0],
    catalogImageAssets: () => [],
    createCategoryBoard: (definition) => ({ title: definition.boardTitle, lanes: clone(definition.lanes), products: [], settings: { roadmap: {} } }),
    ensureBoardSchema: (target) => {
      target.products.forEach((product) => { product.variantGroups ||= []; product.imageAssetId = String(product.imageAssetId || ""); });
      return target;
    },
    activateCategory: (categoryId) => {
      calls.activations.push({ imageIds: [...images.keys()], recovery: stored.get(recoveryKey) });
      if (faults.activation) { faults.activation = false; if (faults.rollbackStorage) { faults.storageKey = storageKey; faults.rollbackStorage = false; } throw new Error("Activation failed"); }
      sandbox.activeCategoryId = categoryId;
      sandbox.portfolio.activeCategoryId = categoryId;
      sandbox.scheduleSave();
    },
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (savedId) => timers.delete(savedId),
    closePopupMenus() {}, renderActiveView() {}, renderInspector() {},
    downloadBlob: (blob, name) => calls.downloads.push({ blob, name }),
    PortfolioNotifications: { publish: notice => calls.notices.push(notice), resolve() {} },
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      removeItem(key) {
        if (faults.removeKey === key) { faults.removeKey = ""; throw new Error("Browser storage cleanup failed"); }
        stored.delete(key);
      },
      setItem(key, value) {
        assert.notEqual(key, recoveryKey, "package imports must never write a previous-workspace recovery snapshot");
        if (faults.storageKey === key) { faults.storageKey = ""; throw new Error("Browser storage is full"); }
        stored.set(key, value);
      },
    },
    URL: {
      revokeObjectURL: (url) => calls.revokes.push(url),
      createObjectURL: () => { calls.creates += 1; return "blob:generated"; },
    },
  };
  sandbox.workspaceStorage = globalThis.PortfolioWorkspaceStore.create({ databaseName: "synthetic-package-images", workspaceKey: storageKey, indexedDB: { open() {
    const request = {};
    queueMicrotask(() => { request.result = database; request.onsuccess?.(); });
    return request;
  } } });
  vm.createContext(sandbox);
  new vm.Script(actualFunctions).runInContext(sandbox);
  return { sandbox, images, stored, faults, calls, timers };
}

const first = harness();
const newManifest = portfolioFixture("Updated", ["shared-image", "variant-image"]);
const result = await first.sandbox.importProjectPackage(new Blob([packageBytes(newManifest)]));
assert.equal(first.calls.hashoutResets, 1, "A different package must dispose the previous map before activation.");
assert.equal(first.sandbox.hashoutViewController, null);
assert.equal(first.sandbox.hashoutSelectedKey, null);
assert.equal(first.sandbox.hashoutViewportState, null);
assert.equal(result.productCount, 1);
assert.equal(result.categoryCount, definitions.length);
assert.equal(result.encrypted, false);
assert.equal(result.packageInfo, null, "legacy packages must report their missing update metadata honestly");
assert.equal(first.sandbox.getCurrentPackageInfo(), null);
assert.equal(first.calls.clears, 0, "package replacement must never clear the image store");
const updated = first.sandbox.portfolio.categories[0].board.products[0];
assert.notEqual(updated.imageAssetId, "shared-image", "imported image IDs must be isolated from the original library");
assert.ok(first.images.has(updated.imageAssetId));
assert.ok(first.images.has(updated.variantGroups[0].items[0].imageAssetId), "variant image references must follow staged image IDs");
assert.ok(first.calls.activations[0].imageIds.includes("shared-image"), "the original image must remain until the new workspace activates successfully");
assert.ok(first.calls.activations[0].imageIds.includes(updated.imageAssetId), "new images must be staged before the new workspace activates");
assert.ok(!first.images.has("shared-image"), "a successful import must collect the superseded original image");
assert.equal(updated.generalAvailabilityDate, newManifest.categories[0].board.products[0].generalAvailabilityDate);
assert.equal(updated.roadmap.endMonth, "2029-04");
assert.equal(updated.partSkus[0].code, "EXAMPLE-SKU");
assert.equal(updated.specs[0].value, "Long values remain intact");
assert.equal(first.stored.has(recoveryKey), false, "a successful import must not create a previous-workspace snapshot");

const cleanup = harness();
cleanup.images.set("unrelated-image", imageBlob("unrelated"));
await cleanup.sandbox.importProjectPackage(new Blob([packageBytes(portfolioFixture("Second"))]));
const secondImageId = cleanup.sandbox.portfolio.imageAssets[0].id;
await cleanup.sandbox.importProjectPackage(new Blob([packageBytes(portfolioFixture("Third"))]));
assert.ok(!cleanup.images.has("shared-image"), "a superseded original image must be collected");
assert.ok(!cleanup.images.has(secondImageId), "the preceding workspace image must be collected after a successful replacement");
assert.ok(cleanup.images.has(cleanup.sandbox.portfolio.imageAssets[0].id), "the current image must remain");
assert.ok(cleanup.images.has("unrelated-image"), "replacement cleanup must not sweep unrelated image records");
assert.equal(cleanup.images.size, 2, "repeated imports must retain only the active package and unrelated records");
assert.equal(cleanup.stored.has(recoveryKey), false);

const migratedRecovery = harness();
const oldRecoveryPortfolio = portfolioFixture("Earlier", ["legacy-image", "shared-image", "pkg-fresh-1"]);
migratedRecovery.stored.set(recoveryKey, JSON.stringify({ version: 1, portfolio: oldRecoveryPortfolio }));
migratedRecovery.images.set("legacy-image", imageBlob("legacy"));
migratedRecovery.images.set("pkg-fresh-1", imageBlob("old recovery overlap"));
migratedRecovery.images.set("unrelated-image", imageBlob("unrelated"));
await migratedRecovery.sandbox.importProjectPackage(new Blob([packageBytes(portfolioFixture("Migrated"))]));
const migratedImageId = migratedRecovery.sandbox.portfolio.imageAssets[0].id;
assert.equal(migratedImageId, "pkg-fresh-1");
assert.equal(migratedRecovery.stored.has(recoveryKey), false, "successful import must remove a legacy recovery snapshot");
assert.ok(!migratedRecovery.images.has("legacy-image"), "validated legacy recovery images may be collected");
assert.ok(!migratedRecovery.images.has("shared-image"), "original and legacy recovery cleanup may overlap safely");
assert.equal(await migratedRecovery.images.get(migratedImageId).text(), "bytes:shared-image", "legacy cleanup must preserve images referenced by the current workspace");
assert.ok(migratedRecovery.images.has("unrelated-image"), "legacy cleanup must stay within the old snapshots");
assert.deepEqual([...new Set(migratedRecovery.calls.deletes)].sort(), ["legacy-image", "shared-image"]);

const cleanupFailure = harness();
const cleanupFailureRecovery = JSON.stringify({ version: 1, portfolio: portfolioFixture("Earlier", []) });
cleanupFailure.stored.set(recoveryKey, cleanupFailureRecovery);
cleanupFailure.faults.removeKey = recoveryKey;
await cleanupFailure.sandbox.importProjectPackage(new Blob([packageBytes(portfolioFixture("Committed"))]));
assert.equal(cleanupFailure.sandbox.portfolio.categories[0].board.products[0].name, "Committed", "legacy metadata cleanup failure must not roll back a committed import");
assert.equal(JSON.parse(cleanupFailure.stored.get(storageKey)).categories[0].board.products[0].name, "Committed");
assert.equal(cleanupFailure.stored.get(recoveryKey), cleanupFailureRecovery, "legacy cleanup is best effort");
assert.ok(cleanupFailure.images.has(cleanupFailure.sandbox.portfolio.imageAssets[0].id));

const imageCleanupFailure = harness();
imageCleanupFailure.faults.deleteTransaction = true;
await imageCleanupFailure.sandbox.importProjectPackage(new Blob([packageBytes(portfolioFixture("Committed"))]));
assert.equal(imageCleanupFailure.sandbox.portfolio.categories[0].board.products[0].name, "Committed", "obsolete image cleanup failure must not roll back a committed import");
assert.ok(imageCleanupFailure.images.has(imageCleanupFailure.sandbox.portfolio.imageAssets[0].id));
assert.ok(imageCleanupFailure.images.has("shared-image"), "an aborted cleanup transaction must leave the existing image record intact");

const key = codec.generateKey();
const encrypted = await codec.encrypt(packageBytes(newManifest), key);
const secured = harness();
assert.equal((await secured.sandbox.importProjectPackage(new Blob([encrypted]), { key, requireEncrypted: true })).encrypted, true);
assert.ok([...secured.stored.values()].every((value) => !value.includes(key)), "the package key must never be persisted");
const provenance = harness();
await provenance.sandbox.importProjectPackage(new Blob([encrypted]), { key, requireEncrypted: true, fromSharedDownload: true });
assert.equal(provenance.sandbox.portfolio.loadedPackageInfo.gitBlobSha, await globalThis.PortfolioPackageClient.gitBlobSha(encrypted), "loaded identity is calculated from the exact encrypted input bytes");
assert.equal(provenance.sandbox.portfolio.loadedPackageInfo.version, 1);
const loadedMarker = JSON.stringify(provenance.sandbox.portfolio.loadedPackageInfo);
provenance.sandbox.portfolio.masterSync = { supabaseRevision: 999 }; provenance.sandbox.portfolio.packageInfo = codec.createPackageInfo();
assert.equal(JSON.stringify(provenance.sandbox.portfolio.loadedPackageInfo), loadedMarker, "mutable team metadata cannot advance the loaded image package identity");
await provenance.sandbox.exportProjectPackage(key);
const provenanceExport = codec.readZip(await codec.decrypt(new Uint8Array(await provenance.calls.downloads[0].blob.arrayBuffer()), key));
assert.equal(Object.hasOwn(JSON.parse(decoder.decode(provenanceExport.get("portfolio.json"))), "loadedPackageInfo"), false, "local loaded identity is not re-exported as package provenance");
const forgedManifest = clone(newManifest); forgedManifest.loadedPackageInfo = { version: 1, gitBlobSha: "a".repeat(40), loadedAt: "2026-01-01T00:00:00.000Z" };
await provenance.sandbox.importProjectPackage(new Blob([packageBytes(forgedManifest)]));
assert.equal(Object.hasOwn(provenance.sandbox.portfolio, "loadedPackageInfo"), false, "manual imported files cannot claim a verified shared download identity");
const pendingPackage = harness(), pendingBefore = JSON.stringify(pendingPackage.sandbox.portfolio);
pendingPackage.sandbox.PortfolioMasterUI = { getSession: () => ({ getState: () => ({ busy: false, pending: [{ productId: "draft" }] }) }) };
await assert.rejects(pendingPackage.sandbox.importProjectPackage(new Blob([encrypted]), { key, fromSharedDownload: true }), /Save or discard/);
assert.equal(JSON.stringify(pendingPackage.sandbox.portfolio), pendingBefore); assert.equal(pendingPackage.calls.workspaceWrites, 0); assert.equal(pendingPackage.sandbox.packageOperationInProgress, false);
const wrongPublished = harness(), wrongBefore = JSON.stringify(wrongPublished.sandbox.portfolio);
wrongPublished.sandbox.PortfolioMasterUI = { getSession: () => ({ getState: () => ({ busy: false, pending: [], snapshot: { publication: { status: "current", githubSha: "f".repeat(40) } } }) }) };
await assert.rejects(wrongPublished.sandbox.importProjectPackage(new Blob([encrypted]), { key, requireEncrypted: true, fromSharedDownload: true }), /does not match the published copy/);
assert.equal(JSON.stringify(wrongPublished.sandbox.portfolio), wrongBefore); assert.equal(wrongPublished.calls.workspaceWrites, 0); assert.equal(wrongPublished.images.size, 1, "a stale or changed package cannot stage or replace current pixels");
const delayedPublished = harness();
delayedPublished.sandbox.PortfolioMasterUI = { getSession: () => ({ getState: () => ({ busy: false, pending: [], snapshot: { publication: { status: "pending" } } }) }) };
await assert.rejects(delayedPublished.sandbox.importProjectPackage(new Blob([encrypted]), { key, fromSharedDownload: true }), /complete package is not ready/);
assert.equal(delayedPublished.calls.workspaceWrites, 0);
await secured.sandbox.exportProjectPackage(key);
assert.equal(secured.calls.downloads[0].name, "master_ppc.pkg");
const exported = new Uint8Array(await secured.calls.downloads[0].blob.arrayBuffer());
assert.ok(codec.isEncrypted(exported));
const exportedEntries = codec.readZip(await codec.decrypt(exported, key));
const exportedManifest = JSON.parse(decoder.decode(exportedEntries.get("portfolio.json")));
assert.equal(exportedManifest.categories[0].board.products[0].name, "Updated");
assert.equal(exportedEntries.size, exportedManifest.imageAssets.length + 1);

const stampedManifest = portfolioFixture("Stamped package");
stampedManifest.settings.hashoutLabelMode = "on";
stampedManifest.settings.hashoutWindowsVisible = false;
stampedManifest.packageInfo = { version: 1, updatedAt: "2025-08-19T12:30:00.000Z", comments: "Updated the launch plan.\nChecked pricing." };
const stamped = harness();
const stampedResult = await stamped.sandbox.importProjectPackage(new Blob([await codec.encrypt(packageBytes(stampedManifest), key)]), { key, requireEncrypted: true });
assert.deepEqual(stampedResult.packageInfo, stampedManifest.packageInfo);
assert.deepEqual(stamped.sandbox.getCurrentPackageInfo(), stampedManifest.packageInfo);
assert.deepEqual(JSON.parse(stamped.stored.get(storageKey)).packageInfo, stampedManifest.packageInfo, "imported update metadata must persist with the workspace");
const reloaded = harness(JSON.parse(stamped.stored.get(storageKey)));
reloaded.sandbox.portfolio = reloaded.sandbox.ensurePortfolioSchema(reloaded.sandbox.portfolio);
assert.deepEqual(reloaded.sandbox.getCurrentPackageInfo(), stampedManifest.packageInfo, "normal workspace loading must preserve imported metadata");
assert.equal(reloaded.sandbox.portfolio.settings.hashoutLabelMode, "on", "The label override survives encrypted import, storage and schema reload.");
assert.equal(reloaded.sandbox.portfolio.settings.hashoutWindowsVisible, false, "The seasonal overlay choice survives encrypted import, storage and schema reload.");
const normalizedLabelFixture = reloaded.sandbox.ensurePortfolioSchema(clone(stampedManifest));
const labelFixtureProducts = JSON.stringify(normalizedLabelFixture.categories.map(category => category.board.products));
for (const [supplied, expected] of [[undefined, "default"], ["default", "default"], ["on", "on"], ["off", "off"], ["auto", "default"], [true, "default"]]) {
  const draft = clone(normalizedLabelFixture);
  draft.settings.hashoutLabelMode = supplied;
  const normalized = reloaded.sandbox.ensurePortfolioSchema(draft);
  assert.equal(normalized.settings.hashoutLabelMode, expected);
  assert.equal(JSON.stringify(normalized.categories.map(category => category.board.products)), labelFixtureProducts, "Label settings do not change product records or FFS dates.");
}
for (const [supplied, expected] of [[undefined, true], [true, true], [false, false], ["off", true]]) {
  const draft = clone(normalizedLabelFixture);
  draft.settings.hashoutWindowsVisible = supplied;
  const normalized = reloaded.sandbox.ensurePortfolioSchema(draft);
  assert.equal(normalized.settings.hashoutWindowsVisible, expected);
  assert.equal(JSON.stringify(normalized.categories.map(category => category.board.products)), labelFixtureProducts, "Seasonal targets do not change product records or FFS dates.");
}
const automaticSummaryManifest = clone(stampedManifest);
automaticSummaryManifest.packageInfo.comments = "Accepted product names:\n" + "Complete accepted product name\n".repeat(100);
const automaticSummaryWorkspace = harness();
const automaticSummaryResult = await automaticSummaryWorkspace.sandbox.importProjectPackage(new Blob([await codec.encrypt(packageBytes(automaticSummaryManifest), key)]), { key, requireEncrypted: true });
assert.ok(automaticSummaryManifest.packageInfo.comments.length > codec.MAX_PACKAGE_COMMENTS);
assert.deepEqual(automaticSummaryResult.packageInfo, automaticSummaryManifest.packageInfo, "stored automatic comments must survive authenticated import beyond the manual-note limit");
assert.deepEqual(JSON.parse(automaticSummaryWorkspace.stored.get(storageKey)).packageInfo, automaticSummaryManifest.packageInfo, "complete accepted product names must persist without truncation");
const firstInfoCopy = stamped.sandbox.getCurrentPackageInfo();
assert.notEqual(firstInfoCopy, stamped.sandbox.getCurrentPackageInfo());
assert.throws(() => { firstInfoCopy.comments = "Changed outside the workspace"; }, TypeError);
const buildStarted = Date.now();
const builtInfo = await stamped.sandbox.exportProjectPackage(key, { comments: "Revised manufacturing dates.\nApproved the new colors." });
assert.ok(Date.parse(builtInfo.updatedAt) >= buildStarted && Date.parse(builtInfo.updatedAt) <= Date.now());
const builtBytes = new Uint8Array(await stamped.calls.downloads[0].blob.arrayBuffer());
const builtManifest = JSON.parse(decoder.decode(codec.readZip(await codec.decrypt(builtBytes, key)).get("portfolio.json")));
assert.deepEqual(builtManifest.packageInfo, builtInfo, "export must return the date/comments embedded in its successful package");
assert.equal(Buffer.from(builtBytes).includes(Buffer.from(builtInfo.comments)), false);
assert.deepEqual(stamped.sandbox.getCurrentPackageInfo(), stampedManifest.packageInfo, "building a package must not overwrite the loaded master information");
assert.deepEqual(JSON.parse(stamped.stored.get(storageKey)).packageInfo, stampedManifest.packageInfo);
await assert.rejects(stamped.sandbox.exportProjectPackage(key, { comments: "x".repeat(2001) }), /package update information/i);
assert.equal(stamped.calls.downloads.length, 1, "invalid comments must fail before creating another package");
assert.equal(stamped.sandbox.packageOperationInProgress, false);
const standaloneBuiltManifest = JSON.parse(decoder.decode(codec.readZip(await stamped.sandbox.buildProjectPackageBytes()).get("portfolio.json")));
assert.ok(Date.parse(standaloneBuiltManifest.packageInfo.updatedAt) >= buildStarted);
assert.equal(standaloneBuiltManifest.packageInfo.comments, "");
assert.deepEqual(stamped.sandbox.getCurrentPackageInfo(), stampedManifest.packageInfo);
const legacyResult = await stamped.sandbox.importProjectPackage(new Blob([packageBytes(newManifest)]));
assert.equal(legacyResult.packageInfo, null);
assert.equal(stamped.sandbox.getCurrentPackageInfo(), null, "a legacy import must clear the replaced package's date/comments");

async function assertPreflightFailure(bytes, options = {}, pattern = /package|portfolio|image|category|product|board|key/i, initial) {
  const subject = harness(initial);
  const original = JSON.stringify(subject.sandbox.portfolio);
  const originalStorage = subject.stored.get(storageKey);
  await assert.rejects(subject.sandbox.importProjectPackage(new Blob([bytes]), options), pattern);
  assert.equal(JSON.stringify(subject.sandbox.portfolio), original, "preflight failure must preserve the active workspace");
  assert.equal(subject.stored.get(storageKey), originalStorage);
  assert.equal(subject.stored.has(recoveryKey), false);
  assert.equal(subject.calls.writes, 0, "preflight failure must not write images");
  assert.equal(subject.calls.clears, 0);
  assert.equal(subject.images.size, 1);
  assert.equal(subject.sandbox.packageOperationInProgress, false);
}
await assertPreflightFailure(encrypted, { key: codec.generateKey(), requireEncrypted: true });
await assertPreflightFailure(packageBytes(newManifest), { requireEncrypted: true });
await assertPreflightFailure(packageBytes(newManifest, { omitImages: true }));
await assertPreflightFailure(codec.createZip([{ name: "portfolio.json", data: encoder.encode("{broken") }]));
const unsupported = clone(newManifest); unsupported.version = 999;
await assertPreflightFailure(packageBytes(unsupported));
const unknownCategory = clone(newManifest); unknownCategory.categories[0].id = "unknown-category";
await assertPreflightFailure(packageBytes(unknownCategory));
const repeatedProduct = clone(newManifest); repeatedProduct.categories[0].board.products.push(clone(repeatedProduct.categories[0].board.products[0]));
await assertPreflightFailure(packageBytes(repeatedProduct));
const repeatedAsset = clone(newManifest); repeatedAsset.imageAssets.push(clone(repeatedAsset.imageAssets[0]));
await assertPreflightFailure(codec.createZip([{ name: "portfolio.json", data: encoder.encode(JSON.stringify(repeatedAsset)) }]));
const missingReference = clone(newManifest); missingReference.categories[0].board.products[0].variantGroups[0].items[0].imageAssetId = "absent-image";
await assertPreflightFailure(packageBytes(missingReference));
const invalidBoard = clone(newManifest); invalidBoard.categories[0].board.products = {};
await assertPreflightFailure(packageBytes(invalidBoard));
for (const packageInfo of [
  { ...stampedManifest.packageInfo, version: 2 },
  { ...stampedManifest.packageInfo, updatedAt: "2026-02-30T12:30:00.000Z" },
  { ...stampedManifest.packageInfo, comments: "x".repeat(codec.MAX_STORED_PACKAGE_COMMENTS + 1) },
  { ...stampedManifest.packageInfo, comments: { text: "not plain text" } },
  { version: 1, updatedAt: stampedManifest.packageInfo.updatedAt },
  { ...stampedManifest.packageInfo, unrecognized: true },
]) {
  const invalidMetadata = { ...clone(newManifest), packageInfo };
  await assertPreflightFailure(packageBytes(invalidMetadata), {}, /package update information/i, stampedManifest);
}

for (const fault of ["transaction", "synchronousPut", "storageKey", "activation"]) {
  const subject = harness();
  const oldRecovery = JSON.stringify({ version: 1, savedAt: "2026-01-01T00:00:00Z", portfolio: portfolioFixture("Earlier", ["legacy-image"]) });
  subject.stored.set(recoveryKey, oldRecovery);
  subject.images.set("legacy-image", imageBlob("legacy"));
  const original = JSON.stringify(subject.sandbox.portfolio);
  if (fault === "synchronousPut") subject.faults[fault] = 2;
  else if (fault === "storageKey") subject.faults[fault] = storageKey;
  else subject.faults[fault] = true;
  await assert.rejects(subject.sandbox.importProjectPackage(new Blob([packageBytes(newManifest)])), error => ['WORKSPACE_STORAGE', 'WORKSPACE_QUOTA'].includes(error.code) || /failed|aborted|full/i.test(error.message));
  assert.equal(JSON.stringify(subject.sandbox.portfolio), original, `${fault} must preserve the active workspace`);
  assert.equal(subject.stored.get(storageKey), original, `${fault} must preserve saved data`);
  assert.equal(subject.stored.get(recoveryKey), oldRecovery, `${fault} must leave legacy recovery metadata untouched`);
  assert.deepEqual([...subject.images.keys()], ["shared-image", "legacy-image"], `${fault} must remove only its staged images`);
  assert.equal(await subject.images.get("shared-image").text(), "original:shared-image");
  assert.equal(await subject.images.get("legacy-image").text(), "legacy");
  assert.ok(subject.calls.activations.every((call) => call.recovery === oldRecovery), `${fault} must preserve legacy recovery metadata through activation and rollback`);
  assert.equal(subject.calls.clears, 0);
}

const failedRollback = harness();
failedRollback.faults.activation = true;
failedRollback.faults.rollbackStorage = true;
await assert.rejects(failedRollback.sandbox.importProjectPackage(new Blob([packageBytes(newManifest)])), /previous saved copy could not be restored/i);
assert.equal(failedRollback.sandbox.portfolio.categories[0].board.products[0].name, "Original", "failed activation retains the open prior workspace");
const committedAfterFailedRollback = JSON.parse(failedRollback.stored.get(storageKey));
assert.equal(committedAfterFailedRollback.categories[0].board.products[0].name, "Updated", "a failed durable rollback is reported as the actual imported saved state");
for (const asset of committedAfterFailedRollback.imageAssets) assert.ok(failedRollback.images.has(asset.id), "never delete an incoming image still referenced by the committed saved record");
assert.ok(failedRollback.images.has("shared-image"), "the prior open workspace's image also remains available");
assert.equal(failedRollback.calls.clears, 0);

const largeManifest = portfolioFixture("Large source", ["shared-image", "variant-image"]);
largeManifest.categories[0].board.products = Array.from({ length: 20 }, (_, index) => ({
  ...clone(largeManifest.categories[0].board.products[0]), id: `large-${index}`, name: `Large synthetic ${index}`, order: index,
  specs: Array.from({ length: 120 }, (_, spec) => ({ id: `large-${index}-spec-${spec}`, label: `Field ${spec}`, value: "x".repeat(900) })),
  variantGroups: [{ id: `group-${index}`, type: "color", label: "Color", items: [{ id: `variant-${index}`, code: "BK", imageAssetId: "variant-image", customSource: "Retained variant metadata" }] }],
  partSkus: [{ id: `sku-${index}`, code: `SYNTHETIC-${index}`, variantId: `variant-${index}`, privateSource: "Retained SKU metadata" }],
}));
const largeWorkspace = harness();
largeWorkspace.sandbox.PortfolioMasterModel = globalThis.PortfolioMasterModel;
await largeWorkspace.sandbox.importProjectPackage(new Blob([packageBytes(largeManifest)]));
const largeStored = JSON.parse(largeWorkspace.stored.get(storageKey));
assert.ok(encoder.encode(JSON.stringify(largeStored)).length > 4 * 1024 * 1024, "real baseline generation pushes the valid imported workspace beyond the former cap");
assert.equal(largeStored.masterLocalBaseline.length, 20);
assert.equal(largeStored.categories[0].board.products[0].specs[119].value, largeManifest.categories[0].board.products[0].specs[119].value);
assert.equal(largeStored.categories[0].board.products[0].variantGroups[0].items[0].customSource, "Retained variant metadata");
assert.equal(largeStored.categories[0].board.products[0].partSkus[0].privateSource, "Retained SKU metadata");
assert.equal(largeStored.masterLocalAssetIds["variant-image"], largeStored.categories[0].board.products[0].variantGroups[0].items[0].imageAssetId, "incoming-to-local image aliases survive the large atomic commit");
assert.ok(largeWorkspace.images.has(largeStored.masterLocalAssetIds["variant-image"]));

function plaintextHarness() {
  const subject = harness();
  subject.calls.readerLoads = []; subject.calls.alerts = []; subject.calls.disconnects = 0; subject.calls.marked = [];
  subject.sandbox.FileReader = class {
    readAsText(file) { this.result = file.raw; subject.calls.readerLoads.push(this.onload()); }
  };
  subject.sandbox.PortfolioDialogs = { alert: message => subject.calls.alerts.push(message) };
  subject.sandbox.PortfolioMasterUI = { getSession: () => null, disconnect() { subject.calls.disconnects++; }, markImported(baseline) { subject.calls.marked.push(baseline); } };
  return subject;
}
const plaintext = plaintextHarness(), actualPlainStore = plaintext.sandbox.workspaceStorage;
let finishPlainCommit; const plainGate = new Promise(resolve => { finishPlainCommit = resolve; });
plaintext.sandbox.workspaceStorage = { ...actualPlainStore, save: (...args) => plainGate.then(() => actualPlainStore.save(...args)) };
plaintext.sandbox.importJson({ raw: JSON.stringify(newManifest) });
assert.equal(plaintext.sandbox.portfolio.categories[0].board.products[0].name, "Original");
assert.equal(plaintext.calls.activations.length, 0); assert.equal(plaintext.calls.disconnects, 0); assert.equal(plaintext.calls.marked.length, 0);
finishPlainCommit(); await plaintext.calls.readerLoads.at(-1);
assert.equal(plaintext.sandbox.portfolio.categories[0].board.products[0].name, "Updated"); assert.equal(JSON.parse(plaintext.stored.get(storageKey)).categories[0].board.products[0].name, "Updated");
assert.equal(plaintext.calls.disconnects, 1); assert.equal(plaintext.calls.marked.length, 1); assert.ok(plaintext.images.has("shared-image"), "plain data import preserves existing binary image library");
const plaintextFailure = plaintextHarness(); plaintextFailure.faults.storageKey = storageKey;
plaintextFailure.sandbox.importJson({ raw: JSON.stringify(newManifest) }); await plaintextFailure.calls.readerLoads.at(-1);
assert.equal(plaintextFailure.sandbox.portfolio.categories[0].board.products[0].name, "Original"); assert.equal(JSON.parse(plaintextFailure.stored.get(storageKey)).categories[0].board.products[0].name, "Original");
assert.equal(plaintextFailure.calls.activations.length, 0); assert.equal(plaintextFailure.calls.disconnects, 0); assert.equal(plaintextFailure.calls.marked.length, 0); assert.ok(plaintextFailure.calls.alerts.length, "durable plain-import failure is surfaced");

const collidingLegacyBackup = portfolioFixture("Embedded replacement", ["shared-image"]);
collidingLegacyBackup.categories[0].board.products[0].imageUrl = "data:image/png;base64,bmV3IGVtYmVkZGVkIHBpeGVscw==";
for (const failActivation of [true, false]) {
  const subject = plaintextHarness(), before = subject.stored.get(storageKey);
  subject.faults.activation = failActivation;
  subject.sandbox.importJson({ raw: JSON.stringify(collidingLegacyBackup) }); await subject.calls.readerLoads.at(-1);
  assert.equal(await subject.images.get("shared-image")?.text(), "original:shared-image", "embedded data-file images cannot overwrite or delete the previous workspace's pixels");
  if (failActivation) {
    assert.equal(subject.stored.get(storageKey), before, "failed activation restores the previous complete manifest");
    assert.equal(subject.sandbox.portfolio.categories[0].board.products[0].name, "Original");
    assert.deepEqual([...subject.images.keys()], ["shared-image"], "failed activation cleans up only newly staged identities");
  } else {
    const importedProduct = subject.sandbox.portfolio.categories[0].board.products[0];
    assert.notEqual(importedProduct.imageAssetId, "shared-image");
    assert.equal(await subject.images.get(importedProduct.imageAssetId).text(), "new embedded pixels");
    assert.equal(importedProduct.imageUrl, undefined, "the staged binary image supersedes its legacy inline copy");
    assert.equal(subject.sandbox.portfolio.imageAssets[0].id, importedProduct.imageAssetId);
    assert.equal(importedProduct.variantGroups[0].items[0].imageAssetId, importedProduct.imageAssetId, "variant references follow the isolated image identity");
  }
}

for (const failActivation of [true, false]) {
  const subject = plaintextHarness();
  const queuedOriginal = { id: "shared-image", blob: imageBlob("queued original pixels") };
  const queuedUnrelated = { id: "unrelated-pending", blob: imageBlob("unrelated retry pixels") };
  subject.sandbox.pendingLegacyImageBlobs.push(queuedOriginal, queuedUnrelated);
  subject.faults.activation = failActivation;
  subject.sandbox.importJson({ raw: JSON.stringify(collidingLegacyBackup) }); await subject.calls.readerLoads.at(-1);
  assert.equal(subject.sandbox.pendingLegacyImageBlobs.length, 2, "data import preserves previous image retry entries");
  assert.equal(subject.sandbox.pendingLegacyImageBlobs[0], queuedOriginal);
  assert.equal(subject.sandbox.pendingLegacyImageBlobs[1], queuedUnrelated);
  assert.equal(await subject.images.get("shared-image").text(), "original:shared-image");
  if (!failActivation) {
    const product = subject.sandbox.portfolio.categories[0].board.products[0];
    assert.notEqual(product.imageAssetId, "shared-image", "previous retry entries cannot suppress staging incoming pixels with the same identity");
    assert.equal(await subject.images.get(product.imageAssetId).text(), "new embedded pixels");
    assert.equal(product.imageUrl, undefined);
  }
}

for (const corrupt of [
  value => { value.categories[0].id = "unsupported-category"; },
  value => { value.categories.push(clone(value.categories[0])); },
  value => { value.categories[0].board = null; },
  value => { for (const category of value.categories) delete category.board; },
  value => { value.categories[0].board.products.push(clone(value.categories[0].board.products[0])); },
  value => { value.categories[0].board.products[0].imageAssetId = "missing-image-record"; },
]) {
  const subject = plaintextHarness(), before = subject.stored.get(storageKey), invalid = clone(newManifest);
  corrupt(invalid);
  subject.sandbox.importJson({ raw: JSON.stringify(invalid) }); await subject.calls.readerLoads.at(-1);
  assert.equal(subject.stored.get(storageKey), before, "invalid data-file preflight preserves the previous saved workspace");
  assert.equal(subject.sandbox.portfolio.categories[0].board.products[0].name, "Original");
  assert.equal(subject.calls.workspaceWrites, 0, "invalid data files never enter the replacement transaction");
  assert.equal(subject.calls.disconnects, 0); assert.equal(subject.calls.marked.length, 0);
  assert.ok(subject.calls.alerts.length, "invalid data-file replacement is explained to the user");
  assert.equal(await subject.images.get("shared-image").text(), "original:shared-image");
}

const aliasedLegacyBackup = clone(collidingLegacyBackup);
aliasedLegacyBackup.masterLocalAssetIds = { "shared-origin": "shared-image", "unrelated-origin": "untouched-image" };
aliasedLegacyBackup.masterLocalBaseline = clone(globalThis.PortfolioMasterModel.snapshot(collidingLegacyBackup).products);
const aliasedLegacyImport = plaintextHarness();
aliasedLegacyImport.sandbox.importJson({ raw: JSON.stringify(aliasedLegacyBackup) }); await aliasedLegacyImport.calls.readerLoads.at(-1);
const aliasedImageId = aliasedLegacyImport.sandbox.portfolio.categories[0].board.products[0].imageAssetId;
assert.equal(aliasedLegacyImport.sandbox.portfolio.masterLocalAssetIds["shared-origin"], aliasedImageId, "restaged inline pixels preserve shared-to-local image aliases");
assert.equal(aliasedLegacyImport.sandbox.portfolio.masterLocalAssetIds["unrelated-origin"], "untouched-image");
assert.deepEqual(clone(aliasedLegacyImport.sandbox.portfolio.masterLocalBaseline), aliasedLegacyBackup.masterLocalBaseline, "restaging does not rewrite the saved comparison baseline");

const catalogBaselineImport = plaintextHarness();
catalogBaselineImport.sandbox.importJson({ raw: `window.PORTFOLIO_CATALOG = ${JSON.stringify({ version: 1, categories: definitions })};` }); await catalogBaselineImport.calls.readerLoads.at(-1);
assert.equal(catalogBaselineImport.calls.alerts.length, 0, "the documented categories-only catalog-data.js baseline remains importable");
assert.equal(catalogBaselineImport.sandbox.portfolio.categories.length, definitions.length);
assert.ok(catalogBaselineImport.sandbox.portfolio.categories.every(category => category.board.products.length === 0));

for (const laterSurvivorEdit of [false, true]) {
  const mergeBackup = clone(collidingLegacyBackup), survivor = mergeBackup.categories[0].board.products[0];
  const keeper = { ...clone(survivor), categoryId: mergeBackup.categories[0].id, name: "Original keeper" };
  const donor = { ...clone(survivor), categoryId: mergeBackup.categories[0].id, id: "removed-source", name: "Original donor" };
  const accepted = clone(globalThis.PortfolioMasterModel.snapshot(mergeBackup).products);
  const originalGuard = globalThis.PortfolioMasterModel.productVersion(survivor);
  mergeBackup.masterLocalBaseline = accepted;
  mergeBackup.masterLocalMerges = [{ undoId: "imported-undo", productId: survivor.id, sourceProductId: donor.id,
    keeperProduct: keeper, sourceProduct: donor, base: clone(accepted[0]), sourceBase: { ...clone(accepted[0]), productId: donor.id },
    references: [], mergedVersion: originalGuard }];
  mergeBackup.masterLocalRemovedProducts = { [donor.id]: clone(donor), "independent-delete": { ...clone(donor), id: "independent-delete" } };
  if (laterSurvivorEdit) survivor.name = "Edited after merging";
  const subject = plaintextHarness(); subject.sandbox.PortfolioMasterModel = globalThis.PortfolioMasterModel;
  subject.sandbox.updateDraftViews = () => {};
  subject.sandbox.importJson({ raw: JSON.stringify(mergeBackup) }); await subject.calls.readerLoads.at(-1);
  assert.equal(subject.calls.alerts.length, 0);
  const restored = subject.sandbox.portfolio, imageId = restored.categories[0].board.products[0].imageAssetId;
  const intent = restored.masterLocalMerges[0];
  for (const record of [intent.keeperProduct, intent.sourceProduct, ...Object.values(restored.masterLocalRemovedProducts)]) {
    assert.equal(record.imageAssetId, imageId, "saved undo/deletion records follow the fresh local image identity");
    assert.equal(record.variantGroups[0].items[0].imageAssetId, imageId);
    assert.equal(record.imageUrl, undefined, "saved undo records cannot restage an obsolete inline copy");
  }
  assert.deepEqual(clone(restored.masterLocalBaseline), mergeBackup.masterLocalBaseline);
  assert.deepEqual(clone(intent.base), mergeBackup.masterLocalMerges[0].base);
  assert.deepEqual(clone(intent.sourceBase), mergeBackup.masterLocalMerges[0].sourceBase);
  if (laterSurvivorEdit) {
    assert.equal(intent.mergedVersion, originalGuard, "restaging cannot clear a genuine later-edit undo guard");
    assert.equal(subject.sandbox.undoProductMergeDraft("imported-undo"), false);
    assert.equal(restored.categories[0].board.products[0].name, "Edited after merging");
  } else {
    assert.notEqual(intent.mergedVersion, originalGuard, "an unchanged survivor's undo guard follows the isolated pixels");
    assert.equal(intent.mergedVersion, globalThis.PortfolioMasterModel.productVersion(restored.categories[0].board.products[0]));
    assert.equal(subject.sandbox.undoProductMergeDraft("imported-undo"), true, "the actual merge undo remains usable after data import");
    const undone = subject.sandbox.portfolio.categories[0].board.products;
    assert.equal(undone.length, 2); assert.deepEqual(clone(undone.map(product => product.name)), ["Original keeper", "Original donor"]);
    for (const product of undone) assert.equal(await subject.images.get(product.imageAssetId).text(), "new embedded pixels");
  }
}

const pendingBackup = portfolioFixture("Pending manual name");
pendingBackup.masterLocalBaseline = clone(globalThis.PortfolioMasterModel.snapshot(portfolioFixture("Accepted old name")).products);
pendingBackup.masterLocalMerges = [{ productId: "product-1", sourceProductId: "removed-source", choices: { name: "keeper" }, sourceProduct: { id: "removed-source", specs: [{ id: "source-spec", label: "Source", value: "Retained original" }], privateSource: "Retained donor metadata" } }];
pendingBackup.masterLocalRemovedProducts = { "removed-source": { id: "removed-source", privateSource: "Retained removed source" } };
pendingBackup.masterLocalTombstones = [{ productId: "removed-source", revisions: { "@product": 3 } }];
pendingBackup.masterLocalAssetIds = { "original-package-image": "shared-image" };
pendingBackup.plcReview = { entries: [{ row: "Retained unresolved source" }] };
pendingBackup.plcSharePending = { patches: [{ productId: "product-1", patch: { plc: { evidence: "Retained queued source" } } }] };
pendingBackup.dateLocalEdits = { "product-1": { ffsDate: { at: "2026-10-13T03:10:00Z", value: "2027-02-01" } } };
pendingBackup.privateSourceEvidence = { raw: "Full backup source evidence" };
const restoringPending = plaintextHarness(); restoringPending.sandbox.PortfolioMasterModel = globalThis.PortfolioMasterModel;
restoringPending.sandbox.importJson({ raw: JSON.stringify(pendingBackup) }); await restoringPending.calls.readerLoads.at(-1);
assert.equal(restoringPending.calls.alerts.length, 0);
const restoredPending = JSON.parse(restoringPending.stored.get(storageKey));
for (const field of ["masterLocalBaseline", "masterLocalMerges", "masterLocalRemovedProducts", "masterLocalTombstones", "masterLocalAssetIds", "plcReview", "plcSharePending", "dateLocalEdits", "privateSourceEvidence"]) assert.deepEqual(restoredPending[field], pendingBackup[field], `full data backup restores ${field} unchanged`);
assert.deepEqual(clone(restoringPending.calls.marked[0]), pendingBackup.masterLocalBaseline, "the imported session keeps the original comparison baseline");
assert.equal(restoredPending.masterLocalBaseline[0].values.name, "Accepted old name");
assert.equal(restoredPending.categories[0].board.products[0].name, "Pending manual name", "pending manual name remains distinct from its original comparison baseline");

const legacy = harness();
legacy.sandbox.pendingLegacyImageBlobs.push({ id: "already-pending", blob: imageBlob("existing pending") });
const legacyBoard = { version: 1, title: "Legacy", lanes: [{ id: "legacy-lane", label: "Products" }], products: [{ id: "legacy-product", name: "Legacy product", laneId: "legacy-lane", imageUrl: "data:image/png;base64,aW1hZ2U=", specs: [] }] };
await legacy.sandbox.importProjectPackage(new Blob([packageBytes(legacyBoard)]));
const legacyProduct = legacy.sandbox.portfolio.categories[0].board.products[0];
assert.equal(legacyProduct.name, "Legacy product");
assert.equal(await legacy.images.get(legacyProduct.imageAssetId).text(), "image");
assert.equal(legacy.sandbox.pendingLegacyImageBlobs.length, 1, "package migration must consume only its own pending image queue");
assert.equal(legacy.sandbox.pendingLegacyImageBlobs[0].id, "already-pending");

const missingExport = harness();
missingExport.images.clear();
await assert.rejects(missingExport.sandbox.exportProjectPackage(), /image.*unavailable/i);
assert.equal(missingExport.calls.downloads.length, 0, "an incomplete master must never be exported");

const exporting = harness();
let releaseExportImage;
exporting.sandbox.imageStoreGet = () => new Promise((resolve) => { releaseExportImage = resolve; });
const exportInProgress = exporting.sandbox.exportProjectPackage();
await assert.rejects(exporting.sandbox.exportProjectPackage(), /already in progress/);
await assert.rejects(exporting.sandbox.importProjectPackage(new Blob([packageBytes(newManifest)])), /already in progress/);
exporting.sandbox.portfolio.categories[0].board.products[0].name = "Edited during export";
releaseExportImage(imageBlob());
await assert.rejects(exportInProgress, /workspace changed/i);
assert.equal(exporting.calls.downloads.length, 0, "an export that races with a workspace change must be retried");
assert.equal(exporting.sandbox.packageOperationInProgress, false);

const cleared = harness();
cleared.stored.set(recoveryKey, JSON.stringify({ version: 1, portfolio: portfolioFixture("Previous") }));
const clearAction = { focus() {} };
cleared.sandbox.$ = () => clearAction;
cleared.sandbox.PortfolioDialogs = { confirm: async () => true };
cleared.sandbox.PortfolioModel.clearAllProducts = (target) => {
  target.categories.forEach((category) => { category.board.products = []; });
  target.imageAssets = [];
};
const clearHandler = appSource.match(/^\$\("#restoreSample"\)\.onclick = async \([^]*?^\};/m)?.[0];
assert.ok(clearHandler, "the application must define its explicit clear-all action");
const cancelledClear = harness();
const cancelledClearAction = {};
let resolveClearConfirmation;
cancelledClear.sandbox.$ = () => cancelledClearAction;
cancelledClear.sandbox.PortfolioDialogs = { confirm: () => new Promise((resolve) => { resolveClearConfirmation = resolve; }) };
new vm.Script(clearHandler).runInContext(cancelledClear.sandbox);
const cancelledClearData = JSON.stringify(cancelledClear.sandbox.portfolio);
const pendingClear = cancelledClearAction.onclick();
assert.equal(cancelledClear.calls.clears, 0, "clear-all must wait for the app confirmation before removing images");
assert.equal(JSON.stringify(cancelledClear.sandbox.portfolio), cancelledClearData, "an open confirmation must preserve workspace data");
resolveClearConfirmation(false);
await pendingClear;
assert.equal(cancelledClear.calls.clears, 0, "cancelling the app confirmation must preserve images");
assert.equal(JSON.stringify(cancelledClear.sandbox.portfolio), cancelledClearData, "cancelling the app confirmation must preserve products");
const changedWorkspaceClear = cancelledClearAction.onclick();
cancelledClear.sandbox.portfolio = portfolioFixture("Replacement workspace");
resolveClearConfirmation(true);
await changedWorkspaceClear;
assert.equal(cancelledClear.calls.clears, 0, "a delayed confirmation must not clear a replacement workspace");
new vm.Script(clearHandler).runInContext(cleared.sandbox);
await clearAction.onclick();
assert.equal(cleared.images.size, 0);
assert.equal(cleared.stored.has(recoveryKey), false, "clear-all must remove legacy recovery metadata after deleting its images");
assert.equal(cleared.sandbox.imageAssetGeneration, 1, "clear-all must invalidate image loads started before the deletion");

const staleLoad = harness();
let resolveImage;
staleLoad.sandbox.imageStoreGet = () => new Promise((resolve) => { resolveImage = resolve; });
staleLoad.sandbox.loadLocalImageAsset("shared-image");
const stalePromise = staleLoad.sandbox.imageAssetLoadPromises.get("shared-image");
staleLoad.sandbox.clearPackageImageCaches();
resolveImage(imageBlob());
await stalePromise;
assert.equal(staleLoad.calls.creates, 0, "a stale image load must not create a URL for the new workspace");
assert.equal(staleLoad.sandbox.imageAssetUrlCache.size, 0);

const concurrent = harness();
let releaseFile;
const delayedFile = { size: 1, arrayBuffer: () => new Promise((resolve) => { releaseFile = resolve; }) };
const pendingImport = concurrent.sandbox.importProjectPackage(delayedFile);
await assert.rejects(concurrent.sandbox.importProjectPackage(new Blob([packageBytes(newManifest)])), /already in progress/);
concurrent.sandbox.portfolio.categories[0].board.products[0].name = "Edit made while loading";
releaseFile(packageBytes(newManifest).buffer);
await assert.rejects(pendingImport, /workspace changed/i);
assert.equal(concurrent.sandbox.portfolio.categories[0].board.products[0].name, "Edit made while loading");
assert.deepEqual([...concurrent.images.keys()], ["shared-image"]);

const invalidRecoveryPortfolio = portfolioFixture("Invalid", ["legacy-image"]);
invalidRecoveryPortfolio.categories[0].board.products[0].imageAssetId = "unregistered-image";
for (const invalidRecovery of [
  "broken",
  JSON.stringify({ version: 999, portfolio: portfolioFixture("Earlier", ["legacy-image"]) }),
  JSON.stringify({ version: 1, portfolio: invalidRecoveryPortfolio }),
]) {
  const subject = harness();
  subject.stored.set(recoveryKey, invalidRecovery);
  subject.images.set("legacy-image", imageBlob("untrusted legacy"));
  await subject.sandbox.importProjectPackage(new Blob([packageBytes(portfolioFixture("Updated"))]));
  assert.equal(subject.stored.has(recoveryKey), false, "successful import must discard invalid legacy recovery metadata");
  assert.ok(subject.images.has("legacy-image"), "invalid legacy metadata must not authorize image deletion");
  assert.ok(subject.images.has(subject.sandbox.portfolio.imageAssets[0].id), "invalid legacy metadata must not interfere with importing the active package");
}

// An optional local fixture is inspected without printing private product data.
// The fixture is never copied into source or deployment output.
if (process.argv[2]) {
  const actualBytes = new Uint8Array(await readFile(process.argv[2]));
  const actualManifest = JSON.parse(decoder.decode(codec.readZip(actualBytes).get("portfolio.json")));
  const actual = harness();
  const actualResult = await actual.sandbox.importProjectPackage(new Blob([actualBytes]));
  assert.equal(actual.calls.clears, 0);
  assert.equal(actualResult.productCount, actualManifest.categories.reduce((count, category) => count + category.board.products.length, 0));
  assert.equal(actual.sandbox.portfolio.imageAssets.length, actualManifest.imageAssets.length);
  assert.ok(actual.sandbox.portfolio.imageAssets.every((asset) => asset.sourceType !== "local" || actual.images.has(asset.id)));
  console.log(`Local package fixture passed: ${actualResult.categoryCount} categories, ${actualResult.productCount} products.`);
}

console.log("Package workspace checks passed: automatically stamped update metadata, comments round trips and persistence, strict metadata/data-file preflight, complete export, encrypted and legacy import, isolated image staging/retry queues, rollback, retained merge undo/deleted-record images and stale-edit guards, canonical baselines, legacy snapshot cleanup, and bounded image cleanup.");
