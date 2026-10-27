/* Native continuation UI; all provider text is rendered as text, never HTML. */
const originalSelect=select,drafts=new Map(),pendingSends=new Map(),providerChoices=new Map();let nativePoll,csrfToken,nativeSelection=0;
// Queues belong to this browser tab. Requests keep their original host/account.
const messageQueues=new Map(),queueStorageKey='cantus-message-queues-v1';
try{for(const [key,q] of JSON.parse(sessionStorage.getItem(queueStorageKey)||'[]'))if(q&&Array.isArray(q.items)&&q.items.length)messageQueues.set(key,{...q,paused:true,reason:'重新整理後已暫停，請確認後繼續。'});}catch{}
function saveQueues(){try{sessionStorage.setItem(queueStorageKey,JSON.stringify([...messageQueues].filter(([,q])=>q.items.length).map(([key,q])=>[key,{id:q.id,items:q.items,waiting:q.waiting,paused:q.paused,reason:q.reason}])));}catch{}}
function queueChanged(){saveQueues();document.dispatchEvent(new Event('cantus-queue-change'));}
async function drainQueue(key,q){
  if(q.working||q.paused||!q.items.length||!q.transport)return;
  q.working=true;
  try{
    const v=await q.transport.get('/api/native/status?id='+encodeURIComponent(q.id));
    if(q.paused||!q.items.length)return;
    if(q.reason){q.reason='';queueChanged();}
    const item=q.items[0];
    if(item.submitting){
      if(v.requestId===item.requestId){q.items.shift();q.waiting=v.requestId;queueChanged();return;}
      q.paused=true;q.reason='上一則送出結果不明；請核對記錄，未自動重送。';queueChanged();return;
    }
    if(v.busy)return;
    if(q.waiting&&(v.requestId!==q.waiting||v.phase!=='completed')){q.paused=true;q.reason='上一回合未正常完成，排隊已暫停。';queueChanged();return;}
    item.submitting=true;queueChanged();
    pendingSends.set(key,{...item,state:'正在送出…'});
    try{
      const sent=await q.transport.post({id:q.id,text:item.text,requestId:item.requestId,provider:item.provider,...(q.transport.revisions?{revision:v.revision}:{})});
      q.items.shift();q.waiting=sent.requestId||item.requestId;
      const pending=pendingSends.get(key);if(pending?.requestId===item.requestId)pending.state='已送出';queueChanged();
    }catch(e){q.paused=true;q.reason='送出未確認；未自動重送。'+friendlyNativeError(e);queueChanged();}
  }catch(e){q.paused=[401,403].includes(e.status);q.reason=q.paused?'登入或權限已變更，請重新登入後繼續排隊。':'連線中斷，排隊保留；尚未送出。';queueChanged();}
  finally{q.working=false;if(q.paused)queueChanged();}
}
setInterval(()=>{for(const [key,q] of messageQueues)void drainQueue(key,q);},900);
addEventListener('beforeunload',e=>{if([...messageQueues.values()].some(q=>q.items.length)){e.preventDefault();e.returnValue='';}});
const createBox=el('div','panel-create');
for(const provider of ['auto','codex','claude']){const button=el('button','nav',provider==='auto'?'＋ 新對話':'＋ 新 '+(provider==='codex'?'Codex':'Claude')+' 對話');button.dataset.provider=provider;button.hidden=provider!=='auto';button.onclick=async()=>{for(const b of createBox.querySelectorAll('button'))b.disabled=true;const oldBox=document.querySelector('.composer');if(oldBox){for(const c of oldBox.querySelectorAll('textarea,button'))c.disabled=true;oldBox.querySelector('.native-state').textContent='正在建立新對話…';}try{const target=provider==='auto'?(window.cantusPlatform?.providers?.[0]||'codex'):provider;const s=await postNative('create',{provider:target});await load();await select(s);}catch(e){toast(friendlyNativeError(e));const s=catalog.sessions.find(s=>s.id===selected);if(s)await select(s);}finally{for(const b of createBox.querySelectorAll('button'))b.disabled=false;}};createBox.append(button);}
document.querySelector('.sidebar').insertBefore(createBox,document.querySelector('.sources-label'));
async function postNative(action,body){
  const key=window.cantusPlatform?.key(body.id),generation=window.cantusPlatform?.generation;
  csrfToken ||= (await api('/api/bootstrap')).csrf;
  if(key!==window.cantusPlatform?.key(body.id)||generation!==window.cantusPlatform?.generation)throw Error('已切換平台，未送出。');
  if(window.cantusPlatform?.mode==='cloud'&&window.cantusPlatform.host!=='m1'&&action==='send')body={...body,revision:Number(document.querySelector('.composer')?.dataset.labRevision)};
  const r=await (window.cantusPlatform?.fetch||fetch)('/api/native/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Cantus-Token':csrfToken},body:JSON.stringify(body)});
  const value=await r.json();if(!r.ok)throw Object.assign(Error(friendlyNativeError(value.error||'送出失敗')),{status:r.status,code:value.code});return value;
}
select=async function(s){
  const generation=++nativeSelection;
  clearTimeout(nativePoll);
  const historyReady=originalSelect(s);if(selected!==s.id||generation!==nativeSelection)return;
  const transcript=el('div','transcript-scroll');transcript.append(...$('detail').childNodes);$('detail').append(transcript);
  if(s.managed)transcript.querySelector('.eyebrow').textContent=s.provider.toUpperCase()+(s.shared?' / SHARED SESSION':' / PANEL SESSION');
  const box=el('section','composer'),label=el('label','',s.shared?'接著聊 · '+(window.cantusPlatform?.label||'目前工作區')+' 共用對話':s.handoff?'接著聊 · Codex / Claude 接續':s.managed?'接著聊 · 面板獨立對話':'接著聊 · 原生 session');
  const draftKey=window.cantusPlatform?.key(s.id)||s.id;
  const providerPicker=el('select','provider-picker');providerPicker.setAttribute('aria-label','回覆 AI');providerPicker.hidden=true;
  for(const p of window.cantusPlatform?.providers||['codex','claude']){const option=el('option','',p==='codex'?'Codex':'Claude');option.value=p;providerPicker.append(option);}providerPicker.value=providerChoices.get(draftKey)||s.provider;
  const note=el('p','native-note','正在確認原生續作…'),retryCapability=el('button','','重新確認'),input=el('textarea');retryCapability.type='button';retryCapability.hidden=true;input.placeholder='接著這段對話說…';input.setAttribute('aria-label','續聊訊息');input.maxLength=24000;input.value=drafts.get(draftKey)||'';input.oninput=()=>{drafts.set(draftKey,input.value);previewRoute();};
  const routingNote=el('p','routing-chat-note');routingNote.hidden=true;let lastRoute=null;
  function previewRoute(){const config=window.cantusRouting?.config,origin=s.sourceProvider||s.provider;if(providerPicker.value!=='auto'||!config){const cross=providerPicker.value&&providerPicker.value!==origin;routingNote.hidden=!cross;routingNote.textContent=cross?'切換 AI 會使用另一個原生對話接續；文字背景會交接，不會把回覆寫進原 AI 對話。':'';return;}routingNote.hidden=false;const d=input.value.trim()?CantusRules.choose(config,input.value,lastRoute):lastRoute;routingNote.textContent=d?((d.provider==='codex'?'Codex':'Claude')+' · '+(d.model||'原工具設定')+' — '+d.ruleName+'；'+d.reason):'自動派工已開啟 · 輸入訊息即可預覽負責的 AI';}
  if(window.cantusRouting)window.cantusRouting.preview=()=>{if(box.isConnected)previewRoute();};
  const actions=el('div','composer-actions'),send=el('button','send-message','送出'),stop=el('button','stop-message','停止本回合'),state=el('span','native-state',''),live=el('div','native-response'),approvals=el('div','native-approvals');live.setAttribute('aria-live','polite');
  const liveMessage=el('article','message assistant live-message'),liveHead=el('div','message-head');
  liveHead.append(brandIcon(s.provider,'mini-avatar'),el('span','',s.provider==='codex'?'Codex':'Claude'));live.classList.add('message-body');liveMessage.append(liveHead,live);liveMessage.hidden=true;transcript.append(liveMessage);
  const queueList=el('div','native-queue');queueList.setAttribute('aria-label','待送訊息');
  send.disabled=true;stop.hidden=true;actions.append(state,providerPicker,stop,send);label.append(input);box.append(note,retryCapability,label,routingNote,actions,queueList,approvals);$('detail').append(box);
  transcript.scrollTop=transcript.scrollHeight;
  let optimistic;
  function showPending(p){
    if(!p)return;
    if([...transcript.querySelectorAll('[data-request-id]')].some(a=>a.dataset.requestId===p.requestId))return;
    const persisted=[...transcript.querySelectorAll('.message.user')].some(a=>a.dataset.sentAt&&a.dataset.sentAt>=p.at&&a.messageText===p.text);
    if(persisted)return;
    optimistic=messageArticle({role:'user',text:p.text,at:p.at},s);optimistic.dataset.requestId=p.requestId;
    optimistic.append(el('small','delivery-state',p.state));transcript.insertBefore(optimistic,liveMessage);transcript.scrollTop=transcript.scrollHeight;
  }
  showPending(pendingSends.get(draftKey));
  let historyLoaded=false,available=false,busy=false,polling=false,sending=false,lastApproval='',lastStatus={};
  function renderQueue(){
    queueList.replaceChildren();const q=messageQueues.get(draftKey);if(!q?.items.length)return;
    queueList.append(el('p','native-note',q.reason||'已排隊 '+q.items.length+' 則 · 保持此分頁開啟，完成後依序送出。'));
    for(const item of q.items){const row=el('div','approval'),text=el('p','',item.text),cancel=el('button','',item.submitting?'移除待確認項目':'取消排隊');text.style.whiteSpace='pre-wrap';text.style.overflowWrap='anywhere';cancel.disabled=q.working&&item.submitting;cancel.onclick=()=>{q.items=q.items.filter(x=>x!==item);queueChanged();};row.append(text,cancel);queueList.append(row);}
    if(q.paused&&!q.items.some(x=>x.submitting)){const resume=el('button','','繼續排隊');resume.onclick=()=>{q.transport=queueTransport();q.paused=false;q.waiting=null;q.reason='';queueChanged();void drainQueue(draftKey,q);};queueList.append(resume);}
  }
  function queueTransport(){return window.cantusPlatform.capture();}
  const queueListener=()=>{if(!box.isConnected){document.removeEventListener('cantus-queue-change',queueListener);return;}renderQueue();showPending(pendingSends.get(draftKey));if(!polling&&!sending)void poll();};
  document.addEventListener('cantus-queue-change',queueListener);renderQueue();
  const phases={idle:'',preparing:'正在接回原會話…',running:'回覆中…',approval:'等待你確認權限',completed:s.handoff?'已完成 · 接續對話記錄已更新':'已完成 · 原始記錄已更新',failed:'未完成',stopped:'已停止'};
  function renderStatus(v){
    if(v.routing){lastRoute={...v.routing,model:v.model||v.routing.model};previewRoute();}
    if(v.revision!==undefined)box.dataset.labRevision=String(v.revision);
    lastStatus=v;busy=v.busy;send.disabled=!historyLoaded||sending||window.cantusPlatform?.role==='viewer'||(!available&&!busy);input.disabled=false;providerPicker.disabled=busy;stop.hidden=!busy;send.textContent=busy||messageQueues.get(draftKey)?.items.length?'加入排隊':'送出';
    liveHead.lastChild.textContent=(v.provider||providerPicker.value)==='codex'?'Codex':'Claude';liveHead.firstChild.className='mini-avatar brand-icon brand-'+((v.provider||providerPicker.value)==='claude'?'claude':'codex');
    state.textContent=v.error?friendlyNativeError(v.error):(phases[v.phase]??'處理中…');
    if(v.phase==='completed'&&!v.historyUpdated)state.textContent='這則訊息先前已送出，請重新讀取記錄。';
    const nearBottom=transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight<80;
    const liveText=v.phase==='completed'?'':friendlyFailureText(v.text||'');renderMessageContent(live,liveText);liveMessage.hidden=!liveText;
    if(nearBottom&&!liveMessage.hidden)transcript.scrollTop=transcript.scrollHeight;
    const key=JSON.stringify(v.approvals);if(key!==lastApproval){lastApproval=key;approvals.replaceChildren();for(const a of v.approvals||[]){
      const card=el('div','approval'),title=el('strong','','需要你的批准：'+a.kind),details=el('pre','',JSON.stringify(a.detail,null,2)),yes=el('button','','允許這一次'),no=el('button','','拒絕');
      const answer=async allow=>{yes.disabled=no.disabled=true;try{renderStatus(await postNative('answer',{id:s.id,approvalId:a.id,allow}));}catch(e){state.textContent=friendlyNativeError(e);}finally{yes.disabled=no.disabled=false;}};
      yes.onclick=()=>answer(true);no.onclick=()=>answer(false);card.append(title,details,no,yes);approvals.append(card);
    }}
  }
  async function poll(){
    if(selected!==s.id||generation!==nativeSelection||!box.isConnected)return;if(polling){clearTimeout(nativePoll);nativePoll=setTimeout(poll,250);return;}polling=true;
    try{const requestedPending=pendingSends.get(draftKey)?.requestId,v=await api('/api/native/status?id='+encodeURIComponent(s.id));if(selected!==s.id||generation!==nativeSelection||!box.isConnected)return;
      const pending=pendingSends.get(draftKey);
      if(pending&&pending.requestId===v.requestId&&(v.busy||v.phase==='completed')){pending.state='已送出';showPending(pending);if(optimistic)optimistic.querySelector('.delivery-state').textContent='已接收 · 正在處理';if(pending.restoredDraft&&input.value===pending.text){input.value='';drafts.delete(draftKey);}pending.restoredDraft=false;}
      if(pending&&pending.requestId===v.requestId&&!v.busy&&v.phase==='failed'){pending.state='未完成；文字已保留';showPending(pending);}
      if(requestedPending!==pending?.requestId){nativePoll=setTimeout(poll,900);return;}
      if(pending&&pending.requestId!==v.requestId&&sending){nativePoll=setTimeout(poll,900);return;}
      if(pending&&pending.requestId===v.requestId&&!v.busy&&v.phase==='completed'){pendingSends.delete(draftKey);await load(true);if(selected===s.id&&generation===nativeSelection)await select(catalog.sessions.find(x=>x.id===s.id)||s,{background:true});}
      else{const wasBusy=busy;renderStatus(v);if(pending?.state.startsWith('送出未確認')&&pending.requestId!==v.requestId){state.textContent='尚未取得這筆送出結果，正在查詢；未自動重送。';send.disabled=true;}if(!v.busy&&wasBusy&&!retryCapability.disabled){retryCapability.disabled=true;try{await checkCapability();}catch(e){capabilityFailed(e);}finally{retryCapability.disabled=false;}}if(v.busy||messageQueues.get(draftKey)?.items.length||pending?.state.startsWith('送出未確認'))nativePoll=setTimeout(poll,v.busy?900:5000);}
    }catch(e){state.textContent='暫時讀不到工作狀態，未自動重送。'+friendlyNativeError(e);nativePoll=setTimeout(poll,2500);}finally{polling=false;}
  }
  send.onclick=async()=>{
    const pendingActive=pendingSends.get(draftKey),awaitingStatus=pendingActive&&pendingActive.requestId!==lastStatus.requestId&&['正在送出…','已送出'].includes(pendingActive.state);
    if(!historyLoaded||sending||window.cantusPlatform?.role==='viewer'||(!busy&&!awaitingStatus&&!available)||!input.value.trim())return;
    const text=input.value,requestId=crypto.randomUUID();
    if(busy||awaitingStatus||messageQueues.get(draftKey)?.items.length){
      const q=messageQueues.get(draftKey)||{id:s.id,items:[],waiting:lastStatus.requestId,paused:false};
      if(q.items.length>=20){state.textContent='最多排隊 20 則，文字仍保留。';return;}
      if(!q.items.length){q.waiting=awaitingStatus?pendingActive.requestId:lastStatus.requestId;q.paused=false;q.reason='';q.transport=queueTransport();}
      q.transport ||= queueTransport();q.items.push({text,requestId,provider:providerPicker.value,at:new Date().toISOString()});messageQueues.set(draftKey,q);input.value='';drafts.delete(draftKey);queueChanged();return;
    }
    busy=true;sending=true;send.disabled=true;input.disabled=false;providerPicker.disabled=true;state.textContent='正在送出…';
    const pending={text,requestId,at:new Date().toISOString(),state:'正在送出…'};pendingSends.set(draftKey,pending);input.value='';drafts.delete(draftKey);showPending(pending);
    try{const v=await postNative('send',{id:s.id,text,requestId,...(!providerPicker.hidden?{provider:providerPicker.value}:{})});pending.state='已送出';if(optimistic)optimistic.querySelector('.delivery-state').textContent=pending.state;renderStatus(v);poll();}
    catch(e){pending.state=(!e.status||e.status>=500)?'送出未確認；文字已保留，未自動重送':'送出遭拒；文字已保留，未自動重送';if(optimistic)optimistic.querySelector('.delivery-state').textContent=pending.state;state.textContent=pending.state.startsWith('送出未確認')?'未收到送出確認，正在查詢工作狀態；不代表主機離線。':friendlyNativeError(e);if(!input.value){input.value=text;drafts.set(draftKey,text);pending.restoredDraft=true;}busy=false;send.disabled=!available;input.disabled=false;providerPicker.disabled=false;clearTimeout(nativePoll);nativePoll=setTimeout(poll,0);}
    finally{sending=false;send.disabled=!available&&!busy;}
  };
  input.onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();send.click();}};
  stop.onclick=async()=>{stop.disabled=true;try{renderStatus(await postNative('stop',{id:s.id}));}catch(e){state.textContent=friendlyNativeError(e);}finally{stop.disabled=false;}};
  let capabilityRequest=0;
  async function checkCapability(){const seq=++capabilityRequest,cap=await api('/api/native/capability?id='+encodeURIComponent(s.id)+'&provider='+providerPicker.value);if(selected!==s.id||generation!==nativeSelection||seq!==capabilityRequest)return;if(cap.routing&&!providerPicker.querySelector('option[value="auto"]')){const current=providerPicker.value,auto=el('option','','自動派工');auto.value='auto';providerPicker.prepend(auto);providerPicker.value=current;}available=cap.available;providerPicker.hidden=!cap.switchable;retryCapability.hidden=!!cap.available;note.textContent=cap.available?cap.note:friendlyNativeError(cap.note);send.disabled=!historyLoaded||sending||window.cantusPlatform?.role==='viewer'||(!busy&&!available);input.disabled=false;if(cap.available)$('detail').querySelector('.pill').textContent=s.handoff?'跨 AI 接續':s.managed?'面板獨立對話':'可原生續聊';previewRoute();return cap;}
  function capabilityFailed(e){available=false;send.disabled=true;note.textContent='無法確認原生續作，草稿已保留。'+friendlyNativeError(e);retryCapability.hidden=false;}
  retryCapability.onclick=async()=>{if(retryCapability.disabled)return;retryCapability.disabled=true;note.textContent='正在確認原生續作…';try{await checkCapability();void poll();}catch(e){capabilityFailed(e);}finally{retryCapability.disabled=false;}};
  providerPicker.onchange=async()=>{providerChoices.set(draftKey,providerPicker.value);send.disabled=true;available=false;try{await checkCapability();}catch(e){capabilityFailed(e);}};
  void historyReady.then(ok=>{if(selected!==s.id||generation!==nativeSelection||!box.isConnected)return;historyLoaded=ok!==false;send.disabled=!historyLoaded||sending||window.cantusPlatform?.role==='viewer'||(!available&&!busy);transcript.scrollTop=transcript.scrollHeight;});
  try{const cap=await checkCapability();if(cap?.available){$('context').append(el('label','','目前 AI 原生 Session ID'),el('p','',cap.sourceSessionId));}await poll();}catch(e){capabilityFailed(e);}
};
