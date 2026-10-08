"use strict";

const STORAGE_KEY = globalThis.PPC_MASTER_SOURCE?.demo ? "product-portfolio-canvas-v4-shared-demo" : "product-portfolio-canvas-v4";
const PACKAGE_RECOVERY_KEY = `${STORAGE_KEY}-package-recovery`; // Legacy import snapshot; only read to clean up older saved data.
const MAX_PACKAGE_MANIFEST_BYTES = 4 * 1024 * 1024;
const PREVIOUS_STORAGE_KEY = globalThis.PPC_MASTER_SOURCE?.demo ? "product-portfolio-canvas-v3-shared-demo" : "product-portfolio-canvas-v3";
const LEGACY_STORAGE_KEY = globalThis.PPC_MASTER_SOURCE?.demo ? "product-portfolio-canvas-v1-shared-demo" : "product-portfolio-canvas-v1";
const IMAGE_DB_NAME = globalThis.PPC_MASTER_SOURCE?.demo ? "product-portfolio-image-assets-v1-shared-demo" : "product-portfolio-image-assets-v1";
const IMAGE_DB_VERSION = 1;
const IMAGE_STORE_NAME = "images";
const CARD_WIDTH = 246;
const CARD_HEIGHT = 552;
const CARD_GAP = 10;
const GUTTER = 18;
const LANE_TOP = 34;
const SIDE_PADDING = 40;
const STATUS_BANNER_HEIGHT = 24;
const IMAGE_SLOT_TOP = STATUS_BANNER_HEIGHT + 10;
const IMAGE_SLOT_HEIGHT = 112;
const TITLE_BLOCK_TOP = IMAGE_SLOT_TOP + IMAGE_SLOT_HEIGHT + 6;
const PRICE_BASELINE_OFFSET = 53;
const DETAILS_TOP_OFFSET = 66;
const PLACEHOLDER_IMAGE = "assets/headset-placeholder.svg";

const ROADMAP_LEFT_WIDTH = 190;
const ROADMAP_HEADER_HEIGHT = 88;
const ROADMAP_GROUP_HEADER_HEIGHT = 28;
const ROADMAP_ROW_HEIGHT = 38;
const ROADMAP_BOTTOM_PADDING = 24;
const ROADMAP_MIN_BODY_HEIGHT = 156;
const ROADMAP_CATEGORY_LABEL_FONT_SIZE = 13;
const ROADMAP_MIN_MONTH_WIDTH = 8;
const ROADMAP_MAX_MONTH_WIDTH = 112;
const ROADMAP_DEFAULT_MONTH_WIDTH = 82;
const {
  paginateRoadmapGroups: paginateRoadmapGroupsForPptx,
} = globalThis.PPTXPagination;
const PRODUCT_MIN_ZOOM = 0.2;
const PRODUCT_MAX_ZOOM = 1.5;
const VIEWER_INFO_GAP = 0;
const VIEWER_INFO_ANIMATION_MS = 240;
const INFO_BUTTON_WIDTH = 54;
const INFO_BUTTON_HEIGHT = 22;
const FULL_SPEC_MIN_CARD_HEIGHT = 400;
const FULL_SPEC_IMAGE_HEIGHT = 210;
const FULL_SPEC_TITLE_TOP = STATUS_BANNER_HEIGHT + 10 + FULL_SPEC_IMAGE_HEIGHT + 8;
const FULL_SPEC_DETAILS_TOP_OFFSET = 66;

// Canvas colors mirror the CSS design tokens in styles.css. Product/SKU colors
// remain independent because they describe merchandise rather than application UI.
const UI_PALETTE = Object.freeze({
  trueBlack: "#121212",
  inkBlack: "#171717",
  carbon: "#202020",
  jetBlack: "#242424",
  gunmetal: "#393c40",
  greyOlive: "#9b9b9a",
  silver: "#bec5c2",
  whiteSmoke: "#efefed",
  amaranth: "#ad8585",
  charcoal900: "#090909",
  charcoal800: "#191919",
  charcoal700: "#232323",
  charcoal600: "#2c2c2c",
  charcoal500: "#353535",
  indigoDark: "#242424",
  indigo: "#2c2c2c",
  steelTeal: "#526564",
  steelTealLight: "#9caeaa",
  midGrey: "#989898",
  foggyDark: "#64615a",
  foggy: "#b1af9a",
  starDust: "#e2ddda",
  selection: "#6e7973",
});

