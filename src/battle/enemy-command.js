// Plan 027: the other side's commander.
//
// The phase-4 audit measured the real defect precisely: enemy damage x2, x3, x4, focus
// fire, pincer spawns, staggered waves and even a fully passive PLAYER troop AI all failed
// to stop an idle hero winning, because both AIs converge to melee and the arithmetic
// resolves itself from either side. Nothing here touches a stat. It changes who picks the
// engagement — the enemy now has squads, the same three stances the player has, and
// someone deciding between them from battle state.
//
// Everything in this module is a pure function of `battle` plus one dedicated RNG stream.
// It reads no presentation state (never the camera, never a screen-space transform), takes
// no wall-clock, and draws nothing from `simRng`, so a commander change cannot shift the
// draw sequence the rest of the battle depends on.
import { clamp, dist2, makeRng, deriveSeed, RNG_DOMAINS } from '../engine.js?v=rfdf6abae5ce0';
import {
  ENEMY_SQUAD_TYPES, CMD_TICK, CMD_STANDOFF, CMD_ANCHOR_JITTER, CMD_COVER_R, CMD_COVER_PULL,
  CMD_RANK_GAP, CMD_ROW_GAP, CMD_COL_GAP, BLOB_SPREAD, CMD_FLANK_ANGLE,
  CMD_BLOOD_FRAC, CMD_NERVE_MIN, CMD_NERVE_SPAN,
  CMD_FORMED_FRAC, CMD_SLOT_TOL, CMD_FORM_MAX,
  WOLF_ISOLATION_MUL, WOLF_ISOLATION_PAD, ENGAGE_GAP,
} from './constants.js?v=rfdf6abae5ce0';

// Which rank of the formed line a type stands in. Only the types that muster appear here;
// see mustersInLine below for who does and why.
const RANK = Object.freeze({ bandit: 0, brute: 1 });

// Who stands in the line at all. A bow is already at its working range wherever it is, and
// marching it to a slot behind the melee was measured to put it out of its own 210 range
// and out of the fight; a wolf that stands in a line is a slow bandit with a quarter of the
// hit points. Both fight from where their archetype wants to be, so neither is waited for
// at the muster and neither walks to a slot. Single source for both the readiness count
// here and the `hold` branch in ai-phases.js.
export function mustersInLine(e) {
  return !e.d.ranged && e.type !== 'wolf';
}

// The orders each doctrine issues. Kept as a table rather than a chain of ifs so the whole
// behavioural contract is readable in one place and a new enemy type that is missing here
// simply keeps `follow` (today's AI) instead of silently taking a wrong order.
//
// Note what is NOT here: nothing but `commit` ever puts the bows or the wolves on charge.
// A charging squad pays CHARGE_EXPOSURE, and running a ranged unit or a stalker into a
// melee it is not built for pays that price for nothing. The commander's advantage is
// choosing when the melee happens, not doing more of it.
const DOCTRINE_ORDERS = Object.freeze({
  // Muster. Everyone walks to their slot on the chosen ground and waits there.
  form: { bandit: 'hold', raider: 'hold', brute: 'hold', wolf: 'hold' },
  // The assault, delivered from the muster point. `flank` and `break` issue the same
  // orders and differ only in where the muster point was placed — which is the whole
  // difference between coming round a blob and coming through a thin line.
  flank: { bandit: 'follow', raider: 'hold', brute: 'follow', wolf: 'hold' },
  break: { bandit: 'follow', raider: 'hold', brute: 'follow', wolf: 'hold' },
  // Press: everyone drops what they were doing and goes for the nearest target with no
  // stance bonus either way. This is the pre-027 AI exactly, and it is what the commander
  // falls back to when the fight is no longer its decision — the stall clock forcing a
  // close, or a hold objective that has to be contested. Deliberately NOT `charge`:
  // bloodlust is the engine ending a grind, and making the enemy eat CHARGE_EXPOSURE for
  // the rest of every long fight measured as a straight gift to the player (camp-raid idle
  // win rate rose from 75% to 89% on that alone).
  press: { bandit: 'follow', raider: 'follow', brute: 'follow', wolf: 'follow' },
  // Everything in, shields down. The ONE doctrine that pays charge exposure, and it is
  // reached only when the player's warband is broken enough that the exposure cannot be
  // punished — which is exactly when a commander should be spending it.
  commit: { bandit: 'charge', raider: 'charge', brute: 'charge', wolf: 'charge' },
});

const DOCTRINE_CRY = Object.freeze({
  form: { text: 'THEY FORM UP!', horn: 175 },
  flank: { text: 'THEY COME ROUND!', horn: 147 },
  break: { text: 'THEY PUSH THROUGH!', horn: 165 },
  press: { text: 'THEY CLOSE IN!', horn: 110 },
  commit: { text: 'THEY COMMIT!', horn: 131 },
});

