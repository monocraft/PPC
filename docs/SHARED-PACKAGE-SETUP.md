# Hosted encrypted master package

The shared master is the encrypted `public/data/master_ppc.pkg` in the PPC repository. GitHub Pages publishes it at `https://monocraft.github.io/PPC/data/master_ppc.pkg`. Viewers choose **Pull latest data**, enter their package key, and load Products and Roadmap together. No Microsoft account, extension, app registration, or separate package server is required for this connection.

The encrypted file is publicly downloadable. The package key remains separate from the repository and is used only to decrypt and validate the package in the viewer's browser. Static pulls never send the key to GitHub. The repository and site must contain neither an unencrypted master nor a key file.

## Build and publish an update

1. Open PPC with the current complete master loaded. Make the required product, roadmap, specification, variant, or image changes.
2. Choose **Settings → Data & export → Build master package**. Keep **Protect the package with a key** selected and enter the **existing package key**. Use **Create new key** only for the first publication or an intentional key change.
3. Choose **Build package**. PPC downloads the encrypted `master_ppc.pkg`. The key remains available to copy until **Done** closes the dialog, then it is cleared. If the browser adds `(1)` to the downloaded name, rename it back to exactly `master_ppc.pkg`.
4. In [the repository's data folder](https://github.com/monocraft/PPC/tree/main/public/data), choose **Add file → Upload files**. Upload the newly built `master_ppc.pkg` into this same folder, replacing the existing file. Do not upload the key or an unprotected backup.
5. Commit the replacement to `main`, using a message such as `Update master portfolio package`. The existing GitHub Pages workflow checks the encrypted envelope and publishes the updated site.
6. Wait until the latest **Deploy to GitHub Pages** run succeeds in [GitHub Actions](https://github.com/monocraft/PPC/actions). The GitHub commit alone does not mean the updated package is available on the live site yet.
7. Open the [live PPC app](https://monocraft.github.io/PPC/), choose **Pull latest data**, and verify the update with the existing key. Users can now pull the same new master.

For a normal data update, only replace **one file**, `public/data/master_ppc.pkg`. Keep its folder and filename unchanged. No application source changes or new key are needed. GitHub redeploys the site automatically after the replacement commit.

GitHub's browser uploader accepts files up to 25 MiB. Larger packages can be committed through Git or GitHub Desktop; PPC itself accepts packages up to 64 MiB. See [GitHub's file upload documentation](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository). Frequent large binary updates also grow repository history; GitHub recommends keeping Pages repositories below 1 GB. See [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

## What viewers see

- **Pull latest data** asks for the package key and fetches the current encrypted master with a fresh request, bypassing ordinary cached copies.
- Decryption, package validation, and image staging happen before the current workspace is replaced. Download failures, a wrong key, or an invalid package leave the current workspace intact.
- A wrong-key retry can reuse the already downloaded encrypted bytes while the dialog remains open. Closing the dialog clears that temporary copy and the key. Opening a new pull fetches the master again.
- A successful import updates Products, Roadmap, settings, variants, and included images together. It replaces local edits rather than merging them. Build a separate private backup before pulling if those edits must be retained.
- **Import project package** remains available for a downloaded package or an older private backup.

## Publishing checks and optional local helper

`node scripts/checks/hosted-package.mjs --required` checks the deployed master envelope and rejects an unencrypted ZIP, an oversized package, unexpected package files, or symlinks under `public/data`. This runs before GitHub Pages publishes.

The optional local publishing helper can validate and copy an encrypted download into the fixed repository path before committing it:

```powershell
node scripts/publish-master-package.mjs --input "C:/PrivateDownloads/master_ppc.pkg" --key-file "C:/PrivateKeys/PACKAGE-KEY.txt"
```

The key file is read locally for authenticated decryption and validation; it is never copied to `public/`, printed, or uploaded. Keep it in a private, ignored location. The app's package builder remains the normal way to make updates.

## Intentional key changes

Build and publish with a new key only when deliberately changing access to future master packages. Distribute the replacement key separately to intended viewers. Earlier downloads and encrypted files retained in repository history still exist; a new key does not revoke data already obtained with an earlier key.

## Optional service compatibility

The older package relay remains available for deployments that explicitly configure `PPC_PACKAGE_ENDPOINT`. Leaving that setting empty selects the hosted encrypted master above. This PPC deployment uses the static master and does not require the relay, SharePoint source links, or browser companion.
