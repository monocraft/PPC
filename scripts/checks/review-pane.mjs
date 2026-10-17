// Full shipped Review controller, actual PLC precision model, synthetic records.
// This boundary models DOM events/focus and replacement, never the controller logic.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../public/js/portfolio-model.js';
import '../../public/js/date-precision.js';
import '../../public/js/plc-import.js';

const source = await readFile(new URL('../../public/js/workflow-ui.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../public/css/workflow-ui.css', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const importer = globalThis.PLCImporter, period = globalThis.PortfolioDatePrecision.parseQuarter('Q2 2028');
const currentProduct = { id: 'review-fixture', name: 'Synthetic quarter headset', codename: 'FixtureProject', laneId: 'main', ffsDate: period.start, generalAvailabilityDate: '2028-08-18', roadmap: { status: 'in-development' }, imageAssetId: 'fixture-image', specs: [], partSkus: [], variantGroups: [], plc: { reportDate: '2026-10-08', fields: { ffsDate: { value: period.start, period, raw: 'Q2 2028', reportDate: '2026-10-08' } } } };
const row = { key: 'review-source', name: currentProduct.name, codename: currentProduct.codename, productId: currentProduct.id, categoryId: 'fixture-category', dates: { ffsDate: { ...importer.parseDate('Q3 2028', { quarterBasis: 'calendar' }), source: { sheet: 'Synthetic source', cell: 'F4' } }, generalAvailabilityDate: { kind: 'exact', value: '2028-09-19', raw: '2028-09-19', source: { sheet: 'Synthetic source', cell: 'G4' } } }, sources: [], milestones: {}, data: {} };
const seed = { version: 4, categories: [{ id: 'fixture-category', name: 'Synthetic category', board: { lanes: [{ id: 'main' }], products: [currentProduct] } }], plcReview: { version: 1, entries: [{ key: row.key, row, fields: ['ffsDate', 'generalAvailabilityDate'], matchNeeded: false, metadata: { fileName: 'Synthetic PLC.xlsx', fingerprint: 'synthetic-fingerprint', reportDate: '2026-10-15' }, reportDate: '2026-10-15' }] } };
const drain = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };

async function fixture({ notices = 29, storageFails = false } = {}) {
  let doc;
  class Element {
    constructor(tag) { this.tagName = tag.toLowerCase(); this.children = []; this.parentElement = null; this.events = new Map(); this.attrs = new Map(); this.dataset = {}; this.className = ''; this.style = { setProperty(key, value) { this[key] = value; } }; this.textContent = ''; this.value = ''; this.scrollTop = 0; this.open = false; this.hidden = false; this.disabled = false; this.classList = { add: (...items) => { this.className += ' ' + items.join(' '); }, contains: item => this.className.split(' ').includes(item) }; }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } if (this.tagName === 'select' && !this.value) this.value = children[0]?.value || ''; }
    replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.scrollTop = 0; this.append(...children); }
    setAttribute(key, value) { this.attrs.set(key, String(value)); }
    getAttribute(key) { return this.attrs.get(key) ?? null; }
    addEventListener(type, callback) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(callback); }
    removeEventListener(type, callback) { this.events.set(type, (this.events.get(type) || []).filter(value => value !== callback)); }
    async emit(type, event = {}) { for (const callback of this.events.get(type) || []) await callback({ target: this, ...event }); await drain(); }
    async click() { if (!this.disabled) { this.focus(); await this.emit('click'); } }
    focus(options) { doc.activeElement = this; this.focusOptions = options; }
    showModal() { this.open = true; }
    close() { this.open = false; void this.emit('close'); }
    contains(other) { return this === other || this.children.some(child => child.contains(other)); }
    get isConnected() { return this === doc.body || Boolean(this.parentElement?.isConnected); }
    get options() { return this.children.filter(child => child.tagName === 'option'); }
    matches(selector) {
      if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
      const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attr) { const key = attr[1].replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); const value = attr[1].startsWith('data-') ? this.dataset[key] : this.attrs.get(attr[1]); return attr[2] === undefined ? value !== undefined : value === attr[2]; }
      return this.tagName === selector;
    }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const body = new Element('body');
  doc = { body, activeElement: body, documentElement: new Element('html'), createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag), querySelector: () => null, querySelectorAll: () => [], getElementById(id) { return find(body, value => value.id === id); } };
  for (const id of ['workflowReviewButton', 'workflowAnnouncement', 'settingsLocalCopies']) { const element = new Element('button'); element.id = id; body.append(element); }
  const portfolio = clone(seed), stored = new Map(), events = new Map(), calls = { plc: 0, planning: 0, product: [], analytics: [], messages: [], recovery: 0, closeSettings: 0, backend: 0, writes: 0 };
  const notifications = Array.from({ length: notices }, (_, index) => ({ id: 'notice-' + index, severity: index === 0 ? 'error' : 'warning', title: 'Synthetic notice ' + index, message: 'Source evidence for synthetic record ' + index, dismissible: index !== 0, revision: 1 }));
  let failure = null;
  const root = { document: doc, location: new URL('https://portfolio.example.test/index.html'), innerWidth: 1200, innerHeight: 1000, PortfolioWorkspaceReady: Promise.resolve(), PortfolioDatePrecision: globalThis.PortfolioDatePrecision, PLCImporter: importer,
    PortfolioWorkflowModel: { fields: ['ffsDate'], identifyFile() { throw Error('No file import in this fixture.'); } },
    PortfolioFieldProtection: { check: () => ({ protected: false }), getState: () => ({ blocked: false }) },
    localStorage: { getItem: key => stored.get(key) || null, setItem(key, value) { if (storageFails) throw Error('Synthetic denied storage'); stored.set(key, value); } },
    PortfolioPlanningIntakeUI: { create: () => ({ getState: () => ({ rowCount: 0 }), open: () => { calls.planning++; } }) },
    PortfolioWorkspaceUI: { closeSettings: () => { calls.closeSettings++; } },
    PortfolioNotifications: { getState: () => ({ items: notifications }), show: id => { calls.messages.push(id); }, subscribe(callback) { root.noticeRefresh = callback; } },
    PortfolioWorkflowAdapter: { getPortfolio: () => portfolio, getStatus: () => ({ localError: Boolean(failure) }), getLocalSaveFailure: () => failure, getSelectedProductId: () => currentProduct.id, openProduct: id => { calls.product.push(id); }, openPlcReview: () => { calls.plc++; }, navigateToAnalytics: section => { calls.analytics.push(section); }, listLocalCopies: async () => { calls.recovery++; return []; }, applyPlanning() { calls.writes++; throw Error('This review must not write products.'); } },
    addEventListener(type, callback) { if (!events.has(type)) events.set(type, []); events.get(type).push(callback); }, removeEventListener() {}, dispatchEvent(event) { for (const callback of events.get(event.type) || []) callback(event); },
    fetch() { calls.backend++; throw Error('No network in Review checks.'); },
  };
  vm.runInNewContext(source, { globalThis: root, URL, Promise, console, Error, Number, Set, Map, Date, Object, Array, String, CustomEvent: class { constructor(type) { this.type = type; } }, setTimeout, clearTimeout }, { filename: 'workflow-ui.js' });
  await drain(); assert.ok(root.PortfolioWorkflowUI, 'The complete shipped controller initialized.');
  return { root, doc, portfolio, notifications, stored, calls, setFailure: value => { failure = value; }, review: doc.getElementById('workflowReviewDialog'), list: doc.getElementById('workflowReviewMessages'), evidence: doc.getElementById('workflowSelectedEvidence'), async open() { await doc.getElementById('workflowReviewButton').click(); }, async filter(label) { await find(doc.body, value => value.tagName === 'button' && value.getAttribute('aria-label') === label).click(); } };
}
function find(element, predicate) { return predicate(element) ? element : element.children.map(child => find(child, predicate)).find(Boolean); }
function text(element) { return [element.textContent, ...element.children.map(text)].join(' '); }
function control(h, name, item) { return find(h.review, value => value.dataset.reviewControl === name && (item === undefined || value.dataset.reviewItem === item)); }
function tool(h, label) { return find(h.review, value => value.className === 'workflow-review-tool' && value.getAttribute('aria-label') === label); }

