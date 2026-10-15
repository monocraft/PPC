import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [source, css, workspaceSource] = await Promise.all([
  readFile(new URL('../../public/blueprint/analysis-canvas.js', import.meta.url), 'utf8'),
  readFile(new URL('../../public/blueprint/analysis-canvas.css', import.meta.url), 'utf8'),
  readFile(new URL('../../public/blueprint/workspace-model.js', import.meta.url), 'utf8')
]);
const context = { window: {}, Intl, AbortController };
vm.runInNewContext(source, context);
const { prepare, create } = context.window.HX_ANALYSIS_CANVAS;
assert.equal(typeof prepare, 'function'); assert.equal(typeof create, 'function');
const periods = [2025, 2026, 2027];
const trace = (id, metric, values, extra = {}) => ({ id, name: id, metric, color: '#20CBDD', unit: metric === 'units' ? 'units' : 'currency', points: periods.map((period, index) => ({ period, value: values[index], kind: period === 2025 ? 'actual' : period === 2026 ? 'unclassified' : 'projection', source: [{ sheet: 'Synthetic source', cell: `${id}-${period}`, value: values[index] }], basis: 'Explicit synthetic source basis' })), ...extra });
const alpha = { entityId: 'Alpha', name: 'Alpha' };
const input = { periods, period: 2026, scale: 'trend', series: [trace('Alpha revenue', 'revenue', [100, 200, null], alpha), trace('Alpha gross profit', 'grossProfit', [20, -10, 30], alpha), trace('Alpha investment', 'budget', [50, 100, 25], alpha), trace('Alpha units', 'units', [10, 30, 40], alpha)] };
const before = JSON.stringify(input), indexed = prepare(input);
assert.equal(JSON.stringify(input), before, 'Preparing a chart never modifies source data');
assert.equal(indexed.indexed, true); assert.equal(indexed.basePeriod, 2025);
assert.equal(indexed.axes.length, 1); assert.equal(indexed.axes[0].id, 'index');
for (const series of indexed.series) assert.equal(series.points[0].value, 100, 'Every metric uses the same baseline year');
assert.equal(indexed.series[1].points[1].value, -50, 'Signed gross profit remains signed in Trend');
assert.equal(indexed.series[0].points[2].value, null, 'Missing source values remain gaps');
assert.equal(indexed.series[0].points[1].rawValue, 200, 'Readout values stay raw rather than displaying an index as money');
assert.equal(indexed.series[0].points[1].source[0].cell, 'Alpha revenue-2026');
assert.equal(indexed.series[0].points[1].status, 'Unclassified', 'A future source row is not automatically called a plan');
assert.equal(indexed.series[0].points[2].status, 'Plan');
assert.equal(new Set(indexed.series.map(series => series.style.marker)).size, 4, 'Metrics have four distinguishable marker shapes');
assert.equal(new Set(indexed.series.map(series => series.style.dash)).size, 4, 'Metric patterns are independent of entity color');
assert.ok(indexed.series.every(series => series.color === '#20CBDD'));

const values = prepare({ ...input, scale: 'values' });
const defaultValues = prepare({ ...input, scale: undefined });
assert.equal(defaultValues.scale, 'values'); assert.equal(defaultValues.indexed, false); assert.equal(defaultValues.basePeriod, null, 'An analysis without a saved scale opens in raw Values rather than an implicit index');
assert.deepEqual(Array.from(defaultValues.axes, axis => axis.id), ['currency', 'units'], 'Default mixed-measure analysis keeps currency and quantity on separate axes');
for (let index = 0; index < input.series.length; index++) {
  assert.deepEqual(Array.from(defaultValues.series[index].points, point => point.value), Array.from(input.series[index].points, point => point.value), 'Default Values keeps signed, zero and missing source observations unchanged');
}
assert.deepEqual(Array.from(defaultValues.series, series => series.points[1].value), [200, -10, 100, 30], 'Default revenue, gross profit, investment and units remain exact source numbers');
assert.equal(prepare({ ...input, scale: 'invalid' }).scale, 'values', 'An unsupported scale preference falls back to Values');
assert.equal(values.axes.length, 2, 'Currency metrics share one axis and units use one other axis');
assert.equal(values.axes.find(axis => axis.id === 'currency').side, 'left');
assert.equal(values.axes.find(axis => axis.id === 'units').side, 'right');
assert.equal(new Set(values.series.filter(series => series.unit === 'currency').map(series => series.axis)).size, 1);
assert.ok(values.axes.find(axis => axis.id === 'currency').min <= -10);
assert.equal(values.series[1].points[1].value, -10);

const fallback = prepare({ periods, scale: 'trend', series: [trace('A', 'revenue', [100, null, null]), trace('B', 'units', [null, 4, 5])] });
assert.equal(fallback.indexed, false); assert.equal(fallback.scale, 'values'); assert.equal(fallback.basePeriod, null);
assert.match(fallback.reason, /No common fiscal year/); assert.equal(fallback.axes.length, 2);
assert.deepEqual(Array.from(fallback.series[0].points, point => point.rawValue), [100, null, null]);
const laterBase = prepare({ periods, scale: 'trend', series: [trace('A', 'revenue', [0, 10, 20]), trace('B', 'units', [0, 2, 6])] });
assert.equal(laterBase.basePeriod, 2026); assert.equal(laterBase.series[0].points[0].value, 0, 'Genuine zero is retained before the baseline');
assert.equal(laterBase.series[1].points[2].value, 300);
const allZero = prepare({ periods, scale: 'trend', series: [trace('A', 'revenue', [0, 0, 0])] });
assert.equal(allZero.scale, 'values'); assert.deepEqual(Array.from(allZero.series[0].points, point => point.value), [0, 0, 0]);
const raw = prepare({ periods, scale: 'trend', series: [trace('A', 'revenue', [100, 200, 300], { points: [{ period: 2025, value: 100, rawValue: 20 }, { period: 2026, value: 200, rawValue: 30 }] })] });
assert.equal(raw.series[0].points[1].rawValue, 30); assert.equal(raw.series[0].points[1].value, 150, 'Previously indexed adapter values are never normalized twice');
const duplicate = prepare({ periods, series: [trace('A', 'revenue', [], { points: [{ period: 2025, value: 2 }, { period: 2025, value: 3 }, { period: 2026, value: 4 }] })] });
assert.equal(duplicate.series[0].points[0].value, null); assert.match(duplicate.warnings.join(' '), /repeated periods/);
const incompatible = prepare({ periods, series: [trace('A', 'revenue', [null, 1, null]), trace('B', 'units', [1, null, null]), trace('C', 'ratio', [null, null, 1], { unit: '%' })] });
assert.equal(incompatible.supported, false); assert.equal(incompatible.axes.length, 0); assert.match(incompatible.reason, /cannot share a Values axis/);
const scenario = prepare({ periods, scale: 'trend', series: [trace('Scenario', 'revenue', [100, 120, 130], { scenario: true })] });
assert.equal(scenario.series[0].points[2].status, 'Scenario');
assert.equal(scenario.indexed, false, 'A scenario without its source trace never chooses its own normalization baseline');
assert.match(scenario.reason, /matching source baseline/);

// Use the actual workspace sensitivity adapter so the chart cannot erase a
// multiplier by independently indexing the scenario against its adjusted value.
vm.runInNewContext(workspaceSource, context);
const scenarioSources = [trace('Source revenue', 'revenue', [100, 200, 300], { entityId: 'entity-1' }), trace('Source GP', 'grossProfit', [20, 50, 100], { entityId: 'entity-1' }), trace('Source units', 'units', [10, 20, 30], { entityId: 'entity-1' })];
const scenarioModel = { periods, series: scenarioSources, allSeries: scenarioSources };
const scenarioAssumptions = { period: 2026, scenarioStart: 2026, revenueGrowth: 10, marginChange: 2, budgetChange: 0 };
const modeled = context.window.HX_WORKSPACE_MODEL.scenarioSeries(scenarioModel, scenarioAssumptions);
const sourceBefore = JSON.stringify(scenarioSources), modeledBefore = JSON.stringify(modeled);
const scenarioTrend = prepare({ periods, scale: 'trend', series: [...scenarioSources, ...modeled] });
assert.equal(scenarioTrend.basePeriod, 2025, 'Scenario gaps in verified history cannot move the source baseline to a future year');
const indexedRevenue = scenarioTrend.series.find(item => item.id === 'Source revenue');
const indexedScenario = scenarioTrend.series.find(item => item.id === 'Source revenue:scenario');
assert.equal(indexedRevenue.baseValue, 100);
assert.equal(indexedScenario.baseValue, 100, 'The scenario inherits the matching source baseline, not its first modeled result');
assert.equal(indexedScenario.points[0].value, null, 'Protected historical scenario points stay absent');
assert.ok(Math.abs(indexedRevenue.points[1].value - 200) < 1e-10);
assert.ok(Math.abs(indexedScenario.points[1].value - 220) < 1e-10, 'A ten percent scenario uplift remains visible on the indexed graph');
assert.ok(Math.abs(indexedScenario.points[1].rawValue - 220) < 1e-10, 'Scenario inspection retains modeled currency rather than the index');
const indexedGP = scenarioTrend.series.find(item => item.id === 'Source GP:scenario');
assert.equal(indexedGP.baseValue, 20, 'Each scenario measure inherits its own matching source measure baseline');
assert.ok(Math.abs(indexedGP.points[1].value - 297) < 1e-10, 'Revenue and margin changes use the same source GP base');
assert.equal(JSON.stringify(scenarioSources), sourceBefore); assert.equal(JSON.stringify(modeled), modeledBefore);
const signedScenario = prepare({ periods, scale: 'trend', series: [scenarioSources[0], trace('Signed scenario', 'revenue', [null, 0, -20], { entityId: 'entity-1', scenario: true })] });
assert.equal(signedScenario.indexed, true); assert.equal(signedScenario.series[1].points[1].value, 0); assert.equal(signedScenario.series[1].points[2].value, -20, 'Zero and negative outcomes can be compared to the positive source base');
const unpairedScenario = prepare({ periods, scale: 'trend', series: [scenarioSources[0], trace('Wrong scope', 'revenue', [null, 220, 330], { entityId: 'different-entity', scenario: true })] });
assert.equal(unpairedScenario.indexed, false); assert.match(unpairedScenario.reason, /matching source baseline/); assert.equal(unpairedScenario.series[1].points[1].value, 220);
const ambiguousScenario = prepare({ periods, scale: 'trend', series: [scenarioSources[0], { ...scenarioSources[0], id: 'Duplicate source population' }, ...modeled.filter(item => item.metric === 'revenue')] });
assert.equal(ambiguousScenario.indexed, false, 'Ambiguous source populations are never assigned arbitrarily to a scenario');
const noPositiveSource = prepare({ periods, scale: 'trend', series: [trace('No positive source', 'revenue', [0, -20, -30], { entityId: 'entity-1' }), trace('Positive scenario', 'revenue', [1, 2, 3], { entityId: 'entity-1', scenario: true })] });
assert.equal(noPositiveSource.indexed, false, 'A positive scenario cannot supply a missing positive source baseline'); assert.equal(noPositiveSource.series[1].points[0].value, 1);
const launchPlan = trace('Launch-year annual plan', 'revenue', [null, 180, null], { entityId: 'entity-1:launch-plan', reportedEntityId: 'entity-1', estimate: true });
const planComparison = prepare({ periods, scale: 'trend', series: [scenarioSources[0], launchPlan] });
assert.equal(planComparison.indexed, true); assert.equal(planComparison.basePeriod, 2025, 'A one-year plan cannot move the reported-source baseline to its launch year');
assert.equal(planComparison.series[1].baseValue, 100); assert.equal(planComparison.series[1].points[1].value, 180, 'A plan keeps its gap to reported revenue on the same source index');
assert.equal(planComparison.series[0].points[1].value, 200); assert.equal(planComparison.series[1].points[0].value, null); assert.equal(planComparison.series[1].points[2].value, null);
const planOnly = prepare({ periods, scale: 'trend', series: [launchPlan] });
assert.equal(planOnly.indexed, false); assert.equal(planOnly.series[0].points[1].value, 180, 'A plan-only project retains its exact annual source value without self-indexing'); assert.match(planOnly.reason, /matching source baseline/);
const missingReportedPlan = prepare({ periods, scale: 'trend', series: [scenarioSources[0], { ...launchPlan, reportedEntityId: 'other-project' }] });
assert.equal(missingReportedPlan.indexed, false, 'A plan never borrows another project source denominator');
const nonPositiveReportedPlan = prepare({ periods, scale: 'trend', series: [trace('Reported losses', 'revenue', [0, -20, -30], { entityId: 'entity-1' }), launchPlan] });
assert.equal(nonPositiveReportedPlan.indexed, false, 'A positive annual plan does not manufacture a positive reported baseline'); assert.equal(nonPositiveReportedPlan.series[1].points[1].value, 180);

