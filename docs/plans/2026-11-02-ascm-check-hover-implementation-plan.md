# ASCM completed-check hover implementation

Source: docs/specs/2026-11-02-ascm-check-hover-design.md, thorough-brainstorming
verified design, written against35b51a7. The owner's existing instruction to
complete authorized work without repeated confirmation applies to routine design
and implementation decisions. No additional access, spend or polling is proposed.

## Tasks

1. Extend existing clock markup, styling and client normalization in
   public/js/master-presence.js and public/css/styles.css. Add actual behavior
   regressions to scripts/checks/ascm-supervisor-presence-ui.mjs first; verify
   failure, then completion/unknown/future/invalid/outcome/lease/disconnect behavior.
2. Extend connection reporting's exact alternative shape in gateway.mjs and
   ppc-ascm-flow/http.mjs. Add a new migration retaining service-only access and
   legacy behavior, preserving reconnect flags, active leases and accepted facts.
   Add offline gateway/HTTP and PGlite tests for monotonicity, replay, conflicts,
   validation, default-off, grants and presence projection before implementation.
3. Extend scripts/ascm-sync-worker.py and its existing Python test suite for local
   .check receipts, protected state upgrade, deduplication, independent retry and
   event-only reporting. Keep old idle/active/provider behavior. Tests use existing
   injected transport and private temporary folders; never invoke the live worker.
4. Prepare a deterministic source-only transformer for the retained executable
   SharePoint flow, inserting proof-guarded receipt actions in both success paths.
   Check unchanged-before-terminate and staged-after-positive-persistence, exact
   format/readback, no HTTP connector, unchanged recurrence/connection/other actions.
   Do not write the transformed flow into the installed proof binding.
5. Review all diffs; run affected checks, deployment closure, required offline SQL
   and project checks as appropriate. Build/check the deterministic Graphify map
   once after final source changes. Maintain affected PPC handbook facts. Prepare
   source deployment artifacts and describe any activation still blocked.

Tasks1–3 can run in parallel after the contract review. Task4 depends on the
agreed receipt format; final review depends on all implementation tasks.

## Plan assumptions verified

- Existing UI fixture and check command execute with Node directly (20baseline
  passes); existing CSS tooltip rules are in public/css/styles.css:249 onward.
- Existing reporter tests are scripts/checks/ascm-connection-gateway.mjs (not a
  guessed ascm-connection.mjs); SQL fixture uses installed PGlite and all migrations.
- Worker tests are scripts/checks/ascm-sync-worker.py with a Node runner at the
  matching .mjs path. _Pass.call accepts idle and replay parameters, so a separate
  diagnostic attempt can avoid business retry state and HTTP retry loops.
- Both gateway safeAscmSupervisor and client normalizeAscmSupervisor filter fields;
  both must be extended, without modifying accepted manifest snapshots.
- Existing prepare-ascm-flow-deployment.mjs stages reviewed source only, and the
  static Pages workflow validates npm check plus generated source parity.
- The existing browser RPC rejects access as disabled; saving a live cloud edit
  cannot be assumed possible. Source and local verification remain possible.
