import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createOrchestrator,
  createProvider,
  ProviderConfig,
} from '@mandate/ai';
import { canonicalStringify, resolveTurn } from '@mandate/core';
import {
  loadScenario,
  resolveOrganizationGeographicSet,
} from '@mandate/scenarios';
import { ActionId, NationId, TurnId, WorldState } from '@mandate/schemas';
import { inferenceOptions } from './inference-options.js';

const order =
  'Nicaragua forms the CAEU (Central american economic union) and invites all countries in central america. The economic union focuses on increased economic integration between the central american countries. Nicaragua is prepared to subsidize and support any country that joins economically.';
const options = await inferenceOptions();
if (!options.selected || options.selected.kind === 'fake')
  throw new Error('No reachable configured real model is available.');

const config = ProviderConfig.parse({
  ...options.selected,
  timeoutMs: Math.max(options.selected.timeoutMs, 180000),
  maxTurnMs: Math.max(options.selected.maxTurnMs, 600000),
});
const provider = createProvider(config);
const health = await provider.health();
if (!health.ok || !health.models.includes(config.model))
  throw new Error(
    `Configured provider/model is unavailable (${config.kind}/${config.model}): ${health.message}`,
  );

const before = WorldState.parse(
  loadScenario(resolve('data/scenarios/global-regional.json')),
);
const nicaragua = before.nations.find((nation) => nation.name === 'Nicaragua')!;
before.playerNationId = nicaragua.id;
const runId = `nicaragua-caeu-real-${Date.now()}`;
const prepared = await createOrchestrator(provider, config).prepare({
  world: before,
  expectedHash: createHash('sha256')
    .update(canonicalStringify(before))
    .digest('hex'),
  action: {
    actorNationId: nicaragua.id,
    source: 'player',
    text: order,
    grounding: { selectedNationId: nicaragua.id },
  },
  runId,
  days: 30,
  quality: 'balanced',
});
const { expectedHash: _expectedHash, ...request } = prepared.request;
void _expectedHash;
const graphTargets = (
  prepared.trace.intent?.actionGraph?.actions ?? []
).flatMap((action) => [
  ...action.targets,
  ...action.sources,
  ...action.participants,
  ...action.beneficiaries,
]);
const unitedStatesId = NationId.parse('nation:usa');
if (graphTargets.includes(unitedStatesId))
  throw new Error('The parsed Nicaragua order unexpectedly targeted the USA.');
const after = resolveTurn(before, request, {
  turnId: TurnId.parse(`turn:${runId}`),
  actionId: ActionId.parse(`action:${runId}`),
  recordedAt: new Date().toISOString(),
});

const name = (id: string) =>
  before.nations.find((nation) => nation.id === id)?.name ?? id;
const geographicSet = resolveOrganizationGeographicSet(
  before,
  nicaragua.id,
  order,
);
if (!geographicSet) throw new Error('Central America did not resolve.');
const organization = after.organizations.find(
  (entry) => entry.acronym === 'CAEU',
);
if (!organization) throw new Error('The real-model turn did not create CAEU.');
const turn = after.turns.at(-1)!;
const committed = after.commands.filter((entry) => entry.turnId === turn.id);
const events = after.events.filter((entry) => entry.turnId === turn.id);
const invitationIds = new Set(
  organization.invitations.map((invitation) => invitation.nationId),
);
const playerCommands = new Set(
  prepared.trace.playerExecution?.commands.map(({ command }) =>
    JSON.stringify(command),
  ) ?? [],
);
const committedResponseCommands = committed
  .filter(({ command }) => command.type === 'RESPOND_ORGANIZATION_INVITATION')
  .map(({ command }) => command);
const beforeTreasury = nicaragua.stats.treasury;
const afterTreasury = after.nations.find(
  (nation) => nation.id === nicaragua.id,
)!.stats.treasury;
const source =
  options.report.configured.find(
    (entry) =>
      entry.ok &&
      entry.kind === config.kind &&
      entry.models.includes(config.model),
  )?.source ?? 'configured provider';
const endpoint = new URL(
  config.baseUrl ??
    (config.kind === 'ollama'
      ? 'http://127.0.0.1:11434'
      : 'http://127.0.0.1:1234/v1'),
).origin;

