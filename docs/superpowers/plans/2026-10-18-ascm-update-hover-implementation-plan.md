# ASCM Update Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan after the parent's fresh review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source spec:** `docs/superpowers/specs/2026-10-18-ascm-update-hover-design.md` (uncommitted at plan-write time; repo HEAD = `1004b62a67f6d47cc45fcdaccfef5b2655fba358`). The parent explicitly owns review and commits. Neither this design/plan pass nor its implementation worker may commit, deploy or change the frozen diagnostic stage.

**Goal:** Give the ASCM clock a compact styled hover/focus readout showing the accepted ASCM import's local calendar age and exact date without another request or backend operation.

**Architecture:** Supply the already-read accepted `manifest.ascmSnapshot.importedAt` as the optional third argument to the existing gateway supervisor sanitizer. Emit only valid canonical nonfuture `lastUpdatedAt`, preserve it through the existing browser status normalizer, and render one keyboard-accessible tooltip using the Roadmap Today readout's existing visual vocabulary.

**Tech stack:** Existing browser classic JavaScript, gateway ES modules, DOM/CSS, `Intl.DateTimeFormat`, and Node assertion/`node:test` checks. No dependency, SQL, configuration or route change.

## Global Constraints

“Browser input and the raw presence-RPC object never supply or override this value.”

“Do not coerce or substitute another timestamp. Timestamp rejection must not hide an otherwise valid enabled supervisor or change its working lease, count or reconnect flags.”

“No hover, focus, dismissal or date calculation sends a request.”

“Keep the clock and actual `Updating ASCM` product count visibly unchanged. The bot header face and people dialog retain their current purpose. Add no permanent toolbar text, status pill, button action or duplicated hover surface on the bot face.”

## File Structure

- Modify: `supabase/functions/ppc-master/gateway.mjs` — optional accepted timestamp projection at the existing authenticated presence boundary.
- Modify: `public/js/master-presence.js` — timestamp admission/preservation, calendar-age formatting and the existing supervisor view's tooltip lifecycle.
- Modify: `public/css/styles.css` — scoped readout layout, pointer bridge, responsive width and the clock's explicit focus-visible ring.
- Test: `scripts/checks/ascm-status-api.mjs` — accepted authority, sanitization, commit/replay/failure semantics and exact operation counts.
- Test: `scripts/checks/ascm-supervisor-presence-ui.mjs` — real normalizer/controller/DOM interaction and synthetic preview timestamps.

## Inherited from spec

These eight assumptions were verified by thorough-brainstorming and are trusted here:

- [x] **Accepted timestamp authority:** `ascm-plan.mjs:89-95,163-174` validates and writes `ascmSnapshot.importedAt`; `ascm-api.mjs:121-156` places replay before planning and acceptance after commit. Current status API and planner checks passed (6 and 20 respectively), including failure, replay and metadata-only cases.
- [x] **No new backend operation:** `gateway.mjs:367-395` already holds `state.manifest` before the existing RPC. The running gateway fixture pins `rate, rate, read, presence`; a third sanitizer argument changes neither authentication nor that sequence.
- [x] **Complete consumer path:** gateway sanitizer has one production call (`gateway.mjs:394`); `master-client.js:156-169,808-816` returns extra presence fields; `master-presence.js:19-26,141,204,274` reconstructs status and therefore needs explicit timestamp preservation. No shared model or client change is required.
- [x] **Exact ISO and future checks:** an in-memory Node prototype using the planner's UTC formats accepted second/millisecond forms and rejected non-strings, impossible February 30, offset form and a timestamp 1ms in the future. The prototype changed no repository files.
- [x] **Local calendar semantics:** an in-memory `America/Los_Angeles` prototype verified same-day zero, a midnight crossing in twenty minutes, spring's 23-hour day and autumn's 25-hour day using local-date ordinals.
- [x] **Existing visual/accessibility patterns:** `today-marker.js:7-20,66-76,101-113` uses local dates and semantic time/readout nodes. `today-marker.css:8-18` supplies the compact surface/border/type vocabulary. `category-navigation.js:45-59,91-108` already uses pointer/focus/Escape dismissal. `styles.css:38,235-247` supplies global focus and the unclipped topbar layout; `master-presence.js:442` is the existing capture Escape handler.
- [x] **Available test and preview seams:** status API checks inject RPC/clock and run real synthetic workbook/model work; supervisor UI checks run the real initializer/view with controllable DOM/clock and a CSP-blocked synthetic preview. The preview's existing `PPC_PREVIEW_PORT` keeps the owner's earlier preview intact.
- [x] **No new deployment module:** `prepare-ascm-flow-deployment.mjs:7-18` already includes `gateway.mjs`; `ascm-flow-deployment.mjs:23,59` verifies that member and the exact existing 17-file closure. The parent's in-flight diagnostic staging remains frozen; this design does not restage it.

