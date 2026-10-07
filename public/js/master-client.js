/* Shared product editing. Keys stay in memory; unsaved changes keep their original master values. */
(function (root) {
  "use strict";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const idOf = (product) => String(product?.productId || product?.id || "");
  const conflictKey = (productId, path) => JSON.stringify([productId, path]);
  const model = () => root.PortfolioMasterModel;
  const valuesOf = (product) => product?.values ? clone(product.values) : model().productValues(product);

  function normalizeEndpoint(value, baseUrl = root.location?.href) {
    const text = String(value || "").trim();
    if (!text) throw new Error("Master sharing is not connected yet. Your changes are saved on this device.");
    let url;
    try { url = new URL(text, baseUrl); } catch { throw new Error("The master connection is invalid. Ask the portfolio owner to check setup."); }
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) || url.username || url.password || url.search || url.hash || /[?#]/.test(text)) throw new Error("The master must use a secure connection without a key in its address.");
    const path = url.pathname.replace(/\/$/, "");
    if (/\/api\/(master|dates)\/(latest|save)$/.test(path)) url.pathname = path.replace(/\/(master|dates)\/(latest|save)$/, "/master");
    else if (path.endsWith("/api/package/latest")) url.pathname = path.replace(/\/api\/package\/latest$/, "/api/master");
    else if (path.endsWith("/api/master")) url.pathname = path;
    else if (path.endsWith("/api/dates")) url.pathname = path.replace(/\/dates$/, "/master");
    else if (!path) url.pathname = "/api/master";
    else throw new Error("The master connection is invalid. Ask the portfolio owner to check setup.");
    return url.href.replace(/\/$/, "");
  }

  function normalizeSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.products) || snapshot.products.length > 30000) throw new Error("The master returned an incomplete response. Your local changes are safe.");
    const ids = new Set();
    const products = snapshot.products.map((product) => {
      const productId = idOf(product);
      if (!productId || ids.has(productId) || !product.values || typeof product.values !== "object" || Array.isArray(product.values)) throw new Error("The master returned an incomplete response. Your local changes are safe.");
      ids.add(productId);
      let values;
      try { values = model().validateValues(product.values, { checkDuplicates: false, checkDateOrder: false }); }
      catch { throw new Error("The master returned invalid product details. Your local changes are safe."); }
      return { ...product, productId, productName: String(product.productName || ""), categoryId: String(product.categoryId || ""), values, revisions: clone(product.revisions || {}) };
    });
    return { ...snapshot, products };
  }

  function errorOf(message, code, status) { const error = new Error(message); error.code = code; error.status = status; return error; }

  async function readJson(response) {
    const limit = 12 * 1024 * 1024, advertised = response.headers?.get("content-length");
    if (advertised !== null && advertised !== undefined && (!/^\d+$/.test(advertised) || Number(advertised) > limit)) { await response.body?.cancel().catch(() => {}); throw new Error(); }
    const reader = response.body?.getReader();
    if (!reader) { const text = await response.text(); if (text.length > limit) throw new Error(); return JSON.parse(text); }
    let bytes = 0, text = ""; const decoder = new TextDecoder();
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > limit) throw new Error(); text += decoder.decode(chunk.value, { stream: true }); }
      text += decoder.decode(); return JSON.parse(text);
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  }

  async function performRequest({ endpoint, operation, key, editorToken, team = false, fetchImpl = root.fetch, signal, keepalive = false, ...payload }) {
    if (!["latest", "save", "presence"].includes(operation)) throw new Error("The master action is invalid.");
    const url = `${normalizeEndpoint(endpoint)}/${operation}`;
    let normalizedKey;
    try { normalizedKey = root.PortfolioPackage?.normalizeKey ? root.PortfolioPackage.normalizeKey(key) : String(key || "").trim(); }
    catch { throw errorOf("That master package key is incomplete. Check the key and try again.", "INVALID_KEY", 401); }
    if (!normalizedKey) throw errorOf("Enter your master package key to connect.", "INVALID_KEY", 401);
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal, keepalive: Boolean(keepalive && operation === "presence"),
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ key: normalizedKey, ...(!team && editorToken ? { editorToken } : {}), ...payload }),
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw errorOf("Cannot reach the master. Your changes are saved on this device; try again when connected.", "UNAVAILABLE");
    }
    if (response.status === 401) throw errorOf("That master package key could not connect. Check the key and try again.", "INVALID_KEY", 401);
    if (response.status === 429) throw errorOf("Too many attempts. Wait a minute and try again. Your local changes are safe.", "RATE_LIMIT", 429);
    if (response.status === 404 || response.status >= 500) throw errorOf("The master is unavailable. Your changes are saved on this device; try again later.", "UNAVAILABLE", response.status);
    let data;
    try { data = await readJson(response); }
    catch { throw errorOf("The master response could not be read. Your local changes are safe.", "INVALID_RESPONSE", response.status); }
    if (response.status === 403) {
      if (team) throw errorOf("Team saving needs to be connected by the portfolio owner. Your changes remain on this device.", "TEAM_SETUP_REQUIRED", 403);
      const disabled = data.code === "WRITES_DISABLED";
      throw errorOf(disabled ? "Saving to master is not enabled yet. Ask the portfolio owner to enable sharing. Your changes remain on this device." : "Enter the team editing key to save changes to the master.", disabled ? "WRITES_DISABLED" : "EDITOR_KEY_REQUIRED", 403);
    }
    if (response.status === 409 && data.code === "MASTER_CONFLICT" && Array.isArray(data.conflicts)) return { ...data, snapshot: normalizeSnapshot(data.snapshot) };
    if (!response.ok) throw errorOf(response.status === 400 ? "These changes could not be saved. Check your product details and try again." : "The master could not save these changes. Your local changes are safe.", String(data.code || "SAVE_FAILED"), response.status);
    if (operation === "presence") {
      if (!Array.isArray(data.sessions || data.users)) throw errorOf("The shared connection status could not be read.", "INVALID_RESPONSE");
      return data;
    }
    return { ...data, snapshot: normalizeSnapshot(data.snapshot || data) };
  }

  async function request(options) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = root.setTimeout(abort, options.team && options.operation !== "presence" ? 120000 : 25000);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    try { return await performRequest({ ...options, signal: controller.signal }); }
    catch (error) {
      if (options.signal?.aborted) { const cancelled = new Error("The master request was cancelled. Your local changes are safe."); cancelled.name = "AbortError"; throw cancelled; }
      if (controller.signal.aborted) throw errorOf("The master took too long to respond. Your changes remain on this device; try saving again.", "UNAVAILABLE");
      throw error;
    } finally { root.clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
  }

  function createSession({ endpoint, source, adapter, fetchImpl = root.fetch } = {}) {
    if (!model() || !adapter?.getProducts || !(adapter.applyProductValues || adapter.applyPatches)) throw new Error("A master model and portfolio adapter are required.");
    const mode = source?.mode === "github" ? "github" : "service";
    const team = source?.team === true;
    const configured = mode === "github" || Boolean(String(endpoint || "").trim());
    let editorName = "", editorSessionId = root.crypto?.randomUUID?.() || `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try { editorName = String(root.localStorage?.getItem("portfolio.sharedDisplayName") || "").trim().slice(0, 60); } catch {}
    let baseline = new Map(), snapshot = null, key = "", editorToken = "", githubToken = "", githubTransport = null, identity = null, connected = false, busy = false, generation = 0, accessVersion = 0;
    function resetGitHubAccess() { githubTransport?.disconnect?.(); githubTransport = null; githubToken = ""; identity = null; }
    function clearAccess() {
      if (key || editorToken || githubToken || connected) accessVersion += 1;
      key = ""; editorToken = ""; connected = false;
      resetGitHubAccess();
    }
    function transport() {
      if (!githubTransport) {
        if (!root.PortfolioMasterGitHub?.createTransport) throw errorOf("GitHub sharing could not start. Reload the page and try again.", "UNAVAILABLE");
        githubTransport = root.PortfolioMasterGitHub.createTransport({ token: githubToken, config: source, fetchImpl });
      }
      return githubTransport;
    }
    async function githubCall(operation) {
      const controller = new AbortController(), timer = root.setTimeout(() => controller.abort(), 60000);
      try { return await operation(controller.signal); }
      catch (error) { if (controller.signal.aborted) throw errorOf("GitHub took too long to respond. Your local changes are safe; reconnect to check the master before trying again.", "UNAVAILABLE"); throw error; }
      finally { root.clearTimeout(timer); }
    }
    async function send(operation, payload = {}) {
      if (mode !== "github") return request({ endpoint, operation, key, editorToken, team, fetchImpl, ...payload });
      const result = await githubCall((signal) => transport().request({ operation, key, signal, ...payload }));
      return { ...result, snapshot: normalizeSnapshot(result.snapshot || result) };
    }
    function seed(products) {
      generation += 1;
      baseline = new Map(); snapshot = null;
      for (const product of products || []) {
        const productId = idOf(product);
        if (productId) baseline.set(productId, { productId, values: valuesOf(product), revisions: clone(product.revisions || product.masterSync?.revisions || product.dateMaster?.revisions || {}) });
      }
    }
    seed(adapter.getBaselineProducts?.() || adapter.getProducts());

    function track() {
      const pending = [];
      for (const product of adapter.getProducts()) {
        const productId = idOf(product), base = baseline.get(productId);
        if (!base) continue;
        const mine = valuesOf(product), patch = model().diffValues(base.values, mine);
        if (Object.keys(patch).length) pending.push({ productId, productName: String(product.name || product.productName || productId), base: clone(base.values), baseRevisions: clone(base.revisions), mine, patch });
      }
      return pending;
    }

    function persistBaseline() { adapter.setBaselineProducts?.([...baseline.values()].map(clone)); }

    function applySnapshot(incoming, accepted) {
      incoming = normalizeSnapshot(incoming);
      const current = new Map(adapter.getProducts().map((product) => [idOf(product), product]));
      const nextBaseline = new Map(baseline);
      const updates = [];
      for (const remote of incoming.products) {
        const product = current.get(remote.productId), old = baseline.get(remote.productId), submitted = accepted?.get(remote.productId);
        if (!product) { nextBaseline.set(remote.productId, clone(remote)); continue; }
        const mine = valuesOf(product), base = submitted ? submitted.mine : old?.values || mine;
        const baseRevisions = submitted ? remote.revisions : old?.revisions || {};
        const plan = model().planMerge(base, mine, remote.values, baseRevisions, remote.revisions);
        const localValues = model().resolveConflicts(plan, Object.fromEntries(plan.conflicts.map((conflict) => [conflict.path, "mine"])));
        updates.push({ productId: remote.productId, values: localValues, patch: localValues });
        nextBaseline.set(remote.productId, { ...remote,
          values: model().draftBaseline(base, mine, remote.values),
          revisions: model().draftRevisions(base, mine, baseRevisions, remote.revisions),
        });
      }
      (adapter.applyProductValues || adapter.applyPatches).call(adapter, updates);
      baseline = nextBaseline; snapshot = incoming;
      if (mode === "github" && githubToken && incoming.identity) identity = clone(incoming.identity);
      adapter.setMasterSnapshot?.(incoming);
      if (incoming.packageInfo) adapter.setPackageInfo?.(incoming.packageInfo);
      persistBaseline();
      adapter.onMasterChange?.();
      return incoming;
    }

    async function refresh() {
      if (!key || busy) return null;
      const operationGeneration = generation;
      busy = true;
      try {
        const result = await send("latest");
        if (generation !== operationGeneration) throw new Error("The workspace changed while the master was loading. Your current workspace was kept; connect again to refresh it.");
        connected = true; return applySnapshot(result.snapshot);
      } catch (error) {
        connected = false;
        if (error.code === "INVALID_KEY") clearAccess();
        if (["INVALID_GITHUB_TOKEN", "GITHUB_PERMISSION_DENIED"].includes(error.code)) { resetGitHubAccess(); accessVersion += 1; }
        throw error;
      } finally { busy = false; }
    }

    async function connect(access) {
      const newKey = String(access?.key || access || "").trim();
      if (newKey !== key) { accessVersion += 1; connected = false; resetGitHubAccess(); }
      key = newKey; editorToken = String(access?.editorToken || "").trim();
      try { return await refresh(); }
      catch (error) { connected = false; if (error.code === "INVALID_KEY") clearAccess(); throw error; }
    }

    async function save({ reason = "", resolveConflicts, requestId } = {}) {
      if (busy) throw new Error("The master is already updating. Please wait.");
      if (!configured) throw errorOf("Team saving has not been connected by the portfolio owner yet. Your changes remain on this device.", "TEAM_SETUP_REQUIRED");
      if (!key) throw errorOf("Connect to the master before saving.", "INVALID_KEY", 401);
      const saveProfile = { sessionId: editorSessionId, ...(editorName ? { editorName } : {}) };
      const originals = new Map(track().map((item) => [item.productId, item]));
      if (!originals.size) return { saved: false, snapshot };
      let changes = [...originals.values()].map(({ productId, base, baseRevisions, patch }) => ({ productId, base, baseRevisions, patch }));
      let rebase = null, attempt = 0, keptFences = [], recheckChanges = [];
      const operationGeneration = generation;
      busy = true;
      try {
        for (;;) {
          if (generation !== operationGeneration) throw new Error("The workspace changed while the master was updating. Your current workspace was kept; reconnect before saving again.");
          if (!changes.length && rebase) {
            const latest = (await send("latest")).snapshot;
            if (generation !== operationGeneration) throw new Error("The workspace changed while checking the final master choices. Your current workspace was kept.");
            const priorProducts = new Map(rebase.products.map((product) => [product.productId, product]));
            const latestProducts = new Map(latest.products.map((product) => [product.productId, product]));
            const overlap = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
            const changed = keptFences.some((conflict) => {
              const before = priorProducts.get(String(conflict.productId)), after = latestProducts.get(String(conflict.productId));
              if (!before || !after) return true;
              const paths = conflict.path === "@lifecycle" ? ["@launch", "@end"] : [conflict.path, conflict.conflictingPath].filter(Boolean);
              if (model().diffOperations(before.values, after.values).some((operation) => paths.some((path) => overlap(operation.path, path)))) return true;
              return [...new Set([...Object.keys(before.revisions), ...Object.keys(after.revisions)])].some((path) => paths.some((fence) => overlap(path, fence)) && (before.revisions[path] || 0) !== (after.revisions[path] || 0));
            });
            if (changed) { changes = recheckChanges; rebase = null; continue; }
            applySnapshot(latest, originals); return { saved: true, snapshot: latest, keptMaster: true };
          }
          const result = await send("save", {
            requestId: attempt === 0 && requestId ? requestId : root.crypto?.randomUUID?.() || `master-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            reason: String(reason).trim(), changes, ...(mode === "service" ? team ? saveProfile : saveProfile.editorName ? { actor: saveProfile.editorName } : {} : {}),
          });
          if (generation !== operationGeneration) throw new Error("The workspace changed while the master was updating. Your current workspace was kept; reconnect to check the saved master.");
          if (result.code !== "MASTER_CONFLICT") { connected = true; applySnapshot(result.snapshot, originals); return { ...result, saved: true }; }
          const localPlans = new Map(), remoteProducts = new Map(result.snapshot.products.map((product) => [product.productId, product]));
          for (const change of changes) {
            const remote = remoteProducts.get(change.productId);
            if (!remote) throw new Error("A product is no longer in the master. Your local changes are safe; pull the latest portfolio before trying again.");
            localPlans.set(change.productId, model().planMerge(change.base, { ...change.base, ...change.patch }, remote.values, change.baseRevisions, remote.revisions));
          }
          const conflicts = result.conflicts.map((conflict) => {
            const original = originals.get(String(conflict.productId));
            if (!original || !localPlans.has(String(conflict.productId)) || typeof conflict.path !== "string") throw new Error("The master returned an unexpected conflict. Your local changes are safe.");
            return { ...conflict, productName: original.productName, key: conflictKey(String(conflict.productId), conflict.path) };
          });
          if (!conflicts.length) throw new Error("The master changed again. Your local changes are safe; try saving again.");
          for (const [productId, plan] of localPlans) {
            for (const conflict of plan.conflicts) if (!conflicts.some((item) => String(item.productId) === productId && item.path === conflict.path)) throw new Error("The master returned an incomplete conflict review. Your local changes are safe.");
          }
          const selected = await resolveConflicts?.(conflicts, result.snapshot);
          if (!selected) return { saved: false, cancelled: true, snapshot };
          for (const conflict of conflicts) if (!["mine", "master"].includes(selected instanceof Map ? selected.get(conflict.key) : selected[conflict.key])) throw new Error("Choose a final value for every conflict.");
          const nextChanges = [];
          recheckChanges = [];
          keptFences = conflicts.filter((conflict) => (selected instanceof Map ? selected.get(conflict.key) : selected[conflict.key]) === "master");
          for (const change of changes) {
            const remote = remoteProducts.get(change.productId), plan = localPlans.get(change.productId);
            const choices = Object.fromEntries(conflicts.filter((conflict) => String(conflict.productId) === change.productId).map((conflict) => [conflict.path, selected instanceof Map ? selected.get(conflict.key) : selected[conflict.key]]));
            const resolved = model().resolveConflicts(plan, choices), patch = model().diffValues(remote.values, resolved);
            const mineResolved = model().resolveConflicts(plan, Object.fromEntries(plan.conflicts.map((conflict) => [conflict.path, "mine"])));
            const minePatch = model().diffValues(remote.values, mineResolved);
            if (Object.keys(minePatch).length) recheckChanges.push({ productId: change.productId, base: clone(remote.values), baseRevisions: clone(remote.revisions), patch: minePatch });
            if (Object.keys(patch).length) nextChanges.push({ productId: change.productId, base: clone(remote.values), baseRevisions: clone(remote.revisions), patch });
          }
          changes = nextChanges; rebase = result.snapshot; attempt += 1;
          if (attempt >= 12) throw new Error("The master is changing frequently. Your local changes are safe; try saving again shortly.");
        }
      } catch (error) {
        if (error.code === "INVALID_KEY") clearAccess();
        if (["INVALID_GITHUB_TOKEN", "GITHUB_PERMISSION_DENIED"].includes(error.code)) { resetGitHubAccess(); accessVersion += 1; }
        throw error;
      } finally { busy = false; }
    }

    function markImported(products, importedKey) {
      seed(products || adapter.getBaselineProducts?.() || adapter.getProducts()); connected = false;
      accessVersion += 1;
      const newKey = String(importedKey || "").trim();
      if (!newKey || newKey !== key) { editorToken = ""; resetGitHubAccess(); }
      key = newKey;
      persistBaseline();
    }
    return Object.freeze({ connect, refresh, save, applySnapshot, track, markImported,
      async presence({ sessionId, displayName, editing, productId, leave = false } = {}) {
        if (mode === "github" || !configured || !key) return null;
        return request({ endpoint, operation: "presence", key, team, fetchImpl, keepalive: Boolean(leave), sessionId, displayName, editing, productId, leave: Boolean(leave) });
      },
      setEditorProfile({ sessionId, displayName, editorName: suppliedName } = {}) {
        const id = String(sessionId || "");
        if (id && !/^[-_a-z0-9]{8,128}$/i.test(id)) throw new Error("The browser editing session is invalid.");
        if (id) editorSessionId = id;
        if (displayName !== undefined || suppliedName !== undefined) editorName = String(displayName ?? suppliedName ?? "").trim().slice(0, 60);
      },
      setEditorToken(value) { if (!team) editorToken = String(value || "").trim(); },
      async setGitHubToken(value) {
        resetGitHubAccess(); githubToken = String(value || "").trim(); accessVersion += 1;
        const operationVersion = accessVersion, selectedTransport = transport();
        try {
          const verified = await githubCall((signal) => selectedTransport.getIdentity({ signal }));
          if (accessVersion !== operationVersion || githubTransport !== selectedTransport || !githubToken) throw errorOf("The GitHub connection changed while your account was being checked. Your current workspace and access were kept.", "GITHUB_CONNECTION_CHANGED");
          identity = verified; return clone(identity);
        } catch (error) {
          if (accessVersion === operationVersion && githubTransport === selectedTransport) { resetGitHubAccess(); accessVersion += 1; }
          throw error;
        }
      },
      disconnect() { clearAccess(); },
      getState() { return { mode, team, configured, connected, hasKey: Boolean(key), hasGitHubToken: Boolean(githubToken), identity: identity ? clone(identity) : null, editorProfile: { sessionId: editorSessionId, displayName: editorName }, busy, accessVersion, snapshot, pending: track() }; },
    });
  }
  root.PortfolioMasterClient = Object.freeze({ conflictKey, normalizeEndpoint, normalizeSnapshot, request, createSession });
})(globalThis);
