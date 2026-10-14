import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source = fs.readFileSync(new URL("../../public/js/sellout-sharepoint.js", import.meta.url), "utf8");
const forbidden = () => { throw new Error("Link inspection accessed a side effect."); };
const sandbox = { URL, console: { log: forbidden, warn: forbidden, error: forbidden }, fetch: forbidden, XMLHttpRequest: forbidden };
Object.defineProperties(sandbox, { localStorage: { get: forbidden }, sessionStorage: { get: forbidden }, navigator: { get: forbidden } });
vm.runInNewContext(source, sandbox);
const { inspectLink } = sandbox.PPCSelloutSharePoint;
const host = "northwind.sharepoint.com", personal = "northwind-my.sharepoint.com";
const accepted = [
  `https://${host}/:x:/g/EXAMPLEopaqueToken_123-ABC?e=example&CID=fixture-123`,
  `https://${host}/:x:/s/Planning/EXAMPLEopaqueID?e=example&CID=fixture-123`,
  `https://${personal}/:x:/g/personal/member_northwind_com/EXAMPLEopaqueID?e=example`,
  `https://${personal}/:x:/p/member/EXAMPLEopaqueID?e=example&CID=fixture-123`,
  `https://${host}/:x:/r/sites/Planning/Shared%20Documents/Report.xlsx?d=fixture&csf=1&web=1&e=example`,
  `https://${host}/sites/Planning/Shared%20Documents/Annual%20Summary.XLSX?web=1`,
  `https://${host}/sites/Planning/100%25%20Complete.xlsx`,
  `https://${host}/sites/Planning/O'Brien.xlsx`,
  `https://${host}/sites/Planning/_layouts/15/Doc.aspx?sourcedoc=%7B12345678-1234-1234-1234-123456789abc%7D&file=Report.xlsx&action=default&mobileredirect=true`,
  `https://${host}/_layouts/15/Doc.aspx?sourcedoc=%2Fsites%2FPlanning%2FReport.xlsx`,
  `https://${host}/_layouts/15/Doc.aspx?sourcedoc=Report.xlsx`,
  `https://${host}/_layouts/15/Doc.aspx?sourcedoc=${encodeURIComponent(`https://${host}/sites/Planning/Report.xlsx`)}`,
];
for (const input of accepted) {
  const result = inspectLink(input);
  assert.equal(result.url, new URL(input).href); assert.equal(result.host, new URL(input).hostname);
  assert.equal(Object.isFrozen(result), true); assert.deepEqual(Object.keys(result).sort(), ["host", "url"]);
}
assert.equal(inspectLink(`  HTTPS://NORTHWIND.SHAREPOINT.COM/sites/Planning/Report.xlsx  `).url, `https://${host}/sites/Planning/Report.xlsx`);
const rejected = [
  null, undefined, {}, 1, "", "  ", "/sites/Report.xlsx", `//${host}/Report.xlsx`, `http://${host}/Report.xlsx`,
  `https://evil.example/Report.xlsx`, `https://${host}.evil.example/Report.xlsx`, `https://evil-sharepoint.com/Report.xlsx`, `https://sharepoint.com/Report.xlsx`, `https://sub.${host}/Report.xlsx`, `https://${host}./Report.xlsx`,
  `https://member:password@${host}/Report.xlsx`, `https://@${host}/Report.xlsx`, `https://${host}:443/Report.xlsx`, `https://${host}:8443/Report.xlsx`,
  `https://${host}/`, `https://${host}/sites/Planning`, `https://${host}/sites/Planning/Shared%20Documents/`, `https://${host}/:f:/s/Planning/EXAMPLEopaqueID`, `https://${host}/:x:/r/sites/Planning/Shared%20Documents/`,
  `https://${host}/sites/Planning/Report.csv`, `https://${host}/sites/Planning/Report.xlsx/`, `https://${host}/:x:/g/`,
  `https://${host}/login/Report.xlsx`, `https://${host}/_layouts/15/Authenticate.aspx?Source=Report.xlsx`, `https://${host}/oauth2/authorize`,
  `https://${host}/Report.xlsx?access_token=private`, `https://${host}/Report.xlsx?ID-TOKEN=private`, `https://${host}/Report.xlsx?%2561ccess_token=private`, `https://${host}/Report.xlsx?client_secret=private`, `https://${host}/Report.xlsx?Authorization=Bearer%20private`, `https://${host}/Report.xlsx?authkey=private`, `https://${host}/Report.xlsx?token=private`, `https://${host}/Report.xlsx?code=private`,
  `https://${host}/Report.xlsx?redirect_uri=https%3A%2F%2Fevil.example`, `https://${host}/Report.xlsx?x=Authorization%3A%20Bearer%20private`, `https://${host}/Report.xlsx?x=javascript%3Aalert(1)`, `https://${host}/Report.xlsx?headers=private`,
  `https://${host}/Report.xlsx#access_token=private`, `https://${host}/Report.xlsx#sheet=1`,
  `https://${host}/Report.xlsx?x=<script>alert(1)</script>`, `https://${host}/Report.xlsx?x=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E`, `https://${host}/Report.xlsx?x=%253Cscript%253E`, `https://${host}/Report.xlsx?x=%26lt%3Bscript%26gt%3B`,
  `https://${host}/Report.xlsx\r\nAuthorization: Bearer private`, `https://${host}/Report.xlsx?x=\u0000`, `https://${host}/Report.xlsx?x=%0d%0aAuthorization%3ABearer`, `https://${host}/Report.xlsx?x=%250d%250aAuthorization`, `https://${host}/Report.xlsx?x=\u202eprivate`, `https://${host}\\@evil.example/Report.xlsx`, `https://${host}/Report.xlsx?x=%5c`,
  `https://${host}/Report.xlsx?x=%zz`, `https://${host}/Report.xlsx?x=%ff`,
  `https://${host}/_layouts/15/Doc.aspx`, `https://${host}/_layouts/15/Doc.aspx?sourcedoc=`, `https://${host}/_layouts/15/Doc.aspx?sourcedoc=folder`, `https://${host}/_layouts/15/Doc.aspx?sourcedoc=Report.xlsx&sourcedoc=Other.xlsx`, `https://${host}/_layouts/15/Doc.aspx?sourcedoc=${encodeURIComponent("https://evil.example/Report.xlsx")}`, `https://${host}/_layouts/15/Doc.aspx?sourcedoc=${encodeURIComponent(`https://${host}:443/Report.xlsx`)}`,
  `https://${host}/_layouts/15/Doc.aspx?sourcedoc=12345678-1234-1234-1234-123456789abc&file=Report.docx`,
  `https://${host}/_layouts/15/Doc.aspx?sourcedoc=Report.xlsx&file=Report.xlsx&file=Other.xlsx`,
  `https://${host}/Report.xlsx?e=${"x".repeat(4096)}`,
  `https://${host}/:f:/s/Planning/Folder.xlsx`, `https://${host}/:w:/r/sites/Planning/Report.xlsx`,
  `https://${host}/100%25%250AReport.xlsx`, `https://${host}/100%25ff%250D%250AReport.xlsx`,
  `https://${host}/_layouts/15/Doc.aspx?sourcedoc=%7B12345678-1234-1234-1234-123456789abc`, `https://${host}/_layouts/15/Doc.aspx?sourcedoc=12345678-1234-1234-1234-123456789abc%7D`,
  `https://${host}/${"é".repeat(1000)}.xlsx`,
  `https://${host}/:x:/`, `https://${host}/:x:/g`, `https://${host}/:x:/g/`, `https://${host}/:f:/g/EXAMPLEopaqueToken_123-ABC`,
  `https://${host}/Report.xlsx?%2577ctx=private`, `https://${host}/Report.xlsx?LogIn-HiNt=private`,
  ...["wa", "wctx", "wtrealm", "wfresh", "estsrequest", "estsredirect", "nonce", "state", "sid", "login_hint"].map(name => `https://${host}/Report.xlsx?${name}=private`),
];
for (const input of rejected) {
  assert.throws(() => inspectLink(input), error => {
    assert.equal(error.name, "Error");
    assert.ok(error.message.length < 140 && !/private|EXAMPLEopaqueID|northwind/i.test(error.message), "Errors must not echo the supplied private URL or credentials.");
    return true;
  }, `Unexpectedly accepted invalid fixture ${rejected.indexOf(input)}`);
}
assert.equal(Object.isFrozen(sandbox.PPCSelloutSharePoint), true);
console.log(`SharePoint workbook locator: ${accepted.length} accepted shapes and ${rejected.length} unsafe/non-workbook fixtures passed; normalization, private errors, and no network/auth/storage side effects verified.`);