const h = await fixture(), baseline = JSON.stringify(h.portfolio); await h.open();
assert.equal(h.review.open, true);
assert.equal(h.list.children.length, 30, '29 real notifications plus a retained PLC review entry are listed.');
const shelf = find(h.review, value => value.className === 'workflow-review-tools');
assert.equal(shelf.tagName, 'section', 'Tools never depend on a closed details disclosure.');
assert.equal(shelf.querySelectorAll('button').length, 6);
assert.ok(h.review.children[1].children.indexOf(shelf) < h.review.children[1].children.indexOf(h.list.parentElement), 'Tools precede the only growing queue.');
assert.match(text(h.evidence), /Synthetic notice 0/, 'An urgent action takes initial priority.');
await control(h, 'select', 'plc:review-source').click();
assert.match(text(h.evidence), /Current · Q2 2028/); assert.match(text(h.evidence), /Source · Q3 2028/);
assert.match(text(h.evidence), /calendar quarter precision retained/);
const rail = find(h.evidence, value => value.className === 'workflow-review-time-observations');
assert.equal(rail.children[0].style['--review-quarter'], 2); assert.equal(rail.children[1].style['--review-quarter'], 3);
await control(h, 'field:generalAvailabilityDate').click();
assert.match(text(h.evidence), /2028-08-18/); assert.match(text(h.evidence), /2028-09-19/); assert.match(text(h.evidence), /Exact day/);
assert.equal(find(h.evidence, value => value.className === 'workflow-review-time-rail'), undefined, 'Exact days never appear on an invented quarter diagram.');
assert.equal(h.doc.activeElement.dataset.reviewControl, 'field:generalAvailabilityDate');

