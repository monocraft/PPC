import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { renderSharePointConfig } from "../configure-sharepoint-source.mjs";

const clientId = "12345678-1234-1234-1234-123456789abc";
const tenantId = "abcdef12-3456-7890-abcd-ef1234567890";
const valid = { clientId, tenantId, sharepointHosts: "northwind.sharepoint.com,northwind-my.sharepoint.com" };
const evaluate = source => {
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  const config = sandbox.PPCSelloutSharePointConfig;
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.sharepointHosts), true);
  assert.equal(Reflect.set(config, "clientId", "mutation"), false);
  assert.equal(Reflect.deleteProperty(config, "tenantId"), false);
  assert.equal(Reflect.set(config.sharepointHosts, "0", "evil.example"), false);
  return JSON.parse(JSON.stringify(config));
};

const disabled = { clientId: "", tenantId: "", sharepointHosts: [] };
assert.deepEqual(evaluate(renderSharePointConfig()), disabled);
assert.deepEqual(evaluate(renderSharePointConfig({ clientId: " ", tenantId: "", sharepointHosts: "\t" })), disabled);
const publicDefault = await readFile(new URL("../../public/js/sellout-sharepoint-config.js", import.meta.url), "utf8");
assert.equal(publicDefault.replace(/\r\n/g, "\n"), renderSharePointConfig(), "Source checkout must remain disabled and contain no tenant or workbook values.");
assert.deepEqual(evaluate(renderSharePointConfig(valid)), { clientId, tenantId, sharepointHosts: ["northwind.sharepoint.com", "northwind-my.sharepoint.com"] });
assert.deepEqual(evaluate(renderSharePointConfig({ clientId: ` ${clientId.toUpperCase()} `, tenantId: tenantId.toUpperCase(), sharepointHosts: " NORTHWIND.SHAREPOINT.COM , northwind-my.sharepoint.com " })), evaluate(renderSharePointConfig(valid)));
assert.deepEqual(Object.keys(evaluate(renderSharePointConfig(valid))).sort(), ["clientId", "sharepointHosts", "tenantId"]);
const unchanged = JSON.stringify(valid); renderSharePointConfig(valid); assert.equal(JSON.stringify(valid), unchanged);

const invalid = [
  null, [], new URL("https://example.test"),
  { clientId }, { tenantId }, { sharepointHosts: valid.sharepointHosts },
  { ...valid, clientId: "private-access-token" }, { ...valid, tenantId: "tenant-name" },
  { ...valid, clientId: "00000000-0000-0000-0000-000000000000" }, { ...valid, tenantId: "00000000-0000-0000-0000-000000000000" },
  { ...valid, clientId: "{" + clientId + "}" }, { ...valid, tenantId: tenantId + "\nprivate" },
  { ...valid, clientId: 123 }, { ...valid, sharepointHosts: ["northwind.sharepoint.com"] },
  { ...valid, clientSecret: "private-client-secret" }, { ...valid, workbookUrl: "private-workbook-url" },
  ...["", "sharepoint.com", "sub.northwind.sharepoint.com", "*.sharepoint.com", "northwind.sharepoint.com.evil.example", "https://northwind.sharepoint.com", "northwind.sharepoint.com:443", "northwind.sharepoint.com/Report.xlsx", "member@northwind.sharepoint.com", "northwind.sharepoint.com.", "-northwind.sharepoint.com", "northwind-.sharepoint.com", "northwind.sharepoint.com?private", "northwind.sharepoint.com#private", "northwind.sharepoint.com,,northwind-my.sharepoint.com", "northwind.sharepoint.com,", "northwind.sharepoint.com,NORTHWIND.SHAREPOINT.COM", "northwind.sharepoint.com\nprivate", "northwind.sharepoint.com\u202e", "northwind.sharepoint.com</script>", "x".repeat(64) + ".sharepoint.com", Array.from({ length: 21 }, (_, index) => `tenant${index}.sharepoint.com`).join(",")].map(sharepointHosts => ({ ...valid, sharepointHosts })),
];
for (const input of invalid) assert.throws(() => renderSharePointConfig(input), error => {
  assert.ok(error.message.length < 150 && !/private|northwind|12345678|abcdef12|token/i.test(error.message), "Configuration errors must not echo input values or credentials.");
  return true;
});
let getterReads = 0;
const accessor = { ...valid }; Object.defineProperty(accessor, "clientId", { enumerable: true, get() { getterReads++; return clientId; } });
assert.throws(() => renderSharePointConfig(accessor)); assert.equal(getterReads, 0);
const output = renderSharePointConfig(valid);
assert.ok(!/<|>|\u2028|\u2029/.test(output), "Generated settings must contain only fixed safe characters and JSON-encoded allowlisted values.");

