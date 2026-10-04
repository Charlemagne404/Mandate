import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('production bundle survives actual server termination/restart and renders without external services', async ({
  page,
}, info) => {
  const directory = mkdtempSync(join(tmpdir(), 'mandate-production-'));
  let child: ChildProcess | null = null;
  let logs = '';
  const start = async () => {
    child = spawn(process.execPath, [resolve('apps/server/dist/main.js')], {
      env: {
        ...process.env,
        PORT: '3126',
        MANDATE_DB: join(directory, 'world.sqlite'),
        MANDATE_SCENARIO: 'northern-sandbox.json',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (data: Buffer) => {
        logs = (logs + data.toString()).slice(-20000);
      });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(logs);
      try {
        const response = await fetch('http://127.0.0.1:3126/api/health');
        if (response.ok) return;
      } catch {
        /* wait for the listener */
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Production server did not become ready: ' + logs);
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) =>
      child!.once('exit', () => resolve()),
    );
    child.kill('SIGTERM');
    await exited;
    child = null;
  };
  try {
    await start();
    await fetch('http://127.0.0.1:3126/api/experience', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboarded: true }),
    });
    const before = await (
      await fetch('http://127.0.0.1:3126/api/world')
    ).json();
    const committed = await fetch('http://127.0.0.1:3126/api/turns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: before.world.revision,
        expectedHash: before.hash,
        action: {
          actorNationId: 'nation:swe',
          source: 'debug',
          text: 'Production restart proof',
        },
        commands: [
          {
            id: 'command:production-proof',
            reason: 'Check persisted occupation',
            command: {
              type: 'TRANSFER_CONTROL',
              regionId: 'region:ne-fin',
              nationId: 'nation:rus',
            },
          },
        ],
      }),
    });
    expect(committed.ok).toBe(true);
    const after = await committed.json();
    await stop();
    await start();
    const reopened = await (
      await fetch('http://127.0.0.1:3126/api/world')
    ).json();
    expect(reopened.hash).toBe(after.hash);
    expect(reopened.world.revision).toBe(1);
    const external: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === 'http://127.0.0.1:3126')
        return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    await page.goto('http://127.0.0.1:3126/');
    await expect(page.locator('[data-map-ready=true]')).toBeVisible();
    await page.getByLabel('Playing as').selectOption('nation:fin');
    const map = page.locator('.map-canvas');
    const bounds = await map.boundingBox();
    expect(bounds).not.toBeNull();
    await page.waitForTimeout(700);
    await map.click({
      position: { x: bounds!.width / 2, y: bounds!.height / 2 },
    });
    await expect(page.getByTestId('controller')).toHaveText('Russia');
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page.screenshot({
      path: info.outputPath('production-offline.png'),
      fullPage: true,
    });
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
