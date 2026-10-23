import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULTS,
  resolveSettings,
  validateSetting,
  writeSettings,
} from '../../server/settings.js';
import { tmp } from '../helpers/tmp.js';

test('defaults when nothing is set', () => {
  assert.deepEqual(resolveSettings({ dataDir: tmp(), env: {} }), {
    mode: 'alert',
    port: 4417,
    autoOpenDelay: 20,
  });
  assert.ok(Object.isFrozen(DEFAULTS));
});

test('env overrides defaults; settings.json overrides env', () => {
  const dir = tmp();
  const env = {
    CLAUDE_PLUGIN_OPTION_MODE: 'quiet',
    CLAUDE_PLUGIN_OPTION_PORT: '5000',
    CLAUDE_PLUGIN_OPTION_AUTOOPENDELAY: '30',
  };
  assert.deepEqual(resolveSettings({ dataDir: dir, env }), {
    mode: 'quiet',
    port: 5000,
    autoOpenDelay: 30,
  });
  writeSettings(dir, { mode: 'auto' });
  assert.equal(resolveSettings({ dataDir: dir, env }).mode, 'auto');
});

test('invalid values fall through to the next layer', () => {
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ mode: 'loud', autoOpenDelay: 1 }),
  );
  const s = resolveSettings({ dataDir: dir, env: { CLAUDE_PLUGIN_OPTION_PORT: '80' } });
  assert.deepEqual(s, { mode: 'alert', port: 4417, autoOpenDelay: 20 });
});

test('corrupt settings.json is ignored', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), '{not json');
  assert.deepEqual(resolveSettings({ dataDir: dir, env: {} }), { ...DEFAULTS });
});

test('writeSettings rejects port and unknown keys, validates ranges', () => {
  assert.equal(writeSettings(tmp(), { port: 5000 }).ok, false);
  assert.equal(writeSettings(tmp(), { volume: 1 }).ok, false);
  assert.equal(writeSettings(tmp(), { autoOpenDelay: 601 }).ok, false);
  assert.equal(writeSettings(tmp(), { autoOpenDelay: 600 }).ok, true);
});

test('writeSettings merges, creates the dir, and leaves no temp files', () => {
  const dir = path.join(tmp(), 'nested', 'data');
  assert.equal(writeSettings(dir, { mode: 'quiet' }).ok, true);
  const r = writeSettings(dir, { autoOpenDelay: '45' });
  assert.deepEqual(r, { ok: true, settings: { mode: 'quiet', autoOpenDelay: 45 } });
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')),
    r.settings,
  );
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});

test('failed writeSettings does not modify the file', () => {
  const dir = tmp();
  writeSettings(dir, { mode: 'auto' });
  const r = writeSettings(dir, { mode: 'auto', autoOpenDelay: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), {
    mode: 'auto',
  });
});

test('validateSetting coerces numeric strings and rejects non-integers', () => {
  assert.deepEqual(validateSetting('port', '4417'), { ok: true, value: 4417 });
  assert.equal(validateSetting('autoOpenDelay', 5.5).ok, false);
  assert.equal(validateSetting('port', '1023').ok, false);
  assert.equal(validateSetting('port', '65536').ok, false);
  assert.equal(validateSetting('port', '').ok, false);
  assert.equal(validateSetting('port', '12abc').ok, false);
  assert.equal(validateSetting('autoOpenDelay', null).ok, false);
  assert.equal(validateSetting('autoOpenDelay', 4).ok, false);
  assert.deepEqual(validateSetting('autoOpenDelay', 5), { ok: true, value: 5 });
  assert.deepEqual(validateSetting('mode', 'quiet'), { ok: true, value: 'quiet' });
  assert.equal(validateSetting('mode', 'loud').ok, false);
  assert.equal(validateSetting('nope', 1).ok, false);
});
