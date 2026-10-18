import assert from "node:assert/strict";
import { test } from "node:test";
import "../../public/js/package-codec.js";
import "../../public/js/master-model.js";
import "../../public/js/ascm-import.js";
import { planAscmImport, AscmReviewError } from "../../supabase/functions/ppc-master/ascm-plan.mjs";

const model = globalThis.PortfolioMasterModel;
const importer = globalThis.ASCMImporter;
const importedAt = "2026-10-17T12:00:00.000Z";
const policy = { version: 1, allowUpdates: true, protected: [] };
const copy = value => structuredClone(value);
const row = (patch = {}) => ({ sourceRow: 2, category: "Headset", basePn: "A1AAA", description: "HyperX Cloud III BLK GAM HS", codeName: "Harvester", featureId: "F1", localFlag: "N", ga: "2026-07-20", em: "2029-12-31", ...patch });
const dataset = (rows = [row()], patch = {}) => ({ version: 1, rows, metadata: { fileName: "ASCM Report_HyperX_2026-10-01.xlsx", invalidRowsFiltered: 0, invalidLocalRowsFiltered: 0, duplicateBasePnRows: 0, localizedRowsFiltered: 0, ...patch }, diagnostics: [] });
function fixture() {
  return {
    version: 2, imageAssets: [{ id: "main", bytes: "private-image-data" }], customRoot: { preserve: true },
    categories: [
      { id: "pc-gaming-audio", customCategory: true, board: { customBoard: "keep", lanes: [{ id: "wired" }, { id: "wireless" }], products: [
        { id: "cloud", name: "Curated Cloud III", codename: "User codename", price: 119, tier: "Premium", statusType: "discontinued", statusLabel: "Discontinued", laneId: "wired", order: 4, generalAvailabilityDate: "2026-03-20", endManufacturingDate: "2028-12-31", imageAssetId: "main", customProduct: { preserve: [1, 2] }, manualPosition: { x: 60 }, roadmap: { startMonth: "2026-03", launchMonth: "2026-03", endMonth: "2028-12", status: "end-of-life", family: "User family", confidence: "high", notes: "Keep roadmap notes" }, specs: [{ id: "driver", label: "Driver", value: "53 mm", custom: "keep" }], partSkus: [{ id: "hp1", code: "A1AAA", custom: "keep" }], variantGroups: [{ id: "colors", type: "color", label: "Custom colors", custom: "keep", items: [{ id: "black", code: "BK", colorKey: "black", colorName: "User Black", colorHex: "#111111", imageAssetId: "main", custom: "keep" }] }], ascm: { key: "pc-gaming-audio:cloud iii", sourceFile: "ASCM Report_HyperX_2026-09-01.xlsx", basePartNumbers: ["A1AAA", "OLD01"], records: [{ basePartNumber: "OLD01", fullProductName: "Older accepted SKU", custom: "keep" }], custom: "keep" } },
        { id: "absent", name: "Source absent product", laneId: "wired", order: 17, customProduct: "untouched" },
      ] } },
      { id: "mice", board: { lanes: [{ id: "wired" }, { id: "wireless" }], products: [] } },
      { id: "accessories", board: { lanes: [{ id: "parts" }, { id: "accessories" }], products: [] } },
    ],
    ascmSnapshot: { sourceFile: "ASCM Report_HyperX_2026-09-01.xlsx", importedAt: "2026-09-02T12:00:00Z", basePartNumbers: ["A1AAA", "OLD01"] },
  };
}
const plan = (manifest = fixture(), report = dataset(), options = {}) => planAscmImport({ manifest, dataset: report, reportDate: "2026-10-01", importedAt, requestId: "ascm-fixture-request", datePolicy: policy, ...options });
const products = result => result.manifest.categories.flatMap(category => category.board.products);
function hold(action, code) {
  assert.throws(action, error => error instanceof AscmReviewError && error.code === code, `expected ${code} review hold`);
}