export function buildEnemyCommand(battle, seed) {
  battle.enemySquads = Object.create(null);
  for (const type of ENEMY_SQUAD_TYPES) {
    battle.enemySquads[type] = { stance: 'follow', anchorX: null, anchorY: null };
  }
  const rng = makeRng(deriveSeed(seed, RNG_DOMAINS.ENEMY_COMMAND));
  battle.enemyCmd = {
    rng,
    t: 0,
    doctrine: 'follow',
    // Per-battle temperament: one garrison commits earlier than another, so a fixture does
    // not play out identically at every seed. Drawn once, never re-rolled mid-fight.
    nerve: CMD_NERVE_MIN + rng() * CMD_NERVE_SPAN,
    // The muster is a one-way gate: once the assault goes in the commander never re-forms.
    // That is what bounds fight duration — see the comment at the gate itself.
    assaulting: false,
    anchorX: battle.W / 2, anchorY: battle.H / 2,
    // Unit vector from the player's centre of mass toward the muster point. Equal to the
    // approach axis for a frontal assault, rotated off it for a flanking one; the formed
    // line's ranks and columns are laid out against THIS, not against the approach, so a
    // flanking line faces the player rather than standing sideways to him.
    dirX: battle.adx, dirY: battle.ady,
    // Player centre of mass and mean spread, recomputed once per DECISION, never per unit.
    // The archetype paths in ai-phases.js read these instead of doing their own scans.
    cx: battle.hero.x, cy: battle.hero.y, spread: 0,
  };
  assignEnemySlots(battle);
}

// Formation slots for the enemy line, mirroring Battle.assignSlots(): melee in the front
// ranks, ranged behind, five to a row. Deliberately assigned ONCE and never rebuilt on a
// death, unlike the player's — a gap in a line where a man fell is correct, and rebuilding
// per death would make every enemy shuffle sideways each time one of them dies.
export function assignEnemySlots(battle) {
  const byType = Object.create(null);
  for (const e of battle.enemies) {
    const list = byType[e.type] || (byType[e.type] = []);
    e.eslot = { row: Math.floor(list.length / 5), col: list.length % 5, rowCount: 1 };
    list.push(e);
  }
  for (const type of Object.keys(byType)) {
    const list = byType[type];
    for (const e of list) {
      e.eslot.rowCount = Math.min(5, list.length - e.eslot.row * 5);
    }
  }
}

// One source for the rank/row/column projection that both the muster anchor and the
// Plan 033 deployment placement stand on — retuning a gap constant must move both the
// same way, and only one of the two is covered by isFormedUp's tolerance check.
// Module-level scratch, consumed synchronously by each caller: enemyAnchorFor runs per
// enemy per tick, so this must not allocate (same rule as _enemyAnchorScratch itself).
const _slotScratch = { back: 0, side: 0 };
function slotOffset(rank, slot) {
  _slotScratch.back = rank * CMD_RANK_GAP + slot.row * CMD_ROW_GAP;
  _slotScratch.side = (slot.col - (slot.rowCount - 1) / 2) * CMD_COL_GAP;
  return _slotScratch;
}

// Plan 033: the enemy's own deployment. A battle with a deployment phase spawns its force
// already formed instead of seeded-scattered: melee ranks toward the player (RANK order,
// same table the muster uses), raiders one rank further back, wolves split onto the wings.
// The raider rank and the wolf wings are PLACEMENT-ONLY: neither type ever consumes
// enemyAnchorFor (mustersInLine excludes both), so nothing later steers them to different
// slots — the tableau shows each archetype roughly where its own AI will fight from.
// Pure geometry over the eslots assignEnemySlots() already assigned — no RNG at all, so it
// consumes nothing from any stream and two builds of the same roster place identically.
// Fights without the phase (ambush, caught-fleeing, deploy:0 fixtures) never call this and
// keep the legacy scatter: an ambush pincer has no parade formation by definition.
export function placeEnemyDeployment(battle) {
  const ax = battle.adx, ay = battle.ady;
  // The line's centre: the enemy spawn centre the scatter used, one expression. It is also
  // the exact point Break-objective guards muster on (objectives.js's ecx/ecy), and guards
  // are not obstacles, so nothing resolves an overlap while the phase is paused — measured,
  // a 3-guard line's middle tower sits at distance 0.0 from rank-0's centre column. The
  // whole formation therefore stands one clear step behind the guard line when one exists.
  const cx = battle.W / 2 + ax * ENGAGE_GAP / 2;
  const cy = battle.H / 2 + ay * ENGAGE_GAP / 2;
  const baseBack = battle.objectiveTargets && battle.objectiveTargets.length ? 70 : 0;
  // Wing offset for the wolves: just outside the widest formed row (5 columns).
  const wing = (5 / 2) * CMD_COL_GAP + 110;
  let wolves = 0;
  for (const e of battle.enemies) {
    const slot = e.eslot || { row: 0, col: 0, rowCount: 1 };
    let back, side;
    if (e.type === 'wolf') {
      // Alternate wings so a pack threatens both flanks; pairs stack backward.
      const sign = wolves % 2 === 0 ? 1 : -1;
      back = baseBack + Math.floor(wolves / 2) * CMD_ROW_GAP;
      side = sign * (wing + slot.row * 40);
      wolves++;
    } else {
      const o = slotOffset(e.d.ranged ? 2 : (RANK[e.type] || 0), slot);
      back = baseBack + o.back;
      side = o.side;
    }
    e.x = clamp(cx + ax * back - ay * side, 40, battle.W - 40);
    e.y = clamp(cy + ay * back + ax * side, 40, battle.H - 40);
    e.facing = Math.atan2(-ay, -ax); // face the player's line
  }
}

