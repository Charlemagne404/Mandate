import { z } from 'zod';
import { NationId, RegionId } from './ids.js';

export const ActionGrounding = z.strictObject({
  selectedNationId: NationId.optional(),
  selectedRegionId: RegionId.optional(),
});
export const SemanticAction = z.strictObject({
  id: z.string().min(1).max(160),
  clauseId: z.number().int().min(0).max(39),
  text: z.string().min(1).max(4000),
  actor: NationId,
  action: z.enum([
    'acquire-forces',
    'request-participation',
    'invade',
    'annex',
    'strike',
    'mobilize',
    'demand',
    'offer',
    'sanction',
    'cancel',
    'transfer',
    'influence',
    'disrupt',
    'communicate',
    'peace',
    'guarantee',
    'form-polity',
    'other',
  ]),
  targets: z.array(NationId).max(20),
  sources: z.array(NationId).max(20),
  beneficiaries: z.array(NationId).max(20),
  participants: z.array(NationId).max(20),
  territories: z.array(RegionId).max(20),
  assets: z.array(z.string().max(160)).max(10),
  organizations: z.array(z.string().max(160)).max(10),
  instruments: z.array(z.string().max(160)).max(10),
  conditions: z
    .array(
      z.strictObject({
        text: z.string().max(1000),
        predicate: z.enum([
          'accepted',
          'refused',
          'attack',
          'joined',
          'withdrawn',
          'unknown',
        ]),
        subjects: z.array(NationId).max(20),
        negated: z.boolean(),
        actionId: z.string().max(160).nullable(),
        observationId: z.string().max(160).optional(),
      }),
    )
    .max(8),
  dependencies: z
    .array(
      z.strictObject({
        actionId: z.string().max(160),
        requirement: z.enum(['ordered', 'succeeded', 'result']),
        mandatory: z.boolean(),
      }),
    )
    .max(20),
  sequence: z.enum([
    'independent',
    'then',
    'before',
    'simultaneous',
    'conditional',
    'until',
  ]),
  intensity: z.enum(['low', 'medium', 'high', 'extreme']),
  secrecy: z.enum(['public', 'private']),
  desiredOutcome: z.string().max(2000).nullable(),
  issues: z.array(z.string().max(1000)).max(20),
});
export type SemanticAction = z.infer<typeof SemanticAction>;
export const SemanticGraph = z.strictObject({
  version: z.literal(1),
  rawInput: z.string().max(4000),
  grounding: ActionGrounding,
  actions: z.array(SemanticAction).max(40),
  targetSets: z
    .array(
      z.strictObject({
        id: z.string(),
        actionId: z.string(),
        nationIds: z.array(NationId).max(20),
        regionIds: z.array(RegionId).max(20),
      }),
    )
    .max(40),
  repairs: z.array(z.string().max(1000)).max(100).default([]),
  references: z
    .array(
      z.strictObject({
        actionId: z.string(),
        expression: z.string(),
        role: z.enum([
          'actor',
          'target',
          'source',
          'instrument',
          'condition',
          'territory',
        ]),
        origin: z.enum(['text', 'map', 'conversation']),
        antecedentId: z.string(),
        nationIds: z.array(NationId).max(20),
        regionIds: z.array(RegionId).max(20),
      }),
    )
    .max(100),
});
export type SemanticGraph = z.infer<typeof SemanticGraph>;
export const SemanticAudit = z.strictObject({
  actionId: z.string(),
  text: z.string(),
  status: z.enum([
    'EXECUTED',
    'ATTEMPTED',
    'ABSTRACTED',
    'DEFERRED',
    'FAILED',
    'BLOCKED',
    'IMPOSSIBLE',
  ]),
  explanation: z.string(),
  commandTypes: z.array(z.string()),
});
export type SemanticAudit = z.infer<typeof SemanticAudit>;
