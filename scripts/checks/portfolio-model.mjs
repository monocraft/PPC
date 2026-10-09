import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
await import("../../public/js/portfolio-model.js");
const model = globalThis.PortfolioModel;

// Lifecycle synchronization follows the edited endpoint. Merely opening a
// package or changing unrelated metadata must preserve its saved planning.
const datedProduct = Object.freeze({
  id: "dated", name: "Dated product", generalAvailabilityDate: "2026-01-31", endManufacturingDate: "2029-03-10",
  ffsDate: "2025-12-20", specs: Object.freeze([{ label: "Connection", value: "Wireless" }]),
  roadmap: Object.freeze({ startMonth: "2026-01", launchMonth: "2026-01", endMonth: "2029-03", family: "Saved family", status: "embargo", confidence: "medium", predecessorId: "prior", successorId: "next", notes: "Keep notes" }),
});
const datedBefore = structuredClone(datedProduct);
const gaPatch = Object.freeze({ generalAvailabilityDate: "2026-06-22" });
const changedGa = model.mergeProductUpdate(datedProduct, gaPatch);
assert.equal(changedGa.generalAvailabilityDate, "2026-06-22");
assert.equal(changedGa.roadmap.startMonth, "2026-06", "an explicit GA date edit must derive the roadmap start");
assert.equal(changedGa.roadmap.launchMonth, "2026-06", "the compatibility launch alias must follow canonical GA");
assert.equal(changedGa.endManufacturingDate, datedProduct.endManufacturingDate);
assert.equal(changedGa.roadmap.endMonth, datedProduct.roadmap.endMonth, "editing GA must retain a later planned EOM");
const changedEm = model.mergeProductUpdate(datedProduct, { endManufacturingDate: "2030-11-05" });
assert.equal(changedEm.roadmap.endMonth, "2030-11", "an explicit EOM date edit must derive the roadmap end");
assert.equal(changedEm.generalAvailabilityDate, datedProduct.generalAvailabilityDate);
assert.equal(changedEm.roadmap.startMonth, datedProduct.roadmap.startMonth);
for (const result of [changedGa, changedEm]) {
  for (const field of ["family", "status", "confidence", "predecessorId", "successorId", "notes"]) assert.equal(result.roadmap[field], datedProduct.roadmap[field], "date updates must retain curated roadmap metadata");
  assert.equal(result.ffsDate, datedProduct.ffsDate, "lifecycle synchronization must not alter another milestone");
  assert.equal(result.specs, datedProduct.specs, "lifecycle synchronization must preserve specifications");
}
assert.deepEqual(datedProduct, datedBefore, "the helper must not mutate its existing product or roadmap");
assert.deepEqual(gaPatch, { generalAvailabilityDate: "2026-06-22" }, "the helper must not mutate a supplied patch");
assert.notEqual(changedGa, datedProduct);
assert.notEqual(changedGa.roadmap, datedProduct.roadmap);

for (const empty of ["", null, "TBD", " tbd "]) {
  const cleared = model.mergeProductUpdate(datedProduct, { generalAvailabilityDate: empty, endManufacturingDate: empty, roadmap: { startMonth: "2035-01", launchMonth: "2035-01", endMonth: "2036-01" } });
  assert.equal(cleared.generalAvailabilityDate, "");
  assert.equal(cleared.endManufacturingDate, "");
  assert.deepEqual(cleared.roadmap, datedProduct.roadmap, "blank/TBD explicitly clears exact days while retaining the saved planning months");
}
for (const invalid of ["2026-02-30", "2026-13-01", "2026-02", "garbage"]) {
  assert.throws(() => model.mergeProductUpdate(datedProduct, { generalAvailabilityDate: invalid }), RangeError, "invalid date edits must fail rather than erase a saved date");
  assert.throws(() => model.mergeProductUpdate(datedProduct, { endManufacturingDate: invalid }), RangeError);
}
const conflictHints = model.mergeProductUpdate(datedProduct, { generalAvailabilityDate: "2027-02-12", endManufacturingDate: "2028-08-09", roadmap: { startMonth: "2020-01", launchMonth: "2021-01", endMonth: "2035-12" } });
assert.equal(conflictHints.roadmap.startMonth, "2027-02", "explicit canonical GA must take precedence over an accompanying month hint");
assert.equal(conflictHints.roadmap.launchMonth, "2027-02");
assert.equal(conflictHints.roadmap.endMonth, "2028-08", "explicit canonical EOM must take precedence over an accompanying month hint");

const independentlySaved = { ...datedProduct, generalAvailabilityDate: "2024-07-19", endManufacturingDate: "2025-08-02" };
assert.deepEqual(model.mergeProductUpdate(independentlySaved, {}), independentlySaved, "initial/no-op merging must not migrate saved dates or roadmap positions");
const metadataOnly = model.mergeProductUpdate(independentlySaved, { name: "Renamed", roadmap: { family: "Updated family", status: "launched" } });
assert.equal(metadataOnly.generalAvailabilityDate, independentlySaved.generalAvailabilityDate);
assert.equal(metadataOnly.endManufacturingDate, independentlySaved.endManufacturingDate);
assert.equal(metadataOnly.roadmap.startMonth, independentlySaved.roadmap.startMonth);
assert.equal(metadataOnly.roadmap.endMonth, independentlySaved.roadmap.endMonth);
assert.equal(metadataOnly.roadmap.family, "Updated family");
assert.equal(metadataOnly.roadmap.status, "launched");
const unchangedEndpoints = model.mergeProductUpdate(independentlySaved, { roadmap: { startMonth: independentlySaved.roadmap.startMonth, endMonth: independentlySaved.roadmap.endMonth } });
assert.equal(unchangedEndpoints.generalAvailabilityDate, independentlySaved.generalAvailabilityDate, "unchanged month endpoints must not reconcile legacy date mismatches");
assert.equal(unchangedEndpoints.endManufacturingDate, independentlySaved.endManufacturingDate);

const monthOnly = { id: "month-only", generalAvailabilityDate: "", roadmap: { startMonth: "2026-02", launchMonth: "2026-02", endMonth: "2028-12", family: "Legacy" } };
const movedMonthOnly = model.mergeProductUpdate(monthOnly, { roadmap: { startMonth: "2027-06", endMonth: "2029-04" } });
assert.equal(movedMonthOnly.generalAvailabilityDate, "", "month-only planning must not fabricate a GA day");
assert.ok(!Object.hasOwn(movedMonthOnly, "endManufacturingDate"), "a missing EOM day must remain absent");
assert.equal(movedMonthOnly.roadmap.startMonth, "2027-06");
assert.equal(movedMonthOnly.roadmap.launchMonth, "2027-06");
assert.equal(movedMonthOnly.roadmap.endMonth, "2029-04");
assert.deepEqual(monthOnly.roadmap, { startMonth: "2026-02", launchMonth: "2026-02", endMonth: "2028-12", family: "Legacy" });

