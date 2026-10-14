/* Independent browser source storage. This module contains no workbook data. */
(function (root) {
  'use strict';
  const DATABASE = 'ppc-blueprint-analytics-v1', STORE = 'source';
  let databasePromise;
  function validate(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.source || !Array.isArray(snapshot.sheets) ||
        !Array.isArray(snapshot.products) || !snapshot.products.length || !Array.isArray(snapshot.periods) || !snapshot.periods.length ||
        !Array.isArray(snapshot.categories) || !Array.isArray(snapshot.investments)) throw new Error('The workbook has no supported Blueprint source.');
    if (!snapshot.periods.every(period => Number.isInteger(Number(period)) && Number(period) >= 1900 && Number(period) <= 2200) ||
        !snapshot.products.every(product => product && typeof product === 'object' && product.revenueByYear && product.gmByYear && product.unitsByYear)) {
      throw new Error('The workbook planning records are incomplete.');
    }
    return snapshot;
  }
  function open() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('Browser storage is unavailable. Your current source was kept.')); return; }
      const request = root.indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); databasePromise = null; };
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error('The browser source could not be opened.'));
      request.onblocked = () => reject(new Error('Close an older Blueprint tab to save this source.'));
    }).catch(error => { databasePromise = null; throw error; });
    return databasePromise;
  }
  async function transaction(mode, snapshot) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode), store = transaction.objectStore(STORE);
      const request = mode === 'readonly' ? store.get('current') : store.put({ version: 1, snapshot }, 'current');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error || new Error('The source could not be saved locally. Your previous source was kept.'));
      transaction.onabort = () => reject(transaction.error || new Error('The source save was interrupted. Your previous source was kept.'));
    });
  }
  root.HX_SOURCE_STORE = Object.freeze({
    validate,
    async restore() {
      const record = await transaction('readonly');
      if (!record) return null;
      if (record.version !== 1) throw new Error('The saved Blueprint source uses an unsupported version. Import the workbook again.');
      return validate(record.snapshot);
    },
    async save(snapshot) { validate(snapshot); await transaction('readwrite', snapshot); return snapshot; }
  });
  root.HX_SOURCE_READY = root.HX_SOURCE_STORE.restore().then(snapshot => ({ snapshot, error: null }), error => ({ snapshot: null, error }));
})(window);
