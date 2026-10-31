/**
 * vision.js — Google Cloud Vision Web Detection as a candidate finder (Phase 3a, 2026-10-30)
 * ─────────────────────────────────────────────────────────────────────────
 * Why: the identifier reasons from a text catalog and misses shape-driven look-alikes
 * (a whole adult Pear Whelk went 0 for 6 against True Tulip / Lightning Whelk). Google's
 * Web Detection — the engine behind Lens — matches the photo against indexed images and
 * returns the names the matching pages use. We map those names to catalog species and hand
 * them to Claude as hints from a second observer. Claude still decides and explains.
 *
 * Env:
 *   GOOGLE_VISION_API_KEY   the key; without it every call returns null and nothing changes
 *   BCM_VISION              'off' (default) | 'on'. Eval requests may pass {vision:'on'|'off'}.
 *
 * Cost: Web Detection is $3.50 per 1,000 images after the free 1,000 a month (2026-10 list).
 * Every function here returns null / empty on failure; the identifier must never depend on it.
 */
'use strict';

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';
const API_KEY = process.env.GOOGLE_VISION_API_KEY || '';
const MODE = (process.env.BCM_VISION || 'off').trim().toLowerCase();
const COST_USD = 0.0035;

function visionAvailable() { return !!API_KEY; }
function visionDefaultOn() { return visionAvailable() && MODE === 'on'; }

function scrubKey(msg) { return String(msg || '').replace(/key=[A-Za-z0-9_\-]+/g, 'key=***'); }

// ─────────────────────────────────────────────────────────────────────────
// Web Detection call
// ─────────────────────────────────────────────────────────────────────────
async function webDetect({ imageB64, timeoutMs = 8000 }) {
  if (!API_KEY) return null;
  const started = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${VISION_URL}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: imageB64 }, features: [{ type: 'WEB_DETECTION', maxResults: 20 }] }] }),
      signal: ctl.signal
    });
    if (!r.ok) throw new Error('vision HTTP ' + r.status + ' ' + scrubKey((await r.text()).slice(0, 200)));
    const data = await r.json();
    const resp = (data.responses || [])[0] || {};
    if (resp.error) throw new Error('vision error ' + scrubKey(resp.error.message || ''));
    const web = resp.webDetection || {};
    return {
      entities: (web.webEntities || []).filter(e => e.description).map(e => ({ name: e.description, score: Number(e.score) || 0 })),
      best_guess: (web.bestGuessLabels || []).map(b => b.label).filter(Boolean),
      page_titles: (web.pagesWithMatchingImages || []).map(p => p.pageTitle || '').filter(Boolean),
      full_matches: (web.fullMatchingImages || []).length,
      partial_matches: (web.partialMatchingImages || []).length,
      similar: (web.visuallySimilarImages || []).length,
      ms: Date.now() - started
    };
  } catch (e) {
    console.warn('[VISION] web detection failed:', scrubKey(e.message));
    return { error: scrubKey(e.message), ms: Date.now() - started };
  } finally { clearTimeout(t); }
}

