/* Full local workspace records share the existing binary image database. */
(function registerWorkspaceStore(root) {
  "use strict";
  function failure(message, code, cause) { return Object.assign(new Error(message), { code, ...(cause ? { cause } : {}) }); }
  function storageFailure(error) {
    if (error?.code?.startsWith?.("WORKSPACE_")) return error;
    if (error?.name === "QuotaExceededError") return failure("This browser does not have enough storage to save the full workspace. Your open changes are not saved on this device. Export a backup before closing, then try again.", "WORKSPACE_QUOTA", error);
    return failure("This browser could not save or read the workspace. Your previous saved copy has been kept. Export any open changes before closing, then try again.", "WORKSPACE_STORAGE", error);
  }
  function create({ databaseName, databaseVersion = 2, imageStoreName = "images", workspaceStoreName = "workspaces", workspaceKey, indexedDB: suppliedDatabase } = {}) {
    if (!databaseName || !workspaceKey) throw new TypeError("A workspace database and key are required.");
    let databaseApi = suppliedDatabase;
    if (databaseApi === undefined) { try { databaseApi = root.indexedDB; } catch (_) {} }
    let opening = null, queue = Promise.resolve(), lastWrite = queue, observedSerialized;
    const recoveryRecords = new WeakMap(), recoveryReceipts = new WeakMap();
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
          tx.oncomplete = () => { observedSerialized = result; resolve(result); };
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
    function save(serialized, { images = [], isCurrent } = {}) {
      if (typeof serialized !== "string") return Promise.reject(new TypeError("The full serialized workspace is required."));
      // Capture all inputs now; a later mutation cannot change an older save.
      const imageEntries = images.map(entry => ({ id: entry.id, blob: entry.blob }));
      const job = queue.then(async () => {
        const database = await open();
        if (isCurrent && !isCurrent()) throw failure("The workspace changed while its saved copy was being prepared. Your previous saved copy has been kept. Try again.", "WORKSPACE_CHANGED");
        return new Promise((resolve, reject) => {
          let tx;
          try {
            tx = transaction(database, imageEntries.length ? [workspaceStoreName, imageStoreName] : [workspaceStoreName], "readwrite");
            let rejected = null;
            tx.oncomplete = () => { observedSerialized = serialized; resolve(); };
            tx.onerror = tx.onabort = () => reject(rejected || storageFailure(tx.error));
            const workspaces = tx.objectStore(workspaceStoreName);
            const request = workspaces.get(workspaceKey);
            request.onsuccess = () => {
              try {
                const current = request.result;
                if (current && (current.version !== 1 || typeof current.serialized !== "string")) throw failure("The saved workspace record needs recovery. It has not been replaced.", "WORKSPACE_INVALID");
                // The read and comparison share the write transaction's scope lock.
                // Another tab cannot slip a write between this check and the puts.
                if (observedSerialized !== undefined && (current?.serialized ?? null) !== observedSerialized) throw failure("Another tab saved this workspace. Your changes remain open here. Export a backup before reloading to review the other tab's changes.", "WORKSPACE_CONFLICT");
                if (isCurrent && !isCurrent()) throw failure("The workspace changed while its saved copy was being prepared. Your previous saved copy has been kept. Try again.", "WORKSPACE_CHANGED");
                if (imageEntries.length) {
                  const imageStore = tx.objectStore(imageStoreName);
                  for (const entry of imageEntries) imageStore.put({ id: entry.id, blob: entry.blob, updatedAt: Date.now() });
                }
                workspaces.put({ id: workspaceKey, version: 1, serialized, savedAt: Date.now() });
              } catch (error) { rejected = storageFailure(error); try { tx.abort(); } catch (_) {} reject(rejected); }
            };
          } catch (error) { try { tx?.abort(); } catch (_) {} reject(storageFailure(error)); }
        });
      });
      lastWrite = job;
      queue = job.catch(() => {});
      return job;
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
              observedSerialized = serialized;
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
            tx.oncomplete = () => { observedSerialized = saved.original.record?.version === 1 && typeof saved.original.record.serialized === "string" ? saved.original.record.serialized : saved.original.record === undefined ? null : undefined; recoveryReceipts.delete(receipt); resolve(); };
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
    return Object.freeze({ open, read, save, readRecovery, recover, rollbackRecovery, flush: () => lastWrite });
  }
  root.PortfolioWorkspaceStore = Object.freeze({ create, storageFailure });
})(globalThis);
