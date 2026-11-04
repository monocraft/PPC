# Live roadmap PowerPoint template design

## Outcome and authorization
Implement the reviewed local editable roadmap export on the live PPC GitHub Pages app. The user approved the reference appearance, viewport-derived period, progress screen, and additional nearby-year timelines, then explicitly requested live implementation with issues fixed before release. Internal browser-only composition is the agent's implementation choice required by the existing static host.

## Behavior
The lifecycle Roadmap-only export uses the reference template: export-day intro, native changelog, one divider per selected category, native timeline shapes/text, and native TBD tables. Main timeline pages use the currently visible CSS-pixel interval, including partial months. Recompute on dialog open and immediately before submission. Products outside that interval are separated before/after it; group no more than two adjacent nearest years (past end-year, future start-year), retaining category/family order. Each group gets a full-year bracket spanning its real dates. Never invent or overwrite saved timing. Every eligible selected identity appears exactly once.

Retain the production catalog visibility rules using PortfolioModel.catalogProducts, rather than exporting deliberately hidden records. With all groups visible, the current fixture contains314 products. Missing/inverted/incomplete saved intervals remain TBD. MSRP follows the current setting.

The reference design retains HP Forma DJR Office/Medium plus its approved Arial Narrow/Arial Black calendar/family typography. Numeric reference metrics allow browser generation without redistributing proprietary font files. Viewing the PowerPoint with exact typography still uses those named fonts.

## Scope routing and UI
Only scope=roadmap with lifecycle basis selects the new reference route. Products, Both, and Hashout retain their existing exporters and dimensions. Explain in the export dialog that the reference template is the Roadmap choice; Both retains its standard combined layout. Default to Roadmap on first opening from lifecycle Roadmap when there is no saved scope; preserve explicit stored scope/category preferences. Existing Use this view remains an explicit scope/category override.

In the template route, dates are read-only and derive from the actual visible roadmap pane. If chosen from Products, show Roadmap before measuring. Force separate category layout for this route; existing legacy layout choices remain available in other routes. Save preferences only after successful export as today. Do not reload or replace active workspaces.

An opaque, accessible progress screen covers the workspace for the new route, yields a paint before work and between slide batches, and reports actual preparation/render/merge/compression phases. Cleanup after success or failure restores the existing dialog interaction/focus flow. No temporary category switching or canvas rerendering is used for native slides.

## Browser architecture
Reuse bundled PptxGenJS and JSZip; no service, backend request, new runtime package or font binary.

1. public/js/pptx-roadmap-model.js is a classic global module PPTXRoadmapModel. It owns constants, raw-date classification/projection, coverage, nearby-year planning, bounded pagination, viewport calculation, reference numeric measurement, and shared text/date helpers. Its project(sections,timeline) accepts normalized snapshots supplied by app.js; planRoadmapContent(data) preserves the reviewed nested nativeLifecycleProduct/dates format. Export G,F,C and rendering helpers for the template renderer.
2. public/js/pptx-roadmap-template.js is PPTXRoadmapTemplate. generate(data,{templateBytes?,metrics?,onProgress?}) returns {blob,fileName,manifest}. buildContent and mergeTemplate provide test seams. Render native content using PptxGenJS pixel/96 geometry and pixel*.75 point sizes; do not pass final template through PPTXEditable.serialize because that changes reference fonts.
3. Browser XML DOM + JSZip replace content trees in a cleaned four-slide template shell. Rebuild slide IDs/relationships/content types; retain native template masters/layouts/branding. Remove obsolete notes/timing/add-in ownership, keep exactly the body layout relationship. Validate exactly-once product coverage and final slide ownership before download.
4. Static asset shell public/assets/pptx/roadmap-template.pptx contains only intro/changelog/divider/empty-body structure, used layouts1/2/25, required masters/themes/media, and sanitized metadata. It contains no original product timeline bodies, hidden photos, notes, custom XML, Office Timeline tags, workspace data or font files. Reference hidden flags are authoritative; prior Artifact Tool rendering incorrectly painted hidden hero pictures. Explicit white changelog text is the already reviewed correction. Historical source changelog cells and the source cover date are blanked; generation fills the current export update without publishing private source history.
5. public/assets/pptx/arial-narrow-metrics.json contains numeric advance/pair facts only. Asset URLs inherit the loading script version query. Failed fetches clear pending cache to permit retry. Template and metrics use checked-in expected identities/allowlists to prevent stale/incorrect asset composition.

