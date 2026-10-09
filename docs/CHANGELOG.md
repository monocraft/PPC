# Change Log

## 2026-10-08 — 200% viewing zoom

- Extend manual Products and Roadmap zoom to 200% for large and high-resolution displays, keeping clean 10-point steps and the visible center in place.
- Keep the percentage button's 100% reset and existing readable Fit behavior. Disable zoom in at 200% and retain zoom out immediately below the upper limit.
- Verify 200% product details geometry and reorder positioning alongside zoom bounds, fitting and restored scales.

## 2026-10-08 — unobstructed date editing

- Delay history on pointer hover by 450 ms and cancel it when the pointer only crosses a date label. Keep deliberate click/tap and keyboard inspection immediate.
- Prefer placing date history above its label, with a side fallback near the viewport edge. Make the informational popup transparent to pointer input and dismiss it immediately when entering or focusing an editing control.
- Retain accessible, hoverable history and age updates while ensuring fields and calendar/TBD buttons remain reachable.

## 2026-10-08 — date edit history and aging

- Add an unobtrusive hover, focus or tap popup to each of the six date labels in product details, Roadmap details and the editable date fields. Show the localized last update, elapsed age and optional updater name; indicate unsaved date changes separately.
- Retain independent accepted-date timestamps in shared product metadata. Genuine date edits, imports, consolidation and TBD clears update the appropriate clock; no-op saves, conflicts and unrelated changes preserve it.
- Recover trustworthy retained history for older data, preserve clocks after audit-history pruning, and display an honest empty state for dates without recorded history. Keep popups above scrolling panes without increasing the date layout height.

## 2026-10-08 — development and sunsetting presets

- Add In development and Sunsetting to the product Status dropdown with fixed blue `#7aa2cc` and amber `#d4a56a` accents. Render IN-DEVELOPMENT and SUNSETTING banners with readable dark text.
- Share the selected accent with variant badges, Roadmap fills/details and exported cards. Preserve embargo precedence, explicit lifecycle dates/stage and duplicate-label suppression.
- Retain the new status values through product creation, saved-data reload, imports and the existing shared save/conflict flow.

## 2026-10-08 — integrated discard segment

- Make each product's Discard action a flush end segment in Review changes, with a full-height click target, left divider and inset keyboard focus.
- Preserve independent Details disclosure, discard confirmation and Undo behavior; reduce the segment width on narrow screens.

## 2026-10-08 — consistent variant label colors

- Match variant/platform badges to the product status banner in both product cards and Roadmap details, including white text on embargo red and dark text on new-product teal.
- Retain the compact badge position, space for Details, duplicate-label suppression and shared export rendering; update the editor's help text to describe the matching colors.

## 2026-10-08 — clear product editor heading

- Label the editable information section Product information and dates, removing the misleading Viewer details and Read-only pane labels.
- Keep product information, all six dates and HP SKUs available through the existing editing and save flow.

## 2026-10-08 — aligned headset specification icons

- Align compact specification icons with the first line of their value, including headset connection, microphone, driver, audio, cushion, frame and control rows.
- Center asymmetrical icon shapes consistently while preserving text wrapping, row spacing and card sizes. Use the same alignment in exported product cards.

## 2026-10-08 — compact key date rows

- Halve inline product date tiles from about 59 px to 28 px by placing full labels beside right-aligned values, retaining two columns and the existing date accents.
- Give the calendar more horizontal room in a 720 px pane while keeping specifications readable in one column. Preserve the exact parent-card height, independent overflow, lane positions, More identity cards and the narrower Roadmap details.
- Let the wider pane scroll fully into view on opening; hover redraws no longer interrupt that smooth reveal.

## 2026-10-08 — fluid product reordering

- Rename the toolbar action to Reorder products and use product wording in the active Done/Cancel controls.
- Keep a muted ghost at the original position and a distinct destination placeholder while dragging. Draw the lifted product above the other products, with nearby products sliding smoothly to preview the new arrangement.
- Animate completed drops into position and canceled gestures back to their source; keep horizontal and vertical edge scrolling active while holding near an edge.
- Keep previews separate from saved ordering until a completed drop. Preserve hidden-product order under filtering, cancel, keyboard, category/view/save transitions and exports; honor reduced-motion preferences.

