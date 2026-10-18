const MAX_BODY_BYTES = 40 * 1024;
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (status, value, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
const unavailable = () => reply(404, { code: 'NOT_FOUND', archiveAllowed: false });

async function boundedRequest(request) {
  const reader = request.body?.getReader();
  const chunks = []; let length = 0;
  if (reader) try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw Object.assign(new Error('Request too large.'), { status: 413 }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: 'POST', headers: request.headers, body: bytes });
}

export function createAscmMcpHttpHandler({ core, resource, issuer, createMcpHandler, McpServer, z }) {
  let resourceUrl;
  try { resourceUrl = new URL(resource); } catch { /* Missing configuration remains disabled. */ }
  const metadataUrl = resourceUrl ? `${resource}/oauth-protected-resource` : '';
  const challenge = { 'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}", scope="email"` };
  const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
  const tool = async operation => {
    try { return result(await operation()); }
    catch { return { ...result({ status: 'needs_attention', archiveAllowed: false, code: 'IMPORT_UNAVAILABLE' }), isError: true }; }
  };
  return async request => {
    if (!core.enabled || !resourceUrl || !issuer) return unavailable();
    const path = new URL(request.url).pathname;
    if (request.headers.has('origin')) return reply(403, { code: 'ORIGIN_DENIED', archiveAllowed: false });
    if (path === new URL(metadataUrl).pathname && request.method === 'GET') return reply(200, {
      resource, authorization_servers: [issuer], bearer_methods_supported: ['header'], scopes_supported: ['email'], resource_name: 'PPC ASCM importer',
    });
    if (path !== resourceUrl.pathname) return unavailable();
    if (request.method !== 'POST') return reply(405, { code: 'METHOD_NOT_ALLOWED', archiveAllowed: false }, { Allow: 'POST' });
    const authorization = request.headers.get('authorization') || '';
    const bearer = authorization.length <= 16 * 1024 && /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
    if (!bearer) return reply(401, { code: 'UNAUTHORIZED', archiveAllowed: false }, challenge);
    const accessToken = bearer[1];
    try { await core.authenticate(accessToken); }
    catch (error) {
      const status = [401, 403, 429, 503].includes(error?.status) ? error.status : 401;
      return reply(status, { code: status === 503 ? 'AUTH_UNAVAILABLE' : 'UNAUTHORIZED', archiveAllowed: false }, challenge);
    }
    try {
      const bounded = await boundedRequest(request);
      // The official transport creates a fresh server per request. Tokens are
      // captured in this request's closure and are never shared between calls.
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: 'ppc-ascm-importer', version: '1.0.0' });
        const descriptors = [];
        const register = (name, config, callback) => {
          server.registerTool(name, config, callback);
          // The pinned SDK's convenience listing drops non-MCP extension
          // fields. Use its public list handler to retain OpenAI's canonical
          // OAuth descriptor alongside the compatibility metadata mirror.
          descriptors.push({ name, title: config.title, description: config.description,
            inputSchema: z.toJSONSchema(config.inputSchema), outputSchema: z.toJSONSchema(config.outputSchema),
            annotations: config.annotations, securitySchemes: config._meta.securitySchemes, _meta: config._meta });
        };
        register('get_profile', {
          title: 'Check PPC ASCM connection', description: 'Confirm this authenticated connection can submit monthly ASCM reports. Returns no portfolio records.',
          inputSchema: z.object({}).strict(), outputSchema: z.object({ id: z.uuid() }).strict(),
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          _meta: { 'openai/profile': true, securitySchemes: [{ type: 'oauth2', scopes: ['email'] }] },
        }, () => tool(() => core.getProfile(accessToken)));
        register('import_ascm_report', {
          title: 'Import monthly ASCM report',
          description: 'Submit one published monthly HyperX ASCM release from the allowed sender using the Outlook attachment artifact. Preserves protected data and conflicts. Archive only sourceMessageId when archiveAllowed is exactly true; a pending or held report must remain in Inbox.',
          inputSchema: z.object({
            sender: z.string().min(1).max(254), subject: z.string().min(1).max(320), receivedAt: z.string().min(1).max(64),
            messageId: z.string().min(1).max(2048), fileName: z.string().min(1).max(256),
            workbook: z.object({ download_url: z.string().min(1).max(16384), file_id: z.string().min(1).max(256), mime_type: z.string().max(255).optional(), file_name: z.string().max(256).optional() }).strict(),
          }).strict(),
          outputSchema: z.object({
            archiveAllowed: z.boolean(), status: z.enum(['published', 'publication_pending', 'held', 'needs_attention']),
            sourceMessageId: z.string().max(1024).optional(), requestId: z.string().regex(/^ascm-[a-f0-9]{64}$/).optional(),
            storageRevision: z.number().int().min(1).optional(), alreadySaved: z.boolean().optional(),
            summary: z.object({ savedFields: z.number().int().min(0).max(1000000), savedProducts: z.number().int().min(0).max(1000000) }).strict().optional(),
            code: z.string().regex(/^[A-Z_]{1,64}$/).optional(),
          }).strict(),
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
          _meta: { 'openai/fileParams': ['workbook'], securitySchemes: [{ type: 'oauth2', scopes: ['email'] }] },
        }, input => tool(() => core.importReport(accessToken, input)));
        register('report_connection_state', {
          title: 'Report Microsoft connection result',
          description: 'Report only a connection state change from a real Outlook or SharePoint connector attempt in this ASCM workflow. Use available after successful authorized access to clear a previously reported reconnect warning, or reconnect_required for a confirmed authentication/reconnection error. Do not use this as an idle-run or periodic health check. This records a recovery hint in PPC; it cannot refresh credentials, approve access, import a report or permit Archive.',
          inputSchema: z.object({ service: z.enum(['outlook', 'sharepoint']), state: z.enum(['available', 'reconnect_required']) }).strict(),
          outputSchema: z.object({ reported: z.boolean() }).strict(),
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['email'] }] },
        }, input => tool(() => core.reportConnection(accessToken, input)));
        server.server.setRequestHandler('tools/list', () => ({ tools: descriptors }));
        return server;
      });
      const response = await handler.fetch(bounded);
      const outputHeaders = new Headers(response.headers);
      outputHeaders.set('Cache-Control', 'no-store'); outputHeaders.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers: outputHeaders });
    } catch (error) {
      return reply(error?.status === 413 ? 413 : 400, { code: error?.status === 413 ? 'REQUEST_TOO_LARGE' : 'INVALID_REQUEST', archiveAllowed: false });
    }
  };
}
