import { semanticCommandIssue } from './semantic.js';
import { executePlayerTurn } from './player-executor.js';
import { SemanticProposal } from './contracts.js';
import { buildFormalizerPayload } from './perspective.js';
import { z } from 'zod';
import { buildContext } from '@mandate/memory';
import {
  assessInfluenceOffer,
  buildInfluenceStrategyPlan,
  influenceProfile,
  resolveTurn,
  executionCapacity,
} from '@mandate/core';
import {
  ActionId,
  CommandId,
  CommitRequest,
  Initiative,
  Crisis,
  Goal,
  Negotiation,
  Organization,
  OrganizationId,
  Conflict,
  Sanction,
  InfluenceTerm,
  InfluenceDecision,
  InfluencePortfolio,
  TurnId,
  WorldCommand as WorldCommandSchema,
} from '@mandate/schemas';
import type {
  NationId,
  RegionId,
  WorldState,
  WorldCommand,
} from '@mandate/schemas';
import { NationPlan, DiplomaticMove } from './contracts.js';
import type { ProviderConfig, Role, PlayerIntent } from './contracts.js';
import type { PrepareInput, TurnTrace } from './orchestrator.js';
import {
  canonicalizeFormalizerIntent,
  deterministicPlayerIntent,
  splitActionClauses,
  scopeIntent,
} from './perspective.js';
import { selectRelevance, scheduleActors } from './scheduler.js';
import { classifyImportance, repetitionIssue } from './behavior.js';
import { auditMajorIntentClauses } from './player-executor.js';
import {
  buildInfluenceCounterOffers,
  calibrateInfluenceResponse,
  containsPrivateStrategicPlanningLanguage,
  influenceDecisionRecord,
  influencePartiesForNegotiation,
  preferredPersistentInfluenceChoice,
  repairOutOfScopeInfluenceRationale,
  shouldRevisitDeferredInfluence,
} from './influence-strategy.js';

// Local inference proposes choices; these recipes are code-owned commands, never model code.
// Consent is a separate government call. The sequential resolver remains authoritative.
export const CompactDecision = z.strictObject({
  choice: z.string().max(120),
  additionalChoices: z.array(z.string().max(120)).max(2),
  reason: z.string().min(1).max(180),
  message: z.string().max(260),
  counterTerms: z.string().max(300),
  counterInfluenceTerms: z.array(InfluenceTerm).max(32).default([]),
  influenceDecision: InfluenceDecision.optional(),
});
const ClauseClassification = z.strictObject({
  kind: z.enum([
    'diplomacy',
    'economy',
    'military',
    'domestic',
    'territory',
    'wait',
    'other',
  ]),
  visibility: z.enum(['public', 'private']),
});
export const CompactIntent = z.strictObject({
  classifications: z.array(ClauseClassification).min(1).max(40),
  semanticProposals: z.array(SemanticProposal).max(40).optional(),
});
export type Candidate = {
  id: string;
  label: string;
  commands: WorldCommand[];
  family: string;
};

function influencePortfolioSnapshot(
  world: WorldState,
  patronNationId: NationId,
  priorityTargetNationId: NationId | null,
  plannedTerms: readonly WorldState['negotiations'][number]['influenceTerms'][number][] = [],
) {
  const patron = world.nations.find((nation) => nation.id === patronNationId)!;
  const recurring = new Set([
    'subsidy',
    'infrastructure-investment',
    'energy-supply',
  ]);
  const commitments = [
    ...world.treaties
      .filter(
        (treaty) =>
          treaty.status === 'active' &&
          treaty.kind === 'influence' &&
          treaty.parties.includes(patronNationId),
      )
      .flatMap((treaty) => treaty.influenceTerms),
    ...world.negotiations
      .filter(
        (negotiation) =>
          negotiation.kind === 'influence' &&
          negotiation.status === 'open' &&
          negotiation.proposerNationId === patronNationId,
      )
      .flatMap((negotiation) => negotiation.influenceTerms),
  ];
  const committedAnnualCost = commitments.reduce(
    (sum, term) =>
      sum +
      (recurring.has(term.kind)
        ? term.amount * 12
        : term.kind === 'debt-relief'
          ? term.amount
          : 0),
    0,
  );
  const arrears = world.treaties
    .filter(
      (treaty) =>
        treaty.status === 'active' && treaty.parties.includes(patronNationId),
    )
    .flatMap((treaty) => treaty.breaches)
    .filter(
      (breach) =>
        breach.status !== 'resolved' &&
        breach.violatingNationId === patronNationId,
    )
    .reduce((sum, breach) => sum + breach.arrearsAmount, 0);
  const availableTreasury = Math.max(
    0,
    patron.stats.treasury - committedAnnualCost - arrears,
  );
  const plannedAnnualCost = plannedTerms.reduce(
    (sum, term) =>
      sum +
      (recurring.has(term.kind)
        ? term.amount * 12
        : term.kind === 'debt-relief' || term.kind === 'loan'
          ? term.amount
          : 0),
    0,
  );
  const targetName = priorityTargetNationId
    ? (world.nations.find((nation) => nation.id === priorityTargetNationId)
        ?.name ?? priorityTargetNationId)
    : 'no target';
  return InfluencePortfolio.parse({
    priorityTargetNationId,
    reviewedDate: world.date,
    availableTreasury: Math.min(1_000_000_000, availableTreasury),
    committedAnnualCost: Math.min(1_000_000_000, committedAnnualCost + arrears),
    plannedAnnualCost: Math.min(1_000_000_000, plannedAnnualCost),
    executionCapacity: Math.min(1000, executionCapacity(world, patronNationId)),
    rationale:
      `National sphere priority: ${targetName}. Treasury ${patron.stats.treasury}; ` +
      `${committedAnnualCost + arrears} annualized commitments and arrears; ` +
      `${availableTreasury} remains before new terms. Target plans remain independent.`,
  });
}
const later = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
function preview(w: WorldState, commands: WorldCommand[], run: string) {
  if (!commands.length) return w;
  run = `${run}-${w.revision}`;
  return resolveTurn(
    w,
    {
      expectedRevision: w.revision,
      action: {
        actorNationId: w.playerNationId,
        source: 'system',
        text: 'Validate government proposals',
      },
      commands: commands.map((command, i) => ({
        id: CommandId.parse(`command:${run}-preview-${i}`),
        reason: 'Validated proposal',
        command,
      })),
    },
    {
      turnId: TurnId.parse(`turn:${run}-preview`),
      actionId: ActionId.parse(`action:${run}-preview`),
      recordedAt: '2026-10-02T00:00:00.000Z',
    },
  );
}
function actionFamily(c: WorldCommand): string {
  if (['START_INITIATIVE', 'CANCEL_INITIATIVE'].includes(c.type))
    return 'project';
  if (
    [
      'START_CONFLICT',
      'END_CONFLICT',
      'UPDATE_CONFLICT',
      'CONFLICT_ACTION',
      'THEATER_ACTION',
      'MOBILIZE_FORCE',
      'STRATEGIC_ATTACK',
    ].includes(c.type)
  )
    return 'war';
  if (
    [
      'OPEN_NEGOTIATION',
      'RESPOND_NEGOTIATION',
      'CREATE_TREATY',
      'UPDATE_TREATY',
      'END_TREATY',
      'ADJUST_RELATION',
    ].includes(c.type)
  )
    return 'diplomacy';
  if (
    [
      'CREATE_ORGANIZATION',
      'INVITE_TO_ORGANIZATION',
      'RESPOND_ORGANIZATION_INVITATION',
      'SET_ORGANIZATION_MEMBERSHIP',
      'UPDATE_ORGANIZATION',
      'OPEN_CONFERENCE',
      'RESPOND_CONFERENCE',
    ].includes(c.type)
  )
    return 'organization';
  if (['OPEN_CRISIS', 'CRISIS_ACTION'].includes(c.type)) return 'crisis';
  if (['IMPOSE_SANCTION', 'LIFT_SANCTION'].includes(c.type)) return 'sanctions';
  if (
    [
      'SET_ECONOMIC_LINK',
      'TRANSFER_OWNERSHIP',
      'TRANSFER_CONTROL',
      'ADD_CLAIM',
      'REMOVE_CLAIM',
    ].includes(c.type)
  )
    return 'economy';
  return 'domestic';
}
function pressured(w: WorldState, actor: NationId) {
  return (
    urgentWar(w, actor) ||
    w.sanctions.some(
      (s) => s.status === 'active' && s.intensity >= 60 && s.target === actor,
    ) ||
    w.crises.some(
      (c) =>
        c.status !== 'resolved' &&
        c.severity >= 60 &&
        c.participants.includes(actor),
    )
  );
}
function urgentWar(w: WorldState, actor: NationId) {
  const own = w.nations.find((n) => n.id === actor)!;
  return w.conflicts.some((f) => {
    if (
      f.status !== 'active' ||
      ![...f.attackers, ...f.defenders].includes(actor)
    )
      return false;
    const opponents = f.attackers.includes(actor) ? f.defenders : f.attackers;
    return (
      f.exhaustion >= 55 ||
      own.stats.fiscal < 30 ||
      own.stats.unrest >= 70 ||
      w.regions.some(
        (r) =>
          r.ownerNationId === actor && opponents.includes(r.controllerNationId),
      )
    );
  });
}
function frontObjective(
  w: WorldState,
  conflict: WorldState['conflicts'][number],
  actor: NationId,
) {
  const own = conflict.attackers.includes(actor)
    ? conflict.attackers
    : conflict.defenders;
  const enemy =
    own === conflict.attackers ? conflict.defenders : conflict.attackers;
  const adjacency = new Map(
    w.scenario.regionAdjacency.map((entry) => [
      entry.regionId,
      entry.neighbors,
    ]),
  );
  const regionsById = new Map(w.regions.map((region) => [region.id, region]));
  const enemyRegionIds = new Set(
    w.regions
      .filter((region) => enemy.includes(region.controllerNationId))
      .map((region) => region.id),
  );
  const reachable = new Set<RegionId>();
  for (const region of w.regions) {
    if (!own.includes(region.controllerNationId)) continue;
    for (const neighborId of adjacency.get(region.id) ?? [])
      if (enemyRegionIds.has(neighborId)) reachable.add(neighborId);
  }
  const neighborNations = new Set(
    w.scenario.neighborhoods?.find((entry) => entry.nationId === actor)
      ?.neighbors ?? [],
  );
  const targets = [...reachable]
    .map((id) => regionsById.get(id)!)
    .concat(
      !w.scenario.regionAdjacency.some((entry) => entry.neighbors.length) &&
        w.regions.length <= 500
        ? w.regions.filter(
            (region) =>
              enemy.includes(region.controllerNationId) &&
              neighborNations.has(region.ownerNationId) &&
              w.regions.some((friendly) =>
                own.includes(friendly.controllerNationId),
              ),
          )
        : [],
    );
  return targets.sort((a, b) => a.id.localeCompare(b.id))[0];
}

function strategicInfluenceCandidate(
  w: WorldState,
  patronNationId: NationId,
  subjectNationId: NationId,
  run: string,
) {
  const patron = w.nations.find((nation) => nation.id === patronNationId);
  const subject = w.nations.find((nation) => nation.id === subjectNationId);
  if (!patron || !subject || patronNationId === subjectNationId) return null;
  const previous = patron.strategy.influencePlans.find(
    (plan) => plan.targetNationId === subjectNationId,
  );
  if (
    !previous &&
    patron.strategy.influencePlans.filter((plan) => plan.status === 'active')
      .length >= 4
  )
    return null;
  const desiredTier = previous?.desiredTier ?? 'SUBJECT STATE';
  const plan = buildInfluenceStrategyPlan(
    w,
    patronNationId,
    subjectNationId,
    desiredTier,
  );
  if (plan.status !== 'active' || plan.nextStep.kind === 'wait') return null;
  const open = w.negotiations.some(
    (negotiation) =>
      negotiation.kind === 'influence' &&
      negotiation.status === 'open' &&
      [negotiation.proposerNationId, negotiation.recipientNationId].includes(
        patronNationId,
      ) &&
      [negotiation.proposerNationId, negotiation.recipientNationId].includes(
        subjectNationId,
      ),
  );
  if (open) return null;
  const existingTerms = w.treaties
    .filter(
      (treaty) =>
        treaty.kind === 'influence' &&
        treaty.status === 'active' &&
        treaty.parties.includes(patronNationId) &&
        treaty.parties.includes(subjectNationId),
    )
    .flatMap((treaty) => treaty.influenceTerms)
    .filter(
      (term) =>
        term.status === 'active' &&
        term.patronNationId === patronNationId &&
        term.subjectNationId === subjectNationId,
    );
  const missing = (kind: InfluenceTerm['kind']) =>
    !existingTerms.some((term) => term.kind === kind);
  const targetCapacity = Math.max(
    12,
    12 *
      Math.max(
        1,
        Math.floor((subject.stats.economy + subject.stats.fiscal) / 25),
      ),
  );
  const recentRejection = plan.rejectedObligations.at(-1);
  const strongerCompensation =
    recentRejection?.reasonCode === 'uncertain-benefit' ||
    recentRejection?.reasonCode === 'inadequate-compensation' ||
    recentRejection?.reasonCode === 'rival-offer' ||
    recentRejection?.reasonCode === 'sovereignty-cost' ||
    recentRejection?.reasonCode === 'insufficient-leverage' ||
    recentRejection?.reasonCode === 'resistance' ||
    recentRejection?.reasonCode === 'low-trust' ||
    recentRejection?.reasonCode === 'patron-unreliable';
  const terms: WorldState['negotiations'][number]['influenceTerms'] = [];
  const add = (kind: InfluenceTerm['kind'], amount = 0) => {
    if (!missing(kind) || terms.some((term) => term.kind === kind)) return;
    terms.push(
      InfluenceTerm.parse({
        kind,
        patronNationId,
        subjectNationId,
        amount,
      }),
    );
  };
  const needsEnergy = subject.stats.energyExposure >= 58;
  const needsInvestment =
    subject.stats.industrial < 75 || subject.stats.fiscal < 48;
  const existingMonthlyCommitments = w.treaties
    .filter(
      (treaty) => treaty.status === 'active' && treaty.kind === 'influence',
    )
    .flatMap((treaty) => treaty.influenceTerms)
    .filter(
      (term) =>
        term.status === 'active' &&
        term.patronNationId === patronNationId &&
        ['subsidy', 'infrastructure-investment', 'energy-supply'].includes(
          term.kind,
        ),
    )
    .reduce((sum, term) => sum + term.amount, 0);
  const compensationRejections = plan.rejectedObligations.filter(
    (rejection) =>
      rejection.date >=
        new Date(Date.parse(w.date) - 5 * 365 * 86_400_000)
          .toISOString()
          .slice(0, 10) &&
      [
        'uncertain-benefit',
        'inadequate-compensation',
        'rival-offer',
        'sovereignty-cost',
        'insufficient-leverage',
        'resistance',
        'low-trust',
        'patron-unreliable',
      ].includes(rejection.reasonCode),
  ).length;
  const debtReliefBudgetShare = strongerCompensation
    ? Math.min(0.65, 0.2 + compensationRejections * 0.15)
    : 0.1;
  const debtRelief = Math.min(
    subject.stats.debt,
    Math.floor(patron.stats.treasury * debtReliefBudgetShare),
  );
  const maxAffordableMonthly = Math.max(
    0,
    Math.floor(
      (patron.stats.treasury - existingMonthlyCommitments * 36 - debtRelief) /
        36,
    ),
  );
  const supportDemand = strongerCompensation
    ? Math.max(
        10,
        Math.floor(targetCapacity * 0.15) *
          (1 + Math.min(2, compensationRejections)),
      )
    : Math.max(1, Math.min(5, Math.floor(targetCapacity * 0.12)));
  const affordableMonthlySupport = Math.min(
    supportDemand,
    maxAffordableMonthly,
  );
  const mayPayRecurring = affordableMonthlySupport > 0;
  const authorityKinds = new Set<InfluenceTerm['kind']>([
    'foreign-policy-consultation',
    'foreign-policy-alignment',
    'no-rival-alliance',
    'foreign-policy-veto',
    'join-defensive-wars',
    'join-patron-wars',
    'war-declaration-approval',
    'no-war-against-patron',
    'military-access',
    'host-bases',
    'military-planning',
  ]);
  const rejectedSupportKinds =
    recentRejection &&
    !recentRejection.requestedKinds.some((kind) => authorityKinds.has(kind)) &&
    [
      'uncertain-benefit',
      'inadequate-compensation',
      'rival-offer',
      'sovereignty-cost',
      'insufficient-leverage',
      'resistance',
      'low-trust',
      'patron-unreliable',
    ].includes(recentRejection.reasonCode)
      ? new Set(recentRejection.requestedKinds)
      : new Set<InfluenceTerm['kind']>();
  const recurringSupportKinds = [
    needsEnergy && !rejectedSupportKinds.has('energy-supply'),
    needsInvestment && !rejectedSupportKinds.has('infrastructure-investment'),
    (subject.stats.unrest >= 20 || (!needsEnergy && !needsInvestment)) &&
      !rejectedSupportKinds.has('subsidy'),
  ].filter(Boolean).length;
  let supportBudgetRemainder =
    affordableMonthlySupport % Math.max(1, recurringSupportKinds);
  const perRecurringSupport = Math.floor(
    affordableMonthlySupport / Math.max(1, recurringSupportKinds),
  );
  const recurringSupportAmount = () => {
    const amount = perRecurringSupport + (supportBudgetRemainder > 0 ? 1 : 0);
    supportBudgetRemainder = Math.max(0, supportBudgetRemainder - 1);
    return Math.min(12, amount);
  };
  if (
    needsEnergy &&
    mayPayRecurring &&
    missing('energy-supply') &&
    !rejectedSupportKinds.has('energy-supply')
  )
    add('energy-supply', recurringSupportAmount());
  if (
    needsInvestment &&
    mayPayRecurring &&
    !rejectedSupportKinds.has('infrastructure-investment')
  )
    add('infrastructure-investment', recurringSupportAmount());
  if (
    subject.stats.debt >= 20 &&
    debtRelief >= 10 &&
    missing('debt-relief') &&
    !rejectedSupportKinds.has('debt-relief')
  )
    add('debt-relief', debtRelief);
  if (mayPayRecurring && (subject.stats.unrest >= 20 || !terms.length))
    add('subsidy', recurringSupportAmount());
  if (rejectedSupportKinds.size > 0 && missing('market-access-concession'))
    add('market-access-concession');
  if (
    missing('preferential-trade') &&
    terms.length < 4 &&
    !rejectedSupportKinds.has('preferential-trade')
  )
    add('preferential-trade');
  if (
    subject.stats.military < patron.stats.military &&
    missing('security-guarantee') &&
    ['build-security-reliance', 'reduce-rival-options'].includes(
      plan.nextStep.kind,
    )
  )
    add('security-guarantee');
  const rejectedSovereignty = plan.rejectedObligations.some(
    (rejection) =>
      ['sovereignty-cost', 'insufficient-leverage', 'resistance'].includes(
        rejection.reasonCode,
      ) &&
      rejection.date >=
        new Date(Date.parse(w.date) - 5 * 365 * 86_400_000)
          .toISOString()
          .slice(0, 10),
  );
  for (const kind of plan.nextStep.requestedTerms) {
    if (
      rejectedSovereignty &&
      [
        'foreign-policy-veto',
        'foreign-policy-alignment',
        'no-rival-alliance',
      ].includes(kind)
    )
      continue;
    add(kind);
  }
  const substantiveSupport = terms.some((term) =>
    [
      'subsidy',
      'infrastructure-investment',
      'debt-relief',
      'energy-supply',
      'security-guarantee',
      'preferential-trade',
      'market-access-concession',
    ].includes(term.kind),
  );
  if (
    plan.nextStep.requestedTerms.length > 0 &&
    !substantiveSupport &&
    missing('market-access-concession')
  )
    add('market-access-concession');
  if (!terms.length) return null;
  const supportClauses = terms
    .filter((term) =>
      [
        'subsidy',
        'infrastructure-investment',
        'debt-relief',
        'energy-supply',
        'security-guarantee',
        'preferential-trade',
        'market-access-concession',
      ].includes(term.kind),
    )
    .map((term) => term.kind.replaceAll('-', ' '));
  const authorityClauses = terms
    .filter((term) =>
      [
        'foreign-policy-consultation',
        'foreign-policy-alignment',
        'no-rival-alliance',
        'foreign-policy-veto',
        'join-defensive-wars',
        'war-declaration-approval',
      ].includes(term.kind),
    )
    .map((term) => term.kind.replaceAll('-', ' '));
  const offerText = supportClauses.length
    ? `The patron offers ${supportClauses.join(', ')}.`
    : 'The patron offers a dependable continuation of existing economic and security cooperation.';
  const requestText = authorityClauses.length
    ? ` In return, the parties consider ${authorityClauses.join(', ')}; the target retains authority beyond these exact clauses.`
    : ' No foreign-policy veto or alliance restriction is requested at this stage.';
  const name = subject.name;
  const negotiation = Negotiation.parse({
    id: `negotiation:${run}-${patronNationId.slice(7)}-${subjectNationId.slice(7)}-sphere`,
    proposerNationId: patronNationId,
    recipientNationId: subjectNationId,
    topic: `${name} strategic partnership`,
    kind: 'influence',
    terms: `${offerText}${requestText} This proposal reflects ${plan.nextStep.rationale}`,
    createdDate: w.date,
    expiresDate: later(w.date, 240),
    influenceTerms: terms,
  });
  const strategy = {
    ...patron.strategy,
    influencePlans: [
      ...patron.strategy.influencePlans.filter(
        (candidate) => candidate.targetNationId !== subjectNationId,
      ),
      plan,
    ].slice(-20),
  };
  return {
    plan,
    strategy,
    negotiation,
    id: `sphere-step-${subjectNationId.slice(7)}-${plan.nextStep.kind}`,
    label: `Advance the ${name} sphere strategy: ${plan.nextStep.rationale} Offer ${offerText}${requestText}`,
  };
}

