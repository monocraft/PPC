"use strict";

const STORAGE_KEY = "product-portfolio-canvas-v1";
const CARD_WIDTH = 246;
const CARD_HEIGHT = 552;
const CARD_GAP = 10;
const GUTTER = 88;
const LANE_TOP = 34;
const LANE_HEIGHT = 622;
const SIDE_PADDING = 40;
const STATUS_BANNER_HEIGHT = 24;
const IMAGE_SLOT_TOP = STATUS_BANNER_HEIGHT + 10;
const IMAGE_SLOT_HEIGHT = 112;
const TITLE_BLOCK_TOP = IMAGE_SLOT_TOP + IMAGE_SLOT_HEIGHT + 6;
const PRICE_BASELINE_OFFSET = 53;
const DETAILS_TOP_OFFSET = 66;
const PLACEHOLDER_IMAGE = "assets/headset-placeholder.svg";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#boardCanvas");
const ctx = canvas.getContext("2d");
const inspector = $("#inspector");
const imageCache = new Map();

let board = loadBoard();
let selectedId = board.products[0]?.id ?? null;
let zoom = 0.82;
let searchQuery = "";
let dragState = null;
let renderedCards = [];
let saveTimer = null;

function id() {
  return crypto.randomUUID();
}

function spec(label, value) {
  return { id: id(), label, value };
}

function sku(code, colorName, colorHex) {
  return { id: id(), code, colorName, colorHex };
}

function makeProduct(productId, name, price, laneId, order, options = {}) {
  return {
    id: productId,
    name,
    price,
    imageUrl: "",
    laneId,
    order,
    statusType: options.statusType || "none",
    statusLabel: options.statusLabel || "",
    highlightEnabled: Boolean(options.highlightEnabled),
    highlightColor: options.highlightColor || "#e44168",
    specs: options.specs || [],
    skus: options.skus || [],
  };
}

