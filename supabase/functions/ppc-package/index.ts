import { createPackageDelivery } from './core.mjs';
import { createPackageDeliveryHttpHandler } from './http.mjs';
const env = Object.fromEntries([
  'SUPABASE_URL', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY',
  'PPC_PACKAGE_DELIVERY_ENABLED', 'PPC_PACKAGE_KEY_HASH', 'PPC_PUBLISHER_SECRET', 'PPC_ALLOWED_ORIGINS',
  'PPC_PACKAGE_SP_DRIVE_ID', 'PPC_PACKAGE_SP_FOLDER_ID',
].map(name => [name, Deno.env.get(name) || '']));
Deno.serve(createPackageDeliveryHttpHandler({ env, core: createPackageDelivery({ env }) }));