test("safe import records canonical date revisions and preserves raw assets, custom fields, explicit status and numeric lane gaps", () => {
  // Removing canonical merge or replacing raw records would lose history or user data.
  const manifest = fixture(), original = copy(manifest);
  const report = dataset([row(), row({ sourceRow: 3, basePn: "A1AAB", description: "HyperX Cloud III WHT GAM HS" })]);
  const result = plan(manifest, report), saved = products(result).find(product => product.id === "cloud");
  assert.equal(result.changed, true);
  assert.equal(saved.generalAvailabilityDate, "2026-07-20");
  assert.equal(saved.endManufacturingDate, "2029-12-31");
  assert.equal(saved.roadmap.startMonth, "2026-07");
  assert.equal(saved.roadmap.launchMonth, "2026-07");
  assert.equal(saved.roadmap.endMonth, "2029-12");
  for (const field of ["name", "codename", "price", "statusType", "statusLabel", "imageAssetId", "customProduct", "manualPosition", "specs"]) assert.deepEqual(saved[field], original.categories[0].board.products[0][field]);
  assert.equal(saved.roadmap.status, "end-of-life");
  assert.equal(saved.roadmap.notes, "Keep roadmap notes");
  assert.deepEqual(saved.partSkus.map(item => item.code), ["A1AAA", "A1AAB"]);
  assert.equal(saved.partSkus[0].custom, "keep");
  assert.equal(saved.variantGroups[0].items[0].imageAssetId, "main");
  assert.equal(saved.variantGroups[0].items[0].colorName, "User Black");
  assert.equal(saved.variantGroups[0].custom, "keep");
  assert.equal(saved.variantGroups[0].items[1].code, "WHT");
  assert.deepEqual(saved.ascm.basePartNumbers, ["A1AAA", "A1AAB", "OLD01"]);
  assert.equal(saved.ascm.records.find(item => item.basePartNumber === "OLD01").custom, "keep");
  assert.equal(saved.ascm.custom, "keep");
  assert.deepEqual(result.manifest.imageAssets, original.imageAssets);
  assert.deepEqual(result.manifest.customRoot, original.customRoot);
  assert.deepEqual(products(result).find(product => product.id === "absent"), original.categories[0].board.products[1]);
  assert.deepEqual(result.manifest.categories[0].board.products.map(product => product.order), [4, 17]);
  assert(result.savedFields >= 4);
  assert.equal(result.savedProducts, 1);
  assert(result.manifest.masterSync.history.some(record => record.path === "@launch" && record.requestId === "ascm-fixture-request"));
  assert(result.manifest.masterSync.history.some(record => record.path === "@end"));
  assert.equal(result.manifest.masterSync.products.cloud.dateEdits.generalAvailabilityDate.at, importedAt);
  assert.deepEqual(manifest, original, "planning must be pure");
});

test("new products append deterministically and never renumber existing orders", () => {
  // Replacing max+1 with lane length or random IDs breaks stable placement/retry identity.
  const report = dataset([row({ basePn: "NEW01", description: "HyperX Cloud IV BLK GAM HS" }), row({ sourceRow: 3, category: "Mouse", basePn: "MOUSE1", description: "HyperX Pulsefire Alpha BLK GAM MS" })]);
  const result = plan(fixture(), report, { datePolicy: undefined });
  const next = products(result), cloud = next.find(product => product.name === "HyperX Cloud IV");
  assert(cloud);
  assert.equal(cloud.order, 18);
  assert.equal(cloud.laneId, "wired");
  assert.equal(cloud.generalAvailabilityDate, "2026-07-20");
  assert.equal(cloud.codename, "Harvester");
  assert.equal(cloud.roadmap.startMonth, "2026-07");
  assert.deepEqual(next.filter(product => ["cloud", "absent"].includes(product.id)).map(product => product.order), [4, 17]);
  assert.deepEqual(next.map(product => product.id), products(plan(fixture(), report, { requestId: "another-request" })).map(product => product.id));
  assert.equal(result.summary.added, 2);
  assert.equal(result.savedProducts, 2);
  assert.equal(result.manifest.masterSync.history.filter(record => record.kind === "create").length, 2);
});

test("unknown or invalid date policy holds the whole report before any addition", () => {
  for (const datePolicy of [undefined, null, {}, { version: 1, allowUpdates: false, protected: [] }, { version: 1, allowUpdates: true }, { version: 1, allowUpdates: true, protected: [{ productId: "cloud", fields: ["typo"] }] }]) {
    const manifest = fixture(), original = copy(manifest);
    hold(() => plan(manifest, dataset([row(), row({ sourceRow: 3, category: "Mouse", basePn: "MOUSE1", description: "HyperX New Mouse" })]), { datePolicy }), "DATE_POLICY_REQUIRED");
    assert.deepEqual(manifest, original);
  }
});

test("protected GA or EM changes hold atomically while unprotected fields can update", () => {
  for (const field of ["generalAvailabilityDate", "endManufacturingDate"]) hold(() => plan(fixture(), dataset(), { datePolicy: { ...policy, protected: [{ productId: "cloud", fields: [field] }] } }), "PROTECTED_DATE");
  const result = plan(fixture(), dataset([row({ ga: "2026-03-20" })]), { datePolicy: { ...policy, protected: [{ productId: "cloud", fields: ["generalAvailabilityDate"] }] } });
  assert.equal(products(result)[0].endManufacturingDate, "2029-12-31");
});

