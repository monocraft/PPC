# Native Copilot Studio ASCM worker

## Purpose and decision

Complete the existing monthly HyperX ASCM workflow with a native scheduled
Copilot Studio agent flow. HP's private ChatGPT application route is unavailable;
the owner approved native Outlook and SharePoint connections and instructed the
implementer to proceed without further design questions. Keep the existing PPC
backend, parser, protected-data planner, immutable receipts, package producer,
SharePoint destination and encrypted delivery architecture.

This is a runtime integration, not an LLM report-writing feature. The flow runs
on Microsoft infrastructure while the owner's PC is off. Its existing native
connections own Microsoft authentication. No Microsoft token is exported to PPC.
Copilot Studio runtime capacity and tenant policy remain activation gates.

## Backend boundary

Add a small independent Edge function `ppc-ascm-flow`, default disabled. Reuse
`createMasterGateway`, `createPackageDelivery` and the native ciphertext verifier.
Do not alter the existing OAuth MCP authorization or native SQL transaction.

Configuration requires `PPC_ASCM_FLOW_ENABLED=true`, a dedicated
`PPC_ASCM_FLOW_SECRET` (32–512 non-whitespace characters, different from import
and publisher credentials), valid `PPC_ASCM_START_AFTER`, and the existing
server import and delivery configuration. All routes require
`X-PPC-ASCM-Flow-Secret`. Reject browser Origin and CORS, unknown paths, methods,
query parameters and extra fields before business operations. Missing/invalid
configuration returns 404 without RPC, Storage, gateway or body reads.

| Route relative to the function | Contract |
| --- | --- |
| `POST /api/ascm/import` | Exact existing six-field report JSON; maximum 3 MiB JSON and 2 MiB decoded XLSX. Validate sender/monthly release/file envelope and cutoff before in-process native import. The import credential stays server-side. |
| `POST /api/ascm/publication/queued` | Exact `{}`. Return sole ready, unexpired candidate metadata and an adapter-relative binary path; no Storage path or signed URL. |
| `GET /api/ascm/publication/{candidateId}/bytes` | Canonical generation in `X-PPC-Package-Generation`; stream only that exact currently queued candidate, with native length/hash verification. No current/history/list access. |
| `POST /api/ascm/publication/{candidateId}/confirm` | Raw `application/octet-stream` from actual SharePoint readback. Bounded generation and provenance headers identify drive, folder, item, version and filename. Compute digest/length server-side, then reuse native confirmation/CAS. Exact historical lost-confirm retries remain valid. |
| `POST /api/ascm/connection` | Exact `{service,state}`, only outlook/sharepoint and available/reconnect_required, using existing transition reporter; no raw error storage or idle polling. |

Bound request bodies and streams to 120 seconds, cancellation and declared/actual
length agreement. Ciphertext stays raw and bounded at 67,108,864 bytes; no package
buffering, decryption, Base64 package envelope or arbitrary URL fetch. Return
sanitized fields and `archiveAllowed:false` on every error and confirmation.

Import results bind `sourceMessageId` to the validated envelope and `requestId`
to the actual workbook digest. Only a native accepted receipt plus an independent
current **normal SharePoint** publication at or beyond its revision may return
`archiveAllowed:true`. Reject legacy delivery before import; independently
recheck normal SharePoint current publication before exposing Archive permission.
Seed confirmation, Git publication and a caller-declared hash cannot authorize
Archive. Do not expose publisher, reader, package-key, service-role or policy
controls through this worker credential.

Add narrow internal package-core methods for metadata without a signed URL and
opening the exact queued candidate; reuse existing policy and object mapping.
Keep all old method defaults and MCP behavior compatible.

## Native flow

Use the existing saved draft and its Copilot Studio plan. Normal mode only;
Express mode cannot carry this package. Use an hourly Recurrence trigger,
concurrency one and a bounded newest-first Inbox query for monthly releases from
`linny.chen@hp.com`. Exclude weekly reviews and mail at/before the server cutoff.
Do not call PPC on idle checks. Keep Microsoft and HTTP sensitive inputs/outputs
hidden from run history, with no prompt/chat/file relay.

For each eligible report, insert Outlook's existing attachment `contentBytes`
directly into the import JSON. Retain the original envelope for idempotent replay.
Pending publication leaves the email in Inbox. Retrieve a ready candidate only
while processing an eligible pending report. Transfer raw candidate bytes to the
fixed SharePoint folder using explicit create-only semantics. A collision or
uncertain write is resolved by actual readback, never overwrite.

Verify Graph-compatible item and version metadata through supported SharePoint
REST v2 with the native SharePoint connection. Native connector integer ItemId,
file Id and ETag are not Graph driveItem/version IDs. Match configured drive and
folder, candidate name and size. Read the actual current file bytes through the
native SharePoint file-content action, check unchanged identity/ETag/version
before/after, and send those raw bytes to confirmation. The worker credential is
trusted for Microsoft provenance; hashing proves byte identity, not independently
that Microsoft supplied them. Never wire candidate-download bytes as readback.

Re-submit the original import after confirmed publication. Move only its exact
message to Archive when HTTP 200, status published, literal archiveAllowed true,
expected requestId and sourceMessageId all agree. Verify the move result. Held,
stale, uncertain or failed operations retain the message. No external forwarding.

## Verification and activation

Use fail-first local checks for route/auth/cutoff isolation, raw streaming,
receipt/provenance binding, legacy/seed denial, immutable retry and unchanged
protected data. Extend real PGlite integration; all outbound fixture traffic fails
closed. Validate canonical and staged Edge sources, then the configured suite and
deterministic Graphify build/check once. Fresh independent review precedes release.

Before real publication prove native create-only binary upload/readback with a
bounded harmless encrypted fixture: SharePoint HTTP's body schema alone does not
prove binary preservation. Retain existing package versions and actual data.

Activation also requires existing environment Copilot capacity, permitted
HTTP/Outlook/SharePoint policy, secure worker credential handoff, producer
configuration, explicit protection/cutoff policy, real package-scale transport,
and one chosen real monthly report. Only enable the schedule after its complete
accepted-save, normal-publication and exact-email Archive cycle is verified.
Then verify the first scheduled cloud run. Off/source/local tests are incomplete.
