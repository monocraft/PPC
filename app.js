"use strict";

const STORAGE_KEY = "product-portfolio-canvas-v4";
const PREVIOUS_STORAGE_KEY = "product-portfolio-canvas-v3";
const LEGACY_STORAGE_KEY = "product-portfolio-canvas-v1";
const IMAGE_DB_NAME = "product-portfolio-image-assets-v1";
const IMAGE_DB_VERSION = 1;
const IMAGE_STORE_NAME = "images";
const CARD_WIDTH = 246;
const CARD_HEIGHT = 552;
const CARD_GAP = 10;
const GUTTER = 18;
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
const ROADMAP_MIN_BODY_HEIGHT = 156;
const ROADMAP_CATEGORY_LABEL_FONT_SIZE = 13;
const ROADMAP_MIN_MONTH_WIDTH = 8;
const ROADMAP_MAX_MONTH_WIDTH = 112;
const PRODUCT_MIN_ZOOM = 0.2;
const PRODUCT_MAX_ZOOM = 1.5;
const VIEWER_INFO_GAP = 0;
const VIEWER_INFO_ANIMATION_MS = 240;
const INFO_BUTTON_WIDTH = 25;
const INFO_BUTTON_HEIGHT = 22;
const FULL_SPEC_MIN_CARD_HEIGHT = 650;
const FULL_SPEC_IMAGE_HEIGHT = 210;
const FULL_SPEC_TITLE_TOP = STATUS_BANNER_HEIGHT + 10 + FULL_SPEC_IMAGE_HEIGHT + 8;
const FULL_SPEC_DETAILS_TOP_OFFSET = 66;
const COLOR_PRESETS = [
  { value: "#666c66", label: "Neutral gray" },
  { value: "#4e8136", label: "Portfolio green" },
  { value: "#8b7136", label: "Planning amber" },
  { value: "#3f6f91", label: "Product blue" },
  { value: "#3f8c7a", label: "Teal" },
  { value: "#76528e", label: "Violet" },
  { value: "#b83458", label: "Portfolio pink" },
];

const STANDARD_PRODUCT_COLORS = [
  { key: "black", label: "Black", code: "BK", hex: "#111111", aliases: ["black", "blk", "bk"] },
  { key: "white", label: "White", code: "WHT", hex: "#f2f2f2", aliases: ["white", "wht"] },
  { key: "gray", label: "Gray", code: "GRY", hex: "#707570", aliases: ["gray", "grey", "gry"] },
  { key: "silver", label: "Silver", code: "SLV", hex: "#b7bcb7", aliases: ["silver", "slv"] },
  { key: "red", label: "Red", code: "RED", hex: "#b72f3d", aliases: ["red"] },
  { key: "orange", label: "Orange", code: "ORG", hex: "#d36a2d", aliases: ["orange", "org"] },
  { key: "yellow", label: "Yellow", code: "YLW", hex: "#d4b33e", aliases: ["yellow", "ylw"] },
  { key: "green", label: "Green", code: "GRN", hex: "#4e8136", aliases: ["green", "grn"] },
  { key: "blue", label: "Blue", code: "BLU", hex: "#2f6fa2", aliases: ["blue", "blu"] },
  { key: "navy", label: "Navy", code: "NVY", hex: "#263d5b", aliases: ["navy", "nvy"] },
  { key: "cyan", label: "Cyan", code: "CYN", hex: "#00a8d6", aliases: ["cyan", "cyn"] },
  { key: "teal", label: "Teal", code: "TEAL", hex: "#3f8c7a", aliases: ["teal"] },
  { key: "purple", label: "Purple", code: "PUR", hex: "#76528e", aliases: ["purple", "pur"] },
  { key: "lavender", label: "Lavender", code: "LVR", hex: "#8d78aa", aliases: ["lavender", "lvr"] },
  { key: "pink", label: "Pink", code: "PNK", hex: "#c34d78", aliases: ["pink", "pnk"] },
  { key: "brown", label: "Brown", code: "BRN", hex: "#6d4b37", aliases: ["brown", "brn"] },
  { key: "beige", label: "Beige", code: "BGE", hex: "#c9bb98", aliases: ["beige", "bge"] },
  { key: "gold", label: "Gold", code: "GLD", hex: "#c39a3a", aliases: ["gold", "gld"] },
];

const COMMON_KEYBOARD_LAYOUTS = [
  { code: "US", label: "United States" },
  { code: "UK", label: "United Kingdom" },
  { code: "FR", label: "France" },
  { code: "GR", label: "Germany" },
  { code: "SP", label: "Spain" },
  { code: "PORT", label: "Portugal" },
  { code: "IT", label: "Italy" },
  { code: "JPN2", label: "Japan" },
  { code: "KOR", label: "Korea" },
  { code: "TW", label: "Taiwan" },
  { code: "TURK", label: "Turkey" },
  { code: "THAI", label: "Thailand" },
  { code: "LTNA", label: "Latin America" },
  { code: "NRL", label: "Nordic" },
  { code: "SWIS2", label: "Switzerland" },
  { code: "SAU", label: "Saudi Arabia" },
];

const CATALOG = window.PORTFOLIO_CATALOG || { categories: [] };
const CATEGORY_DEFINITIONS = CATALOG.categories.map((category) => {
  const { products, specSets, ...definition } = category;
  const defaultSet = (specSets || []).find((item) => item.id === definition.defaultSpecSetId) || (specSets || [])[0];
  return {
    ...definition,
    defaultSpecs: (defaultSet?.specs || []).map(([label, value]) => [label, value]),
  };
});
const CATEGORY_SPEC_SETS = new Map(
  CATALOG.categories.map((category) => [category.id, Array.isArray(category.specSets) ? category.specSets : []])
);

const STANDARD_CARD_STATUSES = {
  none: { label: "", color: "#383b38" },
  new: { label: "NEW PRODUCT", color: "#4e8136" },
  embargo: { label: "UPCOMING UNDER EMBARGO", color: "#b83458" },
};

const PRODUCT_TIER_OPTIONS = ["", "Core", "Core+", "Hero", "Star", "Star+"];


const $ = (selector) => document.querySelector(selector);
const canvas = $("#boardCanvas");
const ctx = canvas.getContext("2d");
const canvasScroll = $("#canvasScroll");
const laneRailInner = $("#laneRailInner");
const boardNavigator = $("#boardNavigator");
const navRange = $("#navRange");
const navLeft = $("#navLeft");
const navRight = $("#navRight");
const navSelected = $("#navSelected");
const navPosition = $("#navPosition");
const inspector = $("#inspector");
const viewerInfo = $("#viewerInfo");
const viewerInfoOutline = $("#viewerInfoOutline");
const specPopover = $("#specPopover");
const variantPopover = $("#variantPopover");
const editSelectedButton = $("#editSelected");
const productLayoutEditButton = $("#productLayoutEditToggle");
const imageCache = new Map();
const imageAssetUrlCache = new Map();
const imageAssetLoadPromises = new Map();
const missingImageAssetIds = new Set();
const pendingLegacyImageBlobs = [];
let imageDbPromise = null;
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
const roadmapEditSelectedButton = $("#roadmapEditSelected");
const roadmapMenuButton = $("#roadmapMenuButton");
const roadmapMenu = $("#roadmapMenu");
const productMenuButton = $("#productMenuButton");
const productMenu = $("#productMenu");
const dataMenuButton = $("#dataMenuButton");
const dataMenu = $("#dataMenu");
const categorySelect = $("#categorySelect");
const categorySettingsDialog = $("#categorySettingsDialog");
const categorySettingsForm = $("#categorySettingsForm");
const pptxExportDialog = $("#pptxExportDialog");
const pptxExportForm = $("#pptxExportForm");
const confirmPptxExportButton = $("#confirmPptxExport");
const laneSettingsList = $("#laneSettingsList");
let categorySettingsDraftLanes = [];

let portfolio = null;
let board = null;
let activeCategoryId = null;
let selectedId = null;
let zoom = 1;
let searchQuery = "";
let dragState = null;
let panState = null;
let renderedCards = [];
let renderedSpecOverflow = [];
let renderedVariantOverflow = [];
let renderedHeroVariantRegions = [];
let renderedInfoButtons = [];
let hoveredInfoButtonProductId = "";
let hoveredHeroVariant = null;
const pinnedHeroVariantByProduct = new Map();
let variantPopoverPinned = false;
let variantPopoverKey = "";
let variantHoverOpenTimer = null;
let variantHoverCloseTimer = null;
let inspectorOpen = false;
let viewerInfoOpen = false;
let viewerInfoProductId = null;
let viewerInfoProgress = 0;
let viewerInfoAnimationFrame = null;
let saveTimer = null;
let activeView = "products";
let roadmapSearchQuery = "";
let roadmapFilterScrollResetPending = false;
let roadmapMonthWidth = 82;
let roadmapHitRegions = new Map();
let roadmapDragState = null;
let roadmapPanState = null;
let roadmapDraft = null;
let roadmapEditProductId = null;
let initialVerticalFitPending = true;
let productLayoutEditing = false;

function id() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function openImageDatabase() {
  if (imageDbPromise) return imageDbPromise;
  imageDbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("This browser does not support the local image library."));
      return;
    }
    const request = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IMAGE_STORE_NAME)) database.createObjectStore(IMAGE_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open the image library."));
  });
  return imageDbPromise;
}

async function imageStorePut(assetId, blob) {
  const database = await openImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).put({ id: assetId, blob, updatedAt: Date.now() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Unable to save the image."));
    transaction.onabort = () => reject(transaction.error || new Error("Image save was cancelled."));
  });
}

async function imageStoreGet(assetId) {
  const database = await openImageDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readonly");
    const request = transaction.objectStore(IMAGE_STORE_NAME).get(assetId);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => reject(request.error || new Error("Unable to read the image."));
  });
}

async function imageStoreDelete(assetId) {
  const database = await openImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).delete(assetId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Unable to remove the image."));
  });
}

async function imageStoreClear() {
  const database = await openImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Unable to clear the image library."));
  });
}

function imageAssetById(assetId) {
  return portfolio?.imageAssets?.find((asset) => asset.id === assetId) || null;
}

function referencedImageAssetIds() {
  const references = new Set();
  portfolio?.categories?.forEach((category) => {
    category.board?.products?.forEach((product) => {
      if (product.imageAssetId) references.add(product.imageAssetId);
      productVariantGroups(product).forEach((group) => {
        group.items.forEach((item) => {
          if (item.imageAssetId) references.add(item.imageAssetId);
        });
      });
    });
  });
  return references;
}

function revokeImageAssetUrl(assetId) {
  const url = imageAssetUrlCache.get(assetId);
  if (url) URL.revokeObjectURL(url);
  imageAssetUrlCache.delete(assetId);
  imageAssetLoadPromises.delete(assetId);
  missingImageAssetIds.delete(assetId);
}

async function removeImageAssetIfUnused(assetId) {
  if (!assetId || referencedImageAssetIds().has(assetId)) return;
  const asset = imageAssetById(assetId);
  portfolio.imageAssets = portfolio.imageAssets.filter((item) => item.id !== assetId);
  revokeImageAssetUrl(assetId);
  if (asset?.sourceType === "local") {
    try { await imageStoreDelete(assetId); } catch (_) {}
  }
  scheduleSave();
}

function dataUriToBlob(dataUri) {
  const match = String(dataUri || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  try {
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return new Blob([bytes], { type: mimeType });
    }
    return new Blob([decodeURIComponent(payload)], { type: mimeType });
  } catch (_) {
    return null;
  }
}

function extensionForImageAsset(asset) {
  const fromName = String(asset?.fileName || asset?.name || "").match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/avif": "avif",
  }[asset?.mimeType] || "img";
}

function createImageAssetMetadata({ sourceType, name, mimeType = "", size = 0, url = "", assetId = id() }) {
  return {
    id: assetId,
    sourceType,
    name: String(name || "Product image"),
    mimeType: String(mimeType || ""),
    size: Number(size || 0),
    url: sourceType === "url" ? String(url || "") : "",
    updatedAt: new Date().toISOString(),
  };
}

function ensureImageAssetRegistry(target) {
  target.imageAssets = Array.isArray(target.imageAssets) ? target.imageAssets : [];
  target.imageAssets = target.imageAssets.filter((asset) => asset && asset.id).map((asset) => ({
    id: String(asset.id),
    sourceType: asset.sourceType === "url" ? "url" : "local",
    name: String(asset.name || asset.fileName || "Product image"),
    mimeType: String(asset.mimeType || ""),
    size: Number(asset.size || 0),
    url: asset.sourceType === "url" ? String(asset.url || "") : "",
    updatedAt: String(asset.updatedAt || ""),
    packagePath: asset.packagePath ? String(asset.packagePath) : undefined,
  }));
}

function migrateLegacyProductImages(target) {
  ensureImageAssetRegistry(target);
  const urlAssetIds = new Map(target.imageAssets.filter((asset) => asset.sourceType === "url" && asset.url).map((asset) => [asset.url, asset.id]));
  const dataAssetIds = new Map();
  target.categories?.forEach((category) => {
    category.board?.products?.forEach((product) => {
      product.imageAssetId = String(product.imageAssetId || "");
      const legacyUrl = String(product.imageUrl || "").trim();
      if (!product.imageAssetId && legacyUrl) {
        if (legacyUrl.startsWith("data:")) {
          let assetId = dataAssetIds.get(legacyUrl);
          if (!assetId) {
            const blob = dataUriToBlob(legacyUrl);
            if (blob) {
              assetId = id();
              target.imageAssets.push(createImageAssetMetadata({
                sourceType: "local",
                name: `${product.name || "Product"} image`,
                mimeType: blob.type,
                size: blob.size,
                assetId,
              }));
              pendingLegacyImageBlobs.push({ id: assetId, blob });
              dataAssetIds.set(legacyUrl, assetId);
            }
          }
          product.imageAssetId = assetId || "";
        } else {
          let assetId = urlAssetIds.get(legacyUrl);
          if (!assetId) {
            assetId = id();
            target.imageAssets.push(createImageAssetMetadata({ sourceType: "url", name: `${product.name || "Product"} image`, url: legacyUrl, assetId }));
            urlAssetIds.set(legacyUrl, assetId);
          }
          product.imageAssetId = assetId;
        }
      }
      delete product.imageUrl;
    });
  });
}

async function flushPendingLegacyImages() {
  if (!pendingLegacyImageBlobs.length) return;
  const queue = pendingLegacyImageBlobs.splice(0);
  for (const entry of queue) {
    try {
      await imageStorePut(entry.id, entry.blob);
      missingImageAssetIds.delete(entry.id);
    } catch (_) {}
  }
  scheduleSave();
}

function loadLocalImageAsset(assetId) {
  if (!assetId || missingImageAssetIds.has(assetId) || imageAssetLoadPromises.has(assetId) || imageAssetUrlCache.has(assetId)) return;
  const promise = imageStoreGet(assetId)
    .then((blob) => {
      if (!blob) {
        missingImageAssetIds.add(assetId);
        renderInspector();
        return;
      }
      missingImageAssetIds.delete(assetId);
      const objectUrl = URL.createObjectURL(blob);
      imageAssetUrlCache.set(assetId, objectUrl);
      renderActiveView();
      renderInspector();
    })
    .catch(() => {})
    .finally(() => imageAssetLoadPromises.delete(assetId));
  imageAssetLoadPromises.set(assetId, promise);
}

function imageAssetSource(assetId, fallback = categoryPlaceholderImage()) {
  const asset = imageAssetById(assetId);
  if (!asset) return fallback;
  if (asset.sourceType === "url") return asset.url || fallback;
  const cached = imageAssetUrlCache.get(asset.id);
  if (cached) return cached;
  loadLocalImageAsset(asset.id);
  return fallback;
}

function imageAssetWebUrl(assetId) {
  const asset = imageAssetById(assetId);
  return asset?.sourceType === "url" ? asset.url : "";
}

function productImageSource(product) {
  return imageAssetSource(productDisplayImageAssetId(product));
}

function productImageWebUrl(product) {
  return imageAssetWebUrl(product?.imageAssetId);
}

async function createLocalImageAsset(file, productName) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("Choose a supported image file.");
  const asset = createImageAssetMetadata({
    sourceType: "local",
    name: file.name || `${productName || "Product"} image`,
    mimeType: file.type,
    size: file.size,
  });
  await imageStorePut(asset.id, file);
  missingImageAssetIds.delete(asset.id);
  portfolio.imageAssets.push(asset);
  revokeImageAssetUrl(asset.id);
  scheduleSave();
  return asset.id;
}

function createUrlImageAsset(url, productName) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return "";
  const existing = portfolio.imageAssets.find((asset) => asset.sourceType === "url" && asset.url === normalizedUrl);
  if (existing) return existing.id;
  const asset = createImageAssetMetadata({ sourceType: "url", name: `${productName || "Product"} image`, url: normalizedUrl });
  portfolio.imageAssets.push(asset);
  scheduleSave();
  return asset.id;
}

async function setProductImageAsset(productId, imageAssetId) {
  const product = board.products.find((item) => item.id === productId);
  if (!product) return;
  const previousAssetId = product.imageAssetId || "";
  updateProduct(productId, { imageAssetId: imageAssetId || "" }, true);
  if (previousAssetId && previousAssetId !== imageAssetId) await removeImageAssetIfUnused(previousAssetId);
}

async function setVariantImageAsset(productId, variantId, imageAssetId) {
  const product = board.products.find((item) => item.id === productId);
  const variant = colorVariantById(product, variantId);
  if (!product || !variant) return;
  const previousAssetId = variant.imageAssetId || "";
  updateBoard((current) => {
    const target = current.products.find((item) => item.id === productId);
    if (!target) return;
    target.variantGroups = productVariantGroups(target).map((group) => ({
      ...group,
      items: group.items.map((item) => item.id === variantId ? { ...item, imageAssetId: imageAssetId || "" } : item),
    }));
    if (imageAssetId && !target.featuredVariantId) target.featuredVariantId = variantId;
    if (!imageAssetId && target.featuredVariantId === variantId) target.featuredVariantId = "";
  }, { inspector: true });
  if (!imageAssetId && pinnedHeroVariantByProduct.get(productId) === variantId) pinnedHeroVariantByProduct.delete(productId);
  if (hoveredHeroVariant?.productId === productId && hoveredHeroVariant.variantId === variantId && !imageAssetId) hoveredHeroVariant = null;
  if (previousAssetId && previousAssetId !== imageAssetId) await removeImageAssetIfUnused(previousAssetId);
}

function closePopupMenus(except = null) {
  [dataMenu, roadmapMenu, productMenu].forEach((menu) => {
    if (!menu || menu === except) return;
    menu.classList.add("hidden");
  });
  [dataMenuButton, roadmapMenuButton, productMenuButton].forEach((button) => {
    if (!button) return;
    const controlsMenu = button === dataMenuButton ? dataMenu : button === roadmapMenuButton ? roadmapMenu : productMenu;
    button.setAttribute("aria-expanded", String(Boolean(controlsMenu && !controlsMenu.classList.contains("hidden"))));
  });
}

