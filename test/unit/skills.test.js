import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function load(name) {
  const text = fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  assert.ok(m, `${name} has frontmatter`);
  return { front: m[1], body: m[2] };
}

for (const [name, command] of [
  ['play', 'open'],
  ['stop', 'stop'],
  ['games', 'games'],
]) {
  test(`skill ${name} runs cli.js ${command} and is user-invoked only`, () => {
    const { front, body } = load(name);
    assert.match(front, /^description: .+/m);
    assert.match(front, /^disable-model-invocation: true$/m);
    assert.match(front, /^allowed-tools: Bash\(node:\*\)$/m);
    assert.ok(body.includes(`server/cli.js" ${command}`), 'runs the cli command');
    assert.ok(body.includes('--data-dir'), 'passes --data-dir');
    assert.ok(body.includes('https://nodejs.org'), 'has the Node.js hint');
  });
}

test('play skill takes a game id and does not use user_config placeholders', () => {
  const { front, body } = load('play');
  assert.match(front, /^argument-hint: "\[game-id\]"$/m);
  assert.ok(body.includes('$ARGUMENTS'));
  // Claude Code leaves ${user_config.*} unexpanded in skill content (verified on 2.1.309).
  assert.ok(!body.includes('${user_config'));
});