// ─────────────────────────────────────────────────────────────────────────
// Name mapping: web names → catalog species
// ─────────────────────────────────────────────────────────────────────────
// Older or alternative names the web still uses for catalog species. Keyed by catalog id.
// Common names here are in addition to the catalog name; scientific synonyms are the
// names you meet on iNaturalist, WoRMS, Etsy and museum pages.
const SYNONYMS = {
  1:  ['Busycon sinistrum', 'Busycon contrarium', 'Busycon perversum', 'Sinistrofulgur perversum', 'left-handed whelk', 'left handed whelk'],
  2:  ['Strombus alatus', 'Florida fighting conch'],
  3:  ['Pleuroploca gigantea', 'Triplofusus papillosus', 'Florida horse conch'],
  4:  ['Scaphella junonia', 'junonia volute'],
  5:  ['Nodipecten nodosus', 'Lyropecten nodosus', 'lion paw scallop', "lion's paw scallop"],
  6:  ['Conus spurius', 'Conus spurius atlanticus'],
  7:  ['Oliva sayana', 'Americoliva sayana'],
  8:  ['Terebra dislocata', 'Hastula dislocata', 'eastern auger', 'common American auger'],
  9:  ['Fasciolaria tulipa', 'tulip snail'],
  10: ['Fasciolaria lilium', 'Fasciolaria hunteria', 'Cinctura hunteria', 'Cinctura lilium hunteria'],
  11: ['Cyrtopleura costata', 'angel wing clam', 'angelwing'],
  12: ['Argopecten gibbus'],
  13: ['Semicassis granulata', 'Phalium granulatum', 'Semicassis granulatum'],
  14: ['Melongena corona', 'Florida crown conch', 'king crown conch'],
  15: ['Plicatula gibbosa', 'kitten paw', "kitten's paw clam", 'kittens paw'],
  16: ['Busycon spiratum', 'Busycotypus spiratus', 'Fulguropsis spirata', 'Busycon spiratus', 'Busycotypus spiratum', 'Fulguropsis spiratum', 'fig whelk'],
  17: ['Busycon carica', 'knobbed whelk'],
  18: ['Macrocallista nimbosa', 'sunray venus clam', 'sun ray venus'],
  19: ['Dinocardium robustum', 'giant heart cockle', 'Atlantic giant cockle', 'giant cockle'],
  20: ['Trachycardium muricatum', 'Dallocardia muricata', 'yellow prickly cockle'],
  21: ['Laevicardium laevigatum', 'common egg cockle'],
  22: ['Chione elevata', 'Chione cancellata', 'cross barred venus'],
  23: ['Macrocallista maculata', 'calico clam', 'spotted venus'],
  24: ['Mellita quinquiesperforata', 'keyhole sand dollar', 'five-holed keyhole urchin', 'Mellita tenuis'],
  25: ['Donax variabilis', 'coquina clam', 'variable coquina', 'butterfly shell'],
  26: ['Phyllonotus pomum', 'Chicoreus pomum', 'Murex pomum'],
  27: ['Chicoreus dilectus', 'Chicoreus florifer', 'Chicoreus florifer dilectus', 'Murex florifer'],
  28: ['Hexaplex fulvescens', 'Muricanthus fulvescens', 'giant eastern murex'],
  29: ['Vokesimurex rubidus', 'Murex rubidus'],
  30: ['Conus floridanus', 'Conus anabathrum', 'Conasprella floridana'],
  31: ['Busycon coarctatum', 'turnip whelk'],
  32: ['Busycon carica eliceans', 'Busycon eliceans', "Kiener's whelk"],
  33: ['Gemophos auritulus', 'Cantharus auritulus', 'Pisania auritula'],
  34: ['Gemophos tinctus', 'Cantharus tinctus', 'Pollia tincta', 'Pisania tincta'],
  35: ['Stramonita haemastoma', 'Thais haemastoma', 'Florida rock snail', 'southern oyster drill', 'rock shell'],
  36: ['Eupleura caudata', 'thick lip drill', 'thick-lip drill'],
  37: ['Eupleura tampaensis', 'Eupleura sulcidentata'],
  40: ['Conus mus'],
  43: ['Erosaria acicularis', 'Naria acicularis', 'Cypraea acicularis', 'Atlantic yellow cowry'],
  44: ['Pusula pediculus', 'Trivia pediculus', 'coffee bean trivia', 'coffee-bean trivia'],
  46: ['Polinices hepaticus', 'Polinices lacteus', 'brown moon shell'],
  47: ['Sinum perspectivum', 'baby ear', "baby's ear", 'white baby-ear'],
  48: ['Neverita duplicata', 'Polinices duplicatus', 'shark eye', "shark's eye", 'sharkeye', 'shark eye moon snail', 'Atlantic moon snail', 'moon snail'],
  49: ['Diodora cayenensis', 'cayenne keyhole limpet'],
  51: ['Crepidula maculosa', 'spotted slipper snail', 'slipper shell', 'slipper snail', 'Crepidula fornicata'],
  53: ['Lithopoma americanum', 'Astralium americanum', 'American star snail'],
  56: ['Macrostrombus costatus', 'Strombus costatus', 'Lobatus costatus'],
  57: ['Lobatus gallus', 'Strombus gallus', 'Aliger gallus'],
  58: ['Turritella exoleta', 'turret shell', 'turritella'],
  66: ['Nerita tessellata', 'checkered nerite', 'tessellate nerite'],
  67: ['Neritina reclivata', 'Vitta usnea', 'olive nerite'],
  71: ['Cancellaria reticulata', 'common nutmeg', 'nutmeg shell', 'nutmeg snail'],
  72: ['Vasum muricatum', 'Caribbean vase', 'vase shell'],
  73: ['Voluta musica'],
  74: ['Leucozonia nassa', 'chestnut latirus'],
  75: ['Vermicularia spirata', 'West Indian worm snail', 'Florida worm shell', 'Vermicularia knorrii'],
  76: ['Nerita peloronta', 'bleeding tooth nerite', 'bleeding tooth'],
  79: ['Euvola ziczac', 'Pecten ziczac', 'zigzag scallop'],
  83: ['Tellina similis', 'Laciolina similis', 'candystick tellin', 'candy-stick tellin'],
  94: ['Ischadium recurvum', 'hooked mussel', 'bent mussel'],
  97: ['Ensis minor', 'Ensis megistus', 'jackknife clam', 'razor clam'],
  99: ['Carditamera floridana', 'broad ribbed cardita', 'Florida cardita'],
  103: ['Divaricella quadrisulcata', 'Divalinga quadrisulcata', 'cross hatched lucine'],
  104: ['Phacoides pectinatus', 'Lucina pectinata', 'thick lucina', 'comb lucine'],
  113: ['Eurytellina angulosa', 'Tellina angulosa', 'rose petal tellin', 'rose tellin'],
  117: ['Dentalium laqueatum', 'reticulate tusk', 'tusk shell'],
  118: ['Graptacme eborea', 'Dentalium eboreum', 'ivory tusk'],
  119: ['Encope michelini', 'Encope aberrans', "Michelin's sand dollar", 'notched sand dollar'],
  120: ['Clypeaster rosaceus', 'inflated sea biscuit', 'sea biscuit urchin'],
  121: ['Moira atropos', 'mud heart urchin'],
  122: ['Diadema antillarum', 'long spined sea urchin', 'long-spined urchin', 'black sea urchin'],
};

