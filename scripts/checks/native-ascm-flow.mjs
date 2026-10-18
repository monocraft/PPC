import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildNativeAscmFlow, validateNativeAscmFlow, indexNativeActions, OPAQUE_CREDENTIAL } from '../native-ascm-flow.mjs';

function index(flow) {
  const found = {};
  function visit(actions) { for (const [name, action] of Object.entries(actions ?? {})) {
    found[name] = action; visit(action.actions); visit(action.else?.actions);
  } }
  visit(flow.actions); return found;
}
function reject(change) {
  const flow = buildNativeAscmFlow(); change(flow, index(flow));
  const result = validateNativeAscmFlow(flow);
  assert.equal(result.valid, false);
  assert(result.diagnostics.length > 0);
  for (const item of result.diagnostics) {
    assert.deepEqual(Object.keys(item).sort(), ['action', 'code', 'path']);
    assert(!JSON.stringify(item).includes('fake-private-key'));
  }
}
test('complete canonical flow has hourly sequential production structure and opaque credential', () => {
  const flow = buildNativeAscmFlow(), all = index(flow);
  assert.equal(flow.triggers?.Recurrence?.recurrence?.frequency, 'Hour');
  assert.equal(flow.triggers.Recurrence.recurrence.interval, 1);
  assert.equal(flow.triggers.Recurrence.runtimeConfiguration.concurrency.runs, 1);
  assert.equal(all.Flow_worker_credential.inputs, OPAQUE_CREDENTIAL);
  assert(Object.keys(all).length >= 50);
  assert.deepEqual(validateNativeAscmFlow(flow), { valid: true, diagnostics: [] });
});
test('rejects copied aliases', () => reject((f,a) => { a.Download_package.inputs.uri = "@body('Bootstrap_queue')"; }));
test('rejects wrong scope references', () => reject((f,a) => { a.List_monthly_releases.inputs.parameters.Uri = "@body('Read_actual_stage')"; }));
test('rejects non-sibling runAfter', () => reject((f,a) => { a.Move_exact_report.runAfter = { Download_package: ['SUCCEEDED'] }; }));
test('rejects string objects and boolean values', () => {
  reject((f,a) => { a.Queued_publication.inputs.body = '{}'; });
  reject((f,a) => { a.Reset_report_guard.inputs.value = 'false'; });
  reject((f,a) => { a.Read_actual_package.inputs.parameters.inferContentType = 'false'; });
});
test('rejects invented connector fields', () => reject((f,a) => { a.Create_package_stage.inputs.parameters.overwrite = false; }));
test('rejects insecure history', () => reject((f,a) => { delete a.Read_actual_package.runtimeConfiguration.secureData; }));
test('rejects binary upload conversion and HTTP string transport', () => {
  reject((f,a) => { a.Create_package_stage.inputs.parameters.body = "@string(body('Download_package'))"; });
  reject((f,a) => { a.Promote_package.inputs.parameters['parameters/body'] = "@body('Download_package')"; });
});
test('rejects unexpected fixed destinations', () => reject((f,a) => { a.Create_package_stage.inputs.parameters.dataset = 'https://example.com'; }));
test('rejects parallel report execution', () => reject((f,a) => { a.Each_report.runtimeConfiguration = { concurrency: { repetitions: 2 } }; }));
test('rejects bootstrap residue and schedule drift', () => {
  reject(f => { f.actions.Bootstrap_queue = { type: 'Compose', inputs: 'x' }; });
  reject(f => { f.triggers.Recurrence.recurrence.frequency = 'Minute'; });
});
test('rejects credential literals without reproducing their content in diagnostics', () => reject((f,a) => { a.Flow_worker_credential.inputs = 'fake-private-key'; }));
test('rejects credential literal hidden in a header', () => reject((f,a) => { a.Import_report.inputs.headers['X-PPC-ASCM-Flow-Secret'] = 'fake-private-key'; }));
test('same immutable ID read follows success, failure, timeout and requires positive verification', () => {
  const a = index(buildNativeAscmFlow());
  assert.deepEqual(a.Read_moved_message.runAfter.Move_exact_report, ['SUCCEEDED', 'FAILED', 'TIMEDOUT']);
  assert.equal(a.Read_moved_message.inputs.parameters.Uri, a.Read_original_message.inputs.parameters.Uri);
  const expression = JSON.stringify(a.Archive_verified.expression);
  assert(expression.includes("body('Replay_report')?['archiveAllowed'],true"));
  assert(expression.includes("body('Read_original_message')?['parentFolderId'],body('Resolve_Inbox')?['id']"));
  assert(!expression.includes("body('Move_exact_report')"));
  assert(expression.includes("createArray('Succeeded','Failed','TimedOut')"));
});
test('lost create reconciles actual stage bytes before no-overwrite promotion', () => {
  const a = index(buildNativeAscmFlow());
  assert.deepEqual(a.Read_actual_stage.runAfter.Create_package_stage, ['SUCCEEDED', 'FAILED', 'TIMEDOUT']);
  assert.equal(a.Read_actual_stage.inputs.host.operationId, 'GetFileContentByPath');
  assert.equal(a.Stage_bytes_match.type,'Compose');
  assert.deepEqual(a.Promote_package.runAfter,{Stage_bytes_match:['SUCCEEDED']});
  assert(a.Stage_bytes_match.inputs.includes("equals(body('Read_actual_stage')?['$content'],body('Download_package')?['$content'])"));
  assert(a.Promote_package.inputs.parameters['parameters/uri'].includes('flags=0'));
  assert(a.Stage_name.inputs.includes('guid()'));
  assert.deepEqual(a.Item_before.runAfter.Promote_package, ['SUCCEEDED','TIMEDOUT','FAILED']);
});
test('older ready candidate can drain; report Archive still needs fresh exact replay', () => {
  const a = index(buildNativeAscmFlow());
  assert(!JSON.stringify(a.Candidate_ready.expression).includes("outputs('Import_report')?['body']?['storageRevision']"));
  assert(JSON.stringify(a.Archive_allowed.expression).includes("body('Replay_report')?['requestId'],outputs('Import_report')?['body']?['requestId']"));
});
test('safe requests have bounded retry and writes never blindly retry', () => {
  const a = index(buildNativeAscmFlow());
  for (const name of ['Import_report','Replay_report','Confirm_publication','Download_package','Read_actual_stage','Read_moved_message']) {
    assert.deepEqual(a[name].inputs.retryPolicy, { type:'exponential',count:2,interval:'PT5S',minimumInterval:'PT5S',maximumInterval:'PT30S' });
  }
  for (const name of ['Create_package_stage','Promote_package','Move_exact_report']) assert.deepEqual(a[name].inputs.retryPolicy,{type:'none'});
});
test('saved canonical artifact matches deterministic generator', () => {
  const artifact = JSON.parse(readFileSync(new URL('../../docs/ascm/native-production-flow.json', import.meta.url)));
  assert.deepEqual(artifact, buildNativeAscmFlow());
});
test('native nesting is bounded and unknown action names never enter diagnostics', () => {
  const flow=buildNativeAscmFlow();
  assert(Math.max(...[...indexNativeActions(flow).values()].map(e=>e.ancestors.length+1))<=8);
  let actions=flow.actions;
  for(let i=0;i<9;i++){actions['fake-private-key']={type:'Scope',actions:{}};actions=actions['fake-private-key'].actions;}
  const result=validateNativeAscmFlow(flow);
  assert.equal(result.valid,false);
  assert(result.diagnostics.some(x=>x.code==='NESTING_LIMIT'));
  assert(!JSON.stringify(result).includes('fake-private-key'));
});
test('readback normalizes equivalent runAfter status spelling without rewriting expression literals', () => {
  const flow=buildNativeAscmFlow(),a=index(flow);
  a.Read_actual_stage.runAfter.Create_package_stage=['Succeeded','TIMEDOUT','FAILED'];
  assert.equal(validateNativeAscmFlow(flow).valid,true);
  a.Stage_bytes_match.inputs=a.Stage_bytes_match.inputs.replace("'Succeeded'","'SUCCEEDED'");
  assert.equal(validateNativeAscmFlow(flow).valid,false);
});
test('changed native conditions preserve reviewed Boolean expression operands', () => {
  const fragments=JSON.parse(readFileSync(new URL('../../docs/ascm/native-reviewed-fragments.json',import.meta.url)));
  const baseline=index({actions:{Each_report:fragments.each}}),generated=index(buildNativeAscmFlow());
  for(const name of ['Candidate_ready','Archive_verified']) {
    assert.equal(baseline[name].expression.and[0].equals[1],'@true');
    assert.equal(generated[name].expression.and[0].equals[1],baseline[name].expression.and[0].equals[1]);
  }
});
