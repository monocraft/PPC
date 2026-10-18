import { parseAscmInstant, validateAscmEnvelope } from '../ppc-master/ascm-mail-policy.mjs';
import { createCiphertextVerifier } from '../ppc-package/hash.mjs';
import { MAX_PACKAGE_BYTES } from '../ppc-master/package-delivery-contract.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DOWNLOAD_ORIGIN = 'https://sdmntprcentralusdr.oaiusercontent.com';
const encoder = new TextEncoder();
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);

export class AscmMcpError extends Error {
  constructor(status, code, message) { super(message); this.name = 'AscmMcpError'; this.status = status; this.code = code; }
}
const unauthorized = () => new AscmMcpError(401, 'ASCM_MCP_UNAUTHORIZED', 'The configured ASCM owner authorization is required.');
const unavailable = () => new AscmMcpError(503, 'ASCM_MCP_UNAVAILABLE', 'The ASCM importer is not available. Keep the email for a later attempt.');
const invalidArguments = () => new AscmMcpError(400, 'ASCM_MCP_INVALID_ARGUMENTS', 'Provide one eligible monthly report and its Outlook attachment.');
const MAIL_FIELDS = ['sender', 'subject', 'receivedAt', 'messageId', 'fileName'];
const HOLD_CODES = new Set(['ASCM_REVIEW_REQUIRED', 'ASCM_REPLAY_MISMATCH', 'ASCM_RETRY_REQUIRED',
  'ASCM_SOURCE_REJECTED', 'ASCM_INVALID_WORKBOOK', 'ASCM_POLICY_REQUIRED', 'ASCM_TOO_LARGE',
  'ASCM_MASTER_TOO_LARGE', 'ASCM_RATE_LIMIT', 'ASCM_UNAVAILABLE']);

function configuration(env, now) {
  if (env.PPC_ASCM_MCP_ENABLED !== 'true' || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env.SUPABASE_URL || '')) return null;
  const issuer = env.SUPABASE_URL + '/auth/v1';
  const resource = env.SUPABASE_URL + '/functions/v1/ppc-ascm-mcp/mcp';
  const cutoff = parseAscmInstant(env.PPC_ASCM_START_AFTER);
  if (env.PPC_ASCM_MCP_RESOURCE !== resource
    || env.PPC_ASCM_MCP_DOWNLOAD_ORIGIN !== DOWNLOAD_ORIGIN
    || !UUID.test(env.PPC_ASCM_MCP_OWNER_ID || '') || !UUID.test(env.PPC_ASCM_MCP_CLIENT_ID || '')
    || cutoff === null || cutoff >= now
    || !text(env.PPC_ASCM_IMPORT_SECRET, 512) || env.PPC_ASCM_IMPORT_SECRET.length < 32 || /\s/.test(env.PPC_ASCM_IMPORT_SECRET)) return null;
  return { issuer, resource, cutoff, owner: env.PPC_ASCM_MCP_OWNER_ID, client: env.PPC_ASCM_MCP_CLIENT_ID,
    secret: env.PPC_ASCM_IMPORT_SECRET, jwks: issuer + '/.well-known/jwks.json' };
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function decodeSegment(value, maximum) {
  if (!text(value, maximum) || !/^[A-Za-z0-9_-]+$/.test(value)) throw unauthorized();
  let bytes;
  try { bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), character => character.charCodeAt(0)); }
  catch { throw unauthorized(); }
  if (base64Url(bytes) !== value) throw unauthorized();
  return bytes;
}
function parseSegment(value, maximum) {
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeSegment(value, maximum)));
    if (!record(parsed)) throw unauthorized();
    return parsed;
  } catch { throw unauthorized(); }
}

