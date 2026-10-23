import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  STATUS_FILE,
  applyEvent,
  emptyStatus,
  markAutoOpened,
  projectName,
  readStatus,
  updateStatus,
  writeStatusAtomic,
} from '../../server/status-store.js';
import { tmp } from '../helpers/tmp.js';

const t0 = new Date('2026-10-23T09:00:00Z');
const at = (ms) => new Date(t0.getTime() + ms);

test('emptyStatus shape', () => {
  assert.deepEqual(emptyStatus(), { version: 1, updatedAt: null, sessions: {} });
  assert.equal(STATUS_FILE, 'status.json');
});

test('applyEvent sets state, project, since', () => {
  const s = applyEvent(emptyStatus(), {
    state: 'working',
    sessionId: 'a',
    cwd: '/x/my-repo',
    now: t0,
  });
  assert.deepEqual(s.sessions.a, {
    state: 'working',
    project: 'my-repo',
    since: t0.toISOString(),
    updatedAt: t0.toISOString(),
  });
  assert.equal(s.updatedAt, t0.toISOString());
});

test('applyEvent is pure', () => {
  const base = emptyStatus();
  const s = applyEvent(base, { state: 'working', sessionId: 'a', cwd: '/x/r', now: t0 });
  assert.notEqual(s, base);
  assert.deepEqual(base, emptyStatus());
});

test('since is kept when state repeats, changes when state changes', () => {
  const ev = (state, now) => ({ state, sessionId: 'a', cwd: '/x/r', now });
  let s = applyEvent(emptyStatus(), ev('working', t0));
  s = applyEvent(s, ev('working', at(1000)));
  assert.equal(s.sessions.a.since, t0.toISOString());
  assert.equal(s.sessions.a.updatedAt, at(1000).toISOString());
  s = applyEvent(s, ev('done', at(2000)));
  assert.equal(s.sessions.a.since, at(2000).toISOString());
});

test('project is kept when a later event has no cwd', () => {
  let s = applyEvent(emptyStatus(), { state: 'working', sessionId: 'a', cwd: '/x/r', now: t0 });
  s = applyEvent(s, { state: 'done', sessionId: 'a', now: at(1000) });
  assert.equal(s.sessions.a.project, 'r');
});

test('end removes the session', () => {
  let s = applyEvent(emptyStatus(), { state: 'working', sessionId: 'a', cwd: '/x/r', now: t0 });
  s = applyEvent(s, { state: 'end', sessionId: 'a', now: at(1000) });
  assert.deepEqual(s.sessions, {});
  assert.equal(s.updatedAt, at(1000).toISOString());
});

test('sessions idle for more than 24h are pruned on any event', () => {
  const day = 24 * 60 * 60 * 1000;
  const base = applyEvent(emptyStatus(), { state: 'working', sessionId: 'b', now: t0 });
  const pruned = applyEvent(base, { state: 'working', sessionId: 'a', now: at(day + 1000) });
  assert.equal(pruned.sessions.b, undefined);
  assert.ok(pruned.sessions.a);
  const kept = applyEvent(base, { state: 'working', sessionId: 'a', now: at(day) });
  assert.ok(kept.sessions.b);
});

test('autoOpened survives later events', () => {
  let s = applyEvent(emptyStatus(), { state: 'needs-you', sessionId: 'a', cwd: '/x/r', now: t0 });
  s = markAutoOpened(s, 'a');
  assert.equal(s.sessions.a.autoOpened, true);
  s = applyEvent(s, { state: 'needs-you', sessionId: 'a', cwd: '/x/r', now: at(1000) });
  assert.equal(s.sessions.a.autoOpened, true);
  s = applyEvent(s, { state: 'working', sessionId: 'a', cwd: '/x/r', now: at(2000) });
  assert.equal(s.sessions.a.autoOpened, true);
});

test('markAutoOpened is pure and ignores unknown sessions', () => {
  const s = applyEvent(emptyStatus(), { state: 'done', sessionId: 'a', now: t0 });
  const m = markAutoOpened(s, 'a');
  assert.equal(s.sessions.a.autoOpened, undefined);
  assert.notEqual(m, s);
  assert.deepEqual(markAutoOpened(s, 'zzz'), s);
});

test('projectName handles win32 and unicode paths', () => {
  assert.equal(projectName('C:\\Users\\Jane Doe\\my repo'), 'my repo');
  assert.equal(projectName('/home/한글/프로젝트'), '프로젝트');
  assert.equal(projectName(undefined), '');
  assert.equal(projectName(''), '');
});

test('readStatus tolerates missing, corrupt and wrong-version files', () => {
  const dir = tmp();
  assert.deepEqual(readStatus(dir), emptyStatus());
  assert.deepEqual(readStatus(path.join(dir, 'nope')), emptyStatus());
  const file = path.join(dir, STATUS_FILE);
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(readStatus(dir), emptyStatus());
  fs.writeFileSync(file, JSON.stringify({ version: 2, updatedAt: null, sessions: {} }));
  assert.deepEqual(readStatus(dir), emptyStatus());
  fs.writeFileSync(file, 'null');
  assert.deepEqual(readStatus(dir), emptyStatus());
});

test('writeStatusAtomic creates the directory and leaves no tmp files', () => {
  const dir = path.join(tmp(), 'deep', 'er');
  const s = applyEvent(emptyStatus(), { state: 'done', sessionId: 'a', cwd: '/x/r', now: t0 });
  writeStatusAtomic(dir, s);
  assert.deepEqual(readStatus(dir), s);
  assert.deepEqual(fs.readdirSync(dir), [STATUS_FILE]);
});

test('writeStatusAtomic removes its tmp file when the write fails', () => {
  const dir = tmp();
  // A directory at the target path makes rename fail on every platform.
  fs.mkdirSync(path.join(dir, STATUS_FILE));
  assert.throws(() => writeStatusAtomic(dir, emptyStatus()));
  assert.deepEqual(fs.readdirSync(dir), [STATUS_FILE]);
});

test('updateStatus reads, applies, writes and returns', () => {
  const dir = tmp();
  const out = updateStatus(dir, (s) =>
    applyEvent(s, { state: 'working', sessionId: 'a', cwd: '/x/r', now: t0 }),
  );
  assert.deepEqual(readStatus(dir), out);
  assert.equal(out.sessions.a.state, 'working');
});

test('concurrent writers never corrupt status.json', async () => {
  const dir = tmp();
  const moduleUrl = pathToFileURL(path.resolve('server/status-store.js')).href;
  const code = `
    import { updateStatus, applyEvent } from ${JSON.stringify(moduleUrl)};
    const [dir, id] = process.argv.slice(1);
    for (let i = 0; i < 25; i++) {
      updateStatus(dir, (s) => applyEvent(s, { state: 'working', sessionId: id, cwd: '/x/r', now: new Date() }));
    }
  `;
  const run = (id) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code, dir, `s${id}`], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', reject);
      child.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`exit ${c}: ${stderr}`))));
    });
  await Promise.all(Array.from({ length: 20 }, (_, i) => run(i)));
  const parsed = JSON.parse(fs.readFileSync(path.join(dir, STATUS_FILE), 'utf8'));
  assert.equal(parsed.version, 1);
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')),
    [],
  );
});
