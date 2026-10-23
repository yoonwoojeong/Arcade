import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

async function seriousViolations(page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')) }));
}

async function openMenu(page, baseURL) {
  await page.goto(baseURL);
  await expect(page.locator('.game-card')).toHaveCount(3);
  await expect(page.locator('#status-badge')).toHaveText('Claude is idle');
}

test('menu, settings dialog and banner have no serious/critical axe violations', async ({
  page,
  baseURL,
  setStatus,
}) => {
  await openMenu(page, baseURL);
  expect(await seriousViolations(page), 'menu').toEqual([]);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('#settings')).toBeVisible();
  expect(await seriousViolations(page), 'settings dialog open').toEqual([]);

  // high contrast on, checked with the dialog open and closed
  await page.locator('#settings').getByLabel('High contrast').check();
  await expect(page.locator('html')).toHaveClass(/\bhigh-contrast\b/);
  expect(await seriousViolations(page), 'high contrast, settings open').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).toBeHidden();
  expect(await seriousViolations(page), 'high contrast, menu').toEqual([]);

  await setStatus({ s1: { state: 'needs-you', project: 'demo' } });
  await expect(page.locator('#banner')).toBeVisible();
  expect(await seriousViolations(page), 'banner shown, high contrast').toEqual([]);

  await page.locator('#settings-button').click();
  await page.locator('#settings').getByLabel('High contrast').uncheck();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveClass(/\bhigh-contrast\b/);
  expect(await seriousViolations(page), 'banner shown').toEqual([]);
});

for (const id of ['2048', 'minesweeper', 'snake']) {
  test(`${id} mounted in the shell has no serious/critical axe violations`, async ({
    page,
    baseURL,
    setStatus,
  }) => {
    await openMenu(page, baseURL);
    await page.locator(`[data-game-id="${id}"]`).click();
    await expect(page.locator('body')).toHaveAttribute('data-game-state', 'running');
    // the game has rendered its own DOM (Snake is a canvas, so it has no text)
    await expect(page.locator('.game-root > *').first()).toBeVisible();
    expect(await seriousViolations(page), `${id} running`).toEqual([]);

    await setStatus({ s1: { state: 'needs-you', project: 'demo' } });
    await expect(page.locator('body')).toHaveAttribute('data-game-state', 'paused');
    expect(await seriousViolations(page), `${id} paused with banner`).toEqual([]);
  });
}
