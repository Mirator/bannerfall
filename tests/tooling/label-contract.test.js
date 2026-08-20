// The prose labels on the hover panel, the pre-battle brief and the post-battle aftermath
// are derived from UNIT_TYPES/ENEMY_TYPES rather than hand-copied, so that adding a unit or
// enemy type cannot silently drop it out of a breakdown or a casualty list. Nothing in the
// browser suite pins that: the aftermath e2e test only asserts the rows are an array. These
// checks are the pin — they run in plain node because the world-screens model builders are
// pure functions over plain data.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UNIT_TYPES, ENEMY_TYPES } from '../../src/data.js';
import { buildAftermathModel, buildBriefModel } from '../../src/world-screens.js';
import { SQUAD_LABELS } from '../../src/battle/constants.js';

const UNIT_KEYS = Object.keys(UNIT_TYPES);
const ENEMY_KEYS = Object.keys(ENEMY_TYPES);

const rowText = rows => rows.map(r => `${r.count} ${r.label}`).join(', ');
const repeat = (keys, n) => keys.flatMap(k => Array.from({ length: n }, () => k));

test('every unit and enemy type declares the name and plural labels are derived from', () => {
  for (const [key, d] of [...Object.entries(UNIT_TYPES), ...Object.entries(ENEMY_TYPES)]) {
    assert.ok(typeof d.name === 'string' && d.name.length > 0, `${key} is missing name`);
    assert.ok(typeof d.plural === 'string' && d.plural.length > 0, `${key} is missing plural`);
    // plurals are declared, not derived, precisely because 'spearmen'/'wolves' are irregular
    assert.notEqual(d.plural, d.name.toLowerCase(), `${key}'s plural duplicates its singular`);
  }
});

test('casualty rows cover every type and follow the declared table order', () => {
  const model = buildAftermathModel({
    victory: true,
    deadTypes: repeat(ENEMY_KEYS, 1),
    preTroopTypes: repeat(UNIT_KEYS, 1),
    survivorTypes: [],
    loot: 0, heroHp: 1, heroMaxHp: 1,
  });
  // Declared order, not the order the dead happen to arrive in: every enemy list in the
  // game reads bandit, raider, brute, wolf, so the aftermath must too.
  assert.equal(rowText(model.enemyLosses), ENEMY_KEYS.map(k => `1 ${ENEMY_TYPES[k].name.toLowerCase()}`).join(', '));
  assert.equal(rowText(model.playerLosses), UNIT_KEYS.map(k => `1 ${UNIT_TYPES[k].name.toLowerCase()}`).join(', '));
});

test('a count above one uses the declared plural on both sides', () => {
  const model = buildAftermathModel({
    victory: false,
    deadTypes: repeat(ENEMY_KEYS, 2),
    preTroopTypes: repeat(UNIT_KEYS, 2),
    survivorTypes: [],
    loot: 0, heroHp: 0, heroMaxHp: 1,
  });
  assert.equal(rowText(model.enemyLosses), ENEMY_KEYS.map(k => `2 ${ENEMY_TYPES[k].plural}`).join(', '));
  assert.equal(rowText(model.playerLosses), UNIT_KEYS.map(k => `2 ${UNIT_TYPES[k].plural}`).join(', '));
});

test('the brief roster names every type present, in declared order', () => {
  const model = buildBriefModel(
    { title: 'RAID', comp: repeat(ENEMY_KEYS, 1) },
    { troops: UNIT_KEYS.map(type => ({ type })) },
  );
  assert.equal(model.enemy.roster, ENEMY_KEYS.map(k => `1 ${ENEMY_TYPES[k].name.toLowerCase()}`).join(', '));
  assert.equal(model.enemy.bodies, ENEMY_KEYS.length);
  // The player's roster deliberately speaks a different register: squad banners (SPEARS,
  // BOWS, HORSE), not prose bodies. Pinned so the two vocabularies stay distinct on purpose.
  assert.equal(model.player.roster, UNIT_KEYS.map(k => `1 ${SQUAD_LABELS[k]}`).join(', '));
  assert.equal(model.player.strength, 3 + UNIT_KEYS.length + 1); // hero counts 3, knight 2
});

test('an unrecognised type is counted rather than dropped or crashing', () => {
  // Defensive: countByType tolerates a stray type string (an old save, a new type added to
  // one table but not the other). It must not throw, and must not corrupt the known rows.
  const model = buildAftermathModel({
    victory: true,
    deadTypes: [...repeat(ENEMY_KEYS, 1), 'ghoul'],
    preTroopTypes: [], survivorTypes: [],
    loot: 0, heroHp: 1, heroMaxHp: 1,
  });
  assert.equal(model.enemyLosses.length, ENEMY_KEYS.length);
  assert.equal(rowText(model.enemyLosses), ENEMY_KEYS.map(k => `1 ${ENEMY_TYPES[k].name.toLowerCase()}`).join(', '));
});
