// Local private preparation only. Never uploads, publishes or resets a key.
import fs from 'node:fs/promises';import path from 'node:path';import {createHash}from'node:crypto';
import '../public/js/package-codec.js';
import {imageBinding,scopedImageDigest,validateOwnerInput,digest}from'./owner-image-layer.mjs';
const codec=globalThis.PortfolioPackage,args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--owner-package','--plan','--base-package','--key-file','--output','--recovery-audit','--final-audit'].includes(args[i])||!args[i+1])throw Error('Supply the documented named file arguments.');options[args[i].slice(2)]=path.resolve(args[i+1]);}
const must=(v,m)=>{if(!v)throw Error(m);};
try{
 must(Object.keys(options).length===7,'Seven named file arguments are required.');
 must(!Object.entries(options).some(([k,p])=>k!=='output'&&p===options.output),'Output must differ from every input.');
 const [ownerBytes,baseBytes,keyBytes,planBytes,recoveryBytes,auditBytes]=await Promise.all(['owner-package','base-package','key-file','plan','recovery-audit','final-audit'].map(k=>fs.readFile(options[k])));
 const recovery=JSON.parse(recoveryBytes),audit=JSON.parse(auditBytes),plan=JSON.parse(planBytes);
 must(recovery.status==='passed'&&recovery.inputs.package.sha256===digest(ownerBytes)&&recovery.counts.reviewedImageAssignments===205,'A passed independent recovery audit for this exact private package is required.');
 must(audit.status==='passed'&&audit.mode==='final-current-app-checkpoint'&&audit.counts.imageAssignmentsWithReceipts===205&&audit.counts.dateFieldsPassed===582&&recovery.inputs.finalAudit.sha256===digest(auditBytes),'A matching final205 image/582 date audit is required.');
 must(audit.inputs.some(i=>i.sha256===digest(planBytes)&&path.basename(i.path)==='image-assignment-plan.json')&&plan.proposals.length===205,'The accepted205 image plan must be bound to the final audit.');
 must(codec.isEncrypted(baseBytes)&&!codec.isEncrypted(ownerBytes),'Use an existing encrypted base package and the private recovery package.');
 let key;try{key=codec.normalizeKey(keyBytes.toString('utf8').trim());}finally{keyBytes.fill(0);}
 const entries=codec.readZip(ownerBytes),manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(entries.get('portfolio.json'))),basePlain=await codec.decrypt(baseBytes,key),baseEntries=codec.readZip(basePlain),baseManifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(baseEntries.get('portfolio.json')));
 const rows=new Map(manifest.categories.flatMap(c=>c.board.products.map(p=>[p.id,{c,p}]))),assets=new Map(manifest.imageAssets.map(a=>[a.id,a]));
 const assignments=plan.proposals.map(p=>{const row=rows.get(p.productId);must(row?.c.id===p.categoryId&&row.p.name===p.productName,'The private package no longer matches the accepted source owner.');const slot=p.slot.type==='main'?row.p:row.p.variantGroups.filter(g=>g.type==='color').flatMap(g=>g.items).find(i=>i.id===p.slot.variantId),asset=assets.get(slot?.imageAssetId),bytes=asset&&entries.get(asset.packagePath);must(bytes?.length===p.newImageBytes&&digest(bytes)===p.newImageSha256&&(row.p.featuredVariantId||'')===p.expectedFeaturedVariantId,'Accepted owner slot bytes/default changed.');const a={categoryId:p.categoryId,productId:p.productId,variantId:p.slot.type==='main'?null:p.slot.variantId,imageAssetId:slot.imageAssetId,sha256:p.newImageSha256,bytes:p.newImageBytes,sourceSku:p.sku,familyDefault:Boolean(p.familyAssociation),featuredVariantId:p.expectedFeaturedVariantId};a.binding=imageBinding(manifest,a);must(a.binding,'Current saved SKU/color ownership no longer matches.');return a;});
 const sourceSha=baseManifest.masterSync?.supabasePublication?.sourceSha||createHash('sha1').update(`blob ${baseBytes.length}\0`).update(baseBytes).digest('hex');
 const descriptor={version:1,scope:'PCB-hero-images-20261014-205',sourceSha,baseImageDigest:scopedImageDigest(baseManifest,baseEntries,assignments),assignments};validateOwnerInput(descriptor,manifest,entries);
 must(!entries.has('owner-image-input.json'),'Owner input descriptor already exists.');entries.set('owner-image-input.json',new TextEncoder().encode(JSON.stringify(descriptor)));
 const plain=codec.createZip([...entries].map(([name,data])=>({name,data}))),encrypted=await codec.encrypt(plain,key);key='';
 await fs.writeFile(options.output,encrypted,{flag:'wx'});
 const report={status:'ENCRYPTED_OWNER_IMAGE_CANDIDATE_NOT_PUBLISHED',createdAt:new Date().toISOString(),ownerPackageSha256:digest(ownerBytes),basePackageGitBlobSha:createHash('sha1').update(`blob ${baseBytes.length}\0`).update(baseBytes).digest('hex'),baseImageDigest:descriptor.baseImageDigest,descriptorSha256:digest(JSON.stringify(descriptor)),assignments:205,products:new Set(assignments.map(a=>a.productId)).size,output:options.output,bytes:encrypted.length,sha256:digest(encrypted),gitBlobSha:createHash('sha1').update(`blob ${encrypted.length}\0`).update(encrypted).digest('hex'),canonicalCandidateFactsWillBeIgnored:true,privateKeyReadIntoLocalProcessOnly:true,keyOutput:false,networkActions:0};
 await fs.writeFile(options.output+'.audit.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 plain.fill(0);basePlain.fill(0);for(const b of [...entries.values(),...baseEntries.values()])b.fill(0);ownerBytes.fill(0);baseBytes.fill(0);encrypted.fill(0);
 console.log(JSON.stringify({status:report.status,assignments:205,products:report.products,output:options.output,bytes:report.bytes,sha256:report.sha256},null,2));
}catch{console.error('Owner image candidate could not be built. Inputs were not published and no key value was logged.');process.exitCode=1;}
