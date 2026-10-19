import "./shared/master-model.js";
import "./shared/ascm-import.js";

export const ASCM_REVIEW_REASONS = Object.freeze([
  "AMBIGUOUS_MATCH", "CATEGORY_RELOCATION", "DATE_POLICY_REQUIRED", "DUPLICATE_MATCH",
  "INCOMPATIBLE_MAPPING", "INCOMPLETE_NEW_PRODUCT", "MALFORMED_REPORT", "MASTER_CONFLICT",
  "PRODUCT_ID_COLLISION", "PROTECTED_DATE", "STALE_REPORT", "TOO_MANY_GROUPS",
]);

export class AscmReviewError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AscmReviewError";
    this.code = code;
    this.details = details;
  }
}

const object = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const DATE_FIELDS = ["generalAvailabilityDate", "endManufacturingDate"];
const HOLD_DIAGNOSTICS = new Set(["INVALID_LOCAL_FLAG", "DUPLICATE_BASE_PN", "MULTIPLE_ASCM_SHEETS"]);
const SOURCE_FILE = /^ASCM Report_HyperX_(\d{4}-\d{2}-\d{2})\.xlsx$/i;
const fail = (code, message, details = {}) => { throw new AscmReviewError(code, message, details); };

function validDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateAuthorization(policy) {
  if (!object(policy) || policy.version !== 1 || policy.allowUpdates !== true || !Array.isArray(policy.protected)
    || Object.keys(policy).some(key => !["version", "allowUpdates", "protected"].includes(key))) return null;
  const protectedFields = new Map();
  for (const entry of policy.protected) {
    if (!object(entry) || Object.keys(entry).some(key => !["productId", "fields"].includes(key))
      || typeof entry.productId !== "string" || !entry.productId || entry.productId.length > 180
      || ["__proto__", "prototype", "constructor"].includes(entry.productId)
      || !Array.isArray(entry.fields) || !entry.fields.length || entry.fields.some(field => !DATE_FIELDS.includes(field))
      || new Set(entry.fields).size !== entry.fields.length || protectedFields.has(entry.productId)) return null;
    protectedFields.set(entry.productId, new Set(entry.fields));
  }
  return protectedFields;
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619) >>> 0;
  }
  return result.toString(36);
}

function productIdentity(group) {
  const slug = group.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44) || "product";
  return `ascm-${slug}-${hash(group.ascmKey || group.key)}`;
}

export function validateAscmDataset(dataset, importer = globalThis.ASCMImporter) {
  if (!object(dataset) || !Array.isArray(dataset.rows) || !dataset.rows.length || !object(dataset.metadata)
    || !Array.isArray(dataset.diagnostics || [])) fail("MALFORMED_REPORT", "The ASCM report has no usable primary rows or metadata.");
  for (const field of ["invalidRowsFiltered", "invalidLocalRowsFiltered", "duplicateBasePnRows"]) {
    if (dataset.metadata[field] != null && dataset.metadata[field] !== 0) fail("MALFORMED_REPORT", "The parser omitted invalid or duplicate primary rows; review the whole report.", { field });
  }
  for (const item of dataset.diagnostics || []) {
    if (!object(item) || item.level === "error" || HOLD_DIAGNOSTICS.has(item.code)) fail("MALFORMED_REPORT", "The ASCM parser requires a source review.", { diagnostic: item?.code || "INVALID_DIAGNOSTIC" });
  }
  const seen = new Set();
  for (const row of dataset.rows) {
    if (!object(row) || ["category", "basePn", "description"].some(field => typeof row[field] !== "string" || !row[field].trim())
      || !Number.isSafeInteger(row.sourceRow) || row.sourceRow < 1
      || ["featureId", "codeName", "localCode"].some(field => row[field] != null && typeof row[field] !== "string")
      || !/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(row.basePn)
      || ["ga", "em"].some(field => row[field] !== "" && !validDay(row[field]))
      || row.ga && row.em && row.em < row.ga
      || row.localFlag != null && !["", "Y", "N"].includes(row.localFlag)) fail("MALFORMED_REPORT", "An ASCM row contains malformed identity or lifecycle dates.", { sourceRow: row?.sourceRow || null });
    // Parser identity intentionally scopes a shared PC/Console HP SKU to its portfolio.
    const category = importer.helpers.mapAscmCategory(row.category, row.description) || row.category.trim().toLowerCase();
    const key = JSON.stringify([category, row.basePn]);
    if (seen.has(key)) fail("MALFORMED_REPORT", "A primary part number is repeated in the same portfolio.", { sourceRow: row.sourceRow || null });
    seen.add(key);
  }
}

