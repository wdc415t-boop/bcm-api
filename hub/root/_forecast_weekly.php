<?php
/**
 * BCM weekly forecast digest (Phase 2a, 2026-10-29)
 * Deploy to: beachcombersmania.online/public_html/_forecast_weekly.php
 * Run from cron (command line only; a web request gets a 404):
 *     /usr/bin/php /home/u605954531/domains/beachcombersmania.online/public_html/_forecast_weekly.php
 *
 * For each of the six beaches: asks the Render API for this week's forecast (internal call, no lead created),
 * saves a share snapshot through _forecast.php (one link per beach per day), then emails Bill one digest with
 * each beach's Prime Score, best window, the share link and a ready-to-paste Facebook caption.
 *
 * Needs in _bcm_config.php:   define('BCM_EVAL_KEY', '<same value as on Render>');
 * Optional:                   define('BCM_WEEKLY_TO', 'you@example.com');   // default wdc415t@gmail.com
 *                             define('BCM_WEEKLY_FROM', 'support@beachcombersmania.online');
 * Delivery: with BCM_SMTP_PASS defined the digest is sent through the support@ mailbox over authenticated
 * SMTP (smtp.hostinger.com:465), which the domain's SPF and DKIM cover; without it PHP mail() is used, which
 * Gmail is likely to drop because the web server is not in the SPF record.
 *                             define('BCM_SMTP_PASS', '<password of the support@ mailbox>');
 *                             define('BCM_SMTP_USER', 'support@beachcombersmania.online');   // default = BCM_WEEKLY_FROM
 *                             define('BCM_SMTP_HOST', 'smtp.hostinger.com');  define('BCM_SMTP_PORT', 465);
 *                             define('BCM_WEEKLY_BEACHES', 'Marco Island,Naples Beach');  // default: all six
 *                             define('BCM_PREDICTOR_API', 'https://bcm-api-sm35.onrender.com');
 * Phase 6c (2026-11-03): a beach whose forecast call fails (non-200, bad JSON, timeout) is retried after a pause
 * before it is reported as "not available" — the Nov 2 run lost Naples Beach to one transient 502.
 *                             define('BCM_WEEKLY_RETRIES', 2);       // extra tries per beach, default 2
 *                             define('BCM_WEEKLY_RETRY_WAIT', 25);   // seconds between tries, default 25
 */

if (PHP_SAPI !== 'cli') { http_response_code(404); header('Content-Type: text/plain'); echo "Not found\n"; exit; }

$configPaths = [dirname(__DIR__) . '/_bcm_config.php', dirname(dirname(__DIR__)) . '/_bcm_config.php', __DIR__ . '/_bcm_config.php'];
foreach ($configPaths as $path) { if (file_exists($path)) { require_once $path; break; } }

$API    = defined('BCM_PREDICTOR_API') ? BCM_PREDICTOR_API : 'https://bcm-api-sm35.onrender.com';
$HUB    = defined('BCM_HUB') ? BCM_HUB : 'https://beachcombersmania.online';
$TO     = defined('BCM_WEEKLY_TO') ? BCM_WEEKLY_TO : 'wdc415t@gmail.com';
$FROM   = defined('BCM_WEEKLY_FROM') ? BCM_WEEKLY_FROM : 'support@beachcombersmania.online';
$KEY    = defined('BCM_EVAL_KEY') ? BCM_EVAL_KEY : '';
$ALL    = ['Marco Island', 'Naples Beach', 'Bonita Springs', 'Fort Myers Beach', 'Sanibel Island', 'Captiva Island'];
$BEACHES = defined('BCM_WEEKLY_BEACHES') ? array_values(array_filter(array_map('trim', explode(',', BCM_WEEKLY_BEACHES)), fn($b) => in_array($b, $ALL, true))) : $ALL;
$FC_DIR = defined('BCM_FORECAST_DIR') ? BCM_FORECAST_DIR : dirname(__DIR__) . '/bcm-forecasts';
$DRY    = in_array('--dry-run', $argv ?? [], true);   // build the digest, print it, do not email
$RETRIES = defined('BCM_WEEKLY_RETRIES') ? max(0, (int)BCM_WEEKLY_RETRIES) : 2;        // Phase 6c
$RETRY_WAIT = defined('BCM_WEEKLY_RETRY_WAIT') ? max(0, (int)BCM_WEEKLY_RETRY_WAIT) : 25;

