# ASCM through native Copilot Studio

This is the selected integration direction after HP rejected the private ChatGPT
application. Keep PPC's existing native importer, protected-data safeguards,
receipts and encrypted SharePoint delivery. An Off draft or local test is not an
activated supervisor. The binding design is
[Native Copilot ASCM worker](superpowers/specs/2026-10-17-copilot-ascm-worker-design.md).

## Backend setup

`node scripts/prepare-ascm-flow-deployment.mjs` stages an explicit 17-file source
closure and source/staged SHA-256 manifest under `.superpowers/deploy/ascm-flow`.
Only relative imports change. No credentials/data are copied; unexpected output
files are refused rather than deleted.

Deploy `ppc-ascm-flow` with explicit application authorization (`verify_jwt=false`
at the platform). Its routes remain disabled unless `PPC_ASCM_FLOW_ENABLED=true`
and a distinct 32–512-character `PPC_ASCM_FLOW_SECRET` are configured. The flow
uses only that worker secret in `X-PPC-ASCM-Flow-Secret`; import, publisher,
reader/package and service-role credentials stay inside their existing backend.
Credential entry and the new worker grant are reviewed activation steps.

On October 17, 2026, the reviewed worker from commit `518b6a7` was deployed
through the owner's existing Supabase dashboard. Its downloaded source matched
all 17 staged files, allowing only CRLF/LF normalization. In a later owner-entry
checkpoint, the exact `PPC_ASCM_FLOW_SECRET` secret name was confirmed and the
flow's secured worker credential was saved; no raw key was read. The owner has
now approved only this worker's saved-secret/fixed-route access and platform JWT
Off, which is persisted, and confirmed existing Copilot capacity.
`PPC_ASCM_FLOW_ENABLED=true` is persisted, with status false. Main is published
manual setup and verified Off after three intentionally canceled tests. Native
worker auth/private-queue access, actual native seed receipt, and ordinary
SharePoint publication generation 2 / revision 82 are verified. Report import,
email move, source cutover and unattended execution remain unproven. The owner
requested restart/retry/deployment hardening before production; see
[the reliability design](superpowers/specs/2026-10-18-ascm-reliability-design.md).
See the current seed-cache/native-confirmation checkpoint below; these prerequisites
do not establish an operating hourly supervisor.

## Temporary manual bootstrap checkpoint

The same flow `5bb99050-adca-f111-a05c-000d3a3191e3` now holds a saved,
published temporary **Request / Button** bootstrap setup. The reviewed hourly
production version is preserved in server history at **Today 12:59 AM,
October 18, 2026**. No credential was read, copied or changed. The draft remains
Off, confirmed in fresh Overview with owner-only sharing and three bounded manual
tests. Its description identifies the verified normal baseline and reliability
hold. No hourly trigger is active.

The isolated prefix is credential → Bootstrap_queue → Bootstrap_seed_ready →
Bootstrap_normal → Bootstrap_stop(Cancelled). Queue runs only after credential
success; later prefix nodes handle all four preceding completion states. The
original report initializer depends only on the stop, so the unconditional
Cancelled termination prevents report/import/Archive execution during bootstrap.
Seed uses only actual existing master readback, before/after metadata, version
4.0 and pinned identity before raw confirmation; there is **no seed write**.
Normal uses a fresh root queue and its exact candidate. Its copied publication
action uses a constant Normal_baseline_verified rather than a report variable.

Native Copy retained embedded WDL references. All 13 affected fields across 11
actions were repaired through the UI; the saved normal scope exactly matches
reviewed canonical SHA256
`26c4af0ef86d119dfd815dc03922050e32d4abe18f4a85a21ad82237cb4317a9`.
Independent final review found no Important issue. Local
`native-bootstrap-final-preservation-proof.json` confirms unchanged seed,
original each-report and root-auth paths plus root isolation. Preparing this
draft initially did not Publish, Test or invoke the worker. The subsequent
approved operator checkpoints below completed seed and normal runtime after
fixing the actual routing and gzip-reader failures. Source cutover remains held.

**Before any production report test or schedule:** remove every Bootstrap prefix
node, restore hourly interval 1 / concurrency runs 1, and restore the original
report initializer's dependency on the existing credential action. The production
sequence below is the restoration target, not the current manual trigger.

## Native action sequence

