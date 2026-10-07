# Project Audit

Audit snapshot: 2026-10-07. Original archive/package provenance below is retained from the 2026-09-22 synchronization.

This document describes the synchronized source baseline and the separate working-data package. It is an implementation audit, not a promise that every risk listed below has already been corrected.

The complete behavior, controls, category/template inventory, settings ownership, and source search anchors are indexed in [Feature Index](FEATURE-INDEX.md). This audit focuses on architecture and material risks.

## 1. Provenance and baseline integrity

| Artifact | Evidence | Interpretation |
| --- | --- | --- |
| Original source archive | `PPC-main.zip`; SHA-256 `61032432E31AC18A985F9748E56ED1A63DE7E2EACE4D5CEE55BB9B565DB16AF3` | Historical code baseline supplied for the 2026-09-22 synchronization |
| Archive inventory | 111 ZIP entries: 94 files and 17 directories | The local source was replaced from this archive and file hashes were verified during synchronization |
| Working package | `project-data/private/product-portfolio-project.pkg`; SHA-256 `3FB436E56FAE28CC7FE125030841690039084679C15619CDDC763DA6D2D5B3A4` | Authoritative working portfolio data supplied separately from the code |
| Package format | Stored ZIP with `portfolio.json` plus one PNG entry | Compatible with the application's custom uncompressed package reader |
| Historical version control | No `.git` repository was present at the 2026-09-22 synchronization | Superseded by the 2026-10-07 repository connection |
| Current version control | `https://github.com/monocraft/PPC.git`; local `main` tracks `origin/main` | Connected on 2026-10-07; current local application files remain authoritative |
| Connection baseline | `6665bd6e7e7589b31f317f3e931d8cfb6fec35ce`, 2026-09-23, `Color Variant` | Branch/index alignment preserved core application file hashes |
| Published code update | `548c9363fbc67bd949e671187f613da5033c05dc`, 2026-10-07, `Update portfolio workspace and parent-height product details` | Pushed to `origin/main` as a normal fast-forward update; [Pages workflow run 37658673619](https://github.com/monocraft/PPC/actions/runs/37658673619) succeeded |
| Pages configuration | `build_type: workflow`, confirmed by re-reading the authenticated Pages API | Replaces legacy `main` branch-root publishing so the reviewed static-site allowlist is the publishing path |
| Live publication verification | All nine public HTML/CSS/application JavaScript files returned HTTP 200 and matched commit `548c936` byte-for-byte by SHA-256 comparison | Browser opening confirmed the live app renders correctly with the expected empty starter portfolio |

The source archive and package serve different purposes:

- The archive defines application code, static assets, templates, and deployment configuration.
- The package defines the current private portfolio content used for local testing and continued editing.
- The package is deliberately kept under `project-data/private/`, ignored by Git, and excluded from deployment. Publishing it requires a separate, explicit content/security decision.

The fetched connection baseline nevertheless already tracked `project-data/private/product-portfolio-project.pkg`. On 2026-10-07 it was removed from the local Git index only; the working package remains on disk. Commit `548c936` was pushed to `origin/main` and removes the package from the repository's current tree. Screenshots under `artifacts/` are also now ignored. Prior Git history still contains the tracked package. The Pages deployment allowlist excludes private packages independently of Git tracking.

## 2. Inventory

### 2.1 Default catalog

`public/js/catalog-data.js` defines a version 1 catalog with:

- 11 categories
- 16 lanes
- 18 specification sets
- 0 product records

Category IDs, in source order:

1. `pc-gaming-audio`
2. `console-gaming-audio`
3. `lifestyle-audio`
4. `audio-accessories`
5. `microphones`
6. `microphone-accessories`
7. `keyboards`
8. `mice`
9. `accessories`
10. `controllers`
11. `backpacks`

The `public/assets/` directory contains 85 WebP files and two SVG files. Because the source catalog has no products, those WebP files are not referenced by default product records. Restoring the sample/default workspace therefore creates the category structure but no cards.

### 2.2 Private working package

The version 4 package contains 11 categories, 85 products, and 85 image-asset records. Of the image assets, 84 are URL-backed and one is a local binary included as a PNG package entry.

| Category | Products |
| --- | ---: |
| PC gaming audio | 14 |
| Console gaming audio | 11 |
| Lifestyle audio | 7 |
| Audio accessories | 3 |
| Microphones | 8 |
| Microphone accessories | 4 |
| Keyboards | 7 |
| Mice | 13 |
| Accessories | 11 |
| Controllers | 5 |
| Backpacks | 2 |
| **Total** | **85** |

This package passed structural inspection for the expected category/product/image counts, duplicate product IDs, and the packaged local-image entry. Remote images still depend on their URLs being reachable in the browser.

### 2.3 Later supplied package and specification comparison

The later local `product-portfolio-project_09232026.pkg` contains **198 products** (SHA-256 `884D6E1E42A9AFA3F045B131EDAC5A5BEB8CB079C1D468658F18520B54BD83B3`). Its manifest was compared with both the original private 85-product package and the separate 85-product `product-portfolio-project 1.pkg` by joining product IDs and comparing serialized specification arrays.

- All 85 original product IDs are present; their specification arrays are exactly unchanged.
- The later package adds 113 product IDs: four have specification content, and 109 have empty specifications.
- 176 products carry ASCM source metadata.

The supplied snapshots therefore do **not** demonstrate deletion of original specification arrays. The 109 blank new records are consistent with ASCM additions because the report contains no specification facts. This comparison cannot reconstruct every earlier browser session. The confirmed unsaved-specification editor defect and destructive old PN/variant merge paths were corrected independently. These local packages remain ignored/private and were not modified during the audit.

The current importer initializes **future new ASCM products only** with editable category/lane specification placeholders. It does not backfill matched empty arrays or alter the historical packages; template fields are not claimed to be source facts.

## 3. Runtime architecture

The application is a static, client-only system. There is no server API, database service, framework, bundler, or compilation step. The current site tree is `public/`; the local server and Pages workflow serve its contents at the site root. Development checks live under `scripts/checks/`, separate from public runtime files. The root README remains a short public introduction.

```text
public/index.html
  ├─ public/css/styles.css
  ├─ public/vendor/pptxgen.bundle.js  → global PptxGenJS export support
  ├─ public/js/catalog-data.js       → window.PORTFOLIO_CATALOG
  ├─ public/js/ascm-import.js        → global ASCMImporter XLSX/matching helpers
  ├─ public/js/pptx-pagination.js    → global PPTXPagination pure page calculation
  ├─ public/js/portfolio-model.js    → global PortfolioModel timeline/lane/spec/SKU/tone rules
  ├─ public/js/product-details.js    → global PortfolioDetails Overview/secondary lists
  ├─ public/js/app.js
       ├─ normalize/migrate portfolio state
       ├─ render Product and Roadmap canvases
       ├─ render optional Roadmap DOM details + roadmap canvas
       ├─ manage editing and navigation
       ├─ persist metadata to localStorage
       ├─ persist local image blobs to IndexedDB
       ├─ preview and apply local ASCM updates
       └─ import/export data, packages, PNG, and PPTX
  └─ public/js/workspace-ui.js       → toolbar navigation, centralized settings, focus
```

The script order in `public/index.html` is a hard runtime contract: PptxGenJS, catalog, ASCM importer, PPTX pagination, portfolio model, product details, application, then workspace UI. `public/js/app.js` reads the catalog at startup and uses pagination/model/detail helpers, so those globals must be available before it executes. The shell reads initialized controls and receives `portfolio:render` events. The PowerPoint bundle must also be available when PPTX export is used.

### 3.1 Startup path

1. `public/js/app.js` reads `window.PORTFOLIO_CATALOG` and derives category definitions and spec-set maps.
2. `loadPortfolio()` tries the current `localStorage` v4 key.
3. If needed, it attempts migration from v3 and then the legacy v1 single-board key.
4. With no saved state, `createDefaultPortfolio()` builds one empty board per catalog category.
5. `ensurePortfolioSchema()` normalizes the portfolio, adds missing known categories/assets, filters unknown categories, and normalizes every board/product.
6. The active category is selected and the Product view renders first.

### 3.2 UI and rendering

The application provides two synchronized main views:

- **Product cards** — a canvas-rendered, lane-based product board with search, sort, SKU/variant previews, zoom, and protected reordering.
- **Roadmap** — a canvas-rendered, time-scaled roadmap with family groups, timeline configuration, search, panning, protected slot editing, and an optional selected-product details pane.

The compact shell uses a toolbar category dropdown, Products/Roadmap tabs, a prominent Export PPTX action in both views, and one Workspace settings dialog with Display, Timeline, Category, and Data & export sections. Edit product stays beside the selection; manual Add product is an always-available Category admin action. Empty categories offer Import package and Import ASCM. There is no category sidebar or separate Split tab. The product editor has Details, Images, Specs, Variants, and Timeline tabs. `public/js/workspace-ui.js` isolates shell navigation and keyboard/focus behavior. `public/js/portfolio-model.js` isolates timeline synchronization, specification normalization, explicit HP SKU/color resolution, shared product/status/stage tones, and settings-preserving clearing. `public/js/ascm-import.js` isolates XLSX parsing, matching, and additive merge rules; `public/js/pptx-pagination.js` isolates ordered category selection and roadmap slide calculations.

Each card's compact Details/Close action opens the one shared inline Overview. Enter on the focused Products canvas toggles it for the selected card. This replaces the circular information icon and separate View more specifications popup; spec-popup code, DOM, and styles are removed. A compact card's muted `+N specifications` note is informational, and Details exposes the entire list. Selection uses neutral borders and a thin `#6e7973` line with a small Selected marker on cards; Roadmap bars use a fine outline and leading mark. Neither canvas uses a white selection glow.

Most rendering/editor/persistence behavior still lives in `public/js/app.js`, including layout calculations, hit regions, popover state, image loading, and export rendering. Core state remains held in module-level variables rather than a framework store; this is a staged refactor of the existing application.

Read-only product information is isolated in `public/js/product-details.js`: Overview opens first with all six key dates, stage/confidence, and necessary planned context beside every specification, using independent keyboard-focusable overflow regions. Known GA/EM dates are not repeated as matching launch/end month rows. Planned launch/Planned end remain visible when the exact date is missing or the saved month differs. Specifications have no separate tab or pager. HP SKUs and More are the secondary tabs; More contains Identity/Variants/Source. Both card pane and optional Roadmap pane use the same model/render/controller, with the shared Overview adapted to the narrow Roadmap panel. Secondary lists page at five SKUs, eight variants, or two source records. The inline pane has its own complete border and 10 px card gap, and a compact toolbar for the name, tabs, and close action. Its outer height always matches the parent card's rendered height; content scrolls inside that frame. Legacy `splitView`, `renderSplitProduct`, and `activeView === "split"` names remain internal details of the optional Roadmap pane.

The 2026-10-07 user-directed redesign replaces content-measured height and lane expansion. `viewerInfoVisualHeight()` uses `productCardLayout().cardHeight * zoom`; `positionViewerInfo()` uses the actual `card.height * zoom`, aligning the pane's top and bottom with the parent at every zoom, including full-spec cards. The later compact refinement uses 540 px normally, 680 px when the rendered parent is at most 280 px tall, and 720 px when it is at most 180 px tall. Two specification columns are limited to short parents with every normalized value at most 80 characters; longer values remain in one column and wrap. Date labels reserve two lines so paired values align. General availability, FFS, and launch share teal `#5fd6c1`; end of manufacturing and lifecycle end share embargo red `#ef5b5b`. Whitelisted semantic keys connect the model to styling. The canvas may scroll horizontally. `productLaneGeometry()` passes only base layout to `PortfolioModel.layoutProductLanes()`: opening never changes lane height, lower-row positions, or board height. Horizontal animation shifts only later cards in the same lane; closing/filtering removes that reserve. Canvas bounds, backgrounds, rails, hit regions, and drag destinations retain their shared base row positions. Saved lanes, product dimensions, and schema version are unchanged.

## 4. Data model and persistence

### 4.1 Portfolio schema

The current root schema is version 4:

```text
portfolio
  version: 4
  activeCategoryId
  settings
    showRoadmapMsrp
    timeline
      startMonth / endMonth / snap / statusColors
  imageAssets[]
  categories[]
    id
    name
    board
      version: 1
      title
      lanes[]
      products[]
      settings
        showPrices
        showSkus
        fullSingleLaneSpecs
        freeMove (normalized to false)
        roadmap
```

Product records include identity, name/price metadata, lane and order, status/variant presentation, specifications, image references, color/SKU variant groups, part SKUs, product-information dates, tier/codename, and roadmap fields. `ensureBoardSchema()` is the primary compatibility boundary for product and board defaults.

Exact GA/EM fields in the editor's Details tab are the single manual date input home. Timeline keeps family/stage/confidence/relationships and date synchronization guidance, with Edit dates in Details focusing the GA field. `PortfolioModel.mergeProductUpdate()` synchronizes explicit edits: a populated valid GA/EM derives its roadmap month; a cleared exact date retains its planned month. Protected roadmap dragging shifts any known exact date into the new month while preserving its day or clamping to month end, and it retains unknown day precision for blank/TBD dates. Other milestone fields do not move with the roadmap. Existing saved exact-date/month differences are not reconciled during load or unrelated edits; this is an edit-time synchronization change rather than a normalization migration.

Root `settings.timeline` is authoritative for range and snap across every category. Board roadmap settings retain synchronized copies for rendering/export plus category-specific label/family order. Stage-color fields remain compatibility data, while display uses fixed product/status/stage tones. A legacy workspace migrates its active category settings once; switching categories does not reset the global range. Roadmap MSRP visibility is also global. Card MSRP visibility/SKU footer/full specifications and lane structure remain category-specific.

The two MSRP visibility switches are grouped in Settings → Display. Product cards read `board.settings.showPrices`; both Roadmap bars and its details pane read `portfolio.settings.showRoadmapMsrp`. Both use the same saved amount through `PortfolioModel.msrpText()`/`productPriceText()`. A nonblank finite nonnegative numeric price—including numeric strings and zero—takes precedence; otherwise a meaningful price label is accepted. Unknown/TBD placeholder labels and invalid amounts without a meaningful label stay blank. The availability count reports products with displayable saved prices across all categories. Toggling visibility preserves price/label data. The current ASCM importer does not import MSRP, so new ASCM products have no price to show until edited; matched prices remain untouched.

`normalizeSpecifications()` supports object arrays, label/value tuples, object maps, JSON strings, and plain strings. Specifications receive stable IDs and editable labels/values. A pre-overhaul defect left the inspector's rendered specification inputs/removal buttons unwired, so those visual edits were never saved; the current editor commits them. This is confirmed separately from the reported historical loss: source inspection cannot prove how an already-empty prior product lost its specifications.

HP SKUs can store explicit `variantId`/`colorCode`; shared detail rows resolve color using that assignment or the exact matching ASCM Base PN record. They show names/swatches beside the code, and unmapped records show Not assigned rather than borrowing a neighboring variant's color.

### 4.2 Browser storage

Portfolio metadata is stored as JSON in `localStorage`:

| Purpose | Key |
| --- | --- |
| Current workspace | `product-portfolio-canvas-v4` |
| Previous workspace migration | `product-portfolio-canvas-v3` |
| Legacy single-board migration | `product-portfolio-canvas-v1` |

Saves are debounced by 120 ms. Locally uploaded image binaries are stored separately in IndexedDB:

| Setting | Value |
| --- | --- |
| Database | `product-portfolio-image-assets-v1` |
| Version | 1 |
| Object store | `images` |
| Record key | `id` |

Browser state is scoped to the origin. Changing the host, port, protocol, browser profile, or private-browsing context creates a different storage workspace.

## 5. Import and export behavior

### 5.1 Lightweight data

- **Export data** downloads `product-portfolio-data.data`, a formatted JSON clone of the portfolio. It includes image metadata/references but not local image binary data.
- **Import data** accepts `.data`, `.json`, and a narrowly recognized `public/js/catalog-data.js` assignment.
- Version 4/3/2 category workspaces are normalized. Version 1 catalogs create empty boards; a legacy version 1 single board is migrated into the PC gaming audio category.
- A categories-only catalog import intentionally discards any catalog `products` content and creates empty boards through `emptyBoardFromCatalogCategory()`.

### 5.2 Full project package

- **Export project package** creates `product-portfolio-project.pkg` as a stored (uncompressed) ZIP.
- `portfolio.json` contains the cloned version 4 portfolio.
- Local image blobs are written under `images/<asset-id>.<extension>` and referenced by temporary `packagePath` fields.
- URL-backed images remain references; they are not downloaded into the package.
- **Import project package** reads only stored ZIP entries, requires `portfolio.json`, normalizes it, clears the current IndexedDB image store, imports packaged local images, and activates the imported workspace.

The custom reader rejects compressed ZIP entries. A generic ZIP renamed to `.pkg` is not necessarily compatible.

### 5.3 Presentation exports

- **PNG** renders the active Product or Roadmap canvas at 2× scale.
- Product PNG/PPTX use base lane geometry with `includeViewer: false` and noninteractive cards, excluding Details controls and temporary horizontal pane space. Live and exported lane heights match. The DOM Overview is not captured in the product canvas export.
- When Roadmap details are open, PNG exports the roadmap canvas only; it does not capture the details pane. Current search filters affect PNG rendering.
- **PPTX** opens from the prominent toolbar action in both main views, uses the vendored PptxGenJS 4.0.0 bundle, and can export Product slides, Roadmap slides, or both for one, multiple, or all selected categories.
- The chooser starts with all categories checked, offers Current category only and Select all/Clear selection shortcuts, and remembers choices in page-session state. Checkboxes show category product counts. `PPTXPagination.selectExportCategories()` preserves portfolio order; `exportPptx(scope, selectedCategoryIds)` receives explicit checked IDs. The summary estimates selected categories and content-aware slide counts, and an empty selection disables/rejects Export while Cancel remains available.
- Product slides are one per selected category; roadmap slides contain at most 22 products in family/date/name visual order, with continued family labels repeated. Number/total folios and numeric page-title counters are removed; later roadmap page titles use `(continued)`. The header divider is a subtle `#2B2E2B` rule, 0.4 pt with 25% transparency.
- Product/roadmap content is rasterized into the deck; the cards and bars are not individual editable PowerPoint objects.
- PPTX rendering temporarily activates each selected category, preloads referenced images, renders off-screen canvases, and then restores the prior UI state.

### 5.4 ASCM updates

The ASCM flow is separate from replacement workspace/package imports. It parses a local `.xlsx`, prefers canonical Base PN rows over localized duplicates, groups related source records, maps known categories and explicit merchandise color codes, and previews adds/updates/unchanged/ambiguous actions.

Matching uses a saved ASCM key first, exact Base PN second, then cautious unique normalized names within the mapped category. Console headset names can additionally use confirmed platform identity. Conflicting identifiers, duplicate candidates, unmapped categories, and several source groups targeting one product are skipped for review.

Source records retain exact descriptions and per-PN GA/EM dates. Product-level dates roll up the earliest GA and latest EM; normalized valid day-level dates supply corresponding roadmap months before group month hints, while omitted dates retain existing placement. The preview offers independent controls for updating matched products and adding new products. Pure `ASCMImporter.mergeProductGroup()` retains curated names, specifications, prices, images, statuses, other manual fields, and all previous PNs/variants/source records. Empty or invalid source dates do not clear saved dates. Existing color presentation/image choices survive; new explicit colors are appended. Missing products are not automatically deleted. `public/js/app.js` integrates the merge with roadmap synchronization and saved provenance. The [Feature Index](FEATURE-INDEX.md#ascm-update-workflow) describes exact field ownership, parser limits, and the user flow.

## 6. Design system intent

The interface uses a charcoal-first system. Product/SKU colors remain separate business data and must not be rewritten merely to match the application chrome.

### 6.1 Compact charcoal presentation

The frontend uses a compact toolbar/category switcher, restrained controls, and one settings dialog. The referenced Trixion page supplied aesthetic density/theme inspiration; its domain content was not imported.

Neutral backgrounds and sparse separators provide the hierarchy. Category rails (including PC AUDIO), calendar header, row surfaces, and bottom timeline padding follow the same charcoal system. The 88 px header has bold years, unboxed quarter/month text, adaptive month labels, and stronger year seams; half-year bands and the selected lifecycle range box are absent. Family headings and whitespace separate product groups. CSS owns DOM tokens; `UI_PALETTE` owns matching canvas tokens. `PortfolioModel.productTone()` provides the same tone to primary card banners and timeline fills: embargo status or stage is red `#ef5b5b` first, New product is teal `#5fd6c1` next, and other products use the manually selected stage's fixed subtle tone. `THEME_ACCENTS` and `LIFECYCLE_TONES` define those colors centrally. Card borders and secondary platform badges remain charcoal; selection uses a thin muted line plus a small mark without a white glow.

Palette rules:

- Keep the page, rail, card surfaces, and timeline chrome neutral charcoal.
- Keep the fixed New product/embargo accents visible and other lifecycle tones subtle; preserve visible focus and contrast-aware foreground selection.
- Preserve `STANDARD_PRODUCT_COLORS` and ASCM merchandise colors; these describe actual colorways.
- Keep fixed theme tones separate from the color selectors used to edit merchandise variants. Legacy custom banner/stage-color fields are retained but ignored by presentation.
- Keep standard status labels primary across every category. Console/platform custom labels are quiet secondary badges when a status is set, so NEW PRODUCT remains the main banner on both cards and Roadmap details without rewriting saved platform/status metadata.
- Keep inline details adjacent to their product with a complete frame exactly matching its rendered height. Add horizontal room and keyboard-accessible internal scrolling for overflow; lane heights and lower-row positions remain fixed. Maintain consistent rail extent and reachable lower rows.
- Check the same presentation in Products, Roadmap with its details open/closed, and PNG/PPTX exports.

## 7. Risk register

Priority expresses potential impact, not confirmed exploitability.

| Priority | Risk | Evidence and effect | Recommended control |
| --- | --- | --- | --- |
| P0 | Deployment completeness can regress | At the archive baseline, the Pages workflow copied `index.html`, `styles.css`, `app.js`, and `assets/`, while `index.html` also required `catalog-data.js` and `vendor/pptxgen.bundle.js`. The current workflow publishes the complete `public/` site tree and runs `scripts/checks/project.mjs`; current runtime references are relative to that site root. | Keep the workflow/HTML closure check mandatory so a later runtime reference cannot be omitted from deployment. |
| P0 | Package import is not transactional | `importProjectPackage()` normalizes the manifest, then clears IndexedDB before importing all local blobs and assigning the new portfolio. A mid-import storage failure can destroy the previous local-image library. | Stage/validate every entry first; commit state in one versioned transaction or retain a rollback snapshot. Require a backup before import until fixed. |
| P1 | Private portfolio disclosure | The package contains 85 real working product records and image references. The fetched 2026-09-23 remote baseline tracked the private package despite its ignore rule; the 2026-10-07 update pushed as `548c936` removes it from the current repository tree, preserves the disk copy, and does not erase repository history. | Keep private packages and screenshots untracked and out of Pages artifacts. Address existing history separately if required. Publish only a reviewed, sanitized dataset with explicit approval. |
| P1 | Persistence failure is silent | `scheduleSave()` catches and suppresses `localStorage` errors. Quota or browser-policy failures can leave the user believing changes were saved. | Surface save state and errors, add quota handling, and provide an explicit backup reminder. |
| P1 | Imported content is a trust boundary | Data/package fields feed DOM, canvas, URLs, colors, IDs, and filenames. Future interpolation changes can introduce stored script/markup injection or invalid rendering. | Centralize escaping and validation; test malicious strings, malformed colors/URLs/IDs, oversized input, and duplicate IDs. |
| P1 | Incomplete automated coverage | Static validation plus ASCM application/matching/merge, portfolio model, shared detail controller, and PPTX selection/planning/export regression tests exist. PPTX tests use recording adapters for export decisions and validate a real bundled-library ZIP/slide XML/image serialization; browser-saved delivery and PowerPoint opening remain unverified. Package round-trip, complete browser regression, and assistive-technology coverage remain limited. Canvas behavior is particularly difficult to validate by inspection. | Keep existing regressions, then add schema/package integration and browser smoke/visual coverage for all views and import/export flows. |
| P2 | Coupled application module | Rendering, state, migrations, storage, editors, and exports still share mutable application state. Standalone ASCM/model/pagination helpers and the shell controller establish partial subsystem boundaries. | Continue extracting storage, package I/O, rendering, and editor controllers behind stable interfaces in small verified steps. |
| P2 | Empty default content can be mistaken for data loss | The source catalog has 0 products, so first load is intentionally empty despite 85 WebP assets being present. Clear all products also leaves empty boards while preserving settings. | Keep package/ASCM empty-state imports visible, manual Add reachable in Settings, and distinguish template-only data from replacement workspace imports. |
| P2 | Remote-image dependence | The package has 84 URL image references but only one packaged local binary. Offline, expired, authenticated, or CORS-constrained URLs can fail. | Move approved images into the local asset library or add image health/fallback reporting. |
| P2 | Stored-ZIP compatibility is narrow | The package reader supports ZIP method 0 only. Common deflated ZIPs are rejected. | Document the constraint; if interchange is needed, use the already vendored ZIP capability or add a well-tested decompressor path. |
| P2 | Canvas accessibility and touch behavior require regression testing | Core Product/Roadmap information is visual canvas content with custom hit regions and gestures. | Add equivalent structured text, keyboard focus/announcements, and mobile/touch tests; retain meaningful canvas labels. |
| P3 | Static assets and catalog records are disconnected | 85 WebP files ship with the source, but 0 default product records reference them. | Remove unused/publicly inappropriate assets or connect only reviewed assets to an approved seed dataset. |

## 8. What is already strong

- The application is dependency-free at runtime and can be served as a static site.
- Current and legacy schemas are normalized at explicit boundaries.
- Local binary images are separated from lightweight JSON metadata.
- Full packages preserve local-image binaries without embedding large data URLs in the portfolio JSON.
- Products, Roadmap, and both read-only detail surfaces share a single normalized portfolio, which supports linked selection and export consistency.
- Category definitions and spec templates are centralized in `public/js/catalog-data.js`.
- Product/SKU business colors are intentionally separated from interface design tokens.
- Shared timeline/specification/SKU rules and additive ASCM merges can be verified without booting the complete page.
- Settings disclose portfolio-wide versus active-category scope in one dialog; product editing uses focused tabs.

## 9. Audit limits

The package was structurally inspected; its business content was not independently validated against an external product system. Browser-specific persistence limits, remote-image availability, complete keyboard/screen-reader behavior, and pixel-level rendering across devices require runtime testing. The authoritative verification process is maintained in the [Continuation Guide](CONTINUATION-GUIDE.md).
