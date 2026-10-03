import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { loadScenario } from '@mandate/scenarios';
import { canonicalStringify, resolveTurn } from '@mandate/core';
import { NationId } from '@mandate/schemas';
import {
  createOrchestrator,
  FakeProvider,
  OrchestrationError,
  PlayerIntent,
  ProviderConfig,
  scheduleActors,
  selectRelevance,
} from '../../packages/ai/src/index.js';
import type {
  GenerationRequest,
  GenerationResult,
} from '../../packages/ai/src/index.js';
import {
  buildContext,
  summarizeHistory,
  visibleTo,
} from '../../packages/memory/src/index.js';
import {
  context,
  conflict,
  fixture,
  request as debugRequest,
} from '../fixtures/world.js';
import { actionEvaluations } from './evaluations.js';

const hash = (world: ReturnType<typeof fixture>) =>
  createHash('sha256').update(canonicalStringify(world)).digest('hex');
const prepare = (
  provider = new FakeProvider(),
  source: 'player' | 'system' = 'player',
  text = 'Expand nuclear energy over five years.',
) => {
  const world = fixture();
  return createOrchestrator(provider).prepare({
    world,
    expectedHash: hash(world),
    action: { actorNationId: world.playerNationId, source, text },
    runId: 'test-prepare',
  });
};
class ModifiedProvider extends FakeProvider {
  constructor(
    private readonly modify: (
      request: GenerationRequest,
      result: GenerationResult,
    ) => GenerationResult | Promise<GenerationResult>,
  ) {
    super();
  }
  override async generateStructured(request: GenerationRequest) {
    return this.modify(request, await super.generateStructured(request));
  }
}

describe('deterministic action evaluations', () => {
  it.each(actionEvaluations)(
    '$id recognizes $expectedKind and the named government',
    async (evaluation) => {
      const world = fixture();
      const index = Number(evaluation.id.split('-')[1]);
      const target = world.nations.filter((n) => n.id !== world.playerNationId)[
        index
      ]!;
      const provider = new FakeProvider();
      const output = await provider.generateStructured({
        role: 'formalizer',
        model: 'demo-rules-v1',
        system: '',
        prompt: JSON.stringify({
          action: {
            actorNationId: world.playerNationId,
            text: evaluation.text(target.name),
          },
          nations: world.nations,
          regions: world.regions,
        }),
        jsonSchema: {},
      });
      const parsed = PlayerIntent.parse(output.value);
      expect(parsed.targetNationIds).toContain(target.id);
      expect(parsed.intentions.map((i) => i.kind)).toContain(
        evaluation.expectedKind,
      );
      expect(parsed.visibility).toBe(evaluation.private ? 'private' : 'public');
    },
  );
});

