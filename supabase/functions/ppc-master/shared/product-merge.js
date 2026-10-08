/* Lossless, deterministic product consolidation shared by the UI and master. */
(function (root) {
  "use strict";

  const MAX_ROWS = 2000, MAX_DEPTH = 32, MAX_NODES = 100000;
  const forbidden = new Set(["__proto__", "prototype", "constructor"]);
  const own = (value, key) => Object.hasOwn(value || {}, key);
  const object = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const text = (value) => String(value ?? "").trim();
  const normalizeLabel = (value) => text(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
  const normalizeSku = (value) => text(value).normalize("NFKC").replace(/\s+/g, " ").toUpperCase();
  const blank = (value) => value === null || value === undefined || (typeof value === "string" && (!value.trim() || /^(TBD|TBC|N\/A|UNKNOWN)$/i.test(value.trim())));
  const encode = (value) => encodeURIComponent(String(value));
  const labels = {
    name: "Product name", codename: "Codename", price: "MSRP", priceLabel: "Price label", tier: "Tier", statusType: "Product status", statusLabel: "Status label", variantLabel: "Platform / variant label",
    imageAssetId: "Product image", imageUrl: "Product image URL", featuredVariantId: "Featured colorway", ffsDate: "FFS", globalAnnouncementDate: "Global announcement", webReadinessDate: "Web readiness", finalAssetsDate: "Final assets",
    family: "Product family", status: "Lifecycle status", confidence: "Confidence", predecessorId: "Predecessor", successorId: "Successor", notes: "Roadmap notes", value: "Value", variantId: "Assigned colorway", colorCode: "ASCM color code", label: "Label",
    colorKey: "Primary color", colorName: "Primary color name", colorHex: "Primary color", colorKey2: "Secondary color", colorName2: "Secondary color name", colorHex2: "Secondary color", sourceFile: "Source file", sourceCategory: "Source category", exportedAt: "Source export date", importedAt: "Import date",
  };

  function safeClone(value) {
    let nodes = 0;
    function visit(entry, depth) {
      if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new RangeError("This product contains too much nested information to merge safely.");
      if (entry === undefined) return undefined;
      if (entry === null || typeof entry === "boolean") return entry;
      if (typeof entry === "number") { if (!Number.isFinite(entry)) throw new TypeError("Product numbers must be finite."); return entry; }
      if (typeof entry === "string") { if (entry.length > 262144) throw new RangeError("A product field is too long to merge safely."); return entry; }
      if (Array.isArray(entry)) {
        if (entry.length > MAX_ROWS) throw new RangeError(`Product lists may contain at most ${MAX_ROWS} rows.`);
        return entry.map((item) => { if (item === undefined) throw new TypeError("Product lists must contain JSON values."); return visit(item, depth + 1); });
      }
      if (!object(entry) || ![Object.prototype, null].includes(Object.getPrototypeOf(entry))) throw new TypeError("Products must contain plain JSON information.");
      const result = {};
      for (const key of Object.keys(entry)) {
        if (forbidden.has(key)) throw new TypeError("Product information contains an unsupported property name.");
        if (key.length > 512) throw new RangeError("A product property name is too long.");
        const descriptor = Object.getOwnPropertyDescriptor(entry, key);
        if (!descriptor || !own(descriptor, "value")) throw new TypeError("Product information must not contain executable properties.");
        if (descriptor.value !== undefined) result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    }
    return visit(value, 0);
  }

  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }

  const equal = (a, b) => stable(a) === stable(b);
  function validId(value, label) {
    if (typeof value !== "string" || !value || value.length > 180 || forbidden.has(value)) throw new TypeError(`${label} needs a valid stable ID.`);
    return value;
  }
  function hash(value) {
    let a = 2166136261, b = 2246822519;
    for (const character of String(value)) { const code = character.codePointAt(0); a = Math.imul(a ^ code, 16777619); b = Math.imul(b ^ code, 3266489917); }
    return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
  }
  function rowId(row, kind, semantic, used, productId) {
    let candidate = text(row?.id);
    if (candidate) validId(candidate, kind);
    if (!candidate || used.has(candidate)) candidate = `merge-${kind}-${hash(`${productId}\0${semantic}\0${candidate}`)}`;
    const stem = candidate;
    let suffix = 1;
    while (used.has(candidate)) candidate = `${stem}-${suffix++}`;
    used.add(candidate);
    return candidate;
  }
  function display(value) {
    if (blank(value)) return "Not provided";
    if (object(value) || Array.isArray(value)) return JSON.stringify(value);
    return String(value);
  }
  function variantIdentity(row, type) {
    if (root.PortfolioMasterModel?.variantSkuIdentity) return root.PortfolioMasterModel.variantSkuIdentity(row, type);
    const code = normalizeSku(row?.code);
    if (!code || type !== "color") return code;
    const tone = (suffix) => {
      let hex = normalizeSku(row?.[`colorHex${suffix}`]);
      if (/^#[0-9A-F]{3}$/.test(hex)) hex = `#${[...hex.slice(1)].map((digit) => digit.repeat(2)).join("")}`;
      if (hex) return `hex:${hex}`;
      const key = normalizeSku(row?.[`colorKey${suffix}`]);
      if (key && key !== "CUSTOM") return `key:${key}`;
      const name = normalizeSku(row?.[`colorName${suffix}`]);
      return name ? `name:${name}` : "";
    };
    return JSON.stringify([code, tone(""), tone("2")]);
  }

  function plan(keeperInput, sourceInput) {
    const keeper = safeClone(keeperInput), source = safeClone(sourceInput);
    if (!object(keeper) || !object(source)) throw new TypeError("Choose two product records to merge.");
    validId(keeper.id, "The product to keep"); validId(source.id, "The other product");
    if (keeper.id === source.id) throw new TypeError("Choose two different products to merge.");
    const conflicts = [], additions = [];
    const maps = { variants: {}, groups: {}, specs: {}, partSkus: {} };
    const used = { variants: new Set(), groups: new Set(), specs: new Set(), partSkus: new Set() };
    const sourceVariantIds = new Set(), keeperVariantIds = new Set();
    const product = safeClone(keeper);
    const conflictKeys = new Set();

    function conflict(path, label, left, right, target, extra = {}) {
      let key = path;
      if (conflictKeys.has(key)) throw new TypeError("Product rows contain an ambiguous repeated merge path.");
      conflictKeys.add(key);
      conflicts.push({ key, path, label, keeper: safeClone(left), source: safeClone(right), keeperText: display(left), sourceText: display(right), target: safeClone(target), ...extra });
      return safeClone(left);
    }
    function add(path, label) { additions.push({ path, label }); }
    function merge(left, right, semanticPath, target, label = "") {
      if (blank(right)) return safeClone(left);
      if (blank(left)) { add(semanticPath, label || labels[semanticPath.split("/").at(-1)] || semanticPath); return safeClone(right); }
      if (equal(left, right)) return safeClone(left);
      if (object(left) && object(right)) {
        const output = safeClone(left);
        for (const key of Object.keys(right).sort()) output[key] = merge(left[key], right[key], `${semanticPath}/${encode(key)}`, [...target, key], labels[key] || (label ? `${label} · ${key}` : key));
        return output;
      }
      if (Array.isArray(left) && Array.isArray(right)) {
        const output = safeClone(left);
        const ids = new Map();
        output.forEach((row, index) => { if (object(row) && !blank(row.id)) ids.set(text(row.id), index); });
        for (const row of right) {
          const id = object(row) ? text(row.id) : "";
          const index = id ? ids.get(id) : undefined;
          if (index !== undefined) output[index] = merge(output[index], row, `${semanticPath}/${encode(id)}`, [...target, index], label);
          else if (!output.some((previous) => equal(previous, row))) {
            if (output.length >= MAX_ROWS) throw new RangeError(`The merged list would contain more than ${MAX_ROWS} rows.`);
            output.push(safeClone(row)); if (id) ids.set(id, output.length - 1); add(`${semanticPath}/${encode(id || hash(stable(row)))}`, label || semanticPath);
          }
        }
        return output;
      }
      return conflict(semanticPath, label || labels[semanticPath.split("/").at(-1)] || semanticPath, left, right, target);
    }

    // Dates and their planning months form one decision; they never silently
    // move a known launch or manufacturing day to a different chosen month.
    function datePair(field, monthField, path, label) {
      function pair(record) {
        const day = blank(record[field]) ? "" : text(record[field]);
        const savedMonth = text(record.roadmap?.[monthField] || (monthField === "startMonth" ? record.roadmap?.launchMonth : ""));
        const month = blank(savedMonth) ? "" : savedMonth;
        if (day && month && day.slice(0, 7) !== month) throw new RangeError(`${record.name || "A product"} has a ${label.toLowerCase()} date and planned month that disagree. Correct them before merging.`);
        return { date: day, month: month || (day ? day.slice(0, 7) : "") };
      }
      const left = pair(keeper), right = pair(source);
      const disagree = Boolean((left.date && right.date && left.date !== right.date) || (left.month && right.month && left.month !== right.month));
      const fill = (preferred, other) => {
        const sameMonth = !preferred.month || !other.month || preferred.month === other.month;
        return { date: preferred.date || (sameMonth ? other.date : ""), month: preferred.month || other.month };
      };
      const first = fill(left, right), second = fill(right, left);
      product.roadmap = object(product.roadmap) ? product.roadmap : {};
      product[field] = first.date;
      product.roadmap[monthField] = first.month;
      if (monthField === "startMonth") product.roadmap.launchMonth = first.month;
      if (disagree) conflict(path, `${label} and planned month`, first, second, [field], { datePair: { dateField: field, monthField }, keeperText: `${first.date || "Day not provided"} · ${first.month || "Month not provided"}`, sourceText: `${second.date || "Day not provided"} · ${second.month || "Month not provided"}` });
      else if ((!left.date && first.date) || (!left.month && first.month)) add(path, label);
    }
    datePair("generalAvailabilityDate", "startMonth", "@launch", "Launch / general availability");
    datePair("endManufacturingDate", "endMonth", "@end", "End of manufacturing");

    function checkRows(rows, kind, { globalIds = false } = {}) {
      if (rows === undefined || rows === null) return [];
      if (!Array.isArray(rows)) throw new TypeError(`${kind} must be a list of rows.`);
      const ids = new Set();
      for (const row of rows) {
        if (!object(row)) throw new TypeError(`${kind} contains an invalid row.`);
        if (row.id) { validId(row.id, kind); if (ids.has(row.id)) throw new TypeError(`${kind} contains repeated row IDs. Correct them before merging.`); ids.add(row.id); }
      }
      return rows;
    }
    function simpleRows(kind, leftRows, rightRows, semantic, title) {
      const output = [], matches = new Map();
      const process = (row, donor, position) => {
        const identity = semantic(row) || `unlabelled:${donor ? "source" : "keeper"}:${row.id || position}`;
        const existing = matches.get(identity);
        if (existing !== undefined) {
          const original = output[existing];
          const supplied = { ...row, id: original.id };
          output[existing] = merge(original, supplied, `${kind}/${encode(original.id)}`, [kind, existing], `${title} · ${row.label || row.code || identity}`);
          if (donor && row.id) maps[kind][row.id] = original.id;
        } else {
          const next = safeClone(row);
          next.id = rowId(row, kind, identity, used[kind], keeper.id);
          matches.set(identity, output.length); output.push(next);
          if (donor) { if (row.id) maps[kind][row.id] = next.id; add(`${kind}/${encode(next.id)}`, `${title} · ${row.label || row.code || identity}`); }
        }
        if (output.length > MAX_ROWS) throw new RangeError(`The merged ${title.toLowerCase()} list is too large.`);
      };
      checkRows(leftRows, title).forEach((row, index) => process(row, false, index));
      checkRows(rightRows, title).forEach((row, index) => process(row, true, index));
      return output;
    }
    product.specs = simpleRows("specs", keeper.specs, source.specs, (row) => normalizeLabel(row.label), "Specification");

    const groups = [], groupMatches = new Map(), variantMatches = new Map(), keeperVariantMap = {};
    function variants(record, donor) {
      checkRows(record.variantGroups, "Variant groups").forEach((group, groupPosition) => {
        const type = text(group.type);
        if (!["color", "layout"].includes(type)) throw new TypeError("Variant groups must have color or layout type.");
        const groupKey = `${type}\0${normalizeLabel(group.label)}`;
        let groupIndex = donor ? groupMatches.get(groupKey) : undefined;
        if (groupIndex === undefined && donor) groupIndex = groups.findIndex((item) => item.type === type);
        if (groupIndex === -1) groupIndex = undefined;
        if (groupIndex === undefined) {
          const next = { ...safeClone(group), items: [] };
          next.id = rowId(group, "groups", groupKey || String(groupPosition), used.groups, keeper.id);
          groupIndex = groups.length; groups.push(next); groupMatches.set(groupKey, groupIndex);
          if (donor) add(`variantGroups/${encode(next.id)}`, `${type === "color" ? "Colorways" : "Layouts"} group`);
        } else {
          const previous = groups[groupIndex], incoming = { ...safeClone(group), id: previous.id, items: previous.items };
          groups[groupIndex] = merge(previous, incoming, `variantGroups/${encode(previous.id)}`, ["variantGroups", groupIndex], `${type === "color" ? "Colorway" : "Layout"} group`);
        }
        if (donor && group.id) maps.groups[group.id] = groups[groupIndex].id;
        checkRows(group.items, "Variants").forEach((row, rowPosition) => {
          const seenIds = donor ? sourceVariantIds : keeperVariantIds;
          if (row.id) { if (seenIds.has(row.id)) throw new TypeError("Variants repeat an ID across groups. Correct the row IDs before merging."); seenIds.add(row.id); }
          const identity = `${type}\0${variantIdentity(row, type) || `unlabelled:${donor ? "source" : "keeper"}:${row.id || rowPosition}`}`;
          const existing = variantMatches.get(identity);
          if (existing) {
            const original = groups[existing.group].items[existing.row];
            const supplied = { ...row, id: original.id };
            groups[existing.group].items[existing.row] = merge(original, supplied, `variantGroups/${encode(groups[existing.group].id)}/items/${encode(original.id)}`, ["variantGroups", existing.group, "items", existing.row], `${type === "color" ? "Colorway" : "Layout"} · ${row.code || row.label || original.id}`);
            if (row.id) (donor ? maps.variants : keeperVariantMap)[row.id] = original.id;
          } else {
            const next = safeClone(row); next.id = rowId(row, "variants", identity, used.variants, keeper.id);
            const position = groups[groupIndex].items.length; groups[groupIndex].items.push(next);
            variantMatches.set(identity, { group: groupIndex, row: position });
            if (row.id) (donor ? maps.variants : keeperVariantMap)[row.id] = next.id;
            if (donor) add(`variantGroups/${encode(groups[groupIndex].id)}/items/${encode(next.id)}`, `${type === "color" ? "Colorway" : "Layout"} · ${row.code || row.label || next.id}`);
          }
          if (groups[groupIndex].items.length > MAX_ROWS) throw new RangeError("The merged variant group is too large.");
        });
      });
    }
    variants(keeper, false); variants(source, true);
    product.variantGroups = groups;
    const mappedSource = safeClone(source);
    const mapVariant = (value) => blank(value) ? value : maps.variants[value] || value;
    mappedSource.partSkus = checkRows(source.partSkus, "HP SKUs").map((row) => ({ ...row, ...(own(row, "variantId") ? { variantId: mapVariant(row.variantId) } : {}) }));
    if (own(mappedSource, "featuredVariantId")) mappedSource.featuredVariantId = mapVariant(mappedSource.featuredVariantId);
    const keeperParts = checkRows(keeper.partSkus, "HP SKUs").map((row) => ({ ...row, ...(own(row, "variantId") ? { variantId: keeperVariantMap[row.variantId] || row.variantId } : {}) }));
    if (own(product, "featuredVariantId")) product.featuredVariantId = keeperVariantMap[product.featuredVariantId] || product.featuredVariantId;
    product.partSkus = simpleRows("partSkus", keeperParts, mappedSource.partSkus, (row) => normalizeSku(row.code), "HP SKU");

    function sourceRecords(left, right, target) {
      const output = safeClone(left || []), indexes = new Map();
      if (!Array.isArray(output) || !Array.isArray(right)) throw new TypeError("ASCM source records must be a list.");
      const recordKey = (row) => object(row) ? normalizeSku(row.basePartNumber || row.basePn || row.basePN || row.code) : "";
      output.forEach((row, index) => { const key = recordKey(row); if (key && !indexes.has(key)) indexes.set(key, index); });
      for (const row of right) {
        const key = recordKey(row), position = key ? indexes.get(key) : undefined;
        if (position !== undefined) output[position] = merge(output[position], row, `ascm/records/${encode(key)}`, [...target, position], `ASCM · ${key}`);
        else if (!output.some((previous) => equal(previous, row))) { if (output.length >= MAX_ROWS) throw new RangeError("The merged ASCM source record list is too large."); output.push(safeClone(row)); if (key) indexes.set(key, output.length - 1); add(`ascm/records/${encode(key || hash(stable(row)))}`, `ASCM record · ${key || "source information"}`); }
      }
      return output;
    }
    const skip = new Set(["id", "laneId", "order", "categoryId", "specs", "partSkus", "variantGroups", "generalAvailabilityDate", "endManufacturingDate"]);
    for (const key of Object.keys(mappedSource).sort()) {
      if (skip.has(key)) continue;
      if (key === "roadmap") {
        const left = object(product.roadmap) ? safeClone(product.roadmap) : {}, right = object(mappedSource.roadmap) ? safeClone(mappedSource.roadmap) : {};
        for (const field of ["startMonth", "launchMonth", "endMonth"]) { delete left[field]; delete right[field]; }
        for (const field of ["predecessorId", "successorId"]) {
          if ([keeper.id, source.id].includes(left[field])) left[field] = "";
          if ([keeper.id, source.id].includes(right[field])) right[field] = "";
        }
        product.roadmap = { ...product.roadmap, ...merge(left, right, "roadmap", ["roadmap"], "Roadmap") };
      } else if (key === "ascm" && object(mappedSource.ascm)) {
        const left = object(product.ascm) ? safeClone(product.ascm) : {}, right = safeClone(mappedSource.ascm);
        const records = sourceRecords(left.records || [], right.records || [], ["ascm", "records"]);
        delete left.records; delete right.records;
        product.ascm = { ...merge(left, right, "ascm", ["ascm"], "ASCM source"), records };
      } else product[key] = merge(product[key], mappedSource[key], encode(key), [key], labels[key] || key);
    }
    // Remove a retained self-reference even when the donor had no roadmap.
    for (const field of ["predecessorId", "successorId"]) if ([keeper.id, source.id].includes(product.roadmap?.[field])) product.roadmap[field] = "";
    product.id = keeper.id;
    for (const key of ["laneId", "order", "categoryId"]) { if (own(keeper, key)) product[key] = safeClone(keeper[key]); else delete product[key]; }
    const metadata = (record) => Object.fromEntries(["ascm", "ascmKey", "sourceRefs", "source", "importedAt"].filter((key) => own(record, key)).map((key) => [key, safeClone(record[key])]));
    const rowsAdded = (kind) => additions.filter((entry) => entry.path.startsWith(`${kind}/`) && entry.path.split("/").length === 2).length;
    const variantsAdded = additions.filter((entry) => /^variantGroups\/[^/]+\/items\/[^/]+$/.test(entry.path)).length;
    return { version: 1, keeperId: keeper.id, sourceId: source.id, product, conflicts, additions, maps, sourceMetadata: { keeper: metadata(keeper), source: metadata(source) }, summary: { filledFields: additions.length, fieldsFilled: additions.length, conflicts: conflicts.length, specsAdded: rowsAdded("specs"), skusAdded: rowsAdded("partSkus"), variantsAdded, specifications: product.specs.length, hpSkus: product.partSkus.length, variants: product.variantGroups.reduce((count, group) => count + group.items.length, 0) } };
  }

  function validateFallback(product) {
    const dates = ["generalAvailabilityDate", "ffsDate", "endManufacturingDate", "globalAnnouncementDate", "webReadinessDate", "finalAssetsDate"];
    for (const field of dates) {
      if (blank(product[field])) continue;
      const value = text(product[field]);
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new RangeError("Choose valid calendar dates before merging.");
    }
    for (const field of ["startMonth", "endMonth"]) if (!blank(product.roadmap?.[field]) && !/^\d{4}-(0[1-9]|1[0-2])$/.test(product.roadmap[field])) throw new RangeError("Planned dates must use YYYY-MM.");
    if (product.generalAvailabilityDate && product.endManufacturingDate && product.endManufacturingDate < product.generalAvailabilityDate || product.roadmap?.startMonth && product.roadmap?.endMonth && product.roadmap.endMonth < product.roadmap.startMonth) throw new RangeError("End of manufacturing and the planned end month must be on or after launch.");
    const skus = new Set(), variants = new Set();
    for (const row of product.partSkus || []) { const key = normalizeSku(row.code); if (key && skus.has(key)) throw new RangeError("The merged product contains a repeated HP SKU."); if (key) skus.add(key); }
    for (const group of product.variantGroups || []) for (const row of group.items || []) { const code = normalizeSku(row.code); if (!code) continue; const key = `${group.type}\0${variantIdentity(row, group.type)}`; if (variants.has(key)) throw new RangeError("The merged product contains a repeated variant SKU."); variants.add(key); }
  }

  function resolve(suppliedPlan, suppliedChoices = {}) {
    const planned = safeClone(suppliedPlan), choices = safeClone(suppliedChoices);
    if (!object(planned) || planned.version !== 1 || !object(planned.product) || !Array.isArray(planned.conflicts) || !object(choices)) throw new TypeError("The merge review is invalid. Open it again.");
    const output = safeClone(planned.product);
    for (const item of planned.conflicts) {
      if (!own(choices, item.key) || !["keeper", "source"].includes(choices[item.key])) throw new RangeError(`Choose which value to keep for ${item.label}.`);
      const value = safeClone(item[choices[item.key]]);
      if (item.datePair) {
        const { dateField, monthField } = item.datePair;
        if (!["generalAvailabilityDate", "endManufacturingDate"].includes(dateField) || !["startMonth", "endMonth"].includes(monthField)) throw new TypeError("The date decision is invalid.");
        output[dateField] = value.date; output.roadmap ||= {}; output.roadmap[monthField] = value.month;
        if (monthField === "startMonth") output.roadmap.launchMonth = value.month;
      } else {
        if (!Array.isArray(item.target) || !item.target.length || item.target.some((segment) => typeof segment !== "string" && (!Number.isSafeInteger(segment) || segment < 0 || segment >= MAX_ROWS) || forbidden.has(segment))) throw new TypeError("The merge field is invalid.");
        let parent = output;
        for (const segment of item.target.slice(0, -1)) { if (!own(parent, segment) || !object(parent[segment]) && !Array.isArray(parent[segment])) throw new TypeError("A reviewed merge row is no longer available."); parent = parent[segment]; }
        parent[item.target.at(-1)] = value;
      }
    }
    validId(output.id, "The merged product");
    if (output.id !== planned.keeperId) throw new TypeError("A merge cannot replace the kept product identity.");
    validateFallback(output);
    if (root.PortfolioMasterModel) root.PortfolioMasterModel.validateValues(root.PortfolioMasterModel.values(output));
    const ids = new Set((output.variantGroups || []).flatMap((group) => (group.items || []).map((row) => row.id)));
    for (const row of output.partSkus || []) if (!blank(row.variantId) && !ids.has(row.variantId)) throw new RangeError(`HP SKU ${row.code || "assignment"} points to a colorway that is not on the merged product.`);
    if (!blank(output.featuredVariantId) && !ids.has(output.featuredVariantId)) throw new RangeError("The featured colorway is not on the merged product.");
    for (const field of ["predecessorId", "successorId"]) if ([planned.keeperId, planned.sourceId].includes(output.roadmap?.[field])) output.roadmap[field] = "";
    return output;
  }

  root.PortfolioProductMerge = Object.freeze({ plan, resolve, normalizeLabel, normalizeSku, variantIdentity, isBlank: blank, cloneProduct: safeClone });
})(globalThis);
