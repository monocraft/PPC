/* Pure cross-category search shared by global search and category filters. */
(function (root) {
  "use strict";

  const MAX_FIELD_LENGTH = 4096;
  const MAX_QUERY_LENGTH = 512;
  const MAX_QUERY_TOKENS = 32;
  const MAX_FIELDS = 768;
  const MAX_ITEMS = 256;
  const MAX_RESULTS = 1000;

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // Packages contain data properties. Do not invoke custom getters or toString
  // methods when a malformed record reaches a read-only search operation.
  function read(value, key) {
    if (value === null || typeof value !== "object") return undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
    } catch { return undefined; }
  }

  function safeString(value, limit = MAX_FIELD_LENGTH) {
    if (typeof value === "string") return value.slice(0, limit);
    if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, limit);
    if (typeof value === "boolean") return String(value);
    return "";
  }

  function normalize(value) {
    return safeString(value).normalize("NFKD").toLowerCase()
      .replace(/\p{M}/gu, "")
      .replace(/đ/g, "d")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function compact(value) {
    return normalize(value).replace(/ /g, "");
  }

  function queryInfo(query) {
    const type = typeof query;
    if (query != null && !["string", "number", "boolean"].includes(type)) return null;
    if (type === "number" && !Number.isFinite(query)) return null;
    const raw = safeString(query, MAX_QUERY_LENGTH + 1);
    if (raw.length > MAX_QUERY_LENGTH) return null;
    const text = normalize(raw);
    const tokens = [...new Set(text.split(" ").filter(Boolean))];
    if (tokens.length > MAX_QUERY_TOKENS) return null;
    const identifier = raw.trim().replace(/\s*([#/_\-.])\s*/gu, "$1");
    const separatedIdentifier = !/\s/u.test(identifier) && /[#/_\-.]/u.test(identifier)
      && /\p{L}/u.test(identifier) && (/\p{N}/u.test(identifier) || identifier.includes("#"));
    const spacedSkuSuffix = tokens.length === 2 && tokens[0].length >= 4 && /\p{L}/u.test(tokens[0])
      && /\p{N}/u.test(tokens[0]) && tokens[1].length <= 4;
    return { text, tokens, compact: text.replace(/ /g, ""), atomic: separatedIdentifier || spacedSkuSuffix };
  }

  function eachItem(value, visit, limit = MAX_ITEMS) {
    if (!Array.isArray(value)) return;
    for (let index = 0; index < Math.min(value.length, limit); index++) visit(read(value, String(index)));
  }

  function productIndex(product) {
    const fields = [];
    const skus = [];
    const variants = [];
    const name = normalize(read(product, "name"));
    const seenSkus = new Set();
    const seenVariants = new Set();
    const addText = (value) => {
      if (fields.length >= MAX_FIELDS) return;
      const text = normalize(value);
      if (text) fields.push(text);
    };
    const addCode = (target, seen, value) => {
      if (target.length >= MAX_ITEMS) return;
      const code = safeString(value).trim();
      const key = compact(code);
      if (!key || seen.has(key)) return;
      seen.add(key);
      target.push({ code, compact: key });
      addText(code);
    };
    // An explicit allowlist keeps images, internal IDs, master revisions,
    // source filenames, and other bookkeeping out of the search index.
    for (const field of ["name", "codename", "tier", "family", "statusLabel", "statusType", "variantLabel", "priceLabel",
      "ffsDate", "globalAnnouncementDate", "webReadinessDate", "finalAssetsDate", "generalAvailabilityDate", "endManufacturingDate"]) {
      addText(read(product, field));
    }
    const roadmap = read(product, "roadmap");
    for (const field of ["family", "status", "confidence", "notes", "startMonth", "launchMonth", "endMonth"]) addText(read(roadmap, field));

    eachItem(read(product, "partSkus"), (item) => {
      addCode(skus, seenSkus, typeof item === "string" ? item : read(item, "code") || read(item, "sku") || read(item, "value"));
    });
    const ascm = read(product, "ascm");
    eachItem(read(ascm, "basePartNumbers"), (code) => addCode(skus, seenSkus, code));
    eachItem(read(ascm, "records"), (record) => {
      for (const field of ["basePartNumber", "basePN", "basePn"]) addCode(skus, seenSkus, read(record, field));
    });

    eachItem(read(product, "variantGroups"), (group) => {
      addText(read(group, "label"));
      eachItem(read(group, "items"), (item) => {
        addCode(variants, seenVariants, read(item, "code"));
        for (const field of ["label", "name", "colorName", "colorName2"]) addText(read(item, field));
      });
    });
    const specs = read(product, "specs");
    if (typeof specs === "string") addText(specs);
    eachItem(specs, (item) => {
      if (Array.isArray(item)) {
        addText(read(item, "0"));
        addText(read(item, "1"));
      } else if (isRecord(item)) {
        addText(read(item, "label") || read(item, "name"));
        addText(read(item, "value"));
      } else addText(item);
    });
    return { fields, skus, variants, name };
  }

  function codeMatch(codes, query, kind) {
    let best = null;
    const bases = kind === "sku" ? [1000, 900, 800] : [600, 550, 500];
    // A complete query may be any prefix. Inside a multi-word query, a lone
    // model number such as "2" must not turn an exact product name into an
    // incidental SKU hit. Variant codes commonly use two letters (BK, US).
    const codeTokens = query.tokens.filter((term) => term.length >= (kind === "sku" ? 3 : 2));
    for (const item of codes) {
      const candidates = query.atomic ? [query.compact] : [query.compact, ...codeTokens];
      for (const term of candidates) {
        let position = -1;
        if (item.compact === term) position = 0;
        else if (item.compact.startsWith(term)) position = 1;
        else if (item.compact.includes(term)) position = 2;
        if (position < 0) continue;
        const score = bases[position];
        if (!best || score > best.score) {
          best = {
            matchedSku: kind === "sku" ? item.code : "",
            matchedVariant: kind === "variant" ? item.code : "",
            matchType: `${kind}-${["exact", "prefix", "substring"][position]}`,
            score,
          };
        }
      }
    }
    return best;
  }

  function matchIndexed(index, query) {
    const codes = [...index.skus, ...index.variants];
    // A complete identifier belongs to one code or one displayed text field.
    // Its fragments must not borrow a model digit from an unrelated date.
    const matches = query.atomic
      ? codes.some((item) => item.compact.includes(query.compact)) || index.fields.some((text) => text.includes(query.text))
      : query.tokens.every((token) => index.fields.some((text) => text.includes(token)) || codes.some((item) => item.compact.includes(token)));
    if (!matches) return null;

    const sku = codeMatch(index.skus, query, "sku");
    if (sku) return sku;
    if (index.name === query.text) return { matchedSku: "", matchedVariant: "", matchType: "name-exact", score: 700 };
    if (index.name.startsWith(query.text)) return { matchedSku: "", matchedVariant: "", matchType: "name-prefix", score: 650 };
    const variant = codeMatch(index.variants, query, "variant");
    if (variant) return variant;
    // All terms are required, but they may appear in separate fields and in
    // any order. Name terms make text matches slightly more relevant.
    const nameTerms = query.tokens.filter((token) => index.name.includes(token)).length;
    return { matchedSku: "", matchedVariant: "", matchType: "text", score: 100 + Math.min(nameTerms, MAX_QUERY_TOKENS) * 5 };
  }

  // Returns a small match descriptor or null so existing category filters can
  // use the same matching rules as cross-category results.
  function matchProduct(product, query) {
    if (!isRecord(product)) return null;
    const parsed = queryInfo(query);
    if (!parsed) return null;
    if (!parsed.text) return { matchedSku: "", matchedVariant: "", matchType: "all", score: 0 };
    return matchIndexed(productIndex(product), parsed);
  }

  function boundedInteger(value, fallback, maximum) {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? Math.min(maximum, Math.max(0, Math.floor(number))) : fallback;
  }

  function search(portfolio, query, options = {}) {
    const parsed = queryInfo(query);
    if (!parsed?.text) return { results: [], total: 0 };
    const activeCategoryId = safeString(read(options, "activeCategoryId"));
    const limit = boundedInteger(read(options, "limit"), 8, MAX_RESULTS);
    const offset = boundedInteger(read(options, "offset"), 0, Number.MAX_SAFE_INTEGER);
    const matches = [];
    const categories = read(portfolio, "categories");
    eachItem(categories, (category) => {
      const categoryId = safeString(read(category, "id"));
      const board = read(category, "board");
      if (!categoryId || !isRecord(board)) return;
      const categoryName = safeString(read(category, "name")) || safeString(read(board, "title")) || "Category";
      const laneNames = new Map();
      eachItem(read(board, "lanes"), (lane) => {
        const laneId = safeString(read(lane, "id"));
        if (laneId) laneNames.set(laneId, safeString(read(lane, "label")) || safeString(read(lane, "name")) || laneId);
      }, Number.MAX_SAFE_INTEGER);
      eachItem(read(board, "products"), (product) => {
        const productId = safeString(read(product, "id"));
        if (!productId || !isRecord(product)) return;
        const match = matchIndexed(productIndex(product), parsed);
        if (!match) return;
        const laneId = safeString(read(product, "laneId"));
        matches.push({
          productId,
          productName: safeString(read(product, "name")) || "Unnamed product",
          categoryId,
          categoryName,
          laneName: laneNames.get(laneId) || laneId || "Unassigned lane",
          ...match,
        });
      }, Number.MAX_SAFE_INTEGER);
    }, Number.MAX_SAFE_INTEGER);
    // Stable sorting preserves distinct listings and portfolio order. The
    // active category affects only otherwise equal scores.
    matches.sort((a, b) => b.score - a.score
      || Number(b.categoryId === activeCategoryId) - Number(a.categoryId === activeCategoryId));
    return { results: matches.slice(offset, offset + limit), total: matches.length };
  }

  root.PortfolioSearch = Object.freeze({ normalize, matchProduct, search });
})(globalThis);
