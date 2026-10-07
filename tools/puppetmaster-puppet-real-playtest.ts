import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildInfluenceStrategyPlan, influenceProfile } from '@mandate/core';
import { createAlphaServices } from '../apps/server/src/alpha.js';
import { buildServer } from '../apps/server/src/app.js';
import { canonicalHash, openWorldStore } from '@mandate/persistence';
import { loadScenario } from '@mandate/scenarios';
import {
  EconomicLink,
  InfluenceTerm,
  NationId,
  Relation,
  Strategy,
  Treaty,
} from '@mandate/schemas';
import type { InfluenceDecision } from '@mandate/schemas';
import { inferenceOptions } from './inference-options.js';

const options = await inferenceOptions();
if (!options.selected || options.selected.kind === 'fake')
  throw new Error('Favorable Puppet State test requires a real local model.');
const discoveredQwen3 = options.report.configured.some(
  (entry) =>
    entry.ok &&
    entry.kind === options.selected!.kind &&
    entry.models.includes('qwen3:4b-instruct'),
);
const model = discoveredQwen3 ? 'qwen3:4b-instruct' : options.selected.model;
const config = {
  ...options.selected,
  model,
  highImportanceModel: model,
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
    )?.source ?? 'configured real provider',
  endpoint: new URL(config.baseUrl ?? 'http://127.0.0.1:11434').origin,
};
const runId = `puppetmaster-favorable-real-${new Date()
  .toISOString()
  .replaceAll(/[^0-9]/g, '')
  .slice(0, 14)}`;
const directory = resolve('.runtime/evaluation', runId);
mkdirSync(directory, { recursive: true });
const store = openWorldStore({
  filename: resolve(directory, 'world.sqlite'),
  migrationsDirectory: resolve('packages/persistence/migrations'),
});
const initial = loadScenario(resolve('data/scenarios/global-regional.json'));
const idFor = (name: string) => {
  const id = initial.nations.find((nation) => nation.name === name)?.id;
  if (!id) throw new Error(`Scenario does not contain ${name}.`);
  return NationId.parse(id);
};
const nicaragua = idFor('Nicaragua');
const honduras = idFor('Honduras');
initial.playerNationId = nicaragua;
// Both sides must deliberate autonomously; the test does not install the final
// concessions or hand the treaty to the subject as a player order.
initial.observerMode = true;
const patron = initial.nations.find((nation) => nation.id === nicaragua)!;
const subject = initial.nations.find((nation) => nation.id === honduras)!;
patron.stats.treasury = Math.max(patron.stats.treasury, 500);
subject.stats.stability = 20;
subject.stats.legitimacy = 20;
subject.stats.military = 20;
subject.stats.unrest = 0;
subject.stats.debt = Math.max(subject.stats.debt, 150);
subject.stats.energyExposure = 85;
const relationPair = [nicaragua, honduras].sort() as [NationId, NationId];
const relation = initial.relations.find(
  (entry) =>
    entry.nationA === relationPair[0] && entry.nationB === relationPair[1],
);
if (relation) {
  relation.score = 92;
  relation.trust = 92;
} else
  initial.relations.push(
    Relation.parse({
      nationA: relationPair[0],
      nationB: relationPair[1],
      score: 92,
      trust: 92,
    }),
  );
const favorableLink = EconomicLink.parse({
  id: 'economic:favorable-honduras-nicaragua',
  dependentNationId: honduras,
  partnerNationId: nicaragua,
  imports: 100,
  exports: 95,
  energy: 100,
  strategicGoods: 95,
  finance: 100,
  infrastructure: 100,
  alternatives: 0,
});
const existingFavorableLink = initial.economicLinks.find(
  (link) =>
    link.dependentNationId === honduras && link.partnerNationId === nicaragua,
);
if (existingFavorableLink) Object.assign(existingFavorableLink, favorableLink);
else initial.economicLinks.push(favorableLink);
const establishedKinds = [
  'foreign-policy-consultation',
  'foreign-policy-alignment',
  'support-diplomatic-initiatives',
  'no-rival-alliance',
  'foreign-policy-veto',
  'security-guarantee',
  'join-defensive-wars',
  'war-declaration-approval',
  'no-war-against-patron',
  'military-access',
  'preferential-trade',
  'exclusive-market-access',
  'subsidy',
] as const;
const treaty = Treaty.parse({
  id: 'treaty:favorable-honduras-partnership',
  name: 'Honduras–Nicaragua strategic partnership',
  kind: 'influence',
  parties: [nicaragua, honduras],
  status: 'active',
  ratifiedDate: initial.date,
  terms:
    'A voluntary existing partnership with delivered trade and security benefits, consultation and alignment; no patron veto or obligation to join patron wars has been accepted.',
  influenceTerms: establishedKinds.map((kind) =>
    InfluenceTerm.parse({
      kind,
      patronNationId: nicaragua,
      subjectNationId: honduras,
      ...(kind === 'subsidy'
        ? {
            amount: 1,
            paidAmount: 8,
            paymentsMade: 8,
            lastPaymentDate: initial.date,
          }
        : {}),
    }),
  ),
});
initial.treaties.push(treaty);
const seededAuthorityClauses = new Set(
  treaty.influenceTerms
    .filter((term) =>
      [
        'foreign-policy-veto',
        'join-patron-wars',
        'war-declaration-approval',
        'no-war-against-patron',
        'military-access',
        'no-rival-alliance',
      ].includes(term.kind),
    )
    .map((term) => term.kind),
);
const startingProfile = influenceProfile(initial, nicaragua, honduras);
const missingBefore = startingProfile.puppetRequirements
  .filter((requirement) => !requirement.fulfilled)
  .map((requirement) => requirement.key);
