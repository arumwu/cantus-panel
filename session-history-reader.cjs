'use strict';
// Read-only work is isolated from catalog scans and all provider/writer processes.
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const failure=(code,status=409)=>Object.assign(Error(code),{code,status});
class HistoryPages{
 constructor({createSource,maxEntries=8,maxBytes=16*1024*1024}){this.createSource=createSource;this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.entries=new Map();this.bytes=0;}
 discard(key){const old=this.entries.get(key);if(old)this.bytes-=old.bytes;this.entries.delete(key);}
 async read({provider,id,before=null,signature}){
  if(!['codex','claude'].includes(provider)||!(provider==='codex'?/^codex_[a-f0-9]{64}$/:/^[a-f0-9]{64}$/).test(id))throw failure('input',400);
  if(before!==null&&(!Number.isSafeInteger(before)||before<1||!/^[a-f0-9]{64}$/.test(signature||'')))throw failure('input',400);
  const key=JSON.stringify([provider,id,before,signature||'']);
  for(let attempt=0;attempt<2;attempt++){
   let entry=this.entries.get(key);
   try{
    if(entry){
     // Re-resolve selection: a new writable JSONL can supersede an unchanged
     // compressed archive. A fingerprint of the old file alone cannot see it.
     if(provider==='codex')await entry.source.discover({ids:[id]});
     if(await entry.source.fingerprint(id)!==entry.fingerprint)throw failure('stale');
     this.entries.delete(key);this.entries.set(key,entry);return entry.value;
    }
    const source=this.createSource(provider);
    if(provider==='codex'){
     const found=await source.discover({ids:[id]});
     if(!found.sessions.some(s=>s.id===id&&s.hasTranscript))throw failure('missing',404);
    }
    const fingerprint=await source.fingerprint(id);
    const value={...await source.read(id,{page:true,before,pageSignature:signature}),readOnly:true};
    if(await source.fingerprint(id)!==fingerprint)throw failure('stale');
    const bytes=Buffer.byteLength(JSON.stringify(value));
    if(bytes<=this.maxBytes){
     while(this.entries.size>=this.maxEntries||this.bytes+bytes>this.maxBytes)this.discard(this.entries.keys().next().value);
     this.entries.set(key,{source,fingerprint,value,bytes});this.bytes+=bytes;
    }
    return value;
   }catch(error){this.discard(key);if(error.code==='stale'&&attempt===0)continue;throw error;}
  }
 }
}
function createHistoryReader({root,claudeProjectsDir,claudeDesktopDir,timeoutMs=40000,maxPending=4}={}){
 if(!require('node:path').isAbsolute(root||''))throw Error('Explicit source root required');
 let worker=null,serial=0;const pending=new Map(),flights=new Map();
 function stop(error){const old=worker;worker=null;if(old)void old.terminate();for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();}
 function start(){
  if(worker)return;
  const current=worker=new Worker(__filename,{workerData:{root,claudeProjectsDir,claudeDesktopDir}});
  current.on('message',m=>{if(worker!==current)return;const p=pending.get(m.serial);if(!p)return;pending.delete(m.serial);clearTimeout(p.timer);m.error?p.reject(failure(m.error.code,m.error.status)):p.resolve(m.value);});
  current.on('error',()=>{if(worker===current)stop(failure('source',503));});
  current.on('exit',()=>{if(worker===current)stop(failure('source',503));});
 }
 return {
  read(input){
   const key=JSON.stringify(input);if(flights.has(key))return flights.get(key);
   if(pending.size>=maxPending)return Promise.reject(failure('busy',503));
   start();const n=++serial;
   const result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>stop(failure('timeout',503)),timeoutMs);pending.set(n,{resolve,reject,timer});worker.postMessage({serial:n,input});});
   const flight=result.finally(()=>flights.delete(key));flights.set(key,flight);return flight;
  },
  close(){stop(failure('closed',503));}
 };
}
if(!isMainThread){
 const {CodexSessionSource}=require('./vendor/session-exporter/lib/codex-session-source');
 const {ClaudeSessionSource}=require('./vendor/session-exporter/lib/claude-session-source');
 const pages=new HistoryPages({createSource:provider=>provider==='codex'?new CodexSessionSource({root:workerData.root,sqliteRoot:workerData.root,env:{}}):new ClaudeSessionSource({cliRoot:workerData.claudeProjectsDir||require('node:path').join(workerData.root,'unconfigured-claude'),desktopRoot:workerData.claudeDesktopDir||require('node:path').join(workerData.root,'unconfigured-desktop'),env:{},language:'zh-TW'})});
 let queue=Promise.resolve();
 parentPort.on('message',message=>{queue=queue.then(async()=>{try{parentPort.postMessage({serial:message.serial,value:await pages.read(message.input)});}catch(e){parentPort.postMessage({serial:message.serial,error:{code:e.code||'source',status:e.status||409}});}});});
}
module.exports={HistoryPages,createHistoryReader};