// SKU investment is unavailable rather than zero. Its empty source/scenario
// traces stay inspectable without forcing comparable reported measures to Values.
const skuSources = [...scenarioSources, trace('SKU investment', 'budget', [null, null, null], { entityId: 'entity-1' })];
const skuModel = { periods, series: skuSources, allSeries: skuSources };
const skuSensitivity = context.window.HX_WORKSPACE_MODEL.scenarioSeries(skuModel, scenarioAssumptions);
const skuTrend = prepare({ periods, scale: 'trend', series: [...skuSources, ...skuSensitivity] });
assert.equal(skuTrend.indexed, true); assert.equal(skuTrend.basePeriod, 2025, 'An entirely unavailable SKU measure cannot constrain the common source base');
assert.equal(skuTrend.series.length, 7, 'Unavailable source and scenario investment traces remain in the model and legend');
assert.match(skuTrend.warnings.join(' '), /entirely unavailable source series remains.*Unavailable.*PD investment.*Missing values are not zero/);
for (const emptyBudget of skuTrend.series.filter(item => item.metric === 'budget')) {
  assert.equal(emptyBudget.baseValue, null);
  assert.deepEqual(Array.from(emptyBudget.points, point => point.value), [null, null, null]);
  assert.deepEqual(Array.from(emptyBudget.points, point => point.rawValue), [null, null, null]);
}
assert.ok(Math.abs(skuTrend.series.find(item => item.id === 'Source revenue:scenario').points[1].value - 220) < 1e-10);
for (const values of [[null, 0, null], [null, -10, null]]) {
  const observedInvestment = prepare({ periods, scale: 'trend', series: [...scenarioSources, trace('Observed investment', 'budget', values, { entityId: 'entity-1' })] });
  assert.equal(observedInvestment.indexed, false, 'Any reported zero or negative observation still constrains the common baseline');
  assert.match(observedInvestment.reason, /No common fiscal year/);
}
const sharedLaterInvestment = prepare({ periods, scale: 'trend', series: [...scenarioSources, trace('Later positive investment', 'budget', [null, 0, 50], { entityId: 'entity-1' })] });
assert.equal(sharedLaterInvestment.basePeriod, 2027); assert.ok(sharedLaterInvestment.series.every(item => item.points[2].value === 100), 'An observed investment chooses the same later positive year for every measure');
const unavailablePlanDenominator = prepare({ periods, scale: 'trend', series: [scenarioSources[0], trace('Unavailable GP', 'grossProfit', [null, null, null], { entityId: 'entity-1' }), trace('Annual GP plan', 'grossProfit', [null, 180, null], { entityId: 'entity-1:launch-plan', reportedEntityId: 'entity-1', estimate: true })] });
assert.equal(unavailablePlanDenominator.indexed, false, 'A numeric annual plan cannot index against an unavailable source measure even when another measure has a base');
assert.match(unavailablePlanDenominator.reason, /positive matching source baseline/);
assert.equal(unavailablePlanDenominator.series[2].points[1].value, 180);
assert.equal(prepare().series.length, 0); assert.equal(prepare().period, null);
assert.equal(prepare({ periods, series: Array.from({ length: 200 }, (_, index) => trace(`Entity ${index}`, 'revenue', [1, 2, 3])) }).series.length, 200, 'Many selected traces are retained rather than silently truncated');
const expandedPeriods = prepare({ periods: [2026, 2025], series: [trace('A', 'revenue', [], { points: [{ period: 2024, value: 1 }, { period: 2027, value: 2 }] })] });
assert.deepEqual(Array.from(expandedPeriods.periods), [2024, 2025, 2026, 2027], 'Source-only investment or annual-plan years remain chronological');