const COLOR_PRESETS = [
  { value: UI_PALETTE.gunmetal, label: "Gunmetal" },
  { value: UI_PALETTE.indigo, label: "Japanese indigo" },
  { value: UI_PALETTE.steelTeal, label: "Steel teal" },
  { value: UI_PALETTE.foggy, label: "Foggy" },
  { value: UI_PALETTE.midGrey, label: "Mid grey" },
  { value: UI_PALETTE.starDust, label: "Star dust" },
  { value: UI_PALETTE.amaranth, label: "Amaranth" },
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
  none: { label: "", color: UI_PALETTE.carbon },
  new: { label: "NEW PRODUCT", color: PortfolioModel.THEME_ACCENTS.newProduct },
  embargo: { label: "UPCOMING UNDER EMBARGO", color: PortfolioModel.THEME_ACCENTS.embargo },
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
const variantPopover = $("#variantPopover");
const editSelectedButton = $("#editSelected");
const productLayoutEditButton = $("#productLayoutEditToggle");
const imageCache = new Map();
const imageAssetUrlCache = new Map();
const imageAssetLoadPromises = new Map();
const missingImageAssetIds = new Set();
const pendingLegacyImageBlobs = [];
let imageAssetGeneration = 0;
let packageOperationInProgress = false;
let imageDbPromise = null;
const productView = $("#productView");
const roadmapView = $("#roadmapView");
const splitView = $("#splitView");
const productControls = $("#productControls");
const roadmapControls = $("#roadmapControls");
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
let pptxSelectedCategoryIds = null;
let pptxExportInProgress = false;
let pptxReturnFocus = null;
const ascmImportDialog = $("#ascmImportDialog");
const ascmImportForm = $("#ascmImportForm");
const confirmAscmImportButton = $("#confirmAscmImport");
const laneSettingsList = $("#laneSettingsList");
let categorySettingsDraftLanes = [];
let pendingAscmImport = null;

let portfolio = null;
let workspaceValidationPending = false;
let board = null;
let activeCategoryId = null;
let selectedId = null;
let zoom = 1;
let searchQuery = "";
let dragState = null;
let panState = null;
let renderedCards = [];
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
let editorActiveTab = "details";
let viewerInfoOpen = false;
let viewerInfoProductId = null;
let viewerInfoProgress = 0;
let viewerInfoAnimationFrame = null;
let saveTimer = null;
let activeView = "products";
let roadmapDetailsOpen = true;
let roadmapSearchQuery = "";
let roadmapFilterScrollResetPending = false;
let roadmapMonthWidth = ROADMAP_DEFAULT_MONTH_WIDTH;
let roadmapHitRegions = new Map();
let roadmapRowRegions = new Map();
let roadmapHoveredProductId = null;
let roadmapDragState = null;
let roadmapPanState = null;
let roadmapInteractionMode = "pan";
let roadmapDraft = null;
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

async function imageStoreWriteBatch(entries) {
  if (!entries.length) return;
  const database = await openImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Unable to save package images."));
    transaction.onabort = () => reject(transaction.error || new Error("Package image save was cancelled."));
    try {
      for (const entry of entries) store.put({ id: entry.id, blob: entry.blob, updatedAt: Date.now() });
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

async function imageStoreDeleteBatch(assetIds) {
  if (!assetIds.length) return;
  const database = await openImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Unable to remove obsolete package images."));
    transaction.onabort = () => reject(transaction.error || new Error("Image cleanup was cancelled."));
    try {
      for (const assetId of assetIds) store.delete(assetId);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
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
  const generation = imageAssetGeneration;
  const promise = imageStoreGet(assetId)
    .then((blob) => {
      if (generation !== imageAssetGeneration) return;
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
    .finally(() => { if (imageAssetLoadPromises.get(assetId) === promise) imageAssetLoadPromises.delete(assetId); });
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
  globalThis.PortfolioWorkspaceUI?.closeToolMenus?.();
  if (!except) window.dispatchEvent(new CustomEvent("close-workspace-settings"));
  [dataMenu, roadmapMenu, productMenu].forEach((menu) => {
    if (!menu || menu === except || menu.closest("#workspaceSettingsDialog")) return;
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
    colorHex: preset?.hex || normalizeHexColor(customHex, "#777777"),
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
    ...item,
    id: item.id || id(),
    code: String(item.code || primaryPreset?.code || "SKU"),
    colorKey: primaryKey,
    colorName: primaryPreset?.label || String(item.colorName || "Custom"),
    colorHex: primaryPreset?.hex || normalizeHexColor(item.colorHex, "#777777"),
    colorKey2: secondaryKey,
    colorName2: secondaryKey ? (secondaryPreset?.label || String(item.colorName2 || "Custom")) : "",
    colorHex2: secondaryKey ? (secondaryPreset?.hex || normalizeHexColor(item.colorHex2, "#ffffff")) : "",
    imageAssetId: String(item.imageAssetId || ""),
  };
}

function normalizeLayoutVariant(item) {
  return {
    ...item,
    id: item.id || id(),
    code: String(item.code || "SKU").trim() || "SKU",
    label: String(item.label || item.colorName || "").trim(),
  };
}

function normalizeVariantGroup(group, definition = categoryDefinition()) {
  const type = group?.type === "layout" ? "layout" : "color";
  const defaultLabel = type === "layout" ? "LAYOUT SKU" : "COLOR SKU";
  return {
    ...group,
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

function defaultSpecificationsForCategory(categoryId, laneId = "") {
  const definition = categoryDefinition(categoryId);
  const sets = categorySpecSets(categoryId);
  const set = sets.find((item) => ["wired", "wireless"].includes(laneId) && item.id.startsWith(`${laneId}-`))
    || sets.find((item) => item.id === definition.defaultSpecSetId) || sets[0];
  return (set?.specs || definition.defaultSpecs || []).map(([label, value]) => spec(label, value));
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : "";
}

function normalizeAscmRecord(item) {
  const basePartNumber = String(item?.basePartNumber || item?.basePn || "").trim().toUpperCase();
  return {
    basePartNumber,
    featureId: String(item?.featureId || "").trim(),
    category: String(item?.category || "").trim(),
    fullProductName: String(item?.fullProductName || item?.description || "").trim(),
    codeName: String(item?.codeName || "").trim(),
    generalAvailabilityDate: normalizeProductInfoDate(item?.generalAvailabilityDate || item?.gaDate || item?.ga),
    endManufacturingDate: normalizeProductInfoDate(item?.endManufacturingDate || item?.emDate || item?.em),
    colorCode: String(item?.colorCode || item?.color?.code || item?.inferredColor?.code || "").trim().toUpperCase(),
    rowNumber: Number.isFinite(Number(item?.rowNumber ?? item?.sourceRow)) ? Number(item.rowNumber ?? item.sourceRow) : null,
  };
}

function normalizeAscmProductMetadata(value) {
  if (!value || typeof value !== "object") return null;
  const records = (Array.isArray(value.records) ? value.records : [])
    .map(normalizeAscmRecord)
    .filter((record) => record.basePartNumber && record.fullProductName);
  const basePartNumbers = [...new Set([
    ...(Array.isArray(value.basePartNumbers) ? value.basePartNumbers : []),
    ...records.map((record) => record.basePartNumber),
  ].map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))];
  return {
    key: String(value.key || "").trim(),
    sourceCategory: String(value.sourceCategory || value.category || "").trim(),
    sourceFile: String(value.sourceFile || "").trim(),
    exportedAt: String(value.exportedAt || "").trim(),
    importedAt: String(value.importedAt || "").trim(),
    basePartNumbers,
    colorCodes: [...new Set((Array.isArray(value.colorCodes) ? value.colorCodes : records.map((record) => record.colorCode))
      .map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))],
    records,
  };
}

function normalizeAscmSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  return {
    sourceFile: String(value.sourceFile || "").trim(),
    exportedAt: String(value.exportedAt || "").trim(),
    importedAt: String(value.importedAt || "").trim(),
    basePartNumbers: [...new Set((Array.isArray(value.basePartNumbers) ? value.basePartNumbers : [])
      .map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))],
  };
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
    ...item,
    id: String(item?.id || `part-sku-${index + 1}-${code.toLowerCase().replace(/[^a-z0-9]+/g, "-") || id()}`),
    code,
    variantId: String(item?.variantId || ""),
    colorCode: String(item?.colorCode || ""),
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
    const previousFocus = document.activeElement;
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.tabIndex = -1;
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.minHeight = "0";
    textarea.style.padding = "0";
    textarea.style.border = "0";
    textarea.style.opacity = "0";
    try {
      document.body.appendChild(textarea);
      textarea.focus({ preventScroll: true });
      textarea.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
      previousFocus?.focus({ preventScroll: true });
    }
  }
}

function ensureBoardSchema(target, definition = categoryDefinition()) {
  target.version = 1;
  target.title = String(target.title || definition.boardTitle).trim() || definition.boardTitle;
  target.lanes = Array.isArray(target.lanes) && target.lanes.length
    ? target.lanes
    : definition.lanes.map((lane, order) => ({ ...lane, order }));
  target.products = Array.isArray(target.products) ? target.products : [];
  target.settings = { showPrices: true, showSkus: true, ...target.settings, freeMove: false };
  target.settings.roadmap = {
    startMonth: "2026-01",
    endMonth: "2030-12",
    snap: "month",
    categoryLabel: definition.categoryLabel,
    familyOrder: [...definition.familyOrder],
    statusColors: {
      launched: UI_PALETTE.gunmetal,
      "in-development": UI_PALETTE.steelTeal,
      "in-planning": UI_PALETTE.foggyDark,
    },
    ...(target.settings.roadmap || {}),
  };
  target.settings.roadmap.statusColors = {
    launched: UI_PALETTE.gunmetal,
    "in-development": UI_PALETTE.steelTeal,
    "in-planning": UI_PALETTE.foggyDark,
    ...(target.settings.roadmap.statusColors || {}),
  };
  const legacyRoadmapColors = {
    launched: ["#666c66", UI_PALETTE.gunmetal],
    "in-development": ["#4e8136", UI_PALETTE.steelTeal],
    "in-planning": ["#8b7136", UI_PALETTE.foggyDark],
  };
  Object.entries(legacyRoadmapColors).forEach(([status, [legacyColor, replacement]]) => {
    if (String(target.settings.roadmap.statusColors[status] || "").toLowerCase() === legacyColor) {
      target.settings.roadmap.statusColors[status] = replacement;
    }
  });
  target.settings.roadmap.statusColors.launched = normalizeHexColor(target.settings.roadmap.statusColors.launched, UI_PALETTE.gunmetal);
  target.settings.roadmap.statusColors["in-development"] = normalizeHexColor(target.settings.roadmap.statusColors["in-development"], UI_PALETTE.steelTeal);
  target.settings.roadmap.statusColors["in-planning"] = normalizeHexColor(target.settings.roadmap.statusColors["in-planning"], UI_PALETTE.foggyDark);
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
    product.generalAvailabilityDate = normalizeProductInfoDate(product.generalAvailabilityDate);
    product.endManufacturingDate = normalizeProductInfoDate(product.endManufacturingDate);
    product.ascm = normalizeAscmProductMetadata(product.ascm);
    product.partSkus = (Array.isArray(product.partSkus) ? product.partSkus : [])
      .map((item, partSkuIndex) => normalizePartSku(item, partSkuIndex));
    if (product.statusType === "custom") {
      product.variantLabel = product.variantLabel || product.statusLabel || "VARIANT";
      product.variantColor = product.variantColor || product.highlightColor || UI_PALETTE.steelTeal;
      product.statusType = "none";
    }
    product.statusType = ["new", "embargo"].includes(product.statusType) ? product.statusType : "none";
    product.statusLabel = standardizedStatus(product.statusType).label;
    product.variantLabel = String(product.variantLabel || "");
    product.variantColor = String(product.variantColor || product.highlightColor || UI_PALETTE.steelTeal);
    if (product.variantColor.toLowerCase() === "#3f6f91") product.variantColor = UI_PALETTE.steelTeal;
    product.variantColor = normalizeHexColor(product.variantColor, UI_PALETTE.steelTeal);
    product.highlightEnabled = false;
    product.highlightColor = product.variantColor;
    product.specs = PortfolioModel.normalizeSpecifications(product.specs, id);
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
    generalAvailabilityDate: normalizeProductInfoDate(options.generalAvailabilityDate),
    endManufacturingDate: normalizeProductInfoDate(options.endManufacturingDate),
    ascm: normalizeAscmProductMetadata(options.ascm),
    partSkus: (Array.isArray(options.partSkus) ? options.partSkus : []).map((item, index) => normalizePartSku(item, index)),
    laneId,
    order,
    statusType,
    statusLabel: standardizedStatus(statusType).label,
    variantLabel: String(options.variantLabel || ""),
    variantColor: normalizeHexColor(options.variantColor, UI_PALETTE.steelTeal),
    highlightEnabled: false,
    highlightColor: normalizeHexColor(options.variantColor || options.highlightColor, UI_PALETTE.steelTeal),
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
    generalAvailabilityDate: blueprint.generalAvailabilityDate || "",
    endManufacturingDate: blueprint.endManufacturingDate || "",
    ascm: blueprint.ascm || null,
    partSkus: blueprint.partSkus || [],
    statusType: status,
    statusLabel: standardizedStatus(status).label,
    variantLabel: blueprint.variantLabel || "",
    variantColor: blueprint.variantColor || UI_PALETTE.steelTeal,
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
    throw new Error("catalog-data.js did not provide any category definitions. Load js/catalog-data.js before js/app.js.");
  }
  return {
    version: 4,
    activeCategoryId: firstDefinition.id,
    settings: {
      showRoadmapMsrp: false,
    },
    ascmSnapshot: null,
    packageInfo: null,
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
  normalized.ascmSnapshot = normalizeAscmSnapshot(normalized.ascmSnapshot);
  normalized.packageInfo = packageCodec().normalizePackageInfo(normalized.packageInfo);
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
  PortfolioModel.syncTimelineSettings(normalized);
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
  if (packageOperationInProgress) return;
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
  PortfolioModel.syncTimelineSettings(portfolio);
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
  if (render) {
    renderActiveView();
    if (activeView === "products" && initialVerticalFitPending) {
      initialVerticalFitPending = false;
      fitProductLanesVertically();
    }
  }
}

function updateBoard(mutator, { inspector: updateInspector = false } = {}) {
  mutator(board);
  scheduleSave();
  syncControls();
  if (updateInspector) renderInspector();
  renderActiveView();
}

function updateTimelineSettings(patch) {
  PortfolioModel.syncTimelineSettings(portfolio, patch);
  scheduleSave();
  syncControls();
  renderActiveView();
}

function sortedLanes() {
  return [...board.lanes].sort((a, b) => a.order - b.order);
}

function visibleProducts() {
  const query = searchQuery.trim();
  if (!query) return board.products;
  return board.products.filter((product) => Boolean(globalThis.PortfolioSearch.matchProduct(product, query)));
}

function openPortfolioSearchResult(result) {
  if (packageOperationInProgress || !result || typeof result.productId !== "string" || typeof result.categoryId !== "string") return false;
  const locations = portfolio.categories.flatMap((category) => (category.board?.products || []).filter((product) => product.id === result.productId).map((product) => ({ category, product })));
  if (locations.length !== 1 || locations[0].category.id !== result.categoryId) return false;
  const { category, product } = locations[0];
  const nextView = activeView === "products" ? "products" : "split";
  activateCategory(category.id, { render: false, fitVertical: true });
  selectedId = product.id;
  globalThis.PortfolioDetails.focusMatch(productDetailsModel(product), { surface: nextView === "products" ? "viewer" : "split", sku: result.matchedSku || "", variant: result.matchedVariant || "" });
  setView(nextView, { focusSelected: true });
  const focusResult = () => {
    if (activeView !== nextView || selectedId !== product.id || activeCategoryId !== category.id) return;
    const target = nextView === "products" ? viewerInfo : splitProduct;
    const matchingCopy = result.matchedSku && [...target.querySelectorAll("[data-detail-copy]")].find((element) => element.dataset.detailCopy === result.matchedSku);
    (matchingCopy || target.querySelector('[role="tab"][aria-selected="true"]'))?.focus({ preventScroll: true });
  };
  if (nextView === "products") openViewerInfo(product.id, { onReady: focusResult });
  else requestAnimationFrame(focusResult);
  return true;
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

function productCardLayout(targetBoard = board, definition = categoryDefinition()) {
  const lanes = targetBoard === board ? sortedLanes() : [...targetBoard.lanes].sort((a, b) => a.order - b.order);
  const supportsDetailedCards = lanes.length === 1 || definition.fullSpecCards === true;
  const products = targetBoard.products;
  const detailed = supportsDetailedCards && products.some((product) => product.specs.length);
  if (!detailed) {
    // Size the category together so filtering never moves cards or their hit regions.
    const rowsTop = TITLE_BLOCK_TOP + DETAILS_TOP_OFFSET + 9;
    const maxContentHeight = Math.max(0, ...products.map((product) => (
      rowsTop + product.specs.length * 32 + (targetBoard.settings.showSkus ? variantFooterLayout(product).height : 0) + 10
    )));
    const cardHeight = Math.max(300, Math.min(CARD_HEIGHT, maxContentHeight));
    return {
      detailed: false,
      cardHeight,
      laneHeight: cardHeight + 70,
      imageSlotTop: IMAGE_SLOT_TOP,
      imageSlotHeight: IMAGE_SLOT_HEIGHT,
      titleBlockTop: TITLE_BLOCK_TOP,
      priceBaselineOffset: PRICE_BASELINE_OFFSET,
      detailsTopOffset: DETAILS_TOP_OFFSET,
    };
  }

  const maxDetailsHeight = Math.max(0, ...products.map((product) => detailedSpecsHeight(product)));
  const maxFooterHeight = targetBoard.settings.showSkus
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

function viewerInfoVisualWidth(height = viewerInfoVisualHeight()) {
  if (height <= 180) return 720;
  return height <= 280 ? 680 : 540;
}

function viewerInfoVisualHeight() {
  return productCardLayout().cardHeight * zoom;
}

function setViewerInfoSize(width, height) {
  const product = infoProduct();
  const specifications = Array.isArray(product?.specs) ? product.specs : [];
  const hasLongValues = specifications.some((item) => String(item.value ?? "").replace(/\s+/g, " ").trim().length > 80);
  viewerInfo.style.setProperty("--viewer-info-width", `${width}px`);
  viewerInfo.style.setProperty("--viewer-info-height", `${height}px`);
  viewerInfo.dataset.compactHeight = String(height <= 180);
  viewerInfo.dataset.detailColumns = String(height <= 280 && !hasLongValues ? 2 : 1);
}

function viewerInfoReserveLogical() {
  if (activeView !== "products" || !viewerInfoProductId || viewerInfoProgress <= 0 || !visibleProducts().some((product) => product.id === viewerInfoProductId)) return 0;
  return (viewerInfoVisualWidth() + 10) / Math.max(PRODUCT_MIN_ZOOM, zoom || 1) * viewerInfoProgress;
}

function viewerInfoGapIndex(laneProducts) {
  if (activeView !== "products" || !viewerInfoProductId || viewerInfoProgress <= 0) return -1;
  return laneProducts.findIndex((product) => product.id === viewerInfoProductId);
}

function cardXForDisplayIndex(laneProducts, displayIndex, includeViewer = true) {
  const gapIndex = includeViewer ? viewerInfoGapIndex(laneProducts) : -1;
  const shift = gapIndex >= 0 && displayIndex > gapIndex ? viewerInfoReserveLogical() : 0;
  return GUTTER + displayIndex * (CARD_WIDTH + CARD_GAP) + shift;
}

function productLaneGeometry(layout = productCardLayout()) {
  return PortfolioModel.layoutProductLanes(sortedLanes(), layout, { top: LANE_TOP });
}

function getCanvasDimensions({ includeViewer = true } = {}) {
  const lanes = sortedLanes();
  const products = visibleProducts();
  const layout = productCardLayout();
  const maxCount = Math.max(1, ...lanes.map((lane) => products.filter((product) => product.laneId === lane.id).length));
  const editorRevealReserve = inspectorOpen && activeView === "products" && inspector?.offsetWidth
    ? Math.ceil((inspector.offsetWidth + 28) / Math.max(PRODUCT_MIN_ZOOM, zoom || 1))
    : 0;
  const laneGeometry = productLaneGeometry(layout);
  const contentWidth = GUTTER + maxCount * (CARD_WIDTH + CARD_GAP) + SIDE_PADDING + editorRevealReserve + (includeViewer ? viewerInfoReserveLogical() : 0);
  const viewportLogicalWidth = canvasScroll?.clientWidth
    ? Math.ceil(canvasScroll.clientWidth / Math.max(PRODUCT_MIN_ZOOM, zoom || 1))
    : 0;
  return {
    width: Math.max(1480, contentWidth, viewportLogicalWidth),
    height: LANE_TOP + laneGeometry.height + 20,
    laneRows: laneGeometry.rows,
    includeViewer,
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
  context.fillStyle = primary || UI_PALETTE.gunmetal;
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
  context.strokeStyle = UI_PALETTE.greyOlive;
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
  roundRect(context, x, y, CARD_WIDTH, layout.height, [0, 0, 4, 4], UI_PALETTE.charcoal700);
  const activeHeroVariantId = activeHeroVariant(product)?.id || "";
  let cursorY = y + 9;
  layout.groups.forEach((group, groupIndex) => {
    context.fillStyle = UI_PALETTE.steelTealLight;
    context.font = "700 9px Arial";
    context.textAlign = "left";
    context.fillText(group.label.toUpperCase(), x + 12, cursorY + 8);
    if (groupIndex === 0 && layout.hiddenGroupCount > 0) {
      const groupChipWidth = 50;
      const groupChipHeight = 14;
      const groupChipX = x + CARD_WIDTH - 12 - groupChipWidth;
      const groupChipY = cursorY - 3;
      roundRect(context, groupChipX, groupChipY, groupChipWidth, groupChipHeight, 7, "rgba(40,40,40,.88)", "rgba(156,174,170,.30)", .75);
      context.textAlign = "center";
      context.fillStyle = UI_PALETTE.steelTealLight;
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
        roundRect(context, chipX, chipY, chipWidth, chipHeight, 7, "rgba(40,40,40,.88)", "rgba(156,174,170,.30)", .75);
        context.fillStyle = UI_PALETTE.silver;
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
        context.fillStyle = isActiveHero ? UI_PALETTE.whiteSmoke : UI_PALETTE.silver;
        context.font = `${isActiveHero ? "800" : "700"} 9.5px Arial`;
        drawSkuSwatch(context, cellX, cellY + 1, 10, 10, item.colorHex, item.colorHex2);
        if (hasHeroImage) {
          context.save();
          context.strokeStyle = isActiveHero ? UI_PALETTE.whiteSmoke : UI_PALETTE.steelTealLight;
          context.lineWidth = isActiveHero ? 1.5 : 1;
          context.strokeRect(cellX - 1, cellY, 12, 12);
          context.fillStyle = isActiveHero ? UI_PALETTE.whiteSmoke : UI_PALETTE.steelTealLight;
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
        context.fillStyle = UI_PALETTE.whiteSmoke;
        context.font = "700 9.5px Arial";
        context.fillText(truncate(String(item.code || "SKU"), group.type === "layout" ? 7 : 9), cellX, cellY + 10, Math.max(10, cellWidth - 4));
      }
    });
    cursorY += group.rows * 18;
    if (groupIndex < layout.groups.length - 1) {
      context.strokeStyle = "rgba(96,137,155,.3)";
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
    context.fillStyle = "rgba(226,221,218,.18)";
    context.font = "700 10px Arial";
    context.textAlign = "center";
    context.fillText(run.family.toUpperCase(), centerX, laneY - 13, Math.max(20, endX - startX - 8));
    context.strokeStyle = "rgba(226,221,218,.08)";
    context.beginPath();
    context.moveTo(startX, laneY - 8);
    context.lineTo(endX, laneY - 8);
    context.stroke();
  });
}

function drawProductBoardExportBackground(context, dimensions) {
  context.fillStyle = UI_PALETTE.charcoal800;
  context.fillRect(0, 0, dimensions.width, dimensions.height);
}

function drawBoardTo(context, dimensions, includeSelection = true, includeBackground = false, includeProducts = true) {
  context.clearRect(0, 0, dimensions.width, dimensions.height);
  if (includeBackground) drawProductBoardExportBackground(context, dimensions);

  const lanes = sortedLanes();
  const products = visibleProducts();
  const layout = dimensions.layout || productCardLayout();
  renderedCards = [];
  renderedVariantOverflow = [];
  renderedHeroVariantRegions = [];
  renderedInfoButtons = [];

  const laneRows = dimensions.laneRows || productLaneGeometry(layout).rows;
  laneRows.forEach(({ lane, top: laneY, contentHeight, products: rowProducts, continued }) => {
    roundRect(context, 0, laneY - 4, dimensions.width, contentHeight + 8, 0, UI_PALETTE.charcoal800);
    const laneProducts = (rowProducts || products.filter((product) => product.laneId === lane.id))
      .slice()
      .sort((a, b) => a.order - b.order);
    if (dimensions.pptxPage) {
      context.fillStyle = UI_PALETTE.silver;
      context.font = "700 11px Arial";
      context.textAlign = "left";
      const label = lane.name || lane.label || lane.id || "Products";
      context.fillText(`${label}${continued ? " (continued)" : ""}`, GUTTER, laneY - (layout.detailed ? 31 : 13), dimensions.width - GUTTER - SIDE_PADDING);
    }
    if (layout.detailed) drawDetailedFamilyHeaders(context, laneProducts, laneY);

    if (!includeProducts) return;
    laneProducts
      .forEach((product, displayIndex) => {
        const automatic = { x: cardXForDisplayIndex(laneProducts, displayIndex, dimensions.includeViewer !== false), y: laneY };
        let position = automatic;
        if (dragState?.productId === product.id) position = dragState.position;
        renderedCards.push({ productId: product.id, laneId: lane.id, x: position.x, y: position.y, width: CARD_WIDTH, height: layout.cardHeight });
        drawCard(context, product, position.x, position.y, includeSelection && product.id === selectedId, layout, includeSelection);
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
  context.strokeStyle = UI_PALETTE.greyOlive;
  context.fillStyle = UI_PALETTE.greyOlive;
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
  const tone = PortfolioModel.productTone(product);
  const status = { ...standardizedStatus(product.statusType), color: tone };
  const variantLabel = String(product.variantLabel || "").trim();
  const hasVariant = Boolean(variantLabel);
  const secondaryLabel = status.label && variantLabel && variantLabel.toUpperCase() !== status.label.toUpperCase()
    ? variantLabel : "";
  return {
    status,
    hasVariant,
    hasStatus: Boolean(status.label),
    variantLabel,
    secondaryLabel,
    variantColor: tone,
    primaryLabel: status.label || variantLabel,
    primaryColor: tone,
    outlineColor: hasVariant || status.label ? tone : UI_PALETTE.charcoal600,
  };
}

function productPriceText(product) {
  return PortfolioModel.msrpText(product);
}

function parseHexColor(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const shortMatch = normalized.match(/^#([0-9a-f]{3})$/i);
  const longMatch = normalized.match(/^#([0-9a-f]{6})$/i);
  const hex = longMatch?.[1] || (shortMatch?.[1] ? shortMatch[1].split("").map((character) => character.repeat(2)).join("") : "");
  if (!hex) return null;
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function normalizeHexColor(value, fallback = UI_PALETTE.gunmetal) {
  const rgb = parseHexColor(value) || parseHexColor(fallback) || [55, 58, 63];
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

// Keep interface accents quiet even when an old package contains vivid UI
// colors. Merchandise swatches bypass this treatment and keep their real color.
function subtleDisplayColor(value, fallback = UI_PALETTE.gunmetal) {
  const rgb = parseHexColor(value) || parseHexColor(fallback);
  const mean = rgb.reduce((sum, channel) => sum + channel, 0) / 3;
  const base = Math.min(102, Math.max(48, mean));
  return `#${rgb.map((channel) => Math.round(Math.min(122, Math.max(38, base + (channel - mean) * .22))).toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(color) {
  const rgb = parseHexColor(color);
  if (!rgb) return null;
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}

function contrastTextColor(fill) {
  const fillLuminance = relativeLuminance(fill);
  if (fillLuminance == null) return UI_PALETTE.whiteSmoke;
  const darkLuminance = relativeLuminance(UI_PALETTE.trueBlack);
  const lightLuminance = relativeLuminance(UI_PALETTE.whiteSmoke);
  const darkContrast = (Math.max(fillLuminance, darkLuminance) + .05) / (Math.min(fillLuminance, darkLuminance) + .05);
  const lightContrast = (Math.max(fillLuminance, lightLuminance) + .05) / (Math.min(fillLuminance, lightLuminance) + .05);
  return darkContrast >= lightContrast ? UI_PALETTE.trueBlack : UI_PALETTE.whiteSmoke;
}

function detailedValueColor() {
  return UI_PALETTE.silver;
}

function drawDetailedSpecLabel(context, label, x, y, maxWidth) {
  context.fillStyle = UI_PALETTE.greyOlive;
  context.font = "700 8px Arial";
  context.textAlign = "left";
  context.fillText(String(label || "Specification").toUpperCase(), x, y, maxWidth);
}

function drawDetailedSpecs(context, product, x, startY) {
  const rows = detailedSpecRows(product.specs);
  let cursorY = startY;

  rows.forEach((row) => {
    const height = detailedSpecRowHeight(row);
    context.strokeStyle = UI_PALETTE.charcoal700;
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
  roundRect(
    context,
    buttonX,
    buttonY,
    INFO_BUTTON_WIDTH,
    INFO_BUTTON_HEIGHT,
    4,
    isOpen || isHovered ? UI_PALETTE.charcoal600 : UI_PALETTE.charcoal700,
    isOpen || isHovered ? UI_PALETTE.gunmetal : UI_PALETTE.charcoal500,
    1,
  );
  context.fillStyle = isOpen ? UI_PALETTE.whiteSmoke : UI_PALETTE.silver;
  context.font = "600 10px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(isOpen ? "Close" : "Details", buttonX + INFO_BUTTON_WIDTH / 2, buttonY + INFO_BUTTON_HEIGHT / 2 + .5);
  context.restore();

  renderedInfoButtons.push({
    productId: product.id,
    x: buttonX,
    y: buttonY,
    width: INFO_BUTTON_WIDTH,
    height: INFO_BUTTON_HEIGHT,
  });
}

function drawCard(context, product, x, y, selected, layout = productCardLayout(), interactive = true) {
  const presentation = productPresentation(product);
  const cardHeight = layout.cardHeight;
  context.save();
  context.shadowColor = "rgba(0,0,0,.28)";
  context.shadowBlur = 4;
  context.shadowOffsetY = 1;
  roundRect(context, x, y, CARD_WIDTH, cardHeight, 4, UI_PALETTE.carbon, UI_PALETTE.charcoal500, 1);
  context.restore();

  if (presentation.primaryLabel) {
    roundRect(context, x, y, CARD_WIDTH, STATUS_BANNER_HEIGHT, [4, 4, 0, 0], presentation.primaryColor);
    context.fillStyle = contrastTextColor(presentation.primaryColor);
    context.font = "700 10px Arial";
    context.textAlign = "center";
    context.fillText(presentation.primaryLabel.toUpperCase(), x + CARD_WIDTH / 2, y + 16);
  }
  const imageTop = y + layout.imageSlotTop;
  const imageRecord = loadImage(productImageSource(product));
  if (imageRecord.ready) drawContainedImage(context, imageRecord.image, x + 18, imageTop, CARD_WIDTH - 36, layout.imageSlotHeight);

  if (presentation.secondaryLabel) {
    const label = presentation.secondaryLabel.toUpperCase();
    context.font = "700 8px Arial";
    const badgeWidth = Math.min(CARD_WIDTH - INFO_BUTTON_WIDTH - 32, Math.max(74, context.measureText(label).width + 18));
    roundRect(context, x + 8, y + STATUS_BANNER_HEIGHT + 5, badgeWidth, 18, 4, UI_PALETTE.charcoal700, UI_PALETTE.charcoal500, .75);
    context.fillStyle = UI_PALETTE.silver;
    context.textAlign = "center";
    context.fillText(label, x + 8 + badgeWidth / 2, y + STATUS_BANNER_HEIGHT + 17, badgeWidth - 12);
  }

  const titleTop = y + layout.titleBlockTop;
  context.fillStyle = UI_PALETTE.whiteSmoke;
  context.font = "700 16px Arial";
  context.textAlign = "center";
  wrapText(context, product.name, x + CARD_WIDTH / 2, titleTop + 15, CARD_WIDTH - 24, 18, 2, "center");

  if (board.settings.showPrices) {
    context.fillStyle = UI_PALETTE.greyOlive;
    context.font = "16px Arial";
    context.fillText(productPriceText(product), x + CARD_WIDTH / 2, titleTop + layout.priceBaselineOffset);
  }

  const detailsTop = titleTop + layout.detailsTopOffset;
  context.strokeStyle = UI_PALETTE.charcoal600;
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
    const overflowNoteHeight = 24;
    const availableHeight = Math.max(0, detailsBottom - rowsTop);
    let visibleSpecCount = Math.max(0, Math.floor(availableHeight / rowHeight));
    if (product.specs.length > visibleSpecCount) {
      visibleSpecCount = Math.max(0, Math.floor((availableHeight - overflowNoteHeight - 8) / rowHeight));
    }
    const visibleSpecs = product.specs.slice(0, visibleSpecCount);
    visibleSpecs.forEach((item, index) => {
      const rowY = rowsTop + index * rowHeight;
      drawSpecIcon(context, item.label, x + 22, rowY + 11);
      context.fillStyle = UI_PALETTE.silver;
      context.font = "11.5px Arial";
      context.textAlign = "left";
      wrapText(context, item.value, x + 43, rowY + 10, CARD_WIDTH - 55, 13, 2, "left");
      context.strokeStyle = UI_PALETTE.charcoal700;
      context.beginPath(); context.moveTo(x + 10, rowY + 26); context.lineTo(x + CARD_WIDTH - 10, rowY + 26); context.stroke();
    });

    const hiddenSpecCount = product.specs.length - visibleSpecs.length;
    if (hiddenSpecCount > 0) {
      const noteY = detailsBottom - overflowNoteHeight - 7;
      context.fillStyle = UI_PALETTE.greyOlive;
      context.font = "10px Arial";
      context.textAlign = "center";
      context.fillText(`+${hiddenSpecCount} specification${hiddenSpecCount === 1 ? "" : "s"}`, x + CARD_WIDTH / 2, noteY + 16);
    }
  }

  if (footerHeight) {
    const footerY = y + cardHeight - footerHeight;
    drawVariantFooter(context, product, x, footerY, footerLayout);
  }

  // A quiet frame leaves lifecycle emphasis in the banner and merchandise.
  roundRect(
    context,
    x + 0.75,
    y + 0.75,
    CARD_WIDTH - 1.5,
    cardHeight - 1.5,
    4,
    null,
    UI_PALETTE.charcoal500,
    1,
  );

  if (selected) {
    context.save();
    roundRect(context, x + .75, y + .75, CARD_WIDTH - 1.5, cardHeight - 1.5, 4, null, UI_PALETTE.selection, 1.25);
    const markerY = y + STATUS_BANNER_HEIGHT + (presentation.secondaryLabel ? 28 : 9);
    roundRect(context, x + 8, markerY, 64, 18, 4, UI_PALETTE.charcoal700, UI_PALETTE.charcoal500, .75);
    context.fillStyle = UI_PALETTE.steelTealLight;
    context.fillRect(x + 14, markerY + 7, 3, 3);
    context.font = "600 9px Arial";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillStyle = UI_PALETTE.silver;
    context.fillText("Selected", x + 22, markerY + 9.5);
    context.restore();
  }

  // Keep the explicit viewer control above the selected-card outline.
  if (interactive) drawProductInfoButton(context, product, x, y, layout);
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
  const query = roadmapSearchQuery.trim();
  if (!query) return board.products;
  return board.products.filter((product) => Boolean(globalThis.PortfolioSearch.matchProduct(product, query)));
}

function roadmapFamilyOrder(family, targetBoard = board, definition = categoryDefinition()) {
  const order = targetBoard.settings?.roadmap?.familyOrder || definition.familyOrder || [];
  const index = order.indexOf(family);
  return index < 0 ? order.length : index;
}

function roadmapGroupsForProducts(products, targetBoard = board, definition = categoryDefinition()) {
  const groups = new Map();
  products.forEach((product) => {
    const family = product.roadmap?.family || inferFamily(product.name);
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(product);
  });
  return [...groups.entries()]
    .sort((a, b) => roadmapFamilyOrder(a[0], targetBoard, definition) - roadmapFamilyOrder(b[0], targetBoard, definition) || a[0].localeCompare(b[0]))
    .map(([family, products]) => ({
      family,
      products: RoadmapInteraction.sortProducts(products),
    }));
}

function roadmapGroups() {
  return roadmapGroupsForProducts(visibleRoadmapProducts(), board, categoryDefinition());
}

function roadmapDimensions(groupsOverride = null) {
  const range = roadmapRange();
  const groups = Array.isArray(groupsOverride) ? groupsOverride : roadmapGroups();
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
  return PortfolioModel.productTone(product);
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
  context.fillStyle = UI_PALETTE.whiteSmoke;
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
  const pixelWidth = Math.round(dimensions.width * dpr);
  const pixelHeight = Math.round(dimensions.height * dpr);
  if (targetCanvas.width !== pixelWidth) targetCanvas.width = pixelWidth;
  if (targetCanvas.height !== pixelHeight) targetCanvas.height = pixelHeight;
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
  const price = productPriceText(product);
  if (!portfolio?.settings?.showRoadmapMsrp || !price) return name;
  return `${name}  ·  ${price}`;
}

function roadmapProductBarRect(product, range, rowTop) {
  const roadmap = effectiveRoadmap(product);
  const startIndex = monthIndex(roadmap?.startMonth);
  const endIndex = monthIndex(roadmap?.endMonth);
  if (startIndex == null || endIndex == null || endIndex < startIndex
    || endIndex < range.start || startIndex > range.end) return null;

  const timelineRight = ROADMAP_LEFT_WIDTH + range.count * roadmapMonthWidth;
  const x = Math.max(ROADMAP_LEFT_WIDTH + 1, ROADMAP_LEFT_WIDTH + (startIndex - range.start) * roadmapMonthWidth + 2);
  const right = Math.min(timelineRight - 1, ROADMAP_LEFT_WIDTH + (endIndex - range.start + 1) * roadmapMonthWidth - 2);
  return {
    x,
    y: rowTop + 5,
    width: Math.min(timelineRight - 1 - x, Math.max(4, right - x)),
    height: ROADMAP_ROW_HEIGHT - 10,
  };
}

function drawRoadmapTo(context, dimensions, targetCanvas, targetScroll, includeSelection = true, exportMode = false, includeProducts = true) {
  const { width, height, range, groups } = dimensions;
  const stickyX = exportMode ? 0 : targetScroll.scrollLeft;
  const stickyY = exportMode ? 0 : targetScroll.scrollTop;
  const regions = [];
  const rows = [];

  context.clearRect(0, 0, width, height);
  context.fillStyle = UI_PALETTE.charcoal800;
  context.fillRect(0, 0, width, height);

  const timelineX = ROADMAP_LEFT_WIDTH;
  const timelineWidth = range.count * roadmapMonthWidth;
  const selectedGuides = includeSelection ? selectedRoadmapGuides(range) : null;

  const drawYearSeamSegment = (yStart, yEnd, opacity = .3) => {
    for (let month = 0; month <= range.count; month += 1) {
      const absolute = range.start + month;
      if (absolute % 12 !== 0) continue;
      const x = Math.round(timelineX + month * roadmapMonthWidth) + .5;
      context.save();
      context.strokeStyle = UI_PALETTE.silver;
      context.globalAlpha = opacity;
      context.lineWidth = 1.5;
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
    if (absolute % 12 === 0 || absolute % 3 !== 0) continue;
    const x = timelineX + month * roadmapMonthWidth;
    context.strokeStyle = "rgba(190,197,194,.055)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, ROADMAP_HEADER_HEIGHT);
    context.lineTo(x, height);
    context.stroke();
  }

  // Calendar-year seams are drawn later on top of the roadmap body so they
  // remain visually continuous rather than getting interrupted by row fills.

  let rowY = ROADMAP_HEADER_HEIGHT;
  groups.forEach((group) => {
    context.fillStyle = UI_PALETTE.inkBlack;
    context.fillRect(timelineX, rowY, timelineWidth, ROADMAP_GROUP_HEADER_HEIGHT);
    context.strokeStyle = "rgba(190,197,194,.14)";
    context.beginPath();
    context.moveTo(timelineX, rowY + .5);
    context.lineTo(timelineX + timelineWidth, rowY + .5);
    context.stroke();
    drawYearSeamSegment(rowY, rowY + ROADMAP_GROUP_HEADER_HEIGHT, .22);
    rowY += ROADMAP_GROUP_HEADER_HEIGHT;

    group.products.forEach((product, productIndex) => {
      const roadmap = effectiveRoadmap(product);
      const rowTop = rowY;
      if (includeSelection && !exportMode) rows.push({ productId: product.id, family: group.family, y: rowTop, height: ROADMAP_ROW_HEIGHT });
      context.fillStyle = productIndex % 2 ? "rgba(255,255,255,.012)" : "rgba(0,0,0,.08)";
      context.fillRect(timelineX, rowTop, timelineWidth, ROADMAP_ROW_HEIGHT);
      context.strokeStyle = "rgba(190,197,194,.045)";
      context.beginPath();
      context.moveTo(timelineX, rowTop + ROADMAP_ROW_HEIGHT);
      context.lineTo(timelineX + timelineWidth, rowTop + ROADMAP_ROW_HEIGHT);
      context.stroke();
      // Draw the year seam after the row surface but before the product bar.
      // This keeps the seam continuous through empty space while bars naturally
      // occlude it instead of having the line painted over product content.
      drawYearSeamSegment(rowTop, rowTop + ROADMAP_ROW_HEIGHT, .2);

      const bar = includeProducts ? roadmapProductBarRect(product, range, rowTop) : null;
      if (bar) {
        const { x: barX, y: barY, width: barWidth, height: barHeight } = bar;
        const selected = includeSelection && product.id === selectedId;
        const color = roadmapStatusColor(product);

        context.save();
        roundRect(context, barX, barY, barWidth, barHeight, 3, color, product.statusType === "embargo" ? UI_PALETTE.amaranth : UI_PALETTE.gunmetal, 1);
        context.restore();

        if (roadmap.status === "concept") {
          context.save();
          context.setLineDash([6, 4]);
          roundRect(context, barX + 1, barY + 1, Math.max(2, barWidth - 2), barHeight - 2, 3, null, UI_PALETTE.midGrey, 1);
          context.restore();
        }

        context.save();
        context.beginPath();
        context.rect(barX + 8, barY, Math.max(0, barWidth - 16), barHeight);
        context.clip();
        context.fillStyle = contrastTextColor(color);
        context.font = portfolio?.settings?.showRoadmapMsrp ? "700 11px Arial" : "700 12px Arial";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(roadmapProductBarLabel(product), barX + barWidth / 2, barY + barHeight / 2 + .5);
        context.restore();

        // A fine outline and leading mark identify selection without a glow.
        if (selected) {
          context.save();
          roundRect(context, barX + .5, barY + .5, Math.max(2, barWidth - 1), barHeight - 1, 3, null, UI_PALETTE.selection, 1.1);
          context.fillStyle = UI_PALETTE.silver;
          context.fillRect(barX + 3, barY + 5, Math.min(2, Math.max(0, barWidth - 6)), Math.max(0, barHeight - 10));
          context.restore();
        }

        const handleWidth = Math.min(14, barWidth / 2);
        const editingThisSlot = includeSelection && !exportMode && roadmapInteractionMode === "dates" && (selected || roadmapHoveredProductId === product.id);
        const startVisible = monthIndex(roadmap.startMonth) >= range.start;
        const endVisible = monthIndex(roadmap.endMonth) <= range.end;

        if (editingThisSlot && barWidth > 28) {
          context.save();
          context.fillStyle = "rgba(239,239,237,.94)";
          if (startVisible) roundRect(context, barX + 3, barY + 5, Math.max(3, handleWidth - 5), barHeight - 10, 2, "rgba(239,239,237,.92)");
          if (endVisible) roundRect(context, barX + barWidth - handleWidth + 2, barY + 5, Math.max(3, handleWidth - 5), barHeight - 10, 2, "rgba(239,239,237,.92)");
          context.restore();
        }

        regions.push({
          productId: product.id,
          x: barX,
          y: barY,
          width: barWidth,
          height: barHeight,
          leftHandle: startVisible ? { x: barX, width: handleWidth } : null,
          rightHandle: endVisible ? { x: barX + barWidth - handleWidth, width: handleWidth } : null,
        });
      }
      rowY += ROADMAP_ROW_HEIGHT;
    });
  });
  context.restore();

  // Selection stays on the product bar and one quiet launch-month marker.

  // Today marker over the timeline body.
  const todayIndex = monthIndex(monthStringFromDate());
  if (todayIndex >= range.start && todayIndex <= range.end) {
    const today = new Date();
    const fraction = Math.min(.98, Math.max(.02, (today.getDate() - 1) / new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()));
    const x = timelineX + (todayIndex - range.start + fraction) * roadmapMonthWidth;
    context.strokeStyle = "rgba(156,174,170,.72)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, ROADMAP_HEADER_HEIGHT - 8);
    context.lineTo(x, height);
    context.stroke();
  }

  // Sticky family rail.
  context.fillStyle = UI_PALETTE.inkBlack;
  context.fillRect(stickyX, ROADMAP_HEADER_HEIGHT, ROADMAP_LEFT_WIDTH, height - ROADMAP_HEADER_HEIGHT);
  context.fillStyle = UI_PALETTE.inkBlack;
  context.fillRect(stickyX, ROADMAP_HEADER_HEIGHT, 48, height - ROADMAP_HEADER_HEIGHT);
  context.strokeStyle = UI_PALETTE.charcoal700;
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
  groups.forEach((group) => {
    const groupHeight = ROADMAP_GROUP_HEADER_HEIGHT + group.products.length * ROADMAP_ROW_HEIGHT;
    context.fillStyle = UI_PALETTE.inkBlack;
    context.fillRect(stickyX + 48, rowY, ROADMAP_LEFT_WIDTH - 48, groupHeight);
    context.strokeStyle = "rgba(190,197,194,.14)";
    context.beginPath();
    context.moveTo(stickyX + 48, rowY + .5);
    context.lineTo(stickyX + ROADMAP_LEFT_WIDTH, rowY + .5);
    context.stroke();
    context.fillStyle = UI_PALETTE.starDust;
    context.font = "700 12px Arial";
    context.textAlign = "left";
    context.textBaseline = "middle";
    const familyHeadingY = rowY + ROADMAP_GROUP_HEADER_HEIGHT / 2;
    context.fillText(truncate(group.family.toUpperCase(), 17), stickyX + 61, familyHeadingY);
    if (group.continued) {
      context.fillStyle = UI_PALETTE.foggy;
      context.font = "700 8px Arial";
      context.fillText("CONTINUED", stickyX + 61, familyHeadingY + 14);
    }
    if (includeSelection && !exportMode && includeProducts) {
      group.products.forEach((product, index) => {
        const y = rowY + ROADMAP_GROUP_HEADER_HEIGHT + index * ROADMAP_ROW_HEIGHT;
        if (product.id === selectedId) {
          context.fillStyle = "rgba(174,198,181,.09)";
          context.fillRect(stickyX + 48, y, ROADMAP_LEFT_WIDTH - 48, ROADMAP_ROW_HEIGHT);
        }
        const activeRow = product.id === selectedId || product.id === roadmapHoveredProductId;
        context.fillStyle = activeRow ? "rgba(195,200,197,.55)" : "rgba(149,155,151,.22)";
        for (let column = 0; roadmapInteractionMode === "dates" && column < 2; column += 1) {
          for (let dot = 0; dot < 3; dot += 1) context.fillRect(stickyX + 54 + column * 3.5, y + 14 + dot * 4.5, 1.4, 1.4);
        }
        context.font = "10px Arial";
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.fillStyle = activeRow ? UI_PALETTE.whiteSmoke : UI_PALETTE.silver;
        const nameWidth = ROADMAP_LEFT_WIDTH - 73;
        const nameLines = RoadmapInteraction.labelLines(product.name, nameWidth, (text) => context.measureText(text).width);
        nameLines.forEach((line, lineIndex) => context.fillText(line, stickyX + 65, y + ROADMAP_ROW_HEIGHT / 2 + (lineIndex - (nameLines.length - 1) / 2) * 12));
      });
    }
    rowY += groupHeight;
  });

  if (includeSelection && !exportMode && roadmapDragState?.targetCanvas === targetCanvas && roadmapDragState.moved) {
    const drag = roadmapDragState;
    const viewportLeft = stickyX + 48;
    const viewportRight = Math.min(width - 8, stickyX + targetScroll.clientWidth - 8);
    context.save();
    context.beginPath();
    context.rect(viewportLeft, stickyY + ROADMAP_HEADER_HEIGHT, viewportRight - viewportLeft, targetScroll.clientHeight - ROADMAP_HEADER_HEIGHT);
    context.clip();
    context.strokeStyle = "rgba(174,198,181,.6)";
    context.setLineDash([5, 4]);
    context.strokeRect(viewportLeft + 2, drag.sourceY + 2, viewportRight - viewportLeft - 4, ROADMAP_ROW_HEIGHT - 4);
    context.setLineDash([]);
    if (drag.mode === "reorder" && drag.dropTarget) {
      context.strokeStyle = "#aecaB7";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(viewportLeft, drag.dropTarget.lineY);
      context.lineTo(viewportRight, drag.dropTarget.lineY);
      context.stroke();
      context.fillStyle = "#aecab7";
      context.beginPath();
      context.arc(viewportLeft + 3, drag.dropTarget.lineY, 4, 0, Math.PI * 2);
      context.fill();
      const floatingY = drag.pointY - drag.offsetY;
      const floatingX = Math.max(stickyX + ROADMAP_LEFT_WIDTH + 8, drag.sourceBar?.x || stickyX + ROADMAP_LEFT_WIDTH + 8);
      const floatingWidth = Math.min(Math.max(180, drag.sourceBar?.width || 180), viewportRight - floatingX);
      context.shadowColor = "rgba(0,0,0,.45)";
      context.shadowBlur = 12;
      context.shadowOffsetY = 5;
      roundRect(context, floatingX, floatingY + 4, Math.max(140, floatingWidth), ROADMAP_ROW_HEIGHT - 8, 4, roadmapStatusColor(selectedProduct()), "#c3d8cb", 1.5);
      context.shadowBlur = 0;
      context.shadowOffsetY = 0;
      context.fillStyle = contrastTextColor(roadmapStatusColor(selectedProduct()));
      context.font = "700 11px Arial";
      context.textBaseline = "middle";
      context.fillText(truncate(selectedProduct()?.name || "Product", 34), floatingX + 12, floatingY + ROADMAP_ROW_HEIGHT / 2);
    } else if (roadmapDraft) {
      if (drag.sourceBar) {
        context.setLineDash([5, 4]);
        context.strokeStyle = "rgba(195,216,203,.65)";
        context.strokeRect(drag.sourceBar.x, drag.sourceBar.y, drag.sourceBar.width, drag.sourceBar.height);
      }
      const draft = roadmapDraft.roadmap;
      const edges = [monthIndex(draft.startMonth), monthIndex(draft.endMonth) + 1];
      context.strokeStyle = "rgba(174,202,183,.7)";
      context.setLineDash([3, 4]);
      edges.forEach((month) => {
        const x = ROADMAP_LEFT_WIDTH + (month - range.start) * roadmapMonthWidth;
        if (x < stickyX + ROADMAP_LEFT_WIDTH) return;
        context.beginPath();
        context.moveTo(x, stickyY + ROADMAP_HEADER_HEIGHT);
        context.lineTo(x, Math.max(drag.sourceY + ROADMAP_ROW_HEIGHT, drag.pointY));
        context.stroke();
      });
    }
    context.restore();
  }

  // One neutral calendar surface: typography, sparse ticks, and year seams.
  context.fillStyle = UI_PALETTE.inkBlack;
  context.fillRect(timelineX, stickyY, timelineWidth, ROADMAP_HEADER_HEIGHT);
  const calendarRight = timelineX + timelineWidth;
  const visibleCalendarLeft = Math.min(calendarRight, Math.max(timelineX, stickyX + timelineX));
  const visibleCalendarRight = exportMode ? calendarRight : Math.min(calendarRight, stickyX + (targetScroll.clientWidth || width));
  context.save();
  context.beginPath();
  context.rect(visibleCalendarLeft, stickyY, Math.max(0, visibleCalendarRight - visibleCalendarLeft), ROADMAP_HEADER_HEIGHT);
  context.clip();
  context.textBaseline = "alphabetic";

  let cursor = range.start;
  while (cursor <= range.end) {
    const year = Math.floor(cursor / 12);
    const yearEnd = Math.min(range.end, year * 12 + 11);
    const x = timelineX + (cursor - range.start) * roadmapMonthWidth;
    const yearRight = timelineX + (yearEnd - range.start + 1) * roadmapMonthWidth;
    const visibleYearLeft = Math.max(x, visibleCalendarLeft);
    const visibleYearRight = Math.min(yearRight, visibleCalendarRight);
    if (visibleYearRight > visibleYearLeft) {
      // Keep the outgoing title pinned; its year seam clips it as the next title arrives.
      context.save();
      context.beginPath();
      context.rect(visibleYearLeft, stickyY, visibleYearRight - visibleYearLeft, 38);
      context.clip();
      context.fillStyle = UI_PALETTE.whiteSmoke;
      context.font = "800 26px Arial";
      context.textAlign = "left";
      context.fillText(String(year), visibleYearLeft + 10, stickyY + 31);
      context.restore();
    }
    cursor = yearEnd + 1;
  }

  let quarterCursor = range.start;
  while (quarterCursor <= range.end) {
    const quarter = Math.floor((quarterCursor % 12) / 3) + 1;
    const quarterEnd = Math.min(range.end, Math.floor(quarterCursor / 3) * 3 + 2);
    const x = timelineX + (quarterCursor - range.start) * roadmapMonthWidth;
    const quarterWidth = (quarterEnd - quarterCursor + 1) * roadmapMonthWidth;
    context.fillStyle = UI_PALETTE.greyOlive;
    context.font = "600 10px Arial";
    context.textAlign = "center";
    context.fillText(`Q${quarter}`, x + quarterWidth / 2, stickyY + 52);
    if (quarterCursor % 12 !== 0 && quarterCursor % 3 === 0) {
      context.strokeStyle = "rgba(190,197,194,.14)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(Math.round(x) + .5, stickyY + 42);
      context.lineTo(Math.round(x) + .5, stickyY + 57);
      context.stroke();
    }
    quarterCursor = quarterEnd + 1;
  }

  const fullMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const shortMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (let i = 0; i < range.count; i += 1) {
    const month = (range.start + i) % 12;
    const x = timelineX + i * roadmapMonthWidth;
    const narrow = roadmapMonthWidth < 16;
    if (narrow && month % 3 !== 0 && i !== 0) continue;
    const monthText = roadmapMonthWidth >= 60 ? fullMonthNames[month]
      : roadmapMonthWidth >= 28 || narrow ? shortMonthNames[month] : String(month + 1);
    context.fillStyle = UI_PALETTE.silver;
    context.font = roadmapMonthWidth >= 60 ? "11px Arial" : "10px Arial";
    context.textAlign = "center";
    const labelSpan = narrow ? Math.min(3 - month % 3, range.count - i) : 1;
    context.fillText(monthText, x + labelSpan * roadmapMonthWidth / 2, stickyY + 74);
  }

  drawYearSeamSegment(stickyY + 7, stickyY + ROADMAP_HEADER_HEIGHT, .38);
  if (selectedGuides?.launchVisible) {
    const launchX = timelineX + (selectedGuides.launch - range.start) * roadmapMonthWidth;
    context.fillStyle = UI_PALETTE.silver;
    context.fillRect(launchX + 2, stickyY + ROADMAP_HEADER_HEIGHT - 4, Math.max(4, roadmapMonthWidth - 4), 2);
  }
  context.restore();

  context.fillStyle = UI_PALETTE.inkBlack;
  context.fillRect(stickyX, stickyY, ROADMAP_LEFT_WIDTH, ROADMAP_HEADER_HEIGHT);
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  context.fillStyle = UI_PALETTE.midGrey;
  context.font = "700 9px Arial";
  context.fillText("PORTFOLIO ROADMAP", stickyX + 14, stickyY + 20);
  context.fillStyle = UI_PALETTE.starDust;
  context.font = "700 14px Arial";
  context.fillText(roadmapSpanLabel(range.count), stickyX + 14, stickyY + 42);
  context.fillStyle = UI_PALETTE.greyOlive;
  context.font = "10px Arial";
  if (selectedGuides) {
    context.fillText(`Launch · ${roadmapLabel(selectedGuides.roadmap.startMonth)}`, stickyX + 14, stickyY + 62);
    context.fillText(`End · ${roadmapLabel(selectedGuides.roadmap.endMonth)}`, stickyX + 14, stickyY + 77);
  } else {
    context.fillText("Launch → lifecycle end", stickyX + 14, stickyY + 66);
  }
  context.strokeStyle = "rgba(190,197,194,.18)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(stickyX, stickyY + ROADMAP_HEADER_HEIGHT - .5);
  context.lineTo(timelineX + timelineWidth, stickyY + ROADMAP_HEADER_HEIGHT - .5);
  context.stroke();

  roadmapHitRegions.set(targetCanvas, regions);
  if (includeSelection && !exportMode) roadmapRowRegions.set(targetCanvas, rows);
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
  roadmapMonthWidth = clampViewZoom(roadmapMonthWidth, ROADMAP_MIN_MONTH_WIDTH, ROADMAP_MAX_MONTH_WIDTH, ROADMAP_DEFAULT_MONTH_WIDTH);
  const previousView = activeView;
  syncRoadmapDetailsVisibility();
  syncViewZoomControls();
  updateRoadmapEditControls();
  if (activeView === "roadmap") renderRoadmapFor(roadmapCanvas, roadmapScroll, roadmapNavigatorRefs());
  if (activeView === "split") {
    renderSplitProduct();
    renderRoadmapFor(splitRoadmapCanvas, splitRoadmapScroll, splitRoadmapNavigatorRefs());
  }
  roadmapFilterScrollResetPending = false;
  if (activeView !== previousView) renderStatus();
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
  const available = Math.max(1, targetScroll.clientWidth - ROADMAP_LEFT_WIDTH - 24);
  // Keep month labels and product bars readable; longer timelines scroll.
  setRoadmapZoom(Math.max(ROADMAP_DEFAULT_MONTH_WIDTH * .4, available / Math.max(1, range.count)));
}

function clampViewZoom(value, minimum, maximum, fallback = 1) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : fallback));
}

function steppedViewZoom(current, direction, minimum, maximum) {
  const value = clampViewZoom(current, minimum, maximum);
  const visiblePercent = Math.round(value * 100);
  // Familiar proportional stops remain easy to adjust even at overview scales.
  // Omit stops that would display the same rounded percentage as an end limit.
  const steps = [minimum, ...[.1, .125, .16, .2, .25, .33, .4, .5, .65, .8, 1, 1.25, 1.5]
    .filter((step) => step > minimum + .005 && step < maximum - .005), maximum];
  return direction < 0
    ? [...steps].reverse().find((step) => step < value - .00001 && Math.round(step * 100) < visiblePercent) ?? minimum
    : steps.find((step) => step > value + .00001 && Math.round(step * 100) > visiblePercent) ?? maximum;
}

function syncViewZoomControls() {
  zoom = clampViewZoom(zoom, PRODUCT_MIN_ZOOM, PRODUCT_MAX_ZOOM);
  roadmapMonthWidth = clampViewZoom(roadmapMonthWidth, ROADMAP_MIN_MONTH_WIDTH, ROADMAP_MAX_MONTH_WIDTH, ROADMAP_DEFAULT_MONTH_WIDTH);
  $("#zoomReset").textContent = `${Math.round(zoom * 100)}%`;
  $("#zoomOut").disabled = zoom <= PRODUCT_MIN_ZOOM;
  $("#zoomIn").disabled = zoom >= PRODUCT_MAX_ZOOM;
  $("#roadmapZoomReset").textContent = `${Math.round(roadmapMonthWidth / ROADMAP_DEFAULT_MONTH_WIDTH * 100)}%`;
  $("#roadmapZoomOut").disabled = roadmapMonthWidth <= ROADMAP_MIN_MONTH_WIDTH;
  $("#roadmapZoomIn").disabled = roadmapMonthWidth >= ROADMAP_MAX_MONTH_WIDTH;
  $("#roadmapShowSelected").disabled = !selectedProduct();
}

function setRoadmapZoom(nextMonthWidth) {
  const targetScroll = activeView === "split" ? splitRoadmapScroll : roadmapScroll;
  const previousMonthWidth = clampViewZoom(roadmapMonthWidth, ROADMAP_MIN_MONTH_WIDTH, ROADMAP_MAX_MONTH_WIDTH, ROADMAP_DEFAULT_MONTH_WIDTH);
  const viewportCenter = Math.max(0, targetScroll.clientWidth - ROADMAP_LEFT_WIDTH) / 2;
  const centerMonth = (targetScroll.scrollLeft + viewportCenter) / previousMonthWidth;
  roadmapMonthWidth = clampViewZoom(nextMonthWidth, ROADMAP_MIN_MONTH_WIDTH, ROADMAP_MAX_MONTH_WIDTH, previousMonthWidth);
  renderRoadmaps();
  targetScroll.scrollLeft = Math.max(0, centerMonth * roadmapMonthWidth - viewportCenter);
}

function setProductZoom(nextZoom) {
  const previousZoom = clampViewZoom(zoom, PRODUCT_MIN_ZOOM, PRODUCT_MAX_ZOOM);
  const viewportX = canvasScroll.clientWidth / 2;
  const viewportY = (canvasScroll.clientHeight || 0) / 2;
  const centerX = (canvasScroll.scrollLeft + viewportX) / previousZoom;
  const centerY = (canvasScroll.scrollTop + viewportY) / previousZoom;
  zoom = clampViewZoom(nextZoom, PRODUCT_MIN_ZOOM, PRODUCT_MAX_ZOOM, previousZoom);
  renderBoard();
  canvasScroll.scrollLeft = Math.max(0, centerX * zoom - viewportX);
  canvasScroll.scrollTop = Math.max(0, centerY * zoom - viewportY);
  requestAnimationFrame(syncBoardNavigator);
}

function setRoadmapYearSpan(years) {
  if (![3, 5, 10].includes(years)) return;
  const startIndex = monthIndex(board.settings.roadmap.startMonth) ?? monthIndex(monthStringFromDate());
  const startYear = Math.floor(startIndex / 12);
  updateTimelineSettings({ startMonth: `${startYear}-01`, endMonth: `${startYear + years - 1}-12` });
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
  // An overview must remain readable. Additional lanes scroll vertically
  // instead of shrinking every card down to illegible labels.
  zoom = Math.max(.65, Math.min(1, fittedZoom));
  renderBoard();
  requestAnimationFrame(() => {
    canvasScroll.scrollTop = 0;
    syncLaneRail();
    syncBoardNavigator();
  });
}

function fitProductBoard() {
  const dimensions = getCanvasDimensions();
  const available = Math.max(1, canvasScroll.clientWidth - 18);
  const fittedZoom = Math.floor((available / dimensions.width) * 100) / 100;
  // Fit gives a readable overview instead of shrinking a long lane into dots.
  setProductZoom(Math.max(.65, Math.min(1, fittedZoom)));
}

function roadmapPoint(event, targetCanvas) {
  const rect = targetCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function hitRoadmapBar(targetCanvas, point) {
  const scroll = targetCanvas.parentElement;
  if (point.x < scroll.scrollLeft + ROADMAP_LEFT_WIDTH || point.y < scroll.scrollTop + ROADMAP_HEADER_HEIGHT) return null;
  const regions = roadmapHitRegions.get(targetCanvas) || [];
  return [...regions].reverse().find((region) => point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height);
}

function hitRoadmapRow(targetCanvas, point) {
  const scroll = targetCanvas.parentElement;
  if (point.y < scroll.scrollTop + ROADMAP_HEADER_HEIGHT) return null;
  return (roadmapRowRegions.get(targetCanvas) || []).find((region) => point.y >= region.y && point.y < region.y + region.height);
}

function announceRoadmapEdit(message) {
  const output = $("#roadmapEditAnnouncement");
  if (output) output.textContent = message;
}

function moveSelectedRoadmapRow(direction) {
  if (roadmapInteractionMode !== "dates") return;
  const group = roadmapGroups().find((item) => item.products.some((product) => product.id === selectedId));
  if (!group) return;
  const index = group.products.findIndex((product) => product.id === selectedId);
  const neighbor = group.products[index + direction];
  if (!neighbor) return;
  updateBoard((current) => {
    RoadmapInteraction.reorderProducts(current.products, selectedId, {
      family: group.family, beforeId: direction < 0 ? neighbor.id : null,
      afterId: direction > 0 ? neighbor.id : null, index: index + direction,
    });
  });
  announceRoadmapEdit(`${selectedProduct()?.name} moved ${direction < 0 ? "up" : "down"}.`);
}

function roadmapSnapIncrement() {
  return { month: 1, quarter: 3, half: 6 }[board.settings.roadmap.snap] || 1;
}

function syncRoadmapInteractionMode() {
  const adjusting = roadmapInteractionMode === "dates";
  $("#roadmapModePan")?.setAttribute("aria-pressed", String(!adjusting));
  $("#roadmapModeDates")?.setAttribute("aria-pressed", String(adjusting));
  for (const target of [roadmapCanvas, splitRoadmapCanvas]) target?.classList.toggle("is-adjusting-dates", adjusting);
  roadmapControls?.querySelector(".roadmap-edit-controls")?.classList.toggle("is-adjusting-dates", adjusting);
}

function setRoadmapInteractionMode(mode) {
  if (!["pan", "dates"].includes(mode)) return;
  roadmapDragState?.cancel?.();
  roadmapPanState?.cancel?.();
  roadmapInteractionMode = mode;
  syncRoadmapInteractionMode();
  renderRoadmaps();
  announceRoadmapEdit(mode === "dates" ? "Edit Mode is on. Drag product bars or their edges to change dates, or drag names to reorder. Press Escape to return to View Mode." : "View Mode is on. Drag anywhere on the timeline to browse.");
}

function bindRoadmapCanvas(targetCanvas, targetScroll, navigatorRefsFactory) {
  const feedback = document.createElement("div");
  feedback.className = "roadmap-drag-feedback hidden";
  document.body.append(feedback);
  let frame = null;

  function paintInteraction() {
    const dimensions = roadmapDimensions();
    const context = targetCanvas.getContext("2d");
    drawRoadmapTo(context, dimensions, targetCanvas, targetScroll, true, false);
    syncRoadmapNavigator(targetScroll, navigatorRefsFactory());
  }

  function showFeedback(drag) {
    const product = selectedProduct();
    if (!product || !drag.moved) { feedback.classList.add("hidden"); return; }
    if (drag.mode === "reorder") {
      const target = drag.dropTarget;
      const before = board.products.find((item) => item.id === target?.beforeId);
      feedback.textContent = target
        ? `${target.family} · ${before ? `Before ${before.name}` : "Last position"}`
        : "Move over a product row to place it";
    } else {
      const preview = PortfolioModel.mergeProductUpdate(product, { roadmap: roadmapDraft.roadmap });
      const start = preview.generalAvailabilityDate ? formatProductInfoDate(preview.generalAvailabilityDate) : roadmapLabel(preview.roadmap.startMonth);
      const end = preview.endManufacturingDate ? formatProductInfoDate(preview.endManufacturingDate) : roadmapLabel(preview.roadmap.endMonth);
      feedback.textContent = `Start · ${start}   →   End · ${end}`;
    }
    feedback.classList.remove("hidden");
    const viewport = targetScroll.getBoundingClientRect();
    const left = Math.max(viewport.left + 8, Math.min(drag.clientX + 16, viewport.right - feedback.offsetWidth - 8));
    const top = drag.clientY + 26 + feedback.offsetHeight > viewport.bottom
      ? drag.clientY - feedback.offsetHeight - 18 : drag.clientY + 26;
    feedback.style.left = `${left}px`;
    feedback.style.top = `${Math.max(viewport.top + ROADMAP_HEADER_HEIGHT + 4, top)}px`;
  }

  function tickInteraction() {
    frame = null;
    const drag = roadmapDragState;
    if (drag?.targetCanvas !== targetCanvas || !drag.moved) return;
    const viewport = targetScroll.getBoundingClientRect();
    const left = targetScroll.scrollLeft;
    const top = targetScroll.scrollTop;
    const edge = 48;
    const speed = (distance) => Math.min(18, Math.max(0, distance / 4));
    if (drag.mode === "reorder") {
      if (drag.clientY < viewport.top + ROADMAP_HEADER_HEIGHT + edge) targetScroll.scrollTop -= speed(viewport.top + ROADMAP_HEADER_HEIGHT + edge - drag.clientY);
      if (drag.clientY > viewport.bottom - edge) targetScroll.scrollTop += speed(drag.clientY - viewport.bottom + edge);
    } else {
      if (drag.clientX < viewport.left + ROADMAP_LEFT_WIDTH + edge) targetScroll.scrollLeft -= speed(viewport.left + ROADMAP_LEFT_WIDTH + edge - drag.clientX);
      if (drag.clientX > viewport.right - edge) targetScroll.scrollLeft += speed(drag.clientX - viewport.right + edge);
    }
    const point = roadmapPoint({ clientX: drag.clientX, clientY: drag.clientY }, targetCanvas);
    drag.pointY = point.y;
    if (drag.mode === "reorder") {
      drag.dropTarget = drag.clientX < viewport.left - 50 || drag.clientX > viewport.right + 50 || drag.clientY < viewport.top || drag.clientY > viewport.bottom + 50
        ? null : RoadmapInteraction.dropTarget(roadmapGroups(), drag.productId, point.y, {
          headerHeight: ROADMAP_HEADER_HEIGHT, groupHeaderHeight: ROADMAP_GROUP_HEADER_HEIGHT, rowHeight: ROADMAP_ROW_HEIGHT,
        });
    } else {
      const delta = drag.clientX - drag.startClientX + targetScroll.scrollLeft - drag.scrollLeft;
      const { start, end } = RoadmapInteraction.draftDates(drag, delta, roadmapMonthWidth, roadmapSnapIncrement());
      roadmapDraft = { productId: drag.productId, roadmap: { startMonth: monthString(start), launchMonth: monthString(start), endMonth: monthString(end) } };
    }
    paintInteraction();
    showFeedback(drag);
    if (left !== targetScroll.scrollLeft || top !== targetScroll.scrollTop) frame = requestAnimationFrame(tickInteraction);
  }

  function queueInteraction() {
    if (frame == null) frame = requestAnimationFrame(tickInteraction);
  }

  function beginRoadmapPan(event, productId = null) {
    roadmapPanState = {
      targetCanvas, targetScroll, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      scrollLeft: targetScroll.scrollLeft, scrollTop: targetScroll.scrollTop, moved: false, productId,
      cancel: () => finishRoadmapPointer(null, true),
    };
    targetCanvas.setPointerCapture(event.pointerId);
    targetScroll.classList.add("is-panning");
    targetCanvas.style.cursor = "grabbing";
  }

  targetCanvas.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const point = roadmapPoint(event, targetCanvas);
    const row = hitRoadmapRow(targetCanvas, point);
    const hit = hitRoadmapBar(targetCanvas, point);
    if (roadmapInteractionMode !== "dates") {
      event.preventDefault();
      targetCanvas.focus({ preventScroll: true });
      beginRoadmapPan(event, hit?.productId || row?.productId || null);
      return;
    }
    const rail = row && point.x >= targetScroll.scrollLeft + 48 && point.x < targetScroll.scrollLeft + ROADMAP_LEFT_WIDTH;
    if (!hit && !rail) { beginRoadmapPan(event); return; }
    event.preventDefault();
    stopRoadmapSlotEditing();
    selectedId = hit?.productId || row.productId;
    targetCanvas.focus({ preventScroll: true });
    renderInspector();
    renderSplitProduct();
    updateRoadmapEditControls();
    const within = (handle) => handle && point.x >= handle.x && point.x < handle.x + handle.width;
    const mode = rail ? "reorder" : within(hit.leftHandle) ? "start" : within(hit.rightHandle) ? "end" : "pending";
    const product = selectedProduct();
    const sourceRow = row || (roadmapRowRegions.get(targetCanvas) || []).find((item) => item.productId === product.id);
    roadmapDragState = {
      targetCanvas, targetScroll, pointerId: event.pointerId, productId: product.id, mode,
      startClientX: event.clientX, startClientY: event.clientY, clientX: event.clientX, clientY: event.clientY,
      scrollLeft: targetScroll.scrollLeft, sourceY: sourceRow.y, pointY: point.y, offsetY: point.y - sourceRow.y,
      sourceBar: hit, originalStart: monthIndex(product.roadmap.startMonth), originalEnd: monthIndex(product.roadmap.endMonth),
      moved: false, cancel: () => finishRoadmapPointer(null, true),
    };
    targetCanvas.setPointerCapture(event.pointerId);
    targetCanvas.style.cursor = mode === "start" || mode === "end" ? "ew-resize" : "grabbing";
    renderRoadmaps();
    renderStatus();
  });

  targetCanvas.addEventListener("pointermove", (event) => {
    if (roadmapPanState?.targetCanvas === targetCanvas && roadmapPanState.pointerId === event.pointerId) {
      const dx = event.clientX - roadmapPanState.startX;
      const dy = event.clientY - roadmapPanState.startY;
      if (Math.hypot(dx, dy) >= 5) roadmapPanState.moved = true;
      if (!roadmapPanState.moved) return;
      targetScroll.scrollLeft = roadmapPanState.scrollLeft - dx;
      targetScroll.scrollTop = roadmapPanState.scrollTop - dy;
      return;
    }
    const drag = roadmapDragState;
    if (drag?.targetCanvas === targetCanvas && drag.pointerId === event.pointerId) {
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (drag.mode === "pending") drag.mode = Math.abs(dy) > Math.abs(dx) ? "reorder" : "move";
      drag.moved = true;
      targetCanvas.style.cursor = drag.mode === "start" || drag.mode === "end" ? "ew-resize" : "grabbing";
      queueInteraction();
      return;
    }
    const point = roadmapPoint(event, targetCanvas);
    const hit = hitRoadmapBar(targetCanvas, point);
    const row = hitRoadmapRow(targetCanvas, point);
    const hoveredId = hit?.productId || row?.productId || null;
    targetCanvas.title = hoveredId ? board.products.find((product) => product.id === hoveredId)?.name || "" : "";
    const within = (handle) => handle && point.x >= handle.x && point.x < handle.x + handle.width;
    targetCanvas.style.cursor = roadmapInteractionMode === "dates" && hit && (within(hit.leftHandle) || within(hit.rightHandle)) ? "ew-resize" : "grab";
    if (roadmapHoveredProductId !== hoveredId) {
      roadmapHoveredProductId = hoveredId;
      paintInteraction();
    }
  });

  function finishRoadmapPointer(event, cancelled = false) {
    if (roadmapPanState?.targetCanvas === targetCanvas) {
      if (event && roadmapPanState.pointerId !== event.pointerId) return;
      const pan = roadmapPanState;
      roadmapPanState = null;
      targetScroll.classList.remove("is-panning");
      if (targetCanvas.hasPointerCapture(pan.pointerId)) targetCanvas.releasePointerCapture(pan.pointerId);
      if (!cancelled && !pan.moved) {
        if (pan.productId && board.products.some((product) => product.id === pan.productId)) {
          stopRoadmapSlotEditing();
          selectedId = pan.productId;
          renderInspector();
          renderSplitProduct();
          renderRoadmaps();
          renderStatus();
        } else clearSelection();
      }
      targetCanvas.style.cursor = "grab";
      return;
    }
    const drag = roadmapDragState;
    if (drag?.targetCanvas !== targetCanvas || (event && drag.pointerId !== event.pointerId)) return;
    if (!cancelled && drag.moved) tickInteraction();
    if (frame != null) cancelAnimationFrame(frame);
    frame = null;
    const draft = roadmapDraft;
    roadmapDragState = null;
    roadmapDraft = null;
    feedback.classList.add("hidden");
    targetCanvas.style.cursor = "grab";
    if (targetCanvas.hasPointerCapture(drag.pointerId)) targetCanvas.releasePointerCapture(drag.pointerId);
    if (!cancelled && drag.moved && (drag.mode === "reorder" ? drag.dropTarget : draft)) {
      updateBoard((current) => {
        // Freeze legacy date-sorted rows before any explicit timeline edit.
        roadmapGroupsForProducts(current.products).forEach((group) => group.products.forEach((product, order) => { product.roadmap.order = order; }));
        if (drag.mode === "reorder") RoadmapInteraction.reorderProducts(current.products, drag.productId, drag.dropTarget);
        else {
          const product = current.products.find((item) => item.id === draft.productId);
          if (product) Object.assign(product, PortfolioModel.mergeProductUpdate(product, { roadmap: draft.roadmap }));
        }
      }, { inspector: true });
      announceRoadmapEdit(drag.mode === "reorder" ? `${selectedProduct()?.name} moved to ${drag.dropTarget.family}.` : "Roadmap dates updated.");
    } else renderRoadmaps();
  }

  targetCanvas.addEventListener("pointerup", (event) => finishRoadmapPointer(event));
  targetCanvas.addEventListener("pointercancel", (event) => finishRoadmapPointer(event, true));
  targetCanvas.addEventListener("lostpointercapture", (event) => finishRoadmapPointer(event, true));
  targetCanvas.addEventListener("pointerleave", () => {
    if (roadmapDragState || roadmapPanState) return;
    roadmapHoveredProductId = null;
    paintInteraction();
  });
  targetCanvas.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (roadmapInteractionMode === "dates" || roadmapDragState || roadmapPanState)) {
      event.preventDefault();
      event.stopPropagation();
      setRoadmapInteractionMode("pan");
      return;
    }
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    if (event.altKey) { moveSelectedRoadmapRow(direction); return; }
    const products = roadmapGroups().flatMap((group) => group.products);
    const index = products.findIndex((product) => product.id === selectedId);
    const next = products[Math.max(0, Math.min(products.length - 1, index < 0 ? 0 : index + direction))];
    if (!next) return;
    selectedId = next.id;
    renderInspector();
    renderRoadmaps();
    renderStatus();
  });
  targetCanvas.addEventListener("dblclick", (event) => {
    const point = roadmapPoint(event, targetCanvas);
    const hit = hitRoadmapBar(targetCanvas, point);
    if (!hit) return;
    if (selectedId !== hit.productId) stopRoadmapSlotEditing();
    selectedId = hit.productId;
    renderInspector();
    renderSplitProduct();

    // Double-click keeps the existing shortcut to the product details pane.
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

function productDetailsModel(product) {
  const source = normalizeAscmProductMetadata(product.ascm);
  const roadmap = product.roadmap || {};
  const lane = board.lanes.find((item) => item.id === product.laneId);
  const launchMonth = roadmap.startMonth || roadmap.launchMonth;
  const gaMonth = normalizeProductInfoDate(product.generalAvailabilityDate).slice(0, 7);
  const emMonth = normalizeProductInfoDate(product.endManufacturingDate).slice(0, 7);
  const plannedDates = [];
  const plannedMonthDiffers = (value, exactMonth) => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value !== exactMonth;
  if (plannedMonthDiffers(launchMonth, gaMonth)) {
    plannedDates.push({ key: "launch", label: "Planned launch", value: roadmapLabel(launchMonth) });
  }
  if (plannedMonthDiffers(roadmap.endMonth, emMonth)) {
    plannedDates.push({ key: "lifecycle-end", label: "Planned end", value: roadmapLabel(roadmap.endMonth) });
  }
  return {
    id: product.id,
    dates: [
      ["general-availability", "General availability", product.generalAvailabilityDate], ["end-manufacturing", "End of manufacturing", product.endManufacturingDate],
      ["ffs", "FFS", product.ffsDate], ["global-announcement", "Global announcement", product.globalAnnouncementDate],
      ["web-readiness", "Web readiness", product.webReadinessDate], ["final-assets", "Final assets", product.finalAssetsDate],
    ].map(([key, label, value]) => ({ key, label, value: formatProductInfoDate(value), empty: !value })),
    lifecycle: [
      ...plannedDates,
      { key: "stage", label: "Stage", value: splitRoadmapStatusLabel(roadmap.status) },
      { key: "confidence", label: "Confidence", value: roadmap.confidence || "Not set" },
    ],
    skus: productPartSkus(product).map((sku) => ({ code: sku.code, colors: PortfolioModel.resolveSkuColors(sku, product) })),
    specs: product.specs,
    identity: [
      { label: "Category", value: activeCategoryRecord()?.name || categoryDefinition().name },
      { label: "Lane", value: lane?.label || "Unassigned" },
      { label: "Codename", value: product.codename || "Not set", empty: !product.codename },
      { label: "Tier", value: productTier(product), empty: !product.tier },
      { label: "Family", value: roadmap.family || "Not set" },
    ],
    variants: productVariantGroups(product).flatMap((group) => group.items.map((item) => ({
      group: group.label, code: item.code, label: group.type === "layout" ? item.label : "",
      colors: group.type === "color" ? [{ ...item, label: [item.colorName, item.colorName2].filter(Boolean).join(" / ") || item.code }] : [],
    }))),
    source: {
      category: source?.sourceCategory || "ASCM", imported: source?.importedAt ? formatProductInfoDate(source.importedAt.slice(0, 10)) : "TBD",
      records: (source?.records || []).map((record) => ({ code: record.basePartNumber, description: record.fullProductName || "", ga: formatProductInfoDate(record.generalAvailabilityDate), em: formatProductInfoDate(record.endManufacturingDate) })),
    },
  };
}

function renderSplitProduct() {
  if (!splitProduct) return;
  const product = selectedProduct();
  if (!product) {
    splitProduct.replaceChildren();
    return;
  }
  const presentation = productPresentation(product);
  splitProduct.innerHTML = `
    <article class="split-product-card split-product-card--detail" style="--product-highlight:${escapeHtml(presentation.outlineColor)}">
      ${presentation.primaryLabel ? `<div class="split-status" style="background:${escapeHtml(presentation.primaryColor)};color:${escapeHtml(contrastTextColor(presentation.primaryColor))}">${escapeHtml(presentation.primaryLabel)}</div>` : ''}
      <div class="split-product-hero">
        <img class="split-product-image" src="${escapeHtml(productImageSource(product))}" alt="">
        <div class="split-product-title"><span class="eyebrow">${escapeHtml(product.roadmap?.family || 'Portfolio product')}</span><h2>${escapeHtml(product.name)}</h2>${presentation.secondaryLabel ? `<span class="split-platform-label">${escapeHtml(presentation.secondaryLabel)}</span>` : ''}${portfolio.settings?.showRoadmapMsrp && productPriceText(product) ? `<div class="split-price">${escapeHtml(productPriceText(product))}</div>` : ''}</div>
      </div>
      <div class="split-product-body">${PortfolioDetails.render(productDetailsModel(product), { surface: 'split' })}</div>
    </article>`;
  PortfolioDetails.bind(splitProduct, { onCopy: copyTextToClipboard });
}
function updateLinkedViewButton() {
  const hasSelection = Boolean(selectedProduct());
}

function updateDataEditIndicator() {
  const editing = Boolean(inspectorOpen || roadmapDragState || productLayoutEditing);
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
  syncRoadmapInteractionMode();
  const product = selectedProduct();
  const group = roadmapGroups().find((item) => item.products.some((item) => item.id === product?.id));
  const index = group?.products.findIndex((item) => item.id === product?.id) ?? -1;
  $("#roadmapMoveUp").disabled = roadmapInteractionMode !== "dates" || index <= 0;
  $("#roadmapMoveDown").disabled = roadmapInteractionMode !== "dates" || index < 0 || index >= group.products.length - 1;
  if (roadmapMenuButton) {
    roadmapMenuButton.classList.remove("is-active");
    roadmapMenuButton.innerHTML = 'Timeline <span aria-hidden="true">▾</span>';
  }
  updateDataEditIndicator();
}

function stopRoadmapSlotEditing() {
  roadmapDragState?.cancel?.();
  roadmapDragState = null;
  roadmapDraft = null;
  updateRoadmapEditControls();
}

function syncRoadmapDetailsVisibility() {
  const hasSelection = Boolean(selectedProduct()) && visibleRoadmapProducts().some((product) => product.id === selectedId);
  const showing = activeView !== "products" && roadmapDetailsOpen && hasSelection;
  if (activeView !== "products") activeView = showing ? "split" : "roadmap";
  roadmapView.classList.toggle("hidden", activeView !== "roadmap");
  splitView.classList.toggle("hidden", activeView !== "split");
  const toggle = $("#toggleRoadmapDetails");
  toggle.classList.toggle("hidden", activeView === "products");
  toggle.disabled = !hasSelection;
  toggle.textContent = showing ? "Hide product details" : "Show product details";
  toggle.setAttribute("aria-expanded", String(showing));
  toggle.setAttribute("aria-pressed", String(showing));
}

function setView(view, { focusSelected = false } = {}) {
  closePopupMenus();
  roadmapPanState?.cancel?.();
  roadmapInteractionMode = "pan";
  if (view === "split") roadmapDetailsOpen = true;
  activeView = view === "products" ? "products" : ["roadmap", "split"].includes(view) ? (roadmapDetailsOpen ? "split" : "roadmap") : "products";
  if (activeView === "products") stopRoadmapSlotEditing();
  else if (productLayoutEditing) {
    productLayoutEditing = false;
    updateProductLayoutEditControls();
  }
  productView.classList.toggle("hidden", activeView !== "products");
  roadmapView.classList.toggle("hidden", activeView !== "roadmap");
  splitView.classList.toggle("hidden", activeView !== "split");
  syncRoadmapDetailsVisibility();
  productControls.classList.toggle("hidden", activeView !== "products");
  roadmapControls.classList.toggle("hidden", activeView === "products");
  document.querySelectorAll(".view-tab").forEach((button) => {
    const active = button.dataset.view === (activeView === "products" ? "products" : "roadmap");
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  updateLinkedViewButton();
  updateRoadmapEditControls();
  updateProductLayoutEditControls();
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
  const laneRows = dimensions.laneRows || productLaneGeometry(layout).rows;
  laneRailInner.innerHTML = laneRows.map(({ lane, top: laneTop, contentHeight }) => {
    const top = (laneTop - 4) * zoom;
    const height = (contentHeight + 8) * zoom;
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
  zoom = clampViewZoom(zoom, PRODUCT_MIN_ZOOM, PRODUCT_MAX_ZOOM);
  const previousLeft = canvasScroll.scrollLeft;
  const previousTop = canvasScroll.scrollTop;
  const { context, dimensions } = setupCanvas(canvas, zoom);
  drawBoardTo(context, dimensions, true);
  renderLaneRail(dimensions);
  canvasScroll.scrollLeft = previousLeft;
  canvasScroll.scrollTop = previousTop;
  syncViewZoomControls();
  renderStatus();
  positionViewerInfo();
  requestAnimationFrame(syncBoardNavigator);
}

function renderStatus() {
  $("#statusbar").innerHTML = '<div id="statusbarPackage" class="statusbar-package" aria-label="Last update"></div>';
  publishWorkspaceState();
}

function publishWorkspaceState() {
  if (!portfolio || !board) return;
  window.dispatchEvent(new CustomEvent("portfolio:render", { detail: {
    categories: portfolio.categories.map((category) => ({ id: category.id, name: category.name, count: category.board.products.length })),
    activeCategoryId, title: board.title, selectedName: selectedProduct()?.name || "", productCount: board.products.length,
    visibleCount: activeView === "products" ? visibleProducts().length : visibleRoadmapProducts().length,
    activeView: activeView === "products" ? "products" : "roadmap", roadmapDetailsOpen, timeline: portfolio.settings.timeline,
  } }));
}

function selectedProduct() {
  return board.products.find((product) => product.id === selectedId) || null;
}

function showWorkspaceNotice(message, { id = "workspace-operation", title = "Notice", severity = "error", actions = [] } = {}) {
  if (!globalThis.PortfolioNotifications) return PortfolioDialogs.alert(message, { title });
  globalThis.PortfolioNotifications.publish({ id, title, severity, message: String(message), actions, revision: Date.now(), toast: severity === "success" });
  if (severity === "error") globalThis.PortfolioNotifications.show(id);
  return Promise.resolve();
}

function openProductIssue(located, { focus = {} } = {}) {
  if (packageOperationInProgress) throw new Error("Finish loading the package before opening a product.");
  const { category, product } = located;
  if (!portfolio.categories.includes(category) || !category.board.products.includes(product)) {
    throw new Error("This product has changed. Review duplicates again to get its current location.");
  }
  const sameId = portfolio.categories.flatMap((item) => item.board.products).filter((item) => item.id === product.id);
  if (sameId.length !== 1) {
    throw new Error(`The package repeats the internal ID for “${product.name}”. Correct the IDs in the source package and re-import it before editing these records. The duplicate list shows each record's category and lane.`);
  }
  closeAscmImportDialog({ retainIssues: true });
  activateCategory(category.id, { render: false });
  selectedId = product.id;
  setView("products", { focusSelected: true });
  openInspector(focus.section === "variantGroups" ? "variantsSection" : "productInformationSection");
  requestAnimationFrame(() => {
    let field = inspector.querySelector("#fieldName");
    if (focus.section === "partSkus") {
      field = inspector.querySelectorAll(".part-sku-row")[focus.rowIndex]?.querySelector("[data-part-sku-code]");
    } else if (focus.section === "variantGroups") {
      const group = inspector.querySelectorAll("[data-variant-group-id]")[focus.groupIndex];
      field = group?.querySelectorAll("[data-variant-item-id]")[focus.rowIndex]?.querySelector('[data-variant-field="code"]');
    }
    if (!field) return;
    field.scrollIntoView({ block: "center", behavior: "smooth" });
    field.focus({ preventScroll: true });
    field.classList.add("product-issue-target");
    setTimeout(() => field.classList.remove("product-issue-target"), 5000);
  });
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

function renderViewerInfo() {
  if (!viewerInfo) return;
  const product = infoProduct();
  const visible = Boolean(product && (viewerInfoOpen || viewerInfoProgress > .001));
  viewerInfo.classList.toggle('is-open', visible);
  viewerInfo.setAttribute('aria-hidden', String(!visible));
  if (!visible || !product) {
    if (!viewerInfoOpen && viewerInfoProgress <= .001) viewerInfo.innerHTML = '';
    if (viewerInfoOutline) { viewerInfoOutline.classList.remove('is-open'); viewerInfoOutline.style.width = '0px'; }
    return;
  }
  viewerInfo.innerHTML = `<div class="viewer-info-body"><div class="viewer-detail-heading"><div class="viewer-detail-title"><span class="viewer-detail-eyebrow">Product details</span><h2>${escapeHtml(product.name)}</h2></div><button type="button" class="icon-button viewer-detail-close" data-detail-close aria-label="Close product information">×</button></div>${PortfolioDetails.render(productDetailsModel(product), { surface: 'viewer' })}</div>`;
  setViewerInfoSize(viewerInfoVisualWidth(), viewerInfoVisualHeight());
  PortfolioDetails.bind(viewerInfo, { onCopy: copyTextToClipboard, onClose: closeViewerInfo });
}
function positionViewerInfo() {
  if (!viewerInfo || !viewerInfoProductId || activeView !== "products" || viewerInfoProgress <= 0) return null;
  const card = renderedCards.find((item) => item.productId === viewerInfoProductId);
  viewerInfo.classList.toggle("is-open", Boolean(card));
  viewerInfo.setAttribute("aria-hidden", String(!card));
  if (!card) return null;
  const height = card.height * zoom;
  const width = viewerInfoVisualWidth(height);
  const left = (card.x + card.width) * zoom + 10;
  const top = card.y * zoom;
  const hiddenPercent = Math.max(0, Math.min(100, (1 - viewerInfoProgress) * 100));
  const visibleWidth = width * viewerInfoProgress;

  setViewerInfoSize(width, height);
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
    targetLeft = placement.paneLeft - padding;
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

function openViewerInfo(productId = selectedId, { onReady } = {}) {
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
    animateViewerInfo(1, () => requestAnimationFrame(() => { revealViewerInfoBesideProduct(); onReady?.(); }));
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
  const changed = Boolean(selectedId || inspectorOpen || roadmapDragState || viewerInfoProductId);
  selectedId = null;
  inspectorOpen = false;
  closeViewerInfo({ render: false });
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
  select.value = [...select.options].some((item) => item.value === normalized) ? normalized : "custom";
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
    <div class="variant-item color-variant-item" data-variant-item-id="${escapeHtml(item.id)}">
      <span class="sku-color-preview ${hasSecondary ? "is-dual" : ""}" style="--sku-primary:${escapeHtml(item.colorHex)};--sku-secondary:${escapeHtml(item.colorHex2 || item.colorHex)}" aria-hidden="true"></span>
      <label class="variant-code-field">SKU code<input data-variant-field="code" value="${escapeHtml(item.code)}" aria-label="Variant ${index + 1} SKU code"></label>
      <label>Primary color<select data-color-role="primary">${standardProductColorOptionsHtml(item.colorKey)}</select></label>
      ${primaryCustom ? `<label>Custom primary name<input data-variant-field="colorName" value="${escapeHtml(item.colorName)}"></label><label>Custom primary color<input data-variant-field="colorHex" class="color-input" type="color" value="${escapeHtml(item.colorHex)}"></label>` : ""}
      <label class="sku-dual-toggle"><input data-variant-dual type="checkbox" ${hasSecondary ? "checked" : ""}>Two-tone colorway</label>
      ${hasSecondary ? `<label>Secondary color<select data-color-role="secondary">${standardProductColorOptionsHtml(item.colorKey2)}</select></label>` : ""}
      ${hasSecondary && secondaryCustom ? `<label>Custom secondary name<input data-variant-field="colorName2" value="${escapeHtml(item.colorName2)}"></label><label>Custom secondary color<input data-variant-field="colorHex2" class="color-input" type="color" value="${escapeHtml(item.colorHex2 || "#ffffff")}"></label>` : ""}
      <button data-remove-variant="${escapeHtml(item.id)}" class="icon-button variant-remove" aria-label="Remove color variant ${index + 1}">×</button>
    </div>`;
}

function layoutVariantEditorHtml(group, item, index) {
  return `
    <div class="variant-item layout-variant-item" data-variant-item-id="${escapeHtml(item.id)}">
      <label>Common layout<select data-layout-preset>${keyboardLayoutOptionsHtml(item.code)}</select></label>
      <label>Layout SKU code<input data-variant-field="code" value="${escapeHtml(item.code)}" aria-label="Layout variant ${index + 1} code"></label>
      <label>Display name<input data-variant-field="label" value="${escapeHtml(item.label || "")}" placeholder="Optional full market or locale name"></label>
      <button data-remove-variant="${escapeHtml(item.id)}" class="icon-button variant-remove" aria-label="Remove layout variant ${index + 1}">×</button>
    </div>`;
}

function variantGroupsEditorHtml(product) {
  const groups = productVariantGroups(product);
  return `
    <section id="variantsSection" class="panel-section">
      <div class="section-heading-row"><div><h3>Product variants</h3><p class="section-subtitle">Use compact layout codes for keyboard markets and named colors for product colorways.</p></div><button id="addVariantGroup" class="small-button">+ Group</button></div>
      <div class="variant-group-list">${groups.length ? groups.map((group, groupIndex) => `
        <div class="variant-group-card" data-variant-group-id="${escapeHtml(group.id)}">
          <div class="variant-group-heading">
            <label>Footer label<input data-variant-group-field="label" value="${escapeHtml(group.label)}" aria-label="Variant group ${groupIndex + 1} label"></label>
            <label>Variant type<select data-variant-group-field="type">
              <option value="color" ${group.type === "color" ? "selected" : ""}>Color SKU</option>
              <option value="layout" ${group.type === "layout" ? "selected" : ""}>Layout / locale SKU</option>
            </select></label>
            ${group.type === "layout" ? `<button data-add-layout-set="${escapeHtml(group.id)}" class="small-button">+ Common set</button>` : ""}
            <button data-add-variant="${escapeHtml(group.id)}" class="small-button">+ Variant</button>
            <button data-remove-variant-group="${escapeHtml(group.id)}" class="icon-button" aria-label="Remove variant group ${groupIndex + 1}">×</button>
          </div>
          <div class="variant-item-list">${group.items.length
            ? group.items.map((item, index) => group.type === "layout" ? layoutVariantEditorHtml(group, item, index) : colorVariantEditorHtml(group, item, index)).join("")
            : '<div class="empty-list">No variants in this group</div>'}</div>
        </div>`).join("") : '<div class="empty-list">No product variants</div>'}</div>
    </section>`;
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
  if (sectionId) editorActiveTab = sectionId === "specificationsSection" ? "specs" : sectionId === "variantsSection" ? "variants" : sectionId === "roadmapSection" ? "timeline" : "details";
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
  const restoreEditorFocus = inspector.contains(document.activeElement);
  inspectorOpen = false;
  updateDataEditIndicator();
  applyInspectorState(!selectedProduct());
  if (activeView === "products") renderBoard();
  if (restoreEditorFocus) $("#quickEditSelected")?.focus();
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

function setupEditorNavigation() {
  const definitions = [["details", "Details"], ["images", "Images"], ["specs", "Specs"], ["variants", "Variants"], ["timeline", "Timeline"]];
  const sections = [...inspector.querySelectorAll(":scope > .panel-section")];
  const navigation = document.createElement("div");
  navigation.className = "editor-tabs";
  navigation.setAttribute("role", "tablist");
  navigation.setAttribute("aria-label", "Product editor sections");
  navigation.innerHTML = definitions.map(([key, label]) => `<button type="button" role="tab" id="editor-tab-${key}" data-editor-tab="${key}" aria-controls="editor-panel-${key}">${label}</button>`).join("");
  inspector.querySelector(".inspector-heading").after(navigation);
  for (const [key] of definitions) {
    const panel = document.createElement("div");
    panel.id = `editor-panel-${key}`;
    panel.dataset.editorPanel = key;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `editor-tab-${key}`);
    inspector.append(panel);
    for (const section of sections) {
      const tab = section.id === "productImagesSection" || section.classList.contains("colorway-hero-section") ? "images"
        : section.id === "specificationsSection" ? "specs"
        : section.id === "variantsSection" ? "variants" : section.id === "roadmapSection" ? "timeline" : "details";
      if (tab === key) panel.append(section);
    }
  }
  const setEditorTab = (key, focus = false) => {
    editorActiveTab = key;
    inspector.querySelectorAll("[data-editor-tab]").forEach((button) => {
      const active = button.dataset.editorTab === key;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    inspector.querySelectorAll("[data-editor-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.editorPanel !== key));
  };
  navigation.querySelectorAll("[data-editor-tab]").forEach((button, index) => {
    button.onclick = () => { setEditorTab(button.dataset.editorTab); inspector.scrollTop = 0; };
    button.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? definitions.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + definitions.length) % definitions.length;
      setEditorTab(definitions[next][0], true);
    };
  });
  setEditorTab(editorActiveTab);
}

function renderInspector() {
  const product = selectedProduct();
  if (!product) {
    applyInspectorState(true);
    inspector.innerHTML = "<h2>Product details</h2><p>Select a product, then choose Edit product to update its information.</p>";
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
        <button id="mergeProduct" type="button" title="Combine information from another product">Merge</button>
        <button id="deleteProduct" class="danger-button">Delete</button>
        <button id="closeInspector" class="icon-button" aria-label="Close editor">×</button>
      </div>
    </div>
    <section id="productDetailsSection" class="panel-section">
      <h3>Product</h3>
      <label>Name<input id="fieldName" value="${escapeHtml(product.name)}"></label>
      <div class="two-column">
        <label>MSRP (USD)<input id="fieldPrice" type="number" min="0" step="0.01" value="${escapeHtml(product.price ?? "")}"></label>
        <label>Lane<select id="fieldLane">${sortedLanes().map((lane) => `<option value="${escapeHtml(lane.id)}" ${lane.id === product.laneId ? "selected" : ""}>${escapeHtml(lane.label)}</option>`).join("")}</select></label>
      </div>
      <label>Price label when MSRP is blank<input id="fieldPriceLabel" value="${escapeHtml(product.priceLabel || "")}" placeholder="Example: $ Varies or Contact sales"></label>
    </section>
    <section id="productImagesSection" class="panel-section">
      <h3>Product image</h3>
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
          <label class="portfolio-date-field">General availability (GA)
            <span class="portfolio-date-control">
              <input id="fieldGeneralAvailabilityDate" type="date" value="${escapeHtml(product.generalAvailabilityDate || "")}">
              <button id="fieldGeneralAvailabilityDateTbd" class="date-tbd-button" type="button" title="Clear the date and mark it TBD">TBD</button>
            </span>
          </label>
          <label class="portfolio-date-field">End of manufacturing (EM)
            <span class="portfolio-date-control">
              <input id="fieldEndManufacturingDate" type="date" value="${escapeHtml(product.endManufacturingDate || "")}">
              <button id="fieldEndManufacturingDateTbd" class="date-tbd-button" type="button" title="Clear the date and mark it TBD">TBD</button>
            </span>
          </label>
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
        <p class="field-help date-field-help">GA sets the roadmap launch month; EM sets its end month. Leave a date blank or select <strong>TBD</strong> when the exact day is not determined.</p>
        <p id="productDateFeedback" class="field-help date-feedback" role="status" aria-live="polite"></p>
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
            <select data-part-sku-variant aria-label="Color for HP SKU ${index + 1}">
              <option value="">Use ASCM color when available</option>
              ${productColorVariants(product).map((variant) => `<option value="${escapeHtml(variant.id)}" ${item.variantId === variant.id ? "selected" : ""}>${escapeHtml([variant.colorName, variant.colorName2].filter(Boolean).join(" / ") || variant.code)}</option>`).join("")}
            </select>
            <button type="button" class="part-sku-copy" data-copy-editor-sku title="Copy HP SKU">Copy</button>
            <button type="button" class="icon-button part-sku-remove" data-remove-part-sku aria-label="Remove HP SKU ${index + 1}">×</button>
          </div>`).join("") : '<div class="empty-list">No HP SKUs</div>'}</div>
      </div>
    </section>
    ${colorwayHeroImagesEditorHtml(product)}
    <section class="panel-section">
      <h3>Status and variant label</h3>
      <label>Status<select id="fieldStatus">
        <option value="none" ${product.statusType === "none" ? "selected" : ""}>None</option>
        <option value="new" ${product.statusType === "new" ? "selected" : ""}>New product</option>
        <option value="embargo" ${product.statusType === "embargo" ? "selected" : ""}>Upcoming under embargo</option>
      </select></label>
      <p class="standard-status-note">New Product uses teal and Upcoming Under Embargo uses red. These theme accents are shared with the timeline.</p>
      <label class="checkbox-label"><input id="fieldVariantEnabled" type="checkbox" ${product.variantLabel ? "checked" : ""}>Show a platform or variant label</label>
      <div id="variantBannerFields" class="${product.variantLabel ? "" : "is-disabled"}">
        <label>Variant label<input id="fieldVariantLabel" value="${escapeHtml(product.variantLabel || "")}" placeholder="PLAYSTATION, XBOX, SUNSETTING…"></label>
        <p class="standard-status-note">Status uses the main banner. Platform or variant labels appear as a subtle secondary badge when a status is set.</p>
      </div>
    </section>
    <section id="roadmapSection" class="panel-section">
      <div class="section-heading-row"><h3>Roadmap slotting</h3><span class="eyebrow">Shared across views</span></div>
      <div class="roadmap-section-grid">
        <label class="full">Product family<input id="fieldRoadmapFamily" value="${escapeHtml(product.roadmap.family)}" placeholder="Cloud, Stinger, Jet…"></label>
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
          ${board.products.filter((item) => item.id !== product.id).map((item) => `<option value="${escapeHtml(item.id)}" ${product.roadmap.predecessorId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
        </select></label>
        <label>Successor<select id="fieldRoadmapSuccessor">
          <option value="">None</option>
          ${board.products.filter((item) => item.id !== product.id).map((item) => `<option value="${escapeHtml(item.id)}" ${product.roadmap.successorId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
        </select></label>
      </div>
      <button id="editProductDates" type="button" class="secondary-button">Edit dates in Details</button>
      <p class="roadmap-inline-note">Manage launch and manufacturing end dates in Details. Date edits also update the roadmap; dragging its bar updates any known exact dates. Products with TBD dates keep their planned months.</p>
    </section>
    <section id="specificationsSection" class="panel-section">
      <div class="section-heading-row"><h3>Specifications</h3><button id="addSpec" class="small-button">+ Add</button></div>
      <div class="common-spec-set">
        <label>Category common set<select id="specSetSelect">${categorySpecSets().map((set) => `<option value="${escapeHtml(set.id)}">${escapeHtml(set.label)}</option>`).join("")}</select></label>
        <button id="addSpecSet" class="small-button" type="button">+ Add missing fields</button>
      </div>
      <div class="stack-list">${product.specs.length ? product.specs.map((item, index) => `
        <div class="editable-row" data-spec-id="${escapeHtml(item.id)}">
          <input data-spec-field="label" value="${escapeHtml(item.label)}" aria-label="Specification ${index + 1} label">
          <input data-spec-field="value" value="${escapeHtml(item.value)}" aria-label="Specification ${index + 1} value">
          <button data-remove-spec="${escapeHtml(item.id)}" class="icon-button" aria-label="Remove specification ${index + 1}">×</button>
        </div>`).join("") : '<div class="empty-list">No specifications</div>'}</div>
    </section>
    ${variantGroupsEditorHtml(product)}
`;

  setupEditorNavigation();

  $("#deleteProduct").onclick = deleteSelected;
  $("#mergeProduct").onclick = () => globalThis.PortfolioProductMergeUI?.open({ productId: product.id });
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
      const current = selectedProduct();
      if (!current || current.id !== product.id) return;
      const value = normalizeProductInfoDate(input.value);
      const ga = fieldName === "generalAvailabilityDate" ? value : current.generalAvailabilityDate;
      const em = fieldName === "endManufacturingDate" ? value : current.endManufacturingDate;
      const invalidRange = ["generalAvailabilityDate", "endManufacturingDate"].includes(fieldName) && ga && em && em < ga;
      if (!input.validity.valid || invalidRange) {
        $("#productDateFeedback").textContent = invalidRange ? "End of manufacturing must be on or after general availability. The previous date was kept." : "Enter a complete, valid date. The previous date was kept.";
        input.value = current[fieldName] || "";
        syncTbdState();
        return;
      }
      $("#productDateFeedback").textContent = "";
      updateProduct(product.id, { [fieldName]: value }, false);
      syncTbdState();
    });

    tbdButton.addEventListener("click", () => {
      input.value = "";
      $("#productDateFeedback").textContent = "";
      updateProduct(product.id, { [fieldName]: "" }, false);
      syncTbdState();
    });

    syncTbdState();
  };

  bindProductDate("#fieldFfsDate", "#fieldFfsDateTbd", "ffsDate");
  bindProductDate("#fieldGeneralAvailabilityDate", "#fieldGeneralAvailabilityDateTbd", "generalAvailabilityDate");
  bindProductDate("#fieldEndManufacturingDate", "#fieldEndManufacturingDateTbd", "endManufacturingDate");
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
    row.querySelector("[data-part-sku-variant]").addEventListener("change", (event) => updatePartSkus(product.id, (items) => items.map((item) => (
      item.id === partSkuId ? { ...item, variantId: event.target.value, colorCode: "" } : item
    )), false));

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
  bindValue("#fieldRoadmapFamily", "input", (value) => updateRoadmap(product.id, { family: value || "Other" }));
  $("#editProductDates").onclick = () => {
    inspector.querySelector('[data-editor-tab="details"]').click();
    const field = $("#fieldGeneralAvailabilityDate");
    field.scrollIntoView({ block: "center", behavior: "smooth" });
    field.focus({ preventScroll: true });
  };
  bindValue("#fieldRoadmapStatus", "change", (value) => updateRoadmap(product.id, { status: value }));
  bindValue("#fieldRoadmapConfidence", "change", (value) => updateRoadmap(product.id, { confidence: value }));
  bindValue("#fieldRoadmapPredecessor", "change", (value) => updateRoadmap(product.id, { predecessorId: value }));
  bindValue("#fieldRoadmapSuccessor", "change", (value) => updateRoadmap(product.id, { successorId: value }));
  $("#fieldImageUpload").onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.disabled = true;
    try {
      const imageAssetId = await createLocalImageAsset(file, product.name);
      await setProductImageAsset(product.id, imageAssetId);
    } catch (error) {
      void PortfolioDialogs.alert(error.message || "Unable to save the image.", { title: "Image upload failed" });
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
        void PortfolioDialogs.alert(error.message || "Unable to store the colorway image.", { title: "Image upload failed" });
      }
    });
    if (clearButton) clearButton.onclick = () => setVariantImageAsset(product.id, variantId, "");
  });
  $("#addSpec").onclick = () => {
    const current = selectedProduct();
    if (current?.id === product.id) updateProduct(product.id, { specs: [...current.specs, spec("Feature", "Value")] }, true);
  };
  inspector.querySelectorAll("[data-spec-id]").forEach((row) => {
    const specId = row.dataset.specId;
    row.querySelectorAll("[data-spec-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const current = selectedProduct();
        if (!current || current.id !== product.id) return;
        updateProduct(product.id, { specs: current.specs.map((item) => item.id === specId ? { ...item, [input.dataset.specField]: input.value } : item) }, false);
      });
    });
    row.querySelector("[data-remove-spec]").addEventListener("click", () => {
      const current = selectedProduct();
      if (current?.id === product.id) updateProduct(product.id, { specs: current.specs.filter((item) => item.id !== specId) }, true);
    });
  });
  if ($("#addSpecSet")) $("#addSpecSet").onclick = () => {
    const current = selectedProduct();
    if (current?.id !== product.id) return;
    const selectedSet = categorySpecSets().find((set) => set.id === $("#specSetSelect")?.value);
    if (!selectedSet) return;
    const existingLabels = new Set(current.specs.map((item) => String(item.label || "").trim().toLowerCase()));
    const additions = selectedSet.specs
      .filter(([label]) => !existingLabels.has(String(label).trim().toLowerCase()))
      .map(([label, value]) => spec(label, value));
    if (!additions.length) {
      void PortfolioDialogs.alert("This product already contains every field in the selected common set.", { title: "Specifications already added" });
      return;
    }
    updateProduct(product.id, { specs: [...current.specs, ...additions] }, true);
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
    current.products[index] = PortfolioModel.mergeProductUpdate(existing, patch);
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
    Object.assign(product, PortfolioModel.mergeProductUpdate(product, { roadmap: patch }));
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
  const deleting = selectedProduct();
  const deletingBoard = board;
  if (!deleting || !await PortfolioDialogs.confirm(`Delete "${deleting.name}" from this category?`, { title: "Delete product?", confirmLabel: "Delete product", danger: true })) return;
  if (board !== deletingBoard || !board.products.some((item) => item.id === deleting.id)) return;
  const sharedRecord = portfolio.masterLocalBaseline?.some((item) => item.productId === deleting.id);
  if (sharedRecord) {
    portfolio.masterLocalRemovedProducts ||= {};
    portfolio.masterLocalRemovedProducts[deleting.id] = JSON.parse(JSON.stringify(deleting));
  }
  const imageAssetIds = new Set([deleting?.imageAssetId, ...productColorVariants(deleting).map((item) => item.imageAssetId)].filter(Boolean));
  updateBoard((current) => {
    const product = current.products.find((item) => item.id === deleting.id);
    current.products = current.products.filter((item) => item.id !== deleting.id);
    if (product) normalizeLaneOrders(product.laneId);
  });
  selectedId = board.products[0]?.id ?? null;
  pinnedHeroVariantByProduct.delete(deleting?.id);
  if (!sharedRecord) imageAssetIds.forEach((assetId) => { void removeImageAssetIfUnused(assetId); });
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
  $("#roadmapStart").value = board.settings.roadmap.startMonth;
  $("#roadmapEnd").value = board.settings.roadmap.endMonth;
  $("#roadmapSnap").value = board.settings.roadmap.snap;
  $("#roadmapShowMsrp").checked = portfolio.settings?.showRoadmapMsrp === true;
  const pricedProducts = portfolio.categories.flatMap((category) => category.board.products).filter((product) => productPriceText(product));
  const totalProducts = portfolio.categories.reduce((total, category) => total + category.board.products.length, 0);
  $("#pricingAvailability").textContent = `${pricedProducts.length} of ${totalProducts} products have a saved price. Missing prices stay blank; add MSRP in the product editor.`;
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
    canvas.style.cursor = heroVariant || variantOverflow || infoButton
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
  const rows = productLaneGeometry().rows;
  const targetRow = rows.reduce((closest, row) => Math.abs(current.position.y - row.top) < Math.abs(current.position.y - closest.top) ? row : closest, rows[0]);
  const targetIndex = Math.max(0, Math.round((current.position.x - GUTTER) / (CARD_WIDTH + CARD_GAP)));
  if (targetRow) reorderProduct(current.productId, targetRow.lane.id, targetIndex);
}
canvas.addEventListener("pointerup", finishDrag);
canvas.addEventListener("pointercancel", finishDrag);
canvas.addEventListener("dblclick", (event) => {
  const point = canvasPoint(event);
  if (hitVariantOverflow(point) || hitHeroVariant(point) || hitInfoButton(point)) return;
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


function packageCodec() {
  if (!globalThis.PortfolioPackage) throw new Error("The package tools did not load. Refresh the page and try again.");
  return globalThis.PortfolioPackage;
}

function getCurrentPackageInfo() {
  try { return packageCodec().normalizePackageInfo(portfolio?.packageInfo); }
  catch (_) { return null; }
}

function validatePackageManifest(manifest) {
  const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
  const productIds = new Map();
  const validateBoard = (target, categoryName = "Product portfolio") => {
    if (!isRecord(target) || !Array.isArray(target.products) || !Array.isArray(target.lanes)) {
      throw new Error("The package contains an invalid product board.");
    }
    const laneIds = new Set();
    for (const lane of target.lanes) {
      if (!isRecord(lane) || typeof lane.id !== "string" || !lane.id || laneIds.has(lane.id)) {
        throw new Error("The package contains an invalid or repeated product lane.");
      }
      laneIds.add(lane.id);
    }
    for (const product of target.products) {
      if (!isRecord(product) || typeof product.id !== "string" || !product.id || typeof product.name !== "string") {
        throw new Error("The package contains an invalid product record.");
      }
      const laneName = target.lanes.find((lane) => lane.id === product.laneId)?.label || product.laneId || "Unassigned lane";
      const location = `“${product.name || "Unnamed product"}” in ${categoryName} / ${laneName}`;
      if (productIds.has(product.id)) {
        throw new Error(`The package repeats product ID “${product.id}”: ${productIds.get(product.id)} and ${location}. Assign distinct IDs in the source package, then import it again.`);
      }
      productIds.set(product.id, location);
      if (product.variantGroups !== undefined && !Array.isArray(product.variantGroups)) throw new Error("The package contains invalid product variants.");
      for (const group of product.variantGroups || []) {
        if (!isRecord(group) || !Array.isArray(group.items) || group.items.some((item) => !isRecord(item))) {
          throw new Error("The package contains invalid product variants.");
        }
      }
    }
  };
  if (!isRecord(manifest)) throw new Error("The package does not contain a portfolio.");
  packageCodec().normalizePackageInfo(manifest.packageInfo);
  if ([2, 3, 4].includes(manifest.version) && Array.isArray(manifest.categories) && manifest.categories.length) {
    const categoryIds = new Set();
    const knownCategoryIds = new Set(CATEGORY_DEFINITIONS.map((definition) => definition.id));
    for (const category of manifest.categories) {
      if (!isRecord(category) || !knownCategoryIds.has(category.id) || categoryIds.has(category.id)) {
        throw new Error("The package contains an unsupported or repeated category.");
      }
      categoryIds.add(category.id);
      validateBoard(category.board, category.name || category.id);
    }
  } else if (manifest.version === 1 && Array.isArray(manifest.products) && Array.isArray(manifest.lanes)) {
    validateBoard(manifest);
  } else {
    throw new Error("The package uses an unsupported portfolio version.");
  }
  if (manifest.imageAssets !== undefined && !Array.isArray(manifest.imageAssets)) throw new Error("The package image library is invalid.");
  const imageIds = new Set();
  for (const asset of manifest.imageAssets || []) {
    if (!isRecord(asset) || typeof asset.id !== "string" || !asset.id || imageIds.has(asset.id)
      || (asset.sourceType !== undefined && !["local", "url"].includes(asset.sourceType))) {
      throw new Error("The package contains an invalid or repeated image.");
    }
    imageIds.add(asset.id);
  }
}

function validatePackageImageReferences(target) {
  const imageIds = new Set(target.imageAssets.map((asset) => asset.id));
  const validateReference = (assetId) => {
    if (assetId && !imageIds.has(assetId)) throw new Error("The package refers to an image that is missing from its image library.");
  };
  for (const category of target.categories) {
    for (const product of category.board.products) {
      validateReference(product.imageAssetId);
      for (const group of product.variantGroups || []) for (const item of group.items) validateReference(item.imageAssetId);
    }
  }
}

function localPackageImageIds(target) {
  return (target?.imageAssets || []).filter((asset) => asset.sourceType === "local").map((asset) => asset.id);
}

function clearPackageImageCaches() {
  imageAssetGeneration += 1;
  imageAssetUrlCache.forEach((url) => URL.revokeObjectURL(url));
  imageAssetUrlCache.clear();
  imageAssetLoadPromises.clear();
  missingImageAssetIds.clear();
}

async function commitPackageDraft(draft, expectedCurrent) {
  if (JSON.stringify(portfolio) !== expectedCurrent) throw new Error("The workspace changed while the package was loading. Try again after your changes are saved.");
  const previousPortfolio = portfolio;
  const previousStored = localStorage.getItem(STORAGE_KEY);
  const previousRecovery = localStorage.getItem(PACKAGE_RECOVERY_KEY);
  const serialized = JSON.stringify(draft);
  if (new TextEncoder().encode(serialized).length > MAX_PACKAGE_MANIFEST_BYTES) throw new Error("The package data is too large to save in this browser.");
  try {
    // Incoming images have new IDs. Preserve the original library until the
    // replacement is saved and activated so a failed commit can roll back.
    localStorage.setItem(STORAGE_KEY, serialized);
    portfolio = draft;
    clearPackageImageCaches();
    activateCategory(portfolio.activeCategoryId, { fitVertical: true });
  } catch (error) {
    portfolio = previousPortfolio;
    try { if (previousStored === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, previousStored); } catch (_) {}
    clearPackageImageCaches();
    try { activateCategory(portfolio.activeCategoryId, { fitVertical: true }); } catch (_) {}
    throw error;
  }
  globalThis.PortfolioProductIssues?.clearAscmIssues();
  globalThis.PortfolioNotifications?.resolve("workspace-product-validation");
  // A successful replacement no longer retains a previous workspace. Also
  // collect valid legacy snapshot images, protecting every current image ID.
  let obsoleteRecovery = null;
  try {
    const snapshot = JSON.parse(previousRecovery);
    if (snapshot?.version === 1 && snapshot.portfolio) {
      validatePackageManifest(snapshot.portfolio);
      validatePackageImageReferences(snapshot.portfolio);
      obsoleteRecovery = snapshot.portfolio;
    }
  } catch (_) {}
  try { localStorage.removeItem(PACKAGE_RECOVERY_KEY); } catch (_) {}
  const protectedIds = new Set(localPackageImageIds(draft));
  const obsoleteIds = [...new Set([...localPackageImageIds(previousPortfolio), ...localPackageImageIds(obsoleteRecovery)])].filter((assetId) => !protectedIds.has(assetId));
  try { await imageStoreDeleteBatch(obsoleteIds); } catch (_) {}
  return {
    categoryCount: draft.categories.length,
    productCount: draft.categories.reduce((total, category) => total + category.board.products.length, 0),
    packageInfo: packageCodec().normalizePackageInfo(draft.packageInfo),
  };
}

async function buildProjectPackageBytes(packageInfo) {
  const codec = packageCodec();
  const expectedCurrent = JSON.stringify(portfolio);
  const manifest = JSON.parse(expectedCurrent);
  delete manifest.masterLocalBaseline;
  delete manifest.masterLocalTombstones;
  delete manifest.masterLocalRemovedProducts;
  delete manifest.masterLocalMerges;
  delete manifest.masterLocalAssetIds;
  manifest.packageInfo = packageInfo === undefined ? codec.createPackageInfo() : codec.normalizePackageInfo(packageInfo);
  if (!manifest.packageInfo) throw new Error("The package update information is invalid.");
  validatePackageManifest(manifest);
  validatePackageImageReferences(manifest);
  const entries = [];
  for (const asset of manifest.imageAssets || []) {
    if (asset.sourceType !== "local") continue;
    const blob = await imageStoreGet(asset.id);
    if (!blob || !blob.size) throw new Error("A saved product image is unavailable. Restore the image before exporting a complete package.");
    const packagePath = `images/${asset.id}.${extensionForImageAsset(asset)}`;
    asset.packagePath = packagePath;
    entries.push({ name: packagePath, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (manifestBytes.length > MAX_PACKAGE_MANIFEST_BYTES) throw new Error("The package data is too large to save in this browser.");
  if (JSON.stringify(portfolio) !== expectedCurrent) throw new Error("The workspace changed while the package was being prepared. Try exporting again.");
  entries.unshift({ name: "portfolio.json", data: manifestBytes });
  return codec.createZip(entries);
}

async function exportProjectPackage(key = "", { comments = "" } = {}) {
  closePopupMenus();
  if (packageOperationInProgress) throw new Error("A package operation is already in progress.");
  if (globalThis.PortfolioMasterUI?.getSession?.()?.getState().busy) throw new Error("Wait for the master update to finish before building a package.");
  const codec = packageCodec();
  const normalizedKey = key ? codec.normalizeKey(key) : "";
  const packageInfo = codec.createPackageInfo({ comments });
  packageOperationInProgress = true;
  clearTimeout(saveTimer);
  const expectedCurrent = JSON.stringify(portfolio);
  try {
    const bytes = await buildProjectPackageBytes(packageInfo);
    const output = normalizedKey ? await codec.encrypt(bytes, normalizedKey) : bytes;
    if (JSON.stringify(portfolio) !== expectedCurrent) throw new Error("The workspace changed while the package was being prepared. Try exporting again.");
    downloadBlob(new Blob([output], { type: "application/octet-stream" }), normalizedKey ? "master_ppc.pkg" : "product-portfolio-project.pkg");
    return packageInfo;
  } finally {
    packageOperationInProgress = false;
    scheduleSave();
    globalThis.PortfolioMasterUI?.updateStatus?.();
  }
}

async function importProjectPackage(file, { key = "", requireEncrypted = false } = {}) {
  if (packageOperationInProgress) throw new Error("A package operation is already in progress.");
  if (globalThis.PortfolioMasterUI?.getSession?.()?.getState().busy) throw new Error("Wait for the master update to finish before loading a package.");
  const codec = packageCodec();
  if (Number(file?.size || 0) > codec.MAX_PACKAGE_BYTES) throw new Error("The package is too large.");
  packageOperationInProgress = true;
  clearTimeout(saveTimer);
  const expectedCurrent = JSON.stringify(portfolio);
  const pendingStart = pendingLegacyImageBlobs.length;
  const stagedImages = [];
  let staged = false;
  try {
    const input = new Uint8Array(await file.arrayBuffer());
    if (input.length > codec.MAX_PACKAGE_BYTES) throw new Error("The package is too large.");
    const encrypted = codec.isEncrypted(input);
    if (requireEncrypted && !encrypted) throw new Error("The shared master must be an encrypted package.");
    const bytes = encrypted ? await codec.decrypt(input, key) : input;
    const entries = codec.readZip(bytes);
    const manifestBytes = entries.get("portfolio.json");
    if (!manifestBytes) throw new Error("The project package is missing portfolio.json.");
    if (manifestBytes.length > MAX_PACKAGE_MANIFEST_BYTES) throw new Error("The package data is too large to save in this browser.");
    let parsed;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)); }
    catch (_) { throw new Error("The package portfolio data is damaged."); }
    validatePackageManifest(parsed);
    const draft = normalizeImportedPortfolio(JSON.parse(JSON.stringify(parsed)));
    if (globalThis.PortfolioMasterModel) draft.masterLocalBaseline = globalThis.PortfolioMasterModel.snapshot(draft).products;
    const legacyImages = new Map(pendingLegacyImageBlobs.splice(pendingStart).map((entry) => [entry.id, entry.blob]));
    validatePackageImageReferences(draft);
    const replacements = new Map();
    for (const asset of draft.imageAssets) {
      if (asset.sourceType !== "local") { delete asset.packagePath; continue; }
      const packagePath = asset.packagePath || `images/${asset.id}.${extensionForImageAsset(asset)}`;
      const imageBytes = entries.get(packagePath);
      if (!legacyImages.has(asset.id) && (!packagePath.startsWith("images/") || !imageBytes?.length)) {
        throw new Error("The package is missing a saved product image.");
      }
      const blob = legacyImages.get(asset.id) || new Blob([imageBytes], { type: asset.mimeType || "application/octet-stream" });
      const replacementId = `pkg-${id()}`;
      replacements.set(asset.id, replacementId);
      asset.id = replacementId;
      asset.size = blob.size;
      delete asset.packagePath;
      stagedImages.push({ id: replacementId, blob });
    }
    for (const category of draft.categories) {
      for (const product of category.board.products) {
        product.imageAssetId = replacements.get(product.imageAssetId) || product.imageAssetId;
        for (const group of product.variantGroups || []) {
          for (const item of group.items) item.imageAssetId = replacements.get(item.imageAssetId) || item.imageAssetId;
        }
      }
    }
    draft.masterLocalAssetIds = Object.fromEntries(replacements);
    await imageStoreWriteBatch(stagedImages);
    staged = true;
    const result = await commitPackageDraft(draft, expectedCurrent);
    globalThis.PortfolioMasterUI?.markImported(draft.masterLocalBaseline || [], key);
    return { ...result, encrypted };
  } catch (error) {
    pendingLegacyImageBlobs.splice(pendingStart);
    if (staged) { try { await imageStoreDeleteBatch(stagedImages.map((entry) => entry.id)); } catch (_) {} }
    throw error;
  } finally {
    packageOperationInProgress = false;
    scheduleSave();
    globalThis.PortfolioMasterUI?.updateStatus?.();
    globalThis.PortfolioMasterUI?.refresh?.();
  }
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

// Record the same drawing operations used by the board so exported cards keep
// their exact layout while text, frames, and separators remain editable.
function recordCardElementsForPptx(cardCanvas, product, layout) {
  const context = cardCanvas.getContext("2d");
  const elements = [];
  let path = [];
  let nativePathIndex = -1;
  const pathMethods = new Set(["rect", "roundRect", "moveTo", "lineTo", "arc", "quadraticCurveTo", "bezierCurveTo", "closePath"]);
  const color = (value) => {
    const text = String(value || "#000000").trim();
    const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
    if (hex) return { color: `#${hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex}`, opacity: 1 };
    const rgb = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
    if (rgb) return {
      color: `#${rgb.slice(1, 4).map((part) => Math.round(Math.max(0, Math.min(255, Number(part)))).toString(16).padStart(2, "0")).join("")}`,
      opacity: rgb[4] == null ? 1 : Math.max(0, Math.min(1, Number(rgb[4]))),
    };
    return { color: text === "white" ? "#ffffff" : "#000000", opacity: text === "transparent" ? 0 : 1 };
  };
  const matrix = () => {
    const transform = context.getTransform();
    return { a: transform.a, b: transform.b, c: transform.c, d: transform.d, e: transform.e, f: transform.f };
  };
  const point = (transform, x, y) => ({ x: transform.a * x + transform.c * y + transform.e, y: transform.b * x + transform.d * y + transform.f });
  const rectangle = (transform, x, y, width, height) => {
    const corners = [point(transform, x, y), point(transform, x + width, y), point(transform, x, y + height), point(transform, x + width, y + height)];
    const left = Math.min(...corners.map((corner) => corner.x));
    const top = Math.min(...corners.map((corner) => corner.y));
    return { x: left, y: top, width: Math.max(...corners.map((corner) => corner.x)) - left, height: Math.max(...corners.map((corner) => corner.y)) - top };
  };
  const paint = (element, operation) => {
    const isFill = operation === "fill";
    const style = color(isFill ? context.fillStyle : context.strokeStyle);
    if (isFill) {
      element.fill = style.color;
      element.fillOpacity = style.opacity * context.globalAlpha;
    } else {
      element.lineColor = style.color;
      element.lineOpacity = style.opacity * context.globalAlpha;
      element.lineWidth = context.lineWidth * Math.abs(matrix().a);
    }
  };
  const rasterize = (bounds, replay) => {
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(bounds.width));
    canvas.height = Math.max(1, Math.ceil(bounds.height));
    const target = canvas.getContext("2d");
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = "high";
    replay(target, bounds.x, bounds.y);
    elements.push({ kind: "image", ...bounds, data: canvas.toDataURL("image/png") });
  };
  const recordPath = (operation) => {
    let shape = null;
    if (path.length === 1 && ["rect", "roundRect"].includes(path[0].method)) {
      const { method, args, transform } = path[0];
      shape = { kind: "shape", shape: method === "roundRect" ? "roundRect" : "rect", ...rectangle(transform, ...args.slice(0, 4)) };
      if (method === "roundRect") {
        const radii = (Array.isArray(args[4]) ? args[4] : [args[4] || 0]).map((radius) => Number(radius) * Math.abs(transform.a));
        shape.radius = radii[0];
        shape.cornerRadii = radii;
      }
    } else if (operation === "stroke" && path.length === 2 && path[0].method === "moveTo" && path[1].method === "lineTo") {
      const start = point(path[0].transform, ...path[0].args);
      const end = point(path[1].transform, ...path[1].args);
      shape = { kind: "shape", shape: "line", x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y), flipH: end.x < start.x, flipV: end.y < start.y };
    }
    if (shape) {
      if (nativePathIndex < 0) {
        nativePathIndex = elements.length;
        elements.push(shape);
      }
      paint(elements[nativePathIndex], operation);
      return;
    }
    // Small specification icons and two-color swatches are separate pictures;
    // their surrounding labels and values are still native PowerPoint text.
    const points = [];
    path.forEach(({ method, args, transform }) => {
      const add = (x, y) => points.push(point(transform, x, y));
      if (["moveTo", "lineTo"].includes(method)) add(args[0], args[1]);
      else if (["rect", "roundRect"].includes(method)) { add(args[0], args[1]); add(args[0] + args[2], args[1] + args[3]); }
      else if (method === "arc") { add(args[0] - args[2], args[1] - args[2]); add(args[0] + args[2], args[1] + args[2]); }
      else if (["quadraticCurveTo", "bezierCurveTo"].includes(method)) for (let index = 0; index < args.length; index += 2) add(args[index], args[index + 1]);
    });
    if (!points.length) return;
    const padding = Math.max(2, context.lineWidth * Math.abs(matrix().a));
    const left = Math.min(...points.map((item) => item.x)) - padding;
    const top = Math.min(...points.map((item) => item.y)) - padding;
    const bounds = { x: left, y: top, width: Math.max(...points.map((item) => item.x)) - left + padding, height: Math.max(...points.map((item) => item.y)) - top + padding };
    rasterize(bounds, (target, cropX, cropY) => {
      target.fillStyle = context.fillStyle;
      target.strokeStyle = context.strokeStyle;
      target.lineWidth = context.lineWidth;
      target.lineCap = context.lineCap;
      target.lineJoin = context.lineJoin;
      target.globalAlpha = context.globalAlpha;
      target.beginPath();
      path.forEach(({ method, args, transform }) => {
        target.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e - cropX, transform.f - cropY);
        target[method](...args);
      });
      target[operation]();
    });
  };
  const recorder = new Proxy(context, {
    get(target, key) {
      const member = target[key];
      if (typeof member !== "function") return member;
      return (...args) => {
        if (key === "beginPath") { path = []; nativePathIndex = -1; }
        if (pathMethods.has(key)) path.push({ method: key, args, transform: matrix() });
        if (key === "fill" || key === "stroke") recordPath(key);
        if (key === "fillRect" || key === "strokeRect") {
          const element = { kind: "shape", shape: "rect", ...rectangle(matrix(), ...args) };
          paint(element, key === "fillRect" ? "fill" : "stroke");
          elements.push(element);
        }
        if (key === "fillText") {
          const [text, x, y, maxWidth] = args;
          const transform = matrix();
          const fontSize = Number(target.font.match(/([\d.]+)px/)?.[1] || 10);
          const measuredWidth = target.measureText(String(text)).width;
          const drawnWidth = Math.min(measuredWidth, Number.isFinite(maxWidth) ? maxWidth : measuredWidth);
          const boxWidth = Math.max(1, drawnWidth + Math.min(2, fontSize * .15));
          const align = target.textAlign === "center" ? "center" : target.textAlign === "right" || target.textAlign === "end" ? "right" : "left";
          const left = x - (align === "center" ? boxWidth / 2 : align === "right" ? boxWidth : 0);
          const baselineOffset = target.textBaseline === "middle" ? fontSize * .5 : target.textBaseline === "top" || target.textBaseline === "hanging" ? 0 : fontSize;
          const textColor = color(target.fillStyle);
          elements.push({
            kind: "text", text: String(text), ...rectangle(transform, left, y - baselineOffset, boxWidth, fontSize * 1.3),
            fontSize: fontSize * Math.abs(transform.a), fontFace: target.font.slice(target.font.indexOf("px") + 2).trim() || "Arial",
            color: textColor.color, opacity: textColor.opacity * target.globalAlpha,
            align, bold: /\b(?:bold|[6-9]00)\b/.test(target.font), fit: "shrink", baseline: point(transform, x, y).y,
          });
        }
        if (key === "drawImage") {
          const transform = matrix();
          const destination = args.length === 9 ? args.slice(5) : args.length === 5 ? args.slice(1) : [args[1], args[2], args[0].naturalWidth || args[0].width, args[0].naturalHeight || args[0].height];
          const bounds = rectangle(transform, ...destination);
          rasterize(bounds, (targetCanvas, cropX, cropY) => {
            targetCanvas.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e - cropX, transform.f - cropY);
            targetCanvas.globalAlpha = target.globalAlpha;
            targetCanvas.drawImage(...args);
          });
        }
        return member.apply(target, args);
      };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  drawCard(recorder, product, 0, 0, false, layout, false);
  return elements;
}

function productPagesForPptx(category, targetBoard = null, canvasWidth = 0) {
  const definition = categoryDefinition(category.id);
  const categoryBoard = targetBoard || ensureBoardSchema(JSON.parse(JSON.stringify(category.board)), definition);
  const layout = productCardLayout(categoryBoard, definition);
  return PPTXPagination.paginateProductLanes(categoryBoard.lanes, categoryBoard.products, {
    canvasWidth,
    cardWidth: CARD_WIDTH, cardGap: CARD_GAP, cardHeight: layout.cardHeight,
    laneGap: layout.laneHeight - layout.cardHeight, gutter: GUTTER, sidePadding: SIDE_PADDING,
    top: LANE_TOP + 18, bottom: 20,
    getFamily: (product) => String(product.roadmap?.family || inferFamily(product.name) || "Other").trim(),
  }).map((page) => ({ ...page, layout }));
}

async function renderCategoryImageForPptx(category, page = null) {
  const previous = {
    activeCategoryId,
    board,
    selectedId,
    searchQuery,
    roadmapSearchQuery,
    inspectorOpen,
    viewerInfoOpen,
    viewerInfoProductId,
    dragState,
    hoveredHeroVariant,
    renderedCards,
    renderedVariantOverflow,
    renderedHeroVariantRegions,
    renderedInfoButtons,
  };

  try {
    activeCategoryId = category.id;
    const categoryBoard = ensureBoardSchema(JSON.parse(JSON.stringify(category.board)), categoryDefinition(category.id));
    board = categoryBoard;
    selectedId = null;
    searchQuery = "";
    roadmapSearchQuery = "";
    inspectorOpen = false;
    viewerInfoOpen = false;
    viewerInfoProductId = null;
    dragState = null;
    hoveredHeroVariant = null;

    const exportPage = page || productPagesForPptx(category, categoryBoard)[0];
    const layout = exportPage.layout;
    const byId = new Map(board.products.map((product) => [product.id, product]));
    const laneRows = exportPage.rows.map((row, index) => ({
      lane: row.lane,
      top: LANE_TOP + 18 + (row.slot ?? index) * layout.laneHeight,
      contentHeight: layout.cardHeight,
      continued: row.continued,
      products: row.products.map((product) => {
        const exportedProduct = byId.get(product.id);
        if (!exportedProduct) throw new Error("A product could not be found on its PowerPoint page.");
        return exportedProduct;
      }),
    }));
    await preloadCategoryImagesForPptx(laneRows.flatMap((row) => row.products));
    const dimensions = { width: exportPage.width, height: exportPage.height, laneRows, layout, includeViewer: false, pptxPage: true };
    const exportCanvas = document.createElement("canvas");
    const maxPixelWidth = 2800;
    const scale = Math.min(1, maxPixelWidth / dimensions.width);
    exportCanvas.width = Math.max(1, Math.round(dimensions.width * scale));
    exportCanvas.height = Math.max(1, Math.round(dimensions.height * scale));
    const exportContext = exportCanvas.getContext("2d");
    exportContext.setTransform(scale, 0, 0, scale, 0, 0);
    exportContext.imageSmoothingEnabled = true;
    exportContext.imageSmoothingQuality = "high";
    drawBoardTo(exportContext, dimensions, false, true, false);

    const products = [];
    const shadowPadding = 8;
    dimensions.laneRows.forEach(({ products: laneProducts, top }) => {
      laneProducts.forEach((product, displayIndex) => {
        const x = cardXForDisplayIndex(laneProducts, displayIndex, false);
        const cardCanvas = document.createElement("canvas");
        cardCanvas.width = Math.max(1, Math.ceil((CARD_WIDTH + shadowPadding * 2) * scale));
        cardCanvas.height = Math.max(1, Math.ceil((layout.cardHeight + shadowPadding * 2) * scale));
        const cardContext = cardCanvas.getContext("2d");
        cardContext.setTransform(scale, 0, 0, scale, shadowPadding * scale, shadowPadding * scale);
        cardContext.imageSmoothingEnabled = true;
        cardContext.imageSmoothingQuality = "high";
        const elements = recordCardElementsForPptx(cardCanvas, product, layout);
        products.push({
          kind: "card",
          id: product.id,
          name: product.name,
          elements,
          x: (x - shadowPadding) * scale,
          y: (top - shadowPadding) * scale,
          width: cardCanvas.width,
          height: cardCanvas.height,
        });
      });
    });
    return {
      data: exportCanvas.toDataURL("image/jpeg", .9),
      width: exportCanvas.width,
      height: exportCanvas.height,
      products,
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
    dragState = previous.dragState;
    hoveredHeroVariant = previous.hoveredHeroVariant;
    renderedCards = previous.renderedCards;
    renderedVariantOverflow = previous.renderedVariantOverflow;
    renderedHeroVariantRegions = previous.renderedHeroVariantRegions;
    renderedInfoButtons = previous.renderedInfoButtons;
  }
}

async function renderCategoryRoadmapImageForPptx(category, groups = null) {
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
    const categoryBoard = ensureBoardSchema(JSON.parse(JSON.stringify(category.board)), categoryDefinition(category.id));
    const pageGroups = Array.isArray(groups) ? groups : null;
    board = {
      ...categoryBoard,
      products: pageGroups ? pageGroups.flatMap((group) => group.products) : categoryBoard.products,
    };
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

    const dimensions = roadmapDimensions(pageGroups);
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
      false,
    );

    // Keep the calendar and family rails in the background. Each visible
    // product becomes one native PowerPoint shape with its own editable text.
    const products = [];
    let rowTop = ROADMAP_HEADER_HEIGHT;
    dimensions.groups.forEach((group) => {
      rowTop += ROADMAP_GROUP_HEADER_HEIGHT;
      group.products.forEach((product) => {
        const rect = roadmapProductBarRect(product, range, rowTop);
        if (rect) {
          const fill = roadmapStatusColor(product);
          const concept = effectiveRoadmap(product)?.status === "concept";
          products.push({
            kind: "roadmap", id: product.id, name: product.name,
            label: roadmapProductBarLabel(product), ...rect,
            fill, textColor: contrastTextColor(fill), concept,
            lineColor: product.statusType === "embargo" ? UI_PALETTE.amaranth
              : concept ? UI_PALETTE.midGrey : UI_PALETTE.gunmetal,
            fontSize: portfolio?.settings?.showRoadmapMsrp ? 11 : 12,
          });
        }
        rowTop += ROADMAP_ROW_HEIGHT;
      });
    });

    return {
      data: exportCanvas.toDataURL("image/jpeg", .92),
      width: exportCanvas.width,
      height: exportCanvas.height,
      products,
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

function addPptxPortfolioSlide(pptx, title, image) {
  const slide = pptx.addSlide();
  slide.background = { color: "171717" };
  slide.addText(title, {
    x: .38, y: .16, w: 11.9, h: .38,
    fontFace: "Arial", fontSize: 20, bold: true,
    color: "F0F2F0", margin: 0, breakLine: false,
  });
  slide.addShape(pptx.ShapeType.line, {
    x: .38, y: .62, w: 12.55, h: 0,
    line: { color: "2B2E2B", width: .4, transparency: 25 },
  });
  const placement = containRect(image.width, image.height, .38, .74, 12.55, 6.33, "left");
  slide.addImage({ data: image.data, ...placement, objectName: "Calendar and category background" });
  const scale = placement.w / image.width;
  const cardGroups = [];
  (image.products || []).forEach((product, productIndex) => {
    if (product.kind === "card") {
      cardGroups.push(PPTXEditable.addCard(pptx, slide, product, { ...placement, scale }, productIndex));
      return;
    }
    const rect = {
      x: placement.x + product.x * scale,
      y: placement.y + product.y * scale,
      w: product.width * scale,
      h: product.height * scale,
    };
    const objectName = `Product: ${product.id} — ${product.name || product.label || "Product"}`;
    if (product.kind === "image") {
      slide.addImage({ data: product.data, ...rect, objectName, altText: product.name || "Product" });
      return;
    }
    slide.addText(product.label, {
      ...rect, objectName, shape: pptx.ShapeType.roundRect,
      fontFace: "Arial", fontSize: product.fontSize * scale * 72, bold: true,
      color: product.textColor.replace(/^#/, ""),
      fill: { color: product.fill.replace(/^#/, "") },
      line: { color: product.lineColor.replace(/^#/, ""), width: scale * 72,
        ...(product.concept ? { dashType: "dash" } : {}) },
      align: "center", valign: "mid", margin: [0, 8 * scale * 72, 0, 8 * scale * 72],
      breakLine: false, wrap: false, fit: "shrink",
    });
  });
  PPTXEditable.registerSlide(pptx, cardGroups);
  return slide;
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

function buildPptxExportPlan(scope, categories) {
  const includeProducts = scope === "products" || scope === "both";
  const includeRoadmap = scope === "roadmap" || scope === "both";
  const slides = [];

  const preparedCategories = categories.map((category, categoryIndex) => {
    const definition = categoryDefinition(category.id);
    const targetBoard = ensureBoardSchema(JSON.parse(JSON.stringify(category.board)), definition);
    return { category, categoryIndex, definition, targetBoard,
      productPages: includeProducts ? productPagesForPptx(category, targetBoard) : [] };
  });
  // Every selected category shares the same card scale. Reserve a wider
  // canvas for the whole deck only when an unusually tall detail card needs it.
  const productCanvasWidth = preparedCategories.reduce((width, item) => Math.max(width, item.productPages[0]?.width || 0), 0);

  preparedCategories.forEach(({ category, categoryIndex, definition, targetBoard, productPages }) => {

    if (includeProducts) {
      const pages = productPages[0].width === productCanvasWidth ? productPages
        : productPagesForPptx(category, targetBoard, productCanvasWidth);
      pages.forEach((page, pageIndex) => {
        slides.push({ category, categoryIndex, kind: "products", page, pageIndex, pageCount: pages.length });
      });
    }

    if (includeRoadmap) {
      const groups = roadmapGroupsForProducts(targetBoard.products, targetBoard, definition);
      const pages = paginateRoadmapGroupsForPptx(groups);
      pages.forEach((pageGroups, pageIndex) => {
        slides.push({ category, categoryIndex, kind: "roadmap", groups: pageGroups, pageIndex, pageCount: pages.length });
      });
    }
  });

  return slides;
}

function pptxPlanSlideTitle(planItem) {
  const categoryName = planItem.category.name || planItem.category.id || `Category ${planItem.categoryIndex + 1}`;
  const viewName = planItem.kind === "products" ? "Product Portfolio" : "Roadmap";
  const pageLabel = planItem.pageIndex > 0 ? " (continued)" : "";
  return `${categoryName} — ${viewName}${pageLabel}`;
}

function pptxExportScope() {
  return pptxExportForm?.querySelector('input[name="pptxExportScope"]:checked')?.value || "both";
}

function pptxSlideCountForScope(scope, categories) {
  return buildPptxExportPlan(scope, categories).length;
}

function pptxExportCategories() {
  const selectedIds = [...pptxExportForm.querySelectorAll('input[name="pptxExportCategory"]:checked')]
    .map((input) => input.value);
  return PPTXPagination.selectExportCategories(portfolio?.categories, selectedIds);
}

function renderPptxExportCategories() {
  const categories = PPTXPagination.selectExportCategories(portfolio?.categories);
  const selected = new Set(PPTXPagination.selectExportCategories(categories, pptxSelectedCategoryIds)
    .map((category) => category.id));
  $("#pptxExportCategories").innerHTML = categories.map((category) => {
    const count = Array.isArray(category.board.products) ? category.board.products.length : 0;
    return `<label class="pptx-category-choice"><input type="checkbox" name="pptxExportCategory" value="${escapeHtml(category.id)}"${selected.has(category.id) ? " checked" : ""}><span class="pptx-category-label"><strong>${escapeHtml(category.name || category.id)}</strong><small>${count} product${count === 1 ? "" : "s"}</small></span></label>`;
  }).join("");
}

function setPptxCategorySelection(ids) {
  const selected = new Set(ids);
  pptxExportForm.querySelectorAll('input[name="pptxExportCategory"]').forEach((input) => {
    input.checked = selected.has(input.value);
  });
  syncPptxExportSummary();
}

function syncPptxExportSummary() {
  if (!pptxExportDialog) return;
  const available = PPTXPagination.selectExportCategories(portfolio?.categories);
  const categories = pptxExportCategories();
  const allSelected = categories.length > 0 && categories.length === available.length;
  pptxSelectedCategoryIds = allSelected ? null : categories.map((category) => category.id);
  const scope = pptxExportScope();
  $("#pptxExportCategoryCount").textContent = String(categories.length);
  $("#pptxExportSlideCount").textContent = String(pptxSlideCountForScope(scope, categories));
  $("#pptxSelectAllCategories").textContent = allSelected ? "Clear selection" : "Select all";
  $("#pptxExportSelectionHint").textContent = categories.length
    ? `${categories.length} of ${available.length} categories selected`
    : "Select at least one category to export.";
  $("#pptxExportSelectionHint").classList.toggle("is-empty", !categories.length);
  confirmPptxExportButton.disabled = pptxExportInProgress || !categories.length;
}

function openPptxExportDialog() {
  closePopupMenus();
  pptxReturnFocus = document.activeElement;
  renderPptxExportCategories();
  syncPptxExportSummary();
  pptxExportDialog.classList.remove("hidden");
  document.querySelector(".app-shell").inert = true;
  $("#workspaceEmpty").inert = true;
  requestAnimationFrame(() => {
    const selected = pptxExportForm.querySelector('input[name="pptxExportScope"]:checked');
    selected?.focus();
  });
}

function closePptxExportDialog() {
  if (pptxExportInProgress || pptxExportDialog.classList.contains("hidden")) return;
  pptxExportDialog.classList.add("hidden");
  document.querySelector(".app-shell").inert = false;
  $("#workspaceEmpty").inert = false;
  if (pptxReturnFocus?.isConnected) pptxReturnFocus.focus();
}

function pptxExportFilename(scope) {
  if (scope === "products") return "product-portfolio.pptx";
  if (scope === "roadmap") return "product-roadmaps.pptx";
  return "product-portfolio-and-roadmaps.pptx";
}

async function exportPptx(scope = "both", selectedCategoryIds = null) {
  closePopupMenus();
  if (typeof PptxGenJS !== "function") throw new Error("The PowerPoint export library did not load. Refresh the page and try again.");
  const categories = PPTXPagination.selectExportCategories(portfolio?.categories, selectedCategoryIds);
  if (!categories.length) throw new Error("Select at least one category to export.");

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

  const exportPlan = buildPptxExportPlan(scope, categories);

  for (let index = 0; index < exportPlan.length; index += 1) {
    const planItem = exportPlan[index];
    const image = planItem.kind === "products"
      ? await renderCategoryImageForPptx(planItem.category, planItem.page)
      : await renderCategoryRoadmapImageForPptx(planItem.category, planItem.groups);
    addPptxPortfolioSlide(
      pptx,
      pptxPlanSlideTitle(planItem),
      image,
    );
  }

  await PPTXEditable.writeFile(pptx, { fileName: pptxExportFilename(scope) }, downloadBlob);
  renderActiveView();
}

function exportPng() {
  const exportCanvas = document.createElement("canvas");
  const scale = 2;

  if (activeView === "products") {
    const dimensions = getCanvasDimensions({ includeViewer: false });
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
  const packageInfo = packageCodec().normalizePackageInfo(parsed?.packageInfo);
  if ([4, 3, 2].includes(parsed?.version) && Array.isArray(parsed.categories)) {
    const hasWorkspaceBoards = parsed.categories.some((category) => category && category.board);
    const target = hasWorkspaceBoards ? parsed : portfolioFromCatalogImport(parsed);
    target.packageInfo = packageInfo;
    return ensurePortfolioSchema(target);
  }
  if (parsed?.version === 1 && Array.isArray(parsed.categories)) {
    const target = portfolioFromCatalogImport(parsed);
    target.packageInfo = packageInfo;
    return ensurePortfolioSchema(target);
  }
  if (parsed?.version === 1 && Array.isArray(parsed.products) && Array.isArray(parsed.lanes)) {
    const migrated = createDefaultPortfolio();
    migrated.packageInfo = packageInfo;
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
      if (globalThis.PortfolioMasterUI?.getSession?.()?.getState().busy) throw new Error("Wait for the master update to finish before loading new data.");
      portfolio = normalizeImportedPortfolio(parsed);
      globalThis.PortfolioProductIssues?.clearAscmIssues();
      globalThis.PortfolioNotifications?.resolve("workspace-product-validation");
      if (globalThis.PortfolioMasterModel) portfolio.masterLocalBaseline = globalThis.PortfolioMasterModel.snapshot(portfolio).products;
      globalThis.PortfolioMasterUI?.disconnect();
      globalThis.PortfolioMasterUI?.markImported(portfolio.masterLocalBaseline || []);
      selectedId = null;
      activateCategory(portfolio.activeCategoryId, { fitVertical: true });
      flushPendingLegacyImages();
    } catch (error) {
      console.error("Portfolio import failed:", error);
      void PortfolioDialogs.alert(error.message || "Unable to import portfolio file.", { title: "Data import failed" });
    }
  };
  reader.onerror = () => { void PortfolioDialogs.alert("Unable to read the selected portfolio file.", { title: "Data import failed" }); };
  reader.readAsText(file);
}

function ascmGroupBasePartNumbers(group) {
  return [...new Set((Array.isArray(group?.basePns) ? group.basePns : (group?.records || []).map((record) => record.basePn))
    .map((value) => String(value || "").trim().toUpperCase()).filter(Boolean))].sort();
}

function ascmGroupDates(group) {
  return {
    gaDate: normalizeProductInfoDate(group?.gaDate || group?.records?.map((record) => record.ga).filter(Boolean).sort()[0]),
    emDate: normalizeProductInfoDate(group?.emDate || group?.records?.map((record) => record.em).filter(Boolean).sort().at(-1)),
  };
}

function ascmRecordSignature(record) {
  const normalized = normalizeAscmRecord(record);
  return [
    normalized.basePartNumber,
    normalized.featureId,
    normalized.category,
    normalized.fullProductName,
    normalized.codeName,
    normalized.generalAvailabilityDate,
    normalized.endManufacturingDate,
    normalized.colorCode,
  ].join("\u001f");
}

function ascmProductNeedsUpdate(group, match) {
  if (match?.status !== "matched" || !match.product) return true;
  const current = normalizeAscmProductMetadata(match.product.ascm);
  if (!current || current.key !== String(group.ascmKey || group.key || "")) return true;
  const merged = globalThis.ASCMImporter.mergeProductGroup(match.product, group);
  if (current.basePartNumbers.slice().sort().join("|") !== merged.ascm.basePartNumbers.slice().sort().join("|")) return true;
  const currentRecords = current.records.map(ascmRecordSignature).sort();
  const mergedRecords = merged.ascm.records.map(ascmRecordSignature).sort();
  if (currentRecords.join("\n") !== mergedRecords.join("\n")) return true;
  if (match.product.generalAvailabilityDate !== merged.generalAvailabilityDate || match.product.endManufacturingDate !== merged.endManufacturingDate) return true;
  if (JSON.stringify(match.product.variantGroups) !== JSON.stringify(merged.variantGroups)) return true;
  return match.categoryId !== group.categoryId;
}

function buildAscmImportPlan(dataset) {
  const importer = globalThis.ASCMImporter;
  if (!importer?.buildProductGroups || !importer?.matchProductGroup) throw new Error("The ASCM importer is unavailable. Reload the app and try again.");
  const groups = importer.buildProductGroups(dataset);
  const previousPns = new Set((portfolio?.ascmSnapshot?.basePartNumbers || []).map((value) => String(value).toUpperCase()));
  const currentPns = [...new Set(dataset.rows.map((row) => String(row.basePn || "").trim().toUpperCase()).filter(Boolean))].sort();
  const currentPnSet = new Set(currentPns);
  const newBasePns = currentPns.filter((value) => !previousPns.has(value));
  const missingBasePns = [...previousPns].filter((value) => !currentPnSet.has(value)).sort();
  const items = groups.map((group) => {
    const match = importer.matchProductGroup(group, portfolio);
    let action = "new";
    if (!group.categoryId) action = "ambiguous";
    else if (match.status === "ambiguous") action = "ambiguous";
    else if (match.status === "matched") action = ascmProductNeedsUpdate(group, match) ? "update" : "unchanged";
    return {
      group,
      match,
      action,
      matchedProductId: match.product?.id || "",
      matchedCategoryId: match.categoryId || "",
      matchedProductName: match.product?.name || "",
    };
  });
  const itemsByMatchedProduct = new Map();
  for (const item of items) {
    if (item.match.status !== "matched" || !item.matchedProductId) continue;
    const matches = itemsByMatchedProduct.get(item.matchedProductId) || [];
    matches.push(item);
    itemsByMatchedProduct.set(item.matchedProductId, matches);
  }
  for (const matches of itemsByMatchedProduct.values()) {
    if (matches.length < 2) continue;
    for (const item of matches) {
      item.action = "ambiguous";
      item.match = {
        ...item.match,
        status: "ambiguous",
        ambiguous: true,
        reason: "multiple-ascm-groups-match-one-product",
      };
    }
  }
  return { dataset, groups, items, currentPns, newBasePns, missingBasePns };
}

function ascmActionLabel(item) {
  if (item.action === "new") return "New product";
  if (item.action === "update") return "Update";
  if (item.action === "unchanged") return "Unchanged";
  return item.group.categoryId ? "Review match" : "Unmapped";
}

function portfolioCategoryName(categoryId) {
  return portfolio?.categories?.find((category) => category.id === categoryId)?.name
    || CATEGORY_DEFINITIONS.find((category) => category.id === categoryId)?.name
    || "Needs review";
}

function renderAscmImportPreview(plan) {
  const counts = plan.items.reduce((result, item) => {
    result[item.action] = (result[item.action] || 0) + 1;
    return result;
  }, {});
  const metrics = [
    ["Source rows", plan.dataset.metadata?.sourceDataRows ?? plan.dataset.rows.length],
    ["Canonical Base PNs", plan.currentPns.length],
    ["New Base PNs", plan.newBasePns.length],
    ["New products", counts.new || 0],
    ["Products to update", counts.update || 0],
  ];
  $("#ascmImportSummary").innerHTML = metrics.map(([label, value]) => `
    <div class="ascm-import-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");

  const metadata = plan.dataset.metadata || {};
  const exported = metadata.exportedAt ? ` · Exported ${escapeHtml(metadata.exportedAt)}` : "";
  $("#ascmImportSource").innerHTML = `<strong>${escapeHtml(metadata.fileName || "ASCM report.xlsx")}</strong> · ${escapeHtml(metadata.sheetName || "ASCM Report")} · header row ${escapeHtml(metadata.headerRow || "?")}${exported}`;

  const previewLimit = 250;
  $("#ascmImportPreview").innerHTML = plan.items.slice(0, previewLimit).map((item, index) => {
    const canReviewMatch = item.action === "ambiguous" && Boolean(item.matchedProductId || item.match?.product?.id || item.match?.candidates?.length);
    const descriptions = [...new Set((item.group.records || []).map((record) => String(record.description || "").trim()).filter(Boolean))];
    const descriptionSummary = descriptions.length > 1 ? `${descriptions[0]} (+${descriptions.length - 1})` : descriptions[0] || item.group.displayName;
    const productName = item.matchedProductName
      ? `${escapeHtml(item.matchedProductName)}<small class="ascm-import-source-name">GPG: ${escapeHtml(descriptionSummary)}</small>`
      : `${escapeHtml(item.group.displayName || "Unnamed product")}<small class="ascm-import-source-name">GPG: ${escapeHtml(descriptionSummary)}</small>`;
    const basePns = ascmGroupBasePartNumbers(item.group);
    const basePnSummary = basePns.length > 1 ? `${basePns[0]} +${basePns.length - 1}` : basePns[0] || "—";
    return `<tr>
      <td><span class="ascm-import-action is-${escapeHtml(item.action)}">${escapeHtml(ascmActionLabel(item))}</span>${canReviewMatch ? `<button type="button" class="small-button" data-review-ascm-match="${index}">Review matches</button>` : ""}</td>
      <td>${escapeHtml(portfolioCategoryName(item.group.categoryId))}</td>
      <td>${productName}</td>
      <td class="ascm-import-pns" title="${escapeHtml(basePns.join(", "))}">${escapeHtml(basePnSummary)}</td>
      <td>${escapeHtml(item.group.gaDate || "TBD")}</td>
      <td>${escapeHtml(item.group.emDate || "TBD")}</td>
    </tr>`;
  }).join("");
  $("#ascmImportPreview").querySelectorAll("[data-review-ascm-match]").forEach((button) => {
    button.addEventListener("click", () => globalThis.PortfolioProductIssues?.reviewDuplicateIssues({ ascmPlan: plan, ascmIndex: Number(button.dataset.reviewAscmMatch) }));
  });
  globalThis.PortfolioProductIssues?.setAscmPlan(plan);

  const notes = [];
  const localized = Number(metadata.localizedRowsFiltered || 0);
  if (localized) notes.push(`${localized} localized duplicate rows were excluded in favor of their canonical Base PN rows.`);
  const invalidRows = Number(metadata.invalidRowsFiltered || 0);
  const invalidLocalRows = Number(metadata.invalidLocalRowsFiltered || 0);
  const duplicateBasePns = Number(metadata.duplicateBasePnRows || 0);
  if (invalidRows) notes.push(`${invalidRows} row(s) with missing or invalid required values were skipped.`);
  if (invalidLocalRows) notes.push(`${invalidLocalRows} row(s) with an invalid Local flag were skipped.`);
  if (duplicateBasePns) notes.push(`${duplicateBasePns} duplicate canonical Base PN row(s) were skipped; the earliest valid row was retained.`);
  if (counts.ambiguous) notes.push(`${counts.ambiguous} product group(s) need review and will be skipped.`);
  if (plan.missingBasePns.length) notes.push(`${plan.missingBasePns.length} Base PN(s) from the previous ASCM snapshot are absent; no products will be deleted.`);
  if (plan.items.length > previewLimit) notes.push(`The preview shows the first ${previewLimit} of ${plan.items.length} product groups.`);
  if (!notes.length) notes.push("No ambiguous mappings or missing prior Base PNs were found.");
  $("#ascmImportNote").textContent = notes.join(" ");
}

function closeAscmImportDialog({ retainIssues = false } = {}) {
  const hadPendingPreview = Boolean(pendingAscmImport);
  pendingAscmImport = null;
  if (!retainIssues && hadPendingPreview) globalThis.PortfolioProductIssues?.clearAscmIssues();
  ascmImportDialog?.classList.add("hidden");
  if (confirmAscmImportButton) {
    confirmAscmImportButton.disabled = false;
    confirmAscmImportButton.textContent = "Apply ASCM update";
  }
}

async function openAscmImport(file) {
  const importer = globalThis.ASCMImporter;
  if (!importer?.parseAscmWorkbook) throw new Error("The ASCM workbook reader did not load. Reload the app and try again.");
  const dataset = await importer.parseAscmWorkbook(file);
  const plan = buildAscmImportPlan(dataset);
  pendingAscmImport = plan;
  renderAscmImportPreview(plan);
  $("#ascmApplyUpdates").checked = true;
  $("#ascmAddProducts").checked = true;
  ascmImportDialog.classList.remove("hidden");
}

function ascmRoadmapStatus(gaDate, emDate) {
  const today = new Date().toISOString().slice(0, 10);
  if (emDate && emDate < today) return "end-of-life";
  if (gaDate && gaDate > today) return "in-planning";
  return "launched";
}

function applyAscmGroupToProduct(product, group, dataset, importedAt, isNewProduct) {
  const dates = ascmGroupDates(group);
  Object.assign(product, globalThis.ASCMImporter.mergeProductGroup(product, group, {
    datasetMetadata: dataset.metadata, importedAt, createId: id,
  }));
  if (isNewProduct && group.codename) product.codename = String(group.codename);
  const existingRoadmap = product.roadmap || {};
  const startMonth = dates.gaDate.slice(0, 7) || normalizeMonth(group.launchMonth, "") || existingRoadmap.startMonth || monthStringFromDate();
  const proposedEnd = dates.emDate.slice(0, 7) || normalizeMonth(group.endMonth, "") || existingRoadmap.endMonth || addMonths(startMonth, 24);
  const endMonth = monthIndex(proposedEnd) < monthIndex(startMonth) ? startMonth : proposedEnd;
  product.roadmap = {
    ...makeRoadmap(inferFamily(product.name), startMonth, startMonth, endMonth, ascmRoadmapStatus(dates.gaDate, dates.emDate), "medium"),
    ...existingRoadmap,
    family: existingRoadmap.family || inferFamily(product.name),
    startMonth,
    launchMonth: startMonth,
    endMonth,
    status: isNewProduct ? ascmRoadmapStatus(dates.gaDate, dates.emDate) : normalizeRoadmapStatus(existingRoadmap.status),
  };
  product.ascm = normalizeAscmProductMetadata(product.ascm);
}

function ascmProductId(group, state) {
  const slug = String(group?.displayName || "product").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44) || "product";
  let hash = 2166136261;
  for (const character of String(group?.ascmKey || group?.key || slug)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const base = `ascm-${slug}-${hash.toString(36)}`;
  const ids = new Set(state.categories.flatMap((category) => category.board.products.map((product) => product.id)));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function findPortfolioProductLocation(state, productId) {
  for (const category of state.categories) {
    const index = category.board.products.findIndex((product) => product.id === productId);
    if (index >= 0) return { category, index, product: category.board.products[index] };
  }
  return null;
}

function applyAscmImportPlan(plan, { updateMatched = true, addNew = true } = {}) {
  const next = clonePortfolioData();
  const importedAt = new Date().toISOString();
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const item of plan.items) {
    if (item.action === "ambiguous") {
      skipped += 1;
      continue;
    }
    if (item.match.status === "matched") {
      if (!updateMatched) {
        skipped += 1;
        continue;
      }
      const location = findPortfolioProductLocation(next, item.matchedProductId);
      const targetCategory = next.categories.find((category) => category.id === item.group.categoryId);
      if (!location || !targetCategory) {
        skipped += 1;
        continue;
      }
      let product = location.product;
      if (location.category.id !== targetCategory.id) {
        location.category.board.products.splice(location.index, 1);
        product.laneId = targetCategory.board.lanes.some((lane) => lane.id === item.group.laneId)
          ? item.group.laneId
          : targetCategory.board.lanes[0]?.id || "default";
        product.order = targetCategory.board.products.length;
        targetCategory.board.products.push(product);
      }
      applyAscmGroupToProduct(product, item.group, plan.dataset, importedAt, false);
      if (item.action === "unchanged") unchanged += 1;
      else updated += 1;
      continue;
    }
    if (!addNew) {
      skipped += 1;
      continue;
    }
    const category = next.categories.find((candidate) => candidate.id === item.group.categoryId);
    if (!category) {
      skipped += 1;
      continue;
    }
    const laneId = category.board.lanes.some((lane) => lane.id === item.group.laneId)
      ? item.group.laneId
      : category.board.lanes[0]?.id || "default";
    const product = makeProduct(
      ascmProductId(item.group, next),
      String(item.group.displayName || item.group.records?.[0]?.description || "ASCM product"),
      null,
      laneId,
      category.board.products.length,
      { priceLabel: "Price TBD", roadmap: null, specs: defaultSpecificationsForCategory(category.id, laneId) }
    );
    applyAscmGroupToProduct(product, item.group, plan.dataset, importedAt, true);
    category.board.products.push(product);
    added += 1;
  }

  for (const category of next.categories) {
    for (const lane of category.board.lanes) normalizeOrdersForBoard(category.board, lane.id);
  }
  next.ascmSnapshot = normalizeAscmSnapshot({
    sourceFile: plan.dataset.metadata?.fileName || "ASCM report.xlsx",
    exportedAt: plan.dataset.metadata?.exportedAt || "",
    importedAt,
    basePartNumbers: plan.currentPns,
  });
  portfolio = ensurePortfolioSchema(next);
  const returnCategoryId = portfolio.categories.some((category) => category.id === activeCategoryId)
    ? activeCategoryId
    : portfolio.activeCategoryId;
  selectedId = null;
  activateCategory(returnCategoryId, { fitVertical: true });
  return { added, updated, unchanged, skipped };
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
  if (event.key === "Enter" && selectedId) {
    event.preventDefault();
    openViewerInfo(selectedId);
    return;
  }
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
$("#importAscm").onclick = () => { closePopupMenus(); $("#importAscmFile").click(); };
$("#importAscmFile").onchange = async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    await openAscmImport(file);
  } catch (error) {
    console.error("ASCM import preview failed:", error);
    void PortfolioDialogs.alert(error.message || "Unable to read the ASCM report.", { title: "ASCM import failed" });
  }
};
ascmImportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pendingAscmImport) return;
  confirmAscmImportButton.disabled = true;
  confirmAscmImportButton.textContent = "Applying…";
  try {
    const dataset = pendingAscmImport.dataset;
    const result = applyAscmImportPlan(pendingAscmImport, {
      updateMatched: $("#ascmApplyUpdates").checked,
      addNew: $("#ascmAddProducts").checked,
    });
    closeAscmImportDialog();
    globalThis.PortfolioProductIssues?.setAscmPlan(buildAscmImportPlan(dataset));
    void showWorkspaceNotice(`${result.added} product(s) added, ${result.updated} updated, ${result.unchanged} already current, and ${result.skipped} skipped.`, { id: "ascm-result", title: "ASCM update complete", severity: "success" });
  } catch (error) {
    console.error("ASCM update failed:", error);
    confirmAscmImportButton.disabled = false;
    confirmAscmImportButton.textContent = "Apply ASCM update";
    void PortfolioDialogs.alert(error.message || "Unable to apply the ASCM update.", { title: "ASCM update failed" });
  }
});
$("#closeAscmImport").onclick = closeAscmImportDialog;
$("#cancelAscmImport").onclick = closeAscmImportDialog;
ascmImportDialog.addEventListener("pointerdown", (event) => {
  if (event.target === ascmImportDialog) closeAscmImportDialog();
});
$("#importPackageFile").onchange = async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try { await globalThis.PortfolioPackageUI.openImport(file); }
  catch (error) { void PortfolioDialogs.alert(error.message || "Unable to import the project package.", { title: "Package import failed" }); }
};
$("#exportPackage").onclick = async () => {
  try { await exportProjectPackage(); }
  catch (error) { void PortfolioDialogs.alert(error.message || "Unable to export the project package.", { title: "Package export failed" }); }
};
$("#importJson").onclick = () => { closePopupMenus(); $("#importFile").click(); };
$("#importFile").onchange = (event) => { const file = event.target.files?.[0]; if (file) importJson(file); event.target.value = ""; };
$("#exportJson").onclick = () => { closePopupMenus(); downloadBlob(new Blob([JSON.stringify(portfolio, null, 2)], { type: "application/json" }), "product-portfolio-data.data"); };
$("#exportPng").onclick = () => { closePopupMenus(); exportPng(); };
$("#exportPptx").addEventListener("click", openPptxExportDialog);
$("#pptxSelectAllCategories").onclick = () => {
  const available = PPTXPagination.selectExportCategories(portfolio?.categories);
  setPptxCategorySelection(pptxExportCategories().length === available.length ? [] : available.map((category) => category.id));
};
$("#pptxSelectCurrentCategory").onclick = () => setPptxCategorySelection([activeCategoryId]);
pptxExportForm.addEventListener("change", syncPptxExportSummary);
pptxExportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (pptxExportInProgress) return;
  const scope = pptxExportScope();
  const categories = pptxExportCategories();
  if (!categories.length) { syncPptxExportSummary(); return; }
  const originalText = confirmPptxExportButton.textContent;
  pptxExportInProgress = true;
  const exportControls = [...pptxExportForm.querySelectorAll("input, button")];
  exportControls.forEach((control) => { control.disabled = true; });
  confirmPptxExportButton.textContent = "Exporting…";
  try {
    await exportPptx(scope, categories.map((category) => category.id));
    pptxExportInProgress = false;
    closePptxExportDialog();
  } catch (error) {
    console.error(error);
    void PortfolioDialogs.alert(error.message || "Could not export PPTX.", { title: "PowerPoint export failed" });
  } finally {
    pptxExportInProgress = false;
    exportControls.forEach((control) => { control.disabled = false; });
    confirmPptxExportButton.textContent = originalText;
    syncPptxExportSummary();
  }
});
$("#closePptxExport").onclick = closePptxExportDialog;
$("#cancelPptxExport").onclick = closePptxExportDialog;
pptxExportDialog.addEventListener("pointerdown", (event) => {
  if (event.target === pptxExportDialog) closePptxExportDialog();
});
pptxExportDialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closePptxExportDialog();
  } else if (event.key === "Tab") {
    const focusable = [...pptxExportForm.querySelectorAll("input:not([disabled]), button:not([disabled])")];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
$("#searchInput").oninput = (event) => { searchQuery = event.target.value; renderBoard(); };
$("#showPrices").onchange = (event) => updateBoard((current) => { current.settings.showPrices = event.target.checked; });
$("#showSkus").onchange = (event) => updateBoard((current) => { current.settings.showSkus = event.target.checked; });
$("#resetLayout").onclick = () => {
  zoom = 1;
  closePopupMenus();
  updateBoard((current) => { current.products.forEach((product) => delete product.manualPosition); current.settings.freeMove = false; current.lanes.forEach((lane) => normalizeLaneOrders(lane.id)); });
};
$("#fitProducts").onclick = () => { closePopupMenus(); fitProductBoard(); };
$("#zoomOut").onclick = () => setProductZoom(steppedViewZoom(zoom, -1, PRODUCT_MIN_ZOOM, PRODUCT_MAX_ZOOM));
$("#zoomReset").onclick = () => setProductZoom(1);
$("#zoomIn").onclick = () => setProductZoom(steppedViewZoom(zoom, 1, PRODUCT_MIN_ZOOM, PRODUCT_MAX_ZOOM));
$("#restoreSample").onclick = async () => {
  closePopupMenus();
  const clearingPortfolio = portfolio;
  if (!await PortfolioDialogs.confirm("Clear every product in all categories and remove their saved images? Your categories, lanes, settings, and templates will stay. Export a project package first if you need a backup.", { title: "Clear all products?", confirmLabel: "Clear all products", danger: true })) return;
  if (portfolio !== clearingPortfolio) return;
  try { await imageStoreClear(); } catch (_) {}
  localStorage.removeItem(PACKAGE_RECOVERY_KEY);
  clearPackageImageCaches();
  PortfolioModel.clearAllProducts(portfolio);
  activateCategory(activeCategoryId, { fitVertical: true });
  $("#emptyPullLatestData").focus({ preventScroll: true });
};

document.querySelectorAll(".view-tab").forEach((button) => {
  button.onclick = () => setView(button.dataset.view, { focusSelected: true });
});
$("#toggleRoadmapDetails").onclick = () => {
  roadmapDetailsOpen = !roadmapDetailsOpen;
  setView("roadmap", { focusSelected: true });
};

$("#roadmapSearch").oninput = (event) => {
  roadmapSearchQuery = event.target.value;
  roadmapFilterScrollResetPending = true;
  renderRoadmaps();
};
$("#roadmapStart").onchange = (event) => {
  const startMonth = normalizeMonth(event.target.value, board.settings.roadmap.startMonth);
  const endMonth = monthIndex(board.settings.roadmap.endMonth) < monthIndex(startMonth) ? addMonths(startMonth, 11) : board.settings.roadmap.endMonth;
  updateTimelineSettings({ startMonth, endMonth });
};
$("#roadmapEnd").onchange = (event) => {
  let endMonth = normalizeMonth(event.target.value, board.settings.roadmap.endMonth);
  if (monthIndex(endMonth) <= monthIndex(board.settings.roadmap.startMonth)) endMonth = addMonths(board.settings.roadmap.startMonth, 11);
  updateTimelineSettings({ endMonth });
};
$("#roadmapSnap").onchange = (event) => updateTimelineSettings({ snap: event.target.value });
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
document.querySelectorAll("[data-roadmap-years]").forEach((button) => {
  button.onclick = () => {
    setRoadmapYearSpan(Number(button.dataset.roadmapYears));
  };
});
$("#roadmapToday").onclick = () => { closePopupMenus(); scrollRoadmapToday(activeView === "split" ? splitRoadmapScroll : roadmapScroll); };
$("#roadmapFit").onclick = () => { closePopupMenus(); fitRoadmapTimeline(); };
$("#roadmapZoomOut").onclick = () => setRoadmapZoom(steppedViewZoom(roadmapMonthWidth / ROADMAP_DEFAULT_MONTH_WIDTH, -1, ROADMAP_MIN_MONTH_WIDTH / ROADMAP_DEFAULT_MONTH_WIDTH, ROADMAP_MAX_MONTH_WIDTH / ROADMAP_DEFAULT_MONTH_WIDTH) * ROADMAP_DEFAULT_MONTH_WIDTH);
$("#roadmapZoomReset").onclick = () => setRoadmapZoom(ROADMAP_DEFAULT_MONTH_WIDTH);
$("#roadmapZoomIn").onclick = () => setRoadmapZoom(steppedViewZoom(roadmapMonthWidth / ROADMAP_DEFAULT_MONTH_WIDTH, 1, ROADMAP_MIN_MONTH_WIDTH / ROADMAP_DEFAULT_MONTH_WIDTH, ROADMAP_MAX_MONTH_WIDTH / ROADMAP_DEFAULT_MONTH_WIDTH) * ROADMAP_DEFAULT_MONTH_WIDTH);
$("#roadmapShowSelected").onclick = () => { closePopupMenus(); scrollRoadmapSelected(activeView === "split" ? splitRoadmapScroll : roadmapScroll); };
$("#roadmapModePan").onclick = () => setRoadmapInteractionMode("pan");
$("#roadmapModeDates").onclick = () => setRoadmapInteractionMode("dates");
$("#roadmapMoveUp").onclick = () => moveSelectedRoadmapRow(-1);
$("#roadmapMoveDown").onclick = () => moveSelectedRoadmapRow(1);

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
  if (!variantPopover.classList.contains("hidden") && !variantPopover.contains(event.target)) closeVariantPopover({ force: true });
  if (!event.target.closest(".popup-menu-shell") && !event.target.closest(".popup-menu") && !event.target.closest(".workspace-tool-menu") && !event.target.closest("#workspaceSettingsDialog")) closePopupMenus();
});
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.querySelector("dialog[open]")) return;
  closePopupMenus();
  closeVariantPopover({ force: true });
  closeAscmImportDialog();
  closePptxExportDialog();
  closeCategorySettings();
  if (productLayoutEditing) {
    productLayoutEditing = false;
    updateProductLayoutEditControls();
    renderBoard();
    return;
  }
  if (roadmapInteractionMode === "dates" || roadmapDragState || roadmapPanState) {
    setRoadmapInteractionMode("pan");
    return;
  }
  if (inspectorOpen) {
    closeInspector();
    return;
  }
  if (selectedId) clearSelection();
});
window.addEventListener("resize", () => { closeVariantPopover({ force: true }); renderActiveView(); });
window.addEventListener("portfolio:ui-ready", publishWorkspaceState);

// Draft actions keep complete records and images until the user saves or discards.
const discardedDrafts = new Map();
function localizeSharedProduct(record) {
  const product = JSON.parse(JSON.stringify(record));
  const aliases = portfolio.masterLocalAssetIds || {};
  product.imageAssetId = aliases[product.imageAssetId] || product.imageAssetId;
  for (const group of product.variantGroups || []) for (const row of group.items || []) row.imageAssetId = aliases[row.imageAssetId] || row.imageAssetId;
  delete product.categoryId;
  return product;
}
function mergeProductEntries() {
  return portfolio.categories.flatMap((category) => category.board.products.map((product) => ({
    product: JSON.parse(JSON.stringify(product)), categoryId: category.id, categoryName: category.name,
    laneName: category.board.lanes.find((lane) => lane.id === product.laneId)?.label || "",
  })));
}
function canMergeProducts(productId, sourceProductId) {
  if (packageOperationInProgress || globalThis.PortfolioMasterUI?.getSession?.()?.getState().busy) return { allowed: false, message: "Wait for the current update to finish." };
  const entries = mergeProductEntries();
  const keepers = entries.filter((entry) => entry.product.id === productId), sources = entries.filter((entry) => entry.product.id === sourceProductId);
  if (keepers.length !== 1 || sources.length !== 1 || productId === sourceProductId) return { allowed: false, message: "Choose two different products." };
  if (keepers[0].categoryId !== sources[0].categoryId) return { allowed: false, message: "Choose products from the same portfolio. Listings in different portfolios stay separate." };
  if ((portfolio.masterLocalMerges || []).some((merge) => [merge.productId, merge.sourceProductId].some((value) => value === productId || value === sourceProductId))) return { allowed: false, message: "Save or undo the previous merge before combining this product again." };
  return { allowed: true };
}
function updateDraftViews(categoryId = activeCategoryId, productId = selectedId) {
  activateCategory(categoryId, { render: false });
  selectedId = board.products.some((product) => product.id === productId) ? productId : null;
  scheduleSave(); syncControls(); renderInspector(); renderActiveView();
}
function applyProductMergeDraft(payload) {
  const allowed = canMergeProducts(payload.productId, payload.sourceProductId);
  if (!allowed.allowed) throw new Error(allowed.message);
  const next = clonePortfolioData();
  const keeper = findPortfolioProductLocation(next, payload.productId), source = findPortfolioProductLocation(next, payload.sourceProductId);
  for (const [original, current] of [[payload.keeperOriginal, keeper.product], [payload.sourceOriginal, source.product]]) {
    if (original && globalThis.PortfolioMasterModel.productVersion(original) !== globalThis.PortfolioMasterModel.productVersion(current)) throw new Error("These products changed while you were reviewing. Open the merge again to see their latest details.");
  }
  // Resolve again against the actual records; never trust a stale preview or edited payload.
  const merged = globalThis.PortfolioProductMerge.resolve(globalThis.PortfolioProductMerge.plan(keeper.product, source.product), payload.choices || {});
  const references = [];
  for (const category of next.categories) for (const product of category.board.products) {
    if ([payload.productId, payload.sourceProductId].includes(product.id)) continue;
    const before = JSON.parse(JSON.stringify(product.roadmap || {}));
    let changed = false;
    for (const field of ["predecessorId", "successorId"]) if (product.roadmap?.[field] === payload.sourceProductId) { product.roadmap[field] = payload.productId; changed = true; }
    if (changed) references.push({ productId: product.id, before, after: JSON.parse(JSON.stringify(product.roadmap)) });
  }
  const undoId = id();
  const intent = { undoId, productId: payload.productId, sourceProductId: payload.sourceProductId,
    choices: JSON.parse(JSON.stringify(payload.choices || {})),
    keeperProduct: { ...JSON.parse(JSON.stringify(keeper.product)), categoryId: keeper.category.id },
    sourceProduct: { ...JSON.parse(JSON.stringify(source.product)), categoryId: source.category.id },
    base: JSON.parse(JSON.stringify((next.masterLocalBaseline || []).find((item) => item.productId === payload.productId) || null)),
    sourceBase: JSON.parse(JSON.stringify((next.masterLocalBaseline || []).find((item) => item.productId === payload.sourceProductId) || null)),
    references, mergedVersion: globalThis.PortfolioMasterModel.productVersion(merged) };
  next.masterLocalMerges = [...(next.masterLocalMerges || []), intent];
  next.masterLocalRemovedProducts ||= {};
  next.masterLocalRemovedProducts[payload.sourceProductId] = JSON.parse(JSON.stringify(source.product));
  keeper.category.board.products[keeper.index] = merged;
  source.category.board.products.splice(source.index, 1);
  portfolio = next;
  updateDraftViews(keeper.category.id, payload.productId);
  return { undoId };
}
function restoreMergeDraft(target, intent) {
  const keeper = findPortfolioProductLocation(target, intent.productId);
  if (!keeper || findPortfolioProductLocation(target, intent.sourceProductId)) return false;
  const sourceCategory = target.categories.find((category) => category.id === intent.sourceProduct.categoryId);
  if (!sourceCategory) return false;
  const keeperProduct = JSON.parse(JSON.stringify(intent.keeperProduct)), sourceProduct = JSON.parse(JSON.stringify(intent.sourceProduct));
  delete keeperProduct.categoryId; delete sourceProduct.categoryId;
  keeper.category.board.products[keeper.index] = keeperProduct;
  sourceCategory.board.products.push(sourceProduct);
  for (const reference of intent.references || []) {
    const location = findPortfolioProductLocation(target, reference.productId);
    if (location) for (const field of ["predecessorId", "successorId"]) {
      if (reference.before[field] !== reference.after[field] && location.product.roadmap?.[field] === reference.after[field]) {
        if (Object.prototype.hasOwnProperty.call(reference.before, field)) location.product.roadmap[field] = reference.before[field];
        else delete location.product.roadmap[field];
      }
    }
  }
  target.masterLocalMerges = (target.masterLocalMerges || []).filter((merge) => merge.undoId !== intent.undoId);
  return true;
}
function undoProductMergeDraft(undoId) {
  if (packageOperationInProgress || globalThis.PortfolioMasterUI?.getSession?.()?.getState().busy) return false;
  const intent = (portfolio.masterLocalMerges || []).find((merge) => merge.undoId === undoId);
  const keeper = intent && findPortfolioProductLocation(portfolio, intent.productId);
  if (!keeper || globalThis.PortfolioMasterModel.productVersion(keeper.product) !== intent.mergedVersion) return false;
  const next = clonePortfolioData();
  if (!restoreMergeDraft(next, intent)) return false;
  portfolio = next; updateDraftViews(keeper.category.id, intent.productId); return true;
}
function discardProductDrafts(productIds) {
  if (packageOperationInProgress || globalThis.PortfolioMasterUI?.getSession?.()?.getState().busy) throw new Error("Wait for the current update to finish.");
  const ids = new Set(productIds), next = clonePortfolioData(), previous = clonePortfolioData();
  for (const intent of [...(next.masterLocalMerges || [])]) if (ids.has(intent.productId) || ids.has(intent.sourceProductId)) {
    if (!restoreMergeDraft(next, intent)) throw new Error("This merge needs review before it can be discarded.");
    ids.add(intent.productId); ids.add(intent.sourceProductId);
  }
  const baseline = new Map((next.masterLocalBaseline || []).map((item) => [item.productId, item]));
  for (const productId of ids) {
    const location = findPortfolioProductLocation(next, productId), saved = baseline.get(productId);
    if (!saved) { if (location) location.category.board.products.splice(location.index, 1); continue; }
    if (location) location.category.board.products[location.index] = globalThis.PortfolioMasterModel.applyProductValues(location.product, saved.values);
    else {
      const original = next.masterLocalRemovedProducts?.[productId];
      const category = next.categories.find((item) => item.id === saved.categoryId);
      if (!original || !category) throw new Error("The original product is unavailable. Your changes have been kept.");
      category.board.products.push(globalThis.PortfolioMasterModel.applyProductValues(original, saved.values));
    }
  }
  portfolio = next; updateDraftViews();
  const undoId = id();
  discardedDrafts.clear(); discardedDrafts.set(undoId, { previous, after: JSON.stringify(portfolio) });
  return { discarded: productIds.length, undoId };
}
function undoDiscardedDraft(undoId) {
  const record = discardedDrafts.get(undoId);
  if (!record || packageOperationInProgress || globalThis.PortfolioMasterUI?.getSession?.()?.getState().busy || JSON.stringify(portfolio) !== record.after) return false;
  portfolio = record.previous; discardedDrafts.delete(undoId); updateDraftViews(); return true;
}
globalThis.PortfolioSearchAdapter = Object.freeze({
  getPortfolio: () => portfolio,
  getActiveCategoryId: () => activeCategoryId,
  getActiveView: () => activeView,
  openResult: openPortfolioSearchResult,
});

globalThis.PortfolioProductMergeAdapter = Object.freeze({
  getProducts: mergeProductEntries, getSelectedProductId: () => selectedId || "", canMerge: canMergeProducts,
  getImageSource: (assetId) => imageAssetSource(assetId, ""),
  applyMerge: applyProductMergeDraft, undoMerge: undoProductMergeDraft,
  openProduct: (productId) => { const entry = globalThis.PortfolioProductIssues.products(portfolio).find((item) => item.product.id === productId); if (entry) return openProductIssue(entry); },
  saveChanges: () => globalThis.PortfolioMasterUI?.save?.(),
});

// Shared facts update complete local records without replacing layouts or images.
globalThis.PortfolioMasterAdapter = Object.freeze({
  getProducts: () => portfolio.categories.flatMap((category) => category.board.products.map((product) => ({ ...product, categoryId: category.id }))),
  getBaselineProducts: () => portfolio.masterLocalBaseline || [],
  getMasterTombstones: () => portfolio.masterLocalTombstones || [],
  getMergeIntents: () => portfolio.masterLocalMerges || [],
  setMergeIntents: (intents) => { portfolio.masterLocalMerges = JSON.parse(JSON.stringify(intents)); scheduleSave(); },
  serializeNewProduct: (product) => {
    const copy = JSON.parse(JSON.stringify(product));
    const aliases = new Map(Object.entries(portfolio.masterLocalAssetIds || {}).map(([original, local]) => [local, original]));
    copy.imageAssetId = aliases.get(copy.imageAssetId) || copy.imageAssetId;
    for (const group of copy.variantGroups || []) for (const row of group.items || []) row.imageAssetId = aliases.get(row.imageAssetId) || row.imageAssetId;
    return copy;
  },
  discardChanges: discardProductDrafts, undoDiscard: undoDiscardedDraft,
  onMergeReviewRequired: (error) => {
    const conflict = error.conflicts?.find((item) => item.kind === "merge");
    const intent = conflict && (portfolio.masterLocalMerges || []).find((item) => item.productId === conflict.productId);
    if (!intent) return;
    globalThis.PortfolioNotifications?.publish({ id: "product-merge-review", severity: "warning", title: "Review this merge again", message: "Someone updated these products while you were editing. Your draft is safe.", dismissible: false, toast: true,
      actions: [{ label: "Review merge", onClick: async () => {
        const session = globalThis.PortfolioMasterUI?.getSession?.();
        let latest;
        try { latest = await session.reviewMerge(intent.productId, intent.sourceProductId); }
        catch (_) { await showWorkspaceNotice("The latest details are unavailable. Your draft is safe; try reviewing again shortly."); return; }
        if ((intent.base && !latest.products.some((entry) => entry.product.id === intent.productId)) || (intent.sourceBase && !latest.products.some((entry) => entry.product.id === intent.sourceProductId))) { await showWorkspaceNotice("One of these products was removed. Discard this merge and review the current products."); return; }
        const model = globalThis.PortfolioMasterModel;
        const reviewedProducts = [], conflicts = [];
        for (const entry of latest.products) {
          const previous = entry.product.id === intent.productId ? intent.keeperProduct : intent.sourceProduct;
          const previousBase = entry.product.id === intent.productId ? intent.base : intent.sourceBase;
          const product = localizeSharedProduct(entry.product);
          const latestBase = latest.snapshot.products.find((item) => item.productId === entry.product.id);
          const plan = previousBase ? model.planMerge(previousBase.values, model.productValues(previous), latestBase.values, previousBase.revisions, latestBase.revisions) : null;
          const metadataReview = model.supplementReview(product, previous);
          for (const conflict of [...(plan?.conflicts || []), ...metadataReview.conflicts]) conflicts.push({ ...conflict, key: JSON.stringify([entry.product.id, conflict.path]), productName: product.name });
          reviewedProducts.push({ entry, product, plan, metadataReview });
        }
        const choices = conflicts.length ? await globalThis.PortfolioMasterUI?.reviewConflicts?.(conflicts) : {};
        if (!choices) return;
        const completedProducts = reviewedProducts.map(({ entry, product, plan, metadataReview }) => {
          const selected = Object.fromEntries((plan?.conflicts || []).map((conflict) => [conflict.path, choices[JSON.stringify([entry.product.id, conflict.path])]]));
          const values = plan ? model.resolveConflicts(plan, selected) : model.productValues(product);
          return { entry, product: model.applyProductValues(model.resolveSupplementReview(metadataReview, choices), values) };
        });
        if (!undoProductMergeDraft(intent.undoId)) { await showWorkspaceNotice("Save or discard edits to the combined product before reviewing the merge again."); return; }
        for (const { entry, product } of completedProducts) {
          const location = findPortfolioProductLocation(portfolio, entry.product.id);
          if (!location) continue;
          location.category.board.products[location.index] = product;
        }
        const pair = new Set([intent.productId, intent.sourceProductId]);
        portfolio.masterLocalBaseline = [...(portfolio.masterLocalBaseline || []).filter((item) => !pair.has(item.productId)), ...latest.snapshot.products.filter((item) => pair.has(item.productId))];
        session.rebaseMergeReview(latest);
        updateDraftViews();
        globalThis.PortfolioNotifications?.resolve("product-merge-review");
        globalThis.PortfolioProductMergeUI?.open({ productId: intent.productId, sourceProductId: intent.sourceProductId });
      } }] });
  },
  setBaselineProducts: (products) => {
    portfolio.masterLocalBaseline = JSON.parse(JSON.stringify(products));
    scheduleSave();
  },
  getPackageInfo: () => getCurrentPackageInfo(),
  getSelectedProductId: () => selectedId || "",
  getSelectedCategoryId: () => activeCategoryId || "",
  hasPendingPackageOperation: () => packageOperationInProgress,
  setPackageInfo: (info) => {
    portfolio.packageInfo = packageCodec().normalizePackageInfo(info);
    scheduleSave();
  },
  setMasterSnapshot: (snapshot) => {
    portfolio.masterLocalTombstones = JSON.parse(JSON.stringify(snapshot.tombstones || []));
    if (Object.prototype.hasOwnProperty.call(snapshot, "masterSync")) {
      if (snapshot.masterSync) portfolio.masterSync = JSON.parse(JSON.stringify(snapshot.masterSync));
      else delete portfolio.masterSync;
    }
    scheduleSave();
  },
  canRefresh: () => !packageOperationInProgress && !roadmapDragState && !document.querySelector('.modal-backdrop:not(.hidden), dialog[open]') && !document.activeElement?.closest('#inspector'),
  applyPatches: (changes) => {
    if (packageOperationInProgress) throw new Error("Finish loading the package before saving shared changes.");
    const nextProducts = new Map(portfolio.categories.map((category) => [category.id, category.board.products.slice()]));
    for (const change of changes) {
      if (change.kind === "merge") {
        const all = [...nextProducts.values()].flat();
        const keeper = all.find((product) => product.id === change.productId), source = all.find((product) => product.id === change.sourceProductId);
        if (keeper && source) {
          const completed = globalThis.PortfolioProductMerge.resolve(globalThis.PortfolioProductMerge.plan(keeper, source), change.choices || {});
          for (const products of nextProducts.values()) {
            const keeperIndex = products.findIndex((product) => product.id === change.productId);
            if (keeperIndex >= 0) products[keeperIndex] = globalThis.PortfolioMasterModel.applyProductValues(completed, change.values);
            const sourceIndex = products.findIndex((product) => product.id === change.sourceProductId);
            if (sourceIndex >= 0) products.splice(sourceIndex, 1);
          }
        }
        continue;
      }
      if (change.kind === "create") {
        const target = portfolio.categories.find((category) => category.id === change.categoryId);
        if (!target || !target.board.lanes.some((lane) => lane.id === change.laneId)) throw new Error("This product's portfolio or lane has changed. Refresh its details before trying again.");
        if ([...nextProducts.values()].some((products) => products.some((product) => product.id === change.productId))) throw new Error("A repeated product ID needs review before applying the update.");
        const products = nextProducts.get(target.id);
        const order = products.filter((product) => product.laneId === change.laneId).reduce((maximum, product) => Math.max(maximum, Number(product.order) || 0), -1) + 1;
        const archived = portfolio.masterLocalRemovedProducts?.[change.productId];
        const product = change.fullProduct ? localizeSharedProduct(change.fullProduct) : archived || makeProduct(change.productId, change.values.name, change.values.price, change.laneId, order);
        products.push(globalThis.PortfolioMasterModel.applyProductValues({ ...product, laneId: change.laneId }, change.values));
        continue;
      }
      for (const category of portfolio.categories) {
        const products = nextProducts.get(category.id);
        const index = products.findIndex((product) => product.id === change.productId);
        if (index < 0) continue;
        const current = products[index];
        if (change.kind === "delete") { products.splice(index, 1); break; }
        const values = change.values || change.patch;
        const original = change.fullProduct ? { ...localizeSharedProduct(change.fullProduct), order: current.order, laneId: current.laneId } : current;
        products[index] = globalThis.PortfolioMasterModel.applyProductValues(original, values);
        break;
      }
    }
    for (const category of portfolio.categories) category.board.products = nextProducts.get(category.id);
    if (selectedId && !board.products.some((product) => product.id === selectedId)) selectedId = board.products[0]?.id || null;
    scheduleSave();
    syncControls();
    renderInspector();
    renderActiveView();
  },
});

portfolio = loadPortfolio();
if (globalThis.PortfolioMasterModel && !portfolio.masterLocalBaseline) {
  try { portfolio.masterLocalBaseline = globalThis.PortfolioMasterModel.snapshot(portfolio).products; }
  catch (error) {
    workspaceValidationPending = true;
    void showWorkspaceNotice(error.message || "Some product records need review before saving to master.", { id: "workspace-product-validation", title: "Product records need review", severity: "warning", actions: [{ label: "Review duplicates", onClick: () => globalThis.PortfolioProductIssues?.reviewDuplicateIssues() }] });
  }
}
activateCategory(portfolio.activeCategoryId, { render: false, fitVertical: true });
syncControls();
renderInspector();
setView("products");
flushPendingLegacyImages();
globalThis.PortfolioProductIssues?.mount({
  adapter: {
    getPortfolio: () => portfolio,
    openProduct: openProductIssue,
    mergeProducts: (members) => globalThis.PortfolioProductMergeUI?.open({ productId: members[0]?.locator.productId, sourceProductId: members[1]?.locator.productId }),
    rebuildAscmPlan: (plan) => buildAscmImportPlan(plan.dataset),
    onIssuesChanged: () => {
      if (!workspaceValidationPending) return;
      try {
        globalThis.PortfolioMasterModel.snapshot(portfolio);
        workspaceValidationPending = false;
        globalThis.PortfolioNotifications?.resolve("workspace-product-validation");
      } catch (_) {}
    },
  },
  notifications: globalThis.PortfolioNotifications,
});
