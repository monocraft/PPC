/* Brief social feedback belongs to the existing faces, never a popup. */
(function registerPresenceReactions(root) {
  "use strict";
  const duration = 3200, capacity = 64;
  const kinds = new Set(["sent", "received", "failed"]);
  const validId = (value) => typeof value === "string" && /^[-_a-z0-9]{8,128}$/i.test(value);
  const safeText = (value, limit) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit) : "";

  function create({ onChange = () => {}, now = Date.now } = {}) {
    const reactions = new Map(), originalTitles = new WeakMap();
    let timer = null, disposed = false;
    function emit(change) { try { onChange(change); } catch {} }
    function clearTimer() { if (timer !== null) root.clearTimeout(timer); timer = null; }
    function schedule() {
      clearTimer();
      if (disposed || !reactions.size) return;
      const next = Math.min(...[...reactions.values()].map((reaction) => reaction.until));
      timer = root.setTimeout(() => { timer = null; expire(); }, Math.max(1, next - now()));
    }
    function expire() {
      if (disposed) return;
      const time = now(), expired = [];
      for (const [sessionId, reaction] of reactions) if (reaction.until <= time) { reactions.delete(sessionId); expired.push(sessionId); }
      if (expired.length || timer === null) schedule();
      if (expired.length) emit({ phase: "expired", sessionIds: expired });
    }
    function mark(sessionId, kind, { name, message } = {}) {
      if (disposed || !validId(sessionId) || !kinds.has(kind)) return null;
      const time = now(); if (!Number.isFinite(time)) return null;
      expire();
      const label = safeText(name, 60) || "Someone";
      const text = safeText(message, 180) || (kind === "sent" ? `Poke on its way to ${label}` : kind === "received" ? `${label} poked you` : "Couldn’t send that poke. Try again.");
      const reaction = { kind, name: label, message: text, until: time + duration };
      reactions.delete(sessionId);
      while (reactions.size >= capacity) reactions.delete(reactions.keys().next().value);
      reactions.set(sessionId, reaction); schedule();
      emit({ phase: "marked", sessionId, ...reaction });
      return { ...reaction };
    }
    function get(sessionId) {
      if (disposed || !validId(sessionId)) return null;
      expire(); const reaction = reactions.get(sessionId);
      return reaction ? { ...reaction } : null;
    }
    function prioritize(users) {
      if (!Array.isArray(users)) return [];
      if (!disposed) expire();
      const self = [], reacting = [], remaining = [];
      for (const user of users) {
        if (user?.isSelf) self.push(user);
        else if (!disposed && reactions.get(user?.sessionId)?.kind === "received") reacting.push(user);
        else remaining.push(user);
      }
      return [...self, ...reacting, ...remaining];
    }
    function decorate(avatar, user) {
      if (!avatar?.setAttribute || !avatar?.removeAttribute) return avatar;
      const reaction = get(typeof user === "string" ? user : user?.sessionId);
      if (reaction) {
        if (!originalTitles.has(avatar)) originalTitles.set(avatar, avatar.title || "");
        avatar.setAttribute("data-reaction", reaction.kind);
        avatar.title = reaction.message;
      } else {
        avatar.removeAttribute("data-reaction");
        if (originalTitles.has(avatar)) { avatar.title = originalTitles.get(avatar); originalTitles.delete(avatar); }
      }
      return avatar;
    }
    return Object.freeze({ mark, get, prioritize, decorate, destroy() {
      if (disposed) return;
      disposed = true; clearTimer(); reactions.clear();
    } });
  }
  root.PortfolioPresenceReactions = Object.freeze({ create });
})(globalThis);
