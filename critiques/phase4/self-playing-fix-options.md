# Fixing "the game plays itself" — without buffing the hero

Follow-up to `gameplay-audit.md`. The hero-proximity bonus was rejected, so I went looking for
other levers and **measured each one** instead of reasoning about it. Most of them don't work.
That negative result is the most useful thing in this document, because it relocates the problem.

**Fixture used throughout:** 8 troops (4 spear / 3 archer / 1 knight) vs a 7-strength roaming
party (3 bandit / 2 raider / 2 wolf), road arena, seed 11, **hero idle — zero input**.
Baseline: **win in 35.6 s, 1 troop lost, hero 102/120.**

---

## What does NOT fix it (all measured)

| lever tried | result with an idle hero | verdict |
|---|---|---|
| wolf damage 8 → 22 | win, 1 lost | no change |
| raider damage 9 → 22 | win, 1 lost | no change |
| **all enemy damage × 2** | win, 1 lost, hero 82 | no change |
| all enemy damage × 3 | **loss — but hero hp −15 while only 2 troops died** | wrong failure mode |
| all enemy damage × 4 | loss, 8 troops lost | lethality, not decisions |
| enemies focus-fire the weakest troop | **win in 17.9 s, 1 lost, hero untouched** | *helps the player* |
| pincer attack (`ambush: true`, half spawn behind) | win, **0 lost** | no change |
| staggered waves (3 enemies arrive behind at 14 s) | win, **0 lost** | no change |
| **troops stripped of all autonomy** (attack only what is already in weapon reach, never advance, never surround) | **win, 1 lost** | no change |

Read the last row twice. I replaced the troop AI with a fully passive line that cannot chase,
cannot surround, and cannot reposition — and the idle hero still won, because **the enemy AI
always closes to melee and dies there.**

### The actual diagnosis

The battle is not a contest, it is an arithmetic result being read aloud. Two facts cause it:

1. **The encounter is generated to be favorable.** `world.js:900-925` explicitly guarantees a
   party exists in the **0.7–1.2× strength band** if none does, and camp tiers are 0.7 / 0.9 / 1.1.
   The player is never offered a fight the numbers say they lose.
2. **"Kill everything" resolves itself from either side.** Both AIs seek and converge. Whoever has
   the better aggregate DPS × HP wins, no matter who advances. Damage tuning only changes *how
   fast*; arrangement only changes *where*.

And the escape hatch is open too: the hero moves at 240 px/s (276 on road) while pursuit tops out
at 185–195 (`world.js:795-800`), so **the player can outrun every fight on the map**. Difficulty
cannot be imposed on someone who can always leave.

This is why enemy tuning can never fix it. At 3× damage the game does not become tactical — the
**idle hero dies while his army loses only 2 men.** That converts an AFK win into an AFK loss and
adds exactly zero decisions.

---

## Four approaches that do address it

### Option 1 — Stop making "kill everything" the win condition *(recommended)*

Keep the autonomous troops exactly as they are — they are good at the melee, let them own it —
and give the player the job the army provably cannot do. Troops target `nearestEnemy` and nothing
else (`battle.js:555-566`); they will never pursue an objective, which is precisely what makes an
objective a real player task.

Candidates, each reusing systems already in the code:

- **Camp raids are won by torching tents, not by killing the garrison.** The `camp` arena already
  places 3 tents and a fire. The garrison keeps fighting (and can reinforce) until the tents burn;
  only the hero can set them. The army becomes your shield instead of your proxy.
- **The chief escapes.** Add one `captain` enemy that flees toward the map edge when the fight
  turns. Kill him for the loot/camp progress; let him go and the camp respawns its party. Troops
  will not chase him — they engage the nearest body.
- **The village is burning.** In `village` arenas, raiders torch houses on a timer. Every house
  lost is real world-map damage (Ashford loses cheap spears until rebuilt — ties into Option 4).
- **The cages.** "Freed captives join your warband" is currently a *post-battle text string*
  (`world.js:728-735`). Make it an in-battle objective the hero must physically reach.

Failure mode becomes "I lost the objective," not "I stood still and died." That is the difference
between a game that punishes inattention and one that rewards decisions.

### Option 2 — Make the encounter stop being pre-decided

Delete the fair-band guarantee. Let the map contain parties at 0.5× and at 2× your strength, and
make the strong ones a genuine problem: they must be able to **corner you** (raise pursuit speed
to at least hero speed for chase-mood parties, or have them cut you off using the nav graph that
already exists). Then the interesting decisions arrive before the battle — fight, avoid, lure them
onto a bridge chokepoint, or pull them away from your recruiting village — and the fights you
*shouldn't* win on paper are exactly the ones where play matters.

Cheap and high leverage, but it only pays off if the player has real in-battle tools, so it works
best combined with Option 3.

### Option 3 — Squads instead of one blob with three global stances

The audit already showed the three stances are dominated by CHARGE. The deeper issue is that the
player commands *one* object. Split the warband into 2–3 squads (spears / bows / horse) with
independent orders — this is the Bad North model, and the formation/slot code in
`assignSlots`/`slotPos` is already per-unit, so the data structure is most of the way there.

Autonomy stays *within* a squad; **assignment** becomes the skill. Unmanaged then means all three
squads sitting in the same place, which loses to a split or flanking attack — and Option 2's
uneven fights suddenly have answers (screen with spears, kite with bows, commit the horse late).

### Option 4 — Let the battles resolve themselves, and move the stakes to the run

Accept that a favorable fight is winnable on autopilot — that is realistic — and make **how well**
you fought the thing that compounds:

- Casualties are slow to replace: recruits arrive over days, not instantly at any village.
- Wounded troops stay wounded. Delete the flat **10 g full-warband heal** (`BALANCE.healCost`),
  which currently erases attrition for pocket change.
- Add upkeep so a standing army has a running cost.

The baseline fixture already loses 1 troop per unmanaged fight. Make that 1 troop actually
expensive and AFK becomes a losing *strategy* across a run, with no change to any battle rule.
Weakest option alone — it makes inattention costly without making attention interesting — but it
is the correct backstop under any of the other three.

---

## Recommendation

**Option 1 as the primary fix, Option 3 as its partner, Option 4 as the backstop.**

Option 1 changes what the battle asks for, which is the only thing the measurements say will work.
Option 3 gives the player enough grip to answer it. Option 4 makes the whole thing matter past the
end-of-battle banner. Option 2 is the best follow-up once 1 and 3 are in, and is actively unfair
before then.

Explicitly **not** recommended: enemy damage or HP tuning of any kind. Measured, it moves the
game from "AFK win" to "AFK loss" without passing through "interesting."
