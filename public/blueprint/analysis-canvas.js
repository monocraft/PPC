(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const DISPLAY_CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const DISPLAY_NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const AXIS_NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const AXIS_COMPACT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const PALETTE = ['#895EF6', '#20CBDD', '#7AE3A9', '#FFC63B', '#6984ED', '#ED91BA', '#4DA1F7'];
  let canvasSequence = 0;
  const METRICS = {
    revenue: { label: 'Revenue', dash: '', marker: 'circle' },
    grossprofit: { label: 'Gross profit', dash: '9 4', marker: 'square' },
    units: { label: 'Units', dash: '12 4 2 4', marker: 'triangle' },
    budget: { label: 'PD investment', dash: '2 5', marker: 'diamond' },
    investment: { label: 'PD investment', dash: '2 5', marker: 'diamond' },
    pdinvestment: { label: 'PD investment', dash: '2 5', marker: 'diamond' }
  };
  const number = value => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value)) ? Number(value) : null;
  const key = value => String(value);
  const periodName = value => /^\d{4}$/.test(String(value)) ? `FY${String(value).slice(-2)}` : String(value);
  const metricStyle = metric => METRICS[String(metric || '').replace(/[\s_-]/g, '').toLowerCase()] || { label: String(metric || 'Value'), dash: '', marker: 'circle' };
  const colorFor = value => { let hash = 0; for (const character of String(value)) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0; return PALETTE[hash % PALETTE.length]; };
  const safeColor = (color, fallback) => /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(String(color || '')) ? String(color) : colorFor(fallback);
  function unitFor(unit, metric) {
    const supplied = String(unit || '').toLowerCase();
    if (/^(usd|currency|dollars?|\$|money)$/.test(supplied)) return 'currency';
    if (/^(units?|count|quantity|number)$/.test(supplied)) return 'units';
    if (!supplied) return metricStyle(metric).label === 'Units' ? 'units' : 'currency';
    return String(unit);
  }
  function statusFor(kind, scenario) {
    if (scenario) return 'Scenario';
    const value = String(kind || '').toLowerCase();
    if (/^(actual|actuals|earned)$/.test(value)) return 'Actual';
    if (/^(history|historical)$/.test(value)) return 'History';
    if (/projection|forecast|estimate|plan/.test(value) && !/unclassified|unverified|unknown/.test(value)) return 'Plan';
    return /source[- ]investment/.test(value) ? 'Source investment · status unverified' : 'Unclassified';
  }
  function exact(value, unit) {
    if (value === null) return 'Unavailable';
    return (unit === 'currency' ? DISPLAY_CURRENCY : DISPLAY_NUMBER).format(value) + (unit === 'units' ? ' units' : unit && unit !== 'currency' ? ` ${unit}` : '');
  }
  function compact(value, unit) {
    const absolute = Math.abs(value), magnitude = absolute >= 1e9 ? 1e9 : absolute >= 1e6 ? 1e6 : absolute >= 1e3 ? 1e3 : 1;
    const suffix = magnitude === 1e9 ? 'B' : magnitude === 1e6 ? 'M' : magnitude === 1e3 ? 'K' : '';
    return `${value < 0 ? '−' : ''}${unit === 'currency' ? '$' : ''}${(magnitude === 1 ? AXIS_NUMBER : AXIS_COMPACT).format(absolute / magnitude)}${suffix}`;
  }
  function axisDomain(values) {
    const finite = values.filter(value => value !== null);
    let low = Math.min(0, ...finite), high = Math.max(0, ...finite);
    if (low === high) high = low === 0 ? 1 : low + Math.abs(low) * .1;
    const range = high - low, rough = range / 4, power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].find(value => value * power >= rough) * power;
    low = Math.floor(low / step) * step; high = Math.ceil(high / step) * step;
    const ticks = [];
    for (let index = 0; index <= 12 && low + step * index <= high + step / 100; index++) ticks.push(Number((low + step * index).toPrecision(13)));
    return { min: low, max: high, ticks };
  }

  // A pure model boundary: all indexing is calculated here from source values.
  // Every line uses the SAME positive baseline period, with no missing-value fill.
  function prepare(model = {}) {
    const periods = [], seenPeriods = new Set(), warnings = [];
    const addPeriod = period => {
      if (typeof period !== 'number' && typeof period !== 'string') return;
      if (!String(period).trim() || typeof period === 'number' && !Number.isFinite(period)) return;
      if (!seenPeriods.has(key(period))) { seenPeriods.add(key(period)); periods.push(period); }
    };
    (Array.isArray(model.periods) ? model.periods : []).forEach(addPeriod);
    const inputs = Array.isArray(model.series) ? model.series : [];
    for (const trace of inputs) for (const point of Array.isArray(trace.points) ? trace.points : []) addPeriod(point.period);
    if (periods.every(period => number(period) !== null)) periods.sort((a, b) => Number(a) - Number(b));
    else if (!Array.isArray(model.periods) || !model.periods.length) periods.sort((a, b) => String(a).localeCompare(String(b)));
    const ids = new Set();
    const series = inputs.map((trace, index) => {
      const id = String(trace.id ?? `trace-${index + 1}`), points = new Map(), duplicates = new Set();
      if (ids.has(id)) warnings.push(`Trace identifier “${id}” is repeated; source identities should be unique.`);
      ids.add(id);
      for (const point of Array.isArray(trace.points) ? trace.points : []) {
        const periodKey = key(point.period);
        if (points.has(periodKey)) duplicates.add(periodKey);
        points.set(periodKey, point);
      }
      if (duplicates.size) warnings.push(`${trace.name || id} contains repeated periods; those values are unavailable until the source is disambiguated.`);
      const unit = unitFor(trace.unit, trace.metric), style = metricStyle(trace.metric);
      return {
        ...trace, id, key: `${id}::${index}`, name: String(trace.name || id), unit, style,
        color: safeColor(trace.color, trace.entityId || trace.name || id), scenario: Boolean(trace.scenario),
        points: periods.map(period => {
          const original = points.get(key(period));
          const rawValue = !original || duplicates.has(key(period)) ? null : number(Object.prototype.hasOwnProperty.call(original, 'rawValue') ? original.rawValue : original.value);
          return { ...original, period, rawValue, value: rawValue, kind: original?.kind || 'unclassified', status: statusFor(original?.kind, trace.scenario) };
        })
      };
    });
    const requestedScale = model.scale === 'trend' ? 'trend' : 'values';
    // Modeled outcomes and annual plans are overlays of reported source series.
    // They neither choose the base period nor normalize against their own value.
    const sources = series.filter(trace => !trace.scenario && !trace.estimate), overlaySources = new Map();
    const hasObservation = trace => trace.points.some(point => point.rawValue !== null);
    const observedSources = sources.filter(hasObservation), unavailableSources = sources.filter(trace => !hasObservation(trace));
    if (unavailableSources.length) {
      const measures = [...new Set(unavailableSources.map(trace => trace.style.label))].join(', ');
      warnings.push(`${unavailableSources.length} entirely unavailable source ${unavailableSources.length === 1 ? 'series remains' : 'series remain'} in the legend as Unavailable (${measures}) and ${unavailableSources.length === 1 ? 'does' : 'do'} not constrain the Trend baseline. Missing values are not zero.`);
    }
    for (const trace of series.filter(trace => trace.scenario || trace.estimate)) {
      const entityId = trace.estimate ? trace.reportedEntityId : trace.entityId;
      const matches = entityId === undefined || entityId === null ? [] : sources.filter(source => source.entityId === entityId && source.metric === trace.metric && source.unit === trace.unit);
      if (matches.length === 1) overlaySources.set(trace.key, matches[0]);
    }
    const baseIndex = observedSources.length ? periods.findIndex((_, index) => observedSources.every(trace => trace.points[index].rawValue !== null && trace.points[index].rawValue > 0)) : -1;
    const observedOverlays = series.filter(trace => (trace.scenario || trace.estimate) && hasObservation(trace));
    const unmatchedOverlay = observedOverlays.some(trace => !overlaySources.has(trace.key));
    const invalidOverlayBase = baseIndex >= 0 && observedOverlays.some(trace => {
      const value = overlaySources.get(trace.key)?.points[baseIndex].rawValue;
      return value === undefined || value === null || value <= 0;
    });
    const canIndex = baseIndex >= 0 && !unmatchedOverlay && !invalidOverlayBase;
    const units = [...new Set(series.map(trace => trace.unit))];
    const valuesCompatible = units.length <= 1 || units.length === 2 && units.includes('currency') && units.includes('units');
    let scale = requestedScale, reason = '', supported = true;
    if (scale === 'trend' && !canIndex) {
      scale = 'values';
      reason = unmatchedOverlay ? 'A scenario or annual plan has no unique matching source baseline for its entity and measure. Values are shown without indexing.' : invalidOverlayBase ? 'A scenario or annual plan has no positive matching source baseline at the shared fiscal year. Values are shown without indexing.' : 'No common fiscal year has a positive value for every selected source series with observations. Values are shown without indexing.';
    }
    if (scale === 'values' && !valuesCompatible) {
      if (canIndex) { scale = 'trend'; reason = 'These units cannot share a Values axis. A common trend index is shown.'; }
      else { supported = false; reason = 'These units cannot share a Values axis, and no common positive baseline is available. Choose currency and units, or a single unit. Exact source values remain above.'; }
    }
    const indexed = scale === 'trend', basePeriod = indexed ? periods[baseIndex] : null;
    for (const trace of series) {
      trace.axis = indexed ? 'index' : trace.unit;
      trace.baseValue = indexed ? (overlaySources.get(trace.key) || trace).points[baseIndex].rawValue : null;
      if (indexed) for (const point of trace.points) point.value = point.rawValue === null || trace.baseValue === null || trace.baseValue <= 0 ? null : point.rawValue / trace.baseValue * 100;
    }
    const axisUnits = supported ? indexed ? ['index'] : units : [];
    const axes = axisUnits.map((unit, index) => ({
      id: unit, unit, side: unit === 'units' && units.includes('currency') && !indexed ? 'right' : 'left',
      label: unit === 'index' ? `Trend index · ${periodName(basePeriod)} = 100` : unit === 'currency' ? 'USD' : unit === 'units' ? 'Units' : unit,
      ...axisDomain(series.filter(trace => trace.axis === unit).flatMap(trace => trace.points.map(point => point.value)).concat(indexed ? [100] : []))
    }));
    const selectedIndex = Math.max(0, periods.findIndex(period => key(period) === key(model.period)) >= 0 ? periods.findIndex(period => key(period) === key(model.period)) : periods.length - 1);
    const comparisonInputs=model.comparison?.entities,comparisonIds=new Set();let comparison=null;
    if(Array.isArray(comparisonInputs)&&comparisonInputs.length>=2&&comparisonInputs.length<=50&&comparisonInputs.every(entity=>typeof entity?.id==='string'&&entity.id&&entity.id.length<=240&&!comparisonIds.has(entity.id)&&(comparisonIds.add(entity.id),true))){
      const sourcePoints=points=>(Array.isArray(points)?points:[]).filter(point=>point&&['number','string'].includes(typeof point.period)).map(point=>({period:point.period,value:number(Object.prototype.hasOwnProperty.call(point,'rawValue')?point.rawValue:point.value)}));
      comparison={entities:comparisonInputs.map(entity=>({id:entity.id,name:String(entity.name||entity.id),revenuePoints:sourcePoints(entity.revenuePoints),unitsPoints:sourcePoints(entity.unitsPoints)}))};
    }
    return { periods, period: periods[selectedIndex] ?? null, selectedIndex, series, axes, scale, requestedScale, indexed, basePeriod, reason, warnings, supported,comparison };
  }

  function create(container, options = {}) {
    if (!container || typeof container.appendChild !== 'function') throw new Error('An analysis chart container is required.');
    const doc = container.ownerDocument || document, view = doc.defaultView || window;
    const lifetime = new AbortController(), state = { model: prepare(), width: 0, selected: 0, preview: 0, activeTraceKey: null, activeTracePeriod: null, pinnedPoint: null, headerFocus: false, labelsVisible: false, drag: null, destroyed: false };
    const node = (tag, className, text) => { const element = doc.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
    const svgNode = (tag, attrs = {}, text) => { const element = doc.createElementNS(NS, tag); for (const [name, value] of Object.entries(attrs)) if (value !== undefined && value !== '') element.setAttribute(name, String(value)); if (text !== undefined) element.textContent = text; return element; };
    const listen = (target, event, handler, settings={}) => target.addEventListener(event, handler, { ...settings,signal: lifetime.signal });
    const root = node('section', 'hx-analysis-canvas'), header = node('div', 'hac-chart-context'), scaleLabel = node('span', 'hac-scale-label');
    root.setAttribute('aria-label', 'Interactive financial analysis chart');
    header.appendChild(scaleLabel);
    const stage = node('div', 'hac-stage'), rail = node('div', 'hac-year-rail'), railTrack = node('div', 'hac-rail-track'), slider = node('input', 'hac-year-range'), years = node('div', 'hac-year-buttons'), yearIndicator = node('span', 'hac-year-indicator'), railConnector = node('span', 'hac-year-connector'), railMarker = node('span', 'hac-rail-marker'), hoverConnector = node('span', 'hac-hover-connector'), hoverMarker = node('span', 'hac-hover-marker'), hoverIndicator = node('span', 'hac-hover-year-indicator');
    stage.tabIndex=0;stage.setAttribute('aria-label','Financial time chart. Drag horizontally to pan. Control or Command plus wheel, or pinch, to zoom. Plus and minus zoom; arrow keys pan; zero fits all years.');
    for (const marker of [yearIndicator, railConnector, railMarker, hoverConnector, hoverMarker, hoverIndicator]) marker.setAttribute('aria-hidden', 'true');
    slider.type = 'range'; slider.min = '0'; slider.step = '1'; slider.setAttribute('aria-label', 'Selected fiscal year');
    railTrack.append(slider, railConnector, railMarker, hoverConnector, hoverMarker, years); rail.appendChild(railTrack);
    const notice = node('span', 'hac-notice hac-sr-only'), readout = node('div', 'hac-readout'), readoutHead = node('div', 'hac-readout-head'), readoutYear = node('strong'), comparisonContext=node('span','hac-comparison-context'),legend = node('div', 'hac-legend');comparisonContext.hidden=true;
    readout.setAttribute('aria-label', 'Financial values by series for the inspected fiscal year');
    legend.tabIndex = 0; legend.setAttribute('role', 'region'); legend.setAttribute('aria-label', 'Series values. Scroll horizontally for more.');
    readoutHead.append(readoutYear,comparisonContext,notice); readout.append(readoutHead, legend);
    const announcement = node('p', 'hac-sr-only'); announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite');
    root.append(header, readout, stage, rail, announcement); container.appendChild(root);
    const viewControls=node('div','hac-view-controls'),zoomLabel=node('label','hac-zoom-label'),zoomRange=node('input','hac-zoom-range'),viewReset=node('button','hac-view-reset','100% · Fit');
    viewControls.setAttribute('role','group');viewControls.setAttribute('aria-label','Time view');zoomRange.type='range';zoomRange.min='100';zoomRange.max='400';zoomRange.step='5';zoomRange.value='100';zoomRange.setAttribute('aria-label','Time zoom');zoomRange.title='Zoom the time axis; financial values and value axes stay fixed';viewReset.type='button';viewReset.title='Fit all fiscal years';viewReset.setAttribute('aria-label','Fit all fiscal years');zoomLabel.append(node('span','','Zoom'),zoomRange);viewControls.append(zoomLabel,viewReset);(options.viewControlsContainer||root).appendChild(viewControls);
    const clipId=`hac-time-clip-${++canvasSequence}`;
    let geometry = null, selectedLine = null, selectedBand = null, selectionColor = '#bac0ca', hoverLine = null, labelLayer = null, plot = null, rows = [], entityControls = [], tracePaths=[],pointNodes=[], renderLifetime = new AbortController();
    let guideFrame = null, guideLastTime = 0, selectedPosition = null, selectedTarget = null, hoverPosition = null, hoverTarget = null, pointerInside = false, followPreview = false, capturedYear = null, railDragId = null, railDragX = null;
    let timeZoom=1,timeOffset=0,zoomTarget=1,offsetTarget=0,pinch=null;const touchPoints=new Map();
    const requestFrame = typeof view.requestAnimationFrame === 'function' ? callback => view.requestAnimationFrame(callback) : null;
    const cancelFrame = typeof view.cancelAnimationFrame === 'function' ? frame => view.cancelAnimationFrame(frame) : () => {};
    const reduceMotion = () => Boolean(view.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

    const inView=x=>geometry&&x>=geometry.left-.5&&x<=geometry.width-geometry.right+.5;
    const minOffset=zoom=>(1-zoom)*(geometry?.plotWidth||0);
    const clampOffset=(offset,zoom)=>Math.max(minOffset(zoom),Math.min(0,offset));
    function baseX(index) { return geometry.left+(state.model.periods.length>1?index/(state.model.periods.length-1):.5)*geometry.plotWidth; }
    function xAt(index) { return geometry.left+(baseX(index)-geometry.left)*timeZoom+timeOffset; }
    function indexAt(x) { return Math.max(0,Math.min(state.model.periods.length-1,Math.round((x-geometry.left-timeOffset)/(geometry.plotWidth*timeZoom)*Math.max(0,state.model.periods.length-1)))); }
    function paintView(syncGuide=true) {
      if(!geometry)return;
      const translation=geometry.left*(1-timeZoom)+timeOffset;
      for(const path of tracePaths)path.setAttribute('transform',`translate(${translation} 0) scale(${timeZoom} 1)`);
      for(const {element,index} of pointNodes)element.setAttribute('transform',`translate(${xAt(index)-baseX(index)} 0)`);
      const stride=Math.max(1,Math.ceil(state.model.periods.length/Math.max(2,Math.floor(geometry.plotWidth*timeZoom/43))));state.yearStride=stride;
      years.querySelectorAll('button').forEach((button,index)=>{button.style.left=`${(xAt(index)-geometry.left)/geometry.plotWidth*100}%`;});
      zoomRange.value=String(Math.round(zoomTarget*100));zoomRange.setAttribute('aria-valuetext',`${Math.round(zoomTarget*100)} percent time zoom`);viewReset.textContent=`${Math.round(zoomTarget*100)}% · Fit`;root.setAttribute('data-time-zoom',timeZoom);root.setAttribute('data-time-offset',timeOffset);
      if(railDragId!==null&&capturedYear!==null)railDragX=xAt(capturedYear);if(syncGuide)selectedPosition=selectedTarget=railDragX??xAt(state.selected);paintGuides();renderPointLabels();
    }
    function setView(zoom,offset,{elastic=false,direct=false}={}) {
      if(!geometry||state.model.periods.length<2)return;
      zoomTarget=Math.max(1,Math.min(4,zoom));
      if(elastic){const bound=clampOffset(offset,zoomTarget),extra=offset-bound,limit=geometry.plotWidth*.05;offsetTarget=bound+Math.sign(extra)*limit*(1-Math.exp(-Math.abs(extra)/Math.max(1,limit)));}else offsetTarget=clampOffset(offset,zoomTarget);
      if(direct||reduceMotion()||!requestFrame){timeZoom=zoomTarget;timeOffset=offsetTarget;paintView();}moveGuides();
    }
    function zoomAt(zoom,x) { const world=(x-geometry.left-offsetTarget)/zoomTarget,next=Math.max(1,Math.min(4,zoom));leaveGuide();preview(state.selected);setView(next,x-geometry.left-world*next); }
    function fitView() {leaveGuide();preview(state.selected);setView(1,0);}
    function revealYear(index) { const x=geometry.left+(baseX(index)-geometry.left)*zoomTarget+offsetTarget,margin=Math.min(18,geometry.plotWidth*.05);if(x<geometry.left||x>geometry.width-geometry.right){const edge=x<geometry.left?geometry.left+margin:geometry.width-geometry.right-margin;setView(zoomTarget,offsetTarget+edge-x);} }
    function setPanning(active) {root.classList.toggle('is-panning',active);stage.classList.toggle('is-panning',active);}
    function paintGuides() {
      if (!geometry) return;
      if (selectedLine && selectedPosition !== null) { selectedLine.setAttribute('x1', selectedPosition); selectedLine.setAttribute('x2', selectedPosition);selectedLine.setAttribute('visibility',inView(selectedPosition)?'visible':'hidden'); }
      const percent = selectedPosition === null || !geometry.plotWidth ? 0 : (selectedPosition - geometry.left) / geometry.plotWidth * 100;
      for (const marker of [yearIndicator, railConnector, railMarker]) { marker.style.left = `${percent}%`; marker.style.setProperty('--hac-selection-color', selectionColor);marker.hidden=!inView(selectedPosition); }
      if (selectedBand && selectedPosition !== null) {
        const spacing = geometry.plotWidth*timeZoom / Math.max(1, state.model.periods.length - 1), start = Math.max(geometry.left, selectedPosition - spacing / 2), end = Math.min(geometry.width - geometry.right, selectedPosition + spacing / 2);
        selectedBand.setAttribute('x', start); selectedBand.setAttribute('width', Math.max(0, end - start)); selectedBand.setAttribute('fill', selectionColor); selectedBand.setAttribute('opacity', state.labelsVisible ? '.035' : '0');
      }
      if (hoverLine) {
        if (hoverPosition !== null) { hoverLine.setAttribute('x1', hoverPosition); hoverLine.setAttribute('x2', hoverPosition); }
        hoverLine.setAttribute('visibility', pointerInside && hoverPosition !== null && Math.abs(hoverPosition - selectedPosition) > .7 ? 'visible' : 'hidden');
      }
      const hoverVisible = pointerInside && hoverPosition !== null && Math.abs(hoverPosition - selectedPosition) > .7;
      for (const marker of [hoverConnector, hoverMarker, hoverIndicator]) { marker.style.left = `${hoverPosition === null ? 0 : (hoverPosition - geometry.left) / geometry.plotWidth * 100}%`; marker.hidden = !hoverVisible; }
      years.querySelectorAll('button').forEach((button, index) => { const hovered = pointerInside && capturedYear === index; button.classList.toggle('is-hovered', hovered); button.hidden = !inView(xAt(index))||(!hovered && index !== state.selected && index !== state.model.periods.length - 1 && index % state.yearStride !== 0); });
      if (followPreview && pointerInside && capturedYear !== null) preview(capturedYear);
    }
    function cancelGuides(snap = false) {
      if (guideFrame !== null) cancelFrame(guideFrame);
      guideFrame = null; guideLastTime = 0;
      if (snap) { timeZoom=zoomTarget;timeOffset=offsetTarget;paintView();selectedPosition = selectedTarget; hoverPosition = hoverTarget; paintGuides(); }
    }
    function moveGuides() {
      if (state.destroyed) return;
      if (!requestFrame || reduceMotion()) { cancelGuides(true); return; }
      if (guideFrame !== null) return;
      const tick = time => {
        guideFrame = null;
        if (state.destroyed) return;
        if (reduceMotion()) { cancelGuides(true); return; }
        const elapsed = guideLastTime ? Math.max(8, Math.min(40, time - guideLastTime)) : 16, ease = 1 - Math.exp(-elapsed / 18);
        guideLastTime = time;
        let moving = false;
        const viewEase=1-Math.exp(-elapsed/35);let viewChanged=false;
        if(timeZoom!==zoomTarget||timeOffset!==offsetTarget){timeZoom+=(zoomTarget-timeZoom)*viewEase;timeOffset+=(offsetTarget-timeOffset)*viewEase;if(Math.abs(timeZoom-zoomTarget)<.0001)timeZoom=zoomTarget;if(Math.abs(timeOffset-offsetTarget)<.25)timeOffset=offsetTarget;viewChanged=true;moving=timeZoom!==zoomTarget||timeOffset!==offsetTarget;}
        if(viewChanged)paintView();
        if (selectedTarget !== null) { selectedPosition += (selectedTarget - selectedPosition) * ease; if (Math.abs(selectedTarget - selectedPosition) < .35) selectedPosition = selectedTarget; else moving = true; }
        if (hoverTarget !== null && pointerInside) { hoverPosition += (hoverTarget - hoverPosition) * ease; if (Math.abs(hoverTarget - hoverPosition) < .35) hoverPosition = hoverTarget; else moving = true; }
        paintGuides();
        if (moving) guideFrame = requestFrame(tick); else guideLastTime = 0;
      };
      guideFrame = requestFrame(tick);
    }
    function selectGuide(x, direct = false) {
      selectedTarget = x;
      if (selectedPosition === null || direct || reduceMotion() || !requestFrame) selectedPosition = x;
      paintGuides(); moveGuides();
    }
    function hoverGuide(event) {
      if (!geometry) return;
      pointerInside = true;
      hoverTarget = magneticX(eventX(event));
      if (hoverPosition === null || reduceMotion() || !requestFrame) hoverPosition = hoverTarget;
      paintGuides(); moveGuides();
    }
    function magneticX(raw) {
      const spacing = geometry.plotWidth*timeZoom / Math.max(1, state.model.periods.length - 1), nearest = indexAt(raw);
      if (capturedYear !== null && Math.abs(raw - xAt(capturedYear)) <= spacing * .42) return xAt(capturedYear);
      capturedYear = Math.abs(raw - xAt(nearest)) <= spacing * .28 ? nearest : null;
      return capturedYear === null ? raw : xAt(capturedYear);
    }
    function leaveGuide() { pointerInside = false; followPreview = false; capturedYear = null; hoverTarget = null; hoverPosition = null; paintGuides(); }
    function reportLayout() {
      if (options.onLayout && geometry) { const plotTop = stage.getBoundingClientRect().top - container.getBoundingClientRect().top; options.onLayout({ plotTop: Number.isFinite(plotTop) ? plotTop : 0, plotHeight: geometry.height }); }
    }

    function yAt(value, trace) { const axis = state.model.axes.find(item => item.id === trace.axis); return geometry.top + (axis.max - value) / (axis.max - axis.min) * geometry.plotHeight; }
    function lineMarker(parent, trace, point, x, y, size = 4) {
      const attrs = { stroke: trace.color, 'stroke-width': 1.7, fill: point.status === 'Actual' || point.status === 'History' || trace.scenario ? trace.color : '#242527', 'vector-effect': 'non-scaling-stroke' };
      let marker;
      if (trace.style.marker === 'square') marker = svgNode('rect', { ...attrs, x: x - size, y: y - size, width: size * 2, height: size * 2, rx: .4 });
      else if (trace.style.marker === 'diamond') marker = svgNode('path', { ...attrs, d: `M${x},${y-size-1}L${x+size+1},${y}L${x},${y+size+1}L${x-size-1},${y}Z` });
      else if (trace.style.marker === 'triangle') marker = svgNode('path', { ...attrs, d: `M${x},${y-size-1}L${x+size+1},${y+size}L${x-size-1},${y+size}Z` });
      else marker = svgNode('circle', { ...attrs, cx: x, cy: y, r: size });
      parent.appendChild(marker);
      if (point.status === 'Unclassified' || point.status.startsWith('Source investment')) parent.appendChild(svgNode('circle', { cx: x, cy: y, r: 1.3, fill: trace.color }));
    }
    function pointPayload(trace, point) { return { seriesId: trace.id, metric: trace.metric, period: point.period, value: point.rawValue, rawValue: point.rawValue, kind: point.kind, source: point.source, basis: point.basis, scenario: trace.scenario, series: trace, point }; }
    function entityKey(trace) { return String(trace.displayEntityId ?? (trace.estimate ? trace.reportedEntityId : trace.entityId) ?? trace.id); }
    function selectPoint(trace, point, forceFocus = false) {
      const index = state.model.periods.findIndex(period => key(period) === key(point.period));
      if (index < 0) return;
      const clearFocus = !forceFocus && !state.headerFocus && state.activeTraceKey === trace.key && state.activeTracePeriod === key(point.period);
      state.activeTraceKey = clearFocus ? null : trace.key; state.activeTracePeriod = clearFocus ? null : key(point.period); state.pinnedPoint = clearFocus ? null : { traceKey: trace.key, period: key(point.period) }; state.headerFocus = false; state.labelsVisible = true;
      choose(index, true);
      emphasize(state.activeTraceKey); renderPointLabels();
    }
    function inspect(trace, point) {
      selectPoint(trace, point, true);
      const current = state.model.series.find(item => item.key === trace.key) || trace;
      const selectedPoint = current.points.find(item => key(item.period) === key(point.period)) || point;
      options.onPoint?.(pointPayload(current, selectedPoint));
    }
    function emphasize(traceKey, exactMetric = false) {
      const traces = new Map(state.model.series.map(trace => [trace.key, trace])), focused = traces.get(state.activeTraceKey), target = focused && !state.headerFocus ? focused : traces.get(traceKey);
      for (const element of stage.querySelectorAll('.hac-trace')) {
        const trace = traces.get(element.getAttribute('data-trace-key'));
        element.classList.toggle('is-muted', Boolean(target && (exactMetric || !state.headerFocus ? trace.key !== target.key : entityKey(trace) !== entityKey(target))));
        element.classList.toggle('is-temporarily-muted', Boolean(target && exactMetric && trace.key !== target.key));
        element.classList.toggle('is-selected', Boolean(focused && (state.headerFocus ? entityKey(trace) === entityKey(focused) : trace.key === focused.key)));
      }
      for (const { trace, button } of rows) {
        button.classList.toggle('is-selected', !state.headerFocus && trace.key === state.activeTraceKey);
        button.setAttribute('aria-pressed', String(!state.headerFocus && trace.key === state.activeTraceKey));
      }
      for (const group of legend.querySelectorAll('.hac-entity-group')) {
        const selected = Boolean(focused && group.getAttribute('data-entity-key') === entityKey(focused));
        group.classList.toggle('is-selected', selected); const header=group.querySelectorAll('.hac-entity-header')[0];if(header&&header.getAttribute('data-entity-action')!=='navigate')header.setAttribute('aria-pressed',String(selected));
      }
      const colors = focused ? [...new Set(state.model.series.filter(trace => entityKey(trace) === entityKey(focused) && !trace.scenario && !trace.estimate && trace.points.some(point => point.rawValue !== null)).map(trace => trace.color))] : [];
      selectionColor = focused && !state.headerFocus ? focused.color : colors.length === 1 ? colors[0] : '#bac0ca'; root.classList.toggle('has-point-focus',Boolean(focused && !state.headerFocus)); paintGuides(); refreshEvidence();
    }
    function evidenceTrace(entity) { return entity.traces.find(trace => trace.key === state.activeTraceKey) || entity.traces.find(trace => !trace.scenario && !trace.estimate && trace.metric === 'revenue') || entity.traces.find(trace => !trace.scenario && !trace.estimate) || entity.traces[0]; }
    function refreshEvidence() {
      for (const { entity, evidenceButton } of entityControls) {
        const trace = evidenceTrace(entity), point = trace.points[state.preview] || { period: state.model.periods[state.preview], rawValue: null };
        evidenceButton.title = `${entity.name} · ${trace.style.label} · ${periodName(point.period)} · ${exact(point.rawValue, trace.unit)} · Evidence`;
        evidenceButton.setAttribute('aria-label', `Show ${trace.style.label} evidence for ${entity.name}, ${periodName(point.period)}, ${exact(point.rawValue, trace.unit)} inline. Select another value to change this measure.`);
        evidenceButton.setAttribute('data-series-id', trace.id);
      }
    }
    function renderPointLabels() {
      if (!labelLayer || !geometry) return;
      labelLayer.replaceChildren();
      if (!state.labelsVisible || !state.model.supported || !inView(xAt(state.selected))) return;
      const pinned = state.pinnedPoint, primaryKey = pinned?.period === key(state.model.periods[state.selected]) ? pinned.traceKey : null, x = xAt(state.selected);
      const entries = state.model.series.map(trace => ({trace,point:trace.points[state.selected]})).filter(({point}) => point && point.value !== null).map(entry => ({...entry,y:yAt(entry.point.value,entry.trace),primary:entry.trace.key===primaryKey}));
      for (const {trace,point,y,primary} of entries) labelLayer.appendChild(svgNode('circle', { cx:x, cy:y, r:primary?8:5, fill:'none', stroke:trace.color, 'stroke-width':primary?2:1, class:`hac-selected-point ${primary?'is-primary':'is-secondary'}`, 'data-series-id':trace.id }));
      // Labels occupy geometric slots beside the guide. Crowded points retain
      // their rings and exact top readouts rather than overlapping or shrinking.
      const occupied = {left:[],right:[]}, top = geometry.top + 3, bottom = geometry.height - geometry.bottom - 3, preferred = x < geometry.left + geometry.plotWidth * .55 ? 'right' : 'left';
      const available = side => side==='right'?geometry.width-geometry.right-x-12:x-geometry.left-12;
      const place = (side,height,target,maxShift) => {
        const limit=bottom-height;if(limit<top)return null;
        const choices=[Math.max(top,Math.min(limit,target)),top,limit,...occupied[side].flatMap(box=>[box.bottom+4,box.top-height-4])];
        return choices.filter(y=>y>=top&&y<=limit&&Math.abs(y-target)<=maxShift&&occupied[side].every(box=>y+height+4<=box.top||y>=box.bottom+4)).sort((a,b)=>Math.abs(a-target)-Math.abs(b-target))[0]??null;
      };
      for (const {trace,point,y,primary} of [...entries].sort((a,b)=>Number(b.primary)-Number(a.primary)||a.y-b.y)) {
        const amount=exact(point.rawValue,trace.unit), textWidth=amount.length*8.5, height=primary?36:20, target=primary?(y<top+48?y+10:y-43):y-10;
        const choices=[preferred,preferred==='right'?'left':'right'].map(side=>({side,labelTop:available(side)>=textWidth?place(side,height,target,primary?Infinity:48):null})).filter(choice=>choice.labelTop!==null).sort((a,b)=>Math.abs(a.labelTop-target)-Math.abs(b.labelTop-target));
        const fallback=primary&&textWidth<=geometry.plotWidth-6?place(preferred,height,target,Infinity):null,placement=choices[0]||(fallback===null?null:{side:preferred,labelTop:fallback});if(!placement)continue;
        const {side,labelTop}=placement,labelX=side==='right'?Math.max(geometry.left,Math.min(x+12,geometry.width-geometry.right-textWidth)):Math.min(geometry.width-geometry.right,Math.max(x-12,geometry.left+textWidth)),anchor=side==='right'?'start':'end',group=svgNode('g',{class:`hac-point-value ${primary?'is-primary':'is-secondary'}`,'aria-hidden':'true','data-series-id':trace.id,'data-label-top':labelTop,'data-label-bottom':labelTop+height,'data-label-side':side});
        group.setAttribute('data-financial-description',`${trace.name} · ${trace.style.label} · ${periodName(point.period)} · ${amount} · ${point.status}`);
        if(primary){const caption=`${trace.displayName||trace.name} · ${trace.style.label}`,captionSpace=side==='right'?geometry.width-geometry.right-labelX:labelX-geometry.left,characters=Math.max(8,Math.min(48,Math.floor(captionSpace/5.5)));group.appendChild(svgNode('text',{x:labelX,y:labelTop+13,'text-anchor':anchor,class:'hac-point-value-name'},caption.length>characters?caption.slice(0,characters-1)+'…':caption));}
        group.appendChild(svgNode('text',{x:labelX,y:labelTop+(primary?32:15),'text-anchor':anchor,fill:trace.color,class:'hac-point-value-amount'},amount));
        const box={top:labelTop,bottom:labelTop+height};occupied[side].push(box);if(side==='right'&&labelX<x||side==='left'&&labelX>x)occupied[side==='right'?'left':'right'].push(box);labelLayer.appendChild(group);
      }
    }
    function updateComparison(period) {
      const entities=state.model.comparison?.entities||[],pointValue=(points)=>{const matches=points.filter(point=>key(point.period)===key(period));return matches.length===1?matches[0].value:null;},catalog=entities.map(entity=>({...entity,revenue:pointValue(entity.revenuePoints),units:pointValue(entity.unitsPoints)}));
      const helpers=window.HX_WORKSPACE_MODEL,baseline=entities.length<2?null:typeof helpers?.comparisonBaseline==='function'?helpers.comparisonBaseline(catalog,entities.map(entity=>entity.id)):catalog.filter(entity=>entity.revenue!==null).sort((a,b)=>b.revenue-a.revenue||a.id.localeCompare(b.id,'en'))[0]||null;
      comparisonContext.hidden=!baseline;comparisonContext.textContent=baseline?`vs ${baseline.name}${entities.filter(entity=>entity.name===baseline.name).length>1?' · '+baseline.id:''}`:'';comparisonContext.title=baseline?`${baseline.name} · ${baseline.id} · ${periodName(period)}`:'';comparisonContext.setAttribute('data-comparison-baseline',baseline?.id||'');comparisonContext.setAttribute('aria-label',baseline?`Compared with ${baseline.name}, ${baseline.id}, highest source revenue in ${periodName(period)}`:'');
      for(const {trace,difference,button} of rows){
        const entity=catalog.find(entity=>entity.id===trace.entityId),eligible=entities.length>=2&&entity&&!trace.scenario&&!trace.estimate&&['revenue','units'].includes(trace.metric)&&entity.id!==baseline?.id;
        difference.hidden=!eligible;difference.textContent='';difference.className='hac-readout-difference';difference.setAttribute('data-comparison-percent','');difference.setAttribute('data-comparison-baseline','');if(!eligible)continue;
        const value=entity[trace.metric],base=baseline?.[trace.metric],percent=typeof helpers?.comparisonPercent==='function'?helpers.comparisonPercent(value,base):value!==null&&typeof base==='number'&&Number.isFinite(base)&&base!==0?(value-base)/Math.abs(base)*100:null,valid=typeof percent==='number'&&Number.isFinite(percent),direction=!valid?'unavailable':percent>0?'positive':percent<0?'negative':'neutral';
        const signed=!valid?'n/a':`${percent>0?'+':percent<0?'−':''}${percent!==0&&Math.abs(percent)<.1?'<0.1':Math.abs(percent).toFixed(1)}%`,description=!baseline?'Comparison unavailable: source revenue baseline is missing':!valid?base===0?`Percentage unavailable: ${baseline.name} has a zero ${trace.style.label.toLowerCase()} baseline`:`Percentage unavailable: source ${trace.style.label.toLowerCase()} is missing`:`${signed} compared with ${baseline.name}, ${baseline.id}, ${periodName(period)}; (value − baseline) / absolute baseline × 100`;
        difference.textContent=`(${signed})`;difference.classList.toggle('is-'+direction,true);difference.setAttribute('data-comparison-percent',valid?String(percent):'');difference.setAttribute('data-comparison-baseline',baseline?.id||'');difference.title=description;difference.setAttribute('aria-label',description);button.setAttribute('aria-label',`${button.getAttribute('aria-label')} ${description}.`);
      }
    }
    function preview(index, announce = false, force = false) {
      const model = state.model;
      if (!model.periods.length) return;
      const next = Math.max(0, Math.min(model.periods.length - 1, index));
      if (!force && next === state.preview) return;
      state.preview = next;
      readoutYear.textContent = `${state.preview === state.selected ? 'Selected' : 'Inspect'} ${periodName(model.periods[state.preview])}`;
      rows.forEach(({ trace, value, status, button }) => {
        const point = trace.points[state.preview]; value.textContent = exact(point.rawValue, trace.unit); value.classList.toggle('is-long', value.textContent.length > 14); status.textContent = point.rawValue === null ? 'No source value' : point.status;
        button.title = [trace.name, trace.style.label, periodName(point.period), exact(point.rawValue, trace.unit), point.status, point.basis || ''].filter(Boolean).join(' · ');
        button.setAttribute('aria-label', `${button.title}. Select this value and fiscal year.`);
      });
      updateComparison(model.periods[state.preview]);
      refreshEvidence();
      if (announce) announcement.textContent = `${readoutYear.textContent}. ${rows.map(({ trace }) => `${trace.name}, ${trace.style.label}, ${exact(trace.points[state.preview].rawValue, trace.unit)}, ${trace.points[state.preview].status}`).join('. ')}`;
    }
    function choose(index, forceNotify = false) {
      const count = state.model.periods.length;
      if (!count) return;
      followPreview = false;
      const next = Math.max(0, Math.min(count - 1, index)), changed = next !== state.selected;
      if (state.pinnedPoint && state.pinnedPoint.period !== key(state.model.periods[next])) state.pinnedPoint = null;
      state.selected = next; state.labelsVisible = state.labelsVisible || changed || forceNotify; slider.value = String(next); slider.setAttribute('aria-valuetext', periodName(state.model.periods[next]));
      revealYear(next);selectGuide(railDragX ?? xAt(next));
      years.querySelectorAll('button').forEach((button, itemIndex) => { button.classList.toggle('is-selected', itemIndex === next); button.setAttribute('aria-pressed', String(itemIndex === next)); button.hidden = !inView(xAt(itemIndex))||(itemIndex !== next && itemIndex !== count - 1 && itemIndex % state.yearStride !== 0); });
      preview(next, changed, changed);
      renderPointLabels();
      if (changed || forceNotify) options.onPeriod?.(state.model.periods[next]);
    }
    function eventX(event) {
      const rect = stage.getBoundingClientRect(), x = number(event.clientX)===null?geometry.left+geometry.plotWidth/2:(event.clientX - rect.left) / (rect.width || 1) * geometry.width;
      return Math.max(geometry.left, Math.min(geometry.width - geometry.right, x));
    }
    function eventIndex(event) { return indexAt(eventX(event)); }
    function draw() {
      renderLifetime.abort(); renderLifetime = new AbortController();
      const model = state.model;
      const width = Math.max(300, Math.round(root.clientWidth || container.clientWidth || 960)), mobile = width < 600, height = (number(view.innerWidth) ?? width) < 720 ? 330 : 410;
      const resized = state.width !== width,previousPlotWidth=geometry?.plotWidth; state.width = width;
      geometry = { width, height, left: mobile ? 58 : 76, right: model.axes.some(axis => axis.side === 'right') ? mobile ? 58 : 76 : 24, top: 35, bottom: 27 };
      geometry.plotWidth = width - geometry.left - geometry.right; geometry.plotHeight = height - geometry.top - geometry.bottom;
      if(previousPlotWidth&&previousPlotWidth!==geometry.plotWidth){timeOffset*=geometry.plotWidth/previousPlotWidth;offsetTarget*=geometry.plotWidth/previousPlotWidth;}timeOffset=clampOffset(timeOffset,timeZoom);offsetTarget=clampOffset(offsetTarget,zoomTarget);
      state.yearStride = Math.max(1, Math.ceil(model.periods.length / Math.max(2, Math.floor(geometry.plotWidth / 43))));
      rail.style.setProperty('--hac-left', `${geometry.left}px`); rail.style.setProperty('--hac-right', `${geometry.right}px`);
      const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img', 'aria-label': 'Annual financial series. Use series values above and the fiscal year slider below for keyboard access. Select a point to show values on the graph.' });
      svg.appendChild(svgNode('desc', {}, 'Each entity and metric combination has a stable color. Line patterns and marker shapes identify measures; annual plans have a long dash and scenarios a short dash. Filled markers identify actual or historical values; open markers identify plans; centre dots identify unclassified source values. Missing values break the lines. Selected-year rings highlight the source points; exact dollars and units are grouped by entity above the plot.'));
      const defs=svgNode('defs'),clip=svgNode('clipPath',{id:clipId,class:'hac-time-clip'});clip.appendChild(svgNode('rect',{x:geometry.left,y:0,width:geometry.plotWidth,height}));defs.appendChild(clip);svg.appendChild(defs);
      plot = svgNode('g'); svg.appendChild(plot);
      selectedBand = svgNode('rect', { x: xAt(state.selected), y: geometry.top, width: 0, height: geometry.plotHeight, fill: selectionColor, opacity: 0, class: 'hac-year-band' }); plot.appendChild(selectedBand);
      const primary = model.axes.find(axis => axis.side === 'left');
      for (const axis of model.axes) {
        const x = axis.side === 'right' ? width - geometry.right + 12 : geometry.left - 12, anchor = axis.side === 'right' ? 'start' : 'end';
        svg.appendChild(svgNode('text', { x: axis.unit === 'index' ? geometry.left : x, y: 16, 'text-anchor': axis.unit === 'index' ? 'start' : anchor, class: 'hac-axis-title' }, axis.label));
        for (const tick of axis.ticks) {
          const y = geometry.top + (axis.max - tick) / (axis.max - axis.min) * geometry.plotHeight;
          if (axis === primary) plot.appendChild(svgNode('line', { x1: geometry.left, x2: width - geometry.right, y1: y, y2: y, class: tick === 0 ? 'hac-grid hac-zero' : 'hac-grid' }));
          svg.appendChild(svgNode('text', { x, y: y + 4, 'text-anchor': anchor, class: 'hac-axis-label' }, compact(tick, axis.unit)));
        }
      }
      if (model.indexed && primary) {
        const y = geometry.top + (primary.max - 100) / (primary.max - primary.min) * geometry.plotHeight;
        plot.appendChild(svgNode('line', { x1: geometry.left, x2: width - geometry.right, y1: y, y2: y, class: 'hac-base-line' }));
      }
      selectedLine = svgNode('line', { x1: xAt(state.selected), x2: xAt(state.selected), y1: geometry.top, y2: height, class: 'hac-selected-line' }); plot.appendChild(selectedLine);
      hoverLine = svgNode('line', { x1: xAt(state.selected), x2: xAt(state.selected), y1: geometry.top, y2: height, class: 'hac-hover-line', visibility: 'hidden' }); plot.appendChild(hoverLine);
      const dataLayer=svgNode('g',{'clip-path':`url(#${clipId})`,class:'hac-data-layer'});plot.appendChild(dataLayer);tracePaths=[];pointNodes=[];
      if (model.supported) model.series.forEach(trace => {
        const group = svgNode('g', { class: 'hac-trace', 'data-trace-key': trace.key }); let path = '', open = false;
        trace.points.forEach((point, index) => {
          if (point.value === null) { open = false; return; }
          path += `${open ? 'L' : 'M'}${baseX(index).toFixed(2)},${yAt(point.value, trace).toFixed(2)} `; open = true;
        });
        const curve=svgNode('path', { d: path, fill: 'none', stroke: trace.color, 'stroke-width': trace.scenario ? 2.6 : 2, 'stroke-dasharray': trace.scenario ? '3 4' : trace.estimate ? '8 5' : trace.style.dash, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' });group.appendChild(curve);tracePaths.push(curve);
        trace.points.forEach((point, index) => {
          if (point.value === null) return;
          const marker = svgNode('g', { 'data-point-key': `${trace.key}|${index}`, class: 'hac-point' });
          marker.appendChild(svgNode('circle', { cx: baseX(index), cy: yAt(point.value, trace), r: 10, fill: 'transparent' }));
          lineMarker(marker, trace, point, baseX(index), yAt(point.value, trace));pointNodes.push({element:marker,index});
          marker.setAttribute('aria-label',`${trace.name} · ${trace.style.label} · ${periodName(point.period)} · ${exact(point.rawValue, trace.unit)} · ${point.status}`);group.appendChild(marker);
        }); dataLayer.appendChild(group);
      });
      if (!model.series.length || !model.series.some(trace => trace.points.some(point => point.rawValue !== null))) svg.appendChild(svgNode('text', { x: geometry.left + geometry.plotWidth / 2, y: geometry.top + geometry.plotHeight / 2, 'text-anchor': 'middle', class: 'hac-empty-label' }, 'No values available for this selection'));
      labelLayer = svgNode('g', { class: 'hac-point-labels', 'aria-hidden': 'true' }); svg.appendChild(labelLayer);
      stage.replaceChildren(svg);
      slider.max = String(Math.max(0, model.periods.length - 1)); slider.disabled = model.periods.length < 2;zoomRange.disabled=model.periods.length<2;viewReset.disabled=model.periods.length<2; slider.value = String(state.selected); slider.setAttribute('aria-valuetext', model.periods.length ? periodName(model.periods[state.selected]) : 'No fiscal years');
      years.replaceChildren(yearIndicator, hoverIndicator); model.periods.forEach((period, index) => { const label=periodName(period), fiscal=/^FY(\d+)$/.exec(label),button = node('button', index === state.selected ? 'is-selected' : '');if(fiscal)button.append(node('span','hac-year-prefix','FY'),node('span','hac-year-number',fiscal[1]));else button.textContent=label;button.type = 'button';button.setAttribute('aria-label',label); button.style.left = `${model.periods.length > 1 ? index / (model.periods.length - 1) * 100 : 50}%`; button.hidden = index !== state.selected && index !== model.periods.length - 1 && index % state.yearStride !== 0; button.setAttribute('aria-pressed', String(index === state.selected)); button.addEventListener('click', () => choose(index, true), { signal: renderLifetime.signal }); years.appendChild(button); });
      scaleLabel.textContent = model.indexed ? `Trend index · ${periodName(model.basePeriod)} = 100` : model.axes.length === 2 ? 'Source values · USD left / units right' : `Source values${model.axes[0] ? ` · ${model.axes[0].label}` : ''}`;
      const messages = [model.reason, ...model.warnings].filter(Boolean);
      notice.textContent = messages.join(' '); notice.hidden = !messages.length;
      const diagnostic=[scaleLabel.textContent,...messages].filter(Boolean).join('. ');notice.title=diagnostic;notice.setAttribute('aria-label',diagnostic);scaleLabel.title=diagnostic;scaleLabel.setAttribute('aria-label',diagnostic);stage.setAttribute('aria-description',diagnostic);root.setAttribute('aria-label',`Interactive financial analysis chart. ${diagnostic}`);
      const entities = new Map();
      for (const trace of model.series) { const id = entityKey(trace); if (!entities.has(id)) entities.set(id, { id, traces: [] }); entities.get(id).traces.push(trace); }
      for (const entity of entities.values()) {
        const source = entity.traces.find(trace => !trace.scenario && !trace.estimate) || entity.traces[0];
        entity.name = source.displayName || source.displayEntityName || source.name;entity.detailLevel=source.entityDetailLevel||null;
      }
      const nameCounts = new Map(); for (const entity of entities.values()) nameCounts.set(entity.name, (nameCounts.get(entity.name) || 0) + 1);
      legend.replaceChildren(); rows = []; entityControls = [];
      for (const entity of entities.values()) {
        const group = node('section', 'hac-entity-group'), headRow = node('div', 'hac-entity-headrow'), header = node('button', 'hac-entity-header'), evidenceButton = node('button', 'hac-entity-evidence', 'Evidence'), name = node('strong', 'hac-entity-name', entity.name), metrics = node('div', 'hac-entity-metrics');
        evidenceButton.type = 'button'; evidenceButton.addEventListener('click', () => { const trace = evidenceTrace(entity); inspect(trace, trace.points[state.preview]); }, { signal: renderLifetime.signal }); entityControls.push({ entity, evidenceButton });
        header.type = 'button';
        group.setAttribute('data-entity-key', entity.id); group.setAttribute('aria-label', `${entity.name} · ${entity.id}`);const navigable=typeof options.onEntity==='function'&&Boolean(entity.detailLevel);header.setAttribute('data-entity-action',navigable?'navigate':'focus');if(!navigable)header.setAttribute('aria-pressed','false');header.title=navigable?`Open ${entity.detailLevel} details · ${entity.name} · ${entity.id}`:`${entity.name} · ${entity.id}`;header.setAttribute('aria-label',navigable?`Open ${entity.detailLevel} details for ${entity.name}, ${entity.id}`:`Emphasize ${entity.name}, ${entity.id}`);
        const eligibleColors = [...new Set(entity.traces.filter(trace => !trace.scenario && !trace.estimate && trace.points.some(point => point.rawValue !== null)).map(trace => trace.color))];
        group.style.setProperty('--hac-entity-color', eligibleColors.length === 1 ? eligibleColors[0] : '#969eac'); header.appendChild(name);
        header.addEventListener('click', () => {
          if (options.onEntity?.(entity) === true) return;
          const trace = entity.traces.find(trace => !trace.scenario && !trace.estimate) || entity.traces[0], active = state.model.series.find(trace => trace.key === state.activeTraceKey);
          const clear = active && entityKey(active) === entity.id && state.activeTracePeriod === key(state.model.periods[state.preview]);
          state.activeTraceKey = clear ? null : trace.key; state.activeTracePeriod = clear ? null : key(state.model.periods[state.preview]); state.headerFocus = !clear; state.labelsVisible = true;
          choose(state.preview, true); emphasize(state.activeTraceKey); renderPointLabels();
        }, { signal: renderLifetime.signal });
        if (nameCounts.get(entity.name) > 1) header.appendChild(node('small', 'hac-entity-id', entity.id));
        const metricKeys = [...new Set(entity.traces.map(trace => trace.metric))]; metrics.style.setProperty('--hac-columns', String(metricKeys.length));
        for (const metricKey of metricKeys) {
          const traces = entity.traces.filter(trace => trace.metric === metricKey), cell = node('div', 'hac-metric-cell'), heading = node('div', 'hac-metric-heading'), metric = node('span', 'hac-metric-name', traces[0].style.label);
          heading.appendChild(metric); cell.appendChild(heading);
          const plans = traces.filter(trace => trace.estimate), baselineTraces = traces.filter(trace => !trace.estimate);
          let planRows = null, planDisclosure = null;
          if (plans.length && (baselineTraces.length || plans.length > 1)) {
            planDisclosure = node('details', 'hac-plan-disclosure'); const summary = node('summary', '', `Annual plans (${plans.length})`); planRows = node('div', 'hac-plan-rows');
            if (!baselineTraces.length) planDisclosure.open = true;
            planDisclosure.append(summary, planRows); planDisclosure.addEventListener('toggle', reportLayout, { signal: renderLifetime.signal });
          }
          for (const trace of [...traces].sort((a, b) => (a.estimate ? 2 : a.scenario ? 1 : 0) - (b.estimate ? 2 : b.scenario ? 1 : 0))) {
            const item = node('div', 'hac-legend-item'), button = node('button', 'hac-legend-row'), label = node('span', 'hac-legend-label'), status = node('span', 'hac-legend-status');
            const basis = node('span', 'hac-value-basis', trace.scenario ? 'Scenario' : trace.estimate ? `Annual plan${trace.reportedEntityId && String(trace.reportedEntityId) !== entity.id ? ' · ' + trace.reportedEntityId : ''}` : 'Source'), value = node('strong', 'hac-legend-value'),valueLine=node('span','hac-value-with-difference'),difference=node('span','hac-readout-difference');difference.hidden=true;
            if (traces.length === 1 && !trace.scenario && !trace.estimate) item.classList.toggle('is-source-only', true);
            if (!trace.scenario && !trace.estimate) basis.classList.toggle('is-source', true);
            item.style.setProperty('--hac-color', trace.color); button.type = 'button'; button.setAttribute('data-series-id', trace.id);
            label.append(basis, status);valueLine.append(value,difference);button.append(label,valueLine); item.appendChild(button);
            if (trace.estimate && planRows) planRows.appendChild(item); else cell.appendChild(item);
            button.addEventListener('click', () => selectPoint(trace, trace.points[state.preview]), { signal: renderLifetime.signal });
            button.addEventListener('pointerenter', () => emphasize(trace.key, true), { signal: renderLifetime.signal }); button.addEventListener('pointerleave', () => emphasize(state.activeTraceKey), { signal: renderLifetime.signal });
            button.addEventListener('focus', () => emphasize(trace.key, true), { signal: renderLifetime.signal }); button.addEventListener('blur', () => emphasize(state.activeTraceKey), { signal: renderLifetime.signal });
            rows.push({ trace, button, value, status,difference });
          }
          if (planDisclosure) cell.appendChild(planDisclosure); metrics.appendChild(cell);
        }
        headRow.append(header, evidenceButton); group.append(headRow, metrics); legend.appendChild(group);
      }
      preview(state.selected, false, true);
      paintView(false);selectGuide(railDragX ?? xAt(state.selected), resized);
      emphasize(state.activeTraceKey); renderPointLabels();
      reportLayout();
    }
    listen(zoomRange,'input',()=>zoomAt(Number(zoomRange.value)/100,geometry.left+geometry.plotWidth/2));
    listen(viewReset,'click',fitView);
    listen(stage,'wheel',event=>{
      if(!(event.ctrlKey||event.metaKey)||!geometry||state.model.periods.length<2)return;
      event.preventDefault?.();const delta=(number(event.deltaY)||0)*(event.deltaMode===1?16:event.deltaMode===2?geometry.height:1);
      zoomAt(zoomTarget*Math.exp(-delta*.002),eventX(event));
    },{passive:false});
    listen(stage,'keydown',event=>{
      if(!geometry||state.model.periods.length<2)return;
      if(['+','=','-','_','0','Home','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault?.();if(event.key==='0'||event.key==='Home')fitView();else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){leaveGuide();setView(zoomTarget,offsetTarget+(event.key==='ArrowLeft'?1:-1)*geometry.plotWidth*.18);}else zoomAt(zoomTarget*(event.key==='+'||event.key==='='?1.2:1/1.2),geometry.left+geometry.plotWidth/2);}
    });
    listen(slider, 'input', () => choose(railDragId === null ? Number(slider.value) : capturedYear ?? indexAt(railDragX)));
    listen(slider, 'pointerdown', event => {
      if (event.button !== undefined && event.button !== 0 || !state.model.periods.length) return;
      leaveGuide(); state.labelsVisible = true; railDragId = event.pointerId; railDragX = magneticX(eventX(event)); slider.setPointerCapture?.(event.pointerId); choose(capturedYear ?? eventIndex(event));
    });
    listen(slider, 'pointermove', event => { if (railDragId === event.pointerId) { railDragX = magneticX(eventX(event)); choose(capturedYear ?? eventIndex(event)); } });
    const endRailDrag = event => { if (railDragId !== event.pointerId) return; if (slider.hasPointerCapture?.(event.pointerId)) slider.releasePointerCapture?.(event.pointerId); railDragId = null; railDragX = null; capturedYear = null; selectGuide(xAt(state.selected)); };
    listen(slider, 'pointerup', endRailDrag); listen(slider, 'pointercancel', endRailDrag);
    const touchPair=()=>[...touchPoints.values()].slice(0,2);
    function beginPinch(){const pair=touchPair();if(pair.length!==2)return;const [a,b]=pair,distance=Math.hypot(a.x-b.x,a.y-b.y);if(distance<8)return;zoomTarget=timeZoom;offsetTarget=timeOffset;pinch={distance,zoom:timeZoom,world:(eventX({clientX:(a.x+b.x)/2})-geometry.left-timeOffset)/timeZoom};state.drag=null;for(const id of touchPoints.keys())stage.setPointerCapture?.(id);leaveGuide();preview(state.selected);setPanning(true);}
    listen(stage, 'pointerdown', event => {
      if (event.button !== undefined && event.button !== 0 || !state.model.periods.length) return;
      if(event.pointerType==='touch'){touchPoints.set(event.pointerId,{x:event.clientX,y:number(event.clientY)||0});if(touchPoints.size>=2){stage.setPointerCapture?.(event.pointerId);if(!pinch)beginPinch();return;}}
      zoomTarget=timeZoom;offsetTarget=timeOffset;leaveGuide();preview(state.selected);
      state.drag = { id:event.pointerId,start:event.clientX,startY:number(event.clientY)||0,startOffset:timeOffset,zoom:timeZoom,pointKey:event.target.closest?.('[data-point-key]')?.getAttribute('data-point-key'),moved:false,panning:false,touch:event.pointerType==='touch' };
      if(!state.drag.touch)stage.setPointerCapture?.(event.pointerId);
    });
    listen(stage, 'pointermove', event => {
      if (!state.model.periods.length) return;
      if(touchPoints.has(event.pointerId))touchPoints.set(event.pointerId,{x:event.clientX,y:number(event.clientY)||0});
      if(pinch){const pair=touchPair();if(pair.length===2){event.preventDefault?.();const [a,b]=pair,zoom=Math.max(1,Math.min(4,pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance)),anchor=eventX({clientX:(a.x+b.x)/2});setView(zoom,anchor-geometry.left-pinch.world*zoom);}return;}
      const drag=state.drag;
      if(event.pointerType==='touch'&&touchPoints.size&&!drag)return;
      if(drag&&drag.id===event.pointerId){const dx=event.clientX-drag.start,dy=(number(event.clientY)||0)-drag.startY;if(Math.hypot(dx,dy)>4)drag.moved=true;if(!drag.panning&&Math.abs(dx)>4&&(!drag.touch||Math.abs(dx)>Math.abs(dy)*1.2)){drag.panning=true;stage.setPointerCapture?.(event.pointerId);setPanning(true);}if(drag.panning){event.preventDefault?.();const rect=stage.getBoundingClientRect();setView(drag.zoom,drag.startOffset+dx*geometry.width/(rect.width||1),{elastic:true});}return;}
      followPreview=true;hoverGuide(event);
    },{passive:false});
    const endDrag = event => {
      touchPoints.delete(event.pointerId);
      if(pinch){pinch=null;state.drag=null;setPanning(false);setView(zoomTarget,offsetTarget);if(stage.hasPointerCapture?.(event.pointerId))stage.releasePointerCapture?.(event.pointerId);return;}
      const drag=state.drag;if(!drag||drag.id!==event.pointerId)return;state.drag=null;
      if(stage.hasPointerCapture?.(event.pointerId))stage.releasePointerCapture?.(event.pointerId);setPanning(false);
      if(drag.panning){setView(zoomTarget,offsetTarget);return;}
      if(event.type!=='pointercancel'&&!drag.moved){if(drag.pointKey){const split=drag.pointKey.lastIndexOf('|'),traceKey=drag.pointKey.slice(0,split),index=Number(drag.pointKey.slice(split+1)),trace=state.model.series.find(item=>item.key===traceKey);if(trace?.points[index])selectPoint(trace,trace.points[index]);}else choose(eventIndex({clientX:drag.start}),true);}
      selectGuide(xAt(state.selected));
    };
    listen(stage,'pointerup',endDrag);listen(stage,'pointercancel',event=>{endDrag(event);leaveGuide();});listen(stage,'pointerleave',()=>{if(!state.drag&&!pinch){leaveGuide();preview(state.selected);}});
    listen(view,'blur',()=>{if(railDragId!==null&&slider.hasPointerCapture?.(railDragId))slider.releasePointerCapture?.(railDragId);if(state.drag&&stage.hasPointerCapture?.(state.drag.id))stage.releasePointerCapture?.(state.drag.id);for(const id of touchPoints.keys())if(stage.hasPointerCapture?.(id))stage.releasePointerCapture?.(id);touchPoints.clear();pinch=null;state.drag=null;railDragId=null;railDragX=null;setPanning(false);leaveGuide();offsetTarget=clampOffset(offsetTarget,zoomTarget);selectedTarget=xAt(state.selected);cancelGuides(true);preview(state.selected);});
    const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(() => { if (!state.destroyed && Math.abs(root.clientWidth - state.width) > 1 && root.clientWidth > 0) draw(); }) : null;
    observer?.observe(root); if (!observer) listen(view, 'resize', () => { if (root.clientWidth > 0) draw(); });
    return {
      update(model = {}) { if (state.destroyed) return; const next = prepare(model); if (JSON.stringify(next.periods) !== JSON.stringify(state.model.periods)) { state.drag = null; railDragId = null; railDragX = null;touchPoints.clear();pinch=null;timeZoom=zoomTarget=1;timeOffset=offsetTarget=0;selectedPosition=null;leaveGuide();setPanning(false);cancelGuides(); } if (!next.series.some(trace => trace.key === state.activeTraceKey)) { state.activeTraceKey = null; state.activeTracePeriod = null; } if (state.pinnedPoint && (state.pinnedPoint.period !== key(next.period) || !next.series.some(trace => trace.key === state.pinnedPoint.traceKey))) state.pinnedPoint = null; state.model = next; state.selected = next.selectedIndex; draw(); return state.model; },
      getView(){return {zoom:timeZoom,offset:timeOffset,zoomTarget,offsetTarget};},
      destroy() { if (state.destroyed) return; state.destroyed = true; cancelGuides(); lifetime.abort(); renderLifetime.abort(); observer?.disconnect(); state.drag = null;touchPoints.clear();pinch=null;viewControls.remove();root.remove(); }
    };
  }
  window.HX_ANALYSIS_CANVAS = Object.freeze({ create, prepare });
})();
