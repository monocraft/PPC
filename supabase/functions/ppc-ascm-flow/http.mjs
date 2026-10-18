import { createHash, timingSafeEqual } from 'node:crypto';
import { parseAscmInstant, validateAscmEnvelope } from '../ppc-master/ascm-mail-policy.mjs';
import { createCiphertextVerifier } from '../ppc-package/hash.mjs';
import { MAX_PACKAGE_BYTES } from '../ppc-master/package-delivery-contract.mjs';

const JSON_LIMIT = 3 * 1024 * 1024, WORKBOOK_LIMIT = 2 * 1024 * 1024;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const MAIL_FIELDS = ['sender', 'subject', 'receivedAt', 'messageId', 'fileName', 'workbookBase64'];
const ITEM_HEADERS = { driveId: 'x-ppc-sp-drive-id', folderId: 'x-ppc-sp-folder-id', itemId: 'x-ppc-sp-item-id', versionId: 'x-ppc-sp-version-id', fileName: 'x-ppc-sp-file-name' };
const HOLD_CODES = new Set(['ASCM_REVIEW_REQUIRED', 'ASCM_REPLAY_MISMATCH', 'ASCM_RETRY_REQUIRED', 'ASCM_SOURCE_REJECTED',
  'ASCM_INVALID_WORKBOOK', 'ASCM_POLICY_REQUIRED', 'ASCM_TOO_LARGE', 'ASCM_MASTER_TOO_LARGE', 'ASCM_RATE_LIMIT', 'ASCM_UNAVAILABLE']);
const record = v => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const strict = (v, fields) => record(v) && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k));
const text = (v, max = 512) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const secret = v => text(v) && v.length >= 32 && !/\s/.test(v);
const hash = v => createHash('sha256').update(v).digest();
const problem = (status = 503, code = 'ASCM_FLOW_UNAVAILABLE') => Object.assign(new Error('ASCM request could not be confirmed.'), { status, code });
const reply = (status, value, extra = {}) => new Response(JSON.stringify(value), { status, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra } });
const deny = (status, code) => reply(status, { code, archiveAllowed: false });
function configuration(env) {
  let credential; try { credential = JSON.parse(env.SUPABASE_SECRET_KEYS || '{}')?.default || env.SUPABASE_SERVICE_ROLE_KEY; } catch { return null; }
  const cutoff = parseAscmInstant(env.PPC_ASCM_START_AFTER);
  if (env.PPC_ASCM_FLOW_ENABLED !== 'true' || env.PPC_PACKAGE_DELIVERY_ENABLED !== 'true'
    || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env.SUPABASE_URL || '') || !text(credential, 4096)
    || !secret(env.PPC_ASCM_FLOW_SECRET) || !secret(env.PPC_ASCM_IMPORT_SECRET) || !secret(env.PPC_PUBLISHER_SECRET)
    || [env.PPC_ASCM_IMPORT_SECRET, env.PPC_PUBLISHER_SECRET, credential].includes(env.PPC_ASCM_FLOW_SECRET)
    || !/^[a-f0-9]{64}$/.test(env.PPC_PACKAGE_KEY_HASH || '') || cutoff === null
    || !text(env.PPC_PACKAGE_SP_DRIVE_ID) || !text(env.PPC_PACKAGE_SP_FOLDER_ID)) return null;
  return { cutoff, worker: hash(env.PPC_ASCM_FLOW_SECRET) };
}

