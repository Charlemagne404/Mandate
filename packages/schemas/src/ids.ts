import { z } from 'zod';

const id = <T extends string>(prefix: string, brand: T) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}:[a-z0-9][a-z0-9._-]{0,79}$`))
    .brand<T>(brand);
export const NationId = id('nation', 'NationId');
export const RegionId = id('region', 'RegionId');
export const TreatyId = id('treaty', 'TreatyId');
export const ConflictId = id('conflict', 'ConflictId');
export const EventId = id('event', 'EventId');
export const TurnId = id('turn', 'TurnId');
export const ActionId = id('action', 'ActionId');
export const CommandId = id('command', 'CommandId');
export const ModelCallId = id('modelcall', 'ModelCallId');
export const ScenarioId = id('scenario', 'ScenarioId');
export const SaveId = id('save', 'SaveId');
export const OrganizationId = id('organization', 'OrganizationId');
export const OrganizationCommitmentId = id(
  'orgcommitment',
  'OrganizationCommitmentId',
);
export const OrganizationProgramId = id('orgprogram', 'OrganizationProgramId');
export const GoalId = id('goal', 'GoalId');
export type NationId = z.infer<typeof NationId>;
export type RegionId = z.infer<typeof RegionId>;
export type TreatyId = z.infer<typeof TreatyId>;
export type ConflictId = z.infer<typeof ConflictId>;
export type EventId = z.infer<typeof EventId>;
export type TurnId = z.infer<typeof TurnId>;
export type ActionId = z.infer<typeof ActionId>;
export type CommandId = z.infer<typeof CommandId>;
export type ModelCallId = z.infer<typeof ModelCallId>;
export type SaveId = z.infer<typeof SaveId>;
export type GoalId = z.infer<typeof GoalId>;

export const InitiativeId = id('initiative', 'InitiativeId');
export const NegotiationId = id('negotiation', 'NegotiationId');
export type InitiativeId = z.infer<typeof InitiativeId>;
export type NegotiationId = z.infer<typeof NegotiationId>;
export type OrganizationId = z.infer<typeof OrganizationId>;
export type OrganizationCommitmentId = z.infer<typeof OrganizationCommitmentId>;
export type OrganizationProgramId = z.infer<typeof OrganizationProgramId>;
