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

  function emit(action) {
    if (!enabled) return;
    for (const fn of [...(handlers.get(action) ?? [])]) fn({ action });
  }

  function onKeyDown(e) {
    if (!enabled) return;
    const action = actionForKey(e.code, keymap);
    if (!action) return;
    e.preventDefault();
    if (e.repeat && NO_REPEAT.has(action)) return;
    emit(action);
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
      if (!enabled) start = null;
    },
    destroy() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('touchstart', onTouchStart);
      target.removeEventListener('touchend', onTouchEnd);
      handlers.clear();
      start = null;
    },
  };
}
