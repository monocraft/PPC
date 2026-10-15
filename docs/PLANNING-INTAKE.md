# Planning intake

Planning intake previews local `.xlsx`, `.csv` and `.tsv` files before changing the portfolio. It does not upload workbooks or contact a backend. It uses the existing bounded ASCM ZIP reader and PLC calendar-date parser. Macros, external workbook relationships and formula calculations are never executed; formula cells are unavailable for automatic extraction.

The input needs a product/working-name or codename header plus a category, FFS/date or launch-quarter column. Common generic headers and the prepared planning-analysis workbook's **Product collection**, **Planning candidates** and **PLC source** tables are supported. When several supported sheets exist, select one collection at a time. The full Product collection is the initial choice when present.

Every row requires a Match, Create or Ignore decision. Exact SKU, codename and name matches are suggestions. A previously reviewed immutable source ID provides stronger lineage. New products require an explicit category and lane, receive a stable generated product identity, and retain a provisional working name. Existing products keep their category, lifecycle stage, images, layout and unrelated fields. Multiple source rows cannot update the same product in one application; review separate observations separately.

Each changed name, codename or milestone needs its own checked review field. A source launch quarter is shown as an unaccepted FFS proposal; the reviewer must choose it explicitly. Blank cells never clear accepted dates. Exact dates and calendar quarters retain their precision. A typed first-day anchor declared as a month, range or half-year remains unresolved until the reviewer enters an explicit supported estimate. Unconfirmed multiple source dates likewise require an explicit selection. A day-shaped planning value does not establish an official release or actual shipment.

The separate device-local field protection policy is checked during preview and immediately before preparing a write. A selected protected date requires the row's explicit override checkbox. Unavailable protection storage blocks date changes. The host also rechecks protection and the entire preview baseline immediately before committing.

Matching decisions are remembered on this device under `ppc-planning-decisions-v1`, bounded to 1,000 mappings and 2 MiB. This storage contains source identity keys, source file fingerprints and selected product/category/lane IDs. It contains no workbook bytes, source names, date values or approved field selections. Reloaded mappings never approve changed fields. Explicit source IDs survive revised filenames when the reviewer keeps the same Source collection and worksheet. Without an immutable source ID, the exact file fingerprint and row form the source identity; revised files need another identity review. Reimporting an unchanged reviewed file produces no duplicate products or changed evidence clocks.

## Host integration

Load `planning-intake.js` after `ascm-import.js`, `date-precision.js`, `plc-import.js` and `master-model.js`. Load `planning-intake-ui.js` plus `planning-intake.css` and create a controller:

```js
const planning = PortfolioPlanningIntakeUI.create({
  getPortfolio: () => portfolio,
  applyPlanning: result => commitReviewedPlanning(result),
  openProduct: productId => showProduct(productId),
  onStateChange: state => updateNeedsReviewCount(state.rowCount),
});
planning.open();
```

`planning.open(file)` accepts a file already selected in Load data, opens the same review and returns its parse promise. It does not apply decisions or open another file picker.

The optional `onStateChange` callback receives a detached `{ busy, rowCount, source, decisions }` snapshot when review state changes. It can update a Needs review count without reading source records. Callback failures cannot interrupt parsing, review or persistence.

`PortfolioPlanningIntake.parseFile(file, { sourceFamily, sheetName })` returns inert normalized rows, source SHA-256 and supported sheet choices. `buildReview(dataset, portfolio)` records the exact current JSON baseline and ranked identity suggestions. `applyReview(review, decisions, portfolio)` validates each explicit choice and returns operations without mutating input.

The host adapter must compare `PortfolioPlanningIntake.baseline(currentPortfolio)` with `result.expectedBaseline` after asynchronous preparation and before the durable write. Each operation has `kind`, `productId`, `categoryId`, `laneId`, approved `fields`, `overrideProtected`, an expected product snapshot and source proof. Apply these operations to a cloned portfolio, validate the resulting schema, save atomically, and activate only after persistence succeeds. A conflict or failed save must preserve the open workspace. Do not send the entire result or source workbook to the shared service; use the ordinary reviewed portfolio save path.

Version 1 PLC metadata stores reviewed field provenance and a bounded `planningSources` identity list. This uses the existing evidence schema and does not require a new shared backend schema.

Run local checks with `node scripts/checks/planning-intake.mjs`, `node scripts/checks/planning-intake-ui.mjs` and `node scripts/checks/planning-intake-workspace.mjs`. They use invented records, generated XLSX/CSV inputs, a synthetic DOM and the actual app bridge/date-clock/master-client functions, with no live backend calls.
