/* Bounded encrypted package downloads. Static requests never contain package keys. */
(function (root) {
  "use strict";

  const DEFAULT_PACKAGE_URL = "./data/master_ppc.pkg";
  let cacheSequence = 0;

  function isSecureUrl(url) {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (local && url.protocol === "http:");
  }

  function normalizePackageUrl(value = DEFAULT_PACKAGE_URL, baseUrl = root.location?.href) {
    const text = String(value || "").trim() || DEFAULT_PACKAGE_URL;
    let base;
    let url;
    try {
      base = new URL(baseUrl);
      url = new URL(text, base);
    } catch { throw new Error("The master package connection is invalid. Ask the portfolio owner to check setup."); }
    if (!isSecureUrl(base) || base.username || base.password || !isSecureUrl(url) || url.origin !== base.origin || url.username || url.password || /[?#]/.test(text) || url.search || url.hash || !/\.pkg$/i.test(url.pathname)) {
      throw new Error("The master package must be an encrypted .pkg file hosted on this PPC site.");
    }
    return url.href;
  }

  function checkAborted(signal) {
    if (signal?.aborted) {
      const error = new Error("The package download was cancelled.");
      error.name = "AbortError";
      throw error;
    }
  }

  function normalizeEndpoint(value) {
    const text = String(value || "").trim();
    if (!text) throw new Error("Shared data is not connected yet. Ask the portfolio owner to complete setup.");
    let url;
    try { url = new URL(text); } catch { throw new Error("The shared data connection is invalid. Ask the portfolio owner to check setup."); }
    if (!isSecureUrl(url) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/api/package/latest")) {
      throw new Error("The shared data connection must use the approved secure package service.");
    }
    return url.href;
  }

  async function readLimitedResponse(response, onProgress, signal) {
    const limit = root.PortfolioPackage.MAX_PACKAGE_BYTES;
    const rawLength = response.headers.get("content-length");
    const advertised = rawLength === null ? null : Number(rawLength);
    if (rawLength !== null && (!/^\d+$/.test(rawLength) || !Number.isSafeInteger(advertised) || advertised > limit)) {
      await response.body?.cancel().catch(() => {});
      throw new Error("The shared package exceeds the supported size.");
    }
    // HTTP content length describes encoded bytes when transport compression is used.
    const encoding = (response.headers.get("content-encoding") || "identity").toLowerCase();
    const expected = encoding === "identity" ? advertised : null;
    const progressTotal = expected || 0;
    checkAborted(signal);
    const reader = response.body?.getReader();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      checkAborted(signal);
      if (bytes.byteLength > limit) throw new Error("The shared package exceeds the supported size.");
      if (expected !== null && bytes.byteLength !== expected) throw new Error("The package download was incomplete. Try again.");
      onProgress?.(bytes.byteLength, progressTotal);
      return bytes;
    }
    const chunks = [];
    let size = 0;
    const cancelRead = () => { reader.cancel().catch(() => {}); };
    signal?.addEventListener("abort", cancelRead, { once: true });
    try {
      for (;;) {
        checkAborted(signal);
        const { done, value } = await reader.read();
        checkAborted(signal);
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error("The shared package exceeds the supported size.");
        if (expected !== null && size > expected) throw new Error("The package download was incomplete. Try again.");
        chunks.push(value);
        onProgress?.(size, progressTotal);
      }
      if (expected !== null && size !== expected) throw new Error("The package download was incomplete. Try again.");
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancelRead);
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }

  async function downloadLatest({ packageUrl, endpoint, key, baseUrl, fetchImpl = root.fetch, signal, onProgress } = {}) {
    checkAborted(signal);
    const staticSource = !!String(packageUrl || "").trim() || !String(endpoint || "").trim();
    let url;
    const options = { credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal };
    if (staticSource) {
      const source = new URL(normalizePackageUrl(packageUrl, baseUrl));
      source.searchParams.set("_ppc", Date.now().toString(36) + "-" + (++cacheSequence).toString(36));
      url = source.href;
      options.method = "GET";
    } else {
      url = normalizeEndpoint(endpoint);
      const normalizedKey = root.PortfolioPackage.normalizeKey(key);
      options.method = "POST";
      options.headers = { "Content-Type": "application/json", "Accept": "application/octet-stream" };
      options.body = JSON.stringify({ key: normalizedKey });
    }
    let response;
    try { response = await fetchImpl(url, options); }
    catch (error) {
      checkAborted(signal);
      if (error?.name === "AbortError") throw error;
      throw new Error("The shared package could not be downloaded. Check your connection and try again.");
    }
    checkAborted(signal);
    if (staticSource && response.status === 404) throw new Error("The master package has not been published yet. Ask the portfolio owner to build and publish master_ppc.pkg, then try again.");
    if (!staticSource && response.status === 401) throw new Error("That package key could not unlock the shared data. Check the key and try again.");
    if (response.status === 429) throw new Error("Too many attempts. Wait a minute, then try again.");
    if (!response.ok) throw new Error("The shared package is unavailable. Try again later or contact the portfolio owner.");
    let bytes;
    try { bytes = await readLimitedResponse(response, onProgress, signal); }
    catch (error) {
      checkAborted(signal);
      if (error?.name === "AbortError" || ["The shared package exceeds the supported size.", "The package download was incomplete. Try again."].includes(error?.message)) throw error;
      throw new Error("The package download was interrupted. Check your connection and try again.");
    }
    if (bytes.length < 36 || !root.PortfolioPackage.isEncrypted(bytes)) throw new Error("The shared source must contain an encrypted unified package. The workspace was not changed.");
    return bytes;
  }

  root.PortfolioPackageClient = Object.freeze({ normalizePackageUrl, normalizeEndpoint, readLimitedResponse, downloadLatest });
})(globalThis);
