import { expect, test } from '@playwright/test';

test('home shows the heading and credit links', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Geography Trainer' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'MapTap.gg' })).toHaveAttribute(
    'href',
    'https://maptap.gg',
  );
  await expect(page.getByRole('link', { name: 'Natural Earth' })).toHaveAttribute(
    'href',
    'https://www.naturalearthdata.com',
  );
});

test('unknown paths redirect to home', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page).toHaveURL('/');
});

test('no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
});
