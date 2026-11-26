import { defineConfig, devices } from '@playwright/test';

// A dedicated port, never the dev server's 5173, and never reused: another
// worktree's server on the same port would otherwise run the specs against the wrong app.
const port = Number(process.env.E2E_PORT ?? 5199);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'e2e',
  // A run holds one build slot (scripts/slot.sh), so it stays a bounded load on the machine;
  // its browsers inherit that slot instead of each taking their own.
  workers: 4,
  use: { baseURL },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
  ],
});
