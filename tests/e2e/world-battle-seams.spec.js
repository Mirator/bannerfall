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

    window.game.scenario('battle_small');
    const first = window.__g.scene;
    const firstPalette = first.palette;
    const second = new first.constructor(window.__g, {
      troops: [{ type: 'spear' }], enemies: [{ type: 'bandit' }], seed: 99,
      biome: 'night', title: 'ISOLATION', onEnd: () => {},
    });
    const battlePhases = [
      'updateSceneState', 'updateActivePhases', 'updateCommandPhase',
      'updateProjectilePhase', 'resolveBattleResult',
    ];
    return {
      worldPhases: worldPhases.every(name => typeof world[name] === 'function'),
      battlePhases: battlePhases.every(name => typeof first[name] === 'function'),
      palettesAreDistinct: first.palette !== second.palette,
      palettesFrozen: Object.isFrozen(first.palette) && Object.isFrozen(second.palette),
      firstStableAfterSecond: first.palette.ground === firstPalette.ground,
      biomeChanged: first.palette.ground !== second.palette.ground,
    };
  });

  expect(result).toEqual({
    worldPhases: true,
    battlePhases: true,
    palettesAreDistinct: true,
    palettesFrozen: true,
    firstStableAfterSecond: true,
    biomeChanged: true,
  });
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});
