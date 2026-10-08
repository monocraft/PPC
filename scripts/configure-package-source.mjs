import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../public/js/package-client.js";
import "../public/js/master-github.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function normalizeMasterEndpoint(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  let url;
  try { url = new URL(text); } catch { throw new Error("Invalid shared master service address."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/api/master")) {
    throw new Error("Use a secure shared master service address ending in /api/master.");
  }
  return url.href;
}

export function renderPackageSource(value = "", masterValue = "", options = {}) {
  const endpoint = String(value || "").trim() ? globalThis.PortfolioPackageClient.normalizeEndpoint(value) : "";
  const masterEndpoint = normalizeMasterEndpoint(masterValue);
  const mode = options.mode || (endpoint || masterEndpoint ? "service" : "github");
  if (!["github", "service", "static"].includes(mode)) throw new Error("Choose GitHub, service or static master sharing.");
  if (mode === "github") {
    if (endpoint || masterEndpoint) throw new Error("GitHub sharing cannot also point to another master service.");
    const config = globalThis.PortfolioMasterGitHub.normalizeConfig(options.github || {});
    const source = { mode: "github", ...config, label: "Master portfolio" };
    return `/* GitHub stores the encrypted master. Keys and access tokens stay on each user's device. */\nglobalThis.PPC_PACKAGE_SOURCE = Object.freeze(${JSON.stringify(source)});\nglobalThis.PPC_MASTER_SOURCE = Object.freeze(${JSON.stringify(source)});\n`;
  }
  if (mode === "static" && (endpoint || masterEndpoint)) throw new Error("Static sharing cannot also use a master service.");
  const source = endpoint
    ? { mode: "relay", packageUrl: "", endpoint, label: "Shared portfolio" }
    : { mode: "static", packageUrl: "./data/master_ppc.pkg", endpoint: "", label: "Master portfolio" };
  return `/* Public connection addresses only. Package and publisher credentials stay private. */\nglobalThis.PPC_PACKAGE_SOURCE = Object.freeze(${JSON.stringify(source)});\nglobalThis.PPC_MASTER_SOURCE = Object.freeze(${JSON.stringify({ mode: "service", endpoint: masterEndpoint, team: Boolean(masterEndpoint && /\/functions\/v1\/ppc-master\/api\/master$/.test(new URL(masterEndpoint).pathname)), label: "Master portfolio" })});\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = process.argv.indexOf("--output");
  const relativeOutput = option >= 0 ? process.argv[option + 1] : "_site/js/package-source.js";
  if (!["_site/js/package-source.js", "public/js/package-source.js"].includes(relativeOutput)) throw new Error("Choose the site or local public package source file.");
  const output = path.join(projectRoot, relativeOutput);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, renderPackageSource(process.env.PPC_PACKAGE_ENDPOINT, process.env.PPC_MASTER_ENDPOINT, { mode: process.env.PPC_MASTER_MODE || undefined }), "utf8");
  console.log(process.env.PPC_MASTER_ENDPOINT ? "Private team saving and encrypted package configured." : process.env.PPC_PACKAGE_ENDPOINT ? "Shared package service configured." : process.env.PPC_MASTER_MODE === "static" ? "Static encrypted master configured." : "GitHub encrypted master sharing configured.");
}
