<?php
/**
 * BCM Forecast share page (Phase 2a, 2026-10-29)
 * Deploy to: beachcombersmania.online/public_html/forecast/index.php  → https://beachcombersmania.online/forecast/?r=TOKEN
 * Phase 6b (2026-11-03): /forecast/?latest=SLUG shows the newest snapshot for a beach (marco-island, naples-beach,
 * bonita-springs, fort-myers-beach, sanibel-island, captiva-island) — a permanent "this week's forecast" link.
 * Renders a saved Predictor forecast (written by _forecast.php, stored outside public_html) with Open Graph
 * tags for the Facebook card, Share / Copy / Print buttons, and a print stylesheet so "Save as PDF" is clean.
 */
$configPaths = [dirname(dirname(__DIR__)) . '/_bcm_config.php', dirname(dirname(dirname(__DIR__))) . '/_bcm_config.php', dirname(__DIR__) . '/_bcm_config.php'];
foreach ($configPaths as $path) { if (file_exists($path)) { require_once $path; break; } }
$fcDir = defined('BCM_FORECAST_DIR') ? BCM_FORECAST_DIR : dirname(dirname(__DIR__)) . '/bcm-forecasts';
$base = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'beachcombersmania.online');
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');

$token = $_GET['r'] ?? '';
$rec = null; $err = '';
$latest = (string)($_GET['latest'] ?? '');
if ($token === '' && $latest !== '') {   // Phase 6b: newest snapshot for a beach slug
    if (preg_match('/^[a-z0-9-]{3,40}$/', $latest)) {
        $files = glob($fcDir . '/by-day/' . $latest . '-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].txt');
        if ($files) { rsort($files, SORT_STRING); foreach ($files as $df) { $t = trim((string)@file_get_contents($df)); if (preg_match('/^[A-Za-z0-9]{10,16}$/', $t) && is_file($fcDir . '/' . $t . '.json')) { $token = $t; break; } } }
    }
    if ($token === '') $err = 'No forecast has been published for this beach yet. Forecasts post every Monday.';
}
if ($err !== '') { /* already explained */ }
elseif (!preg_match('/^[A-Za-z0-9]{10,16}$/', $token)) $err = 'This link is missing its forecast id.';
elseif (!is_file($fcDir . '/' . $token . '.json')) $err = 'This forecast is no longer available.';
else { $rec = json_decode(file_get_contents($fcDir . '/' . $token . '.json'), true); if (!$rec || empty($rec['forecast'])) $err = 'This forecast could not be read.'; }

