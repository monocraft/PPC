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

const ROADMAP_LEFT_WIDTH = 190;
const ROADMAP_HEADER_HEIGHT = 112;
const ROADMAP_GROUP_HEADER_HEIGHT = 28;
const ROADMAP_ROW_HEIGHT = 38;
const ROADMAP_BOTTOM_PADDING = 24;
const ROADMAP_MIN_MONTH_WIDTH = 42;
const ROADMAP_MAX_MONTH_WIDTH = 112;

const $ = (selector) => document.querySelector(selector);
const canvas = $("#boardCanvas");
const ctx = canvas.getContext("2d");
const canvasScroll = $("#canvasScroll");
const boardNavigator = $("#boardNavigator");
const navRange = $("#navRange");
const navLeft = $("#navLeft");
const navRight = $("#navRight");
const navSelected = $("#navSelected");
const navPosition = $("#navPosition");
const inspector = $("#inspector");
const specPopover = $("#specPopover");
const editSelectedButton = $("#editSelected");
const imageCache = new Map();
const productView = $("#productView");
const roadmapView = $("#roadmapView");
const splitView = $("#splitView");
const productControls = $("#productControls");
const roadmapControls = $("#roadmapControls");
const linkedViewButton = $("#linkedView");
const roadmapCanvas = $("#roadmapCanvas");
const roadmapScroll = $("#roadmapScroll");
const roadmapNavigator = $("#roadmapNavigator");
const roadmapNavRange = $("#roadmapNavRange");
const roadmapNavLeft = $("#roadmapNavLeft");
const roadmapNavRight = $("#roadmapNavRight");
const roadmapNavSelected = $("#roadmapNavSelected");
const roadmapNavPosition = $("#roadmapNavPosition");
const splitRoadmapCanvas = $("#splitRoadmapCanvas");
const splitRoadmapScroll = $("#splitRoadmapScroll");
const splitRoadmapNavigator = $("#splitRoadmapNavigator");
const splitRoadmapNavRange = $("#splitRoadmapNavRange");
const splitRoadmapNavLeft = $("#splitRoadmapNavLeft");
const splitRoadmapNavRight = $("#splitRoadmapNavRight");
const splitRoadmapNavSelected = $("#splitRoadmapNavSelected");
const splitRoadmapNavPosition = $("#splitRoadmapNavPosition");
const splitProduct = $("#splitProduct");

let board = null;
let selectedId = null;
let zoom = 1;
let searchQuery = "";
let dragState = null;
let panState = null;
let renderedCards = [];
let renderedSpecOverflow = [];
let inspectorOpen = false;
let saveTimer = null;
let activeView = "products";
let roadmapSearchQuery = "";
let roadmapMonthWidth = 82;
let roadmapHitRegions = new Map();
let roadmapDragState = null;
let roadmapPanState = null;
let roadmapDraft = null;

function id() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function spec(label, value) {
  return { id: id(), label, value };
}

function sku(code, colorName, colorHex) {
  return { id: id(), code, colorName, colorHex };
}

function makeRoadmap(family, startMonth, launchMonth, endMonth, status = "active", confidence = "high") {
  return { family, startMonth, launchMonth, endMonth, status, confidence, predecessorId: "", successorId: "" };
}

const SAMPLE_ROADMAP = {
  "cloud-stinger-2-core": makeRoadmap("Stinger", "2026-04", "2026-04", "2027-04", "active", "high"),
  "cloud-jet-2": makeRoadmap("Jet", "2027-01", "2027-04", "2027-12", "embargo", "medium"),
  "cloud-stinger-3": makeRoadmap("Stinger", "2026-04", "2026-07", "2027-12", "approved", "high"),
  "cloud-ii": makeRoadmap("Cloud", "2026-04", "2026-04", "2027-12", "active", "high"),
  "cloud-iii": makeRoadmap("Cloud", "2026-04", "2026-07", "2027-12", "active", "high"),
  "cloud-alpha": makeRoadmap("Alpha", "2026-04", "2026-04", "2027-12", "active", "high"),
  "cloud-alpha-air": makeRoadmap("Openback", "2026-09", "2027-04", "2027-12", "embargo", "medium"),
  "cloud-jet-wireless": makeRoadmap("Jet", "2026-04", "2026-07", "2027-06", "active", "high"),
  "cloud-jet-2-wireless": makeRoadmap("Jet", "2027-02", "2027-07", "2027-12", "embargo", "medium"),
  "cloud-stinger-3-wireless": makeRoadmap("Stinger", "2026-04", "2026-10", "2027-12", "approved", "high"),
  "cloud-flight-2-wireless": makeRoadmap("Flight", "2026-04", "2026-10", "2027-12", "active", "high"),
  "cloud-iii-s-wireless": makeRoadmap("Cloud", "2026-04", "2026-10", "2027-12", "active", "high"),
  "cloud-alpha-wireless": makeRoadmap("Alpha", "2026-04", "2026-04", "2027-12", "active", "high"),
  "cloud-alpha-2-wireless": makeRoadmap("Alpha", "2026-04", "2026-10", "2027-12", "active", "high"),
};

function monthStringFromDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthIndex(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function monthString(index) {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function addMonths(value, amount) {
  const index = monthIndex(value);
  return monthString((index ?? monthIndex(monthStringFromDate())) + amount);
}

function normalizeMonth(value, fallback) {
  const index = monthIndex(value);
  return index == null ? fallback : monthString(index);
}

function inferFamily(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("jet")) return "Jet";
  if (value.includes("stinger")) return "Stinger";
  if (value.includes("flight")) return "Flight";
  if (value.includes("alpha air")) return "Openback";
  if (value.includes("alpha")) return "Alpha";
  if (value.includes("cloud")) return "Cloud";
  return "Other";
}

function defaultRoadmapForProduct(product, index = 0) {
  if (SAMPLE_ROADMAP[product.id]) return { ...SAMPLE_ROADMAP[product.id] };
  const current = monthStringFromDate();
  const start = addMonths(current, Math.floor(index / 3));
  return makeRoadmap(inferFamily(product.name), start, addMonths(start, 6), addMonths(start, 18), product.statusType === "embargo" ? "embargo" : "planned", "medium");
}

function ensureBoardSchema(target) {
  target.settings = { ...target.settings, freeMove: false };
  target.settings.roadmap = {
    startMonth: "2026-01",
    endMonth: "2027-12",
    snap: "month",
    colorBy: "status",
    ...(target.settings.roadmap || {}),
  };
  if (monthIndex(target.settings.roadmap.endMonth) <= monthIndex(target.settings.roadmap.startMonth)) {
    target.settings.roadmap.endMonth = addMonths(target.settings.roadmap.startMonth, 23);
  }
  target.products.forEach((product, index) => {
    delete product.manualPosition;
    const fallback = defaultRoadmapForProduct(product, index);
    const existing = product.roadmap || {};
    product.roadmap = {
      ...fallback,
      ...existing,
      family: existing.family || fallback.family,
      startMonth: normalizeMonth(existing.startMonth || existing.startDate, fallback.startMonth),
      launchMonth: normalizeMonth(existing.launchMonth || existing.launchDate, fallback.launchMonth),
      endMonth: normalizeMonth(existing.endMonth || existing.endDate, fallback.endMonth),
      predecessorId: existing.predecessorId || "",
      successorId: existing.successorId || "",
    };
    if (monthIndex(product.roadmap.endMonth) < monthIndex(product.roadmap.startMonth)) product.roadmap.endMonth = product.roadmap.startMonth;
    if (monthIndex(product.roadmap.launchMonth) < monthIndex(product.roadmap.startMonth)) product.roadmap.launchMonth = product.roadmap.startMonth;
    if (monthIndex(product.roadmap.launchMonth) > monthIndex(product.roadmap.endMonth)) product.roadmap.launchMonth = product.roadmap.endMonth;
  });
  return target;
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
    roadmap: options.roadmap || null,
    specs: options.specs || [],
    skus: options.skus || [],
  };
}

function createDefaultBoard() {
  const created = {
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
  return ensureBoardSchema(created);
}

function loadBoard() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed?.version === 1 && Array.isArray(parsed.products) && Array.isArray(parsed.lanes)) {
      return ensureBoardSchema(parsed);
    }
  } catch (_) {}
  return ensureBoardSchema(createDefaultBoard());
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(board)); } catch (_) {}
  }, 120);
}

