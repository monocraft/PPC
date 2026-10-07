# Change Log

## 2026-10-07 — unified encrypted packages and portable shared-data setup

- Added one keyed encrypted master package for every category, Products, Roadmap, settings, variants, and saved local images. Export project package now opens a protected export dialog with key reuse/creation/copy and downloads `master_ppc.pkg`; an unprotected local backup is an explicit optional choice. Missing local binaries block a complete export.
- Added Pull latest data and unified manual import/export/recovery dialogs. Shared pulls require an encrypted source; manual imports support legacy stored ZIPs and keyed packages. Keys are not persisted and are cleared when the dialog closes.
- Changed package replacement to validate the manifest/image references and stage incoming images under new IDs before committing metadata. Preserve the original images for one previous-workspace recovery slot; Restore previous workspace swaps the two snapshots. Keep lightweight data import as its existing separate flow.
- Added a portable Node fixed-file relay with authenticated envelope checking, exact CORS, bounded source/request sizes, concurrency/IP rate limits, explicit trusted-proxy handling, no cached plaintext/keys, and generic errors. It serves an approved local SharePoint mirror behind HTTPS and requires no Azure dependency; the owner sync process still signs into Microsoft.
- Added endpoint-only source configuration with an empty checked-in default, GitHub repository variable `PPC_PACKAGE_ENDPOINT` for Pages, and a local `--package-endpoint` serving override. No private SharePoint URL, key, package, or host mirror path belongs in the static site. Shared live connectivity remains a separate deployment/setup verification.
- Added codec, actual workspace replacement/recovery, and isolated relay checks; documented source freshness limits, publisher steps, OneDrive sync, and portable HTTPS hosting in Shared package setup. The concise public README remains unchanged.

## 2026-10-07 — consolidated product date editing

- Kept GA/EM and the other exact key-date inputs in Details as their single editing home. Removed duplicate launch/end month inputs from Timeline; Edit dates in Details switches tabs and focuses general availability.
- Added `PortfolioModel.mergeProductUpdate()` to synchronize explicit product date edits with roadmap placement. Populated valid GA/EM derive their corresponding months; blank/TBD retains the planned month without inventing a day.
- Protected roadmap dragging shifts known exact dates while preserving their day where possible and clamping to month end when needed. Unknown exact dates remain unknown, and other milestones retain their separate values. Schema normalization and unrelated edits preserve existing saved date/month differences.
- Removed duplicate matching launch/end month rows from both Overview surfaces. Stage/confidence remain; Planned launch/Planned end appear only when exact dates are missing or their months differ.
- Made normalized valid day-level ASCM GA/EM take priority over group month hints while retaining the existing additive, blank-date-preserving import behavior.
- Updated current feature, audit, and continuation guidance without changing the public README or dated historical verification records.

## 2026-10-07 — compact dates/specifications and public source layout

- Aligned key-date values with fixed two-line label slots. General availability, FFS, and launch use the shared teal; end of manufacturing and lifecycle end use embargo red through whitelisted semantic keys.
- Reduced the parent-height pane to 540 px normally, 680 px for parents at most 280 px tall, and 720 px for parents at most 180 px tall. Specification labels/values sit closer together. Two columns are limited to short parents whose normalized values are all at most 80 characters; longer text wraps in one column. Exact parent height, independent keyboard scrolling, stable lanes, and export geometry are preserved.
- Moved the static site into `public/`: `public/index.html`, `public/js/` application modules, `public/css/styles.css`, `public/assets/`, and `public/vendor/`. The local server and Pages workflow publish that directory's contents as the site root, retaining the live app URL.
- Consolidated development validation under `scripts/checks/` with `project.mjs`, `ascm-import.mjs`, `pptx-pagination.mjs`, `portfolio-model.mjs`, and `product-details.mjs`; `scripts/serve.mjs` remains the local-server entry point.
- Updated current source maps and commands while preserving dated archive/publication/browser evidence below. The root README remains the short public introduction; detailed local guidance stays in ignored `project-data/private/README-INTERNAL.md`.

## 2026-10-07 — GitHub repository connection and code publication

