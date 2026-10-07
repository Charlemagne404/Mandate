import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { influenceProfile } from '@mandate/core';
import { createAlphaServices } from '../apps/server/src/alpha.js';
import { buildServer } from '../apps/server/src/app.js';
import { canonicalHash, openWorldStore } from '@mandate/persistence';
import { loadScenario } from '@mandate/scenarios';
import { NationId } from '@mandate/schemas';
import type { InfluenceDecision } from '@mandate/schemas';
import { inferenceOptions } from './inference-options.js';

const orders = [
  'Nicaragua forms the Central American Economic Union (CAEU) and invites Honduras and Guatemala to join voluntarily. Offer affordable trade and energy cooperation; each government decides independently.',
  'Counter Guatemala’s current influence counteroffer by preserving its energy supply and increasing infrastructure investment to 14 treasury units per month. Do not add a political restriction or offensive-war obligation.',
  'Counter Honduras’s current influence counteroffer by preserving its energy supply and increasing infrastructure investment to 14 treasury units per month. Do not add a political restriction or offensive-war obligation.',
  'At the national level, review treasury, recurring commitments, payment obligations, and execution capacity. Choose either Honduras or Guatemala as this year’s sphere priority, explain why, and defer new commitments to the other target.',
  'With Honduras only, ask for foreign-policy consultation paired with security support. Preserve accepted economic terms and allow Honduras to counter any objectionable clause.',
  'Counter Honduras’s current influence counteroffer by preserving its security guarantee and replacing any foreign-policy veto with foreign-policy consultation. Add no offensive-war obligation.',
  'With Guatemala only, offer affordable debt relief in return for common economic rules. Compare any real rival offer if Guatemala has made one; do not invent a rival.',
  'Counter Guatemala’s current influence counteroffer by preserving its affordable economic benefits and limiting any military obligation to defensive wars only, with no offensive wars.',
  'Review Nicaragua-Honduras obligations only. Fulfill affordable commitments and adapt to its actual objections, changed circumstances, and any credible rival offer.',
  'Review national sphere priorities for next year. Adjust Honduras and Guatemala resource allocations to treasury and commitments; make no new target restrictions without target-specific consent.',
];

const options = await inferenceOptions();
if (!options.selected || options.selected.kind === 'fake')
  throw new Error('No reachable configured real model is available.');

const qwen3Available = options.report.configured.some(
  (entry) =>
    entry.ok &&
    entry.kind === 'ollama' &&
    entry.models.includes('qwen3:4b-instruct'),
);
const strongestInstalledLocalModel =
  options.selected.kind === 'ollama' && qwen3Available
    ? 'qwen3:4b-instruct'
    : undefined;

const config = {
  ...options.selected,
  ...(strongestInstalledLocalModel
    ? {
        model: strongestInstalledLocalModel,
        highImportanceModel: strongestInstalledLocalModel,
      }
    : {}),
  maxCalls: 5,
  timeoutMs: Math.max(options.selected.timeoutMs, 180_000),
  maxTurnMs: Math.max(options.selected.maxTurnMs, 600_000),
  ...(options.selected.kind === 'ollama' &&
  options.report.configured.some(
    (entry) =>
      entry.ok &&
      entry.kind === 'ollama' &&
      entry.models.includes('qwen3:4b-instruct'),
  )
    ? { highImportanceModel: 'qwen3:4b-instruct' }
    : {}),
};
const provider = {
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
};
const resumeDatabase = process.env.MANDATE_PUPPETMASTER_RESUME_DB;
const timestamp = new Date()
  .toISOString()
  .replaceAll(/[^0-9]/g, '')
  .slice(0, 14);
const runId = resumeDatabase
  ? basename(dirname(resolve(resumeDatabase)))
  : `puppetmaster-rival-real-${timestamp}`;
const directory = resumeDatabase
  ? dirname(resolve(resumeDatabase))
  : resolve('.runtime/evaluation', runId);
