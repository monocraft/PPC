# Monthly ASCM cloud supervisor

This optional workflow checks the owner's Outlook Inbox hourly from GitHub's cloud, submits a published HyperX ASCM workbook to the PPC cloud backend, and archives the message only after the accepted import revision is published. It does not need the owner's computer. It is **disabled until explicitly configured and enabled**; adding these source files alone creates no running supervisor.

The owner chose monthly published releases only. The allowlist is sender `linny.chen@hp.com`, subject `ASCM Report Accessories HyperX Release Notification <Month> <Year>`, and exactly one non-inline `ASCM Report_HyperX_YYYY-MM-DD.xlsx` attachment. Weekly Review Notifications and unrelated mail are excluded. The source filename date must be in the publication month or immediately preceding month and cannot be after the email's received date.

## What it changes

The API reads the accepted shared master directly and reuses the existing ASCM parser and master-model transaction logic. It can collect source evidence, update unambiguous supported catalog facts, and add products in existing categories/lanes. It preserves existing assets/images, prices, specifications, custom properties, explicit lifecycle status, order gaps and source-absent products. It never sends mail or deletes products.

An ambiguous match, source category relocation, malformed/partially parsed report, invalid date ordering or protected date change holds the entire report. The endpoint does not silently apply a subset and archive the message. Workbooks above 2 MiB or beyond the bounded cloud parser's expansion/row limits stay for manual import.

## One-time Microsoft authorization

Use a dedicated single-tenant Microsoft Entra application and grant **Exchange Online Application RBAC `Application Mail.ReadWrite` scoped to the owner's mailbox**. Do not add a tenant-wide Microsoft Graph application `Mail.ReadWrite` grant in Entra: the two permission systems are additive, so an unscoped Entra grant would bypass the intended mailbox restriction. Do not grant `Mail.Send`. This Exchange role supports the required read/move operations without send permission. [Microsoft's Application RBAC guidance](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).

1. **Check the owner's roles.** Sign in to [Microsoft Entra admin center](https://entra.microsoft.com/) in the mailbox's organization. Open **Entra ID → Users → your account → Assigned roles**, or **Roles & admins → Your Role**. Check active assignments; an eligible PIM role may need activation. App registration can be available to ordinary users when tenant settings allow it, or through **Application Developer** / an application administrator. These rights alone do not authorize Exchange mailbox access. [View role assignments](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/view-assignments), [delegate app registration](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/delegate-app-roles).

2. **Register the application.** Open **Entra ID → App registrations → New registration**; name it `PPC ASCM supervisor`, select the single-tenant account type, and register. Record the **Application (client) ID** and **Directory (tenant) ID** for the repository secrets below. For Exchange's service-principal pointer, also find the application under **Enterprise applications** and record its **Object ID**; this is a different object from the app-registration Object ID. [Register an app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [Exchange service principal](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-serviceprincipal?view=exchange-ps).

3. **Have an authorized Exchange administrator grant the mailbox scope.** Microsoft specifies **Exchange Administrator** in Entra and **Organization Management** in Exchange, or equivalent delegated Exchange application-role assignment rights. If the owner lacks these, the organization's Exchange/identity administrator must perform this part. This design uses an Exchange role assignment rather than a tenant-wide Graph admin-consent button. [Application RBAC requirements](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac#requirements).

The following is a template for that administrator, not a command to run before authorization. Replace placeholders, confirm the recipient filter selects exactly the intended mailbox, and use unique names if objects already exist. It contains no credentials:

```powershell
Connect-ExchangeOnline -UserPrincipalName '<authorized-admin-UPN>'
$ascmClientId = '<application-client-ID>'
$ascmPrincipalObjectId = '<enterprise-application-object-ID>'
$ascmOwnerMailbox = '<owner-mailbox-address>'

New-ServicePrincipal -AppId $ascmClientId -ObjectId $ascmPrincipalObjectId -DisplayName 'PPC ASCM supervisor'
New-ManagementScope -Name 'PPC ASCM owner mailbox' -RecipientRestrictionFilter "EmailAddresses -eq 'smtp:$ascmOwnerMailbox'"
New-ManagementRoleAssignment -Name 'PPC ASCM mailbox access' -App $ascmPrincipalObjectId -Role 'Application Mail.ReadWrite' -CustomResourceScope 'PPC ASCM owner mailbox'

Test-ServicePrincipalAuthorization -Identity $ascmPrincipalObjectId -Resource $ascmOwnerMailbox
Test-ServicePrincipalAuthorization -Identity $ascmPrincipalObjectId -Resource '<different-mailbox-address>'
```

