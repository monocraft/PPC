# Biweekly PLC import module

The PPC application keeps **Open PLC updates** and **Import HyperX PLC report** in **Settings → Data & export**, alongside the last import time and aging. The default flow is **drop one Excel file → automatic collection → result and date ages**. An external `.xlsx` can be dropped directly onto PPC, or into the module's drop area. Clear matches and reliable milestones save automatically. Uncertain records remain in **Needs review** and do not block eligible fields in the rest of the workbook.

When PPC is already connected to shared saving with editing access, collection automatically submits only the importer's milestone and evidence changes. Unrelated product edits remain local drafts. Without that connection, collection is saved on the device and the sharing status explains what remains to be shared. A sharing retry submits retained updates without parsing the workbook again or resetting timestamps.

## Operator workflow

1. Use the current portfolio/master already open in PPC. Matching uses those product IDs, SKUs, codenames, names and prior confirmed mappings.
2. Open **Settings → Data & export → Open PLC updates**, then drop one biweekly `.xlsx` into **Import & results**. Dropping the workbook directly onto PPC also opens the importer. No column mapping, report-date entry or routine Apply action is required.
3. PPC reads, matches and validates the workbook, then saves eligible dates, independent field timestamps, project evidence and exceptions together. Collection freshness uses the import date. Explicit source reporting periods remain separate and govern date ordering; a file without a source period falls back to import day.
4. Read the receipt: FFS dates updated or unchanged, FFS evidence needing review or a product match, other dates updated, and local/shared saving status. Use **Products & FFS** to search by product or codename, filter by category and FFS status, and browse pages of 15 products. Select one product for its complete date clocks and source evidence. Four fixed tabs stay accessible while content scrolls; reviews and history use the same bounded navigation.
5. Open **Needs review** for uncertain matches or dates. Search names and codenames; a compact picker shows at most eight suggested product cards with their category and matching reason. Source date suggestions show the current and proposed values, country, source cell, precision, and reason. Select clear suggestions across pages and **Confirm selected updates** together. Distinct regional dates require a deliberate choice; newer protected master values have no one-click source override. A verified date remains available for exceptions. Unselected dates remain queued, while an explicit Keep PPC choice removes that exception. Newer reports supersede older pending evidence by source identity and period; older reports cannot replace a newer queued item.
6. A selected product mapping is remembered for subsequent files. A single explicit exact date in the primary Current FFS column can update a unique product match, with its region retained. Changing an established region, several different regional dates, cross-product merges and meaningful source conflicts retain explicit review. Target FFS remains separate.
7. Automatic sharing uses the existing authenticated master connection and concurrency protections. A network, access or conflict problem leaves the local collection intact. **Retry saving to master** retries only sharing. Conflicts remain available through existing master review.
8. For an unmatched codename project, choose **Create a new product**, confirm its name, codename and existing portfolio category, and select the draft for the batch. The codename can serve as the temporary product name. Creation uses a stable ID, remembers the PLC identity, and leaves unsupplied milestones blank; selected date suggestions can be confirmed with the creation. Existing codenames, duplicate source records, invalid placement and cancelled projects cannot create duplicates. Subsequent files reuse the confirmed product even after its marketing name changes.
9. Export the collection log and milestone history from **Update history** for a long-term archive. Exporting a portfolio package also retains local exceptions and deferred sharing. The original Excel is unchanged. Unknown products require an explicit reviewed creation choice.

The first report may have more exceptions when the current master lacks codenames or exact SKU/name coverage. Confirming those identities makes later biweekly drops easier. User decisions refine identity and supported source scope; they do not teach the parser to invent missing years or date precision.

Review rows open a dedicated full-width editor from the row surface or its **Edit** action. **Back to review list** restores the list's search, filters, page and scroll position; **Previous project** and **Next project** move between projects in the filtered list. Edits retain their scroll position and staged date choices. Selecting a source or typing a date does not save until **Confirm selected updates**.

