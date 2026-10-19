import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { indexNativeActions } from '../native-ascm-flow.mjs';

const API = '/providers/Microsoft.PowerApps/apis/shared_sharepointonline';
const PRIVATE_SITE = 'https://hp-my.sharepoint.com/personal/tung_nguyen_hp_com';
const SOURCE_SITE = 'https://hp.sharepoint.com/teams/IPSG_SCM_and_Product_Requirements_Info';
const FINAL_SITE = 'https://hp.sharepoint.com/teams/PCGamingCategory';
const PRIVATE_ROOT = '/Documents/PPC ASCM';
const FINAL_FOLDER = '/Shared Documents/Product Portfolio/PPC';
const DRIVE_BINDING = '__BIND_VERIFIED_FIXED_PPC_DRIVE_ID__', FOLDER_BINDING = '__BIND_VERIFIED_FIXED_PPC_FOLDER_ID__';
const SOURCE_FIELDS = ['provider','hostname','sitePath','driveId','listId','listItemId','itemUniqueId','fileName','relativePath','versionLabel','eTag','createdAt','lastModifiedAt','bytes'];
const SOURCE_PROOF = ['listItemId','itemUniqueId','versionLabel','eTag','bytes'];
const ITEM_FIELDS = ['driveId','folderId','itemId','versionId','fileName'];
const FINAL_PROOF = ['itemId','eTag','versionId','bytes'];
const COMMAND_FIELDS = ['schemaVersion','kind','operationId','attemptId','createdAt','candidate','ciphertextFile','stageFile'];
const CANDIDATE_FIELDS = ['candidateId','generation','storageRevision','sha256','bytes','expiresAt','fileName','provider','driveId','folderId'];
const NAMES = {
  intake: ['Runtime_binding_required','Discover_bounded_sources','Select_latest_eligible','Operation_id','Attempt_id','Source_before','Read_source_workbook','Source_after','Stable_source','Create_private_workbook','Intake_manifest','Create_intake_manifest_last','Persist_current_discovery_hint','Safe_diagnostic'],
  command: ['Runtime_binding_required','Exact_command_event','Read_command','Parse_command','Validate_command','Read_private_ciphertext','Ciphertext_envelope_valid','Claim_exact_attempt','Try_new_attempt','Persist_stage_started','Create_fresh_stage','Read_actual_stage','Stage_bytes_match','Persist_promote_started','Promote_package','Final_before','Read_actual_final','Final_after','Final_stable_and_equal','Readback_name','Readback_names_distinct','Create_fresh_readback','Result_manifest','Create_result_manifest_last','Safe_diagnostic']
};
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...keys].sort());

// A small, closed interpreter executes only the gate expression subset used by
// these artifacts. It is a test oracle for our boundary expressions, not a
// claim to implement or certify the Power Automate expression runtime.
export function evaluateOfflineExpression(expression, facts) {
  if (typeof expression !== 'string' || expression.length > 32768) throw new Error('EXPRESSION_BOUND');
  const source=expression.startsWith('@')?expression.slice(1):expression;
  let at=0, nodes=0;
  const functions={
    body: name=>facts.body?.[name], outputs: name=>facts.outputs?.[name],
    and: (...values)=>values.every(value=>value===true), or: (...values)=>values.some(value=>value===true),
    equals: (a,b)=>same(a,b), not: value=>!value, empty: value=>value==null || value==='' || (typeof value==='object' && Object.keys(value).length===0),
    greater: (a,b)=>a>b, greaterOrEquals: (a,b)=>a>=b, lessOrEquals: (a,b)=>a<=b,
    length: value=>{if(typeof value!=='string'&&!Array.isArray(value))throw new Error('EXPRESSION_TYPE');return value.length;},
    mul: (a,b)=>a*b, div: (a,b)=>Math.trunc(a/b), sub: (a,b)=>a-b,
    endsWith: (a,b)=>typeof a==='string'&&a.endsWith(b), if:(value,a,b)=>value?a:b,
    substring:(value,start,count)=>{if(typeof value!=='string'||start<0||count<0||start+count>value.length)throw new Error('EXPRESSION_RANGE');return value.slice(start,start+count);},
    createArray:(...values)=>values, contains:(values,value)=>Array.isArray(values)?values.some(item=>same(item,value)):String(values).includes(value)
  };
  const space=()=>{while(/\s/.test(source[at]??'')&&at<source.length)at++;};
  function value(){
    if(++nodes>2048)throw new Error('EXPRESSION_BOUND');space();let result;
    if(source[at]==="'") { at++;let text='';while(at<source.length){if(source[at]==="'"){at++;if(source[at]==="'"){text+="'";at++;continue;}result=text;break;}text+=source[at++];}if(result===undefined)throw new Error('EXPRESSION_STRING'); }
    else if(/[-0-9]/.test(source[at]??'')){const token=/^-?\d+/.exec(source.slice(at));if(!token)throw new Error('EXPRESSION_NUMBER');at+=token[0].length;result=Number(token[0]);}
    else { const token=/^[A-Za-z][A-Za-z0-9]*/.exec(source.slice(at));if(!token)throw new Error('EXPRESSION_TOKEN');at+=token[0].length;space();
      if(source[at]==='('){at++;const args=[];space();if(source[at]!==')'){while(true){args.push(value());space();if(source[at]!==',')break;at++;}}if(source[at++]!==')'||!functions[token[0]])throw new Error('EXPRESSION_FUNCTION');result=functions[token[0]](...args);}
      else if(token[0]==='true')result=true;else if(token[0]==='false')result=false;else if(token[0]==='null')result=null;else throw new Error('EXPRESSION_LITERAL');
    }
    space();while(source.slice(at,at+2)==='?['){at+=2;const key=value();space();if(source[at++]!==']'||typeof key!=='string')throw new Error('EXPRESSION_ACCESS');result=result?.[key];space();}return result;
  }
  const result=value();space();if(at!==source.length)throw new Error('EXPRESSION_TRAILING');return result;
}

function calendarDay(value) { return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value; }