## 2026-10-08 — direct view tools and clear card reordering

- Move Reorder cards into the Products toolbar. Keep Done and Cancel visible while reordering; Done keeps the draft, while Cancel or Escape reverses only this session's card moves and preserves unrelated edits. Finish temporary reordering when changing category, switching view, or opening save review.
- Remove Show selected from both views. Search and view changes reveal the selected product automatically in both directions; off-range or undated timeline products still reveal their row without changing dates or the viewing range.
- Expose Reset layout directly beside Products zoom and Fit. Put Date range and Show/Hide details before Roadmap zoom; remove both View options menus.
- Use clean 10-percentage-point zoom increments for both views, including automatic fit and legacy scale normalization. Products stays within 20–150%, with a readable 70–100% Fit; Roadmap stays within 10–130%, with Fit at least 40%. Preserve the visible center while zooming.
- Use white lettering for red embargo banners and timeline labels, including product details and exported cards.

## 2026-10-08 — aligned header and consistent dropdown controls

- Move the active category's product count and filtered count to the bottom status bar beside the latest update information. Keep the toolbar focused on search, view and selected-product actions.
- Align the category selector with the P mark and other header controls, removing the redundant eyebrow label above the selector.
- Use consistent drawn chevrons for native dropdowns and compact disclosure controls while retaining native keyboard and selection behavior.

## 2026-10-08 — compact view tools, practical zoom and readable specifications

- Combine search, view tools, product count and selected-product actions into one desktop row for Products and Roadmap. Place sorting and secondary view actions in compact disclosures that open over the workspace, with keyboard dismissal and reliable focus restoration.
- Retain readable controls and compact wrapping on narrower screens, keeping the category, primary view tabs, messages, updates, export and settings accessible.
- Use familiar proportional zoom stops with finer low-scale increments, preserve the visible center while zooming, and return to 100% by clicking the percentage. Fit retains at least 65% for product cards and 40% for the timeline, with scrolling for larger collections. Clamp invalid or legacy tiny scales to the supported manual bounds.
- Use the same readable silver text for every product specification value, including microphone and keyboard values previously shown in darker colors. The shared card renderer carries the correction into PNG and PowerPoint exports.
- Remove repeated product/lane counts, view labels, import dates and storage notes from the footer; retain only the latest accepted update time and expandable comment.

## 2026-10-08 — portfolio-wide search and clearer roadmap status

- Search product names, HP SKUs, variant codes, specifications and imported base part numbers across every category. Rank exact SKU matches first, display each result's category and lane, and open its product details directly on the matching SKU or variant page. Preserve legitimate listings in multiple portfolios and unsaved drafts.
- Use View Mode and Edit Mode for timeline navigation and deliberate date adjustments. Remove the drag instruction row and repeated selected-product name; retain one selection label and compact row-order actions only in Edit Mode.
- Close the roadmap details pane when the selection is cleared or filtered out. Keep the user's details preference and reopen it when another visible product is selected. Stabilize clipped year labels at calendar boundaries while panning.
- Show the latest accepted update's date and comment in the footer, including automatic team refresh. Use a short product-count summary when no comment is supplied; cancelled, rejected and unchanged submissions retain the prior accepted status. Repair legacy generated save stamps without replacing a later explicit export comment.

## 2026-10-08 — guided product consolidation and safer editing

