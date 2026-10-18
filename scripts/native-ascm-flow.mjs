import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const OPAQUE_CREDENTIAL = '__OWNER_ENTERED_CREDENTIAL_RETAIN_IN_NATIVE_FLOW__';
const artifactUrl = new URL('../docs/ascm/native-production-flow.json', import.meta.url);
const source = JSON.parse(readFileSync(new URL('../docs/ascm/native-reviewed-fragments.json', import.meta.url)));
const completed = ['SUCCEEDED', 'FAILED', 'TIMEDOUT'];
const retry = { type: 'exponential', count: 2, interval: 'PT5S', minimumInterval: 'PT5S', maximumInterval: 'PT30S' };
const condition = (previous, expression) => ({ and: [{ equals: [expression, previous.and[0].equals[1]] }] });

export function indexNativeActions(definition) {
  const result = new Map();
  function visit(actions, path, ancestors = [], scope = null) {
    for (const [name, action] of Object.entries(actions ?? {})) {
      const entry = { name, action, path: `${path}/${name}`, ancestors, scope, siblings: actions };
      result.set(name, entry);
      if (action.actions) visit(action.actions, `${entry.path}/actions`, [...ancestors, name], entry);
      if (action.else?.actions) visit(action.else.actions, `${entry.path}/else/actions`, [...ancestors, name], entry);
    }
  }
  visit(definition.actions, '/actions');
  return result;
}

// Only the four explicitly reviewed NONCREDENTIAL fragments are generation inputs.
// No browser export, clipboard, credentials, or installed connection IDs are read.
function reviewedDefinition() {
  const fragments = structuredClone(source);
  return {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0.0',
    triggers: { Recurrence: fragments.trigger },
    actions: {
      Flow_worker_credential: { type: 'Compose', inputs: OPAQUE_CREDENTIAL, runtimeConfiguration: { secureData: { properties: ['inputs'] } } },
      ...fragments.root,
      Each_report: fragments.each,
      Inbox_connection_failed: fragments.auth
    }
  };
}

