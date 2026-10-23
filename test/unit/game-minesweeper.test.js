import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createField,
  reveal,
  toggleFlag,
  describeCell,
  computeAdjacent,
  isPointerEcho,
  formatRemaining,
} from '../../games/minesweeper/logic.js';
import { mulberry32 } from '../helpers/rng.js';

const NEIGHBOURS_AND_SELF = [];
for (let dr = -1; dr <= 1; dr++)
  for (let dc = -1; dc <= 1; dc++) NEIGHBOURS_AND_SELF.push([dr, dc]);

// Hand-built field: mines at the given [r, c] positions, already "started".
function built(rows, cols, mines) {
  const f = createField({ rows, cols, mines: mines.length });
  for (const [r, c] of mines) f.cells[r][c].mine = true;
  f.started = true;
  computeAdjacent(f);
  return f;
}
const revealedCount = (f) => f.cells.flat().filter((c) => c.revealed).length;

test('mulberry32 is deterministic and in [0, 1)', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  for (let i = 0; i < 100; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('createField defaults to 9x9 with 10 mines and none placed', () => {
  const f = createField();
  assert.equal(f.rows, 9);
  assert.equal(f.cols, 9);
  assert.equal(f.mines, 10);
  assert.equal(f.started, false);
  assert.equal(f.over, null);
  assert.equal(f.cells.flat().filter((c) => c.mine).length, 0);
});

test('first reveal is always safe including neighbours (1000 seeds)', () => {
  for (let seed = 0; seed < 1000; seed++) {
    const f = createField();
    const r = reveal(f, 4, 4, mulberry32(seed));
    assert.equal(r.exploded, false);
    for (const [dr, dc] of NEIGHBOURS_AND_SELF) assert.equal(f.cells[4 + dr][4 + dc].mine, false);
    assert.equal(f.cells.flat().filter((c) => c.mine).length, 10);
  }
});

test('first reveal in a corner is safe too, and adjacent counts are correct', () => {
  for (let seed = 0; seed < 200; seed++) {
    const f = createField();
    reveal(f, 0, 0, mulberry32(seed));
    assert.equal(f.cells[0][0].mine, false);
    assert.equal(f.cells.flat().filter((c) => c.mine).length, 10);
    f.cells.forEach((row, r) =>
      row.forEach((cell, c) => {
        let n = 0;
        for (const [dr, dc] of NEIGHBOURS_AND_SELF)
          if (f.cells[r + dr]?.[c + dc]?.mine && (dr || dc)) n++;
        assert.equal(cell.adjacent, n);
      }),
    );
  }
});

test('mine placement is spread out (different seeds, different layouts)', () => {
  const layout = (seed) => {
    const f = createField();
    reveal(f, 4, 4, mulberry32(seed));
    return f.cells
      .flat()
      .map((c) => (c.mine ? 1 : 0))
      .join('');
  };
  assert.notEqual(layout(1), layout(2));
  assert.equal(layout(5), layout(5));
});

test('flood fill reveals the zero region and its border only', () => {
  // 5x5, one mine at (0,4). Revealing (4,0) floods zeros; cells next to the mine are borders.
  const f = built(5, 5, [[0, 4]]);
  const res = reveal(f, 4, 0, Math.random);
  assert.equal(res.exploded, false);
  // every cell except the mine is reachable through zeros here
  assert.equal(revealedCount(f), 24);
  assert.equal(f.cells[0][4].revealed, false);
  assert.equal(f.over, 'won');
  assert.equal(res.revealed.length, 24);
});

test('flood fill stops at numbers and does not cross a wall of mines', () => {
  // column 2 is a wall of mines; revealing (0,0) opens only columns 0-1 (all borders or zeros).
  const f = built(
    4,
    5,
    [0, 1, 2, 3].map((r) => [r, 2]),
  );
  reveal(f, 0, 0, Math.random);
  // columns 0 and 1 are all adjacent to the wall? column 0 is not: zeros; column 1: numbers.
  for (let r = 0; r < 4; r++) {
    assert.equal(f.cells[r][0].revealed, true);
    assert.equal(f.cells[r][1].revealed, true);
    assert.equal(f.cells[r][2].revealed, false);
    assert.equal(f.cells[r][3].revealed, false);
    assert.equal(f.cells[r][4].revealed, false);
  }
  assert.equal(f.over, null);
});

test('flags block reveal; toggleFlag no-op on revealed', () => {
  const f = built(3, 3, [[0, 0]]);
  assert.equal(toggleFlag(f, 2, 2), true);
  assert.deepEqual(reveal(f, 2, 2, Math.random), { revealed: [], exploded: false });
  assert.equal(f.cells[2][2].revealed, false);
  assert.equal(toggleFlag(f, 2, 2), false);
  reveal(f, 2, 2, Math.random);
  assert.equal(f.cells[2][2].revealed, true);
  assert.equal(toggleFlag(f, 2, 2), false);
  assert.equal(f.cells[2][2].flagged, false);
  // revealing a flagged mine does nothing
  toggleFlag(f, 0, 0);
  reveal(f, 0, 0, Math.random);
  assert.notEqual(f.over, 'lost');
  assert.equal(f.cells[0][0].revealed, false);
});

test('revealing an already revealed cell is a no-op', () => {
  const f = built(3, 3, [[0, 0]]);
  reveal(f, 2, 2, Math.random);
  assert.deepEqual(reveal(f, 2, 2, Math.random), { revealed: [], exploded: false });
});

test('a flag cannot be placed once the game is over', () => {
  const f = built(3, 3, [[0, 0]]);
  reveal(f, 0, 0, Math.random);
  assert.equal(f.over, 'lost');
  assert.equal(toggleFlag(f, 2, 2), false);
  assert.equal(f.cells[2][2].flagged, false);
  assert.deepEqual(reveal(f, 2, 2, Math.random), { revealed: [], exploded: false });
});

test('revealing a mine loses; revealing all safe cells wins', () => {
  const lose = built(3, 3, [[0, 0]]);
  const r = reveal(lose, 0, 0, Math.random);
  assert.equal(r.exploded, true);
  assert.equal(lose.over, 'lost');

  const win = built(2, 2, [[0, 0]]);
  reveal(win, 0, 1, Math.random);
  reveal(win, 1, 0, Math.random);
  assert.equal(win.over, null);
  reveal(win, 1, 1, Math.random);
  assert.equal(win.over, 'won');
});

test('describeCell phrasing', () => {
  const f = built(3, 3, [
    [0, 0],
    [0, 2],
  ]);
  assert.equal(describeCell(f, 2, 2), 'hidden');
  toggleFlag(f, 2, 2);
  assert.equal(describeCell(f, 2, 2), 'flagged');
  toggleFlag(f, 2, 2);
  reveal(f, 2, 2, Math.random); // adjacent 0 -> floods row 2 and borders
  assert.equal(describeCell(f, 2, 2), 'empty');
  assert.equal(describeCell(f, 1, 1), '2 adjacent mines');
  assert.equal(describeCell(f, 1, 0), '1 adjacent mine');
  reveal(f, 0, 0, Math.random);
  assert.equal(describeCell(f, 0, 0), 'mine');
});

test('describeCell shows hidden mines once the game is lost, flags stay flags', () => {
  const f = built(3, 3, [
    [0, 0],
    [2, 2],
  ]);
  toggleFlag(f, 2, 2);
  reveal(f, 0, 0, Math.random);
  assert.equal(describeCell(f, 0, 0), 'mine');
  assert.equal(describeCell(f, 2, 2), 'flagged');
  const g = built(3, 3, [
    [0, 0],
    [2, 2],
  ]);
  reveal(g, 0, 0, Math.random);
  assert.equal(describeCell(g, 2, 2), 'mine');
});

test('flood fill on a 50x50 empty-ish field does not overflow the stack', () => {
  const f = createField({ rows: 50, cols: 50, mines: 1 });
  const res = reveal(f, 25, 25, mulberry32(3));
  assert.equal(res.exploded, false);
  assert.ok(res.revealed.length >= 50 * 50 - 9);
  assert.equal(f.over, 'won');
  // fully mine-free field built by hand: worst case, a single flood across 10000 cells
  const g = createField({ rows: 100, cols: 100, mines: 0 });
  g.started = true;
  computeAdjacent(g);
  assert.equal(reveal(g, 0, 0, Math.random).revealed.length, 10000);
});

test('isPointerEcho ignores an input that follows a pointer action within the window', () => {
  assert.equal(isPointerEcho(1000, 1030), true);
  assert.equal(isPointerEcho(1000, 1049), true);
  assert.equal(isPointerEcho(1000, 1051), false);
  assert.equal(isPointerEcho(1000, 1050, 50), false);
  assert.equal(isPointerEcho(null, 1000), false);
  assert.equal(isPointerEcho(-Infinity, 0), false);
});

test('formatRemaining phrasing', () => {
  assert.equal(formatRemaining(1), '1 mine remaining');
  assert.equal(formatRemaining(0), '0 mines remaining');
  assert.equal(formatRemaining(10), '10 mines remaining');
  assert.equal(formatRemaining(-2), '2 more flags than mines');
  assert.equal(formatRemaining(-1), '1 more flag than mines');
});
