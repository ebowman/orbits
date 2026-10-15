import { expect, test, type Page } from '@playwright/test';

const ROUTES = ['/', '/plan', '/observe', '/solve', '/learn/gauss', '/learn/laplace', '/explore'];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return errors;
}

async function solveSyntheticCeres(page: Page, base: string) {
  await page.goto(`${base}#/observe`);
  await expect(page.getByRole('heading', { level: 1, name: 'Enter observations' })).toBeVisible();
  await page.locator('label', { hasText: /^Body/ }).locator('select').selectOption({ label: 'Ceres' });
  await page.getByRole('button', { name: 'Generate synthetic set' }).click();
  await page.getByRole('button', { name: 'Solve this set' }).click();
  await expect(page).toHaveURL(/#\/solve$/);
  const cell = page.getByTestId('pct-gauss-a');
  await expect(cell).toBeVisible();
  const text = (await cell.textContent()) ?? '';
  const pct = parseFloat(text.replace(/[^0-9eE+.-]/g, ''));
  expect(pct).toBeLessThan(1); // Gauss a within 1% of the catalog value
  // Compare the displayed values directly rather than trusting only the % cell.
  const gaussA = parseFloat((await page.getByTestId('val-gauss-a').textContent()) ?? '');
  const catA = parseFloat((await page.getByTestId('cat-a').textContent()) ?? '');
  expect(Number.isFinite(gaussA) && Number.isFinite(catA) && catA > 0).toBe(true);
  expect(Math.abs(gaussA - catA) / catA).toBeLessThan(0.01);
  await expect(page.getByRole('columnheader', { name: /Least squares \(3 obs\)/ }).first()).toBeVisible();
  const rms = parseFloat((await page.getByTestId('lsq-rms').textContent()) ?? '');
  expect(rms).toBeLessThan(1); // LSQ RMS (arcsec) on a noise-free synthetic set
}

async function visitAll(page: Page, base: string) {
  for (const r of ROUTES) {
    await page.goto(`${base}#${r}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Loading...', { exact: true })).toHaveCount(0);
    await page.waitForTimeout(300); // let lazy scenes / effects settle so late errors surface
  }
}

// Headless chromium may have no WebGL; the app's own guard renders a fallback. Allow only console.error
// messages about WebGL context creation, nothing else (page errors, failed requests and HTTP errors are never allowed).
const ALLOWED = [/^console\.error: .*(Error creating WebGL context|WebGL context could not be created|WebGL is not supported)/i];
const unexpected = (errs: string[]) => errs.filter((e) => !ALLOWED.some((re) => re.test(e)));

for (const [name, base] of [
  ['root', 'http://localhost:4179/'],
  ['sub-path /sub/orbits/', 'http://localhost:4180/sub/orbits/'],
] as const) {
  test.describe(name, () => {
    test('synthetic Ceres -> Solve: Gauss a within 1% of catalog', async ({ page }) => {
      const errors = collectErrors(page);
      await solveSyntheticCeres(page, base);
      expect(unexpected(errors)).toEqual([]);
    });

    test('every route loads without console errors or page errors', async ({ page }) => {
      const errors = collectErrors(page);
      await visitAll(page, base);
      // Explore: the sweep runs in a module Web Worker, which must resolve under the base path.
      await page.goto(`${base}#/explore`);
      await page.getByRole('button', { name: 'Run sweep' }).click();
      await expect(page.getByTestId('heatmap').first()).toBeVisible({ timeout: 45_000 });
      expect(unexpected(errors)).toEqual([]);
    });
  });
}