export function compactCandidates(
  w: WorldState,
  actor: NationId,
  run: string,
  intent: PlayerIntent | null,
  focusedInfluenceTargets: readonly NationId[] = [],
): Candidate[] {
  const own = w.nations.find((n) => n.id === actor)!;
  const player = intent?.actorNationId === actor;
  const candidates: Candidate[] = [
    {
      id: 'wait',
      label:
        'Monitor events; continue existing policies; preserve resources. No new announcement.',
      commands: [],
      family: 'wait',
    },
  ];
  if (
    player &&
    /continue|review|preserve|monitor|maintain/i.test(intent.summary) &&
    !/start|begin|fund a|launch|build|increase|expand|cancel|stop|suspend/i.test(
      intent.summary,
    )
  )
    return candidates;
  const add = (
    id: string,
    label: string,
    commands: WorldCommand[],
    family: string,
  ) => {
    if (
      player &&
      commands.some((c) => semanticCommandIssue(w, intent?.actionGraph, c))
    )
      return;
    if (commands.some((c) => repetitionIssue(w, c, player ? actor : null)))
      return;
    try {
      if (w.regions.length > 1000) {
        // Candidate recipes are code-authored and later pass the complete
        // sequential resolver before commit. Avoid cloning, parsing and
        // asserting the entire regional world once for every option shown to
        // a planner; schema and intent checks still run for each recipe here.
        commands.forEach((command) => WorldCommandSchema.parse(command));
      } else {
        preview(w, commands, run);
      }
      candidates.push({ id, label, commands, family });
    } catch {
      /* Invalid options never reach inference. */
    }
  };
  if (!player) {
    // Persistent breaches are a decision docket for both sides. The injured
    // government can escalate proportionately; the violator can offer a
    // sourced renegotiation rather than waiting for the crisis to decay by
    // itself.
    for (const pact of w.treaties.filter(
      (treaty) =>
        treaty.kind === 'influence' &&
        treaty.status === 'active' &&
        treaty.parties.includes(actor),
    )) {
      for (const breach of pact.breaches.filter(
        (entry) => entry.status !== 'resolved' && entry.severity >= 25,
      )) {
        if (breach.injuredNationId === actor) {
          const peer = breach.violatingNationId;
          const obligationIndex = breach.obligationKey
            ? Number(/-term-(\d+)$/.exec(breach.obligationKey)?.[1])
            : Number.NaN;
          const obligation = Number.isFinite(obligationIndex)
            ? pact.influenceTerms[obligationIndex]
            : pact.influenceTerms.find(
                (term) =>
                  term.patronNationId !== term.subjectNationId &&
                  [term.patronNationId, term.subjectNationId].includes(actor) &&
                  [term.patronNationId, term.subjectNationId].includes(peer),
              );
          const shared = {
            treatyId: pact.id,
            breachId: breach.id,
            patronNationId: obligation?.patronNationId ?? pact.parties[0]!,
            subjectNationId: obligation?.subjectNationId ?? pact.parties[1]!,
            actingNationId: actor,
          };
          const enforce = (
            action: Extract<
              WorldCommand,
              { type: 'ENFORCE_TREATY_BREACH' }
            >['action'],
            label: string,
            amount?: number,
          ) =>
            add(
              `breach-${breach.id.slice(7)}-${action}`,
              `${label} against ${w.nations.find((nation) => nation.id === peer)!.name} for ${breach.reason}. This episode is ${breach.durationMonths} months old, with ${breach.missedInstallments} missed installments, ${breach.arrearsAmount} arrears and severity ${breach.severity}/100.`,
              [
                {
                  type: 'ENFORCE_TREATY_BREACH',
                  ...shared,
                  enforcementId: `enforcement:${run}-${breach.id.slice(7)}-${action}`,
                  action,
                  ...(amount ? { amount } : {}),
                },
              ],
              'diplomacy',
            );
          if (
            !breach.milestones.some((milestone) => milestone.key === 'demanded')
          )
            enforce('diplomatic-demand', 'Issue a formal compliance demand');
          if (
            breach.arrearsAmount > 0 &&
            pact.influenceTerms.some(
              (term) =>
                term.status === 'active' &&
                term.arrears > 0 &&
                (breach.violatingNationId === term.patronNationId
                  ? ['subsidy', 'infrastructure-investment'].includes(term.kind)
                  : ['tribute', 'debt-repayment'].includes(term.kind)),
            )
          )
            enforce('demand-arrears', 'Collect the overdue installments');
          if (
            !w.negotiations.some(
              (negotiation) =>
                negotiation.status === 'open' &&
                negotiation.sourceBreachId === breach.id,
            )
          )
            enforce('renegotiate', 'Open a breach settlement negotiation');
          if (
            breach.severity >= 50 &&
            !pact.enforcements.some(
              (entry) =>
                entry.breachId === breach.id &&
                entry.action === 'suspend-reciprocals',
            ) &&
            pact.influenceTerms.some(
              (term) =>
                term.status === 'active' &&
                term.patronNationId === actor &&
                term.subjectNationId === peer,
            )
          )
            enforce('suspend-reciprocals', 'Suspend reciprocal obligations');
          if (
            breach.severity >= 60 &&
            !pact.enforcements.some(
              (entry) =>
                entry.breachId === breach.id &&
                entry.action === 'political-pressure',
            )
          )
            enforce('political-pressure', 'Apply political pressure');
          if (
            breach.severity >= 75 &&
            !pact.enforcements.some(
              (entry) =>
                entry.breachId === breach.id && entry.action === 'sanction',
            )
          )
            enforce('sanction', 'Impose targeted trade sanctions');
          if (breach.severity >= 85 && breach.durationMonths >= 12)
            enforce('terminate', 'Terminate the breached agreement');
          if (breach.severity <= 40)
            enforce('waive', 'Waive this limited breach');
        } else if (breach.violatingNationId === actor) {
          const injured = breach.injuredNationId;
          const openSettlement = w.negotiations.some(
            (negotiation) =>
              negotiation.status === 'open' &&
              negotiation.sourceBreachId === breach.id,
          );
          if (!openSettlement) {
            const negotiation = Negotiation.parse({
              id: `negotiation:${run}-${breach.id.slice(7)}-settlement`,
              proposerNationId: actor,
              recipientNationId: injured,
              kind: 'influence',
              topic: `Settlement of ${pact.name} breach`,
              terms: `Propose a reviewable settlement for ${breach.reason}; suspend the defaulted obligation while arrears, compensation or a feasible replacement schedule are negotiated.`,
              createdDate: w.date,
              expiresDate: later(w.date, 180),
              sourceBreachId: breach.id,
              influenceTerms: [],
            });
            add(
              `offer-breach-settlement-${breach.id.slice(7)}`,
              `Offer ${w.nations.find((nation) => nation.id === injured)!.name} a sourced renegotiation for this ${breach.durationMonths}-month breach, addressing ${breach.missedInstallments} missed installments and ${breach.arrearsAmount} arrears.`,
              [{ type: 'OPEN_NEGOTIATION', negotiation }],
              'diplomacy',
            );
          }
        }
      }
    }
    for (const pact of w.treaties.filter(
      (treaty) =>
        treaty.kind === 'influence' &&
        treaty.status === 'active' &&
        treaty.parties.includes(actor),
    )) {
      const patrons = new Set(
        pact.influenceTerms
          .filter((term) => term.subjectNationId === actor)
          .map((term) => term.patronNationId),
      );
      for (const patron of patrons) {
        const profile = influenceProfile(w, patron, actor);
        const terms = pact.influenceTerms.filter(
          (term) =>
            term.subjectNationId === actor && term.patronNationId === patron,
        );
        const arrears = terms.reduce((sum, term) => sum + term.arrears, 0);
        // A government may tolerate a restrictive pact while its bills are
        // current, but sustained nonpayment can trigger an exit even when
        // dependence keeps ordinary sovereignty resistance below the usual
        // threshold.
        if (profile.resistance < 65 && arrears < 6) continue;
        add(
          `end-influence-agreement-${pact.id.slice(7)}-${actor.slice(7)}`,
          `End ${pact.name} with ${w.nations.find((nation) => nation.id === patron)!.name}. Sovereignty resistance ${profile.resistance}/100, leverage ${profile.leverage}/100 and payment arrears ${arrears}; ending it will strain relations and domestic stability but restore policy freedom.`,
          [{ type: 'END_TREATY', treatyId: pact.id, nationId: actor }],
          'diplomacy',
        );
      }
    }
  }
  const invitations = w.organizations.flatMap((organization) =>
    organization.status === 'active'
      ? organization.invitations
          .filter(
            (invitation) =>
              invitation.nationId === actor &&
              invitation.status === 'pending' &&
              invitation.lastMove !== 'counter',
          )
          .map(() => organization)
      : [],
  );
  for (const organization of invitations.slice(0, 2)) {
    const activeTerms = organization.commitments
      .filter((commitment) => commitment.status === 'active')
      .map(
        (commitment) =>
          `${commitment.terms}${commitment.costPerMember ? ` (cost ${commitment.costPerMember} per member every ${commitment.frequencyDays} days)` : ''}`,
      )
      .join('; ');
    for (const move of ['accept', 'reject', 'delay', 'counter'] as const) {
      const command: WorldCommand = {
        type: 'RESPOND_ORGANIZATION_INVITATION',
        organizationId: organization.id,
        nationId: actor,
        move,
        message:
          move === 'accept'
            ? 'The government accepts the invitation.'
            : move === 'reject'
              ? 'The government declines membership.'
              : move === 'counter'
                ? 'The government requests revised membership terms.'
                : 'The government will decide later.',
        ...(move === 'counter'
          ? {
              counterTerms:
                'Clarify the obligations and fiscal terms before membership.',
            }
          : {}),
      };
      add(
        `org-invitation-${organization.id.slice(13)}-${move}`,
        `${move} ${organization.acronym ?? organization.name} invitation. Purpose: ${organization.purpose} Current terms: ${activeTerms || organization.charter}. Consider national interests, cost, sovereignty, and domestic support.`,
        [command],
        'organization',
      );
    }
  }

  const neighbors =
    w.scenario.neighborhoods?.find((entry) => entry.nationId === actor)
      ?.neighbors ?? [];
  const establishedEconomicMembership = w.organizations.some(
    (organization) =>
      organization.status === 'active' &&
      ['economic', 'economic-union', 'trade-bloc', 'customs-union'].includes(
        organization.kind,
      ) &&
      organization.members.includes(actor),
  );
  const cooperativeNeighbors = neighbors
    .filter((id) => {
      const relation = w.relations.find(
        (entry) =>
          [entry.nationA, entry.nationB].includes(actor) &&
          [entry.nationA, entry.nationB].includes(id),
      );
      return relation?.score !== undefined && relation.score >= 25;
    })
    .sort((left, right) => {
      const score = (id: NationId) =>
        w.relations.find(
          (entry) =>
            [entry.nationA, entry.nationB].includes(actor) &&
            [entry.nationA, entry.nationB].includes(id),
        )?.score ?? 0;
      return score(right) - score(left) || left.localeCompare(right);
    })
    .slice(0, 3);
  if (
    !player &&
    !urgentWar(w, actor) &&
    (w.scenario.strategicActors?.includes(actor) ||
      own.stats.economy + own.stats.military >= 125 ||
      (own.stats.economy >= 35 && own.stats.military >= 55) ||
      focusedInfluenceTargets.length > 0)
  ) {
    const directNeighbors = new Set(neighbors);
    const relevantTargets = new Set<NationId>([
      ...neighbors,
      ...focusedInfluenceTargets,
      ...own.strategy.influencePlans
        .filter((plan) => plan.status === 'active')
        .map((plan) => plan.targetNationId),
      ...w.economicLinks
        .filter((link) => link.dependentNationId !== actor)
        .map((link) => link.dependentNationId),
      ...w.organizations
        .filter(
          (organization) =>
            organization.status === 'active' &&
            (organization.members.includes(actor) ||
              organization.members.some((member) =>
                directNeighbors.has(member),
              )),
        )
        .flatMap((organization) => organization.members),
    ]);
    const sphereTargets = [...relevantTargets]
      .filter(
        (id) => id !== actor && w.nations.some((nation) => nation.id === id),
      )
      .map((id) => {
        const targetNation = w.nations.find((nation) => nation.id === id)!;
        const relation = w.relations.find(
          (entry) =>
            [entry.nationA, entry.nationB].includes(actor) &&
            [entry.nationA, entry.nationB].includes(id),
        );
        const profile = influenceProfile(w, actor, id);
        const rivalHasLeverage = w.nations.some(
          (other) =>
            other.id !== actor &&
            influenceProfile(w, other.id, id).leverage >= profile.leverage + 8,
        );
        const need =
          Math.max(0, 50 - targetNation.stats.fiscal) +
          Math.max(0, targetNation.stats.unrest - 15) +
          Math.max(0, targetNation.stats.energyExposure - 55);
        const activePlan = own.strategy.influencePlans.some(
          (plan) => plan.targetNationId === id && plan.status === 'active',
        );
        return {
          id,
          relevance:
            (directNeighbors.has(id) ? 35 : 0) +
            (focusedInfluenceTargets.includes(id) ? 100 : 0) +
            (activePlan ? 80 : 0) +
            (rivalHasLeverage ? 24 : 0) +
            Math.min(30, need) +
            (relation?.score ?? 0) * 0.25 +
            (relation?.trust ?? 50) * 0.1,
          relationScore: relation?.score ?? 0,
          leverage: profile.leverage,
        };
      })
      .filter(
        (entry) =>
          entry.relationScore >= -25 ||
          entry.leverage > 0 ||
          own.strategy.influencePlans.some(
            (plan) =>
              plan.targetNationId === entry.id && plan.status === 'active',
          ),
      )
      .sort((a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id))
      .slice(0, 3);
    for (const { id: target } of sphereTargets) {
      const candidate = strategicInfluenceCandidate(w, actor, target, run);
      if (candidate) {
        add(
          candidate.id,
          candidate.label,
          [
            {
              type: 'SET_STRATEGY',
              nationId: actor,
              strategy: candidate.strategy,
            },
            { type: 'OPEN_NEGOTIATION', negotiation: candidate.negotiation },
          ],
          'diplomacy',
        );
      } else {
        const priorPlan = own.strategy.influencePlans.find(
          (plan) => plan.targetNationId === target,
        );
        if (
          !priorPlan &&
          own.strategy.influencePlans.filter((plan) => plan.status === 'active')
            .length >= 4
        )
          continue;
        const plan = buildInfluenceStrategyPlan(
          w,
          actor,
          target,
          priorPlan?.desiredTier ?? 'SUBJECT STATE',
        );
        const agedReview =
          !priorPlan ||
          later(priorPlan.reviewedDate, 180) <= w.date ||
          priorPlan.currentTier !== plan.currentTier ||
          priorPlan.nextStep.kind !== plan.nextStep.kind ||
          priorPlan.status !== plan.status;
        const alreadyNegotiating = w.negotiations.some(
          (negotiation) =>
            negotiation.kind === 'influence' &&
            negotiation.status === 'open' &&
            [
              negotiation.proposerNationId,
              negotiation.recipientNationId,
            ].includes(actor) &&
            [
              negotiation.proposerNationId,
              negotiation.recipientNationId,
            ].includes(target),
        );
        if (!agedReview || alreadyNegotiating) continue;
        const strategy = {
          ...own.strategy,
          influencePlans: [
            ...own.strategy.influencePlans.filter(
              (entry) => entry.targetNationId !== target,
            ),
            plan,
          ].slice(-20),
        };
        add(
          `review-sphere-${target.slice(7)}`,
          `Review the ${w.nations.find((nation) => nation.id === target)!.name} sphere plan. Current tier ${plan.currentTier}; leverage ${plan.leverage}/100; resistance ${plan.resistance}/100; patron reliability ${plan.patronReliability}/100. Next realistic step: ${plan.nextStep.rationale}`,
          [{ type: 'SET_STRATEGY', nationId: actor, strategy }],
          'diplomacy',
        );
      }
    }

    // A dependent government may spend scarce capacity on domestic substitutes
    // when one patron dominates a material channel or has become unreliable.
    const subjectPatrons = [
      ...new Set(
        w.treaties
          .filter(
            (treaty) =>
              treaty.kind === 'influence' &&
              treaty.status === 'active' &&
              treaty.parties.includes(actor),
          )
          .flatMap((treaty) =>
            treaty.influenceTerms
              .filter(
                (term) =>
                  term.status === 'active' && term.subjectNationId === actor,
              )
              .map((term) => term.patronNationId),
          ),
      ),
    ];
    const principalPatron = subjectPatrons
      .map((patron) => ({
        patron,
        profile: influenceProfile(w, patron, actor),
      }))
      .sort((left, right) => right.profile.leverage - left.profile.leverage)[0];
    if (
      principalPatron &&
      principalPatron.profile.leverage >= 25 &&
      (principalPatron.profile.reliability < 60 ||
        Math.max(
          principalPatron.profile.dependency.energy,
          principalPatron.profile.dependency.trade,
          principalPatron.profile.dependency.finance,
        ) >= 55)
    ) {
      const kind: 'energy' | 'industry' =
        principalPatron.profile.dependency.energy >= 45 ||
        own.stats.energyExposure >= 58
          ? 'energy'
          : 'industry';
      const lastDiversification = w.initiatives
        .filter(
          (initiative) =>
            initiative.nationId === actor &&
            initiative.name.startsWith('Strategic autonomy:') &&
            initiative.status !== 'cancelled',
        )
        .sort((left, right) =>
          right.startDate.localeCompare(left.startDate),
        )[0];
      const coolingOff =
        !lastDiversification ||
        lastDiversification.startDate <= later(w.date, -730);
      const activeSameProject = w.initiatives.some(
        (initiative) =>
          initiative.nationId === actor &&
          initiative.kind === kind &&
          initiative.name.startsWith('Strategic autonomy:') &&
          initiative.status === 'active',
      );
      if (
        coolingOff &&
        !activeSameProject &&
        own.stats.stability >= 35 &&
        own.stats.treasury >= 24
      ) {
        const projectName =
          kind === 'energy'
            ? 'Strategic autonomy: domestic energy substitution'
            : 'Strategic autonomy: domestic industrial alternatives';
        add(
          `autonomy-diversification-${kind}`,
          `Invest in ${kind === 'energy' ? 'energy substitution' : 'domestic industrial capacity'} to preserve policy options while retaining useful patron benefits. The leading patron has ${principalPatron.profile.leverage}/100 leverage and ${principalPatron.profile.reliability}/100 delivery reliability.`,
          [
            {
              type: 'START_INITIATIVE',
              initiative: Initiative.parse({
                id: `initiative:${run}-${actor.slice(7)}-autonomy-${kind}`,
                nationId: actor,
                name: projectName,
                kind,
                effort: 2,
                startDate: w.date,
                durationDays: 360,
                visibility: 'public',
              }),
            },
          ],
          'project',
        );
      }
    }

    const openBilateralInfluence = (target: NationId) =>
      w.negotiations.some(
        (negotiation) =>
          negotiation.kind === 'influence' &&
          negotiation.status === 'open' &&
          [
            negotiation.proposerNationId,
            negotiation.recipientNationId,
          ].includes(actor) &&
          [
            negotiation.proposerNationId,
            negotiation.recipientNationId,
          ].includes(target),
      );
    const alreadyProposedBilateralInfluence = (target: NationId) =>
      candidates.some((candidate) =>
        candidate.commands.some(
          (command) =>
            command.type === 'OPEN_NEGOTIATION' &&
            command.negotiation.kind === 'influence' &&
            [
              command.negotiation.proposerNationId,
              command.negotiation.recipientNationId,
            ].includes(actor) &&
            [
              command.negotiation.proposerNationId,
              command.negotiation.recipientNationId,
            ].includes(target),
        ),
      );
    const activeBilateralTerms = (target: NationId) =>
      w.treaties
        .filter(
          (treaty) =>
            treaty.kind === 'influence' &&
            treaty.status === 'active' &&
            treaty.parties.includes(actor) &&
            treaty.parties.includes(target),
        )
        .flatMap((treaty) => treaty.influenceTerms)
        .filter(
          (term) =>
            term.patronNationId === actor && term.subjectNationId === target,
        );

    const securityTarget = cooperativeNeighbors.find((target) => {
      const targetNation = w.nations.find((nation) => nation.id === target)!;
      const terms = activeBilateralTerms(target);
      return (
        !openBilateralInfluence(target) &&
        !alreadyProposedBilateralInfluence(target) &&
        influenceProfile(w, actor, target).leverage >= 18 &&
        own.stats.military >= targetNation.stats.military * 0.8 &&
        !terms.some((term) => term.kind === 'security-guarantee')
      );
    });
    if (securityTarget) {
      const targetName = w.nations.find(
        (nation) => nation.id === securityTarget,
      )!.name;
      const securityTerms = [
        InfluenceTerm.parse({
          kind: 'security-guarantee',
          patronNationId: actor,
          subjectNationId: securityTarget,
        }),
        InfluenceTerm.parse({
          kind: 'join-defensive-wars',
          patronNationId: actor,
          subjectNationId: securityTarget,
        }),
        InfluenceTerm.parse({
          kind: 'military-access',
          patronNationId: actor,
          subjectNationId: securityTarget,
        }),
      ];
      const negotiation = Negotiation.parse({
        id: `negotiation:${run}-${actor.slice(7)}-${securityTarget.slice(7)}-security-influence`,
        proposerNationId: actor,
        recipientNationId: securityTarget,
        kind: 'influence',
        topic: `Mutual security partnership with ${targetName}`,
        terms: `A defensive security guarantee and military access are offered to ${targetName}; the partner would join only defensive wars involving the patron.`,
        createdDate: w.date,
        expiresDate: later(w.date, 180),
        influenceTerms: securityTerms,
      });
      add(
        `offer-security-influence-${securityTarget.slice(7)}`,
        `Offer ${targetName} a security guarantee for a defensive pact and military access. The terms are optional and scoped to defensive wars.`,
        [{ type: 'OPEN_NEGOTIATION', negotiation }],
        'diplomacy',
      );
    }

    const coordinationTarget = cooperativeNeighbors.find((target) => {
      const terms = activeBilateralTerms(target);
      const relation = w.relations.find(
        (entry) =>
          [entry.nationA, entry.nationB].includes(actor) &&
          [entry.nationA, entry.nationB].includes(target),
      );
      return (
        !openBilateralInfluence(target) &&
        !alreadyProposedBilateralInfluence(target) &&
        influenceProfile(w, actor, target).leverage >= 30 &&
        (relation?.score ?? 0) >= 45 &&
        terms.some((term) => term.kind === 'security-guarantee') &&
        !terms.some((term) =>
          [
            'foreign-policy-consultation',
            'foreign-policy-alignment',
            'foreign-policy-veto',
          ].includes(term.kind),
        )
      );
    });
    if (coordinationTarget) {
      const targetName = w.nations.find(
        (nation) => nation.id === coordinationTarget,
      )!.name;
      const coordinationTerms = [
        InfluenceTerm.parse({
          kind: 'foreign-policy-consultation',
          patronNationId: actor,
          subjectNationId: coordinationTarget,
        }),
        InfluenceTerm.parse({
          kind: 'market-access-concession',
          patronNationId: actor,
          subjectNationId: coordinationTarget,
        }),
      ];
      const negotiation = Negotiation.parse({
        id: `negotiation:${run}-${actor.slice(7)}-${coordinationTarget.slice(7)}-policy-influence`,
        proposerNationId: actor,
        recipientNationId: coordinationTarget,
        kind: 'influence',
        topic: `Foreign-policy consultation with ${targetName}`,
        terms: `Preferential access to the patron's market is offered in exchange for consultation before major foreign-policy decisions. The subject retains the final decision.`,
        createdDate: w.date,
        expiresDate: later(w.date, 180),
        influenceTerms: coordinationTerms,
      });
      add(
        `offer-policy-influence-${coordinationTarget.slice(7)}`,
        `Offer ${targetName} additional market access in exchange for consultation before major foreign-policy decisions. The subject retains the final decision.`,
        [{ type: 'OPEN_NEGOTIATION', negotiation }],
        'diplomacy',
      );
    }
  }
  const establishedSecurityMembership = w.organizations.some(
    (organization) =>
      organization.status === 'active' &&
      ['alliance', 'military-alliance', 'defensive-pact'].includes(
        organization.kind,
      ) &&
      organization.members.includes(actor),
  );
  if (
    !player &&
    !urgentWar(w, actor) &&
    !establishedEconomicMembership &&
    own.stats.economy >= 40 &&
    cooperativeNeighbors.length >= 2
  ) {
    const name = `Regional Economic Cooperation of ${own.name}`;
    const id = OrganizationId.parse(
      'organization:' +
        run +
        '-' +
        actor.slice('nation:'.length) +
        '-regional-economic-cooperation',
    );
    if (!w.organizations.some((organization) => organization.id === id)) {
      const organization = Organization.parse({
        id,
        name,
        acronym: null,
        kind: 'economic-union',
        foundingDate: w.date,
        founders: [actor],
        members: [actor],
        invitedStates: [],
        invitations: [],
        pendingApplications: [],
        purpose:
          'Support gradual trade and economic cooperation among neighboring governments.',
        charter:
          'Voluntary economic coordination; each government decides independently whether to join.',
        commitments: [],
        geographicScope: 'Scenario-defined neighboring countries',
        history: [],
        status: 'active',
        dissolvedDate: null,
        visibility: 'public',
      });
      add(
        `form-regional-economic-cooperation-${actor.slice(7)}`,
        `Create ${name} and invite cooperative neighboring governments; membership remains voluntary and requires each government's independent acceptance.`,
        [
          { type: 'CREATE_ORGANIZATION', organization },
          ...cooperativeNeighbors.map((nationId): WorldCommand => ({
            type: 'INVITE_TO_ORGANIZATION',
            organizationId: id,
            inviterNationId: actor,
            nationId,
          })),
        ],
        'organization',
      );
    }
  }
  const threatenedNeighbors = neighbors.filter((partner) => {
    const relation = w.relations.find(
      (entry) =>
        [entry.nationA, entry.nationB].includes(actor) &&
        [entry.nationA, entry.nationB].includes(partner),
    );
    return (
      (relation?.tension ?? 0) >= 50 ||
      w.conflicts.some(
        (conflict) =>
          conflict.status === 'active' &&
          [...conflict.attackers, ...conflict.defenders].includes(partner),
      ) ||
      w.crises.some(
        (crisis) =>
          crisis.status !== 'resolved' &&
          crisis.severity >= 55 &&
          crisis.participants.includes(partner),
      )
    );
  });
  if (
    !player &&
    !establishedSecurityMembership &&
    !urgentWar(w, actor) &&
    own.stats.military >= 40 &&
    threatenedNeighbors.length > 0 &&
    cooperativeNeighbors.length > 0
  ) {
    const organizationId = OrganizationId.parse(
      `organization:${run}-${actor.slice(7)}-regional-defense-compact`,
    );
    const organization = Organization.parse({
      id: organizationId,
      name: `Regional Defense Compact of ${own.name}`,
      acronym: null,
      kind: 'defensive-pact',
      foundingDate: w.date,
      founders: [actor],
      members: [actor],
      invitedStates: [],
      invitations: [],
      pendingApplications: [],
      purpose:
        'Coordinate voluntary consultation and support when members face a shared regional threat.',
      charter:
        'Membership and each security response remain subject to independent government consent.',
      commitments: [],
      geographicScope: 'Scenario-defined neighboring countries',
      history: [],
      status: 'active',
      dissolvedDate: null,
      visibility: 'public',
    });
    add(
      `form-regional-defense-compact-${actor.slice(7)}`,
      `Form a voluntary regional defense compact and invite cooperative neighbors. ${threatenedNeighbors.length} neighboring states face elevated tension or an active regional crisis; responses remain independently decided.`,
      [
        { type: 'CREATE_ORGANIZATION', organization },
        ...cooperativeNeighbors.slice(0, 2).map((nationId): WorldCommand => ({
          type: 'INVITE_TO_ORGANIZATION',
          organizationId,
          inviterNationId: actor,
          nationId,
        })),
      ],
      'organization',
    );
  }
  const persistent =
    player &&
    /over the next|long.term|five years|strategy|standing|directive/i.test(
      intent.summary,
    ) &&
    !own.strategy.directives.some(
      (d) => d.status === 'active' && d.text === intent.summary,
    );
  const directive: WorldCommand[] =
    persistent && own.strategy.directives.length < 20
      ? [
          {
            type: 'SET_STRATEGY',
            nationId: actor,
            strategy: {
              ...own.strategy,
              directives: [
                ...own.strategy.directives,
                {
                  id: `${run}-directive`,
                  text: intent.summary,
                  visibility: intent.intentions.some(
                    (i) => i.visibility === 'private',
                  )
                    ? 'private'
                    : 'public',
                  status: 'active',
                  createdDate: w.date,
                  priority: 'high',
                },
              ],
            },
          },
        ]
      : [];
  if (directive.length)
    add(
      'directive',
      'Record this long-term policy and its wording constraints; no immediate investment',
      directive,
      'strategy',
    );
  const active = w.initiatives.filter(
    (i) => i.nationId === actor && i.status === 'active',
  );
  const war = w.conflicts.filter(
    (f) =>
      f.status === 'active' && [...f.attackers, ...f.defenders].includes(actor),
  );
  const sanctions = w.sanctions.filter(
    (s) => s.status === 'active' && s.target === actor,
  );
  const urgent =
    urgentWar(w, actor) ||
    w.crises.some(
      (c) =>
        c.status !== 'resolved' &&
        c.severity >= 55 &&
        c.participants.includes(actor),
    );
  const recentProjects = w.commands
    .filter(
      (c) => Date.parse(w.date) - Date.parse(c.simulationDate) < 180 * 86400000,
    )
    .slice(-100)
    .filter(
      (c) =>
        c.command.type === 'START_INITIATIVE' &&
        c.command.initiative.nationId === actor,
    ).length;
  const recentPolicy = w.commands
    .filter(
      (c) => Date.parse(w.date) - Date.parse(c.simulationDate) < 180 * 86400000,
    )
    .filter((c) => {
      const v = c.command;
      return v.type === 'START_INITIATIVE'
        ? v.initiative.nationId !== w.playerNationId
        : v.type === 'OPEN_NEGOTIATION'
          ? v.negotiation.proposerNationId !== w.playerNationId
          : 'nationId' in v &&
            v.nationId !== w.playerNationId &&
            !['SWITCH_NATION'].includes(v.type);
    });
  const recentProjectShare = recentPolicy.length
    ? recentPolicy.filter((c) => c.command.type === 'START_INITIATIVE').length /
      recentPolicy.length
    : 0;
  const projectBudget =
    player ||
    (!war.length &&
      !urgent &&
      recentProjects < 2 &&
      (recentPolicy.length < 4 || recentProjectShare < 0.6));
  if (
    projectBudget &&
    active.reduce((s, i) => s + i.effort, 0) < executionCapacity(w, actor)
  ) {
    for (const kind of [
      'energy',
      'industry',
      'reform',
      'rearmament',
      'diplomacy',
    ] as const) {
      const projectIntents =
        intent?.intentions.filter(
          (i) =>
            /\b(start|begin|fund|launch|build|increase|expand|invest|develop|reform|improve|diversify|reduce|stabilize)\b/i.test(
              i.description,
            ) &&
            !/^(do not|don't|avoid|without)\b/i.test(i.description.trim()) &&
            (kind === 'energy' || kind === 'industry'
              ? i.kind === 'economy'
              : kind === 'rearmament'
                ? i.kind === 'military'
                : kind === 'reform'
                  ? i.kind === 'domestic'
                  : i.kind === 'diplomacy'),
        ) ?? [];
      if (player && !projectIntents.length) continue;
      if (
        player &&
        /energy|nuclear|imports|supply/i.test(intent.summary) &&
        !/industry|industrial|manufactur/i.test(intent.summary) &&
        kind === 'industry'
      )
        continue;
      if (
        !player &&
        sanctions.some((s) => s.intensity >= 60) &&
        ['rearmament', 'diplomacy'].includes(kind)
      )
        continue;
      const label = `${kind === 'energy' ? 'Energy diversification' : kind === 'reform' ? 'Domestic resilience' : kind === 'rearmament' ? 'Defense readiness' : kind === 'industry' ? 'Industrial capacity' : 'Diplomatic outreach'} program`;
      add(
        `project-${kind}`,
        `${label}; 180 days; effort 2, funded monthly. ${sanctions.length && kind === 'energy' ? 'Build substitution capacity under sanctions.' : ''}`,
        [
          ...directive,
          {
            type: 'START_INITIATIVE',
            initiative: Initiative.parse({
              id: `initiative:${run}-${actor.slice(7)}-${kind}`,
              nationId: actor,
              name: label,
              kind,
              effort: 2,
              startDate: w.date,
              durationDays: 180,
              visibility:
                player && projectIntents.some((i) => i.visibility === 'private')
                  ? 'private'
                  : 'public',
            }),
          },
        ],
        'project',
      );
    }
  }
  if (player && /cancel|stop|suspend/i.test(intent.summary))
    for (const i of active)
      add(
        `cancel-${i.id}`,
        `Cancel ${i.name}; retain prior sunk investment`,
        [{ type: 'CANCEL_INITIATIVE', initiativeId: i.id }],
        'domestic',
      );
  const linked = w.economicLinks.filter((l) => l.dependentNationId === actor);
  const partners = [
    ...new Set([
      ...war.flatMap((f) => [...f.attackers, ...f.defenders]),
      ...(player ? intent.targetNationIds : []),
      ...(w.scenario.neighborhoods?.find((n) => n.nationId === actor)
        ?.neighbors ?? []),
      ...linked.map((l) => l.partnerNationId),
      ...w.relations
        .filter((r) => [r.nationA, r.nationB].includes(actor) && r.score > 25)
        .flatMap((r) => [r.nationA, r.nationB]),
    ]),
  ]
    .filter((id) => id !== actor)
    .slice(0, 8);
  if (!player && !war.length && own.stats.military >= 45) {
    const adjacency = new Map(
      w.scenario.regionAdjacency.map((entry) => [
        entry.regionId,
        new Set(entry.neighbors),
      ]),
    );
    const controlledByActor = new Set(
      w.regions
        .filter((region) => region.controllerNationId === actor)
        .map((region) => region.id),
    );
    for (const targetNationId of partners) {
      const relation = w.relations.find(
        (entry) =>
          [entry.nationA, entry.nationB].includes(actor) &&
          [entry.nationA, entry.nationB].includes(targetNationId),
      );
      const activeBorderCrisis = w.crises.some(
        (crisis) =>
          crisis.status !== 'resolved' &&
          crisis.severity >= 60 &&
          crisis.participants.includes(actor) &&
          crisis.participants.includes(targetNationId),
      );
      const strategicClaimGoal = w.goals.some(
        (goal) =>
          goal.nationId === actor &&
          goal.status !== 'achieved' &&
          goal.status !== 'failed' &&
          goal.status !== 'abandoned' &&
          goal.priority >= 60 &&
          goal.targetNationIds.includes(targetNationId),
      );
      if (
        !activeBorderCrisis &&
        !(
          strategicClaimGoal &&
          (relation?.score ?? 0) <= -45 &&
          (relation?.tension ?? 0) >= 60
        )
      )
        continue;
      const claimedFront = w.regions
        .filter(
          (region) =>
            region.ownerNationId === targetNationId &&
            region.controllerNationId === targetNationId &&
            region.claims.includes(actor) &&
            (adjacency.get(region.id)?.size
              ? [...(adjacency.get(region.id) ?? [])].some((neighbor) =>
                  controlledByActor.has(neighbor),
                )
              : neighbors.includes(targetNationId) &&
                w.regions.some(
                  (neighbor) =>
                    neighbor.ownerNationId === actor &&
                    controlledByActor.has(neighbor.id),
                )),
        )
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      const target = w.nations.find((nation) => nation.id === targetNationId)!;
      const protectedByTreaty = w.treaties.some(
        (treaty) =>
          treaty.status === 'active' &&
          treaty.kind === 'defense' &&
          treaty.parties.includes(targetNationId),
      );
      if (
        !claimedFront ||
        protectedByTreaty ||
        own.stats.readiness < 50 ||
        own.stats.treasury < 25 ||
        own.stats.unrest >= 70 ||
        own.stats.military < target.stats.military * 0.7
      )
        continue;
      const landApproach = [...(adjacency.get(claimedFront.id) ?? [])].some(
        (regionId) => controlledByActor.has(regionId),
      );
      const conflict = Conflict.parse({
        id: `conflict:${run}-${actor.slice(7)}-${targetNationId.slice(7)}-border-war`,
        name: `${own.name}–${target.name} Border War`,
        attackers: [actor],
        defenders: [targetNationId],
        status: 'active',
        escalation: 70,
        logistics: Math.max(25, Math.min(75, own.stats.readiness)),
        warGoals: [
          `Secure the claimed border region ${claimedFront.name} after a severe unresolved crisis.`,
        ],
      });
      add(
        `war-open-claimed-border-${targetNationId.slice(7)}`,
        `A severe unresolved border crisis or high-risk territorial objective with ${target.name} remains active. Declare war to pursue the existing claim at ${claimedFront.name}, with substantial exhaustion, fiscal, readiness, and diplomatic costs.`,
        [
          { type: 'START_CONFLICT', conflict },
          {
            type: 'THEATER_ACTION',
            conflictId: conflict.id,
            theaterId: `theater:${run}-${actor.slice(7)}-${targetNationId.slice(7)}-border-front`,
            nationId: actor,
            regionIds: [claimedFront.id],
            posture: landApproach ? 'limited-offensive' : 'naval-pressure',
            allocation: 65,
          },
        ],
        'war',
      );
    }
  }
  const terminalGoals = w.goals.filter(
    (g) =>
      g.nationId === actor &&
      ['achieved', 'failed', 'abandoned'].includes(g.status),
  );
  const activeGoals = w.goals.filter(
    (g) =>
      g.nationId === actor &&
      !['achieved', 'failed', 'abandoned', 'superseded'].includes(g.status),
  );
  if (!player && terminalGoals.length && !activeGoals.length) {
    for (const partner of partners.slice(0, 3)) {
      const relation = w.relations.find(
        (r) =>
          [r.nationA, r.nationB].includes(actor) &&
          [r.nationA, r.nationB].includes(partner),
      );
      if (!relation || relation.score >= 90) continue;
      const name = w.nations.find((n) => n.id === partner)!.name;
      add(
        `reassess-${partner.slice(7)}`,
        `Replace completed/failed strategy with a specific objective: rebuild relations with ${name}. Current relationship ${relation.score}; target ${Math.min(90, relation.score + 15)} over one year. Further talks and compromises are still needed.`,
        [
          {
            type: 'CREATE_STRATEGIC_GOAL',
            goal: Goal.parse({
              id: `goal:${run}-${actor.slice(7)}-review`,
              nationId: actor,
              title: `Build working relations with ${name}`,
              priority: 70,
              status: 'active',
              evaluation: {
                kind: 'relationship',
                nationId: partner,
                baseline: relation.score,
                target: Math.min(90, relation.score + 15),
              },
              targetNationIds: [partner],
              progress: 0,
              reason: `Reassess after ${terminalGoals
                .slice(-2)
                .map((g) => g.title + ' (' + g.status + ')')
                .join('; ')}`,
              createdDate: w.date,
              updatedDate: w.date,
              kind: 'diplomatic',
              visibility: 'private',
              deadline: later(w.date, 365),
            }),
          },
        ],
        'strategy',
      );
    }
  }
  for (const partner of partners) {
    if (player && !intent.targetNationIds.includes(partner)) continue;
    const name = w.nations.find((n) => n.id === partner)!.name;
    const isOpponent = war.find(
      (f) =>
        [...f.attackers, ...f.defenders].includes(partner) &&
        f.attackers.includes(actor) !== f.attackers.includes(partner),
    );
    const kinds = isOpponent
      ? (['peace', 'ceasefire'] as const)
      : (['consultation', 'trade', 'nonaggression', 'defense'] as const);
    const addressedIntents =
      intent?.intentions.filter(
        (i) => i.kind === 'diplomacy' && i.targetNationIds.includes(partner),
      ) ?? [];
    if (player && !addressedIntents.length) continue;
    for (const kind of kinds) {
      if (
        !player &&
        kind === 'consultation' &&
        w.negotiations.some(
          (n) =>
            n.status === 'accepted' &&
            n.kind === 'consultation' &&
            [n.proposerNationId, n.recipientNationId].includes(actor) &&
            [n.proposerNationId, n.recipientNationId].includes(partner) &&
            Date.parse(w.date) -
              Date.parse(n.responses.at(-1)?.date ?? n.createdDate) <
              180 * 86400000,
        )
      )
        continue;
      if (player) {
        const text = addressedIntents
          .map((i) => i.description)
          .join(' ')
          .toLowerCase();
        const requested = /ceasefire/.test(text)
          ? 'ceasefire'
          : /peace|settlement/.test(text)
            ? 'peace'
            : /trade|energy.*supply|imports/.test(text)
              ? 'trade'
              : /non.?aggression/.test(text)
                ? 'nonaggression'
                : /binding.*defen[sc]e|formal alliance/.test(text) &&
                    !/no (?:binding|formal)|not.*alliance|without.*binding|avoid.*alliance/.test(
                      text,
                    )
                  ? 'defense'
                  : 'consultation';
        if (kind !== requested) continue;
      }
      if (
        w.treaties.some(
          (t) =>
            t.status === 'active' &&
            t.kind === kind &&
            t.parties.length === 2 &&
            t.parties.includes(actor) &&
            t.parties.includes(partner),
        )
      )
        continue;
      if (!player && !isOpponent && kind === 'defense') {
        const relation = w.relations.find(
          (entry) =>
            [entry.nationA, entry.nationB].includes(actor) &&
            [entry.nationA, entry.nationB].includes(partner),
        );
        const sharedThreat =
          (relation?.tension ?? 0) >= 35 ||
          w.crises.some(
            (crisis) =>
              crisis.status !== 'resolved' &&
              crisis.severity >= 50 &&
              crisis.participants.includes(partner),
          ) ||
          w.conflicts.some(
            (conflict) =>
              conflict.status === 'active' &&
              [...conflict.attackers, ...conflict.defenders].includes(partner),
          );
        if ((relation?.score ?? 0) < 15 || !sharedThreat) continue;
      }
      if (!player && !isOpponent && kind === 'nonaggression') {
        const relation = w.relations.find(
          (entry) =>
            [entry.nationA, entry.nationB].includes(actor) &&
            [entry.nationA, entry.nationB].includes(partner),
        );
        if (
          (relation?.tension ?? 0) < 45 &&
          !w.crises.some(
            (crisis) =>
              crisis.status !== 'resolved' &&
              crisis.participants.includes(actor) &&
              crisis.participants.includes(partner),
          )
        )
          continue;
      }
      if (
        !player &&
        !isOpponent &&
        kind !== 'trade' &&
        kind !== 'consultation' &&
        kind !== 'defense' &&
        kind !== 'nonaggression'
      )
        continue;
      if (player && !intent.intentions.some((i) => i.kind === 'diplomacy'))
        continue;
      if (
        !player &&
        !isOpponent &&
        kind === 'trade' &&
        !sanctions.length &&
        !linked.some((l) => l.energy >= 50)
      )
        continue;
      if (kind === 'peace' && isOpponent) {
        const ownedAndOccupied = w.regions.filter(
          (region) =>
            region.ownerNationId === actor &&
            region.controllerNationId === partner,
        );
        const enemyOccupiedByActor = w.regions.filter(
          (region) =>
            region.ownerNationId === partner &&
            region.controllerNationId === actor,
        );
        const sharedWithdrawalTerms = [
          ...ownedAndOccupied.map((region) => ({
            kind: 'withdrawal' as const,
            regionId: region.id,
            fromNationId: partner,
            toNationId: actor,
          })),
          ...enemyOccupiedByActor.map((region) => ({
            kind: 'withdrawal' as const,
            regionId: region.id,
            fromNationId: actor,
            toNationId: partner,
          })),
        ].slice(0, 8);
        const territorialTerms = enemyOccupiedByActor
          .slice(0, 8)
          .map((region) => ({
            kind: 'territorial-transfer' as const,
            regionId: region.id,
            fromNationId: partner,
            toNationId: actor,
          }));
        const recognitionTerms = w.regions
          .filter(
            (region) =>
              region.ownerNationId === actor && region.claims.includes(partner),
          )
          .slice(0, 8)
          .map((region) => ({
            kind: 'recognize-claim' as const,
            regionId: region.id,
            fromNationId: actor,
            toNationId: partner,
          }));
        const peaceOptions = [
          {
            suffix: 'status-quo',
            label:
              'End the war at current military control lines; preserve legal ownership and occupied control.',
            terms: [],
          },
          ...(sharedWithdrawalTerms.length
            ? [
                {
                  suffix: 'mutual-withdrawal',
                  label: `Return occupied regions to their legal owners in a reciprocal withdrawal (${sharedWithdrawalTerms.length} regions).`,
                  terms: sharedWithdrawalTerms,
                },
              ]
            : []),
          ...(territorialTerms.length
            ? [
                {
                  suffix: 'territorial-cession',
                  label: `Seek negotiated legal cession of up to ${territorialTerms.length} currently occupied regions; military occupation alone does not change ownership.`,
                  terms: territorialTerms,
                },
              ]
            : []),
          ...(recognitionTerms.length
            ? [
                {
                  suffix: 'recognize-claim',
                  label: `Offer recognition of the existing claim held by ${name} to up to ${recognitionTerms.length} regions while preserving current legal ownership.`,
                  terms: recognitionTerms,
                },
              ]
            : []),
        ];
        for (const option of peaceOptions) {
          const peaceDescription = `End the costly war with ${name}. ${option.label}`;
          add(
            `offer-${partner.slice(7)}-peace-${option.suffix}`,
            `Propose a peace settlement to ${name}. Requires independent consent. ${peaceDescription}`,
            [
              {
                type: 'OPEN_NEGOTIATION',
                negotiation: Negotiation.parse({
                  id: `negotiation:${run}-${actor.slice(7)}-${partner.slice(7)}-peace-${option.suffix}`,
                  proposerNationId: actor,
                  recipientNationId: partner,
                  kind: 'peace',
                  conflictId: isOpponent.id,
                  topic: `War settlement with ${name}`,
                  terms: peaceDescription,
                  peaceTerms: option.terms,
                  createdDate: w.date,
                  expiresDate: later(w.date, 180),
                  visibility: 'public',
                }),
              },
            ],
            'diplomacy',
          );
        }
        continue;
      }
      const terms = player
        ? addressedIntents.map((i) => i.description).join('; ')
        : kind === 'peace'
          ? 'End the costly war at current control lines, without ownership transfers.'
          : kind === 'ceasefire'
            ? 'Suspend offensive operations and open settlement talks; no territorial transfer.'
            : kind === 'trade'
              ? sanctions.some((s) => s.issuer === partner)
                ? `Negotiate reciprocal market access and possible sanction relief with ${name}; sanctions remain until its government independently lifts them.`
                : linked.some(
                      (l) => l.partnerNationId === partner && l.energy >= 50,
                    )
                  ? `Revise existing energy supply and market access with ${name}; preserve political independence.`
                  : `Seek reciprocal market access and alternative energy supply with ${name}; preserve political independence.`
              : kind === 'defense'
                ? `Propose a mutual defense treaty with ${name}, limited to protection and support if either party is attacked; each government's response remains subject to its legal process.`
                : kind === 'nonaggression'
                  ? `Propose a nonaggression treaty with ${name} while preserving each government's independent foreign policy.`
                  : `Open voluntary regional security consultations with ${name}; no permanent basing or binding military alliance.`;
      add(
        `offer-${partner.slice(7)}-${kind}`,
        `Propose ${kind} to ${name}. Requires independent recipient consent. ${terms}`,
        [
          {
            type: 'OPEN_NEGOTIATION',
            negotiation: Negotiation.parse({
              id: `negotiation:${run}-${actor.slice(7)}-${partner.slice(7)}-${kind}`,
              proposerNationId: actor,
              recipientNationId: partner,
              kind,
              topic: `${kind === 'trade' ? 'Trade and supply talks' : kind === 'peace' ? 'War settlement' : kind === 'ceasefire' ? 'Ceasefire talks' : 'Regional ' + kind} with ${name}`,
              terms,
              conflictId: isOpponent?.id ?? null,
              createdDate: w.date,
              expiresDate: later(w.date, 180),
              visibility:
                player &&
                addressedIntents.some((i) => i.visibility === 'private')
                  ? 'private'
                  : 'public',
            }),
          },
        ],
        'diplomacy',
      );
    }
  }
  if (!player) {
    const adjacency = new Map(
      w.scenario.regionAdjacency.map((entry) => [
        entry.regionId,
        new Set(entry.neighbors),
      ]),
    );
    for (const partner of partners) {
      const relation = w.relations.find(
        (entry) =>
          [entry.nationA, entry.nationB].includes(actor) &&
          [entry.nationA, entry.nationB].includes(partner),
      );
      const claimFront = w.regions
        .filter(
          (region) =>
            region.ownerNationId === partner &&
            region.claims.includes(actor) &&
            w.regions.some(
              (friendly) =>
                friendly.controllerNationId === actor &&
                (adjacency.get(friendly.id)?.has(region.id) ??
                  (!w.scenario.regionAdjacency.some(
                    (entry) => entry.neighbors.length,
                  ) &&
                    w.scenario.neighborhoods
                      ?.find((entry) => entry.nationId === actor)
                      ?.neighbors.includes(partner))),
            ),
        )
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      const alreadyInCrisis = w.crises.some(
        (crisis) =>
          crisis.status !== 'resolved' &&
          crisis.participants.includes(actor) &&
          crisis.participants.includes(partner),
      );
      if (
        claimFront &&
        !alreadyInCrisis &&
        (relation?.tension ?? 0) >= 40 &&
        (relation?.score ?? 0) <= 5
      ) {
        const crisis = Crisis.parse({
          id: `crisis:${run}-${actor.slice(7)}-${partner.slice(7)}-border-claim`,
          title: `Border claim dispute over ${claimFront.name}`,
          type: 'border',
          status: 'emerging',
          participants: [actor, partner],
          interestedActors: [],
          regions: [claimFront.id],
          startDate: w.date,
          visibility: 'public',
          trigger: `A territorial claim on ${claimFront.name} coincides with rising bilateral tension.`,
          issues: [
            `${own.name}'s claim to ${claimFront.name}`,
            'Whether both governments will use talks rather than force',
          ],
          demands: [
            {
              nationId: partner,
              text: `Address ${own.name}'s claim to ${claimFront.name} through talks.`,
              satisfied: false,
            },
          ],
          redLines: [],
          militaryPosture: 55,
          rhetoric: 52,
          diplomaticBreakdown: 48,
          severity: 0,
          deadline: later(w.date, 180),
          conflictId: null,
          negotiationIds: [],
          history: [],
        });
        add(
          `crisis-open-border-claim-${partner.slice(7)}`,
          `Open a public border crisis with ${w.nations.find((nation) => nation.id === partner)!.name} over the existing claim to ${claimFront.name}. This raises diplomatic and military pressure and creates a path for talks; it does not start a war.`,
          [{ type: 'OPEN_CRISIS', crisis }],
          'crisis',
        );
      }
      const pressure = w.crises.find(
        (crisis) =>
          crisis.status !== 'resolved' &&
          crisis.severity >= 55 &&
          crisis.participants.includes(actor) &&
          crisis.participants.includes(partner),
      );
      const hasActiveSanction = w.sanctions.some(
        (sanction) =>
          sanction.status === 'active' &&
          sanction.issuer === actor &&
          sanction.target === partner,
      );
      if (
        pressure &&
        !hasActiveSanction &&
        own.stats.economy >= 30 &&
        (relation?.tension ?? 0) >= 40
      ) {
        const targetName = w.nations.find(
          (nation) => nation.id === partner,
        )!.name;
        const sanction = Sanction.parse({
          id: `sanction:${run}-${actor.slice(7)}-${partner.slice(7)}-trade`,
          issuer: actor,
          target: partner,
          sector: 'trade',
          intensity: 35,
          startDate: w.date,
          endDate: later(w.date, 180),
          status: 'active',
          reason: `Pressure ${targetName} to address the unresolved crisis: ${pressure.title}`,
        });
        add(
          `sanction-crisis-${partner.slice(7)}`,
          `Impose limited trade sanctions on ${targetName} in response to the unresolved crisis. This carries economic cost and may invite retaliation.`,
          [{ type: 'IMPOSE_SANCTION', sanction }],
          'sanctions',
        );
      }
    }
  }
  for (const f of war) {
    const theaters = f.theaters.filter((theater) => theater.nationId === actor);
    if (theaters.length) {
      for (const theater of theaters)
        for (const posture of [
          'hold',
          'reinforce',
          'limited-offensive',
          'major-offensive',
          'withdraw',
          'naval-pressure',
          'prepare-ceasefire',
        ] as const) {
          if (posture === theater.posture) continue;
          const allocation =
            posture === 'major-offensive'
              ? 100
              : posture === 'limited-offensive'
                ? Math.max(45, theater.allocation)
                : theater.allocation;
          add(
            `war-${f.id.slice(9)}-${posture}`,
            `Set ${f.name} theater to ${posture} at ${allocation}% commitment. Current momentum ${theater.momentum}, supply pressure ${theater.supplyPressure}, theater exhaustion ${theater.exhaustion}.`,
            [
              {
                type: 'THEATER_ACTION',
                conflictId: f.id,
                theaterId: theater.id,
                nationId: actor,
                regionIds: theater.regionIds,
                posture,
                allocation,
              },
            ],
            'war',
          );
        }
    } else {
      for (const stance of ['defend', 'reinforce', 'deescalate'] as const)
        add(
          `war-${f.id.slice(9)}-${stance}`,
          `${stance} in ${f.name}; exhaustion ${f.exhaustion}, logistics ${f.logistics}.`,
          [
            {
              type: 'CONFLICT_ACTION',
              conflictId: f.id,
              nationId: actor,
              stance,
            },
          ],
          'war',
        );
      const target = frontObjective(w, f, actor);
      if (target)
        add(
          `war-${f.id.slice(9)}-open-limited-front`,
          `Open a limited offensive toward the reachable front at ${target.name}. Force movement will be resolved over later months; ownership will not change through occupation.`,
          [
            {
              type: 'THEATER_ACTION',
              conflictId: f.id,
              theaterId: `theater:${run}-${f.id.slice(9)}-${actor.slice(7)}-front`,
              nationId: actor,
              regionIds: [target.id],
              posture: 'limited-offensive',
              allocation: 60,
            },
          ],
          'war',
        );
    }
  }
  for (const c of w.crises.filter(
    (c) =>
      c.status !== 'resolved' &&
      c.participants.includes(actor) &&
      (!player ||
        /crisis|dispute|de.escalat|stand.down|regional security|military signal/i.test(
          intent.summary,
        )),
  ))
    for (const move of [
      'talk',
      'stand-down',
      'warn',
      'mobilize',
      'concede',
      'freeze',
    ] as const)
      add(
        `crisis-${c.id.slice(7)}-${move}`,
        `${move} in ${c.title}; severity ${c.severity}; demands: ${c.demands.map((d) => d.text).join('; ')}`,
        [{ type: 'CRISIS_ACTION', crisisId: c.id, nationId: actor, move }],
        'crisis',
      );
  for (const s of w.sanctions.filter(
    (s) => s.issuer === actor && s.status === 'active',
  ))
    add(
      `relief-${s.id.slice(9)}`,
      `Lift ${s.sector} sanctions on ${w.nations.find((n) => n.id === s.target)!.name}; removes coercion but restores opportunity`,
      [{ type: 'LIFT_SANCTION', sanctionId: s.id, nationId: actor }],
      'economy',
    );
  for (const c of w.conferences.filter(
    (c) => c.status === 'open' && c.parties.includes(actor),
  ))
    for (const move of ['accept', 'reject', 'delay', 'abstain'] as const)
      add(
        `conference-${c.id.slice(11)}-${move}`,
        `${move} conference: ${c.title}. Current terms: ${c.terms}`,
        [
          {
            type: 'RESPOND_CONFERENCE',
            conferenceId: c.id,
            nationId: actor,
            move,
            message: 'Government decision on current terms',
          },
        ],
        'organization',
      );
  if (!player) {
    const actionById = new Map(w.actions.map((action) => [action.id, action]));
    const recentFamilies = new Map<string, number>();
    const cutoff = Date.parse(w.date) - 180 * 86400000;
    for (const record of w.commands.slice(-1500)) {
      const action = actionById.get(record.actionId);
      if (
        action?.source !== 'system' ||
        action.actorNationId !== actor ||
        Date.parse(record.simulationDate) < cutoff
      )
        continue;
      const family = actionFamily(record.command);
      recentFamilies.set(family, (recentFamilies.get(family) ?? 0) + 1);
    }
    for (const candidate of candidates) {
      const count = recentFamilies.get(candidate.family) ?? 0;
      if (candidate.family !== 'wait' && count >= 2)
        candidate.label += ` Recent history already contains ${count} ${candidate.family} actions; give a different useful family consideration unless current pressure directly calls for this.`;
    }
  }
  return candidates;
}
export function compactFacts(
  w: WorldState,
  actor: NationId,
  relevant: NationId[],
) {
  const context = buildContext(w, actor, relevant, {
    recentLimit: 6,
    eventBudget: 1800,
  });
  const own = context.canonical.nations.find((n) => n.id === actor)!;
  return {
    date: w.date,
    own,
    influenceStrategy: own.strategy.influencePlans,
    influenceRelationships: w.treaties
      .filter(
        (treaty) =>
          treaty.kind === 'influence' && treaty.parties.includes(actor),
      )
      .flatMap((treaty) =>
        treaty.breaches
          .filter((breach) => breach.status !== 'resolved')
          .map((breach) => ({
            treaty: treaty.name,
            breachId: breach.id,
            violatingNationId: breach.violatingNationId,
            injuredNationId: breach.injuredNationId,
            reason: breach.reason,
            firstMissedDate: breach.firstMissedDate,
            lastMissedDate: breach.lastMissedDate,
            missedInstallments: breach.missedInstallments,
            arrearsAmount: breach.arrearsAmount,
            durationMonths: breach.durationMonths,
            severity: breach.severity,
          })),
      )
      .slice(0, 8),
    competingInfluenceOffers: w.negotiations
      .filter(
        (negotiation) =>
          negotiation.kind === 'influence' &&
          negotiation.status === 'open' &&
          negotiation.recipientNationId === actor,
      )
      .sort((a, b) => a.createdDate.localeCompare(b.createdDate))
      .slice(0, 5)
      .map((negotiation) => ({
        id: negotiation.id,
        proposerNationId: negotiation.proposerNationId,
        terms: negotiation.terms,
        clauses: negotiation.influenceTerms.map((term) => ({
          kind: term.kind,
          amount: term.amount,
        })),
        profile: influenceProfile(w, negotiation.proposerNationId, actor),
      })),
    goals: context.canonical.goals
      .filter((g) => g.nationId === actor)
      .map((g) => ({
        id: g.id,
        title: g.title,
        priority: g.priority,
        progress: g.progress,
        pressure: g.pressure,
        review: g.strategyReview,
        blockers: g.blockers,
      })),
    partners: context.canonical.nations
      .filter((n) => n.id !== actor)
      .map((n) => ({
        id: n.id,
        name: n.name,
        economicCapacity: n.stats.economy,
        militaryCapacity: n.stats.military,
      })),
    relations: context.canonical.relations.map((r) => ({
      nationA: r.nationA,
      nationB: r.nationB,
      score: r.score,
      trust: r.trust,
      tension: r.tension,
      recent: r.factors.slice(-2),
    })),
    promises: context.canonical.commitments.map((c) => ({
      issuer: c.issuer,
      recipients: c.recipients,
      terms: c.terms,
      status: c.status,
      due: c.dueDate,
    })),
    organizations: context.canonical.organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      acronym: organization.acronym,
      kind: organization.kind,
      purpose: organization.purpose,
      geographicScope: organization.geographicScope,
      members: organization.members,
      invitations: organization.invitations.filter(
        (invitation) => invitation.status === 'pending',
      ),
      applications: organization.pendingApplications.filter(
        (application) => application.status === 'pending',
      ),
      commitments: organization.commitments.filter(
        (commitment) => commitment.status === 'active',
      ),
    })),
    wars: context.canonical.conflicts
      .filter((f) => f.status === 'active')
      .map((f) => ({
        id: f.id,
        name: f.name,
        attackers: f.attackers,
        defenders: f.defenders,
        exhaustion: f.exhaustion,
        escalation: f.escalation,
        logistics: f.logistics,
      })),
    warReview: {
      homelandLosses: context.canonical.regions
        .filter(
          (r) => r.ownerNationId === actor && r.controllerNationId !== actor,
        )
        .map((r) => r.name),
      treasury: own.stats.treasury,
      fiscal: own.stats.fiscal,
      unrest: own.stats.unrest,
      questions: [
        'Are current war goals achievable given control, logistics and exhaustion?',
        'Can we sustain military upkeep alongside promises and domestic stability?',
        'Would reduced goals, ceasefire or mediated settlement serve us better than escalation?',
      ],
      instruction:
        'State a concrete choice and material sustainability factor. Settlement is an offer, never an assumed outcome.',
    },
    sanctions: context.canonical.sanctions.filter((s) => s.status === 'active'),
    economicLinks: context.canonical.economicLinks.filter(
      (l) => l.dependentNationId === actor,
    ),
    crises: context.canonical.crises
      .filter((c) => c.status !== 'resolved')
      .map((c) => ({
        id: c.id,
        title: c.title,
        severity: c.severity,
        demands: c.demands,
        deadline: c.deadline,
      })),
    projects: (context.canonical.initiatives as Initiative[])
      .filter((i) => i.nationId === actor && i.status === 'active')
      .map((i) => ({
        name: i.name,
        progress: i.progress,
        effort: i.effort,
        blocker: i.blocker,
      })),
    recent: context.recentEvents
      .slice(-6)
      .map((e) => ({ date: e.date, title: e.title })),
    uncertainty:
      'Foreign private strategy, treasury and readiness are unknown. Proposals are wishes, not outcomes.',
  };
}

