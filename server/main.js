import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pluginRoot, parseGlobalFlags, dataDir as resolveDataDir } from './paths.js';
import { resolveSettings } from './settings.js';
import { writeLock, removeLock } from './lifecycle.js';
import { createArcadeServer, PortRangeBusyError } from './server.js';

export const PORT_BUSY_EXIT = 3;

const { flags } = parseGlobalFlags(process.argv.slice(2));
const dir = resolveDataDir({ flag: flags.dataDir });
const env = { ...process.env, CLAUDE_PLUGIN_DATA: dir };

function log(line) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'arcade.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // logging is best effort
  }
}

function shutdown(reason) {
  log(`stopping (${reason})`);
  removeLock(dir, { pid: process.pid });
  process.exit(0);
}

try {
  const { port } = resolveSettings({ dataDir: dir, env });
  const token = crypto.randomBytes(16).toString('hex');
  const server = await createArcadeServer({
    rootDir: pluginRoot,
    dataDir: dir,
    port,
    token,
    env,
    onShutdown: () => shutdown('shutdown'),
  });
  writeLock(dir, {
    port: server.port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token,
    rootDir: pluginRoot,
  });
  log(`started on 127.0.0.1:${server.port} pid ${process.pid}`);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      server.close().finally(() => shutdown(sig));
    });
  }
} catch (err) {
  if (err instanceof PortRangeBusyError) {
    log(`PORT_RANGE_BUSY ${err.from} ${err.to}`);
    process.exit(PORT_BUSY_EXIT);
  }
  log(`fatal: ${err?.stack ?? err}`);
  process.exit(1);
}
