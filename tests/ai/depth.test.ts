import { it, expect, describe } from 'vitest';
import { resolveTurn, assertWorld } from '@mandate/core';
import { buildContext } from '@mandate/memory';
import { Negotiation, EventId, NationId } from '@mandate/schemas';
import { fixture, request, context } from '../fixtures/world.js';
import {
  repetitionIssue,
  analyzeWorldBehavior,
  classifyImportance,
  ProviderConfig,
  createOrchestrator,
  FakeProvider,
  scheduleActors,
  selectRelevance,
} from '../../packages/ai/src/index.js';
import { behaviorCases } from './behavior-cases.js';
import { evaluateBehavior } from '../../tools/behavior-harness.js';
const step = (w: ReturnType<typeof fixture>, commands: unknown[]) =>
  resolveTurn(w, request(w, commands), context(w.revision + 1));
function oldRejection() {
  let w = fixture();
  const n = Negotiation.parse({
    id: 'negotiation:old',
    proposerNationId: 'nation:swe',
    recipientNationId: 'nation:fin',
    topic: 'Permanent basing',
    kind: 'consultation',
    terms: 'Permanent foreign bases',
    createdDate: w.date,
    expiresDate: '2025-04-01',
  });
  w = step(w, [
    { type: 'OPEN_NEGOTIATION', negotiation: n },
    {
      type: 'RESPOND_NEGOTIATION',
      negotiationId: n.id,
      nationId: 'nation:fin',
      move: 'reject',
      message: 'Neutrality precludes permanent bases',
    },
  ]);
  const id = w.events.find((e) => e.type === 'RESPOND_NEGOTIATION')!.id;
  for (let i = 0; i < 25; i++)
    w = step(w, [
      {
        type: 'CREATE_EVENT',
        event: {
          id: `event:minor-${i}`,
          type: 'minor',
          title: `Minor domestic bulletin ${i}`,
          nationIds: ['nation:fin'],
          regionIds: [],
          treatyIds: [],
          conflictIds: [],
          importance: 1,
          topics: ['domestic'],
          visibility: 'public',
          status: 'resolved',
        },
      },
      {
        type: 'ADVANCE_DATE',
        date: new Date(Date.parse(w.date) + 30 * 86400000)
          .toISOString()
          .slice(0, 10),
      },
    ]);
  return { w, id };
}
describe('decision context and autonomy contracts', () => {
  it('retrieves an 18+ turn old rejection outside recent context', () => {
    const { w, id } = oldRejection();
    const c = buildContext(
      w,
      NationId.parse('nation:fin'),
      [w.playerNationId],
      { recentLimit: 4, topics: ['Permanent basing'] },
    );
    expect(c.retrieval.historicalEventIds).toContain(id);
    expect(c.canonical.negotiations[0]!.status).toBe('rejected');
  });
  it('lets low-importance history disappear from active context', () => {
    const { w } = oldRejection();
    const c = buildContext(
      w,
      NationId.parse('nation:fin'),
      [w.playerNationId],
      { recentLimit: 4 },
    );
    expect(c.exactEventIds).not.toContain('event:minor-0');
    expect(c.retrieval.excludedEventCount).toBeGreaterThan(20);
  });
  it('records exact event budget exclusions', () => {
    const { w } = oldRejection();
    const c = buildContext(
      w,
      NationId.parse('nation:fin'),
      [w.playerNationId],
      { eventBudget: 1 },
    );
    expect(c.exactEventIds).toEqual([]);
    expect(c.retrieval.excludedBecauseOfBudget.length).toBeGreaterThan(0);
  });
  it('never retrieves foreign secret history even when topic matches', () => {
    let w = fixture();
    w = step(w, [
      {
        type: 'CREATE_EVENT',
        event: {
          id: 'event:secret',
          type: 'military',
          title: 'Permanent basing secret',
          nationIds: ['nation:rus'],
          regionIds: [],
          treatyIds: [],
          conflictIds: [],
          importance: 100,
          topics: ['basing'],
          visibility: 'private',
          status: 'resolved',
        },
      },
    ]);
    const c = buildContext(
      w,
      NationId.parse('nation:fin'),
      w.nations.map((n) => n.id),
      { topics: ['basing'] },
    );
    expect(c.exactEventIds).not.toContain(EventId.parse('event:secret'));
  });
  it('hides foreign private government directives and red lines', () => {
    const w = fixture();
    const rus = w.nations.find((n) => n.id === 'nation:rus')!;
    rus.strategy.redLines = ['Private war threshold'];
    rus.strategy.directives = [
      {
        id: 'secret-plan',
        text: 'Invade secretly',
        status: 'active',
        visibility: 'private',
        createdDate: w.date,
      },
    ];
    const c = buildContext(w, NationId.parse('nation:fin'), [rus.id]);
    expect(
      c.canonical.nations.find((n) => n.id === rus.id)!.strategy.directives,
    ).toEqual([]);
    expect(
      c.canonical.nations.find((n) => n.id === rus.id)!.strategy.redLines,
    ).toEqual([]);
  });
  it.each(['START_INITIATIVE', 'OPEN_NEGOTIATION'])(
    'vetoes equivalent autonomous %s',
    (type) => {
      const w = fixture();
      const n = Negotiation.parse({
        id: 'negotiation:repeat',
        proposerNationId: 'nation:fin',
        recipientNationId: 'nation:swe',
        topic: 'Cooperation',
        kind: 'consultation',
        terms: 'Same terms',
        createdDate: w.date,
        expiresDate: '2025-04-01',
      });
      w.negotiations.push(n);
      const command =
        type === 'OPEN_NEGOTIATION'
          ? { type: 'OPEN_NEGOTIATION' as const, negotiation: n }
          : {
              type: 'START_INITIATIVE' as const,
              initiative: {
                id: 'initiative:repeat' as never,
                nationId: n.proposerNationId,
                name: 'Energy',
                kind: 'energy' as const,
                startDate: w.date,
                durationDays: 180,
                effort: 2,
                targetNationId: null,
                visibility: 'public' as const,
                status: 'active' as const,
                progress: 0,
                invested: 0,
                dependencies: [],
                delays: 0,
                blocker: null,
                milestones: [],
              },
            };
      if (command.type === 'START_INITIATIVE')
        w.initiatives.push(command.initiative);
      expect(repetitionIssue(w, command, null)).not.toBeNull();
    },
  );
  it('allows materially revised terms after rejected diplomacy', () => {
    const w = fixture();
    const n = Negotiation.parse({
      id: 'negotiation:repeat',
      proposerNationId: 'nation:fin',
      recipientNationId: 'nation:swe',
      topic: 'Cooperation',
      kind: 'consultation',
      terms: 'Bases',
      status: 'rejected',
      createdDate: w.date,
      expiresDate: '2025-04-01',
      responses: [
        {
          nationId: 'nation:swe',
          date: w.date,
          move: 'reject',
          message: 'No bases',
        },
      ],
    });
    w.negotiations.push(n);
    expect(
      repetitionIssue(
        w,
        {
          type: 'OPEN_NEGOTIATION',
          negotiation: { ...n, terms: 'Intelligence sharing without bases' },
        },
        null,
      ),
    ).toBeNull();
  });
  it('blocks conflict postures that only repeat saturated state', () => {
    const w = step(fixture(), [
      {
        type: 'START_CONFLICT',
        conflict: {
          id: 'conflict:saturated',
          name: 'Saturated',
          attackers: ['nation:rus'],
          defenders: ['nation:fin'],
          status: 'active',
          escalation: 0,
          logistics: 100,
        },
      },
    ]);
    expect(
      repetitionIssue(
        w,
        {
          type: 'CONFLICT_ACTION',
          conflictId: w.conflicts[0]!.id,
          nationId: NationId.parse('nation:rus'),
          stance: 'defend',
        },
        null,
      ),
    ).toContain('saturated');
    expect(
      repetitionIssue(
        w,
        {
          type: 'CONFLICT_ACTION',
          conflictId: w.conflicts[0]!.id,
          nationId: NationId.parse('nation:rus'),
          stance: 'deescalate',
        },
        null,
      ),
    ).toContain('saturated');
  });
  it('blocks cosmetic relation drift', () => {
    const w = fixture();
    expect(
      repetitionIssue(
        w,
        {
          type: 'ADJUST_RELATION',
          nationA: w.playerNationId,
          nationB: w.nations[1]!.id,
          delta: 1,
        },
        null,
      ),
    ).toContain('drift');
  });
  it.each(['permanent basing', 'peace settlement', 'territorial transfer'])(
    'routes %s as high importance',
    (text) => {
      expect(classifyImportance(fixture(), text, [])).toBe('high');
    },
  );
  it('records independent events rather than counting time ticks as history', () => {
    const before = fixture(),
      after = step(before, [
        {
          type: 'CREATE_EVENT',
          event: {
            id: 'event:independent',
            type: 'cooperation',
            title: 'Independent cooperation',
            nationIds: ['nation:fin', 'nation:rus'],
            regionIds: [],
            treatyIds: [],
            conflictIds: [],
            importance: 60,
            topics: ['trade'],
            visibility: 'public',
            status: 'resolved',
          },
        },
        { type: 'ADVANCE_DATE', date: '2025-01-31' },
      ]);
    expect(analyzeWorldBehavior(before, after)).toMatchObject({
      meaningfulEvents: 1,
      playerInvolvementRatio: 0,
    });
  });
  it('crisis activation cannot duplicate the rotating background slot', () => {
    const w = fixture();
    w.conflicts.push({
      id: 'conflict:rotation' as never,
      name: 'Rotation crisis',
      attackers: ['nation:rus'] as never,
      defenders: ['nation:fin'] as never,
      status: 'active',
      escalation: 20,
      settlementState: 'fighting',
      exhaustion: 0,
      logistics: 50,
      warGoals: [],
      campaigns: [],
      theaters: [],
    });
    for (let revision = 0; revision < 30; revision++) {
      w.revision = revision;
      const a = scheduleActors(w, selectRelevance(w, null), 2);
      expect(new Set(a.map((a) => a.nationId)).size).toBe(a.length);
    }
  });
  it('country context includes active enemies even without player relevance', () => {
    const w = step(fixture(), [
      {
        type: 'START_CONFLICT',
        conflict: {
          id: 'conflict:knowledge',
          name: 'Knowledge',
          attackers: ['nation:rus'],
          defenders: ['nation:fin'],
          status: 'active',
          escalation: 10,
        },
      },
    ]);
    const c = buildContext(w, NationId.parse('nation:fin'), []);
    expect(c.canonical.nations.some((n) => n.id === 'nation:rus')).toBe(true);
  });
  it('high importance routes judgment to configured model and balanced critic', async () => {
    const fake = new FakeProvider();
    const calls: Array<{ role: string; model: string }> = [];
    const provider = {
      id: 'routing-test',
      health: () => fake.health(),
      generateStructured: async (
        r: Parameters<FakeProvider['generateStructured']>[0],
      ) => {
        calls.push({ role: r.role, model: r.model });
        return fake.generateStructured(r);
      },
    };
    const w = fixture();
    await createOrchestrator(provider, {
      model: 'default',
      roleModels: { formalizer: 'utility' },
      highImportanceModel: 'strong',
    }).prepare({
      world: w,
      expectedHash: '0'.repeat(64),
      action: {
        actorNationId: w.playerNationId,
        source: 'player',
        text: 'Propose a defense alliance with Finland',
      },
      quality: 'balanced',
      runId: 'route-model',
    });
    expect(calls.find((c) => c.role === 'formalizer')!.model).toBe('utility');
    expect(
      calls
        .filter((c) =>
          ['planner', 'diplomat', 'resolver', 'critic'].includes(c.role),
        )
        .every((c) => c.model === 'strong'),
    ).toBe(true);
    expect(calls.some((c) => c.role === 'critic')).toBe(true);
  });
  it('persistent multi-year player action creates goal without immediate completion', async () => {
    const w = fixture();
    const o = createOrchestrator(new FakeProvider());
    const p = await o.prepare({
      world: w,
      expectedHash: '0'.repeat(64),
      action: {
        actorNationId: w.playerNationId,
        source: 'player',
        text: 'Over five years invest in nuclear energy',
      },
      days: 30,
      runId: 'goal-policy',
    });
    const { expectedHash, ...turn } = p.request;
    void expectedHash;
    const after = resolveTurn(w, turn, context(1));
    expect(
      after.goals.some(
        (g) =>
          g.title === 'Reduce energy dependence' && g.status !== 'achieved',
      ),
    ).toBe(true);
    assertWorld(after);
  });
});
describe('behavioral benchmark contracts', () => {
  it('contains 100+ categorized gameplay cases across deployed roles', () => {
    expect(behaviorCases.length).toBeGreaterThanOrEqual(100);
    expect(new Set(behaviorCases.map((c) => c.role)).size).toBe(5);
  });
  it.each(
    behaviorCases
      .filter(
        (c) =>
          c.role === 'formalizer' ||
          c.role === 'resolver' ||
          c.role === 'narrator',
      )
      .map((c) => [c.id, c] as const),
  )('%s', async (_id, c) => {
    const result = await evaluateBehavior(
      new FakeProvider(),
      ProviderConfig.parse({}),
      fixture(),
      c,
    );
    expect(result.issues).toEqual([]);
  });
});