export function influenceResponseDossier(
  world: WorldState,
  negotiation: WorldState['negotiations'][number],
  decidingActorNationId: NationId,
) {
  if (negotiation.kind !== 'influence') return null;
  const { patronNationId, subjectNationId } =
    influencePartiesForNegotiation(negotiation);
  const patronDeciding = decidingActorNationId === patronNationId;
  const subjectDeciding = decidingActorNationId === subjectNationId;
  const counterpartNationId = patronDeciding ? subjectNationId : patronNationId;
  const offerAssessment = assessInfluenceOffer(
    world,
    patronNationId,
    subjectNationId,
    negotiation.influenceTerms,
  );
  const profile = influenceProfile(world, patronNationId, subjectNationId);
  const subject = world.nations.find((nation) => nation.id === subjectNationId);
  const decidingActor = world.nations.find(
    (nation) => nation.id === decidingActorNationId,
  );
  const targetPlan = decidingActor?.strategy.influencePlans.find(
    (plan) => plan.targetNationId === counterpartNationId,
  );
  const activeTerms = profile.activeTerms.map((term) => ({
    kind: term.kind,
    amount: term.amount,
    ratePercent: term.ratePercent,
  }));
  const rejectedOffers = world.negotiations
    .filter(
      (candidate) =>
        candidate.kind === 'influence' &&
        influencePartiesForNegotiation(candidate).patronNationId ===
          patronNationId &&
        influencePartiesForNegotiation(candidate).subjectNationId ===
          subjectNationId &&
        candidate.responses.some(
          (response) =>
            response.nationId === decidingActorNationId &&
            ['reject', 'counter'].includes(response.move),
        ),
    )
    .sort((a, b) => a.createdDate.localeCompare(b.createdDate))
    .slice(-4);
  const lastRejected = rejectedOffers.at(-1);
  const lastRejectedResponse = [...(lastRejected?.responses ?? [])]
    .reverse()
    .find(
      (entry) =>
        entry.nationId === decidingActorNationId &&
        ['reject', 'counter'].includes(entry.move),
    );
  const previousAssessment =
    lastRejectedResponse?.influenceDecision?.assessment;
  const termsKey = (
    terms: readonly WorldState['negotiations'][number]['influenceTerms'][number][],
  ) =>
    terms
      .map(
        (term) =>
          `${term.kind}:${term.amount}:${term.ratePercent}:${term.patronNationId}:${term.subjectNationId}`,
      )
      .sort()
      .join('|');
  return {
    decisionScope: {
      decidingActor: {
        id: decidingActorNationId,
        name: decidingActor?.name ?? decidingActorNationId,
        role: subjectDeciding ? 'target' : patronDeciding ? 'patron' : 'other',
      },
      counterpart: {
        id: counterpartNationId,
        name:
          world.nations.find((nation) => nation.id === counterpartNationId)
            ?.name ?? counterpartNationId,
        role: patronDeciding ? 'target' : subjectDeciding ? 'patron' : 'other',
      },
      responseMode:
        patronDeciding && negotiation.proposerNationId === subjectNationId
          ? 'patron-reviewing-target-counteroffer'
          : subjectDeciding && negotiation.proposerNationId === patronNationId
            ? 'target-evaluating-patron-offer'
            : 'reviewing-influence-terms',
      decision: negotiation.id,
      relevantRival:
        patronDeciding ||
        offerAssessment.factors.alternatives.rivalNationId === null
          ? null
          : {
              id: offerAssessment.factors.alternatives.rivalNationId,
              name:
                world.nations.find(
                  (nation) =>
                    nation.id ===
                    offerAssessment.factors.alternatives.rivalNationId,
                )?.name ?? offerAssessment.factors.alternatives.rivalNationId,
              leverage: offerAssessment.factors.alternatives.rivalLeverage,
              offerScore: offerAssessment.factors.alternatives.rivalOfferScore,
            },
    },
    proposalTerms: negotiation.influenceTerms.map((term) => ({
      kind: term.kind,
      patron: term.patronNationId,
      subject: term.subjectNationId,
      amount: term.amount,
      ratePercent: term.ratePercent,
    })),
    negotiationMemory: negotiation.responses.slice(-3).map((response) => {
      const communicatedTerms = response.influenceTerms ?? [];
      const counterTerms = response.counterInfluenceTerms ?? [];
      const sameTerm = (
        left: (typeof communicatedTerms)[number],
        right: (typeof counterTerms)[number],
      ) =>
        left.kind === right.kind &&
        left.amount === right.amount &&
        left.ratePercent === right.ratePercent;
      return {
        date: response.date,
        actor:
          world.nations.find((nation) => nation.id === response.nationId)
            ?.name ?? response.nationId,
        result: response.move,
        communicatedTerms: communicatedTerms.map((term) => ({
          kind: term.kind,
          amount: term.amount,
          ratePercent: term.ratePercent,
        })),
        counterTerms: counterTerms.map((term) => ({
          kind: term.kind,
          amount: term.amount,
          ratePercent: term.ratePercent,
        })),
        removedTerms:
          response.move === 'counter'
            ? communicatedTerms
                .filter(
                  (term) =>
                    !counterTerms.some((counterTerm) =>
                      sameTerm(term, counterTerm),
                    ),
                )
                .map((term) => term.kind)
            : [],
        addedTerms:
          response.move === 'counter'
            ? counterTerms
                .filter(
                  (term) =>
                    !communicatedTerms.some((priorTerm) =>
                      sameTerm(priorTerm, term),
                    ),
                )
                .map((term) => term.kind)
            : [],
        publicReason: containsPrivateStrategicPlanningLanguage(response.message)
          ? null
          : response.message.slice(0, 240),
      };
    }),
    communicatedProposalText: negotiation.terms,
    currentTier: profile.tier,
    leverage: subjectDeciding ? profile.leverage : null,
    resistance: subjectDeciding ? profile.resistance : null,
    reliability: subjectDeciding ? profile.reliability : null,
    autonomy: subjectDeciding ? profile.autonomy : null,
    decidingActorPriorities: {
      orientation: decidingActor?.strategy.orientation,
      riskTolerance: decidingActor?.strategy.riskTolerance,
      goals: world.goals
        .filter(
          (goal) =>
            goal.nationId === decidingActorNationId &&
            !['achieved', 'failed', 'abandoned', 'superseded'].includes(
              goal.status,
            ),
        )
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 4)
        .map((goal) => ({ title: goal.title, priority: goal.priority })),
      targetPlan: targetPlan
        ? {
            desiredTier: targetPlan.desiredTier,
            status: targetPlan.status,
            priority: targetPlan.priority,
            nextStep: targetPlan.nextStep.kind,
            requestedTerms: targetPlan.nextStep.requestedTerms,
            rationale: targetPlan.nextStep.rationale,
            blockers: targetPlan.blockers.slice(0, 4),
          }
        : null,
    },
    targetNeeds:
      subject && subjectDeciding
        ? {
            debt: subject.stats.debt,
            energyExposure: subject.stats.energyExposure,
            industrial: subject.stats.industrial,
            fiscal: subject.stats.fiscal,
            treasury: subject.stats.treasury,
            unrest: subject.stats.unrest,
            economy: subject.stats.economy,
            military: subject.stats.military,
            preferences: {
              orientation: subject.strategy.orientation,
              riskTolerance: subject.strategy.riskTolerance,
              redLines: subject.strategy.redLines.slice(0, 5),
            },
            goals: world.goals
              .filter(
                (goal) =>
                  goal.nationId === subjectNationId &&
                  !['achieved', 'failed', 'abandoned', 'superseded'].includes(
                    goal.status,
                  ),
              )
              .sort((a, b) => b.priority - a.priority)
              .slice(0, 5)
              .map((goal) => ({ title: goal.title, priority: goal.priority })),
            threats: world.conflicts
              .filter(
                (conflict) =>
                  conflict.status === 'active' &&
                  [...conflict.attackers, ...conflict.defenders].includes(
                    subjectNationId,
                  ),
              )
              .slice(0, 3)
              .map((conflict) => ({
                name: conflict.name,
                opponents: [...conflict.attackers, ...conflict.defenders]
                  .filter((nationId) => nationId !== subjectNationId)
                  .slice(0, 3)
                  .map(
                    (nationId) =>
                      world.nations.find((nation) => nation.id === nationId)
                        ?.name ?? nationId,
                  ),
              })),
          }
        : null,
    offeredSupport: {
      monthlyPayments: negotiation.influenceTerms
        .filter(
          (term) =>
            term.kind === 'subsidy' ||
            term.kind === 'infrastructure-investment',
        )
        .reduce((sum, term) => sum + term.amount, 0),
      oneTimeDebtRelief: negotiation.influenceTerms
        .filter((term) => term.kind === 'debt-relief')
        .reduce((sum, term) => sum + term.amount, 0),
      oneTimeLoans: negotiation.influenceTerms
        .filter((term) => term.kind === 'loan')
        .reduce((sum, term) => sum + term.amount, 0),
    },
    trust:
      world.relations.find(
        (relation) =>
          [relation.nationA, relation.nationB].includes(patronNationId) &&
          [relation.nationA, relation.nationB].includes(subjectNationId),
      )?.trust ?? 50,
    activeTerms,
    unmetPuppetRequirements: profile.puppetRequirements
      .filter((requirement) => !requirement.fulfilled)
      .map((requirement) => requirement.key),
    availableLimitedCounterTerms: [
      'foreign-policy-consultation',
      'support-diplomatic-initiatives',
      'war-declaration-approval',
      'join-defensive-wars',
      'military-planning',
    ].filter((kind) => !profile.activeTerms.some((term) => term.kind === kind)),
    decisionEnvelope: subjectDeciding
      ? {
          recommendationZone: offerAssessment.recommendationZone,
          score: offerAssessment.score,
          benefits: offerAssessment.factors.benefits,
          costs: {
            sovereignty: offerAssessment.factors.costs.sovereignty,
            fiscal: offerAssessment.factors.costs.fiscal,
            militaryObligation:
              offerAssessment.factors.costs.militaryObligation,
            diplomaticRestriction:
              offerAssessment.factors.costs.diplomaticRestriction,
          },
          relationship: offerAssessment.factors.relationship,
          alternatives: {
            rivalLeverage: offerAssessment.factors.alternatives.rivalLeverage,
            rivalOfferScore:
              offerAssessment.factors.alternatives.rivalOfferScore,
            outsideOption: offerAssessment.factors.alternatives.outsideOption,
            switchingCost: offerAssessment.factors.alternatives.switchingCost,
          },
          strategicFit: offerAssessment.factors.strategicFit,
        }
      : {
          perspective: 'patron-reviewing-target-counteroffer',
          targetPrivateFactors: 'withheld',
          instruction:
            'Assess the exact communicated terms against this actor’s own target plan. Counterpart private needs, red lines, goals, resistance, reliability, alternatives and internal assessment are not shared.',
        },
    rejectedOffers: rejectedOffers.map((candidate) => {
      const response = [...candidate.responses]
        .reverse()
        .find(
          (entry) =>
            entry.nationId === decidingActorNationId &&
            ['reject', 'counter'].includes(entry.move),
        );
      return {
        date: response?.date ?? candidate.createdDate,
        result: response?.move ?? 'unknown',
        reasonCode: response?.influenceDecision?.reasonCode ?? null,
        statedReason: response?.message,
        terms: (response?.influenceTerms ?? candidate.influenceTerms).map(
          (term) => ({
            kind: term.kind,
            amount: term.amount,
            ratePercent: term.ratePercent,
          }),
        ),
        counterTerms: response?.counterInfluenceTerms?.map((term) => ({
          kind: term.kind,
          amount: term.amount,
          ratePercent: term.ratePercent,
        })),
      };
    }),
    exactRepeatOfLastRejectedTerms: Boolean(
      lastRejected &&
      termsKey(
        lastRejectedResponse?.influenceTerms ?? lastRejected.influenceTerms,
      ) === termsKey(negotiation.influenceTerms),
    ),
    changesSinceLastObjection: previousAssessment
      ? {
          priorDate: lastRejectedResponse?.date,
          priorMove: lastRejectedResponse?.move,
          priorReason:
            lastRejectedResponse &&
            !containsPrivateStrategicPlanningLanguage(
              lastRejectedResponse.message,
            )
              ? lastRejectedResponse.message
              : null,
          benefitChange:
            offerAssessment.factors.benefits.total -
            previousAssessment.benefits.total,
          sovereigntyCostChange:
            offerAssessment.factors.costs.sovereignty -
            previousAssessment.costs.sovereignty,
          leverageChange:
            offerAssessment.factors.relationship.leverage -
            previousAssessment.relationship.leverage,
          resistanceChange:
            offerAssessment.factors.relationship.resistance -
            previousAssessment.relationship.resistance,
          reliabilityChange:
            offerAssessment.factors.relationship.reliability -
            previousAssessment.relationship.reliability,
          trustChange:
            offerAssessment.factors.relationship.trust -
            previousAssessment.relationship.trust,
        }
      : null,
  };
}

