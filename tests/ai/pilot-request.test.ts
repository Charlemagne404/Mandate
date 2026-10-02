import { it, expect } from 'vitest';
import { fixture } from '../fixtures/world.js';
import { pilotRequest, pilotContext } from '../../tools/pilot-request.js';
import { resolveTurn } from '@mandate/core';

it('real playtest requests normalize phase IDs and strip commit-only fields before deterministic trial validation', () => {
  const w = fixture();
  const { expectedHash, ...trial } = pilotRequest(w, w.playerNationId, 'A', []);
  expect(expectedHash).toHaveLength(64);
  expect(trial.commands[0]!.id).toBe('command:a-0-0');
  expect(resolveTurn(w, trial, pilotContext('A', 0)).revision).toBe(1);
  expect(() =>
    resolveTurn(w, { ...trial, expectedHash }, pilotContext('A', 0)),
  ).toThrow();
  expect(w.revision).toBe(0);
});
