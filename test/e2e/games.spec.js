import { test, expect } from './fixtures.js';

const body = (page) => page.locator('body');
const announcer = (page) => page.locator('#sr-announcer');

async function launch(page, baseURL, id) {
  await page.goto(baseURL);
  await page.locator(`[data-game-id="${id}"]`).click();
  await expect(body(page)).toHaveAttribute('data-game', id);
  await expect(body(page)).toHaveAttribute('data-game-state', 'running');
}

for (const id of ['2048', 'minesweeper', 'snake']) {
  test(`${id}: launches from the menu, pauses on needs-you, resumes`, async ({
    page,
    baseURL,
    setStatus,
  }) => {
    await launch(page, baseURL, id);
    await setStatus({ s1: { state: 'needs-you', project: 'demo' } });
    await expect(page.locator('#banner')).toContainText('Claude needs you in demo');
    await expect(body(page)).toHaveAttribute('data-game-state', 'paused');
    await page.getByRole('button', { name: 'Resume game' }).click();
    await expect(body(page)).toHaveAttribute('data-game-state', 'running');
  });
}

test('opening Settings pauses a running game and closing resumes it', async ({ page, baseURL }) => {
  await launch(page, baseURL, '2048');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('#settings')).toBeVisible();
  await expect(body(page)).toHaveAttribute('data-game-state', 'paused');
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-game-state', 'running');
  // Esc closed only the dialog, not the game
  await expect(body(page)).toHaveAttribute('data-game', '2048');
});

test('Esc pauses into the paused panel; Back to menu leaves and focuses the game card', async ({
  page,
  baseURL,
}) => {
  await launch(page, baseURL, 'minesweeper');
  const panel = page.locator('#paused-panel');

  await page.keyboard.press('Escape');
  await expect(body(page)).toHaveAttribute('data-game-state', 'paused');
  await expect(body(page)).toHaveAttribute('data-game', 'minesweeper');
  await expect(panel).toBeVisible();
  await expect(page.locator('#paused-resume')).toBeFocused();

  // Resume game returns to the running game
  await page.keyboard.press('Enter');
  await expect(body(page)).toHaveAttribute('data-game-state', 'running');
  await expect(panel).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(page.locator('#paused-resume')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Back to menu' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#stage')).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-game', '');
  await expect(body(page)).toHaveAttribute('data-game-state', 'empty');
  await expect(page.locator('[data-game-id="minesweeper"]')).toBeFocused();
  await expect(page).toHaveURL(`${baseURL}/`);
});

test('P toggles pause', async ({ page, baseURL }) => {
  await launch(page, baseURL, '2048');
  await page.keyboard.press('p');
  await expect(body(page)).toHaveAttribute('data-game-state', 'paused');
  await expect(page.locator('#paused-panel')).toBeVisible();
  await page.keyboard.press('p');
  await expect(body(page)).toHaveAttribute('data-game-state', 'running');
  await expect(page.locator('#paused-panel')).toBeHidden();
  await expect(page.locator('.game-root')).toBeFocused();
});

test('leaving the window or hiding the tab pauses the game until Resume', async ({
  page,
  baseURL,
}) => {
  await launch(page, baseURL, 'snake');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(body(page)).toHaveAttribute('data-game-state', 'paused');
  await expect(page.locator('#paused-panel')).toBeVisible();
  // coming back does not resume by itself
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(body(page)).toHaveAttribute('data-game-state', 'paused');
  await page.locator('#paused-resume').click();
  await expect(body(page)).toHaveAttribute('data-game-state', 'running');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(body(page)).toHaveAttribute('data-game-state', 'paused');
  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(body(page)).toHaveAttribute('data-game-state', 'paused');
});

test('keyboard Enter and Space on New game restart the game', async ({ page, baseURL }) => {
  // 2048
  await launch(page, baseURL, '2048');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  const newGame2048 = page.locator('.game-root').getByRole('button', { name: 'New game' });
  await newGame2048.focus();
  await page.keyboard.press('Enter');
  await expect(announcer(page)).toHaveText('New game. Score 0.');
  await page.keyboard.press('ArrowUp'); // keys on the button are not game moves
  await expect(announcer(page)).toHaveText('New game. Score 0.');
  await page.evaluate(() => (document.getElementById('sr-announcer').textContent = ''));
  await page.keyboard.press('Space');
  await expect(announcer(page)).toHaveText('New game. Score 0.');

  // Minesweeper
  await page.locator('#back-button').click();
  await launch(page, baseURL, 'minesweeper');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(announcer(page)).toHaveText(/Row 1, column 2: /);
  await page.keyboard.press('Tab');
  const newGameMines = page.locator('.game-root').getByRole('button', { name: 'New game' });
  await expect(newGameMines).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(announcer(page)).toHaveText(/^New game\. \d+ mines remaining\.$/);
  await expect(page.locator('[role="gridcell"]').first()).toHaveAttribute(
    'aria-label',
    'Row 1, column 1: hidden',
  );
});

