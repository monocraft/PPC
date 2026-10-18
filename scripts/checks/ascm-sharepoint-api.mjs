import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../../public/js/package-codec.js';
import { sourceDatabase, sourceMetadata, observation } from './ascm-sharepoint-sql.mjs';
let api;
try { api = await import('../../supabase/functions/ppc-master/ascm-sharepoint-api.mjs'); } catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof api?.createAscmSharePointApi,'function','SharePoint requires its own authenticated source handler without a mail envelope');
const { createAscmSharePointApi, validateAscmSharePointInput, ascmBusinessFingerprint }=api;
const secret='isolated-sharepoint-secret-'.padEnd(48,'a'), now=()=> '2026-10-18T12:00:00.000Z';
const seed={version:4,categories:[{id:'pc-gaming-audio',name:'PC gaming audio',board:{lanes:[{id:'wired',title:'Wired'}],products:[{id:'cloud-iii',name:'Cloud III',laneId:'wired',generalAvailabilityDate:'2026-01-15',endManufacturingDate:'2029-12-31',ascm:{basePartNumbers:['A1AAA']},partSkus:[],variantGroups:[],custom:{retain:true}}]}}]};
export async function workbook({day='2026-09-30',exported=`${day}T03:53:45`,shift=0,rows=[['Headset','A1AAA','HyperX Cloud III BLK GAM HS','2026-01-15','2029-12-31','N','','F1','Cloud III']],extra=''}={}) {
  const table=[...(exported===null?[]:[['Exported',exported]]),['Category','Base PN','GPG 40 char AMO Description','GA - General Availability','EM - End of Manufacturing','Local (Y/N)','Local Code','Feature ID','Code Name'],...rows];
  const xml=table.map((row,r)=>`<row r="${r+shift+1}">${row.map((v,c)=>`<c r="${String.fromCharCode(65+c)}${r+shift+1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`).join('');
  const files={'[Content_Types].xml':'<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>','xl/workbook.xml':'<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ASCM" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':`<worksheet><sheetData>${xml}</sheetData>${extra}</worksheet>`};
  return globalThis.PortfolioPackage.createZip(Object.entries(files).map(([name,xml])=>({name,data:new TextEncoder().encode(xml)})));
}
const bodyFor=async(options={},sourcePatch={})=>{const bytes=await workbook(options),source={...sourceMetadata,bytes:bytes.length,...sourcePatch};return {schemaVersion:1,source,before:observation(source),after:observation(source),workbookBase64:Buffer.from(bytes).toString('base64')};};
const {db,database}=await sourceDatabase();
let calls=[],dispatches=0;
const handler=(env={},wrap=async(op,payload)=>database(op,payload))=>createAscmSharePointApi({env:{PPC_ASCM_IMPORT_SECRET:secret,...env},now,database:async(op,payload)=>{calls.push({op,payload});return wrap(op,payload);},dispatchPublication:async()=>{dispatches++;return true;},validateManifest:value=>globalThis.PortfolioMasterModel.snapshot(value),validateReadableManifest:()=>{}});
const call=async(handle,body,options={})=>{const response=await handle(new Request('https://offline.test/api/master/ascmsharepoint',{method:options.method||'POST',headers:{'content-type':'application/json','x-ppc-ascm-secret':secret,...options.headers},...(options.method==='GET'?{}:{body:options.raw??JSON.stringify(body)})}));return {status:response.status,data:await response.json()};};
const reset=async(manifest=seed)=>{await db.exec('truncate ppc_private.ascm_sharepoint_receipts; truncate ppc_private.master_receipts,ppc_private.master_state,ppc_private.master_rate_limits;');await database('bootstrap',{manifest,sourceSha:'a'.repeat(40),fingerprint:'f'.repeat(64)});calls=[];dispatches=0;};
const state=()=>database('read');
const noArchive=result=>assert.equal(result.data.archiveAllowed,false,JSON.stringify(result));
try {
  await reset();const body=await bodyFor(),handle=handler();
  for(const options of [{headers:{'x-ppc-ascm-secret':'wrong'}},{headers:{origin:'https://browser.test'}},{method:'GET'}])noArchive(await call(handle,body,options));
  assert.equal((await call(handler({PPC_ASCM_IMPORT_SECRET:''}),body)).status,404);assert.equal(calls.length,0);
  for(const patch of [{schemaVersion:2},{patch:{}},{rawSha256:'a'.repeat(64)},{reportDate:'2026-09-30'},{source:{...body.source,hostname:'evil.test'}},{source:{...body.source,listItemId:'908'}},{source:{...body.source,versionLabel:'2.1'}},{source:{...body.source,versionLabel:'02.0'}},{source:{...body.source,relativePath:'../report.xlsx'}},{after:{...body.after,eTag:'changed'}}]){
    const result=await call(handle,{...body,...patch});assert.equal(result.status,400,JSON.stringify(result));noArchive(result);
  }
  assert.equal(calls.length,0,'untrusted source inputs cannot reach private database');
  assert.equal((await call(handle,body,{headers:{'content-length':String(3*1024*1024+1)}})).status,413);
  assert.equal((await call(handle,{...body,workbookBase64:Buffer.alloc(2*1024*1024+1).toString('base64')})).status,413);
  assert.equal((await call(handle,{...body,source:{...body.source,bytes:1},before:{...body.before,bytes:1},after:{...body.after,bytes:1}})).status,400);
  const first=await call(handle,body);assert.equal(first.status,202,JSON.stringify(first));noArchive(first);assert.equal(first.data.storageRevision,2);assert.equal(first.data.outcome,'accepted');assert.equal(dispatches,1);
  const exactId='ascm-sp-'+createHash('sha256').update(JSON.stringify(['ppc-ascm-sharepoint-v1',sourceMetadata.hostname,sourceMetadata.sitePath,sourceMetadata.driveId,sourceMetadata.listId,908,sourceMetadata.itemUniqueId,'2.0'])).digest('hex');assert.equal(first.data.requestId,exactId);
  assert.equal(Object.keys(first.data).length,10);assert.equal(JSON.stringify((await state()).manifest).includes('sharepoint'),false,'source provenance remains private');
  const replay=await call(handle,{...body,source:{...body.source,lastModifiedAt:'2026-10-08T07:44:51Z'}});assert.equal(replay.data.alreadySaved,true);assert.equal(replay.data.storageRevision,2);
  const altered=await bodyFor({extra:'<!--different ZIP bytes-->'});assert.equal((await call(handle,altered)).data.code,'ASCM_REPLAY_MISMATCH');
  const corruptBytes=Buffer.from('inert-not-xlsx'),corruptSource={...body.source,bytes:corruptBytes.length};
  assert.equal((await call(handle,{...body,source:corruptSource,before:observation(corruptSource),after:observation(corruptSource),workbookBase64:corruptBytes.toString('base64')})).data.code,'ASCM_REPLAY_MISMATCH','an already observed version with altered raw bytes is always a replay mismatch before semantic work');
  const before=await state(), nativeReceipts=(await db.query('select * from ppc_private.master_receipts')).rows, dispatchBefore=dispatches;
  const equivalent=await bodyFor({shift:4,exported:'2026-09-30T07:12:00'},{versionLabel:'10.0',eTag:'"synthetic-10"'});
  const eq=await call(handle,equivalent);assert.equal(eq.status,202,JSON.stringify(eq));assert.equal(eq.data.outcome,'equivalent');assert.equal(eq.data.acceptedRequestId,exactId);assert.deepEqual(eq.data.summary,{savedFields:0,savedProducts:0});assert.deepEqual(await state(),before);assert.deepEqual((await db.query('select * from ppc_private.master_receipts')).rows,nativeReceipts);assert.equal(dispatches,dispatchBefore+1,'pending equivalent work may recover uncovered publication');
  for(const options of [{exported:null},{exported:'not-a-date'},{exported:'2026-10-01T03:53:45'},{rows:[['Headset','A1AAA','HyperX Cloud III BLK GAM HS','2026-01-15','2029-12-31','bad','','F1','Cloud III']]},{rows:[['Headset','A1AAA','HyperX Cloud III BLK GAM HS','2026-01-15','2029-12-31','N','','F1','Cloud III'],['Headset','A1AAA','HyperX Cloud III BLK GAM HS','2026-01-15','2029-12-31','N','','F1','Cloud III']]}]){
    const bad=await call(handle,await bodyFor(options,{versionLabel:'11.0'}));assert.ok([400,409].includes(bad.status),JSON.stringify(bad));noArchive(bad);assert.deepEqual(await state(),before);
  }
  assert.equal((await call(handle,await bodyFor({},{versionLabel:'3.0'}))).data.code,'ASCM_SOURCE_STALE');
  assert.equal((await call(handle,await bodyFor({},{versionLabel:'11.0',listItemId:909}))).data.code,'ASCM_SOURCE_AMBIGUOUS');
  const rows=[['Headset','A1AAA','HyperX Cloud III BLK GAM HS','2026-01-15','2029-12-31','N','','F2','Cloud III']];
  const changed=await call(handle,await bodyFor({rows},{versionLabel:'11.0'}));assert.equal(changed.data.outcome,'accepted');assert.equal(changed.data.storageRevision,3);
  assert.equal((await call(handle,body)).data.storageRevision,2,'exact old replay survives newer correction');
  const publication={deliveryPhase:'sharepoint',provider:'sharepoint',kind:'publication',candidateId:'11111111-2222-4333-8444-555555555555',generation:1,sha256:'b'.repeat(64),bytes:36,storageRevision:3,publishedRevision:3,publishedAt:now()};
  for(const patch of [{kind:'seed'},{provider:'github'},{storageRevision:1},{publishedAt:null}])assert.equal((await call(handler({},async(op,p)=>{const r=await database(op,p);return op==='ascm_sharepoint_read'?{...r,publication:{...publication,...patch}}:r;}),body)).status,202);
  const publishedHandle=handler({},async(op,p)=>{const r=await database(op,p);return op==='ascm_sharepoint_read'?{...r,publication}:r;});
  const coveredDispatches=dispatches,published=await call(publishedHandle,equivalent);assert.equal(published.status,200,JSON.stringify(published));noArchive(published);assert.equal(dispatches,coveredDispatches,'covered equivalent replay never redispatches');
  let reads=0;assert.equal((await call(handler({},async(op,p)=>{const r=await database(op,p);if(op==='ascm_sharepoint_read'&&++reads>1)return {...r,receipt:null};return r;}),body)).status,503,'fresh independent linked native receipt required');
  const parsed=await globalThis.ASCMImporter.parseAscmWorkbook(Buffer.from(body.workbookBase64,'base64'),{strictDates:true});
  const fingerprint=await ascmBusinessFingerprint(parsed,'2026-09-30');
  const row=parsed.rows[0];const expected=createHash('sha256').update(JSON.stringify(['ppc-ascm-business-v1','2026-09-30',[[row.category,row.featureId,row.basePn,row.localFlag,row.localCode,row.description,row.codeName,row.ga,row.em]]])).digest('hex');assert.equal(fingerprint,expected);
  for(const [field,value] of Object.entries({category:'Mouse',featureId:'F2',basePn:'B1BBB',localFlag:'Y',localCode:'US',description:'Changed',codeName:'Other',ga:'2026-02-01',em:'2029-11-30'})){const next=structuredClone(parsed);next.rows[0][field]=value;assert.notEqual(await ascmBusinessFingerprint(next,'2026-09-30'),fingerprint,field);}
  assert.notEqual(await ascmBusinessFingerprint(parsed,'2026-10-31'),fingerprint);const shifted=structuredClone(parsed);shifted.rows[0].sourceRow+=100;shifted.rows[0].basePnRaw=' a1aaa ';assert.equal(await ascmBusinessFingerprint(shifted,'2026-09-30'),fingerprint);
  const two=structuredClone(parsed);two.rows.push({...two.rows[0],basePn:'B1BBB',description:'Other',sourceRow:100});assert.notEqual(await ascmBusinessFingerprint(two,'2026-09-30'),await ascmBusinessFingerprint({...two,rows:[...two.rows].reverse()},'2026-09-30'));
  await reset({...seed,ascmSnapshot:{sourceFile:sourceMetadata.fileName,importedAt:'2026-10-01T12:00:00.000Z'}});assert.equal((await call(handler(),body)).data.outcome,'accepted','matching legacy snapshot cannot become a SharePoint equivalence baseline');
  await reset();const lost=handler({},async(op,p)=>{const r=await database(op,p);if(op==='ascm_sharepoint_commit')throw new Error('Lost committed reply');return r;});assert.equal((await call(lost,body)).status,503);assert.equal((await call(handler(),body)).data.alreadySaved,true);
  await reset();const raced=handler({},async(op,p)=>op==='ascm_sharepoint_commit'?{status:'raced'}:database(op,p));assert.equal((await call(raced,body)).data.code,'ASCM_RETRY_REQUIRED');assert.equal((await state()).storageRevision,1);
  await reset();await call(handler(),body);
  const dates=structuredClone((await state()).manifest);dates.categories[0].board.products[0].generalAvailabilityDate='2026-01-01';
  await database('commit',{sessionId:'manual-owner',requestId:'manual-date-edit',fingerprint:'c'.repeat(64),expectedRevision:2,manifest:dates,changed:true,savedFields:1,savedProducts:1});
  const reviewBefore=await state();
  const dateReview=await call(handler(),equivalent);assert.equal(dateReview.data.reviewReason,'DATE_POLICY_REQUIRED');assert.deepEqual(await state(),reviewBefore,'equivalence cannot bypass current planner review');
  const protectedReview=await call(handler({PPC_ASCM_DATE_POLICY:JSON.stringify({version:1,allowUpdates:true,protected:[{productId:'cloud-iii',fields:['generalAvailabilityDate']}]})}),equivalent);assert.equal(protectedReview.data.reviewReason,'PROTECTED_DATE');assert.deepEqual(await state(),reviewBefore);
  const newer=await bodyFor({day:'2026-10-31'},{listItemId:920,itemUniqueId:'f5cb1d81-7071-40b6-93cb-86ef0b577f52',fileName:'ASCM Report_HyperX_2026-10-31.xlsx',relativePath:'(10) October 2026/ASCM Report_HyperX_2026-10-31.xlsx',versionLabel:'1.0'});
  const newPeriod=await call(handler({PPC_ASCM_DATE_POLICY:JSON.stringify({version:1,allowUpdates:true,protected:[]})}),newer);assert.equal(newPeriod.status,202,JSON.stringify(newPeriod));assert.equal(newPeriod.data.outcome,'accepted');assert.equal(newPeriod.data.storageRevision,4);assert.equal((await call(handler(),body)).data.storageRevision,2);
  await reset();let sourceReads=0,arrived;const bothRead=new Promise(resolve=>{arrived=resolve;});
  const concurrent=handler({},async(op,p)=>{const r=await database(op,p);if(op==='ascm_sharepoint_read'&&!r.sourceReceipt&&++sourceReads<=2){if(sourceReads===2)arrived();await bothRead;}return r;});
  const simultaneous=await Promise.all([call(concurrent,body),call(concurrent,body)]);assert.deepEqual(simultaneous.map(r=>r.status),[202,202]);assert.equal((await state()).storageRevision,2);assert.equal((await db.query('select count(*) n from ppc_private.master_receipts')).rows[0].n,1,'same-source concurrent requests accept once');
  await reset();await db.exec('update ppc_private.ascm_supervisor_status_config set enabled=true');
  let activeDuringCommit;
  const withCue=handler({PPC_ASCM_STATUS_ENABLED:'true'},async(op,p)=>{if(op==='ascm_sharepoint_commit')activeDuringCommit=(await db.query('select count(*) n from ppc_private.ascm_supervisor_runs')).rows[0].n;return database(op,p);});
  assert.equal((await call(withCue,body)).status,202);assert.equal(activeDuringCommit,1,'source planning retains actual-work supervisor lease');assert.equal((await db.query('select count(*) n from ppc_private.ascm_supervisor_runs')).rows[0].n,0,'source lease ends after committed response');
  assert.equal((await validateAscmSharePointInput(body)).rawSha256,createHash('sha256').update(Buffer.from(body.workbookBase64,'base64')).digest('hex'));
  for (const [exported, expected] of [
    ['2026-09-30', '2026-09-30'],
    ['2026-09-30T03:53:45', '2026-09-30T03:53:45'],
    ['2026-09-30T03:53:45Z', '2026-09-30T03:53:45.000Z'],
    ['2026-09-30T05:53:45+02:00', '2026-09-30T03:53:45.000Z'],
  ]) {
    await reset();
    const accepted = await call(handler(), await bodyFor({ exported }));
    assert.equal(accepted.status, 202, `${exported}: ${JSON.stringify(accepted)}`);
    assert.equal((await state()).manifest.ascmSnapshot.exportedAt, expected, 'retain the native parser output without adding or removing timezone information');
  }
  await reset();
  const wrongDay = await call(handler(), await bodyFor({ exported: '2026-09-30T23:53:45-02:00' }));
  assert.equal(wrongDay.status, 400, 'parser-normalized Exported calendar day must still match filename');
  assert.equal((await state()).storageRevision, 1);
  console.log('SharePoint source API passed: real strict XLSX/native PGlite, authority/bounds/Exported/dataset/fingerprints/replay/equivalence/receipt/publication/lost-response contracts; external fetch blocked.');
}finally{await db.close();}
