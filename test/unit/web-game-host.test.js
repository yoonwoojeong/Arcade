import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGameId, createGameHost } from '../../web/game-host.js';
import { DISPOSE } from '../../web/sdk.js';

function recorder(overrides = {}) {
  const log = [];
  const game = {
    start: () => log.push('start'),
    pause: () => log.push('pause'),
    resume: () => log.push('resume'),
    destroy: () => log.push('destroy'),
    ...overrides,
  };
  return { log, game };
}
function ctxWith(log) {
  const ctx = {};
  Object.defineProperty(ctx, DISPOSE, { value: () => log.push('dispose'), enumerable: false });
  return ctx;
}
function setup() {
  const crashes = [];
  const host = createGameHost({ onCrash: (id, err) => crashes.push([id, err]) });
  return { host, crashes };
}

test('resolveGameId only returns registered ids', () => {
  assert.equal(resolveGameId('#snake', ['snake', '2048']), 'snake');
  assert.equal(resolveGameId('#../../etc', ['snake']), null);
  assert.equal(resolveGameId('#Snake', ['snake']), null);
  assert.equal(resolveGameId('', ['snake']), null);
  assert.equal(resolveGameId('#__proto__', ['snake']), null);
});

test('host runs lifecycle in order and pause/resume are idempotent', () => {
  const { host, crashes } = setup();
  const { log, game } = recorder();
  assert.equal(host.state, 'empty');
  host.mount('g', () => game, ctxWith(log));
  assert.equal(host.state, 'running');
  host.resume();
  host.pause();
  host.pause();
  assert.equal(host.state, 'paused');
  host.resume();
  host.resume();
  assert.equal(host.state, 'running');
  host.unmount();
  host.unmount();
  assert.equal(host.state, 'empty');
  assert.deepEqual(log, ['start', 'pause', 'resume', 'destroy', 'dispose']);
  assert.deepEqual(crashes, []);
});

test('pause/resume on an empty host are no-ops', () => {
  const { host } = setup();
  host.pause();
  host.resume();
  assert.equal(host.state, 'empty');
});

test('mount while running unmounts the previous game first', () => {
  const { host } = setup();
  const a = recorder();
  const b = recorder();
  host.mount('a', () => a.game, ctxWith(a.log));
  host.mount('b', () => b.game, ctxWith(b.log));
  assert.deepEqual(a.log, ['start', 'destroy', 'dispose']);
  assert.deepEqual(b.log, ['start']);
  assert.equal(host.state, 'running');
});

test('a throwing game is destroyed and reported, host returns to empty', () => {
  const { host, crashes } = setup();
  const err = new Error('x');
  const { log, game } = recorder({
    start() {
      throw err;
    },
  });
  host.mount('g', () => game, ctxWith(log));
  assert.equal(host.state, 'empty');
  assert.deepEqual(log, ['destroy', 'dispose']);
  assert.equal(crashes.length, 1);
  assert.equal(crashes[0][0], 'g');
  assert.equal(crashes[0][1], err);
});

test('a throw in pause/resume is a crash', () => {
  const { host, crashes } = setup();
  const { log, game } = recorder({
    pause() {
      throw new Error('p');
    },
  });
  host.mount('g', () => game, ctxWith(log));
  host.pause();
  assert.equal(host.state, 'empty');
  assert.equal(crashes.length, 1);
  assert.deepEqual(log, ['start', 'destroy', 'dispose']);
});

test('createGame throwing is reported and ctx is disposed', () => {
  const { host, crashes } = setup();
  const log = [];
  host.mount(
    'g',
    () => {
      throw new Error('boom');
    },
    ctxWith(log),
  );
  assert.equal(host.state, 'empty');
  assert.deepEqual(log, ['dispose']);
  assert.equal(crashes[0][0], 'g');
});

test('invalid game shape is reported as a crash', () => {
  for (const missing of ['start', 'pause', 'resume', 'destroy']) {
    const { host, crashes } = setup();
    const { log, game } = recorder();
    delete game[missing];
    host.mount('g', () => game, ctxWith(log));
    assert.equal(host.state, 'empty', missing);
    assert.equal(crashes.length, 1, missing);
    assert.ok(log.includes('dispose'));
    assert.ok(!log.includes('start'));
  }
  const { host, crashes } = setup();
  host.mount('g', () => null, ctxWith([]));
  assert.equal(crashes.length, 1);
});

test('a crash inside destroy during unmount is reported; dispose still runs', () => {
  const { host, crashes } = setup();
  const { log, game } = recorder({
    destroy() {
      throw new Error('d');
    },
  });
  host.mount('g', () => game, ctxWith(log));
  host.unmount();
  assert.equal(host.state, 'empty');
  assert.equal(crashes.length, 1);
  assert.equal(crashes[0][0], 'g');
  assert.deepEqual(log, ['start', 'dispose']);
});

test('a throwing destroy during crash handling does not mask the crash report', () => {
  const { host, crashes } = setup();
  const err = new Error('start');
  const { log, game } = recorder({
    start() {
      throw err;
    },
    destroy() {
      throw new Error('d');
    },
  });
  host.mount('g', () => game, ctxWith(log));
  assert.equal(crashes.length, 1);
  assert.equal(crashes[0][1], err);
  assert.deepEqual(log, ['dispose']);
});
