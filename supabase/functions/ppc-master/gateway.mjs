import './shared/package-codec.js';
import './shared/master-model.js';
import './shared/product-merge.js';
import { createAscmApi } from './ascm-api.mjs';
import { createPublicationDispatcher } from './publication-dispatch.mjs';
import { createAscmSharePointApi } from './ascm-sharepoint-api.mjs';
import { qualifiesSharePointPublication } from './package-delivery-contract.mjs';

const codec = globalThis.PortfolioPackage;
const model = globalThis.PortfolioMasterModel;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const MAX_RPC_BYTES = 9 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024 - 64 * 1024;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const PUBLIC_OPERATIONS = new Set(['latest', 'save', 'presence', 'review']);
const PRIVATE_OPERATIONS = new Set(['bootstrap', 'export', 'ack', 'failure']);
const record = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const clone = (value) => JSON.parse(JSON.stringify(value));
const encodedSize = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

export class MasterProblem extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const problem = (status, code, message) => new MasterProblem(status, code, message);
const unavailable = () => problem(503, 'MASTER_UNAVAILABLE', 'The shared master is unavailable. Your changes remain on this device.');

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function sha256(value, cryptoImpl = globalThis.crypto) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameSecret(left, right) {
  const a = new TextEncoder().encode(String(left || ''));
  const b = new TextEncoder().encode(String(right || ''));
  let different = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) different |= (a[index] || 0) ^ (b[index] || 0);
  return different === 0;
}

async function boundedJson(response, limit) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel().catch(() => {});
    throw problem(413, 'REQUEST_TOO_LARGE', 'This update is too large. Save fewer products at a time.');
  }
  const reader = response.body?.getReader();
  let text = '', size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  if (!reader) {
    text = await response.text();
    if (new TextEncoder().encode(text).length > limit) throw problem(413, 'REQUEST_TOO_LARGE', 'This update is too large.');
  } else {
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > limit) throw problem(413, 'REQUEST_TOO_LARGE', 'This update is too large. Save fewer products at a time.');
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  }
  try { return JSON.parse(text); } catch { throw problem(400, 'INVALID_REQUEST', 'The shared master request is invalid.'); }
}

function normalizedOrigins(value) {
  const origins = new Set(['https://monocraft.github.io']);
  for (const candidate of String(value || '').split(',').map((item) => item.trim()).filter(Boolean)) {
    let url;
    try { url = new URL(candidate); } catch { throw new Error('Invalid allowed master origin.'); }
    if (url.origin !== candidate || url.username || url.password ||
        !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new Error('Master origins must be exact HTTPS origins or loopback preview origins.');
    }
    origins.add(candidate);
  }
  return origins;
}

