import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, dirname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

const { prepareAscmMcpDeployment } = await import('../prepare-ascm-mcp-deployment.mjs');
const parent = resolve(tmpdir());
const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const directory = await mkdtemp(resolve(parent, 'ppc-ascm-deployment-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const expectedSources = [
  ...['index.ts', 'bootstrap.mjs', 'core.mjs', 'http.mjs', 'deno.json', 'deno.lock'].map(name => [name, `supabase/functions/ppc-ascm-mcp/${name}`]),
  ...['gateway.mjs', 'ascm-api.mjs', 'ascm-sharepoint-api.mjs', 'publication-dispatch.mjs', 'ascm-mail-policy.mjs', 'ascm-plan.mjs', 'package-delivery-contract.mjs',
    'shared/master-model.js', 'shared/product-merge.js', 'shared/package-codec.js', 'shared/ascm-import.js'].map(name => [`master/${name}`, `supabase/functions/ppc-master/${name}`]),
  ...['core.mjs', 'storage.mjs', 'hash.mjs', 'rpc.mjs'].map(name => [`package/${name}`, `supabase/functions/ppc-package/${name}`]),
];
async function inventory(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'the staged closure cannot contain symlinks');
    if (entry.isDirectory()) result.push(...await inventory(resolve(directory, entry.name), prefix + entry.name + '/'));
    else result.push(prefix + entry.name);
  }
  return result.sort();
}
try {
  const result = await prepareAscmMcpDeployment({ outputDirectory: directory });
  const manifest = JSON.parse(await readFile(resolve(directory, 'source-manifest.json'), 'utf8'));
  assert.equal(result.files, 21);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.files.length, 21);
  assert.equal(new Set(manifest.files.map(file => file.path)).size, 21);
  assert.deepEqual(manifest.files.map(file => [file.path, file.source]), expectedSources, 'exact reviewed source membership');
  assert.deepEqual(await inventory(directory), [...expectedSources.map(([path]) => path), 'source-manifest.json'].sort());
  const targets = new Map(expectedSources.map(([target, source]) => [resolve(projectRoot, source), resolve(directory, target)]));
  for (const file of manifest.files) {
    assert(!file.path.startsWith('/') && !file.path.includes('..'));
    const canonical = await readFile(resolve(projectRoot, file.source), 'utf8');
    const expected = ['bootstrap.mjs', 'core.mjs'].includes(file.path)
      ? canonical.replaceAll("'../ppc-master/", "'./master/").replaceAll("'../ppc-package/", "'./package/")
      : file.path.startsWith('package/') ? canonical.replaceAll("'../ppc-master/", "'../master/") : canonical;
    const staged = await readFile(resolve(directory, file.path), 'utf8');
    assert.equal(staged, expected, `staged ${file.path} must preserve its canonical source`);
    assert.equal(file.sha256, hash(Buffer.from(staged)));
    assert.equal(file.sourceSha256, hash(Buffer.from(canonical)));
    const imports = text => [...text.matchAll(/^\s*import\s+(?:[^'";]*?\bfrom\s*)?['"]([^'"\r\n]+)['"]/gm)].map(match => match[1]);
    const canonicalImports = imports(canonical), stagedImports = imports(staged);
    assert.equal(stagedImports.length, canonicalImports.length);
    for (const [index, specifier] of canonicalImports.entries()) {
      if (!specifier.startsWith('.')) { assert.equal(stagedImports[index], specifier); continue; }
      const target = targets.get(resolve(dirname(resolve(projectRoot, file.source)), specifier));
      assert(target, 'canonical imports belong to the exact closure');
      assert.equal(resolve(dirname(resolve(directory, file.path)), stagedImports[index]), target, 'staged imports retain their exact target');
    }
  }
  assert.deepEqual((await readdir(directory)).sort(), ['bootstrap.mjs', 'core.mjs', 'deno.json', 'deno.lock', 'http.mjs', 'index.ts', 'master', 'package', 'source-manifest.json']);
  const { createAscmMcpApplication } = await import(pathToFileURL(resolve(directory, 'bootstrap.mjs')).href);
  const disabled = createAscmMcpApplication({ createMcpHandler, McpServer, z,
    fetchImpl: () => { throw new Error('No deployment fixture network access.'); } });
  assert.equal((await disabled(new Request('https://example.invalid/mcp'))).status, 404,
    'the staged module closure imports independently without reaching parent function files');
  assert.equal((await disabled(new Request('https://example.invalid/mcp', { method: 'POST', body: '{}' }))).status, 404);
  await prepareAscmMcpDeployment({ outputDirectory: directory });
  assert.deepEqual(JSON.parse(await readFile(resolve(directory, 'source-manifest.json'), 'utf8')), manifest, 're-staging is deterministic');
  console.log('ASCM MCP deployment staging passed: exact source hashes, bounded file allowlist, standalone import closure and disabled defaults.');
} finally {
  const child = relative(parent, directory);
  assert(child.startsWith('ppc-ascm-deployment-') && !child.includes(sep) && !child.includes('..'));
  await rm(directory, { recursive: true, force: true });
}
