import assert from "node:assert/strict";
import "../../public/js/master-model.js";
import "../../public/js/master-client.js";
import "../../public/js/master-presence.js";

const presence = globalThis.PortfolioMasterPresence;
assert.equal(presence.anonymousName("ab12-session-id"), "Editor AB12");
assert.equal(presence.avatarText("", "ab12-session-id"), "AB");
assert.equal(presence.avatarText("Alex Smith", "ab12-session-id"), "AS");
assert.equal(presence.sessionSummary(1), "1 connected session");
assert.equal(presence.sessionSummary(3), "3 connected sessions");
assert.equal(presence.connectionSummary({ configured: false, hasKey: true }), "Team sharing is not connected");
{
  let presenceCalls = 0;
  const githubSession = { getState: () => ({ mode: "github", configured: true, hasKey: true, accessVersion: 1, pending: [], identity: { login: "alex" }, snapshot: { recentEditors: [{ login: "alex", name: "Alex Smith", at: "2026-10-07T20:00:00Z" }, { login: "alex", name: "Duplicate" }, { login: "sam", name: "Sam" }, { login: "not a login", name: "Invalid" }] } }), presence: () => { presenceCalls += 1; throw new Error("GitHub has no live presence"); } };
  const recent = presence.createController({ sessionProvider: () => githubSession, sessionId: "github-ui-tab-1234" });
  await recent.heartbeat(); await recent.setDisplayName("Local optional alias");
  const state = recent.getState();
  assert.equal(state.mode, "github"); assert.equal(state.connected, true);
  assert.equal(state.users.length, 2);
  assert.equal(state.users[0].label, "Alex Smith (alex)"); assert.equal(state.users[0].isSelf, true);
  assert.equal(state.onlineCount, 0, "recent GitHub authors never imply anyone is currently online");
  assert.equal(presence.connectionSummary(state), "2 recent editors");
  await recent.leave(); assert.equal(presenceCalls, 0, "GitHub mode never sends heartbeat or leave writes");
}
assert.equal(presence.avatarTone("ab12-session-id"), presence.avatarTone("ab12-session-id"));
const roster = presence.normalizeRoster({ sessions: [
  { sessionId: "cd34-session-id", displayName: "Viewer", editing: false, productName: "Headset" },
  { sessionId: "ab12-session-id", displayName: "", editing: true, productName: "<img src=x onerror=alert(1)>" },
  { sessionId: "ab12-session-id", displayName: "duplicate" },
  { sessionId: "invalid id with spaces" },
] }, "ab12-session-id");
assert.equal(roster.length, 2, "invalid and duplicated sessions do not inflate connected counts");
assert.equal(roster[0].label, "Editor AB12");
assert.equal(roster[0].isSelf, true);
assert.equal(roster[0].productName, "<img src=x onerror=alert(1)>", "names remain plain text for DOM textContent rendering");
assert.equal(roster[1].label, "Viewer", "a supplied display name is preserved independently of anonymous labels");

