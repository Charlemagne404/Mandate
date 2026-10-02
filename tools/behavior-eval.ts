import { inferenceOptions } from './inference-options.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadScenario } from '@mandate/scenarios';
import { createProvider, ProviderConfig } from '../packages/ai/src/index.js';
import { behaviorCases } from '../tests/ai/behavior-cases.js';
import { evaluateBehavior } from './behavior-harness.js';
const real = process.argv.includes('--real');
const limit = Number(
  process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ??
    behaviorCases.length,
);
const role = process.argv.find((a) => a.startsWith('--role='))?.split('=')[1];
const maxTokens = Number(
  process.argv.find((a) => a.startsWith('--tokens='))?.slice(9) ?? 4000,
);
if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 8192)
  throw new Error('Invalid output token limit');
const match = process.argv.find((a) => a.startsWith('--match='))?.slice(8);
const label = process.argv.find((a) => a.startsWith('--label='))?.slice(8);
if (label && !/^[a-z0-9-]+$/.test(label))
  throw new Error('Invalid report label');
const output = '.runtime/evaluation';
const reportPath = `${output}/behavior-${real ? 'real' : 'fake'}${label ? `-${label}` : ''}.json`;
mkdirSync(output, { recursive: true });
const options = real ? await inferenceOptions() : undefined;
const discovered = options?.report;
if (real && !options?.selected) {
  const report = {
    status: 'unavailable',
    realModel: true,
    casesAvailable: behaviorCases.length,
    discovered,
    reason:
      'No usable local inference endpoint. Configure MANDATE_AI_KIND, MANDATE_AI_MODEL and optional MANDATE_AI_URL.',
  };
  writeFileSync(
    `${output}/behavior-real-unavailable.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = 2;
} else {
  const config = real
    ? options!.selected!
    : ProviderConfig.parse({
        kind: 'fake',
        model: 'demo-rules-v1',
        temperature: 0,
        retries: 0,
      });
  if (real && config.kind === 'fake')
    throw new Error('Real benchmark forbids fake provider');
  config.temperature = 0;
  const provider = createProvider(config),
    health = await provider.health();
  if (!health.ok) throw new Error(health.message);
  if (real && !process.env.MANDATE_AI_MODEL) {
    const suitable = health.models.find(
      (model) => !/embed|rerank|whisper|tts|clip/i.test(model),
    );
    if (!suitable)
      throw new Error(
        'Endpoint is reachable but no suitable generation model was enumerated; set MANDATE_AI_MODEL explicitly.',
      );
    config.model = suitable;
  }
  const world = loadScenario('data/scenarios/northern-sandbox.json');
  const records: Array<Awaited<ReturnType<typeof evaluateBehavior>>> = [];
  for (const c of behaviorCases
    .filter(
      (c) => (!role || c.role === role) && (!match || c.id.includes(match)),
    )
    .slice(0, limit)) {
    records.push(
      await evaluateBehavior(provider, config, world, c, { maxTokens }),
    );
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          status: 'running',
          realModel: real,
          provider: provider.id,
          model: config.model,
          configuration: { ...config, apiKey: undefined },
          records,
        },
        null,
        2,
      ) + '\n',
    );
    if (records.length % 10 === 0)
      process.stderr.write(`Evaluated ${records.length} cases\n`);
  }
  const roles = Object.fromEntries(
    [...new Set(records.map((r) => r.role))].map((role) => {
      const rs = records.filter((r) => r.role === role);
      return [
        role,
        {
          cases: rs.length,
          passed: rs.filter((r) => r.passed).length,
          structured: rs.filter((r) => r.structured).length,
          averageLatencyMs: rs.reduce((s, r) => s + r.latencyMs, 0) / rs.length,
        },
      ];
    }),
  );
  const report = {
    recordedAt: new Date().toISOString(),
    realModel: real,
    provider: provider.id,
    model: config.model,
    configuration: { ...config, maxOutputTokens: maxTokens, apiKey: undefined },
    health,
    promptVersion: 'mandate-role-v4-context-v3',
    acceptanceDistribution: Object.fromEntries(
      ['accept', 'reject', 'counter', 'delay', 'ignore', 'withdraw'].map(
        (move) => [
          move,
          records.filter(
            (r) =>
              r.role === 'diplomat' &&
              (r.observedBehavior as { move?: string } | null)?.move === move,
          ).length,
        ],
      ),
    ),
    acceptanceBiasDetected:
      records.filter(
        (r) =>
          r.role === 'diplomat' &&
          (r.observedBehavior as { move?: string } | null)?.move === 'accept',
      ).length /
        Math.max(1, records.filter((r) => r.role === 'diplomat').length) >
      0.85,
    costlyOfferAcceptanceFailures: records
      .filter(
        (r) =>
          r.category.startsWith('acceptance spectrum') &&
          r.expectedBehavior.allowedMoves &&
          !r.expectedBehavior.allowedMoves.includes('accept') &&
          (r.observedBehavior as { move?: string } | null)?.move === 'accept',
      )
      .map((r) => r.id),
    methodology:
      'Observable decisions, finite capabilities, canonical facts, secrecy, constraints and continuity; no prose aesthetics. Keyword checks on planner priorities are coarse signals requiring human review. Single-call roles, no repairs; gameplay orchestration has independent repair/fallback.',
    cases: records.length,
    passed: records.filter((r) => r.passed).length,
    roles,
    records,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(
    JSON.stringify({ ...report, records: undefined }, null, 2) + '\n',
  );
  if (report.passed !== report.cases) process.exitCode = 1;
}
