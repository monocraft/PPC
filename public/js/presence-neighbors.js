/* Tiny local scenes between neighboring header characters. No presence traffic. */
(function registerPresenceNeighbors(root) {
  "use strict";
  const scenes = Object.freeze({ chat: 3800, giggle: 3400, bonk: 3600 });
  const sceneNames = Object.freeze(Object.keys(scenes));
  const attributes = ["data-neighbor-scene", "data-neighbor-role", "data-neighbor-direction"];

  function hash(value) {
    let result = 2166136261;
    for (const character of String(value)) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
    return result >>> 0;
  }

  function create({ shell, documentObject = root.document, isAvailable = () => true, random, seed } = {}) {
    const view = documentObject?.defaultView || root, removers = [];
    const preference = view.matchMedia?.("(prefers-reduced-motion: reduce)");
    let disposed = false, enabled = true, intersecting = true, focused = documentObject?.hasFocus?.() !== false;
    let timer = null, finishTimer = null, active = null, lastPair = "", lastScene = "";
    let entropy = hash(seed ?? `${Date.now()}:${Math.random()}`);
    function next() {
      if (typeof random === "function") {
        const value = Number(random());
        return Number.isFinite(value) ? Math.max(0, Math.min(.999999999, value)) : .5;
      }
      entropy += 0x6D2B79F5;
      let value = entropy;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    }
    function listen(node, type, callback, options) {
      if (!node?.addEventListener) return;
      node.addEventListener(type, callback, options);
      removers.push(() => node.removeEventListener(type, callback, options));
    }
    function reduced() {
      return Boolean(preference?.matches || documentObject?.documentElement?.classList.contains("preview-reduced-motion"));
    }
    function available() {
      if (disposed || !enabled || !focused || !intersecting || reduced() || documentObject?.hidden || documentObject?.visibilityState === "hidden" || shell?.isConnected === false || shell?.classList.contains("is-paused")) return false;
      try { return Boolean(shell && isAvailable()); } catch { return false; }
    }
    function visible(node) {
      if (!node || node.isConnected === false || node.hidden) return false;
      const bounds = node.getBoundingClientRect?.();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
      const width = view.innerWidth || documentObject?.documentElement?.clientWidth || Infinity;
      const height = view.innerHeight || documentObject?.documentElement?.clientHeight || Infinity;
      return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= width && bounds.bottom <= height;
    }
    function buttons() {
      const strip = shell?.querySelector(".master-presence-avatars");
      return strip ? Array.from(strip.children).filter((node) => node.matches?.(".presence-header-person")) : [];
    }
    function eligible(button) {
      const face = button?.querySelector?.(".presence-character"), svg = face?.querySelector?.(".presence-face");
      if (!face || !svg || !visible(button) || !visible(face) || button.disabled || button.getAttribute("aria-disabled") === "true" || button.classList.contains("is-poke-pending") || face.hasAttribute("data-reaction") || face.classList.contains("presence-is-bumped")) return false;
      if (["recent", "offline"].includes(face.getAttribute("data-mood"))) return false;
      if (documentObject?.activeElement && button.contains(documentObject.activeElement)) return false;
      if (button.matches?.(":hover")) return false;
      return true;
    }
    function adjacentPairs() {
      const people = buttons(), pairs = [];
      for (let index = 0; index < people.length - 1; index += 1) {
        // Never jump across a busy or unavailable neighbor to find a partner.
        const left = people[index], right = people[index + 1];
        if (!eligible(left) || !eligible(right)) continue;
        const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
        if (Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) > Math.min(a.height, b.height) / 2 || Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)) > Math.max(a.width, b.width) * 1.7) continue;
        pairs.push([left, right]);
      }
      return pairs;
    }
    function clearTimer() {
      if (timer !== null) view.clearTimeout(timer);
      timer = null;
    }
    function restore(record) {
      if (finishTimer !== null) view.clearTimeout(finishTimer);
      finishTimer = null;
      for (const member of record.members) {
        if (member.svg.parentNode === member.puppet && member.puppet.parentNode) member.puppet.parentNode.insertBefore(member.svg, member.puppet);
        member.puppet.remove();
        if (!member.hadClass) member.face.classList.remove("presence-neighbor-active");
        for (const [name, value] of member.savedAttributes) {
          if (value === null) member.face.removeAttribute(name);
          else member.face.setAttribute(name, value);
        }
      }
    }
    function stop() {
      clearTimer();
      if (!active) return;
      const record = active; active = null; restore(record);
    }
    function schedule() {
      if (timer !== null || active || !available() || adjacentPairs().length === 0) return;
      // Rest starts after a scene ends or the surface returns. No catch-up burst.
      timer = view.setTimeout(() => {
        timer = null;
        if (!play()) schedule();
      }, 8000 + Math.floor(next() * 8001));
    }
    function intact() {
      if (!active || !available()) return false;
      const current = buttons();
      if (current.length !== active.order.length || current.some((button, index) => button !== active.order[index])) return false;
      return active.members.every((member) => eligible(member.button) && member.button.contains(member.face) && member.svg.parentNode === member.puppet && member.puppet.parentNode === member.face);
    }
    function update(options = {}) {
      if (disposed) return;
      if (typeof options.enabled === "boolean") enabled = options.enabled;
      if (active && !intact()) stop();
      if (!available()) { stop(); return; }
      schedule();
    }
    function play(requestedScene) {
      if (active || !available()) return false;
      const pairs = adjacentPairs();
      if (!pairs.length) return false;
      let choices = pairs.filter((pair) => pair.map((button) => button.dataset.sessionId || "").join("|") !== lastPair);
      if (!choices.length) choices = pairs;
      const pair = choices[Math.floor(next() * choices.length)];
      const possibleScenes = sceneNames.filter((name) => name !== lastScene);
      const scene = Object.hasOwn(scenes, requestedScene) ? requestedScene : possibleScenes[Math.floor(next() * possibleScenes.length)];
      const leader = next() < .5 ? 0 : 1;
      const order = buttons(), members = [];
      for (let index = 0; index < pair.length; index += 1) {
        const button = pair[index], face = button.querySelector(".presence-character"), svg = face.querySelector(".presence-face");
        if (svg.parentNode !== face) { for (const member of members) restore({ members: [member] }); return false; }
        const puppet = documentObject.createElement("span");
        puppet.className = "presence-neighbor-puppet"; puppet.setAttribute("aria-hidden", "true");
        const savedAttributes = attributes.map((name) => [name, face.getAttribute(name)]), hadClass = face.classList.contains("presence-neighbor-active");
        members.push({ button, face, svg, puppet, savedAttributes, hadClass });
        face.insertBefore(puppet, svg); puppet.append(svg);
        face.setAttribute("data-neighbor-scene", scene);
        face.setAttribute("data-neighbor-role", index === leader ? "lead" : "reply");
        const own = button.getBoundingClientRect(), other = pair[1 - index].getBoundingClientRect();
        face.setAttribute("data-neighbor-direction", own.left < other.left ? "right" : "left");
        face.classList.add("presence-neighbor-active");
      }
      clearTimer();
      active = { members, order };
      lastPair = pair.map((button) => button.dataset.sessionId || "").join("|"); lastScene = scene;
      finishTimer = view.setTimeout(() => { stop(); schedule(); }, scenes[scene]);
      return true;
    }
    function restart() { stop(); schedule(); }
    listen(documentObject, "visibilitychange", restart);
    listen(view, "blur", () => { focused = false; stop(); });
    listen(view, "focus", () => { focused = true; restart(); });
    listen(view, "resize", restart, { passive: true });
    listen(documentObject, "scroll", restart, { capture: true, passive: true });
    listen(shell, "pointerdown", restart, { capture: true, passive: true });
    listen(shell, "pointerover", restart, { passive: true });
    listen(shell, "pointerout", update, { passive: true });
    listen(shell, "focusin", restart);
    listen(shell, "focusout", () => { stop(); schedule(); });
    listen(preference, "change", restart);
    const observer = shell && view.MutationObserver ? new view.MutationObserver(() => {
      if (active && !intact()) stop();
      schedule();
    }) : null;
    observer?.observe(shell, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-disabled", "hidden", "data-reaction", "data-mood"] });
    const preferenceObserver = documentObject?.documentElement && view.MutationObserver ? new view.MutationObserver(() => {
      if (reduced()) stop(); else schedule();
    }) : null;
    preferenceObserver?.observe(documentObject.documentElement, { attributes: true, attributeFilter: ["class"] });
    const intersectionObserver = shell && view.IntersectionObserver ? new view.IntersectionObserver((entries) => {
      const entry = entries.find((item) => item.target === shell);
      if (!entry) return;
      intersecting = entry.isIntersecting;
      if (!intersecting) stop(); else schedule();
    }) : null;
    intersectionObserver?.observe(shell);
    schedule();
    return Object.freeze({ update, refresh: update, play, cancel: stop, destroy() {
      if (disposed) return;
      disposed = true; stop(); observer?.disconnect(); preferenceObserver?.disconnect(); intersectionObserver?.disconnect();
      for (const remove of removers) remove();
    } });
  }
  root.PortfolioPresenceNeighbors = Object.freeze({ create });
})(globalThis);
