import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActionId, CommandId, TurnId, WorldState } from '@mandate/schemas';
import type { WorldCommand, WorldState as World } from '@mandate/schemas';
import { resolveTurn, semanticEventSignature } from '@mandate/core';
import { loadScenario } from '@mandate/scenarios';
import { deterministicPlayerIntent, executePlayerAction } from '@mandate/ai';

const orders = [
  'Nicaragua forms the CAEU (Central american economic union) and invites all countries in central america. The economic union focuses on increased economic integration between the central american countries. Nicaragua is prepared to subsidize and support any country that joins economically.',
  'Nicaragua deepens economic integration with CAEU members and also starts building infrastructure connecting the countries.',
  'Nicaragua proposes further political collaboration between central american countries to have a larger impact on the world stage. Nicaragua wishes to create a unified central american front.',
];

const dateAfterDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const executions: ReturnType<typeof executePlayerAction>[] = [];

function commit(
  world: World,
  text: string,
  commands: Array<{ command: WorldCommand; reason: string }>,
  source: 'player' | 'system',
  actorNationId: World['playerNationId'],
  semanticGraph?: World['actions'][number]['semanticGraph'],
) {
  const turnNumber = world.revision + 1;
  const run = `caeu-campaign-${turnNumber}`;
  return resolveTurn(
    world,
    {
      expectedRevision: world.revision,
      action: {
        actorNationId,
        source,
        text,
        ...(semanticGraph ? { semanticGraph } : {}),
      },
      commands: commands.map((entry, index) => ({
        id: CommandId.parse(`command:${run}-${index}`),
        reason: entry.reason,
        command: entry.command,
      })),
    },
    {
      turnId: TurnId.parse(`turn:${run}`),
      actionId: ActionId.parse(`action:${run}`),
      recordedAt: '2026-10-04T00:00:00.000Z',
    },
  );
}

function playerOrder(world: World, text: string) {
  const intent = deterministicPlayerIntent(world, {
    actorNationId: world.playerNationId,
    text,
  });
  const execution = executePlayerAction(
    world,
    intent,
    `caeu-turn-${world.revision + 1}`,
  );
  executions.push(execution);
  return commit(
    world,
    text,
    execution.commands,
    'player',
    world.playerNationId,
    intent.actionGraph,
  );
}

let world = WorldState.parse(
  loadScenario(resolve('data/scenarios/global-regional.json')),
);
world.playerNationId = world.nations.find(
  (nation) => nation.name === 'Nicaragua',
)!.id;
const startingDate = world.date;
const nicaragua = world.playerNationId;
world = playerOrder(world, orders[0]!);
let caeu = world.organizations.find(
  (organization) => organization.acronym === 'CAEU',
);
if (!caeu) throw new Error('The first player order did not create CAEU.');

// The real campaign state in the report has seven current members. Each invited
// government records its own accepted response before the follow-up proposals.
world = commit(
  world,
  'Independent Central American governments decide on CAEU invitations.',
  caeu.invitations.map((invitation) => ({
    command: {
      type: 'RESPOND_ORGANIZATION_INVITATION',
      organizationId: caeu!.id,
      nationId: invitation.nationId,
      move: 'accept',
      message: 'The government independently accepts membership.',
    },
    reason: `${invitation.nationId} independently accepts CAEU membership`,
  })),
  'system',
  caeu.invitations[0]!.nationId,
);
world = playerOrder(world, orders[1]!);
world = playerOrder(world, orders[2]!);
const playerOrderTurns = world.turns.slice(-2);
const monthlyTurns: World['turns'] = [];
for (let month = 0; month < 24; month++) {
  const date = dateAfterDays(world.date, 30);
  world = commit(
    world,
    `Advance one month to ${date}.`,
    [
      {
        command: { type: 'ADVANCE_DATE', date },
        reason: 'Advance the fixed monthly simulation clock.',
      },
    ],
    'system',
    nicaragua,
  );
  monthlyTurns.push(world.turns.at(-1)!);
}

caeu = world.organizations.find(
  (organization) => organization.acronym === 'CAEU',
);
if (!caeu) throw new Error('CAEU disappeared during the monthly replay.');
const name = (id: string) =>
  world.nations.find((nation) => nation.id === id)?.name ?? id;