date_default_timezone_set('America/New_York');
$log = function ($m) { fwrite(STDERR, '[' . date('Y-m-d H:i:s') . "] $m\n"); };
if ($KEY === '') { $log('BCM_EVAL_KEY is not defined in _bcm_config.php; cannot make internal forecast calls.'); exit(2); }

function http_json($url, $body, $headers = [], $timeout = 90) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout,
        CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json'], $headers)]);
    $out = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
    if ($out === false) return [0, null, $err];
    return [$code, json_decode($out, true), null];
}
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');

/** Minimal SMTP client: implicit TLS, AUTH LOGIN, one message. Returns true or an error string. */
function smtp_send($host, $port, $user, $pass, $from, $to, $data, $timeout = 30) {
    $fp = @stream_socket_client("ssl://$host:$port", $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true]]));
    if (!$fp) return "connect failed: $errstr ($errno)";
    stream_set_timeout($fp, $timeout);
    $read = function () use ($fp) { $out = ''; while (($line = fgets($fp, 2048)) !== false) { $out .= $line; if (strlen($line) < 4 || $line[3] !== '-') break; } return $out; };
    $cmd = function ($c, $ok) use ($fp, $read) { fwrite($fp, $c . "\r\n"); $r = $read(); if (strpos($r, (string)$ok) !== 0) throw new RuntimeException(trim(substr($c, 0, 20)) . ' → ' . trim($r)); return $r; };
    try {
        $banner = $read(); if (strpos($banner, '220') !== 0) throw new RuntimeException('banner: ' . trim($banner));
        $cmd('EHLO beachcombersmania.online', 250);
        $cmd('AUTH LOGIN', 334); $cmd(base64_encode($user), 334); $cmd(base64_encode($pass), 235);
        $cmd("MAIL FROM:<$from>", 250);
        foreach ((array)$to as $rcpt) $cmd("RCPT TO:<$rcpt>", 250);
        $cmd('DATA', 354);
        fwrite($fp, preg_replace('/^\./m', '..', $data) . "\r\n.\r\n"); $r = $read(); if (strpos($r, '250') !== 0) throw new RuntimeException('DATA → ' . trim($r));
        fwrite($fp, "QUIT\r\n"); fclose($fp);
        return true;
    } catch (RuntimeException $e) { @fclose($fp); return $e->getMessage(); }
}

