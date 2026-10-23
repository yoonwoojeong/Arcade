import fs from 'node:fs';
import { spawn } from 'node:child_process';

const SETTLE_MS = 250;

export function detectEnv() {
  const platform = process.platform;
  let isWsl = false;
  if (platform === 'linux') {
    try {
      isWsl = /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
    } catch {
      // not readable: assume not WSL
    }
  }
  const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  return { platform, isWsl, hasDisplay };
}

export function browserCommands(url, { platform, isWsl, hasDisplay }) {
  if (platform === 'darwin') return [['open', [url]]];
  if (platform === 'win32') return [['cmd', ['/c', 'start', '""', url]]];
  if (isWsl) {
    return [
      ['wslview', [url]],
      ['cmd.exe', ['/c', 'start', '""', url]],
    ];
  }
  if (platform === 'linux' && hasDisplay) return [['xdg-open', [url]]];
  return [];
}

const isCmd = (cmd) => cmd === 'cmd' || cmd === 'cmd.exe';

function tryCommand(spawnFn, [cmd, args]) {
  return new Promise((resolve) => {
    let child;
    let timer = null;
    let spawned = false;
    const done = (ok) => {
      clearTimeout(timer);
      resolve(ok);
    };
    try {
      const options = { detached: true, stdio: 'ignore', windowsHide: true };
      // cmd parses its own command line: keep the literal "" title argument intact
      if (isCmd(cmd)) options.windowsVerbatimArguments = true;
      child = spawnFn(cmd, args, options);
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => done(false));
    child.on('spawn', () => {
      spawned = true;
      child.unref?.();
      timer = setTimeout(() => done(true), SETTLE_MS);
    });
    // a child that never reports either event should not hang the caller
    setTimeout(() => {
      if (!spawned) done(false);
    }, SETTLE_MS * 4).unref?.();
  });
}

export async function openBrowser(url, env = detectEnv(), spawnFn = spawn) {
  // cmd metacharacters would be unsafe unquoted; our URLs never contain them
  if (/[&^|<>"%\s]/.test(url)) return false;
  for (const candidate of browserCommands(url, env)) {
    if (await tryCommand(spawnFn, candidate)) return true;
  }
  return false;
}
