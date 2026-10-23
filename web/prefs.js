export const PREF_DEFAULTS = {
  sound: false,
  notifications: false,
  theme: 'system',
  reducedMotion: null, // null = follow the OS
  highContrast: false,
  colorblindPalette: false,
  showProject: true,
};

const KEY = 'arcade:prefs';

function load(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out = { ...PREF_DEFAULTS };
      for (const k of Object.keys(PREF_DEFAULTS)) {
        if (Object.hasOwn(parsed, k)) out[k] = parsed[k];
      }
      return out;
    }
  } catch {
    // corrupt or unavailable storage: fall through to defaults
  }
  return { ...PREF_DEFAULTS };
}

export function createPrefs({ storage, matchMedia } = {}) {
  let state = load(storage);
  const listeners = new Set();

  function osReducedMotion() {
    try {
      return Boolean(matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    } catch {
      return false;
    }
  }

  function get() {
    return {
      ...state,
      reducedMotion: state.reducedMotion ?? osReducedMotion(),
    };
  }

  return {
    get,
    set(patch) {
      for (const k of Object.keys(PREF_DEFAULTS)) {
        if (Object.hasOwn(patch ?? {}, k)) state[k] = patch[k];
      }
      try {
        storage?.setItem(KEY, JSON.stringify(state));
      } catch {
        // quota or blocked storage: keep in-memory value
      }
      const snapshot = get();
      for (const fn of [...listeners]) fn(snapshot);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