- Connected this workspace to `https://github.com/monocraft/PPC.git`; local `main` tracks `origin/main`. The remote baseline is `6665bd6e7e7589b31f317f3e931d8cfb6fec35ce` (2026-09-23, `Color Variant`).
- Aligned branch/index history while preserving the current local application files; core file hashes remained unchanged. Original ZIP provenance and earlier records without a Git repository remain historical.
- Removed the baseline's tracked `project-data/private/product-portfolio-project.pkg` from the local index only, preserving the package on disk. The published update removes it from the repository's current tree. Private packages remain ignored, and `artifacts/` is now ignored so portfolio screenshots stay local. Prior Git history still contains the package.
- Pushed commit `548c936` (`Update portfolio workspace and parent-height product details`) to `origin/main` as a normal fast-forward update from the connection baseline. The [Deploy to GitHub Pages run](https://github.com/monocraft/PPC/actions/runs/37658673619) succeeded for full commit `548c9363fbc67bd949e671187f613da5033c05dc`.
- Changed Pages from legacy `main` branch-root publishing to workflow publishing through the authenticated Pages API, then re-read the configuration to confirm it. This uses the reviewed static-site allowlist and removes the competing branch-root publishing path.
- Verified all nine public HTML/CSS/application JavaScript files returned HTTP 200 and matched the published commit byte-for-byte by SHA-256 comparison. The live app rendered correctly in the browser with the expected empty starter portfolio (zero public seed products).
- Updated repository/source guidance while preserving the original archive provenance and private-package history.

## 2026-10-07 — parent-height product details redesign

### Improved

- Redesigned the individual product pane with a compact name/tab/close toolbar and an Overview that places six key dates/lifecycle beside the complete specification list. Dates and specifications have independent keyboard-focusable overflow; the same shared content adapts to the optional Roadmap panel. Specification paging remains absent, while secondary SKU/variant/source pages and copy controls are preserved.
- Made the pane exactly match its parent product's rendered height at every zoom, including full-spec cards. Removed content-height measurement. The pane gains horizontal room instead: 620 px normally, 760 px beside a parent at most 280 px tall, and 840 px beside a parent at most 180 px tall or a product with more than 14 specifications. Short/dense layouts use two specification columns; the canvas scrolls horizontally when needed.
- Replaced the previous lower-lane expansion with stable lane and canvas heights. Opening shifts only later cards in the same lane horizontally; closing/filtering removes that reserve. Pane tabs and animation never move lower rows. Product PNG/PPTX omit the temporary horizontal reserve and Details controls.
- Updated the README, feature inventory, implementation audit, and continuation guidance to make parent-rendered height authoritative. The content-measured sizing and lane expansion recorded in the 2026-10-06 entry below are historical and superseded.

### Evidence and verification

- `node --check app.js` and `node scripts/test-portfolio-model.mjs` pass. Actual lane consumers retain base positions and total height at 20/65/100/150% zoom, including first/middle/last-lane selection, drawing/backgrounds/rails/hit regions/drop destinations, close/filter guards, and exports. Generic model expansion coverage remains separate from inline pane behavior.
- `node scripts/test-product-details.mjs` passes. The actual application pane sizing/render/placement functions are exercised with compact and full-spec parents at 20/50/65/100/150% zoom and opening progress 0.01/0.25/0.5/1. Tests reject content-height reads and verify exact rendered-parent height/top/bottom, stable lanes/canvas height, 620/760/840 px widths, horizontal reserve/export exclusion, missing-card suppression, complete unpaged specifications, separately focusable date/specification regions, secondary-list controls, and preserved clearing behavior.

## 2026-10-06 — compact frontend and data-preserving updates

### Improved

- Reorganized the frontend around a compact charcoal toolbar/category dropdown and only Products/Roadmap main tabs. Roadmap details are optional/collapsible; manual Add product is an always-available Settings → Category admin action, while empty categories offer Import package and Import ASCM.
- Promoted Export PPTX to a primary toolbar action available in both views with Product Portfolio/Roadmap/Both scopes and checkbox selection of one, multiple, or all categories. All are selected initially; Current category only and Select all/Clear selection shortcuts, session choices, category product counts, selection-aware category/slide estimates, portfolio-order export, and an empty-selection guard keep the flow explicit.
- Removed dedicated slide-number folios and numeric paginated title counters from PPTX; later pages use `(continued)`. Softened the header divider to a 0.4 pt charcoal `#2B2E2B` line with 25% transparency.
- Consolidated settings into Display, Timeline, Category, and Data & export sections; organized the product editor into Details, Images, Specs, Variants, and Timeline tabs.
- Separated Data & export into Import and Export panels with directional icons, explicit bring-in/save-copy help, and short descriptions distinguishing additive ASCM review from package/data replacement. Panels sit side by side on desktop and stack on narrow screens; Clear all products is a separate row below. Existing actions, file inputs, and data behavior are preserved.
- Isolated the shell/settings controller in `workspace-ui.js`, pure timeline/specification/SKU rules in `portfolio-model.js`, and shared read-only details in `product-details.js` while retaining existing static deployment and data formats.
- Made 3/5/10-year presets, custom range, and snap interval global across all categories and exports. Legacy workspaces migrate the active category's timeline once. Viewport changes retain product lifecycle dates. Presentation uses one fixed stage/status palette with a legend.
- Shared product tones across primary card banners and roadmap fills: New product is teal `#5fd6c1`, embargo status/stage is red `#ef5b5b` and takes precedence, and other manually selected stages use subtle fixed tones. Card borders and secondary platform badges remain neutral; selection uses thin muted lines and small card/bar markers without white glow.
- Fixed Console New product banner inconsistency: standard status text is primary, while a distinct PLAYSTATION/XBOX/custom variant label appears as a quiet secondary badge on cards and Roadmap details. Saved status/platform metadata is preserved.
- Grouped the MSRP switches in Display with clear active-category card and portfolio-wide Roadmap scopes. Cards, roadmap bars, and roadmap details use one saved-price formatter; numeric MSRP takes precedence over meaningful fallback labels, missing/TBD values stay blank, and toggling visibility preserves data. Added the saved-price availability count and ASCM explanation.
- Applied charcoal surfaces to timeline/category rails, header bands, and bottom padding; kept actual product/SKU swatches separate from interface theming.
- Simplified the timeline into an 88 px header with large bold years, unboxed quarter/month labels, stronger year seams, adaptive narrow-range month text, and family whitespace/headings. Removed the half-year band and selected lifecycle range box.
- Replaced large TBD placeholder diamonds with quiet image icons, sized cards to category content, and bounded automatic fitting to a readable 65–100% scale with vertical scrolling for extra lanes. Compact cards show an informational overflow count and use Details for the complete specification list; full-spec cards expand without clipping.
- Changed shared HP SKU details into Color / HP SKU / Copy rows using explicit source-PN or manual variant associations; unknown mappings show Not assigned.
- Shared Overview/HP SKUs/More details between the card drawer and optional Roadmap pane. Overview opens first with all six dates, lifecycle context, and the full unpaged specification list together. More contains Identity/Variants/Source; only SKU/variant/source lists use paging. The drawer stays readable at every card zoom, measures its content within the viewport, and has a complete independent border with a 10 px card gap.
- Consolidated card information into one compact Details/Close action and an Enter toggle on the focused Products canvas, removing the circular icon and the separate View more specifications popup, its code, and its DOM/styles.
- Fixed taller inline panes covering the next product lane: only the viewed lane grows, later rows move down with their original gap, and canvas backgrounds/bounds, rails, hit regions, and drag destinations use one derived geometry. Closing/filtering removes transient spacing. Product PNG/PPTX omit Details controls and temporary pane gaps/row expansion.
- Connected specification label/value/removal controls to saved product state, supported legacy non-array specification shapes, and retained edits when adding more specification fields.
- Replaced destructive ASCM PN/color reconciliation with pure additive merging: retain curated specs/prices/images/names, existing variants/hero images, previous PNs/source records, and blank-source dates. Only populated ASCM facts update their owned fields.
- Initialized future new ASCM products with category/lane baseline specification placeholders. Matched products—including empty spec arrays—are not backfilled. New stage initialization can use source dates once; subsequent imports preserve the manually selected stage, with no As of reclassification.
- Added the comprehensive [Feature Index](FEATURE-INDEX.md), refreshed the architecture/settings/import audit, and extended the continuation/browser checklist.
- Replaced Restore sample with Clear all products: clear every category's products/images and ASCM snapshot while keeping custom category names, lanes, templates, and global/display settings.

### Evidence and verification

- Compared the supplied 85-product packages with `product-portfolio-project_09232026.pkg` (198 products): all 85 original product IDs and serialized specifications are unchanged. Of 113 additional products, 109 have empty specs; the report contains no specification facts. This does not reproduce deletion in an earlier browser session.
- `node scripts/test-ascm-import.mjs` passes, covering additive merges, data/image retention, blank reports, repeated updates, the real application normalization path, category moves, new-only category/lane baseline specs, and specification editing.
- `node scripts/test-portfolio-model.mjs` passes, covering global timeline/spec/SKU/status/MSRP rules, Console status-first banners/neutral platform badges with unchanged metadata, actual rendering/visibility handlers, and pure plus real application lane geometry consumers. First/middle/last-lane opening at 65/100/150% zoom, backgrounds/rails/hit tests/drop positions, collapse/filter guards, immutable saved data, and base export layout are covered.
- `node scripts/test-product-details.mjs` passes, covering Overview's six dates/lifecycle and all eleven fixture specifications without a separate Specs tab/pager, complete secondary-list pagination, keyboard tabs/copy, text/style escaping, real date/SKU adapters, and settings-preserving clearing.
- `node scripts/test-pptx-pagination.mjs` passes, covering category selection plus actual app summary/planning/export decisions with recording image/file adapters: all scopes, selected-only product coverage in portfolio order, pagination, remembered choices, empty/stale selection guards, numberless slide chrome, subtle divider, image proportions, and immutable category data. It also serializes a real 46,240-byte one-slide fixture through the shipped PptxGenJS and validates ZIP CRCs, title-only slide XML without number/footer/date placeholders, the 0.4 pt charcoal divider at 75% opacity, and an intact valid PNG/image relationship. Browser delivery/open remains a separate check.
- Browser persistence check on a separate empty test origin: created a synthetic headset, edited an existing specification to `USB-C · verified`, added another field, then closed/reloaded/reopened the editor. The edited value and added field both remained.
- Browser timeline check on the separate synthetic test workspace: selected ten years in Mice, switched to PC Gaming Audio, and confirmed the shared end year remained 2035. Restored the five-year range afterward.
- Browser HP SKU check on the supplied 198-product workspace: a source-linked two-tone HP SKU displayed its explicit Black / Blue association beside the correct part number.
- Earlier compact-details browser check on that workspace: all six key dates remained visible without outer/active-panel scrolling in both surfaces, and Source showed the correct per-PN dates. This preceded the final Overview's addition of the complete specification list.
- Browser editor check on the synthetic workspace: a manually added HP SKU retained its Black association, and a local URL image rendered and survived reload. Desktop (1280×720) and narrow (390×844) shell/settings layouts were visually reviewed.
- Final navigation browser check: only Products/Roadmap main tabs were present, the prominent Export PPTX action opened its chooser, and Roadmap's show/hide details control worked. The chooser check does not establish download/open success.
- Final PPTX chooser checks confirm one/multiple/all and empty selection, Cancel with an empty list, scope-aware estimates, and keyboard Tab wrapping from Export to Close with an inert background. The 198-product workspace showed a one-category/one-slide product plan and a two-category/five-slide plan; the test workspace showed a two-category/four-slide plan. At 1280×720 the 566 px chooser displays all eleven categories without scrolling; at 390×844 it fits with internal category-list scrolling.
- Final Console browser check shows matching NEW PRODUCT teal primary banners and PLAYSTATION charcoal secondary badges on product cards and Roadmap details.
- Final Overview browser check on the isolated eight-spec product at 1280×720: all dates/lifecycle/specifications fit together; Roadmap panel measured 335 px client/scroll height, and card drawer measured 337 px client/scroll height within a 431 px complete frame. The card gap and content-sized frame removed the broken boundary and extra blank space.
- Final two-row browser check at 1280×720: inline pane ended at 600 px and the next lane began at 643 px, preserving separation. Closing restored base spacing and Enter reopened details. HP SKUs retained the 431 px pane height and row positions; filtering the viewed product out hid its pane and removed expansion. The removed spec popup was absent, and Details/Close plus the quiet Selected marker were visually verified.
- Final MSRP browser check: an isolated saved `$129.99` remained hidden on cards and visible in Roadmap details through the independent switches.
- Package import remains replacement behavior and clears the local image library; `.data` remains lightweight metadata without binary images. ASCM update is the additive path.

### Remaining boundaries

Core canvas rendering/editing/storage/export remains in `app.js`; the overhaul extracts pure rules and the shell without introducing a framework/build pipeline. Transactional package import, truthful save-failure status, and complete assistive-technology/browser regression coverage remain separate improvements.

The live package-replacement test was blocked by automatic approval review because it would overwrite the browser workspace; it was not retried. Earlier PPTX submission had a 25-slide estimate and a 60-second download-tracking timeout; the latest one-category attempt also timed out after 20 seconds. No browser-saved file or PowerPoint opening is confirmed. Real bundled-library fixture generation and file structure are verified separately above. No live XLSX apply success is claimed. Automated ASCM coverage exercises the actual import-plan path with synthetic datasets; that does not replace file-picker/download verification.

## 2026-09-22 — readable paginated PowerPoint export

### Improved

- Roadmap exports now split long categories into slides containing at most 22 products.
- Pagination follows roadmap visual order: family, launch date, then product name.
- Roadmap families that cross a slide boundary repeat their family header with a `CONTINUED` label.
- Multi-page titles include `(n of total)`, while the deck folio and export-dialog slide estimate reflect the complete paginated deck.

## 2026-09-22 — ASCM automatic updater

### Added

- Added a local `.xlsx` ASCM import flow with a review screen before any portfolio data changes.
- Reads the required Category, Base PN, GPG description, GA, and EM fields, plus Feature ID, Local flag, and Code Name when present.
- Filters localized duplicate rows in favor of the canonical Base PN row, groups explicit color SKUs into product families, and stores the exact source description and dates for every HP part number.
- Matches future imports by saved ASCM key or Base PN, with a cautious category-scoped exact-name fallback for the first import.
- Preserves manual images, pricing, specs, roadmap status, and other curated content; ambiguous groups are skipped and absent Base PNs are not deleted.
- Added exact GA/EM fields to the inspector and product detail views, along with ASCM provenance in split view.
- Added dependency-free regression coverage for color parsing, grouping, date rollups, category routing, and stable matching.

### Verified against the supplied report

- `378` source rows were read from `ASCM Report`, with the header found on row `13`.
- `126` localized duplicate rows were excluded, leaving `252` canonical Base PNs.
- The canonical records grouped into `176` product families and retained exact per-PN GA/EM dates.
- The project validator, JavaScript syntax checks, importer regression tests, and browser preview workflow pass.

## 2026-09-22 — latest-source baseline and first hardening pass

### Baseline

- Replaced the prior local source with the 94-file contents of `PPC-main.zip` and
  verified every extracted file by hash.
- Recorded the source archive SHA-256:
  `61032432E31AC18A985F9748E56ED1A63DE7E2EACE4D5CEE55BB9B565DB16AF3`.
- Preserved the current v4 working package at
  `project-data/private/product-portfolio-project.pkg`; it contains 11
  categories, 85 products, and 85 image-asset records.
- Recorded the package SHA-256:
  `3FB436E56FAE28CC7FE125030841690039084679C15619CDDC763DA6D2D5B3A4`.
- Kept the package private: it is ignored by Git and excluded from the Pages
  artifact.

### Improvements applied

- Rebuilt application chrome around the supplied charcoal/core palette using
  named CSS and canvas tokens.
- Reserved Amaranth for high-attention actions and embargo/today semantics;
  routine selection uses Japanese Indigo and Steel Teal.
- Added contrast-aware foreground selection for custom status and roadmap fills.
- Migrated known legacy roadmap and variant default colors without changing the
  product/SKU color catalog.
- Escaped imported price labels and imported IDs at HTML interpolation points.
- Strictly normalized imported/custom CSS colors to `#RRGGBB`.
- Fixed GitHub Pages packaging so `catalog-data.js` and `vendor/` ship with the
  files that reference them.
- Added a dependency-free local server, structural validator, private-data
  guards, onboarding README, project audit, and continuation guide.

### Verification

- `node --check app.js` and `node --check catalog-data.js` pass.
- `node scripts/validate-project.mjs` passes.
- The expected validator warnings remain: the public catalog intentionally has
  zero products, and 85 catalog WebP files are not referenced by public records.
- Imported the private package in a local browser and reconciled category counts
  to `14/11/7/3/8/4/7/13/11/5/2` (85 total).
- Product, roadmap, split, and 760-pixel responsive views rendered without
  browser console warnings or errors.

### Deliberately deferred

The next safety work is transactional package/image import, truthful autosave
error reporting, strict versioned import validation, semantic non-canvas content
and keyboard support, then canvas performance and browser regression coverage.
See [Project Audit](PROJECT-AUDIT.md) and
[Continuation Guide](CONTINUATION-GUIDE.md) for evidence and sequencing.