function positionPopupMenu(button, menu) {
  const rect = button.getBoundingClientRect();
  menu.classList.remove("hidden");
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
  const preferredTop = rect.bottom + 6;
  const top = preferredTop + height <= window.innerHeight - 8
    ? preferredTop
    : Math.max(8, rect.top - height - 6);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function togglePopupMenu(button, menu) {
  const opening = menu.classList.contains("hidden");
  closePopupMenus();
  if (opening) {
    positionPopupMenu(button, menu);
    button.setAttribute("aria-expanded", "true");
  }
}

function spec(label, value) {
  return { id: id(), label, value };
}

function sku(code, colorName, colorHex, colorHex2 = "") {
  return { id: id(), code, colorName, colorHex, colorHex2 };
}

function standardColorByKey(key) {
  return STANDARD_PRODUCT_COLORS.find((item) => item.key === key) || null;
}

function inferStandardColor(name, hex) {
  const normalizedName = String(name || "").trim().toLowerCase();
  const normalizedHex = String(hex || "").trim().toLowerCase();
  return STANDARD_PRODUCT_COLORS.find((item) =>
    item.hex.toLowerCase() === normalizedHex
    || item.aliases.some((alias) => normalizedName === alias || normalizedName.includes(alias))
  ) || null;
}

function colorVariant(code = "BK", colorKey = "black", customName = "", customHex = "#777777") {
  const preset = standardColorByKey(colorKey);
  return {
    id: id(),
    code: code || preset?.code || "SKU",
    colorKey: preset ? preset.key : "custom",
    colorName: preset?.label || customName || "Custom",
    colorHex: preset?.hex || customHex,
    colorKey2: "",
    colorName2: "",
    colorHex2: "",
    imageAssetId: "",
  };
}

function layoutVariant(code = "US", label = "") {
  return { id: id(), code, label };
}

function variantGroup(type = "color", label = "", items = []) {
  const normalizedType = type === "layout" ? "layout" : "color";
  return {
    id: id(),
    type: normalizedType,
    label: label || (normalizedType === "layout" ? "LAYOUT SKU" : "COLOR SKU"),
    items,
  };
}

function defaultVariantGroupForDefinition(definition = categoryDefinition()) {
  if (definition.defaultVariantType === "layout") {
    return variantGroup("layout", definition.defaultVariantLabel || "LAYOUT SKU", [layoutVariant("US", "United States")]);
  }
  return variantGroup("color", definition.defaultVariantLabel || "COLOR SKU", [colorVariant("BK", "black")]);
}

function normalizeColorVariant(item) {
  const nameParts = String(item.colorName || "").split(/\s*(?:\/|\+|&|,)\s*/).filter(Boolean);
  const codeParts = String(item.code || "").split(/\s*(?:\/|\+|&|,)\s*/).filter(Boolean);
  const primaryName = nameParts[0] || codeParts[0] || item.colorName;
  const secondaryName = item.colorName2 || nameParts[1] || codeParts[1] || "";
  const primaryPreset = standardColorByKey(item.colorKey) || inferStandardColor(primaryName, item.colorHex);
  const secondaryPreset = standardColorByKey(item.colorKey2) || inferStandardColor(secondaryName, item.colorHex2);
  const primaryKey = primaryPreset?.key || "custom";
  const secondaryKey = item.colorHex2 || item.colorKey2 ? (secondaryPreset?.key || "custom") : "";
  return {
    id: item.id || id(),
    code: String(item.code || primaryPreset?.code || "SKU"),
    colorKey: primaryKey,
    colorName: primaryPreset?.label || String(item.colorName || "Custom"),
    colorHex: primaryPreset?.hex || item.colorHex || "#777777",
    colorKey2: secondaryKey,
    colorName2: secondaryKey ? (secondaryPreset?.label || String(item.colorName2 || "Custom")) : "",
    colorHex2: secondaryKey ? (secondaryPreset?.hex || item.colorHex2 || "#ffffff") : "",
    imageAssetId: String(item.imageAssetId || ""),
  };
}

function normalizeLayoutVariant(item) {
  return {
    id: item.id || id(),
    code: String(item.code || "SKU").trim() || "SKU",
    label: String(item.label || item.colorName || "").trim(),
  };
}

function normalizeVariantGroup(group, definition = categoryDefinition()) {
  const type = group?.type === "layout" ? "layout" : "color";
  const defaultLabel = type === "layout" ? "LAYOUT SKU" : "COLOR SKU";
  return {
    id: group?.id || id(),
    type,
    label: String(group?.label || defaultLabel).trim() || defaultLabel,
    items: Array.isArray(group?.items)
      ? group.items.map((item) => type === "layout" ? normalizeLayoutVariant(item) : normalizeColorVariant(item))
      : [],
  };
}

function productVariantGroups(product) {
  return Array.isArray(product?.variantGroups) ? product.variantGroups : [];
}

function productVariantItems(product) {
  return productVariantGroups(product).flatMap((group) => group.items || []);
}

function productVariantCount(product) {
  return productVariantItems(product).length;
}

function productColorVariants(product) {
  return productVariantGroups(product)
    .filter((group) => group.type === "color")
    .flatMap((group) => group.items || []);
}

function colorVariantById(product, variantId) {
  if (!variantId) return null;
  return productColorVariants(product).find((item) => item.id === variantId) || null;
}

function colorVariantWithImage(product, variantId) {
  const variant = colorVariantById(product, variantId);
  return variant?.imageAssetId ? variant : null;
}

function activeHeroVariant(product) {
  if (!product) return null;
  if (hoveredHeroVariant?.productId === product.id) {
    const hovered = colorVariantWithImage(product, hoveredHeroVariant.variantId);
    if (hovered) return hovered;
  }
  const pinned = colorVariantWithImage(product, pinnedHeroVariantByProduct.get(product.id));
  if (pinned) return pinned;
  const featured = colorVariantWithImage(product, product.featuredVariantId);
  if (featured) return featured;
  if (!product.imageAssetId) return productColorVariants(product).find((item) => item.imageAssetId) || null;
  return null;
}

function productDisplayImageAssetId(product) {
  return activeHeroVariant(product)?.imageAssetId || product?.imageAssetId || "";
}

function setHoveredHeroVariant(productId = "", variantId = "") {
  const next = productId && variantId ? { productId, variantId } : null;
  if (hoveredHeroVariant?.productId === next?.productId && hoveredHeroVariant?.variantId === next?.variantId) return;
  hoveredHeroVariant = next;
  renderBoard();
  if (activeView === "split") renderSplitProduct();
}

function togglePinnedHeroVariant(productId, variantId) {
  const product = board.products.find((item) => item.id === productId);
  if (!colorVariantWithImage(product, variantId)) return;
  if (pinnedHeroVariantByProduct.get(productId) === variantId) pinnedHeroVariantByProduct.delete(productId);
  else pinnedHeroVariantByProduct.set(productId, variantId);
  hoveredHeroVariant = null;
  renderBoard();
  if (activeView === "split") renderSplitProduct();
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

function categoryDefinition(categoryId = activeCategoryId) {
  const definition = CATEGORY_DEFINITIONS.find((item) => item.id === categoryId) || CATEGORY_DEFINITIONS[0];
  if (!definition) {
    throw new Error("No category definitions are available. Confirm catalog-data.js loads before app.js and contains at least one category.");
  }
  return definition;
}

function categorySpecSets(categoryId = activeCategoryId) {
  return CATEGORY_SPEC_SETS.get(categoryId) || [];
}

function categoryPlaceholderImage() {
  return categoryDefinition().placeholderImage || PLACEHOLDER_IMAGE;
}

function activeCategoryRecord() {
  return portfolio?.categories?.find((item) => item.id === activeCategoryId) || null;
}

function normalizeRoadmapStatus(status) {
  return {
    active: "launched",
    launched: "launched",
    approved: "in-development",
    "in-development": "in-development",
    planned: "in-planning",
    concept: "in-planning",
    "in-planning": "in-planning",
    embargo: "embargo",
    "end-of-life": "end-of-life",
  }[status] || "in-planning";
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
  return makeRoadmap(inferFamily(product.name), start, start, addMonths(start, 18), product.statusType === "embargo" ? "in-planning" : "in-planning", "medium");
}

function normalizeProductInfoDate(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizePartSku(item, index = 0) {
  if (typeof item === "string") {
    return {
      id: `part-sku-${index + 1}-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      code: item.trim(),
    };
  }
  const code = String(item?.code || item?.sku || item?.value || "").trim();
  return {
    id: String(item?.id || `part-sku-${index + 1}-${code.toLowerCase().replace(/[^a-z0-9]+/g, "-") || id()}`),
    code,
  };
}

function partSku(code = "") {
  return { id: id(), code: String(code || "").trim() };
}

function productTierOptionsHtml(currentTier) {
  const normalized = PRODUCT_TIER_OPTIONS.includes(currentTier) ? currentTier : "";
  return PRODUCT_TIER_OPTIONS.map((tier) => `
    <option value="${escapeHtml(tier)}" ${tier === normalized ? "selected" : ""}>${tier || "Not set"}</option>`).join("");
}

function formatProductInfoDate(value) {
  const normalized = normalizeProductInfoDate(value);
  if (!normalized) return "TBD";
  const [year, month, day] = normalized.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

async function copyTextToClipboard(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function ensureBoardSchema(target, definition = categoryDefinition()) {
  target.version = 1;
  target.title = String(target.title || definition.boardTitle).trim() || definition.boardTitle;
  target.lanes = Array.isArray(target.lanes) && target.lanes.length
    ? target.lanes
    : definition.lanes.map((lane, order) => ({ ...lane, order }));
  target.products = Array.isArray(target.products) ? target.products : [];
  target.settings = { showPrices: true, showSkus: true, fullSingleLaneSpecs: true, ...target.settings, freeMove: false };
  target.settings.roadmap = {
    startMonth: "2026-01",
    endMonth: "2027-12",
    snap: "month",
    categoryLabel: definition.categoryLabel,
    familyOrder: [...definition.familyOrder],
    statusColors: {
      launched: "#666c66",
      "in-development": "#4e8136",
      "in-planning": "#8b7136",
    },
    ...(target.settings.roadmap || {}),
  };
  target.settings.roadmap.statusColors = {
    launched: "#666c66",
    "in-development": "#4e8136",
    "in-planning": "#8b7136",
    ...(target.settings.roadmap.statusColors || {}),
  };
  target.settings.roadmap.familyOrder = Array.isArray(target.settings.roadmap.familyOrder)
    ? target.settings.roadmap.familyOrder
    : [...definition.familyOrder];
  target.settings.roadmap.categoryLabel = String(target.settings.roadmap.categoryLabel || definition.categoryLabel).trim() || definition.categoryLabel;
  if (monthIndex(target.settings.roadmap.endMonth) <= monthIndex(target.settings.roadmap.startMonth)) {
    target.settings.roadmap.endMonth = addMonths(target.settings.roadmap.startMonth, 23);
  }
  target.lanes.forEach((lane, index) => {
    lane.id = String(lane.id || `lane-${index + 1}`);
    lane.label = String(lane.label || `LANE ${index + 1}`);
    lane.subtitle = String(lane.subtitle || "");
    lane.order = Number.isFinite(lane.order) ? lane.order : index;
  });
  target.products.forEach((product, index) => {
    delete product.manualPosition;
    if (!target.lanes.some((lane) => lane.id === product.laneId)) product.laneId = target.lanes[0]?.id || "default";
    const fallback = defaultRoadmapForProduct(product, index);
    const existing = product.roadmap || {};
    product.imageAssetId = String(product.imageAssetId || "");
    product.priceLabel = String(product.priceLabel || "");
    product.codename = String(product.codename || "");
    product.tier = PRODUCT_TIER_OPTIONS.includes(product.tier) ? product.tier : "";
    product.ffsDate = normalizeProductInfoDate(product.ffsDate);
    product.globalAnnouncementDate = normalizeProductInfoDate(product.globalAnnouncementDate);
    product.webReadinessDate = normalizeProductInfoDate(product.webReadinessDate);
    product.finalAssetsDate = normalizeProductInfoDate(product.finalAssetsDate);
    product.partSkus = (Array.isArray(product.partSkus) ? product.partSkus : [])
      .map((item, partSkuIndex) => normalizePartSku(item, partSkuIndex));
    if (product.statusType === "custom") {
      product.variantLabel = product.variantLabel || product.statusLabel || "VARIANT";
      product.variantColor = product.variantColor || product.highlightColor || "#3f6f91";
      product.statusType = "none";
    }
    product.statusType = ["new", "embargo"].includes(product.statusType) ? product.statusType : "none";
    product.statusLabel = standardizedStatus(product.statusType).label;
    product.variantLabel = String(product.variantLabel || "");
    product.variantColor = String(product.variantColor || product.highlightColor || "#3f6f91");
    product.highlightEnabled = false;
    product.highlightColor = product.variantColor;
    product.specs = Array.isArray(product.specs) ? product.specs : [];
    const legacySkus = Array.isArray(product.skus) ? product.skus : [];
    if (!Array.isArray(product.variantGroups)) {
      product.variantGroups = legacySkus.length
        ? [variantGroup("color", "COLOR SKU", legacySkus.map((item) => normalizeColorVariant(item)))]
        : [];
    }
    product.variantGroups = product.variantGroups.map((group) => normalizeVariantGroup(group, definition));
    product.featuredVariantId = String(product.featuredVariantId || "");
    if (!colorVariantWithImage(product, product.featuredVariantId)) product.featuredVariantId = "";
    delete product.skus;
    const launchMonth = normalizeMonth(existing.launchMonth || existing.startMonth || existing.launchDate || existing.startDate, fallback.startMonth);
    product.roadmap = {
      ...fallback,
      ...existing,
      family: existing.family || fallback.family,
      startMonth: launchMonth,
      launchMonth,
      endMonth: normalizeMonth(existing.endMonth || existing.endDate, fallback.endMonth),
      status: normalizeRoadmapStatus(existing.status || fallback.status),
      predecessorId: existing.predecessorId || "",
      successorId: existing.successorId || "",
    };
    if (monthIndex(product.roadmap.endMonth) < monthIndex(product.roadmap.startMonth)) product.roadmap.endMonth = product.roadmap.startMonth;
    product.roadmap.launchMonth = product.roadmap.startMonth;
  });
  return target;
}

function makeProduct(productId, name, price, laneId, order, options = {}) {
  const statusType = ["new", "embargo"].includes(options.statusType) ? options.statusType : "none";
  return {
    id: productId,
    name,
    price,
    priceLabel: String(options.priceLabel || ""),
    imageAssetId: String(options.imageAssetId || ""),
    codename: String(options.codename || ""),
    tier: PRODUCT_TIER_OPTIONS.includes(options.tier) ? options.tier : "",
    ffsDate: normalizeProductInfoDate(options.ffsDate),
    globalAnnouncementDate: normalizeProductInfoDate(options.globalAnnouncementDate),
    webReadinessDate: normalizeProductInfoDate(options.webReadinessDate),
    finalAssetsDate: normalizeProductInfoDate(options.finalAssetsDate),
    partSkus: (Array.isArray(options.partSkus) ? options.partSkus : []).map((item, index) => normalizePartSku(item, index)),
    laneId,
    order,
    statusType,
    statusLabel: standardizedStatus(statusType).label,
    variantLabel: String(options.variantLabel || ""),
    variantColor: String(options.variantColor || "#3f6f91"),
    highlightEnabled: false,
    highlightColor: String(options.variantColor || options.highlightColor || "#3f6f91"),
    roadmap: options.roadmap || null,
    specs: options.specs || [],
    featuredVariantId: String(options.featuredVariantId || ""),
    variantGroups: options.variantGroups || (options.skus?.length
      ? [variantGroup("color", "COLOR SKU", options.skus.map((item) => normalizeColorVariant(item)))]
      : []),
  };
}


function catalogCategory(categoryId = activeCategoryId) {
  return CATALOG.categories.find((item) => item.id === categoryId) || CATALOG.categories[0] || null;
}

function standardizedStatus(type) {
  return STANDARD_CARD_STATUSES[type] || STANDARD_CARD_STATUSES.none;
}

function catalogImageAssetId(categoryId, productId) {
  return `catalog:${categoryId}:${productId}`;
}

function catalogImageAssets() {
  return CATALOG.categories.flatMap((category) => (category.products || []).map((product) => ({
    id: catalogImageAssetId(category.id, product.id),
    sourceType: "url",
    name: `${product.name} sample image`,
    mimeType: "image/webp",
    size: 0,
    url: product.imagePath,
    updatedAt: "",
  })));
}

function variantGroupFromBlueprint(group) {
  if (!group) return null;
  if (group.type === "layout") {
    return variantGroup("layout", group.label || "LAYOUT SKU", (group.items || []).map((item) => layoutVariant(item.code, item.label)));
  }
  return variantGroup("color", group.label || "COLOR SKU", (group.items || []).map((item) => {
    const primary = standardColorByKey(item.colorKey) || standardColorByKey("black");
    const secondary = item.colorKey2 ? (standardColorByKey(item.colorKey2) || standardColorByKey("white")) : null;
    return normalizeColorVariant({
      id: id(),
      code: item.code || primary.code,
      colorKey: primary.key,
      colorName: primary.label,
      colorHex: primary.hex,
      colorKey2: secondary?.key || "",
      colorName2: secondary?.label || "",
      colorHex2: secondary?.hex || "",
    });
  }));
}

function productFromBlueprint(blueprint, definition, index) {
  const status = ["new", "embargo"].includes(blueprint.statusType) ? blueprint.statusType : "none";
  const launchMonth = normalizeMonth(blueprint.launchMonth, monthStringFromDate());
  const endMonth = normalizeMonth(blueprint.endMonth, addMonths(launchMonth, 24));
  return makeProduct(blueprint.id, blueprint.name, blueprint.price, blueprint.laneId, blueprint.order ?? index, {
    priceLabel: blueprint.priceLabel || "",
    imageAssetId: catalogImageAssetId(definition.id, blueprint.id),
    codename: blueprint.codename || "",
    tier: blueprint.tier || "",
    ffsDate: blueprint.ffsDate || "",
    globalAnnouncementDate: blueprint.globalAnnouncementDate || "",
    webReadinessDate: blueprint.webReadinessDate || "",
    finalAssetsDate: blueprint.finalAssetsDate || "",
    partSkus: blueprint.partSkus || [],
    statusType: status,
    statusLabel: standardizedStatus(status).label,
    variantLabel: blueprint.variantLabel || "",
    variantColor: blueprint.variantColor || "#3f6f91",
    roadmap: makeRoadmap(
      blueprint.family || "Other",
      launchMonth,
      launchMonth,
      endMonth,
      blueprint.roadmapStatus || (status === "embargo" ? "in-planning" : status === "new" ? "in-development" : "launched"),
      blueprint.confidence || "medium"
    ),
    specs: (blueprint.specs || []).map((item) => spec(item.label, item.value)),
    variantGroups: (Array.isArray(blueprint.variants) ? blueprint.variants : blueprint.variants ? [blueprint.variants] : []).map(variantGroupFromBlueprint).filter(Boolean),
  });
}

function createCategoryBoard(definition) {
  const catalog = catalogCategory(definition.id);
  return ensureBoardSchema({
    version: 1,
    title: definition.boardTitle,
    lanes: definition.lanes.map((lane, order) => ({ ...lane, order })),
    settings: {
      freeMove: false,
      showPrices: true,
      showSkus: true,
      fullSingleLaneSpecs: true,
      roadmap: {
        categoryLabel: definition.categoryLabel,
        familyOrder: [...definition.familyOrder],
      },
    },
    products: (catalog?.products || []).map((product, index) => productFromBlueprint(product, definition, index)),
  }, definition);
}

function createDefaultPortfolio() {
  const firstDefinition = CATEGORY_DEFINITIONS[0];
  if (!firstDefinition) {
    throw new Error("catalog-data.js did not provide any category definitions. Keep catalog-data.js beside index.html and load it before app.js.");
  }
  return {
    version: 4,
    activeCategoryId: firstDefinition.id,
    settings: {
      showRoadmapMsrp: false,
    },
    imageAssets: catalogImageAssets(),
    categories: CATEGORY_DEFINITIONS.map((definition) => ({
      id: definition.id,
      name: definition.name,
      board: createCategoryBoard(definition),
    })),
  };
}

function ensurePortfolioSchema(target) {
  if (!CATEGORY_DEFINITIONS.length) {
    throw new Error("Cannot load portfolio data because catalog-data.js has no categories or did not load before app.js.");
  }
  const normalized = target && Array.isArray(target.categories)
    ? target
    : createDefaultPortfolio();
  normalized.version = 4;
  normalized.settings = {
    showRoadmapMsrp: false,
    ...(normalized.settings || {}),
  };
  normalized.settings.showRoadmapMsrp = normalized.settings.showRoadmapMsrp === true;
  normalized.categories = Array.isArray(normalized.categories) ? normalized.categories.filter((category) => CATEGORY_DEFINITIONS.some((definition) => definition.id === category.id)) : [];
  ensureImageAssetRegistry(normalized);
  const catalogAssets = catalogImageAssets();
  const existingAssetIds = new Set(normalized.imageAssets.map((asset) => asset.id));
  catalogAssets.forEach((asset) => { if (!existingAssetIds.has(asset.id)) normalized.imageAssets.push(asset); });
  CATEGORY_DEFINITIONS.forEach((definition) => {
    let category = normalized.categories.find((item) => item.id === definition.id);
    if (!category) {
      category = { id: definition.id, name: definition.name, board: createCategoryBoard(definition) };
      normalized.categories.push(category);
    }
    category.name = String(category.name || definition.name).trim() || definition.name;
    category.board = ensureBoardSchema(category.board || createCategoryBoard(definition), definition);
  });
  const fallbackCategoryId = CATEGORY_DEFINITIONS[0]?.id;
  normalized.activeCategoryId = normalized.categories.some((item) => item.id === normalized.activeCategoryId)
    ? normalized.activeCategoryId
    : fallbackCategoryId;
  if (!normalized.activeCategoryId) throw new Error("The imported portfolio does not contain a usable category.");
  migrateLegacyProductImages(normalized);
  return normalized;
}

function loadPortfolio() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed?.version === 4) return ensurePortfolioSchema(parsed);
  } catch (_) {}
  try {
    const previous = JSON.parse(localStorage.getItem(PREVIOUS_STORAGE_KEY));
    if (previous?.version === 3 && Array.isArray(previous.categories)) return ensurePortfolioSchema(previous);
  } catch (_) {}
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacy?.version === 1 && Array.isArray(legacy.products) && Array.isArray(legacy.lanes)) {
      const migrated = createDefaultPortfolio();
      const audio = migrated.categories.find((item) => item.id === "pc-gaming-audio");
      audio.board = ensureBoardSchema(legacy, categoryDefinition("pc-gaming-audio"));
      migrateLegacyProductImages(migrated);
      return migrated;
    }
  } catch (_) {}
  return createDefaultPortfolio();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
      localStorage.removeItem(PREVIOUS_STORAGE_KEY);
    } catch (_) {}
  }, 120);
}

function activateCategory(categoryId, { render = true, fitVertical = true } = {}) {
  const category = portfolio?.categories?.find((item) => item.id === categoryId) || portfolio?.categories?.[0];
  if (!category) throw new Error("The portfolio contains no usable categories.");

  // Viewer details belong to the current category. Clear them before the
  // active board changes so a product from the previous category cannot leak
  // into the next category.
  closeViewerInfo({ render: false });
  viewerInfoProgress = 0;
  viewerInfoProductId = null;
  viewerInfoOpen = false;
  if (viewerInfoOutline) {
    viewerInfoOutline.classList.remove("is-open");
    viewerInfoOutline.style.width = "0px";
  }

  activeCategoryId = category.id;
  portfolio.activeCategoryId = category.id;
  board = ensureBoardSchema(category.board, categoryDefinition(category.id));
  category.board = board;
  selectedId = board.products[0]?.id ?? null;
  searchQuery = "";
  roadmapSearchQuery = "";
  $("#searchInput").value = "";
  $("#roadmapSearch").value = "";
  closeInspector();
  productLayoutEditing = false;
  updateProductLayoutEditControls();
  hoveredHeroVariant = null;
  closeVariantPopover({ force: true });
  stopRoadmapSlotEditing();
  initialVerticalFitPending = Boolean(fitVertical);
  scheduleSave();
  syncControls();
  renderInspector();
  if (render) renderActiveView();
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
    const variantTerms = productVariantGroups(product)
      .flatMap((group) => [group.label, ...group.items.flatMap((item) => [item.code, item.label, item.colorName, item.colorName2])]);
    const hpSkuTerms = productPartSkus(product).map((item) => item.code);
    const haystack = [
      product.name,
      product.codename,
      product.tier,
      product.statusLabel,
      product.variantLabel,
      ...hpSkuTerms,
      ...variantTerms,
      ...product.specs.flatMap((item) => [item.label, item.value]),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function normalizedSpecLabel(label) {
  return String(label || "").trim().toLowerCase();
}

function detailedValueLineCount(value, columnWidth = CARD_WIDTH - 54, maxLines = 3) {
  const text = String(value || "—").trim() || "—";
  const estimatedChars = Math.max(12, Math.floor(columnWidth / 6.3));
  return Math.max(1, Math.min(maxLines, Math.ceil(text.length / estimatedChars)));
}

function isDetailedMatrixSpec(item) {
  return /^(pop filter|shock mount|base stand|hot-swap switch|top plate|housing|keycap type|per-key lighting|mount style|switches|shell|skate)$/i.test(String(item?.label || "").trim());
}

function isDetailedPairCandidate(item) {
  const label = normalizedSpecLabel(item?.label);
  const value = String(item?.value || "").trim();
  if (!label || /connection|record quality|compatibility|features|attachment|battery|wireless|controls/.test(label)) return false;
  return label.length <= 22 && value.length <= 30;
}

function detailedSpecRows(specs) {
  const source = Array.isArray(specs) ? specs : [];
  const rows = [];
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    if (isDetailedMatrixSpec(current)) {
      const items = [];
      while (index < source.length && isDetailedMatrixSpec(source[index]) && items.length < 3) {
        items.push(source[index]);
        index += 1;
      }
      rows.push({ type: "matrix", items });
      continue;
    }
    const next = source[index + 1];
    if (next && isDetailedPairCandidate(current) && isDetailedPairCandidate(next)) {
      rows.push({ type: "pair", items: [current, next] });
      index += 2;
      continue;
    }
    rows.push({ type: "full", items: [current] });
    index += 1;
  }
  return rows;
}

function detailedSpecRowHeight(row) {
  if (row.type === "matrix") return 58;
  if (row.type === "pair") {
    const maxLines = Math.max(...row.items.map((item) => detailedValueLineCount(item.value, (CARD_WIDTH - 66) / 2, 3)));
    return 34 + Math.max(0, maxLines - 1) * 13;
  }
  const lines = detailedValueLineCount(row.items[0]?.value, CARD_WIDTH - 54, 3);
  return 34 + Math.max(0, lines - 1) * 13;
}

function detailedSpecsHeight(product) {
  return detailedSpecRows(product?.specs).reduce((sum, row) => sum + detailedSpecRowHeight(row), 0);
}

function productCardLayout() {
  const lanes = sortedLanes();
  const definition = categoryDefinition();
  const supportsDetailedCards = lanes.length === 1 || definition.fullSpecCards === true;
  const detailed = Boolean(board?.settings?.fullSingleLaneSpecs) && supportsDetailedCards;
  if (!detailed) {
    return {
      detailed: false,
      cardHeight: CARD_HEIGHT,
      laneHeight: LANE_HEIGHT,
      imageSlotTop: IMAGE_SLOT_TOP,
      imageSlotHeight: IMAGE_SLOT_HEIGHT,
      titleBlockTop: TITLE_BLOCK_TOP,
      priceBaselineOffset: PRICE_BASELINE_OFFSET,
      detailsTopOffset: DETAILS_TOP_OFFSET,
    };
  }

  const products = board.products.length ? board.products : visibleProducts();
  const maxDetailsHeight = Math.max(0, ...products.map((product) => detailedSpecsHeight(product)));
  const maxFooterHeight = board.settings.showSkus
    ? Math.max(0, ...products.map((product) => variantFooterLayout(product).height))
    : 0;
  const detailsTop = FULL_SPEC_TITLE_TOP + FULL_SPEC_DETAILS_TOP_OFFSET;
  const cardHeight = Math.max(FULL_SPEC_MIN_CARD_HEIGHT, detailsTop + 10 + maxDetailsHeight + maxFooterHeight + 10);
  return {
    detailed: true,
    cardHeight,
    laneHeight: cardHeight + 70,
    imageSlotTop: STATUS_BANNER_HEIGHT + 10,
    imageSlotHeight: FULL_SPEC_IMAGE_HEIGHT,
    titleBlockTop: FULL_SPEC_TITLE_TOP,
    priceBaselineOffset: PRICE_BASELINE_OFFSET,
    detailsTopOffset: FULL_SPEC_DETAILS_TOP_OFFSET,
  };
}

function viewerInfoVisualWidth() {
  return Math.round(CARD_WIDTH * Math.max(PRODUCT_MIN_ZOOM, zoom || 1));
}

function viewerInfoVisualHeight() {
  return Math.round(productCardLayout().cardHeight * Math.max(PRODUCT_MIN_ZOOM, zoom || 1));
}

function viewerInfoReserveLogical() {
  if (activeView !== "products" || !viewerInfoProductId || viewerInfoProgress <= 0) return 0;
  return CARD_WIDTH * viewerInfoProgress;
}

function viewerInfoGapIndex(laneProducts) {
  if (activeView !== "products" || !viewerInfoProductId || viewerInfoProgress <= 0) return -1;
  return laneProducts.findIndex((product) => product.id === viewerInfoProductId);
}

function cardXForDisplayIndex(laneProducts, displayIndex) {
  const gapIndex = viewerInfoGapIndex(laneProducts);
  const shift = gapIndex >= 0 && displayIndex > gapIndex ? viewerInfoReserveLogical() : 0;
  return GUTTER + displayIndex * (CARD_WIDTH + CARD_GAP) + shift;
}

function getCanvasDimensions() {
  const lanes = sortedLanes();
  const products = visibleProducts();
  const layout = productCardLayout();
  const maxCount = Math.max(1, ...lanes.map((lane) => products.filter((product) => product.laneId === lane.id).length));
  const editorRevealReserve = inspectorOpen && activeView === "products" && inspector?.offsetWidth
    ? Math.ceil((inspector.offsetWidth + 28) / Math.max(PRODUCT_MIN_ZOOM, zoom || 1))
    : 0;
  const contentWidth = GUTTER + maxCount * (CARD_WIDTH + CARD_GAP) + SIDE_PADDING + editorRevealReserve + viewerInfoReserveLogical();
  const viewportLogicalWidth = canvasScroll?.clientWidth
    ? Math.ceil(canvasScroll.clientWidth / Math.max(PRODUCT_MIN_ZOOM, zoom || 1))
    : 0;
  return {
    width: Math.max(1480, contentWidth, viewportLogicalWidth),
    height: LANE_TOP + lanes.length * layout.laneHeight + 20,
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

function drawSkuSwatch(context, x, y, width, height, primary, secondary = "") {
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.fillStyle = primary || "#777777";
  context.fillRect(x, y, width, height);
  if (secondary) {
    context.fillStyle = secondary;
    context.beginPath();
    context.moveTo(x + width, y);
    context.lineTo(x + width, y + height);
    context.lineTo(x, y + height);
    context.closePath();
    context.fill();
  }
  context.restore();
  context.strokeStyle = "#a7aaa7";
  context.lineWidth = .5;
  context.strokeRect(x, y, width, height);
}

function variantFooterLayout(product) {
  const allGroups = productVariantGroups(product).filter((group) => group.items.length);
  const groups = allGroups.slice(0, 2).map((group) => ({ ...group }));
  if (!groups.length) return { height: 0, groups: [], hiddenGroupCount: 0, hiddenGroups: [] };

  const totalRowBudget = groups.length === 1 ? (groups[0].type === "layout" ? 3 : 2) : 3;
  const rows = groups.map(() => 1);
  let remaining = totalRowBudget - rows.length;
  while (remaining > 0) {
    let bestIndex = 0;
    let bestNeed = -1;
    groups.forEach((group, index) => {
      const columns = group.type === "layout" ? 5 : 3;
      const need = Math.ceil(group.items.length / columns) - rows[index];
      if (need > bestNeed) {
        bestNeed = need;
        bestIndex = index;
      }
    });
    if (bestNeed <= 0) break;
    rows[bestIndex] += 1;
    remaining -= 1;
  }

  const laidOutGroups = groups.map((group, index) => {
    const columns = group.type === "layout" ? 5 : 3;
    const capacity = Math.max(1, rows[index] * columns);
    const visibleCapacity = group.items.length > capacity ? Math.max(0, capacity - 1) : capacity;
    const hiddenItems = group.items.slice(visibleCapacity);
    const displayItems = group.items.slice(0, visibleCapacity);
    if (hiddenItems.length) {
      displayItems.push({ id: `more-${group.id}`, code: `+${hiddenItems.length}`, isMore: true });
    }
    return { ...group, columns, rows: rows[index], displayItems, hiddenItems };
  });
  const contentHeight = laidOutGroups.reduce((sum, group) => sum + 14 + group.rows * 18, 0);
  const gaps = Math.max(0, laidOutGroups.length - 1) * 4;
  const hiddenGroups = allGroups.slice(groups.length).map((group) => ({ ...group, items: [...group.items] }));
  return {
    height: 10 + contentHeight + gaps + 8,
    groups: laidOutGroups,
    hiddenGroupCount: hiddenGroups.length,
    hiddenGroups,
  };
}

function registerVariantOverflowRegion(region) {
  renderedVariantOverflow.push({
    ...region,
    key: `${region.productId}:${region.groupId || "groups"}`,
  });
}

function registerHeroVariantRegion(region) {
  renderedHeroVariantRegions.push({
    ...region,
    key: `${region.productId}:${region.variantId}`,
  });
}

function drawVariantFooter(context, product, x, y, layout) {
  roundRect(context, x, y, CARD_WIDTH, layout.height, [0, 0, 4, 4], "#284f1d");
  const activeHeroVariantId = activeHeroVariant(product)?.id || "";
  let cursorY = y + 9;
  layout.groups.forEach((group, groupIndex) => {
    context.fillStyle = "#7eb45d";
    context.font = "700 9px Arial";
    context.textAlign = "left";
    context.fillText(group.label.toUpperCase(), x + 12, cursorY + 8);
    if (groupIndex === 0 && layout.hiddenGroupCount > 0) {
      const groupChipWidth = 50;
      const groupChipHeight = 14;
      const groupChipX = x + CARD_WIDTH - 12 - groupChipWidth;
      const groupChipY = cursorY - 3;
      roundRect(context, groupChipX, groupChipY, groupChipWidth, groupChipHeight, 7, "rgba(16,42,12,.78)", "rgba(183,215,164,.38)", .75);
      context.textAlign = "center";
      context.fillStyle = "#b9d6aa";
      context.font = "700 8px Arial";
      context.fillText(`+${layout.hiddenGroupCount} GROUP`, groupChipX + groupChipWidth / 2, groupChipY + 10);
      registerVariantOverflowRegion({
        productId: product.id,
        productName: product.name,
        groupId: "hidden-groups",
        groups: layout.hiddenGroups,
        x: groupChipX,
        y: groupChipY,
        width: groupChipWidth,
        height: groupChipHeight,
      });
    }
    cursorY += 14;

    group.displayItems.forEach((item, index) => {
      const column = index % group.columns;
      const row = Math.floor(index / group.columns);
      const cellWidth = (CARD_WIDTH - 24) / group.columns;
      const cellX = x + 12 + column * cellWidth;
      const cellY = cursorY + row * 18;
      context.textAlign = "left";
      if (item.isMore) {
        const chipWidth = Math.min(31, Math.max(24, cellWidth - 5));
        const chipHeight = 14;
        const chipX = cellX - 2;
        const chipY = cellY - 2;
        roundRect(context, chipX, chipY, chipWidth, chipHeight, 7, "rgba(17,47,13,.82)", "rgba(192,222,173,.45)", .75);
        context.fillStyle = "#c7dfb9";
        context.font = "800 9px Arial";
        context.textAlign = "center";
        context.fillText(item.code, chipX + chipWidth / 2, chipY + 10);
        registerVariantOverflowRegion({
          productId: product.id,
          productName: product.name,
          groupId: group.id,
          groupLabel: group.label,
          groupType: group.type,
          groups: [{ id: group.id, label: group.label, type: group.type, items: group.hiddenItems }],
          x: chipX,
          y: chipY,
          width: chipWidth,
          height: chipHeight,
        });
      } else if (group.type === "color") {
        const hasHeroImage = Boolean(item.imageAssetId);
        const isActiveHero = activeHeroVariantId === item.id;
        context.fillStyle = isActiveHero ? "#ffffff" : "#f0f0f0";
        context.font = `${isActiveHero ? "800" : "700"} 9.5px Arial`;
        drawSkuSwatch(context, cellX, cellY + 1, 10, 10, item.colorHex, item.colorHex2);
        if (hasHeroImage) {
          context.save();
          context.strokeStyle = isActiveHero ? "#ffffff" : "#a8c997";
          context.lineWidth = isActiveHero ? 1.5 : 1;
          context.strokeRect(cellX - 1, cellY, 12, 12);
          context.fillStyle = isActiveHero ? "#ffffff" : "#b9d6aa";
          context.beginPath();
          context.arc(cellX + 10, cellY + 1, 2.2, 0, Math.PI * 2);
          context.fill();
          context.restore();
          registerHeroVariantRegion({
            productId: product.id,
            variantId: item.id,
            x: cellX - 3,
            y: cellY - 3,
            width: Math.max(28, cellWidth - 2),
            height: 17,
          });
        }
        context.fillText(truncate(String(item.code || "SKU"), 9), cellX + 15, cellY + 10, Math.max(10, cellWidth - 17));
      } else {
        context.fillStyle = "#f0f0f0";
        context.font = "700 9.5px Arial";
        context.fillText(truncate(String(item.code || "SKU"), group.type === "layout" ? 7 : 9), cellX, cellY + 10, Math.max(10, cellWidth - 4));
      }
    });
    cursorY += group.rows * 18;
    if (groupIndex < layout.groups.length - 1) {
      context.strokeStyle = "rgba(130,180,93,.25)";
      context.beginPath();
      context.moveTo(x + 12, cursorY + 1);
      context.lineTo(x + CARD_WIDTH - 12, cursorY + 1);
      context.stroke();
      cursorY += 4;
    }
  });
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


function drawDetailedFamilyHeaders(context, laneProducts, laneY) {
  if (!laneProducts.length) return;
  const runs = [];
  laneProducts.forEach((product, index) => {
    const family = String(product.roadmap?.family || inferFamily(product.name) || "Other").trim() || "Other";
    const previous = runs[runs.length - 1];
    if (previous?.family === family) previous.endIndex = index;
    else runs.push({ family, startIndex: index, endIndex: index });
  });

  runs.forEach((run) => {
    const startX = cardXForDisplayIndex(laneProducts, run.startIndex);
    const endX = cardXForDisplayIndex(laneProducts, run.endIndex) + CARD_WIDTH;
    const centerX = startX + (endX - startX) / 2;
    context.fillStyle = "rgba(224,228,224,.18)";
    context.font = "700 10px Arial";
    context.textAlign = "center";
    context.fillText(run.family.toUpperCase(), centerX, laneY - 13, Math.max(20, endX - startX - 8));
    context.strokeStyle = "rgba(224,228,224,.08)";
    context.beginPath();
    context.moveTo(startX, laneY - 8);
    context.lineTo(endX, laneY - 8);
    context.stroke();
  });
}

function drawProductBoardExportBackground(context, dimensions) {
  context.fillStyle = "#141614";
  context.fillRect(0, 0, dimensions.width, dimensions.height);
}

function drawBoardTo(context, dimensions, includeSelection = true, includeBackground = false) {
  context.clearRect(0, 0, dimensions.width, dimensions.height);
  if (includeBackground) drawProductBoardExportBackground(context, dimensions);

  const lanes = sortedLanes();
  const products = visibleProducts();
  const layout = productCardLayout();
  renderedCards = [];
  renderedSpecOverflow = [];
  renderedVariantOverflow = [];
  renderedHeroVariantRegions = [];
  renderedInfoButtons = [];

  lanes.forEach((lane, laneIndex) => {
    const laneY = LANE_TOP + laneIndex * layout.laneHeight;
    roundRect(context, 0, laneY - 4, dimensions.width, layout.cardHeight + 8, 0, "#171917");
    const laneProducts = products
      .filter((product) => product.laneId === lane.id)
      .sort((a, b) => a.order - b.order);
    if (layout.detailed) drawDetailedFamilyHeaders(context, laneProducts, laneY);

    laneProducts
      .forEach((product, displayIndex) => {
        const automatic = { x: cardXForDisplayIndex(laneProducts, displayIndex), y: laneY };
        let position = automatic;
        if (dragState?.productId === product.id) position = dragState.position;
        renderedCards.push({ productId: product.id, laneId: lane.id, x: position.x, y: position.y, width: CARD_WIDTH, height: layout.cardHeight });
        drawCard(context, product, position.x, position.y, includeSelection && product.id === selectedId, layout);
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

function productPresentation(product) {
  const status = standardizedStatus(product.statusType);
  const hasVariant = Boolean(String(product.variantLabel || "").trim());
  return {
    status,
    hasStatus: Boolean(status.label),
    variantLabel: String(product.variantLabel || "").trim(),
    variantColor: String(product.variantColor || "#3f6f91"),
    primaryLabel: hasVariant ? String(product.variantLabel || "").trim() : status.label,
    primaryColor: hasVariant ? String(product.variantColor || "#3f6f91") : status.color,
    outlineColor: product.statusType === "embargo" ? STANDARD_CARD_STATUSES.embargo.color
      : product.statusType === "new" ? STANDARD_CARD_STATUSES.new.color
      : hasVariant ? String(product.variantColor || "#3f6f91")
      : "#383b38",
  };
}

function productPriceText(product) {
  if (product.price != null && product.price !== "") return `$${Number(product.price).toFixed(2)}`;
  return String(product.priceLabel || "Price TBD");
}

function detailedValueColor(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (/^(yes|internal|external|removable|integrated|optical|magnetic|modular)$/.test(normalized)) return "#00a8d6";
  if (/^(no|none|—|-)$/.test(normalized)) return "#676c67";
  return "#d4d7d4";
}

function drawDetailedSpecLabel(context, label, x, y, maxWidth) {
  context.fillStyle = "#747974";
  context.font = "700 8px Arial";
  context.textAlign = "left";
  context.fillText(String(label || "Specification").toUpperCase(), x, y, maxWidth);
}

function drawDetailedSpecs(context, product, x, startY) {
  const rows = detailedSpecRows(product.specs);
  let cursorY = startY;

  rows.forEach((row) => {
    const height = detailedSpecRowHeight(row);
    context.strokeStyle = "#303330";
    context.beginPath();
    context.moveTo(x + 10, cursorY + height - 1);
    context.lineTo(x + CARD_WIDTH - 10, cursorY + height - 1);
    context.stroke();

    if (row.type === "matrix") {
      drawSpecIcon(context, row.items[0]?.label, x + 20, cursorY + 17);
      const contentX = x + 38;
      const contentWidth = CARD_WIDTH - 50;
      const columnWidth = contentWidth / Math.max(1, row.items.length);
      row.items.forEach((item, index) => {
        const itemX = contentX + index * columnWidth;
        drawDetailedSpecLabel(context, item.label, itemX, cursorY + 13, columnWidth - 5);
        context.fillStyle = detailedValueColor(item.value);
        context.font = "700 9.5px Arial";
        context.textAlign = "left";
        wrapText(context, String(item.value || "—"), itemX, cursorY + 31, columnWidth - 5, 11, 2, "left");
      });
    } else if (row.type === "pair") {
      const leftWidth = (CARD_WIDTH - 58) / 2;
      drawSpecIcon(context, row.items[0]?.label, x + 20, cursorY + 18);
      row.items.forEach((item, index) => {
        const itemX = x + 38 + index * (leftWidth + 8);
        drawDetailedSpecLabel(context, item.label, itemX, cursorY + 12, leftWidth);
        context.fillStyle = detailedValueColor(item.value);
        context.font = "11px Arial";
        context.textAlign = "left";
        wrapText(context, String(item.value || "—"), itemX, cursorY + 29, leftWidth, 13, 3, "left");
      });
    } else {
      const item = row.items[0];
      drawSpecIcon(context, item?.label, x + 20, cursorY + 17);
      drawDetailedSpecLabel(context, item?.label, x + 38, cursorY + 12, CARD_WIDTH - 50);
      context.fillStyle = detailedValueColor(item?.value);
      context.font = "11px Arial";
      context.textAlign = "left";
      wrapText(context, String(item?.value || "—"), x + 38, cursorY + 29, CARD_WIDTH - 50, 13, 3, "left");
    }

    cursorY += height;
  });

  return cursorY;
}

function drawProductInfoButton(context, product, x, y, layout) {
  const buttonX = x + CARD_WIDTH - INFO_BUTTON_WIDTH - 8;
  const buttonY = y + STATUS_BANNER_HEIGHT + 7;
  const isOpen = viewerInfoProductId === product.id && viewerInfoProgress > .01;
  const isHovered = hoveredInfoButtonProductId === product.id;

  context.save();
  context.shadowColor = isHovered || isOpen ? "rgba(0,0,0,.42)" : "transparent";
  context.shadowBlur = isHovered || isOpen ? 6 : 0;
  roundRect(
    context,
    buttonX,
    buttonY,
    INFO_BUTTON_WIDTH,
    INFO_BUTTON_HEIGHT,
    11,
    isOpen ? "#f4f6f4" : isHovered ? "#343934" : "rgba(17,19,17,.78)",
    isOpen ? "#ffffff" : isHovered ? "#697269" : "#4a504a",
    1,
  );
  context.restore();

  context.fillStyle = isOpen ? "#171917" : "#d9ddd9";
  context.font = "800 13px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("i", buttonX + INFO_BUTTON_WIDTH / 2, buttonY + INFO_BUTTON_HEIGHT / 2 + .5);

  renderedInfoButtons.push({
    productId: product.id,
    x: buttonX,
    y: buttonY,
    width: INFO_BUTTON_WIDTH,
    height: INFO_BUTTON_HEIGHT,
  });
}

function drawCard(context, product, x, y, selected, layout = productCardLayout()) {
  const presentation = productPresentation(product);
  const cardHeight = layout.cardHeight;
  context.save();
  context.shadowColor = "rgba(0,0,0,.45)";
  context.shadowBlur = 8;
  context.shadowOffsetY = 3;
  roundRect(context, x, y, CARD_WIDTH, cardHeight, 4, "#232523", presentation.outlineColor, presentation.primaryLabel ? 2 : 1);
  context.restore();

  if (presentation.primaryLabel) {
    roundRect(context, x, y, CARD_WIDTH, STATUS_BANNER_HEIGHT, [4, 4, 0, 0], presentation.primaryColor);
    context.fillStyle = "#ffffff";
    context.font = "700 10px Arial";
    context.textAlign = "center";
    context.fillText(presentation.primaryLabel.toUpperCase(), x + CARD_WIDTH / 2, y + 16);
  }
  if (presentation.hasStatus && presentation.hasVariant) {
    const label = presentation.status.label;
    context.font = "700 8px Arial";
    const badgeWidth = Math.min(CARD_WIDTH - 24, Math.max(74, context.measureText(label).width + 18));
    roundRect(context, x + (CARD_WIDTH - badgeWidth) / 2, y + STATUS_BANNER_HEIGHT + 5, badgeWidth, 18, 9, presentation.status.color);
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.fillText(label, x + CARD_WIDTH / 2, y + STATUS_BANNER_HEIGHT + 17);
  }

  const imageTop = y + layout.imageSlotTop;
  const imageRecord = loadImage(productImageSource(product));
  if (imageRecord.ready) drawContainedImage(context, imageRecord.image, x + 18, imageTop, CARD_WIDTH - 36, layout.imageSlotHeight);

  const titleTop = y + layout.titleBlockTop;
  context.fillStyle = "#f2f2f2";
  context.font = "700 16px Arial";
  context.textAlign = "center";
  wrapText(context, product.name, x + CARD_WIDTH / 2, titleTop + 15, CARD_WIDTH - 24, 18, 2, "center");

  if (board.settings.showPrices) {
    context.fillStyle = "#777b77";
    context.font = "16px Arial";
    context.fillText(productPriceText(product), x + CARD_WIDTH / 2, titleTop + layout.priceBaselineOffset);
  }

  const detailsTop = titleTop + layout.detailsTopOffset;
  context.strokeStyle = "#383b38";
  context.lineWidth = 1;
  context.beginPath(); context.moveTo(x, detailsTop); context.lineTo(x + CARD_WIDTH, detailsTop); context.stroke();

  const footerLayout = board.settings.showSkus ? variantFooterLayout(product) : { height: 0, groups: [] };
  const footerHeight = footerLayout.height;
  const detailsBottom = y + cardHeight - footerHeight;

  if (layout.detailed) {
    drawDetailedSpecs(context, product, x, detailsTop + 5);
  } else {
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
  }

  if (footerHeight) {
    const footerY = y + cardHeight - footerHeight;
    drawVariantFooter(context, product, x, footerY, footerLayout);
  }

  // Status/variant outlines are always the final product-owned layer so SKU
  // footer fills can never cover the New Product or Embargo border.
  roundRect(
    context,
    x + 0.75,
    y + 0.75,
    CARD_WIDTH - 1.5,
    cardHeight - 1.5,
    4,
    null,
    presentation.outlineColor,
    presentation.primaryLabel ? 2 : 1,
  );

  // Selection remains the top-most interaction layer above status banners,
  // custom variant banners, and every SKU footer.
  const selectedAsExpandedGroup = selected
    && viewerInfoProductId === product.id
    && viewerInfoProgress > .001;

  if (selected && !selectedAsExpandedGroup) {
    context.save();
    context.shadowColor = "rgba(255,255,255,.32)";
    context.shadowBlur = 8;
    roundRect(context, x + 1.5, y + 1.5, CARD_WIDTH - 3, cardHeight - 3, 4, null, "#f4f6f4", 3);
    context.restore();
  }

  // Keep the explicit viewer control above the selected-card outline.
  drawProductInfoButton(context, product, x, y, layout);
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
    const variantTerms = productVariantGroups(product)
      .flatMap((group) => [group.label, ...group.items.flatMap((item) => [item.code, item.label, item.colorName, item.colorName2])]);
    const hpSkuTerms = productPartSkus(product).map((item) => item.code);
    const haystack = [
      product.name,
      product.codename,
      product.tier,
      roadmap.family,
      roadmap.status,
      roadmap.confidence,
      product.statusLabel,
      product.variantLabel,
      ...hpSkuTerms,
      ...variantTerms,
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function roadmapFamilyOrder(family) {
  const order = board.settings.roadmap.familyOrder || categoryDefinition().familyOrder;
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
  const bodyHeight = Math.max(ROADMAP_MIN_BODY_HEIGHT, rowsHeight + ROADMAP_BOTTOM_PADDING);
  return {
    width: ROADMAP_LEFT_WIDTH + range.count * roadmapMonthWidth + 24,
    height: ROADMAP_HEADER_HEIGHT + bodyHeight,
    range,
    groups,
  };
}

function roadmapStatusColor(product) {
  const status = normalizeRoadmapStatus(product.roadmap?.status);
  if (status === "embargo") return "#b83458";
  if (status === "end-of-life") return "#694049";
  return board.settings.roadmap.statusColors?.[status] || "#666c66";
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

function roadmapSpanLabel(count) {
  if (count % 12 === 0) {
    const years = count / 12;
    return `${years} YEAR${years === 1 ? "" : "S"} VIEW`;
  }
  return `${count} MONTH VIEW`;
}

function roadmapLabelLines(context, text, maxLineWidth, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || context.measureText(candidate).width <= maxLineWidth) {
      current = candidate;
      return;
    }
    lines.push(current);
    current = word;
  });
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const retained = lines.slice(0, maxLines);
  retained[maxLines - 1] = lines.slice(maxLines - 1).join(" ");
  return retained;
}

function drawFixedVerticalRoadmapLabel(context, label, x, top, availableHeight) {
  const text = String(label || "").trim().toUpperCase();
  const innerHeight = Math.max(0, availableHeight - 24);
  if (!text || innerHeight < 48) return;

  context.save();
  context.font = `700 ${ROADMAP_CATEGORY_LABEL_FONT_SIZE}px Arial`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  // Keep the category rail typography stable when filtering reduces the
  // roadmap to one family or one product. Long category names wrap instead
  // of shrinking to a different visual scale.
  const lines = roadmapLabelLines(context, text, innerHeight, 3);
  const lineHeight = ROADMAP_CATEGORY_LABEL_FONT_SIZE + 1;
  context.translate(x, top + availableHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillStyle = "#f0f2f0";
  lines.forEach((line, index) => {
    const offset = (index - (lines.length - 1) / 2) * lineHeight;
    context.fillText(line, 0, offset);
  });
  context.restore();
}

function selectedRoadmapGuides(range) {
  const product = selectedProduct();
  if (!product || !visibleRoadmapProducts().some((item) => item.id === product.id)) return null;
  const roadmap = effectiveRoadmap(product);
  const start = monthIndex(roadmap.startMonth);
  const launch = monthIndex(roadmap.launchMonth);
  const end = monthIndex(roadmap.endMonth);
  return {
    product,
    roadmap,
    start,
    launch,
    end,
    startVisible: start != null && start >= range.start && start <= range.end,
    launchVisible: launch != null && launch >= range.start && launch <= range.end,
    endVisible: end != null && end >= range.start && end <= range.end,
  };
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

function roadmapProductBarLabel(product) {
  const name = String(product?.name || "Product").toUpperCase();
  if (!portfolio?.settings?.showRoadmapMsrp) return name;
  return `${name}  ·  ${productPriceText(product)}`;
}

function drawRoadmapTo(context, dimensions, targetCanvas, targetScroll, includeSelection = true, exportMode = false) {
  const { width, height, range, groups } = dimensions;
  const stickyX = exportMode ? 0 : targetScroll.scrollLeft;
  const stickyY = exportMode ? 0 : targetScroll.scrollTop;
  const regions = [];

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#151715";
  context.fillRect(0, 0, width, height);

  const timelineX = ROADMAP_LEFT_WIDTH;
  const timelineWidth = range.count * roadmapMonthWidth;
  const selectedGuides = includeSelection ? selectedRoadmapGuides(range) : null;

  const drawYearSeamSegment = (yStart, yEnd, opacity = .42) => {
    for (let month = 0; month <= range.count; month += 1) {
      const absolute = range.start + month;
      if (absolute % 12 !== 0) continue;
      const x = Math.round(timelineX + month * roadmapMonthWidth) + .5;
      context.save();
      context.strokeStyle = `rgba(116,126,116,${opacity})`;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, yStart);
      context.lineTo(x, yEnd);
      context.stroke();
      context.restore();
    }
  };

  // Timeline grid and row content.
  context.save();
  context.beginPath();
  context.rect(timelineX, ROADMAP_HEADER_HEIGHT, timelineWidth, height - ROADMAP_HEADER_HEIGHT);
  context.clip();

  // Subtle alternating year bands preserve long-range orientation without
  // relying on a dense month grid. Year boundaries remain intentionally strong.
  let bodyYearCursor = range.start;
  while (bodyYearCursor <= range.end) {
    const year = Math.floor(bodyYearCursor / 12);
    const yearEnd = Math.min(range.end, year * 12 + 11);
    const startOffset = bodyYearCursor - range.start;
    const monthCount = yearEnd - bodyYearCursor + 1;
    const x = timelineX + startOffset * roadmapMonthWidth;
    const w = monthCount * roadmapMonthWidth;
    context.fillStyle = year % 2 === 0 ? "rgba(255,255,255,.012)" : "rgba(0,0,0,.055)";
    context.fillRect(x, ROADMAP_HEADER_HEIGHT, w, height - ROADMAP_HEADER_HEIGHT);
    bodyYearCursor = yearEnd + 1;
  }

  for (let month = 0; month <= range.count; month += 1) {
    const absolute = range.start + month;
    const isYear = absolute % 12 === 0;
    if (isYear) continue;
    const x = timelineX + month * roadmapMonthWidth;
    const isQuarter = absolute % 3 === 0;
    context.strokeStyle = isQuarter
      ? "rgba(105,114,105,.16)"
      : "rgba(96,104,96,.07)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, ROADMAP_HEADER_HEIGHT);
    context.lineTo(x, height);
    context.stroke();
  }

  // Calendar-year seams are drawn later on top of the roadmap body so they
  // remain visually continuous rather than getting interrupted by row fills.

  let rowY = ROADMAP_HEADER_HEIGHT;
  groups.forEach((group, groupIndex) => {
    context.fillStyle = groupIndex % 2 ? "#191c19" : "#1b1e1b";
    context.fillRect(timelineX, rowY, timelineWidth, ROADMAP_GROUP_HEADER_HEIGHT);
    drawYearSeamSegment(rowY, rowY + ROADMAP_GROUP_HEADER_HEIGHT, .32);
    rowY += ROADMAP_GROUP_HEADER_HEIGHT;

    group.products.forEach((product, productIndex) => {
      const roadmap = effectiveRoadmap(product);
      const rowTop = rowY;
      context.fillStyle = productIndex % 2 ? "rgba(255,255,255,.012)" : "rgba(0,0,0,.08)";
      context.fillRect(timelineX, rowTop, timelineWidth, ROADMAP_ROW_HEIGHT);
      context.strokeStyle = "rgba(104,112,104,.18)";
      context.beginPath();
      context.moveTo(timelineX, rowTop + ROADMAP_ROW_HEIGHT);
      context.lineTo(timelineX + timelineWidth, rowTop + ROADMAP_ROW_HEIGHT);
      context.stroke();
      // Draw the year seam after the row surface but before the product bar.
      // This keeps the seam continuous through empty space while bars naturally
      // occlude it instead of having the line painted over product content.
      drawYearSeamSegment(rowTop, rowTop + ROADMAP_ROW_HEIGHT, .36);

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
        roundRect(context, barX, barY, barWidth, barHeight, 3, color, product.statusType === "embargo" ? "#df456d" : "#666b66", 1);
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
        context.font = portfolio?.settings?.showRoadmapMsrp ? "700 11px Arial" : "700 12px Arial";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(roadmapProductBarLabel(product), barX + barWidth / 2, barY + barHeight / 2 + .5);
        context.restore();

        // Draw selection after the stage fill so it always
        // remains visible above every roadmap color treatment.
        if (selected) {
          context.save();
          context.shadowColor = "rgba(255,255,255,.28)";
          context.shadowBlur = 9;
          roundRect(context, barX + 1, barY + 1, Math.max(2, barWidth - 2), barHeight - 2, 3, null, "#f4f6f4", 2.5);
          context.restore();
        }

        const handleWidth = Math.min(14, Math.max(7, barWidth / 4));
        const moveHandleWidth = Math.min(38, Math.max(18, barWidth - handleWidth * 2 - 4));
        const moveHandleX = barX + (barWidth - moveHandleWidth) / 2;
        const editingThisSlot = includeSelection && roadmapSlotEditingActive(product.id);

        if (editingThisSlot && barWidth > 28) {
          context.save();
          context.fillStyle = "rgba(244,247,244,.94)";
          roundRect(context, barX + 3, barY + 5, Math.max(5, handleWidth - 5), barHeight - 10, 2, "rgba(244,247,244,.92)");
          roundRect(context, barX + barWidth - handleWidth + 2, barY + 5, Math.max(5, handleWidth - 5), barHeight - 10, 2, "rgba(244,247,244,.92)");
          roundRect(context, moveHandleX, barY + 5, moveHandleWidth, barHeight - 10, 4, "rgba(18,21,18,.82)", "rgba(255,255,255,.68)", 1);
          context.fillStyle = "rgba(255,255,255,.82)";
          for (let dot = -1; dot <= 1; dot += 1) {
            context.beginPath();
            context.arc(barX + barWidth / 2 + dot * 6, barY + barHeight / 2, 1.4, 0, Math.PI * 2);
            context.fill();
          }
          context.restore();
        }

        regions.push({
          productId: product.id,
          x: barX,
          y: barY,
          width: barWidth,
          height: barHeight,
          leftHandle: { x: barX, width: handleWidth },
          rightHandle: { x: barX + barWidth - handleWidth, width: handleWidth },
          moveHandle: { x: moveHandleX, width: moveHandleWidth },
        });
      }
      rowY += ROADMAP_ROW_HEIGHT;
    });
  });
  context.restore();

  // The selected product is represented by its outlined bar and a compact
  // range treatment in the sticky month header. Full-height start/launch
  // lines are intentionally avoided because they compete with the timeline grid.

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

  const roadmapBodyHeight = Math.max(0, height - ROADMAP_HEADER_HEIGHT);
  drawFixedVerticalRoadmapLabel(
    context,
    board.settings.roadmap.categoryLabel || "PC Audio",
    stickyX + 31,
    ROADMAP_HEADER_HEIGHT,
    roadmapBodyHeight,
  );

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

  // Year blocks use a continuous surface with alternating neutral tones.
  // Separation is provided by one subtle solid seam, not a box around each year.
  let cursor = range.start;
  let yearBlockIndex = 0;
  while (cursor <= range.end) {
    const year = Math.floor(cursor / 12);
    const yearEnd = Math.min(range.end, year * 12 + 11);
    const startOffset = cursor - range.start;
    const monthCount = yearEnd - cursor + 1;
    const x = timelineX + startOffset * roadmapMonthWidth;
    const w = monthCount * roadmapMonthWidth;
    context.fillStyle = year % 2 === 0 ? "#1b1e1b" : "#191c19";
    context.fillRect(x, stickyY, w, 34);
    // Year seams are rendered once, later, as a single continuous line.
    context.fillStyle = "#f0f2f0";
    context.font = "700 22px Arial";
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillText(String(year), x + 10, stickyY + 25);
    cursor = yearEnd + 1;
    yearBlockIndex += 1;
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
    context.fillStyle = "#cf3d63";
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

  // Month row. Long-range overview modes reduce label density automatically.
  const fullMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const shortMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (let i = 0; i < range.count; i += 1) {
    const absolute = range.start + i;
    const year = Math.floor(absolute / 12);
    const month = absolute % 12;
    const x = timelineX + i * roadmapMonthWidth;
    // Alternate full calendar years. January receives a quiet theme tint rather
    // than a border, keeping the year transition visible without looking selected.
    context.fillStyle = year % 2 === 0 ? "#0d100d" : "#131613";
    context.fillRect(x, stickyY + 78, roadmapMonthWidth, 34);
    if (month === 0) {
      context.fillStyle = "rgba(126,177,91,.055)";
      context.fillRect(x, stickyY + 78, roadmapMonthWidth, 34);
    }
    if (month !== 0) {
      context.fillStyle = "rgba(86,94,86,.14)";
      context.fillRect(Math.round(x), stickyY + 78, 1, 34);
    }
    const monthText = roadmapMonthWidth >= 58 ? fullMonthNames[month] : roadmapMonthWidth >= 28 ? shortMonthNames[month] : "";
    if (monthText) {
      context.fillStyle = month === 0 ? "#a6afa3" : year % 2 === 0 ? "#9aa09a" : "#858b85";
      context.font = roadmapMonthWidth >= 58 ? "11px Arial" : "10px Arial";
      context.textAlign = "left";
      context.fillText(monthText, x + Math.min(7, Math.max(3, roadmapMonthWidth * .12)), stickyY + 100);
    }
  }

  // Keep year boundaries visible in the sticky calendar header. The timeline
  // body draws them beneath product bars, so only the header seam remains on top.
  drawYearSeamSegment(stickyY, stickyY + ROADMAP_HEADER_HEIGHT, .42);

  // One compact header treatment communicates the selected lifecycle range.
  // The launch month is a single accent cell, not another line
  // through every roadmap row.
  if (selectedGuides && selectedGuides.start != null && selectedGuides.end != null) {
    const visibleStart = Math.max(range.start, selectedGuides.start);
    const visibleEnd = Math.min(range.end, selectedGuides.end);
    if (visibleEnd >= visibleStart) {
      const rangeX = timelineX + (visibleStart - range.start) * roadmapMonthWidth + 1;
      const rangeWidth = (visibleEnd - visibleStart + 1) * roadmapMonthWidth - 2;
      context.save();
      context.fillStyle = "rgba(126,177,91,.08)";
      context.fillRect(rangeX, stickyY + 79, rangeWidth, 32);
      context.strokeStyle = "rgba(155,200,125,.94)";
      context.lineWidth = 2;
      context.strokeRect(rangeX, stickyY + 79, rangeWidth, 32);
      context.restore();
    }
    if (selectedGuides.launchVisible) {
      const launchCellX = timelineX + (selectedGuides.launch - range.start) * roadmapMonthWidth + 1;
      const launchColor = selectedGuides.product.statusType === "embargo" || selectedGuides.roadmap.status === "embargo" ? "#ff5a83" : "#cf3d63";
      context.save();
      context.fillStyle = "rgba(207,61,99,.13)";
      context.fillRect(launchCellX, stickyY + 79, roadmapMonthWidth - 2, 32);
      context.strokeStyle = launchColor;
      context.lineWidth = 2;
      context.strokeRect(launchCellX, stickyY + 79, roadmapMonthWidth - 2, 32);
      context.restore();
    }
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
  context.fillText(roadmapSpanLabel(range.count), stickyX + 14, stickyY + 47);
  context.fillStyle = "#8d938d";
  context.font = "10px Arial";
  if (selectedGuides) {
    context.fillStyle = "#b9dba7";
    context.fillText(truncate(`Launch · ${roadmapLabel(selectedGuides.roadmap.startMonth)}`, 30), stickyX + 14, stickyY + 72);
    context.fillStyle = "#a8ada8";
    context.fillText(truncate(`Lifecycle end · ${roadmapLabel(selectedGuides.roadmap.endMonth)}`, 30), stickyX + 14, stickyY + 93);
  } else {
    context.fillText("Launch month starts each roadmap bar", stickyX + 14, stickyY + 72);
    if (roadmapEditProductId) context.fillText("Editing selected slot", stickyX + 14, stickyY + 93);
  }

  roadmapHitRegions.set(targetCanvas, regions);
}

function renderRoadmapFor(targetCanvas, targetScroll, navigator) {
  if (!targetCanvas || !targetScroll || targetCanvas.closest(".hidden")) return;
  const previousLeft = targetScroll.scrollLeft;
  const previousTop = roadmapFilterScrollResetPending ? 0 : targetScroll.scrollTop;
  const dimensions = roadmapDimensions();
  const context = setupRoadmapCanvas(targetCanvas, dimensions);
  targetScroll.scrollLeft = previousLeft;
  targetScroll.scrollTop = previousTop;
  drawRoadmapTo(context, dimensions, targetCanvas, targetScroll, true, false);
  requestAnimationFrame(() => syncRoadmapNavigator(targetScroll, navigator));
}

function renderRoadmaps() {
  updateRoadmapEditControls();
  if (activeView === "roadmap") renderRoadmapFor(roadmapCanvas, roadmapScroll, roadmapNavigatorRefs());
  if (activeView === "split") {
    renderSplitProduct();
    renderRoadmapFor(splitRoadmapCanvas, splitRoadmapScroll, splitRoadmapNavigatorRefs());
  }
  roadmapFilterScrollResetPending = false;
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

function setRoadmapYearSpan(years) {
  const startIndex = monthIndex(board.settings.roadmap.startMonth) ?? monthIndex(monthStringFromDate());
  const startYear = Math.floor(startIndex / 12);
  updateBoard((current) => {
    current.settings.roadmap.startMonth = `${startYear}-01`;
    current.settings.roadmap.endMonth = `${startYear + years - 1}-12`;
  });
  requestAnimationFrame(() => {
    fitRoadmapTimeline();
    const targetScroll = activeView === "split" ? splitRoadmapScroll : roadmapScroll;
    targetScroll.scrollTo({ left: 0, behavior: "smooth" });
  });
}

function fitProductLanesVertically() {
  const dimensions = getCanvasDimensions();
  const available = Math.max(240, productView.clientHeight - 48);
  const fittedZoom = Math.floor((available / dimensions.height) * 100) / 100;
  zoom = Math.max(PRODUCT_MIN_ZOOM, Math.min(1, fittedZoom));
  renderBoard();
  requestAnimationFrame(() => {
    canvasScroll.scrollTop = 0;
    syncLaneRail();
    syncBoardNavigator();
  });
}

function fitProductBoard() {
  const dimensions = getCanvasDimensions();
  const available = Math.max(280, canvasScroll.clientWidth - 18);
  const fittedZoom = Math.floor((available / dimensions.width) * 100) / 100;
  zoom = Math.max(PRODUCT_MIN_ZOOM, Math.min(1, fittedZoom));
  renderBoard();
  requestAnimationFrame(() => {
    canvasScroll.scrollTo({ left: 0, behavior: "smooth" });
    syncBoardNavigator();
  });
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
  function beginRoadmapPan(event, hit = null) {
    roadmapPanState = {
      targetCanvas,
      targetScroll,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: targetScroll.scrollLeft,
      hitProductId: hit?.productId || null,
      moved: false,
    };
    targetCanvas.setPointerCapture(event.pointerId);
    targetScroll.classList.add("is-panning");
    targetCanvas.style.cursor = "grabbing";
  }

  targetCanvas.addEventListener("pointerdown", (event) => {
    closeSpecPopover();
    const point = roadmapPoint(event, targetCanvas);
    const hit = hitRoadmapBar(targetCanvas, point);
    if (!hit) {
      beginRoadmapPan(event);
      return;
    }

    if (selectedId !== hit.productId) {
      selectedId = hit.productId;
      stopRoadmapSlotEditing();
    } else {
      selectedId = hit.productId;
    }
    renderInspector();
    renderSplitProduct();
    updateRoadmapEditControls();

    const canEdit = roadmapSlotEditingActive(hit.productId);
    if (!canEdit) {
      beginRoadmapPan(event, hit);
      renderRoadmaps();
      return;
    }

    const withinLeft = point.x >= hit.leftHandle.x && point.x <= hit.leftHandle.x + hit.leftHandle.width;
    const withinRight = point.x >= hit.rightHandle.x && point.x <= hit.rightHandle.x + hit.rightHandle.width;
    const withinMove = point.x >= hit.moveHandle.x && point.x <= hit.moveHandle.x + hit.moveHandle.width;
    const mode = withinLeft ? "start" : withinRight ? "end" : withinMove ? "move" : null;

    // Even while editing, the bar body remains safe for selection and canvas panning.
    // Only the visible grip and edge handles can alter roadmap dates.
    if (!mode) {
      beginRoadmapPan(event, hit);
      renderRoadmaps();
      return;
    }

    const product = selectedProduct();
    const roadmap = product.roadmap;
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
      moved: false,
    };
    roadmapDraft = { productId: product.id, roadmap: { ...roadmap } };
    targetCanvas.setPointerCapture(event.pointerId);
    targetCanvas.style.cursor = mode === "move" ? "grabbing" : "ew-resize";
    renderRoadmaps();
  });

  targetCanvas.addEventListener("pointermove", (event) => {
    if (roadmapPanState?.targetCanvas === targetCanvas) {
      const deltaX = event.clientX - roadmapPanState.startX;
      const deltaY = event.clientY - roadmapPanState.startY;
      if (!roadmapPanState.moved && Math.hypot(deltaX, deltaY) >= 5) roadmapPanState.moved = true;
      targetScroll.scrollLeft = roadmapPanState.scrollLeft - deltaX;
      return;
    }

    if (roadmapDragState?.targetCanvas !== targetCanvas) {
      const point = roadmapPoint(event, targetCanvas);
      const hit = hitRoadmapBar(targetCanvas, point);
      if (!hit) {
        targetCanvas.style.cursor = "grab";
        return;
      }
      if (!roadmapSlotEditingActive(hit.productId)) {
        targetCanvas.style.cursor = "grab";
        return;
      }
      const withinLeft = point.x >= hit.leftHandle.x && point.x <= hit.leftHandle.x + hit.leftHandle.width;
      const withinRight = point.x >= hit.rightHandle.x && point.x <= hit.rightHandle.x + hit.rightHandle.width;
      const withinMove = point.x >= hit.moveHandle.x && point.x <= hit.moveHandle.x + hit.moveHandle.width;
      targetCanvas.style.cursor = withinLeft || withinRight ? "ew-resize" : withinMove ? "grab" : "grab";
      return;
    }

    const pixelDelta = event.clientX - roadmapDragState.startClientX;
    if (!roadmapDragState.moved && Math.abs(pixelDelta) < 6) return;
    roadmapDragState.moved = true;

    const viewport = targetScroll.getBoundingClientRect();
    const edge = 72;
    if (event.clientX < viewport.left + edge) targetScroll.scrollLeft -= Math.ceil((viewport.left + edge - event.clientX) / 5);
    if (event.clientX > viewport.right - edge) targetScroll.scrollLeft += Math.ceil((event.clientX - (viewport.right - edge)) / 5);

    const increment = roadmapSnapIncrement();
    const rawDelta = pixelDelta / roadmapMonthWidth;
    const delta = Math.round(rawDelta / increment) * increment;
    let start = roadmapDragState.originalStart;
    let end = roadmapDragState.originalEnd;
    if (roadmapDragState.mode === "move") {
      start += delta;
      end += delta;
    } else if (roadmapDragState.mode === "start") {
      start = Math.min(end, start + delta);
    } else {
      end = Math.max(start, end + delta);
    }
    roadmapDraft = {
      productId: roadmapDragState.productId,
      roadmap: { startMonth: monthString(start), launchMonth: monthString(start), endMonth: monthString(end) },
    };
    renderRoadmaps();
  });

  function finishRoadmapPointer(event) {
    if (roadmapPanState?.targetCanvas === targetCanvas) {
      const wasEmptyClick = !roadmapPanState.moved && !roadmapPanState.hitProductId;
      roadmapPanState = null;
      targetScroll.classList.remove("is-panning");
      targetCanvas.style.cursor = "grab";
      if (targetCanvas.hasPointerCapture(event.pointerId)) targetCanvas.releasePointerCapture(event.pointerId);
      syncRoadmapNavigator(targetScroll, navigatorRefsFactory());
      if (wasEmptyClick) clearSelection();
      else renderRoadmaps();
      return;
    }
    if (roadmapDragState?.targetCanvas !== targetCanvas) return;
    const draft = roadmapDraft;
    const moved = roadmapDragState.moved;
    roadmapDragState = null;
    roadmapDraft = null;
    targetCanvas.style.cursor = "grab";
    if (targetCanvas.hasPointerCapture(event.pointerId)) targetCanvas.releasePointerCapture(event.pointerId);
    if (draft && moved) updateRoadmap(draft.productId, draft.roadmap, true);
    else renderRoadmaps();
  }

  targetCanvas.addEventListener("pointerup", finishRoadmapPointer);
  targetCanvas.addEventListener("pointercancel", finishRoadmapPointer);
  targetCanvas.addEventListener("dblclick", (event) => {
    const point = roadmapPoint(event, targetCanvas);
    const hit = hitRoadmapBar(targetCanvas, point);
    if (!hit) return;
    if (selectedId !== hit.productId) stopRoadmapSlotEditing();
    selectedId = hit.productId;
    renderInspector();
    renderSplitProduct();

    // Double-click is an exploration shortcut, not an editing shortcut.
    // Product and slot edits remain behind explicit controls.
    if (targetCanvas === roadmapCanvas) {
      setView("split", { focusSelected: true });
      return;
    }

    updateRoadmapEditControls();
    renderRoadmaps();
  });

  targetScroll.addEventListener("scroll", () => {
    requestAnimationFrame(() => renderRoadmapFor(targetCanvas, targetScroll, navigatorRefsFactory()));
  }, { passive: true });

  targetScroll.addEventListener("wheel", (event) => {
    const max = Math.max(0, targetScroll.scrollWidth - targetScroll.clientWidth);
    const horizontalIntent = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (max <= 0 || !horizontalIntent) return;
    event.preventDefault();
    targetScroll.scrollLeft += event.deltaX || event.deltaY;
  }, { passive: false });
}

function splitRoadmapStatusLabel(status) {
  const labels = {
    launched: "Launched",
    "in-development": "In development",
    "in-planning": "In planning",
    embargo: "Under embargo",
    "end-of-life": "End of life",
  };
  return labels[status] || "Not set";
}

function splitDateCardsHtml(product) {
  const dates = [
    ["FFS", product.ffsDate],
    ["Global announcement", product.globalAnnouncementDate],
    ["Web readiness", product.webReadinessDate],
    ["Final assets", product.finalAssetsDate],
  ];
  return dates.map(([label, value]) => `
    <div class="split-detail-card split-date-card ${value ? "" : "is-tbd"}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatProductInfoDate(value))}</strong>
    </div>`).join("");
}

function splitHpSkusHtml(product) {
  const items = productPartSkus(product);
  if (!items.length) return '<div class="split-detail-empty">No HP SKUs assigned.</div>';
  return `<div class="split-hp-sku-list">${items.map((item) => `
    <button class="split-hp-sku" type="button" data-split-copy-sku="${escapeHtml(item.code)}" title="Copy ${escapeHtml(item.code)}">
      <span>${escapeHtml(item.code)}</span>
      <small>Copy</small>
    </button>`).join("")}</div>`;
}

function renderSplitProduct() {
  if (!splitProduct) return;
  const product = selectedProduct();
  if (!product) {
    splitProduct.innerHTML = '<div class="split-empty"><h2>No product selected</h2><p>Select a roadmap bar to review its complete product information.</p></div>';
    return;
  }

  const roadmap = product.roadmap || {};
  const presentation = productPresentation(product);
  const category = activeCategoryRecord();
  const lane = board.lanes.find((item) => item.id === product.laneId);
  const statusClass = product.statusType === "embargo" ? "status-embargo" : product.statusType === "new" ? "status-new" : "";
  const roadmapStatus = roadmap.status || "";
  const iconByKind = { connection: "⌁", battery: "▭", microphone: "◉", driver: "⊙", audio: "◡", cushion: "≋", frame: "◇", controls: "⚙", generic: "◆" };
  const specs = Array.isArray(product.specs) ? product.specs : [];
  const variantHtml = splitVariantGroupsHtml(product);

  splitProduct.innerHTML = `
    <article class="split-product-card split-product-card--detail ${presentation.primaryLabel ? "is-highlighted" : ""}" style="--product-highlight:${escapeHtml(presentation.outlineColor)}">
      <div class="split-status ${statusClass}" style="background:${escapeHtml(presentation.primaryColor)}">${escapeHtml(presentation.primaryLabel || "SELECTED PRODUCT")}</div>

      <div class="split-product-hero">
        <img class="split-product-image" src="${escapeHtml(productImageSource(product))}" alt="">
        <div class="split-product-title">
          <span class="eyebrow">${escapeHtml(roadmap.family || "Portfolio product")}</span>
          <h2>${escapeHtml(product.name)}</h2>
          <div class="split-price">${board.settings.showPrices ? productPriceText(product) : "Price hidden"}</div>
        </div>
      </div>

      <div class="split-product-body split-product-body--detail">
        <section class="split-detail-section">
          <span class="split-detail-heading">Portfolio overview</span>
          <div class="split-detail-grid split-detail-grid--two">
            <div class="split-detail-card"><span>Category</span><strong>${escapeHtml(category?.name || categoryDefinition().name)}</strong></div>
            <div class="split-detail-card"><span>Lane</span><strong>${escapeHtml(lane?.label || "Unassigned")}</strong></div>
            <div class="split-detail-card"><span>Codename</span><strong class="${product.codename ? "" : "is-muted"}">${escapeHtml(product.codename || "Not set")}</strong></div>
            <div class="split-detail-card"><span>Product tier</span><strong class="${product.tier ? "" : "is-muted"}">${escapeHtml(productTier(product))}</strong></div>
          </div>
        </section>

        <section class="split-detail-section">
          <span class="split-detail-heading">Key dates</span>
          <div class="split-detail-grid split-detail-grid--two">
            ${splitDateCardsHtml(product)}
          </div>
        </section>

        <section class="split-detail-section">
          <span class="split-detail-heading">Roadmap context</span>
          <div class="split-detail-grid split-detail-grid--two">
            <div class="split-detail-card"><span>Launch month</span><strong>${escapeHtml(roadmapLabel(roadmap.startMonth))}</strong></div>
            <div class="split-detail-card"><span>Lifecycle end</span><strong>${escapeHtml(roadmapLabel(roadmap.endMonth))}</strong></div>
            <div class="split-detail-card"><span>Status</span><strong class="split-roadmap-status split-roadmap-status--${escapeHtml(roadmapStatus || "unset")}">${escapeHtml(splitRoadmapStatusLabel(roadmapStatus))}</strong></div>
            <div class="split-detail-card"><span>Confidence</span><strong>${escapeHtml(roadmap.confidence || "Not set")}</strong></div>
            <div class="split-detail-card is-full"><span>Product family</span><strong>${escapeHtml(roadmap.family || "Not set")}</strong></div>
          </div>
        </section>

        <section class="split-detail-section">
          <span class="split-detail-heading">HP SKU</span>
          ${splitHpSkusHtml(product)}
        </section>

        <section class="split-detail-section">
          <span class="split-detail-heading">Specifications</span>
          <div class="split-spec-list split-spec-list--complete">${specs.length ? specs.map((item) => {
            const kind = specIconKind(item.label);
            return `<div class="split-spec-row">
              <span class="split-spec-icon">${iconByKind[kind] || "◆"}</span>
              <span class="split-spec-copy"><small>${escapeHtml(item.label || "Specification")}</small><strong>${escapeHtml(item.value)}</strong></span>
            </div>`;
          }).join("") : '<div class="split-detail-empty">No specifications assigned.</div>'}</div>
        </section>

        <section class="split-detail-section">
          <span class="split-detail-heading">Color / layout variants</span>
          ${variantHtml || '<div class="split-detail-empty">No variants assigned.</div>'}
        </section>

        <div class="split-actions split-actions-single split-actions-sticky">
          <button id="splitOpenProduct">Open product cards</button>
        </div>
      </div>
    </article>`;

  $("#splitOpenProduct").onclick = () => setView("products", { focusSelected: true });

  splitProduct.querySelectorAll("[data-split-copy-sku]").forEach((button) => {
    button.addEventListener("click", async () => {
      const copied = await copyTextToClipboard(button.dataset.splitCopySku);
      const label = button.querySelector("small");
      if (!label) return;
      const original = label.textContent;
      label.textContent = copied ? "Copied" : "Failed";
      button.classList.toggle("is-copied", copied);
      setTimeout(() => {
        label.textContent = original;
        button.classList.remove("is-copied");
      }, 1100);
    });
  });
}

function updateLinkedViewButton() {
  const hasSelection = Boolean(selectedProduct());
  linkedViewButton.disabled = !hasSelection;
  if (activeView === "products") linkedViewButton.textContent = "View on roadmap";
  else if (activeView === "roadmap") linkedViewButton.textContent = "View product card";
  else linkedViewButton.textContent = "Open product cards";
}

function roadmapSlotEditingActive(productId = selectedId) {
  return Boolean(productId && roadmapEditProductId === productId);
}

function updateDataEditIndicator() {
  const editing = Boolean(inspectorOpen || roadmapEditProductId || productLayoutEditing);
  if (!dataMenuButton) return;
  dataMenuButton.classList.toggle("is-active", editing);
  dataMenuButton.innerHTML = editing
    ? 'Data · Editing <span aria-hidden="true">▾</span>'
    : 'Data <span aria-hidden="true">▾</span>';
}

function updateProductLayoutEditControls() {
  if (!productLayoutEditButton) return;
  productLayoutEditButton.innerHTML = productLayoutEditing
    ? '<span>Done reordering product cards</span><small>Return Product Cards to protected viewer mode</small>'
    : '<span>Reorder product cards</span><small>Enable protected drag-and-drop lane editing</small>';
  productLayoutEditButton.classList.toggle("is-active", productLayoutEditing);
  productLayoutEditButton.setAttribute("aria-pressed", String(productLayoutEditing));
  canvas.classList.toggle("is-layout-editing", productLayoutEditing);
  updateDataEditIndicator();
}

function updateRoadmapEditControls() {
  const product = selectedProduct();
  const editing = Boolean(product && roadmapSlotEditingActive(product.id));
  if (roadmapEditSelectedButton) {
    roadmapEditSelectedButton.disabled = !product;
    roadmapEditSelectedButton.innerHTML = editing
      ? '<span>Done editing selected roadmap slot</span><small>Lock the timeline handles again</small>'
      : '<span>Edit selected roadmap slot</span><small>Enable protected timeline handles for the selected product</small>';
    roadmapEditSelectedButton.classList.toggle("is-active", editing);
    roadmapEditSelectedButton.setAttribute("aria-pressed", String(editing));
  }
  if (roadmapMenuButton) {
    roadmapMenuButton.classList.remove("is-active");
    roadmapMenuButton.innerHTML = 'Timeline <span aria-hidden="true">▾</span>';
  }
  updateDataEditIndicator();
}

function stopRoadmapSlotEditing() {
  roadmapEditProductId = null;
  roadmapDragState = null;
  roadmapDraft = null;
  updateRoadmapEditControls();
}

function setView(view, { focusSelected = false } = {}) {
  closePopupMenus();
  activeView = ["products", "roadmap", "split"].includes(view) ? view : "products";
  if (activeView === "products") stopRoadmapSlotEditing();
  else if (productLayoutEditing) {
    productLayoutEditing = false;
    updateProductLayoutEditControls();
  }
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
  updateRoadmapEditControls();
  updateProductLayoutEditControls();
  closeSpecPopover();
  closeVariantPopover({ force: true });
  renderActiveView();
  if (activeView === "products" && initialVerticalFitPending) {
    initialVerticalFitPending = false;
    fitProductLanesVertically();
    if (focusSelected) requestAnimationFrame(scrollSelectedIntoView);
  } else if (focusSelected) {
    requestAnimationFrame(() => {
      if (activeView === "products") scrollSelectedIntoView();
      else scrollRoadmapSelected(activeView === "split" ? splitRoadmapScroll : roadmapScroll);
    });
  }
}

function renderActiveView() {
  renderViewerInfo();
  updateLinkedViewButton();
  updateRoadmapEditControls();
  updateProductLayoutEditControls();
  if (activeView === "products") renderBoard();
  else renderRoadmaps();
  renderStatus();
}

function renderLaneRail(dimensions = getCanvasDimensions()) {
  if (!laneRailInner) return;
  const lanes = sortedLanes();
  const layout = productCardLayout();
  laneRailInner.style.height = `${dimensions.height * zoom}px`;
  laneRailInner.innerHTML = lanes.map((lane, laneIndex) => {
    const top = (LANE_TOP + laneIndex * layout.laneHeight - 4) * zoom;
    const height = (layout.cardHeight + 8) * zoom;
    return `<div class="lane-rail-item" style="top:${top}px;height:${height}px">
      <div class="lane-rail-copy">
        <span class="lane-rail-label">${escapeHtml(lane.label)}</span>
        <span class="lane-rail-subtitle">${escapeHtml(lane.subtitle || "")}</span>
      </div>
    </div>`;
  }).join("");
  syncLaneRail();
}

function syncLaneRail() {
  if (!laneRailInner) return;
  laneRailInner.style.transform = `translateY(${-canvasScroll.scrollTop}px)`;
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
  renderLaneRail(dimensions);
  canvasScroll.scrollLeft = previousLeft;
  canvasScroll.scrollTop = previousTop;
  $("#zoomReset").textContent = `${Math.round(zoom * 100)}%`;
  renderStatus();
  positionViewerInfo();
  requestAnimationFrame(syncBoardNavigator);
}

function renderStatus() {
  const viewText = activeView === "products" ? "Product comparison" : activeView === "roadmap" ? "Roadmap slotting" : "Synchronized split view";
  const interaction = activeView === "products"
    ? productLayoutEditing
      ? "Layout editing enabled from Data; drag cards to reorder or move lanes; hover color SKUs to preview hero images"
      : "Viewer mode; toggle details with the white i button; while open, selecting another card updates the same drawer"
    : roadmapSlotEditingActive()
      ? "Roadmap slot editing enabled from Data; use dedicated handles; click empty space or press Escape to deselect"
      : "Viewer mode; double-click a roadmap product for Split view; drag the canvas to navigate; editing is under Data";
  $("#statusbar").innerHTML = `
    <span>${board.products.length} products</span>
    <span>${board.lanes.length} product lanes</span>
    <span>${viewText}</span>
    <span>Data autosaved · images stored separately</span>
    <span>${interaction}</span>`;
}

function selectedProduct() {
  return board.products.find((product) => product.id === selectedId) || null;
}

function infoProduct() {
  return board.products.find((product) => product.id === viewerInfoProductId) || selectedProduct();
}

function productSpecValue(product, patterns) {
  const specs = Array.isArray(product?.specs) ? product.specs : [];
  const matchers = patterns.map((pattern) => pattern instanceof RegExp ? pattern : new RegExp(String(pattern), "i"));
  const found = specs.find((item) => matchers.some((pattern) => pattern.test(String(item.label || ""))));
  return found?.value ? String(found.value) : "";
}

function productTier(product) {
  return PRODUCT_TIER_OPTIONS.includes(product?.tier) && product.tier ? product.tier : "Not set";
}

function productPartSkus(product) {
  return (Array.isArray(product?.partSkus) ? product.partSkus : [])
    .map((item, index) => normalizePartSku(item, index))
    .filter((item) => item.code);
}

function viewerPartSkusHtml(product) {
  const items = productPartSkus(product);
  if (!items.length) return '<div class="viewer-info-empty">No HP SKUs assigned.</div>';
  return `<div class="viewer-part-sku-list">${items.map((item) => `
    <button type="button" class="viewer-part-sku" data-copy-part-sku="${escapeHtml(item.code)}" title="Copy ${escapeHtml(item.code)}">
      <span>${escapeHtml(item.code)}</span>
      <small>Copy</small>
    </button>`).join("")}</div>`;
}

function viewerDateRowsHtml(product) {
  const rows = [
    ["FFS", product.ffsDate],
    ["Global announcement", product.globalAnnouncementDate],
    ["Web readiness", product.webReadinessDate],
    ["Final assets", product.finalAssetsDate],
  ];
  return `<div class="viewer-info-date-list">${rows.map(([label, value]) => `
    <div class="viewer-info-date-row">
      <span>${escapeHtml(label)}</span>
      <strong class="${value ? "" : "is-tbd"}">${escapeHtml(formatProductInfoDate(value))}</strong>
    </div>`).join("")}</div>`;
}

function renderViewerInfo() {
  if (!viewerInfo) return;
  const product = infoProduct();
  const visible = Boolean(product && (viewerInfoOpen || viewerInfoProgress > .001));
  viewerInfo.classList.toggle("is-open", visible);
  viewerInfo.setAttribute("aria-hidden", String(!visible));
  if (!visible || !product) {
    if (!viewerInfoOpen && viewerInfoProgress <= .001) viewerInfo.innerHTML = "";
    if (viewerInfoOutline) {
      viewerInfoOutline.classList.remove("is-open");
      viewerInfoOutline.style.width = "0px";
    }
    return;
  }

  const category = activeCategoryRecord();
  const variantHtml = splitVariantGroupsHtml(product);
  viewerInfo.innerHTML = `
    <div class="viewer-info-body">
      <section class="viewer-info-section viewer-identity-section">
        <span class="viewer-info-label">Identity</span>
        <div class="viewer-info-identity">
          <div><span>Category</span><strong>${escapeHtml(category?.name || categoryDefinition().name)}</strong></div>
          <div><span>Codename</span><strong class="${product.codename ? "" : "is-empty"}">${escapeHtml(product.codename || "Not set")}</strong></div>
          <div><span>Product tier</span><strong class="${product.tier ? "" : "is-empty"}">${escapeHtml(productTier(product))}</strong></div>
        </div>
      </section>
      <section class="viewer-info-section">
        <span class="viewer-info-label">Key dates</span>
        ${viewerDateRowsHtml(product)}
      </section>
      <section class="viewer-info-section">
        <span class="viewer-info-label">HP SKU</span>
        ${viewerPartSkusHtml(product)}
      </section>
      <section class="viewer-info-section">
        <span class="viewer-info-label">Color / layout variants</span>
        ${variantHtml || '<div class="viewer-info-empty">No variants assigned.</div>'}
      </section>
    </div>`;

  viewerInfo.querySelectorAll("[data-copy-part-sku]").forEach((button) => {
    button.addEventListener("click", async () => {
      const copied = await copyTextToClipboard(button.dataset.copyPartSku);
      const copyLabel = button.querySelector("small");
      if (!copyLabel) return;
      const original = copyLabel.textContent;
      copyLabel.textContent = copied ? "Copied" : "Failed";
      button.classList.toggle("is-copied", copied);
      setTimeout(() => {
        copyLabel.textContent = original;
        button.classList.remove("is-copied");
      }, 1100);
    });
  });
}

function positionViewerInfo() {
  if (!viewerInfo || !viewerInfoProductId || activeView !== "products" || viewerInfoProgress <= 0) return null;
  const card = renderedCards.find((item) => item.productId === viewerInfoProductId);
  if (!card) return null;
  const width = viewerInfoVisualWidth();
  const height = viewerInfoVisualHeight();
  const left = (card.x + card.width) * zoom;
  const top = card.y * zoom;
  const hiddenPercent = Math.max(0, Math.min(100, (1 - viewerInfoProgress) * 100));
  const visibleWidth = width * viewerInfoProgress;

  viewerInfo.style.setProperty("--viewer-info-width", `${width}px`);
  viewerInfo.style.setProperty("--viewer-info-height", `${height}px`);
  viewerInfo.style.left = `${left}px`;
  viewerInfo.style.top = `${top}px`;
  viewerInfo.style.transform = "none";
  viewerInfo.style.opacity = "1";
  viewerInfo.style.clipPath = `inset(0 ${hiddenPercent}% 0 0)`;
  viewerInfo.style.pointerEvents = viewerInfoProgress > .96 ? "auto" : "none";

  if (viewerInfoOutline) {
    const outlineWidth = (CARD_WIDTH * zoom) + visibleWidth;
    viewerInfoOutline.classList.toggle("is-open", viewerInfoProgress > .001);
    viewerInfoOutline.style.left = `${card.x * zoom}px`;
    viewerInfoOutline.style.top = `${top}px`;
    viewerInfoOutline.style.width = `${outlineWidth}px`;
    viewerInfoOutline.style.height = `${height}px`;
  }

  return {
    cardLeft: card.x * zoom,
    cardTop: card.y * zoom,
    paneLeft: left,
    paneRight: left + visibleWidth,
    paneBottom: top + height,
  };
}

function revealViewerInfoBesideProduct() {
  const placement = positionViewerInfo();
  if (!placement) return;
  const padding = 18;
  const viewportWidth = canvasScroll.clientWidth;
  const viewportHeight = canvasScroll.clientHeight;
  const combinedWidth = placement.paneRight - placement.cardLeft;
  let targetLeft = canvasScroll.scrollLeft;
  if (combinedWidth <= viewportWidth - padding * 2) {
    targetLeft = placement.cardLeft - Math.max(padding, (viewportWidth - combinedWidth) / 2);
  } else {
    targetLeft = placement.cardLeft - padding;
  }
  const maxLeft = Math.max(0, canvasScroll.scrollWidth - viewportWidth);
  targetLeft = Math.max(0, Math.min(maxLeft, targetLeft));

  let targetTop = canvasScroll.scrollTop;
  if (placement.cardTop < targetTop + padding || placement.paneBottom > targetTop + viewportHeight - padding) {
    targetTop = Math.max(0, placement.cardTop - padding);
  }
  canvasScroll.scrollTo({ left: targetLeft, top: targetTop, behavior: "smooth" });
}

function viewerInfoEase(progress) {
  return progress < .5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function animateViewerInfo(targetProgress, onComplete) {
  cancelAnimationFrame(viewerInfoAnimationFrame);
  const startProgress = viewerInfoProgress;
  const difference = targetProgress - startProgress;
  if (Math.abs(difference) < .001) {
    viewerInfoProgress = targetProgress;
    renderBoard();
    positionViewerInfo();
    onComplete?.();
    return;
  }

  const startedAt = performance.now();
  const duration = VIEWER_INFO_ANIMATION_MS * Math.max(.45, Math.abs(difference));
  const step = (now) => {
    const elapsed = Math.min(1, (now - startedAt) / duration);
    viewerInfoProgress = startProgress + difference * viewerInfoEase(elapsed);
    renderBoard();
    positionViewerInfo();
    if (elapsed < 1) {
      viewerInfoAnimationFrame = requestAnimationFrame(step);
      return;
    }
    viewerInfoProgress = targetProgress;
    viewerInfoAnimationFrame = null;
    renderBoard();
    positionViewerInfo();
    onComplete?.();
  };
  viewerInfoAnimationFrame = requestAnimationFrame(step);
}

function openViewerInfo(productId = selectedId) {
  if (!productId) return;

  if (viewerInfoOpen && viewerInfoProductId === productId) {
    closeViewerInfo();
    return;
  }

  viewerInfoProductId = productId;
  viewerInfoOpen = true;
  selectedId = productId;
  renderInspector();
  renderViewerInfo();
  renderBoard();

  requestAnimationFrame(() => {
    animateViewerInfo(1, () => requestAnimationFrame(revealViewerInfoBesideProduct));
  });
}

function closeViewerInfo({ render = true } = {}) {
  if (!viewerInfoProductId && viewerInfoProgress <= .001) return;
  viewerInfoOpen = false;
  cancelAnimationFrame(viewerInfoAnimationFrame);
  viewerInfoAnimationFrame = null;

  if (!render || activeView !== "products") {
    viewerInfoProgress = 0;
    viewerInfoProductId = null;
    if (viewerInfoOutline) {
      viewerInfoOutline.classList.remove("is-open");
      viewerInfoOutline.style.width = "0px";
    }
    renderViewerInfo();
    return;
  }

  animateViewerInfo(0, () => {
    viewerInfoProductId = null;
    renderViewerInfo();
    renderBoard();
    requestAnimationFrame(scrollSelectedIntoView);
  });
}

function clearSelection({ render = true } = {}) {
  const changed = Boolean(selectedId || inspectorOpen || roadmapEditProductId || viewerInfoProductId);
  selectedId = null;
  inspectorOpen = false;
  closeViewerInfo({ render: false });
  closeSpecPopover();
  closeVariantPopover({ force: true });
  stopRoadmapSlotEditing();
  renderInspector();
  renderSplitProduct();
  updateLinkedViewButton();
  updateRoadmapEditControls();
  if (render && changed) renderActiveView();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function colorPresetOptionsHtml(currentColor) {
  const normalized = String(currentColor || "").toLowerCase();
  const presetMatch = COLOR_PRESETS.some((item) => item.value === normalized);
  return `${COLOR_PRESETS.map((item) => `<option value="${item.value}" ${item.value === normalized ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}<option value="custom" ${presetMatch ? "" : "selected"}>Custom color…</option>`;
}

function syncColorPresetSelect(select, color) {
  if (!select) return;
  const normalized = String(color || "").toLowerCase();
  select.value = COLOR_PRESETS.some((item) => item.value === normalized) ? normalized : "custom";
}

function bindPresetColor(select, input, onChange) {
  if (!select || !input) return;
  syncColorPresetSelect(select, input.value);
  select.addEventListener("change", () => {
    if (select.value === "custom") {
      input.focus();
      input.click();
      return;
    }
    input.value = select.value;
    onChange(select.value);
  });
  input.addEventListener("input", () => {
    syncColorPresetSelect(select, input.value);
    onChange(input.value);
  });
}

function standardProductColorOptionsHtml(currentKey) {
  const normalized = standardColorByKey(currentKey) ? currentKey : "custom";
  return `${STANDARD_PRODUCT_COLORS.map((item) => `<option value="${item.key}" ${item.key === normalized ? "selected" : ""}>${escapeHtml(item.label)} · ${escapeHtml(item.code)}</option>`).join("")}<option value="custom" ${normalized === "custom" ? "selected" : ""}>Custom color…</option>`;
}

function keyboardLayoutOptionsHtml(currentCode) {
  const normalized = String(currentCode || "").toUpperCase();
  const hasPreset = COMMON_KEYBOARD_LAYOUTS.some((item) => item.code === normalized);
  return `<option value="">Choose common layout…</option>${COMMON_KEYBOARD_LAYOUTS.map((item) => `<option value="${escapeHtml(item.code)}" ${item.code === normalized ? "selected" : ""}>${escapeHtml(item.code)} · ${escapeHtml(item.label)}</option>`).join("")}<option value="custom" ${normalized && !hasPreset ? "selected" : ""}>Custom layout…</option>`;
}

function imageAssetSummaryHtml(assetId, emptyText = "No image assigned") {
  const asset = imageAssetById(assetId);
  if (!asset) return escapeHtml(emptyText);
  if (asset.sourceType === "local") {
    if (missingImageAssetIds.has(asset.id)) return `${escapeHtml(asset.name)} · image file unavailable in this browser`;
    return `${escapeHtml(asset.name)} · ${Math.max(1, Math.round((asset.size || 0) / 1024))} KB · browser image library`;
  }
  return `Web image · ${escapeHtml(asset.url)}`;
}

function colorwayHeroImagesEditorHtml(product) {
  const variants = productColorVariants(product);
  if (variants.length < 2) return "";
  const assignedCount = variants.filter((item) => item.imageAssetId).length;
  return `
    <section id="colorwayHeroSection" class="panel-section colorway-hero-section">
      <details class="hero-image-editor">
        <summary>
          <span><strong>Colorway hero images</strong><small>${assignedCount} of ${variants.length} color SKUs assigned</small></span>
          <span class="hero-summary-action">Manage</span>
        </summary>
        <div class="hero-editor-body">
          <p class="section-subtitle">Assign an optional image to each color SKU. In viewer mode, hover a color SKU to preview its image and click it to pin the comparison.</p>
          <label class="hero-default-choice"><input type="radio" name="featuredHeroVariant" data-featured-hero="" ${product.featuredVariantId ? "" : "checked"}>Use the main product image by default</label>
          <div class="hero-variant-list">${variants.map((item) => {
            const colorLabel = [item.colorName, item.colorName2].filter(Boolean).join(" / ") || item.code;
            const assetSummary = imageAssetSummaryHtml(item.imageAssetId, "No colorway hero image assigned");
            return `
              <div class="hero-variant-card" data-hero-editor-id="${escapeHtml(item.id)}">
                <div class="hero-variant-heading">
                  <span class="hero-variant-identity"><i class="split-sku-swatch ${item.colorHex2 ? "is-dual" : ""}" style="--sku-primary:${escapeHtml(item.colorHex)};--sku-secondary:${escapeHtml(item.colorHex2 || item.colorHex)}"></i><strong>${escapeHtml(item.code)}</strong><span>${escapeHtml(colorLabel)}</span></span>
                  <label class="hero-feature-choice"><input type="radio" name="featuredHeroVariant" data-featured-hero="${escapeHtml(item.id)}" ${product.featuredVariantId === item.id ? "checked" : ""} ${item.imageAssetId ? "" : "disabled"}>Default hero</label>
                </div>
                <label>Hero image URL<input data-hero-image-url value="${escapeHtml(imageAssetWebUrl(item.imageAssetId))}" placeholder="https://..."></label>
                <label class="file-input">Upload hero image<input data-hero-image-upload type="file" accept="image/*"></label>
                <div class="image-asset-summary hero-image-summary"><strong>Colorway asset</strong><span>${assetSummary}</span></div>
                ${item.imageAssetId ? '<button type="button" class="secondary-button hero-clear-image" data-clear-hero-image>Remove colorway image</button>' : ''}
              </div>`;
          }).join("")}</div>
        </div>
      </details>
    </section>`;
}

function colorVariantEditorHtml(group, item, index) {
  const hasSecondary = Boolean(item.colorKey2 || item.colorHex2);
  const primaryCustom = item.colorKey === "custom";
  const secondaryCustom = item.colorKey2 === "custom";
  return `
    <div class="variant-item color-variant-item" data-variant-item-id="${item.id}">
      <span class="sku-color-preview ${hasSecondary ? "is-dual" : ""}" style="--sku-primary:${escapeHtml(item.colorHex)};--sku-secondary:${escapeHtml(item.colorHex2 || item.colorHex)}" aria-hidden="true"></span>
      <label class="variant-code-field">SKU code<input data-variant-field="code" value="${escapeHtml(item.code)}" aria-label="Variant ${index + 1} SKU code"></label>
      <label>Primary color<select data-color-role="primary">${standardProductColorOptionsHtml(item.colorKey)}</select></label>
      ${primaryCustom ? `<label>Custom primary name<input data-variant-field="colorName" value="${escapeHtml(item.colorName)}"></label><label>Custom primary color<input data-variant-field="colorHex" class="color-input" type="color" value="${escapeHtml(item.colorHex)}"></label>` : ""}
      <label class="sku-dual-toggle"><input data-variant-dual type="checkbox" ${hasSecondary ? "checked" : ""}>Two-tone colorway</label>
      ${hasSecondary ? `<label>Secondary color<select data-color-role="secondary">${standardProductColorOptionsHtml(item.colorKey2)}</select></label>` : ""}
      ${hasSecondary && secondaryCustom ? `<label>Custom secondary name<input data-variant-field="colorName2" value="${escapeHtml(item.colorName2)}"></label><label>Custom secondary color<input data-variant-field="colorHex2" class="color-input" type="color" value="${escapeHtml(item.colorHex2 || "#ffffff")}"></label>` : ""}
      <button data-remove-variant="${item.id}" class="icon-button variant-remove" aria-label="Remove color variant ${index + 1}">×</button>
    </div>`;
}

function layoutVariantEditorHtml(group, item, index) {
  return `
    <div class="variant-item layout-variant-item" data-variant-item-id="${item.id}">
      <label>Common layout<select data-layout-preset>${keyboardLayoutOptionsHtml(item.code)}</select></label>
      <label>Layout SKU code<input data-variant-field="code" value="${escapeHtml(item.code)}" aria-label="Layout variant ${index + 1} code"></label>
      <label>Display name<input data-variant-field="label" value="${escapeHtml(item.label || "")}" placeholder="Optional full market or locale name"></label>
      <button data-remove-variant="${item.id}" class="icon-button variant-remove" aria-label="Remove layout variant ${index + 1}">×</button>
    </div>`;
}

function variantGroupsEditorHtml(product) {
  const groups = productVariantGroups(product);
  return `
    <section id="variantsSection" class="panel-section">
      <div class="section-heading-row"><div><h3>Product variants</h3><p class="section-subtitle">Use compact layout codes for keyboard markets and named colors for product colorways.</p></div><button id="addVariantGroup" class="small-button">+ Group</button></div>
      <div class="variant-group-list">${groups.length ? groups.map((group, groupIndex) => `
        <div class="variant-group-card" data-variant-group-id="${group.id}">
          <div class="variant-group-heading">
            <label>Footer label<input data-variant-group-field="label" value="${escapeHtml(group.label)}" aria-label="Variant group ${groupIndex + 1} label"></label>
            <label>Variant type<select data-variant-group-field="type">
              <option value="color" ${group.type === "color" ? "selected" : ""}>Color SKU</option>
              <option value="layout" ${group.type === "layout" ? "selected" : ""}>Layout / locale SKU</option>
            </select></label>
            ${group.type === "layout" ? `<button data-add-layout-set="${group.id}" class="small-button">+ Common set</button>` : ""}
            <button data-add-variant="${group.id}" class="small-button">+ Variant</button>
            <button data-remove-variant-group="${group.id}" class="icon-button" aria-label="Remove variant group ${groupIndex + 1}">×</button>
          </div>
          <div class="variant-item-list">${group.items.length
            ? group.items.map((item, index) => group.type === "layout" ? layoutVariantEditorHtml(group, item, index) : colorVariantEditorHtml(group, item, index)).join("")
            : '<div class="empty-list">No variants in this group</div>'}</div>
        </div>`).join("") : '<div class="empty-list">No product variants</div>'}</div>
    </section>`;
}

function splitVariantGroupsHtml(product) {
  const groups = productVariantGroups(product).filter((group) => group.items.length);
  if (!groups.length) return "";
  return `<div class="split-variant-groups">${groups.map((group) => `
    <div class="split-variant-group">
      <span class="split-variant-label">${escapeHtml(group.label)}</span>
      <div class="split-skus">${group.items.map((item) => group.type === "color"
        ? `<span class="split-sku"><i class="split-sku-swatch ${item.colorHex2 ? "is-dual" : ""}" style="--sku-primary:${escapeHtml(item.colorHex)};--sku-secondary:${escapeHtml(item.colorHex2 || item.colorHex)}"></i>${escapeHtml(item.code)}</span>`
        : `<span class="split-sku layout-sku" title="${escapeHtml(item.label || item.code)}">${escapeHtml(item.code)}</span>`).join("")}</div>
    </div>`).join("")}</div>`;
}

function updateProductVariantGroups(productId, updater, updateInspectorAfter = false) {
  const beforeProduct = board.products.find((item) => item.id === productId);
  const beforeAssetIds = new Set(productColorVariants(beforeProduct).map((item) => item.imageAssetId).filter(Boolean));
  updateBoard((current) => {
    const product = current.products.find((item) => item.id === productId);
    if (!product) return;
    const groups = productVariantGroups(product).map((group) => ({ ...group, items: group.items.map((item) => ({ ...item })) }));
    product.variantGroups = updater(groups) || groups;
    if (!colorVariantWithImage(product, product.featuredVariantId)) product.featuredVariantId = "";
  }, { inspector: updateInspectorAfter });
  const afterProduct = board.products.find((item) => item.id === productId);
  const afterAssetIds = new Set(productColorVariants(afterProduct).map((item) => item.imageAssetId).filter(Boolean));
  beforeAssetIds.forEach((assetId) => { if (!afterAssetIds.has(assetId)) void removeImageAssetIfUnused(assetId); });
  const pinnedId = pinnedHeroVariantByProduct.get(productId);
  if (pinnedId && !colorVariantWithImage(afterProduct, pinnedId)) pinnedHeroVariantByProduct.delete(productId);
  if (hoveredHeroVariant?.productId === productId && !colorVariantWithImage(afterProduct, hoveredHeroVariant.variantId)) hoveredHeroVariant = null;
}

function applyInspectorState(empty = false) {
  inspector.className = `inspector${empty ? " inspector-empty" : ""}${inspectorOpen ? " is-open" : ""}`;
  inspector.setAttribute("aria-hidden", String(!inspectorOpen));
}

function revealSelectedProductBesideInspector() {
  if (!inspectorOpen || activeView !== "products" || !selectedId) return;
  const card = renderedCards.find((item) => item.productId === selectedId);
  if (!card) return;

  const drawerWidth = inspector.getBoundingClientRect().width || inspector.offsetWidth || 0;
  const safeViewportWidth = Math.max(120, canvasScroll.clientWidth - drawerWidth - 28);
  const padding = 18;
  const cardLeft = card.x * zoom;
  const cardRight = (card.x + card.width) * zoom;
  const visibleLeft = canvasScroll.scrollLeft;
  const visibleRight = visibleLeft + safeViewportWidth;

  if (cardLeft >= visibleLeft + padding && cardRight <= visibleRight - padding) return;

  const cardCenter = (cardLeft + cardRight) / 2;
  const maximum = Math.max(0, canvasScroll.scrollWidth - canvasScroll.clientWidth);
  const target = Math.max(0, Math.min(maximum, cardCenter - safeViewportWidth / 2));
  canvasScroll.scrollLeft = target;
  syncBoardNavigator();
}

function openInspector(sectionId = "") {
  if (!selectedProduct()) return;
  inspectorOpen = true;
  updateDataEditIndicator();
  renderInspector();
  if (activeView === "products") {
    renderBoard();
    requestAnimationFrame(revealSelectedProductBesideInspector);
  }
  if (sectionId) {
    requestAnimationFrame(() => inspector.querySelector(`#${sectionId}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }
}

function closeInspector() {
  inspectorOpen = false;
  updateDataEditIndicator();
  applyInspectorState(!selectedProduct());
  if (activeView === "products") renderBoard();
}

function closeSpecPopover() {
  specPopover.classList.add("hidden");
  specPopover.setAttribute("aria-hidden", "true");
  specPopover.innerHTML = "";
}

function openSpecPopover(productId, clientX, clientY) {
  closeVariantPopover({ force: true });
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
      <div class="spec-popover-row"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join("")}</div>`;
  specPopover.classList.remove("hidden");
  specPopover.setAttribute("aria-hidden", "false");
  const margin = 12;
  const rect = specPopover.getBoundingClientRect();
  const left = Math.max(margin, Math.min(clientX + 12, window.innerWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(clientY + 12, window.innerHeight - rect.height - margin));
  specPopover.style.left = `${left}px`;
  specPopover.style.top = `${top}px`;
  $("#closeSpecPopover").onclick = closeSpecPopover;
}


function clearVariantHoverTimers() {
  clearTimeout(variantHoverOpenTimer);
  clearTimeout(variantHoverCloseTimer);
  variantHoverOpenTimer = null;
  variantHoverCloseTimer = null;
}

function closeVariantPopover({ force = false } = {}) {
  if (variantPopoverPinned && !force) return;
  clearVariantHoverTimers();
  variantPopoverPinned = false;
  variantPopoverKey = "";
  variantPopover.classList.add("hidden");
  variantPopover.classList.remove("is-pinned");
  variantPopover.setAttribute("aria-hidden", "true");
  variantPopover.innerHTML = "";
}

function positionVariantPopover(clientX, clientY) {
  const margin = 12;
  const rect = variantPopover.getBoundingClientRect();
  const preferRight = clientX + 14;
  const fallbackLeft = clientX - rect.width - 14;
  const left = preferRight + rect.width <= window.innerWidth - margin
    ? preferRight
    : Math.max(margin, fallbackLeft);
  const top = Math.max(margin, Math.min(clientY + 10, window.innerHeight - rect.height - margin));
  variantPopover.style.left = `${left}px`;
  variantPopover.style.top = `${top}px`;
}

function variantPopoverItemHtml(product, group, item) {
  const code = escapeHtml(item.code || "SKU");
  const label = escapeHtml(item.label || item.colorName || item.code || "Variant");
  if (group.type === "color") {
    const primary = escapeHtml(item.colorHex || "#777777");
    const secondary = escapeHtml(item.colorHex2 || item.colorHex || "#777777");
    const hasHero = Boolean(item.imageAssetId);
    const isActive = activeHeroVariant(product)?.id === item.id;
    const heroAttributes = hasHero
      ? ` data-hero-product-id="${escapeHtml(product.id)}" data-hero-variant-id="${escapeHtml(item.id)}"`
      : "";
    return `<div class="variant-popover-item color-item${hasHero ? " has-hero" : ""}${isActive ? " is-active-hero" : ""}" title="${label}${hasHero ? " · hover to preview hero image" : ""}"${heroAttributes}>
      <i class="variant-popover-swatch ${item.colorHex2 ? "is-dual" : ""}" style="--variant-primary:${primary};--variant-secondary:${secondary}" aria-hidden="true"></i>
      <strong>${code}</strong><span>${label}</span>${hasHero ? '<b class="hero-image-badge" aria-hidden="true">●</b>' : ''}
    </div>`;
  }
  return `<div class="variant-popover-item layout-item" title="${label}"><strong>${code}</strong><span>${label}</span></div>`;
}

function openVariantPopover(region, clientX, clientY, { pinned = false } = {}) {
  if (!region?.groups?.length) return;
  clearVariantHoverTimers();
  closeSpecPopover();
  variantPopoverPinned = pinned;
  variantPopoverKey = region.key;
  const product = board.products.find((item) => item.id === region.productId);
  if (!product) return;
  const groups = region.groups.filter((group) => Array.isArray(group.items) && group.items.length);
  if (!groups.length) return;
  variantPopover.innerHTML = `
    <div class="variant-popover-heading">
      <span class="eyebrow">Additional variants</span>
      ${pinned ? '<button id="closeVariantPopover" class="icon-button" aria-label="Close variant list">×</button>' : ''}
    </div>
    <div class="variant-popover-groups">${groups.map((group) => `
      <section class="variant-popover-group ${group.type === "layout" ? "is-layout" : "is-color"}">
        <h3>${escapeHtml(group.label || "Variants")}</h3>
        <div class="variant-popover-grid">${group.items.map((item) => variantPopoverItemHtml(product, group, item)).join("")}</div>
      </section>`).join("")}</div>`;
  variantPopover.classList.remove("hidden");
  variantPopover.classList.toggle("is-pinned", pinned);
  variantPopover.setAttribute("aria-hidden", "false");
  positionVariantPopover(clientX, clientY);
  const closeButton = $("#closeVariantPopover");
  if (closeButton) closeButton.onclick = () => closeVariantPopover({ force: true });
}

function scheduleVariantPopoverOpen(region, clientX, clientY) {
  if (variantPopoverPinned) return;
  clearTimeout(variantHoverCloseTimer);
  variantHoverCloseTimer = null;
  if (variantPopoverKey === region.key && !variantPopover.classList.contains("hidden")) return;
  clearTimeout(variantHoverOpenTimer);
  variantHoverOpenTimer = setTimeout(() => openVariantPopover(region, clientX, clientY), 140);
}

function scheduleVariantPopoverClose() {
  if (variantPopoverPinned) return;
  clearTimeout(variantHoverOpenTimer);
  variantHoverOpenTimer = null;
  clearTimeout(variantHoverCloseTimer);
  variantHoverCloseTimer = setTimeout(() => closeVariantPopover(), 180);
}

function renderInspector() {
  const product = selectedProduct();
  if (!product) {
    applyInspectorState(true);
    inspector.innerHTML = "<h2>Product details</h2><p>Select a product, then use Data → Edit selected product to update its information.</p>";
    editSelectedButton.disabled = true;
    return;
  }
  applyInspectorState(false);
  editSelectedButton.disabled = false;
  const imageAssetSummary = imageAssetSummaryHtml(product.imageAssetId, "No product image · category placeholder is used");
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
      <label>Price display override<input id="fieldPriceLabel" value="${escapeHtml(product.priceLabel || "")}" placeholder="Example: $ Varies or Contact sales"></label>
      <label>Product image URL<input id="fieldImageUrl" placeholder="https://... or upload below" value="${escapeHtml(productImageWebUrl(product))}"></label>
      <label class="file-input">Upload image<input id="fieldImageUpload" type="file" accept="image/*"></label>
      <div class="image-asset-summary"><strong>Image asset</strong><span>${imageAssetSummary}</span></div>
      <p class="image-storage-note">Uploaded images are stored as binary assets in the browser image library. Product records keep only a small image ID, so autosave and JSON stay lightweight.</p>
      ${product.imageAssetId ? '<button id="clearImage" class="secondary-button">Use placeholder image</button>' : ""}
    </section>
    <section id="productInformationSection" class="panel-section product-information-section">
      <div class="section-heading-row">
        <div>
          <span class="eyebrow">Viewer details</span>
          <h3>Product information</h3>
        </div>
        <span class="section-badge">Read-only pane</span>
      </div>
      <div class="portfolio-info-card">
        <div class="category-move-control">
          <label>Category
            <select id="fieldProductCategory">
              ${portfolio.categories.map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === activeCategoryId ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}
            </select>
          </label>
          <button id="moveProductCategory" type="button" class="small-button" disabled>Move</button>
        </div>
        <p class="field-help">Changing category moves this product into the first lane of the selected category.</p>
        <div class="portfolio-info-grid">
          <label>Codename<input id="fieldCodename" value="${escapeHtml(product.codename || "")}" placeholder="Internal codename"></label>
          <label>Product tier<select id="fieldProductTier">${productTierOptionsHtml(product.tier)}</select></label>
        </div>
        <div class="portfolio-date-grid">
          <label class="portfolio-date-field">FFS date
            <span class="portfolio-date-control">
              <input id="fieldFfsDate" type="date" value="${escapeHtml(product.ffsDate || "")}">
              <button id="fieldFfsDateTbd" class="date-tbd-button" type="button" title="Clear the date and mark it TBD">TBD</button>
            </span>
          </label>
          <label class="portfolio-date-field">Global announcement
            <span class="portfolio-date-control">
              <input id="fieldGlobalAnnouncementDate" type="date" value="${escapeHtml(product.globalAnnouncementDate || "")}">
              <button id="fieldGlobalAnnouncementDateTbd" class="date-tbd-button" type="button" title="Clear the date and mark it TBD">TBD</button>
            </span>
          </label>
          <label class="portfolio-date-field">Web readiness
            <span class="portfolio-date-control">
              <input id="fieldWebReadinessDate" type="date" value="${escapeHtml(product.webReadinessDate || "")}">
              <button id="fieldWebReadinessDateTbd" class="date-tbd-button" type="button" title="Clear the date and mark it TBD">TBD</button>
            </span>
          </label>
          <label class="portfolio-date-field">Final assets
            <span class="portfolio-date-control">
              <input id="fieldFinalAssetsDate" type="date" value="${escapeHtml(product.finalAssetsDate || "")}">
              <button id="fieldFinalAssetsDateTbd" class="date-tbd-button" type="button" title="Clear the date and mark it TBD">TBD</button>
            </span>
          </label>
        </div>
        <p class="field-help date-field-help">Leave a date blank or select <strong>TBD</strong> when the milestone date is not determined.</p>
      </div>
      <div class="part-sku-editor">
        <div class="section-heading-row part-sku-heading">
          <div>
            <span class="eyebrow">HP part numbers</span>
            <h3>HP SKU</h3>
          </div>
          <button id="addPartSku" class="small-button" type="button">+ Add HP SKU</button>
        </div>
        <div class="part-sku-list">${product.partSkus.length ? product.partSkus.map((item, index) => `
          <div class="part-sku-row" data-part-sku-id="${escapeHtml(item.id)}">
            <input data-part-sku-code value="${escapeHtml(item.code)}" placeholder="BS1T9AA" aria-label="HP SKU ${index + 1}">
            <button type="button" class="part-sku-copy" data-copy-editor-sku title="Copy HP SKU">Copy</button>
            <button type="button" class="icon-button part-sku-remove" data-remove-part-sku aria-label="Remove HP SKU ${index + 1}">×</button>
          </div>`).join("") : '<div class="empty-list">No HP SKUs</div>'}</div>
      </div>
    </section>
    ${colorwayHeroImagesEditorHtml(product)}
    <section class="panel-section">
      <h3>Status and variant banner</h3>
      <label>Status<select id="fieldStatus">
        <option value="none" ${product.statusType === "none" ? "selected" : ""}>None</option>
        <option value="new" ${product.statusType === "new" ? "selected" : ""}>New product — standardized green</option>
        <option value="embargo" ${product.statusType === "embargo" ? "selected" : ""}>Upcoming under embargo — standardized pink</option>
      </select></label>
      <p class="standard-status-note">New Product and Upcoming Under Embargo use protected labels and theme colors. They cannot be renamed or recolored.</p>
      <label class="checkbox-label"><input id="fieldVariantEnabled" type="checkbox" ${product.variantLabel ? "checked" : ""}>Show a custom variant banner</label>
      <div id="variantBannerFields" class="${product.variantLabel ? "" : "is-disabled"}">
        <label>Variant label<input id="fieldVariantLabel" value="${escapeHtml(product.variantLabel || "")}" placeholder="PLAYSTATION, XBOX, SUNSETTING…"></label>
        <div class="highlight-color-control">
          <label>Variant color preset<select id="fieldVariantColorPreset">${colorPresetOptionsHtml(product.variantColor || "#3f6f91")}</select></label>
          <label>Custom color<input id="fieldVariantColor" aria-label="Variant color" type="color" value="${escapeHtml(product.variantColor || "#3f6f91")}"></label>
        </div>
      </div>
    </section>
    <section id="roadmapSection" class="panel-section">
      <div class="section-heading-row"><h3>Roadmap slotting</h3><span class="eyebrow">Shared across views</span></div>
      <div class="roadmap-section-grid">
        <label class="full">Product family<input id="fieldRoadmapFamily" value="${escapeHtml(product.roadmap.family)}" placeholder="Cloud, Stinger, Jet…"></label>
        <label>Launch month<input id="fieldRoadmapStart" type="month" value="${escapeHtml(product.roadmap.startMonth)}"></label>
        <label>Lifecycle end<input id="fieldRoadmapEnd" type="month" value="${escapeHtml(product.roadmap.endMonth)}"></label>
        <label>Status<select id="fieldRoadmapStatus">
          <option value="launched" ${product.roadmap.status === "launched" ? "selected" : ""}>Launched</option>
          <option value="in-development" ${product.roadmap.status === "in-development" ? "selected" : ""}>In development</option>
          <option value="in-planning" ${product.roadmap.status === "in-planning" ? "selected" : ""}>In planning</option>
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
      <p class="roadmap-inline-note">The first roadmap date is always the product launch month. Stage color communicates whether that launch is already launched, in development, or still in planning. Lifecycle end closes the active portfolio window.</p>
    </section>
    <section id="specificationsSection" class="panel-section">
      <div class="section-heading-row"><h3>Specifications</h3><button id="addSpec" class="small-button">+ Add</button></div>
      <div class="common-spec-set">
        <label>Category common set<select id="specSetSelect">${categorySpecSets().map((set) => `<option value="${escapeHtml(set.id)}">${escapeHtml(set.label)}</option>`).join("")}</select></label>
        <button id="addSpecSet" class="small-button" type="button">+ Add missing fields</button>
      </div>
      <div class="stack-list">${product.specs.length ? product.specs.map((item, index) => `
        <div class="editable-row" data-spec-id="${item.id}">
          <input data-spec-field="label" value="${escapeHtml(item.label)}" aria-label="Specification ${index + 1} label">
          <input data-spec-field="value" value="${escapeHtml(item.value)}" aria-label="Specification ${index + 1} value">
          <button data-remove-spec="${item.id}" class="icon-button" aria-label="Remove specification ${index + 1}">×</button>
        </div>`).join("") : '<div class="empty-list">No specifications</div>'}</div>
    </section>
    ${variantGroupsEditorHtml(product)}
`;

  $("#deleteProduct").onclick = deleteSelected;
  $("#closeInspector").onclick = closeInspector;
  bindValue("#fieldName", "input", (value) => updateProduct(product.id, { name: value }, false));
  bindValue("#fieldPrice", "input", (value) => updateProduct(product.id, { price: value === "" ? null : Number(value) }, false));
  bindValue("#fieldPriceLabel", "input", (value) => updateProduct(product.id, { priceLabel: value }, false));
  bindValue("#fieldLane", "change", (value) => moveProductToLane(product.id, value));
  bindValue("#fieldCodename", "input", (value) => updateProduct(product.id, { codename: value }, false));
  bindValue("#fieldProductTier", "change", (value) => updateProduct(product.id, {
    tier: PRODUCT_TIER_OPTIONS.includes(value) ? value : "",
  }, false));
  const bindProductDate = (inputSelector, tbdButtonSelector, fieldName) => {
    const input = $(inputSelector);
    const tbdButton = $(tbdButtonSelector);
    if (!input || !tbdButton) return;

    const syncTbdState = () => {
      const isTbd = !normalizeProductInfoDate(input.value);
      tbdButton.classList.toggle("is-active", isTbd);
      tbdButton.setAttribute("aria-pressed", String(isTbd));
    };

    input.addEventListener("change", () => {
      updateProduct(product.id, { [fieldName]: normalizeProductInfoDate(input.value) }, false);
      syncTbdState();
    });

    tbdButton.addEventListener("click", () => {
      input.value = "";
      updateProduct(product.id, { [fieldName]: "" }, false);
      syncTbdState();
    });

    syncTbdState();
  };

  bindProductDate("#fieldFfsDate", "#fieldFfsDateTbd", "ffsDate");
  bindProductDate("#fieldGlobalAnnouncementDate", "#fieldGlobalAnnouncementDateTbd", "globalAnnouncementDate");
  bindProductDate("#fieldWebReadinessDate", "#fieldWebReadinessDateTbd", "webReadinessDate");
  bindProductDate("#fieldFinalAssetsDate", "#fieldFinalAssetsDateTbd", "finalAssetsDate");

  const categorySelectField = $("#fieldProductCategory");
  const moveCategoryButton = $("#moveProductCategory");
  const syncMoveCategoryButton = () => {
    moveCategoryButton.disabled = !categorySelectField.value || categorySelectField.value === activeCategoryId;
  };
  categorySelectField.addEventListener("change", syncMoveCategoryButton);
  moveCategoryButton.addEventListener("click", () => moveProductToCategory(product.id, categorySelectField.value));
  syncMoveCategoryButton();

  $("#addPartSku").addEventListener("click", () => updatePartSkus(product.id, (items) => [...items, partSku("")], true));
  inspector.querySelectorAll("[data-part-sku-id]").forEach((row) => {
    const partSkuId = row.dataset.partSkuId;
    const input = row.querySelector("[data-part-sku-code]");
    const copyButton = row.querySelector("[data-copy-editor-sku]");
    const removeButton = row.querySelector("[data-remove-part-sku]");

    input.addEventListener("input", () => updatePartSkus(product.id, (items) => items.map((item) => (
      item.id === partSkuId ? { ...item, code: input.value.trim().toUpperCase() } : item
    )), false));

    copyButton.addEventListener("click", async () => {
      const copied = await copyTextToClipboard(input.value);
      const original = copyButton.textContent;
      copyButton.textContent = copied ? "Copied" : "Failed";
      copyButton.classList.toggle("is-copied", copied);
      setTimeout(() => {
        copyButton.textContent = original;
        copyButton.classList.remove("is-copied");
      }, 1100);
    });

    removeButton.addEventListener("click", () => updatePartSkus(product.id, (items) => items.filter((item) => item.id !== partSkuId), true));
  });

  $("#fieldImageUrl").addEventListener("change", async (event) => {
    const value = event.target.value.trim();
    const imageAssetId = value ? createUrlImageAsset(value, product.name) : "";
    await setProductImageAsset(product.id, imageAssetId);
  });
  bindValue("#fieldStatus", "change", (value) => updateProduct(product.id, {
    statusType: ["new", "embargo"].includes(value) ? value : "none",
    statusLabel: standardizedStatus(value).label,
  }, true));
  $("#fieldVariantEnabled").onchange = (event) => updateProduct(product.id, {
    variantLabel: event.target.checked ? (product.variantLabel || "VARIANT") : "",
  }, true);
  bindValue("#fieldVariantLabel", "input", (value) => updateProduct(product.id, { variantLabel: value }, false));
  bindPresetColor($("#fieldVariantColorPreset"), $("#fieldVariantColor"), (value) => updateProduct(product.id, {
    variantColor: value,
    highlightColor: value,
  }, false));
  bindValue("#fieldRoadmapFamily", "input", (value) => updateRoadmap(product.id, { family: value || "Other" }));
  bindValue("#fieldRoadmapStart", "change", (value) => updateRoadmap(product.id, (roadmap) => {
    const startMonth = normalizeMonth(value, roadmap.startMonth);
    return {
      startMonth,
      launchMonth: startMonth,
      endMonth: monthIndex(roadmap.endMonth) < monthIndex(startMonth) ? startMonth : roadmap.endMonth,
    };
  }, true));
  bindValue("#fieldRoadmapEnd", "change", (value) => updateRoadmap(product.id, (roadmap) => {
    const endMonth = normalizeMonth(value, roadmap.endMonth);
    return { endMonth: monthIndex(endMonth) < monthIndex(roadmap.startMonth) ? roadmap.startMonth : endMonth };
  }, true));
  bindValue("#fieldRoadmapStatus", "change", (value) => updateRoadmap(product.id, { status: value }));
  bindValue("#fieldRoadmapConfidence", "change", (value) => updateRoadmap(product.id, { confidence: value }));
  bindValue("#fieldRoadmapPredecessor", "change", (value) => updateRoadmap(product.id, { predecessorId: value }));
  bindValue("#fieldRoadmapSuccessor", "change", (value) => updateRoadmap(product.id, { successorId: value }));
  $("#inspectRoadmapView").onclick = () => { closeInspector(); setView("roadmap", { focusSelected: true }); };
  $("#inspectSplitView").onclick = () => { closeInspector(); setView("split", { focusSelected: true }); };
  $("#fieldImageUpload").onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.disabled = true;
    try {
      const imageAssetId = await createLocalImageAsset(file, product.name);
      await setProductImageAsset(product.id, imageAssetId);
    } catch (error) {
      alert(error.message || "Unable to save the image.");
      event.target.disabled = false;
    }
  };
  if ($("#clearImage")) $("#clearImage").onclick = async () => setProductImageAsset(product.id, "");

  inspector.querySelectorAll("[data-featured-hero]").forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      updateProduct(product.id, { featuredVariantId: radio.dataset.featuredHero || "" }, true);
    });
  });
  inspector.querySelectorAll("[data-hero-editor-id]").forEach((card) => {
    const variantId = card.dataset.heroEditorId;
    const urlInput = card.querySelector("[data-hero-image-url]");
    const uploadInput = card.querySelector("[data-hero-image-upload]");
    const clearButton = card.querySelector("[data-clear-hero-image]");
    if (urlInput) urlInput.addEventListener("change", async () => {
      const value = urlInput.value.trim();
      const imageAssetId = value ? createUrlImageAsset(value, `${product.name} colorway`) : "";
      await setVariantImageAsset(product.id, variantId, imageAssetId);
    });
    if (uploadInput) uploadInput.addEventListener("change", async () => {
      const file = uploadInput.files?.[0];
      uploadInput.value = "";
      if (!file) return;
      try {
        const imageAssetId = await createLocalImageAsset(file, `${product.name} colorway`);
        await setVariantImageAsset(product.id, variantId, imageAssetId);
      } catch (error) {
        alert(error.message || "Unable to store the colorway image.");
      }
    });
    if (clearButton) clearButton.onclick = () => setVariantImageAsset(product.id, variantId, "");
  });
  $("#addSpec").onclick = () => updateProduct(product.id, { specs: [...product.specs, spec("Feature", "Value")] }, true);
  if ($("#addSpecSet")) $("#addSpecSet").onclick = () => {
    const selectedSet = categorySpecSets().find((set) => set.id === $("#specSetSelect")?.value);
    if (!selectedSet) return;
    const existingLabels = new Set(product.specs.map((item) => String(item.label || "").trim().toLowerCase()));
    const additions = selectedSet.specs
      .filter(([label]) => !existingLabels.has(String(label).trim().toLowerCase()))
      .map(([label, value]) => spec(label, value));
    if (!additions.length) {
      alert("This product already contains every field in the selected common set.");
      return;
    }
    updateProduct(product.id, { specs: [...product.specs, ...additions] }, true);
  };
  $("#addVariantGroup").onclick = () => {
    const definition = categoryDefinition();
    updateProductVariantGroups(product.id, (groups) => [...groups, defaultVariantGroupForDefinition(definition)], true);
  };

  inspector.querySelectorAll("[data-variant-group-id]").forEach((groupElement) => {
    const groupId = groupElement.dataset.variantGroupId;
    groupElement.querySelectorAll("[data-variant-group-field]").forEach((input) => {
      const eventName = input.dataset.variantGroupField === "type" ? "change" : "input";
      input.addEventListener(eventName, () => {
        updateProductVariantGroups(product.id, (groups) => groups.map((group) => {
          if (group.id !== groupId) return group;
          if (input.dataset.variantGroupField === "label") return { ...group, label: input.value };
          const nextType = input.value === "layout" ? "layout" : "color";
          if (nextType === group.type) return group;
          const items = group.items.map((item) => nextType === "layout"
            ? normalizeLayoutVariant({ id: item.id, code: item.code, label: item.colorName || item.label })
            : normalizeColorVariant({ id: item.id, code: item.code, colorName: item.label, colorHex: "#777777" }));
          return { ...group, type: nextType, label: nextType === "layout" ? "LAYOUT SKU" : "COLOR SKU", items };
        }), input.dataset.variantGroupField === "type");
      });
    });

    const addButton = groupElement.querySelector("[data-add-variant]");
    if (addButton) addButton.onclick = () => updateProductVariantGroups(product.id, (groups) => groups.map((group) => {
      if (group.id !== groupId) return group;
      const nextItem = group.type === "layout" ? layoutVariant("US", "United States") : colorVariant("BK", "black");
      return { ...group, items: [...group.items, nextItem] };
    }), true);

    const addLayoutSetButton = groupElement.querySelector("[data-add-layout-set]");
    if (addLayoutSetButton) addLayoutSetButton.onclick = () => updateProductVariantGroups(product.id, (groups) => groups.map((group) => {
      if (group.id !== groupId) return group;
      const existingCodes = new Set(group.items.map((item) => String(item.code || "").toUpperCase()));
      const additions = COMMON_KEYBOARD_LAYOUTS
        .filter((preset) => !existingCodes.has(preset.code))
        .map((preset) => layoutVariant(preset.code, preset.label));
      return { ...group, items: [...group.items, ...additions] };
    }), true);

    const removeGroupButton = groupElement.querySelector("[data-remove-variant-group]");
    if (removeGroupButton) removeGroupButton.onclick = () => updateProductVariantGroups(product.id, (groups) => groups.filter((group) => group.id !== groupId), true);

    groupElement.querySelectorAll("[data-variant-item-id]").forEach((itemElement) => {
      const itemId = itemElement.dataset.variantItemId;
      itemElement.querySelectorAll("[data-variant-field]").forEach((input) => {
        input.addEventListener("input", () => {
          updateProductVariantGroups(product.id, (groups) => groups.map((group) => group.id !== groupId ? group : {
            ...group,
            items: group.items.map((item) => item.id === itemId ? { ...item, [input.dataset.variantField]: input.value } : item),
          }), false);
          const preview = itemElement.querySelector(".sku-color-preview");
          if (preview && input.dataset.variantField === "colorHex") preview.style.setProperty("--sku-primary", input.value);
          if (preview && input.dataset.variantField === "colorHex2") preview.style.setProperty("--sku-secondary", input.value);
        });
      });

      const layoutPreset = itemElement.querySelector("[data-layout-preset]");
      if (layoutPreset) layoutPreset.addEventListener("change", () => {
        if (!layoutPreset.value) return;
        if (layoutPreset.value === "custom") {
          itemElement.querySelector('[data-variant-field="code"]')?.focus();
          return;
        }
        const preset = COMMON_KEYBOARD_LAYOUTS.find((item) => item.code === layoutPreset.value);
        if (!preset) return;
        updateProductVariantGroups(product.id, (groups) => groups.map((group) => group.id !== groupId ? group : {
          ...group,
          items: group.items.map((item) => item.id === itemId ? { ...item, code: preset.code, label: preset.label } : item),
        }), true);
      });

      itemElement.querySelectorAll("[data-color-role]").forEach((select) => {
        select.addEventListener("change", () => {
          const role = select.dataset.colorRole;
          updateProductVariantGroups(product.id, (groups) => groups.map((group) => group.id !== groupId ? group : {
            ...group,
            items: group.items.map((item) => {
              if (item.id !== itemId) return item;
              if (role === "primary") {
                const preset = standardColorByKey(select.value);
                if (!preset) return { ...item, colorKey: "custom", colorName: item.colorName || "Custom", colorHex: item.colorHex || "#777777" };
                const replaceCode = !item.code || ["NEW", "SKU"].includes(String(item.code).toUpperCase());
                return { ...item, colorKey: preset.key, colorName: preset.label, colorHex: preset.hex, code: replaceCode ? preset.code : item.code };
              }
              const preset = standardColorByKey(select.value);
              if (!preset) return { ...item, colorKey2: "custom", colorName2: item.colorName2 || "Custom", colorHex2: item.colorHex2 || "#ffffff" };
              return { ...item, colorKey2: preset.key, colorName2: preset.label, colorHex2: preset.hex };
            }),
          }), true);
        });
      });

      const dualToggle = itemElement.querySelector("[data-variant-dual]");
      if (dualToggle) dualToggle.addEventListener("change", () => {
        const white = standardColorByKey("white");
        updateProductVariantGroups(product.id, (groups) => groups.map((group) => group.id !== groupId ? group : {
          ...group,
          items: group.items.map((item) => item.id !== itemId ? item : dualToggle.checked
            ? { ...item, colorKey2: item.colorKey2 || white.key, colorName2: item.colorName2 || white.label, colorHex2: item.colorHex2 || white.hex }
            : { ...item, colorKey2: "", colorName2: "", colorHex2: "" }),
        }), true);
      });

      const removeButton = itemElement.querySelector("[data-remove-variant]");
      if (removeButton) removeButton.onclick = () => updateProductVariantGroups(product.id, (groups) => groups.map((group) => group.id !== groupId ? group : {
        ...group,
        items: group.items.filter((item) => item.id !== itemId),
      }), true);
    });
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

function updatePartSkus(productId, updater, updateInspectorAfter = false) {
  updateBoard((current) => {
    const product = current.products.find((item) => item.id === productId);
    if (!product) return;
    const existing = (Array.isArray(product.partSkus) ? product.partSkus : []).map((item, index) => normalizePartSku(item, index));
    product.partSkus = (updater(existing) || existing).map((item, index) => normalizePartSku(item, index));
  }, { inspector: updateInspectorAfter });
}

function normalizeOrdersForBoard(targetBoard, laneId) {
  targetBoard.products
    .filter((product) => product.laneId === laneId)
    .sort((a, b) => a.order - b.order)
    .forEach((product, index) => { product.order = index; });
}

function moveProductToCategory(productId, targetCategoryId) {
  const sourceCategory = activeCategoryRecord();
  const targetCategory = portfolio.categories.find((category) => category.id === targetCategoryId);
  if (!sourceCategory || !targetCategory || sourceCategory.id === targetCategory.id) return;

  const sourceBoard = board;
  const sourceIndex = sourceBoard.products.findIndex((product) => product.id === productId);
  if (sourceIndex < 0) return;

  const [product] = sourceBoard.products.splice(sourceIndex, 1);
  normalizeOrdersForBoard(sourceBoard, product.laneId);

  const targetDefinition = categoryDefinition(targetCategory.id);
  const targetBoard = ensureBoardSchema(targetCategory.board, targetDefinition);
  targetCategory.board = targetBoard;
  const targetLaneId = [...targetBoard.lanes].sort((a, b) => a.order - b.order)[0]?.id || "default";

  product.laneId = targetLaneId;
  product.order = targetBoard.products.filter((item) => item.laneId === targetLaneId).length;
  targetBoard.products.push(product);

  scheduleSave();
  activateCategory(targetCategory.id, { render: false, fitVertical: true });
  selectedId = product.id;
  inspectorOpen = true;
  syncControls();
  renderInspector();
  renderActiveView();
  requestAnimationFrame(revealSelectedProductBesideInspector);
}

function updateRoadmap(productId, updater, updateInspectorAfter = false) {
  updateBoard((current) => {
    const product = current.products.find((item) => item.id === productId);
    if (!product) return;
    const patch = typeof updater === "function" ? updater({ ...product.roadmap }) : updater;
    product.roadmap = { ...product.roadmap, ...patch };
    if (monthIndex(product.roadmap.endMonth) < monthIndex(product.roadmap.startMonth)) product.roadmap.endMonth = product.roadmap.startMonth;
    product.roadmap.launchMonth = product.roadmap.startMonth;
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
  closePopupMenus();
  const definition = categoryDefinition();
  const laneId = sortedLanes()[0]?.id || "default";
  const product = makeProduct(id(), `New ${definition.itemName}`, null, laneId, board.products.filter((item) => item.laneId === laneId).length, {
    statusType: "new",
    roadmap: makeRoadmap("Other", monthStringFromDate(), monthStringFromDate(), addMonths(monthStringFromDate(), 18), "in-planning", "medium"),
    specs: definition.defaultSpecs.map(([label, value]) => spec(label, value)),
    variantGroups: [defaultVariantGroupForDefinition(definition)],
  });
  updateBoard((current) => current.products.push(product), { inspector: true });
  selectedId = product.id;
  openInspector();
  renderActiveView();
}

async function deleteSelected() {
  if (!selectedId || !confirm("Delete this product card?")) return;
  const deleting = board.products.find((item) => item.id === selectedId);
  const imageAssetIds = new Set([deleting?.imageAssetId, ...productColorVariants(deleting).map((item) => item.imageAssetId)].filter(Boolean));
  updateBoard((current) => {
    const product = current.products.find((item) => item.id === selectedId);
    current.products = current.products.filter((item) => item.id !== selectedId);
    if (product) normalizeLaneOrders(product.laneId);
  });
  selectedId = board.products[0]?.id ?? null;
  pinnedHeroVariantByProduct.delete(deleting?.id);
  imageAssetIds.forEach((assetId) => { void removeImageAssetIfUnused(assetId); });
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
        if (mode === "sku-count") return productVariantCount(b) - productVariantCount(a) || a.name.localeCompare(b.name);
        return a.order - b.order;
      });
      products.forEach((product, index) => { product.order = index; delete product.manualPosition; });
    });
    current.settings.freeMove = false;
  });
}