// Executes the declarative discovery/selection policy against bounded synthetic
// connector pages. This is not a cloud adapter and performs no network I/O.
export function selectOfflineSource(flow, discovery, now, currentHint=null) {
  const policy=contract(flow,'Discover_bounded_sources'), selection=contract(flow,'Select_latest_eligible');
  const held=code=>({status:'held',code});
  const clock=new Date(now); if(Number.isNaN(clock.getTime()))return held('SOURCE_DISCOVERY_INCOMPLETE');
  const allowed=new Set(policy.monthOffsets.map(offset=>{const date=new Date(Date.UTC(clock.getUTCFullYear(),clock.getUTCMonth()+offset,1));return `(${String(date.getUTCMonth()+1).padStart(2,'0')}) ${date.toLocaleString('en-US',{month:'long',timeZone:'UTC'})} ${date.getUTCFullYear()}`;}));
  const files=[];let total=0;
  if(!Array.isArray(discovery?.folders)||discovery.folders.length!==policy.monthOffsets.length)return held('SOURCE_DISCOVERY_INCOMPLETE');
  const seenFolders=new Set();
  for(const folder of discovery.folders){
    if(!allowed.has(folder.name)||seenFolders.has(folder.name))return held('SOURCE_DISCOVERY_INCOMPLETE');seenFolders.add(folder.name);
    if(folder.absent===true&&folder.positiveReadOnlyNotFound===true)continue;
    if(!Array.isArray(folder.pages)||folder.pages.length===0||folder.pages.length>policy.maxPagesPerFolder)return held('SOURCE_DISCOVERY_INCOMPLETE');let count=0;
    for(let i=0;i<folder.pages.length;i++) { const page=folder.pages[i];
      if(!Array.isArray(page.items)||page.items.length>policy.pageSize||page.items.some(item=>typeof item.relativePath!=='string'||!item.relativePath.startsWith(`${folder.name}/`)||item.relativePath.slice(folder.name.length+1).includes('/')))return held('SOURCE_DISCOVERY_INCOMPLETE');count+=page.items.length;total+=page.items.length;
      if(count>=policy.maxItemsPerFolder||total>=policy.maxTotalItems)return held('SOURCE_DISCOVERY_INCOMPLETE');
      // Local page tokens stand for already-validated same-authority/folder
      // continuations. No caller-supplied HTTP URL is followed by this oracle.
      if(page.next!==null&&page.next!==`page:${i+2}`)return held('SOURCE_DISCOVERY_INCOMPLETE');
      if((i===folder.pages.length-1)!==(page.next===null))return held('SOURCE_DISCOVERY_INCOMPLETE');files.push(...page.items);
    }
  }
  const knownIdentity=currentHint??policy.knownCurrentItem;
  if(discovery.knownCurrentItem){if(policy.knownCurrentItem.keepOutsideWindow!==true||discovery.knownCurrentItem.listItemId!==knownIdentity.listItemId||discovery.knownCurrentItem.itemUniqueId!==knownIdentity.itemUniqueId)return held('SOURCE_DISCOVERY_INCOMPLETE');files.push(discovery.knownCurrentItem);}
  const names=new RegExp(selection.filenamePattern), versions=new RegExp(selection.versionPattern), eligible=[];
  for(const item of files){const match=names.exec(item.fileName??'');if(!match||!calendarDay(match[1])||match[1]<selection.floor||!versions.test(item.versionLabel??''))continue;
    const major=Number(item.versionLabel.slice(0,-2));if(!Number.isSafeInteger(major)||major<1)continue;
    if(!Number.isSafeInteger(item.listItemId)||item.listItemId<1||typeof item.itemUniqueId!=='string'||!item.itemUniqueId||typeof item.eTag!=='string'||!item.eTag||!Number.isSafeInteger(item.bytes)||item.bytes<1||item.bytes>2097152)return held('SOURCE_METADATA_INVALID');
    eligible.push({item,day:match[1],major});
  }
  if(!eligible.length)return {status:'idle'};
  const day=eligible.reduce((latest,value)=>value.day>latest?value.day:latest,'');const newest=eligible.filter(value=>value.day===day);
  if(new Set(newest.map(value=>`${value.item.listItemId}/${value.item.itemUniqueId}`)).size!==1)return held('SOURCE_AMBIGUOUS');
  const major=Math.max(...newest.map(value=>value.major)), latest=newest.filter(value=>value.major===major);
  if(new Set(latest.map(value=>JSON.stringify(value.item))).size!==1)return held('SOURCE_METADATA_CONFLICT');
  const item=latest[0].item;
  if(currentHint){if(day<currentHint.reportDate)return {status:'idle'};if(day===currentHint.reportDate){if(item.listItemId!==currentHint.listItemId||item.itemUniqueId!==currentHint.itemUniqueId)return held('SOURCE_AMBIGUOUS');if(major<=Number(currentHint.versionLabel.slice(0,-2)))return {status:'idle'};}}
  return {status:'selected',item,reportDate:day};
}