$f = $rec ? $rec['forecast'] : null;
$beach = $f ? $f['beach'] : 'Southwest Florida';
$week = $rec ? date('F j, Y', strtotime($rec['day'])) : '';
$top = $f && !empty($f['topWindows']) ? $f['topWindows'][0] : null;
$title = $f ? ($beach . ' shelling forecast · Prime Score ' . (int)$f['primeScore'] . '/100') : 'BeachCombersMania shelling forecast';
$desc = $f ? ('Week of ' . $week . '. ' . ($top ? 'Best window: ' . trim(($top['day'] ?? '') . ' ' . ($top['timeWindow'] ?? '')) . ($top['tideCondition'] ? ' (' . $top['tideCondition'] . ')' : '') . '. ' : '') . '7-day forecast built on real NOAA tides by BeachCombersMania.') : 'Perfect Shelling Day forecasts for Southwest Florida beaches.';
$pageUrl = $base . '/forecast/?r=' . $h($token);
$ogImage = $rec ? $base . '/_forecast.php?r=' . $h($token) . '&card=1' : $base . '/assets/og-beach.jpg';
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= $h($title) ?> · BeachCombersMania</title>
<meta name="description" content="<?= $h($desc) ?>">
<meta property="og:type" content="article">
<meta property="og:title" content="<?= $h($title) ?>">
<meta property="og:description" content="<?= $h($desc) ?>">
<meta property="og:url" content="<?= $pageUrl ?>">
<meta property="og:image" content="<?= $h($ogImage) ?>">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="BeachCombersMania">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
<?php $ab = dirname(__DIR__) . '/reel/analytics-block.html'; if (is_file($ab)) readfile($ab); ?>
<style>
  :root{--ink:#0c4a6e;--ocean:#0284c7;--sky:#0ea5e9;--sky-light:#7dd3fc;--sand:#fde68a;--amber:#f59e0b;--kelp:#059669;--night:#0a1628;
    --grad-ocean:linear-gradient(135deg,#0c4a6e,#0284c7);--grad-deep:linear-gradient(160deg,#0a1628,#0f2740);--sh-md:0 4px 14px rgba(2,32,71,.12);--sh-lg:0 14px 40px rgba(2,16,40,.45);
    --r:16px;--serif:"Playfair Display",serif;--serif2:"Crimson Text",serif;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:var(--serif2);background:var(--night);color:#e8f0f7;line-height:1.55;overflow-x:hidden}
  h1,h2,h3,.brand{font-family:var(--serif)}a{color:var(--sky-light)}
  .wrap{max-width:880px;margin:0 auto;padding:0 18px}
  header{display:flex;align-items:center;gap:12px;padding:14px 18px;background:rgba(10,22,40,.85);backdrop-filter:blur(10px);position:sticky;top:0;z-index:30;border-bottom:1px solid rgba(255,255,255,.08)}
  .logo{width:42px;height:42px;border-radius:12px;background:var(--grad-ocean);display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:var(--sh-md)}
  .brand h1{font-size:18px;font-weight:900;letter-spacing:-.3px}.brand p{font-size:12px;color:var(--sky-light);font-style:italic}
  .nav-trial{margin-left:auto;background:linear-gradient(135deg,var(--amber),#d97706);color:#1a1208;font-family:var(--serif);font-weight:800;font-size:13px;padding:9px 16px;border-radius:999px;text-decoration:none;white-space:nowrap;box-shadow:0 4px 14px rgba(245,158,11,.35)}
  .masthead{padding:34px 0 10px;background:radial-gradient(120% 80% at 50% 0%,rgba(14,165,233,.14),transparent 58%),var(--grad-deep)}
  .pill{display:inline-flex;align-items:center;gap:7px;background:rgba(14,165,233,.18);border:1px solid rgba(125,211,252,.4);color:var(--sky-light);padding:6px 14px;border-radius:999px;font-size:13px;font-weight:600;margin-bottom:12px}
  .masthead h2{font-size:clamp(28px,5.5vw,46px);font-weight:900;line-height:1.08;color:#fff}.masthead p{color:#d6e6f2;margin-top:8px}
  .sharebar{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 6px}
  .sbtn{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#fff;font-family:var(--serif);font-weight:800;font-size:14px;padding:11px 16px;border-radius:12px;cursor:pointer;text-decoration:none;min-height:44px}
  .sbtn.primary{background:linear-gradient(135deg,var(--amber),#d97706);color:#1a1208;border-color:transparent;box-shadow:0 8px 24px rgba(245,158,11,.35)}
  .card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:var(--r);box-shadow:var(--sh-md);backdrop-filter:blur(8px);padding:22px}
  .section-title{font-size:22px;font-weight:800;color:var(--sand);margin:30px 0 14px;display:flex;align-items:center;gap:8px}
  .score-hero{display:flex;align-items:center;gap:20px;flex-wrap:wrap;justify-content:center;text-align:center}
  .score-ring{width:132px;height:132px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:conic-gradient(var(--kelp) calc(var(--p)*1%),rgba(255,255,255,.08) 0);box-shadow:var(--sh-md);flex:none}
  .score-ring .inner{width:108px;height:108px;border-radius:50%;background:var(--night);display:flex;flex-direction:column;align-items:center;justify-content:center}
  .score-ring .v{font-family:var(--serif);font-size:38px;font-weight:900;color:#fff;line-height:1}.score-ring .lab{font-size:11px;color:var(--sky-light);text-transform:uppercase;letter-spacing:1px}
  .grid{display:grid;gap:14px}.grid.win{grid-template-columns:1fr}@media(min-width:640px){.grid.win{grid-template-columns:repeat(3,1fr)}}
  .win-card{background:rgba(255,255,255,.05);border:1px solid rgba(125,211,252,.25);border-radius:14px;padding:16px}
  .win-card .day{font-family:var(--serif);font-size:17px;font-weight:800;color:#fff}.win-card .time{color:var(--sand);font-weight:600;font-size:15px;margin:2px 0 8px}
  .badge{display:inline-block;background:rgba(5,150,105,.25);border:1px solid rgba(5,150,105,.5);color:#6ee7b7;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px}
  .chip{display:inline-block;background:rgba(14,165,233,.16);color:var(--sky-light);font-size:12px;padding:3px 9px;border-radius:8px;margin:3px 4px 0 0}
  table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:9px 8px;text-align:left;border-bottom:1px solid rgba(255,255,255,.08)}
  th{color:var(--sky-light);font-family:var(--serif);font-size:12px;text-transform:uppercase;letter-spacing:.5px}
  .rare{background:linear-gradient(160deg,rgba(245,158,11,.18),rgba(217,119,6,.08));border:1px solid rgba(245,158,11,.4)}
  ul.rec{list-style:none;margin:6px 0 0}ul.rec li{padding:4px 0 4px 22px;position:relative}ul.rec li:before{content:"🐚";position:absolute;left:0}
  .cta{margin:34px 0;text-align:center;background:var(--grad-ocean);border-radius:var(--r);padding:28px 20px;box-shadow:var(--sh-lg)}
  .cta h3{font-size:24px;color:#fff;font-weight:900}.cta p{color:#bae6fd;margin:8px 0 18px}
  .cta a{display:inline-block;background:#fff;color:var(--ink);font-family:var(--serif);font-weight:800;font-size:17px;padding:13px 28px;border-radius:12px;text-decoration:none;box-shadow:var(--sh-md);margin:4px}
  .meta{color:#9fb6c8;font-size:13px;margin-top:10px}
  footer{border-top:1px solid rgba(255,255,255,.08);padding:24px 18px;text-align:center;font-size:13px;color:#8aa3b6;margin-top:30px}footer a{color:var(--sky-light);text-decoration:none}
  .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#fff;color:#0a1628;padding:.5rem .9rem;border-radius:8px;font-weight:700;opacity:0;transition:opacity .3s;z-index:50}.toast.show{opacity:1}
  .empty{min-height:60vh;display:grid;place-items:center;text-align:center;padding:2rem}
  /* Print: white paper, dark ink, no chrome */
  @media print{
    @page{margin:14mm}
    body{background:#fff;color:#111}header,.sharebar,.cta,footer,.toast,.nav-trial{display:none!important}
    .masthead{background:none;padding:0 0 6px}.masthead h2,.win-card .day,.score-ring .v{color:#111}.masthead p,.meta,.win-card .time,td,th{color:#222}
    .pill{border-color:#999;color:#333;background:none}
    .card,.win-card,.rare{background:#fff;border:1px solid #bbb;box-shadow:none;backdrop-filter:none;break-inside:avoid}
    .section-title{color:#111;margin-top:18px}.chip{background:#eee;color:#111}.badge{background:#eee;color:#111;border-color:#999}
    .score-ring{background:conic-gradient(#059669 calc(var(--p)*1%),#ddd 0)}.score-ring .inner{background:#fff}.score-ring .lab{color:#333}
    th,td{border-bottom:1px solid #ccc}a{color:#111;text-decoration:none}.wrap{max-width:none;padding:0}
    .printonly{display:block!important}
  }
  .printonly{display:none;font-size:12px;color:#444;margin-top:14px}
</style>
</head>
<body>
<header>
  <div class="logo">🐚</div>
  <div class="brand"><h1>Perfect Shelling Day</h1><p>by BeachCombersMania.online</p></div>
  <a class="nav-trial" href="<?= $base ?>/predictor/" data-cta="predictor">Get your own forecast →</a>
</header>
<?php if ($err): ?>
<div class="empty"><div><span class="pill">BeachCombersMania</span><h2 style="margin:.5rem 0 1rem"><?= $h($err) ?></h2><p>Get this week's forecast for your beach at <a href="<?= $base ?>/predictor/">beachcombersmania.online/predictor</a></p></div></div>
<?php else: ?>
<section class="masthead"><div class="wrap">
  <span class="pill">✨ 7-Day Shelling Forecast · Week of <?= $h($week) ?></span>
  <h2><?= $h($beach) ?></h2>
  <p>Built on real NOAA tide predictions<?= $f['station'] ? ' from ' . $h($f['station']) : '' ?><?= $f['moon'] ? ', ' . $h($f['moon']['name']) . ' (' . (int)$f['moon']['illum'] . '% lit)' : '' ?>, scored by BeachCombersMania.</p>
  <div class="sharebar">
    <button class="sbtn primary" id="shareBtn" type="button">📣 Share this forecast</button>
    <button class="sbtn" id="copyBtn" type="button">🔗 Copy link</button>
    <button class="sbtn" id="printBtn" type="button">🖨️ Print / Save as PDF</button>
    <a class="sbtn" id="fbBtn" href="https://www.facebook.com/sharer/sharer.php?u=<?= urlencode($pageUrl) ?>" target="_blank" rel="noopener" data-cta="facebook">Share on Facebook</a>
  </div>
</div></section>
<main class="wrap" id="report"></main>
<div class="wrap"><div class="cta">
  <h3>Want this for your beach, every week? 🐚</h3>
  <p>Pick your beach and get your own 7-day forecast in about a minute. Then identify what you find with the free BeachCombersMania app.</p>
  <a href="<?= $base ?>/predictor/" data-cta="predictor">Get my forecast →</a>
  <a href="<?= $base ?>/app/" data-cta="app">Open the app</a>
</div></div>
<footer><div class="wrap"><p>© <?= date('Y') ?> BeachCombersMania · Cook AI Ventures LLC · Warren, Ohio 44483</p><p style="margin-top:6px"><a href="<?= $base ?>/">BeachCombersMania.online</a> · <a href="<?= $base ?>/legal/privacy-policy.html">Privacy</a> · Forecast generated <?= $h($f['generatedAt'] ? date('M j, Y g:i A', strtotime($f['generatedAt'])) . ' ET' : $h($week)) ?></p></div></footer>
<div class="toast" id="toast" role="status"></div>
<script>
window.FC=<?= json_encode(['token' => $token, 'url' => $pageUrl, 'title' => $title, 'desc' => $desc, 'beach' => $beach, 'week' => $week, 'f' => $f], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?>;
(function(){
  var F=window.FC,d=F.f,beach=F.beach;
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
  function track(n,p){try{if(typeof window.bcmTrack==='function')window.bcmTrack(n,Object.assign({forecast:F.token,beach:beach},p||{}));}catch(e){}}
  var win=(d.topWindows||[]).map(function(w){return '<div class="win-card"><div class="day">'+esc(w.day)+' <span style="color:#9fb6c8;font-size:13px;">'+esc(w.date)+'</span></div><div class="time">⏰ '+esc(w.timeWindow)+'</div><span class="badge">Score '+esc(w.score)+'/100</span><p style="margin:8px 0 6px;color:#cfe0ed;font-size:14px;">🌊 '+esc(w.tideCondition)+'</p><div>'+(w.targetShells||[]).map(function(s){return '<span class="chip">'+esc(s)+'</span>';}).join('')+'</div><p style="margin-top:8px;color:#aac1d3;font-size:13px;">'+esc(w.reasoning)+'</p></div>';}).join('');
  var daily=(d.dailyForecast||[]).map(function(x){return '<tr><td>'+esc(x.date)+'</td><td>'+esc(x.bestTime)+'</td><td>'+esc(x.tideAdvantage)+'</td><td>'+esc(x.weatherScore)+'</td><td>'+esc(x.varietyLevel)+'</td><td>'+esc(x.recommendedSpot)+'</td></tr>';}).join('');
  var rec=d.recommendations||{},rare=d.rareShellAlert||{};
  document.getElementById('report').innerHTML=
    '<div class="card" style="margin-top:18px"><div class="section-title" style="margin-top:0">📊 Prime Shelling Score — '+esc(beach)+'</div><div class="score-hero"><div class="score-ring" style="--p:'+(d.primeScore||0)+'"><div class="inner"><span class="v">'+esc(d.primeScore)+'</span><span class="lab">/ 100</span></div></div><p style="flex:1;min-width:240px;color:#d6e6f2;">'+esc(d.scoreSummary)+'</p></div></div>'+
    '<div class="section-title">🏆 Top 3 Shelling Windows</div><div class="grid win">'+win+'</div>'+
    '<div class="card" style="margin-top:18px;"><div class="section-title" style="margin-top:0;">📅 7-Day Breakdown</div><div style="overflow-x:auto;"><table><tr><th>Day</th><th>Best Time</th><th>Tide</th><th>Weather</th><th>Variety</th><th>Hotspot</th></tr>'+daily+'</table></div></div>'+
    '<div class="card" style="margin-top:18px;"><div class="section-title" style="margin-top:0;">🎯 Recommendations</div><p style="color:#d6e6f2;"><strong>Best spot:</strong> '+esc(rec.spotName)+' <span style="color:#9fb6c8;">('+esc(rec.bestGPSSpot)+')</span></p><p style="color:#d6e6f2;margin-top:6px;"><strong>Likely shells:</strong> '+esc((rec.likelyShells||[]).join(', '))+'</p><ul class="rec">'+(rec.proTips||[]).map(function(t){return '<li>'+esc(t)+'</li>';}).join('')+'</ul><p style="color:#cfe0ed;margin-top:8px;"><strong>Bring:</strong> '+esc((rec.whatToBring||[]).join(', '))+' &nbsp;·&nbsp; <strong>Avoid:</strong> '+esc((rec.avoidTimes||[]).join(', '))+'</p></div>'+
    '<div class="card rare" style="margin-top:18px;"><div class="section-title" style="margin-top:0;">💎 Rare Shell Alert — '+esc(rare.probability||0)+'% chance</div><div>'+(rare.species||[]).map(function(s){return '<span class="chip">'+esc(s)+'</span>';}).join('')+'</div><p style="color:#e9d8a6;margin-top:8px;">'+esc(rare.conditions)+'</p></div>'+
    '<p class="printonly">Shared from '+esc(F.url)+' · Get your own weekly forecast at beachcombersmania.online/predictor</p>';
  var toast=document.getElementById('toast');function say(m){toast.textContent=m;toast.classList.add('show');clearTimeout(say.t);say.t=setTimeout(function(){toast.classList.remove('show');},1800);}
  function copy(){var done=function(){say('Link copied');track('forecast_cta',{cta:'copy'});};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(F.url).then(done,function(){say('Copy the address bar link');});else say('Copy the address bar link');}
  function share(cta){if(navigator.share){navigator.share({title:F.title,text:F.desc,url:F.url}).then(function(){track('forecast_cta',{cta:cta});},function(){});return true;}return false;}
  document.getElementById('shareBtn').addEventListener('click',function(){if(!share('share'))copy();});
  document.getElementById('copyBtn').addEventListener('click',copy);
  document.getElementById('printBtn').addEventListener('click',function(){track('forecast_cta',{cta:'print'});window.print();});
  document.getElementById('fbBtn').addEventListener('click',function(e){if(share('facebook'))e.preventDefault();else track('forecast_cta',{cta:'facebook'});});
  [].forEach.call(document.querySelectorAll('[data-cta]'),function(a){if(a.id!=='fbBtn')a.addEventListener('click',function(){track('forecast_cta',{cta:a.getAttribute('data-cta')});});});
  track('forecast_viewed',{score:d.primeScore});
})();
</script>
<?php endif; ?>
</body>
</html>
