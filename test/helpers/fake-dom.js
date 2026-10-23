// Permissive stub DOM for contract tests. Anything a game might legitimately call
// exists and does nothing, so failures point at real contract violations, not at gaps here.
// Listener registration goes through `track` ({ add(target, type, fn, opts), remove(...) }).

// A callable, recursive no-op: stub(), stub.anything, stub().anything all work.
export function makeStub() {
  const fn = () => stub;
  const stub = new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      if (prop === 'length') return 0;
      return stub;
    },
    set: () => true,
  });
  return stub;
}

// Wraps a base object so unknown string properties are no-op stubs.
function permissive(base, fallback) {
  return new Proxy(base, {
    get(t, prop, recv) {
      if (prop in t) return Reflect.get(t, prop, recv);
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return fallback ? fallback(prop) : makeStub();
    },
  });
}

export function createFakeDom(track) {
  const withEvents = (target) => {
    target.addEventListener = (type, fn, opts) => track.add(target, type, fn, opts);
    target.removeEventListener = (type, fn, opts) => track.remove(target, type, fn, opts);
  };

  function canvasContext(canvas) {
    const base = {
      canvas,
      measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
      getImageData: (_x, _y, w = 1, h = 1) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(Math.min(4 * w * h, 1 << 20)),
      }),
      createImageData: (w = 1, h = 1) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(Math.min(4 * w * h, 1 << 20)),
      }),
    };
    return permissive(base);
  }

  function createElement(tag = 'div') {
    const base = {
      tagName: String(tag).toUpperCase(),
      nodeType: 1,
      children: [],
      childNodes: [],
      style: {},
      dataset: {},
      attributes: {},
      textContent: '',
      className: '',
      parentNode: null,
      width: 300,
      height: 150,
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
          base.children.push(n);
          base.childNodes.push(n);
        }
      },
      appendChild(n) {
        el.append(n);
        return n;
      },
      remove() {
        const p = el.parentNode;
        if (p) {
          p.children = p.children.filter((c) => c !== el);
          p.childNodes = p.children;
        }
        el.parentNode = null;
      },
      replaceChildren(...nodes) {
        base.children = [];
        base.childNodes = base.children;
        el.append(...nodes);
      },
      setAttribute(k, v) {
        base.attributes[k] = String(v);
      },
      getAttribute: (k) => base.attributes[k] ?? null,
      removeAttribute(k) {
        delete base.attributes[k];
      },
      querySelector: () => createElement('div'),
      querySelectorAll: () => [],
      getContext: (type) => (type === '2d' ? canvasContext(el) : null),
      getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, width: 0, height: 0 }),
      play: () => Promise.resolve(),
      pause() {},
    };
    // unknown methods (insertBefore, prepend, contains, closest, cloneNode, ...) are no-ops
    const el = permissive(base);
    withEvents(base);
    return el;
  }

  const docBase = {
    nodeType: 9,
    createElement,
    createElementNS: (_ns, tag) => createElement(tag),
    createDocumentFragment: () => createElement('#fragment'),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    body: createElement('body'),
    documentElement: createElement('html'),
    activeElement: null,
    hidden: false,
    visibilityState: 'visible',
    querySelector: () => createElement('div'),
    querySelectorAll: () => [],
    getElementById: () => createElement('div'),
  };
  withEvents(docBase);
  const document = permissive(docBase);

  const winBase = {
    document,
    innerWidth: 1024,
    innerHeight: 768,
    devicePixelRatio: 1,
    matchMedia: () => {
      const mql = { matches: false, media: '' };
      withEvents(mql);
      return mql;
    },
    getComputedStyle: () => new Proxy({}, { get: () => '' }),
  };
  withEvents(winBase);
  // other names (setTimeout, requestAnimationFrame, ...) resolve to the (wrapped) globals
  const window = permissive(winBase, (prop) => globalThis[prop]);
  winBase.window = window;
  winBase.self = window;

  const Image = function Image() {
    return createElement('img');
  };
  const Audio = function Audio() {
    return createElement('audio');
  };

  return { document, window, Image, Audio };
}
