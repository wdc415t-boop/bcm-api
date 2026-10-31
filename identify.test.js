// node --test identify.test.js — the identify handler end to end with stubbed Claude and second-opinion
// responses (no network). Added after the 2026-10-31 outage: a log line read a const before it was
// defined and every scan returned 502. This would have caught it.
'use strict';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.BCM_OPINION = 'google/test-model';
const test = require('node:test');
const assert = require('node:assert');

const claudeJson = (cands, guess) => ({
  observed: { shape: '', sculpture: '', spire: '', aperture_visible: true, aperture: '', color_pattern: '', size_estimate: '', size_reference: false, condition: 'Whole', notes: '' },
  is_shell: true, candidates: cands, not_in_catalog_guess: guess, how_to_distinguish: '',
  narrative: { living_animal: '', ecological_role: '', historical_uses: '', fun_facts: [], collecting_tip: '', gulf_notes: '' }, photo_tip: ''
});
function stubFetch({ opinion, claude }) {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('openrouter')) return { ok: true, json: async () => ({ model: 'google/test-model', choices: [{ message: { content: JSON.stringify(opinion) } }], usage: { cost: 0.004 } }) };
    if (u.includes('anthropic')) return { ok: true, json: async () => ({ model: 'claude-test', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify(claude) }] }) };
    return { ok: false, status: 404, text: async () => 'stub: no such host' };
  };
}
function run(handler, body) {
  return new Promise(resolve => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } };
    handler({ body, get: () => '', user: null }, res);
  });
}

const identify = require('./identify');
const handler = identify.makeHandler({ recordScan: () => {} });
const req = { image_b64: 'QUJD', media_type: 'image/jpeg', region: 'Marco Island' };

test('species outside the guide → off_guide block, guide candidates kept', async () => {
  stubFetch({
    opinion: { not_a_shell: false, common_name: 'Paper Fig', scientific_name: 'Ficus communis', confidence: 90, alternatives: [], gulf_coast: true, reason: 'fig-shaped' },
    claude: claudeJson([{ id: 9, confidence: 40, why: ['x'] }, { id: 10, confidence: 20, why: [] }, { id: 1, confidence: 10, why: [] }], 'Paper fig')
  });
  const r = await run(handler, req);
  assert.equal(r.code, 200);
  assert.equal(r.body.off_guide && r.body.off_guide.name, 'Paper Fig');
  assert.equal(r.body.candidates.length, 3);
  assert.equal(r.body.result.name, 'True Tulip', 'legacy result still the best guide species for old app builds');
  assert.equal(r.body.opinion.used, true);
});

test('guide species named by the opinion → no off_guide, agreement lifts score', async () => {
  stubFetch({
    opinion: { not_a_shell: false, common_name: 'Pear Whelk', scientific_name: 'Fulguropsis spirata', confidence: 96, alternatives: [], gulf_coast: true, reason: 'pear' },
    claude: claudeJson([{ id: 16, confidence: 50, why: ['x'] }, { id: 9, confidence: 30, why: [] }, { id: 1, confidence: 20, why: [] }], null)
  });
  const r = await run(handler, req);
  assert.equal(r.code, 200);
  assert.equal(r.body.off_guide, null);
  assert.equal(r.body.candidates[0].id, 16);
  assert.ok(r.body.candidates[0].confidence > 50, 'strong agreeing opinion adds to the score');
  assert.equal(r.body.badge.agree, true);
});

test('second opinion failure never breaks the scan', async () => {
  stubFetch({ opinion: 'not json at all', claude: claudeJson([{ id: 2, confidence: 80, why: ['x'] }, { id: 56, confidence: 10, why: [] }, { id: 57, confidence: 5, why: [] }], null) });
  global.fetch = (orig => async (url) => String(url).includes('openrouter') ? { ok: false, status: 500, text: async () => 'boom' } : orig(url))(global.fetch);
  const r = await run(handler, req);
  assert.equal(r.code, 200);
  assert.equal(r.body.result.name, 'Fighting Conch');
  assert.equal(r.body.opinion.used, false);
  assert.ok(r.body.opinion.error);
});