function updateBoard(mutator, { inspector: updateInspector = false } = {}) {
  mutator(board);
  scheduleSave();
  syncControls();
  if (updateInspector) renderInspector();
  renderActiveView();
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
  image.onload = () => { record.ready = true; renderActiveView(); };
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
  renderedSpecOverflow = [];

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
        let position = automatic;
        if (dragState?.productId === product.id) position = dragState.position;
        renderedCards.push({ productId: product.id, laneId: lane.id, x: position.x, y: position.y, width: CARD_WIDTH, height: CARD_HEIGHT });
        drawCard(context, product, position.x, position.y, includeSelection && product.id === selectedId);
      });
  });
}

function specIconKind(label) {
  const value = String(label || "").toLowerCase();
  if (/wireless|connection|connectivity|usb|bluetooth/.test(value)) return "connection";
  if (/battery|runtime|hours/.test(value)) return "battery";
  if (/microphone|mic/.test(value)) return "microphone";
  if (/driver|speaker|frequency/.test(value)) return "driver";
  if (/audio|spatial|surround|sound/.test(value)) return "audio";
  if (/cushion|foam|earpad|comfort/.test(value)) return "cushion";
  if (/frame|material|construction/.test(value)) return "frame";
  if (/control|button|dial|onboard|inline|in-line/.test(value)) return "controls";
  return "generic";
}

