import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

test('plugin.json declares arcade with userConfig defaults', () => {
  const p = readJson('.claude-plugin/plugin.json');
  assert.equal(p.name, 'arcade');
  assert.equal(p.displayName, 'Claude Arcade');
  assert.equal(p.license, 'Apache-2.0');
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(p.userConfig.mode.options, ['alert', 'auto', 'quiet']);
  assert.equal(p.userConfig.mode.default, 'alert');
  assert.equal(p.userConfig.port.default, 4417);
  assert.equal(p.userConfig.autoOpenDelay.default, 20);
});

test('marketplace.json lists arcade with source "./"', () => {
  const m = readJson('.claude-plugin/marketplace.json');
  assert.equal(m.plugins.length, 1);
  assert.equal(m.plugins[0].name, 'arcade');
  assert.equal(m.plugins[0].source, './');
});

test('package.json has no runtime dependencies and no lockfile is tracked', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.dependencies, undefined);
  assert.ok(Object.values(pkg.devDependencies).every((v) => /^\d+\.\d+\.\d+$/.test(v)));
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8', cwd: root }).split('\n');
  assert.ok(!tracked.includes('package-lock.json'));
});
