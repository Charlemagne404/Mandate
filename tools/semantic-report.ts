import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadScenario } from '@mandate/scenarios';
import { WorldState, NationId } from '@mandate/schemas';
import {
  deterministicPlayerIntent,
  canonicalizeFormalizerIntent,
  executePlayerAction,
} from '@mandate/ai';
import { difficultSemanticCases, type SemanticCase } from './semantic-cases.js';
const output = resolve('.runtime/evaluation/semantic-final');
mkdirSync(output, { recursive: true });
const world = WorldState.parse(
  loadScenario(resolve('data/scenarios/global-alpha.json')),
);
world.playerNationId = world.nations.find((n) => n.name === 'Sweden')!.id;
const named = (ids: string[]) =>
  ids
    .map(
      (id) =>
        world.nations
          .find((n) => n.id === id)
          ?.name.replace('United States of America', 'United States') ?? id,
    )
    .sort();
const equal = (actual: string[], expected: string[]) =>
  JSON.stringify(named(actual)) === JSON.stringify([...expected].sort());
interface Observed {
  clauseId: number;
  action: string;
  targets: string[];
  sources: string[];
  participants: string[];
  condition: string | null;
  dependsOn: number[];
  references: {
    expression: string;
    antecedentClauseId: number;
    role: string;
  }[];
}
interface Row {
  index: number;
  text: string;
  raw: { actions: Observed[] };
  failure?: string;
  coreference: { expected: number; correct: number };
  dependencies: { expected: number; correct: number };
}
const match = (
  actions: {
    action: string;
    targets: string[];
    sources: string[];
    participants: string[];
    conditional: boolean;
  }[],
  check: SemanticCase['checks'][number],
) =>
  actions.some(
    (a) =>
      a.action === check.action &&
      (check.targets === undefined || equal(a.targets, check.targets)) &&
      (check.sources === undefined || equal(a.sources, check.sources)) &&
      (check.participants === undefined ||
        equal(a.participants, check.participants)) &&
      (!check.conditional || a.conditional),
  );
const reports = ['semantic-real', 'semantic-real-4b'].map((directory) => {
  const original = JSON.parse(
    readFileSync(
      resolve(`.runtime/evaluation/${directory}/results.json`),
      'utf8',
    ),
  ) as { model: string; rows: Row[] };
  const rows = original.rows.map((row) => {
    const test = difficultSemanticCases[row.index]!;
    const draft = deterministicPlayerIntent(world, {
      actorNationId: world.playerNationId,
      text: row.text,
    });
    const intent = canonicalizeFormalizerIntent(
      world,
      { actorNationId: world.playerNationId, text: row.text },
      {
        ...draft,
        semanticProposals: (row.raw?.actions ?? []).map((a) => ({
          clauseId: a.clauseId,
          action: a.action as never,
          targets: a.targets.map((n) => NationId.parse(n)),
          sources: a.sources.map((n) => NationId.parse(n)),
          participants: a.participants.map((n) => NationId.parse(n)),
        })),
      },
    );
    const rawActions = (row.raw?.actions ?? []).map((a) => ({
      ...a,
      conditional: !!a.condition,
    }));
    const hybridActions = intent.actionGraph!.actions.map((a) => ({
      ...a,
      conditional: a.conditions.length > 0,
    }));
    const rawChecks = test.checks.map((c) => match(rawActions, c));
    const hybridChecks = test.checks.map((c) => match(hybridActions, c));
    const roleChecks = test.checks.flatMap((check) =>
      (['targets', 'sources', 'participants'] as const)
        .filter((role) => check[role] !== undefined)
        .map((role) => ({
          role,
          correct: rawActions.some(
            (a) => a.action === check.action && equal(a[role], check[role]!),
          ),
        })),
    );
    return {
      ...row,
      rawChecks,
      hybridChecks,
      roleChecks,
      graph: intent.actionGraph,
      repairs: intent.actionGraph!.repairs,
      execution: executePlayerAction(world, intent, `report-${row.index}`),
    };
  });
  const checks = rows.flatMap((r) => r.rawChecks);
  const hybrid = rows.flatMap((r) => r.hybridChecks);
  const targets = rows
    .flatMap((r) => r.roleChecks)
    .filter((c) => c.role === 'targets');
  const roles = rows.flatMap((r) => r.roleChecks);
  return {
    model: original.model,
    caseCount: rows.length,
    metricDefinition:
      'Independently specified action/role/conditional expectations. Final hybrid re-evaluated against the captured real outputs, without a new model call.',
    semanticClauseCoverage: {
      correct: checks.filter(Boolean).length,
      total: checks.length,
    },
    entityRoleAccuracy: {
      correct: roles.filter((c) => c.correct).length,
      total: roles.length,
    },
    targetAccuracy: {
      correct: targets.filter((c) => c.correct).length,
      total: targets.length,
    },
    coreferenceAccuracy: {
      correct: rows.reduce((n, r) => n + r.coreference.correct, 0),
      total: rows.reduce((n, r) => n + r.coreference.expected, 0),
    },
    dependencyAccuracy: {
      correct: rows.reduce((n, r) => n + r.dependencies.correct, 0),
      total: rows.reduce((n, r) => n + r.dependencies.expected, 0),
    },
    repairedCases: rows.filter((r) => r.repairs.length > 0).length,
    schemaFailures: rows.filter((r) => r.failure).length,
    hybridSemanticCoverage: {
      correct: hybrid.filter(Boolean).length,
      total: hybrid.length,
    },
    rows,
  };
});
writeFileSync(
  resolve(output, 'model-comparison.json'),
  JSON.stringify(reports, null, 2) + '\n',
);
const graphs = [0, 1, 6, 7, 11, 12, 24].map((index) => ({
  input: difficultSemanticCases[index]!.text,
  graph: deterministicPlayerIntent(world, {
    actorNationId: world.playerNationId,
    text: difficultSemanticCases[index]!.text,
  }).actionGraph,
}));
writeFileSync(
  resolve(output, 'exact-graphs.json'),
  JSON.stringify(graphs, null, 2) + '\n',
);
process.stdout.write(
  JSON.stringify(
    reports.map(({ rows, ...report }) => {
      void rows;
      return report;
    }),
    null,
    2,
  ) + '\n',
);
