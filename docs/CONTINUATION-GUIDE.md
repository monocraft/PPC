# Continuation Guide

This is the operating guide for future changes. It keeps code provenance, private working data, browser persistence, and design intent separate so a new update does not accidentally revive stale code or publish private content.

## 1. Sources of truth

Use this order when deciding what is authoritative:

| Concern | Source of truth |
| --- | --- |
| Current application code | This workspace, originally synchronized from the hash-pinned `PPC-main.zip` baseline |
| Category/lane/spec templates | `catalog-data.js` |
| Current private portfolio content | `project-data/private/product-portfolio-project.pkg` |
| Current browser session | `localStorage` plus IndexedDB for the exact origin being tested |
| UI palette | CSS/JavaScript tokens derived from the supplied charcoal/core palette references |
| Deployment contents | `.github/workflows/deploy.yml`, checked against `index.html` runtime references |

Do not copy an older local folder over this workspace. A future GitHub ZIP or clone should be staged separately, inventoried, and diffed before any merge.

## 2. Establish a safe baseline

Before feature work:

1. Run validation and record the result.
2. Confirm `.gitignore` excludes `pwsh.log` and `project-data/private/`.
3. Confirm the private package hash:

   ```powershell
   Get-FileHash -Algorithm SHA256 project-data\private\product-portfolio-project.pkg
   ```

   Expected: `3FB436E56FAE28CC7FE125030841690039084679C15619CDDC763DA6D2D5B3A4`.

4. If the workspace will be maintained in Git, initialize or connect it only after the ignore rules are in place. Commit one known-good baseline before refactoring.
5. Export the active browser workspace as a `.pkg` before any schema migration or destructive import.

Never add the private package with `git add -f`, copy it into `assets/`, or add `project-data/private/` to the Pages workflow.

## 3. Run and validate

No package installation is required.

```powershell
node scripts/validate-project.mjs
node scripts/serve.mjs
```

The equivalent `npm run validate` and `npm run serve` shortcuts are available when `npm` is installed and on `PATH`; they do not install dependencies.

For a quick syntax-only check:

```powershell
node --check app.js
node --check catalog-data.js
```

Keep the same local URL and port during a test cycle. Browser storage is origin-scoped; switching from `127.0.0.1` to `localhost` or changing ports creates a separate workspace.

## 4. Import the private working package

1. Start the local server and open the printed URL.
2. If the browser already has valuable work, choose **Data → Export project package** first.
3. Choose **Data → Import project package**.
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
- Add fixture tests for v4, v3, legacy v1, empty catalog, malformed input, and missing optional fields.
- Never silently drop unknown fields during a migration unless the removal is documented.
- Keep image metadata and IndexedDB binaries consistent; test missing and orphaned assets.
- Surface storage quota and save failures to the user.

### 6.2 Package I/O

- Treat every imported filename and JSON field as untrusted.
- Validate entry count, path shape, byte size, supported ZIP method, JSON version, IDs, URLs, colors, and image MIME types before mutation.
- Prevent duplicate paths and traversal.
- Stage package content before clearing existing data.
- Add an export→import→export round-trip test with byte-independent semantic comparison.
- Keep URL images as references only when that is an explicit privacy/offline decision.

### 6.3 UI and palette

- Use the shared CSS and `UI_PALETTE` tokens; do not add isolated UI hex values.
- Keep the shell predominantly charcoal/black.
- Use Amaranth sparingly for primary emphasis and high-attention markers.
- Use Japanese Indigo/Steel Teal for secondary/planning emphasis.
- Choose text color dynamically for user-defined fills and preserve at least WCAG AA contrast.
- Do not theme `STANDARD_PRODUCT_COLORS`; those are SKU/product attributes.
- Check focus, hover, disabled, selected, empty, overflow, and error states in all three views.

### 6.4 Rendering and exports

- A visual change must be checked in the Product canvas, Roadmap canvas, Split view, PNG, and PPTX.
- Verify the smallest and largest category/product groups.
- Test long names, long SKU lists, large prices, missing images, plus-variant overflow, and single-lane full specifications.
- Keep export rendering independent from current scroll position and restore prior UI state after export.

### 6.5 Deployment

The Pages artifact must include at minimum:

```text
index.html
styles.css
app.js
catalog-data.js
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
| Product view | Empty state and controls remain usable | Cards, lanes, search, sort, zoom, SKU/variant previews, info drawer, add/edit/reorder |
| Roadmap | Empty state, year range, zoom/pan | Families, bars, selected state, search, dates, slot editing, predecessor/successor links |
| Split view | Graceful no-selection state | Selected details and roadmap remain synchronized |
| Persistence | Create one test product, reload, confirm it remains | Modify a product and local image, reload on the same origin |
| Lightweight data | Export and re-import `.data`; understand that local binaries are excluded | References and metadata survive; local binary behavior is explicit |
| Full package | Export then import into a clean origin | Product counts and local image survive round trip |
| PNG | Product and Roadmap images download and are not clipped | Dense categories and long roadmaps export at useful resolution |
| PPTX | File opens and slide count/scope is correct | Every category renders; images/text are legible and state is restored |
| Accessibility | Keyboard reaches menus/tabs/dialogs; visible focus; Escape closes overlays | Selected/product details are understandable without pointer-only discovery |
| Responsive/touch | Narrow viewport has no inaccessible controls | Roadmap/product navigation works without unintended page scrolling |
| Deployment | Pages artifact loads without 404s | Package remains absent from the deployed artifact |

Test browser console and network failures, not only appearance.

## 8. Prioritized improvement roadmap

### Phase 0 — Protect the baseline

- Keep private data and logs ignored.
- Establish the first clean Git commit or connect the correct remote.
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
- Known failures, console errors, and remote-image limitations
- Screenshots or exported artifacts for visual changes
- The next smallest safe change

A continuation note should distinguish **implemented**, **verified**, **known risk**, and **proposed** work. That prevents an audit recommendation from being mistaken for completed behavior.
