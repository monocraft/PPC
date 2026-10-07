import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

await import("../../public/js/ascm-import.js");
await import("../../public/js/package-codec.js");

const importer = globalThis.ASCMImporter;
assert.ok(importer, "ASCM importer should register on globalThis");

const rows = [
  {
    sourceRow: 14,
    category: "Headset",
    basePn: "A1AAA",
    featureId: "F-1",
    localFlag: "N",
    description: "HyperX Cloud III BLK GAM HS",
    codeName: "Harvester BLK",
    ga: "2026-01-15",
    em: "2029-12-31",
  },
  {
    sourceRow: 15,
    category: "Headset",
    basePn: "A1AAB",
    featureId: "F-2",
    localFlag: "N",
    description: "HyperX Cloud III WHT-PNK GAM HS",
    codeName: "Harvester WHT",
    ga: "2026-02-01",
    em: "2030-03-31",
  },
  {
    sourceRow: 16,
    category: "Mouse",
    basePn: "B2AAA",
    featureId: "F-3",
    localFlag: "N",
    description: "HyperX PF Has 2 WD BK Gm Ms",
    codeName: "Pulse",
    ga: "2025-04-01",
    em: "2028-06-30",
  },
  {
    sourceRow: 17,
    category: "Mouse",
    basePn: "B2AAB",
    featureId: "F-4",
    localFlag: "N",
    description: "HyperX PF Has 2 WD WHT Gm Ms",
    codeName: "Pulse",
    ga: "2025-04-15",
    em: "2028-09-30",
  },
  {
    sourceRow: 18,
    category: "Headset",
    basePn: "C3AAA",
    featureId: "F-5",
    localFlag: "N",
    description: "HyperX Cloud Mini WL BLU GAM HS",
    codeName: "Mini",
    ga: "2026-05-01",
    em: "2029-05-31",
  },
];

const groups = importer.buildProductGroups({ rows });
assert.equal(groups.length, 3, "color SKUs should collapse into product families");

const cloud = groups.find((group) => group.normalizedName === "cloud iii");
assert.ok(cloud, "Cloud III group should be derived");
assert.deepEqual(cloud.basePns, ["A1AAA", "A1AAB"]);
assert.equal(cloud.gaDate, "2026-01-15");
assert.equal(cloud.emDate, "2030-03-31");
assert.deepEqual(cloud.colorVariants.map((item) => item.canonicalCode), ["BK", "WHT/PNK"]);

const haste = groups.find((group) => group.normalizedName === "pulsefire haste 2");
assert.ok(haste, "abbreviated ASCM names should normalize to a portfolio name");
assert.equal(haste.categoryId, "mice");
assert.deepEqual(haste.colorVariants.map((item) => item.canonicalCode), ["BK", "WHT"]);

const mini = groups.find((group) => group.normalizedName === "cloud mini wireless");
assert.ok(mini, "wireless abbreviation should be preserved as product identity");
assert.equal(mini.categoryId, "lifestyle-audio");
assert.equal(mini.laneId, "wireless");
assert.equal(importer.helpers.mapAscmCategory("Headset", "HyperX Cloud Stinger 3 PS"), "console-gaming-audio");

assert.equal(importer.helpers.inferColorVariant("HyperX wired mouse"), null, "wired must not be inferred as red");
assert.equal(importer.helpers.inferColorVariant("HyperX Mouse FRS")?.colorName, "Frost");
assert.equal(importer.helpers.normalizeColorCode("BLK/RED"), "BK/RED");
assert.equal(importer.helpers.normalizeColorCode("BLACK"), "BK");
assert.equal(importer.helpers.normalizeColorCode("FROST"), "FRS");
assert.equal(importer.helpers.normalizeColorCode("8-BIT"), "8-BIT", "non-color variants must remain distinct");

const portfolio = {
  categories: [
    {
      id: "pc-gaming-audio",
      board: {
        products: [{
          id: "cloud-iii",
          name: "Cloud III",
          ascm: { basePartNumbers: ["A1AAA"] },
        }],
      },
    },
  ],
};
const match = importer.matchProductGroup(cloud, portfolio);
assert.equal(match.status, "matched");
assert.equal(match.method, "base-pn");
assert.equal(match.product.id, "cloud-iii");

const nameOnlyMatch = importer.matchProductGroup(
  { ...cloud, basePns: [], ascmKey: "different-key" },
  portfolio,
);
assert.equal(nameOnlyMatch.status, "matched");
assert.equal(nameOnlyMatch.method, "normalized-name");

