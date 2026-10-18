# ASCM Review Reason Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source spec:** `docs/superpowers/specs/2026-10-18-ascm-review-reason-design.md` (uncommitted at plan-write time; repo HEAD = `87eb0408c707c3f3a0922540f448da1b3f9a9d86`). The parent will complete fresh design review and commit the spec before execution.

**Goal:** Expose the first actual planner hold as one safe optional enum in the existing authenticated held response, preserving all protection checks and Archive authority.

**Architecture:** Export one frozen `ASCM_REVIEW_REASONS` array beside `AscmReviewError`. The API admits only genuine typed errors with approved codes; the native proxy independently admits only an approved reason on an original upstream 409 / `ASCM_REVIEW_REQUIRED`. No other response path changes.

**Tech stack:** Existing JavaScript ES modules, Fetch `Request`/`Response`, Node assertion scripts and `node:test`; no dependency or schema changes.

## Global Constraints

“For an absent, unknown or non-string reason, omit the property. Do not coerce it, emit a fallback reason, or echo an arbitrary code.”

“Never return `error.details`, raw exceptions/messages, product IDs, source rows, field/date values, workbook bytes, master data, keys or URLs as part of this diagnostic. Keep current generic public error text.”

“`reviewReason` is diagnostic information only and must not select a retry, bypass or Archive path.”

“No new module, endpoint, environment setting, dependency, database operation, migration, log or native-flow action is needed.”

## Review Focus

The task's test matrix covers the relevant uncovered input classes: genuine versus lookalike errors, unknown/non-string reasons, exact versus normalized upstream status, unrelated outer codes, and extra private fields. No additional review-only scenario is introduced.

## File Structure

- Modify: `supabase/functions/ppc-master/ascm-plan.mjs` — the one frozen approved-reason export; planner behavior unchanged.
- Modify: `supabase/functions/ppc-master/ascm-api.mjs` — optional sanitized reason on its existing typed review-error response.
- Modify: `supabase/functions/ppc-ascm-flow/http.mjs` — independent exact upstream status/code/reason gate.
- Test: `scripts/checks/ascm-cloud-api.mjs` — actual planner holds and API error sanitization.
- Test: `scripts/checks/ascm-flow-http.mjs` — all approved reasons plus refusal/omission matrix.
- Test: `scripts/checks/ascm-flow-deployment.mjs` — frozen export and import within the existing source closure.

## Inherited from spec

These assumptions were verified by thorough-brainstorming and are trusted here, not re-verified:

- The complete set of current planner holds is the twelve-string enum. An in-memory Node source probe enumerated every literal `fail(...)` code in `ascm-plan.mjs` and found exactly twelve unique members. The frozen-array/strict-membership prototype rejected a coercible object.
- The API can expose a reason without moving the commit boundary. Source shows plan at `ascm-api.mjs:144`, commit at 149 and the existing catch at 161. `node scripts/checks/ascm-cloud-api.mjs` passed its actual synthetic XLSX/model, zero-commit protection, receipt and private-response checks.
- The proxy requires its own sanitizer. `http.mjs:164-165` currently constructs a new held object, discarding all other native fields. `node scripts/checks/ascm-flow-http.mjs` passed 19 checks covering strict requests, holds, receipts and publication authority.
- The proposed import adds no deployment module. `scripts/prepare-ascm-flow-deployment.mjs:7-18` already stages the planner; a local path-resolution probe verified that the proposed worker import maps to `master/ascm-plan.mjs`. `scripts/checks/ascm-flow-deployment.mjs:18-38,59-105` enforces the exact 17-file inventory and relative import closure. This pass read that deployment check without invoking its temporary-file writes.
- Downstream native gates do not depend on an exact held-body key set. The canonical flow checks explicit successful status/receipt predicates. The actual-expression probe above returned false for both initial published and pending-import gates when the reason was added to a 409 hold.
- Existing local checks cover the changed boundaries. The cloud API and native HTTP checks ran successfully in this pass with synthetic in-memory inputs; deployment source already verifies the staged closure and import rewriting. No live endpoint was used.

## Verified plan-level assumptions

All items were listed cold against the one-task draft before reading source for this plan. The sibling sweep covers every referenced existing file, helper, command and response consumer, not just one sanitizer.

