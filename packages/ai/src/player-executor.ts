import { resolveTurn } from '@mandate/core';
import { ActionId, TurnId, CommandId, NationId } from '@mandate/schemas';
import { validateSemanticGraph } from './semantic.js';
import type { SemanticAudit, SemanticAction } from '@mandate/schemas';
import {
  Conflict,
  ConflictId,
  CrisisId,
  Crisis,
  Goal,
  Initiative,
  Negotiation,
  Nation,
  Sanction,
  TreatyId,
} from '@mandate/schemas';
import type { WorldCommand, WorldState } from '@mandate/schemas';
import type { PlayerIntent } from './contracts.js';
import type { MajorIntentSatisfaction } from './contracts.js';
import {
  deterministicPlayerIntent,
  isTerritorialPolicyOrder,
} from './perspective.js';

export interface PlayerExecution {
  semanticAudit?: SemanticAudit[];
  orders: string[];
  desiredOutcomes: PlayerIntent['desiredOutcomes'];
  constraints: string[];
  implementation: string[];
  advisories: string[];
  warnings: string[];
  intentSatisfactionAudit: MajorIntentSatisfaction[];
  commands: Array<{ command: WorldCommand; reason: string }>;
}

const later = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const key = (id: string) => id.slice(id.indexOf(':') + 1);
const safe = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .slice(0, 48);

const targetsFor = (node: SemanticAction) => node.targets;

function orderKind(
  text: string,
  supplied: PlayerIntent['policyOrders'][number]['kind'],
  world: WorldState,
) {
  if (
    /\breview\b|\bobserve\b|\bmonitor\b|\bcheck\b|\bassess\b|\bwait\b|\bstand by\b|\bdo nothing\b|\bkeep (?:the )?current strategy\b|\bcontinue it if\b/i.test(
      text,
    )
  )
    return 'wait' as const;
  if (
    /\b(?:reverse|revoke|cancel|abandon|drop)\b/i.test(text) &&
    /\b(?:policy|strategy|directive)\b/i.test(text)
  )
    return 'wait' as const;
  if (isTerritorialPolicyOrder(text, world)) return 'territory' as const;
  if (
    /sanction|treaty|alliance|recogniz|diplom|threaten|demand|withdraw|surrender|ceasefire|peace|negotiate|sever ties|cut ties|end all relations/i.test(
      text,
    )
  )
    return 'diplomacy' as const;
  if (
    /consult|cooperat|outreach|propos|offer|request|basing|negotiat|seek|open talks|initiative/i.test(
      text,
    )
  )
    return 'diplomacy' as const;
  if (
    /military|defen[sc]e|mobiliz|invade|war|attack|bomb|nuk|strike|rearm|armed forces/i.test(
      text,
    )
  )
    return 'military' as const;
  if (
    /tax|spend|budget|energy|industry|economic|aid|infrastructure/i.test(text)
  )
    return 'economy' as const;
  if (/reform|project|government|priority|stability/i.test(text))
    return 'domestic' as const;
  return supplied;
}

