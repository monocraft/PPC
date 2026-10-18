import assert from 'node:assert/strict';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createAscmMcpHttpHandler } from '../../supabase/functions/ppc-ascm-mcp/http.mjs';

const resource = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/ppc-ascm-mcp/mcp';
const issuer = 'https://abcdefghijklmnopqrst.supabase.co/auth/v1';
const token = 'aaa.bbb.ccc';
const calls = [];
const core = { enabled: true,
  async authenticate(value) { calls.push(['auth', value]); if (value !== token) throw Object.assign(new Error('not accepted'), { status: 401 }); },
  async getProfile(value) { assert.equal(value, token); calls.push(['profile']); return { id: '11111111-1111-4111-8111-111111111111' }; },
  async importReport(value, input) { assert.equal(value, token); calls.push(['import', input.messageId]); return { archiveAllowed: false, sourceMessageId: input.messageId, status: 'publication_pending' }; },
  async reportConnection(value, input) { assert.equal(value, token); calls.push(['connection', input]); return { reported: true }; } };
const handler = createAscmMcpHttpHandler({ core, resource, issuer, createMcpHandler, McpServer, z });
const jsonRequest = (body, headers = {}, url = resource) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, 'MCP-Protocol-Version': '2025-06-18', ...headers }, body: JSON.stringify(body) });
const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
const result = async response => {
  const value = await response.text();
  return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(value)
    : JSON.parse(value.split('\n').find(line => line.startsWith('data: ')).slice(6));
};
let response = await handler(new Request(`${resource}/oauth-protected-resource`));
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { resource, authorization_servers: [issuer], bearer_methods_supported: ['header'], scopes_supported: ['email'], resource_name: 'PPC ASCM importer' });
assert.equal(calls.length, 0, 'discovery does not authenticate or touch business data');
response = await handler(jsonRequest(rpc('initialize'), { Authorization: '' }));
assert.equal(response.status, 401);
assert.match(response.headers.get('www-authenticate'), /resource_metadata=/);
assert.equal(calls.length, 0, 'missing bearer never reaches the core');
response = await handler(jsonRequest(rpc('tools/list'), { Origin: 'https://attacker.invalid' }));
assert.equal(response.status, 403); assert.equal(calls.length, 0);
response = await handler(jsonRequest(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } })));
assert.equal(response.status, 200);
assert.equal((await result(response)).result.serverInfo.name, 'ppc-ascm-importer');
response = await handler(jsonRequest(rpc('tools/list')));
assert.equal(response.status, 200);
const tools = (await result(response)).result.tools;
assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_profile', 'import_ascm_report', 'report_connection_state']);
assert.equal(tools.find(tool => tool.name === 'get_profile').annotations.readOnlyHint, true);
assert.equal(tools.find(tool => tool.name === 'import_ascm_report').annotations.readOnlyHint, false);
const importTool = tools.find(tool => tool.name === 'import_ascm_report');
for (const descriptor of tools) {
  assert.deepEqual(descriptor.securitySchemes, [{ type: 'oauth2', scopes: ['email'] }]);
  assert.deepEqual(descriptor._meta.securitySchemes, descriptor.securitySchemes);
}
assert.deepEqual(importTool._meta['openai/fileParams'], ['workbook']);
assert.deepEqual(Object.keys(importTool.inputSchema.properties.workbook.properties).sort(), ['download_url', 'file_id', 'file_name', 'mime_type']);
assert.deepEqual(importTool.inputSchema.properties.workbook.required.sort(), ['download_url', 'file_id']);
assert.ok(importTool.outputSchema);
assert.ok(tools.find(tool => tool.name === 'get_profile').outputSchema);
const connectionTool = tools.find(tool => tool.name === 'report_connection_state');
assert.equal(connectionTool.annotations.destructiveHint, false);
assert.equal(connectionTool.annotations.readOnlyHint, false);
response = await handler(jsonRequest(rpc('tools/call', { name: 'report_connection_state', arguments: { service: 'sharepoint', state: 'reconnect_required' } })));
assert.deepEqual((await result(response)).result.structuredContent, { reported: true });
assert.deepEqual(calls.at(-1), ['connection', { service: 'sharepoint', state: 'reconnect_required' }]);
response = await handler(jsonRequest(rpc('tools/call', { name: 'get_profile', arguments: {} })));
assert.equal((await result(response)).result.structuredContent.id, '11111111-1111-4111-8111-111111111111');
const report = { sender: 'linny.chen@hp.com', subject: 'ASCM Report Accessories HyperX Release Notification October 2026', receivedAt: '2026-09-30T09:01:09Z', messageId: 'exact-message', fileName: 'ASCM Report_HyperX_2026-09-30.xlsx', workbook: { file_id: 'file_fixture', download_url: 'https://fixture.invalid/file' } };
response = await handler(jsonRequest(rpc('tools/call', { name: 'import_ascm_report', arguments: report })));
const imported = (await result(response)).result.structuredContent;
assert.deepEqual(imported, { archiveAllowed: false, sourceMessageId: report.messageId, status: 'publication_pending' });
const importsBefore = calls.filter(call => call[0] === 'import').length;
response = await handler(jsonRequest(rpc('tools/call', { name: 'import_ascm_report', arguments: { ...report, arbitraryMaster: {} } })));
assert.ok((await result(response)).error || calls.filter(call => call[0] === 'import').length === importsBefore);
assert.equal(calls.filter(call => call[0] === 'import').length, importsBefore, 'unknown arguments never reach an importer');
response = await handler(jsonRequest(rpc('tools/list'), { Authorization: 'Bearer invalid.invalid.invalid' }));
assert.equal(response.status, 401);
assert.equal((await response.json()).archiveAllowed, false);
response = await handler(jsonRequest(rpc('tools/call', { name: 'get_profile', arguments: { padding: 'x'.repeat(50000) } })));
assert.equal(response.status, 413);
response = await handler(new Request(resource, { method: 'GET' })); assert.equal(response.status, 405);
response = await handler(jsonRequest(rpc('tools/list'), {}, `${resource}/unexpected`)); assert.equal(response.status, 404);
const disabled = createAscmMcpHttpHandler({ core: { enabled: false }, resource, issuer, createMcpHandler, McpServer, z });
assert.equal((await disabled(new Request(`${resource}/oauth-protected-resource`))).status, 404);
console.log('ASCM MCP HTTP passed with the real pinned SDK: discovery, authentication, stateless initialization/tool calls, exact tool surface, source binding, input limits and disabled gate.');
