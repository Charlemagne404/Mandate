import {
  Crisis,
  EconomicLink,
  Sanction,
  Conference,
  GovernmentTenure,
  KnowledgeRecord,
} from './continuity.js';
import { z } from 'zod';
import { ActionId, TurnId } from './ids.js';
import { CommandEnvelope } from './commands.js';
import {
  Action,
  Conflict,
  Commitment,
  Event,
  Goal,
  Nation,
  Initiative,
  Negotiation,
  Organization,
  Relation,
  Region,
  SaveId,
  ScenarioMetadata,
  SimulationDate,
  Treaty,
  Turn,
} from './world.js';
export * from './ids.js';
export * from './world.js';
export * from './commands.js';
export * from './branding.js';
export * from './continuity.js';

export const CommandRecord = CommandEnvelope.extend({
  turnId: TurnId,
  actionId: ActionId,
  simulationDate: SimulationDate,
  recordedAt: z.iso.datetime(),
  validation: z.literal('accepted'),
});
export const WorldState = z.strictObject({
  schemaVersion: z.literal(3),
  saveId: SaveId,
  ancestry: z
    .strictObject({
      parentSaveId: SaveId,
      parentRevision: z.number().int().min(0),
    })
    .nullable(),
  scenario: ScenarioMetadata,
  date: SimulationDate,
  revision: z.number().int().min(0),
  playerNationId: Nation.shape.id,
  observerMode: z.boolean().default(false),
  knowledge: z.array(KnowledgeRecord).max(20000).default([]),
  nations: z.array(Nation).min(1).max(500),
  regions: z.array(Region).min(1).max(20000),
  relations: z.array(Relation).max(125000),
  treaties: z.array(Treaty).max(10000),
  conflicts: z.array(Conflict).max(10000),
  goals: z.array(Goal).max(20000),
  crises: z.array(Crisis).max(10000).default([]),
  economicLinks: z.array(EconomicLink).max(125000).default([]),
  sanctions: z.array(Sanction).max(20000).default([]),
  conferences: z.array(Conference).max(10000).default([]),
  tenures: z.array(GovernmentTenure).max(500).default([]),
  commitments: z.array(Commitment).max(20000).default([]),
  initiatives: z.array(Initiative).max(20000).default([]),
  negotiations: z.array(Negotiation).max(20000).default([]),
  organizations: z.array(Organization).max(1000).default([]),
  events: z.array(Event).max(100000),
  turns: z.array(Turn).max(100000),
  actions: z.array(Action).max(100000),
  commands: z.array(CommandRecord).max(100000),
});
export const SaveFile = z.strictObject({
  formatVersion: z.literal(3),
  kind: z.literal('save'),
  world: WorldState,
});
export const ScenarioFile = z.strictObject({
  formatVersion: z.literal(3),
  kind: z.literal('scenario'),
  world: WorldState,
});
export type WorldState = z.infer<typeof WorldState>;
export type CommandRecord = z.infer<typeof CommandRecord>;
export type SaveFile = z.infer<typeof SaveFile>;

export * from './semantic.js';
