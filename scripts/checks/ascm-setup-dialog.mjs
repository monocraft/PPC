import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.log('UNSUPPORTED: ASCM setup dialog checks require the pinned Windows Python/Tk runtime; no native pass claimed.');
} else {
  const python = path.join(homedir(), 'AppData', 'Local', 'Microsoft', 'WindowsApps',
    'PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0', 'python.exe');
  const check = fileURLToPath(new URL('./ascm-setup-dialog.py', import.meta.url));
  const result = spawnSync(python, ['-I', '-B', check], {
    shell: false, encoding: 'utf8', timeout: 120_000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Synthetic ASCM setup dialog checks failed');
  assert.doesNotMatch(result.stderr, /skipped=|\.\.\. skipped /,
    'Windows dialog checks must not silently skip native Tk evidence');
}
