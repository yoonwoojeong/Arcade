// Per-game best scores, stored as { [gameId]: number } under one localStorage key.
export const SCORES_KEY = 'arcade:scores';

function load(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(SCORES_KEY));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out = Object.create(null);
      for (const [id, n] of Object.entries(parsed)) {
        if (typeof n === 'number' && Number.isFinite(n)) out[id] = n;
      }
      return out;
    }
  } catch {
    // corrupt or unavailable storage: start empty
  }
  return Object.create(null);
}

export function createScores(storage) {
  const best = load(storage);

  return {
    get(id) {
      return best[id];
    },
    report(id, n) {
      // 0 is a restart, not an achievement; negative scores mean nothing here
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0)
        return { best: best[id], isNew: false };
      if (best[id] !== undefined && n <= best[id]) return { best: best[id], isNew: false };
      best[id] = n;
      try {
        storage?.setItem(SCORES_KEY, JSON.stringify(best));
      } catch {
        // quota or blocked storage: keep the in-memory value
      }
      return { best: n, isNew: true };
    },
  };
}
