import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../public/js/roadmap-hover.js', import.meta.url), 'utf8');

function element(name = 'div') {
  const listeners = new Map(), values = new Set();
  return {
    nodeName: name.toUpperCase(), children: [], style: {}, dataset: {}, attributes: {},
    className: '', classList: {
      add(...names) { names.forEach((name) => values.add(name)); },
      remove(...names) { names.forEach((name) => values.delete(name)); },
      contains(name) { return values.has(name); },
      toggle(name, enabled = !values.has(name)) { if (enabled) values.add(name); else values.delete(name); return enabled; },
    },
    append(...children) { children.forEach((child) => { child.parentElement = this; this.children.push(child); }); },
    appendChild(child) { this.append(child); return child; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
    removeEventListener(name, callback) { listeners.set(name, (listeners.get(name) || []).filter((value) => value !== callback)); },
    dispatch(name, event = {}) { for (const callback of listeners.get(name) || []) callback({ type: name, ...event }); },
    getBoundingClientRect() { return this.rect; },
    closest() { return null; },
    getContext() { throw new Error('The hover overlay must not redraw the roadmap canvas.'); },
  };
}

function runtime() {
  const frames = new Map(); let sequence = 0, requests = 0;
  const window = element('window'); window.matchMedia = () => ({ matches: false });
  const context = {
    document: { createElement: element }, Map, Set, Math, Number, Object, String,
    requestAnimationFrame(callback) { requests++; frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); },
    window, matchMedia: () => ({ matches: false }),
  };
  vm.createContext(context); new vm.Script(source).runInContext(context);
  const module = context.RoadmapLaneHover || context.window.RoadmapLaneHover;
  assert.equal(typeof module?.create, 'function', 'the hover module exposes its controller factory');
  return {
    create: module.create,
    window,
    frames,
    get requests() { return requests; },
    flush() {
      for (let round = 0; frames.size && round < 10; round++) {
        const pending = Array.from(frames.values()); frames.clear(); pending.forEach((callback) => callback());
      }
      assert.equal(frames.size, 0, 'hover animation must settle without a recurring canvas redraw loop');
    },
  };
}

function fixture(run = runtime()) {
  const parent = element(); parent.rect = { left: 16, top: 112, right: 924, bottom: 728, width: 908, height: 616 };
  const scroll = element(); scroll.rect = { left: 20, top: 120, right: 920, bottom: 720, width: 900, height: 600 };
  Object.assign(scroll, { clientWidth: 900, clientHeight: 600, clientLeft: 0, clientTop: 0, offsetLeft: 4, offsetTop: 8, scrollLeft: 200, scrollTop: 140 });
  const canvas = element('canvas'); canvas.rect = { left: -180, top: -20, right: 1820, bottom: 1980, width: 2000, height: 2000 };
  parent.append(scroll); scroll.append(canvas);
  let owner = { id: 'portfolio-1' }, suspended = false;
  let rows = [
    Object.freeze({ productId: 'p1', y: 260, height: 40 }),
    Object.freeze({ productId: 'p2', y: 300, height: 40 }),
    Object.freeze({ productId: 'p3', y: 380, height: 40 }),
  ];
  const originalRows = rows.map((row) => ({ ...row })), changes = [];
  const controller = run.create(canvas, scroll, {
    headerHeight: 100, railWidth: 48,
    getRows: () => rows, getOwner: () => owner, isSuspended: () => suspended,
    onChange: (productId) => changes.push(productId),
  });
  const clip = parent.children.find((child) => child.className === 'roadmap-lane-hover-clip');
  assert(clip, 'a viewport overlay is placed outside the scrolling canvas');
  const frame = clip.children.find((child) => child.className === 'roadmap-lane-hover-frame');
  assert(frame, 'the overlay has one reusable row frame');
  const move = (x = 500, y = 250, extras = {}) => canvas.dispatch('pointermove', { clientX: x, clientY: y, isPrimary: true, pointerType: 'mouse', buttons: 0, ...extras });
  const visible = () => frame.style.opacity !== '0' && Boolean(frame.dataset.productId);
  return {
    run, canvas, scroll, parent, clip, frame, controller, changes, move, visible,
    get rows() { return rows; }, set rows(value) { rows = value; },
    set owner(value) { owner = value; }, set suspended(value) { suspended = value; },
    unchanged() { assert.deepEqual(rows.map((row) => ({ ...row })), originalRows, 'hovering leaves every product row unchanged'); },
  };
}

