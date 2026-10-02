import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
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
if (!['northern-sandbox', 'global-alpha', 'nordic-strategy'].includes(scenario))
  throw new Error('Select northern-sandbox, global-alpha or nordic-strategy');
const config = ProviderConfig.parse({
  kind: process.env.MANDATE_AI_KIND ?? 'fake',
  model: process.env.MANDATE_AI_MODEL ?? 'local-model',
  ...(process.env.MANDATE_AI_URL
    ? { baseUrl: process.env.MANDATE_AI_URL }
    : {}),
  ...(process.env.MANDATE_AI_API_KEY
    ? { apiKey: process.env.MANDATE_AI_API_KEY }
    : {}),
  contextBudget: Number(process.env.MANDATE_AI_CONTEXT ?? 48000),
  timeoutMs: Number(process.env.MANDATE_AI_TIMEOUT ?? 60000),
  ...(process.env.MANDATE_AI_CONTEXT_TOKENS
    ? { contextTokens: Number(process.env.MANDATE_AI_CONTEXT_TOKENS) }
    : {}),
});
const provider = createProvider(config);
const health = await provider.health();
if (!health.ok) throw new Error(health.message);
const store = openWorldStore({
  filename: ':memory:',
  migrationsDirectory: join(root, 'packages/persistence/migrations'),
});
try {
  const world = store.initialize(
    loadScenario(join(root, `data/scenarios/${scenario}.json`)),
  );
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
        recordedAt: new Date().toISOString(),
        ...result.metrics,
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
