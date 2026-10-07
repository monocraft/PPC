(function registerPptxPagination(globalObject) {
  "use strict";

  const MAX_PRODUCTS_PER_SLIDE = 22;
  const MAX_PRODUCT_COLUMNS = 13;

  function normalizedLimit(maxProducts) {
    return Math.max(1, Math.floor(Number(maxProducts) || MAX_PRODUCTS_PER_SLIDE));
  }

  function selectExportCategories(categories, selectedIds = null) {
    const available = (Array.isArray(categories) ? categories : []).filter((category) => category?.board);
    if (selectedIds == null) return available;
    const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
    return available.filter((category) => selected.has(category.id));
  }

  function paginateRoadmapGroups(groups, maxProducts = MAX_PRODUCTS_PER_SLIDE) {
    const limit = normalizedLimit(maxProducts);
    const pages = [];
    let page = [];
    let pageProductCount = 0;

    const finishPage = () => {
      if (!page.length) return;
      pages.push(page);
      page = [];
      pageProductCount = 0;
    };

    groups.forEach((group) => {
      const products = Array.isArray(group.products) ? group.products : [];
      if (products.length <= limit && pageProductCount > 0 && pageProductCount + products.length > limit) {
        finishPage();
      }
      let groupOffset = 0;
      while (groupOffset < products.length) {
        if (pageProductCount >= limit) finishPage();
        const take = Math.min(limit - pageProductCount, products.length - groupOffset);
        page.push({
          ...group,
          products: products.slice(groupOffset, groupOffset + take),
          continued: Boolean(group.continued) || groupOffset > 0,
        });
        groupOffset += take;
        pageProductCount += take;
      }
    });

    finishPage();
    return pages.length ? pages : [[]];
  }

  function paginateProductLanes(lanes, products, options = {}) {
    const metric = (name, fallback, minimum = 0) => {
      const value = Number(options[name]);
      return Number.isFinite(value) && value >= minimum ? value : fallback;
    };
    const maxColumns = Math.max(1, Math.floor(metric("maxColumns", MAX_PRODUCT_COLUMNS, 1)));
    const cardWidth = metric("cardWidth", 246, Number.EPSILON);
    const cardGap = metric("cardGap", 10);
    const cardHeight = metric("cardHeight", 552, Number.EPSILON);
    const laneGap = metric("laneGap", 70);
    const gutter = metric("gutter", 18);
    const sidePadding = metric("sidePadding", 40);
    const top = metric("top", 34);
    const bottom = metric("bottom", 20);
    const minWidth = metric("minWidth", 1480, Number.EPSILON);
    const slideWidth = metric("slideWidth", 12.55, Number.EPSILON);
    const slideHeight = metric("slideHeight", 6.33, Number.EPSILON);
    const getFamily = typeof options.getFamily === "function" ? options.getFamily
      : (product) => product.roadmap?.family || product.family || "";
    const ordered = (items) => items.map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const aOrder = Number.isFinite(a.item.order) ? a.item.order : a.index;
        const bOrder = Number.isFinite(b.item.order) ? b.item.order : b.index;
        return aOrder - bOrder || a.index - b.index;
      }).map(({ item }) => item);
    const orderedLanes = ordered(Array.isArray(lanes) ? lanes : []);
    const sourceProducts = Array.isArray(products) ? products : [];
    const byLane = new Map();
    orderedLanes.forEach((lane) => {
      if (byLane.has(lane.id)) throw new Error(`Duplicate product lane id: ${lane.id}`);
      byLane.set(lane.id, []);
    });
    const unassigned = [];
    sourceProducts.forEach((product) => {
      const laneProducts = byLane.get(product.laneId);
      (laneProducts || unassigned).push(product);
    });
    if (unassigned.length) {
      let fallbackId = "__pptx-unassigned__";
      while (byLane.has(fallbackId)) fallbackId += "_";
      const fallback = { id: fallbackId, label: "Unassigned" };
      orderedLanes.push(fallback);
      byLane.set(fallbackId, unassigned);
    }

    const rows = [];
    let maxLaneCount = 0;
    orderedLanes.forEach((lane) => {
      const laneProducts = ordered(byLane.get(lane.id));
      maxLaneCount = Math.max(maxLaneCount, laneProducts.length);
      let rowProducts = [];
      let continued = Boolean(lane.continued);
      const finishRow = () => {
        if (!rowProducts.length) return;
        rows.push({ lane, products: rowProducts, continued });
        rowProducts = [];
        continued = true;
      };
      for (let offset = 0; offset < laneProducts.length;) {
        const family = getFamily(laneProducts[offset]);
        let runEnd = offset + 1;
        while (runEnd < laneProducts.length && getFamily(laneProducts[runEnd]) === family) runEnd += 1;
        const runLength = runEnd - offset;
        // A family that fits a fresh row moves intact if the current row is
        // too full. Larger families are split in their existing product order.
        if (runLength <= maxColumns && rowProducts.length + runLength > maxColumns) finishRow();
        while (offset < runEnd) {
          const take = Math.min(maxColumns - rowProducts.length, runEnd - offset);
          rowProducts.push(...laneProducts.slice(offset, offset + take));
          offset += take;
          if (rowProducts.length === maxColumns) finishRow();
        }
      }
      finishRow();
    });

    const columns = Math.min(maxColumns, maxLaneCount);
    // A category keeps one horizontal scale for every page. If a detail card
    // is unusually tall, reserve enough width for even one row to fit.
    const width = Math.max(minWidth, gutter + columns * (cardWidth + cardGap) + sidePadding,
      (top + cardHeight + bottom) * slideWidth / slideHeight);
    const availableHeight = width * slideHeight / slideWidth;
    const rowsPerSlide = Math.max(1, Math.floor((availableHeight - top - bottom + laneGap) / (cardHeight + laneGap)));
    const pages = [];
    for (let offset = 0; offset < rows.length; offset += rowsPerSlide) {
      pages.push({ rows: rows.slice(offset, offset + rowsPerSlide), width, height: 0, columns, rowsPerSlide });
    }
    if (!pages.length) pages.push({ rows: [], width, height: top + bottom, columns, rowsPerSlide });
    pages.forEach((page) => {
      const rowCount = pages.length > 1 ? rowsPerSlide : page.rows.length;
      page.height = top + rowCount * cardHeight + Math.max(0, rowCount - 1) * laneGap + bottom;
    });
    return pages;
  }

  globalObject.PPTXPagination = Object.freeze({
    MAX_PRODUCTS_PER_SLIDE,
    MAX_PRODUCT_COLUMNS,
    selectExportCategories,
    paginateRoadmapGroups,
    paginateProductLanes,
  });
}(globalThis));
