// Execute the actual generated gate expressions against interruption fixtures.
// This deliberately small WDL evaluator supports only the functions these gates
// use, and throws on unsupported syntax rather than silently approximating it.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { test } from 'node:test';
import { buildNativeAscmFlow, indexNativeActions } from '../native-ascm-flow.mjs';

const actions = Object.fromEntries([...indexNativeActions(buildNativeAscmFlow())].map(([n,e]) => [n,e.action]));
function evaluate(expression, context) {
  // UI-exported whole-field expressions may contain formatting whitespace.
  let quoted=false,compact='';
  for(let i=0;i<expression.length;i++) {
    const char=expression[i];
    if(char==="'") {if(quoted&&expression[i+1]==="'"){compact+="''";i++;continue;}quoted=!quoted;}
    if(quoted||! /\s/.test(char))compact+=char;
  }
  expression=compact;
  let offset = expression.startsWith('@') ? 1 : 0;
  const functions = {
    and:(...x)=>x.every(Boolean), or:(...x)=>x.some(Boolean), not:x=>!x,
    equals:isDeepStrictEqual, contains:(x,y)=>x.includes(y), createArray:(...x)=>x,
    coalesce:(...x)=>x.find(v=>v !== null && v !== undefined) ?? null,
    empty:x=>x === null || x === undefined || x === '' || Array.isArray(x) && !x.length || typeof x === 'object' && !Object.keys(x).length,
    greaterOrEquals:(x,y)=>x>=y, greater:(x,y)=>x>y,
    concat:(...x)=>x.join(''), string:String,
    body:n=>context[n]?.body, outputs:n=>context[n]?.outputs ?? { statusCode:context[n]?.statusCode, body:context[n]?.body },
    actions:n=>context[n] ?? {}, items:n=>context.items[n],
    int:x=>{const n=Number(x);if(!Number.isInteger(n))throw new Error('INT_VALIDATION_HOLD');return n;},
    if:(condition,yes,no)=>condition?yes:no
  };
  function parse() {
    let value;
    if (expression[offset] === "'") {
      offset++; let text='';
      while (offset < expression.length) {
        if (expression[offset] === "'") {
          if (expression[offset+1] === "'") { text+="'";offset+=2;continue; }
          offset++;break;
        }
        text+=expression[offset++];
      }
      value=text;
    } else {
      const token = /^[A-Za-z_][A-Za-z_0-9]*|^-?\d+/.exec(expression.slice(offset))?.[0];
      assert(token, `unsupported WDL syntax at ${offset}`);offset+=token.length;
      if (expression[offset] === '(') {
        offset++;const args=[];
        while (expression[offset] !== ')') {args.push(parse());if(expression[offset]===',')offset++;else break;}
        assert.equal(expression[offset++],')'); assert(functions[token],`unsupported WDL function ${token}`);
        value=functions[token](...args);
      } else value=token==='true'?true:token==='false'?false:token==='null'?null:Number(token);
    }
    while (expression[offset] === '?' || expression[offset] === '[') {
      if(expression[offset]==='?')offset++;
      assert.equal(expression[offset++],'[');const key=parse();assert.equal(expression[offset++],']');value=value?.[key];
    }
    return value;
  }
  const result=parse();assert.equal(offset,expression.length,'entire WDL expression must be consumed');return result;
}
function gate(name,context) {
  if(actions[name].type === 'Compose') {try {return evaluate(actions[name].inputs,context)===1;}catch{return false;}}
  const [expression,expected] = actions[name].expression.and[0].equals;
  return evaluate(expression,context) === (typeof expected==='string'&&expected.startsWith('@')?evaluate(expected,context):expected);
}
const report = { id:'immutable-original',internetMessageId:'<original@example.test>' };
function moveFixture(status='TimedOut') {
  return {
    items:{Each_report:report},
    Import_report:{body:{requestId:'accepted-original'}},
    Replay_report:{statusCode:200,body:{status:'published',archiveAllowed:true,requestId:'accepted-original',sourceMessageId:report.id}},
    Resolve_Inbox:{body:{id:'resolved-inbox'}},Resolve_Archive:{body:{id:'resolved-archive'}},
    Read_original_message:{status:'Succeeded',body:{...report,parentFolderId:'resolved-inbox'}},
    Move_exact_report:{status},
    Read_moved_message:{status:'Succeeded',body:{...report,parentFolderId:'resolved-archive'}}
  };
}
test('lost move reply is accepted only after the same immutable identity is positively in Archive', () => {
  for (const status of ['Succeeded','Failed','TimedOut']) assert.equal(gate('Archive_verified',moveFixture(status)),true);
  for (const status of ['Skipped','Running',undefined]) {const context=moveFixture();context.Move_exact_report.status=status;assert.equal(gate('Archive_verified',context),false);}
});
test('move outcome holds on wrong ID, internetMessageId, destination, missing read, or stale publication authority', () => {
  const mutations = [
    x=>{x.Read_moved_message.body.id='replacement';},
    x=>{x.Read_moved_message.body.internetMessageId='<wrong>';},
    x=>{x.Read_moved_message.body.parentFolderId='resolved-inbox';},
    x=>{x.Read_moved_message.status='Failed';x.Read_moved_message.body=undefined;},
    x=>{x.Read_original_message.body.id='replacement';},
    x=>{x.Read_original_message.body.internetMessageId='<wrong>';},
    x=>{x.Read_original_message.body.parentFolderId='other-folder';},
    x=>{x.Replay_report.body.archiveAllowed=false;},
    x=>{x.Replay_report.body.archiveAllowed='true';},
    x=>{x.Replay_report.body.requestId='other-report';},
    x=>{x.Replay_report.body.sourceMessageId='replacement';},
    x=>{x.Replay_report.statusCode=202;x.Replay_report.body.status='publication_pending';}
  ];
  for(const mutate of mutations){const context=moveFixture();mutate(context);assert.equal(gate('Archive_verified',context),false);}
});
test('old ready publication drains while a new report stays unarchived', () => {
  const candidate={provider:'sharepoint',storageRevision:82,generation:2,candidateId:'candidate-old',fileName:'master-r82-g2-candidate-old.pkg'};
  const context={Queued_publication:{statusCode:200,body:{archiveAllowed:false,candidate,binaryPath:'/api/ascm/publication/candidate-old/bytes'}},Import_report:{body:{storageRevision:83}}};
  assert.equal(gate('Candidate_ready',context),true);
  const replay=moveFixture();replay.Replay_report.statusCode=202;replay.Replay_report.body={status:'publication_pending',archiveAllowed:false,requestId:'accepted-original',sourceMessageId:report.id};
  assert.equal(gate('Archive_allowed',replay),false);assert.equal(gate('Archive_verified',replay),false);
  for(const mutate of [x=>{x.Queued_publication.body.candidate.fileName='other.pkg';},x=>{x.Queued_publication.body.binaryPath='/replacement';},x=>{x.Queued_publication.body.candidate.generation=0;}]) {
    const broken=structuredClone(context);mutate(broken);assert.equal(gate('Candidate_ready',broken),false);
  }
});
test('lost create reply reads exact stage bytes and refuses missing, partial, or wrong bytes', () => {
  const bytes=Buffer.from(Array.from({length:1024},(_,i)=>i%256));
  const envelope=bytes=>({'$content-type':'application/octet-stream','$content':bytes.toString('base64')});
  const context={Download_package:{status:'Succeeded',body:envelope(bytes)},Read_actual_stage:{status:'Succeeded',body:envelope(bytes)}};
  assert.equal(gate('Stage_bytes_match',context),true);
  for(const body of [bytes.subarray(0,1023),Buffer.alloc(1024),Buffer.alloc(0)])assert.equal(gate('Stage_bytes_match',{...context,Read_actual_stage:{status:'Succeeded',body:envelope(body)}}),false);
  assert.equal(gate('Stage_bytes_match',{Download_package:{status:'Succeeded',body:{}},Read_actual_stage:{status:'Succeeded',body:{}}}),false);
  // The real If runs only after successful stage GET. A failed/missing read never
  // evaluates binary conversion and never enters the promotion branch.
  for(const status of ['Failed','TimedOut','Skipped'])assert(!actions.Stage_bytes_match.runAfter.Read_actual_stage.includes(status.toUpperCase()));
  for(const status of ['SUCCEEDED','FAILED','TIMEDOUT'])assert(actions.Read_actual_stage.runAfter.Create_package_stage.includes(status));
  assert.equal(actions.Create_package_stage.inputs.retryPolicy.type,'none');
  assert.equal(actions.Promote_package.inputs.retryPolicy.type,'none');
});
test('lost promotion always reaches final identity/version/actual-byte readback, never relies on mutation receipt', () => {
  for(const status of ['SUCCEEDED','FAILED','TIMEDOUT'])assert(actions.Item_before.runAfter.Promote_package.includes(status));
  assert.equal(actions.Confirm_publication.inputs.body,"@body('Read_actual_package')");
  assert(!JSON.stringify(actions.Readback_stable.expression).includes("body('Promote_package')"));
});
test('stage-read authentication failure supersedes earlier create success using existing allowlist only', () => {
  const expression=actions.SharePoint_connection_state.inputs;
  const fixture=read=>({Create_package_stage:{status:'Succeeded'},Read_actual_stage:{status:'Failed',...read},Stage_bytes_match:{status:'Skipped'},Promote_package:{status:'Skipped'}});
  for(const read of [
    {outputs:{statusCode:401}},
    {code:'ConnectionAuthorizationFailed'},
    {error:{code:'InvalidAuthenticationToken'}}
  ]) assert.equal(evaluate(expression,fixture(read)),'reconnect_required');
  for(const read of [
    {outputs:{statusCode:403}},
    {outputs:{statusCode:403},code:'ConnectionAuthorizationFailed'},
    {outputs:{statusCode:500}},
    {code:'ConnectionFailure'}
  ]) assert.equal(evaluate(expression,fixture(read)),'available');
  // Stage guard is local validation, not a Microsoft service auth signal.
  assert.equal(evaluate(expression,{Stage_bytes_match:{status:'Failed',error:{code:'InvalidAuthenticationToken'}}}),'');
  assert.equal(evaluate(expression,{Create_package_stage:{status:'Succeeded'},Read_actual_stage:{status:'Succeeded'}}),'available');
  // A later actual service success has precedence over an older stage read.
  assert.equal(evaluate(expression,{...fixture({outputs:{statusCode:401}}),Item_after:{status:'Succeeded'}}),'available');
});
