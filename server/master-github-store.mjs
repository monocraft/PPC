import { createHash, timingSafeEqual, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import '../public/js/package-codec.js';
import '../public/js/portfolio-model.js';
import '../public/js/master-model.js';

const codec = globalThis.PortfolioPackage;
const model = globalThis.PortfolioMasterModel;
const transportScript = new Script(readFileSync(new URL('../public/js/master-github.js', import.meta.url), 'utf8'), { filename: 'private-master-transport.js' });
const BLOB_PATH = /^https:\/\/api\.github\.com\/repos\/monocraft\/PPC\/git\/blobs\/([a-f0-9]{40})$/;
const MAX_BYTES = 64 * 1024 * 1024;

function backendFailure(error) {
  const allowed = new Set(['INVALID_KEY', 'INVALID_CHANGE', 'INVALID_REQUEST', 'MASTER_TOO_LARGE', 'MASTER_BUSY', 'SAVE_UNCONFIRMED']);
  if (allowed.has(error?.code)) return error;
  const unavailable = new Error(error?.code === 'GITHUB_RATE_LIMIT'
    ? 'The shared connection is busy. Your changes are safe; try saving again shortly.'
    : 'The shared connection is unavailable. Your changes are safe. The portfolio owner may need to check the connection.');
  unavailable.code = 'MASTER_UNAVAILABLE';
  unavailable.status = 503;
  if (Number.isFinite(error?.retryUntil)) unavailable.retryUntil = error.retryUntil;
  return unavailable;
}

function safeSnapshot(snapshot) {
  const { identity, recentEditors, ...remaining } = snapshot;
  return { ...remaining, source: 'service', connectionMode: 'team', backend: 'github', identity: null,
    canWrite: true, requiresEditorToken: false, requiresGitHubToken: false, namesAreSelfReported: true };
}

async function encryptedBytes(response) {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new Error('Master response exceeds its limit.');
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('Master response exceeds its limit.');
    return bytes;
  }
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > MAX_BYTES) { await reader.cancel(); throw new Error('Master response exceeds its limit.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks, length));
}

/** Central credentials live only in this server. Decrypted transport state is
 * discarded after every operation; the bounded shared cache holds ciphertext. */
export function createGitHubMasterStore(options = {}) {
  const githubToken = options.githubToken;
  if (typeof githubToken !== 'string' || githubToken.length < 24 || githubToken.length > 512 || /[\s\u0000-\u001f\u007f]/.test(githubToken)) {
    throw new Error('Configure the private GitHub master credential.');
  }
  const upstreamFetch = options.fetchImpl || globalThis.fetch;
  if (typeof upstreamFetch !== 'function') throw new Error('A server HTTP client is required.');
  // Never cache raw JSON, profiles, package keys, or decrypted manifests.
  const encryptedCache = new Map();
  let cachedBytes = 0;
  let verifier = null;
  let blockedUntil = 0;
  let activeOperations = 0;
  const waitingOperations = [];

  function busy() {
    const error = new Error('The shared master is busy. Your changes are safe; try saving again shortly.');
    error.code = 'MASTER_BUSY'; error.status = 503;
    return error;
  }
  function releaseOperation() {
    const next = waitingOperations.shift();
    if (next) { clearTimeout(next.timer); next.resolve(releaseOperation); }
    else activeOperations -= 1;
  }
  function acquireOperation() {
    if (activeOperations < 2) { activeOperations += 1; return Promise.resolve(releaseOperation); }
    if (waitingOperations.length >= 8) return Promise.reject(busy());
    return new Promise((resolve, reject) => {
      const entry = { resolve, timer: null };
      entry.timer = setTimeout(() => {
        const index = waitingOperations.indexOf(entry);
        if (index >= 0) waitingOperations.splice(index, 1);
        reject(busy());
      }, 15000);
      waitingOperations.push(entry);
    });
  }

  async function operate(key, profile, operation) {
    if (Date.now() < blockedUntil) {
      const error = backendFailure({ code: 'GITHUB_RATE_LIMIT', retryUntil: blockedUntil });
      throw error;
    }
    const release = await acquireOperation();
    try {
      if (Date.now() < blockedUntil) throw backendFailure({ code: 'GITHUB_RATE_LIMIT', retryUntil: blockedUntil });
      return await transportOperation(key, profile, operation);
    }
    finally { release(); }
  }

  function cache(sha, bytes) {
    if (encryptedCache.has(sha)) return;
    encryptedCache.set(sha, bytes);
    cachedBytes += bytes.length;
    while (encryptedCache.size > 3 || cachedBytes > MAX_BYTES * 2) {
      const oldest = encryptedCache.keys().next().value;
      cachedBytes -= encryptedCache.get(oldest).length;
      encryptedCache.delete(oldest);
    }
  }

  async function transportOperation(key, profile, operation) {
    const sessionId = profile?.sessionId || 'anonymous-reader';
    const actorId = `ppc-${createHash('sha256').update(sessionId).digest('hex').slice(0, 32)}`;
    const displayName = String(profile?.editorName || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    const actorName = displayName || `Editor ${sessionId.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase()}`;
    const localPackages = new Map();
    let currentRevision = '';
    const fetchImpl = async (url, request) => {
      // The shared account's profile is deliberately not fetched or shown.
      // This request-local identity feeds the encrypted idempotency journal.
      if (url === 'https://api.github.com/user') return new Response(JSON.stringify({ login: actorId, name: actorName }), { headers: { 'Content-Type': 'application/json' } });
      const blob = BLOB_PATH.exec(url);
      if (blob && encryptedCache.has(blob[1])) {
        const bytes = encryptedCache.get(blob[1]);
        localPackages.set(blob[1], bytes);
        currentRevision = blob[1];
        return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } });
      }
      const response = await upstreamFetch(url, request);
      if (!blob || !response.ok) return response;
      const bytes = await encryptedBytes(response);
      cache(blob[1], bytes);
      localPackages.set(blob[1], bytes);
      currentRevision = blob[1];
      return new Response(bytes, { status: response.status, headers: response.headers });
    };
    const privateModel = Object.freeze({ ...model, mergeChanges(manifest, changes, context) {
      const result = model.mergeChanges(manifest, changes, { ...context, actor: actorName, team: 'Team' });
      for (const record of result.history) record.actorSource = 'self-reported';
      return result;
    } });
    // Each context owns its transport cache and profile. It never mutates the
    // browser transport or another in-flight user's display name.
    const context = createContext({ PortfolioPackage: codec, PortfolioMasterModel: privateModel,
      crypto: webcrypto, fetch: fetchImpl, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
      AbortController, URL, setTimeout, clearTimeout, btoa: globalThis.btoa });
    transportScript.runInContext(context);
    const transport = context.PortfolioMasterGitHub.createTransport({ token: githubToken, fetchImpl,
      ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.transferTimeoutMs === undefined ? {} : { transferTimeoutMs: options.transferTimeoutMs }) });
    try {
      const result = await operation(transport, () => currentRevision, localPackages);
      if (result?.snapshot) {
        verifier = { revision: result.snapshot.revision, digest: createHash('sha256').update(key).digest() };
        result.snapshot = safeSnapshot(result.snapshot);
      }
      return result;
    } catch (error) {
      if (Number.isFinite(error?.retryUntil)) blockedUntil = Math.max(blockedUntil, error.retryUntil);
      throw backendFailure(error);
    }
    finally { transport.disconnect(); }
  }

  return Object.freeze({
    latest(key) { return operate(key, null, transport => transport.latest({ key })); },
    save(key, payload) { return operate(key, payload, transport => transport.save({ key, requestId: payload.requestId, changes: payload.changes, reason: payload.reason || '' })); },
    package(key) { return operate(key, null, async (transport, revision, localPackages) => {
      const result = await transport.latest({ key });
      const bytes = localPackages.get(result.snapshot.revision);
      if (!bytes) throw new Error('The authenticated encrypted master was not available.');
      return { ...result, bytes };
    }); },
    authorizePresence(key, productId, current) { return operate(key, null, async (transport, revision) => {
      await transport.readPackage();
      const sourceSignature = revision();
      const matches = verifier?.revision === sourceSignature && timingSafeEqual(verifier.digest, createHash('sha256').update(key).digest());
      if (matches && (!productId || (current?.productId === productId && current.sourceSignature === sourceSignature))) {
        return { sourceSignature, productName: productId ? current.productName : '', knownProduct: Boolean(productId && current.productName) };
      }
      const result = await transport.latest({ key });
      verifier = { revision: result.snapshot.revision, digest: createHash('sha256').update(key).digest() };
      const product = productId ? result.snapshot.products.find(item => item.productId === productId) : null;
      return { sourceSignature: result.snapshot.revision, productName: product?.productName || '', knownProduct: Boolean(product) };
    }); },
  });
}
