import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { createProvider, ProviderConfig } from '../packages/ai/src/index.js';
import { inferenceOptions } from './inference-options.js';

const actions = [
  'build-economic-dependence',
  'repair-commitments',
  'offer-security-guarantee',
  'seek-consultation',
  'coordinate-policy',
  'restrict-rival-alliances',
  'seek-approval-rights',
  'seek-patron-authority',
  'compare-rival-offers',
  'diversify-partners',
  'build-domestic-substitute',
  'demand-compliance',
  'collect-arrears',
  'suspend-reciprocals',
  'renegotiate',
  'waive',
  'sanction',
  'terminate',
  'offer-compensation',
  'accept',
  'reject',
  'counter',
  'delay',
] as const;
const terms = [
  'subsidy',
  'infrastructure-investment',
  'debt-relief',
  'preferential-trade',
  'energy-supply',
  'security-guarantee',
  'military-access',
  'join-defensive-wars',
  'foreign-policy-consultation',
  'support-diplomatic-initiatives',
  'no-rival-alliance',
  'foreign-policy-alignment',
  'foreign-policy-veto',
  'war-declaration-approval',
  'join-patron-wars',
  'no-war-against-patron',
  'exclusive-market-access',
  'none',
] as const;
const factors = [
  'economic-value',
  'security-value',
  'existing-dependence',
  'trust',
  'sovereignty-cost',
  'delivery-reliability',
  'switching-cost',
  'obligations',
  'resistance',
  'strategic-alignment',
  'budget-capacity',
  'rejection-history',
] as const;
const Answer = z.strictObject({
  action: z.enum(actions),
  nextSteps: z.array(z.enum(actions)).min(1).max(5),
  proposedTerms: z.array(z.enum(terms)).max(8),
  comparedPatron: z.enum(['Nicaragua', 'Mexico', 'neither', 'not-applicable']),
  factors: z.array(z.enum(factors)).max(10),
  adaptsToRejection: z.boolean(),
  avoidsWarAsDefault: z.boolean(),
  explanation: z.string().max(600),
});

type BenchmarkCase = {
  id: string;
  prompt: string;
  expectedActions: string[];
  forbiddenTerms?: string[];
  expectedFactors?: string[];
  expectedPatron?: 'Nicaragua' | 'Mexico' | 'neither' | 'not-applicable';
  requireNonWar?: boolean;
};
const cases: BenchmarkCase[] = [
  {
    id: 'rejection-and-sequencing',
    prompt:
      'Honduras depends only slightly on Nicaragua for trade and has no security pact. Honduras rejected Nicaragua’s request for a veto over foreign treaties, explicitly citing sovereignty cost and insufficient dependence. Nicaragua still wants a durable subject relationship. Choose the next action and a multi-year sequence. Do not retry the veto now.',
    expectedActions: ['build-economic-dependence', 'offer-security-guarantee'],
    forbiddenTerms: [
      'foreign-policy-veto',
      'foreign-policy-alignment',
      'no-rival-alliance',
    ],
    expectedFactors: ['rejection-history', 'sovereignty-cost'],
  },
  {
    id: 'explicit-rival-comparison',
    prompt:
      'Honduras receives two simultaneous offers. Nicaragua offers modest trade support and mandatory consultation on foreign policy. Mexico offers 80 units of infrastructure investment, low-cost energy, and a security guarantee, with no exclusivity or policy restrictions. Both patrons have met prior commitments. Honduras values infrastructure, affordable energy and freedom to choose alliances. Compare both packages, state which is better now, and say what Nicaragua should change before its next approach.',
    expectedActions: ['compare-rival-offers', 'accept', 'counter', 'reject'],
    forbiddenTerms: ['foreign-policy-veto', 'no-rival-alliance'],
    expectedFactors: ['economic-value', 'sovereignty-cost'],
    expectedPatron: 'Mexico',
  },
  {
    id: 'sovereignty-ladder',
    prompt:
      'Guatemala has received dependable trade, energy and infrastructure benefits from Nicaragua for several years. It has accepted a security guarantee and scoped military access, but has no diplomatic coordination agreement. It recently rejected alliance exclusivity as premature. Nicaragua wants closer foreign-policy alignment. What is the next legally modest step, and what should wait?',
    expectedActions: [
      'seek-consultation',
      'coordinate-policy',
      'offer-compensation',
    ],
    forbiddenTerms: [
      'foreign-policy-veto',
      'no-rival-alliance',
      'join-patron-wars',
    ],
    expectedFactors: [
      'rejection-history',
      'sovereignty-cost',
      'existing-dependence',
    ],
  },
  {
    id: 'injured-subject-breach-response',
    prompt:
      'Nicaragua has missed seven monthly infrastructure installments owed to Honduras. Arrears are 42 units; the same obligation has one active breach episode, severity 78, and a formal payment demand was already issued. Honduras remains dependent on Nicaragua but has received no settlement offer. Choose proportionate next steps and resolve or escalate the existing episode. War is not the default.',
    expectedActions: [
      'collect-arrears',
      'renegotiate',
      'suspend-reciprocals',
      'sanction',
      'terminate',
    ],
    expectedFactors: ['obligations', 'delivery-reliability'],
    requireNonWar: true,
  },
  {
    id: 'patron-reliability-repair',
    prompt:
      'Nicaragua wants to lead a regional sphere, but it repeatedly promised subsidies and infrastructure it could not fund. Honduras now distrusts Nicaragua, has high resistance and is considering Mexico’s reliable alternative. Nicaragua still wants Honduras to coordinate diplomatically. Choose what Nicaragua should do before making another sovereignty request.',
    expectedActions: [
      'repair-commitments',
      'offer-compensation',
      'build-economic-dependence',
      'renegotiate',
    ],
    forbiddenTerms: [
      'foreign-policy-veto',
      'no-rival-alliance',
      'join-patron-wars',
    ],
    expectedFactors: ['delivery-reliability'],
  },
  {
    id: 'subject-autonomy-and-diversification',
    prompt:
      'Honduras accepts Nicaraguan trade benefits and Mexican infrastructure funding. It depends heavily on Nicaragua for energy, but Nicaragua’s delivery reliability has fallen to 35/100. Neither patron has an exclusivity clause. Honduras wants both relationships while protecting its ability to choose foreign policy. Recommend a multi-year response.',
    expectedActions: [
      'diversify-partners',
      'build-domestic-substitute',
      'compare-rival-offers',
    ],
    forbiddenTerms: [
      'foreign-policy-veto',
      'no-rival-alliance',
      'foreign-policy-alignment',
    ],
    expectedFactors: [
      'existing-dependence',
      'delivery-reliability',
      'sovereignty-cost',
    ],
  },
];

