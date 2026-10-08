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
  let endpoint = String(value || "").trim() ? globalThis.PortfolioPackageClient.normalizeEndpoint(value) : "";
  const masterEndpoint = normalizeMasterEndpoint(masterValue);
  const mode = options.mode || "service";
  if (!["github", "service", "static"].includes(mode)) throw new Error("Choose GitHub, service or static master sharing.");
  if (mode === "github" && (endpoint || masterEndpoint)) throw new Error("GitHub package reads cannot also point to another master service.");
  if (mode === "static" && (endpoint || masterEndpoint)) throw new Error("Static sharing cannot also use a master service.");
  if (masterEndpoint) {
    const packageEndpoint = masterEndpoint.replace(/\/api\/master$/, "/api/package/latest");
    if (endpoint && endpoint !== packageEndpoint) throw new Error("Package and master addresses must use the same service origin and API base path.");
    endpoint = packageEndpoint;
  }
  let source;
  if (!endpoint && mode !== "static") {
    const config = globalThis.PortfolioMasterGitHub.normalizeConfig(options.github || {});
    source = { mode: "github", ...config, label: "Master portfolio" };
  } else {
    source = endpoint
      ? { mode: "relay", packageUrl: "", endpoint, label: "Shared portfolio" }
      : { mode: "static", packageUrl: "./data/master_ppc.pkg", endpoint: "", label: "Master portfolio" };
  }
  const master = { mode: "service", team: true, endpoint: masterEndpoint, label: "Master portfolio", setupRequired: !masterEndpoint && mode !== "static", ...(mode === "static" ? { readOnly: true } : {}) };
  return `/* Public addresses only. The team's GitHub connection belongs in the private backend, never in this file. */\nglobalThis.PPC_PACKAGE_SOURCE = Object.freeze(${JSON.stringify(source)});\nglobalThis.PPC_MASTER_SOURCE = Object.freeze(${JSON.stringify(master)});\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = process.argv.indexOf("--output");
  const relativeOutput = option >= 0 ? process.argv[option + 1] : "_site/js/package-source.js";
  if (!["_site/js/package-source.js", "public/js/package-source.js"].includes(relativeOutput)) throw new Error("Choose the site or local public package source file.");
  const output = path.join(projectRoot, relativeOutput);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, renderPackageSource(process.env.PPC_PACKAGE_ENDPOINT, process.env.PPC_MASTER_ENDPOINT, { mode: process.env.PPC_MASTER_MODE || undefined }), "utf8");
  console.log(process.env.PPC_MASTER_ENDPOINT ? "Private team master connection configured." : process.env.PPC_MASTER_MODE === "static" ? "Static encrypted master configured." : "Public master reads configured; private team saves await a backend address.");
}