## Verified plan-level assumptions

All six items were listed cold against the draft before the plan verification reads. The sibling sweep covers every affected production/check path, sanitizer caller, state reconstruction and verification command.

| # | Category | Assumption | Evidence |
|---|---|---|---|
| 1 | Paths | The five task paths exist; the two hover docs are new files in the established directories. | Read each source/check; `rg --files docs/superpowers` lists sibling ASCM specs/plans in these directories. The source spec was read end-to-end after creation and contains its required Verified assumptions section. |
| 2 | Signatures/consumers | An optional third server argument preserves its existing sole call and an optional browser field preserves legacy response shapes. | `gateway.mjs:152,394` defines/calls the internal sanitizer; the three valid-return branches are idle, expired and working. `normalizeAscmSupervisor(value, time)` at `master-presence.js:19` reconstructs idle/working; controller `state()` normalizes again at 141. Existing no-timestamp deep comparisons must continue to pass. |
| 3 | Test seams | Existing status fixtures support accepted-state, clock, replay, metadata and fixed-operation tests without a network fixture. | `ascm-status-api.mjs:27-45` holds mutable accepted manifest/receipt/revision and exposes injected `database`; `createAscmApi` accepts injected `now` and `database`. The local test may add a clock parameter to its existing handler helper at 47 and inspect accepted state through that fixture only. Its presence tests already inject RPC and assert exact operation lists at 107-156. |
| 4 | DOM seams | Existing UI checks can exercise focus/pointer/Escape and controlled time with test-only event support. | `Element` at check line 86 owns listeners/focus; `HeaderElement` at 101 and `headerFixture` at 112 execute the actual initializer; `viewFixture` at 175 injects clock/timers. Extend these test-local doubles with generic dispatch/removeAttribute and document key dispatch rather than adding another harness or production test hooks. |
| 5 | Commands/order | Native Node syntax/check commands exist and the feature does not require regenerating shared models. | Four `node --check` commands for the two production JavaScript files and two checks passed in the planning pass. `package.json:13-15` defines canonical check/test/build; `build-supabase-master.mjs:6-20` copies four shared model/import files, none changed by this plan. Run its read-only `--check` only. |
| 6 | Category 6 | All touched consumers retain state gates, old status semantics, inline human interactions and the existing deployment inventory. | `master-client.js:156-169,808-816` preserves added response fields. `ascm-connection-gateway.mjs:54-74` compares legacy field shapes and the same operation list. Existing UI check covers inline placement, counts, human poke and keyboard return. The 17-file deployment closure already contains gateway; no deployment script or frozen stage changes are needed. |

## Tasks

### Task 1: Carry the accepted timestamp into the clock's styled hover/focus readout

This is one end-to-end deliverable: the gateway projection and browser consumer land together, while missing fields remain backward compatible. Use only the five File Structure paths. Do not begin until the parent reports fresh design/plan review complete and releases the source freeze for implementation.

- [ ] **Step 1: Add the failing gateway assertions using existing status fixtures.**

