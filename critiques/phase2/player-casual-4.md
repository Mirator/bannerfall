# Casual Playtester #4 — Bannerfall Session Report

Persona: relaxing-mobile-games player (Stardew, match-3, Kingdom Two Crowns on easy). No Thronefall/Bannerlord history. Learns by poking, not manuals.

**Note on the session:** partway through, the browser tab and game server dropped (infra/save glitch on the test harness side, not a game bug) and I got bounced back to a fresh run at the title screen mid-playtest. Annoying, but I don't hold it against the game — noting it here for the record, not counting it in the verdict below. Everything after the restart is a second run; the first run's events are folded into the diary since they're genuine playtest experience.

## Session diary

**0:00** — Title screen. Clean, readable: "Raise a warband. Raze the camps. Take Wolfsjaw Hold." Controls are all spelled out right there — WASD, mouse aim, LMB swing, SPACE dash, troop orders 1/2/3, even a strategy tip ("troops fight harder near your banner") and a warning that fights can be lost ("Pick fights you can win. Ride west mid-battle to retreat."). As someone who hates games that make you fumble through a manual, this is exactly the kind of upfront honesty I want. Pressed Enter.

**0:15** — Dropped into the overworld next to my little banner-guy and a objective banner reading "Raze the bandit camps (0/3) to unlock Wolfsjaw." Goal is instantly clear. HUD shows gold, troop count (4/12), health. Found the village of Ashford right next to me with a recruit menu (Q/E/F) shown right on the ground — no menus to dig through. Recruited a few spearmen and an archer. Straightforward and satisfying — I like that recruiting costs a resource I can see myself earning back through fights.

**0:45 (first run)** — Wandered south, ran into a small roaming bandit pack. The screen transitioned into a proper battle arena (different color palette, a "Slain X/Y" counter, and the 1/2/3 troop order bar). Ordered CHARGE, and my little army just... won. "VICTORY, +35 gold, 5 slain, no losses." Clean, satisfying, no busywork needed from me. Delight moment.

**1:30 (first run)** — Approached the nearby bandit camp. It showed a clear label before I committed: "garrison ~7 vs your 10 (a fair fight)." Loved this — it's telling me exactly what I'm walking into instead of making me guess. Raided it, won without losing anyone, got "Camp razed (1/3)! 2 freed captives join your warband," and a solid gold payout. This was the best moment of the session — the game respects my time and tells me the odds.

**2:30 (first run)** — Recruited to full (12/12) at the second village, Brindle. Then went looking for more fights and stumbled into a roaming pack marked only with a plain number icon ("9") — no odds shown, unlike the camps. Charged in. Lost the ENTIRE 12-troop warband down to a 1v2 finish, and the recap showed I'd gone from full health to half health in the process. Big rage moment — nothing told me this fight was worse odds than the "fair fight" camp I'd just cleared. The camp assault UI trained me to expect a risk read-out before I commit; roaming packs don't give you one until you're already locked into the fight.

**3:00 (first run)** — Limped back to Ashford, paid to rest & heal (full HP restored instantly for 10g — nice, no long downtime), recruited back up partway. Wallet was down to single digits of gold. Went looking for an easier fight this time.

**3:45 (first run)** — Another roaming pack, this time I used HOLD instead of CHARGE, letting them come to me. Worked much better at first (killed 4 of 7 for zero losses), but then it ground down — my warband dropped from 6 to 3 to 1 while still stuck at "4/7 slain." A "ride west: RETREAT" prompt appeared on screen, which I hadn't noticed before — I used it. Good that it's there, but it only became visible once I was already almost wiped, not as an available option earlier. **[Session interrupted here by the tab/server drop.]**

