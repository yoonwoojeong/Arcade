// Contract tests: every game folder (games/*) and the contributor template
// (templates/game) must obey the SDK v1 contract from spec section 5.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateManifest } from '../../server/registry.js';
import { createContext, DISPOSE } from '../../web/sdk.js';
import { createInput } from '../../web/input.js';
import { createPrefs } from '../../web/prefs.js';
import { installFakeEnv } from '../helpers/fake-env.js';
import { tmp } from '../helpers/tmp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIZE_BUDGET = 204800;
// Best-effort lint, NOT a sandbox: it catches honest mistakes, not determined evasion.
// Applied to JS after comments are stripped (a "see https://..." comment is fine).
const FORBIDDEN_JS = new RegExp(
  [
    String.raw`https?:\/\/(?!www\.w3\.org\/)`,
    String.raw`\bfetch\s*\(`,
    'XMLHttpRequest',
    'WebSocket',
    String.raw`\bimport\s*\(`,
    'sendBeacon',
    String.raw`\bEventSource\b`,
    String.raw`\b(?:Shared)?Worker\b`,
    String.raw`\beval\s*\(`,
    String.raw`\bnew\s+Function\b`,
    String.raw`['"\x60]\/\/[\w.-]+`, // protocol-relative URL literal
    String.raw`createElement\s*\(\s*['"](?:script|link)['"]`,
  ].join('|'),
);
const FORBIDDEN_MARKUP = /https?:\/\/(?!www\.w3\.org\/)/;
const JS_EXT = new Set(['.js', '.mjs']);
const MARKUP_EXT = new Set(['.html', '.css', '.svg']);

// Blank out // and /* */ comments while leaving string literals intact.
export function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const IMPORT_RE =
  /(?:\bimport|\bexport)\s[^'"\x60;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g;

// Returns a list of problems found in a game folder's files (empty = clean).
export function scanFolder(dir) {
  const problems = [];
  for (const file of listFiles(dir)) {
    const ext = path.extname(file);
    const rel = path.relative(dir, file);
    if (ext === '.wasm') problems.push(`${rel}: .wasm files are not allowed`);
    if (MARKUP_EXT.has(ext)) {
      if (FORBIDDEN_MARKUP.test(fs.readFileSync(file, 'utf8')))
        problems.push(`${rel}: external URL`);
    }
    if (!JS_EXT.has(ext)) continue;
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    const hit = code.match(FORBIDDEN_JS);
    if (hit) problems.push(`${rel}: forbidden API or URL "${hit[0]}"`);
    for (const m of code.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      const resolved = path.resolve(path.dirname(file), spec);
      const inside = path.relative(dir, resolved);
      if (!/^\.\.?\//.test(spec) || inside.startsWith('..') || path.isAbsolute(inside)) {
        problems.push(`${rel}: import "${spec}" must be a relative path inside the game folder`);
      }
    }
  }
  return problems;
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full) : [full];
  });
}

function targets() {
  const gamesDir = path.join(root, 'games');
  const found = fs.existsSync(gamesDir)
    ? fs
        .readdirSync(gamesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({ dir: path.join(gamesDir, e.name), folderName: e.name, label: e.name }))
    : [];
  const dir = path.join(root, 'templates', 'game');
  // The template folder is deliberately named "game"; its manifest id is "counter".
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'game.json'), 'utf8'));
  found.push({ dir, folderName: m.id, label: 'templates/game' });
  return found;
}

