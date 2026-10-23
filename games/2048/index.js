// 2048 for Claude Arcade. Rules live in logic.js; this file is the DOM, input and announcements.
import { newGame, spawnTile, move, hasMoves, maxTile } from './logic.js';

const SIZE = 4;
const DIRS = ['up', 'down', 'left', 'right'];

const list = (values) =>
  values.length < 2
    ? values.join('')
    : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;

// Colour is decoration only: every tile also shows its value as text.
function tileStyle(el, value) {
  const big = value >= 128;
  el.style.background = big ? 'var(--accent)' : value >= 8 ? 'var(--surface-2)' : 'var(--surface)';
  el.style.color = big ? 'var(--accent-fg)' : 'var(--fg)';
  el.style.fontSize = value >= 1024 ? '1.1rem' : value >= 128 ? '1.4rem' : '1.8rem';
}

export default function createGame(ctx) {
  let board = newGame(Math.random, SIZE);
  let score = 0;
  let best = Number(ctx.storage.get('best')) || 0;
  let over = false;
  let won = false;
  let paused = true;
  let lastSpawn = null;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:0.75rem;';
  const status = document.createElement('p');
  status.style.cssText = 'margin:0;color:var(--fg);font-weight:600;';
  const grid = document.createElement('div');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', '2048 board');
  grid.style.cssText =
    'display:grid;gap:8px;padding:8px;border:2px solid var(--border);border-radius:var(--radius);background:var(--bg);';
  grid.style.gridTemplateRows = `repeat(${SIZE}, 4.5rem)`;
  const message = document.createElement('p');
  message.style.cssText = 'margin:0;min-height:1.5em;color:var(--fg);font-weight:600;';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'New game';
  button.style.cssText =
    'padding:0.5rem 1rem;border:2px solid var(--border);border-radius:var(--radius);background:var(--accent);color:var(--accent-fg);font:inherit;cursor:pointer;';

  function render() {
    status.textContent = `Score ${score}. Best ${best}.`;
    const rows = board.map((cells, r) => {
      const row = document.createElement('div');
      row.setAttribute('role', 'row');
      row.style.cssText = `display:grid;grid-template-columns:repeat(${SIZE}, 4.5rem);gap:8px;`;
      cells.forEach((value, c) => {
        const cell = document.createElement('div');
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-label', value ? String(value) : 'empty');
        cell.textContent = value ? String(value) : '';
        cell.style.cssText =
          'display:flex;align-items:center;justify-content:center;height:4.5rem;border:2px solid var(--border);border-radius:6px;font-weight:700;';
        tileStyle(cell, value);
        if (!value) cell.style.background = 'var(--bg)';
        const fresh = lastSpawn && lastSpawn[0] === r && lastSpawn[1] === c;
        if (fresh && !ctx.prefs.reducedMotion)
          cell.animate?.([{ opacity: 0.2 }, { opacity: 1 }], 120);
        row.append(cell);
      });
      return row;
    });
    grid.replaceChildren(...rows);
  }

  function restart() {
    board = newGame(Math.random, SIZE);
    score = 0;
    over = false;
    won = false;
    lastSpawn = null;
    message.textContent = '';
    render();
    ctx.announce('New game. Score 0.');
    ctx.reportScore(0);
  }

  function slide(dir) {
    if (paused) return;
    if (over) return;
    const res = move(board, dir);
    if (!res.moved) {
      ctx.announce('No move.');
      return;
    }
    score += res.gained;
    board = spawnTile(res.board, Math.random);
    lastSpawn = null;
    board.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v && !res.board[r][c]) lastSpawn = [r, c];
      }),
    );
    if (score > best) {
      best = score;
      ctx.storage.set('best', best);
    }
    render();
    ctx.reportScore(score);
    ctx.announce(
      res.merged.length ? `Merged ${list(res.merged)}. Score ${score}.` : `Moved. Score ${score}.`,
    );
    if (!won && maxTile(board) >= 2048) {
      won = true;
      message.textContent = 'You reached 2048! You can keep playing.';
      ctx.announce(`You reached 2048! Score ${score}. Keep playing or start a New game.`, {
        assertive: true,
      });
    }
    if (!hasMoves(board)) {
      over = true;
      message.textContent = 'Game over. Press New game to play again.';
      ctx.announce(`Game over. Final score ${score}. Choose New game to play again.`, {
        assertive: true,
      });
      button.focus();
    }
  }

  const handlers = DIRS.map((dir) => [dir, () => slide(dir)]);
  const onPrimary = () => {
    if (!paused && over) restart();
  };
  const onClick = () => restart();

  return {
    start() {
      wrap.append(status, grid, message, button);
      ctx.root.append(wrap);
      for (const [dir, fn] of handlers) ctx.input.on(dir, fn);
      ctx.input.on('primary', onPrimary);
      button.addEventListener('click', onClick);
      paused = false;
      render();
      ctx.announce(`2048. Use the arrow keys to slide tiles. Score ${score}. Best ${best}.`);
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    destroy() {
      paused = true;
      for (const [dir, fn] of handlers) ctx.input.off(dir, fn);
      ctx.input.off('primary', onPrimary);
      button.removeEventListener('click', onClick);
      wrap.remove();
    },
  };
}
