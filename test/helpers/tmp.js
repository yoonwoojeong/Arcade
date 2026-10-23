import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-'));
}