const consolePortfolio = {
  categories: [{
    id: "console-gaming-audio",
    board: {
      products: [
        { id: "ps-stinger", name: "Cloud Stinger 3", specs: [{ label: "Platform", value: "Playstation" }] },
        { id: "xbox-stinger", name: "CloudX Stinger 3", specs: [{ label: "Platform", value: "Xbox" }] },
        { id: "ps-core-wireless", name: "Cloud Stinger Core Wireless PS", specs: [{ label: "Platform", value: "Playstation" }] },
        { id: "xbox-core-wireless", name: "CloudX Stinger Core Wireless Xbox", specs: [{ label: "Platform", value: "Xbox" }] },
      ],
    },
  }],
};
const platformMatch = importer.matchProductGroup({
  categoryId: "console-gaming-audio",
  displayName: "HyperX Cloud Stinger 3 PS",
  normalizedName: importer.helpers.normalizeProductName("HyperX Cloud Stinger 3 PS"),
  basePns: ["C4AAA"],
  records: [{ description: "HyperX Cloud Stinger 3 PS BLK GAM HS" }],
}, consolePortfolio);
assert.equal(platformMatch.status, "matched");
assert.equal(platformMatch.method, "platform-name");
assert.equal(platformMatch.product.id, "ps-stinger");
assert.equal(importer.helpers.normalizeProductName("HX CLST 2 Core PS"), "cloud stinger 2 core ps");

const legacyPsMatch = importer.matchProductGroup({
  categoryId: "console-gaming-audio",
  displayName: "HyperX Stinger Core W PS5 - /G",
  normalizedName: importer.helpers.normalizeProductName("HyperX Stinger Core W PS5 - /G"),
  basePns: ["C4AAB"],
  records: [{ description: "HyperX Stinger Core W PS5 - /G" }],
}, consolePortfolio);
assert.equal(legacyPsMatch.status, "matched");
assert.equal(legacyPsMatch.product.id, "ps-core-wireless");

const legacyXboxMatch = importer.matchProductGroup({
  categoryId: "console-gaming-audio",
  displayName: "HyperX CloudX Stinger C W - /G",
  normalizedName: importer.helpers.normalizeProductName("HyperX CloudX Stinger C W - /G"),
  basePns: ["C4AAC"],
  records: [{ description: "HyperX CloudX Stinger C W - /G" }],
}, consolePortfolio);
assert.equal(legacyXboxMatch.status, "matched");
assert.equal(legacyXboxMatch.product.id, "xbox-core-wireless");

const curatedProduct = {
  id: "curated-cloud",
  name: "Curated Cloud III",
  price: 149.99,
  priceLabel: "US MSRP",
  imageAssetId: "hero-image",
  featuredVariantId: "black-variant",
  codename: "Manual code name",
  tier: "Hero",
  ffsDate: "2025-08-01",
  generalAvailabilityDate: "2025-10-01",
  endManufacturingDate: "2031-12-31",
  specs: [
    { id: "spec-one", label: "Driver", value: "53 mm", customNote: "Keep this field" },
    { id: "spec-two", label: "Battery", value: "120 hours" },
  ],
  roadmap: {
    family: "Manual family",
    startMonth: "2025-10",
    endMonth: "2031-12",
    status: "embargo",
    notes: "Curated roadmap notes",
  },
  partSkus: [
    { id: "black-part", code: "A1AAA", customNote: "Keep exact SKU record" },
    { id: "missing-part", code: "OLD123" },
    { id: "manual-part", code: "MANUAL123" },
  ],
  variantGroups: [
    {
      id: "colors",
      type: "color",
      label: "Curated colors",
      customSetting: true,
      items: [
        { id: "black-variant", code: "BLACK", colorKey: "black", colorName: "Midnight Black", colorHex: "#161616", imageAssetId: "black-image" },
        { id: "blue-variant", code: "BLU", colorKey: "blue", colorName: "Blue", colorHex: "#2f6fa2", imageAssetId: "blue-image" },
        { id: "manual-variant", code: "8-BIT", colorKey: "custom", colorName: "Limited edition", colorHex: "#888888", imageAssetId: "edition-image" },
      ],
    },
    { id: "layouts", type: "layout", label: "Layouts", items: [{ id: "us-layout", code: "US", label: "United States" }] },
  ],
  ascm: {
    key: cloud.ascmKey,
    basePartNumbers: ["A1AAA", "OLD123"],
    colorCodes: ["BK", "BLU"],
    records: [
      { basePartNumber: "A1AAA", fullProductName: "Older black description", colorCode: "BK", generalAvailabilityDate: "2025-10-01" },
      { basePartNumber: "OLD123", fullProductName: "Older blue description", colorCode: "BLU", generalAvailabilityDate: "2024-01-01" },
    ],
  },
  arbitraryManualData: { keep: true },
};

