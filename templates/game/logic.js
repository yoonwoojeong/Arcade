// Game rules live here, with NO DOM and NO timers, so Node can unit-test them.
// REPLACE this with your own rules (board state, scoring, win/lose checks...).

export function createCounter() {
  return { count: 0 };
}

// Pure-ish helper: returns the next state instead of touching the DOM.
export function increment(state, by = 1) {
  return { count: state.count + by };
}
