/**
 * routes/predictor.js — Perfect Shelling Day Predictor (reverse lead magnet)
 * ─────────────────────────────────────────────────────────────────────────
 * Drop this file into your bcm-api `routes/` folder, then add TWO lines to server.js
 * (see predictor-backend/INSTALL.md):
 *
 *     const predictorRoutes = require('./routes/predictor');
 *     app.use('/api/predictor', predictorRoutes);
 *
 * Endpoint:  POST /api/predictor/forecast   body { beach, email }
 *   1. Captures the lead in GoHighLevel (REST API, upsert + tag) — never blocks the forecast.
 *   2. Pulls REAL NOAA tide predictions for the beach + computes moon phase.
 *   3. Has Claude (Sonnet 4 — same key/pattern as /api/identify) write the narrative
 *      around the real tide numbers (it is told NOT to invent tides).
 *   4. Caches the forecast per beach+date (one Claude call per beach per day).
 *
 * Requirements: Node >= 18 (global fetch). No new npm dependencies.
 * Env vars (add in Render dashboard):  GHL_API_KEY, GHL_LOCATION_ID,
 *   optional GHL_PREDICTOR_WORKFLOW_ID.  ANTHROPIC_API_KEY already exists.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// ── Reuse the same Anthropic setup as server.js ──────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

// ── GoHighLevel (lead capture via REST API — same API the ./ghl CLI wraps) ──
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const GHL_WORKFLOW_ID = process.env.GHL_PREDICTOR_WORKFLOW_ID || '';
const GHL_BASE = 'https://services.leadconnectorhq.com';

// ── Beaches → verified NOAA tide stations + shelling context ─────
const BEACHES = {
  'Sanibel Island':   { station:'8725362', stationName:'Tarpon Bay, Sanibel Island', lat:26.4454, lng:-82.1243,
    knownFor:['Junonia',"Lion's Paw",'Scotch Bonnet','Alphabet Cone'], hotspots:['Lighthouse Beach','Blind Pass Beach',"Bowman's Beach"] },
  'Captiva Island':   { station:'8725383', stationName:'Captiva Island (outside)', lat:26.5275, lng:-82.1943,
    knownFor:['Sand Dollar','Fighting Conch','Lightning Whelk','Olive Shell'], hotspots:['Turner Beach','Captiva Beach','Alison Hagerup Beach'] },
  'Marco Island':     { station:'8724967', stationName:'Marco Island, Caxambas Pass', lat:25.9412, lng:-81.7188,
    knownFor:['Tiger Lucine','Lightning Whelk','Tulip Shell','Moon Snail'], hotspots:['Tigertail Beach','South Marco Beach','Cape Romano'] },
  'Naples Beach':     { station:'8725110', stationName:'Naples (outer coast)', lat:26.1420, lng:-81.7948,
    knownFor:['Cockle','Turkey Wing','Coquina','Calico Scallop'], hotspots:['Naples Pier','Delnor-Wiggins Pass','Vanderbilt Beach'] },
  'Bonita Springs':   { station:'8725235', stationName:'Wiggins Pass', lat:26.3398, lng:-81.8773,
    knownFor:['Banded Tulip','Horse Conch','Apple Murex','Periwinkle'], hotspots:['Bonita Beach Park','Little Hickory Beach','Lovers Key'] },
  'Fort Myers Beach': { station:'8725351', stationName:'Estero Island, Estero Bay', lat:26.4513, lng:-81.9465,
    knownFor:['Lettered Olive','Cerith','Auger','Nutmeg'], hotspots:['Bowditch Point','Lynn Hall Park','Bunche Beach'] },
};

// One Claude call per beach per day. key = `${beach}|${YYYYMMDD}` -> forecast (no email)
const cache = new Map();

// Tighter limiter on top of the global /api/ limiter (protects the AI spend)
const predictorLimiter = rateLimit({
  windowMs: 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many forecast requests — please wait a minute.' }
});

// ── Helpers ──────────────────────────────────────────────────────
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const extractJson = (s) => { const a=s.indexOf('{'), b=s.lastIndexOf('}'); return (a>=0&&b>a) ? s.slice(a,b+1) : s; };

function moonPhase(date){
  const synodic = 29.530588853;
  const ref = Date.UTC(2000,0,6,18,14);           // a known new moon
  let age = ((date.getTime() - ref) / 86400000) % synodic;
  if (age < 0) age += synodic;
  const illum = Math.round((1 - Math.cos(2*Math.PI*age/synodic)) / 2 * 100);
  const names = ['New Moon','Waxing Crescent','First Quarter','Waxing Gibbous','Full Moon','Waning Gibbous','Last Quarter','Waning Crescent'];
  const idx = Math.floor((age/synodic)*8 + 0.5) % 8;
  // New & Full = spring tides = lower lows = better shelling
  const springTide = (illum >= 92 || illum <= 8);
  return { name: names[idx], illum, springTide };
}

async function getTides(station){
  const begin = new Date();
  const end = new Date(); end.setDate(end.getDate() + 6);
  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`
    + `?product=predictions&datum=MLLW&interval=hilo&units=english&time_zone=lst_ldt&format=json`
    + `&station=${station}&begin_date=${ymd(begin)}&end_date=${ymd(end)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('NOAA ' + r.status);
  const j = await r.json();
  return (j.predictions || []).map(p => ({ t: p.t, type: p.type, ht: parseFloat(p.v) }));
}

async function callAnthropic(system, userText, maxTokens = 2400){
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role:'user', content: userText }] }),
    signal: AbortSignal.timeout(60000)
  });
  if (!r.ok){ const t = await r.text().catch(()=> ''); throw new Error('Anthropic ' + r.status + ' ' + t.slice(0,150)); }
  const d = await r.json();
  return (d.content && d.content[0] && d.content[0].text) || '';
}

async function saveLead(email, beach, phone){
  if (!GHL_API_KEY || !GHL_LOCATION_ID){ console.warn('[predictor] GHL not configured — lead not saved'); return; }
  const tag = 'predictor_' + beach.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  const tags = [tag, 'predictor_lead'];
  // phone is only present when the visitor opted in to SMS (consent checked on the form)
  if (phone) tags.push('predictor_sms_optin');
  const body = { locationId: GHL_LOCATION_ID, email, tags, source: 'Shelling Predictor - ' + beach };
  if (phone) body.phone = phone;
  const r = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: 'POST',
    headers: { 'Authorization':'Bearer '+GHL_API_KEY, 'Version':'2021-07-28', 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok){ const t = await r.text().catch(()=> ''); throw new Error('GHL ' + r.status + ' ' + t.slice(0,150)); }
  const data = await r.json().catch(()=> ({}));
  const id = data.contact && data.contact.id;
  if (GHL_WORKFLOW_ID && id){
    fetch(`${GHL_BASE}/contacts/${id}/workflow/${GHL_WORKFLOW_ID}`, {
      method: 'POST', headers: { 'Authorization':'Bearer '+GHL_API_KEY, 'Version':'2021-07-28', 'Content-Type':'application/json' }, body: '{}'
    }).catch(e => console.warn('[predictor] workflow enroll failed:', e.message));
  }
}

// ── POST /api/predictor/forecast ─────────────────────────────────
router.post('/forecast', predictorLimiter, async (req, res) => {
  try {
    const { beach, email, phone } = req.body || {};
    if (!beach || !email) return res.status(400).json({ error: 'Beach and email are required' });
    if (!validEmail(email)) return res.status(400).json({ error: 'Please enter a valid email' });
    const cfg = BEACHES[beach];
    if (!cfg) return res.status(400).json({ error: 'Invalid beach' });

    // 1) Capture the lead — fire-and-forget so a GHL hiccup never blocks the forecast.
    //    phone is only sent by the form when the visitor checked SMS consent (TCPA/A2P).
    saveLead(email, beach, (typeof phone === 'string' ? phone.trim() : '')).catch(e => console.error('[predictor] lead error:', e.message));

    // 2) Daily cache (one Claude call per beach per day)
    const key = `${beach}|${ymd(new Date())}`;
    if (cache.has(key)) return res.json({ ...cache.get(key), email, cached: true });

    // 3) Real NOAA tides + moon phase
    let preds = [];
    try { preds = await getTides(cfg.station); }
    catch (e) { console.warn('[predictor] NOAA failed:', e.message); }
    const lows = preds.filter(p => p.type === 'L');
    const moon = moonPhase(new Date());
    const tideLines = preds.map(p => `${p.t} — ${p.type === 'L' ? 'LOW' : 'High'} ${p.ht.toFixed(2)} ft`).join('\n');

    // 4) Claude writes the forecast around the REAL numbers
    const system = 'You are an expert Southwest Florida marine biologist and shelling guide. '
      + 'You MUST use only the real tide times provided — never invent tide times or dates. '
      + 'Return ONLY valid minified JSON, no markdown.';
    const user = `Create a 7-day shelling forecast for ${beach}.

REAL NOAA TIDE PREDICTIONS (station: ${cfg.stationName}) — use ONLY these:
${tideLines || '(live tide feed unavailable — keep timing general and say so in scoreSummary)'}

Today's moon: ${moon.name}, ${moon.illum}% illuminated${moon.springTide ? ' (SPRING TIDE — larger range, lower lows, prime shelling)' : ''}.
This beach is known for: ${cfg.knownFor.join(', ')}.
Recommend hotspots only from: ${cfg.hotspots.join(', ')}.

Shelling rules:
- The best windows are the ~2 hours around the LOWEST low tides (negative or near-zero ft), favoring early morning and the day after a front.
- Build topWindows (exactly 3, the three lowest low tides) and every dailyForecast bestTime ONLY from the real low-tide times above.
- Scores should track how low the tide is and how early/uncrowded the window is.

Return JSON exactly in this shape:
{"primeScore":<0-100>,"scoreSummary":"<2 sentences>",
"topWindows":[{"day":"","date":"","timeWindow":"","score":0,"tideCondition":"","shellVariety":"High|Medium|Low","rareProbability":0,"targetShells":[],"reasoning":""}],
"dailyForecast":[{"date":"","bestTime":"","tideAdvantage":0,"weatherScore":0,"varietyLevel":"High|Medium|Low","recommendedSpot":""}],
"recommendations":{"bestGPSSpot":"","spotName":"","likelyShells":[],"proTips":[],"avoidTimes":[],"whatToBring":[]},
"rareShellAlert":{"probability":0,"species":[],"conditions":""}}`;

    let forecast;
    try { forecast = JSON.parse(extractJson(await callAnthropic(system, user, 2400))); }
    catch (e) { console.error('[predictor] AI error:', e.message); return res.status(502).json({ error: 'Forecast temporarily unavailable — please try again.', detail: String(e && e.message || e) }); }

    forecast.beach = beach;
    forecast.station = cfg.stationName;
    forecast.lowTides = lows.slice(0, 8);
    forecast.moon = { name: moon.name, illum: moon.illum };
    forecast.generatedAt = new Date().toISOString();

    cache.set(key, forecast);
    return res.json({ ...forecast, email });
  } catch (e) {
    console.error('[predictor] error:', e);
    return res.status(500).json({ error: 'Failed to generate forecast' });
  }
});

module.exports = router;
