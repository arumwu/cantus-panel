'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
test('native eligibility uses full discovery, fails closed, and rechecks before starting a provider',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cantus-native-worker-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(root+'/sessions');
 const runtime=require('./runtime.cjs');Object.assign(runtime,{codexHome:root,codexBin:process.execPath});
 const sid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='codex_'+crypto.createHash('sha256').update(root+'\0'+sid).digest('hex');
 const meta=JSON.stringify({type:'session_meta',payload:{id:sid,cwd:root}})+'\n',event=state=>JSON.stringify({type:'event_msg',payload:{type:state}})+'\n';
 const file=root+'/sessions/rollout-'+sid+'.jsonl';fs.writeFileSync(file,meta+event('task_complete'));
 let guards=0,spawns=0;const {createNative}=require('./native.cjs');const native=createNative(x=>x===id?{id,provider:'codex',hasTranscript:true}:null,{receiptsFile:null,guard:async()=>{if(++guards===2)fs.appendFileSync(file,event('task_started'));return true;},spawn:()=>{spawns++;throw Error('Provider must not start');}});
 assert.equal((await native.capability(id)).available,true);
 fs.appendFileSync(file,event('task_started'));const busy=await native.capability(id);assert.equal(busy.available,false);assert.equal(busy.code,'busy');
 fs.writeFileSync(file,meta);const unknown=await native.capability(id);assert.equal(unknown.available,false);assert.equal(unknown.code,'busy');
 fs.writeFileSync(file,meta+event('task_complete'));await assert.rejects(native.runner.send({id,text:'synthetic fixture',requestId:'fixture_request_123'}),{code:'busy'});assert.equal(guards,2);assert.equal(spawns,0);
 fs.unlinkSync(file);fs.writeFileSync(file+'.zst',zlib.zstdCompressSync(meta+event('task_complete')));fs.writeFileSync(root+'/sessions/rollout-'+other+'.jsonl.zst',zlib.zstdCompressSync(meta+event('task_started')));
 const conflict=await native.capability(id);assert.equal(conflict.available,false);assert.equal(conflict.code,'busy');
});
test('large full discovery does not block the request event loop',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cantus-native-loop-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(root+'/sessions');
 const sid='11111111-1111-4111-8111-111111111111',id='codex_'+crypto.createHash('sha256').update(root+'\0'+sid).digest('hex');
 for(let i=0;i<250;i++){const other=i===0?sid:`${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`;const raw=JSON.stringify({type:'session_meta',payload:{id:other,cwd:root}})+'\n'+JSON.stringify({type:'event_msg',payload:{type:'task_complete'}})+'\n';fs.writeFileSync(root+'/sessions/rollout-'+other+'.jsonl.zst',zlib.zstdCompressSync(raw));}
 // The production runtime configuration is process-wide. Load a fresh copy of
 // native.cjs after selecting the isolated fixture root.
 const runtime=require('./runtime.cjs');runtime.codexHome=root;runtime.codexBin=process.execPath;delete require.cache[require.resolve('./native.cjs')];
 const native=require('./native.cjs').createNative(x=>x===id?{id,provider:'codex',hasTranscript:true}:null,{receiptsFile:null});let ticks=0;const timer=setInterval(()=>ticks++,5);
 try{assert.equal((await native.capability(id)).available,true);}finally{clearInterval(timer);}
 assert.ok(ticks>=2,`request event loop did not advance during source scan: ${ticks}`);
});
test('identical capability calls coalesce; expired queued checks never start',async t=>{
 const threads=require('node:worker_threads'),original=threads.Worker,{EventEmitter}=require('node:events');let release;const stopped=new Promise(r=>release=r),workers=[];
 class FakeWorker extends EventEmitter{constructor(){super();workers.push(this);}terminate(){return stopped;}}
 threads.Worker=FakeWorker;delete require.cache[require.resolve('./native.cjs')];t.after(()=>{threads.Worker=original;delete require.cache[require.resolve('./native.cjs')];});
 t.mock.timers.enable({apis:['setTimeout']});const native=require('./native.cjs').createNative(id=>({id,provider:'codex',hasTranscript:true}),{receiptsFile:null});
 const id='codex_'+'a'.repeat(64),other='codex_'+'b'.repeat(64),first=native.capability(id),same=native.capability(id);assert.equal(first,same);assert.equal(workers.length,1);
 // Actual send's reference check must remain separate from a pending capability.
 const fresh=native.runner.referenceFor(id).catch(e=>e);t.mock.timers.tick(10000);const queued=native.capability(other);t.mock.timers.tick(30000);
 assert.equal((await first).available,false);assert.equal((await fresh).code,'source');assert.equal(workers.length,1);
 t.mock.timers.tick(10000);assert.equal((await queued).available,false);release();await new Promise(setImmediate);assert.equal(workers.length,1);
});
