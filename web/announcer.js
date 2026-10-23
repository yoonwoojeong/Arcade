// Writes to the shell's aria-live regions.
export function createAnnouncer({ polite, assertive }) {
  const timers = new Map();
  return function announce(text, { assertive: urgent = false } = {}) {
    const el = urgent ? assertive : polite;
    clearTimeout(timers.get(el));
    // clear first so repeating the same text is announced again
    el.textContent = '';
    timers.set(
      el,
      setTimeout(() => {
        el.textContent = text;
      }, 50),
    );
  };
}
