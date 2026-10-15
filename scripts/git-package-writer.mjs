import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import '../public/js/package-codec.js';

const codec=globalThis.PortfolioPackage,SHA=/^[a-f0-9]{40}$/,FILE='public/data/master_ppc.pkg',PREFIX='ppc-master-publish-';
const fail=code=>Object.assign(new Error('The encrypted package Git upload did not complete. No private details were logged.'),{code});
const blobSha=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');

// No shell, no raw child errors, no stderr retention, and no credential in argv.
export function runIsolatedGit({args,cwd,env,input,timeoutMs,spawnImpl=spawn}) {
 return new Promise(resolve=>{let child,done=false,length=0,chunks=[],kind='';
  const finish=code=>{if(done)return;done=true;clearTimeout(timer);resolve({code,kind,stdout:Buffer.concat(chunks).toString('utf8')});};
  const stop=()=>{child?.stdin.destroy();child?.stdout.destroy();child?.stderr.destroy();
   if(process.platform==='win32'&&Number.isInteger(child?.pid)&&child.pid>0){
    let killer;const deadline=setTimeout(()=>{killer?.kill();killer?.unref();child?.unref();finish(null);},1000);
    try{killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{env:Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','SYSTEMROOT','WINDIR'].includes(k.toUpperCase()))),stdio:'ignore',windowsHide:true});killer.on('close',()=>{clearTimeout(deadline);finish(null);});killer.on('error',()=>{clearTimeout(deadline);child?.kill();finish(null);});}catch{clearTimeout(deadline);child?.kill();finish(null);}
   }else{try{if(Number.isInteger(child?.pid)&&child.pid>0)process.kill(-child.pid,'SIGKILL');else child?.kill('SIGKILL');}catch{child?.kill('SIGKILL');}child?.unref();finish(null);}
  };
  const timer=setTimeout(()=>{kind='TIMEOUT';stop();},timeoutMs);
  try{child=spawnImpl('git',args,{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});}
  catch{kind='START';finish(null);return;}
  child.on('error',()=>{kind='START';finish(null);});
  child.stdout.on('data',b=>{length+=b.length;if(length>1024*1024){kind='OUTPUT_LIMIT';stop();}else chunks.push(b);});
  child.stderr.resume();child.stdin.on('error',()=>{});child.on('close',finish);child.stdin.end(input);
 });
}

export function createGitPackageWriter({owner,repo,branch,githubToken,timeoutMs=120000,runGitImpl=runIsolatedGit,removeDirectoryImpl=rm}) {
 if(!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)||!/^[A-Za-z0-9_.-]{1,100}$/.test(repo)||repo==='.'||repo==='..'||
  !/^[A-Za-z0-9_./-]{1,200}$/.test(branch)||branch.includes('..')||typeof githubToken!=='string'||githubToken.length<24||githubToken.length>512||/[\s\u0000-\u001f\u007f]/.test(githubToken)||
  !Number.isInteger(timeoutMs)||timeoutMs<1||typeof runGitImpl!=='function'||typeof removeDirectoryImpl!=='function')throw fail('GIT_CONFIGURATION_INVALID');
 const remote=`https://github.com/${owner}/${repo}.git`;
 return async function writePackage(bytes,expectedPackageSha,revision){
  if(!(bytes instanceof Uint8Array)||!codec.isEncrypted(bytes)||bytes.length>codec.MAX_PACKAGE_BYTES||!SHA.test(expectedPackageSha)||!Number.isSafeInteger(revision)||revision<0)throw fail('GIT_INPUT_INVALID');
  let directory,mayHaveAccepted=false;
  try{
   directory=await mkdtemp(path.join(os.tmpdir(),PREFIX));const gitdir=path.join(directory,'repo'),templates=path.join(directory,'templates'),hooks=path.join(directory,'hooks'),emptyConfig=path.join(directory,'empty-config');
   await Promise.all([mkdir(gitdir),mkdir(templates),mkdir(hooks),writeFile(emptyConfig,'',{flag:'wx'})]);
   const allowed=new Set(['PATH','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','TMPDIR','LANG','LC_ALL','LC_CTYPE']);
   const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>allowed.has(k.toUpperCase())));
   Object.assign(env,{HOME:directory,USERPROFILE:directory,XDG_CONFIG_HOME:path.join(directory,'xdg'),CURL_HOME:directory,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:emptyConfig,GIT_CONFIG_SYSTEM:emptyConfig,GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'',SSH_ASKPASS:'',GIT_INDEX_FILE:path.join(directory,'index'),
    GIT_AUTHOR_NAME:'PPC master publisher',GIT_AUTHOR_EMAIL:'ppc-publisher@users.noreply.github.com',GIT_COMMITTER_NAME:'PPC master publisher',GIT_COMMITTER_EMAIL:'ppc-publisher@users.noreply.github.com',
    GIT_CONFIG_COUNT:'4',GIT_CONFIG_KEY_0:'credential.helper',GIT_CONFIG_VALUE_0:'',GIT_CONFIG_KEY_1:`http.${remote}.extraheader`,GIT_CONFIG_VALUE_1:`AUTHORIZATION: basic ${Buffer.from(`x-access-token:${githubToken}`).toString('base64')}`,
    GIT_CONFIG_KEY_2:'http.followRedirects',GIT_CONFIG_VALUE_2:'false',GIT_CONFIG_KEY_3:'core.hooksPath',GIT_CONFIG_VALUE_3:hooks});
   const run=async(stage,args,input,allowFailure=false)=>{let result;try{result=await runGitImpl({args,cwd:gitdir,env,input,timeoutMs});}catch{throw fail(`GIT_${stage}_UNCERTAIN`);}
    if(result?.code!==0&&!allowFailure)throw fail(`GIT_${stage}_${result?.kind||`EXIT_${Number.isInteger(result?.code)?result.code:'UNKNOWN'}`}`);
    return result;};
   const text=async(stage,args,input)=>((await run(stage,args,input)).stdout||'').trim();
   const readHead=async()=>{await run('FETCH',['fetch','--quiet','--no-tags','--depth=1','origin',`refs/heads/${branch}`]);
    const head=await text('HEAD',['rev-parse','--verify','FETCH_HEAD^{commit}']);if(!SHA.test(head))throw fail('GIT_HEAD_INVALID');
    const pkg=await text('PACKAGE',['rev-parse','--verify',`${head}:${FILE}`]);if(!SHA.test(pkg))throw fail('GIT_PACKAGE_INVALID');return{head,pkg};};
   await run('INIT',['init','--bare','--quiet',`--template=${templates}`]);await run('REMOTE',['remote','add','origin',remote]);
   const observed=await readHead(),proposedSha=blobSha(bytes);if(observed.pkg!==expectedPackageSha)return{retry:true,status:409};if(proposedSha===observed.pkg)return{content:{sha:proposedSha}};
   if(await text('BLOB',['hash-object','-w','--stdin'],bytes)!==proposedSha)throw fail('GIT_BLOB_INVALID');
   await run('INDEX',['read-tree',`${observed.head}^{tree}`]);await run('INDEX',['update-index','--add','--cacheinfo','100644',proposedSha,FILE]);
   const tree=await text('TREE',['write-tree']);if(!SHA.test(tree))throw fail('GIT_TREE_INVALID');
   if(await text('SCOPE',['diff-tree','--no-commit-id','--name-only','-r',`${observed.head}^{tree}`,tree])!==FILE)throw fail('GIT_SCOPE_INVALID');
   const commit=await text('COMMIT',['commit-tree',tree,'-p',observed.head],`Publish PPC master revision ${revision}\n`);if(!SHA.test(commit))throw fail('GIT_COMMIT_INVALID');
   if(await text('VERIFY',['rev-parse','--verify',`${commit}:${FILE}`])!==proposedSha)throw fail('GIT_PACKAGE_INVALID');
   let pushed;mayHaveAccepted=true;try{pushed=await run('PUSH',['push','--porcelain','origin',`${commit}:refs/heads/${branch}`],undefined,true);}catch{throw fail('GIT_PUSH_RESPONSE_UNCERTAIN');}
   if(pushed?.code!==0){let actual;try{actual=await readHead();}catch{throw fail('GIT_PUSH_RESPONSE_UNCERTAIN');}
    if(actual.pkg===proposedSha)throw fail('GIT_PUSH_RESPONSE_UNCERTAIN');
    mayHaveAccepted=false;if(actual.head!==observed.head)return{retry:true,status:409};
    throw fail(`GIT_PUSH_${pushed?.kind||`EXIT_${Number.isInteger(pushed?.code)?pushed.code:'UNKNOWN'}`}`);
   }
   return{content:{sha:proposedSha}};
  }catch(error){throw /^GIT_[A-Z0-9_]+$/.test(error?.code||'')?fail(error.code):fail('GIT_LOCAL_IO_FAILED');
  }finally{
   if(directory){const parent=path.resolve(os.tmpdir()),target=path.resolve(directory);if(path.dirname(target)!==parent||!path.basename(target).startsWith(PREFIX)||target===parent)throw fail(mayHaveAccepted?'GIT_PUSH_RESPONSE_UNCERTAIN':'GIT_CLEANUP_GUARD');try{await removeDirectoryImpl(target,{recursive:true,force:true});}catch{throw fail(mayHaveAccepted?'GIT_PUSH_RESPONSE_UNCERTAIN':'GIT_CLEANUP_FAILED');}}
  }
 };
}
