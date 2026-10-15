import { defineConfig, devices } from '@playwright/test';

// E2E lives in ./e2e (excluded from vitest). Two static servers on ports that avoid 5173/5180:
//  4179: `vite preview` of dist/ at the root
//  4180: dist/ served under the sub-path /sub/orbits/ (proves base './' works on e.g. GitHub Pages)
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run build && npx vite preview --port 4179 --strictPort',
      url: 'http://localhost:4179/',
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // Started after the build above has finished writing dist/ (the server polls until dist/index.html exists).
      command: 'node e2e/serve-subpath.mjs 4180 /sub/orbits/',
      url: 'http://localhost:4180/sub/orbits/',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