function createDefaultBoard() {
  return {
    version: 1,
    title: "Gaming Headset Portfolio",
    lanes: [
      { id: "wired", label: "WIRED", subtitle: "GAMING HEADSET", order: 0 },
      { id: "wireless", label: "WIRELESS", subtitle: "GAMING HEADSET", order: 1 },
    ],
    settings: { freeMove: false, showPrices: true, showSkus: true },
    products: [
      makeProduct("cloud-stinger-2-core", "Cloud Stinger 2 Core", 39.99, "wired", 0, { specs: [
        spec("Connection", "3.5mm"), spec("Microphone", "Bi-directional noise cancelling"),
        spec("Drivers", "40mm · 10Hz–25kHz"), spec("Audio", "DTS Headphone:X Spatial Audio"),
        spec("Cushions", "Fabric / Soft Foam"), spec("Frame", "Plastic"), spec("Controls", "Onboard control"),
      ], skus: [sku("BK", "Black", "#111111")] }),
      makeProduct("cloud-jet-2", "Cloud Jet 2", 39.99, "wired", 1, { statusType: "embargo", statusLabel: "UPCOMING UNDER EMBARGO", highlightEnabled: true, specs: [
        spec("Connection", "3.5mm"), spec("Microphone", "6mm uni-directional"),
        spec("Drivers", "40mm · 20Hz–20kHz"), spec("Cushions", "Fabric / Soft Foam"),
        spec("Frame", "Plastic"), spec("Controls", "Onboard"),
      ], skus: [sku("BK", "Black", "#111111"), sku("GRY", "Gray", "#666666")] }),
      makeProduct("cloud-stinger-3", "Cloud Stinger 3", 59.99, "wired", 2, { statusType: "new", statusLabel: "NEW PRODUCT", highlightColor: "#5b8f3e", specs: [
        spec("Connection", "3.5mm"), spec("Microphone", "Bi-directional noise cancelling"),
        spec("Drivers", "50mm · 10Hz–28kHz"), spec("Cushions", "Leatherette / Memory Foam"),
        spec("Frame", "Plastic / Steel"), spec("Controls", "Onboard control"),
      ] }),
      makeProduct("cloud-ii", "Cloud II", 79.99, "wired", 3, { specs: [
        spec("Connection", "3.5mm, USB-A"), spec("Microphone", "Bi-directional noise cancelling"),
        spec("Drivers", "53mm · 10Hz–23kHz"), spec("Audio", "HyperX Virtual 7.1 Surround"),
        spec("Cushions", "Leatherette / Memory Foam"), spec("Frame", "Metal (Aluminum / Steel)"),
        spec("Controls", "Audio control box"),
      ] }),
      makeProduct("cloud-iii", "Cloud III", 99.99, "wired", 4, { specs: [
        spec("Connection", "3.5mm, USB-C, USB-A"), spec("Microphone", "10mm uni-directional, noise cancelling"),
        spec("Drivers", "53mm · 10Hz–21kHz"), spec("Audio", "DTS Headphone:X Spatial Audio"),
        spec("Cushions", "Leatherette / Memory Foam"), spec("Frame", "Metal (Aluminum / Steel)"),
        spec("Controls", "Onboard"),
      ], skus: [sku("BLK", "Black", "#111111"), sku("WHT", "White", "#f0f0f0"), sku("BLK/RED", "Black / Red", "#a61c24")] }),
      makeProduct("cloud-alpha", "Cloud Alpha", 99.99, "wired", 5, { specs: [
        spec("Connection", "3.5mm"), spec("Microphone", "Bi-directional noise cancelling"),
        spec("Drivers", "50mm · 13Hz–27kHz"), spec("Audio", "DTS Headphone:X Spatial Audio"),
        spec("Cushions", "Leatherette / Memory Foam"), spec("Frame", "Metal (Aluminum / Steel)"),
        spec("Controls", "In-line"),
      ] }),
      makeProduct("cloud-alpha-air", "Cloud Alpha Air", 149.99, "wired", 6, { statusType: "embargo", statusLabel: "UPCOMING UNDER EMBARGO", highlightEnabled: true, specs: [
        spec("Connection", "USB-A / 3.5mm"), spec("Microphone", "10mm uni-directional noise cancelling"),
        spec("Drivers", "40mm · 10Hz–25kHz"), spec("Audio", "Hear360"),
        spec("Cushions", "Microfiber / Memory Foam"), spec("Frame", "Metal (Aluminum / Steel)"),
        spec("Controls", "Onboard"),
      ] }),
      makeProduct("cloud-jet-wireless", "Cloud Jet Wireless", 79.99, "wireless", 0, { specs: [
        spec("Wireless", "Dual Wireless, 2.4GHz & BT 5.3"), spec("Battery", "20 hours RF · 25 hours BT"),
        spec("Microphone", "6mm uni-directional"), spec("Drivers", "40mm · 20Hz–20kHz"),
        spec("Cushions", "Fabric / Soft Foam"), spec("Frame", "Plastic"), spec("Controls", "Onboard"),
      ] }),
      makeProduct("cloud-jet-2-wireless", "Cloud Jet 2 Wireless", 79.99, "wireless", 1, { statusType: "embargo", statusLabel: "UPCOMING UNDER EMBARGO", highlightEnabled: true, specs: [
        spec("Wireless", "Dual Wireless, 2.4GHz & BT 5.3"), spec("Battery", "20 hours RF · 25 hours BT"),
        spec("Microphone", "6mm uni-directional"), spec("Drivers", "40mm · 20Hz–20kHz"),
        spec("Cushions", "Fabric / Soft Foam"), spec("Frame", "Plastic"), spec("Controls", "Onboard"),
      ], skus: [sku("BK", "Black", "#111111"), sku("GRY", "Gray", "#666666")] }),
      makeProduct("cloud-stinger-3-wireless", "Cloud Stinger 3 Wireless", 99.99, "wireless", 2, { statusType: "new", statusLabel: "NEW PRODUCT", highlightColor: "#5b8f3e", specs: [
        spec("Wireless", "2.4GHz / Bluetooth"), spec("Battery", "80 hours"),
        spec("Microphone", "Bi-directional noise cancelling"), spec("Drivers", "50mm · 10Hz–28kHz"),
        spec("Audio", "Hear360"), spec("Cushions", "Leatherette / Memory Foam"),
        spec("Frame", "Plastic / Steel"), spec("Controls", "Onboard control"),
      ] }),
      makeProduct("cloud-flight-2-wireless", "Cloud Flight 2 Wireless", 129.99, "wireless", 3, { specs: [
        spec("Wireless", "2.4GHz USB-C/USB-A, Bluetooth"), spec("Battery", "100 hours RF · 150 hours BT"),
        spec("Microphone", "10mm uni-directional, noise cancelling"), spec("Drivers", "50mm · 20Hz–20kHz"),
        spec("Audio", "Hear360"), spec("Cushions", "Leatherette / Memory Foam"),
        spec("Frame", "Plastic / Metal"), spec("Controls", "Onboard"),
      ], skus: [sku("BK", "Black", "#111111"), sku("WHT", "White", "#f0f0f0"), sku("LVR", "Lavender", "#8d78aa")] }),
      makeProduct("cloud-iii-s-wireless", "Cloud III S Wireless", 179.99, "wireless", 4, { specs: [
        spec("Wireless", "2.4GHz USB-C/USB-A, Bluetooth, Instant Pair"), spec("Battery", "120 hours RF · 200 hours BT"),
        spec("Microphone", "10mm uni-directional, noise cancelling"), spec("Drivers", "53mm · 10Hz–21kHz"),
        spec("Audio", "DTS Headphone:X Spatial Audio"), spec("Cushions", "Leatherette / Memory Foam"),
        spec("Frame", "Metal (Aluminum / Steel)"), spec("Controls", "Onboard"),
      ], skus: [sku("BLK", "Black", "#111111"), sku("WHT", "White", "#f0f0f0"), sku("BLK/RED", "Black / Red", "#a61c24")] }),
      makeProduct("cloud-alpha-wireless", "Cloud Alpha Wireless", 199.99, "wireless", 5, { specs: [
        spec("Wireless", "2.4GHz (USB-A)"), spec("Battery", "300 hours"),
        spec("Microphone", "Bi-directional noise cancelling"), spec("Drivers", "50mm · 15Hz–21kHz"),
        spec("Audio", "DTS Headphone:X Spatial Audio"), spec("Cushions", "Leatherette / Memory Foam"),
        spec("Frame", "Metal (Aluminum / Steel)"), spec("Controls", "Onboard"),
      ] }),
      makeProduct("cloud-alpha-2-wireless", "Cloud Alpha 2 Wireless", 299.99, "wireless", 6, { specs: [
        spec("Wireless", "Dual Wireless 2.4GHz + BT 5.3, 3.5mm"), spec("Battery", "250 hours"),
        spec("Microphone", "10mm uni-directional noise cancelling"), spec("Drivers", "53mm · 10Hz–27kHz"),
        spec("Audio", "Hear360"), spec("Cushions", "Microfiber / Memory Foam"),
        spec("Frame", "Metal (Aluminum / Steel)"), spec("Controls", "Onboard, base station"),
      ], skus: [sku("BLK", "Black", "#111111"), sku("WHT", "White", "#f0f0f0")] }),
    ],
  };
}