- Compare two products within one portfolio and combine complementary details, specifications, HP SKUs, variants, images, and source records. Require an explicit choice for every conflicting populated value; keep the surviving product's identity and redirect related roadmap references.
- Submit a product consolidation as one atomic operation. Check both reviewed records and their full metadata before acceptance, retain both original records privately, and require a fresh review after concurrent changes. Hydrate complete merged details for other connected sessions.
- Group save review into collapsed product summaries with expandable fields, long-value disclosures, and search for larger batches. Add per-product and whole-draft discard, confirmation, and guarded Undo. Remove the disconnect control from normal settings.
- Keep routine update messages brief and neutral. Place longer warnings and actions in Messages; remove storage and publishing details from the everyday interface.
- Default roadmap gestures to Move view, panning horizontally and vertically across products, labels, calendar, and empty space. Enable date changes and row reordering only in Adjust dates; Escape cancels the gesture and restores Move view.
- Remove ambiguous Start/End month inputs and reciprocal view buttons. Keep lifecycle dates in product Details, soften row grips, and wrap product labels to improve readability.

## 2026-10-08 — automatic team sessions

- Remove instructional footer text and manual-pull prompts from the connected sessions panel. Keep the session count, viewing/editing context, and optional display name.
- Reconnect an unlocked Supabase master automatically when its browser tab reloads. Remember only that tab's package access, scoped to the configured master; disconnect or an invalid key clears it. Personal GitHub tokens and private publishing credentials are never stored for this feature.
- Keep unsaved product drafts during automatic shared refreshes and continue updating team activity in the background.

## 2026-10-08 — private team master and complete colorway checks

- Add a private Supabase saving function and restricted database for shared products, specifications, SKUs and all lifecycle dates. Reuse the existing package key and optional browser display name; team mode never requests personal GitHub tokens or a second editing password.
- Accept independent concurrent edits atomically, ask for final values on overlaps, and retain drafts through cancelled conflicts, connection failures, refreshes and lost accepted replies.
- Share new products and deletions with explicit identity/deletion conflicts. Preserve privately archived images and custom metadata when a deleted product is deliberately restored.
- Show each connected browser's current category and selected product as Viewing or Editing. An unrelated unsaved draft does not change the displayed viewing location.
- Publish the full encrypted GitHub package through one serialized Actions workflow. Preserve archive entries, detect unexpected master replacements, prevent revision regression, and show accepted team saves separately from pending or failed GitHub publication.
- Allow distinct single and dual colorways to share an abbreviation: Black, Red, Black/Red and Red/Black are different variants. Flag identical normalized codes with the same complete color combination, while retaining layout and HP SKU protections.
- Add meaningful model/client/actual database/gateway/publisher checks and private owner setup documentation.
- Refresh deployment asset versions on every Pages run, including settings-only redeploys, so browsers load updated team connection settings.

## 2026-10-08 — portfolio-specific duplicate checks

- Allow matching product names and HP SKUs in different product portfolios, including PC Gaming Audio and Console Gaming Audio. Review repeated assignments within a portfolio with exact product and row locations.
- Match ASCM updates to the report's mapped portfolio first. Keep PC and Console listings separate, while preserving exact category corrections elsewhere.
- Retain source rows for a shared HP SKU sold in different portfolios. Only repeated primary rows within the same mapped portfolio are deduplicated.
- Retain protections for repeated SKU rows on one product, duplicate variants, and conflicting internal product IDs.

## 2026-10-07 — shared product saves and conflict choices

- Reuse Pull latest data as Save to master when shared product details, dates, specifications or SKU edits are waiting. Review changes and an optional reason before submission; restore Pull latest data after success.
- Default to direct GitHub master updates with individual memory-only access tokens, immutable encrypted blob reads and file-SHA conflict checks. Keep detailed changes/reasons encrypted, preserve images and unrelated fields, and recognize interrupted accepted saves.
- Add a fixed-file encrypted master service with narrow product updates, serialized/atomic saves, explicit mine/master conflict choices, field revisions and bounded change history. Different fields and different specification/SKU entries combine without replacing entire portfolios.
- Preserve unsent drafts across shared refresh and reload, keep images/layout outside shared field updates, and provide a local trial with three example products and separate browser storage.
- Show Recent editors in GitHub mode, using the accepted save's GitHub account and time. The optional service mode instead shows connected browser sessions, viewing/editing context and optional names.
- Add Pages configuration and meaningful encrypted GitHub race/roundtrip, model, service and client checks. GitHub mode needs no separate service host; editors require repository write access. An optional HTTPS master service remains supported.

