(function (root) {
  "use strict";
  const audioCategories = new Set(["pc-gaming-audio", "console-gaming-audio", "lifestyle-audio"]);
  const cache = new WeakMap();
  const MAX_SAMPLE_EDGE = 512;
  // Reviewed native filenames carry a source SHA prefix. Matching
  // intrinsic dimensions are also required. These frames retain the complete
  // headband, both earcups and attached microphone while trimming cable excess
  // only in presentation. Full original files and their pixels are retained.
  const bodyFrames = new Map([
    ["27feec6ada7e533e8e5c", { imageWidth: 800, imageHeight: 600, bounds: { x: 234, y: 116, width: 331, height: 367 } }],
    ["6fc2e505dc1337f78f61", { imageWidth: 800, imageHeight: 600, bounds: { x: 234, y: 116, width: 331, height: 367 } }],
    ["210c7f8f500e1ce54a87", { imageWidth: 800, imageHeight: 600, bounds: { x: 234, y: 116, width: 331, height: 367 } }],
    ["30a02a54ddf1df67776e", { imageWidth: 800, imageHeight: 600, bounds: { x: 184, y: 77, width: 463, height: 445 } }],
    ["3c9375e95816fded3e1c", { imageWidth: 800, imageHeight: 600, bounds: { x: 184, y: 77, width: 464, height: 446 } }],
    ["3002d09aeee2660eb39d", { imageWidth: 800, imageHeight: 600, bounds: { x: 184, y: 76, width: 464, height: 447 } }],
    ["31b6e668cf0ace213244", { imageWidth: 800, imageHeight: 600, bounds: { x: 184, y: 77, width: 463, height: 445 } }],
    ["d91fb6ada70675ebeefa", { imageWidth: 800, imageHeight: 600, bounds: { x: 202, y: 92, width: 423, height: 403 } }],
    ["35512f72ebe7ff2f55e7", { imageWidth: 800, imageHeight: 600, bounds: { x: 202, y: 92, width: 423, height: 403 } }],
    ["08468e3b3342d4a7b8a2", { imageWidth: 800, imageHeight: 600, bounds: { x: 242, y: 65, width: 315, height: 390 } }],
    ["78c12b760cb45938c195", { imageWidth: 800, imageHeight: 600, bounds: { x: 184, y: 77, width: 464, height: 445 } }],
    ["d7460ce771081174e91f", { imageWidth: 800, imageHeight: 600, bounds: { x: 184, y: 77, width: 464, height: 445 } }],
    ["6a8fff36452373a5219e", { imageWidth: 800, imageHeight: 600, bounds: { x: 184, y: 77, width: 464, height: 446 } }],
    ["ddb75a31e1ad7f9a09f9", { imageWidth: 800, imageHeight: 600, bounds: { x: 238, y: 58, width: 325, height: 413 } }],
    ["1beda1eadb7cc9501325", { imageWidth: 480, imageHeight: 480, bounds: { x: 75, y: 70, width: 330, height: 336 } }],
    ["8946d6feaaba62931600", { imageWidth: 800, imageHeight: 600, bounds: { x: 229, y: 59, width: 375, height: 400 } }],
    ["bd8333ac7b8231738aea", { imageWidth: 800, imageHeight: 600, bounds: { x: 237, y: 46, width: 326, height: 414 } }],
    ["c920c19c8aa0a76a744f", { imageWidth: 800, imageHeight: 600, bounds: { x: 235, y: 46, width: 328, height: 417 } }],
    ["897cc746ba528adac5af", { imageWidth: 800, imageHeight: 600, bounds: { x: 235, y: 46, width: 329, height: 418 } }],
    ["b01de340f65f0078a64c", { imageWidth: 800, imageHeight: 600, bounds: { x: 237, y: 52, width: 326, height: 414 } }],
    ["7a868bc7d190262052c3", { imageWidth: 800, imageHeight: 600, bounds: { x: 236, y: 46, width: 327, height: 417 } }],
    ["417f1b04bf40a8fa38d2", { imageWidth: 800, imageHeight: 600, bounds: { x: 235, y: 46, width: 330, height: 418 } }],
    ["dda74ba64bde65b60f5a", { imageWidth: 800, imageHeight: 600, bounds: { x: 236, y: 46, width: 328, height: 417 } }],
    ["6dc9b5f8a5b0c6292a31", { imageWidth: 800, imageHeight: 600, bounds: { x: 184, y: 77, width: 464, height: 446 } }],
    ["a42c61a2f4b886d31b14", { imageWidth: 480, imageHeight: 480, bounds: { x: 81, y: 73, width: 340, height: 324 } }],
  ]);
  const usesAudioFraming = (categoryId, product = null) => audioCategories.has(categoryId)
    && !(product && /earbuds|earphones|cirro|\bbuds?\d*/i.test(String(product.name || "")));

  // Measure transparent padding once per decoded image. Pixels and saved assets
  // remain unchanged; the result is only a presentation source rectangle.
  function boundsFromPixels(data, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data?.length !== width * height * 4) return null;
    let left = width, top = height, right = -1, bottom = -1, transparent = false;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha < 255) transparent = true;
        if (alpha <= 8) continue;
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) return null;
    if (!transparent) return { x: 0, y: 0, width, height };
    // Keep a small antialias/shadow margin around the complete visible subject.
    const margin = 2;
    left = Math.max(0, left - margin); top = Math.max(0, top - margin);
    right = Math.min(width - 1, right + margin); bottom = Math.min(height - 1, bottom + margin);
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }

  function measure(image) {
    if (!image || typeof image !== "object") return null;
    if (cache.has(image)) return cache.get(image);
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    if (!(width > 0 && height > 0)) return null;
    let bounds = null;
    try {
      const scale = Math.min(1, MAX_SAMPLE_EDGE / width, MAX_SAMPLE_EDGE / height);
      const sampleWidth = Math.max(1, Math.round(width * scale)), sampleHeight = Math.max(1, Math.round(height * scale));
      const canvas = root.document.createElement("canvas");
      canvas.width = sampleWidth; canvas.height = sampleHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
      const sample = boundsFromPixels(context.getImageData(0, 0, sampleWidth, sampleHeight).data, sampleWidth, sampleHeight);
      if (sample) bounds = { x: sample.x * width / sampleWidth, y: sample.y * height / sampleHeight, width: sample.width * width / sampleWidth, height: sample.height * height / sampleHeight };
      canvas.width = 0; canvas.height = 0;
    } catch (_) {
      // An unreadable remote image retains ordinary contain behavior.
    }
    cache.set(image, bounds);
    return bounds;
  }

  function placement(image, box, bounds = measure(image)) {
    const imageWidth = image?.naturalWidth || image?.width, imageHeight = image?.naturalHeight || image?.height;
    if (!(imageWidth > 0 && imageHeight > 0 && box?.width > 0 && box?.height > 0)) return null;
    const source = bounds || { x: 0, y: 0, width: imageWidth, height: imageHeight };
    if (![source.x, source.y, source.width, source.height, box.x, box.y, box.width, box.height].every(Number.isFinite) || source.x < 0 || source.y < 0 || source.width <= 0 || source.height <= 0 || source.x + source.width > imageWidth + .01 || source.y + source.height > imageHeight + .01) return null;
    const scale = Math.min(box.width * .98 / source.width, box.height * .98 / source.height);
    const width = source.width * scale, height = source.height * scale;
    return { source, x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
  }

  function draw(context, image, box, { assetName = "" } = {}) {
    const sourceKey = String(assetName).match(/^.+-([a-f0-9]{20})\.png$/)?.[1];
    const reviewed = bodyFrames.get(sourceKey);
    const bounds = reviewed && image.naturalWidth === reviewed.imageWidth && image.naturalHeight === reviewed.imageHeight ? reviewed.bounds : null;
    const frame = bounds ? placement(image, box, bounds) : placement(image, box);
    if (!frame) return false;
    const s = frame.source;
    context.drawImage(image, s.x, s.y, s.width, s.height, frame.x, frame.y, frame.width, frame.height);
    return true;
  }

  root.PortfolioImageFraming = Object.freeze({ usesAudioFraming, boundsFromPixels, measure, placement, draw });
})(globalThis);
