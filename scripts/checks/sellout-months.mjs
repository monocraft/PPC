import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [source, html, css] = await Promise.all([
  readFile(new URL("../../public/js/sellout-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../../public/analytics.html", import.meta.url), "utf8"),
  readFile(new URL("../../public/css/sellout-months.css", import.meta.url), "utf8"),
]);
const definition = name => {
  const found = source.match(new RegExp(`^  function ${name}\\([^]*?^  \\}`, "m"))?.[0];
  assert.ok(found, `Missing actual dashboard function: ${name}`);
  return found;
};

const periods = Array.from({ length: 105 }, (_, index) => ({ date: new Date(Date.UTC(2024, 0, 7 + index * 7)).toISOString().slice(0, 10) }));
let scope = "common", stopCount = 0, canvasWidth = 1250;
const rangeCalls = [], focusCalls = [], scrollCalls = [];
const buttons = [];
const scroll = {
  clientWidth: 1274, scrollWidth: 1274, scrollLeft: 0,
  getBoundingClientRect() { return { left: 100, width: this.clientWidth }; },
  scrollTo(options) { scrollCalls.push(options); this.scrollLeft = options.left; },
};
const styleProperties = value => Object.fromEntries(value.split(";").filter(Boolean).map(item => item.split(":")));
const rail = {
  getBoundingClientRect() { return { left: 112 - scroll.scrollLeft, width: canvasWidth }; },
  set innerHTML(value) {
    this.html = value;
    buttons.splice(0);
    for (const match of value.matchAll(/<button\b([^>]*)>[\s\S]*?<\/button>/g)) {
      const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]]));
      buttons.push({ dataset: { month: attrs["data-month"], start: attrs["data-start"], end: attrs["data-end"] },
        disabled: /\sdisabled(?:\s|$)/.test(match[1]), attrs,
        setAttribute(name, value) { this.attrs[name] = String(value); },
        focus(options) { focusCalls.push({ month: this.dataset.month, options }); },
        getBoundingClientRect() { const style = styleProperties(this.attrs.style); return { left: rail.getBoundingClientRect().left + parseFloat(style.left) / 100 * canvasWidth, width: parseFloat(style.width) / 100 * canvasWidth }; },
      });
    }
  },
  querySelectorAll() { return buttons; },
  querySelector(selector) { const month = selector.match(/data-month="([^"]+)"/)?.[1]; return buttons.find(button => button.dataset.month === month); },
};
const elements = new Map(["timelineWindow", "timelineStart", "timelineEnd", "timelineDates", "timelineBack", "timelineNext", "timelinePlay", "periodPreset"].map(id => [id, { style: {}, value: "13", setAttribute() {} }]));
elements.set("timelineMonths", rail);
elements.set("timelineScroll", scroll);
const state = { snapshot: { periods }, timeline: { start: 52, end: 54, limit: 54 }, analysis: { periods }, brushing: false };
const timelineFull = { series: periods.map(period => ({ date: period.date, current: period.date.startsWith("2024-07") ? null : 0 })), coverage: { commonEnd: "2025-01-19" } };
const sandbox = { state, timelineFull, Date, Intl, Map, Number,
  $: id => elements.get(id), esc: value => String(value), day: value => value,
  app: { querySelectorAll: () => [] }, filters: () => ({ coverage: scope }),
  stopTimeline() { stopCount++; },
  setTimelineRange(start, end) { rangeCalls.push({ start, end }); state.timeline.start = start; state.timeline.end = end; sandbox.paintTimeline(start, end); sandbox.renderTimelineMonths(); },
};
vm.createContext(sandbox);
vm.runInContext(`${definition("renderTimelineMonths")}\n${definition("paintTimeline")}`, sandbox);
sandbox.renderTimelineMonths();
const byMonth = month => buttons.find(button => button.dataset.month === month);
assert.equal(buttons.length, 25, "the rail keeps every source month across three calendar years");
assert.deepEqual([...rail.html.matchAll(/data-year="(\d{4})"/g)].map(match => match[1]), ["2024", "2025", "2026"], "months group under ordered year headers");
for (const year of ["2024", "2025", "2026"]) assert.match(rail.html, new RegExp(`class="so-month-year-label[^"\\n]*"[^>]*>${year}</span>`), "each year retains a visible header above its first month label");
assert.ok(!rail.html.includes("<small>"), "year headers replace repeated tiny year labels on month buttons");
for (const button of buttons) {
  const original = periods.flatMap((period, index) => period.date.startsWith(button.dataset.month) ? [index] : []);
  const clipped = original.filter(index => index <= state.timeline.limit);
  assert.equal(Number(button.dataset.start), (clipped.length ? clipped : original)[0]);
  assert.equal(Number(button.dataset.end), (clipped.length ? clipped : original).at(-1));
}
const labelX = button => { const style = styleProperties(button.attrs.style), box = button.getBoundingClientRect(); return box.left + parseFloat(style["--month-label"]) / 100 * box.width; };
const bracketCenterX = () => rail.getBoundingClientRect().left + (parseFloat(elements.get("timelineStart").style.left) + parseFloat(elements.get("timelineEnd").style.left)) / 200 * canvasWidth;
for (const button of buttons) {
  sandbox.paintTimeline(Number(button.dataset.start), Number(button.dataset.end));
  assert.ok(Math.abs(labelX(button) - bracketCenterX()) < 1e-8, "every month label shares the actual selection-handle projection, including cutoff-clipped months");
}
sandbox.paintTimeline(52, 54);
assert.equal(scrollCalls.length, 0, "a desktop calendar never independently scrolls its month labels");
const headerPositions = [...rail.html.matchAll(/class="so-month-year-label[^"\n]*" style="left:([^%]+)%"/g)].map(match => Number(match[1]));
const headerMonths = [...rail.html.matchAll(/class="so-month-year-label[^"\n]*"[^>]*data-month-anchor="([^"]+)"/g)].map(match => match[1]);
const yearStarts = [...rail.html.matchAll(/data-year="\d{4}" data-start="(\d+)"/g)].map(match => Number(match[1]));
headerMonths.forEach((month, index) => { assert.ok(Math.abs(rail.getBoundingClientRect().left + headerPositions[index] / 100 * canvasWidth - labelX(byMonth(month))) < 1e-8, "every year header sits at the exact first displayed month-label midpoint, including a cutoff-clipped January"); });
assert.deepEqual(headerMonths, ["2024-01", "2025-01", "2026-01"]);
const boundaries = yearStarts.map(first => { sandbox.paintTimeline(first, first); return parseFloat(elements.get("timelineStart").style.left); });
assert.deepEqual([...rail.html.matchAll(/class="so-month-year-divider" style="left:([^%]+)%"/g)].map(match => Number(match[1])), boundaries.slice(1), "year dividers remain at source boundaries independently of the centered headers");
assert.notEqual(headerPositions[0], boundaries[0], "the first year label is above the first month, rather than the left edge of the year");
sandbox.paintTimeline(52, 54);
assert.equal(byMonth("2024-01").dataset.start, "0");
assert.equal(byMonth("2024-01").dataset.end, "3");
assert.equal(byMonth("2024-01").disabled, false, "reported zero units enable a month");
assert.match(byMonth("2024-01").attrs["aria-label"], /January 2024: 4 reported weeks/);
assert.equal(byMonth("2024-07").disabled, true, "a fully unreported month is distinct from zero units");
assert.equal(byMonth("2025-01").dataset.start, "52");
assert.equal(byMonth("2025-01").dataset.end, "54", "month selection clips to the actual reporting cutoff");
assert.match(byMonth("2025-01").attrs["aria-label"], /January 2025: 3 reported weeks/);
assert.equal(byMonth("2025-01").attrs["aria-pressed"], "true");
assert.equal(byMonth("2025-02").disabled, true, "source columns beyond the current cutoff cannot be selected by month");

sandbox.paintTimeline(52, 53);
assert.ok(buttons.every(button => button.attrs["aria-pressed"] === "false"), "a partial month never appears selected as a complete month");
byMonth("2024-01").onclick();
assert.equal(stopCount, 1, "month selection stops playback");
assert.equal(elements.get("periodPreset").value, "custom");
assert.deepEqual(rangeCalls, [{ start: 0, end: 3 }], "a month click selects original weekly indices without generating dates");
assert.equal(byMonth("2024-01").attrs["aria-pressed"], "true");
assert.equal(focusCalls[0].month, "2024-01", "the chosen month retains keyboard focus after range rendering");
byMonth("2024-07").onclick();
assert.equal(rangeCalls.length, 1, "disabled months cannot change the active range");

timelineFull.coverage.commonEnd = null;
sandbox.renderTimelineMonths();
assert.ok(buttons.every(button => button.disabled), "no shared retailer cutoff leaves all months unavailable in shared scope");
scope = "available"; state.timeline.limit = periods.length - 1;
sandbox.renderTimelineMonths();
assert.equal(byMonth("2025-02").disabled, false, "available reporting scope enables its own reported months");
assert.match(byMonth("2025-02").attrs["aria-label"], /4 reported weeks\b/);
assert.match(byMonth("2026-01").attrs["aria-label"], /1 reported week\b/);

canvasWidth = 1000; scroll.clientWidth = 320; scroll.scrollWidth = 1024; scroll.scrollLeft = 0;
byMonth("2025-04").onclick();
assert.ok(scroll.scrollLeft > 0, "an offscreen month centers its selection in the one shared calendar viewport");
assert.ok(Math.abs(bracketCenterX() - (scroll.getBoundingClientRect().left + scroll.clientWidth / 2)) < 1e-8, "shared scrolling centers the real weekly bracket, not an independently spaced label");
assert.ok(Math.abs(labelX(byMonth("2025-04")) - bracketCenterX()) < 1e-8, "mobile scrolling retains label and selection alignment");
const afterCenter = scrollCalls.length;
sandbox.renderTimelineMonths();
assert.equal(scrollCalls.length, afterCenter, "a visible selection does not cause scroll jitter on repeated renders");
state.timeline.start = 0; state.timeline.end = periods.length - 1;
sandbox.renderTimelineMonths();
const afterWideCenter = scrollCalls.length;
sandbox.renderTimelineMonths();
assert.equal(scrollCalls.length, afterWideCenter, "a range wider than the viewport does not repeatedly issue the same centered scroll");
byMonth("2024-01").onclick();
assert.equal(scroll.scrollLeft, 0, "the first month clips shared scrolling to the beginning of the calendar");

const partialPeriods = Array.from({ length: 105 }, (_, index) => ({ date: new Date(Date.UTC(2024, 0, 28 + index * 7)).toISOString().slice(0, 10) }));
state.snapshot.periods = partialPeriods; state.timeline = { start: 0, end: 0, limit: 104 }; state.analysis.periods = partialPeriods;
timelineFull.series = partialPeriods.map(period => ({ date: period.date, current: 0 }));
sandbox.renderTimelineMonths();
assert.match(byMonth("2024-01").attrs.class, /is-narrow/, "a tiny first partial month hides only its visual label");
assert.match(byMonth("2024-01").attrs["aria-label"], /January 2024: 1 reported week\b/);
assert.equal(byMonth("2024-01").attrs.title, byMonth("2024-01").attrs["aria-label"], "the tiny native button retains a truthful full title and accessible description");
const partialHeader = rail.html.match(/class="so-month-year-label[^"\n]*" style="left:([^%]+)%" data-month-anchor="([^"]+)"/);
assert.equal(partialHeader[2], "2024-02", "a hidden tiny first partial month makes the year header align with the first displayed February label");
assert.ok(Math.abs(rail.getBoundingClientRect().left + Number(partialHeader[1]) / 100 * canvasWidth - labelX(byMonth("2024-02"))) < 1e-8);
state.snapshot.periods = [{ date: "2026-01-04" }]; state.timeline = { start: 0, end: 0, limit: 0 }; state.analysis.periods = state.snapshot.periods;
timelineFull.series = [{ date: "2026-01-04", current: 0 }]; scroll.scrollLeft = 0;
sandbox.renderTimelineMonths(); sandbox.paintTimeline(0, 0);
assert.equal(buttons.length, 1);
assert.ok(Math.abs(labelX(buttons[0]) - bracketCenterX()) < 1e-8, "a singleton week has a centered month label and finite full-band selection");
assert.ok(!/NaN|Infinity/.test(rail.html));

assert.match(html, /href="css\/sellout-months\.css"/);
assert.ok(html.indexOf('id="timelineTrack"') < html.indexOf('id="timelineMonths"') && html.indexOf('id="timelineMonths"') < html.indexOf('class="so-time-caption"'), "the month rail sits directly beneath the timeline");
const calendar = html.match(/<div id="timelineScroll"[^>]*><div class="so-calendar-canvas">([\s\S]*?)<div class="so-time-caption">/)?.[1];
assert.ok(calendar?.includes('id="timelineTrack"') && calendar.includes('id="timelineMonths"'), "track and month labels share one scrolling calendar canvas");
assert.match(css, /\.so-calendar-scroll\{[^}]*overflow-x:auto/);
assert.match(css, /\.so-timeline-months\{[^}]*position:relative[^}]*width:100%[^}]*overflow:visible/);
assert.match(css, /\.so-calendar-canvas\{min-width:1000px/);
assert.ok(!/flex-basis:|flex:0 0 \d+px|position:sticky/.test(css), "month geometry has no fixed-width or independent sticky layout");
assert.match(css, /\.so-month-year-divider\{[^}]*position:absolute/);
assert.match(css, /\.so-month-year-label\{[^}]*font-size:12px/);
assert.match(css, /\.so-month-year-label\{[^}]*transform:translateX\(-50%\)/);
assert.match(css, /\.so-month:hover:not\(:disabled\)\{background:var\(--color-header\)/);
assert.ok(!css.includes("--color-surface-raised"));
assert.match(css, /\.so-timeline-months \.so-month\{[^}]*position:absolute[^}]*border:0/);
assert.match(css, /:focus-visible/);
assert.match(css, /prefers-reduced-motion/);
console.log("Sellout month checks passed: exact month/bracket projection, years centered over first displayed month, separate boundary dividers, shared desktop/mobile scrolling, tiny partial/singleton months, cutoff clipping, zero/missing distinction and keyboard focus.");
