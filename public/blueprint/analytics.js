(function (root) {
  'use strict';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const sum = values => values.some(finite) ? values.filter(finite).reduce((a, b) => a + b, 0) : null;
  const ratio = (a, b) => finite(a) && finite(b) && b !== 0 ? a / b : null;
  const canonical = value => {
    const key = String(value || '').trim().toLowerCase();
    if(/accessories$/.test(key))return 'Others';
    return ({all:'All',headsets:'Headsets', 'pc headsets':'PC Headsets', 'console headsets':'Console Headsets', mice:'Mice', keyboards:'Keyboards', controllers:'Controllers', microphones:'Standalone Mics', 'standalone mics':'Standalone Mics', 'standalone microphones':'Standalone Mics', others:'Others', 'keyboard accessories':'Others', 'mouse accessories':'Others'})[key] || String(value || '').trim();
  };
  const columns = n => { let s = ''; while (n) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; };
  const kind = year => Number(year) === 2025 ? 'actual' : Number(year) >= 2026 ? 'projection' : 'history';
  function normalizeWorkbook(raw) {
    const sheetList = Array.isArray(raw.sheets) ? raw.sheets : Object.entries(raw.sheets).map(([name, cells]) => ({ name, cells }));
    const lookup = Object.fromEntries(sheetList.map(sheet => [sheet.name, Array.isArray(sheet.cells) ? Object.fromEntries(sheet.cells.map(c => [c.cell, c])) : sheet.cells]));
    const cell = (sheet, address) => lookup[sheet]?.[address];
    const value = (sheet, address) => cell(sheet, address)?.value ?? null;
    const source = (sheet, address) => ({ sheet, cell: address, value: value(sheet, address), ...(cell(sheet,address)?.formula ? { formula: cell(sheet,address).formula, cached:true } : {}) });
    function rows(sheet, headerRow = 1, start = headerRow + 1, end) {
      const cells = lookup[sheet] || {}, result = [], heads = {};
      let max = 0;
      for (const address of Object.keys(cells)) {
        const match = address.match(/^([A-Z]+)(\d+)$/);
        if (!match) continue;
        const r = Number(match[2]); max = Math.max(max, r);
        if (r === headerRow && value(sheet,address) !== null) heads[match[1]] = String(value(sheet,address));
      }
      for (let r = start; r <= (end || max); r++) {
        const row = { _row:r, _sheet:sheet, _sources:{} };
        for (const [col, label] of Object.entries(heads)) { row[label] = value(sheet, col+r); row._sources[label] = source(sheet,col+r); }
        if (Object.keys(heads).some(col => value(sheet,col+r) !== null)) result.push(row);
      }
      return result;
    }
    const productSourceRows=rows('Cat_View');
    const periods=[...new Set(Object.keys(productSourceRows[0]||{}).map(k=>k.match(/^(\d{4}) Rev$/)?.[1]).filter(Boolean).map(Number))].sort((a,b)=>a-b);
    const products = productSourceRows.filter(r => r.GroupName && r.Category !== 'Total').map((r, index) => {
      const p = { id:'product-'+r._row, name:r.GroupName, groupName:r.GroupName, family:r.Family, category:canonical(r.Category), subcategory:r.Subcategory, codeName:r.CodeName, segment:r.Segment, connectivity:r.Connectivity, launchYear:r.LaunchYear, eolYear:r.EOLYear, status:null, revenueByYear:{}, gmByYear:{}, unitsByYear:{}, sourceByYear:{}, source:[source('Cat_View','D'+r._row)] };
      for (const year of periods) {
        p.revenueByYear[year] = r[year+' Rev']; p.gmByYear[year] = r[year+' GM$']; p.unitsByYear[year] = r[year+' units'];
        p.sourceByYear[year] = { revenue:[r._sources[year+' Rev']], grossProfit:[r._sources[year+' GM$']], units:[r._sources[year+' units']], grossMargin:[r._sources[year+' GM%']] };
      }
      return p;
    });
    const context = rows('Combined_Products');
    for (const p of products) {
      const matches = context.filter(c => canonical(c.Category)===canonical(p.category)&&identity(c.GroupName)===identity(p.name));
      const statuses = [...new Set(matches.map(m => m.Status).filter(Boolean))];
      p.status = statuses.length === 1 ? statuses[0] : statuses.length > 1 ? 'Mixed product states' : 'Unspecified';
      p.context = matches.map(m => ({ id:m.Budget_Key, name:m.ProductName, codeName:m.CodeName, ffs:m.FFS, endMarketing:m.EM, endSupport:m.ES, status:m.Status, innovation:m.InnovationType, launchYear:m['Launch Year'], source:source('Combined_Products','A'+m._row) }));
    }
    const published = [];
    const blocks = {2025:{revenue:'B',grossMargin:'C'},2026:{target:'D',revenue:'E',grossMargin:'I',targetMargin:'H'},2027:{target:'J',revenue:'K',grossMargin:'N'},2028:{target:'O',revenue:'P',grossMargin:'S'},2029:{target:'T',revenue:'U'}};
    for (let row=8;row<=14;row++) for (const [year, block] of Object.entries(blocks)) {
      const record = { period:Number(year), category:row===14 ? 'All' : canonical(value('Dashboard','A'+row)), source:{} };
      for (const [measure, col] of Object.entries(block)) { record[measure]=value('Dashboard',col+row); record.source[measure]=[source('Dashboard',col+row)]; }
      published.push(record);
    }
    const investments = rows('Budget_UnPivot').filter(r => r.Budget_Key).map(r => ({ id:'spend-'+r._row, productId:r.Budget_Key, name:r.GroupName, codeName:r.CodeName, category:canonical(r.Category), subcategory:r.Subcategory, period:r.FY, quarter:r.FQ, amount:r['Spend$'], type:r.SpendType, group:r.SpendGroup, source:[r._sources['Spend$'],r._sources.SpendQ] }));
    const projects=context.filter(r=>r.Budget_Key).map(r=>({id:String(r.Budget_Key),name:r.GroupName,category:canonical(r.Category),codeName:r.CodeName,launchYear:r['Launch Year'],status:r.Status,productName:r.ProductName,source:[r._sources.Budget_Key,r._sources.GroupName,r._sources.Category]}));
    const npiSkuRecords=rows('NPI_Tracker_All').filter(r=>r.Budget_Key_Base&&r['Part Number']).map(r=>({id:'npi-source-'+r._row,projectId:String(r.Budget_Key_Base),skuId:String(r['Part Number']),name:r['Product Name']||String(r['Part Number']),groupName:r['Group Name'],category:canonical(r.Category),codeName:r.CodeName,launchYear:r.LaunchYear,period:r.FY,quarter:Number(String(r.FQ||'').match(/Q([1-4])/i)?.[1])||null,revenue:r.NetRev,grossProfit:r['GM$'],units:r.Units,cost:r.TotalCOS,basis:'Unclassified source tracker record',source:[r._sources.NetRev],sourceByMetric:{revenue:[r._sources.NetRev],grossProfit:[r._sources['GM$']],units:[r._sources.Units],cost:[r._sources.TotalCOS]}}));
    const prelaunchCases=rows('RND_PreLaunch_All').filter(r=>r.Budget_key).map(r=>({id:String(r.Budget_key),projectId:String(r.Budget_key),name:r.GroupName,category:canonical(r.SubCategory),launchYear:r.LaunchYear,revenue:r.Rev_12M,grossProfit:r['GM$_12M'],units:r.Units_12M,launchYearRevenue:r['LaunchYear Rev'],launchYearGrossProfit:r['LaunchYear GM$'],launchYearUnits:r['LaunchYear Units'],basis:'Current 12-month source plan; no locked estimate vintage',source:[r._sources.Budget_key,r._sources.Rev_12M,r._sources['GM$_12M'],r._sources.Units_12M],sourceByMetric:{revenue:[r._sources['LaunchYear Rev']],grossProfit:[r._sources['LaunchYear GM$']],units:[r._sources['LaunchYear Units']]}}));
    const npiMap = new Map();
    for (const r of rows('NPI_Tracker_All')) {
      if (!r.Budget_Key_Base) continue;
      const match = String(r.FQ||'').match(/Q([1-4])/i), quarter=match ? Number(match[1]) : null;
      const key = [r.Budget_Key_Base,r.FY,quarter].join('|');
      if (!npiMap.has(key)) npiMap.set(key,{id:key,productId:r.Budget_Key_Base,name:r['Group Name'],category:canonical(r.Category),period:r.FY,quarter,units:[],revenue:[],grossProfit:[],cost:[],source:[],observationType:'Unclassified source quarter'});
      const a=npiMap.get(key); a.units.push(r.Units);a.revenue.push(r.NetRev);a.grossProfit.push(r['GM$']);a.cost.push(r.TotalCOS); if(a.source.length<3)a.source.push(r._sources.NetRev);
    }
    const npi = [...npiMap.values()].map(r=>({...r,units:sum(r.units),revenue:sum(r.revenue),grossProfit:sum(r.grossProfit),cost:sum(r.cost)}));
    const tam = rows('TAM').filter(r=>r.Category).map(r=>({metric:r.Metric,category:canonical(r.Category),values:Object.fromEntries(Array.from({length:8},(_,i)=>[2025+i,r['COY'+(2025+i)]])),sourceByYear:Object.fromEntries(Array.from({length:8},(_,i)=>[2025+i,[r._sources['COY'+(2025+i)]]]))}));
    const npiValues = [];
    for(let r=36;r<=300;r++) if(value('NPI_Value','S'+r)) npiValues.push({id:value('NPI_Value','S'+r),name:value('NPI_Value','R'+r),category:canonical(value('NPI_Value','Q'+r)),spend:value('NPI_Value','T'+r),units:value('NPI_Value','U'+r),revenue:value('NPI_Value','Y'+r),grossProfit:value('NPI_Value','Z'+r),margin:value('NPI_Value','AB'+r),roi:value('NPI_Value','AC'+r),roiBand:value('NPI_Value','AF'+r),paybackMonths:value('NPI_Value','AH'+r),gmTrend:value('NPI_Value','AD'+r),profitTrend:value('NPI_Value','AE'+r),signal:value('NPI_Value','AK'+r),dataStatus:value('NPI_Value','AA'+r),source:[source('NPI_Value','S'+r),source('NPI_Value','AC'+r),source('NPI_Value','AK'+r)]});
    const decisions=[];
    for(const group of [{start:2,name:'Scale now',width:9},{start:12,name:'Prioritize investment',width:8},{start:21,name:'Validate investment',width:8},{start:30,name:'Recovery needed',width:9},{start:40,name:'Review exit',width:10}]) {
      for(let r=9;r<=160;r++) if(value('Decisions',columns(group.start+1)+r)) {
        const details={};const sources=[];
        for(let offset=0;offset<group.width;offset++){const address=columns(group.start+offset)+r;details[String(value('Decisions',columns(group.start+offset)+'8')||'Field '+offset)]=value('Decisions',address);sources.push(source('Decisions',address));}
        decisions.push({id:group.name+'-'+r,action:group.name,name:value('Decisions',columns(group.start+1)+r),category:canonical(value('Decisions',columns(group.start)+r)),details,source:sources});
      }
    }
    const issues=[];
    for(const sheet of sheetList) for(const [address,c] of Object.entries(lookup[sheet.name]||{})) if(c.type==='e') issues.push({severity:'error',title:'Workbook cell error '+c.value,detail:c.formula||'Cached source error',sheet:sheet.name,cell:address});
    issues.push({severity:'warning',title:'Forecast and actuals need explicit separation',detail:'FY25 revenue is explicitly labelled actual on Dashboard. FY26–FY29 are projections. NPI quarter rows have no actual-versus-plan field.',sheet:'Dashboard',cell:'B7'});
    issues.push({severity:'warning',title:'Published GM includes adjustments',detail:'Published Dashboard GM can differ from sum of product GM dollars divided by sum of product revenue. Both values are shown separately.',sheet:'Dashboard',cell:'I8'});
    const leafUnits=sum(products.map(p=>p.unitsByYear[2024])),savedUnits=value('Cat_View','K214');
    if(finite(savedUnits)&&finite(leafUnits)&&Math.abs(savedUnits-leafUnits)>0.01&&String(cell('Category Targets','B2')?.formula||'').includes('#Totals')) issues.push({severity:'critical',title:'Filtered or incomplete denominator changes target calculations',detail:'Stored Cat_View total differs from the full product detail, while Category Targets uses that total as a business denominator. Dashboard product aggregates ignore saved view filters.',sheet:'Category Targets',cell:'B2'});
    if(/Cat_View!\$?L:\$?L/i.test(String(cell('Category Targets','I2')?.formula||''))) issues.push({severity:'critical',title:'Historical revenue allocation references units',detail:'Category Targets I2 reads the 2025 units column for a 2024 revenue allocation. The supplied target remains a source snapshot, not a validated recalculation.',sheet:'Category Targets',cell:'I2'});
    const actualCases=npiValues.filter(r=>r.dataStatus==='Actuals'),actualPDSpend=sum(actualCases.map(r=>r.spend)),riskSpend=sum(actualCases.filter(r=>r.signal==='Underperforming'||r.roiBand==='Weak').map(r=>r.spend));
    const postPorDiagnostic={records:npiValues.length,sourceActualStatusRecords:actualCases.length,projectionRecords:npiValues.filter(r=>r.dataStatus==='Projection').length,actualPDSpend,alignedCapitalAtRisk:riskSpend,alignedCapitalAtRiskPct:ratio(riskSpend,actualPDSpend),workbookCapitalAtRiskPctCache:value('NPI_Value','E15'),note:'Aligned audit diagnostic under source rules. Source Actuals status does not establish a verified actuals cutoff.'};
    if(finite(postPorDiagnostic.alignedCapitalAtRiskPct)&&finite(postPorDiagnostic.workbookCapitalAtRiskPctCache)&&Math.abs(postPorDiagnostic.alignedCapitalAtRiskPct-postPorDiagnostic.workbookCapitalAtRiskPctCache)>0.0001) issues.push({severity:'critical',title:'Capital at risk headline differs from aligned details',detail:'Aligned source-status and risk rows imply '+(100*postPorDiagnostic.alignedCapitalAtRiskPct).toFixed(2)+'%, while the saved headline is '+(100*postPorDiagnostic.workbookCapitalAtRiskPctCache).toFixed(2)+'%.',sheet:'NPI_Value',cell:'E15'});
    const cutoff=String(value('NPI_Trend','S19')||'').match(/FY(\d{2,4})\s*Q([1-4])/i);
    if(cutoff){const year=Number(cutoff[1])<100?2000+Number(cutoff[1]):Number(cutoff[1]),q=Number(cutoff[2]); if(npi.some(r=>Number(r.period)*4+Number(r.quarter)>year*4+q))issues.push({severity:'warning',title:'Quarter records extend beyond the displayed actuals cutoff',detail:'The source contains later NPI quarters than '+cutoff[0]+'. Those records remain unclassified; they are not automatically treated as actuals.',sheet:'NPI_Trend',cell:'S19'});}
    if(raw.definedNames?.some(n=>/BT_GROUP_(REV|GM)_12M/.test(n.name)&&/m-3|m - 3/.test(n.definition)))issues.push({severity:'critical',title:'Rolling quarter calculation needs rollover review',detail:'The named 12-month functions subtract three from a fiscal year ×10 plus quarter label, which omits preceding-year quarters at rollover.',sheet:'NPI_Value',cell:'G36'});
    const sheets=sheetList.map(s=>({name:s.name,state:s.state||'visible',dimension:s.dimension,cells:Object.keys(lookup[s.name]||{}).length,formulas:s.formulaCount??Object.values(lookup[s.name]||{}).filter(c=>c.formula||c.formulaAttributes).length,errorCount:Object.values(lookup[s.name]||{}).filter(c=>c.type==='e').length,purpose:s.purpose||root.HX_SHEET_PURPOSES?.[s.name]||''}));
    return {schemaVersion:2,sourceGrainVersion:2,source:{...raw.source,name:raw.source?.name||raw.source?.fileName||'HX Blueprint',currency:'USD',unit:'USD unless indicated',basis:'Saved workbook planning snapshot; formula caches are not recalculated'},periods,categories:[...new Set(products.map(p=>p.category))].sort(),products,projects,npiSkuRecords,prelaunchCases,published,investments,npi,tam,npiValues,decisions,sheets,quality:{issues,postPorDiagnostic},metrics:{}, fiscalCalendar:'FY Q1 Nov–Jan; Q2 Feb–Apr; Q3 May–Jul; Q4 Aug–Oct',actualsCutoff:value('NPI_Trend','S19'),recordCounts:{products:products.length,combinedProducts:context.length,spendEntries:investments.length,npiQuarterGroups:npi.length,npiSourceRows:rows('NPI_Tracker_All').length}};
  }
  const data=()=>root.HX_DATA;
  function categoryScope(category) {
    const categories=[...new Set((Array.isArray(category)?category:[category]).map(canonical).filter(Boolean))];
    return {all:!categories.length||categories.includes('All'),categories};
  }
  const selected=(rows,category)=>{const scope=categoryScope(category);return rows.filter(r=>scope.all||scope.categories.includes(canonical(r.category)));};
  const categoryOf=(options={})=>{
    const scope=categoryScope(options.categories??options.category);
    return scope.all?'All':scope.categories.length===1?scope.categories[0]:scope.categories;
  };
  const periodOf=(options={})=>Number(options.period||2026);
  const identity=value=>String(value??'').replace(/\u00a0/g,' ').trim().toLowerCase();
  function drilldown(options={}) {
    const d=data()||{},period=periodOf(options),category=categoryOf(options),products=d.products||[];
    const needsReimport=d.sourceGrainVersion!==2||!Array.isArray(d.projects)||!Array.isArray(d.npiSkuRecords);
    const groupKey=record=>canonical(record.category)+'|'+identity(record.name||record.groupName);
    const groupIndex=new Map(),projectIndex=new Map();
    for(const p of products){const key=groupKey(p);if(!groupIndex.has(key))groupIndex.set(key,[]);groupIndex.get(key).push(p);}
    for(const p of d.projects||[]){const key=identity(p.id);if(!key)continue;if(!projectIndex.has(key))projectIndex.set(key,[]);projectIndex.get(key).push(p);}
    const recordIndex=new Map();
    for(const r of d.npiSkuRecords||[]){const key=identity(r.projectId);if(!key)continue;if(!recordIndex.has(key))recordIndex.set(key,[]);recordIndex.get(key).push(r);}
    const nodes=[...new Set([...projectIndex.keys(),...recordIndex.keys()])].map(key=>{
      const definitions=projectIndex.get(key)||[],records=recordIndex.get(key)||[],first=definitions[0];
      const signatures=new Set(definitions.map(p=>[groupKey(p),identity(p.codeName),String(p.launchYear??'')].join('|')));
      const groups=first?groupIndex.get(groupKey(first))||[]:[];
      const recordConflict=first&&records.some(r=>canonical(r.category)!==canonical(first.category)||identity(r.groupName)!==identity(first.name));
      const ambiguous=signatures.size>1||groups.length>1||Boolean(recordConflict),mapped=definitions.length>0&&!ambiguous&&groups.length===1;
      return {key,id:first?.id||records[0]?.projectId,name:first?.name||records[0]?.groupName||records[0]?.projectId,category:canonical(first?.category||records[0]?.category),groupId:mapped?groups[0].id:'source-unmapped',mapped,ambiguous,records,definitions};
    });
    const inScope=node=>selected([node],category).length>0;
    const requestedProject=options.projectId?nodes.find(node=>node.key===identity(options.projectId)):null;
    let groupId=options.groupId||requestedProject?.groupId||null,projectId=requestedProject?.id||options.projectId||null,skuId=options.skuId===undefined||options.skuId===null?null:String(options.skuId);
    const group=products.find(p=>p.id===groupId),unmapped=groupId==='source-unmapped';
    const invalidScope=Boolean((options.projectId&&!requestedProject)||(skuId&&!projectId)||(skuId&&requestedProject&&!needsReimport&&!requestedProject.records.some(r=>r.skuId===skuId))||(groupId&&!unmapped&&!group)||(requestedProject&&(!inScope(requestedProject)||(options.groupId&&requestedProject.groupId!==options.groupId)))||(group&&!selected([group],category).length));
    const level=skuId?'sku':projectId?'project':groupId?'group':'category';
    const scopedNodes=invalidScope?[]:projectId?[requestedProject]:groupId?nodes.filter(node=>node.groupId===groupId&&inScope(node)):nodes.filter(inScope);
    const scopedProducts=invalidScope?[]:group? [group]:level==='category'?selected(products,category):[];
    const records=scopedNodes.flatMap(node=>node?.records||[]).filter(r=>!skuId||r.skuId===skuId);
    if(skuId&&!records.length&&!needsReimport)groupId=groupId||'source-unmapped';
    const safeKeys=new Set(scopedNodes.filter(node=>node?.mapped).map(node=>node.key));
    const spending=skuId?[]:(d.investments||[]).filter(r=>safeKeys.has(identity(r.productId)));
    const validPeriod=r=>Number.isInteger(Number(r.period))&&Number(r.period)>=1900&&Number(r.period)<=2200;
    const annualRecords=records.filter(validPeriod),basis=level==='category'?'Saved portfolio/category annual source':group&&!unmapped&&!projectId?'Annual product-group source; project/SKU tracker coverage is a separate population':'Annual sum of unclassified source tracker records; no verified actual/plan flag';
    const sourceFor=(metric,year)=>{
      if(invalidScope)return [];
      if(level==='category')return summarize({period:year,category}).source?.[metric]||[];
      if(metric==='budget')return spending.filter(r=>Number(r.period)===Number(year)).flatMap(r=>r.source||[]);
      if(metric==='grossMargin')return [...sourceFor('grossProfit',year),...sourceFor('revenue',year)];
      return group&&!unmapped&&!projectId?scopedProducts.flatMap(p=>p.sourceByYear?.[year]?.[metric]||[]):annualRecords.filter(r=>Number(r.period)===Number(year)).flatMap(r=>r.sourceByMetric?.[metric]||r.source||[]);
    };
    const valueFor=(metric,year)=>{
      if(invalidScope)return null;
      if(level==='category')return summarize({period:year,category})[metric]??null;
      if(metric==='grossMargin')return ratio(valueFor('grossProfit',year),valueFor('revenue',year));
      if(metric==='budget')return skuId?null:sum(spending.filter(r=>Number(r.period)===Number(year)).map(r=>r.amount));
      if(group&&!unmapped&&!projectId){const field={revenue:'revenueByYear',grossProfit:'gmByYear',units:'unitsByYear'}[metric];return sum(scopedProducts.map(p=>p[field]?.[year]));}
      return sum(annualRecords.filter(r=>Number(r.period)===Number(year)).map(r=>r[metric]));
    };
    const planRecords=projectId&&!skuId&&requestedProject?.mapped?(d.prelaunchCases||[]).filter(r=>identity(r.projectId||r.id)===identity(projectId)&&canonical(r.category)===requestedProject.category&&identity(r.name)===identity(requestedProject.name)):[];
    const plan=planRecords.length===1?planRecords[0]:null;
    const periods=[...new Set([...(d.periods||[]),...annualRecords.map(r=>Number(r.period)),...spending.filter(validPeriod).map(r=>Number(r.period)),...(plan&&Number.isInteger(Number(plan.launchYear))&&Number(plan.launchYear)>=1900&&Number(plan.launchYear)<=2200?[Number(plan.launchYear)]:[])])].sort((a,b)=>Number(a)-Number(b));
    const pointKind=year=>level==='category'||(group&&!unmapped&&!projectId)?kind(year):'unclassified';
    const metricSeries=Object.fromEntries(['revenue','grossProfit','grossMargin','units','budget'].map(metric=>[metric,periods.map(year=>({period:year,value:valueFor(metric,year),kind:metric==='budget'?'source-investment':pointKind(year),source:sourceFor(metric,year),basis:metric==='budget'?'Source PD investment by fiscal year; archive/manual/estimated schedule, not verified actual cash spend':basis}))]));
    const estimateBasis='Current launch-year source plan; no locked estimate vintage';
    const estimateSeries=periods.map(year=>({period:year,value:plan&&Number(plan.launchYear)===Number(year)?plan.launchYearRevenue??null:null,kind:'projection',source:plan&&Number(plan.launchYear)===Number(year)?plan.sourceByMetric?.revenue||plan.source||[]:[],basis:estimateBasis}));
    metricSeries.revenueEstimate=estimateSeries;
    const numericRecords=annualRecords.filter(r=>['revenue','grossProfit','units','cost'].some(key=>finite(r[key])));
    const reported={revenue:sum(annualRecords.map(r=>r.revenue)),grossProfit:sum(annualRecords.map(r=>r.grossProfit)),units:sum(annualRecords.map(r=>r.units)),throughPeriod:annualRecords.length?Math.max(...annualRecords.map(r=>Number(r.period))):null,basis:'Available unclassified tracker records; cumulative source coverage'};
    const sourceInvestment=skuId?null:sum(spending.map(r=>r.amount));
    const plan12M=plan?{revenue:plan.revenue??null,grossProfit:plan.grossProfit??null,units:plan.units??null,grossMargin:ratio(plan.grossProfit,plan.revenue),basis:plan.basis||'Current 12-month source plan; no locked estimate vintage',source:plan.source||[]}:null;
    const cachedCases=projectId&&!skuId&&requestedProject?.mapped?(d.npiValues||[]).filter(r=>identity(r.id)===identity(projectId)):[];
    const sourceCase=cachedCases.length===1?cachedCases[0]:null;
    const coverage={needsReimport,sourceGrainVersion:d.sourceGrainVersion||1,sourceRows:records.length,reportedRowCount:numericRecords.length,missingPeriodRows:records.length-annualRecords.length,skuCount:new Set(records.map(r=>r.skuId)).size,matchedProjectCount:scopedNodes.filter(n=>n?.mapped).length,unmappedProjectCount:scopedNodes.filter(n=>!n?.mapped).length,ambiguousProjectCount:scopedNodes.filter(n=>n?.ambiguous).length,estimateAvailable:Boolean(plan12M),comparableEstimate:false,investmentAllocatedToSku:false,invalidScope};
    const reason=skuId?'The source has no SKU-level investment or estimate allocation.':plan12M&&numericRecords.length?'The current plan has no locked estimate vintage or verified matching actual horizon.':plan12M?'No numeric reported tracker results are available for this planned project.':'No matching project estimate is supplied for these reported records.';
    const economics={sourceInvestment,periodInvestment:valueFor('budget',period),investmentBasis:'Source PD investment across source years; archive/manual/estimated schedule, not verified actual cash spend',investmentSource:spending.flatMap(r=>r.source||[]),reportedRevenue:reported.revenue,reportedGrossProfit:reported.grossProfit,sourceReturnMultiple:finite(sourceCase?.roi)?sourceCase.roi:null,returnBasis:'Saved source annualized 12-month gross profit / source PD investment; source Actuals status is unverified',sourceReturnSource:sourceCase?.source||[],sourceCase,plan12M,reported,availability:{reported:numericRecords.length>0,estimate:Boolean(plan12M),comparable:false,reason},parentProjectInvestment:skuId&&requestedProject?.mapped?sum((d.investments||[]).filter(r=>identity(r.productId)===requestedProject.key).map(r=>r.amount)):null};
    const parentPlans=skuId&&requestedProject?.mapped?(d.prelaunchCases||[]).filter(r=>identity(r.projectId||r.id)===identity(projectId)&&canonical(r.category)===requestedProject.category&&identity(r.name)===identity(requestedProject.name)):[];
    economics.parentProjectPlan12M=parentPlans.length===1?{revenue:parentPlans[0].revenue??null,grossProfit:parentPlans[0].grossProfit??null,units:parentPlans[0].units??null,basis:'Parent project current 12-month source plan; not allocated to this SKU',source:parentPlans[0].source||[]}:null;
    const summary={period,category,kind:pointKind(period),basis,source:Object.fromEntries(['revenue','grossProfit','grossMargin','units','budget'].map(metric=>[metric,sourceFor(metric,period)])),coverage};
    for(const metric of ['revenue','grossProfit','grossMargin','units','budget'])summary[metric]=valueFor(metric,period);
    Object.assign(summary,{rawMargin:ratio(summary.grossProfit,summary.revenue),publishedMargin:null,marginBasis:level==='category'?summarize({period,category}).marginBasis:'Scoped gross-profit dollars / scoped revenue',revenueTarget:null,target:null,tam:null,npi:sum(annualRecords.filter(r=>Number(r.period)===period).map(r=>r.revenue)),productCount:scopedProducts.length,npiCount:new Set(annualRecords.map(r=>r.projectId)).size});
    if(level==='category')Object.assign(summary,summarize({period,category}),{basis,coverage});
    const title=skuId?records[0]?.name||skuId:projectId?requestedProject?.name||String(projectId):unmapped?'Unmapped source projects':group?.name||group?.groupName||(Array.isArray(category)?category.join(' + '):category==='All'?'All categories':category);
    const scope={level,title,groupId,projectId,skuId,category};
    const breadcrumbs=[{label:Array.isArray(category)?category.join(' + '):category==='All'?'All categories':category,category,groupId:null,projectId:null,skuId:null}];
    if(groupId)breadcrumbs.push({label:unmapped?'Unmapped source projects':group?.name||group?.groupName||'Product group',category,groupId,projectId:null,skuId:null});
    if(projectId)breadcrumbs.push({label:requestedProject?.name||String(projectId),category,groupId,projectId,skuId:null});
    if(skuId)breadcrumbs.push({label:skuId,category,groupId,projectId,skuId});
    const metricValues=rows=>({revenue:sum(rows.map(r=>r.revenue)),grossProfit:sum(rows.map(r=>r.grossProfit)),units:sum(rows.map(r=>r.units))});
    let children=[];
    if(!invalidScope&&level==='category'){
      children=scopedProducts.map(p=>({id:p.id,level:'group',name:p.name||p.groupName,category:canonical(p.category),groupId:p.id,projectId:null,skuId:null,revenue:p.revenueByYear?.[period]??null,grossProfit:p.gmByYear?.[period]??null,units:p.unitsByYear?.[period]??null,basis:'Annual product-group source'}));
      const orphanRows=scopedNodes.filter(n=>!n.mapped).flatMap(n=>n.records).filter(r=>validPeriod(r)&&Number(r.period)===period);
      if(scopedNodes.some(n=>!n.mapped))children.push({id:'source-unmapped',level:'group',name:'Unmapped source projects',category,groupId:'source-unmapped',projectId:null,skuId:null,...metricValues(orphanRows),basis:'Unmapped tracker records; excluded from attributed project investment'});
    }else if(!invalidScope&&level==='group')children=scopedNodes.map(node=>({id:node.id,level:'project',name:node.name,category:node.category,groupId:node.groupId,projectId:node.id,skuId:null,...metricValues(node.records.filter(r=>validPeriod(r)&&Number(r.period)===period)),basis:'Unclassified tracker results; project source coverage'}));
    else if(!invalidScope&&level==='project'){
      const skus=[...new Set(records.map(r=>r.skuId))];
      children=skus.map(id=>({id,level:'sku',name:records.find(r=>r.skuId===id)?.name||id,category:requestedProject?.category,groupId,projectId,skuId:id,...metricValues(records.filter(r=>r.skuId===id&&validPeriod(r)&&Number(r.period)===period)),basis:'Exact project-scoped SKU; source investment is not allocated'}));
    }
    children=children.map(child=>({...child,hasFinancials:['revenue','grossProfit','units'].some(metric=>finite(child[metric]))}));
    const notice=invalidScope?'This source selection could not be matched safely.':needsReimport?'Reimport the workbook to retain exact project/SKU source rows. Existing saved annual values are preserved.':level==='category'?'Product-group annual finance and NPI project/SKU tracker records have different source coverage.':level==='group'?'Drilling into projects changes to available NPI tracker coverage; it does not allocate the group total.':skuId?'Exact SKU source results only. Project investment and estimates are not allocated to SKUs.':reason;
    return {schemaVersion:2,sourceGrainVersion:needsReimport?1:2,scope,breadcrumbs,children,summary,series:metricSeries.revenue,metricSeries,estimateSeries,estimateBasis,coverage,economics,notice};
  }
  function summarize(options={}) {
    if(options.groupId||options.projectId||options.skuId)return drilldown(options).summary;
    const d=data(),period=periodOf(options),category=categoryOf(options),products=selected(d.products,category),multiple=Array.isArray(category);
    const revenue=sum(products.map(p=>p.revenueByYear[period])),grossProfit=sum(products.map(p=>p.gmByYear[period])),units=sum(products.map(p=>p.unitsByYear[period]));
    const published=multiple?null:d.published?.find(r=>Number(r.period)===period&&canonical(r.category)===category);
    // A custom subset has no saved portfolio total. Combine one complete source
    // record per selected category; never add or simply average percentages.
    const publishedRows=multiple?category.map(name=>(d.published||[]).filter(r=>Number(r.period)===period&&canonical(r.category)===name)).map(records=>records.length===1?records[0]:null):[];
    const completePublished=multiple&&publishedRows.every(Boolean);
    const weightedPublished=completePublished&&publishedRows.every(r=>finite(r.revenue)&&finite(r.grossMargin))?ratio(sum(publishedRows.map(r=>r.revenue*r.grossMargin)),sum(publishedRows.map(r=>r.revenue))):null;
    const publishedMargin=multiple?weightedPublished:published?.grossMargin??null;
    const spending=selected(d.investments,category).filter(r=>Number(r.period)===period);
    const npiRows=selected(d.npi||[],category).filter(r=>Number(r.period)===period);
    const tamRows=selected((d.tam||[]).filter(r=>r.metric==='Revenue'&&!['PC Headsets','Console Headsets'].includes(canonical(r.category))),category);
    const previous=sum(products.map(p=>p.revenueByYear[period-1])),target=multiple?(completePublished&&publishedRows.every(r=>finite(r.target))?sum(publishedRows.map(r=>r.target)):null):published?.target??null,budget=sum(spending.map(r=>r.amount));
    const rawMargin=ratio(grossProfit,revenue),margin=finite(publishedMargin)?publishedMargin:rawMargin;
    const rawMarginSources=products.flatMap(p=>[...(p.sourceByYear?.[period]?.grossProfit||[]),...(p.sourceByYear?.[period]?.revenue||[])]);
    const publishedMarginSources=multiple?(finite(publishedMargin)?publishedRows.flatMap(r=>[...(r.source?.grossMargin||[]),...(r.source?.revenue||[])]):[]):published?.source?.grossMargin||[];
    const result={period,category,kind:kind(period),revenue,revenueTarget:target,target,units,grossProfit,grossMargin:margin,rawMargin,publishedMargin,marginBasis:finite(publishedMargin)?(multiple?'Revenue-weighted category published GM (adjusted)':'Published workbook GM (adjusted)'):'Product GM dollars / revenue',tam:sum(tamRows.map(r=>r.values[period])),npi:sum(npiRows.map(r=>r.revenue)),budget,tooling:sum(spending.filter(r=>/tooling/i.test(r.group||r.type)).map(r=>r.amount)),rnd:sum(spending.filter(r=>!/tooling|compliance/i.test(r.group||r.type)).map(r=>r.amount)),compliance:sum(spending.filter(r=>/compliance/i.test(r.group||r.type)).map(r=>r.amount)),productCount:products.length,activeProductCount:products.filter(p=>finite(p.revenueByYear[period])&&p.revenueByYear[period]!==0).length,npiCount:new Set(npiRows.map(r=>r.productId)).size,yoy:{revenue:finite(revenue)&&finite(previous)&&previous!==0?revenue/previous-1:null},gap:finite(revenue)&&finite(target)?revenue-target:null,attainment:ratio(revenue,target),source:{revenue:products.flatMap(p=>p.sourceByYear?.[period]?.revenue||[]),revenueTarget:multiple?(finite(target)?publishedRows.flatMap(r=>r.source?.target||[]):[]):published?.source?.target||[],grossMargin:finite(publishedMargin)?publishedMarginSources:rawMarginSources,rawMargin:rawMarginSources,budget:spending.flatMap(r=>r.source||[]),tam:tamRows.flatMap(r=>r.sourceByYear?.[period]||[]),npi:npiRows.flatMap(r=>r.source||[])}};
    return result;
  }
  function series(metric,options={}) {
    if(options.groupId||options.projectId||options.skuId)return drilldown(options).metricSeries[metric]||[];
    return data().periods.map(period=>{const a=summarize({...options,period});return {period,value:a[metric]??null,kind:kind(period),source:a.source[metric]||[],target:metric==='revenue'?a.revenueTarget:null};});
  }
  function compareSeries(metric,options={}) {
    const scope=categoryOf(options),categories=Array.isArray(scope)?scope:[scope];
    const percentage=['grossMargin','rawMargin','marketShare','publishedMargin','attainment'].includes(metric);
    const traces=categories.map(category=>({category,series:series(metric,{...options,categories:undefined,category}).map(point=>({...point,rawValue:point.value}))}));
    const values={mode:'values',basePeriod:null,indexed:false,unit:percentage?'percent':'currency',traces};
    if(percentage||traces.length<2||options.mode==='values')return values;
    const periods=[...data().periods].sort((a,b)=>Number(a)-Number(b));
    const basePeriod=periods.find(period=>traces.every(trace=>{
      const value=trace.series.find(point=>String(point.period)===String(period))?.rawValue;
      return finite(value)&&value>0;
    }));
    if(basePeriod===undefined)return {...values,reason:'Trend comparison needs a shared year with a positive source value in every selected category. Showing source values instead.'};
    return {mode:'trend',basePeriod,indexed:true,unit:'index',traces:traces.map(trace=>{
      const baseline=trace.series.find(point=>String(point.period)===String(basePeriod)).rawValue;
      return {...trace,series:trace.series.map(point=>({...point,value:finite(point.rawValue)?point.rawValue/baseline*100:null}))};
    })};
  }
  function compareDrillSeries(metric,options={}) {
    const requested=options.compareIds;
    if(requested===undefined||requested===null||(Array.isArray(requested)&&!requested.length))return null;
    const reject=reason=>({active:false,invalid:true,traces:[],selectionSummary:null,selectionSeries:[],selectionMetricSeries:{},selectedChildren:[],indexed:false,basePeriod:null,mode:'values',unit:metric==='units'?'number':['grossMargin','rawMargin','marketShare'].includes(metric)?'percent':'currency',reason,notice:reason,coverage:{invalidSelection:true}});
    if(!Array.isArray(requested)||requested.length>50||requested.some(id=>typeof id!=='string'||!id.length||id.length>240||/[\u0000-\u001f\u007f]/.test(id)))return reject('Choose up to 50 valid sibling products, projects or SKUs to compare.');
    const ids=[...new Set(requested)],parent=drilldown(options),expected={category:'group',group:'project',project:'sku'}[parent.scope.level];
    if(!expected||parent.coverage.invalidScope)return reject('Choose comparison items from a valid parent group or project.');
    const children=[];
    for(const id of ids){const matches=parent.children.filter(child=>child.id===id);if(matches.length!==1||matches[0].level!==expected)return reject('A comparison item is unavailable or ambiguous in the current scope. Choose the visible sibling items again.');children.push(matches[0]);}
    if(ids.length>1&&ids.includes('source-unmapped'))return reject('Unmapped tracker records cannot be combined with product-group finance because their source populations may overlap.');
    const models=children.map(child=>drilldown({...options,categories:undefined,category:child.category,groupId:child.groupId,projectId:child.projectId,skuId:child.skuId}));
    if(models.some(model=>model.coverage.invalidScope))return reject('The selected source identities could not be matched safely.');
    const ratios=['grossMargin','rawMargin','marketShare','publishedMargin','attainment'],percentage=ratios.includes(metric),metricKey=metric==='rawMargin'?'grossMargin':metric;
    const periods=[...new Set(models.flatMap(model=>Object.values(model.metricSeries).flatMap(points=>points.map(point=>point.period))))].sort((a,b)=>Number(a)-Number(b));
    const at=(model,key,year)=>model.metricSeries[key]?.find(point=>String(point.period)===String(year));
    const aggregate=(key,year)=>{
      const margin=key==='grossMargin'||key==='rawMargin';
      const points=models.map(model=>at(model,margin?'grossProfit':key,year)),revenues=margin?models.map(model=>at(model,'revenue',year)):[];
      const present=points.map((point,i)=>finite(point?.value)&&(!margin||finite(revenues[i]?.value)));
      const complete=present.every(Boolean),numerator=complete?sum(points.map(point=>point.value)):null,denominator=margin&&complete?sum(revenues.map(point=>point.value)):null;
      const source=points.flatMap((point,i)=>[...(point?.source||[]),...(margin?revenues[i]?.source||[]:[])]);
      const kinds=[...new Set(points.map(point=>point?.kind).filter(Boolean))];
      return {period:year,value:margin?ratio(numerator,denominator):numerator,kind:key==='budget'?'source-investment':kinds.includes('unclassified')?'unclassified':kinds.length===1?kinds[0]:kind(year),source,basis:margin?'Selected sibling gross-profit dollars / selected sibling revenue':key==='budget'?'Selected sibling source PD investment by fiscal year; not verified actual cash spend':'Combined selected sibling source values; every selected item must have a numeric observation',coverage:{selectedCount:ids.length,availableCount:present.filter(Boolean).length,missingCount:present.filter(value=>!value).length,missingIds:ids.filter((id,i)=>!present[i]),complete}};
    };
    const selectionMetricSeries=Object.fromEntries(['revenue','grossProfit','grossMargin','rawMargin','units','budget'].map(key=>[key,periods.map(year=>aggregate(key,year))]));
    const period=periodOf(options),summaryPoints=Object.fromEntries(Object.keys(selectionMetricSeries).map(key=>[key,aggregate(key,period)]));
    const coverage={invalidSelection:false,selectedCount:ids.length,selectedIds:[...ids],parentLevel:parent.scope.level,level:expected,needsReimport:models.some(model=>model.coverage.needsReimport),sourceGrainVersion:Math.min(...models.map(model=>model.coverage.sourceGrainVersion)),missingByMetric:Object.fromEntries(Object.entries(summaryPoints).map(([key,point])=>[key,point.coverage.missingCount])),completeByMetric:Object.fromEntries(Object.entries(summaryPoints).map(([key,point])=>[key,point.coverage.complete])),missingIdsByMetric:Object.fromEntries(Object.entries(summaryPoints).map(([key,point])=>[key,point.coverage.missingIds]))};
    const categories=[...new Set(models.map(model=>model.scope.category).flat())],previous=aggregate('revenue',period-1).value;
    const selectionSummary={period,category:categories.length===1?categories[0]:categories,kind:summaryPoints.revenue.kind,basis:'Combined selected sibling source values; incomplete selected observations remain unavailable',marginBasis:'Selected sibling gross-profit dollars / selected sibling revenue',coverage,source:Object.fromEntries(Object.entries(summaryPoints).map(([key,point])=>[key,point.source])),...Object.fromEntries(Object.entries(summaryPoints).map(([key,point])=>[key,point.value])),publishedMargin:null,revenueTarget:null,target:null,tam:null,npi:null,gap:null,attainment:null,productCount:expected==='group'?ids.length:0,projectCount:expected==='project'?ids.length:new Set(models.map(model=>model.scope.projectId).filter(Boolean)).size,skuCount:expected==='sku'?ids.length:0,yoy:{revenue:finite(summaryPoints.revenue.value)&&finite(previous)&&previous!==0?summaryPoints.revenue.value/previous-1:null}};
    const traces=models.map((model,i)=>({id:ids[i],label:expected==='group'?children[i].name:children[i].id,category:children[i].category,scope:{...model.scope},series:(model.metricSeries[metricKey]||periods.map(period=>({period,value:null,kind:'unclassified',source:[],basis:'No scoped source is available for this metric.'}))).map(point=>({...point,rawValue:point.value})),...(metric==='revenue'?{estimateSeries:model.estimateSeries.map(point=>({...point,rawValue:point.value}))}:{})}));
    const values={active:true,invalid:false,traces,selectedChildren:children.map(child=>({...child})),selectionSummary,selectionMetricSeries,selectionSeries:selectionMetricSeries[metric]||periods.map(year=>aggregate(metric,year)),coverage,indexed:false,basePeriod:null,mode:'values',unit:percentage?'percent':metric==='units'?'number':'currency',notice:`Comparing ${ids.length} selected ${expected==='group'?'product groups':expected==='project'?'projects':'SKUs'}. Combined figures require a numeric source observation for every selected item.${expected==='sku'?' Project investment and estimates are not allocated to these SKUs.':''}`};
    if(percentage||traces.length<2||options.mode==='values')return values;
    const basePeriod=periods.find(year=>traces.every(trace=>{const point=trace.series.find(point=>String(point.period)===String(year));return finite(point?.rawValue)&&point.rawValue>0;}));
    if(basePeriod===undefined)return {...values,reason:'Trend comparison needs a shared year with a positive source value in every selected item. Showing source values instead.'};
    return {...values,indexed:true,basePeriod,mode:'trend',unit:'index',traces:traces.map(trace=>{
      const base=trace.series.find(point=>String(point.period)===String(basePeriod));
      return {...trace,baseline:{period:basePeriod,value:base.rawValue,source:base.source},series:trace.series.map(point=>({...point,value:finite(point.rawValue)?point.rawValue/base.rawValue*100:null})),...(trace.estimateSeries?{estimateSeries:trace.estimateSeries.map(point=>({...point,value:finite(point.rawValue)?point.rawValue/base.rawValue*100:null}))}:{})};
    })};
  }
  function productRows(options={}) {
    const period=periodOf(options),d=data();
    return selected(d.products,categoryOf(options)).map(p=>{const revenue=p.revenueByYear[period],grossProfit=p.gmByYear[period];const cases=(d.npiValues||[]).filter(v=>v.name===p.name&&canonical(v.category)===canonical(p.category));const value=cases.length===1?cases[0]:null;return {...p,revenue,units:p.unitsByYear[period],grossProfit,grossMargin:ratio(grossProfit,revenue),gm:ratio(grossProfit,revenue),revenueGrowth:finite(revenue)&&finite(p.revenueByYear[period-1])&&p.revenueByYear[period-1]!==0?revenue/p.revenueByYear[period-1]-1:null,roi:value?.roi??null,signal:value?.signal??null,roiBand:value?.roiBand??null,npiValue:value,npiCases:cases,roiMatchStatus:cases.length>1?'Multiple project cases':cases.length===1?'Unique project case':'No matching case',source:p.sourceByYear?.[period]?.revenue||p.source};}).sort((a,b)=>(b.revenue||0)-(a.revenue||0));
  }
  function scenario(options={}) {
    const driver=key=>{const x=options[key]??0;const n=Number(x);if(!Number.isFinite(n))throw new Error('Enter a valid numeric scenario assumption.');return n;};
    const comparison=compareDrillSeries('revenue',options);
    if(comparison?.invalid)throw new Error(comparison.reason);
    const baseline=comparison?.selectionSummary||summarize(options),growth=driver('revenueGrowth')/100,marginChange=driver('marginChange')/100,budgetChange=driver('budgetChange')/100;
    const revenue=finite(baseline.revenue)?baseline.revenue*(1+growth):null;
    const grossMargin=finite(baseline.grossMargin)?baseline.grossMargin+marginChange:null;
    const grossProfit=finite(revenue)&&finite(grossMargin)?revenue*grossMargin:null,budget=finite(baseline.budget)?baseline.budget*(1+budgetChange):null;
    return {...baseline,baseline,revenue,grossMargin,grossProfit,budget,revenueDelta:finite(revenue)?revenue-baseline.revenue:null,profitDelta:finite(grossProfit)&&finite(baseline.revenue)&&finite(baseline.grossMargin)?grossProfit-baseline.revenue*baseline.grossMargin:null,budgetDelta:finite(budget)?budget-baseline.budget:null,netContribution:finite(grossProfit)&&finite(budget)?grossProfit-budget:null,attainment:ratio(revenue,baseline.revenueTarget),kind:'scenario',label:'Illustrative one-year driver scenario',assumptions:{revenueGrowth:options.revenueGrowth||0,marginChange:options.marginChange||0,budgetChange:options.budgetChange||0}};
  }
  function forecast(metric,options={}) {
    return {method:'Workbook projection',label:'Existing source forecast. No statistical prediction fitted to planned values.',values:series(metric,options).filter(p=>p.kind==='projection'),statisticalModelAvailable:false};
  }
  function projectScenario(options={}) {
    const product=data().products.find(p=>p.id===options.productId);
    if(!product)return null;
    const fraction=Math.min(12,Math.max(0,Number(options.delayMonths||0)))/12;
    const cancelled=options.action==='cancel';
    return data().periods.filter(y=>y>=2026).map(period=>{const baseline=product.revenueByYear[period],previous=product.revenueByYear[period-1];const value=finite(baseline)?cancelled?0:baseline*(1-fraction)+(period>2026&&finite(previous)?previous*fraction:0):null;return {period,baseline,value,delta:finite(value)&&finite(baseline)?value-baseline:null,kind:'scenario',method:'Approximate annual shift with uniform monthly allocation; no workbook fiscal timing or cost rescheduling parity'};});
  }
  root.HX_ANALYTICS={normalizeWorkbook,summarize,series,compareSeries,compareDrillSeries,drilldown,productRows,scenario,forecast,projectScenario,canonical,sum,ratio};
})(typeof window!=='undefined'?window:globalThis);
