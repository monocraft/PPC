import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const zeroGuid = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;
const host = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sharepoint\.com$/i;
const fields = new Set(["clientId", "tenantId", "sharepointHosts"]);

function settings(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) {
    throw new Error("Use only public SharePoint connection settings.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(options);
  if (Reflect.ownKeys(descriptors).some(name => !fields.has(name) || !Object.hasOwn(descriptors[name], "value"))) {
    throw new Error("Use only public SharePoint connection settings.");
  }
  const value = name => {
    const input = descriptors[name]?.value;
    if (input === undefined) return "";
    if (typeof input !== "string") throw new Error("SharePoint connection settings must be text.");
    return input.trim();
  };
  const clientId = value("clientId"), tenantId = value("tenantId"), hosts = value("sharepointHosts");
  if (!clientId && !tenantId && !hosts) return { clientId: "", tenantId: "", sharepointHosts: [] };
  if (!clientId || !tenantId || !hosts) throw new Error("Configure all three public SharePoint connection settings, or leave all three empty.");
  if (!guid.test(clientId) || !guid.test(tenantId) || zeroGuid.test(clientId) || zeroGuid.test(tenantId)) throw new Error("Use valid Microsoft application and tenant identifiers.");
  const sharepointHosts = hosts.split(",").map(value => value.trim().toLowerCase());
  if (sharepointHosts.length > 20 || sharepointHosts.some(value => !host.test(value))
      || new Set(sharepointHosts).size !== sharepointHosts.length) {
    throw new Error("Use a comma-separated list of distinct organization SharePoint hostnames.");
  }
  return { clientId: clientId.toLowerCase(), tenantId: tenantId.toLowerCase(), sharepointHosts };
}

export function renderSharePointConfig(options = {}) {
  const config = settings(options);
  return `/* Public Microsoft app identifiers only. Never add credentials or workbook URLs. */\nglobalThis.PPCSelloutSharePointConfig = Object.freeze({\n  clientId: ${JSON.stringify(config.clientId)},\n  tenantId: ${JSON.stringify(config.tenantId)},\n  sharepointHosts: Object.freeze(${JSON.stringify(config.sharepointHosts)}),\n});\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  if (process.argv.length > 2) throw new Error("SharePoint configuration accepts no command-line options.");
  // Validate the complete configuration before creating or changing any output.
  const rendered = renderSharePointConfig({
    clientId: process.env.PPC_SHAREPOINT_CLIENT_ID,
    tenantId: process.env.PPC_SHAREPOINT_TENANT_ID,
    sharepointHosts: process.env.PPC_SHAREPOINT_HOSTS,
  });
  const output = path.join(projectRoot, "_site/js/sellout-sharepoint-config.js");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, rendered, "utf8");
  console.log("Public SharePoint connection configuration prepared.");
}