function drawSpecIcon(context, label, centerX, centerY) {
  const kind = specIconKind(label);
  context.save();
  context.translate(centerX, centerY);
  context.strokeStyle = "#737873";
  context.fillStyle = "#737873";
  context.lineWidth = 1.25;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();

  if (kind === "connection") {
    context.arc(-4, 0, 2.2, 0, Math.PI * 2);
    context.moveTo(-1.8, 0); context.lineTo(2.5, 0);
    context.moveTo(2.5, -3); context.lineTo(2.5, 3);
    context.moveTo(2.5, -2); context.lineTo(6, -2);
    context.moveTo(2.5, 2); context.lineTo(6, 2);
  } else if (kind === "battery") {
    context.rect(-7, -4, 12, 8);
    context.moveTo(5, -2); context.lineTo(7, -2);
    context.moveTo(7, -2); context.lineTo(7, 2);
    context.moveTo(7, 2); context.lineTo(5, 2);
  } else if (kind === "microphone") {
    context.roundRect(-3.5, -7, 7, 11, 3.5);
    context.moveTo(-6, 1); context.quadraticCurveTo(0, 8, 6, 1);
    context.moveTo(0, 7); context.lineTo(0, 10);
    context.moveTo(-3, 10); context.lineTo(3, 10);
  } else if (kind === "driver") {
    context.arc(0, 0, 7, 0, Math.PI * 2);
    context.moveTo(0, -7); context.lineTo(0, -4);
    context.moveTo(0, 4); context.lineTo(0, 7);
    context.moveTo(-7, 0); context.lineTo(-4, 0);
    context.moveTo(4, 0); context.lineTo(7, 0);
    context.moveTo(-5, -5); context.lineTo(-3, -3);
    context.moveTo(3, 3); context.lineTo(5, 5);
    context.moveTo(5, -5); context.lineTo(3, -3);
    context.moveTo(-3, 3); context.lineTo(-5, 5);
    context.arc(0, 0, 2.2, 0, Math.PI * 2);
  } else if (kind === "audio") {
    context.arc(0, 0, 7, Math.PI, 0);
    context.moveTo(-7, 0); context.lineTo(-7, 6);
    context.moveTo(7, 0); context.lineTo(7, 6);
    context.roundRect(-8, 3, 3, 6, 1);
    context.roundRect(5, 3, 3, 6, 1);
  } else if (kind === "cushion") {
    context.moveTo(-7, -4); context.lineTo(0, 0); context.lineTo(7, -4);
    context.moveTo(-7, 1); context.lineTo(0, 5); context.lineTo(7, 1);
  } else if (kind === "frame") {
    context.moveTo(0, -7); context.lineTo(7, -3); context.lineTo(0, 1); context.lineTo(-7, -3); context.closePath();
    context.moveTo(-7, 2); context.lineTo(0, 6); context.lineTo(7, 2);
  } else if (kind === "controls") {
    context.arc(0, 0, 4, 0, Math.PI * 2);
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI * 2 * i) / 8;
      context.moveTo(Math.cos(angle) * 5.2, Math.sin(angle) * 5.2);
      context.lineTo(Math.cos(angle) * 7.5, Math.sin(angle) * 7.5);
    }
    context.moveTo(-1.5, 0); context.lineTo(1.5, 0);
  } else {
    context.moveTo(0, -6); context.lineTo(6, 0); context.lineTo(0, 6); context.lineTo(-6, 0); context.closePath();
  }

  context.stroke();
  context.restore();
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
  const rowHeight = 32;
  const rowsTop = detailsTop + 9;
  const overflowButtonHeight = 24;
  const availableHeight = Math.max(0, detailsBottom - rowsTop);
  let visibleSpecCount = Math.max(0, Math.floor(availableHeight / rowHeight));
  if (product.specs.length > visibleSpecCount) {
    visibleSpecCount = Math.max(0, Math.floor((availableHeight - overflowButtonHeight - 8) / rowHeight));
  }
  const visibleSpecs = product.specs.slice(0, visibleSpecCount);
  visibleSpecs.forEach((item, index) => {
    const rowY = rowsTop + index * rowHeight;
    drawSpecIcon(context, item.label, x + 22, rowY + 11);
    context.fillStyle = "#c9ccc9";
    context.font = "11.5px Arial";
    context.textAlign = "left";
    wrapText(context, item.value, x + 43, rowY + 10, CARD_WIDTH - 55, 13, 2, "left");
    context.strokeStyle = "#303230";
    context.beginPath(); context.moveTo(x + 10, rowY + 26); context.lineTo(x + CARD_WIDTH - 10, rowY + 26); context.stroke();
  });

  const hiddenSpecCount = product.specs.length - visibleSpecs.length;
  if (hiddenSpecCount > 0) {
    const buttonX = x + 10;
    const buttonY = detailsBottom - overflowButtonHeight - 7;
    const buttonWidth = CARD_WIDTH - 20;
    roundRect(context, buttonX, buttonY, buttonWidth, overflowButtonHeight, 4, "#2b2e2b", "#454945");
    context.fillStyle = "#b7bbb7";
    context.font = "700 10px Arial";
    context.textAlign = "center";
    context.fillText(`View ${hiddenSpecCount} more specification${hiddenSpecCount === 1 ? "" : "s"}  →`, x + CARD_WIDTH / 2, buttonY + 16);
    renderedSpecOverflow.push({ productId: product.id, x: buttonX, y: buttonY, width: buttonWidth, height: overflowButtonHeight });
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

function roadmapRange() {
  const settings = board.settings.roadmap;
  let start = monthIndex(settings.startMonth);
  let end = monthIndex(settings.endMonth);
  if (start == null) start = monthIndex("2026-01");
  if (end == null || end <= start) end = start + 23;
  return { start, end, count: end - start + 1 };
}

function visibleRoadmapProducts() {
  const query = roadmapSearchQuery.trim().toLowerCase();
  if (!query) return board.products;
  return board.products.filter((product) => {
    const roadmap = product.roadmap || {};
    const haystack = [product.name, roadmap.family, roadmap.status, roadmap.confidence, product.statusLabel].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function roadmapFamilyOrder(family) {
  const order = ["Jet", "Stinger", "Flight", "Cloud", "Alpha", "Openback", "Other"];
  const index = order.indexOf(family);
  return index < 0 ? order.length : index;
}

function roadmapGroups() {
  const groups = new Map();
  visibleRoadmapProducts().forEach((product) => {
    const family = product.roadmap?.family || inferFamily(product.name);
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(product);
  });
  return [...groups.entries()]
    .sort((a, b) => roadmapFamilyOrder(a[0]) - roadmapFamilyOrder(b[0]) || a[0].localeCompare(b[0]))
    .map(([family, products]) => ({
      family,
      products: products.sort((a, b) => monthIndex(a.roadmap.startMonth) - monthIndex(b.roadmap.startMonth) || a.name.localeCompare(b.name)),
    }));
}

function roadmapDimensions() {
  const range = roadmapRange();
  const groups = roadmapGroups();
  const rowsHeight = groups.reduce((sum, group) => sum + ROADMAP_GROUP_HEADER_HEIGHT + group.products.length * ROADMAP_ROW_HEIGHT, 0);
  return {
    width: ROADMAP_LEFT_WIDTH + range.count * roadmapMonthWidth + 24,
    height: ROADMAP_HEADER_HEIGHT + rowsHeight + ROADMAP_BOTTOM_PADDING,
    range,
    groups,
  };
}

function roadmapStatusColor(product) {
  if (board.settings.roadmap.colorBy === "product") {
    if (product.statusType === "embargo") return "#b83458";
    if (product.statusType === "new") return "#4e8136";
    if (product.statusType === "custom") return "#78642c";
    return "#505450";
  }
  const status = product.roadmap?.status || "active";
  return {
    active: "#505450",
    planned: "#365f45",
    approved: "#4e8136",
    concept: "#303430",
    embargo: "#b83458",
    "end-of-life": "#694049",
  }[status] || "#505450";
}

function roadmapLabel(value) {
  const index = monthIndex(value);
  if (index == null) return "Unscheduled";
  const year = Math.floor(index / 12);
  const month = index % 12;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month]} ${year}`;
}

function roadmapQuarterLabel(value) {
  const index = monthIndex(value);
  if (index == null) return "—";
  return `Q${Math.floor((index % 12) / 3) + 1} ${String(Math.floor(index / 12)).slice(-2)}`;
}

function effectiveRoadmap(product) {
  if (roadmapDraft?.productId === product.id) return { ...product.roadmap, ...roadmapDraft.roadmap };
  return product.roadmap;
}

function setupRoadmapCanvas(targetCanvas, dimensions) {
  const dpr = window.devicePixelRatio || 1;
  targetCanvas.width = Math.round(dimensions.width * dpr);
  targetCanvas.height = Math.round(dimensions.height * dpr);
  targetCanvas.style.width = `${dimensions.width}px`;
  targetCanvas.style.height = `${dimensions.height}px`;
  const context = targetCanvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}

function drawRoadmapTo(context, dimensions, targetCanvas, targetScroll, includeSelection = true, exportMode = false) {
  const { width, height, range, groups } = dimensions;
  const stickyX = exportMode ? 0 : targetScroll.scrollLeft;
  const stickyY = exportMode ? 0 : targetScroll.scrollTop;
  const regions = [];

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#151715";
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.075;
  context.fillStyle = "#ffffff";
  for (let y = 7; y < height; y += 11) {
    for (let x = 7 + ((y / 11) % 2) * 5; x < width; x += 11) context.fillRect(x, y, 1, 1);
  }
  context.restore();

  const timelineX = ROADMAP_LEFT_WIDTH;
  const timelineWidth = range.count * roadmapMonthWidth;

  // Timeline grid and row content.
  context.save();
  context.beginPath();
  context.rect(timelineX, ROADMAP_HEADER_HEIGHT, timelineWidth, height - ROADMAP_HEADER_HEIGHT);
  context.clip();

  for (let month = 0; month <= range.count; month += 1) {
    const x = timelineX + month * roadmapMonthWidth;
    const absolute = range.start + month;
    const isQuarter = absolute % 3 === 0;
    const isYear = absolute % 12 === 0;
    context.strokeStyle = isYear ? "#4c514c" : isQuarter ? "#383d38" : "#292d29";
    context.lineWidth = isYear ? 1.5 : 1;
    context.beginPath();
    context.moveTo(x, ROADMAP_HEADER_HEIGHT);
    context.lineTo(x, height);
    context.stroke();
  }

  let rowY = ROADMAP_HEADER_HEIGHT;
  groups.forEach((group, groupIndex) => {
    context.fillStyle = groupIndex % 2 ? "#191c19" : "#1b1e1b";
    context.fillRect(timelineX, rowY, timelineWidth, ROADMAP_GROUP_HEADER_HEIGHT);
    rowY += ROADMAP_GROUP_HEADER_HEIGHT;

    group.products.forEach((product, productIndex) => {
      const roadmap = effectiveRoadmap(product);
      const rowTop = rowY;
      context.fillStyle = productIndex % 2 ? "rgba(255,255,255,.012)" : "rgba(0,0,0,.08)";
      context.fillRect(timelineX, rowTop, timelineWidth, ROADMAP_ROW_HEIGHT);
      context.strokeStyle = "#2e322e";
      context.beginPath();
      context.moveTo(timelineX, rowTop + ROADMAP_ROW_HEIGHT);
      context.lineTo(timelineX + timelineWidth, rowTop + ROADMAP_ROW_HEIGHT);
      context.stroke();

      const startIndex = monthIndex(roadmap.startMonth);
      const endIndex = monthIndex(roadmap.endMonth);
      if (startIndex != null && endIndex != null) {
        const unclippedX = timelineX + (startIndex - range.start) * roadmapMonthWidth;
        const unclippedRight = timelineX + (endIndex - range.start + 1) * roadmapMonthWidth;
        const barX = Math.max(timelineX + 1, unclippedX + 2);
        const barRight = Math.min(timelineX + timelineWidth - 1, unclippedRight - 2);
        const barY = rowTop + 5;
        const barHeight = ROADMAP_ROW_HEIGHT - 10;
        const barWidth = Math.max(4, barRight - barX);
        const selected = includeSelection && product.id === selectedId;
        const color = roadmapStatusColor(product);

        context.save();
        if (selected) {
          context.shadowColor = "rgba(255,255,255,.22)";
          context.shadowBlur = 10;
        }
        roundRect(context, barX, barY, barWidth, barHeight, 3, color, selected ? "#f0f2f0" : product.statusType === "embargo" ? "#df456d" : "#666b66", selected ? 2 : 1);
        context.restore();

        if (roadmap.status === "concept") {
          context.save();
          context.setLineDash([6, 4]);
          roundRect(context, barX + 1, barY + 1, Math.max(2, barWidth - 2), barHeight - 2, 3, null, "#8a8f8a", 1);
          context.restore();
        }

        context.save();
        context.beginPath();
        context.rect(barX + 8, barY, Math.max(0, barWidth - 16), barHeight);
        context.clip();
        context.fillStyle = "#f3f4f3";
        context.font = "700 12px Arial";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(product.name.toUpperCase(), barX + barWidth / 2, barY + barHeight / 2 + .5);
        context.restore();

        const launchIndex = monthIndex(roadmap.launchMonth);
        if (launchIndex != null && launchIndex >= range.start && launchIndex <= range.end) {
          const launchX = timelineX + (launchIndex - range.start + .5) * roadmapMonthWidth;
          context.save();
          context.translate(launchX, barY + barHeight / 2);
          context.rotate(Math.PI / 4);
          context.fillStyle = product.statusType === "embargo" || roadmap.status === "embargo" ? "#ff5a83" : "#99cc77";
          context.fillRect(-4, -4, 8, 8);
          context.restore();
        }

        if (selected && barWidth > 28) {
          context.strokeStyle = "rgba(255,255,255,.72)";
          context.lineWidth = 1.5;
          context.beginPath();
          context.moveTo(barX + 7, barY + 6);
          context.lineTo(barX + 7, barY + barHeight - 6);
          context.moveTo(barX + barWidth - 7, barY + 6);
          context.lineTo(barX + barWidth - 7, barY + barHeight - 6);
          context.stroke();
        }

        regions.push({
          productId: product.id,
          x: barX,
          y: barY,
          width: barWidth,
          height: barHeight,
          leftHandle: { x: barX, width: Math.min(12, barWidth / 3) },
          rightHandle: { x: barX + barWidth - Math.min(12, barWidth / 3), width: Math.min(12, barWidth / 3) },
        });
      }
      rowY += ROADMAP_ROW_HEIGHT;
    });
  });
  context.restore();

  // Today marker over the timeline body.
  const todayIndex = monthIndex(monthStringFromDate());
  if (todayIndex >= range.start && todayIndex <= range.end) {
    const today = new Date();
    const fraction = Math.min(.98, Math.max(.02, (today.getDate() - 1) / new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()));
    const x = timelineX + (todayIndex - range.start + fraction) * roadmapMonthWidth;
    context.strokeStyle = "rgba(226,65,104,.76)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, ROADMAP_HEADER_HEIGHT - 8);
    context.lineTo(x, height);
    context.stroke();
  }

  // Sticky family rail.
  context.fillStyle = "#101210";
  context.fillRect(stickyX, ROADMAP_HEADER_HEIGHT, ROADMAP_LEFT_WIDTH, height - ROADMAP_HEADER_HEIGHT);
  context.fillStyle = "#090b09";
  context.fillRect(stickyX, ROADMAP_HEADER_HEIGHT, 48, height - ROADMAP_HEADER_HEIGHT);
  context.strokeStyle = "#303430";
  context.beginPath();
  context.moveTo(stickyX + ROADMAP_LEFT_WIDTH, ROADMAP_HEADER_HEIGHT);
  context.lineTo(stickyX + ROADMAP_LEFT_WIDTH, height);
  context.stroke();

  context.save();
  context.translate(stickyX + 31, ROADMAP_HEADER_HEIGHT + Math.max(180, (height - ROADMAP_HEADER_HEIGHT) / 2));
  context.rotate(-Math.PI / 2);
  context.fillStyle = "#f0f2f0";
  context.font = "700 20px Arial";
  context.textAlign = "center";
  context.fillText("PC AUDIO", 0, 0);
  context.restore();

  rowY = ROADMAP_HEADER_HEIGHT;
  groups.forEach((group, groupIndex) => {
    const groupHeight = ROADMAP_GROUP_HEADER_HEIGHT + group.products.length * ROADMAP_ROW_HEIGHT;
    context.fillStyle = groupIndex % 2 ? "#171a17" : "#1a1d1a";
    context.fillRect(stickyX + 48, rowY, ROADMAP_LEFT_WIDTH - 48, groupHeight);
    context.strokeStyle = "#303430";
    context.beginPath();
    context.moveTo(stickyX + 48, rowY + groupHeight);
    context.lineTo(stickyX + ROADMAP_LEFT_WIDTH, rowY + groupHeight);
    context.stroke();
    context.fillStyle = "#e6e8e6";
    context.font = "700 12px Arial";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(group.family.toUpperCase(), stickyX + 61, rowY + groupHeight / 2);
    rowY += groupHeight;
  });

  // Sticky calendar header.
  context.fillStyle = "#171a17";
  context.fillRect(stickyX, stickyY, ROADMAP_LEFT_WIDTH, ROADMAP_HEADER_HEIGHT);
  context.fillStyle = "#101210";
  context.fillRect(timelineX, stickyY, timelineWidth, ROADMAP_HEADER_HEIGHT);

  // Year blocks.
  let cursor = range.start;
  while (cursor <= range.end) {
    const year = Math.floor(cursor / 12);
    const yearEnd = Math.min(range.end, year * 12 + 11);
    const startOffset = cursor - range.start;
    const monthCount = yearEnd - cursor + 1;
    const x = timelineX + startOffset * roadmapMonthWidth;
    const w = monthCount * roadmapMonthWidth;
    context.fillStyle = "#1b1e1b";
    context.fillRect(x, stickyY, w, 34);
    context.strokeStyle = "#373b37";
    context.strokeRect(x, stickyY, w, 34);
    context.fillStyle = "#f0f2f0";
    context.font = "700 22px Arial";
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillText(String(year), x + 10, stickyY + 25);
    cursor = yearEnd + 1;
  }

  // Quarter row.
  for (let i = 0; i < range.count; i += 3) {
    const absolute = range.start + i;
    const quarter = Math.floor((absolute % 12) / 3) + 1;
    const x = timelineX + i * roadmapMonthWidth;
    const w = Math.min(3, range.count - i) * roadmapMonthWidth;
    context.fillStyle = "#222522";
    context.fillRect(x, stickyY + 34, w, 22);
    context.strokeStyle = "#343834";
    context.strokeRect(x, stickyY + 34, w, 22);
    context.fillStyle = quarter === 1 || quarter === 4 ? "#cf3d63" : "#9ea39e";
    context.font = "700 10px Arial";
    context.textAlign = "center";
    context.fillText(`Q${quarter}`, x + w / 2, stickyY + 49);
  }

  // Half-year band.
  for (let i = 0; i < range.count; i += 6) {
    const absolute = range.start + i;
    const half = (absolute % 12) < 6 ? "1H" : "2H";
    const x = timelineX + i * roadmapMonthWidth;
    const w = Math.min(6, range.count - i) * roadmapMonthWidth;
    context.fillStyle = i % 12 === 0 ? "#626762" : "#777c77";
    context.fillRect(x, stickyY + 56, w, 22);
    context.fillStyle = "#111311";
    context.font = "700 11px Arial";
    context.textAlign = "center";
    context.fillText(half, x + w / 2, stickyY + 71);
  }

  // Month row.
  for (let i = 0; i < range.count; i += 1) {
    const absolute = range.start + i;
    const month = absolute % 12;
    const x = timelineX + i * roadmapMonthWidth;
    context.fillStyle = "#090b09";
    context.fillRect(x, stickyY + 78, roadmapMonthWidth, 34);
    context.strokeStyle = "#242824";
    context.strokeRect(x, stickyY + 78, roadmapMonthWidth, 34);
    context.fillStyle = "#8f958f";
    context.font = "11px Arial";
    context.textAlign = "left";
    context.fillText(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month], x + 7, stickyY + 100);
  }

  context.fillStyle = "#171a17";
  context.fillRect(stickyX, stickyY, ROADMAP_LEFT_WIDTH, ROADMAP_HEADER_HEIGHT);
  context.strokeStyle = "#373b37";
  context.strokeRect(stickyX, stickyY, ROADMAP_LEFT_WIDTH, ROADMAP_HEADER_HEIGHT);
  context.fillStyle = "#7f857f";
  context.font = "800 9px Arial";
  context.textAlign = "left";
  context.fillText("PORTFOLIO ROADMAP", stickyX + 14, stickyY + 22);
  context.fillStyle = "#e7e9e7";
  context.font = "700 15px Arial";
  context.fillText(`${range.count} MONTH VIEW`, stickyX + 14, stickyY + 47);
  context.fillStyle = "#8d938d";
  context.font = "10px Arial";
  context.fillText("◆ Launch marker", stickyX + 14, stickyY + 72);
  context.fillText("Drag bar / resize edges", stickyX + 14, stickyY + 93);

  roadmapHitRegions.set(targetCanvas, regions);
}

function renderRoadmapFor(targetCanvas, targetScroll, navigator) {
  if (!targetCanvas || !targetScroll || targetCanvas.closest(".hidden")) return;
  const previousLeft = targetScroll.scrollLeft;
  const previousTop = targetScroll.scrollTop;
  const dimensions = roadmapDimensions();
  const context = setupRoadmapCanvas(targetCanvas, dimensions);
  targetScroll.scrollLeft = previousLeft;
  targetScroll.scrollTop = previousTop;
  drawRoadmapTo(context, dimensions, targetCanvas, targetScroll, true, false);
  requestAnimationFrame(() => syncRoadmapNavigator(targetScroll, navigator));
}

function renderRoadmaps() {
  if (activeView === "roadmap") renderRoadmapFor(roadmapCanvas, roadmapScroll, roadmapNavigatorRefs());
  if (activeView === "split") {
    renderSplitProduct();
    renderRoadmapFor(splitRoadmapCanvas, splitRoadmapScroll, splitRoadmapNavigatorRefs());
  }
}

function roadmapNavigatorRefs() {
  return { element: roadmapNavigator, range: roadmapNavRange, left: roadmapNavLeft, right: roadmapNavRight, selected: roadmapNavSelected, position: roadmapNavPosition };
}

function splitRoadmapNavigatorRefs() {
  return { element: splitRoadmapNavigator, range: splitRoadmapNavRange, left: splitRoadmapNavLeft, right: splitRoadmapNavRight, selected: splitRoadmapNavSelected, position: splitRoadmapNavPosition };
}

function syncRoadmapNavigator(targetScroll, refs) {
  const max = Math.max(0, targetScroll.scrollWidth - targetScroll.clientWidth);
  const current = Math.max(0, Math.min(max, targetScroll.scrollLeft));
  const hasOverflow = max > 2;
  refs.element.classList.toggle("hidden", !hasOverflow);
  refs.range.max = String(Math.max(1, Math.round(max)));
  refs.range.value = String(Math.round(current));
  refs.left.disabled = !hasOverflow || current <= 1;
  refs.right.disabled = !hasOverflow || current >= max - 1;
  refs.selected.disabled = !selectedProduct();
  refs.position.textContent = hasOverflow ? `${Math.round((current / max) * 100)}%` : "0%";
}

function scrollRoadmapSelected(targetScroll, smooth = true) {
  const regions = roadmapHitRegions.get(targetScroll.querySelector("canvas")) || [];
  const region = regions.find((item) => item.productId === selectedId);
  if (!region) return;
  const targetLeft = Math.max(0, region.x + region.width / 2 - targetScroll.clientWidth / 2);
  const targetTop = Math.max(0, region.y + region.height / 2 - targetScroll.clientHeight / 2);
  targetScroll.scrollTo({ left: targetLeft, top: targetTop, behavior: smooth ? "smooth" : "auto" });
}

function scrollRoadmapToday(targetScroll) {
  const range = roadmapRange();
  const today = monthIndex(monthStringFromDate());
  const x = ROADMAP_LEFT_WIDTH + (today - range.start + .5) * roadmapMonthWidth;
  targetScroll.scrollTo({ left: Math.max(0, x - targetScroll.clientWidth / 2), behavior: "smooth" });
}

function fitRoadmapTimeline() {
  const targetScroll = activeView === "split" ? splitRoadmapScroll : roadmapScroll;
  const range = roadmapRange();
  const available = Math.max(320, targetScroll.clientWidth - ROADMAP_LEFT_WIDTH - 24);
  roadmapMonthWidth = Math.max(ROADMAP_MIN_MONTH_WIDTH, Math.min(ROADMAP_MAX_MONTH_WIDTH, available / range.count));
  renderRoadmaps();
}

function roadmapPoint(event, targetCanvas) {
  const rect = targetCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function hitRoadmapBar(targetCanvas, point) {
  const regions = roadmapHitRegions.get(targetCanvas) || [];
  return [...regions].reverse().find((region) => point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height);
}

function roadmapSnapIncrement() {
  return { month: 1, quarter: 3, half: 6 }[board.settings.roadmap.snap] || 1;
}

function bindRoadmapCanvas(targetCanvas, targetScroll, navigatorRefsFactory) {
  targetCanvas.addEventListener("pointerdown", (event) => {
    closeSpecPopover();
    const point = roadmapPoint(event, targetCanvas);
    const hit = hitRoadmapBar(targetCanvas, point);
    if (!hit) {
      roadmapPanState = { targetCanvas, targetScroll, pointerId: event.pointerId, startX: event.clientX, scrollLeft: targetScroll.scrollLeft };
      targetCanvas.setPointerCapture(event.pointerId);
      targetScroll.classList.add("is-panning");
      return;
    }

    selectedId = hit.productId;
    renderInspector();
    renderSplitProduct();
    const product = selectedProduct();
    const roadmap = product.roadmap;
    const handleSize = Math.min(12, hit.width / 3);
    const mode = point.x <= hit.x + handleSize ? "start" : point.x >= hit.x + hit.width - handleSize ? "end" : "move";
    roadmapDragState = {
      targetCanvas,
      targetScroll,
      pointerId: event.pointerId,
      productId: product.id,
      mode,
      startClientX: event.clientX,
      originalStart: monthIndex(roadmap.startMonth),
      originalLaunch: monthIndex(roadmap.launchMonth),
      originalEnd: monthIndex(roadmap.endMonth),
    };
    roadmapDraft = { productId: product.id, roadmap: { ...roadmap } };
    targetCanvas.setPointerCapture(event.pointerId);
    targetCanvas.style.cursor = mode === "move" ? "grabbing" : "ew-resize";
    renderRoadmaps();
  });

  targetCanvas.addEventListener("pointermove", (event) => {
    if (roadmapPanState?.targetCanvas === targetCanvas) {
      targetScroll.scrollLeft = roadmapPanState.scrollLeft - (event.clientX - roadmapPanState.startX);
      return;
    }

    if (roadmapDragState?.targetCanvas !== targetCanvas) {
      const point = roadmapPoint(event, targetCanvas);
      const hit = hitRoadmapBar(targetCanvas, point);
      if (!hit) targetCanvas.style.cursor = "grab";
      else {
        const handleSize = Math.min(12, hit.width / 3);
        targetCanvas.style.cursor = point.x <= hit.x + handleSize || point.x >= hit.x + hit.width - handleSize ? "ew-resize" : "grab";
      }
      return;
    }

    const viewport = targetScroll.getBoundingClientRect();
    const edge = 72;
    if (event.clientX < viewport.left + edge) targetScroll.scrollLeft -= Math.ceil((viewport.left + edge - event.clientX) / 5);
    if (event.clientX > viewport.right - edge) targetScroll.scrollLeft += Math.ceil((event.clientX - (viewport.right - edge)) / 5);

    const increment = roadmapSnapIncrement();
    const rawDelta = (event.clientX - roadmapDragState.startClientX) / roadmapMonthWidth;
    const delta = Math.round(rawDelta / increment) * increment;
    let start = roadmapDragState.originalStart;
    let launch = roadmapDragState.originalLaunch;
    let end = roadmapDragState.originalEnd;
    if (roadmapDragState.mode === "move") {
      start += delta;
      launch += delta;
      end += delta;
    } else if (roadmapDragState.mode === "start") {
      start = Math.min(end, start + delta);
      launch = Math.max(start, launch);
    } else {
      end = Math.max(start, end + delta);
      launch = Math.min(end, launch);
    }
    roadmapDraft = {
      productId: roadmapDragState.productId,
      roadmap: { startMonth: monthString(start), launchMonth: monthString(launch), endMonth: monthString(end) },
    };
    renderRoadmaps();
  });

  function finishRoadmapPointer(event) {
    if (roadmapPanState?.targetCanvas === targetCanvas) {
      roadmapPanState = null;
      targetScroll.classList.remove("is-panning");
      if (targetCanvas.hasPointerCapture(event.pointerId)) targetCanvas.releasePointerCapture(event.pointerId);
      syncRoadmapNavigator(targetScroll, navigatorRefsFactory());
      return;
    }
    if (roadmapDragState?.targetCanvas !== targetCanvas) return;
    const draft = roadmapDraft;
    roadmapDragState = null;
    roadmapDraft = null;
    targetCanvas.style.cursor = "grab";
    if (targetCanvas.hasPointerCapture(event.pointerId)) targetCanvas.releasePointerCapture(event.pointerId);
    if (draft) {
      updateRoadmap(draft.productId, draft.roadmap, true);
    } else {
      renderRoadmaps();
    }
  }

  targetCanvas.addEventListener("pointerup", finishRoadmapPointer);
  targetCanvas.addEventListener("pointercancel", finishRoadmapPointer);
  targetCanvas.addEventListener("dblclick", (event) => {
    const hit = hitRoadmapBar(targetCanvas, roadmapPoint(event, targetCanvas));
    if (!hit) return;
    selectedId = hit.productId;
    openInspector("roadmapSection");
    renderRoadmaps();
  });

  targetScroll.addEventListener("scroll", () => {
    requestAnimationFrame(() => {
      renderRoadmapFor(targetCanvas, targetScroll, navigatorRefsFactory());
    });
  }, { passive: true });

  targetScroll.addEventListener("wheel", (event) => {
    const max = Math.max(0, targetScroll.scrollWidth - targetScroll.clientWidth);
    const horizontalIntent = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (max <= 0 || !horizontalIntent) return;
    event.preventDefault();
    targetScroll.scrollLeft += event.deltaX || event.deltaY;
  }, { passive: false });
}

function renderSplitProduct() {
  if (!splitProduct) return;
  const product = selectedProduct();
  if (!product) {
    splitProduct.innerHTML = '<div class="split-empty"><h2>No product selected</h2><p>Select a roadmap bar to review its product details.</p></div>';
    return;
  }
  const roadmap = product.roadmap;
  const statusClass = product.statusType === "embargo" ? "status-embargo" : product.statusType === "new" ? "status-new" : "";
  const iconByKind = { connection: "⌁", battery: "▭", microphone: "◉", driver: "⊙", audio: "◡", cushion: "≋", frame: "◇", controls: "⚙", generic: "◆" };
  splitProduct.innerHTML = `
    <article class="split-product-card ${product.highlightEnabled ? "is-highlighted" : ""}" style="--product-highlight:${escapeHtml(product.highlightColor)}">
      <div class="split-status ${statusClass}">${escapeHtml(product.statusLabel || "SELECTED PRODUCT")}</div>
      <img class="split-product-image" src="${escapeHtml(product.imageUrl || PLACEHOLDER_IMAGE)}" alt="">
      <div class="split-product-body">
        <span class="eyebrow">${escapeHtml(roadmap.family)} family</span>
        <h2>${escapeHtml(product.name)}</h2>
        <div class="split-price">${board.settings.showPrices ? (product.price == null ? "Price TBD" : `$${Number(product.price).toFixed(2)}`) : "Price hidden"}</div>
        <div class="split-roadmap-summary">
          <div class="split-metric"><span>Roadmap</span><strong>${escapeHtml(roadmapQuarterLabel(roadmap.startMonth))} → ${escapeHtml(roadmapQuarterLabel(roadmap.endMonth))}</strong></div>
          <div class="split-metric"><span>Launch</span><strong>${escapeHtml(roadmapLabel(roadmap.launchMonth))}</strong></div>
          <div class="split-metric"><span>Status</span><strong>${escapeHtml(roadmap.status)}</strong></div>
          <div class="split-metric"><span>Confidence</span><strong>${escapeHtml(roadmap.confidence)}</strong></div>
        </div>
        <div class="split-actions">
          <button id="splitOpenProduct">Product cards</button>
          <button id="splitEditProduct" class="primary-button">Edit product</button>
        </div>
        <div class="split-spec-list">${product.specs.slice(0, 7).map((item) => {
          const kind = specIconKind(item.label);
          return `<div class="split-spec-row"><span class="split-spec-icon">${iconByKind[kind] || "◆"}</span><span class="split-spec-value">${escapeHtml(item.value)}</span></div>`;
        }).join("")}</div>
        ${product.skus.length ? `<div class="split-skus">${product.skus.map((item) => `<span class="split-sku"><i class="split-sku-swatch" style="background:${escapeHtml(item.colorHex)}"></i>${escapeHtml(item.code)}</span>`).join("")}</div>` : ""}
      </div>
    </article>`;
  $("#splitOpenProduct").onclick = () => setView("products", { focusSelected: true });
  $("#splitEditProduct").onclick = () => openInspector();
}

function updateLinkedViewButton() {
  const hasSelection = Boolean(selectedProduct());
  linkedViewButton.disabled = !hasSelection;
  if (activeView === "products") linkedViewButton.textContent = "View on roadmap";
  else if (activeView === "roadmap") linkedViewButton.textContent = "View product card";
  else linkedViewButton.textContent = "Open product cards";
}

function setView(view, { focusSelected = false } = {}) {
  activeView = ["products", "roadmap", "split"].includes(view) ? view : "products";
  productView.classList.toggle("hidden", activeView !== "products");
  roadmapView.classList.toggle("hidden", activeView !== "roadmap");
  splitView.classList.toggle("hidden", activeView !== "split");
  productControls.classList.toggle("hidden", activeView !== "products");
  roadmapControls.classList.toggle("hidden", activeView === "products");
  document.querySelectorAll(".view-tab").forEach((button) => {
    const active = button.dataset.view === activeView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  updateLinkedViewButton();
  closeSpecPopover();
  renderActiveView();
  if (focusSelected) {
    requestAnimationFrame(() => {
      if (activeView === "products") scrollSelectedIntoView();
      else scrollRoadmapSelected(activeView === "split" ? splitRoadmapScroll : roadmapScroll);
    });
  }
}

function renderActiveView() {
  updateLinkedViewButton();
  if (activeView === "products") renderBoard();
  else renderRoadmaps();
  renderStatus();
}

function horizontalScrollMax() {
  return Math.max(0, canvasScroll.scrollWidth - canvasScroll.clientWidth);
}

function syncBoardNavigator() {
  const max = horizontalScrollMax();
  const current = Math.max(0, Math.min(max, canvasScroll.scrollLeft));
  const hasOverflow = max > 2;

  boardNavigator.classList.toggle("hidden", !hasOverflow);
  navRange.max = String(Math.max(1, Math.round(max)));
  navRange.value = String(Math.round(current));
  navLeft.disabled = !hasOverflow || current <= 1;
  navRight.disabled = !hasOverflow || current >= max - 1;
  navSelected.disabled = !selectedProduct();
  navPosition.textContent = hasOverflow ? `${Math.round((current / max) * 100)}%` : "0%";
}

function scrollBoardBy(amount, smooth = true) {
  canvasScroll.scrollBy({ left: amount, behavior: smooth ? "smooth" : "auto" });
}

function scrollSelectedIntoView() {
  const card = renderedCards.find((item) => item.productId === selectedId);
  if (!card) return;
  const cardLeft = card.x * zoom;
  const cardWidth = card.width * zoom;
  const target = cardLeft - Math.max(20, (canvasScroll.clientWidth - cardWidth) / 2);
  canvasScroll.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
}

function renderBoard() {
  const previousLeft = canvasScroll.scrollLeft;
  const previousTop = canvasScroll.scrollTop;
  const { context, dimensions } = setupCanvas(canvas, zoom);
  drawBoardTo(context, dimensions, true);
  canvasScroll.scrollLeft = previousLeft;
  canvasScroll.scrollTop = previousTop;
  $("#zoomReset").textContent = `${Math.round(zoom * 100)}%`;
  renderStatus();
  requestAnimationFrame(syncBoardNavigator);
}

function renderStatus() {
  const viewText = activeView === "products" ? "Product comparison" : activeView === "roadmap" ? "Roadmap slotting" : "Synchronized split view";
  const interaction = activeView === "products"
    ? "Drag cards to reorder; drag empty background horizontally"
    : "Drag bars to move; drag bar edges to resize; ◆ marks launch";
  $("#statusbar").innerHTML = `
    <span>${board.products.length} products</span>
    <span>${board.lanes.length} product lanes</span>
    <span>${viewText}</span>
    <span>Autosaved in this browser</span>
    <span>${interaction}</span>`;
}

function selectedProduct() {
  return board.products.find((product) => product.id === selectedId) || null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function applyInspectorState(empty = false) {
  inspector.className = `inspector${empty ? " inspector-empty" : ""}${inspectorOpen ? " is-open" : ""}`;
  inspector.setAttribute("aria-hidden", String(!inspectorOpen));
}

function openInspector(sectionId = "") {
  if (!selectedProduct()) return;
  inspectorOpen = true;
  renderInspector();
  if (sectionId) {
    requestAnimationFrame(() => inspector.querySelector(`#${sectionId}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }
}

function closeInspector() {
  inspectorOpen = false;
  applyInspectorState(!selectedProduct());
}

function closeSpecPopover() {
  specPopover.classList.add("hidden");
  specPopover.setAttribute("aria-hidden", "true");
  specPopover.innerHTML = "";
}

function openSpecPopover(productId, clientX, clientY) {
  const product = board.products.find((item) => item.id === productId);
  if (!product) return;
  selectedId = productId;
  renderInspector();
  renderBoard();
  specPopover.innerHTML = `
    <div class="spec-popover-heading">
      <div><span class="eyebrow">All specifications</span><h2>${escapeHtml(product.name)}</h2></div>
      <button id="closeSpecPopover" class="icon-button" aria-label="Close specifications">×</button>
    </div>
    <div class="spec-popover-list">${product.specs.map((item) => `
      <div class="spec-popover-row"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join("")}</div>
    <button id="editSpecs" class="secondary-button">Edit specifications</button>`;
  specPopover.classList.remove("hidden");
  specPopover.setAttribute("aria-hidden", "false");
  const margin = 12;
  const rect = specPopover.getBoundingClientRect();
  const left = Math.max(margin, Math.min(clientX + 12, window.innerWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(clientY + 12, window.innerHeight - rect.height - margin));
  specPopover.style.left = `${left}px`;
  specPopover.style.top = `${top}px`;
  $("#closeSpecPopover").onclick = closeSpecPopover;
  $("#editSpecs").onclick = () => { closeSpecPopover(); openInspector("specificationsSection"); };
}

function renderInspector() {
  const product = selectedProduct();
  if (!product) {
    applyInspectorState(true);
    inspector.innerHTML = "<h2>Product details</h2><p>Select a card, then choose Edit selected to update its product information.</p>";
    editSelectedButton.disabled = true;
    return;
  }
  applyInspectorState(false);
  editSelectedButton.disabled = false;
  inspector.innerHTML = `
    <div class="inspector-heading">
      <div><span class="eyebrow">Selected product</span><h2>${escapeHtml(product.name)}</h2></div>
      <div class="inspector-actions">
        <button id="deleteProduct" class="danger-button">Delete</button>
        <button id="closeInspector" class="icon-button" aria-label="Close editor">×</button>
      </div>
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
    <section id="roadmapSection" class="panel-section">
      <div class="section-heading-row"><h3>Roadmap slotting</h3><span class="eyebrow">Shared across views</span></div>
      <div class="roadmap-section-grid">
        <label class="full">Product family<input id="fieldRoadmapFamily" value="${escapeHtml(product.roadmap.family)}" placeholder="Cloud, Stinger, Jet…"></label>
        <label>Start<input id="fieldRoadmapStart" type="month" value="${escapeHtml(product.roadmap.startMonth)}"></label>
        <label>Launch<input id="fieldRoadmapLaunch" type="month" value="${escapeHtml(product.roadmap.launchMonth)}"></label>
        <label>End<input id="fieldRoadmapEnd" type="month" value="${escapeHtml(product.roadmap.endMonth)}"></label>
        <label>Status<select id="fieldRoadmapStatus">
          <option value="active" ${product.roadmap.status === "active" ? "selected" : ""}>Active / current</option>
          <option value="planned" ${product.roadmap.status === "planned" ? "selected" : ""}>Planned</option>
          <option value="approved" ${product.roadmap.status === "approved" ? "selected" : ""}>Approved</option>
          <option value="concept" ${product.roadmap.status === "concept" ? "selected" : ""}>Concept</option>
          <option value="embargo" ${product.roadmap.status === "embargo" ? "selected" : ""}>Under embargo</option>
          <option value="end-of-life" ${product.roadmap.status === "end-of-life" ? "selected" : ""}>End of life</option>
        </select></label>
        <label>Confidence<select id="fieldRoadmapConfidence">
          <option value="low" ${product.roadmap.confidence === "low" ? "selected" : ""}>Low</option>
          <option value="medium" ${product.roadmap.confidence === "medium" ? "selected" : ""}>Medium</option>
          <option value="high" ${product.roadmap.confidence === "high" ? "selected" : ""}>High</option>
        </select></label>
        <label>Predecessor<select id="fieldRoadmapPredecessor">
          <option value="">None</option>
          ${board.products.filter((item) => item.id !== product.id).map((item) => `<option value="${item.id}" ${product.roadmap.predecessorId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
        </select></label>
        <label>Successor<select id="fieldRoadmapSuccessor">
          <option value="">None</option>
          ${board.products.filter((item) => item.id !== product.id).map((item) => `<option value="${item.id}" ${product.roadmap.successorId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
        </select></label>
      </div>
      <div class="roadmap-link-actions">
        <button id="inspectRoadmapView">View on roadmap</button>
        <button id="inspectSplitView">Open split view</button>
      </div>
      <p class="roadmap-inline-note">The launch marker is independent of the lifecycle bar. Moving a bar shifts all three dates; resizing changes only the start or end boundary.</p>
    </section>
    <section id="specificationsSection" class="panel-section">
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
  $("#closeInspector").onclick = closeInspector;
  bindValue("#fieldName", "input", (value) => updateProduct(product.id, { name: value }, false));
  bindValue("#fieldPrice", "input", (value) => updateProduct(product.id, { price: value === "" ? null : Number(value) }, false));
  bindValue("#fieldLane", "change", (value) => moveProductToLane(product.id, value));
  bindValue("#fieldImageUrl", "change", (value) => updateProduct(product.id, { imageUrl: value }, false));
  bindValue("#fieldStatus", "change", (value) => updateProduct(product.id, { statusType: value }, false));
  bindValue("#fieldStatusLabel", "input", (value) => updateProduct(product.id, { statusLabel: value }, false));
  $("#fieldHighlight").onchange = (event) => updateProduct(product.id, { highlightEnabled: event.target.checked }, false);
  $("#fieldHighlightColor").oninput = (event) => updateProduct(product.id, { highlightColor: event.target.value }, false);
  bindValue("#fieldRoadmapFamily", "input", (value) => updateRoadmap(product.id, { family: value || "Other" }));
  bindValue("#fieldRoadmapStart", "change", (value) => updateRoadmap(product.id, (roadmap) => {
    const startMonth = normalizeMonth(value, roadmap.startMonth);
    return {
      startMonth,
      endMonth: monthIndex(roadmap.endMonth) < monthIndex(startMonth) ? startMonth : roadmap.endMonth,
      launchMonth: monthIndex(roadmap.launchMonth) < monthIndex(startMonth) ? startMonth : roadmap.launchMonth,
    };
  }, true));
  bindValue("#fieldRoadmapLaunch", "change", (value) => updateRoadmap(product.id, (roadmap) => {
    const launchIndex = Math.max(monthIndex(roadmap.startMonth), Math.min(monthIndex(roadmap.endMonth), monthIndex(value) ?? monthIndex(roadmap.launchMonth)));
    return { launchMonth: monthString(launchIndex) };
  }, true));
  bindValue("#fieldRoadmapEnd", "change", (value) => updateRoadmap(product.id, (roadmap) => {
    const endMonth = normalizeMonth(value, roadmap.endMonth);
    const normalizedEnd = monthIndex(endMonth) < monthIndex(roadmap.startMonth) ? roadmap.startMonth : endMonth;
    return {
      endMonth: normalizedEnd,
      launchMonth: monthIndex(roadmap.launchMonth) > monthIndex(normalizedEnd) ? normalizedEnd : roadmap.launchMonth,
    };
  }, true));
  bindValue("#fieldRoadmapStatus", "change", (value) => updateRoadmap(product.id, { status: value }));
  bindValue("#fieldRoadmapConfidence", "change", (value) => updateRoadmap(product.id, { confidence: value }));
  bindValue("#fieldRoadmapPredecessor", "change", (value) => updateRoadmap(product.id, { predecessorId: value }));
  bindValue("#fieldRoadmapSuccessor", "change", (value) => updateRoadmap(product.id, { successorId: value }));
  $("#inspectRoadmapView").onclick = () => { closeInspector(); setView("roadmap", { focusSelected: true }); };
  $("#inspectSplitView").onclick = () => { closeInspector(); setView("split", { focusSelected: true }); };
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
    if (index < 0) return;
    const existing = current.products[index];
    current.products[index] = {
      ...existing,
      ...patch,
      ...(patch.roadmap ? { roadmap: { ...existing.roadmap, ...patch.roadmap } } : {}),
    };
  }, { inspector: updateInspectorAfter });
}

function updateRoadmap(productId, updater, updateInspectorAfter = false) {
  updateBoard((current) => {
    const product = current.products.find((item) => item.id === productId);
    if (!product) return;
    const patch = typeof updater === "function" ? updater({ ...product.roadmap }) : updater;
    product.roadmap = { ...product.roadmap, ...patch };
    if (monthIndex(product.roadmap.endMonth) < monthIndex(product.roadmap.startMonth)) product.roadmap.endMonth = product.roadmap.startMonth;
    if (monthIndex(product.roadmap.launchMonth) < monthIndex(product.roadmap.startMonth)) product.roadmap.launchMonth = product.roadmap.startMonth;
    if (monthIndex(product.roadmap.launchMonth) > monthIndex(product.roadmap.endMonth)) product.roadmap.launchMonth = product.roadmap.endMonth;
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
    roadmap: makeRoadmap("Other", monthStringFromDate(), addMonths(monthStringFromDate(), 6), addMonths(monthStringFromDate(), 18), "planned", "medium"),
    specs: [spec("Connection", "Add value"), spec("Feature", "Add value")],
    skus: [sku("BK", "Black", "#111111")],
  });
  updateBoard((current) => current.products.push(product), { inspector: true });
  selectedId = product.id;
  openInspector();
  renderActiveView();
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
  renderActiveView();
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
  editSelectedButton.disabled = !selectedProduct();
  $("#showPrices").checked = board.settings.showPrices;
  $("#showSkus").checked = board.settings.showSkus;
  $("#roadmapStart").value = board.settings.roadmap.startMonth;
  $("#roadmapEnd").value = board.settings.roadmap.endMonth;
  $("#roadmapSnap").value = board.settings.roadmap.snap;
  $("#roadmapColorBy").value = board.settings.roadmap.colorBy;
  updateLinkedViewButton();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
}

function hitCard(point) {
  return [...renderedCards].reverse().find((card) => point.x >= card.x && point.x <= card.x + card.width && point.y >= card.y && point.y <= card.y + card.height);
}

function hitSpecOverflow(point) {
  return [...renderedSpecOverflow].reverse().find((region) => point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height);
}

canvas.addEventListener("pointerdown", (event) => {
  const point = canvasPoint(event);
  const overflow = hitSpecOverflow(point);
  if (overflow) {
    event.preventDefault();
    event.stopPropagation();
    openSpecPopover(overflow.productId, event.clientX, event.clientY);
    return;
  }
  closeSpecPopover();
  const card = hitCard(point);
  if (!card) {
    panState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: canvasScroll.scrollLeft,
    };
    canvas.setPointerCapture(event.pointerId);
    canvasScroll.classList.add("is-panning");
    return;
  }
  selectedId = card.productId;
  renderInspector();
  const product = selectedProduct();
  dragState = { productId: card.productId, offsetX: point.x - card.x, offsetY: point.y - card.y, position: { x: card.x, y: card.y } };
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = "grabbing";
  if (product) renderBoard();
});

canvas.addEventListener("pointermove", (event) => {
  if (panState) {
    canvasScroll.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX);
    return;
  }

  if (!dragState) {
    const point = canvasPoint(event);
    canvas.style.cursor = hitSpecOverflow(point) ? "pointer" : hitCard(point) ? "grab" : "grab";
    return;
  }

  const viewport = canvasScroll.getBoundingClientRect();
  const edge = 72;
  if (event.clientX < viewport.left + edge) canvasScroll.scrollLeft -= Math.ceil((viewport.left + edge - event.clientX) / 5);
  if (event.clientX > viewport.right - edge) canvasScroll.scrollLeft += Math.ceil((event.clientX - (viewport.right - edge)) / 5);

  const point = canvasPoint(event);
  dragState.position = { x: Math.max(GUTTER, point.x - dragState.offsetX), y: Math.max(LANE_TOP, point.y - dragState.offsetY) };
  renderBoard();
});

