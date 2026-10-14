import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../../public/blueprint/analytics.js',import.meta.url),'utf8');
const ref=cell=>({sheet:'Synthetic fixture',cell,value:null});
const product=(id,category,revenue,grossProfit,units,previous)=>({
  id,name:id,category,revenueByYear:{2025:previous,2026:revenue},gmByYear:{2025:null,2026:grossProfit},unitsByYear:{2025:null,2026:units},
  sourceByYear:{2026:{revenue:[ref(id+'-R')],grossProfit:[ref(id+'-G')],units:[ref(id+'-U')]}},
});
const published=(category,revenue,grossMargin,target)=>({period:2026,category,revenue,grossMargin,target,
  source:{revenue:[ref(category+'-published-revenue')],grossMargin:[ref(category+'-published-margin')],target:[ref(category+'-target')]}});
const fixture={
  periods:[2025,2026,2027],categories:['Headsets','Mice','Keyboards','Others'],
  products:[product('H1','Headsets',100,20,10,50),product('H2','Headsets',-20,-4,-2,-10),product('M1','Mice',300,150,30,200),product('M2','Mice',null,null,null,null),product('K1','Keyboards',2000,1000,200,1000),product('O1','Others',null,null,null,null)],
  // Source Dashboard revenue deliberately differs from leaf-product revenue.
  // The published adjusted margin must use its own Dashboard weight evidence.
  published:[published('Headsets',100,0.4,110),published('Mice',200,0.7,320),published('Keyboards',2000,0.5,2400),published('All',2380,0.91,9999)],
  investments:[
    {category:'Headsets',period:2026,amount:20,group:'Tooling',source:[ref('spend-H1')]},
    {category:'Headsets',period:2026,amount:-3,group:'Tooling adjustment',source:[ref('spend-H2')]},
    {category:'Headsets',period:2026,amount:5,group:'Compliance',source:[ref('spend-H3')]},
    {category:'Mice',period:2026,amount:30,group:'NRE',source:[ref('spend-M1')]},
    {category:'Mice',period:2026,amount:null,group:'NRE',source:[ref('spend-M2')]},
    {category:'Keyboards',period:2026,amount:999,group:'NRE'},
    {category:'Mice',period:2025,amount:777,group:'NRE'},
  ],
  npi:[
    {category:'Headsets',period:2026,productId:'H1',revenue:40,source:[ref('npi-H1')]},
    {category:'Headsets',period:2026,productId:'H2',revenue:null,source:[ref('npi-H2')]},
    {category:'Mice',period:2026,productId:'M1',revenue:80,source:[ref('npi-M1-Q1')]},
    {category:'Mice',period:2026,productId:'M1',revenue:-5,source:[ref('npi-M1-Q2')]},
    {category:'Keyboards',period:2026,productId:'K1',revenue:999},
    {category:'Mice',period:2025,productId:'M1',revenue:777},
  ],
  tam:[
    {category:'Headsets',metric:'Revenue',values:{2026:1000},sourceByYear:{2026:[ref('tam-H')]}},
    {category:'PC Headsets',metric:'Revenue',values:{2026:600}},
    {category:'Console Headsets',metric:'Revenue',values:{2026:400}},
    {category:'Mice',metric:'Revenue',values:{2026:2000},sourceByYear:{2026:[ref('tam-M')]}},
    {category:'Mice',metric:'Units',values:{2026:9999}},
    {category:'Keyboards',metric:'Revenue',values:{2026:7000}},
  ],
  npiValues:[{name:'H1',category:'Headsets',roi:2,signal:'Fixture signal'},{name:'M1',category:'Mice',roi:1},{name:'M1',category:'Mice',roi:3}],
};
function engine(data=structuredClone(fixture)) {
  const window={HX_DATA:data};
  vm.runInNewContext(source,{window},{filename:'blueprint/analytics.js'});
  return {api:window.HX_ANALYTICS,data};
}
const near=(actual,expected,message)=>assert.ok(typeof actual==='number'&&Math.abs(actual-expected)<1e-10,`${message}: got ${actual}, expected ${expected}`);
const {api,data}=engine(),before=JSON.stringify(data),options={period:2026,category:['Headsets','Mice']};
const selected=api.summarize(options);
assert.equal(selected.revenue,380); assert.equal(selected.grossProfit,166); assert.equal(selected.units,38);
near(selected.rawMargin,166/380,'Raw margin is aggregate product GM dollars / aggregate revenue');
near(selected.publishedMargin,(100*0.4+200*0.7)/(100+200),'Adjusted published GM uses category Dashboard revenue weights');
near(selected.grossMargin,0.6,'Multi-category displayed GM retains complete adjusted source definitions');
assert.match(selected.marginBasis,/Revenue-weighted category published GM/);
assert.notEqual(selected.grossMargin,(0.4+0.7)/2,'Category margin percentages are not averaged equally');
assert.notEqual(selected.grossMargin,0.4+0.7,'Category margin percentages are not added');
assert.equal(selected.revenueTarget,430); assert.equal(selected.target,430); assert.equal(selected.gap,-50);
near(selected.attainment,380/430,'Target attainment divides aggregate source revenue by complete aggregate target');
near(selected.yoy.revenue,380/240-1,'Growth uses the same selected categories in the prior year');
assert.equal(selected.budget,52); assert.equal(selected.tooling,17); assert.equal(selected.compliance,5); assert.equal(selected.rnd,30);
assert.equal(selected.npi,115); assert.equal(selected.npiCount,3,'NPI count deduplicates project identity across source quarters');
assert.equal(selected.tam,3000,'TAM uses revenue rows and does not double count headset child markets');
assert.equal(selected.productCount,4); assert.equal(selected.activeProductCount,3,'Signed revenue is active while missing revenue is not');
assert.deepEqual(Array.from(selected.category),['Headsets','Mice']);
assert.deepEqual(Array.from(selected.source.revenue,r=>r.cell),['H1-R','H2-R','M1-R','M2-R'],'Subset revenue traces leaf values rather than a mismatched Dashboard sum');
assert.deepEqual(Array.from(selected.source.grossMargin,r=>r.cell),['Headsets-published-margin','Headsets-published-revenue','Mice-published-margin','Mice-published-revenue'],'Published weighted GM exposes both margins and their revenue weights');
assert.deepEqual(Array.from(selected.source.rawMargin,r=>r.cell),['H1-G','H1-R','H2-G','H2-R','M1-G','M1-R','M2-G','M2-R'],'Raw GM evidence includes its numerator and denominator');
assert.deepEqual(Array.from(selected.source.revenueTarget,r=>r.cell),['Headsets-target','Mice-target']);