export function playerInfluenceStrategyUpdate(
  world: WorldState,
  intent: PlayerIntent | null,
  text: string,
  commands: Array<{ command: WorldCommand; reason: string }>,
) {
  if (!intent) return null;
  const actor = intent.actorNationId;
  const patron = world.nations.find((nation) => nation.id === actor);
  if (!patron) return null;
  const targets = new Set(
    commands.flatMap(({ command }) =>
      command.type === 'OPEN_NEGOTIATION' &&
      command.negotiation.kind === 'influence' &&
      command.negotiation.proposerNationId === actor
        ? [command.negotiation.recipientNationId]
        : [],
    ),
  );
  if (
    /sphere|patron|puppet|protectorate|client state|dependency|dependence|influence|under our control/i.test(
      text,
    )
  )
    for (const target of intent.targetNationIds)
      if (target !== actor) targets.add(target);
  if (!targets.size) return null;
  const requestsPuppet = /puppet|full control|under our control/i.test(text);
  const requestedTier = requestsPuppet ? 'PUPPET STATE' : 'SUBJECT STATE';
  const plans = [...targets].map((target) =>
    buildInfluenceStrategyPlan(
      world,
      actor,
      target,
      requestsPuppet
        ? requestedTier
        : (patron.strategy.influencePlans.find(
            (plan) => plan.targetNationId === target,
          )?.desiredTier ?? requestedTier),
    ),
  );
  const strategy = {
    ...patron.strategy,
    influencePlans: [
      ...patron.strategy.influencePlans.filter(
        (plan) => !targets.has(plan.targetNationId),
      ),
      ...plans,
    ].slice(-20),
    influencePortfolio: influencePortfolioSnapshot(
      world,
      actor,
      plans[0]?.targetNationId ?? null,
      commands.flatMap(({ command }) =>
        command.type === 'OPEN_NEGOTIATION' &&
        command.negotiation.kind === 'influence' &&
        command.negotiation.proposerNationId === actor
          ? command.negotiation.influenceTerms
          : [],
      ),
    ),
  };
  const names = plans.map(
    (plan) =>
      world.nations.find((nation) => nation.id === plan.targetNationId)!.name,
  );
  return {
    command: WorldCommandSchema.parse({
      type: 'SET_STRATEGY',
      nationId: actor,
      strategy,
    }),
    reason: `Persist influence strategy for ${names.join(', ')}: ${plans.map((plan) => plan.nextStep.rationale).join(' ')}`,
  };
}

