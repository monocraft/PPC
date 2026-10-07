import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderVersionedIndex } from "../configure-site-version.mjs";

const version = "ac0c799a49a303f4cbe92b7df9d5cd578fc7a84a";
const html = `<!doctype html>
<!-- <script src="ignored.js"></script> -->
<link media="screen" href="css/styles.css?theme=dark&amp;v=old#palette" rel="stylesheet">
<LINK REL='alternate stylesheet' HREF='./css/print.CSS?mode=wide&v=old&v=older#page' disabled>
<link rel="preload" href="css/preload.css">
<link rel="stylesheet" href="https://cdn.example.org/remote.css">
<link rel="stylesheet" href="/rooted.css">
<a href="css/download.css">Download</a>
<script defer src="js/app.js"></script>
<script data-src="untouched.js" src='vendor/runtime.js?enabled=1#start'></script>
<script src=./js/module.js?%76=old&debug=yes#fragment></script>
<script src="../shared/helper.js?v=old"></script>
<script src="//cdn.example.org/remote.js"></script>
<script src="data:text/javascript,void(0)"></script>
<script src="https&colon;//cdn.example.org/remote.js"></script>
<script>const sample = '<link rel="stylesheet" href="ignored.css">';</script>
<textarea><script src="ignored.js"></script></textarea>
<style>body::before { content: '<link rel="stylesheet" href="ignored.css">'; }</style>`;
const expected = html
  .replace("css/styles.css?theme=dark&amp;v=old#palette", `css/styles.css?theme=dark&amp;v=${version}#palette`)
  .replace("./css/print.CSS?mode=wide&v=old&v=older#page", `./css/print.CSS?mode=wide&v=${version}#page`)
  .replace('src="js/app.js"', `src="js/app.js?v=${version}"`)
  .replace("vendor/runtime.js?enabled=1#start", `vendor/runtime.js?enabled=1&v=${version}#start`)
  .replace("./js/module.js?%76=old&debug=yes#fragment", `./js/module.js?debug=yes&v=${version}#fragment`)
  .replace("../shared/helper.js?v=old", `../shared/helper.js?v=${version}`);
assert.equal(renderVersionedIndex(html, version), expected, "only local script and stylesheet URLs should change");
assert.equal(renderVersionedIndex(expected, version), expected, "running versioning twice must be idempotent");
assert.equal(renderVersionedIndex(expected, "release-2").includes("v=release-2"), true);
for (const invalid of ["", "a".repeat(65), "release key", "x&key=private", 'x" onclick="bad', "../escape", "release?key=secret", null, 123]) {
  assert.throws(() => renderVersionedIndex(html, invalid));
}
assert.equal(renderVersionedIndex('<script src="file.json"></script><link rel="icon" href="icon.css">', "x"), '<script src="file.json"></script><link rel="icon" href="icon.css">');

const index = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
const updated = renderVersionedIndex(index, version);
const scripts = [...index.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(match => match[1]);
const updatedScripts = [...updated.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(match => match[1]);
assert.deepEqual(updatedScripts.map(value => value.split(/[?#]/, 1)[0]), scripts.map(value => value.split(/[?#]/, 1)[0]), "the real app runtime references and load order must stay unchanged");
assert.ok(updatedScripts.length > 0 && updatedScripts.every(value => new URL(value, "https://monocraft.github.io/PPC/").searchParams.get("v") === version));
assert.match(updated, new RegExp(`css/styles\\.css\\?v=${version}`));
assert.equal(renderVersionedIndex(updated, version), updated);
console.log("Site version checks passed: local JS/CSS only, preserved attributes/query/fragment/load order, remote and text exclusions, safe versions and idempotence.");
