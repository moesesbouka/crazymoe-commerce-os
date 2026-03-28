const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:4173',
  },
  webServer: {
    command: 'python -m http.server 4173',
    port: 4173,
    reuseExistingServer: true,
  },
});