function finishDrag(event) {
  if (panState) {
    panState = null;
    canvasScroll.classList.remove("is-panning");
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    syncBoardNavigator();
    return;
  }
  if (!dragState) return;
  const current = dragState;
  dragState = null;
  canvas.style.cursor = "grab";
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  const lanes = sortedLanes();
  const laneIndex = Math.max(0, Math.min(lanes.length - 1, Math.round((current.position.y - LANE_TOP) / LANE_HEIGHT)));
  const targetIndex = Math.max(0, Math.round((current.position.x - GUTTER) / (CARD_WIDTH + CARD_GAP)));
  reorderProduct(current.productId, lanes[laneIndex].id, targetIndex);
}
canvas.addEventListener("pointerup", finishDrag);
canvas.addEventListener("pointercancel", finishDrag);
canvas.addEventListener("dblclick", (event) => {
  const point = canvasPoint(event);
  if (hitSpecOverflow(point)) return;
  const card = hitCard(point);
  if (!card) return;
  selectedId = card.productId;
  openInspector();
  renderBoard();
});

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
  const scale = 2;

  if (activeView === "products") {
    const dimensions = getCanvasDimensions();
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
    return;
  }

  const dimensions = roadmapDimensions();
  exportCanvas.width = dimensions.width * scale;
  exportCanvas.height = dimensions.height * scale;
  const exportContext = exportCanvas.getContext("2d");
  exportContext.setTransform(scale, 0, 0, scale, 0, 0);
  exportContext.imageSmoothingEnabled = true;
  exportContext.imageSmoothingQuality = "high";
  drawRoadmapTo(exportContext, dimensions, exportCanvas, { scrollLeft: 0, scrollTop: 0 }, false, true);
  exportCanvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, safeFilename("roadmap.png"));
  }, "image/png");
  renderRoadmaps();
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (parsed?.version !== 1 || !Array.isArray(parsed.products) || !Array.isArray(parsed.lanes)) throw new Error("Unsupported board file.");
      board = ensureBoardSchema(parsed);
      selectedId = board.products[0]?.id ?? null;
      scheduleSave();
      syncControls();
      renderInspector();
      renderActiveView();
    } catch (error) {
      alert(error.message || "Unable to import board file.");
    }
  };
  reader.readAsText(file);
}