## 2026-10-07 — consistent product widths and shared lane pages

- Use one product-card width across every selected category and continuation slide, reserving a common 13-column canvas even for sparse categories. A shared canvas also handles unusually tall cards without changing scale between categories.
- Show multiple distinct lanes together whenever their card heights fit. Continue overflowing lanes in parallel, retaining each lane's row position when another lane has finished. A lone lane can use the remaining rows for its own continuation products.
- Keep the same full slide content frame on every product page, including sparse final pages. Preserve family-aware wrapping, saved order within each lane, all editable product groups, source data, and PowerPoint repair prevention.
- Check consistent card widths across categories, paired headset lanes, unequal lane continuations, complete product coverage, and actual exported deck layout.

## 2026-10-07 — direct Roadmap placement and package footer

- Move products directly with visible row grips or a vertical bar-body drag. Keep the original row outlined and show an insertion guide and destination feedback; a drop into another family changes that product's roadmap family. Save independent `roadmap.order` while preserving portfolio lane/card order, filtered products, and nonmoving relative order.
- Resize hovered/selected start and end edges without opening Settings, or drag horizontally to move the duration. Show live start/end feedback including known exact GA/EM dates, account for timeline scrolling and edge auto-scroll, clamp endpoints, and discard drafts on Escape or pointer cancellation.
- Place Move up/down and Start/End month controls beside the timeline, with Alt+Up/Down and live announcements for keyboard access. Both Roadmap surfaces share the same interactions; remove the obsolete Edit selected roadmap slot gate.
- Replace the footer's card-interaction sentence with the loaded package update date and an expandable comment, including keyboard access and explicit missing-metadata fallbacks.
- Add pure interaction checks for saved/legacy row order, family boundaries, filtered source-gap no-ops, retained hidden products/portfolio positions, cross-family moves, and snapped endpoint drafting.

## 2026-10-07 — readable paginated product portfolio exports

- Product Portfolio exports now wrap each lane at a maximum of 13 products across and continue onto more slides when the available height is full. Tall detailed cards use fewer rows per slide.
- Preserve saved lane/product order and keep contiguous product families together when they fit a row. Repeat lane labels and family context, and use the same card scale on every page of a category.
- Calculate export dimensions independently of browser viewport, zoom, selection, and open detail panels. The export chooser's slide estimate uses the same page plan as the downloaded file.
- Retain one editable PowerPoint group per product and the repair-prevention compatibility pass. Automated coverage checks row limits, vertical fitting, complete product coverage, partial continuation pages, source immutability, and actual selection/summary/export behavior.

## 2026-10-07 — package update date and comments

- New package builds include an automatic UTC build timestamp and optional updater comments of up to 2,000 characters. Viewers see the package's own update details after unlocking and importing it.
- Keep update details inside the encrypted master. No plaintext metadata sidecar, package key, or decrypted comments are published or printed by the owner helper.
- Validate optional metadata consistently in browser import and authenticated local publication. Older packages without metadata remain supported; malformed metadata blocks replacement of the current package.
- Document rebuilding with the same key and replacing `public/data/master_ppc.pkg`. Reuploading an existing package preserves its recorded build date and comments.

## 2026-10-07 — keep ASCM import in settings

- Removed Import ASCM and its explanatory copy from the welcome screen. First launch and empty categories offer Pull latest data and Import package.
- Keep the advanced Import ASCM report action in Settings → Data & export, with its existing reviewed additive import flow.

## 2026-10-07 — grouped view controls outside settings