export function buildNativeAscmFlow() {
  const definition = reviewedDefinition();
  const entries = indexNativeActions(definition), a = Object.fromEntries([...entries].map(([name, x]) => [name, x.action]));
  // Retain UI-generated @true expression tokens: they evaluate to booleans and
  // are not the invalid literal strings "true"/"false". Avoid cosmetic UI edits.
  const candidate = "body('Queued_publication')?['candidate']";
  a.Candidate_ready.expression = condition(a.Candidate_ready.expression, `@and(equals(outputs('Queued_publication')?['statusCode'],200),equals(body('Queued_publication')?['archiveAllowed'],false),not(empty(${candidate})),equals(${candidate}?['provider'],'sharepoint'),greaterOrEquals(coalesce(${candidate}?['storageRevision'],0),1),greaterOrEquals(coalesce(${candidate}?['generation'],0),1),not(empty(${candidate}?['candidateId'])),equals(${candidate}?['fileName'],concat('master-r',string(coalesce(${candidate}?['storageRevision'],0)),'-g',string(coalesce(${candidate}?['generation'],0)),'-',coalesce(${candidate}?['candidateId'],''),'.pkg')),equals(body('Queued_publication')?['binaryPath'],concat('/api/ascm/publication/',coalesce(${candidate}?['candidateId'],''),'/bytes')))`);
  const scope = a.Candidate_ready.actions;
  scope.Read_actual_stage = structuredClone(a.Read_actual_package);
  scope.Read_actual_stage.inputs.parameters.path = "@concat('/Shared Documents/Product Portfolio/PPC/',outputs('Stage_name'))";
  scope.Read_actual_stage.runAfter = { Create_package_stage: [...completed] };
  scope.Stage_bytes_match = {
    type: 'Compose',
    inputs: "@int(if(and(equals(actions('Read_actual_stage')?['status'],'Succeeded'),equals(actions('Download_package')?['status'],'Succeeded'),not(empty(body('Read_actual_stage')?['$content'])),not(empty(body('Download_package')?['$content'])),equals(body('Read_actual_stage')?['$content'],body('Download_package')?['$content'])),'1','Stage_mismatch'))",
    runAfter: { Read_actual_stage: ['SUCCEEDED'] },
    runtimeConfiguration: { secureData: { properties: ['inputs'] } }
  };
  a.Promote_package.runAfter = { Stage_bytes_match: ['SUCCEEDED'] };
  // New actual service read belongs after promotion and before create in the
  // existing newest-service-first connection-state precedence. Reuse precisely
  // the reviewed auth allowlist and 403 exclusion; local guard errors never
  // become connection loss, and later successful service reads can clear it.
  const createState = a.SharePoint_connection_state.inputs.split(/\r?\n/).find(line => line.includes("actions('Create_package_stage')"));
  if (!createState) throw new Error('NATIVE_REVIEWED_CONNECTION_STATE_MISSING');
  a.SharePoint_connection_state.inputs = a.SharePoint_connection_state.inputs.replace(createState,
    createState.replaceAll('Create_package_stage','Read_actual_stage')+'\r\n'+createState);
  // Final readback's original runAfter remains unchanged after all attempted
  // promotion outcomes. A failed stage guard skips promotion and holds safely.
  a.Read_moved_message.runAfter = { Move_exact_report: [...completed] };
  const freshGate = a.Archive_allowed.expression.and[0].equals[0].slice(5, -1);
  const pre = Object.values(a.Archive_allowed.actions).find(x => x.type === 'If');
  if (!pre) throw new Error('NATIVE_REVIEWED_SCOPE_MISSING');
  const preGate = pre.expression.and[0].equals[0].slice(5, -1);
  a.Archive_verified.expression = condition(a.Archive_verified.expression, `@and(${freshGate},${preGate},contains(createArray('Succeeded','Failed','TimedOut'),actions('Move_exact_report')?['status']),equals(actions('Read_moved_message')?['status'],'Succeeded'),equals(body('Read_moved_message')?['id'],items('Each_report')?['id']),equals(body('Read_moved_message')?['internetMessageId'],items('Each_report')?['internetMessageId']),equals(body('Read_moved_message')?['parentFolderId'],body('Resolve_Archive')?['id']))`);
  for (const { name, action } of indexNativeActions(definition).values()) {
    const p = action.inputs?.parameters;
    const safe = action.type === 'Http' && (action.inputs.method === 'GET' || ['Import_report','Replay_report','Queued_publication','Confirm_publication'].includes(name))
      || action.type === 'OpenApiConnection' && (p?.Method === 'GET' || p?.['parameters/method'] === 'GET' || action.inputs.host.operationId === 'GetFileContentByPath');
    if (safe) action.inputs.retryPolicy = structuredClone(retry);
  }
  return definition;
}

