import { expect, test } from './test';

test('[GLB-33] home shows the heading and credit links', async ({ page }) => {
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

test('[GLB-32] unknown paths redirect to home', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page).toHaveURL('/');
});

test('[GLB-29, GLB-30] no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
});
