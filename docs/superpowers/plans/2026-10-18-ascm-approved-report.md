# Approved Historical ASCM Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this single task. Steps use checkbox syntax for tracking. The parent owns independent review and release; this plan-authoring task writes documentation only and does not commit or implement.

**Source spec:** `docs/superpowers/specs/2026-10-18-ascm-approved-report-design.md` (commit SHA: `0c1985e886e00376b8a60677cb5820b166d82f9e`). This was also HEAD during verification; no intervening source drift was observed.

**Goal:** Permit the one owner-approved historical report through the native cutoff comparison for a bounded time while preserving every existing import, receipt, publication and Archive gate.

**Architecture:** Add one optional, absent-by-default `PPC_ASCM_APPROVED_REPORT` policy to the existing native HTTP worker and its Deno environment allowlist. Match the SHA-256 of the exact five-field source tuple and check the absolute expiry on each import/replay. Reuse existing crypto, timestamp parsing, request validation, lazy application factories and checks; add no endpoint, module, dependency or durable state.

**Tech stack:** JavaScript ESM, the existing Deno entrypoint, Node built-ins and existing local check scripts.

## Global Constraints

The general new-mail cutoff stays unchanged.

No new route, header, request field, SQL migration, grant or credential is needed.

Invalid, missing, oversized, unknown-field or expired policy grants no exception; ordinary eligible mail and publication operations continue normally.

Check expiry at request time, including replay, rather than caching an eligibility boolean when the worker is created.

No raw workbook or message identity belongs in public source or diagnostics.

Keep the hourly schedule off. Configure an expiry one day ahead for the approved test, then clear the policy after test completion or abandonment.

## File Structure

Modify production source only:

- `supabase/functions/ppc-ascm-flow/http.mjs` — optional policy parsing and the cutoff-only exception.
- `supabase/functions/ppc-ascm-flow/index.ts` — pass the optional policy through the native Deno environment allowlist.

Extend existing checks only:

- `scripts/checks/ascm-flow-http.mjs` — source-field binding, policy rejection, warm expiry, ordinary-mail preservation and unchanged downstream authority.
- `scripts/checks/ascm-flow-application.mjs` — refused historical requests preserve the zero-business-dependency boundary through the actual application.
- `scripts/checks/ascm-flow-deployment.mjs` — verify the actual environment-construction boundary and retain exact staged source/import parity.

No new test module or check-registry entry is required.

## Inherited from spec

These assumptions were verified at spec-write time and are inherited as ground truth:

- The cutoff exists solely in native worker `http.mjs:62-66` on this import path; `ascm-mail-policy.mjs` separately validates sender, month, timestamp and report filename without reading that environment setting. The exception therefore changes only native cutoff eligibility, not the master policy.
- Native initial import and fresh replay both call the same `/api/ascm/import` handler with the same `Report_payload`. One runtime predicate covers both consumers.
- The deployment entrypoint explicitly reads its Deno env names (`ppc-ascm-flow/index.ts:3-11`); a handler-only injected-env test cannot prove deployment wiring. Verify this static boundary as well as executable handler behavior.
- `createAscmFlowApplication` creates the handler once (`bootstrap.mjs:7-10`); `now` must be called for each request so warm instances do not retain expired authority.
- `validateAscmEnvelope` and the existing strict six-field request shape run before source matching. Preserve them, the workbook limit and canonical base64 checks. No raw workbook or message identity belongs in public source or diagnostics.
- Existing receipt/publication code permits a legitimate no-change receipt at current revision 82 and requires independent normal SharePoint coverage before Archive. The acceptance test must not manufacture a new revision to exercise a particular branch.

## Verified plan-level assumptions

All assumptions below were listed before this plan's verification reads. The table closes the complete set of newly introduced paths, symbols, commands, ordering and consumers.