// A small DOM fixture exercises the actual component's event/lifecycle code.
// It does not substitute screenshots for the root task's browser review.
class Element {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.attrs = {}; this.events = new Map(); this.style = { setProperty(name, value) { this[name] = String(value); } }; this.className = ''; this.textContent = ''; this.clientWidth = 980; this.classList = { toggle: (name, force) => { const names = new Set(this.className.split(/\s+/)); if (force) names.add(name); else names.delete(name); this.className = [...names].join(' '); } }; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { this.children.forEach(child => child.parent = null); this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attrs[name] = String(value); if (name === 'class') this.className = String(value); }
  getAttribute(name) { return this.attrs[name]; }
  addEventListener(type, callback, options = {}) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(callback); options.signal?.addEventListener('abort', () => this.events.get(type)?.delete(callback), { once: true }); }
  dispatch(type, extra = {}) { for (const callback of [...(this.events.get(type) || [])]) callback({ target: this, type, ...extra }); }
  querySelectorAll(selector) { const result = []; const visit = child => { if (selector === 'button' && child.tagName === 'button' || selector.startsWith('.') && child.className.split(/\s+/).includes(selector.slice(1))) result.push(child); child.children.forEach(visit); }; this.children.forEach(visit); return result; }
  closest(selector) { if (selector === '[data-point-key]' && this.attrs['data-point-key']) return this; return this.parent?.closest(selector); }
  getBoundingClientRect() { return { left: 0, top: this.rectTop || 0, width: this.clientWidth }; }
  setPointerCapture(id) { (this.captures ||= new Set()).add(id); this.capture = id; }
  hasPointerCapture(id) { return Boolean(this.captures?.has(id)); }
  releasePointerCapture(id = this.capture) { this.captures?.delete(id); this.capture = [...(this.captures || [])].at(-1) ?? null; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
}
const doc = { createElement: tag => new Element(tag, doc), createElementNS: (_ns, tag) => new Element(tag, doc) };
const view = new Element('window', doc); doc.defaultView = view;
let disconnected = false;
view.ResizeObserver = class { observe() {} disconnect() { disconnected = true; } };
const container = new Element('div', doc), externalViewControls = new Element('div', doc), selected = [], inspected = [], layouts = [];
const chart = create(container, { onPeriod: period => selected.push(period), onPoint: point => inspected.push(point), onLayout: layout => layouts.push(layout), viewControlsContainer: externalViewControls });
chart.update(input);
const root = container.children[0], range = root.querySelectorAll('.hac-year-range')[0], stage = root.querySelectorAll('.hac-stage')[0];
assert.equal(externalViewControls.querySelectorAll('.hac-view-controls').length, 1, 'Time-view controls mount in the shared external tool strip');
assert.equal(root.querySelectorAll('.hac-view-controls').length, 0, 'An external control mount does not also duplicate the controls inside the chart');
for (const className of ['hac-year-indicator', 'hac-hover-year-indicator']) {
  const indicators = root.querySelectorAll('.' + className);
  assert.equal(indicators.length, 1, 'Each selected or inspected year has one explicit underline indicator');
  assert.equal(indicators[0].getAttribute('aria-hidden'), 'true', 'Decorative underlines do not duplicate accessible year announcements');
}
assert.ok(root.children.indexOf(root.querySelectorAll('.hac-year-rail')[0]) > root.children.indexOf(stage), 'Fiscal-year controls appear below the SVG plot');
assert.ok(root.children.indexOf(root.querySelectorAll('.hac-readout')[0]) < root.children.indexOf(stage), 'Every financial value is in the top readout');
assert.equal(root.querySelectorAll('.hac-entity-group').length, 1, 'An entity has one readout group, rather than one header per measure');
assert.equal(root.querySelectorAll('.hac-entity-name')[0].textContent, 'Alpha'); assert.equal(root.querySelectorAll('.hac-metric-cell').length, 4);
assert.equal(layouts.at(-1).plotHeight, 410); assert.equal(layouts.at(-1).plotTop, 0);
stage.rectTop = 170; container.rectTop = 25; chart.update(input); assert.equal(layouts.at(-1).plotTop, 145, 'Layout reports plot top relative to the chart container, not the page');
assert.equal(range.type, 'range'); assert.equal(range.max, '2'); assert.equal(range.getAttribute('aria-valuetext'), 'FY26');
const yearButtons = root.querySelectorAll('.hac-year-buttons')[0].querySelectorAll('button');
assert.deepEqual(yearButtons.map(button => button.getAttribute('aria-label')), ['FY25', 'FY26', 'FY27'], 'Every split fiscal-year label retains its full accessible identity');
assert.deepEqual(yearButtons.map(button => button.querySelectorAll('.hac-year-prefix')[0]?.textContent), ['FY', 'FY', 'FY']);
assert.deepEqual(yearButtons.map(button => button.querySelectorAll('.hac-year-number')[0]?.textContent), ['25', '26', '27']);
assert.equal(root.querySelectorAll('.hac-readout-head')[0].children[0].textContent, 'Selected FY26');
assert.equal(root.querySelectorAll('.hac-scale-label')[0].textContent, 'Trend index · FY25 = 100', 'The precise scale remains available when visible readout hints are removed');
assert.equal(root.querySelectorAll('.hac-readout-head')[0].children.length, 3, 'The readout heading contains the year, optional source-comparison context and accessible diagnostics');
assert.equal(root.querySelectorAll('.hac-comparison-context')[0].hidden, true, 'A normal single-entity chart does not show an invented comparison baseline');
assert.ok(root.querySelectorAll('.hac-notice')[0].className.split(/\s+/).includes('hac-sr-only')); assert.match(stage.getAttribute('aria-description'), /Trend index · FY25 = 100/); assert.match(root.getAttribute('aria-label'), /Trend index · FY25 = 100/, 'The simplified heading does not hide the chart’s normalization basis from assistive technology');
const svgDescendants = node => node.children.flatMap(child => [child, ...svgDescendants(child)]);
assert.ok(!stage.title); assert.equal(svgDescendants(stage).filter(node => node.tagName === 'title').length, 0, 'The chart has no native stage or SVG hover-popup titles');
assert.equal(root.querySelectorAll('.hac-year-buttons')[0].querySelectorAll('button').filter(button => button.getAttribute('aria-pressed') === 'true').length, 1, 'Exactly one accessible year button remains selected');
range.value = '0'; range.dispatch('input'); assert.equal(selected.at(-1), 2025);
assert.equal(range.getAttribute('aria-valuetext'), 'FY25');
const selectedBeforeClick = selected.length;
root.querySelectorAll('.hac-legend-row')[0].dispatch('click');
assert.equal(inspected.length, 0, 'Normal value selection never invokes source evidence or a popup callback');
assert.equal(selected.length, selectedBeforeClick + 1, 'Selecting a value announces its year even if that year was already selected');
assert.equal(root.querySelectorAll('.hac-legend-row')[0].getAttribute('aria-pressed'), 'true');
assert.equal(stage.querySelectorAll('.hac-selected-point').length, 4, 'The selected fiscal year is marked without overlaying repeated values on the plot');
assert.equal(stage.querySelectorAll('.hac-point-label-text').length, 0); assert.equal(stage.querySelectorAll('.hac-point-leader').length, 0);
const hasClass = (element, className) => element.className.split(/\s+/).includes(className);
const primaryValues = () => stage.querySelectorAll('.hac-point-value').filter(element => hasClass(element, 'is-primary'));
const secondaryValues = () => stage.querySelectorAll('.hac-point-value').filter(element => hasClass(element, 'is-secondary'));
const primaryRings = () => stage.querySelectorAll('.hac-selected-point').filter(element => hasClass(element, 'is-primary'));
const assertLabelGeometry = () => {
  const band = stage.querySelectorAll('.hac-year-band')[0], top = Number(band.getAttribute('y')), bottom = top + Number(band.getAttribute('height'));
  const groups = stage.querySelectorAll('.hac-point-value');
  for (const group of groups) assert.ok(Number(group.getAttribute('data-label-top')) >= top && Number(group.getAttribute('data-label-bottom')) <= bottom, 'Every visible source-value label fits within the financial plot');
  for (const side of ['left', 'right']) {
    const boxes = groups.filter(group => group.getAttribute('data-label-side') === side).map(group => ({ top: Number(group.getAttribute('data-label-top')), bottom: Number(group.getAttribute('data-label-bottom')) })).sort((a, b) => a.top - b.top);
    for (let index = 1; index < boxes.length; index++) assert.ok(boxes[index].top >= boxes[index - 1].bottom, 'Labels on the same side of the year guide never overlap');
  }
};
assert.equal(primaryValues().length, 1, 'The clicked value has one primary annotation');
assert.equal(primaryValues()[0].querySelectorAll('.hac-point-value-amount')[0].textContent, '$100.00');
assert.match(primaryValues()[0].getAttribute('data-financial-description'), /Alpha.*Revenue.*FY25.*\$100\.00.*Actual/, 'The selected annotation retains its financial identity without a native hover tooltip');
assert.ok(secondaryValues().length > 0, 'Other selected-year values can remain visible with a quieter secondary treatment');
assert.equal(primaryRings().length, 1); assertLabelGeometry();
assert.equal(stage.querySelectorAll('.hac-year-band').length, 1); assert.equal(stage.querySelectorAll('.hac-year-band')[0].getAttribute('opacity'), '.035', 'Selection adds one faint year band, not a cumulative range');
assert.equal(stage.querySelectorAll('.hac-year-band')[0].getAttribute('width'), '220', 'The first-year highlight covers only its half-interval');
assert.equal(stage.querySelectorAll('.hac-trace').filter(group => !hasClass(group, 'is-muted')).length, 1, 'Point focus dims every other curve, including other measures from the same entity');
assert.ok(hasClass(root, 'has-point-focus'));
for (const event of ['pointerenter', 'focus']) {
  root.querySelectorAll('.hac-legend-row')[1].dispatch(event);
  const selectedTrace = stage.querySelectorAll('.hac-trace').find(group => group.getAttribute('data-trace-key') === 'Alpha revenue::0');
  assert.ok(hasClass(selectedTrace, 'is-selected') && !hasClass(selectedTrace, 'is-muted') && !hasClass(selectedTrace, 'is-temporarily-muted'), 'The exact selected trace stays primary when another metric is hovered or receives keyboard focus');
  assert.equal(stage.querySelectorAll('.hac-trace').filter(group => !hasClass(group, 'is-muted')).length, 1);
}
root.querySelectorAll('.hac-legend-row')[1].dispatch('pointerleave'); root.querySelectorAll('.hac-legend-row')[1].dispatch('blur');
root.querySelectorAll('.hac-legend-row')[0].dispatch('click');
assert.equal(inspected.length, 0); assert.equal(selected.length, selectedBeforeClick + 2, 'Toggling focus still notifies the selected fiscal year');
assert.equal(root.querySelectorAll('.hac-legend-row')[0].getAttribute('aria-pressed'), 'false');
assert.ok(stage.querySelectorAll('.hac-trace').every(group => !group.className.split(/\s+/).includes('is-muted')), 'Repeating the same series/year value selection restores every line');
assert.ok(stage.querySelectorAll('.hac-selected-point').length > 0, 'Clearing focus keeps selected-year rings visible');
assert.equal(primaryValues().length, 0); assert.equal(primaryRings().length, 0, 'Repeating the same selection clears its primary ring and annotation');
root.querySelectorAll('.hac-entity-evidence')[0].dispatch('click');
assert.equal(inspected.at(-1).value, 100); assert.equal(inspected.at(-1).source[0].cell, 'Alpha revenue-2025'); assert.equal(inspected.at(-1).kind, 'actual');
root.querySelectorAll('.hac-entity-evidence')[0].dispatch('click');
assert.equal(inspected.length, 2); assert.equal(root.querySelectorAll('.hac-legend-row')[0].getAttribute('aria-pressed'), 'true', 'Repeated Evidence selects force focus on rather than toggling it off');
stage.dispatch('pointermove', { clientX: 880, pointerId: 1 }); root.querySelectorAll('.hac-legend-row')[1].dispatch('click');
assert.equal(inspected.length, 2); assert.equal(selected.at(-1), 2027, 'A value selected during inspection becomes the selected fiscal year');
root.querySelectorAll('.hac-entity-evidence')[0].dispatch('click');
assert.equal(inspected.at(-1).period, 2027); assert.equal(inspected.at(-1).value, 30, 'Hover inspects raw value for every metric at the crosshair year');
const dot = stage.querySelectorAll('.hac-point').find(point => point.getAttribute('data-point-key') === 'Alpha gross profit::1|1');
const beforeDotEvidence = inspected.length;
stage.dispatch('pointerdown', { target: dot, clientX: 500, pointerId: 41, button: 0 }); stage.dispatch('pointerup', { target: dot, pointerId: 41 });
assert.equal(inspected.length, beforeDotEvidence, 'Clicking a plotted point selects it without invoking Evidence');
assert.equal(selected.at(-1), 2026); assert.equal(range.getAttribute('aria-valuetext'), 'FY26');
assert.equal(root.querySelectorAll('.hac-legend-row')[1].querySelectorAll('.hac-legend-value')[0].textContent, '-$10.00', 'The grouped readout shows source dollars rather than the index');
assert.equal(stage.querySelectorAll('.hac-point-leader').length, 0, 'No leader-line web is drawn for selected metrics');
assert.equal(primaryValues().length, 1); assert.equal(primaryValues()[0].querySelectorAll('.hac-point-value-amount')[0].textContent, '-$10.00', 'The primary annotation shows raw money, not the index');
assert.equal(primaryRings()[0].getAttribute('data-series-id'), 'Alpha gross profit'); assertLabelGeometry();
for (const group of stage.querySelectorAll('.hac-trace')) assert.equal(hasClass(group, 'is-muted'), group.getAttribute('data-trace-key') !== 'Alpha gross profit::1', 'The exact plotted metric controls focus rather than its whole product entity');
assert.equal(root.querySelectorAll('.hac-legend-row')[1].getAttribute('aria-pressed'), 'true', 'Selecting the same series in a different year focuses that new point');
const dotSelectionCount = selected.length;
stage.dispatch('pointerdown', { target: dot, clientX: 500, pointerId: 42, button: 0 }); stage.dispatch('pointerup', { target: dot, pointerId: 42 });
assert.equal(inspected.length, beforeDotEvidence); assert.equal(selected.length, dotSelectionCount + 1);
assert.ok(stage.querySelectorAll('.hac-trace').every(group => !group.className.split(/\s+/).includes('is-muted')), 'Repeating the same plotted point restores every line without an Evidence callback');
assert.ok(stage.querySelectorAll('.hac-selected-point').length > 0);
assert.equal(primaryValues().length, 0); assert.equal(primaryRings().length, 0, 'Toggling a plotted point off clears its primary annotation as well as curve focus');
const yearBeforePan = selected.at(-1), selectionsBeforePan = selected.length;
stage.dispatch('pointerdown', { clientX: 76, pointerId: 1, button: 0 });
stage.dispatch('pointermove', { clientX: 880, pointerId: 1 }); stage.dispatch('pointerup', { pointerId: 1 });
assert.equal(selected.at(-1), yearBeforePan); assert.equal(selected.length, selectionsBeforePan, 'Dragging the graph pans time without selecting a different fiscal year');
root.querySelectorAll('.hac-legend-row')[1].dispatch('click'); range.value = '2'; range.dispatch('input');
assert.equal(selected.at(-1), 2027, 'The bottom year rail retains fiscal-year selection after graph dragging becomes pan');
assert.equal(primaryValues().length, 0, 'Moving to another year clears the previous clicked-point annotation');
assert.ok(stage.querySelectorAll('.hac-point-value').every(group => hasClass(group, 'is-secondary')), 'Remaining annotations refer only to the new selected-year source values'); assertLabelGeometry();
assert.ok(stage.querySelectorAll('.hac-trace').length === 4);
const path = stage.querySelectorAll('.hac-trace')[0].children[0].getAttribute('d'); assert.equal((path.match(/L/g) || []).length, 1, 'A missing last point is not filled or extended');
const noisyCurrency = 1577342.6094000002, noisyUnits = 1234.567891;
chart.update({ periods: [2026], period: 2026, series: [trace('Currency precision', 'revenue', [], { points: [{ period: 2026, value: noisyCurrency }] }), trace('Units precision', 'units', [], { points: [{ period: 2026, value: noisyUnits }] })] });
assert.equal(root.querySelectorAll('.hac-legend-value')[0].textContent, '$1,577,342.61', 'Visible financial values use currency precision rather than floating-point noise');
assert.equal(root.querySelectorAll('.hac-legend-value')[1].textContent, '1,234.57 units', 'Units use at most two visible decimals');
root.querySelectorAll('.hac-entity-evidence')[0].dispatch('click'); assert.equal(inspected.at(-1).rawValue, noisyCurrency, 'Formatting never rounds the source-evidence payload');
root.querySelectorAll('.hac-entity-evidence')[1].dispatch('click'); assert.equal(inspected.at(-1).rawValue, noisyUnits);
chart.update({ ...input, scale: 'values' });
const valueAxisTitles = stage.querySelectorAll('.hac-axis-title'), valueAxisTicks = stage.querySelectorAll('.hac-axis-label');
assert.deepEqual(valueAxisTitles.map(title => title.textContent), ['USD', 'Units'], 'Values mode keeps the currency and quantity axes distinct');
assert.equal(new Set(valueAxisTitles.map(title => title.getAttribute('y'))).size, 1, 'Currency and units headings share one visual baseline');
for (const title of valueAxisTitles) {
  const anchor = title.textContent === 'USD' ? 'end' : 'start'; assert.equal(title.getAttribute('text-anchor'), anchor);
  const ownTicks = valueAxisTicks.filter(tick => tick.getAttribute('text-anchor') === anchor); assert.ok(ownTicks.length > 0);
  assert.ok(ownTicks.every(tick => tick.getAttribute('x') === title.getAttribute('x')), 'Each unit heading aligns exactly with its own numerical tick column');
}
chart.update({ periods, period: 2026, series: [...skuSources, ...skuSensitivity] });
assert.match(root.querySelectorAll('.hac-notice')[0].getAttribute('aria-label'), /Unavailable.*PD investment.*Missing values are not zero/, 'Missing source limitations remain accessible after visible compact notes are removed');
assert.match(stage.getAttribute('aria-description'), /Unavailable.*PD investment.*Missing values are not zero/, 'The full source limitation remains available without an inherited hover tooltip');
const investmentLegend = root.querySelectorAll('.hac-legend-row').find(row => row.getAttribute('data-series-id') === 'SKU investment');
assert.ok(investmentLegend, 'The entirely unavailable investment legend is retained');
assert.equal(investmentLegend.querySelectorAll('.hac-legend-value')[0].textContent, 'Unavailable');
const beforeUnavailableSelection = inspected.length; investmentLegend.dispatch('click'); assert.equal(inspected.length, beforeUnavailableSelection);
root.querySelectorAll('.hac-entity-evidence')[0].dispatch('click'); assert.equal(inspected.at(-1).rawValue, null, 'Unavailable investment evidence retains missing source data, never a zero');
const removedRow = root.querySelectorAll('.hac-legend-row')[0];
const removedEvidence = root.querySelectorAll('.hac-entity-evidence')[0];
chart.update({ periods, series: [trace('Gap', 'revenue', [100, null, 200])] });
assert.equal(removedRow.events.get('click').size, 0, 'Updating removes callbacks attached to replaced legend nodes');
assert.equal(removedEvidence.events.get('click').size, 0, 'Updating removes callbacks attached to replaced evidence buttons');
const gapPath = stage.querySelectorAll('.hac-trace')[0].children[0].getAttribute('d'); assert.equal((gapPath.match(/M/g) || []).length, 2); assert.equal((gapPath.match(/L/g) || []).length, 0, 'Internal missing years break the path rather than drawing a fabricated bridge');
const metricKeys = ['revenue', 'units', 'grossProfit', 'budget'], metricColors = ['#895EF6', '#20CBDD', '#7AE3A9', '#FFC63B'];
const cohortTraces = ['connection-wired', 'connection-wireless'].flatMap((entityId, index) => metricKeys.map((metric, metricIndex) => trace(`${entityId}:${metric}`, metric, [100, 200 + index, 300], { entityId, name: index ? 'Wireless' : 'Wired', color: metricColors[metricIndex] })));
chart.update({ periods, period: 2026, series: cohortTraces });
assert.deepEqual(root.querySelectorAll('.hac-entity-name').map(name => name.textContent), ['Wired', 'Wireless']);
assert.equal(root.querySelectorAll('.hac-entity-group').length, 2, 'Two connectivity groups produce two headers, not eight metric cards');
assert.equal(root.querySelectorAll('.hac-metric-cell').length, 8); assert.equal(root.querySelectorAll('.hac-legend-value').length, 8);
assert.equal(root.querySelectorAll('.hac-entity-evidence').length, 2, 'Evidence is one explicit text action per entity'); assert.equal(root.querySelectorAll('.hac-swatch').length, 0, 'Tiny per-value symbols do not clutter the grouped readout');
assert.ok(root.querySelectorAll('.hac-entity-group').every(group => group.style['--hac-entity-color'] === '#969eac'), 'Multi-color entities use neutral group selection');
root.querySelectorAll('.hac-legend-row')[0].dispatch('click');
assert.equal(root.querySelectorAll('.hac-entity-header')[0].getAttribute('aria-pressed'), 'true');
for (const group of stage.querySelectorAll('.hac-trace')) assert.equal(hasClass(group, 'is-muted'), group.getAttribute('data-trace-key') !== 'connection-wired:revenue::0', 'Point selection focuses only its exact metric while other wired and wireless curves remain dimmed');
root.querySelectorAll('.hac-entity-header')[0].dispatch('click'); assert.ok(stage.querySelectorAll('.hac-trace').every(group => !group.className.split(/\s+/).includes('is-muted')), 'Entity header toggles focus off');
root.querySelectorAll('.hac-entity-header')[0].dispatch('click');
root.querySelectorAll('.hac-legend-row')[1].dispatch('pointerenter'); assert.equal(stage.querySelectorAll('.hac-trace').filter(group => !group.className.split(/\s+/).includes('is-muted')).length, 1, 'Exact measure hover may temporarily focus that trace');
root.querySelectorAll('.hac-legend-row')[1].dispatch('pointerleave'); assert.equal(stage.querySelectorAll('.hac-trace').filter(group => !group.className.split(/\s+/).includes('is-muted')).length, 4);
const projectTraces = ['PROJECT-A', 'PROJECT-B'].flatMap(entityId => metricKeys.map(metric => trace(`${entityId}:${metric}`, metric, [10, 20, 30], { entityId, name: 'Same product family' })));
chart.update({ periods, period: 2026, series: projectTraces });
assert.equal(root.querySelectorAll('.hac-entity-group').length, 2, 'Identically named selected projects remain distinct exact source entities');
assert.deepEqual(root.querySelectorAll('.hac-entity-id').map(name => name.textContent), ['PROJECT-A', 'PROJECT-B']);
chart.update({ periods, period: 2026, series: [scenarioSources[0], launchPlan, ...modeled.filter(item => item.metric === 'revenue')] });
assert.deepEqual(stage.querySelectorAll('.hac-trace').map(group => group.children[0].getAttribute('stroke-dasharray') || ''), ['', '8 5', '3 4'], 'Reported revenue, annual plan and scenario remain visually distinct');
assert.equal(root.querySelectorAll('.hac-entity-group').length, 1, 'A scenario and linked annual plan share the reported entity header');
assert.deepEqual(root.querySelectorAll('.hac-value-basis').map(label => label.textContent), ['Source', 'Scenario', 'Annual plan']);
assert.deepEqual(root.querySelectorAll('.hac-legend-value').map(value => value.textContent), ['$200.00', '$220.00', '$180.00']);
assert.equal(root.querySelectorAll('.hac-plan-disclosure')[0].open === true, false, 'Auxiliary annual plans do not expand the default readout');
const beforePlanLayout = layouts.length; root.querySelectorAll('.hac-plan-disclosure')[0].dispatch('toggle'); assert.equal(layouts.length, beforePlanLayout + 1);
const cohortPlan = { ...launchPlan, displayEntityId: 'connection-wired', displayName: 'Wired' };
const cohortPlanModel = chart.update({ periods, period: 2026, scale: 'trend', series: [cohortTraces[0], cohortPlan] });
assert.equal(root.querySelectorAll('.hac-entity-group').length, 1); assert.equal(root.querySelectorAll('.hac-entity-name')[0].textContent, 'Wired');
assert.equal(cohortPlanModel.indexed, false, 'Display linkage does not let a project plan borrow a cohort baseline');
assert.deepEqual(root.querySelectorAll('.hac-legend-value').map(value => value.textContent), ['$200.00', '$180.00'], 'A linked cohort plan remains separate, never added to reported revenue');
chart.update({ periods, period: 2025, series: [trace('Magnitude changes', 'revenue', [.5, 1234567890123, -25.25])] });
const magnitudeValue = root.querySelectorAll('.hac-legend-value')[0];
assert.equal(magnitudeValue.textContent, '$0.50'); assert.equal(magnitudeValue.className.split(/\s+/).includes('is-long'), false);
stage.dispatch('pointermove', { clientX: 516, pointerId: 11 });
assert.equal(magnitudeValue.textContent, '$1,234,567,890,123.00'); assert.equal(magnitudeValue.className.split(/\s+/).includes('is-long'), true, 'Hover can cross the long-number boundary without losing source precision');
stage.dispatch('pointermove', { clientX: 956, pointerId: 11 });
assert.equal(magnitudeValue.textContent, '-$25.25'); assert.equal(magnitudeValue.className.split(/\s+/).includes('is-long'), false, 'The same readout node handles short, large and signed values');
stage.dispatch('pointerleave');
const crowdedSources = Array.from({ length: 40 }, (_, index) => trace(`Crowded ${index}`, 'revenue', [.5, 1000, 2000], { entityId: `crowded-${index}` }));
chart.update({ periods, period: 2026, scale: 'trend', series: crowdedSources });
const inspectedBeforeCrowding = inspected.length; root.querySelectorAll('.hac-legend-row')[0].dispatch('click');
assert.equal(inspected.length, inspectedBeforeCrowding, 'A crowded point selection still does not open source evidence automatically');
assert.equal(primaryValues().length, 1); assert.equal(primaryValues()[0].getAttribute('data-series-id'), 'Crowded 0', 'Crowding never discards the primary selected point label');
assert.equal(primaryValues()[0].querySelectorAll('.hac-point-value-amount')[0].textContent, '$1,000.00', 'The primary label shows exact source dollars instead of its 200000 trend index');
assert.equal(stage.querySelectorAll('.hac-selected-point').length, 40); assert.equal(root.querySelectorAll('.hac-legend-value').length, 40, 'Dense annotation placement keeps every source point ring and exact top value');
assert.ok(stage.querySelectorAll('.hac-point-value').length < 40, 'Crowded secondary annotations are bounded by available geometry instead of overlapping or shrinking');
assert.ok(stage.querySelectorAll('.hac-point-value').every(group => group.querySelectorAll('.hac-point-value-amount')[0].textContent === '$1,000.00')); assertLabelGeometry();
chart.update({ periods: ['Baseline'], period: 'Baseline', series: [trace('Custom period', 'revenue', [], { points: [{ period: 'Baseline', value: 2 }] })] });
const customYearButton = root.querySelectorAll('.hac-year-buttons')[0].querySelectorAll('button')[0];
assert.equal(customYearButton.textContent, 'Baseline'); assert.equal(customYearButton.getAttribute('aria-label'), 'Baseline'); assert.equal(customYearButton.querySelectorAll('.hac-year-prefix').length, 0, 'Non-fiscal labels remain intact rather than acquiring a misleading FY prefix');
view.innerWidth = 831; root.clientWidth = 420; chart.update(input); assert.equal(layouts.at(-1).plotHeight, 410, 'Desktop viewport preserves plot height even beside an insights panel');
view.innerWidth = 600; chart.update(input); assert.equal(layouts.at(-1).plotHeight, 330, 'Only a genuinely narrow viewport uses the compact plot height'); delete view.innerWidth;
chart.destroy(); assert.equal(container.children.length, 0); assert.equal(disconnected, true);
assert.equal(externalViewControls.children.length, 0, 'Destroy removes the owned external time-view controls');
const selectedCount = selected.length; range.value = '1'; range.dispatch('input'); assert.equal(selected.length, selectedCount, 'Destroy removes persistent event listeners'); chart.destroy();
const entityContainer = new Element('div', doc), entitySelections = [], entityPeriods = [];
const entityChart = create(entityContainer, { onEntity(entity) { entitySelections.push(entity); return entity.id === 'PROJECT-B'; }, onPeriod: period => entityPeriods.push(period) });
entityChart.update({ periods, period: 2026, series: projectTraces.map(item => ({ ...item, entityDetailLevel: 'project' })) });
const entityRoot = entityContainer.children[0], entityHeaders = entityRoot.querySelectorAll('.hac-entity-header');
assert.ok(entityHeaders.every(header => header.getAttribute('data-entity-action') === 'navigate' && header.getAttribute('aria-pressed') === undefined), 'Detail-name buttons expose navigation instead of a misleading pressed-toggle state');
assert.match(entityHeaders[1].getAttribute('aria-label'), /Open project details.*Same product family.*PROJECT-B/);
entityHeaders[1].dispatch('click'); assert.equal(entitySelections.at(-1).id, 'PROJECT-B'); assert.equal(entitySelections.at(-1).name, 'Same product family');
assert.ok(entitySelections.at(-1).traces.every(item => item.entityId === 'PROJECT-B')); assert.equal(entityPeriods.length, 0, 'Accepted name navigation does not first mutate year or focus');
entityHeaders[0].dispatch('click'); assert.equal(entitySelections.at(-1).id, 'PROJECT-A');
assert.equal(entityPeriods.at(-1), 2026, 'A declined optional navigation preserves the existing group-focus fallback');
assert.ok(entityHeaders.every(header => header.getAttribute('aria-pressed') === undefined), 'Redrawing focus does not turn navigation controls into pressed toggles'); entityChart.destroy();
const comparisonYears = [2025, 2026, 2027, 2028];
const sourceForComparison = (id, metric, values, entityId, extra = {}) => trace(id, metric, [], { entityId, name: 'Same family', points: comparisonYears.map((period, index) => ({ period, value: values[index], kind: period === 2025 ? 'actual' : 'unclassified', source: [{ sheet: 'Synthetic readout comparisons', cell: `${id}-${period}`, value: values[index] }] })), ...extra });
const comparisonSources = [sourceForComparison('A:revenue', 'revenue', [100, 200, 0, 0], 'A'), sourceForComparison('A:units', 'units', [10, 10, 0, null], 'A'), sourceForComparison('A:profit', 'grossProfit', [20, 40, 0, 0], 'A'), sourceForComparison('A:investment', 'budget', [5, 10, 0, 0], 'A'), sourceForComparison('B:revenue', 'revenue', [200, 100, -5, -10], 'B'), sourceForComparison('B:units', 'units', [20, 20, 5, 5], 'B'), sourceForComparison('B:profit', 'grossProfit', [40, 20, -1, -2], 'B'), sourceForComparison('B:investment', 'budget', [10, 5, null, null], 'B')];
const comparisonEntities = ['A', 'B'].map(id => ({ id, name: 'Same family', revenuePoints: comparisonSources.find(item => item.id === id + ':revenue').points, unitsPoints: comparisonSources.find(item => item.id === id + ':units').points }));
const comparisonModel = { periods: comparisonYears, period: 2026, scale: 'trend', series: [...comparisonSources, sourceForComparison('A:scenario', 'revenue', [null, 500, null, null], 'A', { scenario: true }), sourceForComparison('B:annual-plan', 'revenue', [null, 1000, null, null], 'B:plan', { estimate: true, reportedEntityId: 'B' })], comparison: { entities: comparisonEntities } };
const comparisonBefore = JSON.stringify(comparisonModel), comparisonContainer = new Element('div', doc), comparisonPeriods = [], comparisonChart = create(comparisonContainer, { onPeriod: period => comparisonPeriods.push(period) });
const comparisonPrepared = comparisonChart.update(comparisonModel), comparisonRoot = comparisonContainer.children[0], comparisonStage = comparisonRoot.querySelectorAll('.hac-stage')[0], comparisonRange = comparisonRoot.querySelectorAll('.hac-year-range')[0], comparisonContext = comparisonRoot.querySelectorAll('.hac-comparison-context')[0];
const comparisonRow = id => comparisonRoot.querySelectorAll('.hac-legend-row').find(row => row.getAttribute('data-series-id') === id);
const delta = id => comparisonRow(id).querySelectorAll('.hac-readout-difference')[0];
assert.equal(comparisonPrepared.indexed, true); assert.equal(comparisonContext.getAttribute('data-comparison-baseline'), 'A'); assert.equal(comparisonContext.textContent, 'vs Same family · A', 'Duplicate names retain the exact source baseline identity');
assert.equal(delta('B:revenue').textContent, '(−50.0%)'); assert.equal(delta('B:revenue').getAttribute('data-comparison-percent'), '-50'); assert.ok(hasClass(delta('B:revenue'), 'is-negative'), 'Revenue comparison uses raw dollars rather than each trace’s independent trend index');
assert.equal(delta('B:units').textContent, '(+100.0%)'); assert.ok(hasClass(delta('B:units'), 'is-positive'), 'Units compare against the highest-revenue product even when another product sells more units');
for (const id of ['A:revenue', 'A:units', 'A:profit', 'A:investment', 'B:profit', 'B:investment', 'A:scenario', 'B:annual-plan']) assert.equal(delta(id).hidden, true, 'Baseline, other measures, scenario and annual-plan rows do not receive source comparison percentages');
const stableComparedRow = comparisonRow('A:revenue'), stableComparedDelta = delta('A:revenue');
const comparisonClip = comparisonStage.querySelectorAll('.hac-time-clip')[0].children[0];
comparisonStage.dispatch('pointermove', { clientX: Number(comparisonClip.getAttribute('x')), pointerId: 80 });
assert.equal(comparisonContext.getAttribute('data-comparison-baseline'), 'B'); assert.match(comparisonContext.getAttribute('aria-label'), /highest source revenue in FY25/); assert.equal(delta('A:revenue').textContent, '(−50.0%)'); assert.equal(delta('A:units').textContent, '(−50.0%)'); assert.equal(delta('B:revenue').hidden, true, 'Inspecting a different year recomputes the source baseline and hides its own comparison');
assert.equal(comparisonRow('A:revenue'), stableComparedRow); assert.equal(delta('A:revenue'), stableComparedDelta); assert.equal(comparisonRange.getAttribute('aria-valuetext'), 'FY26'); assert.equal(comparisonPeriods.length, 0, 'Hover comparison updates preserve the selected year and existing readout DOM');
comparisonStage.dispatch('pointerleave'); assert.equal(comparisonContext.getAttribute('data-comparison-baseline'), 'A');
comparisonRange.value = '2'; comparisonRange.dispatch('input'); assert.equal(comparisonContext.getAttribute('data-comparison-baseline'), 'A', 'A recorded zero can remain the highest source revenue');
assert.equal(delta('B:revenue').textContent, '(n/a)'); assert.equal(delta('B:revenue').getAttribute('data-comparison-percent'), ''); assert.match(delta('B:revenue').getAttribute('aria-label'), /zero revenue baseline/); assert.match(delta('B:units').getAttribute('aria-label'), /zero units baseline/);
comparisonRange.value = '3'; comparisonRange.dispatch('input'); assert.equal(comparisonRow('A:units').querySelectorAll('.hac-legend-value')[0].textContent, 'Unavailable'); assert.equal(delta('B:units').textContent, '(n/a)'); assert.match(delta('B:units').getAttribute('aria-label'), /source units is missing/, 'A missing baseline quantity does not become a zero denominator');
comparisonChart.update({ ...comparisonModel, series: comparisonSources.filter(item => item.metric === 'units') });
assert.equal(comparisonContext.getAttribute('data-comparison-baseline'), 'A'); assert.equal(delta('B:units').textContent, '(+100.0%)', 'Hidden Revenue still supplies the source baseline for visible Units');
const tinyComparison = structuredClone(comparisonModel); tinyComparison.series.find(item => item.id === 'B:revenue').points[1].value = 199.9; tinyComparison.comparison.entities.find(item => item.id === 'B').revenuePoints[1].value = 199.9;
comparisonChart.update(tinyComparison); assert.equal(comparisonRow('B:revenue').querySelectorAll('.hac-legend-value')[0].textContent, '$199.90'); assert.equal(delta('B:revenue').textContent, '(−<0.1%)'); assert.ok(Math.abs(Number(delta('B:revenue').getAttribute('data-comparison-percent')) + .05) < 1e-10, 'Tiny signed differences retain their exact raw percentage instead of visually rounding to zero');
const tiedComparison = structuredClone(comparisonModel); tiedComparison.series.find(item => item.id === 'B:revenue').points[1].value = 200; tiedComparison.comparison.entities.find(item => item.id === 'B').revenuePoints[1].value = 200; tiedComparison.series.reverse(); tiedComparison.comparison.entities.reverse();
comparisonChart.update(tiedComparison); assert.equal(comparisonContext.getAttribute('data-comparison-baseline'), 'A'); assert.equal(delta('B:revenue').textContent, '(0.0%)'); assert.ok(hasClass(delta('B:revenue'), 'is-neutral'), 'Tied revenue uses stable exact IDs and a neutral true-zero difference');
const missingComparison = structuredClone(comparisonModel); for (const entity of missingComparison.comparison.entities) for (const point of entity.revenuePoints) point.value = null;
comparisonChart.update(missingComparison); assert.equal(comparisonContext.hidden, true); assert.equal(delta('A:revenue').textContent, '(n/a)'); assert.equal(delta('B:units').textContent, '(n/a)', 'No finite source-revenue baseline produces unavailable comparisons rather than a made-up product');
comparisonChart.update({ ...comparisonModel, series: comparisonSources.slice(0, 4), comparison: { entities: comparisonEntities.slice(0, 1) } }); assert.equal(comparisonContext.hidden, true); assert.ok(comparisonRoot.querySelectorAll('.hac-readout-difference').every(item => item.hidden), 'One selected product clears comparison context and every percentage');
assert.equal(JSON.stringify(comparisonModel), comparisonBefore, 'Inspect comparisons never mutate source values, scenarios or annual plans'); comparisonChart.destroy();
const dragContainer = new Element('div', doc), dragSelections = [];
let dragChart;
dragChart = create(dragContainer, { onPeriod(period) { dragSelections.push(period); dragChart.update({ ...input, period }); } });
dragChart.update({ ...input, period: 2025 });
const dragRange = dragContainer.children[0].querySelectorAll('.hac-year-range')[0];
dragRange.dispatch('pointerdown', { clientX: 76, pointerId: 2, button: 0 });
dragRange.dispatch('pointermove', { clientX: 500, pointerId: 2 });
dragRange.dispatch('pointermove', { clientX: 880, pointerId: 2 });
assert.deepEqual(dragSelections, [2026, 2027], 'A parent model update during bottom-rail year selection preserves the continuing drag');
dragRange.dispatch('pointerup', { pointerId: 2 }); dragChart.destroy();

