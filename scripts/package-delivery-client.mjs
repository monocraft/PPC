const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_PACKAGE_BYTES = 67_108_864;
const TRANSIENT_STATUS = new Set([408, 429, 502, 503, 504]);
const SAFE_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'POLICY_DENIED', 'NOT_FOUND', 'RATE_LIMIT', 'CONTENT_TYPE',
  'INVALID_REQUEST', 'INVALID_BINARY_REQUEST', 'INVALID_PACKAGE_KEY', 'INVALID_RECEIPT', 'REQUEST_TOO_LARGE',
  'PACKAGE_NOT_PUBLISHED', 'PACKAGE_PHASE', 'PACKAGE_READBACK_MISMATCH', 'PACKAGE_RESERVATION_HELD', 'PACKAGE_STALE',
  'PACKAGE_STATE_INVALID', 'PACKAGE_UNAVAILABLE', 'PACKAGE_UPLOAD_HELD', 'PACKAGE_UPLOAD_MISMATCH', 'PACKAGE_UPLOAD_UNSETTLED']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function retryDelay(header, attempt, now) {
  const fallback = 250 * (attempt + 1);
  const delay = /^\d+$/.test(header || '') ? Number(header) * 1000
    : /^[A-Za-z]{3}, /.test(header || '') ? Date.parse(header) - now() : NaN;
  return Number.isFinite(delay) && delay > 0 ? Math.min(30_000, Math.max(fallback, delay)) : fallback;
}

export class PackageDeliveryClientError extends Error {
  constructor(code, stage, httpStatus) {
    super('The encrypted package delivery operation needs attention.'); this.code = code;
    if (stage) this.stage = stage;
    if (httpStatus) this.httpStatus = httpStatus;
  }
}
const fail = (code, stage, status) => new PackageDeliveryClientError(code, stage, status);
export function normalizePackageDeliveryEndpoint(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw fail('INVALID_CONFIGURATION'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !url.pathname.endsWith('/functions/v1/ppc-package/api/package')) throw fail('INVALID_CONFIGURATION');
  return url.href.replace(/\/$/, '');
}

export function createPackageDeliveryClient({ endpoint, publisherSecret, fetchImpl = globalThis.fetch, timeoutMs = 120_000, wait = pause, now = Date.now } = {}) {
  const root = normalizePackageDeliveryEndpoint(endpoint);
  if (typeof publisherSecret !== 'string' || publisherSecret.length < 32 || publisherSecret.length > 512 ||
    /[\s\u0000-\u001f\u007f]/.test(publisherSecret) || typeof fetchImpl !== 'function' ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || typeof wait !== 'function' || typeof now !== 'function') throw fail('INVALID_CONFIGURATION');
  async function send(path, body, binary = false) {
    const stage = binary ? 'upload' : path;
    // The same exact candidate identity/payload is replayed. Binary upload has
    // external write uncertainty and always receives a single attempt.
    const requestBody = binary ? body.bytes : JSON.stringify(body);
    const attempts = binary ? 1 : 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const signal = AbortSignal.timeout(timeoutMs);
      let response;
      try {
        response = await fetchImpl(`${root}/${path}`, { method: binary ? 'PUT' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
          referrerPolicy: 'no-referrer', signal, headers: { 'X-PPC-Publisher-Secret': publisherSecret, 'Content-Type': binary ? 'application/octet-stream' : 'application/json',
            ...(binary ? { 'Content-Length': String(body.bytes.length), 'X-PPC-Candidate-Generation': String(body.candidate.generation) } : { Accept: 'application/json' }) },
          body: requestBody });
      } catch {
        if (attempt + 1 < attempts) { await wait(retryDelay(null, attempt, now)); continue; }
        throw fail(signal.aborted ? 'REQUEST_TIMEOUT' : 'DELIVERY_CONNECTION_FAILED', stage);
      }
      const declared = response.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > 32_768)) throw fail('DELIVERY_RESPONSE_INVALID', stage, response.status);
      let bytes;
      try { bytes = new Uint8Array(await response.arrayBuffer()); }
      catch {
        if ((response.ok || TRANSIENT_STATUS.has(response.status)) && attempt + 1 < attempts) {
          await wait(retryDelay(response.headers.get('retry-after'), attempt, now)); continue;
        }
        throw fail(signal.aborted ? 'REQUEST_TIMEOUT' : 'DELIVERY_CONNECTION_FAILED', stage, response.status);
      }
      if (bytes.length > 32_768) throw fail('DELIVERY_RESPONSE_INVALID', stage, response.status);
      let parsed;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch {
        if (TRANSIENT_STATUS.has(response.status) && attempt + 1 < attempts) {
          await wait(retryDelay(response.headers.get('retry-after'), attempt, now)); continue;
        }
        throw fail('DELIVERY_RESPONSE_INVALID', stage, response.status);
      }
      if (response.ok) return parsed;
      const code = SAFE_CODES.has(parsed?.code) ? parsed.code : 'DELIVERY_UNAVAILABLE';
      // Typed application holds beat a transient-looking HTTP status. Unknown
      // application codes also hold; only generic availability/rate errors retry.
      const transient = TRANSIENT_STATUS.has(response.status) &&
        (!parsed?.code || ['PACKAGE_UNAVAILABLE', 'RATE_LIMIT', 'DELIVERY_UNAVAILABLE'].includes(parsed.code));
      if (transient && attempt + 1 < attempts) {
        await wait(retryDelay(response.headers.get('retry-after'), attempt, now)); continue;
      }
      throw fail(code, stage, response.status);
    }
  }
  const binary = (candidate, bytes) => {
    if (!UUID.test(candidate?.candidateId || '') || !Number.isSafeInteger(candidate.generation) || candidate.generation < 1 ||
      !(bytes instanceof Uint8Array) || bytes.length < 36 || bytes.length > MAX_PACKAGE_BYTES ||
      (candidate.bytes !== undefined && candidate.bytes !== bytes.length) ||
      (candidate.sha256 !== undefined && !SHA.test(candidate.sha256))) throw fail('INVALID_CANDIDATE');
    return send(`candidates/${candidate.candidateId}/bytes`, { candidate, bytes }, true);
  };
  const finalize = candidate => {
    if (!UUID.test(candidate?.candidateId || '') || !Number.isSafeInteger(candidate.generation) || candidate.generation < 1) throw fail('INVALID_CANDIDATE');
    return send('finalize', { candidateId: candidate.candidateId, generation: candidate.generation });
  };
  return Object.freeze({ readCurrent: () => send('current', {}), reserve: metadata => send('reserve', metadata),
    seed: metadata => send('seed', metadata), upload: binary, finalize });
}