for (const [month, expectedDate] of [["2028-02", "2028-02-29"], ["2027-02", "2027-02-28"], ["2026-04", "2026-04-30"], ["2026-05", "2026-05-31"]]) {
  const shifted = model.mergeProductUpdate(datedProduct, { roadmap: { startMonth: month } });
  assert.equal(shifted.generalAvailabilityDate, expectedDate, "month editing must retain the original day or clamp to the destination month's final day");
  assert.equal(shifted.roadmap.startMonth, month);
  assert.equal(shifted.roadmap.launchMonth, month);
}
const movedBoth = model.mergeProductUpdate(datedProduct, { roadmap: { startMonth: "2027-08", endMonth: "2030-10" } });
assert.equal(movedBoth.generalAvailabilityDate, "2027-08-31", "a bar move must shift GA with its launch month");
assert.equal(movedBoth.endManufacturingDate, "2030-10-10", "a bar move must preserve the EOM day in its destination month");
for (const [month, expectedDate] of [["2028-02", "2028-02-29"], ["2027-02", "2027-02-28"]]) {
  const shiftedEm = model.mergeProductUpdate({ ...datedProduct, endManufacturingDate: "2029-03-31" }, { roadmap: { endMonth: month } });
  assert.equal(shiftedEm.endManufacturingDate, expectedDate, "end-month edits must also clamp exact EOM days for leap and ordinary February");
}
const launchAlias = model.mergeProductUpdate(datedProduct, { roadmap: { launchMonth: "2027-07" } });
assert.equal(launchAlias.roadmap.startMonth, "2027-07", "legacy launchMonth updates must keep the start alias consistent");
assert.equal(launchAlias.generalAvailabilityDate, "2027-07-31");
const crossedStart = model.mergeProductUpdate(datedProduct, { roadmap: { startMonth: "2030-05" } });
assert.equal(crossedStart.roadmap.endMonth, "2030-05", "moving launch past the end must clamp the roadmap end");
assert.equal(crossedStart.generalAvailabilityDate, "2030-05-31");
assert.equal(crossedStart.endManufacturingDate, "2030-05-31", "a crossed-start clamp must keep EOM no earlier than the exact GA day");
for (const endMonth of ["2025-12", "2026-01"]) {
  const shortened = model.mergeProductUpdate(datedProduct, { roadmap: { endMonth } });
  assert.equal(shortened.roadmap.endMonth, "2026-01", "an end-month edit must not precede the launch month");
  assert.equal(shortened.endManufacturingDate, "2026-01-31", "same-month EOM must clamp to GA when its preserved day would precede launch");
  assert.equal(shortened.generalAvailabilityDate, datedProduct.generalAvailabilityDate);
}
const sameMonthValid = model.mergeProductUpdate({ ...datedProduct, generalAvailabilityDate: "2026-01-05" }, { roadmap: { endMonth: "2026-01" } });
assert.equal(sameMonthValid.endManufacturingDate, "2026-01-10", "valid same-month exact timing must retain the EOM day");
const unknownDaysClamp = model.mergeProductUpdate(monthOnly, { roadmap: { endMonth: "2025-01" } });
assert.equal(unknownDaysClamp.roadmap.endMonth, monthOnly.roadmap.startMonth);
assert.equal(unknownDaysClamp.generalAvailabilityDate, "");
assert.ok(!Object.hasOwn(unknownDaysClamp, "endManufacturingDate"), "monthly range clamping must not invent an EOM day");
for (const invalid of ["2026-13", "2026-00", "2026-1", "2026-01-01", "invalid"]) {
  assert.throws(() => model.mergeProductUpdate(datedProduct, { roadmap: { startMonth: invalid } }), RangeError);
  assert.throws(() => model.mergeProductUpdate(datedProduct, { roadmap: { endMonth: invalid } }), RangeError);
}

const portfolio = {
  activeCategoryId: "b", settings: {},
  categories: [
    { id: "a", board: { settings: { roadmap: { startMonth: "2024-01", endMonth: "2026-12", categoryLabel: "Audio", familyOrder: ["Cloud"] } }, products: [{ id: "keep", roadmap: { startMonth: "2025-07", endMonth: "2029-10" } }] } },
    { id: "b", board: { settings: { roadmap: { startMonth: "2026-01", endMonth: "2030-12", categoryLabel: "Mice", snap: "quarter" } }, products: [] } },
  ],
};
const productBefore = structuredClone(portfolio.categories[0].board.products);
model.syncTimelineSettings(portfolio);
assert.equal(portfolio.settings.timeline.startMonth, "2026-01", "legacy range migrates from the active category");
assert.equal(portfolio.categories[0].board.settings.roadmap.endMonth, "2030-12");
assert.equal(portfolio.categories[0].board.settings.roadmap.categoryLabel, "Audio");
assert.deepEqual(portfolio.categories[0].board.settings.roadmap.familyOrder, ["Cloud"]);
for (const years of [3, 5, 10]) {
  model.syncTimelineSettings(portfolio, { startMonth: "2027-01", endMonth: `${2027 + years - 1}-12`, snap: "half", statusColors: { launched: "#515151" } });
  for (const category of portfolio.categories) {
    assert.equal(category.board.settings.roadmap.endMonth, `${2027 + years - 1}-12`);
    assert.equal(category.board.settings.roadmap.snap, "half");
    assert.equal(category.board.settings.roadmap.statusColors.launched, "#515151");
  }
  const reopened = JSON.parse(JSON.stringify(portfolio));
  reopened.activeCategoryId = "a";
  model.syncTimelineSettings(reopened);
  assert.deepEqual(reopened.settings.timeline, portfolio.settings.timeline, "switching category/reloading preserves global settings");
}
assert.deepEqual(portfolio.categories[0].board.products, productBefore, "view settings never change product lifecycle dates");
assert.equal(model.normalizeTimelineSettings({ startMonth: "2026-13", endMonth: "garbage" }).startMonth, "2026-01");
assert.equal(model.normalizeTimelineSettings({ startMonth: "2027-01", endMonth: "2026-12" }).endMonth, "2027-12");
const curated = [{ id: "s1", label: "Driver", value: "53 mm", custom: "keep" }];
assert.deepEqual(model.normalizeSpecifications(curated), curated);
assert.equal(model.normalizeSpecifications({ Driver: "53 mm" }, () => "s2")[0].value, "53 mm");
assert.equal(model.normalizeSpecifications([["Weight", "300 g"]], () => "s3")[0].label, "Weight");
assert.equal(model.normalizeSpecifications('[["Weight", "300 g"]]', () => "s4")[0].value, "300 g");
assert.equal(model.normalizeSpecifications("Custom specs", () => "s5")[0].value, "Custom specs");

const product = {
  variantGroups: [{ type: "color", items: [
    { id: "black", code: "BK", colorName: "Black", colorHex: "#111111" },
    { id: "whitepink", code: "WHT-PNK", colorName: "White", colorName2: "Pink", colorHex: "#eeeeee", colorHex2: "#ff5599" },
  ] }],
  ascm: { records: [{ basePartNumber: "A1", colorCode: "BLK" }, { basePartNumber: "A2", colorCode: "WHT/PNK" }] },
};
assert.equal(model.resolveSkuColors({ code: "A1" }, product)[0].label, "Black");
assert.equal(model.resolveSkuColors({ code: "a2" }, product)[0].label, "White / Pink");
assert.equal(model.resolveSkuColors({ code: "manual", variantId: "black" }, product)[0].colorHex, "#111111");
assert.deepEqual(model.resolveSkuColors({ code: "unknown" }, product), [], "unknown numbers never guess a color");
assert.equal(model.resolveSkuColors({ code: "manual", colorCode: "CUSTOM" }, product)[0].label, "CUSTOM");
const namedVariant = { variantGroups: [{ type: "color", items: [{ id: "curated-black", code: "BLACK", colorName: "Midnight Black", colorHex: "#121218" }] }], ascm: { records: [{ basePartNumber: "A3", colorCode: "BK" }] } };
assert.equal(model.resolveSkuColors({ code: "A3" }, namedVariant)[0].label, "Midnight Black");
assert.equal(model.resolveSkuColors({ code: "A3" }, namedVariant)[0].colorHex, "#121218");
assert.equal(model.canonicalColorCode("White-Pink"), "WHT/PNK");

