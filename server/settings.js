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

function readFileSettings(dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(dataDir), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveSettings({ dataDir, env }) {
  const file = readFileSettings(dataDir);
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const candidates = [file[key], env?.[ENV_KEYS[key]]];
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
