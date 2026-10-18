# Native Copilot ASCM Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the secure native Copilot Studio integration and verify the actual cloud ASCM-to-PPC publication/Archive cycle.

**Architecture:** A dedicated default-off Edge adapter reuses PPC's native importer and package delivery core. A native scheduled flow uses its approved Microsoft connections and a narrowly scoped PPC credential; all data validation and receipts remain in PPC.

**Tech Stack:** Existing JavaScript/TypeScript Edge functions, Node checks, PGlite, Copilot Studio normal agent flows, native Outlook/SharePoint.

**Spec:** `docs/superpowers/specs/2026-10-17-copilot-ascm-worker-design.md`

## Global Constraints

- Preserve protected fields, unrelated drafts/data, immutable receipts and existing OAuth.
- Default disabled, server-only, separate worker credential; no broad new Microsoft permissions.
- Maximum 3 MiB JSON / 2 MiB decoded workbook; 67,108,864-byte ciphertext and 120-second stream bounds.
- Only monthly published HyperX mail from linny.chen@hp.com, strictly after configured cutoff.
- Actual normal SharePoint publication plus native receipt is required for exact-message Archive.
- No unrelated live probes, recurring health polling, business-mail forwarding or package decryption.
- Keep Studio Off until capacity, policy, transport, security and real end-to-end gates pass.

## Review Focus

- Lost confirmations after pointer advance remain exact idempotent retries; never publish stale queued candidates.
- Auth/default-off/origin/path rejection performs zero body, master, Storage or RPC work.
- A forged native published response or seed/legacy state never independently grants Archive.
- Raw truncated, oversized, stalled or cancelled readback never creates a receipt; request hashing is incremental.
- Microsoft metadata IDs/version drift and mismatched readback remain holds; actual SharePoint provenance is verified in native-flow wiring, not independently attested by equal ciphertext.

### Task 1: Native worker API and isolated integration

**Files:**
- Create `supabase/functions/ppc-ascm-flow/http.mjs`, `bootstrap.mjs`, `index.ts`, `deno.json`.
- Modify `supabase/functions/ppc-package/core.mjs` with narrow queued metadata/open methods.
- Create `scripts/checks/ascm-flow-http.mjs`, `scripts/checks/ascm-flow-application.mjs`.
- Extend `scripts/checks/package-delivery-integration.mjs` and `package.json` check command.
- Modify `supabase/config.toml` for explicitly verified worker-secret authorization.

**Interfaces:**
- Consumes native `createMasterGateway`, `createPackageDelivery`, `createAscmConnectionReporter`, `createCiphertextVerifier` and mail-policy validators.
- Produces `createAscmFlowHttpHandler({env,invokeAscm,getPackageDelivery,invokeConnection,now})` and `createAscmFlowApplication({env,fetchImpl,now,gatewayFactory,packageDeliveryFactory,connectionReporterFactory})`.
- Package core produces `getQueuedPublicationMetadata()` without signed URLs and `openQueuedPublication({candidateId,generation},{signal})` returning a verified binary Response. Existing methods unchanged.
- Confirmation headers: `X-PPC-Package-Generation`, `X-PPC-SP-Drive-Id`, `X-PPC-SP-Folder-Id`, `X-PPC-SP-Item-Id`, `X-PPC-SP-Version-Id`, `X-PPC-SP-File-Name`; canonical bounded text, no caller digest.

- [x] Write route/auth/default-off and cutoff tests; run and observe missing behavior fail.
- [x] Implement only the scoped HTTP contract and lazy application composition; keep import credential server-side.
- [x] Test 200/202/held/error receipt sanitization, exact digest/message binding, legacy/seed Archive denial and independent current normal-publication check.
- [x] Add core queued metadata/open tests: no signed URL leakage, current/history denial, exact identity, expiry, raw envelope/hash/length/cancellation; observe failure before code.
- [x] Add raw confirmation tests including an actual generated 45 MiB fixture, full 64 MiB bound, truncation/stall/abort, historical confirmation replay and no digest-as-proof path.
- [x] Extend actual PGlite integration with native worker transport, generated XLSX, native acceptance/publication receipt, protected browser workspace and final exact-message gate.
- [x] Run focused tests plus existing MCP/package/import regressions, then commit only verified source/tests.

### Task 2: Deployable source and native flow assembly

**Files:** Create `scripts/prepare-ascm-flow-deployment.mjs`, its focused check, and `docs/ASCM-COPILOT-FLOW.md`; update existing ASCM supervisor documentation with current selected route.

**Interfaces:** Consume Task 1 routes/headers. Produce a self-contained source manifest/staged directory using existing canonical master/package files, and exact native flow action/condition configuration.

- [x] Test a temporary deployment stage with source-file hash mapping and rewritten relative imports; run fail first, implement preparer, verify no credentials included.
- [x] Validate canonical/staged Deno sources with the existing frozen runtime and reviewed source bundle method; add configured project check.
- [x] Document exact actions, binary token wiring, create-only REST operation, metadata/version checks, secure history settings, retry rules and recovery links.
- [x] Assemble the existing Studio draft using supported UI authoring. Save only; preserve plan, approved connections and Off state. Do not silently add a new flow or agent.
- [x] Run local configured checks, deterministic Graphify build/check once, and independent source/security review. Resolve substantive findings before deployment.

Task 1 and 2 completion is source/draft preparation only. The saved native main
flow remains unpublished and Off with no runs. Separate announced manual test
assets proved small binary transfer, collision refusal, and actual RESTv2 item
and version metadata; package-scale native execution remains a Task 3 gate.

### Task 3: Bounded production integration and verified activation

**Consumes:** Reviewed Task 1/2 artifacts, actual environment capacity/policy, owner-entered worker credential, existing approved backend and SharePoint destination.
**Produces:** Actual cloud schedule, confirmed normal publication and exact-email Archive evidence.

- [ ] Confirm required capacity and DLP; existing maker access does not prove funding. No billing setup or purchase without explicit approval.
- [ ] Prepare reviewed source release and bounded rollback artifacts; deploy only necessary new/changed functions and preserve existing configuration/data.
- [ ] Obtain action-time security confirmation and secure owner credential entry where required, only after concrete reviewed result is ready.
- [ ] Prove create-only native binary fixture upload/readback and actual package-scale transfer; stop on metadata or byte mismatch.
- [ ] Complete required producer/cutover and protection/cutoff decisions without changing accepted facts or weakening date holds.
- [ ] Run one chosen real monthly report; verify native accepted receipt, actual normal SharePoint readback/publication and exact Archive outcome.
- [ ] Enable hourly native cloud schedule; verify first genuine scheduled trigger/run and quiet idle behavior without PPC polling.
- [ ] Update manager knowledge and final activation evidence. Mark full goal complete only when every objective requirement is proved.
