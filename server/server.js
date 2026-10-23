import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveSettings, writeSettings } from './settings.js';
import { loadRegistry } from './registry.js';
import { pluginRoot } from './paths.js';
import {
  isAllowedHost,
  isAllowedOrigin,
  safeResolve,
  contentType,
  SECURITY_HEADERS,
} from './http-util.js';

const MAX_BODY_BYTES = 4096;
const PORT_SPAN = 9;

export class PortRangeBusyError extends Error {
  constructor(from, to) {
    super(`Ports ${from}-${to} are all in use`);
    this.name = 'PortRangeBusyError';
    this.from = from;
    this.to = to;
  }
}

function pluginVersion() {
  try {
    const manifest = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
    return JSON.parse(fs.readFileSync(manifest, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function tokenMatches(actual, expected) {
  if (typeof actual !== 'string') return false;
  const a = crypto.createHash('sha256').update(actual).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function send(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...extraHeaders });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8' });
}

function sendText(res, status, text) {
  send(res, status, text, { 'Content-Type': 'text/plain; charset=utf-8' });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) tooBig = true;
      else chunks.push(chunk);
    });
    req.on('end', () => (tooBig ? resolve(null) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

export async function createArcadeServer({
  rootDir,
  dataDir,
  port,
  token,
  env = process.env,
  // idleTimeoutMs is accepted for the Task 8 idle timer; not used yet.
  // eslint-disable-next-line no-unused-vars
  idleTimeoutMs = 1_800_000,
  onShutdown = () => {},
}) {
  const webDir = path.join(rootDir, 'web');
  const gamesDir = path.join(rootDir, 'games');
  const version = pluginVersion();
  const loggedWarnings = new Set();
  let boundPort = port;
  let server;

  const logWarnings = (warnings) => {
    const fresh = warnings.filter((w) => !loggedWarnings.has(w));
    if (!fresh.length) return;
    for (const w of fresh) loggedWarnings.add(w);
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const lines = fresh.map((w) => `${new Date().toISOString()} server ${w}\n`).join('');
      fs.appendFileSync(path.join(dataDir, 'arcade.log'), lines);
    } catch {
      // logging is best effort
    }
  };

  const serveFile = (res, baseDir, rel) => {
    const file = safeResolve(baseDir, rel);
    if (file === null) return sendText(res, 400, 'Bad request');
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return sendText(res, 404, 'Not found');
    }
    if (!stat.isFile()) return sendText(res, 404, 'Not found');
    let data;
    try {
      data = fs.readFileSync(file);
    } catch {
      return sendText(res, 404, 'Not found');
    }
    return send(res, 200, data, { 'Content-Type': contentType(file) });
  };

  // Exact-path routes: path -> { METHOD: handler(req, res) }. Task 8 adds /events here.
  const routes = {
    '/': { GET: (req, res) => serveFile(res, webDir, '/index.html') },
    '/api/games': {
      GET: (req, res) => {
        const { games, warnings } = loadRegistry(gamesDir);
        logWarnings(warnings);
        sendJson(res, 200, games);
      },
    },
    '/api/settings': {
      GET: (req, res) => sendJson(res, 200, resolveSettings({ dataDir, env })),
      POST: async (req, res) => {
        if (!isAllowedOrigin(req.headers.origin, boundPort)) {
          return sendJson(res, 403, { errors: ['forbidden origin'] });
        }
        if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
          return sendJson(res, 415, { errors: ['Content-Type must be application/json'] });
        }
        const raw = await readBody(req, MAX_BODY_BYTES);
        if (raw === null) return sendJson(res, 413, { errors: ['body too large'] });
        let patch;
        try {
          patch = JSON.parse(raw);
        } catch {
          return sendJson(res, 400, { errors: ['body must be valid JSON'] });
        }
        if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
          return sendJson(res, 400, { errors: ['body must be a JSON object'] });
        }
        const result = writeSettings(dataDir, patch);
        if (!result.ok) return sendJson(res, 400, { errors: result.errors });
        return sendJson(res, 200, resolveSettings({ dataDir, env }));
      },
    },
    '/api/shutdown': {
      POST: (req, res) => {
        if (!tokenMatches(req.headers['x-arcade-token'], token)) {
          return sendJson(res, 403, { error: 'forbidden' });
        }
        const origin = req.headers.origin;
        if (origin !== undefined && !isAllowedOrigin(origin, boundPort)) {
          return sendJson(res, 403, { error: 'forbidden origin' });
        }
        res.on('finish', () => {
          close().finally(() => onShutdown());
        });
        return sendJson(res, 200, { ok: true });
      },
    },
    '/health': {
      GET: (req, res) =>
        sendJson(res, 200, {
          ok: true,
          name: 'claude-arcade',
          version,
          pid: process.pid,
          rootDir,
          clients: 0,
        }),
    },
  };

  const prefixes = [
    ['/web/', webDir],
    ['/games/', gamesDir],
  ];

  async function handle(req, res) {
    if (!isAllowedHost(req.headers.host, boundPort)) return sendText(res, 403, 'Forbidden');
    const urlPath = (req.url ?? '').split('?')[0].split('#')[0];
    if (!urlPath.startsWith('/')) return sendText(res, 400, 'Bad request');

    const route = Object.hasOwn(routes, urlPath) ? routes[urlPath] : undefined;
    if (route) {
      const fn = route[req.method];
      if (!fn) return sendText(res, 405, 'Method not allowed');
      return fn(req, res);
    }
    for (const [prefix, base] of prefixes) {
      if (urlPath.startsWith(prefix)) {
        if (req.method !== 'GET') return sendText(res, 405, 'Method not allowed');
        return serveFile(res, base, urlPath.slice(prefix.length - 1));
      }
    }
    return sendText(res, 404, 'Not found');
  }

  const listen = (candidate) =>
    new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        Promise.resolve(handle(req, res)).catch(() => {
          if (!res.headersSent) sendText(res, 500, 'Internal error');
          else res.end();
        });
      });
      s.once('error', reject);
      s.listen(candidate, '127.0.0.1', () => {
        s.removeListener('error', reject);
        resolve(s);
      });
    });

  for (let candidate = port; candidate <= port + PORT_SPAN; candidate++) {
    boundPort = candidate;
    try {
      server = await listen(candidate);
      break;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  if (!server) throw new PortRangeBusyError(port, port + PORT_SPAN);

  let closing = null;
  function close() {
    if (!closing) {
      closing = new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    }
    return closing;
  }

  return { port: boundPort, close, clientCount: () => 0 };
}
