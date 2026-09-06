// Sequential command onboarding (Plan 049). One new tactical idea per battle, in the order a
// player can actually use them, instead of three commands and a placement drag in the first
// thirty seconds of the game.
//
// This module imports nothing and persists nothing. The lesson is DERIVED from
// `save.battleCount`, which the campaign already increments once per fight — the same rule
// perk points follow (`perkPointsEarned`), and for the same reason: a second stored counter
// is a counter that can drift from the campaign it claims to describe. There is no save
// schema change here and none is needed.
//
// `battleNumber` is 1-based and is the fight ABOUT TO BE FOUGHT: `startBattle` increments
// `save.battleCount` before it builds the setup, so the first battle of a campaign is 1.

const freeze = value => Object.freeze(value);

// The order the three commands are taught in, and what each one is for. `hint` is the line
// the deployment banner shows while that command is the lesson; `learned` is what it says
// once the player has actually issued it, which is when the teaching is over.
export const LESSONS = freeze([
  freeze({
    id: 'follow', key: '1',
    hint: '1 FOLLOW — a squad that keeps station on you',
    learned: 'They follow you now · E sounds the advance',
  }),
  freeze({
    id: 'charge', key: '2',
    hint: '2 CHARGE — send a squad in without you',
    learned: 'They will go in hard · E sounds the advance',
  }),
  freeze({
    id: 'hold', key: '3',
    hint: '3 HOLD — a squad that keeps the ground you put it on',
    learned: 'They will hold this ground · E sounds the advance',
  }),
]);

export const LESSON_IDS = freeze(LESSONS.map(l => l.id));

// Everything unlocked and nothing being taught. This is what a Battle built WITHOUT a lesson
// gets — every scenario fixture, the balance sweep and the legacy QA runner included — so
// the onboarding cannot silently change what those measure.
export const NO_LESSON = freeze({ battle: 0, unlocked: freeze([...LESSON_IDS]), teach: null });

export function lessonFor(battleNumber) {
  const n = Math.max(1, Math.floor(battleNumber) || 1);
  // Battle 1 teaches placement and the advance, with no commands at all: the units behave
  // on their FOLLOW default, which is what a player who presses nothing gets anyway.
  const taught = Math.min(LESSONS.length, n - 1);
  const teaching = n - 1 < LESSONS.length ? LESSONS[n - 1] : null;
  return freeze({
    battle: n,
    unlocked: freeze(LESSON_IDS.slice(0, taught)),
    teach: teaching ? teaching.id : null,
  });
}

export function commandUnlocked(lesson, cmd) {
  return (lesson || NO_LESSON).unlocked.includes(cmd);
}

export function lessonCopy(id) {
  return LESSONS.find(l => l.id === id) || null;
}
