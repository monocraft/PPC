(function registerEditablePptx(globalObject) {
  "use strict";

  const deckSlides = new WeakMap();
  const EMUS_PER_INCH = 914400;
  const escapeXml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);

  function colorOptions(value, opacity = 1) {
    if (!value || value === "transparent") return { color: "FFFFFF", transparency: 100 };
    let color = String(value).replace(/^#/, "");
    if (/^[\da-f]{3}$/i.test(color)) color = color.split("").map((character) => character.repeat(2)).join("");
    const rgba = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if (rgba) {
      color = rgba.slice(1, 4).map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, "0")).join("");
      opacity *= rgba[4] == null ? 1 : Number(rgba[4]);
    }
    if (!/^[\da-f]{6}$/i.test(color)) throw new Error("A product has an unsupported presentation color.");
    return { color: color.toUpperCase(), transparency: Math.round((1 - Math.max(0, Math.min(1, opacity))) * 100) };
  }

  function addCard(pptx, slide, product, placement, cardIndex) {
    const scale = placement.scale;
    const x = placement.x + product.x * scale;
    const y = placement.y + product.y * scale;
    const prefix = `ppc-card-${cardIndex}-part-`;
    const elements = product.elements || [];
    const roundedCorners = {};
    if (!elements.length) throw new Error(`The product ${product.name || product.id} has no presentation content.`);
    elements.forEach((element, index) => {
      const rect = { x: x + element.x * scale, y: y + element.y * scale,
        w: element.width * scale, h: element.height * scale, objectName: `${prefix}${index}` };
      if (element.kind === "image") {
        slide.addImage({ ...rect, data: element.data, altText: element.altText || product.name || "Product artwork" });
      } else if (element.kind === "text") {
        slide.addText(element.text, {
          ...rect, fontFace: element.fontFace || "Arial", fontSize: element.fontSize * scale * 72,
          color: colorOptions(element.color).color, bold: Boolean(element.bold), italic: Boolean(element.italic),
          align: element.align || "left", valign: "top", margin: 0,
          breakLine: false, wrap: false, fit: "shrink", paraSpaceAfter: 0,
        });
      } else if (element.kind === "shape") {
        if (element.shape === "roundRect" && element.cornerRadii) {
          roundedCorners[`${prefix}${index}`] = {
            width: Math.round(rect.w * EMUS_PER_INCH), height: Math.round(rect.h * EMUS_PER_INCH),
            radii: element.cornerRadii.map((radius) => Math.round(radius * scale * EMUS_PER_INCH)),
          };
        }
        slide.addShape(pptx.ShapeType[element.shape] || element.shape, {
          ...rect, fill: colorOptions(element.fill, element.fillOpacity ?? 1),
          line: { ...colorOptions(element.lineColor, element.lineOpacity ?? 1), width: (element.lineWidth || 0) * scale * 72 },
          flipH: Boolean(element.flipH), flipV: Boolean(element.flipV),
          ...(element.shadow ? { shadow: { type: "outer", color: "000000", opacity: element.shadow.opacity,
            blur: element.shadow.blur * scale * 72, angle: 90, offset: element.shadow.offset * scale * 72 } } : {}),
        });
      } else {
        throw new Error("A product has unsupported presentation content.");
      }
    });
    return { prefix, name: `Product: ${product.id} — ${product.name || "Product"}`,
      x, y, width: product.width * scale, height: product.height * scale, partCount: elements.length, roundedCorners };
  }

  function registerSlide(pptx, groups) {
    if (!deckSlides.has(pptx)) deckSlides.set(pptx, []);
    deckSlides.get(pptx).push(groups);
  }

  // PptxGenJS emits flat slide objects. Wrap each product's contiguous objects
  // in an OOXML group using the same parent/child coordinate system, so moving
  // or resizing a product preserves its layout and its text stays editable.
  function groupSlideXml(xml, groups) {
    if (!groups.length) return xml;
    const objects = [...xml.matchAll(/<p:(sp|pic|graphicFrame|cxnSp)\b[\s\S]*?<\/p:\1>/g)].map((match) => ({
      xml: match[0], start: match.index, end: match.index + match[0].length,
      name: match[0].match(/<p:cNvPr\b[^>]*\bname="([^"]*)"/)?.[1] || "",
    }));
    let nextId = Math.max(1, ...[...xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1]))) + 1;
    const replacements = groups.map((group) => {
      const parts = objects.filter((object) => object.name.startsWith(group.prefix));
      if (parts.length !== group.partCount || !parts.length) throw new Error("PowerPoint could not group all parts of a product.");
      const first = parts[0];
      const last = parts.at(-1);
      if (objects.filter((object) => object.start >= first.start && object.end <= last.end).length !== parts.length) {
        throw new Error("PowerPoint product parts are not in their expected order.");
      }
      const x = Math.round(group.x * EMUS_PER_INCH);
      const y = Math.round(group.y * EMUS_PER_INCH);
      const width = Math.round(group.width * EMUS_PER_INCH);
      const height = Math.round(group.height * EMUS_PER_INCH);
      const productParts = parts.map((part) => {
        const corners = group.roundedCorners?.[part.name];
        return corners ? part.xml.replace(/<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/, roundedGeometry(corners)) : part.xml;
      });
      const content = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${nextId++}" name="${escapeXml(group.name)}"/>` +
        `<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm>` +
        `<a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/>` +
        `<a:chOff x="${x}" y="${y}"/><a:chExt cx="${width}" cy="${height}"/>` +
        `</a:xfrm></p:grpSpPr>${productParts.join("")}</p:grpSp>`;
      return { start: first.start, end: last.end, content };
    }).sort((a, b) => b.start - a.start);
    for (const replacement of replacements) xml = xml.slice(0, replacement.start) + replacement.content + xml.slice(replacement.end);
    return xml;
  }

  function roundedGeometry({ width, height, radii }) {
    const values = radii.length === 1 ? [radii[0], radii[0], radii[0], radii[0]]
      : radii.length === 2 ? [radii[0], radii[1], radii[0], radii[1]]
        : radii.length === 3 ? [radii[0], radii[1], radii[2], radii[1]] : radii;
    const [tl, tr, br, bl] = values.map((value) => Math.max(0, Math.min(width / 2, height / 2, value)));
    const point = (x, y) => `<a:pt x="${x}" y="${y}"/>`;
    const line = (x, y) => `<a:lnTo>${point(x, y)}</a:lnTo>`;
    const curve = (cx, cy, x, y) => `<a:quadBezTo>${point(cx, cy)}${point(x, y)}</a:quadBezTo>`;
    return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="w" b="h"/>` +
      `<a:pathLst><a:path w="${width}" h="${height}"><a:moveTo>${point(tl, 0)}</a:moveTo>` +
      line(width - tr, 0) + curve(width, 0, width, tr) + line(width, height - br) + curve(width, height, width - br, height) +
      line(bl, height) + curve(0, height, 0, height - bl) + line(0, tl) + curve(0, 0, tl, 0) +
      `<a:close/></a:path></a:pathLst></a:custGeom>`;
  }

  async function serialize(pptx) {
    const data = await pptx.write({ outputType: "arraybuffer" });
    const slides = deckSlides.get(pptx) || [];
    if (!slides.some((groups) => groups.length)) return data;
    if (typeof globalObject.JSZip?.loadAsync !== "function") throw new Error("The editable PowerPoint library did not load. Refresh and try again.");
    const archive = await globalObject.JSZip.loadAsync(data);
    for (let index = 0; index < slides.length; index += 1) {
      if (!slides[index].length) continue;
      const filename = `ppt/slides/slide${index + 1}.xml`;
      const slide = archive.file(filename);
      if (!slide) throw new Error("PowerPoint could not find a product slide.");
      archive.file(filename, groupSlideXml(await slide.async("string"), slides[index]));
    }
    return archive.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  }

  async function writeFile(pptx, options, download) {
    if (!(deckSlides.get(pptx) || []).some((groups) => groups.length)) return pptx.writeFile(options);
    const data = await serialize(pptx);
    download(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), options.fileName);
  }

  globalObject.PPTXEditable = Object.freeze({ addCard, registerSlide, groupSlideXml, serialize, writeFile });
}(globalThis));
