import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateOfflineExpression } from './ascm-standard-sync-flow.mjs';

let module;
try { module = await import('../ascm-completed-check-flow.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof module?.addCompletedCheckReceipts, 'function', 'completed checks need a source-only native flow transformer');
const { addCompletedCheckReceipts } = module;

const site = 'https://hp-my.sharepoint.com/personal/tung_nguyen_hp_com';
function fixture() {
  return { properties: { connectionReferences: { shared_sharepointonline: { source: 'Embedded' } }, definition: {
    triggers: { Recurrence: { type: 'Recurrence', recurrence: { frequency: 'Week', interval: 1, timeZone: 'Pacific Standard Time', schedule: { weekDays: ['Tuesday'], hours: [13], minutes: [0] } } } },
    actions: {
      Source_bound: { type: 'If' },
      Skip_unchanged_staged: { type: 'If', runAfter: { Source_bound: ['Succeeded'] },
        expression: { equals: ["@equals(outputs('Source_before'),variables('cursor')?['source'])", true] },
        actions: { Unchanged_staged: { type: 'Terminate', runAfter: {}, inputs: { runStatus: 'Succeeded' } } }, else: { actions: {} } },
      Create_intake_manifest_last: { type: 'OpenApiConnection', inputs: { parameters: { dataset: site },
        host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline', connectionName: 'shared_sharepointonline', operationId: 'HttpRequest' }, authentication: "@parameters('$authentication')" } },
      Create_intake_manifest_last_readback: { type: 'OpenApiConnection', inputs: { parameters: { dataset: site },
        host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline', connectionName: 'shared_sharepointonline', operationId: 'GetFileContentByPath' }, authentication: "@parameters('$authentication')" } },
      Persist_current_discovery_hint_positive: { type: 'If', actions: {}, else: { actions: { fail: { type: 'ParseJson' } } },
        expression: { equals: ["@outputs('Persist_current_discovery_hint_positive_protected_predicate')", true] } },
    } } } };
}

test('adds completion receipts after real success gates and preserves all other definition and binding data', () => {
  const original = fixture(), frozen = structuredClone(original), result = addCompletedCheckReceipts(original);
  assert.deepEqual(original, frozen, 'preparation never mutates the source export');
  const a = result.properties.definition.actions, unchanged = a.Skip_unchanged_staged.actions;
  assert.deepEqual(unchanged.Unchanged_staged.runAfter, { Check_unchanged_verified: ['Succeeded'] });
  assert.deepEqual(unchanged.Check_unchanged_id.runAfter, {});
  assert.deepEqual(a.Check_staged_id.runAfter, { Persist_current_discovery_hint_positive: ['Succeeded'] });
  for (const [actions, tag] of [[unchanged, 'unchanged'], [a, 'staged']]) {
    const prefix = 'Check_' + tag;
    assert.equal(actions[prefix + '_id'].inputs, '@guid()');
    const receipt = actions[prefix + '_receipt'];
    assert.deepEqual(Object.keys(receipt.inputs).sort(), ['schemaVersion','kind','checkId','completedAt','outcome'].sort());
    assert.equal(receipt.inputs.kind, 'sharepoint_check'); assert.equal(receipt.inputs.outcome, tag);
    assert.equal(receipt.inputs.completedAt, "@formatDateTime(utcNow(),'yyyy-MM-ddTHH:mm:ss.fffZ')");
    const write = actions[prefix + '_write'], read = actions[prefix + '_readback'];
    assert.match(write.inputs.parameters['parameters/uri'], /\.check'',overwrite=false/);
    assert.equal(write.inputs.host.operationId, 'HttpRequest');
    assert.equal(read.inputs.host.operationId, 'GetFileContentByPath');
    for (const operation of [write, read]) {
      assert.equal(operation.inputs.parameters.dataset, site);
      assert.equal(operation.inputs.retryPolicy.type, 'none');
      assert.deepEqual(operation.runtimeConfiguration.secureData.properties, ['inputs','outputs']);
    }
    assert.deepEqual(read.runAfter, { [prefix + '_write']: ['Succeeded','Failed','TimedOut','Skipped'] });
    assert.match(actions[prefix + '_matches'].inputs, /equals\(body\('/);
    assert.match(actions[prefix + '_matches'].inputs, /base64\(string\(outputs\('/);
    assert.equal(actions[prefix + '_verified'].else.actions[prefix + '_unconfirmed'].type, 'ParseJson');
  }
  const restored = structuredClone(result);
  for (const name of Object.keys(restored.properties.definition.actions)) if (name.startsWith('Check_staged_')) delete restored.properties.definition.actions[name];
  const branch = restored.properties.definition.actions.Skip_unchanged_staged.actions;
  for (const name of Object.keys(branch)) if (name.startsWith('Check_unchanged_')) delete branch[name];
  branch.Unchanged_staged.runAfter = {};
  assert.deepEqual(restored, original, 'no schedule, connector, eligibility, publication or unrelated action edits');
});

test('refuses drifted, already-patched, unbound or foreign definitions instead of guessing', () => {
  for (const mutate of [
    flow => { flow.properties.definition.actions.Skip_unchanged_staged.runAfter = {}; },
    flow => { flow.properties.definition.actions.Skip_unchanged_staged.expression = {}; },
    flow => { flow.properties.definition.actions.Skip_unchanged_staged.actions.Unchanged_staged.inputs.runStatus = 'Failed'; },
    flow => { flow.properties.definition.actions.Persist_current_discovery_hint_positive.expression = {}; },
    flow => { flow.properties.definition.actions.Create_intake_manifest_last.inputs.parameters.dataset = 'https://elsewhere.invalid'; },
    flow => { flow.properties.definition.actions.Create_intake_manifest_last.inputs.host.operationId = 'Http'; },
    flow => { flow.properties.definition.actions.Check_staged_id = { type: 'Compose' }; },
  ]) {
    const flow = fixture(); mutate(flow); assert.throws(() => addCompletedCheckReceipts(flow), /CHECK_FLOW_SHAPE/);
  }
  assert.throws(() => addCompletedCheckReceipts(addCompletedCheckReceipts(fixture())), /CHECK_FLOW_SHAPE/);
  assert.throws(() => addCompletedCheckReceipts({}), /CHECK_FLOW_SHAPE/);
});

test('actual receipt predicate rejects changed, absent and unsuccessful readback on both branches', () => {
  const flow = addCompletedCheckReceipts(fixture()), root = flow.properties.definition.actions;
  for (const [actions, tag] of [[root.Skip_unchanged_staged.actions,'unchanged'],[root,'staged']]) {
    const prefix = 'Check_' + tag, read = prefix + '_readback', receipt = prefix + '_receipt';
    const value = { schemaVersion: 1, kind: 'sharepoint_check', checkId: '11111111-1111-4111-8111-111111111111', completedAt: '2026-11-02T20:00:00.000Z', outcome: tag };
    const raw = Buffer.from(JSON.stringify(value)).toString('base64');
    assert(Buffer.byteLength(JSON.stringify(value)) < 1024, 'closed fixed receipt fits its worker boundary');
    for (const [status, content, expected] of [[200,raw,true],[null,raw,true],[500,raw,false],[200,undefined,false],[200,raw+'x',false],[200,Buffer.from('{}').toString('base64'),false]]) {
      assert.equal(evaluateOfflineExpression(actions[prefix + '_matches'].inputs, {
        outputs: { [read]: { statusCode: status }, [receipt]: value }, body: { [read]: { $content: content } },
      }), expected);
    }
  }
});
