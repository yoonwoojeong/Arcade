import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { tmp } from '../helpers/tmp.js';
import { createArcadeServer, PortRangeBusyError } from '../../server/server.js';
import { SECURITY_HEADERS } from '../../server/http-util.js';

const GAME = {
  id: 'demo',
  title: 'Demo',
  version: '1.0.0',
  sdk: 1,
  author: 'a',
  description: 'd',
  controls: { keyboard: ['Arrows'] },
  accessibility: { screenReader: 'none', reducedMotion: true, colorIndependent: true },
  sessionLength: 'short',
};

function fixture() {
  const rootDir = tmp();
  const dataDir = tmp();
  fs.mkdirSync(path.join(rootDir, 'web'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'games', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'web', 'index.html'), '<h1>arcade</h1>');
  fs.writeFileSync(path.join(rootDir, 'secret.txt'), 'secret');
  fs.writeFileSync(path.join(rootDir, 'games', 'demo', 'game.json'), JSON.stringify(GAME));
  fs.writeFileSync(path.join(rootDir, 'games', 'demo', 'index.js'), 'export default 1;');
  fs.mkdirSync(path.join(rootDir, 'games', 'bad'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'games', 'bad', 'game.json'), '{nope');
  fs.writeFileSync(path.join(rootDir, 'games', 'bad', 'index.js'), '');
  return { rootDir, dataDir };
}

async function freePort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

