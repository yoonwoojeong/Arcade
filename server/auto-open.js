import { resolveSettings } from './settings.js';
import { readStatus, updateStatus, markAutoOpened } from './status-store.js';

export async function autoOpen({ sessionId, delaySec, dir, env, deps }) {
  await deps.sleep(delaySec * 1000);
  if (resolveSettings({ dataDir: dir, env }).mode !== 'auto') return 'skipped:mode';
  const session = readStatus(dir).sessions[sessionId];
  if (session?.state !== 'working') return 'skipped:not-working';
  if (session.autoOpened) return 'skipped:already-opened';
  const health = await deps.fetchHealth(dir);
  if (health && health.clients !== 0) return 'skipped:tab-open';
  updateStatus(dir, (s) => markAutoOpened(s, sessionId));
  const lock = await deps.ensureServer({ dir, env });
  await deps.openBrowser(`http://127.0.0.1:${lock.port}/`);
  return 'opened';
}
