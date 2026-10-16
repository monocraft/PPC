/* Pure owner-image projection. No credentials, network, filesystem or database. */
import {createHash} from 'node:crypto';
import '../public/js/master-model.js';
const model=globalThis.PortfolioMasterModel,clone=v=>JSON.parse(JSON.stringify(v));
export const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
export const digest=v=>createHash('sha256').update(v).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b),own=(o,k)=>Object.hasOwn(o||{},k),HASH=/^[a-f0-9]{64}$/;
const stop=code=>{throw Object.assign(new Error('Owner image publication needs review.'),{code});};
const assert=(v,c='OWNER_IMAGES_INVALID')=>{if(!v)stop(c);};
const id=v=>typeof v==='string'&&v.length>0&&v.length<=180&&!['__proto__','prototype','constructor'].includes(v);
const records=m=>new Map((m.categories||[]).flatMap(c=>(c.board?.products||[]).map(p=>[p.id,{c,p}])));
const key=a=>JSON.stringify([a.categoryId,a.productId,a.variantId]);
const variant=(p,a)=>(p.variantGroups||[]).filter(g=>g.type==='color').flatMap(g=>g.items||[]).find(v=>v.id===a.variantId);
const slot=(p,a)=>a.variantId===null?p:variant(p,a);
const assetMap=m=>new Map((m.imageAssets||[]).map(a=>[a.id,a]));
const imageBytes=(asset,entries)=>{assert(asset?.sourceType==='local'&&typeof asset.packagePath==='string'&&asset.packagePath.startsWith('images/')&&!asset.packagePath.includes('..')&&!asset.packagePath.includes('\\'));const b=entries.get(asset.packagePath);assert(b instanceof Uint8Array&&b.length>0&&b.length===asset.size);return b;};
export function imageBinding(manifest,a){
 const r=records(manifest).get(a.productId);if(!r||r.c.id!==a.categoryId)return null;
 const p=model.productValues(r.p),s=a.variantId===null?null:variant(p,a);if(a.variantId!==null&&!s)return null;
 const parts=p.partSkus.filter(p=>p.code.trim()===a.sourceSku).sort((x,y)=>x.id.localeCompare(y.id));
 if(!parts.length&&!(a.familyDefault===true&&a.variantId===null&&p.partSkus.length===0))return null;
 return {categoryId:a.categoryId,productId:a.productId,variantId:a.variantId,sourceSku:a.sourceSku,familyDefault:a.familyDefault===true,parts,variant:s};
}
export function scopedImageDigest(manifest,entries,assignments){
 const rows=records(manifest),assets=assetMap(manifest);
 return digest(canonical(assignments.map(a=>{const p=rows.get(a.productId)?.p,s=p&&slot(p,a),asset=assets.get(s?.imageAssetId);return{key:key(a),imageAssetId:s?.imageAssetId||'',featuredVariantId:p?.featuredVariantId||'',sha256:asset?.sourceType==='local'?digest(imageBytes(asset,entries)):asset?.sourceType==='url'?digest(asset.url||''):''};}).sort((a,b)=>a.key.localeCompare(b.key))));
}
function validateAssignments(assignments){
 assert(Array.isArray(assignments)&&assignments.length>0&&assignments.length<=10000);
 const seen=new Set(),defaults=new Map();for(const a of assignments){
  assert(a&&id(a.categoryId)&&id(a.productId)&&(a.variantId===null||id(a.variantId))&&id(a.imageAssetId)&&HASH.test(a.sha256)&&Number.isSafeInteger(a.bytes)&&a.bytes>0&&typeof a.sourceSku==='string'&&a.sourceSku.length<=180&&typeof a.familyDefault==='boolean'&&a.binding&&typeof a.binding==='object'&&typeof a.featuredVariantId==='string');
  assert(Object.keys(a).every(k=>['categoryId','productId','variantId','imageAssetId','sha256','bytes','sourceSku','familyDefault','featuredVariantId','binding'].includes(k))&&Object.keys(a.binding).every(k=>['categoryId','productId','variantId','sourceSku','familyDefault','parts','variant'].includes(k)));
  assert(!defaults.has(a.productId)||defaults.get(a.productId)===a.featuredVariantId);defaults.set(a.productId,a.featuredVariantId);
  assert(!seen.has(key(a)));seen.add(key(a));
 }
}
const safeImagePath=v=>typeof v==='string'&&/^images\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v)&&!v.split('/').some(s=>!s||s==='.'||s==='..');
const retirementKeys=['imageAssetId','packagePath','bytes','sha256','metadataSha256'];
function validateRetirements(items){
 assert(Array.isArray(items)&&items.length>0&&items.length<=10000,'OWNER_IMAGE_RETIREMENT_INVALID');
 const ids=new Set(),paths=new Map();for(const a of items){
  assert(a&&Object.keys(a).length===retirementKeys.length&&Object.keys(a).every(k=>retirementKeys.includes(k))&&id(a.imageAssetId)&&safeImagePath(a.packagePath)&&Number.isSafeInteger(a.bytes)&&a.bytes>0&&HASH.test(a.sha256)&&HASH.test(a.metadataSha256),'OWNER_IMAGE_RETIREMENT_INVALID');
  assert(!ids.has(a.imageAssetId),'OWNER_IMAGE_RETIREMENT_INVALID');ids.add(a.imageAssetId);
  const prior=paths.get(a.packagePath);assert(!prior||(prior.bytes===a.bytes&&prior.sha256===a.sha256),'OWNER_IMAGE_RETIREMENT_INVALID');paths.set(a.packagePath,a);
 }
}
const retirementIdentity=a=>({assetIdDigest:digest(a.imageAssetId),packagePathDigest:digest(a.packagePath),bytes:a.bytes,sha256:a.sha256,metadataSha256:a.metadataSha256});
function validateRetirementState(state){
 const items=state.retiredImages||[],receipts=state.retirementReceipts||[];
 assert(Array.isArray(items)&&items.length<=10000&&Array.isArray(receipts)&&receipts.length<=10000,'OWNER_IMAGE_RETIREMENT_STATE_INVALID');
 const ids=new Set();for(const a of items){assert(a&&Object.keys(a).length===5&&Object.keys(a).every(k=>['assetIdDigest','packagePathDigest','bytes','sha256','metadataSha256'].includes(k))&&HASH.test(a.assetIdDigest)&&HASH.test(a.packagePathDigest)&&HASH.test(a.sha256)&&HASH.test(a.metadataSha256)&&Number.isSafeInteger(a.bytes)&&a.bytes>0&&!ids.has(a.assetIdDigest),'OWNER_IMAGE_RETIREMENT_STATE_INVALID');ids.add(a.assetIdDigest);}
 const seen=new Set();for(const r of receipts){assert(r&&Object.keys(r).length===8&&Object.keys(r).every(k=>['version','retirementDigest','descriptorDigest','inputCommit','inputBlobSha','retiredAssetCount','removedPathCount','removedBytes'].includes(k))&&r.version===1&&HASH.test(r.retirementDigest)&&HASH.test(r.descriptorDigest)&&/^[a-f0-9]{40}$/.test(r.inputCommit)&&/^[a-f0-9]{40}$/.test(r.inputBlobSha)&&[r.retiredAssetCount,r.removedPathCount,r.removedBytes].every(n=>Number.isSafeInteger(n)&&n>=0)&&!seen.has(r.retirementDigest),'OWNER_IMAGE_RETIREMENT_STATE_INVALID');seen.add(r.retirementDigest);}
 assert((items.length===0)===(receipts.length===0),'OWNER_IMAGE_RETIREMENT_STATE_INVALID');
}
// Check every exact identifier/path string and object key, including unknown
// metadata and archived products. Only the top-level registry is excluded.
function referenceStrings(manifest){
 const strings=new Set();let nodes=0;
 const visit=(v,depth)=>{assert(depth<=100&&++nodes<=2000000,'OWNER_IMAGE_REFERENCE_SCAN_LIMIT');if(typeof v==='string')strings.add(v);else if(Array.isArray(v))v.forEach(x=>visit(x,depth+1));else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){strings.add(k);visit(x,depth+1);}};
 for(const [k,v]of Object.entries(manifest))if(k!=='imageAssets'){strings.add(k);visit(v,0);}return strings;
}
function applyRetirements(manifest,registry,entries,sourceManifest,sourceEntries,state,requested,context){
 validateRetirementState(state);
 const prior=new Map((state.retiredImages||[]).map(a=>[a.assetIdDigest,a])),sourceAssets=assetMap(sourceManifest),pending=[];
 // A trusted cleaned package may never contain a retired registry ID again.
 for(const a of sourceAssets.values())assert(!prior.has(digest(a.id)),'OWNER_IMAGE_RETIRED_ID_REAPPEARED');
 if(requested){validateRetirements(requested);for(const a of requested){
  const proof=retirementIdentity(a),old=prior.get(proof.assetIdDigest),asset=sourceAssets.get(a.imageAssetId);
  if(old){assert(same(old,proof)&&!asset,'OWNER_IMAGE_RETIREMENT_PROOF_CHANGED');continue;}
  assert(asset&&asset.packagePath===a.packagePath&&asset.size===a.bytes&&digest(canonical(asset))===a.metadataSha256,'OWNER_IMAGE_RETIREMENT_PROOF_CHANGED');
  assert(digest(imageBytes(asset,sourceEntries))===a.sha256,'OWNER_IMAGE_RETIREMENT_PROOF_CHANGED');
  prior.set(proof.assetIdDigest,proof);pending.push(a);
 }}
 const refs=referenceStrings(manifest),refDigests=new Set([...refs].map(digest)),removed=new Map();let retiredAssetCount=0,removedBytes=0;
 for(const proof of prior.values())assert(!refDigests.has(proof.assetIdDigest)&&!refDigests.has(proof.packagePathDigest),'OWNER_IMAGE_RETIREMENT_REFERENCED');
 for(const a of [...registry.values()]){const proof=prior.get(digest(a.id));if(!proof)continue;
  assert(digest(canonical(a))===proof.metadataSha256&&digest(a.packagePath||'')===proof.packagePathDigest&&a.size===proof.bytes,'OWNER_IMAGE_RETIREMENT_PROOF_CHANGED');
  assert(!refs.has(a.id)&&!refs.has(a.packagePath),'OWNER_IMAGE_RETIREMENT_REFERENCED');
  // Registry rows can carry unknown metadata too; retain any cross-reference.
  for(const other of registry.values())if(other.id!==a.id&&!prior.has(digest(other.id))){const values=new Set();const scan=v=>{if(typeof v==='string')values.add(v);else if(Array.isArray(v))v.forEach(scan);else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){values.add(k);scan(x);}};for(const [k,v]of Object.entries(other))if(k!=='id'&&k!=='packagePath'){values.add(k);scan(v);}assert(!values.has(a.id)&&!values.has(a.packagePath),'OWNER_IMAGE_RETIREMENT_REFERENCED');}
  registry.delete(a.id);retiredAssetCount++;
 }
 // Only newly and explicitly listed paths are eligible for deletion. Old shared
 // paths and all unknown ZIP entries remain until separately authorized.
 for(const a of pending){if(removed.has(a.packagePath)||[...registry.values()].some(x=>x.packagePath===a.packagePath))continue;
  assert(!refs.has(a.packagePath),'OWNER_IMAGE_RETIREMENT_REFERENCED');const b=entries.get(a.packagePath);
  assert(b instanceof Uint8Array&&b.length===a.bytes&&digest(b)===a.sha256,'OWNER_IMAGE_RETIREMENT_PROOF_CHANGED');
  entries.delete(a.packagePath);removed.set(a.packagePath,a);removedBytes+=b.length;
 }
 if(pending.length){
  const receipt={version:1,retirementDigest:digest(canonical(requested)),descriptorDigest:state.descriptorDigest,inputCommit:context.commit,inputBlobSha:context.blobSha,retiredAssetCount:pending.length,removedPathCount:removed.size,removedBytes};
  state.retiredImages=[...prior.values()].sort((a,b)=>a.assetIdDigest.localeCompare(b.assetIdDigest));state.retirementReceipts=[...(state.retirementReceipts||[]),receipt];validateRetirementState(state);
 }
 return{listed:requested?.length||0,retiredAssetCount,removedPathCount:removed.size,removedBytes,alreadyApplied:Boolean(requested&&!pending.length)};
}
export function validateOwnerInput(descriptor,manifest,entries){
 assert(descriptor?.version===1&&typeof descriptor.scope==='string'&&descriptor.scope.length>0&&descriptor.scope.length<=180&&/^[a-f0-9]{40}$/.test(descriptor.sourceSha)&&HASH.test(descriptor.baseImageDigest)&&Object.keys(descriptor).every(k=>['version','scope','sourceSha','baseImageDigest','assignments','retireUnassignedImages'].includes(k)));
 if(own(descriptor,'retireUnassignedImages'))validateRetirements(descriptor.retireUnassignedImages);
 validateAssignments(descriptor.assignments);const rows=records(manifest),assets=assetMap(manifest);
 for(const a of descriptor.assignments){const p=rows.get(a.productId)?.p,s=p&&slot(p,a),asset=assets.get(a.imageAssetId);assert(s?.imageAssetId===a.imageAssetId&&(p.featuredVariantId||'')===a.featuredVariantId&&same(imageBinding(manifest,a),a.binding),'OWNER_IMAGE_BINDING_CHANGED');const b=imageBytes(asset,entries);assert(b.length===a.bytes&&digest(b)===a.sha256&&['image/png','image/jpeg'].includes(asset.mimeType));}
 return descriptor;
}
export function ownerState(manifest,entries){
 const state=manifest.masterSync?.ownerImages;if(!state)return null;
 assert(state.version===1&&/^[a-f0-9]{40}$/.test(state.sourceSha)&&/^[a-f0-9]{40}$/.test(state.inputCommit)&&/^[a-f0-9]{40}$/.test(state.inputBlobSha)&&HASH.test(state.descriptorDigest));validateAssignments(state.assignments);
 validateRetirementState(state);
 const assets=assetMap(manifest);for(const a of state.assignments)assert(digest(imageBytes(assets.get(a.imageAssetId),entries))===a.sha256);
 return clone(state);
}
/* Source entries are retained by default. Optional explicit, source-bound
 * retirement may remove unassigned image records and their unshared bytes.
 * Incoming canonical facts never participate in the result. */
