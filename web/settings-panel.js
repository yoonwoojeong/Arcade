// Settings dialog: server settings (mode, auto-open delay) via POST /api/settings,
// everything else via prefs (localStorage). Also applies prefs to the document.

const DELAY_MIN = 5;
const DELAY_MAX = 600;
const DELAY_ERROR = `Auto-open delay must be a whole number from ${DELAY_MIN} to ${DELAY_MAX} seconds.`;

export function applyPrefs(rootEl, p) {
  if (p.theme === 'light' || p.theme === 'dark') rootEl.dataset.theme = p.theme;
  else delete rootEl.dataset.theme;
  rootEl.classList.toggle('high-contrast', Boolean(p.highContrast));
  rootEl.classList.toggle('reduced-motion', Boolean(p.reducedMotion));
  rootEl.classList.toggle('colorblind', Boolean(p.colorblindPalette));
}

export function createSettingsPanel({
  dialog,
  opener,
  prefs,
  getSettings,
  saveSettings,
  onOpen = () => {},
  onClose = () => false,
}) {
  const $ = (sel) => dialog.querySelector(sel);
  const form = $('#settings-form');
  const modeRadios = [...dialog.querySelectorAll('input[name="mode"]')];
  const delay = $('#set-delay');
  const error = $('#settings-error');
  const notifHelp = $('#notifications-help');
  const toggles = {
    sound: $('#set-sound'),
    notifications: $('#set-notifications'),
    reducedMotion: $('#set-motion'),
    highContrast: $('#set-contrast'),
    colorblindPalette: $('#set-colorblind'),
    showProject: $('#set-project'),
  };
  const theme = $('#set-theme');

  function setError(text) {
    error.textContent = text;
  }

  function setNotifHelp(text) {
    notifHelp.textContent = text;
    notifHelp.hidden = !text;
  }

  function fill() {
    const s = getSettings();
    for (const r of modeRadios) r.checked = r.value === s.mode;
    delay.value = String(s.autoOpenDelay);
    delay.removeAttribute('aria-invalid');
    const p = prefs.get();
    for (const [key, el] of Object.entries(toggles)) el.checked = Boolean(p[key]);
    theme.value = p.theme;
    setError('');
  }

  async function save(patch) {
    const result = await saveSettings(patch);
    if (!result.ok) setError(result.errors.join(' '));
    else setError('');
    return result.ok;
  }

  for (const r of modeRadios) {
    r.addEventListener('change', async () => {
      if (!r.checked) return;
      if (!(await save({ mode: r.value }))) fill();
    });
  }

  delay.addEventListener('change', async () => {
    const raw = delay.value.trim();
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < DELAY_MIN || n > DELAY_MAX) {
      delay.setAttribute('aria-invalid', 'true');
      setError(DELAY_ERROR);
      return;
    }
    if (await save({ autoOpenDelay: n })) delay.removeAttribute('aria-invalid');
    else delay.setAttribute('aria-invalid', 'true');
  });

  for (const key of [
    'sound',
    'reducedMotion',
    'highContrast',
    'colorblindPalette',
    'showProject',
  ]) {
    toggles[key].addEventListener('change', () => prefs.set({ [key]: toggles[key].checked }));
  }

  theme.addEventListener('change', () => prefs.set({ theme: theme.value }));

  // Permission is requested only when the user switches notifications on.
  toggles.notifications.addEventListener('change', async () => {
    const box = toggles.notifications;
    setNotifHelp('');
    if (!box.checked) {
      prefs.set({ notifications: false });
      return;
    }
    const N = window.Notification;
    if (!N) {
      box.checked = false;
      setNotifHelp('This browser does not support notifications.');
      return;
    }
    let permission = N.permission;
    if (permission === 'default') {
      try {
        permission = await N.requestPermission();
      } catch {
        permission = 'denied';
      }
    }
    if (permission === 'granted') {
      prefs.set({ notifications: true });
    } else {
      box.checked = false;
      prefs.set({ notifications: false });
      setNotifHelp('Notifications are blocked for this page. Allow them in your browser settings.');
    }
  });

  // Every control saves on change; Enter must not submit or close the dialog.
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#settings-close').addEventListener('click', () => dialog.close());

  // onClose returns true when it moved focus itself (e.g. back into a resumed game).
  dialog.addEventListener('close', () => {
    if (!onClose()) opener.focus();
  });

  opener.addEventListener('click', () => {
    fill();
    onOpen();
    dialog.showModal();
    (modeRadios.find((r) => r.checked) ?? modeRadios[0]).focus();
  });

  return {
    get open() {
      return dialog.open;
    },
    // Show server settings that changed elsewhere (e.g. /plugin) without touching an edit
    // in progress in the delay field.
    refresh() {
      if (!dialog.open) return;
      const s = getSettings();
      for (const r of modeRadios) r.checked = r.value === s.mode;
      if (document.activeElement !== delay && delay.getAttribute('aria-invalid') !== 'true') {
        delay.value = String(s.autoOpenDelay);
      }
    },
  };
}
