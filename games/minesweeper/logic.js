// Minesweeper rules: pure functions, no DOM, no timers.
// Cell = { mine, revealed, flagged, adjacent }; Field = { rows, cols, mines, cells, started, over }.

export function createField({ rows = 9, cols = 9, mines = 10 } = {}) {
  const cells = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      adjacent: 0,
    })),
  );
  return { rows, cols, mines, cells, started: false, over: null };
}

function neighbours(field, r, c) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < field.rows && nc >= 0 && nc < field.cols) out.push([nr, nc]);
    }
  }
  return out;
}

export function computeAdjacent(field) {
  for (let r = 0; r < field.rows; r++) {
    for (let c = 0; c < field.cols; c++) {
      field.cells[r][c].adjacent = neighbours(field, r, c).filter(
        ([nr, nc]) => field.cells[nr][nc].mine,
      ).length;
    }
  }
}

// Uniform random placement (partial Fisher-Yates) that keeps (r, c) and its neighbours clear.
// On a board too small for that, only (r, c) itself is kept clear.
function placeMines(field, r, c, rng) {
  const near = (nr, nc) => Math.abs(nr - r) <= 1 && Math.abs(nc - c) <= 1;
  const pool = [];
  for (let i = 0; i < field.rows; i++)
    for (let j = 0; j < field.cols; j++) if (!near(i, j)) pool.push([i, j]);
  if (pool.length < field.mines) {
    pool.length = 0;
    for (let i = 0; i < field.rows; i++)
      for (let j = 0; j < field.cols; j++) if (i !== r || j !== c) pool.push([i, j]);
  }
  const count = Math.min(field.mines, pool.length);
  for (let k = 0; k < count; k++) {
    const pick = k + Math.min(pool.length - k - 1, Math.floor(rng() * (pool.length - k)));
    [pool[k], pool[pick]] = [pool[pick], pool[k]];
    const [mr, mc] = pool[k];
    field.cells[mr][mc].mine = true;
  }
  computeAdjacent(field);
}

export function reveal(field, r, c, rng) {
  const none = { revealed: [], exploded: false };
  const cell = field.cells[r]?.[c];
  if (!cell || field.over || cell.revealed || cell.flagged) return none;
  if (!field.started) {
    field.started = true;
    placeMines(field, r, c, rng);
  }
  if (cell.mine) {
    cell.revealed = true;
    field.over = 'lost';
    return { revealed: [[r, c]], exploded: true };
  }
  const revealed = [];
  const stack = [[r, c]];
  cell.revealed = true; // marked when queued, so each cell is queued once
  while (stack.length) {
    const [cr, cc] = stack.pop();
    revealed.push([cr, cc]);
    if (field.cells[cr][cc].adjacent !== 0) continue;
    for (const [nr, nc] of neighbours(field, cr, cc)) {
      const n = field.cells[nr][nc];
      if (n.revealed || n.flagged || n.mine) continue;
      n.revealed = true;
      stack.push([nr, nc]);
    }
  }
  let safeLeft = 0;
  for (const row of field.cells) for (const x of row) if (!x.mine && !x.revealed) safeLeft++;
  if (safeLeft === 0) field.over = 'won';
  return { revealed, exploded: false };
}

export function toggleFlag(field, r, c) {
  const cell = field.cells[r]?.[c];
  if (!cell || field.over || cell.revealed) return false;
  cell.flagged = !cell.flagged;
  return cell.flagged;
}

export function describeCell(field, r, c) {
  const cell = field.cells[r][c];
  if (cell.flagged) return 'flagged';
  if (!cell.revealed) return field.over === 'lost' && cell.mine ? 'mine' : 'hidden';
  if (cell.mine) return 'mine';
  if (cell.adjacent === 0) return 'empty';
  return `${cell.adjacent} adjacent mine${cell.adjacent === 1 ? '' : 's'}`;
}

// A touch tap arrives twice: as pointer events on the button and as a ctx.input `primary`.
// Input that follows a pointer action within `windowMs` is that echo and must be ignored.
export function isPointerEcho(lastPointerAt, now, windowMs = 50) {
  return lastPointerAt != null && now - lastPointerAt < windowMs;
}

export function formatRemaining(n) {
  if (n < 0) return `${-n} more flag${n === -1 ? '' : 's'} than mines`;
  return `${n} mine${n === 1 ? '' : 's'} remaining`;
}

// A keyboard-generated click follows the key that ctx.input already handled, on the same cell.
// A click with no such recent input (e.g. a screen reader's synthetic activation) is real.
export function isInputEcho(lastInput, r, c, now, windowMs = 400) {
  return (
    Boolean(lastInput) && lastInput.r === r && lastInput.c === c && now - lastInput.at < windowMs
  );
}

// Whole seconds played: time banked before this run plus the current run, if any.
export function elapsedSeconds(accMs, runStart, now) {
  return Math.floor((accMs + (runStart == null ? 0 : now - runStart)) / 1000);
}
