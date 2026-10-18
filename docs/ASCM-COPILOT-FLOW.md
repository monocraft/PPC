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
all 17 staged files, allowing only CRLF/LF normalization. Platform JWT checking
remains On; the new worker secret and enable flag have not been configured.
There was no worker invocation, report import, publication or email move during
this deployment. This is a protected deployment checkpoint, not activation.

## Native action sequence

1. Use the existing environment/flow and **Copilot Studio** plan. Normal mode,
   Express Off, hourly Recurrence, concurrency 1; remain Off while building.
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
4. POST exact native report JSON to `/api/ascm/import`. Preserve original
   envelope, accepted requestId, immutable messageId and nonempty internetMessageId.
   No eligible report means no PPC/queue/status request.
5. For a pending report only, POST `{}` to `/api/ascm/publication/queued`.
   GET its adapter-relative binary path with the worker header and
   `X-PPC-Package-Generation`. A null candidate leaves the email in Inbox.
6. Native SharePoint uploads raw candidate bytes into the fixed approved folder
   using explicit `Files/add(url='<candidate name>',overwrite=false)` semantics.
   Disable automatic upload retries. Collision/uncertainty requires readback;
   never use overwrite=true or invent another name.
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

Hide sensitive action inputs/outputs in run history, including loop/report/file
operations. No report or package goes through model prompts or external mail.
Only actual Microsoft authentication failures use `/api/ascm/connection`; clear
them after real successful service actions. Network/DLP failures are not logouts.

## Verification and activation

Keep package bytes raw. Backend cap is 67,108,864 bytes; normal-flow message cap
is 100 MB, Express action cap 64 KB. Whole-package base64/string/concat expressions
have a much smaller evaluation limit. Use native Body/File Content binary tokens.
SharePoint HTTP documents a string Body: prove actual create-only upload/readback
with a harmless encrypted fixture before relying on the approximately 45 MB
package. Preserve old package versions.

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
[draft testing](https://learn.microsoft.com/en-us/power-automate/drafts-versioning#can-drafts-be-tested).