/** Pure, atomic transaction planning. Callers own authentication, receipts and CAS. */
export function planAscmImport({ manifest, dataset, reportDate, importedAt, requestId, datePolicy } = {}) {
  const model = globalThis.PortfolioMasterModel, importer = globalThis.ASCMImporter;
  if (!object(manifest) || !Array.isArray(manifest.categories)
    || !validDay(reportDate) || typeof importedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(importedAt)
    || !Number.isFinite(Date.parse(importedAt)) || !validDay(importedAt.slice(0, 10))
    || new Date(importedAt).toISOString() !== importedAt.replace(/Z$/, importedAt.includes(".") ? "Z" : ".000Z")
    || typeof requestId !== "string" || !requestId || requestId.length > 180) fail("MALFORMED_REPORT", "The ASCM transaction identity or timestamp is invalid.");
  validateAscmDataset(dataset, importer);
  const sourceDate = SOURCE_FILE.exec(dataset.metadata.fileName || "")?.[1];
  if (!validDay(sourceDate) || sourceDate !== reportDate) fail("MALFORMED_REPORT", "The ASCM source filename and report date disagree.");

  try {
    const entries = model.entriesFromManifest(manifest);
    for (const source of [manifest.ascmSnapshot, ...entries.map(entry => entry.product.ascm)]) {
      const acceptedDate = SOURCE_FILE.exec(source?.sourceFile || "")?.[1];
      if (validDay(acceptedDate) && acceptedDate > reportDate) fail("STALE_REPORT", "A newer ASCM report has already been accepted.", { acceptedReportDate: acceptedDate });
    }
    const groups = importer.buildProductGroups(dataset);
    if (!groups.length) fail("MALFORMED_REPORT", "The ASCM report has no product groups.");
    if (groups.length > 500) fail("TOO_MANY_GROUPS", "Review reports with more than 500 product groups manually.", { groups: groups.length });
    const snapshot = model.snapshot(manifest);
    const known = new Map(snapshot.products.map(entry => [entry.productId, entry]));
    const unavailableIds = new Set([...entries.map(entry => entry.productId), ...Object.keys(manifest.masterSync?.products || {})]);
    const protectedFields = dateAuthorization(datePolicy);
    const changes = [], evidence = new Map(), affectedIds = new Set(), matchedIds = new Set();
    const summary = { groups: groups.length, added: 0, updated: 0, unchanged: 0, sourceUpdated: 0 };

    for (const group of groups) {
      const category = manifest.categories.find(candidate => candidate.id === group.categoryId);
      if (!group.categoryId || !category || !object(category.board) || !Array.isArray(category.board.products)
        || group.diagnostics.some(item => item.level === "error")) fail("INCOMPATIBLE_MAPPING", "The ASCM group has no compatible portfolio mapping.");
      const match = importer.matchProductGroup(group, manifest);
      if (match.status === "ambiguous") fail("AMBIGUOUS_MATCH", "The ASCM identity matches more than one product.");
      if (match.status === "matched" && match.categoryId !== group.categoryId) fail("CATEGORY_RELOCATION", "An ASCM source category relocation needs review.");
      const existing = match.status === "matched" ? match.product : null;
      const productId = existing?.id || productIdentity(group);
      if (matchedIds.has(productId)) fail("DUPLICATE_MATCH", "More than one ASCM group targets the same product.");
      matchedIds.add(productId);
      if (!existing && unavailableIds.has(productId)) fail("PRODUCT_ID_COLLISION", "The ASCM product identity is already used or was removed.");
      unavailableIds.add(productId);
      if (!existing && (!group.laneId || !category.board.lanes?.some(lane => lane.id === group.laneId))) fail("INCOMPATIBLE_MAPPING", "The ASCM product needs an existing compatible lane.");
      if (!existing && (!group.gaDate || !group.emDate)) fail("INCOMPLETE_NEW_PRODUCT", "A new ASCM product needs both lifecycle dates before unattended creation.");

      const seed = existing || { id: productId, name: group.displayName, codename: group.codename || "", laneId: group.laneId, price: null, priceLabel: "Price TBD", roadmap: {
        startMonth: group.gaDate.slice(0, 7), launchMonth: group.gaDate.slice(0, 7), endMonth: group.emDate.slice(0, 7),
        status: group.emDate && group.emDate < importedAt.slice(0, 10) ? "end-of-life" : group.gaDate && group.gaDate > importedAt.slice(0, 10) ? "in-planning" : "launched", confidence: "medium",
      } };
      const merged = importer.mergeProductGroup(seed, group, { datasetMetadata: dataset.metadata, importedAt, createId: (kind, code) => `${productId}-${kind}-${hash(code)}` });
      const values = model.values(merged);
      if (existing) {
        const base = known.get(productId), patch = {};
        for (const field of [...DATE_FIELDS, "partSkus", "variantGroups"]) if (!equal(base.values[field], values[field])) patch[field] = values[field];
        for (const field of DATE_FIELDS) {
          if (!Object.hasOwn(patch, field)) continue;
          if (!protectedFields) fail("DATE_POLICY_REQUIRED", "Existing lifecycle date changes require an explicit cloud protection policy.", { productId, field });
          if (protectedFields.get(productId)?.has(field)) fail("PROTECTED_DATE", "An ASCM source change targets a protected lifecycle date.", { productId, field });
        }
        if (Object.keys(patch).length) {
          changes.push({ productId, base: base.values, baseRevisions: base.revisions, patch });
          summary.updated += 1;
          affectedIds.add(productId);
        } else summary.unchanged += 1;
      } else {
        changes.push({ kind: "create", productId, categoryId: group.categoryId, laneId: group.laneId, mine: values });
        summary.added += 1;
        affectedIds.add(productId);
      }
      evidence.set(productId, merged.ascm);
      if (!equal(existing?.ascm, merged.ascm)) {
        summary.sourceUpdated += 1;
        affectedIds.add(productId);
      }
    }

    const result = model.mergeChanges(manifest, changes, { now: importedAt, requestId, actor: "ASCM supervisor", team: "ASCM", reason: `Monthly ASCM report ${reportDate}` });
    if (result.conflicts.length) fail("MASTER_CONFLICT", "The ASCM transaction contains conflicting shared changes.");
    // mergeChanges returns the input object for metadata-only reports. Clone before overlays.
    const next = clone(result.manifest);
    for (const entry of model.entriesFromManifest(next)) if (evidence.has(entry.productId)) entry.product.ascm = clone(evidence.get(entry.productId));
    next.ascmSnapshot = {
      ...(object(manifest.ascmSnapshot) ? clone(manifest.ascmSnapshot) : {}),
      sourceFile: dataset.metadata.fileName, exportedAt: dataset.metadata.exportedAt || "", importedAt,
      basePartNumbers: [...new Set(dataset.rows.map(row => row.basePn))].sort(),
    };
    return { manifest: next, changed: !equal(manifest, next), savedFields: result.savedFields, savedProducts: affectedIds.size, summary };
  } catch (error) {
    if (error instanceof AscmReviewError) throw error;
    fail("MALFORMED_REPORT", "The ASCM report or current master requires review before import.", { reason: error?.code || "MODEL_VALIDATION" });
  }
}
