import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  createOrchestrator,
  createProvider,
  ProviderConfig,
} from '@mandate/ai';
import { resolveTurn, canonicalStringify } from '@mandate/core';
import { loadScenario } from '@mandate/scenarios';
import { ActionId, TurnId } from '@mandate/schemas';
import { WorldState } from '@mandate/schemas';
import type { WorldCommand } from '@mandate/schemas';
import { inferenceOptions } from './inference-options.js';

const playerOrder =
  process.env.MANDATE_PLAYER_ORDER ??
  'Sweden nukes Finland and sends in its armed forces to take the country';
const options = await inferenceOptions();
if (!options.selected)
  throw new Error('No reachable configured real model is available.');

// Keep the configured provider, endpoint, model, and workflow. Extend only the
// wall-clock budget so this single audit cannot time out during local inference.
const config = ProviderConfig.parse({
  ...options.selected,
  timeoutMs: Math.max(options.selected.timeoutMs, 180000),
  maxTurnMs: Math.max(options.selected.maxTurnMs, 600000),
});
const provider = createProvider(config);
const health = await provider.health();
if (!health.ok || !health.models.includes(config.model))
  throw new Error(
    `Configured provider/model is unavailable (${config.kind}/${config.model}): ${health.message}`,
  );

const scenario = loadScenario(
  resolve(
    process.env.MANDATE_INTENT_SCENARIO ??
      'data/scenarios/nordic-strategy.json',
  ),
);
const before = WorldState.parse(scenario);
before.playerNationId = before.nations.find((n) => n.name === 'Sweden')!.id;
const runId = `sweden-finland-intent-regression-${Date.now()}`;
const orchestrator = createOrchestrator(provider, config);
const prepared = await orchestrator.prepare({
  world: before,
  expectedHash: createHash('sha256')
    .update(canonicalStringify(before))
    .digest('hex'),
  action: {
    actorNationId: before.playerNationId,
    source: 'player',
    text: playerOrder,
  },
  runId,
  days: 30,
  quality: 'balanced',
});
const { expectedHash: _expectedHash, ...request } = prepared.request;
void _expectedHash;
const after = resolveTurn(before, request, {
  turnId: TurnId.parse(`turn:${runId}`),
  actionId: ActionId.parse(`action:${runId}`),
  recordedAt: new Date().toISOString(),
});

const actor = before.playerNationId;
const finland = before.nations.find((nation) => nation.name === 'Finland')!.id;
const actorOf = (command: WorldCommand): string | null => {
  if ('nationId' in command) return command.nationId ?? null;
  switch (command.type) {
    case 'STRATEGIC_ATTACK':
      return command.attackerNationId;
    case 'START_CONFLICT':
      return command.conflict.attackers[0] ?? null;
    case 'OPEN_CRISIS':
      return command.crisis.participants[0] ?? null;
    case 'START_INITIATIVE':
      return command.initiative.nationId;
    case 'OPEN_NEGOTIATION':
      return command.negotiation.proposerNationId;
    case 'CREATE_STRATEGIC_GOAL':
      return command.goal.nationId;
    case 'ADJUST_RELATION':
      return command.nationA;
    default:
      return null;
  }
};
const committedRecords = after.commands.filter(
  (record) => record.actionId === after.actions.at(-1)?.id,
);
const playerCommands = new Set(
  prepared.trace.playerExecution?.commands.map((entry) =>
    JSON.stringify(entry.command),
  ) ?? [],
);
const proposedActions = (prepared.trace.proposal?.commands ?? []).map(
  ({ command, reason }) => ({
    source: playerCommands.has(JSON.stringify(command))
      ? 'deterministic player executor'
      : 'model/world proposal',
    actorNationId: actorOf(command),
    command,
    reason,
  }),
);
const committedActions = committedRecords.map((record) => ({
  actorNationId: actorOf(record.command),
  command: record.command,
  validation: record.validation,
}));
const playerAttack = prepared.trace.playerExecution?.commands.find(
  ({ command }) => command.type === 'STRATEGIC_ATTACK',
);
const relatedCrisisId =
  playerAttack?.command.type === 'STRATEGIC_ATTACK'
    ? playerAttack.command.crisisId
    : undefined;
const bilateral = (participants: string[]) =>
  participants.includes(actor) && participants.includes(finland);
const crisisBefore = before.crises.filter(
  (crisis) => crisis.id === relatedCrisisId || bilateral(crisis.participants),
);
const crisisAfter = after.crises.filter(
  (crisis) => crisis.id === relatedCrisisId || bilateral(crisis.participants),
);
const crisisSnapshot = (crisis: (typeof after.crises)[number]) => ({
  title: crisis.title,
  participants: crisis.participants,
  severity: crisis.severity,
  status: crisis.status,
  militaryPosture: crisis.militaryPosture,
  rhetoric: crisis.rhetoric,
  diplomaticBreakdown: crisis.diplomaticBreakdown,
  latestHistory: crisis.history.at(-1),
});
const conflictAfter = after.conflicts.filter(
  (conflict) =>
    conflict.status === 'active' &&
    [...conflict.attackers, ...conflict.defenders].includes(finland),
);
const stats = (world: WorldState, nationId: string) => {
  const nation = world.nations.find((item) => item.id === nationId)!;
  return {
    economy: nation.stats.economy,
    military: nation.stats.military,
    readiness: nation.stats.readiness,
    stability: nation.stats.stability,
    legitimacy: nation.stats.legitimacy,
    fiscal: nation.stats.fiscal,
    treasury: nation.stats.treasury,
    unrest: nation.stats.unrest,
    industrial: nation.stats.industrial,
  };
};
const finnishPlan = prepared.trace.plans.find(
  (plan) => plan.nationId === finland,
);
const finnishResponseCommands = committedRecords
  .filter((record) => actorOf(record.command) === finland)
  .map((record) => record.command);
