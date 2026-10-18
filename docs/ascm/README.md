# Canonical native ASCM production source

`native-production-flow.json` is the complete nonsecret production definition.
`native-reviewed-fragments.json` freezes the four reviewed noncredential
checkpoint inputs so generation does not depend on an ignored authoring ledger.
The minute recurrence in the older root fragment was deliberately omitted; the
reviewed corrected Hour/1 trigger with concurrency 1 is the only trigger input.
`scripts/native-ascm-flow.mjs` applies the explicit recovery changes and writes
the canonical definition and `native-field-change-manifest.json` deterministically.

Run from the repository root:

```text
node scripts/native-ascm-flow.mjs --write
node scripts/native-ascm-flow.mjs --check
node scripts/checks/native-ascm-flow.mjs
node scripts/checks/native-ascm-outcomes.mjs
```

The validator is a strict allowlist of this production artifact. It rejects all
field drift, copied aliases, altered scopes, malformed connector parameters,
literal credentials, insecure history, parallel report loops, bootstrap actions,
and schedule changes. Diagnostics use fixed known action names, source paths and
codes, never supplied values or unexpected property/action names. A successful
local result proves canonical source parity; it does not compile or execute a
flow in Microsoft. The local expression evaluator in the outcome check executes
the actual gate expressions against synthetic interruption fixtures; it is not
a general WDL runtime. Maximum action nesting is 6 (limit 8), with two new peer
actions and no extra conditional nesting.

Apply the seven `essential-recovery` field changes first using the existing native
actions and the exact fields in the manifest. The seventeen `bounded-safe-retry`
entries are separate settings changes. They are required for final canonical
parity but can be validated in a separate native authoring pass. There are no
cosmetic Boolean rewrites: existing UI-generated `@true` expressions stay intact;
literal string booleans remain forbidden. Preserve the credential and existing
connection bindings described in `native-existing-bindings.json`.

The manifest compares against the reviewed production checkpoints, not the
temporary manual bootstrap. Production restoration also requires removing every
Bootstrap node, restoring `Initialize_report_guard.runAfter` to credential
success, and restoring the exact Hour/1 concurrency-1 trigger. The canonical
definition contains none of that temporary residue. Keep the flow Off until
native readback parity, backend deployment parity, and the actual report/Archive
release gates pass. Do not export or read the owner credential action while
assembling nonsecret parity evidence.

## Outcome recovery and its limits

After any succeeded, failed or timed-out create, `Read_actual_stage` retrieves
the same candidate-bound, unique GUID stage path. `Stage_bytes_match` is a strict
Compose guard: `int(if(and(...),'1','Stage_mismatch'))` fails on a mismatch; only
guard success permits the existing `Promote_package`. The comparison requires
nonempty native binary-envelope `$content` on both the actual stage and the
download, and equality of the full values. It never substitutes download bytes
for the later final readback. Create file still consumes the binary Body token,
keeps proven native chunking, timeout PT2M, and retry None. Promotion still uses
empty-body MoveTo(flags=0), retry None, with its existing final metadata/version/
actual-byte reconciliation after success, failure, or timeout. The proven 64 MiB
fixture used `$content` equality; native worker-download `$content` shape still
requires a bounded runtime proof. An absent envelope fails the guard safely.

The native [Create file schema](https://learn.microsoft.com/en-us/connectors/sharepointonline/#create-file)
exposes dataset, folderPath, name and binary body. It does not expose a documented
conflict-fail option. This source preserves the proven candidate-plus-GUID stage
and one create attempt, rather than inventing an overwrite field. It therefore
provides same-run lost-create recovery, not a deterministic cross-run create-only
primitive. A total run death may leave an orphan stage. No absence read authorizes
a retry of the same uncertain create, and no delete/cleanup action was added.
Strict conditional staging or durable orphan hygiene remains a release limitation
unless separately proven and approved. Final promotion remains explicitly
no-overwrite and the authoritative backend confirms final actual bytes.

After an attempted Outlook move, success, failure and timeout all reach GET of
the identical immutable message ID. Archive verification repeats the fresh
published per-report gate, original pre-move Inbox identity, original internet
message ID, attempted move status, and positive same-ID readback in the resolved
Archive. It does not rely on a move reply or search for a replacement. An older
valid ready candidate can now publish before newer accepted facts, but the newer
report still needs its own fresh published replay to Archive.

SharePoint connection-state precedence includes the actual stage read after
promotion and before create. A stage-read 401 or existing allowlisted auth code
therefore overrides an earlier successful create. A 403, transport failure, or
local stage-guard mismatch never independently reports a logout. Later actual
successful SharePoint service reads retain their normal clearing precedence.

Safe reads and idempotent import/queue/confirmation requests use the documented
[exponential retry policy](https://learn.microsoft.com/en-us/azure/logic-apps/error-exception-handling#retry-policies)
with count 2, interval/minimum PT5S, maximum PT30S, and action timeout PT2M.
Create, promote and mail move keep retry None. Native policy response selection
and handling of a large Retry-After are platform behavior, not a custom allowlist;
local tests establish the finite settings, not a runtime Retry-After cap. Confirm
the actual Copilot designer accepts/persists these settings before release. No
custom unsupported status-code or Retry-After fields are present.
