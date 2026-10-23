// Atomic file replacement (write a tmp file, rename it over the target).
// On Windows a rename over a file that another process is reading or renaming at the same
// moment fails transiently with EPERM/EBUSY/EACCES, so retry it with backoff and jitter.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const TOTAL_MS = 1000;
const BASE_MS = 5;
const MAX_DELAY_MS = 100;

// Blocks the thread without spinning the CPU. Synchronous on purpose: hooks run as short
// synchronous scripts.
export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function renameWithRetry(
  from,
  to,
  {
    rename = fs.renameSync,
    sleep = sleepSync,
    platform = process.platform,
    random = Math.random,
    totalMs = TOTAL_MS,
  } = {},
) {
  let slept = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      if (platform !== 'win32' || !TRANSIENT.has(err.code)) throw err;
      const remaining = totalMs - slept;
      if (remaining <= 0) throw err;
      const ceiling = Math.min(MAX_DELAY_MS, BASE_MS * 2 ** attempt);
      // "Equal jitter": half fixed, half random, so concurrent writers spread out.
      const delay = Math.min(
        remaining,
        Math.max(1, Math.round(ceiling / 2 + random() * (ceiling / 2))),
      );
      sleep(delay);
      slept += delay;
    }
  }
}

// Writes `content` to `file` atomically. Removes its tmp file and rethrows on failure.
// The directory must exist. `options` are passed to renameWithRetry (tests inject fakes).
export function writeFileAtomicSync(file, content, options) {
  const rand = crypto.randomBytes(6).toString('hex');
  const tmpFile = path.join(
    path.dirname(file),
    `${path.basename(file)}.${process.pid}.${rand}.tmp`,
  );
  try {
    fs.writeFileSync(tmpFile, content);
    renameWithRetry(tmpFile, file, options);
  } catch (err) {
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {
      // best effort
    }
    throw err;
  }
}