{
  const h = fixture();
  h.move();
  assert.equal(h.frame.dataset.productId, 'p1', 'entering a product lane shows its identity');
  assert(h.visible());
  assert.equal(h.clip.attributes['aria-hidden'], 'true', 'the visual guide is excluded from duplicate accessibility announcements');
  assert.equal(h.clip.style.left, '52px', 'the frame begins after the fixed category rail');
  assert.equal(h.clip.style.top, '108px', 'the viewport clip starts below the sticky calendar');
  assert.equal(h.clip.style.width, '844px', 'the outline spans the product name and visible timeline');
  assert.equal(h.clip.style.height, '500px', 'the clipping region ends at the visible viewport bottom');
  assert.equal(h.frame.style.transform, 'translateY(21px)', 'the frame follows the row below the sticky header with a one-pixel inset');
  assert.equal(h.frame.style.height, '38px', 'the thin outline fits inside the product lane');
  assert.deepEqual(h.changes, ['p1']);
  h.run.flush();
  h.move(800, 260);
  assert.deepEqual(h.changes, ['p1'], 'moving within a lane does not repaint the name rail repeatedly');
  h.move(800, 290);
  assert.equal(h.frame.dataset.productId, 'p2', 'moving to another lane reuses the same frame');
  assert.equal(h.frame.classList.contains('is-immediate'), false, 'neighboring lanes retain the CSS transition');
  assert.deepEqual(h.changes, ['p1', 'p2']);
  h.unchanged(); h.run.flush();
}

for (const [x, y, label] of [[35, 250, 'category rail'], [500, 180, 'sticky calendar header'], [500, 335, 'group gap'], [950, 250, 'outside the right viewport'], [500, 740, 'outside the bottom viewport']]) {
  const h = fixture(); h.move(); h.run.flush(); h.move(x, y);
  assert.equal(h.visible(), false, `${label} cannot inherit a neighboring product outline`);
  assert.equal(h.changes.at(-1), null, `${label} clears the active product`);
  h.run.flush(); h.unchanged();
}

{
  const h = fixture(); h.move(); h.run.flush();
  h.scroll.scrollTop = 180; h.canvas.rect.top = -60;
  h.controller.sync({ immediate: true });
  assert.equal(h.frame.dataset.productId, 'p2', 'a stationary pointer follows the lane now beneath it after vertical scrolling');
  assert(h.frame.classList.contains('is-immediate'), 'scroll adjustments avoid animating through unrelated rows');
  h.run.flush();
  const vertical = h.frame.style.transform;
  h.scroll.scrollLeft = 400; h.canvas.rect.left = -380;
  h.controller.sync({ immediate: true });
  assert.equal(h.frame.dataset.productId, 'p2', 'horizontal scrolling preserves the same product lane');
  assert.equal(h.frame.style.transform, vertical, 'the viewport-wide outline stays aligned while the timeline pans horizontally');
  h.run.flush(); h.unchanged();
}

{
  const h = fixture(); h.scroll.scrollTop = 170; h.canvas.rect.top = -50;
  h.move(500, 225);
  assert.equal(h.frame.dataset.productId, 'p1', 'a partly visible product remains identifiable below the sticky header');
  assert.equal(h.frame.style.transform, 'translateY(-9px)', 'a partially obscured lane is clipped rather than moved away from its product');
  h.run.flush(); h.scroll.clientWidth = 450; h.controller.sync({ immediate: true });
  assert.equal(h.visible(), false, 'a narrower viewport removes an outline when the pointer is now outside');
  assert.equal(h.clip.style.width, '394px', 'resizing updates the full visible lane width');
  h.run.flush(); h.unchanged();
}

{
  const h = fixture(); h.move(); h.run.flush();
  h.rows = h.rows.filter((row) => row.productId !== 'p1');
  h.controller.sync();
  assert.equal(h.visible(), false, 'filtering out the hovered product removes a stale outline');
  h.move(500, 290); assert.equal(h.frame.dataset.productId, 'p2'); h.run.flush();
  h.owner = { id: 'portfolio-2' }; h.controller.sync();
  assert.equal(h.visible(), false, 'switching portfolio or view cannot carry a hover to another owner');
  h.controller.sync(); assert.equal(h.visible(), false, 'owner changes discard stale pointer coordinates');
  h.move(500, 290); assert.equal(h.frame.dataset.productId, 'p2', 'a fresh pointer move can start hovering in the new owner');
  h.run.flush();
}