### Normalized interfaces
App snapshots sections as `{id,name,categoryLabel,products:[{id,name,family,startMonth,endMonth,fill,textColor,statusLabel,priceLabel,dates:{ffsDate,generalAvailabilityDate,endManufacturingDate}}]}`. Dates are raw source values plus optional precision labels; no schema defaults are called. `PPTXRoadmapModel.project(sections,timeline)` clones these into the reviewed `{categories,selectedTimeline}` representation, with each product's `nativeLifecycleProduct`, normalized source-period metadata and derived `lifecycleCoverage`. `planRoadmapContent(data)` returns slides, coverage, timeline and dimensions. The template renderer consumes that same representation and emits per-slide timeline/periodGroup/productRows metadata. Test-only direct callers may supply the already projected private fixture in this format; no private fixture is committed.

The model exposes `G,F,C,MONTHS,SHORT_MONTHS,measureConservative,wrapWords,wrapFamilyForDisplay,categoryStripHeight,exactName,productStatus,sourcePeriod,timelineLabel` and `createReferenceTextMeasurer(metrics)` so the renderer reuses the approved calculations. `visibleRoadmapPeriod({startMonth,endMonth,scrollLeft,clientWidth,monthWidth,railWidth})` returns the inclusive CSS-pixel-visible month pair or null. Renderer `generate(data,options)` loads only its static same-origin assets; `buildContent(data,metrics,onProgress)` returns native content bytes and manifest, and `mergeTemplate(templateBytes,contentBytes,manifest,{exportDate})` returns the assembled bytes and final manifest.

## Forced input and failure decisions
Bound pagination before loops: reject any single family/product row that cannot fit21 units, with an actionable error. Bound category label strips to the body/footer frame. Coarsen very long date axes as in the reviewed fallback; never shorten real product intervals. Preserve unsupported or missing source dates as TBD. Unsupported labels must fail cleanly rather than hang or silently truncate. Load, XML, compression or download construction failures restore controls and preserve source state.

## Verified assumptions
| Fact | Evidence |
|---|---|
| Live app is static Pages with explicit JS closure and recursive assets | clean main .github/workflows/deploy.yml prepare-site block |
| Current release base is cd6c986; original Downloads checkout is250 commits behind with unrelated edits | fetched origin/main and clean managed worktree on codex/roadmap-powerpoint-template |
| Existing browser libraries emit native editable shapes/tables and exact reference size | real PptxGenJS ZIP probe:24384000x13716000 EMUs,24px->18pt,a:tbl,no p:pic |
| Standard exporters share aspect ratio but different physical dimensions | clean planner probes12/48/120 months; default12192000x6858000 EMUs |
| Shared serialize rewrites fonts, so it cannot touch the final reference package | public/js/pptx-editable.js serialize font policy |
| Current main restores saved export preferences and uses catalogProducts | app.js restorePptxExportPreferences/buildPptxExportPlan |
| Saved current-view dateRange is configured range rather than visible pixel clip | app.js/useCurrentViewForPptx and workflow capture-view source |
| Prototype raw-date model/pagination preserves every fixture identity | private native70-slide proof:314 identities,103 outside,31 native outside pages, no pictures/tables on outside pages |
| Numeric reference metrics reproduce measured text without font binaries | eight regular/bold/size probes including punctuation and Latin characters, max error<.005px |
| Reference shell can shrink to1.7MB and retain native structure | private sanitized four-slide import/render probe;32 package parts,5 media,2 masters,layouts1/2/25 |
| Hidden source photos must not be published | source slide2 group name characters hidden=1 plus3 hidden pictures; renderer ignored these flags |
| Oversized family can hang old pagination | source loop flushes empty page before the later unreachable oversized-row error; explicit guard required |

## Verification and release gate
Before live merge: new model/viewport/pagination/missing-date/filter tests; reference metric probes; exact asset part/media/typeface privacy allowlist; browser package relationship/native-object assertions; representative cover/changelog/divider/main/past/future/TBD render comparison; real browser export with current49-product selection and full314 fixture; no stale dates, data mutation or progress cleanup failures. Preserve existing products/Hashout checks.

Run the complete configured production check chain with required isolated PGlite, generated Supabase source parity and hosted-package closure; no live backend calls. Build/check the deterministic local graph after source changes. Independent design/plan and implementation review findings must be resolved. Publish only an explicit task file allowlist through normal PR/main/Pages. Verify exact merged SHA deployment and bounded static asset hashes. Preserve active user editing tabs and all original dirty/untracked files.

## Out of scope
Product-card redesign, combined-deck template migration, Hashout redesign, database/accepted-data changes, publisher dispatch, Supabase access, monitoring, original bin publication, font distribution, and unrelated workspace cleanup.
