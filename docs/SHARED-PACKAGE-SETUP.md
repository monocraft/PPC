# Shared package setup without Azure

The viewer presses **Pull latest data**, enters a package key, and loads one encrypted package containing the Portfolio, Roadmap, and included product images. The package is decrypted and validated before the browser replaces its current workspace. The key is required for each pull and is not saved by the relay. The SharePoint link and package contents are not embedded in the public site.

The portable relay uses Node.js on an approved computer or server. Azure is not required. A signed-in owner or an approved synchronization job maintains a local mirror of the private SharePoint file. Viewers do not sign in to Microsoft through the application; they use the package key. The synchronization owner still needs Microsoft access, and the relay host must remain available.

## 1. Publish the encrypted master package

1. Open the complete Portfolio workspace and choose **Settings → Data & export → Export project package**. Keep **Protect the package with a key** selected. Enter the current package key to publish an update, or choose **Create new key** for the first publication. Choose **Export package** to download the encrypted `master_ppc.pkg`. The key remains available to copy until **Done** closes the dialog; keep it separately from the file. The optional unprotected private-backup choice is off by default.
2. Name the encrypted result `master_ppc.pkg` and upload it to your chosen SharePoint folder. If the initial file is a legacy unencrypted package, import it locally and export an encrypted shared package first. Renaming an unencrypted file does not encrypt it.
3. Keep the SharePoint file private. Give the publishing owners edit permission and the synchronization account read permission. An **Anyone** link is unnecessary for this setup. Microsoft explains that Anyone links allow access without authentication and can be forwarded: [SharePoint sharing link types](https://learn.microsoft.com/en-us/sharepoint/shareable-links-anyone-specific-people-organization).
4. Replace the same file when publishing updates, using the same package key while it remains valid. A changed key takes effect as soon as the new encrypted package reaches the relay; distribute the replacement key separately.

One package is authoritative for both application views. Pulling it replaces the current workspace rather than merging two independently maintained Portfolio and Roadmap exports. Keep a local backup before pulling if local changes must be retained.

## 2. Mirror the private SharePoint file

On the approved host, sign in to the SharePoint library using the synchronization owner's work account. Select the source folder and use **Add shortcut to OneDrive**, or the library's **Sync** button. Complete the OneDrive sign-in and verify that the file appears in File Explorer. Microsoft documents both methods and recommends the shortcut option where available: [Sync SharePoint and Teams files with your computer](https://support.microsoft.com/en-gb/sharepoint/sync/sync-sharepoint-and-teams-files-with-your-computer).

Mark the package folder **Always keep on this device** so the relay reads downloaded bytes rather than an online-only placeholder. Microsoft describes the downloaded-file status and offline availability in [OneDrive Files On-Demand](https://support.microsoft.com/en-gb/onedrive/save-disk-space-with-onedrive-files-on-demand-for-windows). Confirm a completed OneDrive sync after every publish. An approved job can instead download to a separate mirror folder and replace the file atomically after the download succeeds. Use a supported, managed host and the organization's approved account/process; this relay does not configure Microsoft credentials or unattended OneDrive sign-in.

Point the relay at the full local path to the encrypted file. For example, use a placeholder such as `C:/ApprovedPackageMirror/master_ppc.pkg`; replace it with the actual synchronized path only in the host's private configuration. Do not put the package or its source link inside `public/`, publish the mirror folder through a web server, or commit either to Git.

The relay checks the file's identity, size, and modification times for each pull, and periodically rereads the encrypted bytes even when those attributes are unchanged. It detects completed local changes without a restart. A pull retrieves the latest complete **mirrored copy**; OneDrive sync delays or an offline synchronization process can leave that copy behind SharePoint. Monitor sync health separately. File modification time alone cannot establish that SharePoint has been checked recently.

## 3. Configure and start the portable relay

Install a supported Node.js release, preferably Node 22 or newer. The service has no external Node dependencies. Copy `server/.env.example` to an ignored `server/.env` on the approved host and edit its placeholders:

```dotenv
PPC_PACKAGE_FILE=C:/ApprovedPackageMirror/master_ppc.pkg
PPC_ALLOWED_ORIGINS=https://monocraft.github.io
PPC_BIND_HOST=127.0.0.1
PPC_PORT=8787
PPC_RATE_LIMIT=30
PPC_RATE_WINDOW_MS=60000
PPC_MAX_CONCURRENT=2
PPC_TRUSTED_PROXY_IPS=
```

Run from the repository root:

```text
node --env-file=server/.env server/package-relay.mjs
```

The default listener is `127.0.0.1:8787`. The startup command permits only loopback binding. Keep the service running through the approved host's service manager and grant it read access only to the configured file. It does not write to SharePoint or the mirror. `GET /health` returns only a service status; it does not disclose paths or check whether the owner has finished syncing.

For local application development, add the exact origin `http://127.0.0.1:4173` to `PPC_ALLOWED_ORIGINS`, separated by a comma. Origins contain the scheme, hostname, and optional port; `https://monocraft.github.io/PPC` is a path and is not a valid origin. Keep the production origin list specific; `*` is rejected.

## 4. Provide HTTPS for other users

Have IT expose the loopback service through an approved HTTPS reverse proxy using a valid certificate and a stable hostname, such as `https://packages.example.com`. Node remains private on loopback; remote users connect to HTTPS. The frontend's relay setting should be the full endpoint `https://packages.example.com/api/package/latest`. The browser must be able to reach that hostname, including through the corporate VPN if required.

The proxy should:

- Forward only the package endpoint and, if required for monitoring, the health endpoint.
- Limit request bodies to 2 KiB, disable response caching, and keep reasonable connection timeouts.
- Preserve the browser's `Origin` header. Let the relay supply its explicit CORS response headers.
- Avoid recording request bodies, package keys, or package bytes in logs.
- Overwrite `X-Forwarded-For` with one client IP if per-client rate limiting is required. Then set `PPC_TRUSTED_PROXY_IPS` to the proxy's actual loopback peer address, for example `127.0.0.1`. Without this setting the relay deliberately ignores that header and applies the rate limit to the direct socket peer. Never trust an arbitrary public address range or a client-supplied forwarding chain.

An Nginx location example for the IT owner is:

```nginx
location = /api/package/latest {
    client_max_body_size 2k;
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 20s;
    proxy_cache off;
}
```

The example belongs inside the organization's existing HTTPS server configuration. Certificate management, TLS settings, firewall access, service availability, and optional edge rate limits remain the host administrator's responsibility. CORS permits a browser origin; possession of the package key is what authorizes the download.

## 5. Configure the application endpoint

The source file `public/js/package-source.js` starts with an empty endpoint. This is intentional: a checkout does not contain the private SharePoint link, credentials, or a guessed live service. A deployment remains unconnected until an approved relay endpoint is supplied.

For GitHub Pages, open the repository's **Settings → Secrets and variables → Actions → Variables** and create the repository variable **`PPC_PACKAGE_ENDPOINT`** with the full approved HTTPS endpoint, for example `https://packages.example.com/api/package/latest`. This value is a public service address, not a package key or SharePoint viewing link. Never put a key in it. Run the Pages deployment after adding or changing the variable. The workflow uses `scripts/configure-package-source.mjs --output _site/js/package-source.js` to generate only the approved endpoint in the deployed site; the checked-in source retains its empty default.

For a local fixture relay, allow `http://127.0.0.1:4173` in the relay's origin list and start the local site with:

```text
node scripts/serve.mjs --package-endpoint http://127.0.0.1:8787/api/package/latest
```

This supplies the endpoint to the local page without editing or committing `public/js/package-source.js`. Use encrypted synthetic fixtures for development. The local service address must not be used as the shared production endpoint: other users' computers have their own loopback address.

## 6. Pull and verify

After the approved endpoint is deployed, select **Pull latest data**, enter the package key, and confirm the pull. The request is `POST /api/package/latest` with a small JSON body containing only `key`. The relay authenticates the encrypted file with that key and returns the original encrypted bytes. It never returns its temporary decrypted copy, retains keys between requests, or accepts a client-provided file path or source URL. The browser independently decrypts and validates the package before importing it.

Manual **Import project package** supports existing stored-ZIP packages and encrypted packages. Encrypted imports prompt for the package key. The importer stages incoming images before committing the new metadata and retains the previous workspace and its image references as one recovery copy. **Restore previous workspace** restores that copy on the same browser origin; a later successful import or restore replaces the one saved recovery slot. Keep a separate downloaded backup for longer-term recovery. Lightweight `.data` imports remain their separate existing metadata-only flow.

Verify these cases before distributing the endpoint:

1. The correct key loads the same products, roadmap metadata, and included images as the owner's export.
2. A wrong key leaves the current workspace intact.
3. Upload a new encrypted version using the same key, wait for a complete sync, and pull again. The new workspace appears without restarting the relay.
4. A missing file, legacy unencrypted package, unsupported encrypted envelope, or file larger than 64 MiB returns a generic unavailable response.
5. Test a changed package key before distributing it. The previous key stops working against the new master.

Run the isolated relay verification with:

```text
node scripts/checks/package-relay.mjs
```

If the host cannot run an approved persistent relay, the supported fallback is to download the encrypted package from SharePoint and import it into the application with the package key. The standard SharePoint viewing URL cannot be treated as an authenticated cross-origin package API. Microsoft documents the redirect and browser preflight constraints of Graph file downloads: [Download file content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).
