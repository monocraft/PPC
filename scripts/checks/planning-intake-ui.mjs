import assert from 'node:assert/strict';
import '../../public/js/ascm-import.js';
import '../../public/js/master-model.js';
import '../../public/js/date-precision.js';
import '../../public/js/plc-import.js';
import '../../public/js/planning-intake.js';
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; this.dataset = {}; this.textContent = ''; this.className = ''; this.value = ''; this.open = false; this.disabled = false; this.classList = { add: value => { this.className += ` ${value}`; } }; }
  append(...elements) { for (const element of elements) { element.parent = this; this.children.push(element); } }
  replaceChildren(...elements) { this.children = []; this.append(...elements); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(event, handler) { (this.listeners[event] ||= []).push(handler); }
  async emit(event) { for (const handler of this.listeners[event] || []) await handler({ target: this, preventDefault() {} }); }
  showModal() { this.open = true; }
  close() { this.open = false; void this.emit('close'); }
  focus() { document.activeElement = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
}
const body = new Element('body'), trigger = new Element('button');
globalThis.document = { body, activeElement: trigger, createElement: tag => new Element(tag) };
const saved = new Map(); globalThis.localStorage = { getItem: key => saved.get(key) || null, setItem: (key, text) => saved.set(key, text) };
await import('../../public/js/planning-intake-ui.js');
const elements = () => { const output = []; const walk = parent => { output.push(parent); parent.children.forEach(walk); }; walk(body); return output; };
const aria = name => elements().find(element => element.attributes['aria-label'] === name);
const cls = name => elements().find(element => element.className.split(' ').includes(name));
const button = text => elements().find(element => element.tagName === 'BUTTON' && element.textContent === text);
const bytes = new TextEncoder().encode('Extract ID,Product,Category,FFS\nSYN-1,Synthetic source name,Mice,Q2 2028');
const file = { name: 'Synthetic planning.csv', size: bytes.length, arrayBuffer: async () => bytes };
const seed = { version: 4, settings: { retained: true }, imageAssets: [], categories: [{ id: 'mice', name: 'Mice', board: { lanes: [{ id: 'lane', label: 'Lane' }], products: [] } }] };
let portfolio = structuredClone(seed), applyCount = 0, throwCallbacks = false; const stateUpdates = [];
const adapter = { getPortfolio: () => portfolio, onStateChange(value) { stateUpdates.push(value); if (throwCallbacks) throw new Error('Synthetic badge failure'); }, async applyPlanning(result) { assert.equal(JSON.stringify(portfolio), result.expectedBaseline); applyCount++; const draft = structuredClone(portfolio); for (const operation of result.operations) draft.categories[0].board.products.push({ id: operation.productId, laneId: operation.laneId, ...operation.fields }); portfolio = draft; } };
let controller = PortfolioPlanningIntakeUI.create(adapter); controller.open(); assert.equal(cls('planning-intake').open, true);
const settle = async () => { for (let count = 0; count < 100 && controller.getState().busy; count++) await new Promise(resolve => setTimeout(resolve, 2)); assert.equal(controller.getState().busy, false); };
const load = async () => { const input = aria('Planning XLSX or CSV'); input.files = [file]; await input.emit('change'); await button('Review file').emit('click'); await settle(); assert.equal(controller.getState().rowCount, 1); };
await load(); assert.equal(cls('planning-intake-apply').disabled, true); assert.equal(stateUpdates.at(-1).rowCount, 1); assert.equal(stateUpdates.at(-1).busy, false);
const family = aria('Planning source collection'); family.value = 'Revised source collection'; await family.emit('input'); assert.equal(controller.getState().rowCount, 0); assert.equal(stateUpdates.at(-1).rowCount, 0); assert.equal(cls('planning-intake-apply').disabled, true); assert.match(cls('planning-intake-status').textContent, /Review file again/);
await button('Review file').emit('click'); await settle();
const action = aria('Decision for Synthetic source name'); action.value = 'create'; await action.emit('change');
const category = aria('Category for Synthetic source name'); category.value = 'mice'; await category.emit('change');
const lane = aria('Lane for Synthetic source name'); lane.value = 'lane'; await lane.emit('change');
const ffs = aria('Apply FFS for Synthetic source name'); ffs.checked = true; await ffs.emit('change');
assert.equal(controller.getState().decisions[0].overrideProtected, false); assert.deepEqual(controller.getState().decisions[0].fields, ['name', 'ffsDate']);
assert.deepEqual(stateUpdates.at(-1).decisions[0].fields, ['name', 'ffsDate']); stateUpdates.at(-1).decisions[0].fields.length = 0; assert.equal(controller.getState().decisions[0].fields.length, 2, 'Badge snapshots cannot mutate reviewed field choices.');
await cls('planning-intake-apply').emit('click'); await settle(); assert.equal(applyCount, 1); assert.equal(portfolio.categories[0].board.products[0].ffsDate, '2028-04-01'); assert.equal(portfolio.categories[0].board.products[0].plc.fields.ffsDate.period.label, 'Q2 2028'); assert.deepEqual(portfolio.settings, seed.settings);
const stored = saved.get(PortfolioPlanningIntakeUI.storageKey); assert(stored); assert(!stored.includes('Synthetic source name')); assert(!stored.includes('2028-04-01')); assert(!stored.includes('Q2 2028')); assert.equal(JSON.parse(stored).decisions.length, 1);
await aria('Close planning intake').emit('click'); assert.equal(document.activeElement, trigger); controller.destroy();
controller = PortfolioPlanningIntakeUI.create(adapter); controller.open(); aria('Planning source collection').value = 'Revised source collection'; await load();
assert.equal(controller.getState().decisions[0].action, 'match'); assert.equal(controller.getState().decisions[0].productId, portfolio.categories[0].board.products[0].id); assert.deepEqual(controller.getState().decisions[0].fields, [], 'Reloaded mappings never approve changed fields.');
portfolio.settings.changedDuringReview = true; await cls('planning-intake-apply').emit('click'); await settle(); assert.equal(applyCount, 1); assert.match(cls('planning-intake-status').textContent, /portfolio changed/);
controller.destroy();
throwCallbacks = true; controller = PortfolioPlanningIntakeUI.create(adapter); await controller.open(file); await settle(); assert.equal(controller.getState().rowCount, 1, 'A Load data file handoff opens the same review without a second file picker.'); assert.equal(cls('planning-intake-selected-file').textContent, file.name); assert.equal(applyCount, 1, 'File handoff never applies decisions.'); assert.deepEqual(controller.getState().decisions[0].fields, []); assert.equal(stateUpdates.at(-1).rowCount, 1, 'Host callback failures never interrupt source review.');
const invalid = { name: 'wrong.txt', size: 1, arrayBuffer: async () => new Uint8Array([1]) }; await controller.open(invalid); await settle(); assert.equal(controller.getState().rowCount, 0); assert.equal(cls('planning-intake-apply').disabled, true); assert.match(cls('planning-intake-status').textContent, /ordinary|\.xlsx/);
controller.destroy(); delete globalThis.document; delete globalThis.localStorage;
console.log('Planning intake UI checks passed: explicit row/category/lane/field choices, family-change invalidation, reviewed application, minimal private-free remembered mappings, reload-safe identity without field approval, stale-review refusal, and modal return focus.');
