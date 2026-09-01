import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1400, height: 900 },
    screenshot: 'on',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    timeout: 30000,
    reuseExistingServer: true,
  },
});
