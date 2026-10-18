import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createAscmMcpApplication } from './bootstrap.mjs';

const env = Object.fromEntries([
  'SUPABASE_URL', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY',
  'PPC_PACKAGE_KEY_HASH', 'PPC_PUBLISHER_SECRET', 'PPC_ALLOWED_ORIGINS',
  'PPC_GITHUB_DISPATCH_TOKEN', 'PPC_GITHUB_OWNER', 'PPC_GITHUB_REPO', 'PPC_GITHUB_PUBLISH_WORKFLOW',
  'PPC_ASCM_IMPORT_SECRET', 'PPC_ASCM_DATE_POLICY', 'PPC_ASCM_START_AFTER', 'PPC_ASCM_STATUS_ENABLED',
  'PPC_ASCM_MCP_ENABLED', 'PPC_ASCM_MCP_RESOURCE', 'PPC_ASCM_MCP_OWNER_ID',
  'PPC_ASCM_MCP_CLIENT_ID', 'PPC_ASCM_MCP_DOWNLOAD_ORIGIN',
  'PPC_PACKAGE_DELIVERY_ENABLED', 'PPC_PACKAGE_SP_DRIVE_ID', 'PPC_PACKAGE_SP_FOLDER_ID',
].map(name => [name, Deno.env.get(name) || '']));

Deno.serve(createAscmMcpApplication({ env, createMcpHandler, McpServer, z }));