const originalProduct = structuredClone(curatedProduct);
const originalGroup = structuredClone(cloud);
let generatedIds = 0;
const updateOptions = {
  datasetMetadata: { fileName: "Updated ASCM.xlsx", exportedAt: "2026-09-23" },
  importedAt: "2026-10-06T00:00:00.000Z",
  createId: () => `generated-${++generatedIds}`,
};
const updatedProduct = importer.mergeProductGroup(curatedProduct, cloud, updateOptions);
assert.deepEqual(curatedProduct, originalProduct, "merging must not mutate the original portfolio product");
assert.deepEqual(cloud, originalGroup, "merging must not mutate the parsed group");
for (const field of ["id", "name", "price", "priceLabel", "imageAssetId", "featuredVariantId", "codename", "tier", "ffsDate", "specs", "roadmap", "arbitraryManualData"]) {
  assert.deepEqual(updatedProduct[field], originalProduct[field], `ASCM must preserve curated ${field}`);
}
assert.equal(updatedProduct.generalAvailabilityDate, cloud.gaDate, "nonempty imported GA should update the source date");
assert.equal(updatedProduct.endManufacturingDate, cloud.emDate, "nonempty imported EM should update the source date");
assert.deepEqual(updatedProduct.partSkus.slice(0, 3), originalProduct.partSkus, "existing SKU identities and metadata must survive");
assert.equal(updatedProduct.partSkus.filter((item) => item.code === "A1AAA").length, 1, "matched Base PN must not duplicate a SKU");
assert.ok(updatedProduct.partSkus.some((item) => item.code === "A1AAB"), "new Base PN should be added");
assert.ok(updatedProduct.partSkus.some((item) => item.code === "OLD123"), "missing prior imported Base PN must remain");
assert.deepEqual(updatedProduct.variantGroups[0].items.slice(0, 3), originalProduct.variantGroups[0].items, "saved colors and their images must remain unchanged");
assert.equal(updatedProduct.variantGroups[0].label, "Curated colors", "manual group labels must survive");
assert.equal(updatedProduct.variantGroups[0].customSetting, true, "manual group fields must survive");
assert.deepEqual(updatedProduct.variantGroups[1], originalProduct.variantGroups[1], "non-color variants must survive");
assert.equal(updatedProduct.variantGroups[0].items.length, 4, "canonical color aliases must merge without duplicating the black variant");
assert.ok(updatedProduct.ascm.basePartNumbers.includes("OLD123"), "omitted prior part-number links must remain");
assert.ok(updatedProduct.ascm.records.some((record) => record.basePartNumber === "OLD123" && record.colorCode === "BLU"), "omitted source records must retain SKU-to-color links");
assert.equal(updatedProduct.ascm.records.find((record) => record.basePartNumber === "A1AAA").fullProductName, cloud.records.find((record) => record.basePn === "A1AAA").description);
assert.equal(updatedProduct.ascm.sourceFile, updateOptions.datasetMetadata.fileName);
assert.deepEqual(importer.mergeProductGroup(updatedProduct, cloud, updateOptions), updatedProduct, "re-importing the same report must be idempotent");

const blankGroup = {
  ...cloud,
  basePns: ["A1AAA"],
  colorVariants: [],
  gaDate: "",
  emDate: "",
  records: [{ basePn: "A1AAA", description: "", ga: "", em: "", colorCode: "" }],
};
const afterBlankReport = importer.mergeProductGroup(updatedProduct, blankGroup, updateOptions);
assert.equal(afterBlankReport.generalAvailabilityDate, updatedProduct.generalAvailabilityDate, "blank GA must not clear the saved date");
assert.equal(afterBlankReport.endManufacturingDate, updatedProduct.endManufacturingDate, "blank EM must not clear the saved date");
assert.deepEqual(afterBlankReport.specs, originalProduct.specs, "a partial report must retain all specifications");
assert.deepEqual(afterBlankReport.variantGroups, updatedProduct.variantGroups, "an empty imported color list must retain every color and image");
assert.deepEqual(afterBlankReport.partSkus, updatedProduct.partSkus, "a partial report must retain every HP SKU");
const blankBlackRecord = afterBlankReport.ascm.records.find((record) => record.basePartNumber === "A1AAA");
const priorBlackRecord = updatedProduct.ascm.records.find((record) => record.basePartNumber === "A1AAA");
for (const field of ["fullProductName", "generalAvailabilityDate", "endManufacturingDate", "colorCode"]) {
  assert.equal(blankBlackRecord[field], priorBlackRecord[field], `blank source ${field} must retain its saved value`);
}

const invalidDateUpdate = importer.mergeProductGroup(curatedProduct, {
  ...blankGroup,
  gaDate: "2026-02-30",
  emDate: "invalid",
}, updateOptions);
assert.equal(invalidDateUpdate.generalAvailabilityDate, curatedProduct.generalAvailabilityDate, "invalid GA must not clear a saved date");
assert.equal(invalidDateUpdate.endManufacturingDate, curatedProduct.endManufacturingDate, "invalid EM must not clear a saved date");

const legacyVariants = { ...curatedProduct, variantGroups: undefined, skus: [{ id: "legacy-blue", code: "BLU", colorName: "Blue", imageAssetId: "legacy-blue-image" }] };
const mergedLegacyVariants = importer.mergeProductGroup(legacyVariants, cloud, updateOptions);
assert.ok(mergedLegacyVariants.variantGroups[0].items.some((item) => item.id === "legacy-blue" && item.imageAssetId === "legacy-blue-image"), "legacy SKU image references must survive conversion");

