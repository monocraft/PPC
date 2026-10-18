import { createMasterGateway } from './gateway.mjs';

const env = Object.fromEntries([
  'SUPABASE_URL', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY',
  'PPC_PACKAGE_KEY_HASH', 'PPC_PUBLISHER_SECRET', 'PPC_ALLOWED_ORIGINS',
  'PPC_GITHUB_DISPATCH_TOKEN', 'PPC_GITHUB_OWNER', 'PPC_GITHUB_REPO',
  'PPC_GITHUB_PUBLISH_WORKFLOW',
  'PPC_ASCM_IMPORT_SECRET', 'PPC_ASCM_DATE_POLICY', 'PPC_ASCM_STATUS_ENABLED',
].map((name) => [name, Deno.env.get(name) || '']));

Deno.serve(createMasterGateway({ env }));
