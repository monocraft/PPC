import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../../public/blueprint/analytics.js',import.meta.url),'utf8');
const ref=cell=>({sheet:'Synthetic drill fixture',cell,value:null});
const row=(id,projectId,skuId,period,revenue,grossProfit,units,groupName='Alpha',category='Headsets')=>({id,projectId,skuId,period,quarter:1,name:skuId+' product',groupName,category,revenue,grossProfit,units,cost:null,source:[ref(id+'-R')],sourceByMetric:{revenue:[ref(id+'-R')],grossProfit:[ref(id+'-G')],units:[ref(id+'-U')]}});
const P1='Alpha-Code-2025',P2='Alpha-Future-2026',P3='Beta-Code-2025';
const fixture={schemaVersion:2,sourceGrainVersion:2,source:{name:'Synthetic source'},periods:[2025,2026],categories:['Headsets','Mice'],published:[],npi:[],tam:[],
  products:[
    {id:'g1',name:'Alpha',category:'Headsets',revenueByYear:{2025:1000,2026:2000},gmByYear:{2025:300,2026:600},unitsByYear:{2025:100,2026:200},sourceByYear:{2025:{revenue:[ref('group-alpha-R')],grossProfit:[ref('group-alpha-G')],units:[ref('group-alpha-U')]}}},
    {id:'g2',name:'Beta',category:'Mice',revenueByYear:{2025:500,2026:null},gmByYear:{2025:100,2026:null},unitsByYear:{2025:50,2026:null},sourceByYear:{2025:{revenue:[ref('group-beta-R')],grossProfit:[ref('group-beta-G')],units:[ref('group-beta-U')]}}},
  ],
  projects:[
    {id:P1,name:'Alpha',category:'Headsets',codeName:'Code',launchYear:2025},
    {id:'alpha-code-2025',name:'Alpha',category:'HEADSETS',codeName:'code',launchYear:2025},
    {id:P2,name:'Alpha',category:'Headsets',codeName:'Future',launchYear:2026},
    {id:P3,name:'Beta',category:'Mice',codeName:'Code',launchYear:2025},
    {id:'Conflict',name:'Alpha',category:'Headsets',codeName:'Conflict',launchYear:2025},
    {id:'CONFLICT',name:'Beta',category:'Mice',codeName:'Conflict',launchYear:2025},
  ],
  npiSkuRecords:[
    row('zero',P1,'SKU#ABA',2025,0,-1,0),
    row('first',P1,'SKU#ABA',2025,10,2,1),
    row('repeated-fact',P1,'SKU#ABA',2025,10,2,1),
    row('negative',P1,'SKU#ABD',2025,-5,-3,-1),
    row('missing',P1,'SKU#ABD',2026,null,null,null),
    row('unknown-year',P1,'SKU#ABA',null,999,999,999),
    row('future',P2,'FUTURE#ABA',null,null,null,null),
    row('same-sku-other-project',P3,'SKU#ABA',2025,900,90,90,'Beta','Mice'),
    row('unmapped','Unknown-Key','ORPHAN',2025,70,7,7),
    row('ambiguous','Conflict','AMBIGUOUS',2025,40,4,4),
  ],
  investments:[
    {productId:P1,category:'Headsets',period:2024,amount:30,source:[ref('P1-investment-2024')]},
    {productId:P1,category:'Headsets',period:2025,amount:70,source:[ref('P1-investment-2025')]},
    {productId:P1,category:'Headsets',period:2026,amount:null,source:[ref('P1-investment-missing')]},
    {productId:P2,category:'Headsets',period:2025,amount:50,source:[ref('P2-investment-2025')]},
    {productId:P2,category:'Headsets',period:2026,amount:150,source:[ref('P2-investment-2026')]},
    {productId:P3,category:'Mice',period:2025,amount:500,source:[ref('P3-investment')]},
    {productId:'Conflict',category:'Headsets',period:2025,amount:999,source:[ref('ambiguous-investment')]},
  ],
  prelaunchCases:[{id:P2,projectId:P2,name:'Alpha',category:'Headsets',launchYear:2026,revenue:10000,grossProfit:4000,units:100,launchYearRevenue:6000,launchYearGrossProfit:2400,launchYearUnits:60,source:[ref('P2-12M-plan')],sourceByMetric:{revenue:[ref('P2-launch-year-plan')]}}],
  npiValues:[{id:P1,name:'Alpha',category:'Headsets',revenue:1234,grossProfit:567,roi:7,dataStatus:'Actuals',source:[ref('saved-annualized-ROI')]}],
};
function engine(data=structuredClone(fixture)){
  const window={HX_DATA:data};vm.runInNewContext(source,{window},{filename:'blueprint/analytics.js'});return {api:window.HX_ANALYTICS,data};
}
const {api,data}=engine(),before=JSON.stringify(data);
const top=api.drilldown({category:'Headsets',period:2025});
assert.equal(top.schemaVersion,2);assert.equal(top.sourceGrainVersion,2);assert.equal(top.scope.level,'category');
assert.equal(top.summary.revenue,1000,'Category annual finance does not double count project tracker coverage');
assert.deepEqual(Array.from(top.children,c=>c.id),['g1','source-unmapped'],'Unmapped tracker projects remain discoverable without attributing them to a group');
const group=api.drilldown({category:'Headsets',groupId:'g1',period:2025});
assert.equal(group.scope.title,'Alpha');assert.equal(group.summary.revenue,1000,'Group keeps its independent annual finance total');
assert.equal(group.summary.budget,120,'Group source investment includes safe project keys once, without duplicate metadata multiplication');
assert.equal(group.summary.grossMargin,0.3);assert.equal(group.summary.tam,null);assert.equal(group.summary.target,null);
assert.equal(group.economics.sourceInvestment,300);assert.equal(group.economics.sourceReturnMultiple,null,'Group never invents ROI from project source ratios');
assert.deepEqual(Array.from(group.children,c=>c.projectId),[P1,P2],'Case-identical metadata deduplicates while plan-only projects remain available');
assert.equal(group.children.find(c=>c.projectId===P2).hasFinancials,false,'Missing reported results stay distinct from legitimate zero');
assert.match(group.notice,/different|changes|coverage/i);
assert.equal(group.summary.source.revenue[0].cell,'group-alpha-R');
const project=api.drilldown({category:'Headsets',groupId:'g1',projectId:P1,period:2025});
assert.equal(project.scope.level,'project');assert.equal(project.summary.revenue,15,'Project sums all source facts, including repeated-looking rows and signed adjustments');
assert.equal(project.summary.grossProfit,0);assert.equal(project.summary.grossMargin,0);assert.equal(project.summary.units,1);
assert.equal(project.summary.budget,70);assert.equal(project.summary.kind,'unclassified');assert.match(project.summary.basis,/unclassified/);
const investmentPoint=project.metricSeries.budget.find(point=>point.period===2025);
assert.equal(investmentPoint.kind,'source-investment');assert.match(investmentPoint.basis,/Source PD investment by fiscal year.*not verified actual cash spend/);
assert.deepEqual(Array.from(project.summary.source.revenue,r=>r.cell),['zero-R','first-R','repeated-fact-R','negative-R'],'Project financial evidence stays scoped to exact raw tracker rows');
assert.equal(project.coverage.missingPeriodRows,1,'Unknown source years remain visible as a coverage gap and are excluded from annual sums');
assert.equal(project.economics.reportedRevenue,15);assert.equal(project.economics.reportedGrossProfit,0,'Annualized saved case GP never replaces reported tracker GP');
assert.equal(project.economics.sourceInvestment,100);assert.equal(project.economics.sourceReturnMultiple,7,'Saved annualized source ROI remains separate from cumulative GP/investment arithmetic');
assert.match(project.economics.returnBasis,/annualized.*unverified/);assert.equal(project.economics.sourceReturnSource[0].cell,'saved-annualized-ROI');
assert.equal(project.economics.plan12M,null);assert.equal(project.economics.availability.comparable,false);assert.equal(project.coverage.comparableEstimate,false);
assert.deepEqual(Array.from(project.children,c=>c.skuId),['SKU#ABA','SKU#ABD']);
const sku=api.drilldown({category:'Headsets',groupId:'g1',projectId:P1,skuId:'SKU#ABA',period:2025});
assert.equal(sku.scope.level,'sku');assert.equal(sku.summary.revenue,20,'Exact project-scoped SKU does not absorb the same SKU from another project');
assert.equal(sku.summary.grossProfit,3);assert.equal(sku.summary.units,2);assert.equal(sku.summary.budget,null);
assert.equal(sku.economics.sourceInvestment,null);assert.equal(sku.economics.sourceReturnMultiple,null);assert.equal(sku.economics.parentProjectInvestment,100);
assert.equal(sku.economics.plan12M,null);assert.equal(sku.coverage.investmentAllocatedToSku,false);assert.match(sku.notice,/not allocated/);
assert.equal(sku.breadcrumbs.at(-1).skuId,'SKU#ABA');assert.equal(sku.breadcrumbs.at(-2).projectId,P1);assert.equal(sku.breadcrumbs[1].groupId,'g1');
assert.equal(api.summarize({category:'Headsets',groupId:'g1',projectId:P1,skuId:'SKU#ABA',period:2025}).revenue,20,'Existing summaries delegate lower scopes safely');
assert.equal(api.series('revenue',{category:'Headsets',groupId:'g1',projectId:P1,skuId:'SKU#ABA'}).find(p=>p.period===2025).kind,'unclassified');
assert.equal(api.series('revenue',{category:'Headsets',projectId:P1}).find(p=>p.period===2026).value,null,'Missing annual periods remain gaps');
assert.equal(api.summarize({period:2025,category:'Headsets'}).revenue,1000,'Existing category summary remains unchanged');

