import { mkdir, open, realpath, rename, unlink, lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import "../public/js/package-codec.js";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MASTER_PATH = path.join(PROJECT_ROOT, "public", "data", "master_ppc.pkg");
const codec = globalThis.PortfolioPackage;
const MAGIC = Buffer.from("PPCPKG01", "ascii");
const MIN_ENVELOPE_BYTES = 20 + 16 + 22; // Header, GCM tag, and at least a ZIP end record.
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const catalogContext = { window: {} };
vm.runInNewContext(await readFile(path.join(PROJECT_ROOT, "public/js/catalog-data.js"), "utf8"), catalogContext);
const categoryIds = new Set(catalogContext.window.PORTFOLIO_CATALOG.categories.map((category) => category.id));

function within(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function validateEncryptedEnvelope(value) {
  if (!ArrayBuffer.isView(value)) throw new Error("The master package must contain binary package bytes.");
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.byteLength > codec.MAX_PACKAGE_BYTES) throw new Error("The master package exceeds the 64 MiB size limit.");
  if (bytes.byteLength < MIN_ENVELOPE_BYTES) throw new Error("The master package is truncated or has no package content.");
  if (!MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new Error("Publish only an encrypted PPCPKG01 package. Build it with package-key protection enabled.");
  }
  return bytes;
}

export async function readBoundedFile(filename, limit = codec.MAX_PACKAGE_BYTES) {
  const handle = await open(filename, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Choose a regular package file.");
    if (info.size > limit) throw new Error(limit === codec.MAX_PACKAGE_BYTES ? "The master package exceeds the 64 MiB size limit." : "The private key file is too large.");
    const chunks = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, limit - total + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) throw new Error(limit === codec.MAX_PACKAGE_BYTES ? "The master package exceeds the 64 MiB size limit." : "The private key file is too large.");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

export async function inspectHostedData(dataDirectory = path.dirname(MASTER_PATH), { required = false, ignoreMaster = false } = {}) {
  let foundMaster = false;
  async function visit(directory) {
    let items;
    try { items = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const item of items) {
      const filename = path.join(directory, item.name);
      const relative = path.relative(dataDirectory, filename).split(path.sep).join("/");
      if (item.isSymbolicLink()) throw new Error("Hosted package data must not contain symbolic links.");
      if (item.isDirectory()) throw new Error("public/data may contain only the master_ppc.pkg file, with no other files or folders.");
      if (!item.isFile()) throw new Error("Hosted package data must contain regular files only.");
      const isMaster = relative === "master_ppc.pkg";
      if (/\.pkg$/i.test(item.name) && !isMaster) throw new Error("public/data may contain only one .pkg file, named master_ppc.pkg.");
      if (isMaster) {
        foundMaster = true;
        if (!ignoreMaster) validateEncryptedEnvelope(await readBoundedFile(filename));
        continue;
      }
      const handle = await open(filename, "r");
      try {
        const header = Buffer.alloc(4);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const zipSignature = bytesRead === 4 && header[0] === 0x50 && header[1] === 0x4b
          && ((header[2] === 1 && header[3] === 2) || (header[2] === 3 && header[3] === 4) || (header[2] === 5 && header[3] === 6) || (header[2] === 7 && header[3] === 8));
        if (zipSignature || /\.zip$/i.test(item.name)) throw new Error("Do not publish an unencrypted ZIP in public/data.");
        throw new Error("public/data may contain only the master_ppc.pkg file. Keep keys, portfolio JSON, and images outside this folder.");
      } finally { await handle.close(); }
    }
  }
  await visit(dataDirectory);
  if (required && !foundMaster) throw new Error("public/data/master_ppc.pkg is missing. Build and publish the encrypted master before deployment.");
  return { present: foundMaster };
}

export function validateDecryptedPackage(bytes) {
  const entries = codec.readZip(bytes);
  const manifestBytes = entries.get("portfolio.json");
  if (!manifestBytes || manifestBytes.length > MAX_MANIFEST_BYTES) throw new Error("The package portfolio is missing or exceeds the 4 MiB data limit.");
  let manifest;
  try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)); }
  catch { throw new Error("The package portfolio data is damaged."); }
  const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (!isRecord(manifest)) throw new Error("The package does not contain a portfolio.");
  const packageInfo = codec.normalizePackageInfo(manifest.packageInfo);
  let boards;
  if ([2, 3, 4].includes(manifest.version) && Array.isArray(manifest.categories) && manifest.categories.length) {
    const seen = new Set();
    boards = manifest.categories.map((category) => {
      if (!isRecord(category) || !categoryIds.has(category.id) || seen.has(category.id)) throw new Error("The package contains an unsupported or repeated category.");
      seen.add(category.id);
      return category.board;
    });
  } else if (manifest.version === 1 && Array.isArray(manifest.products) && Array.isArray(manifest.lanes)) {
    boards = [manifest];
  } else { throw new Error("The package uses an unsupported portfolio version."); }
  const products = new Set();
  const referencedImages = new Set();
  for (const board of boards) {
    if (!isRecord(board) || !Array.isArray(board.lanes) || !Array.isArray(board.products)) throw new Error("The package contains an invalid product board.");
    const lanes = new Set();
    for (const lane of board.lanes) {
      if (!isRecord(lane) || typeof lane.id !== "string" || !lane.id || lanes.has(lane.id)) throw new Error("The package contains an invalid or repeated product lane.");
      lanes.add(lane.id);
    }
    for (const product of board.products) {
      if (!isRecord(product) || typeof product.id !== "string" || !product.id || products.has(product.id) || typeof product.name !== "string") throw new Error("The package contains an invalid or repeated product.");
      products.add(product.id);
      if (product.imageAssetId) referencedImages.add(product.imageAssetId);
      if (product.variantGroups !== undefined && !Array.isArray(product.variantGroups)) throw new Error("The package contains invalid product variants.");
      for (const group of product.variantGroups || []) {
        if (!isRecord(group) || !Array.isArray(group.items)) throw new Error("The package contains invalid product variants.");
        for (const item of group.items) {
          if (!isRecord(item)) throw new Error("The package contains invalid product variants.");
          if (item.imageAssetId) referencedImages.add(item.imageAssetId);
        }
      }
    }
  }
  if (manifest.imageAssets !== undefined && !Array.isArray(manifest.imageAssets)) throw new Error("The package image library is invalid.");
  const assets = new Set();
  for (const asset of manifest.imageAssets || []) {
    if (!isRecord(asset) || typeof asset.id !== "string" || !asset.id || assets.has(asset.id)
      || (asset.sourceType !== undefined && !["local", "url"].includes(asset.sourceType))) throw new Error("The package contains an invalid or repeated image.");
    assets.add(asset.id);
    if (asset.sourceType === "url") continue;
    const extension = String(asset.fileName || asset.name || "").match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
      || ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "image/avif": "avif" }[asset.mimeType] || "img");
    const packagePath = asset.packagePath || `images/${asset.id}.${extension}`;
    if (typeof packagePath !== "string" || !packagePath.startsWith("images/") || !entries.get(packagePath)?.length) throw new Error("The package is missing a saved product image.");
  }
  // Legacy v1 packages can contain inline images which the browser migrates.
  // Packages built by the current builder use the explicit image registry.
  if (manifest.version !== 1 || manifest.imageAssets !== undefined) {
    for (const imageId of referencedImages) if (!assets.has(imageId)) throw new Error("The package refers to an image missing from its image library.");
  }
  return { categoryCount: boards.length, productCount: products.size, entryCount: entries.size, packageInfo };
}

