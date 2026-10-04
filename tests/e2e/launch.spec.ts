import { expect, test } from '@playwright/test';

test('fresh player starts a Nordic campaign with a chosen country and can branch', async ({
  page,
}, info) => {
  await page.request.post('/api/experience', {
    data: { onboarded: false, developerMode: false },
  });
  await page.request.post('/api/settings', { data: { kind: 'fake' } });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Welcome to Mandate' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Debug', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Explore with demo rules' }).click();
  await page.getByRole('button', { name: /Nordic Crossroads/ }).click();
  await page.getByLabel('Find a country').fill('Finland');
  await page
    .locator('.country-list')
    .getByRole('button', { name: /Finland/ })
    .click();
  await expect(page.locator('.country-situation')).toContainText(
    'Starting priorities',
  );
  await page
    .getByRole('button', { name: 'Start playing as Finland', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your first cabinet briefing' }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('starting-briefing.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Enter the world' }).click();
  await expect(page.getByLabel('Playing as')).toHaveValue('nation:fin');
  await page
    .getByRole('button', { name: 'Branch timeline', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/world')).json()).world.ancestry,
    )
    .not.toBeNull();
  await page.reload();
  await expect(page.getByLabel('Turn duration')).toHaveValue('30');
  await expect(
    page.getByRole('heading', { name: 'Welcome to Mandate' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Continue', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Playing as')).toHaveValue('nation:fin');
});

test('unavailable model has recoverable setup and does not commit a turn', async ({
  page,
}) => {
  await page.request.post('/api/experience', {
    data: { onboarded: true, developerMode: false },
  });
  await page.request.post('/api/settings', {
    data: {
      kind: 'ollama',
      baseUrl: 'http://127.0.0.1:1',
      model: 'absent',
      timeoutMs: 1000,
      retries: 0,
    },
  });
  const current = await (await page.request.get('/api/world')).json();
  await page.request.post('/api/scenarios/load', {
    data: {
      expectedRevision: current.world.revision,
      expectedHash: current.hash,
      filename: 'northern-sandbox.json',
      nationId: 'nation:swe',
    },
  });
  await page.goto('/');
  const before = await (await page.request.get('/api/world')).json();
  await page
    .getByLabel('Sweden action composer', { exact: true })
    .fill('Invest in energy');
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await (await page.request.get('/api/world')).json()).hash).toBe(
    before.hash,
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Save & test model' }),
  ).toBeVisible();
  await page.request.post('/api/settings', { data: { kind: 'fake' } });
});

test('normal event reasons do not reveal a former country private directive after taking control elsewhere', async ({
  page,
}) => {
  await page.request.post('/api/experience', {
    data: { onboarded: true, developerMode: false },
  });
  await page.request.post('/api/settings', { data: { kind: 'fake' } });
  const current = await (await page.request.get('/api/world')).json();
  await page.request.post('/api/scenarios/load', {
    data: {
      expectedRevision: current.world.revision,
      expectedHash: current.hash,
      filename: 'nordic-strategy.json',
      nationId: 'nation:fin',
    },
  });
  await page.goto('/');
  await page
    .getByLabel('Finland action composer', { exact: true })
    .fill(
      'Quietly invest in nuclear energy. Publicly open voluntary security consultations with Sweden.',
    );
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/world')).json()).world.revision,
    )
    .toBeGreaterThan(0);
  await page.getByLabel('Playing as').selectOption('nation:swe');
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/world')).json()).world
          .playerNationId,
    )
    .toBe('nation:swe');
  const event = page
    .locator('.timeline .event')
    .filter({
      has: page.getByRole('heading', {
        name: 'Finland orders talk in a crisis',
        exact: true,
      }),
    })
    .first();
  await expect(event).toBeVisible();
  await event.getByText('Why did this happen?', { exact: true }).click();
  await expect(page.locator('.timeline')).not.toContainText('nuclear');
  await expect(event).toContainText('Independent government decision');
  await expect(
    page.getByText('Retrieved decision facts', { exact: true }),
  ).toHaveCount(0);
});
