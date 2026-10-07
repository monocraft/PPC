# Shared master editing

Release status: this change is prepared on `codex/private-master-backend`. Keep the current production deployment until a reachable private HTTPS backend is configured and verified. GitHub Pages alone cannot enable private team saves. Publishing this branch's application code without a backend leaves anonymous master pulls available and team saves setup-required; it does not complete the rollout.

PPC uses one private team connection for supported product changes. The browser talks to a private saving service; that service reads and updates the encrypted `public/data/master_ppc.pkg` in `monocraft/PPC`, on `main`. Team members do not create GitHub tokens, connect GitHub accounts, or need repository write access. They can optionally set a display name.

The application code and Pages deployment do not create a hosted service by themselves. Configure a real HTTPS backend before enabling live saves. When `PPC_MASTER_ENDPOINT` is missing, the app can still pull the encrypted public master anonymously from GitHub, but **Save to master** reports that the private team connection needs setup. No invented or public placeholder service receives edits.

## The user flow

1. Choose **Pull latest data** and enter the existing package key. The app downloads, unlocks, and validates the current master before replacing the workspace.
2. Optionally set a display name through the connected-session panel. Anonymous browser labels work without one. The label is editable; no account or GitHub token is required.
3. Edit a product detail, milestone date, planned launch/end month, specification, HP SKU or variant SKU detail. The main action changes to **Save to master**.
4. Review the changes and optionally give a reason. If another team changed the same detail, choose **Use mine** or **Keep master** for each conflict. No choice is preselected. Cancel keeps unsent edits.
5. A successful save updates the encrypted GitHub master through the service. The action returns to **Pull latest data**. Other users read the accepted update directly through the backend without waiting for a Pages rebuild.

The package key is also the team editing credential: anyone who has it and can reach the configured backend can read and save supported facts. Display names are self-reported labels, not verified identities. This simple team flow does not add individual accounts, role-based permissions, or a per-person audit identity. If those are required later, add authentication at the backend rather than asking users for repository credentials.

## Configure the private connection once

The service can run on a company server or an always-on computer behind a real HTTPS endpoint, with VPN access if needed. It does not require a third-party hosting account. The machine must remain available whenever the team saves; other users cannot access a `127.0.0.1` address on your computer. For access from anywhere, IT must provide a reachable HTTPS address rather than only an internal or loopback address. The repository includes [Dockerfile.master](../Dockerfile.master) and [.env.example](../.env.example) for that private deployment.

Backend environment settings:

| Setting | Value / purpose |
| --- | --- |
| `PPC_MASTER_STORAGE` | `github` selects the GitHub-backed master. |
| `PPC_GITHUB_TOKEN` | Private server-only token with **Contents: Read and write**, restricted to `monocraft/PPC`; Metadata read-only is required. |
| `PPC_ALLOWED_ORIGINS` | `https://monocraft.github.io`, or the exact origins approved to use the service. |
| `PORT` | The host-provided listening port. |
| `PPC_BIND_HOST` | `127.0.0.1` for a local listener; `0.0.0.0` inside a container or behind the approved network/HTTPS setup. |
| `PPC_TLS_CERT_FILE`, `PPC_TLS_KEY_FILE` | Optional certificate/key paths for native HTTPS; otherwise terminate HTTPS at the approved reverse proxy. |

Run `npm run serve:master` after setting those variables privately. With Node 22, a private environment file can be loaded directly:

```text
node --env-file=<absolute-private-environment-file> server/master-service.mjs
```

The service does not automatically load a project `.env` file. Put the GitHub token in the machine's private environment or the host's secret settings. Do not reuse a token exposed in chat or screenshots. Keep real environment files outside `public/` and Git.

For Docker:

```text
docker build -f Dockerfile.master -t ppc-master .
docker run --env-file <absolute-private-environment-file> -e PPC_BIND_HOST=0.0.0.0 -p 127.0.0.1:8788:8788 ppc-master
```

The Docker example publishes only to the host's loopback interface. Put the company's HTTPS reverse proxy in front of it. Native TLS is also supported when both certificate paths are supplied and the host/container network is configured appropriately. A process started locally or a committed Dockerfile does not create public connectivity.

