'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const crypto=require('node:crypto');
const {createNative}=require('./native.cjs');
const {ManagedRunner}=require('./managed.cjs');
const {HandoffRunner}=require('./handoff.cjs');
const {RoutingStore}=require('./routing.cjs');
const {ModelCatalog}=require('./model-catalog.cjs');
const {validate:validateRouting,choose:chooseRoute}=require('./routing-rules.js');
const {presentCatalog}=require('./catalog.cjs');
const {CatalogDelta}=require('./catalog-delta.cjs');
const {enrichCodexDesktop}=require('./codex-desktop-catalog.cjs');
const {createLive,panelJobs}=require('./live.cjs');
const {LineageStore}=require('./lineage.cjs');
const {PairCoordinator,DispatchReceiver}=require('./pair.cjs');
const runtime=require('./runtime.cjs');
const {createHistoryReader}=require('./session-history-reader.cjs');
const {sourcesFor}=require(runtime.exporter);
const PORT=Number(process.env.CANTUS_PANEL_PORT||4589),origin=`http://127.0.0.1:${PORT}`;
const sources=runtime.demo?require('./demo.cjs').sources:sourcesFor({env:{},codexHome:runtime.codexHome,codexSqliteHome:runtime.codexHome,claudeProjectsDir:runtime.claudeConfig+'/projects',claudeDesktopDir:runtime.claudeDesktop,language:'zh-TW'});
let catalog={sessions:[],providers:[],scannedAt:null}, pending=null;
function enrichCodex(rows){if(runtime.demo){catalog.projects=require('./demo.cjs').projects;return;}const value=enrichCodexDesktop(rows,runtime.codexHome);catalog.projects=value.projects;const provider=catalog.providers.find(p=>p.provider==='codex');if(provider)provider.warnings.push(...value.warnings);}
async function scan(){if(pending)return pending;pending=(async()=>{const sessions=[],providers=[];for(const [provider,source] of Object.entries(sources)){try{const found=await source.discover();const rows=found.sessions;sessions.push(...rows.map(x=>({...x,provider})));providers.push({provider,count:rows.length,supported:found.supported,warnings:found.warnings});}catch(e){providers.push({provider,count:0,supported:false,warnings:['讀取失敗：'+(e.code||'unknown')]});}}sessions.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));catalog={sessions,providers,demo:runtime.demo,scannedAt:new Date().toISOString()};return catalog;})().finally(()=>pending=null);return pending;}
const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
files['/native-ui.js']=['native-ui.js','text/javascript; charset=utf-8'];
files['/conversation-tree.js']=['conversation-tree.js','text/javascript; charset=utf-8'];
files['/platform-ui.js']=['platform-ui.js','text/javascript; charset=utf-8'];
files['/routing-rules.js']=['routing-rules.js','text/javascript; charset=utf-8'];
files['/routing-ui.js']=['routing-ui.js','text/javascript; charset=utf-8'];
files['/live-ui.js']=['live-ui.js','text/javascript; charset=utf-8'];
files['/live.css']=['live.css','text/css; charset=utf-8'];
files['/lineage-ui.js']=['lineage-ui.js','text/javascript; charset=utf-8'];
files['/organize-ui.js']=['organize-ui.js','text/javascript; charset=utf-8'];
files['/pair-ui.js']=['pair-ui.js','text/javascript; charset=utf-8'];
files['/lineage.css']=['lineage.css','text/css; charset=utf-8'];
function createServer(options={}){const catalogDeltas=new CatalogDelta();const csrf=crypto.randomBytes(32).toString('hex');const routing=options.routing||new RoutingStore();const models=options.models||new ModelCatalog();const managed=options.managed||new ManagedRunner();const native=options.native||createNative(id=>catalog.sessions.find(x=>x.id===id));const handoff=new HandoffRunner({managed,native,lookup:id=>catalog.sessions.find(x=>x.id===id),...options.handoff});const runnerFor=id=>handoff.records.has(id)||handoff.pending.has(id)?handoff:typeof id==='string'&&id.startsWith('panel_')?managed:native.runner;const server=http.createServer(async(req,res)=>{const send=(code,value,type='application/json; charset=utf-8')=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(type.startsWith('application/json')?JSON.stringify(value):value);};
if(req.headers.host!==`127.0.0.1:${PORT}`||req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'拒絕非本機來源'});
if(req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'拒絕跨站請求'});
const url=new URL(req.url,origin);let independentHistory=false;
if((options.readOnly??process.env.CANTUS_PANEL_READ_ONLY==='1')&&req.method!=='GET')return send(423,{code:'read_only',error:'面板目前只供瀏覽，送出維持鎖定。'});
try{
if(url.pathname.startsWith('/api/m1/')){
 if(runtime.pairRole!=='controller')return send(404,{error:'未設定第二台主機'});
 const suffix=url.pathname.slice('/api/m1/'.length),reads=new Set(['sessions','history','native/capability','native/status','routing/settings','routing/models','lineage']),writes=new Set(['native/create','native/send','native/answer','native/stop','routing/settings','routing/preview','lineage']);
 if(!['GET','POST'].includes(req.method)||!(req.method==='GET'?reads:writes).has(suffix))return send(404,{error:'未開放此功能'});
 let input;if(req.method==='POST'){
  if(req.headers.origin!==origin||req.headers['x-cantus-token']!==csrf)return send(403,{error:'請重新整理面板'});
  if(req.headers['content-type']?.split(';')[0]!=='application/json')return send(415,{error:'需要 JSON'});
  if(suffix.startsWith('native/')&&!runtime.execution)return send(403,{error:'執行功能尚未啟用'});
  let raw='',bytes=0;for await(const c of req){bytes+=c.length;if(bytes>128*1024)return send(413,{error:'內容太長'});raw+=c;}try{input=JSON.parse(raw);}catch{return send(400,{error:'無效 JSON'});}
 }
 const remote=options.remote||require('./pair-transport.cjs').createTransport({port:runtime.pairPort});return send(200,await remote('/api/'+suffix+url.search,req.method,input));
}
if(req.method==='POST'&&url.pathname.startsWith('/api/native/')&&!runtime.execution)return send(403,{error:'執行功能預設關閉；請先完成本機設定並明確啟用。'});
if(url.pathname==='/api/pair'||url.pathname==='/api/dispatch'){
 const pair=url.pathname==='/api/pair';if(pair&&runtime.pairRole!=='controller'&&!options.pair||!pair&&runtime.pairRole!=='worker'&&!options.receiver)return send(404,{error:'此主機未開放這個角色'});
 if(!['GET','POST'].includes(req.method))return send(405,{error:'不支援此方法'});
 let input;if(req.method==='POST'){
  if(req.headers.origin!==origin||req.headers['x-cantus-token']!==csrf)return send(403,{error:'請重新整理面板後再送出'});
  if(req.headers['content-type']?.split(';')[0]!=='application/json')return send(415,{error:'需要 JSON'});
  let raw='',bytes=0;for await(const c of req){bytes+=c.length;if(bytes>32768)return send(413,{error:'派工內容太長'});raw+=c;}
  try{input=JSON.parse(raw);}catch{return send(400,{error:'無效 JSON'});}if(!input||typeof input!=='object'||Array.isArray(input))return send(400,{error:'無效請求'});
 }
 if(input&&(input.action==='dispatch'||!pair)&&!runtime.execution&&!options.pair&&!options.receiver)return send(403,{error:'執行功能尚未啟用'});
 const guard=()=>runtime.checkGuard();
 if(!pair){server.receiver ||= options.receiver||new DispatchReceiver({root:path.join(__dirname,'state','dispatch-receipts'),managed,guard});return send(200,input?await server.receiver.receive(input):server.receiver.status(url.searchParams.get('requestId')));}
 server.pair ||= options.pair||new PairCoordinator({root:path.join(__dirname,'state','pair'),guard,local:async()=>{if(!catalog.scannedAt){await scan();enrichCodex(catalog.sessions);}server.lineage ||= options.lineage||new LineageStore();return server.lineage.snapshot([...catalog.sessions,...managed.list()],handoff.records);},remote:options.remote||require('./pair-transport.cjs').createTransport({port:runtime.pairPort})});
 const value=input?await server.pair.mutate(input):await server.pair.snapshot();delete value.base;if(!runtime.execution&&!options.pair)value.canDispatch=false;return send(200,value);
}
if(url.pathname==='/api/lineage'){
 server.lineage ||= options.lineage||new LineageStore();
 if(!['GET','POST'].includes(req.method))return send(405,{error:'不支援此方法'});
 if(req.method==='POST'){
  if(req.headers.origin!==origin||req.headers['x-cantus-token']!==csrf)return send(403,{error:'請重新整理面板後再儲存'});
  if(req.headers['content-type']?.split(';')[0]!=='application/json')return send(415,{error:'需要 JSON'});
  let raw='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>16384)return send(413,{error:'關係資料太長'});raw+=chunk;}
  let body;try{body=JSON.parse(raw);}catch{return send(400,{error:'無效 JSON'});}
  if(!body||typeof body!=='object'||Array.isArray(body))return send(400,{error:'無效請求'});
  if(!catalog.scannedAt){await scan();enrichCodex(catalog.sessions);}
  return send(200,server.lineage.mutate(body,[...catalog.sessions,...managed.list()],handoff.records));
 }
 if(!catalog.scannedAt){await scan();enrichCodex(catalog.sessions);}
 return send(200,server.lineage.snapshot([...catalog.sessions,...managed.list()],handoff.records));
}
if(req.method==='POST'&&['/api/native/create','/api/native/send','/api/native/answer','/api/native/stop','/api/routing/settings','/api/routing/preview'].includes(url.pathname)){
if(req.headers.origin!==origin||req.headers['x-cantus-token']!==csrf)return send(403,{error:'請重新整理面板後再送出'});
if(req.headers['content-type']?.split(';')[0]!=='application/json')return send(415,{error:'需要 JSON'});
let chunks=[],bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>128*1024)return send(413,{error:'訊息太長'});chunks.push(chunk);}const raw=Buffer.concat(chunks).toString('utf8');
let body;try{body=JSON.parse(raw);}catch{return send(400,{error:'無效 JSON'});}
if(!body||typeof body!=='object'||Array.isArray(body))return send(400,{error:'無效請求'});
if(url.pathname==='/api/routing/settings'){
 const config=validateRouting(body);for(const target of [config.defaultTarget,...config.rules.flatMap(r=>r.fallback?[r,r.fallback]:[r])]){const check=await models.check(target);if(!check.ok)return send(400,{error:check.reason});}
 return send(200,routing.save(config));
}
if(url.pathname==='/api/routing/preview'){
 if(typeof body.text!=='string'||body.text.length>24000)return send(400,{error:'請輸入最多 24,000 字的測試訊息'});
 const config=body.settings?validateRouting(body.settings):routing.read();return send(200,chooseRoute(config,body.text));
}
if(url.pathname.endsWith('/create'))return send(200,await managed.create(body.provider));
if(url.pathname.endsWith('/send')){
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(body.id||'')||!/^[A-Za-z0-9_-]{8,128}$/.test(body.requestId||'')||typeof body.text!=='string'||!body.text.trim()||Buffer.byteLength(body.text)>100000)return send(400,{error:'無效訊息'});
 if(body.provider!==undefined&&!['auto','codex','claude'].includes(body.provider))return send(400,{error:'不支援的 AI'});
 const entry=handoff.entry(body.id),r=handoff.records.get(body.id);if(!entry)return send(404,{error:'找不到會話'});
 if(body.provider==='auto'){
  const last=r?.deliveries.at(-1),routingConfig=routing.read();let decision=chooseRoute(routingConfig,body.text,last?.phase==='completed'?last.routing:null);
  const check=await models.check(decision);
  if(!check.ok){if(!decision.fallback)return send(409,{error:check.reason+'；尚未送出。'});const backup=await models.check(decision.fallback);if(!backup.ok)return send(409,{error:'主模型與備援均不可用；尚未送出。'});decision={...decision,...decision.fallback,reason:decision.reason+'；主模型檢查失敗，使用備援：'+check.reason,usedFallback:true};}
  const cap=await handoff.capability(body.id,decision.provider);if(!cap.available)return send(409,{error:cap.note});
  const route={ruleId:decision.ruleId,ruleName:decision.ruleName,reason:decision.reason,provider:decision.provider,model:decision.model,effort:decision.effort,usedFallback:!!decision.usedFallback,settingsRevision:routingConfig.revision};
  return send(200,await handoff.send({id:body.id,text:body.text,requestId:body.requestId,provider:decision.provider,model:decision.model,effort:decision.effort,routing:route}));
 }
 const useHandoff=r||handoff.pending.has(body.id)||body.provider&&body.provider!==entry.provider;return send(200,await (useHandoff?handoff:runnerFor(body.id)).send({id:body.id,text:body.text,requestId:body.requestId,provider:body.provider||r?.provider||entry.provider}));
}
if(url.pathname.endsWith('/answer'))return send(200,runnerFor(body.id).answer({id:body.id,approvalId:body.approvalId,allow:body.allow}));
if(typeof body.id!=='string')return send(400,{error:'無效會話'});
return send(200,await runnerFor(body.id).stop(body.id));
}
if(req.method!=='GET')return send(405,{error:'不支援此方法'});
if(url.pathname==='/api/live'){
 server.live ||= createLive({panel:()=>panelJobs({sessions:catalog.sessions,managed,native,handoff})});return send(200,await server.live());
}
if(url.pathname==='/api/bootstrap')return send(200,{csrf,routing:true,pair:runtime.pairRole==='controller'||!!options.pair,readOnly:options.readOnly??process.env.CANTUS_PANEL_READ_ONLY==='1'});
if(url.pathname==='/api/routing/settings')return send(200,routing.read());
if(url.pathname==='/api/routing/models')return send(200,await models.all(url.searchParams.get('refresh')==='1'));
if(url.pathname==='/api/native/capability'){const id=url.searchParams.get('id'),provider=url.searchParams.get('provider');if(!runtime.execution)return send(200,{available:false,routing:true,note:runtime.demo?'示範模式：全部為虛構資料，不會呼叫 AI 或讀取你的紀錄。':'執行功能未啟用，目前只讀取已設定的來源。'});if(options.readOnly??process.env.CANTUS_PANEL_READ_ONLY==='1')return send(200,{available:false,note:'面板目前只供瀏覽。'});if(!catalog.scannedAt){await scan();enrichCodex(catalog.sessions);}return send(200,{...await handoff.capability(id,provider==='auto'?undefined:provider),routing:true});}
if(url.pathname==='/api/native/status')return send(200,runnerFor(url.searchParams.get('id')).status(url.searchParams.get('id')));
if(files[url.pathname]){const [file,type]=files[url.pathname];return send(200,fs.readFileSync(path.join(__dirname,file)),type);}
if(url.pathname==='/api/sessions'){if(!catalog.scannedAt||Date.now()-Date.parse(catalog.scannedAt)>=15000||url.searchParams.get('refresh')==='1'){await scan();enrichCodex(catalog.sessions);}const linked=new Set(handoff.records.keys());server.lineage ||= options.lineage||new LineageStore();return send(200,catalogDeltas.reply(server.lineage.catalog(presentCatalog({...catalog,sessions:catalog.sessions.filter(s=>!linked.has(s.id)&&!s.cwd?.startsWith(path.join(__dirname,'state','managed')+path.sep))},[...handoff.list(),...managed.list().filter(s=>!linked.has(s.id))],url.searchParams.get('background')==='1')),url.searchParams.get('since')||''));}
if(url.pathname==='/api/history'&&handoff.records.has(url.searchParams.get('id')))return send(200,handoff.history(url.searchParams.get('id'),{before:url.searchParams.has('before')?Number(url.searchParams.get('before')):null,pageSignature:url.searchParams.get('signature')}));
if(url.pathname==='/api/history'&&url.searchParams.get('id')?.startsWith('panel_'))return send(200,managed.history(url.searchParams.get('id')));
if(url.pathname==='/api/history'){
 if(!catalog.scannedAt)await scan();
 const id=url.searchParams.get('id'),provider=url.searchParams.get('provider');
 const entry=catalog.sessions.find(x=>x.id===id&&x.provider===provider);
 if(!entry)return send(404,{error:'找不到這個會話，請重新整理'});
 if(!entry.hasTranscript)return send(409,{error:'只有會話索引，原始對話內容尚無法讀取'});
 const before=url.searchParams.has('before')?Number(url.searchParams.get('before')):null,signature=url.searchParams.get('signature')||undefined;
 if(!runtime.demo){
  independentHistory=true;
  if(!server.histories){server.histories=createHistoryReader({root:runtime.codexHome,claudeProjectsDir:runtime.claudeConfig+'/projects',claudeDesktopDir:runtime.claudeDesktop});server.once('close',()=>server.histories.close());}
  return send(200,await server.histories.read({provider,id,before,signature}));
 }
 const history=await sources[provider].read(id,{page:true,before,pageSignature:signature});return send(200,{...history,readOnly:true});
}
return send(404,{error:'找不到頁面'});}catch(e){const errors={stale:'原始會話正在更新，請按重新整理再讀取。',limit:'此會話超過安全讀取上限，請從原 App 查看。',missing:'原始會話檔案已不存在。'};send(e.status||409,{code:e.code||'source',...(independentHistory?{historyIndependent:true}:{}),error:url.pathname.startsWith('/api/native/')||url.pathname.startsWith('/api/routing/')||['/api/lineage','/api/pair','/api/dispatch'].includes(url.pathname)?e.message:errors[e.code]||'暫時無法讀取此會話。'});}});server.requestTimeout=15000;server.headersTimeout=10000;server.native=native;server.managed=managed;server.handoff=handoff;server.routing=routing;return server;}
if(require.main===module)createServer().listen(PORT,'127.0.0.1',()=>console.log(`Cantus web: ${origin}`));
module.exports={createServer};