// Run the real application year-span action with a minimal view adapter.
const appSource = await readFile(new URL("../../public/js/app.js", import.meta.url), "utf8");
const standardStatusCases = [
  ["new", "NEW PRODUCT", "#5fd6c1"],
  ["embargo", "UPCOMING UNDER EMBARGO", "#ef5b5b"],
  ["in-development", "IN-DEVELOPMENT", "#7aa2cc"],
  ["sunsetting", "SUNSETTING", "#d4a56a"],
];
const standardStatusSource =
  appSource.slice(appSource.indexOf("const STANDARD_CARD_STATUSES"), appSource.indexOf("const PRODUCT_TIER_OPTIONS")) +
  appSource.match(/function normalizeCardStatusType\([\s\S]*?\n\}/)[0] +
  appSource.slice(appSource.indexOf("function standardizedStatus("), appSource.indexOf("function catalogImageAssetId("));
const action = appSource.slice(appSource.indexOf("function setRoadmapYearSpan("), appSource.indexOf("function fitProductLanesVertically("));
const sandbox = { board: portfolio.categories[0].board, activeView: "roadmap", monthIndex: (value) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1,
  monthStringFromDate: () => "2026-10", updateTimelineSettings: (patch) => model.syncTimelineSettings(portfolio, patch),
  requestAnimationFrame: (callback) => callback(), fitRoadmapTimeline: () => {}, roadmapScroll: { scrollTo: () => {} } };
vm.createContext(sandbox);
vm.runInContext(action, sandbox);
for (const years of [3, 5, 10]) {
  sandbox.setRoadmapYearSpan(years);
  assert.ok(portfolio.categories.every((category) => category.board.settings.roadmap.endMonth === `${2027 + years - 1}-12`));
}

// Exercise the real canvas geometry: compact empty cards, stable category heights,
// bounded overflow, and fully expanded detailed specifications.
let layoutLaneCount = 2;
let supportedFullSpecCategory = false;
const layoutSandbox = {
  board: { products: [], settings: { showSkus: true, fullSingleLaneSpecs: false } },
  sortedLanes: () => Array.from({ length: layoutLaneCount }, (_, index) => ({ id: `lane-${index}` })),
  categoryDefinition: () => ({ fullSpecCards: supportedFullSpecCategory }),
  variantFooterLayout: (item) => ({ height: item.footerHeight || 0 }),
  visibleProducts: () => { throw new Error("Search results must not control category geometry"); },
};
vm.createContext(layoutSandbox);
vm.runInContext(
  appSource.slice(appSource.indexOf("const CARD_WIDTH"), appSource.indexOf("const PLACEHOLDER_IMAGE")) +
  appSource.slice(appSource.indexOf("const FULL_SPEC_MIN_CARD_HEIGHT"), appSource.indexOf("// Canvas colors")) +
  appSource.slice(appSource.indexOf("function normalizedSpecLabel("), appSource.indexOf("function viewerInfoVisualWidth(")),
  layoutSandbox,
);
layoutSandbox.board.products = [{ specs: [], footerHeight: 50 }];
assert.equal(layoutSandbox.productCardLayout().cardHeight, 300, "empty spec space collapses");
layoutSandbox.board.products.push({ specs: Array.from({ length: 4 }, () => ({ label: "Connection", value: "USB" })), footerHeight: 50 });
assert.equal(layoutSandbox.productCardLayout().cardHeight, 415, "all products determine aligned category height");
layoutSandbox.board.products.push({ specs: Array.from({ length: 20 }, () => ({ label: "Connection", value: "USB" })), footerHeight: 104 });
assert.equal(layoutSandbox.productCardLayout().cardHeight, 552, "compact overflow remains bounded");
assert.equal(layoutSandbox.productCardLayout().laneHeight, 622);
const compactLayout = layoutSandbox.productCardLayout();
layoutSandbox.board.settings.fullSingleLaneSpecs = true;
assert.deepEqual(layoutSandbox.productCardLayout(), compactLayout, "a legacy true preference must not expand unsupported multi-lane cards");
layoutLaneCount = 1;
const singleLaneLayout = layoutSandbox.productCardLayout();
assert.ok(singleLaneLayout.detailed && singleLaneLayout.cardHeight > 552, "single-lane cards automatically expand full specifications without clipping");
layoutSandbox.board.settings.fullSingleLaneSpecs = false;
assert.deepEqual(layoutSandbox.productCardLayout(), singleLaneLayout, "a legacy false preference must not suppress automatic full specifications");
assert.equal(layoutSandbox.board.settings.fullSingleLaneSpecs, false, "layout rendering must preserve inert legacy preferences");
layoutLaneCount = 2;
supportedFullSpecCategory = true;
assert.deepEqual(layoutSandbox.productCardLayout(), singleLaneLayout, "supported multi-lane categories such as Gaming Accessories automatically show full specifications");
layoutSandbox.board.settings.fullSingleLaneSpecs = true;
assert.deepEqual(layoutSandbox.productCardLayout(), singleLaneLayout, "legacy true and false preferences must produce the same supported-card geometry");
delete layoutSandbox.board.settings.fullSingleLaneSpecs;
assert.deepEqual(layoutSandbox.productCardLayout(), singleLaneLayout, "new workspaces need no full-spec preference to expand supported cards");
layoutSandbox.board.products = [{ specs: [], footerHeight: 50 }];
assert.equal(layoutSandbox.productCardLayout().detailed, false, "empty full-spec categories use compact geometry");
layoutLaneCount = 1;
assert.equal(layoutSandbox.productCardLayout().detailed, false, "empty single-lane categories use compact geometry");

const presentationSandbox = { PortfolioModel: model, UI_PALETTE: { charcoal600: "#2c2c2c", carbon: "#111111" },
  normalizeRoadmapStatus: (stage) => stage || "in-planning" };
