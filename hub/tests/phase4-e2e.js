// Phase 4 end-to-end: real _collection.php (php -S :8097) + the app, two "devices" on one paid login, one free account.
const { chromium } = require('playwright'); const fs=require('fs'),http=require('http'),path=require('path'),crypto=require('crypto');
const SECRET='test-secret-phase4'; const b64u=b=>Buffer.from(b).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
const jwt=(sub,scope)=>{const h=b64u(JSON.stringify({alg:'HS256',typ:'JWT'})),p=b64u(JSON.stringify({sub,email:sub+'@x.test',name:'Nancy Test',scope,regions:['marco'],exp:Math.floor(Date.now()/1000)+3600}));return `${h}.${p}.${b64u(crypto.createHmac('sha256',SECRET).update(`${h}.${p}`).digest())}`;};
const PAID=jwt('user-nancy','single'), FREE=jwt('user-free','none');
const PHP='http://127.0.0.1:8097/_collection.php';
const PHOTO='data:image/jpeg;base64,'+fs.readFileSync('/tmp/photo.b64','utf8').trim();
const server=http.createServer((req,res)=>{let p=req.url.split('?')[0]; if(p==='/app/'||p==='/app')p='/app/index.html'; const f=path.join(__dirname,'site',p); if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'text/html');fs.createReadStream(f).pipe(res);}else{res.statusCode=404;res.end();}});
const results=[]; const ok=(n,c,d)=>{results.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?'  — '+d:''));};
let collCalls=0;
async function device(browser,token,label){
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}); const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  await page.route(/^https?:\/\/(?!localhost)/,async r=>{ const u=new URL(r.request().url());
    if(u.pathname==='/_auth.php'){ const scope=token===PAID?'single':'none'; const id=token===PAID?'user-nancy':'user-free'; return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({valid:true,user:{id,email:id+'@x.test',name:'Nancy Test',scope,regions:['marco']}})}); }
    if(u.pathname==='/_collection.php'){ collCalls++; const resp=await r.fetch({url:PHP+u.search}); return r.fulfill({response:resp}); }
    if(u.pathname==='/assets/dining.json') return r.fulfill({status:200,contentType:'application/json',body:fs.readFileSync('site/assets/dining.json','utf8')});
    return r.abort(); });
  await page.addInitScript(t=>{ if(!localStorage.getItem('__p')){ localStorage.setItem('bcm_access_token',t); localStorage.setItem('bcm_selected_region','marco'); localStorage.setItem('__p','1'); } },token);
  await page.goto('http://localhost:8096/app/'); await page.waitForTimeout(2500);   // init() awaits verify
  const st=await page.evaluate(()=>({scope:bcmAuth.scope,enabled:bcmSync.enabled(),state:bcmSync.state}));
  return {ctx,page,errs,label,st};
}
const shells=p=>p.evaluate(async()=>(await dbGetAll()).map(r=>({id:r.id,name:r.name,cid:r.cid,synced:!!r.synced_at,notes:r.user_notes||'',tags:r.tags||[],hasPhoto:typeof r.image_data==='string'&&r.image_data.startsWith('data:image/jpeg;base64,'),photoLen:(r.image_data||'').length})));
const serverList=async()=>{const r=await fetch(PHP+'?list=1&region=marco',{headers:{Authorization:'Bearer '+PAID}}); return (await r.json()).shells||[];};
(async()=>{
  await new Promise(r=>server.listen(8096,r)); const browser=await chromium.launch();
  // ── Device A (phone): two legacy shells saved before Phase 4 (no cid), then first sync
  const A=await device(browser,PAID,'A');
  ok('A: paid login recognised, sync enabled', A.st.scope==='single'&&A.st.enabled, JSON.stringify(A.st));
  await A.page.evaluate(async photo=>{ await _dbInsertRaw({name:'Lightning Whelk',scientific:'Sinistrofulgur perversum',rarity:'Common',location:'Tigertail Beach, Marco Island',date_found:'2026-10-30',user_notes:'',image_data:photo,saved_at:'2026-10-30T15:00:00.000Z'}); await _dbInsertRaw({name:'Junonia',scientific:'Scaphella junonia',rarity:'Rare',location:'Marco Island, FL',date_found:'2026-10-31',user_notes:'lucky day',image_data:photo,saved_at:'2026-10-31T15:00:00.000Z'}); },PHOTO);
  await A.page.evaluate(()=>bcmSync.sync('test')); await A.page.waitForTimeout(500);
  let a=await shells(A.page); let sv=await serverList();
  ok('A: legacy shells got cids and synced', a.length===2&&a.every(x=>x.cid&&x.synced), JSON.stringify(a.map(x=>[x.name,!!x.cid,x.synced])));
  ok('server: 2 shells with photos, no image_data inline', sv.length===2&&sv.every(x=>x.has_photo&&!('image_data' in x.data)), JSON.stringify(sv.map(x=>[x.data.name,x.has_photo])));
  ok('A: queue empty after flush', (await A.page.evaluate(()=>bcmSync.queue().length))===0);
  // ── Device B (iPad): fresh install, same login → shells arrive with photos
  const B=await device(browser,PAID,'B');
  await B.page.waitForTimeout(1500);   // start() kicks a sync on auth; give it a moment
  let b=await shells(B.page);
  ok('B: 2 shells pulled on first launch, photos backfilled locally', b.length===2&&b.every(x=>x.hasPhoto&&x.synced&&x.photoLen>1000), JSON.stringify(b.map(x=>[x.name,x.hasPhoto,x.photoLen])));
  await B.page.evaluate(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/Collection/.test(x.textContent)); if(b) b.click(); }); await B.page.waitForTimeout(800);
  const bt=await B.page.evaluate(()=>document.body.innerText);
  ok('B: Collection screen shows both shells', bt.includes('Lightning Whelk')&&bt.includes('Junonia'));
  // ── B edits notes on Junonia → A sees it
  const jB=b.find(x=>x.name==='Junonia');
  await B.page.evaluate(async id=>{ await dbUpdateNotes(id,'found by Nancy on the iPad'); },jB.id); await B.page.waitForTimeout(800);
  sv=await serverList(); ok('server: notes patched from B', (sv.find(x=>x.data.name==='Junonia')||{data:{}}).data.user_notes==='found by Nancy on the iPad');
  await A.page.evaluate(()=>bcmSync.sync('test')); await A.page.waitForTimeout(400);
  a=await shells(A.page); ok('A: notes merged from server', (a.find(x=>x.name==='Junonia')||{}).notes==='found by Nancy on the iPad');
  // ── A deletes Lightning Whelk → server → B
  const lwA=a.find(x=>x.name==='Lightning Whelk');
  await A.page.evaluate(async id=>{ await dbDelete(id); },lwA.id); await A.page.waitForTimeout(800);
  sv=await serverList(); ok('server: Lightning Whelk deleted by A', sv.length===1&&sv[0].data.name==='Junonia');
  await B.page.evaluate(()=>bcmSync.sync('test')); await B.page.waitForTimeout(400);
  b=await shells(B.page); ok('B: deletion propagated (1 shell left)', b.length===1&&b[0].name==='Junonia', JSON.stringify(b.map(x=>x.name)));
  // ── B offline: saves a shell, queue holds it; back online → flushed; A pulls it with photo
  await B.ctx.setOffline(true);
  await B.page.evaluate(async photo=>{ await dbAdd({name:'Alphabet Cone',scientific:'Conus spurius',rarity:'Uncommon',location:'Marco Island, FL',date_found:'2026-11-01',user_notes:'',image_data:photo}); },PHOTO);
  await B.page.waitForTimeout(600);
  const qOff=await B.page.evaluate(()=>bcmSync.queue().map(x=>x.op));
  ok('B offline: save queued, not lost', qOff.length===1&&qOff[0]==='put', JSON.stringify(qOff));
  sv=await serverList(); ok('server: nothing arrived while offline', sv.length===1);
  await B.ctx.setOffline(false); await B.page.evaluate(()=>window.dispatchEvent(new Event('online'))); await B.page.waitForTimeout(1200);
  sv=await serverList(); ok('server: queued shell flushed when back online', sv.length===2&&sv.some(x=>x.data.name==='Alphabet Cone'&&x.has_photo), JSON.stringify(sv.map(x=>[x.data.name,x.has_photo])));
  ok('B: queue drained', (await B.page.evaluate(()=>bcmSync.queue().length))===0);
  await A.page.evaluate(()=>bcmSync.sync('test')); await A.page.waitForTimeout(600);
  a=await shells(A.page); ok('A: Alphabet Cone arrived with photo', a.some(x=>x.name==='Alphabet Cone'&&x.hasPhoto), JSON.stringify(a.map(x=>[x.name,x.hasPhoto])));
  // ── tags from A → B
  const acA=a.find(x=>x.name==='Alphabet Cone');
  await A.page.evaluate(async id=>{ await dbUpdateTags(id,['favorite','gift']); },acA.id); await A.page.waitForTimeout(800);
  await B.page.evaluate(()=>bcmSync.sync('test')); await B.page.waitForTimeout(400);
  b=await shells(B.page); ok('B: tags merged from A', JSON.stringify((b.find(x=>x.name==='Alphabet Cone')||{}).tags)==='["favorite","gift"]');
  // ── Shell by Sight: image is a bundled path, not a photo → must arrive on the other device as the same path
  await A.page.evaluate(async()=>{ await dbAdd({name:'Fighting Conch',scientific:'Strombus alatus',rarity:'Common',location:'Marco Island, FL',date_found:'2026-11-01',user_notes:'by sight',image_data:'assets/img/shells/strombus_alatus.webp'}); }); await A.page.waitForTimeout(900);
  sv=await serverList(); const fc=sv.find(x=>x.data.name==='Fighting Conch');
  ok('server: Shell-by-Sight record carries image_ref, no photo', !!fc&&fc.has_photo===false&&fc.data.image_ref==='assets/img/shells/strombus_alatus.webp', JSON.stringify(fc&&{has_photo:fc.has_photo,ref:fc.data.image_ref}));
  await B.page.evaluate(()=>bcmSync.sync('test')); await B.page.waitForTimeout(500);
  const fcB=await B.page.evaluate(async()=>(await dbGetAll()).find(r=>r.name==='Fighting Conch'));
  ok('B: Shell-by-Sight shell shows the bundled image path', !!fcB&&fcB.image_data==='assets/img/shells/strombus_alatus.webp', fcB&&fcB.image_data);
  // repair path: a record synced BEFORE this fix (server copy has no image_ref) — simulate by stripping the ref server-side via a put without it
  await fetch(PHP,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+PAID},body:JSON.stringify({action:'put',shell:{cid:fc.cid,region:'marco',updated:'2030-01-01T00:00:00Z',data:{name:'Fighting Conch',scientific:'Strombus alatus'}}})});
  // B lost its image (as a pre-fix device would have): clear it locally, then A (which has the path) syncs and repairs the server, then B picks it up
  await B.page.evaluate(async()=>{ const r=(await dbGetAll()).find(x=>x.name==='Fighting Conch'); r.image_data=''; await _dbPutRaw(r); });
  await A.page.evaluate(()=>bcmSync.sync('test')); await A.page.waitForTimeout(900);
  sv=await serverList(); ok('server: image_ref repaired by the device that has the path', (sv.find(x=>x.data.name==='Fighting Conch')||{data:{}}).data.image_ref==='assets/img/shells/strombus_alatus.webp');
  await B.page.evaluate(()=>bcmSync.sync('test')); await B.page.waitForTimeout(500);
  const fcB2=await B.page.evaluate(async()=>(await dbGetAll()).find(r=>r.name==='Fighting Conch'));
  ok('B: missing image filled from the server ref', !!fcB2&&fcB2.image_data==='assets/img/shells/strombus_alatus.webp', fcB2&&fcB2.image_data);

  // ── Free account: local only, never talks to _collection.php
  const before=collCalls; const F=await device(browser,FREE,'F');
  ok('F: free scope → sync disabled', F.st.scope==='none'&&!F.st.enabled, JSON.stringify(F.st));
  await F.page.evaluate(async photo=>{ await dbAdd({name:'Banded Tulip',scientific:'Strombus alatus',rarity:'Common',location:'x',date_found:'2026-11-01',user_notes:'',image_data:photo}); },PHOTO); await F.page.waitForTimeout(600);
  const f=await shells(F.page); ok('F: shell saved locally with a cid, nothing queued, no server calls', f.length===1&&f[0].cid&&!f[0].synced&&collCalls===before&&(await F.page.evaluate(()=>bcmSync.queue().length))===0, `collCalls ${collCalls-before}`);
  // ── Reel publish still works from a synced shell (thumb from base64 image_data)
  const reelOK=await B.page.evaluate(async()=>{ const s=(await dbGetAll())[0]; const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=s.image_data;}); const c=document.createElement('canvas'); c.width=img.width; c.height=img.height; c.getContext('2d').drawImage(img,0,0); return c.toDataURL('image/jpeg',0.8).length>1000; });
  ok('B: synced photo is canvas-safe (reel thumbnails work)', reelOK);
  ok('no page errors on any device', A.errs.length===0&&B.errs.length===0&&F.errs.length===0, [A.errs,B.errs,F.errs].flat().slice(0,3).join(' | '));
  await browser.close(); server.close(); const fails=results.filter(x=>!x).length; console.log(`\n${results.length-fails}/${results.length} passed`); process.exit(fails?1:0);
})();