// The reader is always cancelled at the boundary. Only small JSON is retained;
// raw package verification holds eight envelope bytes and incremental hash state.
async function consume(source, maximum, { signal, raw = false } = {}) {
  const declared = source.headers.get('content-length');
  if (declared !== null && (!/^(?:0|[1-9]\d*)$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maximum
    || raw && Number(declared) < 36)) throw problem(413, 'REQUEST_TOO_LARGE');
  const reader = source.body?.getReader(); if (!reader) throw problem(400, 'INVALID_REQUEST');
  const verifier = raw ? createCiphertextVerifier() : null;
  const decoder = raw ? null : new TextDecoder('utf-8', { fatal: true }); let size = 0, content = '', timer, abort;
  const interrupted = new Promise((resolve, reject) => {
    abort = () => { void reader.cancel().catch(() => {}); reject(problem(408, 'REQUEST_INTERRUPTED')); };
    timer = setTimeout(abort, 120_000);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([interrupted, (async () => {
      for (;;) {
        if (signal?.aborted) throw problem(408, 'REQUEST_INTERRUPTED');
        const part = await reader.read(); if (part.done) break;
        if (!(part.value instanceof Uint8Array)) throw problem(400, 'INVALID_REQUEST');
        size += part.value.byteLength; if (size > maximum) throw problem(413, 'REQUEST_TOO_LARGE');
        if (raw) verifier.update(part.value); else content += decoder.decode(part.value, { stream: true });
      }
      if (declared !== null && size !== Number(declared)) throw problem(400, 'CONTENT_LENGTH_MISMATCH');
      if (raw) { const { sha256, bytes } = verifier.finish(); return { sha256, bytes }; }
      try { return JSON.parse(content + decoder.decode()); } catch { throw problem(400, 'INVALID_REQUEST'); }
    })()]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function reportInput(value, cutoff, now) {
  if (!strict(value, MAIL_FIELDS) || MAIL_FIELDS.slice(0, 5).some(k => !text(value[k], k === 'messageId' ? 1024 : 320))) throw problem(400, 'INVALID_REQUEST');
  try { validateAscmEnvelope(value); } catch { throw problem(400, 'ASCM_SOURCE_REJECTED'); }
  const received = parseAscmInstant(value.receivedAt), current = new Date(now()).getTime();
  if (!Number.isFinite(current) || received <= cutoff || received > current) throw problem(400, 'ASCM_SOURCE_REJECTED');
  const encoded = value.workbookBase64;
  if (typeof encoded !== 'string' || !encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw problem(400, 'ASCM_INVALID_WORKBOOK');
  if (encoded.length > 4 * Math.ceil(WORKBOOK_LIMIT / 3)) throw problem(413, 'REQUEST_TOO_LARGE');
  let binary; try { binary = atob(encoded); } catch { throw problem(400, 'ASCM_INVALID_WORKBOOK'); }
  if (binary.length > WORKBOOK_LIMIT) throw problem(413, 'REQUEST_TOO_LARGE');
  if (btoa(binary) !== encoded) throw problem(400, 'ASCM_INVALID_WORKBOOK');
  return 'ascm-' + hash(Uint8Array.from(binary, c => c.charCodeAt(0))).toString('hex');
}
function safeReceipt(value, status, requestId, sourceMessageId) {
  const count = v => Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000;
  if (!record(value) || value.requestId !== requestId || !Number.isSafeInteger(value.storageRevision) || value.storageRevision < 1
    || typeof value.alreadySaved !== 'boolean' || typeof value.archiveAllowed !== 'boolean' || !record(value.summary)
    || !count(value.summary.savedFields) || !count(value.summary.savedProducts)
    || (value.archiveAllowed ? status !== 200 || value.status !== 'published' : status !== 202 || value.status !== 'publication_pending')) throw problem();
  return { sourceMessageId, requestId, storageRevision: value.storageRevision, alreadySaved: value.alreadySaved,
    archiveAllowed: value.archiveAllowed, status: value.status, summary: { savedFields: value.summary.savedFields, savedProducts: value.summary.savedProducts } };
}
function generationHeader(request) {
  const v = request.headers.get('x-ppc-package-generation');
  if (!/^[1-9]\d*$/.test(v || '') || !Number.isSafeInteger(Number(v))) throw problem(400, 'INVALID_REQUEST');
  return Number(v);
}
function safeCandidate(v, env) {
  if (v === null) return null;
  if (!record(v) || !new RegExp(`^${UUID}$`).test(v.candidateId) || !Number.isSafeInteger(v.generation) || v.generation < 1
    || !Number.isSafeInteger(v.storageRevision) || v.storageRevision < 1 || !/^[a-f0-9]{64}$/.test(v.sha256 || '')
    || !Number.isSafeInteger(v.bytes) || v.bytes < 36 || v.bytes > MAX_PACKAGE_BYTES || !text(v.expiresAt, 64) || !Number.isFinite(Date.parse(v.expiresAt))
    || !text(v.fileName, 256) || v.provider !== 'sharepoint' || v.driveId !== env.PPC_PACKAGE_SP_DRIVE_ID || v.folderId !== env.PPC_PACKAGE_SP_FOLDER_ID) throw problem();
  return Object.fromEntries(['candidateId', 'generation', 'storageRevision', 'sha256', 'bytes', 'expiresAt', 'fileName', 'provider', 'driveId', 'folderId'].map(k => [k, v[k]]));
}
function safePublication(v) {
  if (!record(v) || v.provider !== 'sharepoint' || !['seed', 'publication'].includes(v.kind) || !new RegExp(`^${UUID}$`).test(v.candidateId)
    || !Number.isSafeInteger(v.generation) || v.generation < 1 || !Number.isSafeInteger(v.storageRevision) || v.storageRevision < 1
    || !/^[a-f0-9]{64}$/.test(v.sha256 || '') || !Number.isSafeInteger(v.bytes) || v.bytes < 36 || v.bytes > MAX_PACKAGE_BYTES
    || !text(v.publishedAt, 64) || !Number.isFinite(Date.parse(v.publishedAt))) throw problem();
  return Object.fromEntries(['provider', 'kind', 'candidateId', 'generation', 'sha256', 'bytes', 'storageRevision', 'publishedAt'].map(k => [k, v[k]]));
}
export function createAscmFlowHttpHandler({ env = {}, invokeAscm, getPackageDelivery, invokeConnection, now = () => new Date().toISOString() } = {}) {
  const config = configuration(env);
  return async request => {
    if (!config) return deny(404, 'NOT_FOUND');
    if (request.headers.has('origin')) return deny(403, 'ORIGIN_DENIED');
    const url = new URL(request.url), prefix = '/functions/v1/ppc-ascm-flow';
    const path = url.pathname.startsWith(prefix + '/') ? url.pathname.slice(prefix.length) : url.pathname;
    const binary = new RegExp(`^/api/ascm/publication/(${UUID})/(bytes|confirm)$`).exec(path);
    if (!['/api/ascm/import', '/api/ascm/publication/queued', '/api/ascm/connection'].includes(path) && !binary) return deny(404, 'NOT_FOUND');
    if (url.search || url.hash) return deny(400, 'INVALID_REQUEST');
    const method = binary?.[2] === 'bytes' ? 'GET' : 'POST';
    if (request.method !== method) return deny(405, 'METHOD_NOT_ALLOWED');
    const supplied = request.headers.get('x-ppc-ascm-flow-secret') || '';
    if (supplied.length > 512 || !timingSafeEqual(hash(supplied), config.worker)) return deny(401, 'UNAUTHORIZED');
    try {
      const allowed = new Set(['x-ppc-ascm-flow-secret', ...(binary ? ['x-ppc-package-generation', ...(binary[2] === 'confirm' ? Object.values(ITEM_HEADERS) : [])] : [])]);
      for (const key of request.headers.keys()) if (key.startsWith('x-ppc-') && !allowed.has(key)) throw problem(400, 'INVALID_REQUEST');
      if (binary) {
        const input = { candidateId: binary[1], generation: generationHeader(request) };
        if (binary[2] === 'bytes') return await getPackageDelivery().openQueuedPublication(input, { signal: request.signal });
        if (request.headers.get('content-type') !== 'application/octet-stream') throw problem(415, 'CONTENT_TYPE');
        const item = Object.fromEntries(Object.entries(ITEM_HEADERS).map(([k, h]) => [k, request.headers.get(h)]));
        if (Object.entries(item).some(([k, v]) => !text(v, k === 'fileName' ? 256 : 512))
          || item.driveId !== env.PPC_PACKAGE_SP_DRIVE_ID || item.folderId !== env.PPC_PACKAGE_SP_FOLDER_ID) throw problem(400, 'INVALID_REQUEST');
        const verified = await consume(request, MAX_PACKAGE_BYTES, { signal: request.signal, raw: true });
        // The native worker is trusted for Microsoft provenance; an equal digest
        // proves byte identity and does not independently attest SharePoint origin.
        const value = await getPackageDelivery().confirmPublication({ ...input, item, verified });
        if (!['published', 'already_published'].includes(value?.status)) throw problem();
        const publication = safePublication(value.publication);
        if (publication.candidateId !== input.candidateId || publication.generation !== input.generation || publication.sha256 !== verified.sha256 || publication.bytes !== verified.bytes) throw problem();
        return reply(200, { status: value.status, publication, archiveAllowed: false });
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw problem(415, 'CONTENT_TYPE');
      const value = await consume(request, path === '/api/ascm/import' ? JSON_LIMIT : 4096, { signal: request.signal });
      if (path === '/api/ascm/connection') {
        if (!strict(value, ['service', 'state']) || !['outlook', 'sharepoint'].includes(value.service) || !['available', 'reconnect_required'].includes(value.state)) throw problem(400, 'INVALID_REQUEST');
        const reported = env.PPC_ASCM_STATUS_ENABLED === 'true' && typeof invokeConnection === 'function' ? (await invokeConnection(value))?.reported === true : false;
        return reply(200, { reported, archiveAllowed: false });
      }
      if (path === '/api/ascm/publication/queued') {
        if (!strict(value, [])) throw problem(400, 'INVALID_REQUEST');
        const metadata = await getPackageDelivery().getQueuedPublicationMetadata(); const candidate = safeCandidate(metadata?.candidate, env);
        return reply(200, { candidate, ...(candidate ? { binaryPath: `/api/ascm/publication/${candidate.candidateId}/bytes` } : {}), archiveAllowed: false });
      }
      const requestId = reportInput(value, config.cutoff, now), delivery = getPackageDelivery();
      const metadata = await delivery.getQueuedPublicationMetadata();
      if (!['seeding', 'sharepoint'].includes(metadata?.phase)) throw problem(409, 'PACKAGE_PHASE');
      const response = await invokeAscm(new Request(env.SUPABASE_URL + '/functions/v1/ppc-master/api/master/ascm', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-PPC-ASCM-Secret': env.PPC_ASCM_IMPORT_SECRET }, body: JSON.stringify(value), signal: request.signal }));
      const native = await consume(response, 64 * 1024, { signal: request.signal });
      if (!response.ok) return reply([400, 409, 413, 429, 503].includes(response.status) ? response.status : 503,
        { sourceMessageId: value.messageId, requestId, status: 'held', archiveAllowed: false, code: HOLD_CODES.has(native?.code) ? native.code : 'ASCM_IMPORT_NOT_CONFIRMED' });
      const receipt = safeReceipt(native, response.status, requestId, value.messageId);
      if (receipt.archiveAllowed) {
        let current; try { current = safePublication(await delivery.publicState()); } catch { /* A held/seed/malformed pointer cannot grant Archive. */ }
        receipt.archiveAllowed = current?.provider === 'sharepoint' && current.kind === 'publication' && current.storageRevision >= receipt.storageRevision;
        if (!receipt.archiveAllowed) { receipt.archiveAllowed = false; receipt.status = 'publication_pending'; }
      }
      return reply(receipt.archiveAllowed ? 200 : 202, receipt);
    } catch (error) {
      const status = [400, 408, 409, 413, 415, 429].includes(error?.status) ? error.status : 503;
      return deny(status, status === 503 ? 'ASCM_FLOW_UNAVAILABLE' : /^[A-Z_]{1,64}$/.test(error?.code || '') ? error.code : 'INVALID_REQUEST');
    }
  };
}