$rows = []; $failures = [];
foreach ($BEACHES as $beach) {
    // Phase 6c: up to 1 + $RETRIES forecast calls per beach; Render caches a good forecast per beach per day, so a retry
    // after a transient failure is a fresh model call, and a retry after success would be free (never happens).
    $ok = false; $why = '';
    for ($try = 1; $try <= 1 + $RETRIES; $try++) {
        [$code, $fc, $err] = http_json($API . '/api/predictor/forecast', ['beach' => $beach], ['X-BCM-Eval: ' . $KEY]);
        $ok = ($code === 200 && is_array($fc) && isset($fc['primeScore']));
        if ($ok) break;
        $why = "forecast HTTP $code " . ($err ?: json_encode($fc));
        $log("$beach: try $try/" . (1 + $RETRIES) . " failed — $why" . ($try <= $RETRIES ? "; retrying in {$RETRY_WAIT}s" : ''));
        if ($try <= $RETRIES) sleep($RETRY_WAIT);
    }
    if (!$ok) { $failures[] = "$beach: $why (after " . (1 + $RETRIES) . " tries)"; sleep(3); continue; }
    $fc['beach'] = $beach;
    [$c2, $snap, $e2] = http_json($HUB . '/_forecast.php', $fc, [], 30);
    if ($c2 !== 200 || empty($snap['ok'])) { $failures[] = "$beach: snapshot HTTP $c2 " . ($e2 ?: json_encode($snap)); $log(end($failures)); continue; }
    $top = $fc['topWindows'][0] ?? [];
    $rows[] = ['beach' => $beach, 'score' => (int)$fc['primeScore'], 'summary' => $fc['scoreSummary'] ?? '', 'top' => $top, 'wins' => array_slice($fc['topWindows'] ?? [], 0, 3),
        'url' => $snap['url'], 'card' => $HUB . '/_forecast.php?r=' . $snap['token'] . '&card=1', 'rare' => $fc['rareShellAlert'] ?? [], 'cached' => !empty($fc['cached']), 'existing' => !empty($snap['existing'])];
    $log("$beach: score {$fc['primeScore']} → {$snap['url']}" . ($snap['existing'] ? ' (existing)' : ''));
    sleep(2); // stay under the route's rate limit
}
usort($rows, fn($a, $b) => $b['score'] <=> $a['score']);

$weekOf = date('l, F j, Y');
$subject = 'BCM shelling forecasts · week of ' . date('M j') . ($rows ? ' · best: ' . $rows[0]['beach'] . ' ' . $rows[0]['score'] . '/100' : ' · FAILED');

$html = '<!DOCTYPE html><html><body style="margin:0;background:#f3f6f9;font-family:Georgia,serif;color:#0f172a"><div style="max-width:680px;margin:0 auto;padding:24px">'
    . '<div style="background:linear-gradient(135deg,#0c4a6e,#0284c7);color:#fff;border-radius:14px;padding:22px 24px"><div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.85">BeachCombersMania · weekly digest</div>'
    . '<h1 style="margin:6px 0 0;font-size:24px">Shelling forecasts for the week of ' . $h($weekOf) . '</h1><p style="margin:8px 0 0;opacity:.9">Six beaches, ranked by Prime Score. Each has a share link and a caption you can paste straight into a Facebook post.</p></div>';
foreach ($rows as $r) {
    $t = $r['top'];
    $best = trim(($t['day'] ?? '') . ' ' . ($t['date'] ?? '') . ' · ' . ($t['timeWindow'] ?? ''));
    $caption = "🐚 " . $r['beach'] . " 7-day shelling forecast — Prime Score " . $r['score'] . "/100.\nBest window: " . $best . (!empty($t['tideCondition']) ? " (" . $t['tideCondition'] . ")" : '') . ".\n"
        . (!empty($r['rare']['species']) ? "Rare shell watch: " . implode(', ', array_slice($r['rare']['species'], 0, 3)) . " (" . (int)($r['rare']['probability'] ?? 0) . "% chance).\n" : '')
        . "Full forecast, real NOAA tides: " . $r['url'];
    $html .= '<div style="background:#fff;border:1px solid #dbe4ec;border-radius:14px;padding:18px 20px;margin-top:16px">'
        . '<div style="display:flex;align-items:center;gap:14px"><div style="width:64px;height:64px;border-radius:50%;background:#0c4a6e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;flex:none;text-align:center;line-height:64px">' . $r['score'] . '</div>'
        . '<div><h2 style="margin:0;font-size:20px">' . $h($r['beach']) . '</h2><div style="color:#475569;font-size:14px">Best window: ' . $h($best) . '</div></div></div>'
        . '<p style="margin:12px 0 0;color:#334155;font-size:15px">' . $h($r['summary']) . '</p>'
        . '<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:14px">';
    foreach ($r['wins'] as $w) $html .= '<tr><td style="padding:5px 0;border-top:1px solid #eef2f6"><b>' . $h($w['day'] ?? '') . '</b> ' . $h($w['date'] ?? '') . '</td><td style="padding:5px 0;border-top:1px solid #eef2f6">' . $h($w['timeWindow'] ?? '') . '</td><td style="padding:5px 0;border-top:1px solid #eef2f6;text-align:right">' . (int)($w['score'] ?? 0) . '/100</td></tr>';
    $html .= '</table>'
        . '<p style="margin:12px 0 0"><a href="' . $h($r['url']) . '" style="display:inline-block;background:#f59e0b;color:#1a1208;font-weight:700;text-decoration:none;padding:10px 16px;border-radius:10px">Open the share page</a> &nbsp; <a href="' . $h($r['card']) . '" style="color:#0284c7">Preview the Facebook card</a></p>'
        . '<div style="margin-top:12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;padding:12px;font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">' . $h($caption) . '</div></div>';
}
if ($failures) $html .= '<div style="background:#fff3f3;border:1px solid #fecaca;border-radius:14px;padding:16px 20px;margin-top:16px"><b>Not available this run:</b><ul>' . implode('', array_map(fn($f) => '<li>' . $h($f) . '</li>', $failures)) . '</ul></div>';
$html .= '<p style="color:#64748b;font-size:12px;margin-top:22px">Sent by _forecast_weekly.php on the hub. Forecasts are cached per beach per day on Render; opening a share link costs nothing further.</p></div></body></html>';

