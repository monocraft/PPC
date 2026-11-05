// Deterministic numeric measurements only. Installed font binaries stay local.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const modules = option('--runtime-modules') || process.env.RUNTIME_NODE_MODULES;
if (!modules) throw new Error('Supply --runtime-modules <node_modules path> or RUNTIME_NODE_MODULES with the local skia-canvas installation.');
const require = createRequire(path.join(path.resolve(modules), '@oai/artifact-tool/package.json'));
const { Canvas, FontLibrary } = require('skia-canvas');
const fontDirectory = option('--font-dir') || path.join(process.env.WINDIR || 'C:/Windows', 'Fonts');
const files = ['ARIALN.TTF', 'ARIALNB.TTF'].map(file => path.join(fontDirectory, file));
FontLibrary.use('Arial Narrow', files);
const context = new Canvas(1, 1).getContext('2d');
const unitsPerEm = 1024;
const measure = (value, bold) => {
  context.font = `${bold ? 'bold ' : ''}${unitsPerEm}px "Arial Narrow"`;
  return context.measureText(value).width;
};
const characters = [...new Set([
  ...Array.from({ length: 95 }, (_, index) => String.fromCodePoint(index + 32)),
  ...Array.from({ length: 96 }, (_, index) => String.fromCodePoint(index + 160)),
  ...'‐‑‒–—‘’‚“”„•…′″™€',
])];
const round = number => Number(number.toFixed(6));
const faces = {};
for (const bold of [false, true]) {
  const advances = Object.fromEntries(characters.map(character => [character, round(measure(character, bold))]));
  const kerning = {};
  for (const first of characters) for (const second of characters) {
    const adjustment = round(measure(first + second, bold) - advances[first] - advances[second]);
    if (adjustment) kerning[first + second] = adjustment;
  }
  assert.ok(advances.W > 0 && advances[' '] > 0);
  faces[bold ? 'bold' : 'regular'] = { advances, kerning };
}
const sourceFontSha256 = Object.fromEntries(await Promise.all(files.map(async (file, index) => [index ? 'bold' : 'regular', createHash('sha256').update(await readFile(file)).digest('hex')])));
const metrics = { schemaVersion: 1, fontFamily: 'Arial Narrow', unitsPerEm, sourceFontSha256, characters: characters.join(''), faces };
const material = JSON.stringify(metrics, null, 2) + '\n';
const output = option('--output') || fileURLToPath(new URL('../public/assets/pptx/arial-narrow-metrics.json', import.meta.url));
if (args.includes('--check')) assert.equal(await readFile(output, 'utf8'), material, 'Checked-in numeric metrics differ from the installed reference fonts.');
else { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, material); }
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(material), sha256: createHash('sha256').update(material).digest('hex'), characters: characters.length, checked: args.includes('--check') }));
