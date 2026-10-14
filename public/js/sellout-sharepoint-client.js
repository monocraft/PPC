/* Read-only SharePoint workbook download. Tokens and temporary URLs stay in memory. */
(function (root) {
  "use strict";
  const MAX_BYTES = 40 * 1024 * 1024, METADATA_BYTES = 64 * 1024, TIMEOUT_MS = 90000;
  const SCOPE = "https://graph.microsoft.com/Files.ReadWrite";
  const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.sharepoint\.com$/;
  const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/;
  class ClientError extends Error { constructor(code, message) { super(message); this.name = "SharePointClientError"; this.code = code; } }
  const error = (code, message) => new ClientError(code, message);
  const guid = value => typeof value === "string" && GUID.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
  function settings(config, location) {
    if (!config || !Object.keys(config).length || !config.clientId && !config.tenantId) throw error("CONFIG_REQUIRED", "SharePoint connection needs your organization’s Microsoft app setup.");
    if (!guid(config.clientId) || !guid(config.tenantId) || !Array.isArray(config.sharepointHosts) || !config.sharepointHosts.length || config.sharepointHosts.length > 20) throw error("CONFIG_INVALID", "The SharePoint connection settings are incomplete or invalid.");
    if (Object.keys(config).some(field => !["clientId", "tenantId", "sharepointHosts"].includes(field))) throw error("CONFIG_INVALID", "The SharePoint connection settings are incomplete or invalid.");
    const hosts = Array.from(config.sharepointHosts, value => { if (typeof value !== "string" || !HOST.test(value.toLowerCase())) throw error("CONFIG_INVALID", "The SharePoint connection settings are incomplete or invalid."); return value.toLowerCase(); });
    const page = new URL(location.href);
    if (page.username || page.password || page.protocol !== "https:" && !(page.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(page.hostname))) throw error("CONFIG_INVALID", "Open Analytics on its approved HTTPS address before connecting SharePoint.");
    return { clientId: config.clientId.toLowerCase(), tenantId: config.tenantId.toLowerCase(), hosts: new Set(hosts), authority: `https://login.microsoftonline.com/${config.tenantId.toLowerCase()}`, redirectUri: new URL("analytics-auth.html", page).href };
  }
  function shareId(url) {
    const bytes = new root.TextEncoder().encode(url), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"; let output = "u!";
    for (let index = 0; index < bytes.length; index += 3) { const a = bytes[index], b = bytes[index + 1], c = bytes[index + 2]; output += alphabet[a >> 2] + alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)]; if (b !== undefined) output += alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)]; if (c !== undefined) output += alphabet[c & 63]; }
    return output;
  }
  function signInError(cause) {
    const code = typeof cause?.errorCode === "string" ? cause.errorCode.toLowerCase() : "";
    if (["popup_window_error", "empty_window_error", "popup_blocked", "failed_to_open_window", "block_nested_popups"].includes(code)) return error("POPUP_BLOCKED", "Allow the Microsoft sign-in popup, then choose Sign in & load again.");
    if (["user_cancelled", "user_canceled"].includes(code)) return error("SIGN_IN_CANCELLED", "Microsoft sign-in was cancelled.");
    if (["consent_required", "admin_consent_required", "consent_denied"].includes(code)) return error("CONSENT_REQUIRED", "Your organization needs to approve this Microsoft app before it can read the workbook.");
    if (code === "access_denied") return error("ACCESS_DENIED", "This Microsoft account or app does not have permission to read the workbook.");
    if (code === "interaction_in_progress") return error("SIGN_IN_BUSY", "Finish the existing Microsoft sign-in window, then choose Sign in & load again.");
    if (["monitor_popup_timeout", "timed_out"].includes(code)) return error("TIMEOUT", "Microsoft sign-in took too long. Choose Sign in & load to try again.");
    return error("SIGN_IN_FAILED", "Microsoft sign-in could not complete. Choose Sign in & load to try again.");
  }
  function interactionRequired(cause, msal) { return typeof msal.InteractionRequiredAuthError === "function" && cause instanceof msal.InteractionRequiredAuthError || ["interaction_required", "login_required", "consent_required"].includes(cause?.errorCode); }
  function downloadLocator(value, hosts) {
    if (typeof value !== "string" || value.length > 16384 || CONTROL.test(value) || /[<>"`\\]|%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) throw error("DOWNLOAD_FAILED", "Microsoft did not provide a safe workbook download. Try connecting again.");
    const authority = /^https:\/\/([^/?#]+)\//i.exec(value); let url;
    try { url = new URL(value); } catch { throw error("DOWNLOAD_FAILED", "Microsoft did not provide a safe workbook download. Try connecting again."); }
    if (!authority || /[@:]/.test(authority[1]) || url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !hosts.has(url.hostname)) throw error("DOWNLOAD_FAILED", "Microsoft did not provide a safe workbook download. Try connecting again.");
    return url.href;
  }
  function create({ config = root.PPCSelloutSharePointConfig, msal = root.msal, fetch: fetcher = root.fetch, location = root.location } = {}) {
    let configured = null, failure = null, app = null, initialized = false, initialization = null, sequence = 0, active = null, preferPopup = false;
    try {
      configured = settings(config, location);
      if (typeof msal?.PublicClientApplication !== "function" || typeof fetcher !== "function" || typeof root.PPCSelloutSharePoint?.inspectLink !== "function") throw error("SIGN_IN_UNAVAILABLE", "The Microsoft connection tools did not load. Reopen Analytics to try again.");
      if (![root.File, root.AbortController, root.TextEncoder, root.TextDecoder, root.setTimeout, root.clearTimeout].every(value => typeof value === "function")) throw error("SIGN_IN_UNAVAILABLE", "This browser cannot prepare a SharePoint workbook. Use a current browser or choose a local file.");
    } catch (cause) { failure = cause instanceof ClientError ? cause : error("CONFIG_INVALID", "The SharePoint connection settings are incomplete or invalid."); }
    function initialize() {
      if (failure) return Promise.reject(failure);
      if (initialization) return initialization;
      initialization = (async () => {
        try {
          app = new msal.PublicClientApplication({ auth: { clientId: configured.clientId, authority: configured.authority, redirectUri: configured.redirectUri, navigateToLoginRequestUrl: false }, cache: { cacheLocation: "memoryStorage", temporaryCacheLocation: "memoryStorage", storeAuthStateInCookie: false }, system: { asyncPopups: false, allowPlatformBroker: false, loggerOptions: { piiLoggingEnabled: false, loggerCallback() {} } } });
          for (const method of ["initialize", "acquireTokenSilent", "acquireTokenPopup", "getActiveAccount", "getAllAccounts", "setActiveAccount"]) if (typeof app[method] !== "function") throw error("SIGN_IN_UNAVAILABLE", "The Microsoft connection tools did not load. Reopen Analytics to try again.");
          await app.initialize(); initialized = true; return true;
        } catch { failure = error("SIGN_IN_UNAVAILABLE", "Microsoft sign-in could not initialize. Reopen Analytics to try again."); throw failure; }
      })();
      return initialization;
    }
    function cancellation(ctx) {
      if (ctx.stale || ctx.run !== sequence) return error("SUPERSEDED", "A newer workbook connection replaced this request.");
      if (ctx.timedOut) return error("TIMEOUT", "The workbook connection took too long. Choose Sign in & load to try again.");
      return error("CANCELLED", "The workbook connection was cancelled.");
    }
    function check(ctx) { if (ctx.controller.signal.aborted || ctx.run !== sequence) throw cancellation(ctx); }
    function waiting(value, ctx) {
      check(ctx);
      return new Promise((resolve, reject) => {
        const aborted = () => reject(cancellation(ctx)); ctx.controller.signal.addEventListener("abort", aborted, { once: true });
        Promise.resolve(value).then(result => { ctx.controller.signal.removeEventListener("abort", aborted); try { check(ctx); resolve(result); } catch (cause) { reject(cause); } }, cause => { ctx.controller.signal.removeEventListener("abort", aborted); reject(ctx.controller.signal.aborted ? cancellation(ctx) : cause); });
      });
    }
    function progress(ctx, phase, loaded = 0, total = null) { check(ctx); if (ctx.onProgress) { try { ctx.onProgress(Object.freeze({ phase, loaded, total })); } catch { /* Presentation callbacks cannot expose or alter download state. */ } check(ctx); } }
    async function bytes(response, limit, ctx, phase, expected = null) {
      if (!response?.body || typeof response.body.getReader !== "function") throw error("DOWNLOAD_FAILED", "This browser could not stream the workbook safely. Choose a local file instead.");
      const reader = response.body.getReader(), chunks = []; let loaded = 0;
      try {
        while (true) {
          const part = await waiting(reader.read(), ctx); if (part.done) break;
          if (!(part.value instanceof Uint8Array)) throw error("DOWNLOAD_FAILED", "The workbook download could not be read. Try connecting again.");
          loaded += part.value.byteLength;
          if (loaded > limit) throw error(phase === "download" ? "FILE_TOO_LARGE" : "METADATA_FAILED", phase === "download" ? "Choose an Excel workbook of at most 40 MiB." : "Microsoft returned an unexpected workbook response. Try connecting again.");
          if (expected !== null && loaded > expected) throw error("DOWNLOAD_FAILED", "The workbook changed or its download was incomplete. Try connecting again.");
          chunks.push(part.value.slice()); if (phase === "download") progress(ctx, phase, loaded, expected);
        }
      } catch (cause) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} throw cause; }
      finally { try { reader.releaseLock(); } catch {} }
      if (expected !== null && loaded !== expected) throw error("DOWNLOAD_FAILED", "The workbook changed or its download was incomplete. Try connecting again.");
      return { chunks, loaded };
    }
    async function token(ctx) {
      const activeAccount = app.getActiveAccount(), accounts = app.getAllAccounts(), account = activeAccount?.tenantId?.toLowerCase() === configured.tenantId ? activeAccount : accounts.find(item => item?.tenantId?.toLowerCase() === configured.tenantId);
      const request = { scopes: [SCOPE], authority: configured.authority, redirectUri: configured.redirectUri, ...(account ? { account } : {}) }; let response;
      try {
        if (!account || preferPopup) response = await waiting(app.acquireTokenPopup(request), ctx);
        else {
          try { response = await waiting(app.acquireTokenSilent(request), ctx); }
          catch (cause) { check(ctx); if (!interactionRequired(cause, msal)) throw cause; preferPopup = true; response = await waiting(app.acquireTokenPopup(request), ctx); }
        }
      } catch (cause) { check(ctx); throw signInError(cause); }
      check(ctx);
      const identityTenant = response?.account?.tenantId || response?.idTokenClaims?.tid;
      const tenants = [identityTenant, response?.tenantId, response?.idTokenClaims?.tid].filter(value => value !== undefined);
      if (typeof identityTenant !== "string" || tenants.some(value => typeof value !== "string" || value.toLowerCase() !== configured.tenantId)) throw error("ACCESS_DENIED", "Sign in with an account in the organization configured for this dashboard.");
      if (typeof response?.accessToken !== "string" || !response.accessToken.length || response.accessToken.length > 32768 || !/^[a-z0-9._~+/-]+=*$/i.test(response.accessToken)) throw error("SIGN_IN_FAILED", "Microsoft sign-in did not return a usable workbook access token. Try again.");
      preferPopup = false; if (response.account) app.setActiveAccount(response.account); return response.accessToken;
    }
    async function load(input, { signal, onProgress } = {}) {
      if (active) { active.stale = true; active.controller.abort(); }
      const run = ++sequence;
      if (failure) throw failure;
      if (!initialized) throw error("NOT_INITIALIZED", "Microsoft sign-in is still preparing. Wait a moment, then choose Sign in & load again.");
      if (signal && (typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function") || onProgress !== undefined && typeof onProgress !== "function") throw error("DOWNLOAD_FAILED", "The workbook connection could not start. Try connecting again.");
      let link; try { link = root.PPCSelloutSharePoint.inspectLink(input); } catch { throw error("INVALID_LINK", "Paste a valid SharePoint Excel workbook link without sign-in information."); }
      if (!configured.hosts.has(link.host)) throw error("HOST_NOT_ALLOWED", "Choose a workbook on one of the SharePoint sites approved for this dashboard.");
      if (signal?.aborted) throw error("CANCELLED", "The workbook connection was cancelled.");
      const ctx = { run, controller: new root.AbortController(), onProgress, stale: false, timedOut: false }; active = ctx;
      const aborted = () => ctx.controller.abort(); signal?.addEventListener("abort", aborted, { once: true });
      const timeout = root.setTimeout(() => { ctx.timedOut = true; ctx.controller.abort(); }, TIMEOUT_MS);
      try {
        progress(ctx, "sign-in");
        const accessToken = await token(ctx); check(ctx); progress(ctx, "metadata");
        const options = { method: "GET", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error", signal: ctx.controller.signal };
        const response = await waiting(fetcher.call(root, `https://graph.microsoft.com/v1.0/shares/${shareId(link.url)}/driveItem?$select=id,name,size,file,@microsoft.graph.downloadUrl`, { ...options, headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }), ctx);
        if (!response?.ok || response.redirected) {
          if ([401, 403].includes(response?.status)) throw error("ACCESS_DENIED", "This Microsoft account or app does not have permission to read the workbook.");
          if (response?.status === 404) throw error("WORKBOOK_NOT_FOUND", "The workbook link is unavailable. Check the link and your access, then try again.");
          throw error("METADATA_FAILED", "Microsoft could not locate this workbook. Try connecting again.");
        }
        const metadata = await bytes(response, METADATA_BYTES, ctx, "metadata"); let item;
        try { const joined = new Uint8Array(metadata.loaded); let offset = 0; for (const chunk of metadata.chunks) { joined.set(chunk, offset); offset += chunk.length; } item = JSON.parse(new root.TextDecoder("utf-8", { fatal: true }).decode(joined)); }
        catch { throw error("METADATA_FAILED", "Microsoft returned an unexpected workbook response. Try connecting again."); }
        if (!item || Array.isArray(item) || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || item.name.length < 6 || item.name.length > 255 || CONTROL.test(item.name) || /[\\/]/.test(item.name) || !/\.xlsx$/i.test(item.name) || !item.file || typeof item.file !== "object" || Array.isArray(item.file) || item.folder != null || !Number.isSafeInteger(item.size) || item.size <= 0) throw error("INVALID_WORKBOOK", "Choose an ordinary XLSX workbook file, rather than a folder or another document type.");
        if (item.size > MAX_BYTES) throw error("FILE_TOO_LARGE", "Choose an Excel workbook of at most 40 MiB.");
        const downloadUrl = downloadLocator(item["@microsoft.graph.downloadUrl"], configured.hosts); check(ctx); progress(ctx, "download", 0, item.size);
        const download = await waiting(fetcher.call(root, downloadUrl, options), ctx);
        if (!download?.ok || download.redirected || download.status !== 200) throw error("DOWNLOAD_FAILED", "The workbook download is unavailable. Try connecting again.");
        const contentLength = download.headers?.get?.("content-length");
        if (contentLength !== null && contentLength !== undefined && (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)))) throw error("DOWNLOAD_FAILED", "The workbook download has an unexpected size. Try connecting again.");
        if (contentLength != null && Number(contentLength) > MAX_BYTES) throw error("FILE_TOO_LARGE", "Choose an Excel workbook of at most 40 MiB.");
        if (/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(download.headers?.get?.("content-type") || "")) throw error("DOWNLOAD_FAILED", "Microsoft returned a sign-in page instead of the workbook. Try connecting again.");
        const downloaded = await bytes(download, MAX_BYTES, ctx, "download", item.size); check(ctx);
        const file = new root.File(downloaded.chunks, item.name, { type: MIME }); progress(ctx, "complete", downloaded.loaded, item.size); return file;
      } catch (cause) { check(ctx); ctx.controller.abort(); throw cause instanceof ClientError ? cause : error("DOWNLOAD_FAILED", "The workbook connection could not complete. Try connecting again."); }
      finally { root.clearTimeout(timeout); signal?.removeEventListener("abort", aborted); if (active === ctx) active = null; }
    }
    return Object.freeze({ get ready() { return !failure; }, get reason() { return failure?.message || ""; }, get initialized() { return initialized; }, initialize, load });
  }
  root.PPCSelloutSharePointClient = Object.freeze({ create });
})(typeof globalThis !== "undefined" ? globalThis : this);
