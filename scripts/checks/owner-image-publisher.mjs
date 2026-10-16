import assert from 'node:assert/strict';
import {harness,unpacked,packageKey,original}from'./supabase-publisher.mjs';
import {canonical,digest,imageBinding,scopedImageDigest,projectOwnerImages}from'../owner-image-layer.mjs';
import {checkOwnerImageRetirement}from'./owner-image-retirement.mjs';
const codec=globalThis.PortfolioPackage,clone=structuredClone,commit='c'.repeat(40),newBytes=Uint8Array.of(137,80,78,71,19,23);
const product=m=>m.categories[0].board.products[0];
function makeInput(base,seed,{bytes=newBytes,id='owner-hero',variantId=null,featured='',assignments,foreign=false}={}){
 const manifest=clone(base.manifest),entries=new Map([...base.entries].map(([n,b])=>[n,b.slice()])),p=product(manifest),path='images/'+id+'.png';
 p.ffsDate='2020-01-01';p.specs[0].value='STALE CANDIDATE VALUE';
 if(variantId)p.variantGroups[0].items.find(v=>v.id===variantId).imageAssetId=id;else p.imageAssetId=id;p.featuredVariantId=featured;
 manifest.imageAssets.push({id,sourceType:'local',name:id+'.png',mimeType:'image/png',size:bytes.length,url:'',updatedAt:'2026-10-15T00:00:00.000Z',packagePath:path});entries.set(path,bytes.slice());
 const a={categoryId:'pc',productId:'headset',variantId,imageAssetId:id,sha256:digest(bytes),bytes:bytes.length,sourceSku:'HP001',familyDefault:false,featuredVariantId:featured};a.binding=imageBinding(manifest,a);
 const selected=assignments||[a],descriptor={version:1,scope:'offline-owner-fixture',sourceSha:foreign?'f'.repeat(40):seed,baseImageDigest:scopedImageDigest(base.manifest,base.entries,selected),assignments:selected};
 return{manifest,entries,descriptor};
}
async function encrypted(input){const entries=new Map(input.entries);entries.set('portfolio.json',new TextEncoder().encode(JSON.stringify(input.manifest)));entries.set('owner-image-input.json',new TextEncoder().encode(JSON.stringify(input.descriptor)));return codec.encrypt(codec.createZip([...entries].map(([name,data])=>({name,data}))),packageKey);}
async function ready(){const h=await harness();await h.publisher.publish();return h;}
{
 const h=await ready(),base=await unpacked(h.bytes),input=makeInput(base,h.sourceSha),owner=h.candidate(commit,await encrypted(input));
 h.advance({ffsDate:'2026-12-12',name:'LATEST TEAM NAME'});
 const result=await owner.publish(),out=await unpacked(h.bytes);
 assert.equal(result.revision,2);assert.equal(product(out.manifest).imageAssetId,'owner-hero');assert.equal(product(out.manifest).ffsDate,'2026-12-12');assert.equal(product(out.manifest).name,'LATEST TEAM NAME');assert.equal(product(out.manifest).specs[0].value,'30 h');
 for(const [name,b]of base.entries)if(name!=='portfolio.json')assert.deepEqual(out.entries.get(name),b,'every original archive entry survives');
 assert.equal(out.manifest.masterSync.ownerImages.sourceSha,h.sourceSha);
 const count=h.calls.filter(c=>c.operation==='put').length;await owner.publish();assert.equal(h.calls.filter(c=>c.operation==='put').length,count,'same immutable owner input is idempotent');
 h.advance({ffsDate:'2026-12-13'});await h.publisher.publish();const next=await unpacked(h.bytes);assert.equal(product(next.manifest).imageAssetId,'owner-hero');assert.equal(product(next.manifest).ffsDate,'2026-12-13','ordinary later publication retains owner images and newest canonical facts');
}
{
 const h=await ready(),revision=h.publication.publishedRevision,prior=h.current,input=makeInput(await unpacked(h.bytes),h.sourceSha);await h.candidate(commit,await encrypted(input)).publish();assert.equal(h.publication.publishedRevision,revision,'explicit image-only update can retain storage revision');assert.notEqual(h.current,prior);assert.equal(h.publication.githubSha,h.current,'same-revision acknowledgement points at new image package');
}
{
 const h=await ready(),base=await unpacked(h.bytes),a=makeInput(base,h.sourceSha),stale=makeInput(base,h.sourceSha,{bytes:Uint8Array.of(1,2,3,4),id:'different'});await h.candidate(commit,await encrypted(a)).publish();await assert.rejects(h.candidate('d'.repeat(40),await encrypted(stale)).publish(),e=>e.code==='OWNER_IMAGE_BASE_CHANGED','stale candidates cannot roll back a newer image layer');
}
{
 const h=await ready(),input=makeInput(await unpacked(h.bytes),h.sourceSha,{foreign:true});await assert.rejects(h.candidate(commit,await encrypted(input)).publish(),e=>e.code==='OWNER_IMAGES_FOREIGN_MASTER');
}
{
 const h=await ready(),input=makeInput(await unpacked(h.bytes),h.sourceSha);input.descriptor.assignments[0].privateUnrelated='must never be retained';await assert.rejects(h.candidate(commit,await encrypted(input)).publish(),e=>e.code==='OWNER_IMAGES_INVALID');
}
{
 const h=await ready(),input=makeInput(await unpacked(h.bytes),h.sourceSha);h.advance({partSkus:[{id:'hp',code:'DIFFERENT'}]});await assert.rejects(h.candidate(commit,await encrypted(input)).publish(),e=>e.code==='OWNER_IMAGE_BINDING_CHANGED');
}
for(const failure of ['loseWriteReply','failDeploy','failAck']){
 const h=await ready(),input=makeInput(await unpacked(h.bytes),h.sourceSha),publisher=h.candidate(commit,await encrypted(input));h[failure]();
 if(failure==='loseWriteReply')await publisher.publish();else{await assert.rejects(publisher.publish());await publisher.publish();}
 assert.equal(product((await unpacked(h.bytes)).manifest).imageAssetId,'owner-hero');assert.equal(h.publication.status,'current');assert.equal(h.calls.filter(c=>c.operation==='put').length,2,'initial canonical publication and exactly one owner upload despite a lost response');
}
{
 const h=await ready(),input=makeInput(await unpacked(h.bytes),h.sourceSha),owner=h.candidate(commit,await encrypted(input));h.beforePut(()=>h.advance({ffsDate:'2026-12-14'}));await owner.publish();assert.equal(h.publication.status,'pending','a canonical save during publication stays pending');await h.publisher.publish();const out=await unpacked(h.bytes);assert.equal(product(out.manifest).ffsDate,'2026-12-14');assert.equal(product(out.manifest).imageAssetId,'owner-hero');
}
{
 const h=await ready(),base=await unpacked(h.bytes),a=h.candidate(commit,await encrypted(makeInput(base,h.sourceSha))),b=h.candidate('d'.repeat(40),await encrypted(makeInput(base,h.sourceSha,{id:'winner',bytes:Uint8Array.of(7,8,9)})));
 h.beforePut(()=>b.publish());await assert.rejects(a.publish(),e=>e.code==='OWNER_IMAGE_BASE_CHANGED','overlapping owner CAS loser cannot replace a newer winner');assert.equal(product((await unpacked(h.bytes)).manifest).imageAssetId,'winner');
}
{
 const h=await ready();h.advance({variantGroups:[{id:'colors',type:'color',label:'Color',items:[{id:'black',code:'BK',colorName:'Black',colorHex:'#000000'}]}]});await h.publisher.publish();
 const base=await unpacked(h.bytes),a=h.candidate(commit,await encrypted(makeInput(base,h.sourceSha))),b=h.candidate('d'.repeat(40),await encrypted(makeInput(base,h.sourceSha,{id:'variant-winner',variantId:'black',bytes:Uint8Array.of(7,8,9)})));
 h.beforePut(()=>b.publish());await a.publish();const out=await unpacked(h.bytes);assert.equal(product(out.manifest).imageAssetId,'owner-hero');assert.equal(product(out.manifest).variantGroups[0].items[0].imageAssetId,'variant-winner','disjoint owner CAS retry retains both image updates');
}
{
 const manifest=clone(original);product(manifest).variantGroups=[{id:'colors',type:'color',label:'Color',items:[{id:'black',code:'BK',colorName:'Black',colorHex:'#000000',imageAssetId:''}]}];
 const entries=new Map([['images/hero.webp',Uint8Array.of(0,255,34,0,9)]]),base={manifest,entries},seed='a'.repeat(40),first=makeInput(base,seed),one=projectOwnerImages(manifest,manifest,entries,{input:first,commit,blobSha:'b'.repeat(40),sourceSha:seed});
 const second=makeInput({manifest:one.manifest,entries:one.entries},seed,{id:'owner-black',variantId:'black',featured:'black'}),two=projectOwnerImages(manifest,one.manifest,one.entries,{input:second,commit:'d'.repeat(40),blobSha:'e'.repeat(40),sourceSha:seed});
 assert.equal(product(two.manifest).featuredVariantId,'black','partial variant update owns one coherent product default');assert.ok(two.state.assignments.every(a=>a.featuredVariantId==='black'));
 assert.equal([...two.entries.keys()].filter(n=>n.startsWith('images/owner-')).length,1,'identical incoming bytes reuse the existing archive path');
 const removedVariant=clone(manifest);product(removedVariant).variantGroups=[];const withoutVariant=projectOwnerImages(removedVariant,two.manifest,two.entries,{sourceSha:seed});assert.equal(product(withoutVariant.manifest).featuredVariantId,'','a removed colorway cannot remain the default');assert.equal(withoutVariant.retired,1);
 const removed=clone(manifest);removed.categories[0].board.products=[];const retired=projectOwnerImages(removed,two.manifest,two.entries,{sourceSha:seed});assert.equal(retired.manifest.categories[0].board.products.length,0,'future canonical deletion is never resurrected');assert.equal(retired.retired,2);
}
await checkOwnerImageRetirement({harness,unpacked,encrypted,makeInput});
console.log('Owner image publisher checks passed: immutable scoped input, source identity, same-revision updates, canonical fact preservation, complete archive retention by default, explicit unassigned-image retirement, byte deduplication, future overlay/deletion, partial defaults, stale rejection, races and lost-response recovery.');