1. Use the existing environment/flow and **Copilot Studio** plan. Normal mode,
   Express Off, hourly Recurrence with trigger concurrency 1; remain Off while
   building. Each report keeps concurrency control Off: the native default is
   sequential, with no explicit loop concurrency property.
2. Native **Office 365 Outlook → Send an HTTP request** queries
   `/v1.0/me/mailFolders/inbox/messages`, top 25, receivedDateTime descending.
   Filter receivedDateTime first (after the configured cutoff), exact sender
   `linny.chen@hp.com`, monthly HyperX Release Notification prefix and attachments.
   Select only immutable id, internetMessageId, parentFolderId, subject,
   from/sender, receivedDateTime and hasAttachments. Runtime-validate the composed
   filter; never replace a failed query with unbounded mail or sent-date ordering.
3. Set `CustomHeader1 = Prefer: IdType="ImmutableId"` on all native mail HTTP
   actions. Sequentially process each eligible report; require exactly one valid
   ordinary XLSX attachment. Retrieve metadata/content through the same immutable
   message. Insert its existing `contentBytes` directly in `workbookBase64`.
4. Initialize Boolean `Report_replay_ready` to false at root and reset it to
   false at the start of every report iteration. POST exact native report JSON
   to `/api/ascm/import`. Preserve original envelope, accepted requestId, immutable
   messageId and nonempty internetMessageId. Healthy empty/ineligible work makes
   no import/queue/status request; an actual native Microsoft auth failure can
   report reconnect even before eligibility is known. All built-in HTTP worker
   actions require Asynchronous
   pattern Off, Content transfer / Allow chunking Off, PT2M and
   supported Secure Inputs/Outputs. Async Off preserves the actual 202 response;
   chunking Off preserves statusCode/headers and avoids Logic Apps' separate
   chunk protocol, which this worker does not implement. Keep native SharePoint
   Create file's proven default chunking On; it is a different connector action.
   The reviewed reliability definition gives only safe reads and replay-safe
   import/queue/confirmation requests two exponential retries, interval/minimum
   PT5S and maximum PT30S. Create, promote and Outlook move retain retry None.
5. For a pending report only, POST `{}` to `/api/ascm/publication/queued`.
   GET its adapter-relative binary path with the worker header and
   `X-PPC-Package-Generation`. A null candidate leaves the email in Inbox.
6. Use native SharePoint **Create file**, whose File Content parameter is binary,
   to upload the candidate Body token to a unique GUID staging filename in the
   fixed approved folder. Keep its default Chunked transfer, retry policy None
   and PT2M timeout. After succeeded/failed/timed-out creation, read the exact
   stage and require full nonempty native `$content` equality with the downloaded
   candidate through the strict peer Stage_bytes_match Compose guard. This is
   direct envelope equality, with no package encoding or string conversion.
   Only guard success permits SharePoint HTTP POST
   `GetFileByServerRelativeUrl('<stage path>')/MoveTo(newurl='<exact candidate path>',flags=0)`
   with an empty Body, retry None and PT2M. This moves bytes server-side without
   routing them through the HTTP action's string Body. The final name is the
   server-issued candidate name; the GUID is only the staging name. The native
   connector exposes no documented conditional-create switch, so retain a new
   candidate-prefixed GUID and one create attempt. A complete run loss may leave
   an orphan; do not claim cross-run conditional creation or automatic orphan
   cleanup. Retain
   `flags=0`; do not select the overwrite flag or improvise another final name.
   Reconcile collisions or uncertain responses through actual final identity,
   version and byte readback, holding the report if they cannot be confirmed.
   The bounded occupied-target fixture also proved refusal without changing the
   existing final bytes. Native 45 MiB/full 64 MiB binary transfer is now proven;
   worker download/raw confirmation remains a separate gate.
7. SharePoint-hosted REST v2 `/drives/...` returns the actual Graph-compatible
   item ID, parent drive/folder, size and latest version ID. Native connector
   ItemId/file Id/ETag are different identifiers. Read actual current bytes with
   native Get file content using path; read metadata before/after and hold on
   changed identity/ETag/size/version.
8. POST that actual readback as application/octet-stream to
   `/api/ascm/publication/{candidateId}/confirm`. Add generation and bounded
   `X-PPC-SP-Drive-Id`, `X-PPC-SP-Folder-Id`, `X-PPC-SP-Item-Id`,
   `X-PPC-SP-Version-Id`, `X-PPC-SP-File-Name`. Backend hashes the bytes; the
   authenticated worker is trusted for Microsoft provenance. Never substitute
   candidate-download bytes, a declared hash, URL or upload response for readback.
