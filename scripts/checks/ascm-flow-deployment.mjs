import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
let prepareAscmFlowDeployment;
try {
  ({ prepareAscmFlowDeployment } = await import('../prepare-ascm-flow-deployment.mjs'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('prepare-ascm-flow-deployment.mjs')) throw error;
}
assert.equal(typeof prepareAscmFlowDeployment, 'function', 'the native flow deployment preparer must be implemented');

const expectedSources = [
  ['index.ts', 'supabase/functions/ppc-ascm-flow/index.ts'],
  ['bootstrap.mjs', 'supabase/functions/ppc-ascm-flow/bootstrap.mjs'],
  ['http.mjs', 'supabase/functions/ppc-ascm-flow/http.mjs'],
  ['deno.json', 'supabase/functions/ppc-ascm-flow/deno.json'],
  ['master/gateway.mjs', 'supabase/functions/ppc-master/gateway.mjs'],
  ['master/ascm-api.mjs', 'supabase/functions/ppc-master/ascm-api.mjs'],
  ['master/ascm-mail-policy.mjs', 'supabase/functions/ppc-master/ascm-mail-policy.mjs'],
  ['master/ascm-plan.mjs', 'supabase/functions/ppc-master/ascm-plan.mjs'],
  ['master/package-delivery-contract.mjs', 'supabase/functions/ppc-master/package-delivery-contract.mjs'],
  ['master/shared/master-model.js', 'supabase/functions/ppc-master/shared/master-model.js'],
  ['master/shared/product-merge.js', 'supabase/functions/ppc-master/shared/product-merge.js'],
  ['master/shared/package-codec.js', 'supabase/functions/ppc-master/shared/package-codec.js'],
  ['master/shared/ascm-import.js', 'supabase/functions/ppc-master/shared/ascm-import.js'],
  ['package/core.mjs', 'supabase/functions/ppc-package/core.mjs'],
  ['package/storage.mjs', 'supabase/functions/ppc-package/storage.mjs'],
  ['package/hash.mjs', 'supabase/functions/ppc-package/hash.mjs'],
  ['package/rpc.mjs', 'supabase/functions/ppc-package/rpc.mjs'],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = path => path.replaceAll('\\', '/');
const parent = resolve(tmpdir());
const directory = await mkdtemp(resolve(parent, 'ppc-ascm-flow-deployment-'));
const fakeSecret = 'deployment-check-secret-must-never-be-staged';
const previousSecret = process.env.PPC_ASCM_FLOW_SECRET;
process.env.PPC_ASCM_FLOW_SECRET = fakeSecret;

async function inventory(path, prefix = '') {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = prefix + entry.name;
    assert(!entry.isSymbolicLink(), `staging must not contain a symlink: ${child}`);
    if (entry.isDirectory()) files.push(...await inventory(resolve(path, entry.name), `${child}/`));
    else files.push(child);
  }
  return files.sort();
}

try {
  const result = await prepareAscmFlowDeployment({ outputDirectory: directory });
  assert.equal(result.directory, resolve(directory));
  assert.equal(result.files, 17);
  const manifestBytes = await readFile(resolve(directory, 'source-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.files.map(file => [file.path, file.source]), expectedSources,
    'the release must contain only reviewed worker, master and package modules');
  const expectedPaths = [...expectedSources.map(([path]) => path), 'source-manifest.json'].sort();
  assert.deepEqual(await inventory(directory), expectedPaths,
    'no credentials, environment files, OAuth SDK, payloads or unrelated files may enter the bundle');
  const stagedBytes = new Map();
  const targets = new Map(expectedSources.map(([target, source]) => [resolve(projectRoot, source), target]));
  for (const file of manifest.files) {
    assert(!file.path.startsWith('/') && !file.path.includes('..'));
    const canonicalPath = resolve(projectRoot, file.source);
    const canonical = await readFile(canonicalPath);
    const staged = await readFile(resolve(directory, file.path));
    stagedBytes.set(file.path, staged);
    assert.equal(file.sourceSha256, hash(canonical), `source bytes must match ${file.source}`);
    assert.equal(file.sha256, hash(staged), `staged bytes must match ${file.path}`);
    assert(!staged.includes(Buffer.from(fakeSecret)), 'environment credentials must never be embedded');
    const rewrittenMaster = file.path.startsWith('package/') ? '../master/' : './master/';
    const expectedText = canonical.toString('utf8')
      .replaceAll("'../ppc-master/", `'${rewrittenMaster}`).replaceAll('"../ppc-master/', `"${rewrittenMaster}`)
      .replaceAll("'../ppc-package/", "'./package/").replaceAll('"../ppc-package/', '"./package/');
    assert.deepEqual(staged, Buffer.from(expectedText), `only reviewed import paths may change in ${file.path}`);
    const imports = text => text.split(/\r?\n/).filter(line => /^\s*import\s/.test(line))
      .map(line => line.match(/["']([^"']+)["']/)?.[1]).filter(Boolean);
    const originalImports = imports(canonical.toString('utf8'));
    const stagedImports = imports(staged.toString('utf8'));
    assert.equal(stagedImports.length, originalImports.length, `imports preserved in ${file.path}`);
    for (let index = 0; index < originalImports.length; index++) {
      const original = originalImports[index], rewritten = stagedImports[index];
      if (!original.startsWith('.')) {
        assert.equal(original, 'node:crypto', 'the deployment has no network or npm dependency');
        assert.equal(rewritten, original);
        continue;
      }
      const expectedTarget = targets.get(resolve(dirname(canonicalPath), original));
      assert(expectedTarget, `canonical import ${original} must belong to the reviewed source set`);
      const stagedTarget = slash(relative(directory, resolve(dirname(resolve(directory, file.path)), rewritten)));
      assert.equal(stagedTarget, expectedTarget, `${file.path} must resolve ${original} within the staged bundle`);
      assert(expectedPaths.includes(stagedTarget), `staged import must exist: ${stagedTarget}`);
    }
  }
  const config = JSON.parse(stagedBytes.get('deno.json'));
  assert.deepEqual(Object.keys(config.imports || {}), [], 'no OAuth/SDK dependency configuration is necessary');
  assert(!config.lock, 'this local-only source closure requires no dependency lockfile');

  const entrypoint = stagedBytes.get('index.ts').toString('utf8');
  const entryImport = "import { createAscmFlowApplication } from './bootstrap.mjs';";
  assert.deepEqual(entrypoint.split(/\r?\n/).filter(line => /^\s*import\s/.test(line)), [entryImport]);
  const policy = JSON.stringify({ sourceSha256: 'b'.repeat(64), expiresAt: '2026-10-19T00:00:00Z' });
  const reads = []; const served = []; const handlers = [];
  runInNewContext(entrypoint.replace(entryImport, ''), {
    Deno: { env: { get(name) { reads.push(name); return name === 'PPC_ASCM_APPROVED_REPORT' ? policy : ''; } }, serve(handler) { served.push(handler); } },
    createAscmFlowApplication({ env }) { assert.equal(env.PPC_ASCM_APPROVED_REPORT, policy, 'the actual Deno entrypoint must forward the optional approval');
      const handler = () => {}; handlers.push(handler); return handler; },
  });
  assert.equal(reads.filter(name => name === 'PPC_ASCM_APPROVED_REPORT').length, 1, 'the native allowlist must read the optional approval');
  assert.equal(handlers.length, 1); assert.deepEqual(served, handlers, 'the native entrypoint must serve the configured application');

  const { createAscmFlowApplication } = await import(pathToFileURL(resolve(directory, 'bootstrap.mjs')).href);
  let networkCalls = 0;
  const handler = createAscmFlowApplication({ env: {}, fetchImpl: () => {
    networkCalls++;
    throw new Error('Deployment checks have no network access.');
  } });
  for (const request of [
    new Request('https://example.invalid/api/ascm/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    new Request('https://example.invalid/api/ascm/publication/queued', { method: 'POST', body: '{}' }),
  ]) assert.equal((await handler(request)).status, 404, 'the staged application stays disabled by default');
  assert.equal(networkCalls, 0, 'disabled staging must not initialize network services');

  await prepareAscmFlowDeployment({ outputDirectory: directory });
  assert.deepEqual(await readFile(resolve(directory, 'source-manifest.json')), manifestBytes, 'the manifest is deterministic');
  assert.deepEqual(await inventory(directory), expectedPaths);
  for (const [path, bytes] of stagedBytes) assert.deepEqual(await readFile(resolve(directory, path)), bytes, 'restaging preserves exact bytes');

  const unrelatedPath = resolve(directory, 'unrelated-owner-data.txt');
  await writeFile(unrelatedPath, 'preserve this unrelated file');
  await assert.rejects(prepareAscmFlowDeployment({ outputDirectory: directory }), /unexpected|unreviewed/i,
    'an existing unrelated file must stop staging instead of being silently bundled or deleted');
  assert.equal(await readFile(unrelatedPath, 'utf8'), 'preserve this unrelated file');
  assert.deepEqual(await readFile(resolve(directory, 'source-manifest.json')), manifestBytes);

  console.log('ASCM native flow deployment staging passed: 17 reviewed files, byte hashes, isolated imports, disabled defaults, no credential/payload copying and deterministic restaging.');
} finally {
  if (previousSecret === undefined) delete process.env.PPC_ASCM_FLOW_SECRET;
  else process.env.PPC_ASCM_FLOW_SECRET = previousSecret;
  const child = relative(parent, directory);
  assert(child.startsWith('ppc-ascm-flow-deployment-') && !child.includes(sep) && !child.includes('..'),
    'cleanup is limited to this check\'s allocated temporary directory');
  await rm(directory, { recursive: true, force: true });
}
