<?php
/**
 * BCM Forecast snapshots (Phase 2a, 2026-10-29)
 * Deploy to: beachcombersmania.online/public_html/_forecast.php
 *
 *   POST /_forecast.php                 JSON: the forecast object the Predictor received from Render
 *                                       (primeScore, scoreSummary, topWindows, dailyForecast, recommendations,
 *                                       rareShellAlert, beach, generatedAt) → {ok, token, url, existing}
 *                                       One snapshot per beach per day: posting the same day's forecast again
 *                                       returns the existing link, so a beach has one share link per day.
 *   GET  /_forecast.php?r=TOKEN&json=1  the stored record (used by forecast/index.php on the same host)
 *   GET  /_forecast.php?latest=SLUG     Phase 6b (2026-11-03): the newest stored record for a beach slug
 *                                       (marco-island, naples-beach, bonita-springs, fort-myers-beach, sanibel-island,
 *                                       captiva-island) plus its share url — what the app's Beach Conditions card reads.
 *                                       404 when that beach has never been snapshotted.
 *   GET  /_forecast.php?r=TOKEN&card=1  1200×630 PNG share card (Facebook / Open Graph image); falls back
 *                                       to /assets/og-beach.jpg when PHP has no GD or the font is missing.
 *
 * Storage (outside public_html): <folder above public_html>/bcm-forecasts/<token>.json and by-day/<beach>-<date>.txt
 * Config (optional, _bcm_config.php): define('BCM_FORECAST_DIR', '/path/outside/public_html/bcm-forecasts');
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$configPaths = [dirname(__DIR__) . '/_bcm_config.php', dirname(dirname(__DIR__)) . '/_bcm_config.php', __DIR__ . '/_bcm_config.php'];
foreach ($configPaths as $path) { if (file_exists($path)) { require_once $path; break; } }

define('FC_DIR', defined('BCM_FORECAST_DIR') ? BCM_FORECAST_DIR : dirname(__DIR__) . '/bcm-forecasts');
define('FC_MAX_BODY', 256 * 1024);
define('FC_FONT', __DIR__ . '/forecast/fonts/NunitoSans-Bold.ttf');
define('FC_FONT_SERIF', __DIR__ . '/forecast/fonts/Fraunces-SemiBold.ttf');

$FC_BEACHES = ['Sanibel Island', 'Captiva Island', 'Marco Island', 'Naples Beach', 'Bonita Springs', 'Fort Myers Beach'];
$base = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'beachcombersmania.online');

function fc_json($code, $data) { http_response_code($code); header('Content-Type: application/json'); echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit; }
function fc_token_ok($t) { return is_string($t) && preg_match('/^[A-Za-z0-9]{10,16}$/', $t); }
function fc_str($s, $max) { return mb_substr(trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', (string)(is_scalar($s) ? $s : ''))), 0, $max); }
function fc_int($v, $lo, $hi) { $n = (int)(is_numeric($v) ? $v : 0); return max($lo, min($hi, $n)); }
function fc_list($a, $n, $max) { if (!is_array($a)) return []; $out = []; foreach (array_slice(array_values($a), 0, $n) as $x) { $s = fc_str($x, $max); if ($s !== '') $out[] = $s; } return $out; }
function fc_slug($s) { return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($s)), '-'); }
function fc_day($iso) {
    // Calendar day of the forecast in Florida time; falls back to today.
    try { $d = $iso ? new DateTime($iso) : new DateTime(); } catch (Exception $e) { $d = new DateTime(); }
    $d->setTimezone(new DateTimeZone('America/New_York'));
    return $d->format('Y-m-d');
}

/** Keep only the fields the viewer renders, with lengths capped. Returns null if the shape is not a forecast. */
function fc_sanitize(array $in, array $beaches) {
    $beach = fc_str($in['beach'] ?? '', 40);
    if (!in_array($beach, $beaches, true)) return null;
    if (!isset($in['primeScore']) || !isset($in['topWindows']) || !is_array($in['topWindows'])) return null;
    $wins = [];
    foreach (array_slice(array_values($in['topWindows']), 0, 5) as $w) {
        if (!is_array($w)) continue;
        $wins[] = ['day' => fc_str($w['day'] ?? '', 20), 'date' => fc_str($w['date'] ?? '', 24), 'timeWindow' => fc_str($w['timeWindow'] ?? '', 40),
            'score' => fc_int($w['score'] ?? 0, 0, 100), 'tideCondition' => fc_str($w['tideCondition'] ?? '', 160), 'shellVariety' => fc_str($w['shellVariety'] ?? '', 12),
            'rareProbability' => fc_int($w['rareProbability'] ?? 0, 0, 100), 'targetShells' => fc_list($w['targetShells'] ?? [], 6, 40), 'reasoning' => fc_str($w['reasoning'] ?? '', 300)];
    }
    $days = [];
    foreach (array_slice(array_values(is_array($in['dailyForecast'] ?? null) ? $in['dailyForecast'] : []), 0, 8) as $d) {
        if (!is_array($d)) continue;
        $days[] = ['date' => fc_str($d['date'] ?? '', 24), 'bestTime' => fc_str($d['bestTime'] ?? '', 40), 'tideAdvantage' => fc_int($d['tideAdvantage'] ?? 0, 0, 100),
            'weatherScore' => fc_int($d['weatherScore'] ?? 0, 0, 100), 'varietyLevel' => fc_str($d['varietyLevel'] ?? '', 12), 'recommendedSpot' => fc_str($d['recommendedSpot'] ?? '', 60)];
    }
    $rec = is_array($in['recommendations'] ?? null) ? $in['recommendations'] : [];
    $rare = is_array($in['rareShellAlert'] ?? null) ? $in['rareShellAlert'] : [];
    $moon = is_array($in['moon'] ?? null) ? $in['moon'] : [];
    return [
        'beach' => $beach,
        'primeScore' => fc_int($in['primeScore'], 0, 100),
        'scoreSummary' => fc_str($in['scoreSummary'] ?? '', 600),
        'topWindows' => $wins,
        'dailyForecast' => $days,
        'recommendations' => ['bestGPSSpot' => fc_str($rec['bestGPSSpot'] ?? '', 40), 'spotName' => fc_str($rec['spotName'] ?? '', 60), 'likelyShells' => fc_list($rec['likelyShells'] ?? [], 8, 40),
            'proTips' => fc_list($rec['proTips'] ?? [], 6, 240), 'avoidTimes' => fc_list($rec['avoidTimes'] ?? [], 4, 120), 'whatToBring' => fc_list($rec['whatToBring'] ?? [], 8, 80)],
        'rareShellAlert' => ['probability' => fc_int($rare['probability'] ?? 0, 0, 100), 'species' => fc_list($rare['species'] ?? [], 6, 40), 'conditions' => fc_str($rare['conditions'] ?? '', 300)],
        'moon' => $moon ? ['name' => fc_str($moon['name'] ?? '', 20), 'illum' => fc_int($moon['illum'] ?? 0, 0, 100)] : null,
        'station' => fc_str($in['station'] ?? '', 60),
        'generatedAt' => fc_str($in['generatedAt'] ?? '', 40),
    ];
}

