(function (root) {
  'use strict';
  const metrics = {
    revenue: { label: 'Revenue', unit: 'currency', color: '#b69aff' },
    units: { label: 'Units', unit: 'units', color: '#42d4df' },
    grossProfit: { label: 'Gross profit', unit: 'currency', color: '#94e5b5' },
    budget: { label: 'PD investment', unit: 'currency', color: '#ffd172' }
  };
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const keyOf = value => String(value || '').trim().toLowerCase();
  const safeSum = values => values.some(finite) ? values.filter(finite).reduce((a, b) => a + b, 0) : null;
  const scopeOf = child => ({ category: child.category, groupId: child.groupId, projectId: child.projectId, skuId: child.skuId });
  let cachedData, models = new Map();
  function reset(data) { if (cachedData !== data) { cachedData = data; models = new Map(); } }
  function modelFor(data, engine, scope) {
    reset(data);
    const key = JSON.stringify(scope);
    if (!models.has(key)) models.set(key, engine.drilldown({ ...scope, period: data.periods?.[0] || 2026 }));
    return models.get(key);
  }
  function selectedPoint(points, period) { return points?.find(point => String(point.period) === String(period)); }
  function sourceSeries(data, engine, scope, metric) {
    const model = modelFor(data, engine, scope);
    let points = model.metricSeries?.[metric] || [];
    if (!scope.groupId && !scope.projectId && !scope.skuId) {
      const chosen = Array.isArray(scope.category) ? scope.category : [scope.category || 'All'];
      const products = (data.products || []).filter(product => chosen.includes('All') || chosen.includes('all') || chosen.includes(product.category));
      const field = { revenue: 'revenueByYear', grossProfit: 'gmByYear', units: 'unitsByYear' }[metric];
      points = points.map(point => {
        const rows = field ? products : (data.investments || []).filter(record => Number(record.period) === Number(point.period) && (chosen.includes('All') || chosen.includes('all') || chosen.includes(record.category)));
        const valueFor = row => field ? row[field]?.[point.period] : row.amount;
        const selectedIds = rows.map((row, index) => String(row.id || `${row.productId || 'source'}:${index}`));
        const availableIds = selectedIds.filter((_, index) => finite(valueFor(rows[index]))), complete = rows.length > 0 && availableIds.length === rows.length;
        return { ...point, source: field ? products.flatMap(product => product.sourceByYear?.[point.period]?.[metric] || []) : point.source || [],
          basis: `${point.basis || 'Saved annual source'}; ${complete ? 'complete source coverage' : `known source subtotal (${availableIds.length}/${rows.length} reported); missing values are not zero`}`,
          coverage: { complete, selectedCount: rows.length, availableCount: availableIds.length, missingCount: rows.length - availableIds.length, selectedIds, availableIds, missingIds: selectedIds.filter((_, index) => !finite(valueFor(rows[index]))) }
        };
      });
    }
    return points.map(point => ({ ...point, value: finite(point.value) ? point.value : null }));
  }
  function combine(series, periods, strict, label, identities) {
    return periods.map(period => {
      const points = series.map(points => selectedPoint(points, period));
      const available = points.filter(point => finite(point?.value)), complete = points.length > 0 && available.length === points.length;
      const kinds = [...new Set((available.length ? available : points.filter(Boolean)).map(point => point.kind))];
      const selectedIds = Array.isArray(identities) && identities.length === points.length ? identities.map(String) : points.map((_, index) => String(index));
      const availableIds = selectedIds.filter((_, index) => finite(points[index]?.value));
      return {
        period, value: strict && !complete ? null : safeSum(available.map(point => point.value)),
        kind: kinds.length === 1 ? kinds[0] : 'unclassified',
        source: points.flatMap(point => point?.source || []),
        basis: `${label}; ${complete ? 'complete source coverage' : `known source subtotal (${available.length}/${points.length} reported); missing values are not zero`}`,
        coverage: { complete, selectedCount: points.length, availableCount: available.length, missingCount: points.length - available.length, selectedIds, availableIds, missingIds: selectedIds.filter((_, index) => !finite(points[index]?.value)) }
      };
    });
  }
  function alignGrossProfit(points, revenuePoints) {
    return points.map(point => {
      const revenue = selectedPoint(revenuePoints, point.period);
      if (!point.coverage || !revenue?.coverage) return point;
      const matched = point.coverage.availableIds.length === revenue.coverage.availableIds.length && point.coverage.availableIds.every(id => revenue.coverage.availableIds.includes(id));
      return { ...point, coverage: { ...point.coverage, revenueAligned: matched } };
    });
  }
  function build(data, engine, state, drill) {
    reset(data);
    const scope = { category: state.category?.includes('all') ? 'All' : state.category, groupId: state.groupId, projectId: state.projectId, skuId: state.skuId };
    const periods = [...new Set([...(data.periods || []), ...Object.values(drill?.metricSeries || {}).flatMap(points => points.map(point => point.period))])].sort((a, b) => Number(a) - Number(b));
    const catalog = (drill?.children || []).map(child => {
      const detail = modelFor(data, engine, scopeOf(child));
      for (const point of detail.estimateSeries || []) if (!periods.includes(point.period)) periods.push(point.period);
      return { ...child, budget: selectedPoint(detail.metricSeries?.budget, state.period)?.value ?? null };
    });
    periods.sort((a, b) => Number(a) - Number(b));
    const connectivity = state.connectivity?.length ? state.connectivity : ['all'];
    const connectionActive = !connectivity.includes('all');
    const visibleCatalog = root.HX_CONNECTIVITY ? root.HX_CONNECTIVITY.filter(catalog, connectivity, data) : catalog;
    // Unmapped tracker rows stay discoverable, but are a different population
    // from annual product-group finance and cannot join its connectivity totals.
    const excludedCatalog = visibleCatalog.filter(child => child.level === 'group' && child.id === 'source-unmapped');
    const cohortCatalog = visibleCatalog.filter(child => !excludedCatalog.includes(child));
    const requestedIds = state.compareIds == null ? [] : state.compareIds;
    const malformedIds = !Array.isArray(requestedIds) || requestedIds.length > 50 || requestedIds.some(id => typeof id !== 'string' || !id || id.length > 240 || /[\u0000-\u001f\u007f]/.test(id));
    const ids = new Set(malformedIds ? [] : requestedIds);
    const invalidIds = [...ids].filter(id => visibleCatalog.filter(child => child.id === id).length !== 1 || excludedCatalog.some(child => child.id === id));
    const invalidSelection = malformedIds || invalidIds.length > 0;
    const invalidSelectionReason = invalidSelection ? 'A selected product is unavailable, ambiguous, or outside the current source population. Choose visible sibling items again; parent totals have not been substituted.' : '';
    const selected = invalidSelection ? [] : visibleCatalog.filter(child => ids.has(child.id));
    const requestedMetrics = [...new Set((Array.isArray(state.metrics) ? state.metrics : ['revenue']).filter(metric => metrics[metric]))];
    let entities;
    if (invalidSelection) entities = [];
    else if (selected.length) entities = selected.map(child => ({ id: child.id, name: child.level === 'group' ? child.name : `${child.name || child.id}${child.skuId ? ' · ' + child.skuId : ''}`, scope: scopeOf(child), child }));
    else if (connectionActive) {
      entities = (root.HX_CONNECTIVITY?.cohorts(cohortCatalog, data) || []).filter(cohort => cohort.count).map(cohort => ({ id: 'connection-' + cohort.value, name: cohort.label, children: cohort.children }));
    } else if (!state.groupId && !state.projectId && state.category?.length > 1 && !state.category.includes('all')) {
      entities = state.category.map(category => ({ id: 'category-' + category, name: category, scope: { category } }));
    } else entities = [{ id: state.skuId || state.projectId || state.groupId || (state.category?.length===1&&!state.category.includes('all')?'category-'+state.category[0]:'scope'), name: drill?.scope?.title || 'All categories', scope }];
    const palette = ['#b69aff', '#42d4df', '#94e5b5', '#ffd172', '#8fa9ff', '#ed9bad', '#d6aff0', '#91c7c1'];
    function colorFor(id) {
      if (id === 'connection-wired') return '#42d4df';
      if (id === 'connection-wireless') return '#b69aff';
      if (id.startsWith('category-')) {const categories=data.categories||[],index=categories.indexOf(id.slice(9));if(index>=0)return ['#895EF6','#6984ED','#4DA1F7','#20CBDD','#7AE3A9','#FFC63B'][index%6];}
      let hash = 0; for (const c of id) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
      return palette[hash % palette.length];
    }
    function traceColorFor(id, metric) {
      const metricIndex = ['revenue', 'units', 'grossProfit', 'budget'].indexOf(metric);
      const connections = {
        'connection-wired': ['#42d4df', '#86bdff', '#94e5b5', '#ffd172'],
        'connection-wireless': ['#b69aff', '#f195d1', '#ffab82', '#d6df87']
      };
      if (connections[id]) return connections[id][metricIndex];
      let hash = 0; for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
      hash = Math.imul(hash ^ hash >>> 16, 0x45d9f3b); hash = Math.imul(hash ^ hash >>> 16, 0x45d9f3b); hash = (hash ^ hash >>> 16) >>> 0;
      // Each identity has a stable hue, with four well-separated metric hues.
      // This is independent of visible metrics, selection order and sorting.
      const hue = ((hash % 36000) / 100 + metricIndex * 87.5) % 360, saturation = .72, lightness = .72;
      const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation, secondary = chroma * (1 - Math.abs(hue / 60 % 2 - 1)), offset = lightness - chroma / 2;
      const channels = hue < 60 ? [chroma, secondary, 0] : hue < 120 ? [secondary, chroma, 0] : hue < 180 ? [0, chroma, secondary] : hue < 240 ? [0, secondary, chroma] : hue < 300 ? [secondary, 0, chroma] : [chroma, 0, secondary];
      return '#' + channels.map(value => Math.round((value + offset) * 255).toString(16).padStart(2, '0')).join('');
    }
    for (const child of catalog) child.entityColor = colorFor(child.id);
    const allSeries = entities.flatMap(entity => Object.keys(metrics).map(metric => ({
      id: entity.id + ':' + metric, entityId: entity.id, name: entity.name, metric, unit: metrics[metric].unit, entityColor: colorFor(entity.id), color: traceColorFor(entity.id, metric),
      points: entity.children ? combine(entity.children.map(child => sourceSeries(data, engine, scopeOf(child), metric)), periods, false, entity.name + ' source cohort', entity.children.map(child => child.id)) : sourceSeries(data, engine, entity.scope, metric)
    })));
    for (const trace of allSeries.filter(trace => trace.metric === 'grossProfit')) trace.points = alignGrossProfit(trace.points, allSeries.find(other => other.entityId === trace.entityId && other.metric === 'revenue')?.points);
    const estimates = entities.flatMap(entity => {
      const members = entity.children ? entity.children.map(child => ({ id: child.id, name: child.projectId || child.name || child.id, scope: scopeOf(child) })) : [entity];
      return members.flatMap(member => {
        const detail = modelFor(data, engine, member.scope), points = detail.estimateSeries || [];
        if (!points.some(point => finite(point.value))) return [];
        return [{ id: member.id + ':launch-plan:revenue', entityId: member.id + ':launch-plan', reportedEntityId: member.id, displayEntityId: entity.id, displayName: entity.name, name: member.name + ' · launch-year source plan', metric: 'revenue', unit: 'currency', entityColor: colorFor(entity.id), color: traceColorFor(entity.id, 'revenue'), estimate: true,
          points: points.map(point => ({ ...point, value: finite(point.value) ? point.value : null })) }];
      });
    });
    const summary = Object.fromEntries(Object.keys(metrics).map(metric => {
      const points = invalidSelection ? periods.map(period => ({ period, value: null, kind: 'unclassified', source: [], basis: invalidSelectionReason, coverage: { complete: false, selectedCount: ids.size, availableCount: 0, missingCount: ids.size, invalidSelection: true, selectedIds: [...ids], availableIds: [], missingIds: [...ids] } }))
        : selected.length ? combine(selected.map(child => sourceSeries(data, engine, scopeOf(child), metric)), periods, true, 'Selected products', selected.map(child => child.id))
        : connectionActive ? combine(cohortCatalog.map(child => sourceSeries(data, engine, scopeOf(child), metric)), periods, false, 'Selected connectivity cohort', cohortCatalog.map(child => child.id))
        : sourceSeries(data, engine, scope, metric);
      return [metric, selectedPoint(points, state.period) || { period: state.period, value: null, source: [] }];
    }));
    summary.grossProfit = alignGrossProfit([summary.grossProfit], [summary.revenue])[0];
    const coverage = { invalidSelection, invalidIds, excludedCount: connectionActive ? excludedCatalog.length : 0, excludedIds: connectionActive ? excludedCatalog.map(child => child.id) : [], excludedBasis: 'Unmapped tracker records are a separate population from annual product-group finance.' };
    return { periods, series: [...allSeries.filter(trace => requestedMetrics.includes(trace.metric)), ...(requestedMetrics.includes('revenue') ? estimates : [])], allSeries, estimates, summary, catalog, visibleCatalog, selected, empty: !entities.length, metrics: requestedMetrics, scope, connectivity, invalidSelection, invalidSelectionReason, coverage };
  }
  function scenarioSeries(model, state) {
    const growth = Number(state.revenueGrowth || 0) / 100, marginChange = Number(state.marginChange || 0) / 100, spendChange = Number(state.budgetChange || 0) / 100;
    return model.series.filter(trace => trace.metric !== 'units' && !trace.estimate).map(trace => ({
      ...trace, id: trace.id + ':scenario', name: trace.name + ' · Scenario', scenario: true,
      points: trace.points.map(point => {
        const protectedPeriod = ['actual', 'history'].includes(point.kind) || Number(point.period) < Number(state.scenarioStart || state.period);
        let value = null, formula = 'No eligible baseline', source = point.source || [];
        const revenueTrace = trace.metric === 'grossProfit' ? model.allSeries.find(item => item.entityId === trace.entityId && item.metric === 'revenue') : null;
        const revenuePoint = selectedPoint(revenueTrace?.points, point.period);
        if (trace.metric === 'grossProfit') {
          const references = [...source, ...(revenuePoint?.source || [])], seen = new Set();
          source = references.filter(reference => { const key = JSON.stringify(reference); if (seen.has(key)) return false; seen.add(key); return true; });
        }
        if (!protectedPeriod && finite(point.value)) {
          if (trace.metric === 'revenue') { value = point.value * (1 + growth); formula = 'Baseline revenue × (1 + revenue change %)'; }
          if (trace.metric === 'budget') { value = point.value * (1 + spendChange); formula = 'Baseline source PD investment × (1 + spend change %)'; }
          if (trace.metric === 'grossProfit') {
            const revenue = revenuePoint?.value;
            if (point.coverage?.revenueAligned === false) formula = 'Revenue and gross-profit source coverage differ; no comparable raw margin baseline';
            else if (finite(revenue) && revenue !== 0) { value = revenue * (1 + growth) * (point.value / revenue + marginChange); formula = 'Baseline revenue × (1 + revenue change %) × (raw GM + margin change pp)'; }
            else if (marginChange === 0) { value = point.value * (1 + growth); formula = 'Baseline raw GP × (1 + revenue change %); no margin-point adjustment'; }
          }
        }
        return { ...point, value, source, baselineValue: point.value, kind: 'scenario', basis: `Illustrative sensitivity from FY${String(state.scenarioStart || state.period).slice(-2)}. ${formula}. Source PD schedule is not actual cash; units are held unchanged.`, formula, assumptions: { revenueGrowth: state.revenueGrowth, marginChange: state.marginChange, budgetChange: state.budgetChange } };
      })
    }));
  }
  function selectionColor(model, filter = {}) {
    const neutral = '#969eac', criteria = filter && typeof filter === 'object' ? filter : {};
    const traces = Array.isArray(model?.series) ? model.series : [];
    const colors = new Set(traces.filter(trace => !trace.estimate && !trace.scenario
      && (!Object.prototype.hasOwnProperty.call(criteria, 'entityId') || trace.entityId === criteria.entityId)
      && (!Object.prototype.hasOwnProperty.call(criteria, 'metric') || trace.metric === criteria.metric)
      && Array.isArray(trace.points) && trace.points.some(point => finite(point?.value))
      && typeof trace.color === 'string' && /^#[\da-f]{6}$/i.test(trace.color)).map(trace => trace.color));
    return colors.size === 1 ? [...colors][0] : neutral;
  }
  function comparisonBaseline(catalog, selectedIds) {
    if (!Array.isArray(catalog) || !Array.isArray(selectedIds)) return null;
    const ids = [...new Set(selectedIds)];
    if (ids.length < 2) return null;
    const selected = ids.map(id => catalog.filter(child => child.id === id));
    if (selected.some(matches => matches.length !== 1)) return null;
    // Selection order, card sorting, and name collisions never choose the baseline.
    // Missing revenue remains missing; a reported zero is still eligible.
    return selected.flat().filter(child => finite(child.revenue)).sort((a, b) => b.revenue - a.revenue || String(a.id).localeCompare(String(b.id), 'en'))[0] || null;
  }
  function comparisonPercent(value, baselineValue) {
    if (!finite(value) || !finite(baselineValue) || baselineValue === 0) return null;
    const percent = (value - baselineValue) / Math.abs(baselineValue) * 100;
    return finite(percent) ? percent : null;
  }
  function explain(point, trace) { return { title: `${metrics[trace.metric]?.label || trace.metric} · ${trace.name}`, value: point.value, baselineValue: point.baselineValue, formula: point.formula, basis: point.basis, source: point.source || [], assumptions: point.assumptions || null }; }
  root.HX_WORKSPACE_MODEL = { metrics, build, scenarioSeries, selectionColor, comparisonBaseline, comparisonPercent, explain, selectedPoint, combine };
})(typeof window !== 'undefined' ? window : globalThis);