Extend the existing presence-status test with accepted `manifest.ascmSnapshot.importedAt = '2026-10-16T12:00:00.000Z'` and a conflicting raw-RPC `lastUpdatedAt = '2026-10-17T11:59:00.000Z'`. Assert the response contains the October 16 value, existing human count/session data is unchanged, only allowed status properties escape, and operations remain exactly `['rate', 'rate', 'read', 'presence']`. A browser-supplied `lastUpdatedAt` must be rejected by the existing request allowlist before any accepted read/presence call; do not extend that allowlist.

Use a table of absent/null/non-string values, empty text, impossible dates, offset form and a value 1ms ahead of the injected clock. The enabled face/work status remains valid but the own timestamp property is absent. Second-precision input canonicalizes to milliseconds. Cover valid timestamp retention in idle, working and expired-lease outputs, raw-RPC timestamp with no accepted manifest timestamp, malformed/disabled supervisor, and the status flag off.

Use the existing real workbook fixture and in-memory accepted-manifest store for a metadata-only successful import: after its business rows already match, generate different eligible synthetic workbook bytes with those same rows (for example, harmless worksheet-XML whitespace) so the API derives a new digest/request identity. Changing only the mail message ID would replay the existing receipt and is insufficient. Assert zero business-field changes and the new accepted source timestamp. Sample that accepted state through the gateway, then replay its immutable receipt at a later injected clock and prove the timestamp is unchanged. Rejected workbooks, failed commits and immutable receipt replay preserve the prior accepted timestamp. For each optional status-reporting failure at begin, plan and end where the actual import commits successfully, assert that the accepted manifest stores the new import time and a subsequent authenticated presence sample exposes it. If an actual transaction fails, preserve the prior timestamp even when status reporting also fails. Keep production import and optional-status behavior unchanged. Fixture reads are local assertions; no actual backend is used.

- [ ] **Step 2: Add the failing browser normalization and interaction assertions.**

In the existing UI check, supply actual status payloads with `lastUpdatedAt` and exercise the real controller and view. Assert valid preservation through active/idle/local expiry and omission for the same malformed/future table. Use fixed local `Date` fixtures for Today, previous day, multiple days, midnight/year boundary and the two DST crossings from the spec; make the test clock/timezone deterministic in its own Node/VM context. Include legacy payloads without the field.

Dispatch pointer entry and focus on the real indicator; assert the stable tooltip is visible, its literal elapsed/date text matches the fixture, it is described by the focusable clock, and no native title competes. Move the pointer through the wrapper/card while keeping it open. Exercise pointer leave with and without focus, blur, Escape while the people dialog is also open, re-entry after dismissal, status update while open, unavailable/disabled transition, hidden focused-clock fallback and disposal. Assert the tooltip never steals focus and opens/dismisses without increasing the existing fixture request count or allocating timers. Keep the existing inline-face, people count/pokes, `Updating ASCM` count, clock animation/reduced-motion and key recovery assertions.

- [ ] **Step 3: Run RED before any production edit.**

```powershell
node scripts/checks/ascm-status-api.mjs
node scripts/checks/ascm-supervisor-presence-ui.mjs
```

The gateway assertion must fail because accepted `lastUpdatedAt` is missing; the browser assertion must fail because normalization/readout is missing. A fixture exception, unsupported DOM-double method or unavailable new import is not the intended failure. Correct setup first and record both genuine RED observations.

- [ ] **Step 4: Add the optional field at the two existing trust boundaries.**

In gateway only, add the optional third input to `safeAscmSupervisor`, admit the spec's strict UTC string forms, round-trip and reject future/invalid input, and construct the optional canonical property for all valid return branches. The production call passes only the existing accepted manifest's object-valued `ascmSnapshot.importedAt`. Never spread raw status or imported metadata into the public object. Retain all existing supervisor activity/reconnect gates, authentication, request fields and database calls.

In `normalizeAscmSupervisor`, independently validate/canonicalize the optional field against its injected numeric time and preserve it in both idle/expired and working results. Use one local timestamp admission routine for repeated browser normalization, and one calendar/readout formatter where rendering needs it; no exported generic date framework or cross-module dependency. Neither helper reads local portfolio/package/history state.

