import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const check = fileURLToPath(new URL('./ascm-sync-worker.py', import.meta.url));
if (process.platform !== 'win32') {
  console.log('UNSUPPORTED: Windows-native DPAPI, ACL, lock and checked-handle checks require Windows; no native pass claimed.');
} else {
  // Existing Python 3.11 runtime verified in the local runtime proof. No shell or PATH search.
  const python = path.join(homedir(), 'AppData', 'Local', 'Microsoft', 'WindowsApps',
    'PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0', 'python.exe');
  // Store execution aliases can report false through existsSync despite being executable.
  const proof = spawnSync(python, ['-I', '-c', 'import sys; print(sys.version_info.major, sys.version_info.minor)'],
    { shell: false, encoding: 'utf8', timeout: 15_000 });
  assert.equal(proof.status, 0, 'Verified Windows Python runtime is unavailable');
  assert.equal(proof.stdout.trim(), '3 11', 'Windows Python 3.11 is required');
  const result = spawnSync(python, ['-B', check], { shell: false, encoding: 'utf8', timeout: 120_000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Worker handoff, durable phase and Windows-native foundation checks failed');
  assert.doesNotMatch(result.stderr, /skipped=|\.\.\. skipped /, 'Windows release checks must not silently skip native evidence');
  console.log('LIMITATION: No Cloud Files placeholder was hydrated or fabricated; native Cloud-tagged reads and UNC share reads need authorized integration evidence.');
}