9. Replay original import. Archive requires HTTP 200, published status, literal
   archiveAllowed=true, same accepted requestId and exact sourceMessageId.
   Confirmation/seed/Git acknowledgement cannot independently grant Archive.
10. Resolve ordinary Archive through native Outlook HTTP `/me/mailFolders/archive`.
    Re-read original immutable message and require original internetMessageId and
    resolved Inbox. POST its exact `/move`, then GET that same immutable ID after
    succeeded/failed/timed-out moves and
    require its original internetMessageId and parentFolderId=resolved Archive.
   Do not search by subject or move a replacement after an uncertain response.
   Repeat the fresh per-report publication gate and pre-move Inbox identity in
   Archive_verified; a lost move response alone cannot imply failure or success.

Secure the monthly-list action and supported report/file/HTTP actions. For each
and If have no manual Secure Inputs/Outputs settings. The loop consumes the
secured monthly-list output directly. Microsoft documents downstream input
concealment, but this exact loop's iteration-history concealment is not runtime
verified; do not claim the whole loop is secured. Compose supports Secure Inputs
rather than a separate Secure Outputs toggle. No report/package goes through
model prompts or external mail. Only actual Microsoft authentication failures
use `/api/ascm/connection`; clear them after real successful service actions.
Network/DLP failures are not logouts.

The complete production happy path and service-specific auth reporting remain saved
and independently reviewed. The two Compose inputs (Outlook_connection_state, SharePoint_connection_state)
and three connection-callback bodies are actual whole-field expressions, not
interpolated text. The final Designer Flow checker has zero errors and zero
warnings. Before publishing the manual setup, Overview separately showed zero
errors and one expected warning: "This flow has never been published." That is
a dated pre-publication observation, not the current published-manual state.
The preserved production recurrence is interval 1 / Hour with runtime concurrency
runs 1; the current temporary bootstrap trigger is Request / Button. The main
flow is now published manual setup, owner-only, with three intentionally canceled
bounded tests. Fresh post-test Overview verified Off; hourly stays disabled;
saved completeness is not runtime proof.

Only actual service actions can report Outlook/SharePoint availability or loss;
healthy empty/ineligible cycles make zero PPC calls. Clearing a reconnect key waits for a real
successful service action. Callback conditions are reviewed source, but the
actual connector authentication-error response shape remains unproved. Final
saved evidence is native-main-complete-each-checkpoint.json,
native-main-root-auth-checkpoint.json and native-main-recurrence-corrected.json
under `.superpowers/sdd/2026-10-17-copilot-ascm-worker/`. Worker activation
approval and existing environment capacity are now confirmed; the worker is now enabled and its native auth/private-queue connection test
has passed. Actual ordinary package publication has also passed; report runtime
and unattended recovery remain pending.

## Bounded binary transport checkpoint

A separate manual-only fixture flow, `645c61b1-baca-f111-a05c-000d3a3191e3`,
was used for bounded designer tests. The main hourly supervisor remains Off with
no runs. Fresh Overview after the collision test verified the fixture is Off (Turn on
available), with three history entries: initial binary failure, corrected binary
success and expected collision failure. The first test,
`08584093022795851307737056710CU20`, failed: a 1,024-byte synthetic source
became 2,048 bytes both in SharePoint's reported Length and raw readback,
matching UTF-8 replacement coercion through the HTTP string Body.

After switching to native binary Create file → GUID staging → MoveTo(flags 0,
empty Body) → actual final native readback, designer test
`08584093014773920399111049088CU15` passed in one second. Independent
SharePoint raw readback was exactly **1,024 bytes**, SHA256
`785b0751fc2c53dc14a4ce3d800e69ef9ce1009eb327ccf458afe09c242c26c9`.
The saved local action checkpoint is
`.superpowers/sdd/2026-10-17-copilot-ascm-worker/native-binary-move-checkpoint.json`.
A further occupied-target designer test,
`08584093013156730293609222080CU22`, uploaded a different harmless 53-byte
sentinel to a fresh GUID stage. Its MoveTo(flags 0) action refused the exact
occupied final filename with an already-exists error, so the designer run is
Failed as expected for this guard test. Independent final SharePoint raw readback
remained the original 1,024 bytes with the same SHA256 and unchanged modified
time, `2026-10-18T06:36:49Z`. The local proof is
`.superpowers/sdd/2026-10-17-copilot-ascm-worker/native-collision-proof.json`.
Thus small-byte preservation and occupied-target refusal were proven at that
checkpoint. The later native scale checkpoint below adds 45 MiB/full 64 MiB
binary evidence; worker download/raw confirmation, a real report and automatic
publication/Archive remain unproved.

