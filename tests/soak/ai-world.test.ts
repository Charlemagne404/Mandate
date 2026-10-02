import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalStringify, resolveTurn } from '@mandate/core';
import { CommitRequest } from '@mandate/schemas';
import { FakeProvider } from '../../packages/ai/src/index.js';
import { runAutoplay } from '../../tools/ai-harness.js';
import { context, fixture } from '../fixtures/world.js';

it('100 autonomous fake-provider turns preserve goals, bounded state and scheduler fairness', async () => {
  let world = fixture();
  const result = await runAutoplay({
    world,
    provider: new FakeProvider(),
    turns: 100,
    hash: (w) =>
      createHash('sha256').update(canonicalStringify(w)).digest('hex'),
    commit: (input) => {
      const { expectedHash: _hash, ...request } = CommitRequest.parse(input);
      void _hash;
      world = resolveTurn(world, request, context(world.revision + 1));
      return world;
    },
  });
  expect(result.metrics.turns).toBe(100);
  expect(result.metrics.activatedActors).toBe(world.nations.length);
  expect(result.metrics.maxPlanningGap).toBeLessThanOrEqual(
    world.nations.length,
  );
  expect(result.metrics.goalsPreserved).toBe(world.goals.length);
  expect(result.metrics.modelFailures).toBe(0);
  expect(result.metrics.invariantFailures).toBe(0);
  expect(result.metrics.autonomousEvents).toBeGreaterThan(0);
  expect(result.metrics.initiativesStarted).toBeGreaterThan(0);
  expect(result.metrics.maxContextCharacters).toBeLessThanOrEqual(24000);
  expect(result.world.actions.every((a) => a.source === 'system')).toBe(true);
}, 120000);
