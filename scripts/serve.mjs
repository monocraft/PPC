import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPackageSource } from "./configure-package-source.mjs";
import { createMasterHandler } from "../server/master-service.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const documentRoot = path.resolve(scriptDirectory, "../public");
const rootPrefix = `${documentRoot}${path.sep}`;

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
]);

function readOption(name) {
  const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const position = process.argv.indexOf(`--${name}`);
  return position >= 0 ? process.argv[position + 1] : undefined;
}

const listenHost = readOption("host") || process.env.PORTFOLIO_HOST || "127.0.0.1";
const requestedPort = Number(readOption("port") || process.env.PORTFOLIO_PORT || 4173);
const masterFile = readOption("master-file") || process.env.PPC_MASTER_FILE;
const localEdits = process.argv.includes("--local-edits") || process.env.PPC_MASTER_LOCAL_EDITS === "1";
const demoKey = process.env.PPC_MASTER_DEMO_KEY || "";
if (masterFile && !["127.0.0.1", "localhost", "::1"].includes(listenHost)) throw new Error("Use the shared master service behind HTTPS for team access; the local preview must use loopback.");
if (demoKey && (!masterFile || !localEdits)) throw new Error("A demo requires its own local editable master.");
const masterHandler = masterFile ? createMasterHandler({ packageFile: masterFile, allowLocalEdits: localEdits, editorToken: process.env.PPC_MASTER_WRITE_TOKEN }) : null;

function currentPackageSource() {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  const host = listenHost === "::1" ? "[::1]" : listenHost;
  const origin = `http://${host}:${port}`;
  const packageEndpoint = masterFile ? `${origin}/api/package/latest` : readOption("package-endpoint") || process.env.PPC_PACKAGE_ENDPOINT;
  const masterEndpoint = masterFile ? `${origin}/api/master` : readOption("master-endpoint") || process.env.PPC_MASTER_ENDPOINT;
  let source = renderPackageSource(packageEndpoint, masterEndpoint);
  if (demoKey) source += `globalThis.PPC_MASTER_SOURCE = Object.freeze(${JSON.stringify({ endpoint: `${origin}/api/master`, label: "Demo master", demo: true, demoKey })});\n`;
  return source;
}

if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
  throw new Error("Port must be an integer between 0 and 65535.");
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(message),
  });
  response.end(message);
}

const server = createServer(async (request, response) => {
  if (masterHandler && await masterHandler(request, response)) return;
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendText(response, 405, "Method not allowed\n");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  } catch {
    sendText(response, 400, "Invalid URL\n");
    return;
  }

  if (pathname === "/js/package-source.js") {
    const packageSource = currentPackageSource();
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/javascript; charset=utf-8", "Content-Length": Buffer.byteLength(packageSource) });
    response.end(request.method === "HEAD" ? undefined : packageSource);
    return;
  }

  const relativePath = pathname.replace(/^\/+/, "") || "index.html";
  let filePath = path.resolve(documentRoot, relativePath);
  if (filePath !== documentRoot && !filePath.startsWith(rootPrefix)) {
    sendText(response, 403, "Forbidden\n");
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (fileStats.isDirectory()) filePath = path.join(filePath, "index.html");
    const finalStats = await stat(filePath);
    if (!finalStats.isFile()) throw new Error("Not a file");

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": finalStats.size,
      "Content-Type": mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).on("error", () => response.destroy()).pipe(response);
  } catch {
    sendText(response, 404, "Not found\n");
  }
});

server.listen(requestedPort, listenHost, () => {
  const address = server.address();
  const activePort = typeof address === "object" && address ? address.port : requestedPort;
  console.log(`Product Portfolio is available at http://${listenHost}:${activePort}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