// Runs import -> start -> pause -> resume -> destroy against the fake env and reports what
// leaked. The env is installed BEFORE the import so top-level side effects are stubbed and counted.
async function runLifecycle(indexPath) {
  const env = installFakeEnv();
  try {
    const mod = await import(pathToFileURL(indexPath).href);
    const result = { exportType: typeof mod.default };
    if (result.exportType !== 'function') return result;
    const rawInput = createInput(new EventTarget());
    const live = new Set(); // live ctx.input registrations: only a matching off() removes one
    const ids = new Map();
    const idOf = (fn) => ids.set(fn, ids.get(fn) ?? ids.size + 1).get(fn);
    const input = {
      ...rawInput,
      on(a, fn) {
        live.add(`${a}:${idOf(fn)}`);
        rawInput.on(a, fn);
      },
      off(a, fn) {
        live.delete(`${a}:${idOf(fn)}`);
        rawInput.off(a, fn);
      },
    };
    const store = new Map();
    const ctx = createContext({
      gameId: 'contract',
      root: env.document.createElement('div'),
      input,
      prefs: createPrefs({ storage: null }),
      announce() {},
      playSound() {},
      onScore() {},
      storage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
      },
    });
    const game = mod.default(ctx);
    result.missing = ['start', 'pause', 'resume', 'destroy'].filter(
      (m) => typeof game?.[m] !== 'function',
    );
    if (result.missing.length) return result;
    game.start();
    game.pause();
    game.resume();
    game.destroy();
    // Measured BEFORE ctx[DISPOSE]: the shell's safety net is not the game's obligation.
    result.timers = env.activeTimers();
    result.listeners = env.activeListeners();
    result.inputLive = live.size;
    ctx[DISPOSE]();
    rawInput.destroy();
    return result;
  } finally {
    env.restore();
  }
}

for (const { dir, folderName, label } of targets()) {
  test(`contract: ${label}`, async (t) => {
    await t.test('game.json is valid', () => {
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'game.json'), 'utf8'));
      assert.deepEqual(validateManifest(m, folderName), []);
    });

    const lifecycle = runLifecycle(path.join(dir, 'index.js'));
    lifecycle.catch(() => {}); // surfaced by the subtests below

    await t.test('index.js default export is a function', async () => {
      assert.equal((await lifecycle).exportType, 'function');
    });

    await t.test('game object has start, pause, resume and destroy functions', async () => {
      const r = await lifecycle;
      assert.deepEqual(r.missing, [], `createGame() result is missing: ${r.missing}`);
    });

    await t.test('lifecycle releases timers, listeners and input handlers', async () => {
      const r = await lifecycle;
      assert.equal(r.timers, 0, 'timers or animation frames still active after destroy()');
      assert.equal(r.listeners, 0, 'element listeners still attached after destroy()');
      assert.equal(
        r.inputLive,
        0,
        'ctx.input handlers still registered: off() needs the same function reference as on()',
      );
    });

    await t.test('no network access or escaping imports in source files', () => {
      assert.deepEqual(scanFolder(dir), []);
    });

    await t.test('folder size is within the 200 KB budget', () => {
      const total = listFiles(dir).reduce((n, f) => n + fs.statSync(f).size, 0);
      assert.ok(total <= SIZE_BUDGET, `folder is ${total} bytes (budget ${SIZE_BUDGET})`);
    });

    await t.test('README.md exists', () => {
      assert.ok(fs.existsSync(path.join(dir, 'README.md')));
    });
  });
}

// ---- self-tests: prove the harness actually catches violations ----

// Writes a game folder (ESM) into a temp dir; `files` maps names to contents.
function tmpGame(files) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
const gameSrc = (body) => `export default function createGame(ctx) {\n${body}\n}\n`;
const leaky = (body) => runLifecycle(path.join(tmpGame({ 'index.js': gameSrc(body) }), 'index.js'));
const NOOPS = 'start() {}, pause() {}, resume() {}, destroy() {}';

test('fake-env self-test: a game that leaves an interval running fails the timer check', async () => {
  const r = await leaky(
    `return { start() { setInterval(() => {}, 1000); }, pause() {}, resume() {}, destroy() {} };`,
  );
  assert.equal(r.timers, 1);
});

test('fake-env self-test: a leaked element listener is detected', async () => {
  const r = await leaky(
    `const el = document.createElement('button'); el.addEventListener('click', () => {}); return { ${NOOPS} };`,
  );
  assert.equal(r.listeners, 1);
});

