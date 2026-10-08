import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shared = ['master-model.js', 'package-codec.js'];
export async function buildSupabaseMaster({ check = false } = {}) {
  const targetDirectory = resolve(projectRoot, 'supabase/functions/ppc-master/shared');
  if (!check) await mkdir(targetDirectory, { recursive: true });
  for (const name of shared) {
    const content = await readFile(resolve(projectRoot, 'public/js', name), 'utf8');
    const target = resolve(targetDirectory, name);
    if (check) {
      let current;
      try { current = await readFile(target, 'utf8'); } catch { throw new Error(`The Supabase shared ${name} needs regeneration.`); }
      if (current !== content) throw new Error(`The Supabase shared ${name} differs from the canonical browser model. Run scripts/build-supabase-master.mjs.`);
    } else await writeFile(target, content, 'utf8');
  }
  return { modules: shared.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await buildSupabaseMaster({ check: process.argv.includes('--check') });
    console.log(process.argv.includes('--check') ? 'Supabase shared models match the browser source.' : 'Supabase shared models regenerated from the browser source.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
