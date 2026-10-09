# Shared master setup

The portfolio stays on GitHub Pages. Supabase accepts small product updates through one private saving function, and GitHub Actions publishes the complete encrypted package back to `monocraft/PPC`, branch `main`, at `public/data/master_ppc.pkg`.

Team members use their existing package unlock key and an optional display name. They do not need GitHub tokens, Supabase accounts, a separate team editing password, or a second sign-in. Names identify browser sessions and are self-reported.

After the first unlock, the browser tab reconnects and checks the shared master automatically. Its package key is kept in tab-scoped session storage for that exact master endpoint, so reloading does not require another package pull. Disconnecting or rejecting an invalid key clears the saved tab access. GitHub tokens and private backend credentials are never stored there. The connected sessions panel shows names and current product/category activity without setup instructions.

This repository contains the saving function, restricted database migration, publisher, and tests. The live connection must only be changed after the project has been configured, seeded from the existing master package, and verified.

## What is saved and when

- **Saved to shared master:** Supabase accepted the change and its conflict/revision checks in one transaction. Other connected portfolio users can pull the accepted value immediately.
- **GitHub package update pending:** The accepted change is waiting for package publication. It is already safe in the shared master; the downloadable GitHub package may still contain the preceding revision.
- **GitHub package current:** The publisher confirmed the encrypted package in GitHub and requested a Pages deployment. GitHub Pages deployment has its own workflow and can still be in progress.
- **GitHub package retry required:** Publication failed. Accepted changes remain in Supabase. The next publisher run retries without accepting the edit twice or replacing newer data with an older package.

The scheduled publisher checks approximately every five minutes. GitHub schedules run on a best-effort basis and can be delayed; five minutes is not a guaranteed delivery time. Owners can run **Publish encrypted shared master** manually from GitHub Actions to publish sooner. An optional private workflow dispatch token can request a run immediately after a save, but the default setup does not require a personal GitHub token.

## Owner setup

The `PPCDB` Supabase project and `monocraft/PPC` repository connection are already the intended destination. Linking the repository does not, by itself, grant the portfolio its shared saving connection.

1. Apply `supabase/migrations/202610080001_private_master.sql` to the production project. It creates the private master state, save receipts, presence records, and restricted database functions. It revokes table/function access from public, anonymous, and ordinary authenticated clients. Only the server function's private service credential may invoke the database operations.
2. Configure the private saving function's secrets listed below. Supabase supplies its project address and private server API credential to deployed functions; neither is copied into the portfolio's browser connection.
3. Regenerate the shared model copies with `node scripts/build-supabase-master.mjs`, then deploy `supabase/functions/ppc-master` as the `ppc-master` Edge Function. For the current project, the CLI command is `supabase functions deploy ppc-master --project-ref abzzcswajjzbordmwuuh --no-verify-jwt`; the signed-in dashboard deployment is another supported route. The included `supabase/config.toml` sets `verify_jwt = false`, because the function authenticates requests with the existing package unlock key. The database is still private, and a request without a valid package key or private publisher secret is refused.
4. Add the GitHub repository secrets and variable listed below through the repository settings. Enter private values directly into their secret fields. Do not add them to source files, public repository variables, issue comments, or chat.
5. Run **Publish encrypted shared master** once with **Initialize the empty shared master from the current GitHub package** checked. The publisher reads the actual current package from GitHub, decrypts it privately, seeds its full manifest, then publishes the initial verified source marker. Images and attachments remain in the existing archive.
6. Verify that the workflow succeeds and the shared endpoint can pull the same products, dates, specifications, SKUs, and portfolio placement. Verify two simultaneous users, explicit conflict choices, retained local drafts, publication status, and package round trips before enabling the live source.
7. Set the live portfolio source to the verified service endpoint and deploy the frontend. A normal GitHub Pages deployment reads its connection configuration from repository variables. Root setup should preserve the existing working live connection until this step.

Bootstrap only initializes an empty shared master. Repeating the exact original seed is safe. A different package or manifest cannot overwrite an already initialized project. Running bootstrap after publication changes the GitHub source package may therefore return **already initialized**; ordinary publication does not need another bootstrap.

## Private Supabase function secrets

| Secret | Purpose |
|---|---|
| `PPC_PACKAGE_KEY_HASH` | SHA-256 of the UTF-8, normalized existing `PPC-…` package key. The function stores the verifier, not the decrypting key. Generate it privately from the existing package key using `PortfolioPackage.normalizeKey` first. |
| `PPC_PUBLISHER_SECRET` | A fresh random secret with at least 32 characters, shared only between this private function and GitHub Actions. It authorizes export, seed, and publication receipts. It is not a Supabase administrative API key. |
| `PPC_ALLOWED_ORIGINS` | Exact comma-separated app origins, normally `https://monocraft.github.io`. Add `http://127.0.0.1:4190` only while using that local preview. No paths or wildcards. |
| `PPC_GITHUB_DISPATCH_TOKEN` | Optional. A private fine-grained token scoped to `monocraft/PPC` with **Actions: read and write** can request prompt publication. Leave unset for the default scheduled/manual publisher. |

Optional dispatch settings default to owner `monocraft`, repository `PPC`, and workflow `publish-master.yml`: `PPC_GITHUB_OWNER`, `PPC_GITHUB_REPO`, and `PPC_GITHUB_PUBLISH_WORKFLOW`.

Supabase's automatically provided private server credential remains within the Edge Function. The function prefers the default value in `SUPABASE_SECRET_KEYS` and supports Supabase's supplied legacy `SUPABASE_SERVICE_ROLE_KEY`. The public portfolio does not use either credential.

