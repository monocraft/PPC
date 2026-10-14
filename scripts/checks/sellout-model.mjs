import assert from "node:assert/strict";
await import("../../public/js/sellout-model.js");
const model = globalThis.PPCSelloutModel;
assert.ok(Object.isFrozen(model));

const periodDates = ["2025-01-05", "2025-01-12", "2025-01-19", "2025-01-26", "2025-02-02", "2025-02-09", "2025-02-16", "2025-02-23"];
const fixture = {
  schemaVersion: 1, title: "Fixture only", sourceUrl: "", sheet: "Fixture", asOf: "2025-02-23", warnings: [],
  periods: periodDates.map((date) => ({ date, label: date, quarter: date < "2025-02-01" ? "FY25Q1" : "FY25Q2" })),
  rows: [
    { store: "North", sku: "A", product: "Alpha", category: "Audio", lifetime: 61, values: [10, 0, -2, 8, 15, 10, 20, null] },
    { store: "North", sku: "B", product: "Beta", category: "Input", lifetime: 10, values: [null, null, 0, 0, 4, 6, 0, null] },
    { store: "South", sku: "A", product: "Alpha", category: "Audio", lifetime: 37, values: [5, 5, 5, 5, 5, 5, 7, 0] },
    { store: "South", sku: "C", product: "Gamma", category: "Audio", lifetime: null, values: [null, null, null, null, null, null, null, null] },
  ],
};
assert.equal(model.validateSnapshot(fixture).ok, true);
const original = structuredClone(fixture);
const all = model.analyze(fixture);
assert.equal(all.selection.end, "2025-02-16", "Default shared cutoff must follow the earliest reporting retailer.");
assert.equal(all.coverage.commonEnd, "2025-02-16");
assert.equal(all.coverage.excludedWeeks, 1);
assert.equal(all.totals.current, 108);
assert.equal(all.totals.observedWeeks, 7);
assert.equal(all.totals.avgWeekly, 108 / 7);
assert.equal(all.totals.growth, null, "An unavailable full baseline must not become a growth percentage.");
assert.equal(all.totals.numericCells, 19);
assert.equal(all.totals.missingCells, 9);
assert.equal(all.totals.zeroCells, 4);
assert.equal(all.totals.negativeCells, 1);
assert.equal(all.totals.negativeUnits, -2);
assert.equal(all.heatmap.find((entry) => entry.store === "North").values[2], -2);
assert.deepEqual(fixture, original, "Analysis must never mutate the imported snapshot.");

const available = model.analyze(fixture, { coverage: "available", comparison: "none" });
assert.equal(available.selection.end, "2025-02-23");
assert.equal(available.series.at(-1).current, 0, "A reported zero is a real observation even when the other store is missing.");
assert.equal(available.series.at(-1).observedRows, 1);
assert.equal(available.heatmap.find((entry) => entry.store === "North").values.at(-1), null);
assert.equal(available.totals.observedWeeks, 8);
assert.equal(available.totals.previous, null);
assert.equal(available.totals.delta, null);
const negativeWeek = model.weekObservation(available, "2025-01-19");
assert.equal(negativeWeek.date, "2025-01-19"); assert.equal(negativeWeek.index, 2);
assert.equal(negativeWeek.current, 3); assert.equal(negativeWeek.observedRows, 3); assert.equal(negativeWeek.totalObservedRows, 3); assert.equal(negativeWeek.totalRows, 4);
assert.deepEqual(negativeWeek.retailers, [{ key: "North", name: "North", current: -2 }, { key: "South", name: "South", current: 5 }], "Pinned weekly readouts preserve negative source adjustments and use filtered retailer aggregates.");
const zeroAndMissingWeek = model.weekObservation(available, "2025-02-23");
assert.equal(zeroAndMissingWeek.current, 0); assert.equal(zeroAndMissingWeek.observedRows, 1);
assert.deepEqual(zeroAndMissingWeek.retailers, [{ key: "North", name: "North", current: null }, { key: "South", name: "South", current: 0 }], "A missing retailer remains null beside another retailer's reported zero.");
assert.equal(model.weekObservation(available).date, "2025-02-23", "A null input selects the latest selected calendar point.");
assert.equal(model.weekObservation(available, "2025-01-08").date, "2025-01-05");
assert.equal(model.weekObservation(available, "2024-01-01").date, "2025-01-05");
assert.equal(model.weekObservation(available, "2026-01-01").date, "2025-02-23");
assert.throws(() => model.weekObservation(available, 1736035200000), /ISO date string/);