canvasScroll.addEventListener("scroll", syncBoardNavigator, { passive: true });
canvasScroll.addEventListener("wheel", (event) => {
  const max = horizontalScrollMax();
  if (max <= 0) return;
  const horizontalIntent = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
  if (!horizontalIntent) return;
  event.preventDefault();
  canvasScroll.scrollLeft += event.deltaX || event.deltaY;
}, { passive: false });

canvas.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  scrollBoardBy(event.key === "ArrowLeft" ? -180 : 180, false);
});

navRange.addEventListener("input", () => {
  canvasScroll.scrollLeft = Number(navRange.value);
});
navLeft.onclick = () => scrollBoardBy(-Math.max(260, canvasScroll.clientWidth * .75));
navRight.onclick = () => scrollBoardBy(Math.max(260, canvasScroll.clientWidth * .75));
navSelected.onclick = scrollSelectedIntoView;

$("#addProduct").onclick = addProduct;
$("#editSelected").onclick = () => openInspector();
$("#applySort").onclick = applySort;
$("#importJson").onclick = () => $("#importFile").click();
$("#importFile").onchange = (event) => { const file = event.target.files?.[0]; if (file) importJson(file); event.target.value = ""; };
$("#exportJson").onclick = () => downloadBlob(new Blob([JSON.stringify(board, null, 2)], { type: "application/json" }), safeFilename("json"));
$("#exportPng").onclick = exportPng;
$("#boardTitle").oninput = (event) => updateBoard((current) => { current.title = event.target.value; });
$("#searchInput").oninput = (event) => { searchQuery = event.target.value; renderBoard(); };
$("#showPrices").onchange = (event) => updateBoard((current) => { current.settings.showPrices = event.target.checked; });
$("#showSkus").onchange = (event) => updateBoard((current) => { current.settings.showSkus = event.target.checked; });
$("#resetLayout").onclick = () => updateBoard((current) => { current.products.forEach((product) => delete product.manualPosition); current.settings.freeMove = false; current.lanes.forEach((lane) => normalizeLaneOrders(lane.id)); });
$("#zoomOut").onclick = () => { zoom = Math.max(.5, Number((zoom - .1).toFixed(2))); renderBoard(); };
$("#zoomReset").onclick = () => { zoom = 1; renderBoard(); };
$("#zoomIn").onclick = () => { zoom = Math.min(1.5, Number((zoom + .1).toFixed(2))); renderBoard(); };
$("#restoreSample").onclick = () => {
  if (!confirm("Replace the current board with the original sample data?")) return;
  board = createDefaultBoard();
  selectedId = board.products[0]?.id ?? null;
  searchQuery = "";
  roadmapSearchQuery = "";
  $("#searchInput").value = "";
  $("#roadmapSearch").value = "";
  scheduleSave();
  syncControls();
  renderInspector();
  renderActiveView();
};

