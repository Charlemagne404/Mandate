import {
  Crisis,
  CrisisId,
  EconomicLink,
  Sanction,
  Conference,
  GovernmentTenure,
  KnowledgeRecord,
} from './continuity.js';
import { z } from 'zod';
import {
  CommandId,
  ConflictId,
  GoalId,
  InitiativeId,
  NegotiationId,
  OrganizationId,
  NationId,
  RegionId,
  TreatyId,
} from './ids.js';
import {
  Conflict,
  CommitmentTerms,
  Strategy,
  PeaceTerm,
  Initiative,
  Negotiation,
  Organization,
  EventFields,
  Goal,
  Government,
  SimulationDate,
  StatName,
  Text,
  Treaty,
} from './world.js';

const command = <T extends string, S extends z.ZodRawShape>(
  type: T,
  fields: S,
) => z.strictObject({ type: z.literal(type), ...fields });
export const WorldCommand = z.discriminatedUnion('type', [
  command('DISCLOSE_INFORMATION', {
    issuer: NationId,
    recipients: z.array(NationId).min(1).max(20),
    subject: KnowledgeRecord.shape.subject,
    confidence: KnowledgeRecord.shape.confidence,
    source: KnowledgeRecord.shape.source,
  }),
  command('THEATER_ACTION', {
    conflictId: ConflictId,
    theaterId: Conflict.shape.theaters.unwrap().element.shape.id,
    nationId: NationId,
    regionIds: z.array(RegionId).min(1).max(10),
    posture: Conflict.shape.theaters.unwrap().element.shape.posture,
    allocation: z.number().int().min(1).max(100),
  }),
  command('OPEN_CRISIS', { crisis: Crisis }),
  command('CRISIS_ACTION', {
    crisisId: CrisisId,
    nationId: NationId,
    move: z.enum([
      'warn',
      'mobilize',
      'talk',
      'stand-down',
      'concede',
      'freeze',
    ]),
    demandIndex: z.number().int().min(0).max(19).optional(),
    negotiationId: NegotiationId.optional(),
  }),
  command('SET_ECONOMIC_LINK', { link: EconomicLink }),
  command('IMPOSE_SANCTION', { sanction: Sanction }),
  command('LIFT_SANCTION', {
    sanctionId: Sanction.shape.id,
    nationId: NationId,
  }),
  command('OPEN_CONFERENCE', { conference: Conference }),
  command('RESPOND_CONFERENCE', {
    conferenceId: Conference.shape.id,
    nationId: NationId,
    move: z.enum([
      'accept',
      'reject',
      'counter',
      'abstain',
      'delay',
      'withdraw',
    ]),
    message: Text,
    counterTerms: Text.optional(),
    counterPeaceTerms: z.array(PeaceTerm).max(20).optional(),
  }),
  command('SCHEDULE_ELECTION', { tenure: GovernmentTenure }),
  command('REVISE_GOAL_EVALUATION', {
    goalId: GoalId,
    evaluation: Goal.shape.evaluation,
  }),
  command('SET_STRATEGY', { nationId: NationId, strategy: Strategy }),
  command('START_INITIATIVE', { initiative: Initiative }),
  command('CANCEL_INITIATIVE', { initiativeId: InitiativeId }),
  command('OPEN_NEGOTIATION', { negotiation: Negotiation }),
  command('RESPOND_NEGOTIATION', {
    negotiationId: NegotiationId,
    nationId: NationId,
    move: z.enum([
      'accept',
      'reject',
      'counter',
      'delay',
      'withdraw',
      'ignore',
    ]),
    message: Text,
    counterTerms: Text.optional(),
    counterPeaceTerms: z.array(PeaceTerm).max(8).optional(),
    counterObligations: z.array(CommitmentTerms).max(8).optional(),
    treatyId: TreatyId.optional(),
  }),
  command('CREATE_ORGANIZATION', { organization: Organization }),
  command('SET_ORGANIZATION_MEMBERSHIP', {
    organizationId: OrganizationId,
    nationId: NationId,
    member: z.boolean(),
  }),
  command('CONFLICT_ACTION', {
    conflictId: ConflictId,
    nationId: NationId,
    stance: z.enum([
      'mobilize',
      'reinforce',
      'offensive',
      'defend',
      'deescalate',
    ]),
    regionId: RegionId.optional(),
  }),
  command('STRATEGIC_ATTACK', {
    attackerNationId: NationId,
    targetNationId: NationId,
    conflictId: ConflictId,
    crisisId: CrisisId.optional(),
    scale: z.enum(['major', 'catastrophic']),
    abstraction: z.literal('abstracted-effects-no-nuclear-weapons-model'),
  }),
  command('MOBILIZE_FORCE', {
    nationId: NationId,
    level: z.enum(['partial', 'full']),
  }),
  command('APPLY_DOMESTIC_PRESSURE', {
    nationId: NationId,
    amount: z.number().int().min(1).max(20),
    cause: Text,
  }),
  command('ADJUST_RELATION', {
    nationA: NationId,
    nationB: NationId,
    delta: z.number().int().min(-200).max(200),
    trustDelta: z.number().int().min(-100).max(100).optional(),
  }),
  command('ADJUST_NATION_STAT', {
    nationId: NationId,
    stat: StatName,
    delta: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  }),
  command('TRANSFER_CONTROL', { regionId: RegionId, nationId: NationId }),
  command('TRANSFER_OWNERSHIP', { regionId: RegionId, nationId: NationId }),
  command('ADD_CLAIM', { regionId: RegionId, nationId: NationId }),
  command('REMOVE_CLAIM', { regionId: RegionId, nationId: NationId }),
  command('CREATE_TREATY', { treaty: Treaty }),
  command('UPDATE_TREATY', { treatyId: TreatyId, terms: Text }),
  command('END_TREATY', { treatyId: TreatyId }),
  command('START_CONFLICT', { conflict: Conflict }),
  command('UPDATE_CONFLICT', {
    conflictId: ConflictId,
    escalation: z.number().int().min(0).max(100),
  }),
  command('END_CONFLICT', { conflictId: ConflictId }),
  command('CREATE_EVENT', { event: EventFields }),
  command('UPDATE_GOVERNMENT', { nationId: NationId, government: Government }),
  command('UPDATE_LEADER', {
    nationId: NationId,
    leader: z.string().trim().min(1).max(160),
  }),
  command('CREATE_STRATEGIC_GOAL', { goal: Goal }),
  command('UPDATE_STRATEGIC_GOAL', {
    goalId: GoalId,
    status: Goal.shape.status,
    priority: Goal.shape.priority,
    progress: Goal.shape.progress,
  }),
  command('SET_OBSERVER_MODE', { enabled: z.boolean() }),
  command('SWITCH_NATION', { nationId: NationId }),
  command('ADVANCE_DATE', { date: SimulationDate }),
]);
export const CommandEnvelope = z.strictObject({
  id: CommandId,
  reason: Text,
  command: WorldCommand,
});
export const TurnRequest = z.strictObject({
  expectedRevision: z.number().int().min(0),
  action: z.strictObject({
    actorNationId: NationId,
    source: z.enum(['debug', 'player', 'system']),
    text: Text,
  }),
  commands: z.array(CommandEnvelope).min(1).max(100),
});
export type WorldCommand = z.infer<typeof WorldCommand>;
export type CommandEnvelope = z.infer<typeof CommandEnvelope>;
export type TurnRequest = z.infer<typeof TurnRequest>;
export const StateHash = z.string().regex(/^[0-9a-f]{64}$/);
// The hash prevents stale writes after imports replace a world at the same revision.
export const CommitRequest = TurnRequest.extend({ expectedHash: StateHash });
