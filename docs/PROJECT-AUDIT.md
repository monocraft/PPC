# Project Audit

Audit snapshot: 2026-09-22

This document describes the synchronized source baseline and the separate working-data package. It is an implementation audit, not a promise that every risk listed below has already been corrected.

## 1. Provenance and baseline integrity

| Artifact | Evidence | Interpretation |
| --- | --- | --- |
| Latest source archive | `PPC-main.zip`; SHA-256 `61032432E31AC18A985F9748E56ED1A63DE7E2EACE4D5CEE55BB9B565DB16AF3` | Authoritative code baseline supplied for this update |
| Archive inventory | 111 ZIP entries: 94 files and 17 directories | The local source was replaced from this archive and file hashes were verified during synchronization |
| Working package | `project-data/private/product-portfolio-project.pkg`; SHA-256 `3FB436E56FAE28CC7FE125030841690039084679C15619CDDC763DA6D2D5B3A4` | Authoritative working portfolio data supplied separately from the code |
| Package format | Stored ZIP with `portfolio.json` plus one PNG entry | Compatible with the application's custom uncompressed package reader |
| Audit-time version control | No `.git` repository was present | Establish a Git baseline before broad refactors if this workspace will become the long-lived source |

The source archive and package serve different purposes:

- The archive defines application code, static assets, templates, and deployment configuration.
- The package defines the current private portfolio content used for local testing and continued editing.
- The package is deliberately kept under `project-data/private/`, ignored by Git, and excluded from deployment. Publishing it requires a separate, explicit content/security decision.

## 2. Inventory

### 2.1 Default catalog

`catalog-data.js` defines a version 1 catalog with:

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

The `assets/` directory contains 85 WebP files and two SVG files. Because the source catalog has no products, those WebP files are not referenced by default product records. Restoring the sample/default workspace therefore creates the category structure but no cards.

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

## 3. Runtime architecture

The application is a static, client-only system. There is no server API, database service, framework, bundler, or compilation step.

```text
index.html
  ├─ styles.css
  ├─ vendor/pptxgen.bundle.js  → global PptxGenJS export support
  ├─ catalog-data.js           → window.PORTFOLIO_CATALOG
  └─ app.js
       ├─ normalize/migrate portfolio state
       ├─ render Product and Roadmap canvases
       ├─ render Split-view DOM details + roadmap canvas
       ├─ manage editing and navigation
       ├─ persist metadata to localStorage
       ├─ persist local image blobs to IndexedDB
       └─ import/export data, packages, PNG, and PPTX
```

The script order in `index.html` is a hard runtime contract. `catalog-data.js` must execute before `app.js`, and the PowerPoint bundle must be available before PPTX export is used.

### 3.1 Startup path

1. `app.js` reads `window.PORTFOLIO_CATALOG` and derives category definitions and spec-set maps.
2. `loadPortfolio()` tries the current `localStorage` v4 key.
3. If needed, it attempts migration from v3 and then the legacy v1 single-board key.
4. With no saved state, `createDefaultPortfolio()` builds one empty board per catalog category.
5. `ensurePortfolioSchema()` normalizes the portfolio, adds missing known categories/assets, filters unknown categories, and normalizes every board/product.
6. The active category is selected and the Product view renders first.

### 3.2 UI and rendering

The application provides three synchronized views:

- **Product cards** — a canvas-rendered, lane-based product board with search, sort, SKU/variant previews, zoom, and protected reordering.
- **Roadmap** — a canvas-rendered, time-scaled roadmap with family groups, timeline configuration, search, panning, and protected slot editing.
- **Split view** — DOM-rendered selected-product details beside a roadmap canvas.

Most behavior lives in `app.js`, including layout calculations, hit regions, modal/popover state, image loading, data normalization, and export rendering. State is held in module-level variables rather than isolated controllers or stores.

## 4. Data model and persistence

### 4.1 Portfolio schema

The current root schema is version 4:

```text
portfolio
  version: 4
  activeCategoryId
  settings.showRoadmapMsrp
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
- **Import data** accepts `.data`, `.json`, and a narrowly recognized `catalog-data.js` assignment.
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
- **PPTX** uses the vendored PptxGenJS 4.0.0 bundle and can export Product slides, Roadmap slides, or both for every category.
- PPTX rendering temporarily activates each category, preloads referenced images, renders off-screen canvases, and then restores the prior UI state.

## 6. Design system intent

The interface uses a charcoal-first system. Product/SKU colors remain separate business data and must not be rewritten merely to match the application chrome.

### 6.1 Core application colors

| Token | Hex | Intended use |
| --- | --- | --- |
| True Black | `#020306` | Deepest page/canvas ground and dark foreground on light accents |
| Ink Black | `#071018` | Primary page/shell background |
| Carbon | `#1D2025` | Cards, menus, and raised surfaces |
| Jet Black | `#182A31` | Cool dark supporting surface |
| Gunmetal | `#373A3F` | Borders and subdued controls, not tiny text on Carbon |
| Grey Olive | `#9B9B9A` | Secondary text |
| Silver | `#BEC5C2` | Supporting text and lines |
| White Smoke | `#EFEFED` | Primary text |
| Amaranth | `#E0335A` | Sparse primary emphasis, selected markers, and embargo/attention states |

