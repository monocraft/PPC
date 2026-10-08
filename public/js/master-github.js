/* Direct encrypted master updates. GitHub credentials stay in this page's memory. */
(function (root) {
  "use strict";

  const API = "https://api.github.com";
  const API_VERSION = "2022-11-28";
  const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
  const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
  const MAX_PUT_BYTES = Math.ceil(MAX_PACKAGE_BYTES / 3) * 4 + 16384;
  const DEFAULT_CONFIG = Object.freeze({ mode: "github", owner: "monocraft", repo: "PPC", branch: "main", path: "public/data/master_ppc.pkg", label: "Master portfolio" });
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const codec = () => root.PortfolioPackage;
  const model = () => root.PortfolioMasterModel;

  function failure(message, code, status = 0) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  function normalizeConfig(config = {}) {
    if (!object(config)) throw failure("The GitHub master connection is invalid.", "INVALID_CONFIG");
    if (Object.keys(config).some(key => !["mode", "owner", "repo", "branch", "path", "label", "apiBase"].includes(key))) throw failure("The GitHub master connection contains unsupported settings.", "INVALID_CONFIG");
    const candidate = { ...DEFAULT_CONFIG, ...config };
    if (candidate.mode !== "github" || String(candidate.owner).toLowerCase() !== "monocraft" ||
      String(candidate.repo).toLowerCase() !== "ppc" || candidate.branch !== "main" || candidate.path !== DEFAULT_CONFIG.path ||
      (candidate.apiBase !== undefined && candidate.apiBase !== API) || typeof candidate.label !== "string" || candidate.label.length > 120) {
      throw failure("Use the configured PPC master in monocraft/PPC on main.", "INVALID_CONFIG");
    }
    return Object.freeze({ ...DEFAULT_CONFIG, label: candidate.label.trim() || DEFAULT_CONFIG.label });
  }

  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }

  async function hash(value) {
    if (!root.crypto?.subtle) throw failure("Master updates require a secure browser connection.", "UNAVAILABLE");
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
    const result = new Uint8Array(await root.crypto.subtle.digest("SHA-256", bytes));
    return [...result].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function base64(bytes) {
    const chunks = [];
    // A multiple of three keeps independently encoded chunks joinable.
    for (let offset = 0; offset < bytes.length; offset += 32766) {
      chunks.push(root.btoa(String.fromCharCode(...bytes.subarray(offset, offset + 32766))));
    }
    return chunks.join("");
  }

  async function boundedBytes(response, limit, onProgress) {
    const declared = response.headers?.get?.("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
      await response.body?.cancel?.();
      throw failure("The GitHub response exceeds the master size limit.", "MASTER_TOO_LARGE", 413);
    }
    const reader = response.body?.getReader?.();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > limit) throw failure("The GitHub response exceeds the master size limit.", "MASTER_TOO_LARGE", 413);
      onProgress?.({ loaded: bytes.length, total: declared ? Number(declared) : bytes.length });
      return bytes;
    }
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > limit) {
          await reader.cancel();
          throw failure("The GitHub response exceeds the master size limit.", "MASTER_TOO_LARGE", 413);
        }
        chunks.push(part.value);
        onProgress?.({ loaded: length, total: declared ? Number(declared) : 0 });
      }
    } finally { reader.releaseLock?.(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }

  function recentEditors(manifest) {
    const entries = [];
    const seen = new Set();
    const journal = Array.isArray(manifest.masterSync?.githubRequests) ? manifest.masterSync.githubRequests.slice(-64) : [];
    for (const record of journal.reverse()) {
      if (!object(record) || typeof record.actor !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(record.actor) || seen.has(record.actor)) continue;
      seen.add(record.actor);
      entries.push({ login: record.actor, name: String(record.name || record.actor).slice(0, 120), at: String(record.at || "").slice(0, 40) });
      if (entries.length >= 12) break;
    }
    return entries;
  }

  function validateManifest(manifest, entries) {
    if (!object(manifest)) throw failure("The master portfolio is damaged.", "INVALID_MASTER");
    const modern = [2, 3, 4].includes(manifest.version) && Array.isArray(manifest.categories) && manifest.categories.length;
    const legacy = manifest.version === 1 && Array.isArray(manifest.products) && Array.isArray(manifest.lanes);
    if (!modern && !legacy) throw failure("The master portfolio uses an unsupported format.", "INVALID_MASTER");
    const categoryIds = new Set();
    const boards = modern ? manifest.categories.map(category => {
      if (!object(category) || typeof category.id !== "string" || !category.id || categoryIds.has(category.id)) throw failure("The master portfolio has invalid categories.", "INVALID_MASTER");
      categoryIds.add(category.id); return category.board;
    }) : [manifest];
    const references = new Set();
    for (const board of boards) {
      if (!object(board) || !Array.isArray(board.products) || !Array.isArray(board.lanes)) throw failure("The master portfolio has invalid product boards.", "INVALID_MASTER");
      for (const product of board.products) {
        if (!object(product) || typeof product.name !== "string") throw failure("The master portfolio has invalid products.", "INVALID_MASTER");
        if (product.imageAssetId) references.add(product.imageAssetId);
        for (const group of product.variantGroups || []) for (const item of group.items || []) if (item.imageAssetId) references.add(item.imageAssetId);
      }
    }
    if (manifest.imageAssets !== undefined && !Array.isArray(manifest.imageAssets)) throw failure("The master image library is invalid.", "INVALID_MASTER");
    const imageIds = new Set();
    for (const asset of manifest.imageAssets || []) {
      if (!object(asset) || typeof asset.id !== "string" || !asset.id || imageIds.has(asset.id) || (asset.sourceType !== undefined && !["local", "url"].includes(asset.sourceType))) throw failure("The master image library is invalid.", "INVALID_MASTER");
      imageIds.add(asset.id);
      if (asset.sourceType === "url") continue;
      const extension = String(asset.fileName || asset.name || "").match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
        || ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "image/avif": "avif" }[asset.mimeType] || "img");
      const path = asset.packagePath || `images/${asset.id}.${extension}`;
      if (typeof path !== "string" || !path.startsWith("images/") || !entries.get(path)?.length) throw failure("The master is missing a product image.", "INVALID_MASTER");
    }
    if (!legacy || manifest.imageAssets !== undefined) for (const id of references) if (!imageIds.has(id)) throw failure("The master refers to a missing product image.", "INVALID_MASTER");
    codec().normalizePackageInfo(manifest.packageInfo);
    model().snapshot(manifest);
  }

  function createTransport(options = {}) {
    const config = normalizeConfig(options.config || options.source || {});
    const fetchImpl = options.fetchImpl || root.fetch;
    if (typeof fetchImpl !== "function") throw failure("A GitHub connection is unavailable in this browser.", "UNAVAILABLE");
    const repository = `${API}/repos/${config.owner}/${config.repo}`;
    const contents = `${repository}/contents/${config.path}?ref=${encodeURIComponent(config.branch)}`;
    let token = String(options.token || "").trim();
    let identity = null;
    let cached = null;
    let tail = Promise.resolve();
    let disconnected = false;
    let credentialGeneration = 0;
    let blockedUntil = 0;
    const pendingControllers = new Set();
    const responseDeadlines = new WeakMap();
    const timeoutMs = options.requestTimeoutMs === undefined ? 30000 : Number(options.requestTimeoutMs);
    const transferTimeoutMs = Number(options.transferTimeoutMs ?? options.requestTimeoutMs ?? 120000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 25 || timeoutMs > 120000 ||
      !Number.isInteger(transferTimeoutMs) || transferTimeoutMs < 25 || transferTimeoutMs > 300000) throw failure("The GitHub request timeout is invalid.", "INVALID_CONFIG");

    function credential(value) {
      if (value !== undefined) setToken(value);
      if (token && (token.length > 512 || /[\s\u0000-\u001f\u007f]/.test(token))) throw failure("Enter a complete GitHub editing token.", "INVALID_GITHUB_TOKEN", 401);
      return token;
    }

    function setToken(value) {
      const next = String(value || "").trim();
      if (next !== token) {
        token = next; identity = null; blockedUntil = 0; credentialGeneration += 1;
        for (const controller of pendingControllers) controller.abort();
        clearCache();
      }
      disconnected = false;
    }

    function clearCache() {
      if (cached?.entries) for (const bytes of cached.entries.values()) bytes.fill(0);
      cached = null;
    }

    async function call(url, { method = "GET", accept = "application/vnd.github+json", body, signal, access = credential() } = {}) {
      if (!url.startsWith(`${API}/`) || new URL(url).origin !== API) throw failure("The GitHub connection is invalid.", "INVALID_CONFIG");
      if (Date.now() < blockedUntil) {
        const error = failure("GitHub's request limit has not reset yet. Try again after the limit resets.", "GITHUB_RATE_LIMIT", 429);
        error.retryAt = blockedUntil;
        error.retryUntil = blockedUntil;
        throw error;
      }
      const controller = new AbortController();
      pendingControllers.add(controller);
      let timedOut = false;
      const abort = () => controller.abort();
      signal?.addEventListener?.("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const budget = method === "PUT" || accept.includes("raw") ? transferTimeoutMs : timeoutMs;
      const timer = root.setTimeout(() => { timedOut = true; controller.abort(); }, budget);
      const cleanup = () => { root.clearTimeout(timer); signal?.removeEventListener?.("abort", abort); pendingControllers.delete(controller); };
      let response;
      try {
        response = await fetchImpl(url, {
          method, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
          headers: { Accept: accept, "X-GitHub-Api-Version": API_VERSION, ...(access ? { Authorization: `Bearer ${access}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
          ...(body ? { body } : {}),
        });
      } catch (error) {
        cleanup();
        if (timedOut) throw failure("GitHub did not respond in time. Your local changes are safe; try again.", "UNAVAILABLE");
        if (error?.name === "AbortError") throw error;
        throw failure("Cannot reach GitHub. Your local changes are safe; try again when connected.", "UNAVAILABLE");
      }
      responseDeadlines.set(response, { cleanup, timedOut: () => timedOut });
      let secondaryLimit = false;
      if (response.status === 403 && response.headers?.get?.("x-ratelimit-remaining") !== "0" && !response.headers?.get?.("retry-after")) {
        try {
          const bytes = await readResponse(response, 64 * 1024);
          const info = JSON.parse(new TextDecoder().decode(bytes));
          secondaryLimit = /secondary rate limit|abuse detection|api rate limit exceeded/i.test(String(info?.message || ""));
        } catch (error) { if (error.code === "UNAVAILABLE" || error.name === "AbortError") throw error; }
      }
      let error;
      if (response.status === 401) error = failure("That GitHub token was not accepted. Enter a valid token for your account.", "INVALID_GITHUB_TOKEN", 401);
      else if (response.status === 429 || (response.status === 403 && (secondaryLimit || response.headers?.get?.("x-ratelimit-remaining") === "0" || response.headers?.get?.("retry-after")))) {
        const reset = Number(response.headers?.get?.("x-ratelimit-reset")) * 1000;
        const retry = response.headers?.get?.("retry-after");
        const retryTime = /^\d+$/.test(retry || "") ? Date.now() + Number(retry) * 1000 : Date.parse(retry || "");
        blockedUntil = Math.max(Date.now() + 60000, Number.isFinite(reset) ? reset : 0, Number.isFinite(retryTime) ? retryTime : 0);
        error = failure("GitHub's request limit was reached. Try again after the limit resets, or connect your GitHub token.", "GITHUB_RATE_LIMIT", response.status);
        error.retryAt = blockedUntil;
        error.retryUntil = blockedUntil;
      } else if (response.status === 403) error = failure("Your GitHub token needs access to this repository with Contents read and write permission.", "GITHUB_PERMISSION_DENIED", 403);
      else if (response.status === 404) error = failure(access ? "Your GitHub token cannot access the PPC master. Check its repository access." : "The shared PPC master could not be found on GitHub.", access ? "GITHUB_PERMISSION_DENIED" : "MASTER_NOT_FOUND", 404);
      else if (response.status >= 500) error = failure("GitHub is temporarily unavailable. Your local changes are safe.", "UNAVAILABLE", response.status);
      if (error) { cleanup(); response.body?.cancel?.().catch?.(() => {}); throw error; }
      return response;
    }

    async function readResponse(response, maximum, onProgress) {
      const deadline = responseDeadlines.get(response);
      try { return await boundedBytes(response, maximum, onProgress); }
      catch (error) {
        if (deadline?.timedOut()) throw failure("GitHub did not finish responding in time. Your local changes are safe.", "UNAVAILABLE");
        throw error;
      } finally { deadline?.cleanup(); responseDeadlines.delete(response); }
    }

    function discardResponse(response) {
      responseDeadlines.get(response)?.cleanup(); responseDeadlines.delete(response);
      response.body?.cancel?.().catch?.(() => {});
    }

    async function json(response, maximum = 256 * 1024) {
      try {
        const bytes = await readResponse(response, maximum);
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch (error) {
        if (error.code) throw error;
        throw failure("GitHub returned an incomplete response. Your local changes are safe.", "INVALID_RESPONSE");
      }
    }

    async function getIdentity({ githubToken, signal } = {}) {
      const access = credential(githubToken);
      if (!access) return null;
      if (identity) return clone(identity);
      const response = await call(`${API}/user`, { signal, access });
      if (!response.ok) { discardResponse(response); throw failure("Your GitHub account could not be verified.", "INVALID_GITHUB_TOKEN", response.status); }
      const user = await json(response);
      if (!object(user) || typeof user.login !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user.login)) throw failure("GitHub returned an invalid account profile.", "INVALID_RESPONSE");
      const result = { login: user.login, name: String(user.name || user.login).slice(0, 120), avatarUrl: typeof user.avatar_url === "string" && /^https:\/\/avatars\.githubusercontent\.com\//.test(user.avatar_url) ? user.avatar_url : "" };
      if (access === token && !disconnected) identity = result;
      return clone(result);
    }

    async function load({ signal, onProgress } = {}) {
      const response = await call(contents, { accept: "application/vnd.github.object+json", signal });
      if (!response.ok) { discardResponse(response); throw failure("The master file could not be read from GitHub.", "INVALID_RESPONSE", response.status); }
      const metadata = await json(response, 2 * 1024 * 1024);
      if (!object(metadata) || metadata.type !== "file" || !/^[a-f0-9]{40}$/.test(metadata.sha || "") || !Number.isInteger(metadata.size) || metadata.size < 58 || metadata.size > MAX_PACKAGE_BYTES) throw failure("The GitHub master is invalid or exceeds the 64 MiB size limit.", "INVALID_MASTER");
      if (cached?.sha === metadata.sha) return cached;
      const raw = await call(`${repository}/git/blobs/${metadata.sha}`, { accept: "application/vnd.github.raw+json", signal });
      if (!raw.ok) { discardResponse(raw); throw failure("The master file could not be downloaded from GitHub.", "INVALID_RESPONSE", raw.status); }
      const bytes = await readResponse(raw, MAX_PACKAGE_BYTES, onProgress);
      if (bytes.length !== metadata.size || !codec().isEncrypted(bytes) || new TextDecoder().decode(bytes.subarray(0, 8)) !== "PPCPKG01") throw failure("The downloaded master is incomplete or is not an encrypted PPC package.", "INVALID_MASTER");
      clearCache();
      cached = { sha: metadata.sha, bytes, entries: null, manifest: null, keyVerifier: "" };
      return cached;
    }

    async function unlock(source, key) {
      if (!codec() || !model()) throw failure("The shared master tools could not be loaded.", "UNAVAILABLE");
      let normalized;
      try { normalized = codec().normalizeKey(key); }
      catch { throw failure("Enter the complete package key for this master.", "INVALID_KEY", 401); }
      const verifier = await hash(normalized);
      if (source.manifest && source.keyVerifier === verifier) return source;
      let plaintext;
      let entries;
      try {
        try { plaintext = await codec().decrypt(source.bytes, normalized); }
        catch { throw failure("The package key was not accepted, or the encrypted master is damaged.", "INVALID_KEY", 401); }
        entries = codec().readZip(plaintext);
        const bytes = entries.get("portfolio.json");
        if (!bytes || bytes.length > MAX_MANIFEST_BYTES) throw failure("The master portfolio exceeds the 4 MiB data limit.", "INVALID_MASTER");
        const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        validateManifest(manifest, entries);
        entries.get("portfolio.json").fill(0);
        if (source.entries) for (const bytes of source.entries.values()) bytes.fill(0);
        source.entries = entries; source.manifest = manifest; source.keyVerifier = verifier;
        return source;
      } catch (error) {
        if (entries) for (const bytes of entries.values()) bytes.fill(0);
        if (error.code) throw error;
        throw failure("The master package could not be read. Your local changes are safe.", "INVALID_MASTER");
      } finally { plaintext?.fill(0); normalized = ""; }
    }

    function snapshot(source, account) {
      return {
        ...model().snapshot(source.manifest), revision: source.sha, packageInfo: codec().normalizePackageInfo(source.manifest.packageInfo),
        masterSync: model().publicMetadata(source.manifest),
        source: "github", identity: account ? clone(account) : null, recentEditors: recentEditors(source.manifest),
        canWrite: Boolean(account), requiresGitHubToken: !account, requiresEditorToken: false,
      };
    }

    function serialized(operation) {
      const result = tail.then(operation);
      tail = result.catch(() => {});
      return result;
    }

    async function latestOperation({ key, githubToken, signal } = {}) {
      credential(githubToken);
      const source = await unlock(await load({ signal }), key);
      const account = token ? await getIdentity({ signal }) : null;
      return { snapshot: snapshot(source, account) };
    }

    async function readOperation({ signal, onProgress } = {}) {
      const source = await load({ signal, onProgress });
      return source.bytes;
    }

    async function saveOperation({ key, githubToken, requestId, changes, reason = "", signal } = {}) {
      const access = credential(githubToken);
      const generation = credentialGeneration;
      if (!access) throw failure("Connect your GitHub account to save updates to the master.", "GITHUB_TOKEN_REQUIRED", 403);
      if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId) || !Array.isArray(changes) || changes.length > 500 || typeof reason !== "string" || reason.length > 1000) throw failure("The master update details are invalid.", "INVALID_REQUEST", 400);
      const account = await getIdentity({ signal });
      const fingerprint = await hash(canonical({ actor: account.login, reason, changes }));
      let uncertain = false;
      let validationSha = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const source = await unlock(await load({ signal }), key);
        const journal = Array.isArray(source.manifest.masterSync?.githubRequests) ? source.manifest.masterSync.githubRequests.slice(-64) : [];
        const completed = journal.find(record => object(record) && record.requestId === requestId && record.actor === account.login);
        if (completed) {
          if (completed.fingerprint !== fingerprint) throw failure("This save identifier was already used for different changes. Start a new save.", "INVALID_REQUEST", 400);
          return { snapshot: snapshot(source, account), savedFields: completed.savedFields, savedProducts: completed.savedProducts, requestId, alreadySaved: true };
        }
        if (validationSha && source.sha === validationSha) throw failure("GitHub rejected the update. Check repository Contents write permission and branch rules before retrying.", "GITHUB_SAVE_REJECTED", 422);
        validationSha = "";
        let result;
        try { result = model().mergeChanges(source.manifest, changes, { actor: account.login, team: "GitHub", reason, requestId, now: new Date().toISOString() }); }
        catch { throw failure("An update is invalid. Check the product dates, specifications, and SKU details.", "INVALID_CHANGE", 422); }
        if (result.conflicts.length) return { error: "The master changed while you were editing. Choose which values to keep.", code: "MASTER_CONFLICT", snapshot: snapshot(source, account), conflicts: result.conflicts, requestId };
        if (!result.savedFields) return { snapshot: snapshot(source, account), savedFields: 0, savedProducts: 0, requestId };
        const manifest = result.manifest;
        const previousInfo = codec().normalizePackageInfo(source.manifest.packageInfo);
        manifest.packageInfo = codec().createPackageInfo({ comments: previousInfo?.comments || "" });
        manifest.masterSync.githubRequests = [...(Array.isArray(manifest.masterSync.githubRequests) ? manifest.masterSync.githubRequests : []).slice(-63), {
          requestId, actor: account.login, name: account.name, fingerprint, at: manifest.packageInfo.updatedAt,
          savedFields: result.savedFields, savedProducts: result.savedProducts,
        }];
        const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
        if (manifestBytes.length > MAX_MANIFEST_BYTES) throw failure("The updated portfolio exceeds the 4 MiB master limit.", "MASTER_TOO_LARGE", 413);
        let plaintext;
        let encrypted;
        try {
          plaintext = codec().createZip([...source.entries].map(([name, data]) => ({ name, data: name === "portfolio.json" ? manifestBytes : data })));
          encrypted = await codec().encrypt(plaintext, key);
        } finally { plaintext?.fill(0); manifestBytes.fill(0); }
        if (encrypted.length > MAX_PACKAGE_BYTES) throw failure("The updated master exceeds the 64 MiB package limit.", "MASTER_TOO_LARGE", 413);
        if (generation !== credentialGeneration || disconnected) throw failure("Your GitHub connection changed while saving. Your local changes are safe; connect and try again.", "GITHUB_TOKEN_REQUIRED", 403);
        const body = JSON.stringify({ message: `Update PPC master (${result.savedProducts} ${result.savedProducts === 1 ? "product" : "products"})`, content: base64(encrypted), sha: source.sha, branch: config.branch });
        if (new TextEncoder().encode(body).length > MAX_PUT_BYTES) throw failure("The encrypted GitHub upload is too large.", "MASTER_TOO_LARGE", 413);
        let response;
        try { response = await call(`${repository}/contents/${config.path}`, { method: "PUT", body, signal, access }); }
        catch (error) {
          if (error.code !== "UNAVAILABLE") throw error;
          // A lost reply can still mean the CAS write committed. Re-read the
          // immutable current master and its bounded completion journal.
          uncertain = true;
          continue;
        }
        if (response.status === 409 || response.status === 422) {
          discardResponse(response);
          if (response.status === 422) validationSha = source.sha;
          continue;
        }
        if (!response.ok) { discardResponse(response); throw failure("GitHub could not save the master. Your local changes are safe.", "GITHUB_SAVE_REJECTED", response.status); }
        let accepted;
        try { accepted = await json(response); }
        catch { uncertain = true; continue; }
        const sha = accepted?.content?.sha;
        if (!/^[a-f0-9]{40}$/.test(sha || "")) { uncertain = true; continue; }
        const next = { sha, bytes: encrypted, entries: source.entries, manifest, keyVerifier: source.keyVerifier };
        // Keep immutable entry bytes; only the manifest entry is replaced on
        // every export. The parsed manifest holds its current JSON data.
        cached = next;
        return { snapshot: snapshot(next, account), savedFields: result.savedFields, savedProducts: result.savedProducts, requestId };
      }
      throw failure(uncertain ? "GitHub could not confirm this save. Your local changes are safe; retrying will check whether it already completed."
        : "The GitHub master is changing quickly. Your local changes are safe; try saving again shortly.", uncertain ? "SAVE_UNCONFIRMED" : "MASTER_BUSY", 503);
    }

    return Object.freeze({
      source: config,
      latest(payload) { return serialized(() => latestOperation(payload)); },
      save(payload) { return serialized(() => saveOperation(payload)); },
      request(payload = {}) {
        if (payload.operation === "latest") return serialized(() => latestOperation(payload));
        if (payload.operation === "save") return serialized(() => saveOperation(payload));
        throw failure("GitHub sharing does not provide live presence.", "UNSUPPORTED_OPERATION", 400);
      },
      readPackage(payload) { return serialized(() => readOperation(payload)); },
      getIdentity, getUser: getIdentity, setToken,
      hasToken() { return Boolean(token); },
      disconnect() {
        token = ""; identity = null; disconnected = true; credentialGeneration += 1; blockedUntil = 0;
        for (const controller of pendingControllers) controller.abort();
        clearCache();
      },
    });
  }

  async function downloadLatest({ config, fetchImpl, signal, onProgress } = {}) {
    const transport = createTransport({ config, fetchImpl });
    try { return await transport.readPackage({ signal, onProgress }); }
    finally { transport.disconnect(); }
  }

  root.PortfolioMasterGitHub = Object.freeze({ DEFAULT_CONFIG, normalizeConfig, createTransport, downloadLatest });
})(globalThis);
