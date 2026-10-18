import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { AscmMailPolicyError, isAscmMonthlyNotice, parseAscmInstant,
  validateAscmEnvelope } from '../supabase/functions/ppc-master/ascm-mail-policy.mjs';

const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENT_RESPONSE = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 8 * 60_000;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const FILE_NAME = /^ASCM Report_HyperX_\d{4}-\d{2}-\d{2}\.xlsx$/;
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 2048
  && !/[\r\n\0]/.test(value);
const review = () => { throw new AscmMailPolicyError(); };

class TransportError extends Error {
  constructor(status = 0) { super('ASCM transport unavailable.'); this.status = status; }
}

function configuration(env, currentTime) {
  if (env?.PPC_ASCM_ENABLED !== 'true') return null;
  const names = ['PPC_ASCM_TENANT_ID', 'PPC_ASCM_CLIENT_ID', 'PPC_ASCM_CLIENT_SECRET',
    'PPC_ASCM_MAILBOX', 'PPC_ASCM_API_URL', 'PPC_ASCM_IMPORT_SECRET', 'PPC_ASCM_START_AFTER'];
  if (names.some(name => typeof env[name] !== 'string' || !env[name].trim()
    || env[name].length > 4096 || /[\r\n\0]/.test(env[name]))) return null;
  if (!UUID.test(env.PPC_ASCM_TENANT_ID) || !UUID.test(env.PPC_ASCM_CLIENT_ID)
    || !/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(env.PPC_ASCM_MAILBOX)) return null;
  const cutoff = parseAscmInstant(env.PPC_ASCM_START_AFTER);
  if (cutoff === null || cutoff >= currentTime) return null;
  let api;
  try { api = new URL(env.PPC_ASCM_API_URL); } catch { return null; }
  if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash
    || !api.pathname.endsWith('/api/master/ascm')) return null;
  return { tenant: env.PPC_ASCM_TENANT_ID, client: env.PPC_ASCM_CLIENT_ID,
    clientSecret: env.PPC_ASCM_CLIENT_SECRET, mailbox: env.PPC_ASCM_MAILBOX,
    api: api.href, secret: env.PPC_ASCM_IMPORT_SECRET, cutoff };
}

