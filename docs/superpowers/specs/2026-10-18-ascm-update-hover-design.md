# ASCM update hover readout

## Goal and authorization

Hovering or keyboard-focusing the existing right-side ASCM clock shows a styled readout of the last successfully accepted ASCM update: elapsed local calendar days plus the exact local date. The owner requested a label like the Roadmap Today date and delegated the wording. The parent approved the required nonsecret timestamp projection through existing authenticated presence. This delegated pass writes design and plan only; the parent owns fresh review, commits, implementation, deployment and live work. Existing inline-face changes remain separate and untouched.

## Selected approach

Decision axes are timestamp authority, metadata-only imports, behavior when data is absent or malformed, consumer compatibility, and extra backend work.

1. **Project the accepted timestamp through the existing presence response — selected.** Presence already reads the accepted manifest. Add one optional sanitized `lastUpdatedAt` property to an enabled supervisor, using only `state.manifest.ascmSnapshot.importedAt`. This avoids another read, request, SQL change or master snapshot contract.
2. **Project it through the normal latest/save snapshot.** Correct authority, but it changes a second contract and the clock would need to consume that snapshot independently of its existing presence state. No advantage for this clock-only request.
3. **Derive it from audit history, package time, or local portfolio state.** Rejected: successful source-evidence-only imports need not create business-field history; package time also changes for ordinary edits; locally applied manual imports can be unsaved.

Probes:

- Existing presence has the needed authority and fixed operations: `gateway.mjs:367-395` reads the accepted state before the presence RPC. `node scripts/checks/ascm-status-api.mjs` passed six checks, including the exact `rate, rate, read, presence` sequence and rejection of browser status claims.
- History can miss successful ASCM evidence updates: `ascm-plan.mjs:163-174` overlays `ascmSnapshot` after canonical merge. `node scripts/checks/ascm-cloud-plan.mjs` passed twenty checks, including a changed metadata-only result with zero saved business fields.
- Failure and replay do not stamp a fresh accepted import: `ascm-api.mjs:121-131` returns receipt replay before planning; lines 144-156 plan then commit. Its existing status API checks passed real parsing, failed commit, zero-commit malformed workbook, and immutable receipt replay cases.
- The ordinary snapshot omits `ascmSnapshot`: read `gateway.mjs:173-184` and `master-model.js:811-821`; local apply stamps it before shared acceptance at `app.js:8813-8822`.
- Combining history/package/local fallbacks with the selected approach would reduce accuracy. The styled readout is required regardless of the transport choice; no hybrid improves the selected path.

## Data contract and semantics

Extend the internal gateway signature from `safeAscmSupervisor(value, currentTime)` to `safeAscmSupervisor(value, currentTime, lastUpdatedAt)`, with the third argument optional. Its sole production caller supplies `state.manifest.ascmSnapshot.importedAt` only when `ascmSnapshot` is a non-array object. Browser input and the raw presence-RPC object never supply or override this value.

The optional emitted field is `ascmSupervisor.lastUpdatedAt`, a canonical UTC ISO string with milliseconds. Admit only actual strings in the existing ASCM planner's accepted format: `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.SSSZ`. Require a finite parsed instant, exact ISO round-trip after adding `.000` when absent, and an instant no later than the finite server `currentTime`. Omit the field for absent, null, non-string, malformed, impossible, offset-form or future input. Do not coerce or substitute another timestamp. Timestamp rejection must not hide an otherwise valid enabled supervisor or change its working lease, count or reconnect flags.

Carry the field on every valid enabled result, including idle and locally expired work leases. Unsupported, disabled and unavailable supervisor behavior stays unchanged. The browser independently admits the same string forms, canonicalizes them, rejects future timestamps against its own clock, and preserves the optional field through normalization, controller snapshots and lease expiry. A legacy server without the field remains supported. Existing master-client presence handling preserves additional response properties, so it requires no change.

The timestamp means the recorded ASCM import time in the accepted manifest sampled by that presence request. It is assigned during planning and becomes observable only after successful commit. It includes committed source-evidence-only imports, even when no business field changes. A check, lease begin/plan/end, failed import, failed commit, dry run, local unsaved apply or receipt replay never creates a new time. There is no claim that it is the database commit-completion instant or package publication time. A concurrent commit after presence's existing read is naturally reflected on a later ordinary heartbeat; no extra consistency read is added.

## Readout and interaction

Keep the clock and actual `Updating ASCM` product count visibly unchanged. The bot header face and people dialog retain their current purpose. Add no permanent toolbar text, status pill, button action or duplicated hover surface on the bot face.

The clock's existing indicator becomes keyboard focusable (`tabindex="0"`) with visible existing focus styling. Keep its status semantics and current-work accessible label; add an `aria-describedby` relation to one stable `role="tooltip"` element. Remove the indicator's native title to avoid competing browser tooltips. The description is available through the named relation; the visual card is concealed while inactive and its content is not a separate live announcement. The tooltip contains no focusable actions.

Show the card on pointer entry and keyboard focus. Keep it open while the pointer is over the card or its trigger, or while the trigger has focus. Use the tooltip wrapper's padding as an unbroken hover bridge. Hide on pointer departure when unfocused, blur when unhovered, Escape, status becoming unavailable/hidden, or disposal. Escape dismisses without moving focus and remains dismissed until a fresh pointer entry or focus after departure. Route Escape through the existing presence key handler so dismissing this readout is consumed before the people dialog's Escape handling. A status update while open refreshes its text in place. If the focused clock becomes hidden, initialization restores focus to the existing connection-status trigger rather than a hidden dialog control. No hover, focus, dismissal or date calculation sends a request.

