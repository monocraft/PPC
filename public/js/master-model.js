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
  const segment = (value) => ["@launch", "@end", "@lifecycle"].includes(value) ? value : encodeURIComponent(value);
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
    if (checkDuplicates && duplicateSkus(toTree(result)).length) throw new RangeError("The same SKU code cannot be assigned to different rows. Remove the duplicate or use a different code.");
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
    if (own(value, "code")) return [value.code || "Blank SKU", value.label, value.colorName, value.variantId ? `Color ${value.variantId}` : ""].filter(Boolean).join(" · ");
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
    const keys = new Set([path]);
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

  function duplicateSkus(tree) {
    const buckets = [{ prefix: "partSkus", records: Object.entries(tree.partSkus || {}).map(([id, row]) => ({ path: `partSkus/${segment(id)}`, row })) }];
    const variantBuckets = new Map();
    for (const [groupId, group] of Object.entries(tree.variantGroups || {})) {
      if (!variantBuckets.has(group.type)) variantBuckets.set(group.type, []);
      for (const [id, row] of Object.entries(group.items || {})) variantBuckets.get(group.type).push({ path: `variantGroups/${segment(groupId)}/items/${segment(id)}`, row });
    }
    for (const [type, rows] of variantBuckets) buckets.push({ prefix: `variantGroups:${type}`, records: rows });
    const issues = [];
    for (const bucket of buckets) {
      const codes = new Map();
      for (const item of bucket.records) {
        const code = item.row.code?.trim().toUpperCase();
        if (!code) continue;
        if (codes.has(code)) issues.push({ code, a: codes.get(code), b: item, prefix: bucket.prefix });
        else codes.set(code, item);
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
        return local.exists && (!old.exists || local.value.code !== old.value.code);
      };
      const mineItem = changedCode(issue.a) ? issue.a : issue.b;
      const masterItem = mineItem === issue.a ? issue.b : issue.a;
      if (conflicts.some((item) => item.path === mineItem.path)) continue;
      // A SKU collision is one decision, even when a prior operation also
      // conflicts with deletion or editing of the other record.
      for (let index = conflicts.length - 1; index >= 0; index -= 1) if (conflicts[index].path === masterItem.path || conflicts[index].path.startsWith(`${masterItem.path}/`)) conflicts.splice(index, 1);
      conflicts.push(conflict(mineItem.path, baseTree, mineTree, masterTree, { reason: "duplicate-sku", label: `Duplicate SKU code ${issue.code} — choose the final SKU`, conflictingPath: masterItem.path, master: clone(masterItem.row), masterExists: true, masterText: describeNode(masterItem.row), duplicateCode: issue.code }));
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
      entries.push({ product, productId, productName: String(product.name || "Untitled product"), categoryId: String(category.id || "") });
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

  function snapshot(manifest) {
    return { version: 1, products: entriesFromManifest(manifest).map((entry) => ({ productId: entry.productId, productName: entry.productName, categoryId: entry.categoryId, values: productValues(entry.product), revisions: safeRevisions(manifest.masterSync?.products?.[entry.productId]?.revisions) })) };
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

  function mergeChanges(manifest, changes, context = {}) {
    if (!Array.isArray(changes) || changes.length > 500) throw new TypeError("Submit at most 500 changed products at a time.");
    const currentSnapshot = snapshot(manifest);
    const known = new Map(currentSnapshot.products.map((entry) => [entry.productId, entry]));
    const seen = new Set();
    const plans = [];
    const conflicts = [];
    for (const change of changes) {
      if (!object(change)) throw new TypeError("A product change is invalid.");
      const productId = identity(change.productId, "Product");
      if (seen.has(productId)) throw new TypeError("A product can appear only once in a save request.");
      seen.add(productId);
      const remote = known.get(productId);
      if (!remote) throw new RangeError("A changed product is no longer in the master. Pull the master and select an existing product.");
      if (!object(change.base)) throw new TypeError("Every product change needs its original master values.");
      const base = canonicalValues({ ...remote.values, ...change.base });
      const mine = patchValues(base, change.patch || {});
      const plan = planMerge(base, mine, remote.values, safeRevisions(change.baseRevisions), remote.revisions);
      conflicts.push(...plan.conflicts.map((item) => ({ productId, productName: remote.productName, ...item })));
      plans.push({ productId, remote, plan });
    }
    if (conflicts.length) return { manifest, conflicts, savedFields: 0, savedProducts: 0, history: [] };
    const updates = plans.map(({ productId, remote, plan }) => ({ productId, values: validateValues(plan.values), operations: diffOperations(remote.values, plan.values) })).filter((entry) => entry.operations.length);
    if (!updates.length) return { manifest, conflicts: [], savedFields: 0, savedProducts: 0, history: [] };
    const nextManifest = clone(manifest);
    const nextEntries = new Map(entriesFromManifest(nextManifest).map((entry) => [entry.productId, entry]));
    const previousMeta = object(nextManifest.masterSync) ? nextManifest.masterSync : {};
    const metadata = { ...previousMeta, version: 1, revision: Number.isSafeInteger(previousMeta.revision) && previousMeta.revision >= 0 ? previousMeta.revision : 0, products: dictionary(), history: Array.isArray(previousMeta.history) ? previousMeta.history.slice(-1000) : [] };
    for (const entry of currentSnapshot.products) {
      metadata.products[entry.productId] = { revisions: safeRevisions(entry.revisions) };
      for (const revision of Object.values(entry.revisions)) metadata.revision = Math.max(metadata.revision, revision);
    }
    if (metadata.revision > Number.MAX_SAFE_INTEGER - updates.reduce((sum, entry) => sum + entry.operations.length, 0)) throw new RangeError("The master's change counter needs to be reset by the portfolio owner before another save.");
    const now = typeof context.now === "string" ? context.now : new Date().toISOString();
    const history = [];
    let savedFields = 0;
    for (const update of updates) {
      const entry = nextEntries.get(update.productId);
      const nextProduct = applyProductValues(entry.product, update.values);
      Object.assign(entry.product, nextProduct);
      const revisions = metadata.products[update.productId].revisions;
      for (const op of update.operations) {
        metadata.revision += 1;
        revisions[op.path] = metadata.revision;
        const record = { productId: update.productId, productName: nextProduct.name || entry.productName, path: op.path, field: op.path, label: op.label, before: clone(op.base), after: clone(op.value), beforeExists: op.baseExists, afterExists: op.valueExists, revision: metadata.revision, at: now, actor: String(context.actor || "Team member").slice(0, 160), team: String(context.team || "").slice(0, 160), reason: String(context.reason || "").slice(0, 2000), requestId: String(context.requestId || "").slice(0, 180) };
        history.push(record);
        savedFields += 1;
      }
    }
    metadata.history = boundedHistory([...metadata.history, ...history]);
    nextManifest.masterSync = metadata;
    return { manifest: nextManifest, conflicts: [], savedFields, savedProducts: updates.length, history };
  }

  root.PortfolioMasterModel = Object.freeze({ DATE_FIELDS, PRODUCT_FIELDS, ROADMAP_FIELDS, SHARED_FIELDS, productValues, values: productValues, applyProductValues, validateValues, patchValues, diffValues, diffOperations, describeChanges, describeNode, planMerge, resolveConflicts, draftBaseline, draftRevisions, entriesFromManifest, productsFromManifest: (manifest) => entriesFromManifest(manifest).map((entry) => entry.product), snapshot, mergeChanges });
})(globalThis);