h.list.scrollTop = 621; await control(h, 'select', 'message:notice-20').click();
assert.equal(h.list.scrollTop, 621, 'Selecting an off-screen message retains message scroll after DOM replacement.');
assert.equal(h.doc.activeElement.dataset.reviewItem, 'message:notice-20');
assert.equal(h.doc.activeElement.focusOptions.preventScroll, true);
assert.equal(find(h.review, value => value.className === 'workflow-review-tools'), shelf, 'The tool shelf stays mounted during selection.');
assert.match(text(h.evidence), /Synthetic notice 20/);
await control(h, 'defer', 'message:notice-20').click(); assert.equal(h.list.scrollTop, 621);
assert.equal(h.doc.activeElement.dataset.reviewItem, 'message:notice-21', 'Removing a focused message continues at its neighbor rather than an off-screen first item.');
assert.match(text(h.evidence), /Synthetic notice 21/);
assert.equal(JSON.parse(h.stored.get('ppc-review-deferrals-v1')).items['message:notice-20'], JSON.stringify(['Synthetic notice 20', 'Source evidence for synthetic record 20', 1]));
assert.ok(!control(h, 'select', 'message:notice-20'));
await h.filter('Deferred'); assert.equal(h.list.scrollTop, 0); assert.ok(control(h, 'select', 'message:notice-20'));
await control(h, 'defer', 'message:notice-20').click(); assert.equal(h.list.children.length, 1); assert.match(text(h.list), /No matching items/);
await h.filter('Actions to resolve'); await control(h, 'defer', 'message:notice-20').click();
h.notifications[20].revision = 2; h.root.PortfolioWorkflowUI.refresh(); assert.ok(control(h, 'select', 'message:notice-20'), 'A changed source revision resurfaces a deferred item.');

const urgent = control(h, 'select', 'message:notice-0').parentElement; assert.equal(urgent.children.length, 1, 'Urgent notices have no defer control.');
await control(h, 'select', 'message:notice-0').click(); assert.ok(!control(h, 'defer-selected'));
const search = find(h.review, value => value.type === 'search'); search.value = 'Synthetic notice 24'; await search.emit('input'); assert.equal(h.list.children.length, 1); assert.equal(h.list.scrollTop, 0); assert.match(text(h.evidence), /Synthetic notice 24/);
search.value = 'no matching source'; await search.emit('input'); assert.match(text(h.evidence), /Nothing in this view/); assert.equal(shelf.querySelectorAll('button').length, 6);

await h.open(); await tool(h, 'PLC source review').click(); assert.equal(h.calls.plc, 1); assert.equal(h.review.open, false);
await h.open(); await tool(h, 'Planning candidates').click(); assert.equal(h.calls.planning, 1);
await h.open(); await tool(h, 'Portfolio plan diagnostics').click(); assert.deepEqual(h.calls.analytics, ['source']);
await h.open(); await tool(h, 'All messages').click(); assert.equal(h.calls.messages.length, 1);
await h.open(); await tool(h, 'Date evidence & protection').click(); assert.equal(h.doc.getElementById('workflowProtectionDialog').open, true);
h.doc.getElementById('workflowProtectionDialog').close();
await h.open(); await tool(h, 'Saved local copies').click(); assert.equal(h.doc.getElementById('workflowLocalRecoveryDialog').open, true); assert.equal(h.calls.recovery, 1);
h.doc.getElementById('workflowLocalRecoveryDialog').close(); await h.doc.getElementById('settingsLocalCopies').click(); assert.equal(h.calls.recovery, 2);
await h.open(); h.setFailure({ code: 'STORAGE_ERROR', message: 'Synthetic retained local save failed' }); h.root.PortfolioWorkflowUI.refresh();
assert.equal(h.doc.getElementById('workflowLocalSaveBlock').hidden, false); assert.match(text(h.doc.getElementById('workflowLocalSaveBlock')), /Synthetic retained local save failed/);
assert.equal(JSON.stringify(h.portfolio), baseline, 'Browsing, deferring and opening tools never changes portfolio facts or source evidence.');
assert.equal(h.calls.backend, 0); assert.equal(h.calls.writes, 0);