vm.createContext(presentationSandbox);
vm.runInContext(
  standardStatusSource +
  appSource.slice(appSource.indexOf("function productPresentation("), appSource.indexOf("function productPriceText(")) +
  appSource.slice(appSource.indexOf("function roadmapStatusColor("), appSource.indexOf("function roadmapLabel(")),
  presentationSandbox,
);
for (const stage of ["launched", "in-development", "in-planning", "embargo", "end-of-life"]) {
  const item = { statusType: "none", variantLabel: "Custom label", variantColor: "#ff0000", roadmap: { status: stage } };
  const presentation = presentationSandbox.productPresentation(item);
  assert.equal(presentation.primaryColor, presentationSandbox.roadmapStatusColor(item), "cards and timeline share the selected manual stage tone");
  assert.equal(presentation.primaryColor, model.lifecycleTone(stage));
  assert.equal(item.variantColor, "#ff0000", "old custom fields remain stored without affecting the shared palette");
}
for (const [statusType, label, expected] of standardStatusCases) {
  const item = { statusType, roadmap: { status: "in-development" } };
  assert.equal(presentationSandbox.normalizeCardStatusType(statusType), statusType, "every built-in status remains a valid saved status");
  assert.equal(presentationSandbox.normalizeCardStatusType(` ${statusType.toUpperCase()} `), statusType, "imported preset names normalize without losing their status");
  assert.equal(presentationSandbox.standardizedStatus(statusType).label, label, "preset labels use the same wording in every category");
  assert.equal(presentationSandbox.standardizedStatus(statusType).color, expected, "preset colors are fixed rather than inherited from a roadmap stage");
  assert.equal(presentationSandbox.productPresentation(item).primaryColor, expected);
  assert.equal(presentationSandbox.roadmapStatusColor(item), expected, "theme accents must match between product cards and roadmap");
}
for (const invalidStatus of [undefined, null, "", "unknown", "constructor", "toString", "__proto__"]) {
  assert.equal(presentationSandbox.normalizeCardStatusType(invalidStatus), "none", "unknown and inherited object keys never become built-in statuses");
  assert.equal(presentationSandbox.standardizedStatus(invalidStatus).label, "");
}
for (const statusType of ["none", ...standardStatusCases.map(([status]) => status)]) {
  const product = { statusType, roadmap: { status: "embargo" } };
  assert.equal(model.productTone(product), "#ef5b5b", "embargo remains visible even when another preset is selected");
  assert.equal(presentationSandbox.productPresentation(product).primaryColor, "#ef5b5b", "embargo precedence also applies to the actual card presentation");
  assert.equal(presentationSandbox.roadmapStatusColor(product), "#ef5b5b", "embargo precedence remains consistent on the roadmap");
  assert.equal(model.productLabelColor(product, "#111111"), "#ffffff", "Every red embargo surface uses white label text.");
}
assert.equal(model.productLabelColor({ statusType: "embargo" }, "#111111"), "#ffffff");
for (const product of [null, {}, ...standardStatusCases.filter(([type]) => type !== "embargo").map(([statusType]) => ({ statusType })), { statusType: "none", roadmap: { status: "in-development" } }]) {
  assert.equal(model.productLabelColor(product, "#111111"), "#111111", "The embargo preference leaves normal contrast choices intact.");
}

// Console platform labels are secondary to the same lifecycle banner used by
// every category, in both the canvas card and roadmap details.
const consoleText = [];
const consoleTextColors = [];
const consoleShapes = [];
let consoleProduct;
Object.assign(presentationSandbox, {
  board: { settings: { showPrices: false, showSkus: false } }, portfolio: { settings: {} },
  UI_PALETTE: { charcoal600: "#2c2c2c", charcoal700: "#222222", charcoal500: "#333333", silver: "#cccccc" },
  CARD_WIDTH: 246, STATUS_BANNER_HEIGHT: 24, INFO_BUTTON_WIDTH: 54,
  roundRect: (...args) => { consoleShapes.push(args); }, loadImage: () => ({ ready: false }),
  productImageSource: () => "", wrapText: (_context, text) => { consoleText.push(text); },
  drawProductInfoButton: () => {}, drawDetailedSpecs: () => {},
  splitProduct: { innerHTML: "" }, selectedProduct: () => consoleProduct,
  escapeHtml: (text) => String(text || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
  contrastTextColor: () => "#111111", productDetailsModel: () => ({}),
  PortfolioDetails: { render: () => "Details", bind() {} }, productDateHistoryOptions: () => ({}), copyTextToClipboard() {},
});
vm.runInContext(
  appSource.slice(appSource.indexOf("function drawCard("), appSource.indexOf("function roadmapRange(")) +
  appSource.slice(appSource.indexOf("function renderSplitProduct("), appSource.indexOf("function updateLinkedViewButton(")),
  presentationSandbox,
);
const consoleContext = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  measureText: (text) => ({ width: text.length * 5 }), fillText: (text) => { consoleText.push(text); consoleTextColors.push(consoleContext.fillStyle); } };
const consoleLayout = { cardHeight: 300, imageSlotTop: 34, imageSlotHeight: 110, titleBlockTop: 150, detailsTopOffset: 65 };
for (const [statusType, label, color] of standardStatusCases) {
  for (const variantLabel of ["", "PLAYSTATION", "XBOX", label, label.toLowerCase()]) {
    consoleProduct = { name: "Console headset", statusType, variantLabel, specs: [], roadmap: { status: "in-development" } };
    const before = JSON.stringify(consoleProduct);
    const presentation = presentationSandbox.productPresentation(consoleProduct);
    assert.equal(presentation.primaryLabel, label, "platforms cannot replace the shared status banner");
    assert.equal(presentation.primaryColor, color);
    assert.equal(presentation.secondaryLabel, variantLabel && variantLabel.toUpperCase() !== label ? variantLabel : "", "identical status/variant labels are never duplicated, regardless of case");
    for (const detailed of [false, true]) {
      consoleText.length = 0;
      consoleTextColors.length = 0;
      consoleShapes.length = 0;
      presentationSandbox.drawCard(consoleContext, consoleProduct, 0, 0, false, { ...consoleLayout, detailed }, false);
      assert.equal(consoleText[0], label, "both compact and detailed cards start with the shared status label");
      assert.equal(consoleShapes[1][6], color, "the main banner uses the theme accent");
      assert.equal(consoleTextColors[0], statusType === "embargo" ? "#ffffff" : "#111111", "Compact, detailed, and exported card rendering use white embargo text and dark text on the teal, blue, and amber presets.");
      if (presentation.secondaryLabel) {
        assert.equal(consoleText[1], variantLabel);
        assert.equal(consoleShapes[2][6], color, "the variant badge matches the status banner color");
        assert.equal(consoleShapes[2][7], color, "the variant badge border matches its fill");
        assert.equal(consoleTextColors[1], consoleTextColors[0], "status and variant labels share readable text contrast");
        assert.ok(consoleShapes[2][1] + consoleShapes[2][3] < 246 - 54 - 8, "the platform badge leaves room for Details");
      }
    }
    presentationSandbox.renderSplitProduct();
    assert.ok(presentationSandbox.splitProduct.innerHTML.includes(`>${label}</div>`), "roadmap details retain the same primary status");
    assert.ok(presentationSandbox.splitProduct.innerHTML.includes(`color:${statusType === "embargo" ? "#ffffff" : "#111111"}`), "The roadmap detail header shares the banner text preference.");
    assert.equal(presentationSandbox.splitProduct.innerHTML.includes('class="split-platform-label"'), Boolean(presentation.secondaryLabel));
    assert.ok(presentationSandbox.splitProduct.innerHTML.includes(`--product-highlight:${color};--product-label-color:${statusType === "embargo" ? "#ffffff" : "#111111"}`), "roadmap details provide the same status fill and text color to the variant badge");
    assert.equal(JSON.stringify(consoleProduct), before, "presentation never changes the saved manual status or platform label");
  }
}
assert.equal(presentationSandbox.productPresentation({ statusType: "none", variantLabel: "PLAYSTATION" }).primaryLabel, "PLAYSTATION", "a manual platform banner remains available when no product status is set");
consoleProduct = { name: "Console headset", statusType: "new", variantLabel: "PLAYSTATION", specs: [], roadmap: { status: "in-development" } };
presentationSandbox.loadImage = () => ({ ready: true, image: {} });
presentationSandbox.drawContainedImage = () => { consoleText.push("paint product image"); };
consoleText.length = 0;
presentationSandbox.drawCard(consoleContext, consoleProduct, 0, 0, false, consoleLayout, false);
assert.ok(consoleText.indexOf("PLAYSTATION") > consoleText.indexOf("paint product image"), "loaded headset images cannot paint over the secondary platform label");

