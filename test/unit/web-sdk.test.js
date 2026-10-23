import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrefs, PREF_DEFAULTS } from '../../web/prefs.js';
import { createContext, DISPOSE } from '../../web/sdk.js';
import { createInput } from '../../web/input.js';

function mapStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

function make(overrides = {}) {
  const storage = overrides.storage ?? mapStorage();
  const prefs = overrides.prefs ?? createPrefs({ storage: mapStorage() });
  const input = overrides.input ?? createInput(new EventTarget());
  const calls = { sound: [], score: [], announce: [] };
  const ctx = createContext({
    gameId: 'snake',
    root: {},
    input,
    prefs,
    storage,
    announce: (t, o) => calls.announce.push([t, o]),
    playSound: (n) => calls.sound.push(n),
    onScore: (n) => calls.score.push(n),
  });
  return { ctx, calls, storage, prefs, input };
}

test('ctx.storage is namespaced and tolerant', () => {
  const storage = mapStorage();
  const { ctx } = make({ storage });
  ctx.storage.set('best', 5);
  assert.equal(storage.m.get('arcade:snake:best'), '5');
  assert.equal(ctx.storage.get('best'), 5);
  assert.equal(ctx.storage.get('missing'), undefined);
  storage.m.set('arcade:snake:bad', '{nope');
  assert.equal(ctx.storage.get('bad'), undefined);
  storage.setItem = () => {
    throw new Error('quota');
  };
  assert.doesNotThrow(() => ctx.storage.set('x', 1));
  storage.getItem = () => {
    throw new Error('denied');
  };
  assert.equal(ctx.storage.get('x'), undefined);
});

test('sound.play is a no-op when sound is off; reportScore ignores NaN', () => {
  const { ctx, calls, prefs } = make();
  ctx.sound.play('beep');
  assert.deepEqual(calls.sound, []);
  prefs.set({ sound: true });
  ctx.sound.play('beep');
  assert.deepEqual(calls.sound, ['beep']);
  ctx.reportScore(NaN);
  ctx.reportScore(Infinity);
  ctx.reportScore('7');
  ctx.reportScore(12);
  assert.deepEqual(calls.score, [12]);
});

test('ctx exposes exactly the public members, announce and sdkVersion', () => {
  const { ctx, calls, input } = make();
  assert.deepEqual(Object.keys(ctx).sort(), [
    'announce',
    'input',
    'prefs',
    'reportScore',
    'root',
    'sdkVersion',
    'sound',
    'storage',
  ]);
  assert.equal(ctx.sdkVersion, 1);
  assert.deepEqual(Object.keys(ctx.input).sort(), ['off', 'on']);
  ctx.announce('hi', { assertive: true });
  assert.deepEqual(calls.announce, [['hi', { assertive: true }]]);
  assert.equal(typeof ctx[DISPOSE], 'function');
  assert.equal(Object.getOwnPropertyDescriptor(ctx, DISPOSE).enumerable, false);
  input.destroy();
});

test('ctx.prefs is a frozen snapshot refreshed on change', () => {
  const { ctx, prefs } = make();
  const before = ctx.prefs;
  assert.ok(Object.isFrozen(before));
  assert.deepEqual(
    { ...before, onChange: undefined },
    {
      reducedMotion: false,
      highContrast: false,
      sound: false,
      colorblindPalette: false,
      onChange: undefined,
    },
  );
  const seen = [];
  const off = ctx.prefs.onChange((p) => seen.push(p.highContrast));
  prefs.set({ highContrast: true });
  assert.equal(ctx.prefs.highContrast, true);
  assert.equal(before.highContrast, false);
  off();
  prefs.set({ highContrast: false });
  assert.deepEqual(seen, [true]);
});

test('DISPOSE removes leftover input handlers and prefs listeners', () => {
  const { ctx, prefs, input } = make();
  const hits = [];
  const kept = () => hits.push('kept');
  const removed = () => hits.push('removed');
  ctx.input.on('up', kept);
  ctx.input.on('up', removed);
  ctx.input.off('up', removed);
  ctx.prefs.onChange(() => hits.push('pref'));
  input.emit('up');
  assert.deepEqual(hits, ['kept']);
  ctx[DISPOSE]();
  input.emit('up');
  prefs.set({ sound: true });
  assert.deepEqual(hits, ['kept']);
  assert.doesNotThrow(() => ctx[DISPOSE]());
});

test('prefs persist, resolve reducedMotion from matchMedia when null, and notify subscribers', () => {
  const storage = mapStorage();
  const mm = (matches) => () => ({ matches });
  let p = createPrefs({ storage, matchMedia: mm(true) });
  assert.equal(p.get().reducedMotion, true);
  assert.equal(p.get().sound, false);
  assert.equal(PREF_DEFAULTS.reducedMotion, null);
  const seen = [];
  const off = p.onChange((v) => seen.push(v.theme));
  p.set({ theme: 'dark', reducedMotion: false });
  assert.deepEqual(seen, ['dark']);
  assert.equal(p.get().reducedMotion, false);
  off();
  p.set({ theme: 'light' });
  assert.deepEqual(seen, ['dark']);
  assert.equal(JSON.parse(storage.m.get('arcade:prefs')).theme, 'light');
  p = createPrefs({ storage, matchMedia: mm(true) });
  assert.equal(p.get().theme, 'light');
  assert.equal(p.get().reducedMotion, false);
  // no matchMedia → false
  assert.equal(createPrefs({ storage: mapStorage() }).get().reducedMotion, false);
});

test('corrupt or throwing prefs storage falls back to defaults', () => {
  const bad = mapStorage({ 'arcade:prefs': '{oops' });
  const p = createPrefs({ storage: bad });
  assert.equal(p.get().theme, 'system');
  bad.setItem = () => {
    throw new Error('quota');
  };
  assert.doesNotThrow(() => p.set({ sound: true }));
  assert.equal(p.get().sound, true);
  const arr = mapStorage({ 'arcade:prefs': '[1]' });
  assert.equal(createPrefs({ storage: arr }).get().theme, 'system');
});
