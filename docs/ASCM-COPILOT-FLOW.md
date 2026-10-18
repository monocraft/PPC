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
flow's secured worker credential was saved; no raw key was read. Platform JWT
checking remains On and `PPC_ASCM_FLOW_ENABLED` is absent. The main flow is Off
with no runs. No worker invocation, report import, publication or email move is
proven by these setup steps. This is protected configuration, not activation.

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
   pattern Off, Content transfer / Allow chunking Off, retry None, PT2M and
   supported Secure Inputs/Outputs. Async Off preserves the actual 202 response;
   chunking Off preserves statusCode/headers and avoids Logic Apps' separate
   chunk protocol, which this worker does not implement. Keep native SharePoint
   Create file's proven default chunking On; it is a different connector action.
5. For a pending report only, POST `{}` to `/api/ascm/publication/queued`.
   GET its adapter-relative binary path with the worker header and
   `X-PPC-Package-Generation`. A null candidate leaves the email in Inbox.
6. Use native SharePoint **Create file**, whose File Content parameter is binary,
   to upload the candidate Body token to a unique GUID staging filename in the
   fixed approved folder. Keep its default Chunked transfer, retry policy None
   and PT2M timeout. Then use SharePoint HTTP POST
   `GetFileByServerRelativeUrl('<stage path>')/MoveTo(newurl='<exact candidate path>',flags=0)`
   with an empty Body, retry None and PT2M. This moves bytes server-side without
   routing them through the HTTP action's string Body. The final name is the
   server-issued candidate name; the GUID is only the staging name. Retain
   `flags=0`; do not select the overwrite flag or improvise another final name.
   Reconcile collisions or uncertain responses through actual final identity,
   version and byte readback, holding the report if they cannot be confirmed.
   The bounded occupied-target fixture also proved refusal without changing the
   existing final bytes. Package-scale transport remains a separate gate.
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
    resolved Inbox. POST its exact `/move`, then GET that same immutable ID and
    require its original internetMessageId and parentFolderId=resolved Archive.
    Do not search by subject or move a replacement after an uncertain response.

Secure the monthly-list action and supported report/file/HTTP actions. For each
and If have no manual Secure Inputs/Outputs settings. The loop consumes the
secured monthly-list output directly. Microsoft documents downstream input
concealment, but this exact loop's iteration-history concealment is not runtime
verified; do not claim the whole loop is secured. Compose supports Secure Inputs
rather than a separate Secure Outputs toggle. No report/package goes through
model prompts or external mail. Only actual Microsoft authentication failures
use `/api/ascm/connection`; clear them after real successful service actions.
Network/DLP failures are not logouts.

The complete main happy path and service-specific auth reporting are now saved
and independently reviewed. The two Compose inputs (Outlook_connection_state, SharePoint_connection_state)
and three connection-callback bodies are actual whole-field expressions, not
interpolated text. The final Designer Flow checker has zero errors and zero
warnings. Overview separately shows zero errors and one warning: "This flow has
never been published." This is the expected unpublished draft state.
Saved recurrence is interval 1 / Hour with runtime concurrency runs 1. The main
flow remains Off, no runs, owner-only; saved completeness is not runtime proof.

Only actual service actions can report Outlook/SharePoint availability or loss;
healthy empty/ineligible cycles make zero PPC calls. Clearing a reconnect key waits for a real
successful service action. Callback conditions are reviewed source, but the
actual connector authentication-error response shape remains unproved. Final
saved evidence is native-main-complete-each-checkpoint.json,
native-main-root-auth-checkpoint.json and native-main-recurrence-corrected.json
under `.superpowers/sdd/2026-10-17-copilot-ascm-worker/`. Worker activation
approval and existing environment capacity confirmation are still pending.

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
Thus small-byte preservation and occupied-target refusal are proven. No
approximately 45 MB/64 MiB transfer, worker call, real report or automatic
publication/Archive cycle has passed at this checkpoint.

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

## Required seed and source cutover

The saved main flow cannot bootstrap delivery: its candidate guard intentionally
rejects the seed filename `master_ppc.pkg`. Keep the main Off throughout this
bounded operational sequence, detailed in local
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

Producer/seed/cutover execution is still pending. Keep the worker flag absent
and platform JWT On until the reviewed activation handoff. Package-scale native
transport, a real eligible report cycle, capacity/policy/history-concealment
checks and first scheduled run remain separate gates.

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
fixture occupied-target refusal is proven; approximately 45 MB / 64 MiB transfer
remains a separate gate.

Unpublished drafts cannot run under current documented flow rules. Publishing an
hourly trigger can start scheduled/billable work. A separately authorized bounded
designer test uses a controlled manual trigger and scoped fixture. Agent-flow
designer tests are documented as not consuming Copilot capacity, but their actual
connector actions still execute.

Activation requires confirmed existing environment credits or approved PAYG and
spending limit, DLP/endpoint acceptance, secure worker configuration, producer and
source cutover, protected date/cutoff decisions, package-scale transfer, one real
monthly report with accepted save/normal publication/exact Archive, then the first
genuine scheduled cloud run. Maker access or SSO success does not prove capacity.
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
