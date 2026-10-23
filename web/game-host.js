import { DISPOSE } from './sdk.js';

const METHODS = ['start', 'pause', 'resume', 'destroy'];

export function resolveGameId(hash, registryIds) {
  const id = String(hash ?? '').replace(/^#/, '');
  return registryIds.includes(id) ? id : null;
}

export function createGameHost({ onCrash }) {
  let state = 'empty';
  let game = null;
  let gameId = null;
  let ctx = null;

  // Tear down the current game. Never throws; returns the destroy error, if any.
  function teardown() {
    let destroyError;
    const g = game;
    const c = ctx;
    game = null;
    ctx = null;
    state = 'empty';
    try {
      g?.destroy?.();
    } catch (err) {
      destroyError = err;
    }
    try {
      c?.[DISPOSE]?.();
    } catch {
      // disposal failures must not mask the original problem
    }
    return destroyError;
  }

  function crash(err) {
    const id = gameId;
    gameId = null;
    teardown();
    try {
      onCrash(id, err);
    } catch {
      // a faulty crash handler must not break the host
    }
  }

  function safe(fn) {
    try {
      fn();
      return true;
    } catch (err) {
      crash(err);
      return false;
    }
  }

  function unmount() {
    const id = gameId;
    gameId = null;
    const err = teardown();
    if (err !== undefined) {
      try {
        onCrash(id, err);
      } catch {
        // ignore
      }
    }
  }

  function mount(id, createGame, newCtx) {
    if (state !== 'empty') unmount();
    gameId = id;
    ctx = newCtx;
    const ok = safe(() => {
      const g = createGame(newCtx);
      game = g;
      for (const m of METHODS) {
        if (typeof g?.[m] !== 'function') throw new Error(`game is missing ${m}()`);
      }
    });
    if (!ok) return;
    safe(() => {
      game.start();
      state = 'running';
    });
  }

  function pause() {
    if (state !== 'running') return;
    safe(() => {
      game.pause();
      state = 'paused';
    });
  }

  function resume() {
    if (state !== 'paused') return;
    safe(() => {
      game.resume();
      state = 'running';
    });
  }

  return {
    mount,
    pause,
    resume,
    unmount,
    get state() {
      return state;
    },
  };
}
