// node --test vision.test.js — mapping of Google Web Detection names onto the catalog (no network)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vision = require('./vision');
const species = JSON.parse(require('fs').readFileSync(__dirname + '/shell-catalog.json', 'utf8')).species;
const V = 'test';

// Shaped like what Lens showed for Bill's Pear Whelk on 2026-10-30
const pearWhelkWeb = {
  entities: [{ name: 'Pear whelk', score: 1.21 }, { name: 'Busycon spiratum', score: 0.9 }, { name: 'Seashell', score: 0.85 },
             { name: 'Lightning whelk', score: 0.41 }, { name: 'Conch', score: 0.3 }, { name: 'Paper fig', score: 0.35 }],
  best_guess: ['pear whelk shell'],
  page_titles: ['Pear Whelk Sea Shell - Etsy', 'Busycon spiratum 104m Large seashell | WorthPoint', 'Left Handed Lightning Whelk',
                'Is this a paper fig or a pear whelk shell?', 'Shell of the Week: The Royal Bonnet', 'Pear Whelks found on Marco Island'],
  full_matches: 0, partial_matches: 3, similar: 20, ms: 900
};

test('Pear Whelk ranks first, Lightning Whelk second, generic and foreign names handled', () => {
  const m = vision.mapToCatalog(pearWhelkWeb, species, V);
  assert.equal(m.candidates[0].id, 16, 'Pear Whelk first');
  assert.equal(m.candidates[1].id, 1, 'Lightning Whelk second');
  assert.equal(m.strength, 'strong');
  assert.ok(m.generic.includes('Seashell') && m.generic.includes('Conch'));
  assert.ok(m.unmatched.some(u => /paper fig/i.test(u.name)), 'Paper Fig reported as not in catalog');
  assert.ok(!m.candidates.some(c => c.id === 13), 'Royal Bonnet title does not become Scotch Bonnet');
  const text = vision.hintsText(m);
  assert.match(text, /id 16 Pear Whelk/);
  assert.match(text, /not in the catalog/);
});

test('longest name wins and synonyms resolve', () => {
  const { matchText } = vision._internal;
  vision._internal.buildIndex(species, V);
  assert.deepEqual(matchText('Arrowhead Sand Dollar from Sanibel').species.map(s => s.id), [119]);
  assert.deepEqual(matchText('a keyhole sand dollar').species.map(s => s.id), [24]);
  assert.deepEqual(matchText("Kitten's Paw Shell").species.map(s => s.id), [15]);
  assert.deepEqual(matchText('Shark Eye moon snail').species.map(s => s.id), [48]);
  assert.deepEqual(matchText('Sinistrofulgur perversum').species.map(s => s.id), [1]);
  assert.deepEqual(matchText('Fasciolaria hunteria').species.map(s => s.id), [10]);
  assert.deepEqual(matchText('Seashell').species, []);
  assert.ok(matchText('Busycon').genus.includes(17), 'bare genus spreads to its species');
});

test('empty or failed detection maps to null and no hints', () => {
  assert.equal(vision.mapToCatalog({ error: 'vision HTTP 403' }, species, V), null);
  assert.equal(vision.hintsText(null), '');
  const m = vision.mapToCatalog({ entities: [{ name: 'Beach', score: 1 }], best_guess: ['sand'], page_titles: [] }, species, V);
  assert.equal(m.candidates.length, 0);
  assert.equal(m.strength, 'none');
  assert.equal(vision.hintsText(m), '');
});

test('looksLikeSpeciesName', () => {
  const f = vision._internal.looksLikeSpeciesName;
  assert.ok(f('Ficus communis')); assert.ok(f('Paper fig')); assert.ok(f('Hawaiian cowrie'));
  assert.ok(!f('Seashell')); assert.ok(!f('Beach')); assert.ok(!f('shell'));
});