const planned=api.drilldown({category:'Headsets',groupId:'g1',projectId:P2,period:2026});
assert.equal(planned.summary.revenue,null);assert.equal(planned.summary.budget,150);assert.equal(planned.economics.plan12M.revenue,10000);
assert.equal(planned.economics.availability.reported,false);assert.equal(planned.economics.availability.estimate,true);assert.equal(planned.economics.availability.comparable,false);
assert.equal(planned.estimateSeries.find(p=>p.period===2026).value,6000,'Fiscal-year estimate uses explicit launch-year revenue, never the 12-month plan');
assert.equal(planned.estimateSeries.find(p=>p.period===2025).value,null);assert.equal(planned.estimateSeries.find(p=>p.period===2026).source[0].cell,'P2-launch-year-plan');
assert.equal(planned.metricSeries.revenueEstimate,planned.estimateSeries);assert.match(planned.estimateBasis,/no locked estimate/);
assert.equal(planned.children[0].skuId,'FUTURE#ABA','Plan-only SKUs remain discoverable from source placeholders');
const futureSku=api.drilldown({category:'Headsets',groupId:'g1',projectId:P2,skuId:'FUTURE#ABA',period:2026});
assert.equal(futureSku.economics.plan12M,null);assert.equal(futureSku.economics.parentProjectPlan12M.revenue,10000);
assert.ok(futureSku.estimateSeries.every(p=>p.value===null),'Parent plan is context and never appears as a SKU estimate');

