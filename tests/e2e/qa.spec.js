import { test, expect } from '@playwright/test';
import { collectRuntimeErrors, drainRuntimeErrors } from './test-helpers.js';

const EXPECTED_QA_NAMES = [
  'menu_to_world_on_enter',
  'battle_flow_invariants_and_victory',
  'battle_end_banner_holds_at_least_2s',
  'hero_swing_and_dash_damage_enemies',
  'battle_retreat_hold_disengages',
  'defeat_penalties_via_world_battle',
  'defeat_volunteer_rally_floor_tops_up_to_two',
  'victory_loot_and_survivors_via_world_battle',
  'command_system_and_hold_positions',
  'squad_selection_and_independent_squad_orders',
  'economy_recruit_cost_cap_and_gold_refusals',
  'economy_heal_refusals_and_success_path',
  'economy_army_cap_expansion_and_refusals',
  'world_party_battle_decreases_party_count_by_one',
  'world_camp_raid_razes_camp',
  'world_grace_timer_active_after_battle_then_decays',
  'world_party_weight_stays_in_the_encounter_clamp',
  'world_party_spawn_tiers_weighted_toward_strong',
  'world_party_spawn_timer_fills_the_map_to_its_cap',
  'world_party_break_off_occupies_settlement_and_recapture_restores_service',
  'world_floor_guarantee_prevents_unwinnable_deadlock',
  'determinism_battle_small_seed_reproducible',
  'rng_domains_keep_simulation_independent_of_effects',
  'perf_smoke_200_half_second_steps',
  'world_no_party_freezes_at_rivers',
  'enemy_command_squads_orders_and_stall_override',
  'progression_veterancy_banner_ceiling_and_brace_latch',
];

async function waitForQaResult(page) {
  await page.waitForFunction(() => window.__qaResult && Array.isArray(window.__qaResult.results));
  return page.evaluate(() => window.__qaResult);
}

test('legacy browser QA suite passes all current records', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/tests/runner.html');
  const result = await waitForQaResult(page);
  const failures = result.results.filter(record => !record.ok)
    .map(record => record.name + ': ' + record.detail);

  expect(result.passed, failures.join('\n')).toBe(EXPECTED_QA_NAMES.length);
  expect(result.failed, failures.join('\n')).toBe(0);
  expect(result.results.map(record => record.name)).toEqual(EXPECTED_QA_NAMES);
  await drainRuntimeErrors(page);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('QA preserves a real player save and uses the test slot', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('bf_save');
    localStorage.removeItem('bf_save_test');
  });

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__g && window.__g.menuPanel === 'new');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'world');
  const realSaveRaw = await page.evaluate(async () => {
    const game = window.__g;
    game.scene.save.gold = 9876;
    game.scene.save.stats.playT = 321;
    game.persistRun();
    await game.saves.flush();
    return localStorage.getItem('bf_save');
  });
  expect(realSaveRaw).toBeTruthy();

  await page.goto('/tests/runner.html');
  const result = await waitForQaResult(page);
  expect(result.passed, JSON.stringify(result.results)).toBe(EXPECTED_QA_NAMES.length);
  expect(result.failed, JSON.stringify(result.results)).toBe(0);
  const slots = await page.evaluate(() => ({
    real: JSON.parse(localStorage.getItem('bf_save')),
    test: localStorage.getItem('bf_save_test'),
  }));
  const beforeQa = JSON.parse(realSaveRaw);
  expect(slots.real.gold).toBe(beforeQa.gold);
  expect(slots.real.x).toBe(beforeQa.x);
  expect(slots.real.y).toBe(beforeQa.y);
  expect(slots.real.troops).toEqual(beforeQa.troops);
  expect(slots.real.stats.playT).toBeGreaterThanOrEqual(beforeQa.stats.playT);
  expect(slots.test).toBeTruthy();
  await drainRuntimeErrors(page);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});
