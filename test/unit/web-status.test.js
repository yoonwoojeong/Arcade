import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../../web/status-summary.js';
import { reactionFor } from '../../web/modes.js';

const now = new Date('2026-10-23T10:00:00Z');
const st = (sessions) => ({ version: 1, updatedAt: now.toISOString(), sessions });
const s = (state, project, mins = 1) => ({
  state,
  project,
  since: new Date(now - mins * 60e3).toISOString(),
  updatedAt: new Date(now - mins * 60e3).toISOString(),
});
const opts = { showProject: true, now };

test('needs-you beats done beats working', () => {
  const r = summarize(
    st({ a: s('working', 'x'), b: s('done', 'y'), c: s('needs-you', 'z') }),
    opts,
  );
  assert.equal(r.state, 'needs-you');
  assert.equal(r.badge, 'z needs you');
  assert.equal(r.banner, 'Claude needs you in z');
});

test('multiple and project-hidden phrasing', () => {
  assert.equal(
    summarize(st({ a: s('done', 'x'), b: s('done', 'y') }), opts).badge,
    '2 sessions finished',
  );
  assert.equal(
    summarize(st({ a: s('done', 'x') }), { showProject: false, now }).banner,
    'Claude finished',
  );
  const two = summarize(st({ a: s('needs-you', 'x'), b: s('needs-you', 'y') }), opts);
  assert.equal(two.badge, '2 sessions need you');
  assert.equal(two.banner, two.badge);
  assert.equal(summarize(st({ a: s('needs-you', '') }), opts).badge, 'Claude needs you');
  assert.equal(summarize(st({ a: s('done', 'x') }), opts).badge, 'Claude finished in x');
});

test('working, idle and empty', () => {
  const w = summarize(st({ a: s('working', 'x') }), opts);
  assert.deepEqual([w.state, w.badge, w.banner], ['working', 'Claude is working…', null]);
  const i = summarize(st({}), opts);
  assert.deepEqual([i.state, i.badge, i.banner, i.key], ['idle', 'Claude is idle', null, null]);
});

test('stale sessions (>24h) are ignored; null is offline', () => {
  assert.equal(summarize(st({ a: s('needs-you', 'x', 24 * 60 + 1) }), opts).state, 'idle');
  const o = summarize(null, opts);
  assert.equal(o.state, 'offline');
  assert.equal(o.badge, 'Offline — reconnecting…');
  assert.equal(o.banner, null);
});

test('key is sorted sessionId@since of winning sessions and changes with since', () => {
  const a = s('done', 'x', 5);
  const b = s('done', 'y', 3);
  const r = summarize(st({ b, a, c: s('working', 'z') }), opts);
  assert.equal(r.key, [`a@${a.since}`, `b@${b.since}`].join(','));
  const r2 = summarize(st({ a: s('done', 'x', 2) }), opts);
  assert.notEqual(r2.key, summarize(st({ a }), opts).key);
});

test('reactionFor per mode', () => {
  assert.deepEqual(reactionFor('quiet', 'needs-you'), {
    pause: false,
    banner: false,
    chime: false,
    notify: false,
  });
  assert.equal(reactionFor('auto', 'done').pause, true);
  assert.deepEqual(reactionFor('alert', 'needs-you'), {
    pause: true,
    banner: true,
    chime: true,
    notify: true,
  });
  assert.equal(reactionFor('alert', 'working').pause, false);
  assert.equal(reactionFor('alert', 'offline').banner, false);
});