export function projectOwnerImages(target,sourceManifest,sourceEntries,{input,commit,blobSha,sourceSha}={}){
 const entries=new Map(sourceEntries),manifest=clone(target),current=ownerState(sourceManifest,sourceEntries),rows=records(manifest),registry=assetMap(manifest);
 if(!current&&!input)return{manifest,entries,changedInput:false,state:null,projected:0,retired:0};
 assert(/^[a-f0-9]{40}$/.test(sourceSha)&&(!current||current.sourceSha===sourceSha),'OWNER_IMAGES_FOREIGN_MASTER');
 // Preserve old registry entries needed by retained archives and merge history.
 for(const a of sourceManifest.imageAssets||[])if(!registry.has(a.id))registry.set(a.id,clone(a));
 let state=current,changedInput=false,requestedRetirements;
 if(input){
  const descriptor=validateOwnerInput(input.descriptor,input.manifest,input.entries),descriptorDigest=digest(canonical(descriptor));
  assert(descriptor.sourceSha===sourceSha,'OWNER_IMAGES_FOREIGN_MASTER');
  requestedRetirements=descriptor.retireUnassignedImages;
  if(current?.descriptorDigest!==descriptorDigest){
   assert(scopedImageDigest(sourceManifest,sourceEntries,descriptor.assignments)===descriptor.baseImageDigest,'OWNER_IMAGE_BASE_CHANGED');
   const sourceAssets=assetMap(input.manifest),paths=new Map();
   for(const [name,b]of entries)if(name.startsWith('images/'))paths.set(digest(b),name);
   for(const a of descriptor.assignments){
    assert(same(imageBinding(manifest,a),a.binding),'OWNER_IMAGE_BINDING_CHANGED');
    const candidate=sourceAssets.get(a.imageAssetId),b=imageBytes(candidate,input.entries),existing=registry.get(a.imageAssetId);
    assert(typeof candidate.name==='string'&&candidate.name.length>0&&candidate.name.length<=512&&typeof candidate.updatedAt==='string'&&Number.isFinite(Date.parse(candidate.updatedAt))&&candidate.url==='');
    if(existing){assert(digest(imageBytes(existing,entries))===a.sha256,'OWNER_IMAGE_ID_COLLISION');continue;}
    let imagePath=paths.get(a.sha256);if(!imagePath){imagePath=`images/owner-${a.sha256}.${candidate.mimeType==='image/png'?'png':'jpg'}`;assert(!entries.has(imagePath)||digest(entries.get(imagePath))===a.sha256,'OWNER_IMAGE_PATH_COLLISION');entries.set(imagePath,b.slice());paths.set(a.sha256,imagePath);}
    registry.set(a.imageAssetId,{id:candidate.id,sourceType:'local',name:candidate.name,mimeType:candidate.mimeType,size:b.length,url:'',updatedAt:candidate.updatedAt,packagePath:imagePath});
   }
   const merged=new Map((current?.assignments||[]).map(a=>[key(a),a]));for(const a of descriptor.assignments)merged.set(key(a),clone(a));
   const defaults=new Map(descriptor.assignments.map(a=>[a.productId,a.featuredVariantId]));for(const a of merged.values())if(defaults.has(a.productId))a.featuredVariantId=defaults.get(a.productId);
   state={version:1,sourceSha,inputCommit:commit,inputBlobSha:blobSha,descriptorDigest,assignments:[...merged.values()].sort((a,b)=>key(a).localeCompare(key(b))),...(current?.retiredImages?{retiredImages:clone(current.retiredImages),retirementReceipts:clone(current.retirementReceipts)}:{})};changedInput=true;
  }
 }
 let projected=0,retired=0;
 if(state){
  const defaults=new Map();
  for(const a of state.assignments){const p=rows.get(a.productId)?.p;if(!p||!same(imageBinding(manifest,a),a.binding)){retired++;continue;}const s=slot(p,a);s.imageAssetId=a.imageAssetId;defaults.set(a.productId,a.featuredVariantId);projected++;}
  const validPin=(p,pin)=>{const v=variant(p,{variantId:pin});return Boolean(v?.imageAssetId&&registry.has(v.imageAssetId));};
  for(const [productId,pin]of defaults){const p=rows.get(productId).p;if(!pin||validPin(p,pin))p.featuredVariantId=pin;else if(!validPin(p,p.featuredVariantId))p.featuredVariantId='';}
  manifest.masterSync={...(manifest.masterSync||{}),ownerImages:state};
 }
 const imageRetirement=state?applyRetirements(manifest,registry,entries,sourceManifest,sourceEntries,state,requestedRetirements,{commit,blobSha}):null;
 manifest.imageAssets=[...registry.values()];
 assert(same(model.snapshot(manifest).products.map(p=>[p.productId,p.categoryId,p.values,p.revisions]),model.snapshot(target).products.map(p=>[p.productId,p.categoryId,p.values,p.revisions])),'OWNER_IMAGES_CHANGED_CANONICAL_FACTS');
 return{manifest,entries,changedInput,state,projected,retired,imageRetirement};
}