In a review editor, **Enter a verified date** offers **Exact day** or **Calendar quarter**. Quarter selection uses Q1–Q4 and a four-digit year from 1900 to 9999, previews the quarter label and qualified placement anchor, then adds the value and precision together with **Select verified quarter**. Switching to an exact day requires an explicitly verified day and clears the quarter precision only when confirmed. Older saved review entries containing one supported raw quarter recover that quarter for display without rewriting their source evidence or refreshing their aging; source conflicts, formula/error cells, cancelled projects and stale observations retain their existing protections.

## Collection coverage

The supplied workbook produces 48 primary source records, including two cancelled records. The module reads target and current FFS separately, stage, notes, forecast, cancellation, visible/raw auxiliary cell values, merge origins, and 43 DrawingML health indicators. Green/yellow indicators retain their source labels and colors without inventing business severity definitions.

Supporting adapters collect stage-gate schedules and owners from New Project in PLC; GA and lifecycle exits from GA-PLC Exit; development schedules and ODM/cost notes from Project Development Timeline; pre-POR planning from Est.milestone; regional FFS from RSB & Tariff; Choice Points; launch-quarter/FFS evidence from BSP LQ; and SKU, packaging, compliance and shipment notes from Quebec, Chile phase-in. The supplied file has 540 extracted supporting observations. Only unambiguous source identities attach supporting evidence to a primary row.

Other tabs are inventoried as reference, historical or matrix material. Their images, process diagrams, horizontal NPI panels and staffing models are not interpreted as current product dates. Their coverage is visible in the sheet inventory. Adding another automatic update field requires a source adapter and an explicit semantic mapping; a similarly named date is insufficient.

Explicit GA in an undated supporting sheet is shown for review. It cannot automatically replace the current master GA. FFS never becomes GA, shipment never becomes GA, and target FFS never silently fills a blank current FFS. The original Excel is unchanged.

## Product and date rules

Matching proceeds through a reviewed source identity, a unique PPC product ID or exact SKU, a unique codename, and a unique full normalized marketing name. Category and explicit wired/wireless or Xbox/PlayStation contradictions block automatic assignment. Generation numbers, Pro/S, color and size distinctions remain meaningful. Similarity only supplies review candidates. The source's resetting No column is not a durable identifier. Several source rows mapping to one product are shown as a collision; conflicting selected dates cannot win by row order.

Date interpretation keeps raw text, precision and source scope. Exact ISO, month/day/year and fully specified named dates can be normalized. Excel's 1900 and 1904 systems are supported, including rejection of the fictitious 1900-02-29 serial. Only date-formatted numeric cells are interpreted as dates. Native dates displayed as `mmm-yy` retain month precision. Missing years are not inferred. An explicit Current FFS revision retains the old and revised text; only a fully specified unambiguous final date can become an update. Date spans, competing regional dates, formula caches, source contradictions and vertical dates merged across products require review. Blank/NA/TBD never clears a saved date.

Unqualified quarters use the calendar basis confirmed by the portfolio owner. `Q2 2028` and `Q2/'28` retain quarter precision, the display label, and the complete April–June interval. Their scalar date is `2028-04-01`, used only as the compatible roadmap placement anchor. Explicit FY/fiscal quarters, missing years, competing quarters and question-mark uncertainty remain in review; fiscal periods are never silently converted to calendar quarters. One bounded source statement such as `PM adjusted FFS to Q2/'28` is supported. A quarter cannot silently downgrade an existing exact day. All six milestone editors offer Exact date or Calendar quarter; selecting Exact date for a saved quarter requires entry of a verified day. FFS remains independent of GA. An explicit GA quarter places the GA roadmap at its first month; an FFS quarter does not move the GA bar.

| Calendar quarter | Display example | Placement anchor | Retained interval |
| --- | --- | --- | --- |
| Q1 | Q1 2028 | 2028-01-01 | January–March |
| Q2 | Q2 2028 | 2028-04-01 | April–June |
| Q3 | Q3 2028 | 2028-07-01 | July–September |
| Q4 | Q4 2028 | 2028-10-01 | October–December |

