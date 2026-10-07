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

  root.PortfolioModel = Object.freeze({ DEFAULT_STAGE_COLORS, THEME_ACCENTS, LIFECYCLE_TONES, lifecycleTone, productTone, msrpText, layoutProductLanes, clearAllProducts, normalizeTimelineSettings, syncTimelineSettings, normalizeSpecifications, canonicalColorCode, resolveSkuColors });
})(globalThis);
