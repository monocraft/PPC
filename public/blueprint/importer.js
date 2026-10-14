/* Local, read-only Office Open XML ingestion. Never executes workbook macros. */
(function () {
  'use strict';
  const decoder = new TextDecoder('utf-8');
  const local = n => n.localName;
  const elements = (root, name) => [...root.getElementsByTagNameNS('*', name)];
  const xml = text => {
    const document = new DOMParser().parseFromString(text, 'application/xml');
    if (elements(document, 'parsererror').length) throw new Error('The workbook contains unreadable XML.');
    return document;
  };
  const resolve = (base, target) => {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/').slice(0, -1).concat(target.split('/'));
    const path = [];
    for (const part of parts) {
      if (part === '..') path.pop();
      else if (part && part !== '.') path.push(part);
    }
    return path.join('/');
  };
  async function zipEntries(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    let end = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
      if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
    }
    if (end < 0) throw new Error('Choose an unencrypted .xlsx or .xlsm workbook.');
    const count = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true), total = 0;
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('The workbook archive is damaged.');
      const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
      const packed = view.getUint32(offset + 20, true), unpacked = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
      const start = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      total += unpacked;
      if (unpacked > 120 * 1024 * 1024 || total > 300 * 1024 * 1024) throw new Error('This source is too large for the local prototype.');
      if (flags & 1) throw new Error('Password-protected workbooks are not supported.');
      entries.set(name, { method, packed, unpacked, start });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    async function read(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      const start = entry.start;
      if (view.getUint32(start, true) !== 0x04034b50) throw new Error('The workbook archive is damaged.');
      const payload = start + 30 + view.getUint16(start + 26, true) + view.getUint16(start + 28, true);
      let result = bytes.slice(payload, payload + entry.packed);
      if (entry.method === 8) {
        if (!globalThis.DecompressionStream) throw new Error('Source import requires a modern Chrome or Edge browser.');
        result = new Uint8Array(await new Response(new Blob([result]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      } else if (entry.method !== 0) throw new Error('This archive compression method is unsupported.');
      if (result.length !== entry.unpacked) throw new Error('The workbook archive has an incomplete entry.');
      return decoder.decode(result);
    }
    return { entries, read };
  }
  function readCells(document, strings) {
    const cells = {};
    for (const node of elements(document, 'c')) {
      const address = node.getAttribute('r');
      const type = node.getAttribute('t') || 'n';
      const valueNode = [...node.children].find(n => local(n) === 'v');
      const formulaNode = [...node.children].find(n => local(n) === 'f');
      let value = valueNode?.textContent ?? null;
      if (type === 's') value = strings[Number(value)] ?? null;
      else if (type === 'inlineStr') value = elements(node, 't').map(n => n.textContent).join('');
      else if (type === 'b') value = value === '1';
      else if (type === 'n' && value !== null && value !== '') value = Number(value);
      cells[address] = { value, type, style: Number(node.getAttribute('s') || 0), formula: formulaNode ? '=' + formulaNode.textContent : null, formulaAttributes: formulaNode ? Object.fromEntries([...formulaNode.attributes].map(a => [a.name, a.value])) : null };
    }
    return cells;
  }
  window.HX_IMPORT_FILE = async function (file) {
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) throw new Error('Choose an HX Blueprint .xlsx or .xlsm file.');
    if (file.size > 40 * 1024 * 1024) throw new Error('Choose a workbook smaller than 40 MB.');
    const zip = await zipEntries(await file.arrayBuffer());
    const workbookText = await zip.read('xl/workbook.xml');
    if (!workbookText) throw new Error('This file is not a supported Excel workbook.');
    const book = xml(workbookText), relationships = xml(await zip.read('xl/_rels/workbook.xml.rels'));
    const relationshipMap = Object.fromEntries(elements(relationships, 'Relationship').map(r => [r.getAttribute('Id'), resolve('xl/workbook.xml', r.getAttribute('Target'))]));
    const sharedText = await zip.read('xl/sharedStrings.xml');
    const strings = sharedText ? elements(xml(sharedText), 'si').map(si => elements(si, 't').map(t => t.textContent).join('')) : [];
    const sheets = [];
    for (const sheet of elements(book, 'sheet')) {
      const id = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const document = xml(await zip.read(relationshipMap[id]));
      const cells = readCells(document, strings);
      sheets.push({ name: sheet.getAttribute('name'), state: sheet.getAttribute('state') || 'visible', cells, dimension: elements(document, 'dimension')[0]?.getAttribute('ref'), formulaCount: Object.values(cells).filter(c => c.formula !== null).length });
    }
    const required = ['Cat_View', 'Dashboard', 'Budget_UnPivot', 'NPI_Tracker_All', 'TAM', 'NPI_Value', 'Combined_Products', 'Budget_Data', 'Category Targets', 'Targets Calculations'];
    const missing = required.filter(name => !sheets.some(s => s.name === name));
    if (missing.length) throw new Error('The source is missing these HX Blueprint tabs: ' + missing.join(', ') + '. The current source was kept.');
    if (!window.HX_ANALYTICS?.normalizeWorkbook) throw new Error('The dashboard calculation engine is not ready.');
    const definedNames=elements(book,'definedName').map(n=>({name:n.getAttribute('name'),definition:n.textContent}));
    const result = window.HX_ANALYTICS.normalizeWorkbook({ source: { name: file.name, size: file.size, modifiedAt: new Date(file.lastModified).toISOString(), importedAt: new Date().toISOString(), basis: 'Workbook planning snapshot', origin: 'Local file import' }, sheets, definedNames });
    if (!result.products?.length || !result.periods?.length) throw new Error('No supported product planning records were found. The current source was kept.');
    return result;
  };
})();