Validated quarter metadata is stored with each field's existing bounded evidence, and displayed only when it still matches the current date anchor and has not been superseded. A change from quarter to exact precision updates the milestone change clock even if its anchor is the same day. Repeated identical quarter confirmations preserve the change clock. Package export and shared saving retain the interval, raw source, precision and timestamps.

The primary Current FFS column is the current snapshot authority. Supporting ISO-week status headers represent intervals, not an exact newer Sunday. A week overlapping the primary snapshot cannot outrank that explicitly dated snapshot. A supporting period wholly after it can raise a conflict when the product and manufacturing scope agree. Dates for another country remain supporting evidence. Older primary sections retain their own period, and the importer does not substitute target dates for missing current dates.

Per-field source dates govern update ordering. Older observations cannot replace newer accepted field evidence. A different value for the same reporting day requires review. An intervening PPC edit or a newer accepted master edit requires review. Applying a preview whose product dates or evidence have changed rejects the import. GA/EM order is checked before the draft is committed. Cancelled projects cannot update their PPC dates through a reviewed resolution.

The file SHA-256 identifies content independently of filename. Reapplying the same source preserves its original collection date, observation clocks, change clocks and unchanged review queue. A newer file confirming the same value advances the observation clock and preserves its change clock. Each retained field and change event includes its own filename, fingerprint, raw value and cell provenance, so later imports do not relabel older evidence. A manually superseded source stays prior-value evidence even if a user changes the date away and back.

## Freshness and storage

| Display | Meaning |
| --- | --- |
| Last workbook imported / days since import | Actual collection time. Reviewing an exception later does not move this clock. |
| Updated / change aging days, per field | When that field's value actually changed in PPC, including a manual edit. A later confirmation preserves it. |
| Last confirmed / confirmation aging days, per field | When the current value was last recorded from reliable evidence. A new unchanged report advances this time. Blanks, rejected and stale fields do not advance it. |
| Saved to master / accepted aging days, per field | Existing master history records when the team accepted the date change. This is independent of local collection/change time. |
| Source report / source aging days, per field | Explicit reporting period of the retained evidence. Older sections retain their own period; ISO-week proxies are labeled approximate. |
| Next biweekly update | Import date plus the 14-day cadence. Product source freshness remains separate: current below 14 days, due at 14, overdue after 14. |

All six populated PPC dates are covered: **FFS, general availability, end of manufacturing, global announcement, web readiness and final assets**. Products & FFS includes dates that did not originate in PLC. Their labels also expose timestamp/age popups in the editor, product details and roadmap. Timestamps are stored as UTC instants and displayed in the user's local timezone, including seconds; ages count local calendar-day boundaries. Scalar date values remain valid calendar days, with explicit period metadata when the source supplies only a quarter. A historical populated date without a recorded change time shows **timestamp unknown**; opening or importing it never invents its original edit time.

The product's `plc` object is an atomic shared evidence fact; the six PPC dates remain independent shared date facts. Automatic PLC sharing builds that fact from the accepted evidence and only this import's changed milestone evidence. Unrelated manual exact-day or quarter-precision metadata remains local, including same-anchor precision drafts. A later explicit manual save can accept it. Legacy pending imports retain their original evidence when joined by a newer import. Existing accepted-date history records the accepted shared scalar change time. Root `dateLocalEdits` retains genuine local date mutations, while shared source metadata retains imported field clocks. Roots `plcImports`, `plcCollection`, `plcReview`, `plcSharePending` and `plcLastSharing` belong to local/package storage; product evidence and milestone-change history are shared with teammates. Review queues are workspace/package history, so exporting the package is necessary to move unresolved unmatched records to another device.

