import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");

function versionReference(value, version, extension) {
  const leading = value.match(/^\s*/)[0];
  const trailing = value.match(/\s*$/)[0];
  const reference = value.trim();
  if (!reference || reference.startsWith("/") || reference.startsWith("\\") || /^[a-z][a-z\d+.-]*:/i.test(reference)) return value;
  let hashAt = reference.indexOf("#");
  while (hashAt >= 0 && reference[hashAt - 1] === "&" && /^#(?:0*38|x0*26);/i.test(reference.slice(hashAt))) {
    hashAt = reference.indexOf("#", hashAt + 1);
  }
  const fragment = hashAt >= 0 ? reference.slice(hashAt) : "";
  const withoutFragment = hashAt >= 0 ? reference.slice(0, hashAt) : reference;
  const queryAt = withoutFragment.indexOf("?");
  const pathname = queryAt >= 0 ? withoutFragment.slice(0, queryAt) : withoutFragment;
  // Entity-encoded schemes and protocol-relative URLs must not become local assets.
  if (/[&\\]/.test(pathname) || !new RegExp(`\\.${extension}$`, "i").test(pathname)) return value;
  const query = queryAt >= 0 ? withoutFragment.slice(queryAt + 1) : "";
  const separator = /&amp;|&#0*38;|&#x0*26;/i.test(query) ? "&amp;" : "&";
  const entries = query.replace(/&amp;|&#0*38;|&#x0*26;/gi, "&").split("&").filter(Boolean).filter(entry => {
    const key = entry.split("=", 1)[0];
    try { return decodeURIComponent(key.replace(/\+/g, " ")) !== "v"; }
    catch { return key !== "v"; }
  });
  entries.push(`v=${version}`);
  return leading + pathname + "?" + entries.join(separator) + fragment + trailing;
}

function attribute(tag, name) {
  const expression = new RegExp(`((?:^|\\s)${name}\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s"'<>\x60]+))`, "i");
  const match = expression.exec(tag);
  if (!match) return null;
  return { expression, value: match[2] ?? match[3] ?? match[4] };
}

function versionAttribute(tag, name, version, extension) {
  const current = attribute(tag, name);
  if (!current) return tag;
  return tag.replace(current.expression, (_match, prefix, doubleValue, singleValue, bareValue) => {
    const quote = doubleValue !== undefined ? '"' : singleValue !== undefined ? "'" : "";
    return prefix + quote + versionReference(doubleValue ?? singleValue ?? bareValue, version, extension) + quote;
  });
}

export function renderVersionedIndex(html, version) {
  if (typeof html !== "string") throw new TypeError("Site index must be HTML text.");
  if (typeof version !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(version)) throw new Error("Site version must contain 1 to 64 letters, numbers, or hyphens.");
  const tags = /<!--[\s\S]*?-->|<(script|style|textarea|title)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<link\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  return html.replace(tags, block => {
    if (/^<script\b/i.test(block)) {
      return block.replace(/^<script\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i, tag => versionAttribute(tag, "src", version, "js"));
    }
    if (/^<link\b/i.test(block)) {
      const rel = attribute(block, "rel");
      if (rel?.value.toLowerCase().split(/\s+/).includes("stylesheet")) return versionAttribute(block, "href", version, "css");
    }
    return block;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  if (process.argv.length > 2) throw new Error("Site versioning only updates the prepared _site/index.html.");
  const version = process.env.PPC_SITE_VERSION || process.env.GITHUB_SHA || "";
  const output = path.join(projectRoot, "_site", "index.html");
  const html = await readFile(output, "utf8");
  await writeFile(output, renderVersionedIndex(html, version), "utf8");
  console.log("Prepared site scripts and styles use the deployment version.");
}