- Grouped Products zoom out, percentage/reset, zoom in, Fit, and Reset layout in its main toolbar so viewing and layout actions are available beside the canvas.
- Added the matching Roadmap zoom group with Fit, Today, and Show selected. Roadmap zoom changes the horizontal month scale, uses 82 px per month as 100%, remains within 8–112 px per month, and preserves the month at the center of the visible timeline. The bottom navigation remains available.
- Removed Fit products, Reset layout, Go to today, Fit timeline, and Show selected from Workspace settings. Display retains saved MSRP and SKU-footer preferences; Timeline retains the global range/year-span, snap interval, and fixed stage/status legend. Category and data editing remain in their existing settings sections.
- Zoom, fitting, and timeline navigation remain temporary view state; the saved timeline range and product dates are unchanged by these actions.
- All thirteen project checks passed. Browser checks at 1280 px and 763 px widths confirmed toolbar controls remain visible without horizontal overflow, Product zoom/Fit/reset works, and Roadmap zoom/Fit works with its details pane open or closed.

## 2026-10-07 — automatic specification card layouts

- Removed the Display setting Full specifications for supported categories. A single-lane category or category that explicitly supports full-spec cards, including Gaming Accessories, uses the expanded layout automatically when at least one product has specifications. Every card in that category shares the layout/height; other multi-lane categories and categories with no specifications retain compact cards.
- Kept the complete specification list in Overview and the shared card layout used by Products, PNG, and PPTX. Product/specification data is unchanged.
- Retained existing saved `fullSingleLaneSpecs` values as inert compatibility data; new defaults no longer create the setting.
- All thirteen project checks passed. Browser verification confirmed the checkbox is absent, existing MSRP/SKU-footer/layout controls remain available, and no browser errors occurred.

## 2026-10-07 — replace browser popups with app dialogs

- Replaced the native ASCM import-complete popup and all remaining application alert/confirm calls with a shared charcoal app dialog. Import/export/image errors and specification notices use titled app messages; package import keeps its existing inline completion/error feedback.
- Delete product and Clear all products now await custom Cancel/confirm controls. Cancel is initially focused; cancellation preserves products/images, and delayed confirmations cannot target a replacement workspace or a different category's selected product.
- Added keyboard trapping, Escape/backdrop dismissal, literal message rendering, queued requests, preserved background modal state, and visible focus restoration. Clear-all returns focus to the welcome action after its asynchronous image cleanup finishes.
- Included the dialog module in startup and the deployment allowlist. All twelve project checks passed, including clear-all cancellation and stale-confirmation checks. Isolated desktop/mobile browser verification exercised a generated ASCM workbook, completion and error flows, nested settings, literal markup, queues, keyboard controls, deletion, package import, and clear-all; it recorded zero native browser dialogs and zero browser errors.

## 2026-10-07 — hide the header for an empty portfolio

- Hide the bottom status bar for the same empty-portfolio state, so the welcome screen fills the full viewport. Restore status automatically when products are loaded; retain it for empty categories when other categories contain products and for zero-match searches.
- First launch and portfolios with zero products hide the entire top toolbar and controls, including category/view navigation, pull/export/settings buttons, search/sort/zoom, and the selection row. The welcome screen fills the available workspace and retains Pull latest data, Import package, and Import ASCM.
- Restore all header rows when products are loaded. Keep navigation for an empty category when another category has products, and retain controls when a search has no matches. Product counts across the portfolio determine this state.
- Keep header controls out of keyboard navigation while hidden, and return package-dialog focus to the visible welcome action after an empty replacement import.
- All twelve existing project checks passed. Isolated browser verification covered thirteen cases, including first launch, populated/empty replacement imports, final-product deletion, clear-all, both search views, empty categories, saved-data reloads, desktop/mobile layout, welcome actions, and focus restoration, with no browser errors.

## 2026-10-07 — compact HP SKUs and row copy feedback

