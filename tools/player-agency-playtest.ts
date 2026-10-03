import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  analyzeWorldBehavior,
  deterministicPlayerIntent,
  scorePlayerAgency,
} from '@mandate/ai';
import { loadScenario } from '@mandate/scenarios';
import { createProvider, ProviderConfig } from '../packages/ai/src/index.js';
import type { PlayerExecution } from '../packages/ai/src/player-executor.js';
import { canonicalHash, openWorldStore } from '@mandate/persistence';
import { createAlphaServices } from '../apps/server/src/alpha.js';
import { buildServer } from '../apps/server/src/app.js';
import { inferenceOptions } from './inference-options.js';

const scenarioPath = resolve('data/scenarios/nordic-strategy.json');
const directory = resolve('.runtime/evaluation/player-agency-real');
mkdirSync(directory, { recursive: true });
const model =
  process.argv.find((arg) => arg.startsWith('--model='))?.slice(8) ??
  'qwen3:4b-instruct';
const options = await inferenceOptions();
if (!options.selected || options.selected.kind !== 'ollama')
  throw new Error(
    'A reachable local Ollama model is required for this playtest.',
  );
const config = ProviderConfig.parse({
  ...options.selected,
  model,
  temperature: 0,
  retries: 0,
  timeoutMs: 180000,
  // The compact workflow caps output at 400 tokens; keep a clear prompt margin.
  contextTokens: 8192,
  contextBudget: 24000,
  workflow: 'compact',
  concurrency: 1,
  maxCalls: 48,
  maxBackgroundPlanners: 2,
  maxTurnMs: 600000,
  maxRepairs: 1,
});
const provider = createProvider(config);
const health = await provider.health();
if (!health.ok || !health.models.includes(model))
  throw new Error(`Local model ${model} is unavailable: ${health.message}`);

const campaigns = {
  chaos: [
    'Annex Finland.',
    "Demand Norway support Sweden's annexation policy.",
    'Mobilize the entire military.',
    'Double defense spending.',
    'Threaten sanctions on Denmark.',
    'Invade Finland.',
    'Pursue the war against Finland.',
    "Attempt to negotiate Finland's surrender.",
    'Pull out of the war NOW.',
    'Break our treaty with France.',
    'Reverse our annexation policy.',
  ],
  normal: [
    'Propose a nonaggression pact with Norway.',
    'Over the next five years, invest in domestic nuclear energy.',
    'Discuss closer defense cooperation with Finland.',
    'Develop manufacturing capacity gradually.',
    'Reduce military spending by 10%.',
    'Continue the existing energy program if it is progressing; avoid duplicate spending.',
    'Offer Finland a trade agreement to improve energy resilience.',
    'Explore diplomatic consultation with Denmark while maintaining regional stability.',
  ],
} as const;

type Audit = {
  failures?: string[];
  modelCalls?: unknown[];
  plans?: Array<{
    nationId: string;
    stance: string;
    priorities: string[];
    intentions: string[];
  }>;
  moves?: Array<{
    nationId: string;
    recipientNationId: string;
    move: string;
    message: string;
  }>;
  playerExecution?: PlayerExecution | null;
};
const records: Record<string, unknown[]> = { chaos: [], normal: [] };
const reportPath = resolve(directory, 'player-agency.json');
const coverage = { actions: 0, majorClauses: 0, representedClauses: 0 };
const checkpoint = () =>
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        realModel: true,
        workflow: config.workflow,
        provider: provider.id,
        model,
        scenario: 'Nordic Crossroads',
        player: 'Sweden',
        settings: { ...config, apiKey: undefined },
        evaluationMetrics: {
          majorIntentClauseCoveragePercent: coverage.majorClauses
            ? (100 * coverage.representedClauses) / coverage.majorClauses
            : 100,
          actionsWithMajorIntent: coverage.actions,
          majorIntentClauses: coverage.majorClauses,
          representedMajorIntentClauses: coverage.representedClauses,
        },
        campaigns: records,
      },
      null,
      2,
    ) + '\n',
  );

