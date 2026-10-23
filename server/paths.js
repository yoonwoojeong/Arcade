import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FLAG_KEYS = {
  '--data-dir': 'dataDir',
  '--mode': 'mode',
  '--port': 'port',
  '--auto-open-delay': 'autoOpenDelay',
};

function usable(value) {
  return typeof value === 'string' && value !== '' && !value.includes('${');
}

export function parseGlobalFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const key = FLAG_KEYS[argv[i]];
    if (key && i + 1 < argv.length) {
      const value = argv[++i];
      if (usable(value)) flags[key] = value;
    } else {
      rest.push(argv[i]);
    }
  }
  return { flags, rest };
}

export function dataDir({ flag, env = process.env } = {}) {
  for (const candidate of [flag, env.ARCADE_DATA_DIR, env.CLAUDE_PLUGIN_DATA]) {
    if (usable(candidate)) return path.resolve(candidate);
  }
  return path.join(os.homedir(), '.claude', 'arcade');
}

// True when the module at importMetaUrl is the process entry point, even when
// it was started through a symlink or a differently-cased path.
export function isMainModule(importMetaUrl) {
  try {
    const arg = process.argv[1];
    if (!arg) return false;
    if (pathToFileURL(arg).href === importMetaUrl) return true;
    return fs.realpathSync(arg) === fs.realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