## Bounded REST metadata checkpoint

A separate read-only native fixture, `87b8a88c-bf32-6ba7-12da-1ba84df63c9f`,
used exactly two native SharePoint GET actions. Run
`08584092968829945508758850407CU09` succeeded in 606 ms. Its strict
`int(if(assertion,'1','Metadata_mismatch'))` expression fails on mismatch rather
than merely producing a Boolean. It proved the fixed REST v2 folder route,
actual item/parent-drive/parent-folder IDs, exact fixture filename and 1,024-byte
size, a nonempty eTag, file facet and latest version `1.0`. The fixture is Off.
The saved source/readback proof is `native-rest-metadata-proof.json` in the same
local evidence directory. This is metadata proof for the small fixture, not
45 MB/64 MiB transfer, seed/normal publication, a real report or Archive.

## Native package-scale binary checkpoint (October 18, 2026)

The existing manual fixture `645c61b1-baca-f111-a05c-000d3a3191e3` now accepts
one file input, decoding only its contentBytes to binary. Known synthetic files
repeat bytes 0..255. Actual designer tests passed through native chunked Create
file → empty-body MoveTo(flags 0) → actual native readback → fixture-only full
base64 equality. Independent existing SharePoint connector/raw downloads also
matched every source byte/hash:

- **45 MiB / 47,185,920 bytes**, run `08584092930198467849090085198CU03`,
  Succeeded in **7 seconds**; SHA256
  `bd6fb4d447314779757d48f9ffec392c1ca5eaaef80c5f07ae9b6827b2427033`.
- **64 MiB / 67,108,864 bytes**, run `08584092927841270305914077317CU08`,
  Succeeded in **11 seconds**; SHA256
  `281e519df3077b557c6b03f5da83c4e8d397219259615dd7c3308f89cae8f2a6`.

The exact reviewed fixture source SHA256 is
`57cce108ec499c8a3bbe5ba2e0caf544104aea549820c2d675d60b8e72aa0359`.
Local native-scale-45mib-proof.json/native-scale-64mib-proof.json record the
runtime results and independent matches. Fresh Overview confirms Off and the
persisted description accurately scopes the 45/64 MiB proof. Its checker shows
zero errors/one expected warning, “This flow is off”; saved/viewed screenshot is
`ascm-native-scale-passed-off.png`. This proves
only the native SharePoint binary leg, not worker download/raw confirmation,
seed/normal publication, browser cutover or a real end-to-end report cycle.
Production package transport remains raw binary; the full base64 comparison was
only a controlled synthetic-fixture assertion.

One exact Outlook Inbox query using the native filter and strict
receivedDateTime > `2026-10-18T03:42:00Z` returned an empty array with no nextLink.
There is no currently eligible report from that bounded query. Preserve the
cutoff and do not substitute historical mail. Main is now published manual setup with one intentionally canceled bounded
connection test; fresh post-test Overview verified Off and hourly remains disabled. Scoped
worker consent and existing capacity are confirmed; the current seed-reader
failure is described below.

## Current operator checkpoint: seed confirmed, normal publication pending

Scoped worker consent and existing Copilot capacity are confirmed. Worker JWT
Off and `PPC_ASCM_FLOW_ENABLED=true` are persisted; status remains false. Package
delivery is true and publisher paused in SharePoint mode. Seeding used
trusted published revision **82**, Git blob
`18074356b8e9d236bb2b7534695d1a7c9a522f60`, and the unchanged pin:
45,439,227 decoded bytes, SHA256
`d1af8e0e7fd1782a2b52433a38b62db227cc42a999179fb3ddd7d7d2bee1b7e2`.

Router fix `f50f262` is committed/pushed; all **157** configured checks and both
required isolated SQL checks passed. Graph validation recorded 7,622 nodes /
14,027 edges. The first dashboard-only deployment impression was incorrect:
duplicate independent http entries let an unchanged copy overwrite the edit.
Both copies were then set to the identical reviewed text. Authoritative package
ZIP 4 (SHA256 prefix `2475a1441`, http `d9920ca4`, other eight files unchanged)
and worker ZIP 2 (SHA256 prefix `9db04272`, http `7265917b`, all 17 canonical,
16 unchanged) now verify both actual deployed source artifacts.