| # | Category | Assumption | Evidence |
| --- | --- | --- | --- |
| 1 | Paths | The two production paths, three check paths and two native check paths exist; the requested plan path is new. | `Get-Item -LiteralPath` succeeded for all seven files and the plan directory; `Test-Path` for this plan returned `False` before writing. |
| 2 | Signatures | Existing factories accept the injected environment/clock/dependencies; the private input helper has one production caller. | `http.mjs:104` exports `createAscmFlowHttpHandler({env, invokeAscm, getPackageDelivery, invokeConnection, now})`; `bootstrap.mjs:6-12` passes those seams. Source search found only the `reportInput` declaration at `http.mjs:62` and call at `:149`. |
| 3 | Existing test seams | Reuse the current HTTP harness and application counters rather than a new harness. | `ascm-flow-http.mjs:31-44` already has `options.env`, receipt/status/publication overrides and a call log. Its clock is currently fixed at `:37`, so add only an optional test clock override for warm-instance cases. `ascm-flow-application.mjs:6-23` counts fetch/gateway/package/reporter initialization. |
| 4 | Commands | Existing direct Node commands are valid and registered. | `package.json:13` already includes HTTP/application/deployment/native-definition/native-outcome checks. Fresh baseline `node scripts/checks/ascm-flow-http.mjs` passed 12/12; `node scripts/checks/ascm-flow-application.mjs` passed. Both are local in-memory checks. |
| 5 | Entrypoint test | The real env-construction code can be executed with a local Deno/application shim without contacting Deno or Supabase. | Read `index.ts:1-12`: one static bootstrap import, then ordinary JavaScript env construction and `Deno.serve`. A fresh `node:vm` probe omitted only that known import, executed the remaining actual source, and observed `served:1`, `readCount:19`, `approvedForwarded:false`, `readApproved:false`. This is the pre-fix wiring failure the new assertion must catch. Existing `sharepoint-publisher.mjs:8,239` already uses `runInNewContext`. |
| 6 | Consumers | Preserve both exported factory signatures and change only private admission plumbing plus one native env key. | Full source search found the HTTP factory used by bootstrap and its HTTP checks; the application factory is used by index, application/deployment checks and package-delivery integration. Their `env` argument is optional and unchanged. `PPC_ASCM_APPROVED_REPORT` currently has no reader in `supabase/`, `server/` or `scripts/`. No MCP/master/Node consumer needs this setting. |
| 7 | Ordering and deployment | Tests can precede implementation; no new module, source target or manifest count is needed. | All proposed tests use existing constructors and fixtures. `prepare-ascm-flow-deployment.mjs:8-17` already stages `index.ts` and `http.mjs`; `ascm-flow-deployment.mjs:17-35,69-99` validates the 17-file closure, byte hashes and rewritten imports. Read-only inspection verified this command; it was not run during doc-only planning because it writes temporary staging files. |
| 8 | Fingerprint contract | The requested tuple order differs from the existing `MAIL_FIELDS` order and needs an independent fixed vector. | `http.mjs:8` orders sender/subject/time/message ID/name; the spec requires message ID first. A fresh Node SHA-256 probe over the existing synthetic report's exact tuple produced `5382371536c4a64c5550c4447fe21e363454068b27022064fdcaf333175e5ffb`. |
| 9 | Syntax and scope | The plan adds no unverified implementation code or command infrastructure. | It uses existing direct Node checks and behavioral steps only. Fresh `node --check` passed for production `http.mjs` and the application/deployment check files. The source patch is limited to the two named worker files and three existing check files. |

## Tasks

### Task 1: Implement and verify the bounded native cutoff exception

**Files:**

- Modify: `supabase/functions/ppc-ascm-flow/http.mjs:21-30,62-73,149`
- Modify: `supabase/functions/ppc-ascm-flow/index.ts:3-10`
- Test: `scripts/checks/ascm-flow-http.mjs`
- Test: `scripts/checks/ascm-flow-application.mjs`
- Test: `scripts/checks/ascm-flow-deployment.mjs`

