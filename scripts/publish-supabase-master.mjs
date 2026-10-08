import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../public/js/package-codec.js';
import '../public/js/master-model.js';

const codec = globalThis.PortfolioPackage;
const model = globalThis.PortfolioMasterModel;
const PACKAGE_PATH = 'public/data/master_ppc.pkg';
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/;
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
  constructor(code, message = 'The encrypted GitHub master could not be published. Accepted team changes remain in the shared master.') {
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
    if (!data || data.length > 4 * 1024 * 1024) throw failure('INVALID_MANIFEST');
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    validateManifest(manifest, entries);
    return { entries, manifest };
  } catch (error) {
    if (error instanceof PublisherError) throw error;
    throw failure('PACKAGE_UNLOCK_FAILED');
  } finally { plaintext?.fill(0); }
}

/** The bridge credential is only for private export/bootstrap/receipts. It is
 * never a Supabase administrative API key and never leaves the bridge origin. */
export function createSupabasePublisher(options = {}) {
  const endpoint = normalizePublisherEndpoint(options.endpoint);
  const { publisherSecret, githubToken } = options;
  let packageKey;
  try { packageKey = codec.normalizeKey(options.packageKey); } catch { throw failure('INVALID_CONFIGURATION'); }
  for (const [value, minimum] of [[publisherSecret, 32], [githubToken, 24]]) if (typeof value !== 'string' || value.length < minimum || value.length > 512 || /[\s\u0000-\u001f\u007f]/.test(value)) throw failure('INVALID_CONFIGURATION');
  const owner = options.owner || 'monocraft', repo = options.repo || 'PPC', branch = options.branch || 'main';
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || !/^[A-Za-z0-9_./-]{1,200}$/.test(branch) || branch.includes('..')) throw failure('INVALID_CONFIGURATION');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const repository = `https://api.github.com/repos/${owner}/${repo}`;
  const timeoutMs = options.timeoutMs ?? 120000;
  const maxAttempts = options.maxAttempts ?? 4;
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw failure('INVALID_CONFIGURATION');

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
    const headers = { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (operation === 'blob') {
      headers.Accept = 'application/vnd.github.raw+json';
      const result = await call(`${repository}/git/blobs/${payload}`, { method: 'GET', headers }, codec.MAX_PACKAGE_BYTES);
      if (!result.response.ok) throw failure('GITHUB_READ_FAILED');
      return result.bytes;
    }
    const url = operation === 'deploy' ? `${repository}/actions/workflows/deploy.yml/dispatches`
      : `${repository}/contents/${PACKAGE_PATH}${operation === 'read' ? `?ref=${encodeURIComponent(branch)}` : ''}`;
    if (operation !== 'read') headers['Content-Type'] = 'application/json';
    const result = await call(url, { method: operation === 'read' ? 'GET' : operation === 'deploy' ? 'POST' : 'PUT', headers,
      ...(payload ? { body: JSON.stringify(payload) } : {}) });
    if (operation === 'deploy') {
      if (result.response.status !== 204) throw failure('DEPLOY_DISPATCH_FAILED');
      return null;
    }
    if (operation === 'write' && [409, 422].includes(result.response.status)) return { retry: true, status: result.response.status };
    if (!result.response.ok) throw failure(operation === 'read' ? 'GITHUB_READ_FAILED' : 'GITHUB_WRITE_FAILED');
    try { return JSON.parse(new TextDecoder().decode(result.bytes)); } catch { throw failure('GITHUB_RESPONSE_INVALID'); }
  }

  async function currentPackage() {
    const metadata = await github('read');
    if (metadata.type !== 'file' || !SHA.test(metadata.sha || '') || !Number.isSafeInteger(metadata.size) || metadata.size < 36 || metadata.size > codec.MAX_PACKAGE_BYTES) throw failure('GITHUB_PACKAGE_INVALID');
    const bytes = await github('blob', metadata.sha);
    if (bytes.length !== metadata.size || blobSha(bytes) !== metadata.sha || !codec.isEncrypted(bytes)) throw failure('GITHUB_PACKAGE_INVALID');
    return { sha: metadata.sha, bytes };
  }

  async function exported() {
    const value = await bridge('export');
    const revision = revisionOf(value.storageRevision ?? value.revision);
    if (!record(value.manifest) || !SHA.test(value.sourceSha || '') || !record(value.publication)) throw failure('INVALID_EXPORT');
    const publishedRevision = revisionOf(value.publication.publishedRevision ?? 0);
    if (publishedRevision > revision) throw failure('INVALID_EXPORT');
    if (value.publication.githubSha && !SHA.test(value.publication.githubSha)) throw failure('INVALID_EXPORT');
    return { ...value, revision, publishedRevision };
  }

  function trustedMarker(source, exportedValue) {
    const marker = source.manifest.masterSync?.supabasePublication;
    if (!marker) return null;
    if (!record(marker) || marker.version !== 1 || marker.source !== endpoint || marker.sourceSha !== exportedValue.sourceSha ||
      !Number.isSafeInteger(marker.revision) || marker.revision < 0 || source.manifest.masterSync?.supabaseRevision !== marker.revision ||
      marker.manifestDigest !== hash(canonical(withoutMarker(source.manifest))) || marker.assetDigest !== assetDigest(source.entries)) throw failure('EXTERNAL_PACKAGE_CHANGE');
    return marker;
  }

  async function notifyFailure(error, revision) {
    try { await bridge('failure', { ...(Number.isSafeInteger(revision) ? { storageRevision: revision } : {}),
      code: error instanceof PublisherError ? error.code : 'PUBLICATION_FAILED',
      message: 'The GitHub package has not caught up yet. Accepted changes are safe; publication will retry.' }); } catch {}
  }

  async function acknowledge(revision, githubSha) {
    await bridge('ack', { storageRevision: revision, githubSha });
  }

  async function bootstrap() {
    const source = await currentPackage();
    const unlocked = await unpack(source.bytes, packageKey);
    try { return await bridge('bootstrap', { manifest: unlocked.manifest, sourceSha: source.sha }); }
    finally { for (const bytes of unlocked.entries.values()) bytes.fill(0); source.bytes.fill(0); }
  }

  async function publish() {
    let desiredRevision;
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const target = await exported(); desiredRevision = target.revision;
        const current = await currentPackage();
        const source = await unpack(current.bytes, packageKey);
        try {
          const marker = trustedMarker(source, target);
          const expected = preparedManifest(target.manifest, target.revision);
          validateManifest(expected, source.entries);
          const expectedDigest = hash(canonical(expected));
          if (marker && marker.revision > target.revision) {
            // An overlapping publisher may have advanced while this export was read.
            // Read a fresh consistent snapshot; never write an older package.
            continue;
          }
          if (marker?.revision === target.revision) {
            if (marker.manifestDigest !== expectedDigest) throw failure('REVISION_CONTENT_MISMATCH');
            if (target.publishedRevision === target.revision && target.publication.githubSha === current.sha && ['current', 'published'].includes(target.publication.status)) return { status: 'unchanged', revision: target.revision, githubSha: current.sha };
            // Covers push acceptance with a lost response, failed deploy dispatch,
            // and a failed acknowledgement. No second encrypted package is written.
            await github('deploy', { ref: branch });
            await acknowledge(target.revision, current.sha);
            return { status: 'recovered', revision: target.revision, githubSha: current.sha };
          }
          const acknowledgedSha = target.publication.githubSha || target.sourceSha;
          if (!marker && current.sha !== acknowledgedSha) throw failure('EXTERNAL_PACKAGE_CHANGE');
          if (!marker && target.publishedRevision > 0) throw failure('EXTERNAL_PACKAGE_CHANGE');
          // Revision zero is already in the original GitHub package. Do not add a
          // publication-only commit until an actual accepted save needs an export.
          if (!marker && target.revision === 0) {
            if (hash(canonical(withoutMarker(source.manifest))) !== hash(canonical(withoutMarker(target.manifest)))) throw failure('REVISION_CONTENT_MISMATCH');
            await acknowledge(0, current.sha);
            return { status: 'unchanged', revision: 0, githubSha: current.sha };
          }
          const nextManifest = expected;
          nextManifest.masterSync.supabasePublication = { version: 1, source: endpoint, sourceSha: target.sourceSha,
            revision: target.revision, manifestDigest: expectedDigest, assetDigest: assetDigest(source.entries) };
          const manifestBytes = new TextEncoder().encode(JSON.stringify(nextManifest));
          if (manifestBytes.length > 4 * 1024 * 1024) throw failure('MASTER_TOO_LARGE');
          let plaintext, encrypted;
          try {
            plaintext = codec.createZip([...source.entries].map(([name, bytes]) => ({ name, data: name === 'portfolio.json' ? manifestBytes : bytes })));
            encrypted = await codec.encrypt(plaintext, packageKey);
          } finally { plaintext?.fill(0); manifestBytes.fill(0); }
          const proposedSha = blobSha(encrypted);
          try {
            // Contents API compares the package blob only, preserving unrelated
            // main-branch code commits while refusing concurrent package changes.
            let accepted;
            try { accepted = await github('write', { message: `Publish PPC master revision ${target.revision}`, branch,
              sha: current.sha, content: Buffer.from(encrypted).toString('base64') }); }
            catch (error) {
              if (!['CONNECTION_FAILED', 'REQUEST_TIMEOUT', 'GITHUB_RESPONSE_INVALID'].includes(error.code)) throw error;
              const confirmed = await currentPackage();
              const matches = confirmed.sha === proposedSha; confirmed.bytes.fill(0);
              if (!matches) continue;
              accepted = { content: { sha: proposedSha } };
            }
            if (accepted.retry) {
              if (accepted.status === 422) {
                const confirmed = await currentPackage();
                const unchanged = confirmed.sha === current.sha; confirmed.bytes.fill(0);
                if (unchanged) throw failure('GITHUB_WRITE_REJECTED');
              }
              continue;
            }
            if (accepted.content?.sha !== proposedSha) {
              const confirmed = await currentPackage();
              const matches = confirmed.sha === proposedSha; confirmed.bytes.fill(0);
              if (!matches) continue;
            }
            await github('deploy', { ref: branch });
            await acknowledge(target.revision, proposedSha);
            return { status: 'published', revision: target.revision, githubSha: proposedSha };
          } finally { encrypted.fill(0); }
        } finally { for (const bytes of source.entries.values()) bytes.fill(0); current.bytes.fill(0); }
      }
      throw failure('PACKAGE_CHANGED_RETRY');
    } catch (error) {
      await notifyFailure(error, desiredRevision);
      throw error instanceof PublisherError ? error : failure('PUBLICATION_FAILED');
    }
  }
  return Object.freeze({ bootstrap, publish });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const publisher = createSupabasePublisher({ endpoint: process.env.PPC_MASTER_ENDPOINT,
      publisherSecret: process.env.PPC_PUBLISHER_SECRET, packageKey: process.env.PPC_PACKAGE_KEY,
      githubToken: process.env.GITHUB_TOKEN, owner: process.env.PPC_GITHUB_OWNER, repo: process.env.PPC_GITHUB_REPO,
      branch: process.env.PPC_GITHUB_BRANCH });
    const result = process.argv.includes('--bootstrap') ? await publisher.bootstrap() : await publisher.publish();
    console.log(process.argv.includes('--bootstrap') ? 'Shared master initialized or its existing seed verified.'
      : `GitHub master publication ${result.status}; revision ${result.revision}.`);
  } catch (error) {
    const code = error instanceof PublisherError ? error.code : 'PUBLICATION_FAILED';
    console.error(`GitHub master publication needs attention (${code}). No credentials or private product data were logged.`);
    process.exitCode = 1;
  }
}