const canonical=api.summarize({period:2026,category:['headsets','HEADSETS','Mice','mice']});
assert.equal(canonical.revenue,selected.revenue,'Repeated or aliased category labels never duplicate source rows');
assert.deepEqual(Array.from(canonical.category),['Headsets','Mice']);
assert.equal(api.summarize({period:2026,categories:['Headsets','Mice']}).revenue,selected.revenue,'The categories alias supports explicit multi-scope callers');
for(const category of ['Headsets',['Headsets']]){
  const single=api.summarize({period:2026,category});
  assert.equal(single.category,'Headsets'); assert.equal(single.revenue,80); assert.equal(single.publishedMargin,0.4); assert.equal(single.grossMargin,0.4); assert.equal(single.target,110);
}
const revenueEvidence=api.summarize({period:2026,category:'Headsets'});
assert.notEqual(revenueEvidence.revenue,data.published.find(row=>row.period===2026&&row.category==='Headsets').revenue,'The fixture deliberately has a different saved Dashboard revenue cache');
assert.deepEqual(Array.from(revenueEvidence.source.revenue,ref=>ref.cell),['H1-R','H2-R'],'Single-category revenue evidence follows the leaf-product values actually summed');
assert.deepEqual(Array.from(revenueEvidence.source.grossMargin,ref=>ref.cell),['Headsets-published-margin'],'Adjusted margin keeps its own published source even when revenue uses leaf evidence');
assert.deepEqual(Array.from(api.series('revenue',{category:'Headsets'}).find(point=>point.period===2026).source,ref=>ref.cell),['H1-R','H2-R'],'A single-category chart source point retains the same leaf evidence as its displayed value');
const allRevenueMismatch=engine();
allRevenueMismatch.data.published.find(row=>row.category==='All').revenue=8888;
const allRevenueEvidence=allRevenueMismatch.api.summarize({period:2026,category:'All'});
assert.equal(allRevenueEvidence.revenue,2380,'An inconsistent saved All cache does not replace the displayed leaf aggregate');
assert.deepEqual(Array.from(allRevenueEvidence.source.revenue,ref=>ref.cell),['H1-R','H2-R','M1-R','M2-R','K1-R','O1-R'],'All-category source evidence follows the actual aggregation rather than its inconsistent published cache');
assert.deepEqual(Array.from(allRevenueEvidence.source.grossMargin,ref=>ref.cell),['All-published-margin'],'Portfolio adjusted margin evidence remains published and unchanged');
for(const category of [undefined,[],['All','Headsets'],'all']){
  const all=api.summarize({period:2026,category});
  assert.equal(all.category,'All'); assert.equal(all.revenue,2380); assert.equal(all.publishedMargin,0.91,'All retains the saved portfolio adjusted GM'); assert.equal(all.target,9999);
}
const fullSubset=api.summarize({period:2026,category:data.categories});
assert.equal(fullSubset.publishedMargin,null,'An explicit full category subset does not silently use the saved portfolio All row');
near(fullSubset.grossMargin,(166+1000)/2380,'An incomplete explicit subset falls back to transparent product-weighted GM');
assert.equal(fullSubset.target,null,'A missing category target makes a complete subset target unavailable');

