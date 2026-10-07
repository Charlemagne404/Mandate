import {
  Action,
  CommandRecord,
  Turn,
  TurnRequest,
  WorldState,
} from '@mandate/schemas';
import type {
  ActionId,
  NationId,
  TurnId,
  WorldCommand,
  WorldState as World,
} from '@mandate/schemas';
import { WorldError, requireDomain } from './errors.js';
import { assertWorld } from './invariants.js';
import { applyCommand } from './apply-command.js';
import { updateCommitments } from './depth.js';
import { changeEvents } from './change-events.js';
import { factualEvent } from './events.js';
import { validateCommandDomain } from './domain.js';
import { surfaceNovelEvents } from './event-novelty.js';

export interface TurnContext {
  turnId: TurnId;
  actionId: ActionId;
  recordedAt: string;
}

function commandIssuedBy(command: WorldCommand, nationId: NationId): boolean {
  switch (command.type) {
    case 'CREATE_ORGANIZATION':
      return command.organization.founders[0] === nationId;
    case 'ADD_ORGANIZATION_COMMITMENT':
      return command.commitment.issuer === nationId;
    case 'START_ORGANIZATION_PROGRAM':
      return command.program.issuerNationId === nationId;
    case 'INVITE_TO_ORGANIZATION':
      return command.inviterNationId === nationId;
    case 'UPDATE_ORGANIZATION':
    case 'DISSOLVE_ORGANIZATION':
    case 'REMOVE_ORGANIZATION_MEMBER':
      return command.issuerNationId === nationId;
    case 'START_INITIATIVE':
      return command.initiative.nationId === nationId;
    case 'OPEN_NEGOTIATION':
      return command.negotiation.proposerNationId === nationId;
    case 'ISSUE_PATRON_DIRECTIVE':
      return command.patronNationId === nationId;
    case 'ENFORCE_TREATY_BREACH':
      return (command.actingNationId ?? command.patronNationId) === nationId;
    case 'START_CONFLICT':
      return command.conflict.attackers.includes(nationId);
    case 'OPEN_CRISIS':
      return command.crisis.participants[0] === nationId;
    case 'CREATE_STRATEGIC_GOAL':
      return command.goal.nationId === nationId;
    case 'CREATE_TREATY':
      return command.treaty.parties.includes(nationId);
    case 'TRANSFER_OWNERSHIP':
    case 'TRANSFER_CONTROL':
      return false;
    case 'ADJUST_RELATION':
      return command.nationA === nationId || command.nationB === nationId;
    case 'CREATE_EVENT':
      return command.event.nationIds[0] === nationId;
    default:
      if ('nationId' in command) return command.nationId === nationId;
      if ('issuerNationId' in command)
        return command.issuerNationId === nationId;
      if ('inviterNationId' in command)
        return command.inviterNationId === nationId;
      if ('attackerNationId' in command)
        return command.attackerNationId === nationId;
      if ('proposerNationId' in command)
        return command.proposerNationId === nationId;
      return false;
  }
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
  const suppressedCommandIds = new Set<string>();
  const eventMetrics = {
    candidateCount: 0,
    surfacedCount: 0,
    duplicateSuppressed: 0,
    maintenanceSuppressed: 0,
    progressSuppressed: 0,
  };
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
      organizations: structuredClone(w.organizations),
      treaties: structuredClone(w.treaties),
      tenures: structuredClone(w.tenures),
      conflicts: structuredClone(w.conflicts),
      regions: structuredClone(w.regions),
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
    const remainingCommands =
      request.commands.length - request.commands.indexOf(envelope) - 1;
    const changes = changeEvents(
      previousDepth,
      w,
      envelope,
      context.turnId,
    ).slice(0, Math.max(0, 100 - eventIds.length - remainingCommands));
    const currentAction = w.actions.find(
      (action) => action.id === context.actionId,
    );
    const automatic = envelope.command.type === 'ADVANCE_DATE';
    const currentPlayerCommand = Boolean(
      currentAction?.source === 'player' &&
      commandIssuedBy(envelope.command, currentAction.actorNationId),
    );
    for (const candidate of [event, ...changes]) {
      if (candidate.type === 'ADVANCE_DATE')
        candidate.novelty = candidate.effects.length
          ? 'consequence'
          : 'maintenance';
      const existingProvenance = candidate.provenance;
      candidate.provenance = {
        kind: automatic
          ? 'automatic-effect'
          : currentPlayerCommand
            ? 'current-player-order'
            : 'independent-action',
        originatingActionId:
          existingProvenance?.originatingActionId ??
          (currentPlayerCommand ? context.actionId : null),
        triggeringActionId: context.actionId,
      };
    }
    const novelty = surfaceNovelEvents(w.events, [event, ...changes]);
    eventMetrics.candidateCount += novelty.metrics.candidateCount;
    eventMetrics.surfacedCount += novelty.metrics.surfacedCount;
    eventMetrics.duplicateSuppressed += novelty.metrics.duplicateSuppressed;
    eventMetrics.maintenanceSuppressed += novelty.metrics.maintenanceSuppressed;
    eventMetrics.progressSuppressed += novelty.metrics.progressSuppressed;
    novelty.suppressedCommandIds.forEach((id) => suppressedCommandIds.add(id));
    for (const surfaced of novelty.events) {
      requireDomain(
        !w.events.some((existing) => existing.id === surfaced.id),
        'Event ID reused',
      );
      w.events.push(surfaced);
      eventIds.push(surfaced.id);
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
      eventMetrics,
      suppressedCommandIds: [...suppressedCommandIds],
    }),
  );
  assertWorld(w);
  return w;
}
