import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadScenario } from '@mandate/scenarios';
import { WorldState } from '@mandate/schemas';
import {
  createProvider,
  SemanticProposal,
  canonicalizeFormalizerIntent,
  deterministicPlayerIntent,
  splitActionClauses,
  nationMentions,
  executePlayerAction,
} from '@mandate/ai';
import { inferenceOptions } from './inference-options.js';
import { difficultSemanticCases } from './semantic-cases.js';
const output = resolve(
  process.env.MANDATE_SEMANTIC_OUTPUT ?? '.runtime/evaluation/semantic-real',
);
mkdirSync(output, { recursive: true });
const options = await inferenceOptions();
if (!options.selected) {
  writeFileSync(
    resolve(output, 'results.json'),
    JSON.stringify(
      { status: 'unavailable', discovery: options.report },
      null,
      2,
    ),
  );
  throw new Error('Configured real model unavailable');
}
const config = {
  ...options.selected,
  ...(process.env.MANDATE_SEMANTIC_MODEL
    ? {
        roleModels: {
          ...options.selected.roleModels,
          formalizer: process.env.MANDATE_SEMANTIC_MODEL,
        },
      }
    : {}),
  retries: 0,
  timeoutMs: 180000,
};
const provider = createProvider(config);
const world = WorldState.parse(
  loadScenario(resolve('data/scenarios/global-alpha.json')),
);
world.playerNationId = world.nations.find((n) => n.name === 'Sweden')!.id;
const schema = z.strictObject({
  actions: z
    .array(
      SemanticProposal.extend({
        dependsOn: z.array(z.number().int()),
        condition: z.string().nullable(),
        references: z.array(
          z.strictObject({
            expression: z.string(),
            antecedentClauseId: z.number().int(),
            role: z.enum(['target', 'instrument', 'actor', 'condition']),
          }),
        ),
      }),
    )
    .max(40),
});
const named = (ids: string[]) =>
  ids
    .map(
      (id) =>
        world.nations
          .find((n) => n.id === id)
          ?.name.replace('United States of America', 'United States') ?? id,
    )
    .sort();
const same = (a: string[], b: string[]) =>
  JSON.stringify(a) === JSON.stringify([...b].sort());