const unmapped=api.drilldown({category:'Headsets',groupId:'source-unmapped',period:2025});
assert.equal(unmapped.summary.revenue,110);assert.equal(unmapped.summary.budget,null,'Unmatched and ambiguous project identities cannot borrow project investment');
assert.deepEqual(Array.from(unmapped.children,c=>c.projectId).sort(),['Conflict','Unknown-Key']);
const conflict=api.drilldown({category:'Headsets',groupId:'source-unmapped',projectId:'Conflict',period:2025});
assert.equal(conflict.summary.revenue,40);assert.equal(conflict.summary.budget,null);assert.equal(conflict.coverage.ambiguousProjectCount,1);
for(const bad of [{category:'Mice',groupId:'g1',period:2025},{category:'Headsets',groupId:'g2',projectId:P1,period:2025},{category:'Headsets',projectId:P1,skuId:'sku#aba',period:2025},{category:'Headsets',skuId:'SKU#ABA',period:2025}]){
  const unsafe=api.drilldown(bad);assert.equal(unsafe.coverage.invalidScope,true);assert.equal(unsafe.summary.revenue,null);assert.equal(unsafe.summary.budget,null);assert.equal(unsafe.children.length,0);assert.equal(unsafe.summary.source.revenue.length,0);
}
const legacy=engine();delete legacy.data.sourceGrainVersion;delete legacy.data.projects;delete legacy.data.npiSkuRecords;
const old=legacy.api.drilldown({category:'Headsets',groupId:'g1',period:2025});
assert.equal(old.summary.revenue,1000);assert.equal(old.coverage.needsReimport,true);assert.match(old.notice,/Reimport/);assert.equal(old.children.length,0,'Legacy context does not fabricate missing SKU records');
const ambiguousGroups=engine();ambiguousGroups.data.products.push({...ambiguousGroups.data.products[0],id:'duplicate-group'});
const ambiguousGroup=ambiguousGroups.api.drilldown({category:'Headsets',groupId:'g1',projectId:P1,period:2025});
assert.equal(ambiguousGroup.coverage.invalidScope,true,'Duplicate category/group identities cannot silently choose an attribution');
const noYear=engine();noYear.data.prelaunchCases[0].launchYear=null;
assert.ok(noYear.api.drilldown({category:'Headsets',projectId:P2}).estimateSeries.every(p=>p.value===null),'A 12-month plan without a reliable year is never put onto an annual axis');
assert.equal(JSON.stringify(data),before,'All hierarchy and economics calls preserve source input');

