/* A bounded horizontal presentation spring; reporting dates and units stay external. */
(function (root) {
  "use strict";
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
  function create({ onFrame, reducedMotion = false, requestFrame, cancelFrame, now } = {}) {
    if (typeof onFrame !== "function") throw new TypeError("Presentation spring requires onFrame.");
    for (const [name, value] of Object.entries({ requestFrame, cancelFrame, now })) if (value !== undefined && typeof value !== "function") throw new TypeError(`Presentation spring ${name} must be a function.`);
    const clock = now || (() => root.performance?.now?.() ?? Date.now());
    const request = requestFrame || (callback => root.requestAnimationFrame ? root.requestAnimationFrame(callback) : root.setTimeout(() => callback(clock()), 16));
    const cancelRequest = cancelFrame || (id => root.cancelAnimationFrame ? root.cancelAnimationFrame(id) : root.clearTimeout(id));
    const state = { x: 0, stretch: 0, velocityX: 0, velocityStretch: 0, targetX: 0, targetStretch: 0, running: false, released: true, disposed: false };
    let frame = null, lastTime = clock();
    function stop() { if (frame !== null) cancelRequest(frame); frame = null; state.running = false; }
    function zero() { state.x = 0; state.stretch = 0; state.velocityX = 0; state.velocityStretch = 0; state.targetX = 0; state.targetStretch = 0; state.released = true; }
    function emit() { try { onFrame({ x: state.x, stretch: state.stretch }); } catch (error) { stop(); throw error; } }
    function settled() { return Math.abs(state.x - state.targetX) < .04 && Math.abs(state.velocityX) < .1 && Math.abs(state.stretch - state.targetStretch) < .00002 && Math.abs(state.velocityStretch) < .0001; }
    function integrate(dt) {
      state.velocityX += (-260 * (state.x - state.targetX) - 22 * state.velocityX) * dt;
      state.x += state.velocityX * dt;
      state.velocityStretch += (-260 * (state.stretch - state.targetStretch) - 22 * state.velocityStretch) * dt;
      state.stretch += state.velocityStretch * dt;
      if (Math.abs(state.x) > 22) { state.x = clamp(state.x, 22); if (state.x * state.velocityX > 0) state.velocityX = 0; }
      if (Math.abs(state.stretch) > .025) { state.stretch = clamp(state.stretch, .025); if (state.stretch * state.velocityStretch > 0) state.velocityStretch = 0; }
    }
    function tick(time) {
      frame = null; if (state.disposed || !state.running) return;
      let remaining = Math.max(0, Math.min(.05, (time - lastTime) / 1000)); lastTime = time;
      while (remaining > 0) { const dt = Math.min(1 / 120, remaining); integrate(dt); remaining -= dt; }
      if (settled()) { state.x = state.targetX; state.stretch = state.targetStretch; state.velocityX = 0; state.velocityStretch = 0; state.running = false; }
      emit(); if (!state.disposed && state.running && frame === null) frame = request(tick);
    }
    function start() {
      if (state.disposed) return;
      if (reducedMotion === true) { stop(); zero(); emit(); return; }
      if (settled()) { stop(); state.x = state.targetX; state.stretch = state.targetStretch; state.velocityX = 0; state.velocityStretch = 0; emit(); return; }
      if (!state.running) { state.running = true; lastTime = clock(); }
      if (frame === null) frame = request(tick);
    }
    function target(value, name, limit) { if (value === undefined) return 0; if (!finite(value)) throw new TypeError(`Presentation spring ${name} must be finite.`); return clamp(value, limit); }
    function pull({ x, stretch } = {}) {
      if (state.disposed) return false;
      const nextX = target(x, "x", 18), nextStretch = target(stretch, "stretch", .018);
      state.targetX = nextX; state.targetStretch = nextStretch; state.released = false; start(); return true;
    }
    function release({ impulseX = 0 } = {}) {
      if (state.disposed) return false;
      if (!finite(impulseX)) throw new TypeError("Presentation spring impulseX must be finite.");
      state.targetX = 0; state.targetStretch = 0; state.released = true; state.velocityX += clamp(impulseX, 100); start(); return true;
    }
    function reset() { if (state.disposed) return; stop(); zero(); lastTime = clock(); emit(); }
    function destroy() { stop(); zero(); state.disposed = true; }
    emit();
    return Object.freeze({ pull, release, reset, destroy, inspect: () => ({ ...state }) });
  }
  root.PPCSelloutSpring = Object.freeze({ create });
})(typeof globalThis !== "undefined" ? globalThis : this);
