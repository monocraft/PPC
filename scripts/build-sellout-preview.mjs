import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const option = key => { const i = process.argv.indexOf(key); return i >= 0 ? process.argv[i + 1] : null; };
const snapshotPath = path.resolve(option("--snapshot") || path.join(projectRoot, "project-data/private/sellout-dashboard/snapshot.json"));
const outputPath = path.resolve(option("--output") || path.join(projectRoot, "outputs/sellout-dashboard/retail-analytics.html"));
const publicRoot = path.join(projectRoot, "public");
if (outputPath === publicRoot || outputPath.startsWith(publicRoot + path.sep)) throw new Error("A populated private dashboard cannot be saved under public/.");
await import(pathToFileURL(path.join(publicRoot, "js/sellout-model.js")));
const data = JSON.parse(await readFile(snapshotPath, "utf8"));
const snapshot = data.snapshot || data;
const validation = globalThis.PPCSelloutModel.validateSnapshot(snapshot);
if (!validation.ok) throw new Error(validation.errors.join(" "));
let html = await readFile(path.join(publicRoot, "analytics.html"), "utf8");
for (const match of [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)]) {
  let css = await readFile(path.join(publicRoot, match[1]), "utf8");
  if (match[1] === "css/fonts.css") for (const url of [...css.matchAll(/url\("([^\"]+)"\)/g)]) {
    const font = await readFile(path.resolve(path.dirname(path.join(publicRoot, match[1])), url[1]));
    css = css.replace(url[0], `url("data:font/ttf;base64,${font.toString("base64")}")`);
  }
  html = html.replace(match[0], () => `<style>\n${css}\n</style>`);
}
for (const match of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]) {
  const script = await readFile(path.join(publicRoot, match[1]), "utf8");
  const seed = match[1] === "js/sellout-dashboard.js" ? `globalThis.PPC_RETAIL_LOCAL_SNAPSHOT=${JSON.stringify(data).replace(/</g, "\\u003c")};\n` : "";
  html = html.replace(match[0], () => `<script>\n${seed}${script.replace(/<\/script/gi, "<\\/script")}\n</script>`);
}
html = html.replace('href="index.html"', 'href="https://monocraft.github.io/PPC/"');
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, html);
console.log(`Populated private dashboard saved: ${outputPath}`);
if (process.argv.includes("--serve")) {
  const port = Number(option("--port") || 4185);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose a valid local preview port.");
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (!["/", "/analytics.html", "/retail-analytics.html"].includes(pathname)) { res.writeHead(404); res.end("Not found"); return; }
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405); res.end("Method not allowed"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : await readFile(outputPath));
  });
  server.listen(port, "127.0.0.1", () => console.log(`Private analytics preview: http://127.0.0.1:${port}/`));
}