function loadBoard() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed?.version === 1 && Array.isArray(parsed.products) && Array.isArray(parsed.lanes)) return parsed;
  } catch (_) {}
  return createDefaultBoard();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(board)), 120);
}

function updateBoard(mutator, { inspector: updateInspector = false } = {}) {
  mutator(board);
  scheduleSave();
  syncControls();
  if (updateInspector) renderInspector();
  renderBoard();
}

function sortedLanes() {
  return [...board.lanes].sort((a, b) => a.order - b.order);
}

function visibleProducts() {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return board.products;
  return board.products.filter((product) => {
    const haystack = [product.name, product.statusLabel, ...product.skus.map((item) => item.code), ...product.specs.flatMap((item) => [item.label, item.value])].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function getCanvasDimensions() {
  const lanes = sortedLanes();
  const products = visibleProducts();
  const maxCount = Math.max(1, ...lanes.map((lane) => products.filter((product) => product.laneId === lane.id).length));
  return {
    width: Math.max(1480, GUTTER + maxCount * (CARD_WIDTH + CARD_GAP) + SIDE_PADDING),
    height: LANE_TOP + lanes.length * LANE_HEIGHT + 20,
  };
}

function setupCanvas(targetCanvas, drawZoom = zoom) {
  const dimensions = getCanvasDimensions();
  const dpr = window.devicePixelRatio || 1;
  targetCanvas.width = Math.round(dimensions.width * drawZoom * dpr);
  targetCanvas.height = Math.round(dimensions.height * drawZoom * dpr);
  targetCanvas.style.width = `${dimensions.width * drawZoom}px`;
  targetCanvas.style.height = `${dimensions.height * drawZoom}px`;
  const context = targetCanvas.getContext("2d");
  context.setTransform(dpr * drawZoom, 0, 0, dpr * drawZoom, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return { context, dimensions };
}

function roundRect(context, x, y, width, height, radius, fill, stroke, lineWidth = 1) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  if (fill) { context.fillStyle = fill; context.fill(); }
  if (stroke) { context.strokeStyle = stroke; context.lineWidth = lineWidth; context.stroke(); }
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines = 2, align = "left") {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (context.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(" ").length;
  if (consumed < String(text).length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  context.textAlign = align;
  lines.forEach((item, index) => context.fillText(item, x, y + index * lineHeight));
  return lines.length;
}

function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const image = new Image();
  image.crossOrigin = "anonymous";
  const record = { image, ready: false, failed: false };
  image.onload = () => { record.ready = true; renderBoard(); };
  image.onerror = () => { record.failed = true; };
  image.src = src;
  imageCache.set(src, record);
  return record;
}

function drawContainedImage(context, image, x, y, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawBoardTo(context, dimensions, includeSelection = true) {
  context.clearRect(0, 0, dimensions.width, dimensions.height);
  context.fillStyle = "#171917";
  context.fillRect(0, 0, dimensions.width, dimensions.height);

  context.save();
  context.globalAlpha = 0.08;
  context.fillStyle = "#ffffff";
  for (let y = 8; y < dimensions.height; y += 12) {
    for (let x = 8 + ((y / 12) % 2) * 6; x < dimensions.width; x += 12) context.fillRect(x, y, 1, 1);
  }
  context.restore();

  const lanes = sortedLanes();
  const products = visibleProducts();
  renderedCards = [];

  lanes.forEach((lane, laneIndex) => {
    const laneY = LANE_TOP + laneIndex * LANE_HEIGHT;
    roundRect(context, GUTTER - 12, laneY - 4, dimensions.width - GUTTER - 12, CARD_HEIGHT + 8, 5, "#1b1d1b");

    context.save();
    context.translate(43, laneY + CARD_HEIGHT - 10);
    context.rotate(-Math.PI / 2);
    context.fillStyle = "#f1f1f1";
    context.font = "700 25px Arial";
    context.textAlign = "left";
    context.fillText(lane.label, 0, 0);
    context.fillStyle = "#a5a8a5";
    context.font = "10px Arial";
    context.fillText(lane.subtitle, 0, 20);
    context.restore();

    products
      .filter((product) => product.laneId === lane.id)
      .sort((a, b) => a.order - b.order)
      .forEach((product, displayIndex) => {
        const automatic = { x: GUTTER + displayIndex * (CARD_WIDTH + CARD_GAP), y: laneY };
        let position = board.settings.freeMove && product.manualPosition ? product.manualPosition : automatic;
        if (dragState?.productId === product.id) position = dragState.position;
        renderedCards.push({ productId: product.id, laneId: lane.id, x: position.x, y: position.y, width: CARD_WIDTH, height: CARD_HEIGHT });
        drawCard(context, product, position.x, position.y, includeSelection && product.id === selectedId);
      });
  });
}

function drawCard(context, product, x, y, selected) {
  context.save();
  context.shadowColor = "rgba(0,0,0,.45)";
  context.shadowBlur = 8;
  context.shadowOffsetY = 3;
  const stroke = selected ? "#efefef" : product.highlightEnabled ? product.highlightColor : "#383b38";
  roundRect(context, x, y, CARD_WIDTH, CARD_HEIGHT, 4, "#232523", stroke, selected ? 3 : product.highlightEnabled ? 2 : 1);
  context.restore();

  const hasStatus = product.statusType !== "none" && product.statusLabel.trim();
  if (hasStatus) {
    const colors = { new: "#4e8136", embargo: "#b83458", custom: "#7b6428", none: "#2a2c2a" };
    roundRect(context, x, y, CARD_WIDTH, STATUS_BANNER_HEIGHT, [4, 4, 0, 0], colors[product.statusType] || colors.custom);
    context.fillStyle = "#ffffff";
    context.font = "700 10px Arial";
    context.textAlign = "center";
    context.fillText(product.statusLabel.toUpperCase(), x + CARD_WIDTH / 2, y + 16);
  }

  // Keep every product header on the same fixed grid. Status banners occupy
  // a reserved strip and never push the image, product name, price, or divider.
  const imageTop = y + IMAGE_SLOT_TOP;
  const imageRecord = loadImage(product.imageUrl || PLACEHOLDER_IMAGE);
  if (imageRecord.ready) drawContainedImage(context, imageRecord.image, x + 18, imageTop, CARD_WIDTH - 36, IMAGE_SLOT_HEIGHT);

  const titleTop = y + TITLE_BLOCK_TOP;
  context.fillStyle = "#f2f2f2";
  context.font = "700 16px Arial";
  context.textAlign = "center";
  wrapText(context, product.name, x + CARD_WIDTH / 2, titleTop + 15, CARD_WIDTH - 24, 18, 2, "center");

  if (board.settings.showPrices) {
    context.fillStyle = "#777b77";
    context.font = "16px Arial";
    context.fillText(product.price == null ? "Price TBD" : `$${Number(product.price).toFixed(2)}`, x + CARD_WIDTH / 2, titleTop + PRICE_BASELINE_OFFSET);
  }

  const detailsTop = titleTop + DETAILS_TOP_OFFSET;
  context.strokeStyle = "#383b38";
  context.lineWidth = 1;
  context.beginPath(); context.moveTo(x, detailsTop); context.lineTo(x + CARD_WIDTH, detailsTop); context.stroke();

  const footerHeight = board.settings.showSkus && product.skus.length ? 72 : 0;
  const detailsBottom = y + CARD_HEIGHT - footerHeight;
  const visibleSpecs = product.specs.slice(0, 8);
  visibleSpecs.forEach((item, index) => {
    const rowY = detailsTop + 11 + index * 34;
    if (rowY + 31 > detailsBottom) return;
    roundRect(context, x + 11, rowY + 2, 13, 13, 3, null, "#666a66");
    context.fillStyle = "#777b77";
    context.font = "10px Arial";
    context.textAlign = "left";
    context.fillText(truncate(item.label, 14), x + 32, rowY + 10);
    context.fillStyle = "#c7c9c7";
    context.font = "11px Arial";
    wrapText(context, item.value, x + 102, rowY + 10, 132, 13, 2, "left");
    context.strokeStyle = "#303230";
    context.beginPath(); context.moveTo(x + 10, rowY + 27); context.lineTo(x + CARD_WIDTH - 10, rowY + 27); context.stroke();
  });

  if (product.specs.length > visibleSpecs.length) {
    context.fillStyle = "#8d918d";
    context.font = "10px Arial";
    context.textAlign = "right";
    context.fillText(`+ ${product.specs.length - visibleSpecs.length} more specifications`, x + CARD_WIDTH - 12, detailsBottom - 10);
  }

  if (footerHeight) {
    const footerY = y + CARD_HEIGHT - footerHeight;
    roundRect(context, x, footerY, CARD_WIDTH, footerHeight, [0, 0, 4, 4], "#284f1d");
    context.fillStyle = "#7eb45d";
    context.font = "700 9px Arial";
    context.textAlign = "left";
    context.fillText("COLOR SKU", x + 12, footerY + 16);
    product.skus.slice(0, 5).forEach((item, index) => {
      const sx = x + 12 + (index % 3) * 75;
      const sy = footerY + 28 + Math.floor(index / 3) * 20;
      context.fillStyle = item.colorHex;
      context.fillRect(sx, sy, 10, 10);
      context.strokeStyle = "#a7aaa7";
      context.lineWidth = .5;
      context.strokeRect(sx, sy, 10, 10);
      context.fillStyle = "#f0f0f0";
      context.font = "700 10px Arial";
      context.fillText(item.code, sx + 15, sy + 9);
    });
  }
}

function renderBoard() {
  const { context, dimensions } = setupCanvas(canvas, zoom);
  drawBoardTo(context, dimensions, true);
  $("#zoomLabel").textContent = `${Math.round(zoom * 100)}%`;
  renderStatus();
}

function renderStatus() {
  $("#statusbar").innerHTML = `
    <span>${board.products.length} products</span>
    <span>${board.lanes.length} lanes</span>
    <span>Autosaved in this browser</span>
    <span>${board.settings.freeMove ? "Free-position mode" : "Snap/reorder mode"}</span>`;
}

function selectedProduct() {
  return board.products.find((product) => product.id === selectedId) || null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function renderInspector() {
  const product = selectedProduct();
  if (!product) {
    inspector.className = "inspector inspector-empty";
    inspector.innerHTML = "<h2>Product details</h2><p>Select a card to edit its product information, status, specifications, image, and SKUs.</p>";
    return;
  }
  inspector.className = "inspector";
  inspector.innerHTML = `
    <div class="inspector-heading">
      <div><span class="eyebrow">Selected product</span><h2>${escapeHtml(product.name)}</h2></div>
      <button id="deleteProduct" class="danger-button">Delete</button>
    </div>
    <section class="panel-section">
      <h3>Product</h3>
      <label>Name<input id="fieldName" value="${escapeHtml(product.name)}"></label>
      <div class="two-column">
        <label>Price<input id="fieldPrice" type="number" step="0.01" value="${product.price ?? ""}"></label>
        <label>Lane<select id="fieldLane">${sortedLanes().map((lane) => `<option value="${lane.id}" ${lane.id === product.laneId ? "selected" : ""}>${escapeHtml(lane.label)}</option>`).join("")}</select></label>
      </div>
      <label>Product image URL<input id="fieldImageUrl" placeholder="https://... or upload below" value="${product.imageUrl.startsWith("data:") ? "" : escapeHtml(product.imageUrl)}"></label>
      <label class="file-input">Upload image<input id="fieldImageUpload" type="file" accept="image/*"></label>
      ${product.imageUrl ? '<button id="clearImage" class="secondary-button">Use placeholder image</button>' : ""}
    </section>
    <section class="panel-section">
      <h3>Status and highlight</h3>
      <label>Status<select id="fieldStatus">
        <option value="none" ${product.statusType === "none" ? "selected" : ""}>None</option>
        <option value="new" ${product.statusType === "new" ? "selected" : ""}>New product</option>
        <option value="embargo" ${product.statusType === "embargo" ? "selected" : ""}>Under embargo</option>
        <option value="custom" ${product.statusType === "custom" ? "selected" : ""}>Custom</option>
      </select></label>
      <label>Banner label<input id="fieldStatusLabel" value="${escapeHtml(product.statusLabel)}" placeholder="NEW PRODUCT"></label>
      <div class="toggle-row">
        <label class="checkbox-label"><input id="fieldHighlight" type="checkbox" ${product.highlightEnabled ? "checked" : ""}>Highlight card</label>
        <input id="fieldHighlightColor" aria-label="Highlight color" type="color" value="${product.highlightColor}">
      </div>
    </section>
    <section class="panel-section">
      <div class="section-heading-row"><h3>Specifications</h3><button id="addSpec" class="small-button">+ Add</button></div>
      <div class="stack-list">${product.specs.length ? product.specs.map((item, index) => `
        <div class="editable-row" data-spec-id="${item.id}">
          <input data-spec-field="label" value="${escapeHtml(item.label)}" aria-label="Specification ${index + 1} label">
          <input data-spec-field="value" value="${escapeHtml(item.value)}" aria-label="Specification ${index + 1} value">
          <button data-remove-spec="${item.id}" class="icon-button" aria-label="Remove specification ${index + 1}">×</button>
        </div>`).join("") : '<div class="empty-list">No specifications</div>'}</div>
    </section>
    <section class="panel-section">
      <div class="section-heading-row"><h3>Color SKUs</h3><button id="addSku" class="small-button">+ Add</button></div>
      <div class="stack-list">${product.skus.length ? product.skus.map((item, index) => `
        <div class="sku-row" data-sku-id="${item.id}">
          <input data-sku-field="colorHex" class="color-input" type="color" value="${item.colorHex}" aria-label="SKU ${index + 1} color">
          <input data-sku-field="code" value="${escapeHtml(item.code)}" aria-label="SKU ${index + 1} code">
          <input data-sku-field="colorName" value="${escapeHtml(item.colorName)}" aria-label="SKU ${index + 1} color name">
          <button data-remove-sku="${item.id}" class="icon-button" aria-label="Remove SKU ${index + 1}">×</button>
        </div>`).join("") : '<div class="empty-list">No SKUs</div>'}</div>
    </section>`;

  $("#deleteProduct").onclick = deleteSelected;
  bindValue("#fieldName", "input", (value) => updateProduct(product.id, { name: value }, false));
  bindValue("#fieldPrice", "input", (value) => updateProduct(product.id, { price: value === "" ? null : Number(value) }, false));
  bindValue("#fieldLane", "change", (value) => moveProductToLane(product.id, value));
  bindValue("#fieldImageUrl", "change", (value) => updateProduct(product.id, { imageUrl: value }, false));
  bindValue("#fieldStatus", "change", (value) => updateProduct(product.id, { statusType: value }, false));
  bindValue("#fieldStatusLabel", "input", (value) => updateProduct(product.id, { statusLabel: value }, false));
  $("#fieldHighlight").onchange = (event) => updateProduct(product.id, { highlightEnabled: event.target.checked }, false);
  $("#fieldHighlightColor").oninput = (event) => updateProduct(product.id, { highlightColor: event.target.value }, false);
  $("#fieldImageUpload").onchange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateProduct(product.id, { imageUrl: String(reader.result || "") }, true);
    reader.readAsDataURL(file);
  };
  if ($("#clearImage")) $("#clearImage").onclick = () => updateProduct(product.id, { imageUrl: "" }, true);
  $("#addSpec").onclick = () => updateProduct(product.id, { specs: [...product.specs, spec("Feature", "Value")] }, true);
  $("#addSku").onclick = () => updateProduct(product.id, { skus: [...product.skus, sku("NEW", "New color", "#777777")] }, true);

  inspector.querySelectorAll("[data-spec-id]").forEach((row) => {
    row.querySelectorAll("[data-spec-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const next = product.specs.map((item) => item.id === row.dataset.specId ? { ...item, [input.dataset.specField]: input.value } : item);
        updateProduct(product.id, { specs: next }, false);
      });
    });
  });
  inspector.querySelectorAll("[data-remove-spec]").forEach((button) => {
    button.onclick = () => updateProduct(product.id, { specs: product.specs.filter((item) => item.id !== button.dataset.removeSpec) }, true);
  });
  inspector.querySelectorAll("[data-sku-id]").forEach((row) => {
    row.querySelectorAll("[data-sku-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const next = product.skus.map((item) => item.id === row.dataset.skuId ? { ...item, [input.dataset.skuField]: input.value } : item);
        updateProduct(product.id, { skus: next }, false);
      });
    });
  });
  inspector.querySelectorAll("[data-remove-sku]").forEach((button) => {
    button.onclick = () => updateProduct(product.id, { skus: product.skus.filter((item) => item.id !== button.dataset.removeSku) }, true);
  });
}

