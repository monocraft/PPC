import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
await import("../../public/js/sellout-ppc.js");
const api = globalThis.PPCSelloutPricing;
const launch = (sku, price, row) => ({ id: `record-${row}`, row, skus: [sku], identity: {}, pricing: { usd: price, eur: 777 }, source: { checkedDate: "2026-10-12", file: "private-tracker.xlsx" } });
const fixture = { categories: [{ id: "audio", name: "Audio", board: { products: [
  { id: "saved", name: "Name cannot match", price: "79.99", partSkus: [{ code: "4P5D4AA" }, { code: "4P5D4AA#ABA" }], plc: { launchAvailability: { formatVersion: 1, records: [launch("4P5D4AA#ABA", 99.99, 1)] } }, master: { key: "private-key" }, specs: [{ value: "private-spec" }], imageAssetId: "private-image" },
  { id: "tracker", price: null, priceLabel: "$500", partSkus: ["7A123AA", "7A124AA", "7A125AA"], plc: { launchAvailability: { formatVersion: 1, canonicalRow: 2, records: [launch("7A123AA", 0, 2), launch("7A124AA", "USD 89.99", 3)] } } },
  { id: "conflict-one", price: 10, partSkus: ["8A123AA"] }, { id: "conflict-two", price: 20, partSkus: ["8A123AA"] },
  { id: "tracker-conflict", price: null, partSkus: ["9A123AA"], plc: { launchAvailability: { formatVersion: 1, records: [launch("9A123AA", 30, 4), launch("9A123AA", 40, 5)] } } },
  { id: "localized-only", price: 50, partSkus: ["BA123AA#ABU"] },
  { id: "legacy-tracker", price: null, partSkus: ["CA123AA"], plc: { launchAvailability: { canonicalRow: 6, updateDate: "2026-10-12", rows: [{ row: 6, skus: ["CA123AA"], values: ["$19.95", 99, "private product name", "private code"] }] } } },
  { id: "legacy-code", price: 12, partSkus: ["HX-AB-CD/NA"] },
  { id: "invalid-reserved", price: 88, partSkus: ["__proto__", "constructor", "prototype"] },
] } }], masterSync: { secret: "private-master-token" } };
const before = structuredClone(fixture);
const projection = api.projectPortfolio(fixture);
assert.equal(api.validateProjection(projection).ok, true);
assert.equal(projection.prices.find(row => row.sku === "4P5D4AA#ABA").msrp, 79.99, "Explicit saved product USD overrides independent tracker MSRP.");
assert.equal(projection.conflicts.find(row => row.code === "SAVED_TRACKER_DIFFERENCE").blocking, false);
assert.equal(projection.prices.find(row => row.sku === "7A123AA").msrp, 0, "Zero USD is a recorded price, not missing.");
assert.equal(projection.prices.find(row => row.sku === "7A124AA").msrp, 89.99);
assert.equal(projection.prices.find(row => row.sku === "7A125AA").msrp, null, "Canonical/selected tracker price cannot spread to an unrelated variant.");
assert.equal(projection.prices.find(row => row.sku === "CA123AA").msrp, 19.95);
assert.equal(projection.prices.some(row => row.sku === "8A123AA"), false);
assert.equal(projection.conflicts.find(row => row.sku === "8A123AA").code, "SKU_PRODUCT_CONFLICT");
assert.equal(projection.conflicts.find(row => row.sku === "9A123AA").code, "TRACKER_PRICE_CONFLICT");
assert.deepEqual(fixture, before, "Projection must never mutate PPC facts, source records, or keys.");
for (const secret of ["private-key", "private-spec", "private-image", "private-master-token", "private-tracker", "private product name", "Name cannot match", "777"]) assert.equal(JSON.stringify(projection).includes(secret), false, `${secret} must not survive the allowlist.`);
const resolved = api.resolvePrices(projection, [" ４Ｐ５Ｄ４ＡＡ＃ＡＢＡ ", "4P5D4AA#ABU", "7A125AA", "8A123AA#ABA", "BA123AA#ABA", "Name cannot match"]);
assert.equal(resolved.prices.find(row => row.sku === "4P5D4AA#ABA").match, "exact");
assert.equal(resolved.prices.find(row => row.sku === "4P5D4AA#ABU").match, "base-pn");
assert.equal(resolved.prices.find(row => row.sku === "4P5D4AA#ABU").matchedSku, "4P5D4AA");
assert.equal(resolved.prices.find(row => row.sku === "7A125AA").msrp, null);
assert.equal(resolved.conflicts.find(row => row.sku === "8A123AA#ABA").code, "BASE_PN_CONFLICT");
assert.equal(resolved.conflicts.find(row => row.sku === "BA123AA#ABA").code, "UNMATCHED_SKU", "Localized siblings cannot authorize an undeclared base PN fallback.");
assert.equal(resolved.conflicts.find(row => row.sku === "NAMECANNOTMATCH").code, "UNMATCHED_SKU", "Product names never participate in matching.");
assert.equal(api.validateProjection(resolved).ok, true);
const again = api.resolvePrices(resolved, ["4P5D4AA#ABU"]);
assert.equal(again.prices[0].match, "base-pn", "Reusing a scoped projection preserves the original fallback provenance.");
assert.equal(again.prices[0].matchedSku, "4P5D4AA");
const ambiguousFamily = structuredClone(fixture);
ambiguousFamily.categories[0].board.products.push({ id: "different-localized-product", price: 129, partSkus: ["4P5D4AA#ABF"] });
const blockedFamily = api.projectPortfolio(ambiguousFamily, { skus: ["4P5D4AA#ABU", "4P5D4AA#ABA"] });
assert.equal(blockedFamily.prices.some(price => price.sku === "4P5D4AA#ABU"), false, "An explicit base PN cannot authorize a fallback when localized sibling ownership or prices conflict.");
assert.equal(blockedFamily.conflicts.find(conflict => conflict.sku === "4P5D4AA#ABU").code, "BASE_PN_CONFLICT");
assert.equal(blockedFamily.prices.find(price => price.sku === "4P5D4AA#ABA").match, "exact", "A sound exact SKU mapping remains usable despite a wider base family ambiguity.");
assert.equal(api.projectPortfolio(fixture, { authority: "ppc-backup", skus: ["4P5D4AA"] }).authority, "ppc-backup");
assert.equal(api.usd("USD 89 / 99"), null);
assert.equal(api.usd("EUR 89.99"), null);
assert.equal(api.usd("-5"), null);
assert.equal(api.usd(""), null);
assert.equal(api.usd("1,2"), null);
assert.equal(api.normalizeSku(" __proto__ "), "");
assert.equal(api.normalizeSku("HX-AB-CD/NA"), "HX-AB-CD/NA");
assert.equal(api.basePn("4P5D4AA#ABA"), "4P5D4AA");
assert.equal(api.basePn("4P5D4AA/NA"), "");
for (const mutate of [p => p.prices[0].msrp = -1, p => p.prices[0].msrp = "79.99", p => p.prices[0].currency = "EUR", p => p.prices[0].sku = "__proto__", p => p.prices[0].sourceProductId = 1, p => p.prices[0].specs = ["leak"], p => p.prices[0] = null, p => delete p.prices[0], p => p.conflicts[0] = null, p => p.master = { key: "leak" }, p => p.coverage = {}, p => p.coverage.priced++]) {
  const bad = structuredClone(projection); mutate(bad); assert.equal(api.validateProjection(bad).ok, false);
}

