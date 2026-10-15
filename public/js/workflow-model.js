/* Local workflow preferences and file identification. No network or portfolio writes. */
(function (root) {
  'use strict';
  const fields = ['globalAnnouncementDate', 'webReadinessDate', 'finalAssetsDate', 'ffsDate', 'generalAvailabilityDate', 'endManufacturingDate'];
  const key = 'ppc-field-protection-v1';
  const boundedId = value => typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\u0000-\u001f]/.test(value);
  const identity = value => JSON.stringify([value.categoryId, value.productId, value.variantId || '', value.field]);
  function protectionStore(storage) {
    let loaded = false, blocked = false, recovered = false, lastRaw, records = new Map();
    const parse = raw => {
      if (!raw || raw.length > 500000) throw Error('Invalid protection settings.');
      const value = JSON.parse(raw);
      if (value.version !== 1 || !Array.isArray(value.records) || value.records.length > 2000) throw Error('Invalid protection settings.');
      const next = new Map();
      for (const row of value.records) {
        if (!row || !boundedId(row.categoryId) || !boundedId(row.productId) || !fields.includes(row.field) || typeof row.variantId !== 'string' || row.variantId.length > 240 || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))) throw Error('Invalid field protection.');
        const id = identity(row); if (next.has(id)) throw Error('Duplicate field protection.');
        next.set(id, { categoryId: row.categoryId, productId: row.productId, variantId: row.variantId, field: row.field, at: row.at });
      }
      return next;
    };
    function load() {
      try {
        if (!storage?.getItem) throw Error('Protection settings unavailable.');
        const raw = storage?.getItem(key);
        if (loaded && raw === lastRaw) return;
        loaded = true; lastRaw = raw; blocked = false; recovered = false;
        if (raw === null || raw === undefined) { records = new Map(); return; }
        records = parse(raw);
      } catch (_) {
        blocked = true;
        try { records = parse(storage?.getItem(key + '-previous')); recovered = true; } catch (_) {}
      }
    }
    function persist(next) {
      if (!storage?.setItem) throw Error('This browser cannot save protection settings. Existing protections were kept.');
      const raw = JSON.stringify({ version: 1, records: [...next.values()] });
      if (raw.length > 500000 || next.size > 2000) throw Error('Resolve older field protections before adding more.');
      storage.setItem(key + '-previous', JSON.stringify({ version: 1, records: [...records.values()] }));
      storage.setItem(key, raw); lastRaw = raw; loaded = true; records = next; blocked = false; recovered = false;
      root.dispatchEvent?.(new CustomEvent('portfolio:protection-change'));
    }
    return Object.freeze({
      check(value) { load(); const match = [...records.values()].some(row => row.productId === value.productId && row.variantId === (value.variantId || '') && row.field === value.field); return { protected: blocked || match, unavailable: blocked, reason: blocked ? 'Protection settings need repair. Automated date changes are held on this browser.' : match ? 'Protected on this browser. Review an explicit override to change this date.' : '' }; },
      set(value, protect) {
        load(); if (!boundedId(value.categoryId) || !boundedId(value.productId) || !fields.includes(value.field) || value.variantId !== undefined && (typeof value.variantId !== 'string' || value.variantId.length > 240)) throw Error('Choose a valid product date.');
        if (blocked) throw Error('Repair unreadable protection settings before changing a protection. Automated date changes remain held.');
        const next = new Map([...records].filter(([, row]) => row.productId !== value.productId || row.variantId !== (value.variantId || '') || row.field !== value.field)), id = identity(value);
        if (protect) next.set(id, { categoryId: value.categoryId, productId: value.productId, variantId: value.variantId || '', field: value.field, at: new Date().toISOString() });
        else next.delete(id);
        persist(next); return true;
      },
      repair() { load(); if (!blocked || !recovered) throw Error('No verified previous protection settings are available. Export and repair this browser setting before automatic date updates.'); persist(new Map(records)); },
      getState() { load(); return { blocked, recovered, records: [...records.values()].map(row => ({ ...row })) }; },
    });
  }
  let storage; try { storage = root.localStorage; } catch (_) { storage = null; }
  const protection = protectionStore(storage);

  async function identifyFile(file) {
    if (!file || typeof file.name !== 'string' || !Number.isFinite(file.size) || file.size <= 0 || file.size > 64 * 1024 * 1024) throw Error('Choose a supported file up to 64 MiB.');
    const extension = file.name.toLowerCase().split('.').pop();
    if (extension === 'pkg') return { suggested: ['package'], explanation: 'A portfolio or analytics backup. Choose its destination before opening it.' };
    if (extension === 'data') return { suggested: ['data'], explanation: 'A portfolio data backup replaces workspace data; it does not include image files.' };
    if (extension === 'json') {
      if (file.size > 16 * 1024 * 1024) return { suggested: ['data', 'retail'], explanation: 'Choose whether this is portfolio data or an analytics snapshot.' };
      let value; try { value = JSON.parse(await file.text()); } catch (_) { throw Error('This JSON file could not be read. Your current data was kept.'); }
      return { suggested: Array.isArray(value?.periods) && Array.isArray(value?.rows) || value?.snapshot?.periods ? ['retail'] : ['data'], explanation: 'The destination validates the complete file before applying it.' };
    }
    if (extension === 'csv' || extension === 'tsv') return { suggested: ['planning', 'retail'], explanation: 'Choose planning candidates or retail observations. Source dates and values are reviewed in that destination.' };
    if (!['xlsx', 'xlsm'].includes(extension)) throw Error('Use an XLSX, XLSM, CSV, JSON, DATA or PKG file.');
    if (!root.ASCMImporter?.helpers?.openZip) return { suggested: [], explanation: 'Choose the workbook purpose below.' };
    const archive = await root.ASCMImporter.helpers.openZip(new Uint8Array(await file.arrayBuffer()), { maxFileBytes: 40 * 1024 * 1024, maxTotalUncompressedBytes: 128 * 1024 * 1024 });
    const workbook = await archive.getText('xl/workbook.xml');
    if (!workbook || /<!DOCTYPE|<!ENTITY/i.test(workbook)) throw Error('Choose a valid Excel workbook.');
    const names = [...workbook.matchAll(/<sheet\b[^>]*\bname=["']([^"']+)["']/g)].map(match => match[1].toLowerCase());
    const suggested = [];
    if (names.some(name => /cat_view|npi_tracker_all|category targets|ltp by years/.test(name))) suggested.push('blueprint');
    if (names.some(name => /planning candidates|product collection|planning intake/.test(name))) suggested.push('planning');
    if (names.some(name => /ascm/.test(name))) suggested.push('ascm');
    if (names.some(name => /plc|ffs|topline/.test(name))) suggested.push('plc');
    if (names.some(name => /sell.?out|account|retail/.test(name))) suggested.push('retail');
    return { suggested: [...new Set(suggested)], explanation: suggested.length === 1 ? 'A likely purpose was identified. Confirm the destination below.' : 'Choose the workbook purpose. PPC keeps portfolio, Retail and Blueprint sources separate.' };
  }
  function statusText({ localPending, localError, master = {} } = {}) {
    if (localError) return { tone: 'error', text: 'Local save blocked — Resolve' };
    if (localPending) return { tone: 'pending', text: 'Saving on this device…' };
    if (master.error) return { tone: 'error', text: master.pendingCount ? 'Saved on this device · Sharing needs attention' : 'Saved on this device · Team check unavailable' };
    if (master.pendingCount) return { tone: 'pending', text: `Saved on this device · ${master.pendingCount} product${master.pendingCount === 1 ? '' : 's'} not shared` };
    if (master.publicationStatus === 'error') return { tone: 'error', text: 'Team records saved · Downloadable copy needs attention' };
    if (master.publicationStatus === 'pending') return { tone: 'pending', text: 'Team records saved · Downloadable copy preparing' };
    return { tone: 'neutral', text: 'Saved on this device' };
  }
  root.PortfolioFieldProtection = Object.freeze({ ...protection, createStore: protectionStore, fields: Object.freeze(fields), identity });
  root.PortfolioWorkflowModel = Object.freeze({ identifyFile, statusText, fields: Object.freeze(fields) });
})(globalThis);
