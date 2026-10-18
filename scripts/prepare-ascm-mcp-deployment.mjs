import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildSupabaseMaster } from './build-supabase-master.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mcpFiles = ['index.ts', 'bootstrap.mjs', 'core.mjs', 'http.mjs', 'deno.json', 'deno.lock'];
const masterFiles = ['gateway.mjs', 'ascm-api.mjs', 'ascm-mail-policy.mjs', 'ascm-plan.mjs',
  'package-delivery-contract.mjs',
  'shared/master-model.js', 'shared/product-merge.js', 'shared/package-codec.js', 'shared/ascm-import.js'];
const packageFiles = ['core.mjs', 'storage.mjs', 'hash.mjs', 'rpc.mjs'];
const hash = value => createHash('sha256').update(value).digest('hex');
const slash = value => value.replaceAll('\\', '/');

/** Prepare a self-contained dashboard upload without duplicating tracked source. */
export async function prepareAscmMcpDeployment({ outputDirectory = resolve(root, '.superpowers/deploy/ascm-mcp') } = {}) {
  await buildSupabaseMaster({ check: true });
  const files = [];
  for (const [sourcePrefix, targets] of [
    ['supabase/functions/ppc-ascm-mcp', mcpFiles.map(name => [name, name])],
    ['supabase/functions/ppc-master', masterFiles.map(name => [name, `master/${name}`])],
    ['supabase/functions/ppc-package', packageFiles.map(name => [name, `package/${name}`])],
  ]) for (const [name, target] of targets) {
    const sourcePath = resolve(root, sourcePrefix, name);
    const canonical = await readFile(sourcePath, 'utf8');
    const staged = ['bootstrap.mjs', 'core.mjs'].includes(target)
      ? canonical.replaceAll("'../ppc-master/", "'./master/").replaceAll("'../ppc-package/", "'./package/")
      : target.startsWith('package/') ? canonical.replaceAll("'../ppc-master/", "'../master/") : canonical;
    const destination = resolve(outputDirectory, target);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, staged, 'utf8');
    files.push({ path: target, source: slash(relative(root, sourcePath)), sourceSha256: hash(Buffer.from(canonical)), sha256: hash(Buffer.from(staged)) });
  }
  await writeFile(resolve(outputDirectory, 'source-manifest.json'), JSON.stringify({ version: 1, files }, null, 2) + '\n', 'utf8');
  return { directory: resolve(outputDirectory), files: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareAscmMcpDeployment();
  console.log(`Prepared ${result.files} reviewed source files in ${result.directory}. No secrets or deployment actions included.`);
}
