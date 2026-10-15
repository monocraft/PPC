import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {createGitPackageWriter,runIsolatedGit} from '../git-package-writer.mjs';
const codec=globalThis.PortfolioPackage,FILE='public/data/master_ppc.pkg',token='github_native_fixture_token_1234567890';
const hash=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'ppc-native-writer-tests-'));
const emptyConfig=path.join(root,'empty-config');await fs.writeFile(emptyConfig,'',{flag:'wx'});
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','HOME','USERPROFILE'].includes(k.toUpperCase())));
Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:emptyConfig,GIT_CONFIG_SYSTEM:emptyConfig,GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'Local fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Local fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'});
const git=(cwd,args,encoding='utf8')=>execFileSync('git',args,{cwd,env,encoding,stdio:['ignore','pipe','pipe'],windowsHide:true,maxBuffer:70*1024*1024});
const original=await codec.encrypt(Uint8Array.of(1,2,3),codec.generateKey()),replacement=await codec.encrypt(Uint8Array.of(4,5,6),codec.generateKey());
let sequence=0,fixtures=[];
async function fixture({failCleanup=false}={}){
 const base=path.join(root,String(++sequence)),remote=path.join(base,'remote.git'),seed=path.join(base,'seed');await fs.mkdir(base);await fs.mkdir(remote);await fs.mkdir(seed);
 git(remote,['init','--bare','--quiet']);git(seed,['init','--quiet']);await fs.mkdir(path.join(seed,'public/data'),{recursive:true});await fs.writeFile(path.join(seed,FILE),original);await fs.writeFile(path.join(seed,'keep.txt'),'initial code');
 git(seed,['add','.']);git(seed,['commit','--quiet','-m','Initial local fixture']);git(seed,['branch','-M','main']);git(seed,['remote','add','origin',remote]);git(seed,['push','--quiet','origin','main']);
 const commands=[],directories=new Set();let beforeFetch,beforePush,pushMode='',failBlob=false;
 const advance=async({code,pkg}={})=>{git(seed,['fetch','--quiet','origin','main']);git(seed,['reset','--hard','FETCH_HEAD']);if(code!==undefined)await fs.writeFile(path.join(seed,'keep.txt'),code);if(pkg)await fs.writeFile(path.join(seed,FILE),pkg);git(seed,['add','.']);git(seed,['commit','--quiet','-m','Concurrent local fixture']);git(seed,['push','--quiet','origin','main']);};
 const run=async request=>{
  const {args,cwd,env:childEnv}=request;commands.push(args);directories.add(path.dirname(cwd));
  assert.equal(childEnv.PPC_PACKAGE_KEY,undefined);assert.equal(childEnv.PPC_PUBLISHER_SECRET,undefined);assert.equal(childEnv.GITHUB_TOKEN,undefined);assert.equal(childEnv.GIT_TRACE,undefined);assert.equal(childEnv.GIT_CURL_VERBOSE,undefined);assert.equal(childEnv.UNRELATED_PRIVATE_FIXTURE,undefined);
  assert.equal(childEnv.GIT_CONFIG_NOSYSTEM,'1');assert.equal(childEnv.GIT_CONFIG_GLOBAL,path.join(path.dirname(cwd),'empty-config'));assert.equal(childEnv.GIT_CONFIG_SYSTEM,childEnv.GIT_CONFIG_GLOBAL);assert.equal(await fs.readFile(childEnv.GIT_CONFIG_GLOBAL,'utf8'),'');assert.equal(childEnv.GIT_TERMINAL_PROMPT,'0');
  assert.equal(childEnv.HOME,path.dirname(cwd));assert.equal(childEnv.USERPROFILE,path.dirname(cwd));assert.equal(childEnv.XDG_CONFIG_HOME,path.join(path.dirname(cwd),'xdg'));assert.equal(childEnv.APPDATA,undefined);assert.equal(childEnv.HTTP_PROXY,undefined);assert.equal(childEnv.HTTPS_PROXY,undefined);assert.equal(childEnv.SSL_CERT_FILE,undefined);
  assert.equal(childEnv.GIT_CONFIG_KEY_0,'credential.helper');assert.equal(childEnv.GIT_CONFIG_VALUE_0,'');assert.equal(childEnv.GIT_CONFIG_VALUE_2,'false');assert.equal(childEnv.GIT_CONFIG_KEY_3,'core.hooksPath');
  assert.equal(childEnv.GIT_CONFIG_KEY_1,'http.https://github.com/fixture/portfolio.git.extraheader');assert.ok(childEnv.GIT_CONFIG_VALUE_1.endsWith(Buffer.from(`x-access-token:${token}`).toString('base64')));
  assert.ok(!JSON.stringify(args).includes(token));assert.ok(!JSON.stringify(args).includes(childEnv.GIT_CONFIG_VALUE_1));
  if(args[0]==='remote'){assert.deepEqual(args,['remote','add','origin','https://github.com/fixture/portfolio.git']);return runIsolatedGit({...request,args:['remote','add','origin',remote]});}
  if(args[0]==='fetch'&&beforeFetch){const hook=beforeFetch;beforeFetch=null;await hook();}
  if(args[0]==='hash-object'&&failBlob)return{code:23,stdout:`${token} PRIVATE_OUTPUT`};
  if(args[0]==='push'){
   assert.deepEqual(args.slice(0,3),['push','--porcelain','origin']);assert.match(args[3],/^[a-f0-9]{40}:refs\/heads\/main$/);assert.ok(!args.some(a=>a.includes('force')));
   const config=await fs.readFile(path.join(cwd,'config'),'utf8');assert.ok(!config.includes(token));assert.ok(!config.includes(childEnv.GIT_CONFIG_VALUE_1));assert.ok(!config.includes('extraheader'));
   if(beforePush){const hook=beforePush;beforePush=null;await hook();}if(pushMode==='denied')return{code:1,stdout:`${token} PRIVATE_OUTPUT`};
   const result=await runIsolatedGit(request);if(pushMode==='lost'&&result.code===0)return{code:1,stdout:'Lost synthetic push reply'};return result;
  }
  return runIsolatedGit(request);
 };
 const writer=createGitPackageWriter({owner:'fixture',repo:'portfolio',branch:'main',githubToken:token,runGitImpl:run,...(failCleanup?{removeDirectoryImpl:async()=>{throw Error('Synthetic cleanup refusal');}}:{})});
 const state=()=>({head:git(remote,['rev-parse','refs/heads/main']).trim(),blob:git(remote,['rev-parse',`refs/heads/main:${FILE}`]).trim(),code:git(remote,['show','refs/heads/main:keep.txt'])});
 const f={writer,state,commands,directories,advance,remote,beforeFetch(fn){beforeFetch=fn;},beforePush(fn){beforePush=fn;},losePush(){pushMode='lost';},denyPush(){pushMode='denied';},failBlob(){failBlob=true;}};fixtures.push(f);return f;
}
const previous={};for(const name of ['PPC_PACKAGE_KEY','PPC_PUBLISHER_SECRET','GITHUB_TOKEN','GIT_TRACE','GIT_CURL_VERBOSE','UNRELATED_PRIVATE_FIXTURE']){previous[name]=process.env[name];process.env[name]='SYNTHETIC_PRIVATE_VALUE_MUST_NOT_REACH_CHILD';}
try{
 {
  const f=await fixture(),before=f.state();const result=await f.writer(replacement,hash(original),7);const after=f.state();assert.equal(result.content.sha,hash(replacement));assert.equal(after.blob,hash(replacement));assert.equal(after.code,before.code);
  assert.equal(git(f.remote,['rev-parse',`${after.head}^`]).trim(),before.head);assert.equal(git(f.remote,['diff-tree','--no-commit-id','--name-only','-r',before.head,after.head]).trim(),FILE);
 }
 {
  const f=await fixture();f.beforeFetch(()=>f.advance({code:'new code before head'}));await f.writer(replacement,hash(original),8);assert.equal(f.state().code,'new code before head');
 }
 {
  const f=await fixture();f.beforePush(()=>f.advance({code:'new code during push'}));assert.equal((await f.writer(replacement,hash(original),8)).retry,true);assert.equal(f.state().blob,hash(original));await f.writer(replacement,hash(original),8);assert.equal(f.state().blob,hash(replacement));assert.equal(f.state().code,'new code during push');
 }
 {
  const f=await fixture();f.beforeFetch(()=>f.advance({pkg:replacement}));assert.equal((await f.writer(original,hash(original),9)).retry,true);assert.equal(f.state().blob,hash(replacement));assert.equal(f.commands.filter(a=>a[0]==='hash-object').length,0);
 }
 {
  const f=await fixture();f.beforePush(()=>f.advance({pkg:replacement}));const another=await codec.encrypt(Uint8Array.of(9),codec.generateKey());assert.equal((await f.writer(another,hash(original),9)).retry,true);assert.equal(f.state().blob,hash(replacement));
 }
 {
  const f=await fixture(),before=f.state();f.losePush();await assert.rejects(f.writer(replacement,hash(original),9),e=>e.code==='GIT_PUSH_RESPONSE_UNCERTAIN');assert.equal(f.state().blob,hash(replacement));assert.equal(git(f.remote,['rev-list','--count',`${before.head}..refs/heads/main`]).trim(),'1');assert.equal(f.commands.filter(a=>a[0]==='push').length,1);
 }
 for(const mode of ['denyPush','failBlob']){
  const f=await fixture(),before=f.state();f[mode]();await assert.rejects(f.writer(replacement,hash(original),9),e=>{assert.equal(e.code,mode==='denyPush'?'GIT_PUSH_EXIT_1':'GIT_BLOB_EXIT_23');assert.ok(!`${e.message} ${e.stack}`.includes(token));assert.ok(!`${e.message} ${e.stack}`.includes('PRIVATE_OUTPUT'));return true;});assert.deepEqual(f.state(),before);
 }
 {
  const f=await fixture({failCleanup:true});await assert.rejects(f.writer(replacement,hash(original),9),e=>e.code==='GIT_PUSH_RESPONSE_UNCERTAIN');assert.equal(f.state().blob,hash(replacement));
  for(const dir of f.directories){assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('ppc-master-publish-'));await fs.rm(dir,{recursive:true,force:true});}
 }
 {
  const child=new EventEmitter();let killed=false;child.stdin={end(){},on(){},destroy(){}};child.stdout=new EventEmitter();child.stdout.destroy=()=>{};child.stderr={resume(){},destroy(){}};child.kill=()=>{killed=true;};child.unref=()=>{};
  const began=Date.now(),result=await runIsolatedGit({args:[],cwd:root,env:{},timeoutMs:10,spawnImpl:()=>child});assert.equal(result.kind,'TIMEOUT');assert.equal(killed,true);assert.ok(Date.now()-began<1500,'child with unclosed pipes cannot hold the operation indefinitely');
 }
 {
  const f=await fixture(),large=await codec.encrypt(new Uint8Array(45*1024*1024).fill(37),codec.generateKey());await f.writer(large,hash(original),10);assert.equal(f.state().blob,hash(large));const bytes=git(f.remote,['show',`refs/heads/main:${FILE}`],null);assert.equal(hash(bytes),hash(large));
 }
 for(const f of fixtures)for(const dir of f.directories){let exists=true;try{await fs.access(dir);}catch{exists=false;}assert.equal(exists,false,'each isolated writer directory is removed after success, race or failure');}
 console.log('Native Git package writer checks passed: actual local bare remotes, 45 MiB ciphertext, exact one-file commits/parents, noforce code/package races, lost reply, definitive refusal, secret-stripped env/config and contained cleanup.');
}finally{
 for(const[name,value]of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
 const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('ppc-native-writer-tests-'));await fs.rm(target,{recursive:true,force:true});
}