const denied = await fixture({ storageFails: true }); await denied.open(); await control(denied, 'defer', 'message:notice-3').click();
assert.ok(control(denied, 'select', 'message:notice-3'), 'Storage denial cannot make a review item disappear.');
assert.match(text(denied.doc.getElementById('workflowAnnouncement')), /could not save the review preference/);
const optional = await fixture({ notices: 0 }); optional.portfolio.categories[0].board.products.push({ ...clone(currentProduct), id: 'unknown-timing', name: 'Synthetic optional product', ffsDate: '', imageAssetId: '', plc: { reportDate: '2020-01-01' } }); await optional.open();
await optional.filter('Missing dates · optional'); assert.match(text(optional.evidence), /Unknown timing/); assert.match(text(optional.evidence), /A date is never inferred/);
await control(optional, 'open').click(); assert.deepEqual(optional.calls.product, ['unknown-timing']);
await optional.open(); await optional.filter('Source age · optional'); assert.match(text(optional.evidence), /2020-01-01/);
await optional.filter('Images · optional'); assert.match(text(optional.evidence), /No assigned main image/);
const unresolved = await fixture({ notices: 0 }); unresolved.portfolio.plcReview.entries[0].row.dates.ffsDate = { kind: 'range', value: '', raw: 'Q2 or Q3 2028?', reason: 'Two source quarters require inspection', source: { sheet: 'Synthetic source', cell: 'F4' } }; await unresolved.open();
assert.match(text(unresolved.evidence), /Q2 or Q3 2028\?/); assert.match(text(unresolved.evidence), /Unresolved source text/);
assert.equal(find(unresolved.evidence, value => value.className === 'workflow-review-time-rail'), undefined, 'An unresolved source cannot acquire a fabricated quarter position.');
unresolved.portfolio.plcReview.entries[0].matchNeeded = true; unresolved.root.PortfolioWorkflowUI.refresh(); assert.match(text(unresolved.evidence), /Product match required/);
assert.equal(find(unresolved.evidence, value => value.className === 'workflow-review-time-rail'), undefined, 'Unmatched source projects do not display another product’s accepted dates.');
const count = await fixture({ notices: 180 }); await count.open(); assert.equal(count.list.children.length, 151);
count.list.scrollTop = 900; await find(count.list, value => value.tagName === 'button' && value.textContent.startsWith('Show more')).click(); assert.equal(count.list.children.length, 181); assert.equal(count.list.scrollTop, 900, 'Show more retains message position.');
// Browser layout is verified separately. The queue must shrink before the body
// scrolls; short windows must still reach chrome that cannot fit above its minimum.
// Hidden outer overflow previously clipped Tools and Messages at 320 × 740.
assert.match(css, /#workflowReviewDialog \.workflow-body\s*\{[^}]*overflow:auto/);
assert.match(css, /#workflowReviewDialog \.workflow-review-messages\s*\{[^}]*flex:1 1 auto;[^}]*min-height:64px/);
assert.match(css, /#workflowReviewDialog \.workflow-review-list\s*\{[^}]*max-height:208px;[^}]*overflow-y:auto/);
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);

const evidence = { runtime: 'Full production workflow-ui controller with actual PLC review/quarter model', notices: 29, tools: 6, selectionScrollRetained: 621, paginationScrollRetained: 900, quarterEvidence: ['Q2 2028', 'Q3 2028'], exactDayEvidence: ['2028-08-18', '2028-09-19'], protections: ['urgent no-defer', 'fingerprint revision resurfaces', 'storage denial retains issue', 'local save failure remains visible', 'all six native workflow handoffs'], outboundCalls: 0, portfolioWrites: 0, layoutBoundary: 'Browser verification remains separate from DOM fixture' };
if (process.argv.includes('--evidence')) { const output = new URL('../../outputs/review-settings-production-20261017/', import.meta.url); await mkdir(output, { recursive: true }); await writeFile(new URL('review-controller-check.json', output), JSON.stringify(evidence, null, 2) + '\n'); }
console.log(JSON.stringify(evidence));
console.log('Review pane checks passed.');
