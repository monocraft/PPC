(function (root) {
  'use strict';

  const buckets = [
    { value: 'wired', label: 'Wired' },
    { value: 'wireless', label: 'Wireless' },
    { value: 'both', label: 'Both' },
    { value: 'unclassified', label: 'Unclassified' }
  ];
  const identity = value => String(value ?? '').replace(/\u00a0/g, ' ').trim().toLowerCase();
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const list = value => Array.isArray(value) ? value : [];
  const labels = Object.fromEntries(buckets.map(bucket => [bucket.value, bucket.label]));

  // This allowlist reads a metadata field only. Product names and SKU suffixes
  // are deliberately excluded, as are mixed Wired/Wireless source records.
  function classification(value) {
    const text = identity(value).replace(/\s+/g, ' ');
    if (text === 'wired') return 'wired';
    if (text === 'wireless' || text === 'wl') return 'wireless';
    if (['both', 'wired + wireless', 'wired+wireless', 'wired / wireless', 'wired/wireless', 'wired and wireless'].includes(text)) return 'both';
    return 'unclassified';
  }

  function index(records, key) {
    const result = new Map();
    for (const record of list(records)) {
      if (!record || typeof record !== 'object') continue;
      const value = key(record);
      if (!value) continue;
      if (!result.has(value)) result.set(value, []);
      result.get(value).push(record);
    }
    return result;
  }

  function resolver(data = {}) {
    data = data && typeof data === 'object' ? data : {};
    return {
      groups: index(data.products, record => typeof record.id === 'string' ? record.id : ''),
      projects: index(data.projects, record => identity(record.id)),
      investments: index(data.investments, record => identity(record.productId)),
      skus: index(data.npiSkuRecords, record => identity(record.projectId))
    };
  }

  function levelOf(child) {
    if (child?.level === 'sku' || child?.skuId != null) return 'sku';
    if (child?.level === 'project' || child?.projectId != null) return 'project';
    if (child?.level === 'group' || child?.groupId != null) return 'group';
    return 'group'; // Raw product records are permitted; matching remains by exact ID.
  }

  function evidence(records) {
    const seen = new Set(), result = [];
    for (const record of records) for (const item of list(record.connectivitySource)) {
      if (!item || typeof item !== 'object') continue;
      const key = JSON.stringify([item.sheet, item.cell, item.value]);
      if (!seen.has(key)) { seen.add(key); result.push({ ...item }); }
    }
    return result;
  }

  function unknown(level, status, reason, records = []) {
    return {
      value: 'unclassified', label: labels.unclassified, level, status, reason,
      source: evidence(records),
      coverage: {
        recordCount: records.length,
        metadataRecordCount: records.filter(record => own(record, 'connectivity')).length,
        classifiedRecordCount: records.filter(record => classification(record.connectivity) !== 'unclassified').length,
        unclassifiedRecordCount: records.filter(record => classification(record.connectivity) === 'unclassified').length,
        complete: false, conflict: status === 'conflict' || status === 'ambiguous',
        needsReimport: level === 'project' && records.length > 0 && records.some(record => !own(record, 'connectivity'))
      }
    };
  }

  function fromRecords(records, level) {
    if (!records.length) return unknown(level, 'unavailable', 'No connectivity metadata is supplied at this source level.');
    const values = [...new Set(records.map(record => classification(record.connectivity)).filter(value => value !== 'unclassified'))];
    if (values.length > 1) return unknown(level, 'conflict', 'Source connectivity records conflict. A mixture of Wired and Wireless records is not evidence of a hybrid product.', records);
    if (!values.length) return unknown(level, records.some(record => own(record, 'connectivity')) ? 'unclassified' : 'unavailable', 'Source connectivity is absent, unspecified, or not recognized.', records);
    if (records.some(record => classification(record.connectivity) === 'unclassified')) return unknown(level, 'incomplete', 'Some source connectivity records are unclassified; the item remains unclassified.', records);
    return {
      value: values[0], label: labels[values[0]], level, status: 'classified',
      reason: level === 'group' ? 'Explicit product-group source connectivity.' : level === 'project' ? 'Consistent explicit project source connectivity.' : 'Explicit project-scoped SKU source connectivity.',
      source: evidence(records),
      coverage: { recordCount: records.length, metadataRecordCount: records.length, classifiedRecordCount: records.length, unclassifiedRecordCount: 0, complete: true, conflict: false, needsReimport: false }
    };
  }

  function projectDefinition(context, child, level) {
    const key = identity(child.projectId ?? child.id);
    if (!key) return { invalid: unknown(level, 'unavailable', 'An exact source project key is required.') };
    const definitions = context.projects.get(key) || [];
    const signatures = new Set(definitions.map(record => JSON.stringify([identity(record.category), identity(record.name || record.groupName), identity(record.codeName), String(record.launchYear ?? '')])));
    if (!definitions.length) return { key, invalid: unknown(level, 'unavailable', 'No matching project metadata is supplied. Connectivity is not inherited from a product group.') };
    if (signatures.size !== 1 || (child.category && identity(child.category) !== identity(definitions[0].category))) return { key, invalid: unknown(level, 'ambiguous', 'The project key has ambiguous or mismatched source metadata.') };
    return { key, definition: definitions[0] };
  }

  function resolveProfile(context, child) {
    const level = levelOf(child);
    if (!child || typeof child !== 'object') return unknown(level, 'unavailable', 'An exact source item is required.');
    if (level === 'group') {
      const id = child.groupId ?? child.id, matches = context.groups.get(id) || [];
      if (matches.length !== 1) return unknown(level, matches.length ? 'ambiguous' : 'unavailable', matches.length ? 'The product-group ID is ambiguous.' : 'No matching product-group connectivity is supplied.');
      if (child.category && identity(child.category) !== identity(matches[0].category)) return unknown(level, 'ambiguous', 'The product-group category does not match its source metadata.');
      return fromRecords(matches, level);
    }
    const project = projectDefinition(context, child, level);
    if (project.invalid) return project.invalid;
    if (level === 'project') {
      const rows = context.investments.get(project.key) || [];
      const mismatched = rows.some(record => (record.category && identity(record.category) !== identity(project.definition.category)) || (record.name && identity(record.name) !== identity(project.definition.name || project.definition.groupName)));
      if (mismatched) return unknown(level, 'ambiguous', 'Project connectivity records have conflicting category or group metadata.', rows);
      return fromRecords(rows, level);
    }
    const skuId = child.skuId ?? child.id;
    if (typeof skuId !== 'string' || !skuId) return unknown(level, 'unavailable', 'An exact project-scoped SKU is required.');
    const rows = (context.skus.get(project.key) || []).filter(record => record.skuId === skuId);
    if (rows.some(record => record.category && identity(record.category) !== identity(project.definition.category))) return unknown(level, 'ambiguous', 'SKU source rows have conflicting project categories.', rows);
    if (!rows.some(record => own(record, 'connectivity'))) return unknown(level, 'unavailable', 'No SKU-level connectivity was supplied. Project and group connectivity are not allocated to SKUs.', rows);
    return fromRecords(rows, level);
  }

  function profile(data, child) { return resolveProfile(resolver(data), child); }

  function cohorts(children, data) {
    const context = resolver(data), result = buckets.map(bucket => ({ ...bucket, children: [], count: 0 }));
    const byValue = Object.fromEntries(result.map(bucket => [bucket.value, bucket]));
    for (const child of list(children)) { const bucket = byValue[resolveProfile(context, child).value]; bucket.children.push(child); bucket.count++; }
    return result;
  }

  function options(data, children) {
    const items = Array.isArray(children) ? children : list(data?.products);
    return [{ value: 'all', label: 'All connections', count: items.length }, ...cohorts(items, data).map(({ value, label, count }) => ({ value, label, count }))];
  }

  function filter(children, selection, data) {
    const values = (Array.isArray(selection) ? selection : selection == null ? [] : [selection]).map(identity);
    if (!values.length || values.includes('all')) return [...list(children)];
    const accepted = new Set(values.filter(value => own(labels, value)));
    const context = resolver(data);
    return list(children).filter(child => accepted.has(resolveProfile(context, child).value));
  }

  function numericValue(child, metric, period, context) {
    if (metric === 'grossMargin' || metric === 'rawMargin') {
      const revenue = numericValue(child, 'revenue', period, context), grossProfit = numericValue(child, 'grossProfit', period, context);
      return finite(revenue) && revenue !== 0 && finite(grossProfit) ? grossProfit / revenue : null;
    }
    // Drill children already carry values for the current selected period. An
    // explicit null remains missing, and never falls through to parent finance.
    if (own(child, metric)) return finite(child[metric]) ? child[metric] : null;
    if (levelOf(child) !== 'group') return null;
    const records = context.groups.get(child.groupId ?? child.id) || [];
    if (records.length !== 1) return null;
    const field = { revenue: 'revenueByYear', grossProfit: 'gmByYear', units: 'unitsByYear' }[metric];
    const value = field && period != null ? records[0][field]?.[period] : null;
    return finite(value) ? value : null;
  }

  function sorting(children, settings = {}, data) {
    const context = resolver(data), metric = settings.metric || 'name', direction = settings.direction === 'desc' ? -1 : 1;
    const knownMetric = ['name', 'connectivity', 'revenue', 'grossProfit', 'grossMargin', 'rawMargin', 'units', 'budget'].includes(metric);
    if (!knownMetric) return [...list(children)];
    const ordered = list(children).map((child, position) => ({ child, position,
      value: metric === 'name' ? String(child.name || child.id || '') : metric === 'connectivity' ? resolveProfile(context, child).value : numericValue(child, metric, settings.period, context)
    }));
    ordered.sort((a, b) => {
      if (metric === 'name') return direction * a.value.localeCompare(b.value, 'en', { numeric: true, sensitivity: 'base' }) || a.position - b.position;
      if (metric === 'connectivity') {
        if (a.value === 'unclassified' || b.value === 'unclassified') return (a.value === 'unclassified') - (b.value === 'unclassified') || a.position - b.position;
        return direction * (buckets.findIndex(bucket => bucket.value === a.value) - buckets.findIndex(bucket => bucket.value === b.value)) || a.position - b.position;
      }
      const am = !finite(a.value), bm = !finite(b.value);
      return am || bm ? Number(am) - Number(bm) || a.position - b.position : direction * (a.value - b.value) || a.position - b.position;
    });
    return ordered.map(item => item.child);
  }

  root.HX_CONNECTIVITY = Object.freeze({ profile, options, filter, cohorts, sorting, sort: sorting });
})(typeof window !== 'undefined' ? window : globalThis);
