/* Pure timeline interaction rules shared by the browser and regression checks. */
(function (root) {
  "use strict";

  const explicitOrder = (product) => {
    const value = product?.roadmap?.order;
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const monthNumber = (value) => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(value || ""));
    return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : Infinity;
  };
  const familyOf = (product) => product?.roadmap?.family || product?.family || "Other";

  function labelLines(value, width, measure, maxLines = 2) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || !(width > 0) || typeof measure !== "function") return [];
    let rest = text;
    const lines = [];
    while (rest && lines.length < maxLines) {
      if (measure(rest) <= width) { lines.push(rest); break; }
      const finalLine = lines.length === maxLines - 1;
      let count = rest.length;
      while (count > 0 && measure(rest.slice(0, count) + (finalLine ? "…" : "")) > width) count -= 1;
      if (!count) { lines.push(measure("…") <= width ? "…" : ""); break; }
      if (finalLine) { lines.push(`${rest.slice(0, count).trimEnd()}…`); break; }
      const boundary = rest.lastIndexOf(" ", count);
      if (boundary > 0) count = boundary;
      lines.push(rest.slice(0, count).trimEnd());
      rest = rest.slice(count).trimStart();
    }
    return lines;
  }

  function sortProducts(products) {
    return products.slice().sort((left, right) => {
      const leftOrder = explicitOrder(left);
      const rightOrder = explicitOrder(right);
      if (leftOrder !== null || rightOrder !== null) {
        if (leftOrder === null) return 1;
        if (rightOrder === null) return -1;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      }
      const leftStart = monthNumber(left?.roadmap?.startMonth);
      const rightStart = monthNumber(right?.roadmap?.startMonth);
      if (leftStart !== rightStart) return leftStart - rightStart;
      return String(left?.name || "").localeCompare(String(right?.name || ""));
    });
  }

  function dropTarget(groups, productId, pointY, { headerHeight = 88, groupHeaderHeight = 28, rowHeight = 38 } = {}) {
    if (!groups.length || !Number.isFinite(pointY)) return null;
    let groupTop = headerHeight;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      const rowsTop = groupTop + groupHeaderHeight;
      const groupBottom = rowsTop + group.products.length * rowHeight;
      if (pointY < groupBottom || groupIndex === groups.length - 1) {
        // Keep original canvas coordinates while excluding the moving product
        // from anchors. Filtering a view must never become a deletion or reorder
        // of the products that are hidden by its search or status filters.
        const rows = group.products
          .map((product, index) => ({ product, top: rowsTop + index * rowHeight }))
          .filter(({ product }) => product.id !== productId);
        const nextIndex = rows.findIndex(({ top }) => pointY < top + rowHeight / 2);
        const index = nextIndex < 0 ? rows.length : nextIndex;
        const before = rows[index];
        const after = rows[index - 1];
        return {
          family: group.family,
          beforeId: before?.product.id || null,
          afterId: after?.product.id || null,
          lineY: before?.top ?? (after ? after.top + rowHeight : rowsTop),
          index,
        };
      }
      groupTop = groupBottom;
    }
    return null;
  }

  function reorderProducts(products, productId, target) {
    const moving = products.find((product) => product.id === productId);
    if (!moving || !target) return false;
    const sourceFamily = familyOf(moving);
    const destinationFamily = typeof target.family === "string" && target.family.trim() ? target.family : sourceFamily;
    const currentFamily = sortProducts(products.filter((product) => familyOf(product) === destinationFamily));
    const destination = currentFamily.filter((product) => product.id !== productId);
    const beforeIndex = destination.findIndex((product) => product.id === target.beforeId);
    const afterIndex = destination.findIndex((product) => product.id === target.afterId);
    // A visible neighbor anchors the insertion into the full family, preserving
    // hidden products and their relative order. If the moving product already
    // lies between these visible anchors, retain its original position among
    // hidden neighbors instead of treating a drop over its own row as a move.
    const originalIndex = currentFamily.findIndex((product) => product.id === productId);
    const originalBefore = currentFamily.findIndex((product) => product.id === target.beforeId);
    const originalAfter = currentFamily.findIndex((product) => product.id === target.afterId);
    const inOriginalGap = sourceFamily === destinationFamily && originalIndex >= 0
      && originalIndex < (originalBefore >= 0 ? originalBefore : currentFamily.length)
      && originalIndex > (originalAfter >= 0 ? originalAfter : -1);
    const index = inOriginalGap ? originalIndex : beforeIndex >= 0 ? beforeIndex : afterIndex >= 0 ? afterIndex + 1 : target.index === 0 ? 0 : destination.length;
    destination.splice(index, 0, moving);
    let changed = false;
    if (destinationFamily !== sourceFamily) {
      moving.roadmap ||= {};
      moving.roadmap.family = destinationFamily;
      changed = true;
    }
    const assignOrder = (familyProducts) => familyProducts.forEach((product, order) => {
      if (product.roadmap?.order === order) return;
      product.roadmap ||= {};
      product.roadmap.order = order;
      changed = true;
    });
    if (destinationFamily !== sourceFamily) {
      assignOrder(sortProducts(products.filter((product) => product.id !== productId && familyOf(product) === sourceFamily)));
    }
    assignOrder(destination);
    return changed;
  }

  function draftDates({ originalStart, originalEnd, mode }, pixelDelta, monthWidth, increment = 1) {
    if (!Number.isFinite(originalStart) || !Number.isFinite(originalEnd)) throw new RangeError("Roadmap endpoints must be finite month indices.");
    const start = Math.trunc(originalStart);
    const end = Math.max(start, Math.trunc(originalEnd));
    const step = Number.isFinite(increment) && increment > 0 ? Math.max(1, Math.round(increment)) : 1;
    const distance = Number.isFinite(pixelDelta) && Number.isFinite(monthWidth) && monthWidth > 0 ? pixelDelta / monthWidth / step : 0;
    const delta = Math.sign(distance) * Math.round(Math.abs(distance)) * step;
    if (mode === "start") return { start: Math.min(end, start + delta), end };
    if (mode === "end") return { start, end: Math.max(start, end + delta) };
    if (mode === "move") return { start: start + delta, end: end + delta };
    throw new RangeError(`Unknown roadmap drag mode: ${mode}`);
  }

  root.RoadmapInteraction = Object.freeze({ sortProducts, dropTarget, reorderProducts, draftDates, labelLines });
})(globalThis);
