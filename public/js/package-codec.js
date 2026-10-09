/* Shared encrypted package envelope and bounded stored-ZIP codec. */
(function (root) {
  "use strict";

  const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
  const MAX_PACKAGE_COMMENTS = 2000;
  const MAX_STORED_PACKAGE_COMMENTS = 2 * 1024 * 1024;
  const MAX_ENTRIES = 10000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const MAGIC = encoder.encode("PPCPKG01");
  const FAMILY = encoder.encode("PPCPKG");
  const HEADER_BYTES = 20;
  const TAG_BYTES = 16;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let crcTable;

  function normalizePackageInfo(value) {
    if (value === undefined || value === null) return null;
    const invalid = () => { throw new Error("The package update information is invalid."); };
    if (typeof value !== "object" || Array.isArray(value) || value.version !== 1
      || Object.keys(value).length !== 3 || Object.keys(value).some((key) => !["version", "updatedAt", "comments"].includes(key))
      || typeof value.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.updatedAt)
      || typeof value.comments !== "string" || value.comments.length > MAX_STORED_PACKAGE_COMMENTS) invalid();
    const updated = new Date(value.updatedAt);
    if (!Number.isFinite(updated.getTime()) || updated.toISOString() !== value.updatedAt) invalid();
    return Object.freeze({ version: 1, updatedAt: value.updatedAt, comments: value.comments });
  }

  function createPackageInfo({ comments = "" } = {}) {
    if (typeof comments !== "string" || comments.length > MAX_PACKAGE_COMMENTS) throw new Error("The package update information is invalid.");
    return normalizePackageInfo({ version: 1, updatedAt: new Date().toISOString(), comments });
  }

  function bytesOf(value) {
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    throw new TypeError("Expected package bytes as a Uint8Array or ArrayBuffer.");
  }

  function bounded(value) {
    const bytes = bytesOf(value);
    if (bytes.length > MAX_PACKAGE_BYTES) throw new Error("The package exceeds the 64 MiB size limit.");
    return bytes;
  }

  function base64url(bytes) {
    let output = "";
    let accumulator = 0;
    let bits = 0;
    for (const byte of bytes) {
      accumulator = (accumulator << 8) | byte;
      bits += 8;
      while (bits >= 6) { bits -= 6; output += alphabet[(accumulator >>> bits) & 63]; }
    }
    if (bits) output += alphabet[(accumulator << (6 - bits)) & 63];
    return output;
  }

  function keyBytes(key) {
    const text = String(key ?? "").trim();
    const encoded = /^PPC-([A-Za-z0-9_-]{43})$/.exec(text)?.[1];
    if (!encoded) throw new Error("Enter a complete package key: PPC- followed by its 43-character key.");
    const output = new Uint8Array(32);
    let accumulator = 0;
    let bits = 0;
    let offset = 0;
    for (const character of encoded) {
      accumulator = (accumulator << 6) | alphabet.indexOf(character);
      bits += 6;
      if (bits >= 8) { bits -= 8; output[offset++] = (accumulator >>> bits) & 255; }
    }
    if (offset !== 32 || base64url(output) !== encoded) throw new Error("The package key is invalid. Use the complete key supplied with this package.");
    return output;
  }

  function normalizeKey(key) { return `PPC-${base64url(keyBytes(key))}`; }

  function cryptoProvider() {
    if (!root.crypto?.subtle || typeof root.crypto.getRandomValues !== "function") {
      throw new Error("Package encryption requires a secure HTTPS page or a supported local browser.");
    }
    return root.crypto;
  }

  function generateKey() { return `PPC-${base64url(cryptoProvider().getRandomValues(new Uint8Array(32)))}`; }

  function startsWith(bytes, prefix) {
    return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
  }

  function isEncrypted(value) { return startsWith(bytesOf(value), FAMILY); }

  async function encrypt(value, key) {
    const plaintext = bounded(value);
    if (plaintext.length + HEADER_BYTES + TAG_BYTES > MAX_PACKAGE_BYTES) throw new Error("The encrypted package exceeds the 64 MiB size limit.");
    const crypto = cryptoProvider();
    const rawKey = keyBytes(key);
    const header = new Uint8Array(HEADER_BYTES);
    header.set(MAGIC);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    header.set(iv, MAGIC.length);
    const imported = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: header, tagLength: 128 }, imported, plaintext));
    const output = new Uint8Array(header.length + ciphertext.length);
    output.set(header);
    output.set(ciphertext, header.length);
    return output;
  }

  async function decrypt(value, key) {
    const encrypted = bounded(value);
    if (!startsWith(encrypted, FAMILY)) throw new Error("This is not an encrypted PPC package.");
    if (encrypted.length < HEADER_BYTES + TAG_BYTES) throw new Error("The encrypted package is truncated.");
    if (!startsWith(encrypted, MAGIC)) throw new Error("This encrypted package version is unsupported.");
    const header = encrypted.slice(0, HEADER_BYTES);
    const iv = header.slice(MAGIC.length);
    const crypto = cryptoProvider();
    const imported = await crypto.subtle.importKey("raw", keyBytes(key), "AES-GCM", false, ["decrypt"]);
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: header, tagLength: 128 }, imported, encrypted.subarray(HEADER_BYTES)));
    } catch (_) {
      throw new Error("Unable to unlock this package. The key is incorrect or the package has been changed.");
    }
  }

  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        crcTable[index] = value >>> 0;
      }
    }
    let value = 0xffffffff;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }

  function safeName(name) {
    if (typeof name !== "string" || !name || /[\x00-\x1f\x7f\\:]/.test(name) || name.startsWith("/")) {
      throw new Error("The package contains an unsafe entry path.");
    }
    if (name.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("The package contains an unsafe traversal path.");
    return name;
  }

  function concatenate(chunks, total) {
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  }

  function createZip(entries) {
    if (!Array.isArray(entries)) throw new TypeError("Package ZIP entries must be an array.");
    if (entries.length > MAX_ENTRIES) throw new Error("The package exceeds the 10,000-entry limit.");
    const seen = new Set();
    let total = 22;
    const prepared = entries.map((entry) => {
      const name = safeName(entry?.name);
      if (seen.has(name)) throw new Error("The package contains duplicate entry paths.");
      seen.add(name);
      const nameBytes = encoder.encode(name);
      if (nameBytes.length > 0xffff) throw new Error("A package entry name is too long.");
      if (decoder.decode(nameBytes) !== name) throw new Error("A package entry name contains invalid Unicode.");
      const data = bytesOf(entry.data);
      total += 30 + 46 + nameBytes.length * 2 + data.length;
      if (total > MAX_PACKAGE_BYTES) throw new Error("The package exceeds the 64 MiB size limit.");
      return { nameBytes, data };
    });
    const locals = [];
    const centrals = [];
    let localOffset = 0;
    let centralSize = 0;
    for (const { nameBytes, data } of prepared) {
      const checksum = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint32(14, checksum, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);
      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint32(16, checksum, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, localOffset, true);
      central.set(nameBytes, 46);
      locals.push(local, data);
      centrals.push(central);
      localOffset += local.length + data.length;
      centralSize += central.length;
    }
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, localOffset, true);
    return concatenate([...locals, ...centrals, end], total);
  }

  function readZip(value) {
    const bytes = bounded(value);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const range = (offset, length, limit = bytes.length) => {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > limit) {
        throw new Error("The package ZIP is truncated or contains an invalid offset.");
      }
    };
    const u16 = (offset) => { range(offset, 2); return view.getUint16(offset, true); };
    const u32 = (offset) => { range(offset, 4); return view.getUint32(offset, true); };
    let end = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
      if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
    }
    if (end < 0) throw new Error("This is not a supported PPC ZIP package, or the file is truncated.");
    const count = u16(end + 10);
    const centralSize = u32(end + 12);
    const centralStart = u32(end + 16);
    if (count === 0xffff || centralSize === 0xffffffff || centralStart === 0xffffffff) throw new Error("ZIP64 packages are unsupported.");
    if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) throw new Error("Multi-disk packages are unsupported.");
    if (count > MAX_ENTRIES) throw new Error("The package exceeds the 10,000-entry limit.");
    if (centralStart + centralSize !== end) throw new Error("The package ZIP directory has an invalid size or offset.");
    range(centralStart, centralSize, end);
    const extras = (offset, length) => {
      const finish = offset + length;
      while (offset < finish) {
        range(offset, 4, finish);
        const id = u16(offset);
        const size = u16(offset + 2);
        range(offset + 4, size, finish);
        if (id === 1) throw new Error("ZIP64 package entries are unsupported.");
        offset += 4 + size;
      }
    };
    const nameAt = (offset, length, flags) => {
      const encoded = bytes.subarray(offset, offset + length);
      if (flags === 0 && encoded.some((byte) => byte > 127)) throw new Error("Non-ASCII package entry names must declare UTF-8 encoding.");
      try { return safeName(decoder.decode(encoded)); } catch (error) {
        if (error instanceof TypeError) throw new Error("A package entry name has invalid UTF-8 encoding.");
        throw error;
      }
    };
    const output = new Map();
    const regions = [];
    let position = centralStart;
    let totalData = 0;
    for (let index = 0; index < count; index += 1) {
      range(position, 46, end);
      if (u32(position) !== 0x02014b50) throw new Error("The package ZIP directory is damaged.");
      const version = u16(position + 6);
      const flags = u16(position + 8);
      const method = u16(position + 10);
      const checksum = u32(position + 16);
      const size = u32(position + 20);
      const uncompressed = u32(position + 24);
      const nameLength = u16(position + 28);
      const extraLength = u16(position + 30);
      const commentLength = u16(position + 32);
      const local = u32(position + 42);
      const recordLength = 46 + nameLength + extraLength + commentLength;
      range(position, recordLength, end);
      if ([size, uncompressed, local].includes(0xffffffff) || version > 20) throw new Error("ZIP64 or advanced ZIP package features are unsupported.");
      if (u16(position + 34)) throw new Error("Multi-disk package entries are unsupported.");
      if (flags !== 0 && flags !== 0x0800) throw new Error("Encrypted ZIP entries, data descriptors, and unsupported ZIP flags are not allowed.");
      if (method !== 0) throw new Error("The package uses unsupported ZIP compression. Stored entries are required.");
      if (size !== uncompressed) throw new Error("A stored package entry has inconsistent sizes.");
      totalData += uncompressed;
      if (totalData > MAX_PACKAGE_BYTES) throw new Error("The package exceeds the 64 MiB uncompressed size limit.");
      const name = nameAt(position + 46, nameLength, flags);
      if (output.has(name)) throw new Error("The package contains duplicate entry paths.");
      extras(position + 46 + nameLength, extraLength);
      range(local, 30, centralStart);
      if (u32(local) !== 0x04034b50) throw new Error("A package ZIP local header is damaged.");
      const localNameLength = u16(local + 26);
      const localExtraLength = u16(local + 28);
      range(local + 30, localNameLength + localExtraLength + size, centralStart);
      if (u16(local + 4) !== version || u16(local + 6) !== flags || u16(local + 8) !== method
        || u16(local + 10) !== u16(position + 12) || u16(local + 12) !== u16(position + 14)
        || u32(local + 14) !== checksum || u32(local + 18) !== size || u32(local + 22) !== uncompressed
        || localNameLength !== nameLength || nameAt(local + 30, localNameLength, flags) !== name) {
        throw new Error("A package ZIP local header conflicts with its directory entry.");
      }
      extras(local + 30 + localNameLength, localExtraLength);
      const dataStart = local + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + size;
      const data = bytes.slice(dataStart, dataEnd);
      if (crc32(data) !== checksum) throw new Error("A package entry failed its CRC integrity check.");
      regions.push({ start: local, end: dataEnd });
      output.set(name, data);
      position += recordLength;
    }
    if (position !== end) throw new Error("The package ZIP entry count does not match its directory.");
    regions.sort((a, b) => a.start - b.start);
    let localEnd = 0;
    for (const region of regions) {
      if (region.start !== localEnd) throw new Error("Package ZIP entries overlap or contain unreferenced local data.");
      localEnd = region.end;
    }
    if (localEnd !== centralStart) throw new Error("The package ZIP contains unreferenced local data.");
    return output;
  }

  root.PortfolioPackage = Object.freeze({ MAX_PACKAGE_BYTES, MAX_PACKAGE_COMMENTS, MAX_STORED_PACKAGE_COMMENTS, createPackageInfo, normalizePackageInfo, generateKey, normalizeKey, isEncrypted, encrypt, decrypt, createZip, readZip });
})(globalThis);
