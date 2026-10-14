import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [dashboardSource, engineSource] = await Promise.all([
  readFile(new URL('../../public/blueprint/dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../../public/blueprint/analytics.js', import.meta.url), 'utf8'),
]);
const periods = [2023, 2024, 2025, 2026, 2027, 2028];
const reference = (category, period, metric, value) => ({ sheet: 'Synthetic source', cell: `${category}-${period}-${metric}`, value });
function product(category, revenue, margin) {
  const revenueByYear = Object.fromEntries(periods.map((period, index) => [period, revenue[index]]));
  const gmByYear = Object.fromEntries(periods.map((period, index) => [period, revenue[index] === null ? null : revenue[index] * margin]));
  return { id: category, name: category, category, revenueByYear, gmByYear,
    unitsByYear: { ...revenueByYear }, sourceByYear: Object.fromEntries(periods.map(period => [period, {
      revenue: [reference(category, period, 'revenue', revenueByYear[period])],
      grossProfit: [reference(category, period, 'profit', gmByYear[period])],
    }])) };
}
const fixture = {
  periods, categories: ['Headsets', 'Mice', 'Keyboards'],
  products: [product('Headsets', [1000, 2000, null, 4000, 6000, 8000], .2), product('Mice', [10, 20, 30, 40, 60, 80], .4), product('Keyboards', [90000, 90000, 90000, 90000, 90000, 90000], .6)],
  published: periods.flatMap(period => ['Headsets', 'Mice'].map(category => {
    const record = category === 'Headsets' ? [4000, .2, 4400] : [40, .4, 44];
    return { category, period, revenue: record[0], grossMargin: record[1], target: record[2], source: {
      revenue: [reference(category, period, 'published-revenue', record[0])],
      grossMargin: [reference(category, period, 'published-margin', record[1])],
      target: [reference(category, period, 'target', record[2])],
    } };
  })),
  investments: [], npi: [], tam: [], npiValues: [], metrics: {},
};

