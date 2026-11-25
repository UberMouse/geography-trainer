import { expect, test } from '@playwright/test';

test('the footer opens the Credits page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Credits' }).click();
  await expect(page).toHaveURL(/\/credits$/);
  await expect(page.getByRole('heading', { name: 'Credits' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'MapTap.gg' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Natural Earth' })).toBeVisible();
});

test('Credits does not scroll horizontally at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/credits');
  await expect(page.getByRole('heading', { name: 'Credits' })).toBeVisible();
  const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
});