const timeline = monthlyTurns.flatMap((turn) =>
  turn.eventIds
    .map((id) => world.events.find((event) => event.id === id)!)
    .filter((event) => event.type !== 'ADVANCE_DATE')
    .map((event) => ({
      date: event.date,
      turn: turn.revision,
      title: event.title,
      type: event.type,
      category: event.novelty ?? 'legacy-unclassified',
      provenance: event.provenance?.kind ?? 'legacy-unclassified',
    })),
);
const monthlyEventIds = new Set(monthlyTurns.flatMap((turn) => turn.eventIds));
const monthlyEvents = world.events.filter((event) =>
  monthlyEventIds.has(event.id),
);
const monthlyNewsEvents = monthlyEvents.filter(
  (event) => event.type !== 'ADVANCE_DATE',
);
const organizationTimeline = world.events
  .filter(
    (event) =>
      event.type.startsWith('ORGANIZATION_') ||
      event.title.includes('CAEU') ||
      event.title.includes('Central American Economic Union'),
  )
  .map((event) => ({
    date: event.date,
    turn: world.turns.find((turn) => turn.id === event.turnId)?.revision,
    title: event.title,
    type: event.type,
    category: event.novelty ?? 'legacy-unclassified',
    provenance: event.provenance?.kind ?? 'legacy-unclassified',
  }));

