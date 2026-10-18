const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_PACKAGE_BYTES = 67_108_864;

export class PackageDeliveryClientError extends Error {
  constructor(code) { super('The encrypted package delivery operation needs attention.'); this.code = code; }
}
const fail = code => new PackageDeliveryClientError(code);
export function normalizePackageDeliveryEndpoint(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw fail('INVALID_CONFIGURATION'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !url.pathname.endsWith('/functions/v1/ppc-package/api/package')) throw fail('INVALID_CONFIGURATION');
  return url.href.replace(/\/$/, '');
}

export function createPackageDeliveryClient({ endpoint, publisherSecret, fetchImpl = globalThis.fetch, timeoutMs = 120_000 } = {}) {
  const root = normalizePackageDeliveryEndpoint(endpoint);
  if (typeof publisherSecret !== 'string' || publisherSecret.length < 32 || publisherSecret.length > 512 ||
    /[\s\u0000-\u001f\u007f]/.test(publisherSecret) || typeof fetchImpl !== 'function' ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw fail('INVALID_CONFIGURATION');
  async function send(path, body, binary = false) {
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${root}/${path}`, { method: binary ? 'PUT' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        referrerPolicy: 'no-referrer', signal, headers: { 'X-PPC-Publisher-Secret': publisherSecret, 'Content-Type': binary ? 'application/octet-stream' : 'application/json',
          ...(binary ? { 'Content-Length': String(body.bytes.length), 'X-PPC-Candidate-Generation': String(body.candidate.generation) } : { Accept: 'application/json' }) },
        body: binary ? body.bytes : JSON.stringify(body) });
    } catch { throw fail(signal.aborted ? 'REQUEST_TIMEOUT' : 'DELIVERY_CONNECTION_FAILED'); }
    let parsed;
    try {
      const declared = response.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > 32_768)) throw Error();
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 32_768) throw Error();
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch { throw fail('DELIVERY_RESPONSE_INVALID'); }
    if (!response.ok) throw fail(typeof parsed?.code === 'string' && /^[A-Z_]{1,64}$/.test(parsed.code) ? parsed.code : 'DELIVERY_UNAVAILABLE');
    return parsed;
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
