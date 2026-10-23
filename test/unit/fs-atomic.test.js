import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renameWithRetry, writeFileAtomicSync } from '../../server/fs-atomic.js';
import { tmp } from '../helpers/tmp.js';

const fail = (code) => Object.assign(new Error(code), { code });

// A rename that fails `n` times with `code`, then succeeds.
function flaky(n, code = 'EPERM') {
  const calls = [];
  const rename = (from, to) => {
    calls.push([from, to]);
    if (calls.length <= n) throw fail(code);
  };
  return { rename, calls };
}

function fakeSleep() {
  const slept = [];
  return { sleep: (ms) => slept.push(ms), slept };
}

for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
  test(`renameWithRetry retries ${code} on win32 until rename succeeds`, () => {
    const { rename, calls } = flaky(7, code);
    const { sleep, slept } = fakeSleep();
    renameWithRetry('a.tmp', 'a', { rename, sleep, platform: 'win32' });
    assert.equal(calls.length, 8);
    assert.deepEqual(calls[7], ['a.tmp', 'a']);
    assert.equal(slept.length, 7);
  });
}

test('renameWithRetry backs off with jitter and stays within the total budget', () => {
  const { rename, calls } = flaky(Infinity);
  const { sleep, slept } = fakeSleep();
  assert.throws(
    () => renameWithRetry('a.tmp', 'a', { rename, sleep, platform: 'win32', random: () => 0.5 }),
    { code: 'EPERM' },
  );
  const total = slept.reduce((a, b) => a + b, 0);
  assert.ok(total <= 1000, `slept ${total} ms`);
  assert.ok(total >= 900, `gave up early after ${total} ms`);
  assert.equal(calls.length, slept.length + 1);
  // delays grow (exponential backoff) and every delay is positive
  assert.ok(slept.every((ms) => ms > 0));
  assert.ok(slept[3] > slept[0]);
  // jitter: a different random draw gives different delays
  const other = fakeSleep();
  assert.throws(() =>
    renameWithRetry('a.tmp', 'a', {
      rename: flaky(Infinity).rename,
      sleep: other.sleep,
      platform: 'win32',
      random: () => 0,
    }),
  );
  assert.notDeepEqual(other.slept.slice(0, 3), slept.slice(0, 3));
});

test('renameWithRetry honours a custom totalMs budget', () => {
  const { sleep, slept } = fakeSleep();
  assert.throws(() =>
    renameWithRetry('a.tmp', 'a', {
      rename: flaky(Infinity).rename,
      sleep,
      platform: 'win32',
      totalMs: 50,
    }),
  );
  assert.ok(slept.reduce((a, b) => a + b, 0) <= 50);
});

test('renameWithRetry does not retry other error codes on win32', () => {
  const { rename, calls } = flaky(1, 'ENOENT');
  const { sleep, slept } = fakeSleep();
  assert.throws(() => renameWithRetry('a.tmp', 'a', { rename, sleep, platform: 'win32' }), {
    code: 'ENOENT',
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(slept, []);
});

test('renameWithRetry does not retry on non-Windows platforms', () => {
  for (const platform of ['linux', 'darwin']) {
    const { rename, calls } = flaky(1, 'EPERM');
    const { sleep, slept } = fakeSleep();
    assert.throws(() => renameWithRetry('a.tmp', 'a', { rename, sleep, platform }), {
      code: 'EPERM',
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(slept, []);
  }
});

test('renameWithRetry renames a real file with the default rename and sleep', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.tmp'), 'x');
  renameWithRetry(path.join(dir, 'a.tmp'), path.join(dir, 'a'));
  assert.deepEqual(fs.readdirSync(dir), ['a']);
});

test('writeFileAtomicSync replaces the file and leaves no tmp files', () => {
  const dir = tmp();
  const file = path.join(dir, 'f.json');
  writeFileAtomicSync(file, 'one');
  writeFileAtomicSync(file, 'two');
  assert.equal(fs.readFileSync(file, 'utf8'), 'two');
  assert.deepEqual(fs.readdirSync(dir), ['f.json']);
});

test('writeFileAtomicSync removes its tmp file and rethrows when the rename fails', () => {
  const dir = tmp();
  const file = path.join(dir, 'f.json');
  const { sleep } = fakeSleep();
  assert.throws(
    () =>
      writeFileAtomicSync(file, 'x', {
        rename: flaky(Infinity).rename,
        sleep,
        platform: 'win32',
      }),
    { code: 'EPERM' },
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('writeFileAtomicSync retries a transient win32 rename failure', () => {
  const dir = tmp();
  const file = path.join(dir, 'f.json');
  let failures = 3;
  const rename = (from, to) => {
    if (failures-- > 0) throw fail('EPERM');
    fs.renameSync(from, to);
  };
  writeFileAtomicSync(file, 'ok', { rename, sleep: () => {}, platform: 'win32' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'ok');
  assert.deepEqual(fs.readdirSync(dir), ['f.json']);
});
