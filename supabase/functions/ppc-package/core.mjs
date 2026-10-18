import '../ppc-master/shared/package-codec.js';
import { createHash } from 'node:crypto';
import { MAX_PACKAGE_BYTES, validateCandidate, validateReceipt } from '../ppc-master/package-delivery-contract.mjs';
import { verifiedCiphertextStream, verifyCiphertext } from './hash.mjs';
import { createPackageDeliveryRpc } from './rpc.mjs';
import { createPackageDeliveryStorage } from './storage.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const strict = (value, fields) => record(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const digest = value => createHash('sha256').update(value).digest('hex');
export class PackageDeliveryError extends Error {
  constructor(status, code = 'PACKAGE_UNAVAILABLE') { super('The encrypted package could not be confirmed.'); this.status = status; this.code = code; }
}
const fail = (status = 503, code) => new PackageDeliveryError(status, code);
const identity = value => value && ({ provider: 'sharepoint', kind: value.kind, generation: value.generation,
  candidateId: value.candidateId, sha256: value.sha256, bytes: value.bytes, storageRevision: value.storageRevision, publishedAt: value.publishedAt });
const safeText = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
const sameId = (value, input) => value?.candidateId === input.candidateId && value?.generation === input.generation;
const filename = candidate => candidate.kind === 'seed' ? 'master_ppc.pkg' : `master-r${candidate.storageRevision}-g${candidate.generation}-${candidate.candidateId}.pkg`;
export function createPackageDelivery({ env = {}, database, storage, now = () => new Date().toISOString(), fetchImpl = globalThis.fetch } = {}) {
  const enabled = env.PPC_PACKAGE_DELIVERY_ENABLED === 'true';
  let db = database, objects = storage;
  const requireEnabled = () => { if (!enabled) throw fail(404, 'NOT_FOUND'); };
  const databaseCall = (operation, payload = {}) => { requireEnabled(); db ||= createPackageDeliveryRpc({ env, fetchImpl }); return db(operation, payload); };
  const objectStore = () => { requireEnabled(); objects ||= createPackageDeliveryStorage({ env, fetchImpl }); return objects; };
  const read = () => databaseCall('current');
  function policy(state) {
    if (!['seeding', 'sharepoint'].includes(state?.phase) || state.policy?.provider !== 'sharepoint' || state.policy.host !== 'hp.sharepoint.com'
      || !safeText(env.PPC_PACKAGE_SP_DRIVE_ID) || !safeText(env.PPC_PACKAGE_SP_FOLDER_ID)
      || state.policy.driveId !== env.PPC_PACKAGE_SP_DRIVE_ID || state.policy.folderId !== env.PPC_PACKAGE_SP_FOLDER_ID) throw fail();
    return state.policy;
  }
  function candidate(value) { try { return validateCandidate(value); } catch { throw fail(409, 'PACKAGE_STATE_INVALID'); } }
  function matchingCurrent(state) {
    policy(state); const current = candidate(state.current), receipt = state.publication;
    if (current.status !== 'published' || receipt?.provider !== 'sharepoint' || !sameId(receipt, current)
      || ['kind', 'storageRevision', 'sha256', 'bytes'].some(key => receipt[key] !== current[key]) || !Number.isFinite(Date.parse(receipt.publishedAt))) throw fail(409, 'PACKAGE_NOT_PUBLISHED');
    return current;
  }
  async function cleanup(state) {
    // A lease timeout or missing read never proves a writer has settled.
    if (!state?.cleanup || !['none', 'stored', 'absent'].includes(state.cleanupUpload?.state)) return;
    const previous = candidate(state.cleanup);
    try {
      const removed = await objectStore().removeObject(previous);
      if (removed?.absent === true) await databaseCall('cleanup', { candidateId: previous.candidateId, generation: previous.generation, absent: true });
    } catch { /* Keep the recorded slot; the next real operation can retry. */ }
  }
  function candidateInput(input) {
    if (!strict(input, ['candidateId', 'generation']) || !UUID.test(input.candidateId) || !Number.isSafeInteger(input.generation) || input.generation < 1) throw fail(400, 'INVALID_REQUEST');
    return input;
  }
  async function publisher(operation, payload = {}) {
    requireEnabled();
    if (operation === 'current') {
      if (!strict(payload, [])) throw fail(400, 'INVALID_REQUEST');
      const state = await read(); policy(state); await cleanup(state);
      return { phase: state.phase, current: state.current, queued: state.queued,
        ...(state.current ? { downloadUrl: await objectStore().signDownload(matchingCurrent(state)) } : {}) };
    }
    if (operation === 'reserve' || operation === 'seed') {
      const fields = ['candidateId', 'expectedGeneration', 'storageRevision', 'sourceSha', 'manifestSha256', 'ownerImagesCommit', 'sha256', 'bytes', ...(operation === 'seed' ? ['trustedGithubSha'] : [])];
      if (!strict(payload, fields)) throw fail(400, 'INVALID_REQUEST');
      const state = await read(); policy(state);
      if ((operation === 'seed') !== (state.phase === 'seeding' && !state.current)) throw fail(409, 'PACKAGE_PHASE');
      await cleanup(state);
      const result = await databaseCall('reserve', payload);
      if (!['reserved', 'existing'].includes(result?.status)) throw fail(409, 'PACKAGE_RESERVATION_HELD');
      return { status: result.status, candidate: candidate(result.candidate) };
    }
    if (operation === 'finalize') {
      candidateInput(payload); const state = await read(); policy(state); await cleanup(state);
      const value = candidate(state.queued);
      if (!sameId(value, payload) || !['reserved', 'ready'].includes(value.status) || Date.parse(value.expiresAt) <= Date.parse(now())) throw fail(409, 'PACKAGE_STALE');
      if (!sameId(state.upload, value) || !['stored', 'uncertain', 'uploading'].includes(state.upload.state) || !safeText(state.upload.attemptId)) throw fail(409, 'PACKAGE_UPLOAD_UNSETTLED');
      const opened = await objectStore().openObject(value);
      const actual = await verifyCiphertext(opened.body, value, { signal: AbortSignal.timeout(120_000) });
      if (state.upload.state !== 'stored') {
        const settled = await databaseCall('upload_result', { ...payload, attemptId: state.upload.attemptId, outcome: 'stored' });
        if (settled?.status !== 'stored') throw fail(409, 'PACKAGE_UPLOAD_UNSETTLED');
      }
      const result = await databaseCall('finalize', { ...payload, sha256: actual.sha256, bytes: actual.bytes, envelopeValid: true });
      if (result?.status !== 'ready') throw fail(409, 'PACKAGE_STALE');
      return { status: result.status, candidate: candidate(result.candidate) };
    }
    throw fail(404, 'NOT_FOUND');
  }
  async function upload(request, candidateId) {
    requireEnabled();
    const generation = request.headers.get('x-ppc-candidate-generation'), length = request.headers.get('content-length');
    if (!UUID.test(candidateId) || !/^[1-9]\d*$/.test(generation || '') || !Number.isSafeInteger(Number(generation))
      || !/^[1-9]\d*$/.test(length || '') || Number(length) < 36 || Number(length) > MAX_PACKAGE_BYTES
      || request.headers.get('content-type') !== 'application/octet-stream' || !request.body) throw fail(400, 'INVALID_BINARY_REQUEST');
    const input = { candidateId, generation: Number(generation) };
    const claim = await databaseCall('upload_claim', input);
    if (claim?.status !== 'claimed') throw fail(409, 'PACKAGE_UPLOAD_HELD');
    const value = candidate(claim.candidate);
    if (!sameId(value, input) || value.bytes !== Number(length) || !safeText(claim.attemptId)) {
      // No Storage request was opened, so this attempt cannot leave a late object.
      await databaseCall('upload_result', { ...input, attemptId: claim.attemptId, outcome: 'absent' });
      throw fail(409, 'PACKAGE_UPLOAD_MISMATCH');
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]);
    let verified = false;
    try {
      const body = verifiedCiphertextStream(request.body, value, { signal, onVerified: () => { verified = true; } });
      await objectStore().uploadObject(value, body, { signal });
      if (!verified) throw fail();
      const result = await databaseCall('upload_result', { ...input, attemptId: claim.attemptId, outcome: 'stored' });
      if (result?.status !== 'stored') throw fail(409, 'PACKAGE_UPLOAD_UNSETTLED');
      return { status: 'stored', candidateId, generation: value.generation };
    } catch (error) {
      // A failed HTTP call can still complete remotely. Never infer absence.
      await databaseCall('upload_result', { ...input, attemptId: claim.attemptId, outcome: 'uncertain' }).catch(() => {});
      throw error instanceof PackageDeliveryError ? error : fail();
    }
  }
  async function getQueuedPublication() {
    requireEnabled(); const state = await read(); const destination = policy(state); await cleanup(state);
    if (!state.queued || state.queued.status !== 'ready' || Date.parse(state.queued.expiresAt) <= Date.parse(now())) return { candidate: null };
    const value = candidate(state.queued);
    return { candidate: { candidateId: value.candidateId, generation: value.generation, storageRevision: value.storageRevision,
      sha256: value.sha256, bytes: value.bytes, expiresAt: value.expiresAt, fileName: filename(value), provider: 'sharepoint', driveId: destination.driveId, folderId: destination.folderId },
    downloadUrl: await objectStore().signDownload(value) };
  }
  async function getQueuedPublicationMetadata() {
    requireEnabled(); const state = await read(); const destination = policy(state);
    if (!state.queued || state.queued.status !== 'ready' || Date.parse(state.queued.expiresAt) <= Date.parse(now())) return { phase: state.phase, candidate: null };
    const value = candidate(state.queued);
    return { phase: state.phase, candidate: { candidateId: value.candidateId, generation: value.generation, storageRevision: value.storageRevision,
      sha256: value.sha256, bytes: value.bytes, expiresAt: value.expiresAt, fileName: filename(value), provider: 'sharepoint', driveId: destination.driveId, folderId: destination.folderId } };
  }
  async function openQueuedPublication(input, { signal } = {}) {
    requireEnabled(); candidateInput(input);
    const state = await read(); policy(state);
    const value = candidate(state.queued);
    if (!sameId(value, input) || value.status !== 'ready' || Date.parse(value.expiresAt) <= Date.parse(now())) throw fail(409, 'PACKAGE_STALE');
    const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
    const opened = await objectStore().openObject(value, { signal: bounded });
    const declared = opened.headers.get('content-length');
    if (!opened.ok || !opened.body || declared !== null && declared !== String(value.bytes)) { await opened.body?.cancel().catch(() => {}); throw fail(); }
    return new Response(verifiedCiphertextStream(opened.body, value, { signal: bounded }), { headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(value.bytes), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'X-PPC-Package-SHA256': value.sha256, 'X-PPC-Package-Generation': String(value.generation), 'X-PPC-Package-Candidate-Id': value.candidateId,
    } });
  }
  async function confirmPublication(input) {
    requireEnabled();
    if (!strict(input, ['candidateId', 'generation', 'item', 'verified'])) throw fail(400, 'INVALID_REQUEST');
    candidateInput({ candidateId: input.candidateId, generation: input.generation });
    const state = await read(); const destination = policy(state);
    const active = sameId(state.queued, input) ? state.queued : sameId(state.current, input) ? state.current : null;
    const value = active ? candidate(active) : null;
    if (!strict(input.verified, ['sha256', 'bytes']) || !/^[a-f0-9]{64}$/.test(input.verified.sha256 || '')
      || !Number.isSafeInteger(input.verified.bytes) || input.verified.bytes < 36 || input.verified.bytes > MAX_PACKAGE_BYTES
      || !strict(input.item, ['driveId', 'folderId', 'itemId', 'versionId', 'fileName']) || Object.values(input.item).some(v => !safeText(v))
      || input.item.driveId !== destination.driveId || input.item.folderId !== destination.folderId) throw fail(409, 'PACKAGE_READBACK_MISMATCH');
    const receipt = { provider: 'sharepoint', candidateId: input.candidateId, generation: input.generation,
      sha256: input.verified.sha256, bytes: input.verified.bytes, ...input.item, confirmedAt: now() };
    if (value) {
      if (input.verified.sha256 !== value.sha256 || input.verified.bytes !== value.bytes || input.item.fileName !== filename(value)) throw fail(409, 'PACKAGE_READBACK_MISMATCH');
      receipt.kind = value.kind; receipt.storageRevision = value.storageRevision;
      try { validateReceipt(receipt, destination); } catch { throw fail(400, 'INVALID_RECEIPT'); }
    } else {
      // A later generation may already be current. Preserve exact lost-confirm
      // retries without exporting historical records or inferring seed revision.
      // SQL fills ONLY these two omitted fields from an immutable existing
      // receipt before exact comparison. Never-published candidates stay stale.
      const normal = /^master-r([1-9]\d*)-g([1-9]\d*)-([a-f0-9-]{36})\.pkg$/.exec(input.item.fileName);
      const seed = input.item.fileName === 'master_ppc.pkg' && input.item.versionId === '4.0';
      if (Object.values(input.item).some(v => v.length > 512 || v.trim() !== v)
        || !seed && (!normal || !Number.isSafeInteger(Number(normal[1])) || String(input.generation) !== normal[2] || input.candidateId !== normal[3])) throw fail(400, 'INVALID_RECEIPT');
    }
    const result = await databaseCall('confirm', { candidateId: input.candidateId, generation: input.generation, receipt });
    if (!(value ? ['published', 'already_published'].includes(result?.status) : result?.status === 'already_published')) throw fail(409, 'PACKAGE_STALE');
    await cleanup(await read());
    return { status: result.status, publication: identity(result.publication) };
  }
  async function reader(request) {
    requireEnabled(); const body = await boundedJson(request, 32 * 1024);
    if (!strict(body, ['key']) || typeof body.key !== 'string' || body.key.length > 128) throw fail(400, 'INVALID_REQUEST');
    const peer = (request.headers.get('x-forwarded-for') || request.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim().slice(0, 160);
    const rate = await databaseCall('rate', { bucket: digest(`${env.PPC_PUBLISHER_SECRET || ''}\n${peer}\npackage_latest`), windowSeconds: 60, maximum: 30 });
    if (!rate?.allowed) throw fail(429, 'RATE_LIMIT');
    let normalized; try { normalized = globalThis.PortfolioPackage.normalizeKey(body.key); } catch { throw fail(401, 'INVALID_PACKAGE_KEY'); }
    if (!/^[a-f0-9]{64}$/.test(env.PPC_PACKAGE_KEY_HASH || '') || digest(normalized) !== env.PPC_PACKAGE_KEY_HASH) throw fail(401, 'INVALID_PACKAGE_KEY');
    const state = await read(); const current = matchingCurrent(state); await cleanup(state);
    const opened = await objectStore().openObject(current, { signal: request.signal });
    return new Response(verifiedCiphertextStream(opened.body, current, { signal: request.signal }), { headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(current.bytes), 'Cache-Control': 'no-store',
      'X-PPC-Package-SHA256': current.sha256, 'X-PPC-Package-Generation': String(current.generation), 'X-PPC-Package-Candidate-Id': current.candidateId, 'X-PPC-Package-Revision': String(current.storageRevision),
    } });
  }
  async function publicState() { requireEnabled(); const state = await read(); matchingCurrent(state); return identity(state.publication); }
  return Object.freeze({ enabled, publisher, upload, getQueuedPublication, getQueuedPublicationMetadata, openQueuedPublication, confirmPublication, reader, publicState });
}

export async function boundedJson(request, maximum = 32 * 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw fail(415, 'CONTENT_TYPE');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw fail(413, 'REQUEST_TOO_LARGE');
  const reader = request.body?.getReader(); if (!reader) throw fail(400, 'INVALID_REQUEST');
  const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '', size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maximum) throw fail(413, 'REQUEST_TOO_LARGE'); text += decoder.decode(part.value, { stream: true }); }
    try { return JSON.parse(text + decoder.decode()); } catch { throw fail(400, 'INVALID_REQUEST'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
