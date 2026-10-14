/* Finite time-window glides. Line, area and dots consume the same pixel samples. */
(function (root) {
  "use strict";
  const DAY = 86400000;
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const copy = samples => samples.map(sample => ({ date: sample.date, x: sample.x, y: sample.y }));
  function day(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const milliseconds = Date.parse(value + "T00:00:00Z");
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value ? milliseconds / DAY : null;
  }
  function normalize(samples) {
    if (!Array.isArray(samples)) throw new TypeError("Time-window samples must be an array.");
    let previous = "";
    return samples.map(sample => {
      if (!sample || day(sample.date) === null || !finite(sample.x) || sample.y !== null && !finite(sample.y) || sample.date <= previous) throw new TypeError("Time-window samples require unique ascending ISO dates, finite x, and finite or null y.");
      previous = sample.date;
      return { date: sample.date, x: sample.x, y: sample.y };
    });
  }
  function projection(domain, target, previous) {
    if (domain !== undefined) {
      const start = day(domain?.start), end = day(domain?.end);
      if (start === null || end === null || end < start || !finite(domain.left) || !finite(domain.right) || domain.right < domain.left) throw new TypeError("Time-window domain requires ordered ISO dates and finite left/right pixels.");
      const span = end - start, scale = (domain.right - domain.left) / (span || 7), anchor = span ? domain.left : (domain.left + domain.right) / 2;
      return { scale, offset: anchor - start * scale };
    }
    if (target.length > 1) { const first = target[0], last = target.at(-1), scale = (last.x - first.x) / (day(last.date) - day(first.date)); return { scale, offset: first.x - day(first.date) * scale }; }
    if (target.length) { const scale = previous?.scale || 0; return { scale, offset: target[0].x - day(target[0].date) * scale }; }
    return previous ? { ...previous } : { scale: 0, offset: 0 };
  }
  const project = (mapping, date) => day(date) * mapping.scale + mapping.offset;
  const ease = progress => 1 - Math.pow(1 - progress, 3);
  function create({ requestFrame, cancelFrame, now } = {}) {
    const clock = now || (() => root.performance?.now?.() ?? Date.now());
    const request = requestFrame || (callback => root.requestAnimationFrame ? root.requestAnimationFrame(callback) : root.setTimeout(() => callback(clock()), 16));
    const cancelRequest = cancelFrame || (handle => root.cancelAnimationFrame ? root.cancelAnimationFrame(handle) : root.clearTimeout(handle));
    const windows = new Map();
    function cancel(key) {
      const state = windows.get(key); if (!state) return false;
      if (state.frame !== null) cancelRequest(state.frame);
      state.frame = null; state.running = false;
      return true;
    }
    function reset(key) {
      if (key === undefined) { for (const stored of windows.keys()) cancel(stored); windows.clear(); }
      else { cancel(key); windows.delete(key); }
    }
    function emit(state, settled) {
      try { state.onFrame({ samples: copy(state.samples), baseline: state.baseline, settled }); }
      catch (error) { if (state.frame !== null) cancelRequest(state.frame); state.frame = null; state.running = false; throw error; }
    }
    function transition(key, input, options = {}) {
      if (typeof key !== "string" || !key || key.length > 500) throw new TypeError("Time-window transition requires a stable string key.");
      if (typeof options.onFrame !== "function") throw new TypeError("Time-window transition requires onFrame.");
      const target = normalize(input), previous = windows.get(key), nextProjection = projection(options.domain, target, previous?.projection);
      const targetBaseline = finite(options.baseline) ? options.baseline : previous?.baseline ?? 0;
      if (options.baseline !== undefined && !finite(options.baseline)) throw new TypeError("Time-window baseline must be finite.");
      const duration = Math.min(5000, Math.max(0, finite(options.duration) ? options.duration : 420));
      cancel(key);
      const state = { samples: copy(target), baseline: targetBaseline, projection: nextProjection, frame: null, running: false, onFrame: options.onFrame };
      windows.set(key, state);
      const stop = () => { if (windows.get(key) === state) cancel(key); };
      if (!previous || options.reducedMotion === true || duration === 0 || !target.length) { emit(state, true); return Object.freeze({ cancel: stop }); }
      const displayed = new Map(previous.samples.map(sample => [sample.date, sample])), wanted = new Map(target.map(sample => [sample.date, sample]));
      const dates = [...new Set([...displayed.keys(), ...wanted.keys()])].sort();
      const tracks = dates.map(date => {
        const from = displayed.get(date), to = wanted.get(date);
        return { date, from: from ? { ...from } : { date, x: project(previous.projection, date), y: to.y }, to: to ? { ...to } : { date, x: project(nextProjection, date), y: from.y } };
      });
      const unchanged = dates.length === target.length && tracks.every(track => track.from.x === track.to.x && track.from.y === track.to.y) && previous.baseline === targetBaseline;
      if (unchanged) { emit(state, true); return Object.freeze({ cancel: stop }); }
      const fromProjection = { ...previous.projection }, fromBaseline = previous.baseline, started = clock();
      state.running = true;
      const sample = progress => {
        const t = ease(progress);
        state.samples = tracks.map(track => ({ date: track.date, x: track.from.x + (track.to.x - track.from.x) * t, y: track.from.y === null || track.to.y === null ? track.to.y : track.from.y + (track.to.y - track.from.y) * t }));
        state.baseline = fromBaseline + (targetBaseline - fromBaseline) * t;
        state.projection = { scale: fromProjection.scale + (nextProjection.scale - fromProjection.scale) * t, offset: fromProjection.offset + (nextProjection.offset - fromProjection.offset) * t };
      };
      sample(0); emit(state, false);
      const tick = time => {
        state.frame = null;
        if (windows.get(key) !== state || !state.running) return;
        const progress = Math.min(1, Math.max(0, (time - started) / duration)); sample(progress);
        const settled = progress === 1;
        if (settled) { state.samples = copy(target); state.baseline = targetBaseline; state.projection = nextProjection; state.running = false; }
        emit(state, settled);
        if (windows.get(key) === state && state.running) state.frame = request(tick);
      };
      if (windows.get(key) === state && state.running) state.frame = request(tick);
      return Object.freeze({ cancel: stop });
    }
    function inspect(key) {
      const state = windows.get(key);
      return state ? { samples: copy(state.samples), baseline: state.baseline, projection: { ...state.projection }, running: state.running } : null;
    }
    return Object.freeze({ transition, cancel, reset, inspect });
  }
  root.PPCSelloutMotion = Object.freeze({ ...create(), create });
})(typeof globalThis !== "undefined" ? globalThis : this);
