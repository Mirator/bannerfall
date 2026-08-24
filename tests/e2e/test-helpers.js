// Shared e2e scaffolding. Every spec used to carry its own copy of "goto, wait for the
// menu" and, in the persistence specs, of the whole real-save-slot opening dance; the
// copies had already drifted (one polled the scene, one did not). Boot shape lives here
// so a change to how the game comes up is one edit, not eight.
import { expect } from '@playwright/test';

export function collectRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', error => {
    errors.push('pageerror: ' + (error && error.stack ? error.stack : String(error)));
  });
  page.on('console', message => {
    if (message.type() === 'error') errors.push('console.error: ' + message.text());
  });
  return errors;
}

// `pageerror` and `console` reach the test over the same connection as every other
// protocol message, in the order the page produced them, so a round trip through the page
// delivers everything emitted before it. Call this before asserting the collected list is
// empty. A wall-clock sleep in that spot is not just slower, it is unsound: a sleep shorter
// than delivery latency reports an empty list and the assertion passes with the error still
// in flight.
export async function drainRuntimeErrors(page) {
  await page.evaluate(() => undefined);
}

export function assertNoRuntimeErrors(runtimeErrors) {
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
}

// The menu is the only scene the game boots into, so this is where every spec starts.
export async function bootToMenu(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
}

// Boot with storage wiped, for specs asserting on first-run menu state.
export async function bootFresh(page) {
  await page.addInitScript(() => localStorage.clear());
  await bootToMenu(page);
}

// Boot straight into a seeded world run, polling for the scene swap so the caller can
// read world state in its own evaluate() without racing the scenario switch.
export async function bootWorld(page, { seed }) {
  await bootToMenu(page);
  await page.evaluate(seedValue => window.game.scenario('world', { seed: seedValue }), seed);
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
}

// Open the game the way a player does: the REAL save slot, not testMode. `clearKey` is a
// sessionStorage flag so the slot is wiped exactly once per worker — a reload later in the
// same test must not erase what that test just wrote. Specs bind their own key (see
// campaign-persistence / save-schema) so the two suites cannot clear each other.
export async function openPlayerGame(page, runtimeErrors, clearKey) {
  await bootToMenu(page);
  await page.addInitScript(key => {
    if (sessionStorage.getItem(key) !== '1') {
      localStorage.removeItem('bf_save');
      localStorage.removeItem('bf_save_test');
      sessionStorage.setItem(key, '1');
    }
  }, clearKey);
  await page.reload();
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.evaluate(() => { window.__g.testMode = false; });
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('menu');
  assertNoRuntimeErrors(runtimeErrors);
}
