import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/experience', {
    data: { onboarded: true, developerMode: false },
  });
  await page.request.post('/api/settings', { data: { kind: 'fake' } });
  const before = await (await page.request.get('/api/world')).json();
  const scenario = JSON.parse(
    readFileSync(resolve('data/scenarios/global-regional.json'), 'utf8'),
  );
  expect(
    (
      await page.request.post('/api/import', {
        data: {
          expectedRevision: before.world.revision,
          expectedHash: before.hash,
          save: { ...scenario, kind: 'save' },
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/');
  await expect(page.locator('[data-map-ready=true]')).toBeVisible();
  await expect(page.getByLabel('Playing as')).toHaveValue('nation:swe');
});
test('free-form regional demand creates a claim, crisis and visible history', async ({
  page,
}) => {
  await page
    .getByLabel('Sweden action composer', { exact: true })
    .fill('Demand Northern Ostrobothnia from Finland');
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2028-01-31');
  const report = await (await page.request.get('/api/turn-report')).json();
  expect(report.playerExecution.semanticAudit[0]).toMatchObject({
    status: 'ATTEMPTED',
    commandTypes: expect.arrayContaining(['ADD_CLAIM']),
  });
  const after = await (await page.request.get('/api/world')).json();
  const region = after.world.regions.find(
    (r: { name: string }) => r.name === 'Northern Ostrobothnia',
  );
  expect(region.ownerNationId).toBe('nation:fin');
  expect(region.claims).toContain('nation:swe');
  expect(
    after.world.crises.some((c: { participants: string[] }) =>
      c.participants.includes('nation:fin'),
    ),
  ).toBe(true);
  await expect(
    page.getByRole('heading', {
      name: /Sweden asserts a claim to Northern Ostrobothnia/i,
    }),
  ).toBeVisible();
});
test('an invasion headline names the opposing government instead of listing every region', async ({
  page,
}) => {
  await page
    .getByLabel('Sweden action composer', { exact: true })
    .fill('Invade Norway.');
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2028-01-31');

  const { world } = await (await page.request.get('/api/world')).json();
  expect(
    world.conflicts.some(
      (conflict: {
        status: string;
        attackers: string[];
        defenders: string[];
      }) =>
        conflict.status === 'active' &&
        conflict.attackers.includes('nation:swe') &&
        conflict.defenders.includes('nation:nor'),
    ),
  ).toBe(true);
  await expect(
    page.getByRole('heading', {
      name: 'Sweden launches an offensive against Norway',
      exact: true,
    }),
  ).toBeVisible();
});
test('conditional invasion remains deferred in the result and canonical save', async ({
  page,
}) => {
  await page
    .getByLabel('Sweden action composer', { exact: true })
    .fill('Demand Finland surrender. If they refuse, invade.');
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2028-01-31');
  const report = await (await page.request.get('/api/turn-report')).json();
  expect(
    report.playerExecution.semanticAudit.some(
      (a: { status: string }) => a.status === 'DEFERRED',
    ),
  ).toBe(true);
  const after = await (await page.request.get('/api/world')).json();
  expect(
    after.world.conflicts.filter((c: { attackers: string[] }) =>
      c.attackers.includes('nation:swe'),
    ),
  ).toHaveLength(0);
  expect(
    after.world.nations
      .find((n: { id: string }) => n.id === 'nation:swe')
      .strategy.directives.some(
        (d: { semanticPlan?: object }) => d.semanticPlan,
      ),
  ).toBe(true);
});
test('a government can release a grounded region as a persistent new polity', async ({
  page,
}) => {
  await page.getByLabel('Playing as').selectOption('nation:fin');
  await page
    .getByLabel('Finland action composer', { exact: true })
    .fill('Create an independent Lapland.');
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2028-01-31', {
    timeout: 15_000,
  });

  const { world } = await (await page.request.get('/api/world')).json();
  const lapland = world.nations.find(
    (nation: { name: string }) => nation.name === 'Lapland',
  );
  expect(lapland).toBeTruthy();
  expect(world.nations).toHaveLength(243);
  const region = world.regions.find(
    (candidate: { name: string }) => candidate.name === 'Lapland',
  );
  expect(region.ownerNationId).toBe(lapland.id);
  expect(region.controllerNationId).toBe(lapland.id);
  await expect(
    page.getByRole('heading', {
      name: 'Lapland declares independence from Finland',
      exact: true,
    }),
  ).toBeVisible();
});
test('a natural-language order can transfer a grounded region to another government', async ({
  page,
}) => {
  await page.getByLabel('Playing as').selectOption('nation:fin');
  await page
    .getByLabel('Finland action composer', { exact: true })
    .fill('Give Lapland to Norway.');
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2028-01-31');

  const { world } = await (await page.request.get('/api/world')).json();
  const lapland = world.regions.find(
    (region: { name: string }) => region.name === 'Lapland',
  );
  expect(lapland.ownerNationId).toBe('nation:nor');
  expect(lapland.controllerNationId).toBe('nation:nor');
  await expect(
    page.getByRole('heading', {
      name: 'Lapland is transferred to Norway',
      exact: true,
    }),
  ).toBeVisible();
});
