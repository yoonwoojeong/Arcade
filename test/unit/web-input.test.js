import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  DEFAULT_KEYMAP,
  actionForKey,
  swipeAction,
  createInput,
} from '../../web/input.js';

const key = (code, repeat = false, extra = {}, type = 'keydown') => {
  const { target, ...props } = extra;
  const e = Object.assign(new Event(type, { cancelable: true }), {
    code,
    repeat,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...props,
  });
  // simulate a key that started on a descendant of the input target
  if (target) Object.defineProperty(e, 'target', { value: target });
  return e;
};
const keyUp = (code, extra = {}) => key(code, false, extra, 'keyup');
// minimal element: closest() matches the given CSS-ish selector parts by tag/attribute
function el(tag, attrs = {}) {
  return {
    tagName: tag.toUpperCase(),
    hasAttribute: (name) => Object.hasOwn(attrs, name),
    getAttribute: (name) => attrs[name] ?? null,
    closest(selector) {
      return selector.split(',').some((part) => matches(this, part.trim())) ? this : null;
    },
  };
}
function matches(node, part) {
  const m = /^([a-z]*)((?:\[[^\]]+\]|:not\(\[[^\]]+\]\))*)$/.exec(part);
  if (!m) throw new Error(`unsupported selector ${part}`);
  if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
  for (const [, not, name, value] of m[2].matchAll(/(:not\()?\[([\w-]+)(?:="([^"]*)")?\]\)?/g)) {
    const has =
      node.hasAttribute(name) && (value === undefined || node.getAttribute(name) === value);
    if (Boolean(not) === has) return false;
  }
  return true;
}
const touch = (type, x, y) =>
  Object.assign(new Event(type, { cancelable: true }), {
    changedTouches: [{ clientX: x, clientY: y }],
  });

test('actionForKey and swipeAction', () => {
  assert.equal(actionForKey('KeyW'), 'up');
  assert.equal(actionForKey('KeyQ'), null);
  assert.equal(actionForKey('KeyZ', { KeyZ: 'pause' }), 'pause');
  assert.equal(swipeAction(50, 10), 'right');
  assert.equal(swipeAction(-50, 10), 'left');
  assert.equal(swipeAction(-5, -40), 'up');
  assert.equal(swipeAction(5, 40), 'down');
  assert.equal(swipeAction(3, 4), 'primary');
  assert.equal(swipeAction(10, 0, 5), 'right');
});

test('keymap only maps known actions', () => {
  for (const a of Object.values(DEFAULT_KEYMAP)) assert.ok(ACTIONS.includes(a));
});

test('createInput dispatches keys, ignores repeat for buttons, prevents default', () => {
  const t = new EventTarget();
  const input = createInput(t);
  const got = [];
  input.on('up', (e) => got.push(e.action));
  input.on('primary', (e) => got.push(e.action));
  const w = key('KeyW');
  t.dispatchEvent(w);
  assert.equal(w.defaultPrevented, true);
  t.dispatchEvent(key('KeyW', true));
  t.dispatchEvent(key('Enter'));
  t.dispatchEvent(key('Enter', true));
  const q = key('KeyQ');
  t.dispatchEvent(q);
  assert.equal(q.defaultPrevented, false);
  assert.deepEqual(got, ['up', 'up', 'primary']);
});

test('createInput off, emit and custom keymap', () => {
  const t = new EventTarget();
  const input = createInput(t, { keymap: { KeyZ: 'left' } });
  const got = [];
  const fn = (e) => got.push(e.action);
  input.on('left', fn);
  t.dispatchEvent(key('KeyZ'));
  t.dispatchEvent(key('KeyW'));
  input.emit('left');
  input.off('left', fn);
  t.dispatchEvent(key('KeyZ'));
  assert.deepEqual(got, ['left', 'left']);
});

test('createInput handles touch swipes and taps', () => {
  const t = new EventTarget();
  const input = createInput(t);
  const got = [];
  for (const a of ACTIONS) input.on(a, (e) => got.push(e.action));
  t.dispatchEvent(touch('touchstart', 100, 100));
  t.dispatchEvent(touch('touchend', 160, 105));
  t.dispatchEvent(touch('touchstart', 100, 100));
  t.dispatchEvent(touch('touchend', 100, 50));
  t.dispatchEvent(touch('touchstart', 100, 100));
  t.dispatchEvent(touch('touchend', 101, 101));
  t.dispatchEvent(touch('touchend', 300, 300));
  assert.deepEqual(got, ['right', 'up', 'primary']);
});

test('setEnabled(false) stops dispatch and preventDefault; destroy removes listeners', () => {
  const t = new EventTarget();
  const input = createInput(t);
  const got = [];
  input.on('up', (e) => got.push(e.action));
  input.setEnabled(false);
  const e1 = key('KeyW');
  t.dispatchEvent(e1);
  input.emit('up');
  assert.equal(e1.defaultPrevented, false);
  assert.deepEqual(got, []);
  input.setEnabled(true);
  t.dispatchEvent(key('KeyW'));
  assert.deepEqual(got, ['up']);
  input.destroy();
  t.dispatchEvent(key('KeyW'));
  assert.deepEqual(got, ['up']);
});

test('keys with Ctrl, Meta or Alt are left to the browser', () => {
  const t = new EventTarget();
  const input = createInput(t);
  const got = [];
  for (const a of ACTIONS) input.on(a, (e) => got.push(e.action));
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    for (const code of ['KeyD', 'Enter', 'ArrowUp', 'KeyX', 'KeyP']) {
      const e = key(code, false, { [mod]: true });
      t.dispatchEvent(e);
      assert.equal(e.defaultPrevented, false, `${mod}+${code}`);
    }
  }
  assert.deepEqual(got, []);
});