document.querySelectorAll(".view-tab").forEach((button) => {
  button.onclick = () => setView(button.dataset.view, { focusSelected: true });
});
linkedViewButton.onclick = () => {
  if (activeView === "products") setView("roadmap", { focusSelected: true });
  else setView("products", { focusSelected: true });
};

$("#roadmapSearch").oninput = (event) => { roadmapSearchQuery = event.target.value; renderRoadmaps(); };
$("#roadmapStart").onchange = (event) => {
  const startMonth = normalizeMonth(event.target.value, board.settings.roadmap.startMonth);
  updateBoard((current) => {
    current.settings.roadmap.startMonth = startMonth;
    if (monthIndex(current.settings.roadmap.endMonth) <= monthIndex(startMonth)) current.settings.roadmap.endMonth = addMonths(startMonth, 11);
  });
};
$("#roadmapEnd").onchange = (event) => {
  let endMonth = normalizeMonth(event.target.value, board.settings.roadmap.endMonth);
  if (monthIndex(endMonth) <= monthIndex(board.settings.roadmap.startMonth)) endMonth = addMonths(board.settings.roadmap.startMonth, 11);
  updateBoard((current) => { current.settings.roadmap.endMonth = endMonth; });
};
$("#roadmapSnap").onchange = (event) => updateBoard((current) => { current.settings.roadmap.snap = event.target.value; });
$("#roadmapColorBy").onchange = (event) => updateBoard((current) => { current.settings.roadmap.colorBy = event.target.value; });
$("#roadmapToday").onclick = () => scrollRoadmapToday(activeView === "split" ? splitRoadmapScroll : roadmapScroll);
$("#roadmapFit").onclick = fitRoadmapTimeline;
$("#roadmapShowSelected").onclick = () => scrollRoadmapSelected(activeView === "split" ? splitRoadmapScroll : roadmapScroll);