function reportArguments(input, config, currentTime) {
  try {
    if (!record(input) || Object.keys(input).length !== 6 || Object.keys(input).some(key => ![...MAIL_FIELDS, 'workbook'].includes(key))
      || encoder.encode(JSON.stringify(input)).byteLength > 32 * 1024
      || MAIL_FIELDS.some(key => !text(input[key], key === 'messageId' ? 1024 : 320))) throw invalidArguments();
    const envelope = Object.fromEntries(MAIL_FIELDS.map(key => [key, input[key]]));
    validateAscmEnvelope(envelope);
    const received = parseAscmInstant(envelope.receivedAt);
    if (received <= config.cutoff || received > currentTime + 5 * 60_000) throw invalidArguments();
    const workbook = input.workbook;
    if (!record(workbook) || Object.keys(workbook).some(key => !['download_url', 'file_id', 'mime_type', 'file_name'].includes(key))
      || !text(workbook.file_id, 1024) || !text(workbook.download_url, 16 * 1024)
      || (workbook.file_name !== undefined && workbook.file_name !== envelope.fileName)
      || (workbook.mime_type !== undefined && !['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'].includes(workbook.mime_type))) throw invalidArguments();
    const value = workbook.download_url;
    const rawPath = /^https:\/\/sdmntprcentralusdr\.oaiusercontent\.com(\/[^?#]*)\?/.exec(value)?.[1];
    const path = /^\/files\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/raw$/i.exec(rawPath || '');
    const url = new URL(value);
    if (!path || value.includes('\\') || value.includes('#')
      || url.origin !== DOWNLOAD_ORIGIN || url.username || url.password || url.pathname !== rawPath
      || url.searchParams.getAll('sig').length !== 1 || !url.searchParams.get('sig')?.trim()
      || url.searchParams.getAll('se').length !== 1 || !url.searchParams.get('se')?.trim()) throw invalidArguments();
    return { envelope, downloadUrl: value };
  } catch { throw invalidArguments(); }
}

async function responseJson(response, limit) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    response.body?.cancel().catch(() => {}); throw unavailable();
  }
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  let size = 0; const chunks = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw unavailable();
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function safeReceipt(value, status, requestId, sourceMessageId) {
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
  if (!record(value) || value.requestId !== requestId || !Number.isSafeInteger(value.storageRevision) || value.storageRevision < 1
    || typeof value.alreadySaved !== 'boolean' || typeof value.archiveAllowed !== 'boolean' || !record(value.summary)
    || !count(value.summary.savedFields) || !count(value.summary.savedProducts)
    || (value.archiveAllowed ? status !== 200 || value.status !== 'published' : status !== 202 || value.status !== 'publication_pending')) throw unavailable();
  return { sourceMessageId, requestId, storageRevision: value.storageRevision,
    alreadySaved: value.alreadySaved, archiveAllowed: value.archiveAllowed, status: value.status,
    summary: { savedFields: value.summary.savedFields, savedProducts: value.summary.savedProducts } };
}

/** OAuth and attachment boundaries only; the existing ASCM API owns all master writes. */
export function createAscmMcpCore({ env = {}, fetchImpl = globalThis.fetch, invokeAscm, invokeConnection, getPackageDelivery,
  now = () => new Date(), cryptoImpl = globalThis.crypto } = {}) {
  const time = () => {
    const value = new Date(now()).getTime();
    if (!Number.isFinite(value)) throw unavailable();
    return value;
  };
  let config;
  try { config = configuration(env, time()); } catch { config = null; }
  let cachedKeys = null, fetchedAt = -Infinity, pendingKeys = null;

  async function fetchBytes(target, limit, timeoutMs, accept) {
    const controller = new AbortController();
    let timer, reader;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reader?.cancel().catch(() => {}); reject(new Error('Bounded transport unavailable.')); }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetchImpl(target, { method: 'GET', headers: { Accept: accept },
          redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        const declared = response.headers.get('content-length');
        if (!response.ok || response.redirected || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))) {
          await response.body?.cancel().catch(() => {}); throw new Error('Bounded transport unavailable.');
        }
        reader = response.body?.getReader();
        if (!reader) throw new Error('Bounded transport unavailable.');
        let size = 0; const chunks = [];
        for (;;) {
          const part = await reader.read();
          if (controller.signal.aborted) throw new Error('Bounded transport unavailable.');
          if (part.done) break;
          size += part.value.byteLength;
          if (size > limit) throw new Error('Bounded transport unavailable.');
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return bytes;
      })()]);
    } finally {
      clearTimeout(timer);
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
  }

  async function jwks() {
    if (cachedKeys && time() - fetchedAt < 5 * 60_000) return cachedKeys;
    if (!pendingKeys) pendingKeys = (async () => {
      const bytes = await fetchBytes(config.jwks, 64 * 1024, 5000, 'application/json');
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!record(body) || !Array.isArray(body.keys) || body.keys.length > 20) throw unauthorized();
      cachedKeys = body.keys; fetchedAt = time();
      return cachedKeys;
    })().finally(() => { pendingKeys = null; });
    return pendingKeys;
  }

  async function authenticate(accessToken) {
    if (!config) throw unavailable();
    try {
      if (!text(accessToken, 16 * 1024) || /\s/.test(accessToken)) throw unauthorized();
      const segments = accessToken.split('.');
      if (segments.length !== 3) throw unauthorized();
      const header = parseSegment(segments[0], 2048), claims = parseSegment(segments[1], 12 * 1024);
      if (!['ES256', 'RS256'].includes(header.alg) || !text(header.kid, 180)
        || header.crit !== undefined || header.jku !== undefined || header.x5u !== undefined || header.jwk !== undefined
        || header.b64 !== undefined || (header.typ !== undefined && !['JWT', 'at+jwt'].includes(header.typ))) throw unauthorized();
      const current = Math.floor(time() / 1000);
      if (claims.iss !== config.issuer || claims.aud !== config.resource
        || claims.sub !== config.owner || claims.client_id !== config.client
        || claims.role !== 'authenticated' || claims.is_anonymous !== false
        || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat)
        || claims.iat < 0 || claims.exp <= current || claims.iat > current + 30 || claims.exp <= claims.iat
        || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf < 0 || claims.nbf > current + 30 || claims.nbf >= claims.exp))) throw unauthorized();
      const signature = decodeSegment(segments[2], 2048);
      const candidates = (await jwks()).filter(key => record(key) && key.kid === header.kid);
      if (candidates.length !== 1) throw unauthorized();
      const key = candidates[0];
      if (key.alg !== header.alg || (key.use !== undefined && key.use !== 'sig')
        || (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify')))
        || key.d !== undefined || (header.alg === 'ES256' ? key.kty !== 'EC' || key.crv !== 'P-256' || signature.length !== 64 : key.kty !== 'RSA')) throw unauthorized();
      const algorithm = header.alg === 'ES256' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
      const publicKey = await cryptoImpl.subtle.importKey('jwk', key, algorithm, false, ['verify']);
      const verifyAlgorithm = header.alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' };
      if (!await cryptoImpl.subtle.verify(verifyAlgorithm, publicKey, signature, encoder.encode(segments[0] + '.' + segments[1]))) throw unauthorized();
      return Object.freeze({ subject: claims.sub, clientId: claims.client_id });
    } catch { throw unauthorized(); }
  }

  async function getProfile(accessToken, args = {}) {
    const identity = await authenticate(accessToken);
    if (!record(args) || Object.keys(args).length) throw new AscmMcpError(400, 'ASCM_MCP_INVALID_ARGUMENTS', 'Provide no profile arguments.');
    return { id: identity.subject };
  }
  async function reportConnection(accessToken, input) {
    await authenticate(accessToken);
    if (!record(input) || Object.keys(input).length !== 2 || Object.keys(input).some(key => !['service', 'state'].includes(key))
      || !['outlook', 'sharepoint'].includes(input.service) || !['available', 'reconnect_required'].includes(input.state)) throw invalidArguments();
    if (typeof invokeConnection !== 'function') return { reported: false };
    try { return { reported: (await invokeConnection({ service: input.service, state: input.state }))?.reported === true }; }
    catch { return { reported: false }; }
  }
  async function importReport(accessToken, input) {
    await authenticate(accessToken);
    const { envelope, downloadUrl } = reportArguments(input, config, time());
    if (typeof invokeAscm !== 'function') throw unavailable();
    try {
      const bytes = await fetchBytes(downloadUrl, 2 * 1024 * 1024, 20_000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (!bytes.length) throw unavailable();
      const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
      const requestId = 'ascm-' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const response = await invokeAscm(new Request(env.SUPABASE_URL + '/functions/v1/ppc-master/api/master/ascm', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PPC-ASCM-Secret': config.secret },
        body: JSON.stringify({ ...envelope, workbookBase64: btoa(binary) }),
      }));
      const value = await responseJson(response, 64 * 1024);
      if (!response.ok) return { sourceMessageId: envelope.messageId, archiveAllowed: false, status: 'held',
        code: HOLD_CODES.has(value?.code) ? value.code : 'ASCM_IMPORT_NOT_CONFIRMED' };
      return safeReceipt(value, response.status, requestId, envelope.messageId);
    } catch { throw unavailable(); }
  }
  function packageDelivery() {
    if (env.PPC_PACKAGE_DELIVERY_ENABLED !== 'true' || typeof getPackageDelivery !== 'function') throw unavailable();
    return getPackageDelivery();
  }
  async function getQueuedPublication(accessToken, input = {}) {
    await authenticate(accessToken);
    if (!record(input) || Object.keys(input).length) throw invalidArguments();
    try { return await packageDelivery().getQueuedPublication(); } catch { throw unavailable(); }
  }
  function readbackArguments(input) {
    try {
      if (!record(input) || Object.keys(input).length !== 4 || Object.keys(input).some(key => !['candidateId', 'generation', 'item', 'readback'].includes(key))
        || !UUID.test(input.candidateId || '') || !Number.isSafeInteger(input.generation) || input.generation < 1) throw invalidArguments();
      const item = input.item, readback = input.readback;
      if (!record(item) || Object.keys(item).length !== 5 || Object.keys(item).some(key => !['driveId', 'folderId', 'itemId', 'versionId', 'fileName'].includes(key))
        || Object.values(item).some(value => !text(value, 512))
        || !record(readback) || Object.keys(readback).some(key => !['download_url', 'file_id', 'mime_type', 'file_name'].includes(key))
        || !text(readback.file_id, 1024) || /^(?:https?:|data:|file:)/i.test(readback.file_id)
        || !text(readback.download_url, 16 * 1024) || readback.mime_type !== undefined && readback.mime_type !== 'application/octet-stream'
        || readback.file_name !== undefined && readback.file_name !== item.fileName) throw invalidArguments();
      // Reuse the exact raw-file origin/path boundary of the attachment tool.
      const value = readback.download_url;
      const rawPath = /^https:\/\/sdmntprcentralusdr\.oaiusercontent\.com(\/[^?#]*)\?/.exec(value)?.[1];
      const url = new URL(value);
      if (!/^\/files\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/raw$/i.test(rawPath || '')
        || value.includes('\\') || value.includes('#') || url.origin !== DOWNLOAD_ORIGIN || url.username || url.password || url.pathname !== rawPath
        || url.searchParams.getAll('sig').length !== 1 || !url.searchParams.get('sig')?.trim()
        || url.searchParams.getAll('se').length !== 1 || !Number.isFinite(Date.parse(url.searchParams.get('se'))) || Date.parse(url.searchParams.get('se')) <= time()) throw invalidArguments();
      return { item, downloadUrl: value };
    } catch { throw invalidArguments(); }
  }
  async function verifyReadback(target) {
    const controller = new AbortController(); let reader, timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reader?.cancel().catch(() => {}); reject(unavailable()); }, 120_000);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetchImpl(target, { method: 'GET', headers: { Accept: 'application/octet-stream' },
          redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        const declared = response.headers.get('content-length');
        if (!response.ok || response.redirected || !response.body
          || declared !== null && (!/^\d+$/.test(declared) || Number(declared) < 36 || Number(declared) > MAX_PACKAGE_BYTES)) {
          await response.body?.cancel().catch(() => {}); throw unavailable();
        }
        reader = response.body.getReader(); const verifier = createCiphertextVerifier();
        for (;;) { const part = await reader.read(); if (controller.signal.aborted) throw unavailable(); if (part.done) break; verifier.update(part.value); }
        const actual = verifier.finish(); if (declared !== null && actual.bytes !== Number(declared)) throw unavailable();
        return { sha256: actual.sha256, bytes: actual.bytes };
      })()]);
    } finally { clearTimeout(timer); controller.abort(); if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
  }
  async function confirmSharePointPublication(accessToken, input) {
    await authenticate(accessToken); const delivery = packageDelivery();
    const { item, downloadUrl } = readbackArguments(input);
    try {
      const verified = await verifyReadback(downloadUrl);
      // The authenticated worker supplies SharePoint provenance. A signed raw
      // artifact authenticates byte transport, not the claimed Microsoft origin.
      return await delivery.confirmPublication({ candidateId: input.candidateId, generation: input.generation, item, verified });
    } catch { throw unavailable(); }
  }
  return Object.freeze({ enabled: Boolean(config), authenticate, getProfile, importReport, reportConnection, getQueuedPublication, confirmSharePointPublication });
}
