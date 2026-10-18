# SharePoint publication and PPC package delivery

The owner selected SharePoint as the package destination and an encrypted copy in the existing backend so PPC can open it automatically. GitHub continues to host the website/code and produce encrypted packages. This document describes the prepared cutover; it is not evidence that the new path or supervisor is active.

## Current evidence

The live GitHub package was copied byte-for-byte to the existing approved SharePoint `master_ppc.pkg` on October 17, 2026. Actual raw SharePoint readback matched 45,439,227 bytes and SHA-256 `d1af8e0e7fd1782a2b52433a38b62db227cc42a999179fb3ddd7d7d2bee1b7e2`; version 4.0 retained the earlier versions. No decryption, package key change or accepted-data replacement occurred. This initial copy does not switch PPC's source.

One authorized hosted test verified the owner's existing Outlook/SharePoint profiles, sandbox execution and an actual benign SharePoint file download with matching hash. It did not import reports, upload a package, archive an email, authenticate the PPC custom MCP or create a schedule. These remain separate release gates.

## Publication and delivery

1. The existing trusted Actions producer reads the current encrypted backend archive and the current accepted manifest. It preserves the complete archive, images, owner metadata, prices and receipts, projects accepted changes and encrypts with its existing key.
2. It reserves one immutable candidate, then streams ciphertext through the separate publisher-authenticated binary endpoint. The backend validates the stored envelope, exact size and SHA-256 before marking it ready.
3. The hosted worker retrieves the sole ready candidate, downloads it into a real sandbox file and creates the fixed candidate filename in the approved SharePoint folder. It reads that exact item back through the connected SharePoint tool.
4. The OAuth PPC confirmation tool checks the downloaded bytes, pinned destination and candidate generation. An atomic compare-and-swap records the immutable SharePoint receipt and advances the current encrypted object. A later accepted revision can remain pending.
5. PPC sends its existing package access key to the fixed package-service endpoint over TLS. It checks the returned ciphertext's SHA-256, size and generation identity before transactional import. Pending edits, busy workspaces, cancellation and images retain their existing protections.
6. The ASCM tool permits Archive only after its immutable accepted import receipt is covered by a qualifying normal SharePoint publication. A queued candidate, initial seed, old GitHub acknowledgement or failed check cannot qualify.

The authenticated worker supplies the SharePoint item/version provenance. A signed raw-file URL establishes byte transport; it does not independently attest the SharePoint destination. Never replace a sandbox file handle with a URL string or describe that URL as cryptographic SharePoint proof.

## Access, retention and cost

- Microsoft authentication remains inside the owner's existing ChatGPT connections. No token is exported to PPC, Actions or the browser; no new Microsoft application is introduced.
- The existing publisher secret authorizes only fixed-package control/upload/current-read operations. The owner's resource-bound PPC OAuth token authorizes the narrow hosted tools. The existing reader key authorizes only current ciphertext delivery. Service-role credentials remain server-side.
- The private `ppc-package-delivery` bucket holds one current object plus at most one candidate or object awaiting cleanup. Each object is at most 67,108,864 bytes, for a maximum of 128 MiB of retained ciphertext. Immutable receipt metadata is retained separately.
- This is an encrypted mirror with storage and transfer usage. Producer reads, cloud download/readback and browser opening also consume requests/egress. No dollar amount is assumed.
- Binary uploads have no signed write capability. A reservation expires after three hours, but expiry alone cannot release an unsettled upload. Uncertain transfers/deletes hold the extra slot for reconciliation. Cleanup occurs on a real operation, without a new watcher or polling schedule.

## Reviewable activation sequence

Complete local source verification before live configuration. Keep the importer and schedule disabled throughout the following checks.

