import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { open, lstat, rename, unlink, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import '../public/js/package-codec.js';
import '../public/js/portfolio-model.js';
import '../public/js/master-model.js';
import { createGitHubMasterStore } from './master-github-store.mjs';

const codec = globalThis.PortfolioPackage;
const model = globalThis.PortfolioMasterModel;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const locks = new Map();
const endpoints = new Set(['/api/master/latest', '/api/master/save', '/api/master/presence', '/api/dates/latest', '/api/dates/save', '/api/package/latest']);

class MasterError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const problem = (status, code, message) => new MasterError(status, code, message);
const unavailable = () => problem(503, 'MASTER_UNAVAILABLE', 'The shared master is temporarily unavailable. Try again shortly.');
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const signature = info => [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');

function integer(value, fallback, minimum, maximum) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error('Invalid master service numeric configuration.');
  return parsed;
}

function normalizeOrigins(values) {
  if (values === undefined) return null;
  const result = new Set();
  for (const value of Array.isArray(values) ? values : String(values).split(',')) {
    const origin = String(value).trim();
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('Invalid master service origin configuration.'); }
    if (parsed.origin !== origin || parsed.username || parsed.password ||
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)))) {
      throw new Error('Use exact HTTPS origins, or loopback HTTP origins, without a path.');
    }
    result.add(origin);
  }
  if (!result.size) throw new Error('Configure at least one master service origin.');
  return result;
}

function localRequest(request, origin) {
  if (!origin) return false;
  const peer = String(request.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (peer !== '127.0.0.1' && peer !== '::1') return false;
  try {
    const parsed = new URL(origin);
    // Exact authority matching prevents a remote page or a DNS-rebound host
    // from obtaining the local trial's implicit edit authorization.
    return parsed.origin === origin && LOCAL_HOSTS.has(parsed.hostname) &&
      ['http:', 'https:'].includes(parsed.protocol) && parsed.host === request.headers.host;
  } catch { return false; }
}

function securityHeaders(response, origin) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Vary', 'Origin');
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
}

function respond(response, status, body) {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function readBody(request, maximum) {
  return new Promise((resolveBody, rejectBody) => {
    let length = 0;
    let finished = false;
    const chunks = [];
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onError);
    };
    const fail = error => {
      if (finished) return;
      finished = true;
      cleanup();
      for (const chunk of chunks) chunk.fill(0);
      request.resume();
      rejectBody(error);
    };
    const onData = chunk => {
      length += chunk.length;
      if (length > maximum) return fail(problem(413, 'REQUEST_TOO_LARGE', 'The update is too large. Save fewer products at a time.'));
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      const joined = Buffer.concat(chunks);
      try { resolveBody(JSON.parse(joined.toString('utf8'))); }
      catch { rejectBody(problem(400, 'INVALID_REQUEST', 'The master request is invalid.')); }
      finally { joined.fill(0); for (const chunk of chunks) chunk.fill(0); }
    };
    const onError = () => fail(problem(400, 'INVALID_REQUEST', 'The master request could not be read.'));
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('aborted', onError);
    const declared = request.headers['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
      fail(problem(413, 'REQUEST_TOO_LARGE', 'The update is too large. Save fewer products at a time.'));
    }
  });
}

async function stableFile(filename, maximum) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle;
    try {
      const beforePath = await lstat(filename);
      if (!beforePath.isFile() || beforePath.isSymbolicLink() || beforePath.size < 58 || beforePath.size > maximum) throw unavailable();
      handle = await open(filename, 'r');
      const before = await handle.stat();
      if (signature(beforePath) !== signature(before)) continue;
      const chunks = [];
      let length = 0;
      for (;;) {
        const chunk = Buffer.allocUnsafe(Math.min(65536, maximum + 1 - length));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        length += bytesRead;
        if (length > maximum) throw unavailable();
        chunks.push(chunk.subarray(0, bytesRead));
      }
      const after = await handle.stat();
      const current = await lstat(filename);
      if (signature(before) !== signature(after) || signature(after) !== signature(current) || !current.isFile() || length !== current.size) continue;
      const bytes = Buffer.concat(chunks, length);
      if (!Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from('PPCPKG01'))) throw unavailable();
      return { bytes, signature: signature(current), revision: digest(bytes) };
    } finally { await handle?.close(); }
  }
  throw unavailable();
}

