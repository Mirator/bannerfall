export const ACTIONS = Object.freeze({
  MOVE_UP: 'moveUp', MOVE_DOWN: 'moveDown', MOVE_LEFT: 'moveLeft', MOVE_RIGHT: 'moveRight',
  ATTACK: 'attack', DASH: 'dash', COMMAND_FOLLOW: 'commandFollow', COMMAND_CHARGE: 'commandCharge', COMMAND_HOLD: 'commandHold',
  SQUAD_CYCLE: 'squadCycle',
  // Plan 030: the ONE campaign-map verb (E). It used to mean "buy an archer" at a
  // settlement and "open the assault brief" at a camp, alongside six more one-service
  // hotkeys (Q/R/F/T/G/B). All of those are gone: E now opens the site menu, and every
  // service is a row in it, chosen with MENU_UP/MENU_DOWN and CONFIRM. Deleting them
  // rather than leaving them bound also clears KeyR's collision with ABANDON_RUN.
  WORLD_PRIMARY: 'worldPrimary',
  CONFIRM: 'confirm', MENU_UP: 'menuUp', MENU_DOWN: 'menuDown', MENU_BACK: 'menuBack',
  CONTINUE_RUN: 'continueRun', NEW_HARD_RUN: 'newHardRun', PAUSE: 'pause', MUTE: 'mute', ABANDON_RUN: 'abandonRun',
  // Plan 021: cancel a pre-battle brief, and (Plan 030) close the site menu. Not
  // WORLD_PRIMARY — the same held KeyE that opened the menu would also satisfy the battle
  // intro's early-out — and not bound to Escape/PAUSE's keys (PAUSE already owns Escape
  // and is handled first).
  WITHDRAW: 'withdraw',
});

export const DEFAULT_BINDINGS = Object.freeze({
  [ACTIONS.MOVE_UP]: ['KeyW', 'ArrowUp'], [ACTIONS.MOVE_DOWN]: ['KeyS', 'ArrowDown'],
  [ACTIONS.MOVE_LEFT]: ['KeyA', 'ArrowLeft'], [ACTIONS.MOVE_RIGHT]: ['KeyD', 'ArrowRight'],
  [ACTIONS.ATTACK]: ['KeyJ'], [ACTIONS.DASH]: ['Space', 'ShiftLeft'],
  [ACTIONS.COMMAND_FOLLOW]: ['Digit1'], [ACTIONS.COMMAND_CHARGE]: ['Digit2'], [ACTIONS.COMMAND_HOLD]: ['Digit3'],
  // Tab is already in the engine's preventDefault list, so it cannot pull focus off the canvas.
  [ACTIONS.SQUAD_CYCLE]: ['Tab'],
  [ACTIONS.WORLD_PRIMARY]: ['KeyE'],
  [ACTIONS.CONFIRM]: ['Enter'], [ACTIONS.MENU_UP]: ['KeyW', 'ArrowUp'], [ACTIONS.MENU_DOWN]: ['KeyS', 'ArrowDown'],
  [ACTIONS.MENU_BACK]: ['Escape'], [ACTIONS.CONTINUE_RUN]: ['KeyC'], [ACTIONS.NEW_HARD_RUN]: ['KeyH'],
  [ACTIONS.PAUSE]: ['Escape', 'KeyP'], [ACTIONS.MUTE]: ['KeyM'], [ACTIONS.ABANDON_RUN]: ['KeyR'],
  [ACTIONS.WITHDRAW]: ['KeyX'],
});
