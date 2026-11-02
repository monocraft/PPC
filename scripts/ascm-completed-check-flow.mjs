// Pure source preparation for the already bound SharePoint intake export.
// This module cannot import, save, activate or run a cloud flow.
const SITE = 'https://hp-my.sharepoint.com/personal/tung_nguyen_hp_com';
const API = '/providers/Microsoft.PowerApps/apis/shared_sharepointonline';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const protectedInputs = { secureData: { properties: ['inputs'] } };
const protectedIO = { secureData: { properties: ['inputs','outputs'] } };
const requireShape = value => { if (!value) throw new Error('CHECK_FLOW_SHAPE'); };

function completedCheckActions(tag, runAfter, templates) {
  const prefix = 'Check_' + tag;
  const id = prefix + '_id', receipt = prefix + '_receipt', write = prefix + '_write';
  const read = prefix + '_readback', matches = prefix + '_matches', verified = prefix + '_verified';
  const connector = (template, after, parameters) => ({
    type: 'OpenApiConnection', runAfter: after, limit: { timeout: 'PT2M' },
    inputs: { ...structuredClone(template.inputs), parameters, retryPolicy: { type: 'none' } }, runtimeConfiguration: structuredClone(protectedIO),
  });
  return {
    [id]: { type: 'Compose', runAfter, inputs: '@guid()', runtimeConfiguration: structuredClone(protectedInputs) },
    [receipt]: { type: 'Compose', runAfter: { [id]: ['Succeeded'] }, inputs: {
      schemaVersion: 1, kind: 'sharepoint_check', checkId: `@outputs('${id}')`,
      completedAt: "@formatDateTime(utcNow(),'yyyy-MM-ddTHH:mm:ss.fffZ')", outcome: tag,
    }, runtimeConfiguration: structuredClone(protectedInputs) },
    [write]: connector(templates.write, { [receipt]: ['Succeeded'] }, {
      dataset: SITE, 'parameters/method': 'POST',
      'parameters/uri': `@concat('_api/web/GetFolderByServerRelativeUrl(''/personal/tung_nguyen_hp_com/Documents/PPC ASCM/intake'')/Files/add(url=''',outputs('${id}'),'.check'',overwrite=false)')`,
      'parameters/headers': { 'Content-Type': 'application/octet-stream', Accept: 'application/json;odata=verbose' },
      'parameters/body': `@base64ToBinary(base64(string(outputs('${receipt}'))))`,
    }),
    // An uncertain create is never repeated. Only an exact positive readback
    // permits normal success termination, matching the existing intake pattern.
    [read]: connector(templates.read, { [write]: ['Succeeded','Failed','TimedOut','Skipped'] }, {
      dataset: SITE, path: `@concat('/Documents/PPC ASCM/intake/',outputs('${id}'),'.check')`, inferContentType: false,
    }),
    [matches]: { type: 'Compose', runAfter: { [read]: ['Succeeded'] },
      inputs: `@and(or(equals(outputs('${read}')?['statusCode'],200),equals(outputs('${read}')?['statusCode'],null)),equals(body('${read}')?['$content'],base64(string(outputs('${receipt}')))))`,
      runtimeConfiguration: structuredClone(protectedInputs) },
    [verified]: { type: 'If', runAfter: { [matches]: ['Succeeded'] }, expression: { equals: [`@outputs('${matches}')`, true] },
      actions: {}, else: { actions: { [prefix + '_unconfirmed']: { type: 'ParseJson', runAfter: {},
        inputs: { content: {}, schema: { type: 'object', required: ['CHECK_RECEIPT_UNCONFIRMED'] } },
        runtimeConfiguration: structuredClone(protectedInputs) } } } },
  };
}

export function addCompletedCheckReceipts(exported) {
  const flow = structuredClone(exported), actions = flow?.properties?.definition?.actions;
  const unchanged = actions?.Skip_unchanged_staged, positive = actions?.Persist_current_discovery_hint_positive;
  requireShape(actions && actions.Source_bound && unchanged?.type === 'If'
    && same(unchanged.runAfter, { Source_bound: ['Succeeded'] })
    && same(unchanged.expression, { equals: ["@equals(outputs('Source_before'),variables('cursor')?['source'])", true] })
    && same(Object.keys(unchanged.actions || {}), ['Unchanged_staged'])
    && unchanged.actions.Unchanged_staged.type === 'Terminate'
    && same(unchanged.actions.Unchanged_staged.inputs, { runStatus: 'Succeeded' })
    && same(unchanged.actions.Unchanged_staged.runAfter, {})
    && same(unchanged.else?.actions, {}) && positive?.type === 'If'
    && same(positive.expression, { equals: ["@outputs('Persist_current_discovery_hint_positive_protected_predicate')", true] })
    && !Object.keys(actions).some(name => name.startsWith('Check_')));
  const templates = { write: actions.Create_intake_manifest_last, read: actions.Create_intake_manifest_last_readback };
  for (const [kind, template] of Object.entries(templates)) {
    requireShape(template?.type === 'OpenApiConnection' && template.inputs?.parameters?.dataset === SITE
      && template.inputs.host?.apiId === API && template.inputs.host.connectionName === 'shared_sharepointonline'
      && template.inputs.host.operationId === (kind === 'write' ? 'HttpRequest' : 'GetFileContentByPath')
      && template.inputs.authentication === "@parameters('$authentication')");
  }
  Object.assign(unchanged.actions, completedCheckActions('unchanged', {}, templates));
  unchanged.actions.Unchanged_staged.runAfter = { Check_unchanged_verified: ['Succeeded'] };
  Object.assign(actions, completedCheckActions('staged', { Persist_current_discovery_hint_positive: ['Succeeded'] }, templates));
  return flow;
}
