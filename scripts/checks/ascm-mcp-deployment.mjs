import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

const { prepareAscmMcpDeployment } = await import('../prepare-ascm-mcp-deployment.mjs');
const parent = resolve(tmpdir());
const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const directory = await mkdtemp(resolve(parent, 'ppc-ascm-deployment-'));
const hash = value => createHash('sha256').update(value).digest('hex');
try {
  const result = await prepareAscmMcpDeployment({ outputDirectory: directory });
  const manifest = JSON.parse(await readFile(resolve(directory, 'source-manifest.json'), 'utf8'));
  assert.equal(result.files, 19);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.files.length, 19);
  assert.equal(new Set(manifest.files.map(file => file.path)).size, 19);
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