function bindValue(selector, eventName, handler) {
  const element = $(selector);
  if (element) element.addEventListener(eventName, (event) => handler(event.target.value));
}

function updateProduct(productId, patch, updateInspectorAfter) {
  updateBoard((current) => {
    const index = current.products.findIndex((product) => product.id === productId);
    if (index >= 0) current.products[index] = { ...current.products[index], ...patch };
  }, { inspector: updateInspectorAfter });
}

function normalizeLaneOrders(laneId) {
  board.products
    .filter((product) => product.laneId === laneId)
    .sort((a, b) => a.order - b.order)
    .forEach((product, index) => { product.order = index; });
}

function moveProductToLane(productId, laneId) {
  updateBoard((current) => {
    const product = current.products.find((item) => item.id === productId);
    if (!product) return;
    const oldLane = product.laneId;
    product.laneId = laneId;
    product.order = current.products.filter((item) => item.laneId === laneId && item.id !== productId).length;
    delete product.manualPosition;
    normalizeLaneOrders(oldLane);
    normalizeLaneOrders(laneId);
  }, { inspector: true });
}

function reorderProduct(productId, targetLaneId, targetIndex) {
  updateBoard((current) => {
    const moving = current.products.find((product) => product.id === productId);
    if (!moving) return;
    const oldLaneId = moving.laneId;
    const target = current.products.filter((product) => product.laneId === targetLaneId && product.id !== productId).sort((a, b) => a.order - b.order);
    const clamped = Math.max(0, Math.min(targetIndex, target.length));
    moving.laneId = targetLaneId;
    delete moving.manualPosition;
    target.splice(clamped, 0, moving);
    target.forEach((product, index) => { product.order = index; });
    normalizeLaneOrders(oldLaneId);
  }, { inspector: true });
}

