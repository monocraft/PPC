/* Launch tracker identity, prices and schedules are evidence, not product features. */
(function (root) {
  "use strict";
  const headers = ["MSRP USD", "MSRP EUR", "Product", "Code Name", "Category", "HP SKU", "Product Tier", "FFS Date", "Global Announcement Date", "Web Readiness", "Final Assets Delivery", "US/Canada Launch", "LATAM Launch", "Europe / North Africa Launch", "Middle East / Central & South Africa Launch", "GA Launch", "GC Launch", "GI Launch"];
  const milestones = [[7, "ffsDate", "FFS"], [8, "globalAnnouncementDate", "Global announcement"], [9, "webReadinessDate", "Web readiness"], [10, "finalAssetsDate", "Final assets delivery"]];
  const regions = [[11, "us-canada", "US/Canada"], [12, "latam", "LATAM"], [13, "europe-north-africa", "Europe / North Africa"], [14, "middle-east-central-south-africa", "Middle East / Central & South Africa"], [15, "ga", "GA (source region code)"], [16, "gc", "GC (source region code)"], [17, "gi", "GI (source region code)"]];
  const object = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const text = (value) => typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const cellValue = (value) => typeof value === "string" || typeof value === "number" && Number.isFinite(value) ? value : null;
  const column = (index) => String.fromCharCode(65 + index);
  const clean = (value) => String(value ?? "").replace(/[\u200b-\u200d\ufeff]/g, "").trim();
  const importedText = (value) => typeof value === "number" ? value.toFixed(2) : clean(value).replace(/T00:00:00$/, "");
  const displayedValue = (value) => typeof value === "string" ? value.replace(/^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z?$/, "$1") : cellValue(value);

  // Synchronous SHA-256 reproduces the original import's stable IDs in both a
  // browser and Node. This avoids deleting unrelated rows with a similar prefix.
  function hash(input) {
    const bytes = [];
    for (const character of String(input)) {
      let code = character.codePointAt(0);
      if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | code >>> 6, 0x80 | code & 63);
      else if (code < 0x10000) bytes.push(0xe0 | code >>> 12, 0x80 | code >>> 6 & 63, 0x80 | code & 63);
      else bytes.push(0xf0 | code >>> 18, 0x80 | code >>> 12 & 63, 0x80 | code >>> 6 & 63, 0x80 | code & 63);
    }
    const length = bytes.length;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const bits = length * 8;
    for (let shift = 7; shift >= 0; shift--) bytes.push(shift >= 4 ? Math.floor(bits / 2 ** (shift * 8)) & 255 : bits >>> (shift * 8) & 255);
    const constants = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const rotate = (value, count) => value >>> count | value << 32 - count;
    const words = new Array(64);
    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let index = 0; index < 16; index++) words[index] = bytes[offset + index * 4] << 24 | bytes[offset + index * 4 + 1] << 16 | bytes[offset + index * 4 + 2] << 8 | bytes[offset + index * 4 + 3];
      for (let index = 16; index < 64; index++) {
        const a = words[index - 15], b = words[index - 2];
        words[index] = ((rotate(a, 7) ^ rotate(a, 18) ^ a >>> 3) + words[index - 16] + (rotate(b, 17) ^ rotate(b, 19) ^ b >>> 10) + words[index - 7]) | 0;
      }
      let [a, b, c, d, e, f, g, h] = state;
      for (let index = 0; index < 64; index++) {
        const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + constants[index] + words[index]) | 0;
        const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c)) | 0;
        h = g; g = f; f = e; e = (d + first) | 0; d = c; c = b; b = a; a = (first + second) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((value, index) => { state[index] = (state[index] + value) | 0; });
    }
    return state.map((value) => (value >>> 0).toString(16).padStart(8, "0")).join("");
  }

  function metadata(product) { return object(product?.plc?.launchAvailability) ? product.plc.launchAvailability : null; }

  function legacyRows(source) {
    return (Array.isArray(source?.rows) ? source.rows : []).filter((row) => object(row) && Number.isInteger(row.row) && row.row > 0 && Array.isArray(row.values));
  }

  function sourceFor(source, row) {
    return { file: text(source.sourceFile), sheet: text(source.sourceSheet) || "WW", range: `A${row}:V${row}`, checkedDate: text(source.updateDate), observedAt: text(source.updatedAt) };
  }

  function recordFromRow(source, row) {
    const values = row.values;
    const entry = (index, key, label) => ({ key, label, value: displayedValue(values[index]), raw: cellValue(values[index]), cell: `${column(index)}${row.row}` });
    return {
      id: `launch-row-${row.row}`, row: row.row, canonical: row.row === source.canonicalRow,
      skus: Array.isArray(row.skus) ? row.skus.map(text).filter(Boolean) : [],
      identity: { productName: text(values[2]), codename: text(values[3]), sourceCategory: text(values[4]), skuText: text(values[5]), tier: text(values[6]) },
      pricing: { usd: cellValue(values[0]), eur: cellValue(values[1]) },
      milestones: milestones.map(([index, key, label]) => entry(index, key, label)),
      regions: regions.map(([index, key, label]) => entry(index, key, label)),
      notes: [18, 19, 20, 21].map((index) => ({ column: column(index), value: cellValue(values[index]), cell: `${column(index)}${row.row}` })),
      source: sourceFor(source, row.row),
    };
  }

  function normalizedRecord(record, source) {
    if (!object(record) || !Number.isInteger(record.row) || record.row <= 0 || !object(record.identity) || !object(record.pricing)) return null;
    const entries = (values) => (Array.isArray(values) ? values : []).filter(object).map((entry) => ({ key: text(entry.key), label: text(entry.label), value: cellValue(entry.value), raw: cellValue(Object.hasOwn(entry, "raw") ? entry.raw : entry.value), cell: text(entry.cell) }));
    const identity = Object.fromEntries(["productName", "codename", "sourceCategory", "skuText", "tier"].map((key) => [key, text(record.identity[key])]));
    return {
      id: text(record.id) || `launch-row-${record.row}`, row: record.row, canonical: record.row === source.canonicalRow,
      skus: Array.isArray(record.skus) ? record.skus.map(text).filter(Boolean) : [], identity,
      pricing: { usd: cellValue(record.pricing.usd), eur: cellValue(record.pricing.eur) },
      milestones: entries(record.milestones), regions: entries(record.regions),
      notes: (Array.isArray(record.notes) ? record.notes : []).filter(object).map((note) => ({ column: text(note.column), value: cellValue(note.value), cell: text(note.cell) })),
      source: { ...sourceFor(source, record.row), ...(object(record.source) ? Object.fromEntries(["file", "sheet", "range", "checkedDate", "observedAt"].map((key) => [key, text(record.source[key])])) : {}) },
    };
  }

  function records(product) {
    const source = metadata(product);
    if (!source) return [];
    if (source.formatVersion === 1 && Array.isArray(source.records)) {
      const typed = source.records.map((record) => normalizedRecord(record, source)).filter(Boolean);
      if (typed.length || !legacyRows(source).length) return typed;
    }
    return legacyRows(source).map((row) => recordFromRow(source, row));
  }

  function expectedMetadata(product) {
    const source = metadata(product), expected = new Map();
    if (!source || typeof product?.id !== "string" || !product.id || (source.sourceSheet && source.sourceSheet !== "WW")) return expected;
    for (const row of legacyRows(source)) {
      const skuTokens = [...new Set(clean(row.values[5]).toUpperCase().match(/\b[A-Z0-9]{7}\b/g) || [])];
      const prefix = skuTokens.join(", ") || `WW row ${row.row}`;
      const add = (key, label, value, cell) => expected.set(`launch-${hash(`${product.id}|WW:${row.row}:${key}`).slice(0, 24)}`, { label, value, row: row.row, cell });
      row.values.slice(0, 22).forEach((value, index) => {
        if (value !== null && value !== undefined && clean(value) !== "") add(column(index), `${prefix} · ${headers[index] || `Tracker note ${column(index)}`}`, importedText(value), `${column(index)}${row.row}`);
      });
      add("source", `${prefix} · Tracker source`, `${text(source.sourceFile)} · WW!A${row.row}:V${row.row}`, `A${row.row}:V${row.row}`);
      add("updated", `${prefix} · Tracker dates checked`, text(source.updateDate), `A${row.row}:V${row.row}`);
    }
    return expected;
  }

  function specifications(product) {
    const entries = Array.isArray(product?.specs) ? product.specs : [];
    if (!entries.some((entry) => /^launch-[a-f0-9]{24}$/.test(entry?.id || ""))) return entries;
    const expected = expectedMetadata(product);
    return entries.filter((entry) => !expected.has(entry?.id));
  }

  function details(product) {
    const source = metadata(product);
    return {
      records: records(product), sourceFile: text(source?.sourceFile), sourceSheet: text(source?.sourceSheet),
      checkedDate: text(source?.updateDate), observedAt: text(source?.updatedAt), canonicalRow: source?.canonicalRow ?? null,
      organizedAt: text(source?.organization?.organizedAt),
      overrides: Array.isArray(source?.organization?.overrides) ? clone(source.organization.overrides) : [],
    };
  }

  function migrate(product, { now = new Date().toISOString() } = {}) {
    const result = clone(product), source = metadata(result);
    if (!source) return result;
    const expected = expectedMetadata(result), existing = source.organization;
    const moved = (Array.isArray(result.specs) ? result.specs : []).filter((entry) => expected.has(entry?.id));
    if (source.formatVersion === 1 && Array.isArray(source.records) && !moved.length) return result;
    const archive = new Map((Array.isArray(existing?.relocatedMetadata) ? existing.relocatedMetadata : []).map((entry) => [entry.id, entry]));
    const overrides = new Map((Array.isArray(existing?.overrides) ? existing.overrides : []).map((entry) => [entry.id, entry]));
    for (const entry of moved) {
      const original = expected.get(entry.id), actual = { id: entry.id, label: text(entry.label), value: text(entry.value) };
      archive.set(entry.id, actual);
      if (actual.label !== original.label || actual.value !== original.value) overrides.set(entry.id, { ...actual, row: original.row, cell: original.cell, original: { label: original.label, value: original.value } });
    }
    result.specs = specifications(result);
    source.formatVersion = 1;
    source.records = records(result);
    source.organization = { ...(object(existing) ? existing : {}), organizedAt: text(now), movedCount: archive.size, relocatedMetadata: [...archive.values()], overrides: [...overrides.values()] };
    return result;
  }

  root.PortfolioLaunchRecords = Object.freeze({ records, details, specifications, migrate });
})(globalThis);
