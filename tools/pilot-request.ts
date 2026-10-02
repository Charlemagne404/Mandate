import { ActionId, TurnId, NationId, CommitRequest } from '@mandate/schemas';
import type { WorldState, WorldCommand } from '@mandate/schemas';
import { canonicalHash } from '@mandate/persistence';
const later = (date: string, days: number) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const pilotContext = (run: string, revision: number) => ({
  turnId: TurnId.parse(`turn:${run.toLowerCase()}-${revision}`),
  actionId: ActionId.parse(`action:${run.toLowerCase()}-${revision}`),
  recordedAt: '2026-10-02T00:00:00.000Z',
});
export function pilotRequest(
  w: WorldState,
  actor: NationId,
  run: string,
  commands: WorldCommand[],
  days = 30,
) {
  return CommitRequest.parse({
    expectedRevision: w.revision,
    expectedHash: canonicalHash(w),
    action: {
      actorNationId: actor,
      source: 'system' as const,
      text: `Reproducible real-model pilot ${run}`,
    },
    commands: [
      ...commands,
      { type: 'ADVANCE_DATE' as const, date: later(w.date, days) },
    ].map((command, index) => ({
      id: `command:${run.toLowerCase()}-${w.revision}-${index}`,
      reason:
        'Explicit bounded real-model choice; canonical validation applies',
      command,
    })),
  });
}
