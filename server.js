/**
 * BeachCombersMania API Server v2.1
 * Extended with BPM / Foundry AI — Claim Analyzer endpoints
 * ──────────────────────────────────────────────────────────
 * Full backend with authentication, subscriptions, and AI proxy.
 * ALL FILES AT ROOT LEVEL — no subdirectories needed.
 *
 * Files:
 *   server.js          ← this file (main app)
 *   db.js              ← SQLite database + schema
 *   auth-middleware.js  ← JWT token verification
 *   auth-routes.js     ← register, login, profile
 *   subscription.js    ← plans, upgrade, cancel
 *
 * Endpoints:
 *   GET  /api/health                    — Health check + stats
 *   POST /api/auth/register             — Create account
 *   POST /api/auth/login                — Log in, get JWT
 *   GET  /api/auth/me                   — Profile + subscription
 *   PUT  /api/auth/me                   — Update profile
 *   POST /api/auth/change-password      — Change password
 *   GET  /api/subscription              — Current subscription
 *   GET  /api/subscription/plans        — Available plans
 *   POST /api/subscription/upgrade      — Upgrade (Stripe placeholder)
 *   POST /api/subscription/cancel       — Cancel subscription
 *   POST /api/identify                  — Shell photo AI ID
 *   POST /api/dining                    — Restaurant AI refresh
 *   POST /api/boats                     — Boat/charter AI refresh
 *   POST /api/bpm/receipt-scan          — BPM receipt scanner
 *   POST /api/bpm/settlement-parse      — Insurance settlement PDF parser
 *   POST /api/bpm/photo-analyze         — Damage photo analyzer
 *   POST /api/bpm/claim-synthesize      — Shortfall analysis engine
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Initialize database (creates tables on first run)
const { stmts } = require('./db');

// Auth middleware (flat — same directory)
const { optionalAuth, requireAuth, requirePremium } = require('./auth-middleware');

// Route modules (flat — same directory)
const authRoutes = require('./auth-routes');
const subscriptionRoutes = require('./subscription');

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

// ── CORS — only allow our BCM/BPM domains ───────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
      return callback(null, true);
    }
    // Allow file:// protocol for local HTML testing
    if (!origin || origin === 'null') {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));

// ── Rate limiting ───────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' }
});

// BPM AI endpoints get their own limiter — more generous for analysis work
const bpmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests. Please wait a moment.' }
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/bpm/', bpmLimiter);

// ── Body parser (50MB for base64 images and PDFs) ───────────────
app.use(express.json({ limit: '50mb' }));

// ═══════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════

// ── Health check ────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const userCount = stmts.countUsers.get();
  const paidCount = stmts.countPaidUsers.get();

  res.json({
    status: 'ok',
    service: 'BeachCombersMania API',
    version: '2.1.1',
    timestamp: new Date().toISOString(),
    stats: {
      total_users: userCount.count,
      paid_subscribers: paidCount.count
    }
  });
});

// ── Auth routes ─────────────────────────────────────────────────
app.use('/api/auth', authRoutes);

// ── Subscription routes ─────────────────────────────────────────
app.use('/api/subscription', subscriptionRoutes);

// ═══════════════════════════════════════════════════════════════════
// AI PROXY — SHARED HELPER
// ═══════════════════════════════════════════════════════════════════

async function callAnthropic(systemPrompt, messages, maxTokens = 1400) {
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25'
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
// BCM AI ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// ── Shell Identification ────────────────────────────────────────
app.post('/api/identify', optionalAuth, async (req, res) => {
  try {
    const { image_b64, region } = req.body;

    if (!image_b64) {
      return res.status(400).json({ error: 'image_b64 is required' });
    }

    let isPremium = false;
    if (req.user) {
      const sub = stmts.getActiveSubscription.get(req.user.userId);
      isPremium = sub && sub.plan !== 'free' && sub.status === 'active';
    }

    const regionName = region || 'Marco Island';

    const systemPrompt = isPremium
      ? `You are BeachCombersMania's expert marine biologist specializing in Gulf of America shells, SW Florida — ${regionName}, Naples, Fort Myers Beach, Sanibel, Captiva, Bonita Springs, Ten Thousand Islands. Respond ONLY with valid JSON, no markdown:
{"name":"Common name","scientific":"Genus species","family":"Family","class":"Gastropoda|Bivalvia|Polyplacophora|Scaphopoda|Cephalopoda","animal":"Living animal body, behavior, feeding (2-3 sentences)","animal_emoji":"emoji","habitat":"Where found","range":"Geographic range","rarity":"Common|Uncommon|Rare","size":"Typical adult size","description":"Visual description color shape texture (2 sentences)","diet":"What it ate","lifespan":"Typical lifespan","fun_facts":["fact1","fact2","fact3"],"historical_uses":"Human uses food tools currency jewelry religion","ecological_role":"Ecosystem role","gulf_america_notes":"Notes about finding on SW Florida Gulf beaches","best_gulf_beaches":["beach1","beach2"],"collecting_tip":"One practical beachcomber tip","florida_found":true,"protected":false,"confidence":"High|Medium|Low","not_a_shell":false,"why_identified":["reason1 — specific visual feature that matched","reason2","reason3"],"similar_species":[{"name":"Similar species","how_to_distinguish":"Key difference"}],"condition":"Whole|Fragment|Half|Juvenile|Sun-bleached|Surf-polished","quality_rating":4}`
      : `You are BeachCombersMania's expert marine biologist specializing in Gulf of America shells, SW Florida — ${regionName}, Naples, Fort Myers Beach, Sanibel, Captiva, Bonita Springs, Ten Thousand Islands. Respond ONLY with valid JSON, no markdown:
{"name":"Common name","scientific":"Genus species","family":"Family","class":"Gastropoda|Bivalvia|Polyplacophora|Scaphopoda|Cephalopoda","animal":"Living animal body, behavior, feeding (2-3 sentences)","animal_emoji":"emoji","habitat":"Where found","range":"Geographic range","rarity":"Common|Uncommon|Rare","size":"Typical adult size","description":"Visual description color shape texture (2 sentences)","diet":"What it ate","lifespan":"Typical lifespan","fun_facts":["fact1","fact2","fact3"],"historical_uses":"Human uses food tools currency jewelry religion","ecological_role":"Ecosystem role","gulf_america_notes":"Notes about finding on SW Florida Gulf beaches","best_gulf_beaches":["beach1","beach2"],"collecting_tip":"One practical beachcomber tip","florida_found":true,"protected":false,"confidence":"High|Medium|Low","not_a_shell":false}
If not a shell set not_a_shell:true.`;

    const messages = [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image_b64 } },
        { type: 'text', text: 'Identify this sea shell. Return only JSON.' }
      ]
    }];

    const data = await callAnthropic(systemPrompt, messages, isPremium ? 2000 : 1400);
    const text = (data.content || []).map(b => b.text || '').join('');
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json({ result, premium: isPremium });

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

// ═══════════════════════════════════════════════════════════════════
// BPM / FOUNDRY AI — CLAIM ANALYZER ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// ── Receipt Scanner ─────────────────────────────────────────────
app.post('/api/bpm/receipt-scan', async (req, res) => {
  try {
    const { image_b64, media_type } = req.body;
    if (!image_b64) return res.status(400).json({ error: 'image_b64 is required' });

    const systemPrompt = `You are an expert receipt parser for a construction expense tracking system.
Analyze this receipt image and extract ALL line items with precision.
Return ONLY valid JSON, no markdown, no preamble:
{
  "vendor": "Store/vendor name",
  "date": "YYYY-MM-DD or empty string",
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00,
  "payment_method": "Cash|Credit|Debit|Check or empty",
  "card_last4": "last 4 digits or empty",
  "receipt_number": "receipt/transaction number or empty",
  "cashier": "cashier name or empty",
  "items": [
    {
      "description": "Full item description including size/quantity",
      "qty": 1,
      "unit_price": 0.00,
      "line_total": 0.00,
      "category": "Materials|Labor|Equipment|Supplies|Other"
    }
  ],
  "notes": "Any relevant notes, discounts, or special items",
  "confidence": "High|Medium|Low"
}
Be precise with dollar amounts. If a value is not visible, use 0.00 for numbers or empty string for text.`;

    const messages = [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: media_type || 'image/jpeg',
            data: image_b64
          }
        },
        { type: 'text', text: 'Parse this receipt completely. Return only JSON.' }
      ]
    }];

    const data = await callAnthropic(systemPrompt, messages, 2000);
    const text = (data.content || []).map(b => b.text || '').join('');
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json({ result });

  } catch (err) {
    console.error('Receipt scan error:', err.message);
    res.status(500).json({ error: 'Could not parse receipt. Try a clearer photo.' });
  }
});

// ── Settlement Document Parser ──────────────────────────────────
app.post('/api/bpm/settlement-parse', async (req, res) => {
  try {
    const { pdf_b64, media_type, claim_number } = req.body;
    if (!pdf_b64) return res.status(400).json({ error: 'pdf_b64 is required' });

    const systemPrompt = `You are an expert insurance settlement document analyzer specializing in Xactimate-format documents used by major US carriers (AllState, State Farm, USAA, Travelers, etc.).

Analyze this settlement document and extract ALL data with maximum precision.
Return ONLY valid JSON, no markdown, no preamble:
{
  "format_family": "Xactimate|Symbility|MSB_RCT|Carrier_Proprietary|Generic_Letter",
  "format_confidence": 0.95,
  "claim_header": {
    "claim_number": "",
    "carrier": "",
    "policy_number": "",
    "date_of_loss": "",
    "inspection_date": "",
    "claimant_name": "",
    "loss_address": "",
    "adjuster_name": "",
    "adjuster_contact": ""
  },
  "coverage_summary": {
    "total_rcv_cents": 0,
    "total_depreciation_cents": 0,
    "total_acv_cents": 0,
    "deductible_cents": 0,
    "net_paid_cents": 0,
    "recoverable_depreciation_cents": 0
  },
  "line_items": [
    {
      "line_ref": "1",
      "room_or_area": "Main Level",
      "scope_code": "DRY",
      "description": "Full description of work item",
      "quantity": 0.00,
      "unit": "SF",
      "unit_cost_cents": 0,
      "rcv_cents": 0,
      "depreciation_cents": 0,
      "acv_cents": 0,
      "is_op_line": false,
      "notes": ""
    }
  ],
  "missing_categories_detected": ["List any damage types visually apparent but missing from settlement"],
  "custom_material_flags": ["List any items priced as commodity that appear to be custom/specialty"],
  "parse_quality": "full_xactimate|generic_fallback|partial",
  "parse_notes": "Any issues or limitations in the parse"
}
Convert all dollar amounts to integer cents (multiply by 100). Be precise — this document affects real financial negotiations.`;

    const messages = [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: media_type || 'application/pdf',
            data: pdf_b64
          }
        },
        {
          type: 'text',
          text: `Parse this insurance settlement document completely.${claim_number ? ' Claim number: ' + claim_number : ''} Return only JSON.`
        }
      ]
    }];

    const data = await callAnthropic(systemPrompt, messages, 4000);
    const text = (data.content || []).map(b => b.text || '').join('');
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json({ result });

  } catch (err) {
    console.error('Settlement parse error:', err.message);
    res.status(500).json({ error: 'Could not parse settlement document. Ensure it is a valid PDF.' });
  }
});

// ── Damage Photo Analyzer ───────────────────────────────────────
app.post('/api/bpm/photo-analyze', async (req, res) => {
  try {
    const { image_b64, media_type, room_label, claim_context } = req.body;
    if (!image_b64) return res.status(400).json({ error: 'image_b64 is required' });

    const context = claim_context || 'Ice dam water damage, Warren Ohio, winter 2026';

    const systemPrompt = `You are an expert insurance damage assessor and construction estimator.
Analyze this damage photograph and provide a detailed assessment.
Return ONLY valid JSON, no markdown, no preamble:
{
  "room_area": "${room_label || 'Unknown'}",
  "damage_types": ["water","mold","structural","debris","electrical","fire","smoke","wear"],
  "materials_affected": [
    {
      "material": "Description of material",
      "grade": "commodity|custom|specialty",
      "custom_notes": "Why custom/specialty if applicable",
      "severity": "cosmetic|moderate|full_replacement",
      "estimated_area_sf": 0,
      "quantity_notes": "Visible quantity estimate or indeterminable"
    }
  ],
  "missing_from_typical_settlement": [
    "List items visible here that insurance adjusters commonly omit"
  ],
  "safety_concerns": [
    "List any electrical, structural, mold, or safety issues visible"
  ],
  "labor_implications": [
    "List labor tasks implied by visible damage (nail removal, debris, specialty trades, etc.)"
  ],
  "custom_material_detected": false,
  "mold_detected": false,
  "electrical_concern_detected": false,
  "structural_concern_detected": false,
  "photo_quality": "good|fair|poor",
  "assessor_notes": "Overall assessment narrative 2-3 sentences",
  "confidence": "High|Medium|Low"
}
Be specific. Note custom materials (oak strip ceilings, pine paneling, tile ceilings, custom millwork) explicitly. Say indeterminable rather than guessing quantities.`;

    const messages = [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: media_type || 'image/jpeg',
            data: image_b64
          }
        },
        {
          type: 'text',
          text: `Analyze this damage photo. Room/area: ${room_label || 'unspecified'}. Claim context: ${context}. Return only JSON.`
        }
      ]
    }];

    const data = await callAnthropic(systemPrompt, messages, 2000);
    const text = (data.content || []).map(b => b.text || '').join('');
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json({ result });

  } catch (err) {
    console.error('Photo analyze error:', err.message);
    res.status(500).json({ error: 'Could not analyze photo. Try a clearer image.' });
  }
});

// ── Claim Synthesis — Shortfall Analysis Engine ─────────────────
app.post('/api/bpm/claim-synthesize', async (req, res) => {
  try {
    const {
      settlement_parse,
      bpm_expenses,
      photo_analyses,
      local_knowledge,
      claim_metadata
    } = req.body;

    if (!settlement_parse || !bpm_expenses) {
      return res.status(400).json({ error: 'settlement_parse and bpm_expenses are required' });
    }

    const systemPrompt = `You are a Professional Insurance Adjuster (PIA) preparing a supplemental demand for an insurance carrier.
You have four authoritative data sources. Produce a defensible shortfall analysis.
Return ONLY valid JSON, no markdown, no preamble:
{
  "claim_summary": {
    "claim_number": "",
    "carrier": "",
    "date_of_loss": "",
    "claimant": "",
    "property_address": "",
    "analysis_date": "",
    "settlement_acv_cents": 0,
    "bpm_actual_cents": 0,
    "total_shortfall_cents": 0,
    "shortfall_percentage": 0,
    "carrier_paid_pct_of_actual": 0
  },
  "shortfall_rows": [
    {
      "category": "Category name",
      "room_area": "Room or area",
      "settlement_description": "What carrier paid for",
      "settlement_acv_cents": 0,
      "bpm_actual_cents": 0,
      "shortfall_cents": 0,
      "shortfall_type": "underpayment|missing_item|custom_material|labor_omission|depreciation",
      "evidence_refs": ["expense_id or photo_ref or local_knowledge_ref"],
      "narrative": "1-3 sentence explanation citing specific evidence",
      "defensibility": "strong|moderate|needs_documentation"
    }
  ],
  "missing_items": [
    {
      "item": "Description of missing scope item",
      "evidence": "Photo or BPM reference proving it exists",
      "estimated_cost_cents": 0,
      "priority": "high|medium|low"
    }
  ],
  "custom_material_claims": [
    {
      "item": "Item name",
      "carrier_priced_as": "What carrier called it",
      "actual_material": "What it actually is",
      "price_differential_notes": "Why the pricing difference matters",
      "evidence": "Photo or local knowledge reference"
    }
  ],
  "recoverable_depreciation": {
    "total_recoverable_cents": 0,
    "action_required": "Submit receipts for completed work to recover depreciation",
    "deadline_notes": "Ohio 2-year statutory window from date of loss"
  },
  "ohio_accommodation_labor": {
    "applies": true,
    "basis": "Claimant age 67 — Ohio reasonable accommodation doctrine applies",
    "uncompensated_labor_cents": 0,
    "documentation_needed": "Homeowner time logs and mileage records"
  },
  "executive_summary": "3-5 sentence plain-language summary of the shortfall and recommended actions",
  "recommended_next_steps": [
    "Prioritized action items for the PIA or homeowner"
  ],
  "total_demand_cents": 0,
  "confidence_level": "High|Medium|Low",
  "analysis_notes": "Any caveats or limitations in this analysis"
}
Be conservative in dollar estimates — over-claiming reduces credibility. Every shortfall row must cite specific evidence. Convert all dollars to integer cents.`;

    const userMessage = `Perform shortfall analysis with these inputs:

CLAIM METADATA:
${JSON.stringify(claim_metadata || {}, null, 2)}

CARRIER SETTLEMENT PARSE:
${JSON.stringify(settlement_parse, null, 2)}

BPM EXPENSE DATA (actual reconstruction costs):
${JSON.stringify(bpm_expenses, null, 2)}

DAMAGE PHOTO ANALYSES:
${JSON.stringify(photo_analyses || [], null, 2)}

LOCAL KNOWLEDGE (user-provided context):
${JSON.stringify(local_knowledge || [], null, 2)}

Return only the JSON shortfall analysis.`;

    const messages = [{ role: 'user', content: userMessage }];
    const data = await callAnthropic(systemPrompt, messages, 6000);
    const text = (data.content || []).map(b => b.text || '').join('');
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json({ result });

  } catch (err) {
    console.error('Claim synthesis error:', err.message);
    res.status(500).json({ error: 'Could not synthesize claim analysis. Please try again.' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// END BPM / FOUNDRY AI ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// ── 404 handler ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found.',
    available: {
      health: 'GET /api/health',
      auth: 'POST /api/auth/register, /api/auth/login, GET /api/auth/me',
      subscription: 'GET /api/subscription, /api/subscription/plans',
      bcm_ai: 'POST /api/identify, /api/dining, /api/boats',
      bpm_ai: 'POST /api/bpm/receipt-scan, /api/bpm/settlement-parse, /api/bpm/photo-analyze, /api/bpm/claim-synthesize'
    }
  });
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
  console.log(`\n  BeachCombersMania API Server v2.1.1 — with BPM Foundry AI`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Allowed Origins: ${allowedOrigins.length} domains`);
  console.log(`   Anthropic Key: ...${ANTHROPIC_API_KEY.slice(-8)}`);
  console.log(`   BPM Endpoints: receipt-scan, settlement-parse, photo-analyze, claim-synthesize`);
  console.log(`   Ready!\n`);
});
