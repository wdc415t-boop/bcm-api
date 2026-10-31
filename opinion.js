/**
 * opinion.js — second-opinion identifier through OpenRouter (Phase 3a.2, 2026-10-31)
 * ─────────────────────────────────────────────────────────────────────────
 * Google's Web Detection API returned only "shell" for a photo Lens named instantly;
 * Lens's answer comes from Google's multimodal model, not from the matching API. So this
 * asks a second vision model (Gemini by default) to name the species in free text, maps
 * the names onto the catalog with vision.js's mapper, and hands them to Claude as hints.
 *
 * Env:
 *   OPENROUTER_API_KEY  already set for the Jev decider
 *   BCM_OPINION         'off' (default) | an OpenRouter model id, e.g. google/gemini-4-argon
 *                       Eval requests may pass {opinion:'<model>'|'off'} per request.
 * Every function returns null on failure; the scan proceeds without hints.
 */
'use strict';
const { mapToCatalog } = require('./vision');

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODE = (process.env.BCM_OPINION || 'off').trim();

function opinionAvailable() { return !!OPENROUTER_API_KEY; }
function opinionDefaultModel() { return opinionAvailable() && MODE && MODE !== 'off' ? MODE : null; }

const PROMPT = `You are a malacologist helping a beachcomber. The photo was taken on a Gulf coast beach in Southwest Florida (Marco Island, Naples, Sanibel area). Identify the seashell or beach specimen to species as precisely as you can, from what is visible.
Reply with JSON only, no prose:
{"not_a_shell": false, "common_name": "...", "scientific_name": "Genus species", "confidence": 0-100, "alternatives": [{"common_name": "...", "scientific_name": "..."}], "reason": "one sentence"}
Use the common names shell collectors use. List up to three other species it could be in alternatives, most likely first. If it is not a shell or beach specimen, set not_a_shell true.`;

async function askOpinion({ imageB64, mediaType, model, timeoutMs = 20000 }) {
  if (!OPENROUTER_API_KEY || !model) return null;
  const started = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENROUTER_API_KEY, 'HTTP-Referer': 'https://beachcombersmania.online', 'X-Title': 'BeachCombersMania' },
      body: JSON.stringify({
        model, max_tokens: 1500, temperature: 0.2, usage: { include: true },
        messages: [{ role: 'user', content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageB64}` } }
        ] }]
      }),
      signal: ctl.signal
    });
    if (!r.ok) throw new Error('opinion HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const data = await r.json();
    const text = (((data.choices || [])[0] || {}).message || {}).content || '';
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('opinion returned no JSON: ' + JSON.stringify(String(text).slice(0, 120)) + (data.choices && data.choices[0] && data.choices[0].finish_reason ? ' finish=' + data.choices[0].finish_reason : ''));
    const j = JSON.parse(m[0]);
    const conf = Math.max(0, Math.min(100, Number(j.confidence) || 50)) / 100;
    const names = [];
    if (j.common_name) names.push({ name: String(j.common_name), score: 0.8 + 0.7 * conf });
    if (j.scientific_name) names.push({ name: String(j.scientific_name), score: 0.8 + 0.7 * conf });
    for (const a of (Array.isArray(j.alternatives) ? j.alternatives : []).slice(0, 3)) {
      if (a && a.common_name) names.push({ name: String(a.common_name), score: 0.45 });
      if (a && a.scientific_name) names.push({ name: String(a.scientific_name), score: 0.45 });
    }
    return {
      model: data.model || model, not_a_shell: !!j.not_a_shell, names, confidence: Math.round(conf * 100), reason: j.reason ? String(j.reason).slice(0, 300) : '',
      cost_usd: data.usage && typeof data.usage.cost === 'number' ? data.usage.cost : null, ms: Date.now() - started
    };
  } catch (e) {
    console.warn('[OPINION] failed:', e.message);
    return { error: e.message, ms: Date.now() - started };
  } finally { clearTimeout(t); }
}

/** Map the opinion's names onto the catalog using the Web Detection mapper. */
function mapOpinion(op, species, version) {
  if (!op || op.error) return null;
  return mapToCatalog({ entities: op.names, best_guess: [], page_titles: [] }, species, version);
}

module.exports = { opinionAvailable, opinionDefaultModel, askOpinion, mapOpinion, PROMPT };
