# Bannerfall — Gameplay Audit (Phase 4)

**Method:** read `src/data.js`, `src/battle.js`, `src/world.js` for the rules, then measured the
sim live through the headless test API (`window.game.step`, `window.__g`). Every number below is
a machine-measured run, not an impression. The hero was left **idle** (zero input) in every
measurement unless stated — because that is the finding.

---

## The core problem: the game plays itself

**Measured — roaming-party fight, 8 troops (4 spear / 3 archer / 1 knight) vs a 7-strength
party, hero never presses a key:**

| result | time | troops lost | damage dealt by hero | damage dealt by troops |
|---|---|---|---|---|
| **victory** | 30.8 s | **0** | **0** | 625 |

The hero — the only thing the player controls — contributed **zero percent** of the damage, and
the warband still took no casualties. That is the shape of the mid-campaign loop: ride into a
party, put the controller down, collect 45 gold.

The hero only matters at parity or above, and there mainly as a *liability*: in the stronghold
tests below, three of four compositions lost because **the idle hero died while his army was
still winning** (`battle.js:346` — hero hp ≤ 0 calls `endBattle(false)` unconditionally). The
player's real job is "don't stand still," not "command an army."

---

## Finding 1 — the three stances are not a decision; CHARGE strictly dominates

**Measured — `battle_big` fixture, seed 7, 14 troops vs 11 enemies, idle hero:**

| command | time | outcome | troops left | hero hp |
|---|---|---|---|---|
| `2` CHARGE | **19.4 s** | win | **12 / 14** | **120 / 120** |
| `1` FOLLOW | 31.5 s | win | 12 / 14 | 111 / 120 |
| `3` HOLD | 42.6 s | win | 11 / 14 | 66 / 120 |

Charge is faster, cheaper in hp, and never worse. Hold is dominated on every axis — it costs
time, men, *and* hero health. A three-option menu where one option is free and one is a trap is
a keybind, not a tactic. There is no fight where holding is currently correct, because `hold`
only freezes positions (`battle.js:277-281`); it grants no defensive benefit at all.

## Finding 2 — army composition is solved: knights only

**Measured — 12 troops vs a Wolfsjaw-scale garrison (3 brute / 4 bandit / 2 raider / 1 wolf),
camp arena, CHARGE, idle hero:**

| composition | cost | outcome | troops left | hero |
|---|---|---|---|---|
| **12 knights** | 720 g | **win in 14.8 s** | **10 / 12** | **untouched** |
| 4 knight / 4 spear / 4 archer | 348 g | loss (38.0 s) | 4 | dead |
| 12 archers | 300 g | loss (20.0 s) | 11 alive | dead |
| 12 spears | ~150 g | loss (30.6 s) | 0 | dead |

Per army-cap slot the knight is strictly best (15.8 dps / 170 hp vs the spear's 9.5 / 100), and
**army cap is the binding constraint, not gold** — so the optimal campaign is "farm roaming
parties, fill every slot with knights, walk into the endgame." Spears and archers have no fight
they are uniquely good at: no bracing vs cavalry, no bonus vs brutes, no anti-armor. `UNIT_TYPES`
gives spear and archer *identical* damage (10), so the archer is just a spear with range.

## Finding 3 — gold stops being a resource after about four fights

Sinks are exhaustive and cheap (`world.js:508-520`, `world.js:668-692`): recruit, heal, +2 cap.

- Loot is `10 + 5 × enemies` → a 7-strong party pays **45 g**. Spearman at Ashford: **12 g**.
- A full heal — hero to max **and every wounded troop's hp cleared** — costs a flat **10 g**
  (free at Coldwell). Attrition is not a cost; it is a 10-gold rounding error.
- Party spawns run on a 40 s timer capped at `2 + aliveCamps × 2` (`world.js:900-925`), so
  farming is unbounded and free.

Nothing in the campaign ever makes the player choose between two things they want.

## Finding 4 — the world map applies no pressure

Camps never grow, never raid, never reinforce while you delay. Settlements cannot be lost. There
is no clock. Delaying is strictly rewarded: every 40 s another 45-gold party walks toward you.
The one ordering decision — which of the three camps first — is flattened by tier values
(0.7 / 0.9 / 1.1) that a knight warband covers trivially.

## Finding 5 — remaining friction (flagged in phase 3, still present)

- **End-of-battle banner is a hard 2.6 s wait, unskippable** (`battle.js:414`). The *intro* state
  accepts input at 0.6 s; the end state accepts none. Dozens of battles per run.
- **Hero death is an instant total loss** even with most of the warband standing (12-archer row
  above: 11 men alive, campaign-level defeat). Nothing represents "your men fought on."

---

## Five recommendations, in priority order

### 1. Make the hero a force multiplier, not a spectator *(fix — highest value)*

Cut autonomous troop output ~30–40 % and give it back as a **hero-anchored bonus**: troops within
~220 px of the hero, or attacking a target the hero has marked, fight at full rate. Standing back
becomes a measurable loss instead of a free win. The formation code already tracks hero distance,
so this is a coefficient in the troop-attack path, not a rewrite.

*Acceptance test to add:* an idle hero must **lose** the 8-vs-7 party fixture he currently wins
with zero casualties.

### 2. Give the three stances real trade-offs, and add a fourth verb *(fix + small feature)*

- **CHARGE:** keep the speed/damage bonus, but break formation — archers stop firing while
  advancing and separation loosens, so charging into wolves or a brute slam costs men.
- **HOLD:** grant what its name promises — spears brace (bonus damage against anything closing at
  speed: wolves, brute charges), archers gain accuracy while stationary. Hold should be the right
  answer to a wolf pack, which is exactly the fight it currently loses.
- **New `4` FOCUS:** the hero marks a target and nearby troops switch to it. This is the missing
  verb — the player currently cannot tell his army *what* to kill, only how fast to walk at it.

### 3. Bind the economy so composition becomes a choice *(fix)*

Any two of these are enough:

- Knight occupies **2 army-cap slots** — it is worth two spearmen, so charge it as two.
- **Per-battle upkeep** (Bannerlord-style wages) so hoarding gold and farming parties has a cost.
- Give spear and archer a **role the knight cannot fill**: spear braces vs mounted/wolves, archer
  gets a bonus vs `brute` (the one enemy melee cannot safely stand next to). Split their damage
  values — identical `dmg: 10` on both is why neither has an identity.
- Scale healing with the wound. A flat 10 g full-warband restore erases attrition entirely.

### 4. Put the campaign on a clock: escalating camps, losable settlements *(new feature)*

Give the world map a reason to move.

- Camp garrisons **grow** on a timer while un-razed; Wolfsjaw absorbs part of that growth.
- Un-intercepted parties **raid a settlement**: Ashford loses its cheap spears, Brindle its cheap
  archers, Coldwell its free healing, until you clear the raiders. Interception becomes a
  defensive objective instead of a gold faucet, and *which camp first* becomes a real route call.
- Show elapsed days on the HUD so escalation is legible before it bites.

This is the largest single addition to replay value, and it reuses the existing party/camp
systems rather than adding new ones.

### 5. Fix the two moments that read as broken *(polish)*

- **Last stand:** when the hero falls with troops still standing, don't hard-lose. Let the fight
  run on for a few seconds — win reads as "your men avenged you," loss as a retreat with
  survivors. A campaign defeat while 11 of 12 men are alive reads as a bug, not a consequence.
- **Skippable end banner:** accept `Enter`/click after a ~0.8 s readability floor, matching the
  pattern the intro state already uses.