async function unlockPackage(filename, key, maximum) {
  const source = await stableFile(filename, maximum);
  let plaintext;
  let entries;
  let manifest;
  let unlocked = false;
  try {
    try { plaintext = await codec.decrypt(source.bytes, key); }
    catch { throw problem(401, 'INVALID_KEY', 'The package key was not accepted, or the encrypted master is damaged.'); }
    try {
      entries = codec.readZip(plaintext);
      const bytes = entries.get('portfolio.json');
      if (!bytes || bytes.length > MAX_MANIFEST_BYTES) throw unavailable();
      manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!isRecord(manifest)) throw unavailable();
      codec.normalizePackageInfo(manifest.packageInfo);
      validateStoredManifest(manifest, entries);
      model.snapshot(manifest);
    } catch { throw unavailable(); }
    unlocked = true;
    return { ...source, entries, manifest };
  } finally {
    plaintext?.fill(0);
    // The codec copies entries. Its original JSON payload is no longer needed.
    entries?.get('portfolio.json')?.fill(0);
    if (!unlocked && entries) for (const data of entries.values()) data.fill(0);
  }
}

function validateStoredManifest(manifest, entries) {
  let boards;
  if ([2, 3, 4].includes(manifest.version) && Array.isArray(manifest.categories) && manifest.categories.length && manifest.categories.length <= 1000) {
    const ids = new Set();
    boards = manifest.categories.map(category => {
      if (!isRecord(category) || typeof category.id !== 'string' || !category.id || ids.has(category.id)) throw unavailable();
      ids.add(category.id);
      return category.board;
    });
  } else if (manifest.version === 1 && Array.isArray(manifest.products) && Array.isArray(manifest.lanes)) boards = [manifest];
  else throw unavailable();
  const references = new Set();
  for (const board of boards) {
    if (!isRecord(board) || !Array.isArray(board.products) || !Array.isArray(board.lanes)) throw unavailable();
    const laneIds = new Set();
    for (const lane of board.lanes) {
      if (!isRecord(lane) || typeof lane.id !== 'string' || !lane.id || laneIds.has(lane.id)) throw unavailable();
      laneIds.add(lane.id);
    }
    for (const product of board.products) {
      if (!isRecord(product) || typeof product.name !== 'string') throw unavailable();
      if (product.imageAssetId) references.add(product.imageAssetId);
      for (const group of product.variantGroups || []) for (const item of group.items || []) if (item.imageAssetId) references.add(item.imageAssetId);
    }
  }
  if (manifest.imageAssets !== undefined && !Array.isArray(manifest.imageAssets)) throw unavailable();
  const assetIds = new Set();
  for (const asset of manifest.imageAssets || []) {
    if (!isRecord(asset) || typeof asset.id !== 'string' || !asset.id || assetIds.has(asset.id) ||
      (asset.sourceType !== undefined && !['local', 'url'].includes(asset.sourceType))) throw unavailable();
    assetIds.add(asset.id);
    if (asset.sourceType === 'url') continue;
    const extension = String(asset.fileName || asset.name || '').match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
      || ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' }[asset.mimeType] || 'img');
    const packagePath = asset.packagePath || `images/${asset.id}.${extension}`;
    if (typeof packagePath !== 'string' || !packagePath.startsWith('images/') || !entries.get(packagePath)?.length) throw unavailable();
  }
  if (manifest.version !== 1 || manifest.imageAssets !== undefined) for (const id of references) if (!assetIds.has(id)) throw unavailable();
}

async function serialized(filename, operation) {
  let entry = locks.get(filename);
  if (!entry) { entry = { count: 0, tail: Promise.resolve() }; locks.set(filename, entry); }
  if (entry.count >= 32) throw problem(503, 'MASTER_BUSY', 'The shared master is busy. Try saving again shortly.');
  const previous = entry.tail;
  let release;
  entry.tail = new Promise(resolveRelease => { release = resolveRelease; });
  entry.count += 1;
  await previous;
  try { return await operation(); }
  finally {
    entry.count -= 1;
    release();
    if (!entry.count && locks.get(filename) === entry) locks.delete(filename);
  }
}