The earlier seed dispatch `39136126659` failed PUBLICATION_FAILED at
package/current 404; its bounded state read was generation 0 / all slots null.
The controlled third seed dispatch `39138595525` instead failed the new
`RESPONSE_TOO_LARGE` at `2026-10-18T15:01:41Z`, before candidate staging. A fixed
Pages HEAD returned 200, gzip Content-Length **45,453,110**, compared by the
reader with the decoded **45,439,227** pin. Reader repair
`2bc5ce8046213c328e06ae994d74cd817e07d510` is now committed/pushed in PR #92,
independently approved and passed all 157 commands with required SQL enabled.
Graph verification is current at 7,623 nodes / 14,030 edges with private files
excluded. No pin, size, hash or deadline changed. Main `5333238` still has the
old reader: PR #92 is not merged and no Pages deployment occurred.

Main is **published manual setup**, Request/Button with no hourly trigger and
unconditional stop before report/mail actions. Bounded native connection test
`08584092707468106574998205934CU28` passed worker auth/routing/private-queue
access: Bootstrap_queue Succeeded in **0.7 s**. Both actual run inputs and outputs
showed **Content not shown due to security configuration.** Original initializer
and List monthly were Skipped; empty-candidate seed/normal conditions succeeded
with false branches. Bootstrap_stop Succeeded in 0.3 s and the overall test was
intentionally **Test canceled** after 5 s. No publication, ASCM import or Archive
ran. Screenshot `ascm-worker-connection-verified.png` records this proof.

Main's connection-test checkpoint has one intentional Test canceled (5 s)
history entry and was independently verified Off. Approved branch seed #95 /
`39139528604` / job `117710898325`, accepted exact commit `2bc5ce8`, now
**Succeeded in 18 seconds**. The actual job log at
`2026-10-18T15:14:08.263Z` says **Encrypted master publication pending;
revision82.** The producer remains disabled. This proves the ready private seed
cache only, **not a SharePoint seed receipt or normal baseline**; the CLI
intentionally prints no candidate ID.

The actual native seed test `08584092702849290284995603978CU24` is now
verified: native existing-master readback took **3 s**, raw Confirm_seed
Succeeded in **3.7 s**, strict Seed_confirmation_matches was True and
Seed_bootstrap_verified Succeeded. Overall Test canceled after 12 s was
intentional. Original initializer, monthly query, each-report and auth actions
were all Skipped; no ASCM report or Archive ran. Screenshot
`ascm-seed-confirmed.png` records this proof. Main was then independently
verified **Off** with Turn on available.

Bounded actual receipt state saved in `native-seed-publication-receipt.json`
recorded phase seeding, generation **1**, current candidate
`2524953a-4eaa-402e-899f-f33de783850c`, queued/cleanup null, SharePoint publication
kind **seed**, revision **82**, exact pinned 45,439,227 bytes/hash, published at
`2026-10-18T15:16:48.234Z`. A guarded operator call with proper JSON
`{"phase":"sharepoint"}` then ran once and returned configured/sharepoint,
verified in the actual grid. Current backend phase is therefore **sharepoint**;
that checkpoint initially retained the seed object. Seed receipts never grant
Archive. The later normal receipt below supersedes that current object.

The ordinary producer #96 / `39140109372` / job `117712605553`, using reviewed
branch `2bc5ce8`, succeeded in 20 seconds with both bootstrap and seed false and
no image override. The log reported pending revision 82. The publisher was
disabled again after that bounded run.

Actual native normal test `08584092698085549306066010079CU02` completed in
22 seconds, with intentional Cancelled termination before all report/mail paths.
Native binary creation, MoveTo(flags=0), metadata/version reads, actual final
SharePoint readback and raw Confirm succeeded. Confirmation_matches_1 was True
and Normal_baseline_verified Succeeded. A bounded independent receipt read
recorded phase **sharepoint**, generation **2**, current candidate
`a426161c-27da-4a5d-9ee7-218af016e9cc`, publication kind **publication**, accepted
and published revision **82**, bytes **45,439,227**, SHA256
`2d5efcb0a9f0a0eed27489ebb8dd5a0874229cc594f52dfd15d75052ba674e37`,
published `2026-10-18T15:24:54.717Z`. Queued was null; cleanup held the previous
confirmed seed delivery object for the existing settled cleanup mechanism.
No accepted facts, old SharePoint master or receipts were replaced.

