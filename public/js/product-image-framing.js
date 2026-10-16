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
  // Only independently reviewed left-side originals can use mouse framing.
  // Unknown or held artwork keeps ordinary contain rendering in the caller.
  const mouseProfiles = new Map([
    ["088fab7f645358a7365b", { imageWidth: 800, imageHeight: 600 }],
    ["0bcad882a144e151b997", { imageWidth: 800, imageHeight: 600 }],
    ["0f3fd637592636b2ebca", { imageWidth: 800, imageHeight: 600 }],
    ["1623e372a00d64800552", { imageWidth: 800, imageHeight: 600 }],
    ["201a720e9b6c2411017d", { imageWidth: 800, imageHeight: 600, bounds: { x: 215, y: 238, width: 410, height: 148 } }],
    ["233168acdf128d45c482", { imageWidth: 800, imageHeight: 600 }],
    ["2c02e9114c417c6c3b83", { imageWidth: 832, imageHeight: 308 }],
    ["40fc155b2cf535f621d1", { imageWidth: 800, imageHeight: 600, bounds: { x: 204, y: 233, width: 419, height: 135 } }],
    ["43022fe7844a8e8edbde", { imageWidth: 800, imageHeight: 600 }],
    ["6541bd9b2ea10a8ae89e", { imageWidth: 800, imageHeight: 600, bounds: { x: 204, y: 233, width: 419, height: 135 } }],
    ["8b66fddfb618bae1f00c", { imageWidth: 800, imageHeight: 600 }],
    ["92a0a4f0192a336e0ccd", { imageWidth: 800, imageHeight: 600, bounds: { x: 188, y: 233, width: 425, height: 135 } }],
    ["9b13bbfcfff7a439f115", { imageWidth: 800, imageHeight: 600 }],
    ["a8fac4586682179db478", { imageWidth: 800, imageHeight: 600 }],
    ["bb8b8a030a09cf3c2fcf", { imageWidth: 800, imageHeight: 600 }],
    ["bc4abe5f0d72502a7d5b", { imageWidth: 800, imageHeight: 600 }],
    ["eab95aabb27d4e94ec3f", { imageWidth: 800, imageHeight: 600 }],
  ]);
  const mouseProfile = assetName => mouseProfiles.get(String(assetName).match(/^.+-([a-f0-9]{20})\.png$/)?.[1]);
  const usesMouseFraming = (categoryId, assetName = "") => categoryId === "mice" && Boolean(mouseProfile(assetName));

  // Reviewed flat keyfaces use a common body height and fixed right edge.
  // Wider layouts may leave the card on the left. The source crop records that
  // presentation directly, so canvas and editable exports use identical pixels.
  const keyboardProfiles = new Map([
    ["1183581840a8ecc86f5d", { imageWidth: 800, imageHeight: 600, bounds: { x: 154, y: 205, width: 505, height: 186 } }],
    ["1729e6c84cf82f34f4f7", { imageWidth: 800, imageHeight: 600, bounds: { x: 151, y: 215, width: 497, height: 161 } }],
    ["1b3b0e3f94aaf95f9030", { imageWidth: 800, imageHeight: 600, bounds: { x: 218, y: 215, width: 365, height: 161 } }],
    ["28e20945a3588b895873", { imageWidth: 800, imageHeight: 600, bounds: { x: 153, y: 214, width: 495, height: 173 } }],
    ["5cca091d9439ebd25678", { imageWidth: 800, imageHeight: 600, bounds: { x: 213, y: 232, width: 373, height: 137 } }],
    ["62f2f17274a3ae9eea3a", { imageWidth: 800, imageHeight: 600, bounds: { x: 156, y: 205, width: 488, height: 187 } }],
    ["7cc528d2a3439906b48c", { imageWidth: 800, imageHeight: 600, bounds: { x: 218, y: 214, width: 365, height: 162 } }],
    ["c2de56fd269b8e18f3fc", { imageWidth: 800, imageHeight: 600, bounds: { x: 152, y: 215, width: 495, height: 155 } }],
    ["e96930ebe62d2095abcd", { imageWidth: 800, imageHeight: 600, bounds: { x: 184, y: 216, width: 432, height: 161 } }],
    ["ef613d5da697a76f227c", { imageWidth: 800, imageHeight: 600, bounds: { x: 153, y: 214, width: 495, height: 149 } }],
    ["f44cfd84f8d86580f401", { imageWidth: 800, imageHeight: 600, bounds: { x: 213, y: 232, width: 374, height: 137 } }],
    ["fc61d8ec11bbbbb2636e", { imageWidth: 800, imageHeight: 600, bounds: { x: 173, y: 212, width: 454, height: 166 } }],
    ["fd3ed8b9b1e16f54d526", { imageWidth: 800, imageHeight: 600, bounds: { x: 153, y: 196, width: 495, height: 189 } }],
  ]);
  const keyboardProfile = assetName => keyboardProfiles.get(String(assetName).match(/^.+-([a-f0-9]{20})\.png$/)?.[1]);
  const usesKeyboardFraming = (categoryId, assetName = "") => categoryId === "keyboards" && Boolean(keyboardProfile(assetName));

  function keyboardPlacement(image, box, bounds) {
    const imageWidth = image?.naturalWidth, imageHeight = image?.naturalHeight;
    if (!(imageWidth > 0 && imageHeight > 0 && box?.width > 0 && box?.height > 0 && bounds)) return null;
    const values = [bounds.x, bounds.y, bounds.width, bounds.height, box.x, box.y, box.width, box.height];
    if (!values.every(Number.isFinite) || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 || bounds.x + bounds.width > imageWidth || bounds.y + bounds.height > imageHeight) return null;
    const height = Math.min(112, box.height), scale = height / bounds.height;
    const availableWidth = box.width + 18;
    const width = Math.min(bounds.width * scale, availableWidth);
    const sourceWidth = width / scale;
    return {
      source: { x: bounds.x + bounds.width - sourceWidth, y: bounds.y, width: sourceWidth, height: bounds.height },
      x: box.x + box.width - width, y: box.y + (box.height - height) / 2, width, height,
    };
  }

  function drawKeyboard(context, image, box, { assetName = "" } = {}) {
    const reviewed = keyboardProfile(assetName);
    if (!reviewed || image?.naturalWidth !== reviewed.imageWidth || image?.naturalHeight !== reviewed.imageHeight) return false;
    const frame = keyboardPlacement(image, box, reviewed.bounds);
    if (!frame) return false;
    const s = frame.source;
    context.drawImage(image, s.x, s.y, s.width, s.height, frame.x, frame.y, frame.width, frame.height);
    return true;
  }

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

  function drawMouse(context, image, box, { assetName = "" } = {}) {
    const reviewed = mouseProfile(assetName);
    if (!reviewed || image?.naturalWidth !== reviewed.imageWidth || image?.naturalHeight !== reviewed.imageHeight) return false;
    const frame = placement(image, box, reviewed.bounds || measure(image));
    if (!frame) return false;
    const s = frame.source;
    context.drawImage(image, s.x, s.y, s.width, s.height, frame.x, frame.y, frame.width, frame.height);
    return true;
  }

  root.PortfolioImageFraming = Object.freeze({ usesAudioFraming, usesMouseFraming, usesKeyboardFraming, boundsFromPixels, measure, placement, keyboardPlacement, draw, drawMouse, drawKeyboard });
})(globalThis);
