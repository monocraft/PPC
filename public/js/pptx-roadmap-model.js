(function registerRoadmapModel(globalObject) {
  "use strict";

const G = Object.freeze({
  width: 2560, height: 1440,
  plotX: 249.06, plotWidth: 2221.33,
  categoryX: 7, categoryWidth: 81.33,
  familyX: 87.06, familyWidth: 148,
  firstRowY: 212.23, rowStep: 45.067, barHeight: 38.4,
  maxRowUnits: 21, familyBoundaryGap: 1.333,
  tableX: 87.06, tableY: 212.23, tableWidth: 2383.33,
  tableHeaderHeight: 72, tableRowHeight: 62, maxTableProducts: 14,
  footerY: 1227,
});
const F = Object.freeze({
  body: 'HP Forma DJR Office',
  medium: 'HP Forma DJR Office Medium',
  narrow: 'Arial Narrow',
  black: 'Arial Black',
});
const C = Object.freeze({
  white: '#FFFFFF', label: '#BFBFBF', line: '#595959/35',
  familyBackground: '#808080/20', familyHeader: '#000000/25',
  category: '#0D0D0D', bar: '#595959/80',
  tableHeader: '#333538', tableOdd: '#595959/80', tableEven: '#4D5054/80',
  red: '#E94560',
});
const NONE = Object.freeze({ style: 'solid', fill: 'none', width: 0 });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = MONTHS.map(month => month.slice(0, 3));

function monthIndex(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  if (!match || +match[2] < 1 || +match[2] > 12) return null;
  return +match[1] * 12 + +match[2] - 1;
}

function indexMonth(index) {
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
}

function monthLabel(value) {
  const index = monthIndex(value);
  return index === null ? 'TBD' : `${SHORT_MONTHS[index % 12]} ${String(Math.floor(index / 12)).padStart(4, '0')}`;
}

function timelineLabel(timeline) {
  return `${monthLabel(timeline.startMonth)} – ${monthLabel(timeline.endMonth)}`;
}

// An intentionally generous width estimate for Arial Narrow. The label frame
// never relies on a short lifecycle bar's width, and fonts are never shrunk.
function measureConservative(text, fontSize) {
  let em = 0;
  for (const char of String(text)) {
    if (' ilI.,:;!\'`|'.includes(char)) em += 0.34;
    else if ('MW@#%&'.includes(char)) em += 0.9;
    else if (/[A-Z0-9]/.test(char)) em += 0.65;
    else if (/[^\x00-\x7f]/.test(char)) em += 0.95;
    else em += 0.6;
  }
  return em * fontSize * 1.06;
}

function wrapWords(text, width, fontSize) {
  const result = [];
  let line = '';
  for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || measureConservative(candidate, fontSize) <= width) {
      line = candidate;
    } else {
      result.push(line);
      line = word;
    }
    // Long tokens are split without deleting a single character.
    if (measureConservative(line, fontSize) > width) {
      let piece = '';
      for (const char of line) {
        if (piece && measureConservative(piece + char, fontSize) > width) {
          result.push(piece);
          piece = char;
        } else piece += char;
      }
      line = piece;
    }
  }
  if (line) result.push(line);
  return result.length ? result : [''];
}

