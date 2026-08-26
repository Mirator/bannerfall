// Audio integration. A headless browser cannot judge whether a sword hit SOUNDS right —
// that is the human listening checklist in plans/026-audio-pass.md. What is checkable
// here, and what has actually broken before in games that added audio, is structural:
//
//   * nothing is created or played before a real user gesture (an autoplay violation is a
//     console error, and collectRuntimeErrors fails any test that sees one),
//   * every file the manifest names really exists (a 404 is likewise a console error),
//   * the bus graph is wired master -> {music, sfx} with the documented gains,
//   * the scene-to-bed mapping actually switches, and mute reaches the master gain.
//
// One caveat about this environment: Playwright launches Chromium with the autoplay
// policy relaxed, so a context here reaches `running` immediately and the suspended state
// a real browser starts in never happens by accident. The gate that matters in the field
// is therefore driven explicitly, by suspending the context and asserting nothing starts.
import { test, expect } from '@playwright/test';
import { collectRuntimeErrors, drainRuntimeErrors, assertNoRuntimeErrors, bootToMenu } from './test-helpers.js';

const audioState = page => page.evaluate(() => window.__g.sfx.debugState());

// A real click on the canvas: the cheapest gesture that grants user activation.
async function unlockAudio(page) {
  await page.mouse.click(20, 20);
  await expect.poll(() => page.evaluate(() => window.__g.sfx.debugState().contextState))
    .toBe('running');
}

test('booting creates no audio at all, and the graph appears only on demand', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootToMenu(page);

  const before = await audioState(page);
  expect(before.contextState, 'booting alone must not construct an AudioContext').toBe(null);
  expect(before.enabled).toBe(true);
  expect(before.track, 'the wanted bed is recorded while still silent').toBe('campaign');
  expect(before.playing).toBe(null);

  await unlockAudio(page);
  const after = await audioState(page);
  expect(after.contextState).toBe('running');
  expect(after.masterGain).toBeCloseTo(0.85, 5);
  expect(after.musicGain).toBeCloseTo(0.32, 5);
  expect(after.sfxGain).toBeCloseTo(0.75, 5);

  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(runtimeErrors);
});

// The autoplay gate itself. Playwright's Chromium runs with the autoplay policy relaxed,
// so a suspended context never occurs by accident here and the guard has to be driven
// deliberately — which is the point: a real browser DOES start suspended, and starting a
// bed there is the console error that would fail every spec in this suite at once.
test('no music starts while the context is suspended, and it catches up on resume', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootToMenu(page);

  const whileSuspended = await page.evaluate(async () => {
    const sfx = window.__g.sfx;
    sfx.stopMusic();          // nothing wanted yet, so ensure() starts no bed
    sfx.ensure();             // build the graph, then put it back in the state a real
    await sfx.ctx.suspend();  // browser hands us before the first gesture
    sfx.setTrack('battle');
    sfx.hit();                // a one-shot must be harmless here too: no throw, no queue
    return sfx.debugState();
  });
  expect(whileSuspended.contextState).toBe('suspended');
  expect(whileSuspended.track).toBe('battle');
  expect(whileSuspended.playing, 'a bed may not be started on a suspended context').toBe(null);

  await page.evaluate(() => window.__g.sfx.ctx.resume());
  await expect.poll(() => page.evaluate(() => window.__g.sfx.debugState().playing), { timeout: 15_000 })
    .toBe('battle');

  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(runtimeErrors);
});

test('every file the manifest names is served', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootToMenu(page);
  const files = await page.evaluate(() => window.__g.sfx.debugState().files);
  expect(files.length).toBeGreaterThanOrEqual(20);

  const statuses = await page.evaluate(async names => {
    const out = {};
    for (const name of names) {
      const response = await fetch(new URL('assets/audio/' + name, location.href).href);
      out[name] = response.status;
      await response.arrayBuffer();
    }
    return out;
  }, files);
  for (const [name, status] of Object.entries(statuses)) {
    expect(status, `${name} must be served, not 404`).toBe(200);
  }

  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(runtimeErrors);
});

