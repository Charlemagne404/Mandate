import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../', import.meta.url));
const requireDesktop = createRequire(
  resolve(root, 'apps/desktop/package.json'),
);
const packagedExecutable =
  process.argv.indexOf('--executable') >= 0
    ? process.argv[process.argv.indexOf('--executable') + 1]
    : undefined;
const executablePath =
  packagedExecutable ?? (requireDesktop('electron') as string);
const userData = mkdtempSync(join(tmpdir(), 'mandate-electron-smoke-'));
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined,
  ),
) as Record<string, string>;
const appPath =
  process.argv.indexOf('--app') >= 0
    ? process.argv[process.argv.indexOf('--app') + 1]!
    : resolve(root, 'apps/desktop');
const launch = () =>
  _electron.launch({
    executablePath,
    args: packagedExecutable ? [] : [appPath],
    env: {
      ...environment,
      MANDATE_USER_DATA: userData,
      MANDATE_DESKTOP_SMOKE: '1',
    },
    timeout: 45_000,
  });
let desktop: Awaited<ReturnType<typeof launch>> | undefined;
const diagnostics: string[] = [];
const stalledInference = createServer((_request, response) => {
  if (_request.url?.endsWith('/models')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'interruption-test' }] }));
  } else stalledInference.emit('planning-request');
});
try {
  desktop = await launch();
  desktop
    .process()
    .stderr?.on('data', (data: Buffer) => diagnostics.push(data.toString()));
  const window = await desktop.firstWindow();
  window.on('pageerror', (error) => diagnostics.push(error.message));
  window.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(message.text());
  });
  await window.waitForFunction(
    () => Boolean(document.querySelector('canvas')),
    { timeout: 30_000 },
  );
  await window.getByRole('heading', { name: 'Welcome to Mandate' }).waitFor();
  assert.equal(
    await window.getByRole('button', { name: 'Debug', exact: true }).count(),
    0,
  );
  const firstOrigin = new URL(window.url()).origin;
  const scenarios = (await (
    await fetch(firstOrigin + '/api/scenarios')
  ).json()) as { filename: string }[];
  assert(scenarios.some((s) => s.filename === 'nordic-strategy.json'));
  const versions = await desktop.evaluate(() => ({
    electron: process.versions.electron,
    node: process.versions.node,
    sqlite: process.versions.sqlite,
  }));
  const isolation = await window.evaluate(() => ({
    node: typeof (globalThis as unknown as { require?: unknown }).require,
    desktop: typeof (globalThis as unknown as { mandateDesktop?: unknown })
      .mandateDesktop,
  }));
  assert.equal(isolation.node, 'undefined');
  assert.equal(isolation.desktop, 'object');
  const preferences = await window.evaluate(() =>
    (
      globalThis as unknown as {
        mandateDesktop: {
          configuration(): Promise<{
            sandboxed: boolean;
            contextIsolated: boolean;
          }>;
        };
      }
    ).mandateDesktop.configuration(),
  );
  assert.equal(preferences.sandboxed, true);
  assert.equal(preferences.contextIsolated, true);
  const origin = new URL(window.url()).origin;
  const before = (await (await fetch(origin + '/api/world')).json()) as {
    world: { revision: number; playerNationId: string };
    hash: string;
  };
  assert.equal(before.world.revision, 0);
  const request = {
    expectedRevision: before.world.revision,
    expectedHash: before.hash,
    action: {
      source: 'debug',
      actorNationId: before.world.playerNationId,
      text: 'Electron SQLite transactional smoke',
    },
    commands: [
      {
        id: 'command:electron-smoke',
        reason: 'Prove real Electron persistence',
        command: {
          type: 'ADJUST_NATION_STAT',
          nationId: before.world.playerNationId,
          stat: 'economy',
          delta: 1,
        },
      },
    ],
  };
  const commit = await fetch(origin + '/api/turns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(request),
  });
  assert.equal(commit.status, 200, await commit.text());
  const after = (await (
    await fetch(origin + '/api/world')
  ).json()) as typeof before;
  assert.equal(after.world.revision, 1);
  const stale = await fetch(origin + '/api/turns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(request),
  });
  assert.equal(stale.status, 409);
  const forbidden = await fetch(origin + '/api/world', {
    headers: { Origin: 'https://example.com' },
  });
  assert.equal(forbidden.status, 403);
  const snapshot: unknown = await (await fetch(origin + '/api/export')).json();
  const fixtureLoad = await fetch(origin + '/api/scenarios/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      expectedRevision: after.world.revision,
      expectedHash: after.hash,
      filename: 'northern-sandbox.json',
    }),
  });
  assert.equal(fixtureLoad.status, 200, await fixtureLoad.clone().text());
  const fixture = (await fixtureLoad.json()) as typeof before;
  const olderGeography = (await (
    await fetch(origin + '/api/geography')
  ).json()) as { features: unknown[] };
  assert.equal(olderGeography.features.length, 177);
  const restore = await fetch(origin + '/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      expectedRevision: fixture.world.revision,
      expectedHash: fixture.hash,
      save: snapshot,
    }),
  });
  assert.equal(restore.status, 200, await restore.clone().text());
  const newerGeography = (await (
    await fetch(origin + '/api/geography')
  ).json()) as { features: unknown[] };
  assert.equal(newerGeography.features.length, 4595);
  assert.equal(((await restore.json()) as typeof before).hash, after.hash);
  await window.reload();
  await window.locator('[data-map-ready="true"]').waitFor({ timeout: 30_000 });
  mkdirSync(resolve(root, 'output/playwright'), { recursive: true });
  await window.screenshot({
    path: resolve(root, 'output/playwright/desktop-alpha.png'),
  });
  await desktop.close();
  desktop = undefined;
  desktop = await launch();
  const reopened = await desktop.firstWindow();
  await reopened.waitForFunction(
    () => Boolean(document.querySelector('canvas')),
    { timeout: 30_000 },
  );
  const restored = (await (
    await fetch(new URL(reopened.url()).origin + '/api/world')
  ).json()) as typeof before;
  assert.equal(restored.hash, after.hash);
  assert.equal(restored.world.revision, 1);
  // A stalled transport is deliberately fake: this tests actual process death, not intelligence.
  stalledInference.listen(0, '127.0.0.1');
  await once(stalledInference, 'listening');
  const address = stalledInference.address();
  assert(address && typeof address !== 'string');
  const reopenedOrigin = new URL(reopened.url()).origin;
  const configured = await fetch(reopenedOrigin + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: reopenedOrigin },
    body: JSON.stringify({
      kind: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: 'interruption-test',
      timeoutMs: 60000,
    }),
  });
  assert.equal(configured.status, 200, await configured.text());
  const planning = once(stalledInference, 'planning-request', {
    signal: AbortSignal.timeout(30000),
  });
  const interrupted = fetch(reopenedOrigin + '/api/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: reopenedOrigin },
    body: JSON.stringify({
      expectedRevision: restored.world.revision,
      expectedHash: restored.hash,
      text: '',
      days: 30,
    }),
  }).catch(() => null);
  await planning;
  const terminated = once(desktop.process(), 'exit');
  desktop.process().kill('SIGKILL');
  await terminated;
  await interrupted;
  desktop = undefined;
  desktop = await launch();
  const recoveredWindow = await desktop.firstWindow();
  await recoveredWindow.waitForFunction(
    () => Boolean(document.querySelector('canvas')),
    { timeout: 30000 },
  );
  const recovered = (await (
    await fetch(new URL(recoveredWindow.url()).origin + '/api/world')
  ).json()) as typeof before;
  assert.equal(recovered.hash, restored.hash);
  assert.equal(recovered.world.revision, restored.world.revision);
  const semanticOrigin = new URL(recoveredWindow.url()).origin;
  await fetch(semanticOrigin + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: semanticOrigin },
    body: JSON.stringify({ kind: 'fake' }),
  });
  const semanticResponse = await fetch(semanticOrigin + '/api/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: semanticOrigin },
    body: JSON.stringify({
      expectedRevision: recovered.world.revision,
      expectedHash: recovered.hash,
      text: 'Offer them a defensive pact. If they refuse, mobilize.',
      grounding: { selectedNationId: 'nation:fin' },
      days: 7,
    }),
  });
  assert.equal(
    semanticResponse.status,
    200,
    await semanticResponse.clone().text(),
  );
  const semanticWorld = (await semanticResponse.json()) as {
    world: {
      actions: {
        semanticGraph?: { rawInput: string; references: { origin: string }[] };
      }[];
      nations: {
        id: string;
        strategy: { directives: { semanticPlan?: unknown }[] };
      }[];
    };
    hash: string;
  };
  assert(
    semanticWorld.world.actions
      .find(
        (a) =>
          a.semanticGraph?.rawInput ===
          'Offer them a defensive pact. If they refuse, mobilize.',
      )
      ?.semanticGraph?.references.some((r) => r.origin === 'map'),
    'The recorded player action must retain its map reference even when foreign responses follow it.',
  );
  assert(
    semanticWorld.world.nations
      .find((n) => n.id === recovered.world.playerNationId)
      ?.strategy.directives.some((d) => d.semanticPlan),
    'A conditional plan must be stored before checking restart continuity.',
  );
  await desktop.close();
  desktop = await launch();
  const semanticRestart = await desktop.firstWindow();
  const semanticRestored = (await (
    await fetch(new URL(semanticRestart.url()).origin + '/api/world')
  ).json()) as { hash: string };
  assert.equal(semanticRestored.hash, semanticWorld.hash);
  const log = readFileSync(join(userData, 'logs/desktop.log'), 'utf8');
  assert.match(log, /SQLite persistence active/);
  console.log(
    JSON.stringify({
      versions,
      isolation,
      firstLaunchWizard: true,
      developerControlsHidden: true,
      nordicScenarioBundled: true,
      transactionCommitted: true,
      staleWriteRejected: true,
      foreignOriginRejected: true,
      restartHashPreserved: true,
      versionedGeographyPreserved: true,
      processKilledDuringInference: true,
      interruptedTurnRolledBack: true,
      semanticGraphAndMapGroundingPersisted: true,
      conditionalPlanSurvivedNativeRestart: true,
      app: packagedExecutable ?? appPath,
    }),
  );
} catch (error) {
  console.error(diagnostics.slice(-20).join('\n'));
  const page = desktop?.windows()[0];
  if (page && !page.isClosed()) {
    console.error((await page.locator('body').innerText()).slice(0, 2000));
    mkdirSync(resolve(root, 'output/playwright'), { recursive: true });
    await page
      .screenshot({
        path: resolve(root, 'output/playwright/desktop-failure.png'),
      })
      .catch(() => {});
  }
  throw error;
} finally {
  await desktop?.close();
  stalledInference.closeAllConnections();
  stalledInference.close();
  rmSync(userData, { recursive: true, force: true });
}
