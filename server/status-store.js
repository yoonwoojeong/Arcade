import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomicSync } from './fs-atomic.js';

export const STATUS_FILE = 'status.json';

const PRUNE_MS = 24 * 60 * 60 * 1000;

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

export function writeStatusAtomic(dir, status) {
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(path.join(dir, STATUS_FILE), JSON.stringify(status, null, 2) + '\n');
}

export function updateStatus(dir, fn) {
  const next = fn(readStatus(dir));
  writeStatusAtomic(dir, next);
  return next;
}
