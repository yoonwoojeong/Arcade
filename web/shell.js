// Claude Arcade shell: wires the menu, game host, status stream, banner and settings.
import { summarize } from './status-summary.js';
import { reactionFor } from './modes.js';
import { createInput } from './input.js';
import { createPrefs } from './prefs.js';
import { createContext } from './sdk.js';
import { createGameHost, resolveGameId } from './game-host.js';
import { createBanner, notify } from './banner.js';
import { createSettingsPanel, applyPrefs } from './settings-panel.js';
import { playChime, playGameSound } from './sound.js';
import { renderMenu, cardFor } from './menu.js';

const CRASH_MESSAGE = 'This game crashed — back to menu';
const RECONNECT_MS = 3000;

const $ = (id) => document.getElementById(id);
const els = {
  badge: $('status-badge'),
  menu: $('menu'),
  menuLoading: $('menu-loading'),
  list: $('game-list'),
  stage: $('stage'),
  stageHeading: $('stage-heading'),
  pausedPanel: $('paused-panel'),
  message: $('shell-message'),
  polite: $('sr-announcer'),
  assertive: $('sr-announcer-assertive'),
};

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const storage = safeStorage();
const prefs = createPrefs({ storage, matchMedia: window.matchMedia.bind(window) });
let settings = { mode: 'alert', autoOpenDelay: 20 };
let games = [];
let lastStatus = null;
let shownKey = null;
let dismissedKey = null;
let current = null; // { id, root, input } of the mounted game
let mountToken = 0;

// ---- announcements ----

const announceTimers = new Map();
function announce(text, { assertive = false } = {}) {
  const el = assertive ? els.assertive : els.polite;
  clearTimeout(announceTimers.get(el));
  el.textContent = '';
  // clear first so repeating the same text is announced again
  announceTimers.set(
    el,
    setTimeout(() => {
      el.textContent = text;
    }, 50),
  );
}

// ---- game host ----

const host = createGameHost({ onCrash: handleCrash });

function sync() {
  document.body.dataset.game = current?.id ?? '';
  document.body.dataset.gameState = host.state;
  current?.input.setEnabled(host.state === 'running');
  els.pausedPanel.hidden = !(host.state === 'paused' && !banner.visible);
  banner.setCanResume(host.state === 'paused');
}

function releaseGame() {
  host.unmount();
  if (current) {
    current.input.destroy();
    current.root.remove();
  }
  current = null;
}

function clearHash() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

function showMenu() {
  els.stage.hidden = true;
  els.menu.hidden = false;
}

function leaveGame() {
  const id = current?.id ?? null;
  mountToken++;
  host.pause();
  releaseGame();
  clearHash();
  showMenu();
  sync();
  if (id) cardFor(els.list, id)?.focus();
}

function handleCrash(id, err) {
  console.error(`[arcade] game "${id}" crashed:`, err);
  mountToken++;
  if (current) {
    current.input.destroy();
    current.root.remove();
    current = null;
  }
  clearHash();
  showMenu();
  els.message.textContent = CRASH_MESSAGE;
  els.message.hidden = false;
  announce(CRASH_MESSAGE, { assertive: true });
  sync();
  if (id) cardFor(els.list, id)?.focus();
}

async function openGame(id) {
  const game = games.find((g) => g.id === id);
  if (!game) return;
  if (current) releaseGame();
  const token = ++mountToken;
  els.message.hidden = true;
  els.stageHeading.textContent = game.title;
  els.menu.hidden = true;
  els.stage.hidden = false;
  sync();

  let mod;
  try {
    // id comes from the registry via resolveGameId, never from raw hash text
    mod = await import(`/games/${id}/index.js`);
  } catch (err) {
    if (token === mountToken) handleCrash(id, err);
    return;
  }
  if (token !== mountToken) return;
  if (typeof mod.default !== 'function') {
    handleCrash(id, new Error('game module has no default export'));
    return;
  }

  const root = document.createElement('div');
  root.className = 'game-root';
  root.tabIndex = 0;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', game.title);
  els.stage.append(root);
  const input = createInput(root);
  current = { id, root, input };
  const ctx = createContext({
    gameId: id,
    root,
    input,
    prefs,
    announce,
    playSound: (name) => playGameSound(id, name),
    onScore: () => {},
    storage,
  });
  host.mount(id, mod.default, ctx);
  sync();
  if (host.state === 'running') root.focus();
}