async function acquireFileLock(filename) {
  const lockfile = `${filename}.master.lock`;
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let created = false;
    try {
      handle = await open(lockfile, 'wx', 0o600);
      created = true;
      await handle.writeFile(JSON.stringify({ version: 1, pid: process.pid, nonce: randomUUID() }));
      await handle.sync();
      break;
    } catch (error) {
      await handle?.close();
      handle = null;
      if (created) { try { await unlink(lockfile); } catch {} }
      if (error.code !== 'EEXIST') throw unavailable();
      // A terminated process can leave its private lock behind. Reclaim only
      // a regular, small lock whose PID is positively known to be absent.
      const info = await lstat(lockfile);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 512) throw unavailable();
      const stale = await open(lockfile, 'r');
      let record;
      try { record = JSON.parse(await stale.readFile('utf8')); }
      catch { throw unavailable(); }
      finally { await stale.close(); }
      if (!Number.isInteger(record.pid) || record.pid < 1) throw unavailable();
      try { process.kill(record.pid, 0); }
      catch (processError) {
        if (processError.code === 'ESRCH' && signature(await lstat(lockfile)) === signature(info)) {
          await unlink(lockfile);
          continue;
        }
      }
      throw problem(503, 'MASTER_BUSY', 'Another master update is in progress. Try saving again shortly.');
    }
  }
  if (!handle) throw unavailable();
  return async () => { await handle.close(); await unlink(lockfile); };
}

async function persistPackage(filename, source, manifest, key, maximum) {
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (manifestBytes.length > MAX_MANIFEST_BYTES) throw problem(413, 'MASTER_TOO_LARGE', 'The updated master exceeds its data limit.');
  let plaintext;
  let encrypted;
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let staged = false;
  try {
    plaintext = codec.createZip([...source.entries].map(([name, data]) => ({ name, data: name === 'portfolio.json' ? manifestBytes : data })));
    encrypted = await codec.encrypt(plaintext, key);
    if (encrypted.length > maximum) throw problem(413, 'MASTER_TOO_LARGE', 'The updated master exceeds its package limit.');
    const handle = await open(temporary, 'wx', 0o600);
    staged = true;
    try { await handle.writeFile(encrypted); await handle.sync(); }
    finally { await handle.close(); }
    // Check after encryption and disk staging, while the cooperating writer
    // lock is held. An external replacement must be re-read and merged.
    const current = await stableFile(filename, maximum);
    if (current.revision !== source.revision) return null;
    await rename(temporary, filename);
    staged = false;
    return digest(encrypted);
  } finally {
    plaintext?.fill(0);
    manifestBytes.fill(0);
    for (const data of source.entries.values()) data.fill(0);
    if (staged) { try { await unlink(temporary); } catch {} }
  }
}

