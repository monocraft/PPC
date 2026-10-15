/* Task entry points reuse existing import, review and save boundaries. */
(function (root) {
  'use strict';
  if (!root.document || !root.PortfolioWorkflowModel) return;
  const doc = root.document, node = (tag, cls, text) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
  const button = (label, action, cls = '') => { const el = node('button', cls, label); el.type = 'button'; el.addEventListener('click', action); return el; };
  const announce = text => { const status = doc.getElementById('workflowAnnouncement'); if (status) status.textContent = text; };
  function dialog(title, id) {
    const el = node('dialog', 'workflow-dialog'); el.id = id;
    const heading = node('header', 'workflow-heading'), name = node('h2', '', title); name.id = id + '-title'; el.setAttribute('aria-labelledby', name.id);
    const close = button('×', () => el.close(), 'workflow-close'); close.setAttribute('aria-label', 'Close ' + title);
    heading.append(name, close); const body = node('div', 'workflow-body'); el.append(heading, body); doc.body.append(el);
    let origin; el.addEventListener('close', () => { if (origin?.isConnected) origin.focus({ preventScroll: true }); });
    return { el, body, open() { origin = doc.activeElement; if (!el.open) el.showModal(); } };
  }
  const purposes = [
    ['plc', 'Update project milestones', 'PLC workbook · retain source dates and review uncertain updates'],
    ['ascm', 'Update the product catalog', 'ASCM workbook · preview product additions and updates'],
    ['planning', 'Review planning candidates', 'Planning XLSX or CSV · match, create or ignore proposals'],
    ['retail', 'Analyze retail performance', 'Retail workbook, CSV or protected analytics backup · separate local source'],
    ['blueprint', 'Analyze the portfolio plan', 'Blueprint workbook · separate local source and scenarios'],
    ['package', 'Open a complete portfolio backup', 'PKG · replaces products, images and workspace settings after review'],
    ['data', 'Open a portfolio data backup', 'DATA or JSON · replaces workspace data; image files are separate'],
  ];
  async function analyticsFile(file, kind) {
    root.PPCAnalyticsWorkspace.switchModule(kind === 'blueprint' ? 'blueprint' : 'retail');
    if (kind === 'retail') {
      await root.PPCSelloutDashboard.ready;
      const result = await root.PPCSelloutDashboard.readImport(file);
      if (!result) throw Error('The retail source was not applied. Review the import message; your previous source remains available.');
      return result;
    }
    if (file.size > 40 * 1024 * 1024) throw Error('Blueprint workbooks must be no larger than 40 MiB.');
    const frame = doc.getElementById('blueprintFrame');
    if (!frame.contentWindow?.HX_DASHBOARD) await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); frame.removeEventListener('load', ready); resolve(); };
      const ready = () => { if (frame.contentWindow?.HX_DASHBOARD) done(); else { clearTimeout(timer); reject(Error('Portfolio plan is not ready. Try Load data again.')); } };
      const timer = setTimeout(() => { frame.removeEventListener('load', ready); reject(Error('Portfolio plan took too long to open. Your source was kept.')); }, 20000);
      frame.addEventListener('load', ready, { once: true });
    });
    await frame.contentWindow.HX_SOURCE_READY;
    const result = await frame.contentWindow.HX_DASHBOARD.importFile(file);
    if (result?.status !== 'applied') throw Error(result?.message || 'The Blueprint source was not applied. Your prior source was kept.');
    return result;
  }
  function handoff(file, kind) {
    const token = root.crypto.randomUUID(), url = new URL('analytics.html', root.location.href);
    url.searchParams.set('analysis', kind === 'blueprint' ? 'blueprint' : 'retail'); url.searchParams.set('loadRequest', token);
    const target = root.open(url.href, '_blank');
    if (!target) throw Error('Allow this site to open Analytics, then try Load data again.');
    return new Promise((resolve, reject) => {
      let sent = false;
      const cleanup = () => { clearTimeout(timer); root.removeEventListener('message', receive); };
      const receive = event => {
        if (event.origin !== root.location.origin || event.source !== target || event.data?.token !== token) return;
        if (event.data.type === 'ppc:load:ready' && !sent) { sent = true; target.postMessage({ type: 'ppc:load:file', token, kind, file }, root.location.origin); }
        if (event.data.type === 'ppc:load:result' && sent) { cleanup(); event.data.ok ? resolve(event.data.result) : reject(Error(event.data.message || 'Analytics could not load this source.')); }
      };
      const timer = setTimeout(() => { cleanup(); reject(Error('The Analytics handoff expired. Open Load data in Analytics to select the file again.')); }, 120000);
      root.addEventListener('message', receive);
    });
  }
  const load = dialog('Load data', 'workflowLoadDialog');
  let selectedFile = null, loading = false, loadGeneration = 0;
  const description = node('p', 'workflow-note', 'Choose a file, then confirm its purpose. Your current portfolio and analysis sources stay separate.');
  const fileInput = node('input'); fileInput.type = 'file'; fileInput.id = 'workflowFile'; fileInput.accept = '.xlsx,.xlsm,.csv,.tsv,.json,.data,.pkg'; fileInput.setAttribute('aria-label', 'Choose a source file');
  const result = node('p', 'workflow-feedback'); result.setAttribute('role', 'status');
  const choices = node('div', 'workflow-choices');
  const privacy = node('p', 'workflow-note', 'Files are read on this device. Opening a backup can replace working data; that destination keeps its existing review and replacement safeguards.');
  function renderChoices(suggested = []) {
    choices.replaceChildren();
    for (const [kind, title, help] of purposes) {
      const action = button('', async () => {
        if (loading || !selectedFile) return;
        const file = selectedFile; loading = true; renderChoices(suggested); result.textContent = 'Opening ' + title.toLowerCase() + '…';
        try {
          load.el.close();
          if (kind === 'planning') { await planning?.open(file); }
          else if (['retail', 'blueprint'].includes(kind)) {
            const outcome = root.PPCAnalyticsWorkspace ? await analyticsFile(file, kind) : await handoff(file, kind);
            announce(outcome?.status === 'review' ? 'Source opened for review in Analytics.' : 'Analytics source loaded.');
          } else if (root.PortfolioWorkflowAdapter) await root.PortfolioWorkflowAdapter.loadFile(file, kind);
          else { const url = new URL('index.html', root.location.href); announce('Open Portfolio to load portfolio records or backups.'); root.location.assign(url.href); }
        } catch (error) { result.textContent = error.message; load.open(); }
        finally { loading = false; renderChoices(suggested); }
      }, suggested.includes(kind) ? 'workflow-choice is-suggested' : 'workflow-choice');
      action.disabled = loading || !selectedFile || !root.PortfolioWorkflowAdapter && !['retail', 'blueprint'].includes(kind);
      action.append(node('strong', '', title), node('small', '', help)); choices.append(action);
    }
  }
  fileInput.addEventListener('change', async () => {
    const generation = ++loadGeneration; selectedFile = fileInput.files?.[0] || null; result.textContent = selectedFile ? 'Identifying file…' : ''; renderChoices();
    if (!selectedFile) return;
    try { const identity = await root.PortfolioWorkflowModel.identifyFile(selectedFile); if (generation !== loadGeneration) return; result.textContent = identity.explanation; renderChoices(identity.suggested); }
    catch (error) { if (generation !== loadGeneration) return; selectedFile = null; result.textContent = error.message; renderChoices(); }
  });
  load.body.append(description, fileInput, result, choices, privacy); renderChoices();
  const loadButton = doc.getElementById('loadDataButton') || doc.getElementById('analyticsLoadData');
  loadButton?.addEventListener('click', () => { load.open(); });
  doc.getElementById('emptyLoadData')?.addEventListener('click',()=>load.open());
  let planning = null;

  function portfolioFeatures() {
    const adapter = root.PortfolioWorkflowAdapter; if (!adapter) return;
    doc.documentElement.classList.add('workflow-enhanced');
    const settings = doc.getElementById('workspaceSettingsButton'); if (settings) doc.getElementById('workflowSettingsSlot')?.append(settings);
    const strip = node('div','workflow-status-strip'), statusButton = button('Opening workspace…',()=>adapter.getStatus().localError ? root.PortfolioNotifications.show('workspace-local-save') : root.PortfolioMasterUI.openUpdates());
    statusButton.id='workflowStatus'; statusButton.setAttribute('aria-live','polite'); strip.append(statusButton); doc.querySelector('.topbar')?.after(strip);
    planning = root.PortfolioPlanningIntakeUI?.create({ getPortfolio: adapter.getPortfolio, applyPlanning: adapter.applyPlanning, openProduct: adapter.openProduct, onStateChange: () => root.dispatchEvent(new CustomEvent('portfolio:planning-review')) });
    const review = dialog('Needs review', 'workflowReviewDialog'), protection = dialog('Date evidence and protection', 'workflowProtectionDialog');
    const reviewSearch = node('input'); reviewSearch.type = 'search'; reviewSearch.placeholder = 'Find a product or issue'; reviewSearch.setAttribute('aria-label', 'Filter review items');
    const reviewFilter = node('select'); reviewFilter.setAttribute('aria-label', 'Review issue type');
    for (const [value, title] of [['attention','Action needed'],['missing','Missing dates'],['stale','Stale evidence'],['images','Image completeness'],['deferred','Deferred']]) { const option = node('option', '', title); option.value = value; reviewFilter.append(option); }
    const reviewList = node('div', 'workflow-review-list');
    const actions = node('div', 'workflow-actions');
    actions.append(button('PLC source review', () => { review.el.close(); adapter.openPlcReview(); }), button('Planning candidates', () => { review.el.close(); planning?.open(); }), button('Date evidence & protection', () => { review.el.close(); openProtection(); }), button('Portfolio plan source diagnostics', () => { review.el.close(); root.open(new URL('analytics.html?analysis=blueprint#blueprint/source',root.location.href).href,'_blank','noopener'); }), button('All messages', () => { review.el.close(); root.PortfolioNotifications.show(); }));
    review.body.append(node('p', 'workflow-note', 'Review business exceptions first. Completeness indicators are separate; a missing image is not a business conflict.'), actions, reviewFilter, reviewSearch, reviewList);
    const deferKey = 'ppc-review-deferrals-v1'; let deferrals = {};
    try { const raw = root.localStorage.getItem(deferKey); const parsed = raw && raw.length <= 262144 ? JSON.parse(raw) : null; if (parsed?.version === 1 && parsed.items && typeof parsed.items === 'object' && !Array.isArray(parsed.items)) deferrals = Object.fromEntries(Object.entries(parsed.items).filter(([id, value]) => id.length < 500 && typeof value === 'string' && value.length <= 16384).slice(0, 500)); } catch (_) {}
    function items() {
      const portfolio = adapter.getPortfolio(), all = [];
      const pendingPlanning=planning?.getState();
      if(pendingPlanning?.rowCount)all.push({id:'planning:current',type:'attention',title:`${pendingPlanning.rowCount} planning candidates`,detail:'Finish the current match, create or ignore decisions. Nothing is accepted until you apply the reviewed choices.',fingerprint:JSON.stringify([pendingPlanning.source?.fingerprint,pendingPlanning.source?.sheet,pendingPlanning.rowCount]),open:()=>planning.open()});
      for (const item of root.PortfolioNotifications.getState().items.filter(item => ['warning','error'].includes(item.severity) && !item.acknowledged)) all.push({ id: 'message:' + item.id, type: 'attention', title: item.title, detail: item.message, fingerprint: JSON.stringify([item.title,item.message,item.revision]), urgent: item.severity === 'error' || item.dismissible === false, open: () => item.actions[0]?.onClick ? item.actions[0].onClick() : root.PortfolioNotifications.show(item.id) });
      for (const entry of portfolio.plcReview?.entries || []) all.push({ id: 'plc:' + entry.key, type: 'attention', title: entry.row?.name || entry.row?.codename || 'PLC project match', detail: entry.matchNeeded ? 'Match this source project to a product.' : 'Review source dates: ' + (entry.fields || []).map(field => root.PLCImporter.fieldLabels[field]).join(', '), fingerprint: JSON.stringify([entry.metadata?.fingerprint,entry.fields,entry.row?.dates]), open: () => adapter.openPlcReview() });
      for (const category of portfolio.categories) for (const product of category.board.products) {
        const open = () => adapter.openProduct(product.id), name = product.name || 'Unnamed product';
        if (!product.ffsDate && ['in-planning','in-development'].includes(product.roadmap?.status)) all.push({ id: 'missing:' + product.id, type: 'missing', title: name, detail: 'FFS timing is not supplied. Review its source before adding a date.', fingerprint: JSON.stringify([product.id,product.ffsDate,product.plc?.fields?.ffsDate]), open });
        if (root.PLCImporter.freshness(product.plc || {}).status === 'overdue') all.push({ id: 'stale:' + product.id, type: 'stale', title: name, detail: 'Project evidence is older than the regular source cycle. Open the product or collect a newer report.', fingerprint: JSON.stringify([product.plc?.reportDate,product.plc?.importedAt]), open });
        if (!product.imageAssetId && !product.imageUrl) all.push({ id: 'image:' + product.id, type: 'images', title: name, detail: 'No assigned main image. Unavailable or ambiguous artwork may remain unchanged.', fingerprint: JSON.stringify([product.imageAssetId,product.imageUrl,product.variantGroups?.map(group => group.items.map(item => item.imageAssetId))]), open });
      }
      return all;
    }
    function renderReview() {
      const all = items(), query = reviewSearch.value.trim().toLowerCase(), type = reviewFilter.value;
      const filtered = all.filter(item => (type === 'deferred' ? deferrals[item.id] === item.fingerprint : item.type === type && deferrals[item.id] !== item.fingerprint) && (item.title + ' ' + item.detail).toLowerCase().includes(query));
      reviewList.replaceChildren(node('p', 'workflow-note', `${filtered.length} item${filtered.length === 1 ? '' : 's'} in this view`));
      for (const item of filtered.slice(0, reviewLimit)) {
        const card = node('article', 'workflow-review-item'), text = node('div'); text.append(node('strong','',item.title),node('p','',item.detail));
        card.append(text, button('Review', () => { review.el.close(); try { item.open(); } catch (error) { announce(error.message); } }));
        if (!item.urgent) card.append(button(type === 'deferred' ? 'Restore' : 'Defer', () => {
          const next = { ...deferrals }; if (type === 'deferred') delete next[item.id]; else next[item.id] = item.fingerprint;
          try { const entries = Object.entries(next).filter(([id,value])=>id.length<500 && value.length<=16384).slice(-500); if(type !== 'deferred' && item.fingerprint.length>16384) throw Error('Issue is too large to defer.'); let stored; while((stored=JSON.stringify({version:1,items:Object.fromEntries(entries)})).length>262144)entries.shift(); root.localStorage.setItem(deferKey,stored); deferrals = Object.fromEntries(entries); updateStatus(); }
          catch (_) { announce('This browser could not save the review preference. The issue remains visible.'); }
        }, 'quiet-button'));
        reviewList.append(card);
      }
      if(filtered.length>reviewLimit)reviewList.append(button(`Show more (${filtered.length-reviewLimit} remaining)`,()=>{reviewLimit+=150;renderReview();}));
      if (!filtered.length) reviewList.append(node('p','','No items in this view. You can still open source review or inspect date evidence.'));
    }
    let reviewLimit=150;
    reviewSearch.addEventListener('input', ()=>{reviewLimit=150;renderReview();}); reviewFilter.addEventListener('change', ()=>{reviewLimit=150;renderReview();});
    doc.getElementById('workflowReviewButton')?.addEventListener('click', () => { renderReview(); review.open(); });
    const select = node('select'); select.id = 'workflowProtectionProduct'; select.setAttribute('aria-label','Product for date evidence');
    const evidence = node('div', 'workflow-evidence'); protection.body.append(node('p','workflow-note','Protection applies to automatic imports on this browser and follows the product when it moves category. Teammates have independent settings. Manual edits remain available.'), select, evidence);
    function renderProtection() {
      const focusedField = evidence.contains(doc.activeElement) ? doc.activeElement.dataset?.protectionField : null;
      const portfolio = adapter.getPortfolio(), entries = portfolio.categories.flatMap(category => category.board.products.map(product => ({category,product}))), current = entries.find(entry => entry.product.id === select.value);
      evidence.replaceChildren(); if (!current) return;
      const state = root.PortfolioFieldProtection.getState();
      if (state.blocked) { evidence.append(node('p','workflow-error','Protection settings need repair. Automatic date changes are held.')); if (state.recovered) evidence.append(button('Restore verified previous protections', () => { try { root.PortfolioFieldProtection.repair(); renderProtection(); } catch (error) { announce(error.message); } })); }
      for (const field of root.PortfolioWorkflowModel.fields) {
        const data = current.product.plc?.fields?.[field], period = root.PortfolioDatePrecision?.currentPeriod(current.product, field), lock = root.PortfolioFieldProtection.check({categoryId:current.category.id,productId:current.product.id,field});
        const row = node('section','workflow-evidence-row'); row.append(node('strong','',root.PLCImporter.fieldLabels[field]));
        row.append(node('p','',period?.label || current.product[field] || 'Not supplied'));
        const source = data?.source?.kind === 'manual' || data?.sourceType === 'local' ? 'Manual entry' : data?.source?.kind === 'planning' ? 'Reviewed planning source' : data ? data.source?.sheet || data.sourceFile || 'Collected source' : 'Source not recorded';
        const age=root.PLCImporter.getFieldAge(current.product,field);
        row.append(node('small','',`${source} · ${period?.precision === 'quarter' ? 'Calendar quarter' : current.product[field] ? 'Exact day' : 'Unknown timing'}${data?.reportDate ? ' · Report ' + data.reportDate : ''}${age.observedAt ? ' · Observed '+new Date(age.observedAt).toLocaleDateString() : ' · Observation date not recorded'}${Number.isFinite(age.observedAgeDays) ? ' ('+age.observedAgeDays+' days ago)' : ''}${data?.supersededAt ? ' · Earlier evidence superseded' : ''}`));
        const label = node('label','workflow-lock'), input = node('input'); input.type = 'checkbox'; input.checked = lock.protected; input.disabled = lock.unavailable; input.dataset.protectionField = field;
        input.addEventListener('change', () => { try { root.PortfolioFieldProtection.set({categoryId:current.category.id,productId:current.product.id,field},input.checked); announce(input.checked ? 'Date protected on this browser.' : 'Protection released. Existing import rules apply.'); } catch (error) { input.checked = !input.checked; announce(error.message); } });
        label.append(input,node('span','','Protect from automatic replacement')); row.append(label); evidence.append(row);
      }
      if(focusedField)evidence.querySelector(`[data-protection-field="${focusedField}"]`)?.focus({preventScroll:true});
    }
    function openProtection() {
      const old = adapter.getSelectedProductId(); select.replaceChildren();
      for (const category of adapter.getPortfolio().categories) for (const product of category.board.products) { const option = node('option','',`${product.name} · ${category.name}`); option.value=product.id;select.append(option); }
      if ([...select.options].some(option => option.value === old)) select.value=old;
      renderProtection(); protection.open();
    }
    select.addEventListener('change',renderProtection);
    function updateStatus() {
      const state = adapter.getStatus(), summary = root.PortfolioWorkflowModel.statusText(state), status = doc.getElementById('workflowStatus');
      if (status) { status.textContent=summary.text; status.dataset.tone=summary.tone; status.title='Open team and complete package details'; }
      const count = items().filter(item=>item.type==='attention'&&deferrals[item.id]!==item.fingerprint).length;
      const trigger = doc.getElementById('workflowReviewButton'); if(trigger) trigger.textContent=`Needs review${count ? ' ('+count+')' : ''}`;
      if(review.el.open) renderReview(); if(protection.el.open) renderProtection();
    }
    const groups=[];
    function groupTools(container,targets,id) {
      if(!container||!targets.length||groups.some(group=>group.container===container))return;
      const menu=node('details','workflow-tool-options');menu.id=id;menu.append(node('summary','','View options'));const content=node('div');menu.append(content);
      const origins=targets.map(target=>{const marker=doc.createComment('workflow-control-position');target.before(marker);return {target,marker};});
      menu.addEventListener('toggle',()=>positionToolMenu(menu));
      container.append(menu);groups.push({container,menu,content,origins});
    }
    function positionToolMenu(menu) { if(root.innerWidth<=700)menu.style.setProperty('--workflow-menu-top',`${Math.max(12,Math.min(root.innerHeight-160,Math.ceil(menu.getBoundingClientRect().bottom)))}px`); }
    function arrangeTools() {
      const controls=doc.getElementById('roadmapControls');
      groupTools(controls,controls?[...controls.children].filter(child=>child.matches('.roadmap-interaction-mode,.roadmap-edit-controls,#toggleRoadmapDetails')).concat([...controls.querySelectorAll('.zoom-control')]):[],'workflowRoadmapOptions');
      const hashout=doc.querySelector('.hashout-toolbar');groupTools(hashout,hashout?[...hashout.querySelectorAll('.hashout-label-control,.hashout-windows-control')]:[],'workflowHashoutOptions');
      for(const group of [...groups]) {
        if(!group.container.isConnected){groups.splice(groups.indexOf(group),1);continue;}
        const narrow=root.innerWidth<=700;
        group.menu.hidden=!narrow;
        for(const {target,marker} of group.origins)if(narrow){if(target.parentElement!==group.content)group.content.append(target);}else if(marker.isConnected&&target.previousSibling!==marker)marker.after(target);
        if(!narrow)group.menu.open=false;
        else if(group.menu.open)positionToolMenu(group.menu);
      }
      if(controls&&!doc.getElementById('workflowRangeActions')) {
        const range=node('div','workflow-range-actions');range.id='workflowRangeActions';
        for(const [mode,label] of [['next','Next 24 months'],['selected','Selected product'],['all','Full range']])range.append(button(label,()=>{try{adapter.rangePreset(mode);}catch(error){announce(error.message);}}));
        controls.append(range);
      }
      const range=doc.getElementById('workflowRangeActions'),menu=doc.getElementById('workflowRoadmapOptions');
      if(range&&controls){const destination=root.innerWidth<=700&&menu?menu.lastElementChild:controls;if(range.parentElement!==destination)destination.append(range);}
    }
    root.addEventListener('resize',arrangeTools);root.addEventListener('portfolio:render',arrangeTools);arrangeTools();
    for(const type of ['portfolio:render','portfolio:master-status','portfolio:local-status','portfolio:protection-change','portfolio:planning-review']) root.addEventListener(type,updateStatus);
    let notificationRefreshQueued=false;
    root.PortfolioNotifications?.subscribe(()=>{if(notificationRefreshQueued)return;notificationRefreshQueued=true;Promise.resolve().then(()=>{notificationRefreshQueued=false;updateStatus();});});
    for(const action of doc.querySelectorAll('[data-workflow-range]')) action.addEventListener('click',()=>{try{adapter.rangePreset(action.dataset.workflowRange);}catch(error){announce(error.message);}});
    updateStatus();
    root.PortfolioWorkflowUI = Object.freeze({ openLoad:()=>load.open(),openReview(){renderReview();review.open();},openProtection,planning,getReviewItems:items,refresh:updateStatus });
  }
  if(root.PortfolioWorkflowAdapter) void Promise.resolve(root.PortfolioWorkspaceReady).then(portfolioFeatures).catch(()=>{});
  const request = new URL(root.location.href).searchParams.get('loadRequest');
  if(root.PPCAnalyticsWorkspace && root.opener && /^[a-f0-9-]{36}$/i.test(request || '')) {
    const owner=root.opener,url=new URL(root.location.href);url.searchParams.delete('loadRequest');root.history.replaceState(null,'',url);
    const receive=async event=>{
      if(event.origin!==root.location.origin||event.source!==owner||event.data?.type!=='ppc:load:file'||event.data.token!==request||!['retail','blueprint'].includes(event.data.kind)||!(event.data.file instanceof File))return;
      clearTimeout(timer);root.removeEventListener('message',receive);
      try{const result=await analyticsFile(event.data.file,event.data.kind);owner.postMessage({type:'ppc:load:result',token:request,ok:true,result},root.location.origin);}
      catch(error){announce(error.message);owner.postMessage({type:'ppc:load:result',token:request,ok:false,message:error.message},root.location.origin);}
    };
    const timer=setTimeout(()=>root.removeEventListener('message',receive),120000);root.addEventListener('message',receive);
    owner.postMessage({type:'ppc:load:ready',token:request},root.location.origin);
  }
})(globalThis);
