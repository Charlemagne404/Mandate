import { expect, it } from 'vitest';
import {
  createOrchestrator,
  FakeProvider,
  scheduleActors,
  selectRelevance,
  repetitionIssue,
  NationPlanGeneration,
} from '../../packages/ai/src/index.js';
import type {
  LlmProvider,
  GenerationRequest,
} from '../../packages/ai/src/index.js';
import { resolveTurn, canonicalStringify } from '@mandate/core';
import {
  CommitRequest,
  Conference,
  NationId,
  Crisis,
  WorldCommand,
} from '@mandate/schemas';
import { fixture, context } from '../fixtures/world.js';
const fin = NationId.parse('nation:fin'),
  swe = NationId.parse('nation:swe'),
  rus = NationId.parse('nation:rus');
it('autonomous governments record independent conference decisions and form coalition only after unanimity', async () => {
  let w = fixture();
  w.conferences.push(
    Conference.parse({
      id: 'conference:ai',
      title: 'Reciprocal consultation',
      proposer: swe,
      parties: [swe, fin, rus],
      kind: 'security',
      terms: 'Intelligence sharing without basing',
      createdDate: w.date,
      expiresDate: '2025-07-01',
    }),
  );
  const orchestrator = createOrchestrator(new FakeProvider());
  const result = await orchestrator.prepare({
    world: w,
    expectedHash: 'a'.repeat(64),
    action: { actorNationId: swe, source: 'system', text: 'Observe' },
    days: 30,
    quality: 'balanced',
    runId: 'conference-play',
  });
  expect(
    result.trace.plans.filter((p) => p.conferenceDecisions.length),
  ).toHaveLength(3);
  const { expectedHash: _hash, ...request } = CommitRequest.parse(
    result.request,
  );
  void _hash;
  w = resolveTurn(w, request, context(1));
  expect(w.conferences[0]!.status).toBe('agreed');
  expect(w.organizations[0]!.members).toHaveLength(3);
});
it('neutral conference counter invalidates previously accepted terms without resolver inventing consent', async () => {
  let w = fixture();
  w.nations.find((n) => n.id === fin)!.strategy.redLines = [
    'No permanent foreign basing',
  ];
  w.conferences.push(
    Conference.parse({
      id: 'conference:ai',
      title: 'Basing proposal',
      proposer: swe,
      parties: [swe, fin, rus],
      kind: 'security',
      terms: 'Permanent foreign basing',
      createdDate: w.date,
      expiresDate: '2025-07-01',
    }),
  );
  const result = await createOrchestrator(new FakeProvider()).prepare({
    world: w,
    expectedHash: 'a'.repeat(64),
    action: { actorNationId: swe, source: 'system', text: 'Observe' },
    days: 30,
    runId: 'conference-counter',
  });
  const { expectedHash: _hash, ...request } = CommitRequest.parse(
    result.request,
  );
  void _hash;
  w = resolveTurn(w, request, context(1));
  expect(w.conferences[0]!.round).toBe(1);
  expect(w.conferences[0]!.status).toBe('open');
  expect(w.organizations).toEqual([]);
});
it.each([
  'before-request',
  'after-plan',
  'after-proposal',
  'during-validation',
] as const)(
  'fault during %s leaves canonical world unchanged',
  async (stage) => {
    const w = fixture(),
      before = canonicalStringify(w);
    const o = createOrchestrator(new FakeProvider());
    const attempt = o.prepare({
      world: w,
      expectedHash: 'a'.repeat(64),
      action: {
        actorNationId: swe,
        source: 'player',
        text: 'Invest in domestic energy',
      },
      days: 30,
      fault: (current) => {
        if (current === stage)
          throw new Error('Injected workflow interruption');
      },
    });
    await expect(attempt).rejects.toThrow();
    expect(canonicalStringify(w)).toBe(before);
  },
);
it('narration and memory failures cannot alter already committed canonical history', async () => {
  const w = fixture(),
    o = createOrchestrator(new FakeProvider());
  const p = await o.prepare({
    world: w,
    expectedHash: 'a'.repeat(64),
    action: { actorNationId: swe, source: 'system', text: 'Observe' },
    days: 30,
  });
  const { expectedHash: _hash, ...request } = p.request;
  void _hash;
  const after = resolveTurn(w, request, context(1)),
    hash = canonicalStringify(after);
  const narrated = await o.narrate({
    before: w,
    after,
    trace: p.trace,
    fault: (stage) => {
      if (stage === 'during-narration')
        throw new Error('Narration interrupted');
    },
  });
  expect(narrated.headlines.length).toBeGreaterThan(0);
  expect(canonicalStringify(after)).toBe(hash);
  await expect(
    o.narrate({
      before: w,
      after,
      trace: p.trace,
      fault: (stage) => {
        if (stage === 'during-memory') throw new Error('Memory interrupted');
      },
    }),
  ).rejects.toThrow('Memory');
  expect(canonicalStringify(after)).toBe(hash);
});