type Call = <T>(
  role: Role,
  schema: z.ZodType<T>,
  payload: object,
  references: string[],
  repairAttempt?: number,
) => Promise<T>;
export async function compactPrepare(
  input: PrepareInput,
  trace: TurnTrace,
  config: ProviderConfig,
  generate: Call,
) {
  const { world: w, signal } = input;
  if (input.action.source === 'player')
    trace.importance = classifyImportance(w, input.action.text, [
      input.action.actorNationId,
    ]);
  let repairCalls = 0;
  const call: Call = async (role, schema, payload, refs, attempt = 0) => {
    try {
      return await generate(role, schema, payload, refs, attempt);
    } catch (error) {
      signal?.throwIfAborted();
      if (
        role === 'formalizer' ||
        repairCalls >= config.maxRepairs ||
        !(error instanceof Error) ||
        !error.message.startsWith('Invalid ')
      )
        throw error;
      repairCalls++;
      trace.failures.push('Malformed ' + role + ' response retried once.');
      return generate(
        role,
        schema,
        {
          ...payload,
          repair:
            'Previous generation was invalid. Emit the exact short JSON schema; no emoji, hashtags, repetition or extra fields.',
        },
        refs,
        repairCalls,
      );
    }
  };
  const stage = (
    s: Parameters<NonNullable<PrepareInput['onProgress']>>[0],
    actor?: NationId,
  ) => {
    signal?.throwIfAborted();
    input.onProgress?.(
      s,
      actor ? w.nations.find((n) => n.id === actor)!.name : undefined,
    );
  };
  if (input.action.source === 'player') {
    stage('interpreting');
    for (;;)
      try {
        const clauses = splitActionClauses(input.action.text);
        const draft = await call(
          'formalizer',
          CompactIntent.extend({
            classifications: z
              .array(ClauseClassification)
              .length(clauses.length),
          }),
          {
            ...buildFormalizerPayload(w, input.action),
            clauses,
            semanticTask:
              'Return semanticProposals for each clause: action, targets, sources and participants using canonical nation IDs. Asset owners are sources, allies are participants. Resolve target pronouns from the grounded graph; never annex an asset owner without an explicit targeting clause.',
            task: 'Return exactly one classification per supplied clause, in the same order. Classify each exact player clause. Energy, industry, diversification, trade capacity and spending are economy; readiness and armed force are military; reforms are domestic; proposals or talks addressed to another government are diplomacy. A policy mentioning a foreign supplier is NOT automatically diplomacy. Preserve negations and conditionality. Public framing constraints are not secrecy; quiet, secret or unannounced actions are private. Do not add outcomes.',
          },
          [w.saveId],
          repairCalls,
        );
        trace.intent = canonicalizeFormalizerIntent(w, input.action, {
          version: 1,
          ...(draft.semanticProposals
            ? { semanticProposals: draft.semanticProposals }
            : {}),
          summary: input.action.text.slice(0, 2000),
          targetNationIds: [],
          targetRegionIds: [],
          visibility: draft.classifications.every(
            (i) => i.visibility === 'private',
          )
            ? 'private'
            : 'public',
          policyOrders: [],
          desiredOutcomes: [],
          constraints: [],
          majorIntentClauses: [],
          intentions: draft.classifications.map((i, index) => ({
            ...i,
            visibility:
              /\b(secret|secretly|quietly|private|privately|unannounced)\b|without publicly announcing/i.test(
                clauses[index]!,
              )
                ? 'private'
                : i.visibility,
            sourceClauseIds: [index],
            description: 'Source clause',
            targetNationIds: [],
          })),
        });
        break;
      } catch (error) {
        if (repairCalls >= config.maxRepairs) {
          trace.intent = deterministicPlayerIntent(w, input.action);
          trace.failures.push(
            'Formalizer unavailable; provider-independent player intent interpretation was used.',
          );
          trace.validatorResults.push(
            'Player Action Executor used exact player clauses and canonical world references without model approval.',
          );
          break;
        }
        repairCalls++;
        trace.failures.push('Intent repair: ' + String(error));
      }
  }
  trace.playerExecution = executePlayerTurn(
    w,
    input.action.source === 'player' ? trace.intent : null,
    trace.id,
  );
  const influenceStrategyUpdate = playerInfluenceStrategyUpdate(
    w,
    input.action.source === 'player' ? trace.intent : null,
    input.action.text,
    trace.playerExecution?.commands ?? [],
  );
  if (influenceStrategyUpdate)
    trace.playerExecution?.commands.push(influenceStrategyUpdate);
  trace.relevance = selectRelevance(w, trace.intent);
  const required = [
    ...new Set([
      ...(trace.intent
        ? [trace.intent.actorNationId, ...trace.intent.targetNationIds]
        : []),
      ...w.negotiations
        .filter(
          (n) =>
            !w.observerMode &&
            n.status === 'open' &&
            [n.proposerNationId, n.recipientNationId].includes(
              w.playerNationId,
            ) &&
            n.recipientNationId !== w.playerNationId,
        )
        .map((n) => n.recipientNationId),
      ...w.organizations.flatMap((organization) =>
        organization.status === 'active'
          ? organization.invitations
              .filter(
                (invitation) =>
                  invitation.status === 'pending' &&
                  invitation.lastMove !== 'counter' &&
                  invitation.nationId !== w.playerNationId,
              )
              .map((invitation) => invitation.nationId)
          : [],
      ),
    ]),
  ];
  trace.relevance.secondaryNationIds = [
    ...new Set([
      ...w.negotiations
        .filter(
          (n) =>
            n.status === 'open' &&
            (w.observerMode || n.recipientNationId !== w.playerNationId) &&
            pressured(w, n.proposerNationId),
        )
        .map((n) => n.recipientNationId),
      ...w.sanctions
        .filter((s) => s.status === 'active' && s.intensity >= 60)
        .map((s) => s.target),
      ...trace.relevance.secondaryNationIds,
    ]),
  ].slice(0, 12);
  const scheduled = scheduleActors(
    w,
    trace.relevance,
    config.maxBackgroundPlanners,
  );
  const capabilityRanking = [...w.nations].sort(
    (a, b) =>
      b.stats.military +
        b.stats.economy -
        (a.stats.military + a.stats.economy) || a.id.localeCompare(b.id),
  );
  const strategicActors =
    w.scenario.strategicActors ??
    capabilityRanking.slice(0, 8).map((nation) => nation.id);
  const powerAttentionNationId =
    w.revision % 3 === 0 && strategicActors.length
      ? strategicActors[Math.floor(w.revision / 3) % strategicActors.length]!
      : null;
  const budget =
    config.maxCalls ??
    (input.quality === 'deep' ? 12 : input.quality === 'fast' ? 5 : 8);
  // Reserve one call per pending foreign response; newly opened offers can be answered later in this same actor pass.
  const responseCount = w.negotiations.filter(
    (n) =>
      n.status === 'open' &&
      n.recipientNationId !== w.playerNationId &&
      [n.proposerNationId, n.recipientNationId].some((id) =>
        required.includes(id),
      ),
  ).length;
  const requiredCallCount = required.filter(
    (id) => input.action.source !== 'player' || id !== w.playerNationId,
  ).length;
  if (requiredCallCount + responseCount + trace.modelCalls.length > budget)
    throw new Error(
      'Too many important governments for this turn budget. Increase the call limit in AI settings or split the directive. No changes committed.',
    );
  const capacity = Math.max(
    0,
    Math.min(
      config.maxBackgroundPlanners,
      input.quality === 'deep' ? 4 : input.quality === 'fast' ? 1 : 2,
      budget - requiredCallCount - responseCount - trace.modelCalls.length,
    ),
  );
  const scheduledRank = new Map(
    scheduled.map((activation, index) => [activation.nationId, index]),
  );
  const actors = [
    ...required,
    ...[
      ...scheduled,
      ...(powerAttentionNationId &&
      !scheduled.some(
        (activation) => activation.nationId === powerAttentionNationId,
      )
        ? [
            {
              nationId: powerAttentionNationId,
              score:
                (w.nations.find(
                  (nation) => nation.id === powerAttentionNationId,
                )?.stats.military ?? 0) /
                  5 +
                (w.nations.find(
                  (nation) => nation.id === powerAttentionNationId,
                )?.stats.economy ?? 0) /
                  10,
              reasons: ['Capability-weighted world attention slot'],
              background: true,
            },
          ]
        : []),
    ]
      .filter(
        (a) =>
          !required.includes(a.nationId) &&
          (w.observerMode || a.nationId !== w.playerNationId),
      )
      .sort((a, b) => {
        const activation = (id: NationId) =>
          scheduled.find((entry) => entry.nationId === id);
        const urgent = (id: NationId) =>
          scheduled
            .find((activation) => activation.nationId === id)
            ?.reasons.includes(
              'Due review of a persistent influence strategy',
            ) ||
          w.conflicts.some(
            (conflict) =>
              conflict.status === 'active' &&
              [...conflict.attackers, ...conflict.defenders].includes(id),
          ) ||
          pressured(w, id) ||
          w.negotiations.some(
            (n) =>
              n.status === 'open' &&
              n.recipientNationId === id &&
              (w.observerMode || id !== w.playerNationId) &&
              (pressured(w, n.proposerNationId) || w.observerMode),
          );
        if (urgent(a.nationId) !== urgent(b.nationId))
          return urgent(a.nationId) ? -1 : 1;
        if (
          (a.nationId === powerAttentionNationId) !==
          (b.nationId === powerAttentionNationId)
        )
          return a.nationId === powerAttentionNationId ? -1 : 1;
        const rotating = (id: NationId) =>
          activation(id)?.reasons.includes(
            'Guaranteed rotating planning slot',
          ) ?? false;
        if (rotating(a.nationId) !== rotating(b.nationId))
          return rotating(a.nationId) ? -1 : 1;
        // Keep the scheduler's deterministic rotation. WAIT is intentionally
        // commandless, so canonical command history cannot measure whether a
        // government was just given a planning slot.
        return (
          (scheduledRank.get(a.nationId) ?? Number.MAX_SAFE_INTEGER) -
            (scheduledRank.get(b.nationId) ?? Number.MAX_SAFE_INTEGER) ||
          b.score - a.score
        );
      })
      .slice(0, capacity)
      .map((a) => a.nationId),
  ];
  trace.importance = classifyImportance(
    w,
    input.action.source === 'player' ? input.action.text : '',
    actors,
  );
  trace.activations = actors.map((nationId) => ({
    nationId,
    score: 100,
    reasons: [
      required.includes(nationId)
        ? 'Player action or active negotiation'
        : 'Salient world opportunity',
    ],
    background: !required.includes(nationId),
  }));
  const commands: Array<{ command: WorldCommand; reason: string }> = [
    ...(trace.playerExecution?.commands ?? []),
  ];
  const reactionPreviewCommands = commands.filter(
    (entry) =>
      entry.command.type !== 'OPEN_NEGOTIATION' &&
      !(
        entry.command.type === 'CRISIS_ACTION' &&
        entry.command.move === 'talk' &&
        commands.some(
          (c) =>
            c.command.type === 'OPEN_NEGOTIATION' &&
            c.command.negotiation.id ===
              (entry.command.type === 'CRISIS_ACTION'
                ? entry.command.negotiationId
                : undefined),
        )
      ),
  );
  let working = reactionPreviewCommands.length
    ? preview(
        w,
        reactionPreviewCommands.map((c) => c.command),
        trace.id,
      )
    : w;
  const playerCounteredNegotiationIds = new Set(
    (trace.playerExecution?.commands ?? []).flatMap(({ command }) =>
      command.type === 'RESPOND_NEGOTIATION' && command.move === 'counter'
        ? [command.negotiationId]
        : [],
    ),
  );
  for (const actor of actors) {
    if (input.action.source === 'player' && actor === w.playerNationId)
      continue;
    const pending = working.negotiations
      .filter(
        (n) =>
          n.status === 'open' &&
          n.recipientNationId === actor &&
          !(
            n.kind === 'influence' &&
            !shouldRevisitDeferredInfluence(working, n)
          ) &&
          !playerCounteredNegotiationIds.has(n.id) &&
          (w.observerMode || actor !== w.playerNationId),
      )
      .slice(0, 2);
    const pendingOrganizationInvitation = working.organizations.some(
      (organization) =>
        organization.status === 'active' &&
        organization.invitations.some(
          (invitation) =>
            invitation.nationId === actor &&
            invitation.status === 'pending' &&
            invitation.lastMove !== 'counter',
        ),
    );
    stage(
      pending.length ? 'diplomatic-responses' : 'governments-deliberating',
      actor,
    );
    try {
      const scoped = trace.intent ? scopeIntent(trace.intent, actor) : null;
      const activation = scheduled.find((entry) => entry.nationId === actor);
      const influenceOpportunityTargets =
        activation?.influenceOpportunityTargetIds ?? [];
      const candidates = compactCandidates(
        working,
        actor,
        trace.id,
        scoped,
        influenceOpportunityTargets,
      );
      // A directly addressed foreign government first answers the persisted proposal.
      // It never independently adopts the player's domestic directive as its own.
      const isPlayer = scoped?.actorNationId === actor;
      let decision: z.infer<typeof CompactDecision>;
      let plannerReason: string | undefined;
      let plannerChoice: string | undefined;
      let sphereTargetNationId: NationId | null = null;
      if (pending.length) {
        const n = pending[0]!;
        const duplicate =
          n.kind !== 'influence' &&
          working.treaties.some(
            (t) =>
              t.status === 'active' &&
              t.kind === n.kind &&
              t.parties.length === 2 &&
              t.parties.includes(n.proposerNationId) &&
              t.parties.includes(n.recipientNationId),
          );
        const options = duplicate
          ? ['reject', 'counter', 'delay', 'ignore']
          : ['accept', 'reject', 'counter', 'delay', 'ignore'];
        let calibratedInfluenceDecision: ReturnType<
          typeof calibrateInfluenceResponse
        > | null = null;
        let influenceCounterOffers: ReturnType<
          typeof buildInfluenceCounterOffers
        > = [];
        const previousImportance = trace.importance;
        if (n.kind === 'influence') trace.importance = 'high';
        try {
          if (n.kind === 'influence') {
            influenceCounterOffers = buildInfluenceCounterOffers(working, n);
            const ids = influenceCounterOffers.map((candidate) => candidate.id);
            const counterOfferIdSchema = ids.length
              ? z
                  .enum(ids as [string, ...string[]])
                  .nullable()
                  .default(null)
              : z.null().default(null);
            const rawDecision = await call(
              'diplomat',
              z.strictObject({
                decisionActorId: z.literal(actor),
                counterpartNationId: z.literal(n.proposerNationId),
                choice: z.enum(['accept', 'reject', 'counter', 'delay']),
                reason: z.string().min(1).max(180),
                message: z.string().max(260),
                counterOfferId: counterOfferIdSchema,
                reconsiderationConditions: z
                  .array(z.string().min(1).max(240))
                  .max(4)
                  .default([]),
              }),
              {
                dossier: influenceResponseDossier(working, n, actor),
                counterOffers: influenceCounterOffers.map((candidate) => ({
                  id: candidate.id,
                  label: candidate.label,
                  terms: candidate.terms.map((term) => ({
                    kind: term.kind,
                    amount: term.amount,
                    ratePercent: term.ratePercent,
                  })),
                  termsText: candidate.termsText,
                })),
                choices: ['accept', 'reject', 'counter', 'delay'],
                lockedDecisionIds: {
                  decisionActorId: actor,
                  counterpartNationId: n.proposerNationId,
                },
                responseStyle:
                  'Echo both locked IDs exactly. Return one concise institutional reason, one public message, and a counteroffer ID only when choosing counter.',
                task: `DECIDING ACTOR: ${working.nations.find((nation) => nation.id === actor)?.name ?? actor} (${actor}). COUNTERPART: ${working.nations.find((nation) => nation.id === n.proposerNationId)?.name ?? n.proposerNationId} (${n.proposerNationId}). DECISION: this proposal only. Echo decisionActorId=${actor} and counterpartNationId=${n.proposerNationId}. Make one political willingness judgment. The deterministic envelope records benefits, costs, relationship, alternatives, target needs, and a recommendation zone; use those canonical facts, but make your own decision. Choose accept, reject, counter, or delay. If one or two clauses exceed what this government will grant, counter with the listed package that edits these exact structured terms. Never invent counterterms. Use delay for a genuine not-yet position and name what should change. Review negotiationMemory as the exact public before-and-after term history. Compare the current counteroffer with the terms previously communicated; do not misstate which clauses were removed or retained. The deciding actor's target-specific plan is private: it may shape the judgment but must never appear in the reason or public message. A counterpart's prior message is an objection, not your own reason; address it from the deciding actor's interests or explain why the requested change cannot be made. The sovereignty cost in the envelope belongs to the subject government, not the patron. Do not cite it as the patron's own sovereignty cost. The public message may refer only to terms already communicated in this negotiation and public facts. Do not disclose internal goals, plan labels, private reasoning, or internal numeric scores. When reviewing a target counteroffer, reason from the patron's own interests and do not answer as if you were the target. Mention the relevant rival only if it appears in this dossier. Do not assess national strategy or unrelated countries.`,
              },
              [n.id],
            );
            decision = {
              choice: rawDecision.choice,
              additionalChoices: [],
              reason: rawDecision.reason,
              message: rawDecision.message,
              counterTerms: '',
              counterInfluenceTerms: [],
            };
            calibratedInfluenceDecision = calibrateInfluenceResponse(
              working,
              n,
              rawDecision.choice,
              `${rawDecision.reason} ${rawDecision.message}`,
              {
                explanation: rawDecision.reason,
                reconsiderationConditions:
                  rawDecision.reconsiderationConditions,
              },
              influenceCounterOffers,
              rawDecision.counterOfferId ?? undefined,
              [],
              actor,
            );
            decision.choice = calibratedInfluenceDecision.move;
            decision.message = calibratedInfluenceDecision.message;
            decision.counterTerms =
              calibratedInfluenceDecision.counterOffer?.termsText ?? '';
            decision.counterInfluenceTerms =
              calibratedInfluenceDecision.counterOffer?.terms ?? [];
          } else {
            decision = await call(
              'diplomat',
              CompactDecision.extend({ choice: z.enum(options) }),
              {
                facts: compactFacts(working, actor, [
                  n.proposerNationId,
                  actor,
                ]),
                proposal: {
                  id: n.id,
                  kind: n.kind,
                  terms: n.terms,
                  obligations: n.obligations,
                  influenceTerms: n.influenceTerms,
                  peaceTerms: n.peaceTerms,
                  history: n.responses.slice(-4),
                },
                competingOffers: [],
                options,
                mechanicalConstraint: duplicate
                  ? 'An active equivalent treaty already covers these parties. A duplicate cannot create another agreement. Explain this if declining; consent to a replacement cannot be mechanically executed in this turn.'
                  : null,
                responseStyle:
                  'One sentence each for reason and message, at most 25 words.',
                task: n.sourceBreachId
                  ? 'This is a sourced settlement of an existing treaty breach. Review the recorded missed installments, arrears, duration, severity, prior demands and reciprocal obligations. Decide whether to accept a feasible settlement that suspends or cures the default, counter with specific compensation or a payment schedule, reject, or wait for a material reason. Acceptance resolves only this canonical breach episode; it does not imply trust is fully restored. Do not issue war as the default response.'
                  : 'Answer as this government about this proposal. Explain your government’s interests in a short reason and message.',
              },
              [n.id],
            );
          }
        } finally {
          trace.importance = previousImportance;
        }
        if (
          !options.includes(decision.choice) ||
          (decision.choice === 'counter' && !decision.counterTerms.trim())
        )
          throw new Error(
            'Diplomatic move is invalid or counteroffer lacks terms',
          );
        const move = decision.choice as
          'accept' | 'reject' | 'counter' | 'delay' | 'ignore';
        const decisionMessage =
          calibratedInfluenceDecision?.message ||
          (n.kind === 'influence' && decision.influenceDecision?.explanation) ||
          decision.message ||
          decision.reason;
        const influenceDecision =
          n.kind === 'influence'
            ? influenceDecisionRecord(
                working,
                actor,
                n.id,
                move,
                decisionMessage,
                decision.influenceDecision,
                calibratedInfluenceDecision
                  ? {
                      modelRationale:
                        calibratedInfluenceDecision.modelRationale,
                      displayRationale:
                        calibratedInfluenceDecision.displayRationale,
                      reconsiderationConditions:
                        calibratedInfluenceDecision.reconsiderationConditions,
                      repairNotes: calibratedInfluenceDecision.repairNotes,
                      rawDisposition:
                        calibratedInfluenceDecision.rawMove === 'delay'
                          ? 'defer'
                          : calibratedInfluenceDecision.rawMove,
                      counterOfferAvailable: influenceCounterOffers.length > 0,
                      counterOfferIds: influenceCounterOffers.map(
                        (candidate) => candidate.id,
                      ),
                      counterOfferCandidates: influenceCounterOffers,
                      ...(calibratedInfluenceDecision.counterOffer
                        ? {
                            counterOfferId:
                              calibratedInfluenceDecision.counterOffer.id,
                          }
                        : {}),
                    }
                  : {},
              )
            : undefined;
        const counterPeaceTerms =
          move === 'counter' && n.kind === 'peace'
            ? n.peaceTerms
                .flatMap((term) => {
                  if (term.kind !== 'territorial-transfer') return [];
                  const region = working.regions.find(
                    (entry) => entry.id === term.regionId,
                  );
                  return region &&
                    region.controllerNationId === actor &&
                    region.ownerNationId !== actor
                    ? [
                        {
                          kind: 'withdrawal' as const,
                          regionId: region.id,
                          fromNationId: actor,
                          toNationId: region.ownerNationId,
                        },
                      ]
                    : [];
                })
                .slice(0, 8)
            : [];
        trace.moves.push(
          DiplomaticMove.parse({
            version: 1,
            nationId: actor,
            recipientNationId: n.proposerNationId,
            negotiationId: n.id,
            move,
            message: decisionMessage,
            terms: move === 'counter' ? decision.counterTerms : n.terms,
            visibility: n.visibility,
            obligations: move === 'counter' ? [] : n.obligations,
            influenceTerms:
              move === 'counter'
                ? decision.counterInfluenceTerms
                : n.influenceTerms,
            ...(influenceDecision ? { influenceDecision } : {}),
            peaceTerms: move === 'counter' ? counterPeaceTerms : n.peaceTerms,
          }),
        );
        if (move !== 'ignore') {
          const command = WorldCommandValue.parse({
            type: 'RESPOND_NEGOTIATION',
            negotiationId: n.id,
            nationId: actor,
            move,
            message: decisionMessage,
            ...(influenceDecision ? { influenceDecision } : {}),
            ...(move === 'counter'
              ? {
                  counterTerms: decision.counterTerms,
                  counterObligations: [],
                  counterInfluenceTerms: decision.counterInfluenceTerms,
                  counterPeaceTerms,
                }
              : {}),
            ...(move === 'accept' && n.kind !== 'consultation'
              ? {
                  treatyId:
                    n.kind === 'influence'
                      ? (working.treaties.find(
                          (t) =>
                            t.status === 'active' &&
                            t.kind === 'influence' &&
                            t.parties.includes(n.proposerNationId) &&
                            t.parties.includes(n.recipientNationId),
                        )?.id ?? `treaty:${trace.id}-${actor.slice(7)}`)
                      : `treaty:${trace.id}-${actor.slice(7)}`,
                }
              : {}),
          });
          working = preview(
            w,
            [...commands.map((c) => c.command), command],
            trace.id,
          );
          commands.push({ command, reason: decision.reason });
        }
      } else {
        const plannerPlans =
          w.nations.find((nation) => nation.id === actor)?.strategy
            .influencePlans ?? [];
        const reviewablePlans = plannerPlans
          .filter((plan) => plan.status === 'active')
          .filter((plan) => plan.nextStep.kind !== 'wait')
          .filter(
            (plan) =>
              Date.parse(w.date) - Date.parse(plan.reviewedDate) >=
              180 * 86_400_000,
          )
          .filter(
            (plan) =>
              !w.negotiations.some(
                (negotiation) =>
                  negotiation.kind === 'influence' &&
                  negotiation.status === 'open' &&
                  [
                    negotiation.proposerNationId,
                    negotiation.recipientNationId,
                  ].includes(actor) &&
                  [
                    negotiation.proposerNationId,
                    negotiation.recipientNationId,
                  ].includes(plan.targetNationId),
              ),
          );
        const candidatePlans = [
          ...reviewablePlans,
          ...plannerPlans.filter(
            (plan) =>
              plan.status === 'active' &&
              !reviewablePlans.some(
                (eligible) => eligible.targetNationId === plan.targetNationId,
              ),
          ),
        ].sort(
          (a, b) =>
            b.priority - a.priority ||
            a.reviewedDate.localeCompare(b.reviewedDate),
        );
        const persistentPlan = candidatePlans.find((plan) =>
          candidates.some(
            (candidate) =>
              candidate.id.startsWith(
                `sphere-step-${plan.targetNationId.slice(7)}-`,
              ) ||
              candidate.id === `review-sphere-${plan.targetNationId.slice(7)}`,
          ),
        );
        const persistentPlanCandidate = persistentPlan
          ? candidates.find(
              (candidate) =>
                candidate.id.startsWith(
                  `sphere-step-${persistentPlan.targetNationId.slice(7)}-`,
                ) ||
                candidate.id ===
                  `review-sphere-${persistentPlan.targetNationId.slice(7)}`,
            )
          : undefined;
        const strategicInfluenceOpportunityTarget =
          influenceOpportunityTargets.find((targetId) =>
            candidates.some((candidate) =>
              candidate.id.startsWith(`sphere-step-${targetId.slice(7)}-`),
            ),
          );
        const strategicInfluenceOpportunityCandidate =
          strategicInfluenceOpportunityTarget
            ? candidates.find((candidate) =>
                candidate.id.startsWith(
                  `sphere-step-${strategicInfluenceOpportunityTarget.slice(7)}-`,
                ),
              )
            : undefined;
        const planReviewDue =
          persistentPlan !== undefined &&
          reviewablePlans.some(
            (plan) => plan.targetNationId === persistentPlan.targetNationId,
          );
        const portfolioTargetNationId =
          persistentPlan?.targetNationId ??
          strategicInfluenceOpportunityTarget ??
          w.nations.find((nation) => nation.id === actor)?.strategy
            .influencePortfolio?.priorityTargetNationId ??
          null;
        const portfolioOfferTerms = candidates.flatMap((candidate) =>
          candidate.commands.flatMap((command) =>
            command.type === 'OPEN_NEGOTIATION' &&
            command.negotiation.kind === 'influence' &&
            command.negotiation.proposerNationId === actor &&
            command.negotiation.recipientNationId === portfolioTargetNationId
              ? command.negotiation.influenceTerms
              : [],
          ),
        );
        const nationalPortfolio = influencePortfolioSnapshot(
          working,
          actor,
          portfolioTargetNationId,
          portfolioOfferTerms,
        );
        const portfolioPlans = candidatePlans.slice(0, 4);
        if (
          persistentPlan &&
          !portfolioPlans.some(
            (plan) => plan.targetNationId === persistentPlan.targetNationId,
          )
        )
          portfolioPlans.push(persistentPlan);
        const targetPlanPortfolio = portfolioPlans.map((plan) => ({
          target:
            w.nations.find((nation) => nation.id === plan.targetNationId)
              ?.name ?? plan.targetNationId,
          priority: plan.priority,
          desiredTier: plan.desiredTier,
          currentTier: plan.currentTier,
          nextStep: plan.nextStep,
          blockers: plan.blockers.slice(0, 3),
          latestResponse: plan.rejectedObligations.at(-1)
            ? {
                reasonCode: plan.rejectedObligations.at(-1)!.reasonCode,
                explanation: plan.rejectedObligations.at(-1)!.explanation,
              }
            : null,
        }));
        const sphereAllocations = candidates.flatMap((candidate) =>
          candidate.commands.flatMap((command) => {
            if (
              command.type !== 'OPEN_NEGOTIATION' ||
              command.negotiation.kind !== 'influence' ||
              command.negotiation.proposerNationId !== actor
            )
              return [];
            const terms = command.negotiation.influenceTerms;
            const annualizedCost = terms.reduce(
              (sum, term) =>
                sum +
                ([
                  'subsidy',
                  'infrastructure-investment',
                  'energy-supply',
                ].includes(term.kind)
                  ? term.amount * 12
                  : term.kind === 'debt-relief' || term.kind === 'loan'
                    ? term.amount
                    : 0),
              0,
            );
            return [
              {
                candidateId: candidate.id,
                target:
                  w.nations.find(
                    (nation) =>
                      nation.id === command.negotiation.recipientNationId,
                  )?.name ?? command.negotiation.recipientNationId,
                annualizedCost,
                affordable:
                  annualizedCost <= nationalPortfolio.availableTreasury,
              },
            ];
          }),
        );
        const directlyCoerced =
          trace.intent?.policyOrders.some(
            (order) =>
              order.targetNationIds.includes(actor) &&
              /annex|invad|demand|ultimatum|threaten|claim|seize/i.test(
                order.text,
              ),
          ) ?? false;
        if (
          !isPlayer &&
          scoped &&
          required.includes(actor) &&
          !pending.length &&
          !pendingOrganizationInvitation &&
          !directlyCoerced
        )
          continue;
        decision = await call(
          'planner',
          CompactDecision.extend({
            message: z.literal(''),
            counterTerms: z.literal(''),
            choice: z.enum(candidates.map((c) => c.id)),
            additionalChoices: z
              .array(z.enum(candidates.map((c) => c.id)))
              .max(2),
          }),
          {
            facts: compactFacts(working, actor, [
              actor,
              ...(scoped?.targetNationIds ?? []),
              ...(w.scenario.neighborhoods?.find((n) => n.nationId === actor)
                ?.neighbors ?? []),
            ]),
            intent: isPlayer ? scoped : null,
            persistentInfluencePlan: persistentPlan
              ? {
                  candidateId: persistentPlanCandidate?.id,
                  target: w.nations.find(
                    (nation) => nation.id === persistentPlan.targetNationId,
                  )?.name,
                  desiredTier: persistentPlan.desiredTier,
                  currentTier: persistentPlan.currentTier,
                  rejectedObligations:
                    persistentPlan.rejectedObligations.slice(-4),
                  blockers: persistentPlan.blockers,
                  nextStep: persistentPlan.nextStep,
                  reviewDue: planReviewDue,
                }
              : null,
            strategicInfluenceOpportunity:
              strategicInfluenceOpportunityCandidate
                ? {
                    candidateId: strategicInfluenceOpportunityCandidate.id,
                    target: w.nations.find(
                      (nation) =>
                        nation.id === strategicInfluenceOpportunityTarget,
                    )?.name,
                    explanation: strategicInfluenceOpportunityCandidate.label,
                  }
                : null,
            nationalSphereStrategy: {
              portfolio: nationalPortfolio,
              targetPlans: targetPlanPortfolio,
              candidateAllocations: sphereAllocations,
              instruction:
                'Choose one national priority from the independent target plans. Account for available treasury, current commitments and arrears, annualized proposed cost, and execution capacity. Delay lower-priority targets when the portfolio cannot support them.',
            },
            candidates: candidates.map((c) => ({
              id: c.id,
              label: c.label,
              family: c.family,
            })),
            responseStyle:
              'Reason is one institutional sentence, at most 25 words. message and counterTerms must be empty. No emoji, hashtags or repetition.',
            task: isPlayer
              ? 'Choose supplied code-authored actions that implement the actual player request. Put the primary ID in choice, and up to two other needed actions in additionalChoices; otherwise emit an empty additionalChoices array. The chosen command set will pass sequential domain validation before commit; do not invent a treasury threshold to reject an affordable player instruction. Respect negations, conditionality and private framing. If unsupported choose wait and explain the limitation; do not silently substitute a different policy. Long-term directives preserve the exact player wording.'
              : 'What problem deserves action now? War sustainability, homeland threat, exhaustion, sanctions, broken promises and crises outrank routine investment. The national sphere portfolio selects one resource priority; each target plan remains independent and its next step must stay on that target. Account for current commitments, arrears, available treasury, proposal cost and execution capacity. If a priority target plan is due, take its exact candidate unless an urgent conflict, breach or active negotiation supersedes it. Do not switch targets merely to avoid a rejection. Waiting or continuing policy is valid. Choose ONE candidate ID, additionalChoices must be empty; explain the material tradeoff.',
          },
          [actor],
        );
        const proposedCandidates = [
          decision.choice,
          ...(isPlayer ? decision.additionalChoices : []),
        ]
          .map((id) => candidates.find((candidate) => candidate.id === id))
          .filter((candidate): candidate is Candidate => !!candidate);
        const supersedingUrgentAction = proposedCandidates.some(
          (candidate) =>
            candidate.family === 'war' ||
            candidate.commands.some(
              (command) =>
                command.type === 'ENFORCE_TREATY_BREACH' ||
                command.type === 'RESPOND_NEGOTIATION',
            ),
        );
        const focusedChoice = preferredPersistentInfluenceChoice(
          decision.choice,
          persistentPlanCandidate?.id ??
            strategicInfluenceOpportunityCandidate?.id,
          persistentPlanCandidate !== undefined ||
            strategicInfluenceOpportunityCandidate !== undefined,
          supersedingUrgentAction,
        );
        plannerChoice = focusedChoice;
        const selectedIds = [
          ...new Set([
            focusedChoice,
            ...(isPlayer ? decision.additionalChoices : []),
          ]),
        ];
        const selected = selectedIds.map((id) =>
          candidates.find((c) => c.id === id),
        );
        if (selected.some((c) => !c))
          throw new Error('Government selected an unknown action');
        const selectedSphereCandidate = !isPlayer
          ? selected.find(
              (candidate) =>
                candidate?.id.startsWith('sphere-step-') ||
                candidate?.id.startsWith('review-sphere-'),
            )
          : undefined;
        sphereTargetNationId = selectedSphereCandidate
          ? (w.nations.find(
              (nation) =>
                selectedSphereCandidate.id ===
                  `review-sphere-${nation.id.slice(7)}` ||
                selectedSphereCandidate.id.startsWith(
                  `sphere-step-${nation.id.slice(7)}-`,
                ),
            )?.id ?? null)
          : null;
        const selectedTargetPlan =
          sphereTargetNationId && selectedSphereCandidate
            ? selectedSphereCandidate.commands
                .flatMap((command) =>
                  command.type === 'SET_STRATEGY'
                    ? command.strategy.influencePlans
                    : [],
                )
                .find((plan) => plan.targetNationId === sphereTargetNationId)
            : undefined;
        plannerReason = decision.reason;
        if (sphereTargetNationId) {
          const actorName =
            w.nations.find((nation) => nation.id === actor)?.name ?? actor;
          const targetName =
            w.nations.find((nation) => nation.id === sphereTargetNationId)
              ?.name ?? sphereTargetNationId;
          const relevantRivalNames =
            selectedTargetPlan?.rivalInfluence.flatMap((rival) => {
              const rivalName = w.nations.find(
                (nation) => nation.id === rival.patronNationId,
              )?.name;
              return rivalName ? [rivalName] : [];
            }) ?? [];
          const fallback = selectedTargetPlan
            ? `${actorName}'s target plan for ${targetName}: ${selectedTargetPlan.nextStep.rationale}`
            : `${actorName} selected the ${targetName} sphere plan for its next target-specific step.`;
          const repaired = repairOutOfScopeInfluenceRationale(
            plannerReason,
            w.nations.map((nation) => nation.name),
            [actorName, targetName, ...relevantRivalNames],
            fallback,
          );
          if (repaired.outOfScopeNames.length) {
            plannerReason = repaired.reason;
            trace.validatorResults.push(
              `Repaired planner rationale for ${actorName} → ${targetName}; it referenced out-of-scope ${repaired.outOfScopeNames.join(', ')}.`,
            );
          }
        }
        const seen = new Set<string>();
        const selectedCommands = selected
          .flatMap((c) => c!.commands)
          .filter((c) => {
            const key =
              c.type === 'CRISIS_ACTION'
                ? `crisis:${c.nationId}`
                : c.type === 'CONFLICT_ACTION'
                  ? `war:${c.nationId}:${c.conflictId}`
                  : c.type === 'OPEN_NEGOTIATION'
                    ? `offer:${c.negotiation.proposerNationId}:${c.negotiation.recipientNationId}`
                    : c.type === 'RESPOND_CONFERENCE'
                      ? `conference:${c.conferenceId}:${c.nationId}`
                      : JSON.stringify(c);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((c) =>
            c.type === 'RESPOND_CONFERENCE'
              ? { ...c, message: decision.message || decision.reason }
              : c,
          );
        if (!isPlayer) {
          const selectedSphere = selectedSphereCandidate;
          const sphereTarget = sphereTargetNationId;
          if (sphereTarget) {
            const offerTerms = selectedSphere!.commands.flatMap((command) =>
              command.type === 'OPEN_NEGOTIATION' &&
              command.negotiation.kind === 'influence' &&
              command.negotiation.recipientNationId === sphereTarget
                ? command.negotiation.influenceTerms
                : [],
            );
            const portfolio = influencePortfolioSnapshot(
              working,
              actor,
              sphereTarget,
              offerTerms,
            );
            const strategyCommand = selectedCommands.find(
              (command) =>
                command.type === 'SET_STRATEGY' &&
                command.nationId === actor &&
                command.strategy.influencePlans.some(
                  (plan) => plan.targetNationId === sphereTarget,
                ),
            );
            if (strategyCommand?.type === 'SET_STRATEGY') {
              strategyCommand.strategy = {
                ...strategyCommand.strategy,
                influencePortfolio: portfolio,
              };
            } else {
              selectedCommands.push({
                type: 'SET_STRATEGY',
                nationId: actor,
                strategy: {
                  ...w.nations.find((nation) => nation.id === actor)!.strategy,
                  influencePortfolio: portfolio,
                },
              });
            }
          }
        }
        working = preview(
          w,
          [...commands.map((c) => c.command), ...selectedCommands],
          trace.id,
        );
        commands.push(
          ...selectedCommands.map((command) => ({
            command,
            reason: plannerReason ?? decision.reason,
          })),
        );
      }
      const effectiveChoice = plannerChoice ?? decision.choice;
      const effectiveReason = plannerReason ?? decision.reason;
      trace.plans.push(
        NationPlan.parse({
          version: 1,
          nationId: actor,
          stance: 'independent',
          priorities: [effectiveReason],
          intentions: [effectiveChoice],
          publicStatement: decision.message,
          explanation: effectiveReason,
          decisionFactors: [
            {
              factor:
                effectiveChoice.includes('war') ||
                effectiveChoice.includes('peace')
                  ? 'military-risk'
                  : effectiveChoice.includes('project') ||
                      effectiveChoice.includes('trade') ||
                      effectiveChoice.includes('sanction')
                    ? 'economy'
                    : effectiveChoice.includes('consultation')
                      ? 'trust'
                      : 'urgency',
              assessment: effectiveReason,
              references: sphereTargetNationId
                ? [actor, sphereTargetNationId]
                : [actor],
            },
          ],
        }),
      );
      input.fault?.('after-plan');
    } catch (error) {
      signal?.throwIfAborted();
      if (
        !w.observerMode &&
        pending.some((n) => n.proposerNationId === w.playerNationId)
      )
        throw new Error(
          `${w.nations.find((n) => n.id === actor)!.name} could not complete an important decision. Retry this turn or test the model in settings. No outcome committed.`,
          { cause: error },
        );
      trace.failures.push(
        `${required.includes(actor) ? 'Required foreign decision deferred' : 'Background government skipped'} for ${actor}: ${error instanceof Error ? error.message : 'inference failed'}`,
      );
    }
  }
  stage('resolving');
  trace.proposal = {
    version: 1,
    explanation:
      'Independent government choices resolved sequentially against canonical domain constraints.',
    commands,
  };
  input.fault?.('after-proposal');
  stage('validating');
  input.fault?.('during-validation');
  const request = CommitRequest.parse({
    expectedRevision: w.revision,
    expectedHash: input.expectedHash,
    action: {
      ...input.action,
      ...(trace.intent?.actionGraph
        ? { semanticGraph: trace.intent.actionGraph }
        : {}),
    },
    commands: [
      ...commands,
      {
        command: {
          type: 'ADVANCE_DATE',
          date: later(w.date, input.days ?? 30),
        },
        reason: 'Explicit simulation time advancement',
      },
    ].map((c, i) => ({ ...c, id: `command:${trace.id}-${i}` })),
  });
  preview(
    w,
    request.commands.map((c) => c.command),
    trace.id,
  );
  if (trace.intent && trace.playerExecution) {
    const audit = auditMajorIntentClauses(
      w,
      trace.intent,
      request.commands.map((entry) => entry.command),
    );
    trace.playerExecution.intentSatisfactionAudit = audit;
    const unsupported = audit.filter((entry) => entry.status === 'UNSUPPORTED');
    if (unsupported.length)
      throw new Error(
        `Major player intent satisfaction audit failed: ${unsupported.map((entry) => `${entry.clauseId} (${entry.explanation})`).join('; ')}`,
      );
    trace.validatorResults.push(
      `Major player-intent audit represented ${audit.filter((entry) => entry.status !== 'BLOCKED_BY_REAL_WORLD_CONSTRAINT').length}/${audit.length} clauses in validated mechanics; explicit world constraints are recorded separately.`,
    );
  }
  trace.validatorResults.push(
    'Compact choices validated against code-owned candidates, independent recipient consent, sequential domain checks and hard invariants.',
  );
  if (trace.playerExecution?.commands.length)
    trace.validatorResults.push(
      `Player Action Executor preserved ${trace.playerExecution.orders.length} authoritative order(s) through ${trace.playerExecution.commands.length} validated canonical command(s).`,
    );
  return request;
}
import { WorldCommand as WorldCommandValue } from '@mandate/schemas';