// Exercise the application's actual plan/upsert/schema functions in isolation.
// Only rendering/category activation is replaced; imports still traverse the
// real board and portfolio normalizers used by the browser.
await import("../../public/js/portfolio-model.js");
const appSource = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
function appFunctionSource(name) {
  const definition = appSource.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, "m"));
  assert.ok(definition, `App integration fixture requires the actual ${name} function`);
  return definition[0];
}
const sandbox = {
  window: {},
  ASCMImporter: importer,
  PortfolioModel: globalThis.PortfolioModel,
  PortfolioPackage: globalThis.PortfolioPackage,
  PPTXPagination: { paginateRoadmapGroups: () => [] },
  crypto: globalThis.crypto,
  alert: () => {},
  editorElements: {},
  editorRows: [],
};
vm.createContext(sandbox);
new vm.Script(await readFile(new URL("../../public/js/catalog-data.js", import.meta.url), "utf8")).runInContext(sandbox);
const testedFunctions = [
  "id", "ensureImageAssetRegistry", "migrateLegacyProductImages", "standardColorByKey", "inferStandardColor",
  "variantGroup", "normalizeColorVariant", "normalizeLayoutVariant", "normalizeVariantGroup", "productVariantGroups",
  "productColorVariants", "colorVariantById", "colorVariantWithImage", "makeRoadmap", "monthStringFromDate",
  "monthIndex", "monthString", "addMonths", "normalizeMonth", "categoryDefinition", "normalizeRoadmapStatus",
  "inferFamily", "defaultRoadmapForProduct", "normalizeProductInfoDate", "normalizeAscmRecord",
  "normalizeAscmProductMetadata", "normalizeAscmSnapshot", "normalizePartSku", "ensureBoardSchema", "standardizedStatus",
  "catalogImageAssetId", "catalogImageAssets", "packageCodec", "ensurePortfolioSchema", "parseHexColor", "normalizeHexColor", "clonePortfolioData",
  "ascmGroupBasePartNumbers", "ascmGroupDates", "ascmRecordSignature", "ascmProductNeedsUpdate", "buildAscmImportPlan",
  "ascmRoadmapStatus", "applyAscmGroupToProduct", "ascmProductId", "findPortfolioProductLocation", "applyAscmImportPlan",
  "normalizeOrdersForBoard", "makeProduct",
  "selectedProduct", "categorySpecSets", "defaultSpecificationsForCategory", "spec", "updateBoard", "updateProduct", "updateRoadmap",
];
const specBindingStart = appSource.indexOf('  $("#addSpec").onclick =');
const specBindingEnd = appSource.indexOf('  $("#addVariantGroup").onclick =', specBindingStart);
assert.ok(specBindingStart >= 0 && specBindingEnd > specBindingStart, "Spec editor regression requires the actual binding block");
const specBindingSource = appSource.slice(specBindingStart, specBindingEnd);
const appFixtureSource = `${appSource.slice(0, appSource.indexOf("const $ ="))}
  let portfolio, board, selectedId;
  let activeCategoryId = "pc-gaming-audio";
  const SAMPLE_ROADMAP = {};
  const pendingLegacyImageBlobs = [];
  const $ = (selector) => globalThis.editorElements[selector] || null;
  const inspector = { querySelectorAll() { return globalThis.editorRows; } };
  function scheduleSave() {}
  function syncControls() {}
  function renderInspector() {}
  function renderActiveView() {}
  ${testedFunctions.map(appFunctionSource).join("\n")}
  function activateCategory(categoryId) {
    activeCategoryId = categoryId;
    portfolio.activeCategoryId = categoryId;
    const category = portfolio.categories.find((item) => item.id === categoryId);
    board = ensureBoardSchema(category.board, categoryDefinition(categoryId));
    selectedId = board.products[0]?.id ?? null;
  }
  globalThis.integration = {
    load(value) { portfolio = ensurePortfolioSchema(value); activateCategory(portfolio.activeCategoryId); },
    state() { return JSON.parse(JSON.stringify(portfolio)); },
    plan: buildAscmImportPlan,
    apply: applyAscmImportPlan,
    needsUpdate: ascmProductNeedsUpdate,
    edit(patch) { updateProduct(selectedId, patch, false); },
    moveSlot(patch) { updateRoadmap(selectedId, patch, false); },
    bindSpecEditor() {
      const product = selectedProduct();
      ${specBindingSource}
    },
  };
`;
new vm.Script(appFixtureSource, { filename: "actual-app-import-functions.js" }).runInContext(sandbox);
const integration = {
  ...sandbox.integration,
  // Materialize snapshots in this realm so strict assertions compare values
  // rather than the vm's distinct Array/Object prototypes.
  state: () => JSON.parse(JSON.stringify(sandbox.integration.state())),
};
const seed = {
  version: 4,
  activeCategoryId: "pc-gaming-audio",
  settings: { timeline: { startMonth: "2026-01", endMonth: "2030-12" } },
  imageAssets: ["hero-image", "black-image", "blue-image", "edition-image"].map((id) => ({
    id, sourceType: "local", name: id, mimeType: "image/png", size: 42,
  })),
  categories: sandbox.window.PORTFOLIO_CATALOG.categories.map((category) => ({
    id: category.id,
    name: category.name,
    board: {
      lanes: structuredClone(category.lanes),
      settings: {},
      products: category.id === "pc-gaming-audio" ? [{ ...structuredClone(curatedProduct), laneId: category.lanes[0].id, order: 0 }] : [],
    },
  })),
};
integration.load(seed);
const normalizedOriginal = integration.state();
const normalizedOriginalProduct = normalizedOriginal.categories[0].board.products[0];
const integrationDataset = { rows: [rows[0], rows[1]], metadata: updateOptions.datasetMetadata };
const integrationPlan = integration.plan(integrationDataset);
assert.equal(integrationPlan.items.length, 1);
assert.equal(integrationPlan.items[0].matchedProductId, curatedProduct.id, "real planning must resolve the existing product rather than creating a replacement");
const applied = integration.apply(integrationPlan);
assert.equal(applied.updated, 1);
assert.equal(applied.added, 0);
const integratedState = integration.state();
const integratedProduct = integratedState.categories[0].board.products[0];
for (const field of ["id", "name", "price", "priceLabel", "imageAssetId", "featuredVariantId", "codename", "tier", "ffsDate", "specs", "arbitraryManualData"]) {
  assert.deepEqual(integratedProduct[field], normalizedOriginalProduct[field], `full application import must preserve ${field} through schema normalization`);
}
assert.deepEqual(integratedState.imageAssets, normalizedOriginal.imageAssets, "applying an ASCM plan must leave the image registry intact");
assert.equal(integratedProduct.roadmap.status, normalizedOriginalProduct.roadmap.status, "full import must retain curated roadmap status");
assert.equal(integratedProduct.roadmap.notes, normalizedOriginalProduct.roadmap.notes, "full import must retain curated roadmap notes");
assert.ok(integratedProduct.variantGroups.flatMap((group) => group.items).some((item) => item.id === "blue-variant" && item.imageAssetId === "blue-image"), "full import must preserve missing imported variants and their image links");
assert.ok(integratedProduct.partSkus.some((item) => item.code === "OLD123"), "full import must preserve omitted prior HP SKUs");
assert.equal(integration.plan(integrationDataset).items[0].action, "unchanged", "real preview must recognize a repeated additive report as unchanged");
assert.ok(integratedState.categories.every((category) => category.board.settings.roadmap.endMonth === "2030-12"), "import normalization must preserve the shared five-year range in every category");