it('global continuity attention preserves frequent major-power and regional planning', () => {
  const world = fixture();
  const observed = new Map<string, number>();
  for (let revision = 0; revision < 20; revision++) {
    world.revision = revision;
    const activations = scheduleActors(world, selectRelevance(world, null), 4);
    expect(new Set(activations.map((a) => a.nationId)).size).toBe(
      activations.length,
    );
    for (const actor of activations)
      observed.set(actor.nationId, (observed.get(actor.nationId) ?? 0) + 1);
  }
  for (const nation of [...world.nations]
    .sort(
      (a, b) =>
        b.stats.military +
        b.stats.economy -
        (a.stats.military + a.stats.economy),
    )
    .slice(0, 6))
    expect(observed.get(nation.id)).toBeGreaterThan(2);
});

it('immutable contract cache reuses schemas while mutable government facts refresh', async () => {
  const requests: GenerationRequest[] = [];
  const fake = new FakeProvider();
  const provider: LlmProvider = {
    id: fake.id,
    health: () => fake.health(),
    generateStructured: async (request) => {
      requests.push(request);
      return fake.generateStructured(request);
    },
  };
  const o = createOrchestrator(provider),
    w = fixture();
  const input = {
    world: w,
    expectedHash: 'a'.repeat(64),
    action: { actorNationId: swe, source: 'system' as const, text: 'Observe' },
    days: 30,
  };
  await o.prepare({ ...input, runId: 'cache-first' });
  w.nations.find((n) => n.id === fin)!.strategy.redLines = [
    'No foreign basing after renewed cabinet review',
  ];
  await o.prepare({ ...input, runId: 'cache-second' });
  const planners = requests.filter((r) => r.role === 'planner');
  expect(planners.length).toBeGreaterThan(2);
  expect(planners.every((r) => r.jsonSchema === planners[0]!.jsonSchema)).toBe(
    true,
  );
  expect(Object.isFrozen(planners[0]!.jsonSchema)).toBe(true);
  expect(
    planners.some((r) => r.prompt.includes('renewed cabinet review')),
  ).toBe(true);
});

it('authored strategic actors retain attention after relative capacity declines', () => {
  const w = fixture();
  w.scenario.strategicActors = [rus];
  const actor = w.nations.find((n) => n.id === rus)!;
  actor.stats.military = 0;
  actor.stats.economy = 0;
  let visits = 0;
  for (let revision = 0; revision < 20; revision++) {
    w.revision = revision;
    if (
      scheduleActors(w, selectRelevance(w, null), 4).some(
        (a) => a.nationId === rus,
      )
    )
      visits++;
  }
  expect(visits).toBeGreaterThan(5);
});

it('autonomy vetoes crisis talks after pressure saturates while preserving player intent', () => {
  const w = fixture();
  w.crises.push(
    Crisis.parse({
      id: 'crisis:stalled',
      title: 'Unresolved terms',
      participants: [fin, swe],
      type: 'security',
      startDate: w.date,
      trigger: 'Warning',
      issues: ['Security'],
    }),
  );
  const command = WorldCommand.parse({
    type: 'CRISIS_ACTION',
    crisisId: 'crisis:stalled',
    nationId: fin,
    move: 'talk',
  });
  expect(repetitionIssue(w, command, null)).toContain('saturated');
  expect(repetitionIssue(w, command, fin)).toBeNull();
  w.crises[0]!.diplomaticBreakdown = 20;
  expect(repetitionIssue(w, command, null)).toBeNull();
});

it('current planner generation requires visible decision factors, uncertainty and conference decisions', () => {
  expect(() =>
    NationPlanGeneration.parse({
      version: 1,
      nationId: fin,
      stance: 'observe',
      priorities: [],
      intentions: [],
      publicStatement: 'Review',
      explanation: 'No action',
    }),
  ).toThrow();
  expect(
    NationPlanGeneration.parse({
      version: 1,
      nationId: fin,
      stance: 'observe',
      priorities: [],
      intentions: [],
      publicStatement: 'Review',
      explanation: 'Preserve resources',
      decisionFactors: [
        {
          factor: 'cost',
          assessment: 'Unfunded work would exceed capacity',
          references: [fin],
        },
      ],
      uncertainty: 'uncertain',
      conferenceDecisions: [],
    }).decisionFactors,
  ).toHaveLength(1);
});
