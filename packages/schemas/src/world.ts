import { ActionGrounding, SemanticAction, SemanticGraph } from './semantic.js';
import { z } from 'zod';
import {
  ActionId,
  CommandId,
  ConflictId,
  EventId,
  GoalId,
  InitiativeId,
  NegotiationId,
  OrganizationId,
  OrganizationCommitmentId,
  OrganizationProgramId,
  NationId,
  RegionId,
  SaveId,
  ScenarioId,
  TreatyId,
  TurnId,
} from './ids.js';

export const SimulationDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (date) =>
      Number.isFinite(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date,
    'Expected a real ISO calendar date',
  );
export const Text = z.string().trim().min(1).max(4000);
const Name = z.string().trim().min(1).max(160);
export const StatName = z.enum([
  'economy',
  'military',
  'stability',
  'legitimacy',
  'treasury',
  'debt',
  'industrial',
  'fiscal',
  'readiness',
  'manpower',
  'technology',
  'influence',
  'energyExposure',
  'tradeDependence',
  'unrest',
]);
export const Stats = z.strictObject({
  economy: z.number().int().min(0).max(100),
  military: z.number().int().min(0).max(100),
  stability: z.number().int().min(0).max(100),
  legitimacy: z.number().int().min(0).max(100),
  treasury: z.number().int().min(0).max(1_000_000_000),
  debt: z.number().int().min(0).max(1_000_000_000).default(0),
  industrial: z.number().int().min(0).max(100).default(50),
  fiscal: z.number().int().min(0).max(100).default(50),
  readiness: z.number().int().min(0).max(100).default(50),
  manpower: z.number().int().min(0).max(100).default(50),
  technology: z.number().int().min(0).max(100).default(50),
  influence: z.number().int().min(0).max(100).default(50),
  energyExposure: z.number().int().min(0).max(100).default(50),
  tradeDependence: z.number().int().min(0).max(100).default(50),
  unrest: z.number().int().min(0).max(100).default(10),
});
export const Government = z.strictObject({ type: Name, ideology: Name });
export const InfluenceTermKind = z.enum([
  'join-defensive-wars',
  'join-patron-wars',
  'war-declaration-approval',
  'no-war-against-patron',
  'military-access',
  'host-bases',
  'military-planning',
  'foreign-policy-consultation',
  'foreign-policy-alignment',
  'no-rival-alliance',
  'support-diplomatic-initiatives',
  'foreign-policy-veto',
  'economic-policy-approval',
  'tribute',
  'preferential-trade',
  'market-access-concession',
  'energy-supply',
  'exclusive-market-access',
  'customs-alignment',
  'common-economic-rules',
  'mandatory-procurement',
  'debt-repayment',
  'loan',
  'debt-relief',
  'subsidy',
  'infrastructure-investment',
  'security-guarantee',
  'government-security-arrangement',
]);
export type InfluenceTermKind = z.infer<typeof InfluenceTermKind>;
export const InfluenceChannel = z.enum([
  'trade',
  'finance',
  'aid',
  'debt',
  'energy',
  'infrastructure',
  'security',
  'marketAccess',
  'organization',
  'diplomatic',
]);
export const InfluenceTier = z.enum([
  'INDEPENDENT',
  'PARTNER',
  'DEPENDENT PARTNER',
  'CLIENT STATE',
  'PROTECTORATE',
  'SUBJECT STATE',
  'PUPPET STATE',
]);
export const InfluenceRejectionReason = z.enum([
  'sovereignty-cost',
  'insufficient-leverage',
  'rival-offer',
  'low-trust',
  'resistance',
  'inadequate-compensation',
  'incompatible-preferences',
  'patron-unreliable',
  'fiscal-risk',
  'uncertain-benefit',
  'acceptable-balanced-offer',
  'best-rival-offer',
  'autonomy-protected',
  'timing-not-ready',
]);
export const InfluenceRecommendationZone = z.enum([
  'strongly-favorable',
  'favorable',
  'negotiable',
  'unfavorable',
  'strongly-unfavorable',
]);
export const InfluenceAssessment = z.strictObject({
  recommendationZone: InfluenceRecommendationZone,
  score: z.number().int().min(-100).max(100),
  benefits: z.strictObject({
    economic: z.number().int().min(0).max(100),
    security: z.number().int().min(0).max(100),
    debtAndAid: z.number().int().min(0).max(100),
    infrastructure: z.number().int().min(0).max(100),
    marketAccess: z.number().int().min(0).max(100),
    organization: z.number().int().min(0).max(100),
    total: z.number().int().min(0).max(100),
  }),
  costs: z.strictObject({
    sovereignty: z.number().int().min(0).max(100),
    fiscal: z.number().int().min(0).max(100),
    militaryObligation: z.number().int().min(0).max(100),
    diplomaticRestriction: z.number().int().min(0).max(100),
    patronBudget: z.number().int().min(0).max(100).optional(),
  }),
  relationship: z.strictObject({
    trust: z.number().int().min(0).max(100),
    reliability: z.number().int().min(0).max(100),
    leverage: z.number().int().min(0).max(100),
    resistance: z.number().int().min(0).max(100),
    existingDependence: z.number().int().min(0).max(100),
    obligations: z.number().int().min(0).max(100),
    grievance: z.number().int().min(0).max(100),
  }),
  alternatives: z.strictObject({
    rivalNationId: NationId.nullable(),
    rivalLeverage: z.number().int().min(0).max(100),
    rivalOfferScore: z.number().int().min(-100).max(100).nullable(),
    outsideOption: z.number().int().min(0).max(100),
    switchingCost: z.number().int().min(0).max(100),
  }),
  strategicFit: z.strictObject({
    targetThreat: z.number().int().min(0).max(100),
    economicPressure: z.number().int().min(0).max(100),
    alignedGoals: z.number().int().min(0).max(100),
    preferenceFit: z.number().int().min(0).max(100),
  }),
});
export type InfluenceAssessment = z.infer<typeof InfluenceAssessment>;
export const InfluenceStrategyPlan = z.strictObject({
  targetNationId: NationId,
  desiredTier: InfluenceTier,
  currentTier: InfluenceTier,
  status: z
    .enum(['active', 'achieved', 'paused', 'abandoned'])
    .default('active'),
  priority: z.number().int().min(1).max(5).default(3),
  createdDate: SimulationDate,
  reviewedDate: SimulationDate,
  rationale: Text,
  strongestChannels: z.array(InfluenceChannel).max(3).default([]),
  weakestChannels: z.array(InfluenceChannel).max(3).default([]),
  leverage: z.number().int().min(0).max(100).default(0),
  resistance: z.number().int().min(0).max(100).default(0),
  patronReliability: z.number().int().min(0).max(100).default(65),
  rivalInfluence: z
    .array(
      z.strictObject({
        patronNationId: NationId,
        tier: InfluenceTier,
        leverage: z.number().int().min(0).max(100),
        reliability: z.number().int().min(0).max(100),
      }),
    )
    .max(5)
    .default([]),
  blockers: z.array(Text).max(8).default([]),
  acceptedObligations: z
    .array(
      z.strictObject({
        kind: InfluenceTermKind,
        treatyId: TreatyId,
        date: SimulationDate,
      }),
    )
    .max(40)
    .default([]),
  rejectedObligations: z
    .array(
      z.strictObject({
        negotiationId: NegotiationId,
        date: SimulationDate,
        reasonCode: InfluenceRejectionReason,
        requestedKinds: z.array(InfluenceTermKind).max(32),
        explanation: Text,
      }),
    )
    .max(20)
    .default([]),
  recentCounteroffers: z
    .array(
      z.strictObject({
        negotiationId: NegotiationId,
        date: SimulationDate,
        requestedKinds: z.array(InfluenceTermKind).max(32),
        counterKinds: z.array(InfluenceTermKind).max(32),
        explanation: Text,
      }),
    )
    .max(10)
    .default([]),
  nextStep: z.strictObject({
    kind: z.enum([
      'build-economic-dependence',
      'build-security-reliance',
      'improve-trust',
      'reduce-rival-options',
      'seek-consultation',
      'seek-coordination',
      'seek-policy-authority',
      'renegotiate',
      'enforce',
      'wait',
      'diversify',
    ]),
    rationale: Text,
    proposedBenefits: Text.nullable().default(null),
    requestedTerms: z.array(InfluenceTermKind).max(8).default([]),
  }),
});
export type InfluenceStrategyPlan = z.infer<typeof InfluenceStrategyPlan>;
export const InfluencePortfolio = z.strictObject({
  priorityTargetNationId: NationId.nullable(),
  reviewedDate: SimulationDate,
  availableTreasury: z.number().int().min(0).max(1_000_000_000),
  committedAnnualCost: z.number().int().min(0).max(1_000_000_000),
  plannedAnnualCost: z.number().int().min(0).max(1_000_000_000),
  executionCapacity: z.number().int().min(0).max(1000),
  rationale: Text,
});
export type InfluencePortfolio = z.infer<typeof InfluencePortfolio>;
export const Strategy = z
  .strictObject({
    riskTolerance: z.number().int().min(0).max(100).default(40),
    // Share of modeled fiscal capacity assigned to recurring defense spending.
    // The deterministic time engine applies readiness and fiscal consequences.
    militaryBudgetShare: z.number().int().min(0).max(100).default(35),
    taxRate: z.number().int().min(0).max(100).default(50),
    orientation: z
      .enum(['security', 'economic', 'diplomatic', 'domestic'])
      .default('security'),
    redLines: z.array(Text).max(8).default([]),
    influencePlans: z.array(InfluenceStrategyPlan).max(20).default([]),
    influencePortfolio: InfluencePortfolio.nullable().default(null),
    directives: z
      .array(
        z.strictObject({
          id: Name,
          text: Text,
          priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
          visibility: z.enum(['public', 'private']),
          status: z.enum(['active', 'cancelled']),
          createdDate: SimulationDate,
          semanticPlan: SemanticAction.optional(),
        }),
      )
      .max(20)
      .default([]),
  })
  .default({
    riskTolerance: 40,
    militaryBudgetShare: 35,
    taxRate: 50,
    orientation: 'security',
    redLines: [],
    directives: [],
    influencePlans: [],
    influencePortfolio: null,
  });