// Exercise the real workbook normalizer on a minimal table-shaped source. It
// must keep exact SKU suffixes, duplicate source facts, and category joins.
function sheet(name,headers,records){
  const cells=[];const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
  headers.forEach((h,i)=>cells.push({cell:col(i)+'1',value:h}));
  records.forEach((r,index)=>headers.forEach((h,i)=>cells.push({cell:col(i)+(index+2),value:r[h]??null})));
  return {name,cells};
}
const tinyRows=[{'Budget_Key_Base':P1,'Category':'Headsets','Part Number':'SKU#ABA','Group Name':'Alpha','Product Name':'SKU A','FY':2025,'FQ':'25-Q1','Units':0,'NetRev':10,'TotalCOS':8,'GM$':2},
  {'Budget_Key_Base':P1,'Category':'Headsets','Part Number':'SKU#ABA','Group Name':'Alpha','Product Name':'SKU A','FY':2025,'FQ':'25-Q1','Units':0,'NetRev':10,'TotalCOS':8,'GM$':2}];
const raw={source:{name:'Synthetic workbook'},sheets:[
  sheet('Cat_View',['Category','GroupName','2025 units','2025 Rev','2025 GM$','2025 GM%'],[{Category:'Headsets',GroupName:'Alpha','2025 units':2,'2025 Rev':100,'2025 GM$':20,'2025 GM%':0.2}]),
  sheet('Combined_Products',['Budget_Key','Category','GroupName','CodeName','Launch Year'],[{Budget_Key:P1,Category:'Headsets',GroupName:'Alpha',CodeName:'Code','Launch Year':2025},{Budget_Key:'Wrong category',Category:'Mice',GroupName:'Alpha',CodeName:'Else','Launch Year':2025}]),
  sheet('NPI_Tracker_All',Object.keys(tinyRows[0]),tinyRows),
  sheet('Budget_UnPivot',['Budget_Key','Category','GroupName','FY','Spend$'],[{Budget_Key:P1,Category:'Headsets',GroupName:'Alpha',FY:2025,'Spend$':30}]),
  sheet('RND_PreLaunch_All',['Budget_key','SubCategory','GroupName','LaunchYear','Rev_12M','LaunchYear Rev'],[{Budget_key:P1,SubCategory:'Headsets',GroupName:'Alpha',LaunchYear:2025,Rev_12M:300,'LaunchYear Rev':200}]),
]};
const normalized=api.normalizeWorkbook(raw);
assert.equal(normalized.schemaVersion,2);assert.equal(normalized.sourceGrainVersion,2);assert.equal(normalized.npiSkuRecords.length,2);
assert.equal(normalized.npiSkuRecords[0].skuId,'SKU#ABA');assert.equal(normalized.npiSkuRecords[0].units,0);
assert.equal(normalized.npiSkuRecords[0].sourceByMetric.revenue[0].sheet,'NPI_Tracker_All');assert.notEqual(normalized.npiSkuRecords[0].id,normalized.npiSkuRecords[1].id);
assert.equal(normalized.products[0].context.length,1,'Context joins require category and normalized group identity');
assert.equal(normalized.prelaunchCases[0].revenue,300);assert.equal(normalized.prelaunchCases[0].launchYearRevenue,200);
const normalizedEngine=engine(normalized).api;
assert.equal(normalizedEngine.drilldown({category:'Headsets',projectId:P1,skuId:'SKU#ABA',period:2025}).summary.revenue,20,'The importer retains additive rows for exact scoped SKU drill');

console.log('Blueprint drilldown checks passed: source grain v2, exact group/project/SKU hierarchy, additive signed and missing facts, unclassified annual series, safe identity joins, legacy reimport, independent annual/12M plans, cached source ROI and zero SKU cost allocation.');
