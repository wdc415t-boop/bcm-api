/**
 * BeachCombersMania API Proxy Server
 * ──────────────────────────────────
 * Hides the Anthropic API key server-side.
 * All 6 regional apps + hub call this server instead of Anthropic directly.
 *
 * Endpoints:
 *   POST /api/identify    — Shell photo identification (Claude Sonnet 4)
 *   POST /api/dining      — Restaurant AI refresh by region
 *   POST /api/boats       — Boat/charter AI refresh by region
 *   GET  /api/health      — Health check
 *
 * Deploy to: Render.com (free tier)
 * DNS: api.beachcombersmania.online → Render URL
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

// ── Validate required env ───────────────────────────────────────
if (!ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY is not set in environment variables.');
  process.exit(1);
}

// ── Security middleware ─────────────────────────────────────────
app.use(helmet());

// ── CORS — only allow our BCM domains ───────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // In development, allow localhost
    if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  maxAge: 86400
}));

// ── Rate limiting ───────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' }
});
app.use('/api/', limiter);

// ── Body parser (50MB for base64 images) ────────────────────────
app.use(express.json({ limit: '50mb' }));

// ── Shared Anthropic proxy function ─────────────────────────────
async function callAnthropic(systemPrompt, messages, maxTokens = 1400) {
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error(`Anthropic API error ${response.status}:`, errBody);
    throw new Error(`Anthropic API returned ${response.status}`);
  }

  return await response.json();
}

// ═══════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// ── Health check ────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'BeachCombersMania API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ── Shell Identification ────────────────────────────────────────
app.post('/api/identify', async (req, res) => {
  try {
    const { image_b64, region } = req.body;

    if (!image_b64) {
      return res.status(400).json({ error: 'image_b64 is required' });
    }

    const regionName = region || 'Marco Island';

    const systemPrompt = `You are BeachCombersMania's expert marine biologist specializing in Gulf of America shells, SW Florida — ${regionName}, Naples, Fort Myers Beach, Sanibel, Captiva, Bonita Springs, Ten Thousand Islands. Respond ONLY with valid JSON, no markdown:
{"name":"Common name","scientific":"Genus species","family":"Family","class":"Gastropoda|Bivalvia|Polyplacophora|Scaphopoda|Cephalopoda","animal":"Living animal body, behavior, feeding (2-3 sentences)","animal_emoji":"emoji","habitat":"Where found","range":"Geographic range","rarity":"Common|Uncommon|Rare","size":"Typical adult size","description":"Visual description color shape texture (2 sentences)","diet":"What it ate","lifespan":"Typical lifespan","fun_facts":["fact1","fact2","fact3"],"historical_uses":"Human uses food tools currency jewelry religion","ecological_role":"Ecosystem role","gulf_america_notes":"Notes about finding on SW Florida Gulf beaches","best_gulf_beaches":["beach1","beach2"],"collecting_tip":"One practical beachcomber tip","florida_found":true,"protected":false,"confidence":"High|Medium|Low","not_a_shell":false}
If not a shell set not_a_shell:true.`;

    const messages = [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image_b64 } },
        { type: 'text', text: 'Identify this sea shell. Return only JSON.' }
      ]
    }];

    const data = await callAnthropic(systemPrompt, messages, 1400);
    const text = (data.content || []).map(b => b.text || '').join('');

    // Parse and validate JSON response
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json({ result });

  } catch (err) {
    console.error('Shell ID error:', err.message);
    res.status(500).json({ error: 'Could not identify this shell. Try a clearer photo in natural light.' });
  }
});

// ── Dining AI Refresh ───────────────────────────────────────────
app.post('/api/dining', async (req, res) => {
  try {
    const { region, zip, category } = req.body;

    if (!region) {
      return res.status(400).json({ error: 'region is required' });
    }

    const systemPrompt = `You are a local Gulf Coast dining expert for ${region}, Florida. Return ONLY valid JSON array of 8 restaurants for the "${category || 'All'}" category. Each object: {"name":"Restaurant Name","type":"Cuisine type","price":"$|$$|$$$","address":"Full address","phone":"(xxx) xxx-xxxx","hours":"Hours","desc":"2-sentence description","rating":4.5,"tags":["tag1","tag2"],"website":"url","delivers":true,"outdoor_seating":true,"water_view":false,"tip":"Insider tip for beachcombers"}. Real restaurants only. ZIP: ${zip || '34145'}.`;

    const messages = [{
      role: 'user',
      content: `List 8 great restaurants in ${region}, FL for beachcombers. Category: ${category || 'All'}. Return only JSON array.`
    }];

    const data = await callAnthropic(systemPrompt, messages, 4000);
    const text = (data.content || []).map(b => b.text || '').join('');
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json({ result });

  } catch (err) {
    console.error('Dining refresh error:', err.message);
    res.status(500).json({ error: 'Could not refresh dining listings. Please try again.' });
  }
});

// ── Boats AI Refresh ────────────────────────────────────────────
app.post('/api/boats', async (req, res) => {
  try {
    const { region } = req.body;

    if (!region) {
      return res.status(400).json({ error: 'region is required' });
    }

    const systemPrompt = `You are a local Gulf Coast boating expert for ${region}, Florida. Return ONLY valid JSON array of 4 boat rental/charter operators. Each object: {"name":"Business Name","type":"Charter|Rental|Tour","address":"Full address","phone":"(xxx) xxx-xxxx","hours":"Hours","desc":"2-sentence description","price_range":"$100-300","website":"url","captain_included":true,"fishing_available":true,"shell_islands":["island1","island2"],"captain_tip":"Insider tip for shelling by boat","best_for":"Families|Couples|Groups|Solo"}. Real businesses only.`;

    const messages = [{
      role: 'user',
      content: `List 4 boat rental or charter operators in ${region}, FL for beachcombers who want to reach shell islands. Return only JSON array.`
    }];

    const data = await callAnthropic(systemPrompt, messages, 3000);
    const text = (data.content || []).map(b => b.text || '').join('');
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json({ result });

  } catch (err) {
    console.error('Boats refresh error:', err.message);
    res.status(500).json({ error: 'Could not refresh boat listings. Please try again.' });
  }
});

// ── 404 handler ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found. Available: /api/health, /api/identify, /api/dining, /api/boats' });
});

// ── Error handler ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🐚 BeachCombersMania API Server`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Allowed Origins: ${allowedOrigins.length} domains`);
  console.log(`   Anthropic Key: ...${ANTHROPIC_API_KEY.slice(-8)}`);
  console.log(`   Ready!\n`);
});
