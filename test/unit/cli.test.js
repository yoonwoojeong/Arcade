import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { tmp } from '../helpers/tmp.js';
import { main, checkNode, ensureServer } from '../../server/cli.js';
import { readLock, writeLock, findRunning, isAlive } from '../../server/lifecycle.js';

async function freePort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

function harness(extraDeps = {}, extraEnv = {}) {
  const dir = tmp();
  const out = [];
  const err = [];
  const opened = [];
  const io = {
    env: { ...process.env, ...extraEnv },
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };
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

const REMOTE = { platform: 'linux', isWsl: false, hasDisplay: false, isRemote: true };
const HEADLESS = { platform: 'linux', isWsl: false, hasDisplay: false, isRemote: false };
const DESKTOP = { platform: 'linux', isWsl: false, hasDisplay: true, isRemote: false };

test('open over SSH with no browser prints the ssh -L command for the bound port', async () => {
  const h = harness(
    { openBrowser: async () => false, detectEnv: () => REMOTE },
    { SSH_CONNECTION: '203.0.113.9 51234 10.0.0.5 22' },
  );
  const port = String(await freePort());
  await withServer(h, async () => {
    assert.equal(await h.run('open', 'snake', '--port', port), 0);
    const bound = readLock(h.dir).port;
    assert.equal(h.out.length, 3);
    assert.equal(h.out[1], "Couldn't open a browser automatically — open the URL above.");
    assert.match(
      h.out[2],
      new RegExp(
        `^On your own machine run: ssh -L ${bound}:127\\.0\\.0\\.1:${bound} \\S+@10\\.0\\.0\\.5 ` +
          `\\(adjust to how you normally connect\\), then open http://localhost:${bound}/#snake$`,
      ),
    );
  });
});

test('open in a headless container with no browser prints the generic forward hint', async () => {
  const h = harness({ openBrowser: async () => false, detectEnv: () => HEADLESS });
  const port = String(await freePort());
  await withServer(h, async () => {
    assert.equal(await h.run('open', '--port', port), 0);
    const bound = readLock(h.dir).port;
    assert.equal(h.out.length, 3);
    assert.match(h.out[2], new RegExp(`^This session has no browser\\. Forward port ${bound} `));
  });
});

test('open prints no extra hint when a browser launch fails on a desktop', async () => {
  const h = harness({ openBrowser: async () => false, detectEnv: () => DESKTOP });
  const port = String(await freePort());
  await withServer(h, async () => {
    assert.equal(await h.run('open', '--port', port), 0);
    assert.equal(h.out.length, 2);
  });
});

test('open prints no hint when the browser opened, even over SSH', async () => {
  const h = harness({ detectEnv: () => REMOTE }, { SSH_CONNECTION: '1.2.3.4 1 10.0.0.5 22' });
  const port = String(await freePort());
  await withServer(h, async () => {
    assert.equal(await h.run('open', '--port', port), 0);
    assert.equal(h.out.length, 1);
    assert.equal(h.opened.length, 1);
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

test('cli.js runs when invoked through a symlinked path', (t) => {
  const link = path.join(tmp(), 'repo-link');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  try {
    fs.symlinkSync(root, link, 'dir');
  } catch (err) {
    if (err.code === 'EPERM') return t.skip('symlinks need elevated rights on this Windows host');
    throw err;
  }
  const res = spawnSync(process.execPath, [path.join(link, 'server', 'cli.js'), 'bogus'], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /^Usage:/);
});

test('ensureServer fails fast when the server process exits with an error', async () => {
  const child = new EventEmitter();
  const started = Date.now();
  await assert.rejects(
    ensureServer({
      dir: tmp(),
      env: {},
      deps: {
        findRunning: async () => null,
        spawnServer: () => {
          setImmediate(() => child.emit('exit', 1));
          return child;
        },
      },
    }),
    /did not start.*arcade\.log/,
  );
  assert.ok(Date.now() - started < 1500);
});

test('the spawned server gets no inherited CLAUDE_PLUGIN_OPTION_* (only explicit flags)', async () => {
  const dir = tmp();
  const seen = [];
  const io = {
    env: {
      PATH: process.env.PATH,
      CLAUDE_PLUGIN_OPTION_MODE: 'quiet',
      CLAUDE_PLUGIN_OPTION_PORT: '5000',
      CLAUDE_PLUGIN_OPTION_AUTOOPENDELAY: '30',
    },
    out: () => {},
    err: () => {},
  };
  const deps = {
    findRunning: async () => null,
    spawnServer: (d, env) => {
      seen.push(env);
      const child = new EventEmitter();
      setImmediate(() => child.emit('exit', 1));
      return child;
    },
  };
  assert.equal(await main(['start', '--data-dir', dir], io, deps), 1);
  assert.equal(seen.length, 1);
  assert.deepEqual(
    Object.keys(seen[0]).filter((k) => k.startsWith('CLAUDE_PLUGIN_OPTION_')),
    [],
  );
  assert.equal(seen[0].CLAUDE_PLUGIN_DATA, dir);
  assert.equal(seen[0].PATH, process.env.PATH);

  assert.equal(await main(['start', '--data-dir', dir, '--mode', 'auto'], io, deps), 1);
  assert.equal(seen[1].CLAUDE_PLUGIN_OPTION_MODE, 'auto');
  assert.equal(seen[1].CLAUDE_PLUGIN_OPTION_PORT, undefined);
});

test('an unresponsive server is reported, not duplicated, and stop never kills it', async () => {
  const h = harness();
  // a live process whose port accepts connections but never answers /health
  const child = spawn(
    process.execPath,
    [
      '-e',
      `require('node:http').createServer(() => {}).listen(0, '127.0.0.1', function () {
        console.log(this.address().port);
      });`,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  try {
    const port = await new Promise((resolve) =>
      child.stdout.once('data', (d) => resolve(Number(String(d).trim()))),
    );
    writeLock(h.dir, { port, pid: child.pid, startedAt: 'x', token: 't', rootDir: '/r' });
    let spawned = false;
    const started = Date.now();
    await assert.rejects(
      ensureServer({
        dir: h.dir,
        env: {},
        deps: {
          spawnServer: () => {
            spawned = true;
            return new EventEmitter();
          },
        },
      }),
      (err) => {
        assert.equal(
          err.message,
          `Claude Arcade server (pid ${child.pid}) is not responding — run /arcade:stop or see ${path.join(h.dir, 'arcade.log')}`,
        );
        return true;
      },
    );
    assert.ok(Date.now() - started < 6000);
    assert.equal(spawned, false);
    assert.equal(readLock(h.dir).pid, child.pid);

    // stop must not signal a PID it could not verify: no kill, lock kept, non-zero exit
    const kills = [];
    const h2 = { ...h };
    const code = await main(
      ['stop', '--data-dir', h.dir],
      { env: { ...process.env }, out: (x) => h.out.push(x), err: (x) => h.err.push(x) },
      {
        kill: (pid) => kills.push(pid),
      },
    );
    assert.equal(code, 1);
    assert.deepEqual(kills, []);
    assert.equal(isAlive(child.pid), true);
    assert.equal(readLock(h2.dir).pid, child.pid);
    assert.deepEqual(h.out, []);
    assert.deepEqual(h.err, [
      `Claude Arcade (pid ${child.pid}) is not responding and could not be verified; it was not stopped. If it is the arcade, end it manually, then run /arcade:stop again.`,
    ]);
  } finally {
    child.kill();
  }
});

test('stop kills a confirmed server whose shutdown request fails', async () => {
  const h = harness();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    const lock = { port: 1, pid: child.pid, startedAt: 'x', token: 't', rootDir: '/r' };
    writeLock(h.dir, lock);
    const kills = [];
    const exited = new Promise((r) => child.once('exit', r));
    const code = await main(
      ['stop', '--data-dir', h.dir],
      { env: { ...process.env }, out: (x) => h.out.push(x), err: (x) => h.err.push(x) },
      {
        // identity confirmed through /health (name + pid), but the shutdown POST fails
        findRunning: async () => ({ lock, health: { name: 'claude-arcade', pid: child.pid } }),
        fetch: async () => {
          throw new Error('refused');
        },
        kill: (pid) => {
          kills.push(pid);
          process.kill(pid);
        },
      },
    );
    await exited;
    assert.equal(code, 0);
    assert.deepEqual(kills, [child.pid]);
    assert.deepEqual(h.out, ['Claude Arcade stopped.']);
    assert.equal(readLock(h.dir), null);
  } finally {
    child.kill();
  }
});
