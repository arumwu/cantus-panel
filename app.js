const $=id=>document.getElementById(id);let catalog={sessions:[],providers:[]},filter='all',selected=null,request=0;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const brandIcon=(provider,cls='')=>{const n=el('span','brand-icon brand-'+(provider==='codex'?'codex':'claude')+' '+cls);n.setAttribute('aria-hidden','true');return n;};
const date=t=>t?new Date(t).toLocaleDateString('zh-TW',{month:'short',day:'numeric'}):'日期未知';
const name=s=>s.title||s.projectName||'未命名會話';
// Navigation reads the existing catalog; it never creates or resumes a turn.
let workNavigation=0;
window.cantusOpenWork=async target=>{
 const ticket=++workNavigation;
 try{
  const desired=target.platform==='cloud'?(target.machine||target.host):'local',platform=window.cantusPlatform;
  if(desired!=='local'&&desired!==platform?.host&&!(desired==='m1'&&platform?.activate))return false;
  const current=platform?.mode==='cloud'?platform.host||'local':'local';
  if(current!==desired){if(!platform?.activate){toast('請先切換到此工作的主機');return false;}await platform.activate(desired);}
  if(ticket!==workNavigation)return false;
  if(desired!=='local'&&!platform?.authenticated){toast('請先登入此工作所屬的主機');return false;}
  const gen=platform?.generation;
  const r=await (platform?.fetch||fetch)('/api/sessions?background=1'),data=await r.json();if(!r.ok)throw Error(data.error||'無法讀取對話');if(gen!==platform?.generation||ticket!==workNavigation)return false;
  let matches=[];
  if(target.sessionId)matches=data.sessions.filter(s=>s.id===target.sessionId);
  else if(desired==='local'&&target.nativeSessionId&&target.cwd){const bytes=new TextEncoder().encode(target.nativeSessionId+'\0'+target.cwd),digest=await crypto.subtle.digest('SHA-256',bytes),identity=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');matches=data.sessions.filter(s=>s.provider===target.provider&&s.identity===identity);}
  if(gen!==platform?.generation||ticket!==workNavigation)return false;
  if(matches.length!==1){toast('找不到唯一對應的原對話；保留唯讀詳情，不建立新 session。');return false;}
  const s=matches[0];if(!catalog.sessions.some(x=>x.id===s.id))catalog.sessions.push(s);
  $('work').click();if(selected!==s.id)await select(s);else renderList(s.id);document.dispatchEvent(new Event('cantus-work-opened'));return true;
 }catch(e){toast(friendlyNativeError(e));return false;}
};
const conversationOpen=new Map();
function toast(t){$('toast').textContent=t;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',4500);}
let catalogReadCache=null;
async function api(url){
 const generation=window.cantusPlatform?.generation,isCatalog=url.startsWith('/api/sessions');
 const cacheKey=String(generation)+':'+(window.cantusPlatform?.key('catalog')||'local');
 const saved=isCatalog&&catalogReadCache?.key===cacheKey?catalogReadCache:null;
 const current=()=>{if(generation!==window.cantusPlatform?.generation)throw Object.assign(Error('平台已切換，已略過舊回應'),{code:'platform-changed'});};
 if(url.startsWith('/api/sessions'))url+=(url.includes('?')?'&':'?')+'background=1';
 for(let attempt=0;attempt<2;attempt++){
  current();
  try{
   const readUrl=url;
   const requestUrl=isCatalog&&saved?.value.catalogVersion?readUrl+'&since='+saved.value.catalogVersion:readUrl;
   const r=await (window.cantusPlatform?.fetch||fetch)(requestUrl);current();
   if([502,503,504].includes(r.status))throw Object.assign(Error('目前連線不穩，請稍後再試。'),{status:r.status});
   if(r.status===401)throw Object.assign(Error('登入已失效，請重新登入後再試。'),{status:401});
   let data=await r.json();current();
   if(!r.ok)throw Object.assign(Error(data.error||'讀取失敗'),{status:r.status,code:data.code,historyIndependent:data.historyIndependent===true});
   if(isCatalog){
    let status=$('catalog-cache-status');if(!status){status=el('p','native-note catalog-cache-status');status.id='catalog-cache-status';status.setAttribute('role','status');$('list').before(status);}
    const cache=data.catalogCache;status.textContent=cache?.stale?(cache.failed?'清單更新失敗，暫顯先前快照；可按重新整理重試。':'先顯示清單快照，正在背景更新…'):'';status.hidden=!cache?.stale;
    if(data.notModified){if(!saved||data.catalogVersion!==saved.value.catalogVersion)throw Error('清單版本不一致');data={...saved.value,catalogCache:data.catalogCache};catalogReadCache={key:cacheKey,value:data};return data;}
    if(data.delta){
     if(!saved)throw Error('清單缺少基準版本');
     const rows=new Map(saved.value.sessions.map(s=>[s.id,s]));for(const id of data.removed||[])rows.delete(id);for(const s of data.sessions)rows.set(s.id,s);
     const {delta,removed,order,...meta}=data;data={...saved.value,...meta,sessions:order?order.map(id=>rows.get(id)).filter(Boolean):[...rows.values()]};
    }
    catalogReadCache={key:cacheKey,value:data};
   }
   return data;
  }catch(e){
   current();
   const freshHistory=url.startsWith('/api/history?')&&!new URLSearchParams(url.split('?')[1]).has('before');
   if(attempt===0&&e.code==='stale'&&freshHistory){if(!e.historyIndependent)await api('/api/sessions?refresh=1');current();continue;}
   if(attempt===0&&([502,503,504].includes(e.status)||/network|fetch|load failed|connection|offline|ECONN|ENOTFOUND/i.test(e.message))){await new Promise(resolve=>setTimeout(resolve,400));continue;}
   throw e;
  }
 }
}
function visible(){return catalog.sessions.filter(s=>filter==='all'||filter==='projects'||filter===s.provider||filter==='today'&&new Date(s.updatedAt).toDateString()===new Date().toDateString());}
function visibleProjects(){return (catalog.projects||[]).filter(p=>filter==='all'||filter==='projects'||filter===p.provider);}
const listNodes=new Map();let listScope='';
function syncListChildren(parent,nodes){
 const keep=new Set(nodes);for(const child of [...parent.children])if(!keep.has(child))child.remove();
 nodes.forEach((node,i)=>{if(parent.children[i]!==node)parent.insertBefore(node,parent.children[i]||null);});
}
function renderList(revealId){
 const list=$('list'),scroll=list.scrollTop,query=$('search').value,scope=window.cantusPlatform?.key('conversation-tree')||'local';
 if(scope!==listScope){listNodes.clear();listScope=scope;}
 const used=new Set(),groups=CantusConversations.build(visible(),{query,projects:visibleProjects(),folders:catalog.cantusFolders||[]});
 $('projectCount').textContent=CantusConversations.build(catalog.sessions,{projects:catalog.projects||[],folders:catalog.cantusFolders||[]}).filter(g=>g.kind==='project').length;
 $('listCount').textContent=`${groups.reduce((sum,g)=>sum+g.count,0).toLocaleString()} 段會話`;$('listTitle').textContent=filter==='today'?'今天':filter==='codex'?'Codex':filter==='claude'?'Claude':'專案與會話';
 const contains=n=>n.session.id===revealId||n.children.some(contains),groupContains=g=>g.roots.some(contains)||(g.subgroups||[]).some(groupContains);
 function branch(n,depth=0){
  const s=n.session,key=scope+':branch:'+s.id;used.add(key);let item=listNodes.get(key);
  if(!item){item={box:el('div','conversation-item'),row:el('div','conversation-row'),children:el('div','conversation-children')};item.box.dataset.sessionId=s.id;item.box.append(item.row,item.children);listNodes.set(key,item);}
  const signature=JSON.stringify([s,depth,n.relation,n.children.length]);
  if(item.signature!==signature){
   item.signature=signature;const b=el('button','session');b.title=[name(s),s.source,s.cwd].filter(Boolean).join('\n');b.append(el('h3','',name(s)));const meta=el('div','conversation-meta');meta.append(el('span','',s.provider==='codex'?'Codex':'Claude'),el('time','',date(s.updatedAt)));if(!s.hasTranscript)meta.append(el('span','','僅有索引'));if(depth)meta.append(el('span','',n.relation==='fork'?'分支':n.relation==='spawn'?'派生對話':'子會話'));b.append(meta);b.onclick=()=>select(s);item.button=b;
   item.toggle=n.children.length?el('button','branch-toggle'):el('span','branch-spacer');if(n.children.length){item.toggle.type='button';item.toggle.setAttribute('aria-label','展開分支：'+name(s));item.toggle.title=n.children.length+' 個直接分支';item.toggle.onclick=()=>{conversationOpen.set(key,item.children.hidden);renderList();};}item.row.replaceChildren(item.toggle,b);delete item.row.dataset.mobileMenu;
  }
  item.button.classList.toggle('selected',selected===s.id);item.button.setAttribute('aria-pressed',String(selected===s.id));
  const opened=!!query.trim()||contains(n)||conversationOpen.get(key)===true;if(revealId&&contains(n))conversationOpen.set(key,true);item.children.hidden=!opened;
  if(n.children.length){const glyph=opened?'▾':'▸';if(item.toggle.textContent!==glyph)item.toggle.textContent=glyph;item.toggle.setAttribute('aria-expanded',String(opened));}
  syncListChildren(item.children,opened?n.children.map(c=>branch(c,depth+1)):[]);return item.box;
 }
 function groupView(g,topLevel=true){
  const project=g.kind==='project',codex=project&&g.provider==='codex',key=scope+':group:'+g.key;used.add(key);let item=listNodes.get(key);
  if(!item){
   item={details:el('details','conversation-group'+(topLevel?' folder-group':'')+(codex?' codex-project':'')),summary:el('summary'),title:el('span','conversation-group-title'),count:el('span','conversation-count'),body:el('div','conversation-group-body')};item.details.dataset.groupKey=g.key;
   if(topLevel){const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('class','conversation-folder');icon.setAttribute('aria-hidden','true');for(const [state,d]of [['open','M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1M3 7h16a2 2 0 0 1 2 3l-3 9H5a2 2 0 0 1-2-2Z'],['closed','M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z']]){const line=document.createElementNS(icon.namespaceURI,'path');line.setAttribute('class','folder-'+state);line.setAttribute('d',d);icon.append(line);}item.summary.append(icon);}
   item.summary.append(item.title);if(project&&g.provider)item.summary.append(el('span','conversation-provider',g.provider==='codex'?'Codex':'Claude'));item.summary.append(item.count);item.details.append(item.summary,item.body);item.summary.onclick=e=>{e.preventDefault();conversationOpen.set(key,!item.details.open);renderList();};listNodes.set(key,item);
  }
  if(g.cantusFolderId)item.details.dataset.cantusFolderId=g.cantusFolderId;else delete item.details.dataset.cantusFolderId;
  item.summary.title=g.path||g.source||g.name;if(item.title.textContent!==g.name)item.title.textContent=g.name;if(item.count.textContent!==String(g.count))item.count.textContent=String(g.count);
  const opened=!!query.trim()||groupContains(g)||(conversationOpen.has(key)?conversationOpen.get(key):project&&g.defaultExpanded!==false);if(revealId&&groupContains(g))conversationOpen.set(key,true);item.details.open=!!opened;
  const nodes=[];
  if(opened){
   if(g.subgroups?.length){item.help ||= el('p','conversation-help','原工具尚無專案分類，依工作資料夾收納。');nodes.push(item.help,...g.subgroups.map(sub=>groupView(sub,false)));}
   const moreKey=key+':more',all=!!query.trim()||groupContains(g)||conversationOpen.get(moreKey)===true,limit=project&&!all?5:g.roots.length;nodes.push(...g.roots.slice(0,limit).map(n=>branch(n)));
   if(project&&!g.count){item.empty ||= el('p','conversation-empty','沒有對話');nodes.push(item.empty);}
   if(project&&g.roots.length>5&&!query.trim()){item.more ||= el('button','conversation-more');const label=all?'顯示較少':'顯示更多';if(item.more.textContent!==label)item.more.textContent=label;item.more.onclick=()=>{conversationOpen.set(moreKey,!all);renderList();};nodes.push(item.more);}
  }
  syncListChildren(item.body,nodes);return item.details;
 }
 syncListChildren(list,groups.map(g=>groupView(g)));if(!groups.length)list.replaceChildren(el('div','empty','沒有符合的會話，試試其他關鍵字。'));
 for(const key of listNodes.keys())if(!used.has(key))listNodes.delete(key);list.scrollTop=scroll;
}
function isBackgroundNotification(row){
  if(row.role!=='user'||typeof row.text!=='string')return false;
  // Match an entire generated envelope, not quoted XML, code fences or prose.
  const text=row.text.trim();
  return /^<task-notification>\s*<task-id>[A-Za-z0-9_-]+<\/task-id>\s*(?:<tool-use-id>[^<>]+<\/tool-use-id>\s*)?(?:<output-file>[^<>]+<\/output-file>\s*)?<status>(?:completed|failed|killed|stopped|cancelled|running)<\/status>\s*<summary>[\s\S]*?<\/summary>\s*<\/task-notification>$/.test(text)||
    /^<task-notification>\s*<task-id>[A-Za-z0-9_-]+<\/task-id>\s*<summary>Monitor event:[^<>]*<\/summary>\s*<event>[^<>]+<\/event>\s*<\/task-notification>$/.test(text);
}
// Display-only folding: retain every original character and never interpret HTML.
function messageParts(text){
 const parts=[],start=/^[ \t]*(?:(`{3,}|~{3,})[^\n]*\n|<(environment_context|turn-context|turn_context|oai-mem-citation|system-reminder|instructions|INSTRUCTIONS|permissions instructions|skills_instructions|app-context)(?:\s[^>]*|)>|(:{1,2}codex-file-citation\{[^\n]*\}))/gm;let cursor=0,match;
 while((match=start.exec(text))){
  const at=match.index;if(at>cursor)parts.push({text:text.slice(cursor,at)});
  let end=text.length,label;
  if(match[1]){const fence=match[1],close=new RegExp('^[ \\t]*'+fence[0]+'{'+fence.length+',}[ \\t]*(?:\\r?\\n|$)','gm');close.lastIndex=start.lastIndex;const found=close.exec(text);if(found)end=close.lastIndex;label='程式碼';}
  else if(match[3]){end=start.lastIndex;label='檔案引用';}
  else{const close='</'+match[2]+'>',atClose=text.indexOf(close,start.lastIndex);if(atClose!==-1)end=atClose+close.length;label=match[2]==='oai-mem-citation'?'引用紀錄':'系統資訊';}
  parts.push({text:text.slice(at,end),label});cursor=end;start.lastIndex=end;
 }
 if(cursor<text.length)parts.push({text:text.slice(cursor)});return parts;
}
function friendlyWriterConflict(text){
 return String(text??'').replace(/(?:［未完成］\s*)?thread\s+[a-z0-9-]+\s+already has an active writer\.?/gi,'這個對話正在其他地方執行，請等它完成後再試。');
}
function friendlyNativeError(error){
 const raw=String(error?.message??error??''),text=friendlyWriterConflict(raw);
 if(text!==raw)return '這個對話正在其他地方執行，請等它完成後再試。';
 if(/rate.?limit|too many requests|quota|usage limit|429/i.test(raw))return '目前使用額度或次數已達上限，請稍後再試或查看帳號額度。';
 if(/unauthorized|unauthenticated|token.*expired|401/i.test(raw))return '登入已失效，請重新登入後再試。';
 if(/permission|forbidden|access denied|403/i.test(raw))return '目前沒有操作權限，請確認帳號或請管理員協助。';
 if(/busy|locked|already.*running|active writer/i.test(raw))return '這個對話正在執行，請等它完成後再試。';
 if(/conflict|revision|stale|409/i.test(raw))return '對話狀態已更新，請重新整理後再試。';
 if(/timeout|timed out/i.test(raw))return '等候回應逾時，請稍後查看結果。';
 if(/network|fetch|load failed|connection|offline|ECONN|ENOTFOUND|502|503|504/i.test(raw))return '目前連線不穩，請稍後再試。';
 if(/not found|404|no such/i.test(raw))return '找不到這個對話或資料，請重新整理後再試。';
 if(/cancelled|canceled|aborted|stopped/i.test(raw))return '這次操作已停止。';
 if(/[\u3400-\u9fff]/.test(raw)&&raw.length<100&&!/[\r\n{}]|\b(?:Error|Exception|thread|stack|stderr)\b/i.test(raw)&&!/[a-z]{12}/i.test(raw))return raw;
 return '這次操作沒有完成，請稍後再試；若持續發生，請聯絡管理員。';
}
function friendlyFailureText(text){
 return friendlyWriterConflict(String(text??'')).replace(/［未完成］([\s\S]*)$/,(_,error)=>'未完成：'+friendlyNativeError(error));
}
function renderMessageContent(container,text){
 if(container.messageText===text)return;
 const expanded=new Set([...container.querySelectorAll('details[data-part]')].filter(d=>d.open).map(d=>d.dataset.part));
 container.replaceChildren();container.messageText=text;
 for(const [index,part]of messageParts(text).entries()){
  if(!part.text.trim())continue;
  if(part.label){const details=el('details','message-fold'),pre=el('pre','message-raw',part.text);details.dataset.part=String(index);details.open=expanded.has(String(index));details.append(el('summary','',part.label+' · 點開查看原文'),pre);container.append(details);}
  else if(part.text.length>1600){container.append(el('div','message-prose',part.text.slice(0,1000)+'…'));const details=el('details','message-long');details.dataset.part=String(index);details.open=expanded.has(String(index));details.append(el('summary','','展開完整訊息'),el('div','message-prose',part.text));container.append(details);}
  else container.append(el('div','message-prose',part.text));
 }
}
function messageArticle(row,s){
  const article=el('article','message '+row.role),head=el('div','message-head');
  article.messageText=row.text;
  if(row.at)article.dataset.sentAt=row.at;
  head.append(row.role==='user'?el('span','mini-avatar','你'):brandIcon(row.provider||s.provider,'mini-avatar'),el('span','',row.role==='user'?'你':(row.provider||s.provider)==='codex'?'Codex':'Claude'),el('span','',date(row.at)));article.append(head);
  const content=el('div','message-body');renderMessageContent(content,row.role==='user'?row.text:friendlyFailureText(row.text));article.append(content);return article;
}
async function select(s){
  selected=s.id;const seq=++request;renderList(s.id);
  const source=s.shared&&window.cantusPlatform?.mode==='cloud'?window.cantusPlatform.label+' 雲端工作區':s.source;
  $('detail').replaceChildren(el('p','eyebrow',`${s.provider.toUpperCase()} / ORIGINAL SESSION`),el('h1','detail-title',name(s)));
  const meta=el('div','meta-row');meta.append(el('span','pill','歷史瀏覽'),el('span','',source||'來源未分類'),el('span','',date(s.updatedAt)));$('detail').append(meta);
  const body=el('div');body.append(el('div','empty','正在讀取原始記錄…'));$('detail').append(body);$('detail').scrollTop=0;$('context').replaceChildren();
  for(const [label,value]of [['來源',source||s.provider],['分類',s.backgroundReason||'一般會話／未標示背景'],['專案位置',s.cwd||'未記錄'],['最近更新',s.updatedAt?new Date(s.updatedAt).toLocaleString('zh-TW'):'未知'],['接入方式','原生續作 · 狀態見下方輸入框']])$('context').append(el('label','',label),el('p','',value));
  const base=`/api/history?provider=${s.provider}&id=${encodeURIComponent(s.id)}`;
  function showPage(h){
    const visibleRows=h.rows.filter(row=>!isBackgroundNotification(row));
    body.replaceChildren();
    const heading=el('div','conversation-heading');heading.append(el('span','','對話記錄'),el('span','',h.rows.length?`第 ${(h.pageStart??Math.max(0,h.totalRows-h.rows.length))+1}–${(h.pageStart??Math.max(0,h.totalRows-h.rows.length))+h.rows.length} / ${h.totalRows??h.rows.length} 則`:'0 則訊息'));body.append(heading);
    const controls=el('div','history-pages');body.append(controls);
    async function turnPage(url,button){
      button.disabled=true;
      try{const page=await api(url);if(seq!==request||!body.isConnected)return;showPage(page);const scroll=body.closest('.transcript-scroll');if(scroll)scroll.scrollTop=0;}
      catch(e){if(seq===request)toast(friendlyNativeError(e));}finally{button.disabled=false;}
    }
    if(h.hasMore){const older=el('button','history-older','查看更早 120 則');older.onclick=()=>turnPage(base+`&before=${h.nextBefore}&signature=${encodeURIComponent(h.pageSignature)}`,older);controls.append(older);}
    if(h.pageStart+h.rows.length<h.totalRows){const newest=el('button','history-newest','回到最新');newest.onclick=()=>turnPage(base,newest);controls.append(newest);}
    if(!visibleRows.length)body.append(el('div','empty',h.rows.length?'這一頁只有背景工作通知，已隱藏；可查看其他頁的對話。':'此來源目前沒有可顯示的文字訊息。'));
    for(const row of visibleRows)body.append(messageArticle(row,s));
    for(const w of h.warnings||[])body.append(el('p','empty',w));
  }
  try{const h=await api(base);if(seq!==request)return false;showPage(h);return true;}catch(e){if(seq===request)body.replaceChildren(el('div','empty',friendlyNativeError(e)));return false;}
}
let catalogRead=0;
async function load(refresh=false){
 const generation=window.cantusPlatform?.generation,ticket=++catalogRead,current=()=>generation===window.cantusPlatform?.generation&&ticket===catalogRead;
 $('refresh').disabled=true;$('connection').textContent='正在讀取來源';
 try{
  const next=await api('/api/sessions'+(refresh?'?refresh=1':''));if(!current())return;catalog=next;
  $('allCount').textContent=catalog.sessions.length;$('projectCount').textContent=CantusConversations.build(catalog.sessions).filter(g=>g.kind==='project').length;$('todayCount').textContent=catalog.sessions.filter(s=>new Date(s.updatedAt).toDateString()===new Date().toDateString()).length;
  $('providers').replaceChildren();$('warnings').replaceChildren();for(const p of ['codex','claude'])$(p+'Count').textContent='—';
  for(const p of catalog.providers){$(p.provider+'Count').textContent=p.count;const c=el('div','glass-card'),d=el('div');d.append(el('strong','',p.provider==='codex'?'Codex':'Claude'),el('p','',p.supported?'來源索引已讀取':'無法讀取'));c.append(brandIcon(p.provider,'source-icon'),d,el('span','source-number',p.count));$('providers').append(c);for(const w of p.warnings||[])$('warnings').append(el('p','',w));}
  renderList();$('connection').textContent=`${catalog.providers.filter(p=>p.supported).length} 個來源已連接`;
  if(catalog.demo)$('connection').textContent='虛構資料示範 · 未連接帳號';if(catalog.demo){document.querySelector('.sidebar-bottom').textContent='虛構資料示範 · 不會呼叫 AI';document.querySelector('.edition').textContent='DEMO';document.querySelector('.inspector .glass-card p').textContent='未連接任何帳號';};
  if(refresh&&selected){const s=catalog.sessions.find(s=>s.id===selected);if(s)await select(s,{background:true});}
 }catch(e){if(!current())return;$('connection').textContent='連接失敗';$('list').replaceChildren(el('div','empty',friendlyNativeError(e)));}
 finally{if(current())$('refresh').disabled=false;}
}
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x===b));renderList();});$('search').oninput=renderList;$('refresh').onclick=()=>load(true);document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('search').closest('.search').hidden=false;$('search').focus();}});$('work').onclick=()=>{filter='all';renderList();};$('lineage').onclick=()=>toast('目前以右側來源與專案位置呈現脈絡；跨會話關聯尚未接入。');$('live').onclick=()=>toast('選取會話後可在下方續聊、確認權限及停止面板啟動的回合。');load();
// Decorative companions stay outside the clipped frame; petting only changes their cheeks.
(()=>{
 const frame=document.querySelector('.app');if(!frame)return;
 const creatures=[
 {grid:[13,11],body:[[2,2,2,2],[8,2,2,2],[2,4,8,5],[0,6,2,2],[3,9,2,2],[7,9,2,2]],eyes:[[4,5,1,1],[7,5,1,1]],phase:0},
 {grid:[12,11],body:[[3,1,6,2],[2,3,8,6],[3,9,2,2],[7,9,2,2]],eyes:[[4,4,1,1],[7,4,1,1],[5,6,2,1]],phase:1.4},
 {grid:[13,11],body:[[3,0,2,4],[8,0,2,4],[2,4,9,5],[3,9,2,2],[8,9,2,2]],eyes:[[4,5,1,1],[8,5,1,1]],phase:2.8},
 {grid:[13,10],body:[[1,1,2,3],[10,1,2,3],[1,3,11,5],[2,8,2,2],[9,8,2,2],[12,4,1,2]],eyes:[[3,4,1,1],[7,4,1,1]],phase:4.2},
];

 const track=document.createElement('div'),parade=document.createElement('div'),motion=matchMedia('(prefers-reduced-motion: reduce)'),ns='http://www.w3.org/2000/svg';
 track.className='frame-creature-track';track.setAttribute('aria-hidden','true');parade.className='frame-creature-parade';track.append(parade);document.body.append(track);
 const sprites=creatures.map((c,index)=>{const svg=document.createElementNS(ns,'svg');svg.setAttribute('class','frame-creature');svg.setAttribute('viewBox',`0 0 ${c.grid[0]} ${c.grid[1]}`);svg.setAttribute('width',c.grid[0]*2.4);svg.setAttribute('height',c.grid[1]*2.4);svg.setAttribute('shape-rendering','crispEdges');for(const [name,pixels]of [['body',c.body],['eyes',c.eyes]])for(const [x,y,width,height]of pixels){const rect=document.createElementNS(ns,'rect');for(const [k,v]of Object.entries({x,y,width,height,class:name}))rect.setAttribute(k,v);svg.append(rect);}
 // Each sprite owns its cheeks and touch timeout; no form or chat state is read.
 const cheeks=document.createElementNS(ns,'g');cheeks.setAttribute('class','blush');
 const positions=[[[3,6],[8,6]],[[3,5],[8,5]],[[3,6],[9,6]],[[2,5],[8,5]]][index];
 for(const [x,y]of positions){const rect=document.createElementNS(ns,'rect');for(const [k,v]of Object.entries({x,y,width:2,height:1}))rect.setAttribute(k,v);cheeks.append(rect);}svg.append(cheeks);
 const hit=document.createElementNS(ns,'rect');for(const [k,v]of Object.entries({width:c.grid[0],height:c.grid[1],fill:'transparent','pointer-events':'all'}))hit.setAttribute(k,v);svg.append(hit);
 let blushTimer;const clearBlush=()=>{clearTimeout(blushTimer);svg.classList.remove('is-blushing');};
 svg.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){clearTimeout(blushTimer);svg.classList.add('is-blushing');}});
 svg.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')clearBlush();});
 svg.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'){clearTimeout(blushTimer);svg.classList.add('is-blushing');blushTimer=setTimeout(clearBlush,1200);}});
 svg.addEventListener('pointercancel',clearBlush);
 parade.append(svg);return svg;});
 let animation,travel=0;
 function place(){const r=frame.getBoundingClientRect(),width=Math.min(340,Math.max(164,r.width-48));track.style.width=width+'px';track.style.left=(r.right-24-width)+'px';track.style.top=(r.top-28)+'px';travel=Math.max(0,width-parade.getBoundingClientRect().width);}
 function draw(now=0){const t=motion.matches?0:now/1000,facing=motion.matches||Math.cos(t*.35)>=0?1:-1,x=motion.matches?travel/2:(Math.sin(t*.35)+1)*travel/2;parade.style.transform=`translateX(${x}px)`;sprites.forEach((svg,i)=>{const bob=motion.matches?0:Math.abs(Math.sin(t*2.5+creatures[i].phase))*1.6;svg.style.transform=`translateY(${-bob}px) scaleX(${facing})`;});if(!motion.matches&&!document.hidden)animation=requestAnimationFrame(draw);}
 function reset(){cancelAnimationFrame(animation);place();draw(performance.now());}
 new ResizeObserver(reset).observe(frame);motion.addEventListener('change',reset);document.addEventListener('visibilitychange',reset);window.addEventListener('resize',reset);reset();
})();
/* Mobile navigation keeps the original conversation DOM, draft and request ownership. */
document.addEventListener('DOMContentLoaded',()=>{
 const app=document.querySelector('.app'),header=app?.querySelector('header');if(!header)return;
 const media=matchMedia('(max-width:780px), (max-width:1024px) and (max-height:600px) and (pointer:coarse)'),sidebar=document.querySelector('.sidebar'),inspector=document.querySelector('.inspector');
 const create=document.querySelector('.panel-create:not(.compact-create)'),createHome=document.createComment('create position');
 const sidebarHome=document.createComment('sidebar position'),inspectorHome=document.createComment('inspector position');
 sidebar.before(sidebarHome);inspector.before(inspectorHome);create?.before(createHome);
 const button=(label,cls,text=label)=>{const b=el('button',cls,text);b.type='button';b.setAttribute('aria-label',label);return b;};
 const back=button('返回會話清單','mobile-back','‹'),title=el('div','mobile-title'),heading=el('strong','','會話'),host=el('small');
 title.append(heading,host);
 const workspace=button('工作區與設定','mobile-workspace','工作區'),more=button('對話資訊與操作','mobile-info','更多');
 header.append(back,title,workspace,more);
 const nav=el('nav','mobile-nav');nav.setAttribute('aria-label','主要功能');
 const tabs=[['work','會話'],['lineage','工作關係'],['live','工作動態']];
 for(const [id,label]of tabs){const b=button(label,'mobile-tab');b.dataset.view=id;b.onclick=()=>$(id).click();nav.append(b);}app.append(nav);
 function sheet(label){
  const d=el('dialog','mobile-sheet'),bar=el('div','mobile-sheet-heading'),h=el('h2','',label),close=button('關閉'+label,'','關閉');
  d.setAttribute('aria-label',label);close.onclick=()=>d.close();bar.append(h,close);d.append(bar);document.body.append(d);
  d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();});
  return d;
 }
 const workspaceSheet=sheet('工作區與設定'),infoSheet=sheet('對話資訊與操作'),actions=el('div','mobile-info-actions'),permission=el('p','mobile-permission');
 const rename=button('重新命名目前對話','','重新命名'),move=button('移動目前對話','','移至資料夾');
 actions.append(rename,move);infoSheet.append(actions,permission);
 workspace.onclick=()=>workspaceSheet.showModal();
 more.onclick=()=>{permission.textContent=document.querySelector('.composer>.native-note')?.textContent||'';const editable=!!window.CantusOrganize?.editable();rename.disabled=move.disabled=!editable;infoSheet.showModal();};
 rename.onclick=()=>{const s=catalog.sessions.find(s=>s.id===selected);if(!s)return;infoSheet.close();window.CantusOrganize?.edit({title:'重新命名對話',value:name(s),action:'rename',id:s.id});};
 move.onclick=()=>{const s=catalog.sessions.find(s=>s.id===selected);if(!s)return;infoSheet.close();window.CantusOrganize?.edit({title:'移至 Cantus 資料夾',action:'moveFolder',id:s.id,folderId:s.cantusFolder?.id});};
 let view='list',replaying=false,historyReady=false;
 function updateHeader(){
  const picker=document.querySelector('.platform-box select');
  host.textContent=picker?.selectedOptions[0]?.textContent||'目前工作區';
  heading.textContent=view==='chat'?(catalog.sessions.find(s=>s.id===selected)?name(catalog.sessions.find(s=>s.id===selected)):'對話'):view==='lineage'?'工作關係':view==='live'?'工作動態':'會話';
  back.hidden=view!=='chat';more.hidden=view!=='chat';
  for(const b of nav.children){const active=b.dataset.view===(view==='list'||view==='chat'?'work':view);b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');}
 }
 function show(next,record=true){
  if(!media.matches)return;
  if(record&&!replaying&&view!==next)history.pushState({...history.state,cantusMobileView:next},'');
  view=next;app.dataset.mobileView=view;updateHeader();
 }
 for(const [id]of tabs)$(id).addEventListener('click',()=>show(id==='work'?'list':id));
 back.onclick=()=>{if(history.state?.cantusMobileView==='chat')history.back();else show('list',false);};
 window.addEventListener('popstate',e=>{
  if(!media.matches)return;const next=e.state?.cantusMobileView||'list';
  replaying=true;$(next==='lineage'||next==='live'?next:'work').click();show(next==='chat'&&selected?'chat':next==='chat'?'list':next,false);replaying=false;
 });
 function fitInput(input){if(!media.matches||!input)return;input.style.height='auto';input.style.height=Math.min(input.scrollHeight,Math.max(64,(window.visualViewport?.height||innerHeight)*.22),128)+'px';}
 function compactComposer(){
  const box=document.querySelector('.composer');if(!media.matches||!box||box.querySelector('.mobile-composer-tools'))return;
  const tools=button('展開輸入選項','mobile-composer-tools','＋'),controls=el('div','mobile-composer-controls');
  tools.setAttribute('aria-expanded','false');tools.onclick=()=>{const open=box.classList.toggle('mobile-tools-open');tools.setAttribute('aria-expanded',String(open));tools.setAttribute('aria-label',open?'收合輸入選項':'展開輸入選項');};
  for(const control of box.querySelectorAll('.provider-picker,.stop-message'))controls.append(control);
  const routeIcon=el('span','mobile-route-icon');routeIcon.setAttribute('aria-hidden','true');routeIcon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 19V5m0 8h7a5 5 0 0 0 5-5V5M3 8l3-3 3 3m6 0 3-3 3 3"/><circle cx="6" cy="19" r="2"/></svg>';controls.append(routeIcon);
  const picker=controls.querySelector('.provider-picker'),autoIcon=routeIcon.innerHTML;const syncBrand=()=>{routeIcon.replaceChildren();if(picker.value==='auto')routeIcon.innerHTML=autoIcon;else routeIcon.append(brandIcon(picker.value));picker.title=picker.selectedOptions[0]?.textContent||'選擇回覆 AI';};picker.addEventListener('change',syncBrand);new MutationObserver(syncBrand).observe(picker,{childList:true});syncBrand();
  box.prepend(tools);box.append(controls);const input=box.querySelector('textarea');input.dataset.desktopRows=String(input.rows);input.rows=1;fitInput(input);
  const state=box.querySelector('.native-state');state.setAttribute('role','status');const syncState=()=>{state.dataset.quiet=String(/^(idle|就緒|準備就緒)?$/i.test(state.textContent.trim()));state.title=state.textContent;};new MutationObserver(syncState).observe(state,{childList:true,characterData:true,subtree:true});syncState();
 }
 const priorSelect=select;
 select=async(s,options={})=>{if(media.matches&&!options.background){show('chat');heading.textContent=name(s);}const result=await priorSelect(s);if(selected===s.id){compactComposer();updateHeader();}return result;};
 document.addEventListener('cantus-work-opened',()=>{if(selected)show('chat');});
 document.addEventListener('input',e=>{if(e.target.matches('.composer textarea'))fitInput(e.target);});
 // Touch-accessible menus reuse the same Cantus-only rename and move operations.
 const observer=new MutationObserver(()=>{
  if(!media.matches)return;
  for(const row of document.querySelectorAll('.conversation-row:not([data-mobile-menu])')){
   row.dataset.mobileMenu='true';const b=button('會話操作','mobile-row-more','⋯');b.onclick=e=>{e.stopPropagation();const r=b.getBoundingClientRect();row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left,clientY:r.bottom}));};row.append(b);
  }
  for(const summary of document.querySelectorAll('.conversation-group[data-cantus-folder-id]>summary:not([data-mobile-menu])')){
   summary.dataset.mobileMenu='true';const b=button('資料夾操作','mobile-row-more','⋯');b.onclick=e=>{e.preventDefault();e.stopPropagation();const r=b.getBoundingClientRect();summary.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left,clientY:r.bottom}));};summary.append(b);
  }
 });
 observer.observe($('list'),{childList:true,subtree:true});
 sidebar.addEventListener('click',e=>{if(!media.matches)return;if(e.target.closest('[data-filter]')){workspaceSheet.close();show('list');}if(e.target.closest('.routing-open'))workspaceSheet.close();});
 document.addEventListener('cantus-platform-change',()=>{if(!media.matches)return;infoSheet.close();if(view==='chat'){show('list',false);history.replaceState({...history.state,cantusMobileView:'list'},'');}updateHeader();});
 document.addEventListener('cantus-login-expired',()=>{if(media.matches){infoSheet.close();if(!workspaceSheet.open)workspaceSheet.showModal();updateHeader();}});
 document.addEventListener('cantus-display-change',updateHeader);
 let viewportFrame;
 function viewport(){
  cancelAnimationFrame(viewportFrame);viewportFrame=requestAnimationFrame(()=>{
   if(!media.matches)return;const v=window.visualViewport;if(v&&v.scale!==1)return;
   document.documentElement.style.setProperty('--cantus-mobile-height',(v?.height||innerHeight)+'px');
   document.documentElement.style.setProperty('--cantus-mobile-top',(v?.offsetTop||0)+'px');
   const keyboard=!!document.activeElement?.matches('textarea,input:not([type=checkbox]),select')&&(v?.height||innerHeight)<screen.height*.7;
   app.classList.toggle('mobile-keyboard',keyboard);fitInput(document.querySelector('.composer textarea'));
  });
 }
 function resize(){
  if(media.matches){
   workspaceSheet.append(sidebar);infoSheet.append(inspector);if(create)document.querySelector('.list-pane .search').after(create);
   if(!historyReady){history.replaceState({...history.state,cantusMobileView:view},'');historyReady=true;}
   show(app.classList.contains('lineage-mode')?'lineage':app.classList.contains('live-mode')?'live':selected?'chat':'list',false);compactComposer();renderList();viewport();
  }else{
   workspaceSheet.close();infoSheet.close();sidebarHome.after(sidebar);inspectorHome.after(inspector);if(create)createHome.after(create);delete app.dataset.mobileView;app.classList.remove('mobile-keyboard');
   document.querySelectorAll('.composer textarea').forEach(e=>{e.style.removeProperty('height');if(e.dataset.desktopRows)e.rows=Number(e.dataset.desktopRows);});
   for(const box of document.querySelectorAll('.composer')){const actions=box.querySelector('.composer-actions'),send=actions?.querySelector('.send-message');for(const control of box.querySelectorAll('.mobile-composer-controls>.provider-picker,.mobile-composer-controls>.stop-message'))actions.insertBefore(control,send);box.querySelector('.mobile-composer-controls')?.remove();box.querySelector('.mobile-composer-tools')?.remove();box.classList.remove('mobile-tools-open');}
  }
 }
 media.addEventListener('change',resize);window.addEventListener('resize',viewport);window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);
 document.addEventListener('focusin',viewport);document.addEventListener('focusout',viewport);
 resize();
});