/** One fixed encrypted master. No package keys or plaintext are retained. */
export function createMasterHandler(options = {}) {
  const storage = options.storage || 'file';
  if (!['file', 'github'].includes(storage)) throw new Error('Configure a supported master storage mode.');
  if (storage === 'file' && (typeof options.packageFile !== 'string' || !options.packageFile)) throw new Error('Configure the encrypted master package file.');
  const filename = storage === 'file' ? resolve(options.packageFile) : '';
  const origins = normalizeOrigins(options.allowedOrigins);
  if (storage === 'github' && !origins) throw new Error('Configure exact origins for the private shared connection.');
  const githubStore = storage === 'github' ? createGitHubMasterStore(options) : null;
  const allowLocalEdits = options.allowLocalEdits === true;
  const configuredToken = options.editorToken ?? options.writeToken ?? '';
  if (typeof configuredToken !== 'string' || (configuredToken && (configuredToken.length < 24 || configuredToken.length > 512))) {
    throw new Error('Configure a master editor token of at least 24 characters.');
  }
  const tokenDigest = configuredToken ? createHash('sha256').update(configuredToken).digest() : null;
  const maxFileBytes = integer(options.maxFileBytes, MAX_FILE_BYTES, 58, MAX_FILE_BYTES);
  const maxBodyBytes = integer(options.maxBodyBytes, 1024 * 1024, 2048, 2 * 1024 * 1024);
  const rateLimit = integer(options.rateLimit, 120, 1, 1000);
  const rateWindowMs = integer(options.rateWindowMs, 60000, 100, 3600000);
  const presenceTtlMs = integer(options.presenceTtlMs, 65000, 100, 3600000);
  const presenceMaxUsers = integer(options.presenceMaxUsers, 256, 1, 1000);
  const presenceRateLimit = integer(options.presenceRateLimit, 240, 1, 10000);
  const presenceClock = options.now || Date.now;
  if (typeof presenceClock !== 'function') throw new Error('Configure a function for the presence clock.');
  const trustedProxyIPs = new Set((options.trustedProxyIPs || []).map(value => {
    const address = String(value).replace(/^::ffff:/, '');
    if (!isIP(address)) throw new Error('Invalid trusted proxy address.');
    return address;
  }));
  const rates = new Map();
  const presenceRates = new Map();
  const presenceSessions = new Map();
  let verifiedPresenceSource = null;

  function canWrite(request, origin, token) {
    if (githubStore) return true; // A valid package key is checked before any write.
    if (allowLocalEdits && localRequest(request, origin)) return true;
    if (!tokenDigest || typeof token !== 'string' || token.length > 512) return false;
    return timingSafeEqual(tokenDigest, createHash('sha256').update(token).digest());
  }

  function acceptRate(request, presence = false) {
    const now = Date.now();
    const table = presence ? presenceRates : rates;
    if (table.size >= 10000) for (const [peer, entry] of table) if (entry.until <= now) table.delete(peer);
    let peer = String(request.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
    const forwarded = request.headers['x-forwarded-for'];
    // Only an explicitly trusted proxy may replace the single client address.
    if (trustedProxyIPs.has(peer) && typeof forwarded === 'string' && !forwarded.includes(',') && isIP(forwarded.trim())) {
      peer = forwarded.trim();
    }
    let entry = table.get(peer);
    if (!entry || entry.until <= now) {
      if (!entry && table.size >= 10000) return false;
      entry = { until: now + rateWindowMs, count: 0 };
      table.set(peer, entry);
    }
    entry.count += 1;
    return entry.count <= (presence ? presenceRateLimit : rateLimit);
  }

  function rememberPresenceAuthorization(source, key) {
    // The package key has 256 random bits. This verifier cannot unlock the
    // master, and becomes unusable as soon as the encrypted file changes.
    verifiedPresenceSource = { signature: source.signature, revision: source.revision, verifier: createHash('sha256').update(key).digest() };
  }

  async function presenceAuthorization(key, productId, current) {
    if (githubStore) {
      try { return await githubStore.authorizePresence(key, productId, current); }
      catch (error) { throw problem(error?.status || 503, error?.code || 'MASTER_UNAVAILABLE', error?.message || unavailable().message); }
    }
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 58 || info.size > maxFileBytes) throw unavailable();
    const currentSignature = signature(info);
    const matches = verifiedPresenceSource?.signature === currentSignature &&
      timingSafeEqual(verifiedPresenceSource.verifier, createHash('sha256').update(key).digest());
    if (matches && (!productId || (current?.productId === productId && current.sourceSignature === currentSignature))) {
      return { sourceSignature: currentSignature, productName: productId ? current.productName : '', knownProduct: Boolean(productId && current.productName) };
    }
    const source = await unlockPackage(filename, key, maxFileBytes);
    try {
      rememberPresenceAuthorization(source, key);
      const product = productId ? model.snapshot(source.manifest).products.find(item => item.productId === productId) : null;
      return { sourceSignature: source.signature, productName: product?.productName || '', knownProduct: Boolean(product) };
    } finally { for (const data of source.entries.values()) data.fill(0); }
  }

  async function presence(body, key) {
    if (typeof body.sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.sessionId) ||
      (body.displayName !== undefined && (typeof body.displayName !== 'string' || body.displayName.length > 60)) ||
      (body.editing !== undefined && typeof body.editing !== 'boolean') ||
      (body.leave !== undefined && typeof body.leave !== 'boolean') ||
      (body.productId !== undefined && (typeof body.productId !== 'string' || body.productId.length > 180))) {
      throw problem(400, 'INVALID_PRESENCE', 'The active viewer details are invalid.');
    }
    const now = presenceClock();
    if (!Number.isFinite(now)) throw unavailable();
    for (const [sessionId, entry] of presenceSessions) if (now - entry.touchedAt >= presenceTtlMs) presenceSessions.delete(sessionId);
    const current = presenceSessions.get(body.sessionId);
    const productId = body.editing === true ? body.productId || '' : '';
    const authorized = await presenceAuthorization(key, productId, current);
    if (body.leave) presenceSessions.delete(body.sessionId);
    else {
      if (!current && presenceSessions.size >= presenceMaxUsers) throw problem(429, 'PRESENCE_FULL', 'The active viewer list is full. Try again shortly.');
      presenceSessions.set(body.sessionId, {
        sessionId: body.sessionId,
        displayName: body.displayName === undefined ? current?.displayName || '' : body.displayName.replace(/[\u0000-\u001f\u007f]/g, '').trim(),
        editing: body.editing === true && authorized.knownProduct,
        productId: authorized.knownProduct ? productId : '',
        productName: authorized.productName,
        sourceSignature: authorized.sourceSignature,
        touchedAt: now,
      });
    }
    const users = [...presenceSessions.values()].map(entry => ({
      sessionId: entry.sessionId, displayName: entry.displayName, editing: entry.editing,
      ...(entry.productId ? { productId: entry.productId, productName: entry.productName } : {}),
      lastSeen: new Date(entry.touchedAt).toISOString(), lastSeenAt: new Date(entry.touchedAt).toISOString(),
    }));
    return { users, sessions: users, onlineCount: users.length, ttlSeconds: presenceTtlMs / 1000 };
  }

  function snapshot(source, writable, requiresEditorToken) {
    return {
      ...model.snapshot(source.manifest),
      revision: source.revision,
      packageInfo: codec.normalizePackageInfo(source.manifest.packageInfo),
      masterSync: isRecord(source.manifest.masterSync) ? JSON.parse(JSON.stringify(source.manifest.masterSync)) : null,
      canWrite: writable,
      requiresEditorToken,
    };
  }

  return async function handleMaster(request, response) {
    if (!endpoints.has(request.url) && request.url !== '/api/master/health' && request.url !== '/healthz') return false;
    const requestedOrigin = request.headers.origin;
    const local = typeof requestedOrigin === 'string' && localRequest(request, requestedOrigin);
    const allowedOrigin = typeof requestedOrigin === 'string' && (origins ? origins.has(requestedOrigin) : local) ? requestedOrigin : '';
    securityHeaders(response, allowedOrigin);
    let body;
    let key = '';
    try {
      if (requestedOrigin !== undefined && !allowedOrigin) throw problem(403, 'ORIGIN_NOT_ALLOWED', 'This page is not allowed to use the shared master.');
      if (['/api/master/health', '/healthz'].includes(request.url) && request.method === 'GET') { respond(response, 200, { status: 'ok' }); return true; }
      if (request.method === 'OPTIONS') {
        const headers = String(request.headers['access-control-request-headers'] || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
        if (!allowedOrigin || request.headers['access-control-request-method'] !== 'POST' || headers.some(value => value !== 'content-type')) {
          throw problem(403, 'ORIGIN_NOT_ALLOWED', 'This page is not allowed to use the shared master.');
        }
        response.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
        response.end();
        return true;
      }
      if (request.method !== 'POST') throw problem(405, 'METHOD_NOT_ALLOWED', 'Use a POST request for the shared master.');
      const isPresence = request.url === '/api/master/presence';
      if (!acceptRate(request, isPresence)) {
        response.setHeader('Retry-After', String(Math.ceil(rateWindowMs / 1000)));
        throw problem(429, 'RATE_LIMITED', 'Too many master requests. Try again shortly.');
      }
      if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''))) throw problem(415, 'INVALID_REQUEST', 'Use a JSON request for the shared master.');
      body = await readBody(request, isPresence ? Math.min(maxBodyBytes, 4096) : maxBodyBytes);
      const save = request.url.endsWith('/save');
      const allowed = isPresence ? ['key', 'editorToken', 'sessionId', 'displayName', 'editing', 'productId', 'leave']
        : save ? ['key', 'editorToken', 'requestId', 'changes', 'actor', 'team', 'reason', 'sessionId', 'editorName'] : ['key', 'editorToken'];
      if (!isRecord(body) || Object.keys(body).some(name => !allowed.includes(name)) || typeof body.key !== 'string' ||
        (body.editorToken !== undefined && typeof body.editorToken !== 'string')) throw problem(400, 'INVALID_REQUEST', 'The master request is invalid.');
      try { key = codec.normalizeKey(body.key); }
      catch { throw problem(401, 'INVALID_KEY', 'The package key was not accepted.'); }
      body.key = '';
      if (isPresence) {
        const result = await presence(body, key);
        respond(response, 200, result);
        return true;
      }
      const writable = canWrite(request, allowedOrigin, body.editorToken);
      const requiresEditorToken = !githubStore && !(allowLocalEdits && local);
      body.editorToken = '';
      if (save) {
        if (!writable) throw tokenDigest ? problem(403, 'EDITOR_KEY_REQUIRED', 'Enter the team edit key to save updates to the master.')
          : problem(403, 'WRITES_DISABLED', 'Master updates have not been enabled for this service.');
        if (!Array.isArray(body.changes) || body.changes.length > 500 || typeof body.requestId !== 'string' ||
          !/^[A-Za-z0-9_-]{8,128}$/.test(body.requestId)) throw problem(400, 'INVALID_REQUEST', 'The master update is invalid.');
        for (const name of ['actor', 'team', 'reason']) {
          if (body[name] !== undefined && (typeof body[name] !== 'string' || body[name].length > (name === 'reason' ? 1000 : 120))) {
            throw problem(400, 'INVALID_REQUEST', 'The master update details are invalid.');
          }
        }
        if (githubStore && (typeof body.sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.sessionId) ||
          (body.editorName !== undefined && (typeof body.editorName !== 'string' || body.editorName.length > 60)))) {
          throw problem(400, 'INVALID_REQUEST', 'The editor details are invalid.');
        }
      }
      if (githubStore) {
        try {
          if (request.url === '/api/package/latest') {
            const result = await githubStore.package(key);
            response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': result.bytes.length, 'Content-Disposition': 'attachment; filename="master_ppc.pkg"' });
            response.end(result.bytes);
          } else {
            const result = save ? await githubStore.save(key, body) : await githubStore.latest(key);
            respond(response, result.code === 'MASTER_CONFLICT' ? 409 : 200, result);
          }
        } catch (error) {
          if (Number.isFinite(error?.retryUntil)) response.setHeader('Retry-After', String(Math.max(1, Math.ceil((error.retryUntil - Date.now()) / 1000))));
          throw problem(error?.status || (error?.code === 'INVALID_KEY' ? 401 : 503), error?.code || 'MASTER_UNAVAILABLE', error?.message || unavailable().message);
        }
        return true;
      }
      await serialized(filename, async () => {
        let release;
        try {
          if (save) release = await acquireFileLock(filename);
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const source = await unlockPackage(filename, key, maxFileBytes);
            try {
              rememberPresenceAuthorization(source, key);
              if (request.url === '/api/package/latest') {
                response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': source.bytes.length, 'Content-Disposition': 'attachment; filename="master_ppc.pkg"' });
                response.end(source.bytes);
                return;
              }
              if (!save) { respond(response, 200, { snapshot: snapshot(source, writable, requiresEditorToken) }); return; }
              let result;
              try {
                result = model.mergeChanges(source.manifest, body.changes, {
                  actor: body.actor || '', team: body.team || '', reason: body.reason || '', requestId: body.requestId, now: new Date().toISOString(),
                });
              } catch (error) {
                if (error instanceof RangeError || error instanceof TypeError || error?.code === 'INVALID_CHANGE') {
                  throw problem(422, 'INVALID_CHANGE', 'An update is invalid. Check the dates, specifications, and SKU fields before saving.');
                }
                throw error;
              }
              if (result.conflicts.length) {
                respond(response, 409, {
                  error: 'The master changed while you were editing. Choose which values to keep.', code: 'MASTER_CONFLICT',
                  snapshot: snapshot(source, writable, requiresEditorToken), conflicts: result.conflicts, requestId: body.requestId,
                });
                return;
              }
              if (result.savedFields) {
                const previousInfo = codec.normalizePackageInfo(source.manifest.packageInfo);
                result.manifest.packageInfo = codec.createPackageInfo({ comments: previousInfo?.comments || '' });
                const revision = await persistPackage(filename, source, result.manifest, key, maxFileBytes);
                if (revision === null) continue;
                source.manifest = result.manifest;
                source.revision = revision;
              }
              respond(response, 200, {
                snapshot: snapshot(source, writable, requiresEditorToken), savedFields: result.savedFields,
                savedProducts: result.savedProducts, requestId: body.requestId,
              });
              return;
            } finally { for (const data of source.entries.values()) data.fill(0); }
          }
          throw problem(503, 'MASTER_BUSY', 'The master is changing quickly. Try saving again shortly.');
        } finally { if (release) await release(); }
      });
    } catch (error) {
      const safe = error instanceof MasterError ? error : unavailable();
      respond(response, safe.status, { error: safe.message, code: safe.code });
    } finally {
      key = '';
      if (body) { body.key = ''; body.editorToken = ''; }
    }
    return true;
  };
}

