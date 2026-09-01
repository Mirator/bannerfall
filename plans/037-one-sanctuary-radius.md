# 037 — One sanctuary radius, so a fight cannot start where nobody is allowed to want one

STATUS: SHIPPED (2026-09-01).

Numbered 037 because `plans/036-initiative-reads-who-closed.md` was in flight on a
parallel branch while this was written, and is where this defect was reported (its
"Found, not fixed" section). 036 landed first (PR #27) and this branch merged it in
before shipping. The two are independent: 036 changes how initiative is READ from
`p.mood` and the hero's velocity, this one changes WHERE a clash may happen at all.
Neither needs the other to be correct, and the merge of the two conflicted only on
the shared release-cache token.

## The bug

`World.tryClash()` blocked a clash near a settlement with a literal of its own:

```js
const canClash = (p.clashT || 0) <= 0 && (isOccupier || !this.nearSettlement(130)) && dh < 46;
```

while the roaming-party AI's `engaged` flag — the one that gates the entire
chase/flee/mood branch — read `inSafeZone(h.x, h.y)`, i.e.
`BALANCE.settlementSafeR`, 260px. Two radii for one rule, and the smaller one sat
on the clash: in the 130-260px annulus around any settlement the party AI stood
the party down and ran its `else p.mood = null;` fallback every tick, while a
party already inside the 46px clash shape still started a fight. `tryClash()`
then read the mood that had just been erased, so the descriptor always fell
through `ambushed`/`caughtThem` both-false — a plain `BANDIT SKIRMISH` no matter
which side had closed the distance.

Measured on this tree before the change (Ashford at 700,1150; hero parked 200px
due south at 700,1350 under `keepAwake(true)`; a ~1.0x fighting-weight party
placed on the hero): `inSafeZone(hero)` true, `p.mood` null, and on tick 1 a
brief opens reading `title: 'BANDIT SKIRMISH', ambush: false`. The comment then
sitting above `engaged` claimed "sanctuary stops FIGHTING near a settlement";
fighting demonstrably started there.

## The decision: unify UPWARD, on `settlementSafeR`

Both radii were defensible in isolation and the repository's own documents
disagreed, so this was settled on the canonical one.

- `AGENTS.md` (the engineering contract, and CLAUDE.md says it wins on conflict)
  describes the occupier exemption as an exemption "from the
  `BALANCE.settlementSafeR` sanctuary block in the party-clash check". That names
  260px as the clash block. The code did not implement it.
- `BALANCE.settlementSafeR`'s own comment in `src/data.js` reads "parties will
  not chase/engage inside this radius of a settlement" — chase AND engage.
- Plan 020 decision 5 designed the occupier exemption against "`settlementSafeR`
  (260) currently blocks clashes near settlements".
- Against those: the comment above `canClash` claimed bandits strike in a
  "110-260 band", and Plan 021 note 4 called the 130px literal
  "`BALANCE.settlementSafeR`'s 130px party-clash radius" — a conflation of the
  two numbers, which is evidence the drift was never deliberate. Plan 021's own
  observation there (the default hero start sits inside the clash-blocking zone)
  holds under either radius, since 128px is inside both.

Unifying upward is also the SMALLER behavioural change of the two candidates. The
party AI already refused to hunt anywhere inside 260px — 12.1% of the 3200x2200
map by area, against 3.0% for 130px — so pursuit behaviour is untouched by this fix;
the only thing that changes in that band is that an accidental, always
misclassified collision no longer happens. Unifying downward would instead have
let parties hunt the hero across that whole band, changing encounter frequency
near every settlement, which would need re-measuring against the balance sweep.

The shipped rule is one predicate at both ends:

```js
const heroSafe = this.inSafeZone(this.hero.x, this.hero.y);
const canClash = (p.clashT || 0) <= 0 && (isOccupier || !heroSafe) && dh < 46;
```

The occupier exemption is unchanged and is still the only one: an occupier posts
64px from the settlement centre (`occupierPost`), inside both radii, so it would
be unattackable either way without it.

## What this costs, and what it does not

A roaming clash can no longer happen within 260px of a settlement, so
`battle-transition.js`'s `nearSettlement(200) ? 'village'` arena is no longer
reachable from one. It stays reachable where the settlement IS the objective: a
raid defense (`requestDefenseBattle`, hero within `RAID.defenseR`) and an
occupier retake, both of which reach `requestBattle` without passing through the
sanctuary check. `regional-campaign.spec.js`'s defense test asserts
`arena === 'village'` through that path and is unaffected. Nothing in the gate
reached a village arena through a roaming collision.

The player also loses the ability to charge a party loitering in the outskirts of
a village. That is the symmetric half of the mechanic — the party cannot reach the
player there either — and it matches what the safe zone already did to the
party's side of it.

## Also removed: a guard that could never fire

`tryClash()`'s trigger was `if ((engaged || (canClash && dh < 46)) && canClash)`.
`canClash` already requires `dh < 46`, so `(canClash && dh < 46)` is `canClash`
and the whole expression reduces to `canClash` for every input — `engaged` could
not change the outcome. It is now `if (canClash)`, and `engaged` is no longer
passed to `tryClash()` at all (both call sites, live and frozen, updated). No
behaviour changes; what goes away is the suggestion that `world.grace` or the safe
zone gate the clash from inside this method, when grace deliberately does not (a
player must be able to charge a party they WANT to fight during the post-battle
window) and the safe zone now does so explicitly.

## Files changed

- `src/world.js` — the rule above in `tryClash()`, the trigger simplification,
  the `engaged` argument dropped from both call sites, and the comment above
  `engaged` rewritten to state the one-radius contract (it previously described
  behaviour the code did not have).
- `AGENTS.md` — the sanctuary contract stated once, in the World simulation
  section, with the failure mode it prevents.
- `src/main.js`, `tests/e2e/world-screens.spec.js` — three stale comments that
  described the clash block as "the 130px radius" now name
  `BALANCE.settlementSafeR`. No fixture moved: every clash fixture already parks
  the hero at (1600, 900), which is 435px from the nearest settlement.
- `tests/e2e/world-screens.spec.js` — the new test (below).
- `tests/README.md` — the suite description and one coverage-matrix row.
- `plans/README.md`, `progress.md` — status row and work-log entry.
- `index.html` and every `src/` module — `npm run release:cache` rewrote the shared
  cache token to `rbf9ac38b53d8`, which is why the diff touches 33 files that have no
  other change in them. That token is also the ONLY thing the Plan 036 merge conflicted
  on: 29 files, one hunk each, every one of them an import query string. The two real
  code changes met in `tryClash()` without touching each other — 036 rewrote
  `const ambushed`, this rewrote `canClash` — and `world-screens.spec.js` took both new
  tests with no conflict at all.

## Regression coverage

One test, in `tests/e2e/world-screens.spec.js`: `one sanctuary radius: no clash
inside settlementSafeR, initiative still classified outside it`. It places a
~1.0x fighting-weight party on a parked hero due south of Ashford, twice — at
200px (the old annulus) and at 320px (clear of every safe radius) — and runs a
real second of production ticks under `keepAwake(true)` each time, since a frozen
tick runs the encounter seam without classifying initiative.

At 200px it asserts `inSafeZone(hero)` true, `p.mood` null, `dh` under the 46px
clash radius on the tick that mattered, and then NO screen, no descriptor, and
the party still on the map. Before the fix that case opens a brief titled
`BANDIT SKIRMISH` on tick 1, and the three assertions ahead of the failing one
pass on the old code too — so the test records the mechanism, not only the
symptom.

At 320px the same fixture must still fight and still classify: `p.mood` is
`'chase'`, a brief opens, and it reads `AMBUSHED!` with `ambush: true`. Without
that half, a change that stopped every clash everywhere would pass. Fixture
geometry is asserted rather than assumed — the spec checks in Node that Ashford
plus the offset is further than `settlementSafeR` from every OTHER settlement, so
the offset alone decides each case.

## Gate

`npm test` (chromium project) 191/192 on the merged tree, and 190/191 before Plan 036 was
merged in. The single failure both times is `battle-break.png` at 13876 differing pixels,
ratio 0.02 - the documented Windows-only font drift: re-running that one spec with the
`canClash` line reverted to the 130px literal fails with the identical pixel count, so it
is independent of this change. `npm run test:balance` passes and reproduces the recorded
sweep to the digit (idle 53 / chargeAll 60 / split 37 over 120 raids per policy), which is
expected rather than a missed effect - it drives camp raids, and the nearest camp to any
settlement is 495px away, well outside the radius this slice moved. `npm run test:tooling`
15/15. `npm run release:cache` then `npm run test:release` verified at `rbf9ac38b53d8`.
`npm run test:visual:linux` was NOT run - the Docker daemon is not up on this host - so
CI's font container is the only place that one visual failure can be re-checked.

## Found while working, not fixed

- A Playwright server already running on 127.0.0.1:8474 belonged to a DIFFERENT
  worktree, and `reuseExistingServer` reused it, so the first run of the new test
  measured another tree's `src/`. It failed with exactly the pre-fix symptom,
  which looks identical to the fix not working. Caught by fetching
  `/src/world.js` from the server and reading the served `canClash` line, which
  still had the 130px literal. Every run reported here used a private port (8475)
  through a local config override. A `PORT`-aware default in
  `playwright.config.js` would remove the trap if parallel worktrees stay a
  normal way to work here; not changed under this task.
- `p.mood` is also erased for a clash that happens during `world.grace` (grace
  gates `engaged` but deliberately not `canClash`), so charging a party inside the
  post-battle window reports a plain skirmish too. That one reads as correct
  rather than as drift: grace is ambush immunity, so declining to call those six
  seconds an ambush is the point. Left alone.