| # | Category | Assumption | Evidence |
|---|---|---|---|
| 1 | File paths | All six task files and the existing deployment preparer exist at the named paths. | Read the three checks and production sources; deployment preparer is `scripts/prepare-ascm-flow-deployment.mjs`, not a new helper. |
| 2 | Signatures | Existing API fixtures support real holds and injected typed errors without global replacement. | `ascm-cloud-api.mjs:37-75` defines `fixture(initialManifest)`, `handler(db, env)` and async `call(handle, payload, options)`; `createAscmApi` accepts injected `validateManifest` at `ascm-api.mjs:89`. Real differing-date fixture is at check lines 135-144; direct validation injection already exists at 156-159. |
| 3 | Signatures | Native HTTP status/reason cases can reuse the existing harness. | `ascm-flow-http.mjs:40-51`: `harness({status, receipt})` returns `{handler,calls}`; `req('/api/ascm/import', report)` uses the existing synthetic report and fixed dependencies. |
| 4 | Commands | Direct Node commands are the actual checks; syntax checks need no compiler setup. | `package.json`'s canonical `check` lists the three check scripts. All three `node --check` commands below ran successfully. Deployment check reads/stages reviewed source in its own bounded temporary directory; it was inspected, not run during planning. Git history uses plain imperative commit subjects. |
| 5 | Ordering/code | RED can exercise existing code before importing a new named export; later assertions can inspect the export. | `AscmReviewError` already exists; real API hold needs no new symbol. Use dynamic module namespace access after the real-hold assertion, so the first failure is missing response behavior, not an ESM missing-export error. Frozen-array strict membership is inherited from the spec. |
| 6 | Deployment | The existing deployment check can assert the staged export without adding modules or changing inventory. | Check lines 18-38 enumerate the existing planner target; 59 fixes file count at 17; 69-105 verify all rewritten imports; 120 imports the staged application with existing `pathToFileURL`. |
| 7 | Category 6 consumers | The full source consumer set keeps existing signatures, successes and unrelated holds. | `gateway.mjs:425` constructs the API; flow `bootstrap.mjs:9` constructs the HTTP handler. API tests also construct it directly and status checks use its phase callbacks. `ascm-cloud-plan.mjs` consumes the unchanged planner/error interfaces. MCP `core.mjs:237-240` reconstructs its own existing allowlisted receipt and ignores extra fields. Native canonical gates are inherited from the spec. No consumer requires a changed signature or new property. |

## Tasks

### Task 1: Carry only the approved review reason through both sanitizers

**Files:** Modify the three production modules and extend the three checks listed in File Structure. Keep this one deliverable: the enum and two response gates must land together.

- [ ] **Step 1: Add the failing API and proxy assertions using existing fixtures.**

In the existing differing-date block of `ascm-cloud-api.mjs`, capture the response once and pin the real planner hold before any new-export assertion:

```js
const beforeReviewDispatches = dispatches;
const dateReview = await call(handler(db));
assert.equal(dateReview.status, 409);
assert.equal(dateReview.data.code, 'ASCM_REVIEW_REQUIRED');
assert.equal(dateReview.data.reviewReason, 'DATE_POLICY_REQUIRED');
assert.equal(dateReview.data.archiveAllowed, false);
assert.equal(db.commits, 0);
assert.equal(dispatches, beforeReviewDispatches);
```

Strengthen the existing explicit protection fixture to assert `reviewReason === 'PROTECTED_DATE'`, false Archive, zero commits and no dispatch change. Then dynamically import the planner namespace and assert its `ASCM_REVIEW_REASONS` is an array, frozen, and equals the spec's exact twelve strings with no extras/duplicates.

Reuse direct `createAscmApi` injection, as the existing unreadable-manifest check does: pass a fresh `fixture()`, the existing synthetic credential/clock, `validateReadableManifest: requireReadableManifest`, and `validateManifest() { throw error; }`. Loop through genuine `new AscmReviewError(reason, 'private-sentinel', {productId:'private-sentinel'})` for every approved reason; assert 409, exact outer code, exact reason, false Archive, only `rate`/`read` calls and no dispatch. For genuine typed errors whose codes are `undefined`, `null`, `42`, `{}`, `[]`, `''`, `'UNKNOWN_REVIEW_REASON'` or `'DATE_POLICY_REQUIRED '`, assert the same generic 409 with no own `reviewReason` property. An ordinary error assigned the matching name/code/details is a lookalike: expect the existing generic 503, false Archive and no reason. None of these responses may contain the private sentinel.

