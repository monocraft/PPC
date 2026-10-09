/* Date history stays out of the layout until a date label is hovered or focused. */
(function (root) {
  "use strict";

  const bindings = new WeakMap();
  let sequence = 0;
  const day = 24 * 60 * 60 * 1000;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const plural = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"}`;
  const timestamp = (value) => {
    if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return NaN;
    if (typeof value === "string" && !value.trim()) return NaN;
    return new Date(value).getTime();
  };

  // Calendar months keep an edit on January 31 one month old on February 28.
  function addMonths(date, months) {
    const result = new Date(date.getTime()), originalDay = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(originalDay, lastDay));
    return result;
  }

  function formatAge(at, now = Date.now()) {
    const edited = timestamp(at), current = timestamp(now);
    if (!Number.isFinite(edited) || !Number.isFinite(current) || edited > current) return null;
    const elapsed = current - edited, minutes = Math.floor(elapsed / 60000);
    if (!minutes) return "Just now";
    if (minutes < 60) return `${plural(minutes, "minute")} ago`;
    if (elapsed < day) {
      const hours = Math.floor(minutes / 60), remainder = minutes % 60;
      return `${plural(hours, "hour")}${remainder ? `, ${plural(remainder, "minute")}` : ""} ago`;
    }
    const start = new Date(edited), end = new Date(current);
    let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
    if (addMonths(start, months).getTime() > current) months -= 1;
    if (months < 1) return `${plural(Math.floor(elapsed / day), "day")} ago`;
    const days = Math.floor((current - addMonths(start, months).getTime()) / day);
    const years = Math.floor(months / 12), remainder = months % 12;
    const parts = [years && plural(years, "year"), remainder && plural(remainder, "month"), days && plural(days, "day")].filter(Boolean);
    return `${parts.join(", ")} ago`;
  }

  function details(history, pending = false, { now = Date.now(), locale } = {}) {
    const age = formatAge(history?.at, now);
    if (!age) return { known: false, pending: Boolean(pending), at: null, age: null, actor: "", updated: "" };
    const at = new Date(timestamp(history.at));
    return { known: true, pending: Boolean(pending), at: at.toISOString(), age,
      actor: String(history.actor ?? "").trim().slice(0, 200),
      updated: at.toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) };
  }

  function labelHtml(label, field, { tag = "span" } = {}) {
    const element = ["span", "strong", "div"].includes(tag) ? tag : "span";
    const title = String(label ?? "");
    return `<${element} class="date-history-label" tabindex="0" role="button" aria-label="${escapeHtml(title)} update history" data-date-history-field="${escapeHtml(field)}">${escapeHtml(title)}</${element}>`;
  }

  function bind(container, options = {}) {
    if (!container?.addEventListener) return null;
    const previous = bindings.get(container);
    if (previous) { previous.update(options); return previous; }
    const document = options.document || container.ownerDocument || root.document;
    if (!document?.body) return null;
    const window = document.defaultView || root;
    let adapter = options, anchor = null, popup = null, pinned = false, closeTimer = null, ageTimer = null, observer = null, destroyed = false;
    const permanentListeners = [], openListeners = [];
    const schedule = window.setTimeout?.bind(window) || root.setTimeout?.bind(root);
    const cancel = window.clearTimeout?.bind(window) || root.clearTimeout?.bind(root);
    const listen = (target, type, callback, list, capture = false) => {
      if (!target?.addEventListener) return;
      target.addEventListener(type, callback, capture);
      list.push(() => target.removeEventListener(type, callback, capture));
    };
    const create = (tag, className, content) => {
      const node = document.createElement(tag);
      node.className = className;
      if (content !== undefined) node.textContent = content;
      return node;
    };
    const triggerFor = (target) => {
      const trigger = target?.closest?.("[data-date-history-field]");
      return trigger && container.contains(trigger) ? trigger : null;
    };
    const clearCloseTimer = () => { if (closeTimer !== null) cancel?.(closeTimer); closeTimer = null; };
    const restoreDescription = () => {
      if (!anchor || !popup) return;
      const ids = String(anchor.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== popup.id);
      if (ids.length) anchor.setAttribute("aria-describedby", ids.join(" ")); else anchor.removeAttribute("aria-describedby");
      anchor.removeAttribute("aria-expanded");
    };
    function close() {
      clearCloseTimer();
      if (ageTimer !== null) cancel?.(ageTimer);
      ageTimer = null;
      observer?.disconnect(); observer = null;
      for (const remove of openListeners.splice(0)) remove();
      restoreDescription();
      if (popup) { try { popup.hidePopover?.(); } catch (_) { /* The fallback is also removed. */ } popup.remove(); }
      anchor = null; popup = null; pinned = false;
    }
    function position() {
      if (!anchor?.isConnected || !container.isConnected) { close(); return; }
      if (!popup) return;
      const rect = anchor.getBoundingClientRect(), bounds = popup.getBoundingClientRect();
      const width = Number(window.visualViewport?.width || window.innerWidth || document.documentElement?.clientWidth || 800);
      const height = Number(window.visualViewport?.height || window.innerHeight || document.documentElement?.clientHeight || 600);
      const offsetX = Number(window.visualViewport?.offsetLeft || 0), offsetY = Number(window.visualViewport?.offsetTop || 0);
      if (rect.bottom < offsetY || rect.top > offsetY + height || rect.right < offsetX || rect.left > offsetX + width) { close(); return; }
      const inset = 10, gap = 7;
      const left = Math.max(offsetX + inset, Math.min(rect.left, offsetX + width - bounds.width - inset));
      const below = rect.bottom + gap, above = rect.top - bounds.height - gap;
      const top = below + bounds.height <= offsetY + height - inset ? below : Math.max(offsetY + inset, above);
      popup.style.left = `${Math.round(left)}px`;
      popup.style.top = `${Math.round(top)}px`;
    }
    function refresh() {
      if (!popup || !anchor) return;
      if (!anchor.isConnected || !container.isConnected) { close(); return; }
      const field = anchor.getAttribute("data-date-history-field");
      const state = details(adapter.getHistory?.(field), adapter.isPending?.(field), { now: adapter.now?.() ?? Date.now(), locale: adapter.locale });
      const heading = create("div", "date-history-heading", anchor.textContent.trim());
      const rows = [];
      if (state.pending) rows.push(create("span", "date-history-pending", "Unsaved change"));
      if (state.known) {
        const list = create("dl", "date-history-facts");
        const time = create("time", "", state.updated); time.setAttribute("datetime", state.at);
        const timeValue = create("dd", ""); timeValue.append(time);
        list.append(create("dt", "", "Last updated"), timeValue, create("dt", "", "Age"), create("dd", "date-history-age", state.age));
        if (state.actor) list.append(create("dt", "", "Updated by"), create("dd", "", state.actor));
        rows.push(list);
      } else {
        rows.push(create("div", "date-history-empty", "No edit history yet"), create("p", "date-history-note", "Tracking begins with the next date update."));
      }
      popup.replaceChildren(heading, ...rows);
      position();
    }
    function tick() {
      if (ageTimer !== null) cancel?.(ageTimer);
      ageTimer = schedule?.(() => { ageTimer = null; refresh(); if (popup) tick(); }, 60000) ?? null;
    }
    function open(trigger, pin = false) {
      clearCloseTimer();
      if (anchor === trigger && popup) { pinned = pinned || pin; refresh(); return; }
      close();
      anchor = trigger; pinned = pin;
      popup = create("div", "date-history-popup");
      popup.id = `date-history-popup-${++sequence}`;
      popup.setAttribute("role", "tooltip");
      popup.setAttribute("popover", "manual");
      document.body.append(popup);
      try { popup.showPopover?.(); } catch (_) { popup.removeAttribute("popover"); /* Use the fixed portal if the top layer is unavailable. */ }
      const descriptions = String(anchor.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      anchor.setAttribute("aria-describedby", [...descriptions, popup.id].join(" "));
      anchor.setAttribute("aria-expanded", "true");
      listen(popup, "pointerenter", clearCloseTimer, openListeners);
      listen(popup, "pointerleave", scheduleClose, openListeners);
      listen(document, "pointerdown", (event) => { if (!anchor?.contains(event.target) && !popup?.contains(event.target)) close(); }, openListeners, true);
      listen(document, "keydown", (event) => { if (event.key === "Escape" && popup) { event.preventDefault(); event.stopPropagation(); close(); } }, openListeners, true);
      listen(document, "scroll", position, openListeners, true);
      listen(window, "resize", position, openListeners);
      listen(window.visualViewport, "resize", position, openListeners);
      listen(window.visualViewport, "scroll", position, openListeners);
      const Observer = window.MutationObserver || root.MutationObserver;
      if (Observer) { observer = new Observer(() => { if (!anchor?.isConnected || !container.isConnected) close(); }); observer.observe(document.body, { childList: true, subtree: true }); }
      refresh(); if (popup) tick();
    }
    function scheduleClose(event) {
      if (!popup || pinned || document.activeElement === anchor || popup.contains(event?.relatedTarget) || anchor?.contains(event?.relatedTarget)) return;
      clearCloseTimer();
      closeTimer = schedule?.(() => { closeTimer = null; close(); }, 150) ?? null;
    }
    listen(container, "pointerover", (event) => {
      if (event.pointerType === "touch") return;
      const trigger = triggerFor(event.target);
      if (trigger && !trigger.contains(event.relatedTarget)) open(trigger);
    }, permanentListeners);
    listen(container, "pointerout", (event) => { if (anchor?.contains(event.target) && !anchor.contains(event.relatedTarget)) scheduleClose(event); }, permanentListeners);
    listen(container, "focusin", (event) => { const trigger = triggerFor(event.target); if (trigger) open(trigger); }, permanentListeners);
    listen(container, "focusout", (event) => { if (anchor?.contains(event.target) && !popup?.contains(event.relatedTarget)) { pinned = false; scheduleClose(event); } }, permanentListeners);
    listen(container, "click", (event) => {
      const trigger = triggerFor(event.target);
      if (!trigger) return;
      event.preventDefault(); event.stopPropagation();
      if (anchor === trigger && pinned) close(); else open(trigger, true);
    }, permanentListeners);
    listen(container, "keydown", (event) => {
      const trigger = triggerFor(event.target);
      if (!trigger || !["Enter", " "].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (anchor === trigger && pinned) close(); else open(trigger, true);
    }, permanentListeners);
    const controller = Object.freeze({
      refresh, close,
      update(next = {}) { adapter = next; refresh(); },
      destroy() { if (destroyed) return; close(); destroyed = true; for (const remove of permanentListeners.splice(0)) remove(); bindings.delete(container); },
    });
    bindings.set(container, controller);
    return controller;
  }

  root.PortfolioDateHistory = Object.freeze({ labelHtml, bind, formatAge, details });
})(globalThis);
