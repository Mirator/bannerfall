import { test, expect } from '@playwright/test';
import { collectRuntimeErrors, bootWorld } from './test-helpers.js';
import { WORLD } from '../../src/data.js';

const boot = (page, seed = 20260817) => bootWorld(page, { seed });

// Every fixture below reads a live position (a roaming party wanders/chases in real
// time) and immediately acts on it inside ONE page.evaluate() call. Splitting that
// across two round trips would race the live requestAnimationFrame loop, which keeps
// ticking the world in real time even when a test isn't explicitly stepping it.
//
// Aiming the mouse at a world position means placing the mouse at a FIXED screen-space
// offset from canvas centre and moving the camera so that offset lands exactly on the
// target world point — never literally at the canvas centre itself, which is where
// Input's mouse starts at construction (World.pointerBootX/Y in src/world.js). Landing
// back on that exact boot pixel would look, to World.draw()'s latch, indistinguishable
// from a mouse that never moved at all.
function installAimAt() {
  // OFFX/OFFY are inlined (not closed over) because page.evaluate() serializes only
  // this function's source text into the browser context.
  const OFFX = 37, OFFY = 11;
  window.__aimAt = (x, y) => {
    const g = window.__g;
    g.camera.x = x - OFFX; g.camera.y = y - OFFY;
    window.game.mouse(g.camera.w / 2 + OFFX, g.camera.h / 2 + OFFY);
    g.draw();
  };
}

const CAMP_C1 = WORLD.camps.find(c => c.id === 'c1');
const WOLFSJAW = WORLD.camps.find(c => c.stronghold);

test('no hover panel appears until the pointer actually moves', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  await page.evaluate(installAimAt);
  const atBoot = await page.evaluate(() => window.game.state().world.hover);
  expect(atBoot).toBeNull();

  // Stepping alone (no pointer input) must not create a hover panel either — the
  // default mouse position sits on the canvas centre, which the camera centres on
  // the hero, so a naive "hover if near" check would render from frame one.
  await page.evaluate(() => window.game.step(1));
  const afterStep = await page.evaluate(() => window.game.state().world.hover);
  expect(afterStep).toBeNull();

  const afterMove = await page.evaluate(() => {
    const world = window.__g.scene;
    window.__aimAt(world.hero.x, world.hero.y); // wherever the hero currently is
    return window.game.state().world.hover;
  });
  expect(afterMove).not.toBeNull();
  expect(afterMove.kind).toBe('hero');
  expect(runtimeErrors).toEqual([]);
});

test('hover reveals composition, fighting weight, and intent for a roaming party', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  await page.evaluate(installAimAt);
  const result = await page.evaluate(() => {
    const world = window.__g.scene;
    const party = world.parties.find(p => !world.inSafeZone(p.x, p.y));
    const fixture = { bodies: party.comp.length, heavy: party.comp.includes('brute') };
    window.__aimAt(party.x, party.y);
    return { hover: window.game.state().world.hover, fixture };
  });
  expect(result.hover).not.toBeNull();
  expect(result.hover.kind).toBe('party');
  expect(result.hover.bodies).toBe(result.fixture.bodies);
  expect(result.hover.heavy).toBe(result.fixture.heavy);
  expect(typeof result.hover.strength).toBe('number');
  expect(typeof result.hover.mine).toBe('number');
  expect(result.hover.lines.join(' ')).toContain('fighting weight');
  expect(runtimeErrors).toEqual([]);
});

test('hover on the warband states the hero counts for three', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  await page.evaluate(installAimAt);
  const result = await page.evaluate(() => {
    const world = window.__g.scene;
    const fixture = { bodies: world.save.troops.length + 1 };
    window.__aimAt(world.hero.x, world.hero.y);
    return { hover: window.game.state().world.hover, fixture };
  });
  expect(result.hover).not.toBeNull();
  expect(result.hover.kind).toBe('hero');
  expect(result.hover.bodies).toBe(result.fixture.bodies);
  expect(result.hover.lines.some(l => l.includes('you count for 3'))).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test('hover on an unscouted camp reveals nothing compositional', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  await page.evaluate(installAimAt);
  const result = await page.evaluate(({ campId, cx, cy }) => {
    const world = window.__g.scene;
    const st = world.save.camps.find(s => s.id === campId);
    const unscouted = !st.razed && !st.garrison;
    window.__aimAt(cx, cy);
    return { hover: window.game.state().world.hover, unscouted };
  }, { campId: CAMP_C1.id, cx: CAMP_C1.x, cy: CAMP_C1.y });
  expect(result.unscouted).toBe(true);
  expect(result.hover).not.toBeNull();
  expect(result.hover.kind).toBe('camp');
  expect(result.hover.scouted).toBe(false);
  expect(result.hover.bodies).toBeUndefined();
  expect(runtimeErrors).toEqual([]);
});

test('hover on a scouted camp shows its true composition', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  await page.evaluate(installAimAt);
  const result = await page.evaluate(({ campId, camp }) => {
    const world = window.__g.scene;
    world.parties = []; // isolate: no roaming-party collision while we inspect the camp
    const st = world.save.camps.find(s => s.id === campId);
    st.garrison = world.rollGarrison(camp);
    const real = { bodies: st.garrison.length, heavy: st.garrison.includes('brute') };
    window.__aimAt(camp.x, camp.y);
    return { hover: window.game.state().world.hover, real };
  }, { campId: CAMP_C1.id, camp: CAMP_C1 });
  expect(result.hover).not.toBeNull();
  expect(result.hover.kind).toBe('camp');
  expect(result.hover.scouted).toBe(true);
  expect(result.hover.bodies).toBe(result.real.bodies);
  expect(result.hover.heavy).toBe(result.real.heavy);
  expect(runtimeErrors).toEqual([]);
});

test('hover on Wolfsjaw before assault shows unscouted', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  await page.evaluate(installAimAt);
  const hover = await page.evaluate(({ cx, cy }) => {
    window.__aimAt(cx, cy);
    return window.game.state().world.hover;
  }, { cx: WOLFSJAW.x, cy: WOLFSJAW.y });
  expect(hover).not.toBeNull();
  expect(hover.kind).toBe('camp');
  expect(hover.scouted).toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test('hover cannot touch simulation: state() is identical whether hovering a party or empty ground', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const strip = (world) => { const { badges, hover, screen, pending, ...rest } = world; return rest; };

  await boot(page);
  await page.evaluate(installAimAt);
  const withHover = await page.evaluate(() => {
    const g = window.__g, world = g.scene;
    for (let i = 0; i < 3; i++) g.update(1 / 60); // advance the simulation first
    const party = world.parties.find(p => !world.inSafeZone(p.x, p.y)) || world.hero;
    window.__aimAt(party.x, party.y); // then pin the camera/mouse for this read, atomically
    return window.game.state().world;
  });

  await boot(page);
  const withoutHover = await page.evaluate(() => {
    const g = window.__g;
    for (let i = 0; i < 3; i++) g.update(1 / 60);
    g.draw(); // pointer never moved for this instance — hover must stay null
    return window.game.state().world;
  });

  expect(withHover.hover).not.toBeNull();
  expect(withoutHover.hover).toBeNull();
  expect(strip(withHover)).toEqual(strip(withoutHover));
  expect(runtimeErrors).toEqual([]);
});
