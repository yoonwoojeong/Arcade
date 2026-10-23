import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir, parseGlobalFlags, pluginRoot } from '../../server/paths.js';

const home = path.join(os.homedir(), '.claude', 'arcade');

test('dataDir precedence: flag > ARCADE_DATA_DIR > CLAUDE_PLUGIN_DATA > home', () => {
  const env = { ARCADE_DATA_DIR: '/a', CLAUDE_PLUGIN_DATA: '/c' };
  assert.equal(dataDir({ flag: '/f', env }), path.resolve('/f'));
  assert.equal(dataDir({ env }), path.resolve('/a'));
  assert.equal(dataDir({ env: { CLAUDE_PLUGIN_DATA: '/c' } }), path.resolve('/c'));
  assert.equal(dataDir({ env: {} }), home);
});

test('unexpanded placeholders and empty values are ignored', () => {
  assert.equal(dataDir({ flag: '${CLAUDE_PLUGIN_DATA}', env: { CLAUDE_PLUGIN_DATA: '' } }), home);
  const { flags, rest } = parseGlobalFlags([
    'open',
    '--mode',
    '${user_config.mode}',
    '--port',
    '5000',
    'snake',
  ]);
  assert.deepEqual(flags, { port: '5000' });
  assert.deepEqual(rest, ['open', 'snake']);
});

test('pluginRoot contains .claude-plugin/plugin.json', () => {
  assert.ok(fs.existsSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json')));
});