mkdirSync(directory, { recursive: true });
const store = openWorldStore({
  filename: resumeDatabase
    ? resolve(resumeDatabase)
    : resolve(directory, 'world.sqlite'),
  migrationsDirectory: resolve('packages/persistence/migrations'),
});
const initial = loadScenario(resolve('data/scenarios/global-regional.json'));
const nationIdByName = (name: string) => {
  const id = initial.nations.find((nation) => nation.name === name)?.id;
  if (!id) throw new Error(`Scenario does not contain ${name}.`);
  return NationId.parse(id);
};
const nicaraguaId = nationIdByName('Nicaragua');
const hondurasId = nationIdByName('Honduras');
const guatemalaId = nationIdByName('Guatemala');
const mexicoId = nationIdByName('Mexico');
initial.playerNationId = nicaraguaId;
initial.observerMode = false;
if (!resumeDatabase) store.initialize(initial);
const app = buildServer({
  store,
  services: createAlphaServices(store, {
    directory,
    scenariosDirectory: resolve('data/scenarios'),
  }),
  geography: '{"type":"FeatureCollection","features":[]}',
});

type TurnTrace = {
  modelCalls?: Array<{
    role: string;
    model: string;
    status: string;
    latencyMs: number;
    contextCharacters: number;
  }>;
  failures?: string[];
  intent?: {
    actionGraph?: { actions: Array<{ text: string; action: string }> };
  };
};
type CampaignTurn = {
  order: string;
  date: string;
  statusCode: number;
  commands: string[];
  newNegotiations: Array<{
    topic: string;
    parties: string[];
    status: string;
    sourceBreachId?: string | null;
    responses: Array<{
      nationId: string;
      move: string;
      message: string;
      counterTerms?: string;
      influenceDecision?: InfluenceDecision;
    }>;
    proposedTerms: string[];
  }>;
  modelCalls: TurnTrace['modelCalls'];
  strategicPlans?: Array<{
    nation: string;
    target: string;
    desiredTier: string;
    currentTier: string;
    nextStep: string;
    leverage: number;
    resistance: number;
    reliability: number;
    blockers: string[];
    rejections: string[];
    counteroffers: string[];
  }>;
  failures: string[];
  error?: string;
};

const actorName = (id: string) =>
  store.load().nations.find((nation) => nation.id === id)?.name ?? id;
const previousReport = resumeDatabase
  ? (JSON.parse(readFileSync(resolve(directory, 'report.json'), 'utf8')) as {
      provider?: typeof provider;
      providerHistory?: Array<
        typeof provider & { firstTurn: number; lastTurn: number }
      >;
      campaign?: {
        startDate?: string;
        playerTurns?: CampaignTurn[];
      };
      integrity?: { recoveredAttempts?: CampaignTurn[] };
    })
  : undefined;
if (resumeDatabase && !previousReport?.campaign)
  throw new Error('Resume database has no matching campaign report.');
const recoveredAttempts = [
  ...(previousReport?.integrity?.recoveredAttempts ?? []),
  ...(previousReport?.campaign?.playerTurns?.filter(
    (turn) => turn.statusCode !== 200,
  ) ?? []),
];
const playerTurns: CampaignTurn[] =
  previousReport?.campaign?.playerTurns?.filter(
    (turn) => turn.statusCode === 200,
  ) ?? [];
const previousTurnCount = playerTurns.length;

function advanceDateByMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const targetMonth = month - 1 + months;
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, targetMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

const startingDate = previousReport?.campaign?.startDate ?? store.load().date;
const durationMonths = Number(process.env.MANDATE_PUPPETMASTER_MONTHS ?? 120);
const quality = 'fast' as const;
if (
  !Number.isInteger(durationMonths) ||
  durationMonths < 3 ||
  durationMonths > 120
)
  throw new Error('Expected MANDATE_PUPPETMASTER_MONTHS between 3 and 120.');