export function createMasterServer(options = {}) {
  const handle = createMasterHandler(options);
  if (Boolean(options.tlsCert) !== Boolean(options.tlsKey)) throw new Error('Configure both TLS certificate and private key.');
  const factory = options.tlsCert ? createHttpsServer : createServer;
  const server = factory({ maxHeaderSize: 8192, ...(options.tlsCert ? { cert: options.tlsCert, key: options.tlsKey } : {}) }, async (request, response) => {
    if (!(await handle(request, response))) {
      securityHeaders(response, '');
      respond(response, 404, { error: 'Endpoint not found.', code: 'NOT_FOUND' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  return server;
}

export const createDateMasterHandler = createMasterHandler;
export const createDateMasterServer = createMasterServer;

export function masterConfigFromEnv(env = process.env) {
  return {
    storage: env.PPC_MASTER_STORAGE || 'file',
    githubToken: env.PPC_GITHUB_TOKEN || '',
    packageFile: env.PPC_MASTER_FILE || env.PPC_PACKAGE_FILE,
    allowedOrigins: env.PPC_ALLOWED_ORIGINS || undefined,
    editorToken: env.PPC_MASTER_WRITE_TOKEN || env.PPC_MASTER_EDITOR_TOKEN || '',
    allowLocalEdits: env.PPC_MASTER_LOCAL_EDITS === '1' || env.PPC_ALLOW_LOCAL_EDITS === '1',
    rateLimit: env.PPC_RATE_LIMIT,
    rateWindowMs: env.PPC_RATE_WINDOW_MS,
    trustedProxyIPs: String(env.PPC_TRUSTED_PROXY_IPS || '').split(',').map(value => value.trim()).filter(Boolean),
    presenceTtlMs: env.PPC_MASTER_PRESENCE_TTL_MS,
    presenceMaxUsers: env.PPC_MASTER_PRESENCE_MAX_USERS,
    presenceRateLimit: env.PPC_MASTER_PRESENCE_RATE_LIMIT,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const host = process.env.PPC_BIND_HOST || '127.0.0.1';
    const options = masterConfigFromEnv();
    if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
      if (!isIP(host) || !options.allowedOrigins) throw new Error('Network listening requires an explicit IP address and exact allowed origins behind HTTPS.');
    }
    const certFile = process.env.PPC_TLS_CERT_FILE;
    const keyFile = process.env.PPC_TLS_KEY_FILE;
    if (Boolean(certFile) !== Boolean(keyFile)) throw new Error('Configure both TLS certificate and private key files.');
    if (certFile) { options.tlsCert = await readFile(resolve(certFile)); options.tlsKey = await readFile(resolve(keyFile)); }
    const port = integer(process.env.PPC_MASTER_PORT || process.env.PPC_PORT || process.env.PORT, 8788, 1, 65535);
    const server = createMasterServer(options);
    server.on('error', () => { process.stderr.write('The master service could not start. Check its configuration.\n'); process.exitCode = 1; });
    server.listen(port, host, () => process.stdout.write(`Master service listening on ${host}:${port}.\n`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  } catch {
    process.stderr.write('The master service could not start. Check its configuration.\n');
    process.exitCode = 1;
  }
}
