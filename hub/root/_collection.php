<?php
/**
 * BCM Cloud Collection API (Phase 4, 2026-11-01)
 * Deploy to: beachcombersmania.online/public_html/_collection.php
 *
 * A signed-in, paid account's shell collection, so it follows the login to any device (Nancy: phone → iPad).
 * Modeled on _reel.php: the BCM JWT (HS256, shared BCM_JWT_SECRET) identifies the owner; records are JSON files
 * and photos are JPEGs in a folder OUTSIDE public_html. No database.
 *
 *   All calls need  Authorization: Bearer <BCM JWT>  whose payload.scope is 'single' or 'all' (paid). Others → 403.
 *
 *   GET  /_collection.php?list=1[&region=marco]   → {ok, shells:[{cid, region, updated, has_photo, data:{…}}], count, limit}
 *   GET  /_collection.php?cid=X&img=1             → the shell's JPEG (owner only)
 *   POST {action:'put',    shell:{cid, region, updated, data:{…}}, photo_b64?}  → upsert   → {ok, cid, updated, has_photo}
 *   POST {action:'patch',  cid, updated, data:{user_notes?, tags?}}             → last-write-wins on `updated` → {ok, applied}
 *   POST {action:'delete', cid}                                                 → {ok, deleted}
 *
 *   Record `data` is the app's IndexedDB shell record minus image_data and the local autoincrement id.
 *   Limits: COLL_MAX_SHELLS per account, COLL_MAX_PHOTO_BYTES per photo (JPEG, ≤ COLL_MAX_PHOTO_PX), COLL_MAX_DATA_BYTES per record.
 *
 * Storage: <folder above public_html>/bcm-collections/<ownerkey>/index.json  (cid → record)  and  /<ownerkey>/<cid>.jpg
 * Config (optional, _bcm_config.php): define('BCM_COLLECTION_DIR', '/path/outside/public_html/bcm-collections');
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$configPaths = [dirname(__DIR__) . '/_bcm_config.php', dirname(dirname(__DIR__)) . '/_bcm_config.php', __DIR__ . '/_bcm_config.php'];
foreach ($configPaths as $path) { if (file_exists($path)) { require_once $path; break; } }

define('COLL_DIR', defined('BCM_COLLECTION_DIR') ? BCM_COLLECTION_DIR : dirname(__DIR__) . '/bcm-collections');
define('COLL_MAX_SHELLS', 500);
define('COLL_MAX_PHOTO_BYTES', 600 * 1024);
define('COLL_MAX_PHOTO_PX', 1600);
define('COLL_MAX_DATA_BYTES', 24 * 1024);
define('COLL_MAX_BODY', 2 * 1024 * 1024);
define('COLL_PAID_SCOPES', ['single', 'all']);

function coll_json($code, $data) { http_response_code($code); header('Content-Type: application/json'); header('Cache-Control: no-store'); echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit; }
function coll_cid_ok($c) { return is_string($c) && preg_match('/^[A-Za-z0-9]{12,24}$/', $c); }
function coll_region_ok($r) { return is_string($r) && preg_match('/^[a-z]{3,16}$/', $r); }
function coll_clean($s, $max) { return mb_substr(trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', (string)$s)), 0, $max); }

// ── JWT: same check as _reel.php, plus the paid-scope gate ──
function coll_jwt_payload() {
    if (!defined('BCM_JWT_SECRET')) return null;
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (!preg_match('/^Bearer\s+(.+)$/i', $h, $m)) return null;
    $parts = explode('.', trim($m[1])); if (count($parts) !== 3) return null;
    [$hdr, $pl, $sig] = $parts;
    $b64u = function ($d) { return rtrim(strtr(base64_encode($d), '+/', '-_'), '='); };
    if (!hash_equals($b64u(hash_hmac('sha256', "$hdr.$pl", BCM_JWT_SECRET, true)), $sig)) return null;
    $data = json_decode(base64_decode(strtr($pl, '-_', '+/') . str_repeat('=', 3 - (3 + strlen($pl)) % 4)), true);
    if (!$data || empty($data['exp']) || $data['exp'] < time() || empty($data['sub'])) return null;
    return $data;
}
$jwt = coll_jwt_payload();
if (!$jwt) coll_json(401, ['error' => 'Sign in to use your cloud collection', 'code' => 'auth']);
if (!in_array((string)($jwt['scope'] ?? 'none'), COLL_PAID_SCOPES, true)) coll_json(403, ['error' => 'Cloud-synced collections are part of the paid plans', 'code' => 'plan']);
$owner = (string)$jwt['sub'];

// ── Storage ──
function coll_owner_key($sub) { return preg_replace('/[^A-Za-z0-9_-]/', '_', (string)$sub); }
function coll_owner_dir($sub) { return COLL_DIR . '/' . coll_owner_key($sub); }
function coll_index_file($sub) { return coll_owner_dir($sub) . '/index.json'; }
function coll_photo_file($sub, $cid) { return coll_owner_dir($sub) . '/' . $cid . '.jpg'; }
function coll_read_index($sub) {
    $f = coll_index_file($sub); if (!is_file($f)) return [];
    $idx = json_decode(@file_get_contents($f), true);
    return is_array($idx) ? $idx : [];
}
function coll_write_index($sub, array $idx) {
    $dir = coll_owner_dir($sub);
    if (!is_dir($dir) && !@mkdir($dir, 0750, true)) return false;
    $tmp = coll_index_file($sub) . '.tmp.' . getmypid();
    if (@file_put_contents($tmp, json_encode($idx, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) === false) return false;
    return @rename($tmp, coll_index_file($sub));
}
function coll_ts_ok($t) { return is_string($t) && preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/', $t); }
function coll_now() { return gmdate('Y-m-d\TH:i:s\Z'); }

// ── GET ──
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $idx = coll_read_index($owner);
    if (isset($_GET['list'])) {
        $region = $_GET['region'] ?? '';
        $out = [];
        foreach ($idx as $cid => $rec) {
            if ($region !== '' && ($rec['region'] ?? '') !== $region) continue;
            $out[] = ['cid' => $cid, 'region' => $rec['region'] ?? '', 'updated' => $rec['updated'] ?? '', 'created' => $rec['created'] ?? '', 'has_photo' => !empty($rec['has_photo']), 'data' => $rec['data'] ?? []];
        }
        coll_json(200, ['ok' => true, 'shells' => $out, 'count' => count($idx), 'limit' => COLL_MAX_SHELLS, 'server_time' => coll_now()]);
    }
    $cid = $_GET['cid'] ?? '';
    if (!coll_cid_ok($cid) || !isset($idx[$cid])) coll_json(404, ['error' => 'Shell not found']);
    if (isset($_GET['img'])) {
        $file = coll_photo_file($owner, $cid);
        if (!is_file($file)) { http_response_code(404); exit; }
        header('Content-Type: image/jpeg');
        header('Cache-Control: private, max-age=86400');
        header('Content-Length: ' . filesize($file));
        readfile($file); exit;
    }
    coll_json(200, ['ok' => true, 'shell' => ['cid' => $cid] + $idx[$cid]]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') coll_json(405, ['error' => 'POST or GET only']);

// ── POST ──
$raw = file_get_contents('php://input');
if (strlen($raw) > COLL_MAX_BODY) coll_json(413, ['error' => 'Request too large']);
$in = json_decode($raw, true);
if (!is_array($in) || !isset($in['action'])) coll_json(400, ['error' => 'Bad request']);
$action = $in['action'];
$idx = coll_read_index($owner);

if ($action === 'delete') {
    $cid = $in['cid'] ?? '';
    if (!coll_cid_ok($cid)) coll_json(400, ['error' => 'Bad shell id']);
    $existed = isset($idx[$cid]);
    unset($idx[$cid]);
    @unlink(coll_photo_file($owner, $cid));
    if ($existed && !coll_write_index($owner, $idx)) coll_json(500, ['error' => 'Could not save']);
    coll_json(200, ['ok' => true, 'deleted' => $cid, 'existed' => $existed]);
}

if ($action === 'patch') {
    $cid = $in['cid'] ?? '';
    if (!coll_cid_ok($cid)) coll_json(400, ['error' => 'Bad shell id']);
    if (!isset($idx[$cid])) coll_json(404, ['error' => 'Shell not found', 'code' => 'missing']);
    $updated = coll_ts_ok($in['updated'] ?? '') ? $in['updated'] : coll_now();
    $applied = false;
    if (strcmp($updated, (string)($idx[$cid]['updated'] ?? '')) >= 0) {
        $d = is_array($in['data'] ?? null) ? $in['data'] : [];
        if (array_key_exists('user_notes', $d)) $idx[$cid]['data']['user_notes'] = coll_clean($d['user_notes'], 2000);
        if (array_key_exists('tags', $d)) { $tags = is_array($d['tags']) ? array_values(array_filter(array_map(fn($t) => coll_clean($t, 40), $d['tags']), fn($t) => $t !== '')) : []; $idx[$cid]['data']['tags'] = array_slice($tags, 0, 30); }
        $idx[$cid]['updated'] = $updated;
        $applied = true;
        if (!coll_write_index($owner, $idx)) coll_json(500, ['error' => 'Could not save']);
    }
    coll_json(200, ['ok' => true, 'cid' => $cid, 'applied' => $applied, 'updated' => $idx[$cid]['updated']]);
}

if ($action === 'put') {
    $shell = $in['shell'] ?? null;
    if (!is_array($shell)) coll_json(400, ['error' => 'No shell']);
    $cid = $shell['cid'] ?? '';
    if (!coll_cid_ok($cid)) coll_json(400, ['error' => 'Bad shell id']);
    $region = $shell['region'] ?? '';
    if (!coll_region_ok($region)) coll_json(400, ['error' => 'Bad region']);
    $data = $shell['data'] ?? null;
    if (!is_array($data) || empty($data['name'])) coll_json(400, ['error' => 'Shell record needs a name']);
    unset($data['image_data'], $data['id']);                       // never store the photo inline or the local id
    $enc = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($enc === false || strlen($enc) > COLL_MAX_DATA_BYTES) coll_json(400, ['error' => 'Shell record too large']);
    $isNew = !isset($idx[$cid]);
    if ($isNew && count($idx) >= COLL_MAX_SHELLS) coll_json(400, ['error' => 'Your cloud collection holds up to ' . COLL_MAX_SHELLS . ' shells. Delete some to make room.', 'code' => 'full']);
    $updated = coll_ts_ok($shell['updated'] ?? '') ? $shell['updated'] : coll_now();
    $prev = $idx[$cid] ?? null;
    if ($prev && strcmp($updated, (string)($prev['updated'] ?? '')) < 0) {
        // an older copy of a record we already have: keep ours, but accept a photo if we lack one
        $updated = $prev['updated']; $data = $prev['data'];
    }
    $has_photo = $prev ? !empty($prev['has_photo']) : false;
    $photo = (string)($in['photo_b64'] ?? '');
    $photo = preg_replace('#^data:image/jpe?g;base64,#i', '', $photo);
    if ($photo !== '') {
        $bin = base64_decode($photo, true);
        if ($bin === false || strlen($bin) > COLL_MAX_PHOTO_BYTES) coll_json(400, ['error' => 'Photo too large (max ' . (COLL_MAX_PHOTO_BYTES >> 10) . ' KB JPEG)', 'code' => 'photo']);
        $info = @getimagesizefromstring($bin);
        if (!$info || $info[2] !== IMAGETYPE_JPEG || $info[0] > COLL_MAX_PHOTO_PX || $info[1] > COLL_MAX_PHOTO_PX) coll_json(400, ['error' => 'Photo must be a JPEG up to ' . COLL_MAX_PHOTO_PX . ' px', 'code' => 'photo']);
        $dir = coll_owner_dir($owner);
        if (!is_dir($dir) && !@mkdir($dir, 0750, true)) coll_json(500, ['error' => 'Cannot create collection storage']);
        if (@file_put_contents(coll_photo_file($owner, $cid), $bin, LOCK_EX) === false) coll_json(500, ['error' => 'Could not save photo']);
        $has_photo = true;
    }
    $idx[$cid] = [
        'region'    => $region,
        'created'   => $prev['created'] ?? (coll_ts_ok($data['saved_at'] ?? '') ? $data['saved_at'] : coll_now()),
        'updated'   => $updated,
        'has_photo' => $has_photo,
        'data'      => $data,
    ];
    if (!coll_write_index($owner, $idx)) coll_json(500, ['error' => 'Could not save']);
    coll_json(200, ['ok' => true, 'cid' => $cid, 'updated' => $updated, 'has_photo' => $has_photo, 'count' => count($idx), 'limit' => COLL_MAX_SHELLS, 'new' => $isNew]);
}

coll_json(400, ['error' => 'Unknown action']);
