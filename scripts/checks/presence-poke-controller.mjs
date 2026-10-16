import assert from "node:assert/strict";
import "../../public/js/master-presence.js";

const { createController } = globalThis.PortfolioMasterPresence;
const self = "self-session-1234", peer = "peer-session-5678", other = "other-session-9012";
const start = Date.parse("2026-10-16T20:00:00.000Z");
const event = (id, overrides = {}) => ({ id: `poke-${id}-123456`, fromSessionId: peer, fromDisplayName: "Sam", toSessionId: self, createdAt: new Date(start).toISOString(), ...overrides });
const roster = () => [{ sessionId: self, displayName: "Alex" }, { sessionId: peer, displayName: "Sam", receivePokes: true }, { sessionId: other, displayName: "Jo", receivePokes: false }];

function setup(options = {}) {
  let time = start, activity = "roadmap", version = 1, hasKey = true, configured = true, mode = "service", pending = [], response = null;
  const calls = [], received = [];
  const session = {
    getState: () => ({ configured, hasKey, accessVersion: version, mode, pending, snapshot: { recentEditors: [{ login: "sam", name: "Sam" }] } }),
    presence: async (body) => {
      calls.push(structuredClone(body));
      if (typeof response === "function") return response(body);
      return response || { sessions: roster(), capabilities: { pokes: true }, pokes: [], ...(body.poke ? { poke: { id: body.poke.id, status: "queued" } } : {}) };
    },
  };
  const controller = createController({ sessionProvider: () => session, sessionId: self, displayName: "Alex", getActivity: () => activity, getSelectedProductId: () => "selected-product", now: () => time, onPokeReceived: (item) => received.push(item), ...options });
  return { controller, session, calls, received,
    set response(value) { response = value; }, set activity(value) { activity = value; }, set pending(value) { pending = value; },
    set version(value) { version = value; }, set hasKey(value) { hasKey = value; }, set configured(value) { configured = value; }, set mode(value) { mode = value; },
    advance: (milliseconds) => { time += milliseconds; },
  };
}

{
  const f = setup();
  await f.controller.heartbeat();
  for (const key of ["activity", "receivePokes", "ackPokeIds", "poke"]) assert.equal(Object.hasOwn(f.calls[0], key), false, `Legacy first heartbeat omits ${key}.`);
  assert.equal(f.controller.getState().pokeSupported, true);
  await f.controller.heartbeat();
  assert.equal(f.calls[1].activity, "roadmap"); assert.equal(f.calls[1].receivePokes, true); assert.deepEqual(f.calls[1].ackPokeIds, []);
  f.activity = "<invalid>"; await f.controller.heartbeat(); assert.equal(f.calls.at(-1).activity, "browsing");
  f.activity = "editing"; await f.controller.heartbeat(); assert.equal(f.calls.at(-1).activity, "browsing", "Reported editing requires the selected product's real pending draft.");
  f.pending = [{ productId: "selected-product" }]; await f.controller.heartbeat(); assert.equal(f.calls.at(-1).activity, "editing");
  f.pending = [{ productId: "different-product" }]; await f.controller.heartbeat(); assert.equal(f.calls.at(-1).activity, "browsing");
}

{
  const f = setup(); await f.controller.heartbeat();
  const valid = event("valid"), stale = event("stale", { createdAt: new Date(start - 45001).toISOString() });
  f.response = { sessions: roster(), capabilities: { pokes: true }, pokes: [valid, valid, event("wrong-target", { toSessionId: other }), event("self", { fromSessionId: self }), event("invalid", { fromSessionId: "bad id" }), event("future", { createdAt: new Date(start + 5001).toISOString() }), stale, event("bad-date", { createdAt: "tomorrow" })] };
  await f.controller.heartbeat();
  assert.equal(f.received.length, 1); assert.equal(f.received[0].id, valid.id);
  await f.controller.heartbeat();
  assert.equal(f.received.length, 1, "Repeated inbox events never replay their recipient reaction.");
  assert.ok(f.calls.at(-1).ackPokeIds.includes(valid.id)); assert.ok(f.calls.at(-1).ackPokeIds.includes(stale.id), "Stale but targeted events are acknowledged for backend cleanup.");
  assert.equal(f.calls.at(-1).ackPokeIds.includes(event("wrong-target").id), false);
  f.response = { sessions: roster(), capabilities: { pokes: true }, pokes: [] };
  await f.controller.heartbeat(); await f.controller.heartbeat(); assert.deepEqual(f.calls.at(-1).ackPokeIds, [], "Acknowledgments clear only after a successful response.");
  await f.controller.setReceivePokes(false); assert.equal(f.controller.getState().receivePokes, false); assert.equal(f.calls.at(-1).receivePokes, false);
  const muted = event("muted"); f.response = { sessions: roster(), capabilities: { pokes: true }, pokes: [muted] };
  await f.controller.heartbeat(); await f.controller.heartbeat();
  assert.equal(f.received.length, 1, "Muted recipients acknowledge without showing a reaction."); assert.ok(f.calls.at(-1).ackPokeIds.includes(muted.id));
}

