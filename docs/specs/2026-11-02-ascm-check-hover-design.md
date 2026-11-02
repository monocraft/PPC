# Completed ASCM checks in the existing clock hover

The owner wants to know that the weekly SharePoint check completed even when no
new report was available. Extend the existing clock hover; keep the compact
header, face replies, working lease, key alert and accepted-update age.

## Presentation

The tooltip contains two quiet rows using the existing typography, semantic
colors, border and spacing. The first reads `Last checked` with the completion's
local date and time, followed by `No new report` for `unchanged`, or `New report
found` for `staged`. The second retains `Last ASCM update`, its local-calendar
age and date. Its existing green 0–29 days / amber 30+ days behavior is unchanged.
With no valid paired check evidence, say `No completed ASCM check recorded.`
Never infer a check from opening PPC, presence polling or package publication.
Keep hover/focus/Escape, pointer bridge, disconnect and reduced-motion behavior.

## Completed-check signal

Reuse the existing private synced intake folder. A cloud completion emits one
create-only `<checkId>.check` file, at most1024 UTF-8 bytes, with the exact shape:

```json
{"schemaVersion":1,"kind":"sharepoint_check","checkId":"11111111-1111-4111-8111-111111111111","completedAt":"2026-11-03T21:04:23.000Z","outcome":"unchanged"}
```

The timestamp is frozen at actual completion, canonical millisecond UTC, never
future. The name must match its UUID. The unchanged branch emits after its source
binding/equality proofs and before its successful termination. The staged branch
emits after positive cursor persistence. Discovery/staging failure emits no
success receipt. If creating the correct receipt succeeds but its cloud readback
fails, that correct immutable receipt can still arrive through sync: it records
the completed source check, not success of every subsequent delivery action.
Do not treat unchanged staging as proof PPC accepted the workbook.

The worker discovers these separate-extension files without changing the existing
JSON/workbook scanner. It validates, chooses the newest completion, and durably
deduplicates acknowledged receipts. Send through the existing authenticated
connection route as the exact new alternative shape
`{service:'sharepoint',check:{checkId,completedAt,outcome}}`. Preserve the legacy
`{service,state}` shape. A check report never changes connection/reconnect flags.

The existing private status singleton stores only the latest completion ID, time
and outcome. Newer completions advance it; exact replay and older reports are
acknowledged without a write; conflicting current identity or equal-time records
are rejected. Existing presence exposes only `lastCheckedAt` and `checkOutcome`.
Gateway and client validate these fields together and discard invalid/future pairs.
The accepted timestamp continues to come solely from manifest.ascmSnapshot.importedAt.

## Retry and usage boundaries

Check reporting is an event-driven diagnostic POST. Persist a check-only retry
deadline before every attempt (at least one hour apart), retain exact pending
receipt on lost/false acknowledgement, and acknowledge durably on success.
Preserve active source/publication priority and the six-call/eight-minute pass
budget. A pass that attempts a check-only report exits before the queue GET.
Malformed check files and pending checks whose independent retry is not yet due
leave the normally charged idle queue recovery available. Failure must not alter
business retryAt or provider flags. Without a new event, the worker retains its
existing one-hour/24-per-day metadata-only idle allowance, with no added polling,
downloads, imports, publication or email operations.

## Alternatives and evidence

Frontend-only inference cannot establish a completed check: normalizeAscmSupervisor
currently has only an accepted date, and the actual unchanged flow terminates
before creating any intake artifact. Reading Power Automate on every PPC hover
would require additional access and requests. A tiny private receipt reuses the
existing approved handoff and status channel, including its failure isolation.

## Verified assumptions

- Graphify query and current source identify master-presence.js normalize/render
  and gateway.mjs safeAscmSupervisor as the two public filtering boundaries.
- Local UI baseline: all20 supervisor presence checks pass at35b51a7.
- 202610170004_ascm_connection_reporting.sql owns the existing service-only
  reporting RPC and singleton; its isolated PGlite baseline passes.
- ppc-ascm-flow/http.mjs routes authenticated exact connection bodies to the lazy
  reporter; no new endpoint or authentication grant is required.
- Worker _manifest_files scans only UUID.json in intake, while finish reports
  actual provider outcomes separately. execute owns durable hourly queue charging.
- The retained executable flow's Skip_unchanged_staged compares Source_before to
  cursor.source and terminates Succeeded before Operation_id/manifest generation.
- Source, publication and provider flags have separate consumers; completed-check
  diagnostics must not change their state or accepted portfolio facts.
- The existing main remote is578b7a3; this attached worktree has two local schedule
  and documentation commits, and only unrelated untracked deno.lock.

## Activation limit

This runtime reports `Local browser use is disabled in Work settings`. Prepare
and verify the exact cloud edit locally without bypassing that setting. Do not
claim production support until the cloud producer, backend and worker are deployed
and the frontend receives real completion evidence. Do not backfill a fabricated
check from the present date. The prior observed October27 run is historical proof,
not an automatically recurring signal.
