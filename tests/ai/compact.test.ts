import { describe, it, expect } from 'vitest';
import { resolveTurn } from '@mandate/core';
import { NationId, Negotiation, Sanction } from '@mandate/schemas';
import { canonicalHash } from '@mandate/persistence';
import {
  createOrchestrator,
  FakeProvider,
  ProviderConfig,
  PlayerIntent,
} from '@mandate/ai';
import type { GenerationRequest, GenerationResult } from '@mandate/ai';
import { compactCandidates } from '../../packages/ai/src/compact.js';
import { profileProvider, profileKey } from '../../packages/ai/src/profile.js';
import { fixture, context, conflict, request } from '../fixtures/world.js';
class CompactProvider extends FakeProvider {
  constructor(private choose: (r: GenerationRequest) => string = () => 'wait') {
    super();
  }
  override async generateStructured(
    r: GenerationRequest,
  ): Promise<GenerationResult> {
    if (r.role === 'formalizer') {
      const payload = JSON.parse(r.prompt) as { clauses: string[] };
      const result = await super.generateStructured({
        ...r,
        prompt: JSON.stringify({
          action: {
            actorNationId: 'nation:swe',
            text: payload.clauses.join('. '),
          },
        }),
      });
      const value = result.value as {
        intentions: {
          kind: string;
          sourceClauseIds: number[];
          visibility: string;
        }[];
      };
      return {
        ...result,
        value: {
          classifications: payload.clauses.map((_, index) => {
            const i = value.intentions.find((i) =>
              i.sourceClauseIds.includes(index),
            )!;
            return { kind: i.kind, visibility: i.visibility };
          }),
        },
      };
    }
    const choice = this.choose(r);
    return {
      value: {
        choice,
        additionalChoices: [],
        reason: 'Material government choice',
        message:
          r.role === 'diplomat' || !r.prompt.includes('candidates')
            ? 'We answer these terms explicitly.'
            : '',
        counterTerms:
          choice === 'counter'
            ? 'Voluntary information sharing; no permanent basing.'
            : '',
      },
      rawText: '{}',
      latencyMs: 1,
    };
  }
}
const config = {
  kind: 'ollama',
  workflow: 'compact',
  maxBackgroundPlanners: 2,
  contextBudget: 30000,
  maxRepairs: 0,
} as const;
const prepare = (w = fixture(), provider = new CompactProvider(), text = '') =>
  createOrchestrator(provider, config).prepare({
    world: w,
    expectedHash: canonicalHash(w),
    runId: 'compact-test',
    action: {
      actorNationId: w.playerNationId,
      source: text ? 'player' : 'system',
      text: text || 'Advance world',
    },
    days: 30,
  });