const productRows=api.productRows(options);
assert.deepEqual(Array.from(productRows,row=>row.id).sort(),['H1','H2','M1','M2']);
assert.equal(productRows.find(row=>row.id==='H2').revenue,-20); assert.equal(productRows.find(row=>row.id==='M2').revenue,null);
assert.equal(productRows.find(row=>row.id==='H1').roi,2); assert.equal(productRows.find(row=>row.id==='M1').roi,null,'Ambiguous NPI case ROI is not merged into a category comparison');
const revenueSeries=api.series('revenue',options);
assert.deepEqual(Array.from(revenueSeries,point=>point.value),[240,380,null],'Series applies one consistent subset to every source year without inventing missing values');
assert.equal(revenueSeries[1].target,430); assert.equal(revenueSeries[0].kind,'actual'); assert.equal(revenueSeries[2].kind,'projection');
const scenario=api.scenario({...options,revenueGrowth:10,marginChange:5,budgetChange:-10});
near(scenario.revenue,418,'Scenario applies revenue driver to aggregate baseline');
near(scenario.grossMargin,0.65,'Scenario applies a percentage-point change to the selected GM basis');
near(scenario.grossProfit,271.7,'Scenario margin basis and revenue combine coherently'); near(scenario.budget,46.8,'Scenario applies spend driver after selected aggregation');
assert.equal(scenario.kind,'scenario'); assert.equal(scenario.baseline.grossMargin,selected.grossMargin);
assert.equal(api.forecast('revenue',options).statisticalModelAvailable,false,'Multi selection does not turn source projections into fitted forecasts');
assert.equal(JSON.stringify(data),before,'Every comparison, series, case and scenario leaves source records unchanged');