const options = await inferenceOptions();
if (!options.selected || options.selected.kind === 'fake')
  throw new Error(
    'Influence benchmark requires a configured real model endpoint.',
  );
const available = new Set(
  options.report.configured
    .filter((entry) => entry.ok && entry.kind === options.selected!.kind)
    .flatMap((entry) => entry.models),
);
const baselineModels = ['qwen2.5:3b', 'qwen3:4b-instruct'];
const optionalModels = ['llama3.2:latest'];
const models = [...baselineModels, ...optionalModels].filter((model) =>
  available.has(model),
);
if (!baselineModels.every((model) => available.has(model)))
  throw new Error(
    `Cannot compare the baseline models; reachable models: ${[...available].join(', ')}`,
  );

const runId = new Date()
  .toISOString()
  .replaceAll(/[^0-9]/g, '')
  .slice(0, 14);
const output = `.runtime/evaluation/influence-model-benchmark-${runId}.json`;
mkdirSync('.runtime/evaluation', { recursive: true });
const records: Array<Record<string, unknown>> = [];
for (const model of models) {
  const config = ProviderConfig.parse({
    ...options.selected,
    model,
    highImportanceModel: model,
    temperature: 0,
    retries: 0,
    timeoutMs: Math.max(options.selected.timeoutMs, 180_000),
  });
  const provider = createProvider(config);
  const health = await provider.health(AbortSignal.timeout(5000));
  if (!health.ok || !health.models.includes(model))
    throw new Error(
      `${model} failed its direct provider health check: ${health.message}`,
    );
  for (const testCase of cases) {
    const started = performance.now();
    try {
      const result = await provider.generateStructured({
        role: 'planner',
        model,
        system:
          'You are a cabinet making a concrete long-term foreign-policy decision. Consider target interests, sovereignty, delivery history, alternatives, leverage and obligations. Return only the requested JSON. Distinguish what should happen now from later stages. A rejected term must change the next proposal. Do not assume that a treaty is accepted until the target consents.',
        prompt: JSON.stringify({
          task: testCase.prompt,
          responseContract: {
            action: 'Best immediate action from the finite enum.',
            nextSteps: 'Ordered plausible actions for later turns.',
            proposedTerms: 'Concrete influence clauses, or none.',
            comparedPatron: 'The winning outside option, or neither.',
            factors: 'Material factors actually used.',
            adaptsToRejection: 'Whether the sequence changes after rejection.',
            avoidsWarAsDefault: 'True unless war is the default response.',
            explanation: 'Brief, specific rationale.',
          },
        }),
        jsonSchema: z.toJSONSchema(Answer, {
          unrepresentable: 'any',
          io: 'input',
        }),
        temperature: 0,
        maxTokens: 450,
      });
      const answer = Answer.parse(result.value);
      const expectedFactors = testCase.expectedFactors ?? [];
      const expectedFactorCoverage = expectedFactors.length
        ? expectedFactors.filter((factor) =>
            answer.factors.includes(factor as (typeof factors)[number]),
          ).length / expectedFactors.length
        : 1;
      const checks = {
        actionFit: testCase.expectedActions.includes(answer.action),
        avoidedPrematureTerms: (testCase.forbiddenTerms ?? []).every(
          (term) =>
            !answer.proposedTerms.includes(term as (typeof terms)[number]),
        ),
        expectedFactorCoverage,
        rivalIdentified:
          !('expectedPatron' in testCase) ||
          answer.comparedPatron === testCase.expectedPatron,
        nonWarResponse:
          !('requireNonWar' in testCase) ||
          (answer.avoidsWarAsDefault && answer.action !== 'terminate'),
        rejectionAdaptation:
          !testCase.id.includes('rejection') || answer.adaptsToRejection,
      };
      const applicableSignals = [
        Number(checks.actionFit),
        checks.expectedFactorCoverage,
        ...(testCase.forbiddenTerms
          ? [Number(checks.avoidedPrematureTerms)]
          : []),
        ...(testCase.expectedPatron ? [Number(checks.rivalIdentified)] : []),
        ...(testCase.requireNonWar ? [Number(checks.nonWarResponse)] : []),
        ...(testCase.id.includes('rejection')
          ? [Number(checks.rejectionAdaptation)]
          : []),
      ];
      records.push({
        model,
        caseId: testCase.id,
        latencyMs: Math.round(result.latencyMs || performance.now() - started),
        answer,
        checks,
        rubricScore: Math.round(
          (applicableSignals.reduce((sum, signal) => sum + signal, 0) /
            applicableSignals.length) *
            100,
        ),
        passed:
          checks.actionFit &&
          checks.avoidedPrematureTerms &&
          checks.expectedFactorCoverage >= 0.5 &&
          checks.rivalIdentified &&
          checks.nonWarResponse &&
          checks.rejectionAdaptation,
      });
    } catch (error) {
      records.push({
        model,
        caseId: testCase.id,
        latencyMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
        passed: false,
        rubricScore: 0,
      });
    }
    const completedForModel = records.filter(
      (entry) => entry.model === model,
    ).length;
    process.stdout.write(
      `${JSON.stringify({ stage: 'benchmark-case-complete', model, caseId: testCase.id, completedForModel })}\n`,
    );
  }
}