// keep a copy
@mkdir($FC_DIR . '/weekly', 0750, true);
@file_put_contents($FC_DIR . '/weekly/' . date('Y-m-d') . '.html', $html);

if ($DRY) { echo $html; $log('dry run: digest built for ' . count($rows) . ' beaches, ' . count($failures) . ' failures; not emailed'); exit($rows ? 0 : 1); }

$boundary = 'bcm' . bin2hex(random_bytes(8));
$text = "BCM shelling forecasts, week of $weekOf\n\n" . implode("\n\n", array_map(fn($r) => $r['beach'] . ' — ' . $r['score'] . '/100 — ' . $r['url'], $rows)) . ($failures ? "\n\nNot available: " . implode('; ', $failures) : '') . "\n";
$encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
$headers = "From: BeachCombersMania <$FROM>\r\nReply-To: $FROM\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"$boundary\"\r\n";
$body = "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n$text\r\n--$boundary\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n$html\r\n--$boundary--\r\n";
if (defined('BCM_SMTP_PASS') && BCM_SMTP_PASS !== '') {
    $smtpUser = defined('BCM_SMTP_USER') ? BCM_SMTP_USER : $FROM;
    // $headers already carries From and Reply-To; add only what SMTP needs on top (Gmail rejects a second From header).
    $data = "To: <$TO>\r\nSubject: $encSubject\r\nDate: " . date('r') . "\r\nMessage-ID: <" . bin2hex(random_bytes(10)) . "@beachcombersmania.online>\r\n" . $headers . "\r\n" . $body;
    $res = smtp_send(defined('BCM_SMTP_HOST') ? BCM_SMTP_HOST : 'smtp.hostinger.com', defined('BCM_SMTP_PORT') ? (int)BCM_SMTP_PORT : 465, $smtpUser, BCM_SMTP_PASS, $FROM, $TO, $data);
    $sent = ($res === true); $via = 'SMTP ' . ($sent ? 'ok' : $res);
} else {
    $sent = mail($TO, $encSubject, $body, $headers, '-f' . $FROM); $via = 'mail() (set BCM_SMTP_PASS for reliable delivery)';
}
$log(($sent ? 'emailed ' : 'MAIL FAILED to ') . $TO . ' via ' . $via . ' — ' . count($rows) . ' beaches, ' . count($failures) . ' failures');
@file_put_contents($FC_DIR . '/weekly/log.txt', '[' . date('c') . '] ' . ($sent ? 'sent' : 'FAILED') . ' ' . count($rows) . ' beaches ' . count($failures) . " failures\n", FILE_APPEND);
exit($sent && $rows ? 0 : 1);