function addProduct() {
  const laneId = sortedLanes()[0]?.id || "default";
  const product = makeProduct(id(), "New Product", null, laneId, board.products.filter((item) => item.laneId === laneId).length, {
    statusType: "new", statusLabel: "NEW PRODUCT", highlightEnabled: true, highlightColor: "#5b8f3e",
    specs: [spec("Connection", "Add value"), spec("Feature", "Add value")],
    skus: [sku("BK", "Black", "#111111")],
  });
  updateBoard((current) => current.products.push(product), { inspector: true });
  selectedId = product.id;
  renderInspector();
  renderBoard();
}

function deleteSelected() {
  if (!selectedId || !confirm("Delete this product card?")) return;
  updateBoard((current) => {
    const product = current.products.find((item) => item.id === selectedId);
    current.products = current.products.filter((item) => item.id !== selectedId);
    if (product) normalizeLaneOrders(product.laneId);
  });
  selectedId = board.products[0]?.id ?? null;
  renderInspector();
  renderBoard();
}

function applySort() {
  const mode = $("#sortMode").value;
  if (mode === "custom") return;
  updateBoard((current) => {
    current.lanes.forEach((lane) => {
      const products = current.products.filter((product) => product.laneId === lane.id);
      products.sort((a, b) => {
        if (mode === "name-asc") return a.name.localeCompare(b.name);
        if (mode === "price-asc") return (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER);
        if (mode === "price-desc") return (b.price ?? -1) - (a.price ?? -1);
        if (mode === "status") return a.statusType.localeCompare(b.statusType) || a.name.localeCompare(b.name);
        if (mode === "sku-count") return b.skus.length - a.skus.length || a.name.localeCompare(b.name);
        return a.order - b.order;
      });
      products.forEach((product, index) => { product.order = index; delete product.manualPosition; });
    });
    current.settings.freeMove = false;
  });
}