test('interactive elements inside the target keep their native keys', () => {
  const t = new EventTarget();
  const input = createInput(t);
  const got = [];
  for (const a of ACTIONS) input.on(a, (e) => got.push(e.action));
  const native = [
    el('button'),
    el('a', { href: '#' }),
    el('input'),
    el('select'),
    el('textarea'),
    el('div', { contenteditable: '' }),
    el('div', { contenteditable: 'true' }),
  ];
  for (const target of native) {
    for (const code of ['Enter', 'Space', 'ArrowDown', 'KeyX', 'KeyP']) {
      const e = key(code, false, { target });
      t.dispatchEvent(e);
      assert.equal(e.defaultPrevented, false, `${target.tagName} ${code}`);
    }
  }
  assert.deepEqual(got, []);

  // the target itself, plain elements and opted-in elements are mapped as usual
  for (const target of [
    t,
    el('div'),
    el('a'),
    el('div', { contenteditable: 'false' }),
    el('button', { 'data-game-keys': '' }),
  ]) {
    const e = key('Enter', false, { target });
    t.dispatchEvent(e);
    assert.equal(e.defaultPrevented, true);
  }
  assert.deepEqual(got, ['primary', 'primary', 'primary', 'primary', 'primary']);
});

test('Shift fires secondary only when pressed and released on its own', () => {
  const t = new EventTarget();
  const input = createInput(t);
  const got = [];
  for (const a of ACTIONS) input.on(a, (e) => got.push(e.action));

  // a lone tap, with key repeat while held
  t.dispatchEvent(key('ShiftLeft', false, { shiftKey: true }));
  t.dispatchEvent(key('ShiftLeft', true, { shiftKey: true }));
  assert.deepEqual(got, []);
  t.dispatchEvent(keyUp('ShiftLeft'));
  assert.deepEqual(got, ['secondary']);
  t.dispatchEvent(keyUp('ShiftLeft')); // a stray keyup does nothing
  assert.deepEqual(got, ['secondary']);

  // Shift+Tab (focus navigation) and Shift+arrow never flag
  t.dispatchEvent(key('ShiftRight', false, { shiftKey: true }));
  const tab = key('Tab', false, { shiftKey: true });
  t.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, false);
  t.dispatchEvent(keyUp('Tab', { shiftKey: true }));
  t.dispatchEvent(keyUp('ShiftRight'));
  t.dispatchEvent(key('ShiftLeft', false, { shiftKey: true }));
  t.dispatchEvent(key('ArrowUp', false, { shiftKey: true }));
  t.dispatchEvent(keyUp('ShiftLeft'));
  assert.deepEqual(got, ['secondary', 'up']);

  // Ctrl+Shift does not flag either
  t.dispatchEvent(key('ControlLeft', false, { ctrlKey: true }));
  t.dispatchEvent(key('ShiftLeft', false, { ctrlKey: true, shiftKey: true }));
  t.dispatchEvent(keyUp('ShiftLeft', { ctrlKey: true }));
  assert.deepEqual(got, ['secondary', 'up']);

  // KeyX fires immediately
  const x = key('KeyX');
  t.dispatchEvent(x);
  assert.equal(x.defaultPrevented, true);
  assert.deepEqual(got, ['secondary', 'up', 'secondary']);

  // Shift on a native button, or released after disabling, does nothing
  const button = el('button');
  t.dispatchEvent(key('ShiftLeft', false, { shiftKey: true, target: button }));
  t.dispatchEvent(keyUp('ShiftLeft', { target: button }));
  t.dispatchEvent(key('ShiftLeft', false, { shiftKey: true }));
  input.setEnabled(false);
  t.dispatchEvent(keyUp('ShiftLeft'));
  input.setEnabled(true);
  t.dispatchEvent(keyUp('ShiftLeft'));
  assert.deepEqual(got, ['secondary', 'up', 'secondary']);

  // destroy removes the keyup listener too
  t.dispatchEvent(key('ShiftLeft', false, { shiftKey: true }));
  input.destroy();
  t.dispatchEvent(keyUp('ShiftLeft'));
  assert.deepEqual(got, ['secondary', 'up', 'secondary']);
});