function extractBetween(start, end) {
  const first = dashboardSource.indexOf(start), last = dashboardSource.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Dashboard function region exists: ${start}`);
  return dashboardSource.slice(first, last);
}
// Exercise the real helper and renderer implementations without booting the app
// or duplicating its chart mathematics in a second implementation.
const helpers = extractBetween('  function escape(value)', '  function comparisonChart(');
const chart = extractBetween('  function comparisonChart(', '  function lineChart(');
const evidence = extractBetween('  function evidence(', '  function openDialog(');
const detail = extractBetween('  function metricDetail(', '  function productCases(');
const colors = dashboardSource.match(/const colors = (\[[^\n]+?\]);/)?.[1];
assert.ok(colors, 'The dashboard declares its category palette');
function create(data = structuredClone(fixture)) {
  const state = { period: 2026, category: ['Headsets', 'Mice'], comparisonScale: 'trend' }, dialogs = [];
  const context = { window: { HX_DATA: data, innerWidth: 1000 }, testState: state, console,
    openDialog: (title, content) => dialogs.push({ title, content }) };
  vm.createContext(context);
  vm.runInContext(engineSource, context, { filename: 'blueprint/analytics.js' });
  vm.runInContext(`const state = testState; const colors = ${colors}; function icon() { return ''; }
    ${helpers}\n${chart}\n${evidence}\n${detail}
    globalThis.check = { comparisonChart, summary, opts, rows, allSeries, sourceRefs, metricDetail, allCategoriesSelected, selectedCategories, isComparison, inCategoryScope, scopeLabel, categoryColor };`, context, { filename: 'blueprint/dashboard-chart-functions.js' });
  return { state, data, dialogs, api: context.check, engine: context.window.HX_ANALYTICS, window: context.window };
}
function tags(markup, name) {
  return [...markup.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'g'))].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])
  ));
}
const chartPoints = html => tags(html, 'circle').filter(point => point.class === 'chart-point');
const valuePoint = (html, category, period) => chartPoints(html).find(point => point['data-chart-category'] === category && point['data-period'] === String(period) && point['data-chart-metric'] === 'revenue');
const near = (actual, expected, message) => assert.ok(Math.abs(Number(actual) - Number(expected)) < 1e-9, `${message}: ${actual} / ${expected}`);
const { api, state, data, dialogs } = create();
const unchanged = JSON.stringify(data);

assert.equal(api.allCategoriesSelected(), false);
assert.equal(api.isComparison(), true);
assert.deepEqual(Array.from(api.selectedCategories()), ['Headsets', 'Mice']);
assert.equal(api.inCategoryScope('Mice'), true);
assert.equal(api.inCategoryScope('Keyboards'), false);
assert.equal(api.scopeLabel(), 'Headsets + Mice');
assert.deepEqual(Array.from(api.opts().category), ['Headsets', 'Mice']);
assert.equal(api.summary().revenue, 4040, 'The headline remains the combined source total for the selected categories');
assert.deepEqual(Array.from(api.rows(), row => row.category).sort(), ['Headsets', 'Mice'], 'Product scope excludes unselected categories');

const trend = api.comparisonChart('revenue', { target: true });
assert.match(trend, /data-comparison-scale="trend"/);
assert.match(trend, /FY23 = 100 for every category/, 'The common normalization year is explicit');
assert.match(trend, /data-index-baseline="100"/, 'The shared baseline is visible as a reference line');
assert.match(trend, /trend index, FY23 equals 100/, 'Accessible chart label states the normalization');
assert.doesNotMatch(trend, /data-chart-metric="revenueTarget"|:target:/, 'Raw currency targets are absent from an indexed axis');
assert.doesNotMatch(trend, /NaN|Infinity|undefined/, 'Every plotted coordinate remains finite');
for (const period of [2023, 2024, 2026, 2027, 2028]) {
  near(valuePoint(trend, 'Headsets', period).cy, valuePoint(trend, 'Mice', period).cy, 'Equal growth at different revenue scales overlaps in trend mode');
}
const trendLegend = trend.slice(0, trend.indexOf('<svg'));
assert.match(trendLegend, /Headsets<\/span><strong>\$4\.0K<\/strong><small>Index 400\.0<\/small>/);
assert.match(trendLegend, /Mice<\/span><strong>\$40<\/strong><small>Index 400\.0<\/small>/, 'Legend retains precise category scale beside its trend index');
const trendAxes = [...trend.matchAll(/<text class="chart-axis"[^>]*>([^<]*)<\/text>/g)].map(match => match[1]);
assert.ok(trendAxes.filter(text => /^-?\d+$/.test(text)).length >= 5, 'Indexed tick labels are unitless numbers');
assert.ok(trendAxes.every(text => !text.includes('$')), 'A normalized axis does not display currency tick labels');
assert.match(valuePoint(trend, 'Mice', 2026)['aria-label'], /\$40.*trend index 400\.0/, 'Point readout preserves source value alongside its normalized coordinate');
assert.equal(valuePoint(trend, 'Headsets', 2025), undefined, 'A missing source point does not become zero');
const hPaths = tags(trend, 'polyline').filter(path => path['data-comparison-category'] === 'Headsets');
const beforeGap = Number(valuePoint(trend, 'Headsets', 2024).cx), afterGap = Number(valuePoint(trend, 'Headsets', 2026).cx);
assert.ok(hPaths.length >= 2, 'Missing observations split a category into separate paths');
assert.ok(hPaths.every(path => {
  const xs = path.points.split(' ').map(point => Number(point.split(',')[0]));
  return !(xs.some(x => x <= beforeGap) && xs.some(x => x >= afterGap));
}), 'No category line bridges the missing year');
assert.ok(hPaths.some(path => path['stroke-dasharray'] === '6 4'), 'Projection segments keep their dashed planning style');
assert.ok(hPaths.some(path => !path['stroke-dasharray']), 'Historical segments retain a solid style');
const active = valuePoint(trend, 'Mice', 2026), inactive = valuePoint(trend, 'Mice', 2024);
assert.ok(Number(active.r) > Number(inactive.r), 'Selected planning year receives a larger point');
assert.equal(active.fill, active.stroke, 'Selected point uses its category color');
assert.equal(inactive.fill, '#242527', 'Other periods remain visually secondary');

state.comparisonScale = 'values';
const absolute = api.comparisonChart('revenue', { target: true });
assert.match(absolute, /data-comparison-scale="values"/);
assert.doesNotMatch(absolute, /data-index-baseline|Index 400/, 'Absolute mode removes normalized reference marks');
assert.ok(Number(valuePoint(absolute, 'Mice', 2026).cy) > Number(valuePoint(absolute, 'Headsets', 2026).cy), 'Absolute mode plots the actual category magnitude');
assert.ok(chartPoints(absolute).some(point => point['data-chart-metric'] === 'revenueTarget' && point['data-chart-category'] === 'Mice'), 'Absolute mode retains each category target and source identity');
assert.ok(tags(absolute, 'polyline').some(path => path['data-chart-series'].includes(':target:') && path['stroke-dasharray'] === '1 5'), 'Category targets stay visually distinct from source revenue');
assert.match(absolute, /dotted category target/);
assert.equal(api.summary().revenue, 4040, 'Switching the chart scale never changes the combined headline');
assert.equal(api.allSeries('revenue').find(point => point.period === 2026).value, 4040, 'The year evidence table keeps combined source values');
assert.deepEqual([...new Set(chartPoints(absolute).map(point => point['data-chart-category']))].sort(), ['Headsets', 'Mice'], 'The plot contains individual category lines and excludes an invented combined line');

const firstColors = Object.fromEntries(['Headsets', 'Mice'].map(category => [category, valuePoint(absolute, category, 2026).stroke]));
state.category = ['Mice', 'Headsets']; state.period = 2028;
const reordered = api.comparisonChart('revenue');
for (const category of ['Headsets', 'Mice']) assert.equal(valuePoint(reordered, category, 2028).stroke, firstColors[category], 'Color is stable across selection order and year changes');
state.category = ['Headsets', 'Mice']; state.period = 2026; state.comparisonScale = 'trend';
const margin = api.comparisonChart('grossMargin');
assert.match(margin, /data-comparison-scale="values"/);
assert.doesNotMatch(margin, /data-index-baseline/, 'Percentage measures stay on their meaningful percentage scale');
assert.match(margin, /shared percentage scale/);
assert.ok([...margin.matchAll(/<text class="chart-axis"[^>]*>([^<]*)<\/text>/g)].some(match => match[1].includes('%')));

const micePoint = valuePoint(trend, 'Mice', 2026);
api.metricDetail(micePoint['data-chart-metric'], micePoint['data-period'], micePoint['data-chart-category']);
assert.match(dialogs.at(-1).content, /Category scope<\/label><strong>Mice<\/strong>/);
assert.match(dialogs.at(-1).content, /Source value · precise<\/label><strong>\$40<\/strong>/);
assert.match(dialogs.at(-1).content, /Mice-2026-revenue/);
assert.doesNotMatch(dialogs.at(-1).content, /Headsets-2026-/, 'A category source point opens evidence for that category only');
assert.match(dashboardSource, /metricDetail\(point\.dataset\.chartMetric,\s*point\.dataset\.period,\s*point\.dataset\.chartCategory\)/, 'The actual delegated click routes chart category into source details');
assert.equal(JSON.stringify(data), unchanged, 'Rendering either scale and inspecting points does not mutate source records');

const signed = create();
signed.data.products.find(row => row.category === 'Mice').revenueByYear[2027] = 0;
signed.data.products.find(row => row.category === 'Mice').revenueByYear[2028] = -10;
const signedChart = signed.api.comparisonChart('revenue');
assert.ok(valuePoint(signedChart, 'Mice', 2027), 'Observed zero remains a real plotted point');
assert.ok(valuePoint(signedChart, 'Mice', 2028), 'Signed source adjustments remain plotted');
assert.match(valuePoint(signedChart, 'Mice', 2027)['aria-label'], /\$0.*trend index 0\.0/);
assert.match(valuePoint(signedChart, 'Mice', 2028)['aria-label'], /−\$10.*trend index -100\.0/);
assert.doesNotMatch(signedChart, /NaN|Infinity/);

const noBase = create();
for (const period of periods) noBase.data.products.find(row => row.category === 'Mice').revenueByYear[period] = 0;
const fallback = noBase.api.comparisonChart('revenue', { target: true });
assert.match(fallback, /data-comparison-scale="values"/);
assert.match(fallback, /shared year with a positive source value/, 'A missing shared positive baseline explains the fallback');
assert.ok(chartPoints(fallback).some(point => point['data-chart-metric'] === 'revenueTarget'), 'Falling back to source values retains compatible targets');

const delayedBase = create();
delayedBase.data.products.find(row => row.category === 'Headsets').revenueByYear[2023] = 0;
const delayedTrend = delayedBase.api.comparisonChart('revenue');
assert.match(delayedTrend, /FY24 = 100 for every category/, 'A zero initial value moves every category to the same first usable positive year');
near(valuePoint(delayedTrend, 'Headsets', 2024).cy, valuePoint(delayedTrend, 'Mice', 2024).cy, 'Both traces use that common baseline');
assert.match(valuePoint(delayedTrend, 'Headsets', 2023)['aria-label'], /trend index 0\.0/, 'An earlier source zero remains visible before the common baseline');

const unavailable = create();
for (const row of unavailable.data.products) for (const period of periods) row.revenueByYear[period] = null;
const unavailableChart = unavailable.api.comparisonChart('revenue');
assert.match(unavailableChart, /Comparison unavailable/);
assert.equal(chartPoints(unavailableChart).length, 0, 'Wholly missing observations do not fabricate a comparison');
const narrow = create(); narrow.window.innerWidth = 375;
const narrowChart = narrow.api.comparisonChart('revenue');
assert.match(narrowChart, /viewBox="0 0 315 340"/, 'Comparison fits the available narrow viewport');
assert.doesNotMatch(narrowChart, /NaN|Infinity/);

state.category = ['all'];
assert.equal(api.allCategoriesSelected(), true); assert.equal(api.isComparison(), false);
assert.equal(api.scopeLabel(), 'All categories'); assert.equal(api.inCategoryScope('Keyboards'), true);
assert.equal(api.opts().category, 'All'); assert.equal(api.summary().revenue, 94040);
state.category = ['Mice'];
assert.equal(api.isComparison(), false); assert.equal(api.summary().revenue, 40);

console.log('Blueprint chart comparison checks passed: real dashboard renderer, shared trend baseline, equal growth overlays, source-value legends, absolute targets, percentage axes, missing gaps, signed/zero points, stable colors, selected year, combined totals, per-category source details, and immutable input.');