export const Nation = z.strictObject({
  id: NationId,
  name: Name,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  government: Government,
  leader: Name,
  stats: Stats,
  strategy: Strategy,
});
export const Region = z.strictObject({
  id: RegionId,
  name: Name,
  geometryId: RegionId,
  ownerNationId: NationId,
  controllerNationId: NationId,
  claims: z.array(NationId).max(500),
  recognizedClaims: z.array(NationId).max(500).default([]),
});
export const Relation = z.strictObject({
  nationA: NationId,
  nationB: NationId,
  score: z.number().int().min(-100).max(100),
  trust: z.number().int().min(0).max(100).default(50),
  tension: z.number().int().min(0).max(100).default(10),
  tradeDependence: z.number().int().min(0).max(100).default(25),
  militaryAlignment: z.number().int().min(-100).max(100).default(0),
  grievances: z.array(Text).max(20).default([]),
  factors: z
    .array(
      z.strictObject({
        date: SimulationDate,
        cause: Text,
        scoreDelta: z.number().int().min(-200).max(200),
        trustDelta: z.number().int().min(-100).max(100),
        visibility: z.enum(['public', 'private']).default('public'),
      }),
    )
    .max(40)
    .default([]),
});
export const InfluenceTerm = z.strictObject({
  kind: InfluenceTermKind,
  patronNationId: NationId,
  subjectNationId: NationId,
  status: z
    .enum(['active', 'suspended', 'withdrawn', 'breached'])
    .default('active'),
  // For energy-supply, amount is in-kind delivery units; other term kinds use it as a payment amount.
  amount: z.number().int().min(0).max(1_000_000_000).default(0),
  ratePercent: z.number().int().min(0).max(100).default(0),
  paidAmount: z.number().int().min(0).max(1_000_000_000).default(0),
  paymentsMade: z.number().int().min(0).max(100_000).default(0),
  arrears: z.number().int().min(0).max(100_000).default(0),
  revenueRemainder: z.number().int().min(0).max(1_000_000_000).default(0),
  lastPaymentDate: SimulationDate.nullable().default(null),
});
export type InfluenceTerm = z.infer<typeof InfluenceTerm>;
export const InfluenceOfferComparison = z.strictObject({
  negotiationId: NegotiationId,
  patronNationId: NationId,
  economicValue: z.number().int().min(0).max(100),
  securityValue: z.number().int().min(0).max(100),
  sovereigntyCost: z.number().int().min(0).max(100),
  reliability: z.number().int().min(0).max(100),
  switchingCost: z.number().int().min(0).max(100),
  netScore: z.number().int().min(-100).max(100),
  selected: z.boolean(),
});
export const InfluenceCounterOfferSummary = z.strictObject({
  id: z.string().trim().min(1).max(120),
  label: Text,
  terms: z.array(InfluenceTerm).max(16),
  termsText: z.string().max(600),
});
export const InfluenceDecision = z.strictObject({
  reasonCode: InfluenceRejectionReason,
  explanation: Text,
  comparison: z.array(InfluenceOfferComparison).max(5).default([]),
  possibleLeverage: z.array(Text).max(4).default([]),
  assessment: InfluenceAssessment.optional(),
  disposition: z.enum(['accept', 'counter', 'reject', 'defer']).optional(),
  rawDisposition: z.enum(['accept', 'counter', 'reject', 'defer']).optional(),
  decisionPerspective: z.enum(['target', 'patron']).optional(),
  modelRationale: Text.optional(),
  reconsiderationConditions: z.array(Text).max(4).optional(),
  repairNotes: z.array(Text).max(4).optional(),
  counterOfferAvailable: z.boolean().optional(),
  counterOfferIds: z.array(z.string().trim().min(1).max(120)).max(3).optional(),
  counterOfferCandidates: z
    .array(InfluenceCounterOfferSummary)
    .max(3)
    .optional(),
  counterOfferId: z.string().trim().min(1).max(120).optional(),
});
export type InfluenceDecision = z.infer<typeof InfluenceDecision>;
export const InfluencePressure = z.strictObject({
  patronNationId: NationId,
  subjectNationId: NationId,
  condition: z.enum([
    'rejection',
    'joins-rival-alliance',
    'accepts-rival-security',
  ]),
  channel: z.enum([
    'aid',
    'infrastructure',
    'energy',
    'market-access',
    'security-guarantee',
    'organization-support',
  ]),
  action: z.enum(['suspend', 'withdraw', 'reduce']),
  severity: z.number().int().min(1).max(100).default(25),
  status: z.enum(['pending', 'triggered', 'satisfied']).default('pending'),
  createdDate: SimulationDate,
  triggeredDate: SimulationDate.nullable().default(null),
});
export type InfluencePressure = z.infer<typeof InfluencePressure>;
export const TreatyBreach = z.strictObject({
  id: z.string().regex(/^breach:[a-z0-9._-]+$/),
  date: SimulationDate,
  obligationKey: z.string().trim().min(1).max(160).nullable().default(null),
  firstMissedDate: SimulationDate.nullable().default(null),
  lastMissedDate: SimulationDate.nullable().default(null),
  missedInstallments: z.number().int().min(0).max(100000).default(0),
  arrearsAmount: z.number().int().min(0).max(1_000_000_000).default(0),
  durationMonths: z.number().int().min(0).max(100000).default(0),
  severity: z.number().int().min(0).max(100).default(25),
  milestones: z
    .array(
      z.strictObject({
        key: z.enum([
          'first-missed',
          'arrears-severe',
          'demanded',
          'suspended',
          'renegotiated',
          'resolved',
        ]),
        date: SimulationDate,
      }),
    )
    .max(12)
    .default([]),
  violatingNationId: NationId,
  injuredNationId: NationId,
  reason: Text,
  status: z.enum(['open', 'enforced', 'resolved']).default('open'),
});
export type TreatyBreach = z.infer<typeof TreatyBreach>;
export const RatificationGovernment = z.strictObject({
  nationId: NationId,
  government: Government,
});
export type RatificationGovernment = z.infer<typeof RatificationGovernment>;
export const TreatyEnforcementAction = z.enum([
  'diplomatic-demand',
  'suspend-subsidy',
  'cancel-market-access',
  'demand-arrears',
  'political-pressure',
  'withdraw-guarantee',
  'sanction',
  'renegotiate',
  'suspend-reciprocals',
  'waive',
  'terminate',
]);
export const TreatyEnforcement = z.strictObject({
  id: z.string().regex(/^enforcement:[a-z0-9._-]+$/),
  date: SimulationDate,
  breachId: z.string().regex(/^breach:[a-z0-9._-]+$/),
  patronNationId: NationId,
  subjectNationId: NationId,
  actingNationId: NationId.optional(),
  action: TreatyEnforcementAction,
  amount: z.number().int().min(0).max(1_000_000_000).default(0),
  result: Text,
});
export type TreatyEnforcement = z.infer<typeof TreatyEnforcement>;
export const PatronDirectiveKind = z.enum([
  'join-conflict',
  'grant-military-access',
  'leave-organization',
  'end-rival-treaty',
  'support-diplomatic-initiative',
  'coordinate-foreign-policy',
]);
export const PatronDirective = z.strictObject({
  id: z.string().regex(/^directive:[a-z0-9._-]+$/),
  patronNationId: NationId,
  subjectNationId: NationId,
  kind: PatronDirectiveKind,
  conflictId: ConflictId.nullable().default(null),
  organizationId: OrganizationId.nullable().default(null),
  targetTreatyId: TreatyId.nullable().default(null),
  policyText: Text.nullable().default(null),
  issuedDate: SimulationDate,
  status: z.enum([
    'complied',
    'consultation-only',
    'refused',
    'unauthorized',
    'failed',
  ]),
  reason: Text,
});
export type PatronDirective = z.infer<typeof PatronDirective>;
export const Treaty = z.strictObject({
  id: TreatyId,
  name: Name,
  ratifiedDate: SimulationDate.optional(),
  kind: z.enum([
    'defense',
    'trade',
    'nonaggression',
    'influence',
    'ceasefire',
    'peace',
  ]),
  conflictId: ConflictId.nullable().default(null),
  parties: z.array(NationId).min(2).max(500),
  status: z.enum(['active', 'ended']),
  terms: Text,
  visibility: z.enum(['public', 'private']).default('public'),
  influenceTerms: z.array(InfluenceTerm).max(32).default([]),
  directives: z.array(PatronDirective).max(200).default([]),
  breaches: z.array(TreatyBreach).max(200).default([]),
  enforcements: z.array(TreatyEnforcement).max(200).default([]),
  ratificationGovernments: z.array(RatificationGovernment).max(500).default([]),
});
export const Conflict = z.strictObject({
  id: ConflictId,
  name: Name,
  attackers: z.array(NationId).min(1).max(500),
  defenders: z.array(NationId).min(1).max(500),
  status: z.enum(['active', 'ended']),
  escalation: z.number().int().min(0).max(100),
  settlementState: z.enum(['fighting', 'ceasefire']).default('fighting'),
  exhaustion: z.number().int().min(0).max(100).default(0),
  logistics: z.number().int().min(0).max(100).default(50),
  warGoals: z.array(Text).max(20).default([]),
  theaters: z
    .array(
      z.strictObject({
        id: z.string().regex(/^theater:[a-z0-9._-]+$/),
        nationId: NationId,
        regionIds: z.array(RegionId).min(1).max(10),
        posture: z.enum([
          'hold',
          'reinforce',
          'limited-offensive',
          'major-offensive',
          'withdraw',
          'air-pressure',
          'naval-pressure',
          'prepare-ceasefire',
        ]),
        allocation: z.number().int().min(1).max(100),
        logistics: z.number().int().min(0).max(100).default(50),
        supplyPressure: z.number().int().min(0).max(100).default(0),
        initiative: z.number().int().min(0).max(100).default(50),
        momentum: z.number().int().min(-100).max(100).default(0),
        exhaustion: z.number().int().min(0).max(100).default(0),
        progress: z.number().int().min(0).max(100).default(0),
        recentOutcomes: z
          .array(
            z.strictObject({
              date: SimulationDate,
              outcome: z.enum([
                'major-advance',
                'limited-advance',
                'stalemate',
                'failed-offensive',
                'counterattack',
                'strategic-withdrawal',
              ]),
              regionId: RegionId.nullable(),
              note: Text,
            }),
          )
          .max(12)
          .default([]),
      }),
    )
    .max(100)
    .default([]),
  campaigns: z
    .array(
      z.strictObject({
        regionId: RegionId,
        nationId: NationId,
        progress: z.number().int().min(0).max(100),
      }),
    )
    .max(1000)
    .default([]),
});
export const Goal = z.strictObject({
  id: GoalId,
  nationId: NationId,
  title: Name,
  priority: z.number().int().min(0).max(100),
  status: z.enum([
    'proposed',
    'active',
    'advancing',
    'stalled',
    'threatened',
    'blocked',
    'achieved',
    'abandoned',
    'failed',
    'superseded',
  ]),
  evaluation: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('metrics') }),
      z.strictObject({ kind: z.literal('capacity') }),
      z.strictObject({
        kind: z.literal('relationship'),
        nationId: NationId,
        baseline: z.number().int().min(-100).max(100),
        target: z.number().int().min(-100).max(100),
      }),
      z.strictObject({
        kind: z.literal('territory'),
        regionId: RegionId,
        mode: z.enum(['ownership', 'control']),
      }),
      z.strictObject({
        kind: z.literal('organization'),
        organizationId: OrganizationId,
      }),
      z.strictObject({
        kind: z.literal('project'),
        initiativeId: InitiativeId,
      }),
      z.strictObject({
        kind: z.literal('dependence'),
        partnerNationId: NationId,
        baseline: z.number().int().min(1).max(100),
        target: z.number().int().min(0).max(99),
      }),
      z.strictObject({
        kind: z.literal('influence'),
        subjectNationIds: z.array(NationId).min(1).max(500),
        tier: z.enum([
          'DEPENDENT PARTNER',
          'CLIENT STATE',
          'PROTECTORATE',
          'SUBJECT STATE',
          'PUPPET STATE',
        ]),
      }),
    ])
    .default({ kind: 'capacity' }),
  pressure: z.number().int().min(0).max(100).default(0),
  stalledDays: z.number().int().min(0).default(0),
  deferredToGoalId: GoalId.nullable().default(null),
  strategyReview: Text.nullable().default(null),
  parentGoalId: GoalId.nullable().default(null),
  signals: z
    .array(
      z.strictObject({
        stat: StatName,
        baseline: z.number().int(),
        target: z.number().int(),
        weight: z.number().int().min(1).max(100),
      }),
    )
    .max(8)
    .default([]),
  targetNationIds: z.array(NationId).max(500),
  progress: z.number().int().min(0).max(100),
  reason: Text,
  createdDate: SimulationDate,
  updatedDate: SimulationDate,
  kind: z
    .enum(['security', 'economic', 'diplomatic', 'territorial', 'domestic'])
    .default('security'),
  visibility: z.enum(['public', 'private']).default('public'),
  deadline: SimulationDate.nullable().default(null),
  blockers: z.array(Text).max(20).default([]),
  evidence: z.array(Text).max(20).default([]),
});
export const EventFields = z.strictObject({
  id: EventId,
  type: Name,
  title: Name,
  nationIds: z.array(NationId).max(500),
  regionIds: z.array(RegionId).max(500),
  treatyIds: z.array(TreatyId).max(500),
  conflictIds: z.array(ConflictId).max(500),
  importance: z.number().int().min(0).max(100),
  novelty: z
    .enum([
      'maintenance',
      'progress',
      'milestone',
      'new-action',
      'consequence',
      'major-development',
    ])
    .optional(),
  semanticSignature: z.string().trim().min(1).max(500).optional(),
  provenance: z
    .strictObject({
      kind: z.enum([
        'current-player-order',
        'originating-decision',
        'automatic-effect',
        'independent-action',
      ]),
      originatingActionId: ActionId.nullable(),
      triggeringActionId: ActionId.nullable(),
    })
    .optional(),
  topics: z.array(Name).max(20),
  visibility: z.enum(['public', 'private']),
  status: z.enum(['resolved', 'unresolved']),
});
export const Event = EventFields.extend({
  effects: z
    .array(
      z.strictObject({
        nationId: NationId,
        stat: StatName,
        before: z.number().int(),
        after: z.number().int(),
      }),
    )
    .max(7000)
    .default([]),
  date: SimulationDate,
  turnId: TurnId,
  sourceCommandIds: z.array(CommandId).min(1).max(100),
});
export const Action = z.strictObject({
  semanticGraph: SemanticGraph.optional(),
  grounding: ActionGrounding.optional(),
  id: ActionId,
  turnId: TurnId,
  actorNationId: NationId,
  source: z.enum(['debug', 'player', 'system']),
  text: Text,
});
export const Turn = z.strictObject({
  id: TurnId,
  revision: z.number().int().min(1),
  previousDate: SimulationDate,
  date: SimulationDate,
  recordedAt: z.iso.datetime(),
  actionId: ActionId,
  commandIds: z.array(CommandId).min(1).max(100),
  eventIds: z.array(EventId).max(100),
  suppressedCommandIds: z.array(CommandId).max(100).optional(),
  eventMetrics: z
    .strictObject({
      candidateCount: z.number().int().min(0),
      surfacedCount: z.number().int().min(0),
      duplicateSuppressed: z.number().int().min(0),
      maintenanceSuppressed: z.number().int().min(0),
      progressSuppressed: z.number().int().min(0),
    })
    .optional(),
});
export const ScenarioMetadata = z.strictObject({
  id: ScenarioId,
  name: Name,
  description: Text,
  synthetic: z.boolean(),
  startDate: SimulationDate,
  geographyVersion: z.string().min(1).max(100),
  rules: z
    .strictObject({
      turnDays: z.number().int().min(1).max(365),
      economicSeverity: z.number().int().min(0).max(200),
      crisisSensitivity: z.number().int().min(0).max(200),
      aiActivity: z.enum(['quiet', 'balanced', 'active']),
      seed: z.string().min(1).max(100),
      enabledMechanics: z
        .array(z.enum(['crises', 'economic-networks', 'elections', 'theaters']))
        .max(4),
    })
    .optional(),
  neighborhoods: z
    .array(
      z.strictObject({
        nationId: NationId,
        neighbors: z.array(NationId).max(20),
      }),
    )
    .max(500)
    .optional(),
  regionAdjacency: z
    .array(
      z.strictObject({
        regionId: RegionId,
        neighbors: z.array(RegionId).max(500),
      }),
    )
    .max(20000)
    .default([]),
  strategicActors: z.array(NationId).max(20).optional(),
});
export type Nation = z.infer<typeof Nation>;
export type Region = z.infer<typeof Region>;
export type Relation = z.infer<typeof Relation>;
export type Treaty = z.infer<typeof Treaty>;
export type Conflict = z.infer<typeof Conflict>;
export type Goal = z.infer<typeof Goal>;
export type Event = z.infer<typeof Event>;
export type Action = z.infer<typeof Action>;
export type Turn = z.infer<typeof Turn>;
export { SaveId };