describe('turn trust boundary', () => {
  it('default context budget supports the shipped global compound action in deep mode', async () => {
    const world = loadScenario(
      new URL('../../data/scenarios/global-alpha.json', import.meta.url)
        .pathname,
    );
    const result = await createOrchestrator(new FakeProvider()).prepare({
      world,
      expectedHash: hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'player',
        text: 'Begin a quiet diplomatic initiative with Finland and Norway aimed at closer defense cooperation. Do not propose a formal alliance yet. At the same time, increase military readiness in northern Sweden without publicly announcing a mobilization.',
      },
      quality: 'deep',
      runId: 'default-deep',
    });
    expect(result.trace.status).toBe('prepared');
    expect(
      Math.max(...result.trace.modelCalls.map((c) => c.contextCharacters)),
    ).toBeLessThanOrEqual(48000);
  });
  it('autonomy stops capped industry projects when fiscal potential limits the economy', async () => {
    const world = fixture();
    for (const n of world.nations)
      Object.assign(n.stats, {
        industrial: 100,
        economy: 75,
        fiscal: 50,
        military: 85,
        readiness: 85,
        legitimacy: 80,
        unrest: 0,
        energyExposure: 10,
        influence: 85,
      });
    const result = await createOrchestrator(new FakeProvider()).prepare({
      world,
      expectedHash: hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'system',
        text: 'Observe world',
      },
      runId: 'saturation',
    });
    expect(result.request.commands.map((c) => c.command.type)).toEqual([
      'ADVANCE_DATE',
    ]);
  });
  it('player economy and military intentions become separate ongoing projects', async () => {
    const result = await prepare(
      new FakeProvider(),
      'player',
      'Expand nuclear energy. At the same time, increase military readiness.',
    );
    const kinds = result.request.commands.flatMap((c) =>
      c.command.type === 'START_INITIATIVE' &&
      c.command.initiative.nationId === 'nation:swe'
        ? [c.command.initiative.kind]
        : [],
    );
    expect(kinds).toEqual(['energy', 'rearmament']);
  });
  it('proposes ongoing policies, previews invariants and never mutates input', async () => {
    const world = fixture();
    const before = canonicalStringify(world);
    const prepared = await createOrchestrator(new FakeProvider()).prepare({
      world,
      expectedHash: hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'player',
        text: 'Spend five years expanding nuclear energy.',
      },
      runId: 'policy',
    });
    expect(canonicalStringify(world)).toBe(before);
    expect(prepared.trace.status).toBe('prepared');
    expect(
      prepared.request.commands.some(
        (c) =>
          c.command.type === 'START_INITIATIVE' &&
          c.command.initiative.durationDays === 1825,
      ),
    ).toBe(true);
    expect(prepared.request.commands.at(-1)?.command.type).toBe('ADVANCE_DATE');
    expect(
      prepared.trace.modelCalls.every(
        (r) => r.rawOutput && r.contextCharacters > 0 && r.promptVersion,
      ),
    ).toBe(true);
  });
  it.each(['TRANSFER_CONTROL', 'SWITCH_NATION', 'ADJUST_NATION_STAT'])(
    'rejects forbidden %s through bounded repair',
    async (type) => {
      let count = 0;
      const provider = new ModifiedProvider((r, output) => {
        if (r.role !== 'resolver') return output;
        count++;
        const command =
          type === 'TRANSFER_CONTROL'
            ? { type, nationId: 'nation:rus', regionId: 'region:ne-fin' }
            : type === 'SWITCH_NATION'
              ? { type, nationId: 'nation:rus' }
              : { type, nationId: 'nation:swe', stat: 'military', delta: 80 };
        const value = {
          version: 1,
          explanation: 'Untrusted output',
          commands: [{ command, reason: 'Attempt unauthorized mutation' }],
        };
        return { ...output, value, rawText: JSON.stringify(value) };
      });
      await expect(prepare(provider)).rejects.toThrow(
        'Unauthorized resolver command',
      );
      expect(count).toBe(2);
    },
  );
  it('repairs one malformed output then succeeds', async () => {
    let count = 0;
    const provider = new ModifiedProvider((r, output) =>
      r.role === 'resolver' && count++ === 0
        ? {
            ...output,
            value: { type: 'SQL', sql: 'DELETE FROM nations' },
            rawText: 'malformed',
          }
        : output,
    );
    const result = await prepare(provider);
    expect(count).toBe(2);
    expect(
      result.trace.modelCalls.some(
        (r) => r.repairAttempt === 1 && r.status === 'accepted',
      ),
    ).toBe(true);
    expect(result.trace.failures).toHaveLength(1);
  });
  it('derives entity references from player text instead of model IDs', async () => {
    const provider = new ModifiedProvider((r, output) =>
      r.role === 'formalizer'
        ? {
            ...output,
            value: {
              ...(output.value as object),
              targetNationIds: ['nation:invented'],
            },
          }
        : output,
    );
    const result = await prepare(provider);
    expect(result.trace.intent?.targetNationIds).toEqual([]);
    expect(result.trace.validatorResults).toContain(
      'Formalizer entity references replaced with canonical references from the player action.',
    );
  });
  it('binds a model-supplied actor to the canonical player nation', async () => {
    const provider = new ModifiedProvider((r, output) =>
      r.role === 'formalizer'
        ? {
            ...output,
            value: {
              ...(output.value as object),
              actorNationId: 'nation:fin',
              targetNationIds: ['nation:swe'],
              intentions: (
                output.value as { intentions: Array<object> }
              ).intentions.map((intention) => ({
                ...intention,
                targetNationIds: ['nation:swe'],
              })),
            },
          }
        : output,
    );
    const result = await prepare(
      provider,
      'player',
      'Increase military readiness near Finland.',
    );
    expect(result.trace.intent?.actorNationId).toBe('nation:swe');
    expect(result.trace.intent?.targetNationIds).toEqual(['nation:fin']);
    expect(result.trace.validatorResults).toContain(
      'Formalizer actor ignored; canonical player actor applied.',
    );
  });
  it('rejects resolver unknown references', async () => {
    const provider = new ModifiedProvider((r, output) => {
      if (r.role !== 'resolver') return output;
      const value = structuredClone(output.value) as {
        commands: Array<{
          command: { initiative?: { targetNationId: string | null } };
        }>;
      };
      value.commands.find(
        (item) => item.command.initiative,
      )!.command.initiative!.targetNationId = 'nation:invented';
      return { ...output, value };
    });
    await expect(prepare(provider)).rejects.toThrow(
      'Unknown entity reference nation:invented',
    );
  });
  it('aborts cancellation before returning a commit request', async () => {
    const controller = new AbortController();
    const provider = new ModifiedProvider((r, output) => {
      if (r.role === 'resolver') controller.abort();
      return output;
    });
    const world = fixture();
    const before = hash(world);
    await expect(
      createOrchestrator(provider).prepare({
        world,
        expectedHash: before,
        action: {
          actorNationId: world.playerNationId,
          source: 'system',
          text: 'Autoplay',
        },
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(OrchestrationError);
    expect(hash(world)).toBe(before);
  });
  it('independent planners run concurrently', async () => {
    let concurrent = 0;
    let maximum = 0;
    const provider = new ModifiedProvider(async (r, output) => {
      if (r.role === 'planner') {
        concurrent++;
        maximum = Math.max(maximum, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 5));
        concurrent--;
      }
      return output;
    });
    await prepare(provider, 'system', 'Autoplay');
    expect(maximum).toBeGreaterThan(1);
    expect(concurrent).toBe(0);
  });
  it('background planner failure does not discard valid independent plans', async () => {
    let count = 0;
    const provider = new ModifiedProvider((r, output) => {
      if (r.role === 'planner' && count++ === 0)
        throw new Error('Background outage');
      return output;
    });
    const result = await prepare(provider, 'system', 'Autoplay');
    expect(result.trace.failures.join()).toContain('Background outage');
    expect(result.trace.plans).toHaveLength(
      result.trace.activations.length - 1,
    );
  });
  it('narration cannot invent state-changing claims or unknown event IDs', async () => {
    const world = fixture();
    const provider = new ModifiedProvider((r, output) =>
      r.role === 'narrator'
        ? {
            ...output,
            value: { version: 1, headlineEventIds: ['event:invented'] },
          }
        : output,
    );
    const orchestrator = createOrchestrator(provider);
    const result = await orchestrator.prepare({
      world,
      expectedHash: hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'system',
        text: 'Autoplay',
      },
      runId: 'narration',
    });
    const { expectedHash: _hash, ...pure } = result.request;
    void _hash;
    const after = resolveTurn(world, pure, context(1));
    const narration = await orchestrator.narrate({
      before: world,
      after,
      trace: result.trace,
    });
    expect(narration.headlines).toEqual(
      after.events.slice(0, 6).map((e) => e.title),
    );
    expect(result.trace.failures.join()).toContain('Narrator invented');
    expect(world.revision).toBe(0);
  });
  it('role models are partial and configuration has bounded controls', () => {
    expect(
      ProviderConfig.parse({ roleModels: { resolver: 'strong-model' } })
        .roleModels?.resolver,
    ).toBe('strong-model');
    expect(() => ProviderConfig.parse({ retries: 99 })).toThrow();
    expect(() => ProviderConfig.parse({ timeoutMs: 0 })).toThrow();
  });
});