const missingMargin=engine(); missingMargin.data.published.find(row=>row.category==='Mice').grossMargin=null;
const incomplete=missingMargin.api.summarize(options);
assert.equal(incomplete.publishedMargin,null); near(incomplete.grossMargin,166/380,'Missing adjusted category GM triggers raw aggregate fallback');
assert.equal(incomplete.marginBasis,'Product GM dollars / revenue'); assert.equal(incomplete.target,430,'Margin incompleteness does not erase independently complete targets');
assert.ok(incomplete.source.grossMargin.some(ref=>ref.cell==='H1-G')&&incomplete.source.grossMargin.some(ref=>ref.cell==='H1-R'),'Fallback evidence matches the actual displayed GM basis');
const duplicate=engine(); duplicate.data.published.push(structuredClone(duplicate.data.published[0]));
assert.equal(duplicate.api.summarize(options).publishedMargin,null,'Duplicate category source records cannot silently be counted twice');
assert.equal(duplicate.api.summarize(options).target,null);
const absent=api.summarize({period:2026,category:['Others','Unknown']});
for(const metric of ['revenue','grossProfit','grossMargin','rawMargin','publishedMargin','units','npi','tam','budget','target','attainment']) assert.equal(absent[metric],null,`${metric} remains unavailable for wholly missing observations`);
const zero=engine();
for(const row of zero.data.products){if(['Headsets','Mice'].includes(row.category)){row.revenueByYear[2026]=0;row.gmByYear[2026]=0;row.unitsByYear[2026]=0;}}
for(const row of zero.data.published){if(['Headsets','Mice'].includes(row.category)){row.revenue=0;row.grossMargin=0;row.target=0;}}
const zeroSummary=zero.api.summarize(options);
assert.equal(zeroSummary.revenue,0);assert.equal(zeroSummary.grossProfit,0);assert.equal(zeroSummary.units,0);assert.equal(zeroSummary.target,0);assert.equal(zeroSummary.gap,0);
assert.equal(zeroSummary.rawMargin,null);assert.equal(zeroSummary.publishedMargin,null);assert.equal(zeroSummary.grossMargin,null);assert.equal(zeroSummary.attainment,null,'Zero denominator does not become a fabricated percent');
const signed=engine(); signed.data.published.find(row=>row.category==='Headsets').revenue=-100;
near(signed.api.summarize(options).publishedMargin,(-100*0.4+200*0.7)/100,'Signed category revenues retain their source contribution in weighted GM');