// Category correction relocates the same saved object, preserving its details.
const movedGroup = { ...cloud, categoryId: "lifestyle-audio" };
const moveMatch = importer.matchProductGroup(movedGroup, integratedState);
const movePlan = {
  dataset: integrationDataset,
  currentPns: cloud.basePns,
  items: [{ group: movedGroup, match: moveMatch, action: "update", matchedProductId: curatedProduct.id }],
};
integration.apply(movePlan);
const relocatedState = integration.state();
const relocatedProduct = relocatedState.categories.find((category) => category.id === "lifestyle-audio").board.products.find((product) => product.id === curatedProduct.id);
assert.ok(relocatedProduct, "category corrections should relocate the existing product");
assert.deepEqual(relocatedProduct.specs, normalizedOriginalProduct.specs, "relocation must retain specifications through the target category's normalizer");
assert.equal(relocatedProduct.imageAssetId, "hero-image");
assert.equal(relocatedProduct.price, curatedProduct.price);
assert.equal(relocatedState.categories.flatMap((category) => category.board.products).length, 1, "category correction must not create duplicate products");

// Preview flags determine whether matches are applied; ambiguous rows are inert.
integration.load(structuredClone(normalizedOriginal));
const disabledPlan = integration.plan(integrationDataset);
const disabledBefore = integration.state();
const disabledResult = integration.apply(disabledPlan, { updateMatched: false, addNew: false });
assert.equal(disabledResult.skipped, 1);
assert.deepEqual(integration.state().categories, disabledBefore.categories, "unchecked matched-update option must not modify product data");
integration.apply({
  ...disabledPlan,
  items: disabledPlan.items.map((item) => ({ ...item, action: "ambiguous", match: { ...item.match, status: "ambiguous" } })),
});
assert.deepEqual(integration.state().categories, disabledBefore.categories, "ambiguous groups must leave existing products untouched");

integration.load(structuredClone(normalizedOriginal));
const blankAppGroup = { ...blankGroup, launchMonth: "", endMonth: "" };
const blankAppMatch = importer.matchProductGroup(blankAppGroup, integration.state());
integration.apply({
  dataset: { rows: [], metadata: {} },
  currentPns: ["A1AAA"],
  items: [{ group: blankAppGroup, match: blankAppMatch, action: "update", matchedProductId: curatedProduct.id }],
});
const blankAppProduct = integration.state().categories[0].board.products[0];
assert.equal(blankAppProduct.generalAvailabilityDate, normalizedOriginalProduct.generalAvailabilityDate, "app normalization must retain GA after a blank report");
assert.equal(blankAppProduct.endManufacturingDate, normalizedOriginalProduct.endManufacturingDate, "app normalization must retain EM after a blank report");
assert.equal(blankAppProduct.roadmap.startMonth, normalizedOriginalProduct.roadmap.startMonth, "a blank report must not reset the saved timeline start");
assert.equal(blankAppProduct.roadmap.endMonth, normalizedOriginalProduct.roadmap.endMonth, "a blank report must not reset the saved timeline end");