// Both views read the same saved MSRP. Unknown values have no display text,
// while intentional text prices and a real zero remain available in either view.
for (const [price, expected] of [[129.99, "$129.99"], ["129.99", "$129.99"], [0, "$0.00"], ["0", "$0.00"], [" 19.5 ", "$19.50"]]) {
  assert.equal(model.msrpText({ price, priceLabel: "Contact sales" }), expected, "saved numeric MSRP takes precedence over display text");
}
for (const price of [undefined, null, "", " ", "NaN", "12oops", NaN, Infinity, -Infinity, -1, "-9.99", false, true, {}, []]) {
  assert.equal(model.msrpText({ price }), "", "blank or invalid saved amounts never become a fake MSRP");
  assert.equal(model.msrpText({ price, priceLabel: " Contact sales " }), "Contact sales", "invalid amounts still allow a meaningful display label");
}
for (const priceLabel of ["", " ", "Price TBD", "tbd", "Price hidden", "Not set", "Price not available", "NA", "N/A", "—", "--"]) {
  assert.equal(model.msrpText({ price: null, priceLabel }), "", "unknown-price placeholders do not appear on cards or timeline");
}
assert.equal(model.msrpText({ priceLabel: "$ Varies" }), "$ Varies");
assert.equal(model.msrpText(null), "");

// Exercise the actual card drawing, timeline label, and visibility handlers.
// The adapters replace unrelated canvas/DOM effects, not the price decisions.
const pricedProduct = { id: "shared-price", name: "Cloud Test", price: 129.99, priceLabel: "Contact sales", specs: [] };
const priceBoard = { settings: { showPrices: true, showSkus: false }, products: [pricedProduct] };
const pricePortfolio = { settings: { showRoadmapMsrp: false }, categories: [{ id: "headsets", board: priceBoard }] };
const controls = new Map([["#showPrices", {}], ["#roadmapShowMsrp", {}]]);
let savedPriceChanges = 0;
const priceSandbox = {
  PortfolioModel: model, board: priceBoard, portfolio: pricePortfolio,
  $: (selector) => controls.get(selector), scheduleSave: () => { savedPriceChanges += 1; },
  syncControls: () => {}, renderActiveView: () => {}, renderRoadmaps: () => {},
  UI_PALETTE: {}, CARD_WIDTH: 264, STATUS_BANNER_HEIGHT: 24,
  productPresentation: () => ({ primaryLabel: "", hasStatus: false, outlineColor: "#333333" }),
  roundRect: () => {}, loadImage: () => ({ ready: false }), productImageSource: () => "",
  wrapText: () => {}, drawProductInfoButton: () => {}, viewerInfoProductId: null, viewerInfoProgress: 0,
};
vm.createContext(priceSandbox);
vm.runInContext(
  appSource.slice(appSource.indexOf("function productPriceText("), appSource.indexOf("function parseHexColor(")) +
  appSource.slice(appSource.indexOf("function roadmapProductBarLabel("), appSource.indexOf("function drawRoadmapTo(")) +
  appSource.slice(appSource.indexOf("function drawCard("), appSource.indexOf("function roadmapRange(")) +
  appSource.slice(appSource.indexOf("function updateBoard("), appSource.indexOf("function updateTimelineSettings(")) +
  appSource.slice(appSource.indexOf('$("#showPrices").onchange'), appSource.indexOf('$("#showSkus").onchange')) +
  appSource.slice(appSource.indexOf('$("#roadmapShowMsrp").onchange'), appSource.indexOf('document.querySelectorAll("[data-roadmap-years]")', appSource.indexOf('$("#roadmapShowMsrp").onchange'))),
  priceSandbox,
);
const cardLayout = { cardHeight: 300, imageSlotTop: 24, imageSlotHeight: 110, titleBlockTop: 150, priceBaselineOffset: 48, detailsTopOffset: 65, detailed: false };
function cardText(item) {
  const output = [];
  const context = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText(text) { output.push(text); } };
  priceSandbox.drawCard(context, item, 0, 0, false, cardLayout);
  return output;
}
const storedBefore = JSON.stringify(pricePortfolio.categories);
for (const showCards of [false, true]) {
  for (const showTimeline of [false, true]) {
    controls.get("#showPrices").onchange({ target: { checked: showCards } });
    controls.get("#roadmapShowMsrp").onchange({ target: { checked: showTimeline } });
    assert.equal(priceBoard.settings.showPrices, showCards);
    assert.equal(pricePortfolio.settings.showRoadmapMsrp, showTimeline);
    assert.equal(cardText(pricedProduct).includes("$129.99"), showCards, "card visibility controls only card pricing");
    assert.equal(priceSandbox.roadmapProductBarLabel(pricedProduct), showTimeline ? "CLOUD TEST  ·  $129.99" : "CLOUD TEST", "timeline MSRP is independent of the card visibility toggle");
    for (const item of [{ ...pricedProduct, price: null, priceLabel: "Price TBD" }, { ...pricedProduct, price: "bad", priceLabel: "" }]) {
      assert.equal(priceSandbox.roadmapProductBarLabel(item), "CLOUD TEST", "unknown MSRP leaves no placeholder or empty delimiter");
      assert.ok(!cardText(item).some((text) => /TBD|NaN|Infinity/.test(text)), "unknown prices remain blank on cards");
    }
  }
}
assert.equal(savedPriceChanges, 8, "both real visibility handlers save their view settings");
assert.equal(JSON.stringify(pricePortfolio.categories[0].board.products), JSON.stringify(JSON.parse(storedBefore)[0].board.products), "visibility changes preserve stored MSRP and display labels");
assert.equal(JSON.parse(JSON.stringify(pricePortfolio)).categories[0].board.products[0].price, 129.99, "saving/reopening retains the shared amount");
pricedProduct.price = 199.5;
assert.equal(priceSandbox.productPriceText(pricedProduct), "$199.50");
assert.ok(cardText(pricedProduct).includes("$199.50"));
assert.equal(priceSandbox.roadmapProductBarLabel(pricedProduct), "CLOUD TEST  ·  $199.50", "changing the saved MSRP updates both surfaces");

