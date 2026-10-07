# Product Portfolio Canvas

Product Portfolio Canvas is a local-first, static browser application for maintaining product-card boards and multi-year roadmaps. It has no backend, build step, or runtime package dependencies: the browser loads the checked-in HTML, CSS, JavaScript, catalog, assets, and vendored PowerPoint library directly.

## Baseline at a glance

| Item | Current baseline |
| --- | --- |
| Code source | Current local workspace; `main` tracks `origin/main` at [monocraft/PPC](https://github.com/monocraft/PPC) |
| Original archive baseline | `PPC-main.zip`, SHA-256 `61032432E31AC18A985F9748E56ED1A63DE7E2EACE4D5CEE55BB9B565DB16AF3` |
| Default catalog | Version 1; 11 categories, 16 lanes, 18 spec sets, **0 products** |
| Working data package | Version 4; 11 categories, **85 products**, 85 image assets |
| Persistence | Browser `localStorage` for portfolio metadata; IndexedDB for locally uploaded image binaries |
| Views | Products and Roadmap; Roadmap has an optional product details pane |
| Navigation and settings | Category dropdown in the compact toolbar; one Workspace settings dialog |
| Timeline | One portfolio-wide range, snap interval, and fixed product/stage tones |
| Exports | Export PPTX for one, multiple, or all categories in both views; `.data`, `.pkg`, and PNG in Settings; PPTX roadmaps paginate at 22 products per slide |
| ASCM updates | Local `.xlsx` preview and additive product upsert by HP Base PN |

The repository intentionally separates code/templates from working portfolio data. The package at `project-data/private/product-portfolio-project.pkg` is a local, ignored working fixture. It is not part of the public catalog and must not be committed or deployed.

On 2026-10-07, this workspace was connected to `https://github.com/monocraft/PPC.git` using the remote's 2026-09-23 `Color Variant` commit (`6665bd6e7e7589b31f317f3e931d8cfb6fec35ce`) as the Git baseline. Branch/index alignment preserved the current local application files. Commit `548c936` (`Update portfolio workspace and parent-height product details`) was then pushed to `origin/main` as a normal fast-forward update. The remote baseline already tracked the private package; this update removes it from the repository's current tree while preserving the file on disk, and `artifacts/` is now ignored. Prior Git history still contains the package. The [Deploy to GitHub Pages run](https://github.com/monocraft/PPC/actions/runs/37658673619) succeeded for commit `548c9363fbc67bd949e671187f613da5033c05dc`. Pages was changed from legacy `main` branch-root publishing to workflow publishing, and the configuration was re-read to confirm that the reviewed deployment allowlist is the publishing path. All nine public HTML/CSS/application JavaScript files returned HTTP 200 and matched that commit byte-for-byte by SHA-256 comparison. The [live app](https://monocraft.github.io/PPC/) also rendered correctly in the browser with the expected empty starter portfolio.

## Run locally

Node.js 20 or newer is the only development prerequisite. No dependency installation is required. The direct command works even when `npm` is not available on `PATH`:

```powershell
node scripts/serve.mjs
```

If `npm` is available, the equivalent shortcut is:

```powershell
npm run serve
```

Open the local URL printed by the server. Use an HTTP server instead of opening `index.html` as a `file://` URL so browser storage, assets, and downloads behave consistently.

## Load the current working portfolio

The default catalog starts with empty boards by design. To work with the 85-product snapshot:

1. Open the application locally.
2. Select **Settings → Data & export → Import project package**.
3. Choose `project-data/private/product-portfolio-project.pkg`.
4. Confirm that all 11 categories load and that the product count totals 85.

Import replaces the active browser workspace and its local image library. Export a `.pkg` backup first if the browser already contains work that must be retained.

## Update products from an ASCM report

1. Open **Settings → Data & export → Import ASCM report** and choose an `.xlsx` export.
2. Review the preview of new products, matched updates, new Base PNs, and any mappings that need review.
3. Choose whether to update matched products and/or add new products, then select **Apply ASCM update**.

The updater reads the report locally in the browser. It uses the canonical row for each **Base PN** and imports Category, HP Base PN, the exact **GPG 40 char AMO Description**, GA, EM, and explicit color codes found in the description. Code Name is retained as source metadata and initializes the codename of new products. Matched products keep their curated names, images, prices, specifications, card/roadmap status, and other manually curated fields. Blank source dates retain saved dates. Existing PNs, variants, colorway images, and source records remain even when a later report omits them. Ambiguous mappings are skipped; ASCM never deletes absent products.

On the first import, products without saved ASCM/HP identifiers use a cautious unique normalized name inside the mapped category; console headset fallback also checks platform identity. Saved Base PN links make later updates deterministic. Always review the first preview before applying it.

## Find settings and edit products

The compact charcoal shell keeps the category dropdown, **Products** and **Roadmap** tabs, and **Export PPTX** in the top toolbar. Roadmap can show or hide its selected-product details pane. Empty categories offer **Import package** and **Import ASCM**; manual Add product is an admin action in **Settings → Category**, available even when a category is empty. Edit product remains beside the selection. **Settings** contains four sections:

- **Display** — grouped MSRP controls: product cards for the active category, Roadmap bars/details for all categories; SKU footer, full specifications, and fit/reset for the active category.
- **Timeline** — shared 3/5/10-year presets, custom From/To, snapping, and a fixed stage/status legend.
- **Category** — product/slot editing, card reordering, category names, titles, roadmap labels, and lane structure.
- **Data & export** — separate **Import** and **Export** panels with directional icons and short descriptions. Import brings files into the workspace: ASCM previews additive updates, while package/data backups replace workspace data. Export saves package/data copies or the active category's PNG to your device. **Clear all products** sits below both panels and removes products/images while keeping categories, lanes, and settings. Export PPTX opens from the main toolbar.

The product editor groups controls into **Details**, **Images**, **Specs**, **Variants**, and **Timeline** tabs. Changes save as you type; category/lane structural changes use Save/Cancel. Specification label/value edits and removal are persisted. New ASCM products receive editable category/lane baseline specification placeholders; matched products' specifications remain untouched.

Each card has one compact **Details** button, which changes to **Close** while its inline pane is open. With the Products canvas focused, **Enter** toggles details for the selected card. The pane and optional Roadmap details share **Overview**, **HP SKUs**, and **More** tabs. Overview opens first, placing all six key dates and the lifecycle summary beside the complete specification list. The dates and specifications scroll independently and can receive keyboard focus. The same content adapts to Roadmap's narrower panel. Specifications remain unpaged; HP SKUs and More's variant/source lists use pages. HP SKU rows pair explicit color names/swatches with each part number; unmapped SKUs say Not assigned. Use the HP SKU color selector in the editor to assign a variant manually.

The inline pane always matches its parent product's rendered height, including at 20–150% zoom and with full-specification cards. Its frame never grows vertically to fit content. It gains horizontal room instead: 620 px normally, 760 px beside a short card, or 840 px beside a very short card or a product with more than 14 specifications. The canvas scrolls horizontally when needed. Only later cards in the same lane shift aside; every lane keeps its height and vertical position while opening, closing, or switching detail tabs. PNG/PPTX product exports omit temporary horizontal Details spacing and controls.

Both views use the same saved MSRP. Their display switches are independent and keep the saved price: cards follow the active category's switch, while Roadmap bars and details follow the portfolio-wide switch. Missing prices stay blank, including old TBD placeholders; the current ASCM importer does not import MSRP. Display settings shows how many products have a saved price. Enter MSRP once in the product editor; a meaningful price label is used only when no valid numeric amount is saved.

Timeline range changes apply to all categories and exports without changing product lifecycle dates. Older workspaces migrate their active category's timeline into the shared settings once. Product/SKU colors remain business data. Primary card banners and roadmap bars share teal `#5fd6c1` for New product and red `#ef5b5b` for embargo; embargo takes precedence. Other manually selected lifecycle stages use fixed subtle tones on charcoal surfaces. Card borders and secondary platform badges stay neutral; selection uses a thin muted line and a small Selected marker. Roadmap selection uses a fine outline and leading mark, with no white glow on either surface.

The timeline header emphasizes large years and readable quarter/month labels on one quiet surface. Half-year bands and the selected lifecycle overlay box are removed; family spacing and stronger year seams provide orientation.

## Export selected categories to PowerPoint

1. Select **Export PPTX** from either main view.
2. Choose Product portfolio, Roadmap, or Both, then check the categories to include. All categories are selected initially; **Current category only** selects the active one, and **Select all/Clear selection** changes the whole list.
3. Review the selected-category and slide counts, then export. At least one category is required; Cancel remains available when the list is empty.

The deck keeps portfolio category order. Roadmap pages contain up to 22 products; later pages use `(continued)` rather than numeric page counters. Slides have no dedicated number/total folio and use a subtle charcoal header divider. Category choices are remembered for the current page session.

Product status takes priority over custom platform/variant labels: a New product tagged PLAYSTATION or XBOX keeps **NEW PRODUCT** as its main banner and shows the platform as a quiet secondary badge in cards and Roadmap details. This changes presentation while preserving saved status and variant metadata.

## Validate before continuing

```powershell
node scripts/validate-project.mjs
node scripts/test-ascm-import.mjs
node scripts/test-pptx-pagination.mjs
node scripts/test-portfolio-model.mjs
node scripts/test-product-details.mjs
```

If `npm` is available, the equivalent shortcut is:

```powershell
npm test
```

The validator checks source syntax and the static deployment/runtime contract. PPTX tests cover selected-category planning/export decisions and serialize a real slide through the bundled library, checking its ZIP, slide XML, divider, and embedded image. Browser download delivery and opening in PowerPoint remain separate checks in the [Continuation Guide](docs/CONTINUATION-GUIDE.md#7-browser-verification-matrix).

## Project map

| Path | Responsibility |
| --- | --- |
| `index.html` | Application shell, menus, dialogs, canvas elements, and runtime script order |
| `styles.css` | Charcoal-first visual system and all DOM layout/styles |
| `catalog-data.js` | Category, lane, spec-template, and catalog-image metadata |
| `app.js` | State, schema migration, canvas rendering, editing, persistence, import/export, and interactions |
| `portfolio-model.js` | Pure timeline/lane geometry rules, loss-aware specification normalization, explicit HP SKU color resolution, shared MSRP text/product tones, and settings-preserving clearing |
| `product-details.js` | Shared read-only Overview/SKU/More tabs, complete Overview specifications, secondary-list paging, and keyboard/copy behavior |
| `workspace-ui.js` | Toolbar category navigation, quick actions, centralized settings, keyboard/focus management, and shell synchronization |
| `ascm-import.js` | Defensive `.xlsx` reader, canonical-row filtering, product grouping, color extraction, portfolio matching, and conservative additive updates |
| `pptx-pagination.js` | Ordered category selection and shared 22-product roadmap pagination helpers |
| `assets/` | Placeholder SVGs and catalog image files |
| `vendor/pptxgen.bundle.js` | Vendored PptxGenJS 4.0.0 browser bundle |
| `scripts/` | Dependency-free local server and project validator |
| `.github/workflows/deploy.yml` | GitHub Pages packaging and deployment |
| `project-data/private/` | Ignored local data packages; never deployed |

## Documentation

- [Feature Index](docs/FEATURE-INDEX.md) — complete feature inventory, settings map, category/spec templates, import contracts, persistence, and source anchors.
- [Project Audit](docs/PROJECT-AUDIT.md) — evidence-backed architecture, data/storage behavior, baseline provenance, and risk register.
- [Continuation Guide](docs/CONTINUATION-GUIDE.md) — the repeatable workflow for syncing sources, changing schemas, testing, and handing work to the next contributor.
- [Change Log](docs/CHANGELOG.md) — baseline identity, improvements applied, verification, and deferred work.