// Static validation is deliberately separate from runtime/import acceptance.
// Diagnostics never contain source values, URLs, arbitrary action names or raw
// connector failures, including when a hostile mutation embeds a secret.
export function validateStandardSyncFlow(flow) {
  const diagnostics=[], allowed=new Set(NAMES[flow?.kind]??[]);
  const emit=(code,name='$definition')=>{const action=allowed.has(name)?name:'$definition';if(!diagnostics.some(item=>item.code===code&&item.action===action))diagnostics.push({action,code});};
  const require=(ok,code,name)=>{if(!ok)emit(code,name);};
  if(!flow||typeof flow!=='object'||!NAMES[flow.kind]){emit('ARTIFACT_SCHEMA');return {valid:false,diagnostics};}
  const entries=indexNativeActions(flow.definition??{}), a=Object.fromEntries([...entries].map(([name,entry])=>[name,entry.action]));
  const observedNames=new Set();
  function unique(siblings){for(const [name,action]of Object.entries(siblings??{})){if(observedNames.has(name))emit('DUPLICATE_ACTION',name);observedNames.add(name);unique(action?.actions);unique(action?.else?.actions);}}
  unique(flow.definition?.actions);
  const c=name=>a[name]?.inputs?.contract;
  require(flow.format==='ppc-standard-sync-flow/v1','ARTIFACT_SCHEMA');
  require(flow.readiness?.state==='Off'&&flow.readiness?.activationAllowed===false&&flow.readiness?.importTested===false&&flow.readiness?.runtimeSyntax==='binding-required'&&a.Runtime_binding_required?.type==='Terminate'&&a.Runtime_binding_required.inputs?.runStatus==='Failed'&&a.Runtime_binding_required.inputs?.runError?.code==='FLOW_BINDING_REQUIRED','RUNTIME_BINDING_GATE');
  require(Array.isArray(flow.bindingRequirements)&&flow.bindingRequirements.length>=5&&flow.bindingRequirements.every(value=>value.status==='unverified'&&typeof value.id==='string'&&typeof value.requiredProof==='string'&&value.requiredProof.length>20),'RUNTIME_BINDING_GATE');
  const source=flow.authority;
  require(source?.provider==='sharepoint'&&source?.hostname==='hp.sharepoint.com'&&source?.sitePath==='/teams/IPSG_SCM_and_Product_Requirements_Info'&&source?.site===SOURCE_SITE&&source?.library==='ASCM-Accessories Commercial'&&source?.listId==='2e5224b4-f8be-4265-88a5-90b32a66497d'&&source?.driveId==='b!Dxcy8q8LE0GivbyM3D6Dq5C5iXHjfxBMsvQrwTpLknS0JFIuvvhlQoilkLMqZkl9','FIXED_AUTHORITY');
  require(flow.destination?.site===FINAL_SITE&&flow.destination?.connectorFolder===FINAL_FOLDER&&flow.destination?.serverRelativeFolder==='/teams/PCGamingCategory/Shared Documents/Product Portfolio/PPC'&&flow.destination?.driveId===DRIVE_BINDING&&flow.destination?.folderId===FOLDER_BINDING&&flow.destination?.callerOverride===false,'FIXED_AUTHORITY');
  require(flow.handoff?.site===PRIVATE_SITE&&flow.handoff?.root===PRIVATE_ROOT&&['intake','commands','results'].every(key=>flow.handoff[key]===`${PRIVATE_ROOT}/${key}`)&&flow.handoff?.attempts===`${PRIVATE_ROOT}/results/attempts`&&flow.handoff?.verified===false&&flow.handoff?.jsonMaxBytes===65536&&flow.handoff?.cloudDuplicateMemberRejection===false,'PRIVATE_BOUNDARY');
  const connection=flow.connectionReferences?.shared_sharepointonline;
  require(exactKeys(flow.connectionReferences,['shared_sharepointonline'])&&connection?.source==='Embedded'&&connection?.id===API&&connection?.connectionName==='__BIND_EXISTING_STANDARD_SHAREPOINT_CONNECTION__'&&connection?.newConnectionAllowed===false,'CONNECTION_BOUNDARY');
  require(flow.errorPolicy?.rawException===false&&flow.errorPolicy?.publicDiagnostic==='closed-code-only'&&flow.errorPolicy?.ppcCalls===0&&flow.errorPolicy?.reconnect==='actual-observed-connector-auth-failure-only'&&flow.errorPolicy?.available==='actual-supported-sharepoint-success-only','ERROR_BOUNDARY');
  require(a.Safe_diagnostic?.type==='Compose'&&a.Safe_diagnostic.inputs?.details===null&&/^[A-Z][A-Z0-9_]{0,63}$/.test(a.Safe_diagnostic.inputs?.code??'')&&['held','unknown'].includes(a.Safe_diagnostic.inputs?.status),'ERROR_BOUNDARY','Safe_diagnostic');
  for(const name of allowed)require(a[name],'MISSING_ACTION',name);
  const knownOperations=new Set(['GetFileContentByPath','HttpRequest']);
  const secure=value=>same(value?.runtimeConfiguration?.secureData?.properties?.slice().sort(),['inputs','outputs']);
  function inspectConnector(action,name){
    require(action.inputs?.host?.apiId===API&&action.inputs?.host?.connectionName==='shared_sharepointonline'&&action.inputs?.authentication==="@parameters('$authentication')",'CONNECTION_BOUNDARY',name);
    require(knownOperations.has(action.inputs?.host?.operationId)&&action.inputs.host.operationId===(name==='Promote_package'?'HttpRequest':'GetFileContentByPath'),'FORBIDDEN_OPERATION',name);
    require(exactKeys(action.inputs?.parameters,name==='Promote_package'?['dataset','parameters/method','parameters/uri','parameters/headers']:['dataset','path','inferContentType']),'FORBIDDEN_OPERATION',name);
    require([PRIVATE_SITE,SOURCE_SITE,FINAL_SITE].includes(action.inputs?.parameters?.dataset),'FIXED_AUTHORITY',name);
    require(same(action.inputs?.retryPolicy,{type:'none'}),'WRITE_RETRY',name);
  }
  for(const [name,entry] of entries){const action=entry.action;
    require(allowed.has(name)&&['Terminate','Compose','If','ParseJson','BindingRequired','OpenApiConnection'].includes(action?.type),'FORBIDDEN_OPERATION',name);
    require(secure(action),'SECURE_HISTORY',name);
    require(entry.ancestors.length<8,'GRAPH_DEPTH',name);
    for(const dependency of Object.keys(action?.runAfter??{}))require(Object.hasOwn(entry.siblings,dependency),'RUN_AFTER_SCOPE',name);
    if(action.type==='OpenApiConnection')inspectConnector(action,name);
    if(action.type==='BindingRequired'){
      require(flow.bindingRequirements.some(value=>value.id===action.inputs?.bindingId),'RUNTIME_BINDING_GATE',name);
      const details=c(name);require(details&&typeof details.operation==='string','ARTIFACT_SCHEMA',name);
      if(details?.site)require([PRIVATE_SITE,SOURCE_SITE,FINAL_SITE].includes(details.site),'FIXED_AUTHORITY',name);
      if(details?.operation==='create_only_file'){
        require(details.overwrite===false,'CREATE_ONLY',name);require(same(details.retryPolicy,{type:'none'}),'WRITE_RETRY',name);
        if(details.site===PRIVATE_SITE)require([`${PRIVATE_ROOT}/intake`,`${PRIVATE_ROOT}/results`].includes(details.folderPath),'PRIVATE_BOUNDARY',name);
        else require(details.site===FINAL_SITE&&details.folderPath===FINAL_FOLDER,'FIXED_AUTHORITY',name);
      }
    }
    function refs(value){if(typeof value==='string'){for(const match of value.matchAll(/\b(?:body|outputs|actions)\('([^']+)'\)/g))require(allowed.has(match[1]),'UNKNOWN_REFERENCE',name);
      for(const url of value.match(/https?:\/\/[^\s'"<>]+/g)??[])require([PRIVATE_SITE,SOURCE_SITE,FINAL_SITE].includes(url),'FIXED_AUTHORITY',name);
    }else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))if(!['actions','else','schema'].includes(key))refs(child);}
    refs(action);
  }
  function cycles(siblings){const visiting=new Set(),done=new Set();function visit(name){if(visiting.has(name)){emit('GRAPH_CYCLE',name);return;}if(done.has(name))return;visiting.add(name);for(const next of Object.keys(siblings[name]?.runAfter??{}))if(Object.hasOwn(siblings,next))visit(next);visiting.delete(name);done.add(name);}for(const name of Object.keys(siblings??{}))visit(name);for(const action of Object.values(siblings??{})){if(action.actions)cycles(action.actions);if(action.else?.actions)cycles(action.else.actions);}}
  cycles(flow.definition?.actions??{});
  const ordered=(next,previous,statuses=['Succeeded'])=>require(same(a[next]?.runAfter,{[previous]:statuses}),'WRITE_ORDER',next);
  const trigger=flow.definition?.triggers;
  if(flow.kind==='intake'){
    const t=trigger?.Recurrence;require(exactKeys(trigger,['Recurrence'])&&t?.type==='Recurrence'&&t?.recurrence?.frequency==='Hour'&&t?.recurrence?.interval==='1'&&t?.runtimeConfiguration?.concurrency?.runs===1&&secure(t),'TRIGGER_BOUNDARY');
    const discovery=c('Discover_bounded_sources'), selection=c('Select_latest_eligible');
    require(discovery?.readOnly===true&&same(discovery?.monthOffsets,[0,-1,-2])&&discovery?.calendar==='UTC'&&discovery?.folderOnly===true&&discovery?.recursive===false&&discovery?.pageSize===100&&discovery?.maxPagesPerFolder===5&&discovery?.maxItemsPerFolder===500&&discovery?.maxTotalItems===1501&&discovery?.onOverflow==='held'&&discovery?.pagination==='explicit-finite'&&discovery?.continuationAuthority==='same-fixed-library-and-folder-only'&&discovery?.knownCurrentItem?.listItemId===908&&discovery?.knownCurrentItem?.keepOutsideWindow===true,'DISCOVERY_BOUNDARY');
    require(selection?.floor==='2026-09-30'&&selection?.filenameDay==='strict-calendar'&&selection?.versionPattern==='^[1-9][0-9]*\\.0$'&&selection?.versionOrder==='numeric-positive-major'&&selection?.choose==='greatest-report-date'&&selection?.ambiguity==='different-items-at-greatest-date-hold'&&selection?.folderDateMustEqualReportDate===false&&selection?.modifiedTimeOrdering===false&&selection?.baselineInferenceFromMail===false,'DISCOVERY_BOUNDARY');
    require(same(c('Source_before')?.sourceFields,SOURCE_FIELDS)&&same(c('Source_before')?.proofFields,SOURCE_PROOF)&&same(c('Source_after')?.proofFields,SOURCE_PROOF)&&c('Source_before')?.eTag==='actual-opaque-file-tag'&&c('Source_after')?.sameObjectAs==='Source_before','SOURCE_METADATA');
    require(a.Read_source_workbook?.inputs?.parameters?.dataset===SOURCE_SITE&&a.Read_source_workbook?.inputs?.parameters?.path==="@outputs('Select_latest_eligible')?['contentPath']"&&c('Create_private_workbook')?.body==="@body('Read_source_workbook')",'SOURCE_METADATA');
    require(c('Create_private_workbook')?.folderPath===`${PRIVATE_ROOT}/intake`&&c('Create_intake_manifest_last')?.folderPath===`${PRIVATE_ROOT}/intake`,'PRIVATE_BOUNDARY');
    for(const name of ['Create_private_workbook','Intake_manifest','Create_intake_manifest_last','Persist_current_discovery_hint'])require(entries.get(name)?.ancestors.includes('Stable_source'),'GUARD_SCOPE',name);
    ordered('Discover_bounded_sources','Runtime_binding_required');ordered('Source_before','Attempt_id');ordered('Read_source_workbook','Source_before');ordered('Source_after','Read_source_workbook');ordered('Stable_source','Source_after');ordered('Intake_manifest','Create_private_workbook');ordered('Create_intake_manifest_last','Intake_manifest');
    require(exactKeys(a.Intake_manifest?.inputs,['schemaVersion','kind','operationId','attemptId','createdAt','source','before','after','workbookFile','sha256'])&&a.Intake_manifest.inputs.sha256===null,'SOURCE_HASH_BOUNDARY');
    ordered('Persist_current_discovery_hint','Create_intake_manifest_last');
    require(discovery?.folderCoverage==='all-three-checked-or-positively-absent-otherwise-held'&&discovery?.currentHint?.acceptedAuthority===false&&discovery?.currentHint?.immutable===true&&discovery?.currentHint?.lastStagedOnly===true&&discovery?.currentHint?.onOverflow==='held'&&discovery?.currentHint?.maxCursorRecords===100,'DISCOVERY_BOUNDARY');
    require(c('Persist_current_discovery_hint')?.afterPositiveManifestCompletion===true&&c('Persist_current_discovery_hint')?.acceptedAuthority===false&&c('Persist_current_discovery_hint')?.immutable===true&&c('Persist_current_discovery_hint')?.overwrite===false&&c('Persist_current_discovery_hint')?.newCommandKind===false&&same(c('Persist_current_discovery_hint')?.retryPolicy,{type:'none'}),'DISCOVERY_BOUNDARY');
  }else{
    const t=trigger?.File_created_or_modified;require(exactKeys(trigger,['File_created_or_modified'])&&t?.type==='OpenApiConnection'&&t?.inputs?.host?.operationId==='GetOnUpdatedFileItems'&&t?.inputs?.parameters?.dataset===PRIVATE_SITE&&t?.inputs?.parameters?.folderPath===`${PRIVATE_ROOT}/commands`&&t?.inputs?.parameters?.table==='__BIND_VERIFIED_PRIVATE_DOCUMENTS_LIST_ID__'&&t?.runtimeConfiguration?.concurrency?.runs===1&&secure(t),'TRIGGER_BOUNDARY');
    require(t?.inputs?.host?.apiId===API&&t?.inputs?.host?.connectionName==='shared_sharepointonline'&&t?.inputs?.authentication==="@parameters('$authentication')",'CONNECTION_BOUNDARY');
    const schema=a.Parse_command?.inputs?.schema, nested=schema?.properties?.candidate;
    require(schema?.additionalProperties===false&&exactKeys(schema?.properties,COMMAND_FIELDS)&&same([...schema?.required??[]].sort(),[...COMMAND_FIELDS].sort())&&same(schema?.properties?.kind?.enum,['publication'])&&nested?.additionalProperties===false&&exactKeys(nested?.properties,CANDIDATE_FIELDS)&&same([...nested?.required??[]].sort(),[...CANDIDATE_FIELDS].sort())&&same(nested?.properties?.provider?.enum,['sharepoint'])&&nested?.properties?.bytes?.minimum===36&&nested?.properties?.bytes?.maximum===67108864,'COMMAND_SCHEMA');
    const uuidPattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    for(const property of ['operationId','attemptId'])require(schema?.properties?.[property]?.type==='string'&&schema?.properties?.[property]?.pattern===uuidPattern,'COMMAND_SCHEMA');
    require(nested?.properties?.candidateId?.pattern===uuidPattern&&nested?.properties?.sha256?.pattern==='^[0-9a-f]{64}$','COMMAND_SCHEMA');
    require(c('Exact_command_event')?.exactFolder===`${PRIVATE_ROOT}/commands`&&c('Exact_command_event')?.noSubfolders===true&&c('Exact_command_event')?.rejectResults===true&&c('Exact_command_event')?.rejectAttempts===true&&c('Exact_command_event')?.callerPath===false,'PRIVATE_BOUNDARY');
    const command=c('Validate_command');require(command?.fixedDestination===true&&command?.driveId===DRIVE_BINDING&&command?.folderId===FOLDER_BINDING&&command?.kind==='publication'&&command?.maxBytes===65536&&command?.newAttemptMustBeUnexpired===true&&command?.sameAttemptDifferentContent==='held'&&command?.fileReference==='uuid-basename-only'&&command?.strictCalendarAndUtc===true&&same(command?.exactFields,COMMAND_FIELDS)&&same(command?.candidateFields,CANDIDATE_FIELDS),'COMMAND_BOUNDARY');
    require(command?.canonicalProducerOnly===true&&command?.rawDuplicateRejectionClaimed===false,'PRIVATE_BOUNDARY');
    require(a.Read_command?.inputs?.parameters?.path==="@concat('/Documents/PPC ASCM/commands/',outputs('Exact_command_event')?['commandFile'])"&&a.Parse_command?.inputs?.content==="@base64ToString(body('Read_command')?['$content'])"&&a.Read_private_ciphertext?.inputs?.parameters?.path==="@concat('/Documents/PPC ASCM/commands/',body('Parse_command')?['ciphertextFile'])",'COMMAND_BOUNDARY');
    const claim=c('Claim_exact_attempt');require(claim?.exactMatchBeforeMutation===true&&claim?.duplicate==='positive-reconcile-only'&&claim?.changedContent==='held'&&claim?.missingRecord==='not-proof-of-no-mutation'&&claim?.uncertainRecordWrite==='positive-exact-record-read-only'&&claim?.phase==='claimed'&&claim?.rawCommand==="@body('Read_command')?['$content']"&&claim?.exactCommand==="@body('Parse_command')"&&claim?.outputPermission==='new-positively-created-claim-only','DURABLE_ATTEMPT');
    require(a.Try_new_attempt?.expression?.and?.[0]?.equals?.[0]==="@equals(outputs('Claim_exact_attempt')?['permission'],'new-positively-created-claim-only')",'DURABLE_ATTEMPT');
    for(const [name,phase,mutation]of [['Persist_stage_started','stage_started','Create_fresh_stage'],['Persist_promote_started','promote_started','Promote_package']])require(c(name)?.phase===phase&&c(name)?.beforeMutation===mutation&&c(name)?.exactCommand==="@body('Parse_command')"&&c(name)?.createOnly===true&&c(name)?.alreadyExists==='reconcile-only'&&c(name)?.uncertain==='hold','DURABLE_ATTEMPT',name);
    for(const name of ['Claim_exact_attempt','Persist_stage_started','Persist_promote_started']){require(c(name)?.overwrite===false,'CREATE_ONLY',name);require(same(c(name)?.retryPolicy,{type:'none'}),'WRITE_RETRY',name);require(c(name)?.folderPath===`${PRIVATE_ROOT}/results/attempts`,'PRIVATE_BOUNDARY',name);}
    require(c('Create_fresh_stage')?.freshUuid===true&&c('Create_fresh_stage')?.no404RetryPermission===true&&c('Create_fresh_stage')?.uncertain==='positive-reconcile-only','DURABLE_ATTEMPT');
    const promotion=a.Promote_package?.inputs?.parameters, uri=promotion?.['parameters/uri'];
    require(promotion?.dataset===FINAL_SITE&&promotion?.['parameters/method']==='POST'&&typeof uri==='string'&&uri.startsWith("@concat('_api/web/GetFileByServerRelativeUrl(''/teams/PCGamingCategory/Shared Documents/Product Portfolio/PPC/'")&&uri.includes("body('Parse_command')?['stageFile']")&&uri.includes("body('Parse_command')?['candidate']?['fileName']")&&uri.endsWith("''',flags=0)')")&&!/overwrite|https?:|destinationUrl/i.test(uri),'PROMOTION_BOUNDARY');
    for(const name of ['Final_before','Final_after'])require(c(name)?.exactCandidate===true&&c(name)?.requiresPositiveIdentity===true&&c(name)?.driveId===DRIVE_BINDING&&c(name)?.folderId===FOLDER_BINDING&&same(c(name)?.itemFields,ITEM_FIELDS)&&same(c(name)?.proofFields,FINAL_PROOF)&&c(name)?.missingOr404==='held-no-retry-permission','FRESH_REMOTE_READ',name);
    require(c('Create_fresh_readback')?.body==="@body('Read_actual_final')"&&c('Create_fresh_readback')?.actualFinalBytesOnly===true&&same(c('Create_fresh_readback')?.distinctFrom,['ciphertextFile','stageFile']),'FRESH_REMOTE_READ');
    require(a.Read_actual_stage?.inputs?.parameters?.dataset===FINAL_SITE&&a.Read_actual_stage?.inputs?.parameters?.path==="@concat('/Shared Documents/Product Portfolio/PPC/',body('Parse_command')?['stageFile'])"&&a.Read_actual_final?.inputs?.parameters?.dataset===FINAL_SITE&&a.Read_actual_final?.inputs?.parameters?.path==="@concat('/Shared Documents/Product Portfolio/PPC/',body('Parse_command')?['candidate']?['fileName'])"&&a.Readback_name?.inputs==="@concat(toLower(guid()),'.pkg')"&&c('Create_fresh_readback')?.name==="@outputs('Readback_name')",'FRESH_REMOTE_READ');
    const result=a.Result_manifest?.inputs;
    require(exactKeys(result,['schemaVersion','kind','operationId','attemptId','createdAt','status','candidateId','generation','item','before','after','readbackFile','code'])&&result.schemaVersion===1&&result.kind==='publication_result'&&result.status==='verified'&&result.operationId==="@body('Parse_command')?['operationId']"&&result.attemptId==="@body('Parse_command')?['attemptId']"&&result.candidateId==="@body('Parse_command')?['candidate']?['candidateId']"&&result.generation==="@body('Parse_command')?['candidate']?['generation']"&&result.item==="@outputs('Final_before')?['item']"&&result.before==="@outputs('Final_before')?['proof']"&&result.after==="@outputs('Final_after')?['proof']"&&result.readbackFile==="@outputs('Readback_name')"&&result.code==='VERIFIED','RESULT_SCHEMA');
    for(const name of ['Create_fresh_stage','Promote_package','Create_fresh_readback','Result_manifest','Create_result_manifest_last'])require(entries.get(name)?.ancestors.includes('Ciphertext_envelope_valid'),'GUARD_SCOPE',name);
    for(const name of ['Create_fresh_readback','Result_manifest','Create_result_manifest_last'])require(entries.get(name)?.ancestors.includes('Final_stable_and_equal')&&entries.get(name)?.ancestors.includes('Readback_names_distinct'),'GUARD_SCOPE',name);
    for(const [next,previous]of [['Exact_command_event','Runtime_binding_required'],['Read_command','Exact_command_event'],['Parse_command','Read_command'],['Validate_command','Parse_command'],['Read_private_ciphertext','Validate_command'],['Ciphertext_envelope_valid','Read_private_ciphertext'],['Try_new_attempt','Claim_exact_attempt'],['Create_fresh_stage','Persist_stage_started'],['Stage_bytes_match','Read_actual_stage'],['Promote_package','Persist_promote_started'],['Read_actual_final','Final_before'],['Final_after','Read_actual_final'],['Final_stable_and_equal','Final_after'],['Readback_names_distinct','Readback_name'],['Result_manifest','Create_fresh_readback'],['Create_result_manifest_last','Result_manifest']])ordered(next,previous);
    require(same(a.Create_fresh_readback?.runAfter,{}),'WRITE_ORDER','Create_fresh_readback');
    ordered('Read_actual_stage','Create_fresh_stage',['Succeeded','Failed','TimedOut']);ordered('Final_before','Try_new_attempt',['Succeeded','Failed','TimedOut']);
  }
  // Execute actual expressions against positive and hand-mutated negative facts.
  for(const name of flow.kind==='intake'?['Stable_source']:['Ciphertext_envelope_valid','Stage_bytes_match','Final_stable_and_equal','Readback_names_distinct']){
    try{
      require(gate(flow,name,gateFixtures())===true,'CONDITION_BEHAVIOR',name);
      const probes=[];
      if(name==='Stable_source'){
        for(const field of SOURCE_PROOF){const facts=gateFixtures();facts.outputs.Source_after.proof[field]='changed';probes.push(facts);}
        const facts=gateFixtures();facts.body.Read_source_workbook.$content=Buffer.alloc(249).toString('base64');probes.push(facts);
      }else if(name==='Ciphertext_envelope_valid'){
        for(let offset=0;offset<8;offset++){const facts=gateFixtures(),raw=Buffer.from(facts.body.Read_private_ciphertext.$content,'base64');raw[offset]^=1;facts.body.Read_private_ciphertext.$content=raw.toString('base64');probes.push(facts);}
        for(const bytes of [0,35,37,67108865]){const facts=gateFixtures();facts.body.Parse_command.candidate.bytes=bytes;probes.push(facts);}
      }else if(name==='Stage_bytes_match'){
        const facts=gateFixtures();facts.body.Read_actual_stage.$content=Buffer.alloc(36,9).toString('base64');probes.push(facts);
      }else if(name==='Final_stable_and_equal'){
        for(const field of FINAL_PROOF){const facts=gateFixtures();facts.outputs.Final_after.proof[field]='changed';probes.push(facts);}
        const facts=gateFixtures();facts.body.Read_actual_final.$content=Buffer.alloc(36,9).toString('base64');probes.push(facts);
      }else{for(const target of ['ciphertextFile','stageFile']){const facts=gateFixtures();facts.outputs.Readback_name=facts.body.Parse_command[target];probes.push(facts);}const facts=gateFixtures();facts.body.Parse_command.stageFile=facts.body.Parse_command.ciphertextFile;probes.push(facts);}
      for(const facts of probes)require(gate(flow,name,facts)===false,'CONDITION_BEHAVIOR',name);
    }catch{emit('CONDITION_BEHAVIOR',name);}
  }
  return {valid:diagnostics.length===0,diagnostics};
}

const artifact = kind => JSON.parse(readFileSync(new URL(`../../docs/ascm/standard-sync-${kind}-flow.json`, import.meta.url)));
const actions = flow => Object.fromEntries([...indexNativeActions(flow.definition)].map(([name, value]) => [name, value.action]));
const contract = (flow, name) => actions(flow)[name].inputs.contract;
const clone = value => structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function gateFixtures() {
  const raw = Buffer.concat([Buffer.from('PPCPKG01'), Buffer.alloc(28, 7)]).toString('base64');
  return { body: {
    Parse_command: { candidate: { bytes: 36 }, ciphertextFile: 'input.pkg', stageFile: 'stage.pkg' }, Read_private_ciphertext: { $content: raw }, Read_actual_stage: { $content: raw },
    Read_actual_final: { $content: raw }, Read_source_workbook: { $content: Buffer.alloc(250, 1).toString('base64') }
  }, outputs: {
    Readback_name: 'fresh.pkg', Source_before: { proof: { listItemId: 908, itemUniqueId: 'source-item', versionLabel: '2.0', eTag: 'opaque-source', bytes: 250 } },
    Source_after: { proof: { listItemId: 908, itemUniqueId: 'source-item', versionLabel: '2.0', eTag: 'opaque-source', bytes: 250 } },
    Final_before: { item: { driveId: 'fixed-drive', folderId: 'fixed-folder', itemId: 'actual-item', versionId: '3.0', fileName: 'actual.pkg' }, proof: { itemId: 'actual-item', eTag: 'opaque-final', versionId: '3.0', bytes: 36 } },
    Final_after: { item: { driveId: 'fixed-drive', folderId: 'fixed-folder', itemId: 'actual-item', versionId: '3.0', fileName: 'actual.pkg' }, proof: { itemId: 'actual-item', eTag: 'opaque-final', versionId: '3.0', bytes: 36 } }
  } };
}
function gate(flow, name, facts) { return evaluateOfflineExpression(actions(flow)[name].expression.and[0].equals[0], facts); }
function rejection(kind, mutate, expectedCode) {
  const flow = artifact(kind); mutate(flow, actions(flow));
  const result = validateStandardSyncFlow(flow);
  assert.equal(result.valid, false, `unsafe ${kind} graph accepted`);
  assert(result.diagnostics.some(value => value.code === expectedCode), JSON.stringify(result));
  assert(!JSON.stringify(result).includes('fake-private-secret'));
  for (const value of result.diagnostics) assert.deepEqual(Object.keys(value).sort(), ['action','code']);
}
const file = (id, day, version = '2.0', folder = '(09) September 2026') => ({ listItemId: id, itemUniqueId: `source-${id}`,
  fileName: `ASCM Report_HyperX_${day}.xlsx`, relativePath: `${folder}/ASCM Report_HyperX_${day}.xlsx`, versionLabel: version,
  eTag: `etag-${id}-${version}`, bytes: 250232 });
const discovery = items => ({ folders: [
  { name: '(09) September 2026', pages: [{ items, next: null }] },
  { name: '(10) October 2026', pages: [{ items: [], next: null }] },
  { name: '(08) August 2026', pages: [{ items: [], next: null }] }
], knownCurrentItem: null });

function registerTests() {
  test('rejects a definition without authority, bounded graph, or deployment guard', () => assert.equal(validateStandardSyncFlow({}).valid, false));
  test('both offline graphs preserve an explicit unresolved runtime guard', () => {
    for (const kind of ['intake','command']) assert.deepEqual(validateStandardSyncFlow(artifact(kind)), { valid: true, diagnostics: [] });
  });
  test('cannot label a static graph activated, imported, or executable', () => {
    rejection('intake', flow => { flow.readiness.activationAllowed = true; }, 'RUNTIME_BINDING_GATE');
    rejection('command', flow => { flow.readiness.importTested = true; }, 'RUNTIME_BINDING_GATE');
    rejection('command', (flow, a) => { delete flow.definition.actions.Runtime_binding_required; }, 'RUNTIME_BINDING_GATE');
  });
  test('rejects wrong hourly type, parallel runs, manual auth, or another connection', () => {
    rejection('intake', flow => { flow.definition.triggers.Recurrence.recurrence.interval = 1; }, 'TRIGGER_BOUNDARY');
    rejection('intake', flow => { flow.definition.triggers.Recurrence.runtimeConfiguration.concurrency.runs = 2; }, 'TRIGGER_BOUNDARY');
    rejection('command', flow => { flow.connectionReferences.shared_sharepointonline.source = 'Invoker'; }, 'CONNECTION_BOUNDARY');
    rejection('command', (flow, a) => { a.Read_command.inputs.host.connectionName = 'new-account'; }, 'CONNECTION_BOUNDARY');
    rejection('intake', (flow, a) => { a.Read_source_workbook.inputs.authentication = { type: 'Raw', value: 'fake-private-secret' }; }, 'CONNECTION_BOUNDARY');
  });
  test('command event cannot monitor results, all Documents, or another event', () => {
    rejection('command', flow => { flow.definition.triggers.File_created_or_modified.inputs.parameters.folderPath = '/Documents/PPC ASCM/results'; }, 'TRIGGER_BOUNDARY');
    rejection('command', flow => { delete flow.definition.triggers.File_created_or_modified.inputs.parameters.folderPath; }, 'TRIGGER_BOUNDARY');
    rejection('command', flow => { flow.definition.triggers.File_created_or_modified.inputs.host.operationId = 'GetOnUpdatedItems'; }, 'TRIGGER_BOUNDARY');
  });
  test('forbids Outlook, Archive commands, premium HTTP, backend calls, and unsafe URLs', () => {
    rejection('command', flow => { flow.definition.actions.Outlook = { type: 'OpenApiConnection', inputs: { host: { apiId: 'shared_office365', operationId: 'MoveV2' } } }; }, 'FORBIDDEN_OPERATION');
    rejection('command', (flow, a) => { a.Read_command.type = 'Http'; a.Read_command.inputs.uri = 'https://backend.invalid/functions/v1/ppc-ascm-flow'; }, 'FORBIDDEN_OPERATION');
    rejection('command', (flow, a) => { a.Parse_command.inputs.schema.properties.kind.enum = ['publication','archive']; }, 'COMMAND_SCHEMA');
    rejection('command', (flow, a) => { a.Read_actual_final.inputs.parameters.dataset = 'https://fake-private-secret.invalid'; }, 'FIXED_AUTHORITY');
    rejection('command', (flow, a) => { a.Promote_package.inputs.parameters['parameters/uri'] = "@body('Parse_command')?['destinationUrl']"; }, 'PROMOTION_BOUNDARY');
  });
  test('closed canonical commands cannot override destination or claim raw duplicate rejection', () => {
    rejection('command', (flow, a) => { a.Parse_command.inputs.schema.additionalProperties = true; }, 'COMMAND_SCHEMA');
    rejection('command', (flow, a) => { a.Parse_command.inputs.schema.properties.candidate.properties.destinationUrl = { type: 'string' }; }, 'COMMAND_SCHEMA');
    rejection('command', flow => { contract(flow,'Validate_command').fixedDestination = false; }, 'COMMAND_BOUNDARY');
    rejection('command', flow => { contract(flow,'Validate_command').rawDuplicateRejectionClaimed = true; }, 'PRIVATE_BOUNDARY');
  });
  test('all history remains secure and errors expose only closed diagnostic codes', () => {
    rejection('intake', (flow, a) => { delete a.Read_source_workbook.runtimeConfiguration.secureData; }, 'SECURE_HISTORY');
    rejection('command', flow => { flow.errorPolicy.rawException = true; }, 'ERROR_BOUNDARY');
    rejection('command', (flow, a) => { a.Safe_diagnostic.inputs.details = "@outputs('Promote_package')"; }, 'ERROR_BOUNDARY');
  });
  test('durable exact command and each phase precede its external mutation', () => {
    rejection('command', flow => { contract(flow,'Claim_exact_attempt').changedContent = 'continue'; }, 'DURABLE_ATTEMPT');
    rejection('command', flow => { contract(flow,'Claim_exact_attempt').missingRecord = 'retry-create'; }, 'DURABLE_ATTEMPT');
    rejection('command', (flow, a) => { a.Try_new_attempt.expression.and[0].equals[0] = '@true'; }, 'DURABLE_ATTEMPT');
    rejection('command', (flow, a) => { a.Create_fresh_stage.runAfter = {}; }, 'WRITE_ORDER');
    rejection('command', (flow, a) => { a.Promote_package.runAfter = {}; }, 'WRITE_ORDER');
  });
  test('writes cannot retry, overwrite collisions, or accept a 404 as retry permission', () => {
    rejection('command', flow => { contract(flow,'Create_fresh_stage').overwrite = true; }, 'CREATE_ONLY');
    rejection('command', flow => { contract(flow,'Create_fresh_stage').no404RetryPermission = false; }, 'DURABLE_ATTEMPT');
    rejection('command', (flow, a) => { a.Promote_package.inputs.retryPolicy = { type: 'exponential', count: 2 }; }, 'WRITE_RETRY');
    rejection('command', (flow, a) => { a.Promote_package.inputs.parameters['parameters/uri'] = a.Promote_package.inputs.parameters['parameters/uri'].replace('flags=0','flags=1'); }, 'PROMOTION_BOUNDARY');
  });
  test('actual remote content is between before/after metadata and fresh returned bytes precede the manifest', () => {
    rejection('command', (flow, a) => { a.Final_after.runAfter = { Final_before: ['Succeeded'] }; }, 'WRITE_ORDER');
    rejection('command', (flow, a) => { a.Create_fresh_readback.inputs.contract.body = "@body('Read_private_ciphertext')"; }, 'FRESH_REMOTE_READ');
    rejection('command', (flow, a) => { a.Result_manifest.runAfter = { Readback_name: ['Succeeded'] }; }, 'WRITE_ORDER');
    rejection('command', flow => { contract(flow,'Create_result_manifest_last').folderPath = '/Documents/PPC ASCM/commands'; }, 'PRIVATE_BOUNDARY');
  });
  test('gates are bound to actual source, stage, and candidate final reads', () => {
    rejection('command', (flow,a)=>{a.Read_actual_final.inputs.parameters.path="@concat('/Shared Documents/Product Portfolio/PPC/',body('Parse_command')?['stageFile'])";},'FRESH_REMOTE_READ');
    rejection('command', (flow,a)=>{a.Read_private_ciphertext.inputs.parameters.path="@concat('/Documents/PPC ASCM/commands/',body('Parse_command')?['stageFile'])";},'COMMAND_BOUNDARY');
    rejection('intake', flow=>{contract(flow,'Create_private_workbook').body="@outputs('Source_before')";},'SOURCE_METADATA');
    rejection('intake', flow=>{contract(flow,'Create_private_workbook').folderPath='/Documents/PPC ASCM/results';},'PRIVATE_BOUNDARY');
  });
  test('result envelope preserves the exact candidate and fresh returned filename binding',()=>{
    rejection('command',(flow,a)=>{a.Result_manifest.inputs.readbackFile="@body('Parse_command')?['ciphertextFile']";},'RESULT_SCHEMA');
    rejection('command',(flow,a)=>{a.Result_manifest.inputs.before="@outputs('Final_after')?['proof']";},'RESULT_SCHEMA');
    rejection('command',(flow,a)=>{a.Result_manifest.inputs.extra='caller-controlled';},'RESULT_SCHEMA');
    rejection('command',(flow,a)=>{a.Readback_name.inputs="@body('Parse_command')?['stageFile']";},'FRESH_REMOTE_READ');
  });
  test('returned, private, and stage names must all differ before a result file can be written',()=>{
    const flow=artifact('command'), a=actions(flow); assert(a.Readback_names_distinct,'missing distinct-name gate');
    const facts=gateFixtures();facts.outputs.Readback_name='fresh.pkg';facts.body.Parse_command.ciphertextFile='input.pkg';facts.body.Parse_command.stageFile='stage.pkg';
    assert.equal(gate(flow,'Readback_names_distinct',facts),true);
    for(const name of ['input.pkg','stage.pkg']){const changed=clone(facts);changed.outputs.Readback_name=name;assert.equal(gate(flow,'Readback_names_distinct',changed),false);}
    rejection('command',(flow,a)=>{a.Readback_names_distinct.expression.and[0].equals[0]='@true';},'CONDITION_BEHAVIOR');
    rejection('intake',(flow,a)=>{flow.definition.actions.Create_private_workbook=a.Create_private_workbook;delete a.Stable_source.actions.Create_private_workbook;},'GUARD_SCOPE');
  });
  test('graph rejects dependency cycles, references outside scope, and expression action typos', () => {
    rejection('intake', (flow, a) => { a.Source_before.runAfter = { Source_after: ['Succeeded'] }; }, 'GRAPH_CYCLE');
    rejection('intake', (flow, a) => { a.Create_intake_manifest_last.runAfter = { Source_after: ['Succeeded'] }; }, 'RUN_AFTER_SCOPE');
    rejection('intake', (flow, a) => { a.Read_source_workbook.inputs.parameters.path = "@outputs('fake-private-secret')"; }, 'UNKNOWN_REFERENCE');
    rejection('command',(flow,a)=>{flow.definition.actions.Read_actual_final=clone(a.Read_actual_final);},'DUPLICATE_ACTION');
  });
  test('read-only source and binary read actions cannot be relabeled as SharePoint mutations',()=>{
    rejection('intake',(flow,a)=>{a.Read_source_workbook.inputs.host.operationId='HttpRequest';a.Read_source_workbook.inputs.parameters['parameters/method']='POST';},'FORBIDDEN_OPERATION');
    rejection('command',(flow,a)=>{a.Read_command.inputs.parameters['parameters/uri']='_api/web/delete';},'FORBIDDEN_OPERATION');
    rejection('command',(flow,a)=>{a.Parse_command.inputs.schema.properties.operationId.pattern='.*';},'COMMAND_SCHEMA');
    rejection('command',(flow,a)=>{a.Parse_command.inputs.schema.properties.candidate.properties.sha256.pattern='.*';},'COMMAND_SCHEMA');
  });
  test('intake policy holds on unbounded discovery and writes workbook before manifest', () => {
    rejection('intake', flow => { contract(flow,'Discover_bounded_sources').onOverflow = 'select-best-effort'; }, 'DISCOVERY_BOUNDARY');
    rejection('intake', flow => { contract(flow,'Discover_bounded_sources').maxPagesPerFolder = 0; }, 'DISCOVERY_BOUNDARY');
    rejection('intake', flow => { contract(flow,'Discover_bounded_sources').knownCurrentItem.keepOutsideWindow = false; }, 'DISCOVERY_BOUNDARY');
    rejection('intake', (flow, a) => { a.Intake_manifest.runAfter = {}; }, 'WRITE_ORDER');
    rejection('intake', (flow, a) => { a.Intake_manifest.inputs.sha256 = '0'.repeat(64); }, 'SOURCE_HASH_BOUNDARY');
  });
  test('actual stable source gate rejects metadata race, short content, zero and over-cap content', () => {
    const flow = artifact('intake'), facts = gateFixtures();
    assert.equal(gate(flow,'Stable_source',facts), true);
    for (const field of ['listItemId','itemUniqueId','versionLabel','eTag','bytes']) {
      const changed = clone(facts); changed.outputs.Source_after.proof[field] = 'changed'; assert.equal(gate(flow,'Stable_source',changed), false, field);
    }
    const short = clone(facts); short.body.Read_source_workbook.$content = Buffer.alloc(249).toString('base64'); assert.equal(gate(flow,'Stable_source',short), false);
    rejection('intake', (flow, a) => { a.Stable_source.expression.and[0].equals[0] = '@true'; }, 'CONDITION_BEHAVIOR');
  });
  test('ciphertext gate binds all eight actual header bytes and exact real byte count', () => {
    const flow = artifact('command');
    for (const fill of [0,1,63,64,127,128,191,192,255]) {
      const facts = gateFixtures(); facts.body.Read_private_ciphertext.$content = Buffer.concat([Buffer.from('PPCPKG01'),Buffer.alloc(28,fill)]).toString('base64');
      assert.equal(gate(flow,'Ciphertext_envelope_valid',facts), true, `tail ${fill}`);
    }
    for (let i = 0; i < 8; i++) { const facts = gateFixtures(), raw = Buffer.from(facts.body.Read_private_ciphertext.$content,'base64'); raw[i] ^= 1;
      facts.body.Read_private_ciphertext.$content = raw.toString('base64'); assert.equal(gate(flow,'Ciphertext_envelope_valid',facts), false, `header ${i}`); }
    for (const bytes of [0,35,37,67108865]) { const facts=gateFixtures(); facts.body.Parse_command.candidate.bytes=bytes; assert.equal(gate(flow,'Ciphertext_envelope_valid',facts),false); }
  });
  test('stage/final gates compare actual bytes and all remote metadata around the content read', () => {
    const flow=artifact('command'), facts=gateFixtures(); assert.equal(gate(flow,'Stage_bytes_match',facts),true); assert.equal(gate(flow,'Final_stable_and_equal',facts),true);
    for (const read of ['Read_actual_stage','Read_actual_final']) { const changed=clone(facts); changed.body[read].$content=Buffer.alloc(36,8).toString('base64'); assert.equal(gate(flow,read==='Read_actual_stage'?'Stage_bytes_match':'Final_stable_and_equal',changed),false); }
    for (const field of ['itemId','eTag','versionId','bytes']) { const changed=clone(facts); changed.outputs.Final_after.proof[field]='changed'; assert.equal(gate(flow,'Final_stable_and_equal',changed),false,field); }
    rejection('command',(flow,a)=>{a.Final_stable_and_equal.expression.and[0].equals[0]='@true';},'CONDITION_BEHAVIOR');
    rejection('command',(flow,a)=>{a.Stage_bytes_match.expression.and[0].equals[0]='@true';},'CONDITION_BEHAVIOR');
  });
  test('greatest eligible filename day wins despite a different containing folder or modified order', () => {
    const value=discovery([file(908,'2026-09-30'),file(909,'2026-10-01','1.0')]); value.folders[0].pages[0].items[0].lastModifiedAt='2026-10-18T00:00:00Z';
    assert.equal(selectOfflineSource(artifact('intake'),value,'2026-10-18T00:00:00Z').item.listItemId,909);
  });
  test('minor, zero, leading-zero, impossible dates and pre-floor files are ineligible', () => {
    for (const [day, version] of [['2026-09-29','2.0'],['2026-02-30','2.0'],['2026-09-30','0.0'],['2026-09-30','2.1'],['2026-09-30','02.0']])
      assert.equal(selectOfflineSource(artifact('intake'),discovery([file(908,day,version)]),'2026-10-18T00:00:00Z').status,'idle');
  });
  test('same greatest-day different items hold and numeric major ten is newer than two', () => {
    assert.equal(selectOfflineSource(artifact('intake'),discovery([file(908,'2026-09-30'),file(909,'2026-09-30')]),'2026-10-18T00:00:00Z').code,'SOURCE_AMBIGUOUS');
    const baseline={listItemId:908,itemUniqueId:'source-908',reportDate:'2026-09-30',versionLabel:'2.0'};
    assert.equal(selectOfflineSource(artifact('intake'),discovery([file(908,'2026-09-30','10.0')]),'2026-10-18T00:00:00Z',baseline).item.versionLabel,'10.0');
    assert.equal(selectOfflineSource(artifact('intake'),discovery([file(908,'2026-09-30','1.0')]),'2026-10-18T00:00:00Z',baseline).status,'idle');
  });
  test('retained current item is checked after its folder leaves the three-month window', () => {
    const value={folders:['(02) February 2027','(01) January 2027','(12) December 2026'].map(name=>({name,pages:[{items:[],next:null}]})),knownCurrentItem:{...file(908,'2026-09-30','3.0'),itemUniqueId:'e5cb1d81-7071-40b6-93cb-86ef0b577f52'}};
    assert.equal(selectOfflineSource(artifact('intake'),value,'2027-02-18T00:00:00Z').item.listItemId,908);
  });
  test('last-staged current-report hint replaces startup discovery after its folder ages out',()=>{
    const value={folders:['(02) February 2027','(01) January 2027','(12) December 2026'].map(name=>({name,pages:[{items:[],next:null}]})),knownCurrentItem:file(909,'2026-10-01','3.0','(10) October 2026')};
    const baseline={listItemId:909,itemUniqueId:'source-909',reportDate:'2026-10-01',versionLabel:'2.0'};
    assert.equal(selectOfflineSource(artifact('intake'),value,'2027-02-18T00:00:00Z',baseline).status,'selected');
  });
  test('caps and foreign continuation hold rather than silently choosing an incomplete latest', () => {
    const flow=artifact('intake'), value=discovery([file(908,'2026-09-30')]); value.folders[0].pages[0].next='https://foreign.invalid/page';
    assert.equal(selectOfflineSource(flow,value,'2026-10-18T00:00:00Z').code,'SOURCE_DISCOVERY_INCOMPLETE');
    const over=discovery(Array.from({length:500},()=>file(908,'2026-09-30'))); assert.equal(selectOfflineSource(flow,over,'2026-10-18T00:00:00Z').code,'SOURCE_DISCOVERY_INCOMPLETE');
    const old=discovery([file(908,'2026-09-30')]); old.folders[0].name='(01) January 2026'; assert.equal(selectOfflineSource(flow,old,'2026-10-18T00:00:00Z').code,'SOURCE_DISCOVERY_INCOMPLETE');
    const omitted=discovery([file(908,'2026-09-30')]);omitted.folders.pop();assert.equal(selectOfflineSource(flow,omitted,'2026-10-18T00:00:00Z').code,'SOURCE_DISCOVERY_INCOMPLETE');
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  registerTests();
}