// A strict production preflight, not a general-purpose WDL validator. Every field
// must match the reviewed generated allowlist. This also rejects secrets hidden
// in additional properties. Diagnostics contain ONLY paths from that allowlist.
// Never include an untrusted key, action name, input value, or exception message.
export function validateNativeAscmFlow(definition) {
  const expected = buildNativeAscmFlow(), allowed = indexNativeActions(expected);
  const diagnostics = [];
  const emit = (action, path, code) => {
    if (diagnostics.length < 100 && !diagnostics.some(x => x.action === action && x.path === path && x.code === code)) diagnostics.push({ action, path, code });
  };
  const codeFor = path => path.includes('/Flow_worker_credential') || path.endsWith('/X-PPC-ASCM-Flow-Secret') ? 'OPAQUE_CREDENTIAL_REQUIRED'
    : path.includes('/runAfter') ? 'RUN_AFTER_INVALID'
    : path.includes('/secureData') ? 'SECURE_HISTORY_REQUIRED'
    : path.includes('/host') || path.includes('/parameters') ? 'CONNECTOR_SCHEMA_OR_VALUE'
    : path.includes('/retryPolicy') || path.includes('/limit') ? 'BOUNDED_POLICY_REQUIRED'
    : path.includes('/triggers') ? 'HOURLY_TRIGGER_REQUIRED'
    : 'CANONICAL_FIELD_MISMATCH';
  function compare(actual, reference, path, action = '$definition') {
    if (actual === reference) return;
    if (path.includes('/runAfter/') && Array.isArray(actual) && Array.isArray(reference)) {
      const normalize = values => values.map(value => typeof value === 'string' ? value.toUpperCase() : value).sort();
      if (JSON.stringify(normalize(actual)) === JSON.stringify(normalize(reference))) return;
    }
    if (actual === null || reference === null || typeof actual !== typeof reference || Array.isArray(actual) !== Array.isArray(reference)) {
      emit(action, path, codeFor(path)); return;
    }
    if (typeof reference !== 'object') { emit(action, path, codeFor(path)); return; }
    for (const key of Object.keys(reference)) {
      const child = `${path}/${key}`;
      compare(actual?.[key], reference[key], child, allowed.has(key) ? key : action);
    }
    if (Object.keys(actual).some(key => !Object.hasOwn(reference, key))) emit(action, path, 'UNEXPECTED_FIELD');
  }
  compare(definition, expected, '');
  function checkDepth(actions, depth = 1) {
    if (!actions || typeof actions !== 'object') return;
    if (depth > 8) { emit('$definition', '/actions', 'NESTING_LIMIT'); return; }
    for (const action of Object.values(actions)) if (action && typeof action === 'object') {
      checkDepth(action.actions, depth+1); checkDepth(action.else?.actions, depth+1);
    }
  }
  checkDepth(definition?.actions);
  // Explicit semantic checks make copied-reference and runAfter faults legible.
  if (definition && typeof definition === 'object') {
    for (const [name, reference] of allowed) {
      const parts = reference.path.split('/').filter(Boolean);
      let actual = definition;
      for (const part of parts) actual = actual?.[part];
      if (!actual || typeof actual !== 'object') continue;
      if (actual.runAfter && typeof actual.runAfter === 'object') {
        for (const dependency of Object.keys(actual.runAfter)) if (!Object.hasOwn(reference.siblings, dependency)) emit(name, `${reference.path}/runAfter`, 'RUN_AFTER_SCOPE');
      }
      const checkRefs = value => {
        if (typeof value === 'string') {
          for (const match of value.matchAll(/\b(?:body|outputs|actions|items)\('([^']+)'\)/g)) {
            if (!allowed.has(match[1])) emit(name, reference.path, 'UNKNOWN_ACTION_REFERENCE');
          }
        } else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) if (!['actions','else'].includes(key)) checkRefs(child);
      };
      checkRefs(actual);
    }
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

export function nativeAscmFieldManifest() {
  const before = reviewedDefinition(), after = buildNativeAscmFlow(), changes = [];
  const entries = indexNativeActions(after);
  const oldEntries = indexNativeActions(before);
  for (const [name, entry] of entries) {
    const previous = oldEntries.get(name);
    if (!previous) { changes.push({ action: name, path: entry.path, operation: 'add', category:'essential-recovery', value: entry.action }); continue; }
    // A moved action is recorded explicitly; do not make the operator infer scope.
    if (previous.path !== entry.path) changes.push({ action: name, path: entry.path, operation: 'move', from: previous.path });
    function diff(left, right, path) {
      if (JSON.stringify(left) === JSON.stringify(right)) return;
      if (path.endsWith('/retryPolicy')) {
        changes.push({ action:name, path, operation:'set', category:'bounded-safe-retry', value:right }); return;
      }
      if (path.endsWith('/runAfter') || path.endsWith('/expression')) {
        changes.push({ action:name, path, operation:'set', category:'essential-recovery', value:right }); return;
      }
      if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
        for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
          if (['actions','else'].includes(key)) continue;
          diff(left[key], right[key], `${path}/${key}`);
        }
      } else changes.push(right === undefined ? { action:name,path,operation:'remove',category:'essential-recovery' } : { action:name,path,operation:'set',category:'essential-recovery',value:right });
    }
    diff(previous.action, entry.action, entry.path);
  }
  return {
    format: 'import-neutral-field-manifest/v1',
    baseline: 'reviewed production checkpoints; current manual Bootstrap prefix must be removed separately without reading credential',
    trigger: { path:'/triggers/Recurrence',operation:'set',value:after.triggers.Recurrence },
    credential: 'Preserve existing owner-entered Flow_worker_credential and connection bindings; never apply the source placeholder.',
    changes
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    writeFileSync(artifactUrl, JSON.stringify(buildNativeAscmFlow(), null, 2) + '\n');
    writeFileSync(new URL('../docs/ascm/native-field-change-manifest.json', import.meta.url), JSON.stringify(nativeAscmFieldManifest(),null,2)+'\n');
  }
  else if (process.argv[2] === '--check') {
    const result = validateNativeAscmFlow(JSON.parse(readFileSync(artifactUrl)));
    console.log(JSON.stringify(result));
    if (!result.valid) process.exitCode = 1;
  } else {
    console.error('Usage: node scripts/native-ascm-flow.mjs --write|--check'); process.exitCode = 1;
  }
}
