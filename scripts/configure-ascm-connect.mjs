import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAscmBrowserClient } from '../public/js/ascm-connect.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function renderAscmConnectConfig(env = {}) {
  const enabled = env.PPC_ASCM_CONNECT_ENABLED === 'true';
  const config = { version: 1, enabled, supabaseUrl: enabled ? env.PPC_ASCM_AUTH_URL || '' : '',
    publishableKey: enabled ? env.PPC_ASCM_PUBLISHABLE_KEY || '' : '', clientId: enabled ? env.PPC_ASCM_MCP_CLIENT_ID || '' : '',
    redirectUris: enabled ? [env.PPC_ASCM_REDIRECT_URI || ''] : [] };
  if (enabled) createAscmBrowserClient(config, () => ({}));
  return `// Public identifiers only. Dedicated import and publisher secrets remain server-side.\nglobalThis.PPC_ASCM_CONNECT_CONFIG = Object.freeze(${JSON.stringify(config)});\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve(root, '_site/js/ascm-connect-config.js');
  const source = renderAscmConnectConfig(process.env);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, source, 'utf8');
  console.log(process.env.PPC_ASCM_CONNECT_ENABLED === 'true' ? 'ASCM public consent page configured.' : 'ASCM consent page remains disabled.');
}
