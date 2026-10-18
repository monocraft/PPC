import './shared/ascm-import.js';
import './shared/master-model.js';
import { planAscmImport, validateAscmDataset, AscmReviewError, ASCM_REVIEW_REASONS } from './ascm-plan.mjs';
import { configuredDatePolicy } from './ascm-api.mjs';
import { qualifiesSharePointPublication } from './package-delivery-contract.mjs';

const MAX_FILE=2*1024*1024, MAX_BODY=3*1024*1024, SESSION='ascm-sharepoint';
const encoder=new TextEncoder(), record=v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const exact=(v,keys)=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const sourceKeys=['provider','hostname','sitePath','driveId','listId','listItemId','itemUniqueId','fileName','relativePath','versionLabel','eTag','createdAt','lastModifiedAt','bytes'];
const observationKeys=['listItemId','itemUniqueId','versionLabel','eTag','bytes'];
const authority={provider:'sharepoint',hostname:'hp.sharepoint.com',sitePath:'/teams/IPSG_SCM_and_Product_Requirements_Info',driveId:'b!Dxcy8q8LE0GivbyM3D6Dq5C5iXHjfxBMsvQrwTpLknS0JFIuvvhlQoilkLMqZkl9',listId:'2e5224b4-f8be-4265-88a5-90b32a66497d'};
const integer=(v,min=1)=>Number.isSafeInteger(v)&&v>=min&&v<Number.MAX_SAFE_INTEGER;
const text=(v,max=512)=>typeof v==='string'&&v.length>0&&v.length<=max&&v.trim()===v&&!/[\x00-\x1f\x7f]/.test(v);
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(`${v}T00:00:00Z`))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v;
const instant=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
class SourceError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const problem=(status,code,message)=>new SourceError(status,code,message);
const invalid=()=>problem(400,'ASCM_SOURCE_REJECTED','Provide a stable published HyperX SharePoint workbook.');
const unavailable=()=>problem(503,'ASCM_UNAVAILABLE','The SharePoint import could not be confirmed. Retry later.');
const hash=async bytes=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const hashJson=value=>hash(encoder.encode(JSON.stringify(value)));
async function sameSecret(a,b){const [x,y]=await Promise.all([hash(encoder.encode(a)),hash(encoder.encode(b))]);let difference=0;for(let i=0;i<x.length;i++)difference|=x.charCodeAt(i)^y.charCodeAt(i);return difference===0;}
function decodeWorkbook(value){
  if(typeof value!=='string'||!value||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw problem(400,'ASCM_INVALID_WORKBOOK','Provide an ordinary XLSX workbook.');
  if(value.length>4*Math.ceil(MAX_FILE/3))throw problem(413,'ASCM_TOO_LARGE','Use manual review for reports larger than 2 MiB.');
  let binary;try{binary=atob(value);}catch{throw problem(400,'ASCM_INVALID_WORKBOOK','Provide an ordinary XLSX workbook.');}
  if(binary.length>MAX_FILE)throw problem(413,'ASCM_TOO_LARGE','Use manual review for reports larger than 2 MiB.');
  if(btoa(binary)!==value)throw problem(400,'ASCM_INVALID_WORKBOOK','Provide canonical workbook encoding.');
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
/** Pure bounded source validation shared by the public server-only transport.
 * The backend separately owns strict workbook parsing and native acceptance. */
export async function validateAscmSharePointInput(body){
  if(!exact(body,['schemaVersion','source','before','after','workbookBase64'])||body.schemaVersion!==1)throw invalid();
  const {source,before,after}=body;
  if(!exact(source,sourceKeys)||!exact(before,observationKeys)||!exact(after,observationKeys)
    ||Object.entries(authority).some(([k,v])=>source[k]!==v)||!integer(source.listItemId)
    ||typeof source.itemUniqueId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(source.itemUniqueId)
    ||typeof source.versionLabel!=='string'||!/^[1-9][0-9]{0,14}\.0$/.test(source.versionLabel)||!integer(Number(source.versionLabel.slice(0,-2)))
    ||!text(source.eTag)||!integer(source.bytes)||source.bytes>MAX_FILE
    ||!text(source.relativePath,1024)||/[\\:%?#]/.test(source.relativePath)||source.relativePath.startsWith('/')
    ||source.relativePath.split('/').some(part=>!part||part==='.'||part==='..')
    ||!text(source.fileName,160)||source.relativePath.split('/').at(-1)!==source.fileName
    ||!instant(source.createdAt)||!instant(source.lastModifiedAt)||Date.parse(source.createdAt)>Date.parse(source.lastModifiedAt)
    ||observationKeys.some(k=>before[k]!==source[k]||after[k]!==source[k]))throw invalid();
  const reportDate=/^ASCM Report_HyperX_(\d{4}-\d{2}-\d{2})\.xlsx$/.exec(source.fileName)?.[1];
  if(!day(reportDate)||reportDate<'2026-09-30')throw invalid();
  const bytes=decodeWorkbook(body.workbookBase64);
  if(bytes.length!==source.bytes)throw invalid();
  const requestId='ascm-sp-'+await hashJson(['ppc-ascm-sharepoint-v1',source.hostname,source.sitePath,source.driveId,source.listId,source.listItemId,source.itemUniqueId,source.versionLabel]);
  return {source,before,after,bytes,requestId,rawSha256:await hash(bytes),reportDate};
}

/** Version 1 includes every primary operand in strict parser order. */
export async function ascmBusinessFingerprint(dataset,reportDate){
  validateAscmDataset(dataset);
  if(!day(reportDate))throw invalid();
  const fields=['category','featureId','basePn','localFlag','localCode','description','codeName','ga','em'];
  return hashJson(['ppc-ascm-business-v1',reportDate,dataset.rows.map(row=>fields.map(field=>row[field]??''))]);
}
async function readBody(request){
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BODY))throw problem(413,'ASCM_TOO_LARGE','Use a bounded report request.');
  const reader=request.body?.getReader();if(!reader)throw invalid();
  let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY)throw problem(413,'ASCM_TOO_LARGE','Use a bounded report request.');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw invalid();}
}
function acceptedResponse(state,input,fingerprint,alreadySaved){
  const r=state?.sourceReceipt,n=state?.receipt;
  if(!record(r)||r.requestId!==input.requestId||r.fingerprint!==fingerprint||r.rawSha256!==input.rawSha256
    ||!integer(r.observationId)||!integer(r.storageRevision)||!['accepted','equivalent'].includes(r.outcome)
    ||typeof r.acceptedRequestId!=='string'||!/^ascm-sp-[a-f0-9]{64}$/.test(r.acceptedRequestId)
    ||!integer(r.savedFields,0)||!integer(r.savedProducts,0)||!record(n)||n.storageRevision!==r.storageRevision
    ||!integer(n.savedFields,0)||!integer(n.savedProducts,0)||typeof n.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(n.fingerprint)
    ||!integer(state.storageRevision)||state.storageRevision<r.storageRevision
    ||(r.outcome==='accepted'&&(r.acceptedRequestId!==r.requestId||n.fingerprint!==fingerprint||n.savedFields!==r.savedFields||n.savedProducts!==r.savedProducts))
    ||(r.outcome==='equivalent'&&(r.savedFields!==0||r.savedProducts!==0)))throw unavailable();
  const published=qualifiesSharePointPublication(state.publication,r.storageRevision)
    &&integer(state.publication?.publishedRevision)&&state.publication.publishedRevision>=r.storageRevision;
  const {driveId,listId,listItemId,itemUniqueId,versionLabel}=input.source;
  return {sourceProvider:'sharepoint',requestId:input.requestId,acceptedRequestId:r.acceptedRequestId,
    source:{driveId,listId,listItemId,itemUniqueId,versionLabel,rawSha256:input.rawSha256},storageRevision:r.storageRevision,
    alreadySaved,outcome:r.outcome,status:published?'published':'publication_pending',archiveAllowed:false,
    summary:{savedFields:r.savedFields,savedProducts:r.savedProducts}};
}

