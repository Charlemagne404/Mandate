import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { influenceProfile } from '@mandate/core';
import { createAlphaServices } from '../apps/server/src/alpha.js';
import { buildServer } from '../apps/server/src/app.js';
import { canonicalHash, openWorldStore } from '@mandate/persistence';
import { loadScenario } from '@mandate/scenarios';
import {
  EconomicLink,
  InfluenceTerm,
  NationId,
  Negotiation,
  Organization,
} from '@mandate/schemas';
import { inferenceOptions } from './inference-options.js';

const orders = [
  'Invite Honduras and Guatemala to join the existing CAEU. Offer practical economic integration, regular support, energy cooperation and infrastructure links while allowing each government to decide independently.',
  'Negotiate with Honduras and Guatemala to deepen CAEU trade and energy integration. Offer infrastructure investment and preferential access in return for durable cooperation.',
  'Nicaragua wants Honduras and Guatemala to coordinate major foreign policy decisions with us. Offer a reciprocal, binding alignment agreement and security support, and explain the benefits.',
  'A rival patron has a stronger economic offer on the table. Defend Nicaragua’s position with better energy prices, market access, debt relief or infrastructure offers to Honduras and Guatemala where affordable. Let both governments compare the alternatives.',
  'Ask Honduras whether it will accept stronger Nicaraguan security cooperation and foreign-policy alignment. Preserve existing accepted terms and offer narrower terms if a full package is rejected.',
  'Make a conditional offer to Guatemala: relieve part of its debt and expand CAEU subsidies if it accepts agreed limits on rival security and economic treaties.',
  'Review all Nicaragua-Honduras and Nicaragua-Guatemala obligations. Address arrears, deliver promised support and renegotiate terms that create too much resistance.',
  'Counter the rival patron’s growing regional influence with a CAEU infrastructure and energy package, and invite Honduras and Guatemala to discuss whether existing treaty obligations limit rival security agreements.',
  'Propose that Honduras and Guatemala support Nicaragua’s next major diplomatic initiative under our existing agreements. If either refuses, use proportionate diplomatic or economic enforcement before considering force.',
  'Continue building a durable Central American sphere through consent, investment, and enforceable agreements. Keep Honduras and Guatemala independent and make no territorial demands.',
];

const options = await inferenceOptions();
if (!options.selected || options.selected.kind === 'fake')
  throw new Error('No reachable configured real model is available.');

const config = {
  ...options.selected,
  maxCalls: Math.max(options.selected.maxCalls ?? 0, 40),
  timeoutMs: Math.max(options.selected.timeoutMs, 180_000),
  maxTurnMs: Math.max(options.selected.maxTurnMs, 600_000),
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
if (
  !initial.organizations.some((organization) => organization.acronym === 'CAEU')
)
  initial.organizations.push(
    Organization.parse({
      id: 'organization:caeu',
      name: 'Central American Economic Union',
      acronym: 'CAEU',
      kind: 'economic-union',
      foundingDate: initial.date,
      founders: [nicaraguaId],
      members: [nicaraguaId],
      purpose:
        'Central American economic integration with voluntary member participation.',
      charter:
        'Founded by Nicaragua as the controlled campaign starting institution; each prospective member makes an independent decision.',
      geographicScope: 'Central America',
      history: [
        {
          id: `organization:caeu-${initial.date}-0`,
          date: initial.date,
          actorNationId: nicaraguaId,
          kind: 'founded',
          description:
            'The campaign starts with Nicaragua as the founding member of the CAEU.',
        },
      ],
    }),
  );
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
    responses: Array<{ nationId: string; move: string; message: string }>;
    proposedTerms: string[];
  }>;
  modelCalls: TurnTrace['modelCalls'];
  failures: string[];
  error?: string;
};

const actorName = (id: string) =>
  store.load().nations.find((nation) => nation.id === id)?.name ?? id;
