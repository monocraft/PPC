import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const code=await readFile(new URL('../../public/blueprint/analytics.js',import.meta.url),'utf8');
const years=[2023,2024,2025,2026,2027],ref=cell=>({sheet:'Synthetic sibling fixture',cell,value:null});
const product=(id,name,category,values,margin)=>({id,name,category,revenueByYear:Object.fromEntries(years.map((year,i)=>[year,values[i]])),gmByYear:Object.fromEntries(years.map((year,i)=>[year,typeof values[i]==='number'?values[i]*margin:null])),unitsByYear:Object.fromEntries(years.map((year,i)=>[year,typeof values[i]==='number'?values[i]/10:null])),sourceByYear:Object.fromEntries(years.map(year=>[year,{revenue:[ref(`${id}-${year}-R`)],grossProfit:[ref(`${id}-${year}-G`)],units:[ref(`${id}-${year}-U`)]}]))});
const record=(id,projectId,skuId,period,revenue,grossProfit,units)=>({id,projectId,skuId,name:skuId+' item',groupName:'Large family',category:'Headsets',period,quarter:1,revenue,grossProfit,units,cost:null,source:[ref(id+'-R')],sourceByMetric:{revenue:[ref(id+'-R')],grossProfit:[ref(id+'-G')],units:[ref(id+'-U')]}});
const P1='Large family-One-2024',P2='Large family-Two-2024',P3='Large family-Future-2026';
const fixture={schemaVersion:2,sourceGrainVersion:2,source:{name:'Synthetic comparison'},periods:years,categories:['Headsets','Mice'],
  products:[product('big','Large family','Headsets',[1000,2000,4000,0,-500],0.2),product('small','Small family','Mice',[null,10,20,-5,0],0.5),product('missing','Missing family','Mice',[null,null,null,null,null],0.3)],
  projects:[{id:P1,name:'Large family',category:'Headsets',codeName:'One',launchYear:2024},{id:P2,name:'Large family',category:'Headsets',codeName:'Two',launchYear:2024},{id:P3,name:'Large family',category:'Headsets',codeName:'Future',launchYear:2026}],
  npiSkuRecords:[record('P1-A-24',P1,'SKU-A#ABA',2024,1000,100,100),record('P1-B-24',P1,'SKU-B#ABA',2024,100,50,10),record('P1-A-25',P1,'SKU-A#ABA',2025,2000,400,200),record('P1-B-25',P1,'SKU-B#ABA',2025,-100,-20,-10),record('P1-A-26',P1,'SKU-A#ABA',2026,0,0,0),record('P1-B-26',P1,'SKU-B#ABA',2026,null,null,null),record('P2-A-24',P2,'SKU-A#ABA',2024,10,5,1),record('P2-A-25',P2,'SKU-A#ABA',2025,20,6,2),record('P2-A-26',P2,'SKU-A#ABA',2026,-5,-2,-1),record('P2-A-27',P2,'SKU-A#ABA',2027,0,0,0),record('P2-C-placeholder',P2,'SKU-C#ABA',null,null,null,null),record('future-placeholder',P3,'FUTURE#ABA',null,null,null,null),{...record('orphan','Unknown-Key','ORPHAN',2025,2,1,1),category:'Mice',groupName:'Small family'}],
  investments:[{productId:P1,category:'Headsets',period:2024,amount:100,source:[ref('P1-PD24')]},{productId:P1,category:'Headsets',period:2025,amount:0,source:[ref('P1-PD25')]},{productId:P2,category:'Headsets',period:2024,amount:50,source:[ref('P2-PD24')]},{productId:P2,category:'Headsets',period:2025,amount:null,source:[ref('P2-PD25-missing')]}],
  prelaunchCases:[{id:P3,projectId:P3,name:'Large family',category:'Headsets',launchYear:2026,revenue:1000,grossProfit:400,units:100,launchYearRevenue:600,source:[ref('plan-12M')],sourceByMetric:{revenue:[ref('plan-launch-year')]}}],
  published:[{period:2024,category:'All',grossMargin:0.99,target:99999,revenue:99999,source:{grossMargin:[ref('portfolio-adjusted')],target:[ref('portfolio-target')]}}],tam:[{category:'Headsets',metric:'Revenue',values:{2024:100000}}],npi:[],npiValues:[],
};
function engine(data=structuredClone(fixture)){const window={HX_DATA:data};vm.runInNewContext(code,{window},{filename:'blueprint/analytics.js'});return {api:window.HX_ANALYTICS,data};}
const {api,data}=engine(),before=JSON.stringify(data);
const at=(points,period)=>points.find(point=>point.period===period),trace=(model,id)=>model.traces.find(trace=>trace.id===id),near=(a,b,label)=>assert.ok(typeof a==='number'&&Math.abs(a-b)<1e-10,`${label}: ${a} !== ${b}`);
assert.equal(api.compareDrillSeries('revenue',{category:'All',compareIds:[]}),null,'Clearing the selection restores ordinary navigation without creating an aggregate');
assert.equal(api.compareDrillSeries('revenue',{category:'All'}),null);
const groups=api.compareDrillSeries('revenue',{category:'All',compareIds:['big','small'],period:2025});
assert.equal(groups.active,true);assert.equal(groups.invalid,false);assert.equal(groups.indexed,true);assert.equal(groups.mode,'trend');assert.equal(groups.unit,'index');assert.equal(groups.basePeriod,2024);
assert.equal(at(trace(groups,'big').series,2024).value,100);assert.equal(at(trace(groups,'small').series,2024).value,100);
assert.equal(at(trace(groups,'big').series,2025).value,200);assert.equal(at(trace(groups,'small').series,2025).value,200,'Equal relative growth is comparable across very different sizes');
assert.equal(at(trace(groups,'big').series,2026).value,0);assert.equal(at(trace(groups,'small').series,2026).value,-50);
assert.equal(at(trace(groups,'big').series,2027).value,-25);assert.equal(at(trace(groups,'small').series,2027).value,0);
assert.equal(at(trace(groups,'small').series,2023).value,null);assert.equal(at(trace(groups,'small').series,2025).rawValue,20);
assert.equal(trace(groups,'small').scope.groupId,'small');assert.equal(trace(groups,'small').scope.category,'Mice');
assert.equal(at(trace(groups,'small').series,2025).source[0].cell,'small-2025-R');
assert.equal(trace(groups,'big').baseline.source[0].cell,'big-2024-R','Indexed traces preserve the baseline evidence as well as exact yearly source evidence');
assert.equal(groups.selectionSummary.revenue,4020);assert.equal(at(groups.selectionSeries,2025).value,4020,'Aggregate series stays raw even while displayed traces are indexed');
near(groups.selectionSummary.grossMargin,(800+10)/(4000+20),'Combined margin divides combined source dollars rather than averaging percentages');
assert.equal(groups.selectionSummary.publishedMargin,null);assert.equal(groups.selectionSummary.target,null);assert.equal(groups.selectionSummary.tam,null,'An unrelated portfolio margin, target or TAM is never inherited');
assert.equal(groups.selectionSummary.coverage.selectedCount,2);
assert.equal(at(groups.selectionSeries,2023).value,null,'A missing selected entity does not become a partial total');
assert.equal(at(groups.selectionSeries,2023).coverage.missingCount,1);assert.deepEqual(Array.from(at(groups.selectionSeries,2023).coverage.missingIds),['small']);
assert.equal(at(groups.selectionSeries,2026).value,-5,'Known zero remains additive with a signed source value');
assert.deepEqual(Array.from(groups.selectionSummary.source.revenue,r=>r.cell),['big-2025-R','small-2025-R']);
const values=api.compareDrillSeries('revenue',{category:['Headsets','Mice'],compareIds:['big','small'],period:2024,mode:'values'});
assert.equal(values.mode,'values');assert.equal(values.indexed,false);assert.equal(values.basePeriod,null);assert.equal(values.unit,'currency');
assert.equal(at(trace(values,'big').series,2024).value,2000);assert.equal(values.selectionSummary.revenue,2010);
const duplicate=api.compareDrillSeries('revenue',{category:'All',compareIds:['small','small'],period:2025});
assert.equal(duplicate.traces.length,1);assert.equal(duplicate.selectionSummary.revenue,20);assert.equal(duplicate.mode,'values');
const noBaseline=api.compareDrillSeries('revenue',{category:'All',compareIds:['big','missing'],period:2024});
assert.equal(noBaseline.indexed,false);assert.equal(noBaseline.mode,'values');assert.match(noBaseline.reason,/shared year.*positive/);assert.equal(noBaseline.selectionSummary.revenue,null);assert.equal(noBaseline.coverage.missingByMetric.revenue,1);
for(const metric of ['grossMargin','rawMargin']){const model=api.compareDrillSeries(metric,{category:'All',compareIds:['big','small'],period:2024,mode:'trend'});assert.equal(model.unit,'percent');assert.equal(model.mode,'values');assert.equal(model.indexed,false);near(model.selectionSummary[metric],405/2010,'Ratio metrics retain weighted dollar aggregation');}
assert.equal(api.compareDrillSeries('units',{category:'All',compareIds:['big','small'],mode:'values'}).unit,'number');