- [ ] **Step 1: Add focused failing cases using the existing synthetic report and seams.** Add only the optional clock override needed by the current HTTP harness. Keep its forwarded-report assertion exact. Use a later cutoff to make the existing report historical, and use the independent fixed fingerprint above so a repeated field-order mistake cannot make implementation and tests agree incorrectly.

  | Case | Required observation |
  | --- | --- |
  | Historical report, exact two-key policy, matching fingerprint and future expiry | Reaches existing import/receipt handling; forwarded six-field payload and workbook-derived request ID stay unchanged. |
  | Each of message ID, sender, subject, received instant and filename changed separately | Refused with `archiveAllowed:false` and no delivery/import calls. Where possible use envelope-valid changes, including sender/subject case changes, so the fingerprint itself is exercised. |
  | Missing policy; invalid JSON; null/array; missing/extra keys; wrong types; invalid/uppercase hash; invalid/missing/past expiry; oversized text | Historical report remains refused; responses disclose no supplied policy/source values. |
  | A single reused handler before expiry, exactly at expiry and after expiry | First valid request reaches ordinary handling; the latter two refuse before business calls. A previously available receipt does not bypass this gate. |
  | Ordinary post-cutoff mail with the same malformed/expired/oversized optional policies | Original ordinary behavior is preserved. Malformed optional policy must not invalidate mandatory worker configuration. |
  | Matched policy with future received time, invalid envelope, invalid/over-limit workbook, wrong auth or forbidden origin | Existing refusal persists. Auth/route refusals still do not read the body. |
  | Matched source with a pending/review-held receipt, seed/old/foreign publication, or forged receipt | No new Archive authority. Existing fixed errors and independent normal-publication checks remain authoritative. |
  | Malformed optional policy during queue/read/confirmation operations | Existing routes retain their normal behavior; optional historical policy does not affect them. |

  Extend the application check with historical refusal cases using its existing throwing/counted fetch, gateway, package and reporter seams. Assert all four counts remain zero.

  In the existing deployment check, run the actual staged entrypoint's env-construction code with a local `Deno.env.get`/`Deno.serve` and application-factory shim, omitting only its already-verified sole import. Assert the synthetic policy value is read and forwarded. Retain the existing exact source/hash/import checks; do not add a new test harness or deployed file.

- [ ] **Step 2: Observe meaningful RED before production edits.** Run the three commands below. The exact historical positive case must fail because the current handler returns `ASCM_SOURCE_REJECTED`; the env-wiring assertion must fail because the entrypoint does not yet read the policy. Existing refusal/ordinary cases should remain green. Record actual failures, not merely nonzero exit status.

  ```powershell
  node scripts/checks/ascm-flow-http.mjs
  node scripts/checks/ascm-flow-application.mjs
  node scripts/checks/ascm-flow-deployment.mjs
  ```

- [ ] **Step 3: Make the smallest production change.** Read one optional `PPC_ASCM_APPROVED_REPORT` value only in the native worker. Reject raw policy text longer than a fixed 512-character bound before JSON parsing. Reuse `strict`, `parseAscmInstant` and existing SHA-256 support; require exactly the two keys, a lowercase 64-hex digest and a valid explicit expiry. Parse failure grants no exception without invalidating ordinary worker configuration.

  Preserve `reportInput`'s strict body/envelope validation. Compute the current instant for each import and retain invalid-clock/future-mail refusal independently. Only the old/equal-cutoff branch may compare the exact ordered source tuple and unexpired policy. Continue through the existing base64/workbook/request-ID code and unchanged receipt/publication logic. Do not introduce a cached eligibility Boolean, export a new public helper, alter auth, or treat the policy as receipt/Archive authority. Add the exact env name to the native `index.ts` allowlist; leave other ingress/configuration modules untouched.

- [ ] **Step 4: Run focused GREEN and the retained native gates.** Run each command independently and inspect the complete result. The deployment check writes and cleans its own isolated temporary staging directory; it performs no deployment or live access.

  ```powershell
  node scripts/checks/ascm-flow-http.mjs
  node scripts/checks/ascm-flow-application.mjs
  node scripts/checks/ascm-flow-deployment.mjs
  node scripts/checks/native-ascm-flow.mjs
  node scripts/checks/native-ascm-outcomes.mjs
  node --check supabase/functions/ppc-ascm-flow/http.mjs
  git diff --check
  ```

  Confirm the source diff changes only the two worker files and three check files. The native source and payload must remain unchanged. No SQL suite, Graph API call, Supabase probe, recurring task, secret read or live test is part of these commands. The parent performs the final Graphify refresh/check once after final source changes under the existing project workflow.

- [ ] **Step 5: Hand the concrete patch to the parent for independent review and release.** Supply the diff, exact RED/GREEN results and any limits. Reconcile any fixes from the concurrent design review before execution or release; this plan is anchored to the stated spec commit. The parent owns source commit/push, deployment parity and the already-approved bounded native test. This planning assignment must leave the plan uncommitted.

  Root release constraints remain those in the spec: obtain the actual immutable ID without substituting an OWA-derived ID; require a unique selected message; configure the exact source fingerprint and one-day expiry; keep the publisher disabled except for a reviewed-branch pending-publication dispatch, then disable it before replay; let fresh receipt/normal-publication/exact-message readback govern Archive. Clear the policy and restore temporary native query/metadata changes after completion or abandonment. Do not fabricate a new accepted revision for a no-change report, activate hourly scheduling, or treat this bounded test as global SharePoint source-cutover proof.
