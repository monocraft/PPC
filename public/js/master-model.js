/* Pure, shared master rules. Stable IDs identify products and collection rows. */
(function (root) {
  "use strict";

  const DATE_FIELDS = Object.freeze(["generalAvailabilityDate", "ffsDate", "endManufacturingDate", "globalAnnouncementDate", "webReadinessDate", "finalAssetsDate"]);
  const PRODUCT_FIELDS = Object.freeze(["name", "codename", "price", "priceLabel", "tier", "statusType", "statusLabel", "variantLabel"]);
  const ROADMAP_FIELDS = Object.freeze({ startMonth: "startMonth", endMonth: "endMonth", roadmapFamily: "family", roadmapStatus: "status", roadmapConfidence: "confidence", roadmapPredecessorId: "predecessorId", roadmapSuccessorId: "successorId" });
  const COLLECTIONS = Object.freeze(["specs", "partSkus", "variantGroups"]);
  const SHARED_FIELDS = Object.freeze([...DATE_FIELDS, ...PRODUCT_FIELDS, ...Object.keys(ROADMAP_FIELDS), ...COLLECTIONS]);
  const SPEC_FIELDS = Object.freeze(["label", "value"]);
  const PART_FIELDS = Object.freeze(["code", "variantId", "colorCode"]);
  const VARIANT_FIELDS = Object.freeze(["code", "label", "colorKey", "colorName", "colorHex", "colorKey2", "colorName2", "colorHex2"]);
  const LABELS = Object.freeze({
    "@launch": "Launch / general availability and planned launch month", "@end": "End of manufacturing and planned end month", "@lifecycle": "Launch and end dates (date order)",
    generalAvailabilityDate: "Launch / general availability", ffsDate: "FFS", endManufacturingDate: "End of manufacturing", globalAnnouncementDate: "Global announcement", webReadinessDate: "Web readiness", finalAssetsDate: "Final assets",
    startMonth: "Planned launch month", endMonth: "Planned end month", name: "Product name", codename: "Codename", price: "MSRP", priceLabel: "Price label", tier: "Tier", statusType: "Product status", statusLabel: "Status label", variantLabel: "Platform / variant label",
    roadmapFamily: "Product family", roadmapStatus: "Lifecycle status", roadmapConfidence: "Confidence", roadmapPredecessorId: "Predecessor", roadmapSuccessorId: "Successor", specs: "Specifications", partSkus: "HP SKUs", variantGroups: "Variant groups",
    label: "Label", value: "Value", code: "SKU code", variantId: "Assigned color", colorCode: "ASCM color", type: "Variant type", colorKey: "Primary color", colorName: "Primary color name", colorHex: "Primary color", colorKey2: "Secondary color", colorName2: "Secondary color name", colorHex2: "Secondary color",
  });
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const object = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const own = (value, key) => Object.hasOwn(value || {}, key);
  const dictionary = () => Object.create(null);
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const segment = (value) => ["@launch", "@end", "@lifecycle", "@product"].includes(value) ? value : encodeURIComponent(value);
  const parts = (path) => path ? path.split("/").map(decodeURIComponent) : [];

  function identity(value, label = "Record") {
    if (typeof value !== "string" || !value || value.length > 180 || ["__proto__", "prototype", "constructor"].includes(value)) throw new TypeError(`${label} needs a valid stable ID.`);
    return value;
  }

  function string(value, label, limit = 16384) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string" || value.length > limit) throw new TypeError(`${label} must be text of at most ${limit} characters.`);
    return value;
  }

  function exactDate(value, field) {
    const text = string(value, LABELS[field] || field, 32).trim();
    if (!text || text.toUpperCase() === "TBD") return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new RangeError(`${LABELS[field] || field} must be a valid date in YYYY-MM-DD format or TBD.`);
    const date = new Date(`${text}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new RangeError(`${LABELS[field] || field} must be a real calendar date.`);
    return text;
  }

  function month(value, field) {
    const text = string(value, LABELS[field] || field, 7).trim();
    if (text && !/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) throw new RangeError(`${LABELS[field] || field} must use YYYY-MM format.`);
    return text;
  }

  function records(value, label, fields, nested = false) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 2000) throw new TypeError(`${label} must be a list of at most 2000 rows.`);
    const ids = new Set();
    return value.map((entry) => {
      if (!object(entry)) throw new TypeError(`${label} contains an invalid row.`);
      const id = identity(entry.id, label);
      if (ids.has(id)) throw new TypeError(`${label} contains duplicate IDs.`);
      ids.add(id);
      const result = { id };
      for (const field of fields) result[field] = string(entry[field], `${label} ${field}`);
      if (nested) {
        if (!["color", "layout"].includes(result.type)) throw new TypeError("Variant type must be color or layout.");
        result.items = records(entry.items, "Variant SKUs", VARIANT_FIELDS);
      }
      return result;
    });
  }

  function canonicalValues(source = {}) {
    if (!object(source)) throw new TypeError("Shared product values must be an object.");
    const result = {};
    for (const field of DATE_FIELDS) result[field] = exactDate(source[field], field);
    for (const field of PRODUCT_FIELDS) {
      if (field === "price") {
        const raw = source.price;
        if (raw === null || raw === undefined || raw === "") result.price = null;
        else {
          if (!["number", "string"].includes(typeof raw) || (typeof raw === "string" && !raw.trim()) || !Number.isFinite(Number(raw)) || Number(raw) < 0) throw new RangeError("MSRP must be a non-negative number or left blank.");
          result.price = Number(raw);
        }
      } else result[field] = string(source[field], LABELS[field], 2048);
    }
    for (const field of Object.keys(ROADMAP_FIELDS)) result[field] = ["startMonth", "endMonth"].includes(field) ? month(source[field], field) : string(source[field], LABELS[field], 2048);
    result.specs = records(source.specs, "Specifications", SPEC_FIELDS);
    result.partSkus = records(source.partSkus, "HP SKUs", PART_FIELDS);
    result.variantGroups = records(source.variantGroups, "Variant groups", ["type", "label"], true);
    return result;
  }

  function validDateOrder(values) {
    return !(values.generalAvailabilityDate && values.endManufacturingDate && values.endManufacturingDate < values.generalAvailabilityDate)
      && !(values.startMonth && values.endMonth && values.endMonth < values.startMonth);
  }

  function validateValues(values, { checkDuplicates = true, checkDateOrder = true } = {}) {
    const result = canonicalValues(values);
    if (checkDateOrder && !validDateOrder(result)) throw new RangeError("End of manufacturing and the planned end month must be on or after launch.");
    const duplicate = checkDuplicates && duplicateSkus(toTree(result))[0];
    if (duplicate) throw new RangeError(duplicate.type === "color" ? "The same colorway code and primary/secondary color combination cannot be assigned to different rows. Remove the repeated colorway row." : "The same SKU code cannot be assigned to different rows. Remove the duplicate or use a different code.");
    return result;
  }

  function productValues(product = {}) {
    const source = {};
    for (const field of [...DATE_FIELDS, ...PRODUCT_FIELDS, ...COLLECTIONS]) source[field] = product[field];
    for (const [field, property] of Object.entries(ROADMAP_FIELDS)) source[field] = product.roadmap?.[property];
    if (!source.startMonth) source.startMonth = product.roadmap?.launchMonth || "";
    return canonicalValues(source);
  }

  function preserveRecords(previous, shared, nested = false) {
    const old = new Map((Array.isArray(previous) ? previous : []).map((entry) => [entry.id, entry]));
    return shared.map((entry) => {
      const result = { ...(old.get(entry.id) || {}), ...clone(entry) };
      if (nested) result.items = preserveRecords(old.get(entry.id)?.items, entry.items);
      return result;
    });
  }

  function applyProductValues(product, supplied) {
    const values = canonicalValues({ ...productValues(product), ...supplied });
    const result = { ...product, roadmap: { ...(product.roadmap || {}) } };
    for (const field of [...DATE_FIELDS, ...PRODUCT_FIELDS]) result[field] = values[field];
    for (const [field, property] of Object.entries(ROADMAP_FIELDS)) result.roadmap[property] = values[field];
    result.roadmap.launchMonth = values.startMonth;
    result.specs = preserveRecords(product.specs, values.specs);
    result.partSkus = preserveRecords(product.partSkus, values.partSkus);
    result.variantGroups = preserveRecords(product.variantGroups, values.variantGroups, true);
    return result;
  }

  function dateInMonth(value, targetMonth) {
    if (!value || !targetMonth) return value;
    const end = new Date(`${targetMonth}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    return `${targetMonth}-${String(Math.min(Number(value.slice(8)), end.getUTCDate())).padStart(2, "0")}`;
  }

  function patchValues(base, patch) {
    if (!object(patch)) throw new TypeError("Shared changes must be an object.");
    for (const field of Object.keys(patch)) if (!SHARED_FIELDS.includes(field)) throw new TypeError(`Unsupported shared field: ${field}.`);
    const next = canonicalValues({ ...base, ...patch });
    for (const [dateField, monthField] of [["generalAvailabilityDate", "startMonth"], ["endManufacturingDate", "endMonth"]]) {
      if (own(patch, dateField) && next[dateField] !== base[dateField]) next[monthField] = next[dateField] ? next[dateField].slice(0, 7) : base[monthField];
      else if (own(patch, monthField) && next[monthField] !== base[monthField] && next[dateField]) next[dateField] = dateInMonth(next[dateField], next[monthField]);
    }
    return validateValues(next);
  }

  function mapRecords(rows, nested = false) {
    const result = dictionary();
    for (const row of rows) result[row.id] = nested ? { ...clone(row), items: mapRecords(row.items) } : clone(row);
    return result;
  }

  function toTree(values) {
    const tree = dictionary();
    for (const field of SHARED_FIELDS) if (!["generalAvailabilityDate", "startMonth", "endManufacturingDate", "endMonth", ...COLLECTIONS].includes(field)) tree[field] = clone(values[field]);
    tree["@launch"] = { generalAvailabilityDate: values.generalAvailabilityDate, startMonth: values.startMonth };
    tree["@end"] = { endManufacturingDate: values.endManufacturingDate, endMonth: values.endMonth };
    tree.specs = mapRecords(values.specs);
    tree.partSkus = mapRecords(values.partSkus);
    tree.variantGroups = mapRecords(values.variantGroups, true);
    return tree;
  }

  function fromTree(tree) {
    const result = {};
    for (const field of SHARED_FIELDS) if (!["generalAvailabilityDate", "startMonth", "endManufacturingDate", "endMonth", ...COLLECTIONS].includes(field)) result[field] = clone(tree[field]);
    Object.assign(result, tree["@launch"], tree["@end"]);
    result.specs = Object.values(tree.specs || {}).map(clone);
    result.partSkus = Object.values(tree.partSkus || {}).map(clone);
    result.variantGroups = Object.values(tree.variantGroups || {}).map((row) => ({ ...clone(row), items: Object.values(row.items || {}).map(clone) }));
    return result;
  }

  function getNode(tree, path) {
    let value = tree;
    for (const part of parts(path)) {
      if (!object(value) || !own(value, part)) return { exists: false, value: undefined };
      value = value[part];
    }
    return { exists: true, value };
  }

  function setNode(tree, path, state, template = tree) {
    const keys = parts(path);
    let node = tree;
    let templateNode = template;
    for (const key of keys.slice(0, -1)) {
      templateNode = templateNode?.[key];
      if (!object(node[key])) node[key] = object(templateNode) ? clone(templateNode) : dictionary();
      node = node[key];
    }
    if (state.exists) node[keys.at(-1)] = clone(state.value);
    else delete node[keys.at(-1)];
  }

  function describeNode(value, path = "") {
    if (value === undefined) return "Removed";
    if (value === null || value === "") return "Not set / TBD";
    if (!object(value)) return String(value);
    if (path === "@launch") return `${value.generalAvailabilityDate || "TBD"} (planned ${value.startMonth || "TBD"})`;
    if (path === "@end") return `${value.endManufacturingDate || "TBD"} (planned ${value.endMonth || "TBD"})`;
    if (path === "@lifecycle") return `${describeNode(value.launch, "@launch")} → ${describeNode(value.end, "@end")}`;
    if (own(value, "label") && own(value, "value")) return `${value.label || "Specification"}: ${value.value || "Not set"}`;
    if (own(value, "code")) return [value.code || "Blank SKU", value.label, [value.colorName, value.colorName2].filter(Boolean).join(" / "), value.variantId ? `Color ${value.variantId}` : ""].filter(Boolean).join(" · ");
    if (own(value, "type")) return `${value.label || value.type} (${Object.keys(value.items || {}).length} SKUs)`;
    return Object.values(value).map((entry) => describeNode(entry)).join("; ");
  }

  function operationLabel(path, baseTree, mineTree) {
    const keys = parts(path);
    if (keys.length === 1) return LABELS[keys[0]] || keys[0];
    const recordPath = keys[0] === "variantGroups" && keys.length >= 4 ? keys.slice(0, 4).map(segment).join("/") : keys.slice(0, 2).map(segment).join("/");
    const row = getNode(mineTree, recordPath).value || getNode(baseTree, recordPath).value;
    const name = keys[0] === "specs" ? `Specification: ${row?.label || "Untitled"}` : keys[0] === "partSkus" ? `HP SKU: ${row?.code || "New SKU"}` : keys.length >= 4 ? `Variant SKU: ${row?.code || "New SKU"}` : `Variant group: ${row?.label || row?.type || "New group"}`;
    return keys.length === 2 || (keys[0] === "variantGroups" && keys.length === 4) ? name : `${name} — ${LABELS[keys.at(-1)] || keys.at(-1)}`;
  }

  function treeDiff(baseTree, mineTree) {
    const operations = [];
    function walk(base, mine, path, baseExists = true, mineExists = true) {
      if (baseExists === mineExists && equal(base, mine)) return;
      if (!baseExists || !mineExists || !object(base) || !object(mine) || ["@launch", "@end"].includes(path)) {
        operations.push({ path, base: clone(baseExists ? base : null), value: clone(mineExists ? mine : null), baseExists, valueExists: mineExists, kind: !baseExists ? "add" : !mineExists ? "remove" : "update", label: operationLabel(path, baseTree, mineTree) });
        return;
      }
      for (const key of new Set([...Object.keys(base), ...Object.keys(mine)])) {
        if (key === "id") continue;
        walk(base[key], mine[key], path ? `${path}/${segment(key)}` : segment(key), own(base, key), own(mine, key));
      }
    }
    walk(baseTree, mineTree, "");
    return operations;
  }

  function diffOperations(base, mine) { return treeDiff(toTree(canonicalValues(base)), toTree(canonicalValues(mine))); }

  function diffValues(base, mine) {
    const left = canonicalValues(base);
    const right = canonicalValues(mine);
    const patch = {};
    for (const field of SHARED_FIELDS) if (!equal(left[field], right[field])) patch[field] = clone(right[field]);
    return patch;
  }

  function describeChanges(base, mine) {
    return diffOperations(base, mine).map((op) => {
      const baseText = op.baseExists ? describeNode(op.base, op.path) : "New";
      const mineText = op.valueExists ? describeNode(op.value, op.path) : "Removed";
      return { path: op.path, label: op.label, base: baseText, mine: mineText, baseText, mineText, kind: op.kind };
    });
  }

  function revisionKeys(path, structural, revisions) {
    const keys = new Set([path, "@product"]);
    const pathParts = path.split("/");
    for (let index = 1; index < pathParts.length; index += 1) keys.add(pathParts.slice(0, index).join("/"));
    if (structural) for (const key of Object.keys(revisions || {})) if (key.startsWith(`${path}/`)) keys.add(key);
    return keys;
  }

  function revisionsChanged(path, structural, baseRevisions, masterRevisions) {
    const keys = new Set([...revisionKeys(path, structural, baseRevisions), ...revisionKeys(path, structural, masterRevisions)]);
    return [...keys].some((key) => (baseRevisions?.[key] || 0) !== (masterRevisions?.[key] || 0));
  }

  function missingAncestor(path, baseTree, masterTree) {
    const keys = path.split("/");
    for (let index = 1; index < keys.length; index += 1) {
      const parent = keys.slice(0, index).join("/");
      if (getNode(baseTree, parent).exists && !getNode(masterTree, parent).exists) return parent;
    }
    return "";
  }

  function variantSkuIdentity(row, type) {
    const normalize = (value) => String(value ?? "").trim().normalize("NFKC").replace(/\s+/g, " ").toUpperCase();
    const code = normalize(row?.code);
    if (!code || type !== "color") return code;
    const tone = (suffix) => {
      let hex = normalize(row?.[`colorHex${suffix}`]);
      if (/^#[0-9A-F]{3}$/.test(hex)) hex = `#${[...hex.slice(1)].map((digit) => digit.repeat(2)).join("")}`;
      if (hex) return `hex:${hex}`;
      const key = normalize(row?.[`colorKey${suffix}`]);
      if (key && key !== "CUSTOM") return `key:${key}`;
      const name = normalize(row?.[`colorName${suffix}`]);
      return name ? `name:${name}` : "";
    };
    // Primary and secondary have distinct roles. Single black, black/red,
    // and red/black remain different even when their display code is BK.
    return JSON.stringify([code, tone(""), tone("2")]);
  }

  function duplicateSkus(tree) {
    const buckets = [{ prefix: "partSkus", records: Object.entries(tree.partSkus || {}).map(([id, row]) => ({ path: `partSkus/${segment(id)}`, row })) }];
    const variantBuckets = new Map();
    for (const [groupId, group] of Object.entries(tree.variantGroups || {})) {
      if (!variantBuckets.has(group.type)) variantBuckets.set(group.type, []);
      for (const [id, row] of Object.entries(group.items || {})) variantBuckets.get(group.type).push({ path: `variantGroups/${segment(groupId)}/items/${segment(id)}`, row });
    }
    for (const [type, rows] of variantBuckets) buckets.push({ prefix: `variantGroups:${type}`, type, records: rows });
    const issues = [];
    for (const bucket of buckets) {
      const codes = new Map();
      for (const item of bucket.records) {
        const code = String(item.row.code || "").trim().normalize("NFKC").toUpperCase();
        const key = bucket.type ? variantSkuIdentity(item.row, bucket.type) : code;
        if (!key) continue;
        if (codes.has(key)) issues.push({ code, a: codes.get(key), b: item, prefix: bucket.prefix, type: bucket.type });
        else codes.set(key, item);
      }
    }
    return issues;
  }

  function conflict(path, baseTree, mineTree, masterTree, extra = {}) {
    const base = getNode(baseTree, path);
    const mine = getNode(mineTree, path);
    const master = getNode(masterTree, path);
    return { path, field: path, label: operationLabel(path, baseTree, mineTree), base: clone(base.exists ? base.value : null), mine: clone(mine.exists ? mine.value : null), master: clone(master.exists ? master.value : null), baseExists: base.exists, mineExists: mine.exists, masterExists: master.exists,
      baseText: base.exists ? describeNode(base.value, path) : "New", mineText: mine.exists ? describeNode(mine.value, path) : "Removed", masterText: master.exists ? describeNode(master.value, path) : "Removed", ...extra };
  }

  function planMerge(base, mine, master, baseRevisions = {}, masterRevisions = {}) {
    const baseTree = toTree(canonicalValues(base));
    const mineTree = toTree(validateValues(mine));
    const masterTree = toTree(canonicalValues(master));
    const mergedTree = clone(masterTree);
    const operations = treeDiff(baseTree, mineTree);
    const conflicts = [];
    for (const op of operations) {
      if (conflicts.some((item) => op.path === item.path || op.path.startsWith(`${item.path}/`))) continue;
      const current = getNode(masterTree, op.path);
      if (current.exists === op.valueExists && equal(current.value, op.valueExists ? op.value : undefined)) continue;
      const ancestor = missingAncestor(op.path, baseTree, masterTree);
      if (ancestor) { conflicts.push(conflict(ancestor, baseTree, mineTree, masterTree, { reason: "removed" })); continue; }
      const currentMatchesBase = current.exists === op.baseExists && equal(current.value, op.baseExists ? op.base : undefined);
      if (!currentMatchesBase || revisionsChanged(op.path, op.kind !== "update", baseRevisions, masterRevisions)) conflicts.push(conflict(op.path, baseTree, mineTree, masterTree, { reason: "changed" }));
      else setNode(mergedTree, op.path, { exists: op.valueExists, value: op.value }, mineTree);
    }
    for (const issue of duplicateSkus(mergedTree)) {
      const changedCode = (item) => {
        const old = getNode(baseTree, item.path);
        const local = getNode(mineTree, item.path);
        return local.exists && (!old.exists || (issue.type ? variantSkuIdentity(local.value, issue.type) !== variantSkuIdentity(old.value, issue.type) : local.value.code !== old.value.code));
      };
      const mineItem = changedCode(issue.a) ? issue.a : issue.b;
      const masterItem = mineItem === issue.a ? issue.b : issue.a;
      if (conflicts.some((item) => item.path === mineItem.path)) continue;
      // A SKU collision is one decision, even when a prior operation also
      // conflicts with deletion or editing of the other record.
      for (let index = conflicts.length - 1; index >= 0; index -= 1) if (conflicts[index].path === masterItem.path || conflicts[index].path.startsWith(`${masterItem.path}/`)) conflicts.splice(index, 1);
      conflicts.push(conflict(mineItem.path, baseTree, mineTree, masterTree, { reason: "duplicate-sku", label: `Duplicate ${issue.type === "color" ? "colorway" : "SKU code"} ${issue.code} — choose the final variant`, conflictingPath: masterItem.path, master: clone(masterItem.row), masterExists: true, masterText: describeNode(masterItem.row), duplicateCode: issue.code }));
      setNode(mergedTree, mineItem.path, getNode(masterTree, mineItem.path), masterTree);
    }
    const mergedValues = fromTree(mergedTree);
    const dateConflicts = conflicts.filter((item) => ["@launch", "@end"].includes(item.path));
    let unsafeDateChoice = !validDateOrder(mergedValues);
    for (let mask = 0; mask < 2 ** dateConflicts.length && !unsafeDateChoice; mask += 1) {
      const candidate = clone(mergedTree);
      for (let index = 0; index < dateConflicts.length; index += 1) candidate[dateConflicts[index].path] = clone(dateConflicts[index][mask & (1 << index) ? "mine" : "master"]);
      unsafeDateChoice = !validDateOrder(fromTree(candidate));
    }
    if (unsafeDateChoice) {
      for (let index = conflicts.length - 1; index >= 0; index -= 1) if (["@launch", "@end"].includes(conflicts[index].path)) conflicts.splice(index, 1);
      const pair = (tree) => ({ launch: clone(tree["@launch"]), end: clone(tree["@end"]) });
      const basePair = pair(baseTree), minePair = pair(mineTree), masterPair = pair(masterTree);
      conflicts.push({ path: "@lifecycle", field: "@lifecycle", label: LABELS["@lifecycle"], reason: "date-order", base: basePair, mine: minePair, master: masterPair, baseExists: true, mineExists: true, masterExists: true, baseText: describeNode(basePair, "@lifecycle"), mineText: describeNode(minePair, "@lifecycle"), masterText: describeNode(masterPair, "@lifecycle") });
    }
    return { values: mergedValues, conflicts, operations, _tree: mergedTree, _mineTree: mineTree, _masterTree: masterTree };
  }

  function resolveConflicts(plan, choices = {}) {
    const tree = clone(plan._tree || toTree(canonicalValues(plan.values)));
    for (const item of plan.conflicts || []) {
      const choice = choices[item.path] || "mine";
      if (!["mine", "master"].includes(choice)) throw new TypeError("Choose your change or the master value for every conflict.");
      if (item.path === "@lifecycle") {
        tree["@launch"] = clone(item[choice].launch);
        tree["@end"] = clone(item[choice].end);
      } else if (item.reason === "duplicate-sku") {
        if (choice === "mine") {
          setNode(tree, item.conflictingPath, { exists: false });
          setNode(tree, item.path, { exists: item.mineExists, value: item.mine }, plan._mineTree || tree);
        } else {
          setNode(tree, item.path, getNode(plan._masterTree || tree, item.path));
          setNode(tree, item.conflictingPath, { exists: true, value: item.master }, plan._masterTree || tree);
        }
      } else setNode(tree, item.path, { exists: item[`${choice}Exists`], value: item[choice] }, choice === "mine" ? plan._mineTree || tree : plan._masterTree || tree);
    }
    return validateValues(fromTree(tree));
  }

  function draftBaseline(base, mine, remote) {
    const baseTree = toTree(canonicalValues(base));
    const tree = toTree(canonicalValues(remote));
    for (const op of diffOperations(base, mine)) {
      const current = getNode(tree, op.path);
      if (current.exists === op.valueExists && equal(current.value, op.valueExists ? op.value : undefined)) continue;
      setNode(tree, op.path, { exists: op.baseExists, value: op.base }, baseTree);
    }
    // A local preview of a colliding SKU must not turn its automatic removal
    // of the remote SKU into a new, implicitly approved deletion on save.
    const plan = planMerge(base, mine, remote);
    for (const item of plan.conflicts) {
      if (item.reason === "duplicate-sku") setNode(tree, item.conflictingPath, getNode(baseTree, item.conflictingPath), baseTree);
      if (item.path === "@lifecycle") {
        tree["@launch"] = clone(baseTree["@launch"]);
        tree["@end"] = clone(baseTree["@end"]);
      }
    }
    return fromTree(tree);
  }

  function draftRevisions(base, mine, baseRevisions = {}, remoteRevisions = {}) {
    const result = { ...remoteRevisions };
    for (const op of diffOperations(base, mine)) {
      const keys = new Set([...revisionKeys(op.path, op.kind !== "update", baseRevisions), ...revisionKeys(op.path, op.kind !== "update", remoteRevisions)]);
      for (const key of keys) result[key] = baseRevisions[key] || 0;
    }
    return result;
  }

  function entriesFromManifest(manifest) {
    if (!object(manifest)) throw new TypeError("The master portfolio is invalid.");
    const entries = [];
    const ids = new Set();
    const categories = Array.isArray(manifest.categories) ? manifest.categories : [{ id: "", board: manifest.board || manifest }];
    for (const category of categories) for (const product of category.board?.products || []) {
      const productId = identity(product.id, "Product");
      if (ids.has(productId)) throw new TypeError("The master contains duplicate product IDs. Product identities must be unique.");
      ids.add(productId);
      entries.push({ product, productId, productName: String(product.name || "Untitled product"), categoryId: String(category.id || ""), laneId: String(product.laneId || "") });
    }
    return entries;
  }

  function safeRevisions(value) {
    const result = dictionary();
    if (object(value)) for (const [key, revision] of Object.entries(value)) {
      if (typeof key === "string" && key.length <= 1200 && Number.isSafeInteger(revision) && revision >= 0) result[key] = revision;
    }
    return result;
  }

  // This fingerprint covers every stored product property, including references
  // and notes outside the shared field set. It lets a deletion notice those
  // changes without copying the full record into a browser's save request.
  function productVersion(product) {
    const stable = (value) => Array.isArray(value) ? value.map(stable) : object(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
    const bytes = new TextEncoder().encode(JSON.stringify(stable(product)));
    const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    padded.set(bytes);
    padded[bytes.length] = 128;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(padded.length - 4, bytes.length * 8);
    const constants = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const words = new Uint32Array(64);
    const rotate = (value, count) => (value >>> count) | (value << (32 - count));
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
      for (let index = 16; index < 64; index += 1) {
        const left = words[index - 15], right = words[index - 2];
        words[index] = words[index - 16] + (rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3)) + words[index - 7] + (rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10));
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[index] + words[index]) | 0;
        const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        [h, g, f, e, d, c, b, a] = [g, f, e, (d + first) | 0, c, b, a, (first + second) | 0];
      }
      for (const [index, value] of [a, b, c, d, e, f, g, h].entries()) hash[index] = (hash[index] + value) >>> 0;
    }
    return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
  }

  function snapshot(manifest) {
    const products = entriesFromManifest(manifest).map((entry) => ({ productId: entry.productId, productName: entry.productName, categoryId: entry.categoryId, laneId: entry.laneId, productVersion: productVersion(entry.product), values: productValues(entry.product), revisions: safeRevisions(manifest.masterSync?.products?.[entry.productId]?.revisions) }));
    const known = new Set(products.map((entry) => entry.productId));
    const tombstones = [];
    for (const [productId, metadata] of Object.entries(manifest.masterSync?.products || {})) {
      if (!object(metadata) || !metadata.deleted || known.has(productId)) continue;
      identity(productId, "Product");
      tombstones.push({ productId, categoryId: String(metadata.categoryId || ""), laneId: String(metadata.laneId || ""), productName: String(metadata.productName || "Removed product"), revisions: safeRevisions(metadata.revisions), ...(metadata.mergedIntoProductId ? { mergedIntoProductId: identity(metadata.mergedIntoProductId, "Kept product"), mergeChoices: clone(metadata.mergeChoices || {}) } : {}) });
    }
    return { version: 1, products, tombstones };
  }

  function publicMetadata(manifest) {
    const metadata = object(manifest?.masterSync) ? clone(manifest.masterSync) : null;
    if (object(metadata?.products)) for (const record of Object.values(metadata.products)) if (object(record)) {
      delete record.archivedProduct;
      delete record.archivedKeeperProduct;
    }
    return metadata;
  }

  function boundedHistory(entries) {
    const maximumBytes = 512 * 1024;
    const kept = [];
    let bytes = 0;
    for (let index = entries.length - 1; index >= 0 && kept.length < 1000; index -= 1) {
      let record = entries[index];
      let size = JSON.stringify(record).length * 2;
      if (size > maximumBytes) {
        record = { ...record, before: describeNode(record.before, record.path).slice(0, 8192), after: describeNode(record.after, record.path).slice(0, 8192), valueTruncated: true };
        size = JSON.stringify(record).length * 2;
      }
      if (bytes + size > maximumBytes) break;
      kept.unshift(record);
      bytes += size;
    }
    return kept;
  }

  function boardForPlacement(manifest, categoryId, laneId) {
    if (typeof categoryId !== "string" || typeof laneId !== "string") throw new TypeError("A new product needs its portfolio and product lane.");
    const categories = Array.isArray(manifest.categories) ? manifest.categories : [{ id: "", board: manifest.board || manifest }];
    const matches = categories.filter((category) => String(category.id || "") === categoryId);
    if (matches.length !== 1 || !object(matches[0].board)) throw new RangeError("The product portfolio is no longer available. Pull the latest master and choose an existing portfolio.");
    const board = matches[0].board;
    if (!Array.isArray(board.lanes) || board.lanes.filter((lane) => lane.id === laneId).length !== 1) throw new RangeError("The product lane is no longer available. Pull the latest master and choose an existing lane.");
    if (!Array.isArray(board.products)) throw new TypeError("The product portfolio has an invalid product list.");
    return board;
  }

  function lifecycleConflict(change, remote, base, mine, reason, tombstone) {
    const name = remote?.productName || mine?.name || base?.name || tombstone?.productName || "Untitled product";
    const describe = (values, categoryId, laneId) => values ? `${values.name || "Untitled product"} (${categoryId || "portfolio"} / ${laneId || "lane"})` : "Removed product";
    return {
      productId: change.productId, productName: name, kind: change.kind || "update", path: "@product", field: "@product", label: change.kind === "delete" ? "Delete product" : "Product existence / identity", reason,
      base: clone(base), mine: clone(mine), master: clone(remote?.values || null), baseExists: Boolean(base), mineExists: Boolean(mine), masterExists: Boolean(remote),
      categoryId: change.categoryId ?? remote?.categoryId ?? tombstone?.categoryId ?? "", laneId: change.laneId ?? remote?.laneId ?? tombstone?.laneId ?? "",
      baseCategoryId: change.categoryId ?? remote?.categoryId ?? tombstone?.categoryId ?? "", baseLaneId: change.laneId ?? remote?.laneId ?? tombstone?.laneId ?? "",
      masterCategoryId: remote?.categoryId ?? tombstone?.categoryId ?? "", masterLaneId: remote?.laneId ?? tombstone?.laneId ?? "", masterProductVersion: remote?.productVersion || "",
      masterRevisions: clone(remote?.revisions || tombstone?.revisions || {}),
      baseText: base ? describe(base, change.categoryId, change.laneId) : "New product", mineText: describe(mine, change.categoryId, change.laneId), masterText: describe(remote?.values, remote?.categoryId, remote?.laneId),
    };
  }

  function allRevisionsChanged(base, master) {
    const keys = new Set([...Object.keys(base), ...Object.keys(master)]);
    return [...keys].some((key) => (base[key] || 0) !== (master[key] || 0));
  }

  function mergeChoices(value) {
    if (!object(value) || Object.keys(value).length > 4000) throw new TypeError("The merge decisions are invalid. Review the products again.");
    const choices = dictionary();
    for (const [path, choice] of Object.entries(value)) {
      if (!path || path.length > 4096 || ["__proto__", "constructor", "prototype"].includes(path) || !["keeper", "source"].includes(choice)) throw new TypeError("The merge decisions are invalid. Review the products again.");
      choices[path] = choice;
    }
    return choices;
  }

  function newMergeProduct(value, productId, categoryId, laneId, manifest) {
    if (!object(value) || value.id !== productId || JSON.stringify(value).length > 1024 * 1024) throw new TypeError("The imported product is incomplete or too large to merge.");
    if ((value.categoryId !== undefined && value.categoryId !== categoryId) || (value.laneId !== undefined && value.laneId !== laneId)) throw new TypeError("The reviewed product belongs to a different category or product lane.");
    boardForPlacement(manifest, categoryId, laneId);
    // The planner validates plain JSON, row IDs, nesting, and property names.
    const prepared = root.PortfolioProductMerge.cloneProduct(value);
    root.PortfolioProductMerge.plan(prepared, { id: productId === "merge-validation" ? "merge-validation-other" : "merge-validation", specs: [], partSkus: [], variantGroups: [] });
    const assets = new Set((manifest.imageAssets || []).map((asset) => asset.id));
    const checkImages = (node) => {
      if (Array.isArray(node)) { node.forEach(checkImages); return; }
      if (!object(node)) return;
      if (node.imageAssetId && !assets.has(node.imageAssetId)) throw new TypeError("This imported product has an image that has not been uploaded. Keep the draft and add the image after the products are combined.");
      Object.values(node).forEach(checkImages);
    };
    checkImages(prepared);
    delete prepared.categoryId;
    return { ...prepared, id: productId, laneId };
  }

  // A reviewed local record may contain an unsaved import. Retain omitted
  // accepted details while carrying its deliberate populated local additions.
  // Cross-product disagreements are still handled by the explicit merge plan.
  function buildSupplement(original, reviewed, reviewMetadata = false) {
    if (!object(original) || !object(reviewed) || original.id !== reviewed.id || !root.PortfolioProductMerge) throw new TypeError("The reviewed product is invalid.");
    const otherId = original.id === "supplement-validation" ? "supplement-validation-other" : "supplement-validation";
    const safe = (value) => { const copied = root.PortfolioProductMerge.cloneProduct(value); root.PortfolioProductMerge.plan(copied, { id: otherId, specs: [], partSkus: [], variantGroups: [] }); return copied; };
    const accepted = safe(original), supplied = safe(reviewed), conflicts = [];
    const blank = root.PortfolioProductMerge.isBlank;
    const rowKey = (row) => !object(row) ? "" : row.id ? `id:${row.id}` : row.basePartNumber || row.basePn || row.basePN ? `part:${root.PortfolioProductMerge.normalizeSku(row.basePartNumber || row.basePn || row.basePN)}` : "";
    const canonical = {
      product: new Set([...DATE_FIELDS, ...PRODUCT_FIELDS, "id", "laneId", "order", "categoryId"]),
      roadmap: new Set([...Object.values(ROADMAP_FIELDS), "launchMonth"]),
      spec: new Set(["id", ...SPEC_FIELDS]), part: new Set(["id", ...PART_FIELDS]),
      group: new Set(["id", "label", "type"]), variant: new Set(["id", ...VARIANT_FIELDS]),
    };
    const listContexts = { specs: "spec", partSkus: "part", variantGroups: "group", items: "variant" };
    const pretty = (field) => LABELS[field] || String(field).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
    const complete = (before, incoming, context = "custom", path = [], target = [], description = "") => {
      if (incoming === undefined || blank(incoming) && !blank(before)) return clone(before);
      if (object(incoming) && (object(before) || before === undefined)) {
        const previous = object(before) ? before : {}, result = clone(previous);
        for (const [field, value] of Object.entries(incoming)) {
          if (reviewMetadata && canonical[context]?.has(field)) continue;
          const childContext = context === "product" && field === "roadmap" ? "roadmap" :
            (context === "product" && own(listContexts, field) || context === "group" && field === "items") ? `${listContexts[field]}-list` : "custom";
          result[field] = complete(previous[field], value, childContext, [...path, field], [...target, field], description);
        }
        return result;
      }
      if (Array.isArray(before) && Array.isArray(incoming)) {
        const keyed = new Map(before.map((row) => [rowKey(row), row]).filter(([key]) => key));
        const rowContext = context.endsWith("-list") ? context.slice(0, -5) : "custom";
        const result = incoming.map((row, index) => {
          const key = rowKey(row), rowPath = key.startsWith("id:") ? key.slice(3) : key.startsWith("part:") ? key.slice(5) : String(index);
          const rowDescription = rowContext === "spec" ? `Specification · ${row.label || keyed.get(key)?.label || "Untitled"}` :
            rowContext === "part" ? `HP SKU · ${row.code || keyed.get(key)?.code || "Untitled"}` :
            rowContext === "variant" ? `Variant · ${row.code || row.label || keyed.get(key)?.code || "Untitled"}` :
            rowContext === "group" ? `Variant group · ${row.label || row.type || "Untitled"}` : description;
          return key && keyed.has(key) ? complete(keyed.get(key), row, rowContext, [...path, rowPath], [...target, index], rowDescription) : clone(row);
        });
        const keys = new Set(result.map(rowKey).filter(Boolean));
        for (const row of before) { const key = rowKey(row); if (key ? !keys.has(key) : !result.some((saved) => equal(saved, row))) { result.push(clone(row)); if (key) keys.add(key); } }
        return result;
      }
      if (reviewMetadata && !blank(before) && !blank(incoming) && !equal(before, incoming)) {
        const field = path[path.length - 1] || "Details", image = field === "imageAssetId";
        const conflictPath = `@metadata/${path.map(segment).join("/")}`;
        conflicts.push({ productId: original.id, productName: original.name || reviewed.name || "Untitled product", path: conflictPath, field: conflictPath,
          label: `${description ? `${description} · ` : ""}${image ? "Image" : pretty(field)}`, master: clone(before), mine: clone(incoming), masterExists: true, mineExists: true,
          masterText: image ? "Latest product image" : describeNode(before), mineText: image ? "Image selected in your draft" : describeNode(incoming),
          ...(image ? { masterImageId: before, mineImageId: incoming } : {}), target: clone(target) });
        return clone(before);
      }
      return clone(incoming);
    };
    const completed = complete(accepted, supplied, "product");
    completed.id = original.id;
    for (const field of ["laneId", "order", "categoryId"]) { if (own(original, field)) completed[field] = clone(original[field]); else delete completed[field]; }
    return { product: reviewMetadata ? root.PortfolioProductMerge.cloneProduct(completed) : safe(completed), conflicts };
  }

  function supplementProduct(original, reviewed) {
    return buildSupplement(original, reviewed).product;
  }

  // Canonical dates/specification/SKU facts are reviewed separately. These
  // choices cover their extra source details and other full-record metadata.
  function supplementReview(original, reviewed) {
    return buildSupplement(original, reviewed, true);
  }

  function resolveSupplementReview(review, choices = {}) {
    if (!object(review) || !object(review.product) || !Array.isArray(review.conflicts) || !object(choices) || !root.PortfolioProductMerge) throw new TypeError("The product details review is invalid.");
    const product = root.PortfolioProductMerge.cloneProduct(review.product);
    for (const conflict of review.conflicts) {
      if (!object(conflict) || conflict.productId !== product.id || typeof conflict.path !== "string" || !conflict.path.startsWith("@metadata/") || !Array.isArray(conflict.target) || !conflict.target.length || conflict.target.length > 32) throw new TypeError("The product details review is invalid.");
      const choice = choices[conflict.path] ?? choices[JSON.stringify([product.id, conflict.path])];
      if (!["mine", "master"].includes(choice)) throw new RangeError("Choose which product details to keep for each difference.");
      let parent = product;
      for (const field of conflict.target.slice(0, -1)) {
        if (!["string", "number"].includes(typeof field) || ["__proto__", "prototype", "constructor"].includes(field) || !own(parent, field) || !parent[field] || typeof parent[field] !== "object") throw new TypeError("The product details review is invalid.");
        parent = parent[field];
      }
      const field = conflict.target[conflict.target.length - 1];
      if (!["string", "number"].includes(typeof field) || ["__proto__", "prototype", "constructor"].includes(field) || !own(parent, field)) throw new TypeError("The product details review is invalid.");
      parent[field] = root.PortfolioProductMerge.cloneProduct(choice === "mine" ? conflict.mine : conflict.master);
    }
    return root.PortfolioProductMerge.cloneProduct(product);
  }

  function mergeProductConflict(change, remote, sourceRemote, reason) {
    return { productId: change.productId, sourceProductId: change.sourceProductId, productName: remote?.productName || change.mine?.name || "Product", kind: "merge", path: "@merge", field: "@merge", label: "Review the merge again", reason,
      baseText: "Products before the merge", mineText: "Combined product", masterText: "One of these products has changed", requiresMergeReview: true,
      masterProductVersion: remote?.productVersion || "", sourceMasterProductVersion: sourceRemote?.productVersion || "" };
  }

  function mergeChanges(manifest, changes, context = {}) {
    if (!Array.isArray(changes) || changes.length > 500) throw new TypeError("Submit at most 500 changed products at a time.");
    const currentSnapshot = snapshot(manifest);
    const known = new Map(currentSnapshot.products.map((entry) => [entry.productId, entry]));
    const removed = new Map(currentSnapshot.tombstones.map((entry) => [entry.productId, entry]));
    const fullProducts = new Map(entriesFromManifest(manifest).map((entry) => [entry.productId, entry.product]));
    const seen = new Set();
    const plans = [];
    const conflicts = [];
    for (const change of changes) {
      if (!object(change)) throw new TypeError("A product change is invalid.");
      const productId = identity(change.productId, "Product");
      if (seen.has(productId)) throw new TypeError("A product can appear only once in a save request.");
      seen.add(productId);
      const remote = known.get(productId);
      const kind = change.kind || "update";
      if (!["update", "create", "delete", "merge"].includes(kind)) throw new TypeError("A product change must be an update, create, delete, or merge.");
      if (kind === "merge") {
        if (!root.PortfolioProductMerge) throw new TypeError("Product merging is unavailable. Your draft is safe.");
        const sourceProductId = identity(change.sourceProductId, "Other product");
        if (sourceProductId === productId || seen.has(sourceProductId)) throw new TypeError("Each product can be included in only one change or merge at a time.");
        seen.add(sourceProductId);
        const sourceRemote = known.get(sourceProductId), choices = mergeChoices(change.choices || {});
        const mine = validateValues(change.mine);
        const sourceMetadata = manifest.masterSync?.products?.[sourceProductId];
        if (!sourceRemote && remote && context.requestId && sourceMetadata?.mergeRequestId === context.requestId && sourceMetadata.mergedIntoProductId === productId && equal(remote.values, mine)) continue;
        let changed = false;
        for (const [entry, baseRecord, version, category, lane] of [[remote, change.base, change.baseProductVersion, change.categoryId, change.laneId], [sourceRemote, change.sourceBase, change.sourceBaseProductVersion, change.sourceCategoryId, change.sourceLaneId]]) {
          if (baseRecord) {
            if (!entry || !/^[a-f0-9]{64}$/.test(String(version || "")) || entry.productVersion !== version || !equal(canonicalValues(baseRecord.values || baseRecord), entry.values) || allRevisionsChanged(safeRevisions(baseRecord.revisions || (entry === remote ? change.baseRevisions : change.sourceBaseRevisions)), entry.revisions) || category !== entry.categoryId || lane !== entry.laneId) changed = true;
          } else if (entry) changed = true;
        }
        if ((!remote && removed.has(productId)) || (!sourceRemote && removed.has(sourceProductId))) changed = true;
        if (changed) { conflicts.push(mergeProductConflict(change, remote, sourceRemote, "products-changed-before-merge")); continue; }
        const categoryId = remote?.categoryId ?? string(change.categoryId, "Product portfolio", 180), laneId = remote?.laneId ?? identity(change.laneId, "Product lane");
        const sourceCategoryId = sourceRemote?.categoryId ?? string(change.sourceCategoryId, "Other portfolio", 180), sourceLaneId = sourceRemote?.laneId ?? identity(change.sourceLaneId, "Other product lane");
        if (categoryId !== sourceCategoryId) throw new RangeError("Choose products from the same category. Listings in different categories stay separate.");
        const originalKeeper = remote ? fullProducts.get(productId) : newMergeProduct(change.keeperProduct, productId, categoryId, laneId, manifest);
        const originalSource = sourceRemote ? fullProducts.get(sourceProductId) : newMergeProduct(change.sourceProduct, sourceProductId, sourceCategoryId, sourceLaneId, manifest);
        const keeper = remote && change.keeperProduct ? supplementProduct(originalKeeper, newMergeProduct(change.keeperProduct, productId, categoryId, laneId, manifest)) : originalKeeper;
        const source = sourceRemote && change.sourceProduct ? supplementProduct(originalSource, newMergeProduct(change.sourceProduct, sourceProductId, sourceCategoryId, sourceLaneId, manifest)) : originalSource;
        const planned = root.PortfolioProductMerge.plan(keeper, source);
        if (planned.conflicts.some((item) => !own(choices, item.key))) { conflicts.push(mergeProductConflict(change, remote, sourceRemote, "additional-details-need-review")); continue; }
        // Shared fact edits made after the review remain an explicit overlay.
        // Supplemental complete records preserve unsaved imported source data.
        const completed = applyProductValues(root.PortfolioProductMerge.resolve(planned, choices), mine);
        plans.push({ productId, sourceProductId, kind, categoryId, laneId, sourceCategoryId, sourceLaneId, remote, sourceRemote, choices, fullProduct: completed, keeperProduct: clone(originalKeeper), sourceProduct: clone(originalSource), values: mine });
        continue;
      }
      if (kind === "create") {
        const categoryId = string(change.categoryId, "Product portfolio", 180), laneId = identity(change.laneId, "Product lane");
        boardForPlacement(manifest, categoryId, laneId);
        if (!object(change.mine)) throw new TypeError("A new product needs its complete shared values.");
        for (const field of Object.keys(change.mine)) if (!SHARED_FIELDS.includes(field)) throw new TypeError(`Unsupported shared field: ${field}.`);
        const mine = validateValues(change.mine);
        const tombstone = removed.get(productId);
        if (remote) {
          // The transport also keeps request receipts. This local replay check
          // protects transports that restore only the manifest after a restart.
          const receipt = manifest.masterSync?.products?.[productId]?.creationRequestId;
          if (context.requestId && receipt === context.requestId && equal(remote.values, mine) && remote.categoryId === categoryId && remote.laneId === laneId) continue;
          conflicts.push(lifecycleConflict(change, remote, null, mine, "product-id-exists"));
        } else if (tombstone && allRevisionsChanged(safeRevisions(change.baseRevisions), tombstone.revisions)) conflicts.push(lifecycleConflict(change, null, null, mine, "product-removed", tombstone));
        else plans.push({ productId, kind, categoryId, laneId, values: mine });
        continue;
      }
      if (!object(change.base)) throw new TypeError("Every product change needs its original master values.");
      const base = canonicalValues({ ...(remote?.values || {}), ...change.base });
      if (kind === "delete") {
        if (typeof change.baseProductVersion !== "string" || !/^[a-f0-9]{64}$/.test(change.baseProductVersion)) throw new TypeError("Deleting a product needs its original master product version. Pull the latest master before deleting it.");
        if (!remote) continue;
        const placementChanged = (change.categoryId !== undefined && change.categoryId !== remote.categoryId) || (change.laneId !== undefined && change.laneId !== remote.laneId);
        const versionChanged = change.baseProductVersion !== remote.productVersion;
        if (!equal(base, remote.values) || allRevisionsChanged(safeRevisions(change.baseRevisions), remote.revisions) || placementChanged || versionChanged) conflicts.push(lifecycleConflict(change, remote, base, null, "product-changed-before-delete"));
        else plans.push({ productId, kind, remote });
        continue;
      }
      const mine = patchValues(base, change.patch || {});
      if (!remote) {
        conflicts.push(lifecycleConflict(change, null, base, mine, "product-removed", removed.get(productId)));
        continue;
      }
      const plan = planMerge(base, mine, remote.values, safeRevisions(change.baseRevisions), remote.revisions);
      conflicts.push(...plan.conflicts.map((item) => ({ productId, productName: remote.productName, ...item })));
      plans.push({ productId, remote, plan });
    }
    if (conflicts.length) return { manifest, conflicts, savedFields: 0, savedProducts: 0, history: [] };
    const updates = plans.map((entry) => entry.kind === "merge" ? { ...entry, operations: [{ path: "@product", label: "Merge products", base: entry.remote?.values || null, value: entry.values, baseExists: Boolean(entry.remote), valueExists: true }, ...diffOperations(entry.remote?.values || canonicalValues({}), entry.values)] } : entry.kind === "create" ? { ...entry, operations: [{ path: "@product", label: "Create product", base: null, value: entry.values, baseExists: false, valueExists: true }] } : entry.kind === "delete" ? { ...entry, operations: [{ path: "@product", label: "Delete product", base: entry.remote.values, value: null, baseExists: true, valueExists: false }] } : { productId: entry.productId, kind: "update", values: validateValues(entry.plan.values), operations: diffOperations(entry.remote.values, entry.plan.values) }).filter((entry) => entry.operations.length);
    if (!updates.length) return { manifest, conflicts: [], savedFields: 0, savedProducts: 0, history: [] };
    const nextManifest = clone(manifest);
    const nextEntries = new Map(entriesFromManifest(nextManifest).map((entry) => [entry.productId, entry]));
    const previousMeta = object(nextManifest.masterSync) ? nextManifest.masterSync : {};
    const metadata = { ...previousMeta, version: 1, revision: Number.isSafeInteger(previousMeta.revision) && previousMeta.revision >= 0 ? previousMeta.revision : 0, products: dictionary(), history: Array.isArray(previousMeta.history) ? previousMeta.history.slice(-1000) : [] };
    for (const [productId, previous] of Object.entries(previousMeta.products || {})) {
      identity(productId, "Product");
      if (object(previous)) metadata.products[productId] = { ...clone(previous), revisions: safeRevisions(previous.revisions) };
    }
    for (const entry of [...currentSnapshot.products, ...currentSnapshot.tombstones]) {
      metadata.products[entry.productId] = { ...(metadata.products[entry.productId] || {}), revisions: safeRevisions(entry.revisions) };
      for (const revision of Object.values(entry.revisions)) metadata.revision = Math.max(metadata.revision, revision);
    }
    if (metadata.revision > Number.MAX_SAFE_INTEGER - updates.reduce((sum, entry) => sum + entry.operations.length + (entry.kind === "merge" ? 1 + (nextEntries.size + updates.length) * 2 : 0), 0)) throw new RangeError("The change counter needs attention from the portfolio owner before another save.");
    const now = typeof context.now === "string" ? context.now : new Date().toISOString();
    const history = [];
    let savedFields = 0;
    for (const update of updates) {
      const entry = nextEntries.get(update.productId);
      let nextProduct;
      if (update.kind === "merge") {
        const board = boardForPlacement(nextManifest, update.categoryId, update.laneId);
        nextProduct = clone(update.fullProduct);
        if (entry) Object.assign(entry.product, nextProduct);
        else {
          nextProduct.order = board.products.filter((product) => product.laneId === update.laneId).reduce((maximum, product) => Number.isFinite(product.order) ? Math.max(maximum, product.order) : maximum, -1) + 1;
          board.products.push(nextProduct);
          nextEntries.set(update.productId, { product: nextProduct, categoryId: update.categoryId, laneId: update.laneId, productName: nextProduct.name });
        }
        metadata.products[update.productId] = { ...(metadata.products[update.productId] || {}), revisions: safeRevisions(metadata.products[update.productId]?.revisions), deleted: false, categoryId: update.categoryId, laneId: update.laneId, productName: nextProduct.name };
        delete metadata.products[update.productId].archivedProduct;
        const donor = nextEntries.get(update.sourceProductId);
        if (donor) {
          const donorBoard = boardForPlacement(nextManifest, donor.categoryId, donor.laneId);
          donorBoard.products.splice(donorBoard.products.findIndex((product) => product.id === update.sourceProductId), 1);
        }
        metadata.revision += 1;
        metadata.products[update.sourceProductId] = { ...(metadata.products[update.sourceProductId] || {}), revisions: { ...safeRevisions(metadata.products[update.sourceProductId]?.revisions), "@product": metadata.revision }, deleted: true, categoryId: update.sourceCategoryId, laneId: update.sourceLaneId, productName: update.sourceRemote?.productName || update.sourceProduct.name || "Merged product", archivedProduct: clone(donor?.product || update.sourceProduct), archivedKeeperProduct: clone(update.keeperProduct), mergedIntoProductId: update.productId, mergeChoices: clone(update.choices), mergeRequestId: String(context.requestId || "").slice(0, 180) };
        history.push({ productId: update.sourceProductId, productName: update.sourceRemote?.productName || "Merged product", kind: "merge", path: "@product", label: "Merged into another product", before: update.sourceRemote?.values || null, after: null, beforeExists: Boolean(update.sourceRemote), afterExists: false, revision: metadata.revision, at: now, actor: String(context.actor || "Team member").slice(0, 160), requestId: String(context.requestId || "").slice(0, 180) });
        savedFields += 1;
      } else if (update.kind === "create") {
        const board = boardForPlacement(nextManifest, update.categoryId, update.laneId);
        const laneProducts = board.products.filter((product) => product.laneId === update.laneId);
        const order = laneProducts.reduce((maximum, product) => Number.isFinite(product.order) ? Math.max(maximum, product.order) : maximum, -1) + 1;
        const previousProduct = metadata.products[update.productId]?.deleted && object(metadata.products[update.productId]?.archivedProduct) ? clone(metadata.products[update.productId].archivedProduct) : {};
        nextProduct = applyProductValues({ ...previousProduct, id: update.productId, laneId: update.laneId, order }, update.values);
        board.products.push(nextProduct);
        metadata.products[update.productId] = { ...(metadata.products[update.productId] || {}), revisions: safeRevisions(metadata.products[update.productId]?.revisions), deleted: false, categoryId: update.categoryId, laneId: update.laneId, productName: nextProduct.name, creationRequestId: String(context.requestId || "").slice(0, 180) };
        delete metadata.products[update.productId].archivedProduct;
        delete metadata.products[update.productId].mergedIntoProductId;
        delete metadata.products[update.productId].mergeChoices;
        delete metadata.products[update.productId].mergeRequestId;
      } else if (update.kind === "delete") {
        const board = boardForPlacement(nextManifest, entry.categoryId, entry.laneId);
        board.products.splice(board.products.findIndex((product) => product.id === update.productId), 1);
        nextProduct = entry.product;
        Object.assign(metadata.products[update.productId], { deleted: true, categoryId: entry.categoryId, laneId: entry.laneId, productName: entry.productName, archivedProduct: clone(entry.product) });
        delete metadata.products[update.productId].mergedIntoProductId;
        delete metadata.products[update.productId].mergeChoices;
        delete metadata.products[update.productId].mergeRequestId;
      } else {
        nextProduct = applyProductValues(entry.product, update.values);
        Object.assign(entry.product, nextProduct);
      }
      const revisions = metadata.products[update.productId].revisions;
      for (const op of update.operations) {
        metadata.revision += 1;
        revisions[op.path] = metadata.revision;
        const record = { productId: update.productId, productName: nextProduct.name || entry?.productName || "Untitled product", kind: update.kind, path: op.path, field: op.path, label: op.label, before: clone(op.base), after: clone(op.value), beforeExists: op.baseExists, afterExists: op.valueExists, revision: metadata.revision, at: now, actor: String(context.actor || "Team member").slice(0, 160), team: String(context.team || "").slice(0, 160), reason: String(context.reason || "").slice(0, 2000), requestId: String(context.requestId || "").slice(0, 180) };
        history.push(record);
        savedFields += 1;
      }
    }
    const redirects = new Map(updates.filter((update) => update.kind === "merge").map((update) => [update.sourceProductId, update.productId]));
    if (redirects.size) for (const related of entriesFromManifest(nextManifest)) for (const [field, property] of [["roadmapPredecessorId", "predecessorId"], ["roadmapSuccessorId", "successorId"]]) {
      const before = related.product.roadmap?.[property];
      if (!redirects.has(before)) continue;
      const target = redirects.get(before), after = target === related.productId ? "" : target;
      related.product.roadmap[property] = after;
      metadata.revision += 1;
      metadata.products[related.productId].revisions[field] = metadata.revision;
      history.push({ productId: related.productId, productName: related.productName, kind: "update", path: field, label: LABELS[field], before, after, beforeExists: true, afterExists: true, revision: metadata.revision, at: now, actor: String(context.actor || "Team member").slice(0, 160), requestId: String(context.requestId || "").slice(0, 180) });
      savedFields += 1;
    }
    metadata.history = boundedHistory([...metadata.history, ...history]);
    nextManifest.masterSync = metadata;
    return { manifest: nextManifest, conflicts: [], savedFields, savedProducts: updates.length, history };
  }

  root.PortfolioMasterModel = Object.freeze({ DATE_FIELDS, PRODUCT_FIELDS, ROADMAP_FIELDS, SHARED_FIELDS, productValues, values: productValues, productVersion, variantSkuIdentity, applyProductValues, validateValues, patchValues, diffValues, diffOperations, describeChanges, describeNode, planMerge, resolveConflicts, draftBaseline, draftRevisions, entriesFromManifest, productsFromManifest: (manifest) => entriesFromManifest(manifest).map((entry) => entry.product), snapshot, publicMetadata, supplementProduct, supplementReview, resolveSupplementReview, mergeChanges });
})(globalThis);
