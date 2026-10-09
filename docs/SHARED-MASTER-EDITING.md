# Shared master editing

The recommended team connection is now the private [Supabase shared master setup](SUPABASE-SETUP.md). Teammates use the existing package unlock key and an optional name, without personal GitHub tokens or another login. It supports product creation/removal, specifications, SKU/colorway updates, every shared lifecycle date, live category/product presence, and explicit concurrent conflict choices. Accepted updates are immediately available to connected teammates; the encrypted GitHub package is published automatically with separate pending/error status. The direct GitHub and local service instructions below remain available as fallbacks.

PPC saves supported product edits directly to the encrypted `public/data/master_ppc.pkg` in `monocraft/PPC`, on `main`. GitHub stores the master and accepts updates; a separate server is not required. The checked-in app and Pages configuration select this GitHub mode by default.

## The user flow

1. Choose **Pull latest data** and enter the existing package key. The app reads the current encrypted file directly from GitHub and unlocks it on this device.
2. Edit a product detail, milestone date, planned launch/end month, specification, HP SKU or variant SKU detail. The main action changes to **Save to master**.
3. Review the changes and optionally give a reason. On the first save in this page session, enter your own GitHub access token. Your GitHub account must already have permission to update the repository.
4. If another team changed the same detail, choose **Use mine** or **Keep master** for each conflict. No choice is preselected. Cancel keeps the unsent edits.
5. A successful save commits one encrypted master update. The action returns to **Pull latest data**. Other users can read the accepted update immediately from the repository without waiting for a Pages rebuild.

The package key is never sent to GitHub. The GitHub token is sent only in the authorization header to `https://api.github.com`. Both credentials stay in memory and are cleared on disconnect, reload or a change to the package key. They do not belong in repository variables, local storage, URLs, downloaded packages or application source. Use an individual token per editor; do not share the owner's token.

## GitHub access

The repository owner can use a fine-grained personal token restricted to `PPC`, with **Contents: Read and write**. A token does not grant repository access that the account does not already have. GitHub currently limits fine-grained tokens for outside/repository collaborators; those editors may require a classic token with `public_repo` for this public repository. Classic tokens can reach other public repositories that account can write, so use an expiration and the minimum supported scope. See [GitHub's token setup and limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) and [file-update permissions](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents).

Repository rules can require pull requests or otherwise block direct commits to `main`. The app reports a denied update and keeps the draft. This mode requires direct update permission for the master file; it does not bypass branch rules. The app does not create accounts, invite collaborators, or generate tokens for users.

## Simultaneous saves

Each save reads the current file SHA and its immutable encrypted blob, then compares the original product fields and revisions against that master. Different dates, specification properties and SKU entries combine. Competing edits to the same field produce an explicit conflict. Launch/GA and its planned launch month are checked together, as are end-of-manufacturing and its planned end month. Invalid lifecycle combinations and duplicate SKU codes require correction.

The updated package is encrypted locally and submitted with the expected file SHA. If another save wins that race, the app reads the new master and repeats the comparison. It never retries by blindly overwriting the whole portfolio. A user's conflict choices are checked again before they are accepted. The entire submission saves together; a conflict does not partially write other products.

Per-field revisions catch values that changed away from and back to their original values. A bounded request journal recognizes accepted saves whose response was interrupted. GitHub commit messages contain only a generic portfolio-update description; detailed reasons and changed values remain inside the encrypted package.

## Editor circles

GitHub mode shows **Recent editors** beside the category selector. The panel lists accounts recorded by accepted shared saves and when they saved. The connected GitHub account supplies its username and available display name; users do not need to invent a label. This history is not an online count, and the app does not claim that those people currently have the page open.

Actual **Connected now** circles are available only for the optional service mode below. That service uses temporary heartbeats, anonymous browser labels and optional display names. GitHub mode sends no presence commits or heartbeat writes.

## Refresh, scope and persistence

Quiet refresh checks the shared facts while the page is visible and idle. The GitHub transport caches decrypted contents by immutable file SHA, so an unchanged master requires only its metadata check. Authenticated sessions check about every two minutes; public read-only sessions check about every five minutes. Rate limits or network failures leave drafts intact. Imports, active editing and conflict dialogs pause refresh.

Shared facts include name, codename, price and price label, tier, product status, variant label, roadmap family/stage/confidence/relationships, six exact milestone dates, planned start/end months, specifications, HP SKU codes and assignments, and variant SKU text/color details. Image binaries, local image assignments, category/lane layout, display settings, and creating/deleting whole products remain full-package/local operations.

The saved master retains image ZIP entries and unrelated manifest fields. Its update timestamp advances, and automatic save comments list every accepted product's full saved name. Multiple changed fields list a product once; separate products sharing a name remain separate entries. Automatic PLC comments include both the import context and the complete product list. User-supplied save notes are preserved. The generated comment is stamped from the complete accepted save before history pruning and stays inside the encrypted package.

Manual notes remain limited to 2,000 characters. Stored update comments allow up to 2 MiB of text so long automatic name lists are not silently shortened; existing manifest/package bounds still apply. The request/revision watermark retains the complete comment when older audit records are pruned. Bounded encrypted history records changed facts and the GitHub account used for the save. Local baselines preserve the origins of unsent edits across refreshes and browser reloads. ASCM updates to supported facts become pending changes and use the same conflict flow.

## Publish the application

Publish the changed app through the existing Pages workflow. With no service override, `scripts/configure-package-source.mjs` generates GitHub mode for the fixed repository/master path. No access token or package key is a deployment setting. `PPC_MASTER_MODE=static` intentionally restores read-only hosted-package behavior. Do not set separate package/master service endpoints unless choosing service mode for both.

Each accepted GitHub master save creates a repository commit, which also triggers the existing Pages workflow. Reading the master through the API avoids that rebuild delay. Frequent binary changes grow Git history, so review normal repository storage usage for a large portfolio.

The current master is about 24.8 MB. Preserving its complete encrypted package means each save uploads about 33 MB after Base64 encoding, even for a small date change. Review several edits together in one save when practical. Package transfers have a two-minute deadline; smaller metadata/account requests have a 30-second deadline.

## Optional service mode and local trial

`npm run try:master` starts the isolated three-product trial at `http://127.0.0.1:4187`. It uses a separate temporary encrypted master and browser workspace; it does not write to GitHub or change the real portfolio. This trial exercises the shared conflict UI using the optional local service.

The alternative `server/master-service.mjs` supports a durable private master on an approved HTTPS host. Configure `PPC_MASTER_FILE`, a `PPC_MASTER_WRITE_TOKEN` of at least 24 characters, `PPC_ALLOWED_ORIGINS`, `PPC_BIND_HOST` and `PPC_MASTER_PORT`. Set public `PPC_PACKAGE_ENDPOINT` and `PPC_MASTER_ENDPOINT` to that same service. Run one service instance for a consistent presence roster. Remote writes require both the package key and separate editing key. Cooperating writers use file locks and atomic replacements; pause an independent manual publisher while the service owns its file.

For a private local master, `node scripts/serve.mjs --master-file <absolute-package-path> --local-edits` serves the app and API together on loopback. Local editing is explicitly enabled and does not grant remote access.

Verification includes encrypted GitHub roundtrips with simulated HTTP responses and SHA races, revision/merge checks, service persistence, client draft/conflict behavior, package imports and editor representations. Automated GitHub checks do not write the live repository or use real credentials.