for (const [campaignName, actions] of Object.entries(campaigns)) {
  const campaignDirectory = resolve(directory, campaignName);
  rmSync(campaignDirectory, { recursive: true, force: true });
  mkdirSync(campaignDirectory, { recursive: true });
  const store = openWorldStore({
    filename: resolve(campaignDirectory, 'world.sqlite'),
    migrationsDirectory: resolve('packages/persistence/migrations'),
  });
  store.initialize(loadScenario(scenarioPath));
  const services = createAlphaServices(store, {
    directory: campaignDirectory,
    scenariosDirectory: resolve('data/scenarios'),
  });
  const app = buildServer({
    store,
    services,
    geography: '{"type":"FeatureCollection","features":[]}',
  });
  const settings = await app.inject({
    method: 'POST',
    url: '/api/settings',
    payload: config,
  });
  if (settings.statusCode !== 200)
    throw new Error(
      `Could not configure real-model playtest: ${settings.body}`,
    );
  for (const [index, action] of actions.entries()) {
    const before = store.load();
    const response = await app.inject({
      method: 'POST',
      url: '/api/play',
      payload: {
        expectedRevision: before.revision,
        expectedHash: canonicalHash(before),
        text: action,
        days: 30,
        quality: 'fast',
      },
    });
    const after = store.load();
    const turn =
      response.statusCode === 200 && after.revision > before.revision
        ? after.turns.at(-1)
        : undefined;
    const audit = (turn ? store.loadAudit(turn.id) : null) as Audit | null;
    const expectedIntent = deterministicPlayerIntent(before, {
      actorNationId: before.playerNationId,
      text: action,
    });
    const agencyScore = audit?.playerExecution
      ? scorePlayerAgency(expectedIntent, audit.playerExecution, before, after)
      : null;
    if (agencyScore && expectedIntent.majorIntentClauses.length) {
      coverage.actions++;
      coverage.majorClauses += expectedIntent.majorIntentClauses.length;
      coverage.representedClauses += Math.round(
        (expectedIntent.majorIntentClauses.length *
          agencyScore.majorIntentCoveragePercent) /
          100,
      );
    }
    const row = {
      order: index + 1,
      action,
      committed: response.statusCode === 200,
      dateBefore: before.date,
      dateAfter: after.date,
      playerExecution: audit?.playerExecution ?? null,
      agencyScore,
      foreignPlans:
        audit?.plans?.filter(
          (plan) => plan.nationId !== after.playerNationId,
        ) ?? [],
      diplomaticResponses: audit?.moves ?? [],
      failures:
        audit?.failures ??
        [response.statusCode === 200 ? '' : response.body].filter(Boolean),
      modelCalls: audit?.modelCalls?.length ?? 0,
      events: after.events
        .slice(before.events.length)
        .filter((event) => event.type !== 'ADVANCE_DATE')
        .map((event) => event.title),
      activeWars: after.conflicts
        .filter((conflict) => conflict.status === 'active')
        .map((conflict) => conflict.name),
      activeCrises: after.crises
        .filter((crisis) => crisis.status !== 'resolved')
        .map((crisis) => crisis.title),
      sweden: {
        militaryBudgetShare: after.nations.find(
          (nation) => nation.id === after.playerNationId,
        )?.strategy.militaryBudgetShare,
        treasury: after.nations.find(
          (nation) => nation.id === after.playerNationId,
        )?.stats.treasury,
        readiness: after.nations.find(
          (nation) => nation.id === after.playerNationId,
        )?.stats.readiness,
        unrest: after.nations.find(
          (nation) => nation.id === after.playerNationId,
        )?.stats.unrest,
      },
      behavior: analyzeWorldBehavior(before, after),
      ...(response.statusCode === 200 ? {} : { error: response.body }),
    };
    records[campaignName]!.push(row);
    checkpoint();
    process.stdout.write(
      JSON.stringify({
        campaign: campaignName,
        order: index + 1,
        committed: row.committed,
        action,
        modelCalls: row.modelCalls,
        events: row.events,
      }) + '\n',
    );
    if (response.statusCode !== 200) break;
  }
  await app.close();
  store.close();
}
checkpoint();
process.stdout.write(`Saved real-model agency playtest to ${reportPath}\n`);
