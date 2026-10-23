import http from 'node:http';
import fs from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { tmp } from '../helpers/tmp.js';
import { createArcadeServer } from '../../server/server.js';
import { pluginRoot } from '../../server/paths.js';
import { writeStatusAtomic } from '../../server/status-store.js';

async function freePort() {
  const s = http.createServer();
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  const { port } = s.address();
  await new Promise((resolve) => s.close(resolve));
  return port;
}

export const test = base.extend({
  dataDir: async ({}, use) => {
    const dir = tmp();
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },
  server: async ({ dataDir }, use) => {
    const server = await createArcadeServer({
      rootDir: pluginRoot,
      dataDir,
      port: await freePort(),
      token: 'e2e-token',
      env: {},
    });
    await use(server);
    await server.close();
  },
  baseURL: async ({ server }, use) => {
    await use(`http://127.0.0.1:${server.port}`);
  },
  setStatus: async ({ dataDir }, use) => {
    await use((sessions) => {
      const now = new Date().toISOString();
      const filled = {};
      for (const [id, s] of Object.entries(sessions)) {
        filled[id] = { since: now, updatedAt: now, ...s };
      }
      writeStatusAtomic(dataDir, { version: 1, updatedAt: now, sessions: filled });
    });
  },
});

export { expect };
