const { test, expect } = require('@playwright/test');

test('hub page renders config inputs and refresh button', async ({ page }) => {
  await page.goto('/moe-inventory/app/hub/index.html');
  await expect(page.locator('#sb-url')).toBeVisible();
  await expect(page.locator('#sb-key')).toBeVisible();
  await expect(page.locator('#refresh')).toBeVisible();
});