// A taller details pane belongs to its own lane; all following lanes move by
// the extra height, preserving the normal gap and every preceding position.
const geometryLanes = Object.freeze(["first", "middle", "last"].map((id) => Object.freeze({ id, label: id.toUpperCase(), order: ["first", "middle", "last"].indexOf(id) })));
const geometryLayout = Object.freeze({ cardHeight: 300, laneHeight: 370, detailed: false });
const geometryInputs = JSON.stringify({ lanes: geometryLanes, layout: geometryLayout });
const baseGeometry = model.layoutProductLanes(geometryLanes, geometryLayout);
const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} versus ${expected}`);
assert.deepEqual(baseGeometry.rows.map((row) => row.top), [34, 404, 774]);
assert.equal(baseGeometry.height, 1110);
for (const drawZoom of [.65, 1, 1.5, 2]) {
  const detailHeight = 520 / drawZoom;
  const extra = Math.max(0, detailHeight - geometryLayout.cardHeight);
  for (const [expandedIndex, expandedLane] of geometryLanes.entries()) {
    const result = model.layoutProductLanes(geometryLanes, geometryLayout, Object.freeze({ expandedLaneId: expandedLane.id, detailHeight }));
    closeTo(result.height, baseGeometry.height + extra, "total height contains exactly one expanded lane");
    result.rows.forEach((row, index) => {
      assert.equal(row.lane, geometryLanes[index]);
      assert.equal(row.index, index);
      closeTo(row.top, baseGeometry.rows[index].top + (index > expandedIndex ? extra : 0), "only following lanes move down");
      closeTo(row.contentHeight, index === expandedIndex ? Math.max(detailHeight, 300) : 300, "only the selected lane expands without shrinking below its cards");
      closeTo(row.height - row.contentHeight, 70, "the original row gap remains exact");
      if (index > 0) closeTo(row.top - result.rows[index - 1].top - result.rows[index - 1].contentHeight, 70, "the next lane never overlaps cards or the details pane");
    });
  }
}
for (const options of [{ expandedLaneId: "missing", detailHeight: 1000 }, { expandedLaneId: "middle", detailHeight: 0 }, { expandedLaneId: "middle", detailHeight: 200 }]) {
  assert.deepEqual(model.layoutProductLanes(geometryLanes, geometryLayout, options), baseGeometry, "closing/stale/short details restore the original geometry");
}
assert.equal(model.layoutProductLanes(geometryLanes, geometryLayout, { top: 80 }).rows[0].top, 80);
assert.equal(model.layoutProductLanes(geometryLanes, geometryLayout, { top: 80 }).height, 1110, "total row height excludes initial padding");
assert.deepEqual(model.layoutProductLanes([], geometryLayout), { rows: [], height: 0 });
assert.equal(JSON.stringify({ lanes: geometryLanes, layout: geometryLayout }), geometryInputs, "geometry never changes saved lanes or card layout");

// Inline details use horizontal room only. Dimensions, drawing, lane labels,
// hit testing, and dragging keep every lane at its original position.
const laneProducts = geometryLanes.map((lane) => ({ id: `p-${lane.id}`, laneId: lane.id, order: 0 }));
laneProducts.push({ id: "p-following", laneId: "first", order: 1 });
let visibleLaneProducts = laneProducts;
const drawnLaneCards = [];
const laneBackgrounds = [];
const reorderedProducts = [];
const laneSandbox = {
  PortfolioModel: model, board: { products: laneProducts, lanes: geometryLanes }, activeView: "products", zoom: 1,
  activeCategoryId: "geometry", searchQuery: "", productCardMotion: null, productCardMotionFrame: null,
  viewerInfoProductId: "p-middle", viewerInfoProgress: 1,
  sortedLanes: () => geometryLanes, visibleProducts: () => visibleLaneProducts, productCardLayout: () => geometryLayout,
  viewerInfoVisualWidth: () => 540,
  PRODUCT_MIN_ZOOM: .2, LANE_TOP: 34, GUTTER: 18, CARD_WIDTH: 246, CARD_GAP: 10, SIDE_PADDING: 40,
  inspectorOpen: false, inspector: { offsetWidth: 0 }, canvasScroll: { clientWidth: 800, scrollTop: 0 },
  laneRailInner: { style: {}, innerHTML: "" }, UI_PALETTE: { charcoal800: "#171717" },
  roundRect: (...args) => { laneBackgrounds.push(args.slice(1, 5)); },
  drawCard: (_context, item, x, y) => { drawnLaneCards.push({ id: item.id, x, y }); },
  escapeHtml: (value) => String(value || ""), selectedId: null, renderedCards: [], dragState: null, panState: null, productLayoutEditing: true,
  canvas: { style: {}, hasPointerCapture: () => false },
  renderBoard() {},
  reorderProduct: (productId, laneId, targetIndex) => { reorderedProducts.push({ productId, laneId, targetIndex }); },
};
function appSection(start, end) {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `application section is present: ${start}`);
  return appSource.slice(startIndex, endIndex);
}
vm.createContext(laneSandbox);
vm.runInContext(
  appSection("function viewerInfoReserveLogical(", "function setupCanvas(") +
  appSection("function drawBoardTo(", "function specIconKind(") +
  appSection("function renderLaneRail(", "function horizontalScrollMax(") +
  appSection("function hitCard(", "function hitVariantOverflow(") +
  appSection("function stopProductCardDrag(", "function startProductReorder(") +
  appSection("function finishDrag(", 'canvas.addEventListener("pointerup", finishDrag)'),
  laneSandbox,
);
const laneContext = { clearRect() {} };
for (const drawZoom of [.2, .65, 1, 1.5, 2]) {
  laneSandbox.zoom = drawZoom;
  for (const lane of geometryLanes) {
    laneSandbox.viewerInfoProductId = `p-${lane.id}`;
    const dimensions = laneSandbox.getCanvasDimensions();
    closeTo(dimensions.height, 34 + 1110 + 20, "opening details preserves the original canvas height");
    drawnLaneCards.length = 0;
    laneBackgrounds.length = 0;
    laneSandbox.drawBoardTo(laneContext, dimensions);
    laneSandbox.renderLaneRail(dimensions);
    const railRows = [...laneSandbox.laneRailInner.innerHTML.matchAll(/style="top:([\d.]+)px;height:([\d.]+)px"/g)];
    assert.equal(railRows.length, geometryLanes.length);
    dimensions.laneRows.forEach((row, index) => {
      closeTo(row.top, baseGeometry.rows[index].top, "opening details never moves a lane");
      const item = drawnLaneCards.find((card) => card.id === `p-${row.lane.id}`);
      closeTo(item.y, row.top, "drawn card uses centralized lane position");
      closeTo(laneBackgrounds[index][1], row.top - 4, "lane background follows row top");
      closeTo(laneBackgrounds[index][3], row.contentHeight + 8, "lane background retains the original card height");
      closeTo(Number(railRows[index][1]), (row.top - 4) * drawZoom, "lane rail follows the same scaled position");
      closeTo(Number(railRows[index][2]), (row.contentHeight + 8) * drawZoom, "lane rail retains the original row height");
      assert.equal(laneSandbox.hitCard({ x: item.x + 120, y: item.y + 150 }).productId, item.id, "hit testing follows the unchanged lane positions");
    });
  }
}
laneSandbox.zoom = .65;
laneSandbox.viewerInfoProductId = "p-first";
const openDimensions = laneSandbox.getCanvasDimensions();
laneSandbox.viewerInfoProgress = .01;
assert.equal(laneSandbox.getCanvasDimensions().height, openDimensions.height, "opening animation never reserves vertical space");
laneSandbox.viewerInfoProgress = 1;
laneSandbox.dragState = {
  productId: "p-last", pointerId: 1, moved: true, board: laneSandbox.board,
  categoryId: laneSandbox.activeCategoryId, zoom: laneSandbox.zoom, searchQuery: "",
  version: laneSandbox.productCardLayoutFingerprint(),
  position: { x: 18 + 256, y: openDimensions.laneRows[1].top + 5 },
};
laneSandbox.dragState.dropTarget = laneSandbox.productCardDropTarget(laneProducts, visibleLaneProducts, openDimensions.laneRows, "p-last", laneSandbox.dragState.position);
laneSandbox.finishDrag({ pointerId: 1 });
assert.deepEqual(reorderedProducts, [{ productId: "p-last", laneId: "middle", targetIndex: 1 }], "dropping on a lane uses its unchanged position");
for (const activeView of ["roadmap", "split"]) {
  laneSandbox.activeView = activeView;
  assert.equal(laneSandbox.getCanvasDimensions().height, 34 + 1110 + 20, "other views do not reserve inline viewer space");
}
laneSandbox.activeView = "products";
for (const viewerInfoProductId of [null, "missing"]) {
  laneSandbox.viewerInfoProductId = viewerInfoProductId;
  assert.equal(laneSandbox.getCanvasDimensions().height, 34 + 1110 + 20, "closed/stale viewer IDs preserve lane height");
}
laneSandbox.viewerInfoProductId = "p-first";
laneSandbox.viewerInfoProgress = 0;
assert.equal(laneSandbox.getCanvasDimensions().height, 34 + 1110 + 20);
laneSandbox.viewerInfoProgress = 1;
visibleLaneProducts = laneProducts.filter((item) => item.id !== "p-first");
assert.equal(laneSandbox.getCanvasDimensions().height, 34 + 1110 + 20, "filtering out the viewed product preserves lane height");
visibleLaneProducts = laneProducts;
drawnLaneCards.length = 0;
laneSandbox.drawBoardTo(laneContext, laneSandbox.getCanvasDimensions());
const liveFollowingX = drawnLaneCards.find((item) => item.id === "p-following").x;
const exportDimensions = laneSandbox.getCanvasDimensions({ includeViewer: false });
assert.equal(exportDimensions.height, 34 + 1110 + 20, "exports preserve the same vertical geometry as the live board");
drawnLaneCards.length = 0;
laneSandbox.drawBoardTo(laneContext, exportDimensions, false);
assert.equal(drawnLaneCards.find((item) => item.id === "p-following").x, 18 + 256, "exports contain no temporary horizontal details gap");
assert.ok(liveFollowingX > 18 + 256, "the live board still makes horizontal room beside the viewed product");
// View actions operate on independent product and timeline scales. Execute
// their real bindings with small scroll/DOM adapters so moving a control
// cannot hide a broken Fit, zoom, or saved-layout action.
const viewSource = appSource.replace(/\r\n/g, "\n");
const viewHtml = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
function viewHtmlSection(id) {
  const section = viewHtml.match(new RegExp(`<section id="${id}"[\\s\\S]*?</section>`))?.[0];
  assert.ok(section, `view section is rendered: ${id}`);
  return section;
}
const productViewToolbar = viewHtmlSection("productControls");
const roadmapViewToolbar = viewHtmlSection("roadmapControls");
const viewSettingsSections = viewHtmlSection("settingsDisplayPanel") + viewHtmlSection("settingsTimelinePanel");
for (const [toolbar, actions] of [
  [productViewToolbar, ["zoomOut", "zoomReset", "zoomIn", "fitProducts", "resetLayout"]],
  [roadmapViewToolbar, ["roadmapZoomOut", "roadmapZoomReset", "roadmapZoomIn", "roadmapFit", "roadmapToday"]],
]) {
  for (const id of actions) {
    assert.ok(toolbar.includes(`id="${id}"`), `${id} stays available in its view toolbar`);
    assert.ok(!viewSettingsSections.includes(`id="${id}"`), `${id} is a view action outside workspace settings`);
  }
}
function viewSection(start, end) {
  const startIndex = viewSource.indexOf(start);
  const endIndex = viewSource.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `view action is present: ${start}`);
  return viewSource.slice(startIndex, endIndex);
}
function applicationFunction(name) {
  return viewSection(`function ${name}(`, "\n}\n") + "\n}\n";
}
function applicationClickBinding(id) {
  const start = `$("#${id}").onclick = `;
  const offset = viewSource.indexOf(start);
  assert.ok(offset >= 0, `view action has a binding: ${id}`);
  const line = viewSource.slice(offset).split("\n", 1)[0];
  return line.endsWith(";") ? line : viewSection(start, "\n};\n") + "\n};\n";
}
const viewElements = new Map();
function viewElement(selector) {
  if (!viewElements.has(selector)) viewElements.set(selector, { textContent: "", disabled: false });
  return viewElements.get(selector);
}
let productFitWidth = 1810;
let timelineFitMonths = 60;
let viewSelectedProduct = null;
const viewRenderCalls = [];
const normalizedViewLanes = [];
const viewBoard = { settings: { freeMove: true }, lanes: [{ id: "audio" }, { id: "accessories" }], products: [
  { id: "a", laneId: "audio", manualPosition: { x: 200, y: 100 }, order: 0 },
  { id: "b", laneId: "accessories", manualPosition: { x: 460, y: 100 }, order: 0 },
] };
const viewSandbox = {
  $: viewElement, zoom: 1, roadmapMonthWidth: 82, activeView: "products", board: viewBoard,
  ROADMAP_DEFAULT_MONTH_WIDTH: 82, ROADMAP_MIN_MONTH_WIDTH: 8, ROADMAP_MAX_MONTH_WIDTH: 164, ROADMAP_LEFT_WIDTH: 190,
  PRODUCT_MIN_ZOOM: .2, PRODUCT_MAX_ZOOM: 2,
  selectedProduct: () => viewSelectedProduct,
  canvasScroll: { clientWidth: 900, clientHeight: 520, scrollLeft: 120, scrollTop: 80,
    scrollTo(options) { if (options.left != null) this.scrollLeft = options.left; if (options.top != null) this.scrollTop = options.top; } },
  getCanvasDimensions: () => ({ width: productFitWidth, height: 700 }),
  roadmapRange: () => ({ start: 2026 * 12, count: timelineFitMonths }),
  requestAnimationFrame: (callback) => callback(), closePopupMenus() {}, stopProductCardDrag() {}, syncBoardNavigator() {},
  updateBoard: (callback) => callback(viewBoard),
  normalizeLaneOrders: (laneId) => normalizedViewLanes.push(laneId),
  renderBoard() { viewRenderCalls.push("products"); viewSandbox.syncViewZoomControls(); },
  renderRoadmaps() { viewRenderCalls.push(viewSandbox.activeView); viewSandbox.syncViewZoomControls(); },
};
function timelineScrollAdapter(clientWidth, scrollLeft) {
  return { clientWidth, scrollLeft, scrollTop: 65,
    get scrollWidth() { return 190 + timelineFitMonths * viewSandbox.roadmapMonthWidth + 24; },
    scrollTo(options) { if (options.left != null) this.scrollLeft = options.left; if (options.top != null) this.scrollTop = options.top; },
  };
}
viewSandbox.roadmapScroll = timelineScrollAdapter(900, 500);
viewSandbox.splitRoadmapScroll = timelineScrollAdapter(700, 320);
vm.createContext(viewSandbox);
vm.runInContext(
  ["clampViewZoom", "snappedViewZoom", "steppedViewZoom", "syncViewZoomControls", "setProductZoom", "setRoadmapZoom", "fitRoadmapTimeline", "fitProductBoard"].map(applicationFunction).join("\n") +
  ["zoomOut", "zoomReset", "zoomIn", "resetLayout", "fitProducts", "roadmapZoomOut", "roadmapZoomReset", "roadmapZoomIn", "roadmapFit"].map(applicationClickBinding).join("\n"),
  viewSandbox,
);
const timelineCenterMonth = (scroll) => (scroll.scrollLeft + (scroll.clientWidth - 190) / 2) / viewSandbox.roadmapMonthWidth;
viewSandbox.syncViewZoomControls();
assert.equal(viewElement("#zoomReset").textContent, "100%");
assert.equal(viewElement("#roadmapZoomReset").textContent, "100%");
viewSelectedProduct = viewBoard.products[0];
viewSandbox.syncViewZoomControls();
for (const activeView of ["roadmap", "split"]) {
  viewSandbox.activeView = activeView;
  viewSandbox.roadmapMonthWidth = 82;
  const targetScroll = activeView === "split" ? viewSandbox.splitRoadmapScroll : viewSandbox.roadmapScroll;
  const otherScroll = activeView === "split" ? viewSandbox.roadmapScroll : viewSandbox.splitRoadmapScroll;
  targetScroll.scrollLeft = 500;
  const originalOtherLeft = otherScroll.scrollLeft;
  const originalMonth = timelineCenterMonth(targetScroll);
  const originalTop = targetScroll.scrollTop;
  viewElement("#roadmapZoomIn").onclick();
  closeTo(viewSandbox.roadmapMonthWidth, 90.2, "timeline plus advances by ten percentage points");
  closeTo(timelineCenterMonth(targetScroll), originalMonth, "timeline zoom anchors the visible month center outside the frozen labels");
  assert.equal(targetScroll.scrollTop, originalTop, "horizontal zoom preserves vertical timeline position");
  assert.equal(otherScroll.scrollLeft, originalOtherLeft, "zoom adjusts only the visible roadmap viewport");
  assert.equal(viewSandbox.zoom, 1, "timeline zoom cannot change the product scale");
  assert.equal(viewElement("#roadmapZoomReset").textContent, "110%");
  viewElement("#roadmapZoomOut").onclick();
  closeTo(viewSandbox.roadmapMonthWidth, 82, "timeline minus returns to the previous ten-point zoom stop");
  closeTo(timelineCenterMonth(targetScroll), originalMonth, "inverse timeline zoom retains the anchored month");
  viewSandbox.setRoadmapZoom(200);
  closeTo(viewSandbox.roadmapMonthWidth, 164, "timeline zoom reaches the 200% stop within its safe maximum width");
  assert.equal(viewElement("#roadmapZoomReset").textContent, "200%");
  assert.equal(viewElement("#roadmapZoomIn").disabled, true);
  viewElement("#roadmapZoomIn").onclick();
  closeTo(viewSandbox.roadmapMonthWidth, 164, "plus cannot exceed the timeline maximum");
  viewSandbox.setRoadmapZoom(1);
  closeTo(viewSandbox.roadmapMonthWidth, 8.2, "timeline zoom uses the lowest ten-point stop within its safe minimum width");
  assert.equal(viewElement("#roadmapZoomReset").textContent, "10%");
  assert.equal(viewElement("#roadmapZoomOut").disabled, true);
  viewElement("#roadmapZoomOut").onclick();
  closeTo(viewSandbox.roadmapMonthWidth, 8.2, "minus cannot go below the timeline minimum");
  viewElement("#roadmapZoomReset").onclick();
  assert.equal(viewSandbox.roadmapMonthWidth, 82, "the timeline percentage restores the shared default scale");
  assert.equal(viewElement("#roadmapZoomReset").textContent, "100%");
  assert.equal(viewElement("#roadmapZoomOut").disabled, false);
  assert.equal(viewElement("#roadmapZoomIn").disabled, false);
  viewElement("#roadmapFit").onclick();
  closeTo(viewSandbox.roadmapMonthWidth, 32.8, "Fit uses a clean 40% overview for a long timeline");
  assert.equal(viewElement("#roadmapZoomReset").textContent, `${Math.round(viewSandbox.roadmapMonthWidth / 82 * 100)}%`, "Fit updates the visible timeline percentage");
  assert.equal(viewSandbox.zoom, 1, "timeline Fit leaves the product scale unchanged");
}
timelineFitMonths = 3;
viewElement("#roadmapFit").onclick();
closeTo(viewSandbox.roadmapMonthWidth, 155.8, "fitting a short timeline chooses the largest clean ten-point stop that fits");
timelineFitMonths = 120;
viewElement("#roadmapFit").onclick();
closeTo(viewSandbox.roadmapMonthWidth, 32.8, "fitting a long timeline retains a readable40% overview and allows horizontal scrolling");
viewSandbox.splitRoadmapScroll.scrollLeft = 0;
viewSandbox.setRoadmapZoom(8);
assert.ok(viewSandbox.splitRoadmapScroll.scrollLeft >= 0, "zoom at the timeline origin never requests negative scrolling");
timelineFitMonths = 60;
viewSandbox.activeView = "products";
const retainedTimelineWidth = viewSandbox.roadmapMonthWidth;
viewElement("#zoomOut").onclick();
assert.equal(viewSandbox.zoom, .9);
assert.equal(viewElement("#zoomReset").textContent, "90%");
viewElement("#zoomIn").onclick();
assert.equal(viewSandbox.zoom, 1);
viewSandbox.zoom = 2;
viewElement("#zoomIn").onclick();
assert.equal(viewSandbox.zoom, 2, "product plus cannot exceed its 200% maximum scale");
assert.equal(viewElement("#zoomIn").disabled, true);
viewElement("#fitProducts").onclick();
assert.equal(viewSandbox.zoom, .7, "Fit products keeps a long lane readable at a clean percentage");
assert.equal(viewElement("#zoomReset").textContent, "70%");
productFitWidth = 100000;
viewElement("#fitProducts").onclick();
assert.equal(viewSandbox.zoom, .7, "fitting an exceptionally long lane retains the readable overview floor");
assert.equal(viewElement("#zoomOut").disabled, false, "the user can still zoom out manually after readable Fit");
productFitWidth = 100;
viewElement("#fitProducts").onclick();
assert.equal(viewSandbox.zoom, 1, "fitting a short lane does not enlarge its cards above normal size");
viewSandbox.zoom = .5;
viewElement("#zoomReset").onclick();
assert.equal(viewSandbox.zoom, 1, "clicking the product percentage resets zoom only");
assert.ok(viewBoard.products.every((product) => product.manualPosition), "resetting zoom preserves the saved product layout");
viewSandbox.zoom = .65;
viewElement("#resetLayout").onclick();
assert.equal(viewSandbox.zoom, 1, "Reset layout restores normal product scale");
assert.ok(viewBoard.products.every((product) => !Object.hasOwn(product, "manualPosition")), "Reset layout restores automatic card positions");
assert.equal(viewBoard.settings.freeMove, false);
assert.deepEqual(normalizedViewLanes, ["audio", "accessories"], "Reset layout normalizes each saved product lane");
assert.equal(viewSandbox.roadmapMonthWidth, retainedTimelineWidth, "all product view actions preserve the shared timeline scale");
assert.ok(viewRenderCalls.includes("roadmap") && viewRenderCalls.includes("split") && viewRenderCalls.includes("products"), "view controls render the active Products, Roadmap, and details surfaces");

console.log("Portfolio model checks passed: explicit lifecycle date/month synchronization without initial migration, global timeline actions, preserved specs/SKU colors, shared prices/stage tones, non-overlapping inline details, and independent view zoom/Fit/reset actions.");
