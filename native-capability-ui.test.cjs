'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

test('failed capability can be checked again without losing a draft or sending it',async()=>{
 class Element{
  constructor(tag='div',cls='',text=''){this.tag=tag;this.className=cls;this.textContent=text;this.children=[];this.childNodes=this.children;this.dataset={};this.style={};this.value='';this.hidden=false;this.disabled=false;this.isConnected=true;this.classList={add(){},remove(){}};}
  append(...children){this.children.push(...children);} prepend(...children){this.children.unshift(...children);} replaceChildren(...children){this.children=children;} setAttribute(){} querySelector(s){if(s==='.eyebrow'||s==='.pill')return new Element();return null;} querySelectorAll(){return [];} insertBefore(){} get lastChild(){return this.children.at(-1);} get firstChild(){return this.children[0];}
 }
 const nodes={detail:new Element(),context:new Element()};let release,capabilityCalls=0,statusCalls=0,postCalls=0;
 const ctx={select:null,originalSelect:()=>Promise.resolve(true),nativeSelection:0,nativePoll:null,selected:'fixture',providerChoices:new Map(),drafts:new Map([['fixture','尚未送出的草稿']]),pendingSends:new Map(),messageQueues:new Map(),
  window:{cantusPlatform:{role:'editor',providers:['codex','claude'],key:id=>id}},document:{addEventListener(){},removeEventListener(){}},el:(...args)=>new Element(...args),$:id=>nodes[id],brandIcon:()=>new Element(),friendlyNativeError:()=> '請稍後再試。',friendlyFailureText:v=>v,renderMessageContent(){},queueChanged(){},clearTimeout(){},setTimeout(){},
  api:async url=>{if(url.startsWith('/api/native/capability')){capabilityCalls++;if(capabilityCalls===1)throw Error('temporary');return new Promise(r=>release=r);}if(url.startsWith('/api/native/status')){statusCalls++;return {busy:false,phase:'idle',approvals:[]};}throw Error('unexpected GET');},postNative:async()=>{postCalls++;}};
 vm.createContext(ctx);const source=fs.readFileSync('native-ui.js','utf8');vm.runInContext(source.slice(source.indexOf('select=async function(s){')),ctx);
 await ctx.select({id:'fixture',provider:'codex'});await new Promise(r=>setImmediate(r));
 const box=nodes.detail.children.find(x=>x.className==='composer'),retry=box.children.find(x=>x.textContent==='重新確認'),input=box.children.find(x=>x.tag==='label').children[0],send=box.children.find(x=>x.className==='composer-actions').children.find(x=>x.className==='send-message');
 assert.equal(retry.hidden,false);assert.equal(input.value,'尚未送出的草稿');assert.equal(send.disabled,true);assert.equal(statusCalls,0);
 const pending=retry.onclick();await retry.onclick();assert.equal(capabilityCalls,2);assert.equal(retry.disabled,true);assert.equal(postCalls,0);
 release({available:false,switchable:true,note:'目前無法續作'});await pending;await new Promise(r=>setImmediate(r));
 assert.equal(retry.hidden,false);assert.equal(send.disabled,true);assert.equal(capabilityCalls,2);assert.equal(statusCalls,1);
 const second=retry.onclick();assert.equal(capabilityCalls,3);release({available:true,switchable:true,note:'可續作'});await second;await new Promise(r=>setImmediate(r));
 assert.equal(retry.hidden,true);assert.equal(input.value,'尚未送出的草稿');assert.equal(send.disabled,false);assert.equal(postCalls,0);assert.equal(statusCalls,2);
});
