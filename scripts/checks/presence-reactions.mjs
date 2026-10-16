import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../public/js/presence-reactions.js", import.meta.url), "utf8");
const css = await readFile(new URL("../../public/css/presence-reactions.css", import.meta.url), "utf8");
function setup() {
  let time = 10000, sequence = 0;
  const timers = new Map(), changes = [];
  const sandbox = { setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const reactions = sandbox.PortfolioPresenceReactions.create({ now: () => time, onChange: (change) => changes.push(change) });
  return { reactions, timers, changes, advance(milliseconds) {
    const until = time + milliseconds;
    while (true) {
      const next = [...timers.entries()].filter(([, entry]) => entry.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = until;
  } };
}
const peer = "peer-session-1234", self = { sessionId: "self-session-5678", isSelf: true };
{
  const f = setup();
  assert.equal(f.reactions.mark("bad id", "sent"), null); assert.equal(f.reactions.mark(peer, "delivered"), null); assert.equal(f.timers.size, 0);
  const result = f.reactions.mark(peer, "sent", { name: "Jo" });
  assert.equal(result.kind, "sent"); assert.equal(result.until, 13200); assert.equal(result.message, "Poke on its way to Jo");
  result.message = "Changed externally"; assert.equal(f.reactions.get(peer).message, "Poke on its way to Jo", "Callers cannot mutate active state.");
  f.advance(3199); assert.ok(f.reactions.get(peer)); f.advance(1); assert.equal(f.reactions.get(peer), null); assert.equal(f.timers.size, 0);
  assert.equal(f.changes.filter((change) => change.phase === "marked").length, 1); assert.equal(f.changes.filter((change) => change.phase === "expired").length, 1);
  f.reactions.destroy();
}
{
  const f = setup();
  f.reactions.mark(peer, "received", { name: "Sam" }); f.advance(2000); f.reactions.mark(peer, "received", { name: "Sam again" });
  assert.equal(f.timers.size, 1, "Refreshing a reaction never grows a timer per event.");
  f.advance(1200); assert.equal(f.reactions.get(peer).name, "Sam again"); f.advance(2000); assert.equal(f.reactions.get(peer), null);
  f.reactions.destroy();
}
{
  const f = setup(), alpha = { sessionId: "alpha-session-1234" }, zed = { sessionId: "zed-session-1234" }, failed = { sessionId: "failed-session-1234" };
  const users = [alpha, zed, self, failed], original = [...users];
  f.reactions.mark(zed.sessionId, "received"); f.reactions.mark(failed.sessionId, "failed");
  assert.deepEqual([...f.reactions.prioritize(users)], [self, zed, alpha, failed]); assert.deepEqual(users, original, "Promoting an active sender never mutates the accepted roster.");
  f.advance(3200); assert.deepEqual([...f.reactions.prioritize(users)], [self, alpha, zed, failed]); f.reactions.destroy();
}
{
  const f = setup(), first = { sessionId: "first-session-1234" }, last = { sessionId: "last-session-5678" };
  f.reactions.mark(last.sessionId, "sent");
  assert.deepEqual([...f.reactions.prioritize([self, first, last])], [self, first, last], "A clicked target stays in place so the walk goes to its real header position."); f.reactions.destroy();
}
{
  const f = setup();
  const attributes = new Map();
  const avatar = { title: "Jo · Viewing the portfolio", setAttribute: (name, value) => attributes.set(name, value), removeAttribute: (name) => attributes.delete(name) };
  f.reactions.mark(peer, "received", { name: "<img src=x>", message: "<svg onload=alert(1)>\n poked you" });
  assert.equal(f.reactions.decorate(avatar, { sessionId: peer }), avatar); assert.equal(attributes.get("data-reaction"), "received");
  assert.equal(avatar.title, "<svg onload=alert(1)> poked you", "Untrusted text only reaches a plain tooltip property.");
  f.reactions.decorate(avatar, { sessionId: peer }); f.advance(3200); f.reactions.decorate(avatar, { sessionId: peer });
  assert.equal(avatar.title, "Jo · Viewing the portfolio"); assert.equal(attributes.has("data-reaction"), false);
  f.reactions.mark(peer, "failed", { name: "x".repeat(100), message: "y".repeat(300) });
  assert.equal(f.reactions.get(peer).name.length, 60); assert.equal(f.reactions.get(peer).message.length, 180); f.reactions.destroy();
}
{
  const f = setup();
  for (let index = 0; index < 80; index += 1) f.reactions.mark(`sample-session-${index}`, "received");
  assert.equal(f.reactions.get("sample-session-0"), null); assert.ok(f.reactions.get("sample-session-16")); assert.equal(f.timers.size, 1);
  f.reactions.destroy(); assert.equal(f.timers.size, 0); assert.equal(f.reactions.get("sample-session-79"), null);
  assert.equal(f.reactions.mark(peer, "sent"), null); f.advance(10000); assert.equal(f.changes.some((change) => change.phase === "expired"), false);
}
assert.match(css, /data-reaction="sent"[\s\S]*?data-reaction="received"[\s\S]*?color:\s*var\(--color-danger\)/);
assert.match(css, /prefers-reduced-motion:\s*reduce/); assert.match(css, /preview-reduced-motion/);
assert.equal(/\.presence-character\[data-reaction="failed"\][^{]*\{[^}]*color:/.test(css), false, "A failed poke never receives confirmation red.");
console.log("Presence reactions checks passed:3.2second expiry,refresh,bounded state/sharedtimer,stable headerpriority,safe tooltipdecoration/restoration,reducedmotion andcleanup.");
