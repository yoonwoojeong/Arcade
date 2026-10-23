// 2048 rules: pure functions, no DOM, no timers. Board = number[][] (0 = empty).

export function emptyBoard(size = 4) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

const clone = (board) => board.map((row) => [...row]);

// Rng order: first call picks the cell, second picks the value (2 with p = 0.9, else 4).
export function spawnTile(board, rng) {
  const next = clone(board);
  const empty = [];
  next.forEach((row, r) => row.forEach((v, c) => v === 0 && empty.push([r, c])));
  if (empty.length === 0) return next;
  const [r, c] = empty[Math.min(empty.length - 1, Math.floor(rng() * empty.length))];
  next[r][c] = rng() < 0.9 ? 2 : 4;
  return next;
}

export function newGame(rng, size = 4) {
  return spawnTile(spawnTile(emptyBoard(size), rng), rng);
}

// Slides one line toward index 0, merging each tile at most once.
function slide(line) {
  const tiles = line.filter(Boolean);
  const out = [];
  const merged = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) {
      out.push(tiles[i] * 2);
      merged.push(tiles[i] * 2);
      i++;
    } else out.push(tiles[i]);
  }
  while (out.length < line.length) out.push(0);
  return { line: out, merged };
}

export function move(board, dir) {
  const n = board.length;
  const vertical = dir === 'up' || dir === 'down';
  const reverse = dir === 'right' || dir === 'down';
  const next = emptyBoard(n);
  const merged = [];
  for (let i = 0; i < n; i++) {
    let line = vertical ? board.map((row) => row[i]) : [...board[i]];
    if (reverse) line.reverse();
    const res = slide(line);
    line = res.line;
    merged.push(...res.merged);
    if (reverse) line.reverse();
    line.forEach((v, j) => {
      if (vertical) next[j][i] = v;
      else next[i][j] = v;
    });
  }
  const moved = next.some((row, r) => row.some((v, c) => v !== board[r][c]));
  return { board: next, moved, gained: merged.reduce((a, b) => a + b, 0), merged };
}

export function hasMoves(board) {
  if (board.some((row) => row.includes(0))) return true;
  return ['up', 'down', 'left', 'right'].some((d) => move(board, d).moved);
}

export function maxTile(board) {
  return Math.max(0, ...board.flat());
}