`plcCollection` retains the latest typed primary snapshot and all extracted supporting records, including projects that have no PPC match yet. This prevents dropping useful source information while identities are unresolved. It includes source metadata and the sheet inventory; duplicate imports and subsequent review do not rewrite it, and an older source cannot replace a newer snapshot. Matched product evidence and historical accepted date events remain separate. JSON history exports include this collection and the pending review queue. Retention of every raw workbook and a complete series of supporting-table snapshots requires an external archive; the current module retains only the latest complete extracted snapshot.

## Processing and recovery contract

| Step | Contract |
| --- | --- |
| Read | Sparse XLSX extraction, required-header discovery, source inventory and content fingerprint. Source prose and workbook instructions are evidence only. |
| Normalize | Preserve raw values, date precision, regions, formula/cache flags, merge origins and reporting periods. |
| Match | Use stable exact identities first; hold ambiguous generations, variants and portfolio/platform contradictions. |
| Decide | Recompute against the currently loaded product values and evidence. Apply independent eligible fields; persist typed exceptions with original provenance. |
| Commit | Validate the proposed master fact model and save the full local draft before activation. Quota/validation failure leaves the prior workspace intact. |
| Share | Submit only changed importer date fields and `plc`, plus explicitly reviewed new PLC product creations, using expected-current values and existing revision, conflict and idempotent-receipt protections. Changed creation drafts require fresh review before sharing. |
| Recover | Keep deferred sharing and unresolved exceptions. Rebuild reviews against current data; retry sharing separately from collection. |
| Audit | Show the collection receipt and independent clocks, then provide expanded source evidence, sheet inventory, changes and JSON/CSV exports. |

Automatic processing rejects unreadable/unsupported workbooks as a whole. Field uncertainty instead yields a review item. Explicitly reviewed contradictory GA/EM dates still fail atomically; a pre-existing unrelated lifecycle inconsistency does not block collecting eligible FFS data. Conflicting or stale master values require review, and actual sharing is labeled only when the shared service accepts it.

Storage limits are 40 MiB input, 128 MiB expanded ZIP data, 128 sheets, 100,000 rows per sheet, 250,000 cells per sheet and 32,768 characters per cell. Per-product shared PLC evidence is bounded to 180,000 characters, 200 identities and 100 date-change events. The local import log retains at most 52 runs and approximately 1.5 million JSON characters, pruning oldest runs first. The latest complete typed source snapshot is bounded to 3 million JSON characters. The saved review queue holds at most 2,000 records and 1.5 million JSON characters; it fails instead of silently dropping unresolved exceptions. The complete portfolio manifest remains limited to 4 MiB and browser storage quota. Larger team batches remain subject to existing service request limits; a rejected shared batch remains locally retained for review. Export history before it is pruned.

The XLSX reader treats formulas, macros, links, drawings and prose as inert evidence. It rejects macro workbooks and unsafe XML, uses the existing ZIP bounds/CRC checks, skips embedded media, and never executes workbook content. Exported CSV protects text beginning with spreadsheet formula characters.

## Files and validation

- `public/js/plc-import.js`: sparse workbook parsing, typed evidence, product matching, import/review planning, persistent exceptions, atomic application and independent date clocks.
- `public/js/date-precision.js`: validated calendar-quarter intervals, display labels and current-evidence checks.
- `public/js/plc-import-ui.js` and `public/css/plc-import.css`: direct drop flow, collection receipt, optional review, date dashboard, accessible controls and exports.
- `public/js/app.js`: local commit, manual date timestamp capture, deferred sharing and field-age adapters.
- `public/js/master-client.js` and `public/js/master-ui.js`: authenticated scoped sharing without publishing unrelated drafts.
- `public/js/date-history.js` and `public/css/date-history.css`: exact local timestamps, independent calendar ages and source/master/draft provenance popups.
- `public/js/master-model.js`: bounded atomic PLC evidence in the shared fact contract; canonical model also generated into the Supabase function.
- `scripts/checks/plc-import.mjs`, `plc-import-ui.mjs`, `plc-workspace.mjs`, `plc-quarter.mjs` and `date-precision.mjs`: synthetic archives, identity/precision ambiguity, source ordering, duplicate imports, saved review queues, reviewed codename creation, scoped automatic saving, concurrent edits, quota isolation, date clocks, lifecycle consistency, encrypted packages and shared round trips. Existing master and date-history tests cover additional transport and UI behavior.

