import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pluginRoot, parseGlobalFlags, dataDir as resolveDataDir, isMainModule } from './paths.js';
import { resolveSettings } from './settings.js';
import { findRunning, readLock, removeLock, isAlive } from './lifecycle.js';
import { PortRangeBusyError } from './server.js';
import { loadRegistry } from './registry.js';
import { openBrowser } from './open-browser.js';
import { autoOpen } from './auto-open.js';

const START_TIMEOUT_MS = 3000;
const POLL_MS = 100;
const SHUTDOWN_REQUEST_MS = 1000;
const PORT_BUSY_EXIT = 3;
const USAGE = 'Usage: arcade <open [gameId] | start | stop | status | games>';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function checkNode(version) {
  const major = Number(String(version).replace(/^v/, '').split('.')[0]);
  if (major >= 20) return null;
  return `Claude Arcade needs Node.js 20 or newer (found ${version}). Install it from https://nodejs.org — nothing else is required.`;
}

export function spawnServer(dir, env) {
  fs.mkdirSync(dir, { recursive: true });
  const logFd = fs.openSync(path.join(dir, 'arcade.log'), 'a');
  try {
    const child = spawn(
      process.execPath,
      [path.join(pluginRoot, 'server', 'main.js'), '--data-dir', dir],
      { detached: true, windowsHide: true, stdio: ['ignore', logFd, logFd], env },
    );
    child.unref();
    return child;
  } finally {
    fs.closeSync(logFd);
  }
}

const realDeps = () => ({
  openBrowser,
  spawnServer,
  findRunning,
  fetch: globalThis.fetch,
  kill: (pid) => process.kill(pid),
  loadGames: () => loadRegistry(path.join(pluginRoot, 'games')).games,
});

// Only called with a server whose identity findRunning confirmed through /health (name and
// pid match) in this same call: the kill fallback must never reach an unverified PID.
async function shutdownServer({ lock }, dir, deps) {
  try {
    const res = await deps.fetch(`http://127.0.0.1:${lock.port}/api/shutdown`, {
      method: 'POST',
      headers: { 'X-Arcade-Token': lock.token },
      signal: AbortSignal.timeout(SHUTDOWN_REQUEST_MS),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch {
    try {
      deps.kill(lock.pid);
    } catch {
      // already gone
    }
  }
  for (let i = 0; i < 20 && isAlive(lock.pid); i++) await sleep(POLL_MS);
  removeLock(dir, { pid: lock.pid });
}

const startFailure = (dir) =>
  `Claude Arcade server did not start within 3s — see ${path.join(dir, 'arcade.log')}`;

const notResponding = (pid, dir) =>
  `Claude Arcade server (pid ${pid}) is not responding — run /arcade:stop or see ${path.join(dir, 'arcade.log')}`;

// findRunning returned null but may have kept the lock of a live server that did not answer
// /health in time. Retry within the start budget; never start a second server next to it.
async function waitForUnresponsive(dir, deps) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    const lock = readLock(dir);
    if (!lock || !isAlive(lock.pid)) return null;
    if (Date.now() >= deadline) throw new Error(notResponding(lock.pid, dir));
    await sleep(POLL_MS);
    const found = await deps.findRunning(dir);
    if (found) return found;
  }
}

export async function ensureServer({ dir, env, deps = {} }) {
  deps = { ...realDeps(), ...deps };
  const existing = (await deps.findRunning(dir)) ?? (await waitForUnresponsive(dir, deps));
  if (existing) {
    if (path.resolve(existing.health.rootDir ?? '') === path.resolve(pluginRoot)) {
      return existing.lock;
    }
    await shutdownServer(existing, dir, deps);
    const stopDeadline = Date.now() + START_TIMEOUT_MS;
    while (await deps.findRunning(dir)) {
      if (Date.now() > stopDeadline) throw new Error(startFailure(dir));
      await sleep(POLL_MS);
    }
  }
  const child = deps.spawnServer(dir, env);
  let exitCode = null;
  child.on?.('exit', (code) => {
    exitCode = code ?? -1;
  });
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const found = await deps.findRunning(dir);
    if (found) return found.lock;
    if (exitCode === PORT_BUSY_EXIT) {
      const { port } = resolveSettings({ dataDir: dir, env });
      throw new PortRangeBusyError(port, port + 9);
    }
    if (exitCode !== null) throw new Error(startFailure(dir));
    await sleep(POLL_MS);
  }
  throw new Error(startFailure(dir));
}