const endDate = advanceDateByMonths(startingDate, durationMonths);
const expectedPlayerTurnCount = Math.ceil(
  (Date.parse(endDate) - Date.parse(startingDate)) / (90 * 86_400_000),
);
const campaignErrors: string[] = [];

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

  let index = playerTurns.length;
  while (Date.parse(store.load().date) < Date.parse(endDate)) {
    const before = store.load();
    const remainingDays = Math.max(
      1,
      Math.round((Date.parse(endDate) - Date.parse(before.date)) / 86_400_000),
    );
    const days = Math.min(90, remainingDays);
    const order = orders[index % orders.length]!;
    const payload = {
      expectedRevision: before.revision,
      expectedHash: canonicalHash(before),
      text: order,
      days,
      quality,
    };
    let response = await app.inject({
      method: 'POST',
      url: '/api/play',
      payload,
    });
    let retry = 1;
    while (response.statusCode !== 200 && retry < 3) {
      const error = `${response.statusCode}: ${response.body}`;
      recoveredAttempts.push({
        order,
        date: store.load().date,
        statusCode: response.statusCode,
        commands: [],
        newNegotiations: [],
        modelCalls: [],
        failures: [],
        error,
      });
      console.log(
        JSON.stringify({
          stage: 'real-model-turn-retrying',
          turn: index + 1,
          attempt: retry + 1,
          date: store.load().date,
          error,
        }),
      );
      retry++;
      response = await app.inject({
        method: 'POST',
        url: '/api/play',
        payload,
      });
    }
    const after = store.load();
    if (response.statusCode !== 200) {
      const error = `${response.statusCode}: ${response.body}`;
      campaignErrors.push(error);
      playerTurns.push({
        order,
        date: after.date,
        statusCode: response.statusCode,
        commands: [],
        newNegotiations: [],
        modelCalls: [],
        failures: [],
        error,
      });
      console.log(
        JSON.stringify({
          stage: 'real-model-turn-failed',
          turn: index + 1,
          date: after.date,
          error,
        }),
      );
      break;
    }
    const turn = after.turns.at(-1)!;
    const trace = (store.loadAudit(turn.id) ?? {}) as TurnTrace;
    const existingIds = new Set(before.negotiations.map((entry) => entry.id));
    playerTurns.push({
      order,
      date: after.date,
      statusCode: response.statusCode,
      commands: after.commands
        .filter((record) => record.turnId === turn.id)
        .map((record) => record.command.type),
      newNegotiations: after.negotiations
        .filter((negotiation) => !existingIds.has(negotiation.id))
        .map((negotiation) => ({
          topic: negotiation.topic,
          parties: [
            negotiation.proposerNationId,
            negotiation.recipientNationId,
          ].map(actorName),
          status: negotiation.status,
          ...(negotiation.sourceBreachId !== undefined
            ? { sourceBreachId: negotiation.sourceBreachId }
            : {}),
          responses: negotiation.responses.map((response) => ({
            nationId: actorName(response.nationId),
            move: response.move,
            message: response.message,
            ...(response.counterTerms
              ? { counterTerms: response.counterTerms }
              : {}),
            ...(response.influenceDecision
              ? { influenceDecision: response.influenceDecision }
              : {}),
          })),
          proposedTerms: negotiation.influenceTerms.map((term) => term.kind),
        })),
      modelCalls: trace.modelCalls ?? [],
      strategicPlans: after.nations
        .filter((nation) => [nicaraguaId, mexicoId].includes(nation.id))
        .flatMap((nation) =>
          nation.strategy.influencePlans
            .filter((plan) =>
              [hondurasId, guatemalaId].includes(plan.targetNationId),
            )
            .map((plan) => ({
              nation: nation.name,
              target: actorName(plan.targetNationId),
              desiredTier: plan.desiredTier,
              currentTier: plan.currentTier,
              nextStep: plan.nextStep.rationale,
              leverage: plan.leverage,
              resistance: plan.resistance,
              reliability: plan.patronReliability,
              blockers: plan.blockers,
              rejections: plan.rejectedObligations.map(
                (entry) =>
                  `${entry.date} ${entry.reasonCode}: ${entry.explanation}`,
              ),
              counteroffers: plan.recentCounteroffers.map(
                (entry) => `${entry.date}: ${entry.explanation}`,
              ),
            })),
        ),
      failures: trace.failures ?? [],
    });
    console.log(
      JSON.stringify({
        stage: 'real-model-turn-complete',
        turn: index + 1,
        date: after.date,
        statusCode: response.statusCode,
        commandCount: playerTurns.at(-1)!.commands.length,
        negotiationCount: playerTurns.at(-1)!.newNegotiations.length,
        modelCalls: trace.modelCalls?.length ?? 0,
        failures: trace.failures ?? [],
      }),
    );
    if (after.date === endDate) break;
    index++;
  }

  const providerHistory = [
    ...(previousReport?.providerHistory ??
      (previousReport?.provider
        ? [
            {
              ...previousReport.provider,
              firstTurn: 1,
              lastTurn:
                previousReport.campaign?.playerTurns?.filter(
                  (turn) => turn.statusCode === 200,
                ).length ?? 0,
            },
          ]
        : [])),
  ];
  const completedWithCurrentProvider = playerTurns.length - previousTurnCount;
  if (completedWithCurrentProvider > 0)
    providerHistory.push({
      ...provider,
      firstTurn: previousTurnCount + 1,
      lastTurn: playerTurns.length,
    });

  const world = store.load();
  const profile = (patron: NationId, subject: NationId) => {
    const result = influenceProfile(world, patron, subject);
    return {
      tier: result.tier,
      leverage: result.leverage,
      dependency: result.dependency,
      autonomy: result.autonomy,
      autonomyLevels: result.autonomyLevels,
      resistance: result.resistance,
      defectionRisk: result.defectionRisk,
      sources: result.sources,
      activeTerms: result.activeTerms.map((term) => ({
        kind: term.kind,
        status: term.status,
      })),
    };
  };
  const campaignNegotiations = world.negotiations.map((negotiation) => ({
    topic: negotiation.topic,
    parties: [negotiation.proposerNationId, negotiation.recipientNationId].map(
      actorName,
    ),
    status: negotiation.status,
    ...(negotiation.sourceBreachId !== undefined
      ? { sourceBreachId: negotiation.sourceBreachId }
      : {}),
    responses: negotiation.responses.map((response) => ({
      nationId: actorName(response.nationId),
      move: response.move,
      message: response.message,
      ...(response.counterTerms ? { counterTerms: response.counterTerms } : {}),
      ...(response.influenceDecision
        ? { influenceDecision: response.influenceDecision }
        : {}),
    })),
    proposedTerms: negotiation.influenceTerms.map((term) => term.kind),
  }));
  const treatyEvidence = world.treaties
    .filter(
      (treaty) =>
        [nicaraguaId, mexicoId].some((patron) =>
          treaty.parties.includes(patron),
        ) &&
        [hondurasId, guatemalaId].some((id) => treaty.parties.includes(id)),
    )
    .map((treaty) => ({
      name: treaty.name,
      status: treaty.status,
      parties: treaty.parties.map(actorName),
      terms: treaty.influenceTerms.map((term) => ({
        patron: actorName(term.patronNationId),
        subject: actorName(term.subjectNationId),
        kind: term.kind,
        status: term.status,
        arrears: term.arrears,
      })),
      breaches: treaty.breaches.map((breach) => ({
        date: breach.date,
        obligationKey: breach.obligationKey,
        firstMissedDate: breach.firstMissedDate,
        lastMissedDate: breach.lastMissedDate,
        missedInstallments: breach.missedInstallments,
        arrearsAmount: breach.arrearsAmount,
        durationMonths: breach.durationMonths,
        severity: breach.severity,
        milestones: breach.milestones,
        violator: actorName(breach.violatingNationId),
        injured: actorName(breach.injuredNationId),
        reason: breach.reason,
        status: breach.status,
      })),
      enforcement: treaty.enforcements.map((action) => ({
        actingNation: action.actingNationId
          ? actorName(action.actingNationId)
          : null,
        date: action.date,
        action: action.action,
        result: action.result,
      })),
    }));
  const responseMoves = campaignNegotiations.flatMap((negotiation) =>
    negotiation.responses.map((response) => response.move),
  );
  const report = {
    method: `Real-model quarterly player turns through Fastify POST /api/play from the unmodified regional scenario for ${durationMonths} months. Nicaragua forms CAEU through its first player order; no rival links, offers, membership, breach, acceptance or final tier are injected.`,
    provider,
    providerHistory,
    campaign: {
      scenario: world.scenario.name,
      player: actorName(nicaraguaId),
      targets: [actorName(hondurasId), actorName(guatemalaId)],
      startDate: startingDate,
      targetEndDate: endDate,
      actualEndDate: world.date,
      quality,
      elapsedMonths:
        Math.round(
          ((Date.parse(world.date) - Date.parse(startingDate)) /
            86_400_000 /
            30.4375) *
            10,
        ) / 10,
      playerTurns,
      strategyHistory: playerTurns.flatMap((turn) =>
        (turn.strategicPlans ?? []).map((plan) => ({
          date: turn.date,
          ...plan,
        })),
      ),
      relationshipSnapshots: {
        nicaraguaHonduras: profile(nicaraguaId, hondurasId),
        nicaraguaGuatemala: profile(nicaraguaId, guatemalaId),
        mexicoHonduras: profile(mexicoId, hondurasId),
        mexicoGuatemala: profile(mexicoId, guatemalaId),
      },
      organization: world.organizations
        .filter(
          (organization) =>
            organization.acronym === 'CAEU' ||
            organization.name === 'Central American Economic Union',
        )
        .map((organization) => ({
          members: organization.members.map(actorName),
          development: organization.development,
        })),
      regionalAutonomyInitiatives: world.initiatives
        .filter(
          (initiative) =>
            [hondurasId, guatemalaId].includes(initiative.nationId) &&
            initiative.name.startsWith('Strategic autonomy:'),
        )
        .map((initiative) => ({
          nation: actorName(initiative.nationId),
          name: initiative.name,
          status: initiative.status,
          startDate: initiative.startDate,
          completedDate: initiative.completedDate,
        })),
      negotiations: campaignNegotiations,
      treaties: treatyEvidence,
      crises: world.crises
        .filter((crisis) =>
          crisis.participants.some((id) =>
            [hondurasId, guatemalaId, mexicoId, nicaraguaId].includes(id),
          ),
        )
        .map((crisis) => ({
          type: crisis.type,
          status: crisis.status,
          participants: crisis.participants.map(actorName),
          demands: crisis.demands.map((demand) => ({
            nation: actorName(demand.nationId),
            text: demand.text,
          })),
        })),
      observedResponseMoves: {
        accepted: responseMoves.filter((move) => move === 'accept').length,
        rejected: responseMoves.filter((move) => move === 'reject').length,
        countered: responseMoves.filter((move) => move === 'counter').length,
        delayed: responseMoves.filter((move) => move === 'delay').length,
        ignored: responseMoves.filter((move) => move === 'ignore').length,
      },
    },
    integrity: {
      expectedPlayerTurnCount,
      allPlayerTurnsSucceeded:
        playerTurns.length === expectedPlayerTurnCount &&
        playerTurns.every((turn) => turn.statusCode === 200),
      reachedTargetDate: world.date === endDate,
      campaignErrors,
      recoveredAttempts,
      modelCallCount: playerTurns.reduce(
        (sum, turn) => sum + (turn.modelCalls?.length ?? 0),
        0,
      ),
      apiErrors: playerTurns.flatMap((turn) =>
        turn.error ? [turn.error] : [],
      ),
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
        campaign: {
          startDate: startingDate,
          actualEndDate: world.date,
          elapsedMonths: report.campaign.elapsedMonths,
          turns: playerTurns.length,
          expectedPlayerTurnCount,
          allPlayerTurnsSucceeded: report.integrity.allPlayerTurnsSucceeded,
          reachedTargetDate: report.integrity.reachedTargetDate,
          modelCallCount: report.integrity.modelCallCount,
          modelsByRole: playerTurns
            .flatMap((turn) => turn.modelCalls ?? [])
            .reduce(
              (counts, call) => {
                const key = `${call.role}:${call.model}`;
                counts[key] = (counts[key] ?? 0) + 1;
                return counts;
              },
              {} as Record<string, number>,
            ),
        },
        rivalry: {
          Honduras: {
            Nicaragua:
              report.campaign.relationshipSnapshots.nicaraguaHonduras.tier,
            Mexico:
              report.campaign.relationshipSnapshots.mexicoHonduras.leverage,
          },
          Guatemala: {
            Nicaragua:
              report.campaign.relationshipSnapshots.nicaraguaGuatemala.tier,
            Mexico:
              report.campaign.relationshipSnapshots.mexicoGuatemala.leverage,
          },
          observedResponseMoves: report.campaign.observedResponseMoves,
        },
        playerTurns: playerTurns.map((turn) => ({
          date: turn.date,
          statusCode: turn.statusCode,
          commands: turn.commands,
          negotiations: turn.newNegotiations.length,
          modelCalls: turn.modelCalls?.length ?? 0,
          failures: turn.failures,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  store.close();
}