export const Initiative = z.strictObject({
  id: InitiativeId,
  nationId: NationId,
  name: Name,
  kind: z.enum([
    'industry',
    'energy',
    'rearmament',
    'reform',
    'diplomacy',
    'aid',
  ]),
  startDate: SimulationDate,
  durationDays: z.number().int().min(30).max(3650),
  effort: z.number().int().min(1).max(10),
  targetNationId: NationId.nullable().default(null),
  visibility: z.enum(['public', 'private']).default('public'),
  status: z.enum(['active', 'completed', 'cancelled']).default('active'),
  progress: z.number().int().min(0).max(100).default(0),
  invested: z.number().int().min(0).max(1000000).default(0),
  delays: z.number().int().min(0).default(0),
  blocker: Text.nullable().default(null),
  completedDate: SimulationDate.optional(),
  milestones: z.array(z.number().int().min(1).max(100)).max(4).default([]),
  dependencies: z.array(InitiativeId).max(20).default([]),
});
export const CommitmentTerms = z.strictObject({
  issuer: NationId,
  recipients: z.array(NationId).min(1).max(8),
  type: z.enum([
    'aid',
    'project',
    'nonaggression',
    'guarantee',
    'basing',
    'peace-term',
  ]),
  terms: Text,
  strength: z.enum(['assurance', 'pledge', 'binding']),
  dueDate: SimulationDate.nullable(),
  expiry: SimulationDate.nullable(),
  condition: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('project'),
      initiativeKind: Initiative.shape.kind,
      minimumInvestment: z.number().int().min(1).max(1000000),
    }),
    z.strictObject({ kind: z.literal('restraint') }),
  ]),
});
export const Commitment = CommitmentTerms.extend({
  id: z.string().regex(/^commitment:[a-z0-9._-]+$/),
  deliveries: z
    .array(
      z.strictObject({
        initiativeId: InitiativeId,
        investment: z.number().int().min(1).max(1000000),
      }),
    )
    .max(100)
    .default([]),
  createdDate: SimulationDate,
  sourceNegotiationId: NegotiationId,
  visibility: z.enum(['public', 'private']),
  status: z.enum(['active', 'fulfilled', 'breached', 'expired']),
  history: z
    .array(
      z.strictObject({
        date: SimulationDate,
        status: z.enum(['active', 'fulfilled', 'breached', 'expired']),
        reason: Text,
      }),
    )
    .min(1)
    .max(20),
});
export type Commitment = z.infer<typeof Commitment>;
export const PeaceTerm = z.strictObject({
  kind: z.enum(['withdrawal', 'territorial-transfer', 'recognize-claim']),
  regionId: RegionId,
  fromNationId: NationId,
  toNationId: NationId,
});
export const NegotiationResponse = z.strictObject({
  nationId: NationId,
  date: SimulationDate,
  move: z.enum(['accept', 'reject', 'counter', 'delay', 'withdraw', 'ignore']),
  message: Text,
  offeredTerms: Text.optional(),
  counterTerms: Text.optional(),
  influenceDecision: InfluenceDecision.optional(),
  peaceTerms: z.array(PeaceTerm).max(8).optional(),
  obligations: z.array(CommitmentTerms).max(8).optional(),
  influenceTerms: z.array(InfluenceTerm).max(32).optional(),
  counterInfluenceTerms: z.array(InfluenceTerm).max(32).optional(),
});
export const Negotiation = z.strictObject({
  id: NegotiationId,
  proposerNationId: NationId,
  recipientNationId: NationId,
  topic: Name,
  kind: z.enum([
    'consultation',
    'influence',
    'defense',
    'trade',
    'nonaggression',
    'ceasefire',
    'peace',
  ]),
  conflictId: ConflictId.nullable().default(null),
  terms: Text,
  visibility: z.enum(['public', 'private']).default('public'),
  status: z
    .enum(['open', 'accepted', 'rejected', 'withdrawn', 'expired'])
    .default('open'),
  obligations: z.array(CommitmentTerms).max(8).default([]),
  influenceTerms: z.array(InfluenceTerm).max(32).default([]),
  conditionalPressure: InfluencePressure.nullable().default(null),
  sourceBreachId: z
    .string()
    .regex(/^breach:[a-z0-9._-]+$/)
    .nullable()
    .optional(),
  initialTerms: Text.optional(),
  peaceTerms: z.array(PeaceTerm).max(8).default([]),
  createdDate: SimulationDate,
  expiresDate: SimulationDate,
  responses: z.array(NegotiationResponse).max(100).default([]),
  treatyId: TreatyId.nullable().default(null),
});
export const OrganizationKind = z.enum([
  // Legacy categories remain readable in version-3 saves.
  'alliance',
  'economic',
  'institution',
  'regional',
  'economic-union',
  'trade-bloc',
  'military-alliance',
  'defensive-pact',
  'political-organization',
  'regional-organization',
  'customs-union',
  'international-organization',
]);
export type OrganizationKind = z.infer<typeof OrganizationKind>;
export const OrganizationInvitation = z.strictObject({
  nationId: NationId,
  invitedDate: SimulationDate,
  updatedDate: SimulationDate,
  status: z.enum(['pending', 'accepted', 'rejected', 'withdrawn']),
  lastMove: z.enum(['accept', 'reject', 'delay', 'counter']).nullable(),
  message: Text.nullable(),
  counterTerms: Text.nullable(),
});
export const OrganizationApplication = z.strictObject({
  nationId: NationId,
  appliedDate: SimulationDate,
  updatedDate: SimulationDate,
  status: z.enum(['pending', 'accepted', 'rejected', 'withdrawn']),
  terms: Text,
});
export const OrganizationCommitment = z.strictObject({
  id: OrganizationCommitmentId,
  issuer: NationId,
  kind: z.enum([
    'economic-support',
    'financial-aid',
    'trade-cooperation',
    'security-cooperation',
    'sanctions-coordination',
    'other',
  ]),
  terms: Text,
  appliesTo: z.enum(['all-members', 'new-members', 'specific-members']),
  recipientNationIds: z.array(NationId).max(500).default([]),
  costPerMember: z.number().int().min(0).max(1_000_000).default(0),
  frequencyDays: z.number().int().min(1).max(365).default(30),
  status: z.enum(['active', 'breached', 'withdrawn']).default('active'),
  createdDate: SimulationDate,
  lastPaymentDate: SimulationDate.nullable().default(null),
  nextPaymentDate: SimulationDate.nullable().default(null),
  lastPaymentAmount: z.number().int().min(0).max(1_000_000_000).default(0),
  totalPaid: z.number().int().min(0).max(1_000_000_000).default(0),
  paymentsMade: z.number().int().min(0).max(100_000).default(0),
  reportedPaymentMilestones: z
    .array(z.number().int().positive())
    .max(100)
    .default([]),
  originatingActionId: ActionId.nullable().default(null),
});
export const OrganizationDimension = z.enum([
  'economic-integration',
  'regional-infrastructure',
  'customs-cooperation',
  'common-standards',
  'political-coordination',
  'joint-diplomacy',
  'development-funding',
  'sanctions-coordination',
]);
export const OrganizationDevelopment = z.strictObject({
  dimension: OrganizationDimension,
  level: z.number().int().min(0).max(5).default(0),
  progress: z.number().int().min(0).max(99).default(0),
  updatedDate: SimulationDate,
});
export const OrganizationProgramResponse = z.strictObject({
  nationId: NationId,
  move: z.enum(['pending', 'accept', 'reject', 'counter', 'delay']),
  decidedDate: SimulationDate.nullable().default(null),
  message: Text.nullable().default(null),
  counterTerms: Text.nullable().default(null),
});
export const OrganizationProgram = z.strictObject({
  id: OrganizationProgramId,
  dimension: OrganizationDimension,
  title: Name,
  terms: Text,
  issuerNationId: NationId,
  participantNationIds: z.array(NationId).max(500).default([]),
  responses: z.array(OrganizationProgramResponse).max(500).default([]),
  status: z
    .enum([
      'proposed',
      'active',
      'rejected',
      'suspended',
      'completed',
      'cancelled',
    ])
    .default('proposed'),
  stage: z
    .enum(['consultation', 'planning', 'construction', 'operational'])
    .default('consultation'),
  progress: z.number().int().min(0).max(100).default(0),
  monthlyCost: z.number().int().min(0).max(1_000_000).default(0),
  totalInvested: z.number().int().min(0).max(1_000_000_000).default(0),
  paymentCount: z.number().int().min(0).max(100_000).default(0),
  lastPaymentDate: SimulationDate.nullable().default(null),
  createdDate: SimulationDate,
  updatedDate: SimulationDate,
  completedDate: SimulationDate.nullable().default(null),
  reportedMilestones: z.array(z.number().int().positive()).max(10).default([]),
  originatingActionId: ActionId.nullable().default(null),
});
export const OrganizationHistoryEntry = z.strictObject({
  id: z.string().trim().min(1).max(160),
  date: SimulationDate,
  actorNationId: NationId.nullable(),
  kind: z.enum([
    'founded',
    'invited',
    'invitation-response',
    'application',
    'member-joined',
    'member-left',
    'member-removed',
    'commitment-added',
    'commitment-payment-started',
    'commitment-paid',
    'commitment-payment-milestone',
    'commitment-breached',
    'integration-progress',
    'program-proposed',
    'program-response',
    'development-milestone',
    'program-approved',
    'program-rejected',
    'program-milestone',
    'program-suspended',
    'program-resumed',
    'amended',
    'dissolved',
  ]),
  description: Text,
  originatingActionId: ActionId.nullable().optional(),
  organizationCommitmentId: OrganizationCommitmentId.optional(),
  organizationProgramId: OrganizationProgramId.optional(),
  paymentMilestone: z.number().int().positive().optional(),
  programMilestone: z.number().int().positive().max(100).optional(),
  developmentDimension: OrganizationDimension.optional(),
  developmentLevel: z.number().int().positive().max(5).optional(),
});
export const Organization = z.strictObject({
  id: OrganizationId,
  name: Name,
  acronym: Name.nullable().default(null),
  kind: OrganizationKind,
  foundingDate: SimulationDate.nullable().default(null),
  founders: z.array(NationId).max(500).default([]),
  members: z.array(NationId).max(500),
  invitedStates: z.array(NationId).max(500).default([]),
  invitations: z.array(OrganizationInvitation).max(500).default([]),
  pendingApplications: z.array(OrganizationApplication).max(500).default([]),
  purpose: Text.default('No stated purpose.'),
  charter: Text,
  commitments: z.array(OrganizationCommitment).max(100).default([]),
  development: z.array(OrganizationDevelopment).max(8).default([]),
  programs: z.array(OrganizationProgram).max(500).default([]),
  geographicScope: z.string().trim().max(160).nullable().default(null),
  history: z.array(OrganizationHistoryEntry).max(200).default([]),
  status: z.enum(['active', 'dissolved']).default('active'),
  dissolvedDate: SimulationDate.nullable().default(null),
  visibility: z.enum(['public', 'private']).default('public'),
});
export type Initiative = z.infer<typeof Initiative>;
export type Negotiation = z.infer<typeof Negotiation>;
export type Organization = z.infer<typeof Organization>;
export type OrganizationProgram = z.infer<typeof OrganizationProgram>;
export type OrganizationDimension = z.infer<typeof OrganizationDimension>;
