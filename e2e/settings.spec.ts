import { expect, test } from './test';
import { WAIT, writeMasteredUnitedStates } from './sessionHelpers';

test.describe.configure({ timeout: 120_000 });

test('[SCR-19] the daily limit is saved and Home uses it', async ({ page }) => {
  await page.goto('/settings');
  const input = page.getByLabel('New items per day');
  await expect(input).toHaveValue('15', WAIT);
  await input.fill('5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page.getByTestId('today-new')).toHaveText('0 of 5 new today', WAIT);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByLabel('New items per day')).toHaveValue('5', WAIT);
});

test('[SCR-19] an out-of-range limit shows an alert and saves nothing', async ({ page }) => {
  await page.goto('/settings');
  const input = page.getByLabel('New items per day');
  await expect(input).toHaveValue('15', WAIT);
  await input.fill('51');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Enter a whole number from 5 to 50.');
  await expect(page.getByRole('status')).toHaveCount(0);
  await input.fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await input.fill('20');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page.getByTestId('today-new')).toHaveText('0 of 15 new today', WAIT);
});

test('[SCR-21, SCR-23] import and reset each ask in a dialog; reset needs "reset" typed, then clears the progress', async ({ page }, testInfo) => {
  const file = testInfo.outputPath('progress.json');
  await writeMasteredUnitedStates(file);
  await page.goto('/settings');
  // The import asks first, in a dialog: Cancel keeps the progress as it is.
  const confirm = page.getByRole('dialog', { name: 'Confirm import' });
  await page.getByLabel('Import progress').setInputFiles(file);
  await expect(confirm).toContainText('This browser: nothing started.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page.getByTestId('today-learned')).toHaveText('0', WAIT);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Import progress').setInputFiles(file);
  await confirm.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByRole('status')).toHaveText('Progress imported.', WAIT);
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page.getByTestId('today-learned')).not.toHaveText('0', WAIT);

  await page.getByRole('link', { name: 'Settings' }).click();
  const open = page.getByRole('button', { name: 'Reset all progress' });
  const dialog = page.getByRole('dialog', { name: 'Reset all progress' });
  // Cancel closes the confirmation and resets nothing.
  await open.click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  await open.click();
  const button = dialog.getByRole('button', { name: 'Reset all progress' });
  await expect(button).toBeDisabled();
  await dialog.getByLabel('Type reset to confirm').fill('rese');
  await expect(button).toBeDisabled();
  await dialog.getByLabel('Type reset to confirm').fill(' Reset ');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('status')).toHaveText('All progress was reset.', WAIT);
  await expect(dialog).toBeHidden();

  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page.getByTestId('today-learned')).toHaveText('0', WAIT);
  await expect(page.getByTestId('today-learning')).toHaveText('0');
  await expect(page.getByRole('link', { name: 'Take the placement test' })).toBeVisible();
});

test('[SCR-26] Settings does not scroll horizontally on a phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone width only');
  await page.goto('/settings');
  await expect(page.getByLabel('New items per day')).toBeVisible(WAIT);
  const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
});
