import { it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorldStore, canonicalHash } from './index.js';
import { fixture, commitRequest, root } from '../../../tests/fixtures/world.js';
import type { StoreOptions } from './index.js';
const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);
const open = (filename: string, fault?: StoreOptions['fault']) =>
  openWorldStore({
    filename,
    migrationsDirectory: root + 'packages/persistence/migrations',
    ...(fault ? { fault } : {}),
  });
it.each([
  'before-transaction',
  'after-proposal',
  'during-validation',
  'during-transaction',
  'after-entities',
  'before-commit',
  'after-commit',
] as const)(
  'restart after injected %s exception yields entire before or after turn',
  (stage) => {
    const dir = mkdtempSync(join(tmpdir(), 'mandate-fault-'));
    dirs.push(dir);
    const filename = join(dir, 'world.sqlite');
    let armed = false;
    const store = open(filename, (current) => {
      if (armed && current === stage) throw new Error('Injected interruption');
    });
    const before = store.initialize(fixture()),
      hash = canonicalHash(before);
    armed = true;
    expect(() =>
      store.commit(
        commitRequest(before, [{ type: 'ADVANCE_DATE', date: '2025-02-01' }]),
      ),
    ).toThrow('Injected');
    store.close();
    const restarted = open(filename),
      w = restarted.load();
    expect(w.revision).toBe(stage === 'after-commit' ? 1 : 0);
    if (stage !== 'after-commit') expect(canonicalHash(w)).toBe(hash);
    else {
      expect(w.turns).toHaveLength(1);
      expect(w.commands).toHaveLength(1);
      expect(w.events.length).toBeGreaterThan(0);
    }
    restarted.close();
  },
);
it.each([
  'before-transaction',
  'after-entities',
  'before-commit',
  'after-commit',
] as const)('actual SIGKILL at %s leaves recoverable atomic world', (stage) => {
  const dir = mkdtempSync(join(tmpdir(), 'mandate-kill-'));
  dirs.push(dir);
  const filename = join(dir, 'world.sqlite');
  const store = open(filename),
    before = store.initialize(fixture()),
    hash = canonicalHash(before);
  store.close();
  const killed = spawnSync(
    process.execPath,
    ['--import', 'tsx', root + 'tools/crash-worker.ts', filename, stage],
    { cwd: root, timeout: 15000, encoding: 'utf8' },
  );
  expect(killed.signal).toBe('SIGKILL');
  const restarted = open(filename),
    w = restarted.load();
  expect(w.revision).toBe(stage === 'after-commit' ? 1 : 0);
  if (stage !== 'after-commit') expect(canonicalHash(w)).toBe(hash);
  else {
    expect(w.turns).toHaveLength(1);
    expect(w.commands).toHaveLength(1);
  }
  restarted.close();
});
