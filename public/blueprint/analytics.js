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
      const matches = context.filter(c => String(c.GroupName||'').trim().toLowerCase() === String(p.name||'').trim().toLowerCase());
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
    return {source:{...raw.source,name:raw.source?.name||raw.source?.fileName||'HX Blueprint',currency:'USD',unit:'USD unless indicated',basis:'Saved workbook planning snapshot; formula caches are not recalculated'},periods,categories:[...new Set(products.map(p=>p.category))].sort(),products,published,investments,npi,tam,npiValues,decisions,sheets,quality:{issues,postPorDiagnostic},metrics:{}, fiscalCalendar:'FY Q1 Nov–Jan; Q2 Feb–Apr; Q3 May–Jul; Q4 Aug–Oct',actualsCutoff:value('NPI_Trend','S19'),recordCounts:{products:products.length,combinedProducts:context.length,spendEntries:investments.length,npiQuarterGroups:npi.length,npiSourceRows:rows('NPI_Tracker_All').length}};
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
  function summarize(options={}) {
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
  function productRows(options={}) {
    const period=periodOf(options),d=data();
    return selected(d.products,categoryOf(options)).map(p=>{const revenue=p.revenueByYear[period],grossProfit=p.gmByYear[period];const cases=(d.npiValues||[]).filter(v=>v.name===p.name&&canonical(v.category)===canonical(p.category));const value=cases.length===1?cases[0]:null;return {...p,revenue,units:p.unitsByYear[period],grossProfit,grossMargin:ratio(grossProfit,revenue),gm:ratio(grossProfit,revenue),revenueGrowth:finite(revenue)&&finite(p.revenueByYear[period-1])&&p.revenueByYear[period-1]!==0?revenue/p.revenueByYear[period-1]-1:null,roi:value?.roi??null,signal:value?.signal??null,roiBand:value?.roiBand??null,npiValue:value,npiCases:cases,roiMatchStatus:cases.length>1?'Multiple project cases':cases.length===1?'Unique project case':'No matching case',source:p.sourceByYear?.[period]?.revenue||p.source};}).sort((a,b)=>(b.revenue||0)-(a.revenue||0));
  }
  function scenario(options={}) {
    const driver=key=>{const x=options[key]??0;const n=Number(x);if(!Number.isFinite(n))throw new Error('Enter a valid numeric scenario assumption.');return n;};
    const baseline=summarize(options),growth=driver('revenueGrowth')/100,marginChange=driver('marginChange')/100,budgetChange=driver('budgetChange')/100;
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
  root.HX_ANALYTICS={normalizeWorkbook,summarize,series,compareSeries,productRows,scenario,forecast,projectScenario,canonical,sum,ratio};
})(typeof window!=='undefined'?window:globalThis);
