# ASCM review reason diagnostic

## Goal and authorization

Identify the protection check that stopped the owner's approved real report test without acquiring a private workbook/master pair or changing accepted facts. The owner gave full approval to complete the supervisor goal. This diagnostic stays within that work: it changes no import decision or Archive authority. The parent owns the existing live-test evidence; this design was verified locally without live requests, credentials or private-data reads.

## Problem

`planAscmImport` throws `AscmReviewError` with a typed code. `ascm-api.mjs` reduces every such error to HTTP 409 with `code: "ASCM_REVIEW_REQUIRED"` and `archiveAllowed: false`. The native worker then copies only an allowlisted outer code. The real 409 therefore proves an intentional planner hold but cannot identify its reason. A missing date policy alone does not prove `DATE_POLICY_REQUIRED`; other planner checks run first.

## Options and decision

The decision axes are private-data access, diagnostic delivery through the actual consumer, behavior when a reason is missing or invalid, and additional persistent infrastructure.

1. **Return one allowlisted reason in the existing held response — selected.** Reuse the current authenticated request and response. Missing or invalid reasons retain the existing generic hold. Native publication and Archive gates remain false.
2. **Acquire the actual workbook and current accepted plaintext master for a local dry run.** This could reproduce the planner with a verified pair, but filename inventory found no existing pair. It requires additional private-data acquisition or decryption. An older/dry-run snapshot cannot establish the live hold.
3. **Log a safe reason in the server.** This would introduce a persistent diagnostic sink and a separate log-reading step; it would not put the reason through the existing native response consumer. Additional logs and their operational usage are excluded from this task.

Probes:

- Existing response loses the reason: read `ascm-api.mjs:137-165` and `ppc-ascm-flow/http.mjs:158-172`; neither response copies the planner code as a separate reason.
- The consumer continues to hold: executed the actual canonical `Initial_published` and `Import_pending` WDL expressions using the existing local evaluator against a synthetic 409 response containing `reviewReason: "DATE_POLICY_REQUIRED"`; both evaluated false.
- A verified local private input pair is unavailable: filename-only inventory of both project workspaces found no exact monthly ASCM XLSX; the named R82 package is encrypted and older plaintext filenames do not establish current provenance. No private contents were read.
- A new server log is additional infrastructure: the inspected API and worker failure paths emit sanitized responses and contain no console logging. No logging or provider retention/cost experiment was performed or is required for this option.

A hybrid does not improve the selected design: acquiring private inputs or adding logs is unnecessary to transport the existing finite reason. Sanitization at both response boundaries is necessary for the selected response path.

## Response contract

Add the optional string property `reviewReason` only in the following cases:

- **API:** the caught error is an actual `AscmReviewError`, the response remains HTTP 409 / `ASCM_REVIEW_REQUIRED`, and its code belongs to the frozen approved enum below.
- **Native proxy:** the original upstream response status is exactly 409, its outer `code` is exactly `ASCM_REVIEW_REQUIRED`, and its `reviewReason` belongs to the same approved enum. The proxy's existing status normalization must not make another upstream status eligible.

For an absent, unknown or non-string reason, omit the property. Do not coerce it, emit a fallback reason, or echo an arbitrary code. On all these held responses, `archiveAllowed` remains the boolean false. Existing response fields keep their current meaning.

The approved enum has exactly these twelve strings:

`AMBIGUOUS_MATCH`, `CATEGORY_RELOCATION`, `DATE_POLICY_REQUIRED`, `DUPLICATE_MATCH`, `INCOMPATIBLE_MAPPING`, `INCOMPLETE_NEW_PRODUCT`, `MALFORMED_REPORT`, `MASTER_CONFLICT`, `PRODUCT_ID_COLLISION`, `PROTECTED_DATE`, `STALE_REPORT`, `TOO_MANY_GROUPS`.

Never return `error.details`, raw exceptions/messages, product IDs, source rows, field/date values, workbook bytes, master data, keys or URLs as part of this diagnostic. Keep current generic public error text. Other API failures, successful receipts, queued metadata and publication confirmation schemas remain unchanged. `reviewReason` is diagnostic information only and must not select a retry, bypass or Archive path.

## Components and data flow

