import {
  SaveFile,
  ScenarioFile,
  WorldState as WorldSchema,
} from '@mandate/schemas';
import type { WorldState } from '@mandate/schemas';
import { assertWorld } from './invariants.js';
import { WorldError } from './errors.js';

// IDs/pairs define collection identity; command/event order within a turn stays significant.
export function canonicalStringify(w: WorldState): string {
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = WorldSchema.parse(w);
  for (const key of [
    'knowledge',
    'crises',
    'economicLinks',
    'sanctions',
    'conferences',
    'tenures',
    'nations',
    'regions',
    'treaties',
    'conflicts',
    'goals',
    'commitments',
    'initiatives',
    'negotiations',
    'organizations',
    'events',
    'actions',
    'commands',
  ] as const)
    sorted[key].sort((a, b) => compare(a.id, b.id));
  sorted.relations.sort((a, b) =>
    compare(a.nationA + a.nationB, b.nationA + b.nationB),
  );
  for (const c of sorted.crises) {
    c.participants.sort();
    c.interestedActors.sort();
    c.regions.sort();
    c.negotiationIds.sort();
  }
  for (const c of sorted.conferences) c.parties.sort();
  for (const r of sorted.regions) r.claims.sort();
  for (const t of sorted.treaties) t.parties.sort();
  for (const c of sorted.conflicts) {
    c.attackers.sort();
    c.defenders.sort();
  }
  for (const g of sorted.goals) g.targetNationIds.sort();
  for (const i of sorted.initiatives) i.dependencies.sort();
  for (const o of sorted.organizations) {
    o.founders.sort();
    o.members.sort();
    o.invitedStates.sort();
    o.invitations.sort((a, b) => compare(a.nationId, b.nationId));
    o.pendingApplications.sort((a, b) => compare(a.nationId, b.nationId));
    o.commitments.sort((a, b) => compare(a.id, b.id));
    for (const commitment of o.commitments)
      commitment.reportedPaymentMilestones.sort((a, b) => a - b);
    o.development.sort((a, b) => compare(a.dimension, b.dimension));
    o.programs.sort((a, b) => compare(a.id, b.id));
    for (const program of o.programs) {
      program.participantNationIds.sort();
      program.responses.sort((a, b) => compare(a.nationId, b.nationId));
      program.reportedMilestones.sort((a, b) => a - b);
    }
  }
  for (const e of sorted.events) {
    e.nationIds.sort();
    e.regionIds.sort();
    e.treatyIds.sort();
    e.conflictIds.sort();
    e.topics.sort();
  }
  const keys = (_: string, value: unknown): unknown => {
    if (value && typeof value === 'object' && !Array.isArray(value))
      return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => compare(a, b)),
      );
    return value;
  };
  return JSON.stringify(sorted, keys);
}
export function parseSave(input: unknown): WorldState {
  if (
    !input ||
    typeof input !== 'object' ||
    !('formatVersion' in input) ||
    ![1, 2, 3].includes(Number(input.formatVersion))
  )
    throw new WorldError(
      'UNSUPPORTED_VERSION',
      'Only save format versions 1, 2 and 3 are supported.',
    );
  const { world } = SaveFile.parse(upgradeFormat(input));
  assertWorld(world);
  return world;
}
export function parseScenario(input: unknown): WorldState {
  const { world } = ScenarioFile.parse(upgradeFormat(input));
  assertWorld(world);
  if (
    world.revision !== 0 ||
    world.commands.length ||
    world.turns.length ||
    world.events.length ||
    world.actions.length
  )
    throw new WorldError(
      'DOMAIN',
      'Scenarios must be a genesis world without runtime history.',
    );
  return world;
}
export function exportSave(world: WorldState): SaveFile {
  assertWorld(world);
  return { formatVersion: 3, kind: 'save', world: structuredClone(world) };
}

// Explicit additive v1 -> v2 migration. Schema defaults fill new index dimensions
// and empty entity collections; unknown fields and invalid old references still fail.
function upgradeFormat(input: unknown): unknown {
  if (!input || typeof input !== 'object' || !('formatVersion' in input))
    return input;
  if (input.formatVersion !== 1 && input.formatVersion !== 2) return input;
  const legacy = input as { world?: unknown };
  if (
    !legacy.world ||
    typeof legacy.world !== 'object' ||
    !('schemaVersion' in legacy.world) ||
    legacy.world.schemaVersion !== input.formatVersion
  )
    return input;
  return {
    ...input,
    formatVersion: 3,
    world: { ...legacy.world, schemaVersion: 3 },
  };
}