for (const name of ['pointerleave', 'pointerdown', 'pointercancel', 'lostpointercapture']) {
  const h = fixture(); h.move(); h.run.flush(); h.canvas.dispatch(name, { pointerType: 'mouse' });
  assert.equal(h.visible(), false, `${name} clears the hover`);
  h.controller.sync(); assert.equal(h.visible(), false, `${name} cannot revive a stale pointer on the next paint`);
  h.run.flush(); h.unchanged();
}

{
  const h = fixture(); h.move(500, 250, { pointerType: 'touch' });
  assert.equal(h.visible(), false, 'touch navigation does not create a persistent hover');
  h.move(); h.run.flush(); h.suspended = true; h.controller.sync();
  assert.equal(h.visible(), false, 'panning, dragging or hidden views suppress the hover');
  h.suspended = false; h.controller.sync();
  assert.equal(h.visible(), false, 'an interaction cannot resurrect the previous hover without fresh pointer movement');
  h.move(); assert.equal(h.frame.dataset.productId, 'p1'); h.run.flush();
  h.move(500, 250, { isPrimary: false });
  assert.equal(h.visible(), false, 'secondary pointer events cannot move a primary product guide');
  h.run.flush(); h.unchanged();
}

{
  const run = runtime(), main = fixture(run), split = fixture(run);
  main.move(); split.move(500, 290);
  assert.equal(main.frame.dataset.productId, 'p1'); assert.equal(split.frame.dataset.productId, 'p2');
  main.controller.clear(); assert.equal(main.visible(), false); assert.equal(split.visible(), true, 'clearing the main roadmap does not clear the split roadmap');
  run.window.dispatch('blur'); assert.equal(split.visible(), false, 'leaving the browser window removes stale hover from every roadmap');
  run.flush(); main.unchanged(); split.unchanged();
}

{
  const h = fixture();
  for (let index = 0; index < 200; index++) h.move(500 + index, 250);
  assert(h.run.frames.size <= 1, 'continuous pointer movement queues at most one transition frame');
  assert.equal(h.changes.length, 1, 'pointer movement in one lane produces one product change');
  h.run.flush(); const requests = h.run.requests;
  for (let index = 0; index < 200; index++) h.controller.sync();
  h.run.flush();
  assert.equal(h.run.requests, requests, 'steady hover does not run a render loop');
  h.unchanged();
}

const [css, app, html] = await Promise.all([
  readFile(new URL('../../public/css/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../../public/js/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../../public/index.html', import.meta.url), 'utf8'),
]);
const frameCss = css.match(/\.roadmap-lane-hover-frame\s*\{([^}]+)\}/)?.[1];
const clipCss = css.match(/\.roadmap-lane-hover-clip\s*\{([^}]+)\}/)?.[1];
assert.match(frameCss, /border:\s*1px\s+dashed\b/, 'the product lane uses the requested thin dashed outline');
assert.match(frameCss, /transition:[^;]*transform[^;]*opacity/, 'motion and fading are CSS transitions');
assert.match(frameCss, /pointer-events:\s*none/, 'the outline cannot intercept product clicks or drags');
assert.match(clipCss, /pointer-events:\s*none/, 'the viewport overlay cannot block timeline navigation');
assert.match(clipCss, /overflow:\s*hidden/, 'the frame cannot overlap the sticky calendar while scrolling');
assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.roadmap-lane-hover-frame\s*\{\s*transition:\s*none/, 'reduced-motion preferences disable the glide');
assert(html.indexOf('js/roadmap-hover.js') < html.indexOf('js/app.js'), 'the hover controller loads before roadmap bindings');
assert.match(app, /if\s*\(includeSelection\s*&&\s*!exportMode\)\s*\{\s*roadmapRowRegions\.set\(targetCanvas, rows\);\s*roadmapLaneHovers\.get\(targetCanvas\)\?\.sync\(\);/, 'canvas export rendering cannot update the live hover guide');

console.log('Roadmap hover checks passed: viewport lane tracking, smooth row transitions, scroll retargeting, header/gap exclusion, owner/filter invalidation, safe interaction suspension, separate main/split overlays, bounded animation work and unchanged product rows.');
