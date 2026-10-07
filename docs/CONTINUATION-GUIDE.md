# Continuation Guide

This is the operating guide for future changes. It keeps code provenance, private working data, browser persistence, and design intent separate so a new update does not accidentally revive stale code or publish private content.

Read [Feature Index](FEATURE-INDEX.md) before modifying a feature. It documents existing user flows, settings scope, template fields, persistence, and function/module search anchors.

## 1. Sources of truth

Use this order when deciding what is authoritative:

| Concern | Source of truth |
| --- | --- |
| Current application code | This workspace, connected to `https://github.com/monocraft/PPC.git` with local `main` tracking `origin/main`; original archive provenance remains hash-pinned |
| Category/lane/spec templates | `catalog-data.js` |
| Current private portfolio content | `project-data/private/product-portfolio-project.pkg` |
| Current browser session | `localStorage` plus IndexedDB for the exact origin being tested |
| UI palette | CSS/JavaScript tokens derived from the supplied charcoal/core palette references |
| Deployment contents | `.github/workflows/deploy.yml`, checked against `index.html` runtime references |

Do not copy an older local folder over this workspace. A future GitHub ZIP or clone should be staged separately, inventoried, and diffed before any merge.

The 2026-10-07 connection used remote commit `6665bd6e7e7589b31f317f3e931d8cfb6fec35ce` (2026-09-23, `Color Variant`) as its Git baseline and preserved the core local application file hashes. Commit `548c936` (`Update portfolio workspace and parent-height product details`) was then pushed to `origin/main` as a normal fast-forward update. The [Deploy to GitHub Pages run](https://github.com/monocraft/PPC/actions/runs/37658673619) succeeded for full commit `548c9363fbc67bd949e671187f613da5033c05dc`. Cache-busting requests for `index.html`, `styles.css`, `app.js`, `workspace-ui.js`, `portfolio-model.js`, `product-details.js`, `ascm-import.js`, `catalog-data.js`, and `pptx-pagination.js` all returned HTTP 200 and matched that commit's Git blobs byte-for-byte by SHA-256 comparison. The live app also rendered correctly in the browser with the expected empty starter portfolio (zero public seed products). Pages was changed from legacy `main` branch-root publishing to `build_type: workflow` through the authenticated Pages API, then re-read to confirm the configuration. Keep workflow publishing so the reviewed static-site allowlist remains the only publishing path. The remote baseline tracked the private package; the published update removes it from the repository's current tree while retaining it on disk. Prior Git history still contains that package. `artifacts/` is now ignored along with private data and logs.

## 2. Establish a safe baseline

Before feature work:

1. Run validation and record the result.
2. Confirm `.gitignore` excludes logs, `*.pkg`, `project-data/private/`, and `artifacts/`; also confirm these private/local files are not tracked, because ignore rules do not exclude existing tracked files.
3. Confirm the private package hash:

   ```powershell
   Get-FileHash -Algorithm SHA256 project-data\private\product-portfolio-project.pkg
   ```

   Expected: `3FB436E56FAE28CC7FE125030841690039084679C15619CDDC763DA6D2D5B3A4`.

4. Verify that `main` still tracks the intended `origin/main`, review the working diff, and record a known-good commit before refactoring. This workspace is already connected; do not reinitialize or overwrite local files to repeat the connection.
5. Export the active browser workspace as a `.pkg` before any schema migration or destructive import.

Never add the private package with `git add -f`, copy it into `assets/`, or add `project-data/private/` to the Pages workflow.

## 3. Run and validate

No package installation is required.

```powershell
node scripts/validate-project.mjs
node scripts/test-ascm-import.mjs
node scripts/test-pptx-pagination.mjs
node scripts/test-portfolio-model.mjs
node scripts/test-product-details.mjs
node scripts/serve.mjs
```

The equivalent `npm test` runs the validator and regression checks; `npm run serve` starts the server. These commands do not install dependencies.

For a quick syntax-only check:

```powershell
node --check app.js
node --check catalog-data.js
```

Keep the same local URL and port during a test cycle. Browser storage is origin-scoped; switching from `127.0.0.1` to `localhost` or changing ports creates a separate workspace.

## 4. Import the private working package

1. Start the local server and open the printed URL.
2. If the browser already has valuable work, choose **Settings → Data & export → Export project package** first.
3. Choose **Settings → Data & export → Import project package**.
4. Select `project-data/private/product-portfolio-project.pkg`.
5. Verify:

   - 11 categories are available.
   - Product counts total 85.
   - The category counts match the table in [Project Audit](PROJECT-AUDIT.md#22-private-working-package).
   - The packaged local PNG renders.
   - Remote images either render or fail with an understandable fallback.

The current importer clears the origin's IndexedDB image store before it completes the new import. Until import is transactional, the pre-import export is the recovery path.

## 5. Understand a new upstream source safely

When GitHub changes arrive as a ZIP, use a staged comparison instead of overwriting the active workspace immediately.

### 5.1 Inventory and verify

1. Compute and record the archive SHA-256.
2. List archive entries before extraction.
3. Reject entries with absolute paths, `..` traversal, unexpected links, or a second nested project root that would change layout assumptions.
4. Extract into a new temporary directory outside the active workspace.
5. Record file count, directory count, entrypoints, and large/binary files.
6. Compare hashes and paths against the current workspace; classify every file as added, changed, removed, or unchanged.

### 5.2 Map behavior before merging

Inspect in this order:

1. `index.html`: runtime references, IDs, menu actions, forms, and canvases.
2. `catalog-data.js`: schema version, category IDs, lanes, spec sets, products, and image references.
3. `app.js`: storage keys, schema normalizers, startup, import/export, rendering entrypoints, and event wiring.
   Also inspect `portfolio-model.js` for global timeline/lane geometry/specification/SKU/shared-tone rules, `product-details.js` for Overview and secondary-list tabs/paging, `workspace-ui.js` for shell/settings interactions, `ascm-import.js` for workbook parsing/matching/additive merges, and `pptx-pagination.js` for ordered category selection and roadmap slide limits before changing those flows.
4. `styles.css`: token definitions, layout breakpoints, focus styles, and literal colors.
5. `.github/workflows/deploy.yml`: every runtime file and directory copied into the Pages artifact.
6. `vendor/`: version and provenance of vendored libraries.

Search for migration and trust boundaries early:

```powershell
rg -n "STORAGE_KEY|ensurePortfolioSchema|ensureBoardSchema|loadPortfolio|importProjectPackage|exportProjectPackage" app.js
rg -n "innerHTML|insertAdjacentHTML|href=|src=|style=" app.js
rg -n "<script|<link" index.html
```

### 5.3 Merge discipline

- Keep the staged upstream tree unchanged for reference.
- Apply selected changes to the active workspace in small commits.
- Preserve private package/data ignores.
- Do not replace documentation, validators, or deployment fixes simply because an upstream archive lacks them.
- Re-run validation and the browser matrix after each logical group.
- Record the new archive hash and material differences in the Project Audit.

## 6. Change rules by subsystem

### 6.1 Schema and storage

- Increment a version only when the stored representation changes.
- Keep normalization idempotent: normalizing already-current data must not alter it again.
- Treat `portfolio.settings.timeline` as authoritative; keep board compatibility copies synchronized without changing product lifecycle dates. Legacy workspaces migrate from the active category once.
- Preserve recognized specification shapes and stable IDs; test tuples, object maps, JSON/plain strings, label/value edits, and removal.
- Add fixture tests for v4, v3, legacy v1, empty catalog, malformed input, and missing optional fields.
- Never silently drop unknown fields during a migration unless the removal is documented.
- Keep image metadata and IndexedDB binaries consistent; test missing and orphaned assets.
- Surface storage quota and save failures to the user.

### 6.2 ASCM partial updates

- Keep workbook updates additive through `ASCMImporter.mergeProductGroup`; do not replace matched products with freshly created records.
- Preserve curated specifications, prices, name, status, product/colorway images, variant identities, manual SKU-color links, and fields outside the documented ASCM write set.
- Missing PNs/variants/source records and blank or invalid dates must not clear saved facts.
- Match using exact ASCM key/Base PN before cautious category/platform-aware names; skip ambiguous groups and several groups targeting one product.
- Test the real `applyAscmImportPlan` path as well as pure helpers, including normalizers, category moves, update/add flags, blank reports, and repeat imports.
- The current ASCM importer does not import specification facts or MSRP; omit unknown prices and initialize editable category/lane template placeholders only for newly added records. Do not overwrite/backfill matched specs or imply placeholders are source facts.
- New products may initialize stage once from source dates. After creation, matched imports preserve the manually selected stage; do not add recurring As of reclassification.

### 6.3 Package I/O

- Treat every imported filename and JSON field as untrusted.
- Validate entry count, path shape, byte size, supported ZIP method, JSON version, IDs, URLs, colors, and image MIME types before mutation.
- Prevent duplicate paths and traversal.
- Stage package content before clearing existing data.
- Add an export→import→export round-trip test with byte-independent semantic comparison.
- Keep URL images as references only when that is an explicit privacy/offline decision.

### 6.4 UI and palette

- Use the shared CSS and `UI_PALETTE` tokens; do not add isolated UI hex values.
- Keep the shell predominantly charcoal/black.
- Use the fixed New product teal `#5fd6c1` and embargo red `#ef5b5b` accents, muted tones for other stages, and clear keyboard focus.
- Keep category rails, timeline header bands, and bottom padding neutral charcoal.
- Keep the year/quarter/month header unboxed, retain stronger year seams and family spacing, and verify adaptive month labels in 3/5/10-year fit modes.
- Keep `PortfolioModel.productTone()` shared across primary card banners and timeline fills: embargo status/stage takes precedence, then New product status, then the manually selected lifecycle stage. Card borders and secondary platform badges stay neutral; selection uses thin muted lines and small markers without white glow. Product stage stays explicit and separate from SKU merchandise colors; imports preserve the stage after new-product initialization.
- Keep standard status text as the primary banner, including Console products. A distinct platform/custom variant label is a quiet secondary badge in cards and Roadmap details; do not let it replace NEW PRODUCT or change saved metadata.
- Keep only Products/Roadmap main tabs; Roadmap can show/hide its details pane. Keep Export PPTX prominent in both views, package/ASCM imports on the empty canvas, and manual Add product always reachable in Settings → Category rather than the main toolbar.
- Keep both MSRP switches together in Display: card visibility is active-category, Roadmap bars/details visibility is portfolio-wide. Both read the same saved MSRP through `msrpText`; numeric amounts take precedence over meaningful labels, unknown prices stay blank, and hiding never changes price data. Preserve the saved-price availability explanation and the fact that the current ASCM importer does not import MSRP.
- Share Overview / HP SKUs / More on the card drawer and optional Roadmap pane. Overview places all six dates/lifecycle beside every specification, with independent keyboard-focusable overflow; adapt that shared content to the narrow Roadmap panel. Specifications stay unpaged; only SKU/variant/source lists use pages. Check tabs/pages and access to every value at 20–150% card zoom.
- Keep one Details/Close action per card and Enter for the selected card when the Products canvas is focused. The muted `+N specifications` count is not another control; do not reintroduce the circular information icon or a separate full-specifications popup.
- Keep the inline pane exactly as tall as its rendered parent card: fallback to `productCardLayout().cardHeight * zoom`, then position with the actual `card.height * zoom`. Never derive its frame height from content or the viewport. Width is 620 px normally, 760 px for a parent at most 280 px tall, and 840 px for a parent at most 180 px tall or more than 14 specs; short/dense layouts gain specification columns. Allow horizontal canvas scrolling while keeping readable text and internal overflow.
- `productLaneGeometry` must retain base lane heights and positions throughout opening/closing, tab changes, retargeting, zoom, and filtering. Reserve horizontal room only, shifting later cards in the viewed lane; lower lanes never move. Keep canvas bounds/backgrounds/rails/hit regions/drag targets consistent, and remove the horizontal reserve when the viewed product is closed or filtered out.
- Choose text color dynamically for rendered fills and verify at least WCAG AA contrast.
- Do not theme `STANDARD_PRODUCT_COLORS`; those are SKU/product attributes.
- Check focus, hover, disabled, selected, empty, overflow, and error states in both main views, including Roadmap details open/closed.

### 6.5 Rendering and exports

- A visual change must be checked in Products, Roadmap details open/closed, PNG, and PPTX.
- Verify the smallest and largest category/product groups.
- Test long names, long SKU lists, large prices, missing images, plus-variant overflow, and single-lane full specifications.
- Keep export rendering independent from current scroll position and restore prior UI state after export.
- Render product PNG/PPTX with `includeViewer: false` and noninteractive cards, excluding Details controls and transient horizontal pane space. Live and exported lane heights must match; opening Details must not add an empty exported gap.
- PPTX must honor explicit selected category IDs in portfolio order. Keep one/multiple/all checkbox choices, Current category only, Select all/Clear selection, selection-aware counts, and an empty-selection Export guard with usable Cancel. Do not restore number/total folios or numeric page-title counters; later pages use `(continued)` and the header divider stays subtle.

### 6.6 Deployment

The Pages artifact must include at minimum:

```text
index.html
styles.css
app.js
catalog-data.js
ascm-import.js
pptx-pagination.js
portfolio-model.js
product-details.js
workspace-ui.js
assets/
vendor/pptxgen.bundle.js
```

It must exclude:

```text
project-data/private/
pwsh.log
docs and development scripts, unless intentionally published
```

Run the validator after every `index.html` or workflow change. A local page loading successfully does not prove the deployed artifact is complete.

## 7. Browser verification matrix

Use a fresh test origin/profile for the default-catalog pass, then import the package for the populated pass.

| Area | Fresh default | After 85-product package import |
| --- | --- | --- |
| Startup | 11 categories; empty boards; no uncaught errors | 11 categories; counts total 85; active category loads |
| Product view | Package/ASCM imports visible; manual Add reachable in Settings → Category | Cards, lanes, search, sort, zoom, SKU/variant previews, info drawer, admin add/edit/reorder |
| Inline Details geometry | Create compact/full-spec products in multiple lanes; Details/Close is the single all-specs action | Open first/middle/last-lane products at 20/50/65/100/150% zoom; pane top/bottom exactly match the parent, every lane and board height stay unchanged through opening/tab changes/retargeting, later cards shift only horizontally, rails/hit tests/drop targets align, closing/filtering remove horizontal reserve, and exports retain base geometry |
| Roadmap | Empty state, year range, zoom/pan | Families, bars, selected state, search, dates, slot editing, predecessor/successor links |
| Roadmap details option | Show/hide control works; graceful no-selection state | Selected details and roadmap remain synchronized; only Products/Roadmap main tabs are present |
| Compact details | Overview default; six dates/lifecycle beside specs; keyboard tabs and empty states work | Every spec remains reachable without a separate tab/pager; independently focus/scroll the date and specification regions inside the parent-height pane, including dense/long values. SKU pages of five, variant pages of eight, source pages of two; Roadmap adapts the shared content to its narrow panel |
| Persistence | Create one test product, reload, confirm it remains | Modify a product and local image, reload on the same origin |
| Lightweight data | Export and re-import `.data`; understand that local binaries are excluded | References and metadata survive; local binary behavior is explicit |
| Full package | Export then import into a clean origin | Product counts and local image survive round trip |
| ASCM import | Workbook preview works without changing data; new products enter mapped categories with lane/category specification placeholders | Preview/reimport updates retain manually curated specifications (including empty arrays), price, images, variants, stage, and absent PNs; ambiguous candidates are skipped |
| Timeline consistency | Choose 3/5/10 years and custom From/To; inspect every category | Switching categories and exporting uses the same configured range; product GA/EM and lifecycle dates are unchanged by a viewport-only change |
| MSRP consistency | Display groups card/Roadmap switches with clear scopes and price availability | Exercise all four visibility combinations with a known price, zero, meaningful text label, and missing/TBD price; Roadmap bars/details share the global switch, prices survive saving/reload, and ASCM retains existing prices |
| Settings and edits | All display/timeline/category controls have one clear entry point | Specifications label/value/remove actions persist after reload; category lanes remain category-specific; slot drag mode requires explicit enablement |
| Clear all products | Confirm clear preserves category names, lane structure, templates, active category, global/display settings | Test only in a disposable workspace; products, image registry/local library, and ASCM snapshot are removed |
| HP SKU identity | Empty and unassigned color identity is understandable | Drawer/Roadmap details show each Base PN with its own color/code and source association; copying retains the exact SKU |
| PNG | Product and Roadmap images download and are not clipped | Dense categories and long roadmaps export at useful resolution |
| PPTX | Toolbar action reachable from both views; check one/multiple/all, Current category only, Select all/Clear selection, empty-selection guard/Cancel, and scope-aware estimates | Only selected categories render in portfolio order; saved UI state returns; Product/Roadmap/Both counts are correct; continuation is readable; dedicated slide numbers/numeric page counters are absent; divider is subtle and status/platform presentation matches cards |
| Accessibility | Keyboard reaches menus/tabs/dialogs; visible focus; Escape closes overlays | Selected/product details are understandable without pointer-only discovery |
| Responsive/touch | Narrow viewport has no inaccessible controls | Roadmap/product navigation works without unintended page scrolling |
| Deployment | Pages artifact loads without 404s | Package remains absent from the deployed artifact |

Test browser console and network failures, not only appearance.

### Current verification record — 2026-10-07

The parent-height redesign supersedes the content-measured drawer and lower-lane expansion described in the historical record below.

| Check | Environment and result |
| --- | --- |
| Parent-height pane and shared Overview | Automated `scripts/test-product-details.mjs` passes using actual application sizing/placement/render functions. Compact cards at 300/552 logical pixels and full-spec cards are exercised at 20/50/65/100/150% zoom, across first/middle/last lanes and opening progress 0.01/0.25/0.5/1. Pane height/top/bottom exactly match the rendered parent; content-height reads are rejected; lanes and canvas height remain unchanged. Tests cover 620/760/840 px widths, horizontal reserve/export exclusion, missing-card suppression, complete specifications, and separately focusable date/specification regions. |
| Base application lane consumers | Automated `scripts/test-portfolio-model.mjs` passes: actual dimensions, drawing, backgrounds, rail labels, hit regions, and drop destinations retain base lane positions at 20/65/100/150% zoom. Closing, stale IDs, filtering, and exports preserve board height; only the live view reserves horizontal pane space. Generic `layoutProductLanes` expansion coverage remains a model test, not the inline pane's behavior. |
| Browser layout and internal overflow | Existing local workspace on `http://127.0.0.1:4173`, Brave browser: verified the side-by-side Overview with a 620 px wide, 493 px tall pane at 100% zoom. At 20%, the pane was 840 px wide and 98.6 px tall, with positive, independently focusable calendar/specification scroll viewports. The lane rail positions were unchanged before/after opening at the fitted zoom. At 150%, pane height was 739.5 px. In a temporary 960 × 720 viewport, Overview/More/Source and the Roadmap adaptation remained usable; the Roadmap Overview had a 335 px viewport for 538 px of content, and keyboard End reached the last specification. Restored the normal browser viewport. Saved the final card-and-pane preview as `artifacts/product-detail-redesign.jpg`. |

### Historical verification record — 2026-10-06

These checks describe the earlier overhaul, separate from the full matrix above. Drawer sizing and lane-expansion measurements predate the 2026-10-07 redesign and are not its acceptance criteria.

| Check | Environment and result |
| --- | --- |
| Specification edit/add persistence | Separate empty origin `http://127.0.0.1:4174`; created synthetic Verification headset, changed the first spec to `USB-C · verified`, added an eighth spec, closed/reloaded/reopened. Both edited and added facts persisted. |
| Global timeline across categories | Separate test workspace on `http://127.0.0.1:4174`; changed Mice to ten years (end 2035), switched to PC Gaming Audio, and reopened settings. The same end year remained. Restored five years afterward. |
| HP SKU identity | Supplied 198-product workspace; confirmed the selected source-linked two-tone part number showed Black / Blue with its own SKU row. This check preceded the final Roadmap-only navigation change. |
| Earlier compact dates/source layout | Supplied 198-product workspace; all six key dates were visible without outer/active-panel scrolling in the drawer and former Split layout. Source showed per-PN dates correctly. The final Overview also includes all specifications; the earlier no-scroll result is not a guarantee for that longer panel. |
| Additive ASCM application | Automated `scripts/test-ascm-import.mjs` passes using the actual application import-plan/schema path: updates/adds, omitted and blank source facts, category moves, data/image retention, repeat import, flags, ambiguous skips, new-only category/lane baseline specs, and spec editing. |
| Pure portfolio rules | Automated `scripts/test-portfolio-model.mjs` passes for global timeline/lifecycle/spec/SKU/status/MSRP rules, Console status-first banners/neutral platform badges with unchanged metadata, and actual price rendering/visibility handlers. Lane tests cover pure first/middle/last-lane expansion at 65/100/150% zoom plus actual canvas dimensions/drawing/backgrounds/rails/hit tests/drop/export consumers, full opening-height reservation, closed/stale/filtered guards, and unchanged saved lane data. |
| Final Overview contract | Automated `scripts/test-product-details.mjs` passes: all six dates/lifecycle and all eleven fixture specifications share Overview; no separate Specs tab or specification pager; SKU/variant/source paging, keyboard/copy/escaped text, independent surfaces, real date/SKU adapters, and settings-preserving clearing are covered. |
| Selected-category PPTX decisions | Automated `scripts/test-pptx-pagination.mjs` passes using actual app checklist/summary/planning/export functions with recording image/file adapters. Covers all scopes, selected-only category/product coverage in portfolio order, session choice restoration, empty/stale selection guards, pagination, numberless titles/folios, subtle divider, image placement/proportions, and immutable category data. This does not verify a real browser download or PowerPoint opening. |
| Real PPTX serialization | The same test uses the shipped PptxGenJS to generate a 46,240-byte one-slide fixture in memory. ZIP CRC validation passes; slide XML contains only the title text and no footer/number/date placeholders. Its charcoal divider is 0.4 pt with 75% opacity, and the image relationship resolves to an intact valid PNG. This verifies fixture generation/structure, not browser delivery or opening the full portfolio deck in PowerPoint. |
| Final PPTX chooser | Live UI confirms one/multiple/all and empty category choices, usable Cancel with no selection, and scope-aware counts. The 198-product workspace produced a one-category/one-slide product plan and a two-category/five-slide plan; the test workspace produced a two-category/four-slide plan. Keyboard Tab wraps from Export to Close while the background is inert. At 1280×720, the 566 px dialog shows all eleven category choices without scrolling; at 390×844 it fits with internal category-list scrolling. |
| Final Console presentation | Live product cards and Roadmap details both show NEW PRODUCT as the teal primary banner and PLAYSTATION as a charcoal secondary badge. |
| Final primary navigation | Browser check confirms only Products/Roadmap main tabs, prominent Export PPTX opens its scope chooser, and Roadmap details show/hide works. No PPTX download/open success follows from opening the chooser. |
| Final Overview sizing | Isolated eight-spec product at 1280×720: all six dates/lifecycle/eight specs fit together. Roadmap panel client/scroll heights were both 335 px; card-drawer panel client/scroll heights were both 337 px. Drawer frame measured 431 px, with a complete border and 10 px card gap; content measurement removed the extra blank space. |
| Final inline lane/selection behavior | Isolated two-row fixture at 1280×720: pane bottom was 600 px and the next lane began at 643 px, with no overlap. Closing restored base row spacing; Enter reopened selected details. Switching to HP SKUs retained the 431 px pane height and lower-row spacing. Filtering out the selected product hid the pane (`aria-hidden=true`) and removed expansion. The old spec-popup element was absent; Details/Close and the quiet Selected marker were visually verified. |
| Independent saved MSRP | Isolated product with saved `$129.99`: price was hidden on product cards and visible in Roadmap details using the separate switches. |

The live package-replacement test was blocked by automatic approval review because replacing it would overwrite browser state. It was not retried, and no package round-trip success is recorded. Earlier PPTX submission had a 25-slide estimate and a 60-second download-tracking timeout; the latest one-category attempt also timed out after 20 seconds. No browser-saved file or PowerPoint opening is confirmed. Real bundled-library fixture serialization is verified separately above. Live XLSX apply, full-deck browser delivery/opening, full accessibility, and any unrecorded matrix rows remain deferred; passing automated helper/application tests does not establish these browser workflows.

## 8. Prioritized improvement roadmap

### Phase 0 — Protect the baseline

- Keep private data, screenshots, and logs ignored and untracked.
- Preserve the established `monocraft/PPC` connection and record a verified code baseline; check push and Pages deployment independently.
- Make static validation mandatory before deploy.
- Record source/package hashes and a concise change log.

Exit condition: a clean checkout serves and validates without private data.

### Phase 1 — Correctness, safety, and deployability

- Guarantee all runtime dependencies are in the Pages artifact.
- Make package import transactional with rollback.
- Report save/storage errors and current save status.
- Harden imported strings, IDs, URLs, colors, paths, sizes, and MIME types.
- Add schema/package unit tests and a Playwright smoke suite.

Exit condition: malformed imports cannot damage the previous workspace, and deploy smoke tests pass.

### Phase 2 — Decide the content strategy

- Keep the private package local, or create a separately reviewed and sanitized public seed.
- Reconcile or remove the 85 currently unreferenced WebP assets.
- Decide which remote images must be made local for offline/reliable use.
- Document ownership and update cadence for catalog templates versus portfolio content.

Exit condition: first-load behavior and data publication rules are intentional and documented.

### Phase 3 — Reduce coupling

Extract stable modules in this order:

1. Schema normalization and migrations
2. Storage and image-asset repository
3. Package codec/import/export
4. Product and roadmap renderers
5. UI state/controllers
6. Presentation export adapters

Keep behavior fixed during extraction and use tests to prove equivalence.

Exit condition: migrations, storage, package I/O, and render calculations can be tested without booting the full page.

### Phase 4 — Accessibility, performance, and polish

- Provide structured non-canvas equivalents for core product/roadmap information.
- Complete keyboard, screen-reader, high-contrast, reduced-motion, and touch testing.
- Profile dense canvas redraws, image caching, and PPTX generation.
- Add visual regression coverage for palette tokens and responsive states.

Exit condition: all primary tasks work with keyboard/touch and remain responsive on the agreed dataset size.

## 9. Handoff checklist

Before handing work to another contributor, include:

- The exact branch/commit or source archive hash
- Files changed and the reason for each
- Schema/storage changes and migration behavior
- Whether the private package was used, without attaching or publishing it
- Validation command output
- Browser matrix rows completed and browser/viewport used
- Full feature-index/settings-map updates for changed behavior
- Known failures, console errors, and remote-image limitations
- Screenshots or exported artifacts for visual changes
- The next smallest safe change

A continuation note should distinguish **implemented**, **verified**, **known risk**, and **proposed** work. That prevents an audit recommendation from being mistaken for completed behavior.
