/* Sellout import and analysis rules. No DOM, network, storage, or portfolio mutations. */
(function (root) {
  "use strict";

  const DAY = 86400000;
  const RESERVED_SKU_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const text = (value) => String(value == null ? "" : value).trim();
  const headerKey = (value) => text(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  const rowKey = (row) => JSON.stringify([text(row.store), text(row.sku)]);
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const iso = (date) => date.toISOString().slice(0, 10);
  const addDays = (date, amount) => iso(new Date(Date.parse(date + "T00:00:00Z") + amount * DAY));
  const sum = (values) => {
    const observed = values.filter(finite);
    return observed.length ? observed.reduce((total, value) => total + value, 0) : null;
  };
  const growth = (current, previous) => finite(current) && finite(previous) && previous > 0 ? (current - previous) / previous : null;
  const delta = (current, previous) => finite(current) && finite(previous) ? current - previous : null;

  function validISO(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && iso(new Date(value + "T00:00:00Z")) === value;
  }

  function makeDate(year, month, day) {
    const result = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return validISO(result) ? result : null;
  }

  function normalizeQuarter(value) {
    const raw = text(value).replace(/\s+/g, "");
    let match = raw.match(/FY(\d{4}|\d{2})[-/]?Q([1-4])/i);
    if (!match) {
      const reverse = raw.match(/Q([1-4])[-/]?(?:FY)?(\d{4}|\d{2})/i);
      if (reverse) match = [reverse[0], reverse[2], reverse[1]];
    }
    return match ? `FY${match[1].slice(-2)}Q${match[2]}` : "";
  }

  function fiscalQuarter(date, fiscalStartMonth = 11) {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    const fiscalYear = year + (fiscalStartMonth > 1 && month >= fiscalStartMonth ? 1 : 0);
    const quarter = Math.floor(((month - fiscalStartMonth + 12) % 12) / 3) + 1;
    return `FY${String(fiscalYear).slice(-2)}Q${quarter}`;
  }

  function parseDate(value, context = {}) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? iso(value) : null;
    if (typeof value === "number" && value >= 1 && value < 100000) {
      return iso(new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * DAY));
    }
    const raw = text(value).replace(/^(?:week\s*(?:ending|end|of)?|w\/e)\s*[:\-]?\s*/i, "");
    if (validISO(raw)) return raw;
    let match = raw.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
    if (match) return makeDate(Number(match[1]), Number(match[2]), Number(match[3]));
    match = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2}|\d{4}))?$/);
    if (match) {
      let year = match[3] ? Number(match[3]) : Number(context.year);
      if (!match[3] && context.quarter) {
        const fy = Number(normalizeQuarter(context.quarter).slice(2, 4)) + 2000;
        year = fy - (Number(match[1]) >= (context.fiscalStartMonth || 11) ? 1 : 0);
      }
      if (year < 100) year += 2000;
      return year >= 1900 && year <= 2199 ? makeDate(year, Number(match[1]), Number(match[2])) : null;
    }
    const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    match = raw.match(/^([A-Za-z]{3,9})[\s.\-]*(\d{1,2})[\s'’\-/]+(\d{2}|\d{4})$/);
    if (match) {
      const month = months[match[1].slice(0, 3).toLowerCase()];
      const year = Number(match[3]) + (match[3].length === 2 ? 2000 : 0);
      return month ? makeDate(year, month, Number(match[2])) : null;
    }
    match = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{2}|\d{4}))?$/) || raw.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3,9})(?:[\s\-]+(\d{2}|\d{4}))?$/);
    if (match) {
      const monthFirst = /^[A-Za-z]/.test(match[1]);
      const month = months[(monthFirst ? match[1] : match[2]).slice(0, 3).toLowerCase()];
      const day = Number(monthFirst ? match[2] : match[1]);
      let year = match[3] ? Number(match[3]) : Number(context.year);
      if (!match[3] && context.quarter) year = Number(normalizeQuarter(context.quarter).slice(2, 4)) + 2000 - (month >= (context.fiscalStartMonth || 11) ? 1 : 0);
      if (year < 100) year += 2000;
      return month && year >= 1900 && year <= 2199 ? makeDate(year, month, day) : null;
    }
    return null;
  }

  function parseNumber(value) {
    if (finite(value)) return value;
    const raw = text(value);
    if (!raw || /^(?:-|—|–|n\/?a|null|blank)$/i.test(raw)) return null;
    const cleaned = raw.replace(/[−–]/g, "-").replace(/,/g, "").replace(/^\((.+)\)$/, "-$1");
    return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(cleaned) && Number.isFinite(Number(cleaned)) ? Number(cleaned) : null;
  }

  function parseCsv(csv, delimiter) {
    const source = String(csv == null ? "" : csv).replace(/^\uFEFF/, "");
    const separator = delimiter || (source.split(/\r?\n/, 1)[0].includes("\t") && !source.split(/\r?\n/, 1)[0].includes(",") ? "\t" : ",");
    if (separator.length !== 1) throw new Error("CSV delimiter must be one character.");
    const result = []; let row = []; let cell = ""; let quoted = false; let afterQuote = false;
    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; }
        else if (char === '"') { quoted = false; afterQuote = true; }
        else cell += char;
      } else if (char === '"' && !cell && !afterQuote) quoted = true;
      else if (char === separator) { row.push(cell); cell = ""; afterQuote = false; }
      else if (char === "\r" || char === "\n") {
        if (char === "\r" && source[index + 1] === "\n") index++;
        row.push(cell); result.push(row); row = []; cell = ""; afterQuote = false;
      } else if (afterQuote && !/\s/.test(char)) throw new Error("Unexpected text after a quoted CSV field.");
      else if (!afterQuote) cell += char;
    }
    if (quoted) throw new Error("CSV has an unterminated quoted field.");
    if (cell || row.length || afterQuote) { row.push(cell); result.push(row); }
    return result;
  }

  const ALIASES = {
    store: ["account", "store", "retailer", "customer", "storeaccount"],
    sku: ["hpsku", "sku", "productsku", "partnumber", "itemcode", "item"],
    product: ["productdescription", "product", "productname", "description"],
    category: ["category", "productcategory"],
    lifetime: ["lifetime", "lifetimeunits", "lifetimeunit", "ltd", "lifetimetotal", "totallifetime"],
    date: ["date", "week", "weekending", "weekend", "period"],
    units: ["units", "sellout", "salesunits", "quantity", "qty", "unitssold", "selloutunits"],
  };

  function headerMapping(row) {
    const map = {};
    row.forEach((value, index) => {
      const key = headerKey(value);
      for (const [name, aliases] of Object.entries(ALIASES)) if (aliases.includes(key) && map[name] == null) map[name] = index;
    });
    return map;
  }

  function metaSnapshot(options) {
    return { schemaVersion: 1, title: text(options.title) || "Retail sellout", sourceUrl: text(options.sourceUrl), asOf: text(options.asOf), sheet: text(options.sheet), periods: [], rows: [], warnings: [] };
  }

  function importNumber(value, snapshot, row, column) {
    const number = parseNumber(value);
    if (number == null && text(value) && !/^(?:-|—|–|n\/?a|null|blank)$/i.test(text(value))) snapshot.warnings.push({ type: "invalid-number", row: row + 1, column: column + 1, original: text(value), message: `Unrecognized unit value at row ${row + 1}, column ${column + 1}; kept as missing.` });
    return number;
  }

  function assertImported(snapshot) {
    const validation = validateSnapshot(snapshot);
    if (!validation.ok) {
      const error = new Error(validation.errors.join(" "));
      error.validation = validation;
      throw error;
    }
    snapshot.warnings.push(...validation.warnings);
    return snapshot;
  }

  function normalizeWorkbookRows(matrix, options = {}) {
    if (!Array.isArray(matrix) || !matrix.every(Array.isArray)) throw new Error("Import expects an array of worksheet rows.");
    let headerIndex = -1; let mapping;
    for (let index = 0; index < Math.min(matrix.length, 100); index++) {
      const candidate = headerMapping(matrix[index]);
      if (candidate.store != null && candidate.sku != null && (candidate.product != null || (candidate.date != null && candidate.units != null))) { headerIndex = index; mapping = candidate; break; }
    }
    if (headerIndex < 0) throw new Error("No sellout header found. Include Store/Account and SKU plus Product Description, or Date and Units.");
    const snapshot = metaSnapshot(options);
    if (mapping.date != null && mapping.units != null) return normalizeTidyRows(matrix, headerIndex, mapping, snapshot, options);
    const header = matrix[headerIndex];
    let quarterRow = [];
    for (let index = headerIndex - 1; index >= Math.max(0, headerIndex - 12); index--) {
      if (matrix[index].some((value) => normalizeQuarter(value))) { quarterRow = matrix[index]; break; }
    }
    let quarter = "";
    const candidates = [];
    const metadataColumns = new Set(Object.values(mapping));
    for (let column = 0; column < header.length; column++) {
      quarter = normalizeQuarter(quarterRow[column]) || quarter;
      if (metadataColumns.has(column)) continue;
      const original = text(header[column]);
      const date = parseDate(header[column], { quarter, year: options.year, fiscalStartMonth: options.fiscalStartMonth });
      if (date || /^\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}$/.test(original) || /^[A-Za-z]{3,9}[\s'’\-]+\d{2,4}$/.test(original)) candidates.push({ column, date, label: original, quarter });
    }
    // A single wrong header is repairable only when both adjacent weekly dates agree.
    for (let index = 1; index < candidates.length - 1; index++) {
      const previous = candidates[index - 1]; const current = candidates[index]; const next = candidates[index + 1];
      if (previous.date && next.date && addDays(previous.date, 14) === next.date) {
        const expected = addDays(previous.date, 7);
        if (current.date !== expected) {
          snapshot.warnings.push({ type: "date-correction", column: current.column + 1, original: current.label, corrected: expected, message: `Header ${current.label} corrected to ${expected}; both adjacent weeks support this date.` });
          current.originalHeader = current.label;
          current.date = expected;
          current.label = expected;
        }
      }
    }
    if (!candidates.length) throw new Error("No dated weekly sellout columns found.");
    const unresolved = candidates.filter((period) => !period.date);
    if (unresolved.length) throw new Error(`Cannot resolve weekly date header: ${unresolved.map((period) => period.label).join(", ")}. Use explicit dates.`);
    snapshot.periods = candidates.map((period) => ({ date: period.date, label: period.label || period.date, quarter: period.quarter || fiscalQuarter(period.date, options.fiscalStartMonth || 11), originalHeader: period.originalHeader || text(header[period.column]), inferred: Boolean(period.originalHeader) }));
    const seen = new Map(); let lastStore = "";
    for (let index = headerIndex + 1; index < matrix.length; index++) {
      const source = matrix[index];
      const sku = text(source[mapping.sku]);
      const explicitStore = text(source[mapping.store]);
      if (!sku || /^(?:total|grandtotal|subtotal)$/i.test(headerKey(sku))) continue;
      if (explicitStore) lastStore = explicitStore;
      const store = explicitStore || lastStore;
      if (!store) { snapshot.warnings.push({ type: "missing-store", row: index + 1, message: `Row ${index + 1} has a SKU but no store; row omitted.` }); continue; }
      const row = { store, sku, product: text(source[mapping.product]) || sku, category: text(source[mapping.category]) || "Uncategorized", lifetime: mapping.lifetime != null ? importNumber(source[mapping.lifetime], snapshot, index, mapping.lifetime) : null, values: candidates.map((period) => importNumber(source[period.column], snapshot, index, period.column)) };
      const key = rowKey(row);
      if (seen.has(key) && JSON.stringify(seen.get(key)) === JSON.stringify(row)) { snapshot.warnings.push({ type: "duplicate-row", row: index + 1, message: `An identical duplicate row for ${store} / ${sku} was omitted.` }); continue; }
      seen.set(key, row); snapshot.rows.push(row);
    }
    return assertImported(snapshot);
  }

  function normalizeTidyRows(matrix, headerIndex, mapping, snapshot, options) {
    const dates = new Map(); const groups = new Map();
    for (let index = headerIndex + 1; index < matrix.length; index++) {
      const source = matrix[index];
      if (!source.some((value) => text(value))) continue;
      const store = text(source[mapping.store]); const sku = text(source[mapping.sku]);
      const date = parseDate(source[mapping.date], { year: options.year });
      if (!store || !sku || !date) throw new Error(`Row ${index + 1} requires a store, SKU, and valid date.`);
      const units = importNumber(source[mapping.units], snapshot, index, mapping.units);
      dates.set(date, { date, label: date, quarter: fiscalQuarter(date, options.fiscalStartMonth || 11) });
      const candidate = { store, sku, product: text(source[mapping.product]) || sku, category: text(source[mapping.category]) || "Uncategorized", lifetime: mapping.lifetime != null ? importNumber(source[mapping.lifetime], snapshot, index, mapping.lifetime) : null };
      const key = rowKey(candidate);
      if (!groups.has(key)) groups.set(key, { ...candidate, observations: new Map() });
      const group = groups.get(key);
      if (group.product !== candidate.product || group.category !== candidate.category) throw new Error(`Conflicting product metadata for ${store} / ${sku} at row ${index + 1}.`);
      if (finite(candidate.lifetime)) {
        if (finite(group.lifetime) && group.lifetime !== candidate.lifetime) throw new Error(`Conflicting lifetime values for ${store} / ${sku}.`);
        group.lifetime = candidate.lifetime;
      }
      if (group.observations.has(date)) {
        if (group.observations.get(date) !== units) throw new Error(`Conflicting duplicate observation for ${store} / ${sku} on ${date}; resolve it before import.`);
        snapshot.warnings.push({ type: "duplicate-observation", row: index + 1, message: `An identical duplicate observation for ${store} / ${sku} on ${date} was omitted.` });
      } else group.observations.set(date, units);
    }
    snapshot.periods = [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
    snapshot.rows = [...groups.values()].map(({ observations, ...row }) => ({ ...row, values: snapshot.periods.map((period) => observations.has(period.date) ? observations.get(period.date) : null) }));
    return assertImported(snapshot);
  }

  function validateSnapshot(snapshot) {
    const errors = []; const warnings = [];
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return { ok: false, errors: ["Sellout snapshot must be an object."], warnings };
    const boundedString = (value, limit, required = false) => typeof value === "string" && value.length <= limit && (!required || value.trim().length > 0);
    const optionalStrings = { title: 1000, sourceUrl: 8192, sharedUrl: 8192, sheet: 255, importedAt: 100, sourceModifiedAt: 100, unit: 100, periodConvention: 1000 };
    for (const [field, limit] of Object.entries(optionalStrings)) {
      if (snapshot[field] !== undefined && !boundedString(snapshot[field], limit)) errors.push(`Snapshot ${field} must be a string of at most ${limit} characters when supplied.`);
    }
    for (const field of ["asOf", "importedOn", "latestReportedDate"]) {
      if (snapshot[field] !== undefined && snapshot[field] !== "" && !validISO(snapshot[field])) errors.push(`Snapshot ${field} must be an ISO date string or empty when supplied.`);
    }
    if (snapshot.schemaVersion !== 1) errors.push("Unsupported sellout snapshot schemaVersion; expected 1.");
    if (!Array.isArray(snapshot.periods) || !snapshot.periods.length) errors.push("Snapshot requires at least one weekly period.");
    if (!Array.isArray(snapshot.rows)) errors.push("Snapshot rows must be an array.");
    if (snapshot.warnings != null && !Array.isArray(snapshot.warnings)) errors.push("Snapshot warnings must be an array.");
    if (Array.isArray(snapshot.warnings)) snapshot.warnings.forEach((warning, index) => {
      if (typeof warning === "string") {
        if (!boundedString(warning, 4000)) errors.push(`Warning ${index + 1} exceeds the text limit.`);
      } else if (!warning || typeof warning !== "object" || Array.isArray(warning) || !boundedString(warning.message, 4000, true)) errors.push(`Warning ${index + 1} must be text or an object with a nonempty message string.`);
    });
    const periods = Array.isArray(snapshot.periods) ? snapshot.periods : [];
    const seenDates = new Set();
    periods.forEach((period, index) => {
      if (!period || typeof period !== "object" || Array.isArray(period) || !validISO(period.date)) { errors.push(`Period ${index + 1} has an invalid ISO date.`); return; }
      if (seenDates.has(period.date)) errors.push(`Duplicate weekly date ${period.date}.`);
      seenDates.add(period.date);
      if (index && validISO(periods[index - 1]?.date)) {
        if (period.date <= periods[index - 1].date) errors.push("Weekly periods must be in strictly increasing date order.");
        else if (addDays(periods[index - 1].date, 7) !== period.date) warnings.push({ type: "weekly-gap", date: period.date, message: `The weekly timeline has a gap or nonweekly interval before ${period.date}.` });
      }
      if (!boundedString(period.quarter, 40, true)) errors.push(`Period ${period.date} requires a nonempty quarter string of at most 40 characters.`);
      for (const field of ["label", "originalHeader", "fiscalQuarter", "fiscalYear", "sourceColumn"]) {
        if (period[field] !== undefined && !boundedString(period[field], field === "label" || field === "originalHeader" ? 500 : 40)) errors.push(`Period ${period.date} ${field} must be a bounded string when supplied.`);
      }
    });
    const seenRows = new Set();
    (Array.isArray(snapshot.rows) ? snapshot.rows : []).forEach((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) { errors.push(`Row ${index + 1} must be an object.`); return; }
      for (const [field, limit] of Object.entries({ store: 255, sku: 300, product: 2000, category: 255 })) {
        if (!boundedString(row[field], limit, true)) errors.push(`Row ${index + 1} ${field} must be a nonempty string of at most ${limit} characters.`);
      }
      if (typeof row.sku === "string" && RESERVED_SKU_KEYS.has(row.sku.trim().toLowerCase())) errors.push(`Row ${index + 1} uses a reserved SKU key; choose a regular product identifier.`);
      if (typeof row.store === "string" && typeof row.sku === "string") {
        const key = rowKey(row);
        if (seenRows.has(key)) errors.push(`Duplicate store/SKU key ${text(row.store)} / ${text(row.sku)}; duplicates would double count units.`);
        seenRows.add(key);
      }
      if (!Array.isArray(row.values) || row.values.length !== periods.length) errors.push(`Row ${index + 1} values must match the weekly period count.`);
      else if (Array.from(row.values).some((value) => value !== null && !finite(value))) errors.push(`Row ${index + 1} has a weekly value that is neither a finite number nor null.`);
      if (row.lifetime !== null && !finite(row.lifetime)) errors.push(`Row ${index + 1} lifetime must be a finite number or null.`);
    });
    return { ok: errors.length === 0, errors: [...new Set(errors)], warnings };
  }

  function options(snapshot) {
    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const productMap = new Map();
    rows.forEach((row) => {
      if (!productMap.has(row.sku)) productMap.set(row.sku, { sku: row.sku, product: row.product, category: row.category, aliases: [], stores: [] });
      const product = productMap.get(row.sku);
      if (!product.aliases.includes(row.product)) product.aliases.push(row.product);
      if (!product.stores.includes(row.store)) product.stores.push(row.store);
    });
    return { stores: unique(rows.map((row) => row.store)), categories: unique(rows.map((row) => row.category)), products: [...productMap.values()].sort((a, b) => a.product.localeCompare(b.product) || a.sku.localeCompare(b.sku)), quarters: unique((snapshot?.periods || []).map((period) => period.quarter)), start: snapshot?.periods?.[0]?.date || null, end: snapshot?.periods?.at(-1)?.date || null };
  }

  function analyze(snapshot, filters = {}) {
    const validation = validateSnapshot(snapshot);
    if (!validation.ok) throw new Error(validation.errors.join(" "));
    const wanted = (value) => new Set(Array.isArray(value) ? value : value ? [value] : []);
    const stores = wanted(filters.stores); const products = wanted(filters.products || filters.skus); const categories = wanted(filters.categories);
    const rows = snapshot.rows.filter((row) => (!stores.size || stores.has(row.store)) && (!products.size || products.has(row.sku)) && (!categories.size || categories.has(row.category)));
    const periods = snapshot.periods;
    const start = validISO(filters.start) ? filters.start : periods[0].date;
    const end = validISO(filters.end) ? filters.end : periods.at(-1).date;
    const comparison = ["previous", "year", "none"].includes(filters.comparison) ? filters.comparison : "previous";
    const coverageMode = filters.coverage === "available" ? "available" : "common";
    const groupedStores = new Map();
    rows.forEach((row) => { if (!groupedStores.has(row.store)) groupedStores.set(row.store, []); groupedStores.get(row.store).push(row); });
    const cutoffs = [...groupedStores.entries()].map(([store, members]) => {
      let first = null; let last = null; let observedWeeks = 0;
      periods.forEach((period, index) => { if (members.some((row) => finite(row.values[index]))) { first ||= period.date; last = period.date; observedWeeks++; } });
      return { store, first, last, observedWeeks, products: members.length };
    }).sort((a, b) => a.store.localeCompare(b.store));
    const noDataStores = cutoffs.filter((entry) => !entry.last).map((entry) => entry.store);
    const commonEnd = cutoffs.length && !noDataStores.length ? cutoffs.map((entry) => entry.last).sort()[0] : null;
    const effectiveEnd = coverageMode === "common" ? (commonEnd && commonEnd < end ? commonEnd : commonEnd ? end : null) : end;
    const selected = periods.map((period, index) => ({ ...period, index })).filter((period) => effectiveEnd && period.date >= start && period.date <= effectiveEnd);
    const dateIndex = new Map(periods.map((period, index) => [period.date, index]));
    // Calendar gaps must not shorten the previous window into the selected window.
    const calendarSpanDays = selected.length ? Math.round((Date.parse(selected.at(-1).date + "T00:00:00Z") - Date.parse(selected[0].date + "T00:00:00Z")) / DAY) + 7 : 0;
    const comparisonOffset = comparison === "year" ? 364 : calendarSpanDays;
    const currentIndices = selected.map((period) => period.index);
    const previousDates = selected.map((period) => comparison === "none" ? null : addDays(period.date, -comparisonOffset));
    const previousIndices = previousDates.map((date) => date == null ? null : dateIndex.get(date) ?? null);
    const aggregateAt = (members, indices) => sum(members.flatMap((row) => indices.filter((index) => index != null).map((index) => row.values[index])));
    const series = selected.map((period, index) => {
      const values = rows.map((row) => row.values[period.index]);
      const previousIndex = previousIndices[index];
      return { date: period.date, label: period.label || period.originalHeader || period.date, quarter: period.quarter, current: sum(values), previous: previousIndex == null ? null : sum(rows.map((row) => row.values[previousIndex])), comparisonDate: previousDates[index], observedRows: values.filter(finite).length, totalRows: rows.length, observedStores: new Set(rows.filter((row) => finite(row.values[period.index])).map((row) => row.store)).size };
    });
    const current = aggregateAt(rows, currentIndices); const previous = comparison === "none" ? null : aggregateAt(rows, previousIndices);
    const observedWeeks = series.filter((point) => finite(point.current)).length;
    const previousObservedWeeks = series.filter((point) => finite(point.previous)).length;
    const comparisonCalendarDates = [];
    if (comparison !== "none" && previousDates.length) {
      for (let date = previousDates[0]; date <= previousDates.at(-1); date = addDays(date, 7)) comparisonCalendarDates.push(date);
    }
    const missingComparisonDates = comparisonCalendarDates.filter((date) => !dateIndex.has(date));
    const comparisonComplete = comparison !== "none" && selected.length > 0 && missingComparisonDates.length === 0 && previousIndices.every((index) => index != null);
    const measure = (members, currentIndexes = currentIndices, priorIndexes = previousIndices) => {
      const currentValues = members.flatMap((row) => currentIndexes.map((index) => row.values[index]));
      const priorValues = members.flatMap((row) => priorIndexes.map((index) => index == null ? null : row.values[index]));
      const pairedCurrent = []; const pairedPrevious = []; const pairedWeeks = new Set();
      members.forEach((row) => currentIndexes.forEach((index, offset) => {
        const previousIndex = priorIndexes[offset];
        if (previousIndex != null && finite(row.values[index]) && finite(row.values[previousIndex])) {
          pairedCurrent.push(row.values[index]); pairedPrevious.push(row.values[previousIndex]); pairedWeeks.add(index);
        }
      }));
      const comparableCurrent = sum(pairedCurrent); const comparablePrevious = sum(pairedPrevious);
      const complete = comparisonComplete && currentIndexes.length > 0 && priorIndexes.every((index) => index != null);
      return { comparableCurrent, comparablePrevious, delta: complete ? delta(comparableCurrent, comparablePrevious) : null, growth: complete ? growth(comparableCurrent, comparablePrevious) : null, pairedCells: pairedCurrent.length, pairedWeeks: pairedWeeks.size, numericCells: currentValues.filter(finite).length, missingCells: currentValues.filter((value) => value == null).length, zeroCells: currentValues.filter((value) => value === 0).length, negativeCells: currentValues.filter((value) => finite(value) && value < 0).length, negativeUnits: sum(currentValues.filter((value) => finite(value) && value < 0)) ?? 0, previousNumericCells: priorValues.filter(finite).length, previousMissingCells: priorValues.filter((value) => value == null).length, comparisonComplete: complete };
    };
    const measured = measure(rows);
    series.forEach((point, index) => Object.assign(point, measure(rows, [currentIndices[index]], [previousIndices[index]])));
    const coverageWarnings = [];
    if (coverageMode === "common" && effectiveEnd && effectiveEnd < end) coverageWarnings.push(`Common coverage ends ${effectiveEnd}; later weeks are excluded because selected retailers have different reporting cutoffs.`);
    if (coverageMode === "common" && noDataStores.length) coverageWarnings.push(`No shared reporting cutoff is available: ${noDataStores.join(", ")} has no observations for the selected products.`);
    if (comparison !== "none" && selected.length && !comparisonComplete) coverageWarnings.push("The comparison calendar window has missing weekly dates or extends outside this snapshot. Growth and change are unavailable for this selection.");
    if (comparison !== "none" && measured.pairedCells < measured.numericCells) coverageWarnings.push("Change and growth use matching numeric store/SKU observations only; missing values are excluded from both sides.");
    const totals = { current, previous, ...measured, observedWeeks, previousObservedWeeks, selectedWeeks: selected.length, avgWeekly: observedWeeks ? current / observedWeeks : null, previousAvgWeekly: previousObservedWeeks ? previous / previousObservedWeeks : null, stores: groupedStores.size, products: new Set(rows.map((row) => row.sku)).size, activeStores: new Set(rows.filter((row) => currentIndices.some((index) => finite(row.values[index]))).map((row) => row.store)).size, activeProducts: new Set(rows.filter((row) => currentIndices.some((index) => finite(row.values[index]))).map((row) => row.sku)).size, sellingProducts: new Set(rows.filter((row) => currentIndices.some((index) => finite(row.values[index]) && row.values[index] > 0)).map((row) => row.sku)).size, lifetime: sum(rows.map((row) => row.lifetime)), comparisonComplete };
    const aggregate = (field) => {
      const groups = new Map();
      rows.forEach((row) => { const key = row[field] || "Uncategorized"; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); });
      return [...groups.entries()].map(([key, members]) => {
        const groupCurrent = aggregateAt(members, currentIndices); const groupPrevious = comparison === "none" ? null : aggregateAt(members, previousIndices);
        const currentWeeks = currentIndices.filter((index) => members.some((row) => finite(row.values[index]))).length;
        const priorWeeks = previousIndices.filter((index) => index != null && members.some((row) => finite(row.values[index]))).length;
        return { key, name: field === "sku" ? members[0].product : key, [field]: key, ...(field === "sku" ? { sku: key, product: members[0].product, productAliases: [...new Set(members.map((row) => row.product))], category: members[0].category } : {}), current: groupCurrent, previous: groupPrevious, total: groupCurrent, ...measure(members), share: finite(groupCurrent) && finite(current) && current > 0 ? groupCurrent / current : null, observedWeeks: currentWeeks, previousObservedWeeks: priorWeeks, avgWeekly: currentWeeks ? groupCurrent / currentWeeks : null, lifetime: sum(members.map((row) => row.lifetime)), series: currentIndices.map((index) => sum(members.map((row) => row.values[index]))) };
      }).sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity) || a.key.localeCompare(b.key));
    };
    const storeAggregates = aggregate("store"); const productAggregates = aggregate("sku"); const categoryAggregates = aggregate("category");
    const storeProducts = rows.map((row) => {
      const rowCurrent = aggregateAt([row], currentIndices); const rowPrevious = comparison === "none" ? null : aggregateAt([row], previousIndices);
      const numericIndices = currentIndices.filter((index) => finite(row.values[index]));
      const storeTotal = storeAggregates.find((entry) => entry.key === row.store)?.current;
      return { key: rowKey(row), store: row.store, sku: row.sku, product: row.product, name: row.product, category: row.category, current: rowCurrent, total: rowCurrent, previous: rowPrevious, ...measure([row]), observedWeeks: numericIndices.length, selectedWeeks: selected.length, avgWeekly: numericIndices.length ? rowCurrent / numericIndices.length : null, lifetime: row.lifetime, first: numericIndices.length ? periods[numericIndices[0]].date : null, last: numericIndices.length ? periods[numericIndices.at(-1)].date : null, share: finite(rowCurrent) && finite(storeTotal) && storeTotal > 0 ? rowCurrent / storeTotal : null, series: currentIndices.map((index) => row.values[index]) };
    }).sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity) || a.key.localeCompare(b.key));
    const storeCategoryGroups = new Map();
    rows.forEach((row) => { const key = JSON.stringify([row.store, row.category]); if (!storeCategoryGroups.has(key)) storeCategoryGroups.set(key, []); storeCategoryGroups.get(key).push(row); });
    const storeCategories = [...storeCategoryGroups.entries()].map(([key, members]) => {
      const categoryCurrent = aggregateAt(members, currentIndices);
      const storeCurrent = storeAggregates.find((entry) => entry.key === members[0].store)?.current;
      return { key, store: members[0].store, category: members[0].category, name: members[0].category, current: categoryCurrent, previous: comparison === "none" ? null : aggregateAt(members, previousIndices), ...measure(members), share: finite(categoryCurrent) && finite(storeCurrent) && storeCurrent > 0 ? categoryCurrent / storeCurrent : null, series: currentIndices.map((index) => sum(members.map((row) => row.values[index]))) };
    }).sort((a, b) => a.store.localeCompare(b.store) || (b.current ?? -Infinity) - (a.current ?? -Infinity));
    const quarterMap = new Map();
    series.forEach((point) => { if (!quarterMap.has(point.quarter)) quarterMap.set(point.quarter, []); quarterMap.get(point.quarter).push(point); });
    const quarters = [...quarterMap.entries()].map(([quarter, points]) => {
      const quarterCurrent = sum(points.map((point) => point.current)); const quarterPrevious = sum(points.map((point) => point.previous));
      const positions = series.map((point, index) => point.quarter === quarter ? index : null).filter((index) => index != null);
      return { quarter, name: quarter, current: quarterCurrent, previous: quarterPrevious, ...measure(rows, positions.map((index) => currentIndices[index]), positions.map((index) => previousIndices[index])), observedWeeks: points.filter((point) => finite(point.current)).length, selectedWeeks: points.length, start: points[0].date, end: points.at(-1).date };
    });
    const heatmap = storeAggregates.map((entry) => ({ store: entry.key, current: entry.current, values: entry.series, cells: selected.map((period, index) => ({ date: period.date, value: entry.series[index] })) }));
    const movers = productAggregates.filter((entry) => finite(entry.delta)).sort((a, b) => b.delta - a.delta || a.key.localeCompare(b.key));
    return {
      selection: { start: selected[0]?.date || null, end: selected.at(-1)?.date || null, requestedStart: start, requestedEnd: end, comparison, coverage: coverageMode, stores: [...stores], products: [...products], categories: [...categories] },
      periods: selected.map(({ index, ...period }) => period), totals, series, stores: storeAggregates, products: productAggregates, categories: categoryAggregates, storeProducts, storeCategories, quarters, heatmap,
      coverage: { mode: coverageMode, commonEnd, effectiveEnd, cutoffs, noDataStores, comparisonComplete, comparisonStart: previousDates[0] || null, comparisonEnd: previousDates.at(-1) || null, comparisonCalendarWeeks: comparisonCalendarDates.length, missingComparisonDates, calendarSpanDays, excludedWeeks: periods.filter((period) => period.date >= start && period.date <= end && effectiveEnd && period.date > effectiveEnd).length, observedCells: series.reduce((total, point) => total + point.observedRows, 0), expectedCells: selected.length * rows.length, warnings: coverageWarnings },
      top: { store: storeAggregates.find((entry) => finite(entry.current)) || null, product: productAggregates.find((entry) => finite(entry.current)) || null, category: categoryAggregates.find((entry) => finite(entry.current)) || null },
      movers: { gainers: movers.filter((entry) => entry.delta > 0), decliners: [...movers.filter((entry) => entry.delta < 0)].reverse(), all: movers },
      rows: rows.map((row) => ({ ...row, values: [...row.values] })), warnings: [...(snapshot.warnings || []), ...validation.warnings, ...coverageWarnings],
    };
  }

  function weekObservation(analysis, date = null) {
    if (date !== null && date !== undefined && !validISO(date)) throw new TypeError("Weekly observation date must be an ISO date string or null.");
    const series = Array.isArray(analysis?.series) ? analysis.series : [];
    const empty = { date: null, index: -1, current: null, observedRows: 0, totalObservedRows: 0, totalRows: 0, retailers: [] };
    if (!series.length) return empty;
    let index = series.length - 1;
    if (date != null) {
      const target = Date.parse(date + "T00:00:00Z");
      let distance = Infinity;
      series.forEach((point, candidate) => {
        if (!validISO(point?.date)) return;
        const candidateDistance = Math.abs(Date.parse(point.date + "T00:00:00Z") - target);
        if (candidateDistance < distance || candidateDistance === distance && point.date < series[index].date) { index = candidate; distance = candidateDistance; }
      });
    }
    const point = series[index];
    if (!validISO(point?.date)) return empty;
    const observedRows = Number.isInteger(point.observedRows) && point.observedRows >= 0 ? point.observedRows : 0;
    const retailers = (Array.isArray(analysis?.stores) ? analysis.stores : []).filter(store => typeof store?.key === "string" && store.key).map(store => ({ key: store.key, name: typeof store.name === "string" ? store.name : store.key, current: finite(store.series?.[index]) ? store.series[index] : null })).sort((a, b) => a.key.localeCompare(b.key));
    return { date: point.date, index, current: finite(point.current) ? point.current : null, observedRows, totalObservedRows: observedRows, totalRows: Number.isInteger(point.totalRows) && point.totalRows >= 0 ? point.totalRows : 0, retailers };
  }

  root.PPCSelloutModel = Object.freeze({ normalizeWorkbookRows, parseCsv, validateSnapshot, analyze, weekObservation, options, parseDate, parseNumber, normalizeQuarter, fiscalQuarter, addDays, sum, growth });
})(typeof globalThis !== "undefined" ? globalThis : this);
