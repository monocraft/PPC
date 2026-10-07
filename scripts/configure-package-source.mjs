import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../public/js/package-client.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function renderPackageSource(value = "") {
  const endpoint = String(value || "").trim() ? globalThis.PortfolioPackageClient.normalizeEndpoint(value) : "";
  return `/* Approved package service URL. Never put a package key in this file. */\nglobalThis.PPC_PACKAGE_SOURCE = Object.freeze(${JSON.stringify({ endpoint, label: "Shared portfolio" })});\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = process.argv.indexOf("--output");
  const relativeOutput = option >= 0 ? process.argv[option + 1] : "_site/js/package-source.js";
  if (!["_site/js/package-source.js", "public/js/package-source.js"].includes(relativeOutput)) throw new Error("Choose the site or local public package source file.");
  const output = path.join(projectRoot, relativeOutput);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, renderPackageSource(process.env.PPC_PACKAGE_ENDPOINT), "utf8");
  console.log(process.env.PPC_PACKAGE_ENDPOINT ? "Shared package endpoint configured." : "Shared package endpoint is not configured; local package actions remain available.");
}