// A bounded frame queue verifies smooth guides without real timers or a browser.
let frameId = 0, frameTime = 0;
const frames = new Map();
view.requestAnimationFrame = callback => { const id = ++frameId; frames.set(id, callback); return id; };
view.cancelAnimationFrame = id => frames.delete(id);
view.matchMedia = () => ({ matches: false });
const finishMotion = () => { let ticks = 0; while (frames.size && ticks++ < 100) { const callbacks = [...frames.values()]; frames.clear(); frameTime += 16; callbacks.forEach(callback => callback(frameTime)); } assert.equal(frames.size, 0, 'Guide animation settles instead of keeping an idle frame loop'); };
const motionContainer = new Element('div', doc), motionChart = create(motionContainer);
motionChart.update({ ...input, period: 2025 }); finishMotion();
const motionRoot = motionContainer.children[0], motionStage = motionRoot.querySelectorAll('.hac-stage')[0], motionRange = motionRoot.querySelectorAll('.hac-year-range')[0];
const selectedGuide = motionStage.querySelectorAll('.hac-selected-line')[0], hoverGuide = motionStage.querySelectorAll('.hac-hover-line')[0];
motionRange.value = '2'; motionRange.dispatch('input');
assert.ok(Number(selectedGuide.getAttribute('x1')) < 956, 'Year selection starts from the existing guide position rather than jumping');
finishMotion(); assert.equal(Number(selectedGuide.getAttribute('x1')), 956); assert.equal(motionRoot.querySelectorAll('.hac-year-indicator')[0].style.left, '100%', 'Year highlight glides with the selected guide');
assert.equal(selectedGuide.getAttribute('y2'), '410', 'Selected guide reaches the SVG floor without a gap');
for (const className of ['hac-year-connector', 'hac-rail-marker']) assert.equal(motionRoot.querySelectorAll('.' + className)[0].style.left, '100%', 'Rail connector, custom thumb and selected-year underline share the eased guide position');
motionStage.dispatch('pointermove', { clientX: 296, pointerId: 5 });
assert.equal(Number(hoverGuide.getAttribute('x1')), 296, 'The guide follows between fiscal years');
motionStage.dispatch('pointermove', { clientX: 510, pointerId: 5 });
assert.ok(Number(hoverGuide.getAttribute('x1')) < 516, 'Magnetic capture moves smoothly toward the nearby fiscal year');
finishMotion(); assert.equal(Number(hoverGuide.getAttribute('x1')), 516);
assert.equal(motionRoot.querySelectorAll('.hac-readout-head')[0].children[0].textContent, 'Inspect FY26', 'The financial preview remains snapped to the nearest year without claiming hover is the selected year');
motionStage.dispatch('pointermove', { clientX: 640, pointerId: 5 }); finishMotion();
assert.equal(Number(hoverGuide.getAttribute('x1')), 516, 'Capture holds the exact fiscal-year coordinate through pointer jitter inside the release threshold');
assert.ok(motionRoot.querySelectorAll('.hac-year-buttons')[0].querySelectorAll('button')[1].className.includes('is-hovered'), 'The captured year is visibly identified');
assert.equal(motionRoot.querySelectorAll('.hac-hover-year-indicator')[0].hidden, false, 'A captured year has its single explicit inspection underline');
motionStage.dispatch('pointermove', { clientX: 710, pointerId: 5 });
assert.equal(motionRoot.querySelectorAll('.hac-readout-head')[0].children[0].textContent, 'Inspect FY26', 'Financial values hold their captured year while the guide travels between years');
finishMotion();
assert.equal(Number(hoverGuide.getAttribute('x1')), 710, 'Leaving the release threshold frees the guide to follow the pointer');
motionStage.dispatch('pointermove', { clientX: 900, pointerId: 5 }); finishMotion();
assert.equal(Number(hoverGuide.getAttribute('x1')), 956, 'The next year captures at its exact coordinate');
assert.equal(motionRoot.querySelectorAll('.hac-readout-head')[0].children[0].textContent, 'Selected FY27');
assert.equal(motionRoot.querySelectorAll('.hac-hover-year-indicator')[0].hidden, true, 'Hovering the selected year hides the duplicate inspection underline');
motionRange.value = '0'; motionRange.dispatch('input'); assert.ok(frames.size > 0);
view.dispatch('blur'); assert.equal(frames.size, 0, 'Blur cancels guide animation'); assert.equal(Number(selectedGuide.getAttribute('x1')), 76); assert.equal(hoverGuide.getAttribute('visibility'), 'hidden');
motionRange.value = '2'; motionRange.dispatch('input'); assert.ok(frames.size > 0); motionChart.destroy(); assert.equal(frames.size, 0, 'Destroy cancels pending animation frames');
const panContainer = new Element('div', doc), panPeriods = [], panEvidence = [];
const panChart = create(panContainer, { onPeriod: period => panPeriods.push(period), onPoint: payload => panEvidence.push(payload) });
const panPrepared = panChart.update(input); finishMotion();
const panRoot = panContainer.children[0], panStage = panRoot.querySelectorAll('.hac-stage')[0], panRange = panRoot.querySelectorAll('.hac-year-range')[0], zoomRange = panRoot.querySelectorAll('.hac-zoom-range')[0], fitButton = panRoot.querySelectorAll('.hac-view-reset')[0];
const panView = () => ({ ...panChart.getView() }), nearView = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, message);
assert.equal(panStage.tabIndex, 0); assert.match(panStage.getAttribute('aria-label'), /pan.*wheel.*pinch.*arrow keys/i, 'The chart explains its keyboard and pointer time-view controls');
assert.equal(zoomRange.type, 'range'); assert.equal(zoomRange.min, '100'); assert.equal(zoomRange.max, '400'); assert.equal(zoomRange.step, '5'); assert.equal(zoomRange.getAttribute('aria-label'), 'Time zoom');
nearView(panView().zoom, 1); nearView(panView().offset, 0);
const timeClip = panStage.querySelectorAll('.hac-time-clip')[0], clipRect = timeClip.children[0], clipLeft = Number(clipRect.getAttribute('x')), clipWidth = Number(clipRect.getAttribute('width'));
assert.equal(panStage.querySelectorAll('.hac-data-layer')[0].getAttribute('clip-path'), `url(#${timeClip.getAttribute('id')})`, 'Financial paths and point hit targets share the visible time-plot clip');
const stableLegend = panRoot.querySelectorAll('.hac-legend-row')[1], stableYears = panRoot.querySelectorAll('.hac-year-buttons')[0].querySelectorAll('button'), stablePoints = panStage.querySelectorAll('.hac-point'), baseY = stablePoints.map(point => point.children[0].getAttribute('cy')), basePaths = panStage.querySelectorAll('.hac-trace').map(group => group.children[0].getAttribute('d'));
stableLegend.dispatch('click'); const selectionsBeforeView = panPeriods.length;
let prevented = 0;
panStage.dispatch('wheel', { clientX: 516, deltaY: -100, preventDefault() { prevented++; } });
assert.equal(prevented, 0); nearView(panView().zoom, 1, 'Ordinary wheel scrolling remains native rather than changing the financial chart');
zoomRange.value = '200'; zoomRange.dispatch('input'); assert.ok(frames.size > 0, 'Time zoom eases through the existing bounded animation loop'); finishMotion();
nearView(panView().zoom, 2); assert.equal(zoomRange.getAttribute('aria-valuetext'), '200 percent time zoom');
assert.equal(panRoot.querySelectorAll('.hac-legend-row')[1], stableLegend); assert.equal(stableLegend.getAttribute('aria-pressed'), 'true', 'Zoom preserves the exact selected metric and its focused DOM node');
assert.equal(panRoot.querySelectorAll('.hac-year-buttons')[0].querySelectorAll('button')[1], stableYears[1], 'Time-view frames reposition the existing year controls rather than rebuilding them');
assert.deepEqual(panStage.querySelectorAll('.hac-trace').map(group => group.children[0].getAttribute('d')), basePaths, 'Zoom preserves source path coordinates');
assert.deepEqual(panStage.querySelectorAll('.hac-point').map(point => point.children[0].getAttribute('cy')), baseY, 'Time zoom does not alter the financial value axis');
assert.ok(panStage.querySelectorAll('.hac-trace').every(group => /scale\(2 1\)/.test(group.children[0].getAttribute('transform'))));
assert.equal(panPeriods.length, selectionsBeforeView); assert.equal(panEvidence.length, 0, 'Zoom does not select a year or open evidence');
const offsetBeforeDrag = panView().offset;
panStage.dispatch('pointerdown', { clientX: 300, clientY: 150, pointerId: 60, button: 0 });
panStage.dispatch('pointermove', { clientX: 300 - offsetBeforeDrag, clientY: 150, pointerId: 60, preventDefault() {} }); finishMotion();
panStage.dispatch('pointerup', { pointerId: 60 }); finishMotion(); nearView(panView().offset, 0, 'A horizontal drag pans the enlarged time domain toward its first year');
assert.equal(panPeriods.length, selectionsBeforeView); assert.equal(panRoot.querySelectorAll('.hac-legend-row')[1], stableLegend);
panStage.dispatch('pointermove', { clientX: clipLeft + clipWidth, pointerId: 61 }); finishMotion();
assert.equal(panRoot.querySelectorAll('.hac-readout-head')[0].children[0].textContent, 'Selected FY26', 'Inverse hit mapping identifies FY26 at its zoomed coordinate rather than the old FY27 position');
assert.equal(panRoot.querySelectorAll('.hac-legend-value')[0].textContent, '$200.00');
nearView(Number(panStage.querySelectorAll('.hac-selected-line')[0].getAttribute('x1')), clipLeft + clipWidth, 'The selected guide follows the same zoom transform as the source point');
assert.equal(stableYears[1].style.left, '100%', 'The fiscal-year label stays aligned with its transformed guide');
panStage.dispatch('pointerdown', { clientX: 200, clientY: 150, pointerId: 62, button: 0 }); panStage.dispatch('pointermove', { clientX: 10000, clientY: 150, pointerId: 62, preventDefault() {} }); finishMotion();
assert.ok(panView().offset > 0 && panView().offset <= clipWidth * .05 + 1e-6, 'Dragging beyond the first year uses bounded resisted overscroll');
panStage.dispatch('pointerup', { pointerId: 62 }); finishMotion(); nearView(panView().offset, 0, 'Releasing overscroll settles back to the legal time range');
panStage.dispatch('pointerdown', { clientX: 600, clientY: 150, pointerId: 63, button: 0 }); panStage.dispatch('pointermove', { clientX: -10000, clientY: 150, pointerId: 63, preventDefault() {} }); finishMotion();
assert.ok(panView().offset >= -clipWidth * 1.05 - 1e-6 && panView().offset < -clipWidth, 'Overscroll at the last year is also bounded');
panStage.dispatch('pointerup', { pointerId: 63 }); finishMotion(); nearView(panView().offset, -clipWidth);
panRange.value = '0'; panRange.dispatch('input'); finishMotion(); assert.equal(panPeriods.at(-1), 2025); nearView(panView().zoom, 2, 'The year rail reveals an offscreen selection without discarding the zoom');
const revealedGuide = Number(panStage.querySelectorAll('.hac-selected-line')[0].getAttribute('x1')); assert.ok(revealedGuide >= clipLeft && revealedGuide <= clipLeft + clipWidth);
fitButton.dispatch('click'); finishMotion(); nearView(panView().zoom, 1); nearView(panView().offset, 0);
const beforeModifiedWheel = panPeriods.length;
panStage.dispatch('wheel', { clientX: 516, deltaY: -200, ctrlKey: true, preventDefault() { prevented++; } }); finishMotion(); const controlZoom = panView().zoom; assert.ok(controlZoom > 1 && prevented === 1);
panStage.dispatch('wheel', { clientX: 516, deltaY: -200, metaKey: true, preventDefault() { prevented++; } }); finishMotion(); assert.ok(panView().zoom > controlZoom && prevented === 2, 'Control and Command wheel gestures both zoom deliberately');
zoomRange.value = '500'; zoomRange.dispatch('input'); finishMotion(); nearView(panView().zoom, 4, 'Zoom never exceeds 400 percent');
zoomRange.value = '50'; zoomRange.dispatch('input'); finishMotion(); nearView(panView().zoom, 1, 'Zoom never goes below Fit');
const key = value => panStage.dispatch('keydown', { key: value, preventDefault() { prevented++; } });
key('+'); finishMotion(); assert.ok(panView().zoom > 1); key('Home'); finishMotion(); nearView(panView().zoom, 1);
zoomRange.value = '200'; zoomRange.dispatch('input'); finishMotion(); const beforeArrow = panView().offset; key('ArrowRight'); finishMotion(); assert.ok(panView().offset < beforeArrow, 'Keyboard arrows pan the zoomed time view');
const retainedView = panView(); panChart.update({ ...input, period: 2025, series: [input.series[0]] }); finishMotion(); nearView(panView().zoom, retainedView.zoom); nearView(panView().offset, retainedView.offset, 'Changing year or measures within the same period domain retains the time view');
panChart.update({ periods: periods.slice(0, 2), period: 2025, series: input.series.map(series => ({ ...series, points: series.points.slice(0, 2) })) }); finishMotion(); nearView(panView().zoom, 1); nearView(panView().offset, 0, 'A different fiscal domain starts at Fit instead of applying an unrelated offset');
panChart.update(input); finishMotion(); assert.equal(panPeriods.length, beforeModifiedWheel, 'Wheel, keyboard and model updates never impersonate year-selection actions');
let touchPrevented = 0;
panStage.dispatch('pointerdown', { pointerType: 'touch', clientX: 200, clientY: 100, pointerId: 70 }); panStage.dispatch('pointermove', { pointerType: 'touch', clientX: 205, clientY: 240, pointerId: 70, preventDefault() { touchPrevented++; } }); panStage.dispatch('pointerup', { pointerType: 'touch', pointerId: 70 });
assert.equal(touchPrevented, 0); assert.ok(!hasClass(panRoot, 'is-panning'), 'A vertical single-touch gesture preserves native page scrolling');
panStage.dispatch('pointerdown', { pointerType: 'touch', clientX: 300, clientY: 150, pointerId: 71 }); panStage.dispatch('pointerdown', { pointerType: 'touch', clientX: 600, clientY: 150, pointerId: 72 });
assert.ok(panStage.hasPointerCapture(71) && panStage.hasPointerCapture(72), 'Pinch captures both active pointers');
panStage.dispatch('pointermove', { pointerType: 'touch', clientX: 150, clientY: 150, pointerId: 71, preventDefault() { touchPrevented++; } }); finishMotion(); assert.ok(panView().zoom > 1 && touchPrevented > 0, 'Two-touch pinch changes only the time-view zoom');
panStage.dispatch('pointermove', { pointerType: 'touch', clientX: 5000, clientY: 150, pointerId: 72, preventDefault() {} }); finishMotion(); nearView(panView().zoom, 4);
view.dispatch('blur'); assert.equal(frames.size, 0); assert.equal(panStage.captures.size, 0); assert.ok(!hasClass(panRoot, 'is-panning'), 'Blur releases active pinch captures and cancels view motion');
panRange.dispatch('pointerdown', { clientX: clipLeft, pointerId: 73, button: 0 }); assert.equal(panRange.hasPointerCapture(73), true); view.dispatch('blur'); assert.equal(panRange.hasPointerCapture(73), false, 'Blur also releases the independently captured fiscal-year slider before clearing its drag state'); assert.equal(frames.size, 0);
assert.ok(panView().offset >= (1 - panView().zoom) * clipWidth && panView().offset <= 0);
assert.equal(JSON.stringify(input), before, 'Pan, zoom, gestures and domain changes never mutate imported financial source values');
assert.equal(panPrepared.series[0].points[1].rawValue, 200); assert.equal(panPrepared.series[0].points[1].source[0].cell, 'Alpha revenue-2026');
const exactPanMarker = panStage.querySelectorAll('.hac-point').find(point => point.getAttribute('data-point-key') === 'Alpha revenue::0|1'); assert.match(exactPanMarker.getAttribute('aria-label'), /Alpha.*Revenue.*FY26.*\$200\.00.*Unclassified/, 'Pan and zoom preserve each marker’s exact accessible financial description');
assert.equal(svgDescendants(panStage).filter(node => node.tagName === 'title').length, 0, 'View changes do not recreate native point hover popups');
zoomRange.value = '200'; zoomRange.dispatch('input'); assert.ok(frames.size > 0); panChart.destroy(); assert.equal(frames.size, 0); assert.equal(panContainer.children.length, 0);
assert.equal(panStage.events.get('wheel').size, 0); assert.equal(zoomRange.events.get('input').size, 0, 'Destroy removes view gesture and control listeners');
view.matchMedia = () => ({ matches: true });
const reducedContainer = new Element('div', doc), reducedChart = create(reducedContainer);
reducedChart.update({ ...input, period: 2025 });
const reducedRoot = reducedContainer.children[0], reducedRange = reducedRoot.querySelectorAll('.hac-year-range')[0];
reducedRange.value = '2'; reducedRange.dispatch('input');
assert.equal(Number(reducedRoot.querySelectorAll('.hac-selected-line')[0].getAttribute('x1')), 956, 'Reduced motion selects the year directly');
assert.equal(frames.size, 0, 'Reduced motion does not schedule inertial movement');
const reducedZoom = reducedRoot.querySelectorAll('.hac-zoom-range')[0]; reducedZoom.value = '200'; reducedZoom.dispatch('input'); nearView(reducedChart.getView().zoom, 2, 'Reduced motion applies time zoom directly');
assert.equal(frames.size, 0); reducedRoot.querySelectorAll('.hac-view-reset')[0].dispatch('click'); nearView(reducedChart.getView().zoom, 1); assert.equal(frames.size, 0); reducedChart.destroy();
assert.match(css, /prefers-reduced-motion:reduce/); assert.match(css, /touch-action:pan-y/); assert.match(css, /\.hac-legend\{display:flex;flex-wrap:nowrap/); assert.match(css, /overflow-x:auto;overflow-y:hidden/); assert.match(css, /\.hac-entity-evidence/); assert.match(css, /focus-visible/);
assert.match(css, /@container hac-entity \(max-width:700px\)\{\.hac-entity-metrics\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Readout measures use two columns before long financial amounts can overlap'); assert.match(css, /\.hac-plan-rows\{max-height:96px;overflow:auto/);
assert.match(css, /\.hac-trace\.is-muted\{opacity:\.22\}/, 'Exact point focus quiets the other financial curves while retaining them');
assert.match(css, /\.hac-trace\.is-selected\{opacity:1\}/, 'The selected curve retains full strength');
assert.match(css, /\.hac-selected-point\.is-secondary\{opacity:\.5\}/, 'Other selected-year rings retain a quieter secondary treatment');
for (const selector of ['hac-selected-point', 'hac-point-value']) assert.match(css, new RegExp(`\\.${selector}\\.is-primary\\{opacity:1\\}`), 'The exact selected point and its value remain the primary focus');
assert.match(css, /\.hac-point-value\.is-secondary\{opacity:1\}/, 'Secondary value text stays opaque enough to read');
assert.match(css, /\.hac-point-value\.is-secondary \.hac-point-value-amount,\.hac-point-value\.is-secondary \.hac-point-value-name\{fill:#8e9bad\}/, 'Secondary value labels use a neutral muted color while the primary keeps its trace color');
const valueFontRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector, body]) => selector.includes('.hac-legend-value') && /font-size\s*:/.test(body));
assert.equal(valueFontRules.length, 1, 'Readout figures have one uniform font size with no container or data-dependent override');
for (const [, selector] of valueFontRules) {
  const selectors = selector.split(',').map(item => item.trim());
  assert.ok(selectors.includes('.hac-legend-value') && selectors.includes('.hac-legend-value.is-long'), 'Every font-size rule applies equally to short and long values, so hover cannot resize the readout');
}
assert.match(css, /\.hac-legend-value,\.hac-legend-value\.is-long\{[^}]*font-size:(?:15px|var\(--analysis-value-size,15px\))[^}]*letter-spacing:0/, 'Every short or long secondary figure uses the uniform 15px size without spacing jitter');
assert.match(css, /\.hac-year-buttons button:hover:not\(\.is-selected\):not\(\.is-hovered\):not\(:focus-visible\)\{text-decoration:underline/, 'A plain hovered year can have one text underline only when no custom state indicator applies');
assert.match(css, /\.hac-year-buttons button\.is-hovered,\.hac-year-buttons button\.is-selected:hover\{text-decoration:none\}/, 'Captured and selected years cannot add a text underline to their explicit indicator');
assert.match(css, /\.hac-year-buttons button:focus-visible\{[^}]*background:#[\da-f]{8}[^}]*color:#[\da-f]{6}[^}]*text-decoration:none/i, 'Keyboard year focus remains visible without adding another underline');
assert.match(css, /\.hac-year-range:focus-visible\{[^}]*background:#[\da-f]{8}/i, 'The native accessible range retains a visible keyboard focus treatment');
const ruleBodies = selector => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selectors]) => selectors.split(',').map(item => item.trim()).includes(selector)).map(([, , body]) => body).join(';');
const cssNumber = (selector, property) => Number.parseFloat([...ruleBodies(selector).matchAll(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`, 'g'))].at(-1)?.[1]);
for (const selector of ['.hac-legend:focus-visible', '.hac-entity-header:focus-visible', '.hac-legend-row:focus-visible', '.hac-entity-evidence:focus-visible']) {
  const body = ruleBodies(selector);
  assert.match(body, /(?:^|;)outline:0(?:;|$)/, 'Keyboard readout focus does not add a bright enclosing box');
  assert.match(body, /box-shadow:inset 0 -2px color-mix\([^;]*35%,transparent\)/, 'Keyboard readout focus retains a subtle visible underline');
  assert.match(body, /background:#[\da-f]{8}/i, 'Keyboard readout focus retains a visible wash as well as the underline');
}
const railCenter = cssNumber('.hac-year-range', 'height') / 2;
assert.equal(railCenter, 13, 'The enlarged year track has a 13px center');
for (const marker of ['.hac-rail-marker', '.hac-hover-marker']) assert.equal(cssNumber(marker, 'top') + cssNumber(marker, 'height') / 2, railCenter, `${marker} stays centered on the native year track rather than drifting when its height changes.`);
for (const connector of ['.hac-year-connector', '.hac-hover-connector']) {
  assert.equal(cssNumber(connector, 'top') + cssNumber(connector, 'height'), railCenter, 'The plot guide stops at the slider center before the fiscal-year text');
  assert.doesNotMatch(ruleBodies(connector), /(?:^|;)\s*bottom:/, 'A connector cannot also stretch down across the year labels');
}
assert.match(ruleBodies('.hac-year-rail'), /padding:0\s[^;]+;[^}]*background:#ffffff06/, 'The year rail has a subtle visible band without adding a gap above the connected guide');
assert.equal(cssNumber('.hac-year-number', 'font-size'), 18, 'The fiscal-year number has the requested distinct large size');
assert.equal(cssNumber('.hac-year-prefix', 'font-size'), 11, 'The FY prefix stays smaller than the year number');
assert.match(ruleBodies('.hac-year-prefix'), /color:#788494/, 'The FY prefix is quieter than the selected year number');
for (const track of ['.hac-year-range::-webkit-slider-runnable-track', '.hac-year-range::-moz-range-track']) { assert.equal(cssNumber(track, 'height'), 1, 'Both browser engines render one thin year-rail line'); assert.match(ruleBodies(track), /background:#ffffff1c/, 'The rail line stays subtle beneath the plot'); }
assert.match(css, /\.hac-readout-head>span[^}]*\{[^}]*clip-path:inset\(50%\)/, 'Status notes and hints remain accessible without appearing beside the concise selected-year heading');
assert.ok(cssNumber('.hac-year-buttons button', 'min-height') >= 35); assert.ok(cssNumber('.hac-year-buttons', 'height') >= cssNumber('.hac-year-buttons button', 'min-height'), 'The enlarged year row contains its accessible year buttons');
assert.match(css, /\.hac-entity-group\+\.hac-entity-group::before\{[^}]*position:absolute;[^}]*left:-\d+(?:\.\d+)?px;[^}]*width:1px;[^}]*background:#ffffff[01][\da-f];[^}]*pointer-events:none/i, 'Adjacent readout groups have a subtle divider positioned in the existing gap without consuming content width');
assert.doesNotMatch(css, /\.hac-entity-group\+\.hac-entity-group\s*\{[^}]*(?:border|padding|margin|width|flex)[^:;]*:/i, 'A sibling divider cannot give later groups different content widths and trigger different metric-column breakpoints');
assert.match(css, /\.hac-entity-group\{[^}]*border:0;border-radius:0/, 'Entity groups are flat, without heavy card borders');
assert.match(css, /\.hac-entity-group\.is-selected \.hac-entity-headrow\{border-bottom-color:#ffffff18/, 'Selected entity headings keep a quiet neutral underline');
assert.match(css, /\.hac-legend-row\.is-selected\{border-bottom-color:color-mix\(in srgb,var\(--hac-color,#969eac\) 25%,transparent\)/, 'Selected readout values use the same quiet selection strength');
assert.match(css, /slider-thumb\{[^}]*background:transparent/, 'The native accessible range does not display a jumping thumb ahead of the animated marker');
assert.doesNotMatch(source, /hac-point-leader|hac-point-label-text|hac-evidence-button|hac-swatch/, 'The plot has no repeated callout web, swatches, or tiny per-value evidence icons');
assert.doesNotMatch(source, /showModal\s*\(/, 'The canvas never opens a popup');
console.log('Blueprint analysis canvas: flat grouped values, single raw point annotation, selected-year-only band, readable curves, explicit evidence, capture/release snapping, connected timeline, shared baseline, gaps and cleanup checks passed.');