async function boundedJson(response, limit, signal) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new TransportError(response.status);
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel().catch(() => {});
    throw new TransportError();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TransportError();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new TransportError();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new TransportError();
      chunks.push(value);
    }
    const body = Buffer.concat(chunks, size);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function pinnedInboxPage(value, inboxPath) {
  let url;
  try { url = new URL(value); } catch { throw new TransportError(); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { throw new TransportError(); }
  if (url.origin !== GRAPH_ORIGIN || url.username || url.password || url.hash
    || pathname !== decodeURIComponent(inboxPath)) throw new TransportError();
  return url.href;
}

function workbookBytes(metadata, body) {
  if (!record(body) || body['@odata.type'] !== '#microsoft.graph.fileAttachment'
    || body.id !== metadata.id || body.name !== metadata.name || body.isInline !== false
    || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > MAX_FILE_BYTES
    || typeof body.contentBytes !== 'string' || !body.contentBytes.length
    || body.contentBytes.length > Math.ceil(MAX_FILE_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.contentBytes)) review();
  const bytes = Buffer.from(body.contentBytes, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== body.contentBytes) review();
  return bytes;
}

function validReceipt(value, requestId) {
  return record(value) && value.requestId === requestId && Number.isSafeInteger(value.storageRevision)
    && value.storageRevision > 0 && typeof value.alreadySaved === 'boolean'
    && typeof value.archiveAllowed === 'boolean' && typeof value.status === 'string'
    && value.status.length > 0 && value.status.length <= 80 && record(value.summary);
}

// Only this boundary performs HTTP. Injecting transport makes all selection and receipt gates locally testable.
export async function runAscmSupervisor({ env = process.env, fetchImpl = globalThis.fetch,
  now = () => new Date() } = {}) {
  const result = { status: 'disabled', examined: 0, qualifying: 0, submitted: 0,
    archived: 0, pending: 0, held: 0, failed: 0, uncertain: 0 };
  if (env?.PPC_ASCM_ENABLED !== 'true') return result;
  const invalidConfiguration = () => ({ ...result, status: 'needs_attention', failed: 1 });
  let currentTime;
  try { currentTime = new Date(typeof now === 'function' ? now() : now).getTime(); } catch { return invalidConfiguration(); }
  if (!Number.isFinite(currentTime)) return invalidConfiguration();
  const config = configuration(env, currentTime);
  if (!config) return invalidConfiguration();
  result.status = 'complete';
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  const http = async (url, options, limit = 64 * 1024) => {
    const remaining = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
    if (remaining <= 0) throw new TransportError();
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new TransportError()); }, remaining);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetchImpl(url, { ...options, credentials: 'omit', redirect: 'error',
          cache: 'no-store', signal: controller.signal });
        return boundedJson(response, limit, controller.signal);
      })()]);
    } finally { clearTimeout(timer); }
  };
  try {
    const token = await http(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.client, client_secret: config.clientSecret,
        grant_type: 'client_credentials', scope: GRAPH_ORIGIN + '/.default' }).toString(),
    });
    if (!record(token) || typeof token.access_token !== 'string' || !token.access_token.length
      || token.access_token.length > 16_384 || /\s/.test(token.access_token)) throw new TransportError();
    const graphHeaders = { Authorization: 'Bearer ' + token.access_token, Prefer: 'IdType="ImmutableId"' };
    const graph = (path, method = 'GET', body, limit) => http(GRAPH_ORIGIN + path, {
      method, headers: { ...graphHeaders, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, limit);
    const userPath = '/v1.0/users/' + encodeURIComponent(config.mailbox);
    const inboxPath = userPath + '/mailFolders/inbox/messages';
    const query = new URLSearchParams({ '$top': '25', '$select': 'id,from,subject,receivedDateTime,hasAttachments',
      '$filter': `receivedDateTime gt ${new Date(config.cutoff).toISOString()} and from/emailAddress/address eq 'linny.chen@hp.com' and contains(subject,'ASCM Report Accessories HyperX Release Notification ') and hasAttachments eq true`,
      '$orderby': 'receivedDateTime desc' });
    let pageUrl = GRAPH_ORIGIN + inboxPath + '?' + query;
    let archiveFolder = null;
    const seen = new Set();
    for (let page = 0; page < 5 && pageUrl && result.examined < 25; page += 1) {
      const listing = await http(pinnedInboxPage(pageUrl, inboxPath), { method: 'GET', headers: graphHeaders }, 256 * 1024);
      if (!record(listing) || !Array.isArray(listing.value)) throw new TransportError();
      for (const message of listing.value) {
        if (result.examined >= 25) break;
        result.examined += 1;
        if (!record(message)) continue;
        const sender = message.from?.emailAddress?.address;
        const received = parseAscmInstant(message.receivedDateTime);
        if (!isAscmMonthlyNotice({ sender, subject: message.subject }) || message.hasAttachments !== true
          || received === null || received <= config.cutoff || received > currentTime) continue;
        result.qualifying += 1;
        try {
          if (!identifier(message.id)) review();
          if (seen.has(message.id)) continue;
          seen.add(message.id);
          const messagePath = userPath + '/messages/' + encodeURIComponent(message.id);
          const metadata = await graph(messagePath + '/attachments?$select=id,name,size,isInline,contentType&$top=100');
          if (!record(metadata) || !Array.isArray(metadata.value) || metadata.value.length > 100
            || metadata['@odata.nextLink']) review();
          const matching = metadata.value.filter(item => record(item)
            && item['@odata.type'] === '#microsoft.graph.fileAttachment' && item.isInline === false
            && typeof item.name === 'string' && FILE_NAME.test(item.name));
          if (matching.length !== 1) review();
          const file = matching[0];
          if (!identifier(file.id) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_FILE_BYTES) review();
          const envelope = { sender, subject: message.subject, receivedAt: message.receivedDateTime,
            messageId: message.id, fileName: file.name };
          validateAscmEnvelope(envelope);
          const downloaded = await graph(messagePath + '/attachments/' + encodeURIComponent(file.id), 'GET', undefined, MAX_ATTACHMENT_RESPONSE);
          const bytes = workbookBytes(file, downloaded);
          const requestId = 'ascm-' + createHash('sha256').update(bytes).digest('hex');
          result.submitted += 1;
          const accepted = await http(config.api, { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-PPC-ASCM-Secret': config.secret },
            body: JSON.stringify({ ...envelope, workbookBase64: bytes.toString('base64') }),
          });
          if (!validReceipt(accepted, requestId)) throw new TransportError();
          if (accepted.archiveAllowed !== true) { result.pending += 1; continue; }
          try {
            if (!archiveFolder) {
              const folder = await graph(userPath + '/mailFolders/archive?$select=id');
              if (!record(folder) || !identifier(folder.id)) throw new TransportError();
              archiveFolder = folder.id;
            }
            const moved = await graph(messagePath + '/move', 'POST', { destinationId: archiveFolder });
            if (!record(moved) || moved.id !== message.id || moved.parentFolderId !== archiveFolder) throw new TransportError();
            result.archived += 1;
          } catch { result.uncertain += 1; }
        } catch (error) {
          if (error instanceof AscmMailPolicyError || (error instanceof TransportError && [409, 422].includes(error.status))) result.held += 1;
          else result.failed += 1;
        }
      }
      pageUrl = listing['@odata.nextLink'] ? pinnedInboxPage(listing['@odata.nextLink'], inboxPath) : null;
    }
  } catch { result.failed += 1; }
  if (result.failed || result.held || result.uncertain) result.status = 'needs_attention';
  return result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runAscmSupervisor().then(result => {
    console.log(JSON.stringify(result));
    if (result.status === 'needs_attention') process.exitCode = 1;
  }).catch(() => { console.log(JSON.stringify({ status: 'needs_attention', failed: 1 })); process.exitCode = 1; });
}
