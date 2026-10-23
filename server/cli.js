import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pluginRoot, parseGlobalFlags, dataDir as resolveDataDir } from './paths.js';
import { resolveSettings } from './settings.js';
import { findRunning, removeLock, isAlive } from './lifecycle.js';
import { PortRangeBusyError } from './server.js';
import { loadRegistry } from './registry.js';
import { openBrowser } from './open-browser.js';

const START_TIMEOUT_MS = 3000;
const POLL_MS = 100;
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
  loadGames: () => loadRegistry(path.join(pluginRoot, 'games')).games,
});

async function shutdownServer({ lock }, dir, deps) {
  try {
    const res = await deps.fetch(`http://127.0.0.1:${lock.port}/api/shutdown`, {
      method: 'POST',
      headers: { 'X-Arcade-Token': lock.token },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch {
    try {
      process.kill(lock.pid);
    } catch {
      // already gone
    }
  }
  for (let i = 0; i < 20 && isAlive(lock.pid); i++) await sleep(POLL_MS);
  removeLock(dir, { pid: lock.pid });
}

export async function ensureServer({ dir, env, deps = {} }) {
  deps = { ...realDeps(), ...deps };
  const existing = await deps.findRunning(dir);
  if (existing) {
    if (path.resolve(existing.health.rootDir ?? '') === path.resolve(pluginRoot)) {
      return existing.lock;
    }
    await shutdownServer(existing, dir, deps);
    while (await deps.findRunning(dir)) await sleep(POLL_MS);
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
    await sleep(POLL_MS);
  }
  throw new Error(
    `Claude Arcade server did not start within 3s — see ${path.join(dir, 'arcade.log')}`,
  );
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
  const env = { ...io.env, CLAUDE_PLUGIN_DATA: dir };
  if (flags.mode) env.CLAUDE_PLUGIN_OPTION_MODE = flags.mode;
  if (flags.port) env.CLAUDE_PLUGIN_OPTION_PORT = flags.port;
  if (flags.autoOpenDelay) env.CLAUDE_PLUGIN_OPTION_AUTOOPENDELAY = flags.autoOpenDelay;

  const commands = {
    open: () => cmdOpen(args[0]),
    start: async () => {
      io.out(`Claude Arcade is running at ${urlOf(await ensureServer({ dir, env, deps }))}`);
      return 0;
    },
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

  async function cmdStop() {
    const running = await deps.findRunning(dir);
    if (!running) {
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
