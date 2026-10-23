import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { browserCommands, openBrowser } from '../../server/open-browser.js';

test('command table per platform', () => {
  assert.deepEqual(browserCommands('u', { platform: 'darwin', isWsl: false, hasDisplay: true }), [
    ['open', ['u']],
  ]);
  assert.deepEqual(browserCommands('u', { platform: 'win32', isWsl: false, hasDisplay: true }), [
    ['cmd', ['/c', 'start', '""', 'u']],
  ]);
  assert.deepEqual(browserCommands('u', { platform: 'linux', isWsl: true, hasDisplay: false }), [
    ['wslview', ['u']],
    ['cmd.exe', ['/c', 'start', '""', 'u']],
  ]);
  assert.deepEqual(browserCommands('u', { platform: 'linux', isWsl: false, hasDisplay: true }), [
    ['xdg-open', ['u']],
  ]);
  assert.deepEqual(
    browserCommands('u', { platform: 'linux', isWsl: false, hasDisplay: false }),
    [],
  );
});

function fakeSpawn(outcomes) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.unref = () => {};
    const outcome = outcomes[cmd];
    setImmediate(() => child.emit(outcome === 'ok' ? 'spawn' : 'error', new Error('ENOENT')));
    return child;
  };
  return { fn, calls };
}

const WSL = { platform: 'linux', isWsl: true, hasDisplay: false };

test('openBrowser falls through to the next candidate on error', async () => {
  const { fn, calls } = fakeSpawn({ wslview: 'error', 'cmd.exe': 'ok' });
  assert.equal(await openBrowser('u', WSL, fn), true);
  assert.deepEqual(
    calls.map((c) => c.cmd),
    ['wslview', 'cmd.exe'],
  );
  assert.deepEqual(calls[0].opts, { detached: true, stdio: 'ignore', windowsHide: true });
});

test('openBrowser returns false when no candidate works or none exist', async () => {
  const { fn } = fakeSpawn({ wslview: 'error', 'cmd.exe': 'error' });
  assert.equal(await openBrowser('u', WSL, fn), false);
  assert.equal(
    await openBrowser('u', { platform: 'linux', isWsl: false, hasDisplay: false }, fn),
    false,
  );
});

test('win32 spawns cmd with verbatim arguments; unsafe URLs are refused', async () => {
  const { fn, calls } = fakeSpawn({ cmd: 'ok' });
  const win = { platform: 'win32', isWsl: false, hasDisplay: true };
  assert.equal(await openBrowser('http://127.0.0.1:4417/#snake', win, fn), true);
  assert.deepEqual(calls[0].opts, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  assert.equal(await openBrowser('http://127.0.0.1:1/&calc', win, fn), false);
  assert.equal(calls.length, 1);
});
