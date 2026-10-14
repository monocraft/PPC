import assert from "node:assert/strict";
await import("../../public/js/sellout-spring.js");
function harness(onFrame, reducedMotion = false) {
  let time = 0, next = 0, cancelled = 0; const frames = new Map(), values = [];
  const api = globalThis.PPCSelloutSpring.create({ onFrame: value => { values.push({ ...value }); onFrame?.(value); }, reducedMotion, now: () => time, requestFrame: callback => { frames.set(++next, callback); return next; }, cancelFrame: id => { cancelled++; frames.delete(id); } });
  const advance = (delta = 1000 / 60) => { time += delta; const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(time)); };
  const settle = () => { let iterations = 0; while (frames.size && iterations++ < 300) advance(); assert.equal(frames.size, 0, "Spring must settle without a permanent RAF loop."); return iterations; };
  return { api, values, frames, advance, settle, cancelled: () => cancelled };
}
const normal = harness();
assert.deepEqual(normal.values, [{ x: 0, stretch: 0 }]); assert.equal(normal.frames.size, 0);
normal.api.pull({ x: 18, stretch: .018 });
assert.equal(normal.api.inspect().x, 0, "A new tug must not flash or reset displayed pixels.");
normal.advance(); assert.ok(normal.api.inspect().x > 0 && normal.api.inspect().x < 18); assert.ok(normal.api.inspect().stretch > 0 && normal.api.inspect().stretch < .018);
const displayed = normal.api.inspect(); normal.api.pull({ x: -12, stretch: -.01 });
assert.equal(normal.api.inspect().x, displayed.x); assert.equal(normal.api.inspect().velocityX, displayed.velocityX, "A pointer interruption keeps current position and velocity.");
assert.equal(normal.frames.size, 1, "Repeated pulls must share one scheduled frame.");
normal.settle(); assert.equal(normal.api.inspect().x, -12); assert.equal(normal.api.inspect().stretch, -.01);
normal.api.pull({ x: 18, stretch: .018 }); normal.settle();
assert.equal(normal.api.inspect().x, 18); assert.equal(normal.api.inspect().running, false, "A stationary held pull also settles rather than consuming idle frames.");
const releaseStart = normal.values.length; normal.api.release(); normal.settle();
const releaseValues = normal.values.slice(releaseStart);
assert.ok(releaseValues.some(value => value.x < 0), "Release should have a gentle physical overshoot rather than a stiff easing-only return.");
assert.ok(Math.min(...releaseValues.map(value => value.x)) >= -1.5, "The normal 18-pixel tug settles with a subtle approximately one-pixel recoil.");
assert.deepEqual(normal.values.at(-1), { x: 0, stretch: 0 }); assert.equal(normal.api.inspect().velocityX, 0); assert.equal(normal.api.inspect().velocityStretch, 0);
assert.equal(normal.frames.size, 0);

const bounded = harness(); bounded.api.pull({ x: 999, stretch: 999 });
assert.equal(bounded.api.inspect().targetX, 18); assert.equal(bounded.api.inspect().targetStretch, .018);
bounded.advance(50000); assert.ok(bounded.api.inspect().x > 0 && bounded.api.inspect().x < 18, "A stalled browser frame integrates at most 50ms, without teleporting to the target.");
bounded.settle(); bounded.api.release({ impulseX: 100000 }); bounded.settle();
assert.ok(bounded.values.every(value => Number.isFinite(value.x) && Number.isFinite(value.stretch) && Math.abs(value.x) <= 22 && Math.abs(value.stretch) <= .025));
assert.deepEqual(bounded.values.at(-1), { x: 0, stretch: 0 });
bounded.api.pull({ x: -999, stretch: -999 }); assert.equal(bounded.api.inspect().targetX, -18); assert.equal(bounded.api.inspect().targetStretch, -.018); bounded.advance();
const beforeReset = bounded.cancelled(); bounded.api.reset(); assert.equal(bounded.frames.size, 0); assert.ok(bounded.cancelled() > beforeReset); assert.deepEqual(bounded.values.at(-1), { x: 0, stretch: 0 });
bounded.api.pull({ x: 5, stretch: .005 }); bounded.api.destroy(); assert.equal(bounded.frames.size, 0); assert.equal(bounded.api.inspect().disposed, true); assert.equal(bounded.api.pull({ x: 10 }), false); assert.equal(bounded.api.release(), false);

const reduced = harness(null, true); reduced.api.pull({ x: 18, stretch: .018 }); reduced.api.release({ impulseX: 100 });
assert.equal(reduced.frames.size, 0); assert.ok(reduced.values.every(value => value.x === 0 && value.stretch === 0));
const immutable = harness(value => { value.x = 999; value.stretch = 999; }); immutable.api.pull({ x: 8, stretch: .008 }); immutable.settle(); assert.equal(immutable.api.inspect().x, 8); assert.equal(immutable.api.inspect().stretch, .008, "Callback mutation cannot change physical state.");
const copy = immutable.api.inspect(); copy.x = 0; assert.equal(immutable.api.inspect().x, 8);
assert.throws(() => immutable.api.pull({ x: NaN }), /finite/); assert.throws(() => immutable.api.pull({ stretch: Infinity }), /finite/); assert.throws(() => immutable.api.release({ impulseX: null }), /finite/);
assert.throws(() => globalThis.PPCSelloutSpring.create({}), /onFrame/); assert.throws(() => globalThis.PPCSelloutSpring.create({ onFrame() {}, now: 1 }), /function/);
let fail = false; const throwing = harness(() => { if (fail) throw new Error("frame failed"); }); throwing.api.pull({ x: 12 }); fail = true;
assert.throws(() => throwing.advance(), /frame failed/); assert.equal(throwing.frames.size, 0); assert.equal(throwing.api.inspect().running, false, "Callback errors cancel scheduling safely.");
normal.api.destroy(); bounded.api.destroy(); reduced.api.destroy(); immutable.api.destroy(); throwing.api.destroy();
console.log("Presentation spring: bounded physical pull/recoil, fixed-step timing, displayed-state interruption, stationary/released settling, clamps, reduced motion, callback isolation, reset/destroy, and failure cleanup passed.");
