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
export function validateOwnerInput(descriptor,manifest,entries){
 assert(descriptor?.version===1&&typeof descriptor.scope==='string'&&descriptor.scope.length>0&&descriptor.scope.length<=180&&/^[a-f0-9]{40}$/.test(descriptor.sourceSha)&&HASH.test(descriptor.baseImageDigest)&&Object.keys(descriptor).every(k=>['version','scope','sourceSha','baseImageDigest','assignments'].includes(k)));
 validateAssignments(descriptor.assignments);const rows=records(manifest),assets=assetMap(manifest);
 for(const a of descriptor.assignments){const p=rows.get(a.productId)?.p,s=p&&slot(p,a),asset=assets.get(a.imageAssetId);assert(s?.imageAssetId===a.imageAssetId&&(p.featuredVariantId||'')===a.featuredVariantId&&same(imageBinding(manifest,a),a.binding),'OWNER_IMAGE_BINDING_CHANGED');const b=imageBytes(asset,entries);assert(b.length===a.bytes&&digest(b)===a.sha256&&['image/png','image/jpeg'].includes(asset.mimeType));}
 return descriptor;
}
export function ownerState(manifest,entries){
 const state=manifest.masterSync?.ownerImages;if(!state)return null;
 assert(state.version===1&&/^[a-f0-9]{40}$/.test(state.sourceSha)&&/^[a-f0-9]{40}$/.test(state.inputCommit)&&/^[a-f0-9]{40}$/.test(state.inputBlobSha)&&HASH.test(state.descriptorDigest));validateAssignments(state.assignments);
 const assets=assetMap(manifest);for(const a of state.assignments)assert(digest(imageBytes(assets.get(a.imageAssetId),entries))===a.sha256);
 return clone(state);
}
/* All source entries are retained. Only approved image bytes are added. The
 * incoming manifest's other fields never participate in the result. */
export function projectOwnerImages(target,sourceManifest,sourceEntries,{input,commit,blobSha,sourceSha}={}){
 const entries=new Map(sourceEntries),manifest=clone(target),current=ownerState(sourceManifest,sourceEntries),rows=records(manifest),registry=assetMap(manifest);
 if(!current&&!input)return{manifest,entries,changedInput:false,state:null,projected:0,retired:0};
 assert(/^[a-f0-9]{40}$/.test(sourceSha)&&(!current||current.sourceSha===sourceSha),'OWNER_IMAGES_FOREIGN_MASTER');
 // Preserve old registry entries needed by retained archives and merge history.
 for(const a of sourceManifest.imageAssets||[])if(!registry.has(a.id))registry.set(a.id,clone(a));
 let state=current,changedInput=false;
 if(input){
  const descriptor=validateOwnerInput(input.descriptor,input.manifest,input.entries),descriptorDigest=digest(canonical(descriptor));
  assert(descriptor.sourceSha===sourceSha,'OWNER_IMAGES_FOREIGN_MASTER');
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
   state={version:1,sourceSha,inputCommit:commit,inputBlobSha:blobSha,descriptorDigest,assignments:[...merged.values()].sort((a,b)=>key(a).localeCompare(key(b)))};changedInput=true;
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
 manifest.imageAssets=[...registry.values()];
 assert(same(model.snapshot(manifest).products.map(p=>[p.productId,p.categoryId,p.values,p.revisions]),model.snapshot(target).products.map(p=>[p.productId,p.categoryId,p.values,p.revisions])),'OWNER_IMAGES_CHANGED_CANONICAL_FACTS');
 return{manifest,entries,changedInput,state,projected,retired};
}