function fc_record($token) { $f = FC_DIR . '/' . $token . '.json'; return is_file($f) ? json_decode(file_get_contents($f), true) : null; }
/** Newest snapshot token for a beach slug (by-day/<slug>-YYYY-MM-DD.txt, newest date first), or null. */
function fc_latest_token($slug) {
    $files = glob(FC_DIR . '/by-day/' . $slug . '-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].txt');
    if (!$files) return null;
    rsort($files, SORT_STRING);
    foreach ($files as $f) { $t = trim((string)@file_get_contents($f)); if (fc_token_ok($t) && fc_record($t)) return $t; }
    return null;
}

// ── Share card (PNG) ──
function fc_card($rec) {
    if (!function_exists('imagecreatetruecolor') || !function_exists('imagettftext') || !is_file(FC_FONT)) return false;
    ob_start();   // swallow any notice GD might print so the response is pure PNG
    $f = $rec['forecast']; $W = 1200; $H = 630;
    $im = imagecreatetruecolor($W, $H);
    // background: deep night with a soft ocean glow
    $bg = imagecolorallocate($im, 10, 22, 40); imagefilledrectangle($im, 0, 0, $W, $H, $bg);
    for ($i = 0; $i < 60; $i++) { $c = imagecolorallocatealpha($im, 14, 165, 233, (int)(118 - $i * 0.15)); imagefilledellipse($im, 980, 90, 900 - $i * 12, 520 - $i * 7, $c); }
    $band = imagecolorallocatealpha($im, 255, 255, 255, 116); imagefilledrectangle($im, 0, $H - 86, $W, $H, $band);
    $white = imagecolorallocate($im, 255, 255, 255); $sand = imagecolorallocate($im, 253, 230, 138); $sky = imagecolorallocate($im, 125, 211, 252);
    $dim = imagecolorallocate($im, 169, 196, 214); $kelp = imagecolorallocate($im, 16, 185, 129); $ring = imagecolorallocate($im, 30, 50, 75);
    $serif = is_file(FC_FONT_SERIF) ? FC_FONT_SERIF : FC_FONT;
    imagettftext($im, 22, 0, 64, 92, $sky, FC_FONT, 'PERFECT SHELLING DAY  ·  7-DAY FORECAST');
    // beach name, shrink to fit
    $size = 72; do { $bb = imagettfbbox($size, 0, $serif, $f['beach']); $w = $bb[2] - $bb[0]; if ($w <= 760) break; $size -= 4; } while ($size > 36);
    imagettftext($im, $size, 0, 60, 200, $white, $serif, $f['beach']);
    $week = 'Week of ' . date('F j, Y', strtotime($rec['day']));
    imagettftext($im, 26, 0, 64, 252, $sand, FC_FONT, $week);
    // best window
    $top = $f['topWindows'][0] ?? null;
    if ($top) {
        imagettftext($im, 20, 0, 64, 330, $dim, FC_FONT, 'BEST WINDOW');
        $date = $top['date'] ?? '';
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $date = date('M j', strtotime($date));   // Render sends ISO dates
        $line = trim(($top['day'] ?? '') . ($date ? ' ' . $date : '') . '  ·  ' . ($top['timeWindow'] ?? ''));
        $size = 34; do { $bb = imagettfbbox($size, 0, FC_FONT, $line); if ($bb[2] - $bb[0] <= 780) break; $size -= 2; } while ($size > 20);
        imagettftext($im, $size, 0, 64, 378, $white, FC_FONT, $line);
        $tide = $top['tideCondition'] ?? '';
        $tsize = 22; do { $bb = imagettfbbox($tsize, 0, FC_FONT, $tide); if ($bb[2] - $bb[0] <= 780) break; $tsize -= 2; } while ($tsize > 14);
        if ($tide) imagettftext($im, $tsize, 0, 64, 420, $sky, FC_FONT, $tide);
    }
    // shells
    $shells = array_slice($f['recommendations']['likelyShells'] ?? [], 0, 4);
    if ($shells) imagettftext($im, 20, 0, 64, 480, $dim, FC_FONT, 'Likely finds: ' . implode(', ', $shells));
    // score ring
    $cx = 1000; $cy = 330; $r = 118; $p = (int)$f['primeScore'];
    imagefilledellipse($im, $cx, $cy, $r * 2, $r * 2, $ring);
    if ($p > 0) imagefilledarc($im, $cx, $cy, $r * 2, $r * 2, -90, -90 + (int)round($p * 3.6), $kelp, IMG_ARC_PIE);
    imagefilledellipse($im, $cx, $cy, ($r - 26) * 2, ($r - 26) * 2, $bg);
    $bb = imagettfbbox(64, 0, FC_FONT, (string)$p); imagettftext($im, 64, 0, (int)($cx - ($bb[2] - $bb[0]) / 2), $cy + 18, $white, FC_FONT, (string)$p);
    $bb = imagettfbbox(16, 0, FC_FONT, 'PRIME SCORE / 100'); imagettftext($im, 16, 0, (int)($cx - ($bb[2] - $bb[0]) / 2), $cy + 52, $sky, FC_FONT, 'PRIME SCORE / 100');
    // footer
    imagettftext($im, 22, 0, 64, $H - 34, $white, FC_FONT, 'beachcombersmania.online/predictor');
    $bb = imagettfbbox(20, 0, FC_FONT, 'Real NOAA tides · AI shelling intelligence'); imagettftext($im, 20, 0, (int)($W - 64 - ($bb[2] - $bb[0])), $H - 34, $dim, FC_FONT, 'Real NOAA tides · AI shelling intelligence');
    ob_clean(); imagepng($im, null, 7); $png = ob_get_clean();
    return (is_string($png) && strncmp($png, "\x89PNG", 4) === 0) ? $png : false;
}

