#!/usr/bin/env python3
"""Phase 4 app edits: cloud collection sync layer. Applies to the Phase 3h app file in place."""
import re, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'public_html/app/index.html'
s = open(p, encoding='utf-8').read(); n0 = len(s)

def rep(old, new, count=1):
    global s
    c = s.count(old); assert c == count, (c, count, old[:90]); s = s.replace(old, new)

# 1) IndexedDB: version 2 adds a `cid` index (needed to find a shell by its cloud id)
rep('''    const r=indexedDB.open(dbName,1);
    r.onupgradeneeded=e=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains("shells")){
        const s=db.createObjectStore("shells",{keyPath:"id",autoIncrement:true});
        s.createIndex("name","name",{unique:false});
        s.createIndex("location","location",{unique:false});
        s.createIndex("date_found","date_found",{unique:false});
        s.createIndex("rarity","rarity",{unique:false});
      }
    };''',
'''    const r=indexedDB.open(dbName,2);   // Phase 4: v2 adds the cid index
    r.onupgradeneeded=e=>{
      const db=e.target.result;
      let s;
      if(!db.objectStoreNames.contains("shells")){
        s=db.createObjectStore("shells",{keyPath:"id",autoIncrement:true});
        s.createIndex("name","name",{unique:false});
        s.createIndex("location","location",{unique:false});
        s.createIndex("date_found","date_found",{unique:false});
        s.createIndex("rarity","rarity",{unique:false});
      } else { s=e.target.transaction.objectStore("shells"); }
      if(!s.indexNames.contains("cid")) s.createIndex("cid","cid",{unique:false});
    };''')

# 2) rename the local helpers; same-named wrappers below add cloud sync, so no call site changes
for a, b in [('async function dbAdd(data){', 'async function _dbAddLocal(data){'),
             ('async function dbDelete(id){', 'async function _dbDeleteLocal(id){'),
             ('async function dbClearAll(){', 'async function _dbClearAllLocal(){'),
             ('async function dbDeleteMultiple(ids){', 'async function _dbDeleteMultipleLocal(ids){'),
             ('async function dbUpdateNotes(id,notes){', 'async function _dbUpdateNotesLocal(id,notes){'),
             ('async function dbUpdateTags(id,tags){', 'async function _dbUpdateTagsLocal(id,tags){')]:
    rep(a, b)

