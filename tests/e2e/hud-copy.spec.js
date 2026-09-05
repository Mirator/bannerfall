// The copy gate: every string a screen actually draws, in draw order.
//
// Why this exists. `visual-regression.spec.js` compares whole canvases with
// `maxDiffPixelRatio: 0.015` — 13,824 pixels at 1280x720. The campaign's objective chip is
// about 300x50, so its ENTIRE text can change and the pixel suite still passes; that is not
// hypothetical, it is what happened to `world-overview.png`, which sat in the repository
// reading `Weaken it (0/7) · Capture settlements · raze camps` long after the game had
// started drawing `Weaken it (0/4) · Capture or raze 2 more`, with the visual suite green
// the whole time. The cap cannot simply be tightened: a Chromium build difference alone
// moves 800-6,300 pixels on these frames with no content change at all, so the ratio has to
// stay well above the size of a HUD chip. Text needs its own gate, and this is it.
//
// How it works. `fillText` is wrapped on the prototype before the page's own scripts run,
// so every string reaching the canvas is recorded in draw order, whichever module drew it.
// The frame is then produced through the same fixed-step, frozen-update harness the visual
// suite uses, so the lists below are as deterministic as the PNGs are.
//
// How to change one. A copy edit is expected to fail these lists — that is the whole point.
// Update the expectation in the SAME commit as the string, and read the diff: it is the
// review surface for player-facing wording that a screenshot cannot give you.
//
// Two of the screens here — the pause overlay and the ARMED victory screen — had no
// coverage of any kind before this file. See visual-regression.spec.js for their new
// baselines; between the two suites they are now guarded on both pixels and words.
import { test, expect } from '@playwright/test';
import { collectRuntimeErrors, drainRuntimeErrors, assertNoRuntimeErrors } from './test-helpers.js';

// Installed via addInitScript so it is in place before src/main.js builds its context.
// Recording on the PROTOTYPE (not on the one context main.js owns) also catches the
// offscreen canvases the HUD bakes into, so nothing can draw text outside the gate.
function installTextRecorder() {
  window.__drawnText = [];
  const proto = CanvasRenderingContext2D.prototype;
  const fillText = proto.fillText;
  proto.fillText = function (text, ...rest) {
    window.__drawnText.push(String(text));
    return fillText.call(this, text, ...rest);
  };
}

// Same settle discipline as the visual suite: seeded scenario, explicit fixed steps, then
// the live scheduler is replaced so the captured frame cannot advance under us. The buffer
// is cleared immediately BEFORE the measured draw, so scenario setup (which draws its own
// frames) never leaks into the list.
async function drawnText(page, scenario, options = {}) {
  await page.goto('/');
  await page.waitForFunction(() => document.fonts.check('800 16px Inter'));
  return page.evaluate(({ scenarioName, scenarioOptions }) => {
    localStorage.clear();
    window.game.scenario(scenarioName, scenarioOptions);
    const game = window.__g;
    // Same camera placement the visual suite's settle() performs, so a scenario shared with
    // a baseline draws the same map labels here as it does in the PNG.
    if (scenarioOptions.center) {
      game.scene.hero.x = scenarioOptions.center[0];
      game.scene.hero.y = scenarioOptions.center[1];
      game.camera.x = scenarioOptions.center[0];
      game.camera.y = scenarioOptions.center[1];
    }
    if (scenarioOptions.steps) window.game.step(scenarioOptions.steps);
    game.update = () => {};
    game.paused = !!scenarioOptions.paused;
    // The pause overlay's destructive row has two states and the armed one prints a live
    // countdown, so a screenshot cannot hold it. Words can: setting the arm here is what
    // lets this suite cover the only key in the game that deletes a campaign.
    if (scenarioOptions.abandonArm != null) game.abandonArmT = scenarioOptions.abandonArm;
    window.__drawnText.length = 0;
    game.draw();
    return window.__drawnText;
  }, { scenarioName: scenario, scenarioOptions: options });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installTextRecorder);
});