function syncControls() {
  $("#boardTitle").textContent = board.title;
  categorySelect.innerHTML = portfolio.categories.map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === activeCategoryId ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("");
  editSelectedButton.disabled = !selectedProduct();
  updateProductLayoutEditControls();
  $("#showPrices").checked = board.settings.showPrices;
  $("#showSkus").checked = board.settings.showSkus;
  $("#fullSingleLaneSpecs").checked = board.settings.fullSingleLaneSpecs !== false;
  $("#fullSingleLaneSpecs").disabled = !(sortedLanes().length === 1 || categoryDefinition().fullSpecCards === true);
  $("#roadmapStart").value = board.settings.roadmap.startMonth;
  $("#roadmapEnd").value = board.settings.roadmap.endMonth;
  $("#roadmapSnap").value = board.settings.roadmap.snap;
  $("#roadmapShowMsrp").checked = portfolio.settings?.showRoadmapMsrp === true;
  $("#roadmapColorLaunched").value = board.settings.roadmap.statusColors.launched;
  $("#roadmapColorDevelopment").value = board.settings.roadmap.statusColors["in-development"];
  $("#roadmapColorPlanning").value = board.settings.roadmap.statusColors["in-planning"];
  syncColorPresetSelect($("#roadmapColorLaunchedPreset"), board.settings.roadmap.statusColors.launched);
  syncColorPresetSelect($("#roadmapColorDevelopmentPreset"), board.settings.roadmap.statusColors["in-development"]);
  syncColorPresetSelect($("#roadmapColorPlanningPreset"), board.settings.roadmap.statusColors["in-planning"]);
  const roadmapMonths = roadmapRange().count;
  document.querySelectorAll("[data-roadmap-years]").forEach((button) => {
    button.classList.toggle("is-active", roadmapMonths === Number(button.dataset.roadmapYears) * 12);
  });
  updateLinkedViewButton();
  updateRoadmapEditControls();
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

function hitVariantOverflow(point) {
  return [...renderedVariantOverflow].reverse().find((region) => point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height);
}

function hitHeroVariant(point) {
  return [...renderedHeroVariantRegions].reverse().find((region) => point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height);
}

function hitInfoButton(point) {
  return [...renderedInfoButtons].reverse().find((region) => point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height);
}

canvas.addEventListener("pointerdown", (event) => {
  const point = canvasPoint(event);
  const infoButton = hitInfoButton(point);
  if (infoButton) {
    event.preventDefault();
    event.stopPropagation();
    openViewerInfo(infoButton.productId);
    return;
  }
  const heroVariant = hitHeroVariant(point);
  if (heroVariant) {
    event.preventDefault();
    event.stopPropagation();
    selectedId = heroVariant.productId;
    togglePinnedHeroVariant(heroVariant.productId, heroVariant.variantId);
    renderInspector();
    return;
  }
  const variantOverflow = hitVariantOverflow(point);
  if (variantOverflow) {
    event.preventDefault();
    event.stopPropagation();
    if (variantPopoverPinned && variantPopoverKey === variantOverflow.key) {
      closeVariantPopover({ force: true });
    } else {
      selectedId = variantOverflow.productId;
      renderInspector();
      renderBoard();
      openVariantPopover(variantOverflow, event.clientX, event.clientY, { pinned: true });
    }
    return;
  }
  const overflow = hitSpecOverflow(point);
  if (overflow) {
    event.preventDefault();
    event.stopPropagation();
    openSpecPopover(overflow.productId, event.clientX, event.clientY);
    return;
  }
  closeSpecPopover();
  closeVariantPopover({ force: true });
  const card = hitCard(point);
  if (!card) {
    panState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: canvasScroll.scrollLeft,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
    canvasScroll.classList.add("is-panning");
    return;
  }
  // When the information drawer is already open, selecting another card
  // retargets the drawer to that product. This keeps selection ownership and
  // the combined outline on one product instead of leaving the old drawer
  // attached while a second card receives a selection border.
  if (viewerInfoProductId && viewerInfoProgress > .001 && viewerInfoProductId !== card.productId) {
    openViewerInfo(card.productId);
  } else {
    selectedId = card.productId;
    renderInspector();
  }

  stopRoadmapSlotEditing();
  const product = selectedProduct();
  if (productLayoutEditing) {
    dragState = { productId: card.productId, offsetX: point.x - card.x, offsetY: point.y - card.y, position: { x: card.x, y: card.y } };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  } else {
    panState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: canvasScroll.scrollLeft,
      moved: false,
      cardProductId: card.productId,
    };
    canvas.setPointerCapture(event.pointerId);
    canvasScroll.classList.add("is-panning");
  }
  if (product) renderBoard();
});