let calls = [], hasKey = true, fail = false, pending = [], selected = "product-viewed", category = "pc-audio";
const session = {
  getState: () => ({ hasKey, pending }),
  presence: async (body) => {
    calls.push(body);
    if (fail) throw new Error("Connection unavailable");
    return { sessions: [{ sessionId: body.sessionId, displayName: body.displayName, editing: body.editing, productId: body.productId, productName: body.productId ? body.editing ? "Edited headset" : "Viewed headset" : "", categoryId: body.categoryId, categoryName: "PC Gaming Audio" }, { sessionId: "other-tab-1234", displayName: "Another team", editing: false }], ttlSeconds: 65 };
  },
};
const updates = [];
const controller = presence.createController({ sessionProvider: () => session, getSelectedProductId: () => selected, getSelectedCategoryId: () => category, sessionId: "ab12-session-id", onChange: (state) => updates.push(state) });
await controller.heartbeat();
assert.equal(calls[0].productId, "product-viewed"); assert.equal(calls[0].editing, false);
assert.equal(controller.getState().onlineCount, 2); assert.equal(controller.getState().connected, true);
pending = [{ productId: "product-edited" }];
await controller.heartbeat();
assert.equal(calls.at(-1).editing, false, "an unrelated unsaved draft does not imply the user is currently editing it");
assert.equal(calls.at(-1).productId, "product-viewed");
selected = "product-edited";
await controller.heartbeat();
assert.equal(calls.at(-1).editing, true);
assert.equal(calls.at(-1).productId, "product-edited", "editing activity follows the currently selected product");
assert.equal(calls.at(-1).categoryId, "pc-audio");
assert.equal(presence.activityText(controller.getState().users[0]), "Editing Edited headset · PC Gaming Audio");
selected = "";
await controller.heartbeat();
assert.equal(presence.activityText(controller.getState().users[0]), "Viewing PC Gaming Audio");
selected = "product-edited";
await controller.setDisplayName("  Alex Smith  ");
assert.equal(calls.at(-1).displayName, "Alex Smith");
assert.equal(controller.getState().users[0].label, "Alex Smith");
fail = true; await controller.heartbeat();
assert.equal(controller.getState().unavailable, true);
assert.equal(controller.getState().connected, false);
assert.equal(controller.getState().onlineCount, 2, "connection errors retain last known sessions rather than asserting nobody is online");
fail = false; await controller.heartbeat();
assert.equal(controller.getState().unavailable, false);
await controller.leave();
assert.equal(calls.at(-1).leave, true);
hasKey = false;
const before = calls.length; await controller.heartbeat();
assert.equal(calls.length, before, "disconnected sessions do not transmit presence");
assert.equal(controller.getState().hasKey, false);
assert.equal(Object.hasOwn(controller.getState(), "key"), false);

{
  let unlocked = true, accessVersion = 1;
  const responses = [];
  const delayedSession = {
    getState: () => ({ hasKey: unlocked, accessVersion, pending: [] }),
    presence: () => new Promise((resolve, reject) => responses.push({ resolve, reject })),
  };
  const guarded = presence.createController({ sessionProvider: () => delayedSession, sessionId: "race-session-1234" });
  const oldHeartbeat = guarded.heartbeat();
  unlocked = false; accessVersion += 1;
  await guarded.heartbeat();
  responses[0].resolve({ sessions: [{ sessionId: "race-session-1234", displayName: "Old connection" }] });
  await oldHeartbeat;
  assert.equal(guarded.getState().hasKey, false);
  assert.equal(guarded.getState().connected, false);
  assert.equal(guarded.getState().onlineCount, 0, "a late response cannot restore circles after disconnect");

  unlocked = true; accessVersion += 1;
  const priorMaster = guarded.heartbeat();
  accessVersion += 1; // Importing another master can keep the same session object and hasKey=true.
  const currentMaster = guarded.heartbeat();
  assert.equal(responses.length, 3, "a new access generation can start a heartbeat while the old one is pending");
  responses[2].resolve({ sessions: [{ sessionId: "fresh-master-1234", displayName: "Current master" }] });
  await currentMaster;
  responses[1].reject(new Error("Old master is unavailable"));
  await priorMaster;
  assert.equal(guarded.getState().connected, true);
  assert.equal(guarded.getState().unavailable, false, "a stale failure cannot replace current connection status");
  assert.equal(guarded.getState().users[0].label, "Current master", "another imported master's roster is kept");

  const beforeLeave = guarded.heartbeat();
  const leaving = guarded.leave();
  responses[4].resolve({ sessions: [] }); await leaving;
  responses[3].resolve({ sessions: [{ sessionId: "race-session-1234", displayName: "Before leave" }] }); await beforeLeave;
  assert.equal(guarded.getState().connected, false);
  assert.equal(guarded.getState().onlineCount, 0, "a departing session invalidates any earlier heartbeat response");
}