test("blank source dates preserve existing dates and need no date update authorization", () => {
  const result = plan(fixture(), dataset([row({ ga: "", em: "" })]), { datePolicy: undefined });
  const saved = products(result)[0];
  assert.equal(saved.generalAvailabilityDate, "2026-03-20");
  assert.equal(saved.endManufacturingDate, "2028-12-31");
  assert.equal(saved.roadmap.startMonth, "2026-03");
  assert.equal(saved.roadmap.endMonth, "2028-12");
  assert.equal(result.savedFields, 0);
  assert.equal(result.changed, true, "new source evidence is still a persisted report");
});

test("new products with missing lifecycle dates hold the whole report instead of inventing launched status", () => {
  // Removing this gate would create a new product without enough source lifecycle evidence.
  for (const dates of [{ ga: "" }, { em: "" }, { ga: "", em: "" }]) {
    const manifest = fixture(), original = copy(manifest);
    const report = dataset([row(), row({ sourceRow: 3, basePn: "NEW01", description: "HyperX Cloud IV BLK GAM HS", ...dates })]);
    hold(() => plan(manifest, report), "INCOMPLETE_NEW_PRODUCT");
    assert.deepEqual(manifest, original, "a later incomplete addition also holds earlier matched updates");
  }
});

test("an identical planner retry with identical evidence is unchanged", () => {
  const first = plan();
  const second = plan(first.manifest);
  assert.equal(second.changed, false);
  assert.equal(second.savedFields, 0);
  assert.equal(second.savedProducts, 0);
  assert.deepEqual(second.manifest, first.manifest);
});

test("older accepted snapshot or any product source date holds even when product is absent from the report", () => {
  for (const location of ["snapshot", "product"]) {
    const manifest = fixture();
    if (location === "snapshot") manifest.ascmSnapshot.sourceFile = "ASCM Report_HyperX_2026-11-01.xlsx";
    else manifest.categories[0].board.products[1].ascm = { sourceFile: "ASCM Report_HyperX_2026-11-01.xlsx" };
    hold(() => plan(manifest), "STALE_REPORT");
  }
});

test("ambiguous identity, duplicated group target and category relocation hold the report", () => {
  const ambiguous = fixture();
  ambiguous.categories[0].board.products.push({ ...copy(ambiguous.categories[0].board.products[0]), id: "duplicate" });
  hold(() => plan(ambiguous), "AMBIGUOUS_MATCH");
  const duplicatedTarget = dataset([row(), row({ sourceRow: 3, basePn: "A1AAB", description: "HyperX Cloud IV BLK GAM HS" })]);
  const target = fixture(); target.categories[0].board.products[0].partSkus.push({ id: "second", code: "A1AAB" });
  hold(() => plan(target, duplicatedTarget), "DUPLICATE_MATCH");
  hold(() => plan(fixture(), dataset([row({ category: "Mouse", description: "HyperX Pulsefire Example BLK GAM MS" })])), "CATEGORY_RELOCATION");
});

test("unmapped source category, missing target category and incompatible destination lane hold", () => {
  hold(() => plan(fixture(), dataset([row({ category: "Unmapped" })])), "INCOMPATIBLE_MAPPING");
  const noCategory = fixture(); noCategory.categories = noCategory.categories.filter(category => category.id !== "pc-gaming-audio");
  hold(() => plan(noCategory), "INCOMPATIBLE_MAPPING");
  const noLane = fixture(); noLane.categories[1].board.lanes = [{ id: "unrelated" }];
  hold(() => plan(noLane, dataset([row({ category: "Mouse", basePn: "MOUSE1", description: "HyperX Pulsefire Example BLK GAM MS" })])), "INCOMPATIBLE_MAPPING");
});

test("malformed rows, dates and descending lifecycle dates hold instead of silently disappearing", () => {
  for (const patch of [{ basePn: "" }, { description: "" }, { category: "" }, { ga: "not-a-date" }, { ga: "2026-02-30" }, { em: "2026-01-01" }, { basePn: "bad pn" }, { localFlag: "X" }]) hold(() => plan(fixture(), dataset([row(patch)])), "MALFORMED_REPORT");
  hold(() => plan(fixture(), dataset([])), "MALFORMED_REPORT");
  hold(() => plan(fixture(), dataset([row(), row({ sourceRow: 3 })])), "MALFORMED_REPORT");
});

test("parser filtering diagnostics hold invalid and duplicate primary rows but allow intentional localized filtering", () => {
  for (const field of ["invalidRowsFiltered", "invalidLocalRowsFiltered", "duplicateBasePnRows"]) hold(() => plan(fixture(), dataset([row()], { [field]: 1 })), "MALFORMED_REPORT");
  const report = dataset([row()], { localizedRowsFiltered: 8 });
  assert.equal(plan(fixture(), report).changed, true);
  report.diagnostics = [{ level: "error", code: "INVALID_REQUIRED_VALUE" }];
  hold(() => plan(fixture(), report), "MALFORMED_REPORT");
  for (const code of ["MULTIPLE_ASCM_SHEETS", "INVALID_LOCAL_FLAG", "DUPLICATE_BASE_PN"]) {
    const warning = dataset(); warning.diagnostics = [{ level: "warning", code }];
    hold(() => plan(fixture(), warning), "MALFORMED_REPORT");
  }
});

