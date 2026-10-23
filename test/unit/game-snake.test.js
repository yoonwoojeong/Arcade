import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSnake,
  turn,
  step,
  TICK_MS,
  TICK_MS_REDUCED_MOTION,
} from '../../games/snake/logic.js';
import { mulberry32 } from '../helpers/rng.js';

const rng = () => mulberry32(1);
// Hand-built state: body is head first.
const built = (body, over = {}) => ({
  cols: 10,
  rows: 10,
  body,
  dir: 'right',
  pendingDir: 'right',
  food: { x: 0, y: 0 },
  alive: true,
  score: 0,
  ...over,
});

test('tick constants', () => {
  assert.equal(TICK_MS, 120);
  assert.equal(TICK_MS_REDUCED_MOTION, 200);
});

test('createSnake: length 3 at the centre heading right, food off the body', () => {
  for (let seed = 0; seed < 200; seed++) {
    const s = createSnake({ rng: mulberry32(seed) });
    assert.equal(s.cols, 20);
    assert.equal(s.rows, 20);
    assert.equal(s.body.length, 3);
    assert.deepEqual(s.body[0], { x: 10, y: 10 });
    assert.deepEqual(s.body[2], { x: 8, y: 10 });
    assert.equal(s.dir, 'right');
    assert.equal(s.pendingDir, 'right');
    assert.equal(s.alive, true);
    assert.equal(s.score, 0);
    assert.ok(!s.body.some((p) => p.x === s.food.x && p.y === s.food.y));
  }
});

test('step moves one cell in the heading and keeps length', () => {
  const s = createSnake({ rng: rng() });
  const n = step(s, rng());
  assert.deepEqual(n.body[0], { x: 11, y: 10 });
  assert.equal(n.body.length, 3);
  assert.deepEqual(n.body[2], { x: 9, y: 10 });
  assert.deepEqual(s.body[0], { x: 10, y: 10 }, 'input state is not mutated');
});

test('turn changes direction on the next step', () => {
  let s = createSnake({ rng: rng() });
  s = step(turn(s, 'up'), rng());
  assert.deepEqual(s.body[0], { x: 10, y: 9 });
  assert.equal(s.dir, 'up');
});

test('a direct reversal is ignored', () => {
  const s = turn(createSnake({ rng: rng() }), 'left');
  assert.equal(s.pendingDir, 'right');
  assert.deepEqual(step(s, rng()).body[0], { x: 11, y: 10 });
});

test('two turns within one tick cannot reverse the snake', () => {
  let s = createSnake({ rng: rng() }); // heading right
  s = turn(s, 'up');
  s = turn(s, 'left'); // left is a reversal of dir (right), so ignored
  assert.equal(s.pendingDir, 'up');
  const n = step(s, rng());
  assert.equal(n.alive, true);
  assert.deepEqual(n.body[0], { x: 10, y: 9 });
});

test('wall death on every side, no wrap', () => {
  const at = (x, y, dir) =>
    step(
      built(
        [
          { x, y },
          { x: x === 0 ? 1 : x - 1, y },
        ],
        { dir, pendingDir: dir },
      ),
      rng(),
    );
  assert.equal(at(9, 5, 'right').alive, false);
  assert.equal(
    step(
      built(
        [
          { x: 0, y: 5 },
          { x: 1, y: 5 },
        ],
        { dir: 'left', pendingDir: 'left' },
      ),
      rng(),
    ).alive,
    false,
  );
  assert.equal(
    step(
      built(
        [
          { x: 5, y: 0 },
          { x: 5, y: 1 },
        ],
        { dir: 'up', pendingDir: 'up' },
      ),
      rng(),
    ).alive,
    false,
  );
  assert.equal(
    step(
      built(
        [
          { x: 5, y: 9 },
          { x: 5, y: 8 },
        ],
        { dir: 'down', pendingDir: 'down' },
      ),
      rng(),
    ).alive,
    false,
  );
});