// Exercise the actual asynchronous channel APIs, including correlation, fresh
// in-memory facts, fragment removal, request scope, and lifecycle cleanup.
const buses = new Map();
class Channel {
  constructor(name) { this.name = name; this.closed = false; if (!buses.has(name)) buses.set(name, new Set()); buses.get(name).add(this); }
  postMessage(data) { for (const target of buses.get(this.name) || []) if (target !== this && !target.closed) queueMicrotask(() => target.onmessage?.({ data: structuredClone(data) })); }
  close() { this.closed = true; buses.get(this.name)?.delete(this); }
}
function windowMock(href) {
  const listeners = new Map(); const timers = new Set();
  return { location: new URL(href), crypto: webcrypto, BroadcastChannel: Channel, history: { state: null, replaceState(_, __, url) { this.url = url; } },
    setTimeout(callback, delay) { const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay); timers.add(timer); return timer; }, clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); },
    pendingTimers: () => timers.size,
  };
}
const listeners = new Map(), link = { href: "https://example.test/ppc/analytics.html", rel: "noopener", addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
const publisherWindow = windowMock("https://example.test/ppc/index.html"); let current = structuredClone(fixture);
const publisher = api.attachPublisher({ getPortfolio: () => current, links: [link], window: publisherWindow });
listeners.get("click")({ isTrusted: true });
const capability = new URL(link.href).hash.slice("#ppc-link=".length);
assert.match(capability, /^[a-f0-9]{64}$/);
assert.match(link.rel, /noopener/); assert.match(link.rel, /noreferrer/);
const dashboardWindow = windowMock(link.href); let calls = 0;
const dashboard = api.connectDashboard(capability, () => { calls++; }, { window: dashboardWindow, autoRequest: false });
assert.equal(dashboardWindow.history.url, "/ppc/analytics.html", "Capability must be removed from the dashboard URL before use.");
const received = await dashboard.request(["4P5D4AA"]);
assert.equal(received.prices.length, 1); assert.equal(received.prices[0].msrp, 79.99);
current.categories[0].board.products[0].price = 81;
assert.equal((await dashboard.request(["4P5D4AA"])).prices[0].msrp, 81, "Explicit refresh reads current unsaved app facts without saving them.");
assert.equal(calls, 2);
const attacker = new Channel("ppc-analytics-" + capability);
attacker.postMessage({ type: "ppc-prices-response", version: 1, requestId: "0".repeat(32), projection });
await Promise.resolve(); assert.equal(calls, 2, "Unsolicited or uncorrelated responses must be ignored.");
attacker.close(); dashboard.disconnect(); publisher.dispose();
assert.equal(publisher.activeChannels(), 0); assert.equal(publisherWindow.pendingTimers(), 0); assert.equal(dashboardWindow.pendingTimers(), 0);
assert.equal([...buses.values()].every(channels => channels.size === 0), true);
assert.throws(() => api.connectDashboard("bad", () => {}, { window: dashboardWindow }), /invalid/);
const externalListeners = new Map(), externalLink = { href: "https://other.test/analytics.html", addEventListener(name, fn) { externalListeners.set(name, fn); } };
const externalPublisher = api.attachPublisher({ getPortfolio: () => current, links: [externalLink], window: publisherWindow });
assert.equal(externalListeners.size, 0); externalPublisher.dispose();
console.log("PPC USD pricing: saved/tracker precedence, zero/missing values, exact/base-PN matching, conflict exclusion, private-data allowlist, nonce channel scope, request correlation, refresh, and cleanup passed.");
