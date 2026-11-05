# Live roadmap PowerPoint implementation plan

Source spec: docs/specs/2026-11-04-roadmap-template-live-design.md (verified against cd6c986 before implementation). User authorized implementation and deployment after validation; the browser architecture is an internal implementation choice, not a change to approved output.

## Inherited from spec
Browser-only native export, static sanitized shell, exact reference geometry/fonts, visible-period main slides, nearby-year context groups, honest TBD, source immutability, current catalog visibility, and preserved products/Both/Hashout paths.

## Tasks and ownership
1. Establish clean main baseline in the managed worktree; run exact170 check commands with PPC_REQUIRE_SQL_TESTS=1 and authorized absolute PGlite path. Resolve missing local dependencies without changing package pins.
2. Template/metrics assets: derive deterministic sanitized shell from the owner-private reference, trim hidden photos and obsolete source content, and prove native shell import + allowed parts. Generate numeric narrow-font metrics from installed fonts only. Add deterministic generators and asset privacy checks; no original binary/data in Git.
3. Pure model: port planning/data helpers to public/js/pptx-roadmap-model.js with project(sections,timeline), planRoadmapContent(data), G/F/C, viewport helper, reference measurer and shared rendering helpers. Tests first for grouping/coverage/TBD/filter inputs, viewport boundaries, giant labels and no mutation. Match prototype fixture behavior. Explicitly replace sourcePeriod's unsupported raw-string fallback with TBD; retain valid exact-date and supplied precision labels, preserve original raw metadata unchanged, and test invalid calendar dates across every source-date field accepted by that helper.
4. Browser renderer: implement public/js/pptx-roadmap-template.js using current vendor primitives and browser DOM/JSZip assembly. Test native geometry/tables, valid OOXML ownership, exact source date bars and all escaped text; add reference-font policy and static asset identity checks.
5. Root app integration: narrow lifecycle Roadmap dispatch ahead of the legacy font gate; normalized raw visible snapshots from current app family/status/price/precision helpers; fresh visible dates open/submit; route-specific controls/hints/default; opaque progress surface and guaranteed cleanup. Keep saved preferences and existing exporters. Wire scripts/styles and deployment required-file closure.
6. Integration verification: offline loopback fixture with network blocked and actual saved snapshot kept only in ignored bin; actual browser 49-product current selection and all314; mandatory package/layout/native-table/first-party import checks and visual comparisons. Add checks to package.json using existing node scripts/checks conventions.
7. Independent implementation review and complete release checks, then deterministic Graphify build/check. Inspect explicit staged allowlist and diff, commit, push task branch, create/merge normal PR after checks, await Pages success and verify exact deployed changed assets. Update app-manager knowledge with verified source/release facts.

## Verified plan-level assumptions
- Exact current app symbols exist at app.js:7749(buildPptxExportPlan),7869(syncPptxExportSummary),7933(openPptxExportDialog),7969(exportPptx),8945(submit wiring). Re-read anchors when integrating; don't copy dirty original app.
- index.html already loads PptxGenJS, JSZip, model and editable modules before app. New modules must load after existing dependencies and before app.
- package.json scripts.check is an explicit170-node-command chain; its exact baseline is running via Node child_process because npm isn't on PATH.
- deployment explicitly copies JS at workflow lines114/117 and asserts required paths; assets copy recursively. Add both new modules and CSS/asset guards while preserving service-mode package absence and unrelated released features.
- PGlite0.5.9 exists at original node_modules; tests are isolated fixtures, not live backend tests. New dependencies are unnecessary for production.
- Native template body uses rId266->layout25->master2; preserved shell cover/changelog/divider use layouts1/1/2. Rebuild new slide relationships instead of carrying original shape owners.
- No new code may import bin, Node/Python or a local service. Private source/proof paths are only generator/test inputs on this machine, never runtime URLs or committed fixtures.
- Task2/3 can be independent after interface agreement; task4 consumes their static assets/model; task5 consumes the two browser globals. Root owns shared index/app/CSS/package/workflow files to prevent concurrent edits.
