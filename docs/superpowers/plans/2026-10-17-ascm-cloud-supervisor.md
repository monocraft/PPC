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

## Addendum plan: preferred ChatGPT cloud MCP route (prepared source)

**Goal:** Let the owner's connected ChatGPT cloud workflow submit a materialized monthly Outlook workbook through OAuth, retaining the existing import/publication/archive safety contract.

**Architecture:** A separate `ppc-ascm-mcp` Edge Function verifies managed same-project OAuth tokens and delegates to the existing `createAscmApi` in process. A managed Auth hook binds one preregistered owner/client to its exact resource audience; standalone Pages files handle memory-only login/consent. The existing JSON endpoint and GitHub runner remain separate.

**Spec:** The addendum in `docs/superpowers/specs/2026-10-17-ascm-cloud-supervisor-design.md` is binding. The source is now prepared and default-disabled. Runtime configuration, access approvals and end-to-end activation remain distinct gates.

**Additional constraints:** Exact pins/cutoff/origin/owner/client and limits are those in the spec. Use only managed token issuance; no default `authenticated` audience fallback, custom ASCM scopes, browser persistence, SMTP/invites, broad file-download origins or extra business RPC. No live calls in local checks. Existing task authorization covers reviewed source deployment; security-sensitive access/configuration requires action-time confirmation. No additional permission is inferred from this plan.

**Review focus:** Initial issuance versus refresh; hook isolation from regular PPC sessions; token-valid but wrong owner/client/resource; arbitrary/redirecting signed-looking download URLs; metadata byte counts differing from actual bytes; truthful mailbox evidence and cloud Archive capability.

### Task 5: Managed identity contract and isolated OAuth audience hook

**Files:** create `supabase/migrations/202610170002_ascm_oauth_binding.sql`, `supabase/functions/ppc-ascm-mcp/core.mjs`, `scripts/checks/ascm-mcp-core.mjs`, `scripts/checks/ascm-oauth-hook.mjs`; create the new function's `deno.json`/`deno.lock` with exact pins; later modify only its section in `supabase/config.toml`.

**Interfaces:** `createAscmMcpCore({env,fetchImpl,invokeAscm,now,cryptoImpl})` returns `{enabled,authenticate,getProfile,importReport}`. `authenticate(accessToken)` resolves `{subject,clientId}`; `getProfile(accessToken,args={})` accepts only empty arguments and resolves `{id}`; `importReport(accessToken,input)` accepts the exact envelope/workbook schema and resolves bounded receipt data plus `sourceMessageId`. Authentication performs real asymmetric signature verification and all spec claims. Managed `public.ppc_ascm_access_token_hook(event jsonb) -> jsonb` changes only matching owner/client `aud`; configuration is operator-owned, never tool input. Grant hook/schema execution only to `supabase_auth_admin`, revoke public/anon/authenticated access; preserve existing master RPC permissions.

- [ ] Before code, verify the pinned package exports and documented managed discovery/hook contracts using primary docs and local fixtures. Record the `claims.client_id` versus top-level sample discrepancy. Freeze one resource, owner/client pair and exact callback; missing production identifiers keep activation disabled, not guessed.
- [ ] Write/run RED tests with locally signed ES256/RS256 tokens: wrong signature/algorithm/issuer/audience/owner/client, expired/not-yet-valid, anonymous/direct-session/ID tokens all cause zero attachment/master calls. Matching tokens resolve only their signed identity. Confirm public discovery reveals no owner or secrets.
- [ ] Write/run RED isolated SQL-hook fixtures for initial and `token_refresh` issuance, missing/mismatched `user_id`/`claims.sub`, other clients, regular logins and complete claim preservation; only the exact owner/client gains the resource audience. Test permissions separately from business RPC.
- [ ] Implement the minimum hook and verifier with fixed trusted JWKS discovery/cache and sanitized auth challenges; run both checks GREEN. Do not install the hook or rotate signing keys. Record native `resource` handling as unproven and static client/resource binding as the documented choice.

### Task 6: Separate MCP adapter and bounded OpenAI file transfer

**Files:** create `supabase/functions/ppc-ascm-mcp/index.ts`, `core.mjs`, `http.mjs`, `bootstrap.mjs`, `scripts/checks/ascm-mcp-http.mjs`, `scripts/checks/ascm-mcp-application.mjs`; implement bounded download/import in the Task 5 `core.mjs` and extend its real crypto/fake transport checks. Modify `supabase/functions/ppc-master/gateway.mjs` only to export/reuse existing adapter construction if required, and modify `package.json` to include new checks.

**Interfaces:** `createAscmMcpHttpHandler({core,resource,issuer,createMcpHandler,McpServer,z}) -> (Request -> Promise<Response>)` wraps the core with SDK transport, OAuth metadata and tool schemas. Its server-only `invokeAscm` adapter calls `createAscmApi({env,database,now,dispatchPublication,validateManifest,validateReadableManifest})` without semantic changes. `get_profile({})`, `import_ascm_report({sender,subject,receivedAt,messageId,fileName,workbook})` and `report_connection_state({service,state})` are exposed, with schemas/annotations/scopes in the spec.

