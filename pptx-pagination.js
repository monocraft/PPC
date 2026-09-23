(function registerPptxPagination(globalObject) {
  "use strict";

  const MAX_PRODUCTS_PER_SLIDE = 22;

  function normalizedLimit(maxProducts) {
    return Math.max(1, Math.floor(Number(maxProducts) || MAX_PRODUCTS_PER_SLIDE));
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

  globalObject.PPTXPagination = Object.freeze({
    MAX_PRODUCTS_PER_SLIDE,
    paginateRoadmapGroups,
  });
}(globalThis));
