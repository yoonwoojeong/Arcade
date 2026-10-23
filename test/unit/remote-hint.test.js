import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteHint } from '../../server/remote-hint.js';

const desktop = { platform: 'linux', isWsl: false, hasDisplay: true, isRemote: false };
const headless = { platform: 'linux', isWsl: false, hasDisplay: false, isRemote: false };
const remote = { platform: 'linux', isWsl: false, hasDisplay: false, isRemote: true };

test('SSH session: ssh -L command built from SSH_CONNECTION, same port both sides', () => {
  const hint = remoteHint({
    url: 'http://127.0.0.1:4419/#snake',
    env: { SSH_CONNECTION: '203.0.113.9 51234 10.0.0.5 22' },
    detected: remote,
    user: 'jane',
  });
  assert.equal(
    hint,
    'On your own machine run: ssh -L 4419:127.0.0.1:4419 jane@10.0.0.5 ' +
      '(adjust to how you normally connect), then open http://localhost:4419/#snake',
  );
});

test('SSH session without SSH_CONNECTION (SSH_TTY only) uses a <host> placeholder', () => {
  const hint = remoteHint({
    url: 'http://127.0.0.1:4417/',
    env: { SSH_TTY: '/dev/pts/0' },
    detected: remote,
    user: 'jane',
  });
  assert.match(hint, /ssh -L 4417:127\.0\.0\.1:4417 jane@<host> /);
  assert.match(hint, /then open http:\/\/localhost:4417\/$/);
});

test('malformed SSH_CONNECTION falls back to the placeholder', () => {
  const hint = remoteHint({
    url: 'http://127.0.0.1:4417/',
    env: { SSH_CONNECTION: 'garbage' },
    detected: remote,
    user: 'jane',
  });
  assert.match(hint, /jane@<host> /);
});

test('headless Linux without SSH (container or cloud session): generic forward hint', () => {
  const hint = remoteHint({
    url: 'http://127.0.0.1:4417/#2048',
    env: {},
    detected: headless,
    user: 'jane',
  });
  assert.equal(
    hint,
    'This session has no browser. Forward port 4417 from this machine to your own ' +
      '(for example with your editor’s port forwarding), then open http://localhost:4417/#2048',
  );
});

test('no extra hint when a browser launch merely failed on a desktop or WSL', () => {
  assert.equal(remoteHint({ url: 'http://127.0.0.1:4417/', env: {}, detected: desktop }), null);
  assert.equal(
    remoteHint({
      url: 'http://127.0.0.1:4417/',
      env: {},
      detected: { platform: 'darwin', isWsl: false, hasDisplay: true, isRemote: false },
    }),
    null,
  );
  assert.equal(
    remoteHint({
      url: 'http://127.0.0.1:4417/',
      env: {},
      detected: { platform: 'win32', isWsl: false, hasDisplay: false, isRemote: false },
    }),
    null,
  );
  assert.equal(
    remoteHint({
      url: 'http://127.0.0.1:4417/',
      env: {},
      detected: { platform: 'linux', isWsl: true, hasDisplay: false, isRemote: false },
    }),
    null,
  );
});

test('an unusable username falls back to the placeholder', () => {
  const hint = remoteHint({
    url: 'http://127.0.0.1:4417/',
    env: { SSH_CONNECTION: '1.2.3.4 1 10.0.0.5 22' },
    detected: remote,
    user: 'bad user;rm',
  });
  assert.match(hint, / <user>@10\.0\.0\.5 /);
});

test('an unusable server address in SSH_CONNECTION falls back to the placeholder', () => {
  const hint = remoteHint({
    url: 'http://127.0.0.1:4417/',
    env: { SSH_CONNECTION: '1.2.3.4 1 evil;host 22' },
    detected: remote,
    user: 'jane',
  });
  assert.match(hint, /jane@<host> /);
});
