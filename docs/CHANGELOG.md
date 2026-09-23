# Change Log

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
