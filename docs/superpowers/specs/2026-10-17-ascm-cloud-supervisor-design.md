# ASCM cloud supervisor

The owner requested an ongoing inbox-to-PPC workflow, confirmed monthly published reports only, requires operation while their PC is off, and explicitly authorized building the missing backend API. Source implementation is authorized. Cloud credentials, production activation, and Microsoft tenant consent remain configuration prerequisites; never simulate success or enable a local-only substitute.

## Design

Use a GitHub Actions hourly cloud job and a dedicated optional operation in the existing Supabase PPC gateway. Reuse the dependency-free ASCM parser and the existing transactional master commit, immutable request receipts, encrypted-package publisher, and revision metadata. No LLM is needed on an idle check. The job is disabled unless the repository variable `PPC_ASCM_ENABLED` is exactly `true`; manual runs use the same gate.

Accept only mail in Inbox from `linny.chen@hp.com`, with a subject exactly matching `ASCM Report Accessories HyperX Release Notification <Month> <Year>` (case-insensitive, surrounding whitespace allowed). Weekly review subjects are excluded. Require one ordinary non-inline attachment named `ASCM Report_HyperX_YYYY-MM-DD.xlsx`. The filename date must be a real day, no later than received date; its month must be the named publication month or the immediately preceding month. Reject multiple matching workbook attachments. File limit for this unattended endpoint is 2 MiB; larger valid workbooks stay for manual import. Require an explicit `PPC_ASCM_START_AFTER` cutoff; do not backfill historic mail by default.

The cloud job uses a dedicated Microsoft Entra application and app-only Graph access restricted to the owner's mailbox by Exchange administrators. It needs Mail.ReadWrite, not Mail.Send. Credentials are server secrets and never appear in source, logs, artifacts, or browser code. All Microsoft requests use pinned HTTPS origins, bounded response sizes, timeouts and redirect rejection. Bound each run to 25 messages and 5 inbox pages; never follow arbitrary pagination URLs.

## Backend contract

`POST /api/master/ascm` takes JSON `{sender, subject, receivedAt, messageId, fileName, workbookBase64}` and the dedicated header `X-PPC-ASCM-Secret`. It accepts no arbitrary manifest, field patches, package key, or publisher secret. It is unavailable when `PPC_ASCM_IMPORT_SECRET` is unset; browsers are denied. Authenticate before database access. Strictly validate fields and body/file limits, then derive `requestId = "ascm-" + SHA256(workbook bytes)`. Return only a bounded receipt and summary, never the master document.

The server reads the current raw master itself. The planner uses existing ASCM identities/matching and canonical master changes, maintains field revisions/history through `mergeChanges`, and overlays only ASCM source evidence. Preserve custom data, assets and images, MSRP/specifications, explicit status, source-absent products, and existing numeric order gaps. New unambiguous products append to an existing category/lane. Category relocations, ambiguous identities, duplicate matches, malformed rows/dates and incompatible mappings require review and cause no commit. Entire reports are atomic: no partially successful archive result.

Device-local date locks cannot be inferred in the cloud. Without `PPC_ASCM_DATE_POLICY`, hold an entire report that changes existing GA/EM or dependent roadmap dates. An explicitly configured policy `{version:1, allowUpdates:true, protected:[{productId, fields:["generalAvailabilityDate","endManufacturingDate"]}]}` authorizes only unprotected changes. Invalid policy disables date updates; protected changes hold the report. New products can retain dates supplied by the workbook. Reject a report older than the accepted ASCM source date; never delete missing products.

Read the native receipt before planning. Repeated bytes use the original accepted receipt even if the database or parser changes later. Fingerprint the bytes plus stable publication identity; a replay mismatch is rejected. Use session `ascm-supervisor` and the existing compare-and-swap commit. Do not replan within an API request after a CAS race; leave mail for a later scheduled attempt that reads the current baseline and revalidates every rule. Validate the resulting manifest and readable snapshot before commit. Dispatch the existing publisher after an accepted changed commit; a pending receipt replay may request that idempotent publisher again to recover a lost dispatch.

## Archive gate and retries

Successful import responses contain `{requestId, storageRevision, alreadySaved, archiveAllowed, status, summary}`. `archiveAllowed` is true only when an accepted native receipt is present and `publication.publishedRevision >= receipt.storageRevision`. Pending publication returns accepted/pending with archiveAllowed false. Lost replies and archive failures are retried safely by the next cloud run; the same attachment digest cannot import twice. No inbox polling run reads PPC unless a qualifying report is present. There is no live health monitoring, SQL polling, production test, mail sending, or deletion.

The runner moves only a qualifying message with exactly one successful report to the well-known Archive folder. Verify the move response identifies the moved message/folder. Failed imports, review holds, pending publication, missing access and failed archive verification keep the original mail or report uncertain status without treating it as completed. No unrelated mail is moved.

## Validation and activation

Use local synthetic XLSX, fake Graph transport and isolated transactional database fixtures only. Cover authorization/no-RPC rejection, source validation, report parsing, preservation, protection, monotonicity, receipt replay, CAS races, publication gate, bounded Graph calls, and archive ordering. Run applicable existing checks and the configured suite, regenerate Supabase shared sources, then deterministic Graphify build/check once.

Deliver reviewable source and deployment instructions. Activation requires deploying the optional endpoint, a dedicated import secret, explicit start cutoff/date policy, Microsoft mailbox authorization and GitHub repository secrets, then one bounded supervised end-to-end test before enabling the repository variable. Do not activate an automation that cannot yet perform the complete workflow.
