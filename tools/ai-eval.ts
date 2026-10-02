import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScenario } from '@mandate/scenarios';
import {
  buildFormalizerPayload,
  canonicalizeFormalizerIntent,
  createProvider,
  FormalizerIntent,
  FormalizerIntentJsonSchema,
  ProviderConfig,
  roleSystem,
} from '../packages/ai/src/index.js';
import { actionEvaluations } from '../tests/ai/evaluations.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const real = process.argv.includes('--real');
if (real && !process.env.MANDATE_AI_KIND)
  throw new Error(
    '--real requires MANDATE_AI_KIND=ollama or openai-compatible and MANDATE_AI_MODEL',
  );
const config = ProviderConfig.parse({
  kind: real ? process.env.MANDATE_AI_KIND : 'fake',
  model: process.env.MANDATE_AI_MODEL ?? 'local-model',
  ...(process.env.MANDATE_AI_URL
    ? { baseUrl: process.env.MANDATE_AI_URL }
    : {}),
  ...(process.env.MANDATE_AI_API_KEY
    ? { apiKey: process.env.MANDATE_AI_API_KEY }
    : {}),
});
if (real && config.kind === 'fake')
  throw new Error('--real cannot select the demo provider');
const provider = createProvider(config);
const health = await provider.health();
if (!health.ok) throw new Error(health.message);
const world = loadScenario(join(root, 'data/scenarios/northern-sandbox.json'));
const records: Array<{
  id: string;
  category: string;
  passed: boolean;
  issues: string[];
  latencyMs: number;
  rawOutput: string;
}> = [];
for (const evaluation of actionEvaluations) {
  const nationIndex = Number(evaluation.id.split('-')[1]);
  const target = world.nations.filter((n) => n.id !== world.playerNationId)[
    nationIndex
  ]!;
  const text = evaluation.text(target.name);
  const started = performance.now();
  let rawOutput = '';
  const issues: string[] = [];
  try {
    const result = await provider.generateStructured({
      role: 'formalizer',
      model: config.roleModels?.formalizer ?? config.model,
      system: roleSystem('formalizer'),
      prompt: JSON.stringify(
        buildFormalizerPayload(world, {
          actorNationId: world.playerNationId,
          text,
        }),
      ),
      jsonSchema: FormalizerIntentJsonSchema,
      temperature: 0,
    });
    rawOutput = result.rawText;
    const draft = FormalizerIntent.parse(result.value);
    const intent = canonicalizeFormalizerIntent(
      world,
      { actorNationId: world.playerNationId, text },
      draft,
    );
    if (intent.actorNationId !== world.playerNationId)
      issues.push('Changed actor');
    if (!intent.targetNationIds.includes(target.id))
      issues.push('Missing affected nation');
    if (intent.targetNationIds.some((id) => id !== target.id))
      issues.push('Unrelated target nation');
    if (!intent.intentions.some((i) => i.kind === evaluation.expectedKind))
      issues.push(`Missing ${evaluation.expectedKind} intention`);
    if (intent.visibility !== (evaluation.private ? 'private' : 'public'))
      issues.push('Incorrect visibility');
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'Generation failed');
  }
  records.push({
    id: evaluation.id,
    category: evaluation.category,
    passed: !issues.length,
    issues,
    latencyMs: performance.now() - started,
    rawOutput,
  });
}
const report = {
  provider: provider.id,
  model: config.model,
  realModel: real,
  scope:
    '60 structured formalization/relevance/visibility cases; integration trust and continuity cases run under test:ai',
  cases: records.length,
  passed: records.filter((r) => r.passed).length,
  averageLatencyMs:
    records.reduce((s, r) => s + r.latencyMs, 0) / records.length,
  records,
};
const directory = join(root, '.runtime/evaluation');
mkdirSync(directory, { recursive: true });
writeFileSync(
  join(directory, real ? 'real-model-evaluation.json' : 'fake-evaluation.json'),
  JSON.stringify(report, null, 2) + '\n',
);
process.stdout.write(
  JSON.stringify({ ...report, records: undefined }, null, 2) + '\n',
);
if (report.passed !== report.cases) process.exitCode = 1;
