export const ACTIONS = ['up', 'down', 'left', 'right', 'primary', 'secondary', 'pause'];

export const DEFAULT_KEYMAP = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Enter: 'primary',
  Space: 'primary',
  ShiftLeft: 'secondary',
  ShiftRight: 'secondary',
  KeyX: 'secondary',
  KeyP: 'pause',
};

const NO_REPEAT = new Set(['primary', 'secondary', 'pause']);

// Shift is also a modifier (Shift+Tab, Shift+click): it acts only when tapped on its own.
const TAP_KEYS = new Set(['ShiftLeft', 'ShiftRight']);

// Elements whose keys belong to the browser (Enter/Space activate a button, typing in a field).
// A game can hand an element's keys to ctx.input with the data-game-keys attribute.
const INTERACTIVE =
  'button, a[href], input, select, textarea, [contenteditable]:not([contenteditable="false"])';
const GAME_KEYS_ATTR = 'data-game-keys';

function hasNativeKeys(eventTarget, inputTarget) {
  const el = eventTarget?.closest?.(INTERACTIVE);
  return Boolean(el) && el !== inputTarget && !el.hasAttribute?.(GAME_KEYS_ATTR);
}

const hasModifier = (e) => e.ctrlKey || e.metaKey || e.altKey;

export function actionForKey(code, keymap = DEFAULT_KEYMAP) {
  return Object.hasOwn(keymap, code) ? keymap[code] : null;
}

export function swipeAction(dx, dy, threshold = 30) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return 'primary';
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export function createInput(target, { keymap = DEFAULT_KEYMAP } = {}) {
  const handlers = new Map();
  let enabled = true;
  let start = null;
  let pendingTap = null; // code of a Shift key pressed with nothing else since

  function emit(action) {
    if (!enabled) return;
    for (const fn of [...(handlers.get(action) ?? [])]) fn({ action });
  }

  function onKeyDown(e) {
    const tap = TAP_KEYS.has(e.code);
    if (!(tap && e.repeat)) pendingTap = null; // any other key cancels a pending tap
    if (!enabled || hasModifier(e) || hasNativeKeys(e.target, target)) return;
    const action = actionForKey(e.code, keymap);
    if (!action) return;
    if (tap) {
      if (!e.repeat) pendingTap = e.code;
      return;
    }
    e.preventDefault();
    if (e.repeat && NO_REPEAT.has(action)) return;
    emit(action);
  }

  function onKeyUp(e) {
    const code = pendingTap;
    pendingTap = null;
    if (code !== e.code || !enabled || hasModifier(e)) return;
    const action = actionForKey(code, keymap);
    if (action) emit(action);
  }

  function onTouchStart(e) {
    const t = e.changedTouches?.[0];
    start = t ? { x: t.clientX, y: t.clientY } : null;
  }

  function onTouchEnd(e) {
    const t = e.changedTouches?.[0];
    if (!start || !t) return;
    const { x, y } = start;
    start = null;
    emit(swipeAction(t.clientX - x, t.clientY - y));
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('touchstart', onTouchStart);
  target.addEventListener('touchend', onTouchEnd);

  return {
    on(action, fn) {
      if (!handlers.has(action)) handlers.set(action, new Set());
      handlers.get(action).add(fn);
    },
    off(action, fn) {
      handlers.get(action)?.delete(fn);
    },
    emit,
    setEnabled(v) {
      enabled = Boolean(v);
      if (!enabled) {
        start = null;
        pendingTap = null;
      }
    },
    destroy() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('touchstart', onTouchStart);
      target.removeEventListener('touchend', onTouchEnd);
      handlers.clear();
      start = null;
      pendingTap = null;
    },
  };
}
