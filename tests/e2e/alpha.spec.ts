import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/experience', {
    data: { onboarded: true, developerMode: true },
  });
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
  await expect(page.locator('[data-map-ready=true]')).toBeVisible();
});
test('free-form compound directive, private diplomatic continuity and inspectable resolution', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page
    .getByLabel('DIRECTIVE / SWEDEN', { exact: true })
    .fill(
      'Begin a quiet diplomatic initiative with Finland and Norway aimed at closer defense cooperation. Do not propose a formal alliance yet. Increase military readiness without publicly announcing it.',
    );
  await page
    .getByRole('button', { name: 'Issue directive', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-08');
  const first = await (await page.request.get('/api/world')).json();
  expect(first.world.negotiations).toHaveLength(2);
  expect(first.world.treaties).toHaveLength(0);
  expect(
    first.world.initiatives.some(
      (i: { nationId: string; kind: string }) =>
        i.nationId === 'nation:swe' && i.kind === 'rearmament',
    ),
  ).toBe(true);
  await page.getByLabel('Inspect nation').selectOption('nation:fin');
  await page.getByRole('button', { name: 'Diplomacy', exact: true }).click();
  await expect(page.locator('.diplomatic-thread')).toContainText('PRIVATE');
  await expect(page.locator('.diplomatic-thread')).not.toContainText(
    'military readiness',
  );
  await page
    .getByRole('button', { name: 'Advance world', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-15');
  await expect(page.locator('.diplomatic-thread')).toContainText('ACCEPTED');
  await page.getByRole('button', { name: 'Events', exact: true }).click();
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
  await page
    .getByRole('button', { name: 'Advance world', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-08');
  const original = await (await page.request.get('/api/world')).json();
  await page
    .getByRole('button', { name: 'World & settings', exact: true })
    .click();
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
  await page
    .getByRole('button', { name: 'Advance world', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-15');
  await page
    .getByRole('button', { name: 'World & settings', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Rollback last turn', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-08');
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
test('global scenario loads 242 polities, thematic map and a multi-country player turn', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page
    .getByRole('button', { name: 'World & settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Scenario', exact: true }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'A World in Balance' })
    .getByRole('button', { name: 'Start scenario', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2028-01-01');
  await page
    .getByRole('button', { name: 'Close world settings', exact: true })
    .click();
  await expect(page.locator('[data-map-ready=true]')).toBeVisible();
  await page.getByLabel('Additional map modes').selectOption('economy');
  await page.getByLabel('Inspect nation').selectOption('nation:bra');
  await expect(
    page.getByRole('heading', { name: 'Brazil', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('DIRECTIVE / SWEDEN', { exact: true })
    .fill(
      'Begin a quiet diplomatic initiative with Finland and Norway. Do not propose a formal alliance yet. Invest in nuclear energy for five years.',
    );
  await page
    .getByRole('button', { name: 'Issue directive', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2028-01-08');
  const world = (await (await page.request.get('/api/world')).json()).world;
  expect(world.nations).toHaveLength(242);
  expect(
    world.negotiations.filter(
      (n: { proposerNationId: string }) => n.proposerNationId === 'nation:swe',
    ),
  ).toHaveLength(2);
  expect(
    world.initiatives.some(
      (i: { nationId: string; kind: string }) =>
        i.nationId === 'nation:swe' && i.kind === 'energy',
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('global-alpha.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('controlled recipient accepts a treaty through ordinary diplomacy controls', async ({
  page,
}) => {
  await page
    .getByLabel('DIRECTIVE / SWEDEN', { exact: true })
    .fill('Propose a reciprocal trade agreement with Finland.');
  await page
    .getByRole('button', { name: 'Issue directive', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-08');
  await page.getByLabel('Controlled country').selectOption('nation:fin');
  await expect(page.getByLabel('Controlled country')).toHaveValue('nation:fin');
  await page.getByLabel('Inspect nation').selectOption('nation:swe');
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
  await page.getByLabel('Inspect nation').selectOption('nation:swe');
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
  await page.getByLabel('Inspect nation').selectOption('nation:swe');
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
  await page
    .getByRole('button', { name: 'World & settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Scenario', exact: true }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Nordic Crossroads' })
    .getByRole('button', { name: 'Start scenario', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Close world settings', exact: true })
    .click();
  await page.getByLabel('Inspect nation').selectOption('nation:swe');
  await expect(page.locator('.inspector')).toContainText(
    'Reduce energy vulnerability',
  );
  await page
    .getByLabel('DIRECTIVE / SWEDEN', { exact: true })
    .fill(
      'Begin diplomacy with Finland: allow permanent Swedish military basing in Finland.',
    );
  await page
    .getByRole('button', { name: 'Issue directive', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-08');
  await page
    .getByRole('button', { name: 'Advance world', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-15');
  await page.getByLabel('Inspect nation').selectOption('nation:fin');
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

test('structured aid pledge can be negotiated and funded from ordinary game controls', async ({
  page,
}) => {
  await page.getByLabel('Inspect nation').selectOption('nation:fin');
  await page.getByRole('button', { name: 'Diplomacy', exact: true }).click();
  await page
    .getByLabel('Your proposal', { exact: true })
    .fill('Deliver a funded assistance project to Finland');
  await page.getByLabel('Include a funded aid pledge').check();
  await page.getByLabel('Promised investment').fill('4');
  await page.getByLabel('Delivery deadline').fill('2025-07-01');
  await page
    .getByRole('button', { name: 'Send diplomatic initiative', exact: true })
    .click();
  await expect(page.locator('.diplomatic-thread')).toContainText(
    'Funded aid pledge',
  );
  await page
    .getByRole('button', { name: 'Advance world', exact: true })
    .click();
  await expect(page.locator('.diplomatic-thread')).toContainText('ACCEPTED');
  await page.getByLabel('Inspect nation').selectOption('nation:swe');
  await page
    .getByRole('button', { name: 'Country Diplomacy', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Fund obligation delivery', exact: true })
    .click();
  const w = (await (await page.request.get('/api/world')).json()).world;
  expect(w.commitments[0].status).toBe('active');
  expect(w.initiatives.some((i: { kind: string }) => i.kind === 'aid')).toBe(
    true,
  );
  await page.reload();
  await expect(page.locator('[data-map-ready=true]')).toBeVisible();
  await page.getByLabel('Inspect nation').selectOption('nation:swe');
  await page
    .getByRole('button', { name: 'Country Diplomacy', exact: true })
    .click();
  await expect(page.locator('.inspector')).toContainText(
    'Deliver a funded assistance project to Finland',
  );
});

test('persistent crisis and independent multilateral consent from normal controls', async ({
  page,
}, info) => {
  const before = await (await page.request.get('/api/world')).json();
  const scenario = JSON.parse(
    readFileSync(resolve('data/scenarios/nordic-strategy.json'), 'utf8'),
  );
  const loaded = await page.request.post('/api/import', {
    data: {
      expectedRevision: before.world.revision,
      expectedHash: before.hash,
      save: { ...scenario, kind: 'save' },
    },
  });
  expect(loaded.ok()).toBe(true);
  await page.reload();
  await expect(page.locator('[data-map-ready=true]')).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Nordic security access dispute',
      exact: true,
    }),
  ).toBeVisible();
  const initial = await (await page.request.get('/api/world')).json();
  await page.getByRole('button', { name: 'talk', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/world')).json()).world.crises[0]
          .severity,
    )
    .toBeLessThan(initial.world.crises[0].severity);
  await page
    .getByLabel('Conference partners', { exact: true })
    .selectOption(['nation:fin', 'nation:nor']);
  await page
    .getByLabel('Conference terms', { exact: true })
    .fill(
      'Reciprocal intelligence cooperation without permanent foreign bases',
    );
  await page
    .getByRole('button', { name: 'Convene security talks', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Regional security conference',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'accept', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/world')).json()).world
          .conferences[0].responses.length,
    )
    .toBe(1);
  expect(
    (await (await page.request.get('/api/world')).json()).world.conferences[0]
      .status,
  ).toBe('open');
  for (const nation of ['nation:fin', 'nation:nor']) {
    await page.getByLabel('Controlled country').selectOption(nation);
    await expect(page.getByLabel('Controlled country')).toHaveValue(nation);
    await page.getByRole('button', { name: 'accept', exact: true }).click();
    await expect
      .poll(async () =>
        (
          await (await page.request.get('/api/world')).json()
        ).world.conferences[0].responses.some(
          (r: { nationId: string }) => r.nationId === nation,
        ),
      )
      .toBe(true);
  }
  const agreed = (await (await page.request.get('/api/world')).json()).world;
  expect(agreed.conferences[0].status).toBe('agreed');
  expect(
    agreed.organizations.some(
      (o: { name: string }) => o.name === 'Regional security conference',
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('crisis-conference.png'),
    fullPage: true,
  });
});

test('observer can advance, inspect, retake control and use the scoped advisor', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Observe world', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Issue directive', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Advance world', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-08');
  await page.getByLabel('Controlled country').selectOption('nation:fin');
  await expect(
    page.getByRole('button', { name: 'Observe world', exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get('/api/world')).json()).world.observerMode,
  ).toBe(false);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByText('Ask your strategic advisor', { exact: true }).click();
  await page
    .getByLabel('Strategic question', { exact: true })
    .selectOption('project-load');
  await page
    .getByRole('button', { name: 'Consult advisor', exact: true })
    .click();
  await expect(
    page.getByLabel('Advisor answer', { exact: true }),
  ).toContainText('Treasury');
});

test('economic coercion can be imposed and lifted through ordinary controls', async ({
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
  await page.getByLabel('Controlled country').selectOption('nation:rus');
  await expect(page.getByLabel('Controlled country')).toHaveValue('nation:rus');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page
    .getByLabel('Sanctions target', { exact: true })
    .selectOption('nation:fin');
  await page
    .getByLabel('Sanctions sector', { exact: true })
    .selectOption('energy');
  await page.getByLabel('Sanctions intensity', { exact: true }).fill('80');
  await page
    .getByLabel('Sanctions purpose', { exact: true })
    .fill('Pressure over regional military access');
  await page
    .getByRole('button', { name: 'Apply sanctions', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Lift sanctions', exact: true }),
  ).toBeVisible();
  const active = (await (await page.request.get('/api/world')).json()).world;
  expect(active.sanctions[0]).toMatchObject({
    issuer: 'nation:rus',
    target: 'nation:fin',
    sector: 'energy',
    intensity: 80,
    status: 'active',
  });
  await page.getByLabel('Turn duration', { exact: true }).selectOption('30');
  await page
    .getByRole('button', { name: 'Advance world', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-31');
  const adapted = (await (await page.request.get('/api/world')).json()).world;
  expect(
    adapted.economicLinks.find(
      (l: { dependentNationId: string; partnerNationId: string }) =>
        l.dependentNationId === 'nation:fin' &&
        l.partnerNationId === 'nation:rus',
    ).adaptation,
  ).toBeGreaterThan(0);
  await page
    .getByRole('button', { name: 'Lift sanctions', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Lift sanctions', exact: true }),
  ).toHaveCount(0);
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
    .getByLabel('DIRECTIVE / SWEDEN', { exact: true })
    .fill('Invest in domestic energy');
  await page
    .getByRole('button', { name: 'Issue directive', exact: true })
    .click();
  await expect(page.locator('time')).toHaveText('2025-01-08');
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
    .getByRole('button', { name: 'Compare meaning', exact: true })
    .click();
  await expect(
    page.locator('.depth-workspace .crisis-card').first(),
  ).toBeVisible();
  await expect(page.locator('.depth-workspace')).toContainText('initiatives');
});

test('country workspace separates strategy, economics, military, politics, projects and known history', async ({
  page,
}) => {
  await page.getByLabel('Inspect nation').selectOption('nation:swe');
  for (const [tab, heading] of [
    ['Strategy', 'Strategic goals'],
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
