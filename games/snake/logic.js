// Snake rules: pure functions, no DOM. Every function returns a new state; input is never mutated.
export const TICK_MS = 120;
export const TICK_MS_REDUCED_MOTION = 200;

const DELTA = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

// A random free cell, or null when the snake fills the board.
function placeFood(cols, rows, body, rng) {
  const taken = new Set(body.map((p) => p.y * cols + p.x));
  const free = [];
  for (let i = 0; i < cols * rows; i++) if (!taken.has(i)) free.push(i);
  if (!free.length) return null;
  const i = free[Math.floor(rng() * free.length)];
  return { x: i % cols, y: Math.floor(i / cols) };
}

export function createSnake({ cols = 20, rows = 20, rng = Math.random } = {}) {
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  const body = [
    { x: cx, y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
  ];
  return {
    cols,
    rows,
    body,
    dir: 'right',
    pendingDir: 'right',
    food: placeFood(cols, rows, body, rng),
    alive: true,
    won: false,
    score: 0,
  };
}

// Checked against `dir` (the last direction actually moved), not `pendingDir`, so two quick
// turns inside one tick can never add up to a reversal.
export function turn(state, dir) {
  if (!DELTA[dir] || dir === OPPOSITE[state.dir]) return state;
  return { ...state, pendingDir: dir };
}

export function step(state, rng = Math.random) {
  if (!state.alive) return state;
  const { cols, rows, body } = state;
  const dir = state.pendingDir;
  const d = DELTA[dir];
  const head = { x: body[0].x + d.x, y: body[0].y + d.y };
  const dead = { ...state, dir, alive: false };
  if (head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows) return dead;
  const eats = Boolean(state.food) && head.x === state.food.x && head.y === state.food.y;
  // The tail moves away this step unless we grow, so only then is its cell free to enter.
  const kept = eats ? body : body.slice(0, -1);
  if (kept.some((p) => p.x === head.x && p.y === head.y)) return dead;
  const next = [head, ...kept];
  if (!eats) return { ...state, body: next, dir };
  const food = placeFood(cols, rows, next, rng);
  const full = food === null;
  return { ...state, body: next, dir, food, score: state.score + 1, alive: !full, won: full };
}
