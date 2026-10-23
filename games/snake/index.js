// Snake for Claude Arcade: the canvas + real-time loop reference game.
// Rules live in logic.js; this file draws, runs the timer and handles input.
import { createSnake, turn, step, TICK_MS, TICK_MS_REDUCED_MOTION } from './logic.js';

const COLS = 20;
const ROWS = 20;
const HUD = 28;
const FALLBACK_SIZE = 400;
const DIRS = ['up', 'down', 'left', 'right'];
// Used when a shell token cannot be read (e.g. a stub DOM).
const DEFAULT_COLORS = {
  bg: '#f7f6f2',
  surface: '#ffffff',
  fg: '#1d1d1b',
  accent: '#b5481f',
  border: '#8a8a82',
  food: '#b3261e',
};
const TOKENS = {
  bg: '--bg',
  surface: '--surface',
  fg: '--fg',
  accent: '--accent',
  border: '--border',
  food: '--needs-you',
};

function readColors(el) {
  const colors = { ...DEFAULT_COLORS };
  try {
    const style = window.getComputedStyle(el);
    if (typeof style?.getPropertyValue !== 'function') return colors;
    for (const [key, token] of Object.entries(TOKENS)) {
      const v = style.getPropertyValue(token);
      if (typeof v === 'string' && v.trim()) colors[key] = v.trim();
    }
  } catch {
    // keep defaults
  }
  return colors;
}

export default function createGame(ctx) {
  let state = createSnake({ cols: COLS, rows: ROWS, rng: Math.random });
  let best = Number(ctx.storage.get('best')) || 0;
  let colors = readColors(ctx.root);
  let timer = null;
  let paused = true;
  let cell = 16;
  let offsetX = 0;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Snake board. This game is not accessible to screen readers.');
  canvas.style.cssText =
    'display:block;margin:0 auto;border:2px solid var(--border);border-radius:var(--radius);';
  const g = canvas.getContext('2d');

  function size() {
    const w = Number(ctx.root.clientWidth) || FALLBACK_SIZE;
    const h = Number(ctx.root.clientHeight) || FALLBACK_SIZE;
    cell = Math.max(8, Math.floor(Math.min(w, h - HUD) / Math.max(COLS, ROWS)));
    const cssW = cell * COLS;
    const cssH = cell * ROWS + HUD;
    const dpr = Number(window.devicePixelRatio) || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    offsetX = 0;
  }

  // Head: square with two eyes. Body: rounded square, inset. Food: circle. Shape, not colour, tells them apart.
  function draw() {
    const W = cell * COLS;
    g.fillStyle = colors.bg;
    g.fillRect(0, 0, W, cell * ROWS + HUD);
    g.fillStyle = colors.surface;
    g.fillRect(offsetX, HUD, W, cell * ROWS);
    g.fillStyle = colors.fg;
    g.font = '600 14px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(`Score ${state.score}`, 6, HUD / 2);
    g.textAlign = 'right';
    g.fillText(`Best ${best}`, W - 6, HUD / 2);

    if (state.food) {
      const r = cell * 0.38;
      g.fillStyle = colors.food;
      g.beginPath();
      g.arc(
        state.food.x * cell + cell / 2,
        HUD + state.food.y * cell + cell / 2,
        r,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
    const pad = Math.max(1, cell * 0.1);
    state.body.forEach((p, i) => {
      const x = p.x * cell;
      const y = HUD + p.y * cell;
      if (i === 0) {
        g.fillStyle = colors.accent;
        g.fillRect(x, y, cell, cell);
        g.fillStyle = colors.bg;
        const eye = Math.max(2, cell * 0.14);
        g.fillRect(x + cell * 0.22, y + cell * 0.25, eye, eye);
        g.fillRect(x + cell * 0.64, y + cell * 0.25, eye, eye);
      } else {
        g.fillStyle = colors.fg;
        g.beginPath();
        g.roundRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2, cell * 0.3);
        g.fill();
      }
    });
    if (!state.alive) {
      g.fillStyle = colors.fg;
      g.textAlign = 'center';
      g.font = '700 20px system-ui, sans-serif';
      g.fillText(state.won ? 'You win!' : 'Game over', W / 2, HUD + (cell * ROWS) / 2 - 12);
      g.font = '600 14px system-ui, sans-serif';
      g.fillText('Press Enter or tap to play again', W / 2, HUD + (cell * ROWS) / 2 + 14);
    }
  }

  const tickMs = () => (ctx.prefs.reducedMotion ? TICK_MS_REDUCED_MOTION : TICK_MS);
  function stopTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function schedule() {
    stopTimer();
    timer = setTimeout(tick, tickMs());
  }

  function die() {
    if (state.score > best) {
      best = state.score;
      ctx.storage.set('best', best);
    }
    ctx.reportScore(state.score);
    draw();
    ctx.announce(`Game over. Score ${state.score}. Press Enter to play again.`, {
      assertive: true,
    });
  }

  function tick() {
    timer = null;
    state = step(state, Math.random);
    if (!state.alive) return die();
    draw();
    schedule();
  }

  function restart() {
    state = createSnake({ cols: COLS, rows: ROWS, rng: Math.random });
    draw();
    schedule();
  }

  const handlers = DIRS.map((dir) => [
    dir,
    () => {
      if (!paused) state = turn(state, dir);
    },
  ]);
  const onPrimary = () => {
    if (!paused && !state.alive) restart();
  };
  let offPrefs = null;

  return {
    start() {
      ctx.root.append(canvas);
      size();
      for (const [dir, fn] of handlers) ctx.input.on(dir, fn);
      ctx.input.on('primary', onPrimary);
      offPrefs = ctx.prefs.onChange(() => {
        colors = readColors(ctx.root);
        draw();
      });
      paused = false;
      draw();
      schedule();
    },
    pause() {
      paused = true;
      stopTimer();
    },
    resume() {
      paused = false;
      if (state.alive) schedule();
    },
    destroy() {
      paused = true;
      stopTimer();
      for (const [dir, fn] of handlers) ctx.input.off(dir, fn);
      ctx.input.off('primary', onPrimary);
      if (offPrefs) offPrefs();
      offPrefs = null;
      canvas.remove();
    },
  };
}
