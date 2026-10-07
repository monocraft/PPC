/* A bounded, key-authorized download of the encrypted shared package. */
(function (root) {
  "use strict";

  function normalizeEndpoint(value) {
    const text = String(value || "").trim();
    if (!text) throw new Error("Shared data is not connected yet. Ask the portfolio owner to complete setup.");
    let url;
    try { url = new URL(text); } catch { throw new Error("The shared data connection is invalid. Ask the portfolio owner to check setup."); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/api/package/latest")) {
      throw new Error("The shared data connection must use the approved secure package service.");
    }
    return url.href;
  }

  async function readLimitedResponse(response, onProgress) {
    const limit = root.PortfolioPackage.MAX_PACKAGE_BYTES;
    const advertised = Number(response.headers.get("content-length") || 0);
    if (!Number.isFinite(advertised) || advertised < 0 || advertised > limit) {
      await response.body?.cancel().catch(() => {});
      throw new Error("The shared package exceeds the supported size.");
    }
    const reader = response.body?.getReader();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > limit) throw new Error("The shared package exceeds the supported size.");
      return bytes;
    }
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error("The shared package exceeds the supported size.");
        chunks.push(value);
        onProgress?.(size, advertised);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }

  async function downloadLatest({ endpoint, key, fetchImpl = root.fetch, signal, onProgress } = {}) {
    const url = normalizeEndpoint(endpoint);
    const normalizedKey = root.PortfolioPackage.normalizeKey(key);
    const response = await fetchImpl(url, {
      method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/octet-stream" },
      body: JSON.stringify({ key: normalizedKey }), credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal,
    });
    if (response.status === 401) throw new Error("That package key could not unlock the shared data. Check the key and try again.");
    if (response.status === 429) throw new Error("Too many attempts. Wait a minute, then try again.");
    if (!response.ok) throw new Error("The shared package is unavailable. Try again later or contact the portfolio owner.");
    const bytes = await readLimitedResponse(response, onProgress);
    if (!root.PortfolioPackage.isEncrypted(bytes)) throw new Error("The shared source must contain an encrypted unified package. The workspace was not changed.");
    return bytes;
  }

  root.PortfolioPackageClient = Object.freeze({ normalizeEndpoint, readLimitedResponse, downloadLatest });
})(globalThis);
