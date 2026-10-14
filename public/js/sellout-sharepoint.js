/* Inspect a private workbook locator only; connection and permission are external. */
(function (root) {
  "use strict";
  const controls = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/;
  const markup = /[<>"`]|&(?:lt|gt|quot|#0*(?:34|39|60|62)|#x0*(?:22|27|3c|3e));/i;
  const hostPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.sharepoint\.com$/i;
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const sensitive = new Set(["accesstoken", "idtoken", "refreshtoken", "authtoken", "token", "auth", "authkey", "authorization", "authentication", "bearer", "password", "passwd", "pwd", "clientsecret", "secret", "credential", "credentials", "samlresponse", "assertion", "code", "authorizationcode", "session", "sessionid", "headers", "header", "wa", "wctx", "wtrealm", "wfresh", "estsrequest", "estsredirect", "nonce", "state", "sid", "loginhint"]);
  function fail(message) { throw new Error(message); }
  // Repeated decoding catches encoded header/HTML payloads, including double
  // encoding. A literal percent in a valid filename is allowed after decoding.
  function decoded(input) {
    let value = input, first = true;
    while (true) {
      if (controls.test(value) || markup.test(value) || value.includes("\\")) fail("Paste a workbook link without unsafe characters.");
      if (!/%[0-9a-f]{2}/i.test(value)) {
        if (first && /%(?![0-9a-f]{2})/i.test(value)) fail("The workbook link contains invalid encoding.");
        return value;
      }
      let next;
      if (first) {
        try { next = decodeURIComponent(value); } catch { fail("The workbook link contains invalid encoding."); }
      } else {
        next = value.replace(/(?:%[0-9a-f]{2})+/gi, part => {
          try { return decodeURIComponent(part); } catch {
            // A decoded literal percent must not hide a separately encoded CRLF.
            return part.replace(/%([0-7][0-9a-f])/gi, (_, byte) => String.fromCharCode(parseInt(byte, 16)));
          }
        });
      }
      if (next === value) return value;
      value = next; first = false;
    }
  }
  function safeQuery(url) {
    for (const [rawName, rawValue] of url.searchParams) {
      const name = decoded(rawName).toLowerCase().replace(/[^a-z0-9]/g, ""), value = decoded(rawValue);
      if (sensitive.has(name) || /(?:access|id|refresh|auth|security|identity)token$/.test(name) || /(?:password|clientsecret|credential)$/.test(name)) fail("Paste the workbook sharing link without sign-in tokens or credentials.");
      if (/^(?:javascript|data|vbscript):/i.test(value.trim()) || /\b(?:proxy-)?authorization\s*:/i.test(value) || /^\s*(?:bearer|basic)\s+\S/i.test(value)) fail("Paste the workbook sharing link without sign-in tokens or scripts.");
      if (/^(?:redirect|redirecturi|redirecturl|returnurl|returnto|next|continue|callback|callbackurl)$/.test(name)) fail("Paste a workbook link rather than a sign-in or redirect link.");
    }
  }
  function sourceDocument(value, host) {
    const source = decoded(value).trim();
    if (guid.test(source) || source.startsWith("{") && source.endsWith("}") && guid.test(source.slice(1, -1))) return true;
    if (source.startsWith("/") && !source.startsWith("//") && /\.xlsx$/i.test(source) && !/[?#]/.test(source)) return true;
    if (/^[^/:?#]+\.xlsx$/i.test(source)) return true;
    if (/^https:\/\//i.test(source)) {
      let nested; try { nested = new URL(source); } catch { return false; }
      return nested.hostname === host && !nested.username && !nested.password && !nested.port && !nested.hash && !nested.search && /^https:\/\/[^/?#:]+\//i.test(source) && /\.xlsx$/i.test(decoded(nested.pathname));
    }
    return false;
  }
  function inspectLink(input) {
    if (typeof input !== "string" || !input.trim()) fail("Paste a SharePoint Excel workbook link.");
    if (input.length > 4096) fail("The workbook link is too long.");
    decoded(input);
    const value = input.trim(), authority = /^https:\/\/([^/?#]+)/i.exec(value);
    if (!authority) fail("Use an HTTPS SharePoint workbook link.");
    if (authority[1].includes("@")) fail("Paste the workbook sharing link without credentials.");
    if (authority[1].includes(":")) fail("Use a SharePoint workbook link without a custom port.");
    let url; try { url = new URL(value); } catch { fail("The workbook link is not a valid URL."); }
    if (url.href.length > 4096) fail("The workbook link is too long.");
    if (url.protocol !== "https:" || url.username || url.password || url.port || !hostPattern.test(url.hostname)) fail("Use a workbook link on your organization’s SharePoint site.");
    if (url.hash) fail("Paste the workbook sharing link without a fragment or sign-in information.");
    safeQuery(url);
    const path = decoded(url.pathname);
    if (/^\/:[a-z]:\//i.test(path) && !/^\/:x:\//i.test(path)) fail("Use an Excel workbook link, rather than a site or folder link.");
    if (/(?:^|\/)(?:login|signin|sign-in|oauth2?|authorize|authenticate\.aspx|_forms|_login)(?:\/|$)/i.test(path)) fail("Paste a workbook link rather than a sign-in link.");
    const direct = /\.xlsx$/i.test(path);
    const sharing = (/^\/:x:\/[a-z]\/[^/]+(?:\/[^/]+)+$/i.test(path) && !/^\/:x:\/r\//i.test(path)) || /^\/:x:\/g\/[a-z0-9_-]+$/i.test(path);
    const directSharing = /^\/:x:\/r\/.+\.xlsx$/i.test(path);
    const document = /\/_layouts\/15\/Doc\.aspx$/i.test(path);
    if (document) {
      const sources = [...url.searchParams].filter(([name]) => decoded(name).toLowerCase() === "sourcedoc");
      if (sources.length !== 1 || !sourceDocument(sources[0][1], url.hostname)) fail("Use the Excel workbook’s sharing link or a Doc.aspx link with a valid sourcedoc.");
      const files = [...url.searchParams].filter(([name]) => decoded(name).toLowerCase() === "file");
      if (files.length > 1 || files.some(([, name]) => !/^[^/\\?#]+\.xlsx$/i.test(decoded(name)))) fail("Use an Excel workbook link, rather than another document type.");
    } else if (!direct && !sharing && !directSharing) fail("Use an Excel workbook link, rather than a site or folder link.");
    return Object.freeze({ url: url.href, host: url.hostname });
  }
  root.PPCSelloutSharePoint = Object.freeze({ inspectLink });
})(typeof globalThis !== "undefined" ? globalThis : this);