const projects=api.compareDrillSeries('revenue',{category:'Headsets',groupId:'big',compareIds:[P1,P2],period:2024,mode:'values'});
assert.equal(projects.selectionSummary.revenue,1110);assert.equal(projects.selectionSummary.grossProfit,155);near(projects.selectionSummary.grossMargin,155/1110,'Project margins use source GP/revenue, without parent group finance');
assert.equal(projects.selectionSummary.budget,150);assert.equal(projects.selectionSummary.productCount,0);assert.equal(projects.selectionSummary.projectCount,2);
assert.equal(at(trace(projects,P1).series,2024).kind,'unclassified');assert.match(at(trace(projects,P1).series,2024).basis,/unclassified/);
assert.equal(trace(projects,P1).scope.projectId,P1);assert.deepEqual(Array.from(at(trace(projects,P1).series,2024).source,r=>r.cell),['P1-A-24-R','P1-B-24-R']);
const incompleteBudget=api.compareDrillSeries('budget',{category:'Headsets',groupId:'big',compareIds:[P1,P2],period:2025,mode:'values'});
assert.equal(incompleteBudget.selectionSummary.budget,null);assert.equal(incompleteBudget.coverage.missingByMetric.budget,1);assert.equal(incompleteBudget.coverage.completeByMetric.budget,false);assert.equal(at(trace(incompleteBudget,P1).series,2025).value,0);
assert.equal(at(trace(incompleteBudget,P2).series,2025).value,null);assert.equal(at(incompleteBudget.selectionSeries,2024).value,150);assert.equal(at(trace(incompleteBudget,P1).series,2025).kind,'source-investment');
const planned=api.compareDrillSeries('revenue',{category:'Headsets',groupId:'big',compareIds:[P1,P3],period:2026,mode:'values'});
assert.equal(planned.selectionSummary.revenue,null);assert.equal(at(trace(planned,P3).series,2026).value,null,'A plan does not fill the reported source gap');
assert.equal(at(trace(planned,P3).estimateSeries,2026).value,600);assert.equal(at(trace(planned,P3).estimateSeries,2026).rawValue,600,'Only the explicit annual source plan is exposed; the 12M plan is never substituted');
assert.equal(at(trace(planned,P3).estimateSeries,2026).source[0].cell,'plan-launch-year');assert.equal(at(trace(planned,P3).estimateSeries,2025).value,null);
const skus=api.compareDrillSeries('revenue',{category:'Headsets',groupId:'big',projectId:P1,compareIds:['SKU-A#ABA','SKU-B#ABA'],period:2025,mode:'values'});
assert.equal(skus.selectionSummary.revenue,1900);assert.equal(skus.selectionSummary.grossProfit,380);assert.equal(skus.selectionSummary.units,190);assert.equal(skus.selectionSummary.budget,null);assert.equal(skus.coverage.missingByMetric.budget,2);
assert.equal(at(trace(skus,'SKU-A#ABA').series,2024).value,1000,'The same exact SKU under another project is excluded');
assert.equal(trace(skus,'SKU-A#ABA').scope.projectId,P1);assert.equal(trace(skus,'SKU-A#ABA').scope.skuId,'SKU-A#ABA');
assert.deepEqual(Array.from(skus.selectionSummary.source.revenue,r=>r.cell),['P1-A-25-R','P1-B-25-R']);
assert.ok(skus.traces.every(trace=>trace.estimateSeries.every(point=>point.value===null)),'No project estimate is allocated to selected SKUs');
assert.equal(at(skus.selectionMetricSeries.revenue,2026).value,null,'A known zero plus missing sibling stays incomplete instead of becoming zero');
assert.match(skus.notice,/not allocated/);

