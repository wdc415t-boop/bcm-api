const { chromium } = require('playwright'); const fs=require('fs'),http=require('http'),path=require('path');
const MIME={'.js':'application/javascript','.json':'application/json','.webp':'image/webp','.html':'text/html'};
let online=true;
const server=http.createServer((req,res)=>{ if(!online){res.destroy();return;} let p=req.url.split('?')[0]; if(p==='/app/'||p==='/app')p='/app/index.html';
  // the CDN scripts are served from /vendor in the test; the page is rewritten to use them
  const f=path.join(__dirname,'site',p); if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.setHeader('Content-Type',MIME[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(res);}else{res.statusCode=404;res.end();}});
const results=[]; const ok=(n,c,d)=>{results.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?'  — '+d:''));};
(async()=>{ await new Promise(r=>server.listen(8099,r)); const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'allow'}); const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  // CDN scripts → local vendor copies (so the SW sees real cdnjs URLs but the test stays offline-deterministic)
  await page.route(/^https?:\/\/(?!localhost)/,r=>{ const u=r.request().url(); if(/react-dom/.test(u)) return r.fulfill({status:200,contentType:'application/javascript',body:fs.readFileSync('site/vendor/react-dom.js')}); if(/\/react\//.test(u)) return r.fulfill({status:200,contentType:'application/javascript',body:fs.readFileSync('site/vendor/react.js')}); if(/jspdf/.test(u)) return r.fulfill({status:200,contentType:'application/javascript',body:'/* jspdf stub */'}); return r.abort(); });
  await page.goto('http://localhost:8099/app/'); 
  const reg=await page.evaluate(async()=>{ const r=await navigator.serviceWorker.ready; return {scope:r.scope,active:!!r.active}; });
  ok('service worker registered and active (root scope covers /app/)', reg.active&&/localhost:8099\/$/.test(reg.scope), JSON.stringify(reg));
  // wait for precache to finish (poll the cache)
  let counts={}; for(let i=0;i<60;i++){ counts=await page.evaluate(async()=>{ const out={}; for(const k of await caches.keys()){ out[k]=(await (await caches.open(k)).keys()).length; } return out; }); if((counts['bcm-app-v2-assets']||0)>=135) break; await page.waitForTimeout(500); }
  ok('precache filled: 132 pictures + 3 CDN scripts in assets, app page in shell', (counts['bcm-app-v2-assets']||0)>=135&&(counts['bcm-app-v2-shell']||0)>=1, JSON.stringify(counts));
  // go fully offline: server refuses, CDN route aborts anyway
  online=false; await ctx.setOffline(true);
  await page.reload({waitUntil:'load'}).catch(()=>{}); await page.waitForTimeout(2000);
  const t=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,200));
  ok('OFFLINE reload: app page served from cache and React booted (home screen renders)', /Region|Shell ID by Sight|Identify/.test(t), t.slice(0,90));
  const img=await page.evaluate(async()=>{ try{ const r=await fetch('/app/assets/img/shells/scaphella_junonia.webp'); return {ok:r.ok,len:(await r.arrayBuffer()).byteLength}; }catch(e){ return {ok:false,err:String(e)}; } });
  ok('OFFLINE: species picture served from cache', img.ok&&img.len>0, JSON.stringify(img));
  const uiimg=await page.evaluate(async()=>{ try{ const r=await fetch('/app/assets/img/ui/size_small.webp'); return r.ok; }catch(e){ return false; } });
  ok('OFFLINE: funnel UI picture served from cache', uiimg);
  // Shell ID by Sight works offline end to end
  await page.evaluate(()=>{ const el=[...document.querySelectorAll('button')].find(x=>/Shell ID by Sight/i.test(x.textContent||'')); el&&el.click(); }); await page.waitForTimeout(500);
  const t2=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
  ok('OFFLINE: Shell ID by Sight opens at STEP 1', /STEP 1 OF 4/.test(t2));
  await page.waitForTimeout(800); const dbg=await page.evaluate(()=>({imgs:document.querySelectorAll('img').length, srcs:[...document.querySelectorAll('img')].slice(0,3).map(i=>i.getAttribute('src')), text:document.body.innerText.replace(/\s+/g,' ').slice(0,160)})); console.log('DBG',JSON.stringify(dbg));
  const loaded=await page.evaluate(async()=>{ const imgs=[...document.querySelectorAll('img')].filter(i=>/assets\/img/.test(i.getAttribute('src')||'')); const res=[]; for(const i of imgs){ try{ const r=await fetch(i.getAttribute('src')); res.push(r.ok); }catch(e){ res.push(false); } } return {count:imgs.length, allOk:res.every(Boolean), srcs:imgs.slice(0,2).map(i=>i.getAttribute('src'))}; });
  ok('OFFLINE: step-1 option pictures resolve (no network)', loaded.count>=4&&loaded.allOk, JSON.stringify(loaded));
  // back online: a changed page shows up on next load (network-first), cache refreshed
  online=true; await ctx.setOffline(false);
  fs.writeFileSync('site/app/index.html', fs.readFileSync('site/app/index.html','utf8').replace('<title>','<title>V2 '));
  await page.reload({waitUntil:'load'}); await page.waitForTimeout(800);
  const title=await page.title(); ok('ONLINE again: new deploy shows at once (network-first shell)', /^V2 /.test(title), title.slice(0,40));
  ok('no page errors', errs.filter(e=>!/jspdf|jsPDF/.test(e)).length===0, errs.slice(0,2).join(' | '));
  await b.close(); server.close(); const f=results.filter(x=>!x).length; console.log(`\n${results.length-f}/${results.length} passed`); process.exit(f?1:0);
})();