function route() {
  const id = resolveGameId(
    location.hash,
    games.map((g) => g.id),
  );
  if (id) {
    if (id !== current?.id) openGame(id);
  } else if (current || !els.stage.hidden) {
    leaveGame();
  } else {
    showMenu();
  }
}

// ---- status, banner and alerts ----

function resumeGame() {
  host.resume();
  banner.hide();
  sync();
  if (host.state === 'running') current?.root.focus();
}

const banner = createBanner({
  el: $('banner'),
  onResume: resumeGame,
  onDismiss: () => {
    dismissedKey = shownKey;
    banner.hide();
    sync();
    if (host.state === 'paused') $('paused-resume').focus();
    else (els.list.querySelector('.game-card') ?? $('settings-button')).focus();
  },
});

function hideBanner() {
  if (!banner.visible) return;
  const hadFocus = banner.contains(document.activeElement);
  banner.hide();
  sync();
  if (hadFocus) (host.state === 'paused' ? $('paused-resume') : $('settings-button')).focus();
}

function render() {
  const p = prefs.get();
  const summary = summarize(lastStatus, { showProject: p.showProject, now: new Date() });
  els.badge.dataset.state = summary.state;
  els.badge.textContent = summary.badge;

  if (summary.state === 'working' || summary.state === 'idle') {
    hideBanner();
    return;
  }
  const reaction = reactionFor(settings.mode, summary.state);
  if (!reaction.banner || !summary.key || summary.key === dismissedKey) return;
  if (summary.key === shownKey) {
    if (banner.visible) banner.show(summary); // refresh text only
    return;
  }
  shownKey = summary.key;
  const wasRunning = host.state === 'running';
  if (reaction.pause) host.pause();
  banner.show(summary);
  sync();
  if (wasRunning) banner.focus();
  announce(summary.banner, { assertive: true });
  if (reaction.chime && p.sound) playChime();
  if (reaction.notify && p.notifications) notify(summary.banner);
}

function connect() {
  const es = new EventSource('/events');
  es.addEventListener('status', (e) => {
    try {
      lastStatus = JSON.parse(e.data);
    } catch {
      return;
    }
    render();
  });
  es.onerror = () => {
    lastStatus = null;
    render();
    // the browser reconnects by itself unless the stream failed for good
    if (es.readyState === EventSource.CLOSED) setTimeout(connect, RECONNECT_MS);
  };
}

// ---- settings ----

async function saveSettings(patch) {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    if (!res.ok) return { ok: false, errors: body.errors ?? ['Could not save settings.'] };
    settings = body;
    return { ok: true };
  } catch {
    return { ok: false, errors: ['Could not save settings. Is the arcade server running?'] };
  }
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// ---- startup ----

applyPrefs(document.documentElement, prefs.get());
prefs.onChange((p) => {
  applyPrefs(document.documentElement, p);
  render();
});
window
  .matchMedia('(prefers-reduced-motion: reduce)')
  .addEventListener('change', () => applyPrefs(document.documentElement, prefs.get()));

createSettingsPanel({
  dialog: $('settings'),
  opener: $('settings-button'),
  prefs,
  getSettings: () => settings,
  saveSettings,
});

$('back-button').addEventListener('click', () => leaveGame());
$('paused-resume').addEventListener('click', resumeGame);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('settings').open) return;
  if (current || !els.stage.hidden) {
    e.preventDefault();
    leaveGame();
  }
});

window.addEventListener('hashchange', route);

async function start() {
  const [gamesResult, settingsResult] = await Promise.allSettled([
    getJson('/api/games'),
    getJson('/api/settings'),
  ]);
  if (settingsResult.status === 'fulfilled') settings = settingsResult.value;
  if (gamesResult.status === 'fulfilled' && Array.isArray(gamesResult.value)) {
    games = gamesResult.value;
    els.menuLoading.remove();
    renderMenu(els.list, games, (id) => {
      location.hash = id;
    });
  } else {
    els.menuLoading.textContent = 'Could not load games. Reload the page to try again.';
  }
  route();
  connect();
}

start();