describe('perspective, diplomacy and historical continuity', () => {
  it('accepted bilateral ceasefire suspends demo offensives, then peace ends the conflict', async () => {
    let world = fixture();
    world = resolveTurn(
      world,
      debugRequest(world, [
        conflict,
        { type: 'SWITCH_NATION', nationId: 'nation:fin' },
        {
          type: 'ADJUST_RELATION',
          nationA: 'nation:fin',
          nationB: 'nation:rus',
          delta: 50,
        },
      ]),
      context(1),
    );
    const orchestrator = createOrchestrator(new FakeProvider());
    const turn = async (text: string, source: 'player' | 'system') => {
      const result = await orchestrator.prepare({
        world,
        expectedHash: hash(world),
        action: { actorNationId: world.playerNationId, source, text },
        runId: `settlement-${world.revision}`,
      });
      const { expectedHash: ignored, ...request } = result.request;
      void ignored;
      world = resolveTurn(world, request, context(world.revision + 1));
      return result;
    };
    await turn('Seek a ceasefire with Russia.', 'player');
    expect(world.negotiations[0]?.kind).toBe('ceasefire');
    expect(world.negotiations[0]?.conflictId).toBe('conflict:crisis');
    await turn('Observe diplomacy', 'system');
    expect(world.conflicts[0]?.settlementState).toBe('ceasefire');
    const observed = await turn('Observe the ceasefire', 'system');
    expect(
      observed.request.commands.some(
        (c) =>
          c.command.type === 'CONFLICT_ACTION' &&
          c.command.stance === 'offensive',
      ),
    ).toBe(false);
    await turn('Negotiate peace with Russia.', 'player');
    await turn('Observe diplomacy', 'system');
    expect(world.conflicts[0]?.status).toBe('ended');
    expect(world.treaties.some((t) => t.kind === 'peace')).toBe(true);
  });
  it('diplomatic consent names its exact pending offer', async () => {
    let world = fixture();
    const orchestrator = createOrchestrator(new FakeProvider());
    const first = await orchestrator.prepare({
      world,
      expectedHash: hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'player',
        text: 'Propose a nonaggression pact with Finland.',
      },
      runId: 'exact-first',
    });
    const { expectedHash: ignored, ...pure } = first.request;
    void ignored;
    world = resolveTurn(world, pure, context(1));
    const next = await orchestrator.prepare({
      world,
      expectedHash: hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'system',
        text: 'Observe',
      },
      runId: 'exact-second',
    });
    expect(
      next.trace.moves.find((m) => m.nationId === 'nation:fin')?.negotiationId,
    ).toBe(world.negotiations[0]?.id);
  });
  it('private compound diplomacy does not reveal internal military plans to its recipients', async () => {
    const captured: Array<{ nation: string; payload: string }> = [];
    const provider = new ModifiedProvider((r, output) => {
      if (r.role === 'planner')
        captured.push({
          nation: (
            JSON.parse(r.prompt) as { context: { perspectiveNationId: string } }
          ).context.perspectiveNationId,
          payload: r.prompt,
        });
      return output;
    });
    const result = await prepare(
      provider,
      'player',
      'Begin a quiet diplomatic initiative with Finland and Norway aimed at closer defense cooperation. Do not propose a formal alliance yet. At the same time, increase military readiness in northern Sweden without publicly announcing a mobilization.',
    );
    for (const n of ['nation:fin', 'nation:nor']) {
      const foreign = captured.find((p) => p.nation === n)!;
      expect(foreign.payload).not.toContain('northern Sweden');
      expect(foreign.payload).not.toContain('mobilization');
    }
    expect(captured.some((p) => p.nation === 'nation:swe')).toBe(false);
    expect(result.trace.playerExecution?.orders.join(' ')).toContain(
      'northern Sweden',
    );
    expect(
      result.trace.intent?.policyOrders.find((o) =>
        o.text.includes('northern Sweden'),
      )?.visibility,
    ).toBe('private');
    for (const c of result.request.commands)
      if (c.command.type === 'OPEN_NEGOTIATION') {
        expect(c.command.negotiation.terms).not.toContain('mobilization');
        expect(c.command.negotiation.kind).toBe('consultation');
      }
  });
  it('filters private events, goals, initiatives, negotiations and accepted treaties for outsiders', () => {
    let world = fixture();
    world = resolveTurn(
      world,
      debugRequest(world, [
        {
          type: 'CREATE_EVENT',
          event: {
            id: 'event:secret',
            type: 'diplomacy',
            title: 'Private exchange',
            nationIds: ['nation:swe', 'nation:fin'],
            regionIds: [],
            treatyIds: [],
            conflictIds: [],
            importance: 50,
            topics: ['secret'],
            visibility: 'private',
            status: 'resolved',
          },
        },
      ]),
      context(1),
    );
    world.treaties.push({
      id: 'treaty:private' as never,
      name: 'Private pact',
      kind: 'defense',
      parties: [NationId.parse('nation:swe'), NationId.parse('nation:fin')],
      terms: 'Private',
      status: 'active',
      visibility: 'private',
      conflictId: null,
    });
    world.goals[0]!.visibility = 'private';
    const outsider = buildContext(world, NationId.parse('nation:rus'), [
      NationId.parse('nation:swe'),
      NationId.parse('nation:fin'),
    ]);
    expect(outsider.exactEventIds).not.toContain('event:secret');
    expect(outsider.canonical.treaties).toHaveLength(0);
    expect(outsider.canonical.goals).not.toContainEqual(world.goals[0]);
    expect(
      outsider.canonical.nations.find((n) => n.id === 'nation:swe')?.stats
        .readiness,
    ).toBeUndefined();
    expect(
      outsider.canonical.nations.find((n) => n.id === 'nation:swe')?.stats
        .treasury,
    ).toBeUndefined();
    expect(
      buildContext(world, NationId.parse('nation:fin'), [
        NationId.parse('nation:swe'),
      ]).exactEventIds,
    ).toContain('event:secret');
    expect(
      visibleTo(
        { visibility: 'private', nationId: NationId.parse('nation:swe') },
        NationId.parse('nation:rus'),
      ),
    ).toBe(false);
  });
  it('canonical private accepted treaty remains hidden in future planners', async () => {
    let world = fixture();
    const orchestrator = createOrchestrator(new FakeProvider());
    const first = await orchestrator.prepare({
      world,
      expectedHash: hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'player',
        text: 'Privately propose a nonaggression pact with Finland.',
      },
      runId: 'diplo-first',
    });
    const { expectedHash: _h1, ...one } = first.request;
    void _h1;
    world = resolveTurn(world, one, context(1));
    expect(world.treaties).toHaveLength(0);
    expect(world.negotiations[0]?.status).toBe('open');
    const second = await orchestrator.prepare({
      world,
      expectedHash: hash(world),
      action: {
        actorNationId: world.playerNationId,
        source: 'system',
        text: 'Observe the world',
      },
      runId: 'diplo-second',
    });
    const { expectedHash: _h2, ...two } = second.request;
    void _h2;
    world = resolveTurn(world, two, context(2));
    expect(world.negotiations[0]?.status).toBe('accepted');
    expect(world.treaties[0]?.visibility).toBe('private');
    const outsider = buildContext(world, NationId.parse('nation:rus'), [
      NationId.parse('nation:fin'),
      NationId.parse('nation:swe'),
    ]);
    expect(outsider.canonical.negotiations).toHaveLength(0);
    expect(outsider.canonical.treaties).toHaveLength(0);
  });
  it('coercive territorial demands are rejected by the addressed government', async () => {
    const result = await prepare(
      new FakeProvider(),
      'player',
      'Demand Finland cede territory in a diplomatic agreement.',
    );
    expect(
      result.trace.plans.find((p) => p.nationId === 'nation:fin')?.stance,
    ).toBe('oppose');
    expect(
      result.trace.moves.find((m) => m.nationId === 'nation:fin')?.move,
    ).toBe('reject');
    expect(
      result.request.commands.some(
        (c) => c.command.type === 'TRANSFER_OWNERSHIP',
      ),
    ).toBe(false);
  });
  it('rejects summaries from a future revision or another perspective', () => {
    const world = fixture();
    const summary = summarizeHistory(world, world.playerNationId);
    expect(
      buildContext(
        world,
        NationId.parse('nation:fin'),
        [world.playerNationId],
        { summaries: [summary] },
      ).summaries,
    ).toHaveLength(0);
    expect(
      buildContext(world, world.playerNationId, [], {
        summaries: [{ ...summary, toRevision: 1 }],
      }).summaries,
    ).toHaveLength(0);
  });
  it('scheduler covers every actor and is independent of wall time or mutable process memory', () => {
    const world = fixture();
    const all = new Set<string>();
    for (let revision = 0; revision < world.nations.length; revision++) {
      const w = { ...world, revision };
      const activation = scheduleActors(w, selectRelevance(w, null), 2);
      activation.forEach((a) => all.add(a.nationId));
      expect(activation).toEqual(
        scheduleActors(w, selectRelevance(w, null), 2),
      );
    }
    expect(all.size).toBe(world.nations.length);
  });
});