integration.load(structuredClone(normalizedOriginal));
const invalidAppGroup = { ...blankAppGroup, gaDate: "2026-02-30", emDate: "invalid" };
integration.apply({
  dataset: { rows: [], metadata: {} },
  currentPns: ["A1AAA"],
  items: [{ group: invalidAppGroup, match: blankAppMatch, action: "update", matchedProductId: curatedProduct.id }],
});
const invalidAppProduct = integration.state().categories[0].board.products[0];
assert.equal(invalidAppProduct.roadmap.startMonth, normalizedOriginalProduct.roadmap.startMonth, "invalid imported GA must not change the saved timeline start");

// One date-editing source drives both displays; old month-only plans retain
// their precision, and reopening does not silently rewrite saved timing.
integration.load(structuredClone(normalizedOriginal));
integration.edit({ generalAvailabilityDate: "2024-01-31", endManufacturingDate: "2024-03-31" });
let dateEditedProduct = integration.state().categories[0].board.products[0];
assert.equal(dateEditedProduct.roadmap.startMonth, "2024-01", "actual GA edit must update roadmap start");
assert.equal(dateEditedProduct.roadmap.launchMonth, "2024-01", "actual GA edit must update the launch alias");
assert.equal(dateEditedProduct.roadmap.endMonth, "2024-03", "actual EM edit must update roadmap end");
integration.moveSlot({ startMonth: "2024-02", launchMonth: "2024-02", endMonth: "2024-04" });
dateEditedProduct = integration.state().categories[0].board.products[0];
assert.equal(dateEditedProduct.generalAvailabilityDate, "2024-02-29", "actual month drag clamps GA to leap-month end");
assert.equal(dateEditedProduct.endManufacturingDate, "2024-04-30", "actual month drag clamps EM to target-month end");
assert.equal(dateEditedProduct.roadmap.family, normalizedOriginalProduct.roadmap.family);
assert.equal(dateEditedProduct.roadmap.status, normalizedOriginalProduct.roadmap.status);
assert.equal(dateEditedProduct.roadmap.notes, normalizedOriginalProduct.roadmap.notes);
integration.load(integration.state());
assert.equal(integration.state().categories[0].board.products[0].generalAvailabilityDate, "2024-02-29", "synchronized dates survive reload");
integration.edit({ generalAvailabilityDate: "", endManufacturingDate: "" });
integration.moveSlot({ startMonth: "2025-05", endMonth: "2026-06" });
dateEditedProduct = integration.state().categories[0].board.products[0];
assert.equal(dateEditedProduct.generalAvailabilityDate, "", "month-only plans must not gain an invented day");
assert.equal(dateEditedProduct.endManufacturingDate, "");
assert.equal(dateEditedProduct.roadmap.startMonth, "2025-05");
assert.equal(dateEditedProduct.roadmap.endMonth, "2026-06");
integration.load(integration.state());
assert.equal(integration.state().categories[0].board.products[0].roadmap.startMonth, "2025-05", "month-only timing survives reload");
const independentlySaved = structuredClone(normalizedOriginal);
independentlySaved.categories[0].board.products[0].roadmap.startMonth = "2025-08";
independentlySaved.categories[0].board.products[0].roadmap.launchMonth = "2025-08";
integration.load(independentlySaved);
integration.edit({ priceLabel: "Updated label" });
assert.equal(integration.state().categories[0].board.products[0].roadmap.startMonth, "2025-08", "unrelated edits must preserve independently saved timing");

integration.load(structuredClone(normalizedOriginal));
const conflictingMonthHints = { ...cloud, launchMonth: "2022-01", endMonth: "2038-12" };
integration.apply({
  dataset: integrationDataset, currentPns: cloud.basePns,
  items: [{ group: conflictingMonthHints, match: importer.matchProductGroup(conflictingMonthHints, integration.state()), action: "update", matchedProductId: curatedProduct.id }],
});
const canonicalImportProduct = integration.state().categories[0].board.products[0];
assert.equal(canonicalImportProduct.roadmap.startMonth, cloud.gaDate.slice(0, 7), "valid imported GA must take priority over stale month hints");
assert.equal(canonicalImportProduct.roadmap.endMonth, cloud.emDate.slice(0, 7), "valid imported EM must take priority over stale month hints");

integration.load(structuredClone(normalizedOriginal));
const addDataset = { rows: [rows[2], rows[3]], metadata: {} };
const addResult = integration.apply(integration.plan(addDataset));
assert.equal(addResult.added, 1, "unmatched ASCM family should create one new product");
const afterAddition = integration.state();
assert.deepEqual(afterAddition.categories[0].board.products[0], normalizedOriginalProduct, "adding a new ASCM product must not overwrite the existing curated product");
assert.equal(afterAddition.categories.flatMap((category) => category.board.products).length, 2);
assert.equal(integration.plan(addDataset).items[0].action, "unchanged", "newly added products must match deterministically on the next import");