// Words that are shell talk but no evidence for any one species.
const GENERIC = new Set(['seashell', 'sea shell', 'shell', 'shells', 'seashells', 'sea shells', 'conch', 'whelk', 'snail', 'sea snail',
  'gastropod', 'gastropoda', 'mollusc', 'mollusk', 'mollusca', 'bivalve', 'bivalvia', 'clam', 'scallop', 'cockle', 'murex', 'olive',
  'cone snail', 'cone', 'cowrie', 'cowry', 'beach', 'sand', 'ocean', 'sea', 'nature', 'marine biology', 'invertebrate',
  'spiral', 'shellfish', 'oyster', 'mussel', 'tulip', 'sand dollar', 'urchin', 'sea urchin', 'fossil', 'rock', 'stone', 'pebble']);

function plain(s) { return String(s || '').toLowerCase().replace(/[’'\-–—_/(),.:;!?"]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function isGeneric(s) { return GENERIC.has(plain(s)) || GENERIC.has(norm(s)); }

function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[’']s\b/g, '')          // kitten's → kitten
    .replace(/[’'\-–—_/(),.:;!?"]+/g, ' ')
    .replace(/\b(sea ?shell|seashell|shell|shells)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

let nameIndex = null; // [{id, key, kind}] built once per catalog version
let nameIndexVersion = null;

function buildIndex(species, version) {
  const idx = [];
  for (const s of species) {
    const add = (key, kind) => { const k = norm(key); if (k && k.length >= 4) idx.push({ id: s.id, key: k, kind }); };
    add(s.name, 'name');
    if (s.sci) {
      add(s.sci.replace(/\s*\(.*?\)\s*/g, ' '), 'sci');
      add(s.sci.split(/\s+/)[0], 'genus');
    }
    for (const alt of SYNONYMS[s.id] || []) {
      const isSci = /^[A-Z][a-z]+ [a-z]+/.test(alt);
      add(alt, isSci ? 'sci' : 'name');
      if (isSci) add(alt.split(/\s+/)[0], 'genus');
    }
  }
  nameIndex = idx; nameIndexVersion = version;
}

function containsWord(text, key) {
  const i = text.indexOf(key);
  if (i < 0) return false;
  const before = i === 0 ? ' ' : text[i - 1];
  const after = i + key.length >= text.length ? ' ' : text[i + key.length];
  // allow a trailing plural "s"
  return /[^a-z]/.test(before) && (/[^a-z]/.test(after) || (after === 's' && (i + key.length + 1 >= text.length || /[^a-z]/.test(text[i + key.length + 1]))));
}

/** Species-level matches in one text. Longest name wins when one name contains another. */
function matchText(text) {
  const t = norm(text);
  if (!t) return { species: [], genus: [] };
  const hits = nameIndex.filter(e => e.kind !== 'genus' && containsWord(t, e.key));
  const species = [];
  for (const h of hits) {
    if (hits.some(o => o.id !== h.id && o.key !== h.key && o.key.includes(h.key))) continue; // "sand dollar" inside "arrowhead sand dollar"
    if (!species.some(x => x.id === h.id)) species.push({ id: h.id, via: h.key, kind: h.kind });
  }
  const genus = species.length ? [] : nameIndex.filter(e => e.kind === 'genus' && containsWord(t, e.key)).map(e => e.id);
  return { species, genus: [...new Set(genus)] };
}

/** Does this text look like a species name we do not carry? */
function looksLikeSpeciesName(text) {
  const raw = String(text || '').trim();
  if (isGeneric(raw)) return false;
  if (/^[A-Z][a-z]+ [a-z]+$/.test(raw)) return true;                            // binomial
  return /\b(whelk|conch|cowrie|cowry|cone|murex|olive|tulip|scallop|cockle|clam|venus|tellin|ark|nerite|limpet|moon snail|auger|turban|triton|tun|bonnet|helmet|volute|drill|nutmeg|jingle|oyster|mussel|lucine|periwinkle|cerith|top shell|star shell|slipper|urchin|sand dollar|biscuit|fig|janthina|wentletrap|ceriths?)s?\b/i.test(raw)
    && raw.split(/\s+/).length >= 2;
}

/**
 * Map a webDetect() result onto the catalog.
 * Returns { candidates:[{id,name,score,evidence[]}], unmatched:[{name,score}], generic:[names], strength }
 */
function mapToCatalog(web, species, version) {
  if (!web || web.error || !Array.isArray(species) || !species.length) return null;
  if (!nameIndex || nameIndexVersion !== version) buildIndex(species, version);
  const byId = new Map(species.map(s => [s.id, s]));
  const score = new Map();
  const evidence = new Map();
  const bump = (id, w, why) => {
    score.set(id, (score.get(id) || 0) + w);
    const ev = evidence.get(id) || []; if (ev.length < 4 && !ev.includes(why)) ev.push(why); evidence.set(id, ev);
  };
  const unmatched = new Map();
  const generic = [];

  // 1. Entities: Google's own ranked names. Weight = entity score (typically 0.3–1.5).
  for (const e of web.entities || []) {
    const m = matchText(e.name);
    if (m.species.length) { for (const s of m.species) bump(s.id, Math.min(1.5, e.score || 0.5), `entity "${e.name}"`); }
    else if (m.genus.length) { for (const id of m.genus) bump(id, 0.15 * Math.min(1.5, e.score || 0.5), `genus "${e.name}"`); }
    else if (isGeneric(e.name)) generic.push(e.name);
    else if (looksLikeSpeciesName(e.name)) unmatched.set(e.name, Math.max(unmatched.get(e.name) || 0, e.score || 0.5));
  }
  // 2. Best-guess labels: one or two short phrases Google thinks the picture is.
  for (const b of web.best_guess || []) {
    const m = matchText(b);
    if (m.species.length) for (const s of m.species) bump(s.id, 1.0, `best guess "${b}"`);
    else if (looksLikeSpeciesName(b)) unmatched.set(b, Math.max(unmatched.get(b) || 0, 1.0));
  }
  // 3. Page titles: many weak votes, capped so a single Etsy flood cannot dominate.
  const titleVotes = new Map();
  for (const t of web.page_titles || []) {
    const m = matchText(t);
    for (const s of m.species) titleVotes.set(s.id, (titleVotes.get(s.id) || 0) + 1);
    if (!m.species.length && looksLikeSpeciesName(t) && t.split(/\s+/).length <= 4) unmatched.set(t, Math.max(unmatched.get(t) || 0, 0.3));
  }
  for (const [id, n] of titleVotes) bump(id, Math.min(1.2, 0.3 * n), `${n} matching page title${n > 1 ? 's' : ''}`);

  const candidates = [...score.entries()].map(([id, sc]) => ({ id, name: byId.get(id).name, score: Math.round(sc * 100) / 100, evidence: evidence.get(id) || [] }))
    .sort((a, b) => b.score - a.score).slice(0, 5);
  const un = [...unmatched.entries()].map(([name, sc]) => ({ name, score: Math.round(sc * 100) / 100 })).sort((a, b) => b.score - a.score).slice(0, 3);
  const top = candidates[0] ? candidates[0].score : 0;
  const second = candidates[1] ? candidates[1].score : 0;
  const strength = top >= 1.5 && top >= 2 * second ? 'strong' : top >= 0.6 ? 'moderate' : top > 0 ? 'weak' : 'none';
  return { candidates, unmatched: un, generic: [...new Set(generic)].slice(0, 5), strength };
}

/** The hint block Claude sees. Neutral by design: evidence from a second observer, not an answer. */
function hintsText(mapped, source) {
  if (!mapped || (!mapped.candidates.length && !mapped.unmatched.length)) return '';
  const lines = [];
  if (source === 'opinion') lines.push('SECOND OPINION HINTS. A separate vision model was shown this photo and asked to name the species in free text; its names, mapped onto the catalog, are below. Treat them as evidence from a second observer, not as the answer: that model does not have the catalog or its tells, and it can confuse look-alikes just as you can.');
  else lines.push('VISUAL SEARCH HINTS. An image-matching engine compared this photo against photos on the web and returned the names below, ranked by how strongly the matching pages used each name. Treat them as evidence from a second observer, not as the answer: the names come from web pages, sellers mislabel shells, and the engine does not know which species live on this coast.');
  lines.push('Use them this way: (a) every hinted catalog species must be considered as a candidate and checked against its tells and what is actually visible; (b) when the photo cannot separate look-alikes (opening hidden, worn, juvenile), a strong hint decides the order among them; (c) a hint that a clearly visible structural feature contradicts loses; (d) if the strongest hints name a species that is not in the catalog, put that name in not_in_catalog_guess and keep the catalog candidates\' confidence modest.');
  if (mapped.candidates.length) {
    lines.push(`Hinted catalog species (match strength: ${mapped.strength}):`);
    mapped.candidates.forEach((c, i) => lines.push(`  ${i + 1}. id ${c.id} ${c.name} — score ${c.score} (${c.evidence.join('; ')})`));
  }
  if (mapped.unmatched.length) lines.push('Names returned that match no catalog species: ' + mapped.unmatched.map(u => `"${u.name}"`).join(', ') + '.');
  return lines.join('\n');
}

module.exports = { visionAvailable, visionDefaultOn, webDetect, mapToCatalog, hintsText, COST_USD, _internal: { norm, isGeneric, matchText, looksLikeSpeciesName, buildIndex, SYNONYMS, GENERIC } };
