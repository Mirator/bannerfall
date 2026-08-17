import { test, expect } from '@playwright/test';
import { collectRuntimeErrors } from './test-helpers.js';

const EXPECTED_QA_NAMES = [
  'menu_to_world_on_enter',
  'battle_flow_invariants_and_victory',
  'battle_end_banner_holds_at_least_2s',
  'defeat_penalties_via_world_battle',
  'defeat_volunteer_rally_floor_tops_up_to_two',
  'victory_loot_and_survivors_via_world_battle',
  'command_system_and_hold_positions',
  'economy_recruit_cost_cap_and_gold_refusals',
  'economy_heal_refusals_and_success_path',
  'world_party_battle_decreases_party_count_by_one',
  'world_camp_raid_razes_camp_and_grants_captives',
  'world_camp_raid_captives_capped_at_army_cap',
  'world_grace_timer_active_after_battle_then_decays',
  'world_party_strength_stays_in_2_24_band',
  'determinism_battle_small_seed_reproducible',
  'perf_smoke_200_half_second_steps',
  'world_no_party_freezes_at_rivers',
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
  await page.waitForTimeout(50);
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
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'world');
  const realSaveRaw = await page.evaluate(() => {
    const game = window.__g;
    game.scene.save.gold = 9876;
    game.scene.save.stats.playT = 321;
    game.persistRun();
    return localStorage.getItem('bf_save');
  });
  expect(realSaveRaw).toBeTruthy();

  await page.goto('/tests/runner.html');
  const result = await waitForQaResult(page);
  expect(result.passed, JSON.stringify(result.results)).toBe(EXPECTED_QA_NAMES.length);
  expect(result.failed, JSON.stringify(result.results)).toBe(0);
  const slots = await page.evaluate(() => ({
    real: localStorage.getItem('bf_save'),
    test: localStorage.getItem('bf_save_test'),
  }));
  expect(slots.real).toBe(realSaveRaw);
  expect(slots.test).toBeTruthy();
  await page.waitForTimeout(50);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});
