import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  isAllowedHost,
  isAllowedOrigin,
  safeResolve,
  contentType,
  SECURITY_HEADERS,
} from '../../server/http-util.js';

test('host and origin checks are exact', () => {
  assert.ok(isAllowedHost('127.0.0.1:4417', 4417));
  assert.ok(isAllowedHost('localhost:4417', 4417));
  assert.ok(!isAllowedHost('evil.com:4417', 4417));
  assert.ok(!isAllowedHost('127.0.0.1:4418', 4417));
  assert.ok(!isAllowedHost(undefined, 4417));
  assert.ok(isAllowedOrigin('http://127.0.0.1:4417', 4417));
  assert.ok(isAllowedOrigin('http://localhost:4417', 4417));
  assert.ok(!isAllowedOrigin(undefined, 4417));
  assert.ok(!isAllowedOrigin('http://127.0.0.1.evil.com:4417', 4417));
  assert.ok(!isAllowedOrigin('https://127.0.0.1:4417', 4417));
});

test('safeResolve blocks traversal, encoded traversal and NUL', () => {
  assert.equal(safeResolve('/base', '/../etc/passwd'), null);
  assert.equal(safeResolve('/base', '/%2e%2e/%2e%2e/etc/passwd'), null);
  assert.equal(safeResolve('/base', '/a%00b'), null);
  assert.equal(safeResolve('/base', '/%E0%A4%A'), null);
  assert.equal(safeResolve('/base', '/ok/file.js'), path.resolve('/base/ok/file.js'));
});

test('safeResolve rejects a sibling directory sharing the base prefix', () => {
  assert.equal(safeResolve('/base', '/../base-evil/x'), null);
});

test('contentType maps known extensions and defaults', () => {
  assert.equal(contentType('a.html'), 'text/html; charset=utf-8');
  assert.equal(contentType('a.JS'), 'text/javascript; charset=utf-8');
  assert.equal(contentType('a.css'), 'text/css; charset=utf-8');
  assert.equal(contentType('a.json'), 'application/json; charset=utf-8');
  assert.equal(contentType('a.svg'), 'image/svg+xml; charset=utf-8');
  assert.equal(contentType('a.png'), 'image/png');
  assert.equal(contentType('a.webp'), 'image/webp');
  assert.equal(contentType('a.ogg'), 'audio/ogg');
  assert.equal(contentType('a.mp3'), 'audio/mpeg');
  assert.equal(contentType('a.woff2'), 'font/woff2');
  assert.equal(contentType('a.bin'), 'application/octet-stream');
});

test('SECURITY_HEADERS carry the spec values', () => {
  assert.equal(
    SECURITY_HEADERS['Content-Security-Policy'],
    "default-src 'self'; img-src 'self' data:; media-src 'self' data:",
  );
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(SECURITY_HEADERS['Referrer-Policy'], 'no-referrer');
  assert.equal(SECURITY_HEADERS['Cache-Control'], 'no-store');
});
