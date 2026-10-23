import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function checkRelease({ pluginJson, changelog, tag }) {
  const errors = [];
  const version = pluginJson.version;
  if (tag !== `v${version}`) {
    errors.push(`Tag "${tag}" does not match plugin version: expected "v${version}".`);
  }
  const match = /^##\s+\[(\d+\.\d+\.\d+[^\]]*)\]/m.exec(changelog);
  if (!match) {
    errors.push('CHANGELOG.md has no versioned "## [x.y.z]" heading.');
  } else if (match[1] !== version) {
    errors.push(`CHANGELOG.md top version is ${match[1]}, expected ${version}.`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const tag = process.argv[2] ?? '';
  const pluginJson = JSON.parse(
    fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'),
  );
  let changelog = '';
  try {
    changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  } catch {
    // reported below as a missing versioned heading
  }
  const errors = checkRelease({ pluginJson, changelog, tag });
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(errors.length ? 1 : 0);
}
