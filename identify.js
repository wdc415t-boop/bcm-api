/**
 * identify.js — BeachCombersMania shell identification (Phase 1, 2026-10-28)
 * ─────────────────────────────────────────────────────────────────────────
 * Replaces the open-ended "what shell is this?" prompt with:
 *   1. The species catalog (shell-catalog.json, refreshed daily from the hub) sent to
 *      Claude as a cached system block, so it picks from shells we actually list.
 *   2. A feature-first prompt: describe what is visible, match sculpture/spire/aperture
 *      before colour, return the top-3 catalog candidates with confidence, via a JSON schema.
 *   3. An optional calibrated decider (TypeSafe Jev via OpenRouter, env BCM_DECIDER) that
 *      gates the photo (is it a specimen? aperture visible?), locates the shell (box) and
 *      scores species with calibrated probabilities. Off by default; any failure falls back
 *      to Claude-only. See Phase1-JEV-Addendum-2026-10-28.md.
 *   4. A legacy-shaped `result` so app builds that predate Phase 1 keep working.
 *
 * Env:
 *   ANTHROPIC_API_KEY   required (already set)
 *   BCM_MODEL           default claude-sonnet-5-5   (claude-opus-5-5 is the no-deploy upgrade)
 *   BCM_CATALOG_URL     default https://beachcombersmania.online/assets/MASTER-SHELL-DB.json
 *   BCM_DECIDER         'off' (default) | 'typesafe/jev-1.14' | any OpenRouter decisions model id
 *   OPENROUTER_API_KEY  required when BCM_DECIDER is not 'off'
 *   BCM_EVAL_KEY        optional; requests with header X-BCM-Eval: <key> skip the scan meter
 *                       and may pass {variant:'legacy'|'new', model, decider, vision} overrides.
 *   GOOGLE_VISION_API_KEY + BCM_VISION='on'  Phase 3a (2026-10-30): Google Web Detection runs first
 *                       and its catalog-mapped names go to Claude as hints (vision.js). Default off.
 *   BCM_OPINION='<openrouter model>'  Phase 3a.2 (2026-10-31): a second vision model names the species
 *                       and its catalog-mapped names go to Claude as hints (opinion.js). Default off.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vision = require('./vision');
const opinion = require('./opinion');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.BCM_MODEL || 'claude-sonnet-5-5';
const CATALOG_URL = process.env.BCM_CATALOG_URL || 'https://beachcombersmania.online/assets/MASTER-SHELL-DB.json';
const DECIDER = (process.env.BCM_DECIDER || 'off').trim();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
const EVAL_KEY = process.env.BCM_EVAL_KEY || '';

// USD per million tokens (Anthropic list prices, 2026-10). Cache writes cost 1.25× input.
const MODEL_PRICES = {
  'claude-sonnet-5-5': { inPerM: 2, outPerM: 10, cacheReadPerM: 0.2 },
  'claude-opus-5-5':   { inPerM: 4, outPerM: 20, cacheReadPerM: 0.2 },
  'claude-sonnet-5':   { inPerM: 2, outPerM: 10, cacheReadPerM: 0.2 },
  'claude-haiku-5-5':  { inPerM: 0.1, outPerM: 0.5, cacheReadPerM: 0.01 },
  'claude-sonnet-4-6': { inPerM: 3, outPerM: 15, cacheReadPerM: 0.3 },
};
function priceFor(model) { return MODEL_PRICES[model] || MODEL_PRICES['claude-sonnet-5-5']; }

// ─────────────────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────────────────
const catalog = { version: null, species: [], byId: new Map(), text: '', source: 'none', loadedAt: null, lastError: null };

function normaliseCatalog(raw) {
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.species) ? raw.species : null);
  if (!arr || arr.length < 100) throw new Error('catalog has fewer than 100 species');
  for (const s of arr) if (typeof s.id !== 'number' || !s.name || !s.sci) throw new Error('catalog record missing id/name/sci');
  return { version: (raw && raw.version) || new Date().toISOString().slice(0, 10), species: arr };
}

function pipeLine(s) {
  // One line per species. Order matters for the prompt: structure before colour.
  return [s.id, s.name, s.sci, s.type, s.size || '', s.shape || '', s.surface || '', s.colorPattern || '',
    s.spireHeight || '', s.aperture || '', s.rarity || '', (s.desc || '').replace(/\s+/g, ' ').trim(),
    (s.tells || '').replace(/\s+/g, ' ').trim()].join('|');
}

function installCatalog(norm, source) {
  catalog.version = norm.version;
  catalog.species = norm.species;
  catalog.byId = new Map(norm.species.map(s => [s.id, s]));
  catalog.text = 'id|name|scientific|class|size|shape|surface|pattern|spire|aperture|rarity|description|tells\n' +
    norm.species.map(pipeLine).join('\n');
  catalog.source = source;
  catalog.loadedAt = new Date().toISOString();
}

function loadBundledCatalog() {
  const p = path.join(__dirname, 'shell-catalog.json');
  installCatalog(normaliseCatalog(JSON.parse(fs.readFileSync(p, 'utf8'))), 'bundled');
}

async function refreshCatalog() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(CATALOG_URL, { signal: ctl.signal, headers: { 'cache-control': 'no-cache' } });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const norm = normaliseCatalog(await r.json());
    installCatalog(norm, CATALOG_URL);
    catalog.lastError = null;
    console.log(`[CATALOG] refreshed from hub: ${norm.species.length} species, version ${norm.version}`);
  } catch (e) {
    catalog.lastError = e.message;
    console.warn('[CATALOG] refresh failed, keeping', catalog.source, '-', e.message);
  }
}

loadBundledCatalog();
refreshCatalog();
setInterval(refreshCatalog, 24 * 60 * 60 * 1000).unref();

// ─────────────────────────────────────────────────────────────────────────
// Claude: feature-first prompt + JSON schema
// ─────────────────────────────────────────────────────────────────────────
const RULES = `You are BeachCombersMania's shell identification engine for the Southwest Florida Gulf coast (Marco Island, Naples, Bonita Springs, Fort Myers Beach, Sanibel, Captiva, Ten Thousand Islands). You identify beach finds against a fixed catalog of 123 species that follows this message. Work in this order and do not skip steps.

1. OBSERVED. Describe only what is literally visible: overall shape, sculpture (ribs, cords, knobs, spines, cancellate cross-hatching, smooth), spire height, whether the aperture (opening) is visible and what it looks like, colour pattern, apparent condition (whole, worn, fragment, juvenile, sun-bleached). Estimate size ONLY relative to something of known size in the frame (coin, hand, ruler, paper-towel quilting is about 0.4 in / 1 cm per square); otherwise say size is unknown. If the aperture is hidden, say so explicitly.

2. MATCH STRUCTURE BEFORE COLOUR. Compare the observed shape, sculpture, spire and aperture against the catalog fields in that order. Colour and pattern are tie-breakers only; many species vary in colour and worn shells lose it. Some records end with a tells column: the specific features that separate that species from its look-alikes. When two or more candidates are close, check each tell against what is actually visible before choosing, and say in why which tells you could and could not see.

3. CANDIDATES. Return the three best catalog species by id with a 0-100 confidence each, best first. Give confidence above 75 only when sculpture, spire AND aperture all agree with the catalog record. If the aperture is hidden, cap every confidence at 70. Known confusions to check deliberately: Common Nutmeg (71), Tinted Cantharus (34), Gaudy Cantharus (33) and the small drills (35, 36, 37) all show cross-hatched or ribbed sculpture, so separate them by the base and aperture as their tells describe (Nutmeg: folds on the columella and no siphonal canal; Cantharus and drills: an open siphonal canal and no folds); if the base and aperture are not visible, keep them as co-candidates with modest confidence instead of committing to one. Scotch Bonnet (13) is larger with a thick flaring outer lip and a shield-like parietal callus. Banded Tulip (10) has a few crisp thin unbroken spiral lines where True Tulip (9) has broken, smeared reddish streaks; Shark Eye and other moon snails differ by the umbilicus and callus; Calico vs Bay scallop by rib count and mottling; Keyhole vs Arrowhead sand dollar by the slots; juveniles and worn adults can look like other species. If the find is a shell but matches nothing in the catalog well, still give your three closest catalog ids with low confidence and put your best free-text guess in not_in_catalog_guess.

4. NOT A SHELL. If the photo does not show a seashell, sand dollar, urchin test, egg case, chiton, tusk shell or similar beach specimen, set is_shell to false, still fill observed.notes with what you see, and give three catalog ids with confidence 0.

5. EXPLAIN. how_to_distinguish: one or two sentences on what separates candidate 1 from candidates 2 and 3 in THIS photo. photo_tip: one sentence telling the beachcomber what photo would settle the identification (for example "photograph the opening side next to a coin").

6. NARRATIVE for candidate 1 only: the living animal, its ecological role, historical or cultural uses, three fun facts, a collecting tip, and a note on finding it on SW Florida Gulf beaches. Keep each to one or two sentences, true to the species, no invented statistics.

Write for a curious beachcomber, not a malacologist. Use the catalog's common names exactly.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['observed', 'is_shell', 'candidates', 'not_in_catalog_guess', 'how_to_distinguish', 'narrative', 'photo_tip'],
  properties: {
    observed: {
      type: 'object', additionalProperties: false,
      required: ['shape', 'sculpture', 'spire', 'aperture_visible', 'aperture', 'color_pattern', 'size_estimate', 'size_reference', 'condition', 'notes'],
      properties: {
        shape: { type: 'string' }, sculpture: { type: 'string' }, spire: { type: 'string' },
        aperture_visible: { type: 'boolean' }, aperture: { type: 'string' }, color_pattern: { type: 'string' },
        size_estimate: { type: 'string' }, size_reference: { type: 'boolean' },
        condition: { type: 'string', enum: ['Whole', 'Worn', 'Fragment', 'Half', 'Juvenile', 'Sun-bleached', 'Surf-polished', 'Unknown'] },
        notes: { type: 'string' }
      }
    },
    is_shell: { type: 'boolean' },
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'confidence', 'why'],
        properties: { id: { type: 'integer' }, confidence: { type: 'integer' }, why: { type: 'array', items: { type: 'string' } } }
      }
    },
    not_in_catalog_guess: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    how_to_distinguish: { type: 'string' },
    narrative: {
      type: 'object', additionalProperties: false,
      required: ['living_animal', 'ecological_role', 'historical_uses', 'fun_facts', 'collecting_tip', 'gulf_notes'],
      properties: {
        living_animal: { type: 'string' }, ecological_role: { type: 'string' }, historical_uses: { type: 'string' },
        fun_facts: { type: 'array', items: { type: 'string' } }, collecting_tip: { type: 'string' }, gulf_notes: { type: 'string' }
      }
    },
    photo_tip: { type: 'string' }
  }
};

const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function callClaudeIdentify({ imageB64, mediaType, region, model, hints }) {
  const body = {
    model,
    max_tokens: 3000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    // Server-side refusal fallback ("default" routing) — a policy decline on the primary
    // model is retried on Anthropic's fallback instead of failing the scan.
    fallbacks: 'default',
    system: [
      { type: 'text', text: RULES, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'CATALOG (one species per line; version ' + catalog.version + '):\n' + catalog.text, cache_control: { type: 'ephemeral' } }
    ],
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } },
        { type: 'text', text: `Beach region selected by the user: ${region}. Identify this find against the catalog.` },
        ...(hints ? [{ type: 'text', text: hints }] : [])
      ]
    }]
  };
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Anthropic API ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  if (data.stop_reason === 'refusal') {
    const err = new Error('refusal'); err.refusal = true; err.details = data.stop_details || null; throw err;
  }
  if (data.stop_reason === 'max_tokens') throw new Error('Claude response truncated (max_tokens)');
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Error('Claude returned non-JSON output'); }
  return { parsed, usage: data.usage || {}, model: data.model || model };
}

// Legacy prompt (pre-Phase-1) kept only for the eval harness `variant:'legacy'` arm.
const LEGACY_PROMPT = (regionName) => `You are BeachCombersMania's expert marine biologist specializing in Gulf of America shells, SW Florida — ${regionName}, Naples, Fort Myers Beach, Sanibel, Captiva, Bonita Springs, Ten Thousand Islands. Respond ONLY with valid JSON, no markdown:
{"name":"Common name","scientific":"Genus species","family":"Family","class":"Gastropoda|Bivalvia|Polyplacophora|Scaphopoda|Cephalopoda","animal":"Living animal body, behavior, feeding (2-3 sentences)","animal_emoji":"emoji","habitat":"Where found","range":"Geographic range","rarity":"Common|Uncommon|Rare","size":"Typical adult size","description":"Visual description color shape texture (2 sentences)","diet":"What it ate","lifespan":"Typical lifespan","fun_facts":["fact1","fact2","fact3"],"historical_uses":"Human uses food tools currency jewelry religion","ecological_role":"Ecosystem role","gulf_america_notes":"Notes about finding on SW Florida Gulf beaches","best_gulf_beaches":["beach1","beach2"],"collecting_tip":"One practical beachcomber tip","florida_found":true,"protected":false,"confidence":"High|Medium|Low","not_a_shell":false}
If not a shell set not_a_shell:true.`;

async function callClaudeLegacy({ imageB64, mediaType, region, model }) {
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model, max_tokens: 1400, system: LEGACY_PROMPT(region),
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } },
        { type: 'text', text: 'Identify this sea shell. Return only JSON.' } ] }]
    })
  });
  if (!r.ok) throw new Error(`Anthropic API ${r.status}`);
  const data = await r.json();
  const text = (data.content || []).map(b => b.text || '').join('');
  return { parsed: JSON.parse(text.replace(/```json|```/g, '').trim()), usage: data.usage || {}, model: data.model || model };
}

// ─────────────────────────────────────────────────────────────────────────
// Decider (Jev or any OpenRouter decisions model). Every function returns null on failure.
// ─────────────────────────────────────────────────────────────────────────
const CLASS_CRITERIA = {
  gastropod: 'A coiled snail shell: spiral whorls, a spire, a single opening (aperture). Includes conchs, whelks, olives, cones, murex, moon snails, tulips, augers, nerites, limpets and slipper shells.',
  bivalve: 'A clam-type shell: one or two hinged valves, fan, oval, heart or rectangular, no spiral. Includes scallops, cockles, arks, venus clams, tellins, oysters, mussels, jingles, angel wings.',
  echinoderm: 'A sand dollar, sea biscuit or sea urchin test: flat or domed disc with a five-part star pattern or slots, no shell whorls.',
  chiton: 'An oval armoured mollusk with eight overlapping plates, or a single curved butterfly-shaped plate from one.',
  scaphopod: 'A tusk shell: a slender, slightly curved hollow tube open at both ends.',
  egg_case: 'An egg case or egg collar: a rubbery sand collar, a papery string of discs (whelk egg case), or a mermaid\'s purse.',
  not_a_shell: 'Not a beach specimen at all: a rock, coral, bottle, hand, food, pet, person, screenshot or unrelated object.'
};
const CLASS_TO_TYPE = { gastropod: 'Gastropod', bivalve: 'Bivalve', echinoderm: 'Echinoderm', chiton: 'Chiton', scaphopod: 'Scaphopod' };

function deciderActive(model) { return model && model !== 'off' && OPENROUTER_API_KEY; }
function deciderIsJev(model) { return /typesafe\/jev/i.test(model || ''); }

async function postDecision(model, state, questions, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(OPENROUTER_DECISIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENROUTER_API_KEY, 'HTTP-Referer': 'https://beachcombersmania.online', 'X-Title': 'BeachCombersMania' },
      body: JSON.stringify({ model, state, questions }),
      signal: ctl.signal
    });
    if (!r.ok) throw new Error('decisions HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return await r.json();
  } finally { clearTimeout(t); }
}

async function deciderGate({ imageB64, mediaType, model }) {
  const started = Date.now();
  try {
    const image = { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageB64}` } };
    const questions = {
      is_specimen: { type: 'noul', instructions: 'The photo shows a seashell, sand dollar, sea urchin test, chiton, tusk shell, egg case or similar beach specimen as its main subject.' },
      aperture_visible: { type: 'noul', instructions: 'The opening (aperture) of the shell is visible in the photo, so the inside edge or lip of the opening can be seen.' },
      size_reference: { type: 'noul', instructions: 'Something of known size is in the frame next to the specimen: a coin, a hand or fingers, a ruler, paper towel quilting, or a phone.' },
      shell_class: { type: 'choice', instructions: 'What kind of beach specimen is the main subject of the photo?', criteria: CLASS_CRITERIA }
    };
    if (deciderIsJev(model)) questions.shell_box = { type: 'box', instructions: 'the single shell or beach specimen the person is photographing, in the photo' };
    const out = await postDecision(model, ['Photo a beachcomber took on a Southwest Florida Gulf beach to have the find identified:', image], questions, 9000);
    const a = out.answers || {};
    return {
      model: out.model || model,
      is_specimen: a.is_specimen ? a.is_specimen.noul : null,
      aperture_visible: a.aperture_visible ? a.aperture_visible.noul : null,
      size_reference: a.size_reference ? a.size_reference.noul : null,
      shell_class: a.shell_class ? { choice: a.shell_class.choice, probabilities: a.shell_class.probabilities, confidence: a.shell_class.confidence } : null,
      box: a.shell_box && a.shell_box.box ? { ...a.shell_box.box, confidence: a.shell_box.confidence } : null,
      cost_usd: out.usage && out.usage.cost,
      ms: Date.now() - started
    };
  } catch (e) {
    console.warn('[DECIDER] gate failed:', e.message);
    return { error: e.message, ms: Date.now() - started };
  }
}

function speciesCriterion(s) {
  return `${s.name} (${s.sci}): ${s.type}, ${s.size || 'size varies'}, ${s.shape || ''} shape, ${s.surface || ''} surface, ${s.colorPattern || ''} pattern` +
    (s.spireHeight && s.spireHeight !== 'none' ? `, ${s.spireHeight} spire` : '') +
    (s.aperture && s.aperture !== 'none' ? `, ${s.aperture} aperture` : '') + '. ' + (s.desc || '');
}

async function deciderSpecies({ imageB64, mediaType, model, classProbs }) {
  const started = Date.now();
  try {
    // Hierarchical: species from the top two classes by probability (plus any class above 0.15).
    const ranked = Object.entries(classProbs || {}).filter(([k]) => CLASS_TO_TYPE[k]).sort((x, y) => y[1] - x[1]);
    const keep = new Set(ranked.filter(([, p], i) => i < 2 || p >= 0.15).map(([k]) => CLASS_TO_TYPE[k]));
    const pool = catalog.species.filter(s => keep.has(s.type));
    if (pool.length < 2) return { error: 'no species pool', ms: Date.now() - started };
    const criteria = {};
    for (const s of pool) criteria['id_' + s.id] = speciesCriterion(s);
    const image = { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageB64}` } };
    const out = await postDecision(model, ['Photo of a beach find from the Southwest Florida Gulf coast:', image], {
      species: { type: 'choice', instructions: 'Which catalog species is the specimen in the photo? Judge shape, sculpture, spire and aperture before colour.', criteria }
    }, 12000);
    const ans = (out.answers || {}).species;
    if (!ans || !ans.probabilities) return { error: 'no species answer', ms: Date.now() - started };
    const probs = {};
    for (const [k, p] of Object.entries(ans.probabilities)) probs[Number(k.replace('id_', ''))] = p;
    return { model: out.model || model, probabilities: probs, confidence: ans.confidence, pool: pool.length, cost_usd: out.usage && out.usage.cost, ms: Date.now() - started };
  } catch (e) {
    console.warn('[DECIDER] species failed:', e.message);
    return { error: e.message, ms: Date.now() - started };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Merge Claude + decider into ranked candidates, a badge and a legacy result
// ─────────────────────────────────────────────────────────────────────────
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function badgeFor({ p1, p2, apertureVisible, agree, isShell }) {
  if (!isShell) return 'Low';
  const ratio = p2 > 0 ? p1 / p2 : 99;
  let level = 'Low';
  if (p1 >= 0.70 && ratio >= 2.5 && apertureVisible !== false) level = 'High';
  else if (p1 >= 0.40 || ratio >= 1.8) level = 'Medium';
  if (agree && level === 'Medium' && p1 >= 0.55 && apertureVisible !== false) level = 'High';
  if (agree === false && level === 'High') level = 'Medium';
  return level;
}

function mergeResults({ claude, gate, species, opinionTop = null, opinionStrength = 'none' }) {
  const c = claude.parsed;
  const apertureVisibleClaude = c.observed && c.observed.aperture_visible;
  const apertureVisible = (gate && typeof gate.aperture_visible === 'number') ? (gate.aperture_visible >= 0.5) : apertureVisibleClaude;
  const jevSaysNotSpecimen = gate && typeof gate.is_specimen === 'number' && gate.is_specimen < 0.5;
  const isShell = !!c.is_shell && !jevSaysNotSpecimen;

  // Claude candidates, normalised to known ids, capped at 70 when the aperture is hidden
  const claudeCands = (c.candidates || []).filter(k => catalog.byId.has(k.id)).slice(0, 3).map(k => ({
    id: k.id, p_claude: clamp(Number(k.confidence) || 0, 0, 100) / 100, why: Array.isArray(k.why) ? k.why.slice(0, 4) : []
  }));
  if (apertureVisible === false) for (const k of claudeCands) k.p_claude = Math.min(k.p_claude, 0.70);

  const jevProbs = species && species.probabilities ? species.probabilities : null;
  const ids = new Set(claudeCands.map(k => k.id));
  if (jevProbs) Object.entries(jevProbs).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([id]) => ids.add(Number(id)));

  const merged = [...ids].map(id => {
    const ck = claudeCands.find(k => k.id === id);
    const pc = ck ? ck.p_claude : 0;
    const pj = jevProbs ? (jevProbs[id] || 0) : null;
    const score = pj === null ? pc : (0.6 * pj + 0.4 * pc);
    return { id, p_claude: pc, p_jev: pj, score, why: ck ? ck.why : [] };
  }).sort((a, b) => b.score - a.score).slice(0, 3);

  // Second opinion (Phase 3a.3): agreement with Claude's first choice counts like Jev agreement
  // for the badge, and a strong agreeing opinion lifts the score a little (never past the
  // hidden-aperture cap). Disagreement only blocks High; it does not reorder anything here,
  // because the hint already had its say inside Claude's reasoning.
  let agree = jevProbs && claudeCands[0] ? (Object.entries(jevProbs).sort((a, b) => b[1] - a[1])[0][0] == claudeCands[0].id) : null;
  if (agree === null && opinionTop && merged[0] && (opinionStrength === 'strong' || opinionStrength === 'moderate')) {
    agree = merged[0].id === opinionTop;
    if (agree && opinionStrength === 'strong') merged[0].score = Math.min(apertureVisible === false ? 0.70 : 0.90, merged[0].score + 0.15);
  }
  const p1 = merged[0] ? merged[0].score : 0;
  const p2 = merged[1] ? merged[1].score : 0;
  const level = badgeFor({ p1, p2, apertureVisible, agree, isShell });

  const candidates = merged.map((m, i) => {
    const rec = catalog.byId.get(m.id);
    return {
      ...rec,
      rank: i + 1,
      confidence: Math.round(m.score * 100),
      p_claude: Math.round(m.p_claude * 100),
      p_jev: m.p_jev === null ? null : Math.round(m.p_jev * 100),
      why: m.why
    };
  });

  return {
    isShell, candidates,
    badge: { level, p1: Math.round(p1 * 100), p2: Math.round(p2 * 100), agree, aperture_visible: apertureVisible },
    observed: c.observed, how_to_distinguish: c.how_to_distinguish, not_in_catalog_guess: c.not_in_catalog_guess,
    narrative: c.narrative, photo_tip: c.photo_tip
  };
}

// Shape old app builds (APK 1.1, pre-Phase-1 web) expect in `result`.
function legacyResult(m) {
  const top = m.candidates[0];
  const n = m.narrative || {};
  if (!m.isShell || !top) {
    return { not_a_shell: true, name: 'Not a shell', scientific: '', confidence: 'Low', description: (m.observed && m.observed.notes) || '' };
  }
  const animalByType = { Gastropod: 'Sea snail (gastropod)', Bivalve: 'Clam-type mollusk (bivalve)', Echinoderm: 'Echinoderm — sea urchin / sand dollar family', Chiton: 'Chiton (eight-plated mollusk)', Scaphopod: 'Tusk shell (scaphopod)' };
  const emojiByType = { Gastropod: '🐌', Bivalve: '🦪' };
  return {
    not_a_shell: false,
    id: top.id, name: top.name, scientific: top.sci, family: top.family || 'Unknown Family', class: top.type || 'Unknown Class',
    animal: n.living_animal || animalByType[top.type] || 'Marine animal', animal_emoji: emojiByType[top.type] || '🐚',
    habitat: top.habitat || 'Gulf Coast beaches', range: top.location || 'SW Florida', rarity: top.rarity || 'Common', size: top.size || 'Varies',
    description: top.desc || '', diet: top.diet || 'Unknown', lifespan: top.lifespan || 'Unknown',
    fun_facts: (n.fun_facts && n.fun_facts.length ? n.fun_facts : (top.fact ? [top.fact] : [])).slice(0, 3),
    historical_uses: n.historical_uses || '', ecological_role: n.ecological_role || '',
    gulf_america_notes: n.gulf_notes || top.gulf || '', best_gulf_beaches: top.location ? [top.location] : [],
    collecting_tip: n.collecting_tip || top.tip || '', florida_found: true, protected: false,
    confidence: m.badge.level,
    why_identified: top.why || [],
    similar_species: m.candidates.slice(1).map(k => ({ name: k.name, how_to_distinguish: m.how_to_distinguish || '' })),
    condition: (m.observed && m.observed.condition) || 'Unknown',
    reference_image: top.imagePath || null
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────
function makeHandler({ recordScan }) {
  return async function identifyHandler(req, res) {
    const started = Date.now();
    try {
      const { image_b64, region } = req.body || {};
      let mediaType = (req.body && req.body.media_type) || 'image/jpeg';
      if (!image_b64 || typeof image_b64 !== 'string') return res.status(400).json({ error: 'image_b64 is required', charged: false });
      if (!ALLOWED_MEDIA.has(mediaType)) return res.status(400).json({ error: 'media_type must be image/jpeg, image/png or image/webp', charged: false });
      if (image_b64.length > 12 * 1024 * 1024) return res.status(413).json({ error: 'Image too large. Please use a photo under 8 MB.', charged: false });

      const isEval = !!(EVAL_KEY && req.get('x-bcm-eval') === EVAL_KEY);
      const variant = isEval && req.body.variant === 'legacy' ? 'legacy' : 'new';
      const model = (isEval && req.body.model) || MODEL;
      const deciderModel = isEval && typeof req.body.decider === 'string' ? req.body.decider : DECIDER;
      const regionName = region || 'Marco Island';
      const userId = req.user && req.user.userId;

      if (variant === 'legacy') {
        const out = await callClaudeLegacy({ imageB64: image_b64, mediaType, region: regionName, model });
        if (!isEval) recordScan(out.usage, userId, out.model);
        return res.json({ result: out.parsed, variant: 'legacy', model: out.model, usage: out.usage, ms: Date.now() - started });
      }

      // Phase 3a: Google Web Detection first (when on), mapped to catalog names, handed to Claude as hints.
      const visionWanted = isEval && typeof req.body.vision === 'string' ? req.body.vision === 'on' : vision.visionDefaultOn();
      const useVision = visionWanted && vision.visionAvailable();
      const opinionModel = isEval && typeof req.body.opinion === 'string' ? (req.body.opinion === 'off' ? null : req.body.opinion) : opinion.opinionDefaultModel();
      const useOpinion = !!opinionModel && opinion.opinionAvailable();
      const [web, op] = await Promise.all([
        useVision ? vision.webDetect({ imageB64: image_b64 }) : Promise.resolve(null),
        useOpinion ? opinion.askOpinion({ imageB64: image_b64, mediaType, model: opinionModel }) : Promise.resolve(null)
      ]);
      const mapped = web && !web.error ? vision.mapToCatalog(web, catalog.species, catalog.version) : null;
      const opMapped = op && !op.error ? opinion.mapOpinion(op, catalog.species, catalog.version) : null;
      const hints = [vision.hintsText(mapped, 'web'), vision.hintsText(opMapped, 'opinion')].filter(Boolean).join('\n\n');

      // Decider only sees jpeg/png (Jev rejects webp). Gate runs in parallel with Claude.
      const useDecider = deciderActive(deciderModel) && (mediaType === 'image/jpeg' || mediaType === 'image/png');
      const gateP = useDecider ? deciderGate({ imageB64: image_b64, mediaType, model: deciderModel }) : Promise.resolve(null);
      const claudeP = callClaudeIdentify({ imageB64: image_b64, mediaType, region: regionName, model, hints });

      const [gate, claude] = await Promise.all([gateP, claudeP]);

      let species = null;
      if (useDecider && gate && !gate.error && gate.shell_class && (gate.is_specimen === null || gate.is_specimen >= 0.5)) {
        species = await deciderSpecies({ imageB64: image_b64, mediaType, model: deciderModel, classProbs: gate.shell_class.probabilities });
      }

      const merged = mergeResults({
        claude, gate: gate && !gate.error ? gate : null, species: species && !species.error ? species : null,
        opinionTop: opMapped && opMapped.candidates[0] ? opMapped.candidates[0].id : null, opinionStrength: opMapped ? opMapped.strength : 'none'
      });
      // Phase 3b: a confident second opinion naming a species the guide does not carry.
      const offGuide = useOpinion ? opinion.offGuide(op, catalog.species, catalog.version,
        merged.candidates[0] ? merged.candidates[0].p_claude : 0, merged.not_in_catalog_guess) : null;
      if (useOpinion) console.log(`[OPINION] model=${opinionModel} used=${!!(op && !op.error)} strength=${opMapped ? opMapped.strength : 'none'} top=${opMapped && opMapped.candidates[0] ? opMapped.candidates[0].name : '-'} agree=${merged.badge.agree} off_guide=${offGuide ? JSON.stringify(offGuide.name) : '-'} ms=${op ? op.ms : 0} cost=${op && op.cost_usd != null ? op.cost_usd.toFixed(4) : '-'}${op && op.error ? ' error=' + JSON.stringify(op.error.slice(0, 80)) : ''}`);
      const result = legacyResult(merged);

      if (!isEval) recordScan(claude.usage, userId, claude.model);
      else console.log(`[EVAL] model=${claude.model} decider=${useDecider ? deciderModel : 'off'} vision=${useVision ? (mapped && mapped.candidates[0] ? mapped.candidates[0].name + '/' + mapped.strength : (web && web.error ? 'error' : 'none')) : 'off'} opinion=${useOpinion ? (opMapped && opMapped.candidates[0] ? opMapped.candidates[0].name + '/' + opMapped.strength : (op && op.error ? 'error' : 'none')) : 'off'} top=${result.name} badge=${merged.badge.level} ms=${Date.now() - started}`);

      res.json({
        result,
        candidates: merged.candidates,
        badge: merged.badge,
        observed: merged.observed,
        how_to_distinguish: merged.how_to_distinguish,
        not_in_catalog_guess: merged.not_in_catalog_guess,
        off_guide: offGuide,
        narrative: merged.narrative,
        photo_tip: merged.photo_tip,
        decider: useDecider ? {
          model: deciderModel, used: !!(gate && !gate.error),
          is_specimen: gate && gate.is_specimen, aperture_visible: gate && gate.aperture_visible, size_reference: gate && gate.size_reference,
          shell_class: gate && gate.shell_class && gate.shell_class.choice, box: gate && gate.box,
          species_pool: species && species.pool, cost_usd: ((gate && gate.cost_usd) || 0) + ((species && species.cost_usd) || 0),
          ms: ((gate && gate.ms) || 0) + ((species && species.ms) || 0), error: (gate && gate.error) || (species && species.error) || null
        } : { model: 'off', used: false },
        vision: useVision ? {
          used: !!(web && !web.error), strength: mapped ? mapped.strength : 'none',
          candidates: mapped ? mapped.candidates : [], unmatched: mapped ? mapped.unmatched : [],
          best_guess: web && web.best_guess ? web.best_guess : [], ms: web ? web.ms : 0, cost_usd: web && !web.error ? vision.COST_USD : 0,
          error: (web && web.error) || null
        } : { used: false },
        opinion: useOpinion ? {
          model: opinionModel, used: !!(op && !op.error), strength: opMapped ? opMapped.strength : 'none',
          names: op && op.names ? op.names.map(n => n.name) : [], not_a_shell: !!(op && op.not_a_shell), confidence: op && op.confidence,
          candidates: opMapped ? opMapped.candidates : [], unmatched: opMapped ? opMapped.unmatched : [],
          ms: op ? op.ms : 0, cost_usd: op && op.cost_usd, error: (op && op.error) || null
        } : { used: false },
        model: claude.model,
        catalog_version: catalog.version,
        usage: claude.usage,
        charged: true,
        ms: Date.now() - started
      });
    } catch (err) {
      console.error('Shell ID error:', err.message);
      if (err.refusal) return res.status(422).json({ error: 'The AI declined to analyze this image. Scan not charged.', refusal: true, charged: false });
      res.status(502).json({ error: 'Could not identify this shell right now. Scan not charged. Try a clearer photo in natural light.', charged: false });
    }
  };
}

function status() {
  return {
    model: MODEL,
    decider: deciderActive(DECIDER) ? DECIDER : 'off',
    vision: { available: vision.visionAvailable(), default: vision.visionDefaultOn() ? 'on' : 'off' },
    opinion: { available: opinion.opinionAvailable(), default: opinion.opinionDefaultModel() || 'off' },
    catalog: { version: catalog.version, species: catalog.species.length, source: catalog.source, loaded_at: catalog.loadedAt, last_error: catalog.lastError }
  };
}

module.exports = { MODEL, priceFor, makeHandler, status, refreshCatalog, _internal: { mergeResults, legacyResult, badgeFor, pipeLine, catalog, OUTPUT_SCHEMA, RULES } };
