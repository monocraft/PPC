(function installAscmImporter(globalObject) {
  "use strict";

  /**
   * Dependency-free ASCM workbook reader and portfolio matching helpers.
   *
   * The module intentionally treats every workbook value as inert data. It does
   * not evaluate formulas, macros, links, embedded objects, or workbook code.
   * In a browser it is exposed as `globalThis.ASCMImporter`. In Node (including
   * this repository's ESM configuration), import the file for its side effect
   * and then read the same global.
   */

  const API_VERSION = "1.0.0";

  const REQUIRED_HEADERS = Object.freeze({
    category: "Category",
    basePn: "Base PN",
    description: "GPG 40 char AMO Description",
    ga: "GA - General Availability",
    em: "EM - End of Manufacturing",
  });

  const OPTIONAL_HEADERS = Object.freeze({
    localFlag: Object.freeze(["Local (Y/N)", "Local / (Y/N)"]),
    localCode: Object.freeze(["Local Code"]),
    featureId: Object.freeze(["Feature ID"]),
    codeName: Object.freeze(["Code Name"]),
  });

  const DEFAULT_LIMITS = Object.freeze({
    maxFileBytes: 25 * 1024 * 1024,
    maxEntries: 2048,
    maxEntryUncompressedBytes: 64 * 1024 * 1024,
    maxTotalUncompressedBytes: 128 * 1024 * 1024,
    maxXmlChars: 64 * 1024 * 1024,
    maxSheets: 128,
    maxHeaderRows: 2000,
    maxRows: 100000,
    maxColumns: 4096,
    maxSharedStrings: 500000,
    maxCellChars: 32768,
  });

  const PORTFOLIO_CATEGORY_IDS = Object.freeze([
    "pc-gaming-audio",
    "console-gaming-audio",
    "lifestyle-audio",
    "audio-accessories",
    "microphones",
    "microphone-accessories",
    "keyboards",
    "mice",
    "accessories",
    "controllers",
    "backpacks",
  ]);

  // Every category observed in the supplied ASCM report is represented here.
  // Headset is resolved separately because console and PC products share it.
  const ASCM_CATEGORY_MAP = Object.freeze({
    "3d gamepad accessories": "controllers",
    audio: "audio-accessories",
    "bags and cases": "backpacks",
    badge: "accessories",
    earbuds: "lifestyle-audio",
    figurine: "accessories",
    "gaming controller": "controllers",
    "headset accessories": "audio-accessories",
    keyboard: "keyboards",
    "keyboard accessories": "accessories",
    "keyboard keycaps": "accessories",
    "keyboard wrist rest": "accessories",
    "metal plate": "accessories",
    microphone: "microphones",
    "microphone accessories": "microphone-accessories",
    mixer: "microphone-accessories",
    mouse: "mice",
    "mouse accessories": "accessories",
    "mouse pad": "accessories",
    "power bank": "controllers",
    switch: "accessories",
    webcam: "accessories",
  });

  const COLORS = Object.freeze({
    BK: Object.freeze({ canonicalCode: "BK", colorKey: "black", colorName: "Black", colorHex: "#111111" }),
    BLK: Object.freeze({ canonicalCode: "BK", colorKey: "black", colorName: "Black", colorHex: "#111111" }),
    BLACK: Object.freeze({ canonicalCode: "BK", colorKey: "black", colorName: "Black", colorHex: "#111111" }),
    RD: Object.freeze({ canonicalCode: "RED", colorKey: "red", colorName: "Red", colorHex: "#b72f3d" }),
    RED: Object.freeze({ canonicalCode: "RED", colorKey: "red", colorName: "Red", colorHex: "#b72f3d" }),
    WHT: Object.freeze({ canonicalCode: "WHT", colorKey: "white", colorName: "White", colorHex: "#f2f2f2" }),
    WT: Object.freeze({ canonicalCode: "WHT", colorKey: "white", colorName: "White", colorHex: "#f2f2f2" }),
    WHITE: Object.freeze({ canonicalCode: "WHT", colorKey: "white", colorName: "White", colorHex: "#f2f2f2" }),
    PNK: Object.freeze({ canonicalCode: "PNK", colorKey: "pink", colorName: "Pink", colorHex: "#c34d78" }),
    PINK: Object.freeze({ canonicalCode: "PNK", colorKey: "pink", colorName: "Pink", colorHex: "#c34d78" }),
    BLU: Object.freeze({ canonicalCode: "BLU", colorKey: "blue", colorName: "Blue", colorHex: "#2f6fa2" }),
    BLUE: Object.freeze({ canonicalCode: "BLU", colorKey: "blue", colorName: "Blue", colorHex: "#2f6fa2" }),
    LBLU: Object.freeze({ canonicalCode: "LBLU", colorKey: "custom", colorName: "Light Blue", colorHex: "#66aee8" }),
    LVR: Object.freeze({ canonicalCode: "LVR", colorKey: "lavender", colorName: "Lavender", colorHex: "#8d78aa" }),
    LAVENDER: Object.freeze({ canonicalCode: "LVR", colorKey: "lavender", colorName: "Lavender", colorHex: "#8d78aa" }),
    GRY: Object.freeze({ canonicalCode: "GRY", colorKey: "gray", colorName: "Gray", colorHex: "#707570" }),
    GY: Object.freeze({ canonicalCode: "GRY", colorKey: "gray", colorName: "Gray", colorHex: "#707570" }),
    GRAY: Object.freeze({ canonicalCode: "GRY", colorKey: "gray", colorName: "Gray", colorHex: "#707570" }),
    GREY: Object.freeze({ canonicalCode: "GRY", colorKey: "gray", colorName: "Gray", colorHex: "#707570" }),
    NV: Object.freeze({ canonicalCode: "NVY", colorKey: "navy", colorName: "Navy", colorHex: "#263d5b" }),
    NVB: Object.freeze({ canonicalCode: "NVY", colorKey: "navy", colorName: "Navy Blue", colorHex: "#263d5b" }),
    NVY: Object.freeze({ canonicalCode: "NVY", colorKey: "navy", colorName: "Navy", colorHex: "#263d5b" }),
    NAVY: Object.freeze({ canonicalCode: "NVY", colorKey: "navy", colorName: "Navy", colorHex: "#263d5b" }),
    NAVYBLUE: Object.freeze({ canonicalCode: "NVY", colorKey: "navy", colorName: "Navy Blue", colorHex: "#263d5b" }),
    SVR: Object.freeze({ canonicalCode: "SLV", colorKey: "silver", colorName: "Silver", colorHex: "#b7bcb7" }),
    SLV: Object.freeze({ canonicalCode: "SLV", colorKey: "silver", colorName: "Silver", colorHex: "#b7bcb7" }),
    SILVER: Object.freeze({ canonicalCode: "SLV", colorKey: "silver", colorName: "Silver", colorHex: "#b7bcb7" }),
    FRS: Object.freeze({ canonicalCode: "FRS", colorKey: "white", colorName: "Frost", colorHex: "#d9e4e8" }),
    FROST: Object.freeze({ canonicalCode: "FRS", colorKey: "white", colorName: "Frost", colorHex: "#d9e4e8" }),
    MULTI: Object.freeze({ canonicalCode: "MULTI", colorKey: "custom", colorName: "Multi", colorHex: "#777777" }),
    HXR: Object.freeze({ canonicalCode: "HXR", colorKey: "red", colorName: "HX Red", colorHex: "#b72f3d" }),
    HXBL: Object.freeze({ canonicalCode: "HXBL", colorKey: "blue", colorName: "HX Blue", colorHex: "#2f6fa2" }),
    HXAQ: Object.freeze({ canonicalCode: "HXAQ", colorKey: "cyan", colorName: "HX Aqua", colorHex: "#00a8d6" }),
    AQU: Object.freeze({ canonicalCode: "HXAQ", colorKey: "cyan", colorName: "HX Aqua", colorHex: "#00a8d6" }),
    AQUA: Object.freeze({ canonicalCode: "HXAQ", colorKey: "cyan", colorName: "HX Aqua", colorHex: "#00a8d6" }),
  });

  const CONCATENATED_COLOR_CODES = Object.freeze({
    BKBLU: Object.freeze(["BK", "BLU"]),
    BKLVR: Object.freeze(["BK", "LVR"]),
    BLKBLU: Object.freeze(["BLK", "BLU"]),
    BLKRED: Object.freeze(["BLK", "RED"]),
    GYRED: Object.freeze(["GY", "RED"]),
    GRYRED: Object.freeze(["GRY", "RED"]),
    WHBLU: Object.freeze(["WHT", "BLU"]),
    WHPNK: Object.freeze(["WHT", "PNK"]),
    WHTPNK: Object.freeze(["WHT", "PNK"]),
  });

  class AscmImportError extends Error {
    /** @param {string} code @param {string} message @param {object} [details] */
    constructor(code, message, details = {}) {
      super(message);
      this.name = "AscmImportError";
      this.code = code;
      this.details = details;
    }
  }

  function fail(code, message, details) {
    throw new AscmImportError(code, message, details);
  }

  function diagnostic(level, code, message, details = {}) {
    return { level, code, message, ...details };
  }

  function mergedLimits(overrides = {}) {
    const limits = { ...DEFAULT_LIMITS };
    for (const key of Object.keys(limits)) {
      if (overrides[key] == null) continue;
      const value = Number(overrides[key]);
      if (!Number.isFinite(value) || value <= 0) fail("INVALID_LIMIT", `Invalid ${key} limit.`);
      limits[key] = Math.floor(value);
    }
    return limits;
  }

  function cleanText(value) {
    return String(value == null ? "" : value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeHeader(value) {
    return cleanText(value).replace(/^\uFEFF/, "");
  }

  function normalizeBasePn(value) {
    return cleanText(value).toUpperCase().replace(/\s+/g, "");
  }

  function normalizeLocalFlag(value) {
    return cleanText(value).toUpperCase();
  }

  function decodeXml(value) {
    return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, body) => {
      const normalized = body.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      const codePoint = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return "\ufffd";
      try { return String.fromCodePoint(codePoint); } catch (_) { return "\ufffd"; }
    });
  }

  function assertSafeXml(xml, partName) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
      fail("UNSAFE_XML", `Unsupported XML declarations were found in ${partName}.`, { partName });
    }
  }

  function parseAttributes(source) {
    const attributes = Object.create(null);
    const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match;
    while ((match = pattern.exec(source || ""))) {
      attributes[match[1]] = decodeXml(match[2] == null ? match[3] : match[2]);
    }
    return attributes;
  }

  function attributeByLocalName(attributes, localName) {
    if (Object.prototype.hasOwnProperty.call(attributes, localName)) return attributes[localName];
    const key = Object.keys(attributes).find((name) => name.split(":").pop() === localName);
    return key ? attributes[key] : undefined;
  }

  function collectTextTags(xml) {
    let output = "";
    const pattern = /<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t\s*>/gi;
    let match;
    while ((match = pattern.exec(xml || ""))) output += decodeXml(match[1].replace(/<[^>]*>/g, ""));
    return output;
  }

  function firstTagValue(xml, tagName) {
    const safeName = String(tagName).replace(/[^A-Za-z0-9_-]/g, "");
    const pattern = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${safeName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${safeName}\\s*>`, "i");
    const match = pattern.exec(xml || "");
    return match ? decodeXml(match[1].replace(/<[^>]*>/g, "")) : "";
  }

  function columnIndexFromReference(reference) {
    const match = String(reference || "").match(/^([A-Z]+)\d+$/i);
    if (!match) return null;
    let value = 0;
    for (const character of match[1].toUpperCase()) value = value * 26 + character.charCodeAt(0) - 64;
    return value - 1;
  }

  function columnLabel(index) {
    let value = Number(index) + 1;
    if (!Number.isInteger(value) || value <= 0) return "";
    let label = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      value = Math.floor((value - 1) / 26);
    }
    return label;
  }

  function parseWorksheetCell(cellBody, attributes, sharedStrings, limits) {
    const type = attributes.t || "";
    let value;
    if (type === "inlineStr") value = collectTextTags(cellBody);
    else {
      const rawValue = firstTagValue(cellBody, "v");
      if (type === "s") {
        const index = Number.parseInt(rawValue, 10);
        if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
          fail("INVALID_SHARED_STRING", "A worksheet references an invalid shared-string index.", { index });
        }
        value = sharedStrings[index];
      } else if (type === "b") value = rawValue === "1" ? "Y" : rawValue === "0" ? "N" : rawValue;
      else value = rawValue;
    }
    value = String(value == null ? "" : value);
    if (value.length > limits.maxCellChars) fail("CELL_TOO_LARGE", "A worksheet cell exceeds the allowed text length.");
    return value;
  }

  function parseRowCells(rowBody, sharedStrings, limits, wantedColumns = null) {
    const cells = new Map();
    const cellPattern = /<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c\s*>)/gi;
    let match;
    let nextColumn = 0;
    while ((match = cellPattern.exec(rowBody || ""))) {
      const attributes = parseAttributes(match[1]);
      const referencedColumn = columnIndexFromReference(attributes.r);
      const column = referencedColumn == null ? nextColumn : referencedColumn;
      nextColumn = column + 1;
      if (column < 0 || column >= limits.maxColumns) {
        fail("TOO_MANY_COLUMNS", `The worksheet exceeds the ${limits.maxColumns}-column limit.`);
      }
      if (!wantedColumns || wantedColumns.has(column)) {
        cells.set(column, parseWorksheetCell(match[2] || "", attributes, sharedStrings, limits));
      }
    }
    return cells;
  }

  function rowNumberFromAttributes(attributes, fallback) {
    const number = Number.parseInt(attributes.r, 10);
    return Number.isInteger(number) && number > 0 ? number : fallback;
  }

  function requiredHeaderEntries() {
    return Object.entries(REQUIRED_HEADERS).map(([field, header]) => [field, normalizeHeader(header)]);
  }

  function optionalHeaderEntries() {
    return Object.entries(OPTIONAL_HEADERS).map(([field, aliases]) => [field, aliases.map(normalizeHeader)]);
  }

  /** Locate the exact ASCM header row in worksheet XML. */
  function findWorksheetHeader(xml, sharedStrings, limitOverrides = {}) {
    const limits = mergedLimits(limitOverrides);
    assertSafeXml(xml, "worksheet");
    const rowPattern = /<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row\s*>/gi;
    let match;
    let rowCount = 0;
    let fallbackRowNumber = 0;
    while ((match = rowPattern.exec(xml || ""))) {
      rowCount += 1;
      fallbackRowNumber += 1;
      if (rowCount > limits.maxHeaderRows) break;
      const rowAttributes = parseAttributes(match[1]);
      const rowNumber = rowNumberFromAttributes(rowAttributes, fallbackRowNumber);
      const cells = parseRowCells(match[2], sharedStrings, limits);
      const positions = new Map();
      for (const [column, value] of cells) {
        const header = normalizeHeader(value);
        if (!header) continue;
        if (!positions.has(header)) positions.set(header, []);
        positions.get(header).push(column);
      }
      if (!requiredHeaderEntries().every(([, header]) => positions.has(header))) continue;

      const fieldColumns = Object.create(null);
      const duplicateHeaders = [];
      for (const [field, header] of requiredHeaderEntries()) {
        const columns = positions.get(header);
        if (columns.length > 1) duplicateHeaders.push(header);
        fieldColumns[field] = columns[0];
      }
      for (const [field, aliases] of optionalHeaderEntries()) {
        const alias = aliases.find((candidate) => positions.has(candidate));
        if (alias) fieldColumns[field] = positions.get(alias)[0];
      }
      return {
        rowNumber,
        rowOrdinal: rowCount,
        fieldColumns,
        duplicateHeaders,
        headers: Object.fromEntries(Object.entries(fieldColumns).map(([field, column]) => [field, {
          name: normalizeHeader(cells.get(column)),
          column: columnLabel(column),
          columnIndex: column,
        }])),
      };
    }
    return null;
  }

  function parseSharedStrings(xml, limitOverrides = {}) {
    const limits = mergedLimits(limitOverrides);
    if (!xml) return [];
    assertSafeXml(xml, "sharedStrings.xml");
    const strings = [];
    const pattern = /<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si\s*>/gi;
    let match;
    while ((match = pattern.exec(xml))) {
      if (strings.length >= limits.maxSharedStrings) {
        fail("TOO_MANY_SHARED_STRINGS", `The workbook exceeds the ${limits.maxSharedStrings}-string limit.`);
      }
      const value = collectTextTags(match[1]);
      if (value.length > limits.maxCellChars) fail("CELL_TOO_LARGE", "A shared string exceeds the allowed text length.");
      strings.push(value);
    }
    return strings;
  }

  function parseExcelDate(value, date1904 = false) {
    if (value == null || cleanText(value) === "") return "";
    const text = cleanText(value);
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (isoMatch) {
      const year = Number(isoMatch[1]);
      const month = Number(isoMatch[2]);
      const day = Number(isoMatch[3]);
      const check = new Date(Date.UTC(year, month - 1, day));
      if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return "";
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }
    const number = Number(text);
    if (!Number.isFinite(number) || number < 0 || number > 2958465) return "";
    // Excel's 1900 system includes its historic fictitious leap day. The
    // 1899-12-30 epoch reproduces modern Excel dates; serial 60 is normalized
    // to 1900-02-28 because JavaScript cannot represent 1900-02-29.
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const wholeDays = Math.floor(number);
    const date = new Date(epoch + wholeDays * 86400000);
    if (!Number.isFinite(date.getTime())) return "";
    return `${date.getUTCFullYear().toString().padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function parseExcelDateTime(value, date1904 = false) {
    const text = cleanText(value);
    if (!text) return "";
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 2958465) {
      const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
      const milliseconds = epoch + Math.round(numeric * 86400000);
      const date = new Date(milliseconds);
      if (!Number.isFinite(date.getTime())) return "";
      const datePart = `${date.getUTCFullYear().toString().padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      const seconds = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
      return seconds
        ? `${datePart}T${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}:${String(date.getUTCSeconds()).padStart(2, "0")}`
        : datePart;
    }
    const isoDate = parseExcelDate(text, date1904);
    if (isoDate && /^\d{4}-\d{2}-\d{2}$/.test(text)) return isoDate;
    const isoDateTime = text.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i);
    if (isoDateTime) {
      if (isoDateTime[7]) {
        const parsed = new Date(text);
        return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
      }
      const datePart = parseExcelDate(`${isoDateTime[1]}-${isoDateTime[2]}-${isoDateTime[3]}`, date1904);
      const hours = Number(isoDateTime[4]);
      const minutes = Number(isoDateTime[5]);
      const seconds = Number(isoDateTime[6] || 0);
      if (!datePart || hours > 23 || minutes > 59 || seconds > 59) return "";
      return `${datePart}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    const usDateTime = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
    if (usDateTime) {
      const datePart = parseExcelDate(`${usDateTime[3]}-${String(usDateTime[1]).padStart(2, "0")}-${String(usDateTime[2]).padStart(2, "0")}`, date1904);
      if (!datePart) return "";
      if (usDateTime[4] == null) return datePart;
      let hours = Number(usDateTime[4]);
      const minutes = Number(usDateTime[5]);
      const seconds = Number(usDateTime[6] || 0);
      const meridiem = String(usDateTime[7] || "").toUpperCase();
      if (meridiem) {
        if (hours < 1 || hours > 12) return "";
        if (meridiem === "AM" && hours === 12) hours = 0;
        if (meridiem === "PM" && hours !== 12) hours += 12;
      }
      if (hours > 23 || minutes > 59 || seconds > 59) return "";
      return `${datePart}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return "";
  }

  function findWorksheetExportedAt(xml, sharedStrings, date1904, headerRow, limitOverrides = {}) {
    const limits = mergedLimits(limitOverrides);
    const rowPattern = /<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row\s*>/gi;
    let match;
    let fallbackRowNumber = 0;
    while ((match = rowPattern.exec(xml || ""))) {
      fallbackRowNumber += 1;
      const rowNumber = rowNumberFromAttributes(parseAttributes(match[1]), fallbackRowNumber);
      if (rowNumber >= headerRow || fallbackRowNumber > Math.min(limits.maxHeaderRows, 200)) break;
      const cells = parseRowCells(match[2], sharedStrings, limits);
      for (const [column, value] of cells) {
        if (!/^exported\s*:?$/i.test(cleanText(value))) continue;
        return parseExcelDateTime(cells.get(column + 1), date1904);
      }
    }
    return "";
  }

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        crcTable[index] = value >>> 0;
      }
    }
    let value = 0xffffffff;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }

  function readUint16(view, offset, label) {
    if (offset < 0 || offset + 2 > view.byteLength) fail("TRUNCATED_ZIP", `The XLSX ZIP is truncated while reading ${label}.`);
    return view.getUint16(offset, true);
  }

  function readUint32(view, offset, label) {
    if (offset < 0 || offset + 4 > view.byteLength) fail("TRUNCATED_ZIP", `The XLSX ZIP is truncated while reading ${label}.`);
    return view.getUint32(offset, true);
  }

  function normalizeZipEntryName(name) {
    const value = String(name || "");
    if (!value || value.includes("\0") || value.includes("\\") || /^\/|^[A-Za-z]:/.test(value)) {
      fail("UNSAFE_ZIP_PATH", "The XLSX ZIP contains an unsafe entry path.", { name: value });
    }
    const parts = value.split("/");
    if (parts.some((part) => part === ".." || part === ".")) {
      fail("UNSAFE_ZIP_PATH", "The XLSX ZIP contains a traversal path.", { name: value });
    }
    return parts.filter(Boolean).join("/");
  }

  function resolveZipTarget(baseFile, target) {
    let value = decodeXml(String(target || "")).split(/[?#]/, 1)[0];
    try { value = decodeURIComponent(value); } catch (_) {}
    const baseParts = value.startsWith("/") ? [] : String(baseFile || "").split("/").slice(0, -1);
    const targetParts = value.replace(/^\/+/, "").split("/");
    const output = [...baseParts];
    for (const part of targetParts) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!output.length) fail("UNSAFE_RELATIONSHIP", "A workbook relationship escapes the XLSX package root.", { target });
        output.pop();
      } else output.push(part);
    }
    return normalizeZipEntryName(output.join("/"));
  }

  function findEndOfCentralDirectory(bytes) {
    if (bytes.length < 22) return -1;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const minimum = Math.max(0, bytes.length - 65557);
    for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    return -1;
  }

  async function inflateRaw(compressedBytes, expectedSize, maximumSize) {
    if (typeof globalObject.DecompressionStream !== "function") {
      fail("DEFLATE_UNAVAILABLE", "This environment cannot decompress ordinary XLSX files because DecompressionStream is unavailable.");
    }
    let stream;
    try {
      stream = new Blob([compressedBytes]).stream().pipeThrough(new globalObject.DecompressionStream("deflate-raw"));
    } catch (error) {
      fail("DEFLATE_UNAVAILABLE", "This environment does not support raw DEFLATE streams required by XLSX files.", { cause: String(error?.message || error) });
    }
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.length;
        if (total > maximumSize || total > expectedSize) {
          try { await reader.cancel(); } catch (_) {}
          fail("DECOMPRESSION_LIMIT", "An XLSX entry expands beyond its declared or allowed size.", { expectedSize, maximumSize });
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof AscmImportError) throw error;
      fail("DEFLATE_FAILED", "An XLSX ZIP entry could not be decompressed.", { cause: String(error?.message || error) });
    }
    if (total !== expectedSize) fail("SIZE_MISMATCH", "An XLSX ZIP entry did not match its declared uncompressed size.", { expectedSize, actualSize: total });
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  }

  async function inputBytes(input, limits) {
    const declaredSize = Number(input?.size);
    if (Number.isFinite(declaredSize) && declaredSize > limits.maxFileBytes) {
      fail("FILE_TOO_LARGE", `The selected file exceeds the ${limits.maxFileBytes}-byte limit.`, { size: declaredSize });
    }
    let bytes;
    if (input instanceof Uint8Array) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
    else if (input && typeof input.arrayBuffer === "function") bytes = new Uint8Array(await input.arrayBuffer());
    else fail("INVALID_INPUT", "Expected a File, Blob, ArrayBuffer, or Uint8Array containing an XLSX workbook.");
    if (bytes.length > limits.maxFileBytes) fail("FILE_TOO_LARGE", `The selected file exceeds the ${limits.maxFileBytes}-byte limit.`, { size: bytes.length });
    return bytes;
  }

  /**
   * Open an XLSX ZIP without extracting files to disk. Stored entries and raw
   * DEFLATE entries are supported; encrypted and ZIP64 packages are rejected.
   */
  async function openZip(input, limitOverrides = {}) {
    const limits = mergedLimits(limitOverrides);
    const bytes = await inputBytes(input, limits);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const endOffset = findEndOfCentralDirectory(bytes);
    if (endOffset < 0) fail("NOT_ZIP", "The selected file is not a supported XLSX ZIP package.");
    const diskNumber = readUint16(view, endOffset + 4, "ZIP disk number");
    const centralDisk = readUint16(view, endOffset + 6, "central-directory disk number");
    const entriesOnDisk = readUint16(view, endOffset + 8, "entry count");
    const entryCount = readUint16(view, endOffset + 10, "entry count");
    const centralSize = readUint32(view, endOffset + 12, "central-directory size");
    const centralOffset = readUint32(view, endOffset + 16, "central-directory offset");
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) fail("MULTI_DISK_ZIP", "Multi-disk XLSX ZIP files are unsupported.");
    if (entryCount === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) fail("ZIP64_UNSUPPORTED", "ZIP64 XLSX files are unsupported.");
    if (entryCount > limits.maxEntries) fail("TOO_MANY_ENTRIES", `The XLSX package exceeds the ${limits.maxEntries}-entry limit.`);
    if (centralOffset + centralSize > endOffset || centralOffset < 0) fail("INVALID_ZIP_DIRECTORY", "The XLSX ZIP central directory is invalid.");

    const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
    const entries = new Map();
    let offset = centralOffset;
    let totalUncompressed = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (readUint32(view, offset, "central-directory signature") !== 0x02014b50) fail("INVALID_ZIP_DIRECTORY", "The XLSX ZIP central directory is damaged.");
      const flags = readUint16(view, offset + 8, "ZIP flags");
      const method = readUint16(view, offset + 10, "compression method");
      const checksum = readUint32(view, offset + 16, "CRC-32");
      const compressedSize = readUint32(view, offset + 20, "compressed size");
      const uncompressedSize = readUint32(view, offset + 24, "uncompressed size");
      const nameLength = readUint16(view, offset + 28, "entry-name length");
      const extraLength = readUint16(view, offset + 30, "extra-field length");
      const commentLength = readUint16(view, offset + 32, "entry-comment length");
      const localOffset = readUint32(view, offset + 42, "local-header offset");
      const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
      if (recordEnd > centralOffset + centralSize) fail("TRUNCATED_ZIP", "The XLSX ZIP central directory is truncated.");
      if (flags & 0x0001) fail("ENCRYPTED_ZIP", "Encrypted XLSX files are unsupported.");
      if (![0, 8].includes(method)) fail("UNSUPPORTED_COMPRESSION", `ZIP compression method ${method} is unsupported.`);
      if ([compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) fail("ZIP64_UNSUPPORTED", "ZIP64 XLSX entries are unsupported.");
      if (uncompressedSize > limits.maxEntryUncompressedBytes) fail("ENTRY_TOO_LARGE", "An XLSX entry exceeds the uncompressed-size limit.");
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > limits.maxTotalUncompressedBytes) fail("WORKBOOK_TOO_LARGE", "The XLSX package exceeds the total uncompressed-size limit.");
      const rawName = utf8Decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      const name = normalizeZipEntryName(rawName);
      if (entries.has(name)) fail("DUPLICATE_ZIP_ENTRY", "The XLSX ZIP contains duplicate entry paths.", { name });
      entries.set(name, { name, flags, method, checksum, compressedSize, uncompressedSize, localOffset, cache: null });
      offset = recordEnd;
    }

    async function getBytes(name) {
      const normalizedName = normalizeZipEntryName(name);
      const entry = entries.get(normalizedName);
      if (!entry) return null;
      if (entry.cache) return entry.cache;
      const localOffset = entry.localOffset;
      if (readUint32(view, localOffset, "local-header signature") !== 0x04034b50) fail("INVALID_LOCAL_HEADER", "An XLSX ZIP local header is damaged.", { name: normalizedName });
      const localFlags = readUint16(view, localOffset + 6, "local flags");
      const localMethod = readUint16(view, localOffset + 8, "local compression method");
      const localNameLength = readUint16(view, localOffset + 26, "local name length");
      const localExtraLength = readUint16(view, localOffset + 28, "local extra length");
      if (localFlags & 0x0001) fail("ENCRYPTED_ZIP", "Encrypted XLSX files are unsupported.");
      if (localMethod !== entry.method) fail("ZIP_METHOD_MISMATCH", "An XLSX ZIP entry has conflicting compression metadata.");
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataOffset + entry.compressedSize;
      if (dataEnd > bytes.length || dataOffset < 0) fail("TRUNCATED_ZIP", "An XLSX ZIP entry is truncated.", { name: normalizedName });
      const compressed = bytes.subarray(dataOffset, dataEnd);
      let output;
      if (entry.method === 0) {
        if (entry.compressedSize !== entry.uncompressedSize) fail("SIZE_MISMATCH", "A stored XLSX entry has inconsistent sizes.");
        output = new Uint8Array(compressed);
      } else {
        output = await inflateRaw(compressed, entry.uncompressedSize, limits.maxEntryUncompressedBytes);
      }
      if (crc32(output) !== entry.checksum) fail("CRC_MISMATCH", "An XLSX ZIP entry failed its integrity check.", { name: normalizedName });
      entry.cache = output;
      return output;
    }

    async function getText(name) {
      const entryBytes = await getBytes(name);
      if (entryBytes == null) return null;
      const text = utf8Decoder.decode(entryBytes);
      if (text.length > limits.maxXmlChars) fail("XML_TOO_LARGE", "An XLSX XML part exceeds the allowed text size.", { name });
      return text;
    }

    return Object.freeze({
      size: bytes.length,
      entryCount: entries.size,
      totalUncompressedBytes: totalUncompressed,
      has: (name) => entries.has(normalizeZipEntryName(name)),
      names: () => [...entries.keys()],
      getBytes,
      getText,
    });
  }

  function parseRelationships(xml, partName) {
    assertSafeXml(xml, partName);
    const relationships = new Map();
    const pattern = /<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*?)(?:\/\s*>|>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?Relationship\s*>)/gi;
    let match;
    while ((match = pattern.exec(xml || ""))) {
      const attributes = parseAttributes(match[1]);
      if (!attributes.Id || !attributes.Target || String(attributes.TargetMode || "").toLowerCase() === "external") continue;
      relationships.set(attributes.Id, { id: attributes.Id, target: attributes.Target, type: attributes.Type || "" });
    }
    return relationships;
  }

  function relationshipPartPath(partPath) {
    const parts = String(partPath).split("/");
    const filename = parts.pop();
    return [...parts, "_rels", `${filename}.rels`].join("/");
  }

  async function locateWorkbookPath(zip) {
    if (zip.has("xl/workbook.xml")) return "xl/workbook.xml";
    const rootRelationships = await zip.getText("_rels/.rels");
    if (!rootRelationships) fail("MISSING_WORKBOOK", "The XLSX package does not contain xl/workbook.xml.");
    const relationship = [...parseRelationships(rootRelationships, "_rels/.rels").values()]
      .find((item) => /\/officeDocument$/i.test(item.type));
    if (!relationship) fail("MISSING_WORKBOOK", "The XLSX package has no workbook relationship.");
    // `_rels/.rels` describes the package root, so its targets are resolved
    // from `/`, not from the physical `_rels` directory that stores the part.
    const path = resolveZipTarget("", relationship.target);
    if (!zip.has(path)) fail("MISSING_WORKBOOK", "The workbook relationship points to a missing XML part.", { path });
    return path;
  }

  function parseWorkbookSheets(xml, relationships, workbookPath, limits) {
    assertSafeXml(xml, workbookPath);
    const sheets = [];
    const pattern = /<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*?)(?:\/\s*>|>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?sheet\s*>)/gi;
    let match;
    while ((match = pattern.exec(xml || ""))) {
      if (sheets.length >= limits.maxSheets) fail("TOO_MANY_SHEETS", `The workbook exceeds the ${limits.maxSheets}-sheet limit.`);
      const attributes = parseAttributes(match[1]);
      const relationshipId = attributeByLocalName(attributes, "id");
      const relationship = relationships.get(relationshipId);
      if (!relationship || !/\/worksheet$/i.test(relationship.type)) continue;
      sheets.push({
        name: cleanText(attributes.name) || `Sheet ${sheets.length + 1}`,
        sheetId: String(attributes.sheetId || ""),
        relationshipId,
        path: resolveZipTarget(workbookPath, relationship.target),
      });
    }
    return sheets;
  }

  function extractAscmRows(xml, sharedStrings, header, date1904, limits, diagnostics) {
    assertSafeXml(xml, "worksheet");
    const wantedColumns = new Set(Object.values(header.fieldColumns));
    const rowPattern = /<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row\s*>/gi;
    const retained = new Map();
    let match;
    let fallbackRowNumber = 0;
    let rowElements = 0;
    let sourceDataRows = 0;
    let localizedRowsFiltered = 0;
    let invalidLocalRowsFiltered = 0;
    let invalidRowsFiltered = 0;
    let duplicateBasePnRows = 0;
    while ((match = rowPattern.exec(xml || ""))) {
      rowElements += 1;
      fallbackRowNumber += 1;
      if (rowElements > limits.maxRows) fail("TOO_MANY_ROWS", `The worksheet exceeds the ${limits.maxRows}-row limit.`);
      const rowAttributes = parseAttributes(match[1]);
      const sourceRow = rowNumberFromAttributes(rowAttributes, fallbackRowNumber);
      if (sourceRow <= header.rowNumber) continue;
      const cells = parseRowCells(match[2], sharedStrings, limits, wantedColumns);
      const fieldValue = (field) => cells.get(header.fieldColumns[field]) ?? "";
      const values = Object.values(header.fieldColumns).map((column) => cleanText(cells.get(column) || ""));
      if (!values.some(Boolean)) continue;
      sourceDataRows += 1;

      const localFlag = header.fieldColumns.localFlag == null ? "" : normalizeLocalFlag(fieldValue("localFlag"));
      const localCode = header.fieldColumns.localCode == null ? "" : cleanText(fieldValue("localCode"));
      if ((header.fieldColumns.localCode != null && localCode)
        || (header.fieldColumns.localCode == null && header.fieldColumns.localFlag != null && !localFlag)) {
        localizedRowsFiltered += 1;
        continue;
      }
      if (header.fieldColumns.localFlag != null && localFlag && !["Y", "N"].includes(localFlag)) {
        invalidLocalRowsFiltered += 1;
        diagnostics.push(diagnostic("warning", "INVALID_LOCAL_FLAG", "A row was skipped because Local (Y/N) was neither Y nor N.", { sourceRow, value: cleanText(fieldValue("localFlag")) }));
        continue;
      }

      const category = cleanText(fieldValue("category"));
      const basePnRaw = cleanText(fieldValue("basePn"));
      const basePn = normalizeBasePn(basePnRaw);
      const description = cleanText(fieldValue("description"));
      const ga = parseExcelDate(fieldValue("ga"), date1904);
      const em = parseExcelDate(fieldValue("em"), date1904);
      const featureId = header.fieldColumns.featureId == null ? "" : cleanText(fieldValue("featureId"));
      const codeName = header.fieldColumns.codeName == null ? "" : cleanText(fieldValue("codeName"));
      const missing = [];
      if (!category) missing.push(REQUIRED_HEADERS.category);
      if (!basePn) missing.push(REQUIRED_HEADERS.basePn);
      if (!description) missing.push(REQUIRED_HEADERS.description);
      if (!cleanText(fieldValue("ga")) || !ga) missing.push(REQUIRED_HEADERS.ga);
      if (!cleanText(fieldValue("em")) || !em) missing.push(REQUIRED_HEADERS.em);
      if (missing.length) {
        invalidRowsFiltered += 1;
        diagnostics.push(diagnostic("error", "INVALID_REQUIRED_VALUE", "A row was skipped because required values were blank or invalid.", { sourceRow, basePn: basePn || basePnRaw, fields: missing }));
        continue;
      }
      if (!/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(basePn)) {
        invalidRowsFiltered += 1;
        diagnostics.push(diagnostic("error", "INVALID_BASE_PN", "A row was skipped because Base PN has an unsupported format.", { sourceRow, basePn: basePnRaw }));
        continue;
      }
      const row = { sourceRow, category, featureId, basePn, basePnRaw, localFlag, localCode, description, codeName, ga, em };
      const existing = retained.get(basePn);
      if (existing) {
        duplicateBasePnRows += 1;
        diagnostics.push(diagnostic("warning", "DUPLICATE_BASE_PN", "A duplicate Base PN row was ignored; the earliest valid primary row was retained.", {
          sourceRow,
          retainedSourceRow: existing.sourceRow,
          basePn,
        }));
        continue;
      }
      retained.set(basePn, row);
    }
    return {
      rows: [...retained.values()].sort((left, right) => left.sourceRow - right.sourceRow || left.basePn.localeCompare(right.basePn)),
      counts: { sourceDataRows, localizedRowsFiltered, invalidLocalRowsFiltered, invalidRowsFiltered, duplicateBasePnRows },
    };
  }

  /**
   * Parse an ASCM .xlsx file and return normalized primary rows, source
   * metadata, and non-fatal row diagnostics.
   *
   * @param {File|Blob|ArrayBuffer|Uint8Array} input
   * @param {{limits?: object}} [options]
   * @returns {Promise<{version:number, rows:Array, metadata:object, diagnostics:Array}>}
   */
  async function parseAscmWorkbook(input, options = {}) {
    const limits = mergedLimits(options.limits || {});
    const zip = await openZip(input, limits);
    const contentTypes = await zip.getText("[Content_Types].xml");
    if (!contentTypes) fail("MISSING_CONTENT_TYPES", "The selected ZIP is not an ordinary XLSX workbook.");
    assertSafeXml(contentTypes, "[Content_Types].xml");
    if (/macroEnabled/i.test(contentTypes)) fail("MACRO_WORKBOOK_UNSUPPORTED", "Macro-enabled Excel workbooks are unsupported; use an ordinary .xlsx report.");
    if (!/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet\.main\+xml/i.test(contentTypes)) {
      fail("UNSUPPORTED_WORKBOOK_TYPE", "The selected package is not an ordinary .xlsx workbook.");
    }

    const workbookPath = await locateWorkbookPath(zip);
    const workbookXml = await zip.getText(workbookPath);
    if (!workbookXml) fail("MISSING_WORKBOOK", "The XLSX workbook XML is missing.");
    assertSafeXml(workbookXml, workbookPath);
    const workbookRelationshipsPath = relationshipPartPath(workbookPath);
    const relationshipsXml = await zip.getText(workbookRelationshipsPath);
    if (!relationshipsXml) fail("MISSING_RELATIONSHIPS", "The XLSX workbook relationships are missing.");
    const relationships = parseRelationships(relationshipsXml, workbookRelationshipsPath);
    const sheets = parseWorkbookSheets(workbookXml, relationships, workbookPath, limits);
    if (!sheets.length) fail("NO_WORKSHEETS", "The workbook contains no readable worksheets.");
    const sharedRelationship = [...relationships.values()].find((item) => /\/sharedStrings$/i.test(item.type));
    const defaultSharedPath = resolveZipTarget(workbookPath, "sharedStrings.xml");
    const sharedPath = sharedRelationship ? resolveZipTarget(workbookPath, sharedRelationship.target) : defaultSharedPath;
    const sharedXml = zip.has(sharedPath) ? await zip.getText(sharedPath) : "";
    const sharedStrings = parseSharedStrings(sharedXml || "", limits);
    const date1904 = /<(?:[A-Za-z_][\w.-]*:)?workbookPr\b[^>]*\bdate1904\s*=\s*["'](?:1|true)["']/i.test(workbookXml);
    const diagnostics = [];
    const candidates = [];

    for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
      const sheet = sheets[sheetIndex];
      if (!zip.has(sheet.path)) fail("MISSING_WORKSHEET", "A workbook relationship points to a missing worksheet.", { sheetName: sheet.name, path: sheet.path });
      const xml = await zip.getText(sheet.path);
      const header = findWorksheetHeader(xml, sharedStrings, limits);
      if (!header) continue;
      if (header.duplicateHeaders.length) {
        fail("DUPLICATE_REQUIRED_HEADER", "The ASCM header row contains duplicate required columns.", {
          sheetName: sheet.name,
          row: header.rowNumber,
          headers: header.duplicateHeaders,
        });
      }
      candidates.push({ sheet, sheetIndex, xml, header });
    }
    if (!candidates.length) {
      fail("ASCM_HEADERS_NOT_FOUND", "No worksheet contains all required ASCM headers.", { requiredHeaders: Object.values(REQUIRED_HEADERS) });
    }
    if (candidates.length > 1) {
      diagnostics.push(diagnostic("warning", "MULTIPLE_ASCM_SHEETS", "Multiple worksheets contain the ASCM headers; the first workbook-order sheet was used.", {
        sheets: candidates.map((candidate) => candidate.sheet.name),
      }));
    }
    const selected = candidates[0];
    const exportedAt = findWorksheetExportedAt(selected.xml, sharedStrings, date1904, selected.header.rowNumber, limits);
    const extracted = extractAscmRows(selected.xml, sharedStrings, selected.header, date1904, limits, diagnostics);
    if (!extracted.rows.length) fail("NO_PRIMARY_ROWS", "The ASCM worksheet contains no valid primary product rows.", { sheetName: selected.sheet.name });

    return {
      version: 1,
      rows: extracted.rows,
      metadata: {
        fileName: cleanText(input?.name) || "workbook.xlsx",
        fileBytes: zip.size,
        zipEntries: zip.entryCount,
        uncompressedBytes: zip.totalUncompressedBytes,
        workbookPath,
        exportedAt,
        dateSystem: date1904 ? "1904" : "1900",
        worksheetCount: sheets.length,
        sheetNames: sheets.map((sheet) => sheet.name),
        sheetName: selected.sheet.name,
        sheetPath: selected.sheet.path,
        sheetIndex: selected.sheetIndex,
        headerRow: selected.header.rowNumber,
        headers: selected.header.headers,
        requiredHeaders: Object.values(REQUIRED_HEADERS),
        optionalHeadersPresent: Object.keys(OPTIONAL_HEADERS).filter((field) => selected.header.fieldColumns[field] != null),
        ...extracted.counts,
        retainedRows: extracted.rows.length,
      },
      diagnostics,
    };
  }

  function categoryKey(value) {
    return cleanText(value).toLowerCase();
  }

  /** Map an observed ASCM category to one of the eleven portfolio categories. */
  function mapAscmCategory(category, description = "") {
    const key = categoryKey(category);
    const text = cleanText(description).toLowerCase();
    if (key === "headset") {
      if (/\bcloud\s+(?:mini|mix\s+2)\b/.test(text)) return "lifestyle-audio";
      return /\b(?:cloudx|xbox|playstation|ps(?:[345])?|nintendo|switch)\b/.test(text)
        ? "console-gaming-audio"
        : "pc-gaming-audio";
    }
    if (key === "microphone" && /\b(?:shield|pop\s*filter)\b/.test(text)) return "microphone-accessories";
    return ASCM_CATEGORY_MAP[key] || null;
  }

  function normalizedColorToken(value) {
    return cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/HOUS(?:ING)?$/, "");
  }

  function colorsForExpression(expression) {
    const original = cleanText(expression).toUpperCase();
    if (!original) return null;
    const single = normalizedColorToken(original);
    if (COLORS[single]) return [COLORS[single]];
    if (CONCATENATED_COLOR_CODES[single]) return CONCATENATED_COLOR_CODES[single].map((code) => COLORS[code]);
    const parts = original
      .replace(/HOUS(?:ING)?\b/g, "")
      .split(/\s*(?:\/|\+|-|_)\s*|\s+/)
      .map(normalizedColorToken)
      .filter(Boolean);
    if (parts.length >= 1 && parts.length <= 2 && parts.every((part) => COLORS[part])) return parts.map((part) => COLORS[part]);
    return null;
  }

  function canonicalColorCode(value) {
    const resolved = colorsForExpression(value);
    return resolved ? resolved.map((item) => item.canonicalCode).join("/") : "";
  }

  function normalizeColorCode(value) {
    const canonical = canonicalColorCode(value);
    return canonical || cleanText(value).toUpperCase().replace(/\s+/g, " ");
  }

  function escapedRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Infer an explicit ASCM color/switch code from token boundaries. Codes may
   * appear before merchandising suffixes (`GAM HS`, `Gm Ms`, `WM`) rather than
   * at the physical end of the description. No substring matching is used, so
   * text such as `wired` can never be mistaken for `red`.
   */
  function inferColorVariant(description) {
    const text = cleanText(description);
    if (!text) return null;
    const codeAlternation = Object.keys(COLORS).sort((left, right) => right.length - left.length).map(escapedRegex).join("|");
    const candidates = [];

    // Explicit two-color expressions, including a space-delimited form such as
    // `BK BLU`. Both sides must independently be known codes.
    const pairPattern = new RegExp(`(^|[^A-Za-z0-9])((?:${codeAlternation})\\s*(?:\\/|\\+|-|_|\\s)\\s*(?:${codeAlternation}))(?=$|[^A-Za-z0-9])`, "gi");
    let match;
    while ((match = pairPattern.exec(text))) {
      const expression = match[2];
      if (!colorsForExpression(expression)) continue;
      const start = match.index + match[1].length;
      candidates.push({ expression, index: start, end: start + expression.length, weight: 3 });
      if (pairPattern.lastIndex === match.index) pairPattern.lastIndex += 1;
    }

    // Concatenated codes are an explicit, finite allowlist. Housing codes are
    // also allowed immediately after a model number (for example 265BLUHOUS).
    const concatenatedAlternation = Object.keys(CONCATENATED_COLOR_CODES).sort((left, right) => right.length - left.length).map(escapedRegex).join("|");
    const concatenatedPattern = new RegExp(`(${concatenatedAlternation}|(?:BLU|PNK|WHT)HOUS(?:ING)?)`, "gi");
    while ((match = concatenatedPattern.exec(text))) {
      const expression = match[1];
      const before = text[match.index - 1] || "";
      const after = text[match.index + expression.length] || "";
      const isHousingCode = /HOUS(?:ING)?$/i.test(expression);
      if (!isHousingCode && ((before && /[A-Za-z]/.test(before)) || (after && /[A-Za-z0-9]/.test(after)))) continue;
      if (isHousingCode && after && /[A-Za-z0-9]/.test(after)) continue;
      if (!colorsForExpression(expression)) continue;
      candidates.push({ expression, index: match.index, end: match.index + expression.length, weight: 2 });
    }

    const singlePattern = new RegExp(`(^|[^A-Za-z0-9])(${codeAlternation})(?=$|[^A-Za-z0-9])`, "gi");
    while ((match = singlePattern.exec(text))) {
      const expression = match[2];
      const start = match.index + match[1].length;
      candidates.push({ expression, index: start, end: start + expression.length, weight: 1 });
      if (singlePattern.lastIndex === match.index) singlePattern.lastIndex += 1;
    }

    candidates.sort((left, right) => right.weight - left.weight || left.index - right.index || right.expression.length - left.expression.length);
    for (const attempt of candidates) {
      const resolved = colorsForExpression(attempt.expression);
      if (!resolved) continue;
      const [primary, secondary] = resolved;
      const normalizedExpression = cleanText(attempt.expression).toUpperCase().replace(/HOUS(?:ING)?$/i, "").replace(/\s*(?:\+|-|_)\s*/g, "/").replace(/\s+/g, " ");
      return {
        code: normalizedExpression,
        matchedText: attempt.expression,
        matchStart: attempt.index,
        matchEnd: attempt.end,
        colorKey: primary.colorKey,
        colorName: primary.colorName,
        colorHex: primary.colorHex,
        colorKey2: secondary?.colorKey || "",
        colorName2: secondary?.colorName || "",
        colorHex2: secondary?.colorHex || "",
        canonicalCode: secondary ? `${primary.canonicalCode}/${secondary.canonicalCode}` : primary.canonicalCode,
      };
    }
    return null;
  }

  function cleanMerchandisingName(value) {
    return cleanText(value)
      // Retired/legacy commercial SKU strings are identifiers, not names.
      .replace(/\b(?:KHX|HX|H[A-Z0-9]{2,})-[A-Z0-9]+(?:-[A-Z0-9]+)*(?:\/[A-Z0-9]+)?\b/gi, " ")
      .replace(/\b(?:WRLS|WL)\b/gi, " Wireless ")
      .replace(/\b(?:WRD|WD)\b/gi, " Wired ")
      .replace(/\bGAM(?:ING)?\b/gi, " ")
      .replace(/\bGM\s+MS\b/gi, " ")
      .replace(/\b(?:HS|GKBD|GAMCNTRL|CNTRL|MIC)\b/gi, " ")
      .replace(/\bWM\b\s*$/gi, " ")
      .replace(/[\s(/+_-]+$/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function deriveDisplayName(description, inferredColor = inferColorVariant(description)) {
    const text = cleanText(description);
    if (!inferredColor || !Number.isInteger(inferredColor.matchStart)) return cleanMerchandisingName(text) || text;
    const matchEnd = Number.isInteger(inferredColor.matchEnd)
      ? inferredColor.matchEnd
      : inferredColor.matchStart + String(inferredColor.matchedText || "").length;
    const stripped = `${text.slice(0, inferredColor.matchStart)} ${text.slice(matchEnd)}`;
    return cleanMerchandisingName(stripped) || text;
  }

  /** A cautious exact-match signature, not a fuzzy similarity score. */
  function normalizeProductName(value) {
    let text = deriveDisplayName(cleanText(value));
    try { text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
    text = text
      .replace(/[™®©]/g, " ")
      .replace(/^\s*(?:hp\s+)?hyperx\s+/i, "")
      .replace(/[^A-Za-z0-9]+/g, " ")
      .toLowerCase()
      .replace(/^hx\s+/g, "")
      .replace(/\bclxst2c\b/g, "cloudx stinger 2 core")
      .replace(/\bclst\b/g, "cloud stinger")
      .replace(/\bc\s+w\s+g$/g, "core wireless")
      .replace(/\bcore\s+w\s+(ps(?:[345])?)\s+g$/g, "core wireless $1")
      .replace(/^stinger\b/g, "cloud stinger")
      .replace(/\balloyorigins\b/g, "alloy origins")
      .replace(/\bpf\b/g, "pulsefire")
      .replace(/\bhas\b/g, "haste")
      .replace(/\bpfc\b/g, "pulsefire core")
      .replace(/\bbpk\b/g, "backpack")
      .replace(/\btachi\b/g, "taichi")
      .replace(/\b75wl\b/g, "75 wireless")
      .replace(/\b2pro65gam\b/g, "2 pro 65")
      .replace(/\b1800gam\b/g, "1800")
      .replace(/\borigins\s+265\b/g, "origins 2 65")
      .replace(/\borigins\s+21800\b/g, "origins 2 1800")
      .replace(/\bdual\s+wireless\b/g, "wireless")
      .replace(/\b(?:mechanical\s+)?gaming\s+(?:headset|mouse|keyboard|controller)\s*$/i, "")
      .replace(/\b(?:usb\s+)?microphone\s*$/i, "")
      .replace(/\b(?:gam|kb)\b/g, " ")
      .replace(/\b(?:usb\s+mse)\b/g, " ")
      .replace(/\bob\b\s*$/g, "")
      .replace(/\bwired\b\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return text;
  }

  function normalizeCodeNameFamily(value) {
    let text = deriveDisplayName(cleanText(value));
    text = text.replace(/\s+WM$/i, "").replace(/\s+/g, " ").trim();
    return text;
  }

  function selectCodename(records) {
    const counts = new Map();
    const firstSeen = new Map();
    for (const record of records) {
      const family = normalizeCodeNameFamily(record.codeName);
      if (!family) continue;
      counts.set(family, (counts.get(family) || 0) + 1);
      if (!firstSeen.has(family)) firstSeen.set(family, record.sourceRow);
    }
    return [...counts.keys()].sort((left, right) =>
      counts.get(right) - counts.get(left)
      || firstSeen.get(left) - firstSeen.get(right)
      || left.localeCompare(right)
    )[0] || "";
  }

  function inferLane(categoryId, displayName, sourceCategories = []) {
    const text = cleanText(displayName).toLowerCase();
    if (["pc-gaming-audio", "console-gaming-audio", "lifestyle-audio", "mice"].includes(categoryId)) {
      return /\b(?:wireless|bluetooth|2[.]4\s*ghz|dual[- ]?wireless)\b/.test(text) ? "wireless" : "wired";
    }
    if (categoryId === "audio-accessories") return "accessories";
    if (categoryId === "microphones") return "microphone";
    if (categoryId === "microphone-accessories") return "interface-accessories";
    if (categoryId === "keyboards") return "keyboard";
    if (categoryId === "controllers") return "controller";
    if (categoryId === "backpacks") return "backpack";
    if (categoryId === "accessories") {
      const partCategories = new Set(["badge", "keyboard accessories", "keyboard keycaps", "keyboard wrist rest", "metal plate", "mouse accessories", "switch"]);
      return sourceCategories.some((category) => partCategories.has(categoryKey(category))) ? "parts" : "accessories";
    }
    return "";
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)));
  }

  /**
   * Convert normalized ASCM rows into conservative product groups. Color-coded
   * rows are grouped only when their post-code name signatures match exactly.
   *
   * @param {{rows:Array}} dataset output from parseAscmWorkbook
   * @returns {Array<object>}
   */
  function buildProductGroups(dataset) {
    if (!dataset || !Array.isArray(dataset.rows)) fail("INVALID_DATASET", "buildProductGroups expected a parsed ASCM dataset.");
    const grouped = new Map();
    const rows = [...dataset.rows].sort((left, right) => String(left.basePn).localeCompare(String(right.basePn)) || Number(left.sourceRow) - Number(right.sourceRow));
    for (const row of rows) {
      const color = inferColorVariant(row.description);
      const displayName = deriveDisplayName(row.description, color);
      const categoryId = mapAscmCategory(row.category, displayName);
      const normalizedName = normalizeProductName(displayName);
      const groupKey = `${categoryId || "unmapped"}:${normalizedName || normalizeBasePn(row.basePn)}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          key: groupKey,
          ascmKey: groupKey,
          categoryId,
          displayName,
          normalizedName,
          sourceCategories: [],
          records: [],
          diagnostics: [],
        });
      }
      const group = grouped.get(groupKey);
      group.sourceCategories.push(row.category);
      group.records.push({
        sourceRow: Number(row.sourceRow) || 0,
        rowNumber: Number(row.sourceRow) || 0,
        category: cleanText(row.category),
        basePn: normalizeBasePn(row.basePn),
        basePartNumber: normalizeBasePn(row.basePn),
        featureId: cleanText(row.featureId),
        localFlag: normalizeLocalFlag(row.localFlag),
        description: cleanText(row.description),
        fullProductName: cleanText(row.description),
        codeName: cleanText(row.codeName),
        codeNameFamily: normalizeCodeNameFamily(row.codeName),
        ga: cleanText(row.ga),
        generalAvailabilityDate: cleanText(row.ga),
        em: cleanText(row.em),
        endManufacturingDate: cleanText(row.em),
        colorCode: color?.code || "",
        color: color ? { ...color } : null,
      });
    }

    const result = [];
    for (const group of grouped.values()) {
      group.records.sort((left, right) => left.basePn.localeCompare(right.basePn) || left.sourceRow - right.sourceRow);
      group.sourceCategories = uniqueSorted(group.sourceCategories);
      group.basePns = uniqueSorted(group.records.map((record) => record.basePn));
      group.basePartNumbers = [...group.basePns];
      group.partSkus = group.records.map((record) => ({
        code: record.basePn,
        featureId: record.featureId,
        colorCode: record.colorCode,
        sourceRow: record.sourceRow,
      }));
      group.gaDate = group.records.map((record) => record.ga).filter(Boolean).sort()[0] || "";
      group.emDate = group.records.map((record) => record.em).filter(Boolean).sort().at(-1) || "";
      group.launchMonth = group.gaDate.slice(0, 7);
      group.endMonth = group.emDate.slice(0, 7);
      group.codeNames = uniqueSorted(group.records.map((record) => record.codeName));
      group.codeNameFamilies = uniqueSorted(group.records.map((record) => record.codeNameFamily));
      group.codename = selectCodename(group.records);
      group.laneId = inferLane(group.categoryId, group.displayName, group.sourceCategories);

      const variants = new Map();
      for (const record of group.records) {
        if (!record.color) continue;
        const variantKey = record.color.canonicalCode;
        if (!variants.has(variantKey)) {
          variants.set(variantKey, {
            code: record.color.code,
            canonicalCode: record.color.canonicalCode,
            colorKey: record.color.colorKey,
            colorName: record.color.colorName,
            colorHex: record.color.colorHex,
            colorKey2: record.color.colorKey2,
            colorName2: record.color.colorName2,
            colorHex2: record.color.colorHex2,
            basePns: [],
          });
        }
        variants.get(variantKey).basePns.push(record.basePn);
      }
      group.colorVariants = [...variants.values()]
        .map((variant) => ({ ...variant, basePns: uniqueSorted(variant.basePns) }))
        .sort((left, right) => left.canonicalCode.localeCompare(right.canonicalCode));
      group.variantGroups = group.colorVariants.length ? [{ type: "color", label: "COLOR SKU", items: group.colorVariants }] : [];
      if (!group.categoryId) {
        group.diagnostics.push(diagnostic("error", "UNMAPPED_CATEGORY", "The ASCM category is not mapped to a portfolio category.", { categories: group.sourceCategories }));
      }
      if (!group.normalizedName) group.diagnostics.push(diagnostic("error", "EMPTY_GROUP_NAME", "The product group has no usable normalized name."));
      result.push(group);
    }
    return result.sort((left, right) =>
      String(left.categoryId || "").localeCompare(String(right.categoryId || ""))
      || left.normalizedName.localeCompare(right.normalizedName)
      || left.key.localeCompare(right.key)
    );
  }

  function flattenPortfolioProducts(portfolio) {
    const output = [];
    for (const category of Array.isArray(portfolio?.categories) ? portfolio.categories : []) {
      const categoryId = String(category?.id || "");
      for (const product of Array.isArray(category?.board?.products) ? category.board.products : []) {
        output.push({ categoryId, product });
      }
    }
    return output;
  }

  function productAscmKeys(product) {
    return uniqueSorted([
      product?.ascmKey,
      product?.ascm?.key,
      product?.sourceRefs?.ascm?.key,
      product?.source?.ascmKey,
    ].map((value) => cleanText(value).toLowerCase()));
  }

  function productBasePns(product) {
    const values = [product?.basePn, product?.basePN, product?.hpPartNumber];
    const partSkus = Array.isArray(product?.partSkus) ? product.partSkus : [];
    for (const item of partSkus) values.push(typeof item === "string" ? item : item?.code || item?.sku || item?.value || item?.basePn);
    for (const value of Array.isArray(product?.ascm?.basePns) ? product.ascm.basePns : []) values.push(value);
    for (const value of Array.isArray(product?.ascm?.basePartNumbers) ? product.ascm.basePartNumbers : []) values.push(value);
    for (const value of Array.isArray(product?.sourceRefs?.ascm?.basePns) ? product.sourceRefs.ascm.basePns : []) values.push(value);
    for (const value of Array.isArray(product?.sourceRefs?.ascm?.basePartNumbers) ? product.sourceRefs.ascm.basePartNumbers : []) values.push(value);
    return uniqueSorted(values.map(normalizeBasePn));
  }

  function candidateSummary(candidate) {
    return {
      categoryId: candidate.categoryId,
      productId: String(candidate.product?.id || ""),
      productName: cleanText(candidate.product?.name),
    };
  }

  function platformIdentity(value) {
    const text = cleanText(value).toLowerCase();
    if (/\b(?:cloudx|xbox)\b/.test(text)) return "xbox";
    if (/\b(?:playstation|ps(?:[345])?)\b/.test(text)) return "playstation";
    if (/\b(?:nintendo|switch)\b/.test(text)) return "nintendo";
    return "";
  }

  function productPlatformIdentity(product) {
    const specs = Array.isArray(product?.specs) ? product.specs : [];
    return platformIdentity([
      product?.name,
      ...specs.flatMap((item) => [item?.label, item?.value]),
    ].join(" "));
  }

  function consoleFamilyName(value) {
    return normalizeProductName(value)
      .replace(/\s+(?:playstation|ps(?:[345])?|xbox|nintendo|switch)\s*$/i, "")
      .trim();
  }

  function matchResult(status, method, candidates, extras = {}) {
    const selected = status === "matched" && candidates.length === 1 ? candidates[0] : null;
    return {
      status,
      method,
      ambiguous: status === "ambiguous",
      product: selected?.product || null,
      categoryId: selected?.categoryId || null,
      candidates: candidates.map(candidateSummary),
      ...extras,
    };
  }

  /**
   * Match one ASCM product group without mutating the portfolio. Exact saved
   * ASCM keys and Base PNs take precedence. The fallback is an exact normalized
   * name match inside the mapped category; no fuzzy threshold is used.
   */
  function matchProductGroup(group, portfolio) {
    if (!group || typeof group !== "object") fail("INVALID_GROUP", "matchProductGroup expected an ASCM product group.");
    const products = flattenPortfolioProducts(portfolio);
    const groupKey = cleanText(group.ascmKey || group.key).toLowerCase();
    const groupPartNumbers = Array.isArray(group.basePns)
      ? group.basePns
      : Array.isArray(group.basePartNumbers)
        ? group.basePartNumbers
        : [];
    const groupBasePns = new Set(groupPartNumbers.map(normalizeBasePn).filter(Boolean));
    const keyMatches = groupKey ? products.filter((candidate) => productAscmKeys(candidate.product).includes(groupKey)) : [];
    const baseMatches = products.filter((candidate) => productBasePns(candidate.product).some((partNumber) => groupBasePns.has(partNumber)));

    if (keyMatches.length > 1) return matchResult("ambiguous", "ascm-key", keyMatches, { reason: "duplicate-ascm-key" });
    if (keyMatches.length === 1) {
      const conflicts = baseMatches.filter((candidate) => candidate.product !== keyMatches[0].product);
      if (conflicts.length) {
        return matchResult("ambiguous", "exact-conflict", [keyMatches[0], ...conflicts], { reason: "ascm-key-and-base-pn-disagree" });
      }
      return matchResult("matched", "ascm-key", keyMatches, { confidence: "exact" });
    }
    const uniqueBaseMatches = baseMatches.filter((candidate, index) => baseMatches.findIndex((item) => item.product === candidate.product) === index);
    if (uniqueBaseMatches.length > 1) {
      return matchResult("ambiguous", "base-pn", uniqueBaseMatches, {
        reason: "base-pns-match-multiple-products",
        matchedBasePns: uniqueSorted(uniqueBaseMatches.flatMap((candidate) => productBasePns(candidate.product).filter((partNumber) => groupBasePns.has(partNumber)))),
      });
    }
    if (uniqueBaseMatches.length === 1) {
      return matchResult("matched", "base-pn", uniqueBaseMatches, {
        confidence: "exact",
        matchedBasePns: productBasePns(uniqueBaseMatches[0].product).filter((partNumber) => groupBasePns.has(partNumber)),
      });
    }

    const normalizedName = cleanText(group.normalizedName || normalizeProductName(group.displayName));
    if (!group.categoryId || !normalizedName) return matchResult("unmatched", null, [], { reason: "no-exact-key-or-usable-name" });
    const nameMatches = products.filter((candidate) =>
      candidate.categoryId === group.categoryId
      && normalizeProductName(candidate.product?.name) === normalizedName
    );
    if (nameMatches.length > 1) return matchResult("ambiguous", "normalized-name", nameMatches, { reason: "duplicate-normalized-name" });
    if (nameMatches.length === 1) return matchResult("matched", "normalized-name", nameMatches, { confidence: "cautious" });

    if (group.categoryId === "console-gaming-audio") {
      const familyName = consoleFamilyName(group.displayName || group.normalizedName);
      const familyMatches = familyName ? products.filter((candidate) =>
        candidate.categoryId === group.categoryId
        && consoleFamilyName(candidate.product?.name) === familyName
      ) : [];
      if (familyMatches.length) {
        const sourceText = [group.displayName, ...(group.records || []).map((record) => record.description)].join(" ");
        const expectedPlatform = platformIdentity(sourceText);
        const compatible = expectedPlatform
          ? familyMatches.filter((candidate) => productPlatformIdentity(candidate.product) === expectedPlatform)
          : familyMatches;
        if (compatible.length === 1) return matchResult("matched", "platform-name", compatible, { confidence: "cautious", platform: expectedPlatform });
        return matchResult("ambiguous", "platform-name", compatible.length ? compatible : familyMatches, {
          reason: compatible.length ? "duplicate-platform-name" : "platform-could-not-be-confirmed",
          platform: expectedPlatform,
        });
      }
    }
    return matchResult("unmatched", null, [], { reason: "no-match" });
  }

  const api = Object.freeze({
    version: API_VERSION,
    AscmImportError,
    REQUIRED_HEADERS,
    OPTIONAL_HEADERS,
    DEFAULT_LIMITS,
    PORTFOLIO_CATEGORY_IDS,
    ASCM_CATEGORY_MAP,
    COLOR_CODE_MAP: COLORS,
    parseAscmWorkbook,
    parseWorkbook: parseAscmWorkbook,
    buildProductGroups,
    matchProductGroup,
    helpers: Object.freeze({
      openZip,
      parseSharedStrings,
      findWorksheetHeader,
      parseExcelDate,
      parseExcelDateTime,
      findWorksheetExportedAt,
      normalizeHeader,
      normalizeBasePn,
      normalizeProductName,
      consoleFamilyName,
      platformIdentity,
      normalizeCodeNameFamily,
      mapAscmCategory,
      inferColorVariant,
      deriveDisplayName,
      inferLane,
      colorsForExpression,
      canonicalColorCode,
      normalizeColorCode,
      resolveZipTarget,
      decodeXml,
      crc32,
    }),
  });

  Object.defineProperty(globalObject, "ASCMImporter", {
    configurable: true,
    enumerable: true,
    writable: false,
    value: api,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
