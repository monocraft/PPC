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
    let opening = null, queue = Promise.resolve(), lastWrite = queue;
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
          tx.oncomplete = () => resolve(result);
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
            tx.oncomplete = () => resolve();
            tx.onerror = tx.onabort = () => reject(storageFailure(tx.error));
            if (imageEntries.length) {
              const imageStore = tx.objectStore(imageStoreName);
              for (const entry of imageEntries) imageStore.put({ id: entry.id, blob: entry.blob, updatedAt: Date.now() });
            }
            tx.objectStore(workspaceStoreName).put({ id: workspaceKey, version: 1, serialized, savedAt: Date.now() });
          } catch (error) { try { tx?.abort(); } catch (_) {} reject(storageFailure(error)); }
        });
      });
      lastWrite = job;
      queue = job.catch(() => {});
      return job;
    }
    return Object.freeze({ open, read, save, flush: () => lastWrite });
  }
  root.PortfolioWorkspaceStore = Object.freeze({ create, storageFailure });
})(globalThis);
