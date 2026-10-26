'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http'),vm=require('node:vm');
test('configured native history bypasses a pending catalog scan and preserves stale-page errors',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cantus-http-history-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const runtime=require('./runtime.cjs');Object.assign(runtime,{demo:false,execution:false,codexHome:root,claudeConfig:root+'/empty-claude',claudeDesktop:root+'/empty-desktop'});
 const sid='11111111-1111-4111-8111-111111111111',id='codex_'+crypto.createHash('sha256').update(root+'\0'+sid).digest('hex');fs.mkdirSync(root+'/sessions');
 const file=root+'/sessions/rollout-'+sid+'.jsonl';fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id:sid,cwd:root}})+'\n'+Array.from({length:140},(_,i)=>JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'fixture '+i}]}})).join('\n')+'\n');
 const {CodexSessionSource}=require('./vendor/session-exporter/lib/codex-session-source');const original=CodexSessionSource.prototype.discover;let block=false,release,entered;const scanning=new Promise(r=>entered=r);
 CodexSessionSource.prototype.discover=async function(options){if(block&&!options?.ids){entered();await new Promise(r=>release=r);}return original.call(this,options);};
 t.after(()=>{release?.();CodexSessionSource.prototype.discover=original;});
 const server=require('./server.cjs').createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const get=url=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:server.address().port,path:url,headers:{Host:'127.0.0.1:4589'}},r=>{let text='';r.on('data',d=>text+=d);r.on('end',()=>resolve({status:r.statusCode,data:JSON.parse(text)}));}).on('error',reject);});
 assert.ok((await get('/api/sessions')).data.sessions.some(s=>s.id===id));
 block=true;const pending=get('/api/sessions?refresh=1');await scanning;
 const url='/api/history?provider=codex&id='+id,h=await get(url);assert.equal(h.status,200);assert.equal(h.data.totalRows,140);assert.equal(h.data.rows.length,120);
 release();await pending;block=false;
 fs.appendFileSync(file,JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'new fixture'}]}})+'\n');
 const stale=await get(url+'&before='+h.data.nextBefore+'&signature='+h.data.pageSignature);assert.equal(stale.status,409);assert.equal(stale.data.code,'stale');assert.equal(stale.data.historyIndependent,true);
 const fresh=await get(url);assert.equal(fresh.status,200);assert.equal(fresh.data.totalRows,141);
 assert.equal((await get('/api/history?provider=codex&id=codex_'+'b'.repeat(64))).status,404);
});
for(const independent of [true,false])test('history retry respects independent-source flag '+independent,async()=>{
 const source=fs.readFileSync(path.join(__dirname,'app.js'),'utf8'),script=source.slice(source.indexOf('let catalogReadCache='),source.indexOf('function visible()'));
 let history=0;const calls=[];const ctx={URLSearchParams,window:{cantusPlatform:{generation:1,key:()=> 'fixture'}},$:()=>({}),setTimeout,fetch:async url=>{calls.push(url);const stale=url.startsWith('/api/history')&&history++===0;return {ok:!stale,status:stale?409:200,json:async()=>stale?{code:'stale',error:'changed',historyIndependent:independent}:url.startsWith('/api/sessions')?{sessions:[],providers:[]}:{rows:[]}};}};
 vm.createContext(ctx);vm.runInContext(script,ctx);await ctx.api('/api/history?provider=codex&id=fixture');assert.equal(calls.filter(s=>s.startsWith('/api/sessions')).length,independent?0:1);assert.equal(history,2);
});