function syncControls() {
  $("#boardTitle").value = board.title;
  $("#freeMove").checked = board.settings.freeMove;
  $("#showPrices").checked = board.settings.showPrices;
  $("#showSkus").checked = board.settings.showSkus;
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
}

function hitCard(point) {
  return [...renderedCards].reverse().find((card) => point.x >= card.x && point.x <= card.x + card.width && point.y >= card.y && point.y <= card.y + card.height);
}

canvas.addEventListener("pointerdown", (event) => {
  const point = canvasPoint(event);
  const card = hitCard(point);
  if (!card) return;
  selectedId = card.productId;
  renderInspector();
  const product = selectedProduct();
  dragState = { productId: card.productId, offsetX: point.x - card.x, offsetY: point.y - card.y, position: { x: card.x, y: card.y } };
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = "grabbing";
  if (product) renderBoard();
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragState) {
    canvas.style.cursor = hitCard(canvasPoint(event)) ? "grab" : "default";
    return;
  }
  const point = canvasPoint(event);
  dragState.position = { x: Math.max(GUTTER, point.x - dragState.offsetX), y: Math.max(LANE_TOP, point.y - dragState.offsetY) };
  renderBoard();
});

function finishDrag(event) {
  if (!dragState) return;
  const current = dragState;
  dragState = null;
  canvas.style.cursor = "grab";
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (board.settings.freeMove) {
    updateProduct(current.productId, { manualPosition: current.position }, false);
  } else {
    const lanes = sortedLanes();
    const laneIndex = Math.max(0, Math.min(lanes.length - 1, Math.round((current.position.y - LANE_TOP) / LANE_HEIGHT)));
    const targetIndex = Math.max(0, Math.round((current.position.x - GUTTER) / (CARD_WIDTH + CARD_GAP)));
    reorderProduct(current.productId, lanes[laneIndex].id, targetIndex);
  }
}
canvas.addEventListener("pointerup", finishDrag);
canvas.addEventListener("pointercancel", finishDrag);

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFilename(extension) {
  const stem = board.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product-board";
  return `${stem}.${extension}`;
}

