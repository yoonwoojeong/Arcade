import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext } from '../../web/sdk.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const REQUIRED = [
  'README.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'CHANGELOG.md',
  'docs/architecture.md',
  'docs/game-authoring.md',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/feature.yml',
  '.github/ISSUE_TEMPLATE/game-proposal.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/pull_request_template.md',
  '.github/CODEOWNERS',
  '.github/labels.md',
];

test('required community and documentation files exist', () => {
  for (const rel of REQUIRED) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} is missing`);
});

test('README has both install commands and the Node.js requirement', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('/plugin marketplace add yoonwoojeong/Arcade'));
  assert.ok(readme.includes('/plugin install arcade@claude-arcade'));
  assert.ok(readme.includes('Node.js 20'));
});

test('README does not embed a demo image that is not recorded yet', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('<!-- demo GIF: docs/media/demo.gif (to be recorded) -->'));
  assert.ok(!/!\[[^\]]*\]\(docs\/media\/demo\.gif\)/.test(readme));
});

test('CHANGELOG has Unreleased and 0.1.0 headings', () => {
  const changelog = read('CHANGELOG.md');
  assert.ok(changelog.includes('## [Unreleased]'));
  assert.ok(changelog.includes('## [0.1.0] - 2026-10-23'));
});

test('docs/game-authoring.md documents every ctx member', () => {
  const noop = () => {};
  const ctx = createContext({
    gameId: 'docs-check',
    root: {},
    input: { on: noop, off: noop },
    prefs: { get: () => ({}), onChange: () => noop },
    announce: noop,
    playSound: noop,
    onScore: noop,
    storage: { getItem: () => null, setItem: noop },
  });
  const members = Object.keys(ctx);
  assert.ok(members.length >= 8, 'expected the SDK ctx members');
  const doc = read('docs/game-authoring.md');
  for (const m of members) assert.ok(doc.includes(m), `ctx.${m} is not documented`);
});

test('CODEOWNERS and issue config follow the repository policy', () => {
  assert.match(read('.github/CODEOWNERS'), /^\* @yoonwoojeong$/m);
  assert.match(read('.github/ISSUE_TEMPLATE/config.yml'), /blank_issues_enabled: false/);
});