- [ ] **Step 5: Render the scoped tooltip and lifecycle in the existing supervisor view.**

Create stable inert DOM nodes once for one `role="tooltip"` card with the spec's label, elapsed span, divider and semantic `time`. Update text/dateTime in place from normalized status. Use no HTML injection, duplicate tooltip, native title or clickable action. Set the tooltip's live behavior to off so it is an on-demand description rather than a second status announcement.

Make the clock indicator focusable and add its `aria-describedby` relation. Keep the current-work accessible label and visible count. Store only the view's needed hover/focus/dismissed state; pointer entry/focus opens and recomputes time, leaving/blur closes when neither remains, and disposal/status hide closes and removes listeners. Expose the view's production-used close-tooltip method so the existing capture Escape handler consumes a visible clock tooltip before the roster's existing close/reconnect behavior. Reset dismissal only on deliberate re-entry/refocus; render updates must not reopen a dismissed card. Handle loss of a focused clock by focusing the existing status trigger in initialization, parallel to the inline face's existing fallback. Add no timer/request.

Use scoped CSS for Today-like palette, border, radius, type, tabular numbers and compact desktop row. Set the indicator as the positioning anchor and the tooltip wrapper beneath it with a continuous 8px hover bridge, right alignment, viewport-bounded max width and narrow-screen wrapping. Explicitly style `.ascm-supervisor-indicator:focus-visible` with the existing accent/outline dimensions because the global focus selector covers native controls, not this span. Static opening/closing must work identically with reduced motion.

- [ ] **Step 6: Run GREEN and the affected existing consumer checks.**

Require successful output from each command; report every failure by name. Do not broaden or repeat after green unless a new edit or failure warrants it.

```powershell
node --check supabase/functions/ppc-master/gateway.mjs
node --check public/js/master-presence.js
node --check scripts/checks/ascm-status-api.mjs
node --check scripts/checks/ascm-supervisor-presence-ui.mjs
node scripts/checks/ascm-status-api.mjs
node scripts/checks/ascm-supervisor-presence-ui.mjs
node scripts/checks/ascm-connection-gateway.mjs
node scripts/checks/master-presence.mjs
node scripts/checks/master-client.mjs
node scripts/checks/ascm-cloud-plan.mjs
node scripts/build-supabase-master.mjs --check
git diff --check
```

- [ ] **Step 7: Hand the parent a real synthetic visual proof path.**

Extend the existing preview status with a clearly synthetic accepted timestamp that demonstrates two days ago; include its absent/invalid case using the existing fixture state mechanism without adding a production configuration. Keep the CSP, labeled synthetic notice, actual header/module/styles and loopback-only server. Parent may restart/reload only its disposable 4198 preview, preserving other previews and active user work. The existing invocation is:

```powershell
$env:PPC_PREVIEW_PORT='4198'
node scripts/checks/ascm-supervisor-presence-ui.mjs --preview
```

Parent visually verifies closed clock, pointer-open card, hover persistence, keyboard focus/Escape, actual date text, working-count coexistence, no timestamp state, desktop/narrow placement and reduced motion. The image is labeled synthetic evidence, never a production connection claim.

- [ ] **Step 8: Stop with evidence for the parent's final integration.**

Report exact changed files, RED/GREEN output, request/operation counts and remaining browser findings. Parent owns fresh code review, the full canonical `npm test` (or its approved equivalent when npm is unavailable), one deterministic Graphify build/check after all source changes, manager knowledge maintenance, commits and any normal release/deployment parity. No worker commit, deployment, live query, staging overwrite or external message is authorized by this plan.

## Tasks NOT in this plan

No SQL, migrations, database timestamp column, new RPC/request, polling interval, timer, settings, feature flag, dependency, endpoint, normal master snapshot/client/model change, private field, audit-history/package/local fallback, import behavior, protection policy, publication/Archive authority, live backend probe, key read, deployment or unrelated UI redesign belongs to this change. Parent coordinates any later normal deployment parity after independent review; this design does not modify the frozen diagnostic stage.