function wrapFamilyForDisplay(value, measureText) {
  const content = String(value || '').toUpperCase();
  const width = G.familyWidth - 2;
  const fontSize = 64 / 3;
  const lines = [];
  let line = '';
  let previousEnd = 0;
  // Spaces and an existing slash are natural break opportunities. A slash stays
  // with its preceding word. Individual words are never split into fragments.
  for (const match of content.matchAll(/[^\s/]+\/?|\/+/g)) {
    const token = match[0];
    const separator = line ? content.slice(previousEnd, match.index) : '';
    const candidate = line + separator + token;
    if (line && measureText(candidate, fontSize, true) > width) {
      lines.push(line);
      line = token;
    } else line = candidate;
    if (measureText(token, fontSize, true) > width) {
      throw new Error(`A whole family word exceeds the reference column: ${token}`);
    }
    previousEnd = match.index + token.length;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function categoryStripHeight(categoryLabel, contentHeight, measureText) {
  const requiredLabelHeight = Math.ceil(measureText(String(categoryLabel).toUpperCase(), 112 / 3)) + 32;
  const height = Math.max(contentHeight, requiredLabelHeight, 128);
  if (!Number.isFinite(height) || height > G.footerY - G.tableY - 16) {
    throw new Error('The category label exceeds the roadmap body. Shorten the category label before exporting.');
  }
  return height;
}

function exactName(product, timeline) {
  const name = String(product.name || '');
  const price = timeline.showRoadmapMsrp ? String(product.nativeLifecycleProduct?.priceLabel || product.displayPrice || '') : '';
  return price ? `${name}  ${price}` : name;
}

function productStatus(product) {
  return String(product.statusLabel || product.lifecycleStatusLabel || product.nativeLifecycleProduct?.statusLabel || 'TBD');
}

function sourcePeriod(product, field) {
  const date = product.dates?.[field];
  if (!date || typeof date !== 'object') return 'TBD';
  const label = date.precisionPeriod?.label || date.precisionLabel;
  if (typeof label === 'string' && label.trim()) return label;
  const exact = validExactDate(Object.prototype.hasOwnProperty.call(date, 'raw') ? date.raw : date.validDate);
  return exact ? monthLabel(exact.slice(0, 7)) : 'TBD';
}

function productRows(products, timeline) {
  return products.map(product => {
    const label = exactName(product, timeline);
    const labelLines = wrapWords(label, G.plotWidth - 32, 24);
    const family = String(product.family || 'Other');
    return { product, family, label, labelLines, units: Math.max(1, Math.ceil((labelLines.length * 28.8 + 8) / G.rowStep)) };
  });
}

function familySegments(rows) {
  const result = [];
  for (const row of rows) {
    let segment = result.at(-1);
    if (!segment || segment.family !== row.family) {
      const lines = wrapWords(row.family.toUpperCase(), G.familyWidth - 20, 64 / 3);
      const minUnits = Math.max(1, Math.ceil((lines.length * 25.6 + 16) / G.rowStep));
      segment = { family: row.family, lines, minUnits, rows: [] };
      result.push(segment);
    }
    segment.rows.push(row);
  }
  return result;
}

function paginateDated(products, timeline) {
  const pages = [];
  let page = { segments: [], units: 0 };
  const flush = () => {
    if (page.segments.length) pages.push(page);
    page = { segments: [], units: 0 };
  };
  for (const family of familySegments(productRows(products, timeline))) {
    if (family.minUnits > G.maxRowUnits) throw new Error('The family label exceeds one roadmap page. Shorten the family label before exporting.');
    if (family.rows.some(row => row.units > G.maxRowUnits)) throw new Error('A product name exceeds one roadmap page. Shorten the product name before exporting.');
    let remaining = family.rows.slice();
    let continuation = false;
    while (remaining.length) {
      const available = G.maxRowUnits - page.units;
      if (available < family.minUnits || available < remaining[0].units) {
        flush();
        continue;
      }
      let take = 0;
      let rowUnits = 0;
      while (take < remaining.length && rowUnits + remaining[take].units <= available) {
        rowUnits += remaining[take].units;
        take += 1;
      }
      if (!take) throw new Error(`A single row exceeds the roadmap frame: ${remaining[0].product.id}`);
      const rows = remaining.splice(0, take);
      const units = Math.max(family.minUnits, rowUnits);
      const allocated = rows.map(row => ({ ...row }));
      // A long one-product family label may need more vertical room. Add that
      // space to its row frame, retaining the reference bar's 38.4 px height.
      allocated[allocated.length - 1].units += units - rowUnits;
      page.segments.push({ ...family, rows: allocated, units, continuation });
      page.units += units;
      continuation = true;
      if (remaining.length) flush();
    }
  }
  flush();
  return pages;
}

function chunks(values, length) {
  const result = [];
  for (let start = 0; start < values.length; start += length) result.push(values.slice(start, start + length));
  return result;
}

function outsideYearGroups(products, timeline) {
  const selectedStart = monthIndex(timeline.startMonth);
  const selectedEnd = monthIndex(timeline.endMonth);
  const dated = products.map(product => {
    const start = monthIndex(product.nativeLifecycleProduct?.startMonth);
    const end = monthIndex(product.nativeLifecycleProduct?.endMonth);
    if (start === null || end === null || end < start || !(end < selectedStart || start > selectedEnd)) {
      throw new Error(`Outside product has unusable lifecycle dates: ${product.id}`);
    }
    const direction = end < selectedStart ? 'before' : 'after';
    return { product, start, end, direction, year: Math.floor((direction === 'before' ? end : start) / 12) };
  });
  const result = [];
  for (const direction of ['before', 'after']) {
    const years = [...new Set(dated.filter(item => item.direction === direction).map(item => item.year))].sort((a, b) => a - b);
    let group;
    for (const year of years) {
      // Keep nearby years together without joining a long chain of distant eras.
      if (!group || year - group.firstYear > 1) {
        group = { direction, firstYear: year, lastYear: year };
        result.push(group);
      } else group.lastYear = year;
    }
  }
  return result.map(group => {
    // Filter the source order so the existing category/family ordering survives.
    const entries = dated.filter(item => item.direction === group.direction && item.year >= group.firstYear && item.year <= group.lastYear);
    const first = Math.min(...entries.map(item => item.start));
    const last = Math.max(...entries.map(item => item.end));
    return {
      periodGroup: `${group.direction}-${group.firstYear}-${group.lastYear}`,
      outsideDirection: group.direction, groupYearStart: group.firstYear, groupYearEnd: group.lastYear,
      products: entries.map(item => item.product),
      timeline: {
        startMonth: `${String(Math.floor(first / 12)).padStart(4, '0')}-01`, endMonth: `${String(Math.floor(last / 12)).padStart(4, '0')}-12`,
        showRoadmapMsrp: Boolean(timeline.showRoadmapMsrp),
      },
    };
  });
}

function planRoadmapContent(data) {
  if (!Array.isArray(data?.categories)) throw new Error('Expected data.categories.');
  const timeline = data.selectedTimeline;
  const start = monthIndex(timeline?.startMonth);
  const end = monthIndex(timeline?.endMonth);
  if (start === null || end === null || end < start) throw new Error('A valid selected monthly timeline is required.');
  const allProducts = data.categories.flatMap(category => category.products || []);
  const expectedIds = allProducts.map(product => String(product.id));
  if (expectedIds.some(id => !id) || new Set(expectedIds).size !== expectedIds.length) throw new Error('Input has duplicate or empty product IDs.');
  const slides = [];
  for (const category of data.categories) {
    const products = category.products || [];
    const dated = products.filter(product => product.lifecycleCoverage === 'inRange');
    const tbd = products.filter(product => product.lifecycleCoverage === 'tbd');
    const outside = products.filter(product => product.lifecycleCoverage === 'outsideRange');
    if (dated.length + tbd.length + outside.length !== products.length) throw new Error(`Unknown lifecycle coverage in ${category.id}.`);
    for (const product of dated) {
      const native = product.nativeLifecycleProduct;
      const productStart = monthIndex(native?.startMonth);
      const productEnd = monthIndex(native?.endMonth);
      if (productStart === null || productEnd === null || productEnd < productStart || productEnd < start || productStart > end) {
        throw new Error(`In-range product has unusable lifecycle dates: ${product.id}`);
      }
    }
    const add = (kind, section, entries, extra = {}) => slides.push({
      index: slides.length, categoryId: category.id, categoryName: category.name,
      categoryLabel: category.rawRoadmapSettings?.categoryLabel || category.name,
      kind, section, periodGroup: section, timeline,
      productIds: entries.map(entry => entry.id), products: entries, ...extra,
    });
    for (const page of paginateDated(dated, timeline)) {
      add('roadmap', 'dated', page.segments.flatMap(segment => segment.rows.map(row => row.product)), { page });
    }
    for (const group of outsideYearGroups(outside, timeline)) {
      for (const page of paginateDated(group.products, group.timeline)) {
        const entries = page.segments.flatMap(segment => segment.rows.map(row => row.product));
        const { products: groupedProducts, ...period } = group;
        add('outside', 'outside-range', entries, { ...period, page });
      }
    }
    for (const entries of chunks(tbd, G.maxTableProducts)) add('roadmap', 'dates-tbd', entries);
  }
  const seen = slides.flatMap(slide => slide.productIds);
  const counts = new Map();
  for (const id of seen) counts.set(id, (counts.get(id) || 0) + 1);
  const missingIds = expectedIds.filter(id => !counts.has(id));
  const duplicateIds = [...counts].filter(([, count]) => count !== 1).map(([id]) => id);
  const unexpectedIds = seen.filter(id => !expectedIds.includes(id));
  if (missingIds.length || duplicateIds.length || unexpectedIds.length) throw new Error('Coverage failure in native roadmap pagination.');
  const coverage = {
    expected: expectedIds.length, represented: seen.length, unique: counts.size,
    inRange: allProducts.filter(product => product.lifecycleCoverage === 'inRange').length,
    tbd: allProducts.filter(product => product.lifecycleCoverage === 'tbd').length,
    outsideRange: allProducts.filter(product => product.lifecycleCoverage === 'outsideRange').length,
    missingIds, duplicateIds, unexpectedIds,
  };
  return { slides, coverage, timeline, dimensions: { width: G.width, height: G.height } };
}

const clone = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
function validExactDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

// The app supplies only eligible visible records in its existing family order.
// Clone these facts without startup/schema helpers that could invent dates.
function project(sections, timeline) {
  if (!Array.isArray(sections)) throw new Error('Expected selected roadmap categories.');
  const first = monthIndex(timeline?.startMonth), last = monthIndex(timeline?.endMonth);
  if (first === null || last === null || last < first) throw new Error('A valid selected monthly timeline is required.');
  const selectedTimeline = { startMonth: timeline.startMonth, endMonth: timeline.endMonth, showRoadmapMsrp: Boolean(timeline.showRoadmapMsrp) };
  const categoryIds = new Set(), productIds = new Set();
  const categories = sections.map(source => {
    if (!source?.id || categoryIds.has(source.id) || !Array.isArray(source.products)) throw new Error('Selected categories must have distinct identities and product lists.');
    categoryIds.add(source.id);
    const section = clone(source);
    const products = section.products.map(sourceProduct => {
      if (!sourceProduct?.id || productIds.has(sourceProduct.id)) throw new Error('Selected products must have distinct identities; duplicate product found.');
      productIds.add(sourceProduct.id);
      const product = { ...sourceProduct };
      const nativeLifecycleProduct = {
        id: product.id, name: product.name, family: product.family || 'Other',
        startMonth: product.startMonth ?? '', endMonth: product.endMonth ?? '',
        fill: product.fill, textColor: product.textColor, statusLabel: product.statusLabel || '', priceLabel: product.priceLabel || '',
      };
      const start = monthIndex(nativeLifecycleProduct.startMonth), end = monthIndex(nativeLifecycleProduct.endMonth);
      const lifecycleCoverage = start === null || end === null || end < start ? 'tbd' : end < first || start > last ? 'outsideRange' : 'inRange';
      const dates = Object.fromEntries(Object.entries(product.dates || {}).map(([field, input]) => {
        const metadata = input && typeof input === 'object' && !Array.isArray(input) ? clone(input) : { raw: clone(input) };
        const raw = Object.prototype.hasOwnProperty.call(metadata, 'raw') ? metadata.raw : metadata.validDate;
        return [field, { ...metadata, validDate: validExactDate(raw) }];
      }));
      return { ...product, family: nativeLifecycleProduct.family, nativeLifecycleProduct, dates, lifecycleCoverage };
    });
    return { id: section.id, name: section.name || section.id, rawRoadmapSettings: { categoryLabel: section.categoryLabel || section.name || section.id }, products };
  });
  return { categories, selectedTimeline };
}

// The sticky category rail covers the viewport's left side. The remaining CSS
// pixels map to calendar coordinates, independent of backing-canvas density.
function visibleRoadmapPeriod({ startMonth, endMonth, scrollLeft, clientWidth, monthWidth, railWidth }) {
  const first = monthIndex(startMonth), last = monthIndex(endMonth);
  if (first === null || last === null || last < first || ![scrollLeft, clientWidth, monthWidth, railWidth].every(Number.isFinite) || monthWidth <= 0 || railWidth < 0 || clientWidth <= railWidth) return null;
  const left = Math.max(0, scrollLeft), right = left + clientWidth - railWidth;
  const start = first + Math.floor(left / monthWidth);
  const end = Math.min(last, first + Math.ceil(right / monthWidth) - 1);
  return start <= end ? { startMonth: indexMonth(start), endMonth: indexMonth(end) } : null;
}

// These assets contain advances and pair adjustments, never font binaries or
// outlines. A conservative em is reserved for each unsupported code point.
function createReferenceTextMeasurer(metrics) {
  if (metrics?.schemaVersion !== 1 || metrics.fontFamily !== F.narrow || !Number.isFinite(metrics.unitsPerEm) || metrics.unitsPerEm <= 0 || !metrics.faces?.regular?.advances || !metrics.faces?.bold?.advances || !metrics.faces.regular.kerning || !metrics.faces.bold.kerning) throw new Error('The reference font metrics are invalid. Reload and try exporting again.');
  return (value, fontSize, bold = false) => {
    const face = bold ? metrics.faces.bold : metrics.faces.regular;
    const chars = [...String(value)];
    let units = 0;
    for (let index = 0; index < chars.length; index += 1) {
      const advance = face.advances[chars[index]];
      units += Number.isFinite(advance) ? advance : metrics.unitsPerEm * 1.1;
      if (index && Number.isFinite(advance) && Number.isFinite(face.advances[chars[index - 1]])) units += face.kerning[chars[index - 1] + chars[index]] || 0;
    }
    return units * fontSize / metrics.unitsPerEm;
  };
}

  globalObject.PPTXRoadmapModel = Object.freeze({ project, planRoadmapContent, visibleRoadmapPeriod, createReferenceTextMeasurer, G, F, C, MONTHS, SHORT_MONTHS, monthIndex, indexMonth, monthLabel, measureConservative, wrapWords, wrapFamilyForDisplay, categoryStripHeight, exactName, productStatus, sourcePeriod, timelineLabel });
}(globalThis));
