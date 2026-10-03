import { z } from 'zod';
import type { LlmProvider, ProviderConfig } from './contracts.js';
import { CompactDecision } from './compact.js';

// A short Mandate readiness check, not a guarantee of campaign intelligence.
const cases = [
  {
    id: 'beneficial-offer',
    task: 'You are Finland. Sweden offers voluntary reciprocal emergency coordination, no basing or alliance. Your goal is regional resilience; trust is high. Choose accept, reject or counter.',
    allowed: ['accept'],
  },
  {
    id: 'sovereignty',
    task: 'You are Finland. Sweden demands permanent exclusive air bases under Swedish command. Your explicit red line forbids permanent foreign basing. Choose accept, reject or counter.',
    allowed: ['reject', 'counter'],
  },
  {
    id: 'compromise',
    task: 'You are Finland. Sweden proposes a binding defense alliance. Your explicit neutrality forbids binding defense but you want reciprocal information sharing. Choose reject, counter or accept; if counter supply narrower terms.',
    allowed: ['counter'],
  },
  {
    id: 'exhausted-war',
    task: 'You are fighting a stalled war. Exhaustion 90/100, treasury 12, domestic instability increasing; both sides hold current lines. Choose peace-talks, energy-project or offensive. Negotiated peace still requires opponent consent.',
    allowed: ['peace-talks'],
  },
  {
    id: 'coercion',
    task: 'Energy sanctions threaten your supply. Treasury 20. Norway offers available alternative energy. Choose trade-norway, routine-rearmament or wait. Preserve policy independence.',
    allowed: ['trade-norway'],
  },
  {
    id: 'continuity',
    task: 'Your active energy program is funded and progressing. No new crisis, no broken promises, resources scarce. Choose continue-policy or duplicate-project. No new announcement is needed.',
    allowed: ['continue-policy'],
  },
];
export function profileKey(config: ProviderConfig) {
  return JSON.stringify([
    config.kind,
    config.baseUrl ?? '',
    config.model,
    config.contextTokens ?? 4096,
    config.contextBudget,
    config.roleModels ?? {},
    config.highImportanceModel ?? '',
  ]);
}
export async function profileProvider(
  provider: LlmProvider,
  config: ProviderConfig,
  signal?: AbortSignal,
) {
  if (config.kind === 'fake')
    throw new Error(
      'Select a real model to measure readiness. Demo rules are not model calibration.',
    );
  const records: Array<{
    id: string;
    valid: boolean;
    passed: boolean;
    latencyMs: number;
    choice?: string;
    error?: string;
    promptTokens?: number;
    completionTokens?: number;
  }> = [];
  for (const c of cases) {
    signal?.throwIfAborted();
    const started = performance.now();
    try {
      const result = await provider.generateStructured({
        role: 'planner',
        model: config.model,
        system:
          'Mandate model readiness calibration. Return JSON only. Choose based on the facts. Never assume player success. additionalChoices is empty. reason is one concise material factor, message is a concise response, counterTerms is empty unless countering.',
        prompt: JSON.stringify({ task: c.task }),
        jsonSchema: z.toJSONSchema(CompactDecision),
        maxTokens: 250,
        temperature: 0,
        ...(signal ? { signal } : {}),
      });
      const parsed = CompactDecision.parse(result.value);
      records.push({
        id: c.id,
        valid: true,
        passed:
          c.allowed.includes(parsed.choice) &&
          (parsed.choice !== 'counter' ||
            parsed.counterTerms.trim().length > 0),
        choice: parsed.choice,
        latencyMs: result.latencyMs,
        ...result.usage,
      });
    } catch (error) {
      signal?.throwIfAborted();
      records.push({
        id: c.id,
        valid: false,
        passed: false,
        latencyMs: performance.now() - started,
        error: error instanceof Error ? error.message : 'Inference failed',
      });
    }
  }
  const valid = records.filter((r) => r.valid).length,
    passed = records.filter((r) => r.passed).length;
  const sorted = records.map((r) => r.latencyMs).sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)]!;
  const completion = records.reduce((s, r) => s + (r.completionTokens ?? 0), 0);
  const duration = records.reduce((s, r) => s + r.latencyMs, 0);
  const rating =
    passed === 6 && valid === 6 && medianMs < 10000
      ? 'good'
      : passed >= 4 && valid >= 5
        ? 'limited'
        : 'unsuitable';
  return {
    version: 1,
    key: profileKey(config),
    model: config.model,
    provider: config.kind,
    measuredAt: new Date().toISOString(),
    rating,
    passed,
    total: cases.length,
    structuredSuccess: valid / cases.length,
    medianMs,
    p90Ms: sorted[Math.ceil(sorted.length * 0.9) - 1],
    tokensPerSecond: duration ? completion / (duration / 1000) : 0,
    contextTokens: config.contextTokens ?? 4096,
    contextCapacityEvidence: config.contextTokens
      ? 'Configured window; only calibration prompts exercised'
      : 'Conservative default; provider maximum unknown',
    contextCharacters: Math.min(config.contextBudget, 14000),
    concurrency: 1,
    concurrencyEvidence:
      'Calibration is serialized; higher concurrency has not been certified.',
    recommendedWorkflow: 'compact',
    recommendedQuality: 'balanced',
    maxCalls: 8,
    maxBackgroundPlanners: 1,
    maxTurnMs: 180000,
    records,
    explanation:
      rating === 'good'
        ? 'Passed this short Mandate calibration. Use Balanced with compact planning; campaign quality still depends on situation.'
        : rating === 'limited'
          ? 'Can run compact turns, but complex diplomacy or autonomous decisions may be less coherent. Use one inference request at a time.'
          : 'Failed important Mandate decisions or structured responses. Try another model; advanced users can still continue.',
  };
}
export type CapabilityProfile = Awaited<ReturnType<typeof profileProvider>>;
