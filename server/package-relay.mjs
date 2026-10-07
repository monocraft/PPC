import { createServer } from 'node:http';
import { open, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import '../public/js/package-codec.js';

const codec = globalThis.PortfolioPackage;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

class RelayError extends Error {
  constructor(status) {
    super('Package request could not be completed.');
    this.status = status;
  }
}

function integer(value, fallback, minimum, maximum) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error('Invalid relay numeric configuration.');
  }
  return parsed;
}

function normalizeIP(value) {
  const address = String(value || '').replace(/^::ffff:/, '');
  return isIP(address) ? address : '';
}

function normalizeOrigins(values) {
  const origins = Array.isArray(values) ? values : String(values || '').split(',');
  if (!origins.length) throw new Error('Configure at least one allowed origin.');
  const result = new Set();
  for (const value of origins) {
    const origin = String(value).trim();
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('Invalid relay origin configuration.'); }
    if (parsed.origin !== origin || parsed.username || parsed.password ||
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)))) {
      throw new Error('Use exact HTTPS origins, or local HTTP origins, without a path.');
    }
    result.add(origin);
  }
  return result;
}

function signature(info) {
  return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');
}

function encryptedSource(bytes) {
  return bytes.length >= 36 && codec.isEncrypted(bytes) &&
    Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from('PPCPKG01'));
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

function respond(response, status, payload) {
  if (response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readBody(request, maxBodyBytes) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let length = 0;
    let finished = false;
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAbort);
    };
    const fail = status => {
      if (finished) return;
      finished = true;
      cleanup();
      request.resume();
      rejectBody(new RelayError(status));
    };
    const onData = chunk => {
      length += chunk.length;
      if (length > maxBodyBytes) return fail(413);
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { rejectBody(new RelayError(400)); }
    };
    const onError = () => fail(400);
    const onAbort = () => fail(400);
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('aborted', onAbort);
    const declared = request.headers['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxBodyBytes)) fail(413);
  });
}

