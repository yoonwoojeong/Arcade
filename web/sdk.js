export const DISPOSE = Symbol('arcade.dispose');
export const SDK_VERSION = 1;

export function createContext({
  gameId,
  root,
  input,
  prefs,
  announce,
  playSound,
  onScore,
  storage,
}) {
  const prefix = `arcade:${gameId}:`;
  const entries = [];
  const unsubs = new Set();

  const gameInput = {
    on(action, fn) {
      entries.push([action, fn]);
      input.on(action, fn);
    },
    off(action, fn) {
      const i = entries.findIndex(([a, f]) => a === action && f === fn);
      if (i !== -1) entries.splice(i, 1);
      input.off(action, fn);
    },
  };

  const gameStorage = {
    get(key) {
      try {
        const raw = storage.getItem(prefix + key);
        return raw === null || raw === undefined ? undefined : JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      try {
        storage.setItem(prefix + key, JSON.stringify(value));
      } catch {
        // quota or blocked storage: ignore
      }
    },
  };

  function onChange(fn) {
    const off = prefs.onChange(() => fn(snapshot));
    unsubs.add(off);
    return () => {
      off();
      unsubs.delete(off);
    };
  }

  function build(p) {
    return Object.freeze({
      reducedMotion: p.reducedMotion,
      highContrast: p.highContrast,
      sound: p.sound,
      colorblindPalette: p.colorblindPalette,
      onChange,
    });
  }

  let snapshot = build(prefs.get());
  const stopSnapshot = prefs.onChange((p) => {
    snapshot = build(p);
  });
  // registered first so the snapshot is refreshed before game listeners run
  unsubs.add(stopSnapshot);

  const ctx = {
    root,
    input: Object.freeze(gameInput),
    storage: Object.freeze(gameStorage),
    get prefs() {
      return snapshot;
    },
    announce(text, opts = {}) {
      announce(String(text), { assertive: Boolean(opts?.assertive) });
    },
    sound: Object.freeze({
      play(name) {
        if (snapshot.sound) playSound(name);
      },
    }),
    reportScore(n) {
      if (typeof n === 'number' && Number.isFinite(n)) onScore(n);
    },
    sdkVersion: SDK_VERSION,
  };

  Object.defineProperty(ctx, DISPOSE, {
    enumerable: false,
    value() {
      for (const [action, fn] of entries.splice(0)) input.off(action, fn);
      for (const off of [...unsubs]) off();
      unsubs.clear();
    },
  });

  return ctx;
}