// ── GET ──
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['latest'])) {   // Phase 6b: newest forecast for a beach, for the app
        $slug = (string)$_GET['latest'];
        if (!preg_match('/^[a-z0-9-]{3,40}$/', $slug)) fc_json(400, ['error' => 'Bad beach']);
        $t = fc_latest_token($slug);
        $rec = $t ? fc_record($t) : null;
        if (!$rec) fc_json(404, ['error' => 'No forecast has been published for this beach yet.', 'beach' => $slug]);
        $rec['url'] = $base . '/forecast/?r=' . $t;
        header('Cache-Control: public, max-age=300');
        fc_json(200, $rec);
    }
    $token = $_GET['r'] ?? '';
    if (!fc_token_ok($token)) fc_json(400, ['error' => 'Bad forecast id']);
    $rec = fc_record($token);
    if (!$rec) fc_json(404, ['error' => 'This forecast is no longer available']);
    if (isset($_GET['card'])) {
        $cacheFile = FC_DIR . '/' . $token . '.card-v2.png';
        $png = is_file($cacheFile) ? file_get_contents($cacheFile) : fc_card($rec);
        if ($png === false) { header('Location: ' . $base . '/assets/og-beach.jpg', true, 302); exit; }
        if (!is_file($cacheFile)) @file_put_contents($cacheFile, $png);
        header('Content-Type: image/png'); header('Cache-Control: public, max-age=86400'); header('Content-Length: ' . strlen($png));
        echo $png; exit;
    }
    header('Cache-Control: public, max-age=300');
    fc_json(200, $rec);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fc_json(405, ['error' => 'POST or GET only']);

