const { chromium } = require('playwright'); const fs=require('fs'),http=require('http'),path=require('path');
const server=http.createServer((req,res)=>{let p=req.url.split('?')[0]; if(p==='/app/'||p==='/app')p='/app/index.html'; const f=path.join(__dirname,'site',p); if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'text/html');fs.createReadStream(f).pipe(res);}else{res.statusCode=404;res.end();}});
const results=[]; const ok=(n,c,d)=>{results.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?'  — '+d:''));};
(async()=>{ await new Promise(r=>server.listen(8098,r)); const b=await chromium.launch(); const page=await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  await page.route(/^https?:\/\/(?!localhost)/,r=>r.abort());
  await page.goto('http://localhost:8098/app/'); await page.waitForTimeout(1500);
  // get to the offline funnel: the home screen has a "Shell by Sight" entry
  const opened=await page.evaluate(()=>{ const el=[...document.querySelectorAll('button')].find(x=>/Shell ID by Sight/i.test(x.textContent||'')); if(el){el.click();return el.textContent.trim().slice(0,60);} return null; });
  await page.waitForTimeout(600);
  const t0=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
  ok('funnel opens at STEP 1', /STEP 1 OF 4/.test(t0), opened);
  ok('"Fill in the blanks" link gone, "Pick visually" present on step 1', !/Fill in the blanks/.test(t0)&&/Pick visually/.test(t0));
  const pick=async label=>{ await page.evaluate(l=>{ const el=[...document.querySelectorAll('div')].find(x=>x.textContent.trim()===l&&x.children.length===0); el&&el.parentElement.click(); },label); await page.waitForTimeout(350); };
  // scroll down before answering, to prove each step resets to the top
  await page.evaluate(()=>{document.getElementById('bcm-scroll').scrollTop=600;});
  await pick('Spiral / Coiled'); const s2=await page.evaluate(()=>document.getElementById('bcm-scroll').scrollTop); const t2=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
  ok('step 2 reached and scrolled to top', /STEP 2 OF 4/.test(t2)&&s2===0, 'scrollTop='+s2);
  await pick('Smooth & Glossy'); await pick('Striped, Rayed, or Banded'); await page.evaluate(()=>{document.getElementById('bcm-scroll').scrollTop=500;}); await pick('Medium (2–4")');
  const tr=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ')); const m=tr.match(/Showing the top (\d+) of (\d+) likely matches/);
  const cards=await page.evaluate(()=>document.querySelectorAll('img[src*="assets/img/shells"]').length);
  ok('results: top 12 of a short list (was ~100)', !!m&&+m[1]===12&&+m[2]<60, m?`${m[1]} of ${m[2]}`:tr.slice(tr.indexOf('Top Local'),tr.indexOf('Top Local')+120));
  ok('results page scrolled to top', (await page.evaluate(()=>document.getElementById('bcm-scroll').scrollTop))===0);
  ok('True Tulip / Banded Tulip in the list for Spiral+Smooth+Banded+Medium', /True Tulip/.test(tr)&&/Banded Tulip/.test(tr));
  ok('results page: no "Fill in the blanks", has "Pick visually"', !/Fill in the blanks/.test(tr)&&/Pick visually/.test(tr));
  // Start Over from the bottom of the results page
  await page.evaluate(()=>{const sc=document.getElementById('bcm-scroll');sc.scrollTop=sc.scrollHeight;});
  await page.evaluate(()=>{ const btn=[...document.querySelectorAll('button')].find(x=>/Start Over/.test(x.textContent)); btn.click(); }); await page.waitForTimeout(400);
  const t1=await page.evaluate(()=>({text:document.body.innerText.replace(/\s+/g,' '),st:document.getElementById('bcm-scroll').scrollTop}));
  ok('Start Over → STEP 1 at the top of the page', /STEP 1 OF 4/.test(t1.text)&&t1.st===0, 'scrollTop='+t1.st);
  // fast-track: Flat / Disc still returns results with the lower bar
  await pick('Flat / Disc / Urchin'); const td=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
  const dcards=await page.evaluate(()=>document.querySelectorAll('img[src*="assets/img/shells"]').length);
  ok('Disc fast-track still shows matches (sand dollars/urchins)', /Top Local Matches/.test(td)&&/Sand Dollar/.test(td)&&/Urchin/.test(td), td.slice(td.indexOf('Sand Dollar'),td.indexOf('Sand Dollar')+60));
  // Pick visually opens the cheat sheet with all species
  await page.evaluate(()=>{ const btn=[...document.querySelectorAll('button')].find(x=>/Pick visually/.test(x.textContent)); btn.click(); }); await page.waitForTimeout(600);
  const tc=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
  ok('Pick visually opens the species cheat sheet', /Junonia/.test(tc)&&/Lightning Whelk/.test(tc)&&/Alphabet Cone/.test(tc));
  ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
  // every full path through scoreShell in-page: never zero, median small
  const stats=await page.evaluate(()=>{ const M=MACRO_STRUCTURE_OPTIONS,G=GASTROPOD_TEXTURE_OPTIONS,B=BIVALVE_SHAPE_OPTIONS,C=COLOR_PATTERN_OPTIONS,Z=SIZE_OPTIONS; const counts=[]; for(const m of M){ if(m.value==='disc'||m.value==='tube'){counts.push(MASTER_SHELL_DB.filter(x=>scoreShell(x,{macro:m.value})>=40).length);continue;} for(const t of (m.value==='spiral'?G:B)) for(const c of C) for(const z of Z){ const a={macro:m.value,[t.filterKey]:t.value,colorPattern:c.value,sizeCategory:z.value}; counts.push(MASTER_SHELL_DB.filter(x=>scoreShell(x,a)>=70).length);} } counts.sort((a,b)=>a-b); return {paths:counts.length,min:counts[0],median:counts[Math.floor(counts.length/2)],max:counts[counts.length-1]}; });
  ok('all 122 paths: never zero, median ~22', stats.min>=2&&stats.median<=25, JSON.stringify(stats));
  await b.close(); server.close(); const f=results.filter(x=>!x).length; console.log(`\n${results.length-f}/${results.length} passed`); process.exit(f?1:0);
})();
