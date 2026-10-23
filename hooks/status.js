import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dataDir, pluginRoot, isMainModule } from '../server/paths.js';
import { resolveSettings, writePluginOptions } from '../server/settings.js';
import { applyEvent, updateStatus } from '../server/status-store.js';

const STATES = ['working', 'needs-you', 'done', 'end'];

function logError(dir, now, message) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const line = `${now.toISOString()} status.js ${String(message).replace(/\s*\n\s*/g, ' ')}\n`;
    fs.appendFileSync(path.join(dir, 'arcade.log'), line);
  } catch {
    // logging must never affect Claude's turn
  }
}

export function run({ state, stdinText, env, now, spawnAutoOpen }) {
  let dir;
  try {
    dir = dataDir({ env });
    if (!STATES.includes(state)) {
      logError(dir, now, `unknown state: ${state}`);
      return;
    }
    let input = {};
    try {
      const parsed = JSON.parse(stdinText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
    } catch {
      // malformed stdin: fall back to {}
    }
    const sessionId = input.session_id || 'unknown';
    const cwd = typeof input.cwd === 'string' ? input.cwd : undefined;
    writePluginOptions(dir, env);
    updateStatus(dir, (status) => applyEvent(status, { state, sessionId, cwd, now }));
    if (state === 'working') {
      const { mode, autoOpenDelay } = resolveSettings({ dataDir: dir, env });
      if (mode === 'auto') spawnAutoOpen(sessionId, autoOpenDelay);
    }
  } catch (err) {
    logError(dir ?? '', now, err?.message ?? err);
  }
}

if (isMainModule(import.meta.url)) {
  try {
    let stdinText = '';
    try {
      stdinText = fs.readFileSync(0, 'utf8');
    } catch {
      // no stdin
    }
    const env = process.env;
    run({
      state: process.argv[2],
      stdinText,
      env,
      now: new Date(),
      spawnAutoOpen: (sessionId, delay) => {
        spawn(
          process.execPath,
          [
            path.join(pluginRoot, 'server', 'cli.js'),
            'auto-open',
            sessionId,
            String(delay),
            '--data-dir',
            dataDir({ env }),
          ],
          { detached: true, stdio: 'ignore', windowsHide: true },
        ).unref();
      },
    });
  } catch {
    // never fail
  }
  process.exit(0);
}
