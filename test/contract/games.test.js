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
const FORBIDDEN =
  /https?:\/\/(?!www\.w3\.org\/)|\bfetch\s*\(|XMLHttpRequest|WebSocket|\bimport\s*\(/;
const SOURCE_EXT = new Set(['.js', '.mjs', '.json', '.html', '.css', '.svg']);

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

// Runs start -> pause -> resume -> destroy against the fake DOM and reports what leaked.
async function runLifecycle(indexPath) {
  const env = installFakeEnv();
  try {
    const mod = await import(pathToFileURL(indexPath).href);
    const rawInput = createInput(new EventTarget());
    let registered = 0;
    let removed = 0;
    const input = {
      ...rawInput,
      on(a, fn) {
        registered++;
        rawInput.on(a, fn);
      },
      off(a, fn) {
        removed++;
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
    game.start();
    game.pause();
    game.resume();
    game.destroy();
    // Measured BEFORE ctx[DISPOSE]: the shell's safety net is not the game's obligation.
    const result = {
      timers: env.activeTimers(),
      listeners: env.activeListeners(),
      registered,
      removed,
    };
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

    await t.test('index.js default export is a function', async () => {
      const mod = await import(pathToFileURL(path.join(dir, 'index.js')).href);
      assert.equal(typeof mod.default, 'function');
    });

    await t.test('lifecycle releases timers, listeners and input handlers', async () => {
      const r = await runLifecycle(path.join(dir, 'index.js'));
      assert.equal(r.timers, 0, 'timers or animation frames still active after destroy()');
      assert.equal(r.listeners, 0, 'element listeners still attached after destroy()');
      assert.equal(r.registered, r.removed, 'ctx.input.on/off calls are unbalanced');
    });

    await t.test('no network access in source files', () => {
      for (const file of listFiles(dir)) {
        if (!SOURCE_EXT.has(path.extname(file))) continue;
        const text = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(text, FORBIDDEN, `${path.relative(root, file)} uses a forbidden API`);
      }
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

// Prove the harness actually catches leaks.
async function leakyGame(body) {
  const dir = tmp();
  const file = path.join(dir, 'index.js');
  fs.writeFileSync(file, `export default function createGame(ctx) {\n${body}\n}\n`);
  return file;
}

const NOOPS = 'start() {}, pause() {}, resume() {}, destroy() {}';

test('fake-env self-test: a game that leaves an interval running fails the timer check', async () => {
  const file = await leakyGame(
    `let id; return { start() { id = setInterval(() => {}, 1000); }, pause() {}, resume() {}, destroy() {} };`,
  );
  const r = await runLifecycle(file);
  assert.equal(r.timers, 1);
  // the fake env clears leaked handles on restore, so the test process can exit
});

test('fake-env self-test: a leaked element listener is detected', async () => {
  const file = await leakyGame(
    `const el = document.createElement('button'); el.addEventListener('click', () => {}); return { ${NOOPS} };`,
  );
  assert.equal((await runLifecycle(file)).listeners, 1);
});

test('fake-env self-test: an unremoved ctx.input handler is detected', async () => {
  const file = await leakyGame(`ctx.input.on('primary', () => {}); return { ${NOOPS} };`);
  const r = await runLifecycle(file);
  assert.equal(r.registered, 1);
  assert.equal(r.removed, 0);
});

test('fake-env self-test: restore() puts globals back', () => {
  const before = { st: globalThis.setTimeout, doc: globalThis.document };
  const env = installFakeEnv();
  assert.notEqual(globalThis.setTimeout, before.st);
  env.restore();
  assert.equal(globalThis.setTimeout, before.st);
  assert.equal(globalThis.document, before.doc);
});