export function validateManifest(manifest) {
  if (!record(manifest) || ![1, 2, 3, 4].includes(manifest.version) || encodedSize(manifest) > MAX_MANIFEST_BYTES) {
    throw problem(400, 'INVALID_MANIFEST', 'The master package contains invalid portfolio information.');
  }
  const categories = manifest.version === 1 ? [{ id: '', board: manifest.board || manifest }] : manifest.categories;
  if (!Array.isArray(categories) || !categories.length || categories.length > 1000) throw problem(400, 'INVALID_MANIFEST', 'The master package contains invalid portfolios.');
  const categoryIds = new Set();
  let productCount = 0;
  for (const category of categories) {
    if (!record(category) || typeof category.id !== 'string' || category.id.length > 180 || (manifest.version !== 1 && !category.id) || categoryIds.has(category.id) ||
        !record(category.board) || !Array.isArray(category.board.lanes) || category.board.lanes.length > 2000 || !Array.isArray(category.board.products)) {
      throw problem(400, 'INVALID_MANIFEST', 'The master package contains invalid portfolios.');
    }
    productCount += category.board.products.length;
    if (productCount > 30000) throw problem(400, 'INVALID_MANIFEST', 'The master contains too many products.');
    categoryIds.add(category.id);
    const lanes = new Set();
    for (const lane of category.board.lanes) {
      if (!record(lane) || typeof lane.id !== 'string' || !lane.id || lanes.has(lane.id)) throw problem(400, 'INVALID_MANIFEST', 'The master package contains invalid product lanes.');
      lanes.add(lane.id);
    }
  }
  try { model.snapshot(manifest); codec.normalizePackageInfo(manifest.packageInfo); }
  catch { throw problem(400, 'INVALID_MANIFEST', 'The master package contains invalid product details.'); }
  if (manifest.imageAssets !== undefined && !Array.isArray(manifest.imageAssets)) throw problem(400, 'INVALID_MANIFEST', 'The master image library is invalid.');
  const assets = new Set();
  for (const asset of manifest.imageAssets || []) {
    if (!record(asset) || typeof asset.id !== 'string' || !asset.id || assets.has(asset.id) ||
        (asset.sourceType !== undefined && !['local', 'url'].includes(asset.sourceType))) {
      throw problem(400, 'INVALID_MANIFEST', 'The master image library is invalid.');
    }
    assets.add(asset.id);
  }
  if (manifest.imageAssets !== undefined) {
    for (const entry of model.entriesFromManifest(manifest)) {
      const references = [entry.product.imageAssetId, ...(entry.product.variantGroups || []).flatMap((group) => (group.items || []).map((item) => item.imageAssetId))].filter(Boolean);
      if (references.some((id) => !assets.has(id))) throw problem(400, 'INVALID_MANIFEST', 'A master product refers to a missing image.');
    }
  }
  return manifest;
}

function safePublication(value) {
  const requestedRevision = Number(value?.requestedRevision || 0), publishedRevision = Number(value?.publishedRevision || 0);
  if (['seeding', 'sharepoint'].includes(value?.deliveryPhase)) {
    const valid = value?.provider === 'sharepoint' && ['seed', 'publication'].includes(value.kind)
      && qualifiesSharePointPublication({ ...value, kind: 'publication' }, Math.max(1, Number(value.storageRevision)));
    return { requestedRevision, publishedRevision, deliveryPhase: value.deliveryPhase,
      status: valid && value.kind === 'publication' && publishedRevision >= requestedRevision && value.storageRevision >= requestedRevision ? 'current' : 'pending',
      error: value?.status === 'error' ? 'The encrypted package update is waiting to retry.' : '',
      ...(valid ? { provider: 'sharepoint', kind: value.kind, candidateId: value.candidateId, generation: value.generation,
        sha256: value.sha256, bytes: value.bytes, storageRevision: value.storageRevision, publishedAt: value.publishedAt } : {}) };
  }
  return {
    requestedRevision, publishedRevision,
    status: publishedRevision >= requestedRevision ? 'current' : value?.status === 'error' ? 'error' : 'pending',
    error: value?.status === 'error' ? 'The GitHub package update is waiting to retry.' : '',
    githubSha: SHA_PATTERN.test(value?.githubSha || '') ? value.githubSha : '',
    publishedAt: typeof value?.publishedAt === 'string' ? value.publishedAt : null,
  };
}