Actual-workbook browser QA uses an isolated local origin and an older 85-product private baseline; shared transport tests use synthetic in-memory services. The supplied workbook parsed 48 primary records, 540 supporting records and 43 graphical health indicators in approximately 3.5 seconds in that test. The persisted workspace, including all supporting records, was approximately 2.39 MB. The old fixture produced 13 matched source rows across 10 products and 45 pending review records; its initial automatic pass held all uncertain dates. A separate verified FFS decision preserved GA. Tests also confirmed six independent manual date timestamps, unchanged duplicate clocks, reload persistence, keyboard controls and a 390 px mobile viewport without overflow or JavaScript errors.

The subsequent FFS authority repair was reproduced against that same private baseline. It accepted three unambiguous primary Current FFS values with independent source/change/confirmation clocks, preserved GA, and left genuine date or matching exceptions queued. Re-dropping the same bytes two weeks later preserved the complete portfolio and clocks. This baseline result does not predict counts in the current production master. The follow-up UI was verified with 240 synthetic products and 40 review records, including searchable matching, explicit codename creation, cross-product date confirmation, quarter labels and mobile controls within a 390 px viewport. The full release gate comprises 52 checks, including generated Supabase model parity and required encrypted hosted-package validation.

The encrypted hosted master was not unlocked during the implementation checks. Production matching counts depend on the current master when the user loads it. The Supabase service update was deployed and verified on October 9, 2026. Hosted frontend availability is confirmed by the corresponding successful Pages deployment and live resource checks.

## Production rollout

The deployed site currently uses the Supabase shared-master service. A Pages deployment updates browser files only. The new `plc` shared evidence field requires the updated `ppc-master` Edge model; an older service rejects that field and leaves automatic sharing pending on the device.

1. Keep the detailed workbook audit and source-derived QA artifacts in ignored local storage. This repository is public; exclusion from the Pages artifact does not exclude a committed file from GitHub.
2. Reconcile with the latest `main`, preserving the newest encrypted master published by the shared service. Use a normal reviewed merge; do not replace the live master with a local fixture.
3. Run the full checks and `node scripts/build-supabase-master.mjs --check`. Pages now requires both plus the encrypted hosted-package check before deployment.
4. Deploy the updated `ppc-master` Edge Function according to [Shared master setup](SUPABASE-SETUP.md). Existing data, unlock keys and database tables remain compatible; this update does not require reseeding or replacing the shared database.
5. Verify the updated service's shared-field contract, then release the browser changes through Pages. Verify page resources and collection, followed by one controlled authenticated shared-save check.

The production-readiness audit found and fixed a first-import edge case: a recently edited local date now stays in review when the source period is older or the same day. The checks cover that case along with private-source exclusion, unchanged master-package preservation and deferred sharing.

On October 9, 2026, the production `ppc-master` function was updated through the signed-in Supabase dashboard. Only `shared/master-model.js` changed. After reloading the dashboard, the deployed source SHA-256 matched the tested generated model: `ed5b6a2b383a0c9557cda73e0af643e85e560fedcacf8a8512cf3ee5ea1b2158`. The live endpoint returned HTTP 204 for the PPC site's CORS preflight and HTTP 401 / `INVALID_KEY` for a request without the package key. Existing authentication settings were preserved. No database migration, master-data update, reseed, or secret change was needed. The previous model and verification receipt are retained in ignored local release artifacts for rollback.

The Supabase deployment is separate from the Pages frontend release. The production package was not unlocked during backend verification; a controlled authenticated import/shared-save check follows the frontend release. Source parity and unauthenticated smoke checks do not establish that complete end-to-end result.

The full workbook audit, source-derived schedules and local QA artifacts are excluded from the public repository. The detailed audit remains available in the local workspace.