{
  const f = setup();
  await assert.rejects(f.controller.poke(peer), { code: "POKE_UNAVAILABLE" }); assert.equal(f.calls.length, 0);
  f.response = { sessions: roster() }; await f.controller.heartbeat();
  await assert.rejects(f.controller.poke(peer), { code: "POKE_UNAVAILABLE" }); assert.equal(f.calls.length, 1, "Legacy services receive no speculative poke requests.");
  f.response = null; await f.controller.heartbeat();
  await assert.rejects(f.controller.poke(self), { code: "POKE_TARGET_UNAVAILABLE" });
  await assert.rejects(f.controller.poke(other), { code: "POKE_TARGET_UNAVAILABLE" });
  await assert.rejects(f.controller.poke("offline-session-1234"), { code: "POKE_TARGET_UNAVAILABLE" });
  assert.equal(f.calls.length, 2);
  f.hasKey = false; await assert.rejects(f.controller.poke(peer), { code: "POKE_UNAVAILABLE" }); assert.equal(f.calls.length, 2);
}

for (const mode of ["github", "static"]) {
  const f = setup();
  if (mode === "github") f.mode = "github"; else f.configured = false;
  await f.controller.heartbeat(); await assert.rejects(f.controller.poke(peer), { code: "POKE_UNAVAILABLE" }); assert.equal(f.calls.length, 0, `${mode} mode sends no presence or poke request.`);
}
{
  const f = setup();
  f.response = { sessions: [{ sessionId: peer, editing: true, productId: "first-product" }], capabilities: { pokes: true } };
  await f.controller.heartbeat(); assert.equal(f.controller.getState().users[0].editingSince, start);
  f.advance(61000); await f.controller.heartbeat(); assert.equal(f.controller.getState().users[0].editingSince, start, "Normal heartbeats preserve the observed editing start for long-edit expressions.");
  f.response = { sessions: [{ sessionId: peer, editing: true, productId: "second-product" }], capabilities: { pokes: true } };
  await f.controller.heartbeat(); assert.equal(f.controller.getState().users[0].editingSince, start + 61000, "Switching edited products starts a fresh expression clock.");
  f.response = { sessions: [{ sessionId: peer, editing: false }], capabilities: { pokes: true } };
  await f.controller.heartbeat(); assert.equal(f.controller.getState().users[0].editingSince, null);
}

{
  const f = setup(); await f.controller.heartbeat();
  let release;
  f.response = () => new Promise((resolve) => { release = resolve; });
  const heartbeat = f.controller.heartbeat();
  const poke = f.controller.poke(peer);
  assert.equal(f.calls.length, 2);
  f.response = null; release({ sessions: roster(), capabilities: { pokes: true }, pokes: [] });
  await heartbeat; assert.equal((await poke).status, "queued"); assert.ok(f.calls.at(-1).poke, "A click during an in-flight heartbeat is serialized and sent afterward.");
  assert.equal(f.calls.at(-1).poke.targetSessionId, peer);
  await assert.rejects(f.controller.poke(peer), { code: "POKE_COOLDOWN" });
  f.advance(5000); assert.equal((await f.controller.poke(peer)).status, "queued");
}

{
  const f = setup(); await f.controller.heartbeat();
  let release;
  f.response = (body) => new Promise((resolve) => { release = () => resolve({ sessions: roster(), capabilities: { pokes: true }, poke: { id: body.poke.id, status: "queued" } }); });
  const first = f.controller.poke(peer), second = f.controller.poke(peer);
  const finished = Promise.allSettled([first, second]); f.response = null; release();
  const results = await finished;
  assert.equal(results[0].status, "fulfilled"); assert.equal(results[0].value.status, "queued");
  assert.equal(results[1].status, "rejected"); assert.equal(results[1].reason.code, "POKE_COOLDOWN");
  assert.equal(f.calls.filter((body) => body.poke).length, 1, "Concurrent clicks cannot race the confirmed-send cooldown.");
}

