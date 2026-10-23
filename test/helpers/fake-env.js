// Minimal fake browser environment for contract tests: a recursive stub DOM plus
// counting wrappers around timers, so leaks after destroy() can be detected in Node.

const TIMER_FNS = [
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
];

export function installFakeEnv() {
  const originals = {};
  for (const name of [...TIMER_FNS, 'document']) {
    originals[name] = { had: name in globalThis, value: globalThis[name] };
  }
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

  // ---- listeners: a live set of (target, type, fn) registrations ----
  const listeners = new Set();
  const keyOf = new Map(); // fn -> per-function numeric id, so keys are strings
  const fnId = (fn) => {
    if (!keyOf.has(fn)) keyOf.set(fn, keyOf.size + 1);
    return keyOf.get(fn);
  };
  let targetSeq = 0;

  function eventApi(target) {
    const tid = ++targetSeq;
    target.addEventListener = (type, fn) => listeners.add(`${tid}:${type}:${fnId(fn)}`);
    target.removeEventListener = (type, fn) => listeners.delete(`${tid}:${type}:${fnId(fn)}`);
  }

  // ---- stub DOM ----
  function canvasContext() {
    return new Proxy(
      {},
      {
        get: (_t, prop) => (prop === 'canvas' ? undefined : () => undefined),
        set: () => true,
      },
    );
  }

  function createElement(tag = 'div') {
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      style: {},
      dataset: {},
      attributes: {},
      textContent: '',
      className: '',
      parentNode: null,
      classList: {
        _set: new Set(),
        add(...c) {
          c.forEach((x) => this._set.add(x));
        },
        remove(...c) {
          c.forEach((x) => this._set.delete(x));
        },
        toggle(c, force) {
          const on = force ?? !this._set.has(c);
          if (on) this._set.add(c);
          else this._set.delete(c);
          return on;
        },
        contains(c) {
          return this._set.has(c);
        },
      },
      append(...nodes) {
        for (const n of nodes) {
          if (n && typeof n === 'object') n.parentNode = el;
          el.children.push(n);
        }
      },
      appendChild(n) {
        el.append(n);
        return n;
      },
      remove() {
        const p = el.parentNode;
        if (p) p.children = p.children.filter((c) => c !== el);
        el.parentNode = null;
      },
      replaceChildren(...nodes) {
        el.children = [];
        el.append(...nodes);
      },
      setAttribute(k, v) {
        el.attributes[k] = String(v);
      },
      getAttribute: (k) => el.attributes[k] ?? null,
      removeAttribute(k) {
        delete el.attributes[k];
      },
      querySelector: () => createElement('div'),
      querySelectorAll: () => [],
      getContext: (type) => (type === '2d' ? canvasContext() : null),
      focus() {},
      blur() {},
      getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, width: 0, height: 0 }),
    };
    eventApi(el);
    return el;
  }

  const document = {
    createElement,
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    body: createElement('body'),
    querySelector: () => createElement('div'),
    querySelectorAll: () => [],
    getElementById: () => createElement('div'),
  };
  eventApi(document);
  globalThis.document = document;

  return {
    document,
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
