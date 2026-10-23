import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmp } from '../helpers/tmp.js';
import { createArcadeServer } from '../../server/server.js';
import {
  readStatus,
  writeStatusAtomic,
  emptyStatus,
  applyEvent,
} from '../../server/status-store.js';

const serverModule = fileURLToPath(new URL('../../server/server.js', import.meta.url));

async function freePort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function start(opts = {}) {
  const rootDir = tmp();
  const dataDir = opts.dataDir ?? tmp();
  fs.mkdirSync(path.join(rootDir, 'web'), { recursive: true });
  const srv = await createArcadeServer({
    rootDir,
    dataDir,
    port: await freePort(),
    token: 't',
    env: {},
    ...opts,
  });
  return { srv, dataDir };
}

function openEvents(port) {
  const events = [];
  let res;
  const waiters = [];
  let buf = '';
  const ready = new Promise((resolve, reject) => {
    const r = http.get(
      { host: '127.0.0.1', port, path: '/events', headers: { Host: `127.0.0.1:${port}` } },
      (response) => {
        res = response;
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          buf += chunk;
          let i;
          while ((i = buf.indexOf('\n\n')) !== -1) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const m = /^event: (\w+)\ndata: (.*)$/m.exec(block);
            if (m) events.push({ event: m[1], data: JSON.parse(m[2]) });
            waiters.splice(0).forEach((w) => w());
          }
        });
        response.on('error', () => {});
        resolve(response);
      },
    );
    r.on('error', reject);
  });
  const nth = async (n, timeoutMs = 2500) => {
    const deadline = Date.now() + timeoutMs;
    while (events.length < n) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for event ${n}, have ${events.length}`);
      await new Promise((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, left).unref();
      });
    }
    return events[n - 1];
  };
  return { ready, events, nth, close: () => res?.destroy() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get(
        { host: '127.0.0.1', port, path: urlPath, headers: { Host: `127.0.0.1:${port}` } },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve(JSON.parse(b)));
        },
      )
      .on('error', reject);
  });
}

async function waitFor(fn, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(20);
  }
  return false;
}

test('SSE sends current status on connect, with SSE and security headers', async () => {
  const { srv, dataDir } = await start();
  writeStatusAtomic(
    dataDir,
    applyEvent(emptyStatus(), {
      state: 'working',
      sessionId: 's1',
      cwd: '/a/proj',
      now: new Date(),
    }),
  );
  const c = openEvents(srv.port);
  const res = await c.ready;
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^text\/event-stream/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['connection'], 'keep-alive');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.headers['content-security-policy']);
  const first = await c.nth(1);
  assert.equal(first.event, 'status');
  assert.deepEqual(first.data, readStatus(dataDir));
  c.close();
  await srv.close();
});

test('/events enforces the Host check', async () => {
  const { srv } = await start();
  const status = await new Promise((resolve, reject) => {
    http
      .get(
        { host: '127.0.0.1', port: srv.port, path: '/events', headers: { Host: 'evil.test' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      )
      .on('error', reject);
  });
  assert.equal(status, 403);
  await srv.close();
});

test('SSE pushes a change within 1.5s of writeStatusAtomic', async () => {
  const { srv, dataDir } = await start();
  const c = openEvents(srv.port);
  await c.ready;
  await c.nth(1);
  const next = applyEvent(emptyStatus(), {
    state: 'idle',
    sessionId: 's2',
    cwd: '/x/y',
    now: new Date(),
  });
  const t0 = Date.now();
  writeStatusAtomic(dataDir, next);
  const ev = await c.nth(2, 1500);
  assert.ok(Date.now() - t0 < 1500);
  assert.deepEqual(ev.data, next);
  c.close();
  await srv.close();
});

test('identical rewrites do not produce duplicate events', async () => {
  const { srv, dataDir } = await start();
  const status = applyEvent(emptyStatus(), {
    state: 'working',
    sessionId: 's',
    cwd: '/p',
    now: new Date(),
  });
  writeStatusAtomic(dataDir, status);
  const c = openEvents(srv.port);
  await c.ready;
  await c.nth(1);
  writeStatusAtomic(dataDir, status);
  await sleep(150);
  writeStatusAtomic(dataDir, status);
  await sleep(1300);
  assert.equal(c.events.length, 1);
  c.close();
  await srv.close();
});

test('clientCount and /health.clients track open connections', async () => {
  const { srv } = await start();
  assert.equal(srv.clientCount(), 0);
  const a = openEvents(srv.port);
  const b = openEvents(srv.port);
  await Promise.all([a.ready, b.ready, a.nth(1), b.nth(1)]);
  assert.equal(srv.clientCount(), 2);
  assert.equal((await getJson(srv.port, '/health')).clients, 2);
  a.close();
  assert.ok(await waitFor(() => srv.clientCount() === 1));
  assert.equal((await getJson(srv.port, '/health')).clients, 1);
  b.close();
  assert.ok(await waitFor(() => srv.clientCount() === 0));
  await srv.close();
});

test('idle shutdown fires after idleTimeoutMs with no clients', async () => {
  let shutdowns = 0;
  const { srv } = await start({ idleTimeoutMs: 200, onShutdown: () => shutdowns++ });
  assert.ok(await waitFor(() => shutdowns === 1, 1000));
  await assert.rejects(
    new Promise((resolve, reject) => {
      const r = http.get({ host: '127.0.0.1', port: srv.port, path: '/health' }, resolve);
      r.on('error', reject);
    }),
  );
});

test('an open SSE client prevents idle shutdown', async () => {
  let shutdowns = 0;
  const { srv } = await start({ idleTimeoutMs: 200, onShutdown: () => shutdowns++ });
  const c = openEvents(srv.port);
  await c.ready;
  await c.nth(1);
  await sleep(600);
  assert.equal(shutdowns, 0);
  assert.equal((await getJson(srv.port, '/health')).ok, true);
  c.close();
  assert.ok(await waitFor(() => shutdowns === 1, 1500));
});

test('close() ends open SSE responses and resolves', async () => {
  const { srv } = await start();
  const c = openEvents(srv.port);
  const res = await c.ready;
  await c.nth(1);
  const ended = new Promise((r) => res.on('close', r));
  await srv.close();
  await ended;
  assert.equal(srv.clientCount(), 0);
});

test('close() leaves no timers or watchers (process can exit)', async () => {
  const dataDir = tmp();
  const rootDir = tmp();
  const script = `
    import { createArcadeServer } from ${JSON.stringify(serverModule)};
    const srv = await createArcadeServer({ rootDir: ${JSON.stringify(rootDir)}, dataDir: ${JSON.stringify(path.join(dataDir, 'nested'))}, port: 47000 + Math.floor(Math.random() * 900), token: 't', env: {} });
    await new Promise((resolve) => {
      import('node:http').then(({ default: http }) => {
        const r = http.get({ host: '127.0.0.1', port: srv.port, path: '/events', headers: { Host: '127.0.0.1:' + srv.port } }, (res) => {
          res.once('data', resolve);
          res.on('error', () => {});
        });
        r.on('error', () => {});
      });
    });
    await srv.close();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve('timeout');
    }, 2000);
    child.on('exit', (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  assert.equal(code, 0);
});
