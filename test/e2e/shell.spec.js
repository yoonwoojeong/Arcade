import { test, expect } from './fixtures.js';

const badge = (page) => page.locator('#status-badge');
const banner = (page) => page.locator('#banner');

async function postSettings(request, baseURL, patch) {
  const res = await request.post(`${baseURL}/api/settings`, {
    headers: { Origin: baseURL, 'Content-Type': 'application/json' },
    data: patch,
  });
  expect(res.status()).toBe(200);
}

test('badge reflects status and goes offline when the server stops', async ({
  page,
  baseURL,
  setStatus,
  server,
}) => {
  await page.goto(baseURL);
  await expect(badge(page)).toHaveText('Claude is idle');
  await expect(badge(page)).toHaveAttribute('role', 'status');
  await expect(badge(page)).toHaveAttribute('aria-live', 'polite');
  await expect(badge(page)).toHaveAttribute('data-state', 'idle');

  await setStatus({ s1: { state: 'working', project: 'demo' } });
  await expect(badge(page)).toHaveText('Claude is working…');
  await expect(badge(page)).toHaveAttribute('data-state', 'working');

  await server.close();
  await expect(badge(page)).toHaveText('Offline — reconnecting…');
  await expect(badge(page)).toHaveAttribute('data-state', 'offline');
});

test('menu shows the empty state when no games are installed', async ({ page, baseURL }) => {
  await page.goto(baseURL);
  await expect(page.locator('#menu')).toContainText('No games installed.');
  await expect(page.locator('body')).toHaveAttribute('data-game', '');
  await expect(page.locator('body')).toHaveAttribute('data-game-state', 'empty');
});

test('an unknown hash shows the menu', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#../../etc`);
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#stage')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-game-state', 'empty');
});

test('needs-you shows the banner in alert mode and not in quiet mode', async ({
  page,
  baseURL,
  setStatus,
  request,
}) => {
  await page.goto(baseURL);
  await expect(badge(page)).toHaveText('Claude is idle');
  await expect(banner(page)).toBeHidden();

  await setStatus({ s1: { state: 'needs-you', project: 'demo' } });
  await expect(badge(page)).toHaveText('demo needs you');
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toHaveAttribute('role', 'alert');
  await expect(banner(page)).toContainText('Claude needs you in demo');
  await expect(page.locator('#sr-announcer-assertive')).toHaveText('Claude needs you in demo');
  await expect(banner(page).getByRole('button', { name: 'Dismiss' })).toBeVisible();

  // a new working state hides the banner
  await setStatus({ s1: { state: 'working', project: 'demo' } });
  await expect(badge(page)).toHaveText('Claude is working…');
  await expect(banner(page)).toBeHidden();

  await postSettings(request, baseURL, { mode: 'quiet' });
  await page.reload();
  await expect(badge(page)).toHaveText('Claude is working…');

  await setStatus({ s1: { state: 'done', project: 'demo' } });
  await expect(badge(page)).toHaveText('Claude finished in demo');
  await setStatus({ s1: { state: 'needs-you', project: 'demo' } });
  await expect(badge(page)).toHaveText('demo needs you');
  await expect(banner(page)).toBeHidden();
});

test('dismissed banner stays hidden until state changes', async ({ page, baseURL, setStatus }) => {
  await page.goto(baseURL);
  await expect(badge(page)).toHaveText('Claude is idle');

  const since = new Date().toISOString();
  await setStatus({ s1: { state: 'done', project: 'demo', since } });
  await expect(banner(page)).toContainText('Claude finished in demo');
  await banner(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner(page)).toBeHidden();

  // same session and state (same key): still hidden, even though the badge updates
  await setStatus({ s1: { state: 'done', project: 'renamed', since } });
  await expect(badge(page)).toHaveText('Claude finished in renamed');
  await expect(banner(page)).toBeHidden();

  await setStatus({ s1: { state: 'working', project: 'demo' } });
  await expect(badge(page)).toHaveText('Claude is working…');
  await setStatus({ s1: { state: 'needs-you', project: 'demo' } });
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('Claude needs you in demo');
});

test('settings dialog is keyboard operable and saves mode', async ({ page, baseURL, request }) => {
  await page.goto(baseURL);
  await expect(badge(page)).toHaveText('Claude is idle');
  const dialog = page.locator('#settings');
  await expect(dialog).toBeHidden();

  const opener = page.getByRole('button', { name: 'Settings' });
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();

  // every setting is a labelled control
  for (const name of [
    'Alert',
    'Auto',
    'Quiet',
    'Auto-open delay (seconds)',
    'Sound',
    'Browser notifications',
    'Theme',
    'Reduced motion',
    'High contrast',
    'Colorblind-safe palette',
    'Show project name',
  ]) {
    await expect(dialog.getByLabel(name, { exact: true })).toBeVisible();
  }

  // the dialog opens with focus on the checked mode radio; arrows change it
  await expect(dialog.getByLabel('Alert', { exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByLabel('Quiet', { exact: true })).toBeChecked();
  await expect
    .poll(async () => (await (await request.get(`${baseURL}/api/settings`)).json()).mode)
    .toBe('quiet');

  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Auto-open delay (seconds)')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('45');
  await page.keyboard.press('Tab');
  await expect
    .poll(async () => (await (await request.get(`${baseURL}/api/settings`)).json()).autoOpenDelay)
    .toBe(45);

  // a pref toggled by keyboard is applied to the page
  await dialog.getByLabel('High contrast').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveClass(/\bhigh-contrast\b/);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  // prefs persist across reloads
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/\bhigh-contrast\b/);
});

test('an invalid auto-open delay is reported and not saved', async ({ page, baseURL, request }) => {
  await page.goto(baseURL);
  await page.getByRole('button', { name: 'Settings' }).click();
  const delay = page.getByLabel('Auto-open delay (seconds)');
  await delay.fill('2');
  await delay.press('Tab');
  await expect(delay).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#settings-error')).toContainText('5');
  const settings = await (await request.get(`${baseURL}/api/settings`)).json();
  expect(settings.autoOpenDelay).toBe(20);
});
