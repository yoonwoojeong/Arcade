import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBoard, spawnTile, newGame, move, hasMoves, maxTile } from '../../games/2048/logic.js';

const E = () => emptyBoard(4);
const row0 = (...r) => {
  const b = E();
  b[0] = r;
  return b;
};

test('emptyBoard makes a size x size grid of zeros', () => {
  assert.deepEqual(emptyBoard(3), [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]);
  assert.equal(emptyBoard().length, 4);
});

test('left merges pairs once', () => {
  assert.deepEqual(move(row0(2, 2, 2, 2), 'left').board[0], [4, 4, 0, 0]);
  assert.deepEqual(move(row0(2, 2, 4, 0), 'left').board[0], [4, 4, 0, 0]);
  assert.deepEqual(move(row0(4, 2, 2, 0), 'left').board[0], [4, 4, 0, 0]);
});

test('right and gained score', () => {
  const r = move(row0(2, 2, 2, 0), 'right');
  assert.deepEqual(r.board[0], [0, 0, 2, 4]);
  assert.equal(r.gained, 4);
  assert.deepEqual(r.merged, [4]);
  assert.equal(r.moved, true);
});

test('up and down operate on columns', () => {
  const b = E();
  b[0][1] = 2;
  b[1][1] = 2;
  b[3][1] = 4;
  const up = move(b, 'up');
  assert.deepEqual(
    up.board.map((r) => r[1]),
    [4, 4, 0, 0],
  );
  const down = move(b, 'down');
  assert.deepEqual(
    down.board.map((r) => r[1]),
    [0, 0, 4, 4],
  );
  assert.equal(down.gained, 4);
});

test('no-op move reports moved=false and returns an equal board', () => {
  const b = row0(2, 4, 8, 16);
  const r = move(b, 'left');
  assert.equal(r.moved, false);
  assert.equal(r.gained, 0);
  assert.deepEqual(r.merged, []);
  assert.deepEqual(r.board, b);
});

test('move does not mutate its input', () => {
  const b = row0(2, 2, 0, 0);
  move(b, 'left');
  assert.deepEqual(b[0], [2, 2, 0, 0]);
});

test('spawnTile uses rng for value and position and never overwrites', () => {
  const b = row0(2, 2, 2, 2);
  const s = spawnTile(b, seq([0, 0.95]));
  assert.equal(s[1][0], 4); // first empty cell, 0.95 -> 4
  assert.deepEqual(s[0], [2, 2, 2, 2]);
  assert.equal(b[1][0], 0);
  const s2 = spawnTile(b, seq([0.99, 0.5]));
  assert.equal(s2[3][3], 2); // last empty cell, 0.5 -> 2
});

test('spawnTile leaves a full board unchanged', () => {
  const full = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ];
  assert.deepEqual(
    spawnTile(full, () => 0),
    full,
  );
});

test('newGame places exactly two tiles', () => {
  const b = newGame(Math.random);
  assert.equal(b.flat().filter(Boolean).length, 2);
});

test('hasMoves false only when full with no adjacent equals', () => {
  const stuck = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ];
  assert.equal(hasMoves(stuck), false);
  const horiz = stuck.map((r) => [...r]);
  horiz[2][1] = 2;
  assert.equal(hasMoves(horiz), true);
  const vert = stuck.map((r) => [...r]);
  vert[1][0] = 2;
  assert.equal(hasMoves(vert), true);
  assert.equal(hasMoves(E()), true);
});

test('maxTile finds the largest value', () => {
  assert.equal(maxTile(row0(2, 128, 4, 0)), 128);
  assert.equal(maxTile(E()), 0);
});

function seq(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}