function safeAscmSupervisor(value, currentTime, lastUpdatedAt) {
  if (!record(value) || value.enabled !== true || typeof value.working !== 'boolean'
    || !(value.productCount === null || Number.isSafeInteger(value.productCount) && value.productCount >= 0 && value.productCount <= 500)) return null;
  const nowAt = Date.parse(currentTime);
  let lastUpdate = {};
  if (typeof lastUpdatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(lastUpdatedAt)) {
    const updatedAt = Date.parse(lastUpdatedAt);
    const canonical = lastUpdatedAt.includes('.') ? lastUpdatedAt : lastUpdatedAt.replace(/Z$/, '.000Z');
    if (Number.isFinite(updatedAt) && Number.isFinite(nowAt) && updatedAt <= nowAt && new Date(updatedAt).toISOString() === canonical) {
      lastUpdate = { lastUpdatedAt: canonical };
    }
  }
  const services = ['outlook', 'sharepoint'];
  const provided = value.reconnectRequired;
  const reconnectRequired = Array.isArray(provided) && provided.length <= 2 && provided.every(service => services.includes(service))
    && new Set(provided).size === provided.length ? services.filter(service => provided.includes(service)) : [];
  if (!value.working) return value.productCount === null && value.expiresAt === null
    ? { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired, ...lastUpdate } : null;
  if (typeof value.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expiresAt)) return null;
  const expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(expires) || !Number.isFinite(nowAt) || new Date(expires).toISOString() !== value.expiresAt || expires > nowAt + 121000) return null;
  if (expires <= nowAt) return { enabled: true, working: false, productCount: null, expiresAt: null, reconnectRequired, ...lastUpdate };
  return { enabled: true, working: true, productCount: value.productCount, expiresAt: value.expiresAt, reconnectRequired, ...lastUpdate };
}

function requireState(state) {
  if (!record(state?.manifest) || !Number.isSafeInteger(Number(state.storageRevision)) || Number(state.storageRevision) < 1) throw unavailable();
  return state;
}

export function publicSnapshot(state, snapshotFormat) {
  requireState(state);
  const masterSync = model.publicMetadata(state.manifest);
  const snapshot = {
    ...model.snapshot(state.manifest), revision: `supabase:${state.storageRevision}`,
    storageRevision: Number(state.storageRevision), packageInfo: model.latestPackageInfo(state.manifest),
    masterSync,
    source: 'service', connectionMode: 'team', backend: 'supabase',
    canWrite: true, requiresEditorToken: false, requiresGitHubToken: false, namesAreSelfReported: true,
    publication: safePublication(state.publication),
  };
  return ['compact-v1', 'compact-conflict-v1'].includes(snapshotFormat) ? model.compactSnapshot(snapshot) : snapshot;
}

export function requireReadableManifest(manifest) {
  const state = { manifest, storageRevision: Number.MAX_SAFE_INTEGER,
    publication: { requestedRevision: Number.MAX_SAFE_INTEGER, publishedRevision: 0, status: 'pending' } };
  const snapshot = publicSnapshot(state, 'compact-v1');
  if (snapshot.products.length > 30000 || encodedSize({ snapshot }) > MAX_SNAPSHOT_BYTES) {
    throw problem(413, 'MASTER_TOO_LARGE', 'The master exceeds its readable response limit. Export a backup and ask the portfolio owner to reduce retained data.');
  }
}

function revisionFrom(body) {
  const value = body.storageRevision ?? body.revision;
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) throw problem(400, 'INVALID_REQUEST', 'The publication revision is invalid.');
  return Number(value);
}

function serviceCredential(env) {
  let keys;
  try { keys = JSON.parse(env.SUPABASE_SECRET_KEYS || '{}'); } catch { throw new Error('Invalid private Supabase secret configuration.'); }
  return keys.default || env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function defaultRpc(env, fetchImpl) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const credential = serviceCredential(env);
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base) || !credential) throw new Error('Private master database connection is not configured.');
  return async (operation, payload = {}) => {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', apikey: credential };
    if (!credential.startsWith('sb_secret_')) headers.Authorization = `Bearer ${credential}`;
    let response;
    try {
      response = await fetchImpl(`${base}/rest/v1/rpc/ppc_master_${operation}`, {
        method: 'POST', headers, body: JSON.stringify({ payload }), redirect: 'error', signal: AbortSignal.timeout(['ascm_status', 'ascm_connection'].includes(operation) ? 2000 : 15000),
      });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw unavailable(); }
      return await boundedJson(response, operation === 'ascm_connection' ? 16 * 1024 : MAX_RPC_BYTES);
    } catch { throw unavailable(); }
  };
}

