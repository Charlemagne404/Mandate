import { SemanticGraph } from '@mandate/schemas';
import { z } from 'zod';
import {
  NationId,
  RegionId,
  EventId,
  NegotiationId,
  SimulationDate,
  WorldCommand,
  CommitmentTerms,
  InfluenceTerm,
  InfluenceDecision,
  PeaceTerm,
} from '@mandate/schemas';

export const Role = z.enum([
  'formalizer',
  'planner',
  'diplomat',
  'resolver',
  'critic',
  'narrator',
  'historian',
  'advisor',
]);
export type Role = z.infer<typeof Role>;
const reason = z.string().trim().min(1).max(2000);
export const MajorIntentClause = z.strictObject({
  id: z.string().trim().min(1).max(160),
  kind: z.enum([
    'strategic-strike',
    'armed-conflict-initiation',
    'invasion-offensive',
    'conquest-objective',
    'military-mobilization',
    'declaration-of-war',
  ]),
  description: reason,
  sourceClauseIds: z.array(z.number().int().min(0).max(39)).min(1).max(20),
  targetNationIds: z.array(NationId).max(20),
  targetRegionIds: z.array(RegionId).max(20),
});
export type MajorIntentClause = z.infer<typeof MajorIntentClause>;
export const MajorIntentSatisfaction = z.strictObject({
  clauseId: z.string().trim().min(1).max(160),
  kind: MajorIntentClause.shape.kind,
  status: z.enum([
    'EXECUTED',
    'ATTEMPTED',
    'REPRESENTED_BY_VALID_ABSTRACTION',
    'BLOCKED_BY_REAL_WORLD_CONSTRAINT',
    'UNSUPPORTED',
  ]),
  evidence: z.array(reason).max(12),
  explanation: reason,
});
export type MajorIntentSatisfaction = z.infer<typeof MajorIntentSatisfaction>;
export const SemanticProposal = z.strictObject({
  clauseId: z.number().int().min(0).max(39),
  action: SemanticGraph.shape.actions.element.shape.action,
  targets: z.array(NationId).max(20),
  sources: z.array(NationId).max(20),
  participants: z.array(NationId).max(20),
});
export const PlayerIntent = z.strictObject({
  actionGraph: SemanticGraph.optional(),
  semanticProposals: z.array(SemanticProposal).max(40).optional(),
  version: z.literal(1),
  actorNationId: NationId,
  summary: reason,
  targetNationIds: z.array(NationId).max(20),
  targetRegionIds: z.array(RegionId).max(20),
  visibility: z.enum(['public', 'private']),
  // A player policy order records what the controlled government must attempt.
  // Desired outcomes are separate because other governments and world mechanics
  // determine whether those outcomes happen.
  policyOrders: z
    .array(
      z.strictObject({
        authority: z.literal('player-policy-order'),
        kind: z.enum([
          'diplomacy',
          'economy',
          'military',
          'domestic',
          'territory',
          'wait',
          'other',
        ]),
        text: reason,
        sourceClauseIds: z
          .array(z.number().int().min(0).max(39))
          .min(1)
          .max(20),
        targetNationIds: z.array(NationId).max(20),
        targetRegionIds: z.array(RegionId).max(20),
        intensity: z.enum(['low', 'medium', 'high', 'extreme']),
        persistent: z.boolean(),
        visibility: z.enum(['public', 'private']),
      }),
    )
    .max(40)
    .default([]),
  desiredOutcomes: z
    .array(
      z.strictObject({
        kind: z.enum([
          'territory',
          'war',
          'alliance',
          'treaty',
          'recognition',
          'peace',
          'other',
        ]),
        description: reason,
        sourceClauseIds: z
          .array(z.number().int().min(0).max(39))
          .min(1)
          .max(20),
        targetNationIds: z.array(NationId).max(20),
        targetRegionIds: z.array(RegionId).max(20),
      }),
    )
    .max(40)
    .default([]),
  constraints: z
    .array(
      z.strictObject({
        kind: z.enum([
          'avoid-war',
          'avoid-mobilization',
          'avoid-public-announcement',
          'avoid-treaty-break',
          'other',
        ]),
        description: reason,
        sourceClauseIds: z
          .array(z.number().int().min(0).max(39))
          .min(1)
          .max(20),
      }),
    )
    .max(20)
    .default([]),
  // Derived deterministically from the player's exact clauses after formalizer
  // classification. Providers cannot remove high-impact intent from this list.
  majorIntentClauses: z.array(MajorIntentClause).max(40).default([]),
  intentions: z
    .array(
      z.strictObject({
        kind: z.enum([
          'diplomacy',
          'economy',
          'military',
          'domestic',
          'territory',
          'wait',
          'other',
        ]),
        description: reason,
        sourceClauseIds: z
          .array(z.number().int().min(0).max(39))
          .min(1)
          .max(20),
        visibility: z.enum(['public', 'private']),
        targetNationIds: z.array(NationId).max(20),
      }),
    )
    .min(1)
    .max(40),
});
export type PlayerIntent = z.infer<typeof PlayerIntent>;
export const PlayerIntentJsonSchema = z.toJSONSchema(PlayerIntent);
// The acting player is supplied by the orchestrator, not chosen by the model.
// Keep the field optional here for compatibility with providers that still
// echo the old contract; prepare() always replaces it with the canonical actor.
export const FormalizerIntent = PlayerIntent.extend({
  actorNationId: NationId.optional(),
});
export type FormalizerIntent = z.infer<typeof FormalizerIntent>;
export const FormalizerIntentJsonSchema = z.toJSONSchema(FormalizerIntent);
export const RelevanceSelection = z.strictObject({
  version: z.literal(1),
  directNationIds: z.array(NationId).max(30),
  secondaryNationIds: z.array(NationId).max(30),
  reasons: z.array(reason).max(60),
});
export type RelevanceSelection = z.infer<typeof RelevanceSelection>;
export const NationPlan = z.strictObject({
  version: z.literal(1),
  nationId: NationId,
  stance: z.enum(['cooperate', 'oppose', 'counter', 'observe', 'independent']),
  priorities: z.array(reason).max(8),
  intentions: z.array(reason).max(8),
  publicStatement: z.string().max(2000),
  explanation: reason,
  conferenceDecisions: z
    .array(
      z.strictObject({
        conferenceId: z.string().regex(/^conference:[a-z0-9._-]+$/),
        move: z.enum([
          'accept',
          'reject',
          'counter',
          'abstain',
          'delay',
          'withdraw',
        ]),
        message: reason,
        counterTerms: z.string().min(1).max(4000).optional(),
        counterPeaceTerms: z.array(PeaceTerm).max(20).optional(),
      }),
    )
    .max(4)
    .default([]),
  uncertainty: z
    .enum(['confident', 'uncertain', 'divided', 'lacking-information'])
    .default('uncertain'),
  decisionFactors: z
    .array(
      z.strictObject({
        factor: z.enum([
          'benefit',
          'cost',
          'military-risk',
          'economy',
          'domestic',
          'trust',
          'recent-behavior',
          'commitment',
          'red-line',
          'ideology',
          'alternative',
          'urgency',
          'uncertainty',
        ]),
        assessment: reason,
        references: z.array(z.string().max(160)).max(8),
      }),
    )
    .max(40)
    .default([]),
});
export type NationPlan = z.infer<typeof NationPlan>;
// Stored/legacy plans may omit additive fields; every new inference must emit them.
export const NationPlanGeneration = NationPlan.extend({
  decisionFactors: NationPlan.shape.decisionFactors.removeDefault().min(1),
  uncertainty: NationPlan.shape.uncertainty.removeDefault(),
  conferenceDecisions: NationPlan.shape.conferenceDecisions.removeDefault(),
});

