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
const styleProperties = value => Object.fromEntries(value.split(";").filter(item => item.includes(":")).map(item => { const split = item.indexOf(":"); return [item.slice(0, split).trim(), item.slice(split + 1).trim()]; }));
const classHas = (node, name) => (node.attrs.class || "").split(/\s+/).includes(name);
function parseMarkup(markup) {
  const root = { tag: "root", attrs: {}, children: [], text: "" }, stack = [root];
  for (const match of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*)>|([^<]+)/gi)) {
    if (match[3]) { stack.at(-1).text += match[3]; continue; }
    if (match[0].startsWith("</")) { assert.equal(stack.at(-1).tag, match[1], "Month markup closes the actual structural parent."); stack.pop(); continue; }
    const node = { tag: match[1], attrs: Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])), children: [], text: "", parent: stack.at(-1) };
    node.parent.children.push(node); stack.push(node);
  }
  assert.equal(stack.length, 1, "Month markup has no unclosed containers."); return root;
}
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
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
function assertYearAnchors() {
  const nodes = descendants(parseMarkup(rail.html)), groups = nodes.filter(node => classHas(node, "so-month-year-group"));
  const expectedYears = [...new Set(state.snapshot.periods.map(period => period.date.slice(0, 4)))];
  assert.deepEqual(groups.map(group => group.attrs["data-year"]), expectedYears, "Source months retain ordered calendar-year groups.");
  assert.equal(nodes.filter(node => classHas(node, "so-month-year-label")).length, groups.length);
  const anchors = [];
  for (const group of groups) {
    const year = group.attrs["data-year"], first = state.snapshot.periods.find(period => period.date.startsWith(year)).date.slice(0, 7);
    const headers = descendants(group).filter(node => classHas(node, "so-month-year-label"));
    assert.equal(headers.length, 1, "Each source year has one header.");
    const header = headers[0], label = header.parent, button = label.parent;
    assert.ok(classHas(label, "so-month-label"), "The year header shares the actual month-label positioning parent.");
    assert.equal(button.tag, "button", "The year header lives inside the native first-month button rather than a separately positioned year span.");
    assert.ok(classHas(button, "is-year-anchor"));
    assert.equal(button.attrs["data-month"], first, "First source month is the year anchor even when its band is tiny.");
    assert.equal(header.attrs["data-month-anchor"], first); assert.equal(header.attrs["data-year"], year); assert.equal(header.text, year);
    if (button.attrs["data-year-anchor"] !== undefined) assert.equal(button.attrs["data-year-anchor"], year);
    assert.equal(header.attrs.style, undefined, "Year headings have no independent inline coordinate or width fallback.");
    assert.equal(classHas(header, "is-edge"), false, "Year text never switches to an independent edge anchor.");
    const names = label.children.filter(node => classHas(node, "so-month-name"));
    assert.equal(names.length, 1, "The visible month name and year label are siblings in their shared anchor.");
    assert.equal(names[0].text, new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(`${first}-01T12:00:00Z`)));
    anchors.push({ year, month: first });
  }
  return { groups, anchors };
}
assert.equal(buttons.length, 25, "the rail keeps every source month across three calendar years");
assert.deepEqual(assertYearAnchors().anchors, [{ year: "2024", month: "2024-01" }, { year: "2025", month: "2025-01" }, { year: "2026", month: "2026-01" }]);
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
const yearStarts = assertYearAnchors().groups.map(group => Number(group.attrs["data-start"]));
const boundaries = yearStarts.map(first => { sandbox.paintTimeline(first, first); return parseFloat(elements.get("timelineStart").style.left); });
assert.deepEqual([...rail.html.matchAll(/class="so-month-year-divider" style="left:([^%]+)%"/g)].map(match => Number(match[1])), boundaries.slice(1), "year dividers remain at source boundaries independently of the centered headers");
for (const width of [250, 1000, 1250, 2400]) {
  canvasWidth = width; sandbox.renderTimelineMonths();
  assert.deepEqual(assertYearAnchors().anchors.map(anchor => anchor.month), ["2024-01", "2025-01", "2026-01"], "Canvas scale changes cannot substitute a later month or independent year coordinate.");
  for (const button of buttons) { sandbox.paintTimeline(Number(button.dataset.start), Number(button.dataset.end)); assert.ok(Math.abs(labelX(button) - bracketCenterX()) < 1e-8, "The shared year/month anchor preserves exact weekly bracket projection at every canvas width."); }
}
canvasWidth = 1250; sandbox.renderTimelineMonths();
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
assert.match(byMonth("2024-01").attrs.class, /is-narrow/, "a tiny first partial month remains marked narrow");
assert.match(byMonth("2024-01").attrs.class, /is-year-anchor/, "The narrow January remains the visible year anchor.");
assert.match(byMonth("2024-01").attrs["aria-label"], /January 2024: 1 reported week\b/);
assert.equal(byMonth("2024-01").attrs.title, byMonth("2024-01").attrs["aria-label"], "the tiny native button retains a truthful full title and accessible description");
for (const width of [250, 1000, 1250, 2400]) {
  canvasWidth = width; sandbox.renderTimelineMonths();
  assert.equal(assertYearAnchors().anchors[0].month, "2024-01", "A one-week January never falls back to February when the canvas or zoom scale changes.");
  sandbox.paintTimeline(0, 0); assert.ok(Math.abs(labelX(byMonth("2024-01")) - bracketCenterX()) < 1e-8);
}
const octoberPeriods = Array.from({ length: 105 }, (_, index) => ({ date: new Date(Date.UTC(2024, 9, 27 + index * 7)).toISOString().slice(0, 10) }));
state.snapshot.periods = octoberPeriods; state.timeline = { start: 0, end: 0, limit: 104 }; state.analysis.periods = octoberPeriods;
timelineFull.series = octoberPeriods.map(period => ({ date: period.date, current: 0 }));
for (const width of [250, 1000, 1250, 2400]) {
  canvasWidth = width; sandbox.renderTimelineMonths();
  assert.deepEqual(assertYearAnchors().anchors.map(anchor => anchor.month), ["2024-10", "2025-01", "2026-01"], "A fiscal source starting in October anchors its first year to October without fabricating earlier months.");
}
canvasWidth = 250;
const missingJanuary = Array.from({ length: 8 }, (_, index) => ({ date: new Date(Date.UTC(2026, 0, 4 + index * 7)).toISOString().slice(0, 10) }));
state.snapshot.periods = missingJanuary; state.timeline = { start: 0, end: 0, limit: 7 }; state.analysis.periods = missingJanuary;
timelineFull.series = missingJanuary.map(period => ({ date: period.date, current: period.date.startsWith("2026-01") ? null : 0 }));
sandbox.renderTimelineMonths();
assert.equal(byMonth("2026-01").disabled, true, "An entirely missing January is unavailable even when later months report.");
assert.equal(byMonth("2026-02").disabled, false, "Reported February zeroes remain available.");
assert.deepEqual(assertYearAnchors().anchors, [{ year: "2026", month: "2026-01" }], "The year header stays structurally anchored to disabled January without inheriting the month-name dimming.");
state.snapshot.periods = [{ date: "2026-01-04" }]; state.timeline = { start: 0, end: 0, limit: 0 }; state.analysis.periods = state.snapshot.periods;
timelineFull.series = [{ date: "2026-01-04", current: 0 }]; scroll.scrollLeft = 0;
sandbox.renderTimelineMonths(); sandbox.paintTimeline(0, 0);
assert.equal(buttons.length, 1);
assert.deepEqual(assertYearAnchors().anchors, [{ year: "2026", month: "2026-01" }]);
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
const yearStyles = styleProperties(css.match(/\.so-month-year-label\{([^}]*)\}/)?.[1] || "");
assert.equal(yearStyles.position, "absolute"); assert.equal(parseFloat(yearStyles.left), 0); assert.equal(yearStyles.transform, "none");
assert.match(yearStyles.bottom, /^calc\(100%\s*\+\s*\d+(?:\.\d+)?px\)$/); assert.equal(yearStyles.top, undefined, "Year placement is relative to the shared month-label parent.");
assert.ok(!css.includes(".so-month-year-label.is-edge"));
assert.match(css, /\.so-month-label\{[^}]*left:var\(--month-label,\s*50%\)[^}]*transform:translate\(-50%,\s*-50%\)/);
assert.match(css, /\.so-month\.is-narrow:not\(\.is-year-anchor\) \.so-month-name\{[^}]*visibility:hidden/);
assert.ok(!/\.so-month\.is-narrow \.so-month-label\{[^}]*visibility:hidden/.test(css), "Narrow bands never hide the parent that carries a year heading.");
assert.match(css, /\.so-month-name\{[^}]*pointer-events:auto/, "The visible first-month name can still activate its tiny native band.");
const disabledButtonStyles = styleProperties(css.match(/\.so-timeline-months \.so-month:disabled\{([^}]*)\}/)?.[1] || "");
const disabledNameStyles = styleProperties(css.match(/\.so-timeline-months \.so-month:disabled \.so-month-name\{([^}]*)\}/)?.[1] || "");
assert.equal(Number(disabledButtonStyles.opacity), 1, "Disabled month buttons must not dim their nested year heading.");
assert.equal(Number(disabledNameStyles.opacity), .3, "Only the unavailable month name receives the disabled opacity.");
assert.ok(!/\.so-month:disabled \.so-month-label\{[^}]*opacity/.test(css), "The shared positioning parent must not transmit month-name opacity to the year.");
assert.match(css, /\.so-month:hover:not\(:disabled\)\{background:var\(--color-header\)/);
assert.ok(!css.includes("--color-surface-raised"));
assert.match(css, /\.so-timeline-months \.so-month\{[^}]*position:absolute[^}]*border:0/);
assert.match(css, /:focus-visible/);
assert.match(css, /prefers-reduced-motion/);
console.log("Sellout month checks passed: structurally shared first-source year/month anchors across 250/1000/1250/2400 canvases, exact weekly bracket projection, January retained in tiny/missing bands with year opacity intact, separate boundaries, shared scrolling, fiscal/singleton sources, cutoff clipping, zero/missing distinction and keyboard focus.");