const worldResponses = committedRecords
  .filter(
    (record) =>
      actorOf(record.command) !== null &&
      actorOf(record.command) !== actor &&
      actorOf(record.command) !== finland,
  )
  .map((record) => ({
    actorNationId: actorOf(record.command),
    command: record.command,
  }));
const attackEvents = after.events
  .filter((event) => event.turnId === after.turns.at(-1)?.id)
  .sort((a, b) => b.importance - a.importance);

const report = {
  recordedAt: new Date().toISOString(),
  evidence: {
    provider: provider.id,
    model: config.model,
    workflow: config.workflow,
    scenario: before.scenario.name,
    status: prepared.trace.status,
    validatorResults: prepared.trace.validatorResults,
    failures: prepared.trace.failures,
  },
  playerOrder,
  parsedGraph: prepared.trace.intent?.actionGraph,
  semanticAudit: prepared.trace.playerExecution?.semanticAudit,
  parsedMajorIntents: (prepared.trace.intent?.majorIntentClauses ?? []).map(
    (clause) => ({
      kind: clause.kind,
      description: clause.description,
      targetNationIds: clause.targetNationIds,
      targetRegionIds: clause.targetRegionIds,
      satisfaction:
        prepared.trace.playerExecution?.intentSatisfactionAudit.find(
          (entry) => entry.clauseId === clause.id,
        ),
    }),
  ),
  proposedActions,
  committedActions,
  crisisChange: {
    before: crisisBefore.map(crisisSnapshot),
    after: crisisAfter.map(crisisSnapshot),
  },
  militaryChange: {
    sweden: { before: stats(before, actor), after: stats(after, actor) },
    finland: { before: stats(before, finland), after: stats(after, finland) },
    activeConflicts: conflictAfter.map((conflict) => ({
      name: conflict.name,
      attackers: conflict.attackers,
      defenders: conflict.defenders,
      escalation: conflict.escalation,
      theaters: conflict.theaters,
      campaigns: conflict.campaigns,
    })),
  },
  finnishResponse: {
    activated: prepared.trace.activations.some(
      (entry) => entry.nationId === finland,
    ),
    plan: finnishPlan ?? null,
    commands: finnishResponseCommands,
    events: after.events
      .filter(
        (event) =>
          event.turnId === after.turns.at(-1)?.id &&
          event.nationIds.includes(finland) &&
          event.sourceCommandIds.some((id) =>
            committedRecords.some(
              (record) =>
                record.id === id && actorOf(record.command) === finland,
            ),
          ),
      )
      .map((event) => event.title),
  },
  worldResponse: {
    plans: prepared.trace.plans
      .filter((plan) => plan.nationId !== actor && plan.nationId !== finland)
      .map((plan) => ({
        nationId: plan.nationId,
        explanation: plan.explanation,
      })),
    commands: worldResponses,
  },
  finalCanonicalOutcome: {
    revision: after.revision,
    date: after.date,
    activeConflictCount: after.conflicts.filter(
      (conflict) => conflict.status === 'active',
    ).length,
    swedishClaimsOnFinland: after.regions
      .filter(
        (region) =>
          region.ownerNationId === finland && region.claims.includes(actor),
      )
      .map((region) => region.name),
    finnishOwnedRegions: after.regions
      .filter((region) => region.ownerNationId === finland)
      .map((region) => ({
        name: region.name,
        ownerNationId: region.ownerNationId,
        controllerNationId: region.controllerNationId,
      })),
    headlines: attackEvents.map((event) => ({
      importance: event.importance,
      type: event.type,
      title: event.title,
    })),
  },
};

const outputDirectory = resolve(
  `.runtime/evaluation/player-intent-regression-real-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}`,
);
mkdirSync(outputDirectory, { recursive: true });
const reportPath = resolve(outputDirectory, 'exact-sweden-finland-case.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(
  JSON.stringify(
    {
      reportPath,
      provider: provider.id,
      model: config.model,
      majorIntentCount: report.parsedMajorIntents.length,
      commandCount: committedActions.length,
      finnishResponse: {
        activated: report.finnishResponse.activated,
        commandCount: finnishResponseCommands.length,
      },
      crisisAfter: report.crisisChange.after,
      headline: attackEvents[0]?.title ?? null,
    },
    null,
    2,
  ) + '\n',
);
