(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const TRACE_HEIGHT = 156, TRACE_TOP = 12, TRACE_BOTTOM = 132;
  const yearName = value => /^FY/i.test(String(value)) ? String(value) : `FY${String(value).slice(-2)}`;
  const numeric = value => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value)) ? Number(value) : null;
  const money = value => {
    if (value === null) return 'No revenue value';
    const abs = Math.abs(value), prefix = value < 0 ? '−$' : '$';
    return prefix + (abs >= 1e9 ? `${(abs / 1e9).toFixed(2)}B` : abs >= 1e6 ? `${(abs / 1e6).toFixed(2)}M` : abs >= 1e3 ? `${(abs / 1e3).toFixed(1)}K` : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(abs));
  };
  const exactMoney = value => value === null ? 'No revenue value' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  const comparisonPalette = ['#a98aff', '#4fd4de', '#f6bc70', '#79d6ac', '#ed91ba', '#aab9ee'];
  const comparisonColor = category => {
    let hash = 0;
    for (const character of String(category)) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
    return comparisonPalette[hash % comparisonPalette.length];
  };
  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function mount(container, initial = {}) {
    if (!container) throw new Error('A timeline container is required.');
    let config = {}, periods = [], values = [], kinds = [], comparisons = [], comparisonScale = 'trend', comparisonModel = null, indexed = false, selectedIndex = 0, signature = '', buttons = [], playing = false, timer = null, dragId = null, destroyed = false;
    const lifetime = new AbortController();
    const listen = (element, event, action) => element.addEventListener(event, action, { signal: lifetime.signal });
    const root = make('section', 'hx-timeline');
    root.setAttribute('aria-label', 'Interactive planning year timeline');
    const header = make('div', 'hx-timeline-header'), heading = make('div', 'hx-timeline-heading'), kicker = make('span', 'hx-timeline-kicker', 'PLANNING TIMELINE');
    const selection = make('div', 'hx-timeline-selection'), year = make('strong', 'hx-timeline-current'), status = make('span', 'hx-timeline-status');
    selection.append(year, status); heading.append(kicker, selection);
    const controls = make('div', 'hx-timeline-controls');
    const back = make('button', 'hx-timeline-step', '←'), play = make('button', 'hx-timeline-play', '▶ Play'), next = make('button', 'hx-timeline-step', '→');
    [back, play, next].forEach(button => { button.type = 'button'; });
    back.setAttribute('aria-label', 'Previous planning year'); next.setAttribute('aria-label', 'Next planning year'); play.setAttribute('aria-pressed', 'false');
    controls.append(back, play, next); header.append(heading, controls);
    const caption = make('div', 'hx-timeline-caption'), revenue = make('span', 'hx-timeline-revenue'), legend = make('div', 'hx-timeline-legend');
    legend.innerHTML = '<span><i class="hx-timeline-history-key"></i>History / actual</span><span><i class="hx-timeline-plan-key"></i>Workbook plan</span>';
    caption.append(revenue, legend);
    const scaleRow = make('div', 'hx-timeline-scale-row'), scaleLabel = make('span', 'hx-timeline-scale-label'), scaleControls = make('div', 'hx-timeline-scale-controls');
    scaleControls.setAttribute('role', 'group'); scaleControls.setAttribute('aria-label', 'Category comparison scale');
    const scaleButtons = ['trend', 'values'].map(mode => {
      const button = make('button', 'hx-timeline-scale-button', mode === 'trend' ? 'Trend' : 'Values'); button.type = 'button'; button.dataset.scale = mode;
      button.title = mode === 'trend' ? 'Compare category growth from a shared base year' : 'Compare reported revenue in USD'; scaleControls.append(button);
      listen(button, 'click', () => { if (mode === comparisonScale) return; stop(); config.comparisonScale = mode; config.onScaleChange?.(mode); update(); });
      return button;
    });
    scaleRow.append(scaleLabel, scaleControls); scaleRow.hidden = true;
    const scaleReason = make('p', 'hx-timeline-scale-reason'); scaleReason.hidden = true;
    const comparisonLegend = make('div', 'hx-timeline-comparisons');
    comparisonLegend.setAttribute('role', 'list'); comparisonLegend.setAttribute('aria-label', 'Category revenue at the selected planning year'); comparisonLegend.hidden = true;
    const track = make('div', 'hx-timeline-track');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 1000 ${TRACE_HEIGHT}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('hx-timeline-trace');
    const band = make('div', 'hx-timeline-band'), marker = make('div', 'hx-timeline-marker'), point = make('span', 'hx-timeline-point'), comparisonPoints = make('div', 'hx-timeline-comparison-points'), handle = make('div', 'hx-timeline-handle');
    handle.tabIndex = 0; handle.setAttribute('role', 'slider'); handle.setAttribute('aria-label', 'Planning year'); handle.setAttribute('aria-orientation', 'horizontal');
    handle.append(make('span', 'hx-timeline-grip')); marker.append(point, comparisonPoints); track.append(svg, band, marker, handle);
    const years = make('div', 'hx-timeline-years'); years.setAttribute('role', 'group'); years.setAttribute('aria-label', 'Choose a fiscal year');
    const hint = make('span', 'hx-timeline-hint', 'Drag the marker or choose a year');
    const live = make('span', 'hx-timeline-live'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
    root.append(header, caption, scaleRow, scaleReason, comparisonLegend, track, years, hint, live); container.append(root);
    function kindFor(period, index, record) {
      const definition = Array.isArray(config.labels) ? config.labels[index] : config.labels?.[period];
      const configuredKind = typeof definition === 'object' ? definition?.status ?? definition?.kind : null;
      const label = String(configuredKind ?? record?.kind ?? record?.type ?? (typeof definition === 'object' ? definition?.label : definition) ?? '');
      const displayLabel = typeof definition === 'object' ? definition?.label : null;
      if (/unclassified|unknown|reported/i.test(label)) return { short: 'Unclassified', label: displayLabel || record?.basis || 'Tracker reported · actual/plan unclassified', plan: false, unclassified: true };
      if (/proj|plan|forecast|fcst/i.test(label)) return { short: 'Plan', label: displayLabel || record?.basis || 'Workbook projection', plan: true };
      if (/actual/i.test(label)) return { short: 'Actual', label: displayLabel || record?.basis || 'Source-labelled actual', plan: false };
      if (/history|historic/i.test(label)) return { short: 'History', label: displayLabel || record?.basis || 'Source history', plan: false };
      const n = Number(String(period).replace(/[^\d]/g, '')), year = n < 100 ? n + 2000 : n;
      return year === 2025 ? { short: 'Actual', label: 'Source-labelled actual', plan: false } : year > 2025 ? { short: 'Plan', label: 'Workbook projection', plan: true } : { short: 'History', label: 'Source history', plan: false };
    }
    const position = index => periods.length ? (index + .5) / periods.length * 100 : 50;
    let yPositions = [];
    function drawTrace() {
      const traces = comparisons.length ? comparisons : [{ values, kinds }];
      const valid = traces.flatMap(trace => trace.values).filter(value => value !== null), min = Math.min(0, ...valid), max = Math.max(indexed ? 100 : 0, ...valid), span = max - min || 1;
      const y = value => TRACE_TOP + (max - value) / span * (TRACE_BOTTOM - TRACE_TOP);
      yPositions = values.map(value => value === null ? null : y(value));
      svg.replaceChildren();
      const add = (tag, attributes) => { const node = document.createElementNS(NS, tag); Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value))); svg.append(node); return node; };
      add('line', { x1: 0, x2: 1000, y1: y(0), y2: y(0), class: 'hx-timeline-zero' });
      if (indexed) add('line', { x1: 0, x2: 1000, y1: y(100), y2: y(100), class: 'hx-timeline-base', 'data-value': '100', 'vector-effect': 'non-scaling-stroke' });
      traces.forEach(trace => {
        trace.yPositions = trace.values.map(value => value === null ? null : y(value));
        const colorize = node => { if (trace.category !== undefined) { node.dataset.category = trace.category; node.style.setProperty('--hx-series-color', trace.color); } };
        for (let i = 1; i < periods.length; i++) {
          if (trace.values[i] === null || trace.values[i - 1] === null) continue;
          colorize(add('path', { d: `M${position(i - 1) * 10} ${y(trace.values[i - 1])}L${position(i) * 10} ${y(trace.values[i])}`, class: `hx-timeline-segment${trace.kinds[i].plan ? ' is-plan' : ''}${trace.kinds[i].unclassified || trace.kinds[i - 1].unclassified ? ' is-unclassified' : ''}${comparisons.length ? ' is-comparison' : ''}`, 'vector-effect': 'non-scaling-stroke' }));
        }
        trace.values.forEach((value, i) => {
          if (value === null) return;
          colorize(add('circle', { cx: position(i) * 10, cy: y(value), r: comparisons.length ? 2.8 : 2.2, class: `hx-timeline-node${trace.kinds[i].plan ? ' is-plan' : ''}${trace.kinds[i].unclassified ? ' is-unclassified' : ''}${comparisons.length ? ' is-comparison' : ''}`, 'vector-effect': 'non-scaling-stroke' }));
        });
      });
      track.classList.toggle('is-empty', !valid.length);
      root.classList.toggle('is-comparing', comparisons.length > 0);
    }
    const comparisonReadout = index => comparisons.map(trace => `${trace.label}: ${exactMoney(trace.rawValues[index])} (${trace.kinds[index].label}${indexed && trace.values[index] !== null ? `; index ${trace.values[index].toFixed(1)}` : ''})`).join('; ');
    function paint() {
      const period = periods[selectedIndex], kind = kinds[selectedIndex];
      root.hidden = !periods.length;
      if (!periods.length) return;
      const label = `${yearName(period)} · ${kind.label} · ${comparisons.length ? `Selected total revenue ${exactMoney(values[selectedIndex])} · ${comparisonReadout(selectedIndex)}` : `Revenue ${exactMoney(values[selectedIndex])}`}`;
      year.textContent = yearName(period); status.textContent = kind.label; status.dataset.kind = kind.plan ? 'plan' : kind.short.toLowerCase();
      revenue.textContent = comparisons.length ? `Selected total ${money(values[selectedIndex])} · ${comparisons.length} ${comparisons.length === 1 ? 'category' : 'categories'}` : `Revenue ${money(values[selectedIndex])}`;
      revenue.title = comparisons.length ? `Selected total revenue ${exactMoney(values[selectedIndex])}; ${comparisonReadout(selectedIndex)}` : exactMoney(values[selectedIndex]);
      const allKinds = comparisons.length ? comparisons.flatMap(trace => trace.kinds) : kinds;
      legend.innerHTML = `${allKinds.some(item => !item.plan && !item.unclassified) ? '<span><i class="hx-timeline-history-key"></i>History / actual</span>' : ''}${allKinds.some(item => item.plan) ? '<span><i class="hx-timeline-plan-key"></i>Workbook plan</span>' : ''}${allKinds.some(item => item.unclassified) ? '<span><i class="hx-timeline-unclassified-key"></i>Reported, basis unclassified</span>' : ''}`;
      scaleRow.hidden = !comparisons.length;
      scaleLabel.textContent = indexed ? `Trend index · ${yearName(comparisonModel.basePeriod)} = 100` : 'Revenue · USD';
      scaleButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scale === comparisonScale)));
      const reason = comparisons.length && comparisonScale === 'trend' && !indexed ? String(comparisonModel?.reason || 'Indexed comparison is unavailable for this selection. Showing revenue values.') : '';
      scaleReason.textContent = reason; scaleReason.hidden = !reason;
      comparisonLegend.hidden = !comparisons.length; comparisonLegend.replaceChildren(); comparisonPoints.replaceChildren();
      comparisons.forEach(trace => {
        const item = make('div', 'hx-timeline-comparison'), key = make('i', 'hx-timeline-comparison-key'), name = make('span', 'hx-timeline-comparison-name', trace.label), value = make('strong', 'hx-timeline-comparison-value', money(trace.rawValues[selectedIndex])), basis = make('span', 'hx-timeline-comparison-basis', `${trace.kinds[selectedIndex].short}${indexed && trace.values[selectedIndex] !== null ? ` · Index ${trace.values[selectedIndex].toFixed(1)}` : ''}`);
        item.setAttribute('role', 'listitem'); item.dataset.category = trace.category; item.dataset.kind = trace.kinds[selectedIndex].unclassified ? 'unclassified' : trace.kinds[selectedIndex].plan ? 'plan' : 'actual'; item.style.setProperty('--hx-series-color', trace.color);
        item.title = `${trace.label} · ${yearName(period)} · ${exactMoney(trace.rawValues[selectedIndex])} · ${trace.kinds[selectedIndex].label}${indexed && trace.values[selectedIndex] !== null ? ` · Index ${trace.values[selectedIndex].toFixed(1)}` : ''}`;
        item.setAttribute('aria-label', item.title); key.setAttribute('aria-hidden', 'true'); item.append(key, name, value, basis); comparisonLegend.append(item);
        if (trace.values[selectedIndex] !== null) {
          const dot = make('span', 'hx-timeline-comparison-point'); dot.dataset.category = trace.category; dot.style.setProperty('--hx-series-color', trace.color); dot.style.top = `${trace.yPositions[selectedIndex] / TRACE_HEIGHT * 100}%`; comparisonPoints.append(dot);
        }
      });
      const left = `${position(selectedIndex)}%`;
      [marker, handle].forEach(element => { element.style.left = left; });
      band.style.left = `${selectedIndex / periods.length * 100}%`; band.style.width = `${100 / periods.length}%`;
      point.hidden = comparisons.length > 0 || values[selectedIndex] === null; point.style.top = `${(yPositions[selectedIndex] ?? 0) / TRACE_HEIGHT * 100}%`;
      handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', String(periods.length - 1)); handle.setAttribute('aria-valuenow', String(selectedIndex)); handle.setAttribute('aria-valuetext', label);
      buttons.forEach((button, index) => { const detail = comparisons.length ? `${kinds[index].label}, selected total revenue ${exactMoney(values[index])}; ${comparisonReadout(index)}` : `${kinds[index].label}, revenue ${exactMoney(values[index])}`; button.setAttribute('aria-pressed', String(index === selectedIndex)); button.setAttribute('aria-label', `${yearName(periods[index])}, ${detail}`); button.title = `${yearName(periods[index])} · ${detail}`; button.lastElementChild.textContent = kinds[index].short; });
      back.disabled = selectedIndex === 0; next.disabled = selectedIndex === periods.length - 1; play.disabled = periods.length < 2 || (!playing && selectedIndex === periods.length - 1);
      play.textContent = playing ? 'Ⅱ Pause' : '▶ Play'; play.setAttribute('aria-pressed', String(playing)); play.setAttribute('aria-label', playing ? 'Pause timeline playback' : 'Play planning years once');
      live.textContent = label;
    }
    function stop() { clearTimeout(timer); timer = null; playing = false; paint(); }
    function choose(index, origin) {
      if (destroyed || !periods.length) return;
      if (origin !== 'play') stop();
      const nextIndex = Math.max(0, Math.min(periods.length - 1, Math.round(index)));
      if (nextIndex === selectedIndex) return;
      selectedIndex = nextIndex; config.selected = periods[selectedIndex]; paint();
      config.onChange?.(periods[selectedIndex], { origin });
    }
    function playYears() {
      if (playing) return stop();
      if (selectedIndex >= periods.length - 1 || periods.length < 2) return;
      playing = true; paint();
      const tick = () => {
        timer = null;
        if (!playing || destroyed) return;
        if (selectedIndex >= periods.length - 1) return stop();
        choose(selectedIndex + 1, 'play');
        if (selectedIndex >= periods.length - 1) return stop();
        if (playing) timer = setTimeout(tick, 1100);
      };
      timer = setTimeout(tick, 1100);
    }
    function releaseDrag() {
      if (dragId !== null && track.hasPointerCapture(dragId)) track.releasePointerCapture(dragId);
      dragId = null; root.classList.remove('is-dragging');
    }
    const indexAt = clientX => { const rect = track.getBoundingClientRect(); return Math.max(0, Math.min(periods.length - 1, Math.round((clientX - rect.left) / Math.max(1, rect.width) * periods.length - .5))); };
    listen(back, 'click', () => choose(selectedIndex - 1, 'step')); listen(next, 'click', () => choose(selectedIndex + 1, 'step')); listen(play, 'click', playYears);
    listen(track, 'pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false || !periods.length || dragId !== null) return;
      event.preventDefault(); stop(); dragId = event.pointerId; root.classList.add('is-dragging'); track.setPointerCapture(dragId); handle.focus({ preventScroll: true }); choose(indexAt(event.clientX), 'timeline');
    });
    listen(track, 'pointermove', event => { if (dragId === event.pointerId) { event.preventDefault(); choose(indexAt(event.clientX), 'timeline'); } });
    listen(track, 'pointerup', event => { if (dragId === event.pointerId) { choose(indexAt(event.clientX), 'timeline'); releaseDrag(); } });
    listen(track, 'pointercancel', releaseDrag); listen(track, 'lostpointercapture', () => { dragId = null; root.classList.remove('is-dragging'); });
    listen(handle, 'keydown', event => {
      const delta = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : 0;
      if (!delta && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault(); choose(event.key === 'Home' ? 0 : event.key === 'End' ? periods.length - 1 : selectedIndex + delta, 'keyboard');
    });
    function update(patch = {}) {
      if (destroyed) return;
      config = { ...config, ...patch };
      const previous = periods[selectedIndex];
      periods = (config.periods || []).map(period => period && typeof period === 'object' ? period.period ?? period.year ?? period.id : period).filter(period => period !== null && period !== undefined);
      const nextSignature = JSON.stringify(periods);
      if (signature !== nextSignature) {
        releaseDrag(); clearTimeout(timer); timer = null; playing = false; signature = nextSignature;
        years.replaceChildren(); buttons = periods.map((period, index) => {
          const button = make('button', 'hx-timeline-year'); button.type = 'button'; button.dataset.period = period; button.append(make('strong', '', yearName(period)), make('span', '', ''));
          button.addEventListener('click', () => choose(index, 'year'), { signal: lifetime.signal }); years.append(button); return button;
        }); years.style.gridTemplateColumns = `repeat(${Math.max(1, periods.length)}, minmax(0,1fr))`;
      }
      const matchRecords = records => periods.map((period, index) => Array.isArray(records) ? records.find(record => record && typeof record === 'object' && String(record.period ?? record.year ?? record.id) === String(period)) ?? (typeof records[index] !== 'object' ? { value: records[index] } : null) : { value: records[period] });
      const matched = matchRecords(config.series || []);
      values = matched.map(record => numeric(record?.value ?? record?.revenue ?? record?.total ?? record?.amount)); kinds = periods.map((period, index) => kindFor(period, index, matched[index]));
      comparisons = (Array.isArray(config.comparisonSeries) ? config.comparisonSeries : []).filter(trace => trace && trace.category !== null && trace.category !== undefined).map(trace => {
        const records = matchRecords(trace.series || []), category = String(trace.category);
        return { category, label: String(trace.label ?? category), color: trace.color || comparisonColor(category), values: records.map(record => numeric(record?.value ?? record?.revenue ?? record?.total ?? record?.amount)), rawValues: records.map(record => numeric(record && Object.hasOwn(record, 'rawValue') ? record.rawValue : record?.value ?? record?.revenue ?? record?.total ?? record?.amount)), kinds: periods.map((period, index) => kindFor(period, index, records[index])) };
      });
      comparisonModel = config.comparisonModel && typeof config.comparisonModel === 'object' ? config.comparisonModel : null;
      comparisonScale = config.comparisonScale === 'values' || (!config.comparisonScale && comparisonModel?.mode === 'values') ? 'values' : 'trend';
      if (comparisonScale === 'values') comparisons.forEach(trace => { trace.values = [...trace.rawValues]; });
      indexed = comparisons.length > 0 && comparisonScale === 'trend' && comparisonModel?.indexed === true;
      const chosen = config.selected ?? previous ?? periods[0], found = periods.findIndex(period => String(period) === String(chosen)); selectedIndex = found < 0 ? 0 : found;
      drawTrace(); paint();
      if (playing && selectedIndex >= periods.length - 1) stop();
    }
    update(initial);
    return { update, stop, destroy() { if (destroyed) return; stop(); releaseDrag(); lifetime.abort(); root.remove(); destroyed = true; } };
  }
  window.HX_TIMELINE = { mount };
})();
