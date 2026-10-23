import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { run } from '../../hooks/status.js';
import { readStatus } from '../../server/status-store.js';
import { pluginRoot } from '../../server/paths.js';
import { tmp } from '../helpers/tmp.js';

function runHook(state, stdin, env, calls = []) {
  run({
    state,
    stdinText: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    env,
    now: new Date(),
    spawnAutoOpen: (...a) => calls.push(a),
  });
  return calls;
}

test('working writes the session and does not spawn in alert mode', () => {
  const dir = tmp();
  const calls = runHook('working', { session_id: 's1', cwd: '/p/demo' }, { ARCADE_DATA_DIR: dir });
  const s = readStatus(dir).sessions.s1;
  assert.equal(s.state, 'working');
  assert.equal(s.project, 'demo');
  assert.equal(calls.length, 0);
});

test('auto mode spawns the auto-open timer with the configured delay', () => {
  const dir = tmp();
  const env = {
    ARCADE_DATA_DIR: dir,
    CLAUDE_PLUGIN_OPTION_MODE: 'auto',
    CLAUDE_PLUGIN_OPTION_AUTOOPENDELAY: '45',
  };
  const calls = runHook('working', { session_id: 's1' }, env);
  assert.deepEqual(calls, [['s1', 45]]);
});

test('auto mode does not spawn for non-working states', () => {
  const dir = tmp();
  const env = { ARCADE_DATA_DIR: dir, CLAUDE_PLUGIN_OPTION_MODE: 'auto' };
  assert.deepEqual(runHook('done', { session_id: 's1' }, env), []);
});

test('malformed stdin falls back to session "unknown"', () => {
  const dir = tmp();
  runHook('needs-you', 'not json', { ARCADE_DATA_DIR: dir });
  assert.equal(readStatus(dir).sessions.unknown.state, 'needs-you');
});

test('end removes the session', () => {
  const dir = tmp();
  runHook('working', { session_id: 's1' }, { ARCADE_DATA_DIR: dir });
  runHook('end', { session_id: 's1' }, { ARCADE_DATA_DIR: dir });
  assert.deepEqual(readStatus(dir).sessions, {});
});

test('unknown state never throws and logs to arcade.log', () => {
  const dir = tmp();
  assert.doesNotThrow(() => runHook('bogus', { session_id: 's1' }, { ARCADE_DATA_DIR: dir }));
  assert.deepEqual(readStatus(dir).sessions, {});
  const log = fs.readFileSync(path.join(dir, 'arcade.log'), 'utf8');
  assert.match(log, /^\d{4}-\d\d-\d\dT[\d:.]+Z status\.js .*bogus/m);
});

test('unwritable data dir never throws', () => {
  const dir = tmp();
  const file = path.join(dir, 'file');
  fs.writeFileSync(file, 'x');
  const env = { ARCADE_DATA_DIR: path.join(file, 'sub') };
  assert.doesNotThrow(() => runHook('working', { session_id: 's1' }, env));
  assert.doesNotThrow(() => runHook('bogus', {}, env));
});

test('a throwing spawnAutoOpen never propagates', () => {
  const dir = tmp();
  const env = { ARCADE_DATA_DIR: dir, CLAUDE_PLUGIN_OPTION_MODE: 'auto' };
  assert.doesNotThrow(() =>
    run({
      state: 'working',
      stdinText: '{}',
      env,
      now: new Date(),
      spawnAutoOpen: () => {
        throw new Error('boom');
      },
    }),
  );
  assert.match(fs.readFileSync(path.join(dir, 'arcade.log'), 'utf8'), /boom/);
});

test('run() completes in under 100 ms', () => {
  const dir = tmp();
  const t0 = performance.now();
  runHook('working', { session_id: 's1', cwd: '/p/demo' }, { ARCADE_DATA_DIR: dir });
  assert.ok(performance.now() - t0 < 100);
});

test('as a process: exits 0 with empty stdout even on garbage input', () => {
  const dir = tmp();
  const r = spawnSync(process.execPath, ['hooks/status.js', 'done'], {
    input: 'not json',
    env: { ...process.env, ARCADE_DATA_DIR: dir },
    encoding: 'utf8',
    cwd: pluginRoot,
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(readStatus(dir).sessions.unknown.state, 'done');
});

test('hooks.json maps every event to status.js with the right state', () => {
  const json = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
  const expected = {
    UserPromptSubmit: 'working',
    PermissionRequest: 'needs-you',
    Notification: 'needs-you',
    Stop: 'done',
    SessionEnd: 'end',
  };
  assert.deepEqual(Object.keys(json.hooks).sort(), Object.keys(expected).sort());
  for (const [event, state] of Object.entries(expected)) {
    assert.deepEqual(json.hooks[event], [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/status.js" ${state}`,
            timeout: 10,
          },
        ],
      },
    ]);
  }
});

test('hook persists valid plugin options for the server', () => {
  const dir = tmp();
  runHook(
    'working',
    { session_id: 's1' },
    {
      ARCADE_DATA_DIR: dir,
      CLAUDE_PLUGIN_OPTION_MODE: 'quiet',
      CLAUDE_PLUGIN_OPTION_PORT: 'nope',
    },
  );
  const file = path.join(dir, 'plugin-options.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mode: 'quiet' });
  const ino = fs.statSync(file).ino;
  runHook(
    'done',
    { session_id: 's1' },
    { ARCADE_DATA_DIR: dir, CLAUDE_PLUGIN_OPTION_MODE: 'quiet' },
  );
  assert.equal(fs.statSync(file).ino, ino, 'unchanged content is not rewritten');
});

test('hook writes no plugin-options.json when options are invalid or absent', () => {
  const dir = tmp();
  runHook(
    'working',
    { session_id: 's1' },
    { ARCADE_DATA_DIR: dir, CLAUDE_PLUGIN_OPTION_MODE: 'bogus' },
  );
  assert.equal(fs.existsSync(path.join(dir, 'plugin-options.json')), false);
});

test('hook still exits 0 with plugin options when the data dir is unwritable', () => {
  const dir = tmp();
  const blocker = path.join(dir, 'file');
  fs.writeFileSync(blocker, 'x');
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'hooks', 'status.js'), 'working'], {
    input: '{}',
    env: {
      ...process.env,
      ARCADE_DATA_DIR: path.join(blocker, 'sub'),
      CLAUDE_PLUGIN_OPTION_MODE: 'quiet',
    },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.length, 0);
});
