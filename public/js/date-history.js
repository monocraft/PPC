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

  // Date ages count local calendar boundaries, rather than blocks of 24 hours.
  // A report's YYYY-MM-DD is already a calendar day and must never shift zones.
  function calendarAgeDays(at, now = Date.now()) {
    const current = timestamp(now);
    if (!Number.isFinite(current)) return null;
    let start;
    if (typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at)) {
      const [year, month, date] = at.split("-").map(Number);
      const probe = new Date(0); probe.setUTCFullYear(year, month - 1, date); probe.setUTCHours(0, 0, 0, 0);
      if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== date) return null;
      start = probe.getTime();
    } else {
      const instant = timestamp(at);
      if (!Number.isFinite(instant) || instant > current) return null;
      const date = new Date(instant);
      start = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    }
    const end = new Date(current), today = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return start > today ? null : Math.round((today - start) / day);
  }

  function details(history, pending = false, { now = Date.now(), locale } = {}) {
    const age = formatAge(history?.at, now);
    if (!age) return { known: false, pending: Boolean(pending), at: null, age: null, ageDays: null, actor: "", updated: "" };
    const at = new Date(timestamp(history.at));
    return { known: true, pending: Boolean(pending), at: at.toISOString(), age, ageDays: calendarAgeDays(at, now),
      actor: String(history.actor ?? "").trim().slice(0, 200),
      updated: at.toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }) };
  }

  function sourceDetails(source, options = {}) {
    if (!source || typeof source !== "object") return null;
    const reportDate = typeof source.reportDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.reportDate) ? source.reportDate : "";
    const reportAgeDays = reportDate ? calendarAgeDays(reportDate, options.now) : null;
    const hasValue = Object.hasOwn(options, "value");
    const location = source.source && typeof source.source === "object"
      ? [source.source.sheet, source.source.cell].filter(Boolean).join("!") + (source.source.mergeRange ? ` (merged ${source.source.mergeRange})` : "")
      : String(source.source ?? "");
    return {
      current: !source.supersededAt && (!hasValue || String(source.value ?? "") === String(options.value ?? "")),
      value: String(source.value ?? ""),
      changed: details({ at: source.changedAt, actor: "PLC import" }, false, options),
      observed: details({ at: source.observedAt }, false, options),
      reportDate, reportAgeDays,
      sourceFile: String(source.sourceFile ?? "").trim().slice(0, 240),
      reference: location.trim().slice(0, 240),
    };
  }

  function timeline(history, pending = false, options = {}) {
    const shared = details(history, pending, options), source = sourceDetails(options.source, options);
    const draftMatches = !Object.hasOwn(options, "value") || String(options.draft?.value ?? "") === String(options.value ?? "");
    const draft = draftMatches ? details(options.draft, pending, options) : details(null, pending, options);
    let changed = shared, kind = "shared";
    if (source?.current && source.changed.known) { changed = source.changed; kind = "source"; }
    if (pending && draft.known && (!changed.known || timestamp(draft.at) > timestamp(changed.at))) { changed = draft; kind = "draft"; }
    if (pending && kind === "shared") { changed = details(null, true, options); kind = "unknown"; }
    return { pending: Boolean(pending), changed, kind, shared, source, draft };
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
    let adapter = options, anchor = null, popup = null, pinned = false, hoverTarget = null, hoverTimer = null, closeTimer = null, ageTimer = null, observer = null, destroyed = false, pointerOverPopup = false;
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
    const isEditingControl = (target) => Boolean(target?.closest?.('input, select, textarea, [contenteditable="true"], .portfolio-date-control, .date-tbd-button'));
    const clearHoverTimer = () => { if (hoverTimer !== null) cancel?.(hoverTimer); hoverTimer = null; hoverTarget = null; };
    const clearCloseTimer = () => { if (closeTimer !== null) cancel?.(closeTimer); closeTimer = null; };
    const restoreDescription = () => {
      if (!anchor || !popup) return;
      const ids = String(anchor.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== popup.id);
      if (ids.length) anchor.setAttribute("aria-describedby", ids.join(" ")); else anchor.removeAttribute("aria-describedby");
      anchor.removeAttribute("aria-expanded");
    };
    function close() {
      clearHoverTimer();
      clearCloseTimer();
      if (ageTimer !== null) cancel?.(ageTimer);
      ageTimer = null;
      observer?.disconnect(); observer = null;
      for (const remove of openListeners.splice(0)) remove();
      restoreDescription();
      if (popup) { try { popup.hidePopover?.(); } catch (_) { /* The fallback is also removed. */ } popup.remove(); }
      anchor = null; popup = null; pinned = false; pointerOverPopup = false;
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
      let left = Math.max(offsetX + inset, Math.min(rect.left, offsetX + width - bounds.width - inset));
      const below = rect.bottom + gap, above = rect.top - bounds.height - gap;
      let top;
      if (above >= offsetY + inset) top = above;
      else if (rect.right + gap + bounds.width <= offsetX + width - inset) {
        left = rect.right + gap;
        top = Math.max(offsetY + inset, Math.min(rect.top, offsetY + height - bounds.height - inset));
      } else if (rect.left - gap - bounds.width >= offsetX + inset) {
        left = rect.left - gap - bounds.width;
        top = Math.max(offsetY + inset, Math.min(rect.top, offsetY + height - bounds.height - inset));
      } else top = Math.max(offsetY + inset, Math.min(below, offsetY + height - bounds.height - inset));
      popup.style.left = `${Math.round(left)}px`;
      popup.style.top = `${Math.round(top)}px`;
    }
    function refresh() {
      if (!popup || !anchor) return;
      if (!anchor.isConnected || !container.isConnected) { close(); return; }
      const field = anchor.getAttribute("data-date-history-field");
      const factsOptions = { now: adapter.now?.() ?? Date.now(), locale: adapter.locale, source: adapter.getSource?.(field), draft: adapter.getDraft?.(field) };
      if (adapter.getValue) factsOptions.value = adapter.getValue(field);
      const state = timeline(adapter.getHistory?.(field), adapter.isPending?.(field), factsOptions);
      const heading = create("div", "date-history-heading", anchor.textContent.trim());
      const rows = [];
      if (state.pending) rows.push(create("span", "date-history-pending", "Unsaved change"));
      const ageText = (clock) => `${plural(clock.ageDays, "day")} · ${clock.age}`;
      const appendClock = (list, label, clock, ageLabel = "Age (days)") => {
        if (!clock.known) return;
        const time = create("time", "", clock.updated); time.setAttribute("datetime", clock.at);
        const timeValue = create("dd", ""); timeValue.append(time);
        list.append(create("dt", "", label), timeValue, create("dt", "", ageLabel), create("dd", "date-history-age", ageText(clock)));
      };
      if (state.changed.known) {
        const list = create("dl", "date-history-facts");
        appendClock(list, "Last value changed", state.changed);
        if (state.changed.actor) list.append(create("dt", "", "Updated by"), create("dd", "", state.changed.actor));
        rows.push(list);
      } else {
        rows.push(create("div", "date-history-empty", "Change time not recorded"), create("p", "date-history-note", "Tracking begins with the next date update."));
      }
      if (state.shared.known && state.kind !== "shared") {
        const list = create("dl", "date-history-facts date-history-shared");
        appendClock(list, state.pending ? "Shared value changed" : "Saved to master", state.shared, "Shared age (days)");
        if (state.shared.actor) list.append(create("dt", "", "Shared by"), create("dd", "", state.shared.actor));
        rows.push(list);
      }
      if (state.source) {
        const source = state.source, list = create("dl", "date-history-facts date-history-source");
        if (!source.current) rows.push(create("p", "date-history-note", `PLC evidence belongs to the previous value (${source.value || "blank"}).`));
        if (source.reportDate) list.append(create("dt", "", "Source report"), create("dd", "", source.reportDate));
        if (source.reportAgeDays !== null) list.append(create("dt", "", "Source age (days)"), create("dd", "date-history-age", plural(source.reportAgeDays, "day")));
        appendClock(list, source.current ? "Last confirmed" : "Previous value confirmed", source.observed, "Confirmation age (days)");
        if (source.sourceFile) list.append(create("dt", "", "Source file"), create("dd", "", source.sourceFile));
        if (source.reference) list.append(create("dt", "", "Source location"), create("dd", "", source.reference));
        if (list.children.length) rows.push(list);
      }
      popup.replaceChildren(heading, ...rows);
      position();
    }
    function tick() {
      if (ageTimer !== null) cancel?.(ageTimer);
      ageTimer = schedule?.(() => { ageTimer = null; refresh(); if (popup) tick(); }, 60000) ?? null;
    }
    function open(trigger, pin = false) {
      clearHoverTimer();
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
      // The read-only popup lets all pointer input pass through. Geometric
      // hover detection keeps its text readable without intercepting fields.
      listen(document, "pointermove", (event) => {
        if (isEditingControl(event.target)) { close(); return; }
        if (!popup) return;
        const bounds = popup.getBoundingClientRect();
        const inside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
        if (inside) { pointerOverPopup = true; clearCloseTimer(); }
        else if (pointerOverPopup) { pointerOverPopup = false; scheduleClose(event); }
      }, openListeners);
      listen(document, "pointerdown", (event) => { if (!anchor?.contains(event.target) && !popup?.contains(event.target)) close(); }, openListeners, true);
      listen(document, "pointerover", (event) => { if (isEditingControl(event.target)) close(); }, openListeners, true);
      listen(document, "focusin", (event) => { if (!anchor?.contains(event.target)) close(); }, openListeners, true);
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
      if (isEditingControl(event?.relatedTarget)) { close(); return; }
      if (!popup || pinned || document.activeElement === anchor || popup.contains(event?.relatedTarget) || anchor?.contains(event?.relatedTarget)) return;
      clearCloseTimer();
      closeTimer = schedule?.(() => { closeTimer = null; close(); }, 150) ?? null;
    }
    // A pending hover must also stop when the user leaves this section to edit.
    listen(document, "focusin", (event) => { if (hoverTarget && !hoverTarget.contains(event.target)) clearHoverTimer(); }, permanentListeners, true);
    listen(document, "pointerover", (event) => { if (hoverTarget && isEditingControl(event.target)) clearHoverTimer(); }, permanentListeners, true);
    listen(document, "keydown", (event) => { if (hoverTarget && event.key === "Escape") clearHoverTimer(); }, permanentListeners, true);
    listen(container, "pointerover", (event) => {
      if (event.pointerType === "touch") return;
      const trigger = triggerFor(event.target);
      if (isEditingControl(event.target)) { close(); return; }
      if (!trigger || trigger.contains(event.relatedTarget)) return;
      clearHoverTimer(); clearCloseTimer();
      if (anchor === trigger && popup) return;
      close();
      hoverTarget = trigger;
      hoverTimer = schedule?.(() => {
        const target = hoverTarget;
        hoverTimer = null; hoverTarget = null;
        if (target?.isConnected && container.isConnected && !destroyed) open(target);
      }, 450) ?? null;
    }, permanentListeners);
    listen(container, "pointerout", (event) => {
      if (hoverTarget?.contains(event.target) && !hoverTarget.contains(event.relatedTarget)) clearHoverTimer();
      if (anchor?.contains(event.target) && !anchor.contains(event.relatedTarget)) scheduleClose(event);
    }, permanentListeners);
    listen(container, "focusin", (event) => { const trigger = triggerFor(event.target); if (trigger) open(trigger); else close(); }, permanentListeners);
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

  root.PortfolioDateHistory = Object.freeze({ labelHtml, bind, formatAge, calendarAgeDays, details, sourceDetails, timeline });
})(globalThis);
