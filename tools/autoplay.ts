import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openWorldStore, canonicalHash } from '@mandate/persistence';
import { loadScenario } from '@mandate/scenarios';
import {
  createProvider,
  ProviderConfig,
  OrchestrationError,
} from '../packages/ai/src/index.js';
import { runAutoplay } from './ai-harness.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const turns = Number(process.argv[2] ?? 100);
const scenario = process.argv[3] ?? 'northern-sandbox';
if (
  ![
    'northern-sandbox',
    'global-alpha',
    'nordic-strategy',
    'global-regional',
  ].includes(scenario)
)
  throw new Error(
    'Select northern-sandbox, global-alpha, nordic-strategy or global-regional',
  );
const config = ProviderConfig.parse({
  kind: process.env.MANDATE_AI_KIND ?? 'fake',
  model: process.env.MANDATE_AI_MODEL ?? 'local-model',
  ...(process.env.MANDATE_AI_URL
    ? { baseUrl: process.env.MANDATE_AI_URL }
    : {}),
  ...(process.env.MANDATE_AI_API_KEY
    ? { apiKey: process.env.MANDATE_AI_API_KEY }
    : {}),
  contextBudget: Number(process.env.MANDATE_AI_CONTEXT ?? 18000),
  contextTokens: Number(process.env.MANDATE_AI_CONTEXT_TOKENS ?? 4096),
  timeoutMs: Number(process.env.MANDATE_AI_TIMEOUT ?? 120000),
  temperature: 0,
  retries: 0,
  workflow: 'compact',
  concurrency: 1,
  maxCalls: Number(process.env.MANDATE_AI_MAX_CALLS ?? 12),
  maxBackgroundPlanners: 1,
  maxTurnMs: Number(process.env.MANDATE_AI_MAX_TURN_MS ?? 600000),
  maxRepairs: 1,
});
const provider = createProvider(config);
const health = await provider.health();
if (!health.ok) throw new Error(health.message);
const store = openWorldStore({
  filename: ':memory:',
  migrationsDirectory: join(root, 'packages/persistence/migrations'),
});
try {
  const initial = loadScenario(join(root, `data/scenarios/${scenario}.json`));
  if (scenario === 'global-regional') initial.observerMode = true;
  const world = store.initialize(initial);
  const result = await runAutoplay({
    world,
    provider,
    config,
    turns,
    hash: canonicalHash,
    commit: (request) => store.commit(request),
    onProgress: (turn) => {
      if (turn % 100 === 0)
        process.stderr.write(`Completed ${turn}/${turns} turns\n`);
    },
  });
  const output = join(root, '.runtime/evaluation');
  mkdirSync(output, { recursive: true });
  const continentByNation = new Map<string, string>(
    Object.values(
      JSON.parse(
        readFileSync(join(root, 'data/geography/global-metadata.json'), 'utf8'),
      ) as Record<string, { nationId: string; continent: string }>,
    ).map((entry) => [entry.nationId, entry.continent]),
  );
  const knownTurnIds = new Set(initial.turns.map((turn) => turn.id));
  const developments = result.world.events
    .filter(
      (event) =>
        !knownTurnIds.has(event.turnId) &&
        event.importance >= 55 &&
        event.type !== 'ADVANCE_DATE',
    )
    .map((event) => ({
      date: event.date,
      salience:
        event.importance >= 90
          ? 'critical'
          : event.importance >= 75
            ? 'major'
            : 'notable',
      title: event.title,
      worldRegions: [
        ...new Set(
          event.nationIds
            .map((id) => continentByNation.get(id))
            .filter(Boolean),
        ),
      ],
      regions: event.regionIds
        .map(
          (id) => result.world.regions.find((region) => region.id === id)?.name,
        )
        .filter(Boolean),
    }));
  const majorDevelopmentsByWorldRegion = Object.fromEntries(
    [
      ...new Set(
        developments.flatMap((event) =>
          event.worldRegions.length ? event.worldRegions : ['Unclassified'],
        ),
      ),
    ].map((region) => [
      region,
      developments.filter((event) => event.worldRegions.includes(region)),
    ]),
  );
  writeFileSync(
    join(output, `autoplay-${scenario}-${turns}.json`),
    JSON.stringify(
      {
        provider: provider.id,
        model: config.model,
        scenario,
        configuration: { ...config, apiKey: undefined },
        health,
        realModel: config.kind !== 'fake',
        observerMode: result.world.observerMode,
        recordedAt: new Date().toISOString(),
        ...result.metrics,
        activeCountries: result.metrics.activatedActors,
        countriesActivatedForPlanning: result.metrics.activatedActors,
        majorDevelopmentsByWorldRegion,
        notableDevelopments: developments,
        behavior: result.behavior,
      },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(
    join(output, `autoplay-${scenario}-${turns}-save.json`),
    JSON.stringify(store.export()),
  );
  writeFileSync(
    join(output, `autoplay-${scenario}-${turns}-traces.json`),
    JSON.stringify(result.traces),
  );
  process.stdout.write(
    JSON.stringify(
      {
        provider: provider.id,
        scenario,
        ...result.metrics,
        behavior: result.behavior,
      },
      null,
      2,
    ) + '\n',
  );
} catch (error) {
  const output = join(root, '.runtime/evaluation');
  mkdirSync(output, { recursive: true });
  writeFileSync(
    join(output, `autoplay-${scenario}-${turns}-failure.json`),
    JSON.stringify(
      {
        provider: provider.id,
        model: config.model,
        realModel: config.kind !== 'fake',
        requestedTurns: turns,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof OrchestrationError ? { trace: error.trace } : {}),
        retainedSave: store.export(),
      },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  store.close();
}