/** Fixed-file relay. Keys and decrypted bytes are never retained between requests. */
export function createRelayServer(options = {}) {
  if (!options.packageFile || typeof options.packageFile !== 'string') {
    throw new Error('Configure the encrypted package file.');
  }
  const packageFile = resolve(options.packageFile);
  const origins = normalizeOrigins(options.allowedOrigins || ['https://monocraft.github.io']);
  const maxFileBytes = integer(options.maxFileBytes, MAX_FILE_BYTES, 36, MAX_FILE_BYTES);
  const maxBodyBytes = integer(options.maxBodyBytes, 2048, 64, 8192);
  const rateLimit = integer(options.rateLimit, 30, 1, 1000);
  const rateWindowMs = integer(options.rateWindowMs, 60000, 100, 3600000);
  const maxConcurrent = integer(options.maxConcurrent, 2, 1, 8);
  const trustedProxyIPs = new Set((options.trustedProxyIPs || []).map(value => {
    const ip = normalizeIP(value);
    if (!ip) throw new Error('Invalid trusted proxy address.');
    return ip;
  }));
  const rates = new Map();
  let cached = null;
  let sourceRead = null;
  let active = 0;

  async function loadStableSource() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let handle;
      try {
        handle = await open(packageFile, 'r');
        const before = await handle.stat();
        if (!before.isFile() || before.size < 36 || before.size > maxFileBytes) throw new RelayError(503);
        const chunks = [];
        let length = 0;
        for (;;) {
          const chunk = Buffer.allocUnsafe(Math.min(65536, maxFileBytes + 1 - length));
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
          if (!bytesRead) break;
          length += bytesRead;
          if (length > maxFileBytes) throw new RelayError(503);
          chunks.push(chunk.subarray(0, bytesRead));
        }
        const after = await handle.stat();
        const current = await stat(packageFile);
        if (signature(before) !== signature(after) || signature(after) !== signature(current) || length !== after.size) {
          continue;
        }
        const bytes = Buffer.concat(chunks, length);
        if (!encryptedSource(bytes)) throw new RelayError(503);
        cached = { bytes, signature: signature(current), checkedAt: Date.now() };
        return cached.bytes;
      } finally {
        await handle?.close();
      }
    }
    throw new RelayError(503);
  }

  async function getSource() {
    const current = await stat(packageFile);
    if (!current.isFile() || current.size > maxFileBytes) throw new RelayError(503);
    if (cached && cached.signature === signature(current) && Date.now() - cached.checkedAt < 1000) return cached.bytes;
    if (sourceRead) {
      await sourceRead;
      return getSource();
    }
    sourceRead = loadStableSource();
    try { return await sourceRead; }
    finally { sourceRead = null; }
  }

  function clientIP(request) {
    const peer = normalizeIP(request.socket.remoteAddress) || 'unknown';
    if (!trustedProxyIPs.has(peer)) return peer;
    const forwarded = request.headers['x-forwarded-for'];
    // A trusted reverse proxy must replace this header with one client address.
    return typeof forwarded === 'string' && !forwarded.includes(',') ? normalizeIP(forwarded.trim()) || peer : peer;
  }

  function acceptRate(request) {
    const now = Date.now();
    if (rates.size >= 10000) for (const [ip, entry] of rates) if (entry.until <= now) rates.delete(ip);
    const ip = clientIP(request);
    let entry = rates.get(ip);
    if (!entry || entry.until <= now) {
      if (!entry && rates.size >= 10000) return false;
      entry = { until: now + rateWindowMs, count: 0 };
      rates.set(ip, entry);
    }
    entry.count += 1;
    return entry.count <= rateLimit;
  }

  const server = createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    const requestedOrigin = request.headers.origin;
    const allowedOrigin = typeof requestedOrigin === 'string' && origins.has(requestedOrigin) ? requestedOrigin : '';
    securityHeaders(response, allowedOrigin);
    let occupied = false;
    try {
      if (requestedOrigin !== undefined && !allowedOrigin) throw new RelayError(403);
      if (request.url === '/health' && request.method === 'GET') return respond(response, 200, { status: 'ok' });
      if (request.url !== '/api/package/latest') throw new RelayError(404);
      if (request.method === 'OPTIONS') {
        const requestedHeaders = String(request.headers['access-control-request-headers'] || '')
          .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
        if (!allowedOrigin || request.headers['access-control-request-method'] !== 'POST' ||
          requestedHeaders.some(value => value !== 'content-type')) throw new RelayError(403);
        response.writeHead(204, {
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600'
        });
        return response.end();
      }
      if (request.method !== 'POST') throw new RelayError(405);
      if (!acceptRate(request)) {
        response.setHeader('Retry-After', String(Math.ceil(rateWindowMs / 1000)));
        throw new RelayError(429);
      }
      if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''))) throw new RelayError(415);
      const body = await readBody(request, maxBodyBytes);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        !Object.hasOwn(body, 'key') || typeof body.key !== 'string') throw new RelayError(400);
      let key;
      try { key = codec.normalizeKey(body.key); }
      catch { throw new RelayError(401); }
      if (active >= maxConcurrent) throw new RelayError(503);
      active += 1;
      occupied = true;
      const bytes = await getSource();
      let plaintext;
      try { plaintext = await codec.decrypt(bytes, key); }
      catch { throw new RelayError(401); }
      finally { plaintext?.fill(0); }
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': bytes.length,
        'Content-Disposition': 'attachment; filename="master_ppc.pkg"'
      });
      response.end(bytes);
    } catch (error) {
      const status = error instanceof RelayError ? error.status : 503;
      const messages = {
        400: 'Invalid package request.', 401: 'Package key was not accepted.',
        403: 'Request origin is not allowed.', 404: 'Endpoint not found.',
        405: 'Method not allowed.', 413: 'Request is too large.',
        415: 'Use a JSON request.', 429: 'Too many requests. Try again later.',
        503: 'Latest package is temporarily unavailable.'
      };
      respond(response, status, { error: messages[status] || messages[503] });
    } finally {
      if (occupied) active -= 1;
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 50;
  return server;
}

export function relayConfigFromEnv(env = process.env) {
  return {
    packageFile: env.PPC_PACKAGE_FILE,
    allowedOrigins: env.PPC_ALLOWED_ORIGINS || 'https://monocraft.github.io',
    rateLimit: env.PPC_RATE_LIMIT,
    rateWindowMs: env.PPC_RATE_WINDOW_MS,
    maxConcurrent: env.PPC_MAX_CONCURRENT,
    trustedProxyIPs: String(env.PPC_TRUSTED_PROXY_IPS || '').split(',').map(value => value.trim()).filter(Boolean)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const host = process.env.PPC_BIND_HOST || '127.0.0.1';
    if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Bind the relay to a loopback address behind HTTPS.');
    const port = integer(process.env.PPC_PORT, 8787, 1, 65535);
    const server = createRelayServer(relayConfigFromEnv());
    server.on('error', () => { process.stderr.write('Package relay could not start. Check service configuration.\n'); process.exitCode = 1; });
    server.listen(port, host, () => process.stdout.write(`Package relay listening on ${host}:${port}. Use an HTTPS reverse proxy for remote access.\n`));
  } catch {
    process.stderr.write('Package relay could not start. Check service configuration.\n');
    process.exitCode = 1;
  }
}
