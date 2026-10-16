/* Shared, viewport-bound today marker. Calendar values deliberately use local time. */
(function (root) {
  "use strict";

  const SEGMENT_HEIGHT = 48;
  const READOUT_HEIGHT = 30;
  const READOUT_GAP = 3;
  const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const pad = (value) => String(value).padStart(2, "0");
  const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const zoneFormatter = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }) : null;

  function dateParts(now = new Date()) {
    const year = now.getFullYear(), month = now.getMonth() + 1, day = now.getDate();
    const isoDate = `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
    const hoursMinutes = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const seconds = `:${pad(now.getSeconds())}`;
    const zone = zoneFormatter?.formatToParts(now).find((part) => part.type === "timeZoneName")?.value || "";
    return { year, month, day, date: `${pad(month)}/${pad(day)}/${year}`, weekday: WEEKDAYS[now.getDay()], hoursMinutes, seconds, time: hoursMinutes + seconds, isoDate, isoTimestamp: now.toISOString(), zone };
  }

  // Equal-width calendar months, matching the roadmap's month-based scale.
  function currentMonthPosition(now = new Date()) {
    const end = new Date(0);
    end.setFullYear(now.getFullYear(), now.getMonth() + 1, 0);
    return now.getFullYear() * 12 + now.getMonth() + (now.getDate() - 1) / end.getDate();
  }

  // All coordinates are local to the visible layer, before offsetLeft/offsetTop.
  function geometry(input, readoutWidth = 0) {
    if (!input) return null;
    const width = Math.max(0, number(input.width)), height = Math.max(0, number(input.height));
    const left = clamp(number(input.left), 0, width), right = clamp(number(input.right, width), left, width);
    const x = Math.round(number(input.x, -1));
    const yearTop = number(input.yearTop), bodyTop = clamp(number(input.bodyTop, yearTop + 8), yearTop + 8, height);
    const margin = Math.min(8, width / 2);
    const labelWidth = clamp(number(readoutWidth), 0, Math.max(0, width - margin * 2));
    const fitsPlot = labelWidth + margin * 2 <= right - left;
    const labelMinimum = fitsPlot ? left + margin : margin;
    const labelMaximum = (fitsPlot ? right : width) - labelWidth - margin;
    return {
      width, height, left, right, x, yearTop, bodyTop,
      offsetLeft: number(input.offsetLeft), offsetTop: number(input.offsetTop),
      visible: input.visible !== false && width > 0 && height > 0 && right > left && x >= left && x <= right && x >= 0 && x < width && yearTop + 8 < height,
      readoutLeft: Math.round(clamp(x - labelWidth / 2, labelMinimum, Math.max(labelMinimum, labelMaximum))),
      readoutTop: yearTop - READOUT_GAP - READOUT_HEIGHT,
      lineTop: yearTop + 8,
      segmentHeight: Math.max(0, Math.min(SEGMENT_HEIGHT, height - bodyTop)),
    };
  }

  function create({ host, eventTarget = host, getGeometry, isActive = () => true }) {
    if (!host || !eventTarget || typeof getGeometry !== "function") throw new TypeError("A today marker needs a host, event target, and geometry callback.");
    const doc = host.ownerDocument || root.document;
    const element = doc.createElement("div");
    element.className = "portfolio-today-marker";
    element.hidden = true;
    const make = (className, tag = "span", parent = element) => {
      const child = doc.createElement(tag);
      child.className = `portfolio-today-${className}`;
      parent.appendChild(child);
      return child;
    };
    const line = make("line", "div"), donut = make("donut", "div"), follower = make("follower", "div");
    for (const decorative of [line, donut, follower]) decorative.setAttribute("aria-hidden", "true");
    const readout = make("readout", "div");
    readout.setAttribute("role", "group");
    const today = make("word", "span", readout); today.textContent = "Today";
    const date = make("date", "time", readout), weekday = make("day", "span", readout);
    const divider = make("divider", "span", readout); divider.setAttribute("aria-hidden", "true");
    const clock = make("clock", "time", readout);
    const hoursMinutes = make("hours-minutes", "span", clock), seconds = make("seconds", "span", clock);
    const zone = make("zone", "span", readout);
    host.appendChild(element);

    const reducedMotion = root.matchMedia?.("(prefers-reduced-motion: reduce)");
    const coarsePointer = root.matchMedia?.("(pointer: coarse)");
    const listeners = [], observers = [];
    const motion = { y: 0 };
    let destroyed = false, suspended = false, pageFrozen = false, intersecting = true, active = false, pointerDown = false, tracking = false;
    let dimensions = null, timer = 0, frame = 0, lastFrame = 0, targetY = 0, tween = null, dayKey = "";
    const listen = (target, type, callback, options) => {
      if (!target?.addEventListener) return;
      target.addEventListener(type, callback, options);
      listeners.push(() => target.removeEventListener(type, callback, options));
    };
    const setText = (target, value) => { if (target.textContent !== value) target.textContent = value; };
    const setPixels = (target, property, value) => {
      const next = `${value}px`;
      if (target.style[property] !== next) target.style[property] = next;
    };
    const cancelMotion = () => {
      if (frame) root.cancelAnimationFrame(frame);
      frame = 0; lastFrame = 0;
      tween?.kill(); tween = null;
    };
    const stopFollower = () => { tracking = false; follower.style.opacity = "0"; cancelMotion(); };
    const stopClock = () => { if (timer) root.clearTimeout(timer); timer = 0; };
    const available = () => !destroyed && !suspended && !pageFrozen && !doc.hidden && intersecting && host.isConnected !== false && isActive();
    const canFollow = () => active && !pointerDown && !reducedMotion?.matches && !coarsePointer?.matches && !doc.hidden;
    const positionFollower = () => { follower.style.transform = `translateY(${motion.y.toFixed(2)}px)`; };

    function writeClock(now) {
      const parts = dateParts(now);
      setText(date, parts.date); date.dateTime = parts.isoDate;
      setText(weekday, parts.weekday);
      setText(hoursMinutes, parts.hoursMinutes); setText(seconds, parts.seconds);
      clock.dateTime = parts.isoTimestamp;
      setText(zone, parts.zone);
      const accessible = `Today ${parts.date}, ${parts.weekday}, local time ${parts.time}${parts.zone ? ` ${parts.zone}` : ""}`;
      if (readout.getAttribute("aria-label") !== accessible) readout.setAttribute("aria-label", accessible);
      return parts.isoDate;
    }

    function scheduleClock(now) {
      if (timer || !active) return;
      timer = root.setTimeout(() => {
        timer = 0;
        if (!available()) { refresh(); return; }
        const current = new Date();
        const nextDay = writeClock(current);
        if (nextDay !== dayKey) refresh(current);
        else scheduleClock(current);
      }, Math.max(16, 1005 - now.getMilliseconds()));
    }

    function refresh(now = new Date()) {
      if (destroyed) return;
      if (!available()) {
        active = false; element.hidden = true; stopClock(); stopFollower(); return;
      }
      const input = getGeometry(now);
      dimensions = geometry(input);
      if (!dimensions?.visible) {
        active = false; element.hidden = true; stopClock(); stopFollower(); return;
      }
      active = true; element.hidden = false;
      dayKey = writeClock(now);
      for (const key of ["width", "height"]) setPixels(element, key, dimensions[key]);
      setPixels(element, "left", dimensions.offsetLeft); setPixels(element, "top", dimensions.offsetTop);
      element.classList.toggle("is-compact", dimensions.width < 300);
      element.classList.toggle("is-narrow", dimensions.width < 220);
      setPixels(readout, "maxWidth", Math.max(0, dimensions.width - 16));
      dimensions = geometry(input, readout.offsetWidth);
      setPixels(readout, "left", dimensions.readoutLeft); setPixels(readout, "top", dimensions.readoutTop);
      setPixels(line, "left", dimensions.x); setPixels(line, "top", dimensions.lineTop);
      setPixels(line, "height", Math.max(0, dimensions.height - dimensions.lineTop));
      setPixels(donut, "left", dimensions.x - 3.5); setPixels(donut, "top", dimensions.yearTop);
      setPixels(follower, "left", dimensions.x); setPixels(follower, "height", dimensions.segmentHeight);
      targetY = clamp(targetY, dimensions.bodyTop, Math.max(dimensions.bodyTop, dimensions.height - dimensions.segmentHeight));
      if (tracking) { cancelMotion(); motion.y = targetY; positionFollower(); }
      if (!canFollow()) stopFollower();
      scheduleClock(now);
    }

    function animate(timestamp) {
      frame = 0;
      if (!tracking || !canFollow()) { stopFollower(); return; }
      const delta = Math.min(48, lastFrame ? timestamp - lastFrame : 16);
      lastFrame = timestamp;
      motion.y += (targetY - motion.y) * (1 - Math.exp(-delta / 180));
      positionFollower();
      if (Math.abs(targetY - motion.y) > 0.08) frame = root.requestAnimationFrame(animate);
    }

    function track(event) {
      if (event.buttons || event.pointerType === "touch" || !canFollow() || !dimensions?.segmentHeight) { stopFollower(); return; }
      const bounds = element.getBoundingClientRect();
      const localY = event.clientY - bounds.top;
      if (localY < dimensions.bodyTop || localY > dimensions.height || event.clientX < bounds.left + dimensions.left || event.clientX > bounds.left + dimensions.right) { stopFollower(); return; }
      targetY = clamp(localY - dimensions.segmentHeight / 2, dimensions.bodyTop, Math.max(dimensions.bodyTop, dimensions.height - dimensions.segmentHeight));
      if (!tracking) { motion.y = targetY; positionFollower(); }
      tracking = true; follower.style.opacity = "1";
      if (root.gsap?.to) {
        tween?.kill();
        tween = root.gsap.to(motion, { y: targetY, duration: 0.18, ease: "power2.out", overwrite: true, onUpdate: positionFollower });
      } else if (!frame && root.requestAnimationFrame) {
        lastFrame = 0; frame = root.requestAnimationFrame(animate);
      }
    }

    listen(eventTarget, "pointermove", track, { passive: true });
    listen(eventTarget, "pointerleave", stopFollower, { passive: true });
    listen(eventTarget, "pointerdown", () => { pointerDown = true; stopFollower(); }, { passive: true });
    listen(root, "pointerup", () => { pointerDown = false; }, { passive: true });
    for (const type of ["pointercancel", "lostpointercapture", "blur"]) listen(root, type, () => { pointerDown = false; stopFollower(); }, { passive: true });
    listen(doc, "visibilitychange", () => { pointerDown = false; refresh(); });
    listen(reducedMotion, "change", stopFollower);
    listen(coarsePointer, "change", stopFollower);
    listen(root, "resize", () => refresh(), { passive: true });

    if (root.ResizeObserver) {
      const observer = new root.ResizeObserver(() => refresh());
      observer.observe(eventTarget); observer.observe(readout); observers.push(observer);
    }
    if (root.IntersectionObserver) {
      const observer = new root.IntersectionObserver((entries) => {
        intersecting = entries.some((entry) => entry.isIntersecting);
        refresh();
      });
      observer.observe(eventTarget); observers.push(observer);
    }
    if (root.MutationObserver) {
      const observer = new root.MutationObserver(() => refresh());
      for (let ancestor = host; ancestor; ancestor = ancestor.parentElement) observer.observe(ancestor, { attributes: true, attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden"] });
      observers.push(observer);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true; active = false; stopClock(); stopFollower();
      for (const remove of listeners) remove();
      for (const observer of observers) observer.disconnect();
      element.remove();
    }
    listen(root, "pagehide", (event) => {
      if (!event.persisted) { destroy(); return; }
      pageFrozen = true; pointerDown = false; refresh();
    });
    listen(root, "pageshow", (event) => {
      if (!event.persisted || !pageFrozen) return;
      pageFrozen = false; refresh();
    });
    doc.fonts?.ready?.then(() => { if (!destroyed) refresh(); });
    refresh();
    return {
      element,
      sync() { suspended = false; refresh(); },
      clear() { suspended = true; refresh(); },
      destroy,
    };
  }

  // PNG/export canvases receive the same date, ring, dashed line and compact clock.
  // This does not run a timer or alter the interactive marker.
  function drawStatic(context, input, now = new Date()) {
    let dimensions = geometry(input);
    if (!dimensions?.visible) return false;
    const parts = dateParts(now), compact = dimensions.width < 300, narrow = dimensions.width < 220;
    const family = input.fontFamily || '"Jost", Arial, sans-serif';
    const gap = narrow ? 5 : compact ? 8 : 10, padding = narrow ? 7 : compact ? 8 : 10;
    const fontSize = narrow ? 11 : 12;
    const colors = { alert: "#FF2525", alertText: "#FF8A8A", page: "#1A1B1C", surface: "#242527", border: "#333538", text: "#D5D7DC", secondary: "#BBBCC0", divider: "#4D5054", ...input.colors };
    const runs = [
      ...(!compact ? [{ text: "Today", size: 12, weight: 500, color: colors.alertText }] : []),
      { text: parts.date, size: fontSize, weight: 500, color: colors.text },
      { text: parts.weekday, size: 11, weight: 400, color: colors.secondary },
      { divider: true },
      { text: parts.hoursMinutes, seconds: parts.seconds, size: narrow ? 12 : 13, weight: 500, color: colors.text },
      ...(!compact && parts.zone ? [{ text: parts.zone, size: 10, weight: 400, color: colors.secondary }] : []),
    ];
    context.save();
    for (const run of runs) {
      context.font = `${run.weight || 400} ${run.size || 12}px ${family}`;
      run.width = run.divider ? 1 : context.measureText((run.text || "") + (run.seconds || "")).width;
    }
    const readoutWidth = Math.min(dimensions.width - 16, runs.reduce((total, run) => total + run.width, padding * 2 + gap * (runs.length - 1) + 2));
    dimensions = geometry(input, readoutWidth);
    context.beginPath(); context.rect(0, 0, dimensions.width, dimensions.height); context.clip();
    context.strokeStyle = colors.alert; context.lineWidth = 1; context.globalAlpha = 0.65; context.setLineDash([3, 5]);
    context.beginPath(); context.moveTo(dimensions.x + 0.5, dimensions.lineTop); context.lineTo(dimensions.x + 0.5, dimensions.height); context.stroke();
    context.setLineDash([]); context.globalAlpha = 1;
    context.fillStyle = colors.page;
    context.beginPath(); context.arc(dimensions.x + 0.5, dimensions.yearTop + 4, 3.5, 0, Math.PI * 2); context.fill(); context.stroke();
    const x = dimensions.readoutLeft, y = dimensions.readoutTop;
    context.fillStyle = colors.surface; context.strokeStyle = colors.border;
    context.beginPath();
    if (context.roundRect) context.roundRect(x + 0.5, y + 0.5, readoutWidth - 1, READOUT_HEIGHT - 1, 3);
    else context.rect(x + 0.5, y + 0.5, readoutWidth - 1, READOUT_HEIGHT - 1);
    context.fill(); context.stroke();
    context.textAlign = "left"; context.textBaseline = "middle";
    let cursor = x + padding + 1;
    for (const run of runs) {
      if (run.divider) {
        context.fillStyle = colors.divider; context.fillRect(cursor, y + 9, 1, 12);
      } else {
        context.font = `${run.weight} ${run.size}px ${family}`; context.fillStyle = run.color;
        context.fillText(run.text, cursor, y + READOUT_HEIGHT / 2);
        if (run.seconds) { context.fillStyle = colors.secondary; context.fillText(run.seconds, cursor + context.measureText(run.text).width, y + READOUT_HEIGHT / 2); }
      }
      cursor += run.width + gap;
    }
    context.restore();
    return true;
  }

  root.PortfolioTodayMarker = { create, dateParts, currentMonthPosition, geometry, drawStatic };
})(globalThis);
