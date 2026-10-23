import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScores, SCORES_KEY } from '../../web/scores.js';

function mapStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

test('scores key is arcade:scores', () => {
  assert.equal(SCORES_KEY, 'arcade:scores');
});

test('get returns undefined when no score is stored', () => {
  assert.equal(createScores(mapStorage()).get('snake'), undefined);
});

test('report stores a new best and persists it as a JSON object', () => {
  const storage = mapStorage();
  const scores = createScores(storage);
  assert.deepEqual(scores.report('snake', 10), { best: 10, isNew: true });
  assert.equal(scores.get('snake'), 10);
  assert.deepEqual(JSON.parse(storage.m.get('arcade:scores')), { snake: 10 });
  assert.equal(createScores(storage).get('snake'), 10);
});

test('report keeps the best when the score is not higher', () => {
  const scores = createScores(mapStorage({ 'arcade:scores': JSON.stringify({ snake: 50 }) }));
  assert.deepEqual(scores.report('snake', 50), { best: 50, isNew: false });
  assert.deepEqual(scores.report('snake', 20), { best: 50, isNew: false });
  assert.deepEqual(scores.report('snake', 51), { best: 51, isNew: true });
});

test('scores are kept per game', () => {
  const scores = createScores(mapStorage());
  scores.report('snake', 5);
  scores.report('2048', 900);
  assert.equal(scores.get('snake'), 5);
  assert.equal(scores.get('2048'), 900);
});

test('corrupt or non-object JSON is treated as empty', () => {
  for (const raw of ['{not json', '[1,2]', '"x"', 'null', '42']) {
    const scores = createScores(mapStorage({ 'arcade:scores': raw }));
    assert.equal(scores.get('snake'), undefined, raw);
    assert.deepEqual(scores.report('snake', 3), { best: 3, isNew: true }, raw);
  }
});

test('non-numeric stored entries are ignored', () => {
  const scores = createScores(
    mapStorage({ 'arcade:scores': JSON.stringify({ snake: 'lots', tetris: 7 }) }),
  );
  assert.equal(scores.get('snake'), undefined);
  assert.equal(scores.get('tetris'), 7);
});

test('non-finite reports are ignored', () => {
  const scores = createScores(mapStorage());
  for (const n of [NaN, Infinity, '5']) {
    assert.deepEqual(scores.report('snake', n), { best: undefined, isNew: false });
  }
});

test('storage errors keep the score in memory', () => {
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  const scores = createScores(throwing);
  assert.deepEqual(scores.report('snake', 4), { best: 4, isNew: true });
  assert.equal(scores.get('snake'), 4);
  assert.equal(createScores(undefined).get('snake'), undefined);
});

test('inherited object keys are not treated as scores', () => {
  assert.equal(createScores(mapStorage()).get('constructor'), undefined);
  assert.equal(createScores(mapStorage()).get('__proto__'), undefined);
});
