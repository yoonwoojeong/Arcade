import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const STATUS_FILE = 'status.json';

const PRUNE_MS = 24 * 60 * 60 * 1000;
const RENAME_RETRIES = 5;
const RENAME_RETRY_MS = 10;

export function emptyStatus() {
  return { version: 1, updatedAt: null, sessions: {} };
}

export function projectName(cwd) {
  if (!cwd) return '';
  return cwd.includes('\\') ? path.win32.basename(cwd) : path.posix.basename(cwd);
}

export function applyEvent(status, { state, sessionId, cwd, now }) {
  const iso = now.toISOString();
  const sessions = { ...status.sessions };

  if (state === 'end') {
    delete sessions[sessionId];
  } else {
    const prev = sessions[sessionId];
    const next = {
      state,
      project: cwd ? projectName(cwd) : (prev?.project ?? ''),
      since: prev && prev.state === state ? prev.since : iso,
      updatedAt: iso,
    };
    if (prev?.autoOpened) next.autoOpened = true;
    sessions[sessionId] = next;
  }

  for (const [id, s] of Object.entries(sessions)) {
    if (now.getTime() - Date.parse(s.updatedAt) > PRUNE_MS) delete sessions[id];
  }

  return { version: 1, updatedAt: iso, sessions };
}

export function markAutoOpened(status, sessionId) {
  const s = status.sessions[sessionId];
  if (!s) return status;
  return { ...status, sessions: { ...status.sessions, [sessionId]: { ...s, autoOpened: true } } };
}

export function readStatus(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, STATUS_FILE), 'utf8'));
    if (parsed && parsed.version === 1 && parsed.sessions && typeof parsed.sessions === 'object') {
      return parsed;
    }
  } catch {
    // missing or unparsable: fall through
  }
  return emptyStatus();
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function writeStatusAtomic(dir, status) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, STATUS_FILE);
  const rand = crypto.randomBytes(6).toString('hex');
  const tmpFile = path.join(dir, `${STATUS_FILE}.${process.pid}.${rand}.tmp`);
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(status, null, 2) + '\n');
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmpFile, target);
        return;
      } catch (err) {
        const transient = process.platform === 'win32' && ['EPERM', 'EBUSY'].includes(err.code);
        if (!transient || attempt >= RENAME_RETRIES - 1) throw err;
        sleepSync(RENAME_RETRY_MS);
      }
    }
  } catch (err) {
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {
      // best effort
    }
    throw err;
  }
}

export function updateStatus(dir, fn) {
  const next = fn(readStatus(dir));
  writeStatusAtomic(dir, next);
  return next;
}