export async function main(
  argv,
  io = { env: process.env, out: (s) => console.log(s), err: (s) => console.error(s) },
  deps = {},
) {
  deps = { ...realDeps(), ...deps };
  const nodeMsg = checkNode(process.versions.node);
  if (nodeMsg) {
    io.err(nodeMsg);
    return 1;
  }
  const { flags, rest } = parseGlobalFlags(argv);
  const [command, ...args] = rest;
  const dir = resolveDataDir({ flag: flags.dataDir, env: io.env });
  // The server takes /plugin options only from plugin-options.json (written by the hooks), so
  // values inherited from whoever spawned this CLI cannot go stale inside a long-lived server.
  // Explicit flags still apply.
  const env = { CLAUDE_PLUGIN_DATA: dir };
  for (const [key, value] of Object.entries(io.env ?? {})) {
    if (!key.startsWith('CLAUDE_PLUGIN_OPTION_') && key !== 'CLAUDE_PLUGIN_DATA') env[key] = value;
  }
  if (flags.mode) env.CLAUDE_PLUGIN_OPTION_MODE = flags.mode;
  if (flags.port) env.CLAUDE_PLUGIN_OPTION_PORT = flags.port;
  if (flags.autoOpenDelay) env.CLAUDE_PLUGIN_OPTION_AUTOOPENDELAY = flags.autoOpenDelay;

  const commands = {
    open: () => cmdOpen(args[0]),
    start: async () => {
      io.out(`Claude Arcade is running at ${urlOf(await ensureServer({ dir, env, deps }))}`);
      return 0;
    },
    'auto-open': cmdAutoOpen,
    stop: cmdStop,
    status: cmdStatus,
    games: async () => {
      for (const g of deps.loadGames()) {
        io.out(`${g.id} — ${g.title} (screen reader: ${g.accessibility.screenReader})`);
      }
      return 0;
    },
  };
  const urlOf = (lock) => `http://127.0.0.1:${lock.port}/`;

  async function cmdOpen(gameId) {
    const lock = await ensureServer({ dir, env, deps });
    let url = urlOf(lock);
    if (gameId) {
      const games = deps.loadGames();
      if (games.some((g) => g.id === gameId)) url += `#${gameId}`;
      else io.out(`Unknown game "${gameId}". Available: ${games.map((g) => g.id).join(', ')}`);
    }
    io.out(`Claude Arcade is running at ${url}`);
    if (!(await deps.openBrowser(url))) {
      io.out("Couldn't open a browser automatically — open the URL above.");
    }
    return 0;
  }

  async function cmdAutoOpen() {
    try {
      const [sessionId, delay] = args;
      if (!sessionId || !/^\d+$/.test(delay ?? '')) return 0;
      await autoOpen({
        sessionId,
        delaySec: Number(delay),
        dir,
        env,
        deps: {
          sleep: deps.sleep ?? sleep,
          ensureServer: deps.ensureServer ?? ((a) => ensureServer({ ...a, deps })),
          openBrowser: deps.openBrowser,
          fetchHealth: deps.fetchHealth ?? (async (d) => (await deps.findRunning(d))?.health),
        },
      });
    } catch {
      // auto-open runs detached and must stay silent
    }
    return 0;
  }

  async function cmdStop() {
    const running = await deps.findRunning(dir);
    if (!running) {
      // a live PID that timed out on /health keeps its lock but is unverified: never signal it
      const lock = readLock(dir);
      if (lock && isAlive(lock.pid)) {
        io.err(
          `Claude Arcade (pid ${lock.pid}) is not responding and could not be verified; it was not stopped. If it is the arcade, end it manually, then run /arcade:stop again.`,
        );
        return 1;
      }
      io.out('Claude Arcade is not running.');
      return 0;
    }
    await shutdownServer(running, dir, deps);
    io.out('Claude Arcade stopped.');
    return 0;
  }

  async function cmdStatus() {
    const running = await deps.findRunning(dir);
    if (!running) {
      io.out('Claude Arcade is not running.');
      return 0;
    }
    const { mode } = resolveSettings({ dataDir: dir, env });
    io.out(
      `Claude Arcade is running at ${urlOf(running.lock)} (mode: ${mode}, ${running.health.clients} tab(s) open).`,
    );
    return 0;
  }

  const run = commands[command];
  if (!Object.hasOwn(commands, command)) {
    io.err(USAGE);
    return 2;
  }
  try {
    return await run();
  } catch (err) {
    if (err instanceof PortRangeBusyError) {
      io.err(
        `Ports ${err.from}–${err.to} are all in use. Change the "port" option for the arcade plugin in /plugin.`,
      );
      return 1;
    }
    io.err(err.message);
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