const controlledRivalIntervention = {
  date: '',
  purpose:
    'Controlled evaluation starting condition: Mexico already has modest market, energy, finance, and infrastructure ties to Honduras and Guatemala, then opens structured subsidy, energy, infrastructure, market-access and security offers. This introduces a plausible competing patron; no offer acceptance or final relationship outcome is scripted.',
  linkIds: [
    'economic:mexico-honduras-contest',
    'economic:mexico-guatemala-contest',
  ],
  negotiationIds: [
    'negotiation:mexico-honduras-contest',
    'negotiation:mexico-guatemala-contest',
  ],
};
const previousReport = resumeDatabase
  ? (JSON.parse(readFileSync(resolve(directory, 'report.json'), 'utf8')) as {
      provider?: typeof provider;
      providerHistory?: Array<
        typeof provider & { firstTurn: number; lastTurn: number }
      >;
      campaign?: {
        startDate?: string;
        playerTurns?: CampaignTurn[];
        controlledRivalIntervention?: typeof controlledRivalIntervention;
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
if (previousReport?.campaign?.controlledRivalIntervention)
  controlledRivalIntervention.date =
    previousReport.campaign.controlledRivalIntervention.date;

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

function addDays(date: string, days: number) {
  return new Date(Date.parse(date) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function injectControlledRivalCompetition() {
  const before = store.load();
  const links = [
    EconomicLink.parse({
      id: controlledRivalIntervention.linkIds[0],
      dependentNationId: hondurasId,
      partnerNationId: mexicoId,
      imports: 24,
      exports: 18,
      energy: 28,
      strategicGoods: 8,
      finance: 20,
      infrastructure: 18,
      alternatives: 32,
    }),
    EconomicLink.parse({
      id: controlledRivalIntervention.linkIds[1],
      dependentNationId: guatemalaId,
      partnerNationId: mexicoId,
      imports: 21,
      exports: 16,
      energy: 22,
      strategicGoods: 9,
      finance: 24,
      infrastructure: 20,
      alternatives: 36,
    }),
  ];
  const offers = [hondurasId, guatemalaId].map((subjectNationId, index) =>
    Negotiation.parse({
      id: controlledRivalIntervention.negotiationIds[index],
      proposerNationId: mexicoId,
      recipientNationId: subjectNationId,
      topic: 'Mexican regional investment and security offer',
      kind: 'influence',
      terms:
        'Mexico offers a recurring subsidy, energy cooperation, infrastructure finance, preferential market access and a security guarantee. The recipient government decides independently whether to accept or counter.',
      createdDate: before.date,
      expiresDate: addDays(before.date, 730),
      influenceTerms: [
        InfluenceTerm.parse({
          kind: 'subsidy',
          patronNationId: mexicoId,
          subjectNationId,
          amount: 6,
        }),
        InfluenceTerm.parse({
          kind: 'energy-supply',
          patronNationId: mexicoId,
          subjectNationId,
        }),
        InfluenceTerm.parse({
          kind: 'infrastructure-investment',
          patronNationId: mexicoId,
          subjectNationId,
          amount: 5,
        }),
        InfluenceTerm.parse({
          kind: 'preferential-trade',
          patronNationId: mexicoId,
          subjectNationId,
        }),
        InfluenceTerm.parse({
          kind: 'security-guarantee',
          patronNationId: mexicoId,
          subjectNationId,
        }),
      ],
    }),
  );
  store.commit({
    expectedRevision: before.revision,
    expectedHash: canonicalHash(before),
    action: {
      actorNationId: mexicoId,
      source: 'system',
      text: controlledRivalIntervention.purpose,
    },
    commands: [
      ...links.map((link, index) => ({
        id: `command:${runId}-mexico-rival-link-${index + 1}`,
        reason:
          'Seed a bounded rival-patron economic relationship for a controlled competition scenario.',
        command: { type: 'SET_ECONOMIC_LINK' as const, link },
      })),
      ...offers.map((negotiation, index) => ({
        id: `command:${runId}-mexico-rival-offer-${index + 1}`,
        reason:
          'Open a valid structured Mexico offer; allow each subject to accept, reject or counter through the real model.',
        command: { type: 'OPEN_NEGOTIATION' as const, negotiation },
      })),
    ],
  });
  controlledRivalIntervention.date = store.load().date;
  console.log(
    JSON.stringify({
      stage: 'controlled-rival-patron-offers-opened',
      date: controlledRivalIntervention.date,
      patron: 'Mexico',
      recipients: ['Honduras', 'Guatemala'],
    }),
  );
}

const startingDate = previousReport?.campaign?.startDate ?? store.load().date;
const endDate = advanceDateByMonths(startingDate, 120);
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
    if (index === 12 && !controlledRivalIntervention.date)
      injectControlledRivalCompetition();
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
      quality: 'balanced' as const,
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
          responses: negotiation.responses.map((response) => ({
            nationId: actorName(response.nationId),
            move: response.move,
            message: response.message,
          })),
          proposedTerms: negotiation.influenceTerms.map((term) => term.kind),
        })),
      modelCalls: trace.modelCalls ?? [],
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
    responses: negotiation.responses.map((response) => ({
      nationId: actorName(response.nationId),
      move: response.move,
      message: response.message,
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
        violator: actorName(breach.violatingNationId),
        injured: actorName(breach.injuredNationId),
        reason: breach.reason,
        status: breach.status,
      })),
      enforcement: treaty.enforcements.map((action) => ({
        action: action.action,
        result: action.result,
      })),
    }));
  const controlledRivalLinks = world.economicLinks
    .filter((link) => controlledRivalIntervention.linkIds.includes(link.id))
    .map((link) => ({
      dependent: actorName(link.dependentNationId),
      partner: actorName(link.partnerNationId),
      imports: link.imports,
      exports: link.exports,
      energy: link.energy,
      finance: link.finance,
      infrastructure: link.infrastructure,
      alternatives: link.alternatives,
    }));
  const responseMoves = campaignNegotiations.flatMap((negotiation) =>
    negotiation.responses.map((response) => response.move),
  );
  const report = {
    method:
      'Real-model quarterly player turns through Fastify POST /api/play, with a controlled rival-patron economic-link and structured-offer intervention after month 36. No final tier, acceptance, breach, or defection outcome is scripted.',
    provider,
    providerHistory,
    campaign: {
      scenario: world.scenario.name,
      player: actorName(nicaraguaId),
      targets: [actorName(hondurasId), actorName(guatemalaId)],
      startDate: startingDate,
      targetEndDate: endDate,
      actualEndDate: world.date,
      elapsedMonths:
        Math.round(
          ((Date.parse(world.date) - Date.parse(startingDate)) /
            86_400_000 /
            30.4375) *
            10,
        ) / 10,
      playerTurns,
      controlledRivalIntervention,
      rivalEconomicLinks: controlledRivalLinks,
      relationshipSnapshots: {
        nicaraguaHonduras: profile(nicaraguaId, hondurasId),
        nicaraguaGuatemala: profile(nicaraguaId, guatemalaId),
        mexicoHonduras: profile(mexicoId, hondurasId),
        mexicoGuatemala: profile(mexicoId, guatemalaId),
      },
      organization: world.organizations
        .filter((organization) => organization.acronym === 'CAEU')
        .map((organization) => ({
          members: organization.members.map(actorName),
          development: organization.development,
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