// The campaign HUD: the purse chip and the stronghold objective chip. This is the exact
// frame whose baseline went stale, so it is the first thing the gate pins.
test('the campaign HUD chips say what the region model computes', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'world', { seed: 20260817, steps: 0.5 });
  expect(text).toEqual([
    'Ashford',
    'Bandit camp',
    '8',
    '5',
    '⛃ 80    ⚔ 4/12    ♥ 120/120',
    'Wolfsjaw: ENTRENCHED',
    '◇  Weaken it (0/4)',
    'Capture or raze 2 more',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

// The pause overlay has no pixel baseline history at all — it was invisible to the gate
// until now, including the arm-and-confirm wording on the one destructive key in the game.
test('the pause overlay states resume, quit and the destructive abandon', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'world', { seed: 20260817, steps: 0.5, paused: true });
  expect(text).toEqual([
    'Ashford',
    'Bandit camp',
    '8',
    '5',
    '⛃ 80    ⚔ 4/12    ♥ 120/120',
    'Wolfsjaw: ENTRENCHED',
    '◇  Weaken it (0/4)',
    'Capture or raze 2 more',
    'PAUSED',
    'ESC / P — resume    ·    M — mute',
    'Q — save and quit to menu',
    'R — abandon run (press R twice; it deletes the campaign)',
    'Saving is automatic on the map; battles resume from their entry checkpoint',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

// The armed half of that same row. R deletes the only save the game keeps, so what the
// second press is about to do — and how long the offer stands — is the copy that most
// needs a guard, and it is the one string a PNG baseline can never hold.
test('the armed abandon row says what the second press destroys', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'world', { seed: 20260817, steps: 0.5, paused: true, abandonArm: 1.7 });
  expect(text.slice(-2)).toEqual([
    'Press R again to ABANDON — this deletes your campaign (1.7s)',
    'Saving is automatic on the map; battles resume from their entry checkpoint',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

test('the town site menu lists every service with its price and refusal', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'world_site', { kind: 'town', seed: 424242 });
  expect(text).toEqual([
    'Ashford',
    'Bandit camp',
    '5',
    '⛃ 80    ⚔ 4/12    ♥ 120/120',
    'Wolfsjaw: ENTRENCHED',
    '◇  Weaken it (0/4)',
    'Capture or raze 2 more',
    'Highmere',
    'E',
    'HIGHMERE',
    'the King’s garrison town',
    '⛃ 80    ⚔ 4/12    ♥ 120/120',
    '↑↓ choose · E do it · X leave',
    '▸',
    'Spearman — 15g',
    'Holds the line — braced, they gut whatever charges into their front',
    '·',
    'Archer — 25g',
    'A slow, heavy shaft — on HOLD they steady, and gut brutes for double',
    '·',
    'Knight — 60g · 2 places',
    'Picks its fight and leaves it — but eats two places in the column',
    '·',
    'Rest & heal — 10g',
    "Your wounds and your warband's, back to full",
    '·',
    'Expand the column +2 — 40g',
    'Room for two more places (now 12)',
    '·',
    'Raise the banner — 150g',
    'Veteran → Elites: the rank your veterans may reach  ·  Need 150 gold',
    '·',
    'Claim it for your banner — 100g',
    '+1 toward weakening Wolfsjaw · no fight · then choose what it becomes  ·  Need 100 gold',
    'LEAVE  (X)',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

// The brief is where the player agrees to a fight, so its odds line and its objective
// wording are the highest-consequence copy in the game.
test('the camp assault brief states the odds, the objective and both answers', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'world_brief', { kind: 'campScouted', seed: 424242 });
  expect(text).toEqual([
    'Ashford',
    'Bandit camp',
    '5',
    '⛃ 80    ⚔ 4/12    ♥ 120/120',
    'Wolfsjaw: ENTRENCHED',
    '◇  Weaken it (0/4)',
    'Capture or raze 2 more',
    'Bandit camp',
    'E',
    'RAID THE CAMP',
    'Break the position — one of the linked camps feeding Wolfsjaw',
    'YOUR WARBAND',
    'THE ENEMY',
    '4 SPEARS   ♥ 120/120',
    '5 bodies · fighting weight 4.6',
    'no veterans yet — men earn rank by winning and surviving',
    '3 bandits, 2 wolves',
    '5 bodies · fighting weight 3.2',
    'favored',
    'Arena: camp',
    'Break the position: destroy all 2 defensive guards',
    'Destroying every guard wins even if defenders survive — so does wiping them out',
    'Withdrawing leaves the position intact for another day',
    'E — Confirm',
    'X — Withdraw',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

test('the defeat aftermath names the loss, its price and where the column woke up', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'world_aftermath', { seed: 424242, result: { victory: false } });
  expect(text).toEqual([
    'Ashford',
    'Coldwell',
    'Highmere',
    'Bandit camp',
    '2',
    '5',
    '⛃ 56    ⚔ 4/12    ♥ 60/120',
    'Wolfsjaw: ENTRENCHED',
    '◇  Weaken it (0/4)',
    'Capture or raze 2 more',
    'Village of Coldwell',
    'E',
    'DEFEAT',
    'Your line broke',
    'YOUR LOSSES',
    'ENEMY LOSSES',
    'none',
    'none',
    'Lost: −24 gold',
    'Hero HP: 60/120',
    'no veterans yet — men earn rank by winning and surviving',
    'Your men carry you to Coldwell — the survivors regroup. Beaten this low, a fight you can win is',
    'kept on the map',
    'E — Continue',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

// A permanent, irreversible choice: what each option promises, and the armed hint that
// deliberately withholds the commit key until the player has had time to read.
test('the specialization choice states each permanent benefit and holds its arm', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'world_choice', { kind: 'spec', seed: 424242 });
  expect(text).toEqual([
    'Ashford',
    'Bandit camp',
    '5',
    '⛃ 20    ⚔ 4/12    ♥ 120/120',
    'Wolfsjaw: ENTRENCHED',
    '◇  Weaken it (1/4)',
    'Capture or raze 1 more',
    'Village of Ashford',
    'E',
    'Ashford joins your banner! Choose what it becomes.',
    'ASHFORD JOINS YOUR BANNER',
    'Choose what it becomes — permanent for this campaign',
    '↑↓ choose · read it first…',
    '▸',
    '⚒  Barracks',
    '2 spearmen drill with you at once  ·  later visits: Spearmen recruited here for 8g',
    '·',
    '➶  Archery Range',
    '2 archers sign on at once  ·  later visits: Archers recruited here for 15g',
    '·',
    '⛃  Market',
    '+80 gold trade toll, paid now  ·  later visits: Rest & heal here for 5g',
    '·',
    '👁  Watchtower',
    'Nearby camps revealed at once  ·  later visits: Camps near this town stay scouted',
    'A captured settlement pays its benefit only while it flies your banner',
    'DECIDE LATER  (X)',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

// The battle HUD's squad rows and the deployment instruction line. Both are keyboard
// contracts written in prose: if a key is rebound or a stance renamed, this fails.
test('the battle HUD names each squad, its order and the deployment keys', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'battle_big', { steps: 1.5 });
  expect(text).toEqual([
    'Warband 14   ·   Slain 0/11',
    'SPEARS', '7', 'FOLLOW',
    'BOWS', '4', 'FOLLOW',
    'HORSE', '3', 'FOLLOW',
    'TAB pick squad  ·  1 follow  2 charge  3 hold',
    'FORM YOUR LINE',
    'drag a man to place him · 1 follow 2 charge 3 hold · E sounds the advance',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

test('the hold objective panel states the requirement and the clock', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'battle_hold', { steps: 1.5 });
  expect(text).toEqual([
    '3', '2',
    'Warband 4   ·   Slain 0/3',
    'OBJECTIVE · HOLD THE GROUND',
    'No squad inside!',
    '35s',
    'SPEARS', '3', 'FOLLOW',
    'BOWS', '1', 'FOLLOW',
    'TAB pick squad  ·  1 follow  2 charge  3 hold',
    'FORM YOUR LINE',
    'drag a man to place him · 1 follow 2 charge 3 hold · E sounds the advance',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

// The ARMED victory screen. `victory-summary.png` is captured at steps 1.5 and the rows
// only draw past `victoryT > 1.5`, so the campaign's terminal choice — the two rows the
// player has to use to do anything at all — had never been asserted by anything.
test('the armed victory screen offers both terminal choices', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'victory_summary', { steps: 3 });
  expect(text).toEqual([
    'WOLFSJAW HAS FALLEN',
    'THE CAMPAIGN',
    'THE REALM',
    'Active time   62:22',
    'Settlements captured   2/4 (held 2)',
    'Battles won   9',
    'Camps razed   3/3',
    'Battles lost   2',
    'Gold earned   812  ·  spent   640',
    'Soldiers lost   14',
    'Treasury   214',
    'Foes slain   71',
    'Final army   2 spears, 2 bows, 1 horse',
    'THE BANNER OF YOUR KINGDOM',
    'Ashford: Barracks   ·   Coldwell: Watchtower',
    '▸  NEW CAMPAIGN   ·   ENTER / E',
    'MAIN MENU   ·   ESC',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

// The three stronghold power states. This is the copy that actually drifted: every one of
// these frames has a PNG baseline, and every one of those baselines still shows the retired
// `Weaken it (n/7) · Capture settlements · raze camps` wording. The chip is derived by
// region.js from held ground and razed camps, so each state phrases the requirement
// differently — and the requirement is the campaign's only stated goal.
test('the WEAKENED chip names what is still owed', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'world_region', {
    seed: 20260817, owned: ['ashford', 'brindle'], center: [2620, 780], steps: 0.5,
  });
  expect(text).toEqual([
    'Highmere', 'Bandit camp', 'Wolfsjaw Hold', 'WEAKENED', '5',
    '⛃ 80    ⚔ 4/12    ♥ 120/120',
    'Wolfsjaw: WEAKENED',
    '◇  Weaken it (2/4)',
    'Capture or raze 2 more — one a linked camp',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

test('the EXPOSED chip stops asking and says storm it', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'world_region', {
    seed: 20260817, owned: ['ashford', 'brindle', 'coldwell', 'keep'], razed: ['c1', 'c2', 'c3'],
    center: [2620, 780], steps: 0.5,
  });
  expect(text).toEqual([
    'Highmere', 'Wolfsjaw Hold', 'EXPOSED', '5',
    '⛃ 80    ⚔ 4/12    ♥ 120/120',
    'Wolfsjaw: EXPOSED',
    '◇  Weaken it (4/4)',
    'Weakened as far as it goes — storm it',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

// The other permanent choice, and the one whose rows quote tuning constants: a balance edit
// that changes 2.2x or 1.35x and forgets the prose here now fails.
test('the perk choice quotes the numbers its perks actually apply', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'world_choice', { kind: 'perk', seed: 424242 });
  expect(text).toEqual([
    'Ashford', '⚒', 'Bandit camp', '7',
    '⛃ 20    ⚔ 6/12    ♥ 120/120',
    'Wolfsjaw: ENTRENCHED',
    '◇  Weaken it (1/4)',
    'Capture or raze 1 more',
    'Village of Ashford',
    'E',
    'Ashford joins your banner! Choose what it becomes.',
    'THE CAMPAIGN HAS TAUGHT YOU SOMETHING',
    'Choose one — permanent for this campaign',
    'Your first  ·  1 point banked',
    '↑↓ choose · read it first…',
    '▸',
    '⩓  Set Spears',
    'Braced spears hit for 2.2x instead of 1.8x  ·  pays only on HOLD, against a rush into the line’s front',
    '·',
    '◎  Steady Hands',
    'Your bows on HOLD group 40% tighter  ·  pays only on HOLD, against a rush into the line’s front',
    '·',
    '⌇  Warhorn',
    'Charging squads take 1.18x damage instead of 1.35x  ·  pays only when you order CHARGE',
    'Every one of these pays only when you give an order',
    'DECIDE LATER  (X)',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

test('the camp site menu states the odds and what razing counts toward', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'world_site', { kind: 'camp', seed: 424242 });
  expect(text).toEqual([
    'Ashford', 'Bandit camp', '5',
    '⛃ 80    ⚔ 4/12    ♥ 120/120',
    'Wolfsjaw: ENTRENCHED',
    '◇  Weaken it (0/4)',
    'Capture or raze 2 more',
    'Bandit camp',
    'E',
    'BANDIT CAMP',
    'The odds: favored',
    '⛃ 80    ⚔ 4/12    ♥ 120/120',
    '↑↓ choose · E do it · X leave',
    '▸',
    'Raid the camp',
    'One of the linked camps feeding Wolfsjaw (counts toward the 3)',
    'LEAVE  (X)',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

test('the victory aftermath pays out and points at the next objective', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'world_aftermath', { seed: 424242, result: { victory: true } });
  expect(text).toEqual([
    'Coldwell', 'Highmere', 'Bandit camp', '5',
    '⛃ 95    ⚔ 4/12    ♥ 120/120',
    'Wolfsjaw: ENTRENCHED',
    '◇  Weaken it (0/4)',
    'Capture or raze 2 more',
    'VICTORY',
    'YOUR LOSSES',
    'ENEMY LOSSES',
    'none',
    'none',
    'Loot: +15 gold',
    'Hero HP: 120/120',
    'no veterans yet — men earn rank by winning and surviving',
    'Victory, no losses! The camps are the objective: raid the tents.',
    'E — Continue',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

test('the break objective panel counts the guards still standing', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'battle_break', { steps: 1.5 });
  expect(text).toEqual([
    'Warband 4   ·   Slain 0/3',
    'OBJECTIVE · BREAK THE POSITION',
    '2 guards standing',
    'SPEARS', '2', 'FOLLOW',
    'BOWS', '1', 'FOLLOW',
    'HORSE', '1', 'FOLLOW',
    'TAB pick squad  ·  1 follow  2 charge  3 hold',
    'FORM YOUR LINE',
    'drag a man to place him · 1 follow 2 charge 3 hold · E sounds the advance',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});

test('the title menu lists its rows and the keys that drive them', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const text = await drawnText(page, 'menu', { steps: 1.5 });
  expect(text).toEqual([
    'BANNERFALL',
    'BANNERFALL',
    'Raise a warband. Raze the camps. Take Wolfsjaw Hold.',
    '▸', 'NEW CAMPAIGN',
    '•', 'SETTINGS',
    '•', 'CREDITS',
    '↑↓ / WASD  Navigate    ·    ENTER  Select    ·    M  Mute',
  ]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(errors);
});