# 3) the sync layer, inserted right after the last local helper (_dbUpdateTagsLocal)
anchor_i = s.index('async function _dbUpdateTagsLocal(id,tags){')
end_i = s.index('\n}\n', anchor_i) + 3
sync = r'''
// ── Phase 4 (2026-11-01): Cloud Collection ──────────────────────────────────────────────────────
// A paid, signed-in account's shells follow the login to any device (Nancy: phone → iPad). The IndexedDB
// store stays the source the UI reads; this layer mirrors it to /_collection.php on the hub (same JWT and
// file-storage pattern as Excursion Reels) and merges the server copy back in.
//   - Every shell gets a `cid` (cloud id) when saved; legacy shells get one on the first sync.
//   - Save / delete / notes / tags happen locally first (as before), then go into a localStorage queue that
//     is flushed to the server; the queue survives offline and app restarts.
//   - pull(): the server list for the current region is merged: new shells are added here (photo fetched
//     and stored locally, so print/reels/offline keep working), newer notes/tags win by timestamp, and a
//     shell that was synced but is gone from the server was deleted on another device → removed here.
//   - Gate: bcmAuth.scope 'single' or 'all' (the server enforces the same). Guests and free accounts are
//     unchanged: local only.
const BCM_SYNC_QUEUE_KEY='bcm_sync_queue_v1', BCM_SYNC_LAST_KEY='bcm_sync_last_v1', BCM_SYNC_MIN_GAP_MS=10*60*1000;
const BCM_SYNC_PAID=['single','all'], BCM_SYNC_MAX_PHOTO=600*1024;
function _dbGetByCid(cid){ return openDB().then(db=>new Promise((res,rej)=>{ const tx=db.transaction("shells","readonly"); const st=tx.objectStore("shells"); const r=st.indexNames.contains("cid")?st.index("cid").getAll(cid):st.getAll(); r.onsuccess=()=>{ const rows=r.result||[]; res(rows.find(x=>x&&x.cid===cid)||null); }; r.onerror=()=>rej(r.error); })); }
function _dbGetById(id){ return openDB().then(db=>new Promise((res,rej)=>{ const r=db.transaction("shells","readonly").objectStore("shells").get(id); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); })); }
function _dbPutRaw(rec){ return openDB().then(db=>new Promise((res,rej)=>{ const r=db.transaction("shells","readwrite").objectStore("shells").put(rec); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
function _dbInsertRaw(rec){ const {id,...rest}=rec||{}; return openDB().then(db=>new Promise((res,rej)=>{ const r=db.transaction("shells","readwrite").objectStore("shells").add(rest); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
const bcmSync={
  state:'idle', lastError:'', running:false,
  enabled(){ try{ return !!(typeof bcmAuth!=='undefined'&&bcmAuth.getToken()&&BCM_SYNC_PAID.includes(bcmAuth.scope)); }catch(e){ return false; } },
  newCid(){ const a='abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let out=''; const rnd=new Uint8Array(16); (window.crypto&&crypto.getRandomValues)?crypto.getRandomValues(rnd):rnd.forEach((_,i)=>rnd[i]=Math.floor(Math.random()*256)); for(let i=0;i<16;i++) out+=a[rnd[i]%a.length]; return out; },
  now(){ return new Date().toISOString(); },
  queue(){ try{ const q=JSON.parse(localStorage.getItem(BCM_SYNC_QUEUE_KEY)||'[]'); return Array.isArray(q)?q:[]; }catch(e){ return []; } },
  saveQueue(q){ try{ localStorage.setItem(BCM_SYNC_QUEUE_KEY,JSON.stringify(q)); }catch(e){} },
  enqueue(op,cid,region){
    if(!cid) return;
    let q=this.queue().filter(x=>x.cid!==cid||(op==='patch'&&x.op==='put'));   // a pending put already carries notes/tags; delete/put replace anything
    if(!(op==='patch'&&q.some(x=>x.cid===cid&&x.op==='put'))) q.push({op,cid,region:region||currentRegion,ts:Date.now()});
    this.saveQueue(q);
  },
  dropCid(cid){ this.saveQueue(this.queue().filter(x=>x.cid!==cid)); },
  cleanRecord(rec){ const d={...rec}; if(typeof d.image_data==='string'&&d.image_data&&!/^data:/i.test(d.image_data)) d.image_ref=d.image_data.slice(0,300); delete d.image_data; delete d.id; delete d.synced_at; return d; },   // Shell by Sight saves a bundled image path, not a photo: carry the path
  photoFrom(rec){ const v=rec&&rec.image_data; if(typeof v!=='string') return ''; const m=v.match(/^data:image\/jpe?g;base64,(.+)$/i); if(!m) return ''; return (m[1].length*0.75)<=BCM_SYNC_MAX_PHOTO?m[1]:''; },
  async api(path,body){ const token=bcmAuth.getToken(); const opts={method:body?'POST':'GET',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}}; if(body) opts.body=JSON.stringify(body); const r=await fetch(bcmAuth.API_BASE+'/_collection.php'+(path||''),opts); let j=null; try{ j=await r.json(); }catch(e){} return {status:r.status,json:j||{}}; },
  async fetchPhoto(cid){ try{ const r=await fetch(bcmAuth.API_BASE+'/_collection.php?cid='+encodeURIComponent(cid)+'&img=1',{headers:{'Authorization':'Bearer '+bcmAuth.getToken()}}); if(!r.ok) return ''; const b=await r.blob(); return await new Promise(res=>{ const fr=new FileReader(); fr.onload=()=>res(String(fr.result||'')); fr.onerror=()=>res(''); fr.readAsDataURL(b); }); }catch(e){ return ''; } },
  async flush(){
    if(!this.enabled()||this.running||(typeof navigator!=='undefined'&&navigator.onLine===false)) return;
    this.running=true;
    try{
      let q=this.queue();
      while(q.length){
        const item=q[0]; let out;
        try{
          if(item.op==='put'){
            const rec=await _dbGetByCid(item.cid);
            if(!rec){ q.shift(); this.saveQueue(q); continue; }
            out=await this.api('',{action:'put',shell:{cid:rec.cid,region:rec.region||item.region||currentRegion,updated:rec.updated||rec.saved_at||this.now(),data:this.cleanRecord(rec)},photo_b64:this.photoFrom(rec)});
            if(out.status===200&&out.json.ok){ rec.synced_at=this.now(); if(out.json.updated) rec.updated=out.json.updated; await _dbPutRaw(rec); }
          } else if(item.op==='patch'){
            const rec=await _dbGetByCid(item.cid);
            if(!rec){ q.shift(); this.saveQueue(q); continue; }
            out=await this.api('',{action:'patch',cid:rec.cid,updated:rec.updated||this.now(),data:{user_notes:rec.user_notes||'',tags:rec.tags||[]}});
            if(out.status===404){ out=await this.api('',{action:'put',shell:{cid:rec.cid,region:rec.region||currentRegion,updated:rec.updated||this.now(),data:this.cleanRecord(rec)},photo_b64:this.photoFrom(rec)}); }
            if(out.status===200&&out.json.ok){ rec.synced_at=this.now(); await _dbPutRaw(rec); }
          } else if(item.op==='delete'){
            out=await this.api('',{action:'delete',cid:item.cid});
          }
        }catch(e){ this.lastError=String(e&&e.message||e); break; }   // network: keep the queue, try later
        if(out&&(out.status===401||out.status===403)){ this.lastError=(out.json&&out.json.error)||('HTTP '+out.status); break; }   // not allowed: keep, stop
        if(out&&out.status>=500){ this.lastError=(out.json&&out.json.error)||('HTTP '+out.status); break; }                      // server trouble: keep, stop
        q.shift(); this.saveQueue(q);                                   // success or a 4xx we cannot fix by retrying: drop the item
        if(out&&out.status===400) console.warn('[bcmSync] dropped',item.op,item.cid,out.json&&out.json.error);
      }
    } finally { this.running=false; }
  },
  async pull(){
    if(!this.enabled()) return false;
    const region=currentRegion;
    let out; try{ out=await this.api('?list=1&region='+encodeURIComponent(region)); }catch(e){ this.lastError=String(e&&e.message||e); return false; }
    if(out.status!==200||!out.json.ok||!Array.isArray(out.json.shells)){ this.lastError=(out.json&&out.json.error)||('HTTP '+out.status); return false; }
    const server=new Map(out.json.shells.map(x=>[x.cid,x]));
    const local=await dbGetAll(); const byCid=new Map(); let changed=false; const pendingCids=new Set(this.queue().map(x=>x.cid));
    for(const rec of local){ if(rec.cid) byCid.set(rec.cid,rec); }
    // 1) server → local
    for(const [cid,sv] of server){
      const mine=byCid.get(cid);
      if(mine){
        let dirty=false;
        if((sv.updated||'')>(mine.updated||'')){ const d=sv.data||{}; if('user_notes' in d) mine.user_notes=d.user_notes; if('tags' in d) mine.tags=d.tags||[]; mine.updated=sv.updated; mine.synced_at=this.now(); dirty=true; changed=true; }
        else if(!mine.synced_at){ mine.synced_at=this.now(); dirty=true; }
        const ref=sv.data&&typeof sv.data.image_ref==='string'?sv.data.image_ref:'';
        if(!mine.image_data&&ref){ mine.image_data=ref; dirty=true; changed=true; }                                   // Shell by Sight image arrives as a bundled path
        if(!ref&&!sv.has_photo&&typeof mine.image_data==='string'&&mine.image_data&&!/^data:/i.test(mine.image_data)&&!pendingCids.has(cid)){ this.enqueue('put',cid,mine.region||region); }   // repair: server copy predates image_ref
        if(dirty) await _dbPutRaw(mine);
      } else {
        const d={...(sv.data||{})}; d.cid=cid; d.region=sv.region||region; d.updated=sv.updated||this.now(); d.synced_at=this.now();
        if(!d.saved_at) d.saved_at=sv.created||d.updated;
        d.image_data=sv.has_photo?await this.fetchPhoto(cid):(typeof d.image_ref==='string'?d.image_ref:'');
        if(await _dbGetByCid(cid)) continue;                 // arrived meanwhile (another sync path) — never duplicate
        await _dbInsertRaw(d); changed=true;
      }
    }
    // 2) local → server, and deletions made elsewhere
    const pending=new Set(this.queue().map(x=>x.cid));
    for(const rec of local){
      if(!rec.cid){ rec.cid=this.newCid(); rec.region=rec.region||region; rec.updated=rec.updated||rec.saved_at||this.now(); await _dbPutRaw(rec); this.enqueue('put',rec.cid,rec.region); changed=true; continue; }
      if(server.has(rec.cid)) continue;
      if(rec.synced_at&&!pending.has(rec.cid)){ await _dbDeleteLocal(rec.id); changed=true; }   // deleted on another device
      else if(!rec.synced_at&&!pending.has(rec.cid)){ this.enqueue('put',rec.cid,rec.region||region); }
    }
    try{ localStorage.setItem(BCM_SYNC_LAST_KEY,JSON.stringify({ts:Date.now(),region})); }catch(e){}
    if(changed){ try{ window.dispatchEvent(new Event('bcm-collection-changed')); }catch(e){} }
    return true;
  },
  async sync(reason){
    if(!this.enabled()) return;
    if(this._syncing){ this._again=true; return; }          // one sync at a time; a request during a sync runs once more after it
    this._syncing=true;
    try{
      do{ this._again=false; this.state='syncing'; this.lastError='';
        try{ await this.pull(); await this.flush(); this.state=this.lastError?'error':'ok'; }
        catch(e){ this.lastError=String(e&&e.message||e); this.state='error'; }
      } while(this._again);
    } finally { this._syncing=false; }
    try{ window.dispatchEvent(new CustomEvent('bcm-sync-state',{detail:{state:this.state,error:this.lastError,reason}})); }catch(e){}
  },
  start(){
    if(this._started) return; this._started=true;
    const kick=(why)=>{ if(this.enabled()) this.sync(why); };
    window.addEventListener('bcm-auth-change',e=>{ if(e.detail&&e.detail.loggedIn) kick('auth'); });
    window.addEventListener('online',()=>kick('online'));
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState!=='visible') return; let last=0; try{ last=(JSON.parse(localStorage.getItem(BCM_SYNC_LAST_KEY)||'{}')||{}).ts||0; }catch(e){} if(Date.now()-last>BCM_SYNC_MIN_GAP_MS) kick('visible'); });
    kick('start');
  }
};
// Same-named wrappers: local write first (unchanged behaviour), then mirror to the cloud when allowed.
async function dbAdd(data){
  const rec={...data,cid:bcmSync.newCid(),region:currentRegion,updated:bcmSync.now()};
  const id=await _dbAddLocal(rec);
  if(bcmSync.enabled()){ bcmSync.enqueue('put',rec.cid,rec.region); bcmSync.flush(); }
  return id;
}
async function dbDelete(id){
  const rec=await _dbGetById(id).catch(()=>null);
  await _dbDeleteLocal(id);
  if(rec&&rec.cid){ if(bcmSync.enabled()){ bcmSync.enqueue('delete',rec.cid,rec.region); bcmSync.flush(); } else bcmSync.dropCid(rec.cid); }
}
async function dbDeleteMultiple(ids){
  const recs=[]; for(const id of ids){ const r=await _dbGetById(id).catch(()=>null); if(r) recs.push(r); }
  await _dbDeleteMultipleLocal(ids);
  for(const rec of recs){ if(rec.cid){ if(bcmSync.enabled()) bcmSync.enqueue('delete',rec.cid,rec.region); else bcmSync.dropCid(rec.cid); } }
  if(bcmSync.enabled()) bcmSync.flush();
}
async function dbClearAll(){
  const recs=await dbGetAll().catch(()=>[]);
  await _dbClearAllLocal();
  for(const rec of recs){ if(rec.cid){ if(bcmSync.enabled()) bcmSync.enqueue('delete',rec.cid,rec.region); else bcmSync.dropCid(rec.cid); } }
  if(bcmSync.enabled()) bcmSync.flush();
}
async function dbUpdateNotes(id,notes){
  await _dbUpdateNotesLocal(id,notes);
  const rec=await _dbGetById(id).catch(()=>null); if(!rec) return;
  rec.updated=bcmSync.now(); if(!rec.cid){ rec.cid=bcmSync.newCid(); rec.region=rec.region||currentRegion; } await _dbPutRaw(rec);
  if(bcmSync.enabled()){ bcmSync.enqueue(rec.synced_at?'patch':'put',rec.cid,rec.region); bcmSync.flush(); }
}
async function dbUpdateTags(id,tags){
  await _dbUpdateTagsLocal(id,tags);
  const rec=await _dbGetById(id).catch(()=>null); if(!rec) return;
  rec.updated=bcmSync.now(); if(!rec.cid){ rec.cid=bcmSync.newCid(); rec.region=rec.region||currentRegion; } await _dbPutRaw(rec);
  if(bcmSync.enabled()){ bcmSync.enqueue(rec.synced_at?'patch':'put',rec.cid,rec.region); bcmSync.flush(); }
}
window.bcmSync=bcmSync;
'''
s = s[:end_i] + sync + s[end_i:]

# 4) the shell: start the sync layer and reload the collection when it changes
rep('''  useEffect(()=>{loadCollection();},[loadCollection]);
  useEffect(()=>{setupExitHandlers(()=>screen,setScreen,confirmBye);},[]);''',
'''  useEffect(()=>{loadCollection();},[loadCollection]);
  // Phase 4: cloud collection — start the sync layer once; re-read the local store whenever a pull changed it
  useEffect(()=>{ const on=()=>loadCollection(); window.addEventListener('bcm-collection-changed',on); try{ bcmSync.start(); }catch(e){ console.warn('[bcmSync]',e); } return()=>window.removeEventListener('bcm-collection-changed',on); },[loadCollection]);
  useEffect(()=>{setupExitHandlers(()=>screen,setScreen,confirmBye);},[]);''')

# 5) header comment line for the phase
rep('''    // ── Phase 3h (2026-11-01): Dining data comes from assets/dining.json on the hub''',
'''    // ── Phase 4 (2026-11-01): Cloud Collection — see bcmSync next to the IndexedDB helpers.
    // ── Phase 3h (2026-11-01): Dining data comes from assets/dining.json on the hub''')

open(p, 'w', encoding='utf-8').write(s)
print('chars', n0, '->', len(s))