const selected = model.analyze(fixture, { stores: ["North"], products: ["A"], categories: ["Audio"], start: "2025-02-02", end: "2025-02-16" });
assert.equal(selected.totals.current, 45);
assert.equal(selected.totals.previous, 6, "Previous comparison is three exact prior weekly dates, aligned relatively.");
assert.equal(selected.totals.comparableCurrent, 45);
assert.equal(selected.totals.comparablePrevious, 6);
assert.equal(selected.totals.delta, 39);
assert.equal(selected.totals.growth, 6.5);
assert.equal(selected.series[0].comparisonDate, "2025-01-12");
assert.deepEqual(selected.series.map((point) => point.previous), [0, -2, 8]);
assert.equal(selected.totals.pairedCells, 3);
assert.equal(selected.top.product.sku, "A");
assert.equal(selected.storeProducts[0].last, "2025-02-16");
assert.equal(selected.storeCategories[0].current, 45);
const scopedObservation = model.weekObservation(selected, "2025-02-09");
assert.equal(scopedObservation.current, 10); assert.equal(scopedObservation.totalRows, 1);
assert.deepEqual(scopedObservation.retailers, [{ key: "North", name: "North", current: 10 }], "Weekly readouts expose only selected retailer/product/category scope, without source snapshot leakage.");
assert.deepEqual(selected, model.analyze(fixture, { stores: ["North"], products: ["A"], categories: ["Audio"], start: "2025-02-02", end: "2025-02-16" }), "Reading a pinned week never mutates analysis.");

const baselineMissing = model.analyze(fixture, { stores: ["North"], products: ["B"], start: "2025-01-19", end: "2025-02-09" });
assert.equal(baselineMissing.totals.current, 10);
assert.equal(baselineMissing.totals.previous, null);
assert.equal(baselineMissing.totals.growth, null);
assert.equal(baselineMissing.totals.delta, null);
assert.equal(baselineMissing.totals.pairedCells, 0);
const blankProduct = model.analyze(fixture, { stores: ["South"], products: ["C"] });
assert.equal(blankProduct.totals.current, null);
assert.equal(blankProduct.totals.observedWeeks, 0);
assert.deepEqual(blankProduct.coverage.noDataStores, ["South"]);
assert.equal(blankProduct.selection.end, null);
const empty = model.analyze(fixture, { stores: ["Unknown"] });
assert.equal(empty.totals.current, null);
assert.equal(empty.products.length, 0);
assert.deepEqual(model.weekObservation(empty), { date: null, index: -1, current: null, observedRows: 0, totalObservedRows: 0, totalRows: 0, retailers: [] });
assert.equal(model.analyze(fixture, { start: "2025-03-01", end: "2025-01-01" }).periods.length, 0);

const pairedFixture = structuredClone(fixture);
pairedFixture.rows[0].values[1] = null;
const paired = model.analyze(pairedFixture, { stores: ["North"], products: ["A"], start: "2025-02-02", end: "2025-02-16" });
assert.equal(paired.totals.current, 45);
assert.equal(paired.totals.comparableCurrent, 30, "Current units without matching observations must be excluded from comparison arithmetic.");
assert.equal(paired.totals.comparablePrevious, 6);
assert.equal(paired.totals.delta, 24);
assert.equal(paired.totals.growth, 4);
assert.equal(paired.totals.pairedCells, 2);