export function enemyStance(battle, e) {
  const squad = battle.enemySquads && battle.enemySquads[e.type];
  return squad ? squad.stance : 'follow';
}

// The point this enemy stands on when its squad is holding: the commander's anchor, pushed
// back along the approach axis by its rank and formation row, and sideways by its column.
// `adx/ady` point from the player toward the enemy, so adding them moves further from the
// player — i.e. behind the line, which is what a rank offset means.
export function enemyAnchorFor(battle, e, out) {
  const cmd = battle.enemyCmd;
  const slot = e.eslot || { row: 0, col: 0, rowCount: 1 };
  const o = slotOffset(RANK[e.type] || 0, slot);
  out.x = clamp(cmd.anchorX + cmd.dirX * o.back - cmd.dirY * o.side, 40, battle.W - 40);
  out.y = clamp(cmd.anchorY + cmd.dirY * o.back + cmd.dirX * o.side, 40, battle.H - 40);
  return out;
}

// Is this friendly hanging out where the pack can take it alone? Measured against the
// warband's own mean spread rather than an absolute radius, so it means the same thing for
// a tight four-man line and a loose twelve-man one. Costs nothing: both terms were already
// computed by the last decision.
export function isIsolated(battle, target) {
  const cmd = battle.enemyCmd;
  const d = Math.sqrt(dist2(target.x, target.y, cmd.cx, cmd.cy));
  return d > cmd.spread * WOLF_ISOLATION_MUL + WOLF_ISOLATION_PAD;
}

export function updateEnemyCommandPhase(battle, dt) {
  const cmd = battle.enemyCmd;
  if (!cmd) return;
  // Plan 033: no deploy-window guard needed — the deployment phase pauses the whole tick
  // pipeline, so this phase simply never runs until the player confirms.
  if (battle.enemies.length === 0) return;
  cmd.t += dt;
  if (cmd.t < CMD_TICK) return;
  cmd.t = 0;
  decide(battle);
}

