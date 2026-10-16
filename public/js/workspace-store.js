/* Full local workspace records share the existing binary image database. */
(function registerWorkspaceStore(root) {
  "use strict";
  function failure(message, code, cause) { return Object.assign(new Error(message), { code, ...(cause ? { cause } : {}) }); }
  function storageFailure(error) {
    if (error?.code?.startsWith?.("WORKSPACE_")) return error;
    if (error?.name === "QuotaExceededError") return failure("This browser does not have enough storage to save the full workspace. Your open changes are not saved on this device. Export a backup before closing, then try again.", "WORKSPACE_QUOTA", error);
    return failure("This browser could not save or read the workspace. Your previous saved copy has been kept. Export any open changes before closing, then try again.", "WORKSPACE_STORAGE", error);
  }
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const rootViewPaths = Object.freeze([
    ["activeCategoryId"], ...["roadmapBasis", "hashoutCategoryIds", "hashoutSelectedKey", "hashoutLabelMode", "hashoutWindowsVisible", "showRoadmapMsrp"].map(key => ["settings", key]),
    ["settings", "timeline", "startMonth"], ["settings", "timeline", "endMonth"],
  ]);
  function jsonSignature(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    return Array.isArray(value) ? `[${value.map(jsonSignature).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${jsonSignature(value[key])}`).join(",")}}`;
  }
  function leafAt(value, path) {
    let parent = value;
    for (const key of path.slice(0, -1)) { if (!object(parent) || !own(parent, key)) return { exists: false }; parent = parent[key]; }
    const key = path[path.length - 1]; return object(parent) && own(parent, key) ? { exists: true, value: parent[key] } : { exists: false };
  }
  function putLeaf(value, path, leaf) {
    let parent = value;
    for (const key of path.slice(0, -1)) {
      if (!object(parent)) return;
      if (!own(parent, key)) { if (!leaf.exists) return; Object.defineProperty(parent, key, { value: {}, writable: true, enumerable: true, configurable: true }); }
      // A scalar/null container is a protected fact. A view leaf cannot erase it.
      if (!object(parent[key])) return;
      parent = parent[key];
    }
    if (!object(parent)) return;
    const key = path[path.length - 1];
    if (leaf.exists) Object.defineProperty(parent, key, { value: leaf.value, writable: true, enumerable: true, configurable: true }); else delete parent[key];
  }
  function categoryMap(value) {
    if (!Array.isArray(value.categories)) return null;
    const map = new Map();
    for (const category of value.categories) { if (!object(category) || typeof category.id !== "string" || !category.id || map.has(category.id)) return null; map.set(category.id, category); }
    return map;
  }
  function reconcileViewSnapshots(baseline, proposed, current) {
    let base, ours, theirs;
    try { base = JSON.parse(baseline); ours = JSON.parse(proposed); theirs = JSON.parse(current); } catch (_) { return null; }
    if (![base, ours, theirs].every(object)) return null;
    const maps = [base, ours, theirs].map(categoryMap); if (maps.some(map => map === null)) return null;
    const viewportPath = ["settings", "hashoutViewport"], viewportKeys = ["start", "end", "zoom"];
    const discontinuedPath = ["board", "settings", "hideDiscontinued"];
    const catalogGroupPath = ["board", "settings", "catalogGroup"];
    const catalogGroups = ["all", "launched", "unreleased", "eol"];
    const catalogSelectionPath = ["board", "settings", "catalogGroups"];
    const visibilityGroups = ["all", "launched", "in-development", "in-planning", "embargo", "unreleased", "eol"];
    const validSelection = value => Array.isArray(value) && value.length <= 32 && value.every(group => visibilityGroups.includes(group)) && (!value.includes("all") || value.every(group => group === "all"));
    // These preferences are strict view leaves only. An unknown shape is not a
    // presentation-only change and cannot bypass the full-fact conflict guard.
    if (maps.some(map => [...map.values()].some(category => {
      const leaf = leafAt(category, discontinuedPath);
      const group = leafAt(category, catalogGroupPath);
      const selection = leafAt(category, catalogSelectionPath);
      return leaf.exists && typeof leaf.value !== "boolean" || group.exists && !catalogGroups.includes(group.value) || selection.exists && !validSelection(selection.value);
    }))) return null;
    const categoryPaths = [...new Set(maps.flatMap(map => [...map.keys()]))].flatMap(id => [...["startMonth", "endMonth"].map(key => ({ id, path: ["board", "settings", "roadmap", key] })), ...["showPrices", "showSkus", "hideDiscontinued", "catalogGroup", "catalogGroups"].map(key => ({ id, path: ["board", "settings", key] }))]);
    const pruneEmptyContainer = (value, path) => { const leaf = leafAt(value, path); if (leaf.exists && object(leaf.value) && Object.keys(leaf.value).length === 0) putLeaf(value, path, { exists: false }); };
    const withoutViews = value => {
      const copy = JSON.parse(JSON.stringify(value));
      for (const path of rootViewPaths) putLeaf(copy, path, { exists: false });
      const viewport = leafAt(copy, viewportPath);
      if (viewport.exists && viewport.value === null) putLeaf(copy, viewportPath, { exists: false });
      else if (viewport.exists && object(viewport.value)) { for (const key of viewportKeys) delete viewport.value[key]; if (!Object.keys(viewport.value).length) putLeaf(copy, viewportPath, { exists: false }); }
      const categories = categoryMap(copy);
      for (const { id, path } of categoryPaths) { const category = categories.get(id); if (category) putLeaf(category, path, { exists: false }); }
      // Normalize only empty known view containers in this comparison projection.
      // Unknown children and null/scalar containers remain protected facts; the
      // selected full record, never this projection, supplies persisted data.
      pruneEmptyContainer(copy, ["settings", "timeline"]); pruneEmptyContainer(copy, ["settings"]);
      for (const category of categories.values()) { pruneEmptyContainer(category, ["board", "settings", "roadmap"]); pruneEmptyContainer(category, ["board", "settings"]); }
      return jsonSignature(copy);
    };
    const baseFacts = withoutViews(base), oursFacts = withoutViews(ours), theirsFacts = withoutViews(theirs);
    let result;
    if (theirsFacts === baseFacts) result = JSON.parse(proposed);
    else if (oursFacts === baseFacts) result = JSON.parse(current);
    else return null;
    const mergeLeaf = (target, before, mine, latest, path) => { const oursLeaf = leafAt(mine, path); putLeaf(target, path, jsonSignature(oursLeaf) === jsonSignature(leafAt(before, path)) ? leafAt(latest, path) : oursLeaf); };
    for (const path of rootViewPaths) mergeLeaf(result, base, ours, theirs, path);
    const viewportView = value => { const leaf = leafAt(value, viewportPath); if (!leaf.exists || !object(leaf.value)) return leaf; return { exists: true, value: Object.fromEntries(viewportKeys.filter(key => own(leaf.value, key)).map(key => [key, leaf.value[key]])) }; };
    const oursViewport = viewportView(ours), desiredViewport = jsonSignature(oursViewport) === jsonSignature(viewportView(base)) ? viewportView(theirs) : oursViewport;
    let targetViewport = leafAt(result, viewportPath);
    if (!desiredViewport.exists || desiredViewport.value === null) {
      if (targetViewport.exists && object(targetViewport.value) && Object.keys(targetViewport.value).some(key => !viewportKeys.includes(key))) { for (const key of viewportKeys) delete targetViewport.value[key]; }
      else putLeaf(result, viewportPath, desiredViewport);
    } else if (object(desiredViewport.value)) {
      if (!targetViewport.exists || targetViewport.value === null) { putLeaf(result, viewportPath, { exists: true, value: {} }); targetViewport = leafAt(result, viewportPath); }
      if (targetViewport.exists && object(targetViewport.value)) for (const key of viewportKeys) putLeaf(targetViewport.value, [key], leafAt(desiredViewport.value, [key]));
    }
    const resultCategories = categoryMap(result);
    for (const { id, path } of categoryPaths) {
      const target = resultCategories.get(id); if (!target) continue; // Never resurrect a removed category.
      mergeLeaf(target, maps[0].get(id), maps[1].get(id), maps[2].get(id), path);
    }
    return JSON.stringify(result);
  }
  function create({ databaseName, databaseVersion = 2, imageStoreName = "images", workspaceStoreName = "workspaces", workspaceKey, indexedDB: suppliedDatabase } = {}) {
    if (!databaseName || !workspaceKey) throw new TypeError("A workspace database and key are required.");
    let databaseApi = suppliedDatabase;
    if (databaseApi === undefined) { try { databaseApi = root.indexedDB; } catch (_) {} }
    let opening = null, queue = Promise.resolve(), lastWrite = queue, observedSerialized, writeSequence = 0, observationVersion = 0;
    const recoveryRecords = new WeakMap(), recoveryReceipts = new WeakMap(), reconciledReceipts = new WeakMap();
    const localCopiesKey = `${workspaceKey}:local-conflict-manifest:v1`;
    function localCopyManifest(value) {
      if (value === undefined) return { id: localCopiesKey, version: 1, sets: [] };
      const invalid = () => failure("The preserved local-copy list cannot be read safely. Its existing copies have been kept. Export or repair the local copies before resolving another conflict.", "WORKSPACE_LOCAL_COPIES_INVALID");
      if (!object(value) || value.id !== localCopiesKey || value.version !== 1 || !Array.isArray(value.sets)) throw invalid();
      const ids = new Set();
      for (const set of value.sets) {
        if (!object(set) || typeof set.id !== "string" || set.id.length > 500 || !set.id.startsWith(`${workspaceKey}:local-conflict:`) || typeof set.at !== "string" || set.at.length > 40 || !Number.isFinite(Date.parse(set.at)) || !Array.isArray(set.copies) || set.copies.length !== 2) throw invalid();
        for (const [index, copy] of set.copies.entries()) { if (!object(copy) || copy.kind !== (index === 0 ? "open" : "saved") || copy.id !== `${set.id}:${copy.kind}` || copy.at !== set.at || ids.has(copy.id)) throw invalid(); ids.add(copy.id); }
      }
      return cloneRecord(value);
    }
    function recordSignature(value) {
      const active = new Set();
      const encode = item => {
        if (item === null || typeof item !== "object") return [typeof item, typeof item === "number" && (Object.is(item, -0) || !Number.isFinite(item)) ? Object.is(item, -0) ? "-0" : String(item) : typeof item === "bigint" ? String(item) : item];
        if (active.has(item) || Object.prototype.toString.call(item) !== "[object Object]" && !Array.isArray(item)) throw failure("The saved recovery record cannot be compared safely. It has not been replaced.", "WORKSPACE_RECOVERY_INVALID");
        active.add(item);
        const result = Array.isArray(item) ? ["array", item.length, Object.keys(item).map(key => [key, encode(item[key])])] : ["object", Object.keys(item).sort().map(key => [key, encode(item[key])])];
        active.delete(item); return result;
      };
      return JSON.stringify(encode(value));
    }
    function cloneRecord(value) {
      if (typeof root.structuredClone === "function") return root.structuredClone(value);
      if (value === null || typeof value !== "object") return value;
      const result = Array.isArray(value) ? new Array(value.length) : {};
      for (const key of Object.keys(value)) Object.defineProperty(result, key, { value: cloneRecord(value[key]), enumerable: true, writable: true, configurable: true });
      return result;
    }
    function queued(job) { const pending = queue.then(job); lastWrite = pending; queue = pending.catch(() => {}); return pending; }
    function open() {
      if (opening) return opening;
      const attempt = new Promise((resolve, reject) => {
        if (!databaseApi) { reject(failure("This browser cannot open saved workspace storage. Your existing data has not been replaced. Try reopening the portfolio in a browser that allows local storage.", "WORKSPACE_UNAVAILABLE")); return; }
        let request, settled = false;
        const fail = error => { if (!settled) { settled = true; reject(storageFailure(error)); } };
        try { request = databaseApi.open(databaseName, databaseVersion); }
        catch (error) { fail(error); return; }
        request.onupgradeneeded = () => {
          try {
            const database = request.result;
            if (!database.objectStoreNames.contains(imageStoreName)) database.createObjectStore(imageStoreName, { keyPath: "id" });
            if (!database.objectStoreNames.contains(workspaceStoreName)) database.createObjectStore(workspaceStoreName, { keyPath: "id" });
          } catch (error) { request.transaction?.abort(); fail(error); }
        };
        request.onblocked = () => fail(failure("Another open portfolio tab is preventing saved storage from opening. Close the other tab, then retry. Your saved data has not been replaced.", "WORKSPACE_BLOCKED"));
        request.onerror = () => fail(request.error || new Error("Workspace storage could not open."));
        request.onsuccess = () => {
          const database = request.result;
          if (settled) { database.close(); return; }
          settled = true;
          database.onversionchange = () => { database.close(); if (opening === attempt) opening = null; };
          resolve(database);
        };
      });
      opening = attempt;
      void attempt.catch(() => { if (opening === attempt) opening = null; });
      return attempt;
    }
    function transaction(database, stores, mode) {
      if (mode !== "readwrite") return database.transaction(stores, mode);
      try { return database.transaction(stores, mode, { durability: "strict" }); }
      catch (error) { if (!(error instanceof TypeError) && error?.name !== "TypeError") throw error; return database.transaction(stores, mode); }
    }
    async function read() {
      await queue;
      const database = await open();
      return new Promise((resolve, reject) => {
        let result = null, tx;
        try {
          tx = transaction(database, [workspaceStoreName], "readonly");
          tx.oncomplete = () => { observedSerialized = result; observationVersion += 1; resolve(result); };
          tx.onerror = tx.onabort = () => reject(storageFailure(tx.error));
          const request = tx.objectStore(workspaceStoreName).get(workspaceKey);
          request.onsuccess = () => {
            const record = request.result;
            if (!record) return;
            if (record.version !== 1 || typeof record.serialized !== "string") { tx.abort(); reject(failure("The saved workspace record could not be read. It has not been replaced. Restore a backup or retry opening it.", "WORKSPACE_INVALID")); return; }
            result = record.serialized;
          };
        } catch (error) { reject(storageFailure(error)); }
      });
    }
    function save(serialized, { images = [], isCurrent, reconcileViews = false } = {}) {
      if (typeof serialized !== "string") return Promise.reject(new TypeError("The full serialized workspace is required."));
      // Capture all inputs now; a later mutation cannot change an older save.
      const imageEntries = images.map(entry => ({ id: entry.id, blob: entry.blob }));
      const job = queue.then(async () => {
        const database = await open();
        if (isCurrent && !isCurrent()) throw failure("The workspace changed while its saved copy was being prepared. Your previous saved copy has been kept. Try again.", "WORKSPACE_CHANGED");
        return new Promise((resolve, reject) => {
          let tx, actualSerialized = serialized, reconciled = false;
          try {
            tx = transaction(database, imageEntries.length ? [workspaceStoreName, imageStoreName] : [workspaceStoreName], "readwrite");
            let rejected = null;
            tx.oncomplete = () => {
              writeSequence += 1; observationVersion += 1;
              // A merged durable copy is not yet the host's open full copy.
              // Keep its known proposal as the comparison origin until the host
              // explicitly confirms it activated every newly retained fact.
              observedSerialized = reconciled && actualSerialized !== serialized ? serialized : actualSerialized;
              const receipt = Object.freeze({ serialized: actualSerialized, reconciled });
              if (reconciled) reconciledReceipts.set(receipt, { requested: serialized, actual: actualSerialized, sequence: writeSequence, observationVersion });
              resolve(receipt);
            };
            tx.onerror = tx.onabort = () => reject(rejected || storageFailure(tx.error));
            const workspaces = tx.objectStore(workspaceStoreName);
            const request = workspaces.get(workspaceKey);
            request.onsuccess = () => {
              try {
                const current = request.result;
                if (current && (current.version !== 1 || typeof current.serialized !== "string")) throw failure("The saved workspace record needs recovery. It has not been replaced.", "WORKSPACE_INVALID");
                // The read and comparison share the write transaction's scope lock.
                // Another tab cannot slip a write between this check and the puts.
                const currentSerialized = current?.serialized ?? null;
                // A second tab may already have saved these exact bytes. Confirm
                // that no pixels need staging before accepting it without a put.
                const alreadySaved = !imageEntries.length && currentSerialized === serialized;
                if (observedSerialized !== undefined && currentSerialized !== observedSerialized && !alreadySaved) {
                  const merged = reconcileViews === true && !imageEntries.length && typeof observedSerialized === "string" && typeof currentSerialized === "string" ? reconcileViewSnapshots(observedSerialized, serialized, currentSerialized) : null;
                  if (merged === null) throw failure("Another portfolio tab in this browser saved a different local copy. Your edits remain open here. Export a backup before reloading to review the saved copy.", "WORKSPACE_CONFLICT");
                  actualSerialized = merged; reconciled = true;
                }
                if (isCurrent && !isCurrent()) throw failure("The workspace changed while its saved copy was being prepared. Your previous saved copy has been kept. Try again.", "WORKSPACE_CHANGED");
                if (alreadySaved || !imageEntries.length && actualSerialized === currentSerialized) return;
                if (imageEntries.length) {
                  const imageStore = tx.objectStore(imageStoreName);
                  for (const entry of imageEntries) imageStore.put({ id: entry.id, blob: entry.blob, updatedAt: Date.now() });
                }
                workspaces.put({ id: workspaceKey, version: 1, serialized: actualSerialized, savedAt: Date.now() });
              } catch (error) { rejected = storageFailure(error); try { tx.abort(); } catch (_) {} reject(rejected); }
            };
          } catch (error) { try { tx?.abort(); } catch (_) {} reject(storageFailure(error)); }
        });
      });
      lastWrite = job;
      queue = job.catch(() => {});
      return job;
    }
    function acknowledgeReconciled(receipt) {
      const saved = reconciledReceipts.get(receipt);
      if (!saved) throw failure("The original reconciled-save receipt is required to adopt this local copy.", "WORKSPACE_RECONCILE_INVALID");
      if (saved.sequence !== writeSequence || saved.observationVersion !== observationVersion || observedSerialized !== saved.requested) throw failure("A newer local storage operation superseded this save receipt. Review the current local copy before saving again.", "WORKSPACE_RECONCILE_STALE");
      observedSerialized = saved.actual; observationVersion += 1; reconciledReceipts.delete(receipt); return true;
    }
    async function readRecovery() {
      await queue;
      const database = await open();
      return new Promise((resolve, reject) => {
        let tx, record;
        try {
          tx = transaction(database, [workspaceStoreName], "readonly");
          tx.onerror = tx.onabort = () => reject(storageFailure(tx.error));
          tx.oncomplete = () => {
            try {
              const signature = recordSignature(record);
              const rawText = typeof record?.serialized === "string" ? record.serialized : record === undefined ? null : JSON.stringify(record, null, 2);
              const token = Object.freeze({ record: cloneRecord(record), rawText });
              recoveryRecords.set(token, { record: cloneRecord(record), signature, rawText });
              resolve(token);
            } catch (error) { reject(storageFailure(error)); }
          };
          const request = tx.objectStore(workspaceStoreName).get(workspaceKey);
          request.onsuccess = () => { record = request.result; };
        } catch (error) { reject(storageFailure(error)); }
      });
    }
    function recover(serialized, { recovery, images = [], isCurrent } = {}) {
      const original = recoveryRecords.get(recovery);
      if (!original || typeof serialized !== "string") return Promise.reject(failure("Review the saved record and backup again before restoring it.", "WORKSPACE_RECOVERY_INVALID"));
      const imageEntries = images.map(entry => ({ id: entry.id, blob: entry.blob })), ids = new Set(imageEntries.map(entry => entry.id));
      if (ids.size !== imageEntries.length || imageEntries.some(entry => typeof entry.id !== "string" || !entry.id)) return Promise.reject(failure("Restored images need distinct new identities.", "WORKSPACE_RECOVERY_IMAGES"));
      const nonce = root.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const archiveKey = `${workspaceKey}:recovery:${nonce}`, replacement = { id: workspaceKey, version: 1, serialized, savedAt: Date.now(), recoveryArchiveKey: archiveKey };
      return queued(async () => {
        const database = await open();
        if (isCurrent && !isCurrent()) throw failure("The recovery changed while the backup was being prepared. Review it again.", "WORKSPACE_CHANGED");
        return new Promise((resolve, reject) => {
          let tx, rejected;
          const fail = error => { rejected = storageFailure(error); try { tx?.abort(); } catch (_) {} reject(rejected); };
          try {
            tx = transaction(database, imageEntries.length ? [workspaceStoreName, imageStoreName] : [workspaceStoreName], "readwrite");
            tx.onerror = tx.onabort = () => reject(rejected || storageFailure(tx.error));
            tx.oncomplete = () => {
              observedSerialized = serialized; writeSequence += 1; observationVersion += 1;
              const receipt = Object.freeze({ archiveKey });
              recoveryReceipts.set(receipt, { original, replacementSignature: recordSignature(replacement), imageIds: [...ids], nonce, archiveKey });
              recoveryRecords.delete(recovery); resolve(receipt);
            };
            const workspaces = tx.objectStore(workspaceStoreName), request = workspaces.get(workspaceKey);
            request.onsuccess = () => {
              try {
                if (recordSignature(request.result) !== original.signature) throw failure("Another tab changed the saved record. Its data has been kept. Review a fresh recovery copy before restoring.", "WORKSPACE_CONFLICT");
                if (isCurrent && !isCurrent()) throw failure("The recovery changed while the backup was being prepared. Review it again.", "WORKSPACE_CHANGED");
                const commit = () => {
                  try {
                    if (isCurrent && !isCurrent()) throw failure("The recovery changed while the backup was being prepared. Review it again.", "WORKSPACE_CHANGED");
                    // Keep the exact old structured record even if later activation
                    // and rollback both fail. This archive never becomes the live key.
                    workspaces.put({ id: archiveKey, version: 1, recoveryFor: workspaceKey, record: cloneRecord(original.record), rawText: original.rawText, savedAt: Date.now() });
                    if (imageEntries.length) for (const entry of imageEntries) tx.objectStore(imageStoreName).put({ id: entry.id, blob: entry.blob, updatedAt: Date.now(), recoveryOwner: nonce });
                    workspaces.put(replacement);
                  } catch (error) { fail(error); }
                };
                if (!imageEntries.length) { commit(); return; }
                let pending = imageEntries.length;
                for (const entry of imageEntries) {
                  const check = tx.objectStore(imageStoreName).get(entry.id);
                  check.onsuccess = () => {
                    if (rejected) return;
                    if (check.result !== undefined) { fail(failure("A restored image identity already exists. Prepare the backup again so its pixels stay separate.", "WORKSPACE_RECOVERY_IMAGES")); return; }
                    if (--pending === 0) commit();
                  };
                }
              } catch (error) { fail(error); }
            };
          } catch (error) { fail(error); }
        });
      });
    }
    function rollbackRecovery(receipt, { isCurrent } = {}) {
      const saved = recoveryReceipts.get(receipt);
      if (!saved) return Promise.reject(failure("The original recovery receipt is required to restore the previous record.", "WORKSPACE_RECOVERY_INVALID"));
      return queued(async () => {
        const database = await open();
        if (isCurrent && !isCurrent()) throw failure("The workspace changed after recovery. Its newer data has been kept.", "WORKSPACE_CHANGED");
        return new Promise((resolve, reject) => {
          let tx, rejected;
          const fail = error => { rejected = storageFailure(error); try { tx?.abort(); } catch (_) {} reject(rejected); };
          try {
            tx = transaction(database, saved.imageIds.length ? [workspaceStoreName, imageStoreName] : [workspaceStoreName], "readwrite");
            tx.onerror = tx.onabort = () => reject(rejected || storageFailure(tx.error));
            tx.oncomplete = () => { observedSerialized = saved.original.record?.version === 1 && typeof saved.original.record.serialized === "string" ? saved.original.record.serialized : saved.original.record === undefined ? null : undefined; writeSequence += 1; observationVersion += 1; recoveryReceipts.delete(receipt); resolve(); };
            const workspaces = tx.objectStore(workspaceStoreName), request = workspaces.get(workspaceKey);
            request.onsuccess = () => {
              try {
                if (recordSignature(request.result) !== saved.replacementSignature) throw failure("Another operation saved after recovery. Its data has been kept; the original record remains in the recovery archive.", "WORKSPACE_CONFLICT");
                if (isCurrent && !isCurrent()) throw failure("The workspace changed after recovery. Its newer data has been kept.", "WORKSPACE_CHANGED");
                const restore = () => {
                  try {
                    if (isCurrent && !isCurrent()) throw failure("The workspace changed after recovery. Its newer data has been kept.", "WORKSPACE_CHANGED");
                    if (saved.original.record === undefined) workspaces.delete(workspaceKey); else workspaces.put(cloneRecord(saved.original.record));
                    for (const id of saved.imageIds) tx.objectStore(imageStoreName).delete(id);
                    workspaces.delete(saved.archiveKey);
                  } catch (error) { fail(error); }
                };
                if (!saved.imageIds.length) { restore(); return; }
                let pending = saved.imageIds.length;
                for (const id of saved.imageIds) {
                  const check = tx.objectStore(imageStoreName).get(id);
                  check.onsuccess = () => {
                    if (rejected) return;
                    if (check.result?.recoveryOwner !== saved.nonce) { fail(failure("Recovered pixels changed after restoration. They have been kept with the recovery archive.", "WORKSPACE_CONFLICT")); return; }
                    if (--pending === 0) restore();
                  };
                }
              } catch (error) { fail(error); }
            };
          } catch (error) { fail(error); }
        });
      });
    }
    function resolveLocalConflict(openSerialized, { recovery, prefer, isCurrent, requireAdoption = false, adoptionBaseline } = {}) {
      const original = recoveryRecords.get(recovery);
      if (!original || typeof openSerialized !== "string" || !["open", "saved"].includes(prefer) || original.record?.version !== 1 || typeof original.record.serialized !== "string") return Promise.reject(failure("Review both local copies again before resolving this conflict.", "WORKSPACE_RECOVERY_INVALID"));
      if (requireAdoption === true) {
        try { if (typeof adoptionBaseline !== "string") throw new TypeError(); JSON.parse(adoptionBaseline); }
        catch (_) { return Promise.reject(failure("The open workspace baseline is required before adopting a preserved local copy. Review both copies again.", "WORKSPACE_RECOVERY_INVALID")); }
      }
      const nonce = root.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const setId = `${workspaceKey}:local-conflict:${nonce}`, at = new Date().toISOString();
      const copies = ["open", "saved"].map(kind => ({ id: `${setId}:${kind}`, at, kind }));
      const selected = prefer === "open" ? openSerialized : original.record.serialized;
      return queued(async () => {
        const database = await open();
        if (isCurrent && !isCurrent()) throw failure("The open workspace changed during local-copy review. Review both copies again.", "WORKSPACE_CHANGED");
        return new Promise((resolve, reject) => {
          let tx, rejected;
          const fail = error => { rejected = storageFailure(error); try { tx?.abort(); } catch (_) {} reject(rejected); };
          try {
            tx = transaction(database, [workspaceStoreName], "readwrite");
            tx.onerror = tx.onabort = () => reject(rejected || storageFailure(tx.error));
            tx.oncomplete = () => {
              writeSequence += 1; observationVersion += 1;
              // Restoring an archive can select a different full copy from the
              // actual open owner. Do not mistake durable completion for host
              // adoption; a newer owner edit may arrive before its await resumes.
              observedSerialized = requireAdoption === true ? adoptionBaseline : selected;
              const receipt = Object.freeze({ serialized: selected, copies: copies.map(copy => ({ ...copy })), ...(requireAdoption === true ? { requiresAcknowledgement: true } : {}) });
              if (requireAdoption === true) reconciledReceipts.set(receipt, { requested: adoptionBaseline, actual: selected, sequence: writeSequence, observationVersion });
              recoveryRecords.delete(recovery); resolve(receipt);
            };
            const workspaces = tx.objectStore(workspaceStoreName), values = new Map(); let pending = 4;
            for (const key of [workspaceKey, localCopiesKey, ...copies.map(copy => copy.id)]) {
              const request = workspaces.get(key);
              request.onsuccess = () => {
                values.set(key, request.result); if (--pending || rejected) return;
                try {
                  if (recordSignature(values.get(workspaceKey)) !== original.signature) throw failure("Another tab changed the saved local copy during review. Both newer data and your open edits have been kept. Review fresh copies before choosing.", "WORKSPACE_CONFLICT");
                  if (isCurrent && !isCurrent()) throw failure("The open workspace changed during local-copy review. Review both copies again.", "WORKSPACE_CHANGED");
                  const manifest = localCopyManifest(values.get(localCopiesKey));
                  if (copies.some(copy => values.get(copy.id) !== undefined)) throw failure("A preserved local copy already uses this identity. No data was replaced. Review fresh copies and try again.", "WORKSPACE_CONFLICT");
                  const nextManifest = { ...manifest, sets: [...manifest.sets, { id: setId, at, copies: copies.map(copy => ({ ...copy })) }] };
                  const openRecord = { id: workspaceKey, version: 1, serialized: openSerialized };
                  for (const copy of copies) workspaces.put({ id: copy.id, version: 1, conflictFor: workspaceKey, conflictSetId: setId, kind: copy.kind, at, serialized: copy.kind === "open" ? openSerialized : original.record.serialized, record: cloneRecord(copy.kind === "open" ? openRecord : original.record) });
                  workspaces.put(nextManifest);
                  // Choosing saved retains its exact structured record, including
                  // metadata outside serialized JSON. Both choices retain archives.
                  workspaces.put(prefer === "saved" ? cloneRecord(original.record) : { id: workspaceKey, version: 1, serialized: openSerialized, savedAt: Date.now(), localConflictSetId: setId });
                } catch (error) { fail(error); }
              };
            }
          } catch (error) { fail(error); }
        });
      });
    }
    async function listLocalCopies() {
      await queue;
      const database = await open();
      return new Promise((resolve, reject) => {
        let tx, rejected; const result = [];
        const fail = error => { rejected = storageFailure(error); try { tx?.abort(); } catch (_) {} reject(rejected); };
        try {
          tx = transaction(database, [workspaceStoreName], "readonly");
          tx.onerror = tx.onabort = () => reject(rejected || storageFailure(tx.error));
          tx.oncomplete = () => resolve(result);
          const workspaces = tx.objectStore(workspaceStoreName), request = workspaces.get(localCopiesKey);
          request.onsuccess = () => {
            try {
              const manifest = localCopyManifest(request.result), expected = manifest.sets.slice().reverse().flatMap(set => set.copies);
              for (const copy of expected) {
                const entry = workspaces.get(copy.id);
                entry.onsuccess = () => {
                  try {
                    const record = entry.result;
                    if (!record || record.version !== 1 || record.conflictFor !== workspaceKey || record.kind !== copy.kind || record.at !== copy.at || typeof record.serialized !== "string") throw failure("A preserved local copy could not be read safely. Its stored record has been kept.", "WORKSPACE_LOCAL_COPIES_INVALID");
                    result.push({ id: copy.id, at: copy.at, kind: copy.kind, serialized: record.serialized });
                  } catch (error) { fail(error); }
                };
              }
            } catch (error) { fail(error); }
          };
        } catch (error) { fail(error); }
      });
    }
    function deleteUnusedImages(ids) {
      if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id)) return Promise.reject(new TypeError("Image cleanup requires image identities."));
      const requested = [...new Set(ids)];
      return queued(async () => {
        const database = await open();
        return new Promise((resolve, reject) => {
          let tx, rejected; const protectedIds = new Set(), receipt = { deleted: [], retained: [] };
          const fail = error => { rejected = storageFailure(error); try { tx?.abort(); } catch (_) {} reject(rejected); };
          const collect = value => {
            const pending = [value], seen = new Set();
            while (pending.length) {
              const item = pending.pop(); if (!item || typeof item !== "object" || seen.has(item)) continue; seen.add(item);
              if (typeof item.imageAssetId === "string" && item.imageAssetId) protectedIds.add(item.imageAssetId);
              if (Array.isArray(item.imageAssets)) for (const asset of item.imageAssets) if (asset && typeof asset.id === "string" && asset.id) protectedIds.add(asset.id);
              for (const key of Object.keys(item)) if (item[key] && typeof item[key] === "object") pending.push(item[key]);
            }
          };
          const collectRecord = record => {
            if (!record || record.version !== 1 || typeof record.serialized !== "string") throw failure("Saved local data could not be inspected safely for image references. All requested images have been kept.", "WORKSPACE_LOCAL_COPIES_INVALID");
            let parsed; try { parsed = JSON.parse(record.serialized); } catch (_) { throw failure("A saved local copy could not be parsed for image references. All requested images have been kept.", "WORKSPACE_LOCAL_COPIES_INVALID"); }
            collect(parsed); collect(record);
          };
          try {
            // Sharing the workspace lock with archive creation closes the gap
            // between reference inspection and deletion. No semantic data puts.
            tx = transaction(database, [workspaceStoreName, imageStoreName], "readwrite");
            tx.onerror = tx.onabort = () => reject(rejected || storageFailure(tx.error));
            tx.oncomplete = () => resolve(receipt);
            const workspaces = tx.objectStore(workspaceStoreName), values = new Map(); let pending = 2;
            const finish = () => { if (rejected) return; try { const images = tx.objectStore(imageStoreName); for (const id of requested) { if (protectedIds.has(id)) receipt.retained.push(id); else { images.delete(id); receipt.deleted.push(id); } } } catch (error) { fail(error); } };
            for (const key of [workspaceKey, localCopiesKey]) {
              const request = workspaces.get(key);
              request.onsuccess = () => {
                values.set(key, request.result); if (--pending || rejected) return;
                try {
                  if (values.get(workspaceKey) !== undefined) collectRecord(values.get(workspaceKey));
                  const manifest = localCopyManifest(values.get(localCopiesKey)), copies = manifest.sets.flatMap(set => set.copies);
                  if (!copies.length) { finish(); return; }
                  let remaining = copies.length;
                  for (const copy of copies) {
                    const archived = workspaces.get(copy.id);
                    archived.onsuccess = () => {
                      if (rejected) return;
                      try { const record = archived.result; if (!record || record.conflictFor !== workspaceKey || record.kind !== copy.kind || record.at !== copy.at) throw failure("A preserved local copy could not be inspected safely. All requested images have been kept.", "WORKSPACE_LOCAL_COPIES_INVALID"); collectRecord(record); if (--remaining === 0) finish(); } catch (error) { fail(error); }
                    };
                  }
                } catch (error) { fail(error); }
              };
            }
          } catch (error) { fail(error); }
        });
      });
    }
    return Object.freeze({ open, read, save, acknowledgeReconciled, readRecovery, recover, rollbackRecovery, resolveLocalConflict, listLocalCopies, deleteUnusedImages, flush: () => lastWrite });
  }
  root.PortfolioWorkspaceStore = Object.freeze({ create, storageFailure });
})(globalThis);
