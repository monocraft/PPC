import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../public/js/package-codec.js';
import '../../public/js/master-model.js';
const app=await readFile(new URL('../../public/js/app.js',import.meta.url),'utf8'),html=await readFile(new URL('../../public/index.html',import.meta.url),'utf8');
const names=['workspaceRecoveryCurrent','showWorkspaceRecovery','prepareWorkspaceRecovery','restoreWorkspaceRecovery','validatePackageManifest','validatePackageImageReferences'];
const functions=names.map(name=>{const match=app.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`,'m'));assert(match,name);return match[0];}).join('\n');
const clone=value=>JSON.parse(JSON.stringify(value));
const seed={version:4,activeCategoryId:'synthetic',categories:[{id:'synthetic',name:'Synthetic',board:{lanes:[{id:'lane',label:'Fixture'}],products:[{id:'synthetic-product',laneId:'lane',name:'Invented backup',order:0,specs:[],partSkus:[],variantGroups:[],roadmap:{startMonth:'2027-01',endMonth:'2029-01'}}],settings:{}}}],imageAssets:[]};
function harness({record=' { damaged saved data \n',legacy=null}={}){
 let raw=record, failWrite=false, failActivate=false, failRollback=false,nextId=0;
 const ui=new Map(),shell={inert:true,setAttribute(){}};
 const element=id=>{if(!ui.has(id))ui.set(id,{hidden:false,disabled:false,textContent:'',classList:{remove(){}},setAttribute(){}});return ui.get(id);};
 const images=new Map(),writes=[],credentials={key:'synthetic-old-key',connection:'synthetic-old-connection'};
 const context={Blob,TextDecoder,TextEncoder,JSON,Map,Set,Object,Array,String,RegExp,Error,
  workspaceOpening:true,workspaceRecovery:null,workspaceRecoveryPlan:null,workspaceRecoveryBusy:false,workspaceRecoveryExportText:null,
  portfolio:null,board:null,activeCategoryId:null,localDateBaseline:null,packageOperationInProgress:false,saveTimer:null,
  pendingLegacyImageBlobs:[],STORAGE_KEY:'fixture',PREVIOUS_STORAGE_KEY:'previous',LEGACY_STORAGE_KEY:'legacy',CATEGORY_DEFINITIONS:[{id:'synthetic'}],
  localStorage:{getItem:key=>key==='fixture'?legacy:null},document:{getElementById:element,querySelector:()=>shell},clearTimeout(){},
  packageCodec:()=>globalThis.PortfolioPackage,PortfolioMasterModel:globalThis.PortfolioMasterModel,
  parsePortfolioImportText:JSON.parse,normalizeImportedPortfolio:clone,imageStoreGet:async id=>images.get(id)||null,extensionForImageAsset:()=> 'png',id:()=>String(++nextId),
  PortfolioMasterUI:{getSession:()=>credentials},PortfolioNotifications:{resolve(){}},
  workspaceStorage:{async readRecovery(){return{record:raw===null?null:{id:'fixture',version:1,serialized:raw},rawText:raw};},async recover(serialized,{recovery,images:incoming,isCurrent}){
   if(failWrite)throw new Error('Synthetic quota');if(!isCurrent()||recovery.rawText!==raw)throw new Error('Another tab changed saved recovery data');const receipt={before:raw,after:serialized};raw=serialized;for(const item of incoming)images.set(item.id,item.blob);writes.push(serialized);return receipt;
  },async rollbackRecovery(receipt){if(failRollback)throw new Error('Synthetic rollback quota');if(raw!==receipt.after)throw new Error('Another tab replaced the saved backup');raw=receipt.before;}},
  async startWorkspace(){if(failActivate)throw new Error('Synthetic display activation failure');context.portfolio=JSON.parse(raw);context.workspaceOpening=false;shell.inert=false;return context.portfolio;}
 };
 vm.createContext(context);vm.runInContext(functions,context);
 return{context,images,ui,shell,writes,credentials,get raw(){return raw;},mutateDurable(value){raw=value;},failWrite(){failWrite=true;},failActivate(){failActivate=true;},failRollback(){failRollback=true;},async show(){await context.showWorkspaceRecovery();},async review(value=seed){const plan=await context.prepareWorkspaceRecovery({name:'synthetic.data',text:async()=>JSON.stringify(value)});context.workspaceRecoveryPlan=plan;return plan;},restore:plan=>context.restoreWorkspaceRecovery(plan)};
}
{
 const h=harness();await h.show();assert.equal(h.context.workspaceRecoveryExportText,' { damaged saved data \n');assert.equal(h.ui.get('workspaceRecoveryControls').hidden,false);assert.equal(h.shell.inert,true);const plan=await h.review();assert.equal(h.writes.length,0);assert.equal(h.context.portfolio,null);await h.restore(plan);assert.equal(h.context.portfolio.categories[0].board.products[0].name,'Invented backup');assert.equal(h.credentials.key,'synthetic-old-key');assert.equal(h.context.workspaceOpening,false);
}
{
 const h=harness();await h.show();const plan=await h.review(),before=h.raw;h.failWrite();await assert.rejects(h.restore(plan),/quota/);assert.equal(h.raw,before);assert.equal(h.context.portfolio,null);assert.equal(h.shell.inert,true);assert.equal(h.images.size,0);assert.equal(h.credentials.connection,'synthetic-old-connection');
}
{
 const h=harness();await h.show();const plan=await h.review(),before=h.raw;h.failActivate();await assert.rejects(h.restore(plan),/activation/);assert.equal(h.raw,before);assert.equal(h.context.portfolio,null);assert.equal(h.context.workspaceOpening,true);assert.equal(h.context.workspaceRecoveryExportText,before);
}
{
 const h=harness();await h.show();const plan=await h.review();h.failActivate();h.failRollback();await assert.rejects(h.restore(plan),/recovery archive/);assert.equal(h.raw,plan.serialized);assert.equal(h.context.workspaceRecoveryExportText,' { damaged saved data \n');assert.equal(h.context.workspaceOpening,true);
}
{
 const h=harness();await h.show();const plan=await h.review();h.mutateDurable(JSON.stringify({...seed,recoveredBy:'other tab'}));const current=h.raw;await assert.rejects(h.restore(plan),/Another tab/);assert.equal(h.raw,current);assert.equal(h.context.portfolio,null);
}
{
 const h=harness({record:null,legacy:' damaged legacy data \n'});await h.show();assert.equal(h.context.workspaceRecoveryExportText,' damaged legacy data \n');const plan=await h.review();h.context.localStorage.getItem=()=> 'newer legacy data';await assert.rejects(h.restore(plan),/workspace has changed/);assert.equal(h.raw,null);
}
{
 const h=harness();await h.show();const invalid=clone(seed);invalid.categories[0].board.products.push({...invalid.categories[0].board.products[0]});await assert.rejects(h.review(invalid),/repeats product ID/);assert.equal(h.writes.length,0);
 const missingImage=clone(seed);missingImage.imageAssets=[{id:'missing',sourceType:'local'}];missingImage.categories[0].board.products[0].imageAssetId='missing';await assert.rejects(h.review(missingImage),/image files.*unavailable/);assert.equal(h.writes.length,0);
 await assert.rejects(h.review({version:1,categories:[]}),/complete portfolio/);
}
const main=html.indexOf('<main class="app-shell">');for(const id of ['workspaceRecoveryExport','workspaceRecoveryFile','workspaceRecoveryKey','workspaceRecoveryReview','workspaceRecoveryRestore'])assert.ok(html.indexOf(`id="${id}"`)<main,`${id} remains accessible outside the inert workspace`);
assert.match(app,/await workspaceStorage\.recover\(plan\.serialized/);assert.match(app,/await workspaceStorage\.rollbackRecovery\(receipt\)/);assert.match(app,/await showWorkspaceRecovery\(\);/);
console.log('Workspace recovery checks passed: exact raw export outside inert shell, reviewed complete backups, no-write preview, explicit validated replacement, quota/activation/rollback faults, cross-tab and legacy stale refusal, missing-image/duplicate validation, retained credentials and protected prior records.');
