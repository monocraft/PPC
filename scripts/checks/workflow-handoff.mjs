import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const workflowSource = await readFile(new URL('../../public/js/workflow-ui.js', import.meta.url), 'utf8');
const retailSource = await readFile(new URL('../../public/js/sellout-dashboard.js', import.meta.url), 'utf8');
const blueprintSource = await readFile(new URL('../../public/blueprint/dashboard.js', import.meta.url), 'utf8');
const TOKEN = '9a4f6a21-30ef-4b7c-9a8b-a333ef04dd12';
const ORIGIN = 'https://portfolio.example.test';
class LocalFile { constructor(name, size = 42) { this.name = name; this.size = size; } }
const drain = async () => { for (let count = 0; count < 8; count++) await Promise.resolve(); };
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.events = new Map(); this.attrs = new Map(); this.dataset = {}; this.isConnected = true; this.open = false; this.textContent = ''; this.value = ''; this.classList = {add(){},remove(){}}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  addEventListener(type, callback, options = {}) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add({callback,once:Boolean(options.once)}); }
  removeEventListener(type, callback) { for (const record of this.events.get(type)||[]) if (record.callback===callback) this.events.get(type).delete(record); }
  async emit(type, event = {}) { for (const record of [...this.events.get(type)||[]]) { if (record.once) this.events.get(type).delete(record); await record.callback(event); } }
  showModal() { this.open = true; }
  close() { this.open = false; void this.emit('close'); }
  focus() {}
}
function fixture({analytics = false, owner = null, request = TOKEN, dashboard, blueprintWindow} = {}) {
  const body = new Element('body'), status = new Element(), frame = new Element('iframe'); status.id='workflowAnnouncement';frame.id='blueprintFrame';
  const nodes = new Map([[status.id,status],[frame.id,frame]]);
  const doc = {body,activeElement:null,createElement:tag=>new Element(tag),querySelector:()=>null,querySelectorAll:()=>[],getElementById(id){ if(nodes.has(id))return nodes.get(id);const find=node=>node.id===id?node:node.children.map(find).find(Boolean);return find(body)||null; }};
  frame.contentWindow = blueprintWindow || {}; let frameAssignments=0;
  Object.defineProperty(frame,'src',{get:()=>'/blueprint/index.html?embedded=1',set(){frameAssignments++;}});
  const events = new Map(), timers = new Map(), sent = [], opened = [], switched = []; let timerId = 0;
  const root = {
    document:doc,location:new URL(`${ORIGIN}/analytics.html${analytics?`?loadRequest=${request}`:''}`),opener:owner,
    crypto:{randomUUID:()=>TOKEN},PortfolioWorkflowModel:{identifyFile:async()=>({suggested:['retail'],explanation:'Choose the source destination.'})},
    addEventListener(type,callback){if(!events.has(type))events.set(type,new Set());events.get(type).add(callback);},
    removeEventListener(type,callback){events.get(type)?.delete(callback);},
    postMessage(message,origin){sent.push({message,origin});},
    open(url,target){opened.push({url,target});return root.popup;},
    history:{replaceState(_state,_title,url){root.location=new URL(url);}},
  };
  if(analytics){root.PPCAnalyticsWorkspace={switchModule:kind=>switched.push(kind)};root.PPCSelloutDashboard=dashboard||{ready:Promise.resolve(),readImport:async()=>({status:'review'})};}
  const context = {globalThis:root,File:LocalFile,URL,Promise,console,Error,Number,Set,Map,
    setTimeout(callback,milliseconds){const id=++timerId;timers.set(id,{callback,milliseconds});return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(workflowSource,context,{filename:'workflow-ui.js'});
  return {root,doc,frame,status,sent,opened,switched,timers,events,get frameAssignments(){return frameAssignments;},
    async message(data,{origin=ORIGIN,source=owner}={}){for(const callback of [...events.get('message')||[]])await callback({origin,source,data});},
    async choose(file,title){const input=doc.getElementById('workflowFile');input.files=[file];await input.emit('change');const dialog=doc.getElementById('workflowLoadDialog');const choices=dialog.children[1].children.find(node=>node.className==='workflow-choices');const action=choices.children.find(node=>node.children.some(child=>child.tagName==='strong'&&child.textContent===title));assert.ok(action,`Missing choice ${title}`);assert.equal(action.disabled,false);return action.emit('click');},
  };
}
function retailRuntime() {
  const controls = new Map([['sharepointDialog',new Element()],['workbookFile',new Element()]]), messages=[]; let unlocks=0;
  const root = {PortfolioPackage:{MAX_PACKAGE_BYTES:64*1024*1024}};
  const context = {root,$:id=>controls.get(id),privateFile:null,console,message:text=>messages.push(text),cancelSharepointLoad(){},openPrivate(mode){assert.equal(mode,'import');unlocks++;}};
  vm.createContext(context);
  const start=retailSource.indexOf('  let importRun = 0;'),end=retailSource.indexOf('  async function applySnapshot(',start);
  vm.runInContext(retailSource.slice(start,end),context);
  return {dashboard:{ready:Promise.resolve(),readImport:context.readImport},context,messages,get unlocks(){return unlocks;}};
}
function blueprintRuntime() {
  const previous={source:'PREVIOUS LOCAL WORKBOOK',products:[{id:'keep-me'}]}, controls=new Map(['import-button','source-badge','import-file'].map(id=>[id,new Element()]));
  const calls={validated:0,saved:0,notified:0,events:0}, messages=[];let failure=false;
  const window={HX_DATA:previous,HX_SOURCE_READY:Promise.resolve(),HX_IMPORT_FILE:async file=>({source:file.name,products:[{id:'new-source'}]}),
    HX_SOURCE_STORE:{validate(){calls.validated++;},async save(){calls.saved++;if(failure)throw Error('Fixture persistence rejected');}},dispatchEvent(){calls.events++;}};
  const context={window,importBusy:false,timelineControl:null,$:id=>controls.get(id.slice(1)),toast:text=>messages.push(text),hasSource:()=>Boolean(window.HX_DATA),notifyParent(){calls.notified++;},CustomEvent:class{constructor(type){this.type=type;}}};
  vm.createContext(context);
  const start=blueprintSource.indexOf('  async function importFile(file) {'),end=blueprintSource.indexOf("  document.addEventListener('click'",start);
  vm.runInContext(blueprintSource.slice(start,end),context);
  window.HX_DASHBOARD={importFile:context.importFile};
  return {window,previous,calls,messages,set fail(value){failure=value;}};
}

// Run the full sender controller through its real file/purpose UI, then inject protocol messages.
const sender=fixture(), target={postMessage(message,origin){target.sent.push({message,origin});},sent:[]};sender.root.popup=target;
const file=new LocalFile('retail.pkg');let finished=false;
const pending=sender.choose(file,'Analyze retail performance').then(()=>{finished=true;});await drain();
assert.equal(sender.opened.length,1);assert.equal(new URL(sender.opened[0].url).searchParams.get('loadRequest'),TOKEN);
const ready={type:'ppc:load:ready',token:TOKEN};
for(const identity of [{origin:'https://foreign.example.test',source:target},{source:{}},{source:target,data:{...ready,token:'wrong'}}]){
  await sender.message(identity.data||ready,identity);
}
await sender.message({type:'ppc:load:result',token:TOKEN,ok:true,result:{status:'applied'}},{source:target});
assert.equal(target.sent.length,0);assert.equal(finished,false,'A result before the authenticated ready handshake is ignored.');
await sender.message(ready,{source:target});await sender.message(ready,{source:target});
assert.equal(target.sent.length,1,'Repeated ready messages never resend the selected file.');assert.equal(target.sent[0].message.file,file);assert.equal(target.sent[0].origin,ORIGIN);
await sender.message({type:'ppc:load:result',token:TOKEN,ok:true,result:{status:'review',stage:'unlock'}},{source:target});await pending;
assert.equal(sender.status.textContent,'Source opened for review in Analytics.');assert.equal(sender.events.get('message').size,0);assert.equal(sender.timers.size,0);
await sender.message(ready,{source:target});assert.equal(target.sent.length,1,'A completed handoff cannot be replayed.');

const timeoutSender=fixture();timeoutSender.root.popup={postMessage(){}};
const timeoutPending=timeoutSender.choose(new LocalFile('retail.csv'),'Analyze retail performance');await drain();
assert.equal(timeoutSender.timers.size,1);[...timeoutSender.timers.values()][0].callback();await timeoutPending;
assert.equal(timeoutSender.events.get('message').size,0);assert.equal(timeoutSender.doc.getElementById('workflowLoadDialog').open,true);
assert.match(timeoutSender.doc.getElementById('workflowLoadDialog').children[1].children[2].textContent,/handoff expired/);

// Full receiver rejects foreign sources, wrong tokens, invalid files, wrong types and replay.
const owner={sent:[],postMessage(message,origin){this.sent.push({message,origin});}},retail=retailRuntime();
const receiver=fixture({analytics:true,owner,dashboard:retail.dashboard});
assert.equal(owner.sent[0].message.type,'ppc:load:ready');assert.equal(owner.sent[0].origin,ORIGIN);
assert.equal(receiver.root.location.searchParams.has('loadRequest'),false,'The one-use request token leaves the route before import.');
const loadMessage={type:'ppc:load:file',token:TOKEN,kind:'retail',file:new LocalFile('protected-analytics.pkg')};
for(const event of [
  {data:loadMessage,origin:'https://foreign.example.test',source:owner},
  {data:loadMessage,source:{}},
  {data:{...loadMessage,token:'wrong'}},
  {data:{...loadMessage,type:'unrecognized'}},
  {data:{...loadMessage,kind:'package'}},
  {data:{...loadMessage,file:{name:'spoof.pkg',size:2}}},
])await receiver.message(event.data,event);
assert.equal(retail.unlocks,0);assert.equal(owner.sent.length,1);assert.equal(receiver.events.get('message').size,1);
await receiver.message(loadMessage);
assert.equal(retail.unlocks,1,'The real Retail importer opens the encrypted package unlock flow.');
assert.equal(retail.context.privateFile,loadMessage.file);assert.equal(owner.sent.length,2);
assert.equal(owner.sent[1].message.ok,true);assert.equal(owner.sent[1].message.result.status,'review');assert.equal(owner.sent[1].message.result.stage,'unlock');
assert.equal(receiver.events.get('message').size,0);assert.equal(receiver.timers.size,0);
await receiver.message(loadMessage);assert.equal(retail.unlocks,1,'Replay cannot reopen or replace the source.');

const invalidTokenOwner={postMessage(){throw Error('Invalid requests must not signal ready');}};
const invalidToken=fixture({analytics:true,owner:invalidTokenOwner,request:'invalid-token'});assert.equal(invalidToken.events.get('message')?.size||0,0);

// Blueprint invokes its actual validate/save/activate function without replacing or reloading the frame.
for(const failure of [false,true]){
  const plan=blueprintRuntime();plan.fail=failure;
  const planOwner={sent:[],postMessage(message,origin){this.sent.push({message,origin});}};
  const planReceiver=fixture({analytics:true,owner:planOwner,blueprintWindow:plan.window});
  const retainedWindow=planReceiver.frame.contentWindow, retainedFrame=planReceiver.frame;
  await planReceiver.message({type:'ppc:load:file',token:TOKEN,kind:'blueprint',file:new LocalFile('planning.xlsx')});
  const result=planOwner.sent.at(-1).message;
  assert.equal(result.type,'ppc:load:result');assert.equal(result.ok,!failure);assert.equal(plan.calls.validated,1);assert.equal(plan.calls.saved,1);
  assert.equal(planReceiver.frame,retainedFrame);assert.equal(planReceiver.frame.contentWindow,retainedWindow);assert.equal(planReceiver.frameAssignments,0);
  if(failure){assert.equal(plan.window.HX_DATA,plan.previous,'Persistence failure retains the previous workbook object.');assert.equal(plan.calls.events,0);assert.match(result.message,/persistence rejected/);}
  else{assert.equal(result.result.status,'applied');assert.equal(plan.window.HX_DATA.source,'planning.xlsx');assert.equal(plan.calls.events,1);}
  assert.ok(planOwner.sent.every(entry=>entry.origin===ORIGIN));assert.equal(planReceiver.timers.size,0);
}
const largePlan=blueprintRuntime(),largeOwner={sent:[],postMessage(message){this.sent.push(message);}},large=fixture({analytics:true,owner:largeOwner,blueprintWindow:largePlan.window});
await large.message({type:'ppc:load:file',token:TOKEN,kind:'blueprint',file:new LocalFile('too-large.xlsx',40*1024*1024+1)});
assert.equal(largeOwner.sent.at(-1).ok,false);assert.match(largeOwner.sent.at(-1).message,/40 MiB/);assert.equal(largePlan.calls.saved,0);assert.equal(largePlan.window.HX_DATA,largePlan.previous);

// A newly opened planning frame waits for both its controller and its stored-source readiness.
const lazyPlan=blueprintRuntime(),lazyOwner={sent:[],postMessage(message){this.sent.push(message);}},lazy=fixture({analytics:true,owner:lazyOwner});
let releaseSource;lazyPlan.window.HX_SOURCE_READY=new Promise(resolve=>{releaseSource=resolve;});
const lazyPending=lazy.message({type:'ppc:load:file',token:TOKEN,kind:'blueprint',file:new LocalFile('lazy-plan.xlsx')});await drain();
assert.equal(lazyPlan.calls.saved,0);assert.equal(lazy.timers.size,1);assert.equal([...lazy.timers.values()][0].milliseconds,20000);
lazy.frame.contentWindow=lazyPlan.window;await lazy.frame.emit('load');await drain();
assert.equal(lazy.timers.size,0);assert.equal(lazyPlan.calls.saved,0,'Frame load alone does not race an unfinished stored-source restore.');
releaseSource();await lazyPending;assert.equal(lazyOwner.sent.at(-1).ok,true);assert.equal(lazyPlan.calls.saved,1);assert.equal(lazy.frameAssignments,0);
for(const timeout of [false,true]){
  const unavailableOwner={sent:[],postMessage(message){this.sent.push(message);}},unavailable=fixture({analytics:true,owner:unavailableOwner});
  const unavailablePending=unavailable.message({type:'ppc:load:file',token:TOKEN,kind:'blueprint',file:new LocalFile('unavailable.xlsx')});await drain();
  if(timeout){const [id,timer]=[...unavailable.timers][0];unavailable.timers.delete(id);timer.callback();}
  else await unavailable.frame.emit('load');
  await unavailablePending;
  assert.equal(unavailableOwner.sent.at(-1).ok,false);assert.match(unavailableOwner.sent.at(-1).message,timeout?/too long/:/not ready/);
  assert.equal(unavailable.timers.size,0,'A lazy-frame rejection clears its timer.');assert.equal(unavailable.frame.events.get('load').size,0,'Lazy-frame completion and timeout leave no listener.');
}

assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|sendBeacon\s*\(/.test(workflowSource),'The workflow controller performs no network calls.');
console.log('Workflow handoff checks passed: full sender/receiver UI, same-origin + exact-window + one-use token guards, invalid/replay/timeout cleanup, real Retail PKG unlock review and real Blueprint validation/persistence with retained source/frame, source readiness and lazy-frame rejection cleanup.');
