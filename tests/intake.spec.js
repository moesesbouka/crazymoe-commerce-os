const { test, expect } = require('@playwright/test');

test('intake page shows config and item form', async ({ page }) => {
  await page.goto('/moe-inventory/app/intake/index.html');

  await expect(page.locator('input, textarea, select').first()).toBeVisible();
  await expect(page.locator('button').first()).toBeVisible();
});
