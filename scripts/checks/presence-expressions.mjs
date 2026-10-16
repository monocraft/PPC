import assert from "node:assert/strict";
import "../../public/js/presence-expressions.js";

const expressions = globalThis.PortfolioPresenceExpressions;
const person = { sessionId: "expression-session-alex", displayName: "Alex" };
const identity = expressions.profile(person);
assert.ok(Object.isFrozen(expressions));
assert.ok(Object.isFrozen(expressions.moods));
assert.deepEqual(identity, expressions.profile({ ...person, displayName: "Renamed" }), "renaming a person preserves their expression identity");
for (const mood of expressions.moods) {
  const expression = expressions.profile(person, { mood });
  assert.equal(expression.mood, mood);
  for (const field of ["seed", "tone", "quirk", "delay", "duration"]) assert.equal(expression[field], identity[field], `${field} survives activity changes`);
  assert.ok(expression.label.length > 0);
}
assert.equal(expressions.profile({ ...person, editing: true }, { idle: true, view: "roadmap" }).mood, "editing");
assert.equal(expressions.profile({ ...person, editing: true }, { recent: true }).mood, "recent", "historical authors must not imply live editing");
assert.equal(expressions.profile(person, { idle: true }).mood, "idle");
assert.equal(expressions.profile(person, { view: "roadmap" }).mood, "roadmap");
assert.equal(expressions.profile(person, { focused: true }).mood, "focused");
assert.equal(expressions.profile(person, { playful: true }).mood, "playful");
assert.equal(expressions.profile({ ...person, editing: true }, { playful: true }).mood, "playful", "the local make-a-face moment temporarily overrides editing");
assert.equal(expressions.profile(person, { offline: true }).mood, "offline");
assert.equal(expressions.profile(person, { mood: "<script>" }).mood, "browsing", "arbitrary state strings cannot become DOM classes");
assert.deepEqual(expressions.profile(null, null), expressions.profile(), "empty identity remains deterministic");
const identities = Array.from({ length: 64 }, (_, index) => expressions.profile({ sessionId: `test-person-${index}` }));
assert.equal(new Set(identities.map((entry) => entry.quirk)).size, 4, "the shared family has individual mannerisms");
assert.ok(identities.every((entry) => entry.tone >= 0 && entry.tone < 5 && /^-\d+\.\ds$/.test(entry.delay)));

const editor = { ...person, editing: true };
for (const editingForMs of [undefined, -1, 0, 59999, NaN, Infinity, "60000"]) assert.equal(expressions.profile(editor, { editingForMs }).mood, "editing", "Only a finite observed minute enables theatrical editing beats.");
const beats = Array.from({ length: 5 }, (_, index) => expressions.profile(editor, { editingForMs: 60000 + index * 12000 }));
assert.deepEqual(new Set(beats.map((entry) => entry.mood)), new Set(["editing", "frustrated", "angry"]));
assert.equal(beats.filter((entry) => entry.mood === "editing").length, 3, "Focused editing remains the majority of the shared cycle.");
for (let index = 0; index < beats.length; index += 1) {
  const context = { editingForMs: 60000 + index * 12000 };
  assert.deepEqual(expressions.profile(editor, context), beats[index], "Duration-driven expressions are deterministic without reading a clock.");
  assert.equal(expressions.profile(editor, { editingForMs: context.editingForMs + 11999 }).mood, beats[index].mood, "Each expression holds its twelve-second beat.");
  assert.equal(expressions.profile(editor, { editingForMs: context.editingForMs + 60000 }).mood, beats[index].mood, "The small theatrical cycle repeats without creating a new identity.");
  for (const field of ["seed", "tone", "quirk", "delay", "duration"]) assert.equal(beats[index][field], identity[field]);
}
assert.ok(new Set(identities.map((entry, index) => expressions.profile({ sessionId: `test-person-${index}`, editing: true }, { editingForMs: 60000 }).mood)).size > 1, "People do not all perform the same beat together.");
assert.equal(expressions.profile(person, { editingForMs: 120000 }).mood, "browsing", "Viewing never acquires a made-up long-edit reaction.");
for (const [context, expected] of [[{ playful: true }, "playful"], [{ recent: true }, "recent"], [{ offline: true }, "offline"], [{ mood: "focused" }, "focused"]]) assert.equal(expressions.profile(editor, { editingForMs: 120000, ...context }).mood, expected, "Explicit and historical contexts keep their priority over editing beats.");

// Minimal DOM checks exercise the safe SVG construction without a browser or service.
const makeNode = (tag) => ({ tag, attributes: {}, children: [], style: { setProperty(name, value) { this[name] = value; } }, setAttribute(name, value) { this.attributes[name] = value; }, append(...nodes) { this.children.push(...nodes); } });
const fakeDocument = { createElement: makeNode, createElementNS(_namespace, tag) { return makeNode(tag); } };
const drawnMouths = new Map();
for (const mood of expressions.moods) {
  const avatar = expressions.createAvatar({ ...person, displayName: "<img onerror=bad()>" }, { mood }, fakeDocument);
  assert.equal(avatar.attributes["aria-hidden"], "true");
  assert.equal(avatar.attributes["data-mood"], mood);
  assert.equal(avatar.children[0].attributes.viewBox, "0 0 32 32");
  assert.ok(!JSON.stringify(avatar).includes("onerror"), "names and other user text never enter SVG markup");
  assert.ok(!JSON.stringify(avatar).includes("NaN"));
  const features = avatar.children[0].children.find((node) => node.attributes.class === "presence-features");
  drawnMouths.set(mood, features.children.find((node) => node.attributes.class === "presence-mouth").attributes.d);
}
assert.equal(new Set(["editing", "frustrated", "angry"].map((mood) => drawnMouths.get(mood))).size, 3, "Long-edit expressions retain clearly different mouths at miniature size.");
console.log("Presence expression identity, long-edit emotion beats, state mapping, and safe SVG checks passed.");
