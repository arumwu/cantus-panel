'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {HistoryPages,createHistoryReader}=require('./session-history-reader.cjs');
const id='codex_'+'a'.repeat(64);
test('page cache checks fingerprints, keeps page keys separate, and evicts changed or deleted sources',async()=>{
 let stamp=1,reads=0,missing=false;
 const cache=new HistoryPages({maxEntries:2,maxBytes:1024,createSource:()=>({discover:async()=>({sessions:[{id,hasTranscript:true}]}),fingerprint(){if(missing)throw Object.assign(Error(),{code:'missing'});return stamp;},async read(_id,o){reads++;return {rows:[{text:String(stamp)}],before:o.before};}})});
 const input={provider:'codex',id};assert.equal((await cache.read(input)).rows[0].text,'1');await cache.read(input);assert.equal(reads,1);
 await cache.read({...input,before:2,signature:'b'.repeat(64)});assert.equal(reads,2);
 stamp=2;assert.equal((await cache.read(input)).rows[0].text,'2');assert.equal(reads,3);
 missing=true;await assert.rejects(cache.read(input),{code:'missing'});
 assert.ok(cache.bytes<=1024);await assert.rejects(cache.read({...input,before:-1}),{code:'input'});
});
test('one bounded retry never returns an unverified changing file or silently repairs an old page signature',async()=>{
 let discoveries=0;
 const cache=new HistoryPages({createSource:()=>({discover:async()=>{discoveries++;return {sessions:[{id,hasTranscript:true}]};},fingerprint:()=>1,read:async()=>{throw Object.assign(Error(),{code:'stale'});}})});
 await assert.rejects(cache.read({provider:'codex',id}),{code:'stale'});assert.equal(discoveries,2);assert.equal(cache.entries.size,0);
});
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cantus-history-'))),sid='11111111-1111-4111-8111-111111111111';
 fs.mkdirSync(root+'/sessions');const id='codex_'+crypto.createHash('sha256').update(root+'\0'+sid).digest('hex'),file=root+'/sessions/rollout-'+sid+'.jsonl.zst';
 const content=n=>JSON.stringify({type:'session_meta',payload:{id:sid,cwd:root}})+'\n'+Array.from({length:n},(_,i)=>JSON.stringify({type:'response_item',payload:{type:'message',id:String(i),role:'user',content:[{type:'input_text',text:'fixture '+i}]}})).join('\n')+'\n';
 const write=n=>fs.writeFileSync(file,zlib.zstdCompressSync(content(n)));write(140);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,id,file,write,content};
}
test('real isolated worker coalesces reads, refreshes changed sources, preserves paging and never expands compressed files',async t=>{
 const f=fixture(t),reader=createHistoryReader({root:f.root});t.after(()=>reader.close());const input={provider:'codex',id:f.id};
 const a=reader.read(input),b=reader.read(input);assert.equal(a,b);const h=await a;assert.equal(h.totalRows,140);assert.equal(h.rows.length,120);
 const old=await reader.read({...input,before:h.nextBefore,signature:h.pageSignature});assert.equal(old.rows.length,20);assert.equal(old.rows[0].text,'fixture 0');
 f.write(141);const fresh=await reader.read(input);assert.equal(fresh.totalRows,141);assert.equal(fresh.rows.at(-1).text,'fixture 140');
 await assert.rejects(reader.read({...input,before:h.nextBefore,signature:h.pageSignature}),{code:'stale'});
 assert.equal(fs.existsSync(f.file.slice(0,-4)),false);fs.unlinkSync(f.file);await assert.rejects(reader.read(input));
});
test('unchanged compressed copy cannot hide a newly preferred writable transcript',async t=>{
 const f=fixture(t),reader=createHistoryReader({root:f.root});t.after(()=>reader.close());const input={provider:'codex',id:f.id};
 assert.equal((await reader.read(input)).totalRows,140);
 fs.writeFileSync(f.file.slice(0,-4),f.content(145));
 assert.equal((await reader.read(input)).totalRows,145);
});
