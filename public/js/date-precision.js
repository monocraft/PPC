/* Quarter precision is retained independently from the roadmap placement day. */
(function (root) {
  "use strict";
  const clean = (value) => String(value ?? "").replace(/\u00a0/g, " ").replace(/[’‘]/g, "'").trim();
  function quarterPeriod(year, quarter) {
    if (!Number.isInteger(year) || year < 1900 || year > 9999 || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) return null;
    const month = (quarter - 1) * 3 + 1;
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(year, month + 2, 0)).toISOString().slice(0, 10);
    return { precision: "quarter", basis: "calendar", year, quarter, start, end, label: `Q${quarter} ${year}` };
  }
  function parseQuarter(value) {
    const text = clean(value).replace(/\s+/g, " ");
    if (!text || text.length > 120 || /\?|[~～]|=>|→|->|\b(?:FY|fiscal|or|and|between|range|tentative|possibly)\b/i.test(text)) return null;
    // These workbook phrases state one revised quarter rather than a range.
    const candidate = text.replace(/^PM\s+adjusted(?:\s+(?:FFS|GA))?\s+to\s+/i, "");
    const match = /^(?:calendar\s+)?Q([1-4])\s*(?:[/'-]\s*)?'?(\d{4}|\d{2})$/i.exec(candidate)
      || /^(\d{4})\s*Q([1-4])$/i.exec(candidate)?.map((part, index, all) => index === 1 ? all[2] : index === 2 ? all[1] : part);
    if (!match) return null;
    const year = Number(match[2]) < 100 ? 2000 + Number(match[2]) : Number(match[2]);
    return quarterPeriod(year, Number(match[1]));
  }
  function normalizePeriod(period, anchor) {
    if (!period || typeof period !== "object" || Array.isArray(period) || period.precision !== "quarter" || period.basis !== "calendar") return null;
    const normalized = quarterPeriod(Number(period.year), Number(period.quarter));
    if (!normalized || clean(anchor) !== normalized.start) return null;
    if (Object.hasOwn(period, "start") && period.start !== normalized.start || Object.hasOwn(period, "end") && period.end !== normalized.end) return null;
    return normalized;
  }
  function currentPeriod(product, field) {
    const evidence = product?.plc?.fields?.[field];
    if (!evidence || evidence.supersededAt || clean(evidence.value) !== clean(product?.[field])) return null;
    return normalizePeriod(evidence.period, product[field]);
  }
  function displayDate(product, field, formatter = (value) => value || "TBD") {
    return currentPeriod(product, field)?.label || formatter(product?.[field] || "");
  }
  root.PortfolioDatePrecision = Object.freeze({ parseQuarter, normalizePeriod, currentPeriod, displayDate });
})(globalThis);