const surfacedMaintenance = monthlyNewsEvents.filter(
  (event) =>
    event.novelty === 'maintenance' ||
    /ORGANIZATION_(?:COMMITMENT_PAID|INTEGRATION_PROGRESS)$/.test(event.type),
);
const automaticEvents = monthlyNewsEvents.filter(
  (event) => event.provenance?.kind === 'automatic-effect',
);
const automaticSignatureCounts = new Map<string, number>();
for (const event of automaticEvents) {
  const signature = semanticEventSignature(event);
  automaticSignatureCounts.set(
    signature,
    (automaticSignatureCounts.get(signature) ?? 0) + 1,
  );
}
const repeatedAutomaticSignatureCounts = [...automaticSignatureCounts.values()];
const repeatedAutomaticSignatures = repeatedAutomaticSignatureCounts.filter(
  (count) => count > 1,
).length;
const repeatedAutomaticEvents = repeatedAutomaticSignatureCounts.reduce(
  (sum, count) => sum + Math.max(0, count - 1),
  0,
);
const headlineFamilies = new Map<string, number>();
for (const event of monthlyNewsEvents) {
  const signature = semanticEventSignature(event);
  headlineFamilies.set(signature, (headlineFamilies.get(signature) ?? 0) + 1);
}
const repeatedHeadlineFamilies = [...headlineFamilies.values()].filter(
  (count) => count > 1,
).length;
const repeatedSemanticEventCount = [...headlineFamilies.values()].reduce(
  (sum, count) => sum + Math.max(0, count - 1),
  0,
);
const eventMetrics = monthlyTurns.reduce(
  (sum, turn) => ({
    candidateCount:
      sum.candidateCount + (turn.eventMetrics?.candidateCount ?? 0),
    surfacedCount: sum.surfacedCount + (turn.eventMetrics?.surfacedCount ?? 0),
    duplicateSuppressed:
      sum.duplicateSuppressed + (turn.eventMetrics?.duplicateSuppressed ?? 0),
    maintenanceSuppressed:
      sum.maintenanceSuppressed +
      (turn.eventMetrics?.maintenanceSuppressed ?? 0),
    progressSuppressed:
      sum.progressSuppressed + (turn.eventMetrics?.progressSuppressed ?? 0),
  }),
  {
    candidateCount: 0,
    surfacedCount: 0,
    duplicateSuppressed: 0,
    maintenanceSuppressed: 0,
    progressSuppressed: 0,
  },
);
const playerAudits = executions.flatMap(
  (execution) => execution.semanticAudit ?? [],
);
const policyOnlyClauseCounts = {
  executedOnlyByStrategy: playerAudits.filter(
    (entry) =>
      entry.status === 'EXECUTED' &&
      entry.commandTypes.length === 1 &&
      entry.commandTypes[0] === 'SET_STRATEGY',
  ).length,
  attemptedAlongsideStrategy: playerAudits.filter(
    (entry) =>
      entry.status === 'ATTEMPTED' &&
      entry.commandTypes.includes('SET_STRATEGY'),
  ).length,
};
const support = caeu.commitments[0];
const report = {
  campaign: {
    scenario: world.scenario.name,
    player: name(nicaragua),
    organization: caeu.acronym,
    startDate: startingDate,
    endDate: world.date,
    elapsedMonths: 24,
    foundingAndInvitationTurn: orders[0],
    developmentOrders: orders.slice(1),
    invitationResponses: caeu.invitations.map((invitation) => ({
      government: name(invitation.nationId),
      response: invitation.lastMove,
      status: invitation.status,
    })),
  },
  before: {
    observedPattern: [
      'Central American Economic Union advanced gradual trade and economic integration among its 7 current members.',
      'Nicaragua paid 12 treasury units for CAEU support to 6 participating members.',
    ],
    repeatedEveryMonthInReportedCampaign: true,
  },
  after: {
    organization: {
      members: caeu.members.map(name),
      development: caeu.development,
      programs: caeu.programs.map((program) => ({
        title: program.title,
        dimension: program.dimension,
        status: program.status,
        stage: program.stage,
        progress: program.progress,
        monthlyCost: program.monthlyCost,
        invested: program.totalInvested,
        responses: program.responses.map((response) => ({
          government: name(response.nationId),
          move: response.move,
          terms: response.counterTerms,
        })),
      })),
      supportLedger: support
        ? {
            status: support.status,
            paidThisMonth:
              support.lastPaymentDate?.slice(0, 7) === world.date.slice(0, 7)
                ? support.lastPaymentAmount
                : 0,
            lastPaymentDate: support.lastPaymentDate,
            totalPaid: support.totalPaid,
            paymentsMade: support.paymentsMade,
            nextPaymentDate: support.nextPaymentDate,
          }
        : null,
      recentHistory: caeu.history.slice(-24).map((entry) => ({
        date: entry.date,
        kind: entry.kind,
        detail: entry.description,
      })),
    },
    timeline,
  },
  repetitionMetrics: {
    monthlyTurns: monthlyTurns.length,
    monthlyEngineEvents: monthlyEvents.length,
    monthlySurfacedEvents: monthlyNewsEvents.length,
    eventMetrics,
    surfacedMaintenanceEvents: surfacedMaintenance.length,
    routinePaymentHistoryEntries: caeu.history.filter(
      (entry) => entry.kind === 'commitment-paid',
    ).length,
    routineIntegrationHistoryEntries: caeu.history.filter(
      (entry) => entry.kind === 'integration-progress',
    ).length,
    repeatedAutomaticSemanticFamilies: repeatedAutomaticSignatures,
    repeatedAutomaticSemanticEvents: repeatedAutomaticEvents,
    repeatedHeadlineFamilies,
    repeatedSemanticEventCount,
    repeatedSemanticEventRatePercent:
      monthlyNewsEvents.length === 0
        ? 0
        : Number(
            (
              (repeatedSemanticEventCount / monthlyNewsEvents.length) *
              100
            ).toFixed(2),
          ),
    uniqueConsequentialDevelopments: new Set(
      monthlyNewsEvents
        .filter(
          (event) =>
            ['milestone', 'major-development'].includes(event.novelty ?? '') ||
            (event.novelty === 'consequence' && event.importance >= 60),
        )
        .map(semanticEventSignature),
    ).size,
    organizationMilestones: monthlyNewsEvents.filter((event) =>
      /ORGANIZATION_(?:DEVELOPMENT_MILESTONE|PROGRAM_MILESTONE|PROGRAM_APPROVED)$/.test(
        event.type,
      ),
    ).length,
    playerClauseAuditCount: playerAudits.length,
    strategyOnlyClauseCounts: policyOnlyClauseCounts,
  },
  notableOrganizationTimeline: organizationTimeline,
  sourceTurns: playerOrderTurns.map((turn) => turn.revision),
};

const outputDirectory = resolve('.runtime/evaluation');
mkdirSync(outputDirectory, { recursive: true });
const output = resolve(outputDirectory, `caeu-campaign-${Date.now()}.json`);
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      output,
      date: world.date,
      members: caeu.members.length,
      payments: support?.paymentsMade,
      totalSupport: support?.totalPaid,
      programs: caeu.programs.map((program) => ({
        dimension: program.dimension,
        status: program.status,
        stage: program.stage,
        progress: program.progress,
      })),
      repetitionMetrics: report.repetitionMetrics,
      notableOrganizationTimeline: organizationTimeline,
    },
    null,
    2,
  ),
);
