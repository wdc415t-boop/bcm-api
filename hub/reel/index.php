<?php
/**
 * BCM Excursion Reel viewer (Phase 1c, 2026-10-28; Phase 1g 2026-10-29: tap-to-watch with sound, intro timing, native share;
 *   Phase 3c 2026-10-31: the reel title is the headline on the cover and intro slide so a rename shows on the next open, "Their photo" chip removed;
 *   Phase 3e 2026-11-01: a "Back to app" exit on every screen and on the finale. An iPhone home-screen app has no browser bar,
 *   so a viewer opened from the app had no way back (Nancy's iPhone); Android showed the system back arrow. Esc key exits too;
 *   Phase 3f 2026-11-01: the shelling-etiquette slide is skipped when the reel opens from the app (members have read it), and
 *   runs 6s instead of 8s for shared-link viewers, who can pause to read. Nancy's request: intro straight to the first find;
 *   Phase 6g 2026-11-03: tablets — portrait screens use the stacked layout, and from 600px up each find photo shows whole
 *   (object-fit:contain) over a blurred copy of itself. The two-column layout had been cropping iPad photos to a sliver.)
 * Deploy to: beachcombersmania.online/public_html/reel/index.php   → https://beachcombersmania.online/reel/?r=TOKEN
 * Reads the reel record written by _reel.php (outside public_html), enriches each find from
 * assets/MASTER-SHELL-DB.json, emits Open Graph tags for the share card, then the slideshow.
 */
$configPaths = [dirname(dirname(__DIR__)) . '/_bcm_config.php', dirname(dirname(dirname(__DIR__))) . '/_bcm_config.php', dirname(__DIR__) . '/_bcm_config.php'];
foreach ($configPaths as $path) { if (file_exists($path)) { require_once $path; break; } }
$reelDir = defined('BCM_REEL_DIR') ? BCM_REEL_DIR : dirname(dirname(__DIR__)) . '/bcm-reels';
$base = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'beachcombersmania.online');

header('Cache-Control: no-cache');   // Phase 3c: titles can change (rename), so never serve a stale copy
$token = $_GET['r'] ?? '';
$reel = null; $err = '';
if (!preg_match('/^[A-Za-z0-9]{10,16}$/', $token)) $err = 'This link is missing its reel id.';
elseif (!is_file($reelDir . '/' . $token . '.json')) $err = 'This excursion reel is no longer available.';
else { $reel = json_decode(file_get_contents($reelDir . '/' . $token . '.json'), true); if (!$reel) $err = 'This reel could not be read.'; else @touch($reelDir . '/' . $token . '.json'); }

