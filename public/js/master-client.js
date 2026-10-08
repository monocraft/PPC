/* Shared product editing. Team unlocks can reconnect within one browser tab; drafts keep their original master values. */
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
    const invalid = () => { throw new Error("The master returned invalid product details. Your local changes are safe."); };
    const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 180 && !["__proto__", "prototype", "constructor"].includes(id);
    const revisionsOf = (value) => {
      if (value === undefined) return {};
      if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
      for (const [path, counter] of Object.entries(value)) if (!path || path.length > 4096 || !Number.isSafeInteger(counter) || counter < 0) invalid();
      return clone(value);
    };
    const ids = new Set();
    const products = snapshot.products.map((product) => {
      const productId = idOf(product);
      if (!validId(productId) || ids.has(productId) || !product.values || typeof product.values !== "object" || Array.isArray(product.values)) throw new Error("The master returned an incomplete response. Your local changes are safe.");
      if ((product.categoryId !== undefined && (typeof product.categoryId !== "string" || product.categoryId.length > 180)) || (product.laneId !== undefined && product.laneId !== "" && !validId(product.laneId)) || (product.productVersion !== undefined && !/^[a-f0-9]{64}$/.test(product.productVersion))) invalid();
      ids.add(productId);
      let values;
      try { values = model().validateValues(product.values, { checkDuplicates: false, checkDateOrder: false }); }
      catch { throw new Error("The master returned invalid product details. Your local changes are safe."); }
      return { ...product, productId, productName: String(product.productName || ""), categoryId: String(product.categoryId || ""), laneId: String(product.laneId || ""), values, revisions: revisionsOf(product.revisions) };
    });
    if (snapshot.tombstones !== undefined && (!Array.isArray(snapshot.tombstones) || snapshot.tombstones.length > 30000)) invalid();
    const tombstones = (snapshot.tombstones || []).map((item) => {
      const productId = idOf(item);
      if (!validId(productId) || ids.has(productId) || (item.categoryId !== undefined && (typeof item.categoryId !== "string" || item.categoryId.length > 180)) || (item.laneId !== undefined && item.laneId !== "" && !validId(item.laneId))) invalid();
      ids.add(productId);
      return { productId, categoryId: String(item.categoryId || ""), laneId: String(item.laneId || ""), productName: String(item.productName || ""), revisions: revisionsOf(item.revisions) };
    });
    if (snapshot.masterSync !== undefined && snapshot.masterSync !== null && (typeof snapshot.masterSync !== "object" || Array.isArray(snapshot.masterSync))) invalid();
    if (snapshot.packageInfo && root.PortfolioPackage?.normalizePackageInfo) root.PortfolioPackage.normalizePackageInfo(snapshot.packageInfo);
    if (snapshot.publication) {
      const value = snapshot.publication;
      if (!["current", "pending", "error"].includes(value.status) || !Number.isSafeInteger(value.requestedRevision) || !Number.isSafeInteger(value.publishedRevision) || value.publishedRevision < 0 || value.requestedRevision < value.publishedRevision) invalid();
    }
    return { ...snapshot, products, tombstones };
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
    const timer = root.setTimeout(abort, 25000);
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
    let rememberedEndpoint = "";
    if (mode === "service" && team && configured) {
      try { rememberedEndpoint = normalizeEndpoint(endpoint); } catch {}
    }
    const tabAccessName = rememberedEndpoint ? `portfolio.sharedTeamAccess:${rememberedEndpoint}` : "";
    let editorName = "", editorSessionId = root.crypto?.randomUUID?.() || `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try { editorName = String(root.localStorage?.getItem("portfolio.sharedDisplayName") || "").trim().slice(0, 60); } catch {}
    let baseline = new Map(), tombstones = new Map(), snapshot = null, key = "", editorToken = "", githubToken = "", githubTransport = null, identity = null, connected = false, busy = false, generation = 0, accessVersion = 0, pendingRequest = null;
    function normalizedAccessKey(value) {
      const text = String(value || "").trim();
      if (!text) return "";
      try { return mode === "service" && team && root.PortfolioPackage?.normalizeKey ? root.PortfolioPackage.normalizeKey(text) : text; }
      catch { throw errorOf("That master package key is incomplete. Check the key and try again.", "INVALID_KEY", 401); }
    }
    function rememberTeamAccess(value) {
      if (!tabAccessName) return;
      try {
        if (!value) root.sessionStorage?.removeItem(tabAccessName);
        else if (root.PortfolioPackage?.normalizeKey) root.sessionStorage?.setItem(tabAccessName, JSON.stringify({ version: 1, endpoint: rememberedEndpoint, key: root.PortfolioPackage.normalizeKey(value) }));
      } catch {}
    }
    if (tabAccessName) {
      try {
        const stored = root.sessionStorage?.getItem(tabAccessName);
        if (stored) {
          if (typeof stored !== "string" || stored.length > 1024) throw new Error("Invalid saved tab access");
          const access = JSON.parse(stored);
          if (!root.PortfolioPackage?.normalizeKey || !access || access.version !== 1 || access.endpoint !== rememberedEndpoint || typeof access.key !== "string" || Object.keys(access).length !== 3) throw new Error("Invalid saved tab access");
          key = root.PortfolioPackage.normalizeKey(access.key);
        }
      } catch { rememberTeamAccess(""); }
    }
    function resetGitHubAccess() { githubTransport?.disconnect?.(); githubTransport = null; githubToken = ""; identity = null; }
    function clearAccess() {
      if (key || editorToken || githubToken || connected) accessVersion += 1;
      key = ""; editorToken = ""; connected = false;
      rememberTeamAccess("");
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
      baseline = new Map(); snapshot = null; pendingRequest = null;
      tombstones = new Map((adapter.getMasterTombstones?.() || []).map((item) => [idOf(item), clone(item)]));
      for (const product of products || []) {
        const productId = idOf(product);
        if (productId) baseline.set(productId, { ...clone(product), productId, values: valuesOf(product), revisions: clone(product.revisions || product.masterSync?.revisions || product.dateMaster?.revisions || {}) });
      }
    }
    seed(adapter.getBaselineProducts?.() || adapter.getProducts());

    function track() {
      const pending = [];
      const currentIds = new Set();
      for (const product of adapter.getProducts()) {
        const productId = idOf(product), base = baseline.get(productId);
        if (!productId || currentIds.has(productId)) throw new Error("Repeated product IDs need review before saving to master.");
        currentIds.add(productId);
        if (!base) {
          const mine = valuesOf(product);
          pending.push({ kind: "create", productId, productName: String(product.name || product.productName || productId), categoryId: String(product.categoryId || ""), laneId: String(product.laneId || ""), base: null, baseRevisions: clone(tombstones.get(productId)?.revisions || {}), mine });
          continue;
        }
        const mine = valuesOf(product), patch = model().diffValues(base.values, mine);
        if (Object.keys(patch).length) pending.push({ productId, productName: String(product.name || product.productName || productId), categoryId: String(base.categoryId || product.categoryId || ""), laneId: String(base.laneId || product.laneId || ""), base: clone(base.values), baseRevisions: clone(base.revisions), mine, patch });
      }
      for (const [productId, base] of baseline) if (!currentIds.has(productId)) pending.push({ kind: "delete", productId, productName: String(base.productName || base.values.name || productId), categoryId: String(base.categoryId || ""), laneId: String(base.laneId || ""), base: clone(base.values), baseRevisions: clone(base.revisions), baseProductVersion: base.productVersion, mine: null });
      return pending;
    }

    function persistBaseline() { adapter.setBaselineProducts?.([...baseline.values()].map(clone)); }

    function applySnapshot(incoming, accepted) {
      incoming = normalizeSnapshot(incoming);
      const current = new Map(adapter.getProducts().map((product) => [idOf(product), product]));
      const nextBaseline = new Map(baseline);
      const nextTombstones = new Map(incoming.tombstones.map((item) => [item.productId, clone(item)]));
      const updates = [];
      const remoteIds = new Set(incoming.products.map((item) => item.productId));
      for (const remote of incoming.products) {
        const product = current.get(remote.productId), old = baseline.get(remote.productId), submitted = accepted?.get(remote.productId);
        if (!product) {
          if (submitted && submitted.kind !== "delete" && submitted.disposition !== "master") {
            nextBaseline.set(remote.productId, clone(remote));
            continue;
          }
          if (!old || submitted) {
            updates.push({ kind: "create", productId: remote.productId, categoryId: remote.categoryId, laneId: remote.laneId, values: remote.values });
            nextBaseline.set(remote.productId, clone(remote));
          }
          continue;
        }
        // A local new record must remain an explicit creation until the user
        // resolves an identity collision; refreshing cannot silently adopt it.
        if (!old && !submitted) continue;
        const mine = valuesOf(product), base = submitted ? submitted.mine : old?.values || mine;
        if (submitted?.kind === "delete") {
          updates.push({ productId: remote.productId, values: mine, patch: mine });
          nextBaseline.set(remote.productId, clone(remote));
          continue;
        }
        const baseRevisions = submitted ? remote.revisions : old?.revisions || {};
        const plan = model().planMerge(base, mine, remote.values, baseRevisions, remote.revisions);
        const localValues = model().resolveConflicts(plan, Object.fromEntries(plan.conflicts.map((conflict) => [conflict.path, "mine"])));
        updates.push({ productId: remote.productId, values: localValues, patch: localValues });
        nextBaseline.set(remote.productId, { ...remote,
          values: model().draftBaseline(base, mine, remote.values),
          revisions: model().draftRevisions(base, mine, baseRevisions, remote.revisions),
        });
      }
      for (const [productId, old] of baseline) if (!remoteIds.has(productId)) {
        const product = current.get(productId), submitted = accepted?.get(productId);
        if (product && submitted?.kind === "delete" && submitted.disposition !== "master") { nextBaseline.delete(productId); continue; }
        const clean = !product || !Object.keys(model().diffValues(submitted?.mine || old.values, valuesOf(product))).length;
        if (clean) {
          if (product) updates.push({ kind: "delete", productId });
          nextBaseline.delete(productId);
        } else if (submitted) nextBaseline.delete(productId);
      }
      // A creation discarded in conflict review may never have had a baseline.
      for (const [productId, submitted] of accepted || []) if (!remoteIds.has(productId) && !baseline.has(productId)) {
        const product = current.get(productId);
        if (product && submitted.mine && !Object.keys(model().diffValues(submitted.mine, valuesOf(product))).length) updates.push({ kind: "delete", productId });
      }
      (adapter.applyProductValues || adapter.applyPatches).call(adapter, updates);
      baseline = nextBaseline; snapshot = incoming;
      tombstones = nextTombstones;
      if (mode === "github" && githubToken && incoming.identity) identity = clone(incoming.identity);
      adapter.setMasterSnapshot?.(incoming);
      if (incoming.packageInfo) adapter.setPackageInfo?.(incoming.packageInfo);
      persistBaseline();
      adapter.onMasterChange?.();
      return incoming;
    }

    async function refresh() {
      if (!key || busy) return null;
      const operationGeneration = generation, operationVersion = accessVersion;
      busy = true;
      try {
        const result = await send("latest");
        if (generation !== operationGeneration) throw new Error("The workspace changed while the master was loading. Your current workspace was kept; connect again to refresh it.");
        if (accessVersion !== operationVersion) throw errorOf("The master connection changed while data was loading. Your current workspace and access were kept.", "MASTER_CONNECTION_CHANGED");
        const applied = applySnapshot(result.snapshot);
        connected = true; rememberTeamAccess(key); return applied;
      } catch (error) {
        if (accessVersion === operationVersion) {
          connected = false;
          if (error.code === "INVALID_KEY") clearAccess();
          if (["INVALID_GITHUB_TOKEN", "GITHUB_PERMISSION_DENIED"].includes(error.code)) { resetGitHubAccess(); accessVersion += 1; }
        }
        throw error;
      } finally { busy = false; }
    }

    async function connect(access) {
      let newKey;
      try { newKey = normalizedAccessKey(access && typeof access === "object" ? access.key : access); }
      catch (error) { clearAccess(); throw error; }
      const nextEditorToken = team ? "" : String(access?.editorToken || "").trim();
      if (newKey !== key || nextEditorToken !== editorToken) { accessVersion += 1; connected = false; if (newKey !== key) rememberTeamAccess(""); resetGitHubAccess(); }
      key = newKey; editorToken = nextEditorToken;
      const operationVersion = accessVersion;
      try { return await refresh(); }
      catch (error) { if (accessVersion === operationVersion) { connected = false; if (error.code === "INVALID_KEY") clearAccess(); } throw error; }
    }

    async function save({ reason = "", resolveConflicts, requestId } = {}) {
      if (busy) throw new Error("The master is already updating. Please wait.");
      if (!configured) throw errorOf("Team saving has not been connected by the portfolio owner yet. Your changes remain on this device.", "TEAM_SETUP_REQUIRED");
      if (!key) throw errorOf("Connect to the master before saving.", "INVALID_KEY", 401);
      const originals = new Map(track().map((item) => [item.productId, item]));
      if (!originals.size) return { saved: false, snapshot };
      let changes = [...originals.values()].map(toChange);
      let rebase = null, attempt = 0, keptFences = [], recheckChanges = [];
      const operationGeneration = generation, operationVersion = accessVersion;
      busy = true;
      try {
        for (;;) {
          if (generation !== operationGeneration) throw new Error("The workspace changed while the master was updating. Your current workspace was kept; reconnect before saving again.");
          if (accessVersion !== operationVersion) throw errorOf("The master connection changed while saving. Your current workspace and access were kept.", "MASTER_CONNECTION_CHANGED");
          if (!changes.length && rebase) {
            const latest = (await send("latest")).snapshot;
            if (generation !== operationGeneration) throw new Error("The workspace changed while checking the final master choices. Your current workspace was kept.");
            if (accessVersion !== operationVersion) throw errorOf("The master connection changed while checking the final choices. Your current workspace and access were kept.", "MASTER_CONNECTION_CHANGED");
            const priorProducts = new Map(rebase.products.map((product) => [product.productId, product]));
            const latestProducts = new Map(latest.products.map((product) => [product.productId, product]));
            const overlap = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
            const changed = keptFences.some((conflict) => {
              const before = priorProducts.get(String(conflict.productId)), after = latestProducts.get(String(conflict.productId));
              if (conflict.path === "@product") return JSON.stringify(before || null) !== JSON.stringify(after || null) || JSON.stringify((rebase.tombstones || []).find((item) => item.productId === conflict.productId) || null) !== JSON.stringify((latest.tombstones || []).find((item) => item.productId === conflict.productId) || null);
              if (!before || !after) return true;
              const paths = conflict.path === "@lifecycle" ? ["@launch", "@end"] : [conflict.path, conflict.conflictingPath].filter(Boolean);
              if (model().diffOperations(before.values, after.values).some((operation) => paths.some((path) => overlap(operation.path, path)))) return true;
              return [...new Set([...Object.keys(before.revisions), ...Object.keys(after.revisions)])].some((path) => paths.some((fence) => overlap(path, fence)) && (before.revisions[path] || 0) !== (after.revisions[path] || 0));
            });
            if (changed) { changes = recheckChanges; rebase = null; continue; }
            applySnapshot(latest, originals); return { saved: true, snapshot: latest, keptMaster: true };
          }
          const intent = JSON.stringify({ changes, reason: String(reason).trim(), editorSessionId });
          if (!pendingRequest || pendingRequest.intent !== intent || (attempt === 0 && requestId && pendingRequest.id !== requestId)) pendingRequest = { intent, id: attempt === 0 && requestId ? requestId : root.crypto?.randomUUID?.() || `master-${Date.now()}-${Math.random().toString(36).slice(2)}` };
          const result = await send("save", {
            requestId: pendingRequest.id,
            reason: String(reason).trim(), changes, ...(mode === "service" ? team ? { sessionId: editorSessionId, ...(editorName ? { displayName: editorName } : {}) } : editorName ? { actor: editorName } : {} : {}),
          });
          if (generation !== operationGeneration) throw new Error("The workspace changed while the master was updating. Your current workspace was kept; reconnect to check the saved master.");
          if (accessVersion !== operationVersion) throw errorOf("The master connection changed while saving. Your current workspace and access were kept.", "MASTER_CONNECTION_CHANGED");
          if (result.code !== "MASTER_CONFLICT") { applySnapshot(result.snapshot, originals); connected = true; rememberTeamAccess(key); pendingRequest = null; return { ...result, saved: true }; }
          const localPlans = new Map(), remoteProducts = new Map(result.snapshot.products.map((product) => [product.productId, product]));
          for (const change of changes) {
            const remote = remoteProducts.get(change.productId);
            if (change.kind === "create" || change.kind === "delete" || !remote) { localPlans.set(change.productId, null); continue; }
            localPlans.set(change.productId, model().planMerge(change.base, { ...change.base, ...change.patch }, remote.values, change.baseRevisions, remote.revisions));
          }
          const conflicts = result.conflicts.map((conflict) => {
            const original = originals.get(String(conflict.productId));
            if (!original || !localPlans.has(String(conflict.productId)) || typeof conflict.path !== "string") throw new Error("The master returned an unexpected conflict. Your local changes are safe.");
            return { ...conflict, productName: original.productName, key: conflictKey(String(conflict.productId), conflict.path) };
          });
          if (!conflicts.length) throw new Error("The master changed again. Your local changes are safe; try saving again.");
          for (const [productId, plan] of localPlans) {
            if (!plan) continue;
            for (const conflict of plan.conflicts) if (!conflicts.some((item) => String(item.productId) === productId && item.path === conflict.path)) throw new Error("The master returned an incomplete conflict review. Your local changes are safe.");
          }
          const selected = await resolveConflicts?.(conflicts, result.snapshot);
          if (generation !== operationGeneration) throw new Error("The workspace changed while choosing the final values. Your current workspace was kept.");
          if (accessVersion !== operationVersion) throw errorOf("The master connection changed while choosing the final values. Your current workspace and access were kept.", "MASTER_CONNECTION_CHANGED");
          if (!selected) return { saved: false, cancelled: true, snapshot };
          for (const conflict of conflicts) if (!["mine", "master"].includes(selected instanceof Map ? selected.get(conflict.key) : selected[conflict.key])) throw new Error("Choose a final value for every conflict.");
          for (const conflict of conflicts) if (conflict.path === "@product") originals.get(conflict.productId).disposition = selected instanceof Map ? selected.get(conflict.key) : selected[conflict.key];
          const nextChanges = [];
          recheckChanges = [];
          keptFences = conflicts.filter((conflict) => (selected instanceof Map ? selected.get(conflict.key) : selected[conflict.key]) === "master");
          for (const change of changes) {
            const remote = remoteProducts.get(change.productId), plan = localPlans.get(change.productId);
            const choices = Object.fromEntries(conflicts.filter((conflict) => String(conflict.productId) === change.productId).map((conflict) => [conflict.path, selected instanceof Map ? selected.get(conflict.key) : selected[conflict.key]]));
            if (!plan) {
              const lifecycle = conflicts.find((item) => item.productId === change.productId && item.path === "@product");
              const choice = lifecycle ? choices["@product"] : "mine";
              const rebased = rebaseLifecycle(change, remote, result.snapshot);
              if (rebased) recheckChanges.push(rebased);
              if (choice === "mine" && rebased) nextChanges.push(rebased);
              continue;
            }
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
        if (accessVersion === operationVersion) {
          if (error.code === "INVALID_KEY") clearAccess();
          if (["INVALID_GITHUB_TOKEN", "GITHUB_PERMISSION_DENIED"].includes(error.code)) { resetGitHubAccess(); accessVersion += 1; }
        }
        throw error;
      } finally { busy = false; }
    }

    function toChange(item) {
      if (item.kind === "create") return { kind: "create", productId: item.productId, categoryId: item.categoryId, laneId: item.laneId, mine: clone(item.mine), baseRevisions: clone(item.baseRevisions) };
      if (item.kind === "delete") return { kind: "delete", productId: item.productId, categoryId: item.categoryId, laneId: item.laneId, base: clone(item.base), baseRevisions: clone(item.baseRevisions), baseProductVersion: item.baseProductVersion };
      return { productId: item.productId, categoryId: item.categoryId, laneId: item.laneId, base: clone(item.base), baseRevisions: clone(item.baseRevisions), patch: clone(item.patch) };
    }

    function rebaseLifecycle(change, remote, latest) {
      if (change.kind === "delete") return remote ? { ...change, categoryId: remote.categoryId, laneId: remote.laneId, base: clone(remote.values), baseRevisions: clone(remote.revisions), baseProductVersion: remote.productVersion } : null;
      const mine = change.kind === "create" ? change.mine : model().patchValues(change.base, change.patch);
      if (remote) {
        const patch = model().diffValues(remote.values, mine);
        return Object.keys(patch).length ? { productId: change.productId, base: clone(remote.values), baseRevisions: clone(remote.revisions), patch } : null;
      }
      return { kind: "create", productId: change.productId, categoryId: change.categoryId, laneId: change.laneId, mine: clone(mine), baseRevisions: clone((latest.tombstones || []).find((item) => item.productId === change.productId)?.revisions || {}) };
    }

    function markImported(products, importedKey) {
      seed(products || adapter.getBaselineProducts?.() || adapter.getProducts()); connected = false;
      accessVersion += 1;
      let newKey = "";
      try { newKey = normalizedAccessKey(importedKey); } catch {}
      if (!newKey || newKey !== key) { editorToken = ""; resetGitHubAccess(); }
      key = newKey;
      rememberTeamAccess(key);
      persistBaseline();
    }
    return Object.freeze({ connect, refresh, save, applySnapshot, track, markImported,
      async presence({ sessionId, displayName, editing, productId, categoryId, leave = false } = {}) {
        if (mode === "github" || !configured || !key) return null;
        const operationVersion = accessVersion;
        try { return await request({ endpoint, operation: "presence", key, team, fetchImpl, keepalive: Boolean(leave), sessionId, displayName, editing, productId, ...(categoryId ? { categoryId } : {}), leave: Boolean(leave) }); }
        catch (error) { if (error.code === "INVALID_KEY" && accessVersion === operationVersion) clearAccess(); throw error; }
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