- `supabase/functions/ppc-master/ascm-plan.mjs`: export `ASCM_REVIEW_REASONS` as an `Object.freeze` array of the twelve strings. Leave the error class, planner checks, ordering and transaction behavior unchanged.
- `supabase/functions/ppc-master/ascm-api.mjs`: import that enum with its existing planner import and conditionally construct the optional response property at the existing catch boundary.
- `supabase/functions/ppc-ascm-flow/http.mjs`: import the enum from the existing planner module and conditionally copy the optional property after the exact upstream status/code checks. Retain the existing outer-code allowlist and forced held state.

There is one reason list, owned beside the planner and shared by both response boundaries. Use strict string membership, not a regular expression accepting arbitrary uppercase text. No new module, endpoint, environment setting, dependency, database operation, migration, log or native-flow action is needed. The planner already belongs to the native worker's reviewed 17-file deployment closure; the existing deployment preparer rewrites this new relative import into that same closure.

## Verified assumptions

All six assumptions were listed before the fresh verification pass:

- [x] The complete set of current planner holds is the twelve-string enum. An in-memory Node source probe enumerated every literal `fail(...)` code in `ascm-plan.mjs` and found exactly twelve unique members. The frozen-array/strict-membership prototype rejected a coercible object.
- [x] The API can expose a reason without moving the commit boundary. Source shows plan at `ascm-api.mjs:144`, commit at 149 and the existing catch at 161. `node scripts/checks/ascm-cloud-api.mjs` passed its actual synthetic XLSX/model, zero-commit protection, receipt and private-response checks.
- [x] The proxy requires its own sanitizer. `http.mjs:164-165` currently constructs a new held object, discarding all other native fields. `node scripts/checks/ascm-flow-http.mjs` passed 19 checks covering strict requests, holds, receipts and publication authority.
- [x] The proposed import adds no deployment module. `scripts/prepare-ascm-flow-deployment.mjs:7-18` already stages the planner; a local path-resolution probe verified that the proposed worker import maps to `master/ascm-plan.mjs`. `scripts/checks/ascm-flow-deployment.mjs:18-38,59-105` enforces the exact 17-file inventory and relative import closure. This pass read that deployment check without invoking its temporary-file writes.
- [x] Downstream native gates do not depend on an exact held-body key set. The canonical flow checks explicit successful status/receipt predicates. The actual-expression probe above returned false for both initial published and pending-import gates when the reason was added to a 409 hold.
- [x] Existing local checks cover the changed boundaries. The cloud API and native HTTP checks ran successfully in this pass with synthetic in-memory inputs; deployment source already verifies the staged closure and import rewriting. No live endpoint was used.

## Acceptance checks

Extend the existing checks rather than adding a new harness:

- `scripts/checks/ascm-cloud-api.mjs`: genuine typed review errors expose only approved reasons; a real protected-date/date-policy hold remains 409 with zero commits/dispatches; unknown reason strings and error lookalikes cannot disclose a reason or private error data. Existing success and unrelated-failure shapes stay unchanged.
- `scripts/checks/ascm-flow-http.mjs`: exercise every enum member on the exact upstream 409/outer-code combination. Verify omission for missing/unknown/non-string reasons, different statuses and different outer codes. Inject private extra fields and confirm they never escape. Every held result retains `archiveAllowed: false`.
- `scripts/checks/ascm-flow-deployment.mjs`: retain the exact 17-file inventory and prove that the added planner import resolves after staging, with no new network dependency or configuration.

Run the affected existing checks and source syntax checks after implementation. The parent then performs independent review and the normal local graph refresh/verification before its already-authorized bounded deployment and exact-report retest. Deployment parity remains required. This spec itself does not implement or activate anything.

## Limits and self-review

This diagnostic identifies the first actual planner hold. It does not authorize altering the held dates, clearing protections, accepting stale data, or fabricating changes to complete a test. A returned policy/mapping reason must be resolved from its actual evidence under the existing protection agreement.

Self-review found no placeholders or scope expansion. The finite enum, two independent response gates, omission behavior and unchanged Archive authority are explicit. No new design-blocking or adjacent implementation issue was established by this verification. This delegated task ends with this spec for fresh review; the parent retains responsibility for its commit and subsequent plan.