{
  const f = setup(); await f.controller.heartbeat();
  f.response = () => { throw new Error("The response was interrupted after the server could have accepted it."); };
  await assert.rejects(f.controller.poke(peer), /interrupted/);
  const interruptedId = f.calls.at(-1).poke.id;
  assert.equal(f.controller.getState().connected, false);
  f.response = null; await f.controller.heartbeat();
  f.response = (body) => ({ sessions: roster(), capabilities: { pokes: true }, poke: { id: body.poke.id, status: "duplicate" } });
  assert.equal((await f.controller.poke(peer)).status, "duplicate");
  assert.equal(f.calls.at(-1).poke.id, interruptedId, "An unknown-outcome retry reuses its event ID so the server can deduplicate it.");
  f.advance(5000); f.response = null; await f.controller.poke(peer);
  assert.notEqual(f.calls.at(-1).poke.id, interruptedId, "A confirmed receipt ends the old retry attempt.");

  f.advance(5000); f.response = () => { throw new Error("Another interrupted response."); };
  await assert.rejects(f.controller.poke(peer), /interrupted/);
  const previousWorkspaceId = f.calls.at(-1).poke.id;
  f.version = 2; f.response = null; await f.controller.heartbeat(); await f.controller.poke(peer);
  assert.notEqual(f.calls.at(-1).poke.id, previousWorkspaceId, "An unconfirmed attempt never crosses a workspace access generation.");
}

for (const status of ["queued", "duplicate", "throttled", "unavailable"]) {
  const f = setup(); await f.controller.heartbeat();
  f.response = (body) => ({ sessions: roster(), capabilities: { pokes: true }, poke: { id: body.poke.id, status } });
  const result = await f.controller.poke(peer); assert.equal(result.status, status);
  assert.equal(f.controller.getState().connected, true, "A recognized social rejection does not disconnect the workspace.");
  if (["queued", "duplicate"].includes(status)) await assert.rejects(f.controller.poke(peer), { code: "POKE_COOLDOWN" });
  else assert.equal((await f.controller.poke(peer)).status, status, "Rejected sends do not consume the local success cooldown.");
}

for (const receipt of [null, { id: "wrong-receipt-1234", status: "queued" }, { id: "dynamic", status: "delivered" }]) {
  const f = setup(); await f.controller.heartbeat();
  f.response = (body) => ({ sessions: roster(), capabilities: { pokes: true }, ...(receipt ? { poke: { ...receipt, id: receipt.id === "dynamic" ? body.poke.id : receipt.id } } : {}) });
  await assert.rejects(f.controller.poke(peer), { code: "POKE_UNCONFIRMED" });
}

{
  const f = setup(); await f.controller.heartbeat();
  let release;
  f.response = (body) => new Promise((resolve) => { release = () => resolve({ sessions: roster(), capabilities: { pokes: true }, pokes: [event("old-workspace")], poke: { id: body.poke.id, status: "queued" } }); });
  const pendingPoke = f.controller.poke(peer);
  f.version = 2; release();
  await assert.rejects(pendingPoke, { code: "POKE_CONNECTION_CHANGED" });
  assert.equal(f.received.length, 0); assert.equal(f.controller.getState().pokeSupported, false); assert.equal(f.controller.getState().connected, false);
  f.response = null; await f.controller.heartbeat(); assert.equal(f.controller.getState().connected, true);
}

{
  const f = setup(); await f.controller.heartbeat();
  let release;
  f.response = () => new Promise((resolve) => { release = resolve; });
  const heartbeat = f.controller.heartbeat(), pendingPoke = f.controller.poke(peer);
  f.version = 2; release({ sessions: roster(), capabilities: { pokes: true }, pokes: [event("prior-access")] });
  await heartbeat; await assert.rejects(pendingPoke, { code: "POKE_UNAVAILABLE" });
  assert.equal(f.calls.length, 2); assert.equal(f.received.length, 0, "A queued click and stale inbox cannot cross a workspace access generation.");
}

console.log("Presence poke controller checks passed: capability negotiation, activity sanitization, targeted inbox/acknowledgments, mute, transport gating, serialized clicks, receipts, cooldowns and workspace access races.");