export const DiplomaticMove = z.strictObject({
  version: z.literal(1),
  nationId: NationId,
  recipientNationId: NationId,
  negotiationId: NegotiationId.nullable(),
  move: z.enum([
    'propose',
    'accept',
    'reject',
    'counter',
    'delay',
    'withdraw',
    'ignore',
  ]),
  message: reason,
  terms: z.string().max(4000),
  obligations: z.array(CommitmentTerms).max(8).default([]),
  influenceTerms: z.array(InfluenceTerm).max(32).default([]),
  influenceDecision: InfluenceDecision.optional(),
  peaceTerms: z.array(PeaceTerm).max(8).default([]),
  visibility: z.enum(['public', 'private']),
});
export type DiplomaticMove = z.infer<typeof DiplomaticMove>;
export const ResolutionProposal = z.strictObject({
  version: z.literal(1),
  explanation: reason,
  commands: z.array(z.strictObject({ command: WorldCommand, reason })).max(40),
});
export type ResolutionProposal = z.infer<typeof ResolutionProposal>;
export const CriticResult = z.strictObject({
  version: z.literal(1),
  accepted: z.boolean(),
  issues: z.array(reason).max(12),
});
export const NarrationInput = z.strictObject({
  version: z.literal(1),
  date: SimulationDate,
  eventIds: z.array(EventId).max(100),
  facts: z.array(z.strictObject({ id: EventId, title: reason })).max(100),
});
// The model may select committed facts. It cannot add free-form factual claims.
export const NarrationResult = z.strictObject({
  version: z.literal(1),
  headlineEventIds: z.array(EventId).max(12),
});
export const HistoricalSummary = z.strictObject({
  version: z.literal(1),
  perspectiveNationId: NationId,
  sourceEventIds: z.array(EventId).max(100),
  text: z.string().max(12000),
});
export const ProviderConfig = z.strictObject({
  kind: z.enum(['fake', 'ollama', 'openai-compatible']).default('fake'),
  baseUrl: z.url().optional(),
  model: z.string().trim().min(1).max(160).default('local-model'),
  highImportanceModel: z.string().min(1).max(160).optional(),
  roleModels: z.partialRecord(Role, z.string().min(1).max(160)).optional(),
  timeoutMs: z.number().int().min(1000).max(180000).default(60000),
  retries: z.number().int().min(0).max(2).default(1),
  temperature: z.number().min(0).max(2).default(0.2),
  contextBudget: z.number().int().min(2000).max(200000).default(48000),
  contextTokens: z.number().int().min(1024).max(131072).optional(),
  workflow: z.enum(['auto', 'compact', 'standard']).default('auto'),
  concurrency: z.number().int().min(1).max(8).optional(),
  maxCalls: z.number().int().min(3).max(80).optional(),
  maxBackgroundPlanners: z.number().int().min(0).max(8).default(1),
  maxTurnMs: z.number().int().min(10000).max(600000).default(180000),
  maxRepairs: z.number().int().min(0).max(1).default(1),
  apiKey: z.string().max(1000).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;
export interface GenerationRequest {
  role: Role;
  model: string;
  system: string;
  prompt: string;
  jsonSchema: object;
  temperature?: number;
  maxTokens?: number;
  contextTokens?: number;
  signal?: AbortSignal;
}
export interface GenerationResult {
  value: unknown;
  rawText: string;
  latencyMs: number;
  retries?: number;
  usage?: { promptTokens?: number; completionTokens?: number };
}
export interface LlmProvider {
  readonly id: string;
  generateStructured(request: GenerationRequest): Promise<GenerationResult>;
  health(
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; message: string; models: string[] }>;
}
export interface ModelCallRecord {
  id: string;
  provider: string;
  model: string;
  role: Role;
  promptVersion: string;
  contextReferences: string[];
  rawOutput: string;
  parsedOutput: unknown;
  latencyMs: number;
  retries: number;
  validationFailures: string[];
  repairAttempt: number;
  contextCharacters: number;
  usage?: { promptTokens?: number; completionTokens?: number };
  status: 'accepted' | 'failed';
}