function req(port, method, urlPath, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const h = { Host: `127.0.0.1:${port}`, ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    const r = http.request(
      { host: '127.0.0.1', port, method, path: urlPath, headers: h },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

async function start(extra = {}) {
  const fx = fixture();
  const p = await freePort();
  const srv = await createArcadeServer({
    rootDir: fx.rootDir,
    dataDir: fx.dataDir,
    port: p,
    token: 'tok',
    env: {},
    ...extra,
  });
  return { ...fx, srv, port: srv.port };
}

test('serves index and game files with security headers', async () => {
  const t = await start();
  try {
    for (const p of ['/', '/web/index.html', '/games/demo/index.js?x=1']) {
      const r = await req(t.port, 'GET', p);
      assert.equal(r.status, 200, p);
      for (const [k, v] of Object.entries(SECURITY_HEADERS))
        assert.equal(r.headers[k.toLowerCase()], v);
    }
    const js = await req(t.port, 'GET', '/games/demo/index.js');
    assert.equal(js.body, 'export default 1;');
    assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal((await req(t.port, 'GET', '/web/nope.js')).status, 404);
    assert.equal((await req(t.port, 'GET', '/games/demo')).status, 404);
    assert.equal((await req(t.port, 'GET', '/nothing')).status, 404);
    assert.equal((await req(t.port, 'POST', '/web/index.html')).status, 405);
  } finally {
    await t.srv.close();
  }
});

test('blocks path traversal', async () => {
  const t = await start();
  try {
    for (const p of [
      '/web/%2e%2e/secret.txt',
      '/games/%2e%2e/secret.txt',
      '/web/a%00b',
      '/web/%E0%A4%A',
    ]) {
      const r = await req(t.port, 'GET', p);
      assert.equal(r.status, 400, p);
      assert.ok(!r.body.includes('secret'));
    }
  } finally {
    await t.srv.close();
  }
});

test('rejects foreign Host with 403', async () => {
  const t = await start();
  try {
    for (const p of ['/', '/health', '/api/settings']) {
      const r = await req(t.port, 'GET', p, { Host: `evil.com:${t.port}` });
      assert.equal(r.status, 403, p);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
    }
  } finally {
    await t.srv.close();
  }
});

test('GET /api/games lists the registry and logs warnings once', async () => {
  const t = await start();
  try {
    const r = await req(t.port, 'GET', '/api/games');
    assert.equal(r.status, 200);
    assert.deepEqual(
      JSON.parse(r.body).map((g) => g.id),
      ['demo'],
    );
    await req(t.port, 'GET', '/api/games');
    const log = fs.readFileSync(path.join(t.dataDir, 'arcade.log'), 'utf8').trim().split('\n');
    assert.equal(log.length, 1);
    assert.match(log[0], /^\d{4}-\d\d-\d\dT[\d:.]+Z server bad: /);
  } finally {
    await t.srv.close();
  }
});

test('POST /api/settings needs matching Origin and JSON, validates', async () => {
  const t = await start();
  const origin = `http://127.0.0.1:${t.port}`;
  const json = { 'Content-Type': 'application/json' };
  try {
    const noOrigin = await req(t.port, 'POST', '/api/settings', json, '{"mode":"auto"}');
    assert.equal(noOrigin.status, 403);
    const badOrigin = await req(
      t.port,
      'POST',
      '/api/settings',
      { ...json, Origin: 'http://evil.com' },
      '{"mode":"auto"}',
    );
    assert.equal(badOrigin.status, 403);
    const text = await req(
      t.port,
      'POST',
      '/api/settings',
      { 'Content-Type': 'text/plain', Origin: origin },
      '{"mode":"auto"}',
    );
    assert.equal(text.status, 415);
    const ok = await req(
      t.port,
      'POST',
      '/api/settings',
      { ...json, Origin: origin },
      '{"mode":"auto"}',
    );
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).mode, 'auto');
    const got = await req(t.port, 'GET', '/api/settings');
    assert.equal(JSON.parse(got.body).mode, 'auto');
    const bad = await req(
      t.port,
      'POST',
      '/api/settings',
      { ...json, Origin: origin },
      '{"port":1}',
    );
    assert.equal(bad.status, 400);
    assert.ok(JSON.parse(bad.body).errors.length > 0);
    const malformed = await req(
      t.port,
      'POST',
      '/api/settings',
      { ...json, Origin: origin },
      '{oops',
    );
    assert.equal(malformed.status, 400);
    const arr = await req(t.port, 'POST', '/api/settings', { ...json, Origin: origin }, '[1]');
    assert.equal(arr.status, 400);
    const big = await req(
      t.port,
      'POST',
      '/api/settings',
      { ...json, Origin: origin },
      JSON.stringify({ mode: 'x'.repeat(5000) }),
    );
    assert.equal(big.status, 413);
    assert.equal((await req(t.port, 'PUT', '/api/settings', { Origin: origin })).status, 405);
  } finally {
    await t.srv.close();
  }
});

test('POST /api/shutdown needs the token', async () => {
  let called = 0;
  const t = await start({ onShutdown: () => called++ });
  const origin = `http://127.0.0.1:${t.port}`;
  const wrong = await req(t.port, 'POST', '/api/shutdown', { 'X-Arcade-Token': 'nope' });
  assert.equal(wrong.status, 403);
  const none = await req(t.port, 'POST', '/api/shutdown');
  assert.equal(none.status, 403);
  const foreign = await req(t.port, 'POST', '/api/shutdown', {
    'X-Arcade-Token': 'tok',
    Origin: 'http://evil.com',
  });
  assert.equal(foreign.status, 403);
  assert.equal(called, 0);
  const right = await req(t.port, 'POST', '/api/shutdown', {
    'X-Arcade-Token': 'tok',
    Origin: origin,
  });
  assert.equal(right.status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(called, 1);
  await assert.rejects(req(t.port, 'GET', '/health'));
});

test('falls back to the next port and reports the range when all are busy', async () => {
  const fx = fixture();
  const p = await freePort();
  const blockers = [];
  const block = async (port) => {
    const s = http.createServer();
    await new Promise((r, j) => {
      s.once('error', j);
      s.listen(port, '127.0.0.1', r);
    });
    blockers.push(s);
  };
  const opts = { rootDir: fx.rootDir, dataDir: fx.dataDir, token: 't', env: {} };
  let created;
  try {
    await block(p);
    created = await createArcadeServer({ ...opts, port: p });
    assert.equal(created.port, p + 1);
    const r = await req(created.port, 'GET', '/health');
    assert.equal(r.status, 200);
    await created.close();
    created = null;
    for (let i = 1; i < 10; i++) await block(p + i);
    await assert.rejects(createArcadeServer({ ...opts, port: p }), (e) => {
      assert.ok(e instanceof PortRangeBusyError);
      assert.equal(e.from, p);
      assert.equal(e.to, p + 9);
      return true;
    });
  } finally {
    if (created) await created.close();
    await Promise.all(blockers.map((s) => new Promise((r) => s.close(r))));
  }
});

test('/health reports name, pid, rootDir', async () => {
  const t = await start();
  try {
    const r = await req(t.port, 'GET', '/health');
    assert.equal(r.status, 200);
    const h = JSON.parse(r.body);
    assert.equal(h.ok, true);
    assert.equal(h.name, 'claude-arcade');
    assert.equal(h.pid, process.pid);
    assert.equal(h.rootDir, t.rootDir);
    assert.equal(h.clients, 0);
    assert.match(h.version, /^\d+\.\d+\.\d+$/);
    assert.equal(t.srv.clientCount(), 0);
  } finally {
    await t.srv.close();
  }
});
