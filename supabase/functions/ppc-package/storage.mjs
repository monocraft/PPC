import { MAX_PACKAGE_BYTES } from '../ppc-master/package-delivery-contract.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const BUCKET = 'ppc-package-delivery';
const unavailable = () => new Error('Encrypted package storage is unavailable.');

// Official REST contract: POST /object/{bucket}/{path} creates; PUT updates.
// Binary streams are supported. x-upsert:false preserves create-only behavior.
// https://supabase.github.io/storage/ and https://supabase.com/docs/guides/storage/uploads/standard-uploads
export function createPackageDeliveryStorage({ env = {}, fetchImpl = globalThis.fetch } = {}) {
  const base = env.SUPABASE_URL;
  let keys; try { keys = JSON.parse(env.SUPABASE_SECRET_KEYS || '{}'); } catch { throw unavailable(); }
  const credential = keys.default || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base || '') || !credential) throw unavailable();
  // Secret keys are not JWTs. Follow the same apikey-only rule as the RPC
  // adapter; legacy service-role JWTs additionally use Authorization.
  // https://supabase.com/docs/guides/getting-started/api-keys
  const headers = { apikey: credential };
  if (!credential.startsWith('sb_secret_')) headers.Authorization = `Bearer ${credential}`;
  const path = candidate => {
    if (!UUID.test(candidate?.candidateId || '') || candidate.objectKey !== `packages/${candidate.candidateId}.pkg`
      || !Number.isSafeInteger(candidate.bytes) || candidate.bytes < 36 || candidate.bytes > MAX_PACKAGE_BYTES) throw unavailable();
    return `${BUCKET}/${candidate.objectKey}`;
  };
  const transport = async (target, options = {}, signal) => {
    const deadline = AbortSignal.timeout(120_000);
    try {
      const response = await fetchImpl(`${base}/storage/v1${target}`, { ...options,
        headers: { ...headers, ...options.headers }, redirect: 'error', credentials: 'omit', cache: 'no-store',
        signal: signal ? AbortSignal.any([deadline, signal]) : deadline });
      if (response.redirected || response.status >= 300 && response.status < 400) { await response.body?.cancel().catch(() => {}); throw unavailable(); }
      return response;
    } catch { throw unavailable(); }
  };
  async function smallJson(response) {
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw unavailable(); }
    const reader = response.body?.getReader(); if (!reader) throw unavailable();
    const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '', bytes = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 16 * 1024) throw unavailable(); text += decoder.decode(part.value, { stream: true }); }
      return JSON.parse(text + decoder.decode());
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function uploadObject(candidate, stream, { signal } = {}) {
    const object = path(candidate);
    if (!(stream instanceof ReadableStream)) throw unavailable();
    const response = await transport(`/object/${object}`, { method: 'POST', headers: {
      'content-type': 'application/octet-stream', 'content-length': String(candidate.bytes), 'cache-control': 'no-store', 'x-upsert': 'false',
    }, body: stream, duplex: 'half' }, signal);
    await smallJson(response); return { stored: true };
  }
  async function openObject(candidate, { signal } = {}) {
    const object = path(candidate); const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let reader, closed = false;
    const close = () => { if (!closed) { closed = true; clearTimeout(timer); combined.removeEventListener('abort', abort); } };
    let streamController;
    const abort = () => { if (!closed) { close(); streamController?.error(unavailable()); void reader?.cancel().catch(() => {}); } };
    try {
      const response = await transport(`/object/authenticated/${object}`, { method: 'GET', headers: { Accept: 'application/octet-stream' } }, combined);
      const declared = response.headers.get('content-length');
      if (!response.ok || !response.body || declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== candidate.bytes)) {
        await response.body?.cancel().catch(() => {}); throw unavailable();
      }
      reader = response.body.getReader(); let bytes = 0;
      const body = new ReadableStream({
        start(controller) { streamController = controller; combined.addEventListener('abort', abort, { once: true }); if (combined.aborted) abort(); },
        async pull(controller) {
          if (closed) return;
          try {
            const part = await reader.read(); if (closed) return;
            if (part.done) { if (bytes !== candidate.bytes) throw unavailable(); close(); reader.releaseLock(); controller.close(); }
            else { bytes += part.value.byteLength; if (bytes > candidate.bytes || bytes > MAX_PACKAGE_BYTES) throw unavailable(); controller.enqueue(part.value); }
          } catch { if (!closed) { close(); await reader.cancel().catch(() => {}); reader.releaseLock(); controller.error(unavailable()); } }
        },
        async cancel(reason) { close(); controller.abort(); await reader.cancel(reason).catch(() => {}); reader.releaseLock(); },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(candidate.bytes) } });
    } catch { close(); controller.abort(); throw unavailable(); }
  }
  async function signDownload(candidate) {
    const object = path(candidate);
    const value = await smallJson(await transport(`/object/sign/${object}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 300 }) }));
    const raw = value?.signedURL;
    if (typeof raw !== 'string' || !raw.startsWith(`/object/sign/${object}?`) || raw.length > 16 * 1024 || raw.includes('#') || raw.includes('\\')) throw unavailable();
    const url = new URL(`${base}/storage/v1${raw}`);
    if (url.origin !== base || url.pathname !== `/storage/v1/object/sign/${object}` || url.searchParams.getAll('token').length !== 1 || !url.searchParams.get('token')) throw unavailable();
    return url.href;
  }
  async function exactMissing(response, phase) {
    if (response.status === 404) { await response.body?.cancel().catch(() => {}); return true; }
    if (response.status !== 400) { await response.body?.cancel().catch(() => {}); return false; }
    const diagnostic = { event: 'package_storage_missing_shape', phase,
      contentTypeJson: /^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') || ''),
      body: 'not_read', keys: [], unknownKeys: false,
      statusCode: 'absent', code: 'absent', error: 'absent', message: 'absent' };
    const emit = () => { try { console.error(JSON.stringify(diagnostic)); } catch {} };
    if (!diagnostic.contentTypeJson) {
      emit();
      await response.body?.cancel().catch(() => {}); return false;
    }
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^(?:0|[1-9]\d*)$/.test(declared) || Number(declared) > 2048)) {
      diagnostic.body = 'oversize'; emit();
      await response.body?.cancel().catch(() => {}); return false;
    }
    const reader = response.body?.getReader(); if (!reader) { diagnostic.body = 'unavailable'; emit(); return false; }
    const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '', size = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength; if (size > 2048) { diagnostic.body = 'oversize'; return false; }
        text += decoder.decode(part.value, { stream: true });
      }
      const value = JSON.parse(text + decoder.decode());
      diagnostic.body = 'parsed';
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const known = new Set(['statusCode', 'code', 'error', 'message', 'httpStatusCode', 'userStatusCode', 'resource', 'metadata']);
        diagnostic.keys = Object.keys(value).filter(key => known.has(key)).sort();
        diagnostic.unknownKeys = Object.keys(value).some(key => !known.has(key));
        diagnostic.statusCode = !Object.hasOwn(value, 'statusCode') ? 'absent'
          : value.statusCode === '404' ? 'string404' : value.statusCode === 404 ? 'numeric404' : 'other';
        diagnostic.code = !Object.hasOwn(value, 'code') ? 'absent' : value.code === 'NoSuchKey' ? 'NoSuchKey' : 'other';
        diagnostic.error = !Object.hasOwn(value, 'error') ? 'absent'
          : value.error === 'NoSuchKey' ? 'NoSuchKey' : value.error === 'not_found' ? 'not_found' : 'other';
        diagnostic.message = !Object.hasOwn(value, 'message') ? 'absent'
          : value.message === 'Object not found' ? 'object_not_found' : 'other';
      }
      return value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === 4
        && ['statusCode', 'code', 'error', 'message'].every(key => Object.hasOwn(value, key))
        && value.statusCode === '404' && value.code === 'NoSuchKey'
        && value.message === 'Object not found'
        && (value.error === 'NoSuchKey' || value.error === 'not_found');
    } catch { diagnostic.body = 'invalid'; return false; }
    finally { emit(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function removeObject(candidate) {
    const object = path(candidate);
    const removed = await transport(`/object/${object}`, { method: 'DELETE' });
    if (removed.ok) await removed.body?.cancel().catch(() => {});
    else if (!await exactMissing(removed, 'delete')) throw unavailable();
    // Only the core calls this for a settled upload. A missing DELETE never
    // settles the slot without an independent exact-object GET.
    const checked = await transport(`/object/authenticated/${object}`, { method: 'GET' });
    if (!await exactMissing(checked, 'verify')) throw unavailable();
    return { absent: true };
  }
  return Object.freeze({ uploadObject, openObject, signDownload, removeObject });
}
