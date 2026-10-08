import './shared/package-codec.js';
import './shared/master-model.js';

const codec = globalThis.PortfolioPackage;
const model = globalThis.PortfolioMasterModel;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const MAX_RPC_BYTES = 9 * 1024 * 1024;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const PUBLIC_OPERATIONS = new Set(['latest', 'save', 'presence']);
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
  return {
    requestedRevision, publishedRevision,
    status: publishedRevision >= requestedRevision ? 'current' : value?.status === 'error' ? 'error' : 'pending',
    error: value?.status === 'error' ? 'The GitHub package update is waiting to retry.' : '',
    githubSha: SHA_PATTERN.test(value?.githubSha || '') ? value.githubSha : '',
    publishedAt: typeof value?.publishedAt === 'string' ? value.publishedAt : null,
  };
}

function requireState(state) {
  if (!record(state?.manifest) || !Number.isSafeInteger(Number(state.storageRevision)) || Number(state.storageRevision) < 1) throw unavailable();
  return state;
}

export function publicSnapshot(state) {
  requireState(state);
  const masterSync = record(state.manifest.masterSync) ? clone(state.manifest.masterSync) : null;
  if (record(masterSync?.products)) for (const metadata of Object.values(masterSync.products)) {
    if (record(metadata)) delete metadata.archivedProduct;
  }
  return {
    ...model.snapshot(state.manifest), revision: `supabase:${state.storageRevision}`,
    storageRevision: Number(state.storageRevision), packageInfo: codec.normalizePackageInfo(state.manifest.packageInfo),
    masterSync,
    source: 'service', connectionMode: 'team', backend: 'supabase',
    canWrite: true, requiresEditorToken: false, requiresGitHubToken: false, namesAreSelfReported: true,
    publication: safePublication(state.publication),
  };
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
        method: 'POST', headers, body: JSON.stringify({ payload }), redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw unavailable(); }
      return await boundedJson(response, MAX_RPC_BYTES);
    } catch { throw unavailable(); }
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

  async function dispatchPublication() {
    const token = String(env.PPC_GITHUB_DISPATCH_TOKEN || '').trim();
    if (!token) return false;
    const owner = env.PPC_GITHUB_OWNER || 'monocraft', repo = env.PPC_GITHUB_REPO || 'PPC';
    const workflow = env.PPC_GITHUB_PUBLISH_WORKFLOW || 'publish-master.yml';
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || !/^[A-Za-z0-9_.-]+\.ya?ml$/.test(workflow)) return false;
    try {
      const result = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, body: JSON.stringify({ ref: 'main' }),
      });
      await result.body?.cancel().catch(() => {});
      return result.ok;
    } catch { return false; }
  }

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
        return { snapshot: publicSnapshot(state), savedFields: state.receipt.savedFields, savedProducts: state.receipt.savedProducts, alreadySaved: true, requestId: body.requestId };
      }
      let merged;
      try { merged = model.mergeChanges(state.manifest, body.changes, {
        actor: displayName || `Editor ${sessionId.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase()}`,
        team: 'Team', reason: body.reason || '', requestId: body.requestId, now: now(),
      }); }
      catch { throw problem(400, 'INVALID_CHANGE', 'These changes could not be saved. Check the product details and try again.'); }
      if (merged.conflicts.length) return { status: 409, code: 'MASTER_CONFLICT',
        error: 'The master changed while you were editing. Choose which values to keep.',
        conflicts: merged.conflicts, snapshot: publicSnapshot(state), requestId: body.requestId };
      const changed = merged.savedFields > 0;
      if (changed) {
        const previousInfo = codec.normalizePackageInfo(state.manifest.packageInfo);
        merged.manifest.packageInfo = codec.normalizePackageInfo({ version: 1, comments: previousInfo?.comments || '', updatedAt: now() });
        for (const entry of merged.history) entry.actorSource = 'self-reported';
      }
      if (encodedSize(merged.manifest) > MAX_MANIFEST_BYTES) throw problem(413, 'MASTER_TOO_LARGE', 'The updated master exceeds its data limit.');
      const committed = await database('commit', {
        expectedRevision: Number(state.storageRevision), manifest: merged.manifest,
        sessionId, requestId: body.requestId, fingerprint, changed,
        savedFields: merged.savedFields, savedProducts: merged.savedProducts,
      });
      if (committed.status === 'raced') { state = committed; continue; }
      if (committed.status === 'request_mismatch') throw problem(409, 'REQUEST_ID_MISMATCH', 'This save request was already used for different changes. Try saving again.');
      if (!['saved', 'already_saved'].includes(committed.status)) throw unavailable();
      const snapshot = publicSnapshot(committed);
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
      return { snapshot: publicSnapshot(await database('read', {})) };
    }
    const sessionId = String(body.sessionId || '');
    if (!SESSION_PATTERN.test(sessionId) || (body.displayName !== undefined && typeof body.displayName !== 'string') ||
        (body.productId !== undefined && typeof body.productId !== 'string') ||
        (body.categoryId !== undefined && typeof body.categoryId !== 'string')) throw problem(400, 'INVALID_REQUEST', 'The connected session is invalid.');
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
    });
    if (result.status === 'full') throw problem(429, 'PRESENCE_FULL', 'The connected session list is full. Try again shortly.');
    const sessions = (result.sessions || []).map((entry) => {
      const product = products.get(entry.productId);
      const currentCategoryId = product?.categoryId ?? (categories.has(entry.categoryId) ? entry.categoryId : '');
      return { ...entry, categoryId: currentCategoryId, categoryName: categories.get(currentCategoryId) || '', productName: product?.productName || '' };
    });
    return { ...result, users: sessions, sessions };
  }

  async function publisherOperation(operation, body) {
    if (operation === 'bootstrap') {
      validateManifest(body.manifest);
      const sourceSha = String(body.sourceSha || body.githubSha || '');
      if (!SHA_PATTERN.test(sourceSha)) throw problem(400, 'INVALID_REQUEST', 'The source package revision is invalid.');
      const fingerprint = await sha256(canonicalJson({ manifest: body.manifest, sourceSha }), cryptoImpl);
      const state = await database('bootstrap', { manifest: body.manifest, sourceSha, fingerprint });
      if (state.status === 'already_initialized') throw problem(409, 'ALREADY_INITIALIZED', 'The online master has already been initialized. It cannot be replaced by a new bootstrap.');
      return { ...state, publication: safePublication(state.publication) };
    }
    if (operation === 'export') {
      const state = requireState(await database('read', {}));
      return { manifest: state.manifest, storageRevision: Number(state.storageRevision), revision: Number(state.storageRevision),
        sourceSha: state.sourceSha, publication: safePublication(state.publication) };
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
        ? ['key', 'editorToken', 'sessionId', 'displayName', 'actor', 'team', 'requestId', 'changes', 'reason']
        : operation === 'presence' ? ['key', 'editorToken', 'sessionId', 'displayName', 'categoryId', 'productId', 'editing', 'leave']
        : operation === 'latest' ? ['key', 'editorToken', 'sessionId', 'displayName']
        : operation === 'bootstrap' ? ['publisherSecret', 'manifest', 'sourceSha', 'githubSha']
        : operation === 'export' ? ['publisherSecret']
        : operation === 'ack' ? ['publisherSecret', 'storageRevision', 'revision', 'githubSha']
        : ['publisherSecret', 'storageRevision', 'revision', 'message', 'safeMessage', 'code']);
      if (Object.keys(body).some((field) => !allowed.has(field))) throw problem(400, 'INVALID_REQUEST', 'The master request contains an unsupported field.');
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