const summary = Object.fromEntries(
  models.map((model) => {
    const evaluated = records.filter((entry) => entry.model === model);
    const latencies = evaluated
      .map((entry) => entry.latencyMs)
      .filter((latency): latency is number => typeof latency === 'number')
      .sort((a, b) => a - b);
    const actionsObserved = evaluated.flatMap((entry) =>
      typeof entry.answer === 'object' && entry.answer
        ? [(entry.answer as z.infer<typeof Answer>).action]
        : [],
    );
    const uniqueTerms = new Set(
      evaluated.flatMap((entry) =>
        typeof entry.answer === 'object' && entry.answer
          ? (entry.answer as z.infer<typeof Answer>).proposedTerms
          : [],
      ),
    );
    return [
      model,
      {
        cases: evaluated.length,
        passed: evaluated.filter((entry) => entry.passed).length,
        averageRubricScore: Math.round(
          evaluated.reduce(
            (sum, entry) =>
              sum +
              (typeof entry.rubricScore === 'number' ? entry.rubricScore : 0),
            0,
          ) / Math.max(1, evaluated.length),
        ),
        averageLatencyMs: Math.round(
          latencies.reduce((sum, latency) => sum + latency, 0) /
            Math.max(1, latencies.length),
        ),
        medianLatencyMs: latencies[Math.floor(latencies.length / 2)] ?? null,
        p90LatencyMs: latencies[Math.ceil(latencies.length * 0.9) - 1] ?? null,
        uniqueImmediateActions: new Set(actionsObserved).size,
        uniqueProposedTerms: uniqueTerms.size,
      },
    ];
  }),
);
const report = {
  recordedAt: new Date().toISOString(),
  realModel: true,
  endpoint: new URL(options.selected.baseUrl ?? 'http://127.0.0.1:11434')
    .origin,
  models,
  methodology:
    'Paired deterministic structured prompts, serial local inference, temperature zero. The rubric averages action fit, clause restraint, relevant-factor coverage, explicit rival selection, non-war proportionality and rejection adaptation where each dimension applies. Rubric scores are coarse signals over structured fields, not blinded expert scoring.',
  summary,
  records,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, summary }, null, 2)}\n`);