const yearDates = Array.from({ length: 54 }, (_, index) => model.addDays("2024-01-07", index * 7));
const yearFixture = { ...fixture, periods: yearDates.map((date) => ({ date, label: date, quarter: model.fiscalQuarter(date) })), rows: [{ store: "North", sku: "A", product: "Alpha", category: "Audio", lifetime: 55, values: yearDates.map((_, index) => index === 0 ? 10 : index === 52 ? 30 : 1) }] };
const year = model.analyze(yearFixture, { start: yearDates[52], end: yearDates[52], comparison: "year" });
assert.equal(year.series[0].comparisonDate, yearDates[0]);
assert.equal(year.totals.previous, 10);
assert.equal(year.totals.growth, 2);
const missingYear = structuredClone(yearFixture);
missingYear.periods.splice(0, 1); missingYear.rows[0].values.splice(0, 1);
assert.equal(model.analyze(missingYear, { start: yearDates[52], end: yearDates[52], comparison: "year" }).totals.growth, null, "Year comparison must use exactly 52 weeks, never the nearest date.");
assert.equal(model.growth(10, 0), null);
assert.equal(model.growth(10, -1), null);

const gapDates = ["2025-01-05", "2025-01-12", "2025-01-19", "2025-01-26", "2025-02-09"];
const gapFixture = { ...fixture, periods: gapDates.map((date) => ({ date, label: date, quarter: "FY25Q1" })), rows: [{ store: "North", sku: "A", product: "Alpha", category: "Audio", lifetime: 160, values: [10, 20, 30, 40, 60] }] };
const gap = model.analyze(gapFixture, { start: "2025-01-26", end: "2025-02-09", comparison: "previous" });
assert.equal(gap.totals.current, 100, "Missing calendar weeks must not invent selected observations.");
assert.equal(gap.totals.selectedWeeks, 2);
assert.equal(gap.coverage.calendarSpanDays, 21, "Previous windows use the full selected calendar span, including its gap.");
assert.equal(gap.coverage.comparisonCalendarWeeks, 3);
assert.deepEqual(gap.series.map((point) => point.comparisonDate), ["2025-01-05", "2025-01-19"]);
assert.ok(gap.series.every((point) => point.comparisonDate < gap.selection.start), "Previous dates cannot overlap a gapped current window.");
assert.equal(gap.totals.previous, 40, "Only matching selected weekly positions contribute to comparison sums.");
assert.equal(gap.totals.delta, 60);
assert.equal(gap.totals.growth, 1.5);
assert.equal(gap.coverage.comparisonComplete, true);
assert.equal(model.weekObservation(gap, "2025-02-02").date, "2025-01-26", "Nearest-point calendar ties across a missing week choose the earlier actual point.");
assert.equal(model.weekObservation(gap, "2025-02-06").date, "2025-02-09");
const singleWeek = model.analyze(gapFixture, { start: "2025-02-09", end: "2025-02-09", comparison: "none" });
assert.equal(model.weekObservation(singleWeek, "2025-01-01").date, "2025-02-09");
assert.equal(model.weekObservation(singleWeek).current, 60);
const gapBaseline = structuredClone(gapFixture);
gapBaseline.periods.splice(1, 1); gapBaseline.rows[0].values.splice(1, 1);
const incompleteGap = model.analyze(gapBaseline, { start: "2025-01-26", end: "2025-02-09", comparison: "previous" });
assert.deepEqual(incompleteGap.coverage.missingComparisonDates, ["2025-01-12"]);
assert.equal(incompleteGap.totals.comparablePrevious, 40, "Observed paired evidence remains available when an unpaired baseline calendar date is absent.");
assert.equal(incompleteGap.totals.comparisonComplete, false);
assert.equal(incompleteGap.totals.growth, null, "An incomplete baseline calendar window cannot support headline growth.");
assert.equal(incompleteGap.products[0].growth, null);
assert.equal(incompleteGap.storeProducts[0].delta, null);