Fresh Overview verified **Off**, no hourly trigger, and an accurate reliability
hold description. Screenshot `ascm-normal-publication-confirmed.png` and local
`native-normal-publication-receipt.json` record the proof. Pages cutover, real
report/Archive, reliability recovery and restored hourly operation remain pending.
PR #92 is not merged and no Pages deployment occurred; main `5333238` still
contains the older reader.

## Reliability release checkpoint (October 18, 2026)

The [canonical production definition](ascm/native-production-flow.json),
[field change manifest](ascm/native-field-change-manifest.json), and
[operating limits](ascm/README.md) replace fragmented authoring notes as the
nonsecret release source. The owner-entered credential remains opaque and must
never be replaced with the source placeholder. The saved native report branch
now matches the canonical branch after only equivalent runAfter status
case/order normalization. Its recovery edits and finite safe-request retries
are saved in the existing Off manual flow; the latest draft is not published.
Microsoft's final Designer checker reports **zero errors and zero warnings**.
Temporary bootstrap isolation is still present pending the approved report test.

Forward migration `202610180001_package_delivery_recovery.sql` is deployed.
Actual function-body fingerprints match both reviewed functions, with anon and
authenticated execution false and service_role execution true. No grants or
storage limits changed. Both deployed recovery-core artifacts match their
source manifests: worker **17/17 files**, ZIP SHA256
`6ec1b0c1105d7d0341507f9f81924f03bc76f5faec17d8c10383291f147caa87`, and
package delivery **9/9 files**, ZIP SHA256
`cbd96f3b01c48e1f8193dfbc851022d07459a2f3de5c9023b175eedc936d5c49`.
Each duplicate dashboard core entry was updated identically; downloaded source,
rather than a dashboard timestamp, is the deployment evidence.

Unclaimed reservations now retire only under the accepted-state/delivery locks,
fencing the old upload identity. Expired uncertain objects settle only after
full exact ciphertext verification for the same candidate/generation/attempt;
missing or partial data stays held. Ordinary ASCM processing drains older ready
work while withholding Archive until the newer report's fresh receipt qualifies.
Explicit owner-image input mismatches remain held, and an ordinary dispatcher
cannot discard an unclaimed owner-image intent. Retrying that owner command uses
the same immutable image commit. The producer's five-minute cron is removed in
the reviewed source; the live publisher remains disabled pending integration.

All **160 canonical check commands** passed with required isolated PGlite.
Independent task and whole-change reviews approved the source after correcting
known-status retry classification, stage-read reconnect precedence, and owner
image-intent preservation. Fresh affected publisher checks passed after the final
correction. The validator has **21** cases and actual-expression outcome tests
have **6** cases. PGlite proves serial race interleavings, not concurrent session
scheduling in live PostgreSQL.

A separate actual native synthetic test,
`08584092680442167781123438419CU29`, passed in **7 seconds** with **45 MiB**:
binary create → actual stage read → strict full-content guard → no-overwrite
promotion → final read. The strict guard's inputs/outputs were concealed. Its
fixture is verified Off. This proves the native stage comparison at scale;
worker-download envelope shape and actual connector lost-response behavior are
distinct runtime gates. A total run loss may leave a harmless staging orphan;
this release does not claim cross-run conditional creation or negative upload
settlement.

A fresh bounded Inbox query still found no eligible report after the unchanged
`2026-10-18T03:42:00Z` cutoff. The owner has now approved a **one-message** test
of the October 2026 monthly release from Linny Chen, received September 30 at
09:01:09 UTC. That test has not run yet. It must preserve exact-message identity,
the protected-data checks, and normal-publication Archive authority, then restore
the normal query. This authorizes no general historical backfill.

Global SharePoint source cutover has an additional liveness hold: standalone
ordinary or owner-image publications have no queue consumer when there is no
eligible pending ASCM report. An event-driven native publication flow is being
designed separately; no new inbound capability or permission is activated, and
idle backend polling is not an acceptable workaround. Real report/Archive,
source adoption, production recurrence restoration, and the first scheduled
cloud run remain incomplete.

## Required seed and source cutover