{
  const model = globalThis.PortfolioMasterModel, client = globalThis.PortfolioMasterClient;
  const product = { id: "static-sample", name: "Static portfolio", specs: [], partSkus: [], variantGroups: [], roadmap: {} };
  const snapshot = model.snapshot({ categories: [{ id: "cat", board: { products: [product] } }] });
  let requests = 0;
  const staticSession = client.createSession({ endpoint: "", adapter: { getProducts: () => [product], getBaselineProducts: () => snapshot.products, applyPatches() {} }, fetchImpl: async () => { requests += 1; throw new Error("No master service should be called"); } });
  staticSession.markImported(snapshot.products, "static-package-key-in-memory");
  assert.equal(staticSession.getState().hasKey, true, "a static package can remember its unlock key");
  assert.equal(staticSession.getState().configured, false, "a static unlock key does not imply a configured sharing service");
  await staticSession.presence({ sessionId: "static-tab-1234" });
  const staticPresence = presence.createController({ sessionProvider: () => staticSession, sessionId: "static-tab-1234" });
  await staticPresence.heartbeat();
  await staticPresence.setDisplayName("Alex");
  await staticPresence.leave();
  const state = staticPresence.getState();
  assert.equal(requests, 0, "static-only portfolios never transmit presence even when their package key is remembered");
  assert.equal(state.configured, false);
  assert.equal(state.hasKey, false, "display-name Apply remains disabled without sharing access");
  assert.equal(state.connected, false); assert.equal(state.unavailable, false); assert.equal(state.onlineCount, 0);
  assert.equal(presence.connectionSummary(state), "Team sharing is not connected", "the static-only status does not invite another package pull as a way to enable sharing");
}

{
  const client = globalThis.PortfolioMasterClient, model = globalThis.PortfolioMasterModel;
  const product = { id: "sample", name: "Sample", specs: [], partSkus: [], variantGroups: [], roadmap: {} };
  const sharedSnapshot = model.snapshot({ categories: [{ id: "cat", board: { products: [product] } }] });
  const network = [];
  const adapter = { getProducts: () => [product], getBaselineProducts: () => sharedSnapshot.products, applyPatches() {} };
  const connected = client.createSession({ endpoint: "https://shared.example.org/api/master", adapter, fetchImpl: async (url, options) => {
    network.push({ url, options });
    if (url.endsWith("/latest")) return Response.json({ snapshot: sharedSnapshot });
    return Response.json({ users: [{ sessionId: "ab12-session-id", displayName: "Alex", editing: false }], onlineCount: 1 });
  } });
  const key = "memory-only-private-key";
  const beforeConnectVersion = connected.getState().accessVersion;
  await connected.connect({ key });
  assert.equal(connected.getState().configured, true);
  assert.ok(connected.getState().accessVersion > beforeConnectVersion, "connecting a key changes the opaque access version");
  await connected.presence({ sessionId: "ab12-session-id", displayName: "Alex", editing: false, productId: "sample" });
  const request = network.at(-1);
  assert.equal(request.url, "https://shared.example.org/api/master/presence");
  assert.equal(request.url.includes(key), false);
  assert.equal(JSON.parse(request.options.body).key, key);
  assert.equal(Object.hasOwn(connected.getState(), "key"), false, "presence can authenticate without exposing the master key");
  await connected.presence({ sessionId: "ab12-session-id", leave: true });
  assert.equal(network.at(-1).options.keepalive, true, "a departing tab sends a best-effort authenticated leave");
  const beforeImportVersion = connected.getState().accessVersion;
  connected.markImported(sharedSnapshot.products, key);
  assert.ok(connected.getState().accessVersion > beforeImportVersion, "importing with the same key still invalidates prior presence responses");
  connected.markImported(sharedSnapshot.products);
  assert.equal(connected.getState().hasKey, false, "loading a different workspace clears old master access");
  const previous = network.length; await connected.presence({ sessionId: "ab12-session-id" }); assert.equal(network.length, previous);
  await connected.connect({ key });
  const beforeDisconnectVersion = connected.getState().accessVersion;
  connected.disconnect();
  assert.ok(connected.getState().accessVersion > beforeDisconnectVersion, "disconnect changes the opaque access version");
}
console.log("Master presence checks passed: per-tab anonymous labels, optional display names, editing context, session counts, offline roster retention, disconnect/import/leave race protection, memory-only authenticated presence and keepalive leave.");
