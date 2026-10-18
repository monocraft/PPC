import { createHash, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../public/js/package-codec.js';
import '../public/js/master-model.js';
import {projectOwnerImages} from './owner-image-layer.mjs';
import {createGitPackageWriter} from './git-package-writer.mjs';
import { createPackageDeliveryClient, PackageDeliveryClientError } from './package-delivery-client.mjs';

const codec = globalThis.PortfolioPackage;
const model = globalThis.PortfolioMasterModel;
const PACKAGE_PATH = 'public/data/master_ppc.pkg';
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEED_URL = 'https://monocraft.github.io/PPC/data/master_ppc.pkg';
const SEED_SHA256 = 'd1af8e0e7fd1782a2b52433a38b62db227cc42a999179fb3ddd7d7d2bee1b7e2';
const SEED_BYTES = 45_439_227;
export const PINNED_SHAREPOINT_SEED = Object.freeze({ url: SEED_URL, sha256: SEED_SHA256, bytes: SEED_BYTES });
const copy = value => JSON.parse(JSON.stringify(value));
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const revisionOf = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw failure('INVALID_EXPORT');
  return value;
};
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : record(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const blobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export class PublisherError extends Error {
  constructor(code, message = 'The encrypted master could not be published. Accepted team changes remain in the shared master.') {
    super(message); this.code = code;
  }
}
const failure = code => new PublisherError(code);

export function normalizePublisherEndpoint(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw failure('INVALID_CONFIGURATION'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !url.pathname.endsWith('/functions/v1/ppc-master/api/master')) throw failure('INVALID_CONFIGURATION');
  return url.href.replace(/\/$/, '');
}

async function readBytes(response, maximum) {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw failure('RESPONSE_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maximum) throw failure('RESPONSE_TOO_LARGE');
    return bytes;
  }
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.length;
      if (length > maximum) { await reader.cancel(); throw failure('RESPONSE_TOO_LARGE'); }
      chunks.push(chunk.value);
    }
    return new Uint8Array(Buffer.concat(chunks, length));
  } finally { reader.releaseLock(); }
}

function validateManifest(manifest, entries) {
  if (!record(manifest) || ![1, 2, 3, 4].includes(manifest.version)) throw failure('INVALID_MANIFEST');
  try { codec.normalizePackageInfo(manifest.packageInfo); model.snapshot(manifest); }
  catch { throw failure('INVALID_MANIFEST'); }
  const categories = manifest.version === 1 ? [{ board: manifest }] : manifest.categories;
  if (!Array.isArray(categories) || !categories.length) throw failure('INVALID_MANIFEST');
  for (const category of categories) if (!record(category.board) || !Array.isArray(category.board.products) || !Array.isArray(category.board.lanes)) throw failure('INVALID_MANIFEST');
  const ids = new Set();
  for (const asset of manifest.imageAssets || []) {
    if (!record(asset) || typeof asset.id !== 'string' || !asset.id || ids.has(asset.id)) throw failure('INVALID_MANIFEST');
    ids.add(asset.id);
    if (asset.sourceType === 'local' && (typeof asset.packagePath !== 'string' || !entries.has(asset.packagePath))) throw failure('MISSING_ASSET');
  }
}