The production report path cannot bootstrap delivery: its candidate guard
intentionally rejects the seed filename `master_ppc.pkg`. The current temporary
manual prefix isolates that report path in the same flow; it does not bypass
the operator phase and trusted producer steps. Keep hourly/report execution
disabled. The connection test completed and Off was verified; the isolated
manual setup completed actual native seed confirmation and was verified Off.
Normal package confirmation is verified; report production/cutover and recovery
hardening remain pending. This sequence is detailed in local
`.superpowers/sdd/2026-10-17-copilot-ascm-worker/native-cutover-readiness.md`:

1. Obtain the action-time worker activation approval; freeze/drain legacy
   publication and select the existing producer's SharePoint mode.
2. Require trusted publication metadata to match the pinned seed; enter seeding
   through the existing operator-only phase function. Never replace accepted
   facts or change the pin to force a match.
3. Use the existing trusted producer's seed-cache path, then fresh actual native
   SharePoint seed readback/confirmation. A seed receipt never grants Archive.
4. Advance to SharePoint phase, produce a normal baseline from current accepted
   facts and confirm its actual final SharePoint bytes/identity/version through
   a separate bounded manual publication path.
5. Switch Pages' package source only after a confirmed current normal
   publication, then verify safe browser adoption. Preserve existing keys,
   receipts, old versions, complete assets and newer team changes throughout.

Seed staging/readback/confirmation and guarded phase advance to SharePoint are
verified. Router fixes are deployed and the reviewed branch reader repair
produced the exact pinned seed cache for revision82.
Actual native seed receipt, guarded phase advance and ordinary normal baseline
are now verified; source cutover remains unverified.
Worker JWT is Off and Flow enablement true within the approved bounded setup.
Actual 45,439,227-byte worker download/raw confirmation is verified. Real eligible report processing,
policy/history-concealment checks and first scheduled run remain separate gates.
Existing Copilot capacity has been confirmed.

## Verification and activation

Keep package bytes raw. Backend cap is 67,108,864 bytes; normal-flow message cap
is 100 MB, Express action cap 64 KB. Whole-package base64/string/concat expressions
have a much smaller evaluation limit. Use native Body/File Content binary tokens.
The [SharePoint connector](https://learn.microsoft.com/en-us/connectors/sharepointonline/#create-file)
documents binary File Content for Create file and string Body for its HTTP
operation. A real small fixture demonstrated byte corruption through the latter,
so do not use a `Files/add` HTTP Body for candidate bytes. The corrected native
binary Create file → server-side
[MoveTo](https://learn.microsoft.com/en-us/previous-versions/office/sharepoint-visio/jj245487%28v%3Doffice.15%29)
sequence uses
[move flags](https://learn.microsoft.com/en-us/previous-versions/office/sharepoint-visio/jj244909%28v%3Doffice.15%29)
0, with actual final SharePoint readback. Preserve old package versions. Small
fixture occupied-target refusal and actual native 45 MiB/full 64 MiB binary
transfer are proven. Worker download/raw confirmation at scale remains a
separate gate.

Unpublished drafts cannot run under current documented flow rules. Publishing an
hourly trigger can start scheduled/billable work. A separately authorized bounded
designer test uses a controlled manual trigger and scoped fixture. Agent-flow
designer tests are documented as not consuming Copilot capacity, but their actual
connector actions still execute.

Activation requires confirmed existing environment credits or approved PAYG and
spending limit, DLP/endpoint acceptance, secure worker configuration, producer and
source cutover, protected date/cutoff decisions, package-scale worker download and
raw confirmation, one real monthly report with accepted save/normal publication/
exact Archive, then the first genuine scheduled cloud run. Maker access or SSO
success does not prove capacity.
No credit purchase or billing setup is authorized by source preparation.

Primary references: [flows](https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview),
[credits](https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management),
[Outlook](https://learn.microsoft.com/en-us/connectors/office365/),
[SharePoint](https://learn.microsoft.com/en-us/connectors/sharepointonline/),
[REST v2](https://learn.microsoft.com/en-us/sharepoint/dev/apis/sharepoint-rest-graph),
[binary content](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-content-type),
[draft testing](https://learn.microsoft.com/en-us/power-automate/drafts-versioning#can-drafts-be-tested),
[run-history security limits](https://learn.microsoft.com/en-us/azure/logic-apps/set-up-security-permissions#secure-data-in-run-history-by-using-obfuscation),
[HTTP async behavior](https://learn.microsoft.com/en-us/azure/connectors/connectors-native-http#disable-checking-location-headers),
[Logic Apps chunking](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-handle-large-messages).