// ── POST: snapshot a forecast ──
$raw = file_get_contents('php://input');
if (strlen($raw) > FC_MAX_BODY) fc_json(413, ['error' => 'Forecast too large']);
$in = json_decode($raw, true);
if (!is_array($in)) fc_json(400, ['error' => 'Expected a JSON forecast']);
if (isset($in['forecast']) && is_array($in['forecast'])) { $in = $in['forecast'] + ['beach' => $in['beach'] ?? ($in['forecast']['beach'] ?? '')]; }
$fc = fc_sanitize($in, $FC_BEACHES);
if (!$fc) fc_json(400, ['error' => 'Not a forecast we recognise']);

if (!is_dir(FC_DIR) && !@mkdir(FC_DIR, 0750, true)) fc_json(500, ['error' => 'Cannot create forecast storage']);
@mkdir(FC_DIR . '/by-day', 0750, true);
$day = fc_day($fc['generatedAt']);
$dayFile = FC_DIR . '/by-day/' . fc_slug($fc['beach']) . '-' . $day . '.txt';
if (is_file($dayFile)) {
    $existing = trim((string)file_get_contents($dayFile));
    if (fc_token_ok($existing) && fc_record($existing)) fc_json(200, ['ok' => true, 'token' => $existing, 'url' => $base . '/forecast/?r=' . $existing, 'existing' => true, 'day' => $day]);
}
$alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
$token = ''; for ($i = 0; $i < 12; $i++) $token .= $alphabet[random_int(0, strlen($alphabet) - 1)];
$record = ['token' => $token, 'v' => 1, 'created' => gmdate('c'), 'day' => $day, 'beach' => $fc['beach'], 'forecast' => $fc];
if (@file_put_contents(FC_DIR . '/' . $token . '.json', json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) === false) fc_json(500, ['error' => 'Could not save forecast']);
@file_put_contents($dayFile, $token . "\n", LOCK_EX);
fc_json(200, ['ok' => true, 'token' => $token, 'url' => $base . '/forecast/?r=' . $token, 'existing' => false, 'day' => $day]);