const duplicate = structuredClone(fixture); duplicate.rows.push(structuredClone(duplicate.rows[0]));
assert.equal(model.validateSnapshot(duplicate).ok, false);
assert.match(model.validateSnapshot(duplicate).errors.join(" "), /Duplicate store\/SKU/);
assert.throws(() => model.analyze(duplicate), /double count/);
const unordered = structuredClone(fixture); unordered.periods.reverse();
assert.equal(model.validateSnapshot(unordered).ok, false);
const invalid = structuredClone(fixture); invalid.rows[0].values[0] = "10";
assert.equal(model.validateSnapshot(invalid).ok, false);
const malformedISO = structuredClone(fixture); malformedISO.periods[0].date = "2025-02-30";
assert.equal(model.validateSnapshot(malformedISO).ok, false);
for (const field of ["store", "sku", "product", "category"]) {
  for (const value of [1, 2, null, {}, { toString: "invalid coercion" }, [], "", "   "]) {
    const badField = structuredClone(fixture); badField.rows[0][field] = value;
    assert.equal(model.validateSnapshot(badField).ok, false, `${field} must reject nonstring or empty identity values before localeCompare/name rendering.`);
    assert.throws(() => model.analyze(badField), /nonempty string/);
  }
  const numericText = structuredClone(fixture); numericText.rows[0][field] = "123";
  assert.equal(model.validateSnapshot(numericText).ok, true, `A real string identifier remains valid for ${field}.`);
}
for (const sku of ["__proto__", "constructor", "prototype", " __proto__ "]) {
  const unsafeSku = structuredClone(fixture); unsafeSku.rows[0].sku = sku;
  assert.equal(model.validateSnapshot(unsafeSku).ok, false);
  assert.throws(() => model.analyze(unsafeSku), /reserved SKU/);
  assert.throws(() => model.normalizeWorkbookRows(model.parseCsv(`store,sku,product,category,date,units\nNorth,${sku},Alpha,Audio,2025-01-05,1`)), /reserved SKU/);
}
for (const field of ["title", "sourceUrl", "sheet"]) {
  const badMetadata = structuredClone(fixture); badMetadata[field] = 1;
  assert.equal(model.validateSnapshot(badMetadata).ok, false);
}
const longTitle = structuredClone(fixture); longTitle.title = "x".repeat(1001);
assert.equal(model.validateSnapshot(longTitle).ok, false);
const badQuarter = structuredClone(fixture); badQuarter.periods[0].quarter = 1;
assert.equal(model.validateSnapshot(badQuarter).ok, false);
const badAsOf = structuredClone(fixture); badAsOf.asOf = "2025-02-30";
assert.equal(model.validateSnapshot(badAsOf).ok, false);
const badWarning = structuredClone(fixture); badWarning.warnings = [null];
assert.equal(model.validateSnapshot(badWarning).ok, false);

assert.deepEqual(model.parseCsv('Store,SKU,Product\r\n"North, flagship",A,"Alpha ""Plus""\nEdition"\r\n'), [["Store", "SKU", "Product"], ["North, flagship", "A", 'Alpha "Plus"\nEdition']]);
assert.throws(() => model.parseCsv('"unfinished'), /unterminated/);
assert.throws(() => model.parseCsv('"valid"bad'), /Unexpected/);
assert.equal(model.parseNumber("0"), 0);
assert.equal(model.parseNumber(""), null);
assert.equal(model.parseNumber("(1,234)"), -1234);
assert.equal(model.parseNumber("#VALUE!"), null);
assert.equal(model.parseDate("2025-02-30"), null);
assert.equal(model.parseDate("Oct27'24"), "2024-10-27");
assert.equal(model.parseDate("May18’25"), "2025-05-18");
assert.equal(model.parseDate("Jun 1, 2025"), "2025-06-01");
assert.equal(model.parseDate("11/3", { quarter: "FY25Q1" }), "2024-11-03");
assert.equal(model.normalizeQuarter("Q1 FY2025"), "FY25Q1");

