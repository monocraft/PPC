/* Category lanes retain FFS coordinates; names never participate in identity or placement. */
(function (root) {
  "use strict";

  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const text = value => typeof value === "string" ? value.trim() : "";
  const sourceId = value => typeof value === "string" || typeof value === "number" ? String(value) : "";
  const compositeKey = (categoryId, productId) => JSON.stringify([categoryId, productId]);

  function project(portfolio, scopeIDs = null) {
    const scope = Array.isArray(scopeIDs) ? new Set(scopeIDs.map(sourceId)) : null;
    const entries = [], categories = [], duplicates = [], seenCategories = new Set(), seenProducts = new Set();
    for (const [categoryOrder, category] of (Array.isArray(portfolio?.categories) ? portfolio.categories : []).entries()) {
      const categoryId = sourceId(category?.id);
      if (!categoryId || seenCategories.has(categoryId) || scope && !scope.has(categoryId)) continue;
      seenCategories.add(categoryId);
      const categoryName = text(category.name) || categoryId;
      categories.push(Object.freeze({ id: categoryId, name: categoryName, order: categoryOrder }));
      for (const [sourceRow, product] of (Array.isArray(category.board?.products) ? category.board.products : []).entries()) {
        if (!product || typeof product !== "object") continue;
        const productId = sourceId(product.id);
        // Invalid imported identities remain discoverable, without matching a different product by name.
        const key = productId ? compositeKey(categoryId, productId) : JSON.stringify([categoryId, null, sourceRow]);
        if (seenProducts.has(key)) { duplicates.push(Object.freeze({ key, categoryId, productId })); continue; }
        seenProducts.add(key);
        entries.push(Object.freeze({ key, categoryId, categoryName, categoryOrder, productId: productId || null,
          identityIssue: !productId, product, period: root.PortfolioFfsRoadmap.period(product), stage: root.PortfolioFfsRoadmap.status(product) }));
      }
    }
    Object.defineProperties(entries, {
      categories: { value: Object.freeze(categories), enumerable: false },
      duplicates: { value: Object.freeze(duplicates), enumerable: false },
    });
    return entries;
  }

  function validRange(range) {
    return Number.isInteger(range?.start) && Number.isInteger(range?.end) && range.end >= range.start
      && range.count === range.end - range.start + 1;
  }

  function categoryList(entries, declarations) {
    const categories = [], seen = new Set();
    for (const category of Array.isArray(declarations) ? declarations : []) {
      const id = sourceId(category?.id || category?.categoryId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      categories.push({ id, name: text(category.name || category.categoryName) || id, order: finite(category.order, categories.length) });
    }
    for (const entry of entries) {
      if (!entry?.categoryId || seen.has(entry.categoryId)) continue;
      seen.add(entry.categoryId);
      categories.push({ id: entry.categoryId, name: entry.categoryName || entry.categoryId, order: finite(entry.categoryOrder, categories.length) });
    }
    return categories.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  function glyphFor(items, track, lane, tracks, radius) {
    const entries = items.map(item => item.entry), memberKeys = entries.map(entry => entry.key);
    const stage = entries.every(entry => entry.stage === entries[0].stage) ? entries[0].stage : "mixed";
    const centerY = lane.y + lane.height * (track + 1) / (tracks + 1);
    const fullX = Math.min(...items.map(item => item.fullX));
    const fullRight = Math.max(...items.map(item => item.fullX + item.fullWidth));
    const x = Math.min(...items.map(item => item.x)), right = Math.max(...items.map(item => item.x + item.width));
    const group = items.length > 1;
    const type = group ? "group" : items[0].kind;
    const height = type === "window" ? Math.min(lane.height, 10, Math.max(3, lane.height * .3)) : Math.min(radius * 2, lane.height);
    return {
      type, x, width: Math.max(0, right - x), y: centerY - height / 2, height, centerY, laneHeight: lane.height,
      centerX: group ? (x + right) / 2 : items[0].centerX,
      fullX, fullWidth: fullRight - fullX, radius, track, stage, memberKeys, entries,
      start: entries.reduce((min, entry) => !min || entry.period.start < min ? entry.period.start : min, ""),
      end: entries.reduce((max, entry) => !max || entry.period.end > max ? entry.period.end : max, ""),
      clippedBefore: items.some(item => item.clippedBefore), clippedAfter: items.some(item => item.clippedAfter),
      countLabelX: (x + right) / 2,
      // Exact member shapes remain available when a dense group is opened or a member is highlighted.
      members: items.map(item => ({ key: item.entry.key, type: item.kind, x: item.x, width: item.width,
        fullX: item.fullX, fullWidth: item.fullWidth, centerX: item.centerX, period: item.entry.period,
        clippedBefore: item.clippedBefore, clippedAfter: item.clippedAfter })),
    };
  }

  function pack(items, lane, radius, gap) {
    if (!items.length) return [];
    const tracks = lane.height >= 42 ? 2 : 1;
    const sorted = [...items].sort((a, b) => a.visualX - b.visualX || a.visualRight - b.visualRight || a.entry.key.localeCompare(b.entry.key));
    const components = [];
    for (const item of sorted) {
      const last = components[components.length - 1];
      if (!last || item.visualX > last.right + gap) components.push({ items: [item], right: item.visualRight });
      else { last.items.push(item); last.right = Math.max(last.right, item.visualRight); }
    }
    const glyphs = [];
    for (const component of components) {
      const ends = Array(tracks).fill(-Infinity), assignments = [];
      let crowded = false;
      for (const item of component.items) {
        let track = ends.findIndex(end => item.visualX >= end + gap);
        if (track < 0) { crowded = true; break; }
        ends[track] = item.visualRight;
        assignments.push({ item, track });
      }
      if (crowded) glyphs.push(glyphFor(component.items, 0, lane, 1, radius));
      else for (const { item, track } of assignments) glyphs.push(glyphFor([item], track, lane, tracks, radius));
    }
    return glyphs;
  }

  function layout(sourceEntries, range, options = {}) {
    const entries = Array.isArray(sourceEntries) ? sourceEntries : [];
    const width = Math.max(0, finite(options.width, 960)), height = Math.max(0, finite(options.height, 640));
    const leftWidth = Math.min(width, Math.max(0, finite(options.leftWidth, 170)));
    const headerHeight = Math.min(height, Math.max(0, finite(options.headerHeight, 46)));
    const categories = categoryList(entries, options.categories || entries.categories);
    const laneHeight = categories.length ? Math.max(0, Math.min(finite(options.maxLaneHeight, 82), (height - headerHeight) / categories.length)) : 0;
    const horizonValid = validRange(range);
    const viewportStart = finite(options.viewportStart, horizonValid ? range.start : 0);
    const proposedEnd = finite(options.viewportEnd, horizonValid ? range.end + 1 : 1);
    const viewportEnd = proposedEnd > viewportStart ? proposedEnd : viewportStart + (horizonValid ? range.count : 1);
    const monthWidth = (width - leftWidth) / (viewportEnd - viewportStart);
    const shiftedLeft = horizonValid ? leftWidth - (viewportStart - range.start) * monthWidth : leftWidth;
    const entriesByKey = new Map(), glyphs = [], lanes = [];
    const counts = { total: 0, mapped: 0, visible: 0, missing: 0, outside: 0, offscreen: 0, groups: 0, identityIssues: 0 };
    const laneEntries = new Map(categories.map(category => [category.id, []]));
    for (const entry of entries) {
      if (!entry?.key || entriesByKey.has(entry.key) || !laneEntries.has(entry.categoryId)) continue;
      // The source object is never changed; current FFS evidence and declared lifecycle stage remain authoritative.
      const current = Object.freeze({ ...entry, period: root.PortfolioFfsRoadmap.period(entry.product), stage: root.PortfolioFfsRoadmap.status(entry.product) });
      entriesByKey.set(current.key, current);
      laneEntries.get(current.categoryId).push(current);
    }
    for (const [index, category] of categories.entries()) {
      const members = laneEntries.get(category.id), radius = Math.min(4.5, Math.max(1, laneHeight * .16), laneHeight / 2);
      const lane = { categoryId: category.id, name: category.name, y: headerHeight + index * laneHeight, height: laneHeight,
        count: members.length, mappedCount: 0, visibleCount: 0, missingCount: 0, outsideCount: 0, offscreenCount: 0,
        missingEntries: [], outsideEntries: [], offscreenEntries: [], glyphs: [] };
      const positioned = [];
      for (const entry of members) {
        counts.total += 1;
        if (entry.identityIssue) counts.identityIssues += 1;
        if (!entry.period) { lane.missingEntries.push(entry); counts.missing += 1; continue; }
        const geometry = horizonValid ? root.PortfolioFfsRoadmap.geometry(entry.product, range, 0,
          { leftWidth: monthWidth > 0 ? shiftedLeft : 0, monthWidth: monthWidth > 0 ? monthWidth : 1, rowHeight: 20 }) : null;
        if (!geometry) { lane.outsideEntries.push(entry); counts.outside += 1; continue; }
        lane.mappedCount += 1; counts.mapped += 1;
        const point = geometry.kind === "point";
        const fullX = point ? geometry.centerX : geometry.x;
        const fullWidth = point ? 0 : geometry.width;
        const fullRight = fullX + fullWidth;
        if (monthWidth <= 0 || (point ? geometry.centerX < leftWidth || geometry.centerX > width : fullRight <= leftWidth || fullX >= width)) {
          lane.offscreenEntries.push(entry); counts.offscreen += 1; continue;
        }
        const x = point ? geometry.centerX : Math.max(leftWidth, fullX);
        const right = point ? geometry.centerX : Math.min(width, fullRight);
        positioned.push({ entry, kind: geometry.kind, x, width: right - x, fullX, fullWidth, centerX: geometry.centerX,
          visualX: point ? x - radius : x, visualRight: point ? right + radius : right,
          clippedBefore: geometry.clippedBefore || !point && fullX < leftWidth,
          clippedAfter: geometry.clippedAfter || !point && fullRight > width });
        lane.visibleCount += 1; counts.visible += 1;
      }
      lane.missingCount = lane.missingEntries.length; lane.outsideCount = lane.outsideEntries.length; lane.offscreenCount = lane.offscreenEntries.length;
      lane.glyphs = pack(positioned, lane, radius, Math.max(4, finite(options.collisionGap, 14)));
      for (const glyph of lane.glyphs) {
        glyph.categoryId = category.id;
        if (glyph.type === "group") {
          const preferredRadius = Math.max(7.5, Math.min(10, glyph.entries.length >= 100 ? 10 : glyph.height / 2 + 2));
          glyph.badgeRadius = Math.min(preferredRadius, Math.max(0, lane.height / 2 - 1));
          const badgeLeft = leftWidth + glyph.badgeRadius + 2, badgeRight = width - glyph.badgeRadius - 2;
          // A count is a control, not a date: keep it visible while the member bracket remains exact.
          glyph.countLabelX = badgeRight < badgeLeft ? (leftWidth + width) / 2 : Math.max(badgeLeft, Math.min(badgeRight, glyph.countLabelX));
        }
        glyphs.push(glyph);
        if (glyph.type === "group") counts.groups += 1;
      }
      lanes.push(lane);
    }
    return { width, height, leftWidth, headerHeight, monthWidth, viewportStart, viewportEnd, laneHeight, lanes, glyphs, counts, entriesByKey,
      duplicates: entries.duplicates || [], rangeValid: horizonValid };
  }

  function radialLayout(totalValue, options = {}) {
    const total = Math.max(0, Math.floor(finite(totalValue, 0)));
    const width = Math.max(0, finite(options.width, 960)), height = Math.max(0, finite(options.height, 640));
    const leftWidth = Math.min(width, Math.max(0, finite(options.leftWidth, 166)));
    const headerHeight = Math.min(height, Math.max(0, finite(options.headerHeight, 46)));
    const targetSize = Math.max(1, finite(options.targetSize, 44)), gap = Math.max(0, finite(options.gap, 4));
    const padding = Math.max(0, finite(options.padding, 4)), halfTarget = targetSize / 2, spacing = targetSize + gap;
    const limit = Math.max(1, Math.floor(finite(options.maxVisible ?? options.maxItems, 12)));
    const anchor = { x: finite(options.anchor?.x, (leftWidth + width) / 2), y: finite(options.anchor?.y, (headerHeight + height) / 2) };
    const bounds = { left: leftWidth + padding + halfTarget, right: width - padding - halfTarget,
      top: headerHeight + padding + halfTarget, bottom: height - padding - halfTarget };
    const base = { total, anchor, targetSize, gap, padding, bounds };
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const result = (mode, radius, capacity, offsets, fit = true) => {
      const pageCount = capacity ? Math.ceil(total / capacity) : 0;
      const page = pageCount ? clamp(Math.floor(finite(options.page, 0)), 0, pageCount - 1) : 0;
      const startIndex = page * capacity, endIndex = Math.min(total, startIndex + capacity);
      const positions = offsets.slice(0, endIndex - startIndex).map((offset, index) => ({ index: startIndex + index, localIndex: index,
        x: anchor.x + offset.x, y: anchor.y + offset.y, angle: offset.angle ?? Math.atan2(offset.y, offset.x) }));
      return { ...base, mode, radius, capacity, pageSize: capacity, page, pageCount, startIndex, endIndex, center: { ...anchor },
        positions, slots: positions, showCenterControl: Boolean(capacity), fit, connector: null };
    };
    if (!total) return result("empty", 0, 0, []);
    if (bounds.left > bounds.right || bounds.top > bounds.bottom) return result("empty", 0, 0, [], false);
    const desired = Math.min(total, limit), tau = Math.PI * 2, epsilon = 1e-10;
    const centerTargetSize = Math.max(1, finite(options.centerTargetSize, targetSize));
    const minimumRadius = Math.max((targetSize + centerTargetSize) / 2 + gap, spacing / 2);
    const naturalRadius = Math.max(minimumRadius, desired > 1 ? spacing / (2 * Math.sin(Math.PI / desired)) : minimumRadius);
    const maximumRadius = Math.max(minimumRadius, Math.min(naturalRadius * 1.5, finite(options.maxRadius ?? options.preferredRadius, naturalRadius * 1.5)));
    const normalizeAngle = value => ((value % tau) + tau) % tau;
    const towardCenter = Math.atan2((bounds.top + bounds.bottom) / 2 - anchor.y, (bounds.left + bounds.right) / 2 - anchor.x);

    function intervalsAt(radius) {
      const cuts = [0, tau];
      for (const value of [(bounds.left - anchor.x) / radius, (bounds.right - anchor.x) / radius]) {
        if (value >= -1 && value <= 1) { const angle = Math.acos(value); cuts.push(angle, tau - angle); }
      }
      for (const value of [(bounds.top - anchor.y) / radius, (bounds.bottom - anchor.y) / radius]) {
        if (value >= -1 && value <= 1) { const angle = Math.asin(value); cuts.push(normalizeAngle(angle), normalizeAngle(Math.PI - angle)); }
      }
      const sorted = cuts.sort((a, b) => a - b).filter((value, index, values) => !index || value - values[index - 1] > epsilon);
      const allowed = angle => {
        const x = anchor.x + radius * Math.cos(angle), y = anchor.y + radius * Math.sin(angle);
        return x >= bounds.left - epsilon && x <= bounds.right + epsilon && y >= bounds.top - epsilon && y <= bounds.bottom + epsilon;
      };
      const intervals = [];
      for (let index = 1; index < sorted.length; index++) {
        const start = sorted[index - 1], end = sorted[index];
        if (!allowed((start + end) / 2)) continue;
        const last = intervals[intervals.length - 1];
        if (last && start - last.end < epsilon) last.end = end;
        else intervals.push({ start, end });
      }
      if (!intervals.length) for (const angle of sorted) if (allowed(angle)) intervals.push({ start: angle, end: angle });
      if (intervals.length > 1 && intervals[0].start < epsilon && tau - intervals[intervals.length - 1].end < epsilon) {
        const first = intervals.shift(), last = intervals.pop(); intervals.push({ start: last.start, end: first.end + tau });
      }
      return intervals;
    }

    function choiceAt(radius) {
      const delta = 2 * Math.asin(Math.min(1, spacing / (2 * radius)));
      const circleCapacity = Math.max(1, Math.floor(tau / delta + epsilon));
      const intervals = intervalsAt(radius);
      const choices = intervals.map(interval => {
        const length = interval.end - interval.start, full = length >= tau - epsilon;
        const capacity = Math.min(desired, circleCapacity, full ? circleCapacity : Math.floor(length / delta + epsilon) + 1);
        const middle = (interval.start + interval.end) / 2;
        const directionDistance = Math.abs(Math.atan2(Math.sin(middle - towardCenter), Math.cos(middle - towardCenter)));
        return { ...interval, radius, delta, full, capacity, directionDistance };
      });
      choices.sort((a, b) => b.capacity - a.capacity || (b.end - b.start) - (a.end - a.start) || a.directionDistance - b.directionDistance);
      let best = choices[0] || null;
      if (intervals.length > 1 && (!best || best.capacity < desired)) {
        const pieces = intervals.flatMap(interval => interval.end > tau
          ? [{ start: interval.start, end: tau }, { start: 0, end: interval.end - tau }] : [interval]);
        const seeds = pieces.flatMap(interval => [interval.start, interval.end, (interval.start + interval.end) / 2]);
        const direction = normalizeAngle(towardCenter);
        if (pieces.some(interval => direction >= interval.start && direction <= interval.end)) seeds.push(direction);
        for (const seedValue of seeds) {
          const seed = normalizeAngle(seedValue), angles = [seed], endLimit = seed + tau - delta;
          const extended = pieces.flatMap(interval => [interval, { start: interval.start + tau, end: interval.end + tau }]).sort((a, b) => a.start - b.start);
          while (angles.length < desired) {
            const minimum = angles[angles.length - 1] + delta;
            const segment = extended.find(interval => interval.end >= minimum - epsilon && Math.max(interval.start, minimum) <= Math.min(interval.end, endLimit) + epsilon);
            if (!segment) break;
            angles.push(Math.max(segment.start, minimum));
          }
          if (!best || angles.length > best.capacity) best = { radius, delta, full: false, capacity: angles.length, angles };
        }
      }
      return best;
    }

    // Search only a small, count-derived radius budget. Every accepted position is checked analytically against the viewport.
    const steps = 128, step = (maximumRadius - minimumRadius) / steps;
    let best = null, bracketLow = minimumRadius, bracketHigh = minimumRadius;
    for (let index = 0; index <= steps; index++) {
      const radius = minimumRadius + step * index, choice = choiceAt(radius);
      if (choice && (!best || choice.capacity > best.capacity)) {
        best = choice; bracketLow = Math.max(minimumRadius, radius - step); bracketHigh = radius;
        if (choice.capacity === desired) break;
      }
    }
    if (!best) return result("empty", minimumRadius, 0, [], false);
    for (let index = 0; index < 30 && bracketHigh - bracketLow > 1e-7; index++) {
      const radius = (bracketLow + bracketHigh) / 2, choice = choiceAt(radius);
      if (choice && choice.capacity >= best.capacity) { bracketHigh = radius; best = choice; }
      else bracketLow = radius;
    }
    const capacity = best.capacity, start = best.full ? -Math.PI / 2 : (best.start + best.end - best.delta * (capacity - 1)) / 2;
    const offsets = Array.from({ length: capacity }, (_, index) => {
      const angle = best.angles ? best.angles[index] : start + index * (best.full ? tau / capacity : best.delta);
      return { x: Math.cos(angle) * best.radius, y: Math.sin(angle) * best.radius, angle };
    });
    return result(best.full ? "circle" : "arc", best.radius, capacity, offsets);
  }

  function radial(anchor, options = {}) { return radialLayout(options.total, { ...options, anchor }); }

  root.PortfolioHashoutLayout = Object.freeze({ project, layout, compositeKey, radialLayout, radial });
})(globalThis);