**Restart, 0:00–1:00 (second run)** — Fresh run, same starting map layout (title screen, Ashford, same enemies in the same spots — so the world seed doesn't reshuffle, which is fine, if maybe a little repetitive on a re-launch). Recruited at Ashford again.

**1:30** — Approached the first bandit camp (garrison ~8 vs my ~9, no explicit "fair fight" label shown this time but odds looked close). Fight auto-started when I got close; used HOLD, cleared 8 of 9 defenders for zero losses — going great.

**2:00** — Then, immediately after essentially winning that camp fight, a banner popped up: **"AMBUSHED! Roaming party — worth loot, no camp progress. 6 vs 5."** A *second*, unrelated enemy group jumped me while I was mid-camp-clear. I fought it off but lost most of my warband (12 → 2) and half my health, and — this is the real sting — **the original camp did NOT get credited as razed**, even though I'd killed 8 of its 9 defenders. Big rage moment #2: you can do 90% of the work clearing a camp, get blindsided by a wholly separate patrol, and lose the progress entirely with nothing to show but bruises. At least this ambush *did* show me a strength comparison ("6 vs 5") — so the game clearly can show odds for roaming fights, it just doesn't do it consistently, and never before you're already committed.

**2:45** — Rested/healed at Ashford again, rebuilt with what little gold I had, went back to the same camp (still there, garrison ~5 vs my 7 this time — a "fair fight" per the label). Raided it clean — no losses, "Camp razed (1/3)!" plus captives and gold. Nice bounce-back.

**3:30** — Recruited to full again at Brindle, pushed toward the second camp. Found it heavily guarded: FOUR separate roaming patrols (5, 5, 7, 10) ringing a camp labeled "garrison ~17." Approached the camp itself and got the clearest, most useful message of the whole session: **"Bandit camp — garrison ~17 vs your 15 (⚠ they outmatch you — recruit first?)."** This is exactly the kind of guardrail that should exist everywhere in this game. I heeded it and backed off rather than risk another full-warband wipeout, since I was already capped at 12/12 troops and couldn't actually "recruit first" in any meaningful way at this location.

**4:15** — Retreated to safety with the patrols now flashing "!" alert icons (they'd noticed me), full health, full troops, 1/3 camps down. Ended the session here rather than risk another chain-ambush for a stat check that already warned me off.

## Confusion list
- HUD troop counter ("7/12") and the round banner-strength number above my hero's head (showing "10," "15," etc.) are two different numbers with no explanation of what the second one represents. I assumed they were the same "troop count" at first and it took several fights to realize they track different things.
- Roaming bandit packs on the overworld map show only a plain number bubble (no risk assessment), while bandit camps show a full "garrison X vs your Y (fair fight / outmatched)" readout. This inconsistency cost me a full-warband wipeout early on — I'd been trained by the camp UI to expect odds before committing, then got blindsided when roaming packs didn't offer the same courtesy.
- The "ride west: RETREAT" prompt only appeared once I was already down to 1 troop and clearly losing — I didn't know retreat was an active option earlier in a fight, even though the title screen had mentioned it in passing.
- After the ambush, my nearly-finished bandit camp (8/9 slain) reset back to full garrison strength with zero progress credited. It wasn't clear whether the camp respawns its garrison after any interruption, or whether I needed to personally deliver the final blow uninterrupted — either way it wasn't explained and it stung.

## Delight list
- Title screen tells you everything up front — controls, goal, and even a tactical tip ("Pick fights you can win") — no hunting through a settings menu.
- Camp raids showing "garrison ~X vs your Y (a fair fight)" or "(they outmatch you — recruit first?)" before you commit is genuinely great, respectful design. It's the single best UI element in the game.
- Clean victory recaps ("+35 gold, 5 slain, no losses") give instant, satisfying feedback with no fuss.
- Rest & heal at a village is instant and cheap (10g for a full heal) — no punishing downtime for a casual player who wants to keep moving.
- Freed captives joining your warband after a camp raid is a nice flavor touch that makes victories feel like they matter to the world, not just a stat tick.

## Rage list
- Losing an entire 12-troop warband to an unlabeled roaming pack with zero advance warning, when every camp fight up to that point had trained me to expect an odds check first.
- Getting ambushed by a second, unrelated enemy group mid-camp-clear and losing the camp progress entirely despite having killed 8 of 9 defenders — all that effort erased by bad luck rather than a mistake I could learn from.

## Quit-or-hooked verdict

**Hooked, cautiously** — but it was close. The flip moment was the second run's "Bandit camp — garrison ~17 vs your 15 (⚠ they outmatch you — recruit first?)" warning. Up to that point I'd had one game-breaking, no-warning wipeout (first run) and one progress-erasing ambush (second run) that would have been enough for me to close the tab on a lot of games. But that explicit warning message told me the game *does* know how to communicate risk clearly — it's just inconsistent about doing so for roaming patrols versus camps — and that gave me enough trust to want to keep going and find the "recruit first" path rather than assume every fight from here out is a coin flip. If that message hadn't existed, or if I'd hit the ~17 camp blind the way I hit the roaming packs, I'd have quit right after the second big loss.

## Recommend to a friend?

Conditionally yes — "it's a fun little army-builder, but expect to get blindsided once or twice before you learn roaming bandits are riskier than they look; camps are more honest about warning you." I'd tell a friend who hates unfair deaths to stick to camp raids and treat every unlabeled enemy icon on the map as a coin flip until proven otherwise.

## Fun score: 6/10

The core loop — recruit, raid a labeled camp, get a clean and satisfying payout — is genuinely fun and respects a casual player's time when it works as advertised. The presentation is charming and readable, and the "fair fight" / "they outmatch you" camp labels are a standout piece of design I wish applied everywhere. But the game loses points for inconsistency: the same risk-communication the camp system does so well is simply absent for roaming bandit packs, which is where both of my worst moments came from — a total wipeout and a stolen near-completion via ambush. A casual player who plays relaxing, low-stress games will bounce off the second or third time a fight goes sideways with no warning, even though the underlying combat is generally over quickly and the recovery loop (rest & heal, recruit) is cheap and painless. If roaming-pack odds were shown as consistently as camp odds, this would easily be a 7-8.
