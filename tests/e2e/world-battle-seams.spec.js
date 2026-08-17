import { test, expect } from '@playwright/test';
import { collectRuntimeErrors } from './test-helpers.js';

test('world and battle expose ordered simulation seams', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/');
  const result = await page.evaluate(() => {
    window.game.scenario('world', { seed: 42 });
    const world = window.__g.scene;
    const worldPhases = [
      'updateHeroMovement', 'updateSettlementInteractions', 'updateCampInteraction',
      'updateParties', 'updatePartySpawns', 'updateCameraAndEffects',
    ];
    const worldOrder = [];
    for (const name of worldPhases) {
      const original = world[name];
      world[name] = function (...args) {
        worldOrder.push(name);
        return original.apply(this, args);
      };
    }
    window.__g.update(1 / 60);

    window.game.scenario('battle_small');
    const first = window.__g.scene;
    first.state = 'fight';
    first.stateT = 2;
    const battlePhases = [
      'updateCommandPhase', 'updateHeroPhase', 'updateTroopPhase', 'updateEnemyPhase',
      'updateSeparationPhase', 'updateProjectilePhase', 'updateStalematePhase',
      'resolveBattleResult', 'updatePresentationPhase',
    ];
    const battleOrder = [];
    for (const name of battlePhases) {
      const original = first[name];
      first[name] = function (...args) {
        battleOrder.push(name);
        return original.apply(this, args);
      };
    }
    window.__g.update(1 / 60);
    const firstPalette = first.palette;
    const second = new first.constructor(window.__g, {
      troops: [{ type: 'spear' }], enemies: [{ type: 'bandit' }], seed: 99,
      biome: 'night', title: 'ISOLATION', onEnd: () => {},
    });
    return {
      worldPhases: worldPhases.every(name => typeof world[name] === 'function'),
      worldOrder,
      battlePhases: battlePhases.every(name => typeof first[name] === 'function'),
      battleOrder,
      palettesAreDistinct: first.palette !== second.palette,
      palettesFrozen: Object.isFrozen(first.palette) && Object.isFrozen(second.palette),
      firstStableAfterSecond: first.palette.ground === firstPalette.ground,
      biomeChanged: first.palette.ground !== second.palette.ground,
    };
  });

  expect(result).toEqual({
    worldPhases: true,
    worldOrder: [
      'updateHeroMovement', 'updateSettlementInteractions', 'updateCampInteraction',
      'updateParties', 'updatePartySpawns', 'updateCameraAndEffects',
    ],
    battlePhases: true,
    battleOrder: [
      'updateCommandPhase', 'updateHeroPhase', 'updateTroopPhase', 'updateEnemyPhase',
      'updateSeparationPhase', 'updateProjectilePhase', 'updateStalematePhase',
      'resolveBattleResult', 'updatePresentationPhase',
    ],
    palettesAreDistinct: true,
    palettesFrozen: true,
    firstStableAfterSecond: true,
    biomeChanged: true,
  });
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});
