# SharePoint package delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish complete encrypted packages through the owner's existing SharePoint connection and automatically open their verified encrypted backend copy in PPC.

**Architecture:** GitHub Actions retains full archive projection/encryption and stages one private candidate. The authenticated hosted worker confirms exact SharePoint readback before a CAS advances the backend current pointer; existing browser package-service loading receives only that ciphertext.

**Tech Stack:** Existing Node 22 ESM/checks, Supabase Edge/Storage REST/PostgreSQL RPC/PGlite, pinned existing MCP SDK/zod, classic browser JavaScript and GitHub Actions; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-17-sharepoint-package-delivery-design.md`

## Global Constraints

- One private bucket `ppc-package-delivery`; each encrypted object is 36..67,108,864 bytes; current + one candidate/cleanup object = 128 MiB maximum. No backend decryption/new package key.
- Phases `legacy` (default), `seeding`, `sharepoint`; new routes/tools require `PPC_PACKAGE_DELIVERY_ENABLED=true` (default false). Old pipeline remains usable while default off.
- Fixed provider `sharepoint`, host `hp.sharepoint.com`, folder `/teams/PCGamingCategory/Shared Documents/Product Portfolio/PPC`; drive/folder IDs are private server configuration verified against the existing seed.
- Reservation lifetime 3 hours; binary upload/readback deadline 120 seconds; no signed WRITE capability; signed READ capability <=5 minutes. Expiry alone cannot release an unsettled upload slot. No recurring health/GC/browser polling.
- Existing publisher secret stages; exact owner/client/resource OAuth confirms; existing reader key hashes authenticate delivery. No Microsoft credentials/tokens cross these boundaries.
- Preserve accepted facts, full archive/owner metadata/pricing/receipts, local drafts/images, original checkout and unrelated files. No live calls, deployment, new permissions or dependencies during source implementation.

## Review Focus

- Same-revision owner image updates and lost acknowledgements must retain exact bytes and idempotent generation identity (Tasks 1/3).
- Crashed binary uploads, failed deletion and late concurrent uploads must not create unbounded objects or replace current (Tasks 1/2).
- A valid signed file URL must not be treated as proof of SharePoint provenance or as an upload file handle (Task 2).
- Old GitHub publication metadata must never permit the newly activated supervisor to archive mail (Task 2).
- An opening browser with stale snapshot, missing digest, pending edits or cancelled transfer must preserve its complete current workspace (Task 4).

## File ownership and parallel seams

Task 1 establishes the contract/migration first. Then lane A owns Task 2, lane B owns Task 3, lane C owns Task 4, without shared-file edits. Integrator owns Task 5 and registration in `package.json`; workers report required check entries instead of editing it. Read current AGENTS/manager guidance; Graphify query first, verify source. Do not edit presence/styles or ignored operations files.

### Task 1: Locked delivery contract and private transactional state

**Files:** create `supabase/functions/ppc-master/package-delivery-contract.mjs`, `supabase/migrations/202610170005_package_delivery.sql`, `scripts/checks/package-delivery-sql.mjs`, `scripts/checks/package-delivery-contract.mjs`.

**Interfaces:** export `MAX_PACKAGE_BYTES`, `validateCandidate(value)`, `validateReceipt(value,policy)`, `qualifiesSharePointPublication(publication,receiptRevision)`. Service-role RPCs: `ppc_package_reserve/upload_claim/upload_result/finalize/confirm/current/cleanup/phase(jsonb)`; phase is operator-only, never public/MCP. upload_claim returns a persisted attempt UUID; upload_result requires it. Candidate/Receipt follow spec; confirm returns `{status:'published'|'already_published'|'stale',publication}`. Private state_document adds `acceptedManifestSha256=encode(sha256(convert_to(manifest::text,'UTF8')),'hex')`; ordinary reserve recomputes/compares under the same row lock. Seed alone uses null manifestSha256. Expose only sanitized delivery identity publicly; no manifest/destination/capabilities. Keep legacy fields in legacy phase.

- [ ] Write `native_jsonb_manifest_digest`, `candidate_slot_and_generation`, `receipt_provider_gate`, `same_revision_owner_update`, `owner_commit_retry_identity`, `published_seed_with_newer_accepted_facts`, `seed_trusted_blob_mismatch`, `seed_cannot_qualify_archive`, `expiry_cleanup_lock`, `immutable_retry`. Assert native PGlite SHA-256/JSONB digest, same-transaction rejection of raced accepted export, seed digest null/trusted blob preservation, server-derived kind/no seed Archive even at equal revision, and queued B cannot satisfy A. Run checks and observe missing-contract/migration failure.
- [ ] Implement strict contract/RPCs with `ownerImagesCommit:40hex|null` in reservation equality, persisted upload ownership/uncertainty, immutable receipt uniqueness, phase guards and sole extra object slot. Seed only when current absent at the matching trusted published revision/blob; ordinary reservations bind current accepted export digest. Never replace accepted facts; reject legacy ack as qualifying. Expiry cannot clear unsettled uploads; uncertain absence holds for operator reconciliation.
- [ ] Run `node scripts/checks/package-delivery-contract.mjs` and `node scripts/checks/package-delivery-sql.mjs` with `PPC_REQUIRE_SQL_TESTS=1` and the existing isolated `PPC_TEST_PGLITE_MODULE`; require PASS including revoked public/anon/authenticated grants.
- [ ] Commit only Task 1 files with `feat: define private SharePoint delivery state` after review.

### Task 2 (lane A): Storage/API, OAuth worker tools and Archive gate

**Files:** create `supabase/functions/ppc-package/{index.ts,http.mjs,core.mjs,storage.mjs,hash.mjs,rpc.mjs}`, `scripts/prepare-package-delivery-deployment.mjs`, `scripts/checks/{package-delivery-api.mjs,package-delivery-storage.mjs,package-delivery-mcp.mjs}`. Modify `supabase/config.toml`, `supabase/functions/ppc-master/{gateway.mjs,ascm-api.mjs}`, `supabase/functions/ppc-ascm-mcp/{bootstrap.mjs,core.mjs,http.mjs,index.ts}`, `scripts/prepare-ascm-mcp-deployment.mjs`, `scripts/checks/{ascm-cloud-api.mjs,ascm-mcp-core.mjs,ascm-mcp-http.mjs,ascm-mcp-application.mjs,ascm-mcp-deployment.mjs}`. Do not reuse the old JSON gateway for large uploads.

**Interfaces:** consume Task 1 RPC/contracts. Produce `createPackageDelivery({env,database,storage,now}) -> {publisher,upload,getQueuedPublication,confirmPublication,reader,publicState}`; `createPackageDeliveryStorage({env,fetchImpl,now}) -> {uploadObject,openObject,signDownload,removeObject}`; `createCiphertextVerifier() -> {update(chunk),finish() -> {sha256,bytes,envelope}}`; `createPackageDeliveryRpc({env,fetchImpl})`. Separate function routes: publisher `POST /api/package/{current,reserve,finalize,seed}` <=32 KiB JSON, `PUT /api/package/candidates/<UUID>/bytes` authenticated binary with exact generation/length, and reader `POST /api/package/latest` `{key}`. MCP tools/signatures/destination/readback fileParams follow the spec.

- [ ] Write/run failing checks named `unauthorized_no_storage`, `binary_upload_fixed_key`, `finalize_actual_stream`, `readback_auth_and_provenance`, `legacy_ack_cannot_archive`, `reader_key_cors_abort`, `lost_confirm_retry`, `bounded_cleanup`. Assert URL-as-file is rejected, oversized/truncated/redirected streams fail, stale upload ownership cannot write/release a slot, no signed WRITE URL escapes, and default-off routes cannot mutate state.
- [ ] Implement streaming REST adapter and native incremental hash without decrypt/base64/whole-file buffering; wire exact publisher-secret/reader-key/OAuth boundaries in the separate function. Authenticate/claim before consuming binary body, use exact create-only Storage key and 120-second deadline, and recover uncertain uploads without releasing the slot solely on expiry. Do not issue service tokens or write capabilities to callers; verify actual REST streaming/create-only semantics from supplied local/official contracts, no guessed SDK call/live probe.
- [ ] Implement MCP queue/readback confirmation and qualifying receipt Archive gate; retain worker provenance boundary. Map private publisher export's backend `acceptedManifestSha256` without exposing it/full manifest/destinations/capabilities in public snapshot; preserve separate JS projected marker digest. Add explicit-auth/default-off function config; stage modules/contract to `.superpowers/deploy/package-delivery` and extend MCP staging. Preserve OAuth claim/refresh/security schemes.
- [ ] Run new checks plus `ascm-cloud-api`, `ascm-mcp-core`, `ascm-mcp-http`, `ascm-mcp-application`, `ascm-mcp-deployment`, `supabase-master` checks via `node scripts/checks/<name>.mjs`; require PASS. Canonical/staged Deno check must prove incremental hash import/runtime compatibility; unresolved behavior blocks release.
- [ ] Commit only lane A files with `feat: add verified encrypted package delivery API` after review.

### Task 3 (lane B): Actions producer using current cache archive

**Files:** create `scripts/package-delivery-client.mjs`, `scripts/checks/sharepoint-publisher.mjs`; modify `scripts/publish-supabase-master.mjs`, `.github/workflows/publish-master.yml`, `scripts/checks/{supabase-publisher.mjs,owner-image-publisher.mjs}`.

**Interfaces:** `createPackageDeliveryClient({endpoint,publisherSecret,fetchImpl}) -> {readCurrent,reserve,upload,finalize}` consumes Task 2 contracts; endpoint is fixed same-project `ppc-package/api/package`. Extend `createSupabasePublisher` with `publicationMode:'github'|'sharepoint'` and injectable delivery client. Every reservation/retry binds `ownerImagesCommit` to the requested existing imagesCommit or null. Workflow mode defaults `github`; explicit `--seed-delivery-cache` pins seed URL/hash/size. Publisher secret authenticates only this origin; signed READ omits it and package key. `sourceSha` retains the original trusted seed identity from existing export.

- [ ] Write/run failing `cache_is_archive_source`, `owner_images_same_revision`, `queued_owner_B_cannot_satisfy_A`, `full_archive_and_pricing_retained`, `uncertain_upload_recovery`, `no_git_tail_or_fallback`, `explicit_seed_only`, `seed_hash_is_64hex`, `seed_published_baseline_then_current_projection`, `seed_blob_revision_mismatch`, `legacy_default_unchanged`. Assert exact seed hash/size, published-vs-accepted revision distinction, A/B/null queue identity and all archive/image/pricing/conflict/receipt preservation.
- [ ] Implement binary PUT/current digest checks; reuse projection/decrypt/markers/encryption and replace only Git tail. Copy backend export `acceptedManifestSha256` into reservation; never reconstruct its PostgreSQL serialization or substitute JS projected marker digest. Ready is queued, never published. Retry/restart requires matching source/revision/digest/ownerImagesCommit; B never swallows A. Reuse exact encrypted candidate bytes, not re-encryption under its identity.
- [ ] Implement pinned seed path: assert exact digest is 64 lowercase hex, size/hash and native revision/blob identity match existing trusted GitHub publication record. Permit newer accepted facts without comparing old seed manifest to current export; retain sourceSha/seed-marker checks. Seed only archive/current ciphertext at published revision, never accepted-master bootstrap. Then project current accepted manifest before qualifying new-report Archive; a current receipt of kind seed forces a normal next-generation publication even when projected content is unchanged (cover this case). Hold older/unmatched seed rather than inventing identity. Keep legacy default/no new schedule.
- [ ] Run `node scripts/checks/sharepoint-publisher.mjs`, `node scripts/checks/supabase-publisher.mjs`, `node scripts/checks/owner-image-publisher.mjs`; require PASS, including same-revision and lost-reply cases.
- [ ] Commit only lane B files with `feat: stage SharePoint packages from current encrypted archive` after review.

### Task 4 (lane C): Browser binary service and provider-neutral integrity

**Files:** modify `public/js/{package-client.js,package-ui.js,app.js,master-client.js,master-ui.js}`, `scripts/configure-package-source.mjs`, `.github/workflows/deploy.yml`, `scripts/checks/{package-client.mjs,package-ui.mjs,package-workspace.mjs,master-client.mjs,master-ui.mjs,sharepoint-source.mjs,hosted-package.mjs}`; create `scripts/checks/package-delivery-browser.mjs`.

**Interfaces:** consume sanitized publication `{provider,kind,generation,candidateId,sha256,bytes,storageRevision,publishedAt}`. Preserve `PortfolioPackageClient.downloadLatest({...options,onIdentity?}) -> Uint8Array`; add `sha256(bytes)` and invoke `onIdentity` only after the spec's response identity headers match actual bytes. `package-ui` passes identity as `importProjectPackage(file,{...options,deliveryIdentity})`; `loadedPackageInfo` version 2 stores it, retaining legacy version-1/blob compatibility. Existing service config selects `PPC_PACKAGE_ENDPOINT=<same-project>/functions/v1/ppc-package/api/package/latest` and existing master endpoint; neither value is a signed URL.

- [ ] Write/run failing `service_binary_digest`, `stale_or_missing_identity`, `pending_draft_kept`, `cancel_keeps_images`, `legacy_import_compatible`, `no_added_requests` fixture checks; use isolated synthetic workspace/browser with outbound network blocked.
- [ ] Implement SHA-256 before package activation and matching snapshot identity when supplied; keep all transactional import/image remapping/busy/draft guards. Adapt Updates package freshness to generation/digest; keep legacy Git behavior in legacy mode and do not add polling.
- [ ] Validate service-mode public config; make service-mode Pages artifact omit stale package without deleting tracked historical package/history, and keep default legacy artifact checks unchanged. No MSAL configuration or navigation/style change.
- [ ] Run new browser check and each modified check via `node scripts/checks/<name>.mjs`; require PASS and actual fixture screenshot/interaction only if UI presentation changed.
- [ ] Commit only lane C files with `feat: open verified SharePoint delivery packages` after review.

### Task 5 (integrator): Whole-flow verification and guarded release instructions

**Files:** create `scripts/checks/package-delivery-integration.mjs`, `docs/SHAREPOINT-PACKAGE-DELIVERY.md`; modify `package.json`, `docs/ASCM-CLOUD-SUPERVISOR.md` and affected Product Portfolio manager references/snapshot after verified source changes. Reconcile lane interfaces without unrelated source edits.

**Interfaces:** real signed local owner/client/resource OAuth + fake bounded Storage/SharePoint artifact transport + required isolated PGlite drive reserve -> direct upload -> actual stream finalize -> queue -> readback -> CAS -> binary browser import -> ASCM Archive gate. Fixture transport blocks every unrecognized/external endpoint.

- [ ] Write/run failing integration for wrong owner/client/resource/expiry, no package secrets in connector requests, 64 MiB boundary streaming/cancellation, old Git ack, same-revision image update, DB save race, late upload/GC/delete failure, lost ack/restart, receipt replay and full-package image/pricing preservation; then reconcile only demonstrated gaps until PASS.
- [ ] Register new checks; run the complete configured check chain with required PGlite, source parity, canonical/staged Deno checks, independent security/source review, then exactly one deterministic `node scripts/graphify.mjs build` and `check`. Record actual results; no live health probes or repeated idle tests.
- [ ] Document exact gated cutover/rollback and cost/access changes: bounded Storage creation/policies, private IDs, flags/phase, freeze old publisher, pinned seed verification, new producer, service browser config, and no automatic Git fallback. Deployment approval must show the reviewable source/config diff and exact managed OAuth/Storage actions; owner enters any credentials/MFA in supported UI.
- [ ] Stop source work at the approved deployment gate. After separate action-time approval: deploy default off; verify Storage global file limit >=64 MiB (disclose/approve any change), actual initial/refreshed resource-bound OAuth, connector create/no-overwrite/version/file-handle behavior, and the approximately 45 MiB actual binary upload/readback against Edge 256 MB/2-second CPU/150-second idle limits. Confirm immutable SP receipt/current bytes before switching browser config; failure holds for reviewed transport redesign, no silent new service.
- [ ] Only after all preceding gates, run one explicitly chosen real monthly report through receipt -> qualifying SharePoint publication -> exact email Archive. Keep importer/scheduler disabled if any gate fails; separately authorize/enable the quiet PC-off schedule only after successful end-to-end evidence. Do not report activation from source/local checks/seed alone.
- [ ] Commit reviewed integration/docs with `test: verify SharePoint delivery boundaries`; maintain the existing PR attachment/release procedure. This plan itself authorizes no production action.
