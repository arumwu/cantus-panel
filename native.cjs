'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const runtime=require('./runtime.cjs');
const {sourcesFor,messageFor}=require(runtime.exporter);
const {PanelRunner}=require('./panel-runner.cjs');
const {nativeCommand}=require(runtime.exporter+'/session-link-runner');
const sourceOptions={env:{},codexHome:runtime.codexHome,codexSqliteHome:runtime.codexHome,claudeProjectsDir:runtime.claudeConfig+'/projects',claudeDesktopDir:runtime.claudeDesktop,language:'zh-TW'};
const failure=(code,message,status=409)=>Object.assign(Error(message),{code,status});
async function readSource({id,entry,sourceOptions,env,operation,readOptions}){
  const source=sourcesFor(sourceOptions)[entry.provider];
  // A filename is only a hint; keep the complete discovery for safety checks.
  await source.discover();
  if(operation==='history')return source.read(id,{page:true,...readOptions});
  const ref=await source.referenceFor(id),h=await source.read(id,{page:true});
  if(h.active!==false)throw failure('busy',h.active?'原會話仍在執行，請等它結束。':'無法確認原會話已閒置，暫不送出。');
  if(entry.isSubagent||['subagent','guardian_review'].includes(entry.threadSource)||entry.agentPath?.startsWith('/root/'))throw failure('unsupported','子代理會話不開放直接續作');
  const command=nativeCommand(entry.provider,ref,env);
  if(!path.isAbsolute(command))throw failure('cli','找不到原 App 的 CLI，未改用其他模型或工具。');
  fs.accessSync(command,fs.constants.X_OK);
  return ref;
}
if(!isMainThread&&workerData?.cantusNativeSource){
  readSource(workerData.input).then(value=>parentPort.postMessage({value}),e=>parentPort.postMessage({error:{code:e.code,message:e.message,status:e.status}}));
}
function createNative(lookup,options={}){
  const env={...process.env,HUB_STORAGE_GUARD:runtime.guard,HUB_CLAUDE_DESKTOP_DIR:runtime.claudeDesktop,AI_SESSION_CODEX_BIN:runtime.codexBin,AI_SESSION_CLAUDE_BIN:runtime.claudeBin};
  // Always resolve opaque catalog IDs on the server. Never accept paths, CLI flags or native IDs from HTTP.
  const queue=[],capabilityFlights=new Map();let active=null;
  function drain(){
    if(active||!queue.length)return;
    const job=queue.shift();active=job;
    try{
      const entry=lookup(job.id);if(!entry)throw failure('missing','找不到這個會話',404);
      if(!entry.hasTranscript)throw failure('unsupported','只有索引，不能原生續作');
      const worker=job.worker=new Worker(__filename,{workerData:{cantusNativeSource:true,input:{id:job.id,entry,sourceOptions,env,operation:job.operation,readOptions:job.readOptions}}});
      worker.once('message',m=>job.finish(m.error?failure(m.error.code||'source',m.error.message,m.error.status):null,m.value));
      worker.once('error',()=>job.finish(failure('source','來源讀取失敗，請稍後再試。',503)));
      worker.once('exit',()=>job.finish(failure('source','來源讀取中斷，請稍後再試。',503)));
    }catch(e){job.finish(e);}
  }
  function isolated(id,operation,readOptions){
    if(queue.length>=4)return Promise.reject(failure('source','來源讀取忙碌，請稍後再試。',503));
    return new Promise((resolve,reject)=>{
      const job={id,operation,readOptions,done:false,worker:null};
      job.finish=(error,value)=>{
        if(job.done)return;job.done=true;clearTimeout(job.timer);
        const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);
        error?reject(error):resolve(value);
        if(active===job){
          // Do not start the next scan until the previous worker has stopped.
          const stopped=job.worker?job.worker.terminate():Promise.resolve();
          void stopped.catch(()=>{}).finally(()=>{active=null;drain();});
        }
      };
      // Waiting time counts toward the deadline; expired queued jobs are removed.
      job.timer=setTimeout(()=>job.finish(failure('source','來源讀取逾時，請稍後再試。',503)),40000);
      queue.push(job);drain();
    });
  }
  async function history(id,options={}){return isolated(id,'history',options);}
  async function referenceFor(id){return isolated(id,'reference');}
  const runner=new PanelRunner({referenceFor,history,env,largeHistory:true,fullAccess:runtime.fullAccess,receiptsFile:path.join(__dirname,'state','deliveries.json'),message:messageFor,...options});
  function capability(id){
    if(capabilityFlights.has(id))return capabilityFlights.get(id);
    const pending=(async()=>{
      try{const ref=await referenceFor(id);return {available:true,sourceSessionId:ref.sourceSessionId,mode:'native-resume',note:'寫回同一原生 session；占用時不搶鎖，工具操作保留原生批准流程。'};}
      catch(e){return {available:false,code:e.code||'source',note:messageFor(e.code,e.message)};}
    })();
    capabilityFlights.set(id,pending);void pending.finally(()=>capabilityFlights.delete(id));return pending;
  }
  return {runner,capability};
}
module.exports={createNative};