const rows: unknown[] = [];
for (const [index, test] of difficultSemanticCases
  .slice(
    0,
    Number(process.env.MANDATE_SEMANTIC_LIMIT ?? difficultSemanticCases.length),
  )
  .entries()) {
  const clauses = splitActionClauses(test.text);
  const mentioned = new Set(nationMentions(world, test.text).map((m) => m.id));
  const catalog = world.nations
    .filter((n) => mentioned.has(n.id) || n.id === world.playerNationId)
    .map((n) => ({ id: n.id, name: n.name }));
  let raw: unknown;
  let parsed: z.infer<typeof schema> | undefined;
  let failure: string | undefined;
  try {
    const result = await provider.generateStructured({
      role: 'formalizer',
      model: config.roleModels?.formalizer ?? config.model,
      system:
        'Interpret the player order as semantic actions, one per supplied clause. Sweden is actor. Entity mention does not imply target. Owners of stolen assets are sources, requested allies are participants, invaded nations are targets. Resolve both to the preceding target pair, and it used as a force to the acquired asset result. Preserve conditionality and required dependencies. Do not simulate success. Use supplied IDs only.',
      prompt: JSON.stringify({
        text: test.text,
        clauses,
        actor: world.playerNationId,
        catalog,
      }),
      jsonSchema: z.toJSONSchema(schema),
      temperature: 0,
      maxTokens: 2200,
    });
    raw = result.value;
    parsed = schema.parse(raw);
  } catch (e) {
    failure = String(e);
  }
  const fallback = deterministicPlayerIntent(world, {
    actorNationId: world.playerNationId,
    text: test.text,
  });
  const intent = parsed
    ? canonicalizeFormalizerIntent(
        world,
        { actorNationId: world.playerNationId, text: test.text },
        {
          ...fallback,
          semanticProposals: parsed.actions.map(
            ({ dependsOn, condition, references, ...proposal }) => {
              void dependsOn;
              void condition;
              void references;
              return proposal;
            },
          ),
        },
      )
    : fallback;
  const rawChecks = test.checks.map((check) => {
    const candidates =
      parsed?.actions.filter((a) => a.action === check.action) ?? [];
    return {
      check,
      correct: candidates.some(
        (a) =>
          (check.targets === undefined ||
            same(named(a.targets), check.targets!)) &&
          (check.sources === undefined ||
            same(named(a.sources), check.sources!)) &&
          (check.participants === undefined ||
            same(named(a.participants), check.participants)) &&
          (!check.conditional || !!a.condition),
      ),
      targetCorrect:
        check.targets === undefined ||
        candidates.some((a) => same(named(a.targets), check.targets!)),
      sourceCorrect:
        check.sources === undefined ||
        candidates.some((a) => same(named(a.sources), check.sources!)),
    };
  });
  const hybridChecks = test.checks.map((check) => ({
    check,
    correct: intent.actionGraph!.actions.some(
      (a) =>
        a.action === check.action &&
        (check.targets === undefined ||
          same(named(a.targets), check.targets!)) &&
        (check.sources === undefined ||
          same(named(a.sources), check.sources!)) &&
        (check.participants === undefined ||
          same(named(a.participants), check.participants)) &&
        (!check.conditional || a.conditions.length > 0),
    ),
  }));
  const expectedRefs = intent.actionGraph!.references.filter(
    (r) => r.origin === 'text' && !r.expression.startsWith('implicit'),
  );
  const corefCorrect = expectedRefs.filter((r) =>
    parsed?.actions.some(
      (a) =>
        a.clauseId === Number(r.actionId.split(':')[1]) &&
        a.references.some(
          (ref) =>
            ref.expression.toLowerCase() === r.expression.toLowerCase() &&
            ref.role === r.role,
        ),
    ),
  ).length;
  const expectedDependencies = intent.actionGraph!.actions.flatMap((a) =>
    a.dependencies.map((d) => ({
      clause: a.clauseId,
      antecedent: Number(d.actionId.split(':')[1]),
    })),
  );
  const dependencyCorrect = expectedDependencies.filter((d) =>
    parsed?.actions.some(
      (a) => a.clauseId === d.clause && a.dependsOn.includes(d.antecedent),
    ),
  ).length;
  const row = {
    index,
    text: test.text,
    failure,
    raw,
    rawChecks,
    hybridChecks,
    coreference: { expected: expectedRefs.length, correct: corefCorrect },
    dependencies: {
      expected: expectedDependencies.length,
      correct: dependencyCorrect,
    },
    repairs: intent.actionGraph!.repairs,
    graph: intent.actionGraph,
    execution: executePlayerAction(world, intent, `real-semantic-${index}`),
  };
  rows.push(row);
  const report = {
    recordedAt: new Date().toISOString(),
    provider: provider.id,
    model: config.roleModels?.formalizer ?? config.model,
    evidence:
      'Real local model semantic interpretation followed by deterministic hybrid repair; execution preview is not a committed world turn.',
    completed: rows.length,
    total: Math.min(
      Number(
        process.env.MANDATE_SEMANTIC_LIMIT ?? difficultSemanticCases.length,
      ),
      difficultSemanticCases.length,
    ),
    rows,
  };
  writeFileSync(
    resolve(output, 'results.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  process.stdout.write(
    `${index + 1}/${difficultSemanticCases.length} raw ${rawChecks.filter((c) => c.correct).length}/${rawChecks.length}, hybrid ${hybridChecks.filter((c) => c.correct).length}/${hybridChecks.length}, repairs ${row.repairs.length}\n`,
  );
}
process.stdout.write(`Report: ${resolve(output, 'results.json')}\n`);