/** Private diagnostics only. Call after an actual authenticated connector result. */
export function createAscmConnectionReporter({ env = {}, fetchImpl = globalThis.fetch } = {}) {
  const enabled = env.PPC_ASCM_STATUS_ENABLED === 'true';
  let database;
  return async payload => {
    if (!enabled) return { reported: false };
    try {
      if (!record(payload) || Object.keys(payload).length !== 2 || Object.keys(payload).some(key => !['service', 'state'].includes(key))
        || !['outlook', 'sharepoint'].includes(payload.service) || !['available', 'reconnect_required'].includes(payload.state)) return { reported: false };
      database ||= defaultRpc(env, fetchImpl);
      const result = await database('ascm_connection', { service: payload.service, state: payload.state });
      return { reported: result?.reported === true };
    } catch { return { reported: false }; }
  };
}

export function createMasterGateway({ env = {}, rpc, fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), cryptoImpl = globalThis.crypto } = {}) {
  const packageHash = String(env.PPC_PACKAGE_KEY_HASH || '').trim();
  const publisherSecret = String(env.PPC_PUBLISHER_SECRET || '').trim();
  if (!HASH_PATTERN.test(packageHash) || publisherSecret.length < 32 || publisherSecret.length > 512 || /[\s\u0000-\u001f]/.test(publisherSecret)) {
    throw new Error('Configure private package-key verifier and publisher secret before starting the master gateway.');
  }
  const origins = normalizedOrigins(env.PPC_ALLOWED_ORIGINS);
  const database = rpc || defaultRpc(env, fetchImpl);

  async function enforceRate(request, operation, authenticated = false, sessionId = '') {
    // Supabase's proxy-provided address is used only for limiting attempts,
    // never for granting access. A shared NAT can still edit many products.
    const peer = (request.headers.get('x-forwarded-for') || request.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim().slice(0, 160);
    const bucket = await sha256(`${publisherSecret}\n${authenticated ? sessionId || peer : peer}\n${operation}`, cryptoImpl);
    const result = await database('rate', { bucket, windowSeconds: 60,
      maximum: authenticated ? operation === 'presence' ? 30 : 120 : operation === 'denied' ? 30 : 1500 });
    if (!result?.allowed) throw problem(429, 'RATE_LIMIT', 'Too many attempts. Wait a minute and try again. Your local changes are safe.');
  }

  const publicationDispatcher = createPublicationDispatcher({ env, fetchImpl });
  async function dispatchPublication() { return await publicationDispatcher.dispatch() === 'accepted'; }

  async function save(body, request) {
    const sessionId = String(body.sessionId || 'shared-editor');
    const displayName = String(body.displayName || body.actor || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
    if (!SESSION_PATTERN.test(sessionId) || !SESSION_PATTERN.test(body.requestId || '') || !Array.isArray(body.changes) || body.changes.length > 500 ||
        (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 2000))) {
      throw problem(400, 'INVALID_REQUEST', 'The master update is invalid.');
    }
    await enforceRate(request, 'save', true, sessionId);
    // A display-name change while a lost response is retried must not turn an
    // accepted edit into an unknown request. Identity is the session; names are
    // optional presentation metadata. Data and reason define the saved request.
    const fingerprint = await sha256(canonicalJson({ changes: body.changes, reason: body.reason || '' }), cryptoImpl);
    let state = await database('read', { sessionId, requestId: body.requestId });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      requireState(state);
      if (state.receipt) {
        if (!sameSecret(state.receipt.fingerprint, fingerprint)) throw problem(409, 'REQUEST_ID_MISMATCH', 'This save request was already used for different changes. Try saving again.');
        return { snapshot: publicSnapshot(state, body.snapshotFormat), savedFields: state.receipt.savedFields, savedProducts: state.receipt.savedProducts, alreadySaved: true, requestId: body.requestId };
      }
      let merged;
      try { merged = model.mergeChanges(state.manifest, body.changes, {
        actor: displayName || `Editor ${sessionId.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase()}`,
        actorSource: 'self-reported', team: 'Team', reason: body.reason || '', requestId: body.requestId, now: now(),
      }); }
      catch { throw problem(400, 'INVALID_CHANGE', 'These changes could not be saved. Check the product details and try again.'); }
      if (merged.conflicts.length) {
        const response = { status: 409, code: 'MASTER_CONFLICT',
          error: 'The master changed while you were editing. Choose which values to keep.',
          ...(body.snapshotFormat === 'compact-conflict-v1' ? { conflictPlan: model.conflictPlan(merged.conflicts) } : { conflicts: merged.conflicts }),
          snapshot: publicSnapshot(state, body.snapshotFormat), requestId: body.requestId };
        if (body.snapshotFormat === 'compact-conflict-v1' && encodedSize(response) > 16 * 1024 * 1024) throw problem(413, 'CONFLICT_TOO_LARGE', 'The complete conflict review exceeds its response limit. Your local draft is safe. Export a backup and ask the portfolio owner to reduce retained data.');
        return response;
      }
      const changed = merged.savedFields > 0;
      if (encodedSize(merged.manifest) > MAX_MANIFEST_BYTES) throw problem(413, 'MASTER_TOO_LARGE', 'The updated master exceeds its data limit.');
      if (changed) requireReadableManifest(merged.manifest);
      const committed = await database('commit', {
        expectedRevision: Number(state.storageRevision), manifest: merged.manifest,
        sessionId, requestId: body.requestId, fingerprint, changed,
        savedFields: merged.savedFields, savedProducts: merged.savedProducts,
      });
      if (committed.status === 'manifest_too_large') throw problem(413, 'MASTER_TOO_LARGE', 'The updated master exceeds its database data limit. Export a backup and ask the portfolio owner to reduce retained data.');
      if (committed.status === 'raced') { state = committed; continue; }
      if (committed.status === 'request_mismatch') throw problem(409, 'REQUEST_ID_MISMATCH', 'This save request was already used for different changes. Try saving again.');
      if (!['saved', 'already_saved'].includes(committed.status)) throw unavailable();
      const snapshot = publicSnapshot(committed, body.snapshotFormat);
      let dispatchAccepted = false;
      if (changed && snapshot.publication.status !== 'current') dispatchAccepted = await dispatchPublication();
      return { snapshot, savedFields: committed.savedFields, savedProducts: committed.savedProducts,
        alreadySaved: committed.status === 'already_saved', requestId: body.requestId, publicationQueued: snapshot.publication.status !== 'current', dispatchAccepted };
    }
    throw problem(503, 'MASTER_BUSY', 'The master is busy with team updates. Try saving again shortly. Your local changes are safe.');
  }

  async function publicOperation(operation, body, request) {
    let normalizedKey;
    try { normalizedKey = codec.normalizeKey(body.key); }
    catch { await enforceRate(request, 'denied'); throw problem(401, 'INVALID_KEY', 'The package key was not accepted.'); }
    const digest = await sha256(normalizedKey, cryptoImpl);
    if (!sameSecret(digest, packageHash)) { await enforceRate(request, 'denied'); throw problem(401, 'INVALID_KEY', 'The package key was not accepted.'); }
    if (operation === 'save') return await save(body, request);
    if (operation === 'latest') {
      await enforceRate(request, 'latest', true, SESSION_PATTERN.test(body.sessionId || '') ? body.sessionId : '');
      return { snapshot: publicSnapshot(await database('read', {}), body.snapshotFormat) };
    }
    if (operation === 'review') {
      if (![body.productId, body.sourceProductId].every((value) => typeof value === 'string' && value.length > 0 && value.length <= 180 && !/[\u0000-\u001f]/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value)) || body.productId === body.sourceProductId) throw problem(400, 'INVALID_REQUEST', 'Choose two different products to review.');
      await enforceRate(request, 'review', true, SESSION_PATTERN.test(body.sessionId || '') ? body.sessionId : '');
      const state = requireState(await database('read', {}));
      const entries = model.entriesFromManifest(state.manifest);
      const selected = [body.productId, body.sourceProductId].map((productId) => entries.find((entry) => entry.productId === productId));
      const available = selected.filter(Boolean);
      if (!available.length || (available.length === 2 && available[0].categoryId !== available[1].categoryId)) throw problem(409, 'MERGE_REVIEW_REQUIRED', 'These products changed. Review the current products before combining them.');
      const review = { snapshot: publicSnapshot(state, body.snapshotFormat), products: available.map((entry) => ({ product: entry.product, categoryId: entry.categoryId })) };
      if (encodedSize(review) > 20 * 1024 * 1024) throw problem(413, 'REVIEW_TOO_LARGE', 'These complete product details exceed the review response limit. Your local draft is safe. Export a backup and ask the portfolio owner to reduce retained data.');
      return review;
    }
    const sessionId = String(body.sessionId || '');
    if (typeof body.sessionId !== 'string' || !SESSION_PATTERN.test(sessionId) || (body.displayName !== undefined && typeof body.displayName !== 'string') ||
        (body.productId !== undefined && typeof body.productId !== 'string') ||
        (body.categoryId !== undefined && typeof body.categoryId !== 'string') ||
        (body.editing !== undefined && typeof body.editing !== 'boolean') || (body.leave !== undefined && typeof body.leave !== 'boolean') ||
        (body.receivePokes !== undefined && typeof body.receivePokes !== 'boolean') ||
        (body.activity !== undefined && !['browsing', 'editing', 'roadmap', 'focused', 'idle'].includes(body.activity)) ||
        (body.ackPokeIds !== undefined && (!Array.isArray(body.ackPokeIds) || body.ackPokeIds.length > 32 || body.ackPokeIds.some((id) => typeof id !== 'string' || !SESSION_PATTERN.test(id)))) ||
        (body.poke !== undefined && (!record(body.poke) || Object.keys(body.poke).some((name) => !['id', 'targetSessionId'].includes(name)) ||
          typeof body.poke.id !== 'string' || typeof body.poke.targetSessionId !== 'string' || !SESSION_PATTERN.test(body.poke.id) || !SESSION_PATTERN.test(body.poke.targetSessionId) || body.leave === true))) throw problem(400, 'INVALID_REQUEST', 'The connected session is invalid.');
    await enforceRate(request, 'presence', true, sessionId);
    const state = requireState(await database('read', {}));
    const products = new Map(model.entriesFromManifest(state.manifest).map((entry) => [entry.productId, entry]));
    const categories = new Map((state.manifest.categories || [{ id: '', name: state.manifest.name || 'Product portfolio' }])
      .map((entry) => [entry.id, String(entry.name || entry.id || 'Product portfolio').slice(0, 240)]));
    if (String(body.productId || '').length > 180) throw problem(400, 'INVALID_REQUEST', 'The selected product identity is invalid.');
    if (String(body.categoryId || '').length > 180) throw problem(400, 'INVALID_REQUEST', 'The selected category identity is invalid.');
    const selectedId = String(body.productId || '');
    // A newly created draft is not in the master until it saves. Its owner is
    // still connected and editing, so show generic activity until publication.
    const productId = products.has(selectedId) ? selectedId : '';
    const suppliedCategoryId = String(body.categoryId || '');
    const categoryId = products.get(productId)?.categoryId ?? (categories.has(suppliedCategoryId) ? suppliedCategoryId : '');
    const result = await database('presence', {
      sessionId, displayName: String(body.displayName || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60),
      categoryId, productId, editing: body.editing === true, leave: body.leave === true,
      ...(env.PPC_ASCM_STATUS_ENABLED === 'true' ? { includeAscmSupervisor: true } : {}),
      ...(body.activity !== undefined ? { activity: body.editing === true ? 'editing' : body.activity === 'editing' ? 'browsing' : body.activity } : {}),
      ...(body.receivePokes !== undefined ? { receivePokes: body.receivePokes } : {}),
      ...(body.poke !== undefined ? { poke: { id: body.poke.id, targetSessionId: body.poke.targetSessionId } } : {}),
      ...(body.ackPokeIds !== undefined ? { ackPokeIds: body.ackPokeIds } : {}),
    });
    if (result.status === 'full') throw problem(429, 'PRESENCE_FULL', 'The connected session list is full. Try again shortly.');
    const sessions = (result.sessions || []).map((entry) => {
      const product = products.get(entry.productId);
      const currentCategoryId = product?.categoryId ?? (categories.has(entry.categoryId) ? entry.categoryId : '');
      return { ...entry, categoryId: currentCategoryId, categoryName: categories.get(currentCategoryId) || '', productName: product?.productName || '' };
    });
    const { ascmSupervisor: rawSupervisor, ...presenceResult } = result;
    const ascmSupervisor = env.PPC_ASCM_STATUS_ENABLED === 'true'
      ? safeAscmSupervisor(rawSupervisor, now(), record(state.manifest.ascmSnapshot) ? state.manifest.ascmSnapshot.importedAt : undefined) : null;
    return { ...presenceResult, users: sessions, sessions, ...(ascmSupervisor ? { ascmSupervisor } : {}) };
  }

  async function publisherOperation(operation, body) {
    if (operation === 'bootstrap') {
      validateManifest(body.manifest);
      requireReadableManifest(body.manifest);
      const sourceSha = String(body.sourceSha || body.githubSha || '');
      if (!SHA_PATTERN.test(sourceSha)) throw problem(400, 'INVALID_REQUEST', 'The source package revision is invalid.');
      const fingerprint = await sha256(canonicalJson({ manifest: body.manifest, sourceSha }), cryptoImpl);
      const state = await database('bootstrap', { manifest: body.manifest, sourceSha, fingerprint });
      if (state.status === 'manifest_too_large') throw problem(413, 'MASTER_TOO_LARGE', 'The master exceeds its database data limit. Export a backup and reduce retained data before initialization.');
      if (state.status === 'already_initialized') throw problem(409, 'ALREADY_INITIALIZED', 'The online master has already been initialized. It cannot be replaced by a new bootstrap.');
      return { ...state, publication: safePublication(state.publication) };
    }
    if (operation === 'export') {
      const state = requireState(await database('read', {}));
      return { manifest: state.manifest, storageRevision: Number(state.storageRevision), revision: Number(state.storageRevision),
        sourceSha: state.sourceSha, ...(HASH_PATTERN.test(state.acceptedManifestSha256 || '') ? { acceptedManifestSha256: state.acceptedManifestSha256 } : {}), publication: safePublication(state.publication) };
    }
    const storageRevision = revisionFrom(body);
    if (operation === 'ack' && !SHA_PATTERN.test(String(body.githubSha || ''))) throw problem(400, 'INVALID_REQUEST', 'The published GitHub revision is invalid.');
    const state = operation === 'ack'
      ? await database('ack', { storageRevision, githubSha: String(body.githubSha || '') })
      : await database('failure', { storageRevision });
    if (state.status === 'invalid_revision' || state.status === 'stale_revision') throw problem(409, 'INVALID_REVISION', 'The publication receipt has an invalid revision.');
    requireState(state);
    return { storageRevision: Number(state.storageRevision), revision: Number(state.storageRevision), publication: safePublication(state.publication), status: state.status };
  }

  const ascmApi = createAscmApi({ env, database, now, dispatchPublication, validateManifest, validateReadableManifest: requireReadableManifest });
  const ascmSharePointApi = createAscmSharePointApi({ env, database, now, dispatchPublication, validateManifest, validateReadableManifest: requireReadableManifest });
  return async function handle(request) {
    const origin = request.headers.get('origin') || '';
    const headers = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin',
    };
    const respond = (status, value) => new Response(JSON.stringify(value), { status, headers });
    try {
      const path = new URL(request.url).pathname;
      const operation = /\/api\/master\/([a-z]+)\/?$/.exec(path)?.[1];
      if (operation === 'ascm') return await ascmApi(request);
      if (operation === 'ascmsharepoint') return await ascmSharePointApi(request);
      if (!PUBLIC_OPERATIONS.has(operation) && !PRIVATE_OPERATIONS.has(operation)) throw problem(404, 'NOT_FOUND', 'This master action is unavailable.');
      if (origin && !origins.has(origin)) throw problem(403, 'ORIGIN_DENIED', 'This portfolio address is not allowed to connect.');
      if (origin) headers['Access-Control-Allow-Origin'] = origin;
      if (request.method === 'OPTIONS') {
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type, X-PPC-Publisher-Secret';
        headers['Access-Control-Max-Age'] = '600';
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== 'POST') throw problem(405, 'METHOD_NOT_ALLOWED', 'Use a secure master request.');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw problem(415, 'INVALID_REQUEST', 'Use a JSON master request.');
      await enforceRate(request, 'attempt');
      const body = await boundedJson(request, MAX_REQUEST_BYTES);
      if (!record(body)) throw problem(400, 'INVALID_REQUEST', 'The master request is invalid.');
      const allowed = new Set(operation === 'save'
        ? ['key', 'editorToken', 'sessionId', 'displayName', 'actor', 'team', 'requestId', 'changes', 'reason', 'snapshotFormat']
        : operation === 'presence' ? ['key', 'editorToken', 'sessionId', 'displayName', 'categoryId', 'productId', 'editing', 'leave', 'activity', 'receivePokes', 'poke', 'ackPokeIds']
        : operation === 'latest' ? ['key', 'editorToken', 'sessionId', 'displayName', 'snapshotFormat']
        : operation === 'review' ? ['key', 'editorToken', 'sessionId', 'productId', 'sourceProductId', 'snapshotFormat']
        : operation === 'bootstrap' ? ['publisherSecret', 'manifest', 'sourceSha', 'githubSha']
        : operation === 'export' ? ['publisherSecret']
        : operation === 'ack' ? ['publisherSecret', 'storageRevision', 'revision', 'githubSha']
        : ['publisherSecret', 'storageRevision', 'revision', 'message', 'safeMessage', 'code']);
      if (Object.keys(body).some((field) => !allowed.has(field))) throw problem(400, 'INVALID_REQUEST', 'The master request contains an unsupported field.');
      if (body.snapshotFormat !== undefined && !['compact-v1', 'compact-conflict-v1'].includes(body.snapshotFormat)) throw problem(400, 'INVALID_REQUEST', 'The snapshot format is unsupported.');
      let result;
      if (PRIVATE_OPERATIONS.has(operation)) {
        const secret = request.headers.get('x-ppc-publisher-secret') || body.publisherSecret || '';
        if (typeof secret !== 'string' || !sameSecret(secret, publisherSecret)) { await enforceRate(request, 'denied'); throw problem(401, 'PUBLISHER_UNAUTHORIZED', 'The publisher credential was not accepted.'); }
        result = await publisherOperation(operation, body);
      } else result = await publicOperation(operation, body, request);
      const status = result.status === 409 ? 409 : 200;
      if (typeof result.status === 'number') delete result.status;
      return respond(status, result);
    } catch (error) {
      const safe = error instanceof MasterProblem ? error : unavailable();
      if (safe.status === 429) headers['Retry-After'] = '60';
      return respond(safe.status, { code: safe.code, error: safe.message });
    }
  };
}