1. Review the exact migration/function/frontend diff and retained rollback source. Obtain action-time approval for the managed OAuth server/client/hook, any new credential/access policy and the private Storage configuration. The owner enters passwords, MFA and new credentials in supported UI.
2. Deploy the reviewed functions with delivery/MCP/import/status features disabled. Apply only the reviewed migrations. Provision or verify the fixed private bucket, 64 MiB object limit, octet-stream MIME and absence of matching public/anon/authenticated policies. Activation conservatively rejects Storage object policies granted to those roles or roles they inherit, even a policy apparently limited to another bucket; it leaves policies untouched and holds for a reviewed reconciliation. Confirm the project's global file limit is at least 64 MiB; disclose and approve any required change.
3. Configure the exact owner/client/resource OAuth binding, approved SharePoint drive/folder IDs and existing publisher/reader authorities. Verify initial and refreshed tokens in the actual hosted context. Install/connect the remote PPC MCP through the supported cloud plugin flow; local Codex MCP settings do not make it available to hosted Work.
4. Freeze legacy package publication for the bounded cutover and enter `seeding`. Keep ordinary publication suspended while selecting the producer's `sharepoint` transport for the explicit seed operation (`PPC_PACKAGE_PUBLICATION_MODE=sharepoint` and `--seed-delivery-cache`, or its dedicated dispatch input). Do not combine seed and bootstrap. Validate the pinned live bytes, native package marker/revision and actual Git blob against the existing trusted published record. An older seed initializes only the archive baseline; it must never overwrite newer accepted facts.
5. Exercise the approximately 45 MiB binary upload through deployed Edge/Storage, real hosted download/upload/raw readback, immutable receipt and current delivery. Measure the documented Edge CPU/memory/timeout limits; a local streaming check is not production performance evidence. Verify connector no-overwrite/version/file-handle behavior and recovery after an uncertain result before unattended use.
6. Select `sharepoint` phase and producer mode, then produce an ordinary next-generation publication from the current accepted export. Even unchanged content requires an ordinary receipt when the current receipt is a seed. Confirm exact current ciphertext/receipt before selecting the browser service endpoint and omitting the stale package from the Pages artifact.
7. Run one explicitly chosen real monthly report through accepted receipt → qualifying SharePoint publication → exact-message Archive. After that succeeds, create and enable the authorized quiet cloud schedule. Verify its first scheduled execution has the same tool availability and permitted actions before declaring unattended operation while the PC is off. Complete any required action-time access approval before granting new permissions.

The phases are `legacy` (default), `seeding` and `sharepoint`. New delivery routes/tools require `PPC_PACKAGE_DELIVERY_ENABLED=true`; source deployment alone does not enable them. Browser configuration uses the fixed same-project `/functions/v1/ppc-package/api/package/latest` endpoint, never a signed download URL.

The supervisor UI shows its bot face in Users. The adjacent key and alert dot appear only when the existing Microsoft connection needs refreshing; the key opens the handoff on demand. There are no visible supervisor/name/status/reconnect labels. The top-right activity appears as `Updating ASCM`, with an actual affected-product count when available. This presentation does not imply that a disabled or unconfigured cloud job is running.

## Failure and rollback

Leave the exact email in Inbox on import, access, publication, readback or Archive failure. Retry the immutable request/candidate identity; do not re-encrypt under an existing identity, overwrite current SharePoint bytes, discard accepted facts or count a queued package as publication. A pending owner-image candidate for commit B cannot satisfy a request for commit A.

Pause new imports/publications before a reviewed rollback. Preserve accepted state, immutable receipts, current/candidate ciphertext and historical tracked packages. Do not switch automatically back to GitHub or restore the seed over current data. Reverting functions, phase or browser configuration requires a consistency check against the last accepted revision and publication identity. Reconnecting Microsoft restores the user's existing connection; it cannot repair an unrelated backend failure.

Official platform references: [hosted scheduled tasks](https://learn.chatgpt.com/docs/automations), [remote MCP in hosted Work](https://learn.chatgpt.com/docs/extend/mcp), [cloud security](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-cloud-security), [Edge limits](https://supabase.com/docs/guides/functions/limits), [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits). An ordinary hosted test does not establish recurring execution.