/** Server-to-server source acceptance; no URL fetch, mail identity or patches. */
export function createAscmSharePointApi({env={},database,now=()=>new Date().toISOString(),validateManifest,validateReadableManifest}={}){
  const secret=env.PPC_ASCM_IMPORT_SECRET||'',enabled=typeof secret==='string'&&secret.length>=32&&secret.length<=512&&!/[\s\x00-\x1f]/.test(secret);
  const reportStatus=async payload=>{try{return await database('ascm_status',payload);}catch{return null;}};
  return async function handle(request){
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
    const respond=(status,value)=>new Response(JSON.stringify(value),{status,headers});
    let leaseId='',leaseStarted=false;
    try{
      if(!enabled)throw problem(404,'NOT_FOUND','This master action is unavailable.');
      if(request.headers.get('origin'))throw problem(403,'ASCM_SERVER_ONLY','Use the configured SharePoint worker.');
      if(request.method!=='POST')throw problem(405,'ASCM_METHOD','Use a secure report request.');
      const supplied=request.headers.get('x-ppc-ascm-secret')||'';
      if(supplied.length>512||!await sameSecret(supplied,secret))throw problem(401,'ASCM_UNAUTHORIZED','The import credential was not accepted.');
      if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw problem(415,'ASCM_CONTENT_TYPE','Use a JSON report request.');
      const input=await validateAscmSharePointInput(await readBody(request));
      const rate=await database('rate',{bucket:await hash(encoder.encode(`${secret}\n${SESSION}`)),windowSeconds:60,maximum:30});
      if(!rate?.allowed)throw problem(429,'ASCM_RATE_LIMIT','Wait before retrying the report.');
      const identity={requestId:input.requestId},state=await database('ascm_sharepoint_read',identity);
      if(!record(state?.manifest)||!integer(state.storageRevision))throw unavailable();
      // Raw identity wins over semantic parsing for an already observed version,
      // including altered bytes that no longer form a valid workbook.
      if(state.sourceReceipt&&state.sourceReceipt.rawSha256!==input.rawSha256)throw problem(409,'ASCM_REPLAY_MISMATCH','The source version was already observed with different workbook bytes.');
      let dataset;
      try{dataset=await globalThis.ASCMImporter.parseAscmWorkbook(input.bytes,{strictDates:true,limits:{maxFileBytes:MAX_FILE,maxEntries:256,maxEntryUncompressedBytes:8*1024*1024,maxTotalUncompressedBytes:16*1024*1024,maxXmlChars:8*1024*1024,maxSheets:16,maxRows:10000,maxColumns:512,maxHeaderRows:200,maxSharedStrings:50000}});}
      catch{throw problem(400,'ASCM_INVALID_WORKBOOK','The report could not be imported completely. Use owner review.');}
      dataset.metadata.fileName=input.source.fileName;
      validateAscmDataset(dataset);
      // Keep the native parser's date-only, local-time or normalized zoned form.
      // Calendar-day matching adds no timezone to an unzoned source value.
      if(typeof dataset.metadata.exportedAt!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3}Z)?)?$/.test(dataset.metadata.exportedAt)||dataset.metadata.exportedAt.slice(0,10)!==input.reportDate)throw invalid();
      const businessSha256=await ascmBusinessFingerprint(dataset,input.reportDate);
      const fingerprint=await hashJson(['ppc-ascm-sharepoint-source-v1',input.requestId,input.source.fileName,input.reportDate,input.rawSha256,1,businessSha256]);
      let alreadySaved=false;
      if(state.sourceReceipt){
        if(state.sourceReceipt.rawSha256!==input.rawSha256||state.sourceReceipt.fingerprint!==fingerprint)throw problem(409,'ASCM_REPLAY_MISMATCH','The source version was already observed with different workbook bytes or identity.');
        alreadySaved=true;
      }else{
        if(env.PPC_ASCM_STATUS_ENABLED==='true'){
          leaseId=globalThis.crypto.randomUUID();
          leaseStarted=(await reportStatus({phase:'begin',leaseId}))?.status==='started';
        }
        let datePolicy;try{datePolicy=configuredDatePolicy(env.PPC_ASCM_DATE_POLICY);}catch{throw problem(503,'ASCM_POLICY_REQUIRED','The cloud date protection policy needs owner review.');}
        // Run every planner review gate before semantic equivalence. The SQL
        // wrapper discards this plan entirely for equivalent provenance.
        const plan=planAscmImport({manifest:state.manifest,dataset,reportDate:input.reportDate,importedAt:now(),requestId:input.requestId,datePolicy});
        validateManifest(plan.manifest);validateReadableManifest(plan.manifest);
        const equivalentCandidate=state.baseline?.reportDate===input.reportDate&&state.baseline?.businessFingerprintVersion===1
          &&state.baseline?.businessSha256===businessSha256&&state.baseline?.source?.listItemId===input.source.listItemId
          &&state.baseline?.source?.itemUniqueId===input.source.itemUniqueId;
        if(leaseStarted)await reportStatus({phase:'plan',leaseId,productCount:equivalentCandidate?0:plan.savedProducts});
        const result=await database('ascm_sharepoint_commit',{...identity,fingerprint,source:input.source,before:input.before,after:input.after,
          rawSha256:input.rawSha256,businessFingerprintVersion:1,businessSha256,reportDate:input.reportDate,
          expectedRevision:state.storageRevision,expectedSourceObservationId:state.baseline?.observationId??0,
          manifest:plan.manifest,changed:plan.changed,savedFields:plan.savedFields,savedProducts:plan.savedProducts});
        const holds={raced:['ASCM_RETRY_REQUIRED','The master or source baseline changed. Retry the frozen source later.'],request_mismatch:['ASCM_REPLAY_MISMATCH','The source version needs owner review.'],stale_source:['ASCM_SOURCE_STALE','A newer source report or version was already observed.'],ambiguous_source:['ASCM_SOURCE_AMBIGUOUS','Different source items claim the same current report date.'],fingerprint_version_mismatch:['ASCM_FINGERPRINT_VERSION','The source fingerprint version needs owner review.']};
        if(holds[result?.status])throw problem(409,...holds[result.status]);
        if(result?.status==='manifest_too_large')throw problem(413,'ASCM_MASTER_TOO_LARGE','The resulting master needs owner review.');
        if(!['saved','already_saved'].includes(result?.status))throw unavailable();
        alreadySaved=result.status==='already_saved';
      }
      // Fresh independent read binds the exact observation to its original
      // native receipt and current normal publication, including exact replay.
      const accepted=await database('ascm_sharepoint_read',identity),result=acceptedResponse(accepted,input,fingerprint,alreadySaved);
      return respond(result.status==='published'?200:202,result);
    }catch(error){
      const safe=error instanceof SourceError?error:error instanceof AscmReviewError?problem(409,'ASCM_REVIEW_REQUIRED','The report needs owner review. No report changes were saved.'):unavailable();
      if(safe.status===429)headers['Retry-After']='60';
      return respond(safe.status,{code:safe.code,error:safe.message,archiveAllowed:false,
        ...(error instanceof AscmReviewError&&ASCM_REVIEW_REASONS.includes(error.code)?{reviewReason:error.code}:{})});
    }finally{
      if(leaseStarted)await reportStatus({phase:'end',leaseId});
    }
  };
}
