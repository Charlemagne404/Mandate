import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const genesis: unknown = JSON.parse(
  readFileSync(resolve('data/scenarios/northern-sandbox.json'), 'utf8'),
);
test.beforeEach(async ({ page }) => {
  const current = await (await page.request.get('/api/world')).json();
  const save = { ...(genesis as object), kind: 'save' };
  const response = await page.request.post('/api/import', {
    data: {
      expectedRevision: current.world.revision,
      expectedHash: current.hash,
      save,
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await expect(page.locator('[data-map-ready=true]')).toBeVisible();
});
test('select Finland on map, transfer control, render mode, inspect provenance and persist reload', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page
    .getByRole('button', { name: 'Select Finland on map', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Finland', exact: true }),
  ).toBeVisible();
  const originalGeometry = await (
    await page.request.get('/api/geography')
  ).body();
  await page
    .getByRole('button', { name: 'Military control', exact: true })
    .click();
  const before = await page.locator('.map-canvas').screenshot();
  await page.getByRole('button', { name: 'Debug', exact: true }).click();
  await page
    .getByLabel('Target nation', { exact: true })
    .selectOption('nation:rus');
  await page
    .getByRole('button', { name: 'Commit command', exact: true })
    .click();
  await expect(page.getByTestId('controller')).toHaveText('Russia');
  await expect(page.getByTestId('owner')).toHaveText('Finland');
  await expect(
    page.getByRole('heading', {
      name: 'Russia now controls Finland',
      exact: true,
    }),
  ).toBeVisible();
  const after = await page.locator('.map-canvas').screenshot();
  expect(createHash('sha256').update(after).digest('hex')).not.toBe(
    createHash('sha256').update(before).digest('hex'),
  );
  expect(await (await page.request.get('/api/geography')).body()).toEqual(
    originalGeometry,
  );
  await page.getByText('Why did this happen?', { exact: true }).click();
  await expect(page.locator('.provenance')).toContainText(
    'Manual sandbox directive',
  );
  await expect(page.locator('.provenance')).toContainText('TRANSFER_CONTROL');
  const hash = (await (await page.request.get('/api/world')).json()).hash;
  await page.screenshot({
    path: info.outputPath('control-and-provenance.png'),
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator('[data-map-ready=true]')).toBeVisible();
  expect((await (await page.request.get('/api/world')).json()).hash).toBe(hash);
  expect(errors).toEqual([]);
});
test('keyboard selection, time, country switch, treaty creation and rejection', async ({
  page,
}) => {
  await page.getByLabel('Inspect nation').selectOption('nation:fin');
  await page.getByRole('button', { name: '+ 7 days', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2025-01-08');
  await page.getByRole('button', { name: 'Debug', exact: true }).click();
  await page
    .getByLabel('Command', { exact: true })
    .selectOption('CREATE_TREATY');
  await page
    .getByLabel('Target nation', { exact: true })
    .selectOption('nation:swe');
  await page
    .getByRole('button', { name: 'Commit command', exact: true })
    .click();
  await expect(page.locator('.agreement')).toContainText(
    'Development agreement',
  );
  await page.getByRole('button', { name: 'Debug', exact: true }).click();
  await page
    .getByLabel('Command', { exact: true })
    .selectOption('CREATE_TREATY');
  await page
    .getByLabel('Target nation', { exact: true })
    .selectOption('nation:swe');
  await page
    .getByRole('button', { name: 'Commit command', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Equivalent active treaty',
  );
  expect(
    (await (await page.request.get('/api/world')).json()).world.revision,
  ).toBe(2);
  await page.getByRole('button', { name: 'Close command editor' }).click();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Debug', exact: true }).click();
  await page
    .getByLabel('Command', { exact: true })
    .selectOption('SWITCH_NATION');
  await page
    .getByLabel('Target nation', { exact: true })
    .selectOption('nation:fin');
  await page
    .getByRole('button', { name: 'Commit command', exact: true })
    .click();
  await expect(page.locator('.player')).toContainText('Finland');
  await page.getByRole('button', { name: 'Debug', exact: true }).click();
  await page
    .getByRole('button', { name: 'Canonical state', exact: true })
    .click();
  await expect(page.locator('.state-json')).toContainText(
    '"playerNationId": "nation:fin"',
  );
});
test('export/import is explicit, round trips, and invalid imports leave the world intact', async ({
  page,
}) => {
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export save', exact: true }).click();
  const download = await downloadEvent;
  const downloaded = await download.path();
  expect(downloaded).toBeTruthy();
  const save = JSON.parse(readFileSync(downloaded!, 'utf8'));
  const initialHash = (await (await page.request.get('/api/world')).json())
    .hash;
  await page.getByRole('button', { name: '+ 7 days', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2025-01-08');
  await page.locator('input[type=file]').setInputFiles({
    name: 'save.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(save)),
  });
  await expect(
    page.getByRole('heading', { name: 'Replace the active sandbox?' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Replace sandbox', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-01');
  expect((await (await page.request.get('/api/world')).json()).hash).toBe(
    initialHash,
  );
  save.world.regions[0].controllerNationId = 'nation:unknown';
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(save)),
  });
  await page
    .getByRole('button', { name: 'Replace sandbox', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('Unknown');
  expect((await (await page.request.get('/api/world')).json()).hash).toBe(
    initialHash,
  );
});
