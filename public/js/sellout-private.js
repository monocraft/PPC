/* Analytics-only protection. Uses the existing PPC codec; no storage, network, or master writes. */
(function registerPrivateAnalytics(root) {
  "use strict";
  const KIND = "ppc-retail-analytics", ENTRY = "analytics.json", VERSION = 1;
  const reserved = new Set(["__proto__", "constructor", "prototype"]);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const plain = value => Boolean(value && typeof value === "object" && !Array.isArray(value)
    && [null, Object.prototype].includes(Object.getPrototypeOf(value)));
  const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
  const fail = message => { throw new Error(message); };
  const object = () => ({});
  function assign(target, key, value) { Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: true }); }
  function dependencies() {
    const codec = root.PortfolioPackage, model = root.PPCSelloutModel;
    if (!codec?.encrypt || !codec?.decrypt || !codec?.createZip || !codec?.readZip || !model?.validateSnapshot) fail("The analytics protection tools did not load. Reopen the dashboard.");
    return { codec, model, limit: codec.MAX_PACKAGE_BYTES - 1024 };
  }
  function read(source, key) {
    const property = Object.getOwnPropertyDescriptor(source, key);
    if (!property || !own(property, "value")) fail("Analytics backups cannot contain computed properties.");
    return property.value;
  }
  function text(value, limit, required = false) {
    if (typeof value !== "string" || value.length > limit || (required && !value.trim())) fail("An analytics backup text field is invalid or too long.");
    return value;
  }
  function json(value, seen = new Set(), depth = 0, budget = { remaining: root.PortfolioPackage.MAX_PACKAGE_BYTES - 1024 }) {
    const consume = amount => { budget.remaining -= amount; if (budget.remaining < 0) fail("The analytics workspace exceeds the package size limit."); };
    if (depth > 24) fail("The analytics backup is too deeply nested.");
    if (value === null || typeof value === "boolean") { consume(value === false ? 5 : 4); return value; }
    if (typeof value === "string") { text(value, 16384); consume(encoder.encode(JSON.stringify(value)).length); return value; }
    if (typeof value === "number") { if (!Number.isFinite(value)) fail("Analytics backups require finite numeric values."); consume(String(value).length); return value; }
    if (!Array.isArray(value) && !plain(value)) fail("Analytics backups support ordinary JSON records only.");
    if (seen.has(value)) fail("The analytics backup contains a circular reference.");
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      if (value.length > 4000000) fail("The analytics backup contains too many values.");
      consume(2 + Math.max(0, value.length - 1));
      result = Array.from({ length: value.length }, (_, index) => {
        if (!own(value, index)) fail("Missing observations must be explicit null values.");
        return json(read(value, String(index)), seen, depth + 1, budget);
      });
    } else {
      if (Object.getOwnPropertySymbols(value).length) fail("Analytics backups cannot contain hidden symbol fields.");
      const keys = Object.keys(value);
      if (keys.length > 30000) fail("The analytics backup contains too many record fields.");
      consume(2 + Math.max(0, keys.length - 1));
      result = object();
      for (const key of keys) {
        if (reserved.has(key.toLowerCase())) fail("The analytics backup contains an unsafe record key.");
        const item = read(value, key);
        if (item !== undefined) { consume(encoder.encode(JSON.stringify(key)).length + 1); assign(result, key, json(item, seen, depth + 1, budget)); }
      }
    }
    seen.delete(value); return result;
  }
  function pick(source, fields) {
    if (!plain(source)) fail("The analytics backup contains an invalid record.");
    const result = object();
    for (const key of fields) if (own(source, key)) {
      const value = read(source, key);
      if (value !== undefined) assign(result, key, json(value));
    }
    return result;
  }
  const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  function snapshot(value, model) {
    if (!plain(value)) fail("Choose a valid analytics snapshot before protecting it.");
    const sourcePeriods = read(value, "periods"), sourceRows = read(value, "rows");
    if (!Array.isArray(sourcePeriods) || !Array.isArray(sourceRows)) fail("Choose a valid analytics snapshot before protecting it.");
    if (sourcePeriods.length > 4000 || sourceRows.length > 30000 || sourcePeriods.length * sourceRows.length > 4000000) fail("The analytics snapshot exceeds the supported record limit.");
    const result = pick(value, ["schemaVersion", "title", "sourceUrl", "sharedUrl", "sheet", "importedAt", "importedOn", "asOf", "latestReportedDate", "sourceModifiedAt", "unit", "periodConvention", "audit"]);
    result.periods = json(sourcePeriods).map(period => pick(period, ["date", "label", "originalHeader", "fiscalQuarter", "quarter", "fiscalYear", "sourceColumn", "inferred"]));
    result.rows = json(sourceRows).map(row => pick(row, ["id", "sourceRow", "store", "sku", "product", "category", "lifetime", "lifetimeFormula", "values"]));
    const sourceWarnings = own(value, "warnings") ? read(value, "warnings") : null;
    result.warnings = sourceWarnings == null ? [] : json(sourceWarnings);
    const validation = model.validateSnapshot(result);
    if (!validation.ok) fail("The analytics snapshot is invalid. Review its dates, identifiers, and observations before protecting it.");
    for (const period of result.periods) if (period.inferred !== undefined && typeof period.inferred !== "boolean") fail("An analytics period contains invalid source metadata.");
    for (const row of result.rows) {
      if (row.id !== undefined) text(row.id, 1000);
      if (row.lifetimeFormula !== undefined) text(row.lifetimeFormula, 1000);
      if (row.sourceRow !== undefined && (!Number.isSafeInteger(row.sourceRow) || row.sourceRow < 1)) fail("An analytics row contains invalid source metadata.");
    }
    return result;
  }
  function prices(value, skus) {
    if (value === undefined) return object();
    if (!plain(value) || Object.keys(value).length > 30000) fail("The analytics price map is invalid.");
    const result = object();
    for (const sku of Object.keys(value)) {
      text(sku, 300, true);
      if (reserved.has(sku.trim().toLowerCase())) fail("The analytics price map contains an unsafe SKU key.");
      const price = pick(read(value, sku), ["msrp", "source", "currency", "sourceProductId", "category", "updated", "priceSource", "matchedSku", "match"]);
      if (!own(price, "msrp") || (price.msrp !== null && (typeof price.msrp !== "number" || !Number.isFinite(price.msrp) || price.msrp < 0))) fail("Analytics MSRP must be a nonnegative numeric USD value or null.");
      price.source = price.source === undefined ? "" : text(price.source, 300);
      if (price.currency !== undefined && price.currency !== "USD") fail("Analytics price maps must use USD MSRP.");
      for (const key of ["sourceProductId", "category", "updated", "priceSource", "matchedSku", "match"]) if (price[key] !== undefined) text(price[key], key === "category" ? 255 : 300);
      if (skus.has(sku)) assign(result, sku, price);
    }
    return result;
  }
  function period(value) {
    const result = pick(value, ["start", "end", "requestedStart", "requestedEnd", "comparison", "coverage", "stores", "products", "categories", "priceBand"]);
    for (const key of ["start", "end", "requestedStart", "requestedEnd"]) if (result[key] !== undefined && result[key] !== null && !validDate(result[key])) fail("A planning shortlist period has an invalid date.");
    if (result.start && result.end && result.start > result.end) fail("A planning shortlist period has reversed dates.");
    if (result.comparison !== undefined && !["previous", "year", "none"].includes(result.comparison)) fail("A planning shortlist has an invalid comparison.");
    if (result.coverage !== undefined && !["common", "available"].includes(result.coverage)) fail("A planning shortlist has an invalid coverage mode.");
    if (result.priceBand !== undefined) text(result.priceBand, 100);
    for (const key of ["stores", "products", "categories"]) if (result[key] !== undefined) {
      if (!Array.isArray(result[key]) || result[key].length > 30000) fail("A planning shortlist filter is invalid.");
      result[key].forEach(item => text(item, key === "products" ? 300 : 255, true));
    }
    return result;
  }
  function shortlist(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 100) fail("The planning shortlist must contain at most 100 entries.");
    const keys = new Set();
    return value.map(item => {
      const result = pick(item, ["key", "label", "title", "text", "evidence", "sku", "store", "category", "sourceTitle", "addedAt", "owner", "targetMonth", "notes"]);
      for (const key of ["key", "title", "text"]) text(result[key], key === "text" ? 16000 : 2000, true);
      for (const key of ["label", "evidence", "sku", "store", "category", "sourceTitle", "addedAt"]) if (result[key] !== undefined) text(result[key], key === "evidence" ? 4000 : key === "sourceTitle" ? 1000 : 300);
      if (result.owner !== undefined) text(result.owner, 120);
      if (result.notes !== undefined) text(result.notes, 2000);
      if (result.targetMonth !== undefined && result.targetMonth !== "" && (typeof result.targetMonth !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(result.targetMonth))) fail("A planning shortlist roadmap month is invalid.");
      if (keys.has(result.key)) fail("The planning shortlist contains duplicate entries.");
      keys.add(result.key);
      if (own(item, "period") && read(item, "period") !== undefined) result.period = period(read(item, "period"));
      return result;
    });
  }
  function sanitize(workspace) {
    const { model, limit } = dependencies();
    if (!plain(workspace)) fail("Choose an analytics workspace to protect.");
    const allowed = new Set(["snapshot", "prices", "shortlist", "ppcProjection", "pricingSource"]);
    if (Object.getOwnPropertySymbols(workspace).length || Object.keys(workspace).some(key => !allowed.has(key))) fail("Only analytics data belongs in an analytics package. Portfolio credentials and settings must stay separate.");
    const data = snapshot(read(workspace, "snapshot"), model);
    const result = { snapshot: data, prices: prices(own(workspace, "prices") ? read(workspace, "prices") : undefined, new Set(data.rows.map(row => row.sku))), shortlist: shortlist(own(workspace, "shortlist") ? read(workspace, "shortlist") : undefined) };
    if (own(workspace, "ppcProjection") && read(workspace, "ppcProjection") != null) {
      const projection = json(read(workspace, "ppcProjection"));
      if (!root.PPCSelloutPricing?.validateProjection) fail("The PPC pricing validation tools did not load. Reopen the dashboard.");
      if (!root.PPCSelloutPricing.validateProjection(projection).ok) fail("The PPC pricing projection is invalid.");
      result.ppcProjection = projection;
    }
    if (own(workspace, "pricingSource") && read(workspace, "pricingSource") != null) {
      const source = pick(read(workspace, "pricingSource"), ["title", "date", "authority", "updatedAt", "note"]);
      text(source.title, 1000, true);
      if (source.date !== undefined && source.date !== "" && !validDate(source.date)) fail("The pricing source date is invalid.");
      if (source.authority !== undefined) text(source.authority, 100, true);
      if (source.updatedAt !== undefined) text(source.updatedAt, 100);
      if (source.note !== undefined) text(source.note, 1000);
      result.pricingSource = source;
    }
    if (encoder.encode(JSON.stringify(result)).length > limit) fail("The analytics workspace exceeds the package size limit.");
    return result;
  }
  async function encrypt(workspace, key) {
    const { codec, limit } = dependencies();
    if (typeof key !== "string") fail("Enter your existing complete PPC package key.");
    const normalizedKey = codec.normalizeKey(key);
    const safe = sanitize(workspace);
    const payload = encoder.encode(JSON.stringify({ kind: KIND, schemaVersion: VERSION, workspace: safe }));
    if (payload.length > limit) fail("The analytics workspace exceeds the package size limit.");
    const archive = codec.createZip([{ name: ENTRY, data: payload }]);
    try { return await codec.encrypt(archive, normalizedKey); }
    finally { payload.fill(0); archive.fill(0); }
  }
  async function decrypt(bytes, key) {
    const { codec, limit } = dependencies();
    if (typeof key !== "string") fail("Enter your existing complete PPC package key.");
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) fail("Choose an encrypted analytics package.");
    if (bytes.byteLength > codec.MAX_PACKAGE_BYTES) fail("The analytics package exceeds the size limit.");
    if (!codec.isEncrypted(bytes)) fail("Choose a protected analytics package. Plaintext backups cannot unlock here.");
    const normalizedKey = codec.normalizeKey(key);
    const plaintext = await codec.decrypt(bytes, normalizedKey);
    try {
      const entries = codec.readZip(plaintext);
      if (entries.size !== 1 || !entries.has(ENTRY)) fail("This package belongs to another module. Choose an analytics package.");
      const payload = entries.get(ENTRY);
      if (payload.byteLength > limit) fail("The analytics workspace exceeds the package size limit.");
      let envelope;
      try { envelope = JSON.parse(decoder.decode(payload)); }
      catch { fail("The analytics package content could not be read."); }
      if (!plain(envelope) || envelope.kind !== KIND || envelope.schemaVersion !== VERSION || Object.keys(envelope).length !== 3
        || !own(envelope, "workspace")) fail("The analytics package uses an unsupported module or schema.");
      return sanitize(envelope.workspace);
    } finally { plaintext.fill(0); }
  }
  root.PPCSelloutPrivate = Object.freeze({ encrypt, decrypt, sanitizeWorkspace: sanitize, kind: KIND, schemaVersion: VERSION });
})(globalThis);