// Enrich finds from the species database (match on scientific name, then common name)
$db = []; $dbPath = dirname(__DIR__) . '/assets/MASTER-SHELL-DB.json';
if (is_file($dbPath)) { $j = json_decode(file_get_contents($dbPath), true); foreach (($j['species'] ?? []) as $s) { $db[mb_strtolower($s['sci'])] = $s; $db['name:' . mb_strtolower($s['name'])] = $s; } }
if ($reel) {
    foreach ($reel['finds'] as &$f) {
        $s = $db[mb_strtolower($f['sci'] ?? '')] ?? $db['name:' . mb_strtolower($f['name'] ?? '')] ?? null;
        $f['species'] = $s ? ['id' => $s['id'], 'name' => $s['name'], 'sci' => $s['sci'], 'family' => $s['family'] ?? '', 'type' => $s['type'] ?? '', 'rarity' => $s['rarity'] ?? '', 'size' => $s['size'] ?? '', 'habitat' => $s['habitat'] ?? '', 'fact' => $s['fact'] ?? '', 'imagePath' => $s['imagePath'] ?? ''] : null;
        $f['photo'] = $f['has_photo'] ? $base . '/_reel.php?r=' . $token . '&img=' . $f['n'] : null;
    }
    unset($f);
}
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
$title = $reel ? ($reel['title'] ?: ($reel['region'] . ' Excursion Reel')) : 'BeachCombersMania Excursion Reel';
$count = $reel ? count($reel['finds']) : 0;
$desc = $reel ? ($count . ' find' . ($count === 1 ? '' : 's') . ' from ' . ($reel['beach'] ?: $reel['region']) . ' · ' . $reel['date'] . ' · identified with BeachCombersMania') : 'A shelling excursion, identified with BeachCombersMania.';
$coverFind = $reel ? ($reel['finds'][$reel['cover']] ?? null) : null;
$ogImage = ($coverFind && $coverFind['photo']) ? $coverFind['photo'] : $base . '/assets/og-beach.jpg';
$pageUrl = $base . '/reel/?r=' . $h($token);
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title><?= $h($title) ?> · BeachCombersMania</title>
<meta name="description" content="<?= $h($desc) ?>">
<meta property="og:type" content="article">
<meta property="og:title" content="<?= $h($title) ?>">
<meta property="og:description" content="<?= $h($desc) ?>">
<meta property="og:url" content="<?= $pageUrl ?>">
<meta property="og:image" content="<?= $h($ogImage) ?>">
<meta property="og:site_name" content="BeachCombersMania">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,600;1,9..144,300&family=Nunito+Sans:ital,opsz,wght@0,6..12,400;0,6..12,600;0,6..12,700&display=swap">
<?php readfile(dirname(__DIR__) . '/reel/analytics-block.html'); ?>
<style>
:root{--ocean:#07131f;--deep:#0d2236;--ink:#f3efe6;--ink-dim:#b7c3cf;--tide:#6cc4ff;--sand:#e8c98a;--coral:#ff8a65;--line:rgba(243,239,230,.14);--display:"Fraunces",Georgia,serif;--body:"Nunito Sans","Helvetica Neue",Arial,sans-serif;--gl:max(16px,env(safe-area-inset-left,0px));--gr:max(16px,env(safe-area-inset-right,0px));color-scheme:dark}
html,body{height:100%}body{margin:0;background:var(--ocean);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.5;overflow:hidden;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}a{color:var(--tide)}img,video{max-width:100%;display:block}
.stage{position:fixed;inset:0;background:var(--ocean);overflow:hidden}.layer{position:absolute;inset:0;opacity:0;transition:opacity .9s ease;pointer-events:none}.layer.on{opacity:1;pointer-events:auto;z-index:2}
.soundbtn{display:inline-flex;align-items:center;gap:.4rem;margin-top:.4rem;padding:.5rem .9rem;border-radius:999px;border:1px solid var(--line);background:rgba(7,19,31,.55);color:var(--ink);font-weight:700;font-size:.85rem;backdrop-filter:blur(6px)}
@media (prefers-reduced-motion:reduce){.layer{transition:none}}
.slide{position:absolute;inset:0;display:grid;padding-left:var(--gl);padding-right:var(--gr);padding-block:calc(66px + env(safe-area-inset-top,0px)) calc(84px + env(safe-area-inset-bottom,0px))}
.eyebrow{font-weight:700;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--sand)}.eyebrow.blue{color:var(--tide)}
h1,h2{font-family:var(--display);font-weight:500;line-height:1.05;margin:0;text-wrap:balance}h1{font-size:clamp(2.2rem,7vw,4.4rem)}h2{font-size:clamp(1.7rem,4.6vw,3rem)}
.sci{font-family:var(--display);font-style:italic;font-weight:300;color:var(--ink-dim);font-size:clamp(1rem,2.2vw,1.25rem)}p{margin:0}
.intro video,.intro .poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.intro .scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,19,31,.15),rgba(7,19,31,.2) 45%,rgba(7,19,31,.92))}
.intro .copy{position:relative;align-self:end;display:grid;gap:.6rem;max-width:40rem}.intro .meta{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;color:var(--ink-dim);font-weight:600}
.card{align-self:center;justify-self:center;width:min(100%,62rem);background:var(--deep);border:1px solid var(--line);border-radius:14px;padding:clamp(1.25rem,3.5vw,2.5rem);display:grid;gap:1.1rem;max-height:100%;overflow-y:auto}
.rules{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1.25rem;margin-top:.5rem}.rule{border-top:1px solid var(--line);padding-top:.8rem;min-width:0}.rule b{display:block;font-family:var(--display);font-weight:500;font-size:1.25rem;margin:.1rem 0 .3rem}.rule p{color:var(--ink-dim)}
.find{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:0;padding:0}.find .photo{position:relative;min-height:0;background:#000;overflow:hidden}.find .photo img{width:100%;height:100%;object-fit:cover}
.find .photo .blur{display:none}
@media (min-width:600px){.find .photo .blur{display:block;position:absolute;inset:0;filter:blur(28px) brightness(.5);transform:scale(1.2)}.find .photo .main{position:relative;object-fit:contain}}
.find .tag{position:absolute;left:var(--gl);top:calc(66px + env(safe-area-inset-top,0px))}.chip{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:.35rem .6rem;border-radius:999px;background:rgba(7,19,31,.7);border:1px solid var(--line);backdrop-filter:blur(6px)}
.find .info{background:var(--deep);padding-left:clamp(1.25rem,3.5vw,3rem);padding-right:max(clamp(1.25rem,3.5vw,3rem),var(--gr));padding-block:calc(2rem + env(safe-area-inset-top,0px)) calc(96px + env(safe-area-inset-bottom,0px));display:grid;align-content:center;gap:1rem;overflow-y:auto;min-width:0}
.dl{display:grid;grid-template-columns:1fr 1fr;gap:.9rem 1.5rem;margin-top:.4rem}.dl div{border-top:1px solid var(--line);padding-top:.5rem;min-width:0}.dl dt{font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-dim);font-weight:700}.dl dd{margin:.15rem 0 0;font-weight:600}
.know{background:rgba(108,196,255,.08);border-left:3px solid var(--tide);padding:.8rem 1rem;border-radius:0 8px 8px 0}.know .eyebrow{display:block;margin-bottom:.3rem}.know p{font-family:var(--display);font-style:italic;font-weight:300;font-size:1.05rem;line-height:1.4}
.ref{display:flex;gap:.8rem;align-items:center;border-top:1px solid var(--line);padding-top:.8rem}.ref img{width:64px;height:64px;border-radius:8px;object-fit:cover;flex:none}.ref span{color:var(--ink-dim);font-size:.9rem}
.rar{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:.25rem .55rem;border-radius:4px;background:rgba(255,255,255,.08)}.rar.Uncommon,.rar.Rare{background:rgba(255,138,101,.18);color:var(--coral)}
@media (max-width:760px),(orientation:portrait){.brand{display:none}.find{grid-template-columns:1fr;grid-template-rows:minmax(0,42%) minmax(0,58%)}.find .info{padding-block:1.25rem calc(96px + env(safe-area-inset-bottom,0px));align-content:start}}
.tally{display:grid;grid-template-columns:repeat(auto-fit,minmax(7rem,1fr));gap:1rem}.stat{border-top:1px solid var(--line);padding-top:.6rem;min-width:0}.stat b{display:block;font-family:var(--display);font-weight:500;font-size:clamp(1.6rem,4vw,2.4rem);line-height:1}.stat span{display:block;color:var(--ink-dim);font-size:.85rem;margin-top:.25rem}
.actions{display:flex;flex-wrap:wrap;gap:.6rem}.btn{display:inline-flex;align-items:center;gap:.5rem;padding:.8rem 1.1rem;border-radius:10px;border:1px solid var(--line);font-weight:700;text-decoration:none;color:var(--ink);min-height:44px}.btn.primary{background:var(--tide);color:#07131f;border-color:var(--tide)}.btn.sand{background:var(--sand);color:#07131f;border-color:var(--sand)}
.btn:focus-visible,.ctl:focus-visible{outline:2px solid var(--tide);outline-offset:2px}.note{color:var(--ink-dim);font-size:.9rem}
.progress{position:absolute;left:0;right:0;top:0;height:3px;background:rgba(255,255,255,.12);z-index:5}.progress i{display:block;height:100%;background:var(--tide);width:0}.progress i.run{animation:fill var(--dur) linear forwards}.progress i.paused{animation-play-state:paused}@keyframes fill{from{width:var(--from)}to{width:var(--to)}}
.chrome{position:absolute;left:0;right:0;bottom:0;z-index:6;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-left:var(--gl);padding-right:var(--gr);padding-block:.75rem calc(.9rem + env(safe-area-inset-bottom,0px));background:linear-gradient(0deg,rgba(7,19,31,.85),rgba(7,19,31,0));transition:opacity .4s}.chrome.hide{opacity:0;pointer-events:none}
.ctl{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:rgba(243,239,230,.1);border:1px solid var(--line)}.ctl svg{width:20px;height:20px;fill:currentColor}.counter{font-variant-numeric:tabular-nums;color:var(--ink-dim);font-weight:600;letter-spacing:.05em}.group{display:flex;gap:.5rem;align-items:center}
.brand{position:absolute;right:var(--gr);top:calc(14px + env(safe-area-inset-top,0px));z-index:6;font-family:var(--display);font-weight:600;letter-spacing:.12em;font-size:.75rem;text-transform:uppercase;color:var(--ink-dim)}
.exit{position:absolute;left:var(--gl);top:calc(12px + env(safe-area-inset-top,0px));z-index:9;display:inline-flex;align-items:center;gap:.4rem;min-height:44px;padding:.55rem .95rem .55rem .8rem;border-radius:999px;background:rgba(7,19,31,.62);border:1px solid var(--line);color:var(--ink);font-weight:700;font-size:.9rem;backdrop-filter:blur(8px);text-decoration:none}.exit svg{width:18px;height:18px;fill:currentColor}
.tapzone{position:absolute;top:0;bottom:90px;width:22%;z-index:4}.tapzone.l{left:0}.tapzone.r{right:0}
.toast{position:absolute;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--ink);color:#07131f;padding:.5rem .9rem;border-radius:8px;font-weight:700;z-index:7;opacity:0;transition:opacity .3s}.toast.show{opacity:1}
.cover{position:absolute;inset:0;z-index:8;display:grid;align-content:end;gap:.8rem;padding-left:var(--gl);padding-right:var(--gr);padding-bottom:calc(2.2rem + env(safe-area-inset-bottom,0px));background:var(--ocean)}.cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55}.cover::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,19,31,.1),rgba(7,19,31,.35) 40%,rgba(7,19,31,.95))}.cover>*{position:relative}.cover .meta{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;color:var(--ink-dim);font-weight:600}.cover .go{display:inline-flex;align-items:center;gap:.6rem;justify-self:start;margin-top:.4rem;padding:1rem 1.5rem;border-radius:999px;background:var(--tide);color:#07131f;font-weight:800;font-size:1.05rem;min-height:52px}.cover .go svg{width:22px;height:22px;fill:currentColor}.cover .quiet{justify-self:start;color:var(--ink-dim);text-decoration:underline;font-weight:600;padding:.4rem 0}.cover.gone{display:none}
.sr{position:absolute;left:-9999px}.empty{display:grid;place-items:center;height:100%;padding:2rem;text-align:center}
</style>
</head>
<body>
<?php if ($err): ?>
<div class="empty"><div><span class="eyebrow">BeachCombersMania</span><h2 style="margin:.5rem 0 1rem"><?= $h($err) ?></h2><p class="note">Make your own at <a href="<?= $base ?>/app/">beachcombersmania.online/app</a></p></div></div>
<?php else: ?>
<div class="stage" id="stage" role="region" aria-roledescription="carousel" aria-label="<?= $h($title) ?>">
  <div class="cover" id="cover"><img src="<?= $h($ogImage) ?>" alt=""><span class="eyebrow">Excursion Reel</span><h1><?= $h($title) ?></h1><div class="meta"><span><?= $h($reel['beach'] ?: $reel['region']) ?></span><span><?= $h($reel['date']) ?></span><?php if ($reel['who']): ?><span><?= $h($reel['who']) ?></span><?php endif; ?><span><?= $count ?> find<?= $count === 1 ? '' : 's' ?></span></div><button class="go" id="startSound" type="button"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Watch with sound</button><button class="quiet" id="startMuted" type="button">Watch muted</button></div>
  <div class="progress" aria-hidden="true"><i id="bar"></i></div>
  <div class="brand" aria-hidden="true">BeachCombersMania</div>
  <a class="exit" id="exit" href="<?= $base ?>/app/"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg><span id="exitLabel">Back to app</span></a>
  <div class="layer on" id="layerA"></div><div class="layer" id="layerB"></div>
  <button class="tapzone l" id="tapL" aria-label="Previous slide"></button><button class="tapzone r" id="tapR" aria-label="Next slide"></button>
  <div class="chrome" id="chrome">
    <div class="group">
      <button class="ctl" id="prev" aria-label="Previous"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6V6z"/></svg></button>
      <button class="ctl" id="play" aria-label="Pause"><svg id="playIcon" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg></button>
      <button class="ctl" id="next" aria-label="Next"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6V6z"/></svg></button>
    </div>
    <div class="counter" id="counter">1 / 1</div>
    <div class="group"><button class="ctl" id="shareTop" aria-label="Copy link"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 1.4 1.4 1-1a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0zM14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1-1.4-1.4-1 1a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0z"/></svg></button></div>
  </div>
  <div class="toast" id="toast" role="status"></div><div class="sr" aria-live="polite" id="live"></div>
</div>
<script>
window.REEL=<?= json_encode(['token' => $token, 'title' => $title, 'region' => $reel['region'], 'beach' => $reel['beach'], 'date' => $reel['date'], 'who' => $reel['who'], 'finds' => $reel['finds'], 'url' => $pageUrl, 'base' => $base], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?>;
(function(){
  var R=window.REEL,HUB=R.base;
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
  function niceDate(d){try{var p=d.split('-');if(p.length===3){var dt=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]));return dt.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});}}catch(e){}return d;}
  var finds=R.finds||[];
  // Phase 3e: "from the app" = same-origin referrer, or running as an installed (standalone) app. Decides the exit target (below)
  // and, since Phase 3f, whether the etiquette slide plays at all.
  var fromApp=false;try{fromApp=(!!document.referrer&&new URL(document.referrer).origin===location.origin)||navigator.standalone===true||(!!window.matchMedia&&matchMedia('(display-mode: standalone)').matches);}catch(e){}
  var slides=[{type:"intro",dur:7300}];
  // Phase 3f: members opening from the app go intro → first find. Shared-link viewers still get the etiquette card, 6s (was 8s); pause to read longer.
  if(!fromApp)slides.push({type:"rules",dur:6000});
  finds.forEach(function(f,i){slides.push({type:"find",find:f,n:i+1,dur:6500});});
  slides.push({type:"finale",dur:0});
  var Rr={
    intro:function(){return '<div class="slide intro"><img class="poster" src="'+HUB+'/predictor/predictor-poster.jpg" alt=""><video id="introVid" src="'+HUB+'/predictor/BeachCombersMania.mp4" poster="'+HUB+'/predictor/predictor-poster.jpg" muted playsinline preload="auto"></video><div class="scrim"></div><div class="copy"><span class="eyebrow">Excursion Reel</span><h1>'+esc(R.title||R.beach||R.region)+'</h1><div class="meta"><span>'+esc(R.beach||R.region)+'</span><span>'+esc(niceDate(R.date))+'</span>'+(R.who?'<span>'+esc(R.who)+'</span>':'')+'<span>'+finds.length+' find'+(finds.length===1?'':'s')+'</span></div><button class="soundbtn" id="unmute" type="button">'+(sound?'🔇 Sound off':'🔊 Sound on')+'</button></div></div>';},
    rules:function(){return '<div class="slide"><div class="card"><span class="eyebrow">Shelling etiquette · how this haul was collected</span><h2>Take only what the tide left behind</h2><div class="rules"><div class="rule"><span class="eyebrow blue">01</span><b>Live shells go back</b><p>Check the aperture for the animal or an operculum. If it is home, it stays.</p></div><div class="rule"><span class="eyebrow blue">02</span><b>Leave live sand dollars</b><p>Brown or fuzzy means alive. Only white, bleached tests come home.</p></div><div class="rule"><span class="eyebrow blue">03</span><b>Fill your holes, skip the dunes</b><p>Turtles and shorebirds nest here. Walk the wet sand below the wrack line.</p></div></div></div></div>';},
    find:function(s){var f=s.find,sp=f.species||{};var main=f.photo||(sp.imagePath?HUB+'/app/'+sp.imagePath:HUB+'/assets/og-beach.jpg');
      return '<div class="slide find"><div class="photo"><img class="blur" src="'+esc(main)+'" alt="" aria-hidden="true"><img class="main" src="'+esc(main)+'" alt="'+esc(f.name)+'">'+(f.photo?'':'<div class="tag"><span class="chip">Reference photo</span></div>')+'</div>'+
      '<div class="info"><span class="eyebrow">Find '+s.n+' of '+finds.length+(sp.rarity?' &nbsp;·&nbsp; <span class="rar '+esc(sp.rarity.split(' ').pop())+'">'+esc(sp.rarity)+'</span>':'')+'</span>'+
      '<h2>'+esc(f.name||sp.name||'Unidentified find')+'</h2>'+(f.sci||sp.sci?'<p class="sci">'+esc(f.sci||sp.sci)+'</p>':'')+
      (sp.family?'<dl class="dl"><div><dt>Family</dt><dd>'+esc(sp.family)+'</dd></div><div><dt>Size</dt><dd>'+esc(sp.size||'')+'</dd></div><div><dt>Habitat</dt><dd>'+esc(sp.habitat||'')+'</dd></div><div><dt>Class</dt><dd>'+esc(sp.type||'')+'</dd></div></dl>':'')+
      (f.location||f.date_found?'<p class="note">'+esc([f.location,f.date_found].filter(Boolean).join(' · '))+'</p>':'')+
      (f.notes?'<p class="note">“'+esc(f.notes)+'”</p>':'')+
      (sp.fact?'<div class="know"><span class="eyebrow blue">Did you know</span><p>'+esc(sp.fact)+'</p></div>':'')+
      (f.photo&&sp.imagePath?'<div class="ref"><img src="'+HUB+'/app/'+esc(sp.imagePath)+'" alt=""><span>Reference: '+esc(sp.name)+' in the BCM species guide</span></div>':'')+
      '</div></div>';},
    finale:function(){var ids=finds.filter(function(f){return f.species;});var gas=ids.filter(function(f){return f.species.type==='Gastropod';}).length,biv=ids.filter(function(f){return f.species.type==='Bivalve';}).length,oth=ids.length-gas-biv,unc=ids.filter(function(f){return /Uncommon|Rare/.test(f.species.rarity||'');}).length;
      return '<div class="slide"><div class="card" style="gap:1.4rem"><span class="eyebrow">The excursion ends</span><h2>'+finds.length+' find'+(finds.length===1?'':'s')+' from '+esc(R.beach||R.region)+'</h2>'+
      '<div class="tally"><div class="stat"><b>'+gas+'</b><span>Gastropods</span></div><div class="stat"><b>'+biv+'</b><span>Bivalves</span></div><div class="stat"><b>'+oth+'</b><span>Other</span></div><div class="stat"><b>'+unc+'</b><span>Uncommon or rare</span></div></div>'+
      '<div><span class="eyebrow blue">Cleaning and care</span><ol class="note" style="display:grid;gap:.4rem;margin:.4rem 0 0"><li>Rinse in fresh water to clear salt and sand.</li><li>Soak in half bleach, half water for a few hours to whiten.</li><li>Rub with mineral oil to bring back the luster, then dry fully before storing.</li></ol></div>'+
      '<div class="actions">'+(fromApp?'<button class="btn primary" id="exitBtn" type="button">&#8592; Back to the app</button>':'<a class="btn primary" href="'+HUB+'/app/" data-cta="app">Identify your own finds, free</a>')+'<a class="btn sand" href="'+HUB+'/predictor/" data-cta="predictor">Get the 7-day shelling forecast</a><button class="btn" id="copyBtn">Copy link</button><a class="btn" id="fbBtn" href="https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(R.url)+'" target="_blank" rel="noopener" data-cta="facebook">Share on Facebook</a><button class="btn" id="replay">Watch again</button></div>'+
      '<p class="note">Made with the BeachCombersMania app · <a href="'+HUB+'/">beachcombersmania.online</a></p></div></div>';}
  };
  var A=document.getElementById('layerA'),B=document.getElementById('layerB'),bar=document.getElementById('bar'),counter=document.getElementById('counter'),live=document.getElementById('live'),chrome=document.getElementById('chrome'),playBtn=document.getElementById('play'),playIcon=document.getElementById('playIcon'),toast=document.getElementById('toast');
  var i=0,playing=false,started=false,sound=false,timer=null,front=A,back=B,hideT=null;
  var desc=finds.length+' find'+(finds.length===1?'':'s')+' from '+(R.beach||R.region)+' · identified with BeachCombersMania';
  // Native share sheet on phones (hands the link to the Facebook app with its preview card); false when unavailable so callers fall back.
  function nativeShare(cta){if(!navigator.share)return false;navigator.share({title:R.title,text:desc,url:R.url}).then(function(){track('reel_cta',{cta:cta});},function(){});return true;}
  function track(n,p){try{if(typeof window.bcmTrack==='function')window.bcmTrack(n,Object.assign({reel:R.token,region:R.region},p||{}));}catch(e){}}
  // Phase 3e: a way out on every screen (fromApp is computed above the slide list since Phase 3f).
  var exitHome=fromApp?HUB+'/app/':HUB+'/',exitA=document.getElementById('exit'),exitT=null;
  exitA.href=exitHome;document.getElementById('exitLabel').textContent=fromApp?'Back to app':'BeachCombersMania';
  function exitReel(e){if(e)e.preventDefault();track('reel_exit',{from_app:fromApp?1:0});clearTimeout(timer);var v=document.getElementById('introVid');if(v)v.pause();
    if(fromApp&&history.length>1&&document.referrer){history.back();exitT=setTimeout(function(){location.href=exitHome;},800);return;}
    location.href=exitHome;}
  window.addEventListener('pageshow',function(){clearTimeout(exitT);});
  exitA.addEventListener('click',exitReel);
  function preload(n){var s=slides[n];if(s&&s.type==='find'){var f=s.find;var src=f.photo||(f.species&&f.species.imagePath?HUB+'/app/'+f.species.imagePath:null);if(src){var im=new Image();im.src=src;}}}
  function show(n){n=Math.max(0,Math.min(n,slides.length-1));var s=slides[n];i=n;back.innerHTML=Rr[s.type](s);back.classList.add('on');front.classList.remove('on');var old=front;front=back;back=old;setTimeout(function(){if(back!==front)back.innerHTML='';},950);counter.textContent=(n+1)+' / '+slides.length;live.textContent='Slide '+(n+1)+' of '+slides.length+(s.type==='find'?': '+s.find.name:'');wire(s);preload(n+1);playBtn.hidden=s.dur===0;
    // The edge tap zones step the slides; on the finale they would sit over the buttons, so hide them there.
    document.getElementById('tapL').hidden=document.getElementById('tapR').hidden=(s.dur===0);
    runBar();schedule();if(s.dur===0){showChrome(true);track('reel_finished');}}
  function runBar(){var s=slides[i],from=(i/slides.length)*100,to=((i+1)/slides.length)*100;bar.classList.remove('run','paused');void bar.offsetWidth;bar.style.setProperty('--from',from+'%');bar.style.setProperty('--to',to+'%');if(s.dur===0){bar.style.width='100%';return;}bar.style.width='';bar.style.setProperty('--dur',(s.dur/1000)+'s');bar.classList.add('run');if(!playing)bar.classList.add('paused');}
  function schedule(){clearTimeout(timer);var s=slides[i];if(!playing||s.dur===0)return;timer=setTimeout(function(){show(i+1);},s.dur);}
  function setPlaying(p){playing=p;playBtn.setAttribute('aria-label',p?'Pause':'Play');playIcon.innerHTML=p?'<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>':'<path d="M8 5v14l11-7z"/>';var v=document.getElementById('introVid');if(v){p?v.play().catch(function(){}):v.pause();}if(p)runBar();else bar.classList.add('paused');schedule();showChrome(true);}
  function wire(s){if(s.type==='intro'){var v=document.getElementById('introVid'),u=document.getElementById('unmute');if(v){v.addEventListener('error',function(){v.remove();if(u)u.remove();});v.muted=!sound;if(started&&playing)v.play().catch(function(){});}
      if(u)u.addEventListener('click',function(){if(!v)return;sound=v.muted;v.muted=!sound;v.play().catch(function(){});u.textContent=sound?'🔇 Sound off':'🔊 Sound on';});}
    if(s.type==='finale'){document.getElementById('copyBtn').addEventListener('click',function(){copy(R.url);track('reel_cta',{cta:'copy'});});document.getElementById('replay').addEventListener('click',function(){show(0);});var xb=document.getElementById('exitBtn');if(xb)xb.addEventListener('click',exitReel);
      document.getElementById('fbBtn').addEventListener('click',function(e){if(nativeShare('facebook'))e.preventDefault();});
      [].forEach.call(document.querySelectorAll('[data-cta]'),function(a){a.addEventListener('click',function(){track('reel_cta',{cta:a.getAttribute('data-cta')});});});}}
  function copy(t){var done=function(){say('Link copied');},fail=function(){var r=document.createElement('textarea');r.value=t;document.body.appendChild(r);r.select();try{document.execCommand('copy');done();}catch(e){say('Copy the address bar link');}r.remove();};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,fail);}else fail();}
  function say(m){toast.textContent=m;toast.classList.add('show');clearTimeout(say.t);say.t=setTimeout(function(){toast.classList.remove('show');},1800);}
  function showChrome(force){chrome.classList.remove('hide');clearTimeout(hideT);if(playing&&slides[i].dur!==0)hideT=setTimeout(function(){chrome.classList.add('hide');},3200);}
  document.getElementById('prev').addEventListener('click',function(){show(i-1);});document.getElementById('next').addEventListener('click',function(){show(i+1);});
  document.getElementById('tapL').addEventListener('click',function(){show(i-1);});document.getElementById('tapR').addEventListener('click',function(){show(i+1);});
  playBtn.addEventListener('click',function(){setPlaying(!playing);});document.getElementById('shareTop').addEventListener('click',function(){if(!nativeShare('share')){copy(R.url);track('reel_cta',{cta:'copy'});}});
  window.addEventListener('keydown',function(e){if(!started){if(e.key==='Enter'||e.key===' '){e.preventDefault();start(true);}else if(e.key==='Escape')exitReel();return;}if(e.key==='ArrowRight')show(i+1);else if(e.key==='ArrowLeft')show(i-1);else if(e.key===' '){e.preventDefault();setPlaying(!playing);}else if(e.key==='Home')show(0);else if(e.key==='End')show(slides.length-1);else if(e.key==='Escape')exitReel();});
  var sx=null;window.addEventListener('pointerdown',function(e){sx=(e.target.closest&&e.target.closest('a,button,input'))?null:e.clientX;});window.addEventListener('pointerup',function(e){if(sx==null)return;var dx=e.clientX-sx;sx=null;if(Math.abs(dx)>60&&slides[i].dur!==0)show(i+(dx<0?1:-1));});
  window.addEventListener('pointermove',function(){showChrome();});window.addEventListener('touchstart',function(){showChrome();},{passive:true});
  document.addEventListener('visibilitychange',function(){if(document.hidden){clearTimeout(timer);bar.classList.add('paused');}else if(playing){runBar();schedule();}});
  front.innerHTML=Rr.intro(slides[0]);wire(slides[0]);preload(2);counter.textContent='1 / '+slides.length;bar.classList.add('paused');
  var cover=document.getElementById('cover');
  function start(withSound){if(started)return;started=true;sound=!!withSound;cover.classList.add('gone');var v=document.getElementById('introVid'),u=document.getElementById('unmute');if(v){v.muted=!sound;try{v.currentTime=0;}catch(e){}}if(u)u.textContent=sound?'🔇 Sound off':'🔊 Sound on';setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches);track('reel_started',{sound:sound?1:0});}
  document.getElementById('startSound').addEventListener('click',function(){start(true);});document.getElementById('startMuted').addEventListener('click',function(){start(false);});
  track('reel_viewed',{finds:finds.length});
})();
</script>
<?php endif; ?>
</body>
</html>