// New ASCM records receive editable catalog placeholders, selected from their
// mapped category and wired/wireless lane. Existing products never get seeded.
const baselineCases = [
  ["pc-gaming-audio", "wired", "Headset", "HyperX Baseline PC Wired BK GAM HS", "wired-headset"],
  ["pc-gaming-audio", "wireless", "Headset", "HyperX Baseline PC Wireless BK GAM HS", "wireless-headset"],
  ["console-gaming-audio", "wired", "Headset", "HyperX Baseline Console PS Wired BK GAM HS", "console-headset"],
  ["console-gaming-audio", "wireless", "Headset", "HyperX Baseline Console PS Wireless BK GAM HS", "console-headset"],
  ["lifestyle-audio", "wired", "Earbuds", "HyperX Baseline Lifestyle Wired BK", "wired-lifestyle"],
  ["lifestyle-audio", "wireless", "Earbuds", "HyperX Baseline Lifestyle Wireless BK", "wireless-lifestyle"],
  ["audio-accessories", "accessories", "Audio", "HyperX Baseline Audio Adapter BK", "sound-card"],
  ["microphones", "microphone", "Microphone", "HyperX Baseline Microphone BK", "gaming-microphone"],
  ["microphone-accessories", "interface-accessories", "Microphone Accessories", "HyperX Baseline Microphone Arm BK", "audio-interface"],
  ["keyboards", "keyboard", "Keyboard", "HyperX Baseline Keyboard BK", "gaming-keyboard"],
  ["mice", "wired", "Mouse", "HyperX Baseline Mouse Wired BK", "gaming-mouse"],
  ["mice", "wireless", "Mouse", "HyperX Baseline Mouse Wireless BK", "gaming-mouse"],
  ["accessories", "accessories", "Mouse pad", "HyperX Baseline Desk Mat BK", "desk-accessory"],
  ["accessories", "parts", "Switch", "HyperX Baseline Spare Switch BK", "desk-accessory"],
  ["controllers", "controller", "Gaming controller", "HyperX Baseline Controller BK", "gaming-controller"],
  ["backpacks", "backpack", "Bags and Cases", "HyperX Baseline Backpack BK", "gaming-backpack"],
];
const baselineDataset = {
  metadata: { fileName: "Baseline specification matrix.xlsx" },
  rows: baselineCases.map(([, , category, description], index) => ({
    sourceRow: index + 2,
    category,
    description,
    basePn: `BASE${String(index + 1).padStart(3, "0")}`,
    localFlag: "N",
    codeName: `Baseline case ${index + 1}`,
    ga: "2026-01-15",
    em: "2030-12-31",
  })),
};
integration.load(structuredClone(normalizedOriginal));
const baselinePlan = integration.plan(baselineDataset);
assert.equal(baselinePlan.items.length, baselineCases.length, "category/lane baseline matrix should produce distinct product families");
assert.ok(baselinePlan.items.every((item) => item.action === "new"), "baseline matrix must exercise the real new-product path");
const baselineResult = integration.apply(baselinePlan);
assert.equal(baselineResult.added, baselineCases.length);
const seededBaselineState = integration.state();
const seededSpecIds = [];
for (const [index, [categoryId, laneId, , , expectedSetId]] of baselineCases.entries()) {
  const basePn = baselineDataset.rows[index].basePn;
  const category = seededBaselineState.categories.find((item) => item.id === categoryId);
  const product = category.board.products.find((item) => item.ascm?.basePartNumbers.includes(basePn));
  assert.ok(product, `new ${categoryId}/${laneId} product must be placed in its mapped category`);
  assert.equal(product.laneId, laneId, `new ${categoryId} product must retain the inferred ${laneId} lane`);
  const catalogCategory = sandbox.window.PORTFOLIO_CATALOG.categories.find((item) => item.id === categoryId);
  const expectedTemplate = catalogCategory.specSets.find((item) => item.id === expectedSetId);
  assert.deepEqual(product.specs.map((item) => [item.label, item.value]), JSON.parse(JSON.stringify(expectedTemplate.specs)), `new ${categoryId}/${laneId} product must receive the catalog's ${expectedSetId} placeholders`);
  assert.ok(product.specs.every((item) => typeof item.id === "string" && item.id), "seeded specifications need stable editable IDs");
  seededSpecIds.push(...product.specs.map((item) => item.id));
}
assert.equal(new Set(seededSpecIds).size, seededSpecIds.length, "each product must receive independent specification records rather than shared template IDs");
assert.deepEqual(seededBaselineState.categories[0].board.products.find((item) => item.id === curatedProduct.id), normalizedOriginalProduct, "seeding imported newcomers must leave existing curated specifications and fields untouched");

