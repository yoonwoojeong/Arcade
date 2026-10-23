// Fake browser environment for contract tests: installs a stub DOM (see fake-dom.js) and
// counting wrappers around timers, so leaks after destroy() can be detected in Node.
import { createFakeDom } from './fake-dom.js';

const GLOBALS = [
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'document',
  'window',
  'Image',
  'Audio',
];

export function installFakeEnv() {
  const originals = {};
  for (const name of GLOBALS)
    originals[name] = { had: name in globalThis, value: globalThis[name] };
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  const realClearTimeout = globalThis.clearTimeout;
  const realClearInterval = globalThis.clearInterval;

  // ---- timers: live handles are tracked until they fire or are cleared ----
  const timers = new Map(); // fake id -> real handle
  let nextId = 1;

  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = nextId++;
    timers.set(
      id,
      realSetTimeout(() => {
        timers.delete(id);
        fn(...args);
      }, ms),
    );
    return id;
  };
  globalThis.setInterval = (fn, ms, ...args) => {
    const id = nextId++;
    timers.set(id, realSetInterval(fn, ms, ...args));
    return id;
  };
  const clear = (id) => {
    const real = timers.get(id);
    if (real === undefined) return;
    realClearTimeout(real);
    realClearInterval(real);
    timers.delete(id);
  };
  globalThis.clearTimeout = clear;
  globalThis.clearInterval = clear;
  globalThis.requestAnimationFrame = (fn) => globalThis.setTimeout(() => fn(Date.now()), 16);
  globalThis.cancelAnimationFrame = clear;

  // ---- listeners: live set of (target, type, fn, capture) registrations ----
  const listeners = new Set();
  const ids = new Map();
  const idOf = (o) => {
    if (!ids.has(o)) ids.set(o, ids.size + 1);
    return ids.get(o);
  };
  const capture = (o) => (typeof o === 'boolean' ? o : Boolean(o?.capture));
  const key = (target, type, fn, opts) => `${idOf(target)}:${type}:${idOf(fn)}:${capture(opts)}`;
  const track = {
    add(target, type, fn, opts) {
      // { once: true } listeners remove themselves when fired; they are not leaks
      if (typeof opts === 'object' && opts?.once) return;
      listeners.add(key(target, type, fn, opts));
    },
    remove(target, type, fn, opts) {
      listeners.delete(key(target, type, fn, opts));
    },
  };

  const dom = createFakeDom(track);
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  globalThis.Image = dom.Image;
  globalThis.Audio = dom.Audio;

  return {
    document: dom.document,
    activeTimers: () => timers.size,
    activeListeners: () => listeners.size,
    restore() {
      // clear anything a leaky game left behind so the Node test process can exit
      for (const real of timers.values()) {
        realClearTimeout(real);
        realClearInterval(real);
      }
      timers.clear();
      for (const [name, { had, value }] of Object.entries(originals)) {
        if (had) globalThis[name] = value;
        else delete globalThis[name];
      }
    },
  };
}
