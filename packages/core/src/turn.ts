import {
  Action,
  CommandRecord,
  Turn,
  TurnRequest,
  WorldState,
} from '@mandate/schemas';
import type { ActionId, TurnId, WorldState as World } from '@mandate/schemas';
import { WorldError, requireDomain } from './errors.js';
import { assertWorld } from './invariants.js';
import { applyCommand } from './apply-command.js';
import { updateCommitments } from './depth.js';
import { changeEvents } from './change-events.js';
import { factualEvent } from './events.js';
import { validateCommandDomain } from './domain.js';

export interface TurnContext {
  turnId: TurnId;
  actionId: ActionId;
  recordedAt: string;
}
export function resolveTurn(
  world: World,
  input: unknown,
  context: TurnContext,
): World {
  world = WorldState.parse(world);
  assertWorld(world);
  const request = TurnRequest.parse(input);
  if (request.expectedRevision !== world.revision)
    throw new WorldError(
      'STALE_REVISION',
      'World changed. Refresh before submitting.',
    );
  const w = structuredClone(world);
  requireDomain(
    !w.turns.some((t) => t.id === context.turnId),
    'Turn ID reused',
  );
  requireDomain(
    !w.actions.some((a) => a.id === context.actionId),
    'Action ID reused',
  );
  requireDomain(
    w.nations.some((n) => n.id === request.action.actorNationId),
    'Unknown action actor',
  );
  w.actions.push(
    Action.parse({
      ...request.action,
      id: context.actionId,
      turnId: context.turnId,
    }),
  );
  const eventIds: Turn['eventIds'] = [];
  for (const envelope of request.commands) {
    requireDomain(
      !w.commands.some((c) => c.id === envelope.id),
      'Command ID reused',
    );
    const previousStats = w.nations.map((n) => ({
      id: n.id,
      stats: { ...n.stats },
    }));
    const previousDepth = {
      initiatives: structuredClone(w.initiatives),
      goals: structuredClone(w.goals),
      commitments: structuredClone(w.commitments),
      crises: structuredClone(w.crises),
      tenures: structuredClone(w.tenures),
      date: w.date,
    };
    applyCommand(w, envelope.command, envelope.reason);
    updateCommitments(w, w.date);
    // Schema catches nonfinite/bounded state immediately, even if a later command would conceal it.
    const bounded = WorldState.safeParse(w);
    if (!bounded.success)
      throw new WorldError(
        'DOMAIN',
        'Command would violate state bounds: ' + bounded.error.message,
      );
    validateCommandDomain(w, envelope.command);
    const event = factualEvent(w, envelope, context.turnId);
    for (const n of w.nations) {
      const previous = previousStats.find((v) => v.id === n.id)?.stats;
      if (!previous) continue;
      for (const key of Object.keys(n.stats) as (keyof typeof n.stats)[])
        if (n.stats[key] !== previous[key])
          event.effects.push({
            nationId: n.id,
            stat: key,
            before: previous[key],
            after: n.stats[key],
          });
    }
    requireDomain(!w.events.some((e) => e.id === event.id), 'Event ID reused');
    w.events.push(event);
    eventIds.push(event.id);
    const remainingCommands =
      request.commands.length - request.commands.indexOf(envelope) - 1;
    const changes = changeEvents(
      previousDepth,
      w,
      envelope,
      context.turnId,
    ).slice(0, Math.max(0, 100 - eventIds.length - remainingCommands));
    for (const change of changes) {
      w.events.push(change);
      eventIds.push(change.id);
    }
    w.commands.push(
      CommandRecord.parse({
        ...envelope,
        ...context,
        simulationDate: w.date,
        validation: 'accepted',
      }),
    );
  }
  w.revision += 1;
  w.turns.push(
    Turn.parse({
      id: context.turnId,
      revision: w.revision,
      previousDate: world.date,
      date: w.date,
      recordedAt: context.recordedAt,
      actionId: context.actionId,
      commandIds: request.commands.map((c) => c.id),
      eventIds,
    }),
  );
  assertWorld(w);
  return w;
}
