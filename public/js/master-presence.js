/* Connected browser sessions beside the category selector. Display names are optional. */
(function (root) {
  "use strict";
  let active = null;
  const displayNameKey = "portfolio.sharedDisplayName";
  const activityModes = new Set(["browsing", "editing", "roadmap", "focused", "idle"]);
  const validSessionId = (value) => typeof value === "string" && /^[-_a-z0-9]{8,128}$/i.test(value);
  const anonymousName = (sessionId) => `Editor ${String(sessionId).replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase()}`;
  const avatarText = (name, sessionId) => {
    if (!name || name === anonymousName(sessionId)) return String(sessionId).replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
    const words = String(name).trim().split(/\s+/);
    return (words.length > 1 ? words[0].slice(0, 1) + words.at(-1).slice(0, 1) : words[0].slice(0, 2)).toUpperCase();
  };
  const avatarTone = (sessionId) => [...String(sessionId)].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 5, 0);
  const sessionSummary = (count) => `${count} connected ${count === 1 ? "session" : "sessions"}`;
  const activityText = (user) => user.activity === "idle" && !user.editing ? `Taking a breather${user.categoryName ? ` · ${user.categoryName}` : ""}` : user.activity === "roadmap" && !user.editing ? `Exploring the roadmap${user.categoryName ? ` · ${user.categoryName}` : ""}` : `${user.editing ? "Editing" : user.activity === "focused" ? "Focused on" : "Viewing"} ${user.productName || user.categoryName || "the portfolio"}${user.productName && user.categoryName ? ` · ${user.categoryName}` : ""}`;
  const connectionSummary = (state) => !state.configured ? "Team sharing is not connected" : state.mode === "github" ? state.connected ? `${state.users.length} recent ${state.users.length === 1 ? "editor" : "editors"}` : "No recent editors" : state.unavailable ? "Shared connection unavailable" : state.connected ? sessionSummary(state.onlineCount) : state.hasKey ? "Connecting…" : "Not connected";

  function ascmUpdateTimestamp(value, time) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return "";
    const instant = Date.parse(value);
    if (!Number.isFinite(instant) || !Number.isFinite(time) || instant > time) return "";
    const canonical = new Date(instant).toISOString();
    return canonical === value.replace(/Z$/, value.includes(".") ? "Z" : ".000Z") ? canonical : "";
  }

  function ascmUpdateReadout(lastUpdatedAt, time) {
    if (!lastUpdatedAt) return null;
    const localDay = (date) => { const day = new Date(0); day.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate()); day.setUTCHours(0, 0, 0, 0); return day.getTime() / 86400000; };
    const date = new Date(lastUpdatedAt), days = localDay(new Date(time)) - localDay(date);
    return { age: days === 0 ? "Today" : `${days} ${days === 1 ? "day" : "days"} ago`, date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date) };
  }

  function normalizeAscmSupervisor(value, time = Date.now()) {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.enabled !== true) return null;
    const reconnectRequired = Array.isArray(value.reconnectRequired) ? ["outlook", "sharepoint"].filter((provider) => value.reconnectRequired.includes(provider)) : [];
    const lastUpdatedAt = ascmUpdateTimestamp(value.lastUpdatedAt, time);
    const idle = { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired, ...(lastUpdatedAt ? { lastUpdatedAt } : {}) };
    const expiry = typeof value.expiresAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expiresAt) ? Date.parse(value.expiresAt) : NaN;
    // Server leases are 120 seconds. Allow five seconds of clock skew, never an indefinite busy badge.
    if (value.working !== true || !Number.isFinite(expiry) || expiry <= time || expiry - time > 125000 || new Date(expiry).toISOString() !== value.expiresAt) return idle;
    return { ...idle, working: true, productCount: Number.isSafeInteger(value.productCount) && value.productCount >= 0 && value.productCount <= 500 ? value.productCount : null, expiresAt: value.expiresAt };
  }

  function createAscmSupervisorView({ documentObject = document, indicator, rosterContainer, headerControl, focusFallback, now = Date.now,
    setTimeoutImpl = (callback, delay) => root.setTimeout(callback, delay), clearTimeoutImpl = (id) => root.clearTimeout(id) } = {}) {
    const make = (tag, className, text) => { const node = documentObject.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
    const clock = () => { const node = make("span", "ascm-supervisor-clock"); node.setAttribute("aria-hidden", "true"); return node; };
    const label = make("span", "ascm-supervisor-label");
    const tooltip = make("span", "ascm-update-tooltip"), readout = make("span", "ascm-update-readout");
    const updateHeading = make("span", "ascm-update-heading"), updateElapsed = make("span", "ascm-update-elapsed"), updateDivider = make("span", "ascm-update-divider"), updateDate = make("time", "ascm-update-date");
    tooltip.id = "ascmUpdateTooltip"; tooltip.hidden = true; tooltip.setAttribute("role", "tooltip"); tooltip.setAttribute("aria-live", "off"); updateDivider.setAttribute("aria-hidden", "true");
    readout.append(updateHeading, updateElapsed, updateDivider, updateDate); tooltip.append(readout);
    if (indicator) { indicator.removeAttribute("title"); indicator.setAttribute("tabindex", "0"); indicator.setAttribute("aria-describedby", tooltip.id); indicator.replaceChildren(clock(), label, tooltip); }
    const row = make("div", "master-presence-row ascm-supervisor-row"), person = make("div", "master-presence-person ascm-supervisor-person");
    const reconnect = make("button", "icon-button ascm-supervisor-reconnect"), handoff = make("div", "ascm-reconnect-handoff");
    reconnect.type = "button"; reconnect.title = "Reconnect Microsoft"; reconnect.setAttribute("aria-label", "Reconnect Microsoft"); reconnect.setAttribute("aria-expanded", "false"); reconnect.setAttribute("aria-controls", "ascmReconnectHandoff");
    const svgNamespace = "http://www.w3.org/2000/svg", key = documentObject.createElementNS(svgNamespace, "svg");
    for (const [name, value] of Object.entries({ class: "ascm-reconnect-key", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) key.setAttribute(name, value);
    const bow = documentObject.createElementNS(svgNamespace, "circle"); bow.setAttribute("cx", "7"); bow.setAttribute("cy", "12"); bow.setAttribute("r", "4");
    const teeth = documentObject.createElementNS(svgNamespace, "path"); teeth.setAttribute("d", "M11 12h10m-3 0v3m-3-3v2"); key.append(bow, teeth); reconnect.append(key);
    function createPortrait() {
      const portrait = make("span", "ascm-supervisor-portrait"), face = documentObject.createElementNS(svgNamespace, "svg");
      portrait.setAttribute("role", "img"); portrait.setAttribute("aria-label", "ASCM supervisor");
      // Static bot portrait shares the existing faces' line weights, without human identity or interaction hooks.
      for (const [name, value] of Object.entries({ class: "ascm-supervisor-face", viewBox: "0 0 32 32", fill: "none", stroke: "currentColor", "stroke-width": "2.1", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) face.setAttribute(name, value);
      for (const [tag, attributes] of [
        ["rect", { x: "5", y: "9", width: "22", height: "18", rx: "6" }],
        ["path", { d: "M16 9V5M14 4h4M5 15H3v6h2M27 15h2v6h-2", "stroke-width": "1.6" }],
        ["path", { d: "M11.5 15v2.5M20.5 15v2.5", "stroke-width": "2.25" }],
        ["path", { d: "M12.5 21.5Q16 24 19.5 21.5", "stroke-width": "1.55" }],
      ]) { const feature = documentObject.createElementNS(svgNamespace, tag); for (const [name, value] of Object.entries(attributes)) feature.setAttribute(name, value); face.append(feature); }
      portrait.append(face); return portrait;
    }
    const portrait = createPortrait();
    if (headerControl) { const headerPortrait = createPortrait(); headerPortrait.setAttribute("aria-hidden", "true"); headerControl.append(headerPortrait); }
    handoff.id = "ascmReconnectHandoff"; handoff.hidden = true;
    const link = make("a", "ascm-reconnect-link", "Open Copilot Studio"); link.href = "https://copilotstudio.microsoft.com/environments/Default-ca7981a2-785a-463d-b82a-3db87dfc3ce6/flows/5bb99050-adca-f111-a05c-000d3a3191e3/overview"; link.target = "_blank"; link.rel = "noopener noreferrer";
    handoff.append(make("p", "", "The flow owner must reconnect Office 365 Outlook or SharePoint in Copilot Studio → Manage connection references."), make("p", "", "Complete Microsoft sign-in, then return here."), make("p", "", "Status updates after the next successful supervisor check."), link);
    person.append(reconnect, handoff); row.append(portrait, person); rosterContainer?.append(row);
    let timer = null, latest = null, disposed = false, tooltipHovered = false, tooltipDismissed = false;
    function updateTooltip() {
      if (disposed) return;
      const time = now(), state = latest;
      const supervisor = state?.connected && !state.unavailable && state.mode !== "github" ? normalizeAscmSupervisor(state.ascmSupervisor, time) : null;
      const details = ascmUpdateReadout(supervisor?.lastUpdatedAt, time);
      updateHeading.textContent = details ? "Last ASCM update" : "No ASCM update recorded.";
      updateElapsed.textContent = details?.age || ""; updateDate.textContent = details?.date || ""; updateDate.dateTime = supervisor?.lastUpdatedAt || "";
      updateElapsed.hidden = updateDivider.hidden = updateDate.hidden = !details;
      tooltip.setAttribute("aria-label", details ? `Last ASCM update: ${details.age}. ${details.date}` : "No ASCM update recorded.");
      if (!supervisor || documentObject.visibilityState === "hidden") { tooltipHovered = false; tooltipDismissed = false; tooltip.hidden = true; return; }
      tooltip.hidden = tooltipDismissed || (!tooltipHovered && documentObject.activeElement !== indicator);
    }
    function closeUpdateTooltip() { if (tooltip.hidden) return false; tooltipDismissed = true; tooltip.hidden = true; return true; }
    const tooltipListeners = [
      ["pointerenter", () => { tooltipHovered = true; tooltipDismissed = false; updateTooltip(); }],
      ["pointerleave", () => { tooltipHovered = false; updateTooltip(); }],
      ["focus", () => { tooltipDismissed = false; updateTooltip(); }],
      ["blur", updateTooltip],
    ];
    for (const [event, listener] of tooltipListeners) indicator?.addEventListener(event, listener);
    function closeReconnect({ restoreFocus = true } = {}) {
      if (handoff.hidden) return false;
      handoff.hidden = true; reconnect.setAttribute("aria-expanded", "false");
      if (restoreFocus && !row.hidden && !reconnect.hidden && !disposed) reconnect.focus({ preventScroll: true });
      return true;
    }
    function toggleReconnect() {
      if (disposed || row.hidden || reconnect.hidden) return;
      if (closeReconnect()) return;
      handoff.hidden = false; reconnect.setAttribute("aria-expanded", "true");
    }
    reconnect.addEventListener("click", toggleReconnect);
    function render(state) {
      if (disposed) return;
      latest = state;
      if (timer !== null) clearTimeoutImpl(timer); timer = null;
      const supervisor = state?.connected && !state.unavailable && state.mode !== "github" ? normalizeAscmSupervisor(state.ascmSupervisor, now()) : null;
      const needsReconnect = Boolean(supervisor?.reconnectRequired.length);
      if (!needsReconnect) {
        const restoreFocus = row.contains(documentObject.activeElement);
        closeReconnect({ restoreFocus: false });
        if (restoreFocus) focusFallback?.focus({ preventScroll: true });
      }
      const working = supervisor?.working === true;
      const text = working ? `Updating ASCM${supervisor.productCount === null ? "" : ` · ${supervisor.productCount} ${supervisor.productCount === 1 ? "product" : "products"}`}` : "";
      if (indicator) {
        indicator.hidden = !supervisor;
        indicator.setAttribute("aria-label", text || "ASCM supervisor");
        indicator.classList.toggle("is-working", working);
        indicator.classList.toggle("is-paused", documentObject.visibilityState === "hidden");
      }
      label.textContent = text; label.hidden = !working;
      row.hidden = !supervisor; reconnect.hidden = !needsReconnect;
      if (headerControl) headerControl.hidden = !supervisor;
      updateTooltip();
      if (working) timer = setTimeoutImpl(() => { timer = null; render(latest); }, Math.max(1, Date.parse(supervisor.expiresAt) - now()));
    }
    render(null);
    return Object.freeze({ render, closeReconnect, closeUpdateTooltip, destroy() { render(null); disposed = true; for (const [event, listener] of tooltipListeners) indicator?.removeEventListener(event, listener); tooltip.remove(); indicator?.removeAttribute("aria-describedby"); indicator?.removeAttribute("tabindex"); reconnect.removeEventListener("click", toggleReconnect); row.remove(); } });
  }

  function normalizeRecentEditors(snapshot, identity) {
    const seen = new Set(), users = [];
    for (const editor of snapshot?.recentEditors || []) {
      const login = String(editor?.login || "").trim();
      if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(login) || seen.has(login.toLowerCase())) continue;
      seen.add(login.toLowerCase());
      const name = String(editor.name || login).trim().slice(0, 80);
      users.push({ sessionId: `github-${login}`, displayName: name, label: name === login ? login : `${name} (${login})`, login, at: typeof editor.at === "string" ? editor.at : "", isSelf: login.toLowerCase() === String(identity?.login || "").toLowerCase(), editing: false });
      if (users.length >= 1000) break;
    }
    return users;
  }

  function normalizeRoster(response, ownSessionId) {
    const seen = new Set();
    const users = [];
    for (const item of response?.sessions || response?.users || []) {
      const sessionId = String(item?.sessionId || "");
      if (!/^[-_a-z0-9]{8,128}$/i.test(sessionId) || seen.has(sessionId)) continue;
      seen.add(sessionId);
      const displayName = typeof item.displayName === "string" ? item.displayName.trim().slice(0, 60) : "";
      users.push({ sessionId, displayName, label: displayName || anonymousName(sessionId), editing: item.editing === true,
        activity: item.editing === true ? "editing" : activityModes.has(item.activity) && item.activity !== "editing" ? item.activity : "browsing", receivePokes: item.receivePokes !== false,
        productId: String(item.productId || ""), productName: String(item.productName || "").slice(0, 240),
        categoryId: String(item.categoryId || ""), categoryName: String(item.categoryName || "").slice(0, 180),
        isSelf: sessionId === ownSessionId, lastSeenAt: item.lastSeenAt || item.lastSeen || "",
      });
      if (users.length >= 1000) break;
    }
    return users.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.label.localeCompare(b.label));
  }

  function createController({ sessionProvider, getSelectedProductId = () => "", getSelectedCategoryId = () => "", getActivity = () => "browsing", onChange = () => {}, onPokeReceived = () => {}, receivePokes = true, now = Date.now, sessionId = sessionProvider?.()?.getState?.()?.editorProfile?.sessionId || root.crypto?.randomUUID?.() || `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, displayName = "" } = {}) {
    let users = [], mode = "service", configured = false, connected = false, unavailable = false, hasKey = false, hasGitHubToken = false, inFlight = null;
    let generation = 0, observedSession = null, observedAccessVersion, observedHasKey = false;
    let pokeSupported = false, allowPokes = receivePokes !== false, pokeSequence = 0, ascmSupervisor = null;
    const ackPokeIds = new Set(), seenPokes = new Map(), pokeCooldowns = new Map(), pokeAttempts = new Map();
    let name = String(displayName).trim().slice(0, 60);
    function state() { return { users: users.map((user) => ({ ...user })), mode, onlineCount: mode === "github" ? 0 : users.length, configured, connected, unavailable, hasKey, hasGitHubToken, sessionId, displayName: name, pokeSupported, receivePokes: allowPokes, ascmSupervisor: connected && !unavailable && mode !== "github" ? normalizeAscmSupervisor(ascmSupervisor, now()) : null }; }
    function pokeError(message, code) { const error = new Error(message); error.code = code; return error; }
    function receiveInbox(response) {
      const time = now();
      for (const [id, at] of seenPokes) if (time - at > 90000) seenPokes.delete(id);
      for (const event of Array.isArray(response.pokes) ? response.pokes.slice(0, 16) : []) {
        if (!validSessionId(event?.id) || !validSessionId(event?.fromSessionId) || event.fromSessionId === sessionId || event.toSessionId !== sessionId) continue;
        if (ackPokeIds.size < 64) ackPokeIds.add(event.id);
        if (seenPokes.has(event.id)) continue;
        if (seenPokes.size >= 256) seenPokes.delete(seenPokes.keys().next().value);
        seenPokes.set(event.id, time);
        const at = Date.parse(event.createdAt);
        if (!allowPokes || !Number.isFinite(at) || time - at > 45000 || at - time > 5000) continue;
        const safeEvent = { id: event.id, fromSessionId: event.fromSessionId, toSessionId: sessionId,
          fromDisplayName: String(event.fromDisplayName || anonymousName(event.fromSessionId)).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60), createdAt: new Date(at).toISOString() };
        try { onPokeReceived(safeEvent); } catch { /* Social feedback must never interrupt editing or the heartbeat. */ }
      }
    }
    function observeAccess() {
      const session = sessionProvider?.();
      session?.setEditorProfile?.({ sessionId, displayName: name });
      const sessionState = session?.getState();
      mode = sessionState?.mode === "github" ? "github" : "service";
      hasGitHubToken = Boolean(sessionState?.hasGitHubToken);
      configured = Boolean(session && sessionState?.configured !== false);
      const available = Boolean(configured && sessionState?.hasKey && (mode === "github" || session?.presence));
      if (session !== observedSession || available !== observedHasKey || sessionState?.accessVersion !== observedAccessVersion) {
        generation += 1;
        observedSession = session; observedHasKey = available; observedAccessVersion = sessionState?.accessVersion;
        users = []; connected = false; unavailable = false; pokeSupported = false; ascmSupervisor = null; ackPokeIds.clear(); seenPokes.clear(); pokeCooldowns.clear(); pokeAttempts.clear();
      }
      hasKey = available;
      return { session, sessionState, generation };
    }
    async function heartbeat({ leave = false, poke } = {}) {
      const { session, sessionState } = observeAccess();
      if (mode === "github") {
        generation += 1;
        ascmSupervisor = null;
        users = leave ? [] : normalizeRecentEditors(sessionState?.snapshot, sessionState?.identity);
        connected = Boolean(!leave && hasKey && sessionState?.snapshot); unavailable = false;
        onChange(state()); return state();
      }
      if (!hasKey) {
        hasKey = false; connected = false; unavailable = false; users = []; ascmSupervisor = null; onChange(state()); return state();
      }
      if (leave) { generation += 1; users = []; connected = false; unavailable = false; ascmSupervisor = null; onChange(state()); }
      if (inFlight?.generation === generation && !leave) return state();
      const operation = { generation, session }; operation.done = new Promise((resolve) => { operation.finish = resolve; }); inFlight = operation;
      let pokeResult = null, pokeFailure = null;
      const acknowledgments = pokeSupported ? [...ackPokeIds] : [];
      try {
        const selected = String(getSelectedProductId() || ""), pending = sessionState.pending || [];
        const draft = pending.find((product) => product.productId === selected);
        const requestedActivity = getActivity();
        const response = await session.presence({ sessionId, displayName: name, editing: Boolean(draft), productId: selected, categoryId: String(getSelectedCategoryId() || ""), leave,
          ...(pokeSupported && !leave ? { activity: draft ? "editing" : activityModes.has(requestedActivity) && requestedActivity !== "editing" ? requestedActivity : "browsing", receivePokes: allowPokes, ackPokeIds: acknowledgments, ...(poke ? { poke } : {}) } : {}) });
        const current = observeAccess();
        if (current.generation !== operation.generation || current.session !== operation.session || !hasKey) { if (poke) throw pokeError("The shared connection changed. Try again after reconnecting.", "POKE_CONNECTION_CHANGED"); return state(); }
        if (response && !leave) {
          const previous = new Map(users.map((user) => [user.sessionId, user]));
          users = normalizeRoster(response, sessionId).map((user) => ({ ...user, editingSince: user.editing ? previous.get(user.sessionId)?.editing && previous.get(user.sessionId)?.productId === user.productId ? previous.get(user.sessionId).editingSince ?? now() : now() : null }));
          connected = true; unavailable = false; pokeSupported = response.capabilities?.pokes === true;
          ascmSupervisor = normalizeAscmSupervisor(response.ascmSupervisor, now());
          for (const id of acknowledgments) ackPokeIds.delete(id);
          if (pokeSupported) receiveInbox(response);
          if (poke) {
            if (response.poke?.id !== poke.id || !["queued", "duplicate", "throttled", "unavailable"].includes(response.poke?.status)) throw pokeError("This connection could not confirm your poke. Try again.", "POKE_UNCONFIRMED");
            pokeResult = { ...response.poke };
            // Record before releasing a waiting sender, so simultaneous clicks
            // cannot slip through the target's cooldown between microtasks.
            if (["queued", "duplicate"].includes(pokeResult.status)) pokeCooldowns.set(poke.targetSessionId, now());
            pokeAttempts.delete(poke.targetSessionId);
          }
        }
        if (!response || leave) ascmSupervisor = null;
        if (leave) { users = []; connected = false; }
      } catch (error) {
        if (poke) pokeFailure = error;
        const current = observeAccess();
        if (current.generation === operation.generation && current.session === operation.session && hasKey) { connected = false; unavailable = true; ascmSupervisor = null; }
      } finally { if (inFlight === operation) inFlight = null; try { onChange(state()); } finally { operation.finish(); } }
      if (pokeFailure) throw pokeFailure;
      if (poke) return pokeResult;
      return state();
    }
    return Object.freeze({ heartbeat, getState: state,
      async poke(targetSessionId) {
        observeAccess();
        const expectedGeneration = generation, expectedSession = observedSession;
        while (inFlight) await inFlight.done;
        observeAccess();
        if (expectedGeneration !== generation || expectedSession !== observedSession || !pokeSupported || !connected || unavailable || mode === "github" || !hasKey) throw pokeError("Pokes are not available on this connection yet.", "POKE_UNAVAILABLE");
        const target = users.find((user) => user.sessionId === targetSessionId && !user.isSelf && user.receivePokes);
        if (!validSessionId(targetSessionId) || !target || targetSessionId === sessionId) throw pokeError("That teammate is not available for pokes.", "POKE_TARGET_UNAVAILABLE");
        const time = now();
        for (const [id, at] of pokeCooldowns) if (time - at >= 60000) pokeCooldowns.delete(id);
        for (const [targetId, attempt] of pokeAttempts) if (time - attempt.at >= 90000) pokeAttempts.delete(targetId);
        if (time - (pokeCooldowns.get(targetSessionId) || -Infinity) < 5000) throw pokeError("Give that face a moment to recover.", "POKE_COOLDOWN");
        const id = pokeAttempts.get(targetSessionId)?.id || root.crypto?.randomUUID?.() || `poke-${sessionId.slice(0, 64)}-${time.toString(36)}-${(++pokeSequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        if (pokeAttempts.size >= 256 && !pokeAttempts.has(targetSessionId)) pokeAttempts.delete(pokeAttempts.keys().next().value);
        if (!pokeAttempts.has(targetSessionId)) pokeAttempts.set(targetSessionId, { id, at: time });
        const result = await heartbeat({ poke: { id, targetSessionId } });
        return result;
      },
      async setReceivePokes(value) { allowPokes = value !== false; onChange(state()); while (inFlight) await inFlight.done; return heartbeat(); },
      setDisplayName(value) { const next = String(value || "").trim().slice(0, 60); if (next !== name) generation += 1; name = next; return heartbeat(); },
      leave() { return heartbeat({ leave: true }); },
    });
  }

  function initialize({ sessionProvider = () => root.PortfolioMasterUI?.getSession(), adapter = root.PortfolioMasterAdapter, getActivityContext, onPoke } = {}) {
    if (active) return active;
    const brand = document.querySelector(".brand-block");
    if (!brand) return null;
    const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
    const shell = make("div", "master-presence"), trigger = make("button", "master-presence-trigger");
    trigger.type = "button"; trigger.setAttribute("aria-haspopup", "dialog"); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-controls", "masterPresencePopover");
    const popover = make("section", "master-presence-popover"); popover.id = "masterPresencePopover"; popover.hidden = true; popover.setAttribute("role", "dialog"); popover.setAttribute("aria-labelledby", "masterPresenceTitle");
    const heading = make("header", "master-presence-heading"), title = make("h3", "", "Connected now"); title.id = "masterPresenceTitle";
    const close = make("button", "icon-button master-presence-close", "×"); close.type = "button"; close.setAttribute("aria-label", "Close connected sessions"); heading.append(title, close);
    const connection = make("p", "master-presence-summary"), rows = make("div", "master-presence-list"); connection.setAttribute("role", "status"); connection.setAttribute("aria-live", "polite");
    const nameForm = make("form", "master-presence-name-form"), nameLabel = make("label", "", "Your display name (optional)"), nameInput = make("input", "master-presence-name");
    nameInput.type = "text"; nameInput.maxLength = 60; nameInput.autocomplete = "nickname"; nameInput.placeholder = "Name";
    let storedName = ""; try { storedName = root.localStorage.getItem(displayNameKey) || ""; } catch {}
    nameInput.value = storedName.slice(0, 60); nameLabel.append(nameInput);
    const nameSave = make("button", "quiet-button", "Apply"); nameSave.type = "submit"; nameForm.append(nameLabel, nameSave);
    const githubConnect = make("button", "quiet-button", "Connect GitHub"); githubConnect.type = "button"; githubConnect.hidden = true; githubConnect.addEventListener("click", () => root.PortfolioMasterUI?.connectGitHub());
    const play = make("button", "presence-play", "Make a face"); play.type = "button"; play.title = "A little goof for your own face, just on this screen";
    const supervisorRows = make("div", "ascm-supervisor-roster");
    const supervisorHeader = make("button", "ascm-supervisor-header"); supervisorHeader.type = "button"; supervisorHeader.title = "ASCM supervisor";
    supervisorHeader.setAttribute("aria-label", "ASCM supervisor. View connection status"); supervisorHeader.setAttribute("aria-haspopup", "dialog"); supervisorHeader.setAttribute("aria-expanded", "false"); supervisorHeader.setAttribute("aria-controls", popover.id);
    popover.append(heading, connection, rows, supervisorRows, play, nameForm, githubConnect); shell.append(supervisorHeader, trigger, popover); brand.append(shell);
    const supervisorIndicator = document.getElementById("ascmSupervisorIndicator");
    const supervisorView = createAscmSupervisorView({ indicator: supervisorIndicator, rosterContainer: supervisorRows, headerControl: supervisorHeader, focusFallback: close });
    // Expression updates are entirely local. They never send an additional presence request.
    const listeners = new root.AbortController(), signal = listeners.signal;
    let open = false, disposed = false, debounceTimer = null, playTimer = null, gazeFrame = null, reactionFrame = null, playfulUntil = 0, rosterOpener = trigger;
    let lastInputAt = Date.now(), activeView = root.PortfolioSearchAdapter?.getActiveView?.() || "products", latestState;
    if (activeView === "split") activeView = "roadmap";
    const stack = make("span", "master-presence-avatars"), stackCache = new Map(), rowCache = new Map(); shell.insertBefore(stack, supervisorHeader);
    const overflow = make("span", "master-presence-avatar master-presence-overflow"); overflow.setAttribute("aria-hidden", "true"); trigger.append(overflow);
    const pendingPokes = new Set();
    const socialStatus = make("span", "visually-hidden"); socialStatus.setAttribute("role", "status"); socialStatus.setAttribute("aria-live", "polite"); shell.append(socialStatus);
    const reactions = root.PortfolioPresenceReactions?.create({ onChange: () => renderLocal() });
    const bump = root.PortfolioPresenceBump?.create({ shell });
    let socialTrip = false, tripSequence = 0;
    const neighbors = root.PortfolioPresenceNeighbors?.create({ shell,
      isAvailable: () => !disposed && !open && !socialTrip && !pendingPokes.size && Date.now() >= playfulUntil &&
        latestState?.connected && !latestState.unavailable && latestState.mode !== "github" });
    const observer = root.IntersectionObserver ? new root.IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle("is-in-view", entry.isIntersecting);
    }) : null;
    function setOpen(value, { restoreFocus = true } = {}) {
      const opener = document.activeElement;
      open = value; popover.hidden = !value; trigger.setAttribute("aria-expanded", String(value)); supervisorHeader.setAttribute("aria-expanded", String(value));
      for (const control of stack.querySelectorAll("[data-opens-roster]")) control.setAttribute("aria-expanded", String(value));
      if (value) { rosterOpener = opener === supervisorHeader ? supervisorHeader : trigger; renderLocal(); controller.heartbeat(); if (shell.contains(opener) && opener.matches(":focus-visible")) close.focus({ preventScroll: true }); }
      else { supervisorView.closeReconnect({ restoreFocus: false }); if (restoreFocus) (rosterOpener.hidden ? trigger : rosterOpener).focus({ preventScroll: true }); }
      neighbors?.refresh();
    }
    function contextFor(user, state) {
      if (state.mode === "github") return { recent: true };
      if (!state.connected || state.unavailable) return { mood: "offline" };
      const editingForMs = user.editing ? Math.max(0, Date.now() - Number(user.editingSince ?? Date.now())) : 0;
      if (!user.isSelf) return user.editing ? { editingForMs } : { mood: user.activity || "browsing" };
      return { view: activeView, focused: Boolean(adapter?.getSelectedProductId?.()), idle: Date.now() - lastInputAt > 60000,
        playful: Date.now() < playfulUntil, editingForMs, ...getActivityContext?.(user, state) };
    }
    function avatar(user, state) {
      const context = contextFor(user, state);
      const circle = root.PortfolioPresenceExpressions?.createAvatar(user, context) || make("span", "master-presence-avatar", avatarText(user.displayName, user.sessionId));
      circle.classList.toggle("is-editing", state.connected && !state.unavailable && state.mode !== "github" && user.editing === true);
      circle.setAttribute("aria-hidden", "true");
      circle.title = `${user.label}${user.categoryName || user.productName ? ` · ${activityText(user)}` : ""}`;
      reactions?.decorate(circle, user);
      if (observer) observer.observe(circle); else circle.classList.add("is-in-view");
      return circle;
    }
    function faceSignature(user, state) { return JSON.stringify([state.mode, state.connected, state.unavailable, state.pokeSupported, user.label, user.editing, user.activity, user.receivePokes, reactions?.get(user.sessionId), user.productName, user.categoryName, user.at, user.isSelf, root.PortfolioPresenceExpressions?.profile(user, contextFor(user, state)).mood || contextFor(user, state)]); }
    function headerPortrait(user, state) {
      const button = make("button", "presence-header-person"); button.type = "button"; button.dataset.sessionId = user.sessionId;
      const reaction = reactions?.get(user.sessionId);
      const canPoke = !user.isSelf && user.receivePokes !== false && state.connected && !state.unavailable && state.mode !== "github" && (state.pokeSupported || typeof onPoke === "function");
      button.title = reaction?.message || (canPoke ? `Poke ${user.label}` : user.label);
      button.setAttribute("aria-label", canPoke ? `Poke ${user.label}${reaction?.kind === "received" ? " back" : ""}` : `${user.label}. View people`);
      if (canPoke) button.addEventListener("click", () => sendPokeTarget(user.sessionId));
      else { button.dataset.opensRoster = "true"; button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-expanded", String(open)); button.setAttribute("aria-controls", popover.id); button.addEventListener("click", () => setOpen(!open)); }
      button.append(avatar(user, state)); return button;
    }
    function updatePending(node, sessionId) {
      const button = node.matches("button") ? node : node.querySelector(".presence-poke-button");
      if (button) { const pending = pendingPokes.has(sessionId); button.setAttribute("aria-disabled", String(pending)); button.classList.toggle("is-poke-pending", pending); }
    }
    function forget(node) { for (const circle of node.matches?.(".presence-character") ? [node] : node.querySelectorAll(".presence-character")) observer?.unobserve(circle); }
    function reconcile(parent, entries, cache) {
      const keep = new Set(entries.map(([key]) => key));
      for (const [key, entry] of cache) if (!keep.has(key)) { if (parent === stack) neighbors?.cancel(); forget(entry.node); entry.node.remove(); cache.delete(key); }
      let cursor = parent.firstChild;
      for (const [, entry] of entries) { if (entry.node === cursor) cursor = cursor.nextSibling; else { if (parent === stack) neighbors?.cancel(); parent.insertBefore(entry.node, cursor); } }
    }
    function remember(cache, key, signature, create) {
      let entry = cache.get(key);
      if (entry?.signature !== signature) {
        const next = { signature, node: create() };
        if (entry) {
          bump?.cancel();
          neighbors?.cancel();
          const focused = entry.node === document.activeElement || entry.node.contains(document.activeElement);
          forget(entry.node); entry.node.replaceWith(next.node);
          if (focused) (next.node.matches("button") ? next.node : next.node.querySelector("button"))?.focus({ preventScroll: true });
        }
        cache.set(key, next); entry = next;
      }
      return [key, entry];
    }
    function render(state) {
      if (disposed) return;
      latestState = state;
      supervisorView.render(state);
      if (supervisorHeader.hidden && document.activeElement === supervisorHeader || supervisorIndicator?.hidden && document.activeElement === supervisorIndicator) trigger.focus({ preventScroll: true });
      title.textContent = state.mode === "github" ? "Recent editors" : "Connected now";
      close.setAttribute("aria-label", state.mode === "github" ? "Close recent editors" : "Close connected sessions");
      nameForm.hidden = state.mode === "github"; nameForm.style.display = state.mode === "github" ? "none" : "";
      githubConnect.hidden = state.mode !== "github"; githubConnect.style.display = state.mode === "github" ? "" : "none"; githubConnect.disabled = !state.hasKey;
      githubConnect.textContent = state.hasGitHubToken ? "Change GitHub account" : "Connect GitHub";
      const summary = connectionSummary(state);
      if (connection.textContent !== summary) connection.textContent = summary;
      trigger.title = summary;
      trigger.setAttribute("aria-label", state.mode === "github" ? "View recent master editors" : state.connected ? `View ${sessionSummary(state.onlineCount)}` : "View shared connection status");
      trigger.classList.toggle("master-presence-offline", state.unavailable);
      shell.classList.toggle("is-paused", document.visibilityState === "hidden" || !state.connected || state.unavailable || state.mode === "github");
      play.hidden = state.mode === "github" || !state.connected || state.unavailable || !state.users.some((user) => user.isSelf);
      nameSave.disabled = state.mode === "github" || !state.configured || !state.hasKey;
      // Keep each person's DOM and animation clock. Closed rosters do no drawing work.
      const stackEntries = [];
      const headerLimit = root.matchMedia?.("(max-width: 580px)").matches ? 3 : root.matchMedia?.("(max-width: 719px)").matches ? 5 : 7;
      if (state.users.length) {
        for (const user of (reactions?.prioritize(state.users) || state.users).slice(0, headerLimit)) { const entry = remember(stackCache, user.sessionId, faceSignature(user, state), () => headerPortrait(user, state)); updatePending(entry[1].node, user.sessionId); stackEntries.push(entry); }
      } else {
        stackEntries.push(remember(stackCache, "empty", summary, () => headerPortrait({ sessionId: "presence-offline", label: summary, isSelf: true }, { ...state, connected: false })));
      }
      overflow.textContent = state.users.length > headerLimit ? `+${state.users.length - headerLimit}` : "···";
      reconcile(stack, stackEntries, stackCache);
      neighbors?.refresh();
      if (!open) return;
      const rowEntries = [];
      if (!state.users.length) rowEntries.push(remember(rowCache, "empty", state.mode, () => make("p", "presence-empty-copy", state.mode === "github" ? "Recent editors will appear after a shared update." : "A little room for your crew. Connected people will appear here.")));
      for (const user of state.users) {
        const entry = remember(rowCache, user.sessionId, faceSignature(user, state), () => {
          const row = make("div", "master-presence-row"), text = make("div", "master-presence-person");
          const label = make("strong", "", user.label);
          if (user.isSelf) label.append(make("span", "presence-self-label", "you"));
          const date = user.at ? new Date(user.at) : null;
          const activity = state.mode === "github" ? `Updated master${date && Number.isFinite(date.getTime()) ? ` · ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)}` : ""}` : activityText(user);
          const face = avatar(user, state);
          let portrait = face;
          // A host can supply an explicit ephemeral poke transport. Without it,
          // presence stays read-only; no pretend cross-session delivery is shown.
          if ((typeof onPoke === "function" || state.pokeSupported) && !user.isSelf && user.receivePokes !== false && state.mode !== "github" && state.connected && !state.unavailable) {
            portrait = make("button", "presence-poke-button"); portrait.type = "button";
            const reaction = reactions?.get(user.sessionId);
            portrait.setAttribute("aria-label", `Poke ${user.label}${reaction?.kind === "received" ? " back" : ""}`); portrait.title = reaction?.message || `Poke ${user.label}`;
            portrait.append(face);
            portrait.addEventListener("click", () => sendPokeTarget(user.sessionId));
          }
          text.append(label, make("span", "master-presence-activity", activity)); row.append(portrait, text); return row;
        }); updatePending(entry[1].node, user.sessionId); rowEntries.push(entry);
      }
      reconcile(rows, rowEntries, rowCache);
    }
    const controller = createController({ sessionProvider, getSelectedProductId: () => adapter?.getSelectedProductId?.() || "", getSelectedCategoryId: () => adapter?.getSelectedCategoryId?.() || "", displayName: storedName, receivePokes: true,
      getActivity: () => Date.now() - lastInputAt > 60000 ? "idle" : activeView === "roadmap" ? "roadmap" : adapter?.getSelectedProductId?.() ? "focused" : "browsing", onChange: render, onPokeReceived: (event) => {
        const message = `${event.fromDisplayName || "A teammate"} poked you`; reactions?.mark(event.fromSessionId, "received", { name: event.fromDisplayName, message }); socialStatus.textContent = message;
        if (reactionFrame !== null) root.cancelAnimationFrame(reactionFrame);
        reactionFrame = root.requestAnimationFrame(() => { reactionFrame = null; if (!disposed) playHeaderBump(event.fromSessionId, controller.getState().sessionId); });
      } });
    async function playHeaderBump(fromId, targetId) {
      const sequence = ++tripSequence, portraits = [...stack.children];
      socialTrip = true; neighbors?.cancel();
      try { return await bump?.play({ from: portraits.find((node) => node.dataset.sessionId === fromId), target: portraits.find((node) => node.dataset.sessionId === targetId) }); }
      finally { if (sequence === tripSequence) { socialTrip = false; neighbors?.refresh(); } }
    }
    async function sendPokeTarget(targetSessionId) {
      const user = latestState?.users.find((person) => person.sessionId === targetSessionId);
      if (!user || pendingPokes.has(targetSessionId)) return;
      neighbors?.cancel();
      pendingPokes.add(targetSessionId); renderLocal();
      try {
        const result = typeof onPoke === "function" ? await onPoke({ ...user }, { senderName: latestState.displayName || latestState.users.find((person) => person.isSelf)?.label || "A teammate" }) : await controller.poke(targetSessionId);
        if (!["queued", "duplicate"].includes(result?.status)) throw new Error(result?.status === "throttled" ? "Give that face a moment to recover." : "That teammate is not available for pokes.");
        const message = `Poke on its way to ${user.label}`; reactions?.mark(user.sessionId, "sent", { name: user.label, message }); socialStatus.textContent = message;
        playHeaderBump(latestState.sessionId, targetSessionId);
      } catch (error) { const message = error?.code === "POKE_COOLDOWN" || error?.message === "Give that face a moment to recover." ? "Give that face a moment to recover." : "Couldn’t confirm that poke. Try again when your teammate is connected."; reactions?.mark(user.sessionId, "failed", { name: user.label, message }); socialStatus.textContent = message; }
      finally { pendingPokes.delete(targetSessionId); renderLocal(); }
    }
    function soon() { root.clearTimeout(debounceTimer); debounceTimer = root.setTimeout(() => controller.heartbeat(), 500); }
    function renderLocal() { if (latestState) render(latestState); }
    function inputActivity() { const wasIdle = Date.now() - lastInputAt > 60000; lastInputAt = Date.now(); if (wasIdle) renderLocal(); }
    shell.addEventListener("pointerdown", () => neighbors?.cancel(), { capture: true, signal });
    trigger.addEventListener("click", () => setOpen(!open), { signal }); supervisorHeader.addEventListener("click", () => setOpen(!open), { signal }); close.addEventListener("click", () => setOpen(false), { signal });
    document.addEventListener("pointerdown", (event) => { inputActivity(); if (open && !shell.contains(event.target)) setOpen(false, { restoreFocus: false }); }, { signal });
    document.addEventListener("keydown", (event) => { inputActivity(); if (event.key === "Escape") { if (supervisorView.closeUpdateTooltip()) { event.preventDefault(); event.stopPropagation(); return; } if (open) { event.preventDefault(); event.stopPropagation(); if (!supervisorView.closeReconnect()) setOpen(false); } } }, { capture: true, signal });
    document.addEventListener("pointermove", inputActivity, { passive: true, signal });
    document.addEventListener("wheel", inputActivity, { passive: true, signal });
    shell.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch" || root.matchMedia?.("(prefers-reduced-motion: reduce)").matches || gazeFrame !== null) return;
      gazeFrame = root.requestAnimationFrame(() => {
        gazeFrame = null; const rect = shell.getBoundingClientRect();
        shell.style.setProperty("--presence-look-x", `${Math.max(-1.5, Math.min(1.5, (event.clientX - rect.left - rect.width / 2) / 30))}px`);
        shell.style.setProperty("--presence-look-y", `${Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / 30))}px`);
      });
    }, { passive: true, signal });
    shell.addEventListener("pointerleave", () => { if (gazeFrame !== null) root.cancelAnimationFrame(gazeFrame); gazeFrame = null; shell.style.removeProperty("--presence-look-x"); shell.style.removeProperty("--presence-look-y"); }, { signal });
    play.addEventListener("click", () => { playfulUntil = Date.now() + 3200; renderLocal(); root.clearTimeout(playTimer); playTimer = root.setTimeout(renderLocal, 3250); }, { signal });
    nameForm.addEventListener("submit", (event) => { event.preventDefault(); const value = nameInput.value.trim().slice(0, 60); nameInput.value = value; try { if (value) root.localStorage.setItem(displayNameKey, value); else root.localStorage.removeItem(displayNameKey); } catch {} controller.setDisplayName(value); }, { signal });
    root.addEventListener("portfolio:render", (event) => { activeView = event.detail?.activeView || activeView; renderLocal(); soon(); }, { signal }); root.addEventListener("portfolio:master-status", soon, { signal });
    document.addEventListener("visibilitychange", () => { shell.classList.toggle("is-paused", document.visibilityState === "hidden" || !latestState?.connected || latestState?.unavailable || latestState?.mode === "github"); supervisorView.render(controller.getState()); if (document.visibilityState !== "hidden") controller.heartbeat(); }, { signal });
    root.addEventListener("pagehide", () => controller.leave(), { signal });
    root.addEventListener("resize", renderLocal, { passive: true, signal });
    const timer = root.setInterval(() => controller.heartbeat(), 20000);
    const expressionTimer = root.setInterval(renderLocal, 10000);
    render(controller.getState()); soon();
    active = Object.freeze({ controller, refresh: () => controller.heartbeat(), playNeighborScene: (kind) => { neighbors?.cancel(); return neighbors?.play(kind) || false; }, close: () => setOpen(false), destroy() { disposed = true; supervisorView.destroy(); listeners.abort(); observer?.disconnect(); neighbors?.destroy(); reactions?.destroy(); bump?.destroy(); root.clearInterval(timer); root.clearInterval(expressionTimer); root.clearTimeout(debounceTimer); root.clearTimeout(playTimer); if (gazeFrame !== null) root.cancelAnimationFrame(gazeFrame); if (reactionFrame !== null) root.cancelAnimationFrame(reactionFrame); controller.leave(); shell.remove(); active = null; } });
    return active;
  }
  root.PortfolioMasterPresence = Object.freeze({ anonymousName, avatarText, avatarTone, sessionSummary, connectionSummary, activityText, normalizeRoster, normalizeRecentEditors, normalizeAscmSupervisor, createAscmSupervisorView, createController, initialize, close() { active?.close(); }, leave() { return active?.controller.leave(); } });
  if (typeof document !== "undefined" && root.PortfolioMasterUI) initialize();
})(globalThis);
