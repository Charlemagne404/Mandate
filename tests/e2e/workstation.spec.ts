import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const genesis: unknown = JSON.parse(
  readFileSync(resolve('data/scenarios/northern-sandbox.json'), 'utf8'),
);
test.beforeEach(async ({ page }) => {
  await page.request.post('/api/experience', {
    data: { onboarded: true, developerMode: true },
  });
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
test('shows a player annexation as an order, an attempted implementation, and an unresolved outcome', async ({
  page,
}) => {
  await page.locator('#directive').fill('Annex Finland.');
  await page
    .getByRole('button', { name: 'Issue directive', exact: true })
    .click();
  const summary = page.locator('.turn-summary');
  await expect(
    summary.getByText('PLAYER ORDER', { exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByText('COMMITTED ACTIONS', { exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByText('WORLD OUTCOME', { exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByText('MAJOR INTENT SATISFACTION AUDIT', { exact: true }),
  ).toBeVisible();
  await expect(summary).toContainText('Annex Finland');
  await expect(summary).toContainText(
    /No territorial transfer occurred\. 0 of 1 targeted region\(s\)/,
  );
  await expect(summary).toContainText(
    /No territorial transfer occurred\..*Finland retains the rest/,
  );
  const world = (await (await page.request.get('/api/world')).json()).world;
  expect(
    world.regions
      .filter(
        (r: { ownerNationId: string }) => r.ownerNationId === 'nation:fin',
      )
      .every(
        (r: { ownerNationId: string; claims: string[] }) =>
          r.ownerNationId === 'nation:fin' && r.claims.includes('nation:swe'),
      ),
  ).toBe(true);
});
test('labels an extreme strike as an order and an abstracted committed action', async ({
  page,
}) => {
  const order =
    'Sweden nukes Finland and sends in its armed forces to take the country';
  await page.locator('#directive').fill(order);
  await page
    .getByRole('button', { name: 'Issue directive', exact: true })
    .click();
  const summary = page.locator('.turn-summary');
  await expect(
    summary.getByText('PLAYER ORDER', { exact: true }),
  ).toBeVisible();
  await expect(summary).toContainText(order);
  await expect(
    summary.getByText('PARSED MAJOR INTENTS', { exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByText('COMMITTED ACTIONS', { exact: true }),
  ).toBeVisible();
  await expect(summary).toContainText('strategic attack abstraction');
  await expect(summary).toContainText('invasion offensive begins');
  await expect(
    summary.getByText('WORLD OUTCOME', { exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByText('MAJOR INTENT SATISFACTION AUDIT', { exact: true }),
  ).toBeVisible();
  await expect(summary).not.toContainText(/Finland (?:was )?nuked/i);
  await expect(summary).not.toContainText(/nuclear detonation/i);
  await page.getByRole('button', { name: 'Conflicts', exact: true }).click();
  await expect(page.locator('.conflict-card')).toContainText(
    'Strategic objectives, not confirmed world outcomes',
  );
  const world = (await (await page.request.get('/api/world')).json()).world;
  expect(
    world.conflicts.some(
      (conflict: {
        status: string;
        attackers: string[];
        defenders: string[];
        theaters: { posture: string }[];
      }) =>
        conflict.status === 'active' &&
        conflict.attackers.includes('nation:swe') &&
        conflict.defenders.includes('nation:fin') &&
        conflict.theaters.some(
          (theater) => theater.posture === 'major-offensive',
        ),
    ),
  ).toBe(true);
  expect(
    world.regions
      .filter(
        (region: { ownerNationId: string }) =>
          region.ownerNationId === 'nation:fin',
      )
      .every(
        (region: { ownerNationId: string; controllerNationId: string }) =>
          region.ownerNationId === 'nation:fin' &&
          region.controllerNationId === 'nation:fin',
      ),
  ).toBe(true);
});
test('developer mode offers a clearly labeled immediate territorial outcome override', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Select Sweden on map', exact: true })
    .click();
  await page.getByRole('button', { name: 'Debug', exact: true }).click();
  await page
    .getByLabel('Target nation', { exact: true })
    .selectOption('nation:fin');
  await page
    .getByRole('button', { name: 'Force territorial transfer', exact: true })
    .click();
  await expect(page.getByTestId('owner')).toHaveText('Finland');
  await expect(page.getByTestId('controller')).toHaveText('Finland');
  const world = (await (await page.request.get('/api/world')).json()).world;
  expect(
    world.commands
      .slice(-2)
      .map((entry: { command: { type: string } }) => entry.command.type)
      .sort(),
  ).toEqual(['TRANSFER_CONTROL', 'TRANSFER_OWNERSHIP']);
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
