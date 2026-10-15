(function (root) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const year = value => `FY${String(value).slice(-2)}`;
  const CASE_KEY = 'ppc-blueprint-local-cases-v1';
  function create(hooks) {
    const state = hooks.state, $ = selector => document.querySelector(selector);
    const normalizeTool = tool => tool === 'decisions' ? 'insights' : tool;
    state.overlay = normalizeTool(state.overlay);
    let model, chart, lastOverlay, inlineDetail, fingerprint, fingerprintSource, savedCases = [], sourceToken = 0;
    try { const cases = JSON.parse(localStorage.getItem(CASE_KEY) || '[]'); savedCases = Array.isArray(cases) ? cases.filter(item => item?.version === 1 && typeof item.name === 'string' && item.baseline?.series?.length).slice(-12) : []; } catch (_) {}
    const format = (value, metric, precise) => hooks.format(value, metric === 'units' ? 'units' : 'currency', precise);
    const metricSpec = root.HX_WORKSPACE_MODEL.metrics;
    const valueText = (value, metric, precise = true) => finite(value) ? format(value, metric, precise) : 'Unavailable';
    const basisLabel = point => ({actual:'Actual',history:'History',projection:'Plan',plan:'Plan',scenario:'Scenario',unclassified:'Unclassified'}[point?.kind] || 'Unclassified');
    const coverageLabel = point => point?.coverage && !point.coverage.complete ? `${finite(point.value)?'Known subtotal · ':''}${point.coverage.availableCount}/${point.coverage.selectedCount} reported` : '';
    $('#analysis-toolbar').innerHTML = `<div class="analysis-metrics" role="group" aria-label="Measures to overlay">${Object.entries(metricSpec).map(([key, metric]) => `<button type="button" data-analysis-metric="${key}" aria-pressed="false" style="--metric-color:${metric.color}">${metric.label}</button>`).join('')}</div><div class="analysis-scale" role="group" aria-label="Chart scale"><button type="button" data-analysis-scale="values">Values</button><button type="button" data-analysis-scale="trend">Indexed trend</button></div>`;
    $('#analysis-connectivity').innerHTML = `<div class="analysis-connectivity" role="group" aria-label="Connectivity scope">${[['all','All connections'],['wired','Wired'],['wireless','Wireless'],['both','Hybrid'],['unclassified','Unclassified']].map(([value,label]) => `<button type="button" data-analysis-connection="${value}" aria-pressed="false">${label}<span data-connection-count="${value}"></span></button>`).join('')}<button type="button" data-compare-connectivity>Compare wired / wireless</button></div><p class="analysis-connection-note" id="analysis-connection-note"></p>`;
    function currentScopeLabel() { return model.selected.length ? `${model.selected.length} selected ${hooks.drill()?.scope?.level === 'project' ? 'SKUs' : hooks.drill()?.scope?.level === 'group' ? 'projects' : 'products'}` : (state.connectivity || []).includes('all') ? hooks.scopeLabel() : (state.connectivity || []).join(' + '); }
    function scenarioCurrent(metric) {
      const p = model.summary[metric], revenue = model.summary.revenue.value, gp = model.summary.grossProfit.value;
      if (!finite(p?.value)) return null;
      if (['actual','history'].includes(p.kind) || Number(state.period) < Number(state.scenarioStart || state.period)) return p.value;
      if (metric === 'revenue') return p.value * (1 + state.revenueGrowth / 100);
      if (metric === 'budget') return p.value * (1 + state.budgetChange / 100);
      if (metric === 'grossProfit') return model.summary.grossProfit.coverage?.revenueAligned===false ? null : finite(revenue) && revenue !== 0 && finite(gp) ? revenue * (1 + state.revenueGrowth / 100) * (gp / revenue + state.marginChange / 100) : state.marginChange === 0 && finite(gp) ? gp * (1 + state.revenueGrowth / 100) : null;
      return p.value;
    }
    function renderSummary() {
      $('#analysis-summary').innerHTML = Object.entries(metricSpec).map(([key, spec]) => {
        const p = model.summary[key], partial = p.coverage && !p.coverage.complete, result = scenarioCurrent(key);
        const changed = state.scenarioEnabled && key !== 'units' && finite(result) && finite(p.value) && Math.abs(result-p.value)>Number.EPSILON*8*Math.max(1,Math.abs(result),Math.abs(p.value));
        const coverage = partial ? `${finite(p.value)?'Known subtotal · ':''}${p.coverage.availableCount}/${p.coverage.selectedCount} reported` : '';
        const note = changed ? `Scenario ${format(result,key)}` : '',metadata=[currentScopeLabel(),basisLabel(p),p.basis,coverage].filter(Boolean).join(' · ');
        return `<button type="button" class="analysis-summary-item" data-analysis-summary="${key}" title="${escape(metadata)}" aria-label="${spec.label}, ${year(state.period)}: ${finite(p.value)?format(p.value,key,true):'Unavailable'}. ${escape(metadata)}. Show evidence."><span class="analysis-summary-label">${spec.label}</span><strong class="analysis-summary-value">${finite(p.value)?format(p.value,key):'Unavailable'}</strong>${note?`<small>${note}</small>`:''}</button>`;
      }).join('');
    }
    function updateChart() {
      const series = [...model.series];
      if (state.scenarioEnabled) series.push(...root.HX_WORKSPACE_MODEL.scenarioSeries(model,state).filter(trace=>trace.points.some(point=>finite(point.value)&&Math.abs(point.value-point.baselineValue)>Number.EPSILON*8*Math.max(1,Math.abs(point.value),Math.abs(point.baselineValue)))));
      if (!chart) chart = root.HX_ANALYSIS_CANVAS.create($('#analysis-chart'), { viewControlsContainer:$('#analysis-chart-controls'),onPeriod: hooks.selectPeriod, onPoint: showPoint, onEntity(entity) { const matches=model.catalog.filter(child=>child.id===entity.id);if(matches.length!==1)return false;hooks.selectScope(matches[0]);return true; } });
      const chartSeries=series.map(trace=>{const id=trace.displayEntityId??(trace.estimate?trace.reportedEntityId:trace.entityId),matches=model.catalog.filter(child=>child.id===id);return {...trace,entityDetailLevel:matches.length===1?matches[0].level||'product':null};});
      const comparison=model.selected.length>=2?{entities:model.selected.map(child=>({id:child.id,name:child.name||child.id,revenuePoints:model.allSeries.find(trace=>trace.entityId===child.id&&trace.metric==='revenue'&&!trace.scenario&&!trace.estimate)?.points||[],unitsPoints:model.allSeries.find(trace=>trace.entityId===child.id&&trace.metric==='units'&&!trace.scenario&&!trace.estimate)?.points||[]}))}:null;
      const yoyMetric=state.metrics.includes('revenue')?'revenue':state.metrics.find(metric=>model.allSeries.some(trace=>trace.metric===metric))||'revenue',yoyTraces=model.allSeries.filter(trace=>trace.metric===yoyMetric&&!trace.scenario&&!trace.estimate);
      const yoyPoints=yoyTraces.length===1?yoyTraces[0].points:root.HX_WORKSPACE_MODEL.combine(yoyTraces.map(trace=>trace.points),model.periods,Boolean(model.selected.length),`${currentScopeLabel()} source ${metricSpec[yoyMetric]?.label||yoyMetric}`,yoyTraces.map(trace=>trace.entityId));
      const yoy={metric:yoyMetric,label:currentScopeLabel(),points:yoyPoints.map(point=>{const sourceCoverage=yoyTraces.map(trace=>({entityId:trace.entityId,coverage:trace.points.find(record=>String(record.period)===String(point.period))?.coverage||null}));return {...point,sourceCoverage,coverage:sourceCoverage.some(record=>record.coverage?.complete===false)?{...point.coverage,complete:false}:point.coverage};})};
      const rendered = chart.update({ periods: model.periods, period: state.period, series:chartSeries,comparison,yoy,scale: state.comparisonScale, title: `${currentScopeLabel()} · financial performance` });
      const effectiveScale = rendered?.scale || state.comparisonScale || 'values';
      for (const button of document.querySelectorAll('[data-analysis-scale]')) button.setAttribute('aria-pressed',String(effectiveScale===button.dataset.analysisScale));
      renderSummary();
    }
    function renderSelectionColors() {
      const color = filter => root.HX_WORKSPACE_MODEL.selectionColor?.(model,filter) || '#969eac';
      $('#portfolio-explorer').style.setProperty('--workspace-scope-color',color({}));
      for (const button of document.querySelectorAll('[data-analysis-metric]')) button.style.setProperty('--metric-color',color({metric:button.dataset.analysisMetric}));
      for (const button of document.querySelectorAll('[data-analysis-connection]')) button.style.setProperty('--selection-color',color(button.dataset.analysisConnection==='all'?{}:{entityId:'connection-'+button.dataset.analysisConnection}));
      for (const button of document.querySelectorAll('#category-explorer [data-category][aria-pressed="true"]')) button.style.setProperty('--category-color',color({entityId:button.dataset.category==='all'?'scope':'category-'+button.dataset.category}));
    }
    function showPoint(detail) {
      const rawPoint = detail.point || detail, point={...rawPoint,value:detail.rawValue ?? detail.value ?? rawPoint.rawValue ?? rawPoint.value}, trace = detail.series || model.series.find(trace => trace.id === detail.seriesId) || {};
      const label = metricSpec[trace.metric || detail.metric]?.label || 'Source result';
      const metadata=[point.basis||basisLabel(point),point.coverage?`${point.coverage.availableCount}/${point.coverage.selectedCount} reported`:'',trace.scenario?point.formula||'Unavailable':'',trace.scenario?`Revenue ${state.revenueGrowth}% · margin ${state.marginChange} pp · PD ${state.budgetChange}%`:''].filter(Boolean).join(' · ');
      showDetail(`${label} · ${year(point.period)}`, `<div class="analysis-point-detail" title="${escape(metadata)}" aria-label="${escape(trace.name || currentScopeLabel())}, ${valueText(point.value,trace.metric)}. ${escape(metadata)}"><strong class="analysis-point-scope">${escape(trace.name || currentScopeLabel())}</strong><strong data-inline-point-value>${valueText(point.value, trace.metric)}</strong><span class="analysis-point-metadata hac-sr-only">${escape(metadata)}</span></div>${trace.scenario ? `<div class="scenario-comparison"><span>Source → Scenario</span><strong>${valueText(point.baselineValue, trace.metric)} → ${valueText(point.value,trace.metric)}</strong></div>` : ''}<div class="detail-section"><h3>Source cells</h3>${hooks.evidence(point.source || [])}</div>`, trace.scenario ? 'SCENARIO CALCULATION' : 'SOURCE DETAIL');
    }
    async function identifySource(data) {
      if (fingerprintSource === data) return;
      fingerprintSource = data; fingerprint = null; const token = ++sourceToken;
      const text = JSON.stringify({schemaVersion:data.schemaVersion,sourceGrainVersion:data.sourceGrainVersion,periods:data.periods,products:data.products,projects:data.projects,npiSkuRecords:data.npiSkuRecords,investments:data.investments,prelaunchCases:data.prelaunchCases,npiValues:data.npiValues,published:data.published,tam:data.tam,decisions:data.decisions,actualsCutoff:data.actualsCutoff,fiscalCalendar:data.fiscalCalendar});
      const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
      if (token === sourceToken) { fingerprint = [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''); if (state.overlay === 'scenarios') renderOverlay(true); }
    }
    function scenarioPanel() {
      const controls = [['revenueGrowth','Revenue change','%',-30,30,.5,'revenue'],['marginChange','Raw GM change','pp',-10,10,.1,'grossProfit'],['budgetChange','PD investment change','%',-30,30,.5,'budget']];
      return `<div class="analysis-scenario-panel"><div class="analysis-scenario-setup"><label class="analysis-tools-switch"><input type="checkbox" id="analysis-scenario-enabled" ${state.scenarioEnabled ? 'checked' : ''}> Show scenario</label><label class="analysis-start-label">Apply from<select id="analysis-scenario-start">${model.periods.map(period => `<option value="${escape(period)}" ${String(period)===String(state.scenarioStart || state.period)?'selected':''}>${year(period)}</option>`).join('')}</select></label><button type="button" class="button" data-analysis-reset>Reset assumptions</button></div><div class="analysis-scenario-controls">${controls.map(([key,label,unit,min,max,step,metric])=>{
        const eligible = finite(model.summary[metric]?.value) && (key !== 'marginChange' || finite(model.summary.revenue?.value) && model.summary.revenue.value !== 0 && model.summary.grossProfit.coverage?.revenueAligned!==false);
        return `<div class="slider-control"><div class="slider-label"><label for="analysis-${key}">${label}</label><span><input aria-label="${label} exact value" class="analysis-exact-input" type="number" min="${min}" max="${max}" step="${step}" value="${state[key]}" data-analysis-exact="${key}" ${eligible?'':'disabled'}> ${unit}</span></div><input id="analysis-${key}" data-analysis-driver="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${state[key]}" ${eligible?'':'disabled'}><div class="slider-range"><span>${min} ${unit}</span><span>${max} ${unit}</span></div>${eligible?'':'<span class="analysis-unavailable">Unavailable baseline</span>'}</div>`;
      }).join('')}</div><div class="analysis-scenario-outcomes"><h3>${year(state.period)} · Source → Scenario</h3><div class="analysis-scenario-results">${Object.keys(metricSpec).filter(key=>key!=='units').map(key=>`<button type="button" class="scenario-comparison" data-analysis-simulated="${key}" title="${escape(model.summary[key].basis||basisLabel(model.summary[key]))}"><span>${metricSpec[key].label}</span><span>${valueText(model.summary[key].value,key)} → <strong data-scenario-result="${key}">${valueText(scenarioCurrent(key),key)}</strong></span></button>`).join('')}</div><div class="analysis-case-toolbar"><label>Case name<input id="analysis-case-name" maxlength="80" placeholder="e.g. FY27 demand downside"></label><button type="button" class="button" data-analysis-save ${fingerprint?'':'disabled'}>${fingerprint?'Save local case':'Preparing source identity…'}</button></div><div class="analysis-saved-cases">${savedCases.map((item,index)=>`<div class="analysis-saved-case"><button type="button" data-analysis-case="${index}">${escape(item.name)}</button><small>${escape(item.scopeLabel)} · ${new Date(item.created).toLocaleDateString()}${fingerprint && fingerprint!==item.fingerprint?' · earlier source snapshot':''}</small></div>`).join('')}</div></div></div>`;
    }
    function insightsPanel() {
      const previous = Number(state.period) - 1;
      const changes = Object.entries(metricSpec).map(([metric,spec])=>{
        const current = model.summary[metric], traces = model.allSeries.filter(trace=>trace.metric===metric);
        const before = root.HX_WORKSPACE_MODEL.combine(traces.map(trace=>trace.points),model.periods,Boolean(model.selected.length),'Matching source scope').find(point=>Number(point.period)===previous);
        const change = finite(current.value) && finite(before?.value) ? current.value-before.value : null;
        const beforeBasis=[finite(before?.value)?basisLabel(before):'',coverageLabel(before)].filter(Boolean).join(' · '),currentBasis=[basisLabel(current),coverageLabel(current)].filter(Boolean).join(' · '),signedChange=finite(change)?`${change>0?'+':''}${valueText(change,metric)}`:'Unavailable',direction=!finite(change)?'unavailable':change>0?'positive':change<0?'negative':'neutral',directionLabel=direction==='positive'?'Increase':direction==='negative'?'Decrease':direction==='neutral'?'No change':'Unavailable';
        return `<section class="analysis-movement-item" data-analysis-movement="${metric}" aria-label="${spec.label} movement · ${escape(currentScopeLabel())}"><h4 class="analysis-movement-label">${spec.label}</h4><div class="analysis-movement-periods"><div class="analysis-movement-period" title="${escape(before?.basis||beforeBasis)}" aria-label="${spec.label}, ${year(previous)}, ${valueText(before?.value,metric)}"><strong class="analysis-movement-value">${finite(before?.value)?valueText(before.value,metric):'—'}</strong><small class="analysis-movement-basis hac-sr-only">${escape(beforeBasis)}</small></div><button type="button" class="analysis-movement-current" data-analysis-summary="${metric}" title="${escape(current.basis||currentBasis)}" aria-label="${spec.label}, ${year(state.period)}, ${valueText(current.value,metric)}, ${escape(currentScopeLabel())}. ${escape(currentBasis)}. Show source evidence."><strong class="analysis-movement-value">${finite(current.value)?valueText(current.value,metric):'—'}</strong><small class="analysis-movement-basis hac-sr-only">${escape(currentBasis)}</small></button></div><div class="analysis-movement-change is-${direction}" data-change-direction="${direction}" aria-label="${directionLabel}: ${signedChange}"><span>Change</span><strong>${finite(change)?signedChange:'—'}</strong></div></section>`;
      });
      const ranking = [...(model.selected.length?model.selected:model.visibleCatalog)].filter(child=>finite(child.revenue)).sort((a,b)=>b.revenue-a.revenue).slice(0,8);
      const highest=ranking[0]?.revenue,lowest=ranking[ranking.length-1]?.revenue;
      const contributorInk=value=>{const scale=Math.max(1,Math.abs(highest),Math.abs(lowest)),range=highest/scale-lowest/scale,t=highest===lowest?1:Math.max(0,Math.min(1,(value/scale-lowest/scale)/range));return '#'+[157,167,182].map((channel,index)=>Math.round(channel+([237,240,245][index]-channel)*t).toString(16).padStart(2,'0')).join('');};
      const s = model.summary, margin = s.grossProfit.coverage?.revenueAligned===false ? null : finite(s.revenue.value) && s.revenue.value !== 0 && finite(s.grossProfit.value) ? s.grossProfit.value/s.revenue.value : null;
      const economics = Object.entries(metricSpec).map(([metric,spec])=>`<button type="button" class="scenario-comparison" data-analysis-summary="${metric}" title="${escape([s[metric].basis||basisLabel(s[metric]),coverageLabel(s[metric])].filter(Boolean).join(' · '))}" aria-label="${spec.label}, ${valueText(s[metric].value,metric)}. ${escape([s[metric].basis||basisLabel(s[metric]),coverageLabel(s[metric])].filter(Boolean).join(' · '))}"><span>${spec.label}</span><strong>${valueText(s[metric].value,metric)}</strong></button>`).join('');
      return `<div class="analysis-insights-decisions"><section class="analysis-contributors-column"><h3>Revenue contributors · ${year(state.period)}</h3><div class="analysis-contributor-list">${ranking.map(child=>`<button type="button" class="scenario-comparison" data-analysis-explore="${escape(child.id)}" title="${escape(child.name)} · ${escape(child.id)}" style="--contributor-ink:${contributorInk(child.revenue)}"><span>${escape(child.name)}</span><strong>${valueText(child.revenue,'revenue')}</strong></button>`).join('')||'<span class="analysis-unavailable">Unavailable</span>'}</div></section><section class="analysis-insight-column"><h3>Period movement</h3><div class="analysis-movement-header" aria-hidden="true"><span></span><span>${year(previous)}</span><span>${year(state.period)}</span><span>Change</span></div><div class="analysis-movement-grid">${changes.join('')}</div></section><section class="analysis-economics-column"><h3>${year(state.period)} economics</h3><div class="analysis-selected-economics">${economics}<div class="scenario-comparison"><span>Raw gross margin</span><strong>${margin===null?'Unavailable':(margin*100).toFixed(1)+'%'}</strong></div></div><button type="button" class="text-link" data-analysis-economics>Full economics evidence</button></section></div>`;
    }
    function evidencePanel() {
      return `<div class="analysis-selection-evidence"><h3>${escape(currentScopeLabel())} · ${year(state.period)}</h3>${Object.entries(metricSpec).map(([key,spec])=>`<button type="button" class="scenario-comparison" data-analysis-summary="${key}" title="${escape([model.summary[key].basis||basisLabel(model.summary[key]),coverageLabel(model.summary[key])].filter(Boolean).join(' · '))}" aria-label="${spec.label}, ${valueText(model.summary[key].value,key)}. ${escape([model.summary[key].basis||basisLabel(model.summary[key]),coverageLabel(model.summary[key])].filter(Boolean).join(' · '))}"><span>${spec.label}</span><strong>${valueText(model.summary[key].value,key)}</strong></button>`).join('')}<button type="button" class="button" data-analysis-tool="source">Data &amp; quality</button></div>`;
    }
    function showDetail(title, content, eyebrow = 'SOURCE DETAIL', tool = 'evidence') {
      tool = normalizeTool(tool);
      inlineDetail = { title, content, eyebrow, tool };
      state.overlay = tool;
      renderOverlay(true);
      hooks.notify();
    }
    function renderOverlay(force) {
      const dock = $('#analysis-overlay'), overlay = state.overlay = normalizeTool(state.overlay);
      for (const button of document.querySelectorAll('[data-analysis-tool]')) {
        button.setAttribute('aria-expanded',String(normalizeTool(button.dataset.analysisTool)===overlay));
        button.setAttribute('aria-pressed',String(normalizeTool(button.dataset.analysisTool)===overlay));
      }
      dock.hidden = !overlay;
      $('#analysis-graph-shell').classList.toggle('has-analysis-dock',Boolean(overlay));
      if (!overlay) { lastOverlay = null; inlineDetail = null; return; }
      if (lastOverlay === overlay && !force) return;
      const labels = { scenarios:'Scenario assumptions', insights:'Insights', evidence:'Evidence', source:'Data & quality' };
      const detail = inlineDetail?.tool === overlay ? inlineDetail : null;
      $('#analysis-overlay-title').textContent = detail?.title || labels[overlay] || 'Analysis';
      $('#analysis-overlay-body').innerHTML = detail ? `<button type="button" class="text-link analysis-detail-back" data-analysis-detail-back>Back to ${escape((labels[overlay] || 'Analysis').toLowerCase())}</button>${detail.content}` : ({ scenarios:scenarioPanel, insights:insightsPanel, evidence:evidencePanel, source:hooks.sourceContent }[overlay] || evidencePanel)();
      lastOverlay = overlay;
    }
    function update() {
      state.overlay = normalizeTool(state.overlay);
      inlineDetail = null;
      model = root.HX_WORKSPACE_MODEL.build(hooks.data(),hooks.engine(),state,hooks.drill());
      api.model = model;
      if (!state.scenarioStart) state.scenarioStart = state.period;
      hooks.renderProducts(); hooks.renderCategories();
      renderSelectionColors();
      $('#explorer-selection').textContent = `${currentScopeLabel()} · ${year(state.period)}`;
      for (const button of document.querySelectorAll('[data-analysis-metric]')) button.setAttribute('aria-pressed',String(state.metrics.includes(button.dataset.analysisMetric)));
      const options = root.HX_CONNECTIVITY?.options(hooks.data(),model.catalog) || [];
      for (const button of document.querySelectorAll('[data-analysis-connection]')) button.setAttribute('aria-pressed',String(state.connectivity.includes(button.dataset.analysisConnection)));
      for (const option of options) { const count = document.querySelector(`[data-connection-count="${option.value}"]`); if (count) count.textContent = ` ${option.count}`; }
      $('#analysis-connection-note').textContent = model.invalidSelectionReason || (model.coverage?.excludedCount ? `${model.coverage.excludedCount} unmapped tracker group excluded.` : '');
      $('#analysis-connection-note').classList.toggle('is-issue',Boolean(model.invalidSelectionReason||model.coverage?.excludedCount));
      updateChart(); renderOverlay(true);
      identifySource(hooks.data()).catch(()=>hooks.toast('Source identity could not be prepared. Case saving is unavailable; the chart is unchanged.'));
    }
    function action(event) {
      const target = event.target.closest('button'); if (!target) return;
      const metric = target.dataset.analysisMetric;
      if (metric) { if (state.metrics.includes(metric) && state.metrics.length===1) return hooks.toast('Keep at least one measure visible.'); state.metrics=state.metrics.includes(metric)?state.metrics.filter(key=>key!==metric):[...state.metrics,metric]; hooks.redraw(); return; }
      if (target.dataset.analysisScale) { state.comparisonScale=target.dataset.analysisScale; hooks.redraw(); return; }
      if (target.dataset.analysisTool) { const tool=normalizeTool(target.dataset.analysisTool);inlineDetail=null;state.overlay=normalizeTool(state.overlay)===tool?null:tool; if(state.overlay==='scenarios')state.scenarioEnabled=true; renderOverlay(true); updateChart(); hooks.notify(); return; }
      if (target.dataset.analysisConnection || target.hasAttribute('data-compare-connectivity')) {
        const value=target.dataset.analysisConnection;
        state.connectivity=target.hasAttribute('data-compare-connectivity')?['wired','wireless']:value==='all'?['all']:state.connectivity.includes(value)?state.connectivity.filter(key=>key!==value):[...state.connectivity.filter(key=>key!=='all'),value];
        if(!state.connectivity.length)state.connectivity=['all'];
        const allowed=new Set(root.HX_CONNECTIVITY.filter(model.catalog,state.connectivity,hooks.data()).map(child=>child.id));state.compareIds=state.compareIds.filter(id=>allowed.has(id));hooks.redraw();return;
      }
      if (target.id==='analysis-overlay-close') { state.overlay=null; renderOverlay(); hooks.notify(); return; }
      if (target.hasAttribute('data-analysis-detail-back')) { inlineDetail=null;renderOverlay(true);return; }
      if (target.hasAttribute('data-analysis-economics')) return showDetail('Parent scope economics', `<div class="detail-grid"><div class="detail-field"><label>Scope</label><strong>${escape(hooks.drill()?.scope?.title || hooks.scopeLabel())} · all connections</strong></div><div class="detail-field"><label>Horizon</label><strong>Source-defined</strong></div></div>${hooks.economics()}`, 'SOURCE ECONOMICS', 'insights');
      if (target.dataset.analysisSummary) return showPoint({point:model.summary[target.dataset.analysisSummary],series:{name:currentScopeLabel(),metric:target.dataset.analysisSummary}});
      if (target.dataset.analysisSimulated) {
        const metric=target.dataset.analysisSimulated, p=model.summary[metric];
        const temporary={periods:model.periods,series:[{id:'aggregate:'+metric,entityId:'aggregate',name:currentScopeLabel(),metric,unit:metricSpec[metric].unit,points:[p]}],allSeries:[{entityId:'aggregate',metric:'revenue',points:[model.summary.revenue]}]};
        const trace=root.HX_WORKSPACE_MODEL.scenarioSeries(temporary,state)[0],point=trace.points[0];
        return showPoint({point,series:trace});
      }
      if (target.hasAttribute('data-analysis-reset')) { state.revenueGrowth=0;state.marginChange=0;state.budgetChange=0;renderOverlay(true);updateChart();hooks.notify();return; }
      if (target.dataset.analysisExplore) return hooks.selectScope(model.catalog.find(child=>child.id===target.dataset.analysisExplore));
      if (target.hasAttribute('data-analysis-save')) return saveCase();
      if (target.dataset.analysisCase!==undefined) return inspectCase(savedCases[Number(target.dataset.analysisCase)]);
    }
    function saveCase() {
      if(!fingerprint)return;
      const name=$('#analysis-case-name')?.value.trim();if(!name){$('#analysis-case-name')?.focus();return hooks.toast('Name this scenario before saving.');}
      const compact=trace=>({...trace,points:trace.points.map(point=>({...point,source:(point.source||[]).slice(0,40),sourceReferenceCount:point.source?.length||0}))});
      const item={version:1,modelVersion:'unified-sensitivity-1',name,created:new Date().toISOString(),fingerprint,sourceName:hooks.data().source?.name,scopeLabel:currentScopeLabel(),scope:{...model.scope,compareIds:[...state.compareIds],connectivity:[...state.connectivity]},period:state.period,metrics:[...state.metrics],assumptions:{revenueGrowth:state.revenueGrowth,marginChange:state.marginChange,budgetChange:state.budgetChange,scenarioStart:state.scenarioStart},baseline:{periods:model.periods,series:model.allSeries.map(compact),estimates:(model.estimates||[]).map(compact)},outcomes:root.HX_WORKSPACE_MODEL.scenarioSeries({...model,series:model.allSeries},state).map(compact)};
      const next=[...savedCases,item].slice(-12);try{localStorage.setItem(CASE_KEY,JSON.stringify(next));savedCases=next;renderOverlay(true);hooks.toast('Scenario saved locally with its baseline and assumptions.');}catch(_){hooks.toast('Local case storage is full. This scenario was not saved.');}
    }
    function inspectCase(item) {
      if(!item)return;
      showDetail(item.name,`<div class="analysis-saved-case-meta"><span>${escape(item.scopeLabel)} · ${year(item.period)}</span><span>Saved ${escape(new Date(item.created).toLocaleString())}</span><strong>${item.fingerprint===fingerprint?'Current source snapshot':'Earlier / different source snapshot · frozen case'}</strong></div><div class="analysis-assumptions">Revenue ${item.assumptions.revenueGrowth}% · raw GM ${item.assumptions.marginChange} pp · PD ${item.assumptions.budgetChange}% · from ${year(item.assumptions.scenarioStart)}</div><div class="table-scroll"><table><thead><tr><th>Entity / measure</th><th>Source baseline</th><th>Saved scenario</th></tr></thead><tbody>${item.outcomes.filter(trace=>item.metrics.includes(trace.metric)).map(trace=>{const result=trace.points.find(point=>String(point.period)===String(item.period));return `<tr><th>${escape(trace.name)} · ${metricSpec[trace.metric].label}</th><td>${valueText(result?.baselineValue,trace.metric)}</td><td>${valueText(result?.value,trace.metric)}</td></tr>`;}).join('')}</tbody></table></div><div class="detail-field"><label>Source identity · ${escape(item.modelVersion)}</label><strong>${escape(item.fingerprint)}</strong></div>`,'SAVED LOCAL CASE','scenarios');
    }
    function input(event) {
      const key=event.target.dataset.analysisDriver||event.target.dataset.analysisExact;
      if(key){if(!event.target.value.trim())return;const value=Number(event.target.value);if(!Number.isFinite(value)||value<Number(event.target.min)||value>Number(event.target.max)){event.target.setCustomValidity('Enter a value within the displayed range.');return;}event.target.setCustomValidity('');state[key]=value;state.scenarioEnabled=true;const peer=document.querySelector(event.target.dataset.analysisDriver?`[data-analysis-exact="${key}"]`:`[data-analysis-driver="${key}"]`);if(peer)peer.value=value;const enabled=$('#analysis-scenario-enabled');if(enabled)enabled.checked=true;updateChart();for(const result of document.querySelectorAll('[data-scenario-result]'))result.textContent=valueText(scenarioCurrent(result.dataset.scenarioResult),result.dataset.scenarioResult);hooks.notify();}
    }
    function change(event){if(event.target.id==='analysis-scenario-enabled'){state.scenarioEnabled=event.target.checked;updateChart();hooks.notify();}if(event.target.id==='analysis-scenario-start'){state.scenarioStart=event.target.value;updateChart();hooks.notify();}}
    document.addEventListener('click',action);document.addEventListener('input',input);document.addEventListener('change',change);
    function keydown(event){if(event.key==='Escape'&&!$('#analysis-overlay').hidden&&!$('#detail-dialog')?.open){event.preventDefault();state.overlay=null;renderOverlay();hooks.notify();}}
    document.addEventListener('keydown',keydown);
    const api={update,model:null,showDetail,open(tool){tool=normalizeTool(tool);inlineDetail=null;state.overlay=tool;if(tool==='scenarios')state.scenarioEnabled=true;renderOverlay(true);updateChart();},close(){state.overlay=null;renderOverlay();},destroy(){chart?.destroy();document.removeEventListener('click',action);document.removeEventListener('input',input);document.removeEventListener('change',change);document.removeEventListener('keydown',keydown);}};
    return api;
  }
  root.HX_UNIFIED_WORKSPACE={create};
})(window);
