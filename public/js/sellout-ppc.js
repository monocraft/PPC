/* Read-only USD price projection and a per-click, expiring in-browser capability. */
(function (root) {
  "use strict";
  const CHANNEL_PREFIX = "ppc-analytics-";
  const REQUEST = "ppc-prices-request", RESPONSE = "ppc-prices-response";
  const LIMIT = 10000, MAX_BYTES = 2 * 1024 * 1024;
  const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
  const object = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const own = (value, key) => object(value) && Object.hasOwn(value, key) ? value[key] : undefined;
  const string = (value, max = 300) => typeof value === "string" && value.length <= max ? value.trim() : "";
  const array = value => Array.isArray(value) ? value : [];

  function normalizeSku(value) {
    const sku = string(value).normalize("NFKC").replace(/\s+/g, "").toUpperCase();
    return sku && !RESERVED.has(sku.toLowerCase()) && /^[A-Z0-9][A-Z0-9._\/-]*(?:#[A-Z0-9]{1,12})?$/.test(sku) ? sku : "";
  }
  function basePn(value) {
    // ASCM declares base PNs; PLC supports #country SKU suffixes. Only a
    // declared unsuffixed seven-character HP PN can satisfy this fallback.
    const match = normalizeSku(value).match(/^([A-Z0-9]{7})(?:#[A-Z0-9]{3})?$/);
    return match ? match[1] : "";
  }
  function usd(value) {
    if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
    if (typeof value !== "string" || value.length > 100) return null;
    const raw = value.trim().replace(/^(?:USD\s*|\$\s*)/i, "");
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return null;
    const price = Number(raw.replace(/,/g, ""));
    return Number.isFinite(price) && price >= 0 ? price : null;
  }
  function entries(config) {
    if (Array.isArray(config)) return config.map(entry => object(entry?.product) ? { product: entry.product, category: string(entry.categoryName, 255) || string(entry.categoryId, 255) } : { product: entry, category: string(entry?.categoryId, 255) });
    return array(config?.categories).flatMap(category => array(category?.board?.products).map(product => ({ product, category: string(category?.name, 255) || string(category?.id, 255) })));
  }
  function launchRecords(product) {
    const source = product?.plc?.launchAvailability;
    if (!object(source)) return [];
    if (source.formatVersion === 1 && Array.isArray(source.records)) {
      const typed = source.records.filter(record => object(record) && Number.isInteger(record.row) && record.row > 0 && object(record.identity) && object(record.pricing));
      if (typed.length || !array(source.rows).length) return typed.map(record => ({ skus: array(record.skus), usd: record.pricing.usd, updated: string(record.source?.checkedDate, 100) || string(source.updateDate, 100) }));
    }
    return array(source.rows).filter(row => object(row) && Number.isInteger(row.row) && row.row > 0 && Array.isArray(row.values)).map(row => ({ skus: array(row.skus), usd: row.values[0], updated: string(source.updateDate, 100) }));
  }
  function declaredSkus(product, trackers) {
    const values = array(product?.partSkus).map(item => typeof item === "string" ? item : own(item, "code") || own(item, "sku") || own(item, "value"));
    values.push(...array(product?.ascm?.basePartNumbers), ...array(product?.ascm?.basePns));
    array(product?.ascm?.records).forEach(record => values.push(own(record, "basePartNumber") || own(record, "basePN") || own(record, "basePn")));
    values.push(product?.basePn, product?.basePN, product?.hpPartNumber);
    array(product?.variantGroups).forEach(group => array(group?.items).forEach(item => {
      const code = normalizeSku(own(item, "code"));
      // Color/layout abbreviations are not product identifiers.
      if (/^[A-Z0-9]{7}(?:#[A-Z0-9]{1,12})?$/.test(code)) values.push(code);
    }));
    trackers.forEach(record => values.push(...record.skus));
    return [...new Set(values.map(normalizeSku).filter(Boolean))].sort();
  }
  function issue(sku, code, candidates, blocking = true) {
    return { sku, code, blocking, sourceProductIds: [...new Set(candidates.map(candidate => candidate.sourceProductId))].sort(), values: candidates.map(candidate => ({ sourceProductId: candidate.sourceProductId, msrp: candidate.msrp, priceSource: candidate.priceSource })) };
  }
  function coverage(prices, conflicts, requested = prices.length) {
    const priced = prices.filter(price => price.msrp !== null).length;
    return { requested, matched: prices.length, priced, missing: requested - priced, conflicts: new Set(conflicts.filter(conflict => conflict.blocking && conflict.code !== "UNMATCHED_SKU").map(conflict => conflict.sku)).size };
  }
  function projectPortfolio(config, { skus, authority = "current-local-ppc" } = {}) {
    if (!["current-local-ppc", "ppc-backup"].includes(authority)) throw new Error("Invalid PPC pricing authority.");
    const candidates = new Map(), conflicts = [];
    const sourceEntries = entries(config);
    if (sourceEntries.length > LIMIT) throw new Error("PPC pricing product limit exceeded.");
    for (const { product, category } of sourceEntries) {
      const sourceProductId = string(product?.id);
      if (!object(product) || !sourceProductId) continue;
      const trackers = launchRecords(product), saved = usd(own(product, "price"));
      for (const sku of declaredSkus(product, trackers)) {
        const relevant = trackers.filter(record => record.skus.some(value => normalizeSku(value) === sku));
        const numeric = relevant.map(record => ({ msrp: usd(record.usd), updated: record.updated })).filter(record => record.msrp !== null);
        const amounts = [...new Set(numeric.map(record => record.msrp))];
        const priceSource = saved !== null ? "saved-product" : amounts.length === 1 ? "launch-tracker" : "missing";
        const candidate = { sku, msrp: saved !== null ? saved : amounts.length === 1 ? amounts[0] : null, currency: "USD", sourceProductId, ...(category ? { category } : {}), priceSource, ...(saved === null && amounts.length === 1 && numeric[0].updated ? { updated: numeric[0].updated } : {}) };
        if (amounts.length > 1 && saved === null) conflicts.push(issue(sku, "TRACKER_PRICE_CONFLICT", amounts.map(msrp => ({ sourceProductId, msrp, priceSource: "launch-tracker" }))));
        if (saved !== null && amounts.some(value => value !== saved)) conflicts.push(issue(sku, "SAVED_TRACKER_DIFFERENCE", [candidate, ...amounts.filter(value => value !== saved).map(msrp => ({ sourceProductId, msrp, priceSource: "launch-tracker" }))], false));
        if (!candidates.has(sku)) candidates.set(sku, []);
        candidates.get(sku).push(candidate);
      }
    }
    if (candidates.size > LIMIT) throw new Error("PPC pricing SKU limit exceeded.");
    const prices = [];
    for (const [sku, records] of candidates) {
      const unique = [...new Map(records.map(record => [JSON.stringify(record), record])).values()];
      if (unique.length > 1) conflicts.push(issue(sku, "SKU_PRODUCT_CONFLICT", unique));
      else prices.push(unique[0]);
    }
    const projection = { schemaVersion: 1, currency: "USD", authority, prices: prices.sort((a, b) => a.sku.localeCompare(b.sku)), conflicts: conflicts.sort((a, b) => a.sku.localeCompare(b.sku) || a.code.localeCompare(b.code)) };
    projection.coverage = coverage(prices, conflicts, candidates.size);
    return skus === undefined ? projection : resolvePrices(projection, skus);
  }
  function validateProjection(projection) {
    const errors = [], allowed = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
    if (!allowed(projection, ["schemaVersion", "currency", "authority", "prices", "conflicts", "coverage"]) || projection.schemaVersion !== 1 || projection.currency !== "USD" || !["current-local-ppc", "ppc-backup"].includes(projection.authority)) return { ok: false, errors: ["Invalid PPC USD pricing projection."] };
    if (!Array.isArray(projection.prices) || projection.prices.length > LIMIT || !Array.isArray(projection.conflicts) || projection.conflicts.length > LIMIT) return { ok: false, errors: ["PPC pricing arrays are invalid or too large."] };
    const seen = new Set();
    Array.from(projection.prices).forEach((price, index) => {
      if (!allowed(price, ["sku", "msrp", "currency", "sourceProductId", "category", "updated", "priceSource", "matchedSku", "match"]) || !normalizeSku(price.sku) || normalizeSku(price.sku) !== price.sku || !string(price.sourceProductId) || price.currency !== "USD" || price.msrp !== null && (typeof price.msrp !== "number" || usd(price.msrp) === null) || !["saved-product", "launch-tracker", "missing"].includes(price.priceSource)) { errors.push(`Invalid PPC price row ${index + 1}.`); return; }
      if (seen.has(price.sku)) errors.push(`Duplicate PPC price SKU ${price.sku}.`);
      seen.add(price.sku);
      for (const [field, max] of [["category", 255], ["updated", 100], ["matchedSku", 300]]) if (price[field] !== undefined && (typeof price[field] !== "string" || price[field].length > max)) errors.push(`Invalid PPC price ${field}.`);
      if (price.match !== undefined && !["exact", "base-pn"].includes(price.match)) errors.push("Invalid PPC SKU matching method.");
    });
    Array.from(projection.conflicts).forEach(conflict => {
      if (!allowed(conflict, ["sku", "code", "blocking", "sourceProductIds", "values"]) || !normalizeSku(conflict.sku) || typeof conflict.code !== "string" || !["TRACKER_PRICE_CONFLICT", "SAVED_TRACKER_DIFFERENCE", "SKU_PRODUCT_CONFLICT", "BASE_PN_CONFLICT", "UNMATCHED_SKU"].includes(conflict.code) || typeof conflict.blocking !== "boolean" || !Array.isArray(conflict.sourceProductIds) || conflict.sourceProductIds.length > LIMIT || conflict.sourceProductIds.some(value => !string(value)) || !Array.isArray(conflict.values) || conflict.values.length > LIMIT || conflict.values.some(value => !allowed(value, ["sourceProductId", "msrp", "priceSource"]) || !string(value.sourceProductId) || value.msrp !== null && (typeof value.msrp !== "number" || usd(value.msrp) === null) || !["saved-product", "launch-tracker", "missing"].includes(value.priceSource))) errors.push("Invalid PPC pricing conflict.");
    });
    if (!allowed(projection.coverage, ["requested", "matched", "priced", "missing", "conflicts"]) || Object.keys(projection.coverage || {}).length !== 5 || Object.values(projection.coverage || {}).some(value => !Number.isInteger(value) || value < 0)) errors.push("Invalid PPC pricing coverage.");
    else if (!errors.length) {
      const calculated = coverage(projection.prices, projection.conflicts, projection.coverage.requested);
      if (projection.coverage.requested < projection.prices.length || Object.keys(calculated).some(key => calculated[key] !== projection.coverage[key])) errors.push("PPC pricing coverage does not match its allowlisted rows.");
    }
    try { if (JSON.stringify(projection).length > MAX_BYTES) errors.push("PPC pricing payload exceeds the size limit."); } catch (_) { errors.push("PPC pricing payload must be serializable."); }
    return { ok: errors.length === 0, errors: [...new Set(errors)] };
  }
  function requestedSkus(values) {
    if (!Array.isArray(values) || values.length > LIMIT || values.some(value => !normalizeSku(value))) throw new Error("Choose valid SKU strings within the PPC pricing limit.");
    return [...new Set(values.map(normalizeSku))];
  }
  function resolvePrices(projection, skus) {
    const validation = validateProjection(projection);
    if (!validation.ok) throw new Error(validation.errors.join(" "));
    const requested = requestedSkus(skus), exact = new Map(projection.prices.map(price => [price.sku, price])), prices = [], conflicts = [];
    const blocking = sku => projection.conflicts.filter(conflict => conflict.sku === sku && conflict.blocking);
    const ambiguousBase = base => {
      const family = projection.prices.filter(price => basePn(price.sku) === base);
      const issues = projection.conflicts.filter(conflict => conflict.blocking && basePn(conflict.sku) === base);
      const products = new Set([...family.map(price => price.sourceProductId), ...issues.flatMap(conflict => conflict.sourceProductIds)]);
      const amounts = new Set(family.filter(price => price.msrp !== null).map(price => price.msrp));
      return products.size > 1 || amounts.size > 1 || issues.length ? family : null;
    };
    for (const sku of requested) {
      const blocked = blocking(sku);
      if (blocked.length) { conflicts.push(...blocked); continue; }
      if (exact.has(sku)) { const price = exact.get(sku); prices.push({ ...price, match: price.match || "exact", matchedSku: price.matchedSku || sku }); conflicts.push(...projection.conflicts.filter(conflict => conflict.sku === sku && !conflict.blocking)); continue; }
      const base = basePn(sku);
      const familyConflict = base && base !== sku ? ambiguousBase(base) : null;
      if (base && base !== sku && exact.has(base) && !blocking(base).length && familyConflict) conflicts.push(issue(sku, "BASE_PN_CONFLICT", familyConflict));
      else if (base && base !== sku && exact.has(base) && !blocking(base).length) { prices.push({ ...exact.get(base), sku, match: "base-pn", matchedSku: base }); conflicts.push(...projection.conflicts.filter(conflict => conflict.sku === base && !conflict.blocking).map(conflict => ({ ...conflict, sku }))); }
      else if (base && base !== sku && blocking(base).length) conflicts.push(...blocking(base).map(conflict => ({ ...conflict, sku, code: "BASE_PN_CONFLICT" })));
      else conflicts.push({ sku, code: "UNMATCHED_SKU", blocking: true, sourceProductIds: [], values: [] });
    }
    return { schemaVersion: 1, currency: "USD", authority: projection.authority, prices, conflicts, coverage: coverage(prices, conflicts, requested.length) };
  }
  function nonce(win, bytes = 32) {
    if (!win.crypto?.getRandomValues) throw new Error("Secure PPC linking is unavailable in this browser.");
    return [...win.crypto.getRandomValues(new Uint8Array(bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
  }
  const validNonce = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const validRequest = value => object(value) && Object.keys(value).every(key => ["type", "version", "requestId", "skus"].includes(key)) && value.type === REQUEST && value.version === 1 && typeof value.requestId === "string" && /^[a-f0-9]{32}$/.test(value.requestId) && (value.skus === undefined || Array.isArray(value.skus) && value.skus.length <= LIMIT && value.skus.every(sku => normalizeSku(sku)));

  function attachPublisher({ getPortfolio, links, window: win = root, ttlMs = 300000 } = {}) {
    if (typeof getPortfolio !== "function" || typeof win.BroadcastChannel !== "function" || !win.location || win.location.origin === "null") throw new Error("Open PPC in a browser to link its current USD prices.");
    const expected = new URL("analytics.html", win.location.href), channels = new Map(), bindings = [];
    const close = capability => { const state = channels.get(capability); if (!state) return; win.clearTimeout(state.timer); state.channel.close(); channels.delete(capability); };
    for (const link of Array.from(links || [])) {
      const target = new URL(link.href, win.location.href);
      if (target.origin !== expected.origin || target.pathname !== expected.pathname) continue;
      const click = event => {
        if (event.defaultPrevented || event.isTrusted === false) return;
        const capability = nonce(win), channel = new win.BroadcastChannel(CHANNEL_PREFIX + capability);
        const timer = win.setTimeout(() => close(capability), Math.min(300000, Math.max(1000, ttlMs)));
        timer?.unref?.(); channels.set(capability, { channel, timer });
        channel.onmessage = event => {
          if (!validRequest(event.data)) return;
          try { const projection = projectPortfolio(getPortfolio(), { skus: event.data.skus }); const valid = validateProjection(projection); if (!valid.ok) throw new Error("Invalid projection."); channel.postMessage({ type: RESPONSE, version: 1, requestId: event.data.requestId, projection }); }
          catch (_) { channel.postMessage({ type: RESPONSE, version: 1, requestId: event.data.requestId, error: "Current PPC prices are unavailable." }); }
        };
        const url = new URL(target.href); url.hash = `ppc-link=${capability}`; link.href = url.href;
        link.target = "_blank"; link.rel = [...new Set((link.rel || "").split(/\s+/).filter(Boolean).concat("noopener", "noreferrer"))].join(" ");
      };
      link.addEventListener("click", click); bindings.push({ link, click });
    }
    const dispose = () => { bindings.forEach(({ link, click }) => link.removeEventListener("click", click)); [...channels.keys()].forEach(close); win.removeEventListener?.("pagehide", dispose); };
    win.addEventListener?.("pagehide", dispose);
    return Object.freeze({ dispose, activeChannels: () => channels.size });
  }
  function connectDashboard(capability, onProjection, { window: win = root, timeoutMs = 5000, autoRequest = true } = {}) {
    if (!validNonce(capability) || typeof win.BroadcastChannel !== "function" || win.location?.origin === "null") throw new Error("This PPC price link is invalid or unavailable.");
    const channel = new win.BroadcastChannel(CHANNEL_PREFIX + capability), pending = new Map(); let disposed = false;
    // The capability is not retained in URLs, referrers, browser storage, or exports.
    try { const url = new URL(win.location.href); if (new URLSearchParams(url.hash.slice(1)).get("ppc-link") === capability) { url.hash = ""; win.history.replaceState(win.history.state, "", url.pathname + url.search); } } catch (_) {}
    const disconnect = () => { if (disposed) return; disposed = true; channel.close(); pending.forEach(entry => { win.clearTimeout(entry.timer); entry.reject(new Error("PPC price link disconnected.")); }); pending.clear(); win.removeEventListener?.("pagehide", disconnect); };
    channel.onmessage = event => {
      const data = event.data;
      if (!object(data) || Object.keys(data).some(key => !["type", "version", "requestId", "projection", "error"].includes(key)) || data.type !== RESPONSE || data.version !== 1 || !pending.has(data.requestId)) return;
      const entry = pending.get(data.requestId); pending.delete(data.requestId); win.clearTimeout(entry.timer);
      if (data.error) { entry.reject(new Error("Current PPC prices are unavailable.")); return; }
      const validation = validateProjection(data.projection);
      if (!validation.ok) { entry.reject(new Error("PPC returned an invalid pricing projection.")); return; }
      entry.resolve(data.projection); if (typeof onProjection === "function") onProjection(data.projection);
    };
    const request = skus => new Promise((resolve, reject) => {
      if (disposed) { reject(new Error("PPC price link disconnected.")); return; }
      let selected; try { selected = skus === undefined ? undefined : requestedSkus(skus); } catch (error) { reject(error); return; }
      const requestId = nonce(win, 16), timer = win.setTimeout(() => { pending.delete(requestId); reject(new Error("The PPC price link expired. Reopen Analytics from PPC to reconnect.")); }, Math.min(15000, Math.max(100, timeoutMs)));
      timer?.unref?.(); pending.set(requestId, { resolve, reject, timer }); channel.postMessage({ type: REQUEST, version: 1, requestId, ...(selected ? { skus: selected } : {}) });
    });
    win.addEventListener?.("pagehide", disconnect);
    return Object.freeze({ request, disconnect, ready: autoRequest ? request() : Promise.resolve(null) });
  }
  root.PPCSelloutPricing = Object.freeze({ normalizeSku, basePn, usd, projectPortfolio, validateProjection, resolvePrices, attachPublisher, connectDashboard });
})(typeof globalThis !== "undefined" ? globalThis : this);
