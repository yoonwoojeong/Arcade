import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { tmp } from '../helpers/tmp.js';
import { main, checkNode, ensureServer } from '../../server/cli.js';
import { readLock, findRunning, isAlive } from '../../server/lifecycle.js';

async function freePort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

function harness(extraDeps = {}) {
  const dir = tmp();
  const out = [];
  const err = [];
  const opened = [];
  const io = { env: { PATH: process.env.PATH }, out: (s) => out.push(s), err: (s) => err.push(s) };
  const deps = {
    openBrowser: async (url) => {
      opened.push(url);
      return true;
    },
    loadGames: () => [{ id: 'snake', title: 'Snake', accessibility: { screenReader: 'partial' } }],
    ...extraDeps,
  };
  const run = (...argv) => main([...argv, '--data-dir', dir], io, deps);
  return { dir, out, err, opened, run };
}

async function withServer(h, fn) {
  try {
    return await fn();
  } finally {
    await h.run('stop');
  }
}

test('checkNode rejects Node 18 with the install message', () => {
  assert.match(checkNode('18.19.0'), /Node\.js 20 or newer.*nodejs\.org/);
  assert.equal(checkNode('20.0.0'), null);
});

test('open starts the server, prints the URL, and a second open reuses it', async () => {
  const h = harness();
  const port = String(await freePort());
  await withServer(h, async () => {
    assert.equal(await h.run('open', '--port', port), 0);
    const first = readLock(h.dir);
    assert.equal(h.out[0], `Claude Arcade is running at http://127.0.0.1:${first.port}/`);
    assert.deepEqual(h.opened, [`http://127.0.0.1:${first.port}/`]);
    assert.equal(await h.run('open', '--port', port), 0);
    assert.equal(readLock(h.dir).pid, first.pid);
    assert.equal(await h.run('status'), 0);
    assert.match(h.out.at(-1), /\(mode: alert, 0 tab\(s\) open\)\.$/);
  });
});

test('open with a known game adds the hash; unknown game lists available and opens the menu', async () => {
  const h = harness();
  const port = String(await freePort());
  await withServer(h, async () => {
    await h.run('open', 'snake', '--port', port);
    assert.match(h.opened[0], /\/#snake$/);
    h.out.length = 0;
    await h.run('open', 'nope', '--port', port);
    assert.equal(h.out[0], 'Unknown game "nope". Available: snake');
    assert.match(h.opened[1], /\/$/);
  });
});

test('games lists one line per game', async () => {
  const h = harness();
  assert.equal(await h.run('games'), 0);
  assert.deepEqual(h.out, ['snake — Snake (screen reader: partial)']);
});

test('open prints the manual-URL hint when no browser can be opened', async () => {
  const h = harness({ openBrowser: async () => false });
  const port = String(await freePort());
  await withServer(h, async () => {
    assert.equal(await h.run('open', '--port', port), 0);
    assert.match(h.out[0], /^Claude Arcade is running at http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(h.out[1], "Couldn't open a browser automatically — open the URL above.");
  });
});

test('stop stops a running server; stop when not running exits 0 with message', async () => {
  const h = harness();
  assert.equal(await h.run('stop'), 0);
  assert.deepEqual(h.out, ['Claude Arcade is not running.']);
  const port = String(await freePort());
  await h.run('start', '--port', port);
  const lock = readLock(h.dir);
  h.out.length = 0;
  assert.equal(await h.run('stop'), 0);
  assert.deepEqual(h.out, ['Claude Arcade stopped.']);
  assert.equal(isAlive(lock.pid), false);
  assert.equal(await findRunning(h.dir), null);
});

test('unknown command prints usage and returns 2', async () => {
  const h = harness();
  assert.equal(await h.run('bogus'), 2);
  assert.match(h.err[0], /^Usage:/);
});

test('ensureServer restarts a server from a different rootDir', async () => {
  const dir = tmp();
  const calls = [];
  let spawned = false;
  const newLock = { port: 1, pid: 2, token: 't2' };
  const { pluginRoot } = await import('../../server/paths.js');
  const deps = {
    findRunning: async () => {
      if (spawned) return { lock: newLock, health: { rootDir: pluginRoot } };
      return calls.some((c) => c.startsWith('shutdown'))
        ? null
        : { lock: { port: 9, pid: 999999999, token: 'old' }, health: { rootDir: '/old' } };
    },
    fetch: async (url, opts) => {
      calls.push(`shutdown ${opts.headers['X-Arcade-Token']}`);
      return { ok: true };
    },
    spawnServer: () => {
      spawned = true;
      calls.push('spawn');
      return new EventEmitter();
    },
  };
  const lock = await ensureServer({ dir, env: {}, deps });
  assert.deepEqual(calls, ['shutdown old', 'spawn']);
  assert.equal(lock, newLock);
});

test('port range busy prints the exact guidance and exits 1', async () => {
  const child = new EventEmitter();
  const h = harness({
    findRunning: async () => null,
    spawnServer: () => {
      setImmediate(() => child.emit('exit', 3));
      return child;
    },
  });
  assert.equal(await h.run('open', '--port', '5000'), 1);
  assert.equal(
    h.err[0],
    'Ports 5000–5009 are all in use. Change the "port" option for the arcade plugin in /plugin.',
  );
  assert.deepEqual(h.opened, []);
});

test('--port flag reaches the spawned server', async () => {
  const h = harness();
  const port = await freePort();
  await withServer(h, async () => {
    await h.run('start', '--port', String(port));
    assert.equal(readLock(h.dir).port, port);
  });
});