const report = {
  recordedAt: new Date().toISOString(),
  order,
  scenario: {
    id: before.scenario.id,
    name: before.scenario.name,
    date: before.date,
  },
  provider: {
    id: provider.id,
    model: config.model,
    workflow: config.workflow,
    source,
    endpoint,
  },
  parsedIntent: {
    actor: nicaragua.name,
    clauses: (prepared.trace.intent?.actionGraph?.actions ?? []).map(
      (action) => ({
        text: action.text,
        action: action.action,
        targets: action.targets.map(name),
        participants: action.participants.map(name),
        issues: action.issues,
      }),
    ),
    clausesAccountedFor:
      prepared.trace.playerExecution?.semanticAudit?.map((entry) => ({
        actionId: entry.actionId,
        status: entry.status,
        explanation: entry.explanation,
      })) ?? [],
    unmentionedUnitedStatesTarget: !graphTargets.includes(unitedStatesId),
  },
  geographicSet: {
    groupId: geographicSet.groupId,
    label: geographicSet.label,
    expression: geographicSet.expression,
    countries: geographicSet.nationIds.map(name),
  },
  organizationCreated: {
    id: organization.id,
    name: organization.name,
    acronym: organization.acronym,
    kind: organization.kind,
    foundingDate: organization.foundingDate,
    founders: organization.founders.map(name),
    foundingMembers: organization.members
      .filter((id) => organization.founders.includes(id))
      .map(name),
    purpose: organization.purpose,
    geographicScope: organization.geographicScope,
    status: organization.status,
    invitations: organization.invitations.map((invitation) => ({
      country: name(invitation.nationId),
      status: invitation.status,
      response: invitation.lastMove,
      counterTerms: invitation.counterTerms,
    })),
  },
  membershipResponses: organization.invitations.map((invitation) => ({
    country: name(invitation.nationId),
    status: invitation.status,
    response: invitation.lastMove,
    message: invitation.message,
    counterTerms: invitation.counterTerms,
  })),
  financialCommitments: organization.commitments,
  worldReactions: {
    governmentPlans: prepared.trace.plans
      .filter((plan) => invitationIds.has(plan.nationId))
      .map((plan) => ({
        nation: name(plan.nationId),
        stance: plan.stance,
        uncertainty: plan.uncertainty,
        explanation: plan.explanation,
        intentions: plan.intentions,
        decisionFactors: plan.decisionFactors,
      })),
    membershipCommands: committedResponseCommands,
    otherCommittedCommands: committed
      .filter(
        (entry) =>
          !playerCommands.has(JSON.stringify(entry.command)) &&
          entry.command.type !== 'RESPOND_ORGANIZATION_INVITATION',
      )
      .map((entry) => ({
        command: entry.command,
        reason: entry.reason,
      })),
    events: events.map((event) => ({
      type: event.type,
      title: event.title,
      nationIds: event.nationIds.map(name),
    })),
  },
  finalCanonicalState: {
    revision: after.revision,
    date: after.date,
    organization: {
      id: organization.id,
      name: organization.name,
      acronym: organization.acronym,
      kind: organization.kind,
      founders: organization.founders.map(name),
      members: organization.members.map(name),
      invitedStates: organization.invitedStates.map(name),
      pendingInvitations: organization.invitations
        .filter((invitation) => invitation.status === 'pending')
        .map((invitation) => name(invitation.nationId)),
      purpose: organization.purpose,
      charter: organization.charter,
      commitments: organization.commitments,
      history: organization.history,
    },
    nicaraguaTreasury: {
      before: beforeTreasury,
      after: afterTreasury,
      delta: afterTreasury - beforeTreasury,
    },
    modelCalls: prepared.trace.modelCalls.map((call) => ({
      role: call.role,
      provider: call.provider,
      model: call.model,
      status: call.status,
      contextCharacters: call.contextCharacters,
      latencyMs: call.latencyMs,
      validationFailures: call.validationFailures,
    })),
    traceStatus: prepared.trace.status,
    validatorResults: prepared.trace.validatorResults,
    failures: prepared.trace.failures,
  },
};

const output = resolve('.runtime/evaluation', `${runId}.json`);
mkdirSync(resolve('.runtime/evaluation'), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      output,
      provider: report.provider,
      date: after.date,
      invitees: geographicSet.nationIds.length,
      accepted: organization.invitations.filter(
        (invitation) => invitation.status === 'accepted',
      ).length,
      rejected: organization.invitations.filter(
        (invitation) => invitation.status === 'rejected',
      ).length,
      pending: organization.invitations.filter(
        (invitation) => invitation.status === 'pending',
      ).length,
      treasuryDelta: afterTreasury - beforeTreasury,
      modelCalls: prepared.trace.modelCalls.length,
    },
    null,
    2,
  ),
);
