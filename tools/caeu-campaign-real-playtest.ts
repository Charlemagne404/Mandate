import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAlphaServices } from '../apps/server/src/alpha.js';
import { buildServer } from '../apps/server/src/app.js';
import { semanticEventSignature } from '@mandate/core';
import { canonicalHash, openWorldStore } from '@mandate/persistence';
import { loadScenario } from '@mandate/scenarios';
import { NationId } from '@mandate/schemas';
import { inferenceOptions } from './inference-options.js';

const orders = [
  'Nicaragua forms the CAEU (Central american economic union) and invites all countries in central america. The economic union focuses on increased economic integration between the central american countries. Nicaragua is prepared to subsidize and support any country that joins economically.',
  'Nicaragua deepens economic integration with CAEU members and also starts building infrastructure connecting the countries.',
  'Nicaragua proposes further political collaboration between central american countries to have a larger impact on the world stage. Nicaragua wishes to create a unified central american front.',
];
const options = await inferenceOptions();
if (!options.selected || options.selected.kind === 'fake')
  throw new Error('No reachable configured real model is available.');

const config = {
  ...options.selected,
  timeoutMs: Math.max(options.selected.timeoutMs, 180_000),
  maxTurnMs: Math.max(options.selected.maxTurnMs, 600_000),
};
const timestamp = new Date()
  .toISOString()
  .replaceAll(/[^0-9]/g, '')
  .slice(0, 14);
const runId = `caeu-campaign-real-${timestamp}`;
const directory = resolve('.runtime/evaluation', runId);
mkdirSync(directory, { recursive: true });
const store = openWorldStore({
  filename: resolve(directory, 'world.sqlite'),
  migrationsDirectory: resolve('packages/persistence/migrations'),
});
const initial = loadScenario(resolve('data/scenarios/global-regional.json'));
const nicaraguaId = NationId.parse('nation:nic');
initial.playerNationId = nicaraguaId;
initial.observerMode = false;
store.initialize(initial);
const app = buildServer({
  store,
  services: createAlphaServices(store, {
    directory,
    scenariosDirectory: resolve('data/scenarios'),
  }),
  geography: '{"type":"FeatureCollection","features":[]}',
});

type StoredTrace = {
  intent?: {
    actionGraph?: {
      actions: Array<{ text: string; action: string; issues: string[] }>;
    };
  };
  playerExecution?: {
    semanticAudit?: Array<{
      text: string;
      status: string;
      commandTypes: string[];
      explanation: string;
    }>;
    intentSatisfactionAudit?: Array<{
      status: string;
      explanation: string;
    }>;
  };
  modelCalls?: Array<{
    role: string;
    status: string;
    latencyMs: number;
    contextCharacters: number;
  }>;
  failures?: string[];
};
type PlayerTurnResult = {
  order: string;
  statusCode: number;
  date: string;
  revision: number;
  commands: string[];
  events: Array<{
    id: string;
    type: string;
    title: string;
    novelty?: string;
    provenance?: string;
  }>;
  clauses: Array<{ text: string; action: string; issues: string[] }>;
  semanticAudit: NonNullable<StoredTrace['playerExecution']>['semanticAudit'];
  intentSatisfactionAudit: NonNullable<
    StoredTrace['playerExecution']
  >['intentSatisfactionAudit'];
  modelCalls: StoredTrace['modelCalls'];
  failures: string[];
  error?: string;
};

const playerTurns: PlayerTurnResult[] = [];
const soakTurns: ReturnType<typeof store.load>['turns'] = [];
const names = new Map<string, string>(
  initial.nations.map((nation): [string, string] => [nation.id, nation.name]),
);
const actorName = (id: string) => names.get(id) ?? id;
let world = store.load();
const apiErrors: string[] = [];

