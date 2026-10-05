import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/experience', {
    data: { onboarded: true, developerMode: true },
  });
  await page.request.post('/api/settings', { data: { kind: 'fake' } });
  const before = await (await page.request.get('/api/world')).json();
  const scenario = JSON.parse(
    readFileSync(resolve('data/scenarios/northern-sandbox.json'), 'utf8'),
  ) as object;
  const imported = await page.request.post('/api/import', {
    data: {
      expectedRevision: before.world.revision,
      expectedHash: before.hash,
      save: { ...scenario, kind: 'save' },
    },
  });
  expect(imported.ok()).toBe(true);
  await page.goto('/');
  await expect(page.locator('[data-map-ready=true]')).toBeVisible({
    timeout: 15_000,
  });
});
test('free-form compound directive, private diplomatic continuity and inspectable resolution', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page
    .getByLabel('Sweden action composer', { exact: true })
    .fill(
      'Begin a quiet diplomatic initiative with Finland and Norway aimed at closer defense cooperation. Do not propose a formal alliance yet. Increase military readiness without publicly announcing it.',
    );
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2025-01-31');
  const first = await (await page.request.get('/api/world')).json();
  expect(first.world.negotiations).toHaveLength(2);
  expect(first.world.treaties).toHaveLength(0);
  expect(
    first.world.initiatives.some(
      (i: { nationId: string; kind: string }) =>
        i.nationId === 'nation:swe' && i.kind === 'rearmament',
    ),
  ).toBe(true);
  await page.getByLabel('Playing as').selectOption('nation:fin');
  await page.getByRole('button', { name: 'Diplomacy', exact: true }).click();
  const finlandThread = page
    .locator('.diplomatic-thread')
    .filter({ hasText: 'Sweden → Finland' });
  await expect(finlandThread).toHaveCount(1);
  await expect(finlandThread).toContainText('PRIVATE');
  await expect(finlandThread).not.toContainText('military readiness');
  await page.getByRole('button', { name: 'Advance turn', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2025-03-02');
  await expect(page.locator('.diplomatic-thread')).toContainText('ACCEPTED');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByText('Why did this happen?', { exact: true }).first().click();
  await page
    .getByText('Government plans, context & model records', { exact: true })
    .first()
    .click();
  await expect(page.locator('.causal-chain').first()).toContainText(
    'Deterministic checks',
  );
  await expect(page.locator('.causal-chain').first()).toContainText(
    'world invariants passed',
  );
  expect(
    (await (await page.request.get('/api/world')).json()).world.treaties,
  ).toHaveLength(0);
  await page.screenshot({
    path: info.outputPath('compound-diplomacy.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test('named save, actual rollback, branch ancestry and restart of a chosen history', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Advance turn', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2025-01-31');
  const original = await (await page.request.get('/api/world')).json();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const name = 'Branch proof ' + Date.now();
  await page.getByLabel('Save name').fill(name);
  await page
    .getByRole('button', { name: 'Save timeline', exact: true })
    .click();
  await expect(
    page.locator('.snapshot-list article').filter({ hasText: name }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Close world settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Advance turn', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2025-03-02');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('button', { name: 'Rollback last turn', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-31');
  expect((await (await page.request.get('/api/world')).json()).hash).toBe(
    original.hash,
  );
  await page
    .locator('.snapshot-list article')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Branch', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/world')).json()).world.saveId,
    )
    .not.toBe(original.world.saveId);
  const branch = await (await page.request.get('/api/world')).json();
  expect(branch.world.ancestry.parentSaveId).toBe(original.world.saveId);
  await page
    .getByRole('button', { name: 'Close world settings', exact: true })
    .click();
  await page.reload();
  await expect(page.locator('[data-map-ready=true]')).toBeVisible();
  expect((await (await page.request.get('/api/world')).json()).hash).toBe(
    branch.hash,
  );
});
test('regional world library loads 242 polities and a one-month player turn', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Scenario', exact: true }).click();
  const regionalScenario = page
    .locator('.scenario-card')
    .filter({ hasText: '4595 regions' });
  await expect(regionalScenario).toContainText('Recommended:');
  await expect(regionalScenario).toContainText('Situation:');
  await regionalScenario
    .getByRole('button', { name: 'Start scenario', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2028-01-01');
  await page
    .getByRole('button', { name: 'Close world settings', exact: true })
    .click();
  await expect(page.locator('[data-map-ready=true]')).toBeVisible();
  await page.getByLabel('More map modes').selectOption('economy');
  await page.getByLabel('Playing as').selectOption('nation:bra');
  await expect(page.getByLabel('Brazil action composer')).toBeVisible();
  await page
    .getByLabel('Brazil action composer', { exact: true })
    .fill('Invest in nuclear energy for five years.');
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2028-01-31', {
    timeout: 90_000,
  });
  const world = (await (await page.request.get('/api/world')).json()).world;
  expect(world.nations).toHaveLength(242);
  expect(world.regions).toHaveLength(4595);
  expect(
    world.initiatives.some(
      (i: { nationId: string; kind: string }) =>
        i.nationId === 'nation:bra' && i.kind === 'energy',
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('global-alpha.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('dynamic organizations show their charter and clickable invitation recipients', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Scenario', exact: true }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: '4595 regions' })
    .getByRole('button', { name: 'Start scenario', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2028-01-01');
  await page
    .getByRole('button', { name: 'Close world settings', exact: true })
    .click();
  await page.getByLabel('Playing as').selectOption('nation:nic');
  await page
    .getByLabel('Nicaragua action composer', { exact: true })
    .fill(
      'Nicaragua forms the CAEU (Central american economic union) and invites all countries in central america. The economic union focuses on increased economic integration between the central american countries. Nicaragua is prepared to subsidize and support any country that joins economically.',
    );
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2028-01-31', {
    timeout: 90_000,
  });
  await page
    .getByRole('button', { name: 'Organizations', exact: true })
    .click();
  const card = page
    .locator('.organization-card')
    .filter({ hasText: 'Central American Economic Union' });
  await expect(card).toContainText('CAEU');
  await expect(card).toContainText('increased economic integration');
  await expect(card).toContainText('Pending invitations');
  await expect(card).toContainText('Terms and commitments');
  await expect(card).toContainText('Next payment:');
  await expect(
    card.getByRole('button', { name: 'Belize', exact: true }),
  ).toBeVisible();
  const belize = card.getByRole('button', { name: 'Belize', exact: true });
  await belize.click();
  await expect(belize).toHaveClass(/selected/);
  await expect(page.getByLabel('Playing as')).toHaveValue('nation:nic');
});

test('controlled recipient accepts a treaty through ordinary diplomacy controls', async ({
  page,
}) => {
  await page
    .getByLabel('Sweden action composer', { exact: true })
    .fill('Propose a reciprocal trade agreement with Finland.');
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2025-01-31');
  await page.getByLabel('Playing as').selectOption('nation:fin');
  await expect(page.getByLabel('Playing as')).toHaveValue('nation:fin');
  await page.getByRole('button', { name: 'Diplomacy', exact: true }).click();
  await page.getByRole('button', { name: 'accept', exact: true }).click();
  await expect(page.locator('.diplomatic-thread')).toContainText('ACCEPTED');
  const world = (await (await page.request.get('/api/world')).json()).world;
  expect(world.treaties).toHaveLength(1);
  const turn = world.turns.find(
    (t: { revision: number }) => t.revision === world.revision,
  );
  expect(
    world.actions.find((a: { id: string }) => a.id === turn.actionId),
  ).toMatchObject({ source: 'player', actorNationId: 'nation:fin' });
});

test('persistent strategic directive survives reload and can be cancelled', async ({
  page,
}) => {
  await page.getByLabel('Playing as').selectOption('nation:swe');
  await page.getByRole('button', { name: 'Country', exact: true }).click();
  await page
    .getByRole('button', { name: 'Country Strategy', exact: true })
    .click();
  await page
    .getByLabel('Persistent directive', { exact: true })
    .fill('Maintain neutrality and prioritize Nordic energy independence');
  await page
    .getByRole('button', { name: 'Set directive', exact: true })
    .click();
  await expect(page.locator('.inspector')).toContainText(
    'Maintain neutrality and prioritize Nordic energy independence',
  );
  await page.reload();
  await expect(page.locator('[data-map-ready=true]')).toBeVisible();
  await page.getByLabel('Playing as').selectOption('nation:swe');
  await page.getByRole('button', { name: 'Country', exact: true }).click();
  await page
    .getByRole('button', { name: 'Country Strategy', exact: true })
    .click();
  await expect(page.locator('.inspector')).toContainText(
    'Maintain neutrality and prioritize Nordic energy independence',
  );
  await page
    .getByRole('button', { name: 'Cancel directive', exact: true })
    .click();
  await expect(page.locator('.inspector')).toContainText('cancelled · private');
});
test('Nordic scenario reveals goal evidence, fiscal constraints and neutral basing counteroffer', async ({
  page,
}, info) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Scenario', exact: true }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Nordic Crossroads' })
    .getByRole('button', { name: 'Start scenario', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Close world settings', exact: true })
    .click();
  await page.getByLabel('Playing as').selectOption('nation:swe');
  await page.getByRole('button', { name: 'Country', exact: true }).click();
  await expect(page.locator('.inspector')).toContainText(
    'Reduce energy vulnerability',
  );
  await page
    .getByLabel('Sweden action composer', { exact: true })
    .fill(
      'Begin diplomacy with Finland: allow permanent Swedish military basing in Finland.',
    );
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2025-01-31');
  await page.getByRole('button', { name: 'Advance turn', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2025-03-02');
  await page.getByLabel('Playing as').selectOption('nation:fin');
  await page.getByRole('button', { name: 'Diplomacy', exact: true }).click();
  await expect(page.locator('.diplomatic-thread')).toContainText(
    'Intelligence cooperation without permanent foreign basing',
  );
  const w = (await (await page.request.get('/api/world')).json()).world;
  expect(w.treaties.some((t: { kind: string }) => t.kind === 'defense')).toBe(
    false,
  );
  await page.screenshot({
    path: info.outputPath('nordic-bargaining.png'),
    fullPage: true,
  });
});

test('selected country opens direct free-form diplomacy with persistent terms', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Country', exact: true }).click();
  await page
    .getByRole('button', { name: 'Country Diplomacy', exact: true })
    .click();
  await page
    .locator('.relation-row')
    .getByRole('button', { name: 'Finland', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Finland', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Open direct diplomacy', exact: true })
    .click();
  await page
    .getByLabel('Your proposal', { exact: true })
    .fill(
      'We will guarantee Finland’s independence if Finland permits Swedish aircraft to use its bases.',
    );
  await page
    .getByRole('button', { name: 'Send diplomatic initiative', exact: true })
    .click();
  await expect(page.locator('.diplomatic-thread')).toContainText('OPEN');
  await expect(page.locator('.diplomatic-thread')).toContainText(
    'guarantee Finland',
  );
  const w = (await (await page.request.get('/api/world')).json()).world;
  expect(
    w.negotiations.some(
      (n: { proposerNationId: string; recipientNationId: string }) =>
        n.proposerNationId === 'nation:swe' &&
        n.recipientNationId === 'nation:fin',
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator('[data-map-ready=true]')).toBeVisible();
  await page.getByRole('button', { name: 'Diplomacy', exact: true }).click();
  await expect(page.locator('.diplomatic-thread')).toContainText(
    'guarantee Finland',
  );
});

test('free-form multilateral proposal opens a separate diplomatic channel for each government', async ({
  page,
}, info) => {
  await page
    .getByLabel('Sweden action composer', { exact: true })
    .fill('Offer Finland and Norway a three-way military alliance.');
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2025-01-31');
  const world = (await (await page.request.get('/api/world')).json()).world;
  const offers = world.negotiations.filter(
    (n: { proposerNationId: string }) => n.proposerNationId === 'nation:swe',
  );
  expect(offers).toHaveLength(2);
  expect(offers.every((n: { status: string }) => n.status === 'open')).toBe(
    true,
  );
  await page.getByLabel('Playing as').selectOption('nation:fin');
  await page.getByRole('button', { name: 'Diplomacy', exact: true }).click();
  await expect(page.locator('.diplomatic-thread')).toContainText('OPEN');
  await page.getByRole('button', { name: 'accept', exact: true }).click();
  await expect(page.locator('.diplomatic-thread')).toContainText('ACCEPTED');
  const after = (await (await page.request.get('/api/world')).json()).world;
  expect(
    after.negotiations.filter(
      (n: { proposerNationId: string; recipientNationId: string }) =>
        n.proposerNationId === 'nation:swe' &&
        n.recipientNationId === 'nation:fin',
    )[0].status,
  ).toBe('accepted');
  expect(
    after.negotiations.filter(
      (n: { proposerNationId: string; recipientNationId: string }) =>
        n.proposerNationId === 'nation:swe' &&
        n.recipientNationId === 'nation:nor',
    )[0].status,
  ).toBe('open');
  await page.screenshot({
    path: info.outputPath('multilateral-diplomacy.png'),
    fullPage: true,
  });
});

test('observer can play, pause, step and take control without restarting history', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Observe', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Issue order', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Pause', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2025-01-31');
  const saveId = (await (await page.request.get('/api/world')).json()).world
    .saveId;
  await page.getByLabel('Take control as').selectOption('nation:fin');
  await expect(page.getByLabel('Playing as')).toHaveValue('nation:fin');
  expect(
    (await (await page.request.get('/api/world')).json()).world.observerMode,
  ).toBe(false);
  expect(
    (await (await page.request.get('/api/world')).json()).world.saveId,
  ).toBe(saveId);
});

test('free-form sanctions can be imposed, evolve and be lifted through consequences', async ({
  page,
}) => {
  const before = await (await page.request.get('/api/world')).json();
  const scenario = JSON.parse(
    readFileSync(resolve('data/scenarios/nordic-strategy.json'), 'utf8'),
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
  await page.reload();
  await expect(page.locator('[data-map-ready=true]')).toBeVisible();
  await page.getByLabel('Playing as').selectOption('nation:rus');
  await expect(page.getByLabel('Playing as')).toHaveValue('nation:rus');
  await page
    .getByLabel('Russia action composer', { exact: true })
    .fill('Sanction Finland on energy over regional military access.');
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  const active = (await (await page.request.get('/api/world')).json()).world;
  expect(active.sanctions[0]).toMatchObject({
    issuer: 'nation:rus',
    target: 'nation:fin',
    sector: 'energy',
    status: 'active',
  });
  await expect(page.locator('time')).toHaveText('2025-01-31');
  await page
    .getByLabel('Russia action composer', { exact: true })
    .fill('Lift the energy sanctions on Finland.');
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  const lifted = (await (await page.request.get('/api/world')).json()).world;
  expect(lifted.sanctions[0].status).toBe('lifted');
});

test('semantic timeline comparison renders capacity and projects across saved points', async ({
  page,
}) => {
  const before = await (await page.request.get('/api/world')).json();
  const saved = await (
    await page.request.post('/api/timelines', {
      data: {
        expectedRevision: before.world.revision,
        expectedHash: before.hash,
        name: 'Comparison baseline',
      },
    })
  ).json();
  await page
    .getByLabel('Sweden action composer', { exact: true })
    .fill('Invest in domestic energy');
  await page.getByRole('button', { name: 'Issue order', exact: true }).click();
  await expect(page.locator('time')).toHaveText('2025-01-31');
  const after = await (await page.request.get('/api/world')).json();
  const later = await (
    await page.request.post('/api/timelines', {
      data: {
        expectedRevision: after.world.revision,
        expectedHash: after.hash,
        name: 'Energy path',
      },
    })
  ).json();
  await page.getByRole('button', { name: 'Branches', exact: true }).click();
  await page.getByLabel('Timeline A', { exact: true }).selectOption(saved.id);
  await page.getByLabel('Timeline B', { exact: true }).selectOption(later.id);
  await page
    .getByRole('button', { name: 'Compare branches', exact: true })
    .click();
  await expect(
    page.locator('.depth-workspace .crisis-card').first(),
  ).toBeVisible();
  await expect(page.locator('.depth-workspace')).toContainText(
    'Invest in domestic energy',
  );
});

test('country workspace separates strategy, economics, military, politics, projects and known history', async ({
  page,
}) => {
  await page.getByLabel('Playing as').selectOption('nation:swe');
  await page.getByRole('button', { name: 'Country', exact: true }).click();
  for (const [tab, heading] of [
    ['Strategy', 'Government strategy'],
    ['Economy', 'Economic dependencies'],
    ['Military', 'Current conflicts'],
    ['Domestic', 'Government tenure'],
    ['Projects', 'National initiatives'],
    ['History', 'National history'],
    ['Diplomacy', 'Promises & obligations'],
  ] as const) {
    await page
      .getByRole('button', { name: `Country ${tab}`, exact: true })
      .click();
    await expect(
      page
        .locator('.inspector')
        .getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole('button', { name: 'Country Overview', exact: true })
    .click();
  await expect(
    page
      .locator('.inspector')
      .getByRole('heading', { name: 'Current priorities' }),
  ).toBeVisible();
  await expect(
    page
      .locator('.inspector')
      .getByRole('heading', { name: 'National initiatives' }),
  ).not.toBeVisible();
});