const editedBaselineState = structuredClone(seededBaselineState);
const newlySeededPcProduct = editedBaselineState.categories[0].board.products.find((product) => product.ascm?.basePartNumbers.includes("BASE001"));
newlySeededPcProduct.specs[0].value = "Manually verified connection";
const editedSpecification = structuredClone(newlySeededPcProduct.specs[0]);
const newlySeededMouseProduct = editedBaselineState.categories.find((category) => category.id === "mice").board.products.find((product) => product.ascm?.basePartNumbers.includes("BASE011"));
newlySeededMouseProduct.specs = [];
integration.load(editedBaselineState);
const repeatedBaselinePlan = integration.plan(baselineDataset);
assert.ok(repeatedBaselinePlan.items.every((item) => item.action === "unchanged"), "template fields must not destabilize matching or repeated-import previews");
integration.apply(repeatedBaselinePlan);
const repeatedBaselineState = integration.state();
const reimportedPcProduct = repeatedBaselineState.categories[0].board.products.find((product) => product.id === newlySeededPcProduct.id);
assert.deepEqual(reimportedPcProduct.specs[0], editedSpecification, "matched reimports must retain the user's edited template values and specification IDs");
const reimportedMouseProduct = repeatedBaselineState.categories.find((category) => category.id === "mice").board.products.find((product) => product.id === newlySeededMouseProduct.id);
assert.deepEqual(reimportedMouseProduct.specs, [], "matched existing products with deliberately empty specifications must remain empty; baseline seeding is creation-only");
assert.equal(repeatedBaselineState.categories.flatMap((category) => category.board.products).length, seededBaselineState.categories.flatMap((category) => category.board.products).length, "re-import must not add duplicate products or baseline records");

const existingEmptyState = structuredClone(normalizedOriginal);
existingEmptyState.categories[0].board.products[0].specs = [];
integration.load(existingEmptyState);
const existingEmptyPlan = integration.plan(integrationDataset);
assert.equal(existingEmptyPlan.items[0].matchedProductId, curatedProduct.id);
integration.apply(existingEmptyPlan);
assert.deepEqual(integration.state().categories[0].board.products[0].specs, [], "first ASCM update of an existing empty-spec product must not populate a new-product baseline");

function fakeEditorControl(dataset = {}, value = "") {
  const listeners = new Map();
  return { dataset, value, addEventListener(type, handler) { listeners.set(type, handler); }, fire(type) { listeners.get(type)?.(); } };
}
function loadAndBindSpecEditor() {
  integration.load(structuredClone(normalizedOriginal));
  sandbox.editorElements = {
    "#addSpec": {},
    "#addSpecSet": {},
    "#specSetSelect": { value: sandbox.window.PORTFOLIO_CATALOG.categories[0].defaultSpecSetId },
  };
  sandbox.editorRows = normalizedOriginalProduct.specs.map((item) => {
    const labelInput = fakeEditorControl({ specField: "label" }, item.label);
    const valueInput = fakeEditorControl({ specField: "value" }, item.value);
    const removeButton = fakeEditorControl();
    return {
      dataset: { specId: item.id },
      labelInput, valueInput, removeButton,
      querySelectorAll() { return [labelInput, valueInput]; },
      querySelector() { return removeButton; },
    };
  });
  integration.bindSpecEditor();
}
loadAndBindSpecEditor();
sandbox.editorRows[0].valueInput.value = "Edited driver specification";
sandbox.editorRows[0].valueInput.fire("input");
assert.equal(integration.state().categories[0].board.products[0].specs[0].value, "Edited driver specification", "actual input binding must commit specification edits");
sandbox.editorElements["#addSpec"].onclick();
const editedThenAdded = integration.state().categories[0].board.products[0].specs;
assert.equal(editedThenAdded.length, normalizedOriginalProduct.specs.length + 1);
assert.equal(editedThenAdded[0].value, "Edited driver specification", "adding a specification must use the current product rather than reverting unsaved inspector state");

loadAndBindSpecEditor();
sandbox.editorRows[0].valueInput.value = "Edited before common set";
sandbox.editorRows[0].valueInput.fire("input");
sandbox.editorElements["#addSpecSet"].onclick();
const editedThenAddedSet = integration.state().categories[0].board.products[0].specs;
assert.ok(editedThenAddedSet.length > normalizedOriginalProduct.specs.length, "actual common-set button should append missing fields");
assert.equal(editedThenAddedSet[0].value, "Edited before common set", "adding a common set must preserve current specification edits");

loadAndBindSpecEditor();
sandbox.editorRows[0].valueInput.value = "Edited before removal";
sandbox.editorRows[0].valueInput.fire("input");
sandbox.editorRows[1].removeButton.fire("click");
const editedThenRemoved = integration.state().categories[0].board.products[0].specs;
assert.equal(editedThenRemoved.length, normalizedOriginalProduct.specs.length - 1);
assert.equal(editedThenRemoved[0].value, "Edited before removal", "removing another specification must retain current edits");

console.log("ASCM importer checks passed: grouping, matching, additive updates, preserved specs/prices/images, partial reports, idempotence, app normalization/category moves, new-product category/lane baseline specs, and specification editing.");
