/* FFS map placement uses only the independent FFS milestone and its current precision. */
(function (root) {
  "use strict";

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const STAGES = new Set(["launched", "in-development", "in-planning", "embargo", "end-of-life"]);
  const clean = (value) => typeof value === "string" ? value.trim() : "";
  const iso = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  function dateParts(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value));
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > monthDays(year, month)) return null;
    return { year, month, day, value: iso(year, month, day) };
  }

  function monthDays(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function dayLabel(date) {
    return `${MONTHS[date.month - 1]} ${date.day}, ${date.year}`;
  }

  function currentEvidence(product) {
    const evidence = product?.plc?.fields?.ffsDate;
    return evidence && !evidence.supersededAt && clean(evidence.value) === clean(product?.ffsDate) ? evidence : null;
  }

  function declaredPeriod(source, anchor) {
    if (!source || typeof source !== "object" || Array.isArray(source) || source.basis !== "calendar") return null;
    const start = dateParts(source.start), end = dateParts(source.end);
    if (!start || !end || start.value > end.value || anchor !== start.value) return null;
    const year = start.year;
    let label;
    switch (source.precision) {
      case "quarter": {
        const quarter = Math.floor((start.month - 1) / 3) + 1;
        if (start.day !== 1 || start.month !== (quarter - 1) * 3 + 1 || end.value !== iso(year, quarter * 3, monthDays(year, quarter * 3))
          || Number(source.year) !== year || Number(source.quarter) !== quarter) return null;
        label = `Q${quarter} ${year}`;
        break;
      }
      case "month":
        if (start.day !== 1 || end.value !== iso(year, start.month, monthDays(year, start.month))) return null;
        label = `${MONTHS[start.month - 1]} ${year}`;
        break;
      case "half-year": {
        const half = start.month === 1 ? 1 : start.month === 7 ? 2 : 0;
        if (!half || start.day !== 1 || end.value !== iso(year, half * 6, monthDays(year, half * 6))) return null;
        label = `H${half} ${year}`;
        break;
      }
      case "year":
        if (start.value !== iso(year, 1, 1) || end.value !== iso(year, 12, 31)) return null;
        label = String(year);
        break;
      case "range":
        label = `${dayLabel(start)} – ${dayLabel(end)}`;
        break;
      default:
        return null;
    }
    return { start: start.value, end: end.value, precision: source.precision, label };
  }

  function period(product) {
    const date = dateParts(product?.ffsDate);
    if (!date) return null;
    const evidence = currentEvidence(product);
    const quarter = root.PortfolioDatePrecision?.currentPeriod(product, "ffsDate");
    const window = quarter || declaredPeriod(evidence?.period, date.value);
    // Calendar precision alone does not establish that a planning date is official.
    const reviewFlag = Boolean(evidence && (evidence.period && !window || Array.isArray(evidence.candidates) && evidence.candidates.length > 1 && !evidence.reviewed));
    return {
      ...(window ? { start: window.start, end: window.end, precision: window.precision, label: window.label }
        : { start: date.value, end: date.value, precision: "day", label: dayLabel(date) }),
      estimated: true,
      reviewFlag,
    };
  }

  function status(product) {
    const stage = clean(product?.roadmap?.status);
    return STAGES.has(stage) ? stage : "unknown";
  }

  function position(date, afterDay = false) {
    return date.year * 12 + date.month - 1 + (date.day - (afterDay ? 0 : 1)) / monthDays(date.year, date.month);
  }

  function geometry(product, range, rowTop, options = {}) {
    const estimate = period(product);
    const startIndex = Number(range?.start), endIndex = Number(range?.end), count = Number(range?.count);
    const leftWidth = Number(options.leftWidth), monthWidth = Number(options.monthWidth), rowHeight = Number(options.rowHeight);
    if (!estimate || !Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex < startIndex || count !== endIndex - startIndex + 1
      || !Number.isFinite(rowTop) || !Number.isFinite(leftWidth) || !Number.isFinite(monthWidth) || monthWidth <= 0 || !Number.isFinite(rowHeight) || rowHeight < 12) return null;
    const start = dateParts(estimate.start), end = dateParts(estimate.end);
    const windowStart = position(start), windowEnd = position(end, true), horizonEnd = endIndex + 1;
    if (windowEnd <= startIndex || windowStart >= horizonEnd) return null;
    const timelineRight = leftWidth + count * monthWidth;
    const height = Math.min(18, rowHeight - 10), y = rowTop + (rowHeight - height) / 2;
    if (estimate.precision === "day") {
      const centerX = leftWidth + (windowStart + .5 / monthDays(start.year, start.month) - startIndex) * monthWidth;
      const halfWidth = Math.min(6, monthWidth / 2);
      const x = Math.max(leftWidth, centerX - halfWidth), right = Math.min(timelineRight, centerX + halfWidth);
      return { x, y, width: right - x, height, centerX, kind: "point", period: estimate, clippedBefore: false, clippedAfter: false };
    }
    const x = leftWidth + (Math.max(startIndex, windowStart) - startIndex) * monthWidth;
    const right = leftWidth + (Math.min(horizonEnd, windowEnd) - startIndex) * monthWidth;
    return { x, y, width: right - x, height, centerX: (x + right) / 2, kind: "window", period: estimate,
      clippedBefore: windowStart < startIndex, clippedAfter: windowEnd > horizonEnd };
  }

  root.PortfolioFfsRoadmap = Object.freeze({ period, geometry, status });
})(globalThis);
