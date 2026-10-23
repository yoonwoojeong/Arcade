import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  DEFAULT_KEYMAP,
  actionForKey,
  swipeAction,
  createInput,
} from '../../web/input.js';

const key = (code, repeat = false) =>
  Object.assign(new Event('keydown', { cancelable: true }), { code, repeat });
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
