import './shared/ascm-import.js';
import './shared/master-model.js';
import { planAscmImport, AscmReviewError, ASCM_REVIEW_REASONS } from './ascm-plan.mjs';
import { validateAscmEnvelope } from './ascm-mail-policy.mjs';
import { qualifiesSharePointPublication } from './package-delivery-contract.mjs';

const SESSION = 'ascm-supervisor';
const MAX_FILE = 2 * 1024 * 1024;
const MAX_BODY = 3 * 1024 * 1024;
const encoder = new TextEncoder();
const fields = new Set(['sender', 'subject', 'receivedAt', 'messageId', 'fileName', 'workbookBase64']);
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const problem = (status, code, message) => new ApiError(status, code, message);
const unavailable = () => problem(503, 'ASCM_UNAVAILABLE', 'The ASCM import could not be confirmed. Keep the email and retry later.');
async function hash(bytes) {
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function sameSecret(left, right) {
  const [a, b] = await Promise.all([hash(encoder.encode(left)), hash(encoder.encode(right))]);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
async function readBody(request) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) throw problem(413, 'ASCM_TOO_LARGE', 'Use manual import for this report.');
  const reader = request.body?.getReader();
  if (!reader) throw problem(400, 'ASCM_INVALID_REQUEST', 'Provide the published ASCM workbook.');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) throw problem(413, 'ASCM_TOO_LARGE', 'Use manual import for this report.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw problem(400, 'ASCM_INVALID_REQUEST', 'Provide a valid JSON report request.'); }
}
function decodeWorkbook(value) {
  if (typeof value !== 'string' || !value || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw problem(400, 'ASCM_INVALID_WORKBOOK', 'Provide an ordinary XLSX workbook.');
  if (value.length > 4 * Math.ceil(MAX_FILE / 3)) throw problem(413, 'ASCM_TOO_LARGE', 'Use manual import for reports larger than 2 MiB.');
  let binary;
  try { binary = atob(value); } catch { throw problem(400, 'ASCM_INVALID_WORKBOOK', 'Provide an ordinary XLSX workbook.'); }
  if (binary.length > MAX_FILE) throw problem(413, 'ASCM_TOO_LARGE', 'Use manual import for reports larger than 2 MiB.');
  if (btoa(binary) !== value) throw problem(400, 'ASCM_INVALID_WORKBOOK', 'Provide a canonical workbook encoding.');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function configuredDatePolicy(value) {
  if (!value) return undefined;
  if (typeof value !== 'string' || value.length > 65536) throw problem(503, 'ASCM_POLICY_REQUIRED', 'The cloud date protection policy needs owner review.');
  let policy;
  try { policy = JSON.parse(value); } catch { throw problem(503, 'ASCM_POLICY_REQUIRED', 'The cloud date protection policy needs owner review.'); }
  if (!record(policy) || policy.version !== 1 || policy.allowUpdates !== true || !Array.isArray(policy.protected) || policy.protected.length > 1000 ||
      Object.keys(policy).some(key => !['version', 'allowUpdates', 'protected'].includes(key)) ||
      policy.protected.some(entry => !record(entry) || typeof entry.productId !== 'string' || !entry.productId || entry.productId.length > 180 ||
        Object.keys(entry).some(key => !['productId', 'fields'].includes(key)) || !Array.isArray(entry.fields) || !entry.fields.length ||
        entry.fields.some(field => !['generalAvailabilityDate', 'endManufacturingDate'].includes(field)))) {
    throw problem(503, 'ASCM_POLICY_REQUIRED', 'The cloud date protection policy needs owner review.');
  }
  return policy;
}
function acceptedResponse(state, requestId, fingerprint, alreadySaved) {
  const receipt = state?.receipt;
  if (!record(receipt) || receipt.fingerprint !== fingerprint || !Number.isSafeInteger(receipt.storageRevision) || receipt.storageRevision < 1 ||
      !Number.isSafeInteger(receipt.savedFields) || receipt.savedFields < 0 || !Number.isSafeInteger(receipt.savedProducts) || receipt.savedProducts < 0 ||
      !Number.isSafeInteger(state.storageRevision) || state.storageRevision < receipt.storageRevision) throw unavailable();
  const published = state.publication?.publishedRevision;
  const phase = state.publication?.deliveryPhase;
  const archiveAllowed = ['seeding', 'sharepoint'].includes(phase)
    ? Number.isSafeInteger(published) && published >= receipt.storageRevision && qualifiesSharePointPublication(state.publication, receipt.storageRevision)
    : phase === undefined || phase === 'legacy' ? Number.isSafeInteger(published) && published >= receipt.storageRevision : false;
  return { requestId, storageRevision: receipt.storageRevision, alreadySaved, archiveAllowed,
    status: archiveAllowed ? 'published' : 'publication_pending',
    summary: { savedFields: receipt.savedFields, savedProducts: receipt.savedProducts } };
}

/** Optional server-to-server endpoint. Never exports the raw master or accepts patches. */
export function createAscmApi({ env = {}, database, now = () => new Date().toISOString(), dispatchPublication = async () => false, validateManifest, validateReadableManifest } = {}) {
  const secret = env.PPC_ASCM_IMPORT_SECRET || '';
  const enabled = typeof secret === 'string' && secret.length >= 32 && secret.length <= 512 && !/[\s\u0000-\u001f]/.test(secret);
  const statusEnabled = env.PPC_ASCM_STATUS_ENABLED === 'true';
  const reportStatus = async payload => {
    try { return await database('ascm_status', payload); } catch { return null; }
  };
  return async function handle(request) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    const respond = (status, value) => new Response(JSON.stringify(value), { status, headers });
    let leaseId = '', leaseStarted = false;
    try {
      if (!enabled) throw problem(404, 'NOT_FOUND', 'This master action is unavailable.');
      if (request.headers.get('origin')) throw problem(403, 'ASCM_SERVER_ONLY', 'Use the configured cloud supervisor.');
      if (request.method !== 'POST') throw problem(405, 'ASCM_METHOD', 'Use a secure report request.');
      const supplied = request.headers.get('x-ppc-ascm-secret') || '';
      if (supplied.length > 512 || !await sameSecret(supplied, secret)) throw problem(401, 'ASCM_UNAUTHORIZED', 'The import credential was not accepted.');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw problem(415, 'ASCM_CONTENT_TYPE', 'Use a JSON report request.');
      const body = await readBody(request);
      if (!record(body) || Object.keys(body).length !== fields.size || Object.keys(body).some(key => !fields.has(key)) ||
          ['sender', 'subject', 'receivedAt', 'messageId', 'fileName'].some(key => typeof body[key] !== 'string' || !body[key] || body[key].length > (key === 'messageId' ? 1024 : 320))) {
        throw problem(400, 'ASCM_INVALID_REQUEST', 'Provide only the published report and its mail identity.');
      }
      let envelope;
      try { envelope = validateAscmEnvelope(body); } catch { throw problem(400, 'ASCM_SOURCE_REJECTED', 'This is not an eligible monthly ASCM release.'); }
      if (!Number.isFinite(Date.parse(body.receivedAt)) || Date.parse(body.receivedAt) > Date.parse(now()) + 5 * 60 * 1000) throw problem(400, 'ASCM_SOURCE_REJECTED', 'The report receipt time is invalid.');
      const bytes = decodeWorkbook(body.workbookBase64);
      const digest = await hash(bytes), requestId = `ascm-${digest}`;
      const fingerprint = await hash(encoder.encode(JSON.stringify({ version: 1, digest, reportDate: envelope.reportDate, publicationMonth: envelope.publicationMonth })));
      const rate = await database('rate', { bucket: await hash(encoder.encode(`${secret}\n${SESSION}`)), windowSeconds: 60, maximum: 30 });
      if (!rate?.allowed) throw problem(429, 'ASCM_RATE_LIMIT', 'Wait before retrying the report.');
      const identity = { sessionId: SESSION, requestId };
      const state = await database('read', identity);
      if (!record(state?.manifest) || !Number.isSafeInteger(state.storageRevision) || state.storageRevision < 1) throw unavailable();
      if (state.receipt) {
        if (state.receipt.fingerprint !== fingerprint) throw problem(409, 'ASCM_REPLAY_MISMATCH', 'This workbook was already accepted for another publication identity.');
        const result = acceptedResponse(state, requestId, fingerprint, true);
        // A commit may have succeeded before the first response/dispatch was
        // lost. The existing publisher is idempotent; recover that handoff.
        if (!result.archiveAllowed) await dispatchPublication().catch(() => false);
        return respond(result.archiveAllowed ? 200 : 202, result);
      }
      if (statusEnabled) {
        try {
          leaseId = globalThis.crypto.randomUUID();
          leaseStarted = (await reportStatus({ phase: 'begin', leaseId }))?.status === 'started';
        } catch { /* Activity is optional; the import still owns all safety gates. */ }
      }
      let dataset;
      try {
        dataset = await globalThis.ASCMImporter.parseAscmWorkbook(bytes, { strictDates: true, limits: { maxFileBytes: MAX_FILE,
          maxEntries: 256, maxEntryUncompressedBytes: 8 * 1024 * 1024, maxTotalUncompressedBytes: 16 * 1024 * 1024,
          maxXmlChars: 8 * 1024 * 1024, maxSheets: 16, maxRows: 10000, maxColumns: 512, maxHeaderRows: 200, maxSharedStrings: 50000 } });
      } catch { throw problem(400, 'ASCM_INVALID_WORKBOOK', 'The report could not be imported completely. Use manual review.'); }
      dataset.metadata.fileName = body.fileName;
      const plan = planAscmImport({ manifest: state.manifest, dataset, reportDate: envelope.reportDate,
        importedAt: now(), requestId, datePolicy: configuredDatePolicy(env.PPC_ASCM_DATE_POLICY) });
      validateManifest(plan.manifest);
      validateReadableManifest(plan.manifest);
      if (leaseStarted) await reportStatus({ phase: 'plan', leaseId, productCount: plan.savedProducts });
      const committed = await database('commit', { ...identity, expectedRevision: state.storageRevision, manifest: plan.manifest,
        fingerprint, changed: plan.changed, savedFields: plan.savedFields, savedProducts: plan.savedProducts });
      if (committed.status === 'raced') throw problem(409, 'ASCM_RETRY_REQUIRED', 'The master changed during import. Keep the email for a later attempt.');
      if (committed.status === 'request_mismatch') throw problem(409, 'ASCM_REPLAY_MISMATCH', 'The report identity needs owner review.');
      if (committed.status === 'manifest_too_large') throw problem(413, 'ASCM_MASTER_TOO_LARGE', 'The resulting master needs owner review.');
      if (!['saved', 'already_saved'].includes(committed.status)) throw unavailable();
      // Native commit replay returns the current revision. Only an independent
      // receipt read yields this report's immutable accepted revision.
      const accepted = await database('read', identity);
      const result = acceptedResponse(accepted, requestId, fingerprint, committed.status === 'already_saved');
      if (plan.changed && committed.status === 'saved' && !result.archiveAllowed) await dispatchPublication().catch(() => false);
      return respond(result.archiveAllowed ? 200 : 202, result);
    } catch (error) {
      const safe = error instanceof ApiError ? error : error instanceof AscmReviewError
        ? problem(409, 'ASCM_REVIEW_REQUIRED', 'The report needs owner review. No report changes were saved.') : unavailable();
      if (safe.status === 429) headers['Retry-After'] = '60';
      const reviewReason = error instanceof AscmReviewError && safe.status === 409 && safe.code === 'ASCM_REVIEW_REQUIRED'
        && ASCM_REVIEW_REASONS.includes(error.code) ? error.code : undefined;
      return respond(safe.status, { code: safe.code, error: safe.message, archiveAllowed: false,
        ...(reviewReason === undefined ? {} : { reviewReason }) });
    } finally {
      if (leaseStarted) await reportStatus({ phase: 'end', leaseId });
    }
  };
}