- [ ] Write/run RED real SDK protocol checks for discovery, auth challenges, tool descriptors/profile stability, rejected unknown tools/extra fields, and a write requiring validated request identity. Both tools use OAuth scope `email`; never trust a model-supplied user/client ID.
- [ ] Write/run RED fake-transfer cases: exact allowed origin/path, lookalike origins/userinfo/ports/encoded paths, unbounded/chunked 2 MiB overflow, non-200, redirect, expiry and timeout. Allow the known metadata209622/download209240 mismatch; digest actual bytes. Assert no auth headers, URL logging, raw attachment results or backend access on rejected files/envelopes/cutoffs.
- [ ] Write/run RED integration cases using generated XLSX, real strict parser/model and isolated RPC fixture: import and replay retain receipts, protected/incomplete/stale/malformed reports hold, CAS race does not replan in the call, pending publication never grants Archive. Existing JSON route regression checks remain green.
- [ ] Implement one stateless MCP server per request with the pinned SDK and in-process ASCM handler; no internal HTTP request and no duplicate transaction code. Enforce 32 KiB arguments, 16 KiB URL, 20-second download and actual 2 MiB file cap. Run new checks GREEN.

### Task 7: Standalone Pages login and managed consent

**Files:** create `public/ascm-connect.html`, `public/js/ascm-connect.js`, `public/css/ascm-connect.css`, default-disabled `public/js/ascm-connect-config.js`, and `scripts/checks/ascm-connect.mjs`. Parent integration separately vendors the exact pinned browser SDK plus license at a fixed same-origin path. No existing editing workspace entry point is replaced.

**Interfaces:** `createAscmConsent({authClient,location,navigate,config,onState})` manages login/details/approve/deny using only the same-project verified user session. Browser runtime uses the pinned Supabase SDK and a public publishable key, with persistence, auto-refresh and URL-session detection disabled. Parent configures the real public URL/key/client/callback allowlist through the existing release process. Only the server has the owner UUID authority; browser identity checks do not replace that gate.

- [ ] Write/run RED consent behavior cases: `authorization_id` survives memory-only login; mismatched verified identity/client cannot approve; no persistent storage or portfolio reads occur; missing/expired details show a recoverable error; explicit approve/deny navigate only to the exact registered callback returned by Auth. An already-approved redirect-only details response fails closed because it lacks trusted client identity. Never construct an authorization code or OAuth state.
- [ ] Implement a keyboard-accessible static page with clearly labeled permissions and explicit Approve/Deny. Match the existing PPC type/palette, honor reduced motion, and keep credentials in the form/session memory only. Owner account creation/password entry occurs in trusted Dashboard/browser UI, not chat/tools.
- [ ] Run checks GREEN and inspect the real local page at its Pages project-prefix path without loading or resetting an active editing workspace. Verify typed password/auth tokens are neither logged nor included in rendered error text.

### Task 8: Review, operator configuration and separate activation decision

**Files:** update `docs/ASCM-CLOUD-SUPERVISOR.md` with the preferred route and exact secure configuration checklist; update the Product Portfolio manager skill facts only after authorized implementation is verified. These files are future deliverables, not changed by the present addendum.

- [ ] Run all new checks and existing ASCM/model/gateway/Pages checks; run the configured full suite, Supabase shared parity check and Edge/Deno type/import check. Record exact locked versions and limitations; no production proof is inferred from fixtures.
- [ ] Obtain independent auth/SSRF/transaction review, repair material findings through RED/GREEN regressions, then deterministic Graphify build/check once after source checks. Documentation-only planning does not require rebuilding the graph or running the full suite.
- [ ] Give the parent a concrete reviewable configuration package: managed OAuth enabled, asymmetric keys inspected, one preregistered client/owner pair, exact callback/resource/audience hook, actual Pages consent URL, origin/path allowlist, cutoff/date policy and server-only import secret. No values enter chat or public code; existing publisher/master configuration is preserved. No DCR/key rotation/SMTP is enabled as a shortcut.
- [ ] Only after explicit approval, the parent installs/configures/deploys and runs one bounded supervised OAuth→Outlook file→import→receipt→publication→Archive test. Prove refreshed tokens retain client/resource binding and requested `resource` interoperates with managed Auth; record actual consent scopes and provider callback claims rather than fabricating metadata.
- [ ] Confirm the selected **cloud scheduler** supports the already connected HP WEB Outlook tools, file materialization, OAuth MCP and Archive while the PC is off. Without every capability, keep the schedule disabled and mail in Inbox. After a separate activation decision, schedule the exact monthly rules/cutoff and quiet notification policy; do not enable the GitHub runner too.

### Task 9: Minimal real ASCM activity in PPC (owner steering)

- [x] Add a separate supervisor field to existing presence without changing human roster/count or adding polling.
- [x] Start a private bounded attempt lease only during eligible authenticated imports; report actual validated planned product count; close only that attempt in finally.
- [x] Add top-right native clock and Users row with only Updating ASCM and optional product count. Idle is quiet; disabled hidden; expiry/disconnect/reduced-motion stop animation.
- [x] Verify real isolated SQL roles, lease expiry/concurrency, real XLSX count/cleanup and controller/DOM access races; inspect desktop/mobile synthetic UI.
- [ ] Run final configured suite/Graphify and release with default-off settings. Activation requires the real cloud workflow gate above.
