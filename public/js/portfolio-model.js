/* Pure portfolio rules shared by the browser and regression checks. */
(function (root) {
  "use strict";

  const DEFAULT_STAGE_COLORS = Object.freeze({
    launched: "#393c40",
    "in-development": "#526564",
    "in-planning": "#64615a",
  });
  const THEME_ACCENTS = Object.freeze({ newProduct: "#5fd6c1", embargo: "#ef5b5b" });
  const LIFECYCLE_TONES = Object.freeze({ ...DEFAULT_STAGE_COLORS, embargo: THEME_ACCENTS.embargo, "end-of-life": "#504b50" });

  function lifecycleTone(stage) {
    return LIFECYCLE_TONES[stage] || LIFECYCLE_TONES["in-planning"];
  }

  function productTone(product) {
    if (product.statusType === "embargo" || product.roadmap?.status === "embargo") return THEME_ACCENTS.embargo;
    if (product.statusType === "new") return THEME_ACCENTS.newProduct;
    return lifecycleTone(product.roadmap?.status);
  }

  function productLabelColor(product, fallback) {
    return product?.statusType === "embargo" || product?.roadmap?.status === "embargo" ? "#ffffff" : fallback;
  }

  // Visibility belongs to each view; it must never alter the saved MSRP.
  function msrpText(product) {
    const raw = product?.price;
    if (["number", "string"].includes(typeof raw) && String(raw).trim() !== "") {
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0) return `$${value.toFixed(2)}`;
    }
    const label = String(product?.priceLabel || "").trim();
    return /^(?:price\s*)?(?:tbd|not\s*(?:set|available)|hidden|n\/?a|[-—–]+)$/i.test(label) ? "" : label;
  }

  function layoutProductLanes(lanes, layout, { top = 34, expandedLaneId = "", detailHeight = 0 } = {}) {
    const gap = Math.max(0, layout.laneHeight - layout.cardHeight);
    let cursor = top;
    const rows = lanes.map((lane, index) => {
      const contentHeight = Math.max(layout.cardHeight, lane.id === expandedLaneId ? detailHeight : 0);
      const row = { lane, index, top: cursor, contentHeight, height: contentHeight + gap };
      cursor += row.height;
      return row;
    });
    return { rows, height: cursor - top };
  }

  function clearAllProducts(portfolio) {
    for (const category of portfolio.categories || []) category.board.products = [];
    portfolio.imageAssets = [];
    delete portfolio.ascmSnapshot;
    return portfolio;
  }
  const monthNumber = (value) => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(value || ""));
    return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
  };
  const monthString = (value) => `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, "0")}`;

  function exactProductDate(value) {
    const text = String(value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const date = new Date(`${text}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : "";
  }

  function dateInMonth(value, month) {
    const date = exactProductDate(value);
    if (!date) return value;
    const finalDay = new Date(`${month}-01T00:00:00Z`);
    finalDay.setUTCMonth(finalDay.getUTCMonth() + 1, 0);
    return `${month}-${String(Math.min(Number(date.slice(8)), finalDay.getUTCDate())).padStart(2, "0")}`;
  }

  // Synchronization follows an explicit edit or drag. Opening an old package
  // must not reconcile independent saved dates/months or invent an exact day.
  function mergeProductUpdate(product, patch = {}) {
    const hasGa = Object.hasOwn(patch, "generalAvailabilityDate");
    const hasEm = Object.hasOwn(patch, "endManufacturingDate");
    const monthPatch = patch.roadmap || {};
    const hasStart = Object.hasOwn(monthPatch, "startMonth") || Object.hasOwn(monthPatch, "launchMonth");
    const hasEnd = Object.hasOwn(monthPatch, "endMonth");
    let startChanged = false;
    let endChanged = false;
    const next = { ...product, ...patch };
    if (product.roadmap || patch.roadmap) next.roadmap = { ...product.roadmap, ...patch.roadmap };
    if (!hasGa && !hasEm && !hasStart && !hasEnd) return next;
    next.roadmap ||= {};

    for (const [field, supplied] of [["generalAvailabilityDate", hasGa], ["endManufacturingDate", hasEm]]) {
      if (!supplied) continue;
      const text = String(patch[field] ?? "").trim();
      const normalized = exactProductDate(text);
      if (text && text.toUpperCase() !== "TBD" && !normalized) throw new RangeError(`Invalid ${field}: expected an exact calendar date or TBD.`);
      next[field] = normalized;
    }

    if (hasStart && !hasGa) {
      const month = Object.hasOwn(monthPatch, "startMonth") ? monthPatch.startMonth : monthPatch.launchMonth;
      if (monthNumber(month) === null) throw new RangeError("Invalid launch month: expected YYYY-MM.");
      startChanged = month !== product.roadmap?.startMonth;
      next.roadmap.startMonth = month;
      next.roadmap.launchMonth = month;
      if (startChanged && exactProductDate(product.generalAvailabilityDate)) next.generalAvailabilityDate = dateInMonth(product.generalAvailabilityDate, month);
    }
    if (hasEnd && !hasEm) {
      if (monthNumber(monthPatch.endMonth) === null) throw new RangeError("Invalid lifecycle end month: expected YYYY-MM.");
      endChanged = monthPatch.endMonth !== product.roadmap?.endMonth;
      next.roadmap.endMonth = monthPatch.endMonth;
      if (endChanged && exactProductDate(product.endManufacturingDate)) next.endManufacturingDate = dateInMonth(product.endManufacturingDate, monthPatch.endMonth);
    }
    if (hasGa) {
      // Clearing the exact date preserves the last planned month, including
      // when a caller includes a contradictory month hint in the same patch.
      if (next.generalAvailabilityDate) next.roadmap.startMonth = next.roadmap.launchMonth = next.generalAvailabilityDate.slice(0, 7);
      else {
        if (Object.hasOwn(product.roadmap || {}, "startMonth")) next.roadmap.startMonth = product.roadmap.startMonth;
        else delete next.roadmap.startMonth;
        if (Object.hasOwn(product.roadmap || {}, "launchMonth")) next.roadmap.launchMonth = product.roadmap.launchMonth;
        else delete next.roadmap.launchMonth;
      }
    }
    if (hasEm) {
      if (next.endManufacturingDate) next.roadmap.endMonth = next.endManufacturingDate.slice(0, 7);
      else if (Object.hasOwn(product.roadmap || {}, "endMonth")) next.roadmap.endMonth = product.roadmap.endMonth;
      else delete next.roadmap.endMonth;
    }

    const start = monthNumber(next.roadmap.startMonth);
    const end = monthNumber(next.roadmap.endMonth);
    const monthOriginChanged = startChanged || endChanged;
    const changedTiming = monthOriginChanged || (hasGa && next.generalAvailabilityDate) || (hasEm && next.endManufacturingDate);
    if (changedTiming && start !== null && end !== null && end < start) {
      next.roadmap.endMonth = next.roadmap.startMonth;
      // A month-origin edit moves the exact end together with the clamped bar.
      // A date-origin edit retains the supplied exact date for UI validation.
      if (monthOriginChanged && !hasEm && exactProductDate(product.endManufacturingDate)) {
        next.endManufacturingDate = dateInMonth(product.endManufacturingDate, next.roadmap.endMonth);
      }
    }
    if (monthOriginChanged && !hasEm && exactProductDate(next.generalAvailabilityDate) && exactProductDate(next.endManufacturingDate)
      && next.endManufacturingDate < next.generalAvailabilityDate) {
      next.endManufacturingDate = next.generalAvailabilityDate;
      next.roadmap.endMonth = next.endManufacturingDate.slice(0, 7);
    }
    return next;
  }

  function normalizeTimelineSettings(value = {}, fallback = {}) {
    const startMonth = monthNumber(value.startMonth) !== null ? value.startMonth
      : monthNumber(fallback.startMonth) !== null ? fallback.startMonth : "2026-01";
    let endMonth = monthNumber(value.endMonth) !== null ? value.endMonth
      : monthNumber(fallback.endMonth) !== null ? fallback.endMonth : monthString(monthNumber(startMonth) + 59);
    if (monthNumber(endMonth) < monthNumber(startMonth)) endMonth = monthString(monthNumber(startMonth) + 11);
    const statusColors = { ...DEFAULT_STAGE_COLORS };
    for (const stage of Object.keys(statusColors)) {
      const candidate = value.statusColors?.[stage] || fallback.statusColors?.[stage];
      if (/^#[\da-f]{6}$/i.test(candidate || "")) statusColors[stage] = candidate;
    }
    const snap = value.snap || fallback.snap;
    return { startMonth, endMonth, snap: ["month", "quarter", "half"].includes(snap) ? snap : "month", statusColors };
  }

  // The portfolio-level range is authoritative. Legacy packages inherit their
  // active category's range once; category-specific labels/families stay local.
  function syncTimelineSettings(portfolio, patch = {}) {
    portfolio.settings ||= {};
    const active = portfolio.categories.find((category) => category.id === portfolio.activeCategoryId) || portfolio.categories[0];
    const current = normalizeTimelineSettings(portfolio.settings.timeline || {}, active?.board?.settings?.roadmap);
    const timeline = normalizeTimelineSettings({ ...current, ...patch, statusColors: { ...current.statusColors, ...patch.statusColors } });
    portfolio.settings.timeline = timeline;
    for (const category of portfolio.categories) {
      category.board.settings ||= {};
      category.board.settings.roadmap = { ...category.board.settings.roadmap, ...timeline, statusColors: { ...timeline.statusColors } };
    }
    return timeline;
  }

  function normalizeSpecifications(value, makeId = () => `spec-${Math.random().toString(36).slice(2)}`) {
    let entries = value;
    if (typeof entries === "string") {
      try { entries = JSON.parse(entries); } catch { entries = [{ label: "Specifications", value: entries }]; }
    }
    if (entries && !Array.isArray(entries) && typeof entries === "object") {
      entries = Object.entries(entries).map(([label, value]) => ({ label, value }));
    }
    return (Array.isArray(entries) ? entries : []).map((entry) => {
      const item = Array.isArray(entry) ? { label: entry[0], value: entry[1] }
        : entry && typeof entry === "object" ? entry : { label: "Specification", value: entry };
      return { ...item, id: String(item.id || makeId()), label: String(item.label ?? item.name ?? "Specification"), value: String(item.value ?? "") };
    });
  }

  function canonicalColorCode(value) {
    const imported = root.ASCMImporter?.helpers?.canonicalColorCode?.(value);
    if (imported) return imported;
    const aliases = { BLACK: "BK", BLK: "BK", WHITE: "WHT", GRAY: "GRY", GREY: "GRY", SILVER: "SLV", BLUE: "BLU", NAVY: "NVY", ORANGE: "ORG", YELLOW: "YLW", GREEN: "GRN", CYAN: "CYN", PURPLE: "PUR", LAVENDER: "LVR", PINK: "PNK", BROWN: "BRN", BEIGE: "BGE", GOLD: "GLD" };
    return String(value || "").trim().toUpperCase().split(/[\s/_+-]+/).map((part) => aliases[part] || part).join("/");
  }

  // Only explicit manual assignments or matched ASCM Base PNs establish a
  // relationship. Unmapped/ambiguous numbers never borrow a nearby swatch.
  function resolveSkuColors(sku, product) {
    const variants = (product.variantGroups || []).filter((group) => group.type === "color").flatMap((group) => group.items || []);
    const recordCodes = (product.ascm?.records || [])
      .filter((record) => String(record.basePartNumber || record.basePn || "").toUpperCase() === String(sku.code || "").toUpperCase())
      .map((record) => record.colorCode).filter(Boolean);
    const codes = [...new Set((sku.colorCode ? [sku.colorCode] : recordCodes).map(canonicalColorCode))];
    const explicitVariant = variants.find((variant) => variant.id === sku.variantId);
    if (explicitVariant) return [{ ...explicitVariant, label: [explicitVariant.colorName, explicitVariant.colorName2].filter(Boolean).join(" / ") }];
    return codes.map((code) => {
      const variant = variants.find((item) => canonicalColorCode(item.code) === code);
      if (variant) return { ...variant, label: [variant.colorName, variant.colorName2].filter(Boolean).join(" / ") || code };
      return { code, label: code, colorHex: "", colorHex2: "" };
    });
  }

  root.PortfolioModel = Object.freeze({ DEFAULT_STAGE_COLORS, THEME_ACCENTS, LIFECYCLE_TONES, lifecycleTone, productTone, productLabelColor, msrpText, layoutProductLanes, clearAllProducts, mergeProductUpdate, normalizeTimelineSettings, syncTimelineSettings, normalizeSpecifications, canonicalColorCode, resolveSkuColors });
})(globalThis);
