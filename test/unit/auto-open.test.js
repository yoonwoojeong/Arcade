import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmp } from '../helpers/tmp.js';
import { autoOpen } from '../../server/auto-open.js';
import { main } from '../../server/cli.js';
import { applyEvent, readStatus, updateStatus } from '../../server/status-store.js';

function setup({ mode = 'auto', state = 'working', clients = 0 } = {}) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ mode }));
  updateStatus(dir, (s) =>
    applyEvent(s, { state, sessionId: 's1', cwd: '/p/demo', now: new Date() }),
  );
  const opened = [];
  const ensured = [];
  const deps = {
    sleep: async () => {},
    ensureServer: async (args) => {
      ensured.push(args);
      return { port: 4417 };
    },
    openBrowser: async (url) => {
      opened.push(url);
      return true;
    },
    fetchHealth: async () => ({ clients }),
  };
  const call = (over = {}) =>
    autoOpen({ sessionId: 's1', delaySec: 20, dir, env: {}, deps, ...over });
  return { dir, opened, ensured, deps, call };
}

test('opens once when still working, no tab, auto mode', async () => {
  const t = setup();
  assert.equal(await t.call(), 'opened');
  assert.equal(readStatus(t.dir).sessions.s1.autoOpened, true);
  assert.deepEqual(t.opened, ['http://127.0.0.1:4417/']);
});

test('second call for the same session is skipped', async () => {
  const t = setup();
  await t.call();
  assert.equal(await t.call(), 'skipped:already-opened');
  assert.equal(t.opened.length, 1);
});

test('skips when the session finished during the delay', async () => {
  const t = setup();
  t.deps.sleep = async () => {
    updateStatus(t.dir, (s) => applyEvent(s, { state: 'done', sessionId: 's1', now: new Date() }));
  };
  assert.equal(await t.call(), 'skipped:not-working');
  assert.equal(t.opened.length, 0);
});

test('skips when the session is unknown', async () => {
  const t = setup();
  assert.equal(await t.call({ sessionId: 'other' }), 'skipped:not-working');
});

test('skips when a tab is connected', async () => {
  const t = setup({ clients: 1 });
  assert.equal(await t.call(), 'skipped:tab-open');
  assert.equal(t.opened.length, 0);
  assert.equal(readStatus(t.dir).sessions.s1.autoOpened, undefined);
});

test('skips when mode changed away from auto during the delay', async () => {
  const t = setup();
  t.deps.sleep = async () => {
    fs.writeFileSync(path.join(t.dir, 'settings.json'), JSON.stringify({ mode: 'quiet' }));
  };
  assert.equal(await t.call(), 'skipped:mode');
  assert.equal(t.opened.length, 0);
});

test('sleeps delaySec seconds and marks before opening', async () => {
  const t = setup();
  const seen = [];
  t.deps.sleep = async (ms) => seen.push(ms);
  t.deps.openBrowser = async () => {
    seen.push(readStatus(t.dir).sessions.s1.autoOpened);
    return true;
  };
  await t.call({ delaySec: 7 });
  assert.deepEqual(seen, [7000, true]);
});

test('main auto-open returns 0 and prints nothing', async () => {
  const t = setup();
  const out = [];
  const err = [];
  const io = { env: { ...process.env }, out: (s) => out.push(s), err: (s) => err.push(s) };
  const deps = { ...t.deps, loadGames: () => [] };
  assert.equal(await main(['auto-open', 's1', '20', '--data-dir', t.dir], io, deps), 0);
  assert.deepEqual([out, err], [[], []]);
  assert.equal(t.opened.length, 1);
});

test('main auto-open ignores an invalid delay and swallows errors', async () => {
  const t = setup();
  const out = [];
  const err = [];
  const io = { env: { ...process.env }, out: (s) => out.push(s), err: (s) => err.push(s) };
  const deps = {
    ...t.deps,
    ensureServer: async () => {
      throw new Error('boom');
    },
  };
  assert.equal(await main(['auto-open', 's1', 'abc', '--data-dir', t.dir], io, deps), 0);
  assert.equal(await main(['auto-open', 's1', '20', '--data-dir', t.dir], io, deps), 0);
  assert.deepEqual([out, err], [[], []]);
  assert.equal(t.opened.length, 0);
});