test("real workbook parser diagnostics cannot bypass the whole-report hold", async () => {
  const xmlText = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const table = [Object.values(importer.REQUIRED_HEADERS), ["Headset", "A1AAA", "HyperX Cloud III BLK GAM HS", "2026-07-20", "2029-12-31"], ["Headset", "BAD01", "Invalid date product", "2026-02-30", "2029-12-31"]];
  const rows = table.map((values, index) => `<row r="${index + 1}">${values.map((value, column) => `<c r="${String.fromCharCode(65 + column)}${index + 1}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`).join("")}</row>`).join("");
  const entries = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ASCM" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
  };
  const bytes = globalThis.PortfolioPackage.createZip(Object.entries(entries).map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })));
  const parsed = await importer.parseAscmWorkbook(bytes);
  parsed.metadata.fileName = "ASCM Report_HyperX_2026-10-01.xlsx";
  assert.equal(parsed.metadata.invalidRowsFiltered, 1);
  hold(() => plan(fixture(), parsed), "MALFORMED_REPORT");
});

test("deterministic creation ID collisions with tombstones are held rather than resurrected", () => {
  const report = dataset([row({ basePn: "NEW01", description: "HyperX Cloud IV BLK GAM HS" })]);
  const id = products(plan(fixture(), report)).find(product => product.name === "HyperX Cloud IV").id;
  const manifest = fixture();
  manifest.masterSync = { version: 1, revision: 3, products: { [id]: { deleted: true, revisions: { "@product": 3 } } } };
  hold(() => plan(manifest, report), "PRODUCT_ID_COLLISION");
  const active = fixture(); active.categories[0].board.products.push({ id, name: "Another curated identity", laneId: "wired", order: 18 });
  hold(() => plan(active, report), "PRODUCT_ID_COLLISION");
});

test("more than 500 grouped products hold rather than chunk into partial reports", () => {
  const rows = Array.from({ length: 501 }, (_, index) => row({ sourceRow: index + 2, basePn: `NEW${index}`, description: `HyperX Product ${index} BLK GAM HS` }));
  hold(() => plan(fixture(), dataset(rows)), "TOO_MANY_GROUPS");
});

test("exactly 500 new product groups can be committed as one transaction", () => {
  const rows = Array.from({ length: 500 }, (_, index) => row({ sourceRow: index + 2, basePn: `NEW${index}`, description: `HyperX Product ${index} BLK GAM HS` }));
  const result = plan(fixture(), dataset(rows));
  assert.equal(result.summary.added, 500);
  assert.equal(result.savedProducts, 500);
  assert.equal(products(result).length, 502);
  assert.equal(result.manifest.masterSync.revision, 500);
  assert.equal(Object.values(result.manifest.masterSync.products).filter(metadata => metadata.creationRequestId === "ascm-fixture-request").length, 500);
});

test("invalid request identity, timestamps and inconsistent filename dates hold", () => {
  for (const options of [{ requestId: "" }, { importedAt: "yesterday" }, { importedAt: "2026-10-17T24:00:00Z" }, { reportDate: "2026-02-30" }, { reportDate: "2026-09-01" }]) hold(() => plan(fixture(), dataset(), options), "MALFORMED_REPORT");
});

test("normalized dataset row provenance and optional fields reject malformed values", () => {
  for (const patch of [{ sourceRow: -1 }, { sourceRow: 1.5 }, { featureId: {} }, { codeName: [] }, { localCode: {} }]) hold(() => plan(fixture(), dataset([row(patch)])), "MALFORMED_REPORT");
});

test("metadata-only source updates still reject impossible clock times", () => {
  hold(() => plan(fixture(), dataset([row({ ga: "", em: "" })]), { importedAt: "2026-10-17T24:00:00Z", datePolicy: undefined }), "MALFORMED_REPORT");
});

test("same HP SKU in PC and Console portfolios remains two independent listings", () => {
  const manifest = fixture();
  manifest.categories.push({ id: "console-gaming-audio", board: { lanes: [{ id: "wired" }, { id: "wireless" }], products: [] } });
  const report = dataset([row(), row({ sourceRow: 3, description: "HyperX Cloud III PS BLK GAM HS" })]);
  const result = plan(manifest, report);
  assert.equal(result.summary.added, 1);
  assert.equal(result.manifest.categories.find(category => category.id === "console-gaming-audio").board.products.length, 1);
  assert.equal(products(result).find(product => product.id === "cloud").generalAvailabilityDate, "2026-07-20");
  assert.equal(model.snapshot(result.manifest).products.length, 3);
});
