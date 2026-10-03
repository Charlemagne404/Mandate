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
    directives: z
      .array(
        z.strictObject({
          id: Name,
          text: Text,
          priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
          visibility: z.enum(['public', 'private']),
          status: z.enum(['active', 'cancelled']),
          createdDate: SimulationDate,
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
export const Treaty = z.strictObject({
  id: TreatyId,
  name: Name,
  kind: z.enum(['defense', 'trade', 'nonaggression', 'ceasefire', 'peace']),
  conflictId: ConflictId.nullable().default(null),
  parties: z.array(NationId).min(2).max(500),
  status: z.enum(['active', 'ended']),
  terms: Text,
  visibility: z.enum(['public', 'private']).default('public'),
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
        progress: z.number().int().min(0).max(100).default(0),
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
  eventIds: z.array(EventId).min(1).max(100),
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
  kind: z.enum(['withdrawal', 'territorial-transfer']),
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
  peaceTerms: z.array(PeaceTerm).max(8).optional(),
  obligations: z.array(CommitmentTerms).max(8).optional(),
});
export const Negotiation = z.strictObject({
  id: NegotiationId,
  proposerNationId: NationId,
  recipientNationId: NationId,
  topic: Name,
  kind: z.enum([
    'consultation',
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
  initialTerms: Text.optional(),
  peaceTerms: z.array(PeaceTerm).max(8).default([]),
  createdDate: SimulationDate,
  expiresDate: SimulationDate,
  responses: z.array(NegotiationResponse).max(100).default([]),
  treatyId: TreatyId.nullable().default(null),
});
export const Organization = z.strictObject({
  id: OrganizationId,
  name: Name,
  kind: z.enum(['alliance', 'economic', 'institution', 'regional']),
  members: z.array(NationId).min(1).max(500),
  charter: Text,
  visibility: z.enum(['public', 'private']).optional(),
});
export type Initiative = z.infer<typeof Initiative>;
export type Negotiation = z.infer<typeof Negotiation>;
export type Organization = z.infer<typeof Organization>;
