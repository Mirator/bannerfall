# 036 — Initiative reads who closed the distance, not just who intended to

STATUS: SHIPPED (2026-09-01).

## The bug

`World.tryClash()` (`src/world.js`) classified a fight's initiative off
`p.mood` alone:

```js
const ambushed = p.mood === 'chase';
const caughtThem = p.mood === 'flee';
```

`p.mood` is set earlier the same tick, in the roaming-party AI (`src/world.js`,
the `chase`/`flee` branch inside `updateParties`): any party within the 430px
(560px if wary) detection radius whose fighting weight is at least 0.75x the
hero's turns to intercept and is marked `'chase'`. That records the party's
INTENT to close, never whether it actually did. Result: every encounter with a
party worth fighting read as an ambush — including the case the comment block
above `tryClash` names as a third, distinct outcome ("a mutual field meeting =
both sides deploy"), which was unreachable for a roaming party. `BANDIT
SKIRMISH` only ever fired for a raiding party or one whose mood was never set.

Measured before the fix (a Playwright probe, party placed 320px east of the
hero at 1600,900, hero driven straight at it at 220px/s):

| party weight vs hero | title | ambush | mood |
| --- | --- | --- | --- |
| 0.4x | (never clashed — it fled) | – | null |
| 0.8x | AMBUSHED! | true | chase |
| 1.0x | AMBUSHED! | true | chase |
| 1.6x | AMBUSHED! | true | chase |

This was not just a wrong label. `src/battle.js` reads `setup.ambush` to
decide the enemy spawn shape (`FLANK_GAP` pincer, half the enemies placed
behind the hero) and, separately, whether the deployment phase runs at all
(`this.deployEnabled = !setup.ambush && ...`). The descriptor's own `deploy`
field already said `undefined` — "mutual deployment phase (Plan 033)" — while
`ambush: true` silently killed that same deployment phase. Per Plan 033's own
measurement, losing the deployment phase costs roughly 11 points of win rate
(idle 49% vs chargeAll 60%, `plans/033-deployment-phase.md`). Riding a party
down deliberately was several times more likely to be misclassified than to be
correctly read as the fight the player chose to start.

## The rule

Initiative now reads whether the hero is closing on the party, not just the
party's intent:

```js
const toPartyX = dh > 0 ? (p.x - this.hero.x) / dh : 0;
const toPartyY = dh > 0 ? (p.y - this.hero.y) / dh : 0;
const heroClosingSpeed = this.hero.vx * toPartyX + this.hero.vy * toPartyY;
const heroClosing = heroClosingSpeed > BALANCE.worldWakeSpeed;
const ambushed = p.mood === 'chase' && !heroClosing;
```

`heroClosingSpeed` is the hero's velocity resolved onto the unit vector from
hero to party — positive means the hero is headed at the party, not merely
drifting toward it as an incidental component of some other heading.

**Threshold: `BALANCE.worldWakeSpeed` (40px/s), not an arbitrary new
constant.** It is already the number `World.timeFlowing()` uses to mean
"meaningfully in motion" — the same 40px/s that gates bob, dust and the gallop
SFX (Plan 023). Reusing it buys a property for free rather than by
convention: by Cauchy-Schwarz, a velocity's component along any unit vector
can never exceed the velocity's own magnitude, so on a tick where the hero's
raw speed is below `worldWakeSpeed` — i.e. every frozen tick, since
`timeFlowing()` gates on exactly that comparison — `heroClosingSpeed` can
never exceed it either. A stopped or barely-coasting hero can never read as
closing, by construction, not by testing.

This was the caveat the task asked to verify rather than assume, since a
frozen tick still runs `tryClash()` (the Plan 023 encounter seam: a party that
has already closed to clash range must resolve even with the keys released).
It holds: `updateHeroMovement()` runs before the freeze decision every tick,
frozen or not, so `this.hero.vx/vy` are always this tick's real values when
`tryClash()` reads them, and the bound above is exact, not incidental.

`caughtThem` (`p.mood === 'flee'`) and `canWithdraw: caughtThem` are
unchanged — Plan 021 decision 5 keeps a mutual skirmish committed, matching
the task's instruction not to touch that.

## Files changed

- `src/world.js` — the rule above, in `tryClash()`.
- `src/main.js` — the `world_brief` scenario's `'party'` fixture. It places
  the party at the hero's exact coordinates and parks the hero
  (`keepAwake(true)`, which fakes `heroSpeed` for the `timeFlowing()` gate but
  never touches `hero.vx/vy`), so under the new rule a stationary hero could
  no longer produce the mutual case `'party'` is documented as. Fixed by
  offsetting the party 20px east (still inside `tryClash`'s 46px clash
  radius, so the fixture's single setup tick still clashes) and setting
  `hero.vx = 220` toward it before that tick. `'ambush'` (1.6x, stationary
  hero) and `'partyFlee'` (0.4x, stationary hero) are untouched: an ambush
  must still resolve at zero hero velocity, and a fleeing party's mood is
  never `'chase'`, so the closing check never reaches it either way.
- `tests/e2e/world-screens.spec.js` — see below.

## Regression coverage

Two additions, both in `tests/e2e/world-screens.spec.js`.

1. `withdraw is offered only for camp/stronghold assault and a fleeing party,
   never an ambush or a mutual skirmish` now also reads
   `world.pending.descriptor.title` and `.ambush` for every `world_brief` kind,
   not just `canWithdraw`. Before this change `canWithdraw` was the only
   assertion on the `'party'` and `'ambush'` cases, and it is `false` for both
   — so the wrong title/ambush pairing on `'party'` was invisible to the
   suite. `'party'` now asserts `{ title: 'BANDIT SKIRMISH', ambush: false }`.

2. New test, `riding straight into a chasing party is a mutual skirmish, not
   an ambush`: builds a real `'world'` scenario (not `world_brief`, not
   `keepAwake`), places a party 300px due SOUTH of the hero at 1600,900 (the
   `world_brief` fixture's own coordinate) at 1.0x fighting weight (the bug
   report's own measured band), and drives the hero at it with a REAL held
   `moveDown` input for up to 300 ticks of production physics — the same
   acceleration/clamp/coast the player's own movement goes through. Asserts
   `party.mood === 'chase'` (sanity: this is genuinely the case mood alone
   misreads) and then `descriptor.title === 'BANDIT SKIRMISH'`,
   `descriptor.ambush === false`, `descriptor.canWithdraw === false`.

   The first attempt at this test drove the hero EAST instead and failed
   `moodWasChase`, not the assertions it was written to exercise: Highmere
   sits at 2050,1150, only ~250px off an eastward approach's endpoint and
   inside its 260px `BALANCE.settlementSafeR`. Riding into that radius flips
   `engaged` false mid-approach, and `tryClash()`'s outer `else p.mood =
   null;` branch fires before the clash resolves — so the party's mood was
   `null`, not `'chase'`, at the tick the brief opened, and the passing
   title/ambush values would have been a coincidence of the null case, not a
   measurement of the fix. Logged with `world.timeFlowing()`, `hero.vx`, and
   party/hero coordinates sampled every 10 ticks to find this rather than
   guess it (`hero.vx` step-changes to 0 the instant the world stops flowing
   the OTHER way it can fail — a terrain obstruction stalling the hero
   entirely — which is worth checking for before trusting a "closes within N
   ticks" test on a new coordinate). South of 1600,900 stays clear of every
   settlement's safe radius for the ~300px of travel this test needs.

   Before the fix, this test fails: the clash still resolves (dh<46 does not
   depend on the ambush classification) but `descriptor.title` is `'AMBUSHED!'`
   and `descriptor.ambush` is `true`. After the fix it passes.

## What was checked but not changed

- `tests/e2e/visual-regression.spec.js` uses only the `'partyFlee'` kind of
  `world_brief` (`kind: 'partyFlee'`, line 91) and `'campScouted'` — neither
  code path this change touches (`'partyFlee'` keeps its stationary hero;
  `'party'`'s offset/velocity change is gated on `kind === 'party'`
  specifically). No visual baseline moved: `npm test`'s own
  `visual-regression.spec.js` run passed against the existing PNGs with no
  `--update-snapshots`.
- `tests/e2e/world-freeze.spec.js:269` uses `world_brief` `kind: 'party'` to
  open a brief and then asserts only `world.screen.kind === 'brief'` and that
  the ambient clock/stale cue stay frozen afterward — it does not read
  `ambush`/`title`, so it is unaffected by the fixture's velocity change.
- RNG draw order in `src/battle.js`'s enemy scatter loop was left untouched,
  per the task's explicit constraint — this change never reaches it; it only
  changes which descriptor fields `tryClash()` produces before a battle is
  even requested.
- Did not add a symmetric "hero closing on a fleeing party" case or otherwise
  touch `caughtThem`/`canWithdraw` — out of scope per the task and Plan 021
  decision 5.

## Found, not fixed: a second initiative-classification gap in the 130-260px settlement annulus

Found while chasing down why the first draft of the new regression test (an
eastward approach from 1600,900) failed on its own `moodWasChase` sanity
check rather than on the assertions it was meant to exercise. `canClash`
blocks a clash near a settlement using `nearSettlement(130)`
(`src/world.js:901`), but `engaged` — the flag that gates the whole
chase/flee/mood branch in the party AI — uses `inSafeZone`, which checks
`BALANCE.settlementSafeR` (260px, `src/data.js:389`). Those two radii
disagree. In the 130-260px annulus around any settlement, `heroSafe` is true
so `engaged` is false, so the party AI's `if (engaged && ...)` guard is
skipped every tick and its `else p.mood = null;` branch runs — but
`canClash` only checks the tighter 130px radius, so a party already within
46px still starts a fight. The clash always resolves through the
`ambushed`/`caughtThem` both-false fallback (plain `BANDIT SKIRMISH`), no
matter which side actually closed the distance, because `p.mood` was wiped
to `null` before `tryClash()` ever reads it.

Measured directly: hero ridden east from 1600,900 at 240px/s into a 1.0x-weight
chasing party. `p.mood` reads `'chase'` from tick 10 through tick 100 while
`dh` closes from roughly 280px to 69px. At tick ~110 (`dh` 53px, hero at
2014,900 — 252.6px from Highmere at 2050,1150, inside its 260px safe
radius but outside `nearSettlement`'s 130px), `p.mood` flips to `null` and
stays `null` through the clash at tick 113 (`dh` 47px). The brief that opens
reads `title: 'BANDIT SKIRMISH', ambush: false` — the answer this plan's fix
would also produce, but reached because mood was erased, not because the
hero was read as closing.

The comment at `src/world.js:720` ("sanctuary stops FIGHTING near a
settlement") is contradicted by this: fighting demonstrably still starts in
that annulus, just always misclassified as a mutual skirmish. This is the
same family of defect this plan fixes — a fight's label not matching what
actually happened — but a different mechanism (a radius mismatch between two
call sites, not a mood/velocity conflation), and touching it was out of
scope for this task. Left unfixed; recorded here rather than folded
silently into this change.
