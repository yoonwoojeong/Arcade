import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { writeFileAtomicSync } from './fs-atomic.js';

export const LOCK_FILE = 'server.lock';

const HEALTH_TIMEOUT_MS = 1000;

// defaultFetchHealth's answer when nothing listens on the port (as opposed to no answer).
export const HEALTH_REFUSED = Object.freeze({ refused: true });
// defaultFetchHealth's answer when something replied on the port but not with arcade health JSON
// (non-200 or a non-JSON body): a definite non-arcade answer, unlike a timeout (null).
export const HEALTH_FOREIGN = Object.freeze({ foreign: true });

export function readLock(dir) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dir, LOCK_FILE), 'utf8'));
    if (
      lock &&
      Number.isInteger(lock.port) &&
      Number.isInteger(lock.pid) &&
      typeof lock.token === 'string'
    ) {
      return lock;
    }
  } catch {
    // missing or unparsable: fall through
  }
  return null;
}

export function writeLock(dir, lock) {
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(path.join(dir, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n');
}

export function removeLock(dir, { pid } = {}) {
  if (pid !== undefined && readLock(dir)?.pid !== pid) return;
  fs.rmSync(path.join(dir, LOCK_FILE), { force: true });
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function defaultFetchHealth(port) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    try {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/health', timeout: HEALTH_TIMEOUT_MS, agent: false },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            done(HEALTH_FOREIGN);
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            try {
              done(JSON.parse(body));
            } catch {
              done(HEALTH_FOREIGN);
            }
          });
          res.on('error', () => done(null));
        },
      );
      req.on('timeout', () => {
        req.destroy();
        done(null);
      });
      req.on('error', (err) => done(err?.code === 'ECONNREFUSED' ? HEALTH_REFUSED : null));
    } catch {
      done(null);
    }
  });
}

// The lock is removed when it is certainly stale: the PID is dead, nothing listens on its
// port, or something definitely not this arcade answers there (non-200, non-JSON, wrong
// name/pid; the PID was probably reused). Only a live PID whose port gives no answer in time
// is unconfirmed: it keeps its lock (findRunning returns null) so callers never start a second
// server, and nobody may signal that PID because its identity was not verified.
export async function findRunning(dir, { fetchHealth = defaultFetchHealth } = {}) {
  const lock = readLock(dir);
  if (!lock) return null;
  if (!isAlive(lock.pid)) {
    removeLock(dir, { pid: lock.pid });
    return null;
  }
  let health = null;
  try {
    health = await fetchHealth(lock.port);
  } catch {
    // no answer
  }
  if (health && typeof health === 'object') {
    if (health.name === 'claude-arcade' && health.pid === lock.pid) return { lock, health };
    removeLock(dir, { pid: lock.pid });
  }
  return null;
}

export function createIdleTimer({ timeoutMs, onIdle }) {
  let clients = 0;
  let stopped = false;
  let timer = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const arm = () => {
    clear();
    if (stopped || clients > 0) return;
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      stopped = true;
      onIdle();
    }, timeoutMs);
    timer.unref?.();
  };

  arm();
  return {
    activity: arm,
    setClients(n) {
      clients = n;
      arm();
    },
    stop() {
      stopped = true;
      clear();
    },
  };
}
