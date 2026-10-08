/* Connected browser sessions beside the category selector. Display names are optional. */
(function (root) {
  "use strict";
  let active = null;
  const displayNameKey = "portfolio.sharedDisplayName";
  const anonymousName = (sessionId) => `Editor ${String(sessionId).replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase()}`;
  const avatarText = (name, sessionId) => {
    if (!name || name === anonymousName(sessionId)) return String(sessionId).replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
    const words = String(name).trim().split(/\s+/);
    return (words.length > 1 ? words[0].slice(0, 1) + words.at(-1).slice(0, 1) : words[0].slice(0, 2)).toUpperCase();
  };
  const avatarTone = (sessionId) => [...String(sessionId)].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 5, 0);
  const sessionSummary = (count) => `${count} connected ${count === 1 ? "session" : "sessions"}`;
  const activityText = (user) => `${user.editing ? "Editing" : "Viewing"} ${user.productName || user.categoryName || "the portfolio"}${user.productName && user.categoryName ? ` · ${user.categoryName}` : ""}`;
  const connectionSummary = (state) => !state.configured ? "Team sharing is not connected" : state.mode === "github" ? state.connected ? `${state.users.length} recent ${state.users.length === 1 ? "editor" : "editors"}` : "No recent editors" : state.unavailable ? "Shared connection unavailable" : state.connected ? sessionSummary(state.onlineCount) : state.hasKey ? "Connecting…" : "Not connected";

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
        productId: String(item.productId || ""), productName: String(item.productName || "").slice(0, 240),
        categoryId: String(item.categoryId || ""), categoryName: String(item.categoryName || "").slice(0, 180),
        isSelf: sessionId === ownSessionId, lastSeenAt: item.lastSeenAt || item.lastSeen || "",
      });
      if (users.length >= 1000) break;
    }
    return users.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.label.localeCompare(b.label));
  }

  function createController({ sessionProvider, getSelectedProductId = () => "", getSelectedCategoryId = () => "", onChange = () => {}, sessionId = sessionProvider?.()?.getState?.()?.editorProfile?.sessionId || root.crypto?.randomUUID?.() || `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, displayName = "" } = {}) {
    let users = [], mode = "service", configured = false, connected = false, unavailable = false, hasKey = false, hasGitHubToken = false, inFlight = null;
    let generation = 0, observedSession = null, observedAccessVersion, observedHasKey = false;
    let name = String(displayName).trim().slice(0, 60);
    function state() { return { users: users.map((user) => ({ ...user })), mode, onlineCount: mode === "github" ? 0 : users.length, configured, connected, unavailable, hasKey, hasGitHubToken, sessionId, displayName: name }; }
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
        users = []; connected = false; unavailable = false;
      }
      hasKey = available;
      return { session, sessionState, generation };
    }
    async function heartbeat({ leave = false } = {}) {
      const { session, sessionState } = observeAccess();
      if (mode === "github") {
        generation += 1;
        users = leave ? [] : normalizeRecentEditors(sessionState?.snapshot, sessionState?.identity);
        connected = Boolean(!leave && hasKey && sessionState?.snapshot); unavailable = false;
        onChange(state()); return state();
      }
      if (!hasKey) {
        hasKey = false; connected = false; unavailable = false; users = []; onChange(state()); return state();
      }
      if (leave) { generation += 1; users = []; connected = false; unavailable = false; onChange(state()); }
      if (inFlight?.generation === generation && !leave) return state();
      const operation = { generation, session }; inFlight = operation;
      try {
        const selected = String(getSelectedProductId() || ""), pending = sessionState.pending || [];
        const draft = pending.find((product) => product.productId === selected);
        const response = await session.presence({ sessionId, displayName: name, editing: Boolean(draft), productId: selected, categoryId: String(getSelectedCategoryId() || ""), leave });
        const current = observeAccess();
        if (current.generation !== operation.generation || current.session !== operation.session || !hasKey) return state();
        if (response && !leave) { users = normalizeRoster(response, sessionId); connected = true; unavailable = false; }
        if (leave) { users = []; connected = false; }
      } catch {
        const current = observeAccess();
        if (current.generation === operation.generation && current.session === operation.session && hasKey) { connected = false; unavailable = true; }
      } finally { if (inFlight === operation) inFlight = null; onChange(state()); }
      return state();
    }
    return Object.freeze({ heartbeat, getState: state,
      setDisplayName(value) { const next = String(value || "").trim().slice(0, 60); if (next !== name) generation += 1; name = next; return heartbeat(); },
      leave() { return heartbeat({ leave: true }); },
    });
  }

  function initialize({ sessionProvider = () => root.PortfolioMasterUI?.getSession(), adapter = root.PortfolioMasterAdapter } = {}) {
    if (active) return active;
    const brand = document.querySelector(".brand-block");
    if (!brand) return null;
    const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
    const shell = make("div", "master-presence"), trigger = make("button", "master-presence-trigger");
    trigger.type = "button"; trigger.setAttribute("aria-haspopup", "dialog"); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-controls", "masterPresencePopover");
    const popover = make("section", "master-presence-popover"); popover.id = "masterPresencePopover"; popover.hidden = true; popover.setAttribute("role", "dialog"); popover.setAttribute("aria-labelledby", "masterPresenceTitle");
    const heading = make("header", "master-presence-heading"), title = make("h3", "", "Connected now"); title.id = "masterPresenceTitle";
    const close = make("button", "icon-button", "×"); close.type = "button"; close.setAttribute("aria-label", "Close connected sessions"); heading.append(title, close);
    const connection = make("p", "master-presence-summary"), rows = make("div", "master-presence-list"); connection.setAttribute("role", "status"); connection.setAttribute("aria-live", "polite");
    const nameForm = make("form", "master-presence-name-form"), nameLabel = make("label", "", "Your display name (optional)"), nameInput = make("input", "master-presence-name");
    nameInput.type = "text"; nameInput.maxLength = 60; nameInput.autocomplete = "nickname"; nameInput.placeholder = "Name";
    let storedName = ""; try { storedName = root.localStorage.getItem(displayNameKey) || ""; } catch {}
    nameInput.value = storedName.slice(0, 60); nameLabel.append(nameInput);
    const nameSave = make("button", "quiet-button", "Apply"); nameSave.type = "submit"; nameForm.append(nameLabel, nameSave);
    const githubConnect = make("button", "quiet-button", "Connect GitHub"); githubConnect.type = "button"; githubConnect.hidden = true; githubConnect.addEventListener("click", () => root.PortfolioMasterUI?.connectGitHub());
    popover.append(heading, connection, rows, nameForm, githubConnect); shell.append(trigger, popover); brand.append(shell);
    let open = false, debounceTimer = null;
    function setOpen(value) { open = value; popover.hidden = !value; trigger.setAttribute("aria-expanded", String(value)); if (value) controller.heartbeat(); else trigger.focus({ preventScroll: true }); }
    function avatar(user, extraClass = user.editing ? "is-editing" : "") { const circle = make("span", `master-presence-avatar master-presence-tone-${avatarTone(user.sessionId)}${extraClass ? ` ${extraClass}` : ""}`, avatarText(user.displayName, user.sessionId)); circle.setAttribute("aria-hidden", "true"); circle.title = `${user.label}${user.categoryName || user.productName ? ` · ${activityText(user)}` : ""}`; return circle; }
    function render(state) {
      trigger.replaceChildren(); rows.replaceChildren();
      title.textContent = state.mode === "github" ? "Recent editors" : "Connected now";
      close.setAttribute("aria-label", state.mode === "github" ? "Close recent editors" : "Close connected sessions");
      nameForm.hidden = state.mode === "github"; nameForm.style.display = state.mode === "github" ? "none" : "";
      githubConnect.hidden = state.mode !== "github"; githubConnect.style.display = state.mode === "github" ? "" : "none"; githubConnect.disabled = !state.hasKey;
      githubConnect.textContent = state.hasGitHubToken ? "Change GitHub account" : "Connect GitHub";
      if (state.users.length) {
        for (const user of state.users.slice(0, 3)) trigger.append(avatar(user));
        if (state.users.length > 3) { const overflow = make("span", "master-presence-avatar master-presence-overflow", `+${state.users.length - 3}`); overflow.setAttribute("aria-hidden", "true"); trigger.append(overflow); }
      } else { const empty = make("span", "master-presence-avatar master-presence-empty", "·"); empty.setAttribute("aria-hidden", "true"); trigger.append(empty); }
      const summary = connectionSummary(state);
      connection.textContent = summary;
      trigger.title = summary;
      trigger.setAttribute("aria-label", state.mode === "github" ? "View recent master editors" : state.connected ? `View ${sessionSummary(state.onlineCount)}` : "View shared connection status");
      trigger.classList.toggle("master-presence-offline", state.unavailable);
      for (const user of state.users) {
        const row = make("div", "master-presence-row"), text = make("div", "master-presence-person");
        const label = make("strong", "", user.label + (user.isSelf ? " (you)" : ""));
        const date = user.at ? new Date(user.at) : null;
        const activity = state.mode === "github" ? `Updated master${date && Number.isFinite(date.getTime()) ? ` · ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)}` : ""}` : activityText(user);
        text.append(label, make("span", "master-presence-activity", activity)); row.append(avatar(user), text); rows.append(row);
      }
      nameSave.disabled = state.mode === "github" || !state.configured || !state.hasKey;
    }
    const controller = createController({ sessionProvider, getSelectedProductId: () => adapter?.getSelectedProductId?.() || "", getSelectedCategoryId: () => adapter?.getSelectedCategoryId?.() || "", displayName: storedName, onChange: render });
    function soon() { root.clearTimeout(debounceTimer); debounceTimer = root.setTimeout(() => controller.heartbeat(), 500); }
    trigger.addEventListener("click", () => setOpen(!open)); close.addEventListener("click", () => setOpen(false));
    document.addEventListener("pointerdown", (event) => { if (open && !shell.contains(event.target)) { open = false; popover.hidden = true; trigger.setAttribute("aria-expanded", "false"); } });
    document.addEventListener("keydown", (event) => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } }, true);
    nameForm.addEventListener("submit", (event) => { event.preventDefault(); const value = nameInput.value.trim().slice(0, 60); nameInput.value = value; try { if (value) root.localStorage.setItem(displayNameKey, value); else root.localStorage.removeItem(displayNameKey); } catch {} controller.setDisplayName(value); });
    root.addEventListener("portfolio:render", soon); root.addEventListener("portfolio:master-status", soon);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "hidden") controller.heartbeat(); });
    root.addEventListener("pagehide", () => controller.leave());
    const timer = root.setInterval(() => controller.heartbeat(), 20000);
    render(controller.getState()); soon();
    active = Object.freeze({ controller, refresh: () => controller.heartbeat(), close: () => setOpen(false), destroy() { root.clearInterval(timer); root.clearTimeout(debounceTimer); controller.leave(); shell.remove(); } });
    return active;
  }
  root.PortfolioMasterPresence = Object.freeze({ anonymousName, avatarText, avatarTone, sessionSummary, connectionSummary, activityText, normalizeRoster, normalizeRecentEditors, createController, initialize, close() { active?.close(); }, leave() { return active?.controller.leave(); } });
  if (typeof document !== "undefined" && root.PortfolioMasterUI) initialize();
})(globalThis);