canvas.addEventListener("pointermove", (event) => {
  if (panState) {
    const deltaX = event.clientX - panState.startX;
    const deltaY = event.clientY - panState.startY;
    if (!panState.moved && Math.hypot(deltaX, deltaY) >= 5) panState.moved = true;
    canvasScroll.scrollLeft = panState.scrollLeft - deltaX;
    return;
  }

  if (!dragState) {
    const point = canvasPoint(event);
    const heroVariant = hitHeroVariant(point);
    if (heroVariant) setHoveredHeroVariant(heroVariant.productId, heroVariant.variantId);
    else if (hoveredHeroVariant) setHoveredHeroVariant();
    const variantOverflow = hitVariantOverflow(point);
    if (variantOverflow) scheduleVariantPopoverOpen(variantOverflow, event.clientX, event.clientY);
    else scheduleVariantPopoverClose();
    const infoButton = hitInfoButton(point);
    const nextInfoHoverId = infoButton?.productId || "";
    if (nextInfoHoverId !== hoveredInfoButtonProductId) {
      hoveredInfoButtonProductId = nextInfoHoverId;
      renderBoard();
      return;
    }
    const card = hitCard(point);
    canvas.style.cursor = heroVariant || variantOverflow || infoButton || hitSpecOverflow(point)
      ? "pointer"
      : productLayoutEditing && card
        ? "move"
        : "grab";
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

canvas.addEventListener("pointerleave", () => {
  scheduleVariantPopoverClose();
  if (hoveredInfoButtonProductId) {
    hoveredInfoButtonProductId = "";
    renderBoard();
  }
  if (hoveredHeroVariant) setHoveredHeroVariant();
});

function finishDrag(event) {
  if (panState) {
    const wasClick = !panState.moved;
    const cardProductId = panState.cardProductId || "";
    panState = null;
    canvasScroll.classList.remove("is-panning");
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    syncBoardNavigator();
    if (wasClick && !cardProductId) clearSelection();
    return;
  }
  if (!dragState) return;
  const current = dragState;
  dragState = null;
  canvas.style.cursor = "grab";
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  const lanes = sortedLanes();
  const layout = productCardLayout();
  const laneIndex = Math.max(0, Math.min(lanes.length - 1, Math.round((current.position.y - LANE_TOP) / layout.laneHeight)));
  const targetIndex = Math.max(0, Math.round((current.position.x - GUTTER) / (CARD_WIDTH + CARD_GAP)));
  reorderProduct(current.productId, lanes[laneIndex].id, targetIndex);
}
canvas.addEventListener("pointerup", finishDrag);
canvas.addEventListener("pointercancel", finishDrag);
canvas.addEventListener("dblclick", (event) => {
  const point = canvasPoint(event);
  if (hitSpecOverflow(point) || hitVariantOverflow(point) || hitHeroVariant(point) || hitInfoButton(point)) return;
  const card = hitCard(point);
  if (!card) return;
  selectedId = card.productId;
  closeInspector();
  setView("roadmap", { focusSelected: true });
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

function clonePortfolioData() {
  return JSON.parse(JSON.stringify(portfolio));
}

let crc32Table = null;
function crc32(bytes) {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      crc32Table[index] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => { output.set(chunk, offset); offset += chunk.length; });
  return output;
}

function zipLocalHeader(nameBytes, dataBytes, checksum) {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, dataBytes.length, true);
  view.setUint32(22, dataBytes.length, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  header.set(nameBytes, 30);
  return header;
}

function zipCentralHeader(nameBytes, dataBytes, checksum, localOffset) {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, checksum, true);
  view.setUint32(20, dataBytes.length, true);
  view.setUint32(24, dataBytes.length, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localOffset, true);
  header.set(nameBytes, 46);
  return header;
}

function createStoredZip(entries) {
  const encoder = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;
  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const checksum = crc32(dataBytes);
    const localHeader = zipLocalHeader(nameBytes, dataBytes, checksum);
    localChunks.push(localHeader, dataBytes);
    centralChunks.push(zipCentralHeader(nameBytes, dataBytes, checksum, localOffset));
    localOffset += localHeader.length + dataBytes.length;
  });
  const centralDirectory = concatBytes(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);
  return concatBytes([...localChunks, centralDirectory, end]);
}

function findZipEnd(bytes) {
  const minimum = Math.max(0, bytes.length - 65557);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

function readStoredZip(bytes) {
  const output = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findZipEnd(bytes);
  if (endOffset < 0) throw new Error("This is not a supported project package.");
  const entryCount = view.getUint16(endOffset + 10, true);
  let centralOffset = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder();
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error("The project package directory is damaged.");
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = decoder.decode(bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength));
    if (method !== 0) throw new Error("The project package uses an unsupported compression method.");
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("The project package contains a damaged image entry.");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    output.set(name, bytes.slice(dataOffset, dataOffset + compressedSize));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return output;
}

async function exportProjectPackage() {
  closePopupMenus();
  const manifest = clonePortfolioData();
  const entries = [];
  const missingAssets = [];
  for (const asset of manifest.imageAssets || []) {
    if (asset.sourceType !== "local") continue;
    const sourceAsset = imageAssetById(asset.id);
    const blob = await imageStoreGet(asset.id).catch(() => null);
    if (!blob) {
      missingAssets.push(asset.name || asset.id);
      continue;
    }
    const packagePath = `images/${asset.id}.${extensionForImageAsset(sourceAsset || asset)}`;
    asset.packagePath = packagePath;
    entries.push({ name: packagePath, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  entries.unshift({
    name: "portfolio.json",
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  });
  const zipBytes = createStoredZip(entries);
  downloadBlob(new Blob([zipBytes], { type: "application/octet-stream" }), "product-portfolio-project.pkg");
  if (missingAssets.length) alert(`The package was exported, but ${missingAssets.length} local image asset(s) were unavailable in this browser and could not be included.`);
}

async function importProjectPackage(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = readStoredZip(bytes);
  const manifestBytes = entries.get("portfolio.json");
  if (!manifestBytes) throw new Error("The project package is missing portfolio.json.");
  const parsed = JSON.parse(new TextDecoder().decode(manifestBytes));
  const normalized = ensurePortfolioSchema(parsed);
  await imageStoreClear();
  imageAssetUrlCache.forEach((url) => URL.revokeObjectURL(url));
  imageAssetUrlCache.clear();
  imageAssetLoadPromises.clear();
  missingImageAssetIds.clear();
  for (const asset of normalized.imageAssets) {
    if (asset.sourceType !== "local") continue;
    const packagePath = asset.packagePath || `images/${asset.id}.${extensionForImageAsset(asset)}`;
    const imageBytes = entries.get(packagePath);
    if (imageBytes) await imageStorePut(asset.id, new Blob([imageBytes], { type: asset.mimeType || "application/octet-stream" }));
    delete asset.packagePath;
  }
  portfolio = normalized;
  activateCategory(portfolio.activeCategoryId, { fitVertical: true });
}


function waitForImageSource(src, timeoutMs = 7000) {
  if (!src) return Promise.resolve();
  const record = loadImage(src);
  if (record.ready || record.failed) return Promise.resolve();
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      record.image.removeEventListener("load", finish);
      record.image.removeEventListener("error", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    record.image.addEventListener("load", finish, { once: true });
    record.image.addEventListener("error", finish, { once: true });
  });
}

async function preloadCategoryImagesForPptx(products) {
  const assetIds = [...new Set(products.map((product) => productDisplayImageAssetId(product)).filter(Boolean))];
  assetIds.forEach((assetId) => loadLocalImageAsset(assetId));
  const localLoads = assetIds.map((assetId) => imageAssetLoadPromises.get(assetId)).filter(Boolean);
  if (localLoads.length) await Promise.allSettled(localLoads);
  await Promise.allSettled(products.map((product) => waitForImageSource(productImageSource(product))));
}

async function renderCategoryImageForPptx(category) {
  const previous = {
    activeCategoryId,
    board,
    selectedId,
    searchQuery,
    roadmapSearchQuery,
    inspectorOpen,
    viewerInfoOpen,
    viewerInfoProductId,
  };

  try {
    activeCategoryId = category.id;
    board = ensureBoardSchema(category.board, categoryDefinition(category.id));
    category.board = board;
    selectedId = null;
    searchQuery = "";
    roadmapSearchQuery = "";
    inspectorOpen = false;
    viewerInfoOpen = false;
    viewerInfoProductId = null;

    await preloadCategoryImagesForPptx(board.products);
    const dimensions = getCanvasDimensions();
    const exportCanvas = document.createElement("canvas");
    const maxPixelWidth = 2800;
    const scale = Math.min(1, maxPixelWidth / dimensions.width);
    exportCanvas.width = Math.max(1, Math.round(dimensions.width * scale));
    exportCanvas.height = Math.max(1, Math.round(dimensions.height * scale));
    const exportContext = exportCanvas.getContext("2d");
    exportContext.setTransform(scale, 0, 0, scale, 0, 0);
    exportContext.imageSmoothingEnabled = true;
    exportContext.imageSmoothingQuality = "high";
    drawBoardTo(exportContext, dimensions, false, true);
    return {
      data: exportCanvas.toDataURL("image/jpeg", .9),
      width: exportCanvas.width,
      height: exportCanvas.height,
    };
  } finally {
    activeCategoryId = previous.activeCategoryId;
    board = previous.board;
    selectedId = previous.selectedId;
    searchQuery = previous.searchQuery;
    roadmapSearchQuery = previous.roadmapSearchQuery;
    inspectorOpen = previous.inspectorOpen;
    viewerInfoOpen = previous.viewerInfoOpen;
    viewerInfoProductId = previous.viewerInfoProductId;
  }
}

async function renderCategoryRoadmapImageForPptx(category) {
  const previous = {
    activeCategoryId,
    board,
    selectedId,
    searchQuery,
    roadmapSearchQuery,
    inspectorOpen,
    viewerInfoOpen,
    viewerInfoProductId,
    viewerInfoProgress,
    roadmapMonthWidth,
  };

  try {
    activeCategoryId = category.id;
    board = ensureBoardSchema(category.board, categoryDefinition(category.id));
    category.board = board;
    selectedId = null;
    searchQuery = "";
    roadmapSearchQuery = "";
    inspectorOpen = false;
    viewerInfoOpen = false;
    viewerInfoProductId = null;
    viewerInfoProgress = 0;

    // Keep the configured timeline range, but choose a month width that
    // produces a readable export without generating an excessively wide image.
    const range = roadmapRange();
    const targetPixelWidth = 2600;
    roadmapMonthWidth = Math.max(
      ROADMAP_MIN_MONTH_WIDTH,
      Math.min(64, Math.floor((targetPixelWidth - ROADMAP_LEFT_WIDTH - 24) / Math.max(1, range.count))),
    );

    const dimensions = roadmapDimensions();
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.max(1, Math.round(dimensions.width));
    exportCanvas.height = Math.max(1, Math.round(dimensions.height));

    const exportContext = exportCanvas.getContext("2d");
    exportContext.imageSmoothingEnabled = true;
    exportContext.imageSmoothingQuality = "high";
    drawRoadmapTo(
      exportContext,
      dimensions,
      exportCanvas,
      { scrollLeft: 0, scrollTop: 0 },
      false,
      true,
    );

    return {
      data: exportCanvas.toDataURL("image/jpeg", .92),
      width: exportCanvas.width,
      height: exportCanvas.height,
    };
  } finally {
    activeCategoryId = previous.activeCategoryId;
    board = previous.board;
    selectedId = previous.selectedId;
    searchQuery = previous.searchQuery;
    roadmapSearchQuery = previous.roadmapSearchQuery;
    inspectorOpen = previous.inspectorOpen;
    viewerInfoOpen = previous.viewerInfoOpen;
    viewerInfoProductId = previous.viewerInfoProductId;
    viewerInfoProgress = previous.viewerInfoProgress;
    roadmapMonthWidth = previous.roadmapMonthWidth;
  }
}

function addPptxPortfolioSlide(pptx, title, slideNumber, slideCount, image) {
  const slide = pptx.addSlide();
  slide.background = { color: "151715" };
  slide.addText(title, {
    x: .38, y: .16, w: 11.9, h: .38,
    fontFace: "Arial", fontSize: 20, bold: true,
    color: "F0F2F0", margin: 0, breakLine: false,
  });
  slide.addText(`${slideNumber} / ${slideCount}`, {
    x: .38, y: .5, w: 1.4, h: .16,
    fontFace: "Arial", fontSize: 8, color: "7F857F",
    align: "left", margin: 0,
  });
  slide.addShape(pptx.ShapeType.line, {
    x: .38, y: .7, w: 12.55, h: 0,
    line: { color: "343834", width: 1 },
  });
  const placement = containRect(image.width, image.height, .38, .82, 12.55, 6.25, "left");
  slide.addImage({ data: image.data, ...placement });
}

function containRect(sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight, align = "center") {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: align === "left" ? targetX : targetX + (targetWidth - width) / 2,
    y: align === "left" ? targetY : targetY + (targetHeight - height) / 2,
    w: width,
    h: height,
  };
}

function pptxExportScope() {
  return pptxExportForm?.querySelector('input[name="pptxExportScope"]:checked')?.value || "both";
}

function pptxSlideCountForScope(scope, categoryCount) {
  return categoryCount * (scope === "both" ? 2 : 1);
}

function syncPptxExportSummary() {
  if (!pptxExportDialog) return;
  const categoryCount = (portfolio?.categories || []).filter((category) => category?.board).length;
  const scope = pptxExportScope();
  $("#pptxExportCategoryCount").textContent = String(categoryCount);
  $("#pptxExportSlideCount").textContent = String(pptxSlideCountForScope(scope, categoryCount));
}

function openPptxExportDialog() {
  closePopupMenus();
  syncPptxExportSummary();
  pptxExportDialog.classList.remove("hidden");
  requestAnimationFrame(() => {
    const selected = pptxExportForm.querySelector('input[name="pptxExportScope"]:checked');
    selected?.focus();
  });
}

function closePptxExportDialog() {
  if (confirmPptxExportButton?.disabled) return;
  pptxExportDialog.classList.add("hidden");
}

function pptxExportFilename(scope) {
  if (scope === "products") return "product-portfolio.pptx";
  if (scope === "roadmap") return "product-roadmaps.pptx";
  return "product-portfolio-and-roadmaps.pptx";
}

async function exportPptx(scope = "both") {
  closePopupMenus();
  if (typeof PptxGenJS !== "function") throw new Error("The PowerPoint export library did not load. Refresh the page and try again.");
  const categories = (portfolio?.categories || []).filter((category) => category?.board);
  if (!categories.length) throw new Error("There are no categories to export.");

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Product Portfolio Canvas";
  pptx.company = "Product Portfolio";
  pptx.subject = scope === "products"
    ? "Product category portfolio boards"
    : scope === "roadmap"
      ? "Product category roadmaps"
      : "Product category portfolio boards and roadmaps";
  pptx.title = scope === "products"
    ? "Product Portfolio"
    : scope === "roadmap"
      ? "Product Roadmaps"
      : "Product Portfolio and Roadmaps";
  pptx.lang = "en-US";

  const slideCount = pptxSlideCountForScope(scope, categories.length);
  let slideNumber = 1;

  for (let index = 0; index < categories.length; index += 1) {
    const category = categories[index];
    const categoryName = category.name || category.id || `Category ${index + 1}`;

    if (scope === "products" || scope === "both") {
      const productImage = await renderCategoryImageForPptx(category);
      addPptxPortfolioSlide(
        pptx,
        `${categoryName} — Product Portfolio`,
        slideNumber,
        slideCount,
        productImage,
      );
      slideNumber += 1;
    }

    if (scope === "roadmap" || scope === "both") {
      const roadmapImage = await renderCategoryRoadmapImageForPptx(category);
      addPptxPortfolioSlide(
        pptx,
        `${categoryName} — Roadmap`,
        slideNumber,
        slideCount,
        roadmapImage,
      );
      slideNumber += 1;
    }
  }

  await pptx.writeFile({ fileName: pptxExportFilename(scope) });
  renderActiveView();
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
    drawBoardTo(exportContext, dimensions, false, true);
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

function renderLaneSettingsEditor() {
  if (!laneSettingsList) return;
  laneSettingsList.innerHTML = categorySettingsDraftLanes.map((lane, index) => `
    <div class="lane-setting-row" data-lane-index="${index}">
      <div class="lane-setting-fields">
        <label>Lane label<input data-lane-field="label" value="${escapeHtml(lane.label)}" placeholder="WIRED"></label>
        <label>Subtitle<input data-lane-field="subtitle" value="${escapeHtml(lane.subtitle || "")}" placeholder="GAMING HEADSET"></label>
      </div>
      <div class="lane-setting-actions">
        <button type="button" data-lane-move="up" aria-label="Move lane up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-lane-move="down" aria-label="Move lane down" ${index === categorySettingsDraftLanes.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" data-lane-remove class="danger-button" aria-label="Remove lane" ${categorySettingsDraftLanes.length <= 1 ? "disabled" : ""}>×</button>
      </div>
    </div>`).join("");

  laneSettingsList.querySelectorAll("[data-lane-index]").forEach((row) => {
    const index = Number(row.dataset.laneIndex);
    row.querySelectorAll("[data-lane-field]").forEach((input) => {
      input.addEventListener("input", () => { categorySettingsDraftLanes[index][input.dataset.laneField] = input.value; });
    });
    row.querySelector('[data-lane-move="up"]')?.addEventListener("click", () => {
      if (index <= 0) return;
      [categorySettingsDraftLanes[index - 1], categorySettingsDraftLanes[index]] = [categorySettingsDraftLanes[index], categorySettingsDraftLanes[index - 1]];
      renderLaneSettingsEditor();
    });
    row.querySelector('[data-lane-move="down"]')?.addEventListener("click", () => {
      if (index >= categorySettingsDraftLanes.length - 1) return;
      [categorySettingsDraftLanes[index + 1], categorySettingsDraftLanes[index]] = [categorySettingsDraftLanes[index], categorySettingsDraftLanes[index + 1]];
      renderLaneSettingsEditor();
    });
    row.querySelector("[data-lane-remove]")?.addEventListener("click", () => {
      if (categorySettingsDraftLanes.length <= 1) return;
      categorySettingsDraftLanes.splice(index, 1);
      renderLaneSettingsEditor();
    });
  });
}

function openCategorySettings() {
  closePopupMenus();
  const category = activeCategoryRecord();
  if (!category) return;
  $("#settingsCategoryName").value = category.name;
  $("#settingsBoardTitle").value = board.title;
  $("#settingsRoadmapLabel").value = board.settings.roadmap.categoryLabel;
  categorySettingsDraftLanes = sortedLanes().map((lane) => ({ ...lane }));
  renderLaneSettingsEditor();
  categorySettingsDialog.classList.remove("hidden");
  requestAnimationFrame(() => $("#settingsBoardTitle").focus());
}

function closeCategorySettings() {
  categorySettingsDialog.classList.add("hidden");
}

function saveCategorySettings() {
  const category = activeCategoryRecord();
  if (!category) return;
  const categoryName = $("#settingsCategoryName").value.trim();
  const boardTitle = $("#settingsBoardTitle").value.trim();
  const roadmapLabel = $("#settingsRoadmapLabel").value.trim();
  const lanes = categorySettingsDraftLanes
    .map((lane, order) => ({
      id: String(lane.id || `lane-${id()}`),
      label: String(lane.label || `LANE ${order + 1}`).trim() || `LANE ${order + 1}`,
      subtitle: String(lane.subtitle || "").trim(),
      order,
    }));
  if (!categoryName || !boardTitle || !roadmapLabel || !lanes.length) return;
  const validLaneIds = new Set(lanes.map((lane) => lane.id));
  const fallbackLaneId = lanes[0].id;
  category.name = categoryName;
  board.title = boardTitle;
  board.settings.roadmap.categoryLabel = roadmapLabel;
  board.lanes = lanes;
  board.products.forEach((product) => {
    if (!validLaneIds.has(product.laneId)) product.laneId = fallbackLaneId;
  });
  lanes.forEach((lane) => normalizeLaneOrders(lane.id));
  scheduleSave();
  closeCategorySettings();
  syncControls();
  renderInspector();
  renderActiveView();
  requestAnimationFrame(fitProductLanesVertically);
}

function parsePortfolioImportText(rawText) {
  let source = String(rawText || "").trim();
  if (!source) throw new Error("The selected data file is empty.");

  // Allow the categories-only catalog-data.js baseline to be imported directly.
  const catalogAssignment = source.match(/^window\.PORTFOLIO_CATALOG\s*=\s*([\s\S]*?)\s*;?\s*$/);
  if (catalogAssignment) source = catalogAssignment[1];

  try {
    return JSON.parse(source);
  } catch (_) {
    throw new Error("Unable to read this file. Import a .data/.json workspace, or a catalog-data.js file containing window.PORTFOLIO_CATALOG.");
  }
}

function emptyBoardFromCatalogCategory(category, definition) {
  const lanes = Array.isArray(category?.lanes) && category.lanes.length
    ? category.lanes.map((lane, order) => ({ ...lane, order }))
    : definition.lanes.map((lane, order) => ({ ...lane, order }));
  return ensureBoardSchema({
    version: 1,
    title: category?.boardTitle || definition.boardTitle,
    lanes,
    products: [],
    settings: {
      showPrices: true,
      showSkus: true,
      fullSingleLaneSpecs: true,
      freeMove: false,
      roadmap: {
        categoryLabel: category?.categoryLabel || definition.categoryLabel,
        familyOrder: Array.isArray(category?.familyOrder) ? [...category.familyOrder] : [...definition.familyOrder],
      },
    },
  }, definition);
}

function portfolioFromCatalogImport(parsed) {
  if (!Array.isArray(parsed?.categories)) throw new Error("The catalog file does not contain categories.");
  const categories = CATEGORY_DEFINITIONS.map((definition) => {
    const imported = parsed.categories.find((category) => category?.id === definition.id);
    return {
      id: definition.id,
      name: String(imported?.name || definition.name),
      board: emptyBoardFromCatalogCategory(imported, definition),
    };
  });
  return {
    version: 4,
    activeCategoryId: categories[0]?.id || "",
    imageAssets: [],
    categories,
  };
}

function normalizeImportedPortfolio(parsed) {
  if ([4, 3, 2].includes(parsed?.version) && Array.isArray(parsed.categories)) {
    const hasWorkspaceBoards = parsed.categories.some((category) => category && category.board);
    return hasWorkspaceBoards
      ? ensurePortfolioSchema(parsed)
      : ensurePortfolioSchema(portfolioFromCatalogImport(parsed));
  }
  if (parsed?.version === 1 && Array.isArray(parsed.categories)) {
    return ensurePortfolioSchema(portfolioFromCatalogImport(parsed));
  }
  if (parsed?.version === 1 && Array.isArray(parsed.products) && Array.isArray(parsed.lanes)) {
    const migrated = createDefaultPortfolio();
    const category = migrated.categories.find((item) => item.id === activeCategoryId) || migrated.categories[0];
    if (!category) throw new Error("No category is available for the legacy board import.");
    category.board = ensureBoardSchema(parsed, categoryDefinition(category.id));
    migrated.activeCategoryId = category.id;
    migrateLegacyProductImages(migrated);
    return migrated;
  }
  throw new Error("Unsupported portfolio file. Use Export data (.data), Export full project (.pkg), or a categories-only catalog-data.js baseline.");
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parsePortfolioImportText(reader.result);
      portfolio = normalizeImportedPortfolio(parsed);
      selectedId = null;
      activateCategory(portfolio.activeCategoryId, { fitVertical: true });
      flushPendingLegacyImages();
    } catch (error) {
      console.error("Portfolio import failed:", error);
      alert(error.message || "Unable to import portfolio file.");
    }
  };
  reader.onerror = () => alert("Unable to read the selected portfolio file.");
  reader.readAsText(file);
}

canvasScroll.addEventListener("scroll", () => { syncBoardNavigator(); syncLaneRail(); }, { passive: true });
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
$("#categorySettings").onclick = openCategorySettings;
categorySelect.onchange = (event) => activateCategory(event.target.value, { fitVertical: true });
categorySettingsForm.onsubmit = (event) => { event.preventDefault(); saveCategorySettings(); };
$("#closeCategorySettings").onclick = closeCategorySettings;
$("#cancelCategorySettings").onclick = closeCategorySettings;
$("#addLaneSetting").onclick = () => {
  categorySettingsDraftLanes.push({ id: `lane-${id()}`, label: `LANE ${categorySettingsDraftLanes.length + 1}`, subtitle: "", order: categorySettingsDraftLanes.length });
  renderLaneSettingsEditor();
};
categorySettingsDialog.addEventListener("pointerdown", (event) => {
  if (event.target === categorySettingsDialog) closeCategorySettings();
});
$("#editSelected").onclick = () => { closePopupMenus(); openInspector(); };
productLayoutEditButton.onclick = () => {
  productLayoutEditing = !productLayoutEditing;
  closePopupMenus();
  updateProductLayoutEditControls();
  renderBoard();
};
$("#applySort").onclick = applySort;
dataMenuButton.onclick = (event) => { event.stopPropagation(); togglePopupMenu(dataMenuButton, dataMenu); };
roadmapMenuButton.onclick = (event) => { event.stopPropagation(); togglePopupMenu(roadmapMenuButton, roadmapMenu); };
productMenuButton.onclick = (event) => { event.stopPropagation(); togglePopupMenu(productMenuButton, productMenu); };
dataMenu.addEventListener("click", (event) => event.stopPropagation());
roadmapMenu.addEventListener("click", (event) => event.stopPropagation());
productMenu.addEventListener("click", (event) => event.stopPropagation());
$("#importPackage").onclick = () => { closePopupMenus(); $("#importPackageFile").click(); };
$("#importPackageFile").onchange = async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try { await importProjectPackage(file); }
  catch (error) { alert(error.message || "Unable to import the project package."); }
};
$("#exportPackage").onclick = async () => {
  try { await exportProjectPackage(); }
  catch (error) { alert(error.message || "Unable to export the project package."); }
};
$("#importJson").onclick = () => { closePopupMenus(); $("#importFile").click(); };
$("#importFile").onchange = (event) => { const file = event.target.files?.[0]; if (file) importJson(file); event.target.value = ""; };
$("#exportJson").onclick = () => { closePopupMenus(); downloadBlob(new Blob([JSON.stringify(portfolio, null, 2)], { type: "application/json" }), "product-portfolio-data.data"); };
$("#exportPng").onclick = () => { closePopupMenus(); exportPng(); };
$("#exportPptx").addEventListener("click", openPptxExportDialog);
pptxExportForm.addEventListener("change", syncPptxExportSummary);
pptxExportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const scope = pptxExportScope();
  const originalText = confirmPptxExportButton.textContent;
  confirmPptxExportButton.disabled = true;
  confirmPptxExportButton.textContent = "Exporting…";
  try {
    await exportPptx(scope);
    pptxExportDialog.classList.add("hidden");
  } catch (error) {
    console.error(error);
    alert(error.message || "Could not export PPTX.");
  } finally {
    confirmPptxExportButton.disabled = false;
    confirmPptxExportButton.textContent = originalText;
  }
});
$("#closePptxExport").onclick = closePptxExportDialog;
$("#cancelPptxExport").onclick = closePptxExportDialog;
pptxExportDialog.addEventListener("pointerdown", (event) => {
  if (event.target === pptxExportDialog) closePptxExportDialog();
});
$("#searchInput").oninput = (event) => { searchQuery = event.target.value; renderBoard(); };
$("#showPrices").onchange = (event) => updateBoard((current) => { current.settings.showPrices = event.target.checked; });
$("#showSkus").onchange = (event) => updateBoard((current) => { current.settings.showSkus = event.target.checked; });
$("#fullSingleLaneSpecs").onchange = (event) => {
  updateBoard((current) => { current.settings.fullSingleLaneSpecs = event.target.checked; });
  requestAnimationFrame(fitProductLanesVertically);
};
$("#resetLayout").onclick = () => {
  zoom = 1;
  closePopupMenus();
  updateBoard((current) => { current.products.forEach((product) => delete product.manualPosition); current.settings.freeMove = false; current.lanes.forEach((lane) => normalizeLaneOrders(lane.id)); });
};
$("#fitProducts").onclick = () => { closePopupMenus(); fitProductBoard(); };
$("#zoomOut").onclick = () => { zoom = Math.max(PRODUCT_MIN_ZOOM, Number((zoom - .1).toFixed(2))); renderBoard(); };
$("#zoomReset").onclick = () => { zoom = 1; renderBoard(); };
$("#zoomIn").onclick = () => { zoom = Math.min(PRODUCT_MAX_ZOOM, Number((zoom + .1).toFixed(2))); renderBoard(); };
$("#restoreSample").onclick = async () => {
  closePopupMenus();
  if (!confirm("Replace all categories with the complete reference catalog and category templates? Uploaded image assets in this browser will also be removed.")) return;
  try { await imageStoreClear(); } catch (_) {}
  imageAssetUrlCache.forEach((url) => URL.revokeObjectURL(url));
  imageAssetUrlCache.clear();
  imageAssetLoadPromises.clear();
  missingImageAssetIds.clear();
  portfolio = createDefaultPortfolio();
  activateCategory(portfolio.activeCategoryId, { fitVertical: true });
};