Supporting charcoal steps (`#090909`, `#111111`, `#232323`, `#2C2C2C`, `#353535`) build hierarchy. Japanese Indigo (`#285C70`), Steel Teal (`#60899B`), Foggy (`#B1AF9A`), Mid Grey (`#989898`), and Star Dust (`#E2DDDA`) provide controlled secondary/planning emphasis.

Palette rules:

- Keep most page area neutral charcoal/black.
- Reserve Amaranth for one strong call to action or high-attention state at a time.
- Use indigo/teal for secondary selection, development, and roadmap information.
- Use a dark foreground on filled Amaranth or Steel Teal controls; White Smoke is not sufficiently strong for normal-size text on those fills.
- Target WCAG AA contrast for text and keyboard focus.
- Preserve `STANDARD_PRODUCT_COLORS`; those values describe merchandise variants, not UI theme colors.

## 7. Risk register

Priority expresses potential impact, not confirmed exploitability.

| Priority | Risk | Evidence and effect | Recommended control |
| --- | --- | --- | --- |
| P0 | Deployment completeness can regress | At the archive baseline, the Pages workflow copied `index.html`, `styles.css`, `app.js`, and `assets/`, while `index.html` also required `catalog-data.js` and `vendor/pptxgen.bundle.js`. The current workflow now includes both missing paths and runs the validator. | Keep the workflow/HTML closure check mandatory so a later runtime reference cannot be omitted from deployment. |
| P0 | Package import is not transactional | `importProjectPackage()` normalizes the manifest, then clears IndexedDB before importing all local blobs and assigning the new portfolio. A mid-import storage failure can destroy the previous local-image library. | Stage/validate every entry first; commit state in one versioned transaction or retain a rollback snapshot. Require a backup before import until fixed. |
| P1 | Private portfolio disclosure | The package contains 85 real working product records and image references. | Keep `project-data/private/` ignored and out of Pages artifacts. Publish only a reviewed, sanitized dataset with explicit approval. |
| P1 | Persistence failure is silent | `scheduleSave()` catches and suppresses `localStorage` errors. Quota or browser-policy failures can leave the user believing changes were saved. | Surface save state and errors, add quota handling, and provide an explicit backup reminder. |
| P1 | Imported content is a trust boundary | Data/package fields feed DOM, canvas, URLs, colors, IDs, and filenames. Future interpolation changes can introduce stored script/markup injection or invalid rendering. | Centralize escaping and validation; test malicious strings, malformed colors/URLs/IDs, oversized input, and duplicate IDs. |
| P1 | Minimal automated coverage | The baseline had no unit, integration, package round-trip, or browser regression suite. Canvas behavior is particularly difficult to validate by inspection. | Keep the static validator, then add schema tests and Playwright smoke/visual tests for all views and import/export flows. |
| P2 | Monolithic application module | Rendering, state, migrations, storage, editors, and exports share one roughly 5,700-line script with broad mutable state. | Extract schema/storage, package I/O, rendering, and UI controllers behind stable interfaces in small verified steps. |
| P2 | Empty default content can be mistaken for data loss | The source catalog has 0 products, so first load and Restore sample are intentionally empty despite 85 WebP assets being present. | Keep this distinction visible in onboarding and decide explicitly whether a sanitized public seed is desired. |
| P2 | Remote-image dependence | The package has 84 URL image references but only one packaged local binary. Offline, expired, authenticated, or CORS-constrained URLs can fail. | Move approved images into the local asset library or add image health/fallback reporting. |
| P2 | Stored-ZIP compatibility is narrow | The package reader supports ZIP method 0 only. Common deflated ZIPs are rejected. | Document the constraint; if interchange is needed, use the already vendored ZIP capability or add a well-tested decompressor path. |
| P2 | Canvas accessibility and touch behavior require regression testing | Core Product/Roadmap information is visual canvas content with custom hit regions and gestures. | Add equivalent structured text, keyboard focus/announcements, and mobile/touch tests; retain meaningful canvas labels. |
| P3 | Static assets and catalog records are disconnected | 85 WebP files ship with the source, but 0 default product records reference them. | Remove unused/publicly inappropriate assets or connect only reviewed assets to an approved seed dataset. |

## 8. What is already strong

- The application is dependency-free at runtime and can be served as a static site.
- Current and legacy schemas are normalized at explicit boundaries.
- Local binary images are separated from lightweight JSON metadata.
- Full packages preserve local-image binaries without embedding large data URLs in the portfolio JSON.
- The three views share a single normalized portfolio, which supports linked selection and export consistency.
- Category definitions and spec templates are centralized in `catalog-data.js`.
- Product/SKU business colors are intentionally separated from interface design tokens.

## 9. Audit limits

The package was structurally inspected; its business content was not independently validated against an external product system. Browser-specific persistence limits, remote-image availability, complete keyboard/screen-reader behavior, and pixel-level rendering across devices require runtime testing. The authoritative verification process is maintained in the [Continuation Guide](CONTINUATION-GUIDE.md).