function containsConstraint(intent: PlayerIntent, kind: string, text: string) {
  return (
    intent.constraints.some((c) => c.kind === kind) ||
    (kind === 'avoid-war' &&
      /\b(?:avoid|without|don't|do not|never)\b[^.!?;]*(?:start(?:ing)?|initiat(?:e|ing)|enter(?:ing)?)?\s*(?:a )?war|no war/i.test(
        text,
      )) ||
    (kind === 'avoid-mobilization' &&
      /\b(?:avoid|without|don't|do not|never)\b[^.!?;]*mobiliz/i.test(text))
  );
}

function diplomacyKind(text: string): Negotiation['kind'] {
  if (/ceasefire|stand down|back down|stop fighting/i.test(text))
    return 'ceasefire';
  if (/peace|settlement|surrender|withdraw from (?:the )?war/i.test(text))
    return 'peace';
  if (/trade|market access|supply/i.test(text)) return 'trade';
  if (/non.?aggression/i.test(text)) return 'nonaggression';
  if (
    /alliance|mutual defense|military alliance|guarantee.{0,40}independence|basing rights/i.test(
      text,
    )
  )
    return 'defense';
  return 'consultation';
}

function intensityValue(
  value: PlayerIntent['policyOrders'][number]['intensity'],
) {
  return value === 'extreme'
    ? 100
    : value === 'high'
      ? 80
      : value === 'medium'
        ? 60
        : 35;
}

function initiativeKind(text: string): Initiative['kind'] | null {
  if (/energy|nuclear|fuel|power|electricity/i.test(text)) return 'energy';
  if (/industrial|industry|manufactur|infrastructure/i.test(text))
    return 'industry';
  if (/rearm|military capacity|readiness|military buildup/i.test(text))
    return 'rearmament';
  if (/reform|domestic resilience|public service/i.test(text)) return 'reform';
  if (/foreign aid|aid to/i.test(text)) return 'aid';
  if (/diplomatic outreach|diplomatic initiative/i.test(text))
    return 'diplomacy';
  return null;
}

/** Audit major source clauses against the typed commands that will be committed. */
export function auditMajorIntentClauses(
  world: WorldState,
  intent: PlayerIntent,
  commands: WorldCommand[],
): MajorIntentSatisfaction[] {
  const actorId = intent.actorNationId;
  const warProhibited = intent.constraints.some(
    (constraint) => constraint.kind === 'avoid-war',
  );
  const conflicts = [
    ...world.conflicts,
    ...commands.flatMap((command) =>
      command.type === 'START_CONFLICT' ? [command.conflict] : [],
    ),
  ];
  return intent.majorIntentClauses.map((clause) => {
    const node = intent.actionGraph?.actions.find((a) =>
      clause.sourceClauseIds.includes(a.clauseId),
    );
    const blocker =
      node?.issues.length ||
      node?.action === 'acquire-forces' ||
      node?.conditions.length ||
      node?.dependencies.some(
        (d) =>
          d.mandatory &&
          d.requirement !== 'ordered' &&
          intent.actionGraph?.actions.find((a) => a.id === d.actionId)
            ?.action === 'acquire-forces',
      );
    if (blocker)
      return {
        clauseId: clause.id,
        kind: clause.kind,
        status: 'BLOCKED_BY_REAL_WORLD_CONSTRAINT' as const,
        evidence: [],
        explanation: node?.conditions.length
          ? 'Conditional policy preserved; no premature execution is permitted.'
          : 'Semantic dependency or grounding prevents execution; no substitute target or forces are allowed.',
      };
    const targets = clause.targetNationIds;
    const records = commands.filter((command) => {
      switch (command.type) {
        case 'STRATEGIC_ATTACK':
          return (
            command.attackerNationId === actorId &&
            targets.includes(command.targetNationId)
          );
        case 'START_CONFLICT':
          return (
            command.conflict.attackers.includes(actorId) &&
            command.conflict.defenders.some((id) => targets.includes(id))
          );
        case 'OPEN_CRISIS':
          return (
            command.crisis.participants.includes(actorId) &&
            command.crisis.participants.some((id) => targets.includes(id))
          );
        case 'THEATER_ACTION':
        case 'CONFLICT_ACTION':
          return (
            command.nationId === actorId &&
            conflicts.some(
              (conflict) =>
                conflict.id === command.conflictId &&
                conflict.attackers.includes(actorId) &&
                conflict.defenders.some((id) => targets.includes(id)),
            )
          );
        case 'MOBILIZE_FORCE':
          return command.nationId === actorId;
        case 'CRISIS_ACTION':
          return command.nationId === actorId && command.move === 'mobilize';
        case 'ADD_CLAIM':
          return (
            command.nationId === actorId &&
            world.regions.some(
              (region) =>
                region.id === command.regionId &&
                targets.includes(region.ownerNationId),
            )
          );
        case 'CREATE_STRATEGIC_GOAL':
          return (
            command.goal.nationId === actorId &&
            command.goal.kind === 'territorial' &&
            command.goal.targetNationIds.some((id) => targets.includes(id))
          );
        default:
          return false;
      }
    });
    const evidence = [...new Set(records.map((command) => command.type))];
    const conflictDisabled =
      world.scenario.rules?.enabledMechanics.includes('theaters') === false;
    let status: MajorIntentSatisfaction['status'] = 'UNSUPPORTED';
    let explanation = 'No validated command represents this major clause.';
    switch (clause.kind) {
      case 'strategic-strike':
        if (evidence.includes('STRATEGIC_ATTACK')) {
          status = 'REPRESENTED_BY_VALID_ABSTRACTION';
          explanation =
            'A strategic attack abstraction is committed; weapon-specific and nuclear effects are not simulated.';
        } else if (warProhibited || !targets.length) {
          status = 'BLOCKED_BY_REAL_WORLD_CONSTRAINT';
          explanation = warProhibited
            ? 'The order explicitly prohibits war, so no offensive conflict was opened for the strike.'
            : 'No represented target government is grounded for the strategic attack.';
        }
        break;
      case 'armed-conflict-initiation':
      case 'declaration-of-war':
        if (evidence.includes('START_CONFLICT')) {
          status = 'EXECUTED';
          explanation = 'An active armed conflict was committed.';
        } else if (
          evidence.includes('THEATER_ACTION') ||
          evidence.includes('CONFLICT_ACTION')
        ) {
          status = 'ATTEMPTED';
          explanation =
            'An offensive order was committed in an existing conflict.';
        } else if (warProhibited || !targets.length) {
          status = 'BLOCKED_BY_REAL_WORLD_CONSTRAINT';
          explanation = warProhibited
            ? 'The order explicitly prohibits opening armed conflict.'
            : 'No represented target government is grounded for armed conflict.';
        }
        break;
      case 'invasion-offensive':
        if (
          records.some(
            (command) =>
              (command.type === 'THEATER_ACTION' &&
                command.posture === 'major-offensive') ||
              (command.type === 'CONFLICT_ACTION' &&
                command.stance === 'offensive'),
          )
        ) {
          status = 'ATTEMPTED';
          explanation =
            'An offensive campaign order was committed; territorial control remains a simulation outcome.';
        } else if (warProhibited) {
          status = 'BLOCKED_BY_REAL_WORLD_CONSTRAINT';
          explanation =
            'The order explicitly prohibits opening armed conflict.';
        } else if (conflictDisabled) {
          status = 'BLOCKED_BY_REAL_WORLD_CONSTRAINT';
          explanation = 'This scenario disables theater operations.';
        } else if (
          !targets.length ||
          !world.regions.some((region) =>
            targets.includes(region.ownerNationId),
          )
        ) {
          status = 'BLOCKED_BY_REAL_WORLD_CONSTRAINT';
          explanation =
            'No target-controlled map region is represented for an offensive campaign.';
        }
        break;
      case 'conquest-objective':
        if (
          evidence.includes('ADD_CLAIM') ||
          evidence.includes('CREATE_STRATEGIC_GOAL') ||
          evidence.includes('OPEN_CRISIS')
        ) {
          status = 'ATTEMPTED';
          explanation = evidence.includes('OPEN_CRISIS')
            ? 'A coercive crisis was opened over the stated political objective; union or ownership still requires a later settlement.'
            : 'A territorial claim or strategic objective was committed; ownership was not transferred by the order.';
        } else if (
          targets.length &&
          !world.regions.some((region) =>
            targets.includes(region.ownerNationId),
          )
        ) {
          status = 'BLOCKED_BY_REAL_WORLD_CONSTRAINT';
          explanation = 'The target has no represented canonical territory.';
        }
        break;
      case 'military-mobilization':
        if (
          evidence.includes('MOBILIZE_FORCE') ||
          evidence.includes('CRISIS_ACTION')
        ) {
          status = 'EXECUTED';
          explanation =
            'A mobilization order was committed; available resources determine its realized readiness.';
        }
        break;
    }
    if (
      targets.length &&
      !intent.targetNationIds.some((id) => targets.includes(id)) &&
      status === 'UNSUPPORTED'
    )
      explanation = 'The target is not grounded in canonical world references.';
    return {
      clauseId: clause.id,
      kind: clause.kind,
      status,
      evidence,
      explanation,
    };
  });
}

/**
 * Executes the policy components the player controls. Every command is still
 * schema/domain/invariant checked by the canonical resolver. Foreign responses
 * and desired external outcomes remain outside this executor.
 */
export function executePlayerAction(
  world: WorldState,
  intent: PlayerIntent | null,
  runId: string,
): PlayerExecution {
  const result: PlayerExecution = {
    orders: [],
    desiredOutcomes: [],
    constraints: [],
    implementation: [],
    advisories: [],
    warnings: [],
    intentSatisfactionAudit: [],
    commands: [],
  };
  if (!intent || intent.actorNationId !== world.playerNationId) return result;

  const actor = world.nations.find((n) => n.id === world.playerNationId);
  if (!actor) return result;
  const run = safe(runId);
  if (intent.actionGraph) {
    const errors = validateSemanticGraph(intent.actionGraph, world);
    if (errors.length)
      throw new Error('Semantic validation failed: ' + errors.join('; '));
  }
  const semanticAudit: SemanticAudit[] = [];
  result.semanticAudit = semanticAudit;
  const orders = intent.policyOrders.flatMap((order) => {
    const node = intent.actionGraph?.actions.find((a) =>
      order.sourceClauseIds.includes(a.clauseId),
    );
    return node &&
      ['invade', 'strike'].includes(node.action) &&
      order.targetNationIds.length > 1
      ? order.targetNationIds.map((target) => ({
          ...order,
          targetNationIds: [target],
        }))
      : [order];
  });
  result.orders = intent.policyOrders.map((o) => o.text);
  result.desiredOutcomes = intent.desiredOutcomes;
  result.constraints = intent.constraints.map((c) => c.description);
  if (!orders.length && !intent.majorIntentClauses.length) return result;

  const push = (command: WorldCommand, reason: string) => {
    if (
      result.commands.some(
        (c) => JSON.stringify(c.command) === JSON.stringify(command),
      )
    )
      return;
    result.commands.push({ command, reason: reason.slice(0, 2000) });
  };
  const relationshipConsequence = (
    target: NationId,
    delta: number,
    trustDelta: number,
    reason: string,
  ) => {
    if (target === actor.id) return;
    const relation = world.relations.find(
      (r) =>
        [r.nationA, r.nationB].includes(actor.id) &&
        [r.nationA, r.nationB].includes(target),
    );
    const current = relation?.score ?? 0;
    const boundedDelta =
      Math.max(-100, Math.min(100, current + delta)) - current;
    push(
      {
        type: 'ADJUST_RELATION',
        nationA: actor.id,
        nationB: target,
        delta: boundedDelta,
        trustDelta,
      },
      reason,
    );
  };
  const regionsOf = (nationId: NationId) =>
    world.regions.filter((r) => r.ownerNationId === nationId);
  const activeConflicts = world.conflicts.filter(
    (f) =>
      f.status === 'active' &&
      [...f.attackers, ...f.defenders].includes(actor.id),
  );
  const theaterMechanicsEnabled =
    world.scenario.rules?.enabledMechanics.includes('theaters') !== false;
  const strategy = structuredClone(actor.strategy);
  let strategyChanged = false;
  let strategicGoalIndex = 0;
  let crisisIndex = 0;
  let conflictIndex = 0;
  let negotiationIndex = 0;

  const registerPolicy = (
    order: PlayerIntent['policyOrders'][number],
    index: number,
    kind: ReturnType<typeof orderKind>,
  ) => {
    const risk = intensityValue(order.intensity);
    if (
      (order.intensity === 'high' || order.intensity === 'extreme') &&
      risk > strategy.riskTolerance
    ) {
      strategy.riskTolerance = risk;
      strategyChanged = true;
    }
    const orientation =
      kind === 'economy'
        ? 'economic'
        : kind === 'domestic'
          ? 'domestic'
          : kind === 'diplomacy'
            ? 'diplomatic'
            : 'security';
    if (kind !== 'wait' && strategy.orientation !== orientation) {
      strategy.orientation = orientation;
      strategyChanged = true;
    }
    if (order.persistent) {
      const contradicts = (directive: (typeof strategy.directives)[number]) =>
        directive.status === 'active' &&
        (((kind === 'territory' || kind === 'military') &&
          /avoid war|avoid escalation|neutrality|non.?alignment|never mobiliz|military restraint|no rearm|limit (?:military|defense|defence) spending|avoid rearm/i.test(
            directive.text,
          ) &&
          /annex|invade|conquer|mobiliz|territor|war|attack|military spending|defen[sc]e (?:budget|spending)|rearm/i.test(
            order.text,
          )) ||
          (kind === 'diplomacy' &&
            /maintain alliance|preserve treaty|do not withdraw/i.test(
              directive.text,
            ) &&
            /leave|break|withdraw|end treaty/i.test(order.text)));
      const contradicted = strategy.directives.filter(contradicts);
      strategy.directives = strategy.directives.map((d) =>
        contradicts(d) ? { ...d, status: 'cancelled' } : d,
      );
      if (contradicted.length)
        push(
          {
            type: 'APPLY_DOMESTIC_PRESSURE',
            nationId: actor.id,
            amount: Math.min(20, contradicted.length * 3),
            cause: `Cabinet cohesion fell after the player overrode standing policy: ${order.text}`,
          },
          `Consequences of player strategy override: ${order.text}`,
        );
      if (
        !strategy.directives.some(
          (d) => d.status === 'active' && d.text === order.text,
        )
      ) {
        if (strategy.directives.length >= 20) {
          const cancelled = strategy.directives.findIndex(
            (d) => d.status === 'cancelled',
          );
          if (cancelled < 0) {
            result.warnings.push(
              'Standing directive capacity is full; existing active policies were preserved.',
            );
            return;
          }
          strategy.directives.splice(cancelled, 1);
        }
        strategy.directives.push({
          id: `${run}-player-policy-${index}`,
          text: order.text,
          priority: order.intensity === 'extreme' ? 'critical' : 'high',
          visibility: order.visibility,
          status: 'active',
          createdDate: world.date,
        });
      }
      strategyChanged = true;
    }
  };

  const setNumericPolicy = (
    order: PlayerIntent['policyOrders'][number],
    text: string,
  ) => {
    const lower = text.toLowerCase();
    const target = /military|defen[sc]e|rearm/.test(lower)
      ? 'military'
      : /tax/.test(lower)
        ? 'tax'
        : null;
    if (!target) return;
    const field = target === 'military' ? 'militaryBudgetShare' : 'taxRate';
    const current = strategy[field];
    let next = current;
    if (
      /spend everything|spend nearly all|all available fiscal|entire fiscal capacity|full defense budget/i.test(
        lower,
      )
    )
      next = 100;
    else if (/\btriple\b/.test(lower)) next = Math.min(100, current * 3);
    else if (/\bdouble\b/.test(lower)) next = Math.min(100, current * 2);
    else {
      const percentage = lower.match(/(?:by\s+)?(\d{1,3})\s*%/);
      if (
        /cut|reduce|slash|lower/.test(lower) &&
        /drastic(?:ally)?|nearly all|almost all/.test(lower)
      )
        next = Math.round(current * 0.2);
      else if (/cut|reduce|slash|lower/.test(lower) && percentage)
        next = Math.round(
          current * (1 - Math.min(100, Number(percentage[1])) / 100),
        );
      else if (/cut|reduce|slash|lower/.test(lower))
        next = Math.max(0, current - 25);
      else if (/increase|raise|surge|expand/.test(lower))
        next = Math.min(100, current + 25);
    }
    if (next !== current) {
      strategy[field] = next;
      strategyChanged = true;
      result.implementation.push(
        target === 'military'
          ? `${text} Defense budget policy set to ${next}% of modeled fiscal capacity.`
          : `${text} Tax burden policy set to ${next}%.`,
      );
    }
    void order;
  };

  for (let index = 0; index < orders.length; index++) {
    const order = orders[index]!;
    const node = intent.actionGraph?.actions.find((a) =>
      order.sourceClauseIds.includes(a.clauseId),
    );
    const text =
      node?.action === 'annex' && !/\bannex\b/i.test(order.text)
        ? `${order.text} (annex objective)`
        : node?.action === 'invade' && !/\binvade\b/i.test(order.text)
          ? `${order.text} (invade)`
          : order.text;
    const conditionalDiplomacy =
      !!node &&
      node.conditions.length > 0 &&
      node.targets.length > 0 &&
      ['offer', 'communicate', 'guarantee', 'peace'].includes(node.action) &&
      !node.conditions.some((condition) =>
        /\b(?:accept|refuse|reject|counter)\w*\b[^.!?;]{0,32}\b(?:the|our|existing)\s+(?:deal|proposal|offer|agreement)\b/i.test(
          condition.text,
        ),
      );
    const record = (
      status: SemanticAudit['status'],
      explanation: string,
      commandTypes: string[] = [],
    ) => {
      if (!node) return;
      const existing = semanticAudit.find((a) => a.actionId === node.id);
      if (existing) {
        existing.commandTypes = [
          ...new Set([...existing.commandTypes, ...commandTypes]),
        ];
        return;
      }
      semanticAudit.push({
        actionId: node.id,
        text,
        status,
        explanation,
        commandTypes,
      });
    };
    const persistPlan = (plan: SemanticAction) => {
      if (
        !strategy.directives.some(
          (d) => d.status === 'active' && d.text === text,
        )
      ) {
        if (strategy.directives.length >= 20) {
          record(
            'BLOCKED',
            'Standing directive capacity is full; no existing plan was removed.',
          );
          return false;
        }
        strategy.directives.push({
          id: `${run}-semantic-${index}`,
          text,
          visibility: order.visibility,
          status: 'active',
          createdDate: world.date,
          semanticPlan: {
            ...plan,
            conditions: plan.conditions.map((c) => {
              const previousText = intent.actionGraph?.actions.find(
                (a) => a.id === c.actionId,
              )?.text;
              const newlyOpened = result.commands.find(
                (entry) =>
                  entry.command.type === 'OPEN_NEGOTIATION' &&
                  (!previousText || entry.reason.includes(previousText)) &&
                  c.subjects.some(
                    (n) =>
                      entry.command.type === 'OPEN_NEGOTIATION' &&
                      [
                        entry.command.negotiation.recipientNationId,
                        entry.command.negotiation.proposerNationId,
                      ].includes(n),
                  ),
              );
              const existing = !c.actionId
                ? world.negotiations
                    .filter((n) =>
                      c.subjects.some((id) =>
                        [n.proposerNationId, n.recipientNationId].includes(id),
                      ),
                    )
                    .at(-1)
                : undefined;
              const observationId =
                newlyOpened?.command.type === 'OPEN_NEGOTIATION'
                  ? newlyOpened.command.negotiation.id
                  : existing?.id;
              return { ...c, ...(observationId ? { observationId } : {}) };
            }),
          },
        });
        strategyChanged = true;
      }
      return true;
    };
    if (node?.issues.length) {
      record('BLOCKED', node.issues.join('; '));
      result.warnings.push(`${text}: ${node.issues.join('; ')}`);
      continue;
    }
    if (
      (node?.conditions.length && !conditionalDiplomacy) ||
      node?.sequence === 'before' ||
      node?.sequence === 'until'
    ) {
      if (persistPlan(node))
        record(
          'DEFERRED',
          'Conditional or timed plan saved. It will not execute while its condition or ordering is unresolved.',
        );
      continue;
    }
    if (node?.action === 'acquire-forces') {
      record(
        'IMPOSSIBLE',
        'The requested seizure of foreign forces is understood. Existing mechanics provide no way to acquire another sovereign army; no forces changed owner.',
      );
      result.warnings.push(
        `${text}: foreign military control cannot be acquired through existing mechanics.`,
      );
      continue;
    }
    const failedDependency = node?.dependencies.find(
      (d) =>
        d.mandatory &&
        d.requirement !== 'ordered' &&
        semanticAudit.some(
          (a) =>
            a.actionId === d.actionId &&
            ['IMPOSSIBLE', 'FAILED', 'BLOCKED'].includes(a.status),
        ),
    );
    const pendingSequence = node?.dependencies.find(
      (d) =>
        d.mandatory &&
        semanticAudit.some(
          (a) => a.actionId === d.actionId && a.status === 'DEFERRED',
        ),
    );
    if (failedDependency) {
      record(
        'BLOCKED',
        `Required action result ${failedDependency.actionId} is unavailable. The order did not authorize substitution of normal player forces.`,
      );
      continue;
    }
    if (pendingSequence) {
      if (node && persistPlan(node))
        record(
          'DEFERRED',
          `Waiting for preceding action ${pendingSequence.actionId}.`,
        );
      continue;
    }
    if (
      node?.dependencies.some((d) => !d.mandatory && d.requirement === 'result')
    )
      result.warnings.push(
        `${text}: the requested foreign forces are unavailable; the wording permits proceeding with the player's own forces.`,
      );
    if (node && ['influence', 'disrupt'].includes(node.action)) {
      // Political influence has an existing diplomacy project. There is no
      // strategic disruption project; preserve that objective without invented effects.
      if (node.action === 'influence' && targetsFor(node).length) {
        for (const target of targetsFor(node))
          push(
            {
              type: 'START_INITIATIVE',
              initiative: Initiative.parse({
                id: `initiative:${run}-semantic-${index}-${key(target)}`,
                nationId: actor.id,
                name: `Political influence: ${text}`.slice(0, 160),
                kind: 'diplomacy',
                targetNationId: target,
                effort: 2,
                durationDays: 180,
                startDate: world.date,
                visibility: node.secrecy,
              }),
            },
            `Honest abstraction of player order: ${text}`,
          );
        record(
          'ABSTRACTED',
          'A diplomacy initiative represents political influence; no bespoke propaganda effects are claimed.',
          ['START_INITIATIVE'],
        );
      } else {
        persistPlan(node);
        record(
          'DEFERRED',
          'Covert disruption objective preserved as a standing directive. Existing mechanics cannot simulate a cyberattack or grid damage.',
        );
      }
      continue;
    }
    const kind =
      node &&
      [
        'request-participation',
        'offer',
        'communicate',
        'guarantee',
        'peace',
      ].includes(node.action)
        ? 'diplomacy'
        : order.targetRegionIds.length && isTerritorialPolicyOrder(text, world)
          ? 'territory'
          : orderKind(text, order.kind, world);
    const targets = order.targetNationIds.filter(
      (nationId) => nationId !== actor.id,
    );
    const orderMajorIntents = intent.majorIntentClauses.filter((clause) =>
      order.sourceClauseIds.some((id) => clause.sourceClauseIds.includes(id)),
    );
    const namedRegions = order.targetRegionIds.length
      ? world.regions.filter((r) => order.targetRegionIds.includes(r.id))
      : [];
    const broadTerritorialOrder =
      !namedRegions.length &&
      (isTerritorialPolicyOrder(text, world) ||
        (targets.length > 0 &&
          orderMajorIntents.some((clause) =>
            ['invasion-offensive', 'conquest-objective'].includes(clause.kind),
          )));
    const targetRegionCandidates = [
      ...new Map(
        [
          ...namedRegions,
          ...(broadTerritorialOrder && targets.length
            ? targets.flatMap((id) => regionsOf(id))
            : []),
        ].map((r) => [r.id, r]),
      ).values(),
    ];
    // A country named as the grammatical subject can also be mistaken for a
    // map region by the formalizer. For an offensive territorial order, only
    // regions owned by the foreign target are in the campaign theater; this
    // prevents a no-op goal over the player's own land from being auto-achieved.
    const targetRegions =
      broadTerritorialOrder && targets.length
        ? targetRegionCandidates.filter((region) =>
            targets.includes(region.ownerNationId),
          )
        : targetRegionCandidates;
    if (node?.action === 'form-polity') {
      const regionIds = targetRegions.map((region) => region.id);
      const federation = /federat|\bunion\b/i.test(text);
      if (federation && !regionIds.length && targets.length) {
        const terms = `${text} All participating governments must agree to a binding union settlement; these talks do not change borders or dissolve any existing state.`;
        let opened = 0;
        for (const target of targets) {
          const existing = world.negotiations.some(
            (negotiation) =>
              negotiation.status === 'open' &&
              [
                negotiation.proposerNationId,
                negotiation.recipientNationId,
              ].includes(actor.id) &&
              [
                negotiation.proposerNationId,
                negotiation.recipientNationId,
              ].includes(target) &&
              /federation talks/i.test(negotiation.topic),
          );
          if (existing) continue;
          push(
            {
              type: 'OPEN_NEGOTIATION',
              negotiation: Negotiation.parse({
                id: `negotiation:${run}-federation-${key(target)}`,
                proposerNationId: actor.id,
                recipientNationId: target,
                topic: `Federation talks with ${world.nations.find((n) => n.id === target)!.name}`,
                kind: 'consultation',
                terms,
                createdDate: world.date,
                expiresDate: later(world.date, 180),
              }),
            },
            `Player order: ${text}`,
          );
          opened++;
        }
        record(
          opened ? 'ATTEMPTED' : 'DEFERRED',
          opened
            ? 'Opened persistent talks with each named federation partner. A union requires consent and a later binding settlement.'
            : 'Equivalent federation talks are already open; no duplicate proposals were sent.',
          opened ? ['OPEN_NEGOTIATION'] : [],
        );
        continue;
      }
      if (!regionIds.length) {
        record(
          'FAILED',
          'No specific region or represented federation partner is grounded, so no polity or border was invented.',
        );
        result.warnings.push(
          `${text}: choose a mapped region or name the governments for federation talks.`,
        );
        continue;
      }
      const regionOwners = [
        ...new Set(targetRegions.map((region) => region.ownerNationId)),
      ];
      const allRegionsAreOwn = targetRegions.every(
        (region) =>
          region.ownerNationId === actor.id &&
          region.controllerNationId === actor.id,
      );
      const parentRegions = regionsOf(actor.id);
      const polityName = targetRegions[0]!.name;
      const alreadyNamed = world.nations.some(
        (nation) => nation.name.toLowerCase() === polityName.toLowerCase(),
      );
      if (
        allRegionsAreOwn &&
        regionOwners.length === 1 &&
        parentRegions.some((region) => !regionIds.includes(region.id)) &&
        !alreadyNamed
      ) {
        const sortedRegionIds = [...regionIds].sort();
        const signature = sortedRegionIds.join('|');
        let hash = 2166136261;
        for (const character of signature)
          hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
        const slug = safe(polityName).replace(/^-+|-+$/g, '') || 'polity';
        const polityId = NationId.parse(
          `nation:${slug.slice(0, 45)}-${hash.toString(36)}`,
        );
        const colors = [
          '#52766D',
          '#7B5C76',
          '#956A42',
          '#4E6C92',
          '#8A6E4A',
          '#567D8C',
          '#80634F',
          '#6A718C',
          '#8B5F63',
          '#597A58',
          '#76669A',
          '#957C45',
        ];
        const color = colors[hash % colors.length]!;
        const share = Math.min(1, regionIds.length / parentRegions.length);
        const scaledStats = Object.fromEntries(
          Object.entries(actor.stats).map(([stat, value]) => [
            stat,
            Math.round(value * share),
          ]),
        ) as typeof actor.stats;
        const polity = Nation.parse({
          id: polityId,
          name: polityName,
          color,
          government: {
            type: 'Provisional council',
            ideology: 'regional autonomy',
          },
          leader: 'Interim council',
          stats: scaledStats,
        });
        push(
          {
            type: 'CREATE_POLITY',
            parentNationId: actor.id,
            polity,
            regionIds: sortedRegionIds,
          },
          `Player order: ${text}. Provisional national capacity is scaled by the share of the parent's mapped regions; region counts are a coarse geographic proxy, not population data.`,
        );
        record(
          'EXECUTED',
          `${polityName} becomes an independent polity. Its named regions transfer from ${actor.name}; the parent government retains its remaining territory.`,
          ['CREATE_POLITY'],
        );
        result.implementation.push(
          `Founded ${polityName} with a persistent country identity, map color, government, and standard diplomatic capabilities. Provisional capacity uses mapped-region share because the scenario has no subnational population or economic estimates.`,
        );
        continue;
      }
      if (regionOwners.length && !allRegionsAreOwn) {
        let supported = 0;
        for (const owner of regionOwners) {
          const regionNames = targetRegions
            .filter((region) => region.ownerNationId === owner)
            .map((region) => region.name);
          const place = regionNames.join(', ');
          push(
            {
              type: 'START_INITIATIVE',
              initiative: Initiative.parse({
                id: `initiative:${run}-secession-${key(owner)}`,
                nationId: actor.id,
                name: `Support independence in ${place}`.slice(0, 160),
                kind: 'diplomacy',
                targetNationId: owner,
                effort:
                  order.intensity === 'extreme'
                    ? 10
                    : order.intensity === 'high'
                      ? 5
                      : 2,
                durationDays: 365,
                startDate: world.date,
                visibility: order.visibility,
              }),
            },
            `Foreign political support ordered: ${text}`,
          );
          relationshipConsequence(
            owner,
            -12,
            -8,
            `Foreign-backed independence movement in ${place}`,
          );
          supported++;
        }
        record(
          supported ? 'ABSTRACTED' : 'FAILED',
          supported
            ? 'The territory belongs to another government. The order starts a named political-support initiative and damages relations; no independent state or border change is claimed.'
            : 'The selected regions are mixed or not controlled by the player, so an independent polity could not be founded.',
          supported ? ['START_INITIATIVE', 'ADJUST_RELATION'] : [],
        );
        continue;
      }
      record(
        'FAILED',
        alreadyNamed
          ? `${polityName} already exists as a government; use diplomacy or a territorial settlement to change its status.`
          : 'A government may release a region only when it owns and controls it and retains other territory.',
      );
      continue;
    }
    const warForbidden = containsConstraint(intent, 'avoid-war', text);
    const mobilizationForbidden = containsConstraint(
      intent,
      'avoid-mobilization',
      text,
    );
    const strategicStrikeIntent = orderMajorIntents.some(
      (clause) => clause.kind === 'strategic-strike',
    );
    const explicitWar =
      node?.action !== 'request-participation' &&
      (/\binvad(?:e|ing)|\battack\b|\bbomb(?:s|ed|ing)?\b|\bnuk(?:e|es|ed|ing)\b|\bstrike\b|declare war|start (?:a )?war|go to war|pursue (?:the )?war|continue (?:the )?war|continue fighting|go on (?:the )?offensive|press (?:the )?offensive/i.test(
        text,
      ) ||
        orderMajorIntents.some((clause) =>
          [
            'strategic-strike',
            'armed-conflict-initiation',
            'invasion-offensive',
            'declaration-of-war',
          ].includes(clause.kind),
        ));
    const warTargets = targets.length
      ? targets
      : activeConflicts
          .flatMap((conflict) =>
            conflict.attackers.includes(actor.id)
              ? conflict.defenders
              : conflict.attackers,
          )
          .slice(0, 1);
    const namedTakeover = targets.some((id) => {
      const name = world.nations.find((n) => n.id === id)?.name;
      return name
        ? text.toLowerCase().includes(`${name.toLowerCase()} is ours`)
        : false;
    });
    const transferOrder =
      /\b(?:give|cede|transfer)\b/i.test(text) && /\bto\b/i.test(text);
    const annexation =
      node?.action !== 'request-participation' &&
      !transferOrder &&
      ((isTerritorialPolicyOrder(text, world) &&
        /\b(?:annex|invade|conquer|take(?: over)?|seize|occupy|capture|incorporate|unify|union with)\b|\bmake\s+.+\s+join\b/i.test(
          text,
        )) ||
        (/\btake\b/i.test(text) && targets.length > 0) ||
        namedTakeover);
    const coercive =
      node?.action !== 'request-participation' &&
      (annexation ||
        /\bdemand\b|\bultimatum\b|\bthreaten(?: military action| war| sanctions)?\b/i.test(
          text,
        ));

    if (order.intensity === 'high' || order.intensity === 'extreme') {
      if (annexation || explicitWar)
        result.advisories.push(
          `Cabinet warning: ${text} risks military resistance, severe regional escalation and allied reaction.`,
        );
      else if (/spend|budget|tax|cut/i.test(text))
        result.advisories.push(
          `Finance warning: ${text} is likely to create significant fiscal pressure over time.`,
        );
      else if (/sanction|treaty|alliance|recogniz/i.test(text))
        result.advisories.push(
          `Foreign Ministry warning: ${text} is likely to damage relations or provoke retaliation.`,
        );
    }

    const commandCountBefore = result.commands.length;
    registerPolicy(order, index, kind);
    setNumericPolicy(order, text);

    if (
      /\b(?:leave|quit|withdraw from)\b/i.test(text) &&
      /alliance|organization|nato|every alliance/i.test(text)
    ) {
      const all = /every alliance|all alliances/i.test(text);
      const matches = world.organizations.filter(
        (o) =>
          o.members.includes(actor.id) &&
          o.kind === 'alliance' &&
          (all ||
            text.toLowerCase().includes(o.name.toLowerCase()) ||
            o.name.toLowerCase().includes(
              text
                .toLowerCase()
                .replace(/.*(?:leave|quit|withdraw from)\s+/, '')
                .replace(/\b(?:the|alliance)\b/g, '')
                .trim(),
            )),
      );
      for (const organization of matches) {
        push(
          {
            type: 'SET_ORGANIZATION_MEMBERSHIP',
            organizationId: organization.id,
            nationId: actor.id,
            member: false,
          },
          `Player order: ${text}`,
        );
        result.implementation.push(
          `${actor.name} leaves ${organization.name}.`,
        );
      }
      if (!matches.length)
        result.warnings.push(
          'No matching active alliance is represented in this scenario.',
        );
      for (const organization of matches)
        for (const member of organization.members)
          relationshipConsequence(
            member,
            -8,
            -10,
            `Player order: withdrew from ${organization.name}: ${text}`,
          );
    }

    if (
      /\b(?:break|terminate|end|renounce|cancel|withdraw from)\b/i.test(text) &&
      /treaty|agreement|commitment/i.test(text)
    ) {
      const preserveTrade = intent.actionGraph?.actions.some((a) =>
        /keep.*trade|preserve.*trade/i.test(a.text),
      );
      const matches = world.treaties.filter(
        (t) =>
          t.status === 'active' &&
          !(preserveTrade && t.kind === 'trade') &&
          t.parties.includes(actor.id) &&
          (targets.length
            ? targets.some((id) => t.parties.includes(id))
            : true),
      );
      for (const treaty of matches)
        push(
          { type: 'END_TREATY', treatyId: treaty.id },
          `Player order: ${text}`,
        );
      for (const treaty of matches)
        for (const party of treaty.parties)
          relationshipConsequence(
            party,
            -18,
            -16,
            `Player order: broke ${treaty.name}: ${text}`,
          );
      if (matches.length)
        result.implementation.push(
          `Ended ${matches.length} active treaty commitment(s).`,
        );
      else
        result.warnings.push(
          'No matching active treaty is represented in this scenario.',
        );
    }

    if (
      /\b(?:sever|cut) ties\b|\bend all relations\b/i.test(text) &&
      targets.length
    ) {
      for (const target of targets)
        relationshipConsequence(
          target,
          -50,
          -40,
          `Player order severed diplomatic relations: ${text}`,
        );
      result.implementation.push(
        `Diplomatic relations with ${targets.map((id) => world.nations.find((n) => n.id === id)!.name).join(', ')} were severed by order.`,
      );
    }

    if (
      /\b(?:cancel|stop|suspend|abandon)\b/i.test(text) &&
      /project|initiative|infrastructure|foreign aid|aid program/i.test(text)
    ) {
      const active = world.initiatives.filter(
        (i) =>
          i.nationId === actor.id &&
          i.status === 'active' &&
          (/foreign aid|aid program/i.test(text) ? i.kind === 'aid' : true) &&
          (/infrastructure|critical infrastructure/i.test(text)
            ? ['industry', 'energy'].includes(i.kind)
            : true),
      );
      for (const initiative of active)
        push(
          { type: 'CANCEL_INITIATIVE', initiativeId: initiative.id },
          `Player order: ${text}`,
        );
      if (active.length)
        result.implementation.push(
          `Cancelled ${active.length} active national program(s); sunk investment remains spent.`,
        );
    }

    if (
      /abandon|cancel|reverse|scrap|drop/i.test(text) &&
      /goal|objective|priority|strategy|policy/i.test(text)
    ) {
      const active = world.goals.filter(
        (g) =>
          g.nationId === actor.id &&
          !['achieved', 'failed', 'abandoned', 'superseded'].includes(g.status),
      );
      const cancelAll = /\b(?:all|every)\b/i.test(text);
      const keywords = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (word) =>
          word.length > 3 &&
          ![
            'abandon',
            'cancel',
            'reverse',
            'scrap',
            'drop',
            'goal',
            'goals',
            'objective',
            'objectives',
            'strategy',
            'strategic',
            'priority',
            'major',
            'active',
            'current',
            'our',
            'their',
          ].includes(word),
      );
      let selectedGoals = cancelAll
        ? active
        : active.filter((goal) =>
            keywords.some((word) =>
              goal.title
                .toLowerCase()
                .split(/\W+/)
                .some(
                  (titleWord) =>
                    titleWord.includes(word) || word.includes(titleWord),
                ),
            ),
          );
      if (!cancelAll && !selectedGoals.length && active.length)
        selectedGoals = [
          active.toSorted(
            (a, b) => b.priority - a.priority || a.title.localeCompare(b.title),
          )[0]!,
        ];
      for (const goal of selectedGoals)
        push(
          {
            type: 'UPDATE_STRATEGIC_GOAL',
            goalId: goal.id,
            status: 'abandoned',
            priority: goal.priority,
            progress: goal.progress,
          },
          `Player order: ${text}`,
        );
      if (selectedGoals.length)
        result.implementation.push(
          `Abandoned ${selectedGoals.length} selected strategic goal(s): ${selectedGoals.map((g) => g.title).join(', ')}.`,
        );
      if (
        /\b(?:reverse|revoke|cancel|abandon|drop|renounce|withdraw)\b/i.test(
          text,
        ) &&
        /annex|territor|expansion|claim/i.test(text)
      ) {
        const selectedOwners = new Set(order.targetNationIds);
        const selectedRegionIds = new Set(order.targetRegionIds);
        const goalRegionIds = new Set(
          selectedGoals.flatMap((goal) =>
            goal.evaluation.kind === 'territory'
              ? [goal.evaluation.regionId]
              : [],
          ),
        );
        const hasTerritorialScope =
          selectedRegionIds.size > 0 ||
          selectedOwners.size > 0 ||
          goalRegionIds.size > 0;
        const claimedRegions = world.regions.filter(
          (region) =>
            region.claims.includes(actor.id) &&
            (!hasTerritorialScope ||
              selectedRegionIds.has(region.id) ||
              selectedOwners.has(region.ownerNationId) ||
              goalRegionIds.has(region.id)),
        );
        for (const region of claimedRegions)
          push(
            {
              type: 'REMOVE_CLAIM',
              regionId: region.id,
              nationId: actor.id,
            },
            `Player order: ${text}`,
          );
        if (claimedRegions.length)
          result.implementation.push(
            `Withdrew ${claimedRegions.length} matching territorial claim(s) as ordered.`,
          );
      }
    }

    if (
      /\b(?:reverse|revoke|cancel|abandon|drop)\b/i.test(text) &&
      /\b(?:policy|strategy|directive)\b/i.test(text)
    ) {
      const active = strategy.directives.filter(
        (directive) => directive.status === 'active',
      );
      const cancelAll = /\b(?:all|every)\b/i.test(text);
      const subject = /annex|territor|expansion|claim/i.test(text)
        ? /annex|territor|expansion|claim/i
        : /war|military|defen[sc]e|rearm|mobiliz/i.test(text)
          ? /war|military|defen[sc]e|rearm|mobiliz/i
          : /energy|industry|economic|tax/i.test(text)
            ? /energy|industry|economic|tax|fiscal|budget/i
            : /alliance|treaty|diplomac|foreign policy/i.test(text)
              ? /alliance|treaty|diplomac|foreign policy/i
              : null;
      const selected = active.filter(
        (directive) => cancelAll || !subject || subject.test(directive.text),
      );
      if (selected.length) {
        strategy.directives = strategy.directives.map((directive) =>
          selected.some((entry) => entry.id === directive.id)
            ? { ...directive, status: 'cancelled' }
            : directive,
        );
        strategyChanged = true;
        result.implementation.push(
          `Cancelled ${selected.length} matching standing national policy directive(s) as ordered.`,
        );
      } else {
        result.warnings.push(
          'No matching active standing policy directive is recorded.',
        );
      }
    }

    const giveMatch = /\b(?:give|cede|transfer)\s+(.+?)\s+to\s+([\w -]+)/i.exec(
      text,
    );
    if (giveMatch) {
      const recipient = targets[0];
      const explicit = world.regions.filter(
        (r) =>
          order.targetRegionIds.includes(r.id) ||
          r.name.toLowerCase() === giveMatch[1]!.trim().toLowerCase(),
      );
      const transferable = explicit.filter(
        (r) =>
          r.ownerNationId === actor.id && r.controllerNationId === actor.id,
      );
      if (!recipient)
        result.warnings.push(
          'The receiving government is not identified in the current world.',
        );
      else if (!transferable.length)
        result.warnings.push(
          'The named territory is not represented as Swedish-controlled territory, so a transfer cannot be executed.',
        );
      else
        for (const region of transferable) {
          push(
            {
              type: 'TRANSFER_OWNERSHIP',
              regionId: region.id,
              nationId: recipient,
            },
            `Player order: ${text}`,
          );
          push(
            {
              type: 'TRANSFER_CONTROL',
              regionId: region.id,
              nationId: recipient,
            },
            `Player order: ${text}`,
          );
          result.implementation.push(
            `Transferred control and legal ownership of ${region.name} to ${world.nations.find((n) => n.id === recipient)!.name}.`,
          );
        }
    }

    if (
      kind === 'territory' &&
      (annexation ||
        /\bclaim\b|territorial objective|take .* territory|\bdemand\b/i.test(
          text,
        )) &&
      targets.length
    ) {
      const claimedRegions = targetRegions.filter(
        (r) => !r.claims.includes(actor.id),
      );
      for (const region of claimedRegions)
        push(
          { type: 'ADD_CLAIM', regionId: region.id, nationId: actor.id },
          `Player order: ${text}`,
        );
      if (claimedRegions.length)
        result.implementation.push(
          `Filed ${claimedRegions.length} territorial claim(s) over ${world.nations.find((n) => n.id === targets[0])!.name}.`,
        );
      if (!targetRegions.length)
        result.warnings.push(
          'The target state is known, but no territory is represented for it in this scenario.',
        );
      if (targetRegions.length) {
        for (const region of targetRegions.slice(0, 20)) {
          const exists = world.goals.some(
            (g) =>
              g.nationId === actor.id &&
              g.status !== 'abandoned' &&
              g.evaluation.kind === 'territory' &&
              g.evaluation.regionId === region.id,
          );
          if (exists) continue;
          push(
            {
              type: 'CREATE_STRATEGIC_GOAL',
              goal: Goal.parse({
                id: `goal:${run}-player-territory-${strategicGoalIndex++}`,
                nationId: actor.id,
                title: `Annex ${region.name}`,
                priority: order.intensity === 'extreme' ? 100 : 90,
                status: 'active',
                evaluation: {
                  kind: 'territory',
                  regionId: region.id,
                  mode: 'ownership',
                },
                targetNationIds: [region.ownerNationId],
                progress: 0,
                reason: `Authoritative player policy order: ${text}`,
                createdDate: world.date,
                updatedDate: world.date,
                kind: 'territorial',
                visibility: order.visibility,
                deadline: null,
              }),
            },
            `Player order: ${text}`,
          );
        }
        result.implementation.push(
          `Created a persistent annexation objective; ownership remains with ${world.nations.find((n) => n.id === targets[0])!.name} until simulation mechanics change it.`,
        );
      }
    }

    if (targets.length && coercive && !explicitWar) {
      const crisesEnabled =
        !world.scenario.rules ||
        world.scenario.rules.enabledMechanics.includes('crises');
      if (crisesEnabled) {
        for (const targetId of targets) {
          const existing = world.crises.find(
            (c) =>
              c.status !== 'resolved' &&
              c.participants.includes(actor.id) &&
              c.participants.includes(targetId) &&
              (annexation ? c.type === 'border' : c.type === 'security'),
          );
          if (existing) {
            if (
              annexation &&
              !warForbidden &&
              !mobilizationForbidden &&
              !/\bmobiliz/i.test(text) &&
              !world.commands.some(
                (c) =>
                  c.actionId === world.actions.at(-1)?.id &&
                  c.command.type === 'CRISIS_ACTION' &&
                  c.command.crisisId === existing.id &&
                  c.command.nationId === actor.id,
              )
            ) {
              push(
                {
                  type: 'CRISIS_ACTION',
                  crisisId: existing.id,
                  nationId: actor.id,
                  move: 'mobilize',
                },
                `Player order: ${text}`,
              );
              result.implementation.push(
                'Armed forces were ordered to mobilize as coercive pressure in the existing crisis.',
              );
            }
            continue;
          }
          const targetName = world.nations.find((n) => n.id === targetId)!.name;
          const demandedRegions = targetRegions
            .filter((r) => r.ownerNationId === targetId)
            .slice(0, 20);
          push(
            {
              type: 'OPEN_CRISIS',
              crisis: Crisis.parse({
                id: `crisis:${run}-player-demand-${crisisIndex++}`,
                title: annexation
                  ? `${actor.name} demands territory from ${targetName}`
                  : `${actor.name} issues a coercive demand to ${targetName}`,
                type: annexation ? 'border' : 'security',
                status: 'emerging',
                participants: [actor.id, targetId],
                regions: demandedRegions.map((r) => r.id),
                startDate: world.date,
                visibility: order.visibility,
                trigger: `Player order: ${text}`,
                issues: [text.slice(0, 4000)],
                demands: demandedRegions.length
                  ? demandedRegions.map((r) => ({
                      nationId: targetId,
                      text: `Transfer control of ${r.name} to ${actor.name}`,
                      condition: {
                        kind: 'control',
                        regionId: r.id,
                        nationId: actor.id,
                      },
                    }))
                  : [
                      {
                        nationId: targetId,
                        text: text.slice(0, 1000),
                        condition: { kind: 'acknowledgment' },
                      },
                    ],
                militaryPosture: order.intensity === 'extreme' ? 65 : 50,
                rhetoric: order.intensity === 'low' ? 35 : 70,
                diplomaticBreakdown: 20,
                deadline: later(world.date, 30),
              }),
            },
            `Player order: ${text}`,
          );
          result.implementation.push(
            `Opened a crisis and issued a demand to ${targetName}; its government decides whether to comply.`,
          );
          if (existing) continue;
          if (
            annexation &&
            !warForbidden &&
            !mobilizationForbidden &&
            !/\bmobiliz/i.test(text)
          ) {
            push(
              {
                type: 'CRISIS_ACTION',
                crisisId: CrisisId.parse(
                  `crisis:${run}-player-demand-${crisisIndex - 1}`,
                ),
                nationId: actor.id,
                move: 'mobilize',
              },
              `Player order: ${text}`,
            );
            result.implementation.push(
              'Armed forces were ordered to mobilize as coercive pressure.',
            );
          }
        }
      } else {
        result.warnings.push(
          'This scenario disables crisis mechanics; the territorial objective and claim remain in the committed order.',
        );
      }
    }

    if (explicitWar && !warForbidden && warTargets.length) {
      const target = warTargets[0]!;
      const targetName = world.nations.find((n) => n.id === target)!.name;
      const plannedConflict = result.commands.find(
        (entry) =>
          entry.command.type === 'START_CONFLICT' &&
          entry.command.conflict.attackers.includes(actor.id) &&
          entry.command.conflict.defenders.includes(target),
      )?.command;
      const existing = activeConflicts.find((f) =>
        warTargets.some((id) => [...f.attackers, ...f.defenders].includes(id)),
      );
      const conflict =
        existing ??
        (plannedConflict?.type === 'START_CONFLICT'
          ? plannedConflict.conflict
          : undefined);
      let conflictId: ConflictId;
      let theaterRegions: typeof targetRegions;
      if (conflict) {
        conflictId = conflict.id;
        theaterRegions = targetRegions
          .filter((r) => r.controllerNationId === target)
          .slice(0, 10);
        const existingTheater = conflict.theaters.find(
          (theater) => theater.nationId === actor.id,
        );
        const alreadyOrdered = result.commands.some(
          (entry) =>
            (entry.command.type === 'THEATER_ACTION' ||
              entry.command.type === 'CONFLICT_ACTION') &&
            entry.command.conflictId === conflictId &&
            entry.command.nationId === actor.id,
        );
        if (!alreadyOrdered && theaterMechanicsEnabled && existingTheater)
          push(
            {
              type: 'THEATER_ACTION',
              conflictId,
              theaterId: existingTheater.id,
              nationId: actor.id,
              regionIds: existingTheater.regionIds,
              posture: 'major-offensive',
              allocation: 100,
            },
            `Player order: ${text}`,
          );
        else if (
          !alreadyOrdered &&
          theaterMechanicsEnabled &&
          theaterRegions.length
        )
          push(
            {
              type: 'THEATER_ACTION',
              conflictId,
              theaterId: `theater:${run}-player-war-${conflictIndex++}`,
              nationId: actor.id,
              regionIds: theaterRegions.map((r) => r.id),
              posture: 'major-offensive',
              allocation: 100,
            },
            `Player order: ${text}`,
          );
        else if (!alreadyOrdered) {
          const front = theaterRegions.find((r) =>
            warTargets.includes(r.controllerNationId),
          );
          if (front && theaterMechanicsEnabled)
            push(
              {
                type: 'CONFLICT_ACTION',
                conflictId,
                nationId: actor.id,
                stance: 'offensive',
                regionId: front.id,
              },
              `Player order: ${text}`,
            );
          else if (front && !theaterMechanicsEnabled) {
            const fullMobilization: WorldCommand = {
              type: 'MOBILIZE_FORCE',
              nationId: actor.id,
              level: 'full',
            };
            push(
              fullMobilization,
              'Force commitment required for a legacy offensive campaign.',
            );
            const paid = Math.min(actor.stats.treasury, 20);
            const postMobilizationReadiness =
              actor.stats.readiness + Math.floor((16 * paid) / 20);
            const postMobilizationTreasury = actor.stats.treasury - paid;
            if (
              postMobilizationReadiness >= 20 &&
              postMobilizationTreasury >= 10 &&
              actor.stats.stability >= 25
            )
              push(
                {
                  type: 'CONFLICT_ACTION',
                  conflictId,
                  nationId: actor.id,
                  stance: 'offensive',
                  regionId: front.id,
                },
                `Player order: ${text}`,
              );
            else
              result.warnings.push(
                'The scenario has no theater operations; an offensive campaign requires a prepared force with sufficient readiness, stability and remaining treasury.',
              );
          } else
            result.warnings.push(
              theaterMechanicsEnabled
                ? 'An active conflict exists, but no represented enemy-controlled front permits an immediate offensive campaign.'
                : 'This scenario disables theater operations and has no represented enemy-controlled front for a legacy offensive campaign.',
            );
        }
        result.implementation.push(
          `Issued an offensive campaign order in the existing conflict ${conflict.name}.`,
        );
      } else {
        const targetRegionsNow = targetRegions.filter(
          (r) => r.controllerNationId === target,
        );
        conflictId = ConflictId.parse(
          `conflict:${run}-player-war-${conflictIndex++}`,
        );
        push(
          {
            type: 'START_CONFLICT',
            conflict: Conflict.parse({
              id: conflictId,
              name: `${actor.name}–${targetName} War`,
              attackers: [actor.id],
              defenders: [target],
              status: 'active',
              escalation: 80,
              logistics: 50,
              warGoals: [text.slice(0, 1000)],
            }),
          },
          `Player order: ${text}`,
        );
        theaterRegions = targetRegionsNow.slice(0, 10);
        if (theaterRegions.length && theaterMechanicsEnabled)
          push(
            {
              type: 'THEATER_ACTION',
              conflictId,
              theaterId: `theater:${run}-player-war-${conflictIndex}`,
              nationId: actor.id,
              regionIds: theaterRegions.map((r) => r.id),
              posture: 'major-offensive',
              allocation: 100,
            },
            `Player order: ${text}`,
          );
        else if (theaterRegions.length && !theaterMechanicsEnabled) {
          push(
            {
              type: 'MOBILIZE_FORCE',
              nationId: actor.id,
              level: 'full',
            },
            'Force commitment required for a legacy offensive campaign.',
          );
          const paid = Math.min(actor.stats.treasury, 20);
          const postMobilizationReadiness =
            actor.stats.readiness + Math.floor((16 * paid) / 20);
          const postMobilizationTreasury = actor.stats.treasury - paid;
          if (
            postMobilizationReadiness >= 20 &&
            postMobilizationTreasury >= 10 &&
            actor.stats.stability >= 25
          )
            push(
              {
                type: 'CONFLICT_ACTION',
                conflictId,
                nationId: actor.id,
                stance: 'offensive',
                regionId: theaterRegions[0]!.id,
              },
              `Player order: ${text}`,
            );
          else
            result.warnings.push(
              'The scenario has no theater operations; an offensive campaign requires a prepared force with sufficient readiness, stability and remaining treasury.',
            );
        }
        result.implementation.push(
          `War was declared against ${targetName}; an offensive campaign was ordered where represented terrain allows it.`,
        );
        if (!theaterRegions.length)
          result.warnings.push(
            'War began, but this scenario has no represented target-controlled theater for an immediate offensive.',
          );
      }

      const crisesEnabled =
        !world.scenario.rules ||
        world.scenario.rules.enabledMechanics.includes('crises');
      const worldCrisis = world.crises.find(
        (crisis) =>
          crisis.status !== 'resolved' &&
          crisis.participants.includes(actor.id) &&
          crisis.participants.includes(target),
      );
      const plannedCrisis = result.commands.find(
        (entry) =>
          entry.command.type === 'OPEN_CRISIS' &&
          entry.command.crisis.participants.includes(actor.id) &&
          entry.command.crisis.participants.includes(target),
      )?.command;
      let crisisId = worldCrisis?.id;
      if (!crisisId && plannedCrisis?.type === 'OPEN_CRISIS')
        crisisId = plannedCrisis.crisis.id;
      if (!crisisId && crisesEnabled) {
        const crisis = Crisis.parse({
          id: `crisis:${run}-player-military-${crisisIndex++}`,
          title: `${actor.name}'s military attack on ${targetName}`,
          type: annexation ? 'border' : 'security',
          status: 'emerging',
          participants: [actor.id, target],
          regions: targetRegions.slice(0, 20).map((region) => region.id),
          startDate: world.date,
          visibility: order.visibility,
          trigger: `${actor.name} initiates armed conflict with ${targetName}.`,
          issues: [
            annexation
              ? 'An armed offensive accompanies a territorial conquest objective.'
              : 'An armed offensive has opened a military crisis.',
          ],
          demands: targetRegions
            .filter((region) => region.ownerNationId === target)
            .slice(0, 20)
            .map((region) => ({
              nationId: target,
              text: `Transfer control of ${region.name} to ${actor.name}`,
              condition: {
                kind: 'control' as const,
                regionId: region.id,
                nationId: actor.id,
              },
            })),
          militaryPosture: 80,
          rhetoric: 95,
          diplomaticBreakdown: 95,
          deadline: later(world.date, 30),
          conflictId,
        });
        push({ type: 'OPEN_CRISIS', crisis }, `Player order: ${text}`);
        crisisId = crisis.id;
        result.implementation.push(
          `Opened a high-severity security crisis linked to the active conflict; ${targetName} and other actors may respond.`,
        );
      }

      if (
        crisisId &&
        !result.commands.some(
          (entry) =>
            entry.command.type === 'CRISIS_ACTION' &&
            entry.command.crisisId === crisisId &&
            entry.command.nationId === actor.id,
        ) &&
        !world.commands.some(
          (entry) =>
            entry.actionId === world.actions.at(-1)?.id &&
            entry.command.type === 'CRISIS_ACTION' &&
            entry.command.crisisId === crisisId &&
            entry.command.nationId === actor.id,
        )
      )
        push(
          {
            type: 'CRISIS_ACTION',
            crisisId,
            nationId: actor.id,
            move: 'mobilize',
          },
          `Player order: ${text}`,
        );

      if (
        strategicStrikeIntent &&
        !result.commands.some(
          (entry) =>
            entry.command.type === 'STRATEGIC_ATTACK' &&
            entry.command.attackerNationId === actor.id &&
            entry.command.targetNationId === target,
        )
      ) {
        const catastrophic =
          /nuk(?:e|es|ed|ing)|nuclear[- ]scale|catastrophic|massive/i.test(
            text,
          );
        push(
          {
            type: 'STRATEGIC_ATTACK',
            attackerNationId: actor.id,
            targetNationId: target,
            conflictId,
            ...(crisisId ? { crisisId } : {}),
            scale: catastrophic ? 'catastrophic' : 'major',
            abstraction: 'abstracted-effects-no-nuclear-weapons-model',
          },
          `Player order: ${text}`,
        );
        result.implementation.push(
          `Committed a ${catastrophic ? 'catastrophic' : 'major'} strategic attack abstraction against ${targetName}; effects are represented as aggregate military, economic, domestic and diplomatic consequences, without a nuclear weapons, blast, fallout or casualty simulation.`,
        );
      }
    } else if (explicitWar && warForbidden) {
      result.warnings.push(
        'The order contains a no-war constraint, so the executor preserved the objective and constraint without starting a war.',
      );
    }

    if ((coercive && targets.length) || (explicitWar && warTargets.length))
      for (const target of explicitWar ? warTargets : targets)
        relationshipConsequence(
          target,
          explicitWar ? -35 : annexation ? -24 : -12,
          explicitWar ? -28 : annexation ? -20 : -10,
          `Foreign grievance from player policy order: ${text}`,
        );

    if (
      /mobiliz|entire military|full military|armed forces/i.test(text) &&
      !mobilizationForbidden
    ) {
      const level =
        /full|entire|everything|all available/i.test(text) ||
        annexation ||
        intent.majorIntentClauses.some(
          (clause) =>
            clause.kind === 'conquest-objective' &&
            clause.targetNationIds.some((id) => targets.includes(id)),
        )
          ? 'full'
          : 'partial';
      push(
        { type: 'MOBILIZE_FORCE', nationId: actor.id, level },
        `Player order: ${text}`,
      );
      result.implementation.push(
        `${level === 'full' ? 'Full' : 'Partial'} mobilization ordered; available treasury determines realized readiness.`,
      );
    }

    if (
      /\b(?:sanction|impose sanctions|cut trade|embargo)\b/i.test(text) &&
      targets.length &&
      !/threaten|unless|if .* then|lift|remove|cancel|end sanctions|stop sanctions/i.test(
        text,
      )
    ) {
      const sector: Sanction['sector'] = /energy|oil|gas|fuel/i.test(text)
        ? 'energy'
        : /military|arms|weapons/i.test(text)
          ? 'military'
          : /finance|bank/i.test(text)
            ? 'finance'
            : /strategic/i.test(text)
              ? 'strategic'
              : 'trade';
      for (const target of targets) {
        const duplicate = world.sanctions.some(
          (s) =>
            s.status === 'active' &&
            s.issuer === actor.id &&
            s.target === target &&
            s.sector === sector,
        );
        if (duplicate) continue;
        const targetName = world.nations.find((n) => n.id === target)!.name;
        push(
          {
            type: 'IMPOSE_SANCTION',
            sanction: Sanction.parse({
              id: `sanction:${run}-player-${key(target)}-${sector}`,
              issuer: actor.id,
              target,
              sector,
              intensity:
                order.intensity === 'extreme'
                  ? 100
                  : order.intensity === 'high'
                    ? 85
                    : 60,
              startDate: world.date,
              reason: text,
            }),
          },
          `Player order: ${text}`,
        );
        result.implementation.push(
          `${sector} sanctions imposed on ${targetName}; retaliation and economic costs are simulated over time.`,
        );
      }
    }

    if (/\b(?:lift|remove|cancel|end|stop)\b.*\bsanctions?\b/i.test(text)) {
      for (const sanction of world.sanctions.filter(
        (s) =>
          s.status === 'active' &&
          s.issuer === actor.id &&
          (!targets.length || targets.includes(s.target)),
      )) {
        push(
          {
            type: 'LIFT_SANCTION',
            sanctionId: sanction.id,
            nationId: actor.id,
          },
          `Player order: ${text}`,
        );
        result.implementation.push(
          `Lifted the existing sanction against ${world.nations.find((n) => n.id === sanction.target)!.name}.`,
        );
      }
    }
    if (
      (/\b(?:withdraw from|pull out of|end)\b/i.test(text) &&
        /war|conflict|fighting/i.test(text)) ||
      /\bsurrender\b/i.test(text)
    ) {
      for (const conflict of activeConflicts) {
        const enemies = conflict.attackers.includes(actor.id)
          ? conflict.defenders
          : conflict.attackers;
        for (const enemy of enemies) {
          if (
            world.negotiations.some(
              (n) =>
                n.status === 'open' &&
                n.kind === 'peace' &&
                n.conflictId === conflict.id &&
                n.proposerNationId === actor.id &&
                n.recipientNationId === enemy,
            )
          )
            continue;
          const targetName = world.nations.find((n) => n.id === enemy)!.name;
          push(
            {
              type: 'OPEN_NEGOTIATION',
              negotiation: Negotiation.parse({
                id: `negotiation:${run}-player-peace-${negotiationIndex++}`,
                proposerNationId: actor.id,
                recipientNationId: enemy,
                kind: 'peace',
                conflictId: conflict.id,
                topic: /surrender/i.test(text)
                  ? 'Surrender terms'
                  : 'Withdrawal and peace proposal',
                terms: /surrender/i.test(text)
                  ? `${actor.name} offers unconditional surrender: ${text}`
                  : `${actor.name} seeks to withdraw from the war: ${text}`,
                createdDate: world.date,
                expiresDate: later(world.date, 180),
                visibility: order.visibility,
              }),
            },
            `Player order: ${text}`,
          );
          const theater = conflict.theaters.find(
            (t) => t.nationId === actor.id,
          );
          if (theater)
            push(
              {
                type: 'THEATER_ACTION',
                conflictId: conflict.id,
                theaterId: theater.id,
                nationId: actor.id,
                regionIds: theater.regionIds,
                posture: 'withdraw',
                allocation: 100,
              },
              `Player order: ${text}`,
            );
          else
            push(
              {
                type: 'CONFLICT_ACTION',
                conflictId: conflict.id,
                nationId: actor.id,
                stance: 'deescalate',
              },
              `Player order: ${text}`,
            );
          result.implementation.push(
            `Peace/withdrawal terms were offered to ${targetName}; the opponent decides whether to end the war.`,
          );
        }
      }
    }

    if (
      /whatever (?:they|you) want|accept (?:their|any) terms|give them anything/i.test(
        text,
      )
    ) {
      const incoming = world.negotiations.find(
        (n) => n.status === 'open' && n.recipientNationId === actor.id,
      );
      if (incoming) {
        push(
          {
            type: 'RESPOND_NEGOTIATION',
            negotiationId: incoming.id,
            nationId: actor.id,
            move: 'accept',
            message: `Accepted under the player order: ${text}`,
            ...(incoming.kind === 'consultation'
              ? {}
              : {
                  treatyId: TreatyId.parse(
                    `treaty:${run}-player-accept-${negotiationIndex++}`,
                  ),
                }),
          },
          `Player order: ${text}`,
        );
        result.implementation.push(
          `Accepted ${incoming.kind} terms from ${world.nations.find((n) => n.id === incoming.proposerNationId)!.name}; their current offer is now binding.`,
        );
      } else if (!targets.length) {
        result.warnings.push(
          'No current incoming offer exists to accept; the player order is preserved for a later negotiation.',
        );
      }
    }

    const projectKind = initiativeKind(text);
    if (
      projectKind &&
      /\b(?:start|begin|fund|launch|build|expand\w*|increase\w*|invest\w*|develop\w*|triple|double|diversif\w*|reform\w*)\b/i.test(
        text,
      )
    ) {
      const targetNationId =
        projectKind === 'aid' ? (targets[0] ?? null) : null;
      if (projectKind !== 'aid' || targetNationId) {
        const duplicate = world.initiatives.some(
          (i) =>
            i.status === 'active' &&
            i.nationId === actor.id &&
            i.kind === projectKind &&
            i.targetNationId === targetNationId,
        );
        if (!duplicate) {
          const name = text.slice(0, 160);
          push(
            {
              type: 'START_INITIATIVE',
              initiative: Initiative.parse({
                id: `initiative:${run}-player-${index}-${projectKind}`,
                nationId: actor.id,
                name,
                kind: projectKind,
                targetNationId,
                effort:
                  order.intensity === 'extreme'
                    ? 10
                    : order.intensity === 'high'
                      ? 5
                      : 2,
                durationDays: /five years|5 years/i.test(text)
                  ? 1825
                  : /over the next year|one year/i.test(text)
                    ? 365
                    : 180,
                startDate: world.date,
                visibility: order.visibility,
              }),
            },
            `Player order: ${text}`,
          );
          result.implementation.push(
            `Started a ${projectKind} program at effort ${order.intensity === 'extreme' ? 10 : order.intensity === 'high' ? 5 : 2}; capacity, funding and completion remain simulation-controlled.`,
          );
        } else
          result.warnings.push(
            `An equivalent ${projectKind} program is already active; the order is recorded without duplicate spending.`,
          );
        const yearCount = text.match(/(?:over|for)\s+(\d+)\s+years?/i)?.[1];
        const persistentHorizon =
          Boolean(yearCount) ||
          /long.?term|multi.?year|several years|five years/i.test(text);
        if (persistentHorizon) {
          const title =
            projectKind === 'energy'
              ? 'Reduce energy dependence'
              : projectKind === 'industry'
                ? 'Develop industrial capacity'
                : projectKind === 'rearmament'
                  ? 'Build military readiness'
                  : projectKind === 'reform'
                    ? 'Advance domestic reform'
                    : `Advance ${projectKind} policy`;
          const alreadyActive = world.goals.some(
            (goal) =>
              goal.nationId === actor.id &&
              goal.title === title &&
              !['achieved', 'failed', 'abandoned', 'superseded'].includes(
                goal.status,
              ),
          );
          if (!alreadyActive) {
            const stat =
              projectKind === 'energy'
                ? 'energyExposure'
                : projectKind === 'industry'
                  ? 'industrial'
                  : projectKind === 'rearmament'
                    ? 'readiness'
                    : projectKind === 'reform'
                      ? 'stability'
                      : 'influence';
            const baseline = actor.stats[stat];
            const target =
              projectKind === 'energy'
                ? Math.max(0, baseline - 20)
                : Math.min(100, baseline + 20);
            push(
              {
                type: 'CREATE_STRATEGIC_GOAL',
                goal: Goal.parse({
                  id: `goal:${run}-player-policy-${strategicGoalIndex++}`,
                  nationId: actor.id,
                  title,
                  priority: order.intensity === 'extreme' ? 100 : 80,
                  status: 'active',
                  evaluation: { kind: 'metrics' },
                  signals: [{ stat, baseline, target, weight: 100 }],
                  targetNationIds: targets,
                  progress: 0,
                  reason: `Authoritative multi-year player policy order: ${text}`,
                  createdDate: world.date,
                  updatedDate: world.date,
                  kind:
                    projectKind === 'energy' || projectKind === 'industry'
                      ? 'economic'
                      : projectKind === 'rearmament'
                        ? 'security'
                        : 'domestic',
                  visibility: order.visibility,
                  deadline: yearCount
                    ? later(world.date, Number(yearCount) * 365)
                    : null,
                }),
              },
              `Player order: ${text}`,
            );
            result.implementation.push(
              `Created the persistent ${title.toLowerCase()} goal; progress depends on later simulation turns.`,
            );
          }
        }
      } else
        result.warnings.push(
          'Foreign aid needs a represented recipient government.',
        );
    }

    if (/recogniz/i.test(text) && !targets.length)
      result.warnings.push(
        'Recognition was recorded as national policy, but the named polity is not represented as a government in this scenario.',
      );
    if (
      /copenhagen|breakaway|unrecognized polity/i.test(text) &&
      !targetRegions.length &&
      /annex|take|give|claim|demand/i.test(text)
    )
      result.warnings.push(
        'The requested place or polity has no canonical territory record; the demand is preserved in policy/crisis text without inventing an owner or map feature.',
      );
    if (
      targets.length &&
      kind === 'diplomacy' &&
      /offer|propose|negotiate|seek|ask|request|demand|tell|reassure|back off|last chance|pursue|closer|alliance|trade|consult|whatever they want|diplomacy|initiative|basing|cooperation|outreach/i.test(
        text,
      ) &&
      !/break|leave|withdraw|recogniz|sanction|threaten/i.test(text)
    ) {
      for (const target of targets) {
        let negotiationKind = diplomacyKind(text);
        const conflictId = ['ceasefire', 'peace'].includes(negotiationKind)
          ? (activeConflicts.find((f) =>
              [...f.attackers, ...f.defenders].includes(target),
            )?.id ?? null)
          : null;
        if (['ceasefire', 'peace'].includes(negotiationKind) && !conflictId) {
          negotiationKind = 'consultation';
          result.implementation.push(
            'A surrender or peace request without an active war is represented as a diplomatic demand; no settlement or surrender outcome is claimed.',
          );
        }
        const existing = world.negotiations.find(
          (n) =>
            n.status === 'open' &&
            n.proposerNationId === actor.id &&
            n.recipientNationId === target &&
            n.kind === negotiationKind &&
            n.conflictId === conflictId,
        );
        const alreadyIssued = result.commands.some(
          (entry) =>
            entry.command.type === 'OPEN_NEGOTIATION' &&
            entry.command.negotiation.proposerNationId === actor.id &&
            entry.command.negotiation.recipientNationId === target &&
            entry.command.negotiation.kind === negotiationKind &&
            entry.command.negotiation.conflictId === conflictId,
        );
        if (existing || alreadyIssued) continue;
        const targetName = world.nations.find((n) => n.id === target)!.name;
        const requestedSupport = /\bsupport\s+(.+?)(?:[.!?;]|$)/i
          .exec(text)?.[1]
          ?.trim();
        push(
          {
            type: 'OPEN_NEGOTIATION',
            negotiation: Negotiation.parse({
              id: `negotiation:${run}-player-offer-${negotiationIndex++}`,
              proposerNationId: actor.id,
              recipientNationId: target,
              kind: negotiationKind,
              conflictId,
              topic: requestedSupport
                ? `Support for ${requestedSupport}`.slice(0, 120)
                : `${diplomacyKind(text)} proposal`,
              terms: text,
              createdDate: world.date,
              expiresDate: later(world.date, 180),
              visibility: order.visibility,
            }),
          },
          `Player order: ${text}`,
        );
        result.implementation.push(
          `Sent the requested ${diplomacyKind(text)} proposal to ${targetName}; acceptance is theirs to decide.`,
        );
      }
    }

    if (
      targets.length &&
      /\b(?:talk|talks|consult|consultation|consultations|negotiate|diplomacy|initiative)\b/i.test(
        text,
      )
    ) {
      for (const crisis of world.crises.filter(
        (candidate) =>
          candidate.status !== 'resolved' &&
          candidate.participants.includes(actor.id) &&
          candidate.participants.some((id) => targets.includes(id)),
      )) {
        const target = crisis.participants.find((id) => targets.includes(id));
        const createdNegotiation = result.commands.find(
          (entry) =>
            entry.command.type === 'OPEN_NEGOTIATION' &&
            entry.command.negotiation.recipientNationId === target,
        );
        const existingNegotiation = world.negotiations.find(
          (negotiation) =>
            negotiation.status === 'open' &&
            [
              negotiation.proposerNationId,
              negotiation.recipientNationId,
            ].includes(actor.id) &&
            [
              negotiation.proposerNationId,
              negotiation.recipientNationId,
            ].includes(target!),
        );
        const negotiationId =
          createdNegotiation?.command.type === 'OPEN_NEGOTIATION'
            ? createdNegotiation.command.negotiation.id
            : existingNegotiation?.id;
        push(
          {
            type: 'CRISIS_ACTION',
            crisisId: crisis.id,
            nationId: actor.id,
            move: 'talk',
            ...(negotiationId ? { negotiationId } : {}),
          },
          `Player order: ${text}`,
        );
        result.implementation.push(
          `Opened talks in ${crisis.title}; the other participants decide whether to de-escalate or counter.`,
        );
      }
    }

    if (result.commands.length === commandCountBefore && order.persistent) {
      result.implementation.push(
        `Recorded the standing player policy: “${text}”.`,
      );
    }
  }

  // A conjunction without sequencing denotes concurrent orders. Emit an
  // aggregate strike after the concurrent offensive so its factual event can
  // describe the already committed campaign; explicit "then" stays ordered.
  for (const node of intent.actionGraph?.actions ?? []) {
    if (
      node.action !== 'strike' ||
      node.dependencies.length ||
      node.conditions.length
    )
      continue;
    const concurrent = intent.actionGraph?.actions.some(
      (a) =>
        a.action !== 'strike' &&
        !a.dependencies.length &&
        !a.conditions.length &&
        a.targets.some((t) => node.targets.includes(t)) &&
        ['invade', 'annex'].includes(a.action),
    );
    if (!concurrent) continue;
    const strikes = result.commands.filter(
      (c) =>
        c.command.type === 'STRATEGIC_ATTACK' &&
        node.targets.includes(c.command.targetNationId),
    );
    result.commands = result.commands.filter((c) => !strikes.includes(c));
    result.commands.push(...strikes);
  }
  if (strategyChanged)
    push(
      { type: 'SET_STRATEGY', nationId: actor.id, strategy },
      'Player policy order updates the controlled government strategy.',
    );

  if (!result.commands.length) {
    result.warnings.push(
      'No direct game mechanic matched this wording. The original player order remains in the turn record and the simulation did not substitute a different policy.',
    );
  }
  for (const node of intent.actionGraph?.actions ?? []) {
    if (semanticAudit.some((a) => a.actionId === node.id)) continue;
    const commands = result.commands.filter((c) =>
      c.reason.includes(node.text),
    );
    const types = [...new Set(commands.map((c) => c.command.type))];
    const strategic = types.includes('STRATEGIC_ATTACK');
    const policy = result.commands.some(
      (c) =>
        c.command.type === 'SET_STRATEGY' &&
        c.command.strategy.directives.some((d) => d.text === node.text),
    );
    const executed =
      (node.action === 'mobilize' && types.includes('MOBILIZE_FORCE')) ||
      (node.action === 'sanction' && types.includes('IMPOSE_SANCTION')) ||
      (node.action === 'cancel' &&
        (types.includes('END_TREATY') || types.includes('LIFT_SANCTION'))) ||
      (node.action === 'transfer' && types.includes('TRANSFER_OWNERSHIP'));
    semanticAudit.push({
      actionId: node.id,
      text: node.text,
      status: strategic
        ? 'ABSTRACTED'
        : executed
          ? 'EXECUTED'
          : commands.length
            ? 'ATTEMPTED'
            : policy
              ? 'ATTEMPTED'
              : 'BLOCKED',
      explanation: strategic
        ? 'Strategic attack abstraction ordered; nuclear weapons and nuclear-specific effects are not simulated.'
        : commands.length
          ? 'Validated commands represent this attempt. External success remains governed by the world.'
          : policy
            ? 'Policy objective recorded; no external outcome is claimed.'
            : 'No available mechanic executed this clause; the original order is retained.',
      commandTypes: types,
    });
  }
  result.intentSatisfactionAudit = auditMajorIntentClauses(
    world,
    intent,
    result.commands.map((entry) => entry.command),
  );
  for (const audit of result.intentSatisfactionAudit)
    if (audit.status === 'UNSUPPORTED')
      result.warnings.push(
        `Major intent not represented (${audit.clauseId}): ${audit.explanation}`,
      );
  return result;
}

/** Evaluate only bound canonical diplomatic observations. No prose inference. */
export function executeStandingPlayerPlans(
  world: WorldState,
  runId: string,
): PlayerExecution {
  const actor = world.nations.find((n) => n.id === world.playerNationId)!;
  const result: PlayerExecution = {
    orders: [],
    desiredOutcomes: [],
    constraints: [],
    implementation: [],
    advisories: [],
    warnings: [],
    intentSatisfactionAudit: [],
    semanticAudit: [],
    commands: [],
  };
  const strategy = structuredClone(actor.strategy);
  for (const directive of strategy.directives) {
    const plan = directive.semanticPlan;
    if (
      directive.status !== 'active' ||
      !plan?.conditions.length ||
      plan.issues.length
    )
      continue;
    const states = plan.conditions.map((condition) => {
      const negotiation = world.negotiations.find(
        (n) => n.id === condition.observationId,
      );
      if (
        !negotiation ||
        !['accepted', 'rejected'].includes(negotiation.status) ||
        !['accepted', 'refused'].includes(condition.predicate)
      )
        return null;
      const matches =
        condition.predicate === 'accepted'
          ? negotiation.status === 'accepted'
          : negotiation.status === 'rejected';
      return condition.negated ? !matches : matches;
    });
    if (states.some((s) => s === null)) continue;
    directive.status = 'cancelled';
    if (states.every(Boolean)) {
      // Targets come exclusively from the persisted resolved IDs, never from
      // pronouns or a changed map selection. Preserve the consequent wording.
      const names = plan.targets
        .map((id) => world.nations.find((n) => n.id === id)!.name)
        .join(' and ');
      let consequent = plan.text
        .replace(/^(?:if|unless|once|after)\b[^,]+,\s*/i, '')
        .replace(/^otherwise\s+/i, '')
        .replace(/\s+(?:if|unless|once|until)\s+.+$/i, '')
        .replace(
          /\b(?:their|them|they|both countries|both|that country)\b/gi,
          names,
        );
      if (!consequent.includes(names) && names) consequent += ` (${names})`;
      const resolved = deterministicPlayerIntent(world, {
        actorNationId: actor.id,
        text: consequent,
      });
      const execution = executePlayerAction(
        world,
        resolved,
        `${runId}-standing`,
      );
      result.commands.push(
        ...execution.commands.filter((c) => c.command.type !== 'SET_STRATEGY'),
      );
      result.orders.push(`Standing order activated: ${plan.text}`);
      result.implementation.push(...execution.implementation);
      result.warnings.push(...execution.warnings);
      result.semanticAudit!.push(
        ...(execution.semanticAudit ?? []).map((a) => ({
          ...a,
          actionId: `${directive.id}:${a.actionId}`,
        })),
      );
    } else
      result.semanticAudit!.push({
        actionId: directive.id,
        text: plan.text,
        status: 'BLOCKED',
        explanation:
          'The bound diplomatic response made this conditional branch false; the plan was retired.',
        commandTypes: [],
      });
  }
  if (JSON.stringify(strategy) !== JSON.stringify(actor.strategy))
    result.commands.push({
      command: { type: 'SET_STRATEGY', nationId: actor.id, strategy },
      reason:
        'Resolve standing player plans from canonical diplomatic responses.',
    });
  return result;
}

export function executePlayerTurn(
  world: WorldState,
  intent: PlayerIntent | null,
  runId: string,
): PlayerExecution {
  const standing = executeStandingPlayerPlans(world, runId);
  const preview = standing.commands.length
    ? resolveTurn(
        world,
        {
          expectedRevision: world.revision,
          action: {
            actorNationId: world.playerNationId,
            source: 'system',
            text: 'Evaluate canonical standing directives',
          },
          commands: standing.commands.map((c, i) => ({
            ...c,
            id: CommandId.parse(`command:${safe(runId)}-standing-preview-${i}`),
          })),
        },
        {
          turnId: TurnId.parse(`turn:${safe(runId)}-standing-preview`),
          actionId: ActionId.parse(`action:${safe(runId)}-standing-preview`),
          recordedAt: '2000-01-01T00:00:00.000Z',
        },
      )
    : world;
  const execution = executePlayerAction(preview, intent, runId);
  return {
    ...execution,
    orders: [...standing.orders, ...execution.orders],
    implementation: [...standing.implementation, ...execution.implementation],
    warnings: [...standing.warnings, ...execution.warnings],
    semanticAudit: [
      ...(standing.semanticAudit ?? []),
      ...(execution.semanticAudit ?? []),
    ],
    commands: [...standing.commands, ...execution.commands],
  };
}
