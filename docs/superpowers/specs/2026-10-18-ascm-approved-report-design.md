# One approved historical ASCM report

The owner approved processing the single October release notification received September 30, including Archive only after the normal protected import and SharePoint publication gates. The general new-mail cutoff stays unchanged. This is a bounded acceptance-test facility, not a historical backfill feature.

## Smallest selected design

The native worker may read one optional `PPC_ASCM_APPROVED_REPORT` environment value. It is strict JSON with exactly `sourceSha256` (64 lowercase hex characters) and `expiresAt` (a valid explicit ISO instant). The source fingerprint is SHA-256 over UTF-8 `JSON.stringify([messageId, sender, subject, receivedAt, fileName])`, using the exact validated request strings and the immutable ID returned by Microsoft. It contains no credentials and does not grant authority without the existing worker secret.

For each `/api/ascm/import` request, retain all existing request, sender, monthly notice, workbook, future-time, authentication, receipt, fact-protection and publication checks. A received time at or before the ordinary cutoff passes that one time comparison only when its source fingerprint matches and `now < expiresAt`. Invalid, missing, oversized, unknown-field or expired policy grants no exception; ordinary eligible mail and publication operations continue normally. Check expiry at request time, including replay, rather than caching an eligibility boolean when the worker is created. Add the setting only to the native worker's explicit Deno environment allowlist. No new route, header, request field, SQL migration, grant or credential is needed.

The manual test first selects Inbox messages by exact subject, sender, received instant and attachments, with `$top=2` and immutable-ID preference. Require exactly one result and no continuation before importing; zero, duplicate or paginated matches hold. Bind the policy to that returned ID. Keep the hourly schedule off. The first lookup is metadata only, with an empty report loop; its temporary Compose emits only ID and internetMessageId. Remove it before production restoration. Configure an expiry one day ahead for the approved test, then clear the policy after test completion or abandonment. The exception may be replayed until expiry because an interrupted publication must be recoverable; existing content-addressed receipt semantics prevent duplicate accepted changes.

## Alternatives and observed constraints

- Selected: optional one-source fingerprint plus expiry preserves the ordinary cutoff and requires no new endpoint or permission.
- Moving the global cutoff admits unrelated older mail at the worker boundary; rejected because the owner authorized one message.
- A temporary hardcoded exception needs a second code deployment to remove its authority and embeds operational policy in source; rejected in favor of absent-by-default configuration with an expiry.

Probes: `reportInput` in `ppc-ascm-flow/http.mjs` rejects `received <= cutoff` before any gateway/receipt operation. `index.ts` explicitly enumerates permitted environment names. `bootstrap.mjs` constructs the handler once and passes a `now` callback. Native `Report_payload` uses the returned item ID, while ASCM receipts use the workbook digest. These operations establish the two boundaries the selected design must preserve.

## Verified assumptions

- The cutoff exists solely in native worker `http.mjs:62-66` on this import path; `ascm-mail-policy.mjs` separately validates sender, month, timestamp and report filename without reading that environment setting. The exception therefore changes only native cutoff eligibility, not the master policy.
- Native initial import and fresh replay both call the same `/api/ascm/import` handler with the same `Report_payload`. One runtime predicate covers both consumers.
- The deployment entrypoint explicitly reads its Deno env names (`ppc-ascm-flow/index.ts:3-11`); a handler-only injected-env test cannot prove deployment wiring. Verify this static boundary as well as executable handler behavior.
- `createAscmFlowApplication` creates the handler once (`bootstrap.mjs:7-10`); `now` must be called for each request so warm instances do not retain expired authority.
- `validateAscmEnvelope` and the existing strict six-field request shape run before source matching. Preserve them, the workbook limit and canonical base64 checks. No raw workbook or message identity belongs in public source or diagnostics.
- Existing receipt/publication code permits a legitimate no-change receipt at current revision 82 and requires independent normal SharePoint coverage before Archive. The acceptance test must not manufacture a new revision to exercise a particular branch.

## Validation and deployment

First add executable failing tests: exact old report passes only with matching unexpired policy; each of the five source-field changes fails; absent, malformed, unknown-field, uppercase/invalid digest and expired policies reject old mail; ordinary post-cutoff requests still behave normally; future mail, envelope/workbook/auth rejection remain unchanged; one reused handler stops accepting after expiry; replay obeys the same cutoff gate. Refusals must reach no delivery or import dependency. Verify the Deno allowlist and stage/source deployment parity. Retain all existing flow HTTP/application/deployment, native definition and outcome checks.

The existing authorization covers this exact historical-message exception. No broader cutoff change, backfill, permission or status-monitoring activation is included. Keep the publisher disabled during native import, dispatch only the reviewed branch if publication is pending, then disable it before replay. Archive remains entirely controlled by the fresh report receipt, normal publication and exact immutable-message readback.
