import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalStringify } from '@mandate/core';
import { loadScenario } from '@mandate/scenarios';
import { ActionId, TurnId, TurnRequest } from '@mandate/schemas';
import type { WorldState } from '@mandate/schemas';
export const root = fileURLToPath(new URL('../../', import.meta.url));
export const fixture = () =>
  loadScenario(root + 'data/scenarios/northern-sandbox.json');
export const context = (revision: number) => ({
  turnId: TurnId.parse(`turn:test-${revision}`),
  actionId: ActionId.parse(`action:test-${revision}`),
  recordedAt: '2026-10-01T00:00:00.000Z',
});
export function request(world: WorldState, commands: unknown[]) {
  return TurnRequest.parse({
    expectedRevision: world.revision,
    action: {
      actorNationId: world.playerNationId,
      source: 'debug',
      text: 'Fixture directive',
    },
    commands: commands.map((command, index) => ({
      id: `command:test-${world.revision + 1}-${index}`,
      reason: 'Deterministic test',
      command,
    })),
  });
}
export function commitRequest(world: WorldState, commands: unknown[]) {
  return {
    ...request(world, commands),
    expectedHash: createHash('sha256')
      .update(canonicalStringify(world))
      .digest('hex'),
  };
}
export const control = {
  type: 'TRANSFER_CONTROL',
  regionId: 'region:ne-fin',
  nationId: 'nation:rus',
};
export const treaty = {
  type: 'CREATE_TREATY',
  treaty: {
    id: 'treaty:nordic',
    name: 'Synthetic agreement',
    kind: 'defense',
    parties: ['nation:swe', 'nation:fin'],
    status: 'active',
    terms: 'Development mutual assistance',
  },
};
export const conflict = {
  type: 'START_CONFLICT',
  conflict: {
    id: 'conflict:crisis',
    name: 'Synthetic crisis',
    attackers: ['nation:rus'],
    defenders: ['nation:fin'],
    status: 'active',
    escalation: 20,
  },
};