See the official [scope command](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-managementscope?view=exchange-ps), [recipient filter properties](https://learn.microsoft.com/en-us/powershell/exchange/recipientfilter-properties?view=exchange-ps), [role assignment command](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-managementroleassignment?view=exchange-ps), and [authorization test](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/test-serviceprincipalauthorization?view=exchange-ps).

4. **Verify both permission systems before activation.** Expect `Application Mail.ReadWrite` with `InScope=True` for the owner and `False` for the other mailbox. The test excludes separate Entra permission grants: also inspect the enterprise application's granted permissions and remove any broad mailbox application consent for this dedicated app. Allow for Microsoft's permission-cache delay, then use a separately authorized bounded access check to confirm the owner is accessible and the other mailbox is denied. Keep the job disabled until effective access is verified. [RBAC testing and limitations](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac), [review enterprise-app permissions](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-application-permissions).

5. **Configure the workload credential securely.** The current runner accepts a client secret created under **App registrations → this app → Certificates & secrets → Client secrets → New client secret**. Put its **Value**, not its secret ID, directly into the repository's `PPC_ASCM_CLIENT_SECRET` secret; never paste it into chat. Microsoft recommends certificate or federated credentials for production; if organizational policy requires those, extend this runner's authentication before activation. [Credential guidance](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials).

The Codex Outlook connector's sign-in cannot supply this cloud application's app-only token. An approved app registration, scoped Exchange authorization and a supported workload credential are separate prerequisites.

## Alternative: a user-connected Power Automate cloud flow

A scheduled Power Automate cloud flow could use the owner's signed-in **Office 365 Outlook** connection to check Inbox with the same monthly sender/subject/attachment rules, call the same PPC ASCM API, and move that exact email to Archive **only when `archiveAllowed` is explicitly `true`**. Pending publication, review holds or failures must leave the message in Inbox for the next scheduled attempt. This cloud approach can run while the owner's PC is off and uses a user connection rather than the app-only registration described above. [Outlook connector reference](https://learn.microsoft.com/en-us/connectors/office365/).

Office 365 Outlook is a **standard** connector, but the external HTTP action or a custom connector needed to reach PPC requires appropriate **premium** entitlement; an existing Microsoft 365 license alone may not cover the full flow. HP's Power Platform data-loss-prevention policies may also prohibit combining Outlook with the external PPC endpoint. Confirm licensing and permitted data movement with the organization, protect HTTP secrets and sensitive action inputs/outputs, and retain the same backend validation/publication gate. [Power Automate licensing](https://learn.microsoft.com/en-us/power-platform/admin/power-automate-licensing/types), [HTTP/custom-connector entitlement](https://learn.microsoft.com/en-us/power-automate/assign-user-license-service-principal-flow), [data policies](https://learn.microsoft.com/en-us/power-platform/admin/wp-data-loss-prevention).

This alternative is documented only: no Power Automate flow or forwarding rule has been created or enabled. This chat has no receiving email address; forwarding a report to the assistant is not an unattended ingestion path.

## Server configuration

Deploy the updated existing `ppc-master` Edge Function through the project's normal reviewed release process. No new database migration is needed: it reuses private `read`, `commit` and `rate` RPCs and their immutable receipts. Preserve every existing gateway secret and publisher configuration.

Set these additional **server secrets**, using the provider's secure secret input (never a committed file or a shell command containing literal secret values):

| Name | Value |
| --- | --- |
| `PPC_ASCM_IMPORT_SECRET` | Dedicated random token, 32–512 non-whitespace characters. Share only with this job; never use the publisher secret or portfolio key. Leaving it unset disables the route. |
| `PPC_ASCM_DATE_POLICY` | Optional explicit approved date policy described below. |

The route is `POST https://<project>.supabase.co/functions/v1/ppc-master/api/master/ascm`, authenticated with `X-PPC-ASCM-Secret`. It denies browser-origin requests. JSON fields are exactly `{sender, subject, receivedAt, messageId, fileName, workbookBase64}`. It accepts no caller-supplied manifest, patches, package key or publisher credential.

PPC date locks currently live on the owner's devices. The cloud cannot infer them. Without an approved server policy, any change to an existing product's GA/EM is held. To authorize date updates, review/export relevant device locks and explicitly set a policy such as:

```json
{"version":1,"allowUpdates":true,"protected":[{"productId":"example-product-id","fields":["generalAvailabilityDate","endManufacturingDate"]}]}
```

An explicitly approved empty `protected` list authorizes all otherwise-valid existing GA/EM updates. It is not evidence that devices have no local locks. Keep this policy synchronized when owners change relevant local protections. New products can use their source dates without replacing existing facts. Invalid policy configuration fails closed.

## GitHub repository configuration

Use the repository's secure Actions secrets UI to set:

| Secret | Purpose |
| --- | --- |
| `PPC_ASCM_TENANT_ID` | Microsoft Entra tenant UUID. |
| `PPC_ASCM_CLIENT_ID` | Dedicated application's UUID. |
| `PPC_ASCM_CLIENT_SECRET` | Dedicated application's client secret; rotate before expiry. |
| `PPC_ASCM_MAILBOX` | Exact authorized mailbox address/UPN. |
| `PPC_ASCM_API_URL` | Full HTTPS ASCM route above. |
| `PPC_ASCM_IMPORT_SECRET` | The dedicated server import token. |

Set repository variable `PPC_ASCM_START_AFTER` to an explicit ISO timestamp for the desired start. Use the activation time for future mail only. Backfilling older reports requires separately choosing an earlier cutoff and reviewing stale/conflict behavior.

Keep repository variable `PPC_ASCM_ENABLED` unset or `false` until ready. The workflow and direct Node entrypoint both require exactly `true`. With that gate enabled, missing or invalid configuration returns `needs_attention` and a failing job rather than reporting `disabled`. The workflow is `.github/workflows/ascm-supervisor.yml`; it grants only `contents: read`, serializes its runs, and does not upload messages/workbooks as artifacts. The Node job uses no LLM, package installation or local browser session.

GitHub scheduled jobs run from the default branch and can be delayed under load; they are an hourly background check, not an instant-delivery SLA. Review repository scheduling/inactivity rules and available Actions usage before activation. See [GitHub's schedule event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Transaction, publication and retry behavior

The backend computes `requestId = ascm-<SHA256 of workbook bytes>`. Its fingerprint binds that digest to the monthly publication identity. Native receipts make repeated bytes safe even after a lost HTTP reply. The response exposes only request ID, accepted revision, counts and status. A duplicate email containing the same accepted report can be archived after its publication is confirmed.

Successful responses include `archiveAllowed`, which is true only after an independent native receipt read and `publication.publishedRevision >= receipt.storageRevision`. Accepted but unpublished reports return HTTP 202 and remain in Inbox. A later hourly run retries the same digest; an idempotent publisher dispatch may be requested again if the first dispatch/reply was lost. A concurrent master save returns a held HTTP 409 for that request; a later run starts with a fresh baseline and revalidates the report. Import/review/access errors do not trigger an Archive move.

The Graph runner requests immutable message IDs and verifies the Archive move response against the exact message ID and the resolved Archive folder. If a move succeeds but its response is lost, the email is already in Archive and no longer appears in the next Inbox check. The import receipt remains accepted; the runner reports uncertainty for that invocation rather than pretending the reply was verified. [Microsoft's immutable ID contract](https://learn.microsoft.com/en-us/graph/outlook-immutable-id) describes ID stability within a mailbox.

An idle inbox check makes no PPC/Supabase request. A matching pending report makes only bounded per-report import/receipt/publication requests. Each run examines at most the 25 newest server-filtered messages across five pages, so a retained old backlog cannot prevent a new monthly report from being checked. Older held reports outside that bound require manual review. This adds no health watcher, live SQL polling, unrelated email triage or deployment monitor. Logs contain sanitized counts/errors, not subjects, message IDs, workbook cells, access tokens or master data.

## Local checks and activation

Run synthetic local checks:

```powershell
node scripts/checks/ascm-cloud-plan.mjs
node scripts/checks/ascm-cloud-api.mjs
node scripts/checks/ascm-supervisor.mjs
node scripts/build-supabase-master.mjs --check
```

These use generated workbooks, real parser/master models, isolated RPC fixtures and a fake Graph transport. They do not exercise tenant consent, deployed secrets, live publication or actual mail movement.

Before enabling the hourly job, deploy the reviewed endpoint, configure the mailbox-scoped application and secrets, approve the protection policy/start cutoff, and perform one explicitly authorized supervised end-to-end run on a chosen real report. Confirm the saved revision, publication and final Archive outcome. Then set `PPC_ASCM_ENABLED=true`. Review the first scheduled outcome; disable by setting that variable to `false`. Rotation/revocation of the dedicated import token disables server access independently.

If Microsoft tenant consent, Actions availability, secret configuration, production deployment or the supervised test is unavailable, the source is prepared but the supervisor is **not active**. Do not represent an unconfigured schedule as a working service.
