import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FIELDS, validateManifest, loadRegistry } from '../../server/registry.js';
import { tmp } from '../helpers/tmp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const valid = {
  id: 'snake',
  title: 'Snake',
  version: '1.0.0',
  sdk: 1,
  author: 'a',
  description: 'd',
  controls: { keyboard: ['Arrows: move'] },
  accessibility: { screenReader: 'none', reducedMotion: true, colorIndependent: true },
  sessionLength: 'short',
};

function addGame(dir, id, manifest, { index = true } = {}) {
  const g = path.join(dir, id);
  fs.mkdirSync(g, { recursive: true });
  fs.writeFileSync(
    path.join(g, 'game.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
  );
  if (index) fs.writeFileSync(path.join(g, 'index.js'), 'export default () => ({});\n');
}

test('valid manifest has no errors', () => assert.deepEqual(validateManifest(valid, 'snake'), []));

test('touch is optional but must be a string', () => {
  const withTouch = { ...valid, controls: { keyboard: ['x'], touch: 'swipe' } };
  assert.deepEqual(validateManifest(withTouch, 'snake'), []);
  assert.ok(
    validateManifest({ ...valid, controls: { keyboard: ['x'], touch: 1 } }, 'snake').length,
  );
});

test('non-object manifests are rejected', () => {
  for (const m of [null, [], 'x', 3]) assert.ok(validateManifest(m, 'snake').length);
});

test('id must match folder and pattern', () => {
  assert.ok(validateManifest(valid, 'other').length);
  assert.ok(validateManifest({ ...valid, id: '../x' }, '../x').length);
  assert.ok(validateManifest({ ...valid, id: '-ab' }, '-ab').length);
  assert.ok(validateManifest({ ...valid, id: 'a' }, 'a').length);
  assert.ok(validateManifest({ ...valid, id: 'a'.repeat(32) }, 'a'.repeat(32)).length);
  assert.deepEqual(validateManifest({ ...valid, id: 'a'.repeat(31) }, 'a'.repeat(31)), []);
});

test('enums, sdk and unknown keys are enforced', () => {
  const bad = (patch) => validateManifest({ ...valid, ...patch }, 'snake');
  assert.ok(bad({ accessibility: { ...valid.accessibility, screenReader: 'yes' } }).length);
  assert.ok(bad({ sdk: 2 }).length);
  assert.ok(bad({ sdk: '1' }).length);
  assert.ok(bad({ extra: 1 }).length);
  assert.ok(bad({ sessionLength: 'long' }).length);
  assert.ok(bad({ accessibility: { ...valid.accessibility, extra: 1 } }).length);
  assert.ok(bad({ controls: { keyboard: ['x'], extra: 1 } }).length);
});

test('string, semver and boolean rules are enforced', () => {
  const bad = (patch) => validateManifest({ ...valid, ...patch }, 'snake');
  assert.ok(bad({ title: '' }).length);
  assert.ok(bad({ title: 'x'.repeat(41) }).length);
  assert.deepEqual(bad({ title: 'x'.repeat(40) }), []);
  assert.ok(bad({ version: '1.0' }).length);
  assert.ok(bad({ version: 'v1.0.0' }).length);
  assert.ok(bad({ author: '' }).length);
  assert.ok(bad({ description: '' }).length);
  assert.ok(bad({ description: 'x'.repeat(141) }).length);
  assert.deepEqual(bad({ description: 'x'.repeat(140) }), []);
  assert.ok(bad({ controls: { keyboard: [] } }).length);
  assert.ok(bad({ controls: { keyboard: [1] } }).length);
  assert.ok(bad({ controls: {} }).length);
  assert.ok(bad({ accessibility: { ...valid.accessibility, reducedMotion: 'yes' } }).length);
  assert.ok(bad({ accessibility: { ...valid.accessibility, colorIndependent: 1 } }).length);
});

test('every required field is reported when missing', () => {
  for (const f of MANIFEST_FIELDS) {
    const m = { ...valid };
    delete m[f];
    assert.ok(validateManifest(m, 'snake').length, f);
  }
});

test('schema file requires exactly MANIFEST_FIELDS', () => {
  const s = readJson('schemas/game.schema.json');
  assert.deepEqual([...s.required].sort(), [...MANIFEST_FIELDS].sort());
  assert.equal(s.additionalProperties, false);
  assert.equal(s.properties.controls.additionalProperties, false);
  assert.equal(s.properties.accessibility.additionalProperties, false);
  assert.deepEqual(Object.keys(s.properties).sort(), [...MANIFEST_FIELDS].sort());
});

test('loadRegistry skips invalid games with a warning and sorts by title', () => {
  const dir = tmp();
  addGame(dir, 'zeta', { ...valid, id: 'zeta', title: 'Alpha' });
  addGame(dir, 'beta', { ...valid, id: 'beta', title: 'Beta' });
  addGame(dir, 'bad', { ...valid, id: 'other' });
  addGame(dir, 'broken', '{not json');
  addGame(dir, 'noindex', { ...valid, id: 'noindex' }, { index: false });
  fs.writeFileSync(path.join(dir, 'stray.txt'), 'x');
  const { games, warnings } = loadRegistry(dir);
  assert.deepEqual(
    games.map((g) => g.id),
    ['zeta', 'beta'],
  );
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((w) => w.startsWith('bad: ')));
  assert.ok(warnings.some((w) => w.startsWith('broken: ')));
});

test('loadRegistry on a missing dir returns empty results', () => {
  const dir = path.join(tmp(), 'nope');
  assert.deepEqual(loadRegistry(dir), { games: [], warnings: [] });
});