export async function publishMasterPackage({ input, keyFile = "", projectRoot = PROJECT_ROOT } = {}) {
  if (!input) throw new Error("Choose an encrypted package with --input.");
  const root = await realpath(path.resolve(projectRoot));
  const publicDirectory = path.join(root, "public");
  if ((await lstat(publicDirectory)).isSymbolicLink()) throw new Error("The public destination must not be a symbolic link.");
  const publicRealPath = await realpath(publicDirectory);
  if (!within(root, publicRealPath)) throw new Error("The public directory must remain inside the project workspace.");
  const dataDirectory = path.join(publicDirectory, "data");
  await mkdir(dataDirectory, { recursive: true });
  if ((await lstat(dataDirectory)).isSymbolicLink()) throw new Error("The data destination must not be a symbolic link.");
  const dataRealPath = await realpath(dataDirectory);
  if (!within(publicRealPath, dataRealPath)) throw new Error("The master destination must remain inside public/data.");
  const destination = path.join(dataRealPath, "master_ppc.pkg");
  try { if ((await lstat(destination)).isSymbolicLink()) throw new Error("The master destination must not be a symbolic link."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await inspectHostedData(dataRealPath, { ignoreMaster: true });
  const encrypted = validateEncryptedEnvelope(await readBoundedFile(path.resolve(input)));
  let authenticated = false;
  if (keyFile) {
    const keyPath = await realpath(path.resolve(keyFile));
    if (within(publicRealPath, keyPath) || within(path.join(root, "_site"), keyPath)) throw new Error("Keep the package key file outside public and deployment folders.");
    const keyBytes = await readBoundedFile(keyPath, 4096);
    let key = "";
    try {
      key = codec.normalizeKey(new TextDecoder("utf-8", { fatal: true }).decode(keyBytes).trim().split(/\r?\n/)[0]);
      const plaintext = await codec.decrypt(encrypted, key);
      try { validateDecryptedPackage(plaintext); authenticated = true; }
      finally { plaintext.fill(0); }
    } finally { keyBytes.fill(0); key = ""; }
  }
  const temporary = path.join(dataRealPath, `.master_ppc.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(encrypted); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, destination);
  } finally {
    try { await unlink(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { bytes: encrypted.byteLength, authenticated };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let index = 2; index < process.argv.length; index += 1) {
      const argument = process.argv[index];
      if (argument === "--help") {
        console.log("Usage: node scripts/publish-master-package.mjs --input <encrypted.pkg> [--key-file <private-key-file>]\nValidates and replaces public/data/master_ppc.pkg. Commit and upload that encrypted file to publish it. The optional key file verifies authenticated package contents locally; the key is never copied to the site.");
        process.exit(0);
      }
      if (!["--input", "--key-file"].includes(argument) || !process.argv[index + 1] || process.argv[index + 1].startsWith("--")) throw new Error("Use --input <encrypted.pkg> and optional --key-file <private-key-file>.");
      const option = argument === "--input" ? "input" : "keyFile";
      if (options[option]) throw new Error("Specify each publishing option only once.");
      options[option] = process.argv[++index];
    }
    const result = await publishMasterPackage(options);
    console.log(`Encrypted master prepared in public/data/master_ppc.pkg (${result.bytes} bytes).`);
    console.log(result.authenticated ? "Authentication, portfolio data, and image references verified locally." : "Envelope and size verified. Use --key-file for authenticated content verification before upload.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
