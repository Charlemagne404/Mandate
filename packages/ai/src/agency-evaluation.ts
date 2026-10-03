import type { PlayerExecution } from './player-executor.js';
import type { PlayerIntent } from './contracts.js';
import type { NationId, WorldState } from '@mandate/schemas';

export interface PlayerAgencyScore {
  semanticPreservation: number;
  majorIntentCoveragePercent: number;
  controllableAttempt: number;
  externalOutcomeBoundary: number;
  paternalisticSubstitutionFree: boolean;
  consequenceGeneration: number;
  worldReaction: number;
}

/** Score whether the player order survived interpretation and remained an attempt. */
export function scorePlayerAgency(
  intent: PlayerIntent,
  execution: PlayerExecution,
  before: WorldState,
  after?: WorldState,
): PlayerAgencyScore {
  const orderTexts = intent.policyOrders.map((order) => order.text);
  const semanticPreservation = orderTexts.length
    ? orderTexts.filter((text) => execution.orders.includes(text)).length /
      orderTexts.length
    : 1;
  const representedStatuses = new Set([
    'EXECUTED',
    'ATTEMPTED',
    'REPRESENTED_BY_VALID_ABSTRACTION',
  ]);
  const auditedClauses = intent.majorIntentClauses.map((clause) =>
    execution.intentSatisfactionAudit.find(
      (entry) => entry.clauseId === clause.id,
    ),
  );
  const majorIntentCoveragePercent = auditedClauses.length
    ? (100 *
        auditedClauses.filter(
          (entry) => entry && representedStatuses.has(entry.status),
        ).length) /
      auditedClauses.length
    : 100;
  const controllableAttempt = orderTexts.length
    ? orderTexts.filter((text, index) => {
        const order = intent.policyOrders[index]!;
        return (
          execution.commands.some((entry) => entry.reason.includes(text)) ||
          execution.implementation.some((line) => line.includes(text)) ||
          (order.persistent &&
            execution.commands.some(
              (entry) =>
                entry.command.type === 'SET_STRATEGY' &&
                entry.command.strategy.directives.some(
                  (directive) => directive.text === text,
                ),
            ))
        );
      }).length / orderTexts.length
    : 1;
  const externalTargets = new Set<NationId>(
    intent.desiredOutcomes
      .filter((outcome) => outcome.kind === 'territory')
      .flatMap((outcome) => outcome.targetNationIds)
      .filter((id) => id !== intent.actorNationId),
  );
  const explicitlyOrderedTransfer = intent.policyOrders.some((order) =>
    /\b(?:give|cede|transfer)\b/i.test(order.text),
  );
  const instantExternalTransfer = execution.commands.some(
    ({ command }) =>
      !explicitlyOrderedTransfer &&
      (command.type === 'TRANSFER_CONTROL' ||
        command.type === 'TRANSFER_OWNERSHIP') &&
      externalTargets.size > 0 &&
      before.regions.some(
        (region) =>
          externalTargets.has(region.ownerNationId) &&
          region.id === command.regionId &&
          command.nationId === intent.actorNationId,
      ),
  );
  const externalOutcomeBoundary = instantExternalTransfer ? 0 : 1;
  const paternalisticSubstitutionFree =
    execution.orders.length === orderTexts.length &&
    orderTexts.every((text, index) => execution.orders[index] === text);
  const targetIds = new Set(intent.targetNationIds);
  const hasExecutionConsequence =
    execution.commands.some(
      ({ command }) => !['SET_STRATEGY', 'ADVANCE_DATE'].includes(command.type),
    ) || execution.implementation.length > 0;
  const consequenceGeneration =
    orderTexts.length === 0 || hasExecutionConsequence ? 1 : 0;
  let worldReaction = 1;
  if (after && targetIds.size) {
    const beforeRelation = (nationId: NationId) =>
      before.relations.find(
        (relation) =>
          [relation.nationA, relation.nationB].includes(intent.actorNationId) &&
          [relation.nationA, relation.nationB].includes(nationId),
      );
    const reacted =
      after.crises.some(
        (crisis) =>
          crisis.participants.includes(intent.actorNationId) &&
          crisis.participants.some((id) => targetIds.has(id)) &&
          !before.crises.some((old) => old.id === crisis.id),
      ) ||
      after.conflicts.some(
        (conflict) =>
          [...conflict.attackers, ...conflict.defenders].includes(
            intent.actorNationId,
          ) &&
          [...conflict.attackers, ...conflict.defenders].some((id) =>
            targetIds.has(id),
          ) &&
          !before.conflicts.some((old) => old.id === conflict.id),
      ) ||
      after.negotiations.some(
        (negotiation) =>
          [
            negotiation.proposerNationId,
            negotiation.recipientNationId,
          ].includes(intent.actorNationId) &&
          targetIds.has(
            negotiation.proposerNationId === intent.actorNationId
              ? negotiation.recipientNationId
              : negotiation.proposerNationId,
          ) &&
          !before.negotiations.some((old) => old.id === negotiation.id),
      ) ||
      after.relations.some(
        (relation) =>
          [relation.nationA, relation.nationB].includes(intent.actorNationId) &&
          [relation.nationA, relation.nationB].some((id) =>
            targetIds.has(id),
          ) &&
          (() => {
            const target =
              relation.nationA === intent.actorNationId
                ? relation.nationB
                : relation.nationA;
            const previous = beforeRelation(target);
            return (
              relation.grievances.length > (previous?.grievances.length ?? 0) ||
              relation.factors.some(
                (factor) =>
                  !previous?.factors.some(
                    (old) => JSON.stringify(old) === JSON.stringify(factor),
                  ),
              )
            );
          })(),
      );
    worldReaction = reacted ? 1 : 0;
  }
  return {
    semanticPreservation,
    majorIntentCoveragePercent,
    controllableAttempt,
    externalOutcomeBoundary,
    paternalisticSubstitutionFree,
    consequenceGeneration,
    worldReaction,
  };
}