function decide(battle) {
  const cmd = battle.enemyCmd, troops = battle.troops, h = battle.hero;
  // Centre of mass over the player's whole live force, the hero included: he is a body on
  // the field and a commander reading the line would not pretend otherwise.
  let cx = h.x, cy = h.y, n = 1;
  for (let i = 0; i < troops.length; i++) { cx += troops[i].x; cy += troops[i].y; n++; }
  cx /= n; cy /= n;
  let spread = 0;
  for (let i = 0; i < troops.length; i++) spread += Math.sqrt(dist2(troops[i].x, troops[i].y, cx, cy));
  spread = troops.length ? spread / troops.length : 0;
  cmd.cx = cx; cmd.cy = cy; cmd.spread = spread;

  // Which assault this force is building toward decides where it musters, so the read
  // happens before the anchor is placed, not after.
  const assault = spread < BLOB_SPREAD ? 'flank' : 'break';
  setAnchor(battle, cx, cy, assault);

  const troopFrac = battle.startTroops ? troops.length / battle.startTroops : 1;

  let doctrine;
  if (battle.bloodlust) {
    // The stall clock owns the fight from here. Its guarantee — a fight in which nobody
    // has died for STALL_NO_DEATH seconds always closes — is exactly what makes a
    // deliberately patient enemy safe to ship, so the commander never argues with it.
    doctrine = 'press';
  } else if (battle.objective && battle.objective.kind === 'hold') {
    // A hold objective is the player defending ground. An enemy that musters politely
    // out of the zone does not contest it, the defender's clock runs out unopposed, and
    // the objective stops being an objective. Contesting it is the whole fight.
    doctrine = 'press';
  } else if (troopFrac <= CMD_BLOOD_FRAC * cmd.nerve) {
    doctrine = 'commit';
  } else if (cmd.assaulting) {
    doctrine = assault;
  } else if (isFormedUp(battle) || battle.time >= CMD_FORM_MAX) {
    // The muster is over: everyone who is coming has arrived, or the clock ran out on
    // waiting for the stragglers. Monotone on purpose — once the assault is ordered the
    // commander never falls back to forming up, so fight duration stays bounded and the
    // player cannot be made to chase a force that re-musters forever.
    cmd.assaulting = true;
    doctrine = assault;
  } else {
    doctrine = 'form';
  }

  const orders = DOCTRINE_ORDERS[doctrine];
  for (const type of ENEMY_SQUAD_TYPES) {
    const squad = battle.enemySquads[type];
    if (squad && orders[type]) squad.stance = orders[type];
  }
  if (doctrine !== cmd.doctrine) {
    cmd.doctrine = doctrine;
    // Legibility, on the mechanism player orders already use: no new HUD element, no new
    // draw pass. A player who is paying attention is told what the other side just did.
    // It cannot fire before CMD_TICK, which is why no visual baseline can see it.
    const cry = DOCTRINE_CRY[doctrine];
    battle.commandFlash = { text: cry.text, t: 1.0 };
    battle.game.sfx.horn(cry.horn);
  }
}

// Has enough of the force reached its slot for the assault to go in together? This is the
// mechanic the whole plan rests on, so it is measured, not assumed: an enemy that arrives
// as one body fights the player's whole warband at once, where an enemy delivered in the
// order of its unit speeds fights it one man at a time and loses the same fight.
function isFormedUp(battle) {
  const enemies = battle.enemies;
  const tol2 = CMD_SLOT_TOL * CMD_SLOT_TOL;
  const scratch = battle._enemyAnchorScratch;
  let ready = 0, mustering = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!mustersInLine(e)) continue;
    mustering++;
    const a = enemyAnchorFor(battle, e, scratch);
    if (dist2(e.x, e.y, a.x, a.y) <= tol2) ready++;
  }
  // An all-bow, all-wolf force has nothing to muster and is ready the moment it is asked.
  // Counting the whole roster here instead would have made such a force wait out
  // CMD_FORM_MAX every time for a line it was never going to form.
  if (mustering === 0) return true;
  return ready >= mustering * CMD_FORMED_FRAC;
}

// Where the force musters: on the enemy's own side of the player's centre of mass, rotated
// off the approach axis when the assault is going round a blob's flank, jittered sideways,
// then pulled toward whatever real Plan 024 cover is within reach. Cover is read-only here
// — this never mutates terrain and never adds a blocker.
//
// The flank side is not random: it is whichever side of the approach axis carries fewer of
// the player's melee, so a warband that leaves one wing thin gets hit on that wing.
function setAnchor(battle, cx, cy, assault) {
  const cmd = battle.enemyCmd;
  let dirX = battle.adx, dirY = battle.ady;
  if (assault === 'flank') {
    // Perpendicular to the approach axis, sign toward the lighter wing.
    const perpX = -battle.ady, perpY = battle.adx;
    let load = 0;
    for (const t of battle.troops) {
      if (t.d.ranged) continue;
      load += (t.x - cx) * perpX + (t.y - cy) * perpY > 0 ? 1 : -1;
    }
    const side = load > 0 ? -1 : 1;
    const a = Math.atan2(battle.ady, battle.adx) + CMD_FLANK_ANGLE * side;
    dirX = Math.cos(a); dirY = Math.sin(a);
  }
  cmd.dirX = dirX; cmd.dirY = dirY;
  const jit = (cmd.rng() - 0.5) * CMD_ANCHOR_JITTER;
  let ax = cx + dirX * CMD_STANDOFF - dirY * jit;
  let ay = cy + dirY * CMD_STANDOFF + dirX * jit;
  const blockers = battle.blockers;
  let best = null, bd = CMD_COVER_R * CMD_COVER_R;
  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i];
    const d = dist2(b.x, b.y, ax, ay);
    if (d < bd) { bd = d; best = b; }
  }
  if (best) {
    ax += (best.x - ax) * CMD_COVER_PULL;
    ay += (best.y - ay) * CMD_COVER_PULL;
  }
  cmd.anchorX = clamp(ax, 60, battle.W - 60);
  cmd.anchorY = clamp(ay, 60, battle.H - 60);
}