test('fake-env self-test: once-listeners are not counted as leaks', async () => {
  const r = await leaky(
    `window.addEventListener('blur', () => {}, { once: true }); return { ${NOOPS} };`,
  );
  assert.equal(r.listeners, 0);
});

test('fake-env self-test: an unremoved ctx.input handler is detected', async () => {
  const r = await leaky(`ctx.input.on('primary', () => {}); return { ${NOOPS} };`);
  assert.equal(r.inputLive, 1);
});

test('fake-env self-test: off() with a fresh closure does not release the handler', async () => {
  const r = await leaky(
    `ctx.input.on('primary', () => {}); ctx.input.off('primary', () => {}); return { ${NOOPS} };`,
  );
  assert.equal(r.inputLive, 1);
});

test('fake-env self-test: top-level side effects are stubbed and counted', async () => {
  const dir = tmpGame({
    'index.js': `setInterval(() => {}, 1000);\nexport default function createGame() { return { ${NOOPS} }; }\n`,
  });
  assert.equal((await runLifecycle(path.join(dir, 'index.js'))).timers, 1);
});

test('fake-env self-test: a game missing methods is reported', async () => {
  const r = await leaky('return { start() {} };');
  assert.deepEqual(r.missing, ['pause', 'resume', 'destroy']);
});

test('fake-env self-test: canvas and window stubs support typical game code', async () => {
  const r = await leaky(
    `const c = document.createElement('canvas'); const g = c.getContext('2d');
     g.fillRect(0, 0, 1, 1); g.beginPath(); g.createLinearGradient(0, 0, 1, 1).addColorStop(0, 'red');
     if (g.measureText('x').width !== 0 || g.canvas !== c) throw new Error('canvas stub');
     g.getImageData(0, 0, 2, 2).data[0];
     const f = document.createDocumentFragment(); f.append(document.createElementNS('x', 'svg'));
     c.insertBefore(f, null); c.closest('div'); c.cloneNode(true);
     window.matchMedia('(x)').matches; window.getComputedStyle(c).color; new Image(); new Audio().play();
     return { ${NOOPS} };`,
  );
  assert.equal(r.timers, 0);
});

test('fake-env self-test: restore() puts globals back', () => {
  const before = { st: globalThis.setTimeout, doc: globalThis.document, win: globalThis.window };
  const env = installFakeEnv();
  assert.notEqual(globalThis.setTimeout, before.st);
  env.restore();
  assert.equal(globalThis.setTimeout, before.st);
  assert.equal(globalThis.document, before.doc);
  assert.equal(globalThis.window, before.win);
});

test('scan self-test: URLs in comments are allowed, in strings are not', () => {
  const ok = tmpGame({
    'index.js': '// see https://example.com\n/* http://x */\nexport default 1;',
  });
  assert.deepEqual(scanFolder(ok), []);
  const bad = tmpGame({ 'index.js': "const u = 'http://x.test'; // note\nexport default u;" });
  assert.equal(scanFolder(bad).length, 1);
});

test('scan self-test: forbidden APIs and imports are rejected', () => {
  const cases = {
    'navigator.sendBeacon("/x", 1);': /sendBeacon/,
    'new Worker("w.js");': /Worker/,
    'eval("1");': /eval/,
    "const u = '//evil.test/a.js';": /\/\/evil/,
    "document.createElement('script');": /script/,
    "import fs from 'node:fs';": /node:fs/,
    "import x from 'lodash';": /lodash/,
    "import x from '../../server/registry.js';": /server\/registry/,
  };
  for (const [code, re] of Object.entries(cases)) {
    const problems = scanFolder(tmpGame({ 'index.js': code }));
    assert.ok(problems.length > 0 && re.test(problems.join()), `not rejected: ${code}`);
  }
  assert.ok(scanFolder(tmpGame({ 'index.js': '', 'm.wasm': '' })).length > 0);
  assert.deepEqual(scanFolder(tmpGame({ 'index.js': "import './logic.js';", 'logic.js': '' })), []);
});