test('self-collision kills', () => {
  // head (5,5) heading up into body at (5,4)
  const body = [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 6, y: 4 },
    { x: 5, y: 4 },
    { x: 4, y: 4 },
  ];
  const s = step(built(body, { dir: 'left', pendingDir: 'up' }), rng());
  assert.equal(s.alive, false);
});

test('moving into the cell the tail is vacating is allowed', () => {
  // 2x2 loop: head (5,5) -> up into (5,4) which is the tail
  const body = [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 6, y: 4 },
    { x: 5, y: 4 },
  ];
  const s = step(built(body, { dir: 'left', pendingDir: 'up' }), rng());
  assert.equal(s.alive, true);
  assert.deepEqual(s.body[0], { x: 5, y: 4 });
});

test('the tail cell is NOT free when the snake grows this step', () => {
  const body = [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 6, y: 4 },
    { x: 5, y: 4 },
  ];
  const s = step(built(body, { dir: 'left', pendingDir: 'up', food: { x: 5, y: 4 } }), rng());
  assert.equal(s.alive, false);
});

test('eating grows by one, scores, and moves food off the body (seeded)', () => {
  for (let seed = 0; seed < 200; seed++) {
    const base = createSnake({ rng: mulberry32(seed) });
    const s0 = { ...base, food: { x: 11, y: 10 } };
    const s = step(s0, mulberry32(seed + 1000));
    assert.equal(s.body.length, 4);
    assert.equal(s.score, 1);
    assert.equal(s.alive, true);
    assert.ok(!s.body.some((p) => p.x === s.food.x && p.y === s.food.y));
    assert.ok(s.food.x >= 0 && s.food.x < s.cols && s.food.y >= 0 && s.food.y < s.rows);
  }
});

test('filling the board wins: alive false and won true', () => {
  // 2x2 board, snake of 3, food on the last free cell
  const s = step(
    {
      cols: 2,
      rows: 2,
      body: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      dir: 'down',
      pendingDir: 'right',
      food: { x: 1, y: 0 },
      alive: true,
      score: 0,
    },
    rng(),
  );
  assert.equal(s.body.length, 4);
  assert.equal(s.alive, false);
  assert.equal(s.won, true);
});

test('step on a dead snake is a no-op', () => {
  const dead = built(
    [
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    { alive: false },
  );
  assert.deepEqual(step(dead, rng()), dead);
});

test('index: pause clears the loop timer, resume restarts it, death announces and reports', async () => {
  const { installFakeEnv } = await import('../helpers/fake-env.js');
  const env = installFakeEnv();
  try {
    const { default: createGame } = await import('../../games/snake/index.js');
    const handlers = new Map();
    const announced = [];
    const scores = [];
    const store = new Map();
    const ctx = {
      root: env.document.createElement('div'),
      input: { on: (a, fn) => handlers.set(a, fn), off: (a) => handlers.delete(a) },
      storage: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
      prefs: { reducedMotion: false, onChange: () => () => {} },
      announce: (t, o) => announced.push([t, o]),
      reportScore: (n) => scores.push(n),
    };
    const game = createGame(ctx);
    game.start();
    assert.equal(env.activeTimers(), 1);
    game.pause();
    assert.equal(env.activeTimers(), 0);
    game.resume();
    assert.equal(env.activeTimers(), 1);
    // steer up, wait for the wall: 10 rows from the centre
    handlers.get('up')();
    const deadline = Date.now() + 5000;
    while (scores.length === 0 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(scores, [0]);
    assert.deepEqual(announced, [
      ['Game over. Score 0. Press Enter to play again.', { assertive: true }],
    ]);
    assert.equal(env.activeTimers(), 0);
    handlers.get('primary')();
    assert.equal(env.activeTimers(), 1);
    game.destroy();
    assert.equal(env.activeTimers(), 0);
  } finally {
    env.restore();
  }
});
