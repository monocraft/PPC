# ASCM cloud supervisor implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Prepare an unattended monthly ASCM mail import API and cloud runner that archive only after confirmed publication.

**Architecture:** Add an optional narrowly authenticated gateway operation; reuse the pure parser and transactional master model. A disabled-until-configured GitHub cloud workflow calls the API using mailbox-scoped Graph credentials.

**Tech Stack:** Existing JavaScript ESM, Node 22, Supabase Edge Functions, native master RPC receipts, Microsoft Graph, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-17-ascm-cloud-supervisor-design.md`

## Global Constraints

- Monthly published reports only from linny.chen@hp.com; no weekly review mail.
- Work while owner PC is off; cloud workflow is gated by PPC_ASCM_ENABLED=true.
- No live Supabase or Graph calls during implementation/tests, no deployment/activation or secrets disclosure.
- Preserve original dirty checkout, all assets, accepted facts and unrelated user drafts.
- No archive until native receipt and publication revision confirm success; atomic report application.
- Fail closed for unknown date protection and ambiguous matches; do not replan within an API request after a CAS race.

## Review Focus

- Same workbook retried after a lost reply must not publish twice.
- An accepted import with delayed publication cannot archive mail.
- A source category relocation cannot silently omit or misapply changes.
- Graph pagination/redirects cannot send credentials to another origin.
- Existing device-local date protection cannot be bypassed by empty cloud defaults.

### Task 1: Pure ASCM transaction planner

**Files:** create `supabase/functions/ppc-master/ascm-plan.mjs`, `scripts/checks/ascm-cloud-plan.mjs`.

**Interface:** export `planAscmImport({manifest,dataset,reportDate,importedAt,requestId,datePolicy})` returning `{manifest,changed,savedFields,savedProducts,summary}`; export `AscmReviewError` with code/details. Use global ASCMImporter and PortfolioMasterModel loaded through existing shared copies. No network or environment access.

- [ ] Write/run a failing real-model synthetic check for safe import, additions, data/order preservation, malformed/ambiguous input, stale reports and date protection.
- [ ] Implement planner via canonical changes plus narrowly scoped ASCM metadata; no raw arbitrary field replacement.
- [ ] Run check to green and existing ASCM/master-model checks.

### Task 2: Mail policy, Graph runner and cloud workflow

**Files:** create `supabase/functions/ppc-master/ascm-mail-policy.mjs`, `server/ascm-supervisor.mjs`, `scripts/checks/ascm-supervisor.mjs`, `.github/workflows/ascm-supervisor.yml`.

**Interface:** export `validateAscmEnvelope({sender,subject,receivedAt,messageId,fileName})` returning `{reportDate,publicationMonth}` or throwing; runner exports `runAscmSupervisor({env,fetchImpl,now})` and returns sanitized counts. Backend returns archiveAllowed/storageRevision/requestId/status/summary.

- [ ] Write/run failing synthetic transport checks: monthly filter, cutoff, no backend for no mail, pinned pagination, attachment limits, archive only after receipt/publication, retry/no send/delete.
- [ ] Implement app-only token acquisition, Inbox-scoped bounded reads, attachment retrieval, API submission and verified Archive move. Default CLI does nothing without complete configuration.
- [ ] Add hourly workflow gated on repository variable, least privilege contents:read and concurrency cancel-in-progress:false; no payload artifacts/logs.
- [ ] Run checks to green.

### Task 3: Optional gateway operation and integration

**Files:** create `supabase/functions/ppc-master/ascm-api.mjs`, `scripts/checks/ascm-cloud-api.mjs`; update `gateway.mjs`, `index.ts`, `scripts/build-supabase-master.mjs`, `package.json`.

**Consumes:** planner and mail policy from Tasks 1/2. API exported factory `createAscmApi({env,database,now,dispatchPublication,validateManifest})` returns Request-to-Response handler; auth via dedicated secret, no package/publisher secret in job.

- [ ] Write/run failing API checks against real parser/model and isolated native-RPC fixture: no RPC when unauthorized, valid XLSX commit, immutable replay, race hold, publication gate, size/source validation and old routes unchanged.
- [ ] Implement bounded request decoding, parser invocation, date policy parsing, native receipts/CAS, post-commit readback and numeric publication gate; wire optional route without changing existing operations.
- [ ] Regenerate parser shared copy and verify parity. Add checks to configured suite.
- [ ] Run complete configured suite locally with required PGlite if available; record all failures explicitly.

### Task 4: Review and handoff

**Files:** create `docs/ASCM-CLOUD-SUPERVISOR.md`; update relevant Product Portfolio skill facts after verified behavior.

- [ ] Document exact deployment, server/Graph/repository secrets, mailbox-scoped authorization, protection/start cutoff and activation gates; no secret values or live test.
- [ ] Obtain independent whole-change security/correctness review; fix material issues with regression checks.
- [ ] Run relevant final checks, deterministic Graphify build/check once, and report source readiness separately from cloud activation.