test('the whole sfx set decodes and one-shots reach the sfx bus', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootToMenu(page);
  await unlockAudio(page);

  await expect.poll(() => page.evaluate(() => window.__g.sfx.debugState().sfxReady), { timeout: 10_000 })
    .toBe(true);
  const state = await audioState(page);
  expect(state.decoded, 'every sfx clip decodes; none may be silently missing')
    .toEqual(expect.arrayContaining(state.sfxFiles));
  expect(state.loadError).toBe(null);

  // Every named event, including the whole horn pitch range the call sites use, must
  // actually find a buffer and start a voice. play() returns false when it cannot.
  const played = await page.evaluate(() => {
    const sfx = window.__g.sfx;
    const out = {};
    // The public wrappers, not play() — those names are what world/ and battle/ call.
    for (const name of ['swing', 'hit', 'kill', 'hurt', 'dash', 'bow', 'brute', 'coin',
      'gallop', 'uiMove', 'uiSelect', 'victory', 'defeat']) {
      sfx.lastAt = {}; // clear the rate limiter so a throttle cannot read as a failure
      out[name] = sfx[name]();
    }
    // Every pitch a call site in the game actually passes to horn().
    out.horns = [98, 110, 131, 147, 155, 175, 196, 220, 233, 262, 294].every(freq => {
      sfx.lastAt = {};
      return sfx.horn(freq);
    });
    return out;
  });
  for (const [name, ok] of Object.entries(played)) {
    expect(ok, `${name} must find a decoded clip`).toBe(true);
  }

  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(runtimeErrors);
});

test('scene changes switch the music bed and mute reaches the master gain', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootToMenu(page);
  await unlockAudio(page);

  await expect.poll(() => page.evaluate(() => window.__g.sfx.debugState().playing), { timeout: 15_000 })
    .toBe('campaign');
  expect((await audioState(page)).playingPaused).toBe(false);

  await page.evaluate(() => window.game.scenario('battle_small'));
  await expect.poll(() => page.evaluate(() => window.__g.sfx.debugState().track)).toBe('battle');
  await expect.poll(() => page.evaluate(() => window.__g.sfx.debugState().playing), { timeout: 15_000 })
    .toBe('battle');

  // Back to the map: the campaign bed returns rather than the battle bed running on.
  await page.evaluate(() => window.game.scenario('world', { seed: 4242 }));
  await expect.poll(() => page.evaluate(() => window.__g.sfx.debugState().playing), { timeout: 15_000 })
    .toBe('campaign');

  // The victory summary carries its own fanfare, so the bed is dropped there.
  await page.evaluate(() => window.game.scenario('victory_summary'));
  await expect.poll(() => page.evaluate(() => window.__g.sfx.debugState().track)).toBe(null);
  await expect.poll(() => page.evaluate(() => window.__g.sfx.debugState().playing), { timeout: 15_000 })
    .toBe(null);

  const muted = await page.evaluate(async () => {
    await window.__g.sfx.setMuted(true);
    const on = window.__g.sfx.debugState().masterGain;
    await window.__g.sfx.setMuted(false);
    return { on, off: window.__g.sfx.debugState().masterGain };
  });
  expect(muted.on).toBe(0);
  expect(muted.off).toBeCloseTo(0.85, 5);

  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(runtimeErrors);
});

test('music and sfx buses are independently controllable', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootToMenu(page);
  await unlockAudio(page);

  const gains = await page.evaluate(() => {
    const sfx = window.__g.sfx;
    sfx.setMusicVolume(0);
    sfx.setSfxVolume(0.5);
    const quietMusic = sfx.debugState();
    sfx.setMusicVolume(2);       // clamped
    sfx.setSfxVolume(-1);        // clamped
    const clamped = sfx.debugState();
    return {
      music: quietMusic.musicGain, sfx: quietMusic.sfxGain,
      clampedMusic: clamped.musicGain, clampedSfx: clamped.sfxGain,
      master: clamped.masterGain,
    };
  });
  // AudioParam values are float32, so exact equality on 0.85 is not available.
  expect(gains.music).toBe(0);
  expect(gains.sfx).toBeCloseTo(0.5, 5);
  expect(gains.clampedMusic).toBe(1);
  expect(gains.clampedSfx).toBe(0);
  expect(gains.master).toBeCloseTo(0.85, 5);

  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(runtimeErrors);
});