const wide = [
  ["", "", "", "", "", "FY25Q3", "", "", "FY25Q4", "", ""],
  ["Account", "HP SKU", "Product Description", "Category", "Lifetime", "May18'25", "May'25", "Jun01'25", "Aug31'25", "Sep07'24", "Sep14'25"],
  ["North", "A", "Alpha", "Audio", 15, 0, "", -2, 5, 7, 5],
  ["", "B", "Beta", "Input", 4, 1, 1, 2, null, null, null],
];
const imported = model.normalizeWorkbookRows(wide, { title: "Fixture", asOf: "2025-09-14", sheet: "Fixture" });
assert.deepEqual(imported.periods.map((period) => period.date), ["2025-05-18", "2025-05-25", "2025-06-01", "2025-08-31", "2025-09-07", "2025-09-14"]);
assert.equal(imported.periods[1].originalHeader, "May'25");
assert.equal(imported.periods[4].originalHeader, "Sep07'24");
assert.equal(imported.periods[0].originalHeader, "May18'25");
assert.equal(imported.periods[4].quarter, "FY25Q4");
assert.equal(imported.warnings.filter((warning) => warning.type === "date-correction").length, 2);
assert.equal(imported.rows[1].store, "North", "Merged store cells should propagate only to actual SKU rows.");
assert.deepEqual(imported.rows[0].values.slice(0, 3), [0, null, -2]);
assert.deepEqual(wide[1].slice(5), ["May18'25", "May'25", "Jun01'25", "Aug31'25", "Sep07'24", "Sep14'25"], "Import must preserve the source matrix.");
const unsupportedCorrection = structuredClone(wide); unsupportedCorrection[1][6] = "May'25"; unsupportedCorrection[1][7] = "Jun08'25";
assert.throws(() => model.normalizeWorkbookRows(unsupportedCorrection), /Cannot resolve/);
const duplicateWide = [...wide, structuredClone(wide[2])];
assert.equal(model.normalizeWorkbookRows(duplicateWide).rows.length, 2, "An exact duplicated line should be safely omitted with a warning.");
const conflictingWide = [...wide, [...wide[2]]]; conflictingWide.at(-1)[5] = 99;
assert.throws(() => model.normalizeWorkbookRows(conflictingWide), /Duplicate store\/SKU/);

const tidy = model.normalizeWorkbookRows(model.parseCsv('store,sku,product,category,date,units\nNorth,A,Alpha,Audio,2025-01-12,0\nNorth,A,Alpha,Audio,2025-01-05,-2\nSouth,B,Beta,Input,2025-01-12,\nNorth,A,Alpha,Audio,2025-01-12,0\n'));
assert.deepEqual(tidy.periods.map((period) => period.date), ["2025-01-05", "2025-01-12"]);
assert.deepEqual(tidy.rows[0].values, [-2, 0]);
assert.deepEqual(tidy.rows[1].values, [null, null]);
assert.equal(tidy.warnings.filter((warning) => warning.type === "duplicate-observation").length, 1);
assert.throws(() => model.normalizeWorkbookRows(model.parseCsv('store,sku,date,units\nNorth,A,2025-01-12,1\nNorth,A,2025-01-12,2')), /Conflicting duplicate/);
assert.deepEqual(model.options(fixture).stores, ["North", "South"]);
assert.equal(model.options(fixture).products.length, 3);
console.log("Sellout model: import, missing/zero/negative values, shared cutoffs, paired comparisons, gapped calendar windows, exact year alignment, filters, and duplicate safeguards passed.");
