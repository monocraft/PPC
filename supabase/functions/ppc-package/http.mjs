import { createHash, timingSafeEqual } from 'node:crypto';
import { boundedJson, PackageDeliveryError } from './core.mjs';
const ID_HEADERS = 'Content-Length, X-PPC-Package-SHA256, X-PPC-Package-Generation, X-PPC-Package-Candidate-Id, X-PPC-Package-Revision';
const hash = value => createHash('sha256').update(value).digest();
/** @param {{env?: Record<string,string>, core: any}} options */
export function createPackageDeliveryHttpHandler({ env = {}, core } = {}) {
  const origins = new Set(['https://monocraft.github.io']);
  for (const origin of String(env.PPC_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Invalid package allowed origin.');
    origins.add(origin);
  }
  const secret = env.PPC_PUBLISHER_SECRET || '';
  const configured = env.PPC_PACKAGE_DELIVERY_ENABLED === 'true' && core?.enabled === true;
  return async request => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
    const reply = (status, value) => new Response(JSON.stringify(value), { status, headers });
    try {
      if (!configured) throw new PackageDeliveryError(404, 'NOT_FOUND');
      const origin = request.headers.get('origin');
      if (origin && !origins.has(origin)) throw new PackageDeliveryError(403, 'ORIGIN_DENIED');
      const path = new URL(request.url).pathname.replace(/^\/functions\/v1\/ppc-package/, '');
      const latest = path === '/api/package/latest';
      if (origin && latest) {
        headers['Access-Control-Allow-Origin'] = origin; headers['Access-Control-Expose-Headers'] = ID_HEADERS;
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'; headers['Access-Control-Allow-Headers'] = 'Content-Type';
      }
      if (request.method === 'OPTIONS' && latest) return new Response(null, { status: 204, headers });
      if (latest) {
        if (request.method !== 'POST') throw new PackageDeliveryError(405, 'METHOD_NOT_ALLOWED');
        const response = await core.reader(request); const output = new Headers(response.headers);
        for (const [name, value] of Object.entries(headers)) if (name !== 'Content-Type') output.set(name, value);
        return new Response(response.body, { status: response.status, headers: output });
      }
      if (origin) throw new PackageDeliveryError(403, 'SERVER_ONLY');
      const supplied = request.headers.get('x-ppc-publisher-secret') || '';
      if (secret.length < 32 || secret.length > 512 || /\s/.test(secret) || supplied.length > 512 || !timingSafeEqual(hash(supplied), hash(secret))) throw new PackageDeliveryError(401, 'UNAUTHORIZED');
      const upload = /^\/api\/package\/candidates\/([a-f0-9-]{36})\/bytes$/.exec(path);
      if (upload) {
        if (request.method !== 'PUT') throw new PackageDeliveryError(405, 'METHOD_NOT_ALLOWED');
        return reply(200, await core.upload(request, upload[1]));
      }
      const control = /^\/api\/package\/(current|reserve|finalize|seed)$/.exec(path);
      if (!control) throw new PackageDeliveryError(404, 'NOT_FOUND');
      if (request.method !== 'POST') throw new PackageDeliveryError(405, 'METHOD_NOT_ALLOWED');
      return reply(200, await core.publisher(control[1], await boundedJson(request)));
    } catch (error) {
      return reply(error instanceof PackageDeliveryError ? error.status : 503,
        { code: error instanceof PackageDeliveryError ? error.code : 'PACKAGE_UNAVAILABLE' });
    }
  };
}