for(const compareIds of ['big',[null],[''],['x'.repeat(241)],['big\n'],Array(51).fill('big'),['big','not-visible'],['BIG']]){
  const bad=api.compareDrillSeries('revenue',{category:'All',compareIds});assert.equal(bad.active,false);assert.equal(bad.invalid,true);assert.equal(bad.traces.length,0);assert.equal(bad.selectionSummary,null);assert.equal(bad.selectionSeries.length,0);assert.ok(bad.reason);
}
for(const options of [{category:'Headsets',groupId:'big',compareIds:['small']},{category:'Headsets',groupId:'big',projectId:P1,compareIds:['SKU-C#ABA']},{category:'Headsets',groupId:'big',projectId:P1,skuId:'SKU-A#ABA',compareIds:['SKU-A#ABA']},{category:'All',compareIds:['big','source-unmapped']}])assert.equal(api.compareDrillSeries('revenue',options).invalid,true,'Comparison cannot cross parent scope or mix potentially overlapping source populations');
const ambiguous=engine();ambiguous.data.products.push({...ambiguous.data.products[0],name:'Duplicate ID'});
assert.equal(ambiguous.api.compareDrillSeries('revenue',{category:'All',compareIds:['big']}).invalid,true,'Duplicate child IDs are rejected without choosing the first match');
const futureCoverage=engine();futureCoverage.data.prelaunchCases.push({...futureCoverage.data.prelaunchCases[0],id:P1,projectId:P1,launchYearRevenue:2200});
const futureTrend=futureCoverage.api.compareDrillSeries('revenue',{category:'Headsets',groupId:'big',compareIds:[P1,P2],period:2024,mode:'trend'});
assert.equal(futureTrend.indexed,true);near(at(trace(futureTrend,P1).estimateSeries,2026).value,2200/1100*100,'Annual estimate points use the same indexed baseline as the matching reported entity');
assert.equal(at(trace(futureTrend,P1).estimateSeries,2026).rawValue,2200,'Indexed annual estimates retain their exact source currency values');
assert.equal(at(trace(futureTrend,P1).estimateSeries,2026).source[0].cell,'plan-launch-year');
const selectedScenario=api.scenario({category:'All',compareIds:['small'],period:2025,revenueGrowth:10});
assert.equal(selectedScenario.baseline.revenue,20);near(selectedScenario.revenue,22,'Scenario baseline uses selected sibling values rather than the parent portfolio total');
const projectScenario=api.scenario({category:'Headsets',groupId:'big',compareIds:[P1,P2],period:2024,revenueGrowth:20});
assert.equal(projectScenario.baseline.revenue,1110);assert.equal(projectScenario.baseline.budget,150);near(projectScenario.grossProfit,186,'Selected scenario applies its complete dollar-weighted gross margin');
const skuScenario=api.scenario({category:'Headsets',groupId:'big',projectId:P1,compareIds:['SKU-A#ABA','SKU-B#ABA'],period:2025,revenueGrowth:10,marginChange:1,budgetChange:20});
assert.equal(skuScenario.baseline.revenue,1900);near(skuScenario.revenue,2090,'SKU scenario uses the selected exact project-scoped SKU aggregate');assert.equal(skuScenario.budget,null);assert.equal(skuScenario.budgetDelta,null,'Scenario drivers never allocate parent project cost to SKUs');
const missingScenario=api.scenario({category:'All',compareIds:['big','missing'],period:2024,revenueGrowth:10});
assert.equal(missingScenario.revenue,null);assert.equal(missingScenario.grossProfit,null,'Missing selected observations remain unavailable in scenarios');
assert.throws(()=>api.scenario({category:'All',compareIds:['not-visible'],period:2024}),/unavailable|ambiguous|scope/i,'Invalid comparison IDs fail safely instead of using parent scenario totals');
assert.equal(JSON.stringify(data),before,'Indexing, selection aggregation, plans and source routing leave the source unchanged');

console.log('Blueprint sibling comparison checks passed: exact parent-scoped selection, safe invalid IDs, shared positive baseline, signed/missing values, complete-only totals, dollar-weighted ratios, separate annual plans, exact SKU evidence, no inherited targets or cost allocation, and immutable source.');
