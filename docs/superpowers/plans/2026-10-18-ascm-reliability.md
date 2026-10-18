# ASCM Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task by task. Steps use checkbox syntax for tracking.

**Goal:** Make the existing ASCM supervisor safely recover ordinary interruptions and reject fragile deployments before unattended production.

**Architecture:** Keep native Outlook/SharePoint operations in the existing Copilot flow and durable acceptance/publication authority in the existing private backend. Add fenced recovery, replay-safe bounded retries, and one validated nonsecret flow definition. Preserve safe holds for ambiguous writes and revoked access.

**Tech Stack:** JavaScript ESM, PostgreSQL/PGlite, Supabase Edge Functions, Copilot Studio workflow definition, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-18-ascm-reliability-design.md`

## Global Constraints

- Preserve keys, existing Microsoft connections, accepted facts, receipts, private packages, and the 128 MiB retained ciphertext cap.
- No idle backend calls, new grants/credentials/billing, or additional UI labels.
- Never infer upload absence from timeout, expiry, or 404; never overwrite staged/final SharePoint files.
- Archive requires fresh normal publication coverage for the exact immutable report.
- Main hourly flow remains Off until all release gates pass.

## Review Focus

- Old producer upload claims racing replacement must be fenced under database locks (Task 1).
- Positive expired-object reconciliation must reject wrong attempt/digest and retain missing or partial objects (Task 1).
- Ready R while accepted R+1 must drain without falsely publishing or archiving R+1 (Tasks 2, 3).
- Lost mutation replies require identity-bound outcome checks, not blind mutation retries (Task 3).
- Generated and deployed flow drift, bootstrap residue, and accidentally persisted secrets must fail release preflight (Tasks 3, 4).

### Task 1: Fenced backend candidate recovery

**Files:** `supabase/functions/ppc-package/core.mjs`, new forward migration, focused package-delivery SQL/API/integration checks.

**Interfaces:** Publisher current adds `queuedUploadState` as an allowlisted enum or null, without attempt IDs or new authority. Reserve keeps its existing exact request shape; a newly validated accepted reservation may retire only a queued reserved candidate in `none` or settled `absent`, under delivery/candidate locks. Cleanup may positively reconcile full matching ciphertext for an uploading/uncertain attempt using existing private authority, then remove/acknowledge the same cleanup object; no new public route or grant.

- [ ] Add failing local SQL tests for unclaimed replacement, old claim fencing, claim-wins hold, and wrong/stale accepted metadata.
- [ ] Add failing API tests for exact expired-object recovery, missing/partial/wrong data hold, and cleanup acknowledgment loss replay.
- [ ] Run the checks and confirm meaningful RED failures.
- [ ] Implement the minimum forward migration and core recovery, preserving all old invariants.
- [ ] Run required isolated PGlite plus focused API/integration checks; report exact commands and results for independent review.

### Task 2: Restart-safe event-driven producer

**Files:** `scripts/publish-supabase-master.mjs`, `scripts/package-delivery-client.mjs`, focused producer/client/workflow checks, `.github/workflows/publish-master.yml`.

**Interfaces:** Consume Task 1 `queuedUploadState`; ready candidates return their persisted revision/identity before latest-export matching. Only an unclaimed/settled-absent reserved candidate may proceed to build a fresh ciphertext and reserve a fresh identity. Claimed/uncertain candidates use positive finalize recovery or hold. Client retries only replay-safe operations with a fixed finite budget and injectable wait; mutations without idempotence remain one attempt.

- [ ] Write RED tests for ready R/newer R+1, unclaimed restart with new ciphertext/ID, claimed hold, transient retry budget/Retry-After, auth no retry, and no upload mutation retry.
- [ ] Implement the client and producer behavior with safe stage/code diagnostics.
- [ ] Remove the recurring publisher cron and adjust event-only workflow expectations.
- [ ] Run focused checks and report results for independent review.

### Task 3: Canonical native flow and outcome recovery

**Files:** new nonsecret flow artifact/generator/validator and focused checks under existing scripts/docs conventions; use saved noncredential checkpoints only as input. Do not inspect/export the owner credential node.

**Interfaces:** Produce an import-neutral canonical production definition with an opaque credential reference and separately documented existing connection bindings. Validator accepts a nonsecret definition and reports only fixed action/path/code diagnostics; reject any literal credential. Root will use its field-level change manifest for native UI and readback comparison.

- [ ] Assemble the complete production definition from saved reviewed noncredential fragments and corrected Hour/1 concurrency-1 recurrence.
- [ ] Add RED tests for copied alias errors, wrong-scope/runAfter, string objects/booleans, wrong connector schemas, insecure history/binary conversions, unexpected destinations, parallel reports, bootstrap residue, and secret literals.
- [ ] Keep unique candidate-prefixed GUID staging, one binary create attempt, and exact actual-byte stage readback after succeeded/failed/timed-out creation before promotion. Do not claim deterministic cross-run create-only staging without supported mechanics; record orphan-stage hygiene as a residual limit. Preserve final readback after failed/timed-out promotion.
- [ ] Make same immutable-ID GET run after succeeded/failed/timed-out move; require the fresh publication gate, exact pre-move identity, attempted move, and exact Archive readback rather than a successful move reply alone.
- [ ] Permit draining an older valid ready candidate without granting the current report Archive; add replay-safe bounded native retries only to safe reads/import/confirmation.
- [ ] Run focused validator and failure-injection checks; report a precise field-level deployment manifest and any unsupported packaging mechanics.

### Task 4: Integration, independent review, and deployment proof

**Files:** check registry, `docs/ASCM-COPILOT-FLOW.md`, affected manager skill facts/references and verification snapshot, ignored operational ledger/artifacts.

- [ ] Independently review each task against spec and concurrency/Archive safety; resolve material findings.
- [ ] Run all canonical checks with `PPC_REQUIRE_SQL_TESTS=1` and local PGlite; build/check Graphify once after final source changes.
- [ ] Commit/push reviewed changes on the existing branch/PR; prepare only source changes needed for necessary bounded deployment.
- [ ] Apply forward SQL/backend/native changes with source/ZIP and normalized nonsecret readback parity. Keep credentials opaque.
- [ ] Perform only bounded approved interruption-verification operations needed for release; preserve the normal generation-2 revision-82 proof and keep hourly Off until actual report/Archive validation passes.
- [ ] Update exact current deployment/activation evidence and report remaining external holds honestly; do not claim the whole original goal complete while report/Archive/hourly/source-cutover gates remain.