const plan = buildInfluenceStrategyPlan(
  initial,
  nicaragua,
  honduras,
  'PUPPET STATE',
);
// Make the persistent plan eligible for its first review immediately. The
// scheduler still decides whether a proposal is made and the target model
// still decides whether to accept, counter, or reject it.
plan.reviewedDate = new Date(Date.parse(initial.date) - 200 * 86_400_000)
  .toISOString()
  .slice(0, 10);
patron.strategy = Strategy.parse({
  ...patron.strategy,
  influencePlans: [plan],
});
store.initialize(initial);
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
  }>;
  failures?: string[];
};
const turns: Array<Record<string, unknown>> = [];
const negotiationEvidence: Array<Record<string, unknown>> = [];
const maxTurns = Number(
  process.argv.find((argument) => argument.startsWith('--turns='))?.slice(8) ??
    24,
);
if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 60)
  throw new Error('Expected --turns between 1 and 60.');

try {
  if (startingProfile.tier !== 'SUBJECT STATE')
    throw new Error(
      `Favorable setup reached ${startingProfile.tier}; it must begin at SUBJECT STATE.`,
    );
  if (missingBefore.length !== 1 || !missingBefore.includes('join-patron-wars'))
    throw new Error(
      `Favorable setup must leave only model-negotiated Puppet State clauses; remaining: ${missingBefore.join(', ')}`,
    );
  if (
    plan.nextStep.requestedTerms.length !== 1 ||
    !missingBefore.includes(plan.nextStep.requestedTerms[0]!)
  )
    throw new Error(
      `The persistent strategy did not request one eligible missing clause: ${JSON.stringify(plan.nextStep)}`,
    );
  const configured = await app.inject({
    method: 'POST',
    url: '/api/settings',
    payload: config,
  });
  if (configured.statusCode !== 200)
    throw new Error(`Could not configure the real model: ${configured.body}`);
  const health = await app.inject({
    method: 'POST',
    url: '/api/provider/health',
  });
  if (!health.json<{ ok: boolean }>().ok)
    throw new Error(`The selected real model is not healthy: ${health.body}`);

  let attempts = 0;
  let committedTurns = 0;
  let consecutiveNoOps = 0;
  while (committedTurns < maxTurns && attempts < maxTurns + 8) {
    attempts++;
    const before = store.load();
    const existingNegotiations = new Map(
      before.negotiations.map((entry) => [entry.id, entry.responses.length]),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/autoplay',
      payload: {
        expectedRevision: before.revision,
        expectedHash: canonicalHash(before),
        turns: 1,
        days: 30,
        quality: 'balanced',
      },
    });
    if (response.statusCode !== 200) {
      turns.push({
        turn: attempts,
        date: before.date,
        statusCode: response.statusCode,
        committed: false,
        error: response.body,
      });
      break;
    }
    const after = store.load();
    if (after.revision === before.revision) {
      consecutiveNoOps++;
      turns.push({
        turn: attempts,
        date: before.date,
        statusCode: response.statusCode,
        committed: false,
        noOpReason:
          'The autoplay endpoint returned success without committing a new world revision.',
        consecutiveNoOps,
      });
      process.stdout.write(
        `${JSON.stringify({
          stage: 'favorable-puppet-no-commit',
          attempt: attempts,
          date: before.date,
          consecutiveNoOps,
        })}\n`,
      );
      if (consecutiveNoOps >= 3) break;
      continue;
    }
    committedTurns++;
    consecutiveNoOps = 0;
    const committedTurn = after.turns.at(-1)!;
    const trace = (store.loadAudit(committedTurn.id) ?? {}) as TurnTrace;
    const responses = after.negotiations.flatMap((negotiation) => {
      const priorCount = existingNegotiations.get(negotiation.id) ?? 0;
      return negotiation.responses.slice(priorCount).map((move) => ({
        negotiationId: negotiation.id,
        topic: negotiation.topic,
        status: negotiation.status,
        proposer: after.nations.find(
          (nation) => nation.id === negotiation.proposerNationId,
        )?.name,
        recipient: after.nations.find(
          (nation) => nation.id === negotiation.recipientNationId,
        )?.name,
        sourceBreachId: negotiation.sourceBreachId,
        move: move.move,
        message: move.message,
        influenceDecision: move.influenceDecision as
          InfluenceDecision | undefined,
        proposedTerms: negotiation.influenceTerms.map((term) => term.kind),
      }));
    });
    negotiationEvidence.push(...responses);
    const profile = influenceProfile(after, nicaragua, honduras);
    const record = {
      turn: attempts,
      committed: true,
      date: after.date,
      statusCode: response.statusCode,
      tier: profile.tier,
      leverage: profile.leverage,
      resistance: profile.resistance,
      reliability: profile.reliability,
      missingPuppetRequirements: profile.puppetRequirements
        .filter((requirement) => !requirement.fulfilled)
        .map((requirement) => requirement.key),
      newNegotiationResponses: responses,
      modelCalls: trace.modelCalls ?? [],
      failures: trace.failures ?? [],
    };
    turns.push(record);
    process.stdout.write(
      `${JSON.stringify({ stage: 'favorable-puppet-turn', ...record })}\n`,
    );
    if (profile.tier === 'PUPPET STATE') break;
  }

  const finalWorld = store.load();
  const finalProfile = influenceProfile(finalWorld, nicaragua, honduras);
  const report = {
    recordedAt: new Date().toISOString(),
    methodology:
      'Fresh regional world with an established SUBJECT STATE relationship. It has an accepted foreign-policy veto and eight recorded, fulfilled subsidy installments, while the binding obligation to join patron wars is absent. The remaining Puppet State clause is not added by the harness; autonomous governments deliberate through the configured real provider and the ordinary negotiation/consent/commit path.',
    provider,
    setup: {
      date: initial.date,
      patron: patron.name,
      subject: subject.name,
      tier: startingProfile.tier,
      leverage: startingProfile.leverage,
      resistance: startingProfile.resistance,
      reliability: startingProfile.reliability,
      targetDebt: subject.stats.debt,
      targetEnergyExposure: subject.stats.energyExposure,
      missingPuppetRequirements: missingBefore,
      strategyNextStep: plan.nextStep,
      existingAcceptedClauses: establishedKinds,
      seededPuppetTreaty: false,
    },
    result: {
      date: finalWorld.date,
      elapsedMonths:
        Math.round(
          ((Date.parse(finalWorld.date) - Date.parse(initial.date)) /
            86_400_000 /
            30.4375) *
            10,
        ) / 10,
      tier: finalProfile.tier,
      achievedPuppetState: finalProfile.tier === 'PUPPET STATE',
      missingPuppetRequirements: finalProfile.puppetRequirements
        .filter((requirement) => !requirement.fulfilled)
        .map((requirement) => requirement.key),
      activeHighAuthorityClauses: finalWorld.treaties
        .filter(
          (entry) =>
            entry.status === 'active' &&
            entry.parties.includes(nicaragua) &&
            entry.parties.includes(honduras),
        )
        .flatMap((entry) => entry.influenceTerms)
        .filter(
          (term) =>
            term.status === 'active' &&
            [
              'foreign-policy-veto',
              'join-patron-wars',
              'war-declaration-approval',
              'no-war-against-patron',
              'military-access',
              'no-rival-alliance',
            ].includes(term.kind),
        )
        .map((term) => term.kind),
      newlyAcceptedHighAuthorityClauses: finalWorld.treaties
        .filter(
          (entry) =>
            entry.status === 'active' &&
            entry.parties.includes(nicaragua) &&
            entry.parties.includes(honduras),
        )
        .flatMap((entry) => entry.influenceTerms)
        .filter(
          (term) =>
            !seededAuthorityClauses.has(term.kind) &&
            term.status === 'active' &&
            [
              'foreign-policy-veto',
              'join-patron-wars',
              'war-declaration-approval',
              'no-war-against-patron',
              'military-access',
              'no-rival-alliance',
            ].includes(term.kind),
        )
        .map((term) => term.kind),
      treaties: finalWorld.treaties
        .filter(
          (entry) =>
            entry.parties.includes(nicaragua) &&
            entry.parties.includes(honduras),
        )
        .map((entry) => ({
          name: entry.name,
          status: entry.status,
          clauses: entry.influenceTerms.map((term) => ({
            kind: term.kind,
            status: term.status,
          })),
        })),
    },
    turns,
    negotiationEvidence,
    integrity: {
      attempts,
      committedTurns,
      noOpTurns: turns.filter((turn) => 'noOpReason' in turn).length,
      modelCallCount: turns.reduce(
        (sum, turn) =>
          sum +
          (turn.committed === true
            ? ((turn.modelCalls as Array<unknown> | undefined)?.length ?? 0)
            : 0),
        0,
      ),
      failedTurns: turns.filter((turn) => turn.statusCode !== 200).length,
    },
    database: resolve(directory, 'world.sqlite'),
    canonicalHash: canonicalHash(finalWorld),
  };
  const output = resolve(directory, 'report.json');
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        output,
        provider,
        setup: report.setup,
        result: report.result,
        integrity: report.integrity,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await app.close();
  store.close();
}