Use the Today readout's visual vocabulary, implemented with scoped ASCM styles: Jost, existing surface/text/border tokens, 3px radius, restrained border, tabular numbers, 10px horizontal padding and 8-10px gaps. Desktop is a compact approximately 30px horizontal readout with a muted `Last ASCM update` label, a 12px/500 elapsed value, a subtle divider and an 11px exact date. Anchor beneath the clock, right aligned, with an 8px pointer bridge and a maximum width of the viewport minus 24px. Allow wrapping on narrow screens so the entire date remains visible. Keep the card inside the topbar's available viewport; no page scrolling or overlay framework. Reuse the existing focus ring, with no autonomous animation or additional reduced-motion work; the readout opens and closes statically.

Visible content examples (all dates are the viewer's local date):

- Same local day: `Last ASCM update  Today  |  Oct 18, 2026`.
- Previous local day: `Last ASCM update  1 day ago  |  Oct 17, 2026`.
- Older: `Last ASCM update  2 days ago  |  Oct 16, 2026`.
- Missing or invalid accepted time: `No ASCM update recorded.`; no elapsed/date fragments.

Use `Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })` for the compact date, with the canonical timestamp on the `time` element's `dateTime`. The accessible description says the same label, age and full date. Compute age by subtracting ordinal local calendar dates constructed with `Date.UTC(localYear, localMonth, localDay)`, not elapsed milliseconds divided by 24 hours. Recompute on show and existing render/visibility refreshes; add no timer. This gives correct midnight, year-boundary and daylight-saving behavior.

## Components and verification

Production changes are limited to `supabase/functions/ppc-master/gateway.mjs`, `public/js/master-presence.js` and `public/css/styles.css`. Extend only the existing `scripts/checks/ascm-status-api.mjs` and `scripts/checks/ascm-supervisor-presence-ui.mjs` fixtures/checks. The latter already serves the real header and production modules in a labeled, loopback-only synthetic preview with `connect-src 'none'`; add only synthetic timestamps there for visual proof.

Meaningful RED/GREEN checks must prove: authority comes from the accepted read despite conflicting RPC/browser timestamps; exact existing request/RPC counts; successful metadata-only commits and receipt/failure timestamp stability; malformed/future omission at both boundaries; legacy compatibility; timestamp retention through working/idle/expiry; Today/one/multiple calendar-day and DST cases; styled hover/focus, hover bridge, Escape, blur/hide/disposal, stable open-card refresh; unchanged human count, pokes, faces, visible work count and reconnect controls. Parent performs actual desktop/narrow browser inspection and keyboard/reduced-motion checks on the disposable fixture before release claims.

## Verified assumptions

The eight assumptions were listed before the fresh verification pass; every recurring timestamp/state consumer was included in the sweep.

- [x] **Accepted timestamp authority:** `ascm-plan.mjs:89-95,163-174` validates and writes `ascmSnapshot.importedAt`; `ascm-api.mjs:121-156` places replay before planning and acceptance after commit. Current status API and planner checks passed (6 and 20 respectively), including failure, replay and metadata-only cases.
- [x] **No new backend operation:** `gateway.mjs:367-395` already holds `state.manifest` before the existing RPC. The running gateway fixture pins `rate, rate, read, presence`; a third sanitizer argument changes neither authentication nor that sequence.
- [x] **Complete consumer path:** gateway sanitizer has one production call (`gateway.mjs:394`); `master-client.js:156-169,808-816` returns extra presence fields; `master-presence.js:19-26,141,204,274` reconstructs status and therefore needs explicit timestamp preservation. No shared model or client change is required.
- [x] **Exact ISO and future checks:** an in-memory Node prototype using the planner's UTC formats accepted second/millisecond forms and rejected non-strings, impossible February 30, offset form and a timestamp 1ms in the future. The prototype changed no repository files.
- [x] **Local calendar semantics:** an in-memory `America/Los_Angeles` prototype verified same-day zero, a midnight crossing in twenty minutes, spring's 23-hour day and autumn's 25-hour day using local-date ordinals.
- [x] **Existing visual/accessibility patterns:** `today-marker.js:7-20,66-76,101-113` uses local dates and semantic time/readout nodes. `today-marker.css:8-18` supplies the compact surface/border/type vocabulary. `category-navigation.js:45-59,91-108` already uses pointer/focus/Escape dismissal. `styles.css:38,235-247` supplies global focus and the unclipped topbar layout; `master-presence.js:442` is the existing capture Escape handler.
- [x] **Available test and preview seams:** status API checks inject RPC/clock and run real synthetic workbook/model work; supervisor UI checks run the real initializer/view with controllable DOM/clock and a CSP-blocked synthetic preview. The preview's existing `PPC_PREVIEW_PORT` keeps the owner's earlier preview intact.
- [x] **No new deployment module:** `prepare-ascm-flow-deployment.mjs:7-18` already includes `gateway.mjs`; `ascm-flow-deployment.mjs:23,59` verifies that member and the exact existing 17-file closure. The parent's in-flight diagnostic staging remains frozen; this design does not restage it.

## Out of scope

No SQL, migrations, database timestamp column, new RPC/request, polling interval, timer, settings, feature flag, dependency, endpoint, normal master snapshot/client/model change, private field, audit-history/package/local fallback, import behavior, protection policy, publication/Archive authority, live backend probe, key read, deployment or unrelated UI redesign belongs to this change. Parent coordinates any later normal deployment parity after independent review; this design does not modify the frozen diagnostic stage.

## Self-review and handoff

The authority, optional field, timestamp forms, future policy, elapsed-day semantics, readout copy, focus/Escape behavior, failure states and request counts are explicit. No new design-blocking issue remains after verification. The files remain uncommitted by the parent's explicit instruction. Fresh review and any resulting revision precede implementation.