// Execute the actual builder only inside an isolated temporary checkout.
const temporaryParent = path.resolve(os.tmpdir());
const temporary = path.resolve(await mkdtemp(path.join(temporaryParent, "ppc-sharepoint-source-")));
assert.equal(path.dirname(temporary), temporaryParent);
assert.match(path.basename(temporary), /^ppc-sharepoint-source-/);
try {
  await mkdir(path.join(temporary, "scripts"));
  const builder = path.join(temporary, "scripts/configure-sharepoint-source.mjs");
  await copyFile(new URL("../configure-sharepoint-source.mjs", import.meta.url), builder);
  const prepared = path.join(temporary, "_site/js/sellout-sharepoint-config.js");
  const environment = { ...process.env, PPC_SHAREPOINT_CLIENT_ID: "", PPC_SHAREPOINT_TENANT_ID: "", PPC_SHAREPOINT_HOSTS: "" };
  const execute = (env = {}, args = []) => spawnSync(process.execPath, [builder, ...args], { cwd: temporary, env: { ...environment, ...env }, encoding: "utf8" });
  let result = execute(); assert.equal(result.status, 0, result.stderr); assert.deepEqual(evaluate(await readFile(prepared, "utf8")), disabled);
  result = execute({ PPC_SHAREPOINT_CLIENT_ID: clientId, PPC_SHAREPOINT_TENANT_ID: tenantId, PPC_SHAREPOINT_HOSTS: valid.sharepointHosts, PPC_SHAREPOINT_CLIENT_SECRET: "private-ignored-environment" });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(evaluate(await readFile(prepared, "utf8")), evaluate(output));
  assert.ok(!/12345678|abcdef12|northwind|private-ignored/.test(result.stdout + result.stderr), "Successful build output must not echo connection values or unrelated secret environment variables.");
  const sentinel = "preserve-existing-prepared-settings";
  for (const [env, args] of [
    [{ PPC_SHAREPOINT_CLIENT_ID: clientId }, []],
    [{ PPC_SHAREPOINT_CLIENT_ID: "private-invalid-value", PPC_SHAREPOINT_TENANT_ID: tenantId, PPC_SHAREPOINT_HOSTS: valid.sharepointHosts }, []],
    [{ PPC_SHAREPOINT_CLIENT_ID: "00000000-0000-0000-0000-000000000000", PPC_SHAREPOINT_TENANT_ID: tenantId, PPC_SHAREPOINT_HOSTS: valid.sharepointHosts }, []],
    [{ PPC_SHAREPOINT_CLIENT_ID: clientId, PPC_SHAREPOINT_TENANT_ID: "00000000-0000-0000-0000-000000000000", PPC_SHAREPOINT_HOSTS: valid.sharepointHosts }, []],
    [{ PPC_SHAREPOINT_CLIENT_ID: clientId, PPC_SHAREPOINT_TENANT_ID: tenantId, PPC_SHAREPOINT_HOSTS: "private.invalid.example" }, []],
    [{}, ["--output", "public/js/sellout-sharepoint-config.js"]],
  ]) {
    await writeFile(prepared, sentinel);
    result = execute(env, args); assert.notEqual(result.status, 0); assert.equal(await readFile(prepared, "utf8"), sentinel, "Invalid configuration or CLI options must fail before overwriting output.");
    assert.ok(!/private-invalid-value|private\.invalid\.example|northwind|12345678|abcdef12/.test(result.stdout + result.stderr), "Rejected input values must remain out of build logs.");
  }
  const preparedRoot = path.resolve(temporary, "_site");
  assert.equal(path.relative(temporary, preparedRoot), "_site");
  await rm(preparedRoot, { recursive: true });
  result = execute({ PPC_SHAREPOINT_TENANT_ID: tenantId }); assert.notEqual(result.status, 0);
  await assert.rejects(readFile(prepared), { code: "ENOENT" }, "Partial settings must fail before creating output.");
} finally {
  assert.equal(path.dirname(temporary), temporaryParent);
  assert.match(path.basename(temporary), /^ppc-sharepoint-source-/);
  await rm(temporary, { recursive: true, force: true });
}
console.log("SharePoint source: disabled default, complete nonsecret settings, strict GUID/tenant host validation, immutable output, private errors/logs, and isolated fail-before-write builder checks passed.");
