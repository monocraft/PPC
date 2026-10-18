import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSupabaseMaster } from './build-supabase-master.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerFiles = ['index.ts', 'bootstrap.mjs', 'http.mjs', 'deno.json'];
const masterFiles = ['gateway.mjs', 'ascm-api.mjs', 'ascm-mail-policy.mjs', 'ascm-plan.mjs',
  'package-delivery-contract.mjs',
  'shared/master-model.js', 'shared/product-merge.js', 'shared/package-codec.js', 'shared/ascm-import.js'];
const packageFiles = ['core.mjs', 'storage.mjs', 'hash.mjs', 'rpc.mjs'];
const targets = [
  ...workerFiles.map(name => [`supabase/functions/ppc-ascm-flow/${name}`, name]),
  ...masterFiles.map(name => [`supabase/functions/ppc-master/${name}`, `master/${name}`]),
  ...packageFiles.map(name => [`supabase/functions/ppc-package/${name}`, `package/${name}`]),
];
const sourceTargets = new Map(targets.map(([source, target]) => [resolve(root, source), target]));
const allowedFiles = new Set([...targets.map(([, target]) => target), 'source-manifest.json']);
const allowedDirectories = new Set(['master', 'master/shared', 'package']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.replaceAll('\\', '/');
// The reviewed closure uses static imports; anchor declarations so user-facing
// strings containing words such as "import" or "from" are never rewritten.
const importPattern = /^([ \t]*import\s+(?:[^'";]*?\bfrom\s*)?)(['"])([^'"\r\n]+)\2/gm;

async function assertReviewedOutput(directory, prefix = '') {
  let entries;
  try {
    if ((await lstat(directory)).isSymbolicLink()) throw new Error('Unexpected symlink in deployment output.');
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' && prefix === '') return;
    throw error;
  }
  for (const entry of entries) {
    const path = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in deployment output: ${path}`);
    if (entry.isDirectory() && allowedDirectories.has(path)) {
      await assertReviewedOutput(resolve(directory, entry.name), `${path}/`);
    } else if (!entry.isFile() || !allowedFiles.has(path)) {
      throw new Error(`Unexpected unreviewed deployment output: ${path}. Use a dedicated source staging directory.`);
    }
  }
}

function rewriteImports(canonical, source, target) {
  if (!/\.(?:mjs|js|ts)$/.test(target)) return canonical;
  const staged = canonical.toString('utf8').replace(importPattern, (match, prefix, quote, specifier) => {
    if (!specifier.startsWith('.')) {
      if (specifier !== 'node:crypto') throw new Error(`Unreviewed deployment dependency in ${source}: ${specifier}`);
      return match;
    }
    const dependency = sourceTargets.get(resolve(root, dirname(source), specifier));
    if (!dependency) throw new Error(`Unreviewed local deployment dependency in ${source}: ${specifier}`);
    let rewritten = slash(relative(dirname(target), dependency));
    if (!rewritten.startsWith('.')) rewritten = `./${rewritten}`;
    return `${prefix}${quote}${rewritten}${quote}`;
  });
  return Buffer.from(staged, 'utf8');
}

/** Stage only reviewed local source; no configuration, payload, activation or deployment. */
export async function prepareAscmFlowDeployment({ outputDirectory = resolve(root, '.superpowers/deploy/ascm-flow') } = {}) {
  await buildSupabaseMaster({ check: true });
  const directory = resolve(outputDirectory);
  await assertReviewedOutput(directory);
  // Resolve the complete allowlist before writing, so a missing source/import cannot leave a partial release.
  const sources = await Promise.all(targets.map(async ([source, path]) => {
    const canonical = await readFile(resolve(root, source));
    const staged = rewriteImports(canonical, source, path);
    return { path, source, canonical, staged };
  }));
  const files = [];
  for (const { path, source, canonical, staged } of sources) {
    const destination = resolve(directory, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, staged);
    files.push({ path, source, sourceSha256: hash(canonical), sha256: hash(staged) });
  }
  await writeFile(resolve(directory, 'source-manifest.json'), JSON.stringify({ version: 1, files }, null, 2) + '\n', 'utf8');
  return { directory, files: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareAscmFlowDeployment();
  console.log(`Prepared ${result.files} reviewed source files in ${result.directory}. No secrets, activation or deployment actions included.`);
}