function bindRoadmapNavigatorControls(targetScroll, refs) {
  refs.range.addEventListener("input", () => { targetScroll.scrollLeft = Number(refs.range.value); });
  refs.left.onclick = () => targetScroll.scrollBy({ left: -Math.max(300, targetScroll.clientWidth * .75), behavior: "smooth" });
  refs.right.onclick = () => targetScroll.scrollBy({ left: Math.max(300, targetScroll.clientWidth * .75), behavior: "smooth" });
  refs.selected.onclick = () => scrollRoadmapSelected(targetScroll);
}

bindRoadmapCanvas(roadmapCanvas, roadmapScroll, roadmapNavigatorRefs);
bindRoadmapCanvas(splitRoadmapCanvas, splitRoadmapScroll, splitRoadmapNavigatorRefs);
bindRoadmapNavigatorControls(roadmapScroll, roadmapNavigatorRefs());
bindRoadmapNavigatorControls(splitRoadmapScroll, splitRoadmapNavigatorRefs());

specPopover.addEventListener("pointerdown", (event) => event.stopPropagation());
document.addEventListener("pointerdown", (event) => { if (!specPopover.classList.contains("hidden") && !specPopover.contains(event.target)) closeSpecPopover(); });
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSpecPopover();
    closeInspector();
  }
});
window.addEventListener("resize", () => { closeSpecPopover(); renderActiveView(); });

board = loadBoard();
selectedId = board.products[0]?.id ?? null;
syncControls();
renderInspector();
setView("products");
