import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildSupabaseMaster } from './build-supabase-master.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
/** Source-only preparation. This neither activates delivery nor deploys code. */
export async function preparePackageDeliveryDeployment({ outputDirectory = resolve(root, '.superpowers/deploy/package-delivery') } = {}) {
  await buildSupabaseMaster({ check: true });
  const targets = ['index.ts', 'http.mjs', 'core.mjs', 'storage.mjs', 'hash.mjs', 'rpc.mjs', 'deno.lock'].map(name => [`supabase/functions/ppc-package/${name}`, name]);
  targets.push(['supabase/functions/ppc-master/package-delivery-contract.mjs', 'master/package-delivery-contract.mjs'], ['supabase/functions/ppc-master/shared/package-codec.js', 'master/shared/package-codec.js']);
  const files = [];
  for (const [source, target] of targets) {
    const canonical = await readFile(resolve(root, source), 'utf8');
    const staged = target.startsWith('master/') ? canonical : canonical.replaceAll("'../ppc-master/", "'./master/");
    const destination = resolve(outputDirectory, target); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, staged, 'utf8');
    files.push({ path: target, source, sourceSha256: hash(Buffer.from(canonical)), sha256: hash(Buffer.from(staged)) });
  }
  await writeFile(resolve(outputDirectory, 'source-manifest.json'), JSON.stringify({ version: 1, files }, null, 2) + '\n', 'utf8');
  return { directory: resolve(outputDirectory), files: files.length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await preparePackageDeliveryDeployment(); console.log(`Prepared ${result.files} reviewed source files in ${result.directory}. No secrets, activation or deployment actions included.`);
}
