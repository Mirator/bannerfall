export const ACTIONS = Object.freeze({
  MOVE_UP: 'moveUp', MOVE_DOWN: 'moveDown', MOVE_LEFT: 'moveLeft', MOVE_RIGHT: 'moveRight',
  ATTACK: 'attack', DASH: 'dash', COMMAND_FOLLOW: 'commandFollow', COMMAND_CHARGE: 'commandCharge', COMMAND_HOLD: 'commandHold',
  SQUAD_CYCLE: 'squadCycle',
  RECRUIT_SPEAR: 'recruitSpear', WORLD_PRIMARY: 'worldPrimary', RECRUIT_KNIGHT: 'recruitKnight', HEAL: 'heal', EXPAND_ARMY: 'expandArmy',
  CONFIRM: 'confirm', MENU_UP: 'menuUp', MENU_DOWN: 'menuDown', MENU_BACK: 'menuBack',
  CONTINUE_RUN: 'continueRun', NEW_HARD_RUN: 'newHardRun', PAUSE: 'pause', MUTE: 'mute', ABANDON_RUN: 'abandonRun',
  // Plan 021: cancel a pre-battle brief. Not WORLD_PRIMARY (the same held KeyE that
  // opened a camp brief would also satisfy the battle intro's early-out) and not
  // bound to Escape/PAUSE's keys (PAUSE already owns Escape and is handled first).
  WITHDRAW: 'withdraw',
});

export const DEFAULT_BINDINGS = Object.freeze({
  [ACTIONS.MOVE_UP]: ['KeyW', 'ArrowUp'], [ACTIONS.MOVE_DOWN]: ['KeyS', 'ArrowDown'],
  [ACTIONS.MOVE_LEFT]: ['KeyA', 'ArrowLeft'], [ACTIONS.MOVE_RIGHT]: ['KeyD', 'ArrowRight'],
  [ACTIONS.ATTACK]: ['KeyJ'], [ACTIONS.DASH]: ['Space', 'ShiftLeft'],
  [ACTIONS.COMMAND_FOLLOW]: ['Digit1'], [ACTIONS.COMMAND_CHARGE]: ['Digit2'], [ACTIONS.COMMAND_HOLD]: ['Digit3'],
  // Tab is already in the engine's preventDefault list, so it cannot pull focus off the canvas.
  [ACTIONS.SQUAD_CYCLE]: ['Tab'],
  [ACTIONS.RECRUIT_SPEAR]: ['KeyQ'], [ACTIONS.WORLD_PRIMARY]: ['KeyE'], [ACTIONS.RECRUIT_KNIGHT]: ['KeyR'],
  [ACTIONS.HEAL]: ['KeyF'], [ACTIONS.EXPAND_ARMY]: ['KeyT'],
  [ACTIONS.CONFIRM]: ['Enter'], [ACTIONS.MENU_UP]: ['KeyW', 'ArrowUp'], [ACTIONS.MENU_DOWN]: ['KeyS', 'ArrowDown'],
  [ACTIONS.MENU_BACK]: ['Escape'], [ACTIONS.CONTINUE_RUN]: ['KeyC'], [ACTIONS.NEW_HARD_RUN]: ['KeyH'],
  [ACTIONS.PAUSE]: ['Escape', 'KeyP'], [ACTIONS.MUTE]: ['KeyM'], [ACTIONS.ABANDON_RUN]: ['KeyR'],
  [ACTIONS.WITHDRAW]: ['KeyX'],
});
