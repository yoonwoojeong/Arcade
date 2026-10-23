import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { tmp } from '../helpers/tmp.js';
import {
  LOCK_FILE,
  readLock,
  writeLock,
  removeLock,
  isAlive,
  findRunning,
  defaultFetchHealth,
  createIdleTimer,
} from '../../server/lifecycle.js';

const lockFor = (over = {}) => ({
  port: 1,
  pid: process.pid,
  startedAt: 'x',
  token: 't',
  rootDir: '/r',
  ...over,
});
const healthFor = (over = {}) => ({
  ok: true,
  name: 'claude-arcade',
  pid: process.pid,
  rootDir: '/r',
  clients: 0,
  version: '0.1.0',
  ...over,
});

test('writeLock/readLock round-trip and readLock is null on missing or corrupt', () => {
  const dir = tmp();
  assert.equal(readLock(dir), null);
  writeLock(dir, lockFor());
  assert.deepEqual(readLock(dir), lockFor());
  fs.writeFileSync(path.join(dir, LOCK_FILE), '{not json');
  assert.equal(readLock(dir), null);
  fs.writeFileSync(path.join(dir, LOCK_FILE), '{"port":"x"}');
  assert.equal(readLock(dir), null);
});

test('writeLock leaves no temp files behind', () => {
  const dir = tmp();
  writeLock(dir, lockFor());
  writeLock(dir, lockFor({ port: 2 }));
  assert.deepEqual(fs.readdirSync(dir), [LOCK_FILE]);
});

test('removeLock with pid only removes its own lock', () => {
  const dir = tmp();
  writeLock(dir, lockFor({ pid: 111 }));
  removeLock(dir, { pid: 222 });
  assert.equal(readLock(dir).pid, 111);
  removeLock(dir, { pid: 111 });
  assert.equal(readLock(dir), null);
  writeLock(dir, lockFor());
  removeLock(dir);
  assert.equal(readLock(dir), null);
  removeLock(dir); // missing: no throw
});

test('isAlive', () => {
  assert.equal(isAlive(process.pid), true);
  assert.equal(isAlive(2 ** 22 + 12345), false);
});

test('findRunning returns the lock when pid alive and health matches', async () => {
  const dir = tmp();
  writeLock(dir, lockFor());
  const r = await findRunning(dir, { fetchHealth: async () => healthFor() });
  assert.equal(r.lock.port, 1);
  assert.equal(r.health.name, 'claude-arcade');
});

test('findRunning returns null when there is no lock', async () => {
  assert.equal(await findRunning(tmp(), { fetchHealth: async () => healthFor() }), null);
});

test('findRunning removes a lock whose pid is dead', async () => {
  const dir = tmp();
  writeLock(dir, lockFor({ pid: 2 ** 22 + 12345 }));
  let called = false;
  const r = await findRunning(dir, {
    fetchHealth: async () => {
      called = true;
      return healthFor();
    },
  });
  assert.equal(r, null);
  assert.equal(called, false);
  assert.equal(readLock(dir), null);
});

test('findRunning rejects a healthy port that is not claude-arcade', async () => {
  const dir = tmp();
  writeLock(dir, lockFor());
  assert.equal(
    await findRunning(dir, { fetchHealth: async () => ({ name: 'something-else' }) }),
    null,
  );
  assert.equal(readLock(dir), null);

  writeLock(dir, lockFor());
  assert.equal(
    await findRunning(dir, { fetchHealth: async () => healthFor({ pid: process.pid + 1 }) }),
    null,
  );
  assert.equal(readLock(dir), null);

  writeLock(dir, lockFor());
  assert.equal(await findRunning(dir, { fetchHealth: async () => null }), null);
  assert.equal(readLock(dir), null);
});

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('defaultFetchHealth parses health JSON and resolves null on failures', async () => {
  const good = await listen((req, res) => {
    if (req.url === '/health') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(healthFor()));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  const bad = await listen((req, res) => res.end('not json'));
  const non200 = await listen((req, res) => {
    res.statusCode = 500;
    res.end(JSON.stringify(healthFor()));
  });
  try {
    assert.equal((await defaultFetchHealth(good.address().port)).name, 'claude-arcade');
    assert.equal(await defaultFetchHealth(bad.address().port), null);
    assert.equal(await defaultFetchHealth(non200.address().port), null);
  } finally {
    for (const s of [good, bad, non200]) s.close();
  }
  // closed port: connection refused
  assert.equal(await defaultFetchHealth(good.address()?.port ?? 1), null);
});

test('defaultFetchHealth resolves null on timeout', async () => {
  const hang = await listen(() => {});
  try {
    const t0 = Date.now();
    assert.equal(await defaultFetchHealth(hang.address().port), null);
    assert.ok(Date.now() - t0 < 3000);
  } finally {
    hang.closeAllConnections();
    hang.close();
  }
});

test('idle timer fires after timeout with no clients and is reset by activity', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let fired = 0;
    const t = createIdleTimer({ timeoutMs: 1000, onIdle: () => fired++ });
    mock.timers.tick(999);
    assert.equal(fired, 0);
    t.activity();
    mock.timers.tick(999);
    assert.equal(fired, 0);
    mock.timers.tick(1);
    assert.equal(fired, 1);
    mock.timers.tick(5000);
    assert.equal(fired, 1);
    t.stop();
  } finally {
    mock.timers.reset();
  }
});

test('idle timer does not fire while clients > 0 and restarts when they leave', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let fired = 0;
    const t = createIdleTimer({ timeoutMs: 1000, onIdle: () => fired++ });
    t.setClients(1);
    mock.timers.tick(5000);
    assert.equal(fired, 0);
    t.activity();
    mock.timers.tick(5000);
    assert.equal(fired, 0);
    t.setClients(0);
    mock.timers.tick(999);
    assert.equal(fired, 0);
    mock.timers.tick(1);
    assert.equal(fired, 1);
    t.stop();
  } finally {
    mock.timers.reset();
  }
});

test('idle timer stop cancels and activity after stop does not restart', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let fired = 0;
    const t = createIdleTimer({ timeoutMs: 1000, onIdle: () => fired++ });
    t.stop();
    t.activity();
    mock.timers.tick(5000);
    assert.equal(fired, 0);
  } finally {
    mock.timers.reset();
  }
});
