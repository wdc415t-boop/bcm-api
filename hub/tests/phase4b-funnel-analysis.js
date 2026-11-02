const fs=require('fs'),vm=require('vm');
const s=fs.readFileSync('public_html/app/index.html','utf8');
function grab(name){ const i=s.indexOf(name); let j=s.indexOf('=',i)+1; let k=j; let d=0,q=null,started=false;
  for(;k<s.length;k++){const c=s[k]; if(q){ if(c==='\\'){k++;continue;} if(c===q)q=null; continue;} if(c==='"'||c==="'"||c==='`'){q=c;continue;} if(c==='['||c==='{'){d++;started=true;} else if(c===']'||c==='}'){d--; if(started&&d===0)break;} }
  return s.slice(j,k+1); }
const ctx={}; vm.createContext(ctx);
for(const n of ['const MASTER_SHELL_DB ','const SIZE_ORDER','const MACRO_STRUCTURE_OPTIONS','const GASTROPOD_TEXTURE_OPTIONS','const BIVALVE_SHAPE_OPTIONS','const COLOR_PATTERN_OPTIONS','const SIZE_OPTIONS','const ADVANCED_SEARCH_FIELDS']){ vm.runInContext(n.replace('const ','').trim()+'='+grab(n)+';',ctx); }
// functions
for(const fn of ['function scoreShell','function getDistinctValues']){ const i=s.indexOf(fn); let k=s.indexOf('{',i),d=0; for(;k<s.length;k++){ if(s[k]==='{')d++; else if(s[k]==='}'){d--; if(d===0)break;} } vm.runInContext(s.slice(i,k+1),ctx); }
const DB=ctx.MASTER_SHELL_DB; console.log('species:',DB.length);
console.log('ADVANCED_SEARCH_FIELDS:',ctx.ADVANCED_SEARCH_FIELDS.map(f=>f.key+':'+f.label).join(' | '));
console.log('\n## Fill-in-the-blanks: single-field value counts');
for(const f of ctx.ADVANCED_SEARCH_FIELDS){ const vals=ctx.getDistinctValues(f.key); const counts=vals.map(v=>[v,DB.filter(x=>x[f.key]===v).length]); console.log(' ',f.key,'('+vals.length+' values):',counts.map(c=>c[0]+'='+c[1]).join(', ')); }
// two-field combos: fraction that yield zero
const F=ctx.ADVANCED_SEARCH_FIELDS.map(f=>f.key); let combos=0,zero=0;
for(let a=0;a<F.length;a++)for(let b=a+1;b<F.length;b++){ for(const va of ctx.getDistinctValues(F[a])) for(const vb of ctx.getDistinctValues(F[b])){ combos++; if(!DB.some(x=>x[F[a]]===va&&x[F[b]]===vb)) zero++; } }
console.log(`\n## two-filter combos: ${zero}/${combos} (${Math.round(100*zero/combos)}%) return "No matches for that exact combination."`);
// data quality: how many records lack each attribute
console.log('\n## records missing attributes:', F.map(k=>k+'='+DB.filter(x=>x[k]===undefined||x[k]===''||x[k]===null).length).join(', '));
// funnel paths
console.log('\n## Shell-by-Sight funnel paths → result counts (score>20), top-8 shown');
const M=ctx.MACRO_STRUCTURE_OPTIONS, G=ctx.GASTROPOD_TEXTURE_OPTIONS, B=ctx.BIVALVE_SHAPE_OPTIONS, C=ctx.COLOR_PATTERN_OPTIONS, Z=ctx.SIZE_OPTIONS;
const run=a=>DB.map(x=>({n:x.name,sc:ctx.scoreShell(x,a)})).filter(x=>x.sc>20).sort((p,q)=>q.sc-p.sc);
const paths=[]; 
for(const m of M){ if(m.value==='disc'||m.value==='tube'){ const r=run({macro:m.value}); paths.push([m.label,'',r.length, r.slice(0,3).map(x=>x.n+':'+x.sc).join(', ')]); continue; }
  const second=m.value==='spiral'?G:B; for(const t of second) for(const c of C) for(const z of Z){ const r=run({macro:m.value,[t.filterKey]:t.value,colorPattern:c.value,sizeCategory:z.value}); paths.push([m.label,`${t.label} / ${c.label} / ${z.label}`,r.length,r.slice(0,3).map(x=>x.n+':'+x.sc).join(', ')]); } }
const stats=paths.map(p=>p[2]); console.log('paths:',paths.length,'| zero-result paths:',stats.filter(n=>n===0).length,'| paths with >8 (truncated):',stats.filter(n=>n>8).length,'| median results:',stats.sort((a,b)=>a-b)[Math.floor(stats.length/2)], '| max:',Math.max(...stats));
console.log('\nsample paths:'); for(const p of paths.filter((_,i)=>i%9===0).slice(0,14)) console.log('  ',p[0],'|',p[1],'→',p[2],'|',p[3]);
// how discriminating: does the TRUE path for each shell put it in the top 8?
console.log('\n## does a shell\'s own correct answers rank it in the top 8?');
let hit=0,miss=[];
for(const x of DB){ let a={}; if(x.shape==='disc'){a={macro:'disc'};} else if(x.type==='Bivalve'){ a={macro:'bivalve',shape:x.shape,colorPattern:x.colorPattern,sizeCategory:x.sizeCategory}; } else { a={macro:'spiral',surface:x.surface,colorPattern:x.colorPattern,sizeCategory:x.sizeCategory}; }
  const r=run(a); const idx=r.findIndex(y=>y.n===x.name); if(idx>-1&&idx<8) hit++; else miss.push(x.name+'(rank '+(idx+1)+' of '+r.length+')'); }
console.log(`  ${hit}/${DB.length} ranked in top 8 by their own attributes; misses: ${miss.slice(0,12).join('; ')}${miss.length>12?' …':''}`);

console.log('\n## threshold experiment (full 4-step paths only; disc/tube fast-track excluded)');
const fullPaths=[]; for(const m of M){ if(m.value==='disc'||m.value==='tube') continue; const second=m.value==='spiral'?G:B; for(const t of second) for(const c of C) for(const z of Z) fullPaths.push({macro:m.value,[t.filterKey]:t.value,colorPattern:c.value,sizeCategory:z.value}); }
for(const [thr,show] of [[20,8],[60,8],[70,8],[70,12],[85,12],[100,12]]){
  const counts=fullPaths.map(a=>DB.filter(x=>ctx.scoreShell(x,a)>=thr).length).sort((a,b)=>a-b);
  let hit=0,zero=0; for(const x of DB){ if(x.shape==='disc') {hit++;continue;} const a=x.type==='Bivalve'?{macro:'bivalve',shape:x.shape,colorPattern:x.colorPattern,sizeCategory:x.sizeCategory}:{macro:'spiral',surface:x.surface,colorPattern:x.colorPattern,sizeCategory:x.sizeCategory}; const r=DB.map(y=>({n:y.name,sc:ctx.scoreShell(y,a)})).filter(y=>y.sc>=thr).sort((p,q)=>q.sc-p.sc); const i=r.findIndex(y=>y.n===x.name); if(i>-1&&i<show) hit++; }
  zero=counts.filter(c=>c===0).length;
  console.log(`  score>=${thr}, show ${show}: results/path min ${counts[0]} median ${counts[Math.floor(counts.length/2)]} max ${counts[counts.length-1]} | zero-result paths ${zero}/${fullPaths.length} | own-attributes in shown list ${hit}/${DB.length}`);
}