const indexedFixture=structuredClone(fixture);
indexedFixture.periods=[2026,2023,2025,2024,2028,2027];
indexedFixture.products=[
  {...product('Large','Headsets',null,null,null,null),revenueByYear:{2023:1000,2024:2000,2025:4000,2026:0,2027:null,2028:-500},gmByYear:{2023:400,2024:800,2025:1600,2026:0,2027:null,2028:-200}},
  {...product('Small','Mice',null,null,null,null),revenueByYear:{2023:null,2024:10,2025:20,2026:-5,2027:0,2028:null},gmByYear:{2023:null,2024:2,2025:4,2026:-1,2027:0,2028:null}},
];
const indexedEngine=engine(indexedFixture),indexedBefore=JSON.stringify(indexedEngine.data);
const indexed=indexedEngine.api.compareSeries('revenue',{category:['Headsets','Mice']});
assert.equal(indexed.mode,'trend');assert.equal(indexed.indexed,true);assert.equal(indexed.unit,'index');
assert.equal(indexed.basePeriod,2024,'Trend uses the earliest chronologically common positive year, independent of source-array order');
const trace=(comparison,category)=>comparison.traces.find(trace=>trace.category===category);
const point=(comparison,category,period)=>trace(comparison,category).series.find(point=>point.period===period);
assert.equal(point(indexed,'Headsets',2024).value,100);assert.equal(point(indexed,'Mice',2024).value,100);
assert.equal(point(indexed,'Headsets',2025).value,200);assert.equal(point(indexed,'Mice',2025).value,200,'Equal growth is comparable despite the categories\' different source size');
assert.equal(point(indexed,'Headsets',2023).value,50);assert.equal(point(indexed,'Mice',2023).value,null,'An earlier unavailable reading remains a gap');
assert.equal(point(indexed,'Headsets',2026).value,0);assert.equal(point(indexed,'Mice',2026).value,-50,'Signed values after the baseline retain their signed indexed position');
assert.equal(point(indexed,'Headsets',2027).value,null);assert.equal(point(indexed,'Mice',2027).value,0);
assert.equal(point(indexed,'Headsets',2028).value,-25);assert.equal(point(indexed,'Mice',2028).value,null);
assert.equal(point(indexed,'Headsets',2025).rawValue,4000);assert.equal(point(indexed,'Mice',2025).rawValue,20,'Exact source values remain available beside normalized positions');
assert.equal(point(indexed,'Headsets',2025).kind,'actual');assert.equal(point(indexed,'Mice',2026).kind,'projection');
assert.equal(point(indexed,'Headsets',2026).target,110,'Source targets remain source values and are not silently normalized');
assert.equal(point(indexed,'Headsets',2026).source[0].cell,'Large-R','Indexed points retain evidence for the leaf revenue actually plotted');
const absolute=indexedEngine.api.compareSeries('revenue',{category:['Headsets','Mice'],mode:'values'});
assert.equal(absolute.mode,'values');assert.equal(absolute.basePeriod,null);assert.equal(absolute.indexed,false);assert.equal(absolute.unit,'currency');
assert.equal(point(absolute,'Headsets',2025).value,4000);assert.equal(point(absolute,'Mice',2025).value,20);
for(const category of ['All',[],['All','Headsets'],['Headsets'],['Headsets','headsets']]){
  const one=indexedEngine.api.compareSeries('revenue',{category,mode:'trend'});
  assert.equal(one.traces.length,1,'All is one portfolio trace and duplicate names do not create a comparison');
  assert.equal(one.mode,'values');assert.equal(one.indexed,false);assert.equal(one.basePeriod,null);
}
assert.equal(indexedEngine.api.compareSeries('revenue',{category:'All'}).traces[0].category,'All','All retains the portfolio-total control contract');
for(const metric of ['grossMargin','rawMargin','marketShare']){
  const percent=indexedEngine.api.compareSeries(metric,{category:['Headsets','Mice'],mode:'trend'});
  assert.equal(percent.mode,'values');assert.equal(percent.indexed,false);assert.equal(percent.basePeriod,null);assert.equal(percent.unit,'percent',`${metric} is already a ratio and remains on its percentage scale`);
  for(const category of ['Headsets','Mice'])for(const raw of indexedEngine.api.series(metric,{category})){
    const compared=point(percent,category,raw.period);assert.equal(compared.value,raw.value);assert.equal(compared.rawValue,raw.value);
  }
}
const noBaseFixture=structuredClone(indexedFixture);
noBaseFixture.periods=[2023,2024,2025,2026];
noBaseFixture.products[0].revenueByYear={2023:10,2024:-10,2025:0,2026:null};
noBaseFixture.products[1].revenueByYear={2023:null,2024:10,2025:1,2026:-1};
const noBase=engine(noBaseFixture).api.compareSeries('revenue',{categories:['Headsets','Mice'],mode:'trend'});
assert.equal(noBase.mode,'values');assert.equal(noBase.indexed,false);assert.equal(noBase.basePeriod,null);assert.equal(noBase.unit,'currency');
assert.match(noBase.reason,/shared year.*positive source value/i,'Unindexable data has an explicit explanation');
assert.equal(point(noBase,'Headsets',2024).value,-10);assert.equal(point(noBase,'Mice',2024).value,10,'Fallback retains exact raw values instead of dividing by zero or a negative baseline');
assert.equal(point(noBase,'Headsets',2026).value,null);
assert.equal(JSON.stringify(indexedEngine.data),indexedBefore,'Normalized display series never rewrite source values or source-period order');

console.log('Blueprint comparison checks passed: consistent selected aggregation, complete weighted margins and targets, immutable signed/missing data, common-year indexed trends, exact raw values and evidence, safe baseline fallback, ratio scales, series and scenarios.');