try {
  const settings = await app.inject({
    method: 'POST',
    url: '/api/settings',
    payload: config,
  });
  if (settings.statusCode !== 200)
    throw new Error(`Could not configure model: ${settings.body}`);
  const health = await app.inject({
    method: 'POST',
    url: '/api/provider/health',
  });
  if (!health.json<{ ok: boolean }>().ok)
    throw new Error(`Model health check failed: ${health.body}`);

  for (const order of orders) {
    const before = store.load();
    const response = await app.inject({
      method: 'POST',
      url: '/api/play',
      payload: {
        expectedRevision: before.revision,
        expectedHash: canonicalHash(before),
        text: order,
        days: 30,
        quality: 'balanced',
      },
    });
    world = store.load();
    if (response.statusCode !== 200) {
      apiErrors.push(`${response.statusCode}: ${response.body}`);
      playerTurns.push({
        order,
        statusCode: response.statusCode,
        date: world.date,
        revision: world.revision,
        commands: [],
        events: [],
        clauses: [],
        semanticAudit: [],
        intentSatisfactionAudit: [],
        modelCalls: [],
        failures: [],
        error: response.body,
      });
      break;
    }
    const turn = world.turns.at(-1)!;
    const trace = (store.loadAudit(turn.id) ?? {}) as StoredTrace;
    playerTurns.push({
      order,
      statusCode: response.statusCode,
      date: world.date,
      revision: turn.revision,
      commands: world.commands
        .filter((record) => record.turnId === turn.id)
        .map((record) => record.command.type),
      events: world.events
        .filter((event) => event.turnId === turn.id)
        .filter((event) => event.type !== 'ADVANCE_DATE')
        .map((event) => ({
          id: event.id,
          type: event.type,
          title: event.title,
          ...(event.novelty ? { novelty: event.novelty } : {}),
          ...(event.provenance?.kind
            ? { provenance: event.provenance.kind }
            : {}),
        })),
      clauses: trace.intent?.actionGraph?.actions ?? [],
      semanticAudit: trace.playerExecution?.semanticAudit ?? [],
      intentSatisfactionAudit:
        trace.playerExecution?.intentSatisfactionAudit ?? [],
      modelCalls: trace.modelCalls ?? [],
      failures: trace.failures ?? [],
    });
  }

  world = store.load();
  const startingDate = initial.date;
  const monthlySoakCount = 21;
  for (let month = 0; month < monthlySoakCount; month++) {
    const before = store.load();
    const date = new Date(Date.parse(before.date) + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    world = store.commit({
      expectedRevision: before.revision,
      expectedHash: canonicalHash(before),
      action: {
        actorNationId: nicaraguaId,
        source: 'system',
        text: `Advance one month to ${date}.`,
      },
      commands: [
        {
          id: `command:${runId}-soak-${month + 1}`,
          reason: 'Advance the fixed monthly simulation clock.',
          command: { type: 'ADVANCE_DATE', date },
        },
      ],
    });
    soakTurns.push(world.turns.at(-1)!);
  }

  const organization = world.organizations.find(
    (entry) => entry.acronym === 'CAEU',
  );
  const campaignEvents = world.events
    .slice(initial.events.length)
    .filter((event) => event.type !== 'ADVANCE_DATE');
  const headlineFamilies = new Map<string, number>();
  const automaticFamilies = new Map<string, number>();
  for (const event of campaignEvents) {
    const signature = semanticEventSignature(event);
    headlineFamilies.set(signature, (headlineFamilies.get(signature) ?? 0) + 1);
    if (event.provenance?.kind === 'automatic-effect')
      automaticFamilies.set(
        signature,
        (automaticFamilies.get(signature) ?? 0) + 1,
      );
  }
  const repeatCount = (families: Map<string, number>) =>
    [...families.values()].reduce(
      (sum, count) => sum + Math.max(0, count - 1),
      0,
    );
  const countFamilies = (families: Map<string, number>) =>
    [...families.values()].filter((count) => count > 1).length;
  const monthlyTurns = [
    ...playerTurns
      .filter((turn) => turn.statusCode === 200)
      .map((result) =>
        world.turns.find((turn) => turn.revision === result.revision)!,
      ),
    ...soakTurns,
  ];
  const eventMetrics = monthlyTurns.reduce(
    (sum, turn) => ({
      candidateCount:
        sum.candidateCount + (turn.eventMetrics?.candidateCount ?? 0),
      surfacedCount:
        sum.surfacedCount + (turn.eventMetrics?.surfacedCount ?? 0),
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
  const audits = playerTurns.flatMap((turn) => turn.semanticAudit ?? []);
  const support = organization?.commitments[0];
  const allPlayerTurnsSucceeded =
    playerTurns.length === orders.length &&
    playerTurns.every((turn) => turn.statusCode === 200);
  const report = {
    method:
      'Exact player orders through Fastify POST /api/play with local Ollama; monthly soak through canonical SQLite commits.',
    provider: {
      kind: config.kind,
      model: config.model,
      source:
        options.report.configured.find(
          (entry) =>
            entry.ok &&
            entry.kind === config.kind &&
            entry.models.includes(config.model),
        )?.source ?? 'configured provider',
      endpoint: new URL(config.baseUrl ?? 'http://127.0.0.1:11434').origin,
    },
    campaign: {
      scenario: world.scenario.name,
      player: actorName(nicaraguaId),
      organizationName: 'CAEU',
      startDate: startingDate,
      endDate: world.date,
      elapsedMonths: 24,
      playerOrders: playerTurns,
      invitationResponses: organization?.invitations.map((invitation) => ({
        government: actorName(invitation.nationId),
        response: invitation.lastMove,
        status: invitation.status,
      })),
      organizationState: organization
        ? {
            members: organization.members.map(actorName),
            development: organization.development,
            programs: organization.programs.map((program) => ({
              title: program.title,
              dimension: program.dimension,
              status: program.status,
              stage: program.stage,
              progress: program.progress,
              totalInvested: program.totalInvested,
              responses: program.responses.map((response) => ({
                government: actorName(response.nationId),
                move: response.move,
                terms: response.counterTerms,
              })),
            })),
            supportLedger: support
              ? {
                  status: support.status,
                  lastPaymentAmount: support.lastPaymentAmount,
                  totalPaid: support.totalPaid,
                  paymentsMade: support.paymentsMade,
                  nextPaymentDate: support.nextPaymentDate,
                }
              : null,
          }
        : null,
      notableTimeline: campaignEvents
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
          novelty: event.novelty,
          provenance: event.provenance?.kind,
        })),
    },
    repetitionMetrics: {
      monthlyTurns: monthlyTurns.length,
      monthlySurfacedEvents: campaignEvents.length,
      eventMetrics,
      surfacedMaintenanceEvents: campaignEvents.filter(
        (event) =>
          event.novelty === 'maintenance' ||
          /ORGANIZATION_(?:COMMITMENT_PAID|INTEGRATION_PROGRESS)$/.test(
            event.type,
          ),
      ).length,
      routinePaymentHistoryEntries:
        organization?.history.filter(
          (entry) => entry.kind === 'commitment-paid',
        ).length ?? 0,
      routineIntegrationHistoryEntries:
        organization?.history.filter(
          (entry) => entry.kind === 'integration-progress',
        ).length ?? 0,
      repeatedAutomaticSemanticFamilies: countFamilies(automaticFamilies),
      repeatedAutomaticSemanticEvents: repeatCount(automaticFamilies),
      repeatedHeadlineFamilies: countFamilies(headlineFamilies),
      repeatedSemanticEventCount: repeatCount(headlineFamilies),
      repeatedSemanticEventRatePercent:
        campaignEvents.length === 0
          ? 0
          : Number(
              (
                (repeatCount(headlineFamilies) / campaignEvents.length) *
                100
              ).toFixed(2),
            ),
      uniqueConsequentialDevelopments: new Set(
        campaignEvents
          .filter(
            (event) =>
              ['milestone', 'major-development'].includes(
                event.novelty ?? '',
              ) ||
              (event.novelty === 'consequence' && event.importance >= 60),
          )
          .map(semanticEventSignature),
      ).size,
      organizationMilestones: campaignEvents.filter((event) =>
        /ORGANIZATION_(?:DEVELOPMENT_MILESTONE|PROGRAM_MILESTONE|PROGRAM_APPROVED)$/.test(
          event.type,
        ),
      ).length,
      playerClauseAuditCount: audits.length,
      strategyOnlyClauseCounts: {
        executedOnlyByStrategy: audits.filter(
          (entry) =>
            entry.status === 'EXECUTED' &&
            entry.commandTypes.length === 1 &&
            entry.commandTypes[0] === 'SET_STRATEGY',
        ).length,
        attemptedAlongsideStrategy: audits.filter(
          (entry) =>
            entry.status === 'ATTEMPTED' &&
            entry.commandTypes.includes('SET_STRATEGY'),
        ).length,
      },
      allPlayerTurnsSucceeded,
      apiErrors,
    },
    database: resolve(directory, 'world.sqlite'),
    canonicalHash: canonicalHash(world),
  };
  const output = resolve(directory, 'report.json');
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        output,
        provider: report.provider,
        date: world.date,
        playerTurns: playerTurns.map((turn) => ({
          revision: turn.revision,
          date: turn.date,
          statusCode: turn.statusCode,
          clauses: turn.clauses.map(({ text, action }) => ({ text, action })),
          commands: turn.commands,
          modelCalls: turn.modelCalls?.length ?? 0,
        })),
        members: organization?.members.length ?? 0,
        payments: support?.paymentsMade ?? 0,
        totalSupport: support?.totalPaid ?? 0,
        programs: organization?.programs.map((program) => ({
          dimension: program.dimension,
          status: program.status,
          progress: program.progress,
        })),
        repetitionMetrics: report.repetitionMetrics,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  store.close();
}