## Private GitHub Actions secrets

Repository: **monocraft/PPC → Settings → Secrets and variables → Actions → Secrets**.

| Secret | Purpose |
|---|---|
| `PPC_PACKAGE_KEY` | The existing normalized package key that unlocks `master_ppc.pkg`. Actions uses it privately to encrypt the complete updated package. |
| `PPC_PUBLISHER_SECRET` | The same scoped random publisher secret entered in Supabase. |

The workflow uses GitHub's built-in, short-lived `GITHUB_TOKEN` for **Contents: write** and **Actions: write**. No master PAT needs to be distributed to teammates or stored in the frontend. The Actions permission allows the publisher to request `deploy.yml` explicitly: commits made with the built-in token do not trigger ordinary push workflows.

Repository variables are public configuration, not credentials:

| Variable | Value |
|---|---|
| `PPC_MASTER_ENDPOINT` | `https://<project-ref>.supabase.co/functions/v1/ppc-master/api/master` |
| `PPC_MASTER_MODE` | `service`, once the seeded and tested connection is ready |

The encrypted full package can continue to load from GitHub. The service then pulls the freshest shared product snapshot, so accepted dates/specifications/SKUs can be fresher than the last package publication.

## Publisher behavior

`scripts/publish-supabase-master.mjs` reads one consistent full manifest and storage revision from the private bridge. It obtains the current encrypted package through GitHub's Contents metadata and immutable blob API. It decrypts privately, replaces only `portfolio.json`, and preserves every other archive entry byte for byte. The manifest retains image references, portfolio layout, custom row data, attachments, and owner comments.

Each package includes `masterSync.supabaseRevision` and a `masterSync.supabasePublication` marker. The marker identifies the source project and original package SHA, the storage revision, and digests of the manifest and retained archive entries. A newer published revision is never replaced with an older export. A changed manifest or asset archive from another source fails closed and requires owner reconciliation.

The upload supplies the expected current package blob SHA. Concurrent code changes on `main` are preserved. A concurrent package change is checked again before a retry. Branch protection or validation rejection with an unchanged package stops promptly.

After confirmed upload, the publisher requests `deploy.yml`, then acknowledges the exact revision and package SHA to Supabase. A lost upload response is recovered by checking the actual immutable blob SHA. A failed deployment request or receipt is retried from the marker, without creating another package commit. An accepted save that arrives during publication remains pending for the next revision.

The workflow has one shared concurrency group and `cancel-in-progress: false`. It runs on a manual request and a five-minute schedule. Its checkout does not persist credentials. Error output contains only stable failure codes and safe text; it does not print keys, tokens, database passwords, upstream response bodies, or product manifests.

The bridge operations are private `POST` requests to the shared base endpoint plus `/bootstrap`, `/export`, `/ack`, or `/failure`. The scoped publisher secret is sent as `X-PPC-Publisher-Secret`. The team-facing `/latest`, `/save`, and `/presence` operations cannot use it as a package unlock key.

## Verification and maintenance

Run `node scripts/checks/supabase-publisher.mjs` for archive integrity, safe bootstrap, package races, monotonically increasing publication, dropped replies, receipt/deployment recovery, and secret-safe failures. The backend tests cover package-key authentication, private database access, idempotent concurrent writes, and presence. Existing model/client tests cover date pairs, specification and SKU merge conflicts, cancellation, changed-away-and-back values, and edits made while a save is in progress.

Keep the browser and Edge model copies aligned with `node scripts/build-supabase-master.mjs --check`. After changing the canonical model, regenerate and deploy the function before introducing frontend behavior that requires the new model.

An unexpected replacement of `master_ppc.pkg` should be reconciled deliberately with the accepted shared master; the publisher will not silently import or overwrite it. Do not reset or replace the seeded database to clear a publication warning. For a new project or a restored backup, follow a reviewed migration/restore procedure.

If an unlock key or publisher secret is rotated, update both sides privately and test the connection before reopening team saving. The database password is separate from the package unlock key and is not used by teammates or this publisher.

### PLC/date-evidence deployment status

On October 9, 2026, the production `ppc-master` function in `PPCDB` was updated through the signed-in Supabase dashboard. Only `shared/master-model.js` changed. The deployed source was read back after reload and its SHA-256 matched the generated local model: `ed5b6a2b383a0c9557cda73e0af643e85e560fedcacf8a8512cf3ee5ea1b2158`. The endpoint returned HTTP 204 for the `https://monocraft.github.io` CORS preflight and HTTP 401 `INVALID_KEY` for a request without a package key.

The existing package-key authentication and `verify_jwt = false` setting were preserved. This backend deployment applied no SQL migration, changed no secrets or access settings, and made no business-data writes. Frontend availability is verified separately through the corresponding Pages deployment and live resource checks. After the browser release, verify one controlled authenticated collection/save and its independent date timestamps; that check was not performed during the backend deployment.

For rollback, restore the previous function deployment or its prior model while preserving the existing function settings and secrets. The retained previous model has SHA-256 `3a93b167d315e7201af8ba9ca4c2b691bf2de394b13caa644dfc840a1bc67e28`. Pause or roll back the importer frontend first if it has been released: the previous backend rejects new PLC evidence saves, which remain pending locally. A function rollback does not require resetting, reseeding, or replacing the database.

## References

- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase database function security](https://supabase.com/docs/guides/database/functions)
- [GitHub Actions built-in token](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)
- [GitHub scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub Contents API expected-SHA writes](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)