function exportPng() {
  const exportCanvas = document.createElement("canvas");
  const dimensions = getCanvasDimensions();
  const scale = 2;
  exportCanvas.width = dimensions.width * scale;
  exportCanvas.height = dimensions.height * scale;
  const exportContext = exportCanvas.getContext("2d");
  exportContext.setTransform(scale, 0, 0, scale, 0, 0);
  exportContext.imageSmoothingEnabled = true;
  exportContext.imageSmoothingQuality = "high";
  drawBoardTo(exportContext, dimensions, false);
  exportCanvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, safeFilename("png"));
  }, "image/png");
  renderBoard();
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (parsed?.version !== 1 || !Array.isArray(parsed.products) || !Array.isArray(parsed.lanes)) throw new Error("Unsupported board file.");
      board = parsed;
      selectedId = board.products[0]?.id ?? null;
      scheduleSave();
      syncControls();
      renderInspector();
      renderBoard();
    } catch (error) {
      alert(error.message || "Unable to import board file.");
    }
  };
  reader.readAsText(file);
}

$("#addProduct").onclick = addProduct;
$("#applySort").onclick = applySort;
$("#importJson").onclick = () => $("#importFile").click();
$("#importFile").onchange = (event) => { const file = event.target.files?.[0]; if (file) importJson(file); event.target.value = ""; };
$("#exportJson").onclick = () => downloadBlob(new Blob([JSON.stringify(board, null, 2)], { type: "application/json" }), safeFilename("json"));
$("#exportPng").onclick = exportPng;
$("#boardTitle").oninput = (event) => updateBoard((current) => { current.title = event.target.value; });
$("#searchInput").oninput = (event) => { searchQuery = event.target.value; renderBoard(); };
$("#freeMove").onchange = (event) => updateBoard((current) => { current.settings.freeMove = event.target.checked; });
$("#showPrices").onchange = (event) => updateBoard((current) => { current.settings.showPrices = event.target.checked; });
$("#showSkus").onchange = (event) => updateBoard((current) => { current.settings.showSkus = event.target.checked; });
$("#resetLayout").onclick = () => updateBoard((current) => { current.products.forEach((product) => delete product.manualPosition); current.settings.freeMove = false; });
$("#zoomOut").onclick = () => { zoom = Math.max(.45, Number((zoom - .1).toFixed(2))); renderBoard(); };
$("#zoomIn").onclick = () => { zoom = Math.min(1.35, Number((zoom + .1).toFixed(2))); renderBoard(); };
$("#restoreSample").onclick = () => {
  if (!confirm("Replace the current board with the original sample data?")) return;
  board = createDefaultBoard();
  selectedId = board.products[0]?.id ?? null;
  searchQuery = "";
  $("#searchInput").value = "";
  scheduleSave();
  syncControls();
  renderInspector();
  renderBoard();
};
$("#openReference").onclick = () => $("#referenceModal").classList.remove("hidden");
$("#closeReference").onclick = () => $("#referenceModal").classList.add("hidden");
$("#referenceModal").addEventListener("click", (event) => { if (event.target.id === "referenceModal") event.currentTarget.classList.add("hidden"); });
window.addEventListener("resize", renderBoard);

syncControls();
renderInspector();
renderBoard();