- Replaced the wide HP SKU table with compact entries pairing each color/swatches with its part number. Six SKUs appear per page in two columns when the panel is at least 440 px wide, and one column in narrower panels.
- Refined the entries to match the supplied mockup: a 40 px square swatch leads the stacked color name and bold part number, with the Copy button aligned on the right. Two-tone and multiple-color mappings remain visible; unassigned colors use an empty dashed placeholder.
- Additional options shares the same card spacing, large swatches, stacked text, and responsive columns. Layout options use a neutral locale-code square and retain their descriptive names and group labels.
- Colors without an assigned HP part number display Missing HP SKU instead of COLOR SKU, keeping their color code and swatch without implying that the code is an HP part number.
- Removed the duplicate More → Variants view. HP SKUs now includes Additional options for layouts and colors without an HP SKU mapping, eight options per page; saved variants and editor controls remain available.
- Copy success pulses the entire SKU entry for 700 ms, with a static highlight for reduced motion and a temporary Copied label. Fixed-width buttons, guarded request/timer handling, accessible status feedback, and a tiny fixed-position clipboard fallback prevent copy feedback from widening or scrolling the panel.
- All ten project checks and the diff whitespace check pass. Browser verification confirmed two columns on Cloud Jet 2, exact clipboard text, fixed 52 px buttons, and unchanged panel client/scroll widths in both the 515 px Products pane and 322 px Roadmap pane. Eve 1800 retained all 15 keyboard layouts across two Additional options pages in a 312 px pane.

## 2026-10-07 — separate product objects in PowerPoint exports

- Roadmap exports now place each visible product in one native rounded rectangle containing editable text. Product names, optional MSRP, stage/status colors, date placement, and concept dashed outlines remain attached to that product shape. Calendar and family context stay in a separate background image.
- Product Portfolio exports now place each card in one named PowerPoint group containing native frames, banners, separator lines, and editable names, prices, specification values, and SKU labels. Product artwork and small specification icons remain separate pictures inside the group. Groups can be moved/resized independently and ungrouped to edit individual parts.
- Shared roadmap geometry clips products to the configured timeline and omits bars entirely outside it. Category selection, family pagination, slide titles, and PNG behavior are retained. Export uses copied category data and restores temporary view and hit-region state on success or failure.
- Added native-object OOXML, product-free background, date clipping, individual card placement, and failure-restoration checks. Grouped delivery checks verify editable text, image relationships, unique IDs, exact group coordinates, and rounded banner/frame paths. An isolated headless browser exported all 11 categories from the 85-product legacy fixture; separate cards and roadmaps rendered correctly without changing its saved portfolio.

## 2026-10-07 — unified encrypted packages and portable shared-data setup

- Added one keyed encrypted master package for every category, Products, Roadmap, settings, variants, and saved local images. Export project package now opens a protected export dialog with key reuse/creation/copy and downloads `master_ppc.pkg`; an unprotected local backup is an explicit optional choice. Missing local binaries block a complete export.
- Added Pull latest data and unified manual import/export dialogs. Shared pulls require an encrypted source; manual imports support legacy stored ZIPs and keyed packages. Keys are not persisted and are cleared when the dialog closes.
- Changed package replacement to validate the manifest/image references and stage incoming images under new IDs before committing metadata. Preserve original data/images until metadata and workspace activation succeed; roll back failures and delete superseded images only after success. Package imports do not save a previous-workspace snapshot. Existing legacy recovery metadata and unreferenced images are retired after a successful replacement. Keep lightweight data import as its existing separate flow and use downloaded packages for backups.
- Added a portable Node fixed-file relay with authenticated envelope checking, exact CORS, bounded source/request sizes, concurrency/IP rate limits, explicit trusted-proxy handling, no cached plaintext/keys, and generic errors. It serves an approved local SharePoint mirror behind HTTPS and requires no Azure dependency; the owner sync process still signs into Microsoft.
- Added endpoint-only source configuration with an empty checked-in default, GitHub repository variable `PPC_PACKAGE_ENDPOINT` for Pages, and a local `--package-endpoint` serving override. No private SharePoint URL, key, package, or host mirror path belongs in the static site. Shared live connectivity remains a separate deployment/setup verification.
- Added codec, actual workspace replacement/rollback/cleanup, and isolated relay checks; documented source freshness limits, publisher steps, OneDrive sync, and portable HTTPS hosting in Shared package setup. The concise public README remains unchanged.

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
