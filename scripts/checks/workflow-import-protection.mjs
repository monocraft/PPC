import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import '../../public/js/ascm-import.js';
import '../../public/js/master-model.js';
import '../../public/js/date-precision.js';
import '../../public/js/plc-import.js';
import '../../public/js/workflow-model.js';
const source=await fs.readFile(new URL('../../public/js/app.js',import.meta.url),'utf8');
const start=source.indexOf('function applyAscmGroupToProduct('),end=source.indexOf('\nfunction ascmProductId(',start);
assert(start>0&&end>start);
let locked=new Set(['generalAvailabilityDate']),notice=0;
const original={id:'p',name:'Fixture',generalAvailabilityDate:'2028-01-01',endManufacturingDate:'2030-01-01',roadmap:{startMonth:'2028-01',launchMonth:'2028-01',endMonth:'2030-01',status:'in-planning'},specs:[{id:'s',label:'Keep',value:'Accepted'}]};
const context=vm.createContext({Date,JSON,globalThis:{PortfolioWorkflowModel:globalThis.PortfolioWorkflowModel,PortfolioFieldProtection:{check:({field})=>({protected:locked.has(field)})},PortfolioNotifications:{publish(){notice++;}},ASCMImporter:{mergeProductGroup:p=>({...p,generalAvailabilityDate:'2026-01-01',endManufacturingDate:'2027-01-01',ascm:{}})}},ascmGroupDates:()=>({gaDate:'2026-01-01',emDate:'2027-01-01'}),normalizeAscmProductMetadata:v=>v,makeRoadmap:()=>({}),inferFamily:()=>'',normalizeMonth:v=>v,monthStringFromDate:()=> '2026-01',monthIndex:v=>Number(v.replace('-','')),addMonths:()=> '2028-01',ascmRoadmapStatus:()=> 'launched',normalizeRoadmapStatus:v=>v,id:()=> 'fixture'});
vm.runInContext(source.slice(start,end)+'\nglobalThis.apply=applyAscmGroupToProduct;',context);
const product=structuredClone(original);context.globalThis.apply(product,{categoryId:'moved'}, {},'2026-10-15',false);
assert.equal(product.generalAvailabilityDate,original.generalAvailabilityDate);assert.equal(product.endManufacturingDate,original.endManufacturingDate,'Dependent end date cannot precede retained protected GA.');
assert.deepEqual(product.specs,original.specs);assert.equal(product.roadmap.startMonth,original.roadmap.startMonth);assert.equal(notice,1);
locked=new Set();const unlocked=structuredClone(original);context.globalThis.apply(unlocked,{categoryId:'c'}, {},'2026-10-15',false);assert.equal(unlocked.generalAvailabilityDate,'2026-01-01');
// Execute actual PLC planner over current exact source observations; protection
// changes only automatic updates and never modifies the input portfolio.
const importer=globalThis.PLCImporter;
const portfolio={version:4,categories:[{id:'pc-gaming-audio',board:{lanes:[{id:'lane'}],products:[{id:'p',laneId:'lane',name:'Fixture Headset',codename:'FixtureCode',ffsDate:'2027-01-01',plc:{version:1,reportDate:'2026-09-01',fields:{ffsDate:{value:'2027-01-01',raw:'2027-01-01',reportDate:'2026-09-01'}}}}]}}]};
const dataset={version:1,metadata:{fileName:'Synthetic.xlsx',fingerprint:'fixture',reportDate:'2026-10-15'},rows:[{key:'fixture',name:'Fixture Headset',codename:'FixtureCode',categoryId:'pc-gaming-audio',dates:{ffsDate:{kind:'exact',value:'2027-02-01',raw:'2027-02-01'}}}],diagnostics:[]};
const before=JSON.stringify(portfolio);globalThis.PortfolioFieldProtection={check:()=>({protected:true,unavailable:false})};
const plan=importer.buildPlan(dataset,portfolio,{now:'2026-10-15T00:00:00Z'});const date=plan.items[0].fields.find(field=>field.field==='ffsDate');assert.equal(date.status,'review');assert.match(date.reason,/Protected/);assert.equal(JSON.stringify(portfolio),before);
const applied=importer.applyPlan(portfolio,plan,{now:'2026-10-15T00:00:00Z'});assert.equal(applied.portfolio.categories[0].board.products[0].ffsDate,'2027-01-01');assert(applied.portfolio.plcReview.entries.length);
console.log('Import protection checks passed: actual ASCM writer holds protected and dependent lifecycle dates; actual PLC automatic planning holds protected evidence in review without mutating accepted dates.');
