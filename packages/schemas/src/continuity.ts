import { z } from 'zod';
import { NationId, RegionId, ConflictId, NegotiationId } from './ids.js';
import {
  SimulationDate,
  Text,
  Strategy,
  Government,
  PeaceTerm,
} from './world.js';

const level = z.number().int().min(0).max(100);
const title = z.string().trim().min(1).max(160);
export const CrisisId = z
  .string()
  .regex(/^crisis:[a-z0-9._-]+$/)
  .brand<'CrisisId'>();
export const CrisisStatus = z.enum([
  'emerging',
  'active',
  'escalating',
  'de-escalating',
  'frozen',
  'resolved',
]);
export const Crisis = z.strictObject({
  id: CrisisId,
  title,
  type: z.enum(['border', 'security', 'economic', 'domestic', 'commitment']),
  status: CrisisStatus.default('emerging'),
  participants: z.array(NationId).min(2).max(20),
  interestedActors: z.array(NationId).max(30).default([]),
  regions: z.array(RegionId).max(30).default([]),
  startDate: SimulationDate,
  visibility: z.enum(['public', 'private']).default('public'),
  trigger: Text,
  issues: z.array(Text).min(1).max(12),
  demands: z
    .array(
      z.strictObject({
        nationId: NationId,
        text: Text,
        satisfied: z.boolean().default(false),
        condition: z
          .discriminatedUnion('kind', [
            z.strictObject({ kind: z.literal('acknowledgment') }),
            z.strictObject({
              kind: z.literal('conflict-ended'),
              conflictId: ConflictId,
            }),
            z.strictObject({
              kind: z.literal('ceasefire'),
              conflictId: ConflictId,
            }),
            z.strictObject({
              kind: z.literal('control'),
              regionId: RegionId,
              nationId: NationId,
            }),
            z.strictObject({
              kind: z.literal('agreement'),
              negotiationId: NegotiationId,
            }),
          ])
          .default({ kind: 'acknowledgment' }),
      }),
    )
    .max(20)
    .default([]),
  redLines: z
    .array(z.strictObject({ nationId: NationId, text: Text }))
    .max(20)
    .default([]),
  militaryPosture: level.default(0),
  rhetoric: level.default(0),
  diplomaticBreakdown: level.default(0),
  severity: level.default(0),
  deadline: SimulationDate.nullable().default(null),
  conflictId: ConflictId.nullable().default(null),
  negotiationIds: z.array(NegotiationId).max(20).default([]),
  history: z
    .array(
      z.strictObject({
        date: SimulationDate,
        nationId: NationId.nullable(),
        action: Text,
        severity: level,
      }),
    )
    .max(100)
    .default([]),
});
export type Crisis = z.infer<typeof Crisis>;

export const EconomicLink = z.strictObject({
  id: z.string().regex(/^economic:[a-z0-9._-]+$/),
  dependentNationId: NationId,
  partnerNationId: NationId,
  imports: level,
  exports: level,
  energy: level,
  strategicGoods: level,
  finance: level,
  infrastructure: level.default(0),
  alternatives: level.default(20),
  adaptation: level.default(0),
});
export type EconomicLink = z.infer<typeof EconomicLink>;
export const Sanction = z.strictObject({
  id: z.string().regex(/^sanction:[a-z0-9._-]+$/),
  issuer: NationId,
  target: NationId,
  sector: z.enum(['trade', 'finance', 'energy', 'strategic', 'military']),
  intensity: z.number().int().min(1).max(100),
  startDate: SimulationDate,
  endDate: SimulationDate.nullable().default(null),
  status: z.enum(['active', 'lifted']).default('active'),
  reason: Text,
});
export type Sanction = z.infer<typeof Sanction>;

export const Conference = z.strictObject({
  id: z.string().regex(/^conference:[a-z0-9._-]+$/),
  title,
  proposer: NationId,
  parties: z.array(NationId).min(3).max(20),
  kind: z.enum(['security', 'trade', 'mediation', 'peace', 'sanctions']),
  visibility: z.enum(['public', 'private']).default('public'),
  terms: Text,
  conflictId: ConflictId.nullable().default(null),
  peaceTerms: z.array(PeaceTerm).max(20).default([]),
  sanctionTarget: NationId.nullable().default(null),
  sanctionSector: Sanction.shape.sector.default('trade'),
  sanctionIntensity: Sanction.shape.intensity.default(50),
  createdDate: SimulationDate,
  expiresDate: SimulationDate,
  round: z.number().int().min(0).max(20).default(0),
  status: z
    .enum(['open', 'agreed', 'rejected', 'withdrawn', 'expired'])
    .default('open'),
  responses: z
    .array(
      z.strictObject({
        nationId: NationId,
        round: z.number().int().min(0).max(20),
        date: SimulationDate,
        move: z.enum([
          'accept',
          'reject',
          'counter',
          'abstain',
          'delay',
          'withdraw',
        ]),
        message: Text,
        terms: Text.optional(),
      }),
    )
    .max(200)
    .default([]),
});
export type Conference = z.infer<typeof Conference>;

export const GovernmentTenure = z.strictObject({
  id: z.string().regex(/^tenure:[a-z0-9._-]+$/),
  nationId: NationId,
  startDate: SimulationDate,
  nextElectionDate: SimulationDate,
  termDays: z.number().int().min(180).max(3650),
  incumbent: title,
  challenger: z.strictObject({
    name: title,
    government: Government,
    strategy: Strategy,
  }),
  issues: z.array(Text).min(1).max(8),
  outcomes: z
    .array(
      z.strictObject({
        date: SimulationDate,
        winner: title,
        incumbentRetained: z.boolean(),
        support: level,
      }),
    )
    .max(100)
    .default([]),
});
export type GovernmentTenure = z.infer<typeof GovernmentTenure>;

export const KnowledgeRecord = z.strictObject({
  id: z.string().regex(/^knowledge:[a-z0-9._-]+$/),
  issuer: NationId,
  recipient: NationId,
  subject: z.strictObject({
    kind: z.enum([
      'event',
      'negotiation',
      'treaty',
      'conference',
      'crisis',
      'organization',
    ]),
    id: z
      .string()
      .regex(
        /^(event|negotiation|treaty|conference|crisis|organization):[a-z0-9._-]+$/,
      ),
  }),
  date: SimulationDate,
  source: z.enum(['disclosure', 'ally-sharing']),
  confidence: z.enum(['confirmed', 'likely', 'suspected']),
});