document.querySelectorAll(".view-tab").forEach((button) => {
  button.onclick = () => setView(button.dataset.view, { focusSelected: true });
});
linkedViewButton.onclick = () => {
  if (activeView === "products") setView("roadmap", { focusSelected: true });
  else setView("products", { focusSelected: true });
};

$("#roadmapSearch").oninput = (event) => {
  roadmapSearchQuery = event.target.value;
  roadmapFilterScrollResetPending = true;
  renderRoadmaps();
};
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
$("#roadmapShowMsrp").onchange = (event) => {
  portfolio.settings = {
    showRoadmapMsrp: false,
    ...(portfolio.settings || {}),
  };
  portfolio.settings.showRoadmapMsrp = event.target.checked;
  scheduleSave();
  renderRoadmaps();
  syncControls();
};
bindPresetColor($("#roadmapColorLaunchedPreset"), $("#roadmapColorLaunched"), (value) => updateBoard((current) => { current.settings.roadmap.statusColors.launched = value; }));
bindPresetColor($("#roadmapColorDevelopmentPreset"), $("#roadmapColorDevelopment"), (value) => updateBoard((current) => { current.settings.roadmap.statusColors["in-development"] = value; }));
bindPresetColor($("#roadmapColorPlanningPreset"), $("#roadmapColorPlanning"), (value) => updateBoard((current) => { current.settings.roadmap.statusColors["in-planning"] = value; }));
document.querySelectorAll("[data-roadmap-years]").forEach((button) => {
  button.onclick = () => {
    closePopupMenus();
    setRoadmapYearSpan(Number(button.dataset.roadmapYears));
  };
});
$("#roadmapToday").onclick = () => { closePopupMenus(); scrollRoadmapToday(activeView === "split" ? splitRoadmapScroll : roadmapScroll); };
$("#roadmapFit").onclick = () => { closePopupMenus(); fitRoadmapTimeline(); };
$("#roadmapShowSelected").onclick = () => { closePopupMenus(); scrollRoadmapSelected(activeView === "split" ? splitRoadmapScroll : roadmapScroll); };
roadmapEditSelectedButton.onclick = () => {
  const product = selectedProduct();
  if (!product) return;
  const enabling = !roadmapSlotEditingActive(product.id);
  roadmapEditProductId = enabling ? product.id : null;
  closePopupMenus();
  if (enabling && activeView === "products") setView("roadmap", { focusSelected: true });
  else {
    updateRoadmapEditControls();
    renderRoadmaps();
  }
};

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
variantPopover.addEventListener("pointerdown", (event) => event.stopPropagation());
variantPopover.addEventListener("pointerenter", () => {
  clearTimeout(variantHoverCloseTimer);
  variantHoverCloseTimer = null;
});
variantPopover.addEventListener("pointerover", (event) => {
  const item = event.target.closest("[data-hero-variant-id]");
  if (!item) return;
  setHoveredHeroVariant(item.dataset.heroProductId, item.dataset.heroVariantId);
});
variantPopover.addEventListener("pointerout", (event) => {
  const item = event.target.closest("[data-hero-variant-id]");
  if (!item || item.contains(event.relatedTarget)) return;
  if (hoveredHeroVariant?.productId === item.dataset.heroProductId && hoveredHeroVariant.variantId === item.dataset.heroVariantId) setHoveredHeroVariant();
});
variantPopover.addEventListener("click", (event) => {
  const item = event.target.closest("[data-hero-variant-id]");
  if (!item) return;
  event.preventDefault();
  togglePinnedHeroVariant(item.dataset.heroProductId, item.dataset.heroVariantId);
  closeVariantPopover({ force: true });
});
variantPopover.addEventListener("pointerleave", () => {
  if (hoveredHeroVariant) setHoveredHeroVariant();
  scheduleVariantPopoverClose();
});
document.addEventListener("pointerdown", (event) => {
  if (!specPopover.classList.contains("hidden") && !specPopover.contains(event.target)) closeSpecPopover();
  if (!variantPopover.classList.contains("hidden") && !variantPopover.contains(event.target)) closeVariantPopover({ force: true });
  if (!event.target.closest(".popup-menu-shell") && !event.target.closest(".popup-menu")) closePopupMenus();
});
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closePopupMenus();
  closeSpecPopover();
  closeVariantPopover({ force: true });
  closePptxExportDialog();
  closeCategorySettings();
  if (productLayoutEditing) {
    productLayoutEditing = false;
    updateProductLayoutEditControls();
    renderBoard();
    return;
  }
  if (roadmapEditProductId) {
    stopRoadmapSlotEditing();
    renderRoadmaps();
    return;
  }
  if (inspectorOpen) {
    closeInspector();
    return;
  }
  if (selectedId) clearSelection();
});
window.addEventListener("resize", () => { closePopupMenus(); closeSpecPopover(); closeVariantPopover({ force: true }); renderActiveView(); });

portfolio = loadPortfolio();
activateCategory(portfolio.activeCategoryId, { render: false, fitVertical: true });
syncControls();
renderInspector();
setView("products");
flushPendingLegacyImages();