In `ascm-flow-http.mjs`, add a `node:test` case using `harness({status:409, receipt:{code:'ASCM_REVIEW_REQUIRED', reviewReason, private:'private-sentinel'}})`. Exercise all twelve exact strings from the spec, independently of the production list. For each:

```js
const response = await h.handler(req('/api/ascm/import', report));
assert.equal(response.status, 409);
assert.deepEqual(await response.json(), {
  sourceMessageId: report.messageId,
  requestId: 'ascm-' + digest(workbook),
  status: 'held', archiveAllowed: false,
  code: 'ASCM_REVIEW_REQUIRED', reviewReason,
});
assert.deepEqual(h.calls, ['delivery', 'metadata', 'import']);
```

Add omission cases for missing reasons and the same JSON-representable invalid reason siblings above. Add different outer codes (`ASCM_RETRY_REQUIRED` and an unknown code) at 409, plus original upstream statuses 400, 401, 413, 418, 429, 502 and 503 with the review outer code and a valid reason. Preserve each case's existing status normalization; assert no own reason, false Archive and no private sentinel. Valid 200/published and 202/publication-pending fixtures carrying an extra reason must keep their existing sanitized success/receipt shape without that property.

- [ ] **Step 2: Run RED and inspect the intended assertion failures.**

Run separately:

```powershell
node scripts/checks/ascm-cloud-api.mjs
node scripts/checks/ascm-flow-http.mjs
```

The new real-date API assertion must fail because `reviewReason` is absent. The new approved-reason proxy assertion must fail for the same feature gap. Repair test setup errors before implementation; do not treat an unavailable import or fixture exception as the intended RED.

- [ ] **Step 3: Implement the enum and two conditional properties only.**

Export `ASCM_REVIEW_REASONS` from `ascm-plan.mjs` as one `Object.freeze` string array with the spec's exact twelve members. Extend the API's existing planner import. At its existing catch response, append `reviewReason` only for a genuine `AscmReviewError` that maps to the unchanged 409 / `ASCM_REVIEW_REQUIRED` and whose code is in that array. Do not change planner or transaction logic.

Import that same enum in worker `http.mjs` from `../ppc-master/ascm-plan.mjs`. On its existing non-OK import branch, append the reason only when the **original** `response.status === 409`, `native.code === 'ASCM_REVIEW_REQUIRED'`, and strict enum membership succeeds. Keep all existing outer fields, status normalization and `archiveAllowed:false`. Do not use a regular expression, string coercion, copied native object or second reason list.

- [ ] **Step 4: Extend deployment parity and run GREEN.**

In `ascm-flow-deployment.mjs`, use its existing `pathToFileURL` import to import the staged `master/ascm-plan.mjs` namespace. Assert the staged reason export is an array, frozen, and deep-equals the canonical export. Retain the existing exact 17-file inventory, hashes, import-resolution, isolated disabled-default and deterministic-restaging assertions; no new staging file or configuration is needed.

Run each command separately and require exit 0:

```powershell
node --check supabase/functions/ppc-master/ascm-plan.mjs
node --check supabase/functions/ppc-master/ascm-api.mjs
node --check supabase/functions/ppc-ascm-flow/http.mjs
node scripts/checks/ascm-cloud-api.mjs
node scripts/checks/ascm-flow-http.mjs
node scripts/checks/ascm-flow-deployment.mjs
git diff --check
```

Expected: API completion message, all native HTTP tests passing, and the deployment check's existing 17-reviewed-files success message. Read the final diff for accidental raw data, logs, authority changes or unrelated edits. The parent performs fresh independent review and the project's one deterministic graph build/check after the final source changes; do not duplicate an in-progress root graph build.

- [ ] **Step 5: Hand off the tested patch for root integration.**

Report the RED failures, GREEN commands/results and exact six changed files. The parent owns the scoped commit, reviewed deployment parity and bounded exact-report retest. Suggested commit subject, matching current history: `Expose sanitized ASCM review reasons`. This task adds no live call, native-flow edit or deployment step.

## Plan self-review

The one task covers every spec acceptance condition. It uses actual local helpers, records Category 6 consumers and the full sibling sets, and avoids new static named imports during RED. No placeholder, unresolved signature, new harness or unrelated behavior change remains. Spec assumptions are inherited; new execution assumptions and their evidence are recorded above. Only this plan was written during the delegated planning task; commit and downstream review remain with the parent.