function assetDigest(entries) {
  const digest = createHash('sha256');
  for (const [name, bytes] of [...entries].filter(([name]) => name !== 'portfolio.json').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    digest.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`); digest.update(bytes);
  }
  return digest.digest('hex');
}

function withoutMarker(manifest) {
  const value = copy(manifest);
  if (record(value.masterSync)) delete value.masterSync.supabasePublication;
  return value;
}

function preparedManifest(manifest, revision) {
  const value = withoutMarker(manifest);
  value.masterSync = { ...(record(value.masterSync) ? value.masterSync : {}), supabaseRevision: revision };
  return value;
}

async function unpack(bytes, packageKey) {
  let plaintext;
  try {
    plaintext = await codec.decrypt(bytes, packageKey);
    const entries = codec.readZip(plaintext);
    const data = entries.get('portfolio.json');
    if (!data || data.length > 8 * 1024 * 1024) throw failure('INVALID_MANIFEST');
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    validateManifest(manifest, entries);
    return { entries, manifest };
  } catch (error) {
    if (error instanceof PublisherError) throw error;
    throw failure('PACKAGE_UNLOCK_FAILED');
  } finally { plaintext?.fill(0); }
}

function trustedMarker(source, exportedValue, endpoint) {
  const marker = source.manifest.masterSync?.supabasePublication;
  if (!marker) return null;
  if (!record(marker) || marker.version !== 1 || marker.source !== endpoint || marker.sourceSha !== exportedValue.sourceSha ||
    !Number.isSafeInteger(marker.revision) || marker.revision < 0 || source.manifest.masterSync?.supabaseRevision !== marker.revision ||
    marker.manifestDigest !== hash(canonical(withoutMarker(source.manifest))) || marker.assetDigest !== assetDigest(source.entries)) throw failure('EXTERNAL_PACKAGE_CHANGE');
  return marker;
}

function sameReservation(candidate, meta, kind = 'publication') {
  return candidate?.kind === kind && candidate?.candidateId === meta.candidateId && candidate?.expectedGeneration === meta.expectedGeneration &&
    candidate?.storageRevision === meta.storageRevision && candidate?.sourceSha === meta.sourceSha &&
    candidate?.manifestSha256 === meta.manifestSha256 && candidate?.ownerImagesCommit === meta.ownerImagesCommit &&
    candidate?.sha256 === meta.sha256 && candidate?.bytes === meta.bytes && candidate?.generation === meta.expectedGeneration + 1;
}

// Called only after seedArchive's fixed URL/hash/size verification in the CLI
// path. Keeping native marker/trusted-revision staging separate lets synthetic
// local tests prove the successful historical seed flow without a live fetch.
export async function stageVerifiedSeedArchive({ target, source, delivery, packageKey, endpoint }) {
  const acceptedRevision = revisionOf(target?.storageRevision ?? target?.revision);
  const publishedRevision = revisionOf(target?.publishedRevision ?? target?.publication?.publishedRevision);
  if (publishedRevision > acceptedRevision || !SHA.test(target?.sourceSha || '') ||
    !(source?.bytes instanceof Uint8Array) || source.bytes.length < 36 || source.bytes.length > codec.MAX_PACKAGE_BYTES ||
    source.sha !== blobSha(source.bytes) || !codec.isEncrypted(source.bytes)) throw failure('SEED_IDENTITY_MISMATCH');
  let unlocked;
  try {
    unlocked = await unpack(source.bytes, packageKey);
    const marker = trustedMarker(unlocked, target, endpoint);
    if (!marker || marker.revision !== publishedRevision || unlocked.manifest.masterSync?.supabaseRevision !== publishedRevision ||
      target.publication?.githubSha && target.publication.githubSha !== source.sha) throw failure('SEED_IDENTITY_MISMATCH');
    const metadata = { candidateId: randomUUID(), expectedGeneration: 0, storageRevision: publishedRevision,
      sourceSha: target.sourceSha, manifestSha256: null, ownerImagesCommit: null, sha256: hash(source.bytes), bytes: source.bytes.length,
      trustedGithubSha: source.sha };
    let reserved;
    try { reserved = await delivery.seed(metadata); }
    catch (error) {
      const latest = await delivery.readCurrent().catch(() => null);
      if (!sameReservation(latest?.queued, metadata, 'seed')) throw error;
      reserved = { status: 'existing', candidate: latest.queued };
    }
    if (!sameReservation(reserved?.candidate, metadata, 'seed')) throw failure('SEED_RESERVATION_MISMATCH');
    if (reserved.candidate.status === 'ready') return { status: 'pending', revision: publishedRevision, candidateId: reserved.candidate.candidateId };
    if (reserved.candidate.status !== 'reserved') throw failure('SEED_RESERVATION_MISMATCH');
    // This invocation still holds the exact bytes after a lost reserve reply.
    try { await delivery.upload(reserved.candidate, source.bytes); }
    catch {
      try {
        const recovered = await delivery.finalize(reserved.candidate);
        if (recovered?.status === 'ready') return { status: 'pending', revision: publishedRevision, candidateId: reserved.candidate.candidateId };
      } catch {}
      throw failure('PACKAGE_UPLOAD_UNSETTLED');
    }
    const ready = await delivery.finalize(reserved.candidate);
    if (ready?.status !== 'ready') throw failure('SEED_FINALIZE_FAILED');
    return { status: 'pending', revision: publishedRevision, candidateId: reserved.candidate.candidateId };
  } finally { for (const bytes of unlocked?.entries.values() || []) bytes.fill(0); source?.bytes?.fill(0); }
}

/** The bridge credential is only for private export/bootstrap/receipts. It is
 * never a Supabase administrative API key and never leaves the bridge origin. */
async function readCheckoutPackage(metadata) {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data/master_ppc.pkg');
  let handle;
  try {
    handle = await open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== metadata.size || stat.size > codec.MAX_PACKAGE_BYTES) return null;
    const bytes = new Uint8Array(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) { bytes.fill(0); return null; }
      offset += bytesRead;
    }
    return bytes;
  } catch { return null; }
  finally { await handle?.close(); }
}

export function createSupabasePublisher(options = {}) {
  const endpoint = normalizePublisherEndpoint(options.endpoint);
  const { publisherSecret, githubToken } = options;
  const publicationMode = options.publicationMode || 'github';
  if (!['github', 'sharepoint'].includes(publicationMode)) throw failure('INVALID_CONFIGURATION');
  let packageKey;
  try { packageKey = codec.normalizeKey(options.packageKey); } catch { throw failure('INVALID_CONFIGURATION'); }
  for (const [value, minimum] of [[publisherSecret, 32], ...((publicationMode === 'github' || options.imagesCommit) ? [[githubToken, 24]] : [])]) if (typeof value !== 'string' || value.length < minimum || value.length > 512 || /[\s\u0000-\u001f\u007f]/.test(value)) throw failure('INVALID_CONFIGURATION');
  const owner = options.owner || 'monocraft', repo = options.repo || 'PPC', branch = options.branch || 'main';
  const imagesCommit = options.imagesCommit || '';
  if (imagesCommit && !SHA.test(imagesCommit)) throw failure('OWNER_IMAGES_COMMIT_INVALID');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || !/^[A-Za-z0-9_./-]{1,200}$/.test(branch) || branch.includes('..')) throw failure('INVALID_CONFIGURATION');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const repository = `https://api.github.com/repos/${owner}/${repo}`;
  const timeoutMs = options.timeoutMs ?? 120000;
  const maxAttempts = options.maxAttempts ?? 4;
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw failure('INVALID_CONFIGURATION');
  const writePackage = publicationMode === 'github' ? (options.writePackage || createGitPackageWriter({owner, repo, branch, githubToken, timeoutMs})) : null;
  if (publicationMode === 'github' && typeof writePackage !== 'function') throw failure('INVALID_CONFIGURATION');
  const delivery = publicationMode === 'sharepoint' ? (options.deliveryClient || createPackageDeliveryClient({
    endpoint: endpoint.replace('/ppc-master/api/master', '/ppc-package/api/package'), publisherSecret, fetchImpl, timeoutMs })) : null;
  if (delivery && ['readCurrent', 'reserve', 'upload', 'finalize', 'seed'].some(name => typeof delivery[name] !== 'function')) throw failure('INVALID_CONFIGURATION');

  async function call(url, request, maximum = MAX_JSON_BYTES) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', ...request, signal: controller.signal });
      const bytes = await readBytes(response, maximum);
      return { response, bytes };
    } catch (error) {
      if (error instanceof PublisherError) throw error;
      // Do not echo upstream errors, URLs, response bodies, or authorization.
      throw failure(controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'CONNECTION_FAILED');
    } finally { clearTimeout(timer); }
  }

  async function bridge(operation, payload = {}) {
    const { response, bytes } = await call(`${endpoint}/${operation}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-PPC-Publisher-Secret': publisherSecret }, body: JSON.stringify(payload) });
    if (!response.ok) throw failure(operation === 'ack' ? 'ACK_FAILED' : operation === 'bootstrap' ? 'BOOTSTRAP_REJECTED' : 'BRIDGE_UNAVAILABLE');
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw failure('INVALID_EXPORT'); }
  }

  async function github(operation, payload) {
    if (!['blob', 'read', 'read-ref', 'deploy'].includes(operation)) throw failure('INVALID_CONFIGURATION');
    const headers = { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (operation === 'blob') {
      headers.Accept = 'application/vnd.github.raw+json';
      const result = await call(`${repository}/git/blobs/${payload}`, { method: 'GET', headers }, codec.MAX_PACKAGE_BYTES);
      if (!result.response.ok) throw failure('GITHUB_READ_FAILED');
      return result.bytes;
    }
    const reading = operation === 'read' || operation === 'read-ref';
    const url = operation === 'deploy' ? `${repository}/actions/workflows/deploy.yml/dispatches`
      : `${repository}/contents/${PACKAGE_PATH}${reading ? `?ref=${encodeURIComponent(operation === 'read-ref' ? payload : branch)}` : ''}`;
    if (!reading) headers['Content-Type'] = 'application/json';
    const result = await call(url, { method: reading ? 'GET' : 'POST', headers,
      ...(!reading && payload ? { body: JSON.stringify(payload) } : {}) });
    if (operation === 'deploy') {
      if (result.response.status !== 204) throw failure('DEPLOY_DISPATCH_FAILED');
      return null;
    }
    if (!result.response.ok) throw failure(reading ? 'GITHUB_READ_FAILED' : 'GITHUB_WRITE_FAILED');
    try { return JSON.parse(new TextDecoder().decode(result.bytes)); } catch { throw failure('GITHUB_RESPONSE_INVALID'); }
  }

  async function currentPackage(ref) {
    const metadata = await github(ref ? 'read-ref' : 'read', ref);
    if (metadata.type !== 'file' || !SHA.test(metadata.sha || '') || !Number.isSafeInteger(metadata.size) || metadata.size < 36 || metadata.size > codec.MAX_PACKAGE_BYTES) throw failure('GITHUB_PACKAGE_INVALID');
    let cached;
    try { if (!ref) cached = await (options.readCachedPackage || readCheckoutPackage)(metadata); } catch {}
    let bytes;
    if (cached instanceof Uint8Array && cached.length === metadata.size && blobSha(cached) === metadata.sha && codec.isEncrypted(cached)) bytes = cached;
    else { cached?.fill?.(0); bytes = await github('blob', metadata.sha); }
    // Cache reuse never skips authenticated decryption, revision/manifest checks,
    // or preservation of every archived asset in the publication flow.
    if (bytes.length !== metadata.size || blobSha(bytes) !== metadata.sha || !codec.isEncrypted(bytes)) throw failure('GITHUB_PACKAGE_INVALID');
    return { sha: metadata.sha, bytes };
  }

  async function signedArchive(candidate, downloadUrl) {
    if (!candidate || !SHA256.test(candidate.sha256 || '') || !Number.isSafeInteger(candidate.bytes) || candidate.bytes < 36 ||
      candidate.bytes > codec.MAX_PACKAGE_BYTES || typeof candidate.candidateId !== 'string' ||
      candidate.objectKey !== `packages/${candidate.candidateId}.pkg`) throw failure('DELIVERY_CURRENT_INVALID');
    let url;
    try { url = new URL(downloadUrl); } catch { throw failure('DELIVERY_CURRENT_INVALID'); }
    const origin = new URL(endpoint).origin;
    if (url.origin !== origin || url.username || url.password || url.hash ||
      url.pathname !== `/storage/v1/object/sign/ppc-package-delivery/${candidate.objectKey}` ||
      url.searchParams.getAll('token').length !== 1 || !url.searchParams.get('token')) throw failure('DELIVERY_CURRENT_INVALID');
    const { response, bytes } = await call(url.href, { method: 'GET', headers: { Accept: 'application/octet-stream' } }, candidate.bytes);
    if (!response.ok || bytes.length !== candidate.bytes || hash(bytes) !== candidate.sha256 || !codec.isEncrypted(bytes)) {
      bytes.fill(0); throw failure('DELIVERY_CURRENT_INVALID');
    }
    return { bytes, sha: blobSha(bytes) };
  }

  async function seedArchive() {
    if (!SHA256.test(SEED_SHA256) || SEED_SHA256.length !== 64) throw failure('SEED_PIN_INVALID');
    const { response, bytes } = await call(SEED_URL, { method: 'GET', headers: { Accept: 'application/octet-stream' } }, SEED_BYTES);
    if (!response.ok || bytes.length !== SEED_BYTES || hash(bytes) !== SEED_SHA256 || !codec.isEncrypted(bytes)) {
      bytes.fill(0); throw failure('SEED_BYTES_MISMATCH');
    }
    return { bytes, sha: blobSha(bytes) };
  }

  async function exported() {
    const value = await bridge('export');
    const revision = revisionOf(value.storageRevision ?? value.revision);
    if (!record(value.manifest) || !SHA.test(value.sourceSha || '') || !record(value.publication)) throw failure('INVALID_EXPORT');
    const publishedRevision = revisionOf(value.publication.publishedRevision ?? 0);
    if (publishedRevision > revision) throw failure('INVALID_EXPORT');
    if (value.publication.githubSha && !SHA.test(value.publication.githubSha)) throw failure('INVALID_EXPORT');
    if (publicationMode === 'sharepoint' && !SHA256.test(value.acceptedManifestSha256 || '')) throw failure('INVALID_EXPORT');
    return { ...value, revision, publishedRevision };
  }

  async function notifyFailure(error, revision) {
    try { await bridge('failure', { ...(Number.isSafeInteger(revision) ? { storageRevision: revision } : {}),
      code: error instanceof PublisherError ? error.code : 'PUBLICATION_FAILED',
      message: publicationMode === 'sharepoint' ? 'The SharePoint package has not caught up yet. Accepted changes are safe; publication will retry.' : 'The GitHub package has not caught up yet. Accepted changes are safe; publication will retry.' }); } catch {}
  }

  async function acknowledge(revision, githubSha) {
    await bridge('ack', { storageRevision: revision, githubSha });
  }

  async function bootstrap() {
    if (publicationMode !== 'github') throw failure('BOOTSTRAP_LEGACY_ONLY');
    const source = await currentPackage();
    const unlocked = await unpack(source.bytes, packageKey);
    try { return await bridge('bootstrap', { manifest: unlocked.manifest, sourceSha: source.sha }); }
    finally { for (const bytes of unlocked.entries.values()) bytes.fill(0); source.bytes.fill(0); }
  }

  async function seedDeliveryCache() {
    if (publicationMode !== 'sharepoint' || imagesCommit) throw failure('SEED_MODE_INVALID');
    const target = await exported();
    const state = await delivery.readCurrent();
    if (state.phase !== 'seeding' || state.current) throw failure('SEED_PHASE_INVALID');
    if (state.queued) {
      const queued = state.queued;
      if (queued.kind !== 'seed' || queued.expectedGeneration !== 0 || queued.storageRevision !== target.publishedRevision ||
        queued.sourceSha !== target.sourceSha || queued.manifestSha256 !== null || queued.ownerImagesCommit !== null ||
        queued.sha256 !== SEED_SHA256 || queued.bytes !== SEED_BYTES) throw failure('SEED_RESERVATION_MISMATCH');
      if (queued.status === 'ready') return { status: 'pending', revision: queued.storageRevision, candidateId: queued.candidateId };
      if (queued.status === 'reserved') {
        try {
          const recovered = await delivery.finalize(queued);
          if (recovered?.status === 'ready') return { status: 'pending', revision: queued.storageRevision, candidateId: queued.candidateId };
        } catch {}
      }
      throw failure('PACKAGE_UPLOAD_UNSETTLED');
    }
    const source = await seedArchive();
    return stageVerifiedSeedArchive({ target, source, delivery, packageKey, endpoint });
  }

  function queuedInputMatches(candidate, target) {
    return candidate.kind === 'publication' && candidate.sourceSha === target.sourceSha && candidate.storageRevision === target.revision &&
      candidate.manifestSha256 === target.acceptedManifestSha256 && candidate.ownerImagesCommit === (imagesCommit || null);
  }

  async function publish() {
    let desiredRevision;
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const target = await exported(); desiredRevision = target.revision;
        let deliveryState;
        if (publicationMode === 'sharepoint') {
          deliveryState = await delivery.readCurrent();
          if (!['seeding', 'sharepoint'].includes(deliveryState?.phase)) throw failure('DELIVERY_PHASE_INVALID');
          if (!deliveryState.current) throw failure(deliveryState.phase === 'seeding' ? 'SEED_REQUIRED' : 'DELIVERY_CURRENT_MISSING');
          if (deliveryState.queued) {
            if (!queuedInputMatches(deliveryState.queued, target)) throw failure('PACKAGE_QUEUED_OTHER_INPUT');
            if (deliveryState.queued.status === 'ready') return { status: 'pending', revision: deliveryState.queued.storageRevision, candidateId: deliveryState.queued.candidateId };
            if (deliveryState.queued.status !== 'reserved') throw failure('PACKAGE_QUEUED_OTHER_INPUT');
            try {
              const recovered = await delivery.finalize(deliveryState.queued);
              if (recovered?.status === 'ready') return { status: 'pending', revision: deliveryState.queued.storageRevision, candidateId: deliveryState.queued.candidateId };
            } catch {}
            throw failure('PACKAGE_UPLOAD_UNSETTLED');
          }
        }
        const current = publicationMode === 'sharepoint' ? await signedArchive(deliveryState.current, deliveryState.downloadUrl) : await currentPackage();
        const source = await unpack(current.bytes, packageKey);
        let ownerPackage, ownerUnlocked, projected;
        try {
          const marker = trustedMarker(source, target, endpoint);
          let input;
          if (imagesCommit) {
            if (target.revision < 1) throw failure('OWNER_IMAGES_REQUIRE_INITIALIZED');
            ownerPackage = await currentPackage(imagesCommit);
            ownerUnlocked = await unpack(ownerPackage.bytes, packageKey);
            try { input = { descriptor: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(ownerUnlocked.entries.get('owner-image-input.json'))), manifest: ownerUnlocked.manifest, entries: ownerUnlocked.entries }; }
            catch { throw failure('OWNER_IMAGES_INPUT_MISSING'); }
          }
          projected = projectOwnerImages(preparedManifest(target.manifest, target.revision), source.manifest, source.entries,
            { input, commit: imagesCommit, blobSha: ownerPackage?.sha, sourceSha: target.sourceSha });
          const expected = projected.manifest;
          validateManifest(expected, projected.entries);
          const expectedDigest = hash(canonical(expected));
          if (marker && marker.revision > target.revision) {
            // An overlapping publisher may have advanced while this export was read.
            // Read a fresh consistent snapshot; never write an older package.
            continue;
          }
          if (marker?.revision === target.revision && !projected.changedInput) {
            if (marker.manifestDigest !== expectedDigest) throw failure('REVISION_CONTENT_MISMATCH');
            if (publicationMode === 'sharepoint') {
              if (deliveryState.current.kind === 'publication' && target.publishedRevision === target.revision &&
                (!imagesCommit || deliveryState.current.ownerImagesCommit === imagesCommit))
                return { status: 'unchanged', revision: target.revision, candidateId: deliveryState.current.candidateId };
              // A seed receipt never opens the Archive gate. Stage an ordinary
              // generation even when its projected manifest is byte-identical.
            } else {
            if (target.publishedRevision === target.revision && target.publication.githubSha === current.sha && ['current', 'published'].includes(target.publication.status)) return { status: 'unchanged', revision: target.revision, githubSha: current.sha };
            // Covers push acceptance with a lost response, failed deploy dispatch,
            // and a failed acknowledgement. No second encrypted package is written.
            await github('deploy', { ref: branch });
            await acknowledge(target.revision, current.sha);
            return { status: 'recovered', revision: target.revision, githubSha: current.sha };
            }
          }
          const acknowledgedSha = target.publication.githubSha || target.sourceSha;
          if (!marker && (publicationMode === 'sharepoint' || current.sha !== acknowledgedSha)) throw failure('EXTERNAL_PACKAGE_CHANGE');
          if (!marker && target.publishedRevision > 0) throw failure('EXTERNAL_PACKAGE_CHANGE');
          // Revision zero is already in the original GitHub package. Do not add a
          // publication-only commit until an actual accepted save needs an export.
          if (publicationMode === 'github' && !marker && target.revision === 0) {
            if (hash(canonical(withoutMarker(source.manifest))) !== hash(canonical(withoutMarker(target.manifest)))) throw failure('REVISION_CONTENT_MISMATCH');
            await acknowledge(0, current.sha);
            return { status: 'unchanged', revision: 0, githubSha: current.sha };
          }
          const nextManifest = expected;
          nextManifest.masterSync.supabasePublication = { version: 1, source: endpoint, sourceSha: target.sourceSha,
            revision: target.revision, manifestDigest: expectedDigest, assetDigest: assetDigest(projected.entries) };
          const manifestBytes = new TextEncoder().encode(JSON.stringify(nextManifest));
          if (manifestBytes.length > 8 * 1024 * 1024) throw failure('MASTER_TOO_LARGE');
          let plaintext, encrypted;
          try {
            plaintext = codec.createZip([...projected.entries].map(([name, bytes]) => ({ name, data: name === 'portfolio.json' ? manifestBytes : bytes })));
            encrypted = await codec.encrypt(plaintext, packageKey);
          } finally { plaintext?.fill(0); manifestBytes.fill(0); }
          const proposedSha = blobSha(encrypted);
          try {
            if (publicationMode === 'sharepoint') {
              const metadata = { candidateId: randomUUID(), expectedGeneration: deliveryState.current.generation,
                storageRevision: target.revision, sourceSha: target.sourceSha, manifestSha256: target.acceptedManifestSha256,
                ownerImagesCommit: imagesCommit || null, sha256: hash(encrypted), bytes: encrypted.length };
              let reserved;
              try { reserved = await delivery.reserve(metadata); }
              catch (error) {
                // A lost reserve reply is reconciled only to the exact bytes still
                // held in memory. Another queued input or digest remains pending.
                const state = await delivery.readCurrent().catch(() => null);
                if (!sameReservation(state?.queued, metadata)) throw error;
                reserved = { status: 'existing', candidate: state.queued };
              }
              if (!sameReservation(reserved?.candidate, metadata)) throw failure('PACKAGE_RESERVATION_MISMATCH');
              if (reserved.candidate.status === 'ready') return { status: 'pending', revision: target.revision, candidateId: reserved.candidate.candidateId };
              if (reserved.candidate.status !== 'reserved') throw failure('PACKAGE_RESERVATION_MISMATCH');
              // A lost reserve reply is recoverable while this exact encrypted
              // buffer is still held. A restarted process sees queued first.
              try { await delivery.upload(reserved.candidate, encrypted); }
              catch {
                // Upload may have completed despite a lost reply. Finalize reads
                // and hashes the exact stored object; failure holds this slot.
                try {
                  const recovered = await delivery.finalize(reserved.candidate);
                  if (recovered?.status === 'ready') return { status: 'pending', revision: target.revision, candidateId: reserved.candidate.candidateId };
                } catch {}
                throw failure('PACKAGE_UPLOAD_UNSETTLED');
              }
              const ready = await delivery.finalize(reserved.candidate);
              if (ready?.status !== 'ready') throw failure('PACKAGE_FINALIZE_FAILED');
              return { status: 'pending', revision: target.revision, candidateId: reserved.candidate.candidateId };
            }
            let accepted;
            try { accepted = await writePackage(encrypted, current.sha, target.revision); }
            catch (error) {
              if (!['CONNECTION_FAILED', 'REQUEST_TIMEOUT', 'GITHUB_RESPONSE_INVALID'].includes(error.code) &&
                error.code !== 'GIT_PUSH_RESPONSE_UNCERTAIN') throw error;
              const confirmed = await currentPackage();
              const matches = confirmed.sha === proposedSha; confirmed.bytes.fill(0);
              if (!matches) continue;
              accepted = { content: { sha: proposedSha } };
            }
            if (accepted.retry) continue;
            if (accepted.content?.sha !== proposedSha) {
              const confirmed = await currentPackage();
              const matches = confirmed.sha === proposedSha; confirmed.bytes.fill(0);
              if (!matches) continue;
            }
            await github('deploy', { ref: branch });
            await acknowledge(target.revision, proposedSha);
            return { status: 'published', revision: target.revision, githubSha: proposedSha };
          } finally { encrypted.fill(0); }
        } finally {
          for (const bytes of projected?.entries?.values() || []) bytes.fill(0);
          for (const bytes of ownerUnlocked?.entries?.values() || []) bytes.fill(0);
          ownerPackage?.bytes?.fill(0);
          for (const bytes of source.entries.values()) bytes.fill(0); current.bytes.fill(0);
        }
      }
      throw failure('PACKAGE_CHANGED_RETRY');
    } catch (error) {
      const safe = error instanceof PublisherError ? error : failure(error instanceof PackageDeliveryClientError || /^(OWNER|GIT)_[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'PUBLICATION_FAILED');
      await notifyFailure(safe, desiredRevision);
      throw safe;
    }
  }
  return Object.freeze({ bootstrap, publish, seedDeliveryCache });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const publisher = createSupabasePublisher({ endpoint: process.env.PPC_MASTER_ENDPOINT,
      publisherSecret: process.env.PPC_PUBLISHER_SECRET, packageKey: process.env.PPC_PACKAGE_KEY,
      githubToken: process.env.GITHUB_TOKEN, owner: process.env.PPC_GITHUB_OWNER, repo: process.env.PPC_GITHUB_REPO,
      branch: process.env.PPC_GITHUB_BRANCH, imagesCommit: process.env.PPC_IMAGES_COMMIT,
      publicationMode: process.env.PPC_PACKAGE_PUBLICATION_MODE || 'github' });
    if (process.argv.includes('--bootstrap') && process.env.PPC_IMAGES_COMMIT) throw failure('OWNER_IMAGES_WITH_BOOTSTRAP');
    if (process.argv.includes('--seed-delivery-cache') && process.argv.includes('--bootstrap')) throw failure('SEED_MODE_INVALID');
    const result = process.argv.includes('--seed-delivery-cache') ? await publisher.seedDeliveryCache() : process.argv.includes('--bootstrap') ? await publisher.bootstrap() : await publisher.publish();
    console.log(process.argv.includes('--bootstrap') ? 'Shared master initialized or its existing seed verified.'
      : `Encrypted master publication ${result.status}; revision ${result.revision}.`);
  } catch (error) {
    const code = error instanceof PublisherError ? error.code : 'PUBLICATION_FAILED';
    console.error(`Encrypted master publication needs attention (${code}). No credentials or private product data were logged.`);
    process.exitCode = 1;
  }
}
