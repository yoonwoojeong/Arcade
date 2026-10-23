import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function missingSignoff(commits) {
  return commits
    .filter(({ message, authorEmail }) => {
      const email = authorEmail.trim().toLowerCase();
      return !message.split(/\r?\n/).some((line) => {
        const m = /^Signed-off-by:\s+.+?\s+<([^>]+)>\s*$/i.exec(line);
        return m !== null && m[1].trim().toLowerCase() === email;
      });
    })
    .map(({ sha }) => sha);
}

function readCommits(base, head) {
  const result = spawnSync('git', ['log', '--format=%H%x00%ae%x00%B%x1e', `${base}..${head}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git log failed (${result.status})`);
  }
  return result.stdout
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [sha, authorEmail, ...rest] = record.split('\0');
      return { sha, authorEmail, message: rest.join('\0') };
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error('usage: node scripts/check-dco.js <base> <head>');
    process.exit(2);
  }
  const missing = missingSignoff(readCommits(base, head));
  for (const sha of missing)
    console.error(`error: commit ${sha} lacks a matching Signed-off-by line`);
  process.exit(missing.length ? 1 : 0);
}