describe('compact gameplay authority and budgets', () => {
  it('waiting creates no policy noise and narration uses committed facts without inference', async () => {
    const w = fixture(),
      p = new CompactProvider();
    const o = createOrchestrator(p, config);
    const result = await prepare(w, p);
    expect(result.trace.plans.length).toBeLessThanOrEqual(2);
    expect(result.request.commands.map((c) => c.command.type)).toEqual([
      'ADVANCE_DATE',
    ]);
    const after = resolveTurn(
      w,
      {
        expectedRevision: result.request.expectedRevision,
        action: result.request.action,
        commands: result.request.commands,
      },
      context(1),
    );
    expect(
      (await o.narrate({ before: w, after, trace: result.trace })).modelCalls,
    ).toEqual([]);
  });
  it('preserves an explicit player policy even when a background candidate is malformed', async () => {
    const w = fixture(),
      hash = canonicalHash(w);
    const result = await prepare(
      w,
      new CompactProvider(() => 'invented'),
      'Invest in energy',
    );
    expect(result.trace.playerExecution?.orders).toContain('Invest in energy');
    expect(
      result.request.commands.some(
        (entry) => entry.command.type === 'START_INITIATIVE',
      ),
    ).toBe(true);
    expect(result.trace.failures).toHaveLength(2);
    expect(canonicalHash(w)).toBe(hash);
  });
  it('records a failed background decision and continues other actors', async () => {
    const result = await prepare(
      fixture(),
      new CompactProvider(() => 'invented'),
    );
    expect(result.trace.failures).toHaveLength(2);
    expect(result.request.commands).toHaveLength(1);
  });
  it('a recipient decides independently and acceptance creates exactly the supplied binding agreement', async () => {
    const w = fixture();
    w.negotiations.push(
      Negotiation.parse({
        id: 'negotiation:test-trade',
        proposerNationId: w.playerNationId,
        recipientNationId: 'nation:fin',
        kind: 'trade',
        topic: 'Reciprocal supply',
        terms: 'Voluntary reciprocal supply agreement',
        createdDate: w.date,
        expiresDate: '2025-06-01',
      }),
    );
    const result = await prepare(
      w,
      new CompactProvider((r) => (r.role === 'diplomat' ? 'accept' : 'wait')),
    );
    const after = resolveTurn(
      w,
      {
        expectedRevision: result.request.expectedRevision,
        action: result.request.action,
        commands: result.request.commands,
      },
      context(1),
    );
    expect(after.treaties).toHaveLength(1);
    expect(result.trace.moves[0]?.move).toBe('accept');
  });
  it('a failed important diplomatic response aborts instead of fabricating consent', async () => {
    const w = fixture();
    w.negotiations.push(
      Negotiation.parse({
        id: 'negotiation:test-trade',
        proposerNationId: w.playerNationId,
        recipientNationId: 'nation:fin',
        kind: 'trade',
        topic: 'Reciprocal supply',
        terms: 'Reciprocal supply',
        createdDate: w.date,
        expiresDate: '2025-06-01',
      }),
    );
    await expect(
      prepare(w, new CompactProvider(() => 'invented')),
    ).rejects.toThrow('important decision');
    expect(w.treaties).toEqual([]);
  });
  it('exhausted wars suppress unrelated autonomous projects and expose a specific opponent for peace', () => {
    let w = fixture();
    w = resolveTurn(w, request(w, [conflict]), context(1));
    w.conflicts[0]!.exhaustion = 90;
    const options = compactCandidates(
      w,
      NationId.parse('nation:fin'),
      'war-check',
      null,
    );
    expect(options.some((c) => c.id.endsWith('-peace'))).toBe(true);
    expect(options.some((c) => c.family === 'project')).toBe(false);
  });
  it('does not disclose a private player internal directive to foreign government choices', async () => {
    const prompts: string[] = [];
    const p = new CompactProvider((r) => {
      prompts.push(r.prompt);
      return 'wait';
    });
    await prepare(
      fixture(),
      p,
      'Quietly invest in nuclear energy without publicly announcing it.',
    );
    expect(
      prompts.every(
        (s) => !s.includes('nuclear') || s.includes('"id":"nation:swe"'),
      ),
    ).toBe(true);
  });
  it('reviewing a progressing energy policy cannot silently launch duplicate spending', async () => {
    const p = new CompactProvider((r) =>
      r.role === 'planner' && r.prompt.includes('"id":"nation:swe"')
        ? 'project-energy'
        : 'wait',
    );
    const result = await prepare(
      fixture(),
      p,
      'Review the current energy program. Continue it if it is progressing; avoid duplicate spending.',
    );
    expect(result.request.commands.map((c) => c.command.type)).toEqual([
      'ADVANCE_DATE',
    ]);
    expect(result.trace.playerExecution?.orders).toEqual([]);
  });
  it('one malformed decision can be repaired but a second malformed government is skipped with an honest audit', async () => {
    let calls = 0;
    class RepairProvider extends CompactProvider {
      override async generateStructured(
        r: GenerationRequest,
      ): Promise<GenerationResult> {
        calls++;
        if (calls === 1 || calls === 3)
          return { value: {}, rawText: '{}', latencyMs: 1 };
        return super.generateStructured(r);
      }
    }
    const w = fixture();
    const result = await createOrchestrator(new RepairProvider(), {
      ...config,
      maxRepairs: 1,
    }).prepare({
      world: w,
      expectedHash: canonicalHash(w),
      action: {
        actorNationId: w.playerNationId,
        source: 'system',
        text: 'Advance world',
      },
      days: 30,
    });
    expect(calls).toBe(3);
    expect(
      result.trace.modelCalls.filter((c) => c.repairAttempt === 1),
    ).toHaveLength(1);
    expect(result.trace.failures.some((f) => f.includes('skipped'))).toBe(true);
    expect(result.request.commands.map((c) => c.command.type)).toEqual([
      'ADVANCE_DATE',
    ]);
  });
  it('terminal objectives open an explicit new partner goal that passes the actual resolver', () => {
    const w = fixture();
    const actor = NationId.parse('nation:fin');
    for (const g of w.goals.filter((g) => g.nationId === actor)) {
      g.status = 'failed';
    }
    const choices = compactCandidates(w, actor, 'reassessment-test', null);
    const proposal = choices.find((c) => c.family === 'strategy');
    expect(proposal).toBeDefined();
    const after = resolveTurn(w, request(w, proposal!.commands), context(1));
    const newGoal = after.goals.find((g) =>
      g.id.includes('reassessment-test'),
    )!;
    expect(newGoal.targetNationIds).toHaveLength(1);
    expect(newGoal.evaluation.kind).toBe('relationship');
    expect(newGoal.visibility).toBe('private');
  });
  it('an explicit energy investment offers no unrelated industrial project', () => {
    const w = fixture();
    const intent = PlayerIntent.parse({
      version: 1,
      actorNationId: w.playerNationId,
      summary: 'Start an energy diversification program',
      visibility: 'public',
      intentions: [
        {
          kind: 'economy',
          description: 'Start an energy diversification program',
          targetNationIds: [],
          visibility: 'public',
          sourceClauseIds: [0],
        },
      ],
      targetNationIds: [],
      targetRegionIds: [],
    });
    const choices = compactCandidates(
      w,
      w.playerNationId,
      'energy-test',
      intent,
    );
    expect(choices.some((c) => c.id === 'project-energy')).toBe(true);
    expect(choices.some((c) => c.id === 'project-industry')).toBe(false);
  });
  it('preserving independence is a constraint, not authority to fund a domestic program', () => {
    const w = fixture();
    const intent = PlayerIntent.parse({
      version: 1,
      actorNationId: w.playerNationId,
      summary:
        'Start a private energy diversification program. Preserve our independence.',
      visibility: 'private',
      targetNationIds: [],
      targetRegionIds: [],
      intentions: [
        {
          kind: 'economy',
          description: 'Start a private energy diversification program.',
          visibility: 'private',
          targetNationIds: [],
          sourceClauseIds: [0],
        },
        {
          kind: 'domestic',
          description: 'Preserve our independence.',
          visibility: 'public',
          targetNationIds: [],
          sourceClauseIds: [1],
        },
      ],
    });
    const candidates = compactCandidates(
      w,
      w.playerNationId,
      'constraint-test',
      intent,
    );
    expect(candidates.some((c) => c.id === 'project-energy')).toBe(true);
    expect(candidates.some((c) => c.id === 'project-reform')).toBe(false);
    const energy = candidates
      .find((c) => c.id === 'project-energy')!
      .commands.find((c) => c.type === 'START_INITIATIVE');
    expect(
      energy?.type === 'START_INITIATIVE' && energy.initiative.visibility,
    ).toBe('private');
  });
  it('a fiscal war emergency suppresses unrelated investment before exhaustion reaches a fixed threshold', () => {
    const w = resolveTurn(
      fixture(),
      request(fixture(), [conflict]),
      context(1),
    );
    w.nations.find((n) => n.id === 'nation:fin')!.stats.fiscal = 10;
    expect(
      compactCandidates(
        w,
        NationId.parse('nation:fin'),
        'fiscal-war',
        null,
      ).some((c) => c.family === 'project'),
    ).toBe(false);
  });
  it('observer autonomy prioritizes a severely sanctioned state and cannot choose unrelated routine rearmament', async () => {
    const w = fixture();
    w.observerMode = true;
    w.sanctions.push(
      Sanction.parse({
        id: 'sanction:severe-test',
        issuer: 'nation:rus',
        target: 'nation:swe',
        sector: 'energy',
        intensity: 90,
        startDate: w.date,
        reason: 'Authored stress fixture',
      }),
    );
    const candidates = compactCandidates(
      w,
      w.playerNationId,
      'coercion-test',
      null,
    );
    expect(candidates.some((c) => c.id === 'project-rearmament')).toBe(false);
    expect(candidates.some((c) => c.id.endsWith('-trade'))).toBe(true);
    const result = await createOrchestrator(new CompactProvider(), {
      ...config,
      maxBackgroundPlanners: 1,
    }).prepare({
      world: w,
      expectedHash: canonicalHash(w),
      action: {
        actorNationId: w.playerNationId,
        source: 'system',
        text: 'Advance world',
      },
      days: 30,
    });
    expect(result.trace.plans[0]!.nationId).toBe(w.playerNationId);
  });
  it('incoming consent stays with the player, but observer mode releases that government to independent AI', async () => {
    const w = fixture();
    w.sanctions.push(
      Sanction.parse({
        id: 'sanction:observer-test',
        issuer: 'nation:rus',
        target: 'nation:swe',
        sector: 'energy',
        intensity: 90,
        startDate: w.date,
        reason: 'Authored stress fixture',
      }),
    );
    w.negotiations.push(
      Negotiation.parse({
        id: 'negotiation:incoming-test',
        proposerNationId: 'nation:fin',
        recipientNationId: 'nation:swe',
        kind: 'trade',
        topic: 'Reciprocal supply',
        terms: 'Voluntary reciprocal supply',
        createdDate: w.date,
        expiresDate: '2025-06-01',
      }),
    );
    const run = (world: typeof w) =>
      createOrchestrator(
        new CompactProvider((r) => (r.role === 'diplomat' ? 'accept' : 'wait')),
        { ...config, maxBackgroundPlanners: 1 },
      ).prepare({
        world,
        expectedHash: canonicalHash(world),
        action: {
          actorNationId: world.playerNationId,
          source: 'system',
          text: 'Advance world',
        },
        days: 30,
      });
    expect(
      (await run(w)).request.commands.some(
        (c) => c.command.type === 'RESPOND_NEGOTIATION',
      ),
    ).toBe(false);
    w.observerMode = true;
    const result = await run(w);
    const after = resolveTurn(
      w,
      {
        expectedRevision: result.request.expectedRevision,
        action: result.request.action,
        commands: result.request.commands,
      },
      context(1),
    );
    expect(after.treaties).toHaveLength(1);
  });
  it('different recipients receive only their addressed terms and the private offer remains private', () => {
    const w = fixture();
    const fin = NationId.parse('nation:fin'),
      nor = NationId.parse('nation:nor');
    const intent = PlayerIntent.parse({
      version: 1,
      actorNationId: w.playerNationId,
      summary:
        'Privately propose intelligence sharing with Finland. Publicly propose trade with Norway.',
      visibility: 'public',
      targetNationIds: [fin, nor],
      targetRegionIds: [],
      intentions: [
        {
          kind: 'diplomacy',
          description: 'Privately propose intelligence sharing with Finland.',
          visibility: 'private',
          targetNationIds: [fin],
          sourceClauseIds: [0],
        },
        {
          kind: 'diplomacy',
          description: 'Publicly propose trade with Norway.',
          visibility: 'public',
          targetNationIds: [nor],
          sourceClauseIds: [1],
        },
      ],
    });
    const choices = compactCandidates(
      w,
      w.playerNationId,
      'recipient-scope-test',
      intent,
    );
    const negotiations = choices
      .flatMap((c) => c.commands)
      .filter((c) => c.type === 'OPEN_NEGOTIATION')
      .map((c) => c.negotiation);
    expect(negotiations.find((n) => n.recipientNationId === fin)).toMatchObject(
      {
        visibility: 'private',
        terms: 'Privately propose intelligence sharing with Finland.',
      },
    );
    expect(negotiations.find((n) => n.recipientNationId === nor)).toMatchObject(
      { visibility: 'public', terms: 'Publicly propose trade with Norway.' },
    );
  });
  it('a war offer does not count as recipient activity: the observer recipient gets the next bounded decision and can end the war', async () => {
    const base = fixture();
    let w = resolveTurn(
      base,
      request(base, [
        conflict,
        {
          type: 'OPEN_NEGOTIATION',
          negotiation: Negotiation.parse({
            id: 'negotiation:war-fairness',
            proposerNationId: 'nation:rus',
            recipientNationId: 'nation:fin',
            kind: 'peace',
            conflictId: 'conflict:crisis',
            topic: 'Exhausted war settlement',
            terms: 'End war without ownership transfers',
            createdDate: base.date,
            expiresDate: '2025-06-01',
          }),
        },
      ]),
      context(1),
    );
    w.observerMode = true;
    w.conflicts[0]!.exhaustion = 85;
    const result = await createOrchestrator(
      new CompactProvider((r) => (r.role === 'diplomat' ? 'accept' : 'wait')),
      { ...config, maxBackgroundPlanners: 1 },
    ).prepare({
      world: w,
      expectedHash: canonicalHash(w),
      action: {
        actorNationId: w.playerNationId,
        source: 'system',
        text: 'Advance world',
      },
      days: 30,
    });
    expect(result.trace.plans[0]!.nationId).toBe('nation:fin');
    w = resolveTurn(
      w,
      {
        expectedRevision: result.request.expectedRevision,
        action: result.request.action,
        commands: result.request.commands,
      },
      context(2),
    );
    expect(w.conflicts[0]!.status).toBe('ended');
  });
  it('accepted consultations are not reannounced as new autonomous policy during the cooldown', () => {
    const base = fixture();
    const n = Negotiation.parse({
      id: 'negotiation:accepted-talks',
      proposerNationId: 'nation:fin',
      recipientNationId: 'nation:swe',
      kind: 'consultation',
      topic: 'Regional consultation',
      terms: 'Voluntary consultation',
      createdDate: base.date,
      expiresDate: '2025-06-01',
    });
    const w = resolveTurn(
      base,
      request(base, [
        { type: 'OPEN_NEGOTIATION', negotiation: n },
        {
          type: 'RESPOND_NEGOTIATION',
          negotiationId: n.id,
          nationId: 'nation:swe',
          move: 'accept',
          message: 'We agree to consult',
        },
      ]),
      context(1),
    );
    expect(
      compactCandidates(
        w,
        NationId.parse('nation:fin'),
        'consultation-review',
        null,
      ).some((c) => c.id === 'offer-swe-consultation'),
    ).toBe(false);
  });
  it('calibration persists observable failures and excludes secrets from its identity', async () => {
    const cfg = ProviderConfig.parse({ ...config, apiKey: 'secret-key' });
    const p = new CompactProvider((r) => {
      const t = (JSON.parse(r.prompt) as { task: string }).task;
      return t.includes('exclusive')
        ? 'reject'
        : t.includes('neutrality')
          ? 'counter'
          : t.includes('stalled war')
            ? 'peace-talks'
            : t.includes('Norway')
              ? 'trade-norway'
              : t.includes('active energy')
                ? 'continue-policy'
                : 'accept';
    });
    const profile = await profileProvider(p, cfg);
    expect(profile.passed).toBe(6);
    expect(profile.concurrency).toBe(1);
    expect(profileKey(cfg)).not.toContain('secret-key');
  });
});
