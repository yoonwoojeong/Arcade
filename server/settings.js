import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = Object.freeze({ mode: 'alert', port: 4417, autoOpenDelay: 20 });

const MODES = ['alert', 'auto', 'quiet'];
const RANGES = { port: [1024, 65535], autoOpenDelay: [5, 600] };
const ENV_KEYS = {
  mode: 'CLAUDE_PLUGIN_OPTION_MODE',
  port: 'CLAUDE_PLUGIN_OPTION_PORT',
  autoOpenDelay: 'CLAUDE_PLUGIN_OPTION_AUTOOPENDELAY',
};
const WRITABLE = ['mode', 'autoOpenDelay'];

export function validateSetting(key, value) {
  if (key === 'mode') {
    return MODES.includes(value)
      ? { ok: true, value }
      : { ok: false, error: `mode must be one of: ${MODES.join(', ')}` };
  }
  const range = RANGES[key];
  if (!range) return { ok: false, error: `unknown setting: ${key}` };
  const [min, max] = range;
  let n = NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { ok: false, error: `${key} must be an integer between ${min} and ${max}` };
  }
  return { ok: true, value: n };
}

function settingsFile(dataDir) {
  return path.join(dataDir, 'settings.json');
}

function pluginOptionsFile(dataDir) {
  return path.join(dataDir, 'plugin-options.json');
}

function readJsonObject(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readFileSettings(dataDir) {
  return readJsonObject(settingsFile(dataDir));
}

export function resolveSettings({ dataDir, env }) {
  const file = readFileSettings(dataDir);
  const persisted = readJsonObject(pluginOptionsFile(dataDir));
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const candidates = [file[key], env?.[ENV_KEYS[key]], persisted[key]];
    let resolved = DEFAULTS[key];
    for (const c of candidates) {
      if (c === undefined) continue;
      const r = validateSetting(key, c);
      if (r.ok) {
        resolved = r.value;
        break;
      }
    }
    out[key] = resolved;
  }
  return out;
}

export function writeSettings(dataDir, patch) {
  const errors = [];
  const validated = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!WRITABLE.includes(key)) {
      errors.push(`unknown or read-only setting: ${key}`);
      continue;
    }
    const r = validateSetting(key, value);
    if (r.ok) validated[key] = r.value;
    else errors.push(r.error);
  }
  if (errors.length) return { ok: false, errors };

  const existing = readFileSettings(dataDir);
  const settings = { ...existing, ...validated };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmpFile = path.join(dataDir, `settings.json.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmpFile, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tmpFile, settingsFile(dataDir));
  } catch (err) {
    return { ok: false, errors: [`could not write settings: ${err.message}`] };
  }
  return { ok: true, settings };
}

// Hooks receive CLAUDE_PLUGIN_OPTION_*; skill-started servers do not. Persist the valid
// ones so the server (and page) agree with the hooks. Never throws.
export function writePluginOptions(dataDir, env) {
  try {
    const options = {};
    for (const key of Object.keys(ENV_KEYS)) {
      const raw = env?.[ENV_KEYS[key]];
      if (raw === undefined) continue;
      const r = validateSetting(key, raw);
      if (r.ok) options[key] = r.value;
    }
    if (Object.keys(options).length === 0) return;
    const file = pluginOptionsFile(dataDir);
    const content = JSON.stringify(options, null, 2) + '\n';
    try {
      if (fs.readFileSync(file, 'utf8') === content) return;
    } catch {
      // missing or unreadable: write it
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const tmpFile = path.join(dataDir, `plugin-options.json.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmpFile, content);
    fs.renameSync(tmpFile, file);
  } catch {
    // best effort
  }
}