test('Shift+Tab inside Minesweeper moves focus without flagging', async ({ page, baseURL }) => {
  await launch(page, baseURL, 'minesweeper');
  await page.keyboard.press('ArrowRight');
  const cell = page.locator('[role="gridcell"][aria-label^="Row 1, column 2:"]');
  await expect(cell).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cell).not.toBeFocused();
  await expect(cell).toHaveAttribute('aria-label', 'Row 1, column 2: hidden');
  await expect(announcer(page)).not.toContainText('Flag');

  // a lone Shift tap still flags
  await cell.focus();
  await page.keyboard.press('Shift');
  await expect(announcer(page)).toHaveText(/^Flagged\. /);
});

test('key combinations with Ctrl are left to the browser', async ({ page, baseURL }) => {
  await launch(page, baseURL, 'snake');
  await page.evaluate(() => {
    window.__keys = [];
    document.addEventListener('keydown', (e) => {
      if (!e.code.startsWith('Control')) window.__keys.push([e.code, e.defaultPrevented]);
    });
  });
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+ArrowUp');
  await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(() => window.__keys)).toEqual([
    ['KeyD', false],
    ['ArrowUp', false],
    ['ArrowUp', true],
  ]);
  await expect(body(page)).toHaveAttribute('data-game-state', 'running');
});

test('unknown or malicious hash shows the menu and loads no module', async ({ page, baseURL }) => {
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(`${baseURL}/#../../server/cli`);
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('.game-card')).toHaveCount(3);
  await expect(page.locator('#stage')).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-game-state', 'empty');
  expect(requests.filter((u) => u.includes('/server/'))).toEqual([]);
  expect(requests.filter((u) => u.includes('/games/'))).toEqual([]);
});

test('a crashing game shows the crash message and the menu still works', async ({
  page,
  baseURL,
}) => {
  await page.route('**/games/2048/index.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export default function createGame() {
  return {
    start() { throw new Error('boom'); },
    pause() {}, resume() {}, destroy() {},
  };
}`,
    }),
  );
  await page.goto(baseURL);
  await page.locator('[data-game-id="2048"]').click();
  await expect(page.locator('#shell-message')).toHaveText('This game crashed — back to menu');
  await expect(page.locator('#shell-message')).toBeVisible();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(body(page)).toHaveAttribute('data-game-state', 'empty');
  await expect(page.locator('#sr-announcer-assertive')).toHaveText(
    'This game crashed — back to menu',
  );

  await page.locator('[data-game-id="minesweeper"]').click();
  await expect(body(page)).toHaveAttribute('data-game', 'minesweeper');
  await expect(body(page)).toHaveAttribute('data-game-state', 'running');
  await expect(page.locator('#shell-message')).toBeHidden();
});

test('2048 is fully keyboard playable', async ({ page, baseURL }) => {
  await page.goto(baseURL);
  await page.locator('[data-game-id="2048"]').focus();
  await page.keyboard.press('Enter');
  await expect(body(page)).toHaveAttribute('data-game-state', 'running');
  await expect(page.locator('.game-root')).toBeFocused();
  await expect(announcer(page)).toContainText('2048. Use the arrow keys');

  // some direction always moves on a fresh board; each key yields a new announcement
  const seen = [];
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    await page.keyboard.press(key);
    await expect(announcer(page)).toHaveText(/^(Moved|Merged .+)\. Score \d+\.$|^No move\.$/);
    seen.push(await announcer(page).textContent());
  }
  expect(seen.some((t) => t.startsWith('Moved') || t.startsWith('Merged'))).toBe(true);
});

test('Minesweeper is fully keyboard playable', async ({ page, baseURL }) => {
  await page.goto(baseURL);
  await page.locator('[data-game-id="minesweeper"]').focus();
  await page.keyboard.press('Enter');
  await expect(body(page)).toHaveAttribute('data-game-state', 'running');
  await expect(announcer(page)).toContainText('Minesweeper. 9 by 9 board');

  // cursor moves are conveyed by focus and the focused cell's label
  await page.keyboard.press('ArrowRight');
  const focused = page.locator('[role="gridcell"]:focus');
  await expect(focused).toHaveAttribute('aria-label', /^Row 1, column 2: /);
  await page.keyboard.press('ArrowDown');
  await expect(focused).toHaveAttribute('aria-label', /^Row 2, column 2: /);

  // flag toggles are announced
  await page.keyboard.press('KeyX');
  await expect(announcer(page)).toHaveText(/^Flagged\. /);
  await page.keyboard.press('KeyX');
  await expect(announcer(page)).toHaveText(/^Flag removed\. /);

  // Enter reveals (the first reveal is always safe) and is announced
  await expect(focused).toHaveAttribute('aria-label', 'Row 2, column 2: hidden');
  await page.keyboard.press('Enter');
  await expect(announcer(page)).toHaveText(
    /^(Opened \d+ cells\. )?Row 2, column 2: (empty|\d adjacent mines?)$/,
  );
  await expect(focused).toHaveAttribute(
    'aria-label',
    /^Row 2, column 2: (empty|\d adjacent mines?)$/,
  );
});
