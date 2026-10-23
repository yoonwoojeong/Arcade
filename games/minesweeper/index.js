// Minesweeper for Claude Arcade. Rules live in logic.js; this file is the DOM, input and announcements.
import {
  createField,
  reveal,
  toggleFlag,
  describeCell,
  isPointerEcho,
  formatRemaining,
} from './logic.js';

const LONG_PRESS_MS = 500;
const ECHO_MS = 50;
const GAME_OVER_HINT = 'Game over. Press Enter for a new game.';
const MOVES = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

// Colour is decoration only: every state also has a text glyph and an aria-label.
function glyph(cell, over) {
  if (cell.flagged) return '⚑';
  if (cell.revealed || (over === 'lost' && cell.mine)) {
    if (cell.mine) return '✱';
    return cell.adjacent ? String(cell.adjacent) : '';
  }
  return '';
}

export default function createGame(ctx) {
  let field = createField();
  let cursor = [0, 0];
  let best = Number(ctx.storage.get('best')) || 0; // seconds, lower is better; 0 = none yet
  let elapsed = 0;
  let paused = true;
  let tick = null;
  let pressTimer = null;
  let pressCell = null;
  let longPressed = false;
  let lastPointerAt = null;
  let lastLongPressAt = null;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:0.75rem;';
  const status = document.createElement('p');
  status.style.cssText = 'margin:0;color:var(--fg);font-weight:600;';
  const grid = document.createElement('div');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', 'Minesweeper board');
  grid.style.cssText =
    'display:grid;gap:2px;padding:6px;border:2px solid var(--border);border-radius:var(--radius);background:var(--bg);touch-action:manipulation;user-select:none;';
  const message = document.createElement('p');
  message.style.cssText = 'margin:0;min-height:1.5em;color:var(--fg);font-weight:600;';
  const newGameButton = document.createElement('button');
  newGameButton.type = 'button';
  newGameButton.textContent = 'New game';
  newGameButton.style.cssText =
    'padding:0.5rem 1rem;border:2px solid var(--border);border-radius:var(--radius);background:var(--accent);color:var(--accent-fg);font:inherit;cursor:pointer;';

  // Cells are built once and updated in place so a screen reader keeps its position.
  const buttons = [];
  grid.style.gridTemplateColumns = `repeat(${field.cols}, 2.25rem)`;
  for (let r = 0; r < field.rows; r++) {
    const row = [];
    for (let c = 0; c < field.cols; c++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'gridcell');
      b.setAttribute('aria-rowindex', String(r + 1));
      b.setAttribute('aria-colindex', String(c + 1));
      b.dataset.r = String(r);
      b.dataset.c = String(c);
      b.style.cssText =
        'width:2.25rem;height:2.25rem;padding:0;border:2px solid var(--border);border-radius:4px;font:inherit;font-weight:700;cursor:pointer;';
      row.push(b);
      grid.append(b);
    }
    buttons.push(row);
  }

  const flagsPlaced = () => field.cells.flat().filter((x) => x.flagged).length;

  function renderStatus() {
    const bestText = best ? `${best} s` : 'none';
    status.textContent = `Mines left ${field.mines - flagsPlaced()}. Time ${elapsed} s. Best ${bestText}.`;
  }

  function renderCell(r, c) {
    const cell = field.cells[r][c];
    const b = buttons[r][c];
    const open = cell.revealed || (field.over === 'lost' && cell.mine && !cell.flagged);
    b.textContent = glyph(cell, field.over);
    b.setAttribute('aria-label', describeCell(field, r, c));
    b.style.background = open
      ? 'var(--surface-2)'
      : cell.flagged
        ? 'var(--accent)'
        : 'var(--surface)';
    b.style.color = cell.flagged ? 'var(--accent-fg)' : 'var(--fg)';
    b.tabIndex = r === cursor[0] && c === cursor[1] ? 0 : -1;
  }

  function renderAll() {
    for (let r = 0; r < field.rows; r++) for (let c = 0; c < field.cols; c++) renderCell(r, c);
    renderStatus();
  }

  const where = (r, c) => `Row ${r + 1}, column ${c + 1}: ${describeCell(field, r, c)}`;

  function startTimer() {
    if (tick !== null) return;
    tick = setInterval(() => {
      elapsed += 1;
      renderStatus();
    }, 1000);
  }
  function stopTimer() {
    if (tick !== null) clearInterval(tick);
    tick = null;
  }
  function cancelPress() {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
    pressCell = null;
  }

  function moveCursor(r, c, focus) {
    const [pr, pc] = cursor;
    cursor = [r, c];
    renderCell(pr, pc);
    renderCell(r, c);
    if (focus) buttons[r][c].focus();
  }

  function restart() {
    stopTimer();
    cancelPress();
    field = createField();
    elapsed = 0;
    message.textContent = '';
    renderAll();
    ctx.announce(`New game. ${formatRemaining(field.mines)}.`);
  }

  function finish() {
    stopTimer();
    if (field.over === 'won') {
      let text = `You won in ${elapsed} seconds.`;
      if (!best || elapsed < best) {
        best = elapsed;
        ctx.storage.set('best', best);
        text += ' New best time.';
      }
      message.textContent = `${text} Press Enter for a new game.`;
      ctx.announce(`${text} Press Enter for a new game.`, { assertive: true });
    } else {
      message.textContent = 'Boom! You hit a mine. Press Enter for a new game.';
      ctx.announce('Boom! You hit a mine. Game over. Press Enter for a new game.', {
        assertive: true,
      });
    }
  }

  function doReveal(r, c) {
    if (field.over) {
      ctx.announce(GAME_OVER_HINT);
      return;
    }
    const cell = field.cells[r][c];
    if (cell.flagged) {
      ctx.announce('Flagged. Remove the flag first.');
      return;
    }
    if (cell.revealed) {
      ctx.announce(where(r, c));
      return;
    }
    const wasStarted = field.started;
    const res = reveal(field, r, c, Math.random);
    if (!wasStarted && field.started) startTimer();
    for (const [rr, cc] of res.revealed) renderCell(rr, cc);
    if (res.exploded) {
      renderAll(); // show every mine
    } else {
      renderStatus();
    }
    if (field.over) {
      finish();
      return;
    }
    const opened = res.revealed.length > 1 ? `Opened ${res.revealed.length} cells. ` : '';
    ctx.announce(`${opened}${where(r, c)}`);
  }

  function doFlag(r, c) {
    if (field.over) {
      ctx.announce(GAME_OVER_HINT);
      return;
    }
    if (field.cells[r][c].revealed) {
      ctx.announce('Already revealed.');
      return;
    }
    const on = toggleFlag(field, r, c);
    renderCell(r, c);
    renderStatus();
    ctx.announce(
      `${on ? 'Flagged' : 'Flag removed'}. ${formatRemaining(field.mines - flagsPlaced())}.`,
    );
  }

  // ---- ctx.input: acts on the keyboard cursor cell ----
  const echo = () => isPointerEcho(lastPointerAt, Date.now(), ECHO_MS);
  const onMove = (dir) => () => {
    if (paused || echo()) return;
    const [dr, dc] = MOVES[dir];
    const r = Math.max(0, Math.min(field.rows - 1, cursor[0] + dr));
    const c = Math.max(0, Math.min(field.cols - 1, cursor[1] + dc));
    moveCursor(r, c, true);
    ctx.announce(where(r, c));
  };
  const onPrimary = () => {
    if (paused || echo()) return;
    if (field.over) restart();
    else doReveal(cursor[0], cursor[1]);
  };
  const onSecondary = () => {
    if (paused || echo()) return;
    doFlag(cursor[0], cursor[1]);
  };
  const moveHandlers = Object.keys(MOVES).map((dir) => [dir, onMove(dir)]);

  // ---- pointer: acts on the clicked cell ----
  const cellOf = (e) => {
    const b = e.target?.closest?.('button[data-r]');
    return b ? [Number(b.dataset.r), Number(b.dataset.c)] : null;
  };
  const onPointerDown = (e) => {
    lastPointerAt = Date.now();
    const cell = cellOf(e);
    if (!cell || paused) return;
    cancelPress();
    longPressed = false;
    pressCell = cell;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (!pressCell) return;
      longPressed = true;
      lastLongPressAt = Date.now();
      const [r, c] = pressCell;
      moveCursor(r, c, false);
      doFlag(r, c);
    }, LONG_PRESS_MS);
  };
  const onPointerUp = () => {
    lastPointerAt = Date.now();
    cancelPress();
  };
  const onPointerLeave = () => cancelPress();
  const onClick = (e) => {
    const cell = cellOf(e);
    if (!cell) return;
    lastPointerAt = Date.now();
    // detail 0 is a keyboard-generated click; ctx.input already handled that key
    if (e.detail === 0 || paused) return;
    if (longPressed) {
      longPressed = false;
      return;
    }
    moveCursor(cell[0], cell[1], false);
    doReveal(cell[0], cell[1]);
  };
  const onContextMenu = (e) => {
    e.preventDefault();
    const cell = cellOf(e);
    lastPointerAt = Date.now();
    if (!cell || paused) return;
    // touch long-press also raises contextmenu; the timer already flagged it
    if (lastLongPressAt !== null && Date.now() - lastLongPressAt < 1000) return;
    cancelPress();
    moveCursor(cell[0], cell[1], false);
    doFlag(cell[0], cell[1]);
  };
  const onNewGame = () => restart();

  const pointerEvents = [
    ['pointerdown', onPointerDown],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerLeave],
    ['pointerleave', onPointerLeave],
    ['click', onClick],
    ['contextmenu', onContextMenu],
  ];

  return {
    start() {
      wrap.append(status, grid, message, newGameButton);
      ctx.root.append(wrap);
      for (const [dir, fn] of moveHandlers) ctx.input.on(dir, fn);
      ctx.input.on('primary', onPrimary);
      ctx.input.on('secondary', onSecondary);
      for (const [type, fn] of pointerEvents) grid.addEventListener(type, fn);
      newGameButton.addEventListener('click', onNewGame);
      paused = false;
      renderAll();
      ctx.announce(
        `Minesweeper. ${field.rows} by ${field.cols} board, ${formatRemaining(field.mines)}. Arrow keys move, Enter reveals, Shift or X flags. ${where(0, 0)}`,
      );
    },
    pause() {
      paused = true;
      stopTimer();
      cancelPress();
    },
    resume() {
      paused = false;
      if (field.started && !field.over) startTimer();
    },
    destroy() {
      paused = true;
      stopTimer();
      cancelPress();
      for (const [dir, fn] of moveHandlers) ctx.input.off(dir, fn);
      ctx.input.off('primary', onPrimary);
      ctx.input.off('secondary', onSecondary);
      for (const [type, fn] of pointerEvents) grid.removeEventListener(type, fn);
      newGameButton.removeEventListener('click', onNewGame);
      wrap.remove();
    },
  };
}