The token must belong to an account already able to update the repository. Repository rules can still block direct commits to `main`; the service reports a denied save and retains the browser draft. See [GitHub's file-update permissions](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents). The token remains on the server and is never returned to the browser, committed, or embedded in a Pages artifact. Backend requests must avoid logging their body because that body includes the package key.

After the service is running, set the **public GitHub repository variable** `PPC_MASTER_ENDPOINT` to its real master API URL, for example `https://<your-service-host>/api/master`, and rerun the Pages deployment. This address is public configuration, not a credential. The build derives `/api/package/latest` from that same service origin and API base path. An explicit `PPC_PACKAGE_ENDPOINT`, if set, must match the derived address. Never place `PPC_GITHUB_TOKEN` or a package key in GitHub repository variables used by Pages.

`PPC_MASTER_MODE=static` deliberately selects read-only hosted package pulls. A legacy `PPC_MASTER_MODE=github` variable now selects anonymous GitHub reads while team saves remain unconfigured; it cannot restore a per-user token dialog.

## Simultaneous saves

Each save reads the current master and compares the original product values and revisions. Changes to different fields, specification properties, or SKU entries combine. Competing edits to the same field produce an explicit conflict. Launch/GA and its planned launch month are checked together, as are end-of-manufacturing and its planned end month. Invalid lifecycle combinations and duplicate SKU codes require correction.

The service preserves the full package, encrypts the result, and commits it with GitHub's expected file SHA. If a competing save updates the file first, the current master is read again and compared before retrying. It never blindly overwrites the whole portfolio. Conflict choices are checked again before acceptance. An entire submission saves together; a conflict does not partially write other products.

Per-field revisions catch a value changed away from and back to its original value. A bounded encrypted request journal recognizes accepted saves whose response was interrupted. Public GitHub commit messages contain only a generic update description; display labels, detailed changes, and reasons stay inside the encrypted package.

## Connected-session circles

The backend maintains temporary connected-session heartbeats. The circles beside the category selector show recent active browser sessions, whether they are viewing or editing, and optional display names. A browser with no name receives a short anonymous label. Names are optional and can be changed without affecting the private GitHub connection.

Presence is limited to the service instance handling the heartbeats. Use one instance for a consistent roster. A disconnected or closed browser disappears after its heartbeat expires; this is a recent-activity indicator rather than a verified account directory. Display names do not prove who made a change.

## Refresh, scope, and persistence

The client quietly refreshes supported shared facts when the page is visible and idle. Active editing, imports, and conflict dialogs pause refresh. Network failures leave drafts intact. The GitHub-backed service uses immutable encrypted blob reads and expected-SHA commits; other tabs can merge independent changes safely.

Shared facts include name, codename, price and price label, tier, product status, variant label, roadmap family/stage/confidence/relationships, six exact milestone dates, planned start/end months, specifications, HP SKU codes and assignments, and variant SKU text/color details. Image binaries, local image assignments, category/lane layout, display settings, and creating/deleting whole products remain full-package/local operations.

Saves retain image ZIP entries and unrelated manifest fields. The update timestamp advances; existing publisher comments remain. Bounded encrypted history records the changed facts and the supplied editor label. Browser baselines preserve the origins of unsent edits across refreshes and reloads. ASCM changes to supported facts use the same review/conflict flow.

The current master is about 24.8 MB. Each GitHub master save uploads the whole encrypted package, about 33 MB after Base64 encoding. Review several edits together when practical. Binary updates grow repository history, so review normal repository storage usage. Each accepted master save also triggers the Pages workflow, but backend reads do not wait for that rebuild.

## Local trial and file-backed service

`npm run try:master` starts the isolated three-product trial at `http://127.0.0.1:4187`. It uses a separate temporary encrypted master and browser workspace. It does not write to GitHub or change the real portfolio. The green trial banner is restricted to this explicitly enabled loopback trial and is excluded from the live configuration.

The alternative fixed-file service remains available through `server/master-service.mjs`. Set `PPC_MASTER_FILE`, `PPC_ALLOWED_ORIGINS`, bind/port settings, and its private editing policy. Legacy deployments with `PPC_MASTER_WRITE_TOKEN` need a separate browser editing key; the default team configuration does not expose that flow. For the current simple team workflow use the GitHub-backed private service and package-key authorization above.

For a private local master, `node scripts/serve.mjs --master-file <absolute-package-path> --local-edits` serves the app and API together on loopback. Local editing is explicitly enabled and does not grant remote access.

Automated verification uses encrypted fixtures and simulated GitHub responses. It checks draft retention, repeated conflicts, request completion recovery, package preservation, and presence behavior. Tests do not require a real token or write the live master. Publishing the application and verifying those tests do not prove that a hosted backend has been deployed or that its credential has write permission